# Pitfalls Research: Гибридный NLP Pipeline в Production

**Domain:** Добавление NLP-моделей (GLiNER2, TF-IDF classifier, pgvector) в существующее production-приложение
**Researched:** 2026-03-24
**Confidence:** HIGH (верифицировано по исходникам, Docker-конфигурации, офиц. документации, issue-трекерам)

## Critical Pitfalls

### Pitfall 1: PostgreSQL Alpine -> Debian: несовместимость данных при смене образа

**What goes wrong:**
Текущий `postgres:17.9-alpine` использует musl libc. `pgvector/pgvector:pg17` основан на Debian (Bookworm/Trixie) и использует glibc. **Эти data directories НЕ совместимы** из-за различий в collation rules C-библиотек. Если просто заменить image в docker-compose.prod.yml и запустить контейнер с тем же volume `postgres_data`, PostgreSQL может:
- Отказаться стартовать с ошибкой collation mismatch
- Стартовать, но выдавать некорректные результаты ORDER BY/индексов на текстовых колонках
- Повредить индексы при REINDEX

Это **самый опасный** pitfall в миграции -- потенциальная потеря данных в production.

**Why it happens:**
Docker Hub документация гласит: "Don't try to run a data directory created with the alpine-based images on a Debian based image." Это часто упускают, потому что PostgreSQL 17 -> PostgreSQL 17 кажется safe swap. Но base OS различается (musl vs glibc), и text collation -- фундаментально несовместимый.

**How to avoid:**
1. **pg_dump ПЕРЕД сменой образа** -- полный logical backup:
   ```bash
   docker exec fancai_postgres pg_dump -U $DB_USER -d $DB_NAME -F custom -Z6 -f /tmp/backup.dump
   docker cp fancai_postgres:/tmp/backup.dump ./backup-before-pgvector.dump
   ```
2. **Удалить** volume `postgres_data` после backup
3. Запустить новый `pgvector/pgvector:pg17` с чистым volume
4. pg_restore из backup
5. CREATE EXTENSION vector; через Alembic migration
6. Сверить количество записей по всем таблицам (entities: 274, descriptions: 519, chapters: 233)

**Дополнительная сложность:** текущий compose использует `PGDATA=/var/lib/postgresql/data/pgdata` -- custom subdirectory. Убедиться, что в новом образе путь идентичен. `pgvector/pgvector:pg17` наследует от `postgres:17` (Debian) -- PGDATA по умолчанию `/var/lib/postgresql/data`. Custom PGDATA в env variable должен быть сохранён.

**Warning signs:**
- PostgreSQL не стартует после `docker compose up -d`
- `pg_isready` healthcheck fails
- Ошибки в логах: `database files are incompatible with server`, `collation version mismatch`
- ORDER BY на текстовых колонках даёт другой порядок (русский текст!)

**Phase to address:**
Первая фаза (инфраструктура/Docker) -- ДО любых NLP-изменений. Это prerequisite.

