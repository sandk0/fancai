# Modal Full AI Pipeline Research — fancai

**Дата:** 2026-03-25 (обновлено: актуализация моделей на 25 марта 2026)
**Scope:** Полное исследование оптимизации AI pipeline: image gen models, self-hosted LLM, Gemini API variants, Modal architecture
**Методология:** 5 параллельных исследовательских агентов с WebSearch (190+ запросов), анализ кода (8 файлов), production data
**Предыдущее исследование:** [`modal-gpu-migration-plan.md`](modal-gpu-migration-plan.md) (2026-03-24)

---

## A. Executive Summary

**Главный вывод: стоимость обработки книги можно снизить с $6.13 до $0.33-2.05 (67-95% экономия) с сохранением или улучшением качества.**

### Три прорывных находки

1. **Qwen3.5-9B или Qwen3.5-35B-A3B на Modal L4/A10G** может заменить Gemini Flash для extraction за **~$0.25-0.35/книга** вместо $5.12 (93-95% экономия). Qwen3.5 (февраль-март 2026) — на поколение новее Qwen3, 262K контекст, 201 язык. Требует A/B тестирования.

2. **Z-Image-Turbo 6B** (Alibaba) даёт качество сопоставимое с FLUX.2 [dev] 32B при стоимости **$0.0012/image** на A10G. Apache 2.0. Качественный апгрейд от FLUX.2 Klein без увеличения стоимости.

3. **Gemini Batch API + Flash-Lite** — безрисковая оптимизация: **$1.96/книга** (-62%) для LLM задач. Flash для extraction, Flash-Lite для translation/synthesis/dedup. Batch API = 50% скидка.

### Корректировка данных

Предыдущее исследование использовало **$2.90/книга** из bugged DB (`llm_usage_log` теряет 52-66% данных). Реальная стоимость из OpenRouter Management API: **$6.13/книга**. LLM = 83% стоимости (не 66%).

| Компонент             | OpenRouter Management API | DB (bugged)       | Потеряно |
| --------------------- | ------------------------- | ----------------- | -------- |
| LLM (Gemini Flash)    | **$5.12** (141 calls)     | $1.91 (121 calls) | 53%      |
| Images (FLUX.2 Klein) | **$1.01** (63 calls)      | $0.99 (62 calls)  | 2%       |
| **TOTAL**             | **$6.13**                 | $2.90             | **53%**  |

### Рекомендуемая архитектура

**Фаза 1 (безрисковая, неделя 1-2):** Gemini Batch API + Modal Images = **$2.05/книга** (-67%)
**Фаза 2 (после A/B теста, неделя 3-4):** Qwen3.5-9B + Z-Image-Turbo = **$0.25-0.35/книга** (-94-96%)

---

## B. Image Generation Models Deep Dive

### B.1 Полный landscape (март 2026)

| #   | Модель                    | Params  | GPU (Modal) | VRAM               | Время/img | $/image     | Quality | Лицензия         | Character Consistency                 |
| --- | ------------------------- | ------- | ----------- | ------------------ | --------- | ----------- | ------- | ---------------- | ------------------------------------- |
| 1   | **FLUX.2 [dev] 32B**      | 32B     | A100 80GB   | 24GB (4-bit)       | ~3-5s     | $0.003      | **10**  | NC (outputs OK)  | **Встроенная** (до 10 ref)            |
| 2   | **FLUX.2 Klein 4B** ⭐    | 4B      | **L4/A10G** | 13GB / 8GB fp8     | **<0.5s** | **$0.0006** | **8**   | **Apache 2.0**   | **Встроенная** (multi-ref)            |
| 3   | **FLUX.1 Kontext [dev]**  | 12B     | A100/L40S   | 24GB / 16GB        | ~2-4s     | $0.003      | **9**   | NC (open-weight) | **Встроенная** (до 10 ref)            |
| 4   | **OmniGen2**              | 7B      | A10G/L40S   | 17GB / 3GB offload | ~10-15s   | $0.004      | 7.5     | Open             | **Встроенная** (in-context)           |
| 5   | **ACE++** (на FLUX.1-dev) | 12B+    | A100/L40S   | 24GB+              | ~5-10s    | $0.004      | 8.5     | Open             | **Встроенная** (92.3% retention)      |
| 6   | **Z-Image-Turbo 6B**      | 6B      | A10G        | 16GB bf16          | ~3-4s     | $0.0012     | **8.5** | **Apache 2.0**   | Нет                                   |
| 7   | **HiDream I1 Fast**       | 17B MoE | A10G        | 18GB fp8           | ~15s      | $0.0046     | **9**   | MIT              | Нет                                   |
| 8   | HiDream I1 Dev            | 17B MoE | A100 40GB   | 18GB fp8           | ~18s      | $0.0105     | 9.5     | MIT              | Нет                                   |
| 9   | FLUX.1 Schnell 12B        | 12B     | A10G        | 13GB fp8           | ~5s       | $0.0015     | 7.5     | Apache 2.0       | LoRA (ограниченно)                    |
| 10  | **SANA 1.6B**             | 1.6B    | **T4**      | 8GB                | **<1s**   | **$0.0005** | 6.5     | Open (NVIDIA)    | Нет                                   |
| 11  | SD 3.5 Large 8B           | 8B      | A10G        | 16GB               | ~4-8s     | $0.002      | 7       | Community (<$1M) | IP-Adapter                            |
| 12  | SDXL Lightning            | 3.5B    | L4          | 8GB                | ~4s       | $0.0009     | 6       | openRAIL++       | **Лучшая экосистема** (LoRA+IP+PuLID) |
| 13  | Lumina-Image 2.0          | 2.6B    | L4/A10G     | 8-12GB             | ~3-5s     | $0.001      | 7       | Open             | Lumina-Accessory                      |
| 14  | PixArt-Sigma 0.6B         | 0.6B    | T4          | 4-8GB              | ~2-4s     | $0.0003     | 5.5     | RAIL++           | Нет                                   |

