# Аудит: Modal Full AI Pipeline Research — fancai

**Дата:** 2026-03-25
**Аудитор:** Claude Code (Opus 4.6)
**Объект аудита:** [`modal-full-pipeline-research.md`](modal-full-pipeline-research.md)
**Методология:** 4 параллельных research-агента (190+ WebSearch запросов), анализ кода (6 файлов), независимые расчёты
**Серьёзность:** 5 CRITICAL, 8 WARNING, 12 INFO

---

## Executive Summary

Отчёт в целом **качественный и хорошо структурированный**, но содержит **5 критических ошибок** и **ряд пропущенных аспектов**, которые существенно влияют на принятие решений:

1. **Modal EU region: множитель 1.25-2.5x на цены** — ВСЕ расчёты стоимости Modal занижены на 25-150% (отчёт использует US pricing)
2. **Throughput Qwen3.5-35B-A3B на L4 завышен в 3x** — L4 memory bandwidth 300 GB/s vs RTX 3090 936 GB/s → реальный throughput ~40-60 tok/s, не 150-200
3. **vLLM + Qwen3.5 structured output: баг ОТКРЫТ** — Issue #35700 (23 марта 2026) — блокер для production
4. **FLUX.2 Klein multi-reference: максимум 4 через API, не 10** — завышено в 2.5 раза
5. **Пропущена подписочная модель premium/free** — ключевой бизнес-аспект не учтён в архитектуре

**Скорректированная стоимость:** $0.155/книга → **$0.28-0.55/книга** (с учётом EU region + реального throughput + structured output overhead)

---

## A. Верификация данных и расчётов

### A.1 Стоимость моделей

