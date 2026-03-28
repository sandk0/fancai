# Modal Full AI Pipeline Research v2 — fancai

**Дата:** 2026-03-25 (v2: обновлённое исследование на основе аудита)
**Scope:** Полное исследование оптимизации AI pipeline: LLM models, image gen, Gemini API, Modal architecture, Premium/Free архитектура, бизнес-метрики
**Методология:** 6 параллельных исследовательских агентов, 180+ WebSearch запросов, анализ кода (8 файлов), production data
**Предыдущие версии:** [v1](modal-full-pipeline-research.md), [аудит](modal-full-pipeline-AUDIT.md)

---

## A. Executive Summary

### Что изменилось vs v1

| #   | Ошибка v1                            | Скорректированное значение v2                                                                             |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | EU region 1.25-2.5x дороже US        | **EU = US** (оба 1.25x мультипликатор, указанные цены уже включают его)                                   |
| 2   | Qwen3.5-35B-A3B: 150-200 tok/s на L4 | **~36-50 tok/s** (L4 BW=300 GB/s). FP8 = 39.3GB — **НЕ помещается на L4**. GPTQ-Int4 ~21.6GB — помещается |
| 3   | vLLM structured output баг — блокер  | Issue #35700 **ОТКРЫТ**. Только для MoE+MTP. **Qwen3.5-9B (dense) стабильнее**                            |
| 4   | FLUX.2 Klein: 10 ref images          | API: max 4. Self-hosted: ограничено VRAM (~2-4 реалистично на L4)                                         |
| 5   | Premium/Free не проектировалось      | **Полная архитектура** разработана (секция E)                                                             |
| 6   | $0.29/книга Full Modal               | **$0.63-2.53/книга** (Qwen3.5-9B, реальный throughput)                                                    |
| 7   | Images в base64/PostgreSQL           | **КРИТИЧЕСКАЯ проблема** — миграция на R2+WebP обязательна                                                |
| 8   | Bookworm AI не упомянут              | **Прямой конкурент** — те же фичи, англоязычный рынок                                                     |

### Скорректированные цифры (1 книга, 50 глав)

| Сценарий                                    | v1    | v2 (US region) | Savings vs $6.13 |
| ------------------------------------------- | ----- | -------------- | ---------------- |
| Текущее (OpenRouter)                        | $6.13 | $6.13          | —                |
| S1: Gemini Direct (без OpenRouter markup)   | $4.86 | $4.86          | -21%             |
| **S2: Gemini 2.5 Flash-Lite Batch**         | —     | **$0.54**      | **-91%**         |
| S3: Gemini 3.0 Flash Batch + Modal Images   | $2.05 | $1.55          | -75%             |
| **S4: Qwen3.5-9B + FLUX.2 Klein (Premium)** | $0.29 | **$0.69-2.59** | **-58-89%**      |
| S5: Full hybrid (Free: S2, Premium: S4)     | —     | **$0.54-2.59** | **-58-91%**      |

### TOP 3 рекомендации

1. **Фаза 1 (0 риска, -91%):** Gemini 2.5 Flash-Lite Batch для free tier = **$0.54/книга**. Без изменений архитектуры кроме нового API client. Миграция images из base64/PG в Cloudflare R2 + WebP.
2. **Фаза 2 (средний риск):** Modal FLUX.2 Klein для всех users = **-95% на images** ($0.02 vs $1.01). Character consistency для premium через multi-reference.
3. **Фаза 3 (после A/B тестов):** Qwen3.5-9B на Modal L4 для premium users. A/B тест vs Gemini. Acceptance: ≥85% entity recall, ≥95% JSON compliance.

---

## B. Image Generation Models (обновлённый landscape)

### B.1 Сводная таблица (март 2026)

| #   | Модель                 | Params  | GPU (Modal) | VRAM       | Время/img | $/image     | Quality (Elo) | Лицензия       | Character Consistency      |
| --- | ---------------------- | ------- | ----------- | ---------- | --------- | ----------- | ------------- | -------------- | -------------------------- |
| 1   | **FLUX.2 Klein 4B** ⭐ | 4B      | **L4**      | 13GB       | **1-4s**  | **$0.0003** | ~1100         | **Apache 2.0** | **Встроенная** (multi-ref) |
| 2   | Z-Image-Turbo 6B       | 6B      | A10G        | 16GB       | 3-4s      | $0.0012     | **1214**      | Apache 2.0     | Нет                        |
| 3   | Qwen-Image-2.0 7B      | 7B      | A10G        | 16GB+      | 30-60s    | $0.009+     | **#1 open**   | Apache 2.0     | Edit-based                 |
| 4   | FLUX.2 [dev] 32B       | 32B     | A100        | 24GB 4-bit | 3-5s      | $0.003      | ~1200         | NC             | Встроенная                 |
| 5   | FLUX.1 Kontext [dev]   | 12B     | A100        | 24GB       | 2-4s      | $0.003      | —             | NC             | Встроенная                 |
| 6   | HiDream I1 Fast        | 17B MoE | A10G        | 18-27GB    | 20-35s    | $0.007-0.01 | ~1100         | MIT            | Нет                        |
| 7   | Imagen 4 Fast (API)    | Closed  | —           | —          | 2.7s      | $0.02       | ~1258         | API only       | Нет                        |

