# Исследование: параллельная обработка глав книги на Modal с vLLM

## Контекст проекта

**Дата**: 27 марта 2026 года
**Проект**: fancai.ru — Fiction reader с AI-иллюстрациями и интерактивным глоссарием
**Цель исследования**: снизить время обработки книги из 23 глав с текущих ~107 минут до ~15 минут

### Текущая архитектура

**VPS (Celery worker)** вызывает **Modal** (GPU serverless) для LLM-extraction:

```
VPS (Celery task) → asyncio.to_thread(extractor.extract_chapter.remote, ...) → Modal контейнер (L40S 48GB GPU)
```

**Текущая проблема**: главы обрабатываются **последовательно** (Semaphore=1) — каждая глава = отдельный `.remote()` вызов Modal. При 23 главах:

- Каждый `.remote()` = сетевой round-trip VPS↔Modal + overhead
- При timeout 600s одна упавшая глава блокирует 10 мин
- Cold start контейнера ~3 мин (vLLM warmup), потом scaledown через 2 мин простоя → повторный cold start
- Итого: 23 × ~4.6 мин = ~107 мин

### Текущий стек на Modal

```python
# modal/config.py
LLM_MODEL_ID = "Qwen/Qwen3.5-9B"   # Гибридная модель (Mamba + Transformer), 131K контекст
LLM_GPU = "L40S"                     # 48GB VRAM
MAX_MODEL_LEN = 65536
GPU_MEMORY_UTILIZATION = 0.90
KV_CACHE_DTYPE = "fp8"

# modal/app.py
app = modal.App("fancai-pipeline")
llm_image = modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .pip_install("vllm>=0.18.0", "pydantic>=2.0")
    .add_local_dir(_modal_src, remote_path="/root")

COMMON_CLS_KWARGS = dict(
    volumes={VOLUME_PATH: model_volume},
    scaledown_window=120,              # 2 мин до scale-to-zero
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
```

```python
# modal/llm_extractor.py
@app.cls(image=llm_image, gpu=LLM_GPU, timeout=600, **COMMON_CLS_KWARGS)
class LLMExtractor:
    @modal.enter()
    def load_model(self):
        from vllm import LLM
        self.llm = LLM(
            model=LLM_MODEL_ID, download_dir=VOLUME_PATH,
            max_model_len=MAX_MODEL_LEN, gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            kv_cache_dtype=KV_CACHE_DTYPE, dtype="bfloat16",
            enable_prefix_caching=True,
        )

    @modal.method()
    def extract_chapter(self, chapter_text: str, system_prompt: str, schema_json: str) -> dict:
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams
        params = SamplingParams(
            max_tokens=8192, temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)
```

```python
# backend/app/tasks/book_tasks.py (VPS, Celery task)
chapter_semaphore = asyncio.Semaphore(1 if use_modal else 10)

async def process_chapter_safe(idx, chapter_id):
    async with chapter_semaphore:
        # ... load chapter from DB ...
        if use_modal:
            extractor = get_llm_extractor()  # modal.Cls.from_name("fancai-pipeline", "LLMExtractor")()
            modal_json = await asyncio.to_thread(
                extractor.extract_chapter.remote,
                chapter_text=local_chapter.content,
                system_prompt=EXTRACTION_SYSTEM_PROMPT,
                schema_json=EXTRACTION_SCHEMA_JSON,
            )
            result = modal_response_to_chapter_result(modal_json)

# Spawns all chapters, semaphore limits to 1 concurrent
results = await asyncio.gather(*(process_chapter_safe(idx, ch.id) for idx, ch in enumerate(chapters)))
```

### Результаты первого прогона (логи Modal)

```
Model loading took 17.66 GiB memory and 12.75 seconds
torch.compile took 52.34 s in total
Initial profiling/warmup run took 100.46 s
init engine took 211.92 seconds
GPU KV cache size: 375,936 tokens
Maximum concurrency for 65,536 tokens per request: 20.64x
```

**Ключевые метрики из логов celery:**

