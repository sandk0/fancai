# Финальный консолидированный аудит: Modal/vLLM batch processing

> **Дата**: 27 марта 2026
> **Аудитор**: Claude Opus 4.6 (max effort), веб-верификация + code review
> **Аудируемый корпус**: 5 документов, production код (commit `e5b430b`), production логи
> **Методология**: Параллельная перекрёстная верификация: 2 research-агента (vLLM, Modal), прямое чтение кода, GitHub Issues/PRs
> **Post-review**: перекрёстная проверка с аудитом GPT 5.4 Codex xhigh (`gpt54-modal-parallel-batch-unified-audit.md`). Исправлено: A4 (structured_outputs_config API), E1 (таблица). Подтверждено совпадение по всем стратегическим выводам.

---

## 1. Executive Summary

**Стратегическое направление верно. Реализация — в промежуточном состоянии. Экосистема менее зрелая, чем утверждает Gemini-аудит.**

Из пяти документов первый аудит (Claude, 7.5/10) наиболее надёжен по risk profile — production подтвердил его основные прогнозы: timeout'ы режут главы, structured JSON ломается, fallback необходим. Gemini-аудит (8.5/10, реальная оценка 4.5/10) систематически выдавал гипотезы за факты: Issue #16732 **НЕ исправлен**, Issue #37121 **НЕ исправлен**, batch error isolation **НЕ существует**. Consensus-отчёт верно идентифицировал production проблемы через SSH, но его план (P0-P9) требует коррекции по приоритетам и полноте.

Ключевые факты на 27 марта 2026:

- **Production уже на Modal**, но в sequential mode (Semaphore=1)
- **10/23 глав падают** на реальной книге (timeout + broken JSON)
- **`descriptions_extracted=True` ставится безусловно** — book_tasks.py:918
- **`num_gpu_blocks_override` отсутствует** в production-коде — bug #37121 не обойдён
- **`maxLength` отсутствует** в schemas — structured output хрупкий
- **Batch method не существует** в production `llm_extractor.py`
- **Sleep mode для LLM class работает** — рефактор в server mode НЕ нужен

---

## 2. Разрешение противоречий

### A1. Issue #16732 — per-request error handling в batch

| Документ     | Утверждение                                                        | Вердикт           |
| ------------ | ------------------------------------------------------------------ | ----------------- |
| Оригинал     | Закрыт как "not planned"                                           | **ВЕРНО**         |
| Первый аудит | Подтвердил — закрыт, not planned                                   | **ВЕРНО**         |
| Gemini-аудит | "OUTDATED — в v0.18.0 добавлена изоляция, `finish_reason="error"`" | **НЕВЕРНО**       |
| Аудит Gemini | "INCORRECT — issue всё ещё открыт"                                 | **ВЕРНО по сути** |
| Consensus    | "не подтверждено, что исправлен"                                   | **ВЕРНО**         |

**Evidence**: Issue #16732 закрыт 2025-12-28 **github-actions[bot]** (stale bot), state_reason: `not_planned`. Никакой PR не мержился. Кросс-ссылка PR #22761 не связана (type hint fix). В vLLM v0.18.0 release notes (2026-03-20) batch error isolation **не упоминается**.

`FinishReason.ERROR` действительно существует в engine API, но описывается как "retryable internal request-level error" — это **не** graceful per-request isolation для input validation failures в batch.

**Вывод**: Ошибка одного запроса в batch **по-прежнему может убить весь batch**. Sequential fallback и pre-validation длин **необходимы**.

---

### A2. Issue #37121 — 7x KV cache overestimation для Qwen3.5

| Документ     | Утверждение                                     | Вердикт             |
| ------------ | ----------------------------------------------- | ------------------- |
| Оригинал     | Баг. Override=512 необходим. PR #37124 в review | **ВЕРНО**, кроме PR |
| Первый аудит | PR #37124 закрыт, superseded #37429 (open)      | **ВЕРНО**           |
| Gemini-аудит | "FIXED в v0.18.0, layer-aware allocation"       | **НЕВЕРНО**         |
| Аудит Gemini | "INCORRECT — issue открыт, fix не merged"       | **ВЕРНО**           |
| Consensus    | "не подтверждено как fixed"                     | **ВЕРНО**           |

**Evidence**: Issue #37121 — OPEN на 27.03.2026. PR #37429 ("Fix KV cache sizing and allocation for hybrid Mamba/attention models") — OPEN, **NOT MERGED**.

vLLM v0.18.0 release notes не упоминают fix для hybrid model KV cache. "Hybrid KV Cache Manager" существует в документации, но добавлен ранее и **не решает** эту конкретную проблему overestimation.

**Вывод**: `num_gpu_blocks_override` **вероятно необходим** для Qwen3.5 на текущей vLLM. Текущий production-код **не использует override** — это потенциальный OOM risk или нулевая аллокация блоков. Однако repro из Issue #37121 сделан на Qwen3.5-4B-AWQ + DGX Spark + v0.17.1, а не на 9B + L40S + v0.18.0. Конкретное значение 512 — эмпирическое, не доказано как оптимум для нашего стека. Требует profiling sweep, а не догматического hardcode.

---

### A3. Sleep mode для vLLM LLM class

| Документ     | Утверждение                                                               | Вердикт            |
| ------------ | ------------------------------------------------------------------------- | ------------------ |
| Оригинал     | "LLM class не имеет sleep/wake API"                                       | **НЕВЕРНО**        |
| Первый аудит | "INCORRECT — `enable_sleep_mode=True` + `llm.sleep()/wake_up()` работают" | **ВЕРНО**          |
| Gemini-аудит | "Snapshot не требует server mode"                                         | **ЧАСТИЧНО ВЕРНО** |
| Consensus    | не затрагивает                                                            | —                  |

**Evidence**: В исходном коде vLLM, `enable_sleep_mode` передаётся через `**kwargs` в `EngineArgs` → `ModelConfig.enable_sleep_mode`. Методы `LLM.sleep(level=1, mode="abort")` и `LLM.wake_up()` — полноценные публичные методы. Тесты `tests/basic_correctness/test_cumem.py` подтверждают работу в offline mode.

Sleep levels:

- 0: пауза scheduling
- 1: offload weights в CPU RAM, discard KV
- 2: discard всё

**Но**: комбинация `vllm.LLM` + `@modal.enter(snap=True)` **не имеет ни одного официального примера** в Modal docs. Все примеры Modal с snapshot используют server mode (`vllm serve`). Modal docs предупреждают: "most Functions will need some of their code rewritten" для snapshot compatibility.

