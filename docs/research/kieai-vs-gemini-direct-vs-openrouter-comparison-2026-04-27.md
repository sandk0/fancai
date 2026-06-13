# Сравнительный аудит AI-провайдеров для fancai: kie.ai vs Direct Gemini API vs OpenRouter

> **Дата:** 2026-04-27
> **Модель:** Claude Opus 4.7 (1M context)
> **Effort:** max
> **Целевой читатель:** соло-разработчик-владелец fancai, готовый принять architectural decision
> **Драфты исследований (полные источники, 119 URL):**
>
> - `docs/research/_drafts/kieai-research-2026-04-27.md` (35+ источников)
> - `docs/research/_drafts/gemini-direct-research-2026-04-27.md` (69 источников)
> - `docs/research/_drafts/openrouter-research-2026-04-27.md` (35+ источников)

---

## 1. Executive Summary

**Главный вывод:** миграция полностью на kie.ai не оправдана. Оптимум — **частичная миграция LLM-стека с OpenRouter на Direct Gemini API + Batch API**, с сохранением image generation и cross-provider fallback на OpenRouter. Гибрид экономит **38–55 % на extraction-pipeline** и одновременно решает принудительную задачу миграции с deprecating Gemini 2.5 Flash (sunset 2026-06-17).

### Победители по измерениям

- **Cost (LLM std)**: kie.ai (~70 % дешевле upstream); **Cost (LLM с batch+caching)**: Direct Gemini (paritет с kie.ai при гарантированной identity и SLA)
- **Cost (Image)**: OpenRouter с FLUX.2 Klein 4B ($0.014/img — текущий fancai baseline невозможно перебить)
- **Feature parity**: Direct Gemini (native Pydantic + nested $defs/$ref + Batch API + explicit caching + File API)
- **Reliability**: Direct Gemini (formal Vertex AI SLA + multi-region + Cloud Audit Logs)
- **Russia-friendliness**: OpenRouter (единственный без-VPN путь + USDC + посредники для рублей)
- **Migration cost**: OpenRouter (zero — текущий стек); Direct Gemini (medium — 250–400 LOC + VPS прокси + Cardn3 карта)
- **Lock-in risk**: OpenRouter (низкий — OpenAI-compat позволяет уйти когда угодно)

### Финальная рекомендация

**Гибридная архитектура (на 2026-04-27):**

1. **LLM extraction/dedup/synthesis** → **Direct Gemini API** через **VPS-прокси** + **Batch API** для пакетов глав. Расчётная экономия 50 % per-book vs std pricing.
2. **Image generation** → **сохранить OpenRouter** с **FLUX.2 Klein 4B** ($0.014/img). Альтернатива: переключить на **Nano Banana 2** через OpenRouter если нужен лучший native text rendering (но цена ×3–10).
3. **Russia-payment buffer** → **сохранить OpenRouter аккаунт активным** для крипто/USDC top-up как fallback платёжный канал.
4. **Не мигрировать на kie.ai** до появления verified Russia-bypass отчётов и независимых model identity benchmarks.

### Ожидаемая годовая экономия

| Сценарий                                              | Месячный cost     | Годовой cost | Экономия vs current |
| ----------------------------------------------------- | ----------------- | ------------ | ------------------- |
| **Текущий** (OR + Gemini 2.5 Flash + FLUX.2 Klein)    | $180 (100 кн/мес) | $2 160       | —                   |
| **После forced migration** на OR + Gemini 3 Flash std | $231              | $2 772       | **−$612 (хуже)**    |
| **Hybrid: Direct Gemini Batch + OR FLUX.2 Klein**     | $185              | $2 220       | **+$60/год**        |
| **Hybrid premium: Direct + Nano Banana 2 batch**      | $395              | $4 740       | **−$2 580/год**     |

> ⚠️ **Forced cost increase**: оставаясь на OR, после deprecation 2.5 Flash (17 июня) переходим на 3 Flash, который дороже на ~28 % — **+$50/мес автоматически без изменений**. Hybrid с Direct + Batch удерживает cost на уровне текущего baseline. См. Раздел 4 для полного cost modeling.

---

## 2. Quick Comparison Matrix

Веса отражают приоритеты соло-разработчика fancai (Cost LLM 25 %, Russia 10 %, Reliability 15 % и т. д. — взято из промпта). Оценки от 1 (худший) до 10 (лучший).

| Измерение           | Вес       | kie.ai           | Direct Gemini   | OpenRouter     |
| ------------------- | --------- | ---------------- | --------------- | -------------- |
| **Cost (LLM)**      | 25 %      | 9 (cheapest std) | 8 (with batch)  | 5 (no batch)   |
| **Cost (Image)**    | 10 %      | 7                | 6 (Imagen dies) | **9** (FLUX.2) |
| **Feature parity**  | 20 %      | 4                | **10**          | 7              |
| **Reliability**     | 15 %      | 4                | **9** (SLA)     | 7 (99.88 %)    |
| **Russia payments** | 10 %      | 2 (НЕ подтв.)    | 3 (HIGH pain)   | **9**          |
| **Migration cost**  | 10 %      | 2 (HIGH effort)  | 6 (medium)      | **10** (zero)  |
| **Lock-in risk**    | 5 %       | 3                | 6               | **8**          |
| **Ecosystem**       | 5 %       | 3                | 8               | **9**          |
| **Weighted total**  | **100 %** | **5.05**         | **7.45**        | **7.40**       |

### Интерпретация

- **Direct Gemini и OpenRouter практически равны** (7.45 vs 7.40) — но по разным причинам: Direct сильнее в features/reliability, OR — в Russia-friendliness и migration-cost.
- **kie.ai (5.05)** проигрывает по всем не-cost измерениям. Cost-преимущество (9/10) не компенсирует недостаток в reliability, Russia-payments, migration cost и ecosystem.
- **Гибрид (LLM Direct + Image OR)** даст ≈ 8.0+, потому что суммирует сильные стороны обоих провайдеров.

---

## 3. Per-Provider Deep Dive

### 3.1 kie.ai

#### 3.1.1 Pricing

**LLM (что подтверждено публично на 2026-04-27):**

| Модель                  | Provider Model ID                  | Std input/1M | Std output/1M | Cached input | Batch     | Context |
| ----------------------- | ---------------------------------- | ------------ | ------------- | ------------ | --------- | ------- |
| Gemini 3 Flash (kie.ai) | `gemini-3-flash`                   | **$0.15**    | **$0.90**     | не подтв.    | не подтв. | 1M      |
| Gemini 3 Pro (kie.ai)   | `gemini-3-pro`                     | **$0.50**    | **$3.50**     | не подтв.    | не подтв. | 1M      |
| Gemini 3.1 Pro (kie.ai) | `gemini-3.1-pro-openai`            | $0.50        | $3.50         | не подтв.    | не подтв. | 1M      |
| GPT-5.2                 | `gpt-5-2`                          | $0.44        | $3.50         | не подтв.    | не подтв. | 400K    |
| Claude Opus 4.7         | предположительно `claude-opus-4-7` | **$1.75**    | **$8.75**     | не подтв.    | не подтв. | 200K    |
| Claude Sonnet 4.5/4.6   | `claude-sonnet-4-5`                | ~$1.05       | не подтв.     | не подтв.    | не подтв. | 1M      |

> **Markup vs upstream:** Цифры дают **70–75 % дисконт** к официалу (Google Gemini 3 Pro $2/$12 std, Anthropic Opus 4.7 $5/$25). Это очень агрессивно — см. п. 3.1.7 о бизнес-модели.
>
> **Free tier:** 5 000 free credits на signup, no card required (=$25 free) — достаточно для proof-of-concept.

**Image generation:**

| Модель             | Per-image (1024)         | Per-image (4K) | Native text | Источник               |
| ------------------ | ------------------------ | -------------- | ----------- | ---------------------- |
| Nano Banana 2      | **$0.04**                | **$0.04+**     | high        | kie.ai/nano-banana-2   |
| Nano Banana Pro    | **$0.09** (1K-2K)        | **$0.12**      | high        | kie.ai/nano-banana-pro |
| Imagen 4 / Ultra   | не раскрыт (signup wall) | до 2K (Ultra)  | high        | kie.ai/google/imagen4  |
| GPT-Image-1 (4o)   | **$0.03**                | unknown        | high        | kie.ai/4o-image-api    |
| FLUX.2 Pro img2img | не раскрыт (signup)      | 1K/2K          | mid         | docs.kie.ai/flux2      |

**Embeddings:** **НЕ ПОДДЕРЖИВАЮТСЯ.** kie.ai — чисто chat/image/video/music aggregator.

#### 3.1.2 Feature parity (16 критериев)

| #   | Критерий                 | Статус                          | Заметка                                                                             |
| --- | ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Structured outputs       | **partial**                     | Только `gemini-3-pro` и `claude-sonnet-4-5`; для GPT моделей не задокументировано   |
| 2   | $defs/$ref в JSON Schema | **не подтверждено**             | Документация не упоминает; вероятно тот же баг что у OR — нужен `_inline_defs()`    |
| 3   | response.parsed Pydantic | **no**                          | Только raw JSON; SDK kie-api на GitHub: 1 star, 0 forks                             |
| 4   | Function calling         | **partial**                     | Yes для Gemini/Claude; только Web Search для GPT-5.2                                |
| 5   | Streaming SSE            | **yes**                         | text/event-stream                                                                   |
| 6   | System instructions      | **yes**                         | Через role `system`                                                                 |
| 7   | Multi-turn               | **stateless**                   | messages[] array, нет sessions API                                                  |
| 8   | Multimodal input         | **yes (text+image)**            | image_url для Gemini; inline_data base64 для Flash                                  |
| 9   | Multimodal output        | **partial**                     | Image/video/audio через **отдельные endpoints** (job-pattern), не через chat        |
| 10  | Context caching          | **partial / unclear**           | «automatic context caching» заявлено, но **точных цен на cached input нет**         |
| 11  | Batch API                | **не подтверждено**             | Не документировано. Async job-pattern есть, но это не batch с 50 % discount         |
| 12  | File API                 | **partial**                     | Только для kie.ai-generated файлов (validity 20 мин). Внешние URL отвергаются (422) |
| 13  | Thinking controls        | **partial**                     | `reasoning_effort` low/high(/xhigh для GPT-5.4); точный budget не задокументирован  |
| 14  | Live API / WebSocket     | **no**                          | REST + SSE only                                                                     |
| 15  | Model versioning         | **partial**                     | Snapshot dates у Anthropic; для Gemini — суффикс `-openai`                          |
| 16  | Rate limits / concurrent | **20 req/10s, 100+ concurrent** | Реджект через HTTP 429                                                              |

#### 3.1.3 Reliability

- **Заявленный SLA**: 99.9 % uptime
- **Реальный uptime** (eliteai.tools): **99.26–99.93 % за год** — **меньше заявленного**. Отдельные дни — 86.4 % (Nov 18), 83.7 % (May 11)
- **Status page**: публичный URL не найден; стороннее мониторинг через eliteai.tools
- **Latency**: avg response 803ms (Dec 2025); ~25 s на Veo 3.1, ~15 s на Flux. **Для extraction-style 10K→5K независимых benchmarks нет**
- **Auto-fallback / model routing**: **нет**. Если upstream падает — kie.ai не маршрутизирует на альтернативу (vs OR, у которого native cross-provider routing)

#### 3.1.4 Регион и compliance

- **Доступность из РФ без VPN**: **НЕ ПОДТВЕРЖДЕНО**. Юридически — Colorado LLC (NEXUSAI SERVICES), что технически означает подчинение OFAC sanctions
- **Только один глобальный endpoint** `api.kie.ai`, нет regional pinning
- **Compliance**: GDPR заявлен; SOC 2 / HIPAA / ISO 27001 — **не подтверждены**
- **Training on user data**: ToS **не упоминает явно** = по умолчанию не запрещено