**Только API:** GPT Image 1.5 (#1 Arena), Midjourney V8 (--cref consistency), Qwen-Image 2.0 (#1 Arena open), Recraft V4, Ideogram 3.0.
**Не вышли:** Stable Diffusion 4 (не существует), Playground v3 (weights не опубликованы).

### B.2 Character Consistency — ключевая возможность

**КРИТИЧЕСКОЕ ОТКРЫТИЕ:** FLUX.2 Klein 4B (который мы **уже используем** через OpenRouter) имеет **встроенную multi-reference character consistency** — до 10 reference images. Через OpenRouter API эта функция **недоступна**. На Modal self-hosted — полный доступ через diffusers.

#### Модели с ВСТРОЕННОЙ consistency

| Модель                 | Метод                      | Кол-во ref images | Retention rate | Стоимость   | Лицензия       |
| ---------------------- | -------------------------- | ----------------- | -------------- | ----------- | -------------- |
| **FLUX.2 Klein 4B** ⭐ | Multi-reference            | До 10             | ~80-85%        | $0.0006/img | **Apache 2.0** |
| FLUX.2 [dev] 32B       | Multi-reference            | До 10             | ~90-95%        | $0.003/img  | NC             |
| FLUX.1 Kontext [dev]   | Character+style ref        | До 10             | ~85-90%        | $0.003/img  | NC             |
| OmniGen2               | In-context generation      | Произвольно       | ~80%           | $0.004/img  | Open           |
| ACE++                  | Zero-training from 1 image | 1                 | **92.3%**      | $0.004/img  | Open           |

#### Через дополнительные модули

| Технология         | Базовая модель | Retention | Скорость              | Сложность |
| ------------------ | -------------- | --------- | --------------------- | --------- |
| **PuLID**          | FLUX.1/SDXL    | Лучшее    | Средняя               | Средняя   |
| InstantID          | SD1.5/SDXL     | Хорошее   | Быстрая               | Низкая    |
| IP-Adapter FaceID  | SD3.5/SDXL     | Хорошее   | Быстрая               | Низкая    |
| LoRA per character | FLUX.2/SDXL    | **~95%+** | Нужен training (1-3ч) | Высокая   |

#### Pipeline для fancai (character consistency)

```
1. NER извлекает описание персонажа из текста
2. Генерируем 1 reference image через FLUX.2 Klein
3. Для каждой сцены — передаём reference + описание сцены
4. FLUX.2 Klein сохраняет identity персонажа автоматически
   (multi-reference через diffusers, НЕ через OpenRouter API)
```

**Это невозможно через OpenRouter** — только self-hosted на Modal раскрывает эту функцию.

### B.3 Рекомендация для fancai (обновлённая)

**Трёхуровневая стратегия с character consistency:**

| Tier                          | Модель           | GPU     | $/image | Consistency                | Назначение          |
| ----------------------------- | ---------------- | ------- | ------- | -------------------------- | ------------------- |
| **Standard + Consistency** ⭐ | FLUX.2 Klein 4B  | L4/A10G | $0.0006 | **Встроенная** (multi-ref) | Сцены с персонажами |
| **Quality (без ref)**         | Z-Image-Turbo 6B | A10G    | $0.0012 | Промпт-инжиниринг          | Локации, атмосфера  |
| **Premium**                   | HiDream I1 Fast  | A10G    | $0.0046 | Нет                        | Премиум подписчики  |

**Почему FLUX.2 Klein 4B — главный выбор:**

- **Встроенная character consistency** — единственная коммерческая модель с multi-reference
- Apache 2.0, <0.5s генерация на H100, ~1-2s на A10G
- 13GB VRAM — L4 достаточно
- **Уже используется** — минимальный риск миграции

**Гибридный pipeline:**

- Персонажи/портреты → FLUX.2 Klein с reference images
- Локации/атмосфера → Z-Image-Turbo (лучшее качество пейзажей)

### B.4 Стоимость image gen для "Перекрёстки сумерек" (63 images)

| Вариант                      | Cold start | Inference    | Total      | vs OpenRouter ($1.01) |
| ---------------------------- | ---------- | ------------ | ---------- | --------------------- |
| **OpenRouter FLUX.2 Klein**  | 0          | 63 × $0.016  | **$1.01**  | baseline              |
| **Modal FLUX.2 Klein L4**    | $0.007     | 63 × $0.0007 | **$0.051** | **-95%**              |
| **Modal Z-Image-Turbo A10G** | $0.018     | 63 × $0.0012 | **$0.094** | **-91%** (+ quality↑) |
| Modal HiDream Fast A10G      | $0.018     | 63 × $0.0046 | **$0.308** | -70% (+ quality↑↑)    |

---

## C. LLM Models для Extraction (актуализировано 25 марта 2026)

### C.1 Landscape актуальных open-weights моделей

#### Frontier MoE (multi-GPU, для справки)

| Модель            | Дата     | Params (total/active) | Контекст | Русский       | Лицензия      | GPU     |
| ----------------- | -------- | --------------------- | -------- | ------------- | ------------- | ------- |
| Qwen3.5-397B-A17B | Фев 2026 | 397B / 17B            | 262K     | Да (201 язык) | Apache 2.0    | 8x H200 |
| DeepSeek-V3.2     | Янв 2026 | 685B / 37B            | 163K     | Да            | MIT           | 4x H100 |
| GLM-5             | Фев 2026 | 744B / 40B            | 200K     | Да            | MIT           | 8x H100 |
| Llama 4 Maverick  | Апр 2025 | 400B / 17B            | 1M       | Да            | Llama License | 8x H100 |

_Все frontier MoE нереалистичны для Modal (слишком дорого). Для справки._

#### Средние и малые модели (1 GPU на Modal) — TOP PICKS

| Модель                 | Дата            | Params (total/active) | Контекст | Русский             | Лицензия       | Min GPU (Modal) | $/книга est. |
| ---------------------- | --------------- | --------------------- | -------- | ------------------- | -------------- | --------------- | ------------ |
| **Qwen3.5-35B-A3B** ⭐ | **24 Фев 2026** | 35B / **3B active**   | **262K** | Отличный (201 язык) | **Apache 2.0** | **L4 (24GB)**   | **~$0.15**   |
| **Qwen3.5-9B** ⭐      | **1 Мар 2026**  | 9B dense              | **262K** | Отличный (201 язык) | **Apache 2.0** | **L4 (24GB)**   | **~$0.25**   |
| Qwen3.5-122B-A10B      | 24 Фев 2026     | 122B / 10B            | 262K     | Отличный            | Apache 2.0     | A100 80GB       | ~$0.70       |
| Qwen3.5-27B            | 24 Фев 2026     | 27B dense             | 262K     | Отличный            | Apache 2.0     | A100 80GB       | ~$0.55       |
| **Qwen3.5-4B**         | 1 Мар 2026      | 4B dense              | 262K     | Очень хороший       | Apache 2.0     | **T4 (16GB)**   | **~$0.12**   |
| Ministral 3 14B        | Дек 2025        | 14B dense             | 256K     | Хороший             | Apache 2.0     | L4 (24GB)       | ~$0.30       |
| Mistral Small 3.2 24B  | Июн 2025        | 24B dense             | 256K     | Хороший             | Apache 2.0     | L40S (48GB)     | ~$0.85       |
| Gemma 3 27B            | Мар 2025        | 27B dense             | 128K     | Хороший             | Gemma License  | A100 / RTX 4090 | ~$0.45       |
| Gemma 3 12B            | Мар 2025        | 12B dense             | 128K     | Хороший             | Gemma License  | L4 (24GB)       | ~$0.35       |

**Отсеянные:**

- **Llama 4 Scout** — Llama License (ограничения >700M MAU), русский не приоритетный
- **Phi-4 Reasoning** — ограниченный русский, контекст N/A
- **Gemma 3** — баги с structured output в vLLM, русский хуже Qwen
- **DeepSeek V4 / R2** — анонсированы, но **не вышли** (все сроки пропущены)

### C.2 TOP 3 рекомендации для fancai

#### 1. Qwen3.5-35B-A3B — ЛУЧШИЙ ВЫБОР ⭐

MoE: 35B total, **только 3B активных параметров** → качество 35B при скорости 3B.

- L4 (24GB) с AWQ quantization — самый дешёвый GPU
- 262K контекст, Apache 2.0, 201 язык
- **~150-200 tok/sec** output (3B active = сверхбыстро)

```
С continuous batching (10 concurrent): ~500-800 tok/sec aggregate
270K output / 600 tok/sec = 450 sec + prefill + cold start ≈ 700 sec
Cost: 700 × $0.000222 = $0.155/книга
```

#### 2. Qwen3.5-9B — НАДЁЖНЫЙ ВЫБОР

Dense 9B, проверенная архитектура. Бьёт модели 30B предыдущего поколения.

- L4 (24GB) достаточно, 262K контекст
- **⚠️ Баг:** `enable_thinking=False` + guided_json — нужно тестировать

```
~60-80 tok/sec output, batch 8: ~300 tok/sec aggregate
270K / 300 = 900 sec + cold start ≈ 1100 sec
Cost: 1100 × $0.000222 = $0.244/книга
```

#### 3. Qwen3.5-4B — БЮДЖЕТНЫЙ ВЫБОР

T4 ($0.59/час) достаточно. Для translation/synthesis/dedup, не для extraction.

```
~$0.12/книга на T4
```

### C.3 Self-hosted vs Gemini: обновлённое сравнение

| Критерий          | Gemini 3.0 Flash            | **Qwen3.5-35B-A3B** (L4)         | **Qwen3.5-9B** (L4)  |
| ----------------- | --------------------------- | -------------------------------- | -------------------- |
| **$/книга**       | $5.12 (OR) / $4.86 (direct) | **~$0.15**                       | **~$0.25**           |
| Дата релиза       | 2025                        | **24 Фев 2026**                  | **1 Мар 2026**       |
| Русский           | Отличный                    | Отличный (201 язык, 35B quality) | Очень хороший        |
| Контекст          | 1M+                         | **262K**                         | **262K**             |
| Structured output | Нативный JSON Schema        | vLLM guided decoding             | vLLM guided decoding |
| Latency/запрос    | <1 сек                      | ~1-2 сек (3B active)             | ~3-5 сек             |
| Cold start        | 0                           | ~60-90 сек (snapshot: ~10 сек)   | ~45-60 сек           |
| **Экономия**      | baseline                    | **~97% дешевле**                 | **~95% дешевле**     |
| **Риск**          | Нулевой                     | Средний (A/B тест нужен)         | Средний              |

### C.4 Гибридная стратегия по задачам

| Задача                            | Best self-hosted               | Fallback                |
| --------------------------------- | ------------------------------ | ----------------------- |
| **Extraction** (quality-critical) | Qwen3.5-35B-A3B                | Gemini Batch Flash      |
| **Translation** (простая)         | Qwen3.5-4B (T4)                | Gemini Batch Flash-Lite |
| **Synthesis** (средняя)           | Qwen3.5-9B                     | Gemini Batch Flash-Lite |
| **Dedup**                         | Qwen3.5-9B или embedding-based | Gemini Batch Flash-Lite |

---

## D. Gemini Batch API Analysis

### D.1 Pricing

| Модель                | Standard Input | Standard Output | **Batch Input** | **Batch Output** |
| --------------------- | -------------- | --------------- | --------------- | ---------------- |
| Gemini 3.0 Flash      | $0.50          | $3.00           | **$0.25**       | **$1.50**        |
| Gemini 3.1 Flash-Lite | $0.25          | $1.50           | **$0.125**      | **$0.75**        |
| Gemini 2.5 Flash-Lite | $0.10          | $0.40           | **$0.05**       | **$0.20**        |

Batch API = **50% скидка** от стандартной цены для ВСЕХ моделей.

### D.2 Характеристики

| Параметр                    | Значение                                                  |
| --------------------------- | --------------------------------------------------------- |
| Latency (SLO)               | 24 часа max                                               |
| Latency (фактическая)       | **15 минут — 2 часа**                                     |
| Max batch size (inline)     | 20MB                                                      |
| Max batch size (JSONL file) | **2GB** (~100K+ requests)                                 |
| Structured output           | **Поддерживается** (response_mime_type + response_schema) |
| Partial failures            | Отдельный error status per request                        |
| SDK                         | `google-genai` Python SDK                                 |
| Вызов из Modal              | **Работает** (обычные HTTP)                               |
| SLA                         | **Нет** (SLO only — не гарантия)                          |

### D.3 Flash vs Flash-Lite: когда что использовать

| Задача                                       | Flash                     | Flash-Lite            | Рекомендация                    |
| -------------------------------------------- | ------------------------- | --------------------- | ------------------------------- |
| **Extraction** (TSA, entities, descriptions) | GPQA 80%, **FACTS 50.4%** | GPQA 87%, FACTS 40.6% | **Flash** (factuality критична) |
| **Translation** (RU→EN)                      | Overqualified             | Достаточно            | **Flash-Lite**                  |
| **Synthesis** (биографии, milestones)        | Качественно               | Достаточно            | **Flash-Lite**                  |
| **Dedup** (семантическое)                    | Качественно               | Достаточно            | **Flash-Lite**                  |

Flash-Lite на **10% хуже по factuality** (FACTS benchmark: 40.6% vs 50.4%) — это критично для extraction, но не для translation/synthesis.

### D.4 Gemini Direct API vs OpenRouter

| Feature                | Direct API    | OpenRouter              |
| ---------------------- | ------------- | ----------------------- |
| Platform fee           | 0%            | **5.5%**                |
| Batch API (50% скидка) | **Да**        | Нет                     |
| Context Caching        | **Да**        | Нет                     |
| Free tier              | 250-1000 RPD  | Нет                     |
| $defs/$ref support     | **Нативно**   | Требует \_inline_defs() |
| Fallback routing       | Нет           | **Автоматический**      |
| Multi-provider         | Только Google | Anthropic, Google, etc. |

### D.5 Стоимость LLM для "Перекрёстки сумерек" (142 calls)

Расчёт на основе обратной калибровки от $5.12 реальной стоимости:

| Сценарий                       | Extraction | Translation | Synthesis | Dedup | Прочие | **Total** | **Savings** |
| ------------------------------ | ---------- | ----------- | --------- | ----- | ------ | --------- | ----------- |
| **OR Flash (текущее)**         | $3.07      | $0.37       | $0.77     | $0.64 | $0.28  | **$5.12** | —           |
| **Direct Flash**               | $2.92      | $0.35       | $0.73     | $0.61 | $0.27  | **$4.86** | -5%         |
| **Direct hybrid (Flash+Lite)** | $2.92      | $0.18       | $0.37     | $0.31 | $0.14  | **$3.91** | -24%        |
| **Batch Flash**                | $1.46      | $0.18       | $0.37     | $0.31 | $0.14  | **$2.44** | -52%        |
| **Batch hybrid (Flash+Lite)**  | $1.46      | $0.09       | $0.19     | $0.16 | $0.07  | **$1.96** | **-62%**    |
| **Batch Flash-Lite all**       | $0.73      | $0.09       | $0.19     | $0.16 | $0.07  | **$1.23** | -76%        |
| **Batch 2.5 Flash-Lite all**   | $0.34      | $0.03       | $0.06     | $0.05 | $0.02  | **$0.50** | -90%        |

---

## E. Full Pipeline on Modal Architecture

### E.1 Рекомендуемая архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     VPS (32GB, 12 vCPU)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ FastAPI   │  │ Celery Worker│  │ PostgreSQL + Redis│  │
│  └─────┬────┘  └──────┬───────┘  └───────────────────┘  │
│        │              │                                  │
└────────┼──────────────┼──────────────────────────────────┘
         │              │
    ┌────┴──────────────┴──────────────────────────────┐
    │              Modal (serverless GPU)                │
    │                                                   │
    │  ┌──────────────────────┐  ┌───────────────────┐  │
    │  │ L4 GPU:                │  │ A10G GPU:          │  │
    │  │ Qwen3.5-35B-A3B (LLM) │  │ Z-Image-Turbo 6B  │  │
    │  │ vLLM + structured      │  │ diffusers pipeline │  │
    │  │ ~$0.15/книга           │  │ ~$0.094/книга      │  │
    │  └──────────────────────┘  └───────────────────┘  │
    │                                                   │
    │  ┌──────────────────────┐                         │
    │  │ T4 GPU (опционально):│                         │
    │  │ GLiNER2 NER (205M)  │                         │
    │  │ ~$0.015/книга        │                         │
    │  └──────────────────────┘                         │
    │                                                   │
    │  EU region, scale-to-zero, $30/мес free tier      │
    └───────────────────────────────────────────────────┘

    ┌──────────────────┐
    │ Gemini Batch API │  ← Fallback / safe path
    │ Flash + Lite     │
    │ ~$1.96/книга     │
    └──────────────────┘

    ┌──────────────────┐
    │ OpenRouter       │  ← Emergency fallback
    │ (сохраняется)    │
    └──────────────────┘
```

### E.2 Modal App Design

**3 отдельных класса** (раздельное масштабирование, разные GPU):

```python
# backend/modal_app/pipeline.py
import modal

app = modal.App("fancai-gpu")
vol = modal.Volume.from_name("fancai-models", create_if_missing=True)

# --- LLM Extraction (Qwen3.5-35B-A3B MoE on L4) ---
llm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.17", "transformers", "torch")
)

