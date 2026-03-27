# Pitfalls Research: Modal Batch Processing & Production Stability

**Domain:** Sub-batch vLLM processing, production semantics, error classification, OpenRouter fallback
**Researched:** 2026-03-27
**Confidence:** HIGH (верифицировано по production-коду commit `e5b430b`, FINAL-consolidated-audit.md, GitHub Issues, Modal docs)

---

## Critical Pitfalls

### Pitfall 1: Semantic corruption — `descriptions_extracted=True` при partial failures

**What goes wrong:**
`book_tasks.py:918` безусловно ставит `descriptions_extracted = True` и `descriptions_processing_error = None` **до** проверки failed chapters (строка 952). Книга с 10/23 failed chapters получает статус "успешно обработана". WebSocket публикует `status="completed"` (строка 929), push notification отправляется, кэш инвалидируется — пользователь видит "успех", но 43% контента отсутствует.

**Why it happens:**
Код писался для happy path, где extraction всегда завершается успешно. Проверка failed chapters добавлена позже как постфактум-логика, но не интегрирована в flow принятия решения о статусе.

**How to avoid:**
1. Перенести `descriptions_extracted = True` **после** `failed_chapters` query (строка 952)
2. Условие: `descriptions_extracted = (len(failed_chapters) == 0)`
3. При partial success: `descriptions_processing_error = f"{len(failed_chapters)}/{total_chapters} chapters failed"`
4. WebSocket status: `"completed_with_errors"` при `failed_chapters > 0`
5. **Reconciliation script**: найти все книги в БД с `descriptions_extracted=True` и `Chapter.parsing_error IS NOT NULL`, пометить для переобработки

**Warning signs:**
- Frontend показывает Entity Wiki как "полную", но пользователь не видит персонажей из поздних глав
- `descriptions_extracted=True` при `chapters_failed > 0` в task result JSON
- Push notification "Обработка завершена успешно!" при наличии ошибок в логах

**Phase to address:**
Phase 1 (P0 — первый приоритет, блокер для всего остального)

---

### Pitfall 2: Batch error isolation отсутствует — одна глава убивает весь sub-batch

**What goes wrong:**
vLLM Issue #16732 (CLOSED, `not_planned` stale bot) — ошибка валидации input одного запроса в batch **убивает весь batch**. При sub-batch из 8 глав, если одна глава слишком длинная или содержит невалидный input, `llm.chat(messages=[...])` бросает exception для всего вызова. Результаты обработки остальных 7 глав **теряются**.

**Why it happens:**
vLLM offline `LLM.chat()` не имеет per-request error isolation. `FinishReason.ERROR` существует в engine API, но описывается как "retryable internal request-level error" — это не graceful per-request isolation для input validation failures. PR по исправлению не мержился.

**How to avoid:**
1. **Pre-validation длин**: `estimated_tokens = len(text) / 3.5` (для русского). Если > `MAX_MODEL_LEN - max_tokens - system_prompt_tokens` (~32K tokens для input), выделить в отдельный sequential обработку
2. **Try-catch вокруг каждого sub-batch**: при падении sub-batch, retry каждой главы individually
3. **Checkpoint после каждого sub-batch**: сохранять результаты в БД до запуска следующего sub-batch
4. **Не класть oversized главы в batch**: отфильтровать и обработать отдельно

**Warning signs:**
- Весь sub-batch возвращает exception, хотя упала только одна глава
- Количество failed chapters кратно sub-batch size (все 8, не 1)
- Production логи: `Exception` без `chapter_id` — непонятно какая глава виновата

**Phase to address:**
Phase 3 (Sub-batch architecture) — pre-validation обязателен **до** внедрения batch

---

### Pitfall 3: 7x KV cache overestimation для Qwen3.5 (Issue #37121, OPEN)

**What goes wrong:**
Qwen3.5 — гибридная архитектура: 24 слоя GatedDeltaNet (O(1) state) + 8 слоёв Attention (O(n) KV). vLLM KV cache profiler считает все 32 слоя как Attention, завышая потребность в памяти в ~7 раз. Результат: аллоцируется мало KV cache blocks (или 0), ограничивая concurrency в batch mode. Потенциальная причина части production timeout'ов.

