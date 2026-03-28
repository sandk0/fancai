# Промпт: Глубокий аудит + расширенное исследование оптимизации AI-пайплайна fancai

> **Модель:** Claude Opus 4.6 (1M Context)  
> **Дата:** 2026-03-23  
> **Язык отчёта:** русский  
> **Входные файлы:**
> - Аудируемый отчёт: `/docs/research/rag-nlp-optimization-research.md`
> - Оригинальное ТЗ: `/docs/research/PROMPT-rag-nlp-optimization-research.md`
> - Предыдущий аудит (reference): `/docs/research/rag-nlp-optimization-audit.md`
> **Результат:** файл `/docs/research/rag-nlp-optimization-audit-v2.md`

---

## Роль

Ты — principal ML/NLP архитектор с опытом production NER, RAG-систем и оптимизации LLM-пайплайнов. Тебе поручен **экспертный аудит** исследовательского отчёта по миграции AI-пайплайна обработки книг с LLM-only на гибридную NER+LLM архитектуру.

---

## Ключевые правила выполнения

### Поиск в вебе

- **Каждое фактическое утверждение** из отчёта верифицируй через свежий поиск. НЕ подтверждай факты из памяти — только с URL-источником.
- На каждую тему/модель/инструмент делай **минимум 2-3 отдельных поиска** с разных углов (PyPI, HuggingFace, GitHub releases, benchmarks, pricing pages).
- Ищи **на русском И на английском** — русскоязычные NLP-бенчмарки часто публикуются отдельно.
- Для каждого поиска сохраняй URL и дату доступа для раздела «Источники».
- При обнаружении расхождения с отчётом — приводи точную цитату из источника (≤20 слов) и URL.

### SSH-аудит инфраструктуры

Подключись к серверу **`ssh fancai`** и выполни полное исследование:

```bash
# 1. Железо
uname -a
lscpu | head -25
free -h
df -h /
cat /proc/cpuinfo | grep "model name" | head -1

# 2. Docker — все контейнеры
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | head -20
docker system df

# 3. Docker Compose — полные конфигурации
cat /opt/fancai/app/docker-compose.prod.yml
cat /opt/fancai/app/docker-compose.monitoring.yml

# 4. PostgreSQL
# (Внутри контейнера используй: docker exec fancai_postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "..."')
# Проверить:
#   - Установленные extensions (pg_available_extensions WHERE name LIKE '%vector%')
#   - Размер БД (pg_database_size)
#   - Размеры таблиц (pg_stat_user_tables)
#   - Количество entities, descriptions, books, chapters
#   - PostgreSQL версию и параметры (shared_buffers, work_mem, etc.)

# 5. Backend-контейнер
docker exec fancai_backend python --version
docker exec fancai_backend pip list 2>/dev/null | grep -iE 'spacy|natasha|gliner|torch|transformers|sentence|onnx|sklearn|pgvector'
docker exec fancai_backend cat /etc/os-release | head -3
docker images fancai-backend --format '{{.Size}}'

# 6. Celery worker
docker exec fancai_celery ps aux | grep celery
# Проверить: concurrency, max-memory-per-child, prefetch-multiplier

# 7. Сеть и /dev/shm
docker exec fancai_celery df -h /dev/shm
docker exec fancai_backend df -h /dev/shm

# 8. Redis
docker exec fancai_redis redis-cli INFO memory | head -10
```

**Цель SSH-аудита:** составить полную карту ресурсов для расчёта бюджета NLP-моделей. Определить конкретные ограничения (memory limits, CPU limits, отсутствующие extensions, версии Python/OS).

---

## Часть 1: Верификация фактов

Для каждого утверждения из отчёта — проверь через поиск и поставь вердикт:
- ✅ **Верно** — подтверждено поиском, данные актуальны
- ⚠️ **Неточно** — частично верно, требует уточнения
- ❌ **Ошибка** — фактически неверно, приведи корректные данные

### 1.1 Ценообразование LLM (каждую цену — отдельным поиском)

Для каждой модели ниже: зайди на страницу OpenRouter (openrouter.ai/google/..., openrouter.ai/anthropic/...) и проверь input/output pricing:

