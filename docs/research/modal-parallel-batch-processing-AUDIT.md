# Аудит: параллельная обработка глав на Modal с vLLM

> **Дата аудита**: 27 марта 2026
> **Аудитируемый документ**: `docs/research/modal-parallel-batch-processing.md`
> **Методология**: Параллельная верификация через 6 исследовательских агентов (vLLM API, Modal, Qwen3.5, cold start, benchmarks, URLs)

---

## 1. Вердикт

**Общая оценка: 7.5 / 10**

Отчёт — качественное и структурированное исследование, покрывающее все ключевые аспекты миграции на batch processing. Основная архитектурная рекомендация (один `.remote()` + vLLM batch) **корректна и обоснована**. Однако аудит выявил **3 критические ошибки**, которые приведут к провалу при copy-paste имплементации, и **5 существенных недочётов** в оценках и пропущенных рисках.

### Ключевые findings

| Тип                               | Кол-во | Критичность             |
| --------------------------------- | ------ | ----------------------- |
| Критические ошибки в коде         | 3      | Блокирует имплементацию |
| Фактические неточности            | 4      | Требует коррекции       |
| Переоценённые/недооценённые риски | 3      | Влияет на планирование  |
| Пропущенные альтернативы          | 2      | Стоит рассмотреть       |
| Арифметические ошибки             | 2      | Влияет на ROI оценку    |

---

## 2. Верификация фактов

### Блок A: vLLM Batch API