**Why it happens:**
`get_max_concurrency_for_kv_cache_config` и `unify_kv_cache_spec_page_size` используют uniform multipliers для всех layer groups. Mamba constant O(1) state падируется до attention page size. PR #37429 ("Fix KV cache sizing for hybrid models") — OPEN, NOT MERGED на 27.03.2026.

**How to avoid:**
1. Добавить `num_gpu_blocks_override` в `LLM()` init (`modal/llm_extractor.py`)
2. **Не hardcode 512** — репро из Issue сделан на 4B-AWQ + DGX Spark + v0.17.1, а не на 9B + L40S + v0.18.0
3. Провести profiling sweep: замерить `vllm` reported KV cache blocks с override=256, 512, 1024, без override
4. Вынести значение в `modal/config.py` как `NUM_GPU_BLOCKS_OVERRIDE`
5. Мониторить KV cache utilization в structured logging

**Warning signs:**
- vLLM при старте рапортует `num_gpu_blocks: 0` или аномально малое число
- Inference latency нелинейно растёт при увеличении batch size
- OOM при batch mode, но не при sequential

**Phase to address:**
Phase 1 (P0.5 — сразу после semantics fix, до sub-batch)

---

### Pitfall 4: Structured output ломается без `maxLength` — broken JSON при длинной генерации

**What goes wrong:**
`modal/schemas.py` — **ноль** `maxLength` constraints на всех string полях. Модель может генерировать строку произвольной длины, исчерпать `max_tokens=32768`, и создать незавершённый JSON. xgrammar FSM не может гарантировать закрытие JSON, если tokens закончились в середине string.

**Why it happens:**
Pydantic `Field()` по умолчанию не ставит `maxLength` в JSON Schema. Без explicit `max_length=N` xgrammar/guidance не ограничивают длину генерируемых строк. Первый `content` field в массиве descriptions может занять 90% max_tokens, оставляя 10% на entities/relationships — JSON обрезается.

**How to avoid:**
Добавить `max_length` на все string поля в `modal/schemas.py`:

| Поле | Рекомендация | Обоснование |
|------|-------------|-------------|
| `content` (description) | `max_length=2000` | ~500 слов, достаточно для visual scene |
| `image_prompt_en` | `max_length=300` | 30-60 слов по ТЗ |
| `visual_summary` | `max_length=500` | Внешность персонажа |
| `chapter_event_action` | `max_length=300` | Одно действие |
| `chapter_event_inner` | `max_length=300` | Одно переживание |
| `context` (relationship) | `max_length=300` | Контекст связи |
| `name` | `max_length=200` | Имя сущности |

**Нюанс**: xgrammar обрезает строку ровно на `maxLength` символов, без word boundary. Это **приемлемо** — обрезанное описание лучше broken JSON.

**Дополнительный нюанс**: если на поле есть `format` или `pattern`, то `maxLength` **игнорируется** (format/pattern имеет приоритет). В текущих схемах `format`/`pattern` не используются — безопасно.

**Warning signs:**
- `JSONDecodeError` в логах
- `finish_reason == "length"` — модель исчерпала max_tokens
- Главы с большим количеством entities (10+) чаще ломаются

**Phase to address:**
Phase 1 (P1 — сразу после `num_gpu_blocks_override`)

---

### Pitfall 5: Celery time budget overflow при sequential + повышенном timeout

**What goes wrong:**
`book_tasks.py:72-73`: `time_limit=10800` (3h hard), `soft_time_limit=10500` (2h55m). При `LLM_TIMEOUT=900` (предлагаемое повышение) и 23 главах sequential: 23 x 900s = 20700s = 5.75 часов — **вдвое превышает** Celery hard limit. Task убивается Celery, теряя все результаты.

**Why it happens:**
Celery time_limit — это wall-clock deadline на весь task, а не per-chapter. При sequential mode каждая глава обрабатывается последовательно. Повышение per-chapter timeout без учёта total budget — классическая ошибка.

