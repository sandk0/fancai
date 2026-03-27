# Architecture Research: Modal Batch Processing & Production Stability

**Domain:** Интеграция sub-batch vLLM, стабилизация production semantics, error classification, observability, cold start оптимизация, OpenRouter fallback в существующий AI reader pipeline
**Researched:** 2026-03-27
**Confidence:** HIGH (основано на code review production-кода + FINAL-consolidated-audit.md)

---

## Обзор текущей архитектуры

```
┌────────────────────────────────────────────────────────────────────────┐
│                         VPS (fancai.ru)                                │
│                                                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  FastAPI     │  │  Celery       │  │  PostgreSQL  │  │   Redis    │ │
│  │  (routers/)  │──│  Worker       │──│  17          │  │   7.4      │ │
│  │             │  │  (tasks/)     │  │              │  │  DB0:cache │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────────┘  │  DB1:broker│ │
│         │                │                              │  DB2:result│ │
│         │                │                              └────────────┘ │
│         │                │                                             │
│         │    ┌───────────┴──────────────┐                             │
│         │    │                           │                             │
│         │    ▼                           ▼                             │
│         │  ┌──────────────┐   ┌───────────────────┐                   │
│         │  │ modal_client  │   │ gemini_extractor   │                  │
│         │  │ .py           │   │ .py (OpenRouter)   │                  │
│         │  └──────┬───────┘   └───────────────────┘                   │
│         │         │                                                    │
└─────────┼─────────┼────────────────────────────────────────────────────┘
          │         │
          │         │  .remote() через Modal SDK
          │         ▼
          │  ┌──────────────────────────────────────────────────┐
          │  │              Modal Cloud (GPU)                     │
          │  │                                                    │
          │  │  ┌─────────────────┐  ┌──────────────────────┐   │
          │  │  │ LLMExtractor    │  │ ImageGenerator        │   │
          │  │  │ L40S (48GB)     │  │ L4 (24GB)             │   │
          │  │  │ Qwen3.5-9B     │  │ FLUX.2 Klein           │   │
          │  │  │                 │  │                        │   │
          │  │  │ extract_chapter │  │ generate()             │   │
          │  │  │ reduce_entities │  │                        │   │
          │  │  └─────────────────┘  └──────────────────────┘   │
          │  │                                                    │
          │  └──────────────────────────────────────────────────┘
          │
          └──► OpenRouter API (Gemini 3 Flash / Claude Haiku 4.5 / Gemini 2.5 Flash Lite)
```

### Ответственности компонентов

| Компонент | Файл(ы) | Ответственность | Текущее состояние |
|-----------|---------|-----------------|-------------------|
| `book_tasks.py` | `backend/app/tasks/book_tasks.py` | Оркестрация обработки книги: chapters loop, entity consistency, dedup, synthesis, status update | Semaphore(1) для Modal, generic `except Exception`, безусловный `descriptions_extracted=True` |
| `modal_client.py` | `backend/app/services/modal_client.py` | Lazy-ссылки на Modal классы, конвертация ответа Modal -> `ChapterAnalysisResult` | Минимальная реализация, нет error handling |
| `llm_extractor.py` | `modal/llm_extractor.py` | vLLM inference: `extract_chapter` (single), `reduce_entities` | Нет batch метода, нет `finish_reason` проверки, нет `structured_outputs_config`, `json.loads()` без защиты |
| `config.py` | `modal/config.py` | Конфигурация vLLM/Modal | Нет `NUM_GPU_BLOCKS_OVERRIDE`, `LLM_TIMEOUT=600` |
| `schemas.py` | `modal/schemas.py` | Pydantic-схемы для structured output | Ноль `max_length` constraints |
| `app.py` | `modal/app.py` | Modal App definition, image builds, volumes | `enable_gpu_snapshot=True` уже включён, нет compile cache volume |
| `openrouter_client.py` | `backend/app/core/openrouter_client.py` | Unified OpenRouter client с fallback chain + circuit breaker | Зрелый, стабильный, раздельные breaker для LLM/Image |
| `gemini_extractor.py` | `backend/app/services/gemini_extractor.py` | Extraction через OpenRouter (legacy path) | Полнофункциональный, cache, retry, structured output |
| `consistency_manager.py` | `backend/app/services/consistency_manager.py` | Entity reduce, merge, graph consistency | Вызывает `reduce_entities.remote` через Modal |
| `Book` model | `backend/app/models/book.py` | Статус обработки: `is_processing`, `is_parsed`, `descriptions_extracted`, `descriptions_processing_error` | Boolean поля без промежуточных состояний |
| `Chapter` model | `backend/app/models/chapter.py` | Per-chapter статус: `is_description_parsed`, `parsing_error` | `parsing_error` -- свободный текст без типизации |