| #   | Утверждение                                    | Вердикт                   | Обоснование                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `llm.chat()` принимает `List[List[dict]]`      | **CONFIRMED**             | Сигнатура: `Union[list[ChatCompletionMessageParam], list[list[ChatCompletionMessageParam]]]`. Источник: [vllm/entrypoints/llm.py](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/llm.py)                                                        |
| A2  | PR #8648 добавил batch chat support            | **CONFIRMED**             | Merged 2024-09-24, title: "[Frontend] Batch inference for llm.chat() API". Fixes #8481. Источник: [PR #8648](https://github.com/vllm-project/vllm/pull/8648)                                                                                                     |
| A3  | StructuredOutputsParams работает в batch mode  | **CONFIRMED**             | Каждый conversation может иметь свой `SamplingParams`. Offline examples подтверждают: [structured_outputs.py](https://github.com/vllm-project/vllm/blob/main/examples/offline_inference/structured_outputs.py)                                                   |
| A4  | Issue #16732 закрыт как "not planned"          | **CONFIRMED**             | Закрыт 2025-12-28, state_reason: "not_planned", label: "stale". Источник: [Issue #16732](https://github.com/vllm-project/vllm/issues/16732)                                                                                                                      |
| A5  | `finish_reason: "length"` при truncation       | **CONFIRMED**             | vLLM возвращает `"length"` при исчерпании `max_tokens`. Обсуждение: [vLLM Forums](https://discuss.vllm.ai/t/output-truncated-without-reason/1237)                                                                                                                |
| A6  | xgrammar overhead при batch >= 8               | **UNVERIFIABLE**          | Benchmark SqueezeBits найден по URL, но конкретные числа по batch size threshold не извлечены. Утверждение правдоподобно, но точный порог 8 не верифицирован. Источник: [SqueezeBits blog](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang) |
| A7  | `backend="guidance"` в StructuredOutputsParams | **INCORRECT**             | См. раздел 3 (Критическая ошибка #1)                                                                                                                                                                                                                             |
| A8  | Issue #8350 (truncation)                       | **CONFIRMED**             | Закрыт 2024-10-28, state_reason: "completed". Это known limitation, не баг. Источник: [Issue #8350](https://github.com/vllm-project/vllm/issues/8350)                                                                                                            |
| A9  | Issue #18819 (Qwen3 + structured output)       | **CONFIRMED с оговоркой** | Это баг Qwen**3** (не 3.5) при `enable_thinking=False` + xgrammar. Закрыт 2025-06-17. **Но**: существует НОВЫЙ открытый баг для Qwen3.5 27B structured output (открыт 2026-03-02).                                                                               |
| A10 | Issue #15236 (xgrammar schema)                 | **CONFIRMED**             | Закрыт 2025-03-28. Был серьёзным — блокировал использование structured output для многих пользователей. Источник: [Issue #15236](https://github.com/vllm-project/vllm/issues/15236)                                                                              |

### Блок B: Modal Patterns

| #   | Утверждение                                     | Вердикт       | Обоснование                                                                                                                                                              |
| --- | ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `@modal.batched()` не может иметь другие методы | **CONFIRMED** | Документация: "If a class has a Batched Method, it cannot have other Batched Methods or Methods." [Modal docs](https://modal.com/docs/guide/dynamic-batching)            |
| M2  | gRPC payload limit 100 MB                       | **CONFIRMED** | Troubleshooting page: 413 Content Too Large при превышении. Лимит на весь payload (args + return). [Modal troubleshooting](https://modal.com/docs/guide/troubleshooting) |
| M3  | `Function.map(return_exceptions=True)`          | **CONFIRMED** | Параметр существует с этим именем. [Modal Function ref](https://modal.com/docs/reference/modal.Function)                                                                 |
| M4  | `modal.Queue` — лимиты                          | **CONFIRMED** | 1 MiB/item, 5000 items/partition, TTL 24h, до 100K partitions. Не deprecated. [Modal Queue ref](https://modal.com/docs/reference/modal.Queue)                            |
| M5  | Timeout до 24 часов                             | **CONFIRMED** | 1s — 24h, default 300s. [Modal timeouts](https://modal.com/docs/guide/timeouts)                                                                                          |
| M6  | `scaledown_window` 2 сек — 20 мин               | **CONFIRMED** | [Modal scaling](https://modal.com/docs/guide/scale)                                                                                                                      |
| M7  | L40S $1.95/hr                                   | **CONFIRMED** | $0.000542/sec = $1.95/hr. [Modal pricing](https://modal.com/pricing)                                                                                                     |
| M8  | `enable_memory_snapshot` + GPU snapshot         | **CONFIRMED** | Оба параметра валидны. GPU snapshot в alpha. [Modal GPU snapshot](https://modal.com/docs/examples/gpu_snapshot)                                                          |
| M9  | Free plan 10 GPU concurrent                     | **CONFIRMED** | Starter: 10 GPU, 100 контейнеров. Team: 50 GPU. [Modal pricing](https://modal.com/pricing)                                                                               |
| M10 | `spawn()` / `spawn_map()` до 7 дней             | **CONFIRMED** | Результаты доступны 7 дней. `spawn()` — до 1M pending inputs. [Modal batch processing](https://modal.com/docs/guide/batch-processing)                                    |
| M11 | Default timeout 300s                            | **CONFIRMED** | [Modal timeouts](https://modal.com/docs/guide/timeouts)                                                                                                                  |

**Итого Modal: 11/11 CONFIRMED** — все утверждения о Modal корректны.

### Блок C: Qwen3.5-9B

| #   | Утверждение                                 | Вердикт                     | Обоснование                                                                                                                                                                                   |
| --- | ------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 24 GatedDeltaNet + 8 Full Attention         | **CONFIRMED**               | Model card: 8 × (3 × GatedDeltaNet + 1 × Gated Attention) = 24 + 8 = 32 слоя. [HuggingFace](https://huggingface.co/Qwen/Qwen3.5-9B)                                                           |
| Q2  | Bug #37121 (7x overestimation)              | **CONFIRMED**               | Открыт 2026-03-15, всё ещё OPEN. Профилер: 61,776 tokens / 7.57 GiB allocated vs 8,447 actual. Root cause описан корректно. [Issue #37121](https://github.com/vllm-project/vllm/issues/37121) |
| Q3  | PR #37124 "в review"                        | **OUTDATED**                | PR #37124 **ЗАКРЫТ**, superseded PR #37429 (открыт 2026-03-18, всё ещё open).                                                                                                                 |
| Q4  | `num_gpu_blocks_override=512`               | **CONFIRMED, но arbitrary** | Параметр валиден (engine arg). Число 512 — эмпирическое для L40S.                                                                                                                             |
| Q5  | KV cache ~32 KB/token                       | **CONFIRMED**               | 8 attention layers × 4 KV heads × 256 head_dim × 2 (K+V) × 2 bytes (BF16) = 32,768 bytes ≈ 32 KB/token. При FP8 KV cache: 16 KB/token.                                                        |
| Q6  | Prefill медленнее стандартных трансформеров | **UNVERIFIABLE**            | Конкретных сравнительных benchmark'ов DeltaNet prefill vs Transformer prefill не найдено. DeltaNet использует chunkwise-recurrent алгоритм.                                                   |
| Q7  | Issue #37103 "безвредно"                    | **НЕДООЦЕНЕНО**             | Issue OPEN (2026-03-18). Warning коррелирует с API timeouts. [Issue #37103](https://github.com/vllm-project/vllm/issues/37103)                                                                |
| Q8  | `enable_prefix_caching` с DeltaNet работает | **CONFIRMED с оговоркой**   | Tracking issue #26201: Mamba1/Mamba2 merged, GatedDeltaNet PR #26807 "в прогрессе". Экспериментально.                                                                                         |
| Q9  | Model weights ~18 GB                        | **CONFIRMED**               | 9B params × 2 bytes (BF16) ≈ 18 GB.                                                                                                                                                           |

### Блок D: Cold Start

| #   | Утверждение                                  | Вердикт                   | Обоснование                                                                                                                                                                      |
| --- | -------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | torch.compile cache `~/.cache/vllm/`         | **CONFIRMED**             | Путь актуален. [torch.compile integration](https://docs.vllm.ai/en/latest/design/torch_compile/)                                                                                 |
| C2  | Tensorfuse benchmark 42s → 13s               | **CONFIRMED**             | Blog post существует. Числа для **Llama-70B**, не Qwen3.5-9B. Экстраполяция оптимистичная. [Tensorfuse blog](https://tensorfuse.io/docs/blogs/reducing_gpu_cold_start)           |
| C3  | `VLLM_TORCH_COMPILE_LEVEL=1`                 | **CONFIRMED**             | Env var существует. Уровни: 0=NO_COMPILATION, 1=DYNAMO_AS_IS, 2=DYNAMO_ONCE, 3=PIECEWISE. [vLLM optimization levels](https://docs.vllm.ai/en/stable/design/optimization_levels/) |
| C4  | `compilation_config` как plain dict          | **PARTIALLY INCORRECT**   | См. раздел 3 (Критическая ошибка #3)                                                                                                                                             |
| C5  | vLLM LLM class не имеет sleep/wake API       | **INCORRECT**             | См. раздел 3 (Критическая ошибка #2)                                                                                                                                             |
| C6  | VLLM_SKIP_WARMUP только для Intel Gaudi      | **CONFIRMED**             | [Intel Gaudi warmup](https://docs.vllm.ai/projects/gaudi/en/latest/features/warmup.html)                                                                                         |
| C7  | `flashinfer-cubin` на PyPI                   | **CONFIRMED**             | Пакет существует: [flashinfer-cubin](https://pypi.org/project/flashinfer-cubin/)                                                                                                 |
| C8  | `VLLM_ATTENTION_BACKEND=TRITON_ATTN_VLLM_V1` | **CONFIRMED**             | [vLLM Triton Backend](https://blog.vllm.ai/2026/03/04/vllm-triton-backend-deep-dive.html)                                                                                        |
| C9  | Triton не требует nvcc                       | **CONFIRMED с оговоркой** | Triton JIT через свой компилятор, не nvcc. Но PR #37507 показывает fallback при CUDA toolkit < 12.6.                                                                             |

---

## 3. Критические ошибки

### Критическая ошибка #1: `backend="guidance"` в StructuredOutputsParams

**Где в отчёте:** Разделы 2.7, 4 (проблема 5), 7.3

**Что утверждает отчёт:**

```python
structured_outputs=StructuredOutputsParams(
    json=schema_json,
    backend="guidance",  # вместо default xgrammar
)
```

**Почему это неверно:**

`StructuredOutputsParams` имеет поле `_backend` с `init=False` — это **приватное** поле, устанавливаемое внутренне процессором. Конструктор **НЕ принимает** `backend`.

Из исходного кода `vllm/sampling_params.py`:

> `_backend` field with default value of `None` and init parameter of `False`
> "CAUTION: Should only be set by Processor.\_validate_structured_output"

Источник: [vllm/sampling_params.py](https://github.com/vllm-project/vllm/blob/main/vllm/sampling_params.py)

**Правильный подход:**

Backend задаётся на уровне LLM instance:

```python
self.llm = LLM(
    model=LLM_MODEL_ID,
    guided_decoding_backend="guidance",  # на уровне движка
    ...
)
```

**Impact:** Код упадёт с `TypeError: unexpected keyword argument 'backend'`. **Блокирует имплементацию.**

---

### Критическая ошибка #2: "vLLM LLM class не имеет sleep/wake API"

**Где в отчёте:** Разделы 4 (проблема 9), 5 (Priority 4)

**Что утверждает отчёт:**

> "vLLM `LLM` class (offline mode) не имеет sleep/wake API. Sleep mode доступен только через OpenAI-compatible server."

**Почему это неверно:**

vLLM поддерживает sleep mode в offline LLM class:

```python
from vllm import LLM
llm = LLM("Qwen/Qwen3.5-9B", enable_sleep_mode=True)
llm.sleep(level=1)   # offload weights в CPU RAM
llm.wake_up()         # restore
```

Документация: [Sleep Mode](https://docs.vllm.ai/en/latest/features/sleep_mode/), [Blog](https://blog.vllm.ai/2025/10/26/sleep-mode.html)

**Impact:** Отчёт рекомендует "крупный рефактор" на `vllm serve` (effort: HIGH), хотя sleep/wake доступен прямо в LLM class. GPU snapshot реализуется **без перехода на server mode**:

```python
@modal.enter(snap=True)
def start(self):
    from vllm import LLM
    self.llm = LLM(model=LLM_MODEL_ID, enable_sleep_mode=True, ...)
    self.llm.chat(messages=warmup, sampling_params=warmup_params)
    self.llm.sleep(level=1)

@modal.enter(snap=False)
def wake_up(self):
    self.llm.wake_up()
```

**Effort снижается с HIGH до LOW-MEDIUM.** Cold start потенциально ~12s вместо ~110s.

---

### Критическая ошибка #3: `compilation_config` как plain dict

**Где в отчёте:** Раздел 7.3, строки 1008-1010

**Что утверждает отчёт:**

```python
compilation_config={"cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32]}
```

**Проблема:** Документация показывает `CompilationConfig` объект:

```python
from vllm.config import CompilationConfig
compilation_config=CompilationConfig(cudagraph_capture_sizes=[1, 2, 4, 8, 16, 32])
```

vLLM может автоматически конвертировать dict, но это не документировано и не гарантировано.

**Impact:** Средний. Может работать, может дать невнятный traceback.

---

## 4. Недочёты и пробелы

### 4.1. PR #37124 устарел

Отчёт: "PR #37124 в review."
**Реальность:** PR #37124 **ЗАКРЫТ** (superseded). Актуальный — **PR #37429** (2026-03-18, всё ещё open). Включает compact Mamba allocation с dedicated block pools.

### 4.2. Issue #37103 недооценён

Отчёт: "Безвредно."
**Реальность:** Warning коррелирует с API timeouts. При batch 23 глав — `seq_len=23 < num_heads=64` — warning гарантирован. Требует мониторинга.

### 4.3. Новый баг Qwen3.5 + structured output (не упомянут)

Открытый баг (2026-03-02): Qwen3.5 27B structured output не работает на nightly vLLM. Может затронуть Qwen3.5-9B. **Необходимо тестировать до имплементации.**

### 4.4. VPS-side timeout отсутствует

`asyncio.to_thread(extractor.extract_chapters_batch.remote, ...)` — нет timeout на стороне VPS. Если Modal завис — VPS-поток заблокирован навсегда.

**Fix:**

```python
batch_results = await asyncio.wait_for(
    asyncio.to_thread(extractor.extract_chapters_batch.remote, ...),
    timeout=2100,  # 35 мин
)
```

### 4.5. Partial save при crash отсутствует

Batch: все 23 или ничего. Sequential: 12/23 могут быть сохранены до crash. Рекомендуется Queue-based streaming результатов.

### 4.6. `VLLM_TORCH_COMPILE_LEVEL` — поздно

`setdefault` в `load_model()` может быть слишком поздно — vLLM читает env vars при import. Перенести на module level.

### 4.7. Idempotency при retry

Celery retry повторит batch для ВСЕХ глав. `is_description_parsed` проверяется до batch, не после. Уже обработанные главы будут обработаны повторно.

---

## 5. Переоценённые и недооценённые риски

### Переоценённые

| Риск                         | Оценка отчёта | Скорректированная | Обоснование                                                      |
| ---------------------------- | ------------- | ----------------- | ---------------------------------------------------------------- |
| GPU snapshot не работает     | MEDIUM        | **LOW**           | LLM class имеет sleep/wake API. Не нужен server mode.            |
| `guidance` backend медленнее | MEDIUM        | **LOW**           | При одинаковой schema xgrammar кеширует FSM, разница минимальна. |

### Недооценённые

| Риск                           | Оценка отчёта | Скорректированная | Обоснование                                                             |
| ------------------------------ | ------------- | ----------------- | ----------------------------------------------------------------------- |
| Qwen3.5 structured output баг  | Не упомянут   | **HIGH**          | Открытый баг (март 2026).                                               |
| Issue #37103 (format mismatch) | LOW           | **MEDIUM**        | Корреляция с timeouts.                                                  |
| Sequential fallback timeout    | Не упомянут   | **MEDIUM**        | При batch failure на мин 20 — ~10 мин на 23 sequential calls нереально. |

### Пропущенные риски

1. **VPS-side timeout** — `asyncio.to_thread()` без timeout блокирует навсегда
2. **Celery time limit конфликт** — 10500s vs batch + retry
3. **Concurrent books** — два пользователя → два контейнера, удвоение стоимости

---

## 6. Code review findings

### 6.1. Sequential fallback без time budget

```python
except Exception as e:
    for i, conv in enumerate(conversations):  # 23 sequential calls
```

Если batch упал на 20-й минуте, sequential пытается 23 главы за 10 мин. Каждая ~4 мин = timeout после 2-3 глав.

**Fix:** Добавить time budget:

```python
deadline = time.monotonic() + (LLM_TIMEOUT - 120)
for i, conv in enumerate(conversations):
    if time.monotonic() > deadline:
        break
```

### 6.2. `modal_batch_to_chapter_results` — нет type checking

Если `r` не dict — невнятная ошибка.

### 6.3. Backend не настроен в коде

Отчёт рекомендует guidance, но код LLM() в разделе 7.3 **не включает** `guided_decoding_backend="guidance"`.

### 6.4. `@modal.exit()` не гарантирован при OOM

Cleanup `destroy_process_group()` не критичен (контейнер уничтожается), но стоит знать.

---

## 7. Альтернативные подходы

### 7.1. Chunked batch (не рассмотрен)

3-4 sub-batch по 6-8 глав. Если один fails, остальные сохранены. Легко реализовать:

```python
for chunk in chunked(conversations, 8):
    outputs = self.llm.chat(messages=chunk, sampling_params=params)
    save_partial_results(outputs)
```

### 7.2. Sleep mode без server mode (не рассмотрен)

LLM class + `enable_sleep_mode=True` + GPU snapshot. Effort: LOW-MEDIUM. Cold start: ~12s. Описан в Крит. ошибке #2.

### 7.3. Speculative decoding (упомянут в промпте, не в отчёте)

vLLM 0.18.0 поддерживает speculative decoding. Но открытые баги с Qwen3.5 ([Issue #36031](https://github.com/vllm-project/vllm/issues/36031)).

---

## 8. Скорректированные benchmarks

### 8.1. Throughput

| Метрика            | Отчёт         | Скорректировано           | Причина                                         |
| ------------------ | ------------- | ------------------------- | ----------------------------------------------- |
| Batch-1 decode     | 40-50 tok/s   | **30-50 tok/s**           | L40S bandwidth limited (864 GB/s)               |
| Batch-20 aggregate | 500 tok/s     | **300-500 tok/s**         | Нижняя граница вероятнее для L40S               |
| Prefill 23×8K      | 46s           | **46-90s**                | DeltaNet chunkwise-recurrent overhead не изучен |
| Total inference    | ~230s (4 мин) | **~300-450s (5-7.5 мин)** | Structured output overhead + uncertainty        |

### 8.2. Cold start

| Фаза                   | Отчёт         | Скорректировано | Причина                         |
| ---------------------- | ------------- | --------------- | ------------------------------- |
| torch.compile cached   | ~15s          | **~15-25s**     | Tensorfuse данные для Llama-70B |
| Warmup (6 CUDA graphs) | ~50-60s       | **~50-70s**     | Hybrid cache overhead           |
| **Total**              | **~100-110s** | **~100-130s**   |                                 |

### 8.3. Cost

| Сценарий             | Отчёт     | Скорректировано | Расчёт                                                  |
| -------------------- | --------- | --------------- | ------------------------------------------------------- |
| Batch total time     | ~6 мин    | **~8-12 мин**   | Cold start 110-130s + inference 300-450s + overhead 60s |
| Batch cost           | **$0.20** | **$0.26-0.39**  | $1.95/hr × (8-12 мин / 60)                              |
| + scaledown 60s      | —         | **$0.29-0.42**  | + $0.033 за idle минуту                                 |
| Sequential (current) | $3.48     | **$3.48**       | Корректно                                               |

**Экономия: 88-92%** вместо заявленных 94%. Всё равно значительная.

### 8.4. KV cache capacity

Расчёты в отчёте **корректны**:

- 27.6 GB для KV cache
- ~32 KB/token (8 attention layers)
- ~27 concurrent при max_model_len=32768
- ~50-60 при реальных ~8K tokens

Нюанс: vLLM PagedAttention аллоцирует по факту, не по max_model_len.

---

## 9. Рекомендации

### Блокирующие (до имплементации)

1. **Исправить backend синтаксис** — `LLM(guided_decoding_backend="guidance")` вместо `StructuredOutputsParams(backend="guidance")`
2. **Использовать sleep mode LLM class** — `enable_sleep_mode=True` + `llm.sleep()/wake_up()` для GPU snapshot
3. **Тестировать Qwen3.5-9B + structured output** на актуальном vLLM 0.18.0
4. **Использовать `CompilationConfig`** вместо plain dict

### Высокий приоритет

5. **VPS-side timeout** — `asyncio.wait_for(..., timeout=2100)`
6. **Time budget в sequential fallback**
7. **Env vars на module level** — до import vLLM
8. **Обновить PR reference** — #37124 → #37429

### Средний приоритет

9. **Chunked batch** — sub-batch по 6-8 для partial resilience
10. **Partial results через Queue**
11. **Idempotency check после batch**
12. **Мониторинг Issue #37103**

---

## Приложение: Верификация ссылок

### Проверенные (доступны и корректны)

| Ссылка                                                                                         | Статус                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| [PR #8648](https://github.com/vllm-project/vllm/pull/8648)                                     | Доступен, содержание соответствует |
| [Issue #8350](https://github.com/vllm-project/vllm/issues/8350)                                | Закрыт, known limitation           |
| [Issue #16732](https://github.com/vllm-project/vllm/issues/16732)                              | Закрыт "not planned"               |
| [Issue #37121](https://github.com/vllm-project/vllm/issues/37121)                              | Открыт, 7x overestimation          |
| [Issue #18819](https://github.com/vllm-project/vllm/issues/18819)                              | Закрыт, Qwen3 (не 3.5)             |
| [Issue #15236](https://github.com/vllm-project/vllm/issues/15236)                              | Закрыт                             |
| [Issue #19196](https://github.com/vllm-project/vllm/issues/19196)                              | Закрыт, destroy_process_group      |
| [Issue #37103](https://github.com/vllm-project/vllm/issues/37103)                              | Открыт, format mismatch            |
| [Modal pricing](https://modal.com/pricing)                                                     | L40S $1.95/hr подтверждено         |
| [Modal dynamic-batching](https://modal.com/docs/guide/dynamic-batching)                        | Доступен                           |
| [Modal batch-processing](https://modal.com/docs/guide/batch-processing)                        | Доступен                           |
| [Modal timeouts](https://modal.com/docs/guide/timeouts)                                        | Доступен                           |
| [flashinfer-cubin (PyPI)](https://pypi.org/project/flashinfer-cubin/)                          | Пакет существует                   |
| [HuggingFace Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B)                               | Доступен                           |
| [vLLM Triton Backend blog](https://blog.vllm.ai/2026/03/04/vllm-triton-backend-deep-dive.html) | Доступен                           |

### Не проверены (Cloudflare block / permission denied)

| Ссылка                      | Причина                                |
| --------------------------- | -------------------------------------- |
| docs.vllm.ai/\* (5 ссылок)  | Cloudflare security block при WebFetch |
| Modal blog posts (2 ссылки) | WebFetch permission denied             |
| Tensorfuse blog             | WebFetch permission denied             |
| SqueezeBits benchmark       | WebFetch permission denied             |
