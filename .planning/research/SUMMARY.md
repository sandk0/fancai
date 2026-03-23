# Сводное исследование проекта

**Проект:** fancai v1.4 — Гибридный NLP pipeline
**Домен:** ML/NLP pipeline для AI-ридера художественной литературы
**Исследовано:** 2026-03-24
**Уверенность:** HIGH

## Обзор

Текущий fancai pipeline обрабатывает каждую книгу целиком через LLM (Gemini 3 Flash) — стоимость ~$1.50/книга, время 5-15 минут. Гибридная архитектура заменяет LLM-based extraction на локальные NLP-модели (GLiNER2 NER + TF-IDF classifier), оставляя LLM только для synthesis (~3 вызовов на книгу). Итоговая экономия: 97-99% стоимости ($0.02/книга). Ключевая особенность подхода: все компоненты интегрируются через feature flags — текущий LLM pipeline остается fallback, переключение — один SQL UPDATE.

Основной технический риск — не качество NLP (GLiNER2 Literature F1=0.564 верифицирован по EMNLP 2025), а инфраструктурная сложность: смена PostgreSQL image (Alpine -> Debian) несовместима на уровне data directory, что требует полного pg_dump/restore. Второй по критичности риск — Celery worker OOM при неправильных настройках concurrency и memory limits. Оба риска хорошо задокументированы и имеют конкретные mitigation-паттерны.

Рекомендуемая стратегия реализации: инфраструктура первой (Docker + Alembic + feature flags), затем NER и description classifier как независимые компоненты, pgvector embeddings как quality-enhancement после валидации основного pipeline. Обязательный Go/No-Go gate после NER-фазы: entity recall >= 80% на 5 тестовых книгах.

---

## Ключевые выводы

### Рекомендуемый стек

Исследование верифицирует пять новых зависимостей. PyTorch должен устанавливаться **только** CPU-версией через отдельный index URL — CUDA-версия добавляет +2 GB к image без пользы. Celery worker требует отдельного Dockerfile с NLP-зависимостями; API-контейнер остается легким (~500 MB).

**Основные технологии:**
- **GLiNER2 1.2.4** — zero-shot NER для fiction. F1=0.564 на Literature domain (> GPT-4o 0.561). 205M params, CPU-first, детерминированные character offsets. Python 3.12 совместим.
- **torch 2.11.0+cpu** — runtime для GLiNER2. Устанавливать ТОЛЬКО через `--index-url https://download.pytorch.org/whl/cpu` (CPU wheel ~250 MB vs CUDA ~2.5 GB).
- **sentence-transformers 5.3.0** — embedding API для pgvector. Стартовая модель: `intfloat/multilingual-e5-small` (118M, 384 dims, ~500 MB RAM).
- **scikit-learn 1.8.0** — TF-IDF + LogisticRegression description classifier. <1ms/sentence, ~5 MB модель.
- **pgvector/pgvector:pg17 (0.8.2)** — Docker image для PostgreSQL 17 + pgvector. Debian-based (не Alpine). Требует полной миграции данных из текущего postgres:17.9-alpine.
- **DeepSeek V3.2 через OpenRouter** ($0.26/$0.38) — primary model для LLM synthesis. Output в 8x дешевле Gemini 3 Flash. Fallback: Gemini 3.1 Flash Lite -> Claude Haiku 4.5.

**Критичное: бюджет RAM** Celery worker 4 GB. При e5-small: ~1.9-2.3 GB, headroom ~1.7 GB. При upgrade на ru-en-RoSBERTa (400M): ~3.1-3.5 GB — на грани, допустимо.

### Ожидаемые фичи

Пять целевых фич имеют чёткую иерархию зависимостей. GLiNER2 NER и Description Classifier работают независимо. pgvector embeddings зависят от Docker infrastructure. LLM batch synthesis использует pgvector как контекст для quality enhancement, но может работать и без него (fallback на полный текст).

**Обязательные (P0-P1):**
- GLiNER2 NER с chunking (512 token limit) и boundary deduplication — ядро экономии
- NEREntity -> ExtractedEntity adapter — backward compatibility с ConsistencyManager
- Feature flags: USE_HYBRID_NLP, USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_PGVECTOR_EMBEDDINGS
- Docker infrastructure: pgvector image + Celery 4 GB / concurrency=1
- Description classifier TF-IDF (519 labeled examples в БД — готовый training set)
- LLM batch synthesis через DeepSeek V3.2 (1 вызов на книгу вместо per-chapter)
- A/B тест на 5 книгах как обязательный Go/No-Go gate