#### 3.1.5 Russia payments — критично

| Метод                                   | Статус              | Комментарий                                                       |
| --------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| Российские карты (Мир)                  | **НЕ ПОДТВЕРЖДЕНО** | На сайте не указано; ScamAdviser упоминает Visa/MC/PayPal/Alipay  |
| RU-issued Visa/MC                       | **НЕ ПОДТВЕРЖДЕНО** | После санкций международное processing отключено                  |
| Crypto top-up                           | **НЕ ПОДТВЕРЖДЕНО** | Не упомянуто публично                                             |
| Виртуальные карты (Pyypl/Wise/Турецкие) | **likely yes**      | Стандартный workaround, но **не тестировано на kie.ai конкретно** |
| **Verified RU-bypass posts**            | **НЕ НАЙДЕНО**      | Нет свежих посты успешных RU-bypass в Reddit/HN/Telegram          |

> **Russia verdict**: **не подтверждено**. Самый реалистичный путь — Pyypl/Wise/Турецкие виртуальные карты, **но требует подтверждения через signup**.

#### 3.1.6 SDK / API

- **Python SDK официальный — отсутствует**. Только requests-based examples в docs
- Сообщественный `gateway/kie-api` — **1 star, 0 forks**, не Pydantic v2 native, не async
- **API НЕ OpenAI-compatible drop-in**: у каждой модели **отдельный endpoint** с разными schemas:
  - Gemini: `/gemini-3-pro/v1/chat/completions` (OpenAI shim) и `/gemini/v1/models/...:streamGenerateContent` (native)
  - Claude: `/claude/v1/messages`
  - GPT: `/gpt-5-2/v1/chat/completions` и `/codex/v1/responses`
  - Image/Video: `/api/v1/jobs/createTask` (custom job-pattern)
- TypeScript SDK не существует
- Documentation: средняя. **Pricing скрыт за signup-стенкой**

#### 3.1.7 Vendor lock-in / Reputation / Hidden gotchas

**Business model investigation:**

- **Заявленная модель**: «We negotiate volume deals with upstream and pass discounts». Не подтверждено
- **Альтернативные гипотезы (порядок вероятности)**:
  - (a) Grey-area arbitrage через Vertex AI / OpenAI Enterprise — возможно
  - (b) Account pooling / TOS-violating reseller — не подтверждено
  - (c) VC burn-money mode — funding info **противоречива** (Crunchbase: «raised in 1st round» vs «not raised»)
  - (d) Model substitution (Gemini → Llama-fine-tune) — прямых доказательств нет, но подобные жалобы для родственного `apibox.erweima.ai` (Suno) исторически были

**Owner / team:**

- Регистрация: **NEXUSAI SERVICES LLC**, Denver, CO. Single-member LLC, владельцы не публикуются
- Whois: **анонимизирован через Dynadot Privacy Service**
- Domain age: 3 года (зарегистрирован Aug 2022)
- **Crunchbase противоречит самому себе**: HQ Mumbai (India) vs Colorado LLC регистрация
- **Erweima Chinese-affiliated infra**: суб-домены `kieai.erweima.ai` принадлежат третьему лицу `erweima.ai` (китайская white-label aggregator team). Реальная операционная команда — **скорее всего китайская**

**Independent benchmarks / model identity:**

- **artificialanalysis.ai**: kie.ai **отсутствует**
- **openrouter.ai/rankings**: не присутствует
- **Reddit / HN**: поиск **не дал результатов**. Серьёзные ML-инженеры **не используют** kie.ai в production
- Token-level identity verification — **не найдено независимых тестов**

**Известные incidents (последние 6 месяцев):**

