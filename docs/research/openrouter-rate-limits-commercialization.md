# OpenRouter API: Rate Limits, масштабирование и коммерциализация fancai

> **Дата исследования**: 2026-03-14
> **Этап**: 1 из N (первичное исследование)
> **Scope**: Rate limiting OpenRouter API, анализ AI-кодовой базы, готовность к 100+ пользователей

---

## Содержание

1. [Executive Summary](#1-executive-summary)
2. [Rate Limits OpenRouter API](#2-rate-limits-openrouter-api)
3. [Ценообразование и экономика](#3-ценообразование-и-экономика)
4. [Текущая AI-архитектура fancai](#4-текущая-ai-архитектура-fancai)
5. [Паттерны запросов при 100+ пользователях](#5-паттерны-запросов-при-100-пользователях)
6. [Критические пробелы в текущей реализации](#6-критические-пробелы-в-текущей-реализации)
7. [Коммерческие паттерны SaaS на OpenRouter](#7-коммерческие-паттерны-saas-на-openrouter)
8. [BYOK и гибридные стратегии](#8-byok-и-гибридные-стратегии)
9. [Сравнение: OpenRouter vs прямой Gemini API](#9-сравнение-openrouter-vs-прямой-gemini-api)
10. [Рекомендации по подготовке к коммерциализации](#10-рекомендации-по-подготовке-к-коммерциализации)
11. [Оценка стоимости при масштабировании](#11-оценка-стоимости-при-масштабировании)
12. [Чеклист production-готовности](#12-чеклист-production-готовности)
13. [Источники](#13-источники)

---

## 1. Executive Summary

**Главный вывод**: OpenRouter API **не блокирует** коммерциализацию fancai при 100+ пользователях. Платные модели не имеют жёстких platform rate limits — действует динамическая формула **$1 баланса = 1 RPS** (max 500 RPS). При балансе $20 доступно 20 запросов/секунду, что более чем достаточно для 100 пользователей (AI-операции fancai — не real-time чат, а фоновые задачи через Celery).

**Однако** в текущей кодовой базе обнаружено **10 критических пробелов**, которые могут привести к отказу сервиса при нагрузке. Самые опасные:

1. **Нет обработки `Retry-After`** от OpenRouter при 429
2. **Один API-ключ** — единая точка отказа
3. **Нет throttling concurrent requests** — 100 одновременных image generation могут исчерпать квоту
4. **Нет бюджетных алертов** — runaway costs при баге
5. **Нет per-user cost tracking** в реальном времени — невозможно реализовать подписочную модель

### Текущее состояние vs необходимое

| Компонент               | Есть                                 | Нужно                              |
| ----------------------- | ------------------------------------ | ---------------------------------- |
| Circuit breaker         | ✅ 5 failures → 60s                  | ✅ Достаточно                      |
| Fallback chain          | ✅ 3 модели                          | ✅ Достаточно                      |
| Redis cache             | ✅ 30 дней LLM, 7 дней images        | ✅ Достаточно                      |
| Cost logging            | ✅ `llm_usage_log` таблица           | ⚠️ Нет алертов/бюджетов            |
| Retry с backoff         | ✅ tenacity 3-5 retries              | ⚠️ Нет обработки Retry-After       |
| Per-user quotas         | ⚠️ Только images (50/500/999999)     | ❌ Нет для entity extraction       |
| Request throttling      | ✅ Redis sliding window (middleware) | ⚠️ Не на всех эндпоинтах (crud.py) |
| API key rotation        | ❌                                   | ❌ Критично                        |
| Balance monitoring      | ❌                                   | ❌ Критично                        |
| Real-time cost per user | ❌                                   | ❌ Критично для подписок           |

---

## 2. Rate Limits OpenRouter API

### 2.1 Бесплатные модели и аккаунты

**Бесплатные модели** (ID оканчивается на `:free`):

| Параметр           | Значение          |
| ------------------ | ----------------- |
| RPM (запросов/мин) | 20                |
| RPD                | 200 запросов/день |

**Бесплатные аккаунты** (без покупки кредитов) на платные модели:

| Параметр                            | Значение            |
| ----------------------------------- | ------------------- |
| RPD без покупки кредитов            | 50 запросов/день    |
| RPD после одноразовой покупки ≥ $10 | 1,000 запросов/день |

> **Важно**: порог $10 — одноразовый. Даже если баланс упадёт ниже $10, повышенный лимит сохраняется навсегда. Лимиты для бесплатных моделей (`:free`) и бесплатных аккаунтов на платные модели — разные системы.

### 2.2 Платные модели (Pay-as-you-go) — наш случай

**Платформенных rate limits НЕТ.** Действует динамическая формула:

```
Доступный RPS = min(баланс_в_долларах, 500)
```

| Баланс | Доступный RPS | Запросов/мин |
| ------ | ------------- | ------------ |
| $10    | 10            | 600          |
| $20    | 20            | 1,200        |
| $50    | 50            | 3,000        |
| $100   | 100           | 6,000        |
| $500+  | 500 (потолок) | 30,000       |

**Критический нюанс**: RPS **динамически снижается** по мере расходования баланса. Если начали день с $50 (50 RPS), а к вечеру потратили до $15 — RPS упал до 15.

### 2.3 Глобальность лимитов

- Создание дополнительных API-ключей **НЕ увеличивает** rate limits — ёмкость управляется глобально по аккаунту
- Каждый провайдер (Google, Anthropic и т.д.) имеет свои дополнительные лимиты поверх OpenRouter
- Cloudflare DDoS-защита может блокировать при аномальных паттернах

### 2.4 HTTP-заголовки при rate limiting

OpenRouter возвращает:

```
X-RateLimit-Limit: <максимум>
X-RateLimit-Remaining: <осталось>
X-RateLimit-Reset: <timestamp сброса>
```

При превышении: **HTTP 429 Too Many Requests**. Заголовок `Retry-After` явно не документирован, но `X-RateLimit-Reset` содержит timestamp для определения момента повтора.

### 2.5 Как это влияет на fancai

При 100 активных пользователях, допустим **одновременно активны 20-30**:

- Entity extraction: ~3-5 запросов/глава × 5 одновременных глав = **15-25 RPS пик**
- Image generation: ~2 запроса/изображение × 10 одновременных = **20 RPS пик**
- **Совокупный пик**: ~45 RPS

**Необходимый минимальный баланс**: $45-50 для покрытия пиковых нагрузок.

---

## 3. Ценообразование и экономика

### 3.1 Принцип ценообразования

OpenRouter **не делает наценку** на цены провайдеров. Единственная комиссия — при покупке кредитов:

| Способ оплаты | Комиссия          |
| ------------- | ----------------- |
| Карта         | 5.5% (мин. $0.80) |
| Криптовалюта  | 5% (без минимума) |

### 3.2 Стоимость моделей fancai

**Gemini 3.0 Flash Preview** (entity extraction, synthesis, deduplication):

| Направление | Цена за 1M токенов |
| ----------- | ------------------ |
| Input       | $0.50              |
| Output      | $3.00              |

**FLUX.2 Klein 4B** (генерация изображений):

| Параметр                       | Цена    |
| ------------------------------ | ------- |
| Первый мегапиксель             | $0.014  |
| Каждый следующий МП            | $0.001  |
| Стандартное изображение (~1MP) | ~$0.014 |

**Claude Haiku 4.5** (fallback для entity dedup):

| Направление | Цена за 1M токенов |
| ----------- | ------------------ |
| Input       | $1.00              |
| Output      | $5.00              |

### 3.3 Стоимость операций fancai

| Операция                                  | Вызовы API         | Примерная стоимость |
| ----------------------------------------- | ------------------ | ------------------- |
| Entity extraction (1 глава, ~20K токенов) | 1 structured       | $0.01-0.05          |
| Entity synthesis (50 entities batch)      | 1 text             | $0.005-0.02         |
| Entity deduplication                      | 1 structured       | $0.002-0.01         |
| Prompt translation (RU→EN)                | 1 text             | $0.0001-0.0005      |
| Image generation (FLUX.2 Klein)           | 1 image            | $0.014              |
| **Полная обработка 1 главы**              | **3-5 вызовов**    | **$0.02-0.08**      |
| **Полная обработка книги (20 глав)**      | **60-100 вызовов** | **$0.40-1.60**      |

### 3.4 Отслеживание расходов через API

```
GET /api/v1/generation?id={generation_id}
```

Возвращает: `total_cost`, `tokens_prompt`, `tokens_completion`, `cache_discount`, `generation_time`, `model`, `provider_name`.

```
GET /api/v1/activity
```

Дневная статистика за 30 дней, группировка по endpoint/модели. Требует Provisioning API Key.

---

## 4. Текущая AI-архитектура fancai

### 4.1 Диаграмма архитектуры

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (React / iOS)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴──────────────┐
        │                           │
    ┌───▼──────────┐         ┌──────▼──────┐
    │   FastAPI     │         │  WebSocket  │
    │  (25 routes)  │         │   Events    │
    └───┬──────────┘         └─────────────┘
        │
┌───────▼────────────────────────────────────────────────┐
│              AI ORCHESTRATION LAYER                      │
│                                                          │
│  gemini_extractor ─── entity_synthesis_service           │
│  (entity + desc)      (biographies + milestones)         │
│        │                       │                         │
│  consistency_mgr ─── entity_deduplication_service        │
│  (merge entities)    (LLM-based dedup)                   │
│        │                       │                         │
│  imagen_generator ─── PromptTranslator                   │
│  (FLUX.2 Klein)       (RU→EN via LLM)                   │
│                                                          │
└──────────┬───────────────────────────────────────────────┘
           │
    ┌──────▼──────────────────────────────────┐
    │     OPENROUTER CLIENT                    │
    │     openrouter_client.py (643 строки)    │
    │                                          │
    │  generate_text()        — JSON mode      │
    │  generate_structured()  — JSON Schema    │
    │  generate_image()       — modalities     │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ Circuit Breaker (5 fail → 60s)    │  │
    │  │ Fallback: Gemini→Claude→Lite      │  │
    │  │ Metrics + Cost Logging            │  │
    │  └────────────────────────────────────┘  │
    └───────────┬──────────────────────────────┘
                │
    ┌───────────▼─────────────────────────┐
    │     OpenRouter API v1                │
    │                                      │
    │  Gemini 3 Flash ──→ Primary          │
    │  Claude Haiku 4.5 ─→ Fallback #1    │
    │  Gemini 2.5 Lite ──→ Fallback #2    │
    │  FLUX.2 Klein ──────→ Images         │
    └─────────────────────────────────────┘

┌─────────────────────────────────────────┐
│            DATA LAYER                    │
│                                          │
│  PostgreSQL ── entities, descriptions,   │
│                images, llm_usage_log     │
│                                          │
│  Redis DB0 ── cache (LLM 30d, img 7d,  │
│               translation 7d)            │
│                                          │
│  Redis DB1 ── Celery broker              │
│  Redis DB2 ── Celery results             │
│                                          │
│  Celery Workers:                         │
│   image_tasks (soft: 300s, hard: 360s)   │
│   book_tasks  (soft: 10500s, hard: 3h)   │
└─────────────────────────────────────────┘
```

### 4.2 Ключевые файлы

| Компонент           | Файл                                                   | Строки |
| ------------------- | ------------------------------------------------------ | ------ |
| OpenRouter клиент   | `backend/app/core/openrouter_client.py`                | 643    |
| Circuit Breaker     | `openrouter_client.py:74-89`                           | —      |
| Image pipeline      | `backend/app/services/imagen_generator.py`             | 585    |
| Entity extraction   | `backend/app/services/gemini_extractor.py`             | 1200+  |
| Entity synthesis    | `backend/app/services/entity_synthesis_service.py`     | 237    |
| Entity dedup        | `backend/app/services/entity_deduplication_service.py` | —      |
| Consistency manager | `backend/app/services/consistency_manager.py`          | 150+   |
| Retry logic         | `backend/app/core/retry.py`                            | 523    |
| Cache manager       | `backend/app/core/cache.py`                            | 571    |
| LLM cache           | `backend/app/services/llm_cache_service.py`            | 121    |
| Celery image tasks  | `backend/app/tasks/image_tasks.py`                     | 433    |
| Celery book tasks   | `backend/app/tasks/book_tasks.py`                      | 150+   |
| Prometheus метрики  | `backend/app/monitoring/metrics.py`                    | 550+   |

### 4.3 Существующие механизмы защиты

**Circuit Breaker** (`openrouter_client.py:74-89`):

```python
openrouter_breaker = CircuitBreaker(
    failure_threshold=5,          # 5 последовательных ошибок
    recovery_timeout=60,          # half-open через 60 сек
    expected_exception=CIRCUIT_BREAKER_EXCEPTIONS  # HTTP 5xx, timeout, network
)
```

**Fallback chain** (3 модели): Gemini 3.0 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite

**Retry декораторы** (`retry.py`):

- `@retry_api_call` — 3 retries, backoff 1-10s
- `@retry_image_generation` — 4 retries, backoff 2-60s
- `@retry_llm_extraction` — 3 retries, backoff 1-30s
- `@retry_critical` — 5 retries, backoff 1-60s

**Кеширование** (Redis):

- LLM responses: `llm:chapter:{hash}` — TTL 30 дней
- Image translations: `translation:{hash}` — TTL 7 дней
- Image results: `imagen:cache:{hash}` — TTL 7 дней
- Entity network: `book:{id}:entity_network_raw_v5` — TTL 1 час

**Пользовательские квоты** (только для изображений):

- Free tier: 50 изображений/месяц
- Premium tier: 500 изображений/месяц
- X-RateLimit-\* заголовки в ответе

**Cost tracking**: все API-вызовы логируются в `llm_usage_log` (model, tokens, cost, request_id).

---

## 5. Паттерны запросов при 100+ пользователях

### 5.1 Сценарий: пользователь открывает книгу

```
1. GET /entities → Redis cache check → DB query (0 API calls)
2. Фоновая задача: trigger_background_extraction()
   ├─ Redis lock check
   ├─ LLM cache check
   └─ Если cache miss:
      ├─ Chunk text (100K chunks, 15% overlap)
      ├─ PER CHUNK: generate_structured() → 1 API call
      ├─ Synthesis: generate_text() → 1 API call
      └─ Dedup: generate_structured() → 1 API call (if needed)
```

**API calls per chapter (cache miss)**: 3-5
**API calls per chapter (cache hit)**: 0

### 5.2 Сценарий: пользователь генерирует изображение

```
1. POST /images/generate → check_image_quota()
2. Celery task: generate_image_task
   ├─ Image cache check (Redis)
   ├─ Translation cache check (Redis)
   ├─ Если cache miss:
   │   ├─ generate_text() → translation (1 API call)
   │   └─ generate_image() → FLUX.2 (1 API call)
   └─ 2-sec sleep between batch images (rate limiting)
```

**API calls per image (cache miss)**: 1-2
**API calls per image (cache hit)**: 0

### 5.3 Проекция нагрузки на 100 активных пользователей

| Метрика                       | Среднее    | Пик    |
| ----------------------------- | ---------- | ------ |
| Одновременно активных         | 20-30      | 50     |
| Глав читается/час             | 50         | 150    |
| Изображений генерируется/час  | 20         | 80     |
| API calls/час (с кешем ~50%)  | 100-150    | 400    |
| API calls/сек (средний)       | 0.03-0.04  | 0.11   |
| API calls/сек (пиковый burst) | —          | 5-10   |
| Стоимость/час                 | $0.50-1.00 | $3-5   |
| Стоимость/день                | $5-15      | $30-50 |

**Вывод**: при балансе $20+ текущих rate limits OpenRouter достаточно. Узкое место — не rate limits API, а **внутренняя архитектура приложения**.

---

## 6. Критические пробелы в текущей реализации

### 6.1 🔴 КРИТИЧЕСКИЕ (блокируют коммерциализацию)

#### P1: Нет обработки `Retry-After` / `X-RateLimit-Reset`

**Файл**: `backend/app/core/openrouter_client.py`
**Проблема**: Circuit breaker ловит HTTP 429, но не парсит заголовки `X-RateLimit-Reset` и `X-RateLimit-Remaining`. Retry с фиксированным exponential backoff вместо адаптивного.
**Риск**: При burst-нагрузке все retries стреляют одновременно → ещё больше 429 → circuit breaker открывается → ВСЕ пользователи блокированы на 60 секунд.
**Решение**: Парсить `X-RateLimit-Reset`, использовать его как минимальный wait time. Добавить `X-RateLimit-Remaining` в метрики для проактивного throttling.

#### P2: Один API-ключ — единая точка отказа

**Файл**: `backend/app/core/config.py:59-63`
**Проблема**: `OPENROUTER_API_KEY` — единственный ключ для всех операций.
**Риск**: Компрометация ключа → полный отказ AI. Исчерпание баланса → полный отказ AI.
**Решение**: Минимум 2 ключа с ротацией. OpenRouter Management API позволяет создавать ключи программно.

#### P3: Нет throttling concurrent requests

**Проблема**: Celery worker(ы) могут одновременно отправить десятки запросов. Нет глобального лимита на concurrent OpenRouter API calls.
**Риск**: 100 одновременных image generation → 200 API calls → burst → 429 → cascade failure.
**Решение**: Semaphore/token bucket на уровне OpenRouter клиента. Redis-based rate limiter с `max_concurrent=10-20`.

#### P4: Нет бюджетных алертов и лимитов

**Проблема**: Cost tracking есть (`llm_usage_log`), но нет:

- Алерта при превышении дневного бюджета
- Hard stop при исчерпании бюджета
- Breakdown по фичам (extraction vs images vs synthesis)
  **Риск**: Баг вызывает 10,000 retries → $100+ потрачено до обнаружения.
  **Решение**: Middleware с дневным/месячным бюджетом. Алерт в Telegram/email при достижении 80% бюджета.

#### P5: Нет per-user cost tracking в реальном времени

**Проблема**: `llm_usage_log` логирует стоимость per-request, но нет агрегации per-user. Невозможно реализовать подписочную модель.
**Риск**: Один пользователь загружает 50 книг → потребляет 90% бюджета → остальные пользователи без AI.
**Решение**: Суммировать `total_cost` per-user в PostgreSQL. Лимиты per-tier: free = $0.10/день, premium = $1.00/день.

### 6.2 🟡 ВАЖНЫЕ (влияют на качество сервиса)

#### P6: Нет мониторинга баланса OpenRouter

**Проблема**: Баланс OpenRouter не отслеживается. Напомним: **$1 = 1 RPS**. Падение баланса → снижение пропускной способности.
**Решение**: Периодический запрос `/api/v1/auth/key` для проверки баланса. Алерт при < $10.

#### P7: Rate limiting не покрывает все AI-эндпоинты

**Проблема**: В проекте **есть** Redis-based rate limiter (`backend/app/middleware/rate_limit.py`) с пресетами `ai_image` (5/мин), `ai_entity_extraction` (10/мин), `ai_operation` (10/мин). Однако эндпоинты `process-descriptions` и `reprocess-descriptions` в `backend/app/routers/books/crud.py` **не имеют** декоратора `@rate_limit`, в отличие от аналогичного эндпоинта в `processing.py`.
**Решение**: Добавить `@rate_limit(**RATE_LIMIT_PRESETS["ai_operation"])` на все AI-эндпоинты в `crud.py`.

#### P8: Celery worker stability

**Проблема**:

- `CELERY_CONCURRENCY=2` (default) — мало для 100+ пользователей
- Нет dead letter queue для проваленных задач
- Нет heartbeat monitoring
  **Решение**: Увеличить concurrency до 3-5. Добавить DLQ routing. Prometheus exporter для Celery.

#### P9: Нет кеш-аналитики

**Проблема**: Prometheus counters `llm_cache_hits_total` / `llm_cache_misses_total` собираются, но нет:

- Dashboard с hit rate %
- Алерта при падении hit rate
- TTL-оптимизации
  **Решение**: Grafana dashboard. Алерт при hit rate < 30%.

#### P10: Chunk boundary entity loss

**Проблема**: `RecursiveTextChunker` (100K chars, 15% overlap) — сущности на границах чанков могут теряться.
**Решение**: Post-merge шаг для boundary entities. Увеличение overlap до 20-25% для длинных книг.

---

## 7. Коммерческие паттерны SaaS на OpenRouter

### 7.1 Управление ключами

OpenRouter предоставляет **Management API** (`/api/v1/keys`):

```
POST /api/v1/keys — создание ключа
  limit: $X          — кредитный лимит
  limit_reset: daily|weekly|monthly — автосброс
  disabled: bool      — деактивация
```

Для управления нужен **Provisioning API Key** (создаётся в Settings), который НЕ может делать completion-запросы — только управлять ключами.

### 7.2 Рекомендуемая архитектура

**Один "мастер" API key на backend**, per-user throttling через Redis.

Причины:

- Rate limits глобальные по аккаунту, не по ключу — множество ключей НЕ увеличивает пропускную способность
- Упрощает ротацию и безопасность
- Per-user rate limiting делать на уровне приложения

Если нужна **изоляция бюджетов по тарифам** — можно создать ключи per-tier через Management API:

- `key_free` с лимитом $0.10/день
- `key_premium` с лимитом $1.00/день
- `key_enterprise` без лимита

### 7.3 Встроенный failover OpenRouter

**Provider Failover** (автоматический): если провайдер модели недоступен, OpenRouter переключается на другого провайдера той же модели.

**Model Fallback** (настраиваемый):

```json
{
  "models": [
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-flash",
    "google/gemini-2.0-flash-001"
  ],
  "messages": [...]
}
```

Триггеры fallback: 429, 502, 503, 403 (moderation), context length exceeded, 408 (timeout).

**Provider preferences**:

```json
{
  "provider": {
    "sort": "throughput", // или "price", "latency"
    "allow_fallbacks": true,
    "data_collection": "deny", // privacy
    "order": ["google"] // приоритет
  }
}
```

> **Внимание**: fancai уже реализует свой 3-модельный fallback chain в `openrouter_client.py`. Но НЕ использует нативный fallback OpenRouter через поле `models`. Использование нативного fallback может быть надёжнее и быстрее (одна HTTP-request вместо 3 sequential retries).

### 7.4 Per-user cost control (паттерн)

```
1. Пользователь делает запрос → FastAPI middleware
2. Middleware:
   a. Получить user.tier (free/premium/enterprise)
   b. Получить user.daily_cost из Redis (INCRBYFLOAT)
   c. Сравнить с лимитом tier
   d. Если превышен → HTTP 402 "Дневной лимит AI исчерпан"
   e. Если OK → пропустить запрос
3. После завершения API call:
   a. Получить cost из OpenRouter response
   b. INCRBYFLOAT user.daily_cost + cost
   c. EXPIRE key = до конца дня
4. Ежемесячный биллинг: SUM(llm_usage_log) GROUP BY user_id
```

---

## 8. BYOK и гибридные стратегии

### 8.1 BYOK (Bring Your Own Key)

Ключевая возможность OpenRouter — использование собственных API-ключей провайдеров:

| Параметр             | Значение                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Комиссия             | 5% от обычной цены OpenRouter                                         |
| Бесплатно            | Первый 1M BYOK-запросов/месяц — 0% комиссии                           |
| Контроль rate limits | Через аккаунт провайдера (не OpenRouter)                              |
| Fallback             | При ошибке BYOK-ключа → автоматический fallback на кредиты OpenRouter |
| Аналитика            | Единый дашборд OpenRouter для BYOK + кредитных запросов               |

### 8.2 Гибридная стратегия для fancai

**Рекомендуемая конфигурация при 100+ пользователях:**

```
                    ┌──────────────────────┐
                    │   OpenRouter API      │
                    │                       │
   BYOK Google ────►│ Gemini 3 Flash       │──── Entity extraction
   (0% commission)  │ (Google API key)      │     (основной объём)
                    │                       │
   OpenRouter ─────►│ FLUX.2 Klein         │──── Image generation
   credits          │ (нет BYOK для FLUX)   │     (нет альтернативы)
                    │                       │
   OpenRouter ─────►│ Claude Haiku 4.5     │──── Fallback
   credits          │ (fallback only)       │     (редко используется)
                    └──────────────────────┘
```

**Экономия**:

- Gemini через BYOK: 0% комиссии (первый 1M запросов/месяц бесплатно)
- Rate limits: контролируются через Google Cloud Console (до 2,000 RPM на Tier 2)
- FLUX.2: только через кредиты OpenRouter (5.5% комиссия при пополнении)

### 8.3 Когда переходить на BYOK

| Этап                 | Стратегия                                          |
| -------------------- | -------------------------------------------------- |
| 0-50 пользователей   | Только OpenRouter credits                          |
| 50-200 пользователей | BYOK для Gemini + credits для FLUX                 |
| 200+ пользователей   | BYOK Gemini + возможно прямой API для Gemini Batch |

---

## 9. Сравнение: OpenRouter vs прямой Gemini API

### 9.1 Rate Limits

| Тир Google                         | RPM       | TPM     | RPD        |
| ---------------------------------- | --------- | ------- | ---------- |
| Free                               | 10-15     | 250K-1M | 100-250    |
| Tier 1 (billing on)                | 150-2,000 | 1M-4M   | ~Unlimited |
| Tier 2 ($250 cumulative + 30 дней) | 500-2,000 | 4M+     | 10,000+    |

| OpenRouter     | RPM        | RPS                         |
| -------------- | ---------- | --------------------------- |
| Платные модели | Нет лимита | $1 баланса = 1 RPS, max 500 |

**Вывод**: для Gemini прямой API даёт более предсказуемые и высокие лимиты (особенно на Tier 2+). Но BYOK через OpenRouter даёт лучшее из обоих миров.

### 9.2 Ценообразование

| Модель                  | Google Direct | OpenRouter | Разница      |
| ----------------------- | ------------- | ---------- | ------------ |
| Gemini 3 Flash (input)  | $0.50/1M      | $0.50/1M   | 0%           |
| Gemini 3 Flash (output) | $3.00/1M      | $3.00/1M   | 0%           |
| Комиссия при покупке    | 0%            | 5.5%       | Единственная |

### 9.3 Преимущества OpenRouter для fancai

1. **Единый API** для Gemini + FLUX + Claude (3 провайдера → 1 интеграция)
2. **Автоматический provider failover** — если один провайдер Gemini лежит, OpenRouter переключит на другого
3. **Model fallback** — нативная поддержка через `models[]`
4. **Единая аналитика** — все расходы в одном месте
5. **BYOK** — лучшее из обоих миров (rate limits Google + аналитика OpenRouter)

### 9.4 Когда стоит уйти с OpenRouter

- Если 90%+ вызовов — Gemini, и нужен **Batch API** (50% скидка для не-срочных задач)
- Если нужны **SLA от Google** на уровне Enterprise
- Если **5.5% комиссии** становится значимой (при $1,000+/месяц = $55+ экономии)

---

## 10. Рекомендации по подготовке к коммерциализации

### 10.1 Этап 1: Критические исправления (1-2 недели)

#### R1: Adaptive Rate Limiting

```python
# openrouter_client.py — добавить парсинг заголовков
async def _post_with_breaker(self, ...):
    response = await self._session.post(...)

    # Проактивный throttling
    remaining = int(response.headers.get("X-RateLimit-Remaining", 999))
    if remaining < 5:
        await asyncio.sleep(2)  # slow down before hitting limit

    if response.status_code == 429:
        reset_time = float(response.headers.get("X-RateLimit-Reset", 0))
        wait = max(reset_time - time.time(), 1)
        raise RateLimitError(f"429", retry_after=int(wait))
```

#### R2: Global Request Throttler

```python
# Новый файл: backend/app/core/throttle.py
class OpenRouterThrottle:
    """Redis-based semaphore для ограничения concurrent requests"""
    def __init__(self, redis, max_concurrent=15, max_per_minute=60):
        ...

    async def acquire(self, timeout=30):
        """Ждём свободный слот или timeout"""
        ...

    async def release(self):
        ...
```

#### R3: Per-User Cost Middleware

```python
# FastAPI dependency
async def check_ai_budget(user: User = Depends(get_current_user)):
    daily_cost = await redis.get(f"user:{user.id}:daily_cost")
    limit = TIER_LIMITS[user.tier]  # free=$0.10, premium=$1.00
    if float(daily_cost or 0) >= limit:
        raise HTTPException(402, "Дневной лимит AI исчерпан")
```

#### R4: Balance Monitoring

```python
# Периодическая задача Celery (каждые 5 минут)
@celery_app.task
def check_openrouter_balance():
    response = httpx.get(
        "https://openrouter.ai/api/v1/auth/key",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    balance = response.json()["data"]["limit_remaining"]
    if balance < 10:
        send_alert(f"⚠️ OpenRouter баланс: ${balance}")
```

### 10.2 Этап 2: Масштабирование (2-3 недели)

- **R5**: Использовать нативный `models[]` fallback OpenRouter вместо sequential retries
- **R6**: BYOK для Gemini (Google API key через OpenRouter)
- **R7**: Увеличить Celery concurrency до 3-5 workers
- **R8**: Grafana dashboard: costs, cache hits, errors, queue depth
- **R9**: Per-user API quotas для entity extraction (не только images)
- **R10**: Dead letter queue для проваленных Celery задач

### 10.3 Этап 3: Продвинутая оптимизация (4+ недели)

- **R11**: Batch processing — агрегировать entity extraction для нескольких пользователей читающих одну книгу
- **R12**: Predictive caching — предварительно обрабатывать следующие 2-3 главы
- **R13**: Tiered model routing — простые запросы на дешёвую модель, сложные на премиум
- **R14**: Cost anomaly detection — алерт при 3x превышении средней стоимости per-request

---

## 11. Оценка стоимости при масштабировании

### 11.1 Модель расчёта

Допущения:

- Средняя книга: 20 глав, ~500K символов
- Entity extraction: ~$0.03/глава (с кешированием ~50%)
- Image generation: ~$0.014/изображение
- Средний пользователь: 2 главы/день, 1 изображение/день

### 11.2 Прогноз расходов

| Пользователей | Глав/день | Изображений/день | Entity cost/день | Image cost/день | Итого/день | Итого/месяц |
| ------------- | --------- | ---------------- | ---------------- | --------------- | ---------- | ----------- |
| 10            | 20        | 5                | $0.30            | $0.07           | $0.37      | $11         |
| 50            | 100       | 25               | $1.50            | $0.35           | $1.85      | $56         |
| 100           | 200       | 50               | $3.00            | $0.70           | $3.70      | $111        |
| 500           | 1,000     | 250              | $15.00           | $3.50           | $18.50     | $555        |
| 1,000         | 2,000     | 500              | $30.00           | $7.00           | $37.00     | $1,110      |

> **Примечание**: с ростом пользователей cache hit rate растёт (одни и те же книги), поэтому реальные расходы будут ниже.

### 11.3 Подписочная модель: break-even

| Тариф   | Цена    | AI-бюджет/пользователь | Маржа    |
| ------- | ------- | ---------------------- | -------- |
| Free    | $0      | $0.10/день ($3/мес)    | -$3/мес  |
| Basic   | $3/мес  | $0.20/день ($6/мес)    | -$3/мес  |
| Premium | $7/мес  | $0.50/день ($15/мес)   | -$8/мес  |
| Pro     | $15/мес | $1.00/день ($30/мес)   | -$15/мес |

> **Вывод**: при текущих ценах AI чистый SaaS с подпиской **убыточен**, если не ограничивать AI-операции жёстко. Необходим один из вариантов:
>
> 1. **Pay-per-use**: пользователь покупает "AI-кредиты" (как в Midjourney)
> 2. **Жёсткие лимиты per-tier**: free = 5 глав/день, premium = 50 глав/день
> 3. **Гибрид**: подписка + лимиты + докупка кредитов
> 4. **BYOK для пользователей**: премиум-пользователи приносят свои API-ключи

---

## 12. Чеклист production-готовности

### Перед запуском с 100+ пользователями:

**API Resilience**:

- [ ] Парсинг `X-RateLimit-Remaining` / `X-RateLimit-Reset` в openrouter_client.py
- [ ] Global request throttle (max 15-20 concurrent OpenRouter calls)
- [ ] Использование нативного `models[]` fallback
- [ ] Мониторинг баланса OpenRouter (каждые 5 минут)
- [ ] Минимум 2 API-ключа с ротацией

**Cost Control**:

- [ ] Per-user daily cost tracking (Redis + PostgreSQL)
- [ ] Tier-based AI бюджеты (free/basic/premium/pro)
- [ ] Дневной бюджетный алерт (Telegram/email при 80%)
- [ ] Hard stop при исчерпании дневного бюджета
- [ ] Cost breakdown по фичам (extraction vs images vs synthesis)

**Monitoring**:

- [ ] Grafana dashboard: latency, error rate, cache hit %, queue depth, costs
- [ ] Alert rules: P95 latency > 5s, error rate > 1%, CB state ≠ closed
- [ ] Баланс OpenRouter в дашборде
- [ ] Cache hit rate monitoring с алертом при < 30%

**Scaling**:

- [ ] Celery concurrency ≥ 3 workers
- [ ] Dead letter queue для проваленных задач
- [ ] Worker heartbeat monitoring
- [ ] Per-user rate limiting middleware (FastAPI)

**Billing**:

- [ ] Определить подписочную модель (pay-per-use / tiers / hybrid)
- [ ] Реализовать per-user usage dashboard (frontend)
- [ ] Интеграция с платёжной системой (Stripe/YooKassa)
- [ ] Usage-based billing logic

---

## 13. Источники

### Официальная документация OpenRouter

- [Rate Limits](https://openrouter.ai/docs/api/reference/limits)
- [Pricing](https://openrouter.ai/pricing)
- [Error Handling](https://openrouter.ai/docs/api/reference/errors-and-debugging)
- [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Enterprise](https://openrouter.ai/enterprise)
- [Management API Keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)
- [Provisioning API Keys](https://openrouter.ai/docs/features/provisioning-api-keys)
- [BYOK](https://openrouter.ai/docs/guides/overview/auth/byok)
- [Generation Stats API](https://openrouter.ai/docs/api/api-reference/generations/get-generation)
- [Activity API](https://openrouter.ai/docs/api-reference/analytics/get-activity)
- [API Key Rotation](https://openrouter.ai/docs/guides/guides/administration/api-key-rotation)
- [FAQ](https://openrouter.ai/docs/faq)

### Модели

- [FLUX.2 Klein 4B](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- [Gemini 3 Flash Preview](https://openrouter.ai/google/gemini-3-flash-preview)

### Сторонние источники

- [OpenRouter Rate Limits Zendesk](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379)
- [Google Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [OpenRouter 1M Free BYOK Requests](https://openrouter.ai/announcements/1-million-free-byok-requests-per-month)
- [OpenRouter Review 2025 (Skywork)](https://skywork.ai/blog/openrouter-review-2025-api-gateway-latency-pricing/)
- [OpenRouter in Python (Snyk)](https://snyk.io/articles/openrouter-in-python-use-any-llm-with-one-api-key/)
- [CostGoat OpenRouter Calculator](https://costgoat.com/pricing/openrouter)

---

> **Следующие этапы исследований**:
>
> 1. System Design подписочной модели (pay-per-use vs tiers)
> 2. Архитектура per-user cost tracking
> 3. Интеграция с платёжной системой (YooKassa для РФ)
> 4. Нагрузочное тестирование AI pipeline (k6 / locust)
> 5. Security audit AI endpoints (prompt injection, cost abuse)