**Confidence:** HIGH
**Sources:**
- [docker-library/postgres Discussion #1192](https://github.com/docker-library/postgres/discussions/1192) -- Alpine data directory issue
- [docker-library/postgres PR #1259](https://github.com/docker-library/postgres/pull/1259) -- PGDATA changes in PG 18+
- [pgvector/pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) -- Debian-based tags only (pg17-bookworm, pg17-trixie)

---

### Pitfall 2: Celery worker OOM при загрузке PyTorch-моделей

**What goes wrong:**
Текущий Celery worker: 1.5 GB RAM limit, concurrency=2, max-memory-per-child=512MB. GLiNER2 (PyTorch, 205M params) потребляет ~800MB-1.2GB RAM. При concurrency=2 prefork pool создаёт 2 child-процесса, каждый может загрузить модель -> 2.4GB только на модели, что превышает limit 1.5GB. Worker будет убит OOM killer, задачи потеряются.

Критические подводные камни:
1. **fork() дублирует память** -- prefork pool наследует адресное пространство parent. Если модель загружена в parent (импорт на уровне модуля), каждый fork получает copy-on-write копию, но при первом inference copy-on-write триггерит полное копирование.
2. **max-memory-per-child=512MB** -- текущее значение. Child будет убит ПОСЛЕ выполнения задачи, если превысит 512MB. Но GLiNER2 сама по себе ~800MB -> child будет убит после КАЖДОЙ задачи -> постоянный restart -> модель загружается заново (30-60 сек) -> throughput падает катастрофически.
3. **max-tasks-per-child=100** -> каждые 100 задач child перезапускается -> модель загружается заново. С NLP-моделями это неприемлемо.
4. **PyTorch memory leaks** -- внутренние кэши не очищаются между вызовами. На 100+ inference calls memory растёт.

**Why it happens:**
Celery использует billiard (fork of multiprocessing) с prefork pool. Fork-based workers наследуют всё состояние parent process. PyTorch allocator не fork-safe: внутренние кэши дублируются, thread pools конфликтуют.

**How to avoid:**
1. **concurrency=1** -- один worker process, модели загружены один раз, нет fork overhead
2. **max-tasks-per-child=0** (бесконечно) -- не перезапускать child, модели persist в памяти
3. **max-memory-per-child=0** (отключить) -- мониторить через Netdata вместо kill-and-restart
4. **memory limit=4GB** для контейнера (с запасом: ~300MB Python + ~1.2GB GLiNER2 + ~500MB e5-small + ~20MB TF-IDF + ~2GB headroom)
5. **Lazy loading** -- загружать модели ТОЛЬКО в child process (не на уровне модуля):
   ```python
   # WRONG: загружается в parent при импорте
   model = GLiNER2.from_pretrained("fastino/gliner2-base-v1")

   # RIGHT: lazy singleton в child process
   _model = None
   def get_model():
       global _model
       if _model is None:
           _model = GLiNER2.from_pretrained("fastino/gliner2-base-v1")
       return _model
   ```
6. **torch.no_grad()** для inference -- предотвращает кэширование градиентов
7. **Мониторинг** через Netdata/Flower -- alert при >3.5GB

**Warning signs:**
- Celery worker container restarts в `docker compose logs celery-worker`
- OOM Killer в `dmesg` на хосте
- Задачи обработки книг зависают (worker убит mid-task)
- Flower показывает частые worker reconnect

**Phase to address:**
Первая фаза (Docker/infra) -- изменить compose limits. Вторая фаза (GLiNER2 integration) -- lazy loading, singleton pattern.

**Confidence:** HIGH
**Sources:**
- [celery/celery#6036](https://github.com/celery/celery/issues/6036) -- fork vs spawn issue
- [celery/celery#2927](https://github.com/celery/celery/issues/2927) -- prefork memory leak
- [PyTorch multiprocessing best practices](https://docs.pytorch.org/docs/stable/notes/multiprocessing.html) -- fork safety
- [celery/celery#4809](https://github.com/celery/celery/issues/4809) -- max-memory-per-child kills workers incorrectly
- Текущая конфигурация: `docker-compose.prod.yml:152-153`, `celery_app.py:28-31`

---

### Pitfall 3: GLiNER2 false positives на русских нарицательных существительных

**What goes wrong:**
GLiNER2 обучен на DeBERTa-v3 multilingual backbone с zero-shot NER. На русской художественной литературе модель:
1. **Классифицирует нарицательные как сущности:** "ведьмак" (lowercase, generic noun) -> PERSON. "трактир" -> LOCATION. "меч" -> OBJECT. Десятки false positives на книгу.
2. **Пропускает entities в диалогах:** речь внутри кавычек/тире часто содержит имена, но контекст (атрибуция "сказал он") находится ВНЕ чанка DeBERTa. Модель видит `-- Геральт придёт завтра, -- сказал Лютик.` но может не распознать "Геральт" если surrounding context обрезан chunking-ом.
3. **Boundary entities при chunking:** модель max 384 words (~512 subtokens). Русская глава ~30k символов -> ~15 чанков. Entity на границе чанков разрезается: "Геральт из" | "Ривии" -> две неполных сущности или пропуск.

**Why it happens:**
- DeBERTa pre-trained на news/Wikipedia, не на fiction. Нарицательные существительные в fiction часто являются names (Ведьмак = имя собственное в контексте). Модель не различает без fine-tuning.
- Русский не имеет обязательной заглавной буквы для определения proper nouns (в диалогах, после тире). В news domain заглавная буква -- сильный сигнал для NER; в fiction она менее надёжна.
- GLiNER paper (NAACL 2024) benchmark на CrossNER Literature дал F1=0.564 -- это значит ~44% ошибок. Хороший результат для zero-shot, но FAR from production-ready без пост-обработки.

**How to avoid:**
1. **Confidence threshold tuning:** начать с 0.5, поднять до 0.6-0.7 для снижения false positives. Мониторить precision/recall на 5 test-книгах.
2. **Post-processing rules:**
   - Отбрасывать entities < 3 символов
   - Отбрасывать entities из стоп-листа (нарицательные: "человек", "женщина", "старик", "дом", "город")
   - Merge частичных имён: "Геральт" + "Геральт из Ривии" -> longest match
3. **Overlap chunking:** 2-3 предложения overlap между чанками. Deduplicate entities по character offset.
4. **A/B тестирование на 5 книгах** с ручной разметкой: сравнить GLiNER2 entities vs текущие LLM entities. Go/No-Go: recall >= 80%.
5. **Fine-tuning path:** после накопления данных через A/B тесты (500+ verified entities) -- fine-tune GLiNER2 на fancai-специфичных данных через GLiNER2Trainer.

**Warning signs:**
- Entity count значительно выше LLM baseline (>2x) -- sign of false positives
- Много entities с confidence 0.4-0.6 -- пограничные случаи
- Entities типа "человек", "место", "вещь" в результатах

**Phase to address:**
Фаза GLiNER2 NER -- A/B тест обязателен. НЕ переключать pipeline без ручной проверки на минимум 5 книгах разных жанров.

**Confidence:** HIGH
**Sources:**
- [GLiNER EMNLP 2025](https://arxiv.org/html/2507.18546v1) -- Literature F1=0.564
- [Building a Fiction AST with GLiNER](https://justin.poehnelt.com/posts/building-a-fiction-ast-training-ner-gliner-onnx/) -- fiction-specific fine-tuning required
- [GLiNER GitHub #275](https://github.com/urchade/GLiNER/issues/275) -- max token length limitation
- Существующий research: `docs/research/rag-nlp-optimization-research.md` Section 2.2

---

### Pitfall 4: TF-IDF classifier data leakage через стиль автора

**What goes wrong:**
519 описаний в БД fancai -- из 8 книг. TF-IDF + LogisticRegression при random split по предложениям даёт F1 ~0.85-0.90 (на тесте). Но при деплое на новую книгу F1 падает до ~0.50-0.60. Модель выучила **стиль конкретных авторов**, а не паттерн "визуальное описание".

Три формы data leakage:
1. **Author style leakage:** 8 книг = 3-5 авторов. Если split по предложениям, train и test содержат предложения одного автора. Модель учит: "если лексика Толкина -> описание" вместо "если визуальные прилагательные -> описание".
2. **Class imbalance:** 519 positive (descriptions) vs сколько negative? Если negative сэмплов мало или они из тех же книг -- imbalance + leakage.
3. **Vocabulary overfitting:** 519 примеров -> TF-IDF vocabulary ~5000-10000 уникальных слов. При dim >> n_samples, LogisticRegression без сильной регуляризации переобучается.

**Why it happens:**
Классическая ошибка в NLP classification -- split по samples вместо split по документам/авторам. С 519 примерами из 8 книг это гарантированная проблема.

**How to avoid:**
1. **Leave-one-book-out cross-validation:** train на 7 книгах, test на 1. Повторить 8 раз. Средний F1 -- реальная оценка generalization.
2. **Negative sampling:** для каждого positive (description), взять 2-3 random предложения из той же главы как negative. Итого: ~519 positive + ~1500 negative = ~2000 samples.
3. **Сильная регуляризация:** LogisticRegression(C=0.1) или (C=0.01), не дефолтный C=1.0. TF-IDF с max_features=3000 (ограничить vocabulary).
4. **Go/No-Go:** если leave-one-book-out F1 < 0.70 -> не деплоить TF-IDF, переходить к sentence-transformer.
5. **Active learning:** low-confidence predictions (0.4-0.6) -> LLM верифицирует -> расширяет training set. Это **не опция, а необходимость** при 519 примерах.

**Warning signs:**
- Train F1 >> Test F1 (> 0.15 gap) -- overfitting
- Leave-one-book-out F1 значительно ниже random split F1
- Classifier уверенно предсказывает "description" для любого текста конкретного автора

**Phase to address:**
Фаза Description Classifier. Leave-one-book-out CV обязателен в acceptance criteria.

**Confidence:** HIGH
**Sources:**
- [Techniques and pitfalls for ML training with small data sets](https://www.trustbit.tech/blog/2021/06/30/techniques-and-pitfalls-for-ml-training-with-small-data-sets)
- Существующий research: `docs/research/rag-nlp-optimization-research.md` Section 4.2

---

### Pitfall 5: Feature flag inconsistency между старым и новым pipeline

**What goes wrong:**
Книги, обработанные текущим LLM pipeline, имеют entities с одной характеристикой (LLM-generated names, visual_summary, relationships). Книги, обработанные новым hybrid pipeline, будут иметь entities с другой (GLiNER2 names, no visual_summary до synthesis, no relationships до synthesis). Конкретные проблемы:
1. **Разный формат Entity Wiki:** старые entities имеют visual_summary и biography, новые -- только имя и тип до synthesis-фазы
2. **Несовместимые упоминания:** старый pipeline хранит text_offset из LLM (неточные), новый -- character offset из GLiNER2 (точные). Frontend highlighting может сломаться на старых данных.
3. **Reprocessing ambiguity:** если пользователь запрашивает reprocess книги, какой pipeline использовать? Если новый -- старые entities удаляются, но frontend может кэшировать старые.

**Why it happens:**
Feature flags контролируют pipeline ДЛЯ НОВЫХ книг, но не решают проблему уже обработанных книг. В БД нет маркера `extraction_pipeline` на entity/description -- невозможно отличить старые данные от новых.

**How to avoid:**
1. **Добавить колонку `pipeline_version`** в таблицы `entities` и `descriptions`:
   ```sql
   ALTER TABLE entities ADD COLUMN pipeline_version VARCHAR(20) DEFAULT 'llm_v1';
   ALTER TABLE descriptions ADD COLUMN pipeline_version VARCHAR(20) DEFAULT 'llm_v1';
   ```
   Новые записи hybrid pipeline -> `hybrid_v1`.
2. **НЕ удалять старые данные** при reprocessing. Создавать новые entities с `pipeline_version='hybrid_v1'`. Переключать отображение через pipeline_version filter.
3. **Frontend: version-aware rendering.** Если `pipeline_version='llm_v1'` -- использовать старый highlighting (fuzzy match). Если `hybrid_v1` -- использовать точные character offsets.
4. **Snapshot feature flags** в начале book processing task. Использовать snapshot для всего pipeline (не перечитывать из БД).
5. **Gradual rollout:** 10% новых книг -> hybrid, 90% -> LLM. Мониторить quality metrics.

**Warning signs:**
- Entity Wiki показывает пустые поля (visual_summary=null) для книг после переключения
- Highlighting descriptions не работает на книгах, обработанных hybrid pipeline
- Frontend кэш (IndexedDB) содержит stale entity data после reprocessing

**Phase to address:**
Первая фаза (schema migration) -- добавить `pipeline_version`. Каждая последующая фаза -- записывать version при создании entities/descriptions.

**Confidence:** HIGH
**Sources:**
- [Martin Fowler: Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
- Анализ кодовой базы: `backend/app/models/entity.py` -- нет pipeline_version колонки
- Анализ кодовой базы: `backend/app/services/feature_flag_manager.py`

---

### Pitfall 6: Docker image размер и build time с PyTorch CPU

**What goes wrong:**
Текущий backend image: ~468 MB. Добавление PyTorch + GLiNER2 + sentence-transformers + scikit-learn через default pip увеличит image до ~3.5 GB. Build time: 15-30 минут вместо 2-3 минут.

**Why it happens:**
`pip install torch` по умолчанию скачивает CUDA-версию (~2.5 GB). CPU-only через `--index-url https://download.pytorch.org/whl/cpu` -- ~300 MB. Разница 8x. Текущая конфигурация использует один Docker image для API и Celery worker -- API НЕ нуждается в PyTorch, но получит его.

**How to avoid:**
1. **CPU-only PyTorch index** в отдельном requirements-nlp.txt:
   ```
   --extra-index-url https://download.pytorch.org/whl/cpu
   torch==2.7.1+cpu
   gliner2==1.2.4
   sentence-transformers==4.1.0
   scikit-learn==1.7.0
   ```
2. **Отдельный Dockerfile.celery** для Celery worker с NLP зависимостями. Backend API остаётся на текущем Dockerfile.prod (~500 MB). Celery worker image ~1.5-2 GB.
3. **Docker build cache mount:**
   ```dockerfile
   RUN --mount=type=cache,target=/root/.cache/pip pip install ...
   ```
4. **HuggingFace model cache volume** -- модели (~300-500 MB) скачиваются один раз, не на каждый rebuild:
   ```yaml
   volumes:
     - hf_cache:/home/appuser/.cache/huggingface
   ```

**Warning signs:**
- `docker compose build` > 10 минут
- Disk usage растёт на 3+ GB за deploy
- `docker system df` > 20 GB build cache

**Phase to address:**
Первая фаза (Docker/infra) -- отдельный Dockerfile.celery, CPU-only PyTorch.

**Confidence:** HIGH
**Sources:**
- [Optimizing PyTorch Docker images](https://mveg.es/posts/optimizing-pytorch-docker-images-cut-size-by-60percent/)
- [Reducing Docker size with PyTorch](https://discuss.pytorch.org/t/reducing-docker-size-with-pytorch-model/78991)
- Текущий Dockerfile: `backend/Dockerfile.prod`

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Один Docker image для API и Celery | Проще build, один image | API image раздут PyTorch | Never -- разделить с первого дня |
| max-tasks-per-child=0 (бесконечно) | Модели persist в памяти | Memory leaks накапливаются | С мониторингом Netdata (alert >3.5GB) |
| Threshold GLiNER2 hardcoded | Быстрый старт | Нельзя тюнить без redeploy | MVP only -- в env var |
| Skip leave-one-book-out CV | Быстрее baseline | Overfitting не обнаружится до production | Never -- CV обязателен |
| Не маркировать pipeline_version | Меньше миграций | Невозможно rollback | Never -- обязательно |
| HF models без volume mount | Проще Dockerfile | Скачивание 300-500MB на каждый restart | Never -- volume mount |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pgvector + Alembic | `CREATE EXTENSION vector` без `IF NOT EXISTS` -- fails на re-run | `op.execute("CREATE EXTENSION IF NOT EXISTS vector")` |
| GLiNER2 + Celery | Импорт модели на уровне модуля | Lazy singleton в get_model(), загрузка в child process |
| PyTorch + billiard fork | Thread pool конфликтует после fork() | `torch.set_num_threads(1)` или concurrency=1 |
| sentence-transformers + GLiNER2 | Конфликт версий tokenizers | Pin `tokenizers` version, тест совместимости |
| TF-IDF model persistence | Serialized модели incompatible между sklearn versions | Сохранять sklearn version + retrain при upgrade |
| Feature flags + Celery | Async DB session в sync Celery context | Sync session (паттерн уже есть в book_tasks.py) |
| asyncpg + pgvector | asyncpg не знает vector type -> raw bytes | `pip install pgvector` -- авто-регистрация codec для SQLAlchemy + asyncpg |
| DeepSeek V3.2 structured output | JSON Schema mode менее надёжен чем у Gemini | Pydantic validation + retry + Gemini fallback через tenacity |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| GLiNER2 inference без batching | ~2-3 сек/чанк, 750 чанков = 25-40 мин/книга | Batch чанки главы, один forward pass | Книги > 30 глав |
| Embedding по одному чанку | 750 x 50ms = 37 сек | `model.encode(batch, batch_size=64)` | Книги > 100 глав |
| IVFFlat lists=100 на 500 vectors | recall деградация | HNSW вместо IVFFlat на малых данных | < 10000 embeddings |
| `text.split('.')` для sentence splitting | Теряет "г. Москва", аббревиатуры | `razdel` или spaCy ru_core_news_sm | Русские тексты |
| Обе модели загружаются при старте | startup 60-90 сек, healthcheck restart loop | Lazy load + start_period=120s | Cold start |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Model loading из untrusted source | Arbitrary code execution через serialized model | ТОЛЬКО HuggingFace Hub, pin revision hash |
| Raw EPUB content в LLM prompts | Prompt injection | Sanitize перед embedding/synthesis |
| Feature flag API без audit log | Unauthorized pipeline switch | Audit log для flag changes |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Entity Wiki пустой до synthesis | "Сломано" -- entities без описаний | Badge "Обрабатывается...", заполнять по мере synthesis |
| Reprocessing удаляет entities | Потеря привязок к заметкам | Soft delete + pipeline_version |
| Cold start model loading | Первая книга медленнее | Pre-warm при старте worker |
| Разное quality между книгами | Старые (LLM) vs новые (hybrid) | Gradual rollout + quality monitoring |

## "Looks Done But Isn't" Checklist

- [ ] **pgvector migration:** pg_dump/restore выполнен, но `CREATE EXTENSION vector` не в Alembic
- [ ] **GLiNER2:** Extraction работает, но chunking overlap не дедуплицирует entities -> duplicates
- [ ] **TF-IDF:** F1 высокий на random split, но leave-one-book-out CV не проведён
- [ ] **Feature flags:** USE_GLINER_NER=true, но pipeline_version не записывается -> rollback невозможен
- [ ] **Docker:** PyTorch установлен, но CUDA-версия -> image 3.5GB вместо 1.5GB
- [ ] **Celery memory:** limits 4GB, но max-memory-per-child=512000 не изменён -> child kills
- [ ] **Embeddings:** e5-small работает, но IVFFlat lists=100 на 500 vectors -> recall < 50%
- [ ] **Rollback:** Flags off, но entities hybrid_v1 остаются в БД -> mixed data
- [ ] **Healthcheck:** Celery inspect ping timeout=10s, model loading 60s -> false restart

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| pgvector data loss (Alpine->Debian) | LOW (при backup) | pg_restore, revert image |
| Celery OOM crash loop | LOW | Revert limits, `--concurrency=1 --max-tasks-per-child=0` |
| GLiNER2 low quality | MEDIUM | Flag off, DELETE WHERE pipeline_version='hybrid_v1' |
| TF-IDF overfitting | LOW | Flag off, revert на LLM |
| Pipeline inconsistency (no version) | HIGH | Ручная маркировка по created_at. С version -- LOW |
| Docker image bloat | LOW | Rebuild CPU-only, `docker system prune` |
| Model loading timeout | LOW | Увеличить start_period, pre-warm task |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| PG Alpine->Debian data loss | Phase 0 (Infra) | pg_restore OK, table counts match, `pg_extension` has vector |
| Celery worker OOM | Phase 0 (Infra) | 1 час под нагрузкой, memory < 3.5GB |
| GLiNER2 false positives | Phase 1 (NER) | A/B 5 книг: recall >= 80%, precision >= 60% |
| TF-IDF data leakage | Phase 2 (Classifier) | Leave-one-book-out F1 >= 0.70, gap < 0.15 |
| Feature flag inconsistency | Phase 0 (Infra) | pipeline_version в Alembic, записывается на CREATE |
| Docker image bloat | Phase 0 (Infra) | Celery image < 2GB, build < 10 min |
| Chunking boundaries | Phase 1 (NER) | Overlap test на 3 книгах, no split entities |
| Model loading timeout | Phase 1 (NER) | Cold start < 120s, healthcheck start_period=120s |
| pgvector index | Phase 4 (Embeddings) | Top-5 retrieval recall >= 80% |

## Sources

- [docker-library/postgres #1192](https://github.com/docker-library/postgres/discussions/1192) -- Alpine vs Debian data incompatibility
- [docker-library/postgres PR #1259](https://github.com/docker-library/postgres/pull/1259) -- PGDATA changes
- [celery/celery#6036](https://github.com/celery/celery/issues/6036) -- fork vs spawn
- [celery/celery#2927](https://github.com/celery/celery/issues/2927) -- prefork memory leak
- [celery/celery#4809](https://github.com/celery/celery/issues/4809) -- max-memory-per-child
- [PyTorch multiprocessing](https://docs.pytorch.org/docs/stable/notes/multiprocessing.html)
- [pytorch/pytorch#174468](https://github.com/pytorch/pytorch/issues/174468) -- memory leak
- [GLiNER EMNLP 2025](https://arxiv.org/html/2507.18546v1) -- Literature F1=0.564
- [Fiction AST with GLiNER](https://justin.poehnelt.com/posts/building-a-fiction-ast-training-ner-gliner-onnx/)
- [GLiNER#275](https://github.com/urchade/GLiNER/issues/275) -- token length
- [Martin Fowler: Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
- [PyTorch Docker optimization](https://mveg.es/posts/optimizing-pytorch-docker-images-cut-size-by-60percent/)
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector)
- [Small dataset ML pitfalls](https://www.trustbit.tech/blog/2021/06/30/techniques-and-pitfalls-for-ml-training-with-small-data-sets)
- Кодовая база: docker-compose.prod.yml, celery_app.py, Dockerfile.prod, requirements.txt, book_tasks.py, entity.py, feature_flag_manager.py
- Existing research: `docs/research/rag-nlp-optimization-research.md`

---
*Pitfalls research for: Hybrid NLP Pipeline в Production (fancai v1.4)*
*Researched: 2026-03-24*