- Успешная глава: ~1-2 мин inference
- JSON truncation (max_tokens=8192): 5 глав, некоторые retry'ились
- Timeout 600s: 5 глав (потеряно 50 мин)
- Cold start vLLM: ~3.5 мин (со snapshot контейнера)
- Полное время обработки: 6462s (107 мин) для 23 глав, 13 успешных, 10 failed

### Ключевое наблюдение из логов Modal

```
GPU KV cache size: 375,936 tokens
Maximum concurrency for 65,536 tokens per request: 20.64x
```

vLLM на L40S может обрабатывать **до 20 запросов параллельно** в continuous batching режиме. Мы используем только 1.

### Ограничения аккаунта Modal

- Бесплатный план: лимит 10 GPU одновременно
- При попытке spawn 50 `.remote()` вызовов Modal создал 10 GPU контейнеров и отправил email о превышении лимита
- Необходимо работать в рамках 1-2 контейнеров

## Задача исследования

Найти **оптимальный паттерн** для параллельной обработки 20-100 глав книги через один Modal контейнер с vLLM, чтобы:

1. **Использовать continuous batching vLLM** — отправить все главы в одном `llm.chat()` вызове, vLLM сам распараллелит на GPU
2. **Один `.remote()` вызов** вместо N — минимизировать сетевой overhead и cold starts
3. **Graceful error handling** — если одна глава из batch не парсится, остальные не должны теряться
4. **Не превышать timeout** — batch из 23 глав должен уложиться в разумный timeout
5. **Целевое время**: 10-15 мин на 23 главы (вместо 107 мин)

## Конкретные вопросы для исследования

### 1. vLLM batch API (v0.18.0+)

- Как правильно вызывать `llm.chat()` с **списком conversations** для batch inference?
- Поддерживает ли `StructuredOutputsParams` batch mode? Есть ли ограничения?
- Как vLLM continuous batching распределяет GPU ресурсы между запросами в batch?
- Какой реальный throughput (tok/s) для Qwen3.5-9B на L40S в batch mode vs sequential?
- Есть ли `llm.chat()` async API (`llm.chat.aio()`) для неблокирующего batch processing?
- Как обработать ситуацию когда один запрос из batch fails (OOM, truncation)?

### 2. Modal паттерны для batch processing

- **`modal.method()` vs `modal.batched()`** — что лучше для нашего случая? Документация Modal упоминает `@modal.batched()` decorator — как он работает?
- **Можно ли вызвать `.remote()` один раз со списком** и получить все результаты?
- **`modal.parallel_map()`** — подходит ли для нашего случая?
- **Как увеличить timeout** для batch вызова (текущий 600s, нужно ~1800s)?
- **Как обрабатывать partial failures** в batch — если 2 из 23 глав failed, вернуть 21 успешный результат?
- **Scaledown window** — нужно ли его увеличить для batch mode чтобы контейнер не умирал между batch'ами?

### 3. Архитектура VPS ↔ Modal для batch

- **Один `.remote()` вызов с list[str]** vs **несколько `.remote()` с `asyncio.gather()`**?
- Как передать 23 главы (потенциально ~500KB текста суммарно) в одном вызове — есть ли лимиты на размер аргументов Modal?
- Как получить progress feedback с Modal на VPS (WebSocket к юзеру)?
- Стоит ли использовать `modal.Queue` для streaming результатов по мере готовности?

### 4. vLLM + Qwen3.5-9B специфика

- Qwen3.5-9B — это **гибридная Mamba+Transformer** модель. Как continuous batching работает с Mamba layers?
- `enable_prefix_caching=True` — помогает ли при batch с одинаковым system prompt?
- `kv_cache_dtype=fp8` — влияет ли на batch throughput?
- `max_model_len=65536` vs реальная длина глав (~5-15K tokens) — стоит ли уменьшить для увеличения batch concurrency?

### 5. Альтернативные подходы

- **vLLM OpenAI-compatible server** внутри Modal контейнера — запустить как web endpoint и слать HTTP запросы параллельно?
- **Data parallelism** — `data_parallel_size=2` на одном GPU?
- **Chunked processing** — разбить длинные главы на части для более равномерного batch?
- Есть ли готовые примеры Modal + vLLM batch processing в их официальных examples/guides?

### 6. Производительность и benchmarks

