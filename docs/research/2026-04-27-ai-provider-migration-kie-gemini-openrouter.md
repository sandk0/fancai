# Исследование миграции AI-стека fancai: OpenRouter vs kie.ai vs Direct Gemini API

**Дата актуальности:** 27 апреля 2026  
**Дата подготовки:** 27 апреля 2026  
**Проект:** `fancai`  
**Фокус:** миграция с OpenRouter на kie.ai и/или Direct Gemini API, с учетом актуальных моделей поколения Gemini 3/3.1, GPT Image 2, Nano Banana 2 и релевантных моделей для text/image/video AI-стека.

---

## 1. Executive summary

### Главный вывод

Полная немедленная миграция с OpenRouter на kie.ai **не рекомендуется** без PoC, quality-eval и production canary. Однако гипотеза о цене подтверждается для ряда ключевых моделей: публичная pricing-таблица kie.ai на 27.04.2026 показывает цены примерно в **2.7–4.0 раза ниже**, чем OpenRouter/official pass-through для многих text/chat моделей, включая Gemini 3.1 Pro, Gemini 3 Flash, Gemini 2.5 Flash/Pro, Claude 4.6 и GPT-5.2/5.4.

При этом Direct Gemini API остается лучшим вариантом для production-critical Gemini workloads, где важны native features: контекстное кеширование, Batch/Flex/Priority inference, native structured outputs через Gemini SDK, Google Search/Maps grounding, File API, safety controls, прозрачная модель данных и меньший trust surface. kie.ai выглядит наиболее привлекательным как **cost-optimized provider** для canary, batch/low-risk нагрузок, image/video generation и некоторых non-Gemini моделей — но требует проверки стабильности, качества, правового риска и поддержки.

### Рекомендуемая стратегия

Рекомендуемая архитектура для fancai — **гибридная**:

1. **Direct Gemini API** — primary для критичного LLM extraction / structured JSON / long-context обработки книг, особенно если качество Gemini критично.
2. **kie.ai** — cost-optimized provider для canary на тех же Gemini/Claude/GPT моделях и потенциально primary для image/video, если тесты подтвердят качество, latency и retry profile.
3. **OpenRouter** — оставить как fallback/routing layer на период миграции и для моделей, которых нет в Gemini/kie.ai или где важны OpenRouter features: provider routing, BYOK, data-policy routing, usage accounting, app attribution, plugins/response healing.
4. Реализовать собственный **Provider Abstraction Layer** поверх текущего `OpenRouterClient`, чтобы provider выбирался по use case, цене, SLA, модели и типу задачи.

### Почему не “kie.ai everywhere” прямо сейчас

Плюсы kie.ai:

- цены существенно ниже по публичному pricing API;
- широкий каталог image/video/music/chat моделей;
- есть OpenAI-compatible chat endpoints для Gemini/Claude/GPT;
- есть API-key limits, IP whitelist, logs, credits, async task model;
- поддерживает GPT Image 2, Nano Banana 2, Imagen 4, Veo 3.1, Runway, Kling, Wan, Suno и др.

Минусы/риски kie.ai:

- в собственных docs kie.ai прямо пишет, что общая стабильность может быть ниже официальных провайдеров;
- не найден официальный публичный status page/SLA уровня OpenRouter/Google;
- privacy/compliance слабее: политика короткая, нет публичных SOC 2 / ISO 27001 / HIPAA / DPA / audit-log guarantees;
- для media generation используется async task model и временные URLs, что потребует изменения текущего image pipeline;
- ценообразование credit-based и часть цен получена через публичный backend endpoint pricing page — перед production надо перепроверять в dashboard/API;
- происхождение “скидки 70–80%” требует юридической и operational due diligence.

### Самое важное для fancai

Текущий backend уже централизовал AI через OpenRouter:

- `backend/app/core/openrouter_client.py` — единый клиент;
- env: `OPENROUTER_API_KEY`, `OPENROUTER_IMAGE_MODEL`;
- LLM fallback chain в коде: `google/gemini-2.5-flash` → `google/gemini-2.5-flash-lite`;
- image model: `black-forest-labs/flux.2-klein-4b`;
- сервисы: `gemini_extractor.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `consistency_manager.py`, `imagen_generator.py`.

Значит миграция должна быть не заменой строк URL, а добавлением provider layer с одинаковым контрактом: `generate_structured`, `generate_text`, `generate_image`, cost tracking, retry, fallback, schema validation.

---

## 2. Methodology and source quality

### Использованные источники

**Высокая надежность:**

- Google Gemini API docs/pricing/models/context caching/batch/thinking/OpenAI compatibility.
- OpenRouter pricing/docs/API model catalog/status page.
- OpenAI official pricing/model docs for GPT-5.5/GPT-5.4/GPT Image 2.
- kie.ai official docs, privacy, terms, pricing endpoint behind pricing page.
- Локальный код проекта fancai.

**Средняя надежность:**

- Сторонние uptime/status агрегаторы для kie.ai.
- Community/reddit posts о latency/reasoning/cost issues — полезны как сигналы, но не как факты для финального решения.

**Не подтверждено надежно:**

- Наличие у kie.ai enterprise-grade SLA, SOC 2, ISO 27001, HIPAA, DPA.
- Точное происхождение low-cost access у kie.ai.
- Реальная latency/reliability для наших workloads без собственного бенчмарка.
- Долгосрочная стабильность model IDs и deprecation policy kie.ai.

### Важное предупреждение

Цены и доступность моделей в AI API меняются быстро. Перед production-решением нужно повторить pricing scrape/API check и сделать контрольный запрос в dashboard каждого провайдера.

---

## 3. Текущий AI-стек проекта fancai

### Найденные repo facts

| Область | Текущее состояние |
|---|---|
| Центральный AI client | `backend/app/core/openrouter_client.py` |
| Базовый URL | `https://openrouter.ai/api/v1` |
| Env vars | `OPENROUTER_API_KEY`, `OPENROUTER_IMAGE_MODEL` |
| LLM primary/fallback в коде | `google/gemini-2.5-flash` → `google/gemini-2.5-flash-lite` |
| Image model | `black-forest-labs/flux.2-klein-4b` |
| Structured output | OpenRouter `response_format=json_schema`, плюс inline `$defs/$ref` workaround |
| Reliability | client-side fallback, retry, circuit breakers, Prometheus metrics, DB usage log |
| Image API style | OpenRouter `/chat/completions` with `modalities=["image"]`, response images in `choices[0].message.images` |
| Services using AI | `gemini_extractor.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `consistency_manager.py`, `imagen_generator.py` |

### Вывод по текущему стеку

Проект уже находится в хорошей позиции для migration-by-adapter: один client boundary существует. Но текущий контракт заточен под OpenRouter semantics. Direct Gemini и kie.ai различаются в:

- response format;
- schema guarantees;
- media generation response model;
- async task handling;
- token/cost accounting;
- fallback and retry behavior;
- billing/credit handling.

---

## 4. Pricing comparison

### 4.1 Text/chat token pricing: kie.ai vs OpenRouter vs Direct Gemini API

Цены ниже — USD за 1M токенов. Для OpenRouter использован публичный `/api/v1/models`; для kie.ai — публичный pricing endpoint, используемый страницей `https://kie.ai/pricing`; для Gemini Direct — официальный Google pricing page.

| Модель | Direct Gemini / Official | OpenRouter | kie.ai | Разница OpenRouter → kie.ai | Комментарий |
|---|---:|---:|---:|---:|---|
| Gemini 3.1 Pro Preview input | $2.00 | $2.00 | $0.50 | **4.0x дешевле** | Direct и OpenRouter совпадают; Kie сильно дешевле. |
| Gemini 3.1 Pro Preview output | $12.00 | $12.00 | $3.50 | **3.43x дешевле** | Output включает thinking tokens у Google. |
| Gemini 3 Flash input | $0.50 | $0.50 | $0.15 | **3.33x дешевле** | Kie page называет `Gemini 3 Flash`. |
| Gemini 3 Flash output | $3.00 | $3.00 | $0.90 | **3.33x дешевле** | Хороший кандидат для cost canary. |
| Gemini 2.5 Pro input | $1.25 | $1.25 | $0.38 | **3.29x дешевле** | Direct поддерживает caching/batch. |
| Gemini 2.5 Pro output | $10.00 | $10.00 | $3.00 | **3.33x дешевле** | Для long extraction проверить качество/JSON. |
| Gemini 2.5 Flash input | $0.30 | $0.30 | $0.09 | **3.33x дешевле** | Текущий primary в коде через OpenRouter. |
| Gemini 2.5 Flash output | $2.50 | $2.50 | $0.75 | **3.33x дешевле** | На текущей нагрузке может дать прямую экономию. |
| Claude Opus 4.6 input | N/A direct here | $5.00 | $1.425 | **3.51x дешевле** | Kie поддерживает Claude Opus 4.6 по pricing table. |
| Claude Opus 4.6 output | N/A direct here | $25.00 | $7.15 | **3.50x дешевле** | Проверить Anthropic ToS/availability. |
| Claude Sonnet 4.6 input | N/A direct here | $3.00 | $0.85 | **3.53x дешевле** | Может быть привлекательным fallback. |
| Claude Sonnet 4.6 output | N/A direct here | $15.00 | $4.275 | **3.51x дешевле** |  |
| GPT-5.4 input | OpenAI $2.50 | $2.50 | $0.70 | **3.57x дешевле** | OpenAI official и OpenRouter совпадают. |
| GPT-5.4 output | OpenAI $15.00 | $15.00 | $5.60 | **2.68x дешевле** |  |
| GPT-5.2 input | OpenRouter $1.75 | $1.75 | $0.44 | **3.98x дешевле** | Kie lists `gpt-5-2`. |
| GPT-5.2 output | OpenRouter $14.00 | $14.00 | $3.50 | **4.0x дешевле** |  |
| GPT-5.5 | OpenAI $5/$30; OpenRouter $5/$30 for `openai/gpt-5.5` | $5/$30 | Не найдено в pricing endpoint | N/A | У kie.ai есть marketing page, но pricing table не подтвердила цену. |

**Pricing interpretation:** для text/chat kie.ai действительно выглядит в несколько раз дешевле. Но это не automatically означает production-ready replacement: нужно подтвердить availability, rate limits, model behavior, compliance и качество ответов.

### 4.2 Gemini Direct pricing highlights