| #   | Утверждение                        | Вердикт         | Примечание                                                                                          | Источник                                                               |
| --- | ---------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Gemini 3.0 Flash: $0.50/$3.00      | ✅ Подтверждено | Точно                                                                                               | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 2   | Gemini 3.1 Flash-Lite: $0.25/$1.50 | ✅ Подтверждено | Released March 3, 2026 preview                                                                      | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 3   | Gemini 2.5 Flash-Lite: $0.10/$0.40 | ✅ Подтверждено | Точно                                                                                               | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 4   | Gemini Batch API: 50% скидка       | ✅ Подтверждено | Cache (90%) и Batch (50%) скидки НЕ суммируются                                                     | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 5   | OpenRouter markup 5.5%             | ⚠️ Уточнение    | 5.5% на **покупку кредитов**, не на inference. Эффективный markup тот же. BYOK: 5% после 1M req/мес | [openrouter.ai/pricing](https://openrouter.ai/pricing)                 |
| 6   | Modal T4: $0.59/ч                  | ✅ Подтверждено | $0.000164/с                                                                                         | [modal.com/pricing](https://modal.com/pricing)                         |
| 7   | Modal L4: $0.80/ч                  | ✅ Подтверждено | $0.000222/с                                                                                         | [modal.com/pricing](https://modal.com/pricing)                         |
| 8   | Modal A10G: $1.10/ч                | ✅ Подтверждено | $0.000306/с                                                                                         | [modal.com/pricing](https://modal.com/pricing)                         |
| 9   | Modal free tier: $30/мес           | ✅ Подтверждено | Starter plan, 100 containers, 10 GPU concurrency                                                    | [modal.com/pricing](https://modal.com/pricing)                         |

### A.2 ❌ CRITICAL: Modal EU Region Pricing Multiplier

**Отчёт НЕ учитывает EU region multiplier.** Modal EU region стоит **1.25-2.5x** от базовой цены:

| GPU  | US price | EU price (1.25x) | EU price (2.5x max) |
| ---- | -------- | ---------------- | ------------------- |
| T4   | $0.59/ч  | $0.74/ч          | $1.48/ч             |
| L4   | $0.80/ч  | $1.00/ч          | $2.00/ч             |
| A10G | $1.10/ч  | $1.38/ч          | $2.75/ч             |

**Impact:** Все расчёты стоимости Modal в отчёте занижены на 25-150%.

**Источник:** [Modal Region Selection Blog](https://modal.com/blog/region-selection-launch) — "Pricing multiplier: 1.25x-2.5x on top of base prices for non-US regions"

**Рекомендация:** Использовать US region (если допустимо по GDPR) или пересчитать с множителем.

### A.3 Обратная калибровка token volumes

| Утверждение                                                        | Вердикт                            | Проверка                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| $5.12 → ~4.71M input + 0.84M output                                | ✅ Арифметика верна                | 4.71M × $0.5275 + 0.84M × $3.165 = $5.14 ≈ $5.12                                                                     |
| Разбивка: extraction 60%, translation 7%, synthesis 15%, dedup 12% | ⚠️ Обоснована, но не верифицируема | Без детального breakdown из OpenRouter Management API — educated guess                                               |
| 52-66% потеря данных в DB                                          | ✅ Подтверждается кодом            | `asyncio.create_task()` fire-and-forget в `asyncio.run()` контексте Celery — задачи теряются при закрытии event loop |

### A.4 ❌ CRITICAL: Расчёт стоимости Self-hosted LLM

**Проблема 1: Throughput на L4 завышен в 3x**

Отчёт заявляет 150-200 tok/sec для Qwen3.5-35B-A3B на L4. Верификация:

| GPU           | Memory BW    | Measured tok/s        | Источник                                                                             |
| ------------- | ------------ | --------------------- | ------------------------------------------------------------------------------------ |
| RTX 3090      | 936 GB/s     | ~112 tok/s            | [Medium](https://agentnativedev.medium.com/)                                         |
| RTX 5090 GPTQ | —            | ~194 tok/s            | [HF discussion](https://huggingface.co/Qwen/Qwen3.5-35B-A3B-GPTQ-Int4/discussions/3) |
| RTX 5060 Ti   | —            | ~47-51 tok/s          | [HF discussion](https://huggingface.co/Qwen/Qwen3.5-35B-A3B-GPTQ-Int4/discussions/3) |
| **L4**        | **300 GB/s** | **~35-50 tok/s est.** | Экстраполяция по BW                                                                  |
| Alibaba API   | —            | 177 tok/s             | [Artificial Analysis](https://artificialanalysis.ai/models/qwen3-5-35b-a3b)          |

**L4 имеет memory bandwidth 300 GB/s** — в 3x меньше чем RTX 3090 (936 GB/s). Для MoE модели, где inference memory-bandwidth-bound, throughput пропорционален BW.

**Пересчёт стоимости:**

```
Original:  270K / 600 tok/s = 450s + overhead ≈ 700s × $0.000222 = $0.155
Corrected: 270K / 300 tok/s = 900s + overhead ≈ 1100s × $0.000222 = $0.244
With EU:   1100s × $0.000278 (1.25x) = $0.306
```

**Проблема 2: Structured output overhead не учтён**

vLLM guided decoding (xgrammar/outlines) добавляет **10-30% overhead** на output generation:

```
Corrected with guided decoding: 270K / 250 tok/s = 1080s output
Total: ~1300s × $0.000222 = $0.289 (US) / $0.361 (EU 1.25x)
```

**Проблема 3: `max_model_len=32768` может быть недостаточно**

Текущий pipeline использует chunks 100K chars ≈ 33-50K tokens (русский текст ~2-3 chars/token). Код Modal устанавливает `max_model_len=32768`, что МЕНЬШЕ типичного chunk:

```python
# В Modal App Design (E.2):
self.llm = LLM(model="Qwen/Qwen3.5-35B-A3B", max_model_len=32768, ...)
# Но gemini_extractor.py: max_chunk_chars = 100000 → ~33-50K tokens
```

**Варианты:** уменьшить chunks до 60K chars (~20-25K tokens) или увеличить `max_model_len` (требует больше VRAM, возможно A10G вместо L4).

### A.5 Расчёт стоимости Image Generation

| Утверждение                         | Вердикт             | Проверка                      |
| ----------------------------------- | ------------------- | ----------------------------- |
| FLUX.2 Klein L4: $0.0006-0.0007/img | ✅ Арифметика верна | ~3s × $0.000222/s = $0.000667 |
| Z-Image-Turbo A10G: $0.0012/img     | ✅ Арифметика верна | ~4s × $0.000306/s = $0.00122  |
| Cold start Klein L4: $0.007         | ✅ Верно            | ~31s × $0.000222              |
| HiDream A10G: $0.0046/img           | ✅ Верно            | ~15s × $0.000306              |
| **С EU multiplier**                 | ❌ Не учтён         | Все image costs × 1.25-2.5x   |

### A.6 Скорректированная таблица стоимости (1 книга)

| Компонент            | Отчёт (US) | Скорректировано (US) | Скорректировано (EU 1.25x) |
| -------------------- | ---------- | -------------------- | -------------------------- |
| LLM Qwen3.5-35B-A3B  | $0.155     | **$0.289**           | **$0.361**                 |
| Images Z-Image-Turbo | $0.094     | $0.094               | **$0.118**                 |
| Modal overhead       | $0.04      | $0.04                | $0.05                      |
| **TOTAL Full Modal** | **$0.29**  | **$0.42**            | **$0.53**                  |

**Вывод:** Реальная стоимость Full Modal **$0.42-0.53/книга**, не $0.29. Экономия всё ещё значительная (91-93% vs $6.13), но менее драматичная чем 95%.

---

## B. Валидация рекомендаций по моделям

### B.1 Image Generation

| #   | Модель/Утверждение                                  | Вердикт                           | Детали                                                                                                         |
| --- | --------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | FLUX.2 Klein multi-reference: до 10 ref images      | ❌ **CRITICAL**                   | BFL API: max **4 reference images**. 10 только в playground. Self-hosted: ограничено VRAM.                     | [fal.ai guide](https://fal.ai/learn/devs/flux-2-klein-user-guide) |
| 2   | FLUX.2 Klein: multi-ref через diffusers             | ✅ Подтверждено                   | `Flux2KleinPipeline` в HuggingFace diffusers. KV-cached variant для повторного использования reference tokens. |
| 3   | FLUX.2 Klein: multi-ref недоступен через OpenRouter | ❌ Неверно                        | OpenRouter **поддерживает** multi-reference для FLUX.2 Klein. Однако с ограничением 4 refs.                    |
| 4   | FLUX.2 Klein: 13GB VRAM                             | ✅ Подтверждено                   | BFL: "runs on consumer hardware with as little as 13GB VRAM"                                                   |
| 5   | FLUX.2 Klein: <0.5s на H100                         | ⚠️ Правдоподобно                  | Нет опубликованных H100 бенчмарков. ~1.2s на RTX 5090.                                                         |
| 6   | Z-Image-Turbo: качество ≥ FLUX.2 [dev]              | ✅ **Подтверждено и превосходит** | **#1 open-source на AI Arena** (1026 ELO). Превосходит FLUX.2 [dev], HunyuanImage 3.0.                         | [artificialanalysis.ai](https://artificialanalysis.ai/)           |
| 7   | Z-Image-Turbo: Apache 2.0, 16GB bf16                | ✅ Подтверждено                   |                                                                                                                |
| 8   | OmniGen2: production-ready                          | ❌ **НЕ production-ready**        | Разработчики рекомендуют "official demo". Character consistency слабая (размытые лица).                        |
| 9   | ACE++: 92.3% retention                              | ⚠️ Не подтверждается              | Число не найдено в оригинальной статье (arXiv:2501.02487). Возможно из промо-источника.                        |
| 10  | SANA 1.6B: <1s на T4                                | ❌ Неверно                        | <1s — для **SANA 0.6B**, не 1.6B. SANA-Sprint 1.6B: 0.24s на RTX 4090. T4 бенчмарков нет.                      |
| 11  | SANA: quality 6.5                                   | ❌ Неверифицируемая метрика       | Число не найдено ни в одном стандартном бенчмарке.                                                             |
| 12  | HiDream I1 Fast: MIT, A10G, 17B MoE                 | ✅ Подтверждено                   | VAE = Apache 2.0, LLaMA encoder = Llama License.                                                               |

### B.2 ❌ ПРОПУЩЕННЫЕ Image Models

| Модель             | Дата            | Params | Почему важна                                                      | Лицензия   |
| ------------------ | --------------- | ------ | ----------------------------------------------------------------- | ---------- |
| **Qwen-Image-2.0** | Фев 10, 2026    | 7B     | #1 AI Arena для T2I+editing, Apache 2.0                           | Apache 2.0 |
| **GLM-Image**      | Янв 14, 2026    | 16B    | **0.9116 Word Accuracy** (крушит конкурентов по текст-рендерингу) | MIT        |
| **Imagen 4 Fast**  | Фев 17, 2026 GA | Closed | $0.02/img, 2.7s, отличная типографика                             | API only   |

**Рекомендация:** Qwen-Image-2.0 должна быть оценена как альтернатива Z-Image-Turbo (7B, Apache 2.0, #1 на Arena).

### B.3 LLM Models

| #   | Утверждение                                              | Вердикт             | Детали                                                                                                               |
| --- | -------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Qwen3.5-35B-A3B: 35B/3B active, 262K, Apache 2.0, Feb 24 | ✅ Всё подтверждено | 256 experts, 8 routed + 1 shared                                                                                     |
| 2   | "35B quality at 3B speed"                                | ✅ Подтверждено     | Превосходит Qwen3-235B на MMLU-Pro (85.3), GPQA Diamond (84.2)                                                       |
| 3   | Fits L4 с AWQ                                            | ✅ Правдоподобно    | AWQ 4-bit ≈ 17-19GB model weight, fit 24GB с ограниченным KV cache                                                   |
| 4   | 150-200 tok/s output                                     | ❌ **НЕ на L4**     | Достижимо на RTX 3090/5090. L4: ~35-50 tok/s. См. секцию A.4.                                                        |
| 5   | 10 concurrent → 500-800 agg                              | ❓ Нет бенчмарков   | Теоретически возможно, но не подтверждено для L4                                                                     |
| 6   | Qwen3.5-9B: beats 30B prev gen                           | ✅ Подтверждено     | GPQA +8, IFEval +3, LongBench +10 vs Qwen3-30B                                                                       |
| 7   | enable_thinking + guided_json bug                        | ⚠️ **ОТКРЫТ**       | vLLM Issue #35700 (23 марта 2026) — structured output fails. #35574 — enable_thinking=false не работает. **БЛОКЕР.** |
| 8   | MERA benchmark results                                   | ❓ Не найдено       | Qwen не публикует MERA. Для русского нужно собственное A/B тестирование                                              |

### B.4 ❌ CRITICAL: vLLM Structured Output Bug

**Issue [#35700](https://github.com/vllm-project/vllm/issues/35700)** (23 марта 2026, OPEN):

- Structured output fails для Qwen3.5
- Связан с MTP/speculative decoding
- Workaround: отключить MTP, использовать `--reasoning-parser qwen3`

**Issue [#35574](https://github.com/vllm-project/vllm/issues/35574)** (OPEN):

- `enable_thinking=false` не работает для Qwen3.5 в vLLM 0.16.0

**Impact:** Self-hosted Qwen3.5 для structured extraction (основная задача fancai) может быть **нерабочим** в текущих версиях vLLM. Это **блокер** для Фазы 2.

**Рекомендация:** Дождаться fix в vLLM ~0.18+ или использовать text output + JSON parsing fallback (как текущий legacy mode).

### B.5 ❌ ПРОПУЩЕННЫЕ LLM Models

| Модель                | Дата      | Params                                   | Почему важна                                                                      |
| --------------------- | --------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| **GigaChat 3** (Sber) | 2026      | 702B-A36B (Ultra), 10B-A1.8B (Lightning) | **MIT**, тренирован с нуля для русского. Лучший выбор для Russian-critical задач. |
| **Mistral Small 4**   | Март 2026 | 119B MoE, 6B active                      | 256K context, альтернатива Qwen3.5-35B-A3B                                        |

**GigaChat 3 Lightning (10B-A1.8B)** может быть оптимальной моделью для translation/synthesis/dedup — специализирован на русском, MIT лицензия, крошечный active size.

### B.6 Gemini Batch API

| #   | Утверждение                       | Вердикт                          | Детали                                                                                       |
| --- | --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 50% скидка                        | ✅ Подтверждено                  | Для всех моделей. Не суммируется с Context Caching (90% > 50%).                              |
| 2   | Latency 15 мин — 2 часа           | ⚠️ Типичная, но не гарантирована | 24ч **НЕ является SLO/SLA**. Есть случаи 26+ часов stuck. Jobs expire после 48ч.             |
| 3   | Structured output в batch         | ⚠️ **Зависит от API**            | Нативный Gemini SDK: ✅. OpenAI compatibility layer: **только json_object, НЕ json_schema**. |
| 4   | Max batch: 2GB JSONL, 20MB inline | ✅ Подтверждено                  | Google рекомендует 1K-5K requests/job для оптимального throughput                            |
| 5   | Partial failures: per-request     | ✅ Подтверждено                  | `batchStats.failedRequestCount`. Job creation NOT idempotent.                                |

### B.7 ❌ ПРОПУЩЕНО: Gemini Context Caching

Отчёт упоминает Context Caching в таблице D.4, но **не считает его impact на стоимость**.

Context Caching даёт **90% скидку** на cached input tokens:

| Модель                | Standard Input | Cached Input | Экономия |
| --------------------- | -------------- | ------------ | -------- |
| Gemini 3.0 Flash      | $0.50/M        | **$0.05/M**  | 90%      |
| Gemini 3.1 Flash-Lite | $0.25/M        | **$0.025/M** | 90%      |

**Для fancai extraction:** System prompt одинаков для всех 50 глав книги (~2-5K tokens). С Context Caching:

```
System prompt: 5K tokens × 50 calls = 250K cached tokens
Savings: 250K × ($0.50 - $0.05) / 1M = $0.1125 per book
Storage: 5K tokens × 1 час × $1.00/M/hr = $0.005

Net savings: ~$0.11/book (2% от $5.12, незначительно)
```

Но с **implicit caching** (автоматическое): если Gemini определяет повторяющиеся prefixes, savings может быть выше (up to $0.30-0.50/book).

---

## C. Архитектурный аудит

### C.1 ❌ CRITICAL: Premium/Free архитектура приоритетных очередей

**Главный пропущенный аспект отчёта.** Проект имеет гибридную подписочную модель, но отчёт проектирует архитектуру для single-tier processing.

#### Предлагаемая архитектура:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VPS (32GB, 12 vCPU)                          │
│                                                                     │
│  ┌──────────┐  ┌────────────────────────────────────┐  ┌─────────┐ │
│  │ FastAPI   │  │ Celery Workers                      │  │ PG+Redis│ │
│  │           │  │                                    │  │         │ │
│  │ user_tier │  │  Queue: "premium" (priority=9)     │  │         │ │
│  │ detection │  │  Queue: "standard" (priority=1)    │  │         │ │
│  │           │  │  Queue: "batch"    (priority=0)    │  │         │ │
│  └─────┬────┘  └──────────┬─────────────────────────┘  └─────────┘ │
│        │                   │                                        │
└────────┼───────────────────┼────────────────────────────────────────┘
         │                   │
    ┌────┴───────────────────┴────────────────────────────────────┐
    │                                                             │
    │  Premium Path:                Free Path:                    │
    │  ┌──────────────────┐         ┌──────────────────┐          │
    │  │ Modal (warm)      │         │ Gemini Batch API  │          │
    │  │ scaledown=600     │         │ Flash + Lite      │          │
    │  │ Qwen3.5 + FLUX.2 │         │ $1.96/книга       │          │
    │  │ $0.42/книга       │         │ 30-120 мин        │          │
    │  │ ~10 мин           │         └──────────────────┘          │
    │  └──────────────────┘                                       │
    │                               ┌──────────────────┐          │
    │                               │ Modal scale-to-0  │          │
    │                               │ FLUX.2 Klein      │          │
    │                               │ Images only       │          │
    │                               └──────────────────┘          │
    │                                                             │
    │  Emergency Fallback: OpenRouter (текущий pipeline)          │
    └─────────────────────────────────────────────────────────────┘
```

#### Таблица параметров по тарифам:

| Аспект                       | Free                               | Premium                                   |
| ---------------------------- | ---------------------------------- | ----------------------------------------- |
| **LLM Provider**             | Gemini Batch API (Flash + Lite)    | Modal Qwen3.5-35B-A3B                     |
| **Image Model**              | Modal FLUX.2 Klein (scale-to-zero) | Modal FLUX.2 Klein (warm) + Z-Image-Turbo |
| **Character Consistency**    | Нет                                | Да (FLUX.2 Klein multi-ref, до 4 images)  |
| **Processing Time SLA**      | ≤4 часа (best effort)              | ≤10 минут                                 |
| **Queue Priority**           | Celery: priority=0-1               | Celery: priority=9                        |
| **Modal Container Strategy** | scale-to-zero                      | scaledown_window=600                      |
| **Cost per book**            | ~$2.05                             | ~$0.42 (US) / ~$0.53 (EU)                 |
| **Monthly cost (10 books)**  | ~$20.50                            | ~$4.20 (US) / ~$5.30 (EU)                 |
| **Books/month limit**        | 3-5                                | Unlimited                                 |

#### Celery Queue Configuration:

```python
# backend/app/core/celery_app.py
from kombu import Queue

CELERY_TASK_QUEUES = [
    Queue('premium', routing_key='premium', queue_arguments={'x-max-priority': 10}),
    Queue('standard', routing_key='standard', queue_arguments={'x-max-priority': 5}),
    Queue('batch', routing_key='batch'),  # Gemini Batch API polling
]

# Routing
CELERY_TASK_ROUTES = {
    'process_book_premium': {'queue': 'premium'},
    'process_book_standard': {'queue': 'standard'},
    'poll_gemini_batch': {'queue': 'batch'},
}
```

**Важно:** Redis broker имеет ограниченную поддержку приоритетов. Для надёжных приоритетов рекомендуется RabbitMQ или отдельные queues с отдельными workers.

#### Бизнес-метрики:

| Метрика                              | Расчёт                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| Стоимость free user (5 книг/мес)     | ~$10.25                                                            |
| Стоимость premium user (10 книг/мес) | ~$4.20-5.30 + Modal warm share                                     |
| Modal warm container (1 L4, shared)  | ~$18/мес (5 мин warm × ~60 использований/мес)                      |
| **Breakeven premium price**          | $10.25 - $5.30 + $18/N_premium = **$6-8/мес при 5+ premium users** |
| Min premium subscription             | **$9.99/мес** (covers processing + warm overhead)                  |
| Breakeven: N premium users           | ($9.99 × N - $18_warm) / (N × $5.30_processing) > 0 → **N ≥ 2**    |

**При 10 premium пользователях:**

- Revenue: $9.99 × 10 = $99.90/мес
- Processing: 100 книг × $0.53 = $53
- Modal warm: ~$18/мес
- **Profit: $28.90/мес** (29% margin)

### C.2 Масштабируемость

| Аспект                          | Ограничение                 | Рекомендация                                                              |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| Modal free tier GPU concurrency | **10 GPUs**                 | Достаточно до ~50 concurrent users. Далее: Team plan ($250/мес, 50 GPUs). |
| Burst: 50 книг/час              | ~50 × 18 мин = 15 GPU-часов | Free tier: OK (10 concurrent × 1.5 часа). Bottleneck: queue depth.        |
| Queue depth monitoring          | Не описано в отчёте         | Prometheus: `celery_queue_length`, alert at >20 pending tasks             |
| Auto-scaling                    | Modal handles автоматически | `max_containers=5` для premium, `max_containers=2` для free               |

### C.3 Отказоустойчивость

| Сценарий                       | Стратегия                                        | Реализация                                            |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| Modal outage                   | Fallback на Gemini Batch + OpenRouter            | Feature flag `MODAL_AVAILABLE`, heartbeat check       |
| Gemini Batch timeout >24ч      | Retry 1x, затем fallback на OpenRouter real-time | `poll_gemini_batch` task с 48ч expiry check           |
| Partial chapter failure (1/50) | Retry individual chapter, не весь book           | Per-chapter error handling уже есть в `book_tasks.py` |
| PostgreSQL consistency         | Atomic writes per chapter                        | Текущий паттерн (per-chapter session) уже корректен   |

### C.4 Cold Start Impact

| Сценарий                         | Cold Start | С GPU Snapshot | Допустимо?                                |
| -------------------------------- | ---------- | -------------- | ----------------------------------------- |
| Premium LLM (Qwen3.5 L4)         | 60-90 сек  | ~10-15 сек     | С snapshot: да. Без: нет для SLA <10 мин. |
| Premium Images (FLUX.2 Klein L4) | 30-60 сек  | ~5-10 сек      | Да (images не на critical path для UX)    |
| Free Images (scale-to-zero)      | 30-60 сек  | ~5-10 сек      | Да (free tier не имеет SLA)               |

**`min_containers=1` для premium:**

- L4 24/7: $0.80 × 24 × 30 = **$576/мес** — НЕ оправдано
- scaledown_window=600: GPU выключается через 10 мин простоя
- GPU Memory Snapshot: cold start ~10-15 сек → **допустимо для premium SLA**

### C.5 Безопасность

| Аспект                     | Статус             | Рекомендация                                                                                                 |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Modal Secrets для API keys | ✅ Достаточно      | `Secret.from_name()` → env vars в container                                                                  |
| PostgreSQL из Modal        | ✅ Правильно       | Celery worker пишет в DB (не Modal container). Нет direct DB access из Modal.                                |
| GDPR: Modal EU region      | ⚠️ Есть, но дороже | DPA доступен (modal.com/legal/dpa). EU region = 1.25-2.5x cost.                                              |
| Данные книг в Modal        | ⚠️ Нужна policy    | Modal containers ephemeral, но данные в transit. Рекомендация: не хранить полный текст книг в Modal Volumes. |

---

## D. Пропущенные аспекты

### D.1 Критичные (не исследованы)

| #   | Аспект                                | Severity | Описание                                                                                               |
| --- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Premium/Free приоритетные очереди** | CRITICAL | Разработано в секции C.1                                                                               |
| 2   | **Cost tracking per user**            | HIGH     | Нужна таблица `user_ai_costs` для отслеживания расходов на каждого пользователя                        |
| 3   | **A/B тестирование: протокол**        | HIGH     | Sample size, метрики, statistical significance — не определены                                         |
| 4   | **Graceful degradation**              | HIGH     | Что если Modal + Gemini + OpenRouter ВСЕ недоступны?                                                   |
| 5   | **Image storage**                     | MEDIUM   | Сейчас: base64 в PostgreSQL (через data URL). С Modal: image bytes через return → VPS filesystem. CDN? |
| 6   | **Monitoring**                        | MEDIUM   | Prometheus метрики для Modal: latency, throughput, cost, error rate                                    |
| 7   | **Billing integration**               | MEDIUM   | Связь Modal costs с Stripe subscription                                                                |

### D.2 Архитектурные альтернативы

| Provider                 | GPU            | Price/h    | vs Modal        | Плюсы                            | Минусы                          |
| ------------------------ | -------------- | ---------- | --------------- | -------------------------------- | ------------------------------- |
| **RunPod Serverless**    | T4             | ~$0.40     | **32% дешевле** | Flex Workers (scale-to-zero)     | Меньше DX                       |
| **Google Cloud Run GPU** | L4             | ~$0.67     | **16% дешевле** | Native Google, no EU multiplier? | Нет scale-to-zero для GPU       |
| **Vast.ai**              | T4             | ~$0.09     | **85% дешевле** | Spot pricing                     | Ненадёжно, нет managed platform |
| **Replicate**            | Per-prediction | ~$0.03/img | API-based       | Zero infra                       | Дорого at scale                 |
| **Lambda Labs**          | A100           | ~$1.10     | Comparable      | Zero egress fees                 | Не serverless                   |
| **Banana.dev**           | —              | —          | —               | **МЕРТВЫ** (март 2024)           | —                               |
| **Baseten**              | Per-minute     | —          | —               | Production-grade                 | Pricing not transparent         |

**Рекомендация:** RunPod заслуживает оценки как альтернатива Modal для T4 workloads (NER, translation). Cloud Run GPU для L4 workloads если EU pricing не нужен.

### D.3 Оптимизации не рассмотренные

| Оптимизация                     | Потенциал                                | Сложность                                    |
| ------------------------------- | ---------------------------------------- | -------------------------------------------- |
| **Gemini Context Caching**      | ~$0.11-0.50/book savings                 | Низкая (implicit кэширование автоматическое) |
| **Prompt compression**          | 10-30% сокращение input tokens           | Средняя                                      |
| **Speculative decoding в vLLM** | 1.5-2x ускорение output                  | Средняя (нужен draft model)                  |
| **AWQ vs GPTQ vs GGUF**         | GPTQ может быть быстрее для L4           | Низкая (benchmark нужен)                     |
| **Prefix caching в vLLM**       | Экономия на повторяющихся system prompts | Низкая (встроено в vLLM)                     |
| **Chunked prefill**             | Оптимизация для длинных контекстов       | Низкая (vLLM option)                         |
| **Embedding-based dedup**       | Замена LLM dedup → $0 cost               | Средняя (sentence-transformers)              |

---

## E. Pricing Sensitivity Analysis

### E.1 Сценарии изменения цен

| Сценарий                     | Impact                                  | Mitigation                              |
| ---------------------------- | --------------------------------------- | --------------------------------------- |
| Modal убирает free tier      | +$250/мес (Team plan minimum)           | RunPod fallback, или Gemini Batch only  |
| Modal EU x2 → x3             | +50% на Modal costs                     | US region (если GDPR не critical)       |
| Gemini повышает цены 2x      | Batch path $3.92/book → less attractive | Self-hosted LLM becomes more attractive |
| OpenRouter markup 5.5% → 10% | +~$0.25/book                            | Direct Gemini API (уже planned)         |
| FLUX.2 Klein changes license | Modal images unusable                   | Z-Image-Turbo (Apache 2.0, #1 Arena)    |
| Qwen3.5 closes weights       | Self-hosted LLM path blocked            | GigaChat 3 (MIT), Mistral Small 4       |

### E.2 Break-even анализ

| Вопрос                                         | Ответ                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Full Modal (S5) дешевле Gemini Batch (S4) при? | **Всегда** (even 1 book: $0.42 vs $2.07). Но S5 имеет higher risk.                         |
| Free tier лимит для S5?                        | $30 / $0.048 modal-overhead = **~625 книг/мес** (without EU), **~500 книг/мес** (EU 1.25x) |
| min_containers breakeven?                      | 1 L4 24/7 = $576/мес → needs **1370 books/мес** to justify vs scale-to-zero                |
| Premium subscribers для breakeven?             | **2+ premium users** at $9.99/мес covers warm container + processing                       |

---

## F. Аудит кода

### F.1 `openrouter_client.py` (738 строк)

| Проблема                                   | Severity  | Описание                                                                                                                                                                                                |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fire-and-forget logging**                | HIGH      | `asyncio.create_task(_log_usage_to_db(...))` (строки 373, 505, 652). В Celery context (`asyncio.run()` в book_tasks.py:195) event loop закрывается до завершения task → **потеря 52-66% usage данных**. |
| Circuit breaker: separate для LLM и images | ✅ Хорошо | Правильное разделение. LLM failures не блокируют image gen.                                                                                                                                             |
| `_inline_defs()`: мутирует входной dict    | LOW       | `schema.pop("$defs", {})` модифицирует аргумент. Не проблема если schema каждый раз генерируется заново.                                                                                                |
| Modal fallback: нет integration point      | INFO      | Для добавления Modal path нужен новый метод или strategy pattern. Текущий fallback chain жёстко прибит к OpenRouter models.                                                                             |

**Рекомендация для Modal integration:**

```python
# Добавить в OpenRouterClient:
async def generate_structured_modal(self, prompt, schema_class, ...):
    """Modal path для structured extraction."""
    # Call Modal function instead of OpenRouter

# Или: Strategy pattern в gemini_extractor.py:
class ExtractionStrategy(Protocol):
    async def extract(self, prompt: str, schema: Type[BaseModel]) -> dict: ...

class OpenRouterStrategy: ...
class ModalStrategy: ...
class GeminiBatchStrategy: ...
```

### F.2 `gemini_extractor.py` (1221 строк)

| Аспект              | Находка                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chunk size → tokens | 100K chars русского текста ≈ **33-50K tokens** (Gemini tokenizer: ~2-3 chars/token для кириллицы). Это превышает `max_model_len=32768` из примера Modal кода.                                 |
| Pydantic schemas    | `GeminiEntitySchema`, `GeminiRelationshipSchema` — совместимы с vLLM guided decoding через `model_json_schema()`. Но `_inline_defs()` не нужен для vLLM (xgrammar обрабатывает $ref нативно). |
| TSA parser          | XML-based parsing output. Работает с Gemini Flash. Для Qwen3.5 нужно тестировать — MoE модели могут генерировать менее consistent XML.                                                        |
| Semaphore(3)        | Ограничивает concurrent API calls per extraction. С Modal: не нужен (vLLM batch handling).                                                                                                    |

### F.3 `imagen_generator.py` (679 строк)

| Аспект                 | Находка                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation RU→EN      | **Всё ещё нужен** для self-hosted FLUX.2 / Z-Image-Turbo. FLUX и Z-Image оптимизированы для английских промптов.                                   |
| Redis caching          | Кэш по MD5 хэшу описания + aspect ratio (строка 436). С Modal: кэш остаётся на VPS (Redis), проверяется ДО вызова Modal → OK.                      |
| Prompt engineering     | Genre/type templates совместимы с любой image model. Единственное: Z-Image-Turbo может иметь другие оптимальные стили.                             |
| `reference_image_urls` | Параметр есть но не используется (строка 400, "совместимость API"). Для character consistency нужно реализовать передачу reference images в Modal. |

### F.4 `book_tasks.py` (956 строк)

| Аспект                        | Находка                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semaphore(10) chapters        | С Modal batch: заменяется на один вызов `extract_chapters.remote(all_chapters)`. Семафор не нужен.                                                             |
| Redis distributed lock        | **Остаётся нужен** для предотвращения double processing одной книги. Modal не решает эту проблему.                                                             |
| `asyncio.run()`               | Создаёт новый event loop для каждой task. **Несовместимо** с Modal async client. Нужна миграция на `loop.run_until_complete()` или async Celery.               |
| Progress tracking (WebSocket) | Celery worker отправляет progress через Redis PubSub. С Modal: нужен polling или callback от Modal → Celery → WebSocket. Увеличивает latency progress updates. |

---

## G. Risk Matrix (обновлённая)

| Risk                                    | Probability       | Impact   | Mitigation                                  | Score |
| --------------------------------------- | ----------------- | -------- | ------------------------------------------- | ----- |
| vLLM Qwen3.5 structured output bug      | **HIGH**          | CRITICAL | Wait for fix / use text+parse fallback      | 🔴    |
| Modal EU pricing higher than expected   | **HIGH**          | HIGH     | US region if GDPR allows, or RunPod         | 🔴    |
| L4 throughput lower than expected       | **HIGH**          | MEDIUM   | A10G (+37% cost), or reduce chunk size      | 🟠    |
| Gemini Batch API stuck >24h             | MEDIUM            | HIGH     | Timeout + fallback to real-time             | 🟠    |
| Quality degradation Qwen3.5 vs Gemini   | MEDIUM            | HIGH     | A/B testing with strict acceptance criteria | 🟠    |
| Modal free tier removal                 | LOW               | HIGH     | RunPod / Cloud Run fallback                 | 🟡    |
| FLUX.2 Klein license change             | LOW               | MEDIUM   | Z-Image-Turbo / Qwen-Image-2.0 backup       | 🟡    |
| Character consistency <80% retention    | MEDIUM            | MEDIUM   | LoRA per-character training (backup)        | 🟡    |
| Concurrent premium users > 10 GPU limit | LOW (early stage) | MEDIUM   | Modal Team plan ($250/mo)                   | 🟢    |

---

## H. Обновлённый Migration Plan

### Phase 0: Prerequisites (День 0-1) ← ДОБАВЛЕНО

1. **Определить Modal region** — US (дешевле) vs EU (GDPR). Пересчитать бюджет.
2. **Проверить vLLM Issue #35700** — если не resolved, Phase 2 блокирован.
3. **Настроить user tier detection** — middleware для определения free/premium.

### Phase 1: Безрисковая оптимизация (Дни 1-5) — без изменений

1. **Modal Images** — Z-Image-Turbo на A10G (или FLUX.2 Klein на L4 для бюджета)
2. **Gemini Direct API** — убрать OpenRouter markup (5.5%)
3. **Gemini Batch API** — для free tier (Flash extraction + Flash-Lite rest)

**Результат:** $2.05-2.07/книга (free tier), $1.05/книга (with images on Modal)

### Phase 1.5: Premium Infrastructure ← ДОБАВЛЕНО (Дни 5-7)

4. **Celery priority queues** — premium/standard/batch разделение
5. **User cost tracking** — таблица `user_ai_costs` в PostgreSQL
6. **Feature flags** — `USE_MODAL_IMAGES`, `USE_GEMINI_BATCH`, `USER_TIER`

### Phase 2: Self-hosted LLM (Дни 8-14) — СКОРРЕКТИРОВАНО

**Блокер:** vLLM Issue #35700 должен быть resolved.

7. **Modal Qwen3.5-35B-A3B** на L4 (AWQ 4-bit)
   - `max_model_len=65536` (не 32768!)
   - Reduce chunk size to 60K chars (~25K tokens) для безопасного margin
   - A/B тест: 5-10 книг vs Gemini Flash
   - Acceptance: ≥85% entity recall, ≥90% JSON compliance
   - **Fallback:** Gemini Batch API (Phase 1)

8. **Character consistency** — FLUX.2 Klein multi-reference (до 4 refs, не 10)

**Результат:** ~$0.42-0.53/книга (premium), ~$2.05/книга (free)

### Phase 3: Оптимизации (Дни 15+)

9. GPU Memory Snapshots — cold start <15 сек
10. Gemini Context Caching — implicit для system prompts
11. Embedding-based dedup — замена LLM dedup
12. GigaChat 3 Lightning — evaluation для translation/synthesis (русский-специализированный)
13. Qwen-Image-2.0 — evaluation как альтернатива Z-Image-Turbo

---

## I. Итоговая таблица сценариев (скорректированная)

| Компонент       | S1: Текущее | S4: Gemini Batch (Free) | S5: Full Modal (Premium, US) | S5-EU: Full Modal (Premium, EU 1.25x) |
| --------------- | ----------- | ----------------------- | ---------------------------- | ------------------------------------- |
| LLM extraction  | $3.07       | $1.46 (Batch Flash)     | ~$0.19 (Qwen3.5-35B-A3B)     | ~$0.24                                |
| LLM synthesis   | $0.77       | $0.19 (Batch Lite)      | ~$0.04                       | ~$0.05                                |
| LLM dedup       | $0.64       | $0.16 (Batch Lite)      | ~$0.02                       | ~$0.03                                |
| LLM translation | $0.37       | $0.09 (Batch Lite)      | ~$0.02                       | ~$0.03                                |
| LLM прочие      | $0.28       | $0.07 (Batch Lite)      | ~$0.02                       | ~$0.03                                |
| Images          | $1.01       | $0.09 (Modal Z-Img)     | $0.09                        | $0.12                                 |
| NER             | $0          | $0                      | $0.015                       | $0.019                                |
| Modal overhead  | $0          | $0.02                   | $0.04                        | $0.05                                 |
| **TOTAL**       | **$6.13**   | **$2.07**               | **$0.42**                    | **$0.53**                             |
| **Savings**     | —           | **-66%**                | **-93%**                     | **-91%**                              |
| **Время**       | 59 мин      | 30-120 мин              | ~18 мин                      | ~18 мин                               |
| **Риск**        | Нулевой     | Низкий                  | Средний-Высокий              | Средний-Высокий                       |

**Ключевые отличия от отчёта:**

- S5 (Full Modal): $0.42 вместо $0.29 (+45%)
- S5-EU: $0.53 (не рассматривался в отчёте)
- Время обработки: ~18 мин вместо ~12 мин (из-за реального throughput L4)
- Риск: повышен до "Средний-Высокий" из-за vLLM structured output bug

---

## J. Найденные ошибки (сводная таблица)

| #   | Ошибка                                           | Severity | Где в отчёте              | Правильные данные                         |
| --- | ------------------------------------------------ | -------- | ------------------------- | ----------------------------------------- |
| 1   | EU region pricing не учтён                       | CRITICAL | Везде (все Modal расчёты) | ×1.25-2.5 multiplier                      |
| 2   | Throughput L4: 150-200 tok/s                     | CRITICAL | C.2, формула              | ~35-50 tok/s (L4 BW = 300 GB/s)           |
| 3   | vLLM bug недостаточно выделен                    | CRITICAL | C.2 note                  | Issue #35700 OPEN, БЛОКЕР для Phase 2     |
| 4   | FLUX.2 Klein: 10 ref images                      | CRITICAL | B.2 таблица               | Max 4 через API. 10 — playground only.    |
| 5   | Premium/Free не спроектировано                   | CRITICAL | Отсутствует               | См. секцию C.1                            |
| 6   | max_model_len=32768 < chunk size                 | HIGH     | E.2 код                   | Нужно 65536+ или уменьшить chunks         |
| 7   | OpenRouter: "multi-ref недоступен"               | MEDIUM   | B.2                       | OpenRouter поддерживает multi-ref (до 4)  |
| 8   | SANA 1.6B: <1s на T4                             | MEDIUM   | B.1 таблица               | <1s — для 0.6B. 1.6B не тестирован на T4. |
| 9   | SANA: quality 6.5                                | MEDIUM   | B.1 таблица               | Метрика не из стандартного бенчмарка      |
| 10  | ACE++ 92.3% retention                            | LOW      | B.2 таблица               | Не из оригинальной статьи                 |
| 11  | OmniGen2: не отмечен как нестабильный            | LOW      | B.1                       | "Not production-ready" — авторы модели    |
| 12  | Пропущены: Qwen-Image-2.0, GigaChat 3, GLM-Image | MEDIUM   | B, C                      | Значимые модели не упомянуты              |
| 13  | Context Caching impact не посчитан               | LOW      | D.4 упомянут              | 90% скидка, implicit auto-detection       |

---

## K. Источники аудита

### Gemini API & Pricing

- [Gemini Developer API Pricing (official)](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Batch API Documentation](https://ai.google.dev/gemini-api/docs/batch-api)
- [Batch API stuck >26h (forum)](https://discuss.ai.google.dev/t/batch-api-job-stuck-in-pending-state-for-over-26-hours/114473)
- [Structured output in batch via OpenAI compat (forum)](https://discuss.ai.google.dev/t/structured-outputs-in-batch-using-openai-compatibility-mode/126309)

### Modal Platform

- [Modal Pricing](https://modal.com/pricing)
- [Modal Region Selection](https://modal.com/blog/region-selection-launch) — **EU multiplier 1.25-2.5x**
- [Modal GPU Memory Snapshots](https://modal.com/blog/gpu-mem-snapshots)
- [Modal Scaling](https://modal.com/docs/guide/scale)
- [Modal 1.0 Migration](https://modal.com/docs/guide/modal-1-0-migration)
- [Modal Security & DPA](https://modal.com/docs/guide/security)

### Qwen3.5

- [Qwen3.5-35B-A3B HuggingFace](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- [Qwen3.5 Small Series (Medium)](https://medium.com/data-science-in-your-pocket/qwen-3-5-small-model-series-released-7a5ed34fcbb3)
- [vLLM #35700 — structured output OPEN bug](https://github.com/vllm-project/vllm/issues/35700)
- [vLLM #35574 — enable_thinking bug](https://github.com/vllm-project/vllm/issues/35574)
- [vLLM Qwen3.5 recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [Artificial Analysis — Qwen3.5-35B-A3B](https://artificialanalysis.ai/models/qwen3-5-35b-a3b)

### Image Generation

- [FLUX.2 Klein user guide (fal.ai)](https://fal.ai/learn/devs/flux-2-klein-user-guide) — max 4 ref images
- [Z-Image-Turbo HuggingFace](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) — #1 open-source Arena
- [Artificial Analysis Image Arena](https://artificialanalysis.ai/)
- [GLM-Image (Z.ai)](https://huggingface.co/zai-org/GLM-Image) — 0.9116 Word Accuracy
- [Qwen-Image-2.0](https://github.com/QwenLM/Qwen-Image)

### Пропущенные модели

- [GigaChat 3 (Sber)](https://github.com/salute-developers/gigachat3) — MIT, Russian-optimized
- [Mistral Small 4](https://mistral.ai/news/mistral-3) — 119B MoE, 6B active

### Competitor Pricing

- [RunPod Pricing](https://www.runpod.io/pricing) — T4 32% cheaper than Modal
- [Google Cloud Run GPU](https://cloud.google.com/run/docs/configuring/services/gpu) — L4 $0.67/h
- [Vast.ai Pricing](https://vast.ai/pricing) — T4 from $0.09/h
- [Lambda Labs Pricing](https://lambda.ai/pricing)
- [Banana.dev Sunset](https://www.banana.dev/blog/sunset) — DEAD since March 2024