| Утверждение | Что проверить |
|---|---|
| Gemini 3 Flash Preview: $0.50/$3.00 | openrouter.ai/google/gemini-3-flash-preview |
| Gemini 3.1 Flash Lite Preview: $0.25/$1.50 | openrouter.ai/google/gemini-3.1-flash-lite-preview |
| Gemini 2.0 Flash Lite: $0.075/$0.30 | Проверить доступность + deprecation timeline |
| Claude Haiku 4.5: $1.00/$5.00 | openrouter.ai/anthropic/claude-haiku-4.5 И anthropic.com/pricing |
| OpenRouter «без наценки» | openrouter.ai/pricing — проверить markup policy |
| Gemini Batch API 50% скидка | ai.google.dev/gemini-api/docs/pricing — проверить доступность для Flash 3 |

**Дополнительный поиск:** есть ли новые модели дешевле Gemini 3.1 Flash Lite, вышедшие после написания отчёта? (Qwen, DeepSeek, Mistral через OpenRouter)

### 1.2 Стоимостная модель — пересчёт с нуля

Пересчитай **каждую строку** с актуальными ценами из п.1.1:

**Текущий pipeline (all-LLM):**
- Extraction (TSA): input = 375k tokens (текст глав), output = ? (⚠️ TSA возвращает tagged_text ≈ input size + entities JSON + relationships JSON — пересчитай output tokens)
- Entity Deduplication: input ≈ ?, output ≈ ?
- Entity Synthesis: input ≈ ?, output ≈ ?
- При fallback на Haiku 4.5: пересчитай

**Гибридный pipeline:**
- Каждый LLM-компонент: конкретные input/output token counts → cost при Gemini 3.1 Flash Lite

**Проверь арифметику до копейки.** Ошибки в стоимостной модели критичны — на них строится бизнес-кейс миграции.

### 1.3 GLiNER / GLiNER2

Для каждого пункта — отдельный поиск:

| Утверждение | Что искать |
|---|---|
| GLiNER2 v1.2.4 (Jan 2026) | pypi.org/project/gliner2/ — актуальная версия |
| GLiNER v0.2.25 (Feb 2026) | pypi.org/project/gliner/ — актуальная версия |
| GLiNER2 205M параметров | HuggingFace fastino/gliner2-base-v1 — model card |
| «CPU-first, no GPU required» | Реальные benchmarks inference time на CPU (какой CPU, ms/sentence) |
| DeBERTa max 512 tokens | Подтверждение в документации |
| Zero-shot NER quality на русском | Есть ли бенчмарки конкретно на Russian text? |
| `fastino/gliner2-base-v1` — мультиязычная? | Подтверждение поддержки русского |
| GLiNER2 Relation Extraction | Как работает, какое качество, нужен ли? |
| Совместимость с Python 3.12 | pypi.org — Requires-Python |
| gliner-spacy chunking | Как работает автоматический chunking для длинных текстов |
| ONNX conversion для GLiNER2 | Поддерживается ли? Насколько быстрее? |

**Найди минимум 3 альтернативных NER-модели**, не упомянутых в отчёте, которые:
- Поддерживают русский язык
- Работают на CPU
- Выпущены или обновлены в Q4 2025 – Q1 2026

### 1.4 Natasha / Slovnet / Coref

| Утверждение | Что проверить |
|---|---|
| Slovnet F1 88-90% (PER), 82-85% (LOC) | github.com/natasha/naeval — реальные таблицы |
| Navec обучен на Taiga корпусе | github.com/natasha/navec — README |
| Natasha coref «экспериментальный» | Последний commit, release, issues |
| Проект «малоактивен с 2021» | GitHub activity, PyPI releases |
| SOTA для русского coref — F1 65-70% | Поиск: "russian coreference resolution 2025 2026 SOTA" |

### 1.5 Embedding модели

| Утверждение | Что проверить |
|---|---|
| e5-small: 118M params, 384 dims | HuggingFace intfloat/multilingual-e5-small |
| «100% Top-5 accuracy» — из Amazon Health | Найти оригинальный бенчмарк, подтвердить контекст |
| ruMTEB лидерборд | Поиск: "ruMTEB benchmark leaderboard 2025 2026" — кто лидирует для русского? |
| CPU inference ~30-80ms/sentence (batch 32) | Бенчмарки на AMD EPYC, не на ноутбуке |
| BGE-M3 как альтернатива (2 GB RAM) | Размер, dims, русский performance |

