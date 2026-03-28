# Промпт: Modal Full AI Pipeline Research v2 — глубокое обновлённое исследование

## Роль

Ты — Senior ML Infrastructure Architect, AI Systems Engineer и Product Analytics Lead с 10+ лет опыта в production ML системах, serverless GPU, model selection, cost optimization, DevOps и product metrics. Твоя задача — провести **глубокое обновлённое исследование** на основе аудита `modal-full-pipeline-AUDIT.md`, устранить все найденные ошибки, заполнить пробелы, и создать **production-ready план миграции** для качественного MVP.

## Контекст проекта

**fancai** — fiction reader с AI-иллюстрациями и интерактивным entity glossary/wiki.

**Стек:** FastAPI + Celery + PostgreSQL 17 + Redis 7.4 | React 19 + TypeScript
**Production:** VPS 32GB RAM, 12 vCPU AMD EPYC 9645, без GPU
**Домен:** https://fancai.ru
**Milestone:** v1.4 — Оптимизация обработки книг (in progress)

### Бизнес-модель

**Гибридная подписочная модель (российский рынок):**

- **Free tier:** ограниченное число книг/мес, background processing, без character consistency
- **Premium tier (₽499-999/мес):** неограниченные книги, приоритетная очередь, character consistency, HD иллюстрации
- **Целевая аудитория:** российский рынок, русскоязычная художественная литература
- **Платёжная система:** YooKassa / CloudPayments (Россия)

### Текущий AI Pipeline

- **LLM** (83% стоимости): Gemini 3.0 Flash через OpenRouter, extraction + synthesis + dedup + translation
- **Images** (17%): FLUX.2 Klein 4B через OpenRouter
- **NER**: GLiNER2 на CPU (feature flag, выключен)
- **Реальная стоимость:** $6.13/книга (50 глав), 59 минут обработки
- **Источник данных:** OpenRouter Management API (DB `llm_usage_log` теряет 52-66% данных из-за `asyncio.create_task` fire-and-forget бага)

### Ключевые файлы кода

```
backend/app/core/openrouter_client.py      — Unified AI client (738 строк)
backend/app/services/gemini_extractor.py   — Description extraction (1221 строк, chunks 100K chars, 15% overlap)
backend/app/services/imagen_generator.py   — Image generation + RU→EN translation (679 строк)
backend/app/services/ner_service.py        — GLiNER2 NER pipeline (498 строк)
backend/app/services/entity_synthesis_service.py — Biography milestones
backend/app/services/entity_deduplication_service.py — LLM dedup
backend/app/tasks/book_tasks.py            — Celery task (956 строк, Semaphore(10) chapters, Redis distributed lock)
```

### Предыдущие исследования (обязательно прочитать)

```
docs/research/modal-full-pipeline-research.md      — Оригинальное исследование
docs/research/modal-full-pipeline-AUDIT.md          — Аудит (5 CRITICAL, 8 WARNING)
docs/research/modal-full-pipeline-architecture.md   — Архитектура
docs/research/modal-gpu-migration-plan.md           — Первичный план
docs/research/self-hosted-llm-structured-extraction-2026-03.md — Анализ LLM
docs/research/per-user-cost-tracking-architecture.md — Трекинг расходов
docs/research/subscription-billing-models.md        — Модели монетизации
docs/research/security-audit-ai-endpoints.md        — Безопасность AI endpoints
```

---

## 5 CRITICAL ошибок из аудита (ОБЯЗАТЕЛЬНО исправить)

### 1. Modal EU Region Pricing Multiplier (1.25-2.5x)

Все расчёты в оригинальном отчёте используют US pricing. EU region стоит 1.25-2.5x дороже.

**Задача:** Исследовать:

- Точный множитель для каждого GPU типа в каждом EU регионе (eu-west-1, eu-paris-1)
- Юридическая необходимость EU region для fancai.ru (российские пользователи, серверы в РФ, данные — текст книг)
- Если EU не обязателен — какой US region оптимален по latency для VPS в РФ?
- Trade-off analysis: US pricing (дешевле) vs EU (ближе к VPS, GDPR)
- **Для каждого расчёта в отчёте** — привести обе стоимости (US и EU)

