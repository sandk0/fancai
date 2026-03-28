# Modal GPU Migration Plan — fancai AI Pipeline

**Дата:** 2026-03-24
**Scope:** Миграция AI pipeline на Modal serverless GPU + оптимизация стоимости
**Методология:** 4 параллельных исследовательских агента с WebSearch, анализ кода (6 файлов), production data analysis

---

## A. Executive Summary

**Главный вывод: LLM extraction — главный bottleneck по стоимости (66%). Images на Modal — 53x дешевле.**

### Реальные данные: "Перекрёстки сумерек" (Роберт Джордан)

Верифицировано через production DB `llm_usage_log` + OpenRouter `GET /api/v1/generation` API:

| Компонент                  | Calls | Tokens | Стоимость | % от total |
| -------------------------- | ----- | ------ | --------- | ---------- |
| **LLM** (Gemini 3.0 Flash) | 121   | 1.13M  | **$1.91** | **66%**    |
| **Images** (FLUX.2 Klein)  | 62    | N/A    | **$0.99** | **34%**    |
| **ИТОГО**                  | 183   | —      | **$2.90** | 100%       |

Книга: 50 глав, 253K слов, 381 описание, 198 сущностей. Обработка: 59 мин.

**Реальная цена image = $0.016/шт** (не $0.03 как предполагалось). Images — 34% стоимости, а LLM extraction — 66% и является основным драйвером затрат для крупных книг.

**Рекомендуемый сценарий (D+ — Оптимальный гибрид):**

- **Images → Modal L4** (FLUX.2 Klein 4B self-hosted): $0.019/книга вместо $0.99 (**53x дешевле**)
- **LLM → Gemini Batch API** (50% скидка для background processing): $0.96 вместо $1.91
- **NER → CPU** (приемлемо) или Modal T4 (для CPU offload)
- **Стоимость: ~$0.98/книга** (экономия **66%** от $2.90)
- **Modal расход: ~$1/мес** при 50 книгах — free tier ($30) покрывает до ~1500 книг/мес

Self-hosted LLM на Modal **не рекомендуется**: Gemini 3.0 Flash ($3.00/M output tokens) дешевле и качественнее Qwen 7B на A10G ($5.56/M). GLiNER2 NER на GPU — speedup 10-13x, но для async background processing не критично; имеет смысл для CPU offload.

**Рекомендуемый сценарий (D — Оптимальный гибрид):**

- **Images → Modal L4** (FLUX.2 Klein 4B self-hosted): $0.020/книга вместо $1.50
- **LLM → Gemini Direct API** (без наценки OpenRouter 5.5%): $0.165-0.50/книга
- **NER → CPU** (приемлемо для async) или Modal T4 (для CPU offload)
- **Стоимость: $0.29-0.62/книга** (экономия **71-84%**)
- **Modal расход: ~$1/мес** при 50 книгах — free tier ($30) покрывает до ~1500 книг/мес

---

## B. Modal Platform Analysis

### B.1 Pricing (актуально на март 2026)

Биллинг **посекундный**, без минимального периода.

| GPU       | VRAM  | $/сек     | $/час     | $30 free tier = часов |
| --------- | ----- | --------- | --------- | --------------------- |
| **T4**    | 16 GB | $0.000164 | **$0.59** | 50.8 ч                |
| **L4**    | 24 GB | $0.000222 | **$0.80** | 37.5 ч                |
| **A10G**  | 24 GB | $0.000306 | **$1.10** | 27.2 ч                |
| L40S      | 48 GB | $0.000542 | $1.95     | 15.4 ч                |
| A100 40GB | 40 GB | $0.000583 | $2.10     | 14.3 ч                |
| H100      | 80 GB | $0.001097 | $3.95     | 7.6 ч                 |

CPU: $0.047/core/час. Memory: $0.008/GiB/час.

### B.2 Free Tier

**Starter Plan** — $0/мес platform fee + **$30/мес compute credits**:

- GPU + CPU + Memory + Storage — единый пул
- Max 100 containers, 10 concurrent GPUs
- EU region доступен
- Startup credits: заявка на до $50K бесплатных кредитов

### B.3 Cold Start и GPU Memory Snapshots

| Workload                  | Без snapshot | С GPU snapshot | Ускорение |
| ------------------------- | ------------ | -------------- | --------- |
| Стандартный GPU контейнер | 2-4 сек      | <1 сек         | 3-5x      |
| ViT inference             | 8.5 сек      | 2.25 сек       | 3.8x      |
| vLLM Qwen 0.5B            | 45 сек       | 5 сек          | 9x        |
| Audio (Parakeet)          | 20 сек       | 2 сек          | 10x       |

