# Полный план миграции fancai на Direct Gemini API + два раунда аудита

> **Дата:** 03.05.2026 · **Автор:** Claude Opus 4.7 · **Effort:** max
> **SDK target:** `google-genai==1.74.0` · **Сервер:** Германия (без прокси)
> **Тарифы:** Free + Pro (1490 RUB/мес) с кредитной моделью на image
> **Дедлайн:** 17.06.2026 (sunset Gemini 2.5 Flash)
> **Статус документа:** v2.0 после двух раундов аудита

## Содержание

- [Часть 0. Контекст и резюме](#часть-0-контекст-и-резюме)
- [Часть A. План v1.0](#часть-a-план-v10)
  - [A.1 Финансовая модель (unit economics)](#a1-финансовая-модель-unit-economics)
  - [A.2 Тарифная архитектура](#a2-тарифная-архитектура)
  - [A.3 Целевая архитектура](#a3-целевая-архитектура)
  - [A.4 План миграции — 12 фаз](#a4-план-миграции--12-фаз)
  - [A.5 Verification & Testing](#a5-verification--testing-strategy)
  - [A.6 Risks & mitigation](#a6-risks--mitigation)
  - [A.7 Timeline](#a7-timeline)
  - [A.8 Open questions v1.0](#a8-open-questions)
- [Часть B. Аудит v1.0 (первый раунд)](#часть-b-критический-аудит-плана-v10)
  - [B.1 Финансовая модель](#b1-финансовая-модель--ошибки-и-риски)
  - [B.2 Архитектурные проблемы](#b2-архитектурные-проблемы)
  - [B.3 Security audit](#b3-security-audit)
  - [B.4 Timeline риски](#b4-timeline-риски)
  - [B.5 Verification gaps](#b5-verification-gaps)
  - [B.6 Missing scope](#b6-missing-scope)
  - [B.7 Сводка топ-рекомендаций v1.0](#b7-сводка-аудита--топ-рекомендаций)
- [Часть C. План v2.0 после первого аудита](#часть-c-план-v20-консолидированный)
- [Часть D. Аудит v2.0 (второй раунд / мета-аудит)](#часть-d-аудит-v20-мета-аудит)
  - [D.1 Compliance / Legal](#d1-compliance--legal)
  - [D.2 UX edge cases](#d2-ux-edge-cases)
  - [D.3 Operational maturity](#d3-operational-maturity)
  - [D.4 Quality & Testing gaps](#d4-quality--testing-gaps)
  - [D.5 Performance edge cases](#d5-performance-edge-cases)
  - [D.6 Database & migrations gaps](#d6-database--migrations-gaps)
  - [D.7 SDK / API edge cases](#d7-sdk--api-edge-cases)
  - [D.8 Конкурентная среда](#d8-конкурентная-среда)
  - [D.9 Метрики бизнеса](#d9-метрики-бизнеса)
  - [D.10 Roadmap / post-launch](#d10-roadmap--post-launch)
  - [D.11 Сводка второго раунда](#d11-сводка-второго-раунда-аудита)
- [Часть E. Финальные рекомендации и план v2.1](#часть-e-финальные-рекомендации-и-план-v21)
- [Источники](#источники)

---

## Часть 0. Контекст и резюме

### Бизнес-контекст

fancai — AI-ридер с Entity Wiki и AI-иллюстрациями. В production использует:

- LLM: `google/gemini-3-flash-preview` через OpenRouter (fallback chain: claude-haiku-4.5, gemini-2.5-flash-lite)
- Image: `black-forest-labs/flux.2-klein-4b` через OpenRouter
- Backend: FastAPI 0.135.1 + Python 3.12 + PostgreSQL 17 + Redis 7.4 + Celery 5.6
- Frontend: React 19 + TypeScript 5.7 + Vite 8 + Tailwind 4
- Сервер: VPS Германия

### Решения пользователя (02.05.2026)

1. **Полная миграция** на Direct Gemini API (LLM + image)
2. Сервер уже в Германии → проблема прокси отсутствует
3. Тарифы: Free + Pro (1490 RUB/мес расчётно)
4. Pro tier: 5 полных обработок книги/мес, 50 включённых image (10 на книгу) для Entity Wiki
5. Дополнительные image — за кредиты в рублях
6. Платежи через YooKassa (или аналог)
7. Free tier полностью бесплатный, реальные лимиты определить нагрузочным тестом
8. File Search — обязательно попробовать для consistency

### Дедлайны

- **17.06.2026** — sunset Gemini 2.5 Flash + 2.5 Pro
- **24.06.2026** — sunset всех Imagen 4 (используем Nano Banana 2)
- **01.06.2026** — sunset Gemini 2.0 (не используется fancai)

### Резюме документа

Документ содержит:

1. **План v1.0** — изначальный план миграции (12 фаз, 32 рабочих дня)
2. **Аудит v1.0** — критическая ревизия плана v1.0 (топ-10 проблем)
3. **План v2.0** — консолидированный план с применёнными исправлениями (10-11 фаз, ~30 дней)
4. **Аудит v2.0** — мета-аудит на v2.0 (поиск пропущенных категорий: legal, UX, operational maturity, business metrics)
5. **План v2.1** — финальный план с учётом обоих раундов

---

## Часть A. План v1.0

### A.1 Финансовая модель (unit economics)

#### A.1.1 Базовые допущения и константы

| Константа                   | Значение    | Обоснование                      |
| --------------------------- | ----------- | -------------------------------- |
| Курс USD→RUB                | 100         | Консервативный на 02.05.2026     |
| Курсовой буфер              | +15%        | Защита от ослабления рубля       |
| Комиссия YooKassa           | 3.5%        | Тариф для физлиц/самозанятых     |
| Налог НПД (самозанятый)     | 6%          | Налог на профдоход с физ.лиц     |
| Размер средней книги        | 500K tokens | По данным fancai `llm_usage_log` |
| Images на книгу (Wiki auto) | 10          | Уточнено пользователем           |
| Книги/мес Pro               | 5           | Уточнено пользователем           |

#### A.1.2 Себестоимость одной полной обработки книги

```
LLM:
  Extraction (batch -50%):     500K input × $0.25/1M + 50K output × $1.50/1M = $0.20
  Translation (Flex -50%):                                                    ~$0.05
  Dedup + synthesis (Flex):                                                   ~$0.10
  Consistency (Flex + cache):                                                 ~$0.10
  ─────────────────────────────────────────────────────────────────────────
  LLM total:                                                                 ~$0.45-0.60

Image (10 × Nano Banana 2 batch 1K):
  10 × $0.034 = $0.34

ИТОГО:                                                                       $0.79-0.94
```

Берём **$0.94** как осторожный потолок.

#### A.1.3 Pro tier pricing (5 книг/мес, 50 включённых images)

```
Себестоимость AI (5 × $0.94):                                               $4.70
Operational overhead:                                                       $1.00
Total (USD):                                                                $5.70
× 100 (USD→RUB):                                                            570 RUB
× 1.15 (курсовой буфер):                                                    655 RUB
÷ 0.965 ÷ 0.94 (YooKassa + НПД):                                            723 RUB ← break-even
```

|     Цена/мес | После fees+tax | Маржа абс. |  Маржа % |
| -----------: | -------------: | ---------: | -------: |
|      499 RUB |            453 |       -203 |  -31% ❌ |
|      699 RUB |            634 |        -21 |   -3% ❌ |
|  **990 RUB** |            898 |       +243 |   +37% ⚠ |
| **1490 RUB** |           1352 |       +696 | +106% ✅ |
|     1990 RUB |           1805 |      +1150 |    +175% |

**Рекомендация v1.0:** 1490 RUB regular, 990 RUB первые 3 мес promo.

#### A.1.4 Кредитная модель (1 credit = 10 RUB)

| Тип                    | Себестоимость с буфером | Цена                    | Маржа |
| ---------------------- | ----------------------: | ----------------------- | ----: |
| Nano Banana 2 batch 1K |                4.31 RUB | n/a (system)            |   n/a |
| Nano Banana 2 std 1K   |                8.49 RUB | **1 кредит = 10 RUB**   |  +18% |
| Nano Banana 2 std 2K   |               12.80 RUB | **2 кредита = 20 RUB**  |  +56% |
| Nano Banana 2 std 4K   |               19.14 RUB | **3 кредита = 30 RUB**  |  +57% |
| Nano Banana Pro 1K-2K  |               16.99 RUB | **3 кредита = 30 RUB**  |  +77% |
| Nano Banana Pro 4K     |               30.43 RUB | **5 кредитов = 50 RUB** |  +64% |

**Пакеты:**

- Стартер: 50 credits = 499 RUB (10.00/credit, 0% off)
- Стандарт: 200 credits = 1860 RUB (9.30/credit, -7%)
- Макси: 500 credits = 4350 RUB (8.70/credit, -13%)
- Гига: 1500 credits = 12000 RUB (8.00/credit, -20%)

TTL credits: 12 месяцев с покупки.

#### A.1.5 Free tier лимиты (стартовые гипотезы)

- Книги/мес: 1
- Image generation: 0 (upgrade prompt)
- URL Context / Search Grounding / File Search Q&A: нет
- LLM RPM: 10
- Concurrent jobs: 1
- Daily LLM tokens budget: 200K
- Cost для fancai на 1 Free user/мес: ~94 RUB

#### A.1.6 Unit economics для проекта

```
100 users (рання стадия):    +/- 0 RUB/мес
500 users (активная):        ~17 000 RUB/мес net
2000 users (зрелая):         ~140 000 RUB/мес net

Точка безубыточности: ~150 active Pro users (при 85% Free).
```

---

### A.2 Тарифная архитектура

#### A.2.1 Free tier

```
✅ Чтение EPUB, bookmarks, annotations, заметки
✅ 1 полная обработка книги в месяц
✅ Просмотр уже сгенерированных Wiki
✅ Offline cache для прочитанных глав
❌ Image generation
❌ URL Context / Search Grounding / File Search

Server-side rate limits:
  • LLM RPM: 10
  • Concurrent jobs: 1
  • Daily LLM tokens: 200K
  • Monthly book count: 1
```

#### A.2.2 Pro tier (1490 RUB/мес)

```
✅ Всё из Free
✅ 5 полных обработок книги/мес = 50 image включено
✅ URL Context для entity (Wikipedia)
✅ Google Search Grounding
✅ File Search "Chapter Q&A" (Phase 6+)
✅ Доплата кредитами за дополнительные images
✅ Premium image (Nano Banana Pro)

Server-side rate limits:
  • LLM RPM: 60
  • Concurrent jobs: 3
  • Daily LLM tokens: 2M
  • Monthly book count: 5

Платная докупка:
  • Image regenerate: 1 credit
  • Дополнительная книга после 5/мес: 200 credits
  • 2K image: 2 credits
  • 4K image: 3 credits
  • Premium 1K-2K: 3 credits
  • Premium 4K: 5 credits
```

---

### A.3 Целевая архитектура

#### A.3.1 Service routing matrix

```
Service                          Model                          Tier      Caching      Thinking
─────────────────────────────────────────────────────────────────────────────────────────────
Entity extraction                gemini-3-flash-preview         Batch     Implicit     LOW
Description extraction           gemini-3-flash-preview         Batch     Implicit     LOW
Translation RU→EN                gemini-3.1-flash-lite-preview  Flex      Implicit     minimal
Entity dedup                     gemini-3-flash-preview         Flex      Explicit     MEDIUM
Entity synthesis                 gemini-3-flash-preview         Flex      Explicit     MEDIUM
Consistency manager              gemini-3-flash-preview         Flex      Explicit 1h  MEDIUM
File Search consistency check    File Search Tool               Std       —            —
Hard fallback                    gemini-3.1-pro-preview         Std       Explicit     MEDIUM
Image: Wiki auto-fill (10/book)  gemini-3.1-flash-image-prev    Batch     —            —
Image: regen / on-demand         gemini-3.1-flash-image-prev    Std       —            —
Image: premium (Pro)             gemini-3-pro-image-preview     Std       —            —
(Pro) URL Context                gemini-3-flash-preview         Std       Implicit     LOW
(Pro) Search Grounding           gemini-3-flash-preview         Std       Implicit     LOW
(Pro) Chapter Q&A                File Search + 3-flash          Std       Implicit     LOW
```

#### A.3.2 Backend изменения

**Замена:**

- `backend/app/core/openrouter_client.py` (736 строк) → `backend/app/core/gemini_client.py`
- `backend/app/services/imagen_generator.py` (678 строк) → `backend/app/services/nano_banana_generator.py`

**Рефакторинг:**

- `gemini_extractor.py` (1124), `entity_deduplication_service.py` (227), `entity_synthesis_service.py` (237), `consistency_manager.py` (787)
- Удалить `_inline_defs()` workaround (не нужен на Direct API)

**Новые файлы:**

- `core/gemini_client.py`, `core/gemini_pricing.py`, `core/gemini_errors.py`
- `services/nano_banana_generator.py`, `file_search_service.py`, `credit_service.py`, `quota_guard.py`, `tariff_service.py`, `yookassa_service.py`
- `models/user_credit.py`, `credit_transaction.py`, `payment.py`, `monthly_quota.py`
- `routers/credits.py`, `payments.py`, `subscriptions.py`

**Database migrations (Alembic):**

1. `user_credits` (id, user_id, balance, total_purchased, total_consumed)
2. `credit_transactions` (id, user*id, delta, reason, related_entity*\*, created_at)
3. `subscriptions` extend (tier_code, started_at, ends_at, auto_renew, provider_subscription_id)
4. `payments` (id, user_id, amount_rub, type, status, provider, provider_payment_id)
5. `monthly_quotas` (user_id, month_year, books_processed, books_quota, images_generated, last_reset_at)
6. Расширить `llm_usage_log` (service_tier, cache_mode, cached_tokens, thoughts_tokens, request_id)
7. Расширить `generated_images` (model_id, resolution, service_tier, credits_consumed, is_premium)

#### A.3.3 Frontend изменения

| Компонент                                                   | Изменение                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `Reader/DescriptionDrawer.tsx`                              | "Generate (1 credit)" / "Last image included" / "Upgrade to Pro" |
| `Reader/EntityCard.tsx`                                     | + premium toggle для Pro                                         |
| `MyBooks.tsx`                                               | "3/5 книг обработано в мае" для Pro                              |
| Новый: `Account/CreditBalance.tsx`                          | Header indicator + детали в profile                              |
| Новый: `Account/CreditPurchase.tsx`                         | 4 пакета + Pay через YooKassa                                    |
| Новый: `Account/Subscription.tsx`                           | Pro подписка / cancel / restore                                  |
| Новый: `Account/UpgradeToProModal.tsx`                      | При достижении Free лимита                                       |
| `api/credits.ts`, `api/payments.ts`, `api/subscriptions.ts` | TanStack hooks                                                   |

---

### A.4 План миграции — 12 фаз

#### Phase 0 — Infrastructure (1 день, 05.05)

GCP project, billing, API key, Spend Cap $300/мес, YooKassa registration.

**Verification:** smoke test + sandbox YooKassa payment.

#### Phase 1 — `GeminiClient` core (3 дня, 06-08.05)

Тонкий wrapper над `google-genai==1.74.0`. API: generate_text, generate_structured, generate_image, submit_batch, get_batch_results, create_cache, count_tokens.

**AIUsage:** prompt_tokens, candidates_tokens, cached_tokens, thoughts_tokens, cost_usd, cost_rub, model, service_tier, cache_mode.

**Verification:** 95% unit coverage, golden prompt set 20 примеров, 100% schema validity.

#### Phase 2 — LLM сервисы миграция (5 дней, 09-13.05)

- Day 1: gemini_extractor.py (главный)
- Day 2: dedup + synthesis
- Day 3: consistency manager (с explicit cache)
- Day 4: Shadow rollout
- Day 5: Bug fixing

**Verification:** quality metrics ≥ baseline OR, cost reconciliation ≤ 2% drift.

#### Phase 3 — Image migration (3 дня, 14-16.05)

- Day 1: nano_banana_generator.py (async batch + sync std + reference logic)
- Day 2: Quality eval (50 image × 5 entity types)
- Day 3: Frontend integration

**Verification:** quality pass rate ≥ 85%, reference consistency ≥ 80%.

#### Phase 4 — Tariff system + Credits (4 дня, 19-22.05)

- Day 1: DB migrations + backend services
- Day 2: Routers (credits, subscriptions, quota)
- Day 3: Frontend tariff UI
- Day 4: Integration

**Verification:** E2E (purchase → balance → consume), race conditions safe.

#### Phase 5 — YooKassa integration (3 дня, 23-25.05)

- Day 1: yookassa_service.py + recurring
- Day 2: Frontend payment flow
- Day 3: Idempotency + reconciliation

**Verification:** sandbox E2E, webhook idempotency 3× → 1 запись.

#### Phase 6 — File Search для consistency (3 дня, 26-28.05)

- Day 1: EPUB → Markdown converter (для File Search)
- Day 2: Consistency manager refactor
- Day 3: Cost & quality eval

**Verification:** quality ≥ baseline custom logic, cost снижение consistency-stage с ~$0.10 до ~$0.05.

#### Phase 7 — Free tier load test + калибровка (3 дня, 29.05-02.06)

50 виртуальных Free пользователей одновременно. Замеряем cost/RPM/latency/errors. Калибровка финальных лимитов.

#### Phase 8 — Cost monitoring (2 дня, 03-04.06)

Backend instrumentation + Grafana dashboards + alerts (Spend Cap thresholds).

#### Phase 9 — Reference images (2 дня, 05-06.06)

Canonical reference image на entity. Multi-character scenes (до 4 char refs).

#### Phase 10 — Production rollout (3 дня, 09-11.06)

10% → 50% → 100% with 24h soak.

#### Phase 11 — Removal OpenRouter (1 день, 12.06)

Удаление OR кода, env vars, метрик. Update docs.

#### Phase 12 — Optional Pro features (3 дня, 13-15.06 — buffer)

URL Context + Search Grounding для Pro tier.

---

### A.5 Verification & Testing strategy

**Golden eval set:**

- extraction: 25 chapters × 5 жанров
- translation: 50 entity descriptions ru→en
- dedup: 10 entity clusters
- image_generation: 20 entity descriptions × 3 types
- consistency: 5 books полный прогон

**Метрики (target vs OR baseline):**

- Entity recall ≥ 0.85
- Entity precision ≥ 0.92
- JSON Schema validity ≥ 0.99
- Translation BLEU ≥ 30
- Image visual review ≥ 0.85
- Spoiler-free guarantee: 100% (NON-NEGOTIABLE)

**Production canary:** 10% → 50% → 100% soak intervals 24h.

---

### A.6 Risks & mitigation (v1.0)

| Риск                                     | Вер.   | Impact   | Mitigation                     |
| ---------------------------------------- | ------ | -------- | ------------------------------ |
| Pydantic Field default ломает structured | Medium | High     | Pre-flight grep audit          |
| Gemini 3.x preview API change            | Medium | High     | Pin SDK 1.74.0                 |
| Rouble drops > 15%                       | Medium | High     | Auto-trigger при >115 RUB/USD  |
| Free tier abuse                          | High   | Medium   | Email verify + IP ratelimit    |
| Spend Cap mid-month                      | Low    | High     | 80%/95%/99% alerts             |
| NB2 quality regression vs FLUX           | Medium | Medium   | Phase 3 quality eval           |
| Reference images не consistent           | Medium | Low      | UX regenerate button           |
| Batch job stuck >24h                     | Low    | High     | Polling timeout 25h            |
| YooKassa webhook missed                  | Medium | High     | Daily reconciliation           |
| Recurring payment fails                  | High   | Medium   | Email + grace period 7 дней    |
| Google deprecates 3-flash-preview        | Low    | High     | Migration roadmap watch        |
| File Search не surfaces old entities     | Medium | Medium   | Quality eval + custom fallback |
| RUR→USD conversion (sanctions)           | Low    | Critical | Open question                  |

---

### A.7 Timeline

```
Week 1 (5-9 мая):       Phase 0, 1, начало 2
Week 2 (12-16 мая):     Phase 2 завершение, Phase 3 начало
Week 3 (19-23 мая):     Phase 3, 4
Week 4 (26-30 мая):     Phase 4, 5, 6 начало
Week 5 (2-6 июня):      Phase 6, 7
Week 6 (9-13 июня):     Phase 8, 9, 10
Week 7 (16-20 июня):    Phase 10 завершение, Phase 11, опц. 12

🟢 17 июня — Gemini 2.5 Flash sunset. Должны быть на 3.x ✅
```

**Total:** ~32 рабочих дня. Запас: 1-2 дня. Высокий риск slippage.

---

### A.8 Open questions

1. Юрстатус — самозанятый, ИП, ООО?
2. 18+ маркировка для книг с violence/sex
3. YooKassa documents для активации
4. RUR→USD конвертация для оплаты Google
5. Subscription cancellation: refund или прорейт?
6. Acquisition discount 990 RUB первые 3 мес — нужен?
7. Premium tier — отдельная Ultimate подписка или только credits?
8. Use it or lose it vs carry-over для месячной квоты?

---

## Часть B. Критический аудит плана v1.0

### B.1 Финансовая модель — ошибки и риски

#### 🔴 КРИТИЧНО B.1.1 — Курсовой буфер 15% недостаточен

Расчёт буфера +15% соответствует 100→115 RUB/USD. За последние 24 месяца рубль колебался от 75 до 110 (47% range). При 130 RUB/USD: cost Pro user = $5.70 × 130 = 741 RUB; +15% буфер = 852 RUB; min break-even = 940 RUB. Цена 990 RUB → margin ниже +5%. **Стратегически убыточно.**

**Recommendation:** установить буфер +30-40% или dynamic pricing.

#### 🔴 КРИТИЧНО B.1.2 — Себестоимость книги занижена

$0.94/book — best case (все три discount-механики одновременно). Реальные сценарии:

- First-time user: nothing to cache → +50%
- Quality regen
- Long books (>1M tokens, >200K threshold)
- Failed batch jobs

**Realistic:** average $1.20-1.50; worst $2.00.

**Impact:** при $1.50/book × 5 = $7.50/мес AI cost; min break-even сдвигается до **~960 RUB**. Цена 990 RUB → margin +4%. Опасно.

**Recommendation:** $1.50 baseline, 1490 RUB как минимальная цена.

#### 🟡 СРЕДНЕ B.1.3 — Operational overhead $1/user заниженный

$1/user предполагает 100+ Pro users. Но 0-50 users → ~$5/user/мес overhead → негативная маржа в первые месяцы.

**Recommendation:** документировать "burn rate" 6 месяцев. Если <50 Pro users в Q1 → пересмотр.

#### 🟡 СРЕДНЕ B.1.4 — НПД cap 2.4M RUB/год

Самозанятый: 2.4 млн RUB/год лимит. При 1490 RUB × 135-140 users + кредиты — переход в ИП на УСН 6%.

**Recommendation:** сразу регистрировать ИП на УСН.

#### 🔴 КРИТИЧНО B.1.5 — Недокументирован YooKassa hold

YooKassa hold 3 рабочих дня. Cashflow gap при непрерывных расходах Google.

**Расчёт:**

- 100 Pro × 1490 RUB = 149 000 RUB/мес revenue
- Hold 3 дня = ~14 900 RUB заморожены
- Расходы: 100 × 655 = 65 500 RUB/мес = ~2 200 RUB/день

**Recommendation:** working capital ≥ 300 000 RUB. Или Google prepay (поддерживается с 2026-03-23).

#### 🟡 СРЕДНЕ B.1.6 — Кредитный пак "Стартер" margin issue

При 1 image = 1 credit = 10 RUB cost std 1K = 8.49 RUB → margin +18%. После курсовых колебаний — **отрицательная маржа** при курсе >110 RUB/USD.

**Recommendation:** **cost std 1K = 2 кредита**, минимальный pack 100 credits.

---

### B.2 Архитектурные проблемы

#### 🔴 КРИТИЧНО B.2.1 — Shadow mode Phase 2 не описан

"Параллельный shadow run" — но не указано: кто платит за оба провайдера? Как разрешать расхождения? 2× cost during 1 неделю.

**Recommendation:** scope shadow ≤ 5 books × 1 prompt set, ≤ $50.

#### 🔴 КРИТИЧНО B.2.2 — Race conditions в credits

Не описана защита:

- 2 одновременных generate → один заблокирует, второй timeout
- Concurrent purchase + consume → недетерминистичный balance
- DB-failover during transaction → potential double-charge

**Recommendation:** idempotency keys на consume (transaction_id deduplication), Postgres advisory locks. Chaos engineering tests.

#### 🟡 СРЕДНЕ B.2.3 — File Search в Phase 6 на критическом пути

3 дня на конвертер + refactor (787 строк) + quality eval — мало.

**Recommendation:** понизить File Search в P1 (после core), POC research (1д) → GO/NO-GO.

#### 🟡 СРЕДНЕ B.2.4 — Schema migrations risk

7 migrations + SQLAlchemy `lazy="raise"` + concurrent active sessions = risk.

**Recommendation:** все new columns nullable=True или server_default. Cron reset под distributed lock.

#### 🔴 КРИТИЧНО B.2.5 — Spend Cap mid-month hit not handled

При 99% Cap reached: что с активными jobs? User видит "service unavailable"?

**Recommendation:**

- 90% — pause Free tier auto-throttle
- 95% — pause new Pro requests
- 100% — graceful "service degraded" UI, read-only mode
- - manual procedure: как поднять Cap за 5 минут

#### 🟡 СРЕДНЕ B.2.6 — Reference images storage growth

100 books × 30 entities × 200KB = 600MB. Без TTL/S3 — забьёт VPS disk.

**Recommendation:** S3-compatible object storage (Hetzner Storage Box, Cloudflare R2).

---

### B.3 Security audit

#### 🔴 КРИТИЧНО B.3.1 — YooKassa webhook signature verification

План говорит "проверка signature" без деталей. Подделанный webhook → атакующий добавляет credits.

**Recommendation:** official YooKassa SDK; idempotency key UNIQUE constraint; replay window ≤5 минут.

#### 🔴 КРИТИЧНО B.3.2 — Credit consumption — нет rate limit

Pro user с 500 credits может за минуту 500 generate-requests → Spend Cap, RPM cap, DDoS-like effect.

**Recommendation:** per-user 60 RPM regardless of balance; per-project burst protection.

#### 🟡 СРЕДНЕ B.3.3 — PCI compliance

YooKassa hosted form = SAQ-A scope. Recurring через токены, не raw card data.

**Recommendation:** документировать в security policy.

#### 🟡 СРЕДНЕ B.3.4 — API key для Google в production

Backup, rotation, multiple keys для zero-downtime rotation.

**Recommendation:** Vault/SOPS, rotation 90 дней, 2 active keys.

#### 🟡 СРЕДНЕ B.3.5 — Free tier abuse через Tor / VPN

Email verification (already proposed), browser fingerprint (FingerprintJS), phone verification опц.

---

### B.4 Timeline риски

#### 🔴 КРИТИЧНО B.4.1 — Запас 1-2 дня недостаточен

32 рабочих дня на 33-дневное окно. Slippage 20-40% = 42 дней realistic. **Дефицит 9 дней.**

**Recommendation (выбрать ОДНО):**

1. Сократить scope: убрать Phase 6, 9, 12 — это P1/P2
2. Параллелизовать (если есть второй разработчик)
3. Перенести deadline (real deadline = пока OR не отключит google models)

#### 🟡 СРЕДНЕ B.4.2 — Phase 5 (YooKassa) underestimated

3 дня — оптимистично. Регистрация YooKassa требует 1-2 недели документов.

**Recommendation:** YooKassa onboarding в Phase 0 параллельно. Phase 5 → 5 дней.

#### 🟡 СРЕДНЕ B.4.3 — Phase 7 (load test) на критическом пути

Reverse causality: load test показывает что 1 book/мес для Free слишком дорого → нужны изменения в Phase 4.

**Recommendation:** перенести Phase 7 раньше (после Phase 2, до Phase 4).

---

### B.5 Verification gaps

#### 🟡 СРЕДНЕ B.5.1 — Baseline OR не зафиксирован

"Quality ≥ baseline OR" — но baseline не measured.

**Recommendation:** Phase −1: snapshot recall/precision/cost на OR.

#### 🟡 СРЕДНЕ B.5.2 — Spoiler-free testing не описан

Это NON-NEGOTIABLE функциональность fancai.

**Recommendation:** 5 books × 3 spoiler entities (известные late reveals); CI test блокирует deploy если fail.

#### 🟡 СРЕДНЕ B.5.3 — Cost reconciliation не определён

Daily cron: aggregate usage_metadata vs Google Cloud Billing API. Drift > 5% alert; > 10% block requests.

---

### B.6 Missing scope

#### 🔴 КРИТИЧНО B.6.1 — Migration существующих images

В production уже есть FLUX images. Plan only addresses new.

**Recommendation:** keep existing FLUX images; new on Nano Banana 2; UI opt-in regen "Use new model" per image (за 1 credit).

#### 🟡 СРЕДНЕ B.6.2 — Грейс-период при cancel

"Access до end of paid period; credits сохраняются 12 мес TTL; unspent quota сгорает".

#### 🟡 СРЕДНЕ B.6.3 — Refund policy

ЗоЗПП РФ: 14 дней право отказа.

**Recommendation:**

- Subscription: 14 дней full refund (если не использовал ничего сверх Free лимитов)
- Credits: только полный неиспользованный пак
- Manual review для частичных

#### 🔴 КРИТИЧНО B.6.4 — Onboarding flow

План не описывает.

**Recommendation:** Phase 4.5 (1 день): splash, tutorial, upgrade prompt после value experience, email drip campaign.

---

### B.7 Сводка аудита — топ-рекомендаций

| #   | Изменение                               | Phase  | Impact                  |
| --- | --------------------------------------- | ------ | ----------------------- |
| 1   | Курсовой буфер 30-40%                   | A.1    | Финансовая устойчивость |
| 2   | Pro = 1490 RUB regular                  | A.1.3  | Реалистичная маржа      |
| 3   | $1.50/book baseline                     | A.1.2  | Безопаснее              |
| 4   | YooKassa onboarding в Phase 0           | A.4 P5 | Не блокирует            |
| 5   | Сократить P0 scope (убрать P6, P9, P12) | A.7    | Запас 9 дней            |
| 6   | Phase 7 раньше (до Phase 4)             | A.4    | Реальная calibration    |
| 7   | Spend Cap эскалация                     | A.6    | Не падать               |
| 8   | Idempotency + advisory locks            | B.2.2  | Race safety             |
| 9   | S3 для reference images                 | B.2.6  | Disk space              |
| 10  | Baseline measurement OR                 | B.5.1  | Точная оценка           |

#### Reduced-scope план (target ~30 рабочих дней vs 32)

```
Phase 0:  Infrastructure + YooKassa onboarding parallel (1д)
Phase −1: Baseline measurement (0.5д)
Phase 1:  GeminiClient core (3д)
Phase 2:  LLM migration (5д)
Phase 3:  Image migration (3д)
Phase 4:  Tariff Free/Pro + Credits (4д)
Phase 5:  YooKassa integration (5д) ← realistic
Phase 7:  Free tier load test (3д) ← раньше
Phase 8:  Cost monitoring (2д)
Phase 10: Production rollout (3д)
Phase 11: OR removal (1д)

Total: 30.5 дней + buffer 2.5 дня = 33 дня = ровно дедлайн.
P6 (File Search), P9 (Reference), P12 (URL Context) — post-launch P1.
```

#### Финансовая модель v2.0

| Параметр            | До        | После           |
| ------------------- | --------- | --------------- |
| Курсовой буфер      | +15%      | **+30%**        |
| Cost per book       | $0.94     | **$1.50**       |
| Pro min break-even  | 723 RUB   | **~1100 RUB**   |
| Pro recommended     | 990 RUB   | **1490 RUB**    |
| Credit unit         | 10 RUB    | 10 RUB ✅       |
| Cost std 1K         | 1 credit  | **2 credits**   |
| Pro book quota      | 5/мес     | 5/мес ✅        |
| Min working capital | не указан | **300 000 RUB** |

---

## Часть C. План v2.0 (консолидированный)

> Применены 10 топ-рекомендаций аудита v1.0. Reduced scope, увеличенные финансовые буферы.

### C.1 Финансовая модель v2.0

#### Константы

| Константа              | Значение               |
| ---------------------- | ---------------------- |
| Курс USD→RUB           | 100                    |
| Курсовой буфер         | **+30%** (было +15%)   |
| Комиссия YooKassa      | 3.5%                   |
| Налог НПД (или УСН-6%) | 6%                     |
| Cost per book baseline | **$1.50** (было $0.94) |
| Min working capital    | **300 000 RUB**        |

#### Себестоимость пересчитана

```
Cost per book (realistic): $1.50
× 5 books/Pro user = $7.50/мес
+ Operational $1
= $8.50/Pro user × 100 (USD→RUB) = 850 RUB
× 1.30 (буфер) = 1105 RUB
÷ 0.965 ÷ 0.94 = ~1220 RUB ← min break-even
```

#### Pro pricing v2.0

| Цена         | After fees+tax | Маржа       | Вердикт      |
| ------------ | -------------- | ----------- | ------------ |
| 990 RUB      | 898            | -322 (-26%) | ❌ Убыток    |
| **1490 RUB** | 1352           | +132 (+12%) | ⚠ Тонкая     |
| **1990 RUB** | 1805           | +585 (+53%) | ✅ Безопасно |

**Решение v2.0:** 1490 RUB — minimum, с риском маржи. **1990 RUB** — оптимально для устойчивости, требует value justification.

**Финальная рекомендация:** **1490 RUB regular** (реалистично для рынка), с обязательным monitoring курса и pricing review раз в квартал.

#### Кредитная модель v2.0

| Тип                   | Cost (с +30% буфером) | Цена                    | Маржа после fees+tax |
| --------------------- | --------------------: | ----------------------- | -------------------: |
| Nano Banana 2 std 1K  |              9.55 RUB | **2 кредита = 20 RUB**  |              +91% ✅ |
| Nano Banana 2 std 2K  |             14.40 RUB | **3 кредита = 30 RUB**  |              +91% ✅ |
| Nano Banana 2 std 4K  |             21.55 RUB | **4 кредита = 40 RUB**  |                 +70% |
| Nano Banana Pro 1K-2K |             19.10 RUB | **3 кредита = 30 RUB**  |                 +44% |
| Nano Banana Pro 4K    |             34.20 RUB | **5 кредитов = 50 RUB** |                 +34% |

#### Пакеты (минимум 100 credits)

- Mini: 100 credits = 990 RUB (9.90/credit, 0% off)
- Standard: 300 credits = 2790 RUB (9.30/credit, -7%)
- Maxi: 700 credits = 6090 RUB (8.70/credit, -13%)
- Giga: 2000 credits = 16000 RUB (8.00/credit, -20%)

### C.2 Тарифы v2.0 (без изменений)

Free: 1 book/мес. Pro: 5 books/мес + 50 included images. Lockdown unchanged.

### C.3 12-фазный план → 11-фазный план v2.0 (reduced scope)

```
Phase 0   Infrastructure + YooKassa onboarding (1д) ← parallel
Phase −1  Baseline measurement OR (0.5д)
Phase 1   GeminiClient core (3д)
Phase 2   LLM migration (5д) + shadow scope ≤$50
Phase 3   Image migration (3д)
Phase 7   Free tier load test (3д) ← перенесено раньше
Phase 4   Tariff Free/Pro + Credits + Onboarding (4.5д)
Phase 5   YooKassa integration (5д) ← realistic
Phase 8   Cost monitoring + Spend Cap escalation (2д)
Phase 10  Production rollout 10→50→100% (3д)
Phase 11  OR removal (1д)

Total: 30 рабочих дней + 3 дня buffer = 33 дня.

POSTPONED to post-launch P1:
  • Phase 6: File Search для consistency
  • Phase 9: Reference images
  • Phase 12: URL Context + Search Grounding
```

### C.4 Risks updated

Добавлены mitigations из B.1-B.6:

- Курсовой буфер +30%
- Spend Cap escalation procedure (90/95/99/100%)
- Idempotency keys + Postgres advisory locks для credits
- 300K RUB working capital
- S3 для reference images
- Onboarding flow + 14-дневный refund policy
- Migration FLUX images: keep + opt-in regen

---

## Часть D. Аудит v2.0 (мета-аудит)

> Цель: найти пробелы первого аудита. Категории: legal, UX edge cases, operational maturity, business metrics, performance regressions.

### D.1 Compliance / Legal

#### 🔴 КРИТИЧНО D.1.1 — 242-ФЗ "О локализации персональных данных"

**Проблема:** 242-ФЗ требует, чтобы PII граждан РФ изначально записывались, систематизировались и хранились на серверах в России. Сервер fancai в **Германии** — нарушение.

**fancai обрабатывает как PII:**

- Email пользователя (явно PII)
- ФИО (если указано)
- Книжная коллекция, прогресс чтения (поведенческие → PII)
- Заметки, аннотации, bookmarks

**Штраф:** до 18 млн RUB для юрлиц/ИП за повторное нарушение.

**Реальность правоприменения:** RKN преследует крупные сервисы. Малые проекты редко проверяются, но риск растёт с audience.

**Recommendation:**

- Краткосрочно: документировать в Privacy Policy интент перенести primary storage в РФ при росте audience
- Среднесрочно: репликация critical PII (email, profile) на РФ-сервер (Yandex Cloud / Selectel) — primary в РФ, working copy в Германии
- Долгосрочно: full migration to RU infrastructure если revenue из РФ > 50%

#### 🔴 КРИТИЧНО D.1.2 — 54-ФЗ "Об онлайн-кассах"

**Проблема:** Закон требует выдачу фискального чека покупателю физлицу. YooKassa не интегрирована автоматически с ОФД для самозанятых.

**Варианты:**

1. **YooKassa с фискализацией** ("Касса YooKassa"): от 1900 RUB/мес или процент с оборота
2. **Самозанятый чеки через "Мой налог"**: API ФНС "Мой налог" есть, можно автоматизировать
3. **ИП с онлайн-кассой**: Атол / Эвотор от 2000 RUB/мес

**Recommendation:** для самозанятого — интеграция с **API "Мой налог"** (Phase 5.5: ОФД integration, ~2 дня).

#### 🟡 СРЕДНЕ D.1.3 — 152-ФЗ обязательная регистрация

Закон требует уведомления оператора PII в РКН перед началом обработки.

**Recommendation:** Phase 0 включить подачу уведомления через [pd.rkn.gov.ru](https://pd.rkn.gov.ru/) (1 день). Privacy Policy + Cookie Policy + Согласие на обработку.

#### 🟡 СРЕДНЕ D.1.4 — Возрастные ограничения 18+

436-ФЗ требует маркировки. Default safety threshold = OFF в Gemini → может generate explicit content.

**Recommendation:** возрастная самопроверка при регистрации. Маркировка 18+ для отдельных книг. Settings "Family mode" → BLOCK_LOW_AND_ABOVE.

---

### D.2 UX edge cases

#### 🔴 КРИТИЧНО D.2.1 — Subscription mid-month cancellation

**Пропущенные сценарии:**

- Cancel 5-го: access до конца оплаченного периода → может ли использовать оставшиеся 2 книги?
- Downgrade Pro → Free: что с 50 неиспользованными credits?

**Recommendation:**

- Cancel = доступ до end of paid period + квота месяца сохраняется
- Credits сохраняются 12 мес TTL независимо от tier
- Downgrade: credits остаются, image generation возможна **только если есть credits**
- UI: чёткие messages "After cancellation, you keep access until X"

#### 🟡 СРЕДНЕ D.2.2 — Multi-device sync

Pro user на phone генерирует image → balance уменьшается. Browser → sync. Delay → 422 stale.

**Recommendation:** backend source of truth, frontend optimistic update + reconciliation. WebSocket / SSE опционально, или TanStack `staleTime: 0` + invalidation после consume.

#### 🟡 СРЕДНЕ D.2.3 — Long-running batch UX

Batch до 24 часов. План не описывает прогресс / уведомления.

**Recommendation:**

- Progress indicator на My Books
- Push notification (PWA) при завершении
- Email backup notification

#### 🟡 СРЕДНЕ D.2.4 — Onboarding & free trial

Без правильного onboarding conversion будет 0-2%.

**Recommendation:**

- **Free trial 7 дней Pro** (с card-on-file, auto-charge if not cancelled)
- Email drip campaign (SendGrid/Mailgun/Postmark)
- Empty state в Entity Wiki = teaser image generations
- Splash screen для first-time users
- Tutorial для Entity Wiki (1 mock book demo)
- Upgrade prompt после 1-2 successful Wiki interactions

---

### D.3 Operational maturity

#### 🔴 КРИТИЧНО D.3.1 — Disaster Recovery (DR) plan

Что если VPS Германия падает?

**План молчит про:**

- Backup стратегия для new tables (user_credits, payments) — RPO/RTO?
- Restore procedure
- Failover

**Recommendation:**

- Daily PostgreSQL backup → S3-compatible (Hetzner Storage Box / AWS S3 Frankfurt)
- Backup credits/payments: weekly restore test (cron сравнивает md5)
- DR runbook (1 страница): "Что делать если VPS down"
- RTO: 4 часа, RPO: 24 часа

#### 🔴 КРИТИЧНО D.3.2 — Customer support tooling

План не описывает admin panel для:

- Refund запрос
- Compensation credits
- Manual cancel subscription
- Profile view для поддержки

**Recommendation:** Phase 4.5 — admin endpoints:

- `GET /admin/users/{id}` — full profile + credit history + sub state
- `POST /admin/users/{id}/credits` — add/subtract с reason
- `POST /admin/payments/{id}/refund` — initiate refund
- `POST /admin/users/{id}/subscription/cancel` — manual

AdminDashboard в frontend (placeholder уже есть в `AdminDashboardEnhanced.tsx`).

#### 🟡 СРЕДНЕ D.3.3 — Transactional email infrastructure

План не упоминает SendGrid/Postmark/Mailgun. Без email:

- User не получает receipt после оплаты (закон требует)
- Subscription expiring notifications
- Welcome email
- Password reset

**Recommendation:** Phase 4 расширить — integration с Postmark или SendGrid (~$10-20/мес). Templates: welcome, payment success, sub expiring, payment failed, refund processed. Backend: email_service.py + Jinja2 templates.

#### 🟡 СРЕДНЕ D.3.4 — Logging volume + rotation

Расширение `llm_usage_log` колонками + log every gemini call:

- 100 active Pro × 5 books × 50 chunks × 5 calls = 125,000 records/мес
- ~500 байт/record = 60 MB/мес → 720 MB/год
- - Free + dedup + synthesis = 2-3× → 2-3 GB/год

**Recommendation:**

- Partitioning `llm_usage_log` по месяцам (PostgreSQL native)
- Retention: detail 90 дней, aggregated daily summary навсегда
- Daily aggregation cron в `daily_cost_summary` table

#### 🟡 СРЕДНЕ D.3.5 — DB connection pool под batch

Batch jobs concurrent + 10 users одновременно → exhaustion pool.

**Recommendation:**

- Audit `app/core/database.py` pool size (default 5+10)
- Production: pool_size=20, max_overflow=20
- Async session pattern strictly (no leaks)
- PgBouncer перед PostgreSQL опционально (transaction-level pooling)

---

### D.4 Quality & Testing gaps

#### 🔴 КРИТИЧНО D.4.1 — Russian-language quality regression risk

Direct Gemini может вести себя по-другому с русским чем тот же Gemini через OR. Возможные регрессии:

- Транслитерация (Гарри → Garry vs Harry)
- Сохранение ё/е (Лев → Lev vs Lyov)
- Падежи в descriptions
- Native text rendering Nano Banana 2 для кириллицы

**Recommendation:**

- Phase 1 verification расширить: golden set 25 chapters **из русской fiction**
- Specific tests:
  - Имена Шерлок Холмс / Гарри Поттер / Мастер и Маргарита
  - Cyrillic в image: prompt "портрет Печорина с табличкой 'Печорин'"
- Manual review native russian speaker — критично

#### 🟡 СРЕДНЕ D.4.2 — A/B testing infrastructure

План не описывает A/B для pricing, onboarding, modals.

**Recommendation:**

- В первой версии — single price; ждать ≥100 conversions для signal
- Если product growth → Posthog / GrowthBook (free tier)

#### 🟡 СРЕДНЕ D.4.3 — Spoiler-free regression tests

В первом аудите B.5.2 отметил, расширим:

**Recommendation:**

- Curated test set: 5 books × 3 spoiler entities (известные late-book reveals)
- Consistency check на главе 1 → spoiler entities **должны отсутствовать**
- Регрессионный тест в CI: блокирует deploy если fail

#### 🟡 СРЕДНЕ D.4.4 — Performance regression vs OR

OR has provider failover → user не feels провайдер medium. Direct Gemini single route.

**Recommendation:**

- Phase −1 baseline: snapshot latency p50/p95 на OR
- Phase 2 acceptance: p95 latency ≤ 1.3× OR baseline
- Если хуже → non-critical вызовы на Flex tier

---

### D.5 Performance edge cases

#### 🟡 СРЕДНЕ D.5.1 — countTokens preflight overhead

countTokens — network call, latency 50-100ms на каждый запрос.

**Recommendation:**

- Использовать только для **первого** запроса в session (cache)
- tiktoken-like локальная оценка для quick check
- Или: post-flight enforcement (после fact, blocking next if over)

#### 🟡 СРЕДНЕ D.5.2 — Frontend bundle growth

Phase 4 + 5 новых компонентов = 50-100 KB additional.

**Recommendation:**

- Lazy-load (React Suspense) для credit/payment routes
- Bundle analyzer (vite-bundle-visualizer) после Phase 4
- Target: <600 KB gzipped main bundle

---

### D.6 Database & migrations gaps

#### 🔴 КРИТИЧНО D.6.1 — Schema migrations конкретные риски

Phase 4 = 7 migrations на live production.

**Pre-existing risks:**

- `subscriptions` extend: existing Pro users могут потерять данные если default не указан
- `monthly_quotas`: при добавлении первой записи — какой start?
- Concurrent migration + active book parsing → row lock + deadlock
- Failed migration → DB в half-applied state

**Recommendation:**

- Каждая migration с rollback path tested
- Rehearse migrations на staging clone of prod
- Maintenance window 30 минут (read-only, no writes)
- Все new columns с `server_default` (не client-side)
- `monthly_quotas` populate данными из существующего usage history через data migration

#### 🟡 СРЕДНЕ D.6.2 — Backup стратегия для new tables

`payments` + `credit_transactions` критичны. План не выделяет.

**Recommendation:**

- 3-2-1 backup: 3 копии, 2 разных носителя, 1 off-site
- Hourly WAL archiving для PITR
- Test restore раз в неделю

---

### D.7 SDK / API edge cases

#### 🟡 СРЕДНЕ D.7.1 — `google-genai` 1.74 specific issues

План не упоминает known issues. API stability preview models, `client.aio` namespace coverage не 100%.

**Recommendation:**

- При начале Phase 1: read CHANGELOG.md (1.66 → 1.74)
- Pin SDK version (не `~=` или `>=`)
- Smoke test для всех async methods

#### 🟡 СРЕДНЕ D.7.2 — Batch API timeout handling

Edge cases:

- User отменяет book processing → backend должен отменить batch
- Batch partial fail (50/100 succeeded) — что с unsuccessful?
- Batch stuck в "PENDING" forever → нужен timeout

**Recommendation:**

- Batch poll с timeout 25h, force-cancel + fallback to Standard
- API endpoint cancel: `client.aio.batches.cancel(batch_id)` (verify SDK)
- Logging каждое state transition

#### 🟡 СРЕДНЕ D.7.3 — Cache lifecycle management

Explicit caches имеют storage cost + TTL. План не описывает cleanup.

**Recommendation:**

- Cleanup cron (раз в час): list_caches → delete если age >1 day и не used last 1h
- Per-book cache lifecycle: created on parse start, deleted on complete
- Monitoring: cache_storage_dollars_total в Prometheus

---

### D.8 Конкурентная среда

#### 🟡 СРЕДНЕ D.8.1 — Конкуренты в РФ

План не анализирует.

**Recommendation:** Quick competitive analysis (1 день, в Phase −1):

- LiteRes / MyBook / Bookmate — есть ли AI features?
- Зарубежные: Readwise, Bookend.ai, Polywords
- USP fancai = Entity Wiki (spoiler-free) — главное преимущество

#### 🟡 СРЕДНЕ D.8.2 — Pricing test

1490 RUB высоковато для российского discretionary spending.

- Кинопоиск Premium: 399 RUB (включая music, video)
- Премиум-подписки в РФ rare >1000 RUB

**Recommendation:**

- Strategy 1: positioning "professional tool" → платежеспособная аудитория
- Strategy 2: introductory 690 RUB первые 6 мес, поднять после PMF
- Strategy 3: monthly = 1490, annual = 12000 (~1000/мес) для commitment

---

### D.9 Метрики бизнеса

#### 🔴 КРИТИЧНО D.9.1 — Product analytics не описаны

План tech-heavy. Что измерять:

- Free → Pro conversion rate (cohort)
- Pro retention (M1, M3, M6)
- ARPU, LTV, CAC
- Image generation rate per user
- Drop-off в onboarding funnel

**Recommendation:**

- Minimum: PostgreSQL view + admin dashboard
- - opt-in Posthog (free tier 1M events)
- Phase 8 extension: Business Metrics dashboard

#### 🟡 СРЕДНЕ D.9.2 — Northstar metric не определён

**Recommendation:**

- **Candidate:** "Books fully parsed by Pro users / week"
- **Secondary:** "Entity images generated / week"
- Track в weekly report

---

### D.10 Roadmap / post-launch

#### 🟡 СРЕДНЕ D.10.1 — Что после Phase 12?

План ends на Phase 12. Но миграция — start, не финиш.

**Recommendation:** Документировать post-launch roadmap:

- Q3 2026: post-migration optimization, F-tier calibration tweaks, File Search migration (postponed P6), Reference images (postponed P9)
- Q4 2026: URL Context + Search Grounding (postponed P12)
- Q1 2027: mobile app native (если PWA не справляется)
- Q2 2027: i18n / English market

#### 🟡 СРЕДНЕ D.10.2 — Future model migration framework

Google deprecates models раз в 6-12 месяцев.

**Recommendation:**

- Phase 1 (GeminiClient): model_id как config, не hardcoded. Lookup table model → pricing
- Phase 8 (monitoring): alert if model approaches deprecation
- Post-launch Phase 13: regular model audit, swap on deprecation

---

### D.11 Сводка второго раунда аудита

#### Newly identified critical issues

| #     | Issue                               | Category    | Impact           |
| ----- | ----------------------------------- | ----------- | ---------------- |
| D.1.1 | 242-ФЗ нарушение (PII в Германии)   | Legal       | до 18M RUB штраф |
| D.1.2 | 54-ФЗ фискальные чеки               | Legal       | админ. штрафы    |
| D.2.1 | Subscription cancellation flow      | UX          | refund disputes  |
| D.3.1 | DR plan отсутствует                 | Operational | data loss        |
| D.3.2 | Customer support tooling            | Operational | manual workload  |
| D.4.1 | Russian language quality regression | Quality     | user experience  |
| D.6.1 | Schema migrations live data         | DB          | data corruption  |
| D.9.1 | Product analytics не описаны        | Business    | blind decisions  |

#### Newly identified medium issues

| #      | Issue                         |
| ------ | ----------------------------- |
| D.1.3  | 152-ФЗ регистрация в РКН      |
| D.1.4  | Возрастные ограничения        |
| D.2.2  | Multi-device sync credits     |
| D.2.3  | Long-running batch UX         |
| D.2.4  | Onboarding & free trial       |
| D.3.3  | Transactional email           |
| D.3.4  | Logging volume                |
| D.3.5  | DB connection pool            |
| D.4.2  | A/B testing                   |
| D.4.3  | Spoiler-free regression tests |
| D.4.4  | Latency baseline              |
| D.5.1  | countTokens overhead          |
| D.5.2  | Frontend bundle               |
| D.6.2  | Backup strategy               |
| D.7.1  | SDK 1.74 issues               |
| D.7.2  | Batch timeout                 |
| D.7.3  | Cache lifecycle               |
| D.8.1  | Competitive analysis          |
| D.8.2  | Pricing test                  |
| D.9.2  | Northstar metric              |
| D.10.1 | Post-launch roadmap           |
| D.10.2 | Future model migration        |

---

## Часть E. Финальные рекомендации и план v2.1

### E.1 Категоризация всех 30+ findings обоих аудитов

```
🔴 КРИТИЧНО (must-have перед запуском):
  Финансы: курсовой буфер 30%, $1.50/book, 300K RUB working capital,
           1 credit ≠ 1 image для std (теперь 2 credits)
  Архитектура: shadow scope, race conditions credits, Spend Cap escalation
  Security: YooKassa signature SDK, credit rate limit
  Timeline: scope reduction (P6/P9/P12 → post-launch)
  Missing: migration FLUX images, onboarding flow
  Legal: 152-ФЗ регистрация, 54-ФЗ фискальные чеки (упрощённый — самозанятый "Мой налог" API)
  UX: subscription cancellation flow
  Operational: DR plan + backups, customer support admin tools
  Quality: Russian language regression tests, baseline OR
  DB: schema migrations rehearsal на staging
  Business: minimum product analytics

🟡 СРЕДНЕ (should-have в первые 3 мес):
  Compliance: 242-ФЗ долгосрочный план (репликация PII в РФ)
  UX: long-running batch UX, multi-device sync, free trial
  Operational: transactional email, logging partitioning, DB pool
  Quality: A/B testing infrastructure, spoiler-free regression CI
  Performance: countTokens overhead, frontend bundle
  SDK: cache lifecycle management
  Business: northstar metric, competitive analysis
  Roadmap: post-launch + future model migration framework

⚪ NICE-TO-HAVE (post-launch):
  File Search для consistency
  Reference images character consistency
  URL Context + Search Grounding (Pro features)
  Northstar dashboard automation
  Posthog product events
  Mobile app native
```

### E.2 Финальный план v2.1 (12 фаз с учётом обоих аудитов)

```
Phase 0   Infrastructure (1д)
          + GCP project + billing + Spend Cap $300
          + YooKassa onboarding (start; параллельно)
          + 152-ФЗ уведомление в РКН
          + Privacy Policy / ToS / Cookie Policy update

Phase −1  Baseline + competitive analysis (1.5д)
          + Snapshot recall/precision/cost/latency на OR (5 books)
          + Quick competitive overview (LiteRes, MyBook, Readwise)
          + Pydantic Field(default=...) audit grep

Phase 1   GeminiClient core (3д)
          + Pin SDK 1.74.0
          + Read CHANGELOG 1.66→1.74 (известные issues)
          + model_id как config
          + Lookup table model → pricing (для будущей migration)

Phase 2   LLM migration (5д)
          + Russian-language golden set 25 chapters
          + Spoiler-free regression test
          + Latency baseline check (≤1.3× OR)
          + Shadow scope ≤$50

Phase 3   Image migration (3д)
          + Cyrillic native text rendering test
          + Migration FLUX images: keep + opt-in regen UI
          + Reference images storage → S3 (Hetzner Storage Box)

Phase 7   Free tier load test (3д) ← перенесено раньше
          + 50 virtual users
          + Calibrate Free лимиты (1 book/мес?)
          + Document financial implications

Phase 4+5 Tariff + Credits + YooKassa (combined, 8д)
          + Tariff Free/Pro
          + Credits с idempotency keys + advisory locks
          + YooKassa SDK + recurring + webhook signature
          + 54-ФЗ "Мой налог" API integration (для самозанятого)
          + Subscription cancellation flow (UI + backend)
          + Refund policy 14 дней
          + Onboarding flow + 7-дневный free trial
          + Transactional email (Postmark/SendGrid)
          + Customer support admin endpoints + AdminDashboard
          + Migration scripts с rollback + staging rehearsal

Phase 8   Cost monitoring + observability (2д)
          + Spend Cap escalation 90/95/99/100%
          + Logging partitioning по месяцам + retention 90д
          + DR runbook + backup test
          + Northstar dashboard
          + Daily cost reconciliation cron

Phase 10  Production rollout (3д)
          10% → 50% → 100% with 24h soak
          + Maintenance window для DB migration
          + Watch: errors, latency, cost, conversion

Phase 11  OR removal (1д)
          + Code cleanup
          + Docs update

Total: 30.5 рабочих дней + 2.5 дня buffer = 33 дня. Дедлайн 17.06.

POSTPONED to post-launch P1 (Q3 2026):
  • File Search для consistency
  • Reference images
  • URL Context + Search Grounding
  • 242-ФЗ долгосрочный план (репликация PII в РФ)
  • A/B testing infrastructure
  • Posthog product events
```

### E.3 Финальные финансовые цифры

| Параметр                                     | Финал v2.1                        |
| -------------------------------------------- | --------------------------------- |
| Курсовой буфер                               | +30% (мониторинг каждый квартал)  |
| Cost per book baseline                       | $1.50                             |
| Operational overhead                         | $1/user (на >100 users)           |
| Pro recommended price                        | **1490 RUB/мес**                  |
| Pro fallback price (если рынок не принимает) | 990 RUB первые 3 мес promo        |
| Annual Pro                                   | 12 000 RUB (~1000/мес commitment) |
| Free tier book/мес                           | 1 (калибруется в Phase 7)         |
| Pro tier book/мес                            | 5 (включает 50 image)             |
| 1 credit                                     | 10 RUB                            |
| Cost std 1K image                            | **2 credits = 20 RUB**            |
| Min credit pack                              | 100 credits = 990 RUB             |
| Working capital min                          | **300 000 RUB**                   |
| Min Pro users для break-even                 | ~150                              |

### E.4 Open questions (финальный список, до Phase 0)

#### Высокий приоритет (нужны ответы перед стартом)

1. **Юрстатус** для приёма платежей: самозанятый (НПД 6%, cap 2.4M RUB/год), ИП (УСН 6/15%), ООО? **Рекомендация: ИП на УСН-6%** для долгосрочной устойчивости
2. **Working capital 300 000 RUB**: подтверждение, что есть или будет к Phase 4
3. **YooKassa documents**: для активации acquiring какие документы нужны (для self-employed/ИП)?
4. **GCP billing card**: какая карта? Foreign card / Wise / другое — нужно подтверждение работоспособности до Phase 0
5. **Phone+Email verification для Free**: согласие пользователя? (anti-abuse важно)
6. **152-ФЗ регистрация**: уже подавали? Если нет — нужно заранее (1 день в Phase 0)

#### Средний приоритет (можно решить во время Phase 0-2)

7. **18+ маркировка**: для книг с violence/sex — UI compliance design
8. **Subscription грейс при отмене**: до конца оплаченного периода ✅ (рекомендация)
9. **Premium Nano Banana Pro tier**: отдельная "Ultimate" подписка или только credits?
10. **Use it or lose it vs carry-over** для месячной квоты — рекомендация: **lose it** (стандартная SaaS practice)
11. **Existing FLUX images**: keep + opt-in regen ✅ (рекомендация)

#### Низкий приоритет (post-launch decisions)

12. **A/B testing infrastructure**: Posthog vs custom?
13. **i18n английский рынок**: Q4 2026 / Q1 2027?
14. **Mobile app native**: после Q2 2027 если PWA не справляется
15. **242-ФЗ долгосрочный план**: репликация PII в РФ (когда audience > 1000 RU users)

### E.5 Что осталось вне scope любого плана (явно)

Следующее **не делается** в рамках миграции:

- Vertex AI (вместо AI Studio) — overhead не оправдан для соло-разработчика
- Live API (real-time voice/vision) — fancai это reading, не chat
- Code Execution Tool — не применимо
- Function Calling tools — response_schema достаточно
- Provisioned Throughput — enterprise scale only
- Imagen 4 — sunset 24.06.2026
- Gemini 3.1 Flash-Lite as extraction default — issues с premature stop
- Priority tier (+75-100% дороже) — fancai не critical real-time
- Embedding-2 multimodal — не критично сейчас
- Modal pipeline — abandoned 29.03.2026 (history)

---

## Источники

### Официальная документация Google (актуальность 02-03.05.2026)

- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Release notes / changelog](https://ai.google.dev/gemini-api/docs/changelog)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Available regions](https://ai.google.dev/gemini-api/docs/available-regions)
- [Billing](https://ai.google.dev/gemini-api/docs/billing)
- [Tokens / countTokens](https://ai.google.dev/gemini-api/docs/tokens)
- [Long context](https://ai.google.dev/gemini-api/docs/long-context)
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
- [Flex inference](https://ai.google.dev/gemini-api/docs/flex-inference)
- [Priority inference](https://ai.google.dev/gemini-api/docs/priority-inference)
- [Files API](https://ai.google.dev/gemini-api/docs/files)
- [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [URL Context](https://ai.google.dev/gemini-api/docs/url-context)
- [Google Search Grounding](https://ai.google.dev/gemini-api/docs/google-search)
- [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Vertex 3.1 Pro](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)
- [Vertex 3 Flash](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash)
- [Vertex 3 Pro Image (Nano Banana Pro)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro-image)
- [google-genai SDK docs](https://googleapis.github.io/python-genai/)
- [google-genai PyPI](https://pypi.org/project/google-genai/)
- [google-genai GitHub](https://github.com/googleapis/python-genai)

### Анонсы 2026

- [Spend Caps announcement](https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/)
- [Flex/Priority tiers](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-flex-and-priority-inference/)
- [URL Context GA](https://developers.googleblog.com/en/url-context-tool-for-gemini-api-now-generally-available/)
- [Gemini 3.1 Flash-Lite](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)
- [Implicit caching](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)
- [File Search Tool](https://blog.google/innovation-and-ai/technology/developers-tools/file-search-gemini-api/)
- [Nano Banana Pro DeepMind](https://deepmind.google/models/gemini-image/pro/)

### Independent guides (April-May 2026)

- [costgoat May 2026](https://costgoat.com/pricing/gemini-api)
- [BenchLM April pricing](https://benchlm.ai/blog/posts/gemini-api-pricing)
- [aifreeapi Nano Banana 2 pricing](https://www.aifreeapi.com/en/posts/nano-banana-2-pricing)
- [aifreeapi Gemini pricing 2026](https://www.aifreeapi.com/en/posts/gemini-api-pricing-2026)
- [aifreeapi context caching](https://www.aifreeapi.com/en/posts/gemini-api-context-caching-reduce-cost)
- [aifreeapi rate limits per tier](https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier)
- [aipricing.guru April 2026](https://www.aipricing.guru/google-ai-pricing/)
- [LaoZhang thinking levels](https://blog.laozhang.ai/en/posts/gemini-3-1-pro-thinking-level)
- [LaoZhang Nano Banana 2 limits](https://blog.laozhang.ai/en/posts/nano-banana-2-limits-daily-quotas-guide)
- [Gemilab Spend Caps](https://gemilab.net/en/articles/gemini-api/gemini-api-spend-caps-guide)
- [Gemilab usage_metadata cost tracking](https://gemilab.net/en/articles/gemini-api/gemini-api-usage-metadata-cost-tracking-production)
- [yingtu Batch vs caching](https://yingtu.ai/en/blog/gemini-api-batch-vs-caching)
- [TokenMix gemini-embedding-001 guide](https://tokenmix.ai/blog/gemini-embedding-001-dimensions-pricing-guide-2026)

### Local fancai context

- `docs/research/gemini-api-consolidated.md` (главный справочник)
- `docs/research/gemini-api-consolidated-merged-audit-2026-03-31.md`
- `docs/research/gemini-admin-panel-plan-2026-03-31.md`
- `docs/research/_drafts/gemini-direct-research-2026-04-27.md`
- `docs/research/2026-04-27-ai-provider-migration-kie-gemini-openrouter.md`
- `docs/research/kieai-vs-gemini-direct-vs-openrouter-comparison-2026-04-27.md`
- `docs/reports/2026-04-26-status-recap.md`
- `docs/reports/2026-04-30-documentation-modernization.md`
- `backend/CLAUDE.md`, `.claude/rules/backend.md`, `.claude/rules/ai-pipeline.md`

### Российское законодательство

- 152-ФЗ "О персональных данных"
- 242-ФЗ "О локализации персональных данных"
- 54-ФЗ "О применении контрольно-кассовой техники"
- 436-ФЗ "О защите детей от информации"
- ЗоЗПП РФ (14-дневный refund right)
- API "Мой налог" ФНС для самозанятых

---

_Документ сгенерирован: 03.05.2026 в результате двухраундового аудита плана миграции fancai на Direct Gemini API. План v1.0 → аудит v1.0 → план v2.0 → мета-аудит v2.0 → план v2.1 (финальный)._