**Вывод**: Sleep mode в LLM class **работает**. Рефактор на server mode **не обязателен**. Но GPU snapshot с `vllm.LLM` — **непроверенная комбинация**, требует POC.

---

### A4. Синтаксис backend для structured output

| Документ     | Утверждение                                                          | Вердикт         |
| ------------ | -------------------------------------------------------------------- | --------------- |
| Оригинал     | `StructuredOutputsParams(backend="guidance")`                        | **НЕВЕРНО**     |
| Первый аудит | "`_backend` — private, используй `LLM(guided_decoding_backend=...)`" | **УСТАРЕЛО** ❌ |
| Gemini-аудит | "XGrammar лучше для batch с фиксированной схемой"                    | **ВЕРНО**       |

**Evidence**: В `vllm/sampling_params.py`:

```python
_backend: str | None = field(default=None, init=False)
# CAUTION: Should only be set by Processor._validate_structured_output
```

`GuidedDecodingParams` **полностью удалён** в v0.12.0, заменён на `StructuredOutputsParams`.

**КОРРЕКЦИЯ** (по результатам перекрёстной проверки с аудитом GPT 5.4 Codex):

Первый аудит рекомендовал `LLM(guided_decoding_backend="guidance")` — но `guided_decoding_backend` **удалён в v0.12.0** и **не существует** как параметр в v0.18.0. Он встречается в codebase только в deprecation notices.

Правильный API в v0.18.0 — `StructuredOutputsConfig`:

- CLI: `--structured-outputs-config.backend=guidance`
- Python LLM(): `structured_outputs_config=StructuredOutputsConfig(backend="guidance")`
- Или dict: `structured_outputs_config={"backend": "guidance"}`
- Default: `auto` (vLLM выбирает per-request)

```python
from vllm.config.structured_outputs import StructuredOutputsConfig

llm = LLM(
    model=LLM_MODEL_ID,
    structured_outputs_config=StructuredOutputsConfig(backend="guidance"),
    ...
)
```

Поля `StructuredOutputsConfig` (v0.18.0):

- `backend`: `"auto"` | `"xgrammar"` | `"guidance"` | `"outlines"` | `"lm-format-enforcer"`
- `disable_any_whitespace`: bool (default False)
- `disable_additional_properties`: bool (default False)
- `enable_in_reasoning`: bool (default False) — workaround для Issue #35700