---

## Целевая архитектура (v1.5)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           VPS (fancai.ru)                                   │
│                                                                             │
│  ┌─────────────┐  ┌────────────────────────────────┐  ┌──────────────┐    │
│  │  FastAPI     │  │  Celery Worker                  │  │  PostgreSQL  │    │
│  │             │  │                                  │  │  17          │    │
│  └──────┬──────┘  │  ┌─────────────────────────┐    │  └──────────────┘    │
│         │         │  │ process_book_task        │    │                      │
│         │         │  │                          │    │  ┌────────────┐     │
│         │         │  │  ┌───────────────────┐   │    │  │   Redis    │     │
│         │         │  │  │ НОВЫЙ:             │   │    │  │   7.4     │     │
│         │         │  │  │ ChapterBatchRunner│   │    │  └────────────┘     │
│         │         │  │  │  - sub_batch(4-8) │   │    │                      │
│         │         │  │  │  - time_budget    │   │    │                      │
│         │         │  │  │  - error_classify │   │    │                      │
│         │         │  │  │  - progress_save  │   │    │                      │
│         │         │  │  └────────┬──────────┘   │    │                      │
│         │         │  │           │               │    │                      │
│         │         │  │  ┌────────┴──────────┐   │    │                      │
│         │         │  │  │ НОВЫЙ:             │   │    │                      │
│         │         │  │  │ ModalFallback-    │   │    │                      │
│         │         │  │  │  Controller       │   │    │                      │
│         │         │  │  │  - Modal primary  │   │    │                      │
│         │         │  │  │  - OpenRouter fbk │   │    │                      │
│         │         │  │  │  - circuit breaker│   │    │                      │
│         │         │  │  └────────┬──────────┘   │    │                      │
│         │         │  └───────────┼──────────────┘    │                      │
│         │         └──────────────┼────────────────────┘                     │
└─────────┼────────────────────────┼─────────────────────────────────────────┘
          │                        │
          │          ┌─────────────┴────────────────┐
          │          │                               │
          │          ▼                               ▼
          │   ┌──────────────────────┐   ┌──────────────────────┐
          │   │   Modal Cloud (GPU)   │   │ OpenRouter (fallback) │
          │   │                        │   │ Gemini 3 Flash        │
          │   │  LLMExtractor         │   │ + fallback chain      │
          │   │   ИЗМЕНЁН:             │   └──────────────────────┘
          │   │   + extract_batch()   │
          │   │   + structured_config │
          │   │   + finish_reason     │
          │   │   + metrics return    │
          │   │   + compile cache vol │
          │   └──────────────────────┘
          │
          └──► OpenRouter API (прямые запросы фронтенда)
```

---

## Новые компоненты

### 1. `ChapterBatchRunner` (НОВЫЙ класс)

**Файл:** `backend/app/services/chapter_batch_runner.py`
**Ответственность:** Оркестрация sub-batch обработки глав с checkpoint'ами

**Почему отдельный класс, а не изменение `book_tasks.py`:**
- `book_tasks.py` уже 1000+ строк с mixed concerns (loop, entity processing, status updates)
- Batch логика (chunking, retry, time budget, progress) -- самостоятельная ответственность
- Тестируемость: batch runner можно unit-тестировать без Celery

```python
# backend/app/services/chapter_batch_runner.py (концептуальная структура)

@dataclass
class BatchConfig:
    sub_batch_size: int = 4        # начальный размер, увеличивать по benchmark'ам
    max_time_budget_s: int = 9000  # 2.5 часа из 3-часового Celery limit
    retry_failed_individually: bool = True
    vps_timeout_buffer_s: int = 60  # запас на сетевой overhead

@dataclass
class ChapterResult:
    chapter_id: UUID
    chapter_index: int
    success: bool
    error_type: Optional[str]      # "timeout" | "json_error" | "modal_error" | "validation"
    error_detail: Optional[str]
    duration_ms: int
    finish_reason: Optional[str]
    extraction_result: Optional[ChapterAnalysisResult]