- Типичный throughput Qwen3.5-9B на L40S в batch mode (tok/s input, tok/s output)?
- Сколько concurrent requests помещается в 375K tokens KV cache при средней длине главы ~8K tokens?
- Overhead structured output (JSON schema enforcement) на batch throughput?
- Comparison: batch vLLM vs OpenRouter API (текущий Gemini Flash) по скорости для 23 глав?

### 7. Анализ логов Modal — ошибки, warnings, проблемы

Ниже полные логи двух прогонов на Modal. Для каждой проблемы нужно: исследовать в вебе причину, найти решение, оценить критичность.

#### Лог 1: Cold start + vLLM init на L40S (успешный, но долгий)

```
05:17:02 Creating GPU memory snapshot for Function.
05:17:08 == CUDA == CUDA Version 12.8.1
05:17:10 Snapshot created. Restoring Function from memory snapshot.
05:17:11 Restoring Function from memory snapshot.
05:17:26 INFO non-default args: {'download_dir': '/models', 'dtype': 'bfloat16', 'kv_cache_dtype': 'fp8', 'max_model_len': 65536, 'enable_prefix_caching': True, 'disable_log_stats': True, 'model': 'Qwen/Qwen3.5-9B'}
05:17:43 INFO Resolved architecture: Qwen3_5ForConditionalGeneration
05:17:43 INFO Using max model len 65536
05:17:43 INFO Using fp8 data type to store kv cache
05:17:43 INFO Chunked prefill is enabled with max_num_batched_tokens=8192
05:17:43 WARNING Mamba cache mode is set to 'align' for Qwen3_5ForConditionalGeneration by default when prefix caching is enabled
05:17:43 INFO Prefix caching in Mamba cache 'align' mode is currently enabled. Its support for Mamba layers is experimental.
05:17:57 INFO Setting attention block size to 1056 tokens
05:17:57 INFO Padding mamba page size by 0.76%
05:17:57 INFO Asynchronous scheduling is enabled.
05:18:07 WARNING We must use the `spawn` multiprocessing start method. Overriding VLLM_WORKER_MULTIPROC_METHOD to 'spawn'. Reasons: CUDA is initialized
05:18:14 (EngineCore pid=75) Initializing a V1 LLM engine (v0.18.0)
05:18:17 (EngineCore pid=75) world_size=1 rank=0 local_rank=0 backend=nccl
05:18:24 (EngineCore pid=75) Starting to load model Qwen/Qwen3.5-9B...
05:18:25 (EngineCore pid=75) Using backend AttentionBackendEnum.FLASH_ATTN for vit attention
05:18:25 (EngineCore pid=75) Using AttentionBackendEnum.FLASH_ATTN for MMEncoderAttention.
05:18:25 (EngineCore pid=75) Using Triton/FLA GDN prefill kernel
05:18:26 (EngineCore pid=75) Using FLASHINFER attention backend
05:18:26 (EngineCore pid=75) FutureWarning: The cuda.cudart module is deprecated
05:18:26 (EngineCore pid=75) FutureWarning: The cuda.nvrtc module is deprecated
05:18:27 Loading safetensors checkpoint shards: 0% | 0/4
05:18:31 Loading safetensors checkpoint shards: 25% | 1/4 [2.86s/it]
05:18:36 Loading safetensors checkpoint shards: 50% | 2/4 [2.87s/it]
05:18:39 Loading safetensors checkpoint shards: 75% | 3/4 [2.80s/it]
05:18:42 Loading safetensors checkpoint shards: 100% | 4/4 [2.58s/it]
05:18:43 (EngineCore pid=75) Loading weights took 10.77 seconds
05:18:44 (EngineCore pid=75) Model loading took 17.66 GiB memory and 12.75 seconds
05:18:44 (EngineCore pid=75) Encoder cache will be initialized with a budget of 16384 tokens
05:18:58 (EngineCore pid=75) Using cache directory for vLLM's torch.compile
05:18:58 (EngineCore pid=75) Dynamo bytecode transform time: 12.58 s
05:19:03 (EngineCore pid=75) Cache the graph of compile range (1, 8192)
05:19:36 (EngineCore pid=75) Compiling a graph for compile range (1, 8192) takes 37.99 s
05:19:38 (EngineCore pid=75) saved AOT compiled function
05:19:38 (EngineCore pid=75) torch.compile took 52.34 s in total
05:19:38 (EngineCore pid=75) UserWarning: Input tensor shape suggests potential format mismatch: seq_len (16) < num_heads (32)
05:21:01 (EngineCore pid=75) INFO Initial profiling/warmup run took 100.46 s
05:21:11 (EngineCore pid=75) INFO Overriding num_gpu_blocks=0 with num_gpu_blocks_override=512
05:21:11 (EngineCore pid=75) INFO Profiling CUDA graph memory: PIECEWISE=51, FULL=35
05:21:50 (EngineCore pid=75) INFO Estimated CUDA graph memory: 1.58 GiB total
05:21:50 (EngineCore pid=75) INFO Available KV cache memory: 20.27 GiB
05:21:50 (EngineCore pid=75) INFO GPU KV cache size: 331,584 tokens
05:21:50 (EngineCore pid=75) INFO Maximum concurrency for 65,536 tokens per request: 18.23x
05:21:54 Capturing CUDA graphs (PIECEWISE): 100% | 51/51 [3s, 15.36it/s]
05:21:56 Capturing CUDA graphs (decode, FULL): 46% | 16/35
05:21:58 (EngineCore pid=75) Graph capturing finished in 7 secs, took 1.29 GiB
05:21:58 (EngineCore pid=75) init engine took 211.92 seconds
05:21:58 INFO Supported tasks: ['generate']
05:22:02 (EngineCore pid=75) Shutdown initiated (timeout=0)
05:22:02 (EngineCore pid=75) Shutdown complete
05:22:02 WARNING: destroy_process_group() was not called before program exit
05:22:03 ERROR Engine core proc EngineCore died unexpectedly, shutting down client.
```