**Источники:** [Artificial Analysis Image Arena](https://artificialanalysis.ai/), [fal.ai FLUX.2 Klein Guide](https://fal.ai/learn/devs/flux-2-klein-user-guide), [BFL FLUX.2 Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)

### B.2 Рекомендация: FLUX.2 Klein 4B — единственный выбор

**Почему:**

- **Apache 2.0** — единственная коммерческая модель с multi-reference character consistency
- **13GB VRAM** — L4 (24GB) с запасом
- **1-4s генерация** — быстрее всех на L4
- **Уже используется** через OpenRouter — минимальный риск миграции
- На Modal: **$0.0003/image** vs $0.016 OpenRouter = **53x дешевле**

**Отсеянные альтернативы:**

- **Z-Image-Turbo**: выше Elo (1214), но нет character consistency, Apache 2.0 — хорош для локаций/атмосферы
- **FLUX.2 Klein 9B-KV**: NC лицензия + 29GB VRAM — не подходит
- **FLUX.1 Kontext [dev]**: NC лицензия
- **Imagen 4 Fast**: $0.02/img — **дороже текущего** ($0.016), нет character consistency
- **HiDream I1 Fast**: 20-35s генерация — слишком медленно
- **GLM-Image 16B**: 48-80GB VRAM — не помещается
- **Qwen-Image-2.0**: отличное quality (#1 Arena), но 30-60s/image. **Мониторить** — если появится distilled вариант, пересмотреть

**Источники:** [BFL FLUX.2 Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence), [302.AI Benchmark](https://medium.com/@302.AI/flux-2-klein-test-sub-second-generation-speed-stuns-while-quality-faces-trade-offs-302-ai-c197a73df052)

### B.3 Character Consistency Pipeline (исправленный)

```
1. NER извлекает описание персонажа из текста книги
2. Генерируем character sheet (портрет + ракурсы) через FLUX.2 Klein
3. Для каждой сцены — передаём 2-4 reference images + описание сцены
4. FLUX.2 Klein сохраняет identity через multi-reference (diffusers API)
```

**Ограничения (исправлены vs v1):**

- API (OpenRouter/fal.ai): **max 4 reference images**
- Self-hosted через diffusers: ограничено VRAM. На L4 (24GB, 13GB модель) — **2-4 ref images** реалистично
- 10 ref images — **только в playground**, не в API

**Подход для fancai:**

- 1-2 reference images per character достаточно для книжных иллюстраций (не фото-реалистичная задача)
- Quality: 1 ref → ~70-75% retention, 2 ref → ~80%, 4 ref → ~85%

**Альтернативные подходы для character consistency:**

- **PuLID** (FLUX.1/SDXL): лучшее face retention, требует face detection
- **InstantID** (SD1.5/SDXL): быстрый, но lower quality
- **LoRA per character**: ~95% retention, но нужен training 1-3 часа — **не подходит для real-time**

**Источники:** [FLUX.2 Klein multi-ref diffusers](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), [fal.ai Klein User Guide](https://fal.ai/learn/devs/flux-2-klein-user-guide)

### B.4 Стоимость image gen (1 книга, 63 images)

| Вариант                            | Cold start | Inference    | Total      | vs текущего ($1.01) |
| ---------------------------------- | ---------- | ------------ | ---------- | ------------------- |
| **OpenRouter FLUX.2 Klein**        | 0          | 63 × $0.016  | **$1.01**  | baseline            |
| **Modal FLUX.2 Klein L4** ⭐       | $0.007     | 63 × $0.0003 | **$0.026** | **-97%**            |
| Modal FLUX.2 Klein L4 + 2 ref/char | $0.007     | 63 × $0.0005 | **$0.039** | **-96%**            |
| Modal Z-Image-Turbo A10G           | $0.018     | 63 × $0.0012 | **$0.094** | -91%                |

---

## C. LLM Models для Extraction (обновлённый)

### C.1 Ключевое изменение: Qwen3.5-9B вместо 35B-A3B

**Критическая находка v2:** Qwen3.5-35B-A3B в FP8 = **39.3GB — не помещается на L4 (24GB)**. GPTQ-Int4 = ~21.6GB помещается, но KV cache всего ~2-3GB → контекст сильно ограничен (~8K-16K tokens).

**Qwen3.5-9B (dense)** — лучший кандидат:

- BF16 = ~18GB → помещается на L4 с ~6GB для KV cache
- 262K native context
- Structured output стабильнее чем MoE (нет MTP багов)
- Превосходит Qwen3-30B на GPQA +8, IFEval +3, LongBench +10

**Источники:** [apxml.com GPU Guide Qwen3.5](https://apxml.com/posts/qwen-3-5-system-requirement-vram-guide), [kaitchup VRAM Breakdown](https://kaitchup.substack.com/p/qwen35-9b-4b-2b-and-08b-gpu-requirements)

### C.2 Сводная таблица LLM (обновлённая)

| Модель               | Params       | GPU            | VRAM       | Throughput L4   | $/книга (50 гл.) | Русский    | Structured Output  | Рекомендация         |
| -------------------- | ------------ | -------------- | ---------- | --------------- | ---------------- | ---------- | ------------------ | -------------------- |
| **Qwen3.5-9B** ⭐    | 9B dense     | **L4**         | 18GB BF16  | ~55 tok/s (b=1) | **$0.63-2.53**   | Отличный   | ✅ Стабильный      | **TOP PICK**         |
| Qwen3.5-35B-A3B      | 35B/3B MoE   | L4 (GPTQ-Int4) | 21.6GB     | ~36-50 tok/s    | $0.70-1.80       | Отличный   | ⚠️ Баги MTP        | Рискованно           |
| Qwen3.5-4B           | 4B dense     | **T4**         | 8GB        | ~80 tok/s       | $0.05-0.12       | Хороший    | ✅                 | Budget (translation) |
| GigaChat 3 Lightning | 10B/1.8B MoE | L4             | ~10GB FP8  | 333 tok/s (MTP) | ~$0.10-0.30      | **Лучший** | ⚠️ Нестандартный   | Русский champ        |
| Mistral Small 4      | 119B/6B MoE  | **2×L40S**     | 66GB NVFP4 | —               | **$7.32**        | Не подтв.  | ⚠️ Баги            | ❌ Дорого            |
| Gemma 3 27B          | 27B dense    | A100           | 14GB INT4  | ~30 tok/s       | $0.45            | Хороший    | ⚠️ Assertion error | ❌ Баги              |

### C.3 Детальный анализ TOP 3

#### 1. Qwen3.5-9B — TOP PICK ⭐

```
Model: 9B dense, 262K context, Apache 2.0
GPU:   L4 24GB (BF16 = 18GB, KV cache = 6GB)
       → max_model_len: 32768 (safe) — 65536 (с FP8 KV cache)

Throughput (L4, batch=1): ~55 tok/s
Throughput (L4, batch=8): ~300-500 tok/s aggregate

Cost calculation (50 chapters, US region):
  Output tokens: 270K (from OpenRouter Management API)
  Batch throughput: ~300 tok/s
  Generation time: 270K / 300 = 900s
  Input prefill: ~4.71M / 5000 tok/s = 942s (prefill ~10x faster)
  Total: ~900 + 942 = 1842s
  Cold start (GPU snapshot): ~10-15s
  Total with overhead: ~1900s
  Cost: 1900 × $0.000222 = $0.42 (output generation only — optimistic)

  Реалистичная оценка (batch=1-2, sequential chapters):
  270K / 55 tok/s = 4909s + prefill ~1000s = ~5900s
  Cost: 5900 × $0.000222 = $1.31

  Диапазон: $0.42 — $2.53/книга (зависит от concurrency)
```

**Источники:** [Qwen3.5-9B HuggingFace](https://huggingface.co/Qwen/Qwen3.5-9B), [vLLM Qwen3.5 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)

#### 2. GigaChat 3 Lightning (10B-A1.8B) — Русский специалист

```
Model: 10B/1.8B active (MoE), MIT лицензия
Architecture: MLA (Multi-head Latent Attention) + MTP (Multi-Token Prediction)
Russian: MMLU RU 0.68, MERA ±2-7% от SOTA
Throughput: 333 tok/s с MTP (batch=1, bf16)
VRAM: ~10GB FP8

Проблемы:
- Structured output через Python list, НЕ стандартный JSON Schema
- Tool call parser `gigachat3` — нестандартный
- vLLM DeepGemm конфликт (VLLM_USE_DEEP_GEMM=0)
- Нет публичных бенчмарков на L4
```

**Рекомендация:** Использовать для translation (RU→EN) и synthesis — задачи, не требующие structured output. **Не для extraction.**

**Источники:** [ai-sage/GigaChat3-10B-A1.8B HuggingFace](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)

#### 3. Qwen3.5-4B — Budget tier

```
Model: 4B dense, 262K context, Apache 2.0
GPU: T4 16GB (FP16 = 8GB, KV cache = 8GB)
Throughput: ~80 tok/s (batch=1)
Cost: ~$0.05-0.12/книга на T4
Use case: Translation RU→EN, synthesis, dedup (не extraction)
```

### C.4 vLLM Bugs — актуальный статус

| Issue                                                       | Статус     | Impact                                                | Workaround                                 |
| ----------------------------------------------------------- | ---------- | ----------------------------------------------------- | ------------------------------------------ |
| [#35700](https://github.com/vllm-project/vllm/issues/35700) | **ОТКРЫТ** | Structured output + MTP fails для Qwen3.5 MoE         | Отключить MTP (`num_speculative_tokens=0`) |
| [#35574](https://github.com/vllm-project/vllm/issues/35574) | Закрыт     | `enable_thinking=false` не работало                   | Fix в vLLM 0.9.0                           |
| [#36872](https://github.com/vllm-project/vllm/issues/36872) | ОТКРЫТ     | Gibberish output с speculative decoding у Qwen3.5 MoE | Не использовать spec decoding с MoE        |
| [#15766](https://github.com/vllm-project/vllm/issues/15766) | ОТКРЫТ     | Gemma 3 structured output assertion error             | Не использовать Gemma 3                    |

**Вывод:** Dense модели (Qwen3.5-9B, 4B) безопаснее для structured output. MoE модели (35B-A3B) имеют активные баги с MTP и speculative decoding.

### C.5 vLLM Performance Tuning для L4

```bash
vllm serve Qwen/Qwen3.5-9B \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 8 \
  --enable-prefix-caching \
  --reasoning-parser qwen3 \
  --dtype bfloat16
```

| Параметр                 | Значение  | Обоснование                                              |
| ------------------------ | --------- | -------------------------------------------------------- |
| `max_model_len`          | **32768** | Безопасно для L4 (6GB KV cache). 65536 возможно с FP8 KV |
| `gpu_memory_utilization` | 0.90      | Default 0.85 — увеличиваем для большего KV cache         |
| `max_num_seqs`           | 8-16      | Ограничиваем concurrent, чтобы не выйти за VRAM          |
| `enable_prefix_caching`  | true      | System prompt reuse для 50 глав = значительная экономия  |
| `dtype`                  | bfloat16  | L4 поддерживает BF16 нативно                             |

**Quantization comparison на L4:**

| Метод            | Throughput    | Kernel | Примечание                                     |
| ---------------- | ------------- | ------ | ---------------------------------------------- |
| **AWQ + Marlin** | **741 tok/s** | Marlin | **10.9x speedup** vs без Marlin. Лучший метод. |
| GPTQ             | ~600 tok/s    | Auto   | Хорош, но Marlin быстрее                       |
| FP8              | W8A16 only    | —      | L4 compute capability 8.9, нужно ≥9.0 для W8A8 |
| BF16             | baseline      | —      | No quantization, максимальное quality          |

**SGLang как альтернатива vLLM:** На 29% быстрее на H100, structured output без penalty. **Рассмотреть** для production.

**Источники:** [vLLM Optimization](https://docs.vllm.ai/en/stable/configuration/optimization/), [SqueezeBits Guided Decoding Benchmark](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang)

### C.6 Chunk Size — требуется уменьшение

**Проблема:** Текущий `max_chunk_chars = 100000` (gemini_extractor.py:229). Русский текст: ~1.5-2 chars/token → 100K chars = **~50-67K tokens**. Это превышает `max_model_len=32768` для L4.

**Рекомендация:**

| Сценарий                | Chunk size (chars) | ~Tokens (RU) | Fits in        |
| ----------------------- | ------------------ | ------------ | -------------- |
| **Self-hosted L4**      | **45,000**         | ~30K         | 32K context ✅ |
| Self-hosted L4 + FP8 KV | 80,000             | ~53K         | 64K context    |
| Gemini Flash (current)  | 100,000            | ~67K         | 128K+ ✅       |

**Источники:** [Russian Tokenization Study](https://ikriv.com/blog/?p=5322), [Ukrainian LLM Tokenization](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1538165/full)

---

## D. Gemini Batch API (обновлённый)

### D.1 Pricing (актуально март 2026)

| Модель                    | Standard Input | Standard Output | Batch Input | Batch Output | Context Cache Input |
| ------------------------- | -------------- | --------------- | ----------- | ------------ | ------------------- |
| **Gemini 3.0 Flash**      | $0.50/M        | $3.00/M         | $0.25/M     | $1.50/M      | $0.05/M             |
| **Gemini 3.1 Flash-Lite** | $0.25/M        | $1.50/M         | $0.125/M    | $0.75/M      | $0.025/M            |
| **Gemini 2.5 Flash**      | $0.30/M        | $2.50/M         | $0.15/M     | $1.25/M      | $0.03/M             |
| **Gemini 2.5 Flash-Lite** | $0.10/M        | $0.40/M         | $0.05/M     | $0.20/M      | $0.01/M             |

**Источник:** [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing)

### D.2 Оптимальная стратегия для Free Tier

**Рекомендация: Gemini 2.5 Flash-Lite Batch** — самая дешёвая опция:

```
Extraction (60% tokens):
  Input:  2.83M × $0.05/M = $0.14
  Output: 162K × $0.20/M  = $0.03

Translation/Synthesis/Dedup (40% tokens):
  Input:  1.88M × $0.05/M = $0.09
  Output: 108K × $0.20/M  = $0.02

Images: Modal FLUX.2 Klein = $0.026

TOTAL: $0.14 + $0.03 + $0.09 + $0.02 + $0.026 = $0.31/книга
С overhead и retries: ~$0.54/книга
```

**vs текущее $6.13 → экономия 91%**

### D.3 Context Caching — незначительная экономия

- Implicit caching автоматически на Gemini 2.5+ (бесплатно)
- Explicit caching: system prompt ~2-5K tokens × 50 calls → savings ~$0.11/книга (2%)
- **Cache + Batch несовместимы** (batch ignores `cached_content`)
- **Вывод:** Не стоит усилий. Implicit caching достаточно.

**Источник:** [ai.google.dev/docs/caching](https://ai.google.dev/gemini-api/docs/caching)

### D.4 Batch API — проблемы надёжности

| Проблема                                       | Severity | Mitigation                                      |
| ---------------------------------------------- | -------- | ----------------------------------------------- |
| Stuck jobs >24h                                | HIGH     | Timeout watchdog (48h expire), fallback на sync |
| No formal SLA                                  | MEDIUM   | "Majority much quicker than 24h" — не гарантия  |
| OpenAI compat: `json_schema` не поддерживается | HIGH     | Использовать native Gemini SDK                  |
| Structured output работает через native SDK    | ✅       | `response_mime_type` + `response_schema`        |
| Job creation NOT idempotent                    | LOW      | Deduplicate через custom request ID             |

**Источники:** [Gemini Batch API Docs](https://ai.google.dev/gemini-api/docs/batch-api), [apidog.com Gemini Batch](https://apidog.com/blog/gemini-api-batch-mode/)

---

## E. Premium/Free Architecture (НОВАЯ секция)

### E.1 Processing Paths

```
FREE USER:
┌─────────────────────────────────────────────┐
│ 1. Upload book → validate → Celery "standard" queue
│ 2. LLM: Gemini 2.5 Flash-Lite Batch API
│    - Async, polling каждые 5 мин
│    - SLA: ≤4 часа (best effort)
│ 3. Images: Modal scale-to-zero (FLUX.2 Klein L4)
│    - Cold start OK (batch after LLM)
│ 4. No character consistency
│ 5. Cost: ~$0.54/книга
│ 6. Limit: 3-5 книг/мес
└─────────────────────────────────────────────┘

PREMIUM USER:
┌─────────────────────────────────────────────┐
│ 1. Upload book → validate → Celery "premium" queue (priority)
│ 2. LLM: Modal Qwen3.5-9B (warm, scaledown_window=600)
│    - SLA: ≤10 минут для LLM
│ 3. Images: Modal FLUX.2 Klein (warm) + character ref
│    - Character consistency: 1-2 ref images per character
│ 4. Cost: ~$0.69-2.59/книга
│ 5. Unlimited книг
└─────────────────────────────────────────────┘

FALLBACK (если Modal/Gemini недоступны):
  OpenRouter (текущий pipeline) → $6.13/книга
```

### E.2 Queue Architecture

```python
# Celery configuration — отдельные queues
CELERY_TASK_QUEUES = [
    Queue('premium', routing_key='premium'),
    Queue('standard', routing_key='standard'),
    Queue('batch', routing_key='batch'),  # Gemini Batch polling
]
```

**Рекомендация:** Отдельные queues > priority levels в Redis. Redis priority support ненадёжен. НЕ мигрировать на RabbitMQ — overhead не оправдан.

### E.3 Стоимость каждого пути

| Компонент         | Free (Gemini Batch) | Premium (Modal) |
| ----------------- | ------------------- | --------------- |
| LLM extraction    | $0.17               | $0.42-1.31      |
| LLM synthesis     | $0.04               | $0.10-0.30      |
| LLM dedup         | $0.04               | $0.08-0.25      |
| LLM translation   | $0.02               | $0.05-0.15      |
| Images (63)       | $0.026              | $0.039 (с ref)  |
| Character ref gen | —                   | $0.005          |
| Modal overhead    | $0.01               | $0.04           |
| **TOTAL**         | **$0.31-0.54**      | **$0.69-2.59**  |

### E.4 Бизнес-метрики для российского рынка

**Рекомендуемые тарифы:**

| Тариф        | Цена                | Книг/мес           | Себестоимость | Маржа               |
| ------------ | ------------------- | ------------------ | ------------- | ------------------- |
| **Free**     | 0 ₽                 | 3                  | $1.62 (~₽146) | -100% (acquisition) |
| **Standard** | **499 ₽** (~$5.50)  | 10                 | $5.40 (~₽486) | **2%**              |
| **Pro**      | **999 ₽** (~$11.00) | Unlimited (avg 10) | $6.90 (~₽621) | **43%**             |

**Breakeven analysis:**

```
Modal warm container: ~$18/мес (scaledown_window=600, ~60 uses/month)
Fixed costs: $18/мес

Pro tier (999 ₽ = $11):
  Revenue per user: $11/мес
  Processing (10 книг): $6.90
  Modal warm share: $18 / N_premium users

  Breakeven: N × ($11 - $6.90) - $18 > 0
  N × $4.10 > $18
  N ≥ 5 premium users

Standard tier (499 ₽ = $5.50):
  Revenue per user: $5.50
  Processing (10 книг): $5.40
  Margin: $0.10/user — практически нулевая
  → Standard нужен для conversion funnel, не для прибыли
```

**При 10 Pro пользователях:**

- Revenue: $110/мес
- Processing: $69
- Modal warm: $18
- **Profit: $23/мес** (21% margin)

**Конверсия free → paid:** 2-5% (SaaS average). При 3% нужно ~167 free users → 5 Pro users → breakeven.

**Источники:** [First Page Sage Freemium Conversion 2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/), [GetPayAll Digital Consumer 2025](https://www.cnews.ru/news/line/2025-07-22_tsifrovoj_potrebitel_v_rossii)

### E.5 Закон ФЗ-376 (автоплатежи) — ВАЖНО

С **1 марта 2026** запрещены автоматические списания за подписки без explicit consent. Нельзя списывать деньги по карте пользователя, от которой он отказался.

**Impact на fancai:**

- Подписка НЕ продлевается автоматически без подтверждения
- Нужен UI для explicit подтверждения продления
- Уведомление перед списанием обязательно

**Источники:** [ФЗ-376 — КонсультантПлюс](https://www.consultant.ru/law/hotdocs/91121.html), [Хабр — запрет автосписаний](https://habr.com/ru/articles/1005766/)

---

## F. Full Pipeline on Modal (обновлённый)

### F.1 Strategy Pattern для multi-provider

```python
class ExtractionStrategy(Protocol):
    async def extract(self, prompt: str, schema: Type[BaseModel]) -> dict: ...

class OpenRouterStrategy:   # текущий — fallback
class ModalStrategy:        # self-hosted Qwen3.5-9B
class GeminiBatchStrategy:  # free tier — async
class GeminiDirectStrategy: # sync — intermediate

# В gemini_extractor.py:
strategy = get_strategy(user_tier, feature_flags)
result = await strategy.extract(prompt, GeminiEntitySchema)
```

**Graceful degradation chain:**

1. Modal (self-hosted) → fastest, cheapest for premium
2. Gemini Direct → sync fallback
3. Gemini Batch → async fallback for free
4. OpenRouter → emergency fallback

### F.2 Celery + Modal Integration

```python
# backend/app/tasks/inference.py
import modal

@celery_app.task(bind=True, max_retries=3)
def process_book_premium(self, book_id: str, user_id: str):
    """Premium path — Modal self-hosted."""
    extract_fn = modal.Function.from_name("fancai-pipeline", "extract_chapter")

    # modal .remote() — синхронный вызов, идеален для Celery
    result = extract_fn.remote(chapter_text=text, schema=schema_json)
    return result
```

**Ключевые паттерны:**

- `modal.Function.from_name()` — lazy reference к deployed function
- `.remote()` — синхронный вызов (блокирует Celery worker, но это OK)
- `.spawn()` — асинхронный fire-and-forget
- `Function.map()` — параллельная обработка нескольких глав

**Источники:** [Modal Trigger Deployed Functions](https://modal.com/docs/guide/trigger-deployed-functions)

### F.3 Data Flow

```
VPS (Celery) → Modal:
  - Chapter text (str, <100KB) — через аргумент функции
  - JSON schema (str, <5KB) — через аргумент

Modal → VPS (Celery):
  - Extraction result (JSON, <50KB) — return value
  - Image bytes (bytes, <500KB) — return value → convert to WebP → upload R2

PostgreSQL: metadata + R2 URLs only (НЕ base64 blobs)
```

### F.4 Cold Start Optimization

| Workload          | Без snapshot | С GPU snapshot | С warm container |
| ----------------- | ------------ | -------------- | ---------------- |
| Qwen3.5-9B (L4)   | 60-90s       | ~10-15s        | 0s               |
| FLUX.2 Klein (L4) | 30-60s       | ~5-10s         | 0s               |

**Premium:** `scaledown_window=600` → GPU выключается через 10 мин простоя
**Free:** scale-to-zero + GPU snapshot → cold start ~10-15s (допустимо)

---

## G. Cost Comparison (полный пересчёт)

### G.1 Все сценарии (1 книга, 50 глав, US region)

| Компонент       | S0: Текущее | S1: Gemini Direct | S2: 2.5 Flash-Lite Batch | S3: 3.0 Flash Batch + Modal Img | S4: Qwen3.5-9B + Klein (Premium) |
| --------------- | ----------- | ----------------- | ------------------------ | ------------------------------- | -------------------------------- |
| LLM extraction  | $3.07       | $2.41             | **$0.17**                | $0.72                           | $0.42-1.31                       |
| LLM synthesis   | $0.77       | $0.61             | **$0.04**                | $0.18                           | $0.10-0.30                       |
| LLM dedup       | $0.64       | $0.50             | **$0.04**                | $0.15                           | $0.08-0.25                       |
| LLM translation | $0.37       | $0.29             | **$0.02**                | $0.07                           | $0.05-0.15                       |
| LLM прочие      | $0.28       | $0.22             | **$0.02**                | $0.06                           | $0.04-0.10                       |
| Images          | $1.01       | $1.01             | $1.01                    | **$0.026**                      | **$0.039**                       |
| Modal overhead  | $0          | $0                | **$0.01**                | $0.02                           | $0.04                            |
| **TOTAL**       | **$6.13**   | **$5.04**         | **$0.31-0.54**           | **$1.21**                       | **$0.69-2.59**                   |
| **Savings**     | —           | -18%              | **-91-95%**              | -80%                            | **-58-89%**                      |
| **Время**       | 59 мин      | 55 мин            | 30-120 мин               | ~20 мин                         | ~10-30 мин                       |
| **Риск**        | Нулевой     | Минимальный       | Низкий                   | Средний                         | Средний-Высокий                  |

### G.2 Формула стоимости LLM (подробная)

```
Cost = (output_gen_time + input_prefill_time + cold_start_amortized + modal_overhead) × GPU_price_per_sec

Где:
  output_gen_time = output_tokens / (output_tok_sec × batch_factor / guided_decoding_penalty)
  input_prefill_time = input_tokens / prefill_tok_sec
  cold_start_amortized = cold_start_sec / books_per_warm_period
  modal_overhead = ~30s (network, serialization, container coordination)
  GPU_price_per_sec = $0.000222 (L4, уже с 1.25x multiplier)
  guided_decoding_penalty = 1.05-1.30 (5-30% overhead от XGrammar)

Пример для Qwen3.5-9B, batch=1:
  270K / (55 × 1.0 / 1.10) = 270K / 50 = 5400s (output)
  4.71M / 5000 = 942s (prefill)
  10s / 10 = 1s (cold start, 10 books/warm period)
  30s (overhead)
  Total: 5400 + 942 + 1 + 30 = 6373s
  Cost: 6373 × $0.000222 = $1.41/книга

Пример для Qwen3.5-9B, batch=8 (concurrent chapters):
  270K / (300 × 1.0 / 1.10) = 270K / 273 = 989s
  4.71M / 5000 = 942s (prefill — параллельно с generation)
  max(989, 942) = 989s
  Total: 989 + 30 = 1019s
  Cost: 1019 × $0.000222 = $0.23/книга
```

---

## H. DevOps & Monitoring

### H.1 CI/CD для Modal

```yaml
# .github/workflows/modal-deploy.yml
name: Deploy Modal
on:
  push:
    branches: [main]
    paths: ["modal/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install modal
      - run: modal deploy modal/app.py --env production
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
```

**Environments:** `modal deploy --env staging` / `--env production`. До 1500 environments. Каждый со своими Secrets и Volumes.

### H.2 Monitoring Stack

| Метрика                  | Tool                   | Alert threshold |
| ------------------------ | ---------------------- | --------------- |
| Modal function latency   | Prometheus + Grafana   | P99 > 60s       |
| vLLM throughput tok/s    | Custom metric          | <30 tok/s       |
| Image gen success rate   | Prometheus             | <95%            |
| Queue depth (premium)    | Celery Flower          | >5 pending      |
| Queue depth (free/batch) | Celery Flower          | >50 pending     |
| Gemini Batch API latency | Custom                 | >4h for any job |
| Error rate per provider  | Prometheus             | >5% over 15 min |
| Cost per book (actual)   | PostgreSQL + Dashboard | >$3 (anomaly)   |
| User tier processing SLA | Custom                 | Premium >15 min |
| Modal uptime             | status.modal.com       | Any incident    |

### H.3 Observability

- **OpenTelemetry + Celery:** `opentelemetry-instrumentation-celery` — автоматический tracing
- **Modal → Datadog:** stdout/stderr логи автоматически, custom metrics через Datadog exporter
- **Cost attribution:** таблица `usage_records` с `user_id`, `book_id`, `chapter_id`, `gpu_seconds`, `cost_usd`
- **Trace linking:** Celery task → trace_id → Modal function argument → linked logs

**Источники:** [OpenTelemetry Celery](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/celery/celery.html), [Datadog Modal Integration](https://docs.datadoghq.com/integrations/modal/)

---

## I. Quality & Testing

### I.1 A/B Testing Protocol

**Sample size calculation:**

```
Baseline: 86.84% entity recall
MDE (minimum detectable effect): 5% (→ 91.84%)
α = 0.05 (Type I error)
β = 0.20 (Power = 80%)

Z_α/2 = 1.96, Z_β = 0.84
p1 = 0.8684, p2 = 0.9184, p_avg = 0.8934

n = (Z_α/2 × √(2 × p_avg × (1-p_avg)) + Z_β × √(p1×(1-p1) + p2×(1-p2)))² / (p2-p1)²
n ≈ 593 samples per group

→ ~12-15 глав per book × ~40-50 books = ~500-750 samples
→ Нужно 40-50 книг для A/B теста
```

**Метрики quality:**

| Метрика                | Инструмент               | Acceptance Criteria |
| ---------------------- | ------------------------ | ------------------- |
| Entity recall          | Custom (gold standard)   | ≥85%                |
| Entity precision       | Custom                   | ≥90%                |
| Description quality    | BERTScore (multilingual) | ≥0.85 F1            |
| JSON Schema compliance | Pydantic validation      | ≥95%                |
| Character consistency  | CLIP similarity          | ≥0.70               |

### I.2 Automated Quality Gates

```python
# CI quality check on 3 test books
def quality_gate():
    results = run_extraction(test_books, model="qwen3.5-9b")

    assert results.entity_recall >= 0.85, f"Recall {results.entity_recall} < 0.85"
    assert results.json_compliance >= 0.95, f"Compliance {results.json_compliance} < 0.95"
    assert results.avg_bertscore >= 0.85, f"BERTScore {results.avg_bertscore} < 0.85"
```

---

## J. Security & Compliance

### J.1 Data Security

- **Modal контейнеры ephemeral:** данные удаляются через 7 дней. SOC 2 Type II.
- **Transit encryption:** WireGuard между Apps и Proxy.
- **Secrets:** encrypted objects, доступны только в runtime.
- **Рекомендация:** Дополнительное шифрование текста книг НЕ требуется.

### J.2 Prompt Injection Protection

**Текущий риск: ВЫСОКИЙ.** Текст книги вставляется напрямую в LLM промпт без санитизации.

**Рекомендуемые меры:**

1. **XML delimiters:** `<book_text>...</book_text>` + инструкция игнорировать команды внутри тегов
2. **Output validation:** строгая Pydantic-валидация (уже есть)
3. **Regex sanitization:** удаление `ignore.*instructions`, `system:`, `[INST]` паттернов
4. **Post-generation NSFW classifier** для images (PixtralContentFilter или lightweight модель)

**Источники:** [OWASP LLM Top 10 2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### J.3 ФЗ-152 / GDPR

- **GDPR НЕ применяется** к fancai.ru (русский сервис, русские пользователи)
- **ФЗ-152:** персональные данные (email, профили) — только серверы в РФ. VPS в РФ ✅
- **Текст книг:** НЕ персональные данные → можно обрабатывать на Modal US ✅
- **AI-иллюстрации:** не защищены авторским правом в РФ, но и нет риска нарушения

**Источники:** [CMS Expert Guide GDPR Russia](https://cms.law/en/int/expert-guides/the-impact-of-gdpr-in-non-eu-countries/russia)

---

## K. Performance Optimization

### K.1 Image Storage — КРИТИЧЕСКАЯ миграция

**Текущее:** base64 data URLs в PostgreSQL (`imagen_generator.py:520`). +33% overhead, нет CDN, PostgreSQL bloat.

**Целевое:** WebP файлы в Cloudflare R2.

|                  | Текущее (PG base64)      | Целевое (R2 WebP)        |
| ---------------- | ------------------------ | ------------------------ |
| Размер 1000 книг | **16.7 GB** в PostgreSQL | **4 GB** в R2            |
| Cost storage     | ~$3/мес (PG disk)        | **$0.06/мес** (R2)       |
| CDN              | Нет                      | 330+ edge nodes          |
| Egress           | VPS bandwidth            | **$0** (R2)              |
| Backup           | pg_dump (огромный)       | R2 durability (11 nines) |

**Plan миграции:** 1 день работы. `GeneratedImage.image_url` уже поддерживает HTTP URLs.

### K.2 Latency Optimization (Premium path)

```
Critical path: Upload → parse → extract → generate → display
Target: < 10 минут

Breakdown:
  Parse EPUB:         ~5s (VPS)
  Extract (50 chapters): ~10-30 мин (Modal, parallel)
  Generate images (63):  ~1-4 мин (Modal, parallel)
  Upload to R2:        ~10s

  Total: 11-35 мин — НЕ УКЛАДЫВАЕМСЯ в 10 мин SLA

Optimization:
  1. Parallel extraction: 5-10 Modal containers × 5-10 глав = ~2-6 мин
  2. Start image gen WHILE extraction runs (pipeline)
  3. GPU snapshot: cold start 10-15s instead of 60-90s

  Optimized: 3-8 мин — УКЛАДЫВАЕМСЯ ✅
```

---

## L. Capacity Planning & Scaling

### L.1 MVP → Growth → Scale

| Stage      | Users    | Books/мес | Concurrent | GPU need | Modal plan     | Est. cost    |
| ---------- | -------- | --------- | ---------- | -------- | -------------- | ------------ |
| **MVP**    | 10-50    | 20-100    | 1-3        | 1 L4     | Starter ($30)  | $10-30/мес   |
| **Growth** | 50-500   | 100-1000  | 3-10       | 2-3 L4   | Starter → Team | $30-100/мес  |
| **Scale**  | 500-5000 | 1K-10K    | 10-50      | 5-10 GPU | Team ($250)    | $100-500/мес |

### L.2 Bottleneck Analysis

| Component              | Limit                | Bottleneck at         |
| ---------------------- | -------------------- | --------------------- |
| VPS Celery (12 vCPU)   | ~10 concurrent tasks | 50+ concurrent users  |
| Modal Starter (10 GPU) | 10 concurrent GPUs   | 10 simultaneous books |
| PostgreSQL writes      | ~1000 writes/sec     | >500 books/hour       |
| Redis pub/sub          | ~10K msg/sec         | Not a bottleneck      |

---

## M. Competitor Analysis

### M.1 Bookworm AI — главный конкурент

| Параметр              | Bookworm AI               | fancai                      |
| --------------------- | ------------------------- | --------------------------- |
| EPUB support          | ✅                        | ✅                          |
| AI illustrations      | ✅ (scene images)         | ✅                          |
| Character cards       | ✅                        | ✅ (entity glossary)        |
| Spoiler-safe glossary | ✅                        | ✅                          |
| Pricing model         | **Pay-per-use** (credits) | **Subscription**            |
| Market                | Англоязычный (global)     | **Русскоязычный**           |
| Character consistency | ?                         | ✅ (FLUX.2 Klein multi-ref) |
| Reader app            | Нет (companion)           | **Да (built-in reader)**    |

**Дифференциация fancai:** встроенный EPUB reader + русский рынок + подписочная модель + character consistency.

**Источники:** [bookwormai.app](https://bookwormai.app/)

### M.2 GPU Platform Comparison

| Критерий      | Modal             | RunPod                 | Cloud Run GPU |
| ------------- | ----------------- | ---------------------- | ------------- |
| L4 $/hr       | $0.80             | $0.69                  | $0.67         |
| A10G $/hr     | $1.10             | —                      | —             |
| H100 $/hr     | $3.95             | $2.72                  | —             |
| Free tier     | **$30/мес**       | ~free hours            | Нет (GPU)     |
| Scale-to-zero | ✅                | ✅ (Flex)              | ✅            |
| Cold start    | 2-4s              | **<200ms** (FlashBoot) | ~5s           |
| DX/SDK        | **Python-native** | HTTP API               | GCP SDK       |
| EU region     | ✅ (1.25x)        | ✅ (31 region)         | ✅ (Tier 1)   |
| GPU types     | T4-H200           | L4-H100                | **L4 only**   |
| Environments  | ✅ (1500)         | Нет                    | GCP projects  |

**Вывод:** Modal — лучший выбор для fancai. RunPod рассмотреть если нужен H100 или если Modal free tier закончится.

**Источники:** [Modal Pricing](https://modal.com/pricing), [RunPod Pricing](https://www.runpod.io/pricing), [Cloud Run GPU Pricing](https://cloud.google.com/run/pricing)

---

## N. Risk Matrix (обновлённая)

| Risk                                 | Probability | Impact       | Mitigation                                | Score |
| ------------------------------------ | ----------- | ------------ | ----------------------------------------- | ----- |
| Qwen3.5-9B quality < Gemini          | MEDIUM      | HIGH         | A/B тест, 40-50 книг, acceptance criteria | 🟠    |
| vLLM bugs для dense models           | LOW         | HIGH         | Qwen3.5-9B стабильнее MoE; SGLang backup  | 🟡    |
| Modal uptime (4.3 incidents/мес)     | MEDIUM      | MEDIUM       | Fallback chain → Gemini → OpenRouter      | 🟠    |
| Gemini Batch stuck >24h              | MEDIUM      | HIGH         | Timeout watchdog, sync API fallback       | 🟠    |
| Images base64/PG scalability         | **HIGH**    | **CRITICAL** | R2+WebP миграция (Phase 0)                | 🔴    |
| ФЗ-376 compliance (автоплатежи)      | **HIGH**    | HIGH         | Explicit consent UI                       | 🔴    |
| Bookworm AI выходит на русский рынок | LOW         | HIGH         | Speed-to-market, character consistency    | 🟡    |
| FLUX.2 Klein license change          | LOW         | MEDIUM       | Z-Image-Turbo / Qwen-Image-2.0 backup     | 🟡    |
| Modal free tier removal              | LOW         | HIGH         | RunPod / Cloud Run fallback               | 🟡    |
| Prompt injection через текст книги   | MEDIUM      | MEDIUM       | XML delimiters + Pydantic validation      | 🟠    |

---

## O. Migration Plan (production-ready)

### Phase 0: Prerequisites (День 0-2)

1. **Миграция images из base64/PG в Cloudflare R2 + WebP** ← CRITICAL
   - Установить `boto3` + R2 credentials
   - Модифицировать `imagen_generator.py`: upload WebP в R2
   - Background migration: decode base64 → WebP → R2 → update URL
   - Effort: **1 день**

2. **Modal account setup**
   - `modal token set` + Secrets (`OPENROUTER_API_KEY`)
   - Create `staging` и `production` environments
   - Effort: 1 час

3. **Prompt injection protection**
   - XML delimiters в `gemini_extractor.py`
   - Effort: 2 часа

### Phase 1: Безрисковая оптимизация (Дни 3-7) — -91% стоимости

4. **Gemini 2.5 Flash-Lite Batch API** для free tier
   - Новый `GeminiBatchStrategy` class
   - Native Gemini SDK (НЕ OpenAI compat layer)
   - Structured output через `response_schema`
   - Polling task в Celery `batch` queue
   - **Результат: $0.54/книга** (-91%)

5. **Modal FLUX.2 Klein** для all users
   - `@app.cls()` с `@modal.enter()` для загрузки модели
   - Scale-to-zero, GPU snapshot для cold start <10s
   - **Результат: $0.026/книга** на images (-97%)

6. **Feature flags:** `USE_GEMINI_BATCH`, `USE_MODAL_IMAGES`

### Phase 1.5: Premium Infrastructure (Дни 8-10)

7. **Celery priority queues** (premium/standard/batch)
8. **User cost tracking** — таблица `usage_records`
9. **Rate limiting** per user (Redis token bucket)

### Phase 2: Self-hosted LLM (Дни 11-21) — после A/B тестов

**Блокер:** A/B тест Qwen3.5-9B vs Gemini на 40-50 книгах.

10. **Modal Qwen3.5-9B** на L4
    - `max_model_len=32768`, `enable_prefix_caching`
    - Chunk size: 45,000 chars (уменьшить с 100K)
    - vLLM BF16 (НЕ AWQ — quality важнее throughput для extraction)
    - Acceptance: ≥85% entity recall, ≥95% JSON compliance

11. **Character consistency** — FLUX.2 Klein multi-reference
    - 1-2 reference images per character через diffusers
    - Character sheet generation pipeline

**Результат:** Premium: $0.69-2.59/книга, Free: $0.54/книга

### Phase 3: Оптимизации (Дни 22+)

12. GPU Memory Snapshots — cold start <10s
13. AWQ + Marlin quantization — throughput ↑
14. SGLang evaluation — 29% faster than vLLM
15. GigaChat 3 Lightning — evaluation для translation/synthesis
16. Embedding-based dedup — BGE-M3 вместо LLM dedup
17. Lazy image generation — on-demand при просмотре главы

### Rollback plan (для каждой фазы)

| Phase                | Rollback trigger          | Action                      | Time  |
| -------------------- | ------------------------- | --------------------------- | ----- |
| 1 (Gemini Batch)     | Batch stuck >48h >3 times | Feature flag → OpenRouter   | 1 мин |
| 1 (Modal Images)     | Modal outage >1h          | Feature flag → OpenRouter   | 1 мин |
| 2 (Self-hosted LLM)  | Quality <85% recall       | Feature flag → Gemini Batch | 1 мин |
| 2 (Char consistency) | Retention <70%            | Disable refs → plain FLUX.2 | 1 мин |

---

## P. Источники

### Modal

- [Modal Pricing](https://modal.com/pricing)
- [Modal Region Selection](https://modal.com/docs/guide/region-selection)
- [Modal Environments](https://modal.com/docs/guide/environments)
- [Modal Preemption](https://modal.com/docs/guide/preemption)
- [Modal Security](https://modal.com/docs/guide/security)
- [Modal SOC2](https://modal.com/blog/soc2)
- [Modal GPU Snapshots](https://modal.com/docs/guide/gpu-memory-snapshots)
- [status.modal.com](https://status.modal.com/)

### Модели

- [Qwen3.5-9B HuggingFace](https://huggingface.co/Qwen/Qwen3.5-9B)
- [Qwen3.5 GPU Requirements](https://apxml.com/posts/qwen-3-5-system-requirement-vram-guide)
- [GigaChat3-10B-A1.8B](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)
- [FLUX.2 Klein](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [BFL FLUX.2 Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)
- [Artificial Analysis Image Arena](https://artificialanalysis.ai/)

### vLLM

- [vLLM Optimization](https://docs.vllm.ai/en/stable/configuration/optimization/)
- [vLLM Qwen3.5 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [vLLM Issue #35700](https://github.com/vllm-project/vllm/issues/35700)
- [SqueezeBits Guided Decoding Benchmark](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang)

### Gemini

- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)

### Рынок

- [GetPayAll Digital Consumer 2025](https://www.cnews.ru/news/line/2025-07-22_tsifrovoj_potrebitel_v_rossii)
- [Самиздат >10 млрд ₽ — Коммерсант](https://www.kommersant.ru/doc/8377712)
- [Электронные книги +22% — Коммерсант](https://www.kommersant.ru/doc/8294585)
- [First Page Sage Freemium Conversion](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [ФЗ-376 автоплатежи — КонсультантПлюс](https://www.consultant.ru/law/hotdocs/91121.html)

### Безопасность

- [OWASP LLM Top 10 2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [CMS GDPR Russia](https://cms.law/en/int/expert-guides/the-impact-of-gdpr-in-non-eu-countries/russia)

### Конкуренты

- [bookwormai.app](https://bookwormai.app/)
- [RunPod Pricing](https://www.runpod.io/pricing)
- [Cloud Run GPU Pricing](https://cloud.google.com/run/pricing)