**How to avoid:**
1. Добавить per-task time budget check: `remaining_budget = soft_time_limit - elapsed`. Если `remaining_budget < LLM_TIMEOUT`, прекратить обработку новых глав
2. При достижении budget: сохранить результаты обработанных глав, пометить книгу как `partial`
3. **Не поднимать LLM_TIMEOUT выше 900s** без одновременного снижения числа sequential обработок
4. В batch mode проблема менее острая: 3 sub-batch x 180s = 540s + cold start 130s = 670s — влезает с запасом

**Warning signs:**
- Celery task убит по `SoftTimeLimitExceeded` — все результаты потеряны
- Task статистика: большая часть глав обработана, но commit не произошёл
- Книга зависает в `is_processing=True` навсегда (пока cleanup task не подберёт)

**Phase to address:**
Phase 2 (одновременно с повышением timeout)

---

### Pitfall 6: `json.loads()` без защиты и без `finish_reason` проверки в `llm_extractor.py`

**What goes wrong:**
`llm_extractor.py:58` и `:78`: `json.loads(result[0].outputs[0].text)` — голый вызов без try/except. Если structured output обрезан (finish_reason="length") или модель сгенерировала невалидный JSON несмотря на FSM constraints, метод бросает `json.JSONDecodeError`. Это исключение пробрасывается через Modal RPC как `RemoteError`, теряя stacktrace и контекст.

**Why it happens:**
`json.loads()` — единственный способ десериализовать ответ vLLM. В happy path structured output гарантирует валидный JSON. Но при `finish_reason="length"` (исчерпание max_tokens) FSM может не завершить JSON корректно.

**How to avoid:**
1. Проверять `finish_reason` до `json.loads()`:
```python
finish_reason = result[0].outputs[0].finish_reason
if finish_reason == "length":
    logger.warning("Chapter truncated", finish_reason=finish_reason)
```
2. Оборачивать `json.loads()` в try/except с информативным сообщением:
```python
try:
    parsed = json.loads(result[0].outputs[0].text)
except json.JSONDecodeError as e:
    raise ValueError(f"JSON parse failed (finish_reason={finish_reason}): {e}") from e
```
3. Возвращать structured error dict вместо re-raise — чтобы caller мог отличить "JSON broken" от "Modal crashed"

**Warning signs:**
- `RemoteError` в логах book_tasks без понятной причины
- Потеря контекста ошибки: не видно какая глава, какой finish_reason

**Phase to address:**
Phase 1 (P3 — error classification)

---

### Pitfall 7: `reduce_entities` с `max_tokens=4096` — недостаточно для больших книг

**What goes wrong:**
`llm_extractor.py:69`: `max_tokens=4096` для reduce. При 100+ entities из 23 глав (реальная книга — 80-150 entities) JSON ответ reduce может превысить 4096 tokens. Результат: `finish_reason="length"`, обрезанный JSON, `JSONDecodeError`. Production уже показывает `JSONDecodeError` в reduce path.

**Why it happens:**
Значение 4096 взято из ранних тестов с малым количеством entities. `ModalReduceResponse` содержит `merge_operations: List[dict]` — при 50+ merge операциях JSON легко превышает 4096 tokens.

**How to avoid:**
1. Увеличить `max_tokens` в reduce до 8192-16384
2. Добавить `maxLength` на reduce schema (ограничить размер каждой merge operation)
3. При слишком большом наборе entities — делить на batches и reduce итеративно (уже реализовано в ConsistencyManager как `recursive batched reduce`, но не в Modal path)

**Warning signs:**
- `JSONDecodeError` именно в reduce path (а не extract)
- Книги с большим cast (эпики, серии) чаще ломаются
- `finish_reason="length"` при reduce вызовах

**Phase to address:**
Phase 1 (одновременно с maxLength для schemas)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `Semaphore(1)` для Modal | Не плодить GPU контейнеры | 107 мин на 23 главы, невозможность 100+ глав | Только для sequential стабилизации, не для production batch |
| Generic `except Exception` в book_tasks | Быстрая реализация | Невозможно отличить timeout от JSON error от crash — нет retry strategy | Никогда в production pipeline с external GPU |
| `json.loads()` без try/except в Modal | Меньше кода | Потеря контекста ошибки через Modal RPC boundary | Никогда |
| Auto backend для structured output | Не нужно выбирать | vLLM может выбрать неоптимальный backend для batch | Допустимо до benchmark matrix |
| `enable_gpu_snapshot=True` без sleep mode | "Может заработает" | Snapshot без offload weights может быть бесполезен | Только как эксперимент, не полагаться |
| Celery task = весь pipeline в одной функции | Простота | Невозможен partial retry, нет granular monitoring | Только при sequential mode с малым числом глав |