**Вопросы по логу 1 для исследования:**

- **`Mamba cache mode is set to 'align'... experimental`** — Это проблема? Qwen3.5 гибридная модель, как vLLM обрабатывает Mamba layers? Есть ли баги, known issues?
- **`spawn multiprocessing start method override`** — Modal snapshot инициализирует CUDA до fork. Влияет ли это на производительность? Есть ли workaround?
- **`torch.compile took 52.34 s`** — Это каждый cold start. Можно ли закешировать compilation artifacts в Modal Volume? Есть ли `VLLM_TORCH_COMPILE_CACHE` env var?
- **`Initial profiling/warmup run took 100.46 s`** — 100 секунд на warmup! Это нормально? Можно ли уменьшить? `VLLM_SKIP_WARMUP`?
- **`Overriding num_gpu_blocks=0 with num_gpu_blocks_override=512`** — Почему 0 блоков вычислено автоматически? `num_gpu_blocks_override` это fallback? Может ли это ограничивать throughput?
- **`UserWarning: Input tensor shape suggests potential format mismatch: seq_len (16) < num_heads (32)`** — Это Qwen3.5-специфичный warning. Влияет ли на корректность? На скорость?
- **`Shutdown initiated... Engine core proc died unexpectedly`** — Контейнер shutdown после snapshot. Нормально ли это для Modal? Или это проблема?
- **`destroy_process_group() was not called`** — Resource leak warning. Критично ли? Как исправить?
- **`enable_memory_snapshot=True` + `enable_gpu_snapshot=True`** — Snapshot создаётся, но vLLM всё равно полностью реинициализируется (211 сек). Почему snapshot не помогает? Проблема в subprocess EngineCore? Есть ли workaround?
- **Общее время cold start: 211 секунд (~3.5 мин)** — Можно ли уменьшить до <30 секунд? Какие стратегии?

#### Лог 2: Ошибки при обработке глав