---

## Часть 2: Расширенное исследование — горизонтальное

По каждому направлению проведи **минимум 3 поиска в вебе** и составь таблицу сравнения.

### 2.1 NER-модели и подходы (пропущенные в отчёте)

Исследуй каждую из следующих моделей/подходов:

**Модели:**
- Stanza (Stanford NLP) — русские модели, F1, CPU performance
- NuNER / UniNER — статус в 2026, applicability
- RoBERTa Large NER Russian (HuggingFace `ai-forever/ruRoBERTa-large`) — NER fine-tunes
- spaCy 3.8+ с transformer backend для русского
- DeepPavlov NER 2025-2026 updates
- **Любые новые модели из arxiv/HuggingFace за последние 6 месяцев**

**Подходы:**
- Fine-tuning GLiNER2 на данных fancai (519 descriptions, 274 entities) — feasibility?
- Few-shot NER через sentence-transformers (embed → cluster → classify)
- GLiNER2 multi-task: одновременно NER + description classification?

Для каждой модели: **таблица** (модель, размер, F1 русский, F1 fiction, CPU ms/sentence, RAM, Python compat).

### 2.2 Entity Wiki: дополнительные подходы

- **GraphRAG / LightRAG / nano-graphrag** — подходят ли для fiction? CPU-friendly? Cost?
- **BookNLP** (David Bamman) — character extraction, quote attribution. Русская версия?
- **Character Network Analysis** — co-occurrence graphs без LLM. Библиотеки? Примеры?
- **Cross-book entity linking** — серии книг, один персонаж в нескольких томах. Embedding similarity?
- **Incremental processing** — Phase 1 (NER) per-chapter, Phase 2 (synthesis) batch. Архитектурные последствия?

### 2.3 Description Extraction: дополнительные подходы

- **TextRank / RAKE / YAKE** — extractive summarization. Подходят ли для описаний?
- **Zero-shot classification** (BART-large-mnli / XLM-R) — «is this a visual description?» на русском. Latency на CPU?
- **Sentence embeddings + clustering** (HDBSCAN) — кластеризация «визуальных» предложений
- **LLM distillation** — обучить маленькую модель на output существующего LLM-пайплайна (519 описаний = ready dataset)
- **Multi-sentence handling** — sliding window, paragraph merging, SpanBERT

### 2.4 LLM-оптимизация: дополнительные подходы

- **Gemini Context Caching через OpenRouter** — поддерживается ли? Как активировать? Расчёт экономии
- **Prompt compression** (LLMLingua 2, AutoCompressor) — применимо ли к fiction text extraction?
- **Prompt tiering** — разные модели для разных subtasks:
  - Description enrichment → самая дешёвая (Gemini 3.1 Flash Lite)
  - Entity synthesis → средняя (Gemini 3 Flash)
  - Alias resolution → средняя
  - Текущий fallback chain → оптимизировать
- **Gemini Batch API** — прямой ключ Google vs OpenRouter. Стоимость миграции?
- **Claude Batch API** — 50% скидка. Подходит для synthesis?
- **Кросс-книжное кэширование** — серии, авторы. Как реализовать?

### 2.5 Инфраструктура: новые находки

На основе SSH-аудита (часть 0) определи:

- **Memory budget для NLP**: конкретный расчёт — сколько GB свободно для моделей после учёта всех container limits и OS needs
- **CPU budget**: сколько vCPU реально свободно, какие concurrency settings оптимальны
- **Docker image size impact**: текущий backend 468 MB → сколько с PyTorch CPU + GLiNER2 + sentence-transformers?
- **Model download strategy**: при docker build или при первом запуске? HuggingFace cache volume?
- **Celery architecture**: один worker с моделями в памяти vs отдельный NLP microservice
- **PG image migration**: конкретный план перехода на pgvector/pgvector:pg17 без потери данных
- **Monitoring**: как отслеживать NLP inference time, memory, quality (Netdata + VictoriaMetrics уже есть)

---

## Часть 3: Углублённое исследование — вертикальное

### 3.1 GLiNER2: production-ready оценка

Проведи полное исследование:

1. **Модели на HuggingFace**: найди ВСЕ модели под `fastino/` и `urchade/`. Для каждой: размер, языки, задачи, benchmarks
2. **Inference на AMD EPYC**: найди или extrapolate реальные ms/sentence для 12 vCPU AMD EPYC 9645
3. **Chunking strategies**: как GLiNER2 обрабатывает текст >512 tokens? Built-in или custom?
4. **Error modes**: типичные false positives и false negatives. Как ведёт себя на fiction (имена с заглавной vs нарицательные)?
5. **Fine-tuning**: формат данных для `GLiNER2Trainer`, минимальный dataset size, время обучения на CPU
6. **Integration patterns**: как другие проекты используют GLiNER2 в production (search GitHub, Medium, blog posts)
7. **Comparison table**: GLiNER2 vs GLiNER1 vs spaCy vs DeepPavlov vs LLM-NER — по 8+ метрикам

### 3.2 Description Classifier: полный дизайн

1. **Training data extraction**: SQL-запросы для export из fancai DB (таблица descriptions → positive, chapters без descriptions → negative)
2. **Cross-validation**: split по book_id для избежания data leakage через стиль автора
3. **Model selection**: TF-IDF baseline vs MiniLM classifier vs GLiNER2 multi-task — при каких F1 каждый достаточен?
4. **Active learning loop**: classifier → low-confidence → LLM → retrain. Concrete implementation
5. **Multi-sentence descriptions**: sliding window approach, paragraph merging rules
6. **Evaluation**: precision@K, recall, F1, human evaluation protocol
7. **Iteration timeline**: сколько book iterations нужно для stable F1 > 0.85?

### 3.3 Coreference и Alias Resolution: что реально работает

1. **Русский coref SOTA 2026**: конкретные модели, F1 на RuCoCo/RuCoRef, CPU feasibility
2. **Alias resolution без LLM**: embedding similarity, co-occurrence, name patterns (отчество → имя)
3. **Alias resolution с minimal LLM**: один LLM-вызов на 5-10 candidate pairs vs per-chapter calls
4. **Cross-document entity linking**: серии книг (Witcher vol.1 + vol.2). Embedding-based matching
5. **Practical recommendation**: что реально работает на русском для fiction в 2026?

---

## Часть 4: Инфраструктурный план

### 4.1 Docker-архитектура для NLP

На основе SSH-аудита предложи **конкретные изменения** в `docker-compose.prod.yml`:

**Для каждого контейнера, который нужно изменить:**
```yaml
# Текущее значение → предлагаемое значение
# Обоснование
```

Рассмотри два варианта:
- **Вариант A**: NLP-модели в Celery worker (проще)
- **Вариант B**: Отдельный NLP-микросервис (масштабируемее)

Для каждого варианта: конкретный yaml, memory budget, CPU budget, pros/cons.

### 4.2 PostgreSQL: миграция на pgvector

Конкретный пошаговый план:
1. Backup (pgbackup уже настроен — как использовать?)
2. Смена Docker image: `postgres:17.9-alpine` → `pgvector/pgvector:pg17`
3. Проверка совместимости (shared_buffers, locale, extensions)
4. Alembic migration script (конкретный код)
5. Rollback plan если что-то пойдёт не так

### 4.3 Модели: download и кэширование

- Где хранить загруженные модели? Docker volume vs bind mount
- Скачивать при docker build (larger image, faster startup) или при первом запуске (smaller image, slow first run)?
- HuggingFace cache: `HF_HOME` / `TRANSFORMERS_CACHE` env var → Docker volume
- Размер моделей на диске: GLiNER2 + e5-small + classifier = сколько GB?

### 4.4 Monitoring NLP-компонентов

Текущий стек: Netdata + VictoriaMetrics + Flower. Что добавить:
- NLP inference latency (per-model, per-chapter) → Prometheus metrics → VictoriaMetrics
- NLP memory usage → Netdata custom charts
- NER quality metrics (entity count per chapter, confidence distribution) → structured logging
- Cost tracking: `llm_usage_log` уже существует — расширить для hybrid pipeline
- A/B comparison dashboard: GLiNER2 path vs LLM path side-by-side

---

## Часть 5: Детализированный план рефакторинга

### 5.1 Архитектурный дизайн: спецификации сервисов