class ChapterBatchRunner:
    """Обработка глав sub-batch'ами с checkpoint'ами."""

    def __init__(self, config: BatchConfig, db: AsyncSession):
        ...

    async def process_all_chapters(
        self,
        chapters: list[Chapter],
        book_id: UUID,
        use_modal: bool,
    ) -> list[ChapterResult]:
        """
        1. Разбить chapters на sub-batches по config.sub_batch_size
        2. Для каждого sub-batch:
           a. Если use_modal -- вызвать extract_chapters_batch.remote()
           b. Если OpenRouter fallback -- вызвать gemini_extractor
           c. Checkpoint: сохранить результаты в БД после каждого sub-batch
           d. Проверить time_budget -- остановиться если превышен
        3. Retry failed chapters individually (если время позволяет)
        4. Вернуть полный список ChapterResult
        """

    async def _process_sub_batch_modal(
        self, chapters: list[Chapter], ...
    ) -> list[ChapterResult]:
        """Один sub-batch через Modal extract_chapters_batch."""
        ...

    async def _process_chapter_openrouter(
        self, chapter: Chapter, ...
    ) -> ChapterResult:
        """Один chapter через OpenRouter (fallback)."""
        ...

    def _estimate_time_remaining(self) -> float:
        """Оценка оставшегося time budget."""
        ...
```

**Взаимодействие с `book_tasks.py`:** `process_book_task` создаёт `ChapterBatchRunner` и вызывает `process_all_chapters()`, получая typed результаты вместо текущего untyped flow.

### 2. `ModalFallbackController` (НОВЫЙ класс)

**Файл:** `backend/app/services/modal_fallback_controller.py`
**Ответственность:** Решение Modal vs OpenRouter + circuit breaker для Modal

**Почему нужен:**
- Текущая логика `if use_modal: ... else: ...` в `book_tasks.py` -- примитивный if/else
- Нужен circuit breaker: если Modal падает N раз подряд, переключиться на OpenRouter для всей книги
- Feature flag + runtime health check = два уровня решения

```python
# backend/app/services/modal_fallback_controller.py (концептуальная структура)

class ModalFallbackController:
    """Контроллер выбора backend'а: Modal primary, OpenRouter fallback."""

    def __init__(self, db: AsyncSession):
        self._db = db
        self._modal_failures = 0
        self._modal_circuit_open = False

    async def get_extraction_backend(self) -> Literal["modal", "openrouter"]:
        """
        Решение: Modal или OpenRouter.
        1. Feature flag USE_MODAL_PIPELINE выключен -> openrouter
        2. Modal SDK не установлен -> openrouter
        3. Circuit breaker open (>3 consecutive failures) -> openrouter
        4. Иначе -> modal
        """

    def record_modal_success(self):
        """Сброс failure counter."""
        self._modal_failures = 0
        self._modal_circuit_open = False

    def record_modal_failure(self, error_type: str):
        """Инкремент failure counter, открытие circuit при threshold."""
        self._modal_failures += 1
        if self._modal_failures >= 3:
            self._modal_circuit_open = True
            logger.warning("Modal circuit breaker OPEN -- fallback to OpenRouter")
```

**Scope:** Один экземпляр на обработку книги (per-task lifecycle). Не global singleton, потому что concurrent tasks должны иметь независимые circuit breaker'ы.

### 3. `ErrorClassifier` (НОВЫЙ модуль)

**Файл:** `backend/app/services/error_classifier.py`
**Ответственность:** Классификация ошибок обработки глав

```python
# backend/app/services/error_classifier.py

class ChapterErrorType(str, Enum):
    TIMEOUT = "timeout"           # FunctionTimeoutError, asyncio.TimeoutError
    JSON_ERROR = "json_error"     # JSONDecodeError, broken JSON from LLM
    MODAL_ERROR = "modal_error"   # RemoteError, Modal infrastructure
    VALIDATION = "validation"     # Pydantic validation, schema mismatch
    CANCELLED = "cancelled"       # InputCancellation
    TRUNCATED = "truncated"       # finish_reason == "length"
    UNKNOWN = "unknown"           # всё остальное

def classify_chapter_error(error: Exception) -> tuple[ChapterErrorType, str]:
    """
    Классификация ошибки -> (тип, описание).
    Используется в ChapterBatchRunner и book_tasks.py.
    """
    if isinstance(error, modal.exception.FunctionTimeoutError):
        return ChapterErrorType.TIMEOUT, f"Modal timeout: {error}"
    elif isinstance(error, json.JSONDecodeError):
        return ChapterErrorType.JSON_ERROR, f"JSON parse failed: {error.msg}"
    elif isinstance(error, modal.exception.RemoteError):
        return ChapterErrorType.MODAL_ERROR, f"Modal remote: {error}"
    elif isinstance(error, modal.exception.InputCancellation):
        return ChapterErrorType.CANCELLED, f"Modal cancelled: {error}"
    ...
