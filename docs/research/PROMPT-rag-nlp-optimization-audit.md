# Промпт для аудита: Верификация и расширение исследования оптимизации обработки книг

> **Модель:** Claude Opus 4.6 (1M Context)
> **Дата:** 2026-03-23
> **Язык отчёта:** русский
> **Входные файлы:**
> - Аудируемый отчёт: `/docs/research/rag-nlp-optimization-research.md`
> - Оригинальное ТЗ: `/docs/research/PROMPT-rag-nlp-optimization-research.md`
> **Результат:** файл `/docs/research/rag-nlp-optimization-audit.md`

---

## Системный контекст

Ты — lead ML/NLP архитектор, выполняющий **экспертный аудит** исследовательского отчёта, подготовленного другим инженером. Твоя задача тройная:

1. **Верификация** — найти фактические ошибки, устаревшие данные, необоснованные утверждения, ошибки в расчётах
2. **Расширение** — углубить каждое направление, найти пропущенные инструменты/модели/подходы, расширить горизонтально (что ещё?) и вертикально (глубже в каждую тему)
3. **Детализация плана** — превратить высокоуровневый 5-phase план из отчёта в конкретный, готовый к исполнению план рефакторинга с файлами, интерфейсами, миграционными скриптами

Используй Brave Search и все доступные инструменты для поиска в вебе. **Перепроверяй каждое утверждение из отчёта через свежий поиск.** Актуальность — март 2026.

---

## Часть 1: Верификация фактов — конкретные утверждения для проверки

Проверь через поиск в вебе каждое из следующих утверждений отчёта и укажи: ✅ верно / ⚠️ неточно / ❌ ошибка — с объяснением и правильными данными:

### 1.1 Ценообразование (раздел 1.2)
- [ ] «Gemini 3 Flash Preview: $0.50/$3.00 per 1M tokens через OpenRouter» — проверь актуальные цены на openrouter.ai на момент поиска
- [ ] «OpenRouter передаёт цены провайдеров без наценки» — проверь, действительно ли zero markup
- [ ] «Gemini Batch API даёт 50% скидку» — проверь через Google AI pricing docs, применимо ли к Gemini 3 Flash Preview
- [ ] «Gemini 2.0 Flash Lite: $0.075/$0.30» — проверь, не deprecated ли эта модель (в отчёте упоминается deprecation June 2026)
- [ ] Расчёт $0.68 за книгу — пересчитай: 375k input tokens × $0.50/1M + 100k output tokens × $3.00/1M = ? Проверь арифметику
- [ ] «Claude Haiku 4.5: $1.00/$5.00» — проверь актуальную цену

### 1.2 GLiNER (раздел 2.2)
- [ ] «GLiNER v0.2.25, февраль 2026» — проверь текущую версию на PyPI
- [ ] «outperforms both ChatGPT and fine-tuned LLMs in zero-shot evaluations» — это было верно для ChatGPT (GPT-3.5/4), но верно ли для GPT-5.4 / Claude Opus 4.6?
- [ ] «CPU-оптимизирована через ONNX» — найди реальные benchmarks latency на CPU (какой CPU, сколько ms на документ)
- [ ] «GLiNER-Relex v0.5» — проверь, существует ли такая версия, где опубликована
- [ ] GLiNER2 от Fastino Labs — проверь: это отдельный проект? совместим с gliner PyPI? какие модели доступны?
- [ ] «Нет галлюцинаций» — точнее: нет структурных галлюцинаций (не изобретает entity types), но может ли ошибочно выделить span? Каков false positive rate?
- [ ] Пример кода с `gliner_multi_pii-v1` — это PII-модель, подходит ли она для fiction NER? Какая модель корректнее для literary text?