```
# Chapter 2 — JSON truncation (max_tokens=8192)
02:31:53 Error parsing chapter 2: Unterminated string starting at: line 785 column 15 (char 23387)
  File "llm_extractor.py", line 58, in extract_chapter
  json.decoder.JSONDecodeError: Unterminated string starting at: line 785 column 15 (char 23387)

# Chapter 3 — первый вызов truncated, retry успешен
02:34:49 Chapter 3 parsed: 10 descriptions (первый прогон в другом потоке)
03:24:01 Error parsing chapter 3: Unterminated string starting at: line 3368 column 7 (char 87547)
03:29:04 Chapter 3 parsed: 9 descriptions (retry)

# Chapter 6, 8, 12, 16 — Timeout 600s
03:12:34 Error parsing chapter 6: Task's current input hit its timeout of 600s
  modal.exception.FunctionTimeoutError

# Chapter 7 — Invalid JSON (не truncation, а некорректный формат)
03:18:45 Error parsing chapter 7: Expecting property name enclosed in double quotes: line 3202 column 1 (char 90864)
  json.decoder.JSONDecodeError: Expecting property name

# Chapter 9, 13, 17 — JSON truncation, потом retry успешен
03:25:02 Error parsing chapter 9: Unterminated string (char 88726)
03:31:42 Chapter 9 parsed: 8 descriptions (retry)

# Entity synthesis failed
03:54:06 Reduce phase failed: 'Logger' object has no attribute 'opt'
03:54:06 Entity synthesis phase failed: cannot access local variable 'Entity' where it is not associated with a value

# Final result
Book processing finished: 13 chapters processed, 10 failed, 100 descriptions extracted, 6462s total
```

**Вопросы по логу 2 для исследования:**

- **JSON truncation при `StructuredOutputsParams(json=schema_json)`** — vLLM заявляет guaranteed valid JSON через structured outputs. Почему output всё равно truncated? Это баг в vLLM 0.18.0? Есть ли fix/workaround? Связано ли с `max_tokens`?
- **`Expecting property name enclosed in double quotes` (Ch 7)** — Это НЕ truncation, а malformed JSON от модели. Structured output должен предотвращать это. Почему не предотвратил? Qwen3.5-специфичная проблема?
- **Timeout 600s** — Что делает vLLM/модель 10 минут на одной главе? Это длинный input (>30K tokens)? Или structured output constraint замедляет генерацию?
- **`'Logger' object has no attribute 'opt'`** — Это Loguru API (`logger.opt(exception=True)`), значит в контексте где logger не Loguru. Где именно вызывается? В ConsistencyManager Modal reduce?
- **`cannot access local variable 'Entity'`** — UnboundLocalError в entity synthesis. Где именно? Это баг в book_tasks.py при Modal path?
- **Retry pattern** — Главы 3, 9, 13, 17 failed первый раз (truncation), потом retry сработал. Почему retry даёт другой результат? vLLM non-deterministic при temperature=0.1? Или retry пошёл через другой path (Gemini)?

#### Лог 3: L4 GPU — OOM

```
04:47:21 (EngineCore pid=57) Model loading took 17.66 GiB memory and 26.80 seconds
04:48:41 (EngineCore pid=57) torch.compile took 73.04 s in total
04:50:47 (EngineCore pid=57) Initial profiling/warmup run took 126.05 s
04:51:03 (EngineCore pid=57) Overriding num_gpu_blocks=0 with num_gpu_blocks_override=512
04:51:03 torch.OutOfMemoryError: CUDA out of memory.
  Tried to allocate 1.03 GiB. GPU 0 has a total capacity of 22.03 GiB of which 875.12 MiB is free.
  Process 1 has 21.17 GiB memory in use. 20.89 GiB allocated by PyTorch, 35.79 MiB reserved but unallocated.
```

**Вопросы по логу 3 для исследования:**

- **`num_gpu_blocks=0 with num_gpu_blocks_override=512`** — vLLM вычислил 0 доступных блоков, но override заставил его выделить 512. Это и вызвало OOM. Откуда берётся `num_gpu_blocks_override=512`? Это Modal config? vLLM default? Можно ли убрать override?
- **L4 (24GB) vs L40S (48GB)** — Модель 17.66 GiB + warmup overhead. На L4 остаётся <4GB для KV cache. Даже с fp8 KV cache этого мало. Минимальный GPU для Qwen3.5-9B с 65K контекстом?
- **`gpu_memory_utilization=0.90`** — На L40S показало 20.27 GiB available для KV cache. Если поднять до 0.95 — сколько будет? Есть ли риски?

#### Лог 4: L40S — flashinfer JIT failure (до фикса с CUDA devel image)