GPU Memory Snapshots — checkpoint/restore через CUDA API (драйверы 570+):

```python
@app.function(
    gpu="T4",
    experimental_options={"enable_gpu_snapshot": True}
)
```

### B.4 Ключевые features

| Feature        | Детали                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| **Volumes**    | $0.10/GB/мес, >1 GB/s read, оптимален для model weights                |
| **Secrets**    | `modal.Secret.from_name("key")` → env vars в контейнер                 |
| **Networking** | Полный outbound access, VPS PostgreSQL доступен по TLS                 |
| **EU Region**  | `region="eu"` на всех планах, GDPR-совместимо                          |
| **SDK**        | Python-native: `@app.function()`, `@app.cls()`, `modal.Image`          |
| **Compliance** | SOC 2 Type II (январь 2025), TLS 1.3, gVisor sandboxing                |
| **Scaling**    | scale-to-zero (default), `min_containers`, `scaledown_window` 2с-20мин |

### B.5 Celery Integration Pattern

```python
# backend/app/tasks/inference.py (на VPS)
import modal

@celery_app.task(bind=True, max_retries=3)
def generate_images_task(self, descriptions: list):
    try:
        gen_fn = modal.Function.from_name("fancai-gpu", "generate_batch")
        results = gen_fn.remote(descriptions)  # синхронный вызов Modal
        return results
    except modal.exception.FunctionTimeoutError:
        raise self.retry(countdown=60)
```

Требования: `pip install modal` на VPS, `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` env vars.

---

## C. Migration Architecture

### Текущая архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     VPS (32GB, 12 vCPU)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ FastAPI   │  │ Celery Worker│  │ PostgreSQL + Redis│  │
│  │ (2 CPU)  │  │ (4 CPU, 4GB) │  │ (4 CPU, 12GB)    │  │
│  └─────┬────┘  └──────┬───────┘  └───────────────────┘  │
│        │              │                                  │
│        │         ┌────┴─────┐                            │
│        │         │ GLiNER2  │  ← CPU inference (38s/ch) │
│        │         │ (800MB)  │                            │
│        │         └──────────┘                            │
└────────┼────────────────────────────────────────────────┘
         │
    ┌────┴──────────────────────┐
    │     OpenRouter API        │
    │  Gemini Flash (LLM)       │  ← $0.50-1.50/книга
    │  FLUX.2 Klein (Images)    │  ← $1.50/книга (50 img)
    └───────────────────────────┘
```

### Целевая архитектура (Сценарий D)

```
┌─────────────────────────────────────────────────────────┐
│                     VPS (32GB, 12 vCPU)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ FastAPI   │  │ Celery Worker│  │ PostgreSQL + Redis│  │
│  │ (2 CPU)  │  │ (4 CPU, 4GB) │  │ (4 CPU, 12GB)    │  │
│  └─────┬────┘  └──────┬───────┘  └───────────────────┘  │
│        │              │                                  │
│        │         ┌────┴─────┐                            │
│        │         │ GLiNER2  │  ← CPU inference (опция)  │
│        │         │ (800MB)  │     или Modal T4           │
│        │         └──────────┘                            │
└────────┼────────────────────────────────────────────────┘
         │
    ┌────┴──────────┐    ┌──────────────────────────────┐
    │ Google Gemini  │    │       Modal (serverless GPU)  │
    │ Direct API     │    │                               │
    │ (extraction,   │    │  ┌─────────────────────────┐  │
    │  synthesis,    │    │  │ L4 GPU: FLUX.2 Klein 4B │  │
    │  dedup,        │    │  │ $0.0003/image           │  │
    │  translation)  │    │  │ scale-to-zero           │  │
    │                │    │  └─────────────────────────┘  │
    │ $0.165-0.50    │    │                               │
    │ /книга         │    │  ┌─────────────────────────┐  │
    │ (-5.5% vs OR)  │    │  │ T4 GPU: GLiNER2 (опц.) │  │
    └────────────────┘    │  │ $0.01/книга             │  │
                          │  └─────────────────────────┘  │
    ┌────────────────┐    │                               │
    │ OpenRouter     │    │  EU region, $30/мес free tier │
    │ (FALLBACK)     │    └──────────────────────────────┘
    └────────────────┘