---

## Integration Gotchas

### Modal <-> VPS (Celery worker)

| Common Mistake | Correct Approach |
|----------------|------------------|
| `asyncio.to_thread(extractor.remote, ...)` без VPS-side timeout — если Modal завис, поток Celery заблокирован навсегда | `asyncio.wait_for(asyncio.to_thread(...), timeout=LLM_TIMEOUT + 60)` — запас на сетевой overhead |
| Catch `Exception` — теряется тип ошибки Modal | Catch отдельно: `modal.exception.FunctionTimeoutError`, `modal.exception.RemoteError`, `modal.exception.InputCancellation`, `json.JSONDecodeError` |
| `get_llm_extractor()` вызывается на каждую главу (создаёт новый handle) | Вызвать один раз и переиспользовать handle для всех глав книги |
| Не импортировать `modal` exceptions на VPS — `ImportError` если Modal SDK не установлен | Условный import с `try/except ImportError`, как уже сделано для `modal` в `modal_client.py` |

### vLLM <-> Pydantic schemas (structured output)

| Common Mistake | Correct Approach |
|----------------|------------------|
| Передать Pydantic model напрямую в `StructuredOutputsParams(json=...)` | Передать `model.model_json_schema()` — строковый JSON Schema |
| Полагаться на `auto` backend без проверки | Явно задать backend через `structured_outputs_config=StructuredOutputsConfig(backend="xgrammar")` для batch, или провести benchmark |
| Использовать `format`/`pattern` в schema совместно с `maxLength` | xgrammar **игнорирует** `maxLength` при наличии `format`/`pattern` — не совмещать |
| Включить thinking mode Qwen3.5 с structured output | Issue #35700: structured output конфликтует с thinking mode. Явно: `enable_thinking: false` в chat template |

### Celery <-> Modal (concurrency)