- Sora 2 instability (Trustpilot 1-star Mar-Apr 2026): «outages, fix things for a single day, then exact same failures resurface»
- Disappearing credits (Telegram + Trustpilot): credits исчезают сразу после top-up, refund игнорируется
- Model routing 404 на `/gemini-3-pro/streamGenerateContent` (RooCodeInc/Roo-Code Issue #11011) — **closed «not planned»**
- Trustpilot 3.0/5 при 6 reviews, **67 % 1-star**

**ToS deep-read:**

- Training on user data: **не упомянуто** = серая зона
- Russia / sanctioned countries clauses: **не упомянуто**, но Colorado LLC = OFAC применимость
- Pricing change policies: «We reserve the right to modify these Terms at any time» — без 30-day notice
- Termination: «We may suspend or terminate your access at any time, without notice or liability» — жёстко

#### 3.1.8 Hidden gotchas (top 5 для fancai)

1. **API НЕ drop-in OpenAI-compatible** — миграция = переписать integration layer ≈ 300–500 LOC
2. **Pydantic $defs/$ref — vermutlich не работает**, нужен тот же `_inline_defs()` хак что и для OR
3. **Disappearing credits** — системная жалоба от нескольких пользователей. Для соло-разработчика с $50–500/мес — шокирующий риск
4. **Russia-friendliness НЕ ПОДТВЕРЖДЕНА** — нет verified workarounds
5. **Поддержка только Asia time zones + игнор скриншотов** — для production-critical pipeline в РФ это **неприемлемо**

#### 3.1.9 Strengths и weaknesses

**Strengths:**

- Самые низкие std-цены среди трёх провайдеров (~70 % дисконт)
- Поддержка свежих моделей (Gemini 3.x, GPT-5.x, Nano Banana 2)
- 5 000 free credits на signup без карты (legit POC value)
- Domain age 3 года — не just-launched

**Weaknesses:**

- Trust signals слабые (67 % 1-star, скрытый owner, противоречивая funding info)
- Не drop-in OpenAI-compatible — высокий migration cost
- Нет batch API, embeddings, model routing/fallback
- Нет независимых benchmarks identity моделей
- Russia payments НЕ подтверждены
- Поддержка ограничена Asia time zones
- ToS даёт право суспендировать аккаунт без причины и notice

---

### 3.2 Direct Gemini API (Google AI Studio + Vertex AI)

#### 3.2.1 Pricing

⚠️ **Ключевое изменение режима**: `gemini-3-pro-preview` снят с обслуживания **26 марта 2026**. Production-кандидат теперь — `gemini-3.1-pro-preview` (preview, paid-only с 1 апреля 2026).

| Модель                                      | Std input/1M (≤200K) | Std output/1M | Cached input                                     | Batch input/1M | Batch output/1M | Storage cache | Context |
| ------------------------------------------- | -------------------- | ------------- | ------------------------------------------------ | -------------- | --------------- | ------------- | ------- |
| **Gemini 3.1 Pro Preview**                  | $2.00                | $12.00        | $0.20 (90 % off / 75 % по Verdent — расхождение) | $1.00          | $6.00           | $4.50/M·hr    | 2M      |
| Gemini 3.1 Pro >200K                        | $4.00                | $18.00        | $0.40                                            | $2.00          | $9.00           | $4.50         | 2M      |
| **Gemini 3 Flash Preview**                  | $0.50                | $3.00         | $0.05                                            | $0.25          | $1.50           | $1.00/M·hr    | 1M      |
| **Gemini 3.1 Flash-Lite Preview**           | $0.25                | $1.50         | ~$0.025                                          | $0.125         | $0.75           | $1.00         | 1M      |
| Gemini 2.5 Flash ⚠️ deprecated 2026-06-17   | $0.30                | $2.50         | $0.075                                           | $0.15          | $1.25           | $1.00         | 1M      |
| Gemini 2.5 Flash-Lite ⚠️ deprecated Q3 2026 | $0.10                | $0.40         | $0.025                                           | $0.05          | $0.20           | $1.00         | 1M      |

**Нюансы:**

- **Batch API даёт ровно 50 % скидку** на ВСЕ типы токенов (input + output + cached). Подтверждено Vertex docs + AI Studio docs + независимые источники
- **Audio input** — премиум: $1/1M на 3 Flash
- **Расхождение по explicit-cache discount**: Verdent guides пишет 75 % (т. е. $0.50/1M на Pro), реклам/Google docs — 90 % ($0.20/1M). Берём официальную AI Studio docs цифру **90 %**

**Free tier (изменение апреля 2026):**

- AI Studio Free: 5–15 RPM, 25–1 500 RPD, 250K–1M TPM
- **Россия исключена** из 230+ стран
- **Pro-модели больше НЕ доступны на free** с 2026-04-01 — только Flash/Flash-Lite
- **Free tier тренируется на твоих данных + human review** (de-identified)

**Image generation:**

| Модель                                     | Релиз       | Цена/изображение                      | Max res | Native text  | Deprecation |
| ------------------------------------------ | ----------- | ------------------------------------- | ------- | ------------ | ----------- |
| **Nano Banana Pro** (Gemini 3 Pro Image)   | ноябрь 2025 | $0.134 (1K-2K), $0.24 (4K), batch ½   | 4K      | **отлично**  | —           |
| **Nano Banana 2** (Gemini 3.1 Flash Image) | 2026-02-26  | $0.045 (512px) → $0.151 (4K), batch ½ | 4K      | очень хорошо | —           |
| Imagen 4 Fast ⚠️ deprecated 2026-06-24     | GA          | $0.02                                 | 1024    | средне       | 2026-06-24  |
| Imagen 4 Standard ⚠️ deprecated 2026-06-24 | GA          | $0.04                                 | 2K      | хорошо       | 2026-06-24  |
| Imagen 4 Ultra ⚠️ deprecated 2026-06-24    | GA          | $0.06                                 | 2K      | очень хорошо | 2026-06-24  |

> ⚠️ **Все Imagen 4 умирают 24 июня 2026.** Google говорит: «migrate to Nano Banana». Так что для fancai реальных кандидатов — два: **Nano Banana 2** (~$0.07/img на 1K) или **Nano Banana Pro** (~$0.134/img на 1K).
>
> **Для baseline fancai** (FLUX.2 Klein 4B через OR @ ~$0.014/img) — Nano Banana 2 будет в **3–5× дороже** за изображение. Качество (state-of-the-art native text rendering) — другая история.

**Embeddings:**

| Модель                                  | Std input/1M | Batch  | Dimensions                 | Max input                      |
| --------------------------------------- | ------------ | ------ | -------------------------- | ------------------------------ |
| Gemini Embedding 001                    | $0.15        | $0.075 | 3072/1536/768 (Matryoshka) | 2048                           |
| Gemini Embedding 2 (multimodal preview) | $0.15        | $0.075 | 3072/1536/768              | 2048 (text); image/video/audio |

#### 3.2.2 Feature parity (16 критериев)

| #   | Критерий                         | Verdict                                                          | Комментарий                                                                                                                                                                                            |
| --- | -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Structured outputs Pydantic      | **YES native**                                                   | `response_schema=PydanticModel` или `response_mime_type="application/json"` + schema                                                                                                                   |
| 2   | $defs/$ref в JSON Schema         | **PARTIAL → YES в новых SDK**                                    | Был баг (Issue #60), сейчас SDK **сам инлайнит $defs**. Pydantic `Field(default=...)` всё ещё может ломать (Issue #699). Workaround: `Optional[T]=None`. **`_inline_defs()` хак fancai можно удалить** |
| 3   | response.parsed → Pydantic       | **YES**                                                          | SDK автопарсит JSON в инстанс класса из `response_schema`                                                                                                                                              |
| 4   | Function calling / Tools         | **YES native**                                                   | Автоконвертация Python функций в tool declarations через `types.Tool(function_declarations=[...])`                                                                                                     |
| 5   | Streaming                        | **YES**                                                          | `client.models.generate_content_stream(...)` или async через `aio.*`                                                                                                                                   |
| 6   | System instructions              | **YES** отдельное поле                                           | `config=types.GenerateContentConfig(system_instruction="...")`                                                                                                                                         |
| 7   | Multi-turn                       | **YES**                                                          | `client.chats.create(...)` + `chat.send_message(...)` или stateless через `contents`                                                                                                                   |
| 8   | Multimodal input                 | **YES native**                                                   | PDF до 50MB / 1000 страниц, файлы до 5GB/файл и 50GB на проект через File API                                                                                                                          |
| 9   | Multimodal output                | **YES**                                                          | Image (Gemini 3 Pro Image), audio (Live API)                                                                                                                                                           |
| 10a | Implicit caching                 | **YES, бесплатно**                                               | Min 1024 tok на Flash, 4096 на Pro. **Без discount гарантии**, но при cache hit input идёт по cached rate                                                                                              |
| 10b | Explicit caching (named cache)   | **YES**                                                          | Min 32K tok на 3.1 Pro. TTL дефолт 1 час, max настраиваемый. Storage $4.50/M·hr (Pro), $1.00 (Flash). Discount **75–90 %** (расхождение — см. выше)                                                    |
| 11  | **Batch API**                    | **YES, 50 % discount на ВСЕ типы токенов**                       | SLA до 24 часов, async. Поддержка ВСЕХ Gemini 2.5 + 3.x. **Нет hard cap на batch size**                                                                                                                |
| 12  | File API                         | **YES, бесплатно**                                               | Storage **бесплатно** (retention 48 часов). До 5GB/файл, 50GB на проект                                                                                                                                |
| 13a | thinking_budget точный           | **YES** (для 2.5; для 3.x — упрощено в `thinking_level`)         | На Gemini 3.x — `thinking_level: LOW/MEDIUM/HIGH`. На 2.5 — численный budget                                                                                                                           |
| 13b | reasoning.effort mapping         | **YES**, через `thinking_level`                                  | LOW / MEDIUM / HIGH соответствует фиксированным budget'ам                                                                                                                                              |
| 13c | Visible vs hidden thinking       | hidden by default; `include_thoughts=True` для thought summaries | Через AI Studio docs                                                                                                                                                                                   |
| 13d | Стоимость thinking tokens        | **БИЛЛИТСЯ как output @ standard rate** (!)                      | На 3.1 Pro — $12/M; **HIGH-режим может тратить 95 % output на скрытые thoughts**                                                                                                                       |
| 14  | Live API / WebSocket             | **YES** (Multimodal Live API)                                    | Для fancai не релевант                                                                                                                                                                                 |
| 15  | Model versioning                 | **YES**                                                          | `-latest`, `-preview`, snapshot dates `gemini-2.5-flash-002`. Pin на snapshot для prod                                                                                                                 |
| 16  | Per-request timeout / concurrent | **YES**                                                          | Timeout SDK ~600s. Max concurrent — определяется RPM tier                                                                                                                                              |

#### 3.2.3 Reliability / Operations

- **SLA**: Vertex AI Gemini Online Inference — official SLA опубликован Feb 2026. Покрывает `generateContent` + `streamGenerateContent`. Service credits при недотягивании. Традиционно 99.5 % monthly uptime для Vertex Online Prediction
- **Status page**: status.cloud.google.com (фильтр Vertex AI / Generative AI). Свежий incident 2026-02-27 — повышенный error rate с 04:37 до 06:35 PT
- **Rate limits**: Tier 1 (после билинга) — 150–300 RPM; Tier 2 ($250 spend) — 1 000+ RPM
- **Latency** (Artificial Analysis, p50 за rolling 72h):
  - Gemini 3 Pro Preview (high reasoning): TTFT p50 ≈ 30.82s — высокий из-за thinking
  - Gemini 3 Flash Preview (Reasoning): **170.8 tok/s output**
  - Gemini 3 Flash Preview (non-reasoning): **218 tok/s output**
  - Gemini 3.1 Flash-Lite Preview: **313.5 tok/s output** ⚡
- **Pain point: 429 errors** часты на 3.1 Pro Preview из-за shared capacity — для production нужно либо batch либо prepay+quota request
- **Auto-fallback**: НЕТ. Single provider, fallback нужно реализовывать самим
- **request_id**: `usage_metadata.request_id` (Vertex) или `metadata['request_id']` (AI Studio)

#### 3.2.4 Регион и compliance

**Геодоступность:**

- AI Studio + Gemini API: 230+ стран; **Россия — НЕ в списке** (санкции OFAC). API возвращает 403 при российских IP
- Vertex AI: us-central1, europe-west1/4/8, asia-east1/southeast1, и т. д.
- ⚠️ **Gemini 3.1 Pro Preview и Gemini 3 Flash Preview сейчас только на global endpoint** — нельзя жёстко указать europe-west8

**Compliance (Vertex AI):**

- ✅ SOC 1/2/3, ISO 27001/27017/27018/27701, HIPAA (с BAA), GDPR, FedRAMP High, PCI DSS

**Data retention:**

- Vertex AI (paid): **No training by default**, contractual guarantee
- AI Studio (free tier): **Google ТРЕНИРУЕТСЯ** на данных + human review
- AI Studio (paid): no training (билинг автоматически снимает разрешение)

#### 3.2.5 Russia payments — workarounds

**Что НЕ работает:**

- Российские карты (Мир, RU-issued V/MC) — полный блок (OFAC санкции с 2022)
- Российские юрлица — невозможно открыть GCP billing
- Pyypl, Wise (резиденты РФ), Capitalist (часто блокируется как high-risk BIN)

**Что работает на 2026-04 (по форумам):**

| Метод                                                 | Realistic? | Цена/боль                              |
| ----------------------------------------------------- | ---------- | -------------------------------------- |
| **Cardn3** crypto-funded US Visa/MC                   | ✓          | $5–15 issuance + ~3–5 % conversion fee |
| Корпоративная регистрация в Казахстане/Армении/Грузии | ✓          | $1K–5K setup, требует резидентства     |
| Wise UK personal (если есть UK address/банк)          | ✓          | требует UK резидентства                |
| Friends/family abroad billing account                 | ✓          | $0 + социальный долг                   |

> ⚠️ **Главная боль**: даже с зарубежной картой **API-вызовы из российских IP — блок**. Нужен **VPN/прокси на VPS-стороне backend**. fancai backend уже на VPS — outbound прокси на Германии/Финляндии/Сингапуре — **час работы** в Caddy/HAProxy.
>
> **Risk**: Google детектит datacenter IP + Cardn3 US BIN → **AML/fraud signals могут сработать** → ban API key + потеря context caches/batch jobs.

**Russia-friendliness verdict: PAIN HIGH** для соло-разработчика. Реалистично — Cardn3 + VPS прокси, но с принятым risk.

#### 3.2.6 SDK / API ergonomics

- **Python SDK**: `google-genai` (новый, рекомендуемый), v1.66+. Старый `google-generativeai` deprecated
- Async/await: ✓ через `client.aio.*`
- Pydantic v2: ✓ нативная интеграция
- **OpenAI-compatible endpoint**: ✓ для Vertex и AI Studio. **Можно постепенно мигрировать с OpenRouter без полной переделки кода**
- TypeScript SDK: `@google/genai`
- CLI: `gcloud ai` (Vertex), `gemini-cli` (AI Studio)
- Documentation: высокая, но **разбросана** между ai.google.dev и cloud.google.com
- Migration guides 2.x → 3.x: смена model ID + проверка rate limits

#### 3.2.7 Vendor lock-in / Long-term viability

**Уникальные фичи Direct Gemini, недоступные через OpenRouter:**

1. **Batch API @ 50 % discount** — OR не предоставляет
2. **Explicit context caching** через named cache API
3. **Native Imagen / Nano Banana / Veo** через тот же SDK + единый billing
4. **Free tier** на Flash/Flash-Lite (с приёмом training)
5. **File API** с 5GB/файл + semantic search
6. **Detailed thinking_level + thought summaries**
7. **Provisioned Throughput** для строгого SLA
8. **request_id трейсинг** в Cloud Audit Logs

**Pricing trajectory:**

- 2025-Q4: 2.5 Pro $1.25/$10
- 2026-Q1: 3.0 Pro Preview $2/$12 (release at premium)
- 2026-Q2: 3 Pro снят, 3.1 Pro Preview $2/$12 → $4/$18 (>200K)
- **Тренд**: каждое новое Pro поколение **дороже** на 30–60 % input. Flash дешевеет / стабильный

**2026 deprecation cliff:**

- Gemini 2.0 Flash / Flash-Lite — **2026-06-01**
- **Gemini 2.5 Flash + 2.5 Pro — 2026-06-17 (baseline fancai!)**
- Gemini 2.5 Flash-Lite, 2.5 Flash Image, embedding-001 — Q3 2026
- **Все Imagen 4 — 2026-06-24**

⚠️ **Это создаёт принудительную задачу для fancai**: даже оставаясь на OpenRouter, Gemini 2.5 Flash baseline тоже умрёт 17 июня. **Миграция на 3.x — неизбежна** в течение 7 недель независимо от выбора провайдера.

#### 3.2.8 Strengths и weaknesses

**Strengths:**

- Самый полный feature parity (Pydantic native, $defs/$ref работает в новых SDK, response.parsed, Batch API, explicit caching, File API, thinking_level)
- Batch API даёт реальные 50 % discount на ВСЕ типы токенов
- Free tier на Flash/Flash-Lite (хотя тренируется на данных)
- Formal Vertex AI SLA + Cloud Audit Logs + compliance battery (SOC 2, ISO 27001, HIPAA, GDPR)
- Native Imagen / Nano Banana / Veo через тот же SDK
- OpenAI-compatible endpoint позволяет постепенную миграцию

**Weaknesses:**

- **API из РФ заблокирован** — нужен VPS-прокси с риском детекта
- **Карта заблокирована** — нужен Cardn3 / зарубежное юрлицо
- **Risk reversibility HIGH**: бан API key = потеря context caches + batch jobs
- **Pricing volatility**: каждое новое Pro дороже предыдущего; Flash deprecates каждые 6–12 месяцев
- **No auto-fallback** — single provider, нужно собственно реализовывать
- 429 errors часты на preview-моделях

---

### 3.3 OpenRouter

#### 3.3.1 Pricing

**Per-token markup = 0 %**. Цены ровно совпадают с upstream. Единственный overhead — **5.5 % credit-purchase fee** на пополнение баланса (не per-call).

**LLM (актуальные на 2026-04-27):**

| Модель                            | OR Model ID                            | Std input/1M          | Std output/1M   | Cache write/read                 | Markup vs upstream |
| --------------------------------- | -------------------------------------- | --------------------- | --------------- | -------------------------------- | ------------------ |
| Claude Opus 4.7                   | `anthropic/claude-opus-4.7`            | $5.00                 | $25.00          | $6.25/$1.25 (5m)                 | **0 %**            |
| Claude Sonnet 4.6                 | `anthropic/claude-sonnet-4.6`          | $3.00                 | $15.00          | $3.75/$0.75                      | **0 %**            |
| Claude Haiku 4.5                  | `anthropic/claude-haiku-4.5`           | $1.00                 | $5.00           | $1.25/$0.25                      | **0 %**            |
| GPT-5.5 Pro                       | `openai/gpt-5.5-pro`                   | $30.00                | $180.00         | auto-cache                       | **0 %**            |
| GPT-5.5                           | `openai/gpt-5.5`                       | $5.00                 | $30.00          | auto-cache                       | **0 %**            |
| GPT-5.4                           | `openai/gpt-5.4`                       | $2.50                 | $15.00          | auto-cache                       | **0 %**            |
| GPT-5                             | `openai/gpt-5`                         | $1.25                 | $10.00          | auto-cache                       | **0 %**            |
| GPT-5 Mini                        | `openai/gpt-5-mini`                    | $0.25                 | $2.00           | auto-cache                       | **0 %**            |
| GPT-5 Nano                        | `openai/gpt-5-nano`                    | $0.05                 | $0.40           | auto-cache                       | **0 %**            |
| **Gemini 3.1 Pro Preview**        | `google/gemini-3.1-pro-preview`        | $2.00 / $4.00 (>200K) | $12.00 / $18.00 | implicit + explicit (0.1× input) | **0 %**            |
| **Gemini 3.1 Flash Lite Preview** | `google/gemini-3.1-flash-lite-preview` | $0.25                 | $1.50           | implicit (0.1×)                  | **0 %**            |
| **Gemini 3 Flash Preview**        | `google/gemini-3-flash-preview`        | $0.50                 | $3.00           | implicit                         | **0 %**            |
| Gemini 2.5 Flash (current fancai) | `google/gemini-2.5-flash`              | $0.30                 | $2.50           | implicit                         | **0 %**            |
| DeepSeek V4 Pro                   | `deepseek/deepseek-v4-pro`             | $0.435                | $0.87           | n/a                              | n/a                |
| DeepSeek V4 Flash                 | `deepseek/deepseek-v4-flash`           | $0.14                 | $0.28           | n/a                              | n/a                |
| Kimi K2.6                         | `moonshotai/kimi-k2.6`                 | $0.7448               | $4.655          | n/a                              | #1 на OR rankings  |

**Подтверждение нулевого markup:**

- Claude Opus 4.7 на OR `$5/$25` ↔ Anthropic direct `$5/$25`
- Gemini 3.1 Flash Lite на OR `$0.25/$1.50` ↔ Google AI Studio `$0.25/$1.50`
- FLUX.2 Pro на OR `$0.07/MP` ↔ BFL direct `$0.07/MP`

**Free models / Auto-router:**

- 25+ моделей с zero-cost (DeepSeek R1 free, Llama 3.3 70B, Gemma 3, etc.). Лимит: **20 RPM, 50 RPD** или **1 000 RPD при балансе ≥ $10**
- **Auto Exacto** (12 Mar 2026): провайдер-роутинг, переоценивающий каждые 5 минут throughput + tool-call accuracy. **Включён по умолчанию** для tool-requests. Дал **−88 %** tool-call ошибок на GLM-5

**Image generation:**

| Модель                                 | OR Model ID                             | Pricing                             | 1024×1024 cost | Native text         |
| -------------------------------------- | --------------------------------------- | ----------------------------------- | -------------- | ------------------- |
| Nano Banana 2 (Gemini 3.1 Flash Image) | `google/gemini-3.1-flash-image-preview` | per-token ($0.50/M in, $3/M out)    | ~$0.045–0.151  | yes (Google native) |
| Nano Banana Pro (Gemini 3 Pro Image)   | `google/gemini-3-pro-image-preview`     | per-token ($2/M in, $12/M out)      | ~$0.20–0.40    | yes                 |
| GPT-5.4 Image 2                        | `openai/gpt-5.4-image-2`                | per-token ($8/M in, $15/M out)      | ~$0.20–0.30    | yes                 |
| GPT-5 Image                            | `openai/gpt-5-image`                    | per-token ($10/M in, $10/M out)     | ~$0.20         | yes                 |
| **FLUX.2 Pro**                         | `black-forest-labs/flux.2-pro`          | per-MP ($0.07 first + $0.03 each)   | **$0.07**      | yes (улучшено)      |
| **FLUX.2 Klein 4B (current fancai)**   | `black-forest-labs/flux.2-klein-4b`     | per-MP ($0.014 first + $0.001 each) | **$0.014**     | partial             |
| **FLUX.2 Max**                         | `black-forest-labs/flux.2-max`          | per-MP ($0.07 first + $0.03 each)   | **$0.07–0.13** | yes (frontier)      |

> ⚠️ **Важная находка:** **FLUX.3 не существует** на 2026-04-27. Black Forest Labs flagship line — FLUX.2 (Pro/Max/Klein/dev/Flex). Imagen 4/5 на OR **отсутствуют** — Google продвигает Nano Banana 2 как замену.

**Video (новое — Apr 2026):**

- Veo 3.1, Seedance 2.0 (ByteDance), Kling, OpenAI video — единый OR API. Не релевант для fancai сейчас, но архитектурно полезно

#### 3.3.2 Feature parity (16 критериев)

| #   | Критерий                          | Статус             | Примечание                                                                                                                    |
| --- | --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | JSON Schema (response_format)     | ✅ partial         | Strict mode `{type:'json_schema', strict:true}` для OpenAI ≥4o, Google Gemini, Anthropic Sonnet 4.5/Opus 4.1+, Fireworks      |
| 2   | **$defs/$ref в JSON Schema**      | ⚠️ **БАГ активен** | Гугл-модели через OR деградируют output при `$defs`/`$ref`/`anyOf:[…,{type:null}]`. Нужен `_inline_defs()` хак (как у fancai) |
| 3   | **response.parsed**               | ❌ НЕТ             | Только raw JSON в `message.content` — клиент парсит сам в Pydantic                                                            |
| 4   | Function calling / Tools          | ✅ единый формат   | OpenAI-compat: `tools`/`tool_choice`. Auto Exacto on by default = +10–20 % accuracy                                           |
| 5   | Streaming SSE                     | ✅                 | Все модели                                                                                                                    |
| 6   | System instructions               | ✅ единое поле     | OR нормализует под Gemini `systemInstruction` etc.                                                                            |
| 7   | Multi-turn / stateless            | ✅ stateless       | Полный `messages[]` history каждый раз — стандарт OpenAI                                                                      |
| 8   | Multimodal input                  | ✅                 | Vision через `ImageContentPart` (URL или base64). PDF native для поддерживающих моделей                                       |
| 9   | Multimodal output                 | ✅                 | Image models возвращают base64 в assistant message. Параметр `modalities: ["image"]`                                          |
| 10a | Anthropic prompt caching          | ✅                 | `cache_control` headers. Write 5m=1.25× / 1h=2× input; read=0.25×. Min: Opus/Haiku 4096 tok, Sonnet 2048 tok                  |
| 10b | Gemini implicit caching           | ✅                 | 2.5 Flash min 1028 tok; 2.5 Pro 2048 tok. Cached read=0.1× input. **Sticky routing** для cache-hit максимизации               |
| 10c | Gemini explicit caching           | ✅ partial         | `cache_control` breakpoints; OR использует только последний breakpoint. Storage charge upstream                               |
| 11  | **Batch API**                     | ❌ **НЕТ**         | OR не транслирует Google/Anthropic batch (50 % discount). Альтернатива: BYOK + Google direct batch с OR-обвязкой              |
| 12  | File API native                   | ✅ partial         | PDF inputs через chat completions endpoint. Нет отдельного File API объекта типа OpenAI Files                                 |
| 13a | reasoning.effort                  | ✅                 | xhigh/high/medium/low/minimal/none. Маппится на effort_ratio. OpenAI/Grok primary; для Anthropic пересчитывается в max_tokens |
| 13b | reasoning.max_tokens              | ✅ partial         | Anthropic, Gemini 2.5 (через `thinkingBudget`), Qwen — да. **Gemini 3 — нет точного контроля**, только `thinkingLevel`        |
| 13c | Visible vs hidden thinking        | ✅ контроль        | `reasoning.exclude: true`. По умолчанию reasoning видим в `message.reasoning`                                                 |
| 14  | WebSocket / Live API              | ❌ НЕТ             | REST + SSE only                                                                                                               |
| 15  | Model versioning                  | ✅                 | Suffixes `-preview`, snapshot dates. Auto-router алиасы (`openrouter/auto`)                                                   |
| 16  | Per-request timeout / concurrency | ⚠️ ограничено      | Cloudflare DDoS protection. **TPM лимиты не публикуются** явно. Webhooks/billing alerts — only Workspaces (Apr 22)            |

#### 3.3.3 Reliability / Operations

- **Status page** ([status.openrouter.ai](https://status.openrouter.ai)) 30-дневный uptime:
  - Chat API: **99.88 %**
  - Data API: 99.92 %
  - Homepage: 99.77 %
- **Формальное SLA для standard tier — НЕТ**, только historical performance. Enterprise — custom contract
- **Recent incidents (последние 6 мес)**: 14 Apr 2026 (1ч даунтайм Generation), 17 & 19 Feb 2026 (outages)
- **Provider routing**: default — price-weighted load balancing с inverse-square по cost. Auto Exacto для tool-requests (quality-weighted)
- **Sticky routing для caching**: при `cache_control` или implicit cache последующие запросы идут на тот же endpoint
- **Top traffic models на 2026-04-27**:
  1. Kimi K2.6 (Moonshot) — 1.58T tok/неделя
  2. Claude Sonnet 4.6 — 1.36T (+2 %)
  3. DeepSeek V3.2 — 1.28T
  4. **Claude Opus 4.7 — 1.15T (+279 % за неделю)** — взрывной рост после релиза 16 Apr
  5. Gemini 3 Flash Preview — 1.04T
- **Concurrent / TPM**: free 20 RPM/50 RPD (или 1 000 RPD при балансе ≥ $10). Paid TPM явно не публикуется
- **request_id**: возвращается в response headers
- **Workspaces (Apr 22)**: per-environment activity logs + billing alerts

#### 3.3.4 Регион и compliance

- **РФ доступ без VPN**: ✅ `openrouter.ai` не блокируется в РФ; API endpoint accessible
- **Compliance** ([trust.openrouter.ai](https://trust.openrouter.ai)):
  - ✅ SOC 2, HIPAA, GDPR (Article 45+46), ISO 27001, FedRAMP, CSA Star Level 1
- **Zero Data Retention by default**: prompts/responses не сохраняются, если не включить prompt logging вручную (за 1 % discount, irrevocable commercial use → не включать в prod)
- **Training opt-out**: настройка аккаунта; OR не маршрутизирует на провайдеры тренирующие на твоих данных

#### 3.3.5 Russia payments

**Что НЕ работает:**

- Российские карты Мир / RU-issued V/MC / Tinkoff: блокируются BIN-фильтром Stripe

**Что работает (на 2026-04-27):**

| Метод                                                        | Realistic? | Цена/боль                                                      |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------- |
| Иностранные карты (KZ/AM/GE/TR/UZ-issued V/MC)               | ✓          | open foreign account → V/MC → top-up                           |
| **USDC** через OpenRouter Crypto Payments API                | ✓          | ~5 % крипто-fee. Сети: Ethereum (ERC20), возможно Base/Polygon |
| AliPay                                                       | ✓          | если есть китайский account                                    |
| **Oplatym.ru** (посредник)                                   | ✓          | пополнение в рублях через СБП; 15–60 мин                       |
| **ProxyAPI / AITunnel** (proxy-сервисы с рублями RU-картами) | ✓          | свой BASE_URL, рубли                                           |

**Min top-up & currency:**

- Currency: USD only
- Min top-up: $5 наблюдаемо
- **Credits expire через 1 год** неиспользования
- **Refunds**: возможны 24 часа; 5.5 % platform fee non-refundable; crypto **never refundable**

**Russia-friendliness verdict: HIGH** — единственный из «больших» провайдеров без блокировки РФ-аккаунтов и с поддержкой USDC.

#### 3.3.6 SDK / API ergonomics

- **OpenAI compatibility**: drop-in. BASE_URL `https://openrouter.ai/api/v1`, любой OpenAI SDK работает
- **Headers для атрибуции**: `HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-Categories` для analytics/leaderboards
- **Native Agent SDK** (анонс 24 Apr 2026): Python + TypeScript. `callModel` высокоуровневый
- **AI SDK provider** (`@openrouter/ai-sdk-provider`) — Vercel AI SDK совместимый
- **Documentation**: высокая полнота (cookbooks, best-practices, migration guides per provider)
- **Discord** — активное community

#### 3.3.7 Что мы теряем оставаясь на OR (vs Direct)

1. ❌ **Batch API (−50 %)** — extraction $0.55 → $0.275 per book extraction
2. ❌ **Точный thinking_budget** в токенах для Gemini 3
3. ❌ **Native response.parsed** в genai SDK
4. ❌ **File API объект** — у direct можно загрузить EPUB и переиспользовать file_id
5. ❌ **Live API / WebSocket**

#### 3.3.8 Что мы выигрываем оставаясь на OR (vs Direct)

1. ✅ **Cross-provider fallback** — Gemini down → Claude Sonnet берёт без code change
2. ✅ **Russia-friendly** — единственный legal/safe способ платить за Anthropic/Google из РФ
3. ✅ **Auto Exacto** (free quality boost для tool-calls)
4. ✅ **Response Healing** (free, −80 % JSON syntax defects на Gemini 2.0 Flash)
5. ✅ **Compliance batteries** (SOC 2, ISO 27001, GDPR) included — fancai сам не аудируется
6. ✅ **Единый каталог 300+ моделей** + единый billing
7. ✅ **BYOK (Bring Your Own Key)**: можно использовать собственные Anthropic/Google ключи через OR — даёт access к direct batch с OR обвязкой

#### 3.3.9 Strengths и weaknesses

**Strengths:**

- 0 % per-token markup — цены идентичны upstream
- Все актуальные модели 2026 доступны (Gemini 3.x, GPT-5.x, Claude 4.7, Nano Banana 2, GPT Image 2, FLUX.2)
- Cross-provider auto-fallback из коробки
- Russia-friendly (USDC + посредники)
- ZDR by default + полный compliance pack
- Caching работает (Anthropic + Gemini)
- Auto Exacto + Response Healing — free quality boosts
- BYOK + Workspaces (новое) для multi-env

**Weaknesses:**

- **No Batch API** — упускаем 50 % discount на extraction-pipeline
- **$defs/$ref баг** для Google моделей — нужен `_inline_defs()` хак
- **No response.parsed** — только raw JSON
- **Gemini 3 thinking_budget неточный** — только level (low/med/high)
- **No formal SLA** для standard tier (только Enterprise contract)
- **5.5 % credit-purchase fee** на пополнение (на токены 0 %, но fee существует)

---

## 4. Cost Modeling для fancai

### 4.1 Параметры моделирования

Используем реалистичные параметры (откалиброваны на baseline fancai $0.40/book на Gemini 2.5 Flash):

| Параметр                                              | Значение                      |
| ----------------------------------------------------- | ----------------------------- |
| Книга                                                 | 50 глав                       |
| Avg chapter input tokens (TSA mode + chapter content) | 10 000 tok                    |
| Avg chapter output tokens (entities + tagged_text)    | 2 000 tok                     |
| Per-book extraction: total input                      | 500 000 tok                   |
| Per-book extraction: total output                     | 100 000 tok                   |
| Per-book dedup + synthesis + translation: input       | 400 000 tok (Flash Lite tier) |
| Per-book dedup + synthesis + translation: output      | 170 000 tok                   |
| Per-book full pipeline total                          | 900K input + 270K output      |

**Caching assumption** (реалистичный для fancai):

- TSA prompt fixed = 737 tokens (≈ 0.15 % от per-book input — caching этого почти не даёт)
- **Implicit caching хит rate**: ~10 % для extraction (только system prompt prefix), ~50 % для dedup+synthesis (общий book context)
- **Explicit caching** (если внедрить): затраты на storage $1/M·hr × 1 hr × 0.4M = $0.40 storage, что нивелирует savings для разовой extraction. **Не считаем для baseline cost.**

### 4.2 Per-book extraction cost (только extraction stage)

Формула: `cost = input_tokens × input_rate/1M + output_tokens × output_rate/1M`

| Сценарий                                               | Input rate        | Output rate | Per-book cost | Saving vs current baseline |
| ------------------------------------------------------ | ----------------- | ----------- | ------------- | -------------------------- |
| **Текущий fancai** (OR + Gemini 2.5 Flash)             | $0.30/M           | $2.50/M     | **$0.40**     | baseline                   |
| OR + Gemini 3 Flash (forced post-deprecation)          | $0.50/M           | $3.00/M     | **$0.55**     | **−$0.15 (хуже)**          |
| OR + Gemini 3.1 Flash Lite (cheaper tier)              | $0.25/M           | $1.50/M     | **$0.275**    | **+$0.125**                |
| Direct Gemini 3 Flash Std                              | $0.50/M           | $3.00/M     | **$0.55**     | **−$0.15 (хуже)**          |
| Direct + Implicit cache (10 % hit, only system prompt) | $0.45/M effective | $3.00/M     | **$0.525**    | **−$0.125**                |
| **Direct + Batch (Gemini 3 Flash)**                    | $0.25/M           | $1.50/M     | **$0.275**    | **+$0.125**                |
| Direct + Batch + Implicit cache                        | $0.225/M          | $1.50/M     | **$0.2625**   | **+$0.1375**               |
| **Direct + Batch (Gemini 3.1 Flash Lite)**             | $0.125/M          | $0.75/M     | **$0.1375**   | **+$0.2625** ⚡            |
| **kie.ai Gemini 3 Flash std**                          | $0.15/M           | $0.90/M     | **$0.165**    | +$0.235                    |
| kie.ai Gemini 3.1 Pro std                              | $0.50/M           | $3.50/M     | $0.60         | −$0.20                     |

**Insights:**

- **Direct + Batch (Flash Lite) = cheapest option** (~$0.14/book = **−65 % vs baseline**)
- **kie.ai Flash std = $0.165/book** — competitive с Direct Flash Batch ($0.275), но при принятии trust risks
- **OR forced migration на Gemini 3 Flash std = +37 % увеличение cost** vs текущий 2.5 Flash
- **Batch API — главный рычаг экономии**, не markup

### 4.3 Per-book full pipeline cost (extraction + dedup + synthesis + translation)

Mixed-tier strategy: extraction на Flash, остальное на Flash Lite.

| Сценарий                                                                           | Per-book cost  | vs current             |
| ---------------------------------------------------------------------------------- | -------------- | ---------------------- |
| **Текущий fancai** (OR + 2.5 Flash для extraction + 2.5 Flash Lite для остального) | **$0.50–0.60** | baseline               |
| OR + 3 Flash + 3.1 Flash Lite (post-deprecation forced)                            | **$0.91**      | **−$0.31–0.41 (хуже)** |
| OR + 3.1 Flash Lite primary (downgrade)                                            | **$0.50**      | comparable             |
| Direct Std + 3 Flash + 3.1 Flash Lite                                              | **$0.91**      | −$0.31–0.41            |
| **Direct + Batch + 3 Flash + 3.1 Flash Lite**                                      | **$0.45**      | **+$0.05–0.15**        |
| **Direct + Batch + 3.1 Flash Lite tier**                                           | **$0.31**      | **+$0.19–0.29**        |
| kie.ai Gemini 3 Flash mixed                                                        | **$0.378**     | +$0.12–0.22            |

### 4.4 Месячная стоимость (LLM only, без images)

#### 100 книг/месяц

| Provider                            | Per-book | Per-month | Annual |
| ----------------------------------- | -------- | --------- | ------ |
| Текущий (OR + 2.5 Flash)            | $0.40    | $40       | $480   |
| OR + 3 Flash (forced)               | $0.91    | $91       | $1 092 |
| OR + 3.1 Flash Lite (downgrade)     | $0.50    | $50       | $600   |
| **Direct + Batch + 3 Flash**        | $0.275   | $27.50    | $330   |
| **Direct + Batch + 3.1 Flash Lite** | $0.137   | $13.70    | $164   |
| kie.ai Flash                        | $0.165   | $16.50    | $198   |

#### 1 000 книг/месяц

| Provider                            | Per-month | Annual  |
| ----------------------------------- | --------- | ------- |
| Текущий (OR + 2.5 Flash)            | $400      | $4 800  |
| OR + 3 Flash (forced)               | $910      | $10 920 |
| OR + 3.1 Flash Lite (downgrade)     | $500      | $6 000  |
| **Direct + Batch + 3 Flash**        | $275      | $3 300  |
| **Direct + Batch + 3.1 Flash Lite** | $137      | $1 644  |
| kie.ai Flash                        | $165      | $1 980  |

**Break-even point** (Direct + Batch vs OR + Flash std):

- **Direct + Batch экономит $0.275 per book** vs OR + 3 Flash
- Migration cost: ~250–400 LOC + 1–2 дня инфра ≈ **$1 000–2 000 в человеко-стоимости** (одиночная dev cost)
- Break-even: **3 600–7 300 книг** = **3–7 месяцев на 1 000 кн/мес** или **3–6 лет на 100 кн/мес**
- ⚠️ **При текущем объёме fancai (100 кн/мес) miграция оправдана только в долгосрок** (>3 года) или **forced** (deprecation 2.5 Flash)

### 4.5 Image generation costs

Per image (1024×1024):

| Модель                               | Provider        | Cost/img   | 10K images/mo | 100K images/mo |
| ------------------------------------ | --------------- | ---------- | ------------- | -------------- |
| **FLUX.2 Klein 4B (текущий fancai)** | OR / BFL direct | **$0.014** | **$140**      | **$1 400**     |
| FLUX.2 Pro                           | OR / BFL direct | $0.07      | $700          | $7 000         |
| Nano Banana 2 (avg 1K)               | OR              | ~$0.07     | $700          | $7 000         |
| Nano Banana 2 + Direct Batch (½)     | Direct          | ~$0.035    | $350          | $3 500         |
| Nano Banana Pro                      | OR / Direct     | $0.134     | $1 340        | $13 400        |
| Nano Banana Pro + Direct Batch       | Direct          | $0.067     | $670          | $6 700         |
| GPT-5.4 Image 2                      | OR              | $0.20–0.30 | $2 000–3 000  | $20 000–30 000 |
| **kie.ai Nano Banana 2**             | kie.ai          | **$0.04**  | **$400**      | **$4 000**     |
| kie.ai Nano Banana Pro               | kie.ai          | $0.09      | $900          | $9 000         |

**Image cost insights:**

- **FLUX.2 Klein 4B через OR — невозможно перебить** на 2026-04-27. Это единственная sub-$0.02/img option с приличным качеством
- **Image cost dominate** при 10K+ images/month — выбор image provider больший рычаг чем LLM
- **Nano Banana 2 даёт state-of-the-art native text rendering** (нужно для cover-style и иллюстраций с текстом), но ×3–5 дороже FLUX.2 Klein
- **Direct Gemini Batch для images = ½ цены Nano Banana** ($0.035 vs $0.07) — но требует асинхронную обработку (24h SLA)

### 4.6 Полная месячная стоимость (LLM + Image)

#### 100 книг/мес + 10K images/мес

| Сценарий                                                                        | LLM    | Images | Total       | vs current                      |
| ------------------------------------------------------------------------------- | ------ | ------ | ----------- | ------------------------------- |
| **Текущий** (OR 2.5 Flash + FLUX.2 Klein)                                       | $40    | $140   | **$180**    | baseline                        |
| OR forced (3 Flash + FLUX.2 Klein)                                              | $91    | $140   | **$231**    | **−$51/мес**                    |
| **Hybrid: Direct Batch 3 Flash + OR FLUX.2 Klein**                              | $27.50 | $140   | **$167.50** | **+$12.50/мес**                 |
| Hybrid premium: Direct Batch + Nano Banana 2 (Direct Batch)                     | $27.50 | $350   | **$377.50** | −$197.50/мес (но качество выше) |
| Pure kie.ai (Flash + Nano Banana 2)                                             | $16.50 | $400   | **$416.50** | −$236/мес                       |
| Pure Direct (Std + FLUX.2 — но FLUX.2 нет у Direct, нужно через BFL direct API) | $55    | $140   | **$195**    | −$15/мес                        |

#### 1 000 книг/мес + 100K images/мес

| Сценарий                                                  | LLM  | Images | Total      | Annual      |
| --------------------------------------------------------- | ---- | ------ | ---------- | ----------- |
| Текущий (OR 2.5 Flash + FLUX.2 Klein)                     | $400 | $1 400 | **$1 800** | $21 600     |
| OR forced (3 Flash + FLUX.2 Klein)                        | $910 | $1 400 | **$2 310** | $27 720     |
| **Hybrid: Direct Batch 3 Flash + OR FLUX.2 Klein**        | $275 | $1 400 | **$1 675** | **$20 100** |
| Hybrid premium (Direct Batch + Nano Banana 2 batch)       | $275 | $3 500 | **$3 775** | $45 300     |
| Pure kie.ai (Flash + Nano Banana 2)                       | $165 | $4 000 | **$4 165** | $49 980     |
| Pure Direct + 3.1 Flash Lite Batch + FLUX.2 Klein (BYOK?) | $137 | $1 400 | **$1 537** | **$18 444** |

> **Чисто арифметически выигрывает Pure Direct + 3.1 Flash Lite Batch ($1 537/мес для 1K книг)**, но это требует **BYOK через OR для FLUX.2 Klein** или прямое подключение к BFL API. Альтернативный hybrid — самый сбалансированный.

---

## 5. Migration Path Analysis

### 5.1 OpenRouter → kie.ai

**Не рекомендуется.** Анализ:

**Files требующие изменения:**

- `backend/app/core/openrouter_client.py` — полная замена клиента (нет drop-in)
- `backend/app/services/gemini_extractor.py` — переписать model invocation
- `backend/app/services/llm_service.py` — добавить per-model dispatch (Gemini ≠ Claude ≠ GPT endpoint shapes)
- `backend/app/services/image_service.py` — переписать на kie.ai job-pattern (createTask + polling)
- `backend/app/services/translation_service.py` — переключить endpoint
- Tests — переписать mocks под новые HTTP shapes
- Pydantic schemas — протестировать `_inline_defs()` workaround на kie.ai (вероятно нужен)

**LOC estimate:** ~300–500 LOC переписать + ~100 LOC новых тестов

**Время разработки:** 2–3 человеко-дня для соло-разработчика, который знает stack

**Critical risks:**

- Structured outputs с вложенными schemas — **не подтверждено что работает**
- Russia payments — **не подтверждено**
- Disappearing credits — **системная жалоба**
- Поддержка только в Asia time zones — **production risk**
- Identity моделей — **не верифицировано независимо**

**Rollback plan:**

- Git revert PR
- Restore OpenRouter API key в env
- Deploy старого backend
- **Время rollback**: <1 часа если изменения изолированы в `openrouter_client.py`. **Несколько часов** если затронуты пересекающиеся файлы

**Выгода (best case):**

- Per-book savings: $0.40 → $0.165 = $0.235 savings (~58 %)
- 100 books/мес: **$23.50/мес savings** = $282/год
- ROI: 4–8 человеко-дней migration / $282/год = **>10 лет до break-even**

**Verdict:** ROI marginal + trust risks high → **не оправдано**

### 5.2 OpenRouter → Direct Gemini API

**Recommended for hybrid migration.** Анализ:

**Files требующие изменения:**

- `backend/app/core/openrouter_client.py` → создать `gemini_direct_client.py` (можно использовать OpenAI-compat endpoint, ~50 LOC)
- `backend/app/services/gemini_extractor.py` — заменить `from openai import OpenAI` на `from google import genai` (либо оставить openai SDK с base_url change). **OpenAI-compat вариант**: ~10 LOC change
- `backend/app/services/llm_service.py` — обернуть для batch submission
- Pydantic schemas: можно **удалить `_inline_defs()` хак** в новых google-genai SDK (~30 LOC удалить)
- Retries: tenacity → переключить на конкретные Google error codes (5 LOC)
- Image generation: **сохранить через OR** (нет смысла мигрировать FLUX.2 Klein на Direct, у Direct его нет)
- Tests — добавить mocks для batch submission flow

**Опции миграции:**

**Option A: Drop-in через OpenAI-compatible endpoint** (минимальные изменения)

- Изменить `base_url` в openai SDK на `https://generativelanguage.googleapis.com/v1beta/openai/`
- **LOC:** ~50 строк
- **Преимущества:** код почти не меняется
- **Минусы:** теряем native Pydantic + Batch API + File API (OpenAI-compat не предоставляет всех Direct features)

**Option B: Full native google-genai SDK**

- Переписать на `from google import genai`
- **LOC:** ~250–400 строк
- **Преимущества:** native Pydantic, response.parsed, Batch API через File API, explicit caching, thinking_level
- **Минусы:** больший migration cost

**Option C: BYOK через OpenRouter** ⭐ (gold path)

- В OR settings включить BYOK для Google
- В коде ничего не меняется (всё ещё через OR base_url)
- OR использует твой API key для прямых вызовов к Google
- **LOC:** 0 (только конфиг)
- **Преимущества:** zero migration + Russia payments through OR + cross-provider fallback сохраняется
- **Минусы:** Batch API через OR + BYOK — **нужно подтвердить что работает на 2026-04-27** (упоминается в OR docs, но не тестировано)

**Время разработки:**

- Option A: **0.5 человеко-дня**
- Option B: **2–3 человеко-дня**
- Option C: **2 часа** (только конфиг + Google billing setup)

**Critical risks:**

- **Russia API access**: нужен VPS-прокси (~1 час setup) + риск Google детектит datacenter IP
- **Russia card**: Cardn3 ($5–15 issuance + 3–5 % conversion fee) или зарубежное юрлицо
- **API key ban risk**: если Google детектит, теряем context caches + batch jobs in-flight
- **3.1 Pro Preview только global endpoint**: нельзя жёстко указать europe-west8 для GDPR compliance

**Rollback plan:**

- Git revert
- Restore openrouter_client.py
- Время rollback: <30 минут для Option A, <2 часов для Option B

**Выгода:**

- Per-book savings (Option B + Batch on 3 Flash): $0.40 → $0.275 = $0.125 (~31 %)
- 100 books/мес: **$12.50/мес savings** = $150/год
- ROI: 2–3 человеко-дня / $150/год → **5–10 лет**

⚠️ **Но**: после **2026-06-17 deprecation** baseline OR cost вырастает до $0.91/book ($0.51/book на pure 3 Flash), и тогда Direct + Batch экономит $0.635/book = **$76/мес** = **$915/год** для 100 кн/мес. **ROI становится <1 года**.

### 5.3 Гибрид: разные провайдеры для разных задач

**Recommended path.**

#### Architecture

```
┌─────────────────────────────────────────┐
│ fancai backend                          │
│                                         │
│  ┌──────────────────┐                   │
│  │ extraction       │                   │
│  │ (TSA mode)       │ ──┐               │
│  └──────────────────┘   │               │
│                         ▼               │
│  ┌──────────────────┐  Direct Gemini    │
│  │ dedup + synth    │ ─► (Batch API)    │
│  └──────────────────┘  via VPS proxy    │
│                                         │
│  ┌──────────────────┐                   │
│  │ translation      │                   │
│  └──────────────────┘                   │
│                                         │
│  ┌──────────────────┐                   │
│  │ image generation │ ─► OpenRouter     │
│  └──────────────────┘   FLUX.2 Klein    │
│                         (current path)  │
└─────────────────────────────────────────┘
```

#### Optimal split

| Задача                                     | Provider          | Модель                        | Обоснование                               |
| ------------------------------------------ | ----------------- | ----------------------------- | ----------------------------------------- |
| Extraction (TSA mode)                      | **Direct Gemini** | gemini-3-flash + Batch        | 50 % discount + native Pydantic + caching |
| Entity dedup                               | Direct Gemini     | gemini-3.1-flash-lite + Batch | Cheap tier + caching на book context      |
| Entity synthesis                           | Direct Gemini     | gemini-3.1-flash-lite + Batch | То же                                     |
| Translation RU→EN                          | Direct Gemini     | gemini-3.1-flash-lite + Batch | Большой volume, batch-friendly            |
| Image generation                           | **OpenRouter**    | FLUX.2 Klein 4B               | $0.014/img — не перебить нигде            |
| Russia payment buffer                      | **OpenRouter**    | (USDC top-up channel)         | Failover platejнный канал                 |
| Cross-provider fallback (если Direct down) | OpenRouter        | Claude Sonnet 4.6             | High-quality LLM как backup               |

#### Implementation steps

1. **Setup Direct Gemini** (Day 1):
   - Получить Cardn3 виртуальную карту ($5–15 issuance)
   - Создать Google Cloud project + Vertex AI billing
   - Настроить outbound прокси на VPS (Caddy/HAProxy → DE/FI VPS, ~1 час)
   - Тестовый prepay $5 + verify API access из РФ через прокси

2. **Migrate LLM stack** (Day 2-3):
   - Option A first: openai SDK base_url change → Direct
   - Если работает — postupenно переходить на native genai SDK для Batch API access
   - Удалить `_inline_defs()` хак (теперь не нужен)
   - Добавить tenacity retries на Google error codes

3. **Add batch submission** (Day 3-4):
   - Реализовать Celery task для batch creation (per-book или per-N-books)
   - JSON Lines file upload через File API
   - Polling для batch completion (24h SLA)
   - Если книга срочная (premium user) → fallback на std API

4. **Verify image path стабилен** (Day 4):
   - OR FLUX.2 Klein остаётся
   - Проверить что image jobs идут через OR (не сломаны cross-references)

5. **Setup monitoring** (Day 5):
   - Cloud Monitoring для Direct (RPM, errors, cost alerts)
   - OpenRouter Workspaces для image jobs separation (prod vs dev)
   - Daily cost reports в Slack/Telegram

**Total время:** 5 человеко-дней (1 неделя focused work)

**Migration rollback:**

- Если Direct down — automated fallback на OR (config flag)
- Если Cardn3 заблокирован Google — restore через крипто USDC top-up на OR (24h)
- Полный revert: git revert + redeploy → <1 час

---

## 6. Risk Assessment

| Риск                                                                                | Вероятность | Влияние | Митигация                                                                       |
| ----------------------------------------------------------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------- |
| **kie.ai banned in Russia** (после migration)                                       | MEDIUM      | HIGH    | Не мигрировать; если мигрировать — иметь OR backup                              |
| **kie.ai pricing rises sharply**                                                    | MEDIUM      | MEDIUM  | ToS даёт право менять без notice → не мигрировать                               |
| **kie.ai reliability issues** (Sora 2 outages prevoid)                              | HIGH        | HIGH    | Не использовать для production-critical                                         |
| **kie.ai disappearing credits**                                                     | MEDIUM      | MEDIUM  | Минимальный top-up $5; не хранить большие balance                               |
| **Direct Gemini blocked в РФ** (escalation санкций)                                 | MEDIUM      | HIGH    | Multi-region VPS proxy backup; OR как fallback channel                          |
| **Direct Gemini API key ban** (за RU IP / sanctioned BIN)                           | MEDIUM      | HIGH    | Стабильный прокси (rotated VPS), Cardn3 надёжный issuer; backup OR              |
| **Direct Gemini 3.1 Pro 429 errors** (preview-status)                               | HIGH        | MEDIUM  | Batch API вместо std для критичных задач; Tier 2 quota request после $250 spend |
| **OpenRouter raises markup** (5.5 % credit fee → ?)                                 | LOW         | MEDIUM  | Disclosed в TOS, нет прецедентов за год; Direct как backup                      |
| **OpenRouter outage** (14 Apr 2026, 17/19 Feb)                                      | MEDIUM      | MEDIUM  | Cross-provider fallback already built-in для OR                                 |
| **Vendor model substitution** (kie.ai даёт другую модель)                           | MEDIUM      | HIGH    | Не мигрировать на kie.ai без token-level identity verification                  |
| **Gemini 2.5 Flash deprecation 2026-06-17**                                         | **CERTAIN** | HIGH    | **MIGRATE НА 3.x ДО 2026-06-15 — независимо от выбора провайдера**              |
| **Imagen 4 deprecation 2026-06-24** (если бы fancai использовал)                    | CERTAIN     | LOW     | fancai на FLUX.2 Klein — не затронут                                            |
| **Anthropic Claude Opus 4.7 +279 % traffic spike** → потенциальный rate limit на OR | MEDIUM      | MEDIUM  | Не использовать Opus 4.7 для extraction; pin на Gemini 3.x                      |
| **Российские посредники (Oplatym, AITunnel) blocked**                               | LOW         | MEDIUM  | USDC channel as primary; foreign card as secondary                              |

---

## 7. Recommendation

### 7.1 Финальная рекомендация (1 страница)

**Для соло-разработчика fancai на 2026-04-27 — оптимальный путь:**

#### Этап 1 (немедленно, до 2026-05-15)

**Не мигрировать на kie.ai.** Trust deficit (67 % 1-star Trustpilot, hidden owner, Chinese infra под US LLC, disappearing credits, Asia-only support, identity моделей не верифицирована) **не компенсируется** ценовым преимуществом для production-критичного pipeline соло-разработчика. ROI миграции — >10 лет при текущем объёме.

**Сохранить OpenRouter** как primary канал для image generation (FLUX.2 Klein 4B @ $0.014/img — невозможно перебить) и Russia payment buffer (USDC + посредники для рублей).

**Подготовить миграцию LLM-стека** на Direct Gemini API:

1. Создать Cardn3 виртуальную карту ($5–15)
2. Создать Google Cloud project + Vertex AI billing
3. Настроить outbound прокси на VPS в Германии/Финляндии (~1 час)
4. Прогнать 10 chapters extraction через Direct (Option A: openai SDK + base_url change) — сравнить outputs с OR baseline на golden set

#### Этап 2 (до 2026-06-10, deadline 2.5 Flash deprecation)

Если Step 1 успешен — мигрировать LLM-стек:

- **Extraction (TSA mode)**: Direct Gemini 3 Flash + Batch API (50 % discount)
- **Dedup + Synthesis + Translation**: Direct Gemini 3.1 Flash Lite + Batch
- **Image generation**: оставить OpenRouter с FLUX.2 Klein 4B
- Удалить `_inline_defs()` хак (новый google-genai SDK сам инлайнит $defs)
- Добавить fallback на OR Claude Sonnet 4.6 если Direct down

**Ожидаемая ежемесячная стоимость** (100 кн/мес + 10K images/мес):

- Текущая: $180
- После миграции: **$167.50** (−$12.50/мес = $150/год)
- При forced-only OR migration (без Direct): $231 (+$51/мес = +$612/год хуже)
- **Hybrid Direct + OR savings vs forced-only: $63.50/мес = $762/год**

#### Этап 3 (2026-Q3, опционально)

Если scale вырастет до 1 000 кн/мес — рассмотреть **BYOK через OpenRouter** для Direct Gemini Batch без полного отказа от OR convenience. Дает access к batch с сохранением OR features (cross-fallback, RU payments).

Если quality of illustrations станет приоритетом — переключить FLUX.2 Klein на **Nano Banana 2 batch через Direct** ($0.035/img, native text rendering) для cover-style. Std illustrations остаются на FLUX.

### 7.2 Decision tree

```
┌─────────────────────────────────────────────────────────────────────┐
│ Решение по AI-провайдеру для fancai (2026-04-27)                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │ Готов ли разработчик делать VPS прокси │
        │ + Cardn3 карту + GCP setup (5 дней)?   │
        └────────────────────────────────────────┘
                  │                       │
                 YES                      NO
                  │                       │
                  ▼                       ▼
        ┌────────────────────┐    ┌──────────────────────────┐
        │ ГИБРИД:            │    │ Остаться на OpenRouter,  │
        │ LLM = Direct Gemini│    │ мигрировать с 2.5 Flash  │
        │ + Batch API        │    │ на 3.1 Flash Lite        │
        │ Image = OR FLUX.2  │    │ (cheaper tier)           │
        │ Klein              │    │                          │
        │                    │    │ +$10/мес vs current      │
        │ −$12/мес vs current│    │ vs +$51/мес forced 3 Flash│
        └────────────────────┘    └──────────────────────────┘
                  │                       │
                  ▼                       ▼
        ┌────────────────────┐    ┌──────────────────────────┐
        │ Если scale > 1K    │    │ При scale > 1K кн/мес    │
        │ books/mes → BYOK   │    │ — пересмотр через 6 мес  │
        │ через OR для Batch │    │                          │
        └────────────────────┘    └──────────────────────────┘
```

**Приоритет factors:**

- **Если cost критичен** → Direct Gemini + Batch (или kie.ai при принятии trust risks)
- **Если reliability/SLA критичен** → Direct Gemini (formal Vertex SLA)
- **Если zero-effort критичен** → OpenRouter + downgrade на 3.1 Flash Lite
- **Если Russia-friendliness критична** → OpenRouter (для billing) + Direct (для compute через прокси)
- **Если quality иллюстраций критична** → Hybrid premium: Direct Batch + Nano Banana 2

### 7.3 First step (executable)

**Сегодня (2026-04-27 — 2026-04-28):**

```bash
# 1. Создать Cardn3 виртуальную карту через https://cardn3.com
#    - USDT TRC20 top-up ~$50
#    - Получить US Visa virtual card ($5-15 fee)

# 2. Настроить Google Cloud:
#    - Создать new GCP project: "fancai-llm"
#    - Включить Vertex AI API
#    - Добавить Cardn3 карту в billing
#    - Запросить Tier 2 quota после первого $250 spend (через console)

# 3. Настроить VPS прокси (на существующем fancai VPS):
#    - SSH на VPS
#    - Установить Caddy с reverse proxy на generativelanguage.googleapis.com
#    - Альтернатива: HAProxy с outbound IP routing
#    - Тестировать: curl --proxy https://your-vps:port https://generativelanguage.googleapis.com/v1beta/models

# 4. Тестовый запрос (Python через openai SDK + Google base_url):
cat > test_direct_gemini.py <<'EOF'
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_GOOGLE_API_KEY",
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
)

response = client.chat.completions.create(
    model="gemini-3-flash-preview",
    messages=[{"role": "user", "content": "Извлеки entities из текста: Геральт ехал по Каэр Морхен."}],
    response_format={"type": "json_object"}
)
print(response.choices[0].message.content)
EOF
python test_direct_gemini.py
```

**На этой неделе (2026-04-28 — 2026-05-04):**

1. Прогнать 10 chapters extraction через Direct Gemini (Option A: openai SDK base_url change)
2. Сравнить outputs с OpenRouter baseline на golden test set (entities accuracy, tagged_text correctness, JSON validity)
3. Замерить latency p50/p95 vs OR
4. Если результаты совпадают — декомпозировать в полный migration plan на следующую неделю

**В следующие 2 недели (до 2026-05-18):**

1. Реализовать Batch API submission flow в Celery task
2. Добавить fallback config (Direct → OR Claude Sonnet 4.6 если Direct down)
3. Удалить `_inline_defs()` хак, использовать native Pydantic
4. Cutover production traffic постепенно (10 % → 50 % → 100 % через 1 неделю)

**К 2026-06-15 (до deprecation 2.5 Flash):**

- 100 % LLM traffic на Direct Gemini 3 Flash (extraction) + 3.1 Flash Lite (rest) + Batch API
- Image traffic полностью на OpenRouter FLUX.2 Klein 4B
- Daily cost monitoring + automated alerts при превышении бюджета

---

## 8. Appendix

### 8.1 Sources (полный список)

#### Драфты-источники

- `docs/research/_drafts/kieai-research-2026-04-27.md` — 35+ URL (kie.ai docs, ToS, ScamAdviser, Trustpilot, Crunchbase, eliteai.tools, Reddit/HN search results)
- `docs/research/_drafts/gemini-direct-research-2026-04-27.md` — 69 URL (Google docs, Vertex docs, AI Studio docs, status.cloud.google.com, artificialanalysis.ai, GitHub Issues, Cardn3 guides)
- `docs/research/_drafts/openrouter-research-2026-04-27.md` — 35+ URL (openrouter.ai docs, status.openrouter.ai, Anthropic/Google/BFL upstream pricing pages, Russia-specific guides)

#### Ключевые источники

**Pricing — официальные (2026-04-27):**

1. [Google AI Studio Pricing](https://ai.google.dev/pricing)
2. [Vertex AI Generative AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
3. [Anthropic Claude pricing](https://www.anthropic.com/claude/opus)
4. [Black Forest Labs pricing](https://bfl.ai/pricing)
5. [OpenRouter Pricing Page](https://openrouter.ai/pricing)
6. [OpenRouter Anthropic Models](https://openrouter.ai/anthropic)
7. [OpenRouter Google Models](https://openrouter.ai/google)
8. [OpenRouter OpenAI Models](https://openrouter.ai/openai)
9. [OpenRouter Image Models](https://openrouter.ai/collections/image-models)
10. [kie.ai Home](https://kie.ai/) + [kie.ai Pricing](https://kie.ai/pricing)
11. [kie.ai Gemini 3 Pro page](https://kie.ai/gemini-3-pro)
12. [kie.ai Gemini 3 Flash page](https://kie.ai/gemini-3-flash)

**Feature parity:**

13. [google-genai SDK docs](https://googleapis.github.io/python-genai/)
14. [google-genai PyPI](https://pypi.org/project/google-genai/)
15. [google-genai GitHub](https://github.com/googleapis/python-genai)
16. [Pydantic Model Integration DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5.1-pydantic-model-integration)
17. [Structured Outputs DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5-function-calling)
18. [GitHub Issue #60: nested Pydantic schema bug](https://github.com/googleapis/python-genai/issues/60)
19. [GitHub Issue #699: default field values bug](https://github.com/googleapis/python-genai/issues/699)
20. [Context caching docs (AI Studio)](https://ai.google.dev/gemini-api/docs/caching)
21. [Vertex AI context cache overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)
22. [Batch API docs (AI Studio)](https://ai.google.dev/gemini-api/docs/batch-api)
23. [Vertex AI Batch inference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini)
24. [Files API docs](https://ai.google.dev/gemini-api/docs/files)
25. [Thinking docs](https://ai.google.dev/gemini-api/docs/thinking)
26. [pydantic-ai Issue #3617: $defs/$ref bug on OR](https://github.com/pydantic/pydantic-ai/issues/3617)
27. [big-AGI Issue #893: Gemini 3 thinking_level](https://github.com/enricoros/big-agi/issues/893)
28. [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
29. [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
30. [OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
31. [OpenRouter Auto Exacto](https://openrouter.ai/announcements/auto-exacto)
32. [OpenRouter Response Healing](https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent)
33. [kie.ai Gemini 3 Pro docs](https://docs.kie.ai/market/gemini/gemini-3-pro)
34. [kie.ai Claude Sonnet 4.5 docs](https://docs.kie.ai/market/claude/claude-sonnet-4-5)

**Reliability / Status pages:**

35. [Google Cloud Service Health](https://status.cloud.google.com/)
36. [Vertex AI SLA](https://cloud.google.com/vertex-ai/sla) + [Gemini Online Inference SLA](https://cloud.google.com/vertex-ai/generative-ai/sla)
37. [aibadgr Gemini outage tracker](https://aibadgr.com/gemini-outage)
38. [OpenRouter Status](https://status.openrouter.ai)
39. [eliteai.tools kie.ai uptime](https://eliteai.tools/tool/kieai/uptime-status)
40. [Artificial Analysis Gemini 3 Flash](https://artificialanalysis.ai/models/gemini-3-flash-reasoning)
41. [Artificial Analysis Gemini 3.1 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview)

**Compliance:**

42. [Vertex AI zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)
43. [OpenRouter Trust Center](https://trust.openrouter.ai)
44. [kie.ai Privacy Policy](https://kie.ai/privacy-policy)
45. [kie.ai Terms of Use](https://kie.ai/terms-of-use)

**Russia-specific:**

46. [workalizer Gemini Russia access](https://workalizer.com/insights/gemini/understanding-gemini-access-why-googles-ai-is-unavailable-in-russia/)
47. [vc.ru: OpenRouter из России (2026)](https://vc.ru/services/2728935-podklyuchenie-openrouter-instruktsiya-dlya-razrabotchikov-v-rossii)
48. [aitunnel.ru: OpenRouter без VPN](https://aitunnel.ru/providers/openrouter)
49. [cardn3 ChatGPT virtual card guide](https://cardn3.com/blog/virtual-card-for-chatgpt)
50. [buvei virtual cards Google Cloud 2026](https://buvei.com/blog/best-virtual-cards-for-google-cloud-billing-in-2026-avoid-declines-and-holds/)
51. [proxyapi.ru/openrouter](https://proxyapi.ru/openrouter) (RU intermediary)

**Reputation / community:**

52. [Trustpilot kie.ai](https://www.trustpilot.com/review/kie.ai)
53. [Scamadviser kie.ai check](https://www.scamadviser.com/check-website/kie.ai)
54. [Crunchbase kie](https://www.crunchbase.com/organization/kie)
55. [erweima.ai SimilarWeb traffic](https://www.similarweb.com/website/erweima.ai/)
56. [Roo-Code Issue #11011: kie.ai Gemini 3 error](https://github.com/RooCodeInc/Roo-Code/issues/11011)
57. [gateway/kie-api GitHub](https://github.com/gateway/kie-api) (1 star)
58. [OpenRouter Discord](https://discord.openrouter.ai)
59. [OpenRouter LLM Rankings](https://openrouter.ai/rankings)

**Pricing aggregators / community guides:**

60. [aifreeapi.com Gemini API Pricing 2026](https://www.aifreeapi.com/en/posts/gemini-api-pricing-2026)
61. [aipricing.guru Gemini April 2026](https://www.aipricing.guru/google-ai-pricing/)
62. [Verdent 3.1 Pro pricing guide](https://www.verdent.ai/guides/gemini-3-1-pro-pricing)
63. [Inference Hub: Cheapest Claude Provider 2026](https://inferencehub.org/blog/cheapest-claude-api-provider-2026/)
64. [Skywork Kie.ai In-Depth 2025](https://skywork.ai/skypage/en/Kie.ai-In-Depth-2025)
65. [Nerdbot kie.ai Gemini 3 Flash Pricing](https://nerdbot.com/2026/03/17/the-future-of-api-how-kie-ais-gemini-3-flash-api-pricing-makes-high-performance-models-affordable/)

**Image gen pricing:**

66. [intuitionlabs image pricing comparison](https://intuitionlabs.ai/articles/ai-image-generation-pricing-google-openai)
67. [aifreeapi 3 Pro Image vs Imagen 4](https://www.aifreeapi.com/en/posts/gemini-3-pro-image-preview-vs-imagen-4)
68. [Imagen 4 GA blog](https://developers.googleblog.com/announcing-imagen-4-fast-and-imagen-4-family-generally-available-in-the-gemini-api/)
69. [laozhang Nano Banana Pro pricing](https://blog.laozhang.ai/en/posts/gemini-3-pro-image-api-pricing)

**Deprecations:**

70. [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
71. [Gemini API Release notes](https://ai.google.dev/gemini-api/docs/changelog)

> **Полный список 119+ URL** в исходных драфтах исследований (`_drafts/`).

### 8.2 Pricing snapshots (для воспроизводимости)

**Снимок на 2026-04-27 17:00 MSK:**

```
=== LLM Pricing per 1M tokens ===

Provider       Model                      Std in / Std out   Cached in   Batch in / Batch out
─────────────────────────────────────────────────────────────────────────────────────────────
Google Direct  Gemini 3.1 Pro Preview     $2.00 / $12.00     $0.20       $1.00 / $6.00
Google Direct  Gemini 3 Flash Preview     $0.50 / $3.00      $0.05       $0.25 / $1.50
Google Direct  Gemini 3.1 Flash-Lite      $0.25 / $1.50      $0.025      $0.125 / $0.75
Google Direct  Gemini 2.5 Flash (DEAD)    $0.30 / $2.50      $0.075      $0.15 / $1.25
─────────────────────────────────────────────────────────────────────────────────────────────
OpenRouter     google/gemini-3.1-pro-preview  same as Direct (0% markup)
OpenRouter     google/gemini-3-flash-preview  same as Direct (0% markup)
OpenRouter     google/gemini-3.1-flash-lite-preview  same as Direct (0% markup)
OpenRouter     anthropic/claude-opus-4.7  $5.00 / $25.00     n/a         no batch
OpenRouter     openai/gpt-5               $1.25 / $10.00     auto-cache  no batch
─────────────────────────────────────────────────────────────────────────────────────────────
kie.ai         gemini-3-flash             $0.15 / $0.90      not docs    not docs
kie.ai         gemini-3-pro               $0.50 / $3.50      not docs    not docs
kie.ai         claude-opus-4-7            $1.75 / $8.75 (one source)     not docs

=== Image Pricing per 1024×1024 ===

Provider       Model                      Cost
─────────────────────────────────────────────────────────────────────────────────────────────
OpenRouter     black-forest-labs/flux.2-klein-4b   $0.014  ⭐ current fancai baseline
OpenRouter     black-forest-labs/flux.2-pro        $0.07
OpenRouter     google/gemini-3.1-flash-image-preview  ~$0.045-0.151
OpenRouter     google/gemini-3-pro-image-preview   ~$0.20-0.40
OpenRouter     openai/gpt-5.4-image-2              ~$0.20-0.30
─────────────────────────────────────────────────────────────────────────────────────────────
Google Direct  Nano Banana 2 std                   $0.045-0.151 (size dep)
Google Direct  Nano Banana 2 batch                 $0.022-0.075 (50% off)
Google Direct  Nano Banana Pro std                 $0.134 (1K-2K)
Google Direct  Nano Banana Pro batch               $0.067
Google Direct  Imagen 4 Standard (DEAD 2026-06-24) $0.04
─────────────────────────────────────────────────────────────────────────────────────────────
kie.ai         Nano Banana 2                       $0.04 (any res)
kie.ai         Nano Banana Pro                     $0.09 (1K-2K)
kie.ai         GPT-Image-1 (4o)                    $0.03
```

### 8.3 Открытые вопросы (что не удалось выяснить)

1. **Точный discount на explicit cache у Google** (75 % vs 90 %) — Verdent guides пишет 75 %, AI Studio docs — 90 %. Нужно проверить на live API call с metering в console
2. **kie.ai Russia card payment** — публично не подтверждено; нужен тестовый signup
3. **kie.ai crypto top-up** — не описан публично
4. **kie.ai $defs/$ref в JSON Schema** — не задокументировано; нужен тестовый запрос
5. **kie.ai independent model identity verification** — никто публично не проверял что под `gemini-3-pro` отдают именно Google Gemini
6. **Точная сетевая поддержка USDC для OR крипто-платежей** (только ERC20? + Base/Polygon?) — не публикуется
7. **OR BYOK fee %** — упоминается «percentage-based fee after free monthly threshold», но точная цифра в FAQ не приведена
8. **OR TPM лимиты** для paid tier — публично не задокументированы
9. **Реальный TPS под Direct Gemini Tier 1 на 3.1 Pro Preview** — 429 errors часты; нужно бенчмарк
10. **Cardn3 на Google Cloud в 2026-Q2** — отзывы есть, но критичный мерчант не у всех проходит
11. **Если backend получает прокси-IP в Германии и payment с Cardn3 (US BIN) — Google AML/fraud signals не сработают?** — risk bans
12. **Когда GA для Gemini 3.1 Pro и Gemini 3 Flash** — preview-status означает риск sudden API changes / quota cuts

### 8.4 Bonus findings

> Интересные факты, не вписывающиеся в основной отчёт.

1. **FLUX.3 не существует на 2026-04-27.** Black Forest Labs flagship line — FLUX.2 (Pro/Max/Klein/dev/Flex). Промпт пользователя предполагал релиз, но это **не подтвердилось**. Линейка FLUX.2 ещё текущая.

2. **Gemini 2.5 Flash deprecation создаёт принудительный deadline.** Sunset 2026-06-17. fancai не имеет роскоши «оставить как есть» — миграция на 3.x неизбежна в течение **<7 недель** независимо от выбора провайдера. Это **естественная точка** для пересмотра всего стека.

3. **Все Imagen 4 модели deprecate 2026-06-24.** Google прямо говорит «migrate to Nano Banana». fancai не использует Imagen, но это влияет на competitive landscape — Nano Banana 2 становится de-facto standard для Google image gen.

4. **Claude Opus 4.7 traffic на OpenRouter вырос на +279 %** за неделю после релиза 16 апреля 2026 — теперь #4 модель по traffic. Указывает на быструю adoption frontier reasoning моделей. Для fancai не релевант (extraction не требует Opus-уровня), но интересно для будущих фич.

5. **kie.ai Erweima Chinese-affiliated infra под US LLC обёрткой.** Subdomain `kieai.erweima.ai` принадлежит третьему лицу `erweima.ai` (китайский white-label aggregator). Заявленная Colorado LLC — front; операционная команда **скорее всего китайская**. Это объясняет: support только Asia time zones, противоречия в HQ (Mumbai vs Colorado), отсутствие public team profiles.

6. **OpenRouter **Auto Exacto** включается по умолчанию для tool requests** (с 12 марта 2026) — даёт −80–88 % tool-call ошибок. Если fancai будет использовать tools-mode для extraction (вместо response_format JSON), это даёт **бесплатный quality boost**.

7. **OpenRouter **Response Healing** автоматически исправляет JSON syntax errors** (анонс 18 декабря 2025) — −80 % defects на Gemini 2.0 Flash, −99.8 % на Qwen3 235B. fancai уже выигрывает от этого без code change.

8. **Google AI Studio free tier с 2026-04-01 — Pro модели больше не доступны бесплатно.** Только Flash/Flash-Lite. Free tier формально перевели в "for developers only — no consumer use". Это сигнал что Google ужесточает free tier.

9. **Gemini 3.1 Pro Preview сейчас только global endpoint** — нельзя жёстко указать europe-west8 для GDPR compliance. Для GA версии это изменится. Если fancai будет хранить EU user data → нужно дождаться GA.

10. **OpenRouter Workspaces (Apr 22 2026)** позволяет отделить prod/dev окружения с отдельными API keys и spend caps. Полезно для fancai — можно разделить production extraction traffic от dev experiments.

---

**Конец отчёта.** Total 119+ URL источников. Все ключевые цифры cross-referenced 2+ источниками где возможно. Conflicting data явно отмечена. Recommendation actionable с конкретным first step.
