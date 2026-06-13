# Промпт: Сравнительное исследование kie.ai vs Direct Gemini API vs OpenRouter для AI-стека fancai

> **Модель:** Claude Opus 4.7 (1M context)
> **Effort:** max
> **Дата актуальности:** 27 апреля 2026 года
> **Требуемые инструменты:** WebSearch (с фильтром свежести), WebFetch (для парсинга pricing-страниц и docs)
> **Ожидаемый объём отчёта:** 8000–15000 слов
> **Целевой читатель:** соло-разработчик-владелец production-проекта, готовый принять architectural decision на основе твоего отчёта

---

## Промпт

Ты — старший консультант по AI-инфраструктуре с десятилетним опытом проектирования production LLM- и image-generation пайплайнов. Тебе поручают принимать решения уровня «менять провайдера для всего AI-стека» — то есть твои рекомендации должны быть подкреплены фактами с источниками, выдерживать критику инженерной команды и учитывать долгосрочные риски (vendor lock-in, региональные ограничения, рост цен после ввода новых моделей). Поверхностные обзоры неприемлемы — заказчик уже потратил месяц на исследования трёх альтернатив отдельно и теперь нуждается в окончательном сравнении.

Проведи **глубокое сравнительное исследование трёх AI-провайдеров** для production AI-стека проекта **fancai** по состоянию на **27 апреля 2026 года**:

1. **kie.ai** (https://kie.ai) — позиционируется как агрегатор/прокси с ценами в несколько раз ниже OpenRouter
2. **Google AI Studio / Vertex AI Direct** (https://ai.google.dev) — прямая интеграция с Gemini API
3. **OpenRouter** (https://openrouter.ai) — текущий провайдер fancai, единый API для множества моделей

Цель — определить, **какой из трёх вариантов (или какая их комбинация)** оптимален для fancai по совокупности pricing, feature parity, reliability и migration cost. По возможности предложи гибридную архитектуру (например: дешёвый провайдер для basic extraction + надёжный для критичных синтезов + специализированный для изображений).

---

### 1. Контекст проекта fancai (для релевантного сравнения)

**fancai** — production веб-читалка художественной литературы с AI-функциональностью. Production: https://fancai.ru. Соло-разработчик. Стек: React 19 + TypeScript 5.7 + Vite 7 | FastAPI + Python 3.12 + PostgreSQL 17 + Redis 7.4 + Celery 5.6.

#### 1.1 AI-функциональность (5 задач)

| №   | Задача                                                                                                                                                                             | Тип I/O                                              | Critical | Объём                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- | ----------------------------------- |
| 1   | **Extraction (TSA mode)** — извлечение визуальных описаний (location/character/atmosphere/object) и entity-графа (персонажи, локации, связи, события) из русского текста глав книг | Text-in (~20–80K chars/chapter) → JSON + tagged text | Yes      | основная нагрузка, 50 глав на книгу |
| 2   | **Entity deduplication** — LLM-merge дубликатов entities (fuzzy + semantic). «Геральт» = «Белый Волк» = «Ведьмак». Recursive batched reduce для 500+ entities                      | Text-in → JSON                                       | Yes      | один проход на книгу                |
| 3   | **Entity synthesis** — генерация milestones, biography, visual_summary_clean для каждой entity. Spoiler-free по главам                                                             | Text-in → JSON                                       | Yes      | один проход на entity               |
| 4   | **Translation** — перевод описаний RU → EN для image prompts. Простой text-in/text-out                                                                                             | Text-in → text-out                                   | No       | по описанию                         |
| 5   | **Image generation** — генерация иллюстраций по EN-описаниям. Сейчас FLUX.2 Klein через OpenRouter                                                                                 | Text-in → image-out (1024×1024 / 1024×1536)          | No       | по запросу пользователя             |

#### 1.2 Текущая конфигурация (на 27 апреля 2026, после pivot 2026-03-29)

```python
# backend/app/core/openrouter_client.py
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
FALLBACK_MODELS = [
    "google/gemini-2.5-flash",        # primary — $0.30/$2.50 per 1M tokens (через OpenRouter)
    "google/gemini-2.5-flash-lite",   # fallback — $0.10/$0.40 per 1M tokens
]
DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"  # ~$0.014–0.016/image

# backend/app/services/gemini_extractor.py:126
model_id = "gemini-2.5-flash"   # baseline для extraction (через OpenRouter wrapper)

# Pivot history (см. .planning/STATE.md):
# - 2026-03-29: переход с Gemini 3.0 Flash → Gemini 3.1 Flash Lite primary (-75% input cost)
# - 2026-03-30: A/B Qwen3.5-397B провален, выбран Gemini 2.5 Flash tiered strategy
# - Финальная стратегия: 2.5-flash для extraction, 2.5-flash-lite для translation/dedup
```

#### 1.3 Промпты и схемы (для оценки caching / batch potential)

| Промпт                      | Токены (фиксированная часть) | Задача                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `TSA_EXTRACTION_PROMPT`     | ~737                         | XML-разметка `<desc type="X" occurrence="N">` + entities + relationships |
| `EXTRACTION_PROMPT`         | ~587                         | Legacy JSON extraction                                                   |
| `SYNTHESIS_PROMPT_TEMPLATE` | ~571                         | Entity milestones + biography + visual_summary                           |
| `DEDUPLICATION_PROMPT`      | ~263                         | Merge дубликатов                                                         |
| `TRANSLATION_SYSTEM_PROMPT` | ~117                         | RU → EN                                                                  |

**Pydantic structured-output схемы** (главная боль):

```python
class GeminiTSAResponseSchema(BaseModel):       # TSA mode (default)
    tagged_text: str
    entities: List[GeminiEntitySchema]          # 8 полей каждая
    relationships: List[GeminiRelationshipSchema]  # source, target, type, weight, context

class DeduplicationResponse(BaseModel):
    merge_groups: List[MergeGroup]              # master_id, duplicate_ids[], confidence, reason
```

Через OpenRouter — `$defs/$ref` баг, нужен хак `_inline_defs()` для разворачивания вложенных JSON Schema (Google модели через OpenRouter их не поддерживают). Прямой Gemini SDK работает с вложенными схемами через `response_schema=Pydantic`. Это потенциально критичный фактор для kie.ai — нужно явно проверить.

#### 1.4 Объёмы и cost-чувствительность

- **Книга = 50 глав в среднем**. Стоимость через текущий стек (Gemini 2.5 Flash): ~$0.25–0.40 за extraction всей книги
- **Image generation**: ~$0.016/image, изображения генерируются по запросу пользователя (не auto)
- **Прогнозируемая нагрузка**: 100–1000 книг/месяц (зависит от роста), 10–100K изображений/месяц
- **Бюджет boundary**: проект соло-разработчика, любое снижение cost критично; сейчас AI-расходы — основная статья OPEX

#### 1.5 Болевые точки текущего OpenRouter (известные проблемы — не нужно подтверждать, но нужно проверить, решает ли их каждый альтернативный провайдер)

1. **Нет explicit context caching** — для Gemini 3.1 Flash Lite caching не работает (OpenRouter не транслирует caching API). Для Gemini 2.5 — implicit caching работает с ограничениями
2. **Нет Batch API** — Google Direct API даёт **50% скидку** на batch, OpenRouter этого не поддерживает
3. **Нет Free tier** — Google AI Studio даёт бесплатное использование Flash моделей с rate limits, OpenRouter всегда платный
4. **5.5% наценка** OpenRouter сверху на pass-through pricing
5. **Ограниченный контроль `thinking_budget`** — OpenRouter маппит `reasoning.effort` → `thinkingLevel`, без точного контроля
6. **`$defs/$ref` баг** для structured outputs (см. 1.3)
7. **Нет `response.parsed`** — прямой SDK даёт Pydantic-объект, OpenRouter — только raw JSON

#### 1.6 Нефункциональные ограничения

- **Регион проекта:** Россия. Поддержка российских платёжных систем — критическое требование (важнее, чем низкая цена)
- **Обход санкций:** Direct Google API из России требует прокси/VPN на VPS-стороне. OpenRouter принимает международные карты + крипту. kie.ai статус неизвестен — критично выяснить
- **Без vendor lock-in:** идеальная архитектура — абстракция над провайдером (как сейчас `OpenRouterClient`), смена провайдера через config
- **Тенденция к гибриду:** один провайдер для LLM, другой — для изображений приемлем

---

### 2. Задачи исследования

Для каждого из трёх провайдеров (kie.ai, Direct Gemini API, OpenRouter) собери и сопоставь данные по перечисленным ниже измерениям. Источники указывай рядом с каждым фактом — официальные docs, pricing pages, status pages, GitHub-репозитории SDK, обсуждения на Reddit/HN/HuggingFace forums (с маркером «community report, дата»). Если данные расходятся между источниками — отметь конфликт явно и укажи приоритет (официальное > SDK README > community).

#### 2.1 Pricing (главный фокус)

Для каждого провайдера составь полную pricing-таблицу по **состоянию на 27 апреля 2026** для **наиболее актуальных моделей**.

> ⚠️ **КРИТИЧНОЕ ПРАВИЛО — НЕ КОПИРУЙ МОДЕЛИ ИЗ ТЕКУЩЕГО СТЕКА fancai.** Текущая конфигурация (Gemini 2.5 Flash, FLUX.2 Klein 4B) приведена в разделе 1.2 **только** как baseline для cost-сравнения. В таблицах 2.1 ниже сравниваются **flagship/mid/cheap модели актуальные на 2026-04-27**, даже если они никогда не использовались в проекте. fancai готов мигрировать модели **вместе** со сменой провайдера, если новые модели выгоднее. Модели старше 6 месяцев включай только если они всё ещё являются flagship у провайдера.

**LLM — найди и сравни 3-5 актуальных моделей на провайдера (минимум)**

Для каждого провайдера найди следующие категории на дату 2026-04-27:

1. **Flagship reasoning** (для critical tasks: extraction, dedup, synthesis) — самая мощная LLM, доступная у этого провайдера. Кандидаты к обязательной проверке: новейшее **Gemini 3 поколение** (3.1 Pro / 3.2 Pro / 3.2 Ultra если выпущена), **Claude Opus 4.7**, GPT-5 если зарелизен, o3/o4 reasoning models, DeepSeek-R2 / Qwen3.5-Max если включены провайдером.
2. **Mid-tier balanced** (оптимум cost/quality для основного объёма extraction): новейший **Gemini 3 Flash** (3.0/3.1/3.2 в зависимости от того что уже актуально), Claude Sonnet 4.6, GPT-5 mini.
3. **Cheap fast** (для translation, dedup, простых задач): новейший **Gemini 3 Flash-Lite**, Claude Haiku 4.5, GPT-5 nano.
4. **Open-weights tier** (опционально, если провайдер хостит open модели по выгодной цене): актуальные на 2026-04-27 поколения Llama / Qwen / DeepSeek / Mistral.

Для каждой найденной модели заполни:

| Модель | Provider Model ID | Релиз / preview-status | Standard input/1M | Standard output/1M | Cached input/1M | Batch input/1M | Batch output/1M | Storage / 1M tok / hour | Context window | Max output | Thinking-токены отдельно (если applicable) |
| ------ | ----------------- | ---------------------- | ----------------- | ------------------ | --------------- | -------------- | --------------- | ----------------------- | -------------- | ---------- | ------------------------------------------ |

Минимум **3-5 LLM на провайдера** = итоговая таблица 9-15 строк. Если у kie.ai заявлены те же модели что у Direct Gemini, но дешевле — особо зафиксируй разницу в наценке (Direct cost vs kie.ai cost vs OpenRouter cost = ratio).

Обязательно отдельно укажи:

- **Markup / fee** провайдера (kie.ai и OpenRouter — какой % сверху официального Google pricing? Direct Gemini — нет markup, но есть quotas/billing tiers)
- **Free tier** (если есть): какие модели, какой rate limit, какие geo-ограничения
- **Tier-based pricing**: разные ли цены для free/paid/enterprise tier
- **Volume discounts**: есть ли scaling pricing для high-volume

**Image generation — найди и сравни 3-5 актуальных моделей на провайдера (минимум)**

> ⚠️ **НЕ ОГРАНИЧИВАЙСЯ FLUX.2 Klein и Imagen 3** (это текущий и устаревший варианты fancai). На 2026-04-27 в production-доступе должны быть как минимум:
>
> - **Nano Banana 2** (новейшая Google image модель — в комплекте с Gemini API)
> - **GPT Image 2** (новейшая OpenAI image модель)
> - Новейшие поколения **Imagen** (4, 5 или то что актуально на дату)
> - **FLUX.3** / **FLUX.2 Pro** или то что является flagship у Black Forest Labs на дату
> - **Stable Diffusion 4** / **SDXL Turbo 2** или новейшее у Stability AI
> - **Recraft v4** / **Ideogram v3** для type-aware иллюстраций (тексты в картинках важны для книжных обложек)
> - **Midjourney v8 API** если он стал доступен через API
>
> Найди их через WebSearch с фильтром свежести (последние 2-3 месяца). Если какая-то модель из списка ещё не релизнута — пометь «не релизнута на 2026-04-27» и не включай в сравнение.

Категории для каждого провайдера:

1. **Flagship photorealistic** (для критичных illustrations: cover-style, character portraits) — лучшее качество доступное на провайдере на 2026-04-27
2. **Mid-tier balanced** (стандартные сцены, средняя цена) — оптимум cost/quality
3. **Cheap fast** (preview/thumbnail mode, batch-генерация) — самая дешёвая годная модель
4. **Type-aware** (если применимо) — модель умеющая отрисовывать читаемый текст внутри изображения

Для каждой модели заполни:

| Модель | Provider Model ID | Релиз | Per-image cost (1024×1024) | Per-MP cost | Max resolution | Поддержка negative prompt | Поддержка ControlNet/img2img | Native text rendering quality (low/mid/high) | Latency p50 | Style range (photo / illustration / anime / mixed) |
| ------ | ----------------- | ----- | -------------------------- | ----------- | -------------- | ------------------------- | ---------------------------- | -------------------------------------------- | ----------- | -------------------------------------------------- |

Минимум **3-5 image моделей на провайдера** = итоговая таблица 9-15 строк.

Особый интерес для fancai:

- Photorealistic style для обложек / character portraits
- Native text rendering (для иллюстраций с подписями)
- Fast/cheap batch-режим для preview-картинок
- Img2img / inpainting (для regenerate отдельных частей картинки)

**Embeddings — найди наиболее актуальные на 2026-04-27 (опционально, на будущее)**

> ⚠️ Найди flagship и cheap-tier embedding модели у каждого провайдера на 2026-04-27. **Не ограничивайся** `gemini-embedding-001` — он уже устарел. Кандидаты к проверке: новейшее `gemini-embedding-2` / `gemini-embedding-3` поколение, `text-embedding-4` (OpenAI), Voyage AI v3.x, Cohere Embed v4, новые multimodal embeddings.

| Модель | Provider Model ID | Релиз | Dimensions (range) | Max input tokens | Multimodal? (text/image/audio/video) | Per-1M tokens cost (standard) | Per-1M cost (batch) | MTEB benchmark score (если опубликован) |
| ------ | ----------------- | ----- | ------------------ | ---------------- | ------------------------------------ | ----------------------------- | ------------------- | --------------------------------------- |

#### 2.2 Feature parity (критично для extraction/synthesis pipeline)

Для каждого провайдера явно подтвердить (yes/no/partial + примечание + источник):

1. **Structured outputs** через JSON Schema / Pydantic (нативная поддержка через SDK или нужен manual JSON post-processing)
2. **Поддержка `$defs/$ref`** в JSON Schema (важно для вложенных Pydantic-схем без хака `_inline_defs`)
3. **`response.parsed`** возвращает Pydantic-объект (или только raw JSON)
4. **Function calling / Tools API** (формат — OpenAI compatible или native Gemini)
5. **Streaming** (SSE / chunked)
6. **System instructions** (отдельное поле или часть user message)
7. **Multi-turn conversation** (sessions API или stateless)
8. **Multimodal input** (image, PDF, audio, video — какие форматы и size limits)
9. **Multimodal output** (image, audio — какие модели поддерживают)
10. **Context caching**:
    - Implicit (автоматический prefix cache)
    - Explicit (named cache via API)
    - Cache TTL (default + max)
    - Cache discount (% от standard input)
11. **Batch API**:
    - SLA (24h / 48h / async без гарантий)
    - Discount %
    - Max batch size
    - Поддерживаемые модели
12. **File API / File Search**:
    - Upload PDF / docx / epub
    - Native semantic search by uploaded files
    - Storage cost
13. **Thinking / reasoning controls**:
    - `thinking_budget` (точный контроль количества токенов на reasoning)
    - `reasoning.effort` (low/medium/high)
    - Visible vs hidden thinking output
14. **Live API / WebSocket** (для streaming AI-функций) — нужно ли fancai сейчас? Нет, но на будущее
15. **Model versioning / aliases** (`-latest`, `-preview`, snapshot dates)
16. **Per-request timeout limits** и max concurrent requests

#### 2.3 Reliability / Operations

1. **SLA** (uptime guarantee) — есть ли формальное SLA у каждого провайдера, какой % uptime
2. **Status page** — URL и формат (RSS, JSON API, webhook) для интеграции с внутренним мониторингом
3. **Rate limits** (RPM, TPM):
   - На free tier
   - На paid tier
   - На enterprise tier
   - Возможность повышения через support
4. **Latency**:
   - p50, p95, p99 для extraction-style requests (10K input → 5K output) — найти бенчмарки на artificialanalysis.ai, openrouter.ai/rankings, или community reports
   - Cold start (если провайдер использует serverless infrastructure)
5. **Concurrent requests limit** (одновременных запросов от одного account)
6. **Retry / circuit breaker support** — есть ли best practices от провайдера, какие коды ошибок retryable
7. **Quota / billing alerts** — есть ли native alerting на превышение бюджета
8. **Auto-fallback / automatic routing** — поддерживает ли провайдер автоматическое переключение между моделями (OpenRouter — да, kie.ai — ?, Direct Gemini — нет)
9. **Provenance / request-id correlation** — есть ли request_id в response для debugging

#### 2.4 Регион доступности и compliance

1. **Geo доступность**:
   - Доступен ли API из России без VPN
   - Какие IP-диапазоны блокирует API
   - Есть ли локальный endpoint в Европе/Азии
2. **Data residency**:
   - Где хранятся inputs/outputs
   - Есть ли option выбрать регион
   - Какие residency-соглашения (Vertex AI имеет EU/US separation)
3. **Compliance**:
   - GDPR
   - SOC 2
   - HIPAA (если применимо)
   - ISO 27001
4. **Data retention**:
   - Сколько хранятся requests/responses
   - Используются ли данные для training (по умолчанию)
   - Есть ли opt-out
5. **Privacy / no-training defaults** — на каждом ли tier выключено training на user data
6. **Audit logs** — есть ли native audit trail (для админ-панели fancai в будущем)

#### 2.5 Способы оплаты и billing (Russia-specific критично)

Для каждого провайдера явно:

1. **Принимаемые методы оплаты**:
   - Российские карты (Мир, Visa/MC выпущенные в РФ)
   - Международные карты
   - Криптовалюта (какие сети)
   - Wire transfer
   - PayPal / Stripe / иные
2. **Известные обходы** для российских пользователей:
   - Прокси-сервисы (kie.ai, OpenRouter — если есть verified posts)
   - Виртуальные карты (Pyypl, Wise, иные)
   - Корпоративная регистрация через зарубежного юрлица
3. **Currency support**: USD / EUR / RUB / другие
4. **Billing granularity**: per-request, hourly, daily, monthly
5. **Top-up / postpaid**: prepaid wallet (как OpenRouter) или postpaid invoice
6. **Минимальная сумма пополнения** и сроки активации после оплаты

#### 2.6 SDK / API ergonomics

1. **Python SDK**:
   - Официальный пакет (имя, версия на PyPI)
   - Поддержка async/await
   - Совместимость с Pydantic v2
   - Quality of error messages и типизации
2. **API совместимость**:
   - OpenAI-compatible endpoint (drop-in replacement)
   - Native Gemini SDK
   - Custom REST API
3. **TypeScript SDK** (для админ-панели fancai)
4. **CLI tools** для тестирования из терминала
5. **Documentation quality**:
   - Полнота references
   - Примеры под Python / TypeScript
   - Cookbook / tutorials
   - Migration guides
6. **Community size**:
   - GitHub stars / forks
   - Discord / Slack community
   - Recent issues activity

#### 2.7 Vendor lock-in и архитектурные риски

1. **Уникальные фичи** каждого провайдера (что нельзя получить иначе):
   - Direct Gemini: File Search, native Batch API с 50% discount, нативные Imagen/Veo, free tier
   - OpenRouter: model routing, cross-provider fallback, единый billing
   - kie.ai: TBD — выявить в research
2. **Migration cost ОТ провайдера на другой**:
   - Обратная совместимость API
   - Custom dependencies
   - Caching/state, привязанный к провайдеру
3. **Pricing trajectory**: как менялись цены за последние 6 месяцев у каждого
4. **Long-term viability**:
   - Funding / business model
   - Team size (если public)
   - Track record uptime

#### 2.8 Reputation / community signals

1. **Reddit /r/LocalLLaMA, /r/MachineLearning, HN** — последние обсуждения kie.ai (apr 2026)
2. **Известные incidents** за последние 6 месяцев (outages, billing issues, model recalls)
3. **GitHub issues** на SDK (open issues, response time от maintainers)
4. **Trust signals**: investors, funding rounds, customer logos, transparency reports
5. **Negative signals**: complaints о hidden fees, billing неточности, model substitution (когда «Gemini Pro» оказывается чем-то другим)

---

### 3. Структура отчёта (output format)

Финальный отчёт сохрани как markdown с такой структурой:

```
# Сравнительный аудит AI-провайдеров для fancai: kie.ai vs Direct Gemini API vs OpenRouter

> Дата: 2026-04-27
> Модель: Claude Opus 4.7 (1M context)

## 1. Executive Summary (≤500 слов)

[Главные находки в bullet points:]
- Победитель по cost
- Победитель по features
- Победитель по reliability
- Победитель по Russia-friendliness
- Финальная рекомендация (1-2 предложения)
- Ожидаемая годовая экономия для fancai при миграции на рекомендованный вариант

## 2. Quick Comparison Matrix

[Большая таблица с весами по 8 измерениям × 3 провайдера]

| Измерение | Вес | kie.ai | Direct Gemini | OpenRouter |
| --- | --- | --- | --- | --- |
| Cost (LLM) | 25% | | | |
| Cost (Image) | 10% | | | |
| Feature parity | 20% | | | |
| Reliability | 15% | | | |
| Russia payments | 10% | | | |
| Migration cost | 10% | | | |
| Lock-in risk | 5% | | | |
| Ecosystem | 5% | | | |
| **Weighted total** | **100%** | | | |

## 3. Per-Provider Deep Dive

### 3.1 kie.ai

#### Pricing tables (полные таблицы из 2.1)
#### Feature parity (yes/no/partial с источниками)
#### Reliability / Operations
#### Regional availability и payments
#### SDK / API
#### Strengths и weaknesses (списком)
#### Hidden gotchas (выявленные в research)

### 3.2 Direct Gemini API

[Аналогично]

### 3.3 OpenRouter

[Аналогично, с акцентом на «что мы теряем при миграции»]

## 4. Cost Modeling для fancai

### 4.1 Расчёт стоимости одной книги (50 глав)

[Для каждого провайдера: extraction + dedup + synthesis + translation + N images]

| Сценарий | kie.ai | Direct Gemini | OpenRouter |
| --- | --- | --- | --- |
| Книга 50 глав, без caching, без batch | $X | $Y | $Z (текущая) |
| Книга 50 глав, с implicit caching | | | |
| Книга 50 глав, через Batch API | | | |

### 4.2 Месячная стоимость

| Сценарий | kie.ai | Direct Gemini | OpenRouter |
| --- | --- | --- | --- |
| 100 книг/месяц | | | |
| 1000 книг/месяц | | | |
| Break-even point (когда Direct Gemini обгоняет kie.ai из-за batch) | N книг/месяц | — | — |

### 4.3 Image generation costs

[По N images/месяц]

## 5. Migration Path Analysis

### 5.1 OpenRouter → kie.ai

- Какие файлы нужно изменить (укажи `backend/app/core/openrouter_client.py`, `backend/app/services/gemini_extractor.py:126`, etc.)
- Сколько LOC нужно переписать
- Сколько стоит время разработки (приблизительно в человеко-днях)
- Critical risks (например: structured outputs работают/не работают)
- Rollback plan

### 5.2 OpenRouter → Direct Gemini API

[Аналогично]

### 5.3 Гибрид: разные провайдеры для разных задач

[Предложить optimal split: extraction через X, image generation через Y, fallback через Z]

## 6. Risk Assessment

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| kie.ai banned in Russia | | | |
| kie.ai pricing rises | | | |
| kie.ai reliability issues | | | |
| Direct Gemini blocked в РФ | | | |
| OpenRouter raises markup | | | |
| Vendor model substitution (kie.ai даёт другую модель под видом Gemini) | | | |

## 7. Recommendation

[Финальная рекомендация с обоснованием — 1 страница]

### Decision tree

[Если cost критичен → провайдер X. Если reliability → Y. Если гибрид приемлем → split]

### First step (executable)

[Конкретный first action: например — «Создать kie.ai account, прогнать 10 chapters через extraction, сравнить outputs vs OpenRouter»]

## 8. Appendix

### 8.1 Sources (все URL с датами обращения)
### 8.2 Pricing snapshots (для воспроизводимости — даты, raw цифры)
### 8.3 Открытые вопросы (что не удалось выяснить, и почему)
```

---

### 4. Quality criteria (что считать хорошим research'ом)

✅ **Все таблицы используют модели актуальные на 2026-04-27** — flagship / mid-tier / cheap каждого провайдера. Текущий стек fancai (Gemini 2.5 Flash, FLUX.2 Klein 4B) в таблицах сравнения **не появляется** иначе как baseline-цифра для cost-калькуляции. Если на 2026-04-27 у Google flagship — Gemini 3.2 Pro, у OpenAI — GPT-5 / GPT Image 2, у BFL — FLUX.3 — сравниваем именно их. Это критическое требование: устаревшие модели не учитывают сегодняшний рынок.

✅ **Каждое pricing-утверждение** имеет URL источника + дата обращения. Если pricing меняется ежемесячно — пометь «volatile».

✅ **Feature parity** проверяется не по маркетинг-страницам, а по docs / API references / SDK source. Если в docs написано «supported», но community report говорит «работает с багами» — отметь оба.

✅ **kie.ai** требует особого внимания — это менее изученный провайдер, чем OpenRouter и Direct Gemini. Найди:

- Реальный business model (откуда такие низкие цены — subsidized, training on data, model substitution, just-launched promo?)
- Owner / team (доверяемая ли команда?)
- Independent benchmarks от пользователей, проверяющих identity модели (что под именем «Gemini 3 Flash» отдаётся именно Gemini, а не Llama-fine-tuned)

✅ **Russia-specific факты** — отдельный раздел. Не предполагай, что «работает с международными картами» = «работает из РФ».

✅ **Cost modeling** должен быть воспроизводимый — покажи формулу расчёта, не только финальную цифру.

✅ **Recommendation** должна быть actionable — не «нужно ещё подумать», а конкретный first step.

✅ **Appendix Sources** — 30+ URL минимум для серьёзного исследования трёх провайдеров.

---

### 5. Что НЕ нужно делать

❌ **Не копировать список моделей** из текущего стека fancai (Gemini 2.5 Flash, FLUX.2 Klein 4B). Эти модели — **только baseline для cost-сравнения**, а не основной список для сравнения. Сравниваются flagship/mid/cheap модели **актуальные на 2026-04-27** (Gemini 3-поколение, GPT Image 2, Nano Banana 2, FLUX.3, Imagen 4/5 и любые другие, релизнутые/доступные на дату). Если ленится поиск — отчёт будет переделан.

❌ **Не ограничивать image research** только семействами FLUX и Imagen. На 2026-04-27 Google уже выпустил Nano Banana 2, OpenAI — GPT Image 2; найди их и проверь доступность через каждого провайдера (kie.ai / Direct / OpenRouter). Если провайдер не предлагает свежую модель — это сам по себе минус провайдеру в сравнении.

❌ **Не предполагать**, что pricing 2026-03-30 (gemini-api-consolidated.md) всё ещё актуально на 2026-04-27 — Gemini цены меняются раз в 2-4 недели. Перепроверь все цифры через WebFetch на ai.google.dev/pricing.

❌ **Не доверять** одному источнику pricing — у Google есть три pricing-страницы (AI Studio, Vertex AI, Gemini API), у OpenRouter pricing меняется через UI, у kie.ai docs могут быть устаревшими. Сверяй минимум 2 источника на ключевую цифру.

❌ **Не использовать** общие фразы вроде «kie.ai дешевле в несколько раз» без конкретных цифр и моделей.

❌ **Не игнорировать** edge cases: что если Batch API падает на больших books, что если caching не работает с TSA mode, что если kie.ai ограничивает context window до 32K (а не 1M).

❌ **Не выходить** за scope: НЕ исследуй self-hosted альтернативы (vLLM, Ollama), НЕ исследуй другие aggregators (TogetherAI, Replicate, Fireworks) — фокус строго на трёх провайдерах. Если по ходу research встретишь намёк, что какой-то четвёртый провайдер критически важен — отдельным абзацем во введении укажи это, но не углубляйся.

❌ **Не давать рекомендацию** без cost modeling — расчёт стоимости одной книги для трёх провайдеров обязателен.

❌ **Не упрощать** Russia-specific. Если не можешь подтвердить, что kie.ai работает с российскими картами, явно напиши «не подтверждено», а не предполагай.

---

### 6. Дополнительные указания

#### 6.1 Источники (приоритет)

1. **Официальные docs / pricing pages** провайдеров
2. **GitHub repos** официальных SDK (для проверки feature parity на уровне API)
3. **artificialanalysis.ai**, **openrouter.ai/rankings** для бенчмарков latency/quality
4. **community reports** на Reddit (особенно /r/LocalLLaMA, /r/MachineLearning, /r/Bard), HackerNews (через algolia.hn.com), HuggingFace Hub forums
5. **Twitter/X**: @OpenRouterAI, @demishassabis (Google DeepMind), kie.ai official accounts — последние новости
6. **YouTube/podcasts** — если есть свежие интервью CEO провайдеров с pricing/roadmap discussion

#### 6.2 Формат веб-поиска

При поиске используй фильтр свежести (после 2026-03-01 или 2026-04-01 для самых критичных фактов). Если поиск возвращает результаты только из 2025 года — явно отметь «свежих данных не найдено, использован источник от DATE».

#### 6.3 Отдельный фокус на kie.ai

Поскольку это малоизвестный провайдер, на него потрать ~40% research-времени:

- Найти их changelog / blog за последние 3 месяца
- Найти их Status page и uptime history
- Найти reviews от пользователей с production использованием
- Проверить их Terms of Service на:
  - Training on user data
  - Data retention
  - Russia / sanctioned countries clauses
  - Pricing change policies
- Прогнать их API через простой тест (если возможно через WebFetch на playground / curl examples из docs)

#### 6.4 Хранение черновиков

Если в ходе research'а найдёшь интересные факты, не вписывающиеся в основной отчёт, собери их в раздел `Appendix → Bonus findings`. Например: новая модель, которая выйдет через месяц, или планы Google по Free tier.

#### 6.5 Формат имени файла отчёта

Сохрани финальный отчёт как `docs/research/kieai-vs-gemini-direct-vs-openrouter-comparison-2026-04-27.md` (без префикса PROMPT-).

---

### 7. Контрольные вопросы (для самопроверки перед сдачей отчёта)

Перед тем как вернуть результат, ответь себе на эти вопросы — если на любой из них ответ «нет», вернись и доработай:

1. ✅ Я использовал **flagship/mid/cheap модели актуальные на 2026-04-27** (Gemini 3-поколение, GPT Image 2, Nano Banana 2, новейший FLUX и т.д.), а не устаревший стек fancai (Gemini 2.5 Flash, FLUX.2 Klein 4B)?
2. ✅ Я указал актуальный pricing для всех 9+ LLM моделей и 9+ image моделей с источниками-URL?
3. ✅ Я подтвердил feature parity по 16 критериям из 2.2 для каждого провайдера?
4. ✅ Я проверил, работает ли kie.ai из России (платежи + geo доступ)?
5. ✅ Я рассчитал стоимость одной книги (50 глав) для каждого провайдера с показанной формулой?
6. ✅ Я подтвердил, что structured outputs с вложенными `$defs/$ref` работают (или не работают) у каждого?
7. ✅ Я нашёл свидетельства Russia-friendliness каждого провайдера?
8. ✅ Я указал хотя бы 30 URL-источников в Appendix?
9. ✅ Я предложил гибридную архитектуру (разные провайдеры для разных задач)?
10. ✅ Моя финальная рекомендация имеет один конкретный first-step (действие, а не «изучить дальше»)?
11. ✅ Я честно отметил все «не подтверждено» / «не удалось выяснить» вместо предположений?

---

### 8. Тон и стиль

- Пиши **на русском языке** (соответствует принятой в fancai конвенции для research-документов)
- **Цифры важнее слов** — `$0.10/$0.40 per 1M tokens` лучше, чем «дёшево»
- **Списки и таблицы** предпочтительнее абзацев в местах сравнения
- **Без маркетинг-языка**: вместо «безупречная производительность» пиши конкретные latency и cost-факты
- **Источники** — рядом с фактом (markdown footnote или inline `[source](url)`), не только в конце документа
- **Если нашёл противоречие** в источниках — отметь явно, не пытайся сгладить

---

### 9. Контекст проекта в одной фразе

fancai — российский production AI-проект соло-разработчика, использующий ~$50–500/месяц на AI и готовый сменить **и провайдера, и модели одновременно** ради (а) экономии 30%+ при сохранении качества или (б) существенного качественного скачка при сопоставимой цене. Условия для нового стека: (1) работает из РФ с российскими платежами, (2) поддерживает structured outputs с Pydantic schema (включая вложенные `$defs/$ref`), (3) даёт reliable доступ к **flagship-моделям актуальным на 2026-04-27** (новейшее Gemini 3-поколение, GPT-5 / Claude 4.7 / Gemini 3.2 Pro, новейшие image — Nano Banana 2 / GPT Image 2 / FLUX.3) без model substitution, (4) обеспечивает SLA приближённое к OpenRouter (99.9%+ uptime), (5) не блокирует масштабирование в 10–100x в течение года.

Твоя задача — определить, выполняется ли это для kie.ai, для Direct Gemini API, и сравнить оба с текущим OpenRouter, чтобы соло-разработчик мог принять обоснованное решение в один заход без дополнительных раундов research. **Не привязывайся к моделям, которые fancai использует сейчас — они устарели для целей этого сравнения.**

---

**Начинай. Используй WebSearch и WebFetch активно. Не торопись с выводами. Качество > скорость.**
