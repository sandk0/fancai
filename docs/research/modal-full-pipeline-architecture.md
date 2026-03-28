# Modal Full AI Pipeline Architecture — Исследование

**Дата:** 2026-03-25
**Scope:** Архитектура полного AI pipeline на Modal для обработки книг
**Метод:** WebSearch (20+ запросов), анализ документации Modal, vLLM, Gemini API

---

## 1. Modal Architecture Best Practices

### 1.1 @app.cls() vs @app.function()

**Когда @app.cls():**

- Нужен lifecycle hook `@modal.enter()` для загрузки модели в GPU один раз при старте контейнера
- Нужен `@modal.exit()` для cleanup
- Stateful операции: модель загружена в память, переиспользуется между запросами
- Method pooling: несколько методов на одном классе разделяют один контейнер

**Когда @app.function():**

- Stateless операции (CPU-only, вызовы внешних API)
- Простые трансформации данных
- Не требуется init-логика

**Для fancai pipeline:** `@app.cls()` для GPU-bound классов (FLUX, GLiNER2), `@app.function()` для CPU-bound (Gemini API calls, координация).

**Изменение в Modal 1.0 (май 2025):** классы с `@app.cls()` больше не могут иметь `__init__()`. Вместо этого — `modal.parameter()` для параметризации. `allow_concurrent_inputs` заменён на декоратор `@modal.concurrent`.

**Источники:**