**Источник**: [vllm/config/structured_outputs.py (v0.18.0)](https://github.com/vllm-project/vllm/blob/v0.18.0/vllm/config/structured_outputs.py)

**Вывод**: Per-request выбор backend **невозможен** через `StructuredOutputsParams`. Backend задаётся на уровне `LLM()` через `structured_outputs_config`. Текущий production-код не задаёт config — используется `auto` (default).

---

### A5. `compilation_config` — dict vs CompilationConfig

| Документ     | Утверждение                                             | Вердикт     |
| ------------ | ------------------------------------------------------- | ----------- |
| Оригинал     | `compilation_config={"cudagraph_capture_sizes": [...]}` | **ВЕРНО**   |
| Первый аудит | "PARTIALLY INCORRECT — нужен CompilationConfig object"  | **НЕВЕРНО** |

**Evidence**: В `vllm/entrypoints/llm.py`:

```python
compilation_config: int | dict[str, Any] | CompilationConfig | None = None,
```

Принимает:

- `int` → уровень оптимизации
- `dict` → автоконвертация через `CompilationConfig(**filtered_dict)`
- `CompilationConfig` → напрямую
- `None` → default

**Вывод**: Plain dict **работает**. Первый аудит ошибся в этом пункте. Код из оригинала корректен.

---

## 3. Верификация consensus-рекомендаций

### P0. Стабилизация production semantics

**Корректность: ПОДТВЕРЖДЕНА кодом.**

`book_tasks.py:914-920`:

```python
# Помечаем книгу как готовую с извлечёнными описаниями
book.is_processing = False
book.is_parsed = True
book.parsing_progress = 100
book.descriptions_extracted = True  # ← БЕЗУСЛОВНО
book.descriptions_processing_error = None  # ← СБРАСЫВАЕТ ОШИБКУ
await db.commit()
```

Проверка `failed_chapters` происходит **после** commit (строка 952-965). Результат: книга с 10/23 failed chapters получает `descriptions_extracted=True` и `descriptions_processing_error=None`.

**Пропущенные edge cases consensus'ом**:

1. WebSocket публикует `status="completed"` (строка 929) **до** проверки failed chapters
2. Push notification `send_book_ready_notification` (строка 990) отправляется безусловно
3. Cache invalidation (строка 937-948) происходит до подсчёта failed — пользователь видит "успех"

**Оценка**: P0 **критически важен** и описан правильно. Порядок — верный (первый приоритет).

---

### P1. Кодовые дефекты (logger.opt)

**Корректность: ПОДТВЕРЖДЕНА кодом.**

19 вхождений `logger.opt()` в 10 файлах backend:

- `book_tasks.py`: 5 мест (строки 162, 642, 658, 668, 704)
- `consistency_manager.py`: 1 (строка 787)
- `entity_synthesis_service.py`: 1 (строка 232)
- `pubsub.py`: 2 (строки 60, 89)
- `book_parser.py`: 2 (строки 360, 1085)
- `reading_sessions_tasks.py`: 4 (строки 85, 160, 176, 272)
- `main.py`: 1 (строка 472)
- `crud.py`: 1 (строка 207)
- `logging.py`: 1 (строка 11)
- `sync.py`: 1 (строка 568)

**Нюанс**: `app/core/logging.py` определяет logger через Loguru (`from loguru import logger`). Модули, которые импортируют из `app.core.logging`, получают Loguru logger — для них `logger.opt()` **корректен**. Проблема возникает только если:

- Модуль использует `logging.getLogger(__name__)` вместо импорта из `app.core.logging`
- ИЛИ Modal контейнер не имеет Loguru

Consensus **переоценил масштаб проблемы** — нужно проверить каждый файл на тип логгера.

**Оценка**: P1 важен для reduce/synthesis path. Приоритет верный.

---

### P2. maxLength в schemas

**Корректность: ПОДТВЕРЖДЕНА кодом и веб-верификацией.**

`modal/schemas.py` — **ноль** `maxLength`/`max_length` constraints:

- `ModalEntitySchema.visual_summary: str = Field(default="")` — без ограничений
- `ModalDescriptionSchema.content: str` — без ограничений
- `ModalRelationshipSchema.context: str = Field(default="")` — без ограничений

**Веб-верификация**: xgrammar **уважает** `maxLength` из JSON Schema. Ограничение: если на поле указан `format` или `pattern`, то `maxLength` **игнорируется** (format/pattern имеют приоритет). В наших схемах `format`/`pattern` не используются — `maxLength` будет работать.

**Рекомендуемые значения** (основаны на типичных output'ах):

| Поле                     | Рекомендация      | Обоснование                            |
| ------------------------ | ----------------- | -------------------------------------- |
| `content` (description)  | `max_length=2000` | ~500 слов, достаточно для visual scene |
| `image_prompt_en`        | `max_length=300`  | 30-60 слов по ТЗ                       |
| `visual_summary`         | `max_length=500`  | Внешность персонажа                    |
| `chapter_event_action`   | `max_length=300`  | Одно действие                          |
| `chapter_event_inner`    | `max_length=300`  | Одно переживание                       |
| `context` (relationship) | `max_length=300`  | Контекст связи                         |
| `name`                   | `max_length=200`  | Имя сущности                           |

**Риск truncation на полуслове**: FSM xgrammar обрезает строку ровно на `maxLength` символов, а не на границе слова. Это **приемлемо** — лучше обрезанное описание, чем broken JSON.

**Оценка**: P2 верен, полнота достаточна. Приоритет мог бы быть выше (P1).

---

### P3. Развести таймауты и ошибки по классам

**Корректность: ВЕРНО.**

Текущий код ловит только `Exception`:

```python
except Exception as e:
    local_chapter.parsing_error = str(e)[:1000]
```

Consensus правильно рекомендует отдельно ловить:

- `modal.exception.FunctionTimeoutError`
- `modal.exception.RemoteError`
- `json.JSONDecodeError`

**Дополнение**: стоит также ловить `modal.exception.InputCancellation` (видно в логах: "Received a cancellation signal").

**Оценка**: P3 верен и полон.

---

### P4. Временная стабилизация sequential path

**Корректность: ЧАСТИЧНО ВЕРНО.**

Consensus рекомендует поднять `LLM_TIMEOUT` выше 600. Текущее значение в `modal/config.py`: `LLM_TIMEOUT = 600`.

**Проблема**: поднятие timeout до 1200-1800 при Celery `time_limit=10800` (3h) и sequential mode (23 главы):

- 23 × 1800s = 41,400s = 11.5 часов — **не влезает** в Celery time limit
- 23 × 1200s = 27,600s = 7.7 часов — тоже не влезает
- Нужен time budget на уровне task, не на уровне chapter

**Скорректированная рекомендация**: поднять до 900s (15 мин) — компромисс между покрытием длинных глав и Celery budget. Одновременно добавить per-task deadline check.

**Оценка**: P4 верен по направлению, но конкретное значение timeout требует калибровки.

---

### P5. Observability

**Корректность: ВЕРНО.**

Consensus описывает минимально необходимые метрики. Пропущено:

- **Стоимость per-book** — важно для бизнес-мониторинга
- **Modal container cold start time** — для оптимизации snapshot'ов
- **KV cache utilization** — для калибровки `num_gpu_blocks_override`

**Оценка**: P5 верен, но неполон. Приоритет — правильный (средний).

---

### P6. Pre-validation длины

**Корректность: ВЕРНО.**

Consensus рекомендует оценивать размер главы до отправки. Два варианта:

1. **chars-based heuristic**: `len(text) / 3.5 ≈ tokens` (для русского текста)
2. **tokenizer-based**: AutoTokenizer на backend worker

**Нюанс**: загрузка AutoTokenizer для Qwen3.5-9B — ~2-3 секунды + ~500MB RAM. Для Celery worker это разовая инициализация, приемлемо.

**Порог**: при `MAX_MODEL_LEN=65536` и `max_tokens=32768`: input должен быть < 65536 - 32768 = 32768 tokens. При русском тексте это ~115K символов. Практически все главы влезают. Но при снижении `MAX_MODEL_LEN` до 32768 — порог 0 tokens для input, что **невозможно**. Consensus не учёл, что текущий `MAX_MODEL_LEN=65536` — и это **правильно** для sequential mode.

**Оценка**: P6 верен. Приоритет — правильный.

---

### P7. Chunked sub-batch

**Корректность: ВЕРНО.**

Consensus рекомендует sub-batch 4→8→12. Это правильный подход для нескольких причин:

1. Batch error isolation отсутствует (A1) — crash одной главы убивает весь batch
2. Partial progress сохраняется между sub-batch'ами
3. Retry на уровне sub-batch, не всей книги

**Пропущенные детали**:

- **KV cache между sub-batches**: при последовательных `llm.chat()` вызовах vLLM **сбрасывает** KV cache (нет persistent state). Но `enable_prefix_caching=True` кеширует system prompt prefix — он общий для всех глав.
- **Overhead**: каждый `llm.chat()` вызов имеет overhead ~0.5-1s на scheduling. При 3 sub-batches это +1.5-3s — пренебрежимо.

**Оценка**: P7 верен и хорошо обоснован. Это **ключевой архитектурный шаг**.

---

### P8. xgrammar vs guidance

**Корректность: ВЕРНО, но требует уточнения.**

Веб-верификация:

- Default backend: `auto` (не xgrammar, как утверждают все документы)
- xgrammar: лучше throughput для fixed schema в batch
- guidance (LLGuidance): лучше TTFT, лучше для complex grammars

**Важная находка**: Issue #35700 (OPEN) — "Qwen3.5 structured output doesn't work" в thinking mode. Fix: `--structured-outputs-config.enable_in_reasoning=True` или non-thinking mode. Это **не упомянуто ни в одном из пяти документов**.

**Оценка**: P8 верен. Benchmark matrix — правильный подход. Но нужно также проверить thinking mode interaction.

---

### P9. Snapshots и инфраструктурная оптимизация

**Корректность: ВЕРНО по порядку.**

Consensus правильно ставит snapshots после correctness.

**Уточнения из веб-верификации**:

- GPU snapshots — **ALPHA**. Ограничения: несовместимо с multi-GPU, может конфликтовать с torch.compile
- Для моделей 9B+ **нет benchmark'ов** от Modal (тестировали до 3B)
- `vllm.LLM` + `snap=True` — **ноль официальных примеров** (все используют server mode)
- Ожидаемый restore time: **НЕИЗВЕСТЕН** для 9B. По аналогии с 3B (Ministral): ~12s → для 9B может быть ~20-30s

**Оценка**: P9 верен. Но effort и risk **выше**, чем оценивают все документы.

---

## 4. Пробелы всех документов

### C1. Concurrent users

**Ни один документ не рассматривает** сценарий двух одновременных обработок.

Текущее поведение:

- Redis lock в `book_tasks.py` предотвращает дублирование **одной книги**
- Но две **разные** книги → два параллельных Modal `.remote()` вызова
- Modal Starter plan: 10 concurrent GPU → обе книги получат контейнер
- Стоимость удваивается: 2 × $1.95/hr

При batch mode:

- Два контейнера с L40S = $3.90/hr
- При 3 concurrent пользователях: $5.85/hr → $140/день если нагрузка постоянная

**Рекомендация**: добавить global Celery concurrency limit для Modal tasks (не более 1-2 concurrent Modal containers). Использовать `celery_app.control.inspect().active()` или Redis counter.

---

### C2. Книги с 100+ главами

При sub-batch size 8: 100 глав = 13 sub-batches.

Оценка при текущих production числах:

- Cold start: ~110-130s (одноразовый)
- Inference per sub-batch 8: ~120-180s
- 13 × 150s = 1950s ≈ 32 мин inference
- Total: ~35 мин
- Cost: 35 мин × $1.95/60 = **$1.14** per book

При sequential mode: 100 × 4.7 мин = 470 мин ≈ **7.8 часов** → Celery timeout (3h)

**Вывод**: для 100+ глав текущий sequential mode **гарантированно ломается**. Sub-batch — **необходимость**, не оптимизация.

---

### C3. Rollback plan

**Полностью отсутствует** во всех документах.

Текущее состояние: `USE_MODAL_PIPELINE` feature flag уже включён. Rollback = выключение флага. Но:

1. Книги, обработанные через Modal с partial failures, уже в БД с `descriptions_extracted=True`
2. Откат флага не исправляет эти книги
3. Нужен скрипт reconciliation: найти все книги с `descriptions_extracted=True` но failed chapters, пометить для переобработки

**Рекомендация**: добавить в P0 (стабилизация) ещё одно действие — написать migration/script для фиксации существующих inconsistent книг.

---

### C4. Observability для Modal

Consensus (P5) рекомендует метрики, но не описывает **как** собирать из Modal.

Варианты:

1. **Structured logging в Modal → `modal app logs`** — текущий подход, неструктурированный
2. **modal.Queue** — для progress reporting (уже описано в оригинале)
3. **Return metadata** — возвращать метрики вместе с результатом (проще всего)
4. **Prometheus push gateway** — overkill для текущего масштаба

**Рекомендация**: вариант 3 — возвращать из Modal `{"results": [...], "metrics": {"cold_start_ms": ..., "inference_ms": ..., "tokens_generated": ...}}`.

---

### C5. Data consistency при partial failures

При sub-batch архитектуре: sub-batch 1 (главы 1-8) успешен → сохранён в БД. Sub-batch 2 (главы 9-16) упал.

Проблемы:

1. **Entity graph неполный**: relationships между главами 1-8 и 9-16 отсутствуют
2. **ConsistencyManager** работает на всех entities книги — при partial results может создать неконсистентные merge operations
3. **Reduce/synthesis** вызывается после всех глав — при partial completion будет работать на неполных данных

**Рекомендация**:

- Reduce/synthesis вызывать **только** после обработки всех sub-batches
- Если часть sub-batches упала — пометить книгу как `partial`, отложить reduce
- Не запускать ConsistencyManager до завершения всех глав

---

### C6. Reduce/synthesis после batch

В текущем коде reduce вызывается **после** всех глав:

```python
extractor.reduce_entities.remote(entities_json, system_prompt, schema_json)
```

При sub-batch: reduce должен вызываться **один раз после всех sub-batches**, а не после каждого. Consensus не уточняет это.

**Дополнительная проблема**: `reduce_entities` в `llm_extractor.py` использует `max_tokens=4096` — при 100+ entities из 23 глав это может быть **недостаточно**. Production уже показывает `JSONDecodeError` в reduce.

**Рекомендация**: увеличить `max_tokens` в reduce до 8192-16384, добавить `maxLength` на reduce schema.

---

### C7. Model update path

При обновлении vLLM (0.18.0 → 0.19.0):

- `num_gpu_blocks_override` может стать не нужен (если PR #37429 merged)
- `compilation_config` API может измениться
- `structured_outputs_config` API может измениться (уже менялся: `guided_decoding_backend` → `structured_outputs_config`)

**Рекомендация**: вынести все vLLM-specific параметры в `modal/config.py` (частично уже сделано), добавить в CI smoke-test: `modal run llm_extractor.py::LLMExtractor.extract_chapter --chapter-text "test"`.

---

### C8. Cold start variability

Modal не публикует P50/P95/P99 для cold start.

Из production логов:

- Throughput колеблется: input speed от 6.33 до 84.16 tok/s
- Chapter latency: от 41s до 584s

Cold start может быть > 5 минут при:

- GPU queueing на загруженном кластере
- Image pull при обновлении vLLM
- torch.compile cache miss

**Рекомендация**: добавить `startup_timeout` в Modal cls kwargs (параметр появился в Modal v1.1.4).

---

### C9. Qwen3.5 + structured output в thinking mode (дополнительный risk signal)

**Ни один документ не упоминает** Issue #35700 (OPEN): "Qwen3.5 structured output doesn't work". Проблема: structured output constraints конфликтуют с reasoning/thinking mode.

**Калибровка** (по замечанию GPT 5.4): Issue #35700 открыт для Qwen3.5 **27B FP8** в OpenAI-serving mode, а docs note про `enable_in_reasoning` привязана к Qwen3 Coder models. Перенос на наш Qwen3.5-9B offline `LLM.chat()` path — **правдоподобная гипотеза, но не доказанный факт**. Текущий production-код не задаёт thinking mode → вероятно работает в non-thinking mode → вероятно OK.

**Рекомендация**: проверить на POC, а не вводить как blocker. Если structured output ломается — тогда добавить `enable_in_reasoning=True` через `structured_outputs_config`.

**Рекомендация**: явно отключить thinking mode в production: `{"enable_thinking": false}` в chat template kwargs (если поддерживается в offline mode).

---

### C10. `num_gpu_blocks_override` отсутствует в production (НОВОЕ)

Production `modal/llm_extractor.py` **не использует** `num_gpu_blocks_override`:

```python
self.llm = LLM(
    model=LLM_MODEL_ID,
    ...
    enable_prefix_caching=True,
    # НЕТ num_gpu_blocks_override!
)
```

При этом `modal/config.py` тоже **не содержит** `NUM_GPU_BLOCKS_OVERRIDE`.

С учётом Bug #37121 (7x overestimation, OPEN): vLLM может аллоцировать 0 или мало KV cache blocks → limited concurrency или OOM.

**Это может быть причиной части timeout'ов в production** — но repro из Issue дан для другой конфигурации (4B-AWQ + DGX Spark + v0.17.1). Для нашего 9B + L40S + v0.18.0 влияние не подтверждено напрямую.

**Рекомендация**: добавить `num_gpu_blocks_override` в production `llm_extractor.py` как высокоприоритетную гипотезу. Конкретное значение (512 или иное) определить через profiling — замерить `vllm` reported KV cache blocks с override и без.

---

## 5. Актуальное состояние технологий

### D1. vLLM v0.18.0

**Релиз**: 2026-03-20 (7 дней назад). Следующий: v0.18.1rc0 (2026-03-21).

**Ключевые фичи v0.18.0**:

- gRPC Serving Support
- GPU-less Render Serving (`vllm launch render`)
- NGram GPU Speculative Decoding
- KV Cache Offloading (CPU offloading, FlexKV)
- Eagle3 speculative decoding для Qwen3.5 и Kimi K2.5
- FlashInfer 0.6.6
- Elastic Expert Parallelism with NIXL
- 7 новых архитектур моделей

**Breaking changes**: Ray — больше не default dependency; `swap_space` parameter удалён; cascade attention отключён по default.

**НЕ включено**: batch error isolation, hybrid KV cache fix (#37121), sleep mode improvements.

**Источник**: [GitHub Release v0.18.0](https://github.com/vllm-project/vllm/releases/tag/v0.18.0)

---

### D2. Modal GPU snapshots

**Статус**: ALPHA (с августа 2025, по-прежнему alpha).

**Ограничения**:

- Несовместимо с multi-GPU (NCCL handles)
- Может конфликтовать с `torch.compile`
- vLLM/SGLang требуют "manual code changes: offloading weights/KV cache"
- Для `vllm.LLM` + `snap=True` — **ноль официальных примеров**

**Benchmark'и Modal** (только до 3B):

| Workload          | Без snapshot | С snapshot | Ускорение |
| ----------------- | ------------ | ---------- | --------- |
| vLLM Qwen2.5-0.5B | 45s          | 5s         | 9x        |
| Ministral 3 (3B)  | ~118s        | ~12s       | ~10x      |
| 9B (Qwen3.5)      | ~130s        | **?**      | **?**     |

**Вывод**: для 9B — **нет данных**. Экстраполяция: ~20-30s, но **не гарантировано**.

**Источники**: [Modal Blog GPU Mem Snapshots](https://modal.com/blog/gpu-mem-snapshots), [Modal GPU Snapshot Example](https://modal.com/docs/examples/gpu_snapshot)

---

### D3. Qwen3.5-9B structured output

**Известные проблемы**:

1. Issue #37121 (OPEN) — 7x KV cache overestimation → `num_gpu_blocks_override` необходим
2. Issue #35700 (OPEN) — structured output не работает в thinking mode
3. Issue #37103 (OPEN) — format mismatch warning, корреляция с timeouts
4. Новый баг Qwen3.5 27B structured output (открыт 2026-03-02) — может затронуть 9B

**Вывод**: Qwen3.5 + structured output — **работоспособная, но хрупкая** комбинация. Требует explicit non-thinking mode и `num_gpu_blocks_override`.

---

### D4. FlashInfer vs Triton backend

**Для L40S (Ada Lovelace, SM 8.9)**:

- **Default**: FLASH_ATTN (FlashAttention v2) — рекомендован
- **FlashInfer**: поддерживается, но на Ada Lovelace может быть медленнее FA2
- **Triton**: fallback, portable, всегда доступен, но медленнее dedicated backends
- **FlashAttention v3**: только Hopper (H100), не для L40S
- **FlashAttention v4**: только Blackwell, не для L40S

**Рекомендация**: оставить default (FLASH_ATTN). Переход на Triton даёт одно преимущество — уход от `nvidia/cuda:devel` image. Но ценой производительности.

**Текущий production**: использует `nvidia/cuda:12.8.1-devel-ubuntu22.04` и FlashInfer JIT (через `flashinfer-cubin` в pip). Это **работает**, но увеличивает image size.

**Источник**: [vLLM Attention Backends docs](https://docs.vllm.ai/en/latest/design/attention_backends/)

---

### D5. Modal concurrent containers и billing

- **GPU billing во время scaledown**: ДА, оплачивается
- **Pre-warming без оплаты**: НЕВОЗМОЖНО для GPU
- `min_containers` и `buffer_containers` — оба оплачиваются полностью
- **L40S pricing**: $1.95/hr ($0.000542/sec), per-second billing

**Оценка стоимости idle container**:

- `scaledown_window=120s`: $0.065 за idle период
- `scaledown_window=60s`: $0.033 за idle период

**Источник**: [Modal Pricing](https://modal.com/pricing), [Modal Scaling](https://modal.com/docs/guide/scale)

---

## 6. Code review текущего production

### E1. `modal/llm_extractor.py`

| Проверка                                | Результат                               |
| --------------------------------------- | --------------------------------------- |
| Batch method (`extract_chapters_batch`) | **ОТСУТСТВУЕТ**                         |
| Sleep mode (`enable_sleep_mode`)        | **ОТСУТСТВУЕТ**                         |
| `structured_outputs_config`             | **ОТСУТСТВУЕТ** (используется auto)     |
| `num_gpu_blocks_override`               | **ОТСУТСТВУЕТ** (Bug #37121 не обойдён) |
| `compilation_config`                    | **ОТСУТСТВУЕТ** (default CUDA graphs)   |
| `json.loads()` без защиты               | **ДА** — строки 58, 78                  |
| `finish_reason` проверка                | **ОТСУТСТВУЕТ**                         |

**Критический вывод**: production-код — минимальная реализация с двумя методами (`extract_chapter`, `reduce_entities`). Весь batch processing, sleep mode, error handling из исследований — **не реализован**.

---

### E2. `modal/config.py`

| Параметр                  | Текущее значение | Рекомендация              | Статус                  |
| ------------------------- | ---------------- | ------------------------- | ----------------------- |
| `LLM_TIMEOUT`             | 600              | 900-1200 (temporary)      | **Нужно поднять**       |
| `MAX_MODEL_LEN`           | 65536            | 65536 (OK для sequential) | **OK**                  |
| `GPU_MEMORY_UTILIZATION`  | 0.90             | 0.90 (OK)                 | **OK**                  |
| `KV_CACHE_DTYPE`          | fp8              | fp8 (OK)                  | **OK**                  |
| `NUM_GPU_BLOCKS_OVERRIDE` | **ОТСУТСТВУЕТ**  | 512                       | **КРИТИЧНО — добавить** |
| `SCALEDOWN_WINDOW`        | 120              | 60 (после batch)          | **OK для sequential**   |

---

### E3. `modal/schemas.py`

**Ноль** `maxLength` constraints:

- `ModalEntitySchema`: 8 полей, 0 с `max_length`
- `ModalDescriptionSchema`: 6 полей, 0 с `max_length`
- `ModalRelationshipSchema`: 5 полей, 0 с `max_length`
- `ModalExtractionResponse`: container schema, OK
- `ModalReduceResponse`: generic dict, не ограничивается

**Вывод**: production structured output **неограничен** — модель может генерировать строки любой длины, исчерпать `max_tokens`, и создать broken JSON.

---

### E4. `backend/app/tasks/book_tasks.py`

**Ключевые находки**:

1. **Строка 918**: `descriptions_extracted = True` — безусловно, до проверки failed chapters
2. **Строка 354**: `chapter_semaphore = asyncio.Semaphore(1 if use_modal else 10)` — sequential mode
3. **Строка 162**: `logger.opt(exception=True).error(...)` — Loguru API, потенциально OK если logger из `app.core.logging`
4. **Строки 642, 658, 668, 704**: больше `logger.opt()` вызовов
5. **Нет отдельной обработки** `FunctionTimeoutError`, `RemoteError`, `JSONDecodeError`
6. **Нет VPS-side timeout** на `asyncio.to_thread()` — если Modal завис, поток заблокирован

**Import check**: строка 23 — `from app.core.logging import logger`. Это **Loguru logger**. Значит `logger.opt()` в `book_tasks.py` **корректен**. Но в Modal контейнере (без Loguru) — падение.

---

### E5. `modal/app.py`

| Проверка                 | Результат                                                 |
| ------------------------ | --------------------------------------------------------- |
| `compile_cache_volume`   | **ОТСУТСТВУЕТ** (нет отдельного volume для compile cache) |
| `enable_memory_snapshot` | **ПРИСУТСТВУЕТ** (`True`)                                 |
| `enable_gpu_snapshot`    | **ПРИСУТСТВУЕТ** (`True` в experimental_options)          |
| `volumes`                | Только model_volume (`{VOLUME_PATH: model_volume}`)       |
| Image                    | `nvidia/cuda:12.8.1-devel-ubuntu22.04` — тяжёлый          |

**Важно**: `enable_memory_snapshot=True` и `enable_gpu_snapshot=True` **уже включены** в production. Без `sleep mode` в `llm_extractor.py` эффективность snapshot'ов **не проверена**. Modal docs говорят, что для сложных inference engines "код часто нужно переписывать", но не вводят общего правила "без sleep snapshot бесполезен". Реальный эффект для нашего стека — **POC-гипотеза**, а не факт.

---

## 7. Скорректированный план действий

### P0. Срочная стабилизация production semantics (БЛОКЕР)

**Effort**: LOW | **Impact**: CRITICAL | **Файлы**: `book_tasks.py`

1. Перенести `descriptions_extracted = True` ПОСЛЕ проверки `failed_chapters`
2. `descriptions_extracted = True` ТОЛЬКО если `len(failed_chapters) == 0`
3. Сохранять `descriptions_processing_error` при partial failures
4. WebSocket и push notification — учитывать `completed_with_errors`
5. **НОВОЕ**: reconciliation script для существующих inconsistent книг в БД

### P0.5. Добавить `num_gpu_blocks_override` (HIGH PRIORITY, требует profiling)

**Effort**: TRIVIAL (добавить) + LOW (профилировать) | **Impact**: HIGH | **Файлы**: `modal/config.py`, `modal/llm_extractor.py`

Bug #37121 (OPEN) может влиять на production. Без override vLLM может аллоцировать мало KV cache blocks. Однако repro из Issue — для другой конфигурации (4B-AWQ, DGX Spark, v0.17.1). Конкретное значение 512 — **стартовая гипотеза**, не доказанный оптимум. Добавить override и замерить vLLM reported blocks с/без.

### P1. Добавить `maxLength` в schemas

**Effort**: LOW | **Impact**: HIGH | **Файлы**: `modal/schemas.py`

Добавить `max_length` constraints на все string поля (значения из таблицы в разделе P2 верификации). Это **самый простой способ** снизить `JSONDecodeError` rate.

### P2. Развести ошибки по типам

**Effort**: LOW | **Impact**: MEDIUM | **Файлы**: `book_tasks.py`

Отдельный catch для `FunctionTimeoutError`, `RemoteError`, `JSONDecodeError`. Сохранять нормализованный `error_type` в `chapter.parsing_error`.

### P3. Добавить `finish_reason` проверку в `llm_extractor.py`

**Effort**: LOW | **Impact**: MEDIUM | **Файлы**: `modal/llm_extractor.py`

```python
if output.outputs[0].finish_reason == "length":
    logger.warning(f"Chapter truncated")
    # Attempt parse, but mark as potentially incomplete
```

### P4. Починить `logger.opt` в файлах, где logger ≠ Loguru

**Effort**: LOW | **Impact**: LOW-MEDIUM | **Файлы**: проверить каждый из 17 вхождений

Проверить для каждого файла: если `from app.core.logging import logger` → Loguru → OK. Если `import logging; logger = logging.getLogger(...)` → заменить `logger.opt(exception=True).error(...)` на `logger.error(..., exc_info=True)`.

### P5. Поднять `LLM_TIMEOUT` до 900s (временно)

**Effort**: TRIVIAL | **Impact**: MEDIUM | **Файлы**: `modal/config.py`

Не больше 900s — иначе при 23 sequential chapters не влезает в Celery budget (10500s soft limit).

### P6. Добавить VPS-side timeout

**Effort**: LOW | **Impact**: MEDIUM | **Файлы**: `book_tasks.py`

```python
result = await asyncio.wait_for(
    asyncio.to_thread(extractor.extract_chapter.remote, ...),
    timeout=LLM_TIMEOUT + 60  # запас на сетевой overhead
)
```

### P7. Observability (базовая)

**Effort**: MEDIUM | **Impact**: MEDIUM | **Файлы**: `book_tasks.py`, `modal/llm_extractor.py`

Structured logging per chapter: `chapter_id`, `duration_ms`, `result_type`, `error_type`, `finish_reason`.

### P8. Pre-validation длины

**Effort**: MEDIUM | **Impact**: MEDIUM | **Файлы**: `book_tasks.py`

Chars-based heuristic: `estimated_tokens = len(text) / 3.5`. Если > `MAX_MODEL_LEN - max_tokens - system_prompt_tokens`, пометить как `needs_truncation`.

### P9. Compile cache volume

**Effort**: LOW | **Impact**: MEDIUM | **Файлы**: `modal/app.py`, `modal/config.py`

Добавить отдельный volume для `~/.cache/vllm/`. Ожидаемый эффект: -30s cold start.

### P10. Sub-batch архитектура (ОСНОВНОЙ ШАГО)

**Effort**: HIGH | **Impact**: CRITICAL | **Файлы**: `modal/llm_extractor.py`, `book_tasks.py`, `modal/config.py`

1. Новый метод `extract_chapters_batch()` с `llm.chat(messages=[...])`
2. Sub-batch size: начать с 4, увеличивать до 8-12 по результатам
3. Checkpoint после каждого sub-batch
4. Retry failed chapters individually
5. Sequential fallback с time budget

### P11. Benchmark matrix

**Effort**: MEDIUM | **Impact**: HIGH | **Файлы**: новый скрипт

| Тест                            | Метрики                        |
| ------------------------------- | ------------------------------ |
| sequential vs sub-batch 4/8/12  | wall-clock, cost, success rate |
| xgrammar vs guidance (auto)     | JSON error rate, latency       |
| с/без `num_gpu_blocks_override` | OOM rate, throughput           |
| с/без compile cache volume      | cold start time                |

### P12. GPU snapshot POC

**Effort**: MEDIUM-HIGH | **Impact**: HIGH (если работает) | **Файлы**: `modal/llm_extractor.py`, `modal/app.py`

1. Добавить `enable_sleep_mode=True` в LLM()
2. Реализовать `@modal.enter(snap=True)` + `llm.sleep(level=1)` / `llm.wake_up()`
3. Замерить restore time для 9B модели
4. Если не работает с LLM class → fallback на server mode (effort HIGH)

---

## 8. Скорректированные benchmarks

**Калибровка** (по замечанию GPT 5.4): числа в колонке "Финальная оценка" — **расчётные диапазоны**, а не подтверждённые benchmark'ы для нашего стека. Production-числа (107 мин, 10/23, 13/23) воспроизводимы только из environment-артефактов (логи, БД), а не из codebase. Все latency/cost оценки для batch mode — гипотезы до POC.

### Единая таблица оценок

| Метрика                        | Оригинал | 1-й аудит  | Gemini  | Consensus | **Финальная оценка** | Обоснование                                                                        |
| ------------------------------ | -------- | ---------- | ------- | --------- | -------------------- | ---------------------------------------------------------------------------------- |
| **Cold start (no snapshot)**   | 30-60s   | 100-130s   | 15-25s  | ~130s     | **100-130s**         | Gemini ошибается (15-25s = со snapshot). Без snapshot Priority 1-3 дадут ~100-130s |
| **Cold start (snapshot)**      | ~12s     | ~12s       | 15-25s  | —         | **20-40s**           | 9B модель, alpha, нет benchmark'ов. Экстраполяция с 3B нелинейна                   |
| **Prefill 23×8K**              | 46s      | 46-90s     | 95s     | —         | **60-120s**          | DeltaNet overhead реален, но точное значение неизвестно                            |
| **Decode (92K tokens)**        | 184s     | —          | 210s    | —         | **180-280s**         | ~43 tok/s из production логов → 92K/43 ≈ 2140 tok → но structured output overhead  |
| **Total E2E (23 ch, batch)**   | 6 мин    | 5-7.5 мин  | 7-8 мин | —         | **8-15 мин**         | cold start + prefill + decode + parsing + network                                  |
| **Total E2E (sequential)**     | 107 мин  | —          | —       | 107 мин   | **107 мин**          | Подтверждено production                                                            |
| **Speedup**                    | 17x      | 14-21x     | 13-15x  | —         | **7-13x**            | Зависит от cold start и DeltaNet overhead                                          |
| **Cost per book (batch)**      | $0.20    | $0.26-0.39 | $0.25   | —         | **$0.26-0.49**       | $1.95/hr × (8-15 мин / 60)                                                         |
| **Cost per book (sequential)** | $3.51    | $3.48      | —       | —         | **$3.48**            | Подтверждено                                                                       |
| **Savings**                    | 94%      | 88-92%     | 93%     | —         | **86-93%**           | Значительная экономия в любом случае                                               |

### KV cache capacity

| Параметр                               | Значение                                     |
| -------------------------------------- | -------------------------------------------- |
| L40S VRAM total                        | 48 GB                                        |
| Model weights (BF16)                   | ~18 GB                                       |
| Available for KV cache                 | ~27.6 GB (при 0.95 utilization)              |
| KV per token (FP8, 8 attention layers) | ~16 KB                                       |
| Max concurrent tokens (FP8)            | ~1,725K tokens                               |
| Concurrent requests at 8K avg          | ~215 (теоретически, при правильном override) |
| Concurrent requests at 32K             | ~54                                          |

---

## 9. Risk matrix

| Шаг                              | Риск                             | Probability | Impact       | Mitigation                           |
| -------------------------------- | -------------------------------- | ----------- | ------------ | ------------------------------------ |
| **P0** Стабилизация semantics    | Regression в status reporting    | LOW         | MEDIUM       | Тесты на edge cases                  |
| **P0.5** num_gpu_blocks_override | Неоптимальное значение 512       | MEDIUM      | LOW          | Мониторить vLLM memory usage         |
| **P1** maxLength                 | Truncation полезного контента    | MEDIUM      | LOW          | Выбрать достаточные лимиты           |
| **P5** Timeout 900s              | Celery budget exceeded при retry | MEDIUM      | HIGH         | Time budget check в task             |
| **P10** Sub-batch                | Batch error kills sub-batch      | HIGH        | **HIGH**     | Pre-validation + time budget + retry |
| **P10** Sub-batch                | Qwen3.5 structured output issues | MEDIUM      | HIGH         | Issue #35700 workaround              |
| **P10** Sub-batch                | KV cache overestimation без fix  | HIGH        | **CRITICAL** | `num_gpu_blocks_override` (P0.5)     |
| **P12** GPU snapshot             | Не работает с vllm.LLM           | MEDIUM      | LOW          | Fallback на server mode              |
| **P12** GPU snapshot             | torch.compile conflict           | MEDIUM      | MEDIUM       | Тестировать в staging                |
| **P11** Benchmark                | Результаты хуже sequential       | LOW         | MEDIUM       | Feature flag rollback                |
| **ALL**                          | vLLM 0.18.0 regression           | LOW-MEDIUM  | HIGH         | Pin version, CI smoke test           |
| **ALL**                          | Modal outage / degradation       | LOW         | HIGH         | Feature flag → OpenRouter fallback   |

**Highest blast radius**: P10 (sub-batch) — затрагивает core processing pipeline. Требует staging тестирование на 3-5 реальных книгах перед production rollout.

**Самый рискованный шаг**: P10 + отсутствие batch error isolation (A1). Одна oversized глава может убить весь sub-batch. Mitigation: pre-validation длин (P8) **обязателен** перед P10.

---

## 10. Definition of Done

### Этап 1: Стабилизация (P0, P0.5, P1-P6)

- [ ] Книга с failed chapters **НЕ получает** `descriptions_extracted=true`
- [ ] `num_gpu_blocks_override=512` добавлен в production
- [ ] Все string поля в `modal/schemas.py` имеют `maxLength`
- [ ] `JSONDecodeError` rate снижен минимум на 50% (measurable через structured logging)
- [ ] Timeout rate снижен (LLM_TIMEOUT=900 + VPS-side timeout)
- [ ] Failure modes различимы по `error_type` в chapter records
- [ ] `finish_reason` логируется для каждой главы
- [ ] Существующие inconsistent книги в БД исправлены (reconciliation)

### Этап 2: Sub-batch (P8-P10)

- [ ] Benchmark matrix завершён на 3+ реальных книгах
- [ ] `extract_chapters_batch()` метод реализован и протестирован
- [ ] Sub-batch размер определён по benchmark'ам (ожидание: 4-8)
- [ ] Partial progress сохраняется после каждого sub-batch
- [ ] Retry logic работает на уровне failed chapters, не всего batch
- [ ] E2E время обработки 23 глав < 15 минут (sequential ~107 мин)
- [ ] Cost per book < $0.50 (sequential ~$3.48)
- [ ] Success rate > 95% chapters (текущий ~57%, 13/23)

### Этап 3: Оптимизация (P11-P12)

- [ ] Compile cache volume снижает cold start на > 20s
- [ ] GPU snapshot POC завершён, restore time измерен
- [ ] Feature flag позволяет A/B тестирование batch vs sequential
- [ ] Observability dashboard показывает success rate, latency P50/P95, cost per book

### Абсолютные критерии успеха

1. **Correctness**: ноль книг с `descriptions_extracted=true` при failed chapters
2. **Reliability**: success rate > 95% chapters per book
3. **Performance**: < 15 минут на 23 главы (batch mode)
4. **Cost**: < $0.50 per book (batch mode)
5. **Observability**: можно построить failure breakdown без ручного grep

---

## Приложение A: Проверенные источники

### GitHub Issues/PRs

| Ссылка                                                                            | Статус (27.03.2026)              |
| --------------------------------------------------------------------------------- | -------------------------------- |
| [Issue #16732](https://github.com/vllm-project/vllm/issues/16732)                 | CLOSED (stale bot, not_planned)  |
| [Issue #37121](https://github.com/vllm-project/vllm/issues/37121)                 | OPEN                             |
| [PR #37429](https://github.com/vllm-project/vllm/pull/37429)                      | OPEN, NOT MERGED                 |
| [PR #37124](https://github.com/vllm-project/vllm/pull/37124)                      | CLOSED (superseded)              |
| [Issue #35700](https://github.com/vllm-project/vllm/issues/35700)                 | OPEN (Qwen3.5 structured output) |
| [Issue #37103](https://github.com/vllm-project/vllm/issues/37103)                 | OPEN (format mismatch)           |
| [PR #8648](https://github.com/vllm-project/vllm/pull/8648)                        | MERGED (batch chat support)      |
| [Issue #8350](https://github.com/vllm-project/vllm/issues/8350)                   | CLOSED (known limitation)        |
| [vLLM v0.18.0 Release](https://github.com/vllm-project/vllm/releases/tag/v0.18.0) | Released 2026-03-20              |

### Modal

| Ссылка                                                                  | Содержание               |
| ----------------------------------------------------------------------- | ------------------------ |
| [Modal Pricing](https://modal.com/pricing)                              | L40S $1.95/hr confirmed  |
| [Modal GPU Snapshot](https://modal.com/docs/examples/gpu_snapshot)      | Alpha, examples up to 3B |
| [Modal Memory Snapshots](https://modal.com/docs/guide/memory-snapshots) | Guide with limitations   |
| [Modal Scaling](https://modal.com/docs/guide/scale)                     | scaledown_window billing |
| [Modal Timeouts](https://modal.com/docs/guide/timeouts)                 | 1s-24h range             |

### vLLM Documentation

| Ссылка                                                                            | Содержание                      |
| --------------------------------------------------------------------------------- | ------------------------------- |
| [Sleep Mode](https://docs.vllm.ai/en/latest/features/sleep_mode/)                 | LLM class sleep/wake API        |
| [Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) | Backend selection, auto default |
| [Attention Backends](https://docs.vllm.ai/en/latest/design/attention_backends/)   | FA2 default for Ada Lovelace    |

### Прочее

| Ссылка                                                                                               | Содержание                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [xgrammar maxLength](https://deepwiki.com/mlc-ai/xgrammar/5.2-regular-expression-to-ebnf-conversion) | maxLength respected, priority < format/pattern |
| [SqueezeBits benchmark](https://blog.squeezebits.com/70642)                                          | xgrammar vs guidance throughput                |
| [Qwen3.5-9B Model Card](https://huggingface.co/Qwen/Qwen3.5-9B)                                      | 24 GatedDeltaNet + 8 Attention                 |

---

## Приложение B: Оценка документов

| Документ                  | Оригинальная оценка | Скорректированная                     | Обоснование                                                          |
| ------------------------- | ------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Оригинальное исследование | —                   | **7.0/10**                            | Верная архитектура, 3 критических ошибки в коде, хорошее покрытие    |
| 1-й аудит (Claude)        | 7.5/10              | **8.0/10**                            | Наиболее надёжный risk profile, подтверждён production               |
| Gemini-аудит              | 8.5/10              | **4.0/10**                            | Систематические ложные утверждения о fix'ах, weak source attribution |
| Аудит Gemini (Claude)     | 4.5/10 Gemini       | **4.5/10 Gemini** — корректная оценка | Точно идентифицировал ложные выводы                                  |
| Consensus-отчёт           | —                   | **8.5/10**                            | Лучший документ корпуса: production verification, верные приоритеты  |