### 1.3 Natasha / Slovnet (раздел 2.1)
- [ ] «F1 93-95% на news» — проверь конкретные F1 по датасетам (factru, gareev, ne5, bsnlp)
- [ ] «Navec embeddings обучены на художественных текстах (12B токенов)» — проверь: Navec или Nerus? Какой корпус использовался?
- [ ] «Natasha включает coreference resolution» — проверь: есть ли в Natasha/Slovnet реальный coref resolver, или это только NER? Найди текущий статус проекта (последний коммит, releases)
- [ ] Насколько Slovnet актуален в 2026? Последний release?

### 1.4 Embedding модели (раздел 3.1)
- [ ] «multilingual-e5-small: 100% Top-5 accuracy» — этот бенчмарк был на конкретном продуктовом датасете (Amazon Health). Корректно ли экстраполировать на русский fiction?
- [ ] «16ms на GPU» для e5-small — на каком GPU? Что реально на CPU VPS?
- [ ] Отсутствие упоминания ruMTEB лидерборда — какая модель реально лидирует для русского текста?

### 1.5 Стоимостная модель (раздел 6.2)
- [ ] «NER / Entity Extraction: $0.35 (50 LLM calls)» — пересчитай: если каждая глава ~30k символов ≈ 7.5k токенов, 50 × 7.5k = 375k input. При $0.50/1M = $0.1875. Откуда $0.35?
- [ ] «Гибрид: $0.11 итого» — пересчитай каждую строку
- [ ] Output tokens не учтены корректно: TSA-режим возвращает tagged_text (= input size) + entities JSON. Output может быть 50-100% от input

---

## Часть 2: Пропущенные направления — расширение горизонтальное

Отчёт пропустил или недостаточно покрыл следующие темы. По каждой **проведи отдельный поиск в вебе**:

### 2.1 NER: пропущенные модели и подходы
- **Stanza (Stanford NLP)** — упомянут в ТЗ, но не исследован в отчёте. Какие русскоязычные модели? F1? CPU performance?
- **NuNER / UniNER** — упомянуты в ТЗ, не исследованы. Актуальны ли в 2026?
- **RoBERTa Large NER Russian** (HuggingFace) — упомянут в найденном исследовании (arxiv:2506.02589) как «viable alternative for cost-conscious deployments». Какой F1? Размер? CPU inference?
- **spaCy 3.8+ transformers pipeline** — можно ли подключить transformer NER backend к spaCy для русского? Есть ли готовые модели?
- **Fine-tuning GLiNER на literary NER** — есть ли датасеты для русской художественной литературы? Litbank (English) есть — есть ли русский аналог?
- **Few-shot NER через sentence-transformers** — подход без fine-tuning: embed entity mentions, cluster, classify. Исследовался ли?

### 2.2 Entity Wiki: пропущенные подходы
- **Knowledge Graph construction** — GraphRAG, LightRAG, nano-graphrag. Какие из них подходят для fiction? Работают ли на CPU?
- **Book-specific NLP** — BookNLP (David Bamman) для extraction of characters, relationships, quotes attribution. Есть ли русская версия?
- **Character network analysis** — автоматическое построение графа персонажей без LLM (co-occurrence в абзацах/сценах)
- **Incremental Entity Wiki** — on-demand per chapter vs batch. Как меняется архитектура? Какие компоненты incremental-friendly?

### 2.3 Описания: пропущенные подходы
- **TextRank / RAKE** — упомянуты в ТЗ, не исследованы. Подходят ли для extraction of descriptive passages?
- **Sentence embeddings + clustering** — кластеризация предложений по визуальному содержанию, без classification
- **Zero-shot classification** — BART-large-mnli / XLM-R для zero-shot «is this a visual description?» Работает ли на русском?
- **Chunking strategies для описаний** — описания часто пересекают границы предложений. Как правильно чанкировать для fiction?

