# OpenRouter — глубокое исследование (2026-04-27)

> **Контекст:** fancai — production читалка fiction (https://fancai.ru), стек React 19 + FastAPI + PostgreSQL/Redis/Celery. AI-задачи: extraction русских entities из глав, dedup, synthesis, RU→EN translation, image generation. Текущий провайдер — OpenRouter (Gemini 2.5 Flash tiered). Цель отчёта — зафиксировать текущее состояние OpenRouter на 2026-04-27 для решения о миграции/сохранении.

---

## 0. TL;DR

- **Per-token markup = 0%**. Цены на OpenRouter ровно совпадают с upstream (Anthropic, Google, BFL). Единственный overhead — **5.5 % credit-purchase fee** на пополнение баланса.
- **Все актуальные модели 2026 доступны**: Gemini 3.x (3 Flash/Pro Preview, 3.1 Flash/Pro Preview, 3.1 Flash Lite), Claude Opus 4.7 (16 апреля 2026), Claude Sonnet 4.6, Claude Haiku 4.5, GPT-5/5.1/5.4/5.5, Nano Banana 2 (`google/gemini-3.1-flash-image-preview`), GPT-5.4 Image 2, FLUX.2 Pro/Klein/Max. **FLUX.3 не существует** — линейка сейчас FLUX.2.
- **Batch API НЕТ**. Google direct даёт −50 %, OpenRouter этот discount не транслирует.
- **Caching ЕСТЬ**. Anthropic `cache_control` headers (cache write 1.25× / 2× базы, read 0.25×, TTL 5m/1h) и Gemini implicit + explicit caching работают через OpenRouter с провайдер-стики роутингом для cache-hit максимизации.
- **Reasoning controls**: `reasoning.effort` (xhigh/high/med/low/minimal) — для OpenAI/Grok; `reasoning.max_tokens` — для Anthropic/Gemini-2.5/Qwen. Для Gemini 3 точный budget невозможен — мапится на `thinkingLevel`.
- **Russia friendliness**: API не блокирован, без VPN. Российские карты (Мир, RU-issued V/MC) **не принимаются** напрямую — нужны foreign cards / USDC (Coinbase Commerce, 5 % крипто-fee) / посредники (Oplatym, ProxyAPI).
- **Compliance**: SOC 2, ISO 27001, HIPAA, GDPR, FedRAMP, CSA Star Level 1 подтверждены. ZDR (Zero Data Retention) по умолчанию — prompts не сохраняются, если не включить prompt logging вручную (за 1 % discount).
- **Известные баги**: $defs/$ref в JSON Schema всё ещё ломают Google-models через OpenRouter (нужен inline workaround), `response.parsed` отсутствует — только raw JSON в `message.content`.
- **Новое за 3 месяца**: Workspaces (Apr 22), Video Generation API (Apr 15), Auto Exacto adaptive routing (Mar 12), Agent SDK (Apr 24).

---

## 1. Pricing

### 1.1 Текстовые LLM (актуальные 2026-04-27)

| Модель                            | OpenRouter Model ID                    | Релиз       | Std input /1M                 | Std output /1M  | Cache write /1M                            | Cache read /1M | Batch                     | Storage    | Context                    | Max output | Reasoning контроль                                    | Markup vs upstream                                                 |
| --------------------------------- | -------------------------------------- | ----------- | ----------------------------- | --------------- | ------------------------------------------ | -------------- | ------------------------- | ---------- | -------------------------- | ---------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| **Claude Opus 4.7**               | `anthropic/claude-opus-4.7`            | 16 Apr 2026 | $5.00                         | $25.00          | $6.25 (5m) / $10.00 (1h)                   | $1.25          | ❌                        | ❌         | 1M                         | 64K        | `reasoning.max_tokens` (adaptive thinking by default) | **0 %** ([upstream $5/$25](https://www.anthropic.com/claude/opus)) |
| **Claude Opus 4.6**               | `anthropic/claude-opus-4.6`            | 4 Feb 2026  | $5.00                         | $25.00          | как 4.7                                    | $1.25          | ❌                        | ❌         | 1M                         | 64K        | adaptive thinking                                     | **0 %**                                                            |
| **Claude Sonnet 4.6**             | `anthropic/claude-sonnet-4.6`          | 17 Feb 2026 | $3.00                         | $15.00          | $3.75 / $6.00                              | $0.75          | ❌                        | ❌         | 1M                         | 64K        | adaptive thinking                                     | **0 %**                                                            |
| **Claude Haiku 4.5**              | `anthropic/claude-haiku-4.5`           | 15 Oct 2025 | $1.00                         | $5.00           | $1.25 / $2.00                              | $0.25          | ❌                        | ❌         | 200K                       | 32K        | adaptive thinking                                     | **0 %**                                                            |
| **GPT-5.5 Pro**                   | `openai/gpt-5.5-pro`                   | 24 Apr 2026 | $30.00                        | $180.00         | по OpenAI auto-cache (read 0.25–0.50×)     | —              | ❌                        | —          | 1.05M (922K in / 128K out) | 128K       | `reasoning.effort` low–xhigh                          | **0 %**                                                            |
| **GPT-5.5**                       | `openai/gpt-5.5`                       | 24 Apr 2026 | $5.00                         | $30.00          | auto-cache                                 | —              | ❌                        | —          | 1.05M                      | 128K       | effort                                                | **0 %**                                                            |
| **GPT-5.4**                       | `openai/gpt-5.4`                       | 5 Mar 2026  | $2.50                         | $15.00          | auto-cache                                 | —              | ❌                        | —          | 1.05M                      | 128K       | effort                                                | **0 %**                                                            |
| **GPT-5**                         | `openai/gpt-5`                         | 7 Aug 2025  | $1.25                         | $10.00          | auto-cache                                 | —              | ❌                        | —          | 400K                       | —          | effort                                                | **0 %**                                                            |
| **GPT-5 Mini**                    | `openai/gpt-5-mini`                    | 7 Aug 2025  | $0.25                         | $2.00           | auto-cache                                 | —              | ❌                        | —          | 400K                       | —          | effort                                                | **0 %**                                                            |
| **GPT-5 Nano**                    | `openai/gpt-5-nano`                    | 7 Aug 2025  | $0.05                         | $0.40           | auto-cache                                 | —              | ❌                        | —          | 400K                       | —          | effort                                                | **0 %**                                                            |
| **Gemini 3.1 Pro Preview**        | `google/gemini-3.1-pro-preview`        | 19 Feb 2026 | $2.00 (≤200K) / $4.00 (>200K) | $12.00 / $18.00 | implicit (0.1×) + explicit `cache_control` | 0.1× input     | ❌ (Google direct: −50 %) | $4.50/M·hr | 1.05M                      | —          | `thinkingLevel` (low/medium/high)                     | **0 %** ([upstream $2/$12](https://ai.google.dev/pricing))         |
| **Gemini 3.1 Flash Lite Preview** | `google/gemini-3.1-flash-lite-preview` | 3 Mar 2026  | $0.25                         | $1.50           | implicit                                   | 0.1×           | ❌ (direct: −50 %)        | $1.00/M·hr | 1.05M                      | —          | thinkingLevel                                         | **0 %**                                                            |
| **Gemini 3 Flash Preview**        | `google/gemini-3-flash-preview`        | 17 Dec 2025 | $0.50                         | $3.00           | implicit                                   | 0.1×           | ❌ (direct: −50 %)        | $1.00/M·hr | 1.05M                      | —          | thinkingLevel                                         | **0 %**                                                            |
| **Gemini 2.5 Flash**              | `google/gemini-2.5-flash`              | 17 Jun 2025 | $0.30                         | $2.50           | implicit (1028 tok min)                    | 0.1×           | ❌                        | $1.00/M·hr | 1.05M                      | —          | `reasoning.max_tokens` → `thinkingBudget`             | **0 %** (текущий fancai baseline)                                  |
| **Gemini 2.5 Flash Lite**         | `google/gemini-2.5-flash-lite`         | 22 Jul 2025 | $0.10                         | $0.40           | implicit                                   | 0.1×           | ❌                        | $1.00/M·hr | 1.05M                      | —          | thinkingBudget                                        | **0 %**                                                            |
| **DeepSeek V4 Pro**               | `deepseek/deepseek-v4-pro`             | 24 Apr 2026 | $0.435                        | $0.87           | n/a                                        | n/a            | ❌                        | —          | 1.05M                      | —          | —                                                     | n/a (DeepSeek через OR)                                            |
| **DeepSeek V4 Flash**             | `deepseek/deepseek-v4-flash`           | 24 Apr 2026 | $0.14                         | $0.28           | n/a                                        | n/a            | ❌                        | —          | 1.05M                      | —          | —                                                     | n/a                                                                |
| **DeepSeek V3.2**                 | `deepseek/deepseek-v3.2`               | 1 Dec 2025  | $0.252                        | $0.378          | n/a                                        | n/a            | ❌                        | —          | 131K                       | —          | —                                                     | n/a                                                                |
| **DeepSeek R1**                   | `deepseek/deepseek-r1`                 | 20 Jan 2025 | $0.70                         | $2.50           | n/a                                        | n/a            | ❌                        | —          | 64K                        | —          | reasoning native                                      | n/a                                                                |
| **Kimi K2.6**                     | `moonshotai/kimi-k2.6`                 | 20 Apr 2026 | $0.7448                       | $4.655          | n/a                                        | n/a            | ❌                        | —          | 256K                       | —          | —                                                     | #1 на OR rankings                                                  |
| **Grok 4.1 Fast**                 | `x-ai/grok-4.1-fast`                   | —           | $0.20                         | $0.50           | n/a                                        | n/a            | ❌                        | —          | —                          | —          | effort                                                | n/a                                                                |

**Подтверждение нулевого markup:**

- Claude Opus 4.7 на OR `$5/$25` ([openrouter.ai/anthropic/claude-opus-4.7](https://openrouter.ai/anthropic/claude-opus-4.7)) ↔ Anthropic direct `$5/$25` ([anthropic.com/claude/opus](https://www.anthropic.com/claude/opus))
- Gemini 3.1 Flash Lite Preview на OR `$0.25/$1.50` ↔ Google AI Studio `$0.25/$1.50` ([ai.google.dev/pricing](https://ai.google.dev/pricing))
- Gemini 3 Flash Preview на OR `$0.50/$3.00` ↔ Google AI Studio `$0.50/$3.00`

### 1.2 Free models / Auto-router (на 2026-04-27)

- **Free tier**: 25+ моделей с zero-cost (DeepSeek R1 free, Llama 3.3 70B Instruct, Gemma 3, и др.). Лимит: **20 RPM, 50 RPD** для аккаунтов без депозита; **1000 RPD** при балансе ≥ $10 (один раз пополненный, не активный). ([costgoat.com/pricing/openrouter-free-models](https://costgoat.com/pricing/openrouter-free-models))
- **Auto Router** (`openrouter/auto`): автоматически выбирает модель под задачу; pricing рассчитывается по реально использованной модели + small premium. Подходит для прототипирования, не для production-fancai (нет детерминизма цены).
- **Auto Exacto** (анонс 12 Mar 2026): провайдер-роутинг, переоценивающий каждые 5 минут throughput, tool-call accuracy и benchmark scores. **По умолчанию ВКЛЮЧЁН для запросов с tools.** Дал –88 % tool-call ошибок на GLM-5, –80 % на GLM-4.7. ([openrouter.ai/announcements/auto-exacto](https://openrouter.ai/announcements/auto-exacto))

### 1.3 Image Generation (актуальные 2026-04-27)

| Модель                                             | OpenRouter Model ID                     | Релиз       | Pricing schema                                                           | 1024×1024 (1 MP) cost        | Max resolution                       | Editing/img2img   | Native text            | OpenRouter markup vs upstream |
| -------------------------------------------------- | --------------------------------------- | ----------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------ | ----------------- | ---------------------- | ----------------------------- |
| **Nano Banana 2** (Gemini 3.1 Flash Image Preview) | `google/gemini-3.1-flash-image-preview` | 26 Feb 2026 | per-token (input $0.50/M, output $3/M; ~$60/M output reported by Google) | ~$0.045–0.151                | до 4K (через Pro)                    | да                | да (Google native)     | 0 % vs Google direct          |
| **Nano Banana Pro** (Gemini 3 Pro Image Preview)   | `google/gemini-3-pro-image-preview`     | 20 Nov 2025 | per-token (input $2/M, output $12/M)                                     | ~$0.20–0.40                  | до 4K                                | да                | да                     | 0 %                           |
| **GPT-5.4 Image 2**                                | `openai/gpt-5.4-image-2`                | 21 Apr 2026 | per-token ($8/M in, $15/M out)                                           | ~$0.20–0.30                  | OpenAI: `low/med/high`, до 4K beta   | inpainting/edits  | да                     | 0 %                           |
| **GPT-5 Image**                                    | `openai/gpt-5-image`                    | 14 Oct 2025 | per-token ($10/M in, $10/M out)                                          | ~$0.20                       | до 1024²                             | edits             | да                     | 0 %                           |
| **FLUX.2 Pro**                                     | `black-forest-labs/flux.2-pro`          | 25 Nov 2025 | per-MP (output $0.07 first MP + $0.03 each, input $0.015/MP)             | **$0.07**                    | до 4 MP (2K)                         | да (img2img edit) | да (улучшено в FLUX.2) | 0 % vs BFL `$0.07`            |
| **FLUX.2 Klein 4B**                                | `black-forest-labs/flux.2-klein-4b`     | 14 Jan 2026 | per-MP ($0.014 first + $0.001 each)                                      | **$0.014**                   | n/a (Apache 2.0 open-source distill) | да                | partial                | 0 % (текущий fancai baseline) |
| **FLUX.2 Max**                                     | `black-forest-labs/flux.2-max`          | конец 2025  | per-MP ($0.07 first + $0.03 each, input $0.03/MP)                        | **$0.07–0.13** (4MP ≈ $0.16) | до 4 MP                              | да                | да (frontier quality)  | 0 %                           |

> **Важно:** FLUX.3 на 2026-04-27 **не существует**. Black Forest Labs — линейка FLUX.2 (Pro, Max, Klein, dev, Flex). Imagen 4/5 на OpenRouter **не наблюдается на странице** [openrouter.ai/collections/image-models](https://openrouter.ai/collections/image-models) — Google продвигает Nano Banana 2 как замену.

### 1.4 Video Generation (новое — Apr 2026)

- Анонс 15 Apr 2026: **Veo 3.1 (`google/veo-3.1`), Seedance 2.0 (ByteDance), Kling (Kuaishou), OpenAI video** доступны через единый OR API. Не релевантно для fancai сейчас, но архитектурно полезно — единый layer для будущих фич.

### 1.5 Embeddings / Reranker

- OpenRouter поддерживает embeddings и reranker модели (упоминается «text, images, audio, embeddings, and rerankers under the same routing»). Конкретный каталог — отдельная страница, не критично для fancai (TanStack Query кеширует, embeddings не используются в текущем pipeline).

---

## 2. Feature Parity (16 критериев)

| #   | Критерий                              | Статус           | Примечание                                                                                                                                                                                                                                                                              | Источник                                                                                                   |
| --- | ------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **JSON Schema (response_format)**     | ✅ partial       | Strict mode `{ type: 'json_schema', strict: true }` поддерживается на OpenAI ≥4o, Google Gemini, Anthropic Sonnet 4.5/Opus 4.1+, Fireworks-served моделях. Совет: всегда `strict: true`.                                                                                                | [docs/structured-outputs](https://openrouter.ai/docs/guides/features/structured-outputs)                   |
| 2   | **$defs/$ref в JSON Schema**          | ⚠️ BUG активен   | Гугл-модели через OR деградируют output при наличии `$defs`/`$ref`/`anyOf:[…,{type:null}]`. Workaround: `prefer_inlined_defs=True` + `simplify_nullable_unions=True` (см. fancai `_inline_defs()`). Direct Gemini API эту проблему не имеет.                                            | [pydantic/pydantic-ai #3617](https://github.com/pydantic/pydantic-ai/issues/3617)                          |
| 3   | **response.parsed**                   | ❌ НЕТ           | Только raw JSON string в `message.content` — клиент парсит сам в Pydantic. У OpenAI native SDK есть `response.parsed`, у OR нет.                                                                                                                                                        | [docs/structured-outputs](https://openrouter.ai/docs/guides/features/structured-outputs)                   |
| 4   | **Function calling / Tools**          | ✅ единый формат | OpenAI-compat: `tools`/`tool_choice`. OpenRouter трансформирует в native формат провайдера. Auto Exacto on-by-default для tool-requests = +10–20 % accuracy.                                                                                                                            | [docs/api/reference/overview](https://openrouter.ai/docs/api/reference/overview)                           |
| 5   | **Streaming SSE**                     | ✅ да            | `stream: true`, все модели.                                                                                                                                                                                                                                                             | [docs/api/reference/overview](https://openrouter.ai/docs/api/reference/overview)                           |
| 6   | **System instructions**               | ✅ единое поле   | `role: "system"` сообщение. OR нормализует под Gemini `systemInstruction` etc.                                                                                                                                                                                                          | docs                                                                                                       |
| 7   | **Multi-turn / stateless**            | ✅ stateless     | Передаёшь полный `messages[]` history каждый раз — стандарт OpenAI Chat Completions.                                                                                                                                                                                                    | docs                                                                                                       |
| 8   | **Multimodal input**                  | ✅ да            | Vision через `ImageContentPart` (URL или base64). PDF — через `messages` (file plugin или native, если модель поддерживает). Limits: до 20 MB файлов (упомянуто разными гайдами).                                                                                                       | [docs/multimodal/pdfs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)                         |
| 9   | **Multimodal output**                 | ✅ да            | Image models (Nano Banana 2, FLUX.2, GPT Image) возвращают `base64-encoded data URLs in the assistant message`. Параметр `modalities: ["image"]` или `modalities: ["image", "text"]`.                                                                                                   | [docs/multimodal/image-generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) |
| 10a | **Anthropic prompt caching**          | ✅ да            | `cache_control` headers (top-level или per-block). Write 5m TTL = 1.25× input; 1h TTL = 2× input; read = 0.25×. Min: Opus 4.7/Haiku 4.5 — 4096 tok; Sonnet 4.6 — 2048 tok. Limit: только когда роут идёт **directly через Anthropic**, не Bedrock/Vertex (для top-level cache_control). | [docs/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)      |
| 10b | **Gemini context caching (implicit)** | ✅ да            | Gemini 2.5 Flash: min 1028 tok; 2.5 Pro: 2048 tok; 3.x — TBD. TTL 3–5 min. Cached read = 0.1× input. **Sticky routing** — последующие запросы попадают на тот же endpoint.                                                                                                              | [docs/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)      |
| 10c | **Gemini context caching (explicit)** | ✅ partial       | `cache_control` breakpoints в message content; **OR использует только последний breakpoint** для Gemini. `systemInstruction` immutable в кеше — нельзя дёргать динамику. Storage charge = упстрим (Google $1/M·hr Flash, $4.50 Pro).                                                    | docs                                                                                                       |
| 11  | **Batch API**                         | ❌ НЕТ           | OpenRouter не транслирует Google/Anthropic batch (50 % discount). Это значимый minus для fancai, где extraction глав книги — идеальный batch use case. Альтернатива: BYOK (Bring Your Own Key) → use Google direct batch с частичной OR-обвязкой.                                       | результат поиска (нет в OR docs)                                                                           |
| 12  | **File API native**                   | ✅ partial       | PDF inputs через chat completions endpoint (URL или base64), для моделей с native file support (Gemini, Claude). Файл-плагин для остальных (`file-parser`). Нет отдельного File API объекта типа OpenAI Files.                                                                          | [docs/multimodal/pdfs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)                         |
| 13a | **`reasoning.effort`**                | ✅ да            | xhigh / high / medium / low / minimal / none. Маппится на effort_ratio (0.95/0.8/0.5/0.2/0.1). OpenAI/Grok primary, для Anthropic — пересчитывается в `max_tokens` (effort \* max_tokens).                                                                                              | [docs/best-practices/reasoning-tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)  |
| 13b | **`reasoning.max_tokens`**            | ✅ partial       | Anthropic, Gemini 2.5 (через `thinkingBudget`), Qwen — да. **Gemini 3 — нет точного контроля**, пересчитывается в `thinkingLevel` (low/medium/high). См. [big-AGI #893](https://github.com/enricoros/big-agi/issues/893).                                                               | docs                                                                                                       |
| 13c | **Visible vs hidden thinking**        | ✅ контроль      | `reasoning.exclude: true` — модель думает, но не возвращает. По умолчанию reasoning видим в `message.reasoning` field (или `reasoning_details` для multi-turn). OpenAI o-series по умолчанию hidden — internal-only.                                                                    | docs                                                                                                       |
| 14  | **WebSocket / Live API**              | ❌ НЕТ           | OpenRouter — REST + SSE only. Google Live API (audio/video streaming) недоступен через OR.                                                                                                                                                                                              | n/a                                                                                                        |
| 15  | **Model versioning**                  | ✅ да            | Suffixes на модели: `-preview`, snapshot dates (e.g. `gpt-5.4-pro-2026-03-05`-style на upstream, OR использует canonical IDs). Auto-router алиасы (`openrouter/auto`).                                                                                                                  | observed                                                                                                   |
| 16  | **Per-request timeout / concurrency** | ⚠️ ограничено    | Cloudflare DDoS protection блокирует «dramatically excessive» traffic. Negative balance → 402. **TPM лимиты не публикуются явно**, провайдер-уровень throttling. Для проверки квоты: `GET /api/v1/key`. Webhooks/billing alerts — only Workspaces (Apr 22 launch).                      | [docs/api/reference/limits](https://openrouter.ai/docs/api/reference/limits)                               |

---

## 3. Reliability / Operations

### 3.1 Uptime & SLA

- **Status page** ([status.openrouter.ai](https://status.openrouter.ai)) показывает 30-дневный uptime:
  - Chat API: **99.88 %**
  - Data API: **99.92 %**
  - Homepage: **99.77 %**
  - Clerk auth: operational
- **Формальное SLA не публикуется** — только historical performance. Для Enterprise можно запросить custom SLA контракт.

### 3.2 Recent Incidents (последние 6 мес)

- **14 Apr 2026** — Generation endpoint down ~1ч 04мин (резолюция автоматическая).
- **17 & 19 Feb 2026** — outages (отдельный announcement [openrouter.ai/announcements/...](https://openrouter.ai/announcements)).
- Прочие даты — clean, no incidents.

### 3.3 Provider routing

- **Default**: price-weighted load balancing с inverse-square по cost. Если provider молчит ≥30 сек → fallback.
- **Auto Exacto** (Mar 2026): для tools-requests заменяет price на quality-weighted каждые 5 мин (throughput + tool-call telemetry + benchmarks). On by default.
- **Custom**: `provider.order=[…]`, `provider.only=[…]`, `provider.ignore=[…]`, `allow_fallbacks: false`.
- **Sticky routing для caching**: при использовании `cache_control` или implicit cache последующие запросы идут на тот же endpoint (cache-hit максимизация).

### 3.4 Latency / throughput

- На [openrouter.ai/rankings](https://openrouter.ai/rankings) показаны еженедельные tokens, но **не latency p50/p95** — для этого нужно смотреть individual model pages (там есть provider-level throughput графики).
- Top-3 моделей по traffic на 2026-04-27:
  1. Kimi K2.6 (Moonshot) — 1.58T/неделя (NEW)
  2. Claude Sonnet 4.6 — 1.36T (+2 %)
  3. DeepSeek V3.2 — 1.28T
  4. Claude Opus 4.7 — 1.15T (+279 % — взрывной рост)
  5. Gemini 3 Flash Preview — 1.04T (+9 %)

### 3.5 Concurrent / TPM / RPM

- Free tier: **20 RPM, 50 RPD** (или 1000 RPD при балансе ≥ $10).
- Paid: TPM явно не публикуется; provider-level throttling. Для production fancai (50 глав/книга, ~25 RPM peak) — комфортно.
- `GET /api/v1/key` возвращает `usage`, `limit_remaining`, daily/weekly/monthly breakdown.
- Cloudflare DDoS protection блокирует extreme spikes.

### 3.6 Debugging

- `request_id` возвращается в response headers (наблюдаемо в practice).
- Activity logs дашборд (Workspaces, Apr 22 — теперь per-environment).
- Retry headers (`retry-after`) при 429 от провайдера прокидываются.
- Billing alerts — Workspaces feature (новое).

---

## 4. Регион и Compliance

### 4.1 Geo

- **РФ доступ без VPN**: `openrouter.ai` не блокируется в РФ; API endpoint accessible. Подтверждение: [aitunnel.ru/providers/openrouter](https://aitunnel.ru/providers/openrouter), [vc.ru/services/2728935](https://vc.ru/services/2728935-podklyuchenie-openrouter-instruktsiya-dlya-razrabotchikov-v-rossii).
- VPN нужен **только** на этапе оплаты (если используется зарубежная карта от geofence-чувствительного банка).
- Edge: на Cloudflare CDN (типичный паттерн).

### 4.2 Data residency

- Enterprise tier: in-region routing, GDPR EU-region locking (для Anthropic/Google routing exclusively через EU endpoints).
- Standard: преимущественно US edges + provider-native регионы.

### 4.3 Compliance (подтверждено [trust.openrouter.ai](https://trust.openrouter.ai))

- ✅ **SOC 2** Compliant
- ✅ **HIPAA** Compliant
- ✅ **GDPR** Compliant (Article 45 adequacy + Article 46 SCCs)
- ✅ **ISO 27001** Compliant
- ✅ **FedRAMP** Compliant
- ✅ **CSA Star Level 1** Compliant

### 4.4 Data retention & privacy

- **Zero Data Retention (ZDR) by default**: prompts/responses не сохраняются, если пользователь явно не включит prompt logging.
- **Prompt logging opt-in**: даёт **1 % discount**, но «irrevocable right to commercial use» — в production fancai не включать.
- **Training opt-out**: настройка аккаунта; OR не маршрутизирует на провайдеры, тренирующие на вашей дате (но это про upstream policy провайдера, не самого OR).
- Activity logs хранятся для биллинга/audit; в Workspaces — per-environment.

---

## 5. Russia Payments

### 5.1 Что не работает

- **Российские карты Мир / RU-issued Visa / Mastercard / Tinkoff**: ❌ блокируются BIN-фильтром Stripe. Нет workaround «через приложение».

### 5.2 Что работает (на 2026-04-27)

- **Иностранные карты**: Kazakhstan / Kyrgyzstan / Armenia / Georgia / Turkey / Uzbekistan-issued Visa/Mastercard. Open foreign account → V/MC → top-up.
- **USDC** (только эта стейблкоин): через OpenRouter Crypto Payments API (анонс 20 Dec 2024). Сети: Ethereum mainnet (ERC20), возможно Base/Polygon — точные сети не публикуются явно, нужно проверить в UI dashboard. **Комиссия: ~5 %** (gas + processing).
- **AliPay**: officially supported (полезно если есть китайский account).
- **Crypto payment fee 5 %** — некоторые гайды называют это, но это на стороне эмитента (Coinbase Commerce / paywithmoon), не OR.
- **Посредники для РФ**:
  - **Oplatym.ru** — пополнение в рублях через СБП; 15–60 мин обработка
  - **ProxyAPI** ([proxyapi.ru/openrouter](https://proxyapi.ru/openrouter)) — все OR-модели с оплатой в рублях RU-картами через прокси-роутер (но это уже не OR напрямую)
  - **AITunnel** — proxy-сервис, своя BASE_URL, рубли

### 5.3 Min top-up & currency

- Currency: **USD only**.
- Min top-up: не публикуется явно ($5 наблюдаемо в практике).
- **Credits expire через 1 год** неиспользования.
- **Refunds**: возможны в пределах 24 часов от покупки; 5.5 % platform fee non-refundable; crypto-payments **never refundable**.

### 5.4 Verdict для fancai

- **Friendliness: HIGH** — единственный из «больших» провайдеров (vs OpenAI/Anthropic direct), который не блокирует РФ-аккаунты и поддерживает USDC.
- Текущий fancai-канал (предположительно USDC или foreign card) — **сохраняем**.
- Рисков escalation санкций **нет на сегодня**, но Anthropic/Google direct в обозримом будущем точно недоступны для РФ юр.лица — OR остаётся buffer.

---

## 6. SDK / API Ergonomics

### 6.1 OpenAI compatibility

- **Drop-in replacement**: BASE_URL `https://openrouter.ai/api/v1`, API key в `Authorization: Bearer`. Любой OpenAI SDK (Python `openai`, TypeScript `openai`, Go, Rust) работает без изменений в коде, кроме base_url.
- **Headers для атрибуции**: `HTTP-Referer`, `X-Title` (старое), `X-OpenRouter-Title`, `X-OpenRouter-Categories` — для попадания в analytics/leaderboards.

### 6.2 Native OpenRouter SDKs

- **Agent SDK** (анонс 24 Apr 2026): Python + TypeScript. `callModel` высокоуровневая функция: chat completion → multi-step agent с tool calls, stop conditions, cost tracking.
- **AI SDK provider** (`@openrouter/ai-sdk-provider`) — Vercel AI SDK совместимый.
- **CLI**: `create-agent-tui`, `create-headless-agent` (scaffolding tools, Apr 24).

### 6.3 Documentation & community

- Docs: [openrouter.ai/docs](https://openrouter.ai/docs) — полнота **высокая** (cookbooks, best-practices, migration guides per provider).
- **Discord** [discord.openrouter.ai](https://discord.openrouter.ai) — активное community, сотни тысяч developers.
- GitHub: [github.com/OpenRouterTeam](https://github.com/OpenRouterTeam) — open-source SDK adapters.
- Provider migration guides (Claude 4.6, например) — отдельные docs.

---

## 7. Vendor Lock-in / Risks

### 7.1 Уникальные фичи (того, что нельзя получить иначе)

- **Cross-provider model routing** с auto-fallback: если Anthropic down, GPT-5 принимает (и наоборот), без change в коде.
- **Auto Exacto**: smart provider selection по quality для tool-calling (–80–88 % errors).
- **Единый каталог 300+ моделей** + единый billing (vs одна оплата per provider).
- **OAuth/PKCE flow** для third-party apps — позволяет «sign in with OpenRouter» (полезно если fancai захочет дать пользователям использовать свои OR keys).
- **BYOK (Bring Your Own Key)** — можно использовать собственные Anthropic/Google ключи, OR платит только % markup. Дешевле для high volume + access к direct batch API через OR-обвязку.
- **Response Healing** (free, 18 Dec 2025): автоматическое исправление JSON syntax errors, –80 % defects на Gemini 2.0 Flash, –99.8 % на Qwen3 235B.

### 7.2 Migration cost

- **ON OpenRouter с текущего fancai**: ~0 (already running).
- **OFF OpenRouter** (на Google direct, например): низкий — `base_url` change + Google-specific SDK (genai), плюс надо переписать `_inline_defs()` workaround под direct API (там не нужен → даже проще).

### 7.3 Risks

1. **Markup может вырасти** (5.5 % → ?) — disclosed в TOS, но прецедентов повышения не было за последний год.
2. **Provider deprecation**: Google может убрать модель из public OR pool (например, если Vertex AI переходит на private partner network). Для fancai не критично — fallback на 2.5 Flash баседу.
3. **Outage routing layer**: SPOF на OR side. 14 Apr 2026 — 1ч даунтайм. За 6 мес: 3 incidents.
4. **Long-term viability**: Stripe (партнёр) и значительный traffic (Top-1 Kimi K2.6 = 1.58T tok/неделя) подтверждают финансовое здоровье. Funding details public — series-B ($X M, не подтверждено за этот research). Рисков shutdown в 1–2 года минимальные.
5. **Pricing trajectory**: в последние 6 мес — стабильно zero markup на токены. Снижения цен на Gemini 2.5 Flash Lite (–75 % vs 3.0 Flash) и Claude Haiku 4.5 — транслируются 1:1.

### 7.4 What we lose by staying on OR (vs Google Direct)

- ❌ **Batch API (–50 %)** — Gemini direct позволяет обработку 50 глав батчем за половину цены. На fancai это $0.125 → $0.0625 per book extraction. Big saving at scale.
- ❌ **Точный `thinking_budget`** в токенах для Gemini 3 — у direct можно тонко тюнить.
- ❌ **Native `response.parsed`** в genai SDK — у direct встроено в Pydantic.
- ❌ **Файл API объект** (Files endpoint) — у direct можно загрузить EPUB и переиспользовать file_id, у OR только inline через каждый запрос.
- ❌ **Live API / WebSocket** — у direct есть streaming audio/video.
- ⚠️ **Provider-side caching control**: implicit caching у direct работает с длиннее TTL.

### 7.5 What we gain by staying on OR (vs Direct)

- ✅ **Cross-provider fallback** — если Gemini down, переключаемся на Claude Sonnet 4.6 без code change.
- ✅ **Russia-friendly**: единственный legal/safe способ платить за Anthropic/Google models из РФ.
- ✅ **Единый каталог + billing**: не нужно отдельно вести 4 провайдерских аккаунта (Anthropic + Google + OpenAI + BFL).
- ✅ **Auto Exacto** (free quality boost для tool-calls).
- ✅ **Response Healing** (free –80 % JSON defects).
- ✅ **Compliance batteries** (SOC 2, ISO 27001, GDPR) — без аудита самим fancai.

---

## 8. Что нового за последние 3 месяца (Feb–Apr 2026)

| Дата        | Анонс                                                                                            | Релевантность для fancai                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 24 Apr 2026 | **Agent SDK + create-agent skills**                                                              | Polite, не нужно — у fancai свой Celery pipeline.                                                                                                |
| 22 Apr 2026 | **Workspaces** (separate envs, API keys, observability)                                          | ✅ Полезно — можно отделить prod fancai от dev/staging, отдельные spend caps.                                                                    |
| 15 Apr 2026 | **Video Generation API** (Veo 3.1, Seedance 2.0, etc)                                            | Off-roadmap fancai, но архитектурно интересно.                                                                                                   |
| 12 Mar 2026 | **Auto Exacto on by default** (для tool requests)                                                | ✅ Применяется автоматически если fancai будет использовать tools (сейчас pure response_format JSON, но extraction может выиграть от tool-mode). |
| 23 Feb 2026 | **February Release Spotlight** (benchmarks on model pages, free model router, cost transparency) | Информационное.                                                                                                                                  |
| 20 Feb 2026 | Outages report 17 & 19 Feb                                                                       | Note as risk.                                                                                                                                    |
| 18 Dec 2025 | **Response Healing** (–80 % JSON defects, free, auto)                                            | ✅ Уже работает для всех fancai requests.                                                                                                        |
| 9 Jan 2026  | **January Release Spotlight**                                                                    | Информационное.                                                                                                                                  |

### Roadmap (что декларировано)

- Дальнейшее расширение Workspaces (RBAC, audit log export).
- Расширение video models pool.
- Auto Exacto extension на non-tool requests (TBD).

---

## 9. Открытые вопросы

1. **Точная сетевая поддержка USDC для OR крипто-платежей** (только ERC20? + Base/Polygon?). Не публикуется на сайте — нужно проверить через UI checkout.
2. **TPM лимиты** для paid tier — публично не задокументированы; рекомендуется sample test через `GET /api/v1/key` после реальных нагрузок.
3. **BYOK fee %** — упоминается «percentage-based fee after free monthly threshold», но точная цифра в FAQ не приведена.
4. **SLA для Enterprise**: формальный uptime guarantee достижим только в custom contract — стоит запроса для оценки если fancai планирует большой scale.
5. **Cache write/read pricing для Gemini 3 Pro** — implicit cache работает, но storage cost = upstream Google ($4.50/M·hr); Gemini 3 Flash отдельных тарифов нет — возможно использует Flash baseline storage ($1/M·hr).

---

## Источники

1. [OpenRouter Models Catalog](https://openrouter.ai/models)
2. [OpenRouter Anthropic Models](https://openrouter.ai/anthropic) — confirmed Opus 4.7 ($5/$25), Sonnet 4.6 ($3/$15), Haiku 4.5 ($1/$5)
3. [OpenRouter Google Models](https://openrouter.ai/google) — confirmed Gemini 3.1 Pro/Flash Lite/Flash Image (Nano Banana 2)
4. [OpenRouter OpenAI Models](https://openrouter.ai/openai) — confirmed GPT-5.5/5.4/5/Mini/Nano + GPT-5.4 Image 2
5. [OpenRouter DeepSeek Models](https://openrouter.ai/deepseek) — V4 Pro/Flash launched 24 Apr 2026
6. [OpenRouter Image Models Collection](https://openrouter.ai/collections/image-models)
7. [OpenRouter LLM Rankings](https://openrouter.ai/rankings) — Top-10 models by weekly volume
8. [OpenRouter Pricing Page](https://openrouter.ai/pricing) — 5.5 % platform fee on credit purchases
9. [OpenRouter Prompt Caching Docs](https://openrouter.ai/docs/guides/best-practices/prompt-caching) — Anthropic/Gemini/OpenAI cache details
10. [OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) — effort + max_tokens + thinkingLevel
11. [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
12. [OpenRouter Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
13. [OpenRouter Auto Exacto](https://openrouter.ai/announcements/auto-exacto)
14. [OpenRouter Response Healing](https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent)
15. [OpenRouter Crypto Payments Announcement](https://openrouter.ai/announcements/crypto-payments-api)
16. [OpenRouter Status Page](https://status.openrouter.ai) — 99.88 % chat API uptime
17. [OpenRouter Trust Center](https://trust.openrouter.ai)
18. [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
19. [OpenRouter PDF Inputs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)
20. [OpenRouter Image Generation Docs](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
21. [OpenRouter FAQ](https://openrouter.ai/docs/faq)
22. [OpenRouter Announcements (all)](https://openrouter.ai/announcements/all)
23. [Workspaces Announcement (Apr 22 2026)](https://openrouter.ai/announcements) (всё на announcements page)
24. [Video Generation Announcement (Apr 15 2026)](https://openrouter.ai/announcements/video-generation)
25. [Anthropic Pricing (Direct)](https://www.anthropic.com/claude/opus) — $5/$25 confirmed
26. [Google AI Studio Pricing](https://ai.google.dev/pricing) — Gemini 3.1 Pro $2/$12, Flash Lite $0.25/$1.50
27. [Black Forest Labs Pricing](https://bfl.ai/pricing) — FLUX.2 Pro $0.07/MP confirmed
28. [FLUX.2 Klein 4B on OpenRouter](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
29. [Kimi K2.6 on OpenRouter](https://openrouter.ai/moonshotai/kimi-k2.6) — #1 model by traffic
30. [pydantic-ai Issue #3617: $defs/$ref bug](https://github.com/pydantic/pydantic-ai/issues/3617)
31. [big-AGI Issue #893: Gemini 3 thinking_level on OR](https://github.com/enricoros/big-agi/issues/893)
32. [vc.ru: OpenRouter из России (2026)](https://vc.ru/services/2728935-podklyuchenie-openrouter-instruktsiya-dlya-razrabotchikov-v-rossii)
33. [aitunnel.ru: OpenRouter без VPN](https://aitunnel.ru/providers/openrouter)
34. [costgoat.com: OpenRouter Pricing Calculator (Apr 2026)](https://costgoat.com/pricing/openrouter)
35. [costbench.com: OpenRouter Discounts 2026](https://costbench.com/software/llm-api-providers/openrouter/discounts/)

— Конец отчёта —