| Direct Gemini model | Standard input | Standard output | Batch/Flex | Caching | Notes |
|---|---:|---:|---:|---:|---|
| Gemini 3.1 Pro Preview | $2.00 ≤200k; $4.00 >200k | $12.00 ≤200k; $18.00 >200k | 50% cheaper for batch/flex | cache read $0.20/$0.40 + storage | No free tier for this model. |
| Gemini 3.1 Flash-Lite Preview | $0.25 text/image/video; $0.50 audio | $1.50 | batch/flex $0.125/$0.75 | cache read $0.025 + storage | Cheapest current 3.1 text tier. |
| Gemini 3 Flash Preview | $0.50 text/image/video; $1.00 audio | $3.00 | batch/flex $0.25/$1.50 | cache read $0.05 + storage | Strong price/performance. |
| Gemini 3.1 Flash Image Preview / Nano Banana 2 | $0.50 text/image | $3 text; $60 image tokens | batch halves image/text output | N/A | 1K image ≈ $0.067 standard, $0.034 batch. |
| Gemini 3 Pro Image Preview / Nano Banana Pro | $2 input | $12 text; $120 image tokens | batch/flex halves | N/A | 1K/2K image ≈ $0.134 standard, $0.067 batch. |
| Gemini 2.5 Flash | $0.30 text/image/video; $1.00 audio | $2.50 | batch $0.15/$1.25 | supported | Current repo primary via OpenRouter, not direct. |
| Gemini 2.5 Pro | $1.25/$2.50 by context size | $10/$15 by context size | batch halves | supported | Useful fallback for quality. |

### 4.3 Image / video / media pricing

| Модель / provider | Direct official | OpenRouter | kie.ai | Notes |
|---|---:|---:|---:|---|
| Nano Banana 2 / Gemini 3.1 Flash Image 1K | Google ≈ $0.067 standard; $0.034 batch | OpenRouter model tokens match Google pricing model; exact per-image depends output tokens | **$0.04 / image** | Kie дешевле direct standard; близко к Google batch. |
| Nano Banana 2 2K | Google ≈ $0.101 standard; $0.050 batch | same/pass-through | **$0.06 / image** | Kie между batch и standard. |
| Nano Banana 2 4K | Google ≈ $0.151 standard; $0.076 batch | same/pass-through | **$0.09 / image** | Kie дешевле direct standard. |
| Nano Banana Pro / Gemini 3 Pro Image 1K/2K | Google ≈ $0.134 standard; $0.067 batch | pass-through | Kie pricing table: отдельные Nano Banana Pro entries есть в docs/market; точные цены не извлечены в selected table | Проверить перед миграцией. |
| GPT Image 2 1K | OpenAI token-based: image input $8/M, output $30/M; exact per-image via calculator | exact `openai/gpt-image-2` не найден в `/api/v1/models` snapshot | **$0.03 / image** | Kie pricing endpoint подтверждает text-to-image и image-to-image. |
| GPT Image 2 2K | token-based | not reliably confirmed | **$0.05 / image** |  |
| GPT Image 2 4K | token-based | not reliably confirmed | **$0.08 / image** |  |
| Imagen 4 Fast | Google official Imagen pricing should be rechecked in Gemini pricing page | not central in current stack | **$0.02 / request** | Kie supports Imagen4 fast/default/ultra. |
| Imagen 4 Default | official recheck | not central | **$0.04 / request** |  |
| Imagen 4 Ultra | official recheck | not central | **$0.06 / image** |  |
| Veo 3.1 Fast / Quality | Google direct via Gemini/Vertex | OpenRouter video generation API exists, but exact model coverage needs check | Kie landing claims $0.4 Fast / $2 Quality video in billing copy | Very relevant if project adds video. |

### 4.4 Hidden cost risks

| Provider | Hidden/secondary cost risks |
|---|---|
| Direct Gemini API | Thinking tokens billed as output; prompts >200k may trigger higher Pro pricing; context cache storage per hour; Google Search/Maps grounding charged after free limits; Batch async changes operational flow. |
| OpenRouter | Price changes propagate automatically; BYOK fallback can consume OpenRouter credits unless “Always use this key” is set; routing may change provider latency; taxes excluded; paid model prices are pass-through but platform has pay-as-you-go plan fee notes. |
| kie.ai | Credit model: 1 credit ≈ $0.005, bonus credit packs can change effective cost; insufficient credits block service; media files expire; async polling/webhooks add infra; pricing can change with upstream; no public SLA credits found. |

---

## 5. Model availability comparison