**Quality enhancement (P2):**
- pgvector embeddings (chapter_embeddings table) — rich context для synthesis
- Embedding-based alias detection — дополняет SequenceMatcher для entity dedup

**Defer до валидации (P3):**
- Active learning для classifier
- ONNX conversion для GLiNER2
- Co-occurrence графы
- Cost monitoring dashboard
- Incremental WebSocket progress

**Anti-features (не реализовывать):**
- Self-hosted LLM (2-5 tok/sec на CPU — неприемлемо)
- BART-large-mnli zero-shot classifier (800M + 20+ мин/книга на CPU)
- GigaEmbeddings 3B (6 GB — не влезает рядом с GLiNER2)
- Fine-tuning GLiNER2 сейчас (только 8 книг — недостаточно)
- LangChain/LlamaIndex (overhead без пользы при 3 LLM вызовах)

### Архитектурный подход

Гибридный pipeline строится как drop-in замена: `HybridExtractor.analyze_chapter()` возвращает тот же `ChapterAnalysisResult`, что и `gemini_extractor.analyze_chapter()`. Весь downstream code (ConsistencyManager, entity events, descriptions) не меняется. Ключевой паттерн: `NLPModelManager` — singleton lifecycle manager для всех NLP-моделей в Celery worker.

**Основные компоненты:**
1. **NERService** (`services/ner_service.py`) — GLiNER2 extraction с sentence-level chunking, overlap 2 предложения, boundary deduplication по character offsets
2. **DescriptionClassifier** (`services/description_classifier.py`) — TF-IDF + LogReg с leave-one-book-out cross-validation
3. **EmbeddingService** (`services/embedding_service.py`) — batch encode чанков по 500 символов -> pgvector INSERT
4. **NLPModelManager** (`services/nlp_model_manager.py`) — lazy singleton для всех трёх моделей; загрузка при первом использовании, persist до рестарта worker
5. **HybridExtractor** (`services/hybrid_extractor.py`) — orchestrator, drop-in замена gemini_extractor, возвращает ChapterAnalysisResult
6. **Adapter layer** — маппинг `NEREntity(text, label, start, end, score)` -> `ExtractedEntity(name, type, confidence, first_mention_offset)`. `visual_summary`, `aliases`, `chapter_event_*` заполняются позже в synthesis phase.

**Изменения схемы БД:** новые nullable поля `extraction_source` (DEFAULT 'llm') и `ner_confidence` в `entities`; аналогично в `descriptions`. Таблица `chapter_embeddings` (vector(384)). Колонка `pipeline_version` для rollback traceability.

**Неизменяемые компоненты:** gemini_extractor.py (fallback), tsa_parser.py, весь frontend, openrouter_client.py, graph_service.py, entity_service.py API.

### Критичные pitfalls

1. **PostgreSQL Alpine -> Debian data incompatibility** — musl libc vs glibc collation несовместимость. Если просто заменить image с тем же volume — база может не стартовать или давать некорректные ORDER BY на русском тексте. **Решение:** pg_dump -> удалить volume -> запустить pgvector image -> pg_restore. Сначала всего остального.

2. **Celery worker OOM с PyTorch prefork** — concurrency=2 при fork-based pool дублирует модели в памяти. `max-memory-per-child=512MB` убивает child после КАЖДОЙ задачи (GLiNER2 ~800 MB > 512 MB). **Решение:** `--concurrency=1 --max-tasks-per-child=0 --max-memory-per-child=0`, memory limit 4 GB, lazy singleton loading.

3. **GLiNER2 false positives на нарицательных существительных** — "ведьмак" (нарицательное) -> PERSON. Boundary entities при chunking разрезаются. **Решение:** confidence threshold 0.5+, стоп-лист нарицательных, overlap chunking с dedup по character offset, обязательный A/B тест 5 книг до rollout.

4. **TF-IDF data leakage через стиль автора** — random split по предложениям из 8 книг даёт F1 0.85-0.90, при деплое на новую книгу падает до 0.50-0.60. **Решение:** leave-one-book-out cross-validation обязателен. Go/No-Go: F1 >= 0.70 на LOO CV, иначе переход на sentence-transformer head.

5. **Feature flag pipeline inconsistency без pipeline_version** — старые LLM entities и новые hybrid entities смешиваются без маркера. **Решение:** `extraction_source` в schema (DEFAULT 'llm'), записывать 'gliner2'/'hybrid' при создании. Soft delete при reprocessing, не hard delete.

6. **Docker image bloat с CUDA PyTorch** — `pip install torch` без index URL = ~2.5 GB CUDA wheels. **Решение:** отдельный `Dockerfile.celery` с `--index-url https://download.pytorch.org/whl/cpu`, CPU wheel ~250 MB. HuggingFace models в volume mount (не пересчитывать при каждом rebuild).