### 2. Throughput Qwen3.5-35B-A3B на L4 завышен в 3x

L4 memory bandwidth 300 GB/s. RTX 3090 — 936 GB/s. Отчёт использовал RTX benchmarks для L4.

**Задача:** Исследовать:

- Реальные бенчмарки Qwen3.5-35B-A3B AWQ конкретно на **L4** (не RTX!)
- Реальные бенчмарки на **A10G** (384 GB/s bandwidth) — альтернатива
- vLLM throughput с continuous batching на L4 для MoE моделей
- Impact quantization (AWQ vs GPTQ vs FP8) на throughput для L4
- Pересчитать $/книга с реальным throughput
- Рассмотреть: может ли **A10G** быть лучшим выбором несмотря на +37% стоимость?

### 3. vLLM + Qwen3.5 Structured Output Bug (Issue #35700)

vLLM Issue #35700 (23 марта 2026, OPEN) — structured output fails для Qwen3.5.

**Задача:** Исследовать:

- Текущий статус Issue #35700 и #35574 — есть ли fix?
- Workaround: `--reasoning-parser qwen3` + `--structured-outputs-config.enable_in_reasoning=True` — работает ли стабильно?
- Альтернатива: text output + JSON regex parsing — как это влияет на quality?
- Альтернатива: Outlines vs XGrammar vs LM Format Enforcer — какой backend стабильнее для Qwen3.5?
- Когда ожидается fix? (посмотреть PR timeline, vLLM release schedule)
- **Backup plan:** если баг не fix-ится — какая модель лучше для structured extraction на Modal?
  - GigaChat 3 Lightning (10B-A1.8B, MIT, русский-native)
  - Mistral Small 4 (119B MoE, 6B active)
  - Qwen3.5-9B (dense, возможно меньше багов)

### 4. FLUX.2 Klein Multi-Reference: Max 4, не 10

**Задача:** Исследовать:

- Подтвердить: self-hosted через diffusers — сколько реально ref images?
- Ограничения VRAM для multi-reference на L4 (24GB)
- Как reference images влияют на время генерации?
- Pipeline: generation 1 reference → передача reference + scene description
- Quality comparison: 1 ref vs 2 vs 4 — есть ли исследования?
- **Конкуренты для character consistency:** FLUX.1 Kontext, InstantID, PuLID, IP-Adapter — что лучше для книжных персонажей?

### 5. Premium/Free Architecture (полностью пропущено)

**Задача:** Разработать **production-ready** архитектуру. См. детали в секции 7.

---

## Задачи исследования

### 1. СТОИМОСТЬ: Полный пересчёт всех сценариев

**Для КАЖДОГО сценария — три варианта: US pricing, EU 1.25x, EU 2.0x**

**1a. Self-hosted LLM — deep benchmarking:**

Для каждой рекомендуемой модели — WebSearch конкретных бенчмарков:

| Модель                         | GPU       | Что искать                                       |
| ------------------------------ | --------- | ------------------------------------------------ |
| Qwen3.5-35B-A3B AWQ            | L4        | vLLM throughput tok/s, batch size, max_model_len |
| Qwen3.5-35B-A3B AWQ            | A10G      | то же                                            |
| Qwen3.5-9B                     | L4        | throughput, structured output stability          |
| Qwen3.5-4B                     | T4        | throughput для translation                       |
| GigaChat 3 Lightning 10B-A1.8B | L4/T4     | throughput, русский quality                      |
| Mistral Small 4 119B-A6B       | A10G/A100 | throughput, structured output                    |

**1b. Полная формула стоимости LLM/книга:**

```
Cost = (input_prefill_time + output_gen_time + cold_start_amortized + modal_overhead) × GPU_price_per_sec × region_multiplier
```

Для каждой переменной — конкретное число с источником:

- `input_prefill_time`: 4.71M input tokens ÷ prefill_tok_sec
- `output_gen_time`: 270K output tokens ÷ (output_tok_sec × batch_factor × guided_decoding_penalty)
- `cold_start_amortized`: с GPU snapshot и без
- `modal_overhead`: network + serialization
- `GPU_price_per_sec`: точная цена Modal
- `region_multiplier`: 1.0 (US), 1.25 (EU min), 2.0+ (EU max)
- `guided_decoding_penalty`: overhead xgrammar/outlines (10-30%)

**1c. Image gen — детальный пересчёт:**

Для каждой image модели:

- Точное время генерации на конкретном GPU (L4, A10G)
- Cold start с GPU snapshot и без
- Batch amortization при 63 images per book
- **С character consistency** vs без (overhead ref images)

**1d. Gemini Context Caching — расчёт реального impact:**

- System prompt fancai extraction: сколько tokens?
- Implicit caching: как определить что Google его применяет?
- Explicit caching: TTL strategy для обработки книги
- Cache + Batch несовместимы — что выгоднее для fancai?
- Real savings calculation для 50-chapter book

### 2. МОДЕЛИ: Расширенное исследование

**2a. LLM для structured extraction — March 2026 landscape:**

WebSearch каждой модели с **конкретными** результатами для задач fancai:

- **Qwen3.5-35B-A3B**: актуальный статус vLLM bugs, production reports
- **GigaChat 3 Lightning (10B-A1.8B)**: русский quality, structured output через vLLM, MERA benchmark
- **GigaChat 3 20B-A3B**: если Lightning недостаточно
- **Mistral Small 4 (119B-A6B)**: structured output, русский, fitting на A10G
- **Qwen3.5-9B dense**: как backup для extraction, structured output stability
- **Gemma 3 27B**: Google-native, structured output через vLLM
- **Phi-4 Reasoning Plus**: если подходит для extraction задач

**Для каждой модели — таблица:**

| Критерий                    | Значение | Источник |
| --------------------------- | -------- | -------- |
| Размер / GPU                |          |          |
| Русский quality (benchmark) |          |          |
| Structured output stability |          |          |
| vLLM compatibility          |          |          |
| Throughput на L4/A10G       |          |          |
| $/книга (50 глав)           |          |          |
| Лицензия                    |          |          |
| Production-readiness        |          |          |

**2b. Image generation — расширенный landscape:**

Дополнительно к оригинальному отчёту исследовать:

- **Qwen-Image-2.0** (7B, Apache 2.0, #1 AI Arena) — подробные бенчмарки, diffusers support, VRAM
- **GLM-Image** (16B, MIT, 0.9116 Word Accuracy) — пригодна ли для книжных иллюстраций?
- **Imagen 4 Fast** (Google, $0.02/img, API only) — сравнение quality с self-hosted
- **FLUX.2 Klein 4B** vs **FLUX.2 Klein 9B-KV** — что лучше для character consistency?
- **FLUX.1 Kontext [dev]** — character+style reference, сравнение с FLUX.2 Klein multi-ref
- **SD 3.5 Medium + IP-Adapter** — бюджетная альтернатива для character consistency?

**2c. NER и embedding модели:**

- **GLiNER2** на Modal T4 vs VPS CPU — сравнение throughput и стоимости
- **Sentence-transformers** для embedding-based dedup — какая модель лучше для русского?
  - `intfloat/multilingual-e5-large-instruct`
  - `BAAI/bge-m3`
  - `ai-sage/GigaEmbed` (Sber)
- **pgvector** с embeddings vs LLM dedup — quality comparison

### 3. АРХИТЕКТУРА: Production-Ready Design

**3a. Strategy Pattern для AI pipeline:**

Исследовать паттерны для multi-provider AI systems:

- Strategy / Provider pattern для LLM (OpenRouter, Modal vLLM, Gemini Direct, Gemini Batch)
- Factory pattern для Image gen (OpenRouter FLUX, Modal FLUX, Modal Z-Image, etc.)
- Circuit breaker integration с multi-provider
- Feature flag integration (`USE_MODAL_LLM`, `USE_GEMINI_BATCH`, etc.)
- Graceful degradation chain: Modal → Gemini Batch → Gemini Direct → OpenRouter

**3b. Celery + Modal integration patterns:**

WebSearch: best practices для Celery → Modal integration:

- Sync vs async вызов Modal из Celery worker
- `asyncio.run()` в Celery vs `celery[asyncio]` extension
- Modal function timeout handling в Celery context
- Progress tracking через Celery → Modal (callback patterns)
- Error propagation Modal → Celery → WebSocket → Frontend

**3c. Data flow architecture:**

- VPS → Modal: как передавать chapter text (serialization format, compression?)
- Modal → VPS: return values vs callback vs polling
- Batch processing: все главы за один Modal call vs per-chapter
- Image bytes return: base64 vs Modal Volume → pre-signed URL?
- Large book handling: what if 100+ chapters? Memory limits?

### 4. PREMIUM/FREE: Детальная Архитектура

**4a. Queue Architecture:**

WebSearch: Celery priority queues best practices:

- Redis broker: ограничения priorities. Нужен ли RabbitMQ?
- Отдельные queues vs priority levels
- Worker routing: `celery -Q premium,standard` vs separate workers
- Rate limiting per user tier
- Queue depth monitoring (Prometheus, Flower)

**4b. Processing paths:**

```
FREE USER:
1. Upload book → validate → Celery "standard" queue
2. LLM: Gemini Batch API (Flash extraction, Flash-Lite rest)
   - Асинхронно, polling каждые 5 мин
   - SLA: ≤4 часа
3. Images: Modal scale-to-zero (FLUX.2 Klein, cold start OK)
   - Batch after LLM completes
4. No character consistency

PREMIUM USER:
1. Upload book → validate → Celery "premium" queue (high priority)
2. LLM: Modal warm container (Qwen3.5 или лучшая модель)
   - scaledown_window=600
   - SLA: ≤10 мин для LLM
3. Images: Modal warm (FLUX.2 Klein + character ref OR Z-Image-Turbo)
   - Character consistency: reference images per character
4. Character consistency pipeline:
   a. NER extracts character → generate 1 reference image
   b. For each scene → pass reference + scene description
   c. FLUX.2 Klein preserves identity (multi-ref through diffusers)
```

**4c. Стоимость каждого пути:**

Полная breakdown таблица для КАЖДОГО компонента × КАЖДОГО тарифа × КАЖДОГО region:

| Компонент         | Free (US) | Free (EU) | Premium (US) | Premium (EU) |
| ----------------- | --------- | --------- | ------------ | ------------ |
| LLM extraction    |           |           |              |              |
| LLM synthesis     |           |           |              |              |
| LLM dedup         |           |           |              |              |
| LLM translation   |           |           |              |              |
| Images (batch)    |           |           |              |              |
| Character ref gen | —         | —         |              |              |
| NER (if Modal)    |           |           |              |              |
| Modal overhead    |           |           |              |              |
| **TOTAL**         |           |           |              |              |

**4d. Бизнес-метрики для российского рынка:**

WebSearch: pricing AI SaaS в России, аналоги fancai:

- Сколько готовы платить российские пользователи за AI-фичи в ридере?
- Конверсия free → premium для AI SaaS в России
- Средний чек digital подписки в РФ (сравнение с Bookmate, MyBook, Storytel)
- ₽499 vs ₽999 vs ₽1499 — оптимальная цена
- Breakeven: сколько premium users нужно при разных ценах?
- Unit economics по тарифам

### 5. DEVOPS & INFRASTRUCTURE

**5a. Modal deployment pipeline:**

WebSearch: Modal CI/CD best practices:

- `modal deploy` из GitHub Actions
- Staging vs production environments в Modal
- Rollback strategy при failed deployment
- Model version management через Modal Volumes
- Health checks для Modal functions

**5b. Monitoring stack:**

Исследовать: какие метрики собирать и чем:

| Метрика                  | Tool                   | Alert threshold        |
| ------------------------ | ---------------------- | ---------------------- |
| Modal function latency   | Prometheus + Grafana   | P99 > 60s              |
| Modal GPU utilization    | Modal Dashboard        | <10% (overprovisioned) |
| Modal cost per day       | Custom + Grafana       | >$3/day                |
| vLLM throughput tok/s    | Prometheus             | <100 tok/s aggregate   |
| Image gen success rate   | Prometheus             | <95%                   |
| Queue depth (premium)    | Flower / Prometheus    | >5 pending             |
| Queue depth (free/batch) | Flower / Prometheus    | >50 pending            |
| Gemini Batch API latency | Custom                 | >4h for any job        |
| Error rate per provider  | Prometheus             | >5% over 15 min        |
| Cost per book (actual)   | PostgreSQL + Dashboard | >$3 (anomaly)          |
| User tier processing SLA | Custom                 | Premium >15 min        |

**5c. Observability:**

- Structured logging: что логировать для каждого AI call?
- Distributed tracing: Celery task → Modal function → response
- Cost attribution: трекинг расходов per user, per book, per chapter
- A/B testing framework: какой tool? Feature flags + metrics
- Incident runbook: что делать при Modal outage, Gemini outage, high costs

**5d. Disaster Recovery:**

- Fallback chain: Modal → Gemini Batch → OpenRouter
- Data backup: images, extraction results, entity database
- Recovery time objectives (RTO/RPO) для каждого компонента
- Blue-green deployment для Modal functions

### 6. КАЧЕСТВО И ТЕСТИРОВАНИЕ

**6a. A/B Testing Protocol — детальный:**

- **Sample size calculation**: сколько книг нужно для statistical significance?
  - WebSearch: power analysis для comparing NER recall rates
  - Current baseline: 86.84% entity recall
  - Minimum detectable effect: 5% difference
  - α=0.05, β=0.20 → sample size = ?
- **Метрики quality:**
  - Entity recall (primary): % entities found vs gold standard
  - Entity precision: false positive rate
  - Description quality: ROUGE/BERTScore vs Gemini baseline
  - JSON Schema compliance: % valid outputs
  - Character consistency: CLIP similarity between generated images
- **A/B infrastructure:**
  - Feature flags в code
  - PostgreSQL table для tracking results
  - Statistical analysis tool (scipy, или что-то более мощное?)
- **Automated quality gates:**
  - CI pipeline that runs quality check on 3 test books
  - Acceptance criteria: recall ≥85%, compliance ≥95%
  - Regression detection: alert if quality drops >3% from previous week

**6b. Testing для Modal integration:**

- Unit tests: mock Modal functions
- Integration tests: Modal staging environment
- Load tests: concurrent book processing
- Chaos testing: Modal outage simulation
- Cost tests: verify per-book cost stays within budget

### 7. БЕЗОПАСНОСТЬ

**7a. Data security:**

- Данные книг (text) передаются в Modal — retention policy?
- Modal containers: ephemeral, но данные в transit — нужен ли encryption?
- API keys (OpenRouter, Gemini, Modal) — secret management best practices
- PostgreSQL credentials — не должны попадать в Modal containers

**7b. User data:**

- GDPR / ФЗ-152 (РФ) — какие данные пользователей обрабатываются?
- Книги загружаются пользователями — хранение, удаление, rights management
- AI-generated content — кому принадлежат иллюстрации? (IP вопрос)
- Processing logs — что хранить, сколько, как удалять?

**7c. AI-specific security:**

- Prompt injection protection для extraction prompts
- NSFW content filtering: текущий "SFW" суффикс достаточен?
- Model output validation: JSON Schema enforcement перед записью в DB
- Rate limiting per user для AI endpoints

### 8. PERFORMANCE & OPTIMIZATION

**8a. Latency optimization:**

- **Critical path для premium:** Upload → parse → extract → generate → display
  - Target: < 10 минут end-to-end
  - Bottleneck analysis: что занимает больше всего?
  - Parallelization: LLM extraction + Image gen одновременно?

- **Chunk size optimization:**
  - Текущее: 100K chars (~33-50K tokens for Russian)
  - Проблема: превышает `max_model_len=32768` в Modal коде
  - Исследовать оптимальный chunk size для Qwen3.5 на L4 (с учётом VRAM для KV cache)
  - Trade-off: bigger chunks = fewer calls = less overhead, но requires more VRAM

**8b. vLLM optimization для Modal:**

WebSearch: vLLM performance tuning best practices:

- `max_model_len` vs available KV cache memory
- `gpu_memory_utilization` optimal setting для L4
- Continuous batching parameters: `max_num_seqs`, `max_num_batched_tokens`
- Prefix caching для повторяющихся system prompts
- Speculative decoding: draft model для Qwen3.5 MoE
- Quantization comparison на L4: AWQ (Marlin) vs GPTQ vs FP8

**8c. Image pipeline optimization:**

- Batch inference для diffusers: обработать все 63 images за один вызов
- Image compression: PNG vs WebP vs AVIF — trade-off quality/size
- CDN для сгенерированных images (Cloudflare R2? VPS nginx cache?)
- Lazy generation: генерировать images on-demand при просмотре главы?

### 9. МАСШТАБИРУЕМОСТЬ

**9a. Capacity planning:**

| Stage  | Users    | Books/мес | Concurrent | GPU need | Modal plan  | Est. cost |
| ------ | -------- | --------- | ---------- | -------- | ----------- | --------- |
| MVP    | 10-50    | 20-100    | 1-3        | 1 L4     | Free ($30)  | ~$10-30   |
| Growth | 50-500   | 100-1000  | 3-10       | 2-3 L4   | Free → Team | ~$30-100  |
| Scale  | 500-5000 | 1K-10K    | 10-50      | 5-10 GPU | Team ($250) | $100-500  |

**9b. Bottleneck analysis:**

- VPS Celery: max concurrent tasks? (12 vCPU, 32GB RAM)
- Modal Starter plan: 10 GPU concurrency — хватит ли?
- PostgreSQL: write throughput при parallel book processing
- Redis: pub/sub performance для progress updates

**9c. Auto-scaling strategy:**

- Modal: `max_containers`, `buffer_containers` settings
- Celery: worker autoscaling (prefork vs eventlet vs gevent)
- Queue monitoring → alert → manual intervention vs auto-scale

### 10. КОНКУРЕНТЫ И РЫНОК

**10a. WebSearch: аналоги fancai:**

- AI-enhanced reading apps (2025-2026)
- AI illustration generators для книг
- Interactive glossary/wiki для fiction readers
- Pricing comparison с конкурентами

**10b. Конкурентные GPU platforms:**

Расширенное сравнение (не только pricing, но и DX, reliability, features):

| Критерий          | Modal | RunPod | Cloud Run GPU | Baseten | Replicate |
| ----------------- | ----- | ------ | ------------- | ------- | --------- |
| Pricing (L4)      |       |        |               |         |           |
| Free tier         |       |        |               |         |           |
| Scale-to-zero     |       |        |               |         |           |
| Cold start        |       |        |               |         |           |
| DX / SDK          |       |        |               |         |           |
| EU region         |       |        |               |         |           |
| GPU snapshots     |       |        |               |         |           |
| Monitoring        |       |        |               |         |           |
| CI/CD integration |       |        |               |         |           |
| SLA / Uptime      |       |        |               |         |           |
| Community / Docs  |       |        |               |         |           |

---

## Формат результата

Результат должен быть **обновлённой версией** `modal-full-pipeline-research.md` — НЕ новый файл, а замена оригинала. Сохранить файл как `docs/research/modal-full-pipeline-research-v2.md`.

### Структура файла:

```
# Modal Full AI Pipeline Research v2 — fancai

**Дата:** 2026-03-25 (v2: обновлённое исследование на основе аудита)
**Scope:** ...
**Предыдущие версии:** v1 (modal-full-pipeline-research.md), аудит (modal-full-pipeline-AUDIT.md)

## A. Executive Summary
- Что изменилось vs v1
- Скорректированные цифры
- Новые находки
- Top 3 рекомендации

## B. Image Generation Models (обновлённый landscape)
- Исправлены ошибки из аудита (FLUX.2 Klein refs, SANA)
- Добавлены: Qwen-Image-2.0, GLM-Image, Imagen 4 Fast
- Character consistency pipeline (детальный)

## C. LLM Models для Extraction (обновлённый)
- Реальные бенчмарки на L4/A10G (не RTX)
- vLLM bugs: актуальный статус
- GigaChat 3, Mistral Small 4 добавлены
- Chunk size analysis

## D. Gemini Batch API (обновлённый)
- Context Caching impact
- Cache vs Batch strategy
- Structured output в batch: SDK-specific nuances

## E. Premium/Free Architecture (НОВАЯ секция)
- Queue architecture
- Processing paths
- Cost per tier
- Бизнес-метрики
- Breakeven analysis

## F. Full Pipeline on Modal (обновлённый)
- Strategy pattern для multi-provider
- Celery + Modal integration
- Data flow
- Cold start optimization

## G. Cost Comparison (полный пересчёт)
- US vs EU pricing
- Realistic throughput
- Guided decoding overhead
- Premium vs Free costs

## H. DevOps & Monitoring
- CI/CD для Modal
- Prometheus metrics
- Alerting rules
- Incident runbook

## I. Quality & Testing
- A/B testing protocol (detailed)
- Sample size calculation
- Quality gates
- Regression detection

## J. Security & Compliance
- Data security
- GDPR / ФЗ-152
- AI-specific security

## K. Performance Optimization
- Chunk size optimization
- vLLM tuning
- Image pipeline optimization
- Latency breakdown

## L. Capacity Planning & Scaling
- MVP → Growth → Scale
- Bottleneck analysis
- Auto-scaling

## M. Competitor Analysis
- Market landscape
- GPU platform comparison

## N. Risk Matrix (обновлённая)
- С учётом всех findings

## O. Migration Plan (обновлённый, production-ready)
- Phase 0: Prerequisites
- Phase 1: Безрисковая оптимизация
- Phase 1.5: Premium infrastructure
- Phase 2: Self-hosted LLM
- Phase 3: Оптимизации
- Rollback plan для каждой фазы

## P. Источники
- Все URL из веб-исследования
```

---

## Методология

1. **Прочитай ВСЕ предыдущие исследования** — пойми полный контекст
2. **Прочитай код AI pipeline** — пойми реальную архитектуру
3. **WebSearch для КАЖДОГО утверждения** — независимая верификация
4. **WebSearch ШИРЕ**: не только model pricing, но и:
   - vLLM performance tuning guides
   - Modal production deployment case studies
   - Celery priority queues best practices
   - AI SaaS pricing в России
   - A/B testing for ML systems
   - GPU serverless comparison 2026
   - Character consistency state of the art
   - Embedding models for Russian text
5. **Рассчитай ВСЁ заново** — не копируй цифры из v1
6. **Проверяй источники** — для каждого числа должен быть URL
7. **Будь скептичен** — ищи проблемы, edge cases, failure modes
8. **Думай о production** — не только "работает на demo", а "работает при 1000 books/month"

## Ограничения

- Результат на русском языке (технические термины на английском)
- VPS не меняется (32GB RAM, 12 vCPU)
- Текущий OpenRouter API key сохраняется как emergency fallback
- Целевой рынок — Россия
- Бюджет: Modal free tier ($30/мес) для MVP, готовы масштабировать если обосновано
- Premium SLA: обработка книги < 10 минут
- Free SLA: обработка книги < 4 часа
- Baseline quality: 86.84% entity recall (NER A/B test)
- Коммит-сообщения на английском, документация на русском

## КРИТИЧЕСКИ ВАЖНО

1. **Каждое число — с источником (URL).** "По оценке" без источника = ❌
2. **Каждый расчёт — с формулой.** Не "примерно $0.15", а `700s × $0.000222/s = $0.155`
3. **US vs EU pricing** для каждого Modal расчёта
4. **Premium vs Free** для каждого architecture decision
5. **Реальные бенчмарки на L4**, не extrapolation от RTX
6. **vLLM bugs** — актуальный статус, не "будет исправлено"
7. **Production-ready**: timeout handling, error recovery, monitoring
8. **Российский рынок**: цены в рублях, платёжные системы, регулирование
9. **Не менее 15 WebSearch запросов** по каждой из 10 секций (итого 150+)
10. Будь конкретен и дотошен. Это исследование определяет архитектуру MVP — от его качества зависит стоимость и скорость разработки.