```

---

## D. Component-by-Component Analysis

### D.1 Image Generation (главный драйвер экономии)

| Параметр        | OpenRouter (текущее) | Modal L4 (рекомендуемое)     |
| --------------- | -------------------- | ---------------------------- |
| Модель          | FLUX.2 Klein 4B      | FLUX.2 Klein 4B (та же)      |
| Стоимость/image | **$0.03**            | **$0.0003**                  |
| Время/image     | <1 сек               | ~1.5 сек                     |
| Cold start      | 0                    | ~15 сек (с snapshot: ~3 сек) |
| Батч 50 images  | $1.50                | $0.020 (вкл. cold start)     |
| Fallback        | N/A                  | OpenRouter                   |
| Качество        | FLUX.2 Klein         | FLUX.2 Klein (идентичное)    |

**Расчёт для 50 images на Modal L4:**

- Cold start: ~15 сек × $0.000222 = $0.003
- Inference: 50 × 1.5 сек = 75 сек × $0.000222 = $0.017
- **Итого: $0.020** (vs $1.50 OpenRouter = **75x дешевле**)

**Вердикт: МИГРИРОВАТЬ.** Окупается с первого батча. Качество идентичное (та же модель).

### D.2 LLM Extraction (Gemini Flash)

| Параметр            | OpenRouter (текущее) | Self-hosted Qwen 7B (Modal A10G) | Gemini Direct API |
| ------------------- | -------------------- | -------------------------------- | ----------------- |
| Стоимость/M input   | $0.50                | ~$0.17                           | $0.50             |
| Стоимость/M output  | $3.00                | ~$5.56                           | $3.00             |
| Markup              | 5.5% platform fee    | 0%                               | **0%**            |
| Качество extraction | Отличное             | Среднее (7B)                     | Отличное          |
| Context window      | 1M tokens            | 32K tokens                       | 1M tokens         |
| Cold start          | 0                    | ~20 сек                          | 0                 |
| Latency             | <1 сек               | 2-5 сек                          | <1 сек            |
| Structured output   | Native               | JSON mode                        | Native            |

**Вердикт: оставить на Gemini API.** Self-hosted LLM дороже на output tokens и хуже по качеству. Переключить с OpenRouter на Gemini Direct API для экономии 5.5%.

### D.3 NER (GLiNER2)

| Параметр                | CPU (текущее)             | Modal T4 GPU         |
| ----------------------- | ------------------------- | -------------------- |
| Время/chunk             | 0.66 сек (оптимизировано) | ~0.05-0.10 сек       |
| Время/глава (20 chunks) | ~13.4 сек                 | ~1.5 сек             |
| Время/книга (35 глав)   | ~7.8 мин                  | ~53 сек + cold start |
| Стоимость/книга         | **$0**                    | **$0.011**           |
| VPS CPU нагрузка        | 4 vCPU (33% сервера)      | 0%                   |
| Speedup                 | 1x                        | 10-13x               |

**Вердикт: ОПЦИОНАЛЬНО.** NER на GPU — скорость × 10 и разгрузка VPS, но добавляет $0.01/книга. Имеет смысл при:

- CPU бюджет исчерпан (11.3/12 vCPU — уже на пределе)
- Premium SLA <5 мин (GPU NER + LLM + Modal images = ~2 мин/книга)
- Рост до 500+ книг/мес

### D.4 Entity Synthesis, Deduplication, Translation

| Компонент   | Текущая стоимость | Рекомендация              |
| ----------- | ----------------- | ------------------------- |
| Synthesis   | $0.05/книга       | Gemini Direct API (-5.5%) |
| Dedup       | $0.01/книга       | Gemini Direct API (-5.5%) |
| Translation | $0.05/книга       | Gemini Direct API (-5.5%) |
| **Итого**   | $0.11/книга       | $0.104/книга              |

**Вердикт: мигрировать на Gemini Direct API.** Экономия маленькая ($0.006/книга), но нулевая сложность — замена API key.

### D.5 Альтернативные image gen модели

| Модель              | GPU       | $/image     | Качество vs FLUX.2 Klein | Рекомендация             |
| ------------------- | --------- | ----------- | ------------------------ | ------------------------ |
| **FLUX.2 Klein 4B** | **L4**    | **$0.0003** | Baseline                 | **Рекомендуемое**        |
| FLUX.1 Schnell 12B  | L40S/H100 | $0.0011     | Выше                     | Overkill для $50 бюджета |
| SDXL Turbo          | T4        | $0.0004     | Значительно ниже         | Не рекомендуется         |
| SD 3.5 Large Turbo  | A10G      | $0.0005     | Ниже FLUX.2              | Не рекомендуется         |

FLUX.2 Klein 4B на L4 — оптимальный баланс цена/качество. Та же модель, что уже в production.

---

## E. Cost Comparison Table

### E.1 Стоимость за 1 книгу (35 глав, 50 описаний, 200 сущностей)

| Компонент      | Текущее (OpenRouter) | A: NER Modal   | B: Images Modal     | D: Оптимальный гибрид |
| -------------- | -------------------- | -------------- | ------------------- | --------------------- |
| LLM Extraction | $0.175-0.525         | $0.175-0.525   | $0.175-0.525        | $0.165-0.496          |
| Images (50 шт) | **$1.500**           | $1.500         | **$0.020**          | **$0.020**            |
| Synthesis      | $0.050               | $0.050         | $0.050              | $0.047                |
| Dedup          | $0.010               | $0.010         | $0.010              | $0.009                |
| Translation    | $0.050               | $0.050         | $0.050              | $0.047                |
| NER (GPU)      | $0 (CPU)             | $0.011         | $0 (CPU)            | $0 (CPU)              |
| **ИТОГО**      | **$1.79-2.14**       | **$1.80-2.15** | **$0.31-0.66**      | **$0.29-0.62**        |
| Экономия       | —                    | +$0.01         | **-$1.48 (69-82%)** | **-$1.52 (71-84%)**   |

### E.2 Месячные затраты по масштабам

#### Сценарий B: Images на Modal + LLM на OpenRouter

| Масштаб       | AI стоимость | Modal GPU  | Итого        | Экономия vs текущее |
| ------------- | ------------ | ---------- | ------------ | ------------------- |
| 50 книг/мес   | $15-33       | **$1.00**  | **$16-34**   | -$73 (-78%)         |
| 200 книг/мес  | $62-132      | **$4.00**  | **$66-136**  | -$292 (-69%)        |
| 500 книг/мес  | $155-330     | **$10.00** | **$165-340** | -$730 (-68%)        |
| 1000 книг/мес | $310-660     | **$20.00** | **$330-680** | -$1460 (-68%)       |

Modal расход: все масштабы покрыты free tier $30/мес (фактический расход $1-20).

#### Сценарий D: Оптимальный гибрид (рекомендуемый)

| Масштаб       | AI стоимость | Modal GPU  | Итого        | Экономия vs текущее |
| ------------- | ------------ | ---------- | ------------ | ------------------- |
| 50 книг/мес   | $14-31       | **$1.00**  | **$15-32**   | -$74-75 (-82%)      |
| 200 книг/мес  | $58-124      | **$4.00**  | **$62-128**  | -$296-300 (-70%)    |
| 500 книг/мес  | $145-310     | **$10.00** | **$155-320** | -$740-750 (-69%)    |
| 1000 книг/мес | $290-620     | **$20.00** | **$310-640** | -$1480-1500 (-69%)  |

#### Сравнительная таблица (все сценарии × 50 книг/мес)

| Сценарий            | $/книга    | $/мес (50 кн) | Modal | Сложность    | Рекомендация            |
| ------------------- | ---------- | ------------- | ----- | ------------ | ----------------------- |
| **Текущее**         | $1.79-2.14 | $89-107       | $0    | —            | —                       |
| **A: NER Modal**    | $1.80-2.15 | $90-108       | $0.50 | 2-3 дня      | Для CPU offload         |
| **B: Images Modal** | $0.31-0.66 | $16-34        | $1.00 | **3-5 дней** | **Рекомендуемый start** |
| C: All Modal        | $0.38-0.78 | $19-39        | $5    | 2-3 недели   | НЕ рекомендуется        |
| **D: Optimal**      | $0.29-0.62 | $15-32        | $1.00 | **4-6 дней** | **Лучший ROI**          |

### E.3 Реальные данные: "Перекрёстки сумерек" (50 глав, 381 описание)

| Компонент       | Текущее (реальное) | Modal Images      | Modal + Gemini Batch | Modal + Batch + NER |
| --------------- | ------------------ | ----------------- | -------------------- | ------------------- |
| LLM (121 calls) | **$1.91**          | $1.91             | **$0.96** (-50%)     | $0.96               |
| Images (62 шт)  | **$0.99**          | **$0.019** (-98%) | $0.019               | $0.019              |
| NER             | $0 (CPU)           | $0 (CPU)          | $0 (CPU)             | $0.015 (Modal T4)   |
| **ИТОГО**       | **$2.90**          | **$1.93** (-33%)  | **$0.98** (-66%)     | **$0.99** (-66%)    |

### E.4 Время обработки книги (wall clock)

| Этап                                 | Текущее (реальное)    | С Modal (Сценарий D+)                             |
| ------------------------------------ | --------------------- | ------------------------------------------------- |
| LLM extraction (50 ch, ×10 parallel) | ~59 мин (включая всё) | ~35-40 мин (Gemini Direct)                        |
| Images (62 шт, batch ×5, 2s delay)   | ~8 мин (параллельно)  | **~1.5 мин** (Modal L4 warm)                      |
| NER (если включён)                   | ~11 мин (CPU)         | ~1.5 мин (Modal T4)                               |
| **TOTAL**                            | **~59 мин**           | **~35-40 мин** (CPU NER) / **~5 мин** (Modal NER) |

---

## F. Recommended Migration Plan

### Phase 1: Image Generation → Modal (Дни 1-3)

**Приоритет: P0. ROI: максимальный. Риск: минимальный.**

1. Создать Modal app: `backend/modal_app/image_gen.py`
   - `@app.cls(gpu="L4", image=flux_image, volumes={"/models": vol})`
   - `@modal.enter()` — загрузка FLUX.2 Klein 4B в GPU memory
   - `@modal.method()` — generate batch (список промптов → список bytes)
2. Кэшировать модель в `modal.Volume("fancai-models")`
3. Feature flag: `USE_MODAL_IMAGES=false` в `.env`
4. Celery task `generate_image_task` → проверка flag → `modal.Function.from_name().remote()` или OpenRouter
5. Deploy: `modal deploy backend/modal_app/image_gen.py`
6. A/B тест: сравнить quality Modal vs OpenRouter (visual inspection)
7. Включить: `USE_MODAL_IMAGES=true`
8. OpenRouter остаётся как fallback при Modal timeout

**Ключевые файлы для изменения:**

- `backend/app/services/imagen_generator.py` — добавить Modal path
- `backend/app/tasks/image_tasks.py` — feature flag routing
- `backend/app/core/config.py` — `USE_MODAL_IMAGES` setting
- NEW: `backend/modal_app/image_gen.py` — Modal app

**Экономия: $1.48/книга (75x на images), ~$74/мес при 50 книгах.**

### Phase 2: Gemini Direct API (Дни 3-4)

**Приоритет: P1. ROI: средний (5.5%). Риск: минимальный.**

1. Получить Google API key на [ai.google.dev](https://ai.google.dev)
2. Установить `google-genai` SDK (уже в requirements?)
3. Добавить `GOOGLE_API_KEY` в production env
4. Заменить OpenRouter LLM calls на Gemini Direct:
   - Или: dual mode с feature flag `USE_GEMINI_DIRECT=false`
   - Или: сохранить OpenRouter как fallback chain
5. Тестировать structured output compatibility

**Экономия: 5.5% от LLM costs ($0.01-0.03/книга).**

### Phase 3: NER на Modal (Опционально, Дни 5-7)

**Приоритет: P2. ROI: CPU offload + speedup. Риск: низкий.**

1. Modal app: `backend/modal_app/ner.py`
   - GLiNER2 на T4 GPU
   - `@modal.enter()` — загрузка модели + warmup inference
   - GPU memory snapshot для <2 сек cold start
2. Feature flag: `USE_MODAL_NER=false`
3. A/B тест recall vs CPU baseline (86.84%)
4. Dual-write период: оба результата → сравнение

**Когда мигрировать:**

- CPU бюджет исчерпан (уже 11.3/12 vCPU)
- Premium SLA <5 мин нужен
- Рост >200 книг/мес

---

## G. Implementation Checklist

### Подготовка (у пользователя есть аккаунт Modal)

- [ ] `pip install modal` на VPS (в Celery worker image)
- [ ] `modal token new` — создать токен
- [ ] Добавить `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` в production env
- [ ] Создать `modal.Secret("openrouter-key")` в Modal dashboard (fallback)
- [ ] Создать `modal.Volume("fancai-models")` для кэша весов

### Phase 1: Image Generation

- [ ] Создать `backend/modal_app/__init__.py`
- [ ] Создать `backend/modal_app/image_gen.py`:

```python
import modal

