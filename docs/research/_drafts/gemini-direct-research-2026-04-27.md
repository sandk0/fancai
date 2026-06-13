# Direct Gemini API (Google AI Studio + Vertex AI) — глубокое исследование (2026-04-27)

> Дата исследования: 2026-04-27. Все цены и фичи на эту дату. Цены Gemini меняются раз в 2-4 недели — перепроверять перед закупкой.
>
> **Контекст:** baseline fancai сейчас на OpenRouter с `google/gemini-2.5-flash` (deprecated 2026-06-17) и `flux.2-klein-4b`. Этот документ оценивает, есть ли смысл уйти на Direct Gemini.

---

## 1. Pricing

### 1.1 LLM модели — актуальный лайн-ап на 2026-04-27

⚠️ **Ключевое изменение режима:** `gemini-3-pro-preview` снят с обслуживания **26 марта 2026**. Production-кандидат сейчас — `gemini-3.1-pro-preview` (preview, paid-only с 1 апреля 2026). [Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro), [Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)

| Модель                                                         | Provider Model ID               | Релиз / статус                              | Std input/1M (≤200K) | Std output/1M (≤200K) | Std input/1M (>200K) | Std output/1M (>200K) | Implicit-cached input      | Explicit-cached input                | Batch input/1M | Batch output/1M | Storage cache /1M tok/hour | Context window | Max output         | Thinking-токены             |
| -------------------------------------------------------------- | ------------------------------- | ------------------------------------------- | -------------------- | --------------------- | -------------------- | --------------------- | -------------------------- | ------------------------------------ | -------------- | --------------- | -------------------------- | -------------- | ------------------ | --------------------------- |
| **Gemini 3.1 Pro Preview**                                     | `gemini-3.1-pro-preview`        | preview, GA Q2 2026, paid-only с 2026-04-01 | $2.00                | $12.00                | $4.00                | $18.00                | n/a (75% off via explicit) | $0.20 (90% off реклам / 75% по docs) | $1.00          | $6.00           | $4.50                      | 2M             | ~64K вкл. thinking | биллится как output @ $12   |
| **Gemini 3 Flash Preview**                                     | `gemini-3-flash-preview`        | preview, ноябрь 2025; audio input $1/1M     | $0.50                | $3.00                 | n/a (single tier)    | n/a                   | $0.05                      | $0.05                                | $0.25          | $1.50           | $1.00                      | 1M             | ~64K               | биллится как output @ $3    |
| **Gemini 3.1 Flash-Lite Preview**                              | `gemini-3.1-flash-lite-preview` | preview, релиз 2026-03-03                   | $0.25                | $1.50                 | n/a                  | n/a                   | ~$0.025                    | ~$0.025                              | $0.125         | $0.75           | $1.00                      | 1M             | ~64K               | биллится как output @ $1.50 |
| **Gemini 2.5 Pro** ⚠️ deprecated 2026-06-17                    | `gemini-2.5-pro`                | GA, sunset 2026-06-17                       | $1.25                | $10.00                | $2.50                | $15.00                | $0.31                      | $0.31                                | $0.625         | $5.00           | $4.50                      | 2M             | 64K                | да, биллится как output     |
| **Gemini 2.5 Flash** ⚠️ baseline fancai, deprecated 2026-06-17 | `gemini-2.5-flash`              | GA, sunset 2026-06-17                       | $0.30                | $2.50                 | n/a                  | n/a                   | $0.075                     | $0.075                               | $0.15          | $1.25           | $1.00                      | 1M             | 64K                | да                          |
| **Gemini 2.5 Flash-Lite** ⚠️ deprecated Jul-Oct 2026           | `gemini-2.5-flash-lite`         | GA, sunset Q3 2026                          | $0.10                | $0.40                 | n/a                  | n/a                   | $0.025                     | $0.025                               | $0.05          | $0.20           | $1.00                      | 1M             | 64K                | опционально                 |
| **Gemma 4 31B Instruct** (open-weights API)                    | `gemma-4-31b-it`                | релиз 2026-04-02, через Vertex Model Garden | $0.13                | $0.38                 | n/a                  | n/a                   | n/a                        | n/a                                  | $0.065         | $0.19           | n/a                        | 128K           | 8K                 | нет (non-thinking)          |
| **Gemma 4 26B A4B (MoE)**                                      | `gemma-4-26b-a4b-it`            | релиз 2026-04-02, serverless Model Garden   | $0.06                | $0.33                 | n/a                  | n/a                   | n/a                        | n/a                                  | $0.03          | $0.165          | n/a                        | 128K           | 8K                 | нет                         |

**Замечания по colonels данных:**