Для КАЖДОГО нового сервиса:
- **Файл**: точный путь (`backend/app/services/...`)
- **Класс**: имя, наследование, паттерн (singleton/factory/etc)
- **Public API**: каждый метод с полной сигнатурой (async def, types, return type)
- **Pydantic models**: input/output schemas
- **Dependencies**: от каких других сервисов зависит
- **Config**: env vars и их defaults
- **Fallback**: что происходит при failure
- **Integration point**: как встраивается в текущий `book_tasks.py` → `process_chapter_safe()`

Нужны спецификации для:
1. `NERService` — GLiNER2 wrapper (singleton, lazy load, chunking)
2. `DescriptionClassifier` — TF-IDF/MiniLM classifier (train, predict, active learning)
3. `EmbeddingService` — e5-small + pgvector (embed, store, search)
4. `EntityResolutionService` — fuzzy + embedding + LLM dedup (замена Consistency Manager entity logic)
5. `HybridExtractionPipeline` — orchestrator (замена gemini_extractor.analyze_chapter)
6. `NLPModelManager` — singleton для управления lifecycle всех моделей (load, health, metrics)

### 5.2 Миграция данных

- `extraction_pipeline` column: ALTER TABLE entities ADD COLUMN... или отдельная таблица?
- chapter_embeddings таблица: полный DDL + Alembic migration
- Backward compatibility: как UI работает со смешанными данными (LLM + NER entities)?
- Re-processing: нужно ли переобработать 8 существующих книг? Стратегия?

### 5.3 Feature Flags: конкретная реализация

Используя существующий `FeatureFlagManager` + `FeatureFlag` model:
- Список ВСЕХ новых flags с default values
- Env var overrides для каждого
- Float-параметры: как реализовать (env vars? отдельная таблица settings?)
- Порядок включения flags при поэтапном rollout

### 5.4 Тестирование: concrete plan

| Тип теста | Что тестируем | Как | Acceptance criteria |
|---|---|---|---|
| Unit (NERService) | extract_entities() на 10+ hardcoded Russian fiction examples | pytest + fixtures | Recall ≥ 80%, Precision ≥ 70% |
| Unit (Classifier) | classify_chapter() на annotated chapters | pytest + golden set | F1 ≥ 0.70 (TF-IDF) or F1 ≥ 0.80 (MiniLM) |
| Integration (Pipeline) | Full chapter processing through HybridExtractionPipeline | Docker test environment | ChapterAnalysisResult совместим, entities в БД |
| A/B (Quality) | Одна книга — оба pipeline | Feature flag toggle | Entity overlap > 70% (Jaccard), cost < 10% of LLM |
| E2E (Regression) | Полная обработка книги | Celery task, production-like | No errors, all entities/descriptions saved |
| Performance | Inference latency per chapter | Benchmark script | GLiNER2 < 5s/chapter, Embedding < 2s/chapter |
| Memory | Peak RAM during processing | docker stats monitoring | < 4 GB (Celery worker limit) |

### 5.5 Timeline: задачи → часы → зависимости

Для каждой задачи:
- **ID** (T1.1, T1.2, ...)
- **Описание** (конкретное, action-oriented)
- **Estimated hours** (optimistic / realistic / pessimistic)
- **Depends on** (список task IDs)
- **Acceptance criteria** (конкретные, measurable)
- **Go/No-Go gate** (после каких задач принимается решение продолжать?)
- **Parallelizable?** (можно ли делать одновременно с другими?)

Визуализируй зависимости как DAG (text-based):
```
T1.1 ──→ T1.2 ──→ T1.3 ──→ T1.4 ──→ [GO/NO-GO #1] ──→ T1.5
                                                           ↑
T2.1 ──→ T2.2 ──→ T2.3 ──→ T2.4 ────────────────────────→┘
T4.1 ──→ T4.2 (parallel with T1.x, T2.x)
```

---

## Часть 6: Обновлённые рекомендации

На основе ВСЕХ находок:
1. **Quick wins** (можно сделать сегодня, без рефакторинга)
2. **Top-3 рекомендации** (наибольший impact/effort ratio)
3. **Что изменилось** по сравнению с аудируемым отчётом
4. **Исправленная стоимостная модель** (полная таблица с актуальными ценами)
5. **Risk register** (каждый риск с probability × impact matrix)

---