```

**Взаимодействие:** Записывает типизированную ошибку в `Chapter.parsing_error` в формате `[ERROR_TYPE] detail` или в новое поле `Chapter.error_type`.

---

## Модификации существующих компонентов

### 1. `modal/llm_extractor.py` -- СУЩЕСТВЕННЫЕ ИЗМЕНЕНИЯ

**Что добавить:**

| Изменение | Зачем | Effort |
|-----------|-------|--------|
| Метод `extract_chapters_batch()` | Sub-batch: обработка 4-8 глав одним вызовом в warm container | HIGH |
| `structured_outputs_config` в `LLM()` | Explicit backend выбор (xgrammar для batch) вместо `auto` | LOW |
| `num_gpu_blocks_override` в `LLM()` | Обход Bug #37121 (KV cache overestimation для Qwen3.5) | TRIVIAL |
| `finish_reason` проверка | Обнаружение truncated output до `json.loads()` | LOW |
| Возврат метрик вместе с результатом | `{"result": {...}, "metrics": {"duration_ms": ..., "finish_reason": ...}}` | LOW |
| Защищённый `json.loads()` с fallback | Try/except вместо голого `json.loads(result[0].outputs[0].text)` | LOW |

**Структура нового метода `extract_chapters_batch()`:**

```python
@modal.method()
def extract_chapters_batch(
    self,
    chapters: list[dict],  # [{"chapter_id": "...", "text": "...", "index": N}]
    system_prompt: str,
    schema_json: str,
) -> list[dict]:
    """
    Sub-batch extraction: обработка нескольких глав одним warm container.
    НЕ batch в терминах vLLM (один llm.chat вызов с несколькими messages) --
    а sequential llm.chat() вызовы в тёплом контейнере.

    Почему sequential, а не batch:
    - Batch error isolation отсутствует (Issue #16732, CLOSED not_planned)
    - Ошибка одной главы в batch убивает весь batch
    - Sequential в warm container: overhead ~0.5-1s на scheduling, пренебрежимо

    Преимущество перед текущим sequential:
    - Один cold start на все главы (не N .remote() вызовов)
    - enable_prefix_caching=True кеширует system prompt между главами
    """
    results = []
    for ch in chapters:
        start = time.time()
        try:
            params = SamplingParams(
                max_tokens=16384,
                temperature=0.1,
                structured_outputs=StructuredOutputsParams(json=schema_json),
            )
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"<book_text>{ch['text']}</book_text>"},
            ]
            output = self.llm.chat(messages, params)
            finish_reason = output[0].outputs[0].finish_reason
            text = output[0].outputs[0].text

            if finish_reason == "length":
                results.append({
                    "chapter_id": ch["chapter_id"],
                    "success": False,
                    "error_type": "truncated",
                    "metrics": {"duration_ms": int((time.time() - start) * 1000)},
                })
                continue

            parsed = json.loads(text)
            results.append({
                "chapter_id": ch["chapter_id"],
                "success": True,
                "result": parsed,
                "metrics": {
                    "duration_ms": int((time.time() - start) * 1000),
                    "finish_reason": str(finish_reason),
                },
            })
        except Exception as e:
            results.append({
                "chapter_id": ch["chapter_id"],
                "success": False,
                "error_type": type(e).__name__,
                "error_detail": str(e)[:500],
                "metrics": {"duration_ms": int((time.time() - start) * 1000)},
            })
    return results