| Model family / capability | Direct Gemini API | kie.ai | OpenRouter | Notes |
|---|---|---|---|---|
| Gemini 3.1 Pro Preview | ✅ official | ✅ `Gemini 3.1 Pro- openai` | ✅ `google/gemini-3.1-pro-preview` | Direct/OpenRouter $2/$12; Kie $0.5/$3.5. |
| Gemini 3 Pro text | ⚠️ `Gemini 3 Pro Preview` deprecated/shut down 2026-03-09 | ✅ Kie lists Gemini 3 Pro | ❌ not found as current text model in snapshot | Treat Kie `Gemini 3 Pro` as high verification risk. Prefer 3.1 Pro. |
| Gemini 3 Flash | ✅ `gemini-3-flash-preview` | ✅ | ✅ `google/gemini-3-flash-preview` | Good migration candidate. |
| Gemini 3.1 Flash-Lite | ✅ | ❌ not found in Kie chat pricing snapshot | ✅ | Direct may be best cheap high-volume Gemini option. |
| Gemini 2.5 Flash/Pro | ✅ | ✅ | ✅ | Current repo uses 2.5 Flash via OpenRouter. |
| Nano Banana 2 / Gemini 3.1 Flash Image | ✅ official | ✅ | ✅ | Kie has simple per-image pricing. |
| Nano Banana Pro / Gemini 3 Pro Image | ✅ official | ✅ docs/market | ✅ | Pro quality image option. |
| Imagen 4 | ✅ official | ✅ | partial/verify | Kie has fast/default/ultra entries. |
| Veo 3.1 | ✅ official | ✅ | OpenRouter has video API docs; exact coverage verify | Kie particularly broad in video catalog. |
| GPT-5.5 | ❌ | ⚠️ marketing page exists, price not in pricing snapshot | ✅ `openai/gpt-5.5`, `gpt-5.5-pro` | Use OpenAI/OpenRouter until Kie pricing/API verified. |
| GPT-5.4 / GPT-5.2 | ❌ | ✅ | ✅ | Kie much cheaper in table. |
| GPT Image 2 | ❌ | ✅ | ⚠️ not reliably exposed as exact `openai/gpt-image-2` in snapshot | Direct OpenAI is authoritative for GPT Image 2. |
| Claude Opus/Sonnet/Haiku 4.5/4.6 | ❌ | ✅ | ✅ | Kie prices much lower; verify legal/quality. |
| DeepSeek/Qwen/Llama/Mistral/xAI | ❌ | partial: Qwen image, Grok image/video, likely more via market | ✅ broad | OpenRouter remains stronger as general LLM aggregator. |
| Flux/Kling/Runway/Wan/Seedance/Suno/ElevenLabs | ❌ | ✅ strong | partial/broad depending category | Kie’s strongest differentiation is media generation breadth. |
| Embeddings | ✅ Gemini Embedding/Gemini Embedding 2 | ❌ not found in pricing snapshot | ✅ many providers | For RAG/search, Direct Gemini/OpenRouter stronger. |

---

## 6. API and developer experience comparison

### 6.1 Chat/text APIs

| Capability | Direct Gemini API | kie.ai | OpenRouter |
|---|---|---|---|
| Native API | ✅ Gemini native SDK/API | ❌ mostly aggregator-specific/OpenAI-compatible endpoints | ❌ OpenAI-compatible normalized router |
| OpenAI-compatible Chat Completions | ✅ via `generativelanguage.googleapis.com/v1beta/openai/` | ✅ per Kie Gemini docs endpoints like `/gemini-3-pro/v1/chat/completions` | ✅ primary interface |
| Responses API | partial through OpenAI compatibility? verify | ❌ not confirmed | ✅ docs include Responses API section |
| Streaming/SSE | ✅ | ✅ for chat endpoints | ✅ SSE |
| Structured outputs / JSON schema | ✅ strong native support via Gemini response schema; OpenAI-compatible `response_format` also documented | ✅ Kie docs show `response_format`, but mutually exclusive with tools | ✅ `response_format=json_object/json_schema`, normalized across providers |
| Tool/function calling | ✅ native + OpenAI-compatible | ✅ but Kie Gemini docs say Google Search and function calling are mutually exclusive | ✅ if underlying model supports; transforms for some providers |
| Thinking/reasoning controls | ✅ `reasoning_effort`, `thinking_level`, `thinking_budget`; cannot disable for Gemini 3 | ✅ docs show `include_thoughts`, `reasoning_effort` | ✅ `reasoning`/`include_reasoning` for supported models |
| Multimodal input | ✅ text/image/audio/video/files depending model | ✅ text/image; docs use unified `image_url` JSON for images/videos/audio/PDF | ✅ image/PDF/audio/video input on supported models |
| File API | ✅ native Files API | ✅ separate file upload API | plugins/file-parser; input files on supported models |
| Batch API | ✅ 50% cost reduction | ❌ not found for chat; media async tasks exist | partial/provider-specific, plus OpenRouter APIs |
| Rate-limit headers | ✅ Google docs/rate limits | unclear; Kie returns 429 and has per-key limits | OpenRouter has limits docs; paid no platform-level limits, provider still matters |
| SDK support | ✅ Google GenAI SDK; OpenAI SDK compatible | no official mature SDK found; REST examples | ✅ OpenRouter SDK + OpenAI SDK compatible |
| Error format | Google native/OpenAI-compatible | JSON `code/msg/data`, status codes include 401/402/422/429/455/500 | OpenAI-like error with metadata/provider details |

### 6.2 Media generation APIs

| Capability | Direct Gemini API | kie.ai | OpenRouter |
|---|---|---|---|
| Image generation | ✅ Nano Banana/Nano Banana Pro/Imagen | ✅ very broad; async tasks for many models | ✅ image output models via chat completions; image generation server tool beta |
| Image editing | ✅ Nano Banana / GPT Image direct via OpenAI, not Gemini | ✅ GPT Image 2 image-to-image, Nano Banana edit, Flux Kontext, etc. | ✅ for models supporting image input/output; API shape differs |
| Video generation | ✅ Veo 3.1 / Vertex/Gemini | ✅ Veo 3.1, Runway, Kling, Wan, Seedance, Sora2 catalog | ✅ docs include video generation, exact model set needs check |
| Music/audio generation | ✅ Lyria/TTS/Speech in Google ecosystem | ✅ Suno, ElevenLabs entries | ✅ TTS docs; broad text models; verify music generation |
| Async task model | Google batch/media async depending API | ✅ all generation tasks async per Kie docs | mixed; chat completions sync/streaming, some media async APIs |
| Generated file retention | Google/provider dependent | Generated media 14 days; logs 2 months | provider/OpenRouter dependent |

### 6.3 Migration complexity from current OpenRouter client

