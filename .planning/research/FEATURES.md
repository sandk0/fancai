# Feature Research: Modal Batch Processing & Production Stability

**Domain:** GPU-inference pipeline (vLLM/Modal) для AI-ридера
**Researched:** 2026-03-27
**Confidence:** HIGH (код проверен, аудит перекрёстно верифицирован GPT 5.4)

## Feature Landscape

### Table Stakes (без этого production сломан)

Фичи, отсутствие которых вызывает некорректное поведение в текущем production.

| Feature | Почему обязательно | Complexity | Зависимости и заметки |
|---------|-------------------|------------|----------------------|
| **Корректные статусы книг при partial failures** | Сейчас книга с 10/23 failed chapters получает `descriptions_extracted=True` (строка 918 `book_tasks.py`). WebSocket публикует `status="completed"`, push notification уходит безусловно. Пользователь видит "успех" при 43% failures | LOW | `book_tasks.py` — перенести `descriptions_extracted=True` ПОСЛЕ проверки `failed_chapters`. Добавить `completed_with_errors` в WebSocket и push. Зависит от: ничего |
| **maxLength constraints на string fields в schemas** | 0 из ~20 string полей имеют `max_length`. Модель генерирует строки неограниченной длины, исчерпывает `max_tokens=32768`, создаёт broken JSON. Production: 10/23 глав падают частично из-за этого | LOW | `modal/schemas.py` — добавить `max_length` на каждое поле. xgrammar уважает maxLength если нет `format`/`pattern` (наши схемы не используют). Зависит от: ничего |
| **Классификация ошибок по типам** | Сейчас один `except Exception as e` ловит всё. Timeout, broken JSON, Modal crash — неразличимы. Невозможно понять, какие главы retry-able, какие требуют другой стратегии | LOW | `book_tasks.py` — раздельный catch: `modal.exception.FunctionTimeoutError`, `modal.exception.RemoteError`, `json.JSONDecodeError`, `modal.exception.InputCancellation`. Сохранять `error_type` в `chapter.parsing_error`. Зависит от: ничего |
| **finish_reason проверка в llm_extractor** | Сейчас `json.loads(result[0].outputs[0].text)` без проверки `finish_reason`. Если `finish_reason=="length"` — output обрезан, JSON broken. Нет defensive parsing | LOW | `modal/llm_extractor.py` — проверять `finish_reason` перед `json.loads()`. При `"length"` — попытка parse + пометка как incomplete. Зависит от: ничего |
| **VPS-side timeout на Modal вызовы** | `asyncio.to_thread(extractor.extract_chapter.remote, ...)` без timeout. Если Modal завис — Celery поток заблокирован навсегда. Текущий `LLM_TIMEOUT=600` — только Modal-side | LOW | `book_tasks.py` — обернуть в `asyncio.wait_for(..., timeout=LLM_TIMEOUT + 60)`. Зависит от: ничего |
| **Reconciliation существующих inconsistent книг** | В БД уже есть книги с `descriptions_extracted=True` и failed chapters. Откат feature flag не исправит эти записи | LOW | Одноразовый скрипт/migration: найти книги с `descriptions_extracted=True` + chapters с `parsing_error IS NOT NULL`, пометить для переобработки. Зависит от: корректные статусы (P0) |

### Differentiators (ускорение и снижение стоимости)

Фичи, которые трансформируют production pipeline из хрупкого sequential в надёжный batch.

