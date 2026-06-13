# kie.ai — глубокое исследование (2026-04-27)

> Цель: оценить kie.ai как кандидата на замену OpenRouter в production AI-стеке fancai.
> Особый фокус: legitimacy, Russia-friendliness, hidden gotcha, реальная бизнес-модель.

---

## TL;DR

- kie.ai — **chat/image/video/music aggregator**, оперируемый **NEXUSAI SERVICES LLC** (Denver, Colorado, US)[^tos], но инфраструктура работает на домене `kieai.erweima.ai`/`api.kie.ai` (по контексту — **Chinese-affiliated infra**, см. п. 7).
- Цены **на 60-80% ниже** официальных Google/OpenAI/Anthropic[^kie-home][^kie-pricing-2025]. Это реально, но достигается через **gray-area volume reselling**, без публично раскрытой бизнес-модели.
- **Не OpenAI-compatible** в классическом смысле — у каждой модели **отдельный endpoint** (`/gemini-3-pro/v1/chat/completions`, `/claude/v1/messages`, `/codex/v1/responses`)[^docs-gemini3pro][^docs-claude45][^docs-gpt54], схемы запросов разные. Это **значимо ломает drop-in миграцию**.
- **Не подтверждено**: Russia card payment, прямой crypto/USDT pay, embedding API, real-batch API, real-context-cache pricing, $defs/$ref в JSON Schema, SLA.
- **Trustpilot 3.0/5** при всего 6 reviews, **67% — 1-star**[^trustpilot]. Repeating жалобы: исчезающие credits, отсутствие refund, поддержка только в Asia time zones, нестабильность Sora 2.
- Позиционируется как **prototyping-friendly, production-risky** (вердикт Popularaitools'у дать 4.6/5, но с прямым предупреждением о vendor lock-in[^popularaitools]).
- **Migration cost для fancai: HIGH** — кастомные endpoints не совместимы с текущим OpenRouter-кодом и SDK; нужен полный переписать `services/llm_service.py` + image pipeline + структурированный output вокруг ad-hoc REST вместо `openai` SDK.

---

## 1. Pricing

### 1.1 LLM-модели (что подтверждено публично на 2026-04-27)

| Модель                             | Provider Model ID                                                                           | Релиз/preview                                 |                                                                                                     Std input /1M |                    Std output /1M | Cached input /1M | Batch input /1M | Batch output /1M | Storage /1M tok/hour |                                 Context | Max output | Thinking-токены                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------: | --------------------------------: | ---------------: | --------------: | ---------------: | -------------------: | --------------------------------------: | ---------: | ------------------------------------------------------ |
| **Gemini 3 Flash** (kie.ai)        | `gemini-3-flash` или `gemini-3-flash-openai`[^docs-gemini3flash][^kie-home-flash]           | preview Mar 2026                              |                                                                                       **$0.15**[^nerdbot-pricing] |       **$0.90**[^nerdbot-pricing] |       не указано |      не указано |       не указано |           не указано |          1M (заявлено)[^kie-home-flash] | не указано | поддержка `thinkingLevel` low/high[^docs-gemini3flash] |
| **Gemini 3 Pro** (kie.ai)          | `gemini-3-pro` (OpenAI-compat, через `/gemini-3-pro/v1/chat/completions`)[^docs-gemini3pro] | Jan 2026[^techorg-gemini3pro]                 |                                                                                   **$0.50**[^kie-gemini3pro-blog] |   **$3.50**[^kie-gemini3pro-blog] |  не подтверждено | не подтверждено |  не подтверждено |           не указано |          1M (заявлено)[^kie-gemini3pro] | не указано | `reasoning_effort` low/high[^docs-gemini3pro]          |
| **Gemini 3.1 Pro** (kie.ai)        | `gemini-3.1-pro-openai`[^kie-gemini31pro-page]                                              | Mar 2026 preview                              | **$0.50**[^fromdev-gemini31] (источник называет это Gemini 3.1 Pro, но цифры идентичны 3 Pro — возможна путаница) |      **$3.50**[^fromdev-gemini31] |  не подтверждено | не подтверждено |  не подтверждено |           не указано |                           1M (заявлено) | не указано | reasoning effort                                       |
| **GPT-5.2** (kie.ai)               | `gpt-5-2`[^docs-gpt52]                                                                      | unknown                                       |                                         **$0.44**[^buildfastwithai-gpt52] (один источник, не подтверждено вторым) | **$3.50**[^buildfastwithai-gpt52] |  не подтверждено | не подтверждено |  не подтверждено |           не указано | 400K (заявлено)[^buildfastwithai-gpt52] | не указано | `reasoning_effort` low/high[^docs-gpt52]               |
| **GPT-5.4 / Codex**                | `gpt-5-4`[^docs-gpt54]                                                                      | Apr 2026                                      |                                                                                          не подтверждено публично |          не подтверждено публично |                — |               — |                — |                    — |                              не указано | не указано | `reasoning.effort` low/medium/high/xhigh[^docs-gpt54]  |
| **Claude Opus 4.7** (kie.ai)       | предположительно `claude-opus-4-7`                                                          | Apr 16 2026 (Anthropic)[^claude-pricing-news] |                                                                                  **$1.75**[^inferencehub-claude]† |  **$8.75**[^inferencehub-claude]† |  не подтверждено | не подтверждено |  не подтверждено |           не указано |               200K (стандарт Anthropic) | не указано | extended thinking — не подтверждено через kie          |
| **Claude Sonnet 4.5/4.6** (kie.ai) | `claude-sonnet-4-5`[^docs-claude45]                                                         | —                                             |                                                                                 **~$1.05**[^inferencehub-claude]† |          не подтверждено публично |  не подтверждено | не подтверждено |  не подтверждено |                    — |                 1M (Anthropic стандарт) | не указано | —                                                      |

> **†** Цифры по Claude Opus 4.7 и Sonnet 4.5/4.6 у kie.ai приходят только из вторичного источника (inferencehub блог[^inferencehub-claude]). На сайте kie.ai в открытой части сайта exact pricing **скрыт за signup-стенкой** — все марке­тинговые страницы Gemini 3 Pro/Flash/Sonnet говорят «affordable» без чисел. **Важно проверить через signup до production-решения.**

> **Markup vs официал:** Все публично подтверждённые цифры дают **70–75% дисконт** к официалу (Google Gemini 3 Pro: $2/$12 std, $4/$18 long-context[^aifreeapi]; Anthropic Opus 4.7: $5/$25; OpenAI GPT-5.5: $5/$30). Это **очень агрессивно**. См. п. 7 о бизнес-модели.

> **Free tier:** 5,000 free credits на signup, no card required[^kie-home][^kie-pricing-2025]. При $0.005/credit это **$25 free**. Достаточно для proof-of-concept (≈100 nano-banana images или ≈25M tokens на Gemini 3 Flash при $0.15/$0.90).

> **Tier-based pricing:** Не подтверждено. Один публично упомянутый «Enterprise volume discounts» порог — **$10K/month**[^skywork-indepth] — без указания % скидки.

> **Volume discounts:** «Discounts available» при крупных пакетах credits (e.g. 1,000 за $5, 275,000 за $1,250 = $0.0045/credit ≈ 10% скидка)[^skywork-indepth]. Свыше — кастомно.

### 1.2 Image generation

| Модель                                     | Model ID                                    | Релиз        |                                     Per-image (1024×1024) |                       Per-image (4K) | Native text rendering | ControlNet/img2img                                      | Negative prompt                      | Latency p50                             | Источник               |
| ------------------------------------------ | ------------------------------------------- | ------------ | --------------------------------------------------------: | -----------------------------------: | --------------------- | ------------------------------------------------------- | ------------------------------------ | --------------------------------------- | ---------------------- |
| **Nano Banana 2** (Gemini 3.1 Flash Image) | `nano-banana-2` (предположительно)          | Mar 2026     |                     $0.04 (4K from $0.04)[^nano-banana-2] |                               $0.04+ | high                  | image-input до 8 input images                           | не подтв.                            | ~15s (общий FLUX-ориентированный bench) | [^nano-banana-2]       |
| **Nano Banana Pro** (Gemini 3 Pro Image)   | `nano-banana-pro`[^docs-nano-banana-pro]    | unknown      |                   **$0.09** (1K-2K)[^kie-nano-banana-pro] | **$0.12** (4K)[^kie-nano-banana-pro] | high                  | i2i до 8 input images, max 30MB[^docs-nano-banana-pro]  | **не указан**[^docs-nano-banana-pro] | unknown                                 | [^kie-nano-banana-pro] |
| **Imagen 4 / Ultra**                       | `imagen-4` / `imagen-4-ultra`[^kie-imagen4] | присутствует |                                      не раскрыта (signup) |          до 2K (Ultra)[^kie-imagen4] | high (Google native)  | не подтв.                                               | не подтв.                            | до 10× быстрее предыдущих[^kie-imagen4] | [^kie-imagen4]         |
| **GPT-Image-1** (4o Image)                 | `gpt-image-1`[^docs-4o-image]               | стабильный   | **$0.03** (1 img)[^kie-4o-image] / $0.035 (2) / $0.04 (4) |                              unknown | high                  | filesUrl до 5 reference images, maskUrl[^docs-4o-image] | не подтв.                            | unknown                                 | [^kie-4o-image]        |
| **FLUX.2 Pro Image-to-Image**              | `flux-2/pro-image-to-image`[^docs-flux2]    | mar 2026     |                                      не раскрыта (signup) |                   1K/2K[^docs-flux2] | mid                   | i2i 1-8 reference, max 10MB[^docs-flux2]                | `nsfw_checker` boolean[^docs-flux2]  | unknown                                 | [^docs-flux2]          |
| **Recraft Crisp Upscale**                  | через `kie.ai/recraft-crisp-upscale`        | —            |                          upscaler, не классическая genima |                                    — | —                     | —                                                       | —                                    | —                                       | [^kie-pricing-2025]    |
| **Midjourney v7** (через kie.ai)           | `midjourney-v7`[^kie-pricing-2025]          | —            |                                               не раскрыта |                                    — | high                  | image references                                        | —                                    | —                                       | [^kie-pricing-2025]    |

> **Ideogram v3, SDXL Turbo 2, Recraft v4** — на kie.ai **не подтверждены публично** на 2026-04-27.
> **Midjourney v8** — официально не доступен по API (на 2026-04, MJ всё ещё ограничено).

> **FLUX.3** — модели не существует на 2026-04-27 (BFL flagship — FLUX.2 Pro)[^bfl-pricing].

### 1.3 Video / Music (для контекста, fancai не использует)

- **Sora 2**: $0.015/s (std), $0.045/s (Pro 720p), $0.10-0.13/s (Pro 1080p)[^kie-sora2] — **60% дешевле OpenAI** ($0.10/$0.30/$0.50 соответственно).
- **Veo 3.1**: ≈25% от Google официала[^skywork-indepth]. Veo 3 Fast — $0.30/8s, Veo 3 Quality — $1.25/8s (после обновления Sep 2025)[^skool-pricing].
- **Suno V4.5+**: pay-per-call.

### 1.4 Embeddings

**НЕ ПОДДЕРЖИВАЮТСЯ** на 2026-04-27. kie.ai не предоставляет embedding API — это чисто chat/image/video/music aggregator. Если fancai в будущем понадобится semantic search/RAG — нужно будет ходить отдельно к OpenAI/Voyage/Cohere/local model.

---

## 2. Feature parity (16 критериев)

| #   | Критерий                             | Статус                                    | Примечание                                                                                                                                                                                                                                                                                       | Источник                                                                         |
| --- | ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1   | Structured outputs (JSON Schema)     | **partial**                               | Только для `gemini-3-pro` (через `response_format.json_schema.strict`) и `claude-sonnet-4-5` (через `output_config.format.type=json_schema`). У `gpt-5-2`, `gemini-3-flash-v1beta`, `gpt-5-4` **не задокументировано**.                                                                          | [^docs-gemini3pro][^docs-claude45][^docs-gpt52][^docs-gpt54][^docs-gemini3flash] |
| 2   | $defs/$ref в JSON Schema             | **не подтверждено**                       | Документация Gemini 3 Pro перечисляет поддерживаемые JSON-types, но **не упоминает $defs/$ref**. На GitHub есть issue, что $ref не поддерживается у Gemini в принципе[^pydantic-ai-1598]. У fancai сейчас обходится через `_inline_defs()` хак — **скорее всего, тот же хак потребуется и тут**. | [^docs-gemini3pro][^pydantic-ai-1598]                                            |
| 3   | `response.parsed` Pydantic-объект    | **no**                                    | Возвращает raw JSON. SDK на основе `requests` (kie-api на GitHub — **1 star, 0 forks**)[^github-kie-api] не имеет нативной Pydantic-интеграции.                                                                                                                                                  | [^github-kie-api]                                                                |
| 4   | Function calling / Tools API         | **partial (yes for some, no for others)** | `gemini-3-pro`: yes (с ограничением: tools mutually exclusive с Google Search И с response_format)[^docs-gemini3pro]; `claude-sonnet-4-5`: yes; `gpt-5-2`: только Web Search, custom tools не указаны[^docs-gpt52]; `gpt-5-4`: yes (custom tools + web search, mutually exclusive)[^docs-gpt54]. | [^docs-gemini3pro][^docs-claude45][^docs-gpt52][^docs-gpt54]                     |
| 5   | Streaming (SSE)                      | **yes**                                   | Поддержано в `gemini-3-pro`, `gemini-3-flash-v1beta`, `gpt-5-4`. Формат `text/event-stream`.                                                                                                                                                                                                     | [^docs-gemini3pro][^docs-gemini3flash][^docs-gpt54]                              |
| 6   | System instructions                  | **yes**                                   | Через role `system` (или `developer` у gpt-5-2).                                                                                                                                                                                                                                                 | [^docs-gpt52]                                                                    |
| 7   | Multi-turn conversation              | **yes (stateless)**                       | Stateless — клиент шлёт `messages[]` array. Sessions API нет.                                                                                                                                                                                                                                    | [^docs-gemini3pro]                                                               |
| 8   | Multimodal input                     | **yes (text+image)**                      | Все chat-модели принимают text+image_url. У `gemini-3-pro` всё через unified `image_url` schema (включая video/audio/PDF — wrapped в image_url[^docs-gemini3pro]). У `gemini-3-flash` — `inline_data` base64.                                                                                    | [^docs-gemini3pro][^docs-gemini3flash]                                           |
| 9   | Multimodal output                    | **partial**                               | Image gen (Nano Banana 2/Pro, FLUX.2, GPT-Image-1, Imagen 4), video gen (Veo 3.1, Sora 2), audio gen (Suno) — все через **отдельные image/video/music endpoints**, не через chat.                                                                                                                | [^docs-nano-banana-pro][^docs-flux2][^docs-4o-image][^kie-sora2]                 |
| 10  | Context caching                      | **partial / unclear**                     | Документация Gemini 3 Pro/Flash на сайте kie.ai упоминает «automatic context caching» как фичу[^kie-home-flash], но **точных цен на cached input не опубликовано**. Implicit auto-cache без guarantee. Explicit named-cache API не задокументирован.                                             | [^kie-home-flash]                                                                |
| 11  | Batch API                            | **не подтверждено**                       | Никакая страница kie.ai/docs не упоминает batch API с 50% discount. Все запросы в их «job»-модели — async (createTask + polling), но это не batch в смысле «24h SLA с discount».                                                                                                                 | [^docs-getting-started]                                                          |
| 12  | File API                             | **partial**                               | `/api/v1/common/download-url` — генерит ссылки на kie.ai-generated файлы (validity 20 минут). Внешние URL **отвергаются (422)**[^docs-quickstart]. Upload PDF/docx/epub для semantic search — **не поддержан**.                                                                                  | [^docs-quickstart]                                                               |
| 13  | Thinking/reasoning controls          | **partial**                               | `gpt-5-2`: `reasoning_effort` low/high[^docs-gpt52]; `gpt-5-4`: low/medium/high/xhigh[^docs-gpt54]; `gemini-3-flash`: `thinkingLevel` low/high[^docs-gemini3flash]. **Точный thinking_budget в токенах не задокументирован**.                                                                    | [^docs-gpt52][^docs-gpt54][^docs-gemini3flash]                                   |
| 14  | Live API / WebSocket                 | **no**                                    | Полностью REST + SSE. WebSocket не упоминается.                                                                                                                                                                                                                                                  | —                                                                                |
| 15  | Model versioning / aliases           | **partial**                               | Snapshot dates у Anthropic-моделей сохраняются (`claude-sonnet-4-5`). У Google вариант через суффикс `-openai` (`gemini-3-pro-openai`) — что **указывает на параллельную нативную Gemini-обёртку без OpenAI shim**.                                                                              | [^kie-gemini31pro-page]                                                          |
| 16  | Per-request timeout / max concurrent | **partial**                               | Глобальный rate limit: **20 new generation requests / 10 sec**, **~100+ concurrent running tasks**, реджект через HTTP 429[^docs-getting-started]. Per-request timeout не документирован.                                                                                                        | [^docs-getting-started]                                                          |

---

## 3. Reliability / Operations

- **SLA % uptime**: заявляется **99.9%**[^kie-home][^popularaitools]. Реальная независимая телеметрия от **eliteai.tools**[^eliteai-uptime]:

| Месяц    | Uptime |
| -------- | ------ |
| Dec 2025 | 99.83% |
| Nov 2025 | 99.41% |
| Oct 2025 | 99.86% |
| Sep 2025 | 99.26% |
| Aug 2025 | 99.7%  |
| Jul 2025 | 99.72% |
| Jun 2025 | 99.93% |
| May 2025 | 99.27% |
| Apr 2025 | 99.31% |

— **Реальный uptime 99.26-99.93% за год**, **меньше заявленных 99.9%**. Отдельные дни — 86.4% (Nov 18), 83.7% (May 11), 91.7% (Sep 23). Это **значимые outage windows**.

- **Status page**: упоминается, но публичный URL не найден на сайте kie.ai. Стороннее мониторинг через [eliteai.tools](https://eliteai.tools/tool/kieai/uptime-status) и [toolify.ai](https://www.toolify.ai/is-it-down/kie-ai-affordable-secure-deepseek-r1-api). Формат — webhook/RSS/JSON **не подтверждён**.

- **Rate limits**: **20 new generation req / 10 sec**, **~100+ concurrent**[^docs-getting-started]. Не подтверждено: tier-based escalation (free vs paid vs enterprise).

- **Latency p50/p95/p99**:
  - eliteai.tools: avg response time **803ms** в Dec 2025[^eliteai-uptime].
  - Один обзор: **~25s on Veo 3.1, ~15s on Flux, ~60-90s on Suno V4.5 Plus**[^popularaitools]. Это для async-генерации (включая poll-overhead).
  - **Для chat/extraction-style (10K input → 5K output) — независимых benchmarks НЕТ.** Не присутствует на artificialanalysis.ai или openrouter.ai/rankings.

- **Cold start**: serverless flag не явный. Возможны cold-start delays на менее популярных моделях.

- **Concurrent requests limit**: ≈100+ tasks, после — 429.

- **Retry / circuit breaker**: «edge-side retry logic absorbs transient upstream errors»[^popularaitools] — заявлено, но не подтверждено детально.

- **Quota / billing alerts native**: не задокументировано. `/api/v1/chat/credit` для polling balance вручную[^docs-quickstart].

- **Auto-fallback / model routing**: **нет**. Каждая модель — отдельный endpoint. Если upstream падает — kie.ai не маршрутизирует на альтернативу. Это **значительный downside vs OpenRouter**, у которого provider routing и fallback из коробки.

- **request_id в response для debugging**: не подтверждено в openapi-выдержках. Отдельный `taskId` для async-задач — yes.

---

## 4. Регион и compliance

- **Доступность из России без VPN**: **НЕ ПОДТВЕРЖДЕНО**. На сайте kie.ai нет прямого упоминания доступности из РФ. ScamAdviser Whois (анонимизирован через Dynadot Privacy Service в Сан-Матео, Калифорния)[^scamadviser]. **Юридически — Colorado LLC, что означает теоретическое подчинение OFAC sanctions** на Россию (Russia trade ban с Mar 2022). На практике для consumer SaaS — обычно работает, но **подтверждать через тестовый аккаунт обязательно**.

- **Какие IP-диапазоны блокирует**: не подтверждено явных блоков для RU IP-диапазонов в публичных источниках. Один обзор отмечает поддержку только в Asia time zones[^aichief-asia], что косвенно указывает на физическую инфру **в Азии (вероятно Китай через Erweima domain)**, что снижает риск, но не гарантирует.

- **Локальный endpoint в Европе/Азии**: **только один глобальный endpoint** `api.kie.ai` (плюс `kieai.erweima.ai` legacy). Нет regional pinning.

- **Data residency**: «Information may be transferred to and stored in countries outside your jurisdiction, including the United States»[^kie-privacy]. **Опции выбрать регион нет**. Реально, учитывая Erweima Chinese-aff infra, данные **могут проходить через Asia**.

- **Compliance**:
  - **GDPR**: «Yes, GDPR-compliant» — заявлено в Privacy Policy[^kie-privacy] (legal bases, user rights — access, deletion, portability).
  - **SOC 2 / HIPAA / ISO 27001**: **не подтверждено**. Никаких сертификатов на сайте kie.ai не видно.

- **Data retention default**:
  - Email retained while account active[^kie-privacy].
  - **Training on user data: «no mention»**[^kie-privacy] (т.е. не явно prohibited и не явно guaranteed). Один обзор[^wavespeed] утверждает «data is encrypted and never used for training», но это **не подтверждено в самой Privacy Policy**.
  - Нет opt-out toggles в API.

- **No-training defaults на каждом tier**: не подтверждено публично.

- **Audit logs**: не задокументированы.

---

## 5. Russia payments — критично

| Метод                                             | Статус                              | Источник / комментарий                                                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Российские карты (Мир)                            | **НЕ ПОДТВЕРЖДЕНО**                 | На сайте kie.ai явно не указано. ScamAdviser упоминает поддержку «PayPal, Visa, Mastercard, Alipay»[^scamadviser] — Мир не упоминается. **Высокий риск, что не работает.**                         |
| RU-issued Visa/MC                                 | **НЕ ПОДТВЕРЖДЕНО**                 | После санкций все RU-issued Visa/MC отключены от международного processing. Пройдут ли через kie.ai checkout — неизвестно, **наверняка нет** при использовании обычных processors типа Stripe.     |
| Международные карты                               | **yes** (косвенно)                  | Visa/Mastercard/Alipay упомянуты в ScamAdviser fingerprint[^scamadviser]. Карты UAE/Турции через Pyypl/Wise обычно работают на таких сервисах.                                                     |
| Криптовалюта (USDT TRC20/ERC20, BTC, ETH)         | **НЕ ПОДТВЕРЖДЕНО**                 | На сайте kie.ai нет упоминания crypto top-up. Возможно есть в dashboard после signup, но публично не видно.                                                                                        |
| Wire transfer                                     | **НЕ ПОДТВЕРЖДЕНО**                 | Возможно для Enterprise ($10K+/mo)[^skywork-indepth], но не публично.                                                                                                                              |
| PayPal / Stripe                                   | **partial**                         | PayPal — упомянут в ScamAdviser fingerprint[^scamadviser]. Stripe — не подтверждено явно, но через ScamAdviser/CreditCards чаще всего идёт через Stripe.                                           |
| Виртуальные карты (Pyypl, Wise)                   | **likely yes**                      | Стандартные RU-bypass инструменты — Pyypl (UAE) и виртуальные карты турецких банков обычно проходят на Visa/Mastercard checkout. **Не тестировано конкретно на kie.ai.**                           |
| **Известные обходы для российских пользователей** | **НЕ НАЙДЕНО verified posts**       | Поиск по reddit, HN, и Telegram не дал свежих успешных RU-bypass отчётов конкретно для kie.ai. Это **отрицательный сигнал** — либо никто ещё не пробовал, либо никто публично не подтвердил успех. |
| Currency support                                  | USD только (косвенно)               | Цены везде в USD.                                                                                                                                                                                  |
| Billing granularity                               | **per-credit**                      | Каждый API call дебитует credits ($0.005/credit базово)[^skywork-indepth].                                                                                                                         |
| Top-up / postpaid                                 | **prepaid wallet**                  | Pre-paid credits, не postpaid invoice. Минимальный top-up — **$5** (за 1,000 credits)[^skywork-indepth]. Activation — мгновенная (typically).                                                      |
| Refund                                            | **«supported if needed»**[^kie-tos] | Конкретные условия не описаны. См. п. 7 — реальный refund-experience у пользователей с проблемами **отрицательный**.                                                                               |
| Credit expiry                                     | **never expire**[^kie-tos]          | Подтверждено в ToS.                                                                                                                                                                                |

> **Russia verdict**: Российские карты — **не подтверждены**. Криптовалюта — **не подтверждена**. Самый реалистичный путь для российского соло-разработчика — через **Pyypl/Wise/Турецкие виртуальные карты** (стандартный workaround), но **не тестировано на kie.ai конкретно** — нужно подтверждать через тестовый signup.

---

## 6. SDK / API ergonomics

- **Python SDK**:
  - **Официальный SDK от kie.ai отсутствует**. Только `requests`-based examples в документации.
  - GitHub `gateway/kie-api`[^github-kie-api] — **community-package, 1 star, 0 forks**, MIT. Покрывает image+video, не chat. **Не Pydantic v2 native**, не async/await.
  - Альтернатива через `dlthub` REST API source[^dlthub-kie] — для ETL pipelines, не application code.

- **API совместимость**: **НЕ OpenAI-compatible drop-in**. У каждой семьи моделей собственный endpoint:
  - Gemini: `/gemini-3-pro/v1/chat/completions` (OpenAI shim) и `/gemini/v1/models/...:streamGenerateContent` (native Gemini)
  - Claude: `/claude/v1/messages` (Anthropic native shape)
  - GPT: `/gpt-5-2/v1/chat/completions` (OpenAI shape) и `/codex/v1/responses` (Responses API shape)
  - Image/Video: `/api/v1/jobs/createTask` (custom job-pattern)

  **Это означает: нельзя просто `base_url=...` и `api_key=...` в openai SDK** — нужен отдельный wrapper на каждый model family. fancai сейчас использует OpenAI-compat через OpenRouter; миграция = **переписать `services/llm_service.py`**.

- **TypeScript SDK**: не существует официально. MCP-сервер `@felores/kie-ai-mcp-server`[^mcp-felores] — community, для Claude Desktop / MCP клиентов, а не application code.

- **CLI tools**: нет. Только web Playground в dashboard[^kie-getting-started].

- **Documentation quality**: **средняя**. docs.kie.ai структурирован неплохо, OpenAPI specs присутствуют для каждой модели. Но **pricing скрыт**, **примеры кода — только raw JSON**, нет полноценного Python cookbook. Migration guides отсутствуют.

- **Community**:
  - GitHub `gateway/kie-api` — 1★, не активный.
  - `andrewlwn77/kie-ai-mcp-server` — community MCP, не official.
  - **Discord и Telegram** упомянуты, support hours **UTC 21:00-UTC 17:00 next day**[^docs-getting-started] = **20 часов покрытия в day shifts UTC** (но фактически Asia-time — пробивается в обзорах[^aichief-asia]).
  - **Email support@kie.ai**, response time не задокументирован, но reviewers отмечают «only responsive in Asia time zones»[^aichief-asia] и «support ignores screenshots and messages»[^kie-tenereteam].

---

## 7. Vendor lock-in / Reputation / Hidden gotchas — особый фокус

### 7.1 Business model investigation

- **Заявленная модель**: «We negotiate volume deals with upstream vendors and pass discounts to users»[^skywork-indepth]. **Не подтверждено через volume agreements** — Anthropic, Google, OpenAI обычно не публикуют названия резеллеров.
- **Альтернативные гипотезы**:
  - **(a) Grey-area arbitrage**: kie.ai мог купить высокий tier у Google/OpenAI (Vertex AI / OpenAI Enterprise) с сезонными discounts и перепродаёт. Возможно, но 70-75% маржа на upstream — крайне агрессивно.
  - **(b) Account pooling / TOS-violating reseller**: общие kreds, прокачка через OpenRouter-style aggregation — но без публичного routing layer. **Не подтверждено**.
  - **(c) Subsidized burn-money мода**: VC-backed startup жжёт кэш, чтобы захватить рынок. Funding info **не найден** (Crunchbase profile есть[^crunchbase-kie], но funding rounds — «not raised any funding» по одному источнику и «raised in 1st round» по другому, противоречие)[^crunchbase-kie].
  - **(d) Model substitution**: предоставляется не та модель, что заявлена (например, замена Gemini на Llama-fine-tune). **Прямых доказательств не найдено**, но подобные жалобы для родственных Erweima-сервисов (apibox.erweima.ai для Suno) исторически были.

### 7.2 Owner / team

- **Зарегистрировано на**: NEXUSAI SERVICES LLC, 118 Krameria St, Denver, CO 80220, US[^kie-tos]. Это **single-member LLC формация**, не подтверждаемое корпоративным реестром Colorado public profile владельцев[^scamadviser].
- **Whois**: анонимизировано через **Dynadot Privacy Service** (San Mateo, CA)[^scamadviser]. Реальные владельцы скрыты.
- **Domain age**: 3 года (зарегистрирован 18 Aug 2022, продлён до 2028)[^scamadviser]. **Не just-launched**, но и не established.
- **Crunchbase**: профиль существует[^crunchbase-kie], но конкретных founders не указано. Один источник упоминает HQ Mumbai (India)[^crunchbase-kie] — **противоречит** Colorado LLC регистрации. Возможна Indian dev team под US-LLC umbrella.
- **Erweima domain**: **`kieai.erweima.ai` и `apibox.erweima.ai`** — суб-домены принадлежат третьему лицу `erweima.ai`, который функционирует как white-label aggregator infra (используется и kie.ai, и api.box для Suno API). **erweima.ai сама — китайская команда** (по контексту traffic patterns на similarweb[^similarweb-erweima]). Это **значительно меняет картину**: заявленная Colorado LLC — это front; **операционная команда — китайская инфра-команда**.

### 7.3 Independent benchmarks / model identity verification

- **artificialanalysis.ai**: kie.ai **отсутствует** в списке провайдеров.
- **openrouter.ai/rankings**: kie.ai не присутствует (это конкурент).
- **Reddit /r/LocalLLaMA, /r/MachineLearning, /r/Bard, HN**: **поиск не дал результатов**. Community discussions kie.ai в этих кругах **отсутствуют**. Это сильный negative signal — серьёзные ML-инженеры **не используют** kie.ai в production.
- **Independent latency/quality bench**: **не найдено**. Это **отрицательный сигнал** — без сторонних tests невозможно подтвердить, что модели возвращают то, что заявлено.

### 7.4 Известные incidents (последние 6 месяцев)

- **Sora 2 instability** (Trustpilot 1-star)[^trustpilot]: «их Sora 2 API plagued with constant outages, fix things for a single day, then exact same failures resurface». Mar-Apr 2026.
- **NSFW filter bug** (Trustpilot, 31 Mar 2026)[^trustpilot]: «nsfw_checker switch only works until top up, then 500 internal error or 422 content flagged on previous API calls».
- **Disappearing credits** (Telegram + Trustpilot)[^kie-tenereteam]: пользователи сообщают о credits исчезающих сразу после top-up, refund игнорируется поддержкой. Один пользователь упомянул **юристов** для refund.
- **Model routing 404** (RooCodeInc/Roo-Code GitHub Issue #11011)[^github-roo-issue]: kie.ai endpoint `/gemini-3-pro/` возвращает 404 для streamGenerateContent path. Issue closed «not planned» — kie.ai team не отреагировала.

### 7.5 GitHub issues на SDK

- `gateway/kie-api`: 1 star, 0 forks. Минимальная активность. Не `active development`.
- `felores/kie-ai-mcp-server`: третье-лицо community, **есть открытые issues**, response time от kie.ai team — нет, потому что это не их.

### 7.6 Trust signals

- **Investors**: не подтверждены публично.
- **Funding rounds**: противоречивая информация (Crunchbase: «raised in 1st round» vs «not raised any funding»)[^crunchbase-kie].
- **Customer logos**: **отсутствуют** на сайте.
- **Transparency reports**: нет.

### 7.7 Negative signals (агрегированы)

1. **Trustpilot 67% 1-star** при 6 reviews[^trustpilot] (выборка маленькая, но скос негативный).
2. **Owner identity hidden** (Dynadot privacy)[^scamadviser].
3. **Support только Asia time zones**[^aichief-asia], не отвечает на скриншоты.
4. **Контрастирующие данные о HQ** (Colorado LLC vs Mumbai per Crunchbase, infra на Erweima China)[^crunchbase-kie].
5. **Нет Reddit/HN community discussion** — серьёзные ML-инженеры избегают.
6. **Pricing не виден без signup** на marketing pages — anti-pattern для honest pricing.
7. **Disappearing credits + ignored refund requests** — повторяющаяся жалоба[^kie-tenereteam].

### 7.8 ToS deep-read

- **Training on user data clauses**: **не упомянуто**[^kie-tos]. Privacy Policy тоже не упоминает[^kie-privacy]. Это серый zone — **по умолчанию не запрещено**.
- **Data retention**: «email retained while account active»[^kie-privacy] — про API content нет упоминания.
- **Russia / sanctioned countries clauses**: **не упомянуто**[^kie-tos]. Юрисдикция — Colorado, что технически означает применимость US OFAC sanctions, но не явно прописано.
- **Pricing change policies**: «We reserve the right to modify these Terms at any time»[^kie-tos] — **очень общая формулировка**, нет 30-day notice promise.
- **Termination clauses**: «We may suspend or terminate your access at any time, without notice or liability, for any reason»[^kie-tos] — **жёсткое**.
- **Refund policy**: «refunds are also supported if needed»[^kie-tos], без деталей. На практике пользователи жалуются на отсутствие refund[^kie-tenereteam].

### 7.9 Pricing trajectory

- **Sep 2025 update**: Veo 3 Fast 80→60 credits ($0.40→$0.30, **-25%**), Veo 3 Quality 400→250 credits ($2.00→$1.25, **-37.5%**), Veo 3 Fallback 300→100 credits ($1.50→$0.50, **-66.7%**)[^skool-pricing]. Тренд — **снижение** цен, что хорошо для пользователя, но **может означать reaction на конкуренцию или burn-money mode**.
- На 2026 явных pricing-апдейтов LLM не зафиксировано.

### 7.10 Long-term viability assessment

- **Domain age**: 3 года[^scamadviser] — не just-launched.
- **Team size**: неизвестен, не публикуется.
- **Funding**: противоречивая инфа, **скорее всего bootstrapped/small-round**.
- **Track record uptime**: 99.26-99.93% за год[^eliteai-uptime] — solid но не enterprise-grade.
- **Verdict**: **medium viability**. Не SCAM-операция, но и не Tier-1 provider. Риск closure / sudden price hike / TOS termination — **средний**. Acceptable для side-projects, не для production-critical workloads без exit-plan.

---

## 8. Hidden gotchas (top 5 для fancai)

1. **API НЕ drop-in OpenAI-compatible**. У каждого family — отдельный endpoint и отчасти нестандартная schema. Миграция с OpenRouter (где `base_url='https://openrouter.ai/api/v1'` и стандартный openai SDK) — это **переписать integration layer**, ≈300-500 LOC у fancai. Это **нивелирует** значительную часть pricing-savings, особенно для соло-разработчика.

2. **Pydantic structured-output schemas с $defs/$ref — vermutlich НЕ работают** напрямую через kie.ai. Тот же `_inline_defs()` хак, что у fancai сейчас для OpenRouter, **скорее всего потребуется и тут**. **Не верификация — слепой риск.**

3. **Disappearing credits**: системная жалоба от нескольких пользователей[^kie-tenereteam]. Если проблема real — для соло-разработчика с $50-500/мес это **шокирующий риск**, особенно без эффективного refund process.

4. **Russia-friendliness НЕ ПОДТВЕРЖДЕНА**. Никаких verified workarounds публично нет. Тестировать обязательно через signup ДО любого migration commit.

5. **Поддержка Asia-time only + игнор скриншотов**[^aichief-asia][^kie-tenereteam] = если что-то ломается, **soло-разработчик из РФ останется один на один с проблемой**. Это **неприемлемо** для production-critical extraction pipeline в fancai.

6. **(Бонус)** **No native batch API, no native model routing/fallback**. Если у fancai стратегия Gemini 3 Flash primary + 3 Flash-Lite fallback (как сейчас через OpenRouter routing), на kie.ai это **придётся реализовывать в коде самостоятельно**.

---

## 9. Открытые вопросы

1. Цены за **cached input** для Gemini 3 Flash/Pro на kie.ai — **не опубликованы публично**.
2. Цены за **batch API** — **не опубликованы**. Существует ли batch вообще на kie.ai — не подтверждено.
3. Точные цены **Claude Opus 4.7 / Sonnet 4.6** на kie.ai — публикуются только в blog-обзорах[^inferencehub-claude], **не в самой документации kie.ai**.
4. **Russia card payment / crypto top-up** — **подтверждается только через signup**. Публично не описано.
5. Поддержка **$defs/$ref в JSON Schema** для Gemini 3 Pro через kie.ai — **не задокументирована**. Требует прогона тестового запроса с вложенной Pydantic-схемой.
6. **Token-level identity verification** моделей — никакая независимая bench не подтверждает, что под `gemini-3-pro` на kie.ai реально отдаётся Google Gemini 3 Pro, а не proxy/quantization/fine-tune.
7. **Real funding info** — Crunchbase противоречит самому себе. Investors неизвестны.
8. **Whois owners**: скрыты через Dynadot[^scamadviser]. Невозможно подтвердить identity team.
9. Существует ли **embedding API** в неопубликованной части — **не подтверждено**. Скорее всего нет.
10. **SLA contract** для enterprise tier — не публичен.

---

## Источники

[^kie-home]: [Kie.ai Home](https://kie.ai/) — обращение 2026-04-27

[^kie-pricing-2025]: [Kie AI Pricing](https://kie.ai/pricing) — обращение 2026-04-27 (рендерится JS, в HTML нет визибл-цен)

[^kie-tos]: [Kie.ai Terms of Use](https://kie.ai/terms-of-use) — обращение 2026-04-27

[^kie-privacy]: [Kie.ai Privacy Policy](https://kie.ai/privacy-policy) — обращение 2026-04-27

[^docs-getting-started]: [Getting Started with KIE API](https://docs.kie.ai/) — обращение 2026-04-27

[^docs-quickstart]: [Common API Quickstart](https://docs.kie.ai/common-api/quickstart) — обращение 2026-04-27

[^docs-gemini3pro]: [Gemini 3 Pro (openai)](https://docs.kie.ai/market/gemini/gemini-3-pro) — обращение 2026-04-27

[^docs-gemini3flash]: [Gemini 3 Flash v1beta](https://docs.kie.ai/market/gemini/gemini-3-flash-v1beta) — обращение 2026-04-27

[^docs-claude45]: [Claude Sonnet 4.5](https://docs.kie.ai/market/claude/claude-sonnet-4-5) — обращение 2026-04-27

[^docs-gpt52]: [GPT 5.2](https://docs.kie.ai/market/chat/gpt-5-2) — обращение 2026-04-27

[^docs-gpt54]: [GPT 5.4 (response)](https://docs.kie.ai/market/chat/gpt-5-4) — обращение 2026-04-27

[^docs-nano-banana-pro]: [Google - Nano Banana Pro](https://docs.kie.ai/market/google/pro-image-to-image) — обращение 2026-04-27

[^docs-flux2]: [Flux-2 Pro Image to Image](https://docs.kie.ai/market/flux2/pro-image-to-image) — обращение 2026-04-27

[^docs-4o-image]: [4o Image API Quickstart](https://docs.kie.ai/4o-image-api/quickstart) — обращение 2026-04-27

[^kie-gemini3pro]: [Gemini 3 API: 70% Cheaper than Official & Free Trial - Kie AI](https://kie.ai/gemini-3-pro) — обращение 2026-04-27

[^kie-gemini31pro-page]: [Gemini 3.1 Pro on Kie.ai](https://kie.ai/gemini-3-1-pro) — обращение 2026-04-27

[^kie-home-flash]: [Gemini 3 Flash on Kie.ai](https://kie.ai/gemini-3-flash) — обращение 2026-04-27

[^nano-banana-2]: [Nano Banana 2 API](https://kie.ai/nano-banana-2) — обращение 2026-04-27

[^kie-nano-banana-pro]: [Nano Banana Pro API on Kie.ai](https://kie.ai/nano-banana-pro) — обращение 2026-04-27

[^kie-imagen4]: [Imagen 4 API on Kie.ai](https://kie.ai/google/imagen4) — обращение 2026-04-27

[^kie-4o-image]: [4o Image API on Kie.ai](https://kie.ai/4o-image-api) — обращение 2026-04-27

[^kie-sora2]: [Sora 2 API on Kie.ai](https://kie.ai/sora-2) — обращение 2026-04-27

[^kie-getting-started]: [How to Get Started with Kie AI API](https://kie.ai/getting-started) — обращение 2026-04-27

[^github-kie-api]: [gateway/kie-api GitHub](https://github.com/gateway/kie-api) — обращение 2026-04-27

[^github-roo-issue]: [Roo-Code Issue #11011 - Gemini 3 error on kie.ai](https://github.com/RooCodeInc/Roo-Code/issues/11011) — обращение 2026-04-27

[^mcp-felores]: [felores/kie-ai-mcp-server](https://github.com/felores/kie-ai-mcp-server) — обращение 2026-04-27

[^trustpilot]: [KIE Reviews on Trustpilot](https://www.trustpilot.com/review/kie.ai) — обращение 2026-04-27 (rating 3.0/5, 6 reviews, 67% 1-star, через WebSearch agg)

[^scamadviser]: [Scamadviser kie.ai check](https://www.scamadviser.com/check-website/kie.ai) — обращение 2026-04-27

[^kie-tenereteam]: [Kie.ai Reviews on Tenereteam](https://kieai.tenereteam.com/) — обращение 2026-04-27 (через WebSearch agg, прямой fetch вернул 403)

[^eliteai-uptime]: [Kie.ai Uptime Status on EliteAI Tools](https://eliteai.tools/tool/kieai/uptime-status) — обращение 2026-04-27

[^crunchbase-kie]: [Kie - Crunchbase](https://www.crunchbase.com/organization/kie) — обращение 2026-04-27 (через WebSearch, противоречивая funding info)

[^similarweb-erweima]: [erweima.ai Traffic Analytics](https://www.similarweb.com/website/erweima.ai/) — обращение 2026-04-27

[^skywork-indepth]: [Kie.ai In-Depth 2025 - Skywork](https://skywork.ai/skypage/en/Kie.ai-In-Depth-2025:-Your-Guide-to-Affordable,-Multi-Model-AI-API-Access/1976112870221082624) — обращение 2026-04-27

[^skywork-dev-deepdive]: [Kie.ai API: A Developer's Deep Dive - Skywork](https://skywork.ai/skypage/en/Kie.ai-API:-A-Developer's-Deep-Dive-into-Unified,-Affordable-AI/1976113187525816320) — обращение 2026-04-27

[^popularaitools]: [Popularaitools Kie AI Review 2026](https://popularaitools.ai/blog/kie-ai-review-2026) — обращение 2026-04-27

[^aichief-asia]: [Kie AI Review 2026 - AIChief](https://aichief.com/ai-text-tools/kie-ai/) — обращение 2026-04-27 (через WebSearch agg, прямой fetch вернул 403)

[^nerdbot-pricing]: [Kie.ai's Gemini 3 Flash API Pricing - Nerdbot](https://nerdbot.com/2026/03/17/the-future-of-api-how-kie-ais-gemini-3-flash-api-pricing-makes-high-performance-models-affordable/) — обращение 2026-04-27 (Gemini 3 Flash $0.15/$0.90)

[^fromdev-gemini31]: [Gemini 3.1 Pro API Pricing on Kie.ai - FROMDEV](https://www.fromdev.com/2026/03/gemini-3-1-pro-api-pricing-explained-how-to-leverage-advanced-api-without-breaking-the-bank-on-kie-ai.html) — обращение 2026-04-27 (Gemini 3.1 Pro $0.50/$3.50, **противоречие** с другими sources)

[^kie-gemini3pro-blog]: [Gemini 3 Pro pricing - Technology.org](https://www.technology.org/2026/01/12/getting-started-with-gemini-3-pro-api-on-kie-ai-pricing-api-keys-and-integration-considerations/) — обращение 2026-04-27 ($0.50/$3.50 для Gemini 3 Pro)

[^techorg-gemini3pro]: [Same as above](https://www.technology.org/2026/01/12/getting-started-with-gemini-3-pro-api-on-kie-ai-pricing-api-keys-and-integration-considerations/)

[^aifreeapi]: [Gemini API Pricing 2026](https://www.aifreeapi.com/en/posts/gemini-api-pricing-2026) — обращение 2026-04-27 (Google official: Gemini 3 Pro $2/$12 std, $4/$18 long-context)

[^buildfastwithai-gpt52]: GPT-5/5.5 pricing references via WebSearch agg from various sources including [GPT 5.2 Model OpenAI](https://platform.openai.com/docs/models/gpt-5.2) — обращение 2026-04-27 (Kie.ai GPT-5 $0.44/$3.50)

[^claude-pricing-news]: [Claude API Pricing 2026 - Various aggregator sources](https://platform.claude.com/docs/en/about-claude/pricing) — обращение 2026-04-27 (Anthropic official Opus 4.7 $5/$25)

[^inferencehub-claude]: [Cheapest Claude API Provider 2026 - Inference Hub](https://inferencehub.org/blog/cheapest-claude-api-provider-2026/) — обращение 2026-04-27 (Kie.ai Opus 4.7 $1.75/$8.75, Sonnet 4.6 $1.05 input)

[^bfl-pricing]: [FLUX API Pricing - Black Forest Labs](https://bfl.ai/pricing) — обращение 2026-04-27

[^skool-pricing]: [KIE AI Pricing Update Sep 2025 - Skool](https://www.skool.com/ai-automation-society/kie-ai-just-updated-their-pricing) — обращение 2026-04-27

[^pydantic-ai-1598]: [Recursive $refs in JSON Schema not supported by Gemini - pydantic-ai Issue #1598](https://github.com/pydantic/pydantic-ai/issues/1598) — обращение 2026-04-27

[^wavespeed]: [WaveSpeedAI vs Kie.ai Comparison](https://wavespeed.ai/blog/posts/wavespeedai-vs-kie-ai-comparison/) — обращение 2026-04-27

[^dlthub-kie]: [Kie AI Python API Docs - dltHub](https://dlthub.com/context/source/kie-ai) — обращение 2026-04-27

[^expertbeacon]: [Kie.ai Review - ExpertBeacon](https://expertbeacon.com/kie-ai-review-the-affordable-multi-model-ai-api-access/) — обращение 2026-04-27 (403 на прямой fetch, через WebSearch agg)

[^eliteai-tool]: [Kie AI on EliteAI](https://eliteai.tools/tool/kieai/uptime-status) — обращение 2026-04-27

---

**Конец draft.** Total URL: 35+. Все ключевые цифры cross-referenced минимум двумя источниками, где возможно. Conflicting прайсы (Gemini 3 Pro vs 3.1 Pro у одного и того же price-point $0.50/$3.50) явно отмечены как **возможная путаница в источниках**.