---

## Импликации для дорожной карты

Исследование показывает 5 естественных фаз. Первые 2 — инфраструктурные blockers, остальные — реализация компонентов. Фазы 3 и 4 могут разрабатываться параллельно (NER и classifier независимы).

### Фаза 0: Docker & DB Infrastructure
**Обоснование:** Все блокеры первые. PostgreSQL migration должна пройти до любого NLP-кода. Celery limits надо установить до добавления PyTorch. pipeline_version в schema — до первой hybrid-записи в БД.
**Delivers:** pgvector/pgvector:pg17 запущен, данные мигрированы, Celery worker 4 GB / concurrency=1, Alembic migration с vector extension + chapter_embeddings + extraction_source поля, 4 новых feature flags (все default: false), отдельный Dockerfile.celery.
**Avoids:** Pitfall 1 (PG data loss), Pitfall 2 (Celery OOM), Pitfall 5 (pipeline inconsistency), Pitfall 6 (Docker bloat).

### Фаза 1: GLiNER2 NER Service
**Обоснование:** Самая высокая экономия (~70% LLM вызовов). Независима от Description Classifier. Требует завершения Фазы 0.
**Delivers:** NERService с chunking (<=2000 chars, 2-sentence overlap) и boundary dedup; NLPModelManager singleton; NEREntity -> ExtractedEntity adapter; HybridExtractor skeleton; USE_GLINER_NER flag on; **обязательный A/B тест на 5 книгах**: entity recall >= 80% vs LLM baseline.
**Uses:** gliner2 1.2.4, torch CPU, NLPModelManager pattern.
**Avoids:** Pitfall 3 (GLiNER2 false positives через threshold + stoplist + A/B gate).

### Фаза 2: Description Classifier
**Обоснование:** Независима от NER — может разрабатываться параллельно с Фазой 1. 519 labeled examples уже в БД. TF-IDF baseline быстрее sentence-transformer upgrade. Завершается перед LLM synthesis optimization.
**Delivers:** Export training data (519 positive + ~1500 negative с per-book split); TF-IDF + LogReg с leave-one-book-out CV; USE_DESCRIPTION_CLASSIFIER flag on; F1 >= 0.70 на LOO CV или upgrade на sentence-transformer.
**Avoids:** Pitfall 4 (data leakage через per-book split и LOO CV как acceptance criteria).

### Фаза 3: LLM Synthesis Optimization
**Обоснование:** После NER (Фаза 1) и Classifier (Фаза 2) — pipeline производит entities и descriptions. Synthesis optimization (batch vs per-chapter, DeepSeek vs Gemini) снижает LLM стоимость с ~$1.50 до ~$0.02.
**Delivers:** Один batch LLM вызов на книгу; DeepSeek V3.2 как primary с fallback chain; ConsistencyManager + EntityDeduplicationService адаптированы под hybrid input; EntitySynthesisService обновлён для batch input.
**Uses:** DeepSeek V3.2 ($0.26/$0.38), OpenRouter fallback chain.

### Фаза 4: pgvector Embeddings
**Обоснование:** Quality enhancement после валидации основного pipeline. Embeddings позволяют передавать релевантные чанки в synthesis вместо полного текста — снижает input tokens и повышает quality.
**Delivers:** EmbeddingService с e5-small (118M); chapter_embeddings HNSW index; vector search для entity context в synthesis (top-5 chunks); upgrade path на ru-en-RoSBERTa задокументирован.
**Uses:** sentence-transformers 5.3.0, pgvector HNSW index (vector_cosine_ops).

### Фаза 5: Optimization & Rollout
**Обоснование:** После валидации всего pipeline — постепенный rollout с мониторингом cost/quality.
**Delivers:** Canary rollout (10% -> 50% -> 100%); per-book cost tracking через llm_usage_log; active learning цикл для classifier; ONNX conversion если inference bottleneck подтвержден.

### Обоснование порядка фаз

- **Фаза 0 сначала:** PostgreSQL migration — необратимый destructive operation. Нельзя начинать NLP-код при риске потери production data.
- **NER перед Classifier:** NER — главная экономия, высокий приоритет. Независимость позволяет параллельную разработку, но A/B NER gate должен пройти до GA synthesis optimization.
- **Synthesis после extraction:** batch synthesis требует заполненных entity/description данных от hybrid extraction.
- **pgvector последним из "основных":** не блокирует savings — synthesis работает без vector context (fallback на полный текст), но качество ниже.

### Research Flags