- Цифры по 3.1 Pro и 3 Flash сверены: [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing), [AI Studio pricing](https://ai.google.dev/gemini-api/docs/pricing), [aipricing.guru April 2026](https://www.aipricing.guru/google-ai-pricing/), [glbgpt 3.1 Pro guide](https://www.glbgpt.com/hub/gemini-3-1-pro-cost-complete-2026-pricing-guide/), [Verdent guides 3.1 Pro pricing](https://www.verdent.ai/guides/gemini-3-1-pro-pricing).
- ⚠️ **Расхождение по explicit-cache discount**: Verdent guides пишет 75% (т.е. $0.50/1M на Pro), реклама/блоги — 90% (т.е. $0.20/1M). Официальная docs-страница AI Studio называет $0.20 — берём её. [docs caching](https://ai.google.dev/gemini-api/docs/caching).
- **Audio input** на всех моделях — премиум: $1/1M на 3 Flash. Видео — как text/image. [pricepertoken Gemini 3 Flash](https://pricepertoken.com/pricing-page/model/google-gemini-3-flash-preview).
- **Batch API даёт ровно 50% скидку** на ВСЕ типы токенов (input + output + cached). Подтверждено мульти-источниково. [Vertex batch docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini), [yingtu batch vs caching](https://yingtu.ai/en/blog/gemini-api-batch-vs-caching).

### 1.2 Free tier — что доступно бесплатно

| Tier               | Модели                                                                                            | RPM                     | RPD              | TPM     | Geo                              | Privacy                                               |
| ------------------ | ------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- | ------- | -------------------------------- | ----------------------------------------------------- |
| **AI Studio Free** | Gemini 2.5 Flash, 2.5 Flash-Lite, 3.1 Flash-Lite (3.1/3 Pro **НЕ доступны** на free с 2026-04-01) | 5–15                    | 25–1,500         | 250K–1M | 230+ стран, **Россия исключена** | **Google тренируется на твоих данных + human review** |
| **Paid (PAYG)**    | все модели                                                                                        | 150–4000+ RPM (по тиру) | без жёсткого RPD | по тиру | везде где AI Studio + Vertex     | **No training**, opt-out by default                   |

Источники: [AI Studio pricing](https://ai.google.dev/gemini-api/docs/pricing), [aifreeapi free tier limits](https://www.aifreeapi.com/en/posts/gemini-api-free-tier), [aipricing.guru April 2026](https://www.aipricing.guru/google-ai-pricing/), [remio.ai AI Studio terms](https://www.remio.ai/post/new-google-ai-studio-terms-ban-consumer-use-the-developer-pivot), [discuss.ai data privacy paid plans](https://discuss.ai.google.dev/t/data-privacy-on-ai-studios-paid-plans-important/75253).

⚠️ **Изменение апреля 2026:** Pro-модели больше не доступны на free tier. Только Flash/Flash-Lite. Free tier формально перевели в "for developers only — no consumer use".

### 1.3 Tier scaling (paid)

[aifreeapi rate limits per tier](https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier):

- **Tier 1** (после привязки billing) — 150–300 RPM
- **Tier 2** ($250 cumulative spend) — 1,000+ RPM
- **Tier 3** (enterprise / по запросу) — 4,000+ RPM, custom quotas

Volume / committed-use discounts (CUD) на Vertex есть для Provisioned Throughput — нужно резервировать GSU (Generative AI Scale Units) на месяцы. Не для соло-разработчика. [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing).

### 1.4 AI Studio vs Vertex AI vs Gemini API — pricing дельта

**Реально цены идентичны** по per-token rate ([geminipricing.com Vertex 2026](https://geminipricing.com/vertex-ai-pricing)). Разница в:

- Vertex добавляет **Provisioned Throughput** опции (резервированная capacity)
- Vertex даёт **regional endpoints** (us-central1, europe-west4 и др.) — но **3.1 Pro и 3 Flash сейчас только global endpoint** ([Vertex 3.1 Pro doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro), [forum Apr 2026](https://discuss.google.dev/t/404-not-found-unable-to-access-vertex-ai-gemini-3-pro-preview-in-europe-west8/288743))
- Vertex даёт **enterprise compliance** (FedRAMP High, HIPAA BAA, частный VPC, CMEK)
- AI Studio проще: один API key, без GCP project setup

### 1.5 Image generation — 3-5 моделей

| Модель                                         | Model ID                            | Релиз       | Цена/изображение                               | Max resolution | Negative prompt | ControlNet/img2img/inpainting | Native text rendering        | Free quota                            | Deprecation |
| ---------------------------------------------- | ----------------------------------- | ----------- | ---------------------------------------------- | -------------- | --------------- | ----------------------------- | ---------------------------- | ------------------------------------- | ----------- |
| **Nano Banana Pro** (= Gemini 3 Pro Image)     | `gemini-3-pro-image-preview`        | ноябрь 2025 | $0.134 (1K-2K), $0.24 (4K), $0.067/$0.12 batch | 4K (4096px)    | да              | да (multi-turn editing)       | **отлично** (фирменная фича) | 100/день free                         | —           |
| **Nano Banana 2** (= Gemini 3.1 Flash Image)   | `gemini-3.1-flash-image` (вариации) | 2026-02-26  | $0.045 (512px) → $0.151 (4K), batch ½          | 4K             | да              | да                            | очень хорошо                 | 500/день free (топ среди провайдеров) | —           |
| **Imagen 4 Fast** ⚠️ deprecated 2026-06-24     | `imagen-4.0-fast-generate-001`      | GA          | $0.02                                          | 1024           | нет             | нет                           | средне                       | 0                                     | 2026-06-24  |
| **Imagen 4 Standard** ⚠️ deprecated 2026-06-24 | `imagen-4.0-generate-001`           | GA          | $0.04                                          | 2K             | да              | partial (img2img)             | хорошо                       | 0                                     | 2026-06-24  |
| **Imagen 4 Ultra** ⚠️ deprecated 2026-06-24    | `imagen-4.0-ultra-generate-001`     | GA          | $0.06                                          | 2K             | да              | да                            | очень хорошо                 | 0                                     | 2026-06-24  |

Источники: [intuitionlabs image pricing](https://intuitionlabs.ai/articles/ai-image-generation-pricing-google-openai), [aifreeapi image gen free tier](https://www.aifreeapi.com/en/posts/gemini-image-generation-free-api), [Imagen 4 GA blog](https://developers.googleblog.com/announcing-imagen-4-fast-and-imagen-4-family-generally-available-in-the-gemini-api/), [aifreeapi 3 Pro Image vs Imagen 4](https://www.aifreeapi.com/en/posts/gemini-3-pro-image-preview-vs-imagen-4), [laozhang Nano Banana Pro pricing](https://blog.laozhang.ai/en/posts/gemini-3-pro-image-api-pricing).

⚠️ **КРИТИЧНО:** Все Imagen 4 умирают 24 июня 2026. Google сам говорит "migrate to Nano Banana". Так что для fancai реальных кандидатов на 1024×1024 — два: **Nano Banana 2** (~$0.045/img на 512, ~$0.07 на 1K) или **Nano Banana Pro** (~$0.134/img на 1K).

⚠️ **Для baseline fancai** (`flux.2-klein-4b` через OpenRouter @ ~$0.014-0.016/img) — Nano Banana 2 будет в 3–5× дороже за изображение. Качество картинки — другая история (Nano Banana = state-of-the-art в text rendering, FLUX = другая школа).

### 1.6 Embeddings

| Модель                              | Provider Model ID            | Релиз     | Std input/1M    | Batch input/1M | Output dimensions (MRL) | Max input tokens                    |
| ----------------------------------- | ---------------------------- | --------- | --------------- | -------------- | ----------------------- | ----------------------------------- |
| **Gemini Embedding 001**            | `gemini-embedding-001`       | GA        | $0.15           | $0.075         | 3072 / 1536 / 768       | 2048                                |
| **Gemini Embedding 2** (multimodal) | `gemini-embedding-2-preview` | март 2026 | $0.15 (preview) | $0.075         | 3072 / 1536 / 768       | 2048 (text); image/video/audio тоже |

Источники: [tokenmix gemini-embedding-001 guide 2026](https://tokenmix.ai/blog/gemini-embedding-001-dimensions-pricing-guide-2026), [Gemini Embedding 2 blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/), [Gemini Embedding GA blog](https://developers.googleblog.com/gemini-embedding-available-gemini-api/).

⚠️ **Для fancai значимо:** embeddings нативно поддерживают **truncation 3072→1536→768 без потери качества** (Matryoshka). Это удобно если потом захочется semantic search в книгах.

---

## 2. Feature parity (16 критериев)

| #   | Критерий                                      | Verdict                                                                                               | Источник + комментарий                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Structured outputs JSON Schema/Pydantic       | **YES** native — `response_schema=PydanticModel` или `response_mime_type="application/json"` + schema | [Structured outputs DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5-function-calling), [forum Pydantic](https://discuss.ai.google.dev/t/response-schema-from-pydantic/50028)                                                                                                                                                                                                                                    |
| 2   | $defs/$ref в JSON Schema (вложенные Pydantic) | **PARTIAL → YES в новых SDK**                                                                         | Был баг (Issue #60), на нынешнем SDK SDK сам инлайнит $defs ([Pydantic integration DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5.1-pydantic-model-integration)). **Дефолтные значения Pydantic полей всё ещё могут ломать** ([Issue #699](https://github.com/googleapis/python-genai/issues/699)) — `Field(default=...)` иногда отвергается. Workaround: убрать defaults или использовать `Optional[T]=None`. |
| 3   | `response.parsed` → Pydantic-объект           | **YES**                                                                                               | SDK автоматически парсит JSON в инстанс класса, переданного в `response_schema`. [DeepWiki structured outputs](https://deepwiki.com/googleapis/python-genai/3.5-function-calling)                                                                                                                                                                                                                                          |
| 4   | Function calling / Tools API                  | **YES** native                                                                                        | Поддержка автоматической конвертации Python функций в tool declarations через `types.Tool(function_declarations=[...])`. [SDK docs](https://googleapis.github.io/python-genai/)                                                                                                                                                                                                                                            |
| 5   | Streaming (SSE/chunked)                       | **YES**                                                                                               | `client.models.generate_content_stream(...)` или `aio.generate_content_stream(...)`                                                                                                                                                                                                                                                                                                                                        |
| 6   | System instructions                           | **YES** отдельное поле                                                                                | `config=types.GenerateContentConfig(system_instruction="...")`                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Multi-turn conversation                       | **YES**                                                                                               | `client.chats.create(model=..., config=...)` + `chat.send_message(...)`. Также можно stateless через массив `contents`.                                                                                                                                                                                                                                                                                                    |
| 8   | Multimodal input (image/PDF/audio/video)      | **YES, native**                                                                                       | PDF до 50MB / 1000 страниц, файлы до 5GB/файл и 50GB на проект через File API. [Gemini File API docs](https://ai.google.dev/gemini-api/docs/files), [blog file limits](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/)                                                                                                                                                      |
| 9   | Multimodal output (image, audio)              | **YES** для image (Gemini 3 Pro Image), audio (Live API)                                              | Native generation — отдельные модели                                                                                                                                                                                                                                                                                                                                                                                       |
| 10a | Implicit caching                              | **YES, бесплатно**                                                                                    | Автомат, нет storage cost. **Без discount гарантии** — но при cache hit input идёт по cached rate. Размер минимума: 1024 токенов на Flash, 4096 на Pro. [docs caching](https://ai.google.dev/gemini-api/docs/caching), [aifreeapi caching guide](https://www.aifreeapi.com/en/posts/gemini-api-context-caching-reduce-cost)                                                                                                |
| 10b | Explicit caching (named cache)                | **YES**                                                                                               | Минимум 32K токенов на 3.1 Pro. TTL дефолт 1 час, max — настраиваемый. Storage $4.50/1M tok/hour для Pro, $1.00 для Flash. Discount **75% (или 90% по реклам — расхождение)**. [Vertex context cache overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview), [geminipricing context caching](https://www.geminipricing.com/context-caching)                            |
| 11  | Batch API                                     | **YES, 50% discount**                                                                                 | SLA до 24 часов, async. Поддержка ВСЕХ Gemini 2.5 + 3.x моделей. Submission: file upload (JSONL) или inline. **Нет hard cap на batch size** — рекомендация одного "fat" job на 200K requests лучше тысячи мелких. [Vertex batch docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini), [Gemini API batch docs](https://ai.google.dev/gemini-api/docs/batch-api)             |
| 12  | File API (PDF/docx/epub/image/audio/video)    | **YES, бесплатно**                                                                                    | Storage **бесплатно** (но retention 48 часов). До 5GB/файл, 50GB на проект. [files docs](https://ai.google.dev/gemini-api/docs/files)                                                                                                                                                                                                                                                                                      |
| 13a | `thinking_budget` точный контроль             | **YES**                                                                                               | На Gemini 3.x — упрощение через `thinking_level: LOW/MEDIUM/HIGH`. На 2.5 — численный budget в токенах. [thinking docs](https://ai.google.dev/gemini-api/docs/thinking), [Vertex thinking](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking)                                                                                                                                                            |
| 13b | `reasoning.effort` mapping                    | **YES**, через `thinking_level`                                                                       | LOW / MEDIUM / HIGH соответствует фиксированным budget'ам                                                                                                                                                                                                                                                                                                                                                                  |
| 13c | Visible vs hidden thinking output             | hidden by default; через `include_thoughts=True` можно получить thought summaries                     | [thinking docs](https://ai.google.dev/gemini-api/docs/thinking)                                                                                                                                                                                                                                                                                                                                                            |
| 13d | Стоимость thinking tokens                     | **YES, биллится как output @ standard rate**                                                          | На 3.1 Pro — $12/1M, на 3 Flash — $3/1M. **Это ОЧЕНЬ дорого**: при HIGH 95% output может уйти на скрытые thoughts. [apiyi explainer](https://help.apiyi.com/en/gemini-3-1-pro-thinking-tokens-output-high-explained-en.html), [Verdent pricing guide](https://www.verdent.ai/guides/gemini-3-1-pro-pricing)                                                                                                                |
| 14  | Live API / WebSocket                          | **YES**                                                                                               | Multimodal Live API. WebSocket-based, stateful. Аудио/видео streaming. Для fancai не релевант. [Live API docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api)                                                                                                                                                                                                                                        |
| 15  | Model versioning / aliases                    | **YES**                                                                                               | `-latest`, `-preview`, snapshot dates типа `gemini-2.5-flash-002`. Best practice: pin на snapshot для prod. [models docs](https://ai.google.dev/gemini-api/docs/models)                                                                                                                                                                                                                                                    |
| 16  | Per-request timeout / max concurrent          | **YES**                                                                                               | Дефолтный timeout SDK ~600s. Max concurrent — определяется RPM tier. Quota increase request — через GCP console или AI Studio. [rate limits docs](https://ai.google.dev/gemini-api/docs/rate-limits)                                                                                                                                                                                                                       |

---

## 3. Reliability / Operations

- **SLA**: Vertex AI Gemini Online Inference — официальное SLA published February 2026. Покрывает `generateContent` и `streamGenerateContent`. Service credits при недотягивании SLO. [Gemini on Vertex SLA](https://cloud.google.com/vertex-ai/generative-ai/sla), [Vertex AI SLA](https://cloud.google.com/vertex-ai/sla). Точные процентные пороги (99.5% / 99.9%) — в самом SLA-документе, в открытом тексте они не выводятся через summary, но традиционно для Vertex Online Prediction это **99.5% monthly uptime** для most regions.
- **Status page**: https://status.cloud.google.com/ — фильтруй по "Vertex AI" и "Generative AI on Vertex AI". Свежие инциденты:
  - 2026-02-27: Vertex AI Gemini API global endpoint, повышенный error rate с 04:37 до 06:35 PT ([incident](https://status.cloud.google.com/incidents/41E5S3mkTGDfkZuJZH5k)).
  - На 2026-04-25 — broad incidents отсутствуют ([aibadgr Gemini outage tracker](https://aibadgr.com/gemini-outage)).
- **Rate limits** (см. секцию 1.3): paid Tier 1 — 150–300 RPM; квоты повышаются автомат при росте spend.
- **Latency** (Artificial Analysis, p50 за rolling 72h):
  - Gemini 3 Pro Preview (high reasoning): **TTFT p50 ≈ 30.82s** — высокий из-за thinking ([provider perf page](https://artificialanalysis.ai/models/gemini-3-pro/providers))
  - Gemini 3.1 Pro Preview: TTFT медианный для category, см. [provider perf page](https://artificialanalysis.ai/models/gemini-3-1-pro-preview/providers)
  - **Gemini 3 Flash Preview (Reasoning): 170.8 tok/sec output** ([artificialanalysis](https://artificialanalysis.ai/models/gemini-3-flash-reasoning))
  - Gemini 3 Flash Preview (non-reasoning): **218 tok/sec output** ([artificialanalysis](https://artificialanalysis.ai/models/gemini-3-flash-reasoning))
  - **Gemini 3.1 Flash-Lite Preview: 313.5 tok/sec output** ([provider page](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview))
- **Concurrent requests**: определяется RPM tier и TPM tier. На Tier 1 — порядок 5–10 параллельных типичных extraction-запросов.
- **Retry / circuit breaker**: SDK не делает retries автоматически. Ручной retry на 429/5xx — best practice; tenacity-pattern уже знаком fancai-стеку. [api-errors docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/api-errors)
- **Quota / billing alerts**: Cloud Monitoring + Budget alerts (Vertex). На pure AI Studio — нет monitoring; нужно через console projects.
- **Auto-fallback**: НЕТ. Single provider. fancai сам должен реализовывать fallback (например, на OpenRouter). У OpenRouter на текущий момент это native фича.
- **request_id**: возвращается в response metadata как `usage_metadata.request_id` (на Vertex) или `metadata['request_id']` (на AI Studio).

### Pain point: 429 Errors

Тред разработчиков — частые 429 на 3.1 Pro Preview из-за shared capacity ([apiyi 429 fix guide](https://help.apiyi.com/en/gemini-3-1-pro-preview-slow-429-error-rate-limit-fix-guide-en.html), [apiyi 5 ways to fix Studio rate limits](https://help.apiyi.com/en/ai-studio-gemini-3-pro-rate-limit-solution-en.html)). **Это значит: для production нужно либо batch API либо prepay+quota request.**

---

## 4. Регион и compliance

### 4.1 Геодоступность

- **AI Studio + Gemini API**: 230+ стран и территорий поддерживаются ([available-regions](https://ai.google.dev/gemini-api/docs/available-regions))
- **Россия — НЕ в списке** (санкции OFAC). API возвращает 403 при российских IP ([workalizer Gemini Russia](https://workalizer.com/insights/gemini/understanding-gemini-access-why-googles-ai-is-unavailable-in-russia/)).
- **Vertex AI**: полная карта регионов — `us-central1`, `europe-west1/4/8`, `asia-east1/southeast1`, `southamerica-east1` и др. ([Vertex locations](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)).
- ⚠️ **Gemini 3.1 Pro Preview и Gemini 3 Flash Preview сейчас доступны только на global endpoint** ([Vertex 3.1 Pro doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)). Это значит ты не можешь жёстко указать europe-west8 — данные могут роутиться куда угодно по globe. Для GA версии это изменится.

### 4.2 Data residency и compliance

- **Vertex AI** даёт **data residency guarantees for data at-rest** — гарантирует, что input/output cached/stored остаются в выбранном регионе ([Cloud blog data residency](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-generative-ai-data-residency-guarantees-for-data-stored-at-rest)). Но для preview-моделей global endpoint этой гарантии **не даёт**.
- **AI Studio** — нет регионального контроля.
- **Compliance** на Vertex AI:
  - SOC 1/2/3 ✓
  - ISO 27001 / 27017 / 27018 / 27701 ✓
  - HIPAA (с BAA) ✓
  - GDPR ✓
  - FedRAMP High ✓
  - PCI DSS ✓
- **AI Studio** — публичная API, нет enterprise compliance.

### 4.3 Data retention и no-training

- **Vertex AI (paid)**: **No training by default**, contractual guarantee ([Vertex zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)). Caching opt-out на project-level. Web Grounding for Enterprise предлагает "zero data retention" режим.
- **AI Studio (free tier)**: **Google ТРЕНИРУЕТСЯ** на твоих данных + human review (de-identified) ([remio.ai AI Studio terms](https://www.remio.ai/post/new-google-ai-studio-terms-ban-consumer-use-the-developer-pivot)). Опт-аут — привязать billing (стать paid).
- **AI Studio (paid)**: "no training" — т.к. paid project автоматически снимает разрешение на обучение ([discuss.ai paid plans](https://discuss.ai.google.dev/t/data-privacy-on-ai-studios-paid-plans-important/75253)).
- **Audit logs**: Cloud Audit Logs (только Vertex). На AI Studio нет.

---

## 5. Russia payments — workarounds

### 5.1 Что не работает

- **Российские карты**: Мир, RU-issued Visa/MC, Visa Premium от РФ-банков — **полный блок** (с 2022, OFAC sanctions). [Google support on Russia/Belarus billing](https://support.google.com/googleplay/android-developer/answer/11950272?hl=en).
- **Российские юрлица**: невозможно открыть GCP billing на российскую регистрацию.
- **Pyypl**: НЕ работает в России (compliance — UAE/Бахрейн/Кения/Казахстан/др.) ([Pyypl regions](https://www.pyypl.com/)).
- **Wise**: не выдаёт карты резидентам РФ.
- **Crypto direct**: Google Cloud не принимает crypto.

### 5.2 Workarounds которые работают на 2026-04 (по форумам / posts)

| Метод                                                                   | Realistic?                                                                       | Цена/боль                                    | Источник                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Cardn3** crypto-funded US Visa/MC, instant issue, USDT/TRX/BTC top-up | ✓ работает на OpenAI/Google Cloud, by reports                                    | $5–15 issuance + ~3–5% conversion fee        | [cardn3 ChatGPT guide](https://cardn3.com/blog/virtual-card-for-chatgpt)                                                         |
| **Capitalist** RU-friendly виртуалки                                    | ✗ часто блокируется Google как high-risk BIN                                     | большой риск declines                        | [buvei virtual cards 2026](https://buvei.com/blog/best-virtual-cards-for-google-cloud-billing-in-2026-avoid-declines-and-holds/) |
| **EpayService**                                                         | ✗ similar issues                                                                 | n/a                                          | n/a                                                                                                                              |
| **Корпоративная регистрация в Казахстане/Армении/Грузии/Сербии/Кипре**  | ✓ работает, но cost-of-entry высокий: счёт в местном банке + физ. адрес + tax ID | $1K–5K setup, банк требует резидентства/визу | Personal-experience posts на форумах                                                                                             |
| **Wise UK personal** (если есть UK BVN/банк)                            | ✓ работает                                                                       | необходимо иметь UK address                  | [Wise card forum](https://discuss.google.dev/t/assistance-needed-with-wise-card-for-google-maps-integration/179910)              |
| **Reseller в РФ**                                                       | ✗ для Vertex AI / Gemini нет официальных                                         | n/a                                          | n/a                                                                                                                              |
| **Friends/family abroad** (другая карта/billing account)                | ✓ runtime простой, юридически серый                                              | $0 + социальный долг                         | n/a                                                                                                                              |

⚠️ **Главная боль**: даже с зарубежной картой, **API-вызовы из российских IP — блок**. Нужен **VPN / прокси на VPS-стороне backend**. fancai backend в production уже на VPS (читаемо из STATE.md), значит можно настроить outbound прокси на VPS в Германии/Финляндии/Сингапуре. Это техническая задача на час.

### 5.3 Currency + billing model

- **Currency**: USD, EUR, GBP и ещё ~70 валют ([Cloud billing currency](https://docs.cloud.google.com/billing/docs/resources/currency))
- **Billing model**: per-second metering (Vertex), per-token Gemini API (AI Studio). Postpaid by default, **Prepay plan активирован 2026-03-23** ([changelog](https://ai.google.dev/gemini-api/docs/changelog)) — позволяет платить заранее без auto-charge.
- **Min spend**: нет жёсткого минимума, но Tier 2 квоты после $250 cumulative.

### 5.4 Russia-friendliness verdict

**Боль: HIGH**

- Карта: MEDIUM сложность (Cardn3 / зарубежное юрлицо)
- IP: HIGH (нужен прокси/VPN на backend + риск Google детектит datacenter IP и банит API key)
- Risk: HIGH — Google может в любой момент задетектить и заблокировать API key за TOS-violation (использование из санкционных стран)
- **Reversibility**: при бане API key — потеряны context caches, batch jobs, и нужно отдельно appeal'иться

---

## 6. SDK / API ergonomics

- **Python SDK**: `google-genai` (новый, **рекомендуемый**) на PyPI. Старый `google-generativeai` deprecated, миграция через [SDK migrate guide](https://ai.google.dev/gemini-api/docs/migrate). Текущая версия в районе **1.66+** ([releases](https://github.com/googleapis/python-genai/releases)).
- **Async/await**: ✓ через `client.aio.*` namespace ([SDK docs](https://googleapis.github.io/python-genai/)).
- **Pydantic v2**: ✓ нативная интеграция, все типы — pydantic классы.
- **OpenAI compatibility**: ✓ есть OpenAI-compatible endpoint для Vertex AI и AI Studio. Используешь `openai` SDK + base_url переключения. [Vertex OpenAI compat](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/openai), [AI Studio OpenAI compat](https://ai.google.dev/gemini-api/docs/openai). **Для fancai значит: можно postepenно мигрировать с OpenRouter без полной переделки кода.**
- **TypeScript SDK**: `@google/genai` на npm.
- **CLI**: `gcloud ai` для Vertex; `gemini` (gemini-cli) для AI Studio.
- **Documentation quality**: высокая, но **разбросана** между ai.google.dev (AI Studio/Gemini API) и cloud.google.com (Vertex). Часто одна фича документирована в обоих местах с минимальными расхождениями.
- **Migration guides**: 1.5 → 2.x → 3.x — переход обычно требует только смены model ID + проверки рейт-лимитов. Структура response один и тот же.
- **Community**: GitHub `google/genai` — 7K+ stars, 70+ open issues, активный maintenance ([github](https://github.com/googleapis/python-genai)).

---

## 7. Vendor lock-in / Long-term viability

### 7.1 Уникальные фичи Direct Gemini, недоступные через OpenRouter

1. **Batch API @ 50% discount** — OpenRouter не предоставляет batch
2. **Explicit context caching** через named cache API — у OpenRouter нет этой абстракции
3. **Native Imagen / Nano Banana / Veo через тот же SDK** — единый билинг, единая аутентификация
4. **Free tier на Flash/Flash-Lite** (с приёмом training)
5. **File API с 5GB/файл, semantic search**
6. **Gemini Live API** (WebSocket multimodal) — для fancai не релевант
7. **Detailed `thinking_level` и thought summaries** — OpenRouter передаёт через generic `reasoning_effort`, но детальная диагностика — только direct
8. **Provisioned Throughput** для строгого SLA — для fancai overkill, но интересно при scale
9. **request_id трейсинг** в Cloud Audit Logs — на Vertex AI

### 7.2 Migration cost: что fancai привязывается

При переходе на Direct Gemini fancai привязывается к:

- **google-genai SDK** vs OpenAI-совместимая абстракция OpenRouter
- **Pydantic schema автогенерация** в Gemini-формат (SDK делает inline)
- **Если используем context caching** — структура запросов переписывается под cache_id
- **Billing** — отдельный GCP / AI Studio billing account vs OpenRouter

### 7.3 Что fancai теряет vs OpenRouter

1. **Cross-provider fallback** — у OpenRouter автомат на 503 переключается на другой провайдер той же модели
2. **Model routing** — единая абстракция для Anthropic/OpenAI/Mistral/Google
3. **OpenRouter обходит проблему российских платежей через crypto top-up** напрямую
4. **Один API key на десятки моделей** — vs separate keys на Google + другие провайдеры

### 7.4 Pricing trajectory (последние 6 месяцев)

- 2025-Q4: Gemini 2.5 Pro $1.25/$10 (SmoothBL since 2024)
- 2026-Q1: Gemini 3.0 Pro Preview $2/$12 (release at premium)
- 2026-Q2: Gemini 3 Pro Preview снят, Gemini 3.1 Pro Preview $2/$12 → $4/$18 over 200K
- **Тренд**: каждое новое поколение Pro **дороже** на 30-60% input. Flash дешевеет / стабильный. Q2 GA pricing для 3.1 Pro прогнозируется $1.50/$10 ([benchlm.ai April 2026](https://benchlm.ai/blog/posts/gemini-api-pricing)).

### 7.5 Long-term viability

**Google не уходит** — Vertex AI стратегический сегмент GCP. Но:

- Модели deprecate **раз в 6-12 месяцев** ([deprecations docs](https://ai.google.dev/gemini-api/docs/deprecations))
- 2026 deprecation cliff:
  - Gemini 2.0 Flash / Flash-Lite — **2026-06-01**
  - **Gemini 2.5 Flash + 2.5 Pro — 2026-06-17 (это baseline fancai!)**
  - Gemini 2.5 Flash-Lite, 2.5 Flash Image, embedding-001 — Q3 2026
  - **Все Imagen 4 — 2026-06-24**
- Google говорит "migrate to Nano Banana / Gemini 3.x" но Nano Banana / 3.x в **paid-only preview**

⚠️ **Это создаёт проблему для fancai**: даже если оставаться на OpenRouter, Gemini 2.5 Flash baseline тоже умрёт 17 июня 2026. **Миграция на 3.x — неизбежна** в течение 7-8 недель независимо от выбора провайдера.

---

## 8. Открытые вопросы

1. **Точный discount на explicit cache (75% или 90%)** — нужно проверить на live API call с metering в console. Verdent guides пишет 75%, AI Studio docs — 90%.
2. **Гарантирует ли implicit cache discount на каждом hit или только статистически?** — docs формулирует осторожно.
3. **Реальный TPS под Tier 1 на 3.1 Pro Preview** — 429 errors часты, нужно бенчмарк под нагрузкой fancai (50 chapters × 80K input).
4. **Cardn3 на Google Cloud в 2026-Q2** — отзывы есть, но критичный мерчант не у всех проходит. Нужно тестировать на pre-paid $5.
5. **Если fancai backend получает прокси-IP в Германии и payment с Cardn3 (US BIN) — Google AML/fraud signals не сработают?** — риск bans.
6. **Latency p95 под high load для Gemini 3 Flash на extraction-style task (10K input → 5K output)** — нет публичного benchmark, нужно собирать самим.
7. **Когда GA для Gemini 3.1 Pro и Gemini 3 Flash** — preview-status означает риск sudden API changes / quota cuts.

---

## Источники

### Официальные Google

1. [Gemini Developer API pricing — ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing) — accessed 2026-04-27
2. [Vertex AI Generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) — accessed 2026-04-27
3. [Vertex AI 3.1 Pro doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro) — accessed 2026-04-27
4. [Vertex AI 3 Pro doc (deprecated note)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro) — accessed 2026-04-27
5. [Vertex AI 3 Flash doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash) — accessed 2026-04-27
6. [Vertex AI Gemini Online Inference SLA](https://cloud.google.com/vertex-ai/generative-ai/sla) — accessed 2026-04-27
7. [Vertex AI SLA](https://cloud.google.com/vertex-ai/sla) — accessed 2026-04-27
8. [Available regions for AI Studio + Gemini API](https://ai.google.dev/gemini-api/docs/available-regions) — accessed 2026-04-27
9. [Vertex AI locations](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) — accessed 2026-04-27
10. [Context caching docs (AI Studio)](https://ai.google.dev/gemini-api/docs/caching) — accessed 2026-04-27
11. [Vertex AI context cache overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview) — accessed 2026-04-27
12. [Batch API docs (AI Studio)](https://ai.google.dev/gemini-api/docs/batch-api) — accessed 2026-04-27
13. [Vertex AI Batch inference docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini) — accessed 2026-04-27
14. [Files API docs](https://ai.google.dev/gemini-api/docs/files) — accessed 2026-04-27
15. [Thinking docs (AI Studio)](https://ai.google.dev/gemini-api/docs/thinking) — accessed 2026-04-27
16. [Vertex AI thinking docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking) — accessed 2026-04-27
17. [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations) — accessed 2026-04-27
18. [Gemini API Release notes (changelog)](https://ai.google.dev/gemini-api/docs/changelog) — accessed 2026-04-27
19. [Models list (AI Studio)](https://ai.google.dev/gemini-api/docs/models) — accessed 2026-04-27
20. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — accessed 2026-04-27
21. [OpenAI compatibility (AI Studio)](https://ai.google.dev/gemini-api/docs/openai) — accessed 2026-04-27
22. [Vertex OpenAI compat](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/openai) — accessed 2026-04-27
23. [Gemini File limits blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/) — accessed 2026-04-27
24. [Imagen 4 GA blog](https://developers.googleblog.com/announcing-imagen-4-fast-and-imagen-4-family-generally-available-in-the-gemini-api/) — accessed 2026-04-27
25. [Gemini Embedding 2 blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/) — accessed 2026-04-27
26. [Gemini Embedding GA blog](https://developers.googleblog.com/gemini-embedding-available-gemini-api/) — accessed 2026-04-27
27. [Cloud billing currency](https://docs.cloud.google.com/billing/docs/resources/currency) — accessed 2026-04-27
28. [Cloud generative AI data residency blog](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-generative-ai-data-residency-guarantees-for-data-stored-at-rest) — accessed 2026-04-27
29. [Vertex AI zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) — accessed 2026-04-27
30. [google-genai SDK docs](https://googleapis.github.io/python-genai/) — accessed 2026-04-27
31. [google-genai PyPI](https://pypi.org/project/google-genai/) — accessed 2026-04-27
32. [google-genai GitHub repo](https://github.com/googleapis/python-genai) — accessed 2026-04-27

### Официальные incident / status

33. [Google Cloud Service Health](https://status.cloud.google.com/) — accessed 2026-04-27
34. [Vertex AI Gemini API incident 2026-02-27](https://status.cloud.google.com/incidents/41E5S3mkTGDfkZuJZH5k) — accessed 2026-04-27
35. [aibadgr Gemini outage tracker](https://aibadgr.com/gemini-outage) — accessed 2026-04-27

### Вспомогательные / community

36. [aipricing.guru April 2026 Gemini guide](https://www.aipricing.guru/google-ai-pricing/) — accessed 2026-04-27
37. [glbgpt 3.1 Pro pricing 2026 guide](https://www.glbgpt.com/hub/gemini-3-1-pro-cost-complete-2026-pricing-guide/) — accessed 2026-04-27
38. [Verdent 3.1 Pro pricing guide](https://www.verdent.ai/guides/gemini-3-1-pro-pricing) — accessed 2026-04-27
39. [pricepertoken Gemini 3 Flash](https://pricepertoken.com/pricing-page/model/google-gemini-3-flash-preview) — accessed 2026-04-27
40. [yingtu batch vs caching](https://yingtu.ai/en/blog/gemini-api-batch-vs-caching) — accessed 2026-04-27
41. [aifreeapi context caching guide](https://www.aifreeapi.com/en/posts/gemini-api-context-caching-reduce-cost) — accessed 2026-04-27
42. [aifreeapi free tier limits](https://www.aifreeapi.com/en/posts/gemini-api-free-tier) — accessed 2026-04-27
43. [aifreeapi rate limits per tier](https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier) — accessed 2026-04-27
44. [aifreeapi 3 Pro Image vs Imagen 4](https://www.aifreeapi.com/en/posts/gemini-3-pro-image-preview-vs-imagen-4) — accessed 2026-04-27
45. [aifreeapi image gen free tier](https://www.aifreeapi.com/en/posts/gemini-image-generation-free-api) — accessed 2026-04-27
46. [intuitionlabs image pricing comparison](https://intuitionlabs.ai/articles/ai-image-generation-pricing-google-openai) — accessed 2026-04-27
47. [tokenmix gemini-embedding-001 guide](https://tokenmix.ai/blog/gemini-embedding-001-dimensions-pricing-guide-2026) — accessed 2026-04-27
48. [pricepertoken Nano Banana Pro](https://pricepertoken.com/pricing-page/model/google-gemini-3-pro-image-preview) — accessed 2026-04-27
49. [laozhang Nano Banana Pro pricing guide](https://blog.laozhang.ai/en/posts/gemini-3-pro-image-api-pricing) — accessed 2026-04-27
50. [Artificial Analysis Gemini 3 Pro performance](https://artificialanalysis.ai/models/gemini-3-pro/providers) — accessed 2026-04-27
51. [Artificial Analysis Gemini 3.1 Pro Preview](https://artificialanalysis.ai/models/gemini-3-1-pro-preview/providers) — accessed 2026-04-27
52. [Artificial Analysis Gemini 3 Flash](https://artificialanalysis.ai/models/gemini-3-flash-reasoning) — accessed 2026-04-27
53. [Artificial Analysis 3.1 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview) — accessed 2026-04-27
54. [GitHub Issue #60 — nested Pydantic schema bug](https://github.com/googleapis/python-genai/issues/60) — accessed 2026-04-27
55. [GitHub Issue #699 — default field values bug](https://github.com/googleapis/python-genai/issues/699) — accessed 2026-04-27
56. [Pydantic Model Integration DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5.1-pydantic-model-integration) — accessed 2026-04-27
57. [Structured Outputs DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5-function-calling) — accessed 2026-04-27
58. [Discuss.ai Pydantic response schema](https://discuss.ai.google.dev/t/response-schema-from-pydantic/50028) — accessed 2026-04-27
59. [remio.ai AI Studio terms](https://www.remio.ai/post/new-google-ai-studio-terms-ban-consumer-use-the-developer-pivot) — accessed 2026-04-27
60. [discuss.ai data privacy paid plans](https://discuss.ai.google.dev/t/data-privacy-on-ai-studios-paid-plans-important/75253) — accessed 2026-04-27
61. [workalizer Gemini Russia access](https://workalizer.com/insights/gemini/understanding-gemini-access-why-googles-ai-is-unavailable-in-russia/) — accessed 2026-04-27
62. [adspower Gemini unblocked guide](https://www.adspower.com/blog/gemini-unblocked-access-google-gemini-anywhere) — accessed 2026-04-27
63. [cardn3 ChatGPT virtual card](https://cardn3.com/blog/virtual-card-for-chatgpt) — accessed 2026-04-27
64. [buvei virtual cards Google Cloud 2026](https://buvei.com/blog/best-virtual-cards-for-google-cloud-billing-in-2026-avoid-declines-and-holds/) — accessed 2026-04-27
65. [apiyi 429 fix guide for 3.1 Pro](https://help.apiyi.com/en/gemini-3-1-pro-preview-slow-429-error-rate-limit-fix-guide-en.html) — accessed 2026-04-27
66. [apiyi thinking tokens explainer](https://help.apiyi.com/en/gemini-3-1-pro-thinking-tokens-output-high-explained-en.html) — accessed 2026-04-27
67. [geminipricing.com context caching](https://www.geminipricing.com/context-caching) — accessed 2026-04-27
68. [forum: 3.x models in european locations](https://discuss.google.dev/t/gemini-3-x-models-in-european-locations/333038) — accessed 2026-04-27
69. [benchlm Gemini API pricing April 2026](https://benchlm.ai/blog/posts/gemini-api-pricing) — accessed 2026-04-27