@app.cls(
    image=llm_image,
    gpu="L4",
    volumes={"/models": vol},
    scaledown_window=300,  # 5 мин warm для burst
    timeout=600,
    region="eu",
)
class LLMExtractor:
    @modal.enter()
    def setup(self):
        from vllm import LLM
        self.llm = LLM(
            model="Qwen/Qwen3.5-35B-A3B",  # MoE: 35B total, 3B active
            download_dir="/models",
            max_model_len=32768,
            gpu_memory_utilization=0.90,
        )

    @modal.method()
    def extract_chapters(self, chapters: list[dict]) -> list[dict]:
        """Batch extraction: список глав → список structured JSON."""
        from vllm import SamplingParams
        prompts = [ch["prompt"] for ch in chapters]
        params = SamplingParams(
            temperature=0.1,
            max_tokens=8192,
            # guided decoding для JSON Schema
        )
        outputs = self.llm.generate(prompts, params)
        return [{"chapter_id": ch["id"], "result": o.outputs[0].text}
                for ch, o in zip(chapters, outputs)]

# --- Image Generation (Z-Image-Turbo on A10G) ---
img_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch", "diffusers", "transformers", "accelerate")
)

@app.cls(
    image=img_image,
    gpu="A10G",
    volumes={"/models": vol},
    scaledown_window=120,
    timeout=300,
    region="eu",
)
class ImageGenerator:
    @modal.enter()
    def setup(self):
        import torch
        from diffusers import DiffusionPipeline
        self.pipe = DiffusionPipeline.from_pretrained(
            "Tongyi-MAI/Z-Image-Turbo",
            torch_dtype=torch.bfloat16,
            cache_dir="/models",
        ).to("cuda")

    @modal.method()
    def generate_batch(self, prompts: list[str],
                       width: int = 1024, height: int = 768) -> list[bytes]:
        import io
        results = []
        for prompt in prompts:
            image = self.pipe(
                prompt, width=width, height=height,
                num_inference_steps=8, guidance_scale=3.5,
            ).images[0]
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            results.append(buf.getvalue())
        return results