| Target | Complexity | Why |
|---|---:|---|
| kie.ai chat-only for Gemini text | Medium | OpenAI-compatible, but base URL/model path differs per model; cost accounting differs; structured output/tool conflicts must be tested. |
| kie.ai media generation | Medium–High | Current image generation expects OpenRouter chat-completions image response; Kie uses async tasks/callbacks/polling and temporary URLs. |
| Direct Gemini text/structured | Medium–High | Requires native Gemini adapter, but can improve schema reliability and caching/batch economics. |
| Direct Gemini media | High | Different endpoints and models; need media storage/download changes. |
| Keep OpenRouter fallback | Low | Already implemented. |

---

## 7. Reliability and production readiness

### Direct Gemini API

Strengths:

- Official Google stack, direct provider relationship.
- Paid tier: content not used to improve products per Google pricing page.
- Batch API, context caching, Flex/Priority inference.
- Vertex AI path can add enterprise controls, Google Cloud support, provisioned throughput, compliance posture.
- Google Cloud status page includes Vertex Gemini API, Vertex Imagen API, Vertex Veo API.

Risks:

- Gemini Developer API itself is not identical to Vertex AI enterprise SLA posture.
- Preview models can change and have restrictive limits.
- Thinking tokens and long-context tiers can cause bill shock.
- Only Google models; no Claude/OpenAI/Qwen fallback unless app adds another provider.

### OpenRouter

Strengths:

- Public status page: at access time showed all systems operational and 90-day uptime around 99.88% for chat.
- Provider/model fallback and routing.
- BYOK, provider ordering, data policy filtering, EU in-region routing for enterprise.
- Activity logs/export, budgets/spend controls, prompt caching, app attribution, rankings.
- API schema already used by project.

Risks:

- Extra middle layer and trust surface.
- Provider routing can create latency variability.
- Pricing changes propagate automatically.
- Some provider-specific behavior is normalized/transformed, which can break exact expectations.
- Current code already needed `$defs/$ref` schema workaround for Google models through OpenRouter.

### kie.ai

Strengths:

- Claims 99.9% uptime/24/7 support on landing page.
- Official docs mention API key limits, IP whitelist, task logs, credit consumption visibility.
- Default limits: 20 new generation requests per 10 seconds and 100+ concurrent running tasks per account, with 429 rejection when exceeded.
- Clear retention policy for generated media/logs in docs.

Risks:

- Kie docs explicitly state overall stability may be slightly lower than official providers.
- Public official status page/SLA not found.
- Support is Discord/Telegram/dashboard-first; email not preferred.
- Small startup disclosure in docs.
- Compliance docs are thin.
- Pricing advantage may depend on upstream arrangements not transparent publicly.

---

## 8. Security, privacy, compliance

| Dimension | Direct Gemini API | kie.ai | OpenRouter |
|---|---|---|---|
| Training on customer data | Paid tier: content not used to improve products; free tier may be used | Not clearly stated for model prompts in privacy; docs say logs retained 2 months | OpenRouter says it does not train on your data; provider-side training can be filtered |
| Data retention | Google/Vertex policies; configurable/enterprise via Google Cloud | Generated media 14 days; text/metadata logs 2 months | Provider-specific; account/request data-policy controls; provider retention shown |
| Compliance | Strongest via Vertex AI / Google Cloud | No public SOC2/ISO/HIPAA/DPA found | Enterprise SSO/SAML, EU in-region routing; compliance depends on provider and plan |
| API key controls | Google Cloud/IAM for Vertex; API keys for Developer API | API keys, per-key rate limits, hourly/daily/total caps, IP whitelist | API keys, management API, BYOK encrypted provider keys, workspaces/admin controls |
| Audit/logs | Google Cloud logging with Vertex | Task logs dashboard; retention 2 months | Activity logs/export, provider responses/debug metadata |
| Trust surface | Lowest for Gemini workloads | Higher: Kie + upstream providers | Higher: OpenRouter + upstream providers |

### Security recommendation

For user content from books, prompts, generated images, and any future private documents:

- Use **Direct Gemini / Vertex** for sensitive production text extraction when possible.
- If using kie.ai, avoid sending sensitive user-private data until DPA/compliance posture is clarified.
- Keep OpenRouter privacy settings strict: no-training providers only, explicit provider order for sensitive workloads, BYOK only if fallback is controlled.
- Never expose provider keys in frontend; current repo already follows backend env pattern.

---

## 9. Unique capabilities and differentiators

### Direct Gemini API

- Native Gemini features and fastest access to Google-specific capabilities.
- Gemini 3.1 Pro, Gemini 3 Flash, Gemini 3.1 Flash-Lite, Gemini 3.1 Flash Image/Nano Banana 2, Nano Banana Pro, Veo 3.1, Imagen 4, Lyria, Gemini Embedding.
- Context caching and Batch API with major cost reductions.
- Fine-grained thinking controls.
- Google Search/Maps grounding with documented pricing/free limits.
- Native SDK support and framework integrations: LangChain, LlamaIndex, Vercel AI SDK.
- Vertex AI route for enterprise governance.

### OpenRouter

- 300+ models, 60+ providers per pricing page.
- Strong routing/fallback and provider selection.
- BYOK with provider keys and fallback controls.
- Rankings, model catalog, provider data explorer, app attribution.
- Structured outputs, tool calling, plugins: web, file parser, response healing, context compression.
- Activity logs, cost details, detailed usage response fields, server tool usage counts.
- Current project already integrated.

### kie.ai