## Формат выходного файла

```markdown
# Аудит v2: Оптимизация обработки книг в fancai
## Дата: 2026-03-23

## 0. Инфраструктура сервера (SSH-аудит)
### 0.1 Характеристики VPS
### 0.2 Docker-инфраструктура (полная карта)
### 0.3 PostgreSQL: extensions, размеры, параметры
### 0.4 Текущие NLP-зависимости (или отсутствие)
### 0.5 Ресурсный бюджет для NLP (RAM, CPU, disk)

## 1. Верификация фактов
### 1.1 Ценообразование
### 1.2 Стоимостная модель (пересчёт с нуля)
### 1.3 GLiNER / GLiNER2
### 1.4 Natasha / Slovnet / Coref
### 1.5 Embedding модели
(Для каждого: ✅/⚠️/❌ + URL источника + корректные данные)

## 2. Расширенное исследование
### 2.1 NER: дополнительные модели (таблица сравнения)
### 2.2 Entity Wiki: дополнительные подходы
### 2.3 Description Extraction: дополнительные методы
### 2.4 LLM-оптимизация: дополнительные возможности
### 2.5 Инфраструктура: новые находки

## 3. Углублённый анализ
### 3.1 GLiNER2: production-ready оценка
### 3.2 Description Classifier: полный дизайн
### 3.3 Coreference и Alias Resolution

## 4. Инфраструктурный план
### 4.1 Docker-архитектура (2 варианта с yaml)
### 4.2 PostgreSQL → pgvector миграция (пошаговый план)
### 4.3 Модели: download и кэширование
### 4.4 Monitoring NLP-компонентов

## 5. План рефакторинга
### 5.1 Архитектурный дизайн (6 сервисов с полными спецификациями)
### 5.2 Миграция данных
### 5.3 Feature Flags
### 5.4 Тестирование (таблица с acceptance criteria)
### 5.5 Timeline (DAG задач с часами и зависимостями)

## 6. Обновлённые рекомендации
### 6.1 Quick wins
### 6.2 Top-3 рекомендации
### 6.3 Исправленная стоимостная модель
### 6.4 Risk register

## 7. Источники
(Все URL из поисков, с датой доступа)
```

---

## Требования к качеству

1. **Конкретность**: не «создать сервис», а `class NERService` в `backend/app/services/ner_service.py` с `async def extract_entities(text: str, labels: list[str]) -> list[NEREntity]`
2. **Верифицируемость**: каждый факт — URL источника. Каждый расчёт — формула + результат
3. **Актуальность**: все данные проверены через поиск на момент выполнения, не из памяти
4. **Production-focus**: Python 3.12, CPU-only (12 vCPU EPYC), Docker, PostgreSQL 17, Redis 7.4, Celery
5. **Инкрементальность**: каждый phase — feature flag, rollback plan, backward compatible
6. **Не повторять отчёт**: аудит добавляет НОВУЮ информацию. Если факт верен — ✅ и двигаться дальше
7. **Арифметика**: пересчитать ВСЕ стоимости с нуля. Предыдущий аудит нашёл занижение стоимости в 2.2 раза

## Антипаттерны

- ❌ НЕ ставить ✅ без поиска — проверяй КАЖДЫЙ факт
- ❌ НЕ предполагать VPS 4-8 GB RAM — подключись по SSH и проверь
- ❌ НЕ рекомендовать модели без проверки: Python 3.12 compat + CPU feasibility + RAM budget
- ❌ НЕ давать абстрактный план без конкретных файлов/классов из текущей кодовой базы
- ❌ НЕ забывать что OpenRouter ≠ прямой API — batch скидки недоступны
- ❌ НЕ игнорировать что `postgres:17.9-alpine` не содержит pgvector
- ❌ НЕ предлагать concurrency > 1 для Celery worker с NLP-моделями в памяти
- ❌ НЕ использовать PII-модели GLiNER для fiction NER

---

## Контекст кодовой базы fancai

### Ключевые файлы AI-пайплайна

