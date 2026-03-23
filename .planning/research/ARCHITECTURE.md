# Архитектура интеграции: Гибридный NLP Pipeline

**Проект:** fancai v1.4 — Оптимизация обработки книг
**Исследовано:** 2026-03-24
**Уверенность:** HIGH (основано на аудите кода + SSH-инспекции сервера + docs/research/*.md)

---

## Рекомендуемая архитектура

### Обзор

Гибридный pipeline заменяет all-LLM обработку на **локальные NLP-модели для extraction** (бесплатно) + **точечные LLM-вызовы для synthesis** (1-3 вызова на книгу). Ключевой принцип: новые компоненты интегрируются **в существующий pipeline** через feature flags, а не заменяют его. Текущий pipeline остается fallback.

```
ТЕКУЩИЙ PIPELINE:
  EPUB -> book_tasks.py -> gemini_extractor.analyze_chapter() -> TSA Parser
       -> ConsistencyManager.process_chapter_analysis()
       -> EntityDeduplicationService (LLM)
       -> EntitySynthesisService (LLM)
       -> GraphService.calculate_pagerank()

НОВЫЙ PIPELINE (за feature flag USE_HYBRID_NLP):
  EPUB -> book_tasks.py -> NERService.extract_from_chapter()         [LOCAL]
       -> DescriptionClassifier.classify_chapter()                   [LOCAL]
       -> EmbeddingService.embed_chapter() -> pgvector               [LOCAL]
       -> NEREntity -> ExtractedEntity adapter (backward compat)
       -> ConsistencyManager.process_chapter_analysis()              [REUSE]
       -> Embedding-based alias detection                            [LOCAL]
       -> EntityDeduplicationService (LLM, only 5-10 pairs)         [REUSE]
       -> EntitySynthesisService (LLM, 1 batch call)                [REUSE]
       -> GraphService.calculate_pagerank()                          [REUSE]
```

### Критическое архитектурное решение: NLP в Celery Worker

**Вариант A (рекомендуемый): NLP-модели внутри Celery worker.**

Обоснование:
- Нет inter-service communication overhead
- Модели загружаются один раз как singletons в main process
- `--max-tasks-per-child=0` — child не перезапускается, модели persist
- `--concurrency=1` — один process, все модели shared
- 14 GB headroom на сервере покрывает 4 GB worker с запасом

**Вариант B (отложен): Отдельный NLP microservice.** Потребуется при масштабировании до нескольких workers. Сейчас избыточен для 1 пользователя + 100 книг/месяц.

---

## Границы компонентов

### Новые компоненты

| Компонент | Файл | Ответственность | Зависимости |
|-----------|------|-----------------|-------------|
| **NERService** | `services/ner_service.py` | GLiNER2 NER extraction с chunking | `gliner2>=1.2.4`, `torch` (CPU) |
| **DescriptionClassifier** | `services/description_classifier.py` | Binary classification: описание / не описание | `scikit-learn` (TF-IDF) или `sentence-transformers` |
| **EmbeddingService** | `services/embedding_service.py` | Batch text embedding для pgvector | `sentence-transformers`, pgvector |
| **NLPModelManager** | `services/nlp_model_manager.py` | Singleton lifecycle для всех NLP-моделей | NERService, EmbeddingService, DescriptionClassifier |
| **HybridExtractor** | `services/hybrid_extractor.py` | Orchestrator: NER + Classifier + Embedding в одном вызове | NERService, DescriptionClassifier, EmbeddingService |
| **ChapterEmbedding** (model) | `models/chapter_embedding.py` | SQLAlchemy model для pgvector таблицы | pgvector extension |

### Модифицируемые компоненты

| Компонент | Файл | Что меняется |
|-----------|------|-------------|
| **book_tasks.py** | `tasks/book_tasks.py` | Feature flag switch: gemini_extractor vs hybrid_extractor |
| **celery_app.py** | `core/celery_app.py` | Env vars для concurrency=1, max-tasks-per-child=0 |
| **docker-compose.prod.yml** | root | PG image -> pgvector/pgvector:pg17, Celery limits 4 GB / 4 CPU |
| **docker-compose.dev.yml** | root | Аналогичные изменения для dev |
| **requirements.txt** | `backend/` | +gliner2, +torch (CPU), +sentence-transformers, +scikit-learn |
| **Dockerfile.prod** | `backend/` | Возможное увеличение image size (torch ~700 MB) |
| **feature_flag model** | `models/feature_flag.py` | Новые default flags: USE_HYBRID_NLP, USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER |
| **ConsistencyManager** | `services/consistency_manager.py` | Принимает NEREntity напрямую (не только через ChapterAnalysisResult) |

### Неизменяемые компоненты

| Компонент | Почему не меняется |
|-----------|-------------------|
| **gemini_extractor.py** | Остается как fallback pipeline |
| **tsa_parser.py** | Используется только LLM pipeline (fallback) |
| **entity_service.py** | API для entity CRUD не меняется |
| **openrouter_client.py** | Synthesis/dedup все еще через OpenRouter |
| **entity_synthesis_service.py** | Только оптимизация prompt, контракт тот же |
| **entity_deduplication_service.py** | Только уменьшение входных данных (5-10 пар vs все) |
| **graph_service.py** | PageRank после pipeline — без изменений |
| Все frontend компоненты | Pipeline изменения только в backend |

---

## Потоки данных

### 1. Per-chapter extraction (текущий vs гибридный)

**Текущий flow (gemini_extractor):**
```
chapter.content (30k chars)
  -> chunker.chunk() (100k chars, 15% overlap)
  -> OpenRouter API (Gemini 3 Flash) x N chunks
     -> TSA prompt (~2000 tokens) + chapter text
     -> Structured Output -> tagged_text + entities[] + relationships[]
  -> TSAParser.parse() -> ExtractedDescription[], ExtractedEntity[], ExtractedRelationship[]
  -> ChapterAnalysisResult
```

**Гибридный flow (hybrid_extractor):**
```
chapter.content (30k chars)
  -> NERService.extract_from_chapter()
     -> sentence chunking (<= 2000 chars, 2-sentence overlap)
     -> GLiNER2.extract() per chunk (~100-200ms/chunk)
     -> boundary deduplication
     -> list[NEREntity] (text, label, start, end, score)
  -> DescriptionClassifier.classify_chapter()
     -> sentence tokenization
     -> rule-based prefilter (recall >= 90%)
     -> TF-IDF/ML classify survivors -> list[ClassifiedSentence]
  -> EmbeddingService.embed_chapter()
     -> paragraph chunking (~500 chars)
     -> e5-small batch encode -> pgvector INSERT
  -> NEREntity -> ExtractedEntity adapter (backward compat mapping)
  -> ClassifiedSentence -> ExtractedDescription adapter
  -> ChapterAnalysisResult (same shape as LLM output)
```

### 2. Adapter layer: NEREntity -> ExtractedEntity

Критическая точка интеграции. `ConsistencyManager.process_chapter_analysis()` ожидает `ChapterAnalysisResult` с `ExtractedEntity` (из `gemini_extractor.py`). NEREntity из GLiNER2 отличается:

```python
# gemini_extractor.py — текущий формат
@dataclass
class ExtractedEntity:
    name: str
    type: str                          # "character", "location", "object"
    visual_summary: str                # LLM-generated (ПУСТОЙ для NER)
    aliases: List[str] = []            # LLM-generated (ПУСТОЙ для NER)
    confidence: float = 0.0
    importance: int = 0                # LLM-generated (DEFAULT для NER)
    first_mention_offset: Optional[int] = None  # ЕСТЬ у NER (precise!)
    chapter_event_action: Optional[str] = None   # LLM-only
    chapter_event_inner: Optional[str] = None    # LLM-only

# ner_service.py — новый формат
@dataclass
class NEREntity:
    text: str                          # -> name
    label: str                         # -> type (mapping "персонаж" -> "character")
    start: int                         # -> first_mention_offset
    end: int                           # character offset конца (НОВОЕ!)
    score: float                       # -> confidence
    source: str = "gliner2"            # pipeline tracing
```

**Adapter mapping:**

| NEREntity field | ExtractedEntity field | Значение |
|-----------------|----------------------|----------|
| `text` | `name` | Прямой маппинг |
| `label` | `type` | `"персонаж"` -> `"character"`, `"локация"` -> `"location"`, `"артефакт"` -> `"object"` |
| `score` | `confidence` | Прямой маппинг |
| `start` | `first_mention_offset` | Прямой маппинг (точнее чем LLM!) |
| — | `visual_summary` | `""` (будет заполнен в synthesis phase) |
| — | `aliases` | `[]` (будут найдены через embedding similarity) |
| — | `importance` | `5` (default, будет рассчитан из mention count + PageRank) |
| — | `chapter_event_action` | `None` (будет заполнен в synthesis phase) |
| — | `chapter_event_inner` | `None` (будет заполнен в synthesis phase) |

**Ключевое отличие:** NER не генерирует `visual_summary`, `aliases`, `chapter_event_action/inner`. Эти поля заполняются на этапе LLM synthesis. Это означает, что Entity Wiki после NER phase содержит **базовую информацию** (имена, типы, позиции, mention counts), а после synthesis — **полную** (биографии, события, внешность).

### 3. Post-book phases (reduce -> dedup -> synthesis -> graph)

Текущий flow в `_process_book_async()` линейный:
```
1. Per-chapter processing (parallel, semaphore=10) -> 80% progress
2. ConsistencyManager.optimize_book_entities() -> 85% progress
3. EntityDeduplicationService.suggest_merges() + auto_merge -> 88% progress
4. EntitySynthesisService.synthesize_book_entities() -> 90% progress
5. GraphService.calculate_pagerank() -> 95% progress
6. ConsistencyManager.generate_master_references() -> 100% progress
```

**Изменения для гибридного pipeline:**

```
1. Per-chapter: NER + Classifier + Embedding (parallel)     -> 70% progress
2. Fuzzy dedup (SequenceMatcher + substring) — REUSE         -> 75% progress
3. Embedding-based alias detection (НОВОЕ)                   -> 80% progress
4. LLM dedup только для unresolved alias pairs (~5-10)       -> 85% progress
5. LLM synthesis — один batch call на книгу                  -> 90% progress
6. GraphService.calculate_pagerank() — REUSE                  -> 95% progress
7. ConsistencyManager.generate_master_references() — REUSE    -> 100% progress
```

Шаг 3 (embedding alias detection) — новый. Использует EmbeddingService для вычисления cosine similarity между entity names + their surrounding context. Пары с similarity 0.5-0.75 (не resolved fuzzy matching, но подозрительно похожие) отправляются на LLM dedup.

### 4. WebSocket progress notifications

`publish_book_progress()` уже используется для per-chapter progress. Гибридный pipeline отправляет те же WebSocket events с адаптированными messages:
- `"NER: глава X из Y"` вместо `"Обработка главы X из Y"`
- `"Классификация описаний..."` — новый шаг
- `"Embedding глав..."` — новый шаг
- Остальные messages без изменений

---

## Изменения модели данных

### Новые таблицы

#### `chapter_embeddings`
```sql
CREATE TABLE chapter_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding vector(384) NOT NULL,  -- e5-small dimensions
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(chapter_id, chunk_index)
);

-- IVFFlat index для vector search
CREATE INDEX idx_chapter_embeddings_vector
    ON chapter_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

**Оценка хранения:** 100 книг x 50 глав x 10 chunks x 384 dims x 4 bytes = ~75 MB. Пренебрежимо для 1 TB диска.

#### `nlp_processing_log` (опционально, для A/B метрик)
```sql
CREATE TABLE nlp_processing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    pipeline_version VARCHAR(50) NOT NULL,  -- "llm_only", "hybrid_v1"
    entities_found INTEGER DEFAULT 0,
    descriptions_found INTEGER DEFAULT 0,
    llm_calls INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(10,6) DEFAULT 0,
    processing_time_seconds FLOAT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Модифицируемые таблицы

#### `entities` — новые nullable поля
```sql
ALTER TABLE entities ADD COLUMN extraction_source VARCHAR(20) DEFAULT 'llm';
-- Значения: 'llm', 'gliner2', 'hybrid'
-- Для трассируемости: какой pipeline создал entity

ALTER TABLE entities ADD COLUMN ner_confidence FLOAT;
-- GLiNER2 score (0.0-1.0), NULL для LLM-extracted
```

#### `descriptions` — новые nullable поля
```sql
ALTER TABLE descriptions ADD COLUMN extraction_source VARCHAR(20) DEFAULT 'llm';
-- Значения: 'llm', 'classifier', 'hybrid'

ALTER TABLE descriptions ADD COLUMN classifier_confidence FLOAT;
-- ML classifier score, NULL для LLM-extracted

ALTER TABLE descriptions ADD COLUMN text_offset INTEGER;
-- Точная позиция в тексте главы (GLiNER2 дает character offsets)
```

### Обратная совместимость

Все новые поля **nullable** с defaults. Существующие данные (8 книг, 274 entities, 519 descriptions) не затрагиваются:
- `extraction_source` DEFAULT `'llm'` — корректно для текущих данных
- `ner_confidence` DEFAULT `NULL` — корректно для LLM-extracted
- `classifier_confidence` DEFAULT `NULL` — корректно для LLM-extracted
- `text_offset` DEFAULT `NULL` — корректно для LLM-extracted

Alembic migrations reversible (downgrade удаляет новые колонки/таблицы).

### Миграция PostgreSQL для pgvector

**Критически важно:** текущий `postgres:17.9-alpine` не содержит pgvector extension. Необходима смена Docker image.

**Стратегия миграции:**
1. `pg_dump` через существующий pgbackup (ежедневные бэкапы уже настроены)
2. Сменить image: `postgres:17.9-alpine` -> `pgvector/pgvector:pg17`
3. `docker compose up -d postgres` — volume persist, данные сохранены
4. Alembic migration: `CREATE EXTENSION IF NOT EXISTS vector;`
5. Verify: `SELECT * FROM pg_extension WHERE extname = 'vector';`

**Риск:** НИЗКИЙ. pgvector/pgvector:pg17 основан на official postgres:17. Volume `/var/lib/postgresql/data` совместим. БД 22 MB — восстановление из бэкапа < 1 секунды.

---

## Паттерны для следования

### Паттерн 1: Singleton NLP Model Manager

**Что:** Все NLP-модели загружаются один раз в lifetime Celery worker через singleton manager.

**Когда:** Celery worker startup (lazy load при первом использовании).

**Почему:** GLiNER2 (~800 MB) + e5-small (~500 MB) + TF-IDF (~20 MB) = ~1.3 GB в RAM. Загрузка занимает 6-9 секунд. Нельзя загружать на каждую задачу.

```python
# services/nlp_model_manager.py
class NLPModelManager:
    """
    Singleton lifecycle manager для NLP-моделей в Celery worker.

    Загружает модели lazy при первом использовании.
    Модели живут до рестарта worker (--max-tasks-per-child=0).
    """
    _instance: Optional["NLPModelManager"] = None
    _ner_service: Optional[NERService] = None
    _embedding_service: Optional[EmbeddingService] = None
    _description_classifier: Optional[DescriptionClassifier] = None
    _initialized: bool = False

    @classmethod
    def get_instance(cls) -> "NLPModelManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def ner(self) -> NERService:
        if self._ner_service is None:
            self._ner_service = NERService()
            self._ner_service.load_model()  # ~3-5 sec
        return self._ner_service

    @property
    def embedder(self) -> EmbeddingService:
        if self._embedding_service is None:
            self._embedding_service = EmbeddingService()
            self._embedding_service.load_model()  # ~2-3 sec
        return self._embedding_service

    @property
    def classifier(self) -> DescriptionClassifier:
        if self._description_classifier is None:
            self._description_classifier = DescriptionClassifier()
            self._description_classifier.load_model()  # <1 sec
        return self._description_classifier

    def health_check(self) -> dict:
        """Статус загрузки моделей для healthcheck endpoint."""
        return {
            "ner_loaded": self._ner_service is not None,
            "embedder_loaded": self._embedding_service is not None,
            "classifier_loaded": self._description_classifier is not None,
        }
```

### Паттерн 2: Feature Flag Gated Pipeline

**Что:** Гибридный pipeline активируется только через feature flags. Текущий pipeline остается по умолчанию.

**Когда:** Каждый вызов `process_chapter_safe()` в `book_tasks.py`.

```python
# В book_tasks.py, внутри process_chapter_safe()
from app.services.feature_flag_manager import FeatureFlagManager

async with AsyncSessionLocal() as session:
    flag_manager = FeatureFlagManager(session)
    use_hybrid = await flag_manager.is_enabled("USE_HYBRID_NLP")

    if use_hybrid:
        from app.services.hybrid_extractor import get_hybrid_extractor
        extractor = get_hybrid_extractor()
        result = await extractor.analyze_chapter(local_chapter.content)
    else:
        result = await gemini_extractor.analyze_chapter(local_chapter.content)

    # Downstream — идентично для обоих pipelines
    local_mgr = ConsistencyManager(session)
    entity_map = await local_mgr.process_chapter_analysis(...)
```

**Преимущество:** rollback к LLM pipeline — один SQL UPDATE в таблице feature_flags.

### Паттерн 3: Adapter для обратной совместимости

**Что:** `HybridExtractor.analyze_chapter()` возвращает `ChapterAnalysisResult` — тот же формат, что и `gemini_extractor.analyze_chapter()`.

**Почему:** Весь downstream code (`ConsistencyManager`, entity event creation, description saving) работает с `ChapterAnalysisResult`. Менять его — каскадный рефакторинг.

```python
# services/hybrid_extractor.py
class HybridExtractor:
    async def analyze_chapter(self, text: str) -> ChapterAnalysisResult:
        """Drop-in replacement для gemini_extractor.analyze_chapter()."""
        nlp = NLPModelManager.get_instance()

        # 1. NER
        ner_entities = await nlp.ner.extract_from_chapter(text, chapter_index=0)

        # 2. Description classification
        classified = await nlp.classifier.classify_chapter(text, entities=ner_entities)

        # 3. Adapt to existing format
        extracted_entities = [self._ner_to_extracted(e) for e in ner_entities]
        extracted_descriptions = [self._classified_to_extracted(s) for s in classified]

        # Relationships не извлекаются NER — пустой список.
        # Будут построены через co-occurrence в post-processing.
        return ChapterAnalysisResult(
            descriptions=extracted_descriptions,
            entities=extracted_entities,
            relationships=[],
        )
```

### Паттерн 4: Chunking с overlap для DeBERTa

**Что:** GLiNER2 основан на DeBERTa (max 512 tokens ~ 2000 русских символов). Длинные главы (30k chars) разбиваются на chunks.

**Когда:** `NERService.extract_from_chapter()`.

```python
def _chunk_text(self, text: str) -> list[tuple[str, int]]:
    """
    Разбить текст на chunks <= max_chars с sentence-boundary overlap.

    Returns: list of (chunk_text, start_offset)
    """
    sentences = self._split_sentences(text)  # regex-based
    chunks = []
    current_chunk = []
    current_start = 0
    current_len = 0

    for sent_text, sent_start in sentences:
        if current_len + len(sent_text) > self.config.max_chunk_chars:
            chunk_text = " ".join(s for s, _ in current_chunk)
            chunks.append((chunk_text, current_start))

            # Overlap: keep last N sentences
            overlap = current_chunk[-self.config.overlap_sentences:]
            current_chunk = overlap
            current_start = overlap[0][1] if overlap else sent_start
            current_len = sum(len(s) for s, _ in overlap)

        current_chunk.append((sent_text, sent_start))
        current_len += len(sent_text)

    if current_chunk:
        chunk_text = " ".join(s for s, _ in current_chunk)
        chunks.append((chunk_text, current_start))

    return chunks
```

**Важно:** entity offsets от GLiNER2 — относительно chunk. Нужно пересчитывать в абсолютные offsets относительно главы (добавить `chunk_start_offset`).

---

## Анти-паттерны для избежания

### Анти-паттерн 1: Загрузка моделей в каждом task

**Что:** Создание NERService / загрузка GLiNER2 внутри каждого `process_chapter_safe()`.

**Почему плохо:** 800 MB модель * 50 глав = OOM или 5-sec cold start на каждую главу. При `--max-tasks-per-child=100` worker перезапускается каждые 100 задач — модели выгружаются.

**Вместо:** Singleton NLPModelManager + `--max-tasks-per-child=0` + `--concurrency=1`.

### Анти-паттерн 2: Изменение ChapterAnalysisResult формата

**Что:** Добавление новых полей или изменение существующих в `ChapterAnalysisResult`.

**Почему плохо:** `ConsistencyManager.process_chapter_analysis()`, entity event creation, description saving — все завязаны на текущий формат. Изменение = каскадный рефакторинг 3+ файлов.

**Вместо:** Adapter pattern. `HybridExtractor` возвращает `ChapterAnalysisResult` с тем же контрактом. Новые поля (NER confidence, extraction_source) передаются отдельно и записываются в DB напрямую.

### Анти-паттерн 3: pgvector queries в Celery worker напрямую

**Что:** Выполнение vector search из Celery worker в hot path.

**Почему плохо:** Vector search не нужен в per-chapter processing. Embedding INSERT — да (через AsyncSessionLocal), search — нет.

**Вместо:** Embedding INSERT при обработке главы. Vector SEARCH — только в post-processing step (entity synthesis context retrieval) и FastAPI endpoints.

### Анти-паттерн 4: Одновременная миграция PG image И schema

**Что:** Сменить `postgres:17.9-alpine` на `pgvector/pgvector:pg17` и в том же deploy применить Alembic migration с `CREATE EXTENSION vector`.

**Почему плохо:** Если PG image не стартует (несовместимость, volume issue) — rollback невозможен с half-applied migration.

**Вместо:** Два шага: (1) сменить image, verify PG startup + data integrity. (2) Отдельный deploy: Alembic migration для extension + table creation.

---

## Масштабирование

| Параметр | Текущее (8 книг) | 100 книг | 1000 книг |
|----------|-------------------|----------|-----------|
| **DB size** | 22 MB | ~250 MB + 75 MB embeddings | ~2.5 GB + 750 MB embeddings |
| **Processing time** | 5-15 min/book (LLM) | ~2-5 min/book (hybrid) | ~2-5 min/book (hybrid) |
| **Celery concurrency** | 2 (LLM async) | 1 (NLP models in memory) | 1 (или 2 workers) |
| **RAM usage (worker)** | ~170 MB | ~2 GB (models loaded) | ~2 GB (models loaded) |
| **LLM cost/book** | ~$1.50 | ~$0.02-0.05 | ~$0.02-0.05 |
| **pgvector index** | N/A | IVFFlat (lists=100) | IVFFlat (lists=300) или HNSW |
| **Model loading** | N/A | 6-9 sec cold start | 6-9 sec cold start |

При 1000+ книг:
- pgvector index перестроить: IVFFlat lists = sqrt(N_vectors)
- Рассмотреть HNSW index (медленнее build, быстрее search)
- Отдельный NLP worker container (Вариант B) для горизонтального масштабирования
- Model caching: HuggingFace cache volume shared между containers

---

## Docker-конфигурация

### docker-compose.prod.yml — изменения

```yaml
# 1. PostgreSQL: pgvector image
postgres:
  image: pgvector/pgvector:pg17         # было: postgres:17.9-alpine
  container_name: fancai_postgres
  shm_size: 10g
  # Все остальные настройки (shared_buffers, effective_cache_size) — без изменений
  # Volume postgres_data — совместим, данные сохранены

# 2. Celery Worker: увеличенные ресурсы для NLP-моделей
celery-worker:
  image: fancai-backend:latest
  container_name: fancai_celery
  command: >
    celery -A app.core.celery_app worker
    --loglevel=${LOG_LEVEL:-info}
    --concurrency=1                       # было: ${CELERY_CONCURRENCY:-2}
    --max-tasks-per-child=0               # было: 100 (модели persist)
    --max-memory-per-child=0              # было: 512000 (отключить child restart)
    --prefetch-multiplier=1
  deploy:
    resources:
      limits:
        cpus: '4.0'                       # было: 1.5
        memory: 4096M                     # было: 1536M
      reservations:
        cpus: '1.0'                       # было: 0.3
        memory: 2048M                     # было: 512M
```

### Memory budget (4 GB Celery worker)

| Компонент | RAM | Статус |
|-----------|-----|--------|
| Python runtime + app code | ~300 MB | Постоянно |
| GLiNER2 (PyTorch, 205M params) | ~800 MB - 1.2 GB | Lazy load, persistent |
| multilingual-e5-small (118M params) | ~500 MB | Lazy load, persistent |
| TF-IDF classifier | ~20 MB | Lazy load, persistent |
| Peak inference overhead | ~200-400 MB | Transient |
| **Итого peak** | **~2.0-2.4 GB** | |
| **Headroom** | **~1.6-2.0 GB** | Достаточно |

### Общий resource budget сервера (32 GB, 12 vCPU)

| Компонент | CPU | RAM limit | RAM actual (est.) |
|-----------|-----|-----------|-------------------|
| PostgreSQL (pgvector) | 4.0 | 12 GB | ~50 MB (+pgvector index) |
| Backend (FastAPI) | 2.0 | 2 GB | ~316 MB |
| **Celery Worker (NLP)** | **4.0** | **4 GB** | **~2.0-2.4 GB** |
| Beat | 0.3 | 256 MB | ~98 MB |
| Redis | 0.5 | 768 MB | ~433 MB |
| Caddy | 0.5 | 128 MB | ~16 MB |
| Monitoring (5 containers) | ~1.0 | ~832 MB | ~587 MB |
| **Итого** | **~12.3** | **~20 GB** | **~3.5 GB** |
| **Свободно** | **~0 vCPU** | **~12 GB** | **~28.5 GB** |

CPU tight (12.3 из 12 vCPU в limits), но Celery worker и PostgreSQL не работают одновременно на полной нагрузке. Reservations (guaranteed) = ~3.5 vCPU — запас есть. Docker limits — soft caps, не hard walls.

---

## Порядок сборки с учетом зависимостей

### Dependency graph

```
Phase 0: Docker + pgvector (infrastructure)
  |
  +---> Phase 1: NERService + GLiNER2 (core extraction)
  |       |
  |       +---> Phase 3: Pipeline integration (book_tasks.py)
  |               |
  +---> Phase 2: DescriptionClassifier
  |       |
  |       +---> Phase 3: Pipeline integration (book_tasks.py)
  |
  +---> Phase 4: EmbeddingService + pgvector tables
          |
          +---> Phase 5: LLM Synthesis optimization (uses embeddings for context)
                  |
                  +---> Phase 6: Rollout + monitoring
```

### Рекомендуемый порядок

| # | Фаза | Зависит от | Параллелизация |
|---|------|-----------|----------------|
| 0 | Docker: pgvector image + Celery limits + NLP deps | — | Отдельно от всего |
| 1 | NERService + GLiNER2 + chunking + adapter | Phase 0 | Параллельно с Phase 2, Phase 4 |
| 2 | DescriptionClassifier + training data export | Phase 0 | Параллельно с Phase 1, Phase 4 |
| 3 | Pipeline integration: HybridExtractor + book_tasks.py + feature flags | Phase 1, Phase 2 | — |
| 4 | EmbeddingService + pgvector tables + Alembic migrations | Phase 0 | Параллельно с Phase 1, Phase 2 |
| 5 | LLM Synthesis optimization (batch call, embedding context) | Phase 3, Phase 4 | — |
| 6 | A/B testing + gradual rollout + cost monitoring | Phase 5 | — |

**Параллелизация:** Phases 1, 2, 4 можно начать одновременно после Phase 0. Critical path: 0 -> [1,2,4 parallel] -> 3 -> 5 -> 6 = **4 sequential phases** вместо 7.

---

## Ключевые интеграционные точки

### 1. `book_tasks.py:process_chapter_safe()` — основной switch

Строки 330-537 текущего файла. Feature flag определяет какой extractor использовать. Downstream code (ConsistencyManager, entity events, descriptions saving) — идентичен для обоих pipeline.

### 2. `ConsistencyManager.process_chapter_analysis()` — entity resolution

Принимает `ChapterAnalysisResult`. Гибридный pipeline возвращает тот же формат через adapter. **Без изменений** в ConsistencyManager.

### 3. `book_tasks.py` post-chapter phases — новый embedding alias step

Между текущими шагами `optimize_book_entities()` и `suggest_merges()` добавляется embedding-based alias detection. Результат: pre-filtered пары для LLM dedup (5-10 вместо all entities).

### 4. `celery_app.py` — worker configuration через env vars

Текущие:
- `CELERY_CONCURRENCY=2`, `CELERY_MAX_TASKS_PER_CHILD=100`, `CELERY_MAX_MEMORY_PER_CHILD=512000`

Новые:
- `CELERY_CONCURRENCY=1`, `CELERY_MAX_TASKS_PER_CHILD=0`, `CELERY_MAX_MEMORY_PER_CHILD=0`
- `GLINER_MODEL_NAME=fastino/gliner2-base-v1`, `EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small`

### 5. Feature flags — 4 новых default entries

`USE_HYBRID_NLP`, `USE_GLINER_NER`, `USE_DESCRIPTION_CLASSIFIER`, `USE_PGVECTOR_EMBEDDINGS` — все category `nlp`, все `enabled=False` по умолчанию. Granular control: можно включить NER без classifier, или embeddings без NER.

### 6. Alembic migrations — 3 отдельные миграции

1. `CREATE EXTENSION vector` + `chapter_embeddings` table
2. `ALTER TABLE entities ADD COLUMN extraction_source, ner_confidence`
3. `ALTER TABLE descriptions ADD COLUMN extraction_source, classifier_confidence, text_offset`

Отдельные миграции для атомарного rollback.

---

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|-----------|
| GLiNER2 quality на русском fiction < 70% recall | Средняя | Высокое | Go/No-Go после A/B на 5 книгах. Fallback: GLiNER1 multi-v2.1 или fine-tune |
| Docker image size bloat (torch ~700 MB) | Высокая | Низкое | CPU-only torch (`--index-url .../whl/cpu`). Multi-stage build |
| pgvector migration breaks production DB | Низкая | Критическое | pg_dump backup first, test на dev, volume compatibility verified |
| Memory OOM в Celery worker | Низкая | Высокое | 4 GB limit с ~1.6 GB headroom. Мониторинг через Netdata |
| Celery concurrency=1 throughput bottleneck | Средняя | Среднее | ~2-5 min/book приемлемо. При росте — 2 workers |
| Adapter loses information vs native integration | Низкая | Низкое | Adapter только для backward compat; новые поля пишутся напрямую |

---

## Источники

- `docs/research/rag-nlp-optimization-research.md` — основное исследование (HIGH confidence)
- `docs/research/rag-nlp-optimization-audit.md` — верификация исследования (HIGH confidence)
- `backend/app/tasks/book_tasks.py` — текущий pipeline (source code)
- `backend/app/services/gemini_extractor.py` — LLM extraction (source code)
- `backend/app/services/consistency_manager.py` — entity resolution (source code)
- `backend/app/services/entity_synthesis_service.py` — LLM synthesis (source code)
- `backend/app/services/entity_deduplication_service.py` — LLM dedup (source code)
- `docker-compose.prod.yml` — production infrastructure (source code)
- GLiNER2: `gliner2` v1.2.4 PyPI (Jan 2026) — MEDIUM confidence (not verified via Context7)
- pgvector: `pgvector/pgvector:pg17` Docker Hub — HIGH confidence (official image)