- Very aggressive pricing for many top models.
- Strong catalog for media generation: GPT Image 2, Nano Banana 2, Imagen 4, Flux, Ideogram, Qwen image, Grok Imagine, Veo 3.1, Runway, Kling, Wan, Seedance, Suno, ElevenLabs.
- Credit-based pricing with clear per-image/per-second entries in public pricing table.
- API key caps and IP whitelist.
- Async task model with callback/polling suitable for long media generation.
- Potentially best low-cost route for image/video experiments if compliance risk is acceptable.

---

## 10. Migration risk matrix

| Risk | Applies to | Probability | Impact | Evidence | Mitigation |
|---|---|---:|---:|---|---|
| API incompatibility | kie.ai, Direct Gemini | High | High | Kie media async vs current OpenRouter chat image; Direct Gemini native schema differs | Provider abstraction + contract tests. |
| Structured JSON regressions | kie.ai/OpenRouter | Medium | High | Current code already has OpenRouter `$defs/$ref` workaround | Golden schema tests; Direct Gemini native `response_schema` baseline. |
| Model behavior drift | all | High | High | Preview models and aggregator routing can change behavior | Golden prompt set; snapshot model IDs; canary. |
| Kie reliability lower than official | kie.ai | Medium | High | Kie docs explicitly warn stability may be lower | Use Kie behind fallback/circuit breaker first. |
| Compliance/data risk | kie.ai/OpenRouter | Medium | High | More intermediaries; Kie compliance docs thin | DPA/security review before sensitive data. |
| Hidden reasoning token costs | Direct Gemini/OpenRouter | Medium | Medium | Gemini output includes thinking tokens | Track completion token details; cap thinking level where possible. |
| Credit depletion | kie.ai/OpenRouter | Medium | Medium | Both use credits/prepaid models | Credit alerts, low-balance circuit breaker, auto top-up if approved. |
| Pricing changes | all | High | Medium | Docs warn pricing may change | Daily/weekly pricing monitor; budget alerts. |
| Loss of OpenRouter routing features | full Kie migration | High | Medium | Kie does not expose OpenRouter-style provider routing/BYOK | Keep OpenRouter fallback; implement app routing. |
| Media file expiration | kie.ai | High | Medium | Kie generated media stored 14 days; temp download URL 20 min | Immediate download to project storage. |
| Rate limit and queue behavior | kie.ai/Direct Gemini | Medium | High | Kie rejects 429 not queued; Gemini preview limits | Load tests; retry/backoff; batch scheduling. |
| Model availability mismatch | kie.ai | Medium | Medium | Kie lists Gemini 3 Pro though Google says deprecated/shut down | Prefer current model IDs; smoke tests per model. |
| Support limitations | kie.ai | Medium | Medium | Discord/Telegram preferred, small startup | Keep critical workloads on official/direct until support proven. |

---

## 11. Architecture options

| Option | Cost | Reliability | Complexity | Vendor risk | Fit for fancai |
|---|---:|---:|---:|---:|---|
| A. Keep OpenRouter primary | Medium | Medium–High | Low | Medium | Safe short-term; misses Kie savings. |
| B. Full migration to kie.ai | Low | Unknown–Medium | Medium–High | High | Not recommended yet. |
| C. Direct Gemini primary + OpenRouter for non-Gemini | Medium–Low | High | Medium | Low–Medium | Strong for text extraction; limited media diversity. |
| D. Direct Gemini + kie.ai cost provider + OpenRouter fallback | Low–Medium | High if routed well | High | Medium | **Recommended target.** |
| E. kie.ai primary + OpenRouter fallback | Low | Medium/unknown | Medium | High | Good canary after benchmarks, not initial state. |
| F. Own routing layer over all three | Low–Medium | High | High | Low–Medium | Needed for mature stack; can be incremental. |
| G. Split by use case | Low–Medium | High | Medium–High | Medium | Best practical form of D/F. |

### Recommended architecture

```text
Application services
  ├─ LLM extraction / structured JSON
  │    Primary: Direct Gemini API (Gemini 3 Flash or 3.1 Pro by task)
  │    Cost canary: kie.ai Gemini 3 Flash / 2.5 Flash
  │    Fallback: OpenRouter Gemini/Qwen/Claude
  │
  ├─ Entity dedup / synthesis / consistency
  │    Primary: Direct Gemini or OpenRouter depending schema eval
  │    Fallback: OpenRouter Claude/Gemini
  │
  ├─ Image generation
  │    Current: OpenRouter FLUX.2 Klein
  │    Canary: kie.ai GPT Image 2, Nano Banana 2, Imagen 4
  │    Fallback: OpenRouter image models / Pollinations legacy only if acceptable
  │
  └─ Future video/music
       Primary experiments: kie.ai media APIs
       Enterprise/prod: Direct Google Veo / provider direct if SLA needed
```

### Provider abstraction contract

Minimum interface:

```python
class AIProvider(Protocol):
    async def generate_text(self, prompt: str, *, model: str | None, response_format: dict | None, service: str) -> AITextResult: ...
    async def generate_structured(self, messages: list[dict], schema: type[BaseModel], *, model: str | None, service: str) -> dict: ...
    async def generate_image(self, prompt: str, *, model: str | None, refs: list[str] = [], service: str) -> AIImageResult: ...
```

Shared result fields:

- provider;
- model;
- request_id/task_id;
- prompt_tokens;
- completion_tokens;
- reasoning_tokens;
- image_tokens;
- cost_usd;
- latency_ms;
- cache_hit/cache_write;
- retry_count;
- raw_provider_metadata.