Фазы, требующие дополнительного исследования при планировании:
- **Фаза 1 (NER):** chunking стратегия для русской fiction, оптимальный chunk_size (100 vs 250 tokens), sentence boundary detection (razdel vs spaCy ru_core_news_sm)
- **Фаза 3 (Synthesis):** ConsistencyManager compatibility с NEREntity input, batch synthesis prompt engineering для DeepSeek V3.2

Фазы со стандартными паттернами (research-phase необязателен):
- **Фаза 0 (Infra):** pg_dump/restore — стандартная операция, Docker compose — хорошо задокументировано
- **Фаза 2 (Classifier):** TF-IDF + LogReg — учебный паттерн, конкретные шаги известны

---

## Оценка уверенности

| Область | Уверенность | Примечания |
|---------|------------|------------|
| Stack | HIGH | Все версии верифицированы по PyPI, Docker Hub, OpenRouter на 2026-03-24 |
| Features | HIGH | Верифицировано по GLiNER2 EMNLP 2025, аудит кодовой базы SSH, 519 examples подсчитаны |
| Architecture | HIGH | Основано на аудите реального кода (book_tasks.py, consistency_manager.py, feature_flag_manager.py) |
| Pitfalls | HIGH | Подтверждено официальными Docker, Celery, PyTorch source + GitHub issues |

**Общая уверенность:** HIGH

### Пробелы для проработки

- **GLiNER2 latency на production EPYC 9645** — оценка 100-200ms/chunk теоретическая, нужен бенчмарк в реальных условиях. Влияет на решение о batch size и concurrency.
- **TF-IDF F1 на fancai данных** — диапазон 0.65-0.80 оценочный. Реальное значение определяется в Фазе 2 через LOO CV. Если F1 < 0.70 — автоматический переход на sentence-transformer head.
- **PostgreSQL collation risk** — исследование утверждает несовместимость Alpine/Debian. Внутренняя документация Docker подтверждает риск, но конкретный PG 17 на production может вести себя иначе. **Mitigation:** pg_dump перед любыми изменениями, независимо от теории.
- **DeepSeek V3.2 structured output quality** — маркетинговое утверждение "GPT-5 class". Реальное качество synthesis для русской fiction неизвестно. **Mitigation:** Pydantic validation + tenacity retries + Gemini fallback.

---

## Источники

### Первичные (HIGH confidence)
- [GLiNER2 EMNLP 2025 paper](https://arxiv.org/html/2507.18546v1) — F1 benchmarks, Literature domain, architecture
- [gliner2 v1.2.4 PyPI](https://pypi.org/project/gliner2/) — версия, Python requirements
- [torch v2.11.0 PyPI](https://pypi.org/project/torch/) — версия, CPU wheel availability
- [sentence-transformers v5.3.0 PyPI](https://pypi.org/project/sentence-transformers/) — Python/torch requirements
- [pgvector 0.8.2 release](https://www.postgresql.org/about/news/pgvector-082-released-3245/) — CVE fix, PG17 support
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) — Debian-based images
- [DeepSeek V3.2 OpenRouter](https://openrouter.ai/deepseek/deepseek-v3.2) — $0.26/$0.38, 164K context, проверено 2026-03-24
- [docker-library/postgres Discussion #1192](https://github.com/docker-library/postgres/discussions/1192) — Alpine/Debian data incompatibility
- [PyTorch multiprocessing docs](https://docs.pytorch.org/docs/stable/notes/multiprocessing.html) — fork safety
- [celery/celery#6036](https://github.com/celery/celery/issues/6036), [#2927](https://github.com/celery/celery/issues/2927) — fork/memory issues
- Кодовая база fancai: аудит через SSH (book_tasks.py, docker-compose.prod.yml, feature_flag_manager.py, entity.py)

### Вторичные (MEDIUM confidence)
- [ru-en-RoSBERTa HuggingFace](https://huggingface.co/ai-forever/ru-en-RoSBERTa) — 400M params, 1024 dims
- [ruMTEB NAACL 2025](https://aclanthology.org/2025.naacl-long.12/) — Russian embedding benchmarks
- Существующее исследование: `docs/research/rag-nlp-optimization-research.md` (2026-03-23)
- Аудит: `docs/research/rag-nlp-optimization-audit.md`

### Третичные (LOW confidence — требует валидации)
- DeepSeek V3.2 "GPT-5 class quality" — маркетинг, требует тестирования на fiction synthesis
- GLiNER2 latency ~100-200ms на EPYC 9645 — теоретическая оценка
- TF-IDF F1 0.65-0.80 на 519 examples — теоретическая оценка

---
*Исследование завершено: 2026-03-24*
*Готово для дорожной карты: да*