- [modal.Cls reference](https://modal.com/docs/reference/modal.Cls)
- [Container lifecycle hooks](https://modal.com/docs/guide/lifecycle-functions)
- [Modal 1.0 migration guide](https://modal.com/docs/guide/modal-1-0-migration)

### 1.2 Один контейнер vs раздельные для LLM + Image Gen

**Раздельные контейнеры (рекомендуется для fancai):**

- LLM и Image Gen имеют разные требования к GPU VRAM
- FLUX.2 Klein 4B: ~13 GB VRAM (L4 24GB достаточно)
- GLiNER2: ~1 GB VRAM (T4 16GB с запасом, или CPU)
- Раздельное масштабирование: image gen может быть 0 контейнеров когда не нужен
- Разные cold start профили

**Один контейнер допустим когда:**

- Обе модели помещаются в VRAM одного GPU
- Всегда используются вместе (не наш случай)

**Для fancai:** 3 отдельных класса — ImageGenerator (L4), NERExtractor (T4/CPU), и обычная function для Gemini API.

**Источники:**

- [GPU acceleration](https://modal.com/docs/guide/gpu)
- [Volumes](https://modal.com/docs/guide/volumes)

### 1.3 Data Flow между Modal Functions

**Варианты передачи данных:**

| Метод               | Когда использовать                            | Latency                          |
| ------------------- | --------------------------------------------- | -------------------------------- |
| **Return values**   | Результат < 16MB, синхронный вызов            | Минимальная                      |
| **Modal Volumes**   | Большие файлы (изображения, веса моделей)     | Чтение быстрое, запись медленнее |
| **modal.Dict**      | Shared state между функциями                  | Низкая                           |
| **modal.Queue**     | Producer-consumer паттерн, streaming          | Низкая                           |
| **Redis (внешний)** | Интеграция с существующей инфраструктурой VPS | Зависит от сети                  |

**Для fancai pipeline:**

- Gemini API results (JSON) → return values (маленькие, <1MB на главу)
- FLUX images (PNG/JPEG) → return values as bytes или Modal Volume
- NER results (JSON) → return values
- Финальная запись в PostgreSQL VPS → через psycopg2 из Modal контейнера

**Modal Volumes — write-once, read-many:** оптимизированы для записи один раз (загрузка весов модели), чтения много раз (inference). Не подходят для частых обновлений.

**Источники:**

- [modal.Volume reference](https://modal.com/docs/reference/modal.Volume)
- [Volumes guide](https://modal.com/docs/guide/volumes)

### 1.4 Запись результатов в PostgreSQL на VPS

**Подход:** Modal контейнер подключается к PostgreSQL на VPS напрямую через `psycopg2`.

**Настройка:**

1. Modal Secrets хранит `DATABASE_URL` (или отдельные `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`)
2. `pg_hba.conf` на VPS разрешает подключение с IP-диапазонов Modal
3. SSL/TLS обязателен для production
4. Firewall VPS открыт на порту 5432 для Modal IP

**Альтернатива:** Modal функция возвращает результат → Celery worker на VPS пишет в PostgreSQL. Плюс: не нужно открывать PostgreSQL наружу. Минус: дополнительная latency.

**Рекомендация для fancai:** возвращать результаты через `Function.from_name()` в Celery worker, который пишет в локальный PostgreSQL. Это безопаснее и не требует открывать БД в интернет.

**Источники:**

- [Secrets guide](https://modal.com/docs/guide/secrets)
- [modal.Secret reference](https://modal.com/docs/reference/modal.Secret)
- [Example: db_to_sheet.py](https://github.com/modal-labs/modal-examples/blob/main/04_secrets/db_to_sheet.py)

### 1.5 Batch Processing: 50 items за один вызов vs 50 отдельных

**4 паттерна в Modal:**

| Паттерн               | Описание                                        | Когда                                               |
| --------------------- | ----------------------------------------------- | --------------------------------------------------- |
| **Function.map()**    | Параллельный вызов функции для каждого input    | Независимые inputs, нужен результат сразу           |
| **spawn_map()**       | Асинхронная отправка до 1M jobs                 | Fire-and-forget, batch processing                   |
| **@modal.batched**    | Dynamic batching — накопление запросов в batch  | GPU inference: несколько inputs в один forward pass |
| **@modal.concurrent** | Несколько inputs в одном контейнере параллельно | IO-bound workloads                                  |

**Для fancai (50 глав книги):**

- **LLM extraction (Gemini API):** `Function.map()` — 50 параллельных вызовов Gemini, каждый IO-bound
- **Image generation (FLUX):** `@modal.batched` — группировка по 4-8 images в один GPU batch
- **NER (GLiNER2):** `@modal.batched` — группировка текстов в один forward pass

**spawn_map() для целых книг:** один вызов `process_book.spawn()` запускает весь pipeline асинхронно.

**Performance данные:**

- Dynamic batching даёт до 2.8x throughput (пример с Whisper)
- 65% экономия на стоимости инференса
- `wait_ms` параметр контролирует максимальное ожидание для формирования batch

**Источники:**

- [Batch Processing guide](https://modal.com/docs/guide/batch-processing)
- [Dynamic batching](https://modal.com/docs/guide/dynamic-batching)
- [Scaling out](https://modal.com/docs/guide/scale)
- [Introducing Modal Batch](https://modal.com/blog/batch-processing)
- [Boost throughput with dynamic batching](https://modal.com/blog/batching-whisper)

### 1.6 Streaming результатов по мере обработки

**Подходы:**

- **modal.Queue** — producer-consumer: Modal function пишет в Queue, внешний consumer читает
- **Generator functions** — `Function.map()` возвращает итератор с результатами по мере готовности
- **Webhook callbacks** — Modal вызывает webhook на VPS после каждого шага

**Для fancai:** Celery worker вызывает `process_book.spawn()`, периодически проверяет статус через `FunctionCall.get()`. Или использует callback webhook для push-уведомлений о прогрессе.

### 1.7 Error Handling: Partial Failures в Batch

**Ключевой механизм — `return_exceptions=True`:**

```python
results = list(function.map(inputs, return_exceptions=True))
for input_data, result in zip(inputs, results):
    if isinstance(result, Exception):
        logger.error(f"Failed: {input_data}: {result}")
    else:
        process_success(result)
```

**Retry policy:**

```python
@app.function(retries=modal.Retries(
    max_retries=3,
    initial_delay=1.0,
    backoff_coefficient=2.0
))
```

**Поведение:**

- При `Function.map()` каждый input ретраится независимо
- `return_exceptions=True` — исключения возвращаются как результаты, batch не останавливается
- Deployed apps: container crashes ретраятся бесконечно с crash-loop backoff
- Ephemeral apps: ретраи до превышения failure rate

**Источники:**

- [Failures and retries](https://modal.com/docs/guide/retries)
- [modal.Retries reference](https://modal.com/docs/reference/modal.Retries)
- [modal.Function reference](https://modal.com/docs/reference/modal.Function)

### 1.8 Function.from_name() — вызов из Celery Worker

**Паттерн интеграции:**

```python
# В Celery worker на VPS
import modal

# Ленивая ссылка на deployed Modal function
process_book = modal.Function.from_name("fancai-pipeline", "BookPipeline.process")

# Синхронный вызов
result = process_book.remote(book_id=123, chapters=chapters_data)

# Асинхронный вызов (fire-and-forget)
call = process_book.spawn(book_id=123, chapters=chapters_data)
# Позже: result = call.get()
```

**Аутентификация:**

- `MODAL_TOKEN_ID` и `MODAL_TOKEN_SECRET` env vars на VPS
- Или `~/.modal.toml` (создаётся через `modal token new`)
- SDK: `pip install modal` на VPS

**Источники:**

- [Invoking deployed functions](https://modal.com/docs/guide/trigger-deployed-functions)
- [modal.Function reference](https://modal.com/docs/reference/modal.Function)

---

## 2. Cold Start Optimization

### 2.1 GPU Memory Snapshots

**Революционная фича (2025):** CUDA checkpoint/restore снимает snapshot всего GPU state — device memory, CUDA kernels, скомпилированные модели.

**Как работает:**

1. Первый контейнер загружает модель, создаёт snapshot (~10-15 сек)
2. Все последующие контейнеры стартуют из snapshot (~3-5 сек)
3. Speedup: **4-12x** быстрее обычного cold start

**Настройка:**

```python
@app.cls(
    gpu="L4",
    experimental_options={"enable_gpu_snapshot": True}
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        self.pipe = FluxPipeline.from_pretrained(...)
```

**Ограничения:**

- `torch.compile()` в `@modal.enter(snap=True)` может сломать snapshot для некоторых моделей
- xformers вызывает `torch.cuda.get_device_capability` при импорте — нужен workaround `XFORMERS_ENABLE_TRITON=1`
- vLLM пока не полностью поддерживает GPU snapshots (open issue #33930 в vllm-project)

**Совместимость:**

- FLUX.2 Klein: должен работать (diffusers pipeline)
- GLiNER2: должен работать (small model, simple CUDA ops)
- vLLM: экспериментально, cold start ~5 сек вместо 45 сек для Qwen2.5-0.5B

**Источники:**

- [GPU Memory Snapshots blog](https://modal.com/blog/gpu-mem-snapshots)
- [GPU Snapshot example](https://modal.com/docs/examples/gpu_snapshot)
- [Modal + Mistral 3 GPU snapshotting](https://modal.com/blog/mistral-3)
- [Memory Snapshot guide](https://modal.com/docs/guide/memory-snapshot)
- [vLLM GPU snapshot issue](https://github.com/vllm-project/vllm/issues/33930)

### 2.2 scaledown_window vs min_containers

| Параметр              | Описание                                 | Range          | Стоимость                |
| --------------------- | ---------------------------------------- | -------------- | ------------------------ |
| **scaledown_window**  | Время простоя до выключения контейнера   | 2 сек — 20 мин | Низкая (платишь за idle) |
| **min_containers**    | Минимум тёплых контейнеров 24/7          | 0+             | Высокая (постоянная)     |
| **buffer_containers** | Буфер горячих контейнеров при активности | 0+             | Средняя                  |

**Рекомендации для fancai:**

- **Image Gen (FLUX):** `scaledown_window=120` (2 мин), `min_containers=0` — книга обрабатывается пакетно, нет смысла держать warm
- **NER (GLiNER2):** `scaledown_window=60`, `min_containers=0` — аналогично
- **Не использовать `min_containers>0`** для batch workload — это для real-time API

### 2.3 Cold Start Timing

| GPU         | Modal cold start (без snapshot) | С GPU snapshot |
| ----------- | ------------------------------- | -------------- |
| T4 (16GB)   | ~2-4 сек + model load           | ~2-3 сек total |
| L4 (24GB)   | ~2-4 сек + model load           | ~2-3 сек total |
| A10G (24GB) | ~2-4 сек + model load           | ~2-3 сек total |
| A100 (80GB) | ~2-4 сек + model load           | ~3-5 сек total |

Modal платформа обеспечивает 1-4 сек cold start контейнера (без учёта загрузки модели). Загрузка модели — основной bottleneck (10-45 сек в зависимости от размера).

### 2.4 Время загрузки моделей

| Модель           | Размер  | GPU    | Время загрузки | С snapshot |
| ---------------- | ------- | ------ | -------------- | ---------- |
| FLUX.2 Klein 4B  | ~8 GB   | L4     | ~15-20 сек     | ~3 сек     |
| GLiNER2 base     | ~0.8 GB | T4/CPU | ~3-5 сек       | ~2 сек     |
| Qwen 7B (vLLM)   | ~14 GB  | A10G   | ~30-45 сек     | ~5 сек     |
| Qwen 0.5B (vLLM) | ~1 GB   | T4     | ~10-15 сек     | ~5 сек     |

**Источники:**

- [Cold start performance](https://modal.com/docs/guide/cold-start)
- [Scaling out](https://modal.com/docs/guide/scale)
- [GPU types comparison](https://modal.com/blog/gpu-types)

---

## 3. vLLM на Modal

### 3.1 Текущее состояние (2025-2026)

vLLM — основной рекомендуемый Modal способ для self-hosted LLM inference. Актуальные примеры:

- OpenAI-compatible server с Qwen
- Batch throughput optimization
- Ministral 3 serverless deployment

**Базовая архитектура:**

```python
@app.cls(gpu="A10G", volumes={"/models": model_volume})
class LLMEngine:
    @modal.enter()
    def start_engine(self):
        from vllm import LLM
        self.llm = LLM(model="Qwen/Qwen2.5-7B-Instruct", ...)

    @modal.method()
    def generate(self, prompts: list[str]) -> list[str]:
        outputs = self.llm.generate(prompts, ...)
        return [o.outputs[0].text for o in outputs]
```

### 3.2 Structured Output через vLLM

**Поддержка из коробки** через OpenAI-compatible API:

```python
response = client.chat.completions.create(
    model="Qwen/Qwen2.5-7B-Instruct",
    messages=[...],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "book_entities",
            "schema": {...}
        }
    }
)
```

**Методы:**

- `guided_json` — валидация через JSON Schema
- `guided_regex` — match regex паттерну
- `guided_choice` — выбор из предопределённых вариантов
- `guided_grammar` — context-free grammar

**Performance:** structured output в vLLM V1 — non-blocking, overhead минимальный. XGrammar backend немного быстрее Guidance благодаря кэшированию.

### 3.3 Batch Inference на GPU

**Offline batch processing:**

```python
@modal.method()
def batch_generate(self, prompts: list[str]) -> list[str]:
    # vLLM автоматически batch-ит prompts
    outputs = self.llm.generate(prompts, SamplingParams(max_tokens=2048))
    return [o.outputs[0].text for o in outputs]
```

**Throughput:** ~1250 tokens/sec для 60 параллельных промптов. vLLM даёт 4x больше tokens/sec чем raw Transformers на том же hardware.

### 3.4 Но для fancai — НЕ рекомендуется

Как установлено в `modal-gpu-migration-plan.md`:

- Gemini 3.0 Flash через API: **$3.00/M output tokens**
- Qwen 7B на A10G self-hosted: **$5.56/M output tokens** (дороже!)
- Gemini качественнее для extraction tasks
- vLLM имеет смысл только если нужна гарантия privacy или latency <100ms

**Источники:**

- [vLLM inference example](https://modal.com/docs/examples/vllm_inference)
- [vLLM throughput example](https://modal.com/docs/examples/vllm_throughput)
- [How to deploy vLLM](https://modal.com/blog/how-to-deploy-vllm)
- [Ministral3 inference](https://modal.com/docs/examples/ministral3_inference)
- [vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)
- [vLLM on Modal](https://docs.vllm.ai/en/stable/deployment/frameworks/modal/)

---

## 4. Гибридная архитектура: Modal GPU + Gemini API

### 4.1 Вызов Gemini API из Modal контейнера

**Да, это стандартный паттерн.** Modal контейнер — обычный Python environment с доступом в интернет. Любой HTTP-клиент или SDK работает.

```python
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "google-genai",  # Gemini SDK
    "httpx",
)

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("gemini-api-key")]  # GOOGLE_API_KEY
)
def extract_descriptions(chapter_text: str) -> dict:
    from google import genai
    client = genai.Client()  # reads GOOGLE_API_KEY from env
    response = client.models.generate_content(
        model="gemini-3.0-flash",
        contents=chapter_text,
        config={"response_mime_type": "application/json", ...}
    )
    return response.parsed
```

### 4.2 Latency: Modal → Google API

- Modal контейнеры обычно в US regions
- Google API endpoints — глобальные
- Ожидаемая latency: **50-200ms** network + **1-5 сек** inference time
- Для batch processing latency не критична

### 4.3 Pattern: GPU для Images + API для LLM

```
Celery Worker (VPS)
    ↓ Function.from_name().spawn()
Modal Orchestrator (CPU function)
    ├── Gemini API call (extraction) → JSON
    ├── FLUX GPU class (image gen) → bytes
    └── GLiNER2 GPU/CPU class (NER) → JSON
    ↓ return results
Celery Worker → PostgreSQL
```

**Преимущества:**

- LLM через API: не платишь за GPU idle, качество Gemini > self-hosted 7B
- Images на GPU: 53x дешевле чем OpenRouter FLUX
- NER на CPU/GPU: flexibility

---

## 5. Observability и мониторинг

### 5.1 Datadog Integration (официальная)

**Setup:** Modal tile на Datadog Integrations → Install → Connect Accounts.

**Что получаешь бесплатно:**

- Все логи приложения (stdout/stderr) → Datadog Logs
- Audit logs (container start/stop, function calls)
- Метрики Modal — бесплатны в Datadog (как official integration)

**Custom metadata:**

- Логи тегируются атрибутом `environment`
- Можно настроить Log Pipelines для парсинга structured logs

**Предупреждение:** все логи форвардятся в Datadog, что может быть дорого для verbose apps. Использовать Index Exclusion Filters.

### 5.2 Логирование стоимости

Modal Dashboard показывает:

- Стоимость per function
- GPU utilization per container
- Container count over time
- Input/output metrics

**Custom cost tracking в коде:**

```python
import time, logging

@modal.method()
def generate_image(self, prompt: str) -> bytes:
    start = time.time()
    result = self.pipe(prompt).images[0]
    duration = time.time() - start
    logging.info(f"image_gen duration={duration:.2f}s gpu=L4 cost=${duration * 0.000222:.6f}")
    return result
```

### 5.3 Prometheus метрики

Modal не экспортирует Prometheus endpoint напрямую. Варианты:

- Datadog integration (рекомендуется)
- Custom метрики через logging + Datadog Log Metrics
- Внешний Prometheus с pull через webhook endpoint

**Источники:**

- [Connecting Modal to Datadog](https://modal.com/docs/guide/datadog-integration)
- [Modal Datadog integration (Datadog docs)](https://docs.datadoghq.com/integrations/modal/)

---

## 6. Rate Limits

### 6.1 Modal

| Лимит            | Значение                   | Примечание                 |
| ---------------- | -------------------------- | -------------------------- |
| Operations/sec   | 200 RPS (burst 5x)         | Можно увеличить по запросу |
| Pending inputs   | 2,000 (map), 1M (spawn)    |                            |
| Total inputs     | 25,000                     | Running + pending          |
| Max containers   | Настраивается per function |                            |
| GPU availability | Зависит от типа и региона  | L4/T4 — обычно доступны    |

### 6.2 OpenRouter (Gemini Flash)

| Тип аккаунта       | RPM        | RPD        | Примечание            |
| ------------------ | ---------- | ---------- | --------------------- |
| Free (<10 credits) | 20         | 50         | Только :free модели   |
| Free (>10 credits) | 20         | 1000       |                       |
| Pay-as-you-go      | Без лимита | Без лимита | Provider limits apply |
| Enterprise         | Custom     | Custom     |                       |

**Важно:** OpenRouter Pay-as-you-go не имеет platform-level лимитов, но провайдер (Google) может ограничивать.

### 6.3 Gemini Direct API (платный tier)

| Tier   | RPM     | TPM     | RPD        | Как попасть           |
| ------ | ------- | ------- | ---------- | --------------------- |
| Free   | 5-15    | 250K-1M | 250-1500   | По умолчанию          |
| Tier 1 | 150-300 | ~2M     | Без лимита | Включить billing      |
| Tier 2 | 1000+   | ~4M     | Без лимита | $250 cumulative spend |
| Tier 3 | 4000+   | Custom  | Без лимита | Enterprise            |

**С декабря 2025:** Google урезал free quota на 50-92%. Paid tier обязателен.

### 6.4 Gemini Batch API

| Параметр                  | Значение                              |
| ------------------------- | ------------------------------------- |
| Max requests per batch    | 200,000                               |
| Max file size (GCS input) | 1 GB                                  |
| Скидка                    | **50%** от стандартной цены           |
| Время обработки           | Большинство за 24 часа                |
| Cache + Batch             | НЕ стакаются (cache 90% приоритетнее) |

**Для fancai (50 глав = 50 requests):** Batch API идеален. 50% скидка, batch size далеко от лимитов.

**С апреля 2026:** tier spend caps начнут enforce-иться.

**Источники:**

- [Modal scaling](https://modal.com/docs/guide/scale)
- [OpenRouter rate limits](https://openrouter.ai/docs/api/reference/limits)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3 Flash on OpenRouter](https://openrouter.ai/google/gemini-3-flash-preview)

---

## 7. Pricing Summary

### Modal GPU (per second)

| GPU     | $/sec     | $/hour | VRAM  |
| ------- | --------- | ------ | ----- |
| T4      | $0.000164 | $0.59  | 16 GB |
| L4      | $0.000222 | $0.80  | 24 GB |
| A10G    | $0.000306 | $1.10  | 24 GB |
| A100-40 | —         | ~$2.78 | 40 GB |
| H100    | —         | ~$4.41 | 80 GB |

### FLUX.2 Klein 4B на L4

- Inference: ~0.5-2 сек/image (4 steps, distilled)
- Стоимость: **~$0.0004/image** ($0.000222 \* 2 сек)
- vs OpenRouter FLUX.2 Klein: $0.016/image → **40x экономия**

**Источники:**

- [Modal pricing](https://modal.com/pricing)
- [NVIDIA A10G pricing](https://modal.com/blog/nvidia-a10g-price-article)
- [NVIDIA L4 pricing](https://modal.com/blog/nvidia-l4-price-article)
- [NVIDIA T4 pricing](https://modal.com/blog/nvidia-t4-price-article)

---

## 8. FLUX.2 Klein — Детали для deployment

### Характеристики модели

| Вариант              | Параметры | VRAM   | Шаги | Скорость                |
| -------------------- | --------- | ------ | ---- | ----------------------- |
| Klein 4B (distilled) | 4B        | ~13 GB | 4    | **<0.5 сек** на RTX GPU |
| Klein 4B (base)      | 4B        | ~13 GB | 50   | ~5-10 сек               |
| Klein 9B             | 8B+1B     | ~24 GB | 4    | ~1 сек                  |

- FP8/NVFP4 квантизация: -55% VRAM, +2.7x скорость
- **L4 (24 GB)** — идеален для Klein 4B с запасом
- T4 (16 GB) — тоже подходит для Klein 4B

**Источники:**

- [FLUX.2 official repo](https://github.com/black-forest-labs/flux2)
- [FLUX.2 Klein 4B on HuggingFace](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [FLUX.2 Klein blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)
- [FLUX on Modal](https://modal.com/docs/examples/flux)
- [Running FLUX.2 Klein on JarvisLabs](https://docs.jarvislabs.ai/tutorials/running-flux2-klein)

---

## 9. GLiNER2 — Детали для deployment

- **205M параметров** — лёгкая модель
- CPU-first design: работает без GPU
- GPU ускорение: fp16 + FlashDeberta + torch.compile
- Speedup на GPU: **10-13x** vs CPU
- Задачи: NER, Text Classification, Structured Data Extraction, Relation Extraction

**Для fancai:** GLiNER2 можно запускать на CPU в том же контейнере что и Gemini API calls (экономия на отдельном GPU контейнере). Или на T4 для максимальной скорости при batch processing.

**Источники:**

- [GLiNER2 paper](https://arxiv.org/html/2507.18546v1)
- [GLiNER2 GitHub (fastino)](https://github.com/fastino-ai/GLiNER2)
- [GLiNER GitHub](https://github.com/urchade/GLiNER)

---

## 10. Пример архитектуры Modal App

```python
"""
fancai Modal AI Pipeline
Input: список глав (text)
Step 1: LLM extraction (Gemini API) → structured JSON
Step 2: Image generation (FLUX.2 Klein 4B) → bytes
Step 3: NER (GLiNER2) → JSON
Output: результаты → VPS PostgreSQL через Celery
"""
import modal
import json

app = modal.App("fancai-pipeline")

# ============================================================
# Images (Docker environments)
# ============================================================

# CPU image для Gemini API calls
gemini_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("google-genai>=1.0", "httpx", "pydantic>=2.0")
)

# GPU image для FLUX.2 Klein
flux_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch>=2.4",
        "diffusers>=0.31",
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
        "huggingface_hub",
    )
)

# CPU/GPU image для GLiNER2
gliner_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("gliner>=1.0", "torch>=2.4")
)

# Volume для кэширования весов моделей
model_volume = modal.Volume.from_name("fancai-model-cache", create_if_missing=True)

# ============================================================
# Step 1: LLM Extraction (Gemini API — CPU only)
# ============================================================

@app.function(
    image=gemini_image,
    secrets=[modal.Secret.from_name("gemini-api-key")],
    retries=modal.Retries(max_retries=3, backoff_coefficient=2.0),
    timeout=120,
)
def extract_chapter(chapter_text: str, chapter_number: int) -> dict:
    """Извлекает описания и сущности из одной главы через Gemini API."""
    from google import genai

    client = genai.Client()  # reads GOOGLE_API_KEY from env

    # Extraction prompt (simplified)
    prompt = f"""Analyze chapter {chapter_number}. Extract:
    1. Visual descriptions (scenes, characters, settings)
    2. Named entities (characters, locations, objects)
    Return as JSON with keys: descriptions, entities"""

    response = client.models.generate_content(
        model="gemini-3.0-flash",
        contents=f"{prompt}\n\n{chapter_text}",
        config={
            "response_mime_type": "application/json",
            "temperature": 0.1,
        }
    )

    return {
        "chapter_number": chapter_number,
        "extraction": json.loads(response.text),
    }


# ============================================================
# Step 2: Image Generation (FLUX.2 Klein — GPU L4)
# ============================================================

@app.cls(
    image=flux_image,
    gpu="L4",
    volumes={"/models": model_volume},
    scaledown_window=120,  # 2 мин idle до выключения
    experimental_options={"enable_gpu_snapshot": True},
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        import torch
        from diffusers import FluxPipeline

        self.pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.2-klein-4B",
            torch_dtype=torch.float16,
            cache_dir="/models/flux",
        ).to("cuda")

    @modal.batched(max_batch_size=4, wait_ms=500)
    def generate(self, prompts: list[str]) -> list[bytes]:
        """Генерирует batch изображений."""
        import io
        from PIL import Image

        results = []
        images = self.pipe(
            prompts,
            num_inference_steps=4,
            height=768,
            width=768,
        ).images

        for img in images:
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=85)
            results.append(buf.getvalue())

        return results


# ============================================================
# Step 3: NER (GLiNER2 — CPU or T4)
# ============================================================

@app.cls(
    image=gliner_image,
    # gpu="T4",  # раскомментировать для GPU ускорения
    scaledown_window=60,
)
class NERExtractor:
    @modal.enter()
    def load_model(self):
        from gliner import GLiNER
        self.model = GLiNER.from_pretrained("fastino/gliner2-base-v1")
        # self.model.to("cuda")  # если GPU

    @modal.batched(max_batch_size=8, wait_ms=300)
    def extract_entities(self, texts: list[str]) -> list[list[dict]]:
        """Batch NER extraction."""
        labels = ["person", "location", "organization", "object", "creature"]
        results = []
        for text in texts:
            entities = self.model.predict_entities(text, labels, threshold=0.5)
            results.append([
                {"text": e["text"], "label": e["label"], "score": e["score"]}
                for e in entities
            ])
        return results


# ============================================================
# Orchestrator: полный pipeline для книги
# ============================================================

@app.function(
    image=gemini_image,
    secrets=[modal.Secret.from_name("gemini-api-key")],
    timeout=3600,  # 1 час на книгу
)
def process_book(book_id: int, chapters: list[dict]) -> dict:
    """
    Полный pipeline обработки книги.
    chapters: [{"number": 1, "text": "..."}, ...]
    """

    # --- Step 1: Parallel LLM extraction через Gemini API ---
    extraction_inputs = [(ch["text"], ch["number"]) for ch in chapters]
    extractions = list(
        extract_chapter.starmap(extraction_inputs, return_exceptions=True)
    )

    # Обработка partial failures
    successful_extractions = {}
    failed_chapters = []
    for ch, result in zip(chapters, extractions):
        if isinstance(result, Exception):
            failed_chapters.append({"chapter": ch["number"], "error": str(result)})
        else:
            successful_extractions[ch["number"]] = result

    # --- Step 2: Image generation для описаний ---
    image_gen = ImageGenerator()
    descriptions_to_render = []
    for ch_num, ext in successful_extractions.items():
        for desc in ext["extraction"].get("descriptions", []):
            descriptions_to_render.append({
                "chapter": ch_num,
                "prompt": desc.get("visual_prompt", ""),
                "desc_id": desc.get("id"),
            })

    # Batch image generation
    prompts = [d["prompt"] for d in descriptions_to_render]
    if prompts:
        generated_images = list(
            image_gen.generate.map(prompts, return_exceptions=True)
        )
    else:
        generated_images = []

    # --- Step 3: NER extraction ---
    ner = NERExtractor()
    chapter_texts = [ch["text"] for ch in chapters]
    ner_results = list(
        ner.extract_entities.map(chapter_texts, return_exceptions=True)
    )

    # --- Собираем результат ---
    return {
        "book_id": book_id,
        "extractions": successful_extractions,
        "images": [
            {
                "desc": descriptions_to_render[i],
                "image_bytes": img if not isinstance(img, Exception) else None,
                "error": str(img) if isinstance(img, Exception) else None,
            }
            for i, img in enumerate(generated_images)
        ],
        "ner": [
            {
                "chapter": chapters[i]["number"],
                "entities": res if not isinstance(res, Exception) else [],
                "error": str(res) if isinstance(res, Exception) else None,
            }
            for i, res in enumerate(ner_results)
        ],
        "failed_chapters": failed_chapters,
    }


# ============================================================
# Вызов из Celery Worker на VPS
# ============================================================
#
# from celery import shared_task
# import modal
#
# @shared_task(bind=True)
# def process_book_task(self, book_id: int, chapters: list[dict]):
#     """Celery task: запускает Modal pipeline и сохраняет результат."""
#     process_book_fn = modal.Function.from_name(
#         "fancai-pipeline", "process_book"
#     )
#
#     # Синхронный вызов (блокирует worker)
#     result = process_book_fn.remote(book_id=book_id, chapters=chapters)
#
#     # Или async: call = process_book_fn.spawn(book_id=book_id, chapters=chapters)
#     #            result = call.get(timeout=3600)
#
#     # Сохраняем в PostgreSQL
#     save_extractions(book_id, result["extractions"])
#     save_images(book_id, result["images"])
#     save_entities(book_id, result["ner"])
#
#     return {"status": "ok", "failed": result["failed_chapters"]}
```

### Архитектурная диаграмма

```
┌─────────────────────────────────────────────────────────────┐
│                        VPS (fancai.ru)                       │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌────────────────────┐     │
│  │ FastAPI   │───▶│ Celery   │───▶│ PostgreSQL         │     │
│  │ (trigger) │    │ Worker   │    │ (results storage)  │     │
│  └──────────┘    └────┬─────┘    └────────────────────┘     │
│                       │ modal.Function.from_name()          │
└───────────────────────┼─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Modal Cloud                               │
│                                                             │
│  ┌─────────────────────────────────────────────────┐        │
│  │ process_book() — CPU orchestrator               │        │
│  │                                                 │        │
│  │  ┌──────────────┐  ┌──────────────┐             │        │
│  │  │ extract_      │  │ extract_     │ ... x 50   │        │
│  │  │ chapter(1)    │  │ chapter(2)   │ parallel    │        │
│  │  │ → Gemini API  │  │ → Gemini API │             │        │
│  │  └──────────────┘  └──────────────┘             │        │
│  │         │                                       │        │
│  │         ▼                                       │        │
│  │  ┌──────────────────────┐                       │        │
│  │  │ ImageGenerator (L4)  │  @modal.batched(4)    │        │
│  │  │ FLUX.2 Klein 4B      │  GPU snapshot enabled │        │
│  │  └──────────────────────┘                       │        │
│  │         │                                       │        │
│  │         ▼                                       │        │
│  │  ┌──────────────────────┐                       │        │
│  │  │ NERExtractor (CPU)   │  @modal.batched(8)    │        │
│  │  │ GLiNER2 205M         │                       │        │
│  │  └──────────────────────┘                       │        │
│  │         │                                       │        │
│  │         ▼ return results                        │        │
│  └─────────────────────────────────────────────────┘        │
│                                                             │
│  ┌─────────────┐                                            │
│  │ Volume:      │  Cached model weights                     │
│  │ model-cache  │  (FLUX, GLiNER2)                          │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### Ожидаемая стоимость обработки книги (50 глав, ~250K слов)

| Компонент        | Метод                                 | Стоимость          | Время                |
| ---------------- | ------------------------------------- | ------------------ | -------------------- |
| LLM Extraction   | Gemini 3.0 Flash (Batch API, 50% off) | ~$0.96             | ~5-10 мин (parallel) |
| Image Generation | FLUX.2 Klein 4B на L4                 | ~$0.02 (60 images) | ~2-3 мин             |
| NER              | GLiNER2 на CPU                        | ~$0.01             | ~1-2 мин             |
| Modal overhead   | Orchestrator CPU                      | ~$0.005            | —                    |
| **ИТОГО**        |                                       | **~$0.99**         | **~10-15 мин**       |

vs текущая стоимость: **$2.90** → экономия **66%**

---

## 11. Ключевые рекомендации

1. **Gemini API для LLM** — не self-host. Дешевле и качественнее.
2. **Gemini Batch API** — 50% скидка для background book processing.
3. **FLUX.2 Klein 4B на L4** — 40-53x дешевле OpenRouter.
4. **GLiNER2 на CPU** — достаточно быстро для async, экономит на GPU.
5. **GPU Memory Snapshots** — обязательно для FLUX (cold start 3 сек vs 20 сек).
6. **Dynamic batching** — для FLUX и GLiNER2 inference.
7. **return_exceptions=True** — обязательно для partial failure handling.
8. **Function.from_name()** — интеграция с Celery worker на VPS.
9. **Не открывать PostgreSQL наружу** — результаты через return values.
10. **scaledown_window=120** — для batch workloads вместо min_containers.