| Common Mistake | Correct Approach |
|----------------|------------------|
| Два Celery task одновременно обрабатывают разные книги через Modal | Global concurrency limit: не более 1-2 concurrent Modal GPU containers. Redis counter или `celery_app.control.inspect().active()` |
| `acks_late=True` без idempotency — task перезапускается при worker crash, дублируя Modal вызовы | Distributed lock per book (`book_tasks.py` уже имеет Redis lock — OK). Но нет lock на уровне Modal container count |
| Retry целой book task при partial failure | Retry только failed chapters, не всю книгу. Сохранять checkpoint после каждого sub-batch |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sub-batch size слишком большой (12+) при отсутствии batch error isolation | Один failed request убивает 12 глав вместо 4 | Начать с sub-batch=4, увеличивать по результатам benchmark | При первой oversized главе |
| `enable_prefix_caching=True` без common system prompt | Каждый запрос в batch имеет уникальный system prompt — prefix caching бесполезен | Убедиться, что system prompt идентичен для всех глав в batch (уже так в коде — OK) | Если кто-то добавит per-chapter prompt customization |
| Cold start 100-130s при каждой книге | Каждая книга ждёт 2+ минуты на старт | `scaledown_window=120` уже помогает. Compile cache volume (-30s). GPU snapshot (POC). | При burst нагрузке: 3+ книги за 5 минут |
| `max_tokens=32768` для коротких глав (1-2K слов) | GPU генерирует до max_tokens даже когда ответ 500 tokens (wasteful KV allocation) | Structured output FSM останавливает генерацию при завершении JSON schema — wasteful allocation есть, но не wasteful generation. Не проблема | Не ломается, но занимает KV cache slots |
| Два GPU контейнера одновременно (разные книги) | $3.90/hr вместо $1.95/hr | Global Celery concurrency limit для Modal tasks | При 3+ concurrent пользователях — $140/день |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` в `.env` без ротации | Утечка токена = доступ к GPU billing ($1.95/hr) | Ротация каждые 90 дней, ограничить scope токена в Modal dashboard |
| Отсутствие spending limit в Modal | Бесконечный billing при баге (infinite retry loop) | `modal.config.set_max_monthly_spend(100)` или через dashboard |
| User content передаётся напрямую в vLLM system prompt | Prompt injection через content книги | System prompt и user content чётко разделены через `<book_text>` tags — OK в текущем коде |
| `logger.opt(exception=True)` в Modal контейнере без Loguru | Исключение вместо логирования при Modal-only execution | Проверить каждый файл: если `from app.core.logging import logger` — Loguru — OK. В Modal контейнере нет `app.core.logging` — использовать stdlib `logging` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Push notification "Обработка завершена!" при 10/23 failed chapters | Пользователь думает всё готово, открывает Wiki — половина персонажей отсутствует | Notification с текстом: "Обработано 13 из 23 глав. Некоторые персонажи могут отсутствовать" |
| WebSocket `status="completed"` до проверки failed chapters | Frontend скрывает progress bar, показывает "Готово" | Два статуса: `"completed"` и `"completed_with_errors"` — frontend показывает предупреждение |
| Молчаливый пропуск failed chapters без индикации в UI | Пользователь не знает, что часть данных отсутствует | Badge или warning в Entity Wiki: "Обработано 13/23 глав" |
| Cold start 100-130s без feedback | Пользователь нажимает "Обработать", ничего не происходит 2 минуты | WebSocket progress: "Запуск GPU...", "Загрузка модели...", "Обработка главы 1/23..." |

---

## "Looks Done But Isn't" Checklist

- [ ] **Sub-batch метод**: `extract_chapters_batch()` добавлен, но нет pre-validation длин — первая oversized глава убивает весь batch
- [ ] **Error classification**: catch разделён по типам, но `modal.exception` не импортирован условно — `ImportError` на VPS без Modal SDK
- [ ] **maxLength в schemas**: добавлен на extract, но забыт на reduce — `ModalReduceResponse` по-прежнему без ограничений
- [ ] **Observability**: structured logging добавлен, но `finish_reason` не логируется — невозможно различить truncation vs crash
- [ ] **Timeout fix**: `LLM_TIMEOUT` повышен, но нет VPS-side timeout — `asyncio.to_thread()` может заблокировать Celery worker навсегда
- [ ] **GPU snapshot**: включен в `modal/app.py`, но `enable_sleep_mode` отсутствует в `LLM()` — snapshot может не работать для 9B моделей
- [ ] **OpenRouter fallback**: feature flag переключает Modal/OpenRouter, но нет автоматического fallback при Modal outage — ручное переключение
- [ ] **Reconciliation**: новый код корректен, но существующие inconsistent книги в БД не исправлены — нужен migration script
- [ ] **Concurrent books**: один GPU контейнер = OK, но два concurrent book tasks плодят два контейнера ($3.90/hr) — нет global limit
- [ ] **Reduce path**: `max_tokens` увеличен для extract, но `reduce_entities` по-прежнему 4096 — книги с 100+ entities ломаются

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Semantic corruption (books с `descriptions_extracted=True` + failed chapters) | LOW | SQL: `UPDATE books SET descriptions_extracted=false WHERE id IN (SELECT DISTINCT b.id FROM books b JOIN chapters c ON c.book_id=b.id WHERE b.descriptions_extracted=true AND c.parsing_error IS NOT NULL)` |
| Batch error kills sub-batch | MEDIUM | Retry failed chapters individually в sequential mode. Checkpoint уже сохранён — не нужно переобрабатывать успешные главы |
| KV cache overestimation (wrong override value) | LOW | Изменить `NUM_GPU_BLOCKS_OVERRIDE` в config, redeploy Modal app. Не нужен migration или data fix |
| Celery task killed by time limit | HIGH | Книга застревает в `is_processing=True`. `cleanup_tasks.py:137` подбирает через 4+ часа — но результаты потеряны. При checkpoint: LOW — retry только необработанные главы |
| Modal outage | LOW (если fallback реализован) | Feature flag `USE_MODAL_PIPELINE=false` → весь pipeline переключается на OpenRouter Gemini. Данные не теряются |
| `max_tokens` exceeded в reduce | LOW | Увеличить `max_tokens` в `llm_extractor.py`, redeploy. Retry reduce для пострадавших книг |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Semantic corruption (`descriptions_extracted` unconditional) | Phase 1: Production semantics | `SELECT count(*) FROM books WHERE descriptions_extracted=true AND EXISTS (SELECT 1 FROM chapters WHERE chapters.book_id=books.id AND parsing_error IS NOT NULL)` = 0 |
| KV cache overestimation (#37121) | Phase 1: Config fix + profiling | vLLM startup log shows non-zero `num_gpu_blocks`. Profiling report с разными override values |
| Broken JSON (no maxLength) | Phase 1: Schema constraints | `JSONDecodeError` rate < 5% на тестовой книге (23 главы). Все string fields в schemas.py имеют `max_length` |
| Generic exception handling | Phase 2: Error classification | `chapter.parsing_error` содержит structured `error_type` (timeout/json/modal/unknown). Логи содержат `finish_reason` |
| Celery time budget overflow | Phase 2: Time budget | Task не убивается по `SoftTimeLimitExceeded`. Книга с partial results получает `descriptions_extracted=false` |
| VPS-side timeout отсутствует | Phase 2: Timeout protection | `asyncio.wait_for()` оборачивает все `to_thread(modal.remote)` вызовы |
| Batch error isolation отсутствует | Phase 3: Sub-batch + pre-validation | Pre-validation: oversized chapters обрабатываются отдельно. Sub-batch failure retry: каждая глава individually |
| `reduce_entities` max_tokens=4096 | Phase 1: Schema constraints | Книга с 100+ entities: reduce завершается без `JSONDecodeError` |
| Concurrent Modal containers | Phase 3: Concurrency control | Redis counter ограничивает Modal GPU containers до 1-2 concurrent |
| OpenRouter fallback ручной | Phase 4: Auto-fallback | При `modal.exception.RemoteError` 3 раза подряд — автоматическое переключение на OpenRouter |

---

## Qwen3.5-specific Gotchas

Отдельная секция, потому что Qwen3.5 — hybrid architecture с уникальными проблемами.

### G1. Thinking mode + structured output (Issue #35700, OPEN)

Structured output constraints конфликтуют с reasoning/thinking mode. Issue открыт для Qwen3.5 27B FP8 в OpenAI-serving mode. Наш стек: 9B + offline `LLM.chat()` — вероятно работает в non-thinking mode, но не проверено explicit.

**Prevention**: явно отключить thinking mode. Если structured output ломается — добавить `enable_in_reasoning=True` через `structured_outputs_config`.

### G2. Format mismatch warning (Issue #37103, OPEN)

Корреляция с timeout'ами. Текущий production не задаёт explicit chat template — vLLM автоопределяет. При несовпадении — warning, потенциально деградация.

**Prevention**: зафиксировать chat template или убедиться, что auto-detect корректен для Qwen3.5-9B.

### G3. DeltaNet overhead в prefill

24/32 слоёв GatedDeltaNet — inference profile отличается от чистого Transformer. Prefill может быть медленнее ожидаемого (DeltaNet sequential dependency в recurrence). Batch mode может не дать линейный speedup.

**Prevention**: benchmark matrix с реальными данными, не экстраполяции. Ожидание 7-13x speedup, не 17x.

### G4. Новые баги structured output для Qwen3.5

27B variant уже имеет отдельный баг (открыт 2026-03-02). Может затронуть 9B. Structured output на Qwen3.5 — **работоспособная, но хрупкая** комбинация.

**Prevention**: pin vLLM version (0.18.0), CI smoke-test на тестовой главе, мониторить `finish_reason` distribution.

---

## Modal-specific Gotchas

### M1. GPU snapshot — alpha без примеров для `vllm.LLM`

`enable_gpu_snapshot=True` уже включён в production (`modal/app.py:43`). Но:
- Все примеры Modal — server mode (`vllm serve`), не offline `vllm.LLM`
- Benchmark'ы только до 3B моделей
- Для 9B — нет данных о restore time
- Может конфликтовать с `torch.compile`

**Prevention**: POC с замерами. Если не работает — fallback на compile cache volume (проще, надёжнее).

### M2. Cold start variability

Production: throughput от 6.33 до 84.16 tok/s, latency от 41s до 584s. Cold start может быть > 5 минут при GPU queueing или image pull.

**Prevention**: `startup_timeout` в Modal cls kwargs (Modal v1.1.4+). Compile cache volume для torch.compile артефактов.

### M3. Billing при scaledown

GPU оплачивается во время scaledown. `scaledown_window=120s` = $0.065 за idle период. `min_containers` и `buffer_containers` — оплачиваются полностью.

**Prevention**: `scaledown_window=60` после перехода на batch (быстрее обработка — меньше idle). Не использовать `min_containers` для L40S.

---

## Data Consistency при Partial Failures

Критический раздел для sub-batch архитектуры.

### D1. Entity graph неполный при partial sub-batch

Sub-batch 1 (главы 1-8) успешен. Sub-batch 2 (главы 9-16) упал. Relationships между entities из глав 1-8 и 9-16 **отсутствуют**. Entity Wiki показывает неполную картину.

**Prevention**: reduce/synthesis вызывать **только** после всех sub-batches. Если часть sub-batches упала — пометить книгу как `partial`, отложить reduce.

### D2. ConsistencyManager на неполных данных

ConsistencyManager работает на всех entities книги. При partial results может создать неконсистентные merge operations (дедупликация частично видимых entities).

**Prevention**: не запускать ConsistencyManager до завершения всех глав. Флаг `all_chapters_processed: bool` перед reduce phase.

### D3. Reduce вызывается после каждого sub-batch вместо одного раза

При неправильной интеграции sub-batch: reduce запускается после каждого sub-batch (3 раза вместо 1). Результат: неполная дедупликация, overhead на 3 GPU вызова.

**Prevention**: чёткое разделение: extract loop -> checkpoint -> reduce (один раз). Не вызывать reduce внутри sub-batch loop.

---

## Sources

### Production-код (commit `e5b430b`)
- `backend/app/tasks/book_tasks.py:914-920` — безусловный `descriptions_extracted=True`
- `modal/llm_extractor.py:58,78` — голый `json.loads()` без защиты
- `modal/schemas.py` — ноль `maxLength` constraints
- `modal/config.py` — отсутствует `NUM_GPU_BLOCKS_OVERRIDE`

### Аудит
- `docs/research/FINAL-consolidated-audit.md` — финальный аудит, перекрёстно проверен GPT 5.4 Codex

### GitHub Issues/PRs
- [Issue #16732](https://github.com/vllm-project/vllm/issues/16732) — batch error isolation (CLOSED, not_planned)
- [Issue #37121](https://github.com/vllm-project/vllm/issues/37121) — KV cache 7x overestimation (OPEN)
- [PR #37429](https://github.com/vllm-project/vllm/pull/37429) — fix hybrid KV cache (OPEN, NOT MERGED)
- [Issue #35700](https://github.com/vllm-project/vllm/issues/35700) — Qwen3.5 structured output + thinking mode (OPEN)
- [Issue #37103](https://github.com/vllm-project/vllm/issues/37103) — format mismatch warning (OPEN)

### Modal Documentation
- [Modal Pricing](https://modal.com/pricing) — L40S $1.95/hr
- [Modal GPU Snapshot](https://modal.com/docs/examples/gpu_snapshot) — alpha, примеры до 3B
- [Modal Memory Snapshots](https://modal.com/docs/guide/memory-snapshots) — ограничения
- [Modal Scaling](https://modal.com/docs/guide/scale) — scaledown billing

### vLLM Documentation
- [Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — backend selection
- [Sleep Mode](https://docs.vllm.ai/en/latest/features/sleep_mode/) — LLM class sleep/wake API
- [Qwen3.5 Recipe](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — usage guide

### Celery Best Practices
- [Celery Task Resilience (GitGuardian)](https://blog.gitguardian.com/celery-tasks-retries-errors/) — retry patterns
- [Advanced Celery (Vinta)](https://www.vintasoftware.com/blog/celery-wild-tips-and-tricks-run-async-tasks-real-world) — idempotency

---
*Pitfalls research for: Modal Batch Processing & Production Stability (v1.5)*
*Researched: 2026-03-27*
