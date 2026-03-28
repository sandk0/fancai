# Исследование: параллельная обработка глав книги на Modal с vLLM

> **Дата**: 27 марта 2026
> **Версии**: vLLM 0.18.0, Modal SDK ~1.4.0, Qwen3.5-9B
> **Цель**: снизить время обработки 23 глав с ~107 минут до ~10-15 минут

---

## 1. Executive Summary

### Ключевые находки

1. **vLLM batch API уже поддерживает всё, что нужно.** `llm.chat()` принимает `List[List[dict]]` — список conversations. Передаём все 23 главы в одном вызове, vLLM обрабатывает их через continuous batching на одном GPU. Structured output (`StructuredOutputsParams`) работает в batch mode — каждый conversation получает свой `SamplingParams`.

2. **Один `.remote()` вместо 23.** Лучший паттерн для Modal — передать все главы списком в один `.remote()` вызов с timeout=1800s. Внутри контейнера vLLM батчит inference автоматически. Это устраняет 22 сетевых round-trip и исключает повторные cold start.

3. **Cold start 211s можно снизить до ~30-60s** через три стратегии: (a) persist `torch.compile` cache в Modal Volume (-30s), (b) уменьшить CUDA graph sizes (-40s), (c) использовать GPU snapshot с sleep mode pattern (-90%). GPU snapshot (alpha) обещает ~12s, но требует изменения lifecycle.

4. **JSON truncation — known limitation, не баг.** vLLM structured output гарантирует валидные токены на каждом шаге, но НЕ гарантирует завершённый JSON при достижении `max_tokens`. Workaround: увеличить `max_tokens` (уже 32768), добавить `maxLength` constraints на string fields в schema, retry при `finish_reason: "length"`.