```
backend/app/
├── services/
│   ├── gemini_extractor.py              # GeminiDirectExtractor
│   │   ├── TSA_EXTRACTION_PROMPT        # ~2000 tokens system prompt
│   │   ├── analyze_chapter()            # Entry: text → ChapterAnalysisResult
│   │   ├── RecursiveTextChunker         # Chunking с overlap
│   │   └── _deduplicate_entities()      # Fuzzy dedup (SequenceMatcher 0.75)
│   ├── entity_synthesis_service.py      # Post-processing: biography, milestones
│   ├── entity_deduplication_service.py  # LLM-based alias merging
│   ├── consistency_manager.py           # Entity resolution + visual_summary merge
│   ├── description_extraction_service.py # Business logic для описаний
│   ├── tsa_parser.py                    # TSA XML → spans + fuzzy matching
│   ├── llm_cache_service.py             # LLM response caching
│   ├── feature_flag_manager.py          # FeatureFlagManager (DB + env + cache)
│   ├── parsing_manager.py              # Parsing queue с приоритетами
│   └── book/
│       └── book_parsing_service.py      # High-level parsing service
├── core/
│   └── openrouter_client.py             # OpenRouter client
│       ├── FALLBACK_MODELS              # Gemini 3 Flash → Haiku 4.5 → Gemini 2.5 Lite
│       ├── generate_text()              # JSON mode
│       ├── generate_structured()        # JSON Schema mode
│       └── circuit breaker              # 5 failures → 60s cooldown
├── tasks/
│   └── book_tasks.py                    # Celery: process_book → process_chapter_safe()
├── models/
│   ├── entity.py                        # Entity (character/location/object)
│   ├── entity_event.py                  # EntityEvent (per-chapter events)
│   ├── entity_mention.py               # EntityMention
│   ├── entity_relationship.py          # EntityRelationship
│   ├── description.py                   # Description
│   ├── description_entity.py           # DescriptionEntity (spoiler protection)
│   ├── feature_flag.py                  # FeatureFlag model + FeatureFlagCategory enum
│   └── llm_usage_log.py               # LlmUsageLog (cost tracking)
└── schemas/responses/
    ├── processing.py
    └── descriptions.py
```

### Ключевые типы данных

```python
# gemini_extractor.py
@dataclass
class ExtractedEntity:
    name: str
    type: str                          # character, location, object
    visual_summary: str
    aliases: List[str]
    confidence: float
    importance: int                    # 1-10
    first_mention_offset: Optional[int]
    chapter_event_action: Optional[str]
    chapter_event_inner: Optional[str]

@dataclass
class ExtractedDescription:
    content: str
    description_type: DescriptionType
    confidence: float
    entities: List[Dict[str, Any]]
    position: int
    source_span: Tuple[int, int]

@dataclass
class ChapterAnalysisResult:
    descriptions: List[ExtractedDescription]
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]
```

### Текущие зависимости (requirements.txt)

- **Нет NLP**: ни spaCy, ни transformers, ни torch, ни gliner. Комментарий: «NLP REMOVED December 2025 for RAM optimization»
- `httpx` для OpenRouter API
- `tenacity` + `circuitbreaker` для resilience
- `pydantic` для structured output schemas
- `celery` 5.6.2 с Redis broker
- Python 3.12, Debian 13 (trixie)

### Feature Flags (существующая система)

```python
class FeatureFlagCategory(enum.Enum):
    NLP = "nlp"
    PARSER = "parser"
    IMAGES = "images"
    SYSTEM = "system"
    EXPERIMENTAL = "experimental"

class FeatureFlag(Base):
    name: Mapped[str]          # unique, indexed
    enabled: Mapped[bool]
    category: Mapped[str]
    description: Mapped[str | None]
    default_value: Mapped[bool]

# Существующие flags:
# USE_NEW_NLP_ARCHITECTURE (enabled=True)
# USE_ADVANCED_PARSER (enabled=False)
# USE_LLM_ENRICHMENT (enabled=False)
# ENABLE_ENSEMBLE_VOTING (enabled=True)
# ENABLE_PARALLEL_PROCESSING (enabled=True)
# ENABLE_IMAGE_CACHING (enabled=True)
```

### Docker Infrastructure

```
Production: docker-compose.prod.yml (8 services)
Monitoring: docker-compose.monitoring.yml (5 services)
Total: 13 containers, 18 GB allocated, ~1.65 GB actually used
Server: 32 GB RAM, 12 vCPU AMD EPYC 9645, 1 TB NVMe SSD
```