| Feature | Ценность | Complexity | Зависимости и заметки |
|---------|----------|------------|----------------------|
| **Sub-batch vLLM processing (chunked batch 4-8 глав)** | Ключевой архитектурный шаг. Sequential: 107 мин, ~$3.48/книга. Batch (оценка): 8-15 мин, ~$0.26-0.49/книга. Speedup 7-13x. Для книг 100+ глав sequential **гарантированно ломается** (превышает Celery 3h limit). Batch — необходимость, не оптимизация | HIGH | `modal/llm_extractor.py` — новый метод `extract_chapters_batch()` на основе `llm.chat(messages_list, params)` (batch chat API — merged PR #8648). Sub-batch по 4-8 глав, checkpoint после каждого sub-batch. **КРИТИЧНО**: batch error isolation отсутствует в vLLM (Issue #16732 closed not_planned) — crash одной главы убивает весь sub-batch. Mitigation: pre-validation длин обязательна перед batch. Зависит от: maxLength, finish_reason проверка, error classification, pre-validation |
| **Pre-validation длины глав** | Оценка `len(text) / 3.5 ~= tokens` для русского. При `MAX_MODEL_LEN=65536` и `max_tokens=32768` — input < 32768 tokens (~115K символов). Oversized глава в batch убивает весь sub-batch. Pre-validation — guard clause | MEDIUM | `book_tasks.py` — heuristic chars-to-tokens. Oversized главы маршрутизировать в sequential path или truncate. Опционально: загрузить AutoTokenizer для Qwen3.5-9B (~500MB RAM, ~2-3s init, разовая). Зависит от: ничего |
| **Structured observability (per-chapter метрики)** | Сейчас неструктурированные логи, grep по `modal app logs`. Невозможно: построить failure breakdown, отследить cost per book, выявить паттерны timeout. Structured logging — фундамент для оптимизации | MEDIUM | Два компонента: (1) `book_tasks.py` — structured JSON log per chapter: `chapter_id`, `duration_ms`, `result_type`, `error_type`, `finish_reason`. (2) Modal — возвращать метрики в response: `{"results": [...], "metrics": {"cold_start_ms": ..., "inference_ms": ..., "tokens_generated": ...}}`. Зависит от: error classification |
| **Compile cache volume** | Отдельный Modal Volume для `~/.cache/vllm/`. torch.compile артефакты переиспользуются между cold starts. Ожидаемый эффект: -30s cold start (текущий 100-130s без snapshot) | LOW | `modal/app.py` — добавить `compile_cache_volume = modal.Volume.from_name(...)`, примонтировать к `~/.cache/vllm/`. Зависит от: ничего |
| **num_gpu_blocks_override** | Bug #37121 (OPEN): 7x KV cache overestimation для Qwen3.5. vLLM может аллоцировать 0 или мало KV cache blocks. Production-код **не использует override**. Возможная причина части timeout'ов. Repro из Issue — для другой конфигурации (4B-AWQ, DGX Spark, v0.17.1), для 9B + L40S + v0.18.0 влияние не подтверждено напрямую | LOW (добавить) + LOW (профилировать) | `modal/config.py` + `modal/llm_extractor.py` — добавить `NUM_GPU_BLOCKS_OVERRIDE=512` как стартовую гипотезу. Замерить vLLM reported blocks с/без override. Зависит от: ничего |
| **OpenRouter fallback при недоступности Modal** | Feature flag `USE_MODAL_PIPELINE` уже существует. Автоматический переход: Modal timeout/crash -> OpenRouter (Gemini 3.0 Flash). Текущая реализация: ручное переключение флага. Нужно: автоматический fallback с circuit breaker | MEDIUM | `book_tasks.py` — при Modal failure (N consecutive errors или circuit breaker open) автоматически переключать на OpenRouter path. Обратное переключение — по расписанию или при ручном reset. Circuit breaker уже существует для LLM/Image. Зависит от: error classification (для разделения retryable/fatal) |
| **LLM_TIMEOUT подъём до 900s** | Текущие 600s недостаточны для длинных глав (production: chapter latency до 584s). 900s — компромисс: покрывает длинные главы, не ломает Celery budget (23 * 900 = 20700s при time_limit=10800s — но sequential дойдёт максимум до 12 глав) | TRIVIAL | `modal/config.py` — изменить `LLM_TIMEOUT = 900`. Одновременно добавить per-task deadline check в `book_tasks.py`. Зависит от: ничего |
| **Structured output backend selection** | Текущий production использует `auto` (default). xgrammar лучше для throughput с фиксированной схемой в batch. Guidance лучше для TTFT и complex grammars. Benchmark нужен | MEDIUM | `modal/llm_extractor.py` — добавить `structured_outputs_config=StructuredOutputsConfig(backend="xgrammar")` для batch path. API: `from vllm.config.structured_outputs import StructuredOutputsConfig`. Зависит от: sub-batch реализация |

### Anti-Features (не строить в v1.5)

| Feature | Почему кажется нужным | Почему проблематично | Альтернатива |
|---------|----------------------|---------------------|-------------|
| **GPU snapshot POC в основной milestone** | 10x cold start reduction (45s->5s для 0.5B, ~118s->12s для 3B). Для 9B: потенциально 130s->20-30s | Alpha с августа 2025 (8 месяцев). Ноль примеров `vllm.LLM` + `snap=True` в Modal docs (все примеры — server mode). Несовместимо с multi-GPU. Может конфликтовать с torch.compile. Для 9B+ моделей **нет benchmark'ов** от Modal. `enable_memory_snapshot=True` + `enable_gpu_snapshot=True` уже включены в production — эффект **неизвестен** без sleep mode | Compile cache volume (-30s) как первый шаг. GPU snapshot — отдельный POC после стабилизации batch. Если cold start критичен — перейти на server mode (effort HIGH) |
| **Server mode вместо LLM class** | Некоторые оптимизации доступны только в server mode (все примеры Modal). Sleep mode на LLM class **работает** (подтверждено кодом vLLM) | Рефактор всего pipeline: от `llm.chat()` к HTTP API. Ломает current architecture. Benefit — marginal для нашего use case (offline batch, не streaming) | Оставить LLM class. Sleep mode работает. Server mode — только если LLM class покажет blocker |
| **Автоматический scale-up до нескольких GPU контейнеров** | Параллельная обработка нескольких книг. Modal Starter plan: 10 concurrent GPU | 2 контейнера L40S = $3.90/hr. 3 — $5.85/hr. При постоянной нагрузке: $140/день. Ни один документ не рассматривает concurrent users. Текущий user base не требует | Global Celery concurrency limit: не более 1 concurrent Modal container. Queue книги, не масштабируй GPU |
| **Real-time progress из Modal через modal.Queue** | Пользователь видит прогресс по главам в реальном времени | Добавляет сложность cross-process communication. modal.Queue — дополнительная абстракция. Текущий WebSocket progress уже работает для VPS-side tracking | Return metadata в response объекте. Прогресс по sub-batch — через VPS-side loop |
| **Prometheus push gateway для Modal метрик** | "Правильная" observability инфраструктура | Overkill для текущего масштаба (1 user, <10 книг/день). Требует дополнительный сервис. Текущий Netdata + Dozzle достаточен | Structured logging + return metadata в Modal response. Агрегация — скриптом при необходимости |
| **Переход на FlashInfer/Triton backend** | Уход от тяжёлого `nvidia/cuda:devel` image. Triton — portable | На L40S (Ada Lovelace, SM 8.9) FlashAttention v2 — рекомендованный default. FlashInfer может быть медленнее FA2 на Ada. Triton — fallback, всегда медленнее. Ценой производительности | Оставить default (FLASH_ATTN). Тяжёлый image — цена FlashInfer JIT compilation, приемлемо |
| **Thinking mode для Qwen3.5** | Потенциально лучше quality extraction | Issue #35700 (OPEN): structured output не работает в thinking mode для Qwen3.5. Workaround: `enable_in_reasoning=True` через config — но непроверен для offline LLM class. Production работает в non-thinking mode | Явно отключить thinking: `{"enable_thinking": false}`. Не трогать до стабилизации batch |

## Feature Dependencies

```
[Корректные статусы книг]
    (не зависит ни от чего — первый приоритет)

[maxLength в schemas]
    (не зависит ни от чего — параллельно с P0)

[Классификация ошибок]
    (не зависит ни от чего — параллельно с P0)

[finish_reason проверка]
    (не зависит ни от чего — параллельно с P0)

[VPS-side timeout]
    (не зависит ни от чего — параллельно с P0)

[LLM_TIMEOUT 900s]
    (не зависит ни от чего — параллельно с P0)

[num_gpu_blocks_override]
    (не зависит ни от чего, но блокирует batch)

[Compile cache volume]
    (не зависит ни от чего — параллельно с любой фазой)

[Reconciliation БД]
    └──requires──> [Корректные статусы книг]
                   (сначала фикс логики, потом чистка данных)

[Structured observability]
    └──requires──> [Классификация ошибок]
                   (нужны error_type для structured log)

[Pre-validation длины]
    (не зависит ни от чего, но блокирует batch)

[Sub-batch processing]
    └──requires──> [maxLength в schemas]
    └──requires──> [finish_reason проверка]
    └──requires──> [Классификация ошибок]
    └──requires──> [Pre-validation длины]
    └──requires──> [num_gpu_blocks_override]
                   (batch без error isolation — oversized/broken главы убьют sub-batch)

[OpenRouter fallback]
    └──requires──> [Классификация ошибок]
    └──enhances──> [Sub-batch processing]
                   (fallback если batch path ненадёжен)

[SO backend selection]
    └──requires──> [Sub-batch processing]
                   (benchmark xgrammar vs auto имеет смысл только при batch)
```

### Заметки по зависимостям

- **Sub-batch requires pre-validation**: Без pre-validation одна oversized глава убивает весь sub-batch (batch error isolation отсутствует — Issue #16732 closed not_planned). Это **hard dependency**.
- **Sub-batch requires maxLength**: Без maxLength модель генерирует бесконечные строки, что увеличивает вероятность `finish_reason="length"` и broken JSON. В batch один broken JSON убивает sub-batch.
- **Sub-batch requires num_gpu_blocks_override**: Bug #37121 (7x KV cache overestimation) может вызвать OOM или near-zero allocation при batch load. Probability HIGH, impact CRITICAL.
- **Observability enhances всё остальное**: Structured logging нужен для дебага batch, для калибровки timeout'ов, для понимания cost. Но не hard dependency — можно реализовать параллельно.
- **OpenRouter fallback enhances sub-batch**: Если batch ненадёжен на ранних этапах — fallback на OpenRouter для retry'ов failed chapters.

## MVP рекомендация

### Этап 1: Стабилизация (все LOW complexity, параллельно)

Максимальный impact при минимальном effort. Все фичи независимы, можно реализовать в одной фазе.

- [x] **Корректные статусы книг** — BLOCKER. Каждая минута с текущим кодом создаёт inconsistent данные
- [x] **maxLength в schemas** — самый простой способ снизить JSONDecodeError rate
- [x] **Классификация ошибок** — фундамент для всех дальнейших шагов
- [x] **finish_reason проверка** — defensive parsing, LOW effort
- [x] **VPS-side timeout** — защита от зависших Modal вызовов
- [x] **LLM_TIMEOUT 900s** — покрытие длинных глав, TRIVIAL
- [x] **num_gpu_blocks_override** — гипотеза для снижения timeout rate
- [x] **Reconciliation БД** — чистка существующих inconsistent данных

### Этап 2: Sub-batch (HIGH complexity, ключевой шаг)

Реализация после стабилизации. Все pre-conditions из Этапа 1 выполнены.

- [x] **Pre-validation длины** — guard clause перед batch
- [x] **Sub-batch processing** — core архитектурный шаг (extract_chapters_batch)
- [x] **Structured observability** — мониторинг batch performance
- [x] **OpenRouter fallback** — safety net для batch failures

### Отложить (v1.6+)

- **GPU snapshot POC** — только после стабилизации batch. Alpha, без benchmark'ов для 9B
- **Compile cache volume** — LOW priority, можно добавить на любом этапе
- **SO backend benchmark** — xgrammar vs auto, имеет смысл только при стабильном batch
- **Benchmark matrix скрипт** — полезен, но ручное тестирование на 3-5 книгах достаточно для v1.5

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Обоснование |
|---------|-----------|-------------------|----------|-------------|
| Корректные статусы книг | HIGH | LOW | **P0** | Без этого пользователь видит "успех" при 43% failures |
| maxLength в schemas | HIGH | LOW | **P0** | Снижает JSONDecodeError, защищает batch |
| Классификация ошибок | MEDIUM | LOW | **P0** | Фундамент observability и fallback logic |
| finish_reason проверка | MEDIUM | LOW | **P0** | Defensive parsing, предотвращает crash на truncated output |
| VPS-side timeout | MEDIUM | LOW | **P0** | Защита от зависших Celery потоков |
| LLM_TIMEOUT 900s | MEDIUM | TRIVIAL | **P0** | Покрытие длинных глав |
| num_gpu_blocks_override | HIGH | LOW | **P0** | Потенциально снижает timeout rate, гипотеза для batch |
| Reconciliation БД | MEDIUM | LOW | **P0.5** | Чистка после фикса логики |
| Pre-validation длины | HIGH | MEDIUM | **P1** | Hard dependency для batch |
| Sub-batch processing | CRITICAL | HIGH | **P1** | 7-13x speedup, $3.48->$0.26-0.49/книга |
| Structured observability | MEDIUM | MEDIUM | **P1** | Мониторинг batch, дебаг failures |
| OpenRouter fallback | HIGH | MEDIUM | **P1** | Safety net при Modal failures |
| Compile cache volume | LOW | LOW | **P2** | -30s cold start, не критично |
| SO backend benchmark | LOW | MEDIUM | **P2** | Оптимизация после стабилизации |
| GPU snapshot POC | MEDIUM | MEDIUM-HIGH | **P3** | Alpha, непроверено для 9B, после batch |

## Технические ограничения экосистемы

Факты, проверенные кодом и GitHub Issues, влияющие на feature decisions.

| Ограничение | Источник | Impact на фичи |
|-------------|---------|---------------|
| Batch error isolation **отсутствует** | Issue #16732 (closed, not_planned). `FinishReason.ERROR` — retryable internal error, не graceful isolation | Sub-batch size ограничен. Pre-validation обязательна. Retry — на уровне failed chapters |
| 7x KV cache overestimation для Qwen3.5 | Issue #37121 (OPEN). PR #37429 NOT merged. Repro: 4B-AWQ, не 9B | num_gpu_blocks_override — стартовая гипотеза. Profiling sweep, не догматический hardcode=512 |
| Structured output + thinking mode **не работает** | Issue #35700 (OPEN). Калибровка: для 27B FP8 в server mode. Для 9B offline — гипотеза | Явно отключить thinking mode. Не включать `enable_in_reasoning` без POC |
| `GuidedDecodingParams` **удалён** в v0.12.0 | Код vLLM, deprecation notices | Использовать `StructuredOutputsConfig` для backend selection |
| GPU snapshots — **ALPHA** 8 месяцев | Modal docs, blog. Ноль примеров `vllm.LLM` + `snap=True` | Не включать в основной milestone. Отдельный POC |
| `llm.chat()` batch — **merged** | PR #8648, Issue #8481 closed as completed | Batch API доступен: `llm.chat(messages_list, sampling_params)` |
| Per-request выбор SO backend **невозможен** | `StructuredOutputsParams._backend` — private, set only by Processor | Backend задаётся на уровне `LLM()`, не per-request |
| Modal GPU billing: pre-warming **оплачивается** | Modal docs. `min_containers`, `buffer_containers` — полная оплата | Не использовать `min_containers` для GPU. Принять cold start |
| `max_tokens` в reduce слишком мал | Production `reduce_entities` использует `max_tokens=4096` — при 100+ entities broken JSON | Увеличить до 8192-16384, добавить maxLength на reduce schema |

## Источники

### Verified (HIGH confidence)

- Production код: `modal/llm_extractor.py`, `modal/schemas.py`, `modal/config.py`, `book_tasks.py` — прямой code review
- [FINAL-consolidated-audit.md](../../docs/research/FINAL-consolidated-audit.md) — перекрёстно проверен GPT 5.4 Codex
- [vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732) — batch error isolation, closed not_planned
- [vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121) — KV cache overestimation, OPEN
- [vLLM Issue #35700](https://github.com/vllm-project/vllm/issues/35700) — structured output + thinking, OPEN
- [vLLM PR #8648](https://github.com/vllm-project/vllm/pull/8648) — batch chat API, MERGED
- [vLLM v0.18.0 Release](https://github.com/vllm-project/vllm/releases/tag/v0.18.0) — release notes
- [Modal GPU Snapshot blog](https://modal.com/blog/gpu-mem-snapshots) — alpha status, benchmarks up to 3B
- [Modal Pricing](https://modal.com/pricing) — L40S $1.95/hr confirmed
- [xgrammar maxLength](https://deepwiki.com/mlc-ai/xgrammar/5.2-regular-expression-to-ebnf-conversion) — maxLength respected

### WebSearch-derived (MEDIUM confidence)

- [vLLM Structured Outputs docs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — backend selection, auto default
- [vLLM Batch LLM Inference](https://docs.vllm.ai/en/latest/examples/offline_inference/batch_llm_inference/) — batch patterns
- [Modal High-performance LLM inference guide](https://modal.com/docs/guide/high-performance-llm-inference) — compile cache, volumes
- [OpenRouter Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks) — fallback patterns

---
*Feature research for: v1.5 Modal Batch Processing & Production Stability*
*Researched: 2026-03-27*