### 2.4 Оптимизация LLM: пропущенные подходы
- **Gemini Context Caching** — отчёт упоминает, но не даёт расчётов. Какой процент экономии на системном промпте? Pricing для cache storage?
- **Prompt compression** — LLMLingua, AutoCompressor. Можно ли сжимать текст главы перед отправкой в LLM?
- **Prompt tiering** — разные модели для разных задач внутри одного пайплайна. Отчёт упоминает model_extraction vs model_translation, но не исследует оптимальные пары.
- **Gemini 2.5 Flash Lite** (vs 3 Flash) — отчёт рекомендует 3 Flash, но Lite в 5-7 раз дешевле. Достаточно ли Lite для synthesis?
- **OpenAI Batch API** — 50% скидка, поддерживается через OpenRouter? Актуальные цены GPT-4o-mini batch?
- **Кэширование результатов между книгами** — одни и те же авторы, серии. Можно ли переиспользовать entity data?

### 2.5 Инфраструктура: пропущенные темы
- **Memory footprint** — GLiNER + spaCy + e5-small одновременно в памяти на VPS. Сколько RAM нужно? Влияет ли на Celery workers?
- **Startup time** — загрузка моделей при старте Celery worker. Как кэшировать?
- **Batch processing vs streaming** — можно ли обрабатывать книгу потоково (chapter by chapter, отдавая результаты UI по мере готовности)?
- **A/B testing infrastructure** — как сравнить качество нового пайплайна с текущим на реальных данных?

---

## Часть 3: Углубление вертикальное — детализация ключевых находок

### 3.1 GLiNER: глубокое погружение
Найди и исследуй:
- Все доступные модели на HuggingFace (urchade/gliner_*). Какая лучше для multilingual literary text?
- GLiNER multi-task модели — какие задачи поддерживают кроме NER?
- Реальный inference speed на CPU (Intel Xeon / AMD EPYC типичного VPS) — ms per 1000 tokens
- Maximum input length GLiNER — как обрабатывать длинные главы (>512 токенов)?
- Fine-tuning pipeline: формат данных, время обучения, hardware requirements
- ONNX vs PyTorch — разница в скорости на CPU
- Сравнение с LLM-based NER **на русском literary тексте** (есть ли такие бенчмарки?)

### 3.2 Описания: глубокое погружение в classifier
- Какой объём обучающей выборки нужен для reliable classifier? Есть ли rule of thumb?
- Cross-validation стратегия: split по книгам (не по предложениям), чтобы избежать data leakage
- Multi-class vs binary: стоит ли сразу классифицировать тип (location/character/atmosphere)?
- Active learning: начать с small dataset, постепенно дообучать на проверенных предсказаниях
- Как обрабатывать multi-sentence описания? Они пересекают границы предложений
- Evaluation metrics: precision@K (top-20 описаний), recall на золотом стандарте

### 3.3 Coreference Resolution: глубокое погружение
- Текущий SOTA для русского coref: какие модели/системы существуют на март 2026?
- RuCoRef corpus — есть ли? Как оценивать качество coref?
- Cross-document coref для серий книг (один персонаж в нескольких томах)
- Alias resolution specifically for fiction: «Белый Волк» → «Геральт» требует world knowledge. Можно ли без LLM?
- spaCy coref component (experimental) — работает ли с русскими моделями?

---

## Часть 4: Детализированный план рефакторинга

Отчёт содержит высокоуровневый 5-phase план. Переработай его в **конкретный, исполнимый план** со следующей детализацией:

### 4.1 Архитектурный дизайн

Для каждого нового/модифицированного сервиса опиши:
- **Файл и класс:** точное имя файла, класс, публичный API
- **Интерфейс:** input/output types (Pydantic models)
- **Зависимости:** от каких моделей/сервисов зависит
- **Конфигурация:** через settings (env vars, feature flags)
- **Fallback:** что делать, если компонент недоступен/сломан

Нужны спецификации для:
1. `NERService` — обёртка над GLiNER (+ spaCy + Natasha fallback)
2. `DescriptionClassifier` — sentence-level classifier для описаний
3. `EmbeddingService` — embed + store в pgvector
4. `EntityResolutionService` — замена текущего Consistency Manager
5. `HybridExtractionPipeline` — orchestrator, заменяющий текущий gemini_extractor.analyze_chapter()