---

## 12. Migration plan

### Phase 0 — Inventory and baseline

**Goal:** понять фактическую экономику OpenRouter.  
**Actions:**

- выгрузить `llm_usage_log` за 14–30 дней;
- разбить по service/model/token/cost/error/latency;
- оценить долю text vs image;
- зафиксировать current quality baseline на 20–50 глав.

**Success criteria:** known monthly cost and unit cost per book/chapter/image.  
**Rollback:** no code changes.

### Phase 1 — Provider abstraction layer

**Goal:** отделить бизнес-сервисы от OpenRouter-specific API.  
**Actions:**

- выделить `AIProvider` interface;
- обернуть текущий `OpenRouterClient` как first provider;
- сохранить текущие metrics/circuit breakers;
- добавить provider config per service.

**Success criteria:** текущий OpenRouter path работает без изменения поведения.  
**Rollback:** feature flag возвращает старый client.

### Phase 2 — Direct Gemini PoC

**Goal:** проверить качество и стоимость Direct Gemini на extraction.  
**Actions:**

- добавить `GeminiDirectProvider`;
- использовать native structured output / response schema;
- протестировать Gemini 3 Flash, 3.1 Pro, 2.5 Flash;
- проверить context caching на системном prompt и common instructions;
- batch benchmark для offline extraction.

**Metrics:** schema validity, entity recall/precision, tokens/book, cost/book, latency/chapter, 429 rate.  
**Success:** качество ≥ текущего OpenRouter, cost не выше baseline с учетом cache/batch, fewer schema failures.

### Phase 3 — kie.ai chat PoC

**Goal:** подтвердить реальную цену и совместимость Kie для текущих text workloads.  
**Actions:**

- добавить `KieChatProvider` для Gemini 2.5/3 Flash/3.1 Pro;
- реализовать cost parser из response usage / pricing fallback;
- протестировать structured output, tools conflict, streaming;
- прогнать golden prompt set.

**Success:** 95–99% schema success, качество не ниже baseline, фактическая стоимость совпадает с pricing table ±10%, latency приемлема.  
**Rollback:** отключить provider flag.

### Phase 4 — kie.ai image PoC

**Goal:** проверить GPT Image 2 / Nano Banana 2 / Imagen 4 для image generation.  
**Actions:**

- реализовать async task adapter: create task → poll/callback → download within URL TTL → store locally;
- сравнить с текущим FLUX.2 Klein;
- протестировать RU→EN prompt translation path;
- проверить retries, duplicate submission, partial failures.

**Success:** quality ≥ current for selected use cases, cost/image ниже, failure rate acceptable, generated files stored in our storage immediately.

### Phase 5 — Canary routing

**Goal:** безопасно запустить часть нагрузки.  
**Actions:**

- 5% non-critical chapters/images через Kie/Direct Gemini;
- shadow mode where possible: compare outputs without user impact;
- collect metrics.

**Success:** no user-visible regressions; cost reduction observed; error/fallback rates within thresholds.

### Phase 6 — Gradual rollout

**Goal:** масштабировать proven routes.  
**Actions:**

- 5% → 25% → 50% → 80%;
- keep OpenRouter fallback;
- daily pricing/reliability checks;
- stop rollout on quality/cost anomalies.

### Phase 7 — Decision checkpoint

**Decide:**

- Direct Gemini primary for text? yes/no.
- Kie primary for images? yes/no.
- OpenRouter fallback only or still primary for specific models?
- Need Vertex AI enterprise path?

---

## 13. Questions for next discussion

1. Какие production-critical AI workflows сейчас есть: extraction, dedup, synthesis, translation, image generation?
2. Какая фактическая месячная стоимость OpenRouter за последние 30 дней?
3. Какие модели реально используются сейчас: код говорит Gemini 2.5 Flash, docs местами говорят Gemini 3 Flash — что является source of truth?
4. Насколько чувствительны книги/тексты пользователей с точки зрения privacy?
5. Можно ли отправлять production user content в kie.ai до DPA/security review?
6. Что важнее в ближайшие 2 месяца: снижение cost или снижение schema/quality риска?
7. Нужны ли GPT Image 2 и Nano Banana 2 как production feature или только experiments?
8. Какой acceptable failure rate для extraction и image generation?
9. Нужен ли streaming в пользовательском интерфейсе или только backend batch?
10. Нужна ли поддержка video generation/Veo/Kling/Runway в roadmap?
11. Какие quality metrics считаем обязательными: entity recall, JSON validity, image prompt adherence, latency?
12. Есть ли бюджет на Vertex AI/Google Cloud enterprise route?
13. Хотим ли сохранять OpenRouter provider routing/BYOK или заменить это собственным роутером?
14. Нужны ли cost caps и auto-stop на уровне app для каждого provider?

---

## 14. Concrete next steps

1. **Не переключать production полностью на kie.ai сейчас.**
2. За 1 день сделать usage baseline OpenRouter из `llm_usage_log`.
3. За 2–3 дня добавить minimal provider abstraction вокруг существующего `OpenRouterClient`.
4. За 2–4 дня сделать Direct Gemini PoC для `generate_structured` на 20 главах.
5. За 2–4 дня сделать Kie chat PoC на тех же prompts и сравнить:
   - schema validity;
   - entity recall/precision;
   - latency;
   - cost;
   - retry/fallback rate.