```
05:01:27 (EngineCore pid=57) RuntimeError: Could not find nvcc and default cuda_home='/usr/local/cuda' doesn't exist
  File "flashinfer/jit/cpp_ext.py", line 61, in get_cuda_path
```

**Вопросы по логу 4 для исследования:**

- **FlashInfer JIT compilation** — Почему flashinfer нуждается в runtime nvcc? Это специфика L40S (не Ada Lovelace как L4)? Или vLLM 0.18.0 всегда делает JIT?
- **`nvidia/cuda:12.8.1-devel-ubuntu22.04`** — Мы перешли на devel image для nvcc. Это добавляет ~3GB к image. Есть ли способ использовать pre-compiled flashinfer kernels без nvcc? `VLLM_ATTENTION_BACKEND=TRITON_ATTN`?
- **Можно ли использовать `modal.Image.debian_slim().apt_install("cuda-nvcc-12-8")`** вместо полного devel image? Это уменьшит image size.

### 8. Сводная таблица проблем для исследования

| #   | Проблема                       | Критичность | Текущее поведение                             | Нужно                          |
| --- | ------------------------------ | ----------- | --------------------------------------------- | ------------------------------ |
| 1   | Cold start 211s                | HIGH        | Каждый `.remote()` после scaledown            | <30s                           |
| 2   | torch.compile 52s              | HIGH        | Компиляция при каждом старте                  | Кеширование                    |
| 3   | Warmup 100s                    | HIGH        | Profiling при каждом старте                   | Skip или кеш                   |
| 4   | JSON truncation                | HIGH        | max_tokens=8192, structured output не спасает | Увеличить + понять баг         |
| 5   | Malformed JSON                 | MEDIUM      | Ch 7: invalid property name                   | Structured output не работает? |
| 6   | Timeout 600s на длинных главах | HIGH        | 5 глав lost                                   | Batch mode решит               |
| 7   | Mamba experimental warning     | LOW         | Prefix caching experimental                   | Мониторить                     |
| 8   | num_gpu_blocks=0 override      | MEDIUM      | Override 512, OOM на L4                       | Понять источник                |
| 9   | Memory snapshot не помогает    | MEDIUM      | vLLM subprocess не снапшотится                | Альтернативы                   |
| 10  | FlashInfer JIT needs nvcc      | LOW         | Решено через devel image                      | Оптимизировать image size      |
| 11  | Logger.opt error               | LOW         | Loguru API mismatch                           | Фикс в коде                    |
| 12  | Entity UnboundLocalError       | LOW         | Synthesis fails                               | Фикс в коде                    |
| 13  | destroy_process_group warning  | LOW         | Resource leak                                 | Cleanup в @modal.exit()        |

Для каждой проблемы нужно:

1. Исследовать root cause в документации vLLM / Modal / Qwen3.5
2. Найти решение или workaround
3. Оценить impact на производительность
4. Предложить конкретное изменение в коде/конфиге

## Формат ответа

Структурируй исследование в markdown документ `docs/research/modal-parallel-batch-processing.md` со следующими разделами:

1. **Executive Summary** — ключевые находки, рекомендуемый подход, ожидаемое время
2. **vLLM Batch API** — как использовать, примеры кода, ограничения
3. **Modal Patterns** — лучшие практики для batch GPU workloads
4. **Анализ логов — проблемы и решения** — для каждой из 13 проблем из таблицы: root cause, решение, код изменения
5. **Оптимизация cold start** — конкретные стратегии уменьшения 211s до минимума
6. **Рекомендуемая архитектура** — конкретная реализация batch обработки для нашего стека
7. **Код изменений** — полный код для `llm_extractor.py`, `book_tasks.py`, `config.py`, `app.py`
8. **Риски и fallbacks** — что может пойти не так, plan B
9. **Benchmarks** — ожидаемые числа производительности

Все рекомендации должны быть:

- Проверяемые — с ссылками на документацию vLLM, Modal, HuggingFace
- Актуальные — на март 2026 года (vLLM 0.18.0, Modal SDK 1.4.0, Qwen3.5-9B)
- С конкретным кодом — не абстрактные советы, а готовые изменения в файлах