### 4.2 Миграция данных

- Как мигрировать существующие entities/descriptions? Нужна ли ре-обработка книг?
- Backward compatibility: старые данные (из LLM) и новые (из NER) в одной БД?
- Versioning extraction results: как пометить, каким пайплайном обработана книга?
- pgvector migration: ALTER TABLE или новая таблица?

### 4.3 Feature Flags

В текущем коде уже есть `feature_flag_manager.py`. Опиши конкретные flags:
- `USE_GLINER_NER` (boolean) — переключатель NER backend
- `USE_DESCRIPTION_CLASSIFIER` (boolean) — classifier vs LLM для описаний
- `GLINER_CONFIDENCE_THRESHOLD` (float) — порог для fallback на LLM
- `DESCRIPTION_CLASSIFIER_THRESHOLD` (float) — порог для candidate descriptions
- `LLM_SYNTHESIS_MODEL` (string) — выбор модели для synthesis phase

### 4.4 Тестирование и validation

- **Golden dataset:** как создать? Сколько книг? Какие метрики?
- **A/B framework:** как сравнить NER-path vs LLM-path на одних и тех же книгах?
- **Regression tests:** что проверять после каждого phase?
- **Quality gates:** при каких метриках можно переключить phase в production?
- **Rollback план:** как откатить каждый phase без потери данных?

### 4.5 Порядок реализации (detailed timeline)

Переработай 5 phases из отчёта в конкретные задачи с:
- **Зависимости между задачами** (что блокирует что)
- **Estimated hours** (не недели, а часы разработки)
- **Acceptance criteria** для каждой задачи
- **Рекомендуемый порядок** (можно ли параллелить?)
- **Точки принятия решений** (go/no-go после каких результатов)

---

## Формат отчёта аудита

```markdown
# Аудит исследования: Оптимизация обработки книг в fancai
## Дата аудита: 2026-03-23

## 1. Верификация фактов
### 1.1 Ценообразование
### 1.2 GLiNER
### 1.3 Natasha / Slovnet
### 1.4 Embedding модели
### 1.5 Стоимостная модель
(Для каждого: ✅/⚠️/❌ + объяснение + корректные данные)

## 2. Пропущенные направления
### 2.1 NER: дополнительные модели
### 2.2 Entity Wiki: дополнительные подходы
### 2.3 Описания: дополнительные методы
### 2.4 Оптимизация LLM
### 2.5 Инфраструктура
(Для каждого: описание, бенчмарки, applicability для fancai)

## 3. Углублённый анализ
### 3.1 GLiNER: детальное исследование
### 3.2 Description Classifier: дизайн
### 3.3 Coreference Resolution

## 4. Детализированный план рефакторинга
### 4.1 Архитектурный дизайн (сервисы, интерфейсы)
### 4.2 Миграция данных
### 4.3 Feature Flags
### 4.4 Тестирование и validation
### 4.5 Детальный timeline (задачи, часы, зависимости)

## 5. Исправленная стоимостная модель
(Пересчитанная таблица с корректными данными)

## 6. Обновлённые рекомендации
(Что изменилось после аудита)

## 7. Источники
(Все URL из поисков аудита)
```

## Требования к качеству аудита

1. **Каждая проверка — через свежий поиск**, не из памяти. Нашёл расхождение → приведи URL с корректными данными
2. **Бенчмарки на русском** — ищи конкретные F1/latency именно для Russian, не экстраполируй с English
3. **CPU benchmarks** — VPS без GPU, это hard constraint. Любая модель >1GB RAM или >500ms latency — отмечай
4. **Code-level plan** — файлы, классы, методы, типы. Не абстрактные «создать сервис», а конкретный `class NERService` с `async def extract_entities(text: str, labels: list[str]) -> list[ExtractedEntity]`
5. **Пересчитай ВСЮ стоимостную модель** с нуля, используя актуальные цены из поиска
6. **Не повторяй отчёт** — аудит должен добавлять новую информацию, не пересказывать старую