5. **Qwen3.5-9B: 7x overestimation бага KV cache.** Модель гибридная (24 GatedDeltaNet + 8 Full Attention), но vLLM профилер считает все 32 слоя как Attention. Реальный KV cache ~32 KB/token (только 8 слоёв). `num_gpu_blocks_override=512` — необходимый workaround. Bug [#37121](https://github.com/vllm-project/vllm/issues/37121).

6. **Снижение `max_model_len` с 65K до 32K удвоит concurrency** при обработке глав средней длины (~8K tokens). Если longest chapter <30K, это безопасно.

7. **FlashInfer JIT можно устранить** установкой `flashinfer-cubin` + `flashinfer-jit-cache` (pre-compiled kernels) или переключением на `TRITON_ATTN_VLLM_V1` backend, что уберёт зависимость от `nvidia/cuda:devel` image.

### Рекомендуемый подход

```
VPS (Celery) → один .remote() вызов → Modal контейнер (L40S)
                                        ↓
                                   vLLM llm.chat(
                                     messages=[ch1, ch2, ..., ch23],
                                     sampling_params=[sp] * 23
                                   )
                                        ↓
                              23 результатов (continuous batching)
                                        ↓
                              ← List[dict] ← один ответ
```

### Ожидаемые числа

| Метрика                 | Текущее                  | Ожидаемое                      | Примечание                   |
| ----------------------- | ------------------------ | ------------------------------ | ---------------------------- |
| Время обработки 23 глав | ~107 мин                 | **~10-15 мин**                 | vLLM batch на одном GPU      |
| Cold start              | ~211s                    | **~30-60s**                    | compile cache + `-O1`        |
| `.remote()` вызовов     | 23                       | **1**                          | batch mode                   |
| GPU utilization         | ~5%                      | **60-80%**                     | continuous batching          |
| Timeout failures        | 5 из 23                  | **~0**                         | batch обрабатывает быстрее   |
| JSON truncation         | 5 из 23                  | **~0-1**                       | max_tokens 32768 + maxLength |
| Стоимость L40S          | $1.95/hr x 1.8hr = $3.51 | **$1.95/hr x 0.25hr = ~$0.49** | batch экономит idle time     |

---

## 2. vLLM Batch API

### 2.1. Batch inference через `llm.chat()`

vLLM `LLM.chat()` нативно поддерживает batch — `messages` принимает как одну conversation (`List[dict]`), так и **список conversations** (`List[List[dict]]`).

**Сигнатура** ([vllm/entrypoints/llm.py](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/llm.py)):

```python
def chat(
    self,
    messages: list[ChatCompletionMessageParam] | Sequence[list[ChatCompletionMessageParam]],
    sampling_params: SamplingParams | Sequence[SamplingParams] | None = None,
    ...
) -> list[RequestOutput]:
```

**Пример batch вызова:**

```python
from vllm import LLM, SamplingParams
from vllm.sampling_params import StructuredOutputsParams

# Подготовка conversations — одна per chapter
conversations = []
for chapter_text in chapter_texts:
    conversations.append([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
    ])

# Shared sampling params (одинаковая schema для всех глав)
structured = StructuredOutputsParams(json=schema_json)
params = SamplingParams(
    max_tokens=32768,
    temperature=0.1,
    structured_outputs=structured,
)

# Batch inference — vLLM обрабатывает все conversations через continuous batching
outputs = llm.chat(
    messages=conversations,
    sampling_params=params,  # один SamplingParams для всех
)

# Результаты: один RequestOutput per conversation, в том же порядке
results = [json.loads(out.outputs[0].text) for out in outputs]
```

**Ссылки:** [PR #8648](https://github.com/vllm-project/vllm/pull/8648) (merged Sep 2024), [Feature request #8481](https://github.com/vllm-project/vllm/issues/8481)

### 2.2. StructuredOutputsParams в batch mode

**Работает.** Каждый conversation может иметь свой `SamplingParams` с собственным `StructuredOutputsParams`. Можно передать `Sequence[SamplingParams]` (1:1 с conversations) или один `SamplingParams` для всех.

**Ограничения:**

- **xgrammar backend** (default): при batch size >= 8 sequential non-overlapped mask generation создаёт видимый overhead ([SqueezeBits benchmark](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang))
- **Одинаковая schema** (наш случай): XGrammar **кеширует** compiled FSM — overhead минимален
- **Разные schema**: guidance/LLGuidance лучше для dynamic unique schemas

### 2.3. Continuous batching — как vLLM распределяет GPU

vLLM использует **continuous batching** с **PagedAttention**:

- Scheduler непрерывно добавляет новые запросы и убирает завершённые
- KV cache аллоцируется в блоках (как virtual memory) — нет фрагментации
- GPU остаётся загружен на ~95% при достаточном количестве запросов
- **Throughput improvement**: 5-10x vs static batching

Для 23 глав с средней длиной ~8K tokens:

- vLLM помещает столько conversations в batch, сколько влезает в KV cache
- При ~8K tokens per request и ~375K tokens KV cache -> ~47 concurrent prefills теоретически (с учётом output)
- На практике ограничено `chunked_prefill` (max_num_batched_tokens=8192) — vLLM чередует prefill и decode

### 2.4. Async API

**Нет `llm.chat.aio()`.** Для offline batch синхронный `llm.chat()` — правильный подход:

- vLLM внутренне параллелит inference через continuous batching
- `AsyncLLM` предназначен для online serving (streaming)
- Передача всех conversations в `llm.chat()` одним вызовом — максимально эффективный path

**Ссылки:** [Offline Inference docs](https://docs.vllm.ai/en/latest/serving/offline_inference/), [Batch LLM Inference example](https://docs.vllm.ai/en/latest/examples/offline_inference/batch_llm_inference/)

### 2.5. Error handling в batch

**Критическая проблема: ошибка одного запроса убивает весь batch.**

Если один prompt превышает `max_model_len`, vLLM бросает `ValueError` и прерывает всё. [Issue #16732](https://github.com/vllm-project/vllm/issues/16732) запрашивал per-request error reporting, но был **закрыт как "not planned"** (Dec 2025).

**Workarounds:**

1. **Pre-validate lengths** — токенизировать каждую главу перед batch, отфильтровать слишком длинные
2. **`truncate_prompt_tokens`** parameter — ограничивает input до N tokens (но теряет данные)
3. **Установить `max_model_len`** достаточно высоким для worst-case
4. **Try/except + retry подмножества** при ошибке

**Рекомендация для нашего кода:**

```python
# Pre-validation внутри Modal контейнера
from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL_ID)

valid_conversations = []
valid_indices = []
oversized = []

for i, (conv, text) in enumerate(zip(conversations, chapter_texts)):
    tokens = len(tokenizer.encode(text))
    if tokens + system_prompt_tokens < MAX_MODEL_LEN - max_output_tokens:
        valid_conversations.append(conv)
        valid_indices.append(i)
    else:
        oversized.append((i, tokens))

# Batch только валидные
outputs = llm.chat(messages=valid_conversations, sampling_params=params)
```

### 2.6. Structured output truncation

**Known limitation, НЕ баг** ([Issue #8350](https://github.com/vllm-project/vllm/issues/8350)):

> "The guiding can only guide when it has a subset of legal tokens to be used next, but if it's any token it can exhaust the full max_length and by the time it discovered it's unfinished it's too late to wrap up."

FSM гарантирует, что **каждый сгенерированный токен валиден** в контексте JSON schema. Но если модель генерирует длинные строки (descriptions, visual summaries), FSM не может заставить её "поторопиться" и закрыть JSON до достижения `max_tokens`.

**Workarounds (в порядке приоритета):**

1. **Увеличить `max_tokens`** — уже 32768 (хорошо)
2. **Добавить `maxLength` constraints в Pydantic schema:**

   ```python
   class ModalDescriptionSchema(BaseModel):
       content: str = Field(max_length=2000)
       image_prompt_en: str = Field(default="", max_length=300)

   class ModalEntitySchema(BaseModel):
       visual_summary: str = Field(default="", max_length=500)
       chapter_event_action: str = Field(default=None, max_length=200)
   ```

3. **Проверять `finish_reason`** и retry при `"length"`:
   ```python
   output = outputs[i]
   if output.outputs[0].finish_reason == "length":
       # JSON likely truncated — retry this chapter individually
       truncated_indices.append(i)
   ```
4. **Custom logits processor** (advanced): boost `}`, `]`, `"` probabilities near max_tokens boundary

### 2.7. Malformed JSON (Ch 7: "Expecting property name")

Это **НЕ truncation**, а баг structured output backend. Возможные причины:

- **xgrammar + Qwen3** bug ([Issue #18819](https://github.com/vllm-project/vllm/issues/18819)): output становится gibberish вместо валидного JSON. Fixed в v0.9.1.
- **xgrammar schema validation** ([Issue #15236](https://github.com/vllm-project/vllm/issues/15236)): некорректная обработка `enum`, `$ref`, `Literal` types.

**Решение:** переключить backend на `guidance`:

```python
structured_outputs=StructuredOutputsParams(
    json=schema_json,
    backend="guidance",  # вместо default xgrammar
)
```

`guidance`/LLGuidance backend более robust — **ноль timeouts** на сложных schema в benchmarks vs xgrammar crashes.

---

## 3. Modal Patterns для batch processing

### 3.1. Сравнение подходов

| Подход                            | Описание                            | Pros                                            | Cons                                                           |
| --------------------------------- | ----------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| **Один `.remote()` + vLLM batch** | Все главы в одном вызове            | Один cold start, макс throughput, мин стоимость | Single point of failure                                        |
| `Function.map()`                  | 23 параллельных контейнера          | `return_exceptions=True` для partial failures   | 23 cold start'а (~80 мин GPU idle суммарно), высокая стоимость |
| `@modal.batched()`                | Dynamic batching для online serving | Автоматическая агрегация                        | **НЕ подходит** — мы уже знаем все inputs заранее              |
| `spawn_map()`                     | Fire-and-forget batch               | До 7 дней выполнения                            | Результаты не inline, нужен polling                            |

### 3.2. Рекомендация: один `.remote()` с batch vLLM

**Паттерн:**

```python
# VPS (Celery task)
extractor = get_llm_extractor()
batch_results = await asyncio.to_thread(
    extractor.extract_chapters_batch.remote,
    chapter_texts=all_chapter_texts,     # List[str]
    system_prompt=EXTRACTION_SYSTEM_PROMPT,
    schema_json=EXTRACTION_SCHEMA_JSON,
)
# batch_results: List[dict | None] — None для failed chapters
```

**Преимущества:**

- 1 cold start вместо 23
- vLLM continuous batching на одном GPU — максимальный throughput
- Нет сетевого overhead между главами
- timeout=1800s покрывает batch целиком

### 3.3. `@modal.batched()` — почему не подходит

`@modal.batched()` предназначен для **online serving**: группирует concurrent `.remote()` вызовы от разных callers в один batch. Параметры:

- `max_batch_size` — сколько inputs объединить
- `wait_ms` — сколько ждать следующий input

У нас все 23 главы **уже доступны** — нет смысла агрегировать. Просто передаём список.

**Ограничение:** class с `@modal.batched` методом **не может иметь** другие `@modal.method` или `@modal.batched` методы.

**Ссылки:** [Dynamic batching guide](https://modal.com/docs/guide/dynamic-batching), [modal.batched reference](https://modal.com/docs/reference/modal.batched)

### 3.4. `Function.map()` — резервный вариант

Если reliability > throughput:

```python
# Каждая глава в отдельном контейнере
results = list(extractor.extract_chapter.map(
    chapter_texts,
    [EXTRACTION_SYSTEM_PROMPT] * len(chapter_texts),
    [EXTRACTION_SCHEMA_JSON] * len(chapter_texts),
    return_exceptions=True,  # partial failures as Exception objects
))

successful = [(i, r) for i, r in enumerate(results) if not isinstance(r, Exception)]
failed = [(i, r) for i, r in enumerate(results) if isinstance(r, Exception)]
```

**Лимиты `.map()`:** 1000 concurrent, 2000 pending, 25000 total. Для 23 глав — без проблем.

**Проблема:** 23 x cold start (~211s каждый) = **~80 мин суммарного GPU idle time** = ~$2.60 потеряно. Плюс free plan лимит 10 GPU concurrent.

### 3.5. Timeout configuration

- **Default:** 300s (5 min)
- **Диапазон:** 1s — 24 часа
- **Для batch:** `@app.cls(timeout=1800)` — 30 минут с запасом

```python
# modal/config.py
LLM_TIMEOUT = 1800  # 30 мин для batch (вместо 600s)
```

### 3.6. Размер аргументов `.remote()`

- **gRPC payload limit: 100 MB**
- 23 главы x ~20KB = ~460KB — **далеко от лимита**
- Даже 100 глав x 50KB = 5MB — без проблем

### 3.7. Progress reporting через `modal.Queue`

```python
# Modal контейнер
progress_queue = modal.Queue.from_name("fancai-progress", create_if_missing=True)

for i, output in enumerate(outputs):
    result = json.loads(output.outputs[0].text)
    results.append(result)
    progress_queue.put({"chapter": i + 1, "total": len(outputs), "status": "done"})

# VPS (Celery task) — в отдельном потоке
async def poll_progress():
    queue = modal.Queue.from_name("fancai-progress")
    for msg in queue.iterate():
        await publish_book_progress(book_id=..., progress=..., chapter=msg["chapter"])
```

**Лимиты Queue:** 1 MiB per item, 5000 items per partition, TTL 24h.

**Альтернатива:** не использовать Queue, а возвращать progress в streaming response. Или просто показывать "Processing batch..." и финальный результат.

### 3.8. `scaledown_window` для batch mode

Текущее значение: 120s (2 мин). Для batch:

- **Уменьшить до 30-60s** — batch завершается burst'ом, нет смысла держать GPU idle
- GPU стоит $1.95/hr = $0.033/min — каждая минута idle = $0.033

```python
# modal/config.py
SCALEDOWN_WINDOW = 60  # 1 мин для batch (вместо 120s)
```

---

## 4. Анализ логов — проблемы и решения

### Сводная таблица

| #   | Проблема              | Критичность | Root Cause                       | Решение                                     | Ожидаемый эффект    |
| --- | --------------------- | ----------- | -------------------------------- | ------------------------------------------- | ------------------- |
| 1   | Cold start 211s       | **HIGH**    | vLLM полная реинициализация      | GPU snapshot + compile cache + `-O1`        | < 30-60s            |
| 2   | torch.compile 52s     | **HIGH**    | Компиляция при каждом старте     | Persist `~/.cache/vllm/` в Volume           | ~13s                |
| 3   | Warmup 100s           | **HIGH**    | KV cache profiling + CUDA graphs | Уменьшить CUDA graph sizes                  | ~40-60s             |
| 4   | JSON truncation       | **HIGH**    | max_tokens < output length       | maxLength constraints + finish_reason check | Почти 0 truncations |
| 5   | Malformed JSON        | **MEDIUM**  | xgrammar bug с Qwen3.5           | `backend="guidance"`                        | Устраняет           |
| 6   | Timeout 600s          | **HIGH**    | Sequential + timeout per chapter | Batch mode + timeout=1800                   | Устраняет           |
| 7   | Mamba experimental    | **LOW**     | vLLM experimental prefix caching | Мониторить, не блокирует                    | —                   |
| 8   | num_gpu_blocks=0      | **MEDIUM**  | 7x memory overestimation bug     | Override необходим, ждать fix               | —                   |
| 9   | Snapshot не помогает  | **MEDIUM**  | Нет sleep mode pattern           | Реализовать sleep/wake lifecycle            | Cold start ~12s     |
| 10  | FlashInfer JIT nvcc   | **LOW**     | Runtime JIT compilation          | `flashinfer-cubin` или TRITON_ATTN          | Убирает devel image |
| 11  | Logger.opt error      | **LOW**     | Loguru API в non-loguru context  | Заменить на stdlib logging                  | Fix                 |
| 12  | Entity UnboundLocal   | **LOW**     | Import error в Modal path        | Fix import                                  | Fix                 |
| 13  | destroy_process_group | **LOW**     | vLLM cleanup warning             | Безвредно, `@modal.exit()` cleanup          | Устраняет warning   |

### Детальный анализ каждой проблемы

#### Проблема 1: Cold start 211s

**Root cause:** vLLM V1 EngineCore запускается как subprocess. Инициализация включает:

- Model loading: 12.75s
- torch.compile: 52.34s
- Warmup/profiling: 100.46s
- CUDA graph capture: 7s
- Прочее: ~38s

**GPU snapshot** (Modal alpha) должен снапшотить полное CUDA state, но **не работает корректно** без sleep mode pattern.

**Требуемый pattern** ([Modal GPU snapshot docs](https://modal.com/docs/examples/gpu_snapshot)):

```python
@modal.enter(snap=True)
def start(self):
    # 1. Запустить vLLM
    # 2. Прогреть тестовым запросом
    # 3. Перевести в sleep mode  <-- КРИТИЧНО

@modal.enter(snap=False)
def wake_up(self):
    # Разбудить из sleep
```

**Проблема:** vLLM `LLM` class (offline mode) не имеет sleep/wake API. Sleep mode доступен только через OpenAI-compatible server. Варианты:

1. Переключиться на vLLM server mode внутри Modal (сложнее, но ~12s cold start)
2. Оставить `LLM` class и оптимизировать через compile cache + `-O1` (~60s cold start)

**Рекомендация:** начать с варианта 2 (быстрое улучшение), мигрировать на вариант 1 позже.

#### Проблема 2: torch.compile 52s

**Root cause:** vLLM использует `torch.compile` для оптимизации attention/MLP kernels. Артефакты кешируются в `~/.cache/vllm/torch_compile_cache/`.

**Решение:** смонтировать Volume для cache:

```python
# modal/app.py
compile_cache_volume = modal.Volume.from_name("fancai-compile-cache", create_if_missing=True)

COMMON_CLS_KWARGS = dict(
    volumes={
        VOLUME_PATH: model_volume,
        "/root/.cache/vllm": compile_cache_volume,  # persist torch.compile cache
    },
    ...
)
```

**Ожидаемый эффект:** 52s -> ~13s (по [данным Tensorfuse](https://tensorfuse.io/docs/blogs/reducing_gpu_cold_start): compilation 42s -> 13s при cached).

#### Проблема 3: Warmup 100s

**Root cause:** KV cache profiling (аллокация блоков, подбор оптимальных размеров) + CUDA graph capture для 51 piecewise + 35 full graphs.

**Стратегии уменьшения:**

1. **Уменьшить CUDA graph sizes:**

   ```python
   self.llm = LLM(
       ...
       compilation_config={"cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32]},
   )
   ```

   По умолчанию vLLM capture'ит ~67 sizes. Уменьшение до 6 должно сэкономить ~40s.

2. **Optimization level `-O1`** вместо `-O2`:

   ```python
   import os
   os.environ["VLLM_TORCH_COMPILE_LEVEL"] = "1"
   ```

3. **`VLLM_SKIP_WARMUP`** — **только для Intel Gaudi (HPU)**, на NVIDIA GPU не работает.

#### Проблема 4: JSON truncation (5 глав)

**Root cause:** `max_tokens=8192` (в старой версии, сейчас 32768) недостаточно для длинного structured output.

**Текущее состояние:** `max_tokens` уже увеличен до 32768 — это помогает, но не гарантирует.

**Дополнительные меры:**

```python
# modal/schemas.py — добавить maxLength constraints
class ModalEntitySchema(BaseModel):
    name: str = Field(max_length=200)
    visual_summary: str = Field(default="", max_length=500)
    chapter_event_action: Optional[str] = Field(default=None, max_length=200)
    chapter_event_inner: Optional[str] = Field(default=None, max_length=200)

class ModalDescriptionSchema(BaseModel):
    content: str = Field(max_length=2000)
    image_prompt_en: str = Field(default="", max_length=300)

class ModalRelationshipSchema(BaseModel):
    context: str = Field(default="", max_length=300)
```

**Проверка в batch:**

```python
for i, output in enumerate(outputs):
    if output.outputs[0].finish_reason == "length":
        truncated.append(i)
    else:
        results[i] = json.loads(output.outputs[0].text)
```

#### Проблема 5: Malformed JSON (Ch 7)

**Root cause:** xgrammar backend bug с Qwen3/3.5 моделями ([Issue #18819](https://github.com/vllm-project/vllm/issues/18819)).

**Решение:**

```python
structured_outputs=StructuredOutputsParams(
    json=schema_json,
    backend="guidance",  # более robust для Qwen3.5
)
```

#### Проблема 6: Timeout 600s (5 глав потеряно)

**Root cause:** Sequential processing — каждая глава в отдельном `.remote()` с timeout=600s. Длинные главы + vLLM overhead -> timeout.

**Решение:** Batch mode устраняет проблему — vLLM обрабатывает все главы параллельно на GPU, timeout=1800s на весь batch. Даже если одна глава long, остальные не ждут.

#### Проблема 7: Mamba experimental warning

```
Mamba cache mode is set to 'align' for Qwen3_5ForConditionalGeneration
by default when prefix caching is enabled
```

**Root cause:** vLLM align mode для Mamba/DeltaNet — экспериментальная оптимизация prefix caching.

**Статус:** Работает. Known issue — block_size alignment (2048 tokens) тратит память, но не вызывает ошибок. `num_gpu_blocks_override=512` компенсирует.

**Действие:** Мониторить [#37121](https://github.com/vllm-project/vllm/issues/37121) для fix'а overestimation.

#### Проблема 8: num_gpu_blocks=0 с override=512

**Root cause:** [Issue #37121](https://github.com/vllm-project/vllm/issues/37121) — **7x memory overestimation** для Qwen3.5.

vLLM профилер обрабатывает все 32 слоя одинаково, но у Qwen3.5:

- 24 GatedDeltaNet — O(1) state (fixed ~12 MB total)
- 8 Full Attention — O(n) KV cache (~32 KB/token)

Профилер считает, что все 32 слоя = Attention, вычисляет 0 доступных блоков (вся память "занята"). `num_gpu_blocks_override=512` заставляет выделить 512 блоков.

**Статус:** PR #37124 в review. До мерджа override необходим.

**На L4 (24GB):** Override=512 вызывает OOM, потому что на L4 реально нет места для 512 блоков Attention после загрузки модели (17.7 GiB weights + warmup overhead).

**Рекомендация:** Оставить L40S (48GB), не использовать L4 для Qwen3.5-9B с 65K контекстом.

#### Проблема 9: Memory snapshot не помогает

**Root cause:** vLLM EngineCore работает как subprocess (PID 75). Modal snapshot может захватить subprocess, но без **sleep mode** GPU state не снапшотится корректно.

**Нужный pattern (из [Modal Ministral 3 example](https://modal.com/docs/examples/ministral3_inference)):**

```python
@modal.enter(snap=True)
def start(self):
    # Start vLLM server (НЕ LLM class) с sleep mode
    import subprocess
    self.proc = subprocess.Popen(
        "vllm serve Qwen/Qwen3.5-9B --host 0.0.0.0 --port 8000 ...",
        shell=True
    )
    # Warm up with test request
    # Put server to sleep -- GPU state checkpointed

@modal.enter(snap=False)
def wake_up(self):
    # Wake server from sleep -- GPU state restored in ~5s
```

**Проблема:** требует переход с `vllm.LLM` (offline) на `vllm serve` (server) mode. Это крупный рефактор. Рекомендуется как Phase 2 оптимизации.

#### Проблема 10: FlashInfer JIT needs nvcc

**Root cause:** FlashInfer компилирует CUDA kernels при первом использовании через JIT.

**Решение A — pre-compiled packages:**

```python
# modal/app.py
llm_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .pip_install(
        "vllm>=0.18.0",
        "flashinfer-cubin",        # pre-compiled kernels
        "pydantic>=2.0",
    )
    .add_local_dir(_modal_src, remote_path="/root")
)
```

**Решение B — TRITON_ATTN backend (убирает FlashInfer dependency):**

```python
import os
os.environ["VLLM_ATTENTION_BACKEND"] = "TRITON_ATTN_VLLM_V1"
```

Triton backend не требует nvcc, работает на любом GPU. Производительность: **100.7% от FlashAttention 3** на H100 ([vLLM blog](https://vllm.ai/blog/vllm-triton-backend-deep-dive)). Для L40S — comparable.

**Рекомендация:** Решение B проще. Переход на `debian_slim` image уменьшит image size на ~3GB.

#### Проблема 11: Logger.opt error

```
'Logger' object has no attribute 'opt'
```

**Root cause:** Код использует Loguru API (`logger.opt(exception=True)`) в контексте, где logger — стандартный `logging.Logger`.

**Решение:** В Modal-related code использовать stdlib logging:

```python
import logging
logger = logging.getLogger(__name__)
# Вместо logger.opt(exception=True).error(...)
logger.error("...", exc_info=True)
```

**Файл:** `backend/app/tasks/book_tasks.py` — строки с `logger.opt()` в entity synthesis phase.

#### Проблема 12: Entity UnboundLocalError

```
cannot access local variable 'Entity' where it is not associated with a value
```

**Root cause:** `UnboundLocalError` — переменная `Entity` используется до присваивания в try/except блоке entity synthesis.

**Решение:** проверить import и инициализацию `Entity` в synthesis path. Вероятно, conditional import не срабатывает при Modal path.

#### Проблема 13: destroy_process_group warning

```
WARNING: destroy_process_group() was not called before program exit
```

**Root cause:** PyTorch NCCL warning — vLLM не вызывает cleanup при завершении ([Issue #19196](https://github.com/vllm-project/vllm/issues/19196)).

**Статус:** **Безвредно** в serverless — контейнер уничтожается полностью.

**Подавление:**

```python
@modal.exit()
def cleanup(self):
    import torch.distributed as dist
    if dist.is_initialized():
        dist.destroy_process_group()
```

---

## 5. Оптимизация cold start

### Текущий breakdown (211s total)

| Фаза                              | Время               | Доля |
| --------------------------------- | ------------------- | ---- |
| Model loading (safetensors)       | 12.75s              | 6%   |
| Dynamo bytecode transform         | 12.58s              | 6%   |
| torch.compile (graph compilation) | 37.99s + 2.35s save | 19%  |
| CUDA graph capture (58 graphs)    | 7s                  | 3%   |
| Warmup/profiling                  | 100.46s             | 48%  |
| Engine init overhead              | ~38s                | 18%  |

### Стратегии оптимизации (по приоритету)

#### Priority 1: Persist compile cache (effort: LOW, impact: -30s)

```python
# modal/app.py
compile_cache_volume = modal.Volume.from_name("fancai-compile-cache", create_if_missing=True)

COMMON_CLS_KWARGS = dict(
    volumes={
        VOLUME_PATH: model_volume,
        "/root/.cache/vllm": compile_cache_volume,
    },
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
```

**Эффект по [данным Tensorfuse](https://tensorfuse.io/docs/blogs/reducing_gpu_cold_start):**

- Compilation: 42s -> 13s (-29s)
- CUDA graph: 54s -> 7s (уже cached)
- **Total savings: ~30s**

#### Priority 2: Reduce CUDA graph capture (effort: LOW, impact: -40s)

```python
# modal/llm_extractor.py
self.llm = LLM(
    ...
    compilation_config={
        "cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32],  # вместо ~67 default sizes
    },
)
```

Текущий лог показывает: `Capturing CUDA graphs (PIECEWISE): 51/51` + `(decode, FULL): 35`. Уменьшение до 6 sizes ~ -40s на warmup.

#### Priority 3: Optimization level O1 (effort: LOW, impact: -20s)

```python
# modal/llm_extractor.py, в начале load_model()
import os
os.environ["VLLM_TORCH_COMPILE_LEVEL"] = "1"
```

O1 vs O2: ~10-15% медленнее inference, но ~20s быстрее startup. Для batch processing trade-off выгоден.

#### Priority 4: GPU snapshot sleep mode (effort: HIGH, impact: -90%)

Требует миграцию с `vllm.LLM` на `vllm serve` внутри Modal. Полная реализация:

```python
@app.cls(image=llm_image, gpu=LLM_GPU, timeout=LLM_TIMEOUT, **COMMON_CLS_KWARGS)
class LLMExtractor:
    @modal.enter(snap=True)
    def start(self):
        import subprocess, time, httpx
        self.proc = subprocess.Popen(
            f"vllm serve {LLM_MODEL_ID} "
            f"--host 0.0.0.0 --port 8000 "
            f"--max-model-len {MAX_MODEL_LEN} "
            f"--gpu-memory-utilization {GPU_MEMORY_UTILIZATION} "
            f"--kv-cache-dtype {KV_CACHE_DTYPE} "
            f"--enable-prefix-caching",
            shell=True
        )
        # Wait for server ready
        for _ in range(300):
            try:
                httpx.get("http://localhost:8000/health")
                break
            except httpx.ConnectError:
                time.sleep(1)
        # Warmup request
        httpx.post("http://localhost:8000/v1/chat/completions", json={...})
        # Sleep for snapshot
        httpx.post("http://localhost:8000/sleep")

    @modal.enter(snap=False)
    def wake_up(self):
        import httpx
        httpx.post("http://localhost:8000/wake_up")

    @modal.method()
    def extract_chapters_batch(self, ...):
        # HTTP calls to localhost:8000
        ...
```

**Ожидаемый эффект:** ~118s -> ~12s (10x, по [Modal blog](https://modal.com/blog/mistral-3)).

**Рекомендация:** отложить на Phase 2. Текущие Priority 1-3 дают ~211s -> ~110-130s — достаточно для batch mode.

### Ожидаемый результат после Priority 1-3

| Фаза                 | До        | После                        |
| -------------------- | --------- | ---------------------------- |
| Model loading        | 12.75s    | 12.75s (без изменений)       |
| torch.compile        | 52.34s    | ~15s (cached)                |
| Warmup/profiling     | 100.46s   | ~50-60s (меньше CUDA graphs) |
| CUDA graph capture   | 7s        | ~3s (6 sizes vs 51+35)       |
| Engine init overhead | ~38s      | ~20s (O1)                    |
| **Total**            | **~211s** | **~100-110s**                |

---

## 6. Рекомендуемая архитектура

### 6.1. Flow diagram

```
+-------------------------------------------------------------+
| VPS (Celery task)                                           |
|                                                             |
|  1. Load chapters from DB                                   |
|  2. Filter service pages                                    |
|  3. Collect chapter_texts: List[str]                        |
|                                                             |
|  4. extractor.extract_chapters_batch.remote(                |
|       chapter_texts=chapter_texts,                          |
|       system_prompt=PROMPT,                                 |
|       schema_json=SCHEMA,                                   |
|     )                                                       |
|     | один .remote() вызов                                  |
|     | asyncio.to_thread() (blocking remote call)             |
|                                                             |
|  5. Получить List[dict | None]                              |
|  6. Конвертировать каждый dict -> ChapterAnalysisResult     |
|  7. Retry failed chapters (None results) по одному          |
|  8. Продолжить post-processing (reduce, synthesis, graph)   |
+-------------------------------------------------------------+
              |
              v
+-------------------------------------------------------------+
| Modal L40S Container                                        |
|                                                             |
|  extract_chapters_batch(chapter_texts, system_prompt, ...)  |
|                                                             |
|  1. Pre-validate: tokenize each chapter, filter oversized   |
|  2. Build conversations:                                    |
|     [                                                       |
|       [{"role": "system", ...}, {"role": "user", ch1}],     |
|       [{"role": "system", ...}, {"role": "user", ch2}],     |
|       ...                                                   |
|     ]                                                       |
|  3. llm.chat(messages=conversations, sampling_params=sp)    |
|     | vLLM continuous batching                              |
|     | 20+ concurrent requests on one GPU                    |
|  4. Parse results, catch per-chapter errors                 |
|  5. Return List[dict | None]                                |
+-------------------------------------------------------------+
```

### 6.2. Обработка ошибок в batch

```python
# Внутри Modal контейнера
results: List[dict | None] = [None] * len(chapter_texts)

# Batch call
try:
    outputs = self.llm.chat(messages=valid_conversations, sampling_params=params)
    for idx, output in zip(valid_indices, outputs):
        try:
            if output.outputs[0].finish_reason == "length":
                # JSON truncated — пометить для retry
                results[idx] = None
            else:
                results[idx] = json.loads(output.outputs[0].text)
        except json.JSONDecodeError:
            results[idx] = None
except Exception as e:
    # Весь batch failed — fallback на sequential
    for i, conv in enumerate(valid_conversations):
        try:
            single_output = self.llm.chat(messages=conv, sampling_params=params)
            results[valid_indices[i]] = json.loads(single_output[0].outputs[0].text)
        except Exception:
            results[valid_indices[i]] = None

return results
```

### 6.3. Retry failed chapters

```python
# VPS (Celery task) — после получения batch_results
failed_indices = [i for i, r in enumerate(batch_results) if r is None and not is_service_page[i]]

if failed_indices:
    logger.warning(f"Retrying {len(failed_indices)} failed chapters individually")
    for i in failed_indices:
        try:
            single_result = await asyncio.to_thread(
                extractor.extract_chapter.remote,
                chapter_text=chapter_texts[i],
                system_prompt=EXTRACTION_SYSTEM_PROMPT,
                schema_json=EXTRACTION_SCHEMA_JSON,
            )
            batch_results[i] = single_result
        except Exception as e:
            logger.error(f"Chapter {i+1} retry failed: {e}")
```

---

## 7. Код изменений

### 7.1. `modal/config.py` — обновлённые параметры

```python
"""Конфигурация Modal pipeline."""

# Модели
LLM_MODEL_ID = "Qwen/Qwen3.5-9B"
IMAGE_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
VOLUME_PATH = "/models"
VOLUME_NAME = "fancai-models"
COMPILE_CACHE_VOLUME_NAME = "fancai-compile-cache"  # NEW: torch.compile cache

# GPU
LLM_GPU = "L40S"
IMAGE_GPU = "L4"

# vLLM
MAX_MODEL_LEN = 32768        # CHANGED: 65536 -> 32768 (удвоение concurrency, достаточно для 99% глав)
GPU_MEMORY_UTILIZATION = 0.95  # CHANGED: 0.90 -> 0.95 (+2.4 GB KV cache)
KV_CACHE_DTYPE = "fp8"
NUM_GPU_BLOCKS_OVERRIDE = 512  # NEW: workaround для Qwen3.5 bug #37121

# Batch processing
MAX_BATCH_CHAPTERS = 50       # NEW: макс глав в одном batch
MAX_TOKENS_PER_CHAPTER = 32768  # NEW: max output tokens per chapter

# Таймауты
LLM_TIMEOUT = 1800   # CHANGED: 600 -> 1800 (30 мин для batch)
IMAGE_TIMEOUT = 120
SCALEDOWN_WINDOW = 60  # CHANGED: 120 -> 60 (batch не нуждается в долгом idle)

# Генерация изображений
IMAGE_WIDTH = 768
IMAGE_HEIGHT = 768
IMAGE_NUM_STEPS = 4
IMAGE_GUIDANCE_SCALE = 1.0
```

### 7.2. `modal/app.py` — compile cache volume

```python
"""Modal-приложение для AI-пайплайна fancai."""

from pathlib import Path
import modal

from config import (
    VOLUME_NAME,
    VOLUME_PATH,
    COMPILE_CACHE_VOLUME_NAME,
    LLM_GPU,
    IMAGE_GPU,
    SCALEDOWN_WINDOW,
    LLM_TIMEOUT,
    IMAGE_TIMEOUT,
)

app = modal.App("fancai-pipeline")

model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
compile_cache_volume = modal.Volume.from_name(COMPILE_CACHE_VOLUME_NAME, create_if_missing=True)

_modal_src = Path(__file__).parent

llm_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .pip_install("vllm>=0.18.0", "pydantic>=2.0")
    .add_local_dir(_modal_src, remote_path="/root")
)

diffusers_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "diffusers>=0.37", "torch>=2.5", "transformers>=4.45", "accelerate>=1.0"
    )
    .add_local_dir(_modal_src, remote_path="/root")
)

COMMON_CLS_KWARGS = dict(
    volumes={
        VOLUME_PATH: model_volume,
        "/root/.cache/vllm": compile_cache_volume,  # NEW: persist torch.compile cache
    },
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)

import llm_extractor  # noqa: F401, E402
import image_generator  # noqa: F401, E402
```

### 7.3. `modal/llm_extractor.py` — batch extraction

```python
"""LLM Extractor — Qwen3.5-9B на vLLM для извлечения сущностей и описаний."""

import json
import logging
import os
from typing import List, Optional

import modal

from app import app, llm_image, COMMON_CLS_KWARGS
from config import (
    LLM_MODEL_ID,
    VOLUME_PATH,
    LLM_GPU,
    LLM_TIMEOUT,
    MAX_MODEL_LEN,
    GPU_MEMORY_UTILIZATION,
    KV_CACHE_DTYPE,
    NUM_GPU_BLOCKS_OVERRIDE,
    MAX_TOKENS_PER_CHAPTER,
)

logger = logging.getLogger(__name__)


@app.cls(
    image=llm_image,
    gpu=LLM_GPU,
    timeout=LLM_TIMEOUT,
    **COMMON_CLS_KWARGS,
)
class LLMExtractor:
    @modal.enter()
    def load_model(self):
        # Optimization level O1 для быстрого startup
        os.environ.setdefault("VLLM_TORCH_COMPILE_LEVEL", "1")

        from vllm import LLM

        self.llm = LLM(
            model=LLM_MODEL_ID,
            download_dir=VOLUME_PATH,
            max_model_len=MAX_MODEL_LEN,
            gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            kv_cache_dtype=KV_CACHE_DTYPE,
            dtype="bfloat16",
            enable_prefix_caching=True,
            num_gpu_blocks_override=NUM_GPU_BLOCKS_OVERRIDE,
            compilation_config={
                "cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32],
            },
        )

    @modal.exit()
    def cleanup(self):
        """Cleanup GPU resources."""
        try:
            import torch.distributed as dist
            if dist.is_initialized():
                dist.destroy_process_group()
        except Exception:
            pass

    @modal.method()
    def extract_chapter(
        self, chapter_text: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Извлечение из одной главы (backward-compatible, для retry)."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=MAX_TOKENS_PER_CHAPTER,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)

    @modal.method()
    def extract_chapters_batch(
        self,
        chapter_texts: List[str],
        system_prompt: str,
        schema_json: str,
    ) -> List[Optional[dict]]:
        """Batch extraction — все главы через один vLLM batch call.

        Returns:
            List[dict | None] — None для failed chapters (truncation, parse error).
            Indices match input chapter_texts.
        """
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        results: List[Optional[dict]] = [None] * len(chapter_texts)

        if not chapter_texts:
            return results

        # Build conversations
        conversations = []
        valid_indices = []

        for i, text in enumerate(chapter_texts):
            if not text or not text.strip():
                continue
            conversations.append([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"<book_text>{text}</book_text>"},
            ])
            valid_indices.append(i)

        if not conversations:
            return results

        params = SamplingParams(
            max_tokens=MAX_TOKENS_PER_CHAPTER,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )

        # Batch inference
        try:
            outputs = self.llm.chat(messages=conversations, sampling_params=params)

            for idx, output in zip(valid_indices, outputs):
                try:
                    text = output.outputs[0].text
                    finish_reason = output.outputs[0].finish_reason

                    if finish_reason == "length":
                        logger.warning(
                            f"Chapter {idx + 1}: output truncated (finish_reason=length)"
                        )
                        # Attempt parse anyway — sometimes truncated JSON is still valid
                        try:
                            results[idx] = json.loads(text)
                        except json.JSONDecodeError:
                            results[idx] = None
                    else:
                        results[idx] = json.loads(text)

                except (json.JSONDecodeError, IndexError, AttributeError) as e:
                    logger.error(f"Chapter {idx + 1}: parse error: {e}")
                    results[idx] = None

        except Exception as e:
            logger.error(f"Batch inference failed: {e}, falling back to sequential")
            # Fallback: process each chapter individually
            for i, conv in enumerate(conversations):
                try:
                    single_output = self.llm.chat(messages=conv, sampling_params=params)
                    results[valid_indices[i]] = json.loads(
                        single_output[0].outputs[0].text
                    )
                except Exception as seq_e:
                    logger.error(
                        f"Chapter {valid_indices[i] + 1} sequential fallback failed: "
                        f"{seq_e}"
                    )
                    results[valid_indices[i]] = None

        succeeded = sum(1 for r in results if r is not None)
        logger.info(
            f"Batch extraction: {succeeded}/{len(chapter_texts)} chapters succeeded"
        )

        return results

    @modal.method()
    def reduce_entities(
        self, entities_json: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Дедупликация сущностей — объединение дубликатов."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=4096,
            temperature=0.0,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": entities_json},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)
```

### 7.4. `backend/app/services/modal_client.py` — batch converter

Добавить функцию `modal_batch_to_chapter_results`:

```python
def modal_batch_to_chapter_results(
    batch_results: List[Optional[Dict[str, Any]]],
) -> List[Optional[ChapterAnalysisResult]]:
    """Конвертация batch результатов Modal -> List[ChapterAnalysisResult | None].

    NEW: для batch mode. None results означают failed chapters.
    """
    return [
        modal_response_to_chapter_result(r) if r is not None else None
        for r in batch_results
    ]
```

### 7.5. `backend/app/tasks/book_tasks.py` — batch вызов (ключевые изменения)

**Заменить sequential processing на batch:**

```python
# ВМЕСТО текущего кода (lines 351-459):
# chapter_semaphore = asyncio.Semaphore(1 if use_modal else 10)
# async def process_chapter_safe(idx, chapter_id): ...

# НОВЫЙ КОД для Modal batch:
if use_modal:
    # Фаза 1: собрать все главы для batch
    chapter_texts = []
    chapter_db_ids = []
    chapter_indices = []
    service_page_indices = set()

    for idx, chapter in enumerate(chapters):
        async with AsyncSessionLocal() as session:
            stmt = select(Chapter).where(Chapter.id == chapter.id)
            res = await session.execute(stmt)
            ch = res.scalar_one_or_none()

            if not ch or ch.is_description_parsed:
                continue

            # Service page check
            content_lower = (ch.content or "")[:500].lower()
            title_lower = (ch.title or "").lower()
            is_service = any(
                k in title_lower or k in content_lower
                for k in SERVICE_PAGE_KEYWORDS
            )
            if ch.word_count and ch.word_count < 100:
                is_service = True

            if is_service:
                ch.is_service_page = True
                ch.is_description_parsed = True
                ch.parsed_at = datetime.now(timezone.utc)
                await session.commit()
                service_page_indices.add(idx)
                continue

            chapter_texts.append(ch.content)
            chapter_db_ids.append(ch.id)
            chapter_indices.append(idx)

    # Фаза 2: batch вызов Modal
    if chapter_texts:
        logger.info(f"Sending {len(chapter_texts)} chapters to Modal batch extraction")

        extractor = get_llm_extractor()
        batch_results = await asyncio.to_thread(
            extractor.extract_chapters_batch.remote,
            chapter_texts=chapter_texts,
            system_prompt=EXTRACTION_SYSTEM_PROMPT,
            schema_json=EXTRACTION_SCHEMA_JSON,
        )

        # Фаза 3: обработать результаты
        from app.services.modal_client import modal_batch_to_chapter_results
        chapter_results = modal_batch_to_chapter_results(batch_results)

        failed_indices = []
        for i, (result, chapter_id) in enumerate(zip(chapter_results, chapter_db_ids)):
            original_idx = chapter_indices[i]

            if result is None:
                failed_indices.append(i)
                continue

            # Process successful chapter (existing logic from process_chapter_safe)
            # ... save descriptions, entities, relationships ...
            # ... consistency manager ...

        # Фаза 4: retry failed chapters individually
        if failed_indices:
            logger.warning(
                f"Retrying {len(failed_indices)} failed chapters individually"
            )
            for i in failed_indices:
                try:
                    single_result = await asyncio.to_thread(
                        extractor.extract_chapter.remote,
                        chapter_text=chapter_texts[i],
                        system_prompt=EXTRACTION_SYSTEM_PROMPT,
                        schema_json=EXTRACTION_SCHEMA_JSON,
                    )
                    # Process single result...
                except Exception as e:
                    logger.error(
                        f"Chapter {chapter_indices[i]+1} retry failed: {e}"
                    )
```

### 7.6. `modal/schemas.py` — maxLength constraints

```python
"""Pydantic-схемы для structured output Modal LLM."""

from typing import List, Optional
from pydantic import BaseModel, Field


class ModalEntitySchema(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(default="character", description="character, location, object")
    visual_summary: str = Field(default="", max_length=500)
    aliases: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = Field(default=None, max_length=200)
    chapter_event_inner: Optional[str] = Field(default=None, max_length=200)


class ModalDescriptionSchema(BaseModel):
    content: str = Field(max_length=2000)
    type: str = Field(default="location")
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list)
    text_offset: Optional[int] = None
    image_prompt_en: str = Field(
        default="",
        max_length=300,
        description="English image prompt, 30-60 words, visual details only, SFW",
    )


class ModalRelationshipSchema(BaseModel):
    source: str = Field(max_length=200)
    target: str = Field(max_length=200)
    type: str
    weight: float = Field(default=0.5)
    context: str = Field(default="", max_length=300)


class ModalExtractionResponse(BaseModel):
    descriptions: List[ModalDescriptionSchema]
    entities: List[ModalEntitySchema]
    relationships: List[ModalRelationshipSchema]


class ModalReduceResponse(BaseModel):
    merge_operations: List[dict] = Field(default_factory=list)
    delete_operations: List[dict] = Field(default_factory=list)
```

---

## 8. Риски и fallbacks

### Риск 1: Batch call fails полностью

**Вероятность:** LOW (vLLM batch стабилен)
**Impact:** HIGH (0 глав обработано)
**Mitigation:** Fallback на sequential processing внутри Modal контейнера (уже в коде extract_chapters_batch). Если и это fails — fallback на OpenRouter/Gemini path (existing code path).

### Риск 2: max_model_len=32768 — глава превышает лимит

**Вероятность:** LOW-MEDIUM (зависит от книги)
**Impact:** MEDIUM (глава пропускается)
**Mitigation:** Pre-validate token counts, oversized chapters -> split на chunks или process through OpenRouter. Альтернатива: оставить 65536, потерять concurrency.

### Риск 3: GPU snapshot (alpha) не работает

**Вероятность:** MEDIUM (alpha feature)
**Impact:** LOW (cold start ~110s вместо ~12s)
**Mitigation:** Не зависим от GPU snapshot — Priority 1-3 оптимизации дают ~110s без snapshot. GPU snapshot — Phase 2 bonus.

### Риск 4: `guidance` backend медленнее xgrammar

**Вероятность:** MEDIUM
**Impact:** LOW (~10-20% slower structured output)
**Mitigation:** Тестировать обе backend'а. Если xgrammar стабилен с новыми vLLM versions — вернуться на xgrammar.

### Риск 5: Qwen3.5-9B bug #37121 fix ломает override

**Вероятность:** LOW-MEDIUM
**Impact:** MEDIUM (OOM или неоптимальное распределение)
**Mitigation:** При обновлении vLLM — тестировать без override, проверять KV cache allocation в логах.

### Риск 6: Modal Queue rate limits / reliability

**Вероятность:** LOW
**Impact:** LOW (progress не обновляется, но обработка идёт)
**Mitigation:** Progress reporting через Queue — best-effort. Если Queue fails, user просто ждёт финальный результат.

### Plan B: OpenRouter Batch

Если Modal path нестабилен, **Gemini Batch API** (через OpenRouter) предлагает:

- ~50% скидка от standard pricing
- Асинхронная обработка (results within 24h)
- Не нужна GPU инфраструктура

---

## 9. Benchmarks

### 9.1. Throughput estimation

**Базовые данные (из логов и benchmarks):**

- Qwen3.5-9B output speed: ~40-50 tok/s (batch 1), ~300-500 tok/s (batch 8-20)
- Средняя глава: ~8K input tokens, ~4K output tokens (descriptions + entities + relationships)
- System prompt: ~500 tokens (shared через prefix caching)

**Sequential (текущее):**

```
23 главы x (prefill ~8K tok + decode ~4K tok)
= 23 x (~160s prefill + ~80s decode)    [при ~50 tok/s]
= 23 x ~240s = 5520s = 92 мин inference
+ 23 x ~30s overhead (remote call, parsing)
= ~107 мин total
```

**Batch (рекомендуемое):**

```
vLLM continuous batching на L40S:
- Prefill: 23 x 8K = 184K tokens, chunked prefill 8192 tokens/batch
  = ~23 batches x ~2s each = 46s total prefill
- Decode: 23 x 4K = 92K tokens, ~500 tok/s aggregate at batch 20
  = ~184s decode
- Total inference: ~230s = 4 мин

+ Cold start: ~110s (с оптимизациями Priority 1-3)
+ Remote call overhead: ~10s
+ JSON parsing: ~5s

= 6 мин total (vs 107 мин)
```

**С GPU snapshot (Phase 2):**

```
Cold start: ~12s
Inference: ~230s
Overhead: ~15s
= 4.3 мин total
```

### 9.2. KV cache capacity

**Текущее (max_model_len=65536):**

```
GPU: L40S 48GB
Model weights: ~18 GB
Available for KV: ~48 x 0.95 - 18 = 27.6 GB
Per request (65K reserved): ~2 GB (attention only, 8 layers)
Max concurrent: ~13 requests
```

**Оптимизированное (max_model_len=32768):**

```
Per request (32K reserved): ~1 GB
Max concurrent: ~27 requests
```

**Реальное (средняя глава ~8K tokens):**

```
Per request (8K actual): ~256 MB
Theoretical max: ~107 concurrent
Practical (vLLM scheduler overhead): ~50-60 concurrent
```

### 9.3. Cost comparison

| Сценарий                              | GPU time | Cost (L40S $1.95/hr) |
| ------------------------------------- | -------- | -------------------- |
| Sequential (current)                  | ~107 мин | **$3.48**            |
| Batch (recommended)                   | ~6 мин   | **$0.20**            |
| Batch + GPU snapshot                  | ~4.3 мин | **$0.14**            |
| OpenRouter Gemini Flash (23 chapters) | N/A      | ~$0.10-0.20 (API)    |

### 9.4. Time breakdown comparison

| Фаза             | Sequential         | Batch (Phase 1) | Batch + Snapshot (Phase 2) |
| ---------------- | ------------------ | --------------- | -------------------------- |
| Cold start       | 211s x (1-23)      | ~110s x 1       | ~12s x 1                   |
| Network overhead | ~30s x 23 = 690s   | ~10s x 1        | ~10s x 1                   |
| Inference        | ~240s x 23 = 5520s | ~230s           | ~230s                      |
| Post-processing  | ~120s              | ~120s           | ~120s                      |
| **Total**        | **~107 мин**       | **~8 мин**      | **~6 мин**                 |

---

## Ссылки

### vLLM

- [vLLM Batch Chat API (PR #8648)](https://github.com/vllm-project/vllm/pull/8648)
- [Structured Output Truncation (Issue #8350)](https://github.com/vllm-project/vllm/issues/8350)
- [Per-request Error Handling (Issue #16732)](https://github.com/vllm-project/vllm/issues/16732)
- [Qwen3.5 KV Cache Overestimation (Issue #37121)](https://github.com/vllm-project/vllm/issues/37121)
- [Qwen3+Structured Output Bug (Issue #18819)](https://github.com/vllm-project/vllm/issues/18819)
- [xgrammar Schema Validation (Issue #15236)](https://github.com/vllm-project/vllm/issues/15236)
- [destroy_process_group (Issue #19196)](https://github.com/vllm-project/vllm/issues/19196)
- [Format Mismatch Warning (Issue #37103)](https://github.com/vllm-project/vllm/issues/37103)
- [Hybrid Models in vLLM V1 (PyTorch Blog)](https://pytorch.org/blog/hybrid-models-as-first-class-citizens-in-vllm/)
- [vLLM Triton Backend (Blog)](https://vllm.ai/blog/vllm-triton-backend-deep-dive)
- [vLLM Optimization Levels](https://docs.vllm.ai/en/stable/design/optimization_levels/)
- [Offline Inference Docs](https://docs.vllm.ai/en/latest/serving/offline_inference/)
- [Structured Outputs Docs](https://docs.vllm.ai/en/latest/features/structured_outputs/)

### Modal

- [GPU Memory Snapshots (Blog)](https://modal.com/blog/gpu-mem-snapshots)
- [Mistral 3 Cold Start 10x (Blog)](https://modal.com/blog/mistral-3)
- [Dynamic Batching Guide](https://modal.com/docs/guide/dynamic-batching)
- [Batch Processing Guide](https://modal.com/docs/guide/batch-processing)
- [vLLM Throughput Example](https://modal.com/docs/examples/vllm_throughput)
- [Memory Snapshot Docs](https://modal.com/docs/guide/memory-snapshot)
- [Timeouts Guide](https://modal.com/docs/guide/timeouts)
- [Pricing](https://modal.com/pricing)

### Qwen3.5

- [Qwen3.5-9B Model Card (HuggingFace)](https://huggingface.co/Qwen/Qwen3.5-9B)
- [Qwen3.5-9B Performance (Artificial Analysis)](https://artificialanalysis.ai/models/qwen3-5-9b)
- [Qwen3.5 vLLM Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)

### Benchmarks

- [Cold Start Reduction (Tensorfuse)](https://tensorfuse.io/docs/blogs/reducing_gpu_cold_start)
- [Guided Decoding Performance (SqueezeBits)](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang)
- [L40S GPU Benchmarks (Koyeb)](https://www.koyeb.com/docs/hardware/gpu-benchmarks)
- [FlashInfer Installation](https://docs.flashinfer.ai/installation.html)