```

**Ключевое архитектурное решение:** sub-batch = sequential `llm.chat()` вызовы в одном warm container, а НЕ один `llm.chat(messages=[batch])`. Причина: Issue #16732 (batch error isolation) закрыт как `not_planned` -- ошибка одного запроса в batch по-прежнему может убить весь batch.

### 2. `modal/schemas.py` -- УМЕРЕННЫЕ ИЗМЕНЕНИЯ

Добавить `max_length` constraints на все string поля:

```python
class ModalEntitySchema(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(default="character", max_length=50)
    visual_summary: str = Field(default="", max_length=500)
    chapter_event_action: Optional[str] = Field(None, max_length=300)
    chapter_event_inner: Optional[str] = Field(None, max_length=300)
    # ... остальные поля

class ModalDescriptionSchema(BaseModel):
    content: str = Field(max_length=2000)
    image_prompt_en: str = Field(default="", max_length=300)
    # ...

class ModalRelationshipSchema(BaseModel):
    context: str = Field(default="", max_length=300)
    # ...
```

xgrammar уважает `maxLength` из JSON Schema (верифицировано в аудите). При truncation обрезает на `maxLength` символов, не на границе слова -- приемлемо, лучше обрезанное описание чем broken JSON.

### 3. `modal/config.py` -- МИНОРНЫЕ ИЗМЕНЕНИЯ

```python
# Добавить:
NUM_GPU_BLOCKS_OVERRIDE = 512     # Обход Bug #37121 (KV cache overestimation)
LLM_TIMEOUT = 900                 # Поднять с 600 до 900 (временно до batch)
SUB_BATCH_SIZE = 4                # Начальный размер sub-batch

# compile cache
COMPILE_CACHE_VOLUME_NAME = "fancai-compile-cache"
COMPILE_CACHE_PATH = "/root/.cache/vllm"
```

### 4. `modal/app.py` -- МИНОРНЫЕ ИЗМЕНЕНИЯ

```python
# Добавить compile cache volume:
compile_cache_volume = modal.Volume.from_name(
    COMPILE_CACHE_VOLUME_NAME, create_if_missing=True
)

COMMON_CLS_KWARGS = dict(
    volumes={
        VOLUME_PATH: model_volume,
        COMPILE_CACHE_PATH: compile_cache_volume,   # НОВОЕ
    },
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
```

### 5. `backend/app/tasks/book_tasks.py` -- СУЩЕСТВЕННЫЕ ИЗМЕНЕНИЯ

**Что изменить:**

| Изменение | Строки | Зачем |
|-----------|--------|-------|
| Перенести `descriptions_extracted = True` ПОСЛЕ проверки `failed_chapters` | 914-920 | Семантическая корректность: partial failures != success |
| Заменить `chapter_semaphore` + loop на `ChapterBatchRunner` | 351-665 | Вынести batch логику в отдельный класс |
| Добавить `asyncio.wait_for()` wrapper для Modal calls | 443-448 | VPS-side timeout: если Modal завис, поток не заблокирован навечно |
| Условный WebSocket/push: `completed` vs `completed_with_errors` | 924-996 | Не обманывать пользователя при partial failure |
| Structured logging per chapter | через `ChapterResult` | Observability |

**Критическое изменение -- book status finalization:**

```python
# БЫЛО (строки 914-965):
book.descriptions_extracted = True  # безусловно
book.descriptions_processing_error = None
await db.commit()
# ... потом проверяем failed_chapters

# ДОЛЖНО СТАТЬ:
failed_chapters_result = await db.execute(
    select(Chapter.chapter_number, Chapter.parsing_error)
    .where(Chapter.book_id == book_id)
    .where(Chapter.parsing_error.isnot(None))
)
failed_chapters = [...]

total_chapters_count = len(chapters)
failed_count = len(failed_chapters)
success_count = total_chapters_count - failed_count

book.is_processing = False
book.is_parsed = True
book.parsing_progress = 100

if failed_count == 0:
    book.descriptions_extracted = True
    book.descriptions_processing_error = None
elif success_count > 0:
    book.descriptions_extracted = True  # partial success -- есть данные
    book.descriptions_processing_error = (
        f"Частичная обработка: {failed_count}/{total_chapters_count} глав с ошибками"
    )
else:
    book.descriptions_extracted = False
    book.descriptions_processing_error = "Все главы не обработаны"

await db.commit()

# WebSocket и push ПОСЛЕ commit, с корректным статусом
status = "completed" if failed_count == 0 else "completed_with_errors"
```

### 6. `backend/app/models/chapter.py` -- МИНОРНЫЕ ИЗМЕНЕНИЯ

Добавить типизированное поле для error classification:

```python
# Новый column
error_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
# Значения: "timeout", "json_error", "modal_error", "validation", "truncated", "cancelled"
```

**Рекомендация:** Добавить column `error_type` -- миграция тривиальная, зато query `SELECT error_type, COUNT(*) FROM chapters GROUP BY error_type` даёт instant observability.

---

## Data Flow: обработка книги (целевой)

### Основной flow (happy path)

```
process_book_task (Celery)
    |
    +-- 1. Загрузка книги, парсинг глав (существующий код)
    |
    +-- 2. ModalFallbackController.get_extraction_backend()
    |       |
    |       +-- "modal" --> ChapterBatchRunner.process_all_chapters()
    |       |                   |
    |       |                   +-- Sub-batch 1 (главы 1-4)
    |       |                   |   +-- extractor.extract_chapters_batch.remote()
    |       |                   |       +-- 4x sequential llm.chat() в warm container
    |       |                   |   +-- Checkpoint: сохранение в БД
    |       |                   |
    |       |                   +-- Sub-batch 2 (главы 5-8)
    |       |                   |   +-- (аналогично)
    |       |                   |
    |       |                   +-- ... Sub-batch N
    |       |                   |
    |       |                   +-- Retry failed chapters individually
    |       |                   |
    |       |                   +-- return list[ChapterResult]
    |       |
    |       +-- "openrouter" --> ChapterBatchRunner с OpenRouter backend
    |                               +-- Semaphore(10) параллельных запросов
    |
    +-- 3. Per-chapter entity/description processing (существующий код)
    |       ConsistencyManager, EntityEvents, Descriptions
    |       (вызывается на результатах из ChapterResult)
    |
    +-- 4. Post-processing (существующий код)
    |       Deduplication -> Synthesis -> Graph -> Master References
    |       ТОЛЬКО если все sub-batches завершены
    |
    +-- 5. Book status finalization (ИЗМЕНЁН)
            descriptions_extracted = (failed_count == 0)
            Conditional WebSocket / push notification
```

### Fallback flow (Modal down)

```
process_book_task
    |
    +-- ModalFallbackController -> "modal"
    |
    +-- Sub-batch 1: FunctionTimeoutError -> ErrorClassifier -> "timeout"
    |   +-- ModalFallbackController.record_modal_failure("timeout")
    |
    +-- Sub-batch 2: RemoteError -> ErrorClassifier -> "modal_error"
    |   +-- ModalFallbackController.record_modal_failure("modal_error")
    |       +-- failures >= 3 -> circuit OPEN
    |
    +-- Sub-batch 3+: ModalFallbackController -> "openrouter" (fallback)
    |   +-- gemini_extractor.analyze_chapter() для оставшихся глав
    |
    +-- Mixed results: часть через Modal, часть через OpenRouter
        +-- Book status: completed_with_errors (если были Modal failures)
```

---

## Архитектурные паттерны

### Паттерн 1: Sub-batch с Checkpoint

**Что:** Разбиение N глав на sub-batches по K штук, сохранение результатов после каждого sub-batch.
**Когда использовать:** Длительные операции с risk of partial failure.
**Trade-offs:**
- (+) Partial progress сохраняется при crash
- (+) Retry на уровне sub-batch, не всей книги
- (+) Time budget контролируется
- (-) Overhead на checkpoint (~100ms на commit)
- (-) Post-processing (reduce, synthesis) должен ждать всех sub-batches

### Паттерн 2: Provider Fallback с Circuit Breaker

**Что:** Primary provider (Modal) с автоматическим переключением на secondary (OpenRouter) при consecutive failures.
**Когда использовать:** Внешние API с разной стоимостью/надёжностью.
**Trade-offs:**
- (+) Resilience: книга обрабатывается даже при Modal outage
- (+) Прозрачность: один и тот же `ChapterBatchRunner` работает с обоими backend'ами
- (-) Разные backend'ы дают разное качество extraction (Qwen3.5-9B vs Gemini 3 Flash)
- (-) Cost разница: Modal ~$0.30/книга vs OpenRouter ~$0.05-0.10/книга (Gemini Flash дешевле)

### Паттерн 3: Structured Error Classification

**Что:** Типизация ошибок в enum вместо свободного текста.
**Когда использовать:** Когда нужен программный анализ failures (dashboard, retry logic).
**Trade-offs:**
- (+) Query по типу: `SELECT error_type, COUNT(*) GROUP BY error_type`
- (+) Разная retry стратегия: timeout -> retry, json_error -> retry с другим backend, modal_error -> fallback
- (-) Требует migration для нового column

### Паттерн 4: Metrics-in-Response

**Что:** Modal метод возвращает `{"result": ..., "metrics": {...}}` вместо только результата.
**Когда использовать:** Когда metrics collection из remote service ограничен (Modal не поддерживает Prometheus push).
**Trade-offs:**
- (+) Простейшая реализация: данные приходят с результатом
- (+) Нет dependency на внешние systems (Prometheus, Grafana)
- (-) Метрики недоступны при failure (если вызов полностью упал)

---

## Integration Points

### Внешние сервисы

| Сервис | Паттерн интеграции | Изменения в v1.5 |
|--------|-------------------|------------------|
| Modal GPU (LLM) | `modal.Cls.from_name().extract_chapters_batch.remote()` | Новый batch метод, возврат метрик |
| Modal GPU (Image) | `modal.Cls.from_name().generate.remote()` | Без изменений |
| OpenRouter API | `openrouter_client.generate_structured()` | Становится fallback для extraction при Modal failure |
| PostgreSQL | SQLAlchemy async, Alembic migrations | Новый column `Chapter.error_type`, возможно `Book.processing_mode` |
| Redis | DB0 cache, DB1 Celery broker, DB2 results | Без изменений |

### Внутренние границы

| Граница | Направление | Что передаётся | Изменения |
|---------|-------------|----------------|-----------|
| `book_tasks` -> `ChapterBatchRunner` | Вызов | `chapters`, `book_id`, `use_modal` | НОВОЕ: вся batch логика |
| `ChapterBatchRunner` -> `ModalFallbackController` | Вызов | `get_extraction_backend()` | НОВОЕ: решение Modal vs OpenRouter |
| `ChapterBatchRunner` -> `modal_client` | Вызов | `extract_chapters_batch.remote()` | Новый batch метод |
| `ChapterBatchRunner` -> `gemini_extractor` | Вызов | `analyze_chapter()` | Существующий API (fallback) |
| `ChapterBatchRunner` -> `ErrorClassifier` | Вызов | `classify_chapter_error(exception)` | НОВОЕ |
| `book_tasks` -> `consistency_manager` | Вызов | `process_chapter_analysis()` | Без изменений, но вызывается на результатах из `ChapterResult` |
| `modal_client` -> Modal Cloud | `.remote()` | chapters batch + schema | Новый метод |
| `llm_extractor` -> vLLM | `llm.chat()` | Sequential в warm container | Новая конфигурация LLM() |

---

## Рекомендуемая структура файлов

```
backend/
+-- app/
|   +-- services/
|   |   +-- chapter_batch_runner.py       # НОВЫЙ: sub-batch оркестрация
|   |   +-- modal_fallback_controller.py  # НОВЫЙ: Modal/OpenRouter routing
|   |   +-- error_classifier.py           # НОВЫЙ: типизация ошибок
|   |   +-- modal_client.py               # ИЗМЕНЁН: новый batch accessor
|   |   +-- consistency_manager.py        # НЕ ИЗМЕНЁН (вызывается по-старому)
|   |   +-- gemini_extractor.py           # НЕ ИЗМЕНЁН (fallback path)
|   +-- tasks/
|   |   +-- book_tasks.py                 # ИЗМЕНЁН: использует ChapterBatchRunner
|   +-- models/
|   |   +-- book.py                       # МИНОРНО: логика status finalization
|   |   +-- chapter.py                    # МИНОРНО: +error_type column
|   +-- core/
|       +-- openrouter_client.py          # НЕ ИЗМЕНЁН
|
modal/
+-- llm_extractor.py                      # ИЗМЕНЁН: +extract_chapters_batch, +config
+-- config.py                             # ИЗМЕНЁН: +NUM_GPU_BLOCKS_OVERRIDE, +timeout
+-- schemas.py                            # ИЗМЕНЁН: +max_length на все поля
+-- app.py                                # ИЗМЕНЁН: +compile_cache_volume
+-- image_generator.py                    # НЕ ИЗМЕНЁН
```

---

## Anti-Patterns

### Anti-Pattern 1: vLLM Batch API для multi-chapter

**Что делают:** Отправляют все главы в один `llm.chat(messages=[batch_of_N])` вызов.
**Почему плохо:** Issue #16732 (batch error isolation) закрыт как `not_planned`. Ошибка в одном запросе может убить весь batch. На 23 главах вероятность хотя бы одной ошибки высока.
**Вместо этого:** Sequential `llm.chat()` вызовы в одном warm container. Overhead ~0.5-1s per call -- пренебрежимо при 120-180s inference per chapter.

### Anti-Pattern 2: Global Circuit Breaker для Modal

**Что делают:** Один global singleton circuit breaker для всех concurrent book processing tasks.
**Почему плохо:** Один пользователь с книгой на 200 глав, где Modal падает на 3 из них, откроет circuit breaker для ВСЕХ пользователей.
**Вместо этого:** Per-task `ModalFallbackController` -- каждая книга имеет свой failure counter.

### Anti-Pattern 3: Reduce/Synthesis на partial results

**Что делают:** Запускают entity reduce и synthesis после каждого sub-batch.
**Почему плохо:** Entity graph неполный: relationships между главами разных sub-batches отсутствуют. ConsistencyManager на неполных данных создаёт неконсистентные merge operations.
**Вместо этого:** Reduce/synthesis вызывать ОДИН РАЗ после ВСЕХ sub-batches. Если часть упала -- пометить книгу как partial, отложить reduce.

### Anti-Pattern 4: Безусловный descriptions_extracted = True

**Что делают:** (ТЕКУЩИЙ КОД) Ставят `descriptions_extracted = True` до проверки failed chapters.
**Почему плохо:** Книга с 10/23 failed chapters получает `descriptions_extracted=True` и `descriptions_processing_error=None`. Пользователь видит "успех", но данные неполные.
**Вместо этого:** Проверять `failed_chapters` ДО установки флага. При partial failure -- `descriptions_extracted=True` + `descriptions_processing_error` с описанием.

---

## Scaling Considerations

| Scale | Архитектурные корректировки |
|-------|---------------------------|
| 1-5 concurrent books/day (текущий) | Один Modal container, sequential sub-batches. Celery concurrency limit = 1 Modal task. Cost: ~$1-2/день |
| 10-20 books/day | Два concurrent Modal containers (Celery concurrency limit = 2). Queue priority для коротких книг. Cost: ~$5-10/день |
| 50+ books/day | Redis queue с priority. Пулл контейнеров (Modal `min_containers=1`). Предвычисление token count для scheduling. Cost: ~$15-50/день, оценка OpenRouter fallback для дешёвых книг (<10 глав) |

### Узкие места (по порядку)

1. **Первое:** Celery worker -- один worker обрабатывает одну книгу за раз (time_limit 3h). При 50+ books/day -- очередь растёт. Решение: увеличить Celery workers (не Modal containers).
2. **Второе:** Modal GPU availability -- при нагрузке GPU queue на Modal может добавлять latency к cold start. Решение: `min_containers=1` (но $1.95/hr idle cost).
3. **Третье:** PostgreSQL writes -- при 100+ books/day commit после каждого sub-batch может создавать write contention. Решение: batch commit (N results за один commit).

---

## Рекомендуемый порядок реализации

Порядок обусловлен зависимостями и impact/effort:

```
Этап 1: Стабилизация (нет зависимостей между собой, можно параллельно)
+-- P0: Book status finalization fix (book_tasks.py:914-920)         <-- БЛОКЕР
+-- P0.5: num_gpu_blocks_override (modal/config.py, llm_extractor.py)
+-- P1: maxLength в schemas (modal/schemas.py)
+-- P2: Error classification (error_classifier.py + book_tasks.py)
+-- P3: finish_reason проверка (llm_extractor.py)
+-- P4: VPS-side timeout (book_tasks.py: asyncio.wait_for)
+-- P5: LLM_TIMEOUT = 900 (modal/config.py)

Этап 2: Observability + Pre-validation (зависит от P2, P3)
+-- P6: Structured logging per chapter
+-- P7: Chapter.error_type column (Alembic migration)
+-- P8: Pre-validation длины (chars heuristic перед Modal call)

Этап 3: Core batch (зависит от Этапа 1 + Этапа 2)
+-- P9: ChapterBatchRunner (новый класс)
+-- P10: extract_chapters_batch (modal/llm_extractor.py)
+-- P11: ModalFallbackController (новый класс)
+-- P12: Интеграция в book_tasks.py

Этап 4: Оптимизация (зависит от Этапа 3)
+-- P13: Compile cache volume (modal/app.py)
+-- P14: Benchmark matrix (новый скрипт)
+-- P15: GPU snapshot POC (если работает с vllm.LLM)
+-- P16: Reconciliation script для существующих inconsistent книг
```

**Ключевая зависимость:** P8 (pre-validation) ОБЯЗАТЕЛЕН перед P10 (batch). Без pre-validation oversized глава может убить весь sub-batch.

---

## Источники

- `docs/research/FINAL-consolidated-audit.md` -- финальный аудит, перекрёстно проверен GPT 5.4 Codex (HIGH confidence)
- Production code review: `modal/llm_extractor.py`, `modal/config.py`, `modal/schemas.py`, `modal/app.py`, `backend/app/tasks/book_tasks.py`, `backend/app/services/modal_client.py`, `backend/app/services/consistency_manager.py` (HIGH confidence)
- [vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732) -- batch error isolation, CLOSED not_planned (HIGH)
- [vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121) -- KV cache overestimation, OPEN (HIGH)
- [vLLM v0.18.0 Release](https://github.com/vllm-project/vllm/releases/tag/v0.18.0) (HIGH)
- [Modal GPU Snapshot docs](https://modal.com/docs/examples/gpu_snapshot) -- alpha, примеры до 3B (MEDIUM)

---
*Architecture research: fancai v1.5 Modal Batch Processing & Production Stability*
*Researched: 2026-03-27*