## Антипаттерны аудита

- НЕ ставь ✅ без реальной проверки через поиск
- НЕ пропускай арифметические ошибки в расчётах
- НЕ рекомендуй модели, которые ты не проверил на совместимость с Python 3.11 / CPU
- НЕ давай план без конкретных файлов и интерфейсов из текущего кодебазы fancai
- НЕ забывай, что текущий код использует OpenRouter (не прямой Gemini API) — миграция на Batch API требует отдельного API key
- НЕ игнорируй текущие feature flags и сервисный слой — рефакторинг должен быть инкрементальным

---

## Контекст кодовой базы fancai (для плана рефакторинга)

### Ключевые файлы текущего AI-пайплайна:

```
backend/app/
├── services/
│   ├── gemini_extractor.py          # Основной экстрактор (GeminiDirectExtractor)
│   │   └── TSA_EXTRACTION_PROMPT    # ~2000 токенов системный промпт
│   │   └── EXTRACTION_PROMPT        # Legacy промпт без TSA
│   │   └── analyze_chapter()        # Entry point: text → ChapterAnalysisResult
│   │   └── RecursiveTextChunker     # Chunking с overlap
│   │   └── GeminiConfig             # Конфигурация моделей
│   │   └── _deduplicate_entities()  # Fuzzy dedup (SequenceMatcher 0.75)
│   ├── entity_synthesis_service.py  # Post-processing: biography, milestones
│   ├── entity_deduplication_service.py  # LLM-based alias merging
│   ├── consistency_manager.py       # Entity resolution + visual_summary merge
│   ├── description_extraction_service.py  # Бизнес-логика описаний
│   ├── tsa_parser.py                # TSA XML → spans + fuzzy matching
│   ├── llm_cache_service.py         # Кэширование LLM-ответов
│   ├── parsing_manager.py           # Очередь парсинга с приоритезацией
│   └── book/
│       └── book_parsing_service.py  # Высокоуровневый сервис парсинга
├── core/
│   └── openrouter_client.py         # OpenRouter API клиент
│       └── FALLBACK_MODELS          # Gemini 3 Flash → Haiku 4.5 → Gemini 2.5 Lite
│       └── generate_text()          # JSON mode
│       └── generate_structured()    # JSON Schema mode
│       └── circuit breaker          # 5 failures → 60s cooldown
├── tasks/
│   └── book_tasks.py                # Celery task process_book
│       └── _process_book_async()    # Главный цикл обработки
│       └── process_chapter_safe()   # Per-chapter processing
├── models/
│   ├── entity.py                    # Entity (PG model)
│   ├── entity_event.py              # EntityEvent (chapter events)
│   ├── entity_mention.py            # EntityMention
│   ├── entity_relationship.py       # EntityRelationship
│   ├── description.py               # Description
│   ├── description_entity.py        # DescriptionEntity (spoiler protection)
│   └── llm_usage_log.py             # LlmUsageLog (cost tracking)
└── schemas/
    └── responses/
        ├── processing.py            # Processing response schemas
        └── descriptions.py          # Description response schemas
```

### Ключевые типы данных:

```python
# gemini_extractor.py
@dataclass
class ExtractedEntity:
    name: str
    type: str  # character, location, object
    visual_summary: str
    aliases: List[str]
    confidence: float
    importance: int  # 1-10
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

### Текущие зависимости (backend/requirements.txt):
- Нет NLP-библиотек (spaCy, transformers, etc.) — всё через API
- `google-genai` закомментирован — мигрировано на OpenRouter
- `httpx` для OpenRouter API calls
- `tenacity` для retry
- `circuitbreaker` для circuit breaker
- `pydantic` для structured output schemas

### Feature flags (уже в системе):
```python
# feature_flag_manager.py — уже используется для A/B testing
class FeatureFlag(Base):
    name: str
    enabled: bool
    description: str
```