```

### E.3 Celery Integration (VPS side)

```python
# backend/app/tasks/modal_tasks.py
import modal

@celery_app.task(bind=True, max_retries=3)
def process_book_modal(self, book_id: str):
    """Process book via Modal pipeline."""
    try:
        # Вызов Modal function из Celery
        extractor = modal.Cls.from_name("fancai-gpu", "LLMExtractor")
        chapters = _prepare_chapters(book_id)

        # Batch extraction
        results = extractor().extract_chapters.remote(chapters)
        _save_extraction_results(book_id, results)

        # Batch image generation
        img_gen = modal.Cls.from_name("fancai-gpu", "ImageGenerator")
        prompts = _prepare_image_prompts(book_id)
        images = img_gen().generate_batch.remote(prompts)
        _save_images(book_id, images)

    except modal.exception.FunctionTimeoutError:
        raise self.retry(countdown=120)
```

### E.4 Data Flow

- **VPS → Modal:** `Cls.from_name().method.remote(data)` (синхронный из Celery worker)
- **Modal → VPS:** return values (JSON результаты, image bytes)
- **PostgreSQL:** Celery worker пишет результаты локально (не открываем DB наружу)
- **Redis:** используется на VPS для кэширования и лока

### E.5 Cold Start Optimization

| Метод                      | Без оптимизации        | С оптимизацией | Ускорение      |
| -------------------------- | ---------------------- | -------------- | -------------- |
| GPU Memory Snapshot        | 30-60 сек (model load) | ~5-15 сек      | 3-5x           |
| `scaledown_window=300`     | cold start каждый раз  | warm для burst | batch-friendly |
| Modal Volume (model cache) | download каждый раз    | cached read    | 10-30x         |

```python
# GPU Memory Snapshot (для production)
@app.cls(
    gpu="L4",
    experimental_options={"enable_gpu_snapshot": True},
)
```

---

## F. Cost Comparison Table (6 сценариев)

### F.1 Стоимость за 1 книгу "Перекрёстки сумерек" (50 глав, 63 images, 198 entities)

| Компонент           | S1: Текущее      | S2: Modal Img           | S3: Gemini Direct       | S4: Gemini Batch        | S5: Full Modal           | S6: Best Hybrid         |
| ------------------- | ---------------- | ----------------------- | ----------------------- | ----------------------- | ------------------------ | ----------------------- |
| **LLM extraction**  | $3.07 (OR Flash) | $3.07                   | $2.92 (Direct Flash)    | $1.46 (Batch Flash)     | ~$0.10 (Qwen3.5-35B-A3B) | $1.46 (Batch Flash)     |
| **LLM synthesis**   | $0.77            | $0.77                   | $0.37 (Direct Lite)     | $0.19 (Batch Lite)      | ~$0.02 (Qwen3.5-9B)      | $0.19 (Batch Lite)      |
| **LLM dedup**       | $0.64            | $0.64                   | $0.31 (Direct Lite)     | $0.16 (Batch Lite)      | ~$0.01 (Qwen3.5-9B)      | $0.16 (Batch Lite)      |
| **LLM translation** | $0.37            | $0.37                   | $0.18 (Direct Lite)     | $0.09 (Batch Lite)      | ~$0.01 (Qwen3.5-4B)      | $0.09 (Batch Lite)      |
| **LLM прочие**      | $0.28            | $0.28                   | $0.14 (Direct Lite)     | $0.07 (Batch Lite)      | ~$0.01 (Qwen3.5-4B)      | $0.07 (Batch Lite)      |
| **Images**          | $1.01 (OR FLUX)  | **$0.05** (Modal Klein) | **$0.09** (Modal Z-Img) | **$0.09** (Modal Z-Img) | **$0.09** (Modal Z-Img)  | **$0.09** (Modal Z-Img) |
| **NER**             | $0 (CPU)         | $0 (CPU)                | $0 (CPU)                | $0 (CPU)                | $0.015 (Modal T4)        | $0 (CPU)                |
| **Modal overhead**  | $0               | $0.01                   | $0.02                   | $0.02                   | $0.04                    | $0.02                   |
|                     |                  |                         |                         |                         |                          |                         |
| **TOTAL**           | **$6.13**        | **$5.18**               | **$4.02**               | **$2.07**               | **~$0.29**               | **$2.07**               |
| **Savings**         | —                | -16%                    | **-34%**                | **-66%**                | **-95%**                 | **-66%**                |
| **Время**           | 59 мин           | ~55 мин                 | ~50 мин                 | 30-120 мин\*            | **~12 мин**              | 30-120 мин\*            |
| **Риск**            | Нулевой          | Низкий                  | Низкий                  | Низкий                  | **Средний**              | Низкий                  |

\*Batch API: 15 мин — 2 часа реальная задержка (SLO 24ч), не подходит для real-time.

### F.2 Масштабирование: месячные затраты

| Масштаб           | S1: Текущее | S2: Modal Img   | S4: Batch Hybrid | S5: Full Modal   | S6: Best Hybrid |
| ----------------- | ----------- | --------------- | ---------------- | ---------------- | --------------- |
| **10 книг/мес**   | $61         | $52             | $21              | **$3**           | $21             |
| **50 книг/мес**   | $307        | $259            | $104             | **$15**          | $104            |
| **200 книг/мес**  | $1,226      | $1,036          | $414             | **$58**          | $414            |
| **500 книг/мес**  | $3,065      | $2,590          | $1,035           | **$145**         | $1,035          |
|                   |             |                 |                  |                  |                 |
| **Modal GPU/мес** | $0          | ~$2             | ~$5              | **~$20**         | ~$5             |
| **В free tier?**  | N/A         | **Да** ($2/$30) | **Да** ($5/$30)  | **Да** ($20/$30) | **Да** ($5/$30) |

**Все сценарии укладываются в Modal free tier ($30/мес) до ~500 книг/мес.**

### F.3 При каком объёме Full Modal превышает free tier?

```
$30 / $0.048 modal-cost/book ≈ 625 книг/мес — лимит free tier для S5
$30 / $0.01 modal-cost/book ≈ 3000 книг/мес — лимит free tier для S2
```

---

## G. Quality Comparison

### G.1 Image Generation Quality

| Модель                    | Fantasy Illustration | Character Portrait | Atmosphere | Text Render |
| ------------------------- | -------------------- | ------------------ | ---------- | ----------- |
| FLUX.2 Klein 4B (текущее) | ★★★☆☆                | ★★★☆☆              | ★★★☆☆      | ★★☆☆☆       |
| **Z-Image-Turbo 6B**      | **★★★★☆**            | **★★★★☆**          | **★★★★☆**  | **★★★★☆**   |
| HiDream I1 Fast           | ★★★★★                | ★★★★☆              | ★★★★★      | ★★★★★       |
| FLUX.1 Schnell 12B        | ★★★★☆                | ★★★☆☆              | ★★★★☆      | ★★★☆☆       |
| FLUX.2 [dev] 32B          | ★★★★★                | ★★★★★              | ★★★★★      | ★★★★★       |

**Рекомендация:** Z-Image-Turbo — значительный upgrade от Klein с минимальным увеличением стоимости ($0.0012 vs $0.0007).

### G.2 LLM Extraction Quality

| Модель                         | Structured JSON | Русские имена | Локации | Relationships | Длинный контекст |
| ------------------------------ | --------------- | ------------- | ------- | ------------- | ---------------- |
| **Gemini 3.0 Flash**           | ★★★★★           | ★★★★★         | ★★★★★   | ★★★★☆         | ★★★★★ (1M)       |
| **Gemini 3.1 Flash-Lite**      | ★★★★☆           | ★★★★☆         | ★★★★☆   | ★★★☆☆         | ★★★★★ (1M)       |
| **Qwen3.5-35B-A3B** (Мар 2026) | ★★★★★           | ★★★★★         | ★★★★★   | ★★★★☆         | ★★★★★ (262K)     |
| **Qwen3.5-9B** (Мар 2026)      | ★★★★☆           | ★★★★☆         | ★★★★☆   | ★★★☆☆         | ★★★★★ (262K)     |
| Qwen3.5-4B (Мар 2026)          | ★★★☆☆           | ★★★☆☆         | ★★★☆☆   | ★★☆☆☆         | ★★★★★ (262K)     |
| Gemma 3 12B (Мар 2025)         | ★★★★☆           | ★★★☆☆         | ★★★★☆   | ★★★☆☆         | ★★★★☆ (128K)     |

**Ключевое преимущество Qwen3.5-35B-A3B:** MoE с 35B quality при 3B скорости. 201 язык (русский в числе приоритетных). 262K контекст (vs 128K у Qwen3). **A/B тестирование обязательно** перед production. Baseline: 86.84% entity recall.

### G.3 Tiered Approach (рекомендуемый)

| Задача                            | Модель                                 | Обоснование                    |
| --------------------------------- | -------------------------------------- | ------------------------------ |
| **Extraction** (quality-critical) | Qwen3.5-35B-A3B ИЛИ Gemini Batch Flash | 35B quality, 3B speed          |
| **Translation** (простая)         | Qwen3.5-4B ИЛИ Gemini Batch Flash-Lite | Минимальные требования         |
| **Synthesis** (средняя)           | Qwen3.5-9B ИЛИ Gemini Batch Flash-Lite | Cost-effective                 |
| **Dedup** (средняя)               | Qwen3.5-9B ИЛИ embedding-based         | Можно заменить на embeddings   |
| **Images**                        | Modal Z-Image-Turbo                    | Quality upgrade + 91% экономия |

---

## H. Recommended Architecture

### Фаза 1: Безрисковая оптимизация (Неделя 1-2)

**Цель: $6.13 → $2.07/книга (-66%), без риска качества**

1. **Modal Images** — Z-Image-Turbo на A10G
   - Feature flag `USE_MODAL_IMAGES=false`
   - A/B visual quality test
   - Fallback: OpenRouter FLUX.2 Klein

2. **Gemini Batch API** — Flash для extraction, Flash-Lite для остального
   - Requires: `GOOGLE_API_KEY` (direct Gemini API)
   - Batch all 142 calls per book в 1-2 jobs
   - Feature flag `USE_GEMINI_BATCH=false`
   - Fallback: OpenRouter (текущее)

**Результат:** $2.07/книга, free tier покрывает >500 книг/мес.

### Фаза 2: Self-hosted LLM (Неделя 3-4)

**Цель: $2.07 → $0.29/книга (-86%), требует валидации качества**

3. **Modal Qwen3.5-35B-A3B** на L4 для extraction (MoE: 35B quality, 3B speed)
   - Deploy vLLM v0.17+ на Modal
   - A/B тест на 5-10 книгах vs Gemini Flash
   - Метрики: entity recall, description quality, JSON schema compliance
   - Feature flag `USE_MODAL_LLM=false`
   - Fallback: Gemini Batch API (Фаза 1)
   - Дополнительно: Qwen3.5-4B на T4 для translation

**Результат:** ~$0.29/книга, ~12 мин обработки.

### Фаза 3: Оптимизации (Неделя 5+)

4. **GPU Memory Snapshots** — холодный старт < 15 сек
5. **NER на Modal T4** — разгрузка VPS CPU
6. **Embedding-based dedup** — замена LLM dedup на sentence-transformers
7. **Character consistency** — мониторинг IP-Adapter для Z-Image-Turbo

---

## I. Migration Plan (детальный)

### Phase 1, Step 1: Modal Images (Дни 1-3)

**Файлы для изменения:**

- NEW: `backend/modal_app/__init__.py`
- NEW: `backend/modal_app/image_gen.py` — Modal Z-Image-Turbo app
- EDIT: `backend/app/services/imagen_generator.py` — добавить Modal path
- EDIT: `backend/app/core/config.py` — `USE_MODAL_IMAGES` setting
- EDIT: `backend/requirements.txt` — добавить `modal`

**Тестирование:**

1. `modal deploy backend/modal_app/image_gen.py`
2. `modal run backend/modal_app/image_gen.py` — smoke test
3. Visual comparison: Modal Z-Image vs OpenRouter FLUX Klein (10 промптов)
4. Feature flag ON для dev, OFF для production
5. A/B на 1 книге → visual inspection

### Phase 1, Step 2: Gemini Batch API (Дни 3-5)

**Файлы для изменения:**

- NEW: `backend/app/core/gemini_batch_client.py` — Batch API wrapper
- EDIT: `backend/app/core/config.py` — `GOOGLE_API_KEY`, `USE_GEMINI_BATCH`
- EDIT: `backend/app/services/gemini_extractor.py` — batch path
- EDIT: `backend/app/services/entity_synthesis_service.py` — Flash-Lite model
- EDIT: `backend/app/services/entity_deduplication_service.py` — Flash-Lite model
- EDIT: `backend/app/services/imagen_generator.py` — Flash-Lite for translation
- EDIT: `backend/requirements.txt` — добавить `google-genai`

**Тестирование:**

1. Получить Google API key: [ai.google.dev](https://ai.google.dev)
2. Test extraction quality: Batch Flash vs OpenRouter Flash (10 глав)
3. Test Flash-Lite quality: translation, synthesis, dedup (same book)
4. Compare entity recall with baseline (86.84%)

### Phase 2: Self-hosted LLM (Дни 6-10)

**Файлы:**

- NEW: `backend/modal_app/llm_extraction.py` — vLLM on Modal
- EDIT: `backend/app/services/gemini_extractor.py` — Modal LLM path
- EDIT: `backend/app/core/config.py` — `USE_MODAL_LLM`

**A/B Protocol:**

1. Обработать 5 книг через обе системы (Gemini + Qwen3.5-35B-A3B)
2. Сравнить: entity count, entity names, description quality
3. Acceptance criteria: ≥85% entity recall, ≥90% JSON schema compliance
4. If pass → gradual rollout (10% → 50% → 100%)
5. **⚠️ Проверить:** `enable_thinking=False` + guided_json баг в vLLM для Qwen3.5

### Monitoring Checklist

- [ ] Modal workspace budget limit: $30
- [ ] Prometheus метрика: `modal_inference_duration_seconds`
- [ ] Feature flag dashboard: `USE_MODAL_IMAGES`, `USE_GEMINI_BATCH`, `USE_MODAL_LLM`
- [ ] LlmUsageLog: записывать Modal costs (fix fire-and-forget bug)
- [ ] A/B results tracking table in PostgreSQL
- [ ] Alerting: Modal function timeout > 2 min

---

## J. Источники

### Gemini API & Pricing

- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Batch API Documentation](https://ai.google.dev/gemini-api/docs/batch-api)
- [Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini 3.1 Flash-Lite Blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)
- [Gemini 3.1 Flash-Lite Model Card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/)
- [Flash-Lite vs Flash Comparison](https://blog.getbind.co/gemini-3-1-flash-lite-vs-3-0-flash-vs-3-1-pro-how-do-they-compare/)
- [OpenRouter Pricing & Fee](https://openrouter.ai/pricing)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

### Image Generation Models (актуализировано март 2026)

- [FLUX.2 Models — BFL](https://bfl.ai/models/flux-2)
- [FLUX.2 Klein 4B — HuggingFace](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [FLUX.2 Klein Multi-Reference Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)
- [FLUX.1 Kontext — BFL](https://bfl.ai/models/flux-kontext)
- [FLUX.2 Hardware Requirements — DeepWiki](https://deepwiki.com/black-forest-labs/flux2/2.3-hardware-requirements)
- [FLUX.2 LoRA Training Guide 2026](https://kgabeci.medium.com/flux-2-lora-training-the-complete-2026-guide)
- [Z-Image-Turbo — HuggingFace](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
- [HiDream I1 — GitHub](https://github.com/HiDream-ai/HiDream-I1)
- [OmniGen2 — GitHub](https://github.com/VectorSpaceLab/OmniGen2)
- [ACE++ — GitHub](https://github.com/ali-vilab/ACE_plus)
- [SANA — NVIDIA](https://nvlabs.github.io/Sana/)
- [HunyuanImage 3.0 — GitHub](https://github.com/Tencent-Hunyuan/HunyuanImage-3.0)
- [Lumina-Image 2.0 — GitHub](https://github.com/Alpha-VLLM/Lumina-Image-2.0)
- [Modal FLUX deployment](https://modal.com/docs/examples/flux)
- [Modal Kontext deployment](https://modal.com/docs/examples/image_to_image)

### Character Consistency

- [FLUX.2 Multi-Reference Documentation](https://bfl.ai/models/flux-2)
- [ACE++ Paper — 92.3% retention](https://arxiv.org/html/2501.02487v3)
- [PuLID vs InstantID vs FaceID](https://myaiforce.com/pulid-vs-instantid-vs-faceid/)
- [StoryDiffusion](https://storydiffusion.com/)
- [Character Consistency Solved — 2026](https://aistorybook.app/blog/ai-image-generation/character-consistency-in-ai-art-solved)
- [Best AI for Character Consistency 2026](https://toonystory.com/blog/best-ai-for-character-consistency-2026)
- [LM Arena Image Rankings 2026](https://wavespeed.ai/blog/posts/lm-arena-text-to-image-rankings-2026/)

### Self-hosted LLM (актуализировано март 2026)

- [Qwen3.5 GitHub](https://github.com/QwenLM/Qwen3.5)
- [Qwen3.5-35B-A3B on HuggingFace](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- [Qwen3.5 Small Series (Medium)](https://medium.com/data-science-in-your-pocket/qwen-3-5-small-model-series-released-7a5ed34fcbb3)
- [Qwen3.5 vLLM Guide](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [DeepSeek-V3.2 on HuggingFace](https://huggingface.co/deepseek-ai/DeepSeek-V3.2)
- [Llama 4 (Meta)](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)
- [Mistral 3 (Mistral AI)](https://mistral.ai/news/mistral-3)
- [GLM-5 on HuggingFace](https://huggingface.co/zai-org/GLM-5)
- [Best LLM for Russian (SiliconFlow)](https://www.siliconflow.com/articles/en/best-open-source-LLM-for-Russian)
- [MERA Russian Benchmark](https://github.com/ai-forever/MERA)
- [vLLM v0.17.1 (11 мар 2026)](https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/index.html)
- [vLLM Structured Output](https://docs.vllm.ai/en/latest/features/structured_outputs.html)
- [Modal vLLM Deployment](https://modal.com/blog/how-to-deploy-vllm)
- [Structured Output 2026 (DEV)](https://dev.to/pockit_tools/llm-structured-output-in-2026-stop-parsing-json-with-regex-and-do-it-right-34pk)
- [Best Open Source LLMs 2026 (BentoML)](https://www.bentoml.com/blog/navigating-the-world-of-open-source-large-language-models)

### Modal Platform

- [Modal Pricing](https://modal.com/pricing)
- [Modal Cold Start](https://modal.com/docs/guide/cold-start)
- [GPU Memory Snapshots](https://modal.com/blog/gpu-mem-snapshots)
- [Modal Volumes](https://modal.com/docs/guide/volumes)
- [Modal 1.0 Migration](https://modal.com/docs/guide/modal-1-0-migration)
- [Modal Lifecycle Functions](https://modal.com/docs/guide/lifecycle-functions)
- [Modal Scaling](https://modal.com/docs/guide/scale)
- [Modal Region Selection](https://modal.com/docs/guide/region-selection)

### Character Consistency

- [IP-Adapter for FLUX](https://huggingface.co/InstantX/FLUX.1-dev-IP-Adapter)
- [Character Consistency Guide 2025](https://skywork.ai/blog/how-to-keep-ai-images-consistent-reference-images-attribute-locking-guide/)

### Предыдущие исследования fancai

- [`modal-gpu-migration-plan.md`](modal-gpu-migration-plan.md) — первичное исследование Modal (2026-03-24)
- [`self-hosted-llm-structured-extraction-2026-03.md`](self-hosted-llm-structured-extraction-2026-03.md) — детальный анализ LLM моделей
- [`modal-full-pipeline-architecture.md`](modal-full-pipeline-architecture.md) — архитектура Modal pipeline
- [`gliner2-inference-AUDIT.md`](gliner2-inference-AUDIT.md) — GLiNER2 NER benchmark