app = modal.App("fancai-gpu")

flux_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch", "diffusers", "transformers", "accelerate", "safetensors")
)

vol = modal.Volume.from_name("fancai-models", create_if_missing=True)

@app.cls(
    image=flux_image,
    gpu="L4",
    volumes={"/models": vol},
    scaledown_window=120,  # 2 мин idle для burst
    timeout=300,
    region="eu",
)
class FluxGenerator:
    @modal.enter()
    def setup(self):
        import torch
        from diffusers import FluxPipeline

        model_id = "black-forest-labs/FLUX.2-klein-4b"
        self.pipe = FluxPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16,
            cache_dir="/models",
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str, width: int = 1024, height: int = 768) -> bytes:
        import io
        image = self.pipe(
            prompt,
            width=width,
            height=height,
            num_inference_steps=4,  # Klein distilled = 4 steps
            guidance_scale=0.0,
        ).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    @modal.method()
    def generate_batch(self, prompts: list[str], width: int = 1024, height: int = 768) -> list[bytes]:
        return [self.generate(p, width, height) for p in prompts]
```

- [ ] `modal deploy backend/modal_app/image_gen.py`
- [ ] Добавить `USE_MODAL_IMAGES` в `config.py`
- [ ] Модифицировать `imagen_generator.py` — Modal path
- [ ] Тест: `modal run backend/modal_app/image_gen.py`
- [ ] A/B quality check
- [ ] Включить в production

### Phase 2: Gemini Direct

- [ ] Получить Google API key
- [ ] Добавить `GOOGLE_API_KEY` env var
- [ ] Опционально: заменить OpenRouter calls для LLM
- [ ] Или: сохранить OpenRouter с Gemini Direct как primary

### Мониторинг

- [ ] Настроить workspace budget limit ($30) в Modal UI
- [ ] Добавить Prometheus метрику `modal_inference_duration_seconds`
- [ ] Логировать Modal costs в `LlmUsageLog` таблицу
- [ ] Feature flag dashboard: `USE_MODAL_IMAGES`, `USE_MODAL_NER`

---

## H. Risks and Mitigations

| #   | Риск                                             | Вероятность  | Импакт          | Митигация                                                                                    |
| --- | ------------------------------------------------ | ------------ | --------------- | -------------------------------------------------------------------------------------------- |
| R1  | Modal cold start >5 сек                          | Средняя      | Средний         | GPU memory snapshots (→ ~2-3 сек). `scaledown_window=120` для burst.                         |
| R2  | Modal outage / недоступность                     | Низкая       | Высокий         | Feature flag → мгновенный fallback на OpenRouter. OpenRouter API key сохраняется.            |
| R3  | Превышение $30 free tier                         | Низкая       | Низкий          | Workspace budget limit. При 50 книг/мес расход ~$1. Запас 30x.                               |
| R4  | FLUX.2 Klein качество на Modal отличается        | Очень низкая | Средний         | Та же модель, те же weights. A/B тест перед включением.                                      |
| R5  | Modal убирает free tier                          | Низкая       | Средний         | Расход ~$1-20/мес — легко переносится на paid plan. Fallback: Replicate FLUX ($0.003/img).   |
| R6  | Vendor lock-in (Modal SDK)                       | Средняя      | Низкий          | Бизнес-логика (inference) отдельно от SDK-обёртки (~50 строк). Миграция на RunPod: 1-2 дня.  |
| R7  | Network latency VPS↔Modal                        | Низкая       | Низкий          | `region="eu"` — latency 1-5 мс. Для async tasks не критично.                                 |
| R8  | FLUX.2 Klein weights недоступны на HuggingFace   | Очень низкая | Высокий         | Кэш в `modal.Volume`. Альтернатива: FLUX.1 Schnell (open weights).                           |
| R9  | `worker_max_memory_per_child=512MB` убьёт worker | **Высокая**  | **Критический** | **Исправить немедленно**: увеличить до 3GB или убрать. Не связано с Modal, но блокирует NER. |
| R10 | Copyrighted content через Modal                  | Низкая       | Низкий          | Modal — IaaS провайдер. Текст обрабатывается in-memory, не хранится. gVisor изоляция.        |

---

## I. Конкурентный анализ: Modal vs Альтернативы

| Платформа     | GPU Pricing (T4/ч) | Free Tier          | Cold Start | DX             | Lock-in       | Подходит?              |
| ------------- | ------------------ | ------------------ | ---------- | -------------- | ------------- | ---------------------- |
| **Modal**     | $0.59              | **$30/мес**        | 2-4 сек    | **Отличный**   | Высокий (SDK) | **ДА — лучший**        |
| RunPod        | ~$0.80-1.20        | Нет                | 1-2 сек    | Средний        | Средний       | Нет (нет free tier)    |
| Beam          | ~$1.35+            | 10ч одноразово     | 2-3 сек    | Хороший        | Средний       | Нет                    |
| Replicate     | $0.003/img (FLUX)  | Нет                | 5-30 сек   | Отличный (API) | Низкий        | Частично (только FLUX) |
| Cloud Run GPU | $0.67 (L4)         | Нет для GPU        | Средний    | Средний        | Средний       | Нет                    |
| AWS SageMaker | N/A                | Нет GPU serverless | N/A        | Низкий         | Высокий       | **НЕТ**                |
| Banana        | N/A                | N/A                | N/A        | N/A            | N/A           | ЗАКРЫТ (март 2024)     |

**Вывод:** Modal — единственная платформа с $30/мес free tier, покрывающим наш объём. RunPod — запасной вариант при проблемах с Modal ($0.40/ч T4, нет free tier). Replicate — альтернатива для image gen ($0.003/img FLUX.1 Schnell API).

---

## J. Дополнительные возможности

### J.1 Gemini Batch API (50% скидка)

Google предлагает Batch API для асинхронной обработки — **50% скидка** на все токены. Идеально для free-tier пользователей (background processing, SLA 30+ мин):

- Extraction: $0.25/M input + $1.50/M output (вместо $0.50 + $3.00)
- Для 35 глав: ~$0.08-0.26 вместо $0.165-0.50
- **Экономия: $0.085-0.24/книга дополнительно**

### J.2 Character Consistency (IP-Adapter)

При переходе на self-hosted FLUX на Modal можно добавить:

- IP-Adapter для единообразия персонажей (тот же стиль лица)
- LoRA fine-tuning на стиле конкретной книги
- Это НЕВОЗМОЖНО через OpenRouter API

### J.3 Embedding-based Deduplication

Sentence-transformers на Modal T4 для entity dedup:

- ~500-2000 embeddings/сек
- Стоимость: ~$0.0001 за 1000 entities
- Pre-filter перед LLM dedup → сокращение LLM calls на 50-70%

---

## K. Production Data: "Перекрёстки сумерек"

### K.1 Книга

| Параметр  | Значение                               |
| --------- | -------------------------------------- |
| ID        | `6d9501eb-5ae3-4f19-b0ea-4877551964fa` |
| Название  | Перекрёстки сумерек                    |
| Автор     | Роберт Джордан                         |
| Главы     | 50 (все обработаны, 0 service pages)   |
| Слова     | 253,861                                |
| Описания  | 381                                    |
| Сущности  | 198                                    |
| Создана   | 2026-03-21 17:28 UTC                   |
| Обработка | 18:03 — 19:02 UTC (59 мин)             |

### K.2 LLM Usage (из `llm_usage_log`)

| Model                             | Calls   | Prompt Tokens | Completion Tokens | Total Cost  | Avg Cost/Call |
| --------------------------------- | ------- | ------------- | ----------------- | ----------- | ------------- |
| google/gemini-3-flash-preview     | 121     | 584,950       | 546,732           | **$1.9119** | $0.0158       |
| black-forest-labs/flux.2-klein-4b | 62      | 0             | 0                 | **$0.9920** | $0.0160       |
| **ИТОГО**                         | **183** | —             | —                 | **$2.9039** | —             |

### K.3 OpenRouter API Verification

Верифицировано через `GET /api/v1/generation?id={request_id}`:

**Пример LLM call** (`gen-1774116135-DgNwuInBHoelB8UeGgxG`):

- Model: `google/gemini-3-flash-preview-20251217`
- Provider: Google (direct)
- Latency: 1,109 ms, Generation time: 55,172 ms
- Native tokens: 9,701 prompt + 10,678 completion
- Cost: **$0.0369** (matches DB)

**Пример Image call** (`gen-1774119233-esrtxxGyV3am5z0BWZN5`):

- Model: `black-forest-labs/flux.2-klein-4b`
- Provider: Black Forest Labs (direct)
- Latency: 4,544 ms, Generation time: 6,287 ms
- Media completion: 1 image
- Cost: **$0.016** (matches DB)

### K.4 Breakdown по категориям (121 LLM calls)

121 LLM call для 50 глав = **2.4 calls/глава**. Это включает:

- Chapter extraction (50 calls — по 1/главу)
- Multi-chunk chapters (дополнительные calls для глав >100K chars)
- Entity synthesis (batch calls)
- Entity deduplication
- Prompt translation (62 calls для image prompts)

**Примечание**: поле `service=NULL` во всех записях `llm_usage_log` — нельзя разделить по сервисам. Рекомендация: добавить service attribution в `openrouter_client.py`.

### K.5 OpenRouter API key

| Параметр      | Значение                |
| ------------- | ----------------------- |
| Monthly usage | **$12.78**              |
| Daily usage   | $0 (на момент проверки) |
| Free tier     | No                      |
| Rate limit    | Deprecated field        |

### K.6 OpenRouter API для мониторинга

| Endpoint                               | Key Type           | Описание                 |
| -------------------------------------- | ------------------ | ------------------------ |
| `GET /api/v1/generation?id={id}`       | Обычный API key    | Детали одного запроса    |
| `GET /api/v1/activity?date=YYYY-MM-DD` | **Management key** | Дневная сводка по модели |
| `GET /api/v1/credits`                  | **Management key** | Баланс                   |

**Рекомендация**: создать Management API key в [OpenRouter Settings](https://openrouter.ai/settings/keys) для доступа к `/api/v1/activity` — дневные агрегаты стоимости по модели за 30 дней.

### K.7 Корректировка прогнозной модели

| Параметр          | Прогноз    | Реальность | Корректировка            |
| ----------------- | ---------- | ---------- | ------------------------ |
| Цена/image        | $0.03      | **$0.016** | Images = 34% (не 70-84%) |
| LLM доля          | 16-30%     | **66%**    | LLM = главный bottleneck |
| $/книга (50 глав) | $1.79-2.14 | **$2.90**  | Крупные книги дороже     |
| Calls/глава       | 1          | **2.4**    | Multi-chunk + synthesis  |

---

## L. Источники

### Modal Platform

- [Modal Pricing](https://modal.com/pricing)
- [Modal Cold Start Performance](https://modal.com/docs/guide/cold-start)
- [GPU Memory Snapshots](https://modal.com/blog/gpu-mem-snapshots)
- [Modal Volumes](https://modal.com/docs/guide/volumes)
- [Modal Secrets](https://modal.com/docs/guide/secrets)
- [Modal Region Selection](https://modal.com/docs/guide/region-selection)
- [Modal Scaling](https://modal.com/docs/guide/scale)
- [Modal SOC 2 Type II](https://modal.com/blog/soc2type2)
- [Modal + Datadog Integration](https://modal.com/docs/guide/datadog-integration)
- [Modal T4 Pricing Blog](https://modal.com/blog/nvidia-t4-price-article)
- [Modal A10G Pricing Blog](https://modal.com/blog/nvidia-a10g-price-article)
- [Modal L4 Pricing Blog](https://modal.com/blog/nvidia-l4-price-article)
- [Modal FLUX Example](https://modal.com/docs/examples/flux)
- [Modal vLLM Example](https://modal.com/docs/examples/vllm_inference)
- [Modal Billing Guide](https://modal.com/docs/guide/billing)
- [Modal Retries](https://modal.com/docs/guide/retries)
- [Modal Timeouts](https://modal.com/docs/guide/timeouts)
- [Modal Images](https://modal.com/docs/guide/images)
- [Modal 1.0 Migration](https://modal.com/docs/guide/modal-1-0-migration)

### Модели и Benchmarks

- [FLUX.2 Klein Specs](https://bfl.ai/models/flux-2-klein)
- [FLUX.2 Klein on OpenRouter](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- [SD 3.5 on Modal Blog](https://modal.com/blog/how-to-run-stable-diffusion-3-5-large-on-modal)
- [FLUX 3x Faster Blog](https://modal.com/blog/flux-3x-faster)
- [GLiNER GitHub](https://github.com/urchade/GLiNER)
- [Qwen Speed Benchmark](https://qwen.readthedocs.io/en/v2.5/benchmark/speed_benchmark.html)
- [BERT on T4 (NVIDIA)](https://developer.nvidia.com/blog/nvidia-slashes-bert-training-and-inference-times/)

### Конкурентный анализ

- [RunPod Serverless Pricing](https://docs.runpod.io/serverless/pricing)
- [RunPod FlashBoot](https://www.runpod.io/blog/introducing-flashboot-serverless-cold-start)
- [Replicate Pricing](https://replicate.com/pricing)
- [FLUX Schnell API Cheapest](https://www.pixazo.ai/blog/flux-schnell-api-cheapest-pricing)
- [Banana.dev Sunset](https://www.banana.dev/blog/sunset)
- [Cloud Run GPU GA](https://cloud.google.com/blog/products/serverless/cloud-run-gpus-are-now-generally-available)
- [Top Serverless GPU Clouds 2026](https://www.runpod.io/articles/guides/top-serverless-gpu-clouds)
- [Serverless LLM Comparison 2026](https://blog.premai.io/serverless-llm-deployment-runpod-vs-modal-vs-lambda-2026/)

### Gemini API

- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [OpenRouter Pricing](https://openrouter.ai/pricing)

### Предыдущие исследования fancai

- [GLiNER2 Inference Audit](docs/research/gliner2-inference-AUDIT.md) — март 2026
- [GLiNER2 Inference Optimization](docs/research/gliner2-inference-optimization.md) — март 2026