6. Отдельно сделать Kie image PoC для GPT Image 2 / Nano Banana 2 / Imagen 4.
7. После PoC принять решение:
   - Direct Gemini primary для text extraction;
   - Kie primary/canary для media;
   - OpenRouter fallback/model-diversity layer.

---

## 15. Appendix: source links

### Google / Gemini

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API models: https://ai.google.dev/gemini-api/docs/models
- Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- Gemini Batch API: https://ai.google.dev/gemini-api/docs/batch-api
- Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini available regions: https://ai.google.dev/gemini-api/docs/available-regions
- Gemini API terms: https://ai.google.dev/gemini-api/terms
- Google Cloud status: https://status.cloud.google.com/
- Vertex AI SLA: https://cloud.google.com/vertex-ai/sla

### OpenRouter

- Pricing: https://openrouter.ai/pricing
- Model catalog API: https://openrouter.ai/api/v1/models
- Gemini 3.1 Pro model page: https://openrouter.ai/models/google/gemini-3.1-pro-preview
- API reference: https://openrouter.ai/docs/api/reference/overview
- Provider routing: https://openrouter.ai/docs/guides/routing/provider-selection
- Model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- BYOK: https://openrouter.ai/docs/guides/overview/auth/byok
- Provider logging/privacy: https://openrouter.ai/docs/guides/privacy/provider-logging
- Image generation docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Status page: https://status.openrouter.ai/

### kie.ai

- Main site: https://kie.ai/
- Getting started: https://kie.ai/getting-started
- Docs: https://docs.kie.ai/
- Pricing page: https://kie.ai/pricing
- Public pricing endpoint used by pricing page: `POST https://api.kie.ai/client/v1/model-pricing/page`
- Pricing count endpoint: `GET https://api.kie.ai/client/v1/model-pricing/count`
- Common API quickstart: https://docs.kie.ai/common-api/quickstart
- File Upload API: https://docs.kie.ai/file-upload-api/quickstart
- Gemini 3.1 Pro docs: https://docs.kie.ai/market/gemini/gemini-3-1-pro
- Gemini 3 Pro docs: https://docs.kie.ai/market/gemini/gemini-3-pro
- Gemini 3 Flash docs: https://docs.kie.ai/market/gemini/gemini-3-flash
- Nano Banana 2 docs: https://docs.kie.ai/market/google/nanobanana2
- Nano Banana 2 landing: https://kie.ai/nano-banana-2
- GPT Image 2 text-to-image docs: https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image
- GPT Image 2 image-to-image docs: https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image
- Privacy policy: https://kie.ai/privacy-policy
- Terms of use: https://kie.ai/terms-of-use

### OpenAI

- API pricing: https://openai.com/api/pricing/
- GPT Image 2 model page: https://developers.openai.com/api/docs/models/gpt-image-2
- Images and vision guide: https://developers.openai.com/api/docs/guides/images-vision

### Local project files inspected

- `backend/app/core/openrouter_client.py`
- `backend/app/core/config.py`
- `backend/app/services/gemini_extractor.py`
- `backend/app/services/imagen_generator.py`
- `backend/app/services/entity_deduplication_service.py`
- `backend/app/services/entity_synthesis_service.py`
- `backend/app/services/consistency_manager.py`
- `.env.example`
- `.env.production.example`
- `backend/CLAUDE.md`

---

## 16. Appendix: pricing snapshot details

Kie pricing snapshot was fetched from the public endpoint used by the pricing page:

```json
POST https://api.kie.ai/client/v1/model-pricing/page
{"pageNum": 1, "pageSize": 100, "modelDescription": "", "interfaceType": "Chat"}
```

The endpoint returned 34 chat pricing records on 27.04.2026. Relevant extracted rows:

| Kie row | Price |
|---|---:|
| Gemini 3.1 Pro openai chat input | $0.50 / 1M |
| Gemini 3.1 Pro openai chat output | $3.50 / 1M |
| Gemini 3 Flash chat input | $0.15 / 1M |
| Gemini 3 Flash chat output | $0.90 / 1M |
| Gemini 2.5 Flash chat input | $0.09 / 1M |
| Gemini 2.5 Flash chat output | $0.75 / 1M |
| Gemini 2.5 Pro chat input | $0.38 / 1M |
| Gemini 2.5 Pro chat output | $3.00 / 1M |
| Claude Opus 4.6 input | $1.425 / 1M |
| Claude Opus 4.6 output | $7.150 / 1M |
| Claude Sonnet 4.6 input | $0.850 / 1M |
| Claude Sonnet 4.6 output | $4.275 / 1M |
| GPT-5.4 input | $0.70 / 1M |
| GPT-5.4 output | $5.60 / 1M |
| GPT-5.2 input | $0.44 / 1M |
| GPT-5.2 output | $3.50 / 1M |

Kie image pricing snapshot included:

| Kie image row | Price |
|---|---:|
| GPT Image 2 text-to-image 1K | $0.03/image |
| GPT Image 2 text-to-image 2K | $0.05/image |
| GPT Image 2 text-to-image 4K | $0.08/image |
| GPT Image 2 image-to-image 1K | $0.03/image |
| GPT Image 2 image-to-image 2K | $0.05/image |
| GPT Image 2 image-to-image 4K | $0.08/image |
| Google Nano Banana 2 1K | $0.04/image |
| Google Nano Banana 2 2K | $0.06/image |
| Google Nano Banana 2 4K | $0.09/image |
| Google Imagen4 Fast | $0.02/request |
| Google Imagen4 default | $0.04/request |
| Google Imagen4 Ultra | $0.06/image |
```
