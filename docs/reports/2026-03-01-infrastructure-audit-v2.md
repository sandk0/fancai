# Аудит инфраструктурного отчёта + Аналитика нагрузки (v2)

**Дата:** 2026-03-01
**Scope:** Критический аудит отчёта v1, пересмотр консервативных решений, capacity planning
**Автор:** Claude Code

## Executive Summary

Аудит первого отчёта выявил **7 существенных пробелов**: отсутствие capacity planning, игнорирование Gemini API как главного bottleneck, заниженные оценки Celery workers, отсутствие анализа стоимости AI API, пропуск миграции Gemini 2.0→2.5/3.0, слишком консервативный подход к Docker Compose, и отсутствие zero-downtime стратегии. Данный отчёт исправляет эти пробелы и добавляет детальную модель нагрузки для нового сервера.

---

## Часть 1: Критический аудит отчёта v1

### Ошибки и пробелы

#### 1. КРИТИЧНО: Gemini 2.0 Flash снимается с продакшена 3 марта 2026

Отчёт v1 полностью пропустил: **Gemini 2.0 Flash и Flash-Lite модели будут удалены 3 марта 2026** (через 2 дня!). Текущий конфиг (`LANGEXTRACT_MODEL=gemini-2.0-flash`) перестанет работать. Это не вопрос миграции сервера — это аварийный фикс.

**Действие:** Немедленно мигрировать на `gemini-2.5-flash` или `gemini-3-flash-preview`.

| Модель                 | Input ($/1M tokens) | Output ($/1M tokens) | Context cache | Статус                   |
| ---------------------- | ------------------- | -------------------- | ------------- | ------------------------ |
| gemini-2.0-flash       | $0.10               | $0.40                | Нет           | **УДАЛЯЕТСЯ 03.03.2026** |
| gemini-2.5-flash       | $0.30               | $2.50                | Да (-90%)     | Стабильная               |
| gemini-3-flash-preview | $0.50               | $3.00                | Да (-90%)     | Preview                  |

**Рекомендация:** `gemini-2.5-flash` — стабильная, поддерживает context caching (экономия до 90% при повторных запросах с одинаковым промптом).

#### 2. КРИТИЧНО: Gemini API — реальный bottleneck, не CPU/RAM

Отчёт v1 фокусировался на hardware bottleneck-ах, но **настоящий bottleneck — Gemini API rate limits**:

| Tier        | RPM     | RPD   | TPM  |
| ----------- | ------- | ----- | ---- |
| Free        | 10      | 250   | 250K |
| Paid Tier 1 | 150-300 | 1,500 | 1M   |

Обработка одной книги (100 глав) требует:

- ~100 Gemini-вызовов для экстракции описаний
- ~50 вызовов для entity synthesis
- ~20 вызовов для деduplication
- **Итого: ~170 API calls на книгу**

На Free tier (250 RPD): **максимум 1.5 книги в день**.
На Paid Tier 1 (1,500 RPD): **максимум ~9 книг в день**.

Сервер 12 ядер / 32 ГБ не поможет — bottleneck внешний.

#### 3. ОШИБКА: Imagen API — ещё жёстче

| Tier        | IPM | RPD |
| ----------- | --- | --- |
| Free        | 2   | 100 |
| Paid Tier 1 | 300 | —   |

На Free tier: **максимум 120 изображений/час, 100/день**.
Стоимость на Paid tier: **$0.02/изображение** (Imagen 4 Fast).

При 50 free-генерациях/месяц на пользователя × 100 пользователей = 5,000 изображений/месяц = **$100/месяц только за Imagen**.

#### 4. ОШИБКА: Celery concurrency 6-8 — занижена

Отчёт v1 рекомендовал увеличить concurrency с 2-4 до 6-8. Но Celery tasks в fancai **I/O-bound** (ожидание Gemini API + DB queries), а не CPU-bound. Для I/O-bound задач оптимально:

```
concurrency = 2-3 × CPU_cores_allocated = 2-3 × 4 = 8-12
```

Учитывая, что 80% времени task ждёт ответа от Gemini API (60s timeout):

- **Рекомендация: 2 Celery workers × 6 concurrency = 12 параллельных задач**
- Это позволит обрабатывать 12 глав одновременно при наличии API quota

#### 5. ПРОБЕЛ: Отсутствует стоимость владения (TCO)

v1 не посчитал общую стоимость. Вот реальная картина:

| Статья                                  | Месячная стоимость |
| --------------------------------------- | ------------------ |
| VPS 12 ядер / 32 ГБ (vdsina.com)        | ~$25-40            |
| Gemini API (Paid Tier 1, ~10K requests) | ~$5-15             |
| Imagen API (~5K images)                 | ~$100              |
| Домен + DNS                             | ~$2                |
| **Итого**                               | **~$130-160/мес**  |

**Imagen — главная статья расходов** (>60% TCO). Это меняет приоритеты оптимизации.

#### 6. ПРОБЕЛ: PgBouncer — переоценён для нашего кейса

v1 рекомендовал PgBouncer для экономии RAM. Но:

- FastAPI + asyncpg уже используют connection pooling (DB_POOL_SIZE=20)
- SQLAlchemy 2.0 async имеет встроенный pool
- При 4 Granian workers × 20 pool = 80 connections — PostgreSQL 17 справляется нативно
- Celery workers используют sync connections, но их мало (12 параллельных)

**Пересмотренная рекомендация:** PgBouncer **НЕ нужен на Phase 1**. Добавить только если max_connections > 200. Экономия 750 МБ RAM не оправдывает дополнительный компонент и риск transaction-mode ограничений (нельзя LISTEN/NOTIFY, prepared statements).

#### 7. ПРОБЕЛ: Zero-downtime deployment не описан

Переезд на новый сервер = downtime для пользователей. Нужна стратегия:

1. Поднять новый сервер параллельно
2. Настроить DNS с низким TTL (60s) за неделю до миграции
3. pg_dump → pg_restore с финальным rsync
4. Переключить DNS
5. Мониторить 24h, держать старый сервер как fallback

---

## Часть 2: Пересмотр консервативных решений

### Celery → Taskiq: ПЕРЕСМОТРЕНО — мигрировать

v1 рекомендовал оставить Celery. Пересматриваю.

**Аргументы ЗА миграцию на Taskiq:**

1. **Нативный async** — Celery запускает sync workers в async-приложении. Каждый Celery worker = отдельный процесс Python (~150-300 МБ RAM). Taskiq запускает async корутины в одном процессе.
2. **FastAPI DI integration** — можно переиспользовать FastAPI зависимости (DB sessions, настройки) в tasks без дублирования.
3. **Меньше RAM** — 1 Taskiq worker с 12 async корутинами vs 2 Celery workers × 6 processes = экономия ~2-4 ГБ RAM.
4. **Redis Stream broker** — надёжнее, чем Redis List (Celery default). Redis Streams не теряют сообщения при crash.

**Аргументы ПРОТИВ:**

1. **Celery Beat** — у Taskiq нет встроенного планировщика. Решение: `taskiq-cron` или `APScheduler`.
2. **Зрелость** — Taskiq 2 года vs Celery 12+ лет. Решение: миграция после стабилизации на новом сервере.
3. **Flower monitoring** — нет аналога для Taskiq. Решение: Prometheus metrics.

**Пересмотренная рекомендация: МИГРИРОВАТЬ НА TASKIQ, но на Phase 2 (после переезда)**

| Критерий        | Celery (текущий)             | Taskiq (target)             |
| --------------- | ---------------------------- | --------------------------- |
| RAM на 12 tasks | ~3-4 ГБ (2 workers × 6 proc) | ~0.5-1 ГБ (1 worker, async) |
| FastAPI DI      | Нет                          | Да                          |
| Async native    | Нет                          | Да                          |
| Scheduler       | Beat (встроен)               | taskiq-cron (отдельно)      |
| Broker          | Redis List                   | Redis Stream (надёжнее)     |

### Docker Compose → Podman Compose: ПЕРЕСМОТРЕНО — мигрировать

v1 рекомендовал оставить Docker Compose. Пересматриваю.

**Аргументы ЗА миграцию на Podman:**

1. **Rootless by design** — Docker rootless работает, но не является дефолтом. Podman rootless из коробки.
2. **Daemonless** — нет dockerd. Если daemon упадёт в Docker — ВСЕ контейнеры падают. В Podman каждый контейнер независим.
3. **systemd integration** — контейнеры как systemd сервисы. Auto-restart, dependency management, журналирование через journald.
4. **Podman Quadlet** — декларативные unit-файлы для контейнеров, лучше чем restart policies Docker.
5. **Совместимость** — `podman-compose` читает docker-compose.yml без изменений. `alias docker=podman` работает.
6. **Новый сервер = чистый лист** — не нужно мигрировать, просто ставим Podman вместо Docker.

**Аргументы ПРОТИВ:**

1. **Compose compatibility** — не все фичи docker-compose поддержаны (healthcheck expressions, некоторые volume опции).
2. **CI/CD** — GitHub Actions используют Docker. Решение: CI остаётся на Docker, production на Podman.

**Пересмотренная рекомендация: PODMAN на новом сервере**

Поскольку ставим всё с нуля — нет причин тащить Docker daemon. Podman + systemd Quadlet = production-grade контейнеризация без единой точки отказа.

### Frontend static files: убрать отдельный контейнер

v1 предполагал Frontend контейнер (256 МБ). Это legacy — React SPA это статические файлы.

**Пересмотренная рекомендация:**

- Build frontend в CI → артефакт `dist/`
- Caddy отдаёт статику напрямую (file_server)
- Убираем Node.js runtime из production
- Экономия: 256 МБ RAM + 1 контейнер

```
fancai.ru {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle {
        root * /srv/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

---

## Часть 3: Аналитика максимальной нагрузки

### Методология

Модель нагрузки строится на **3 уровнях:**

1. **API throughput** — сколько HTTP-запросов/сек выдержит backend
2. **Background processing** — сколько книг/изображений обработает одновременно
3. **External API limits** — реальные ограничения Gemini/Imagen

### 3.1 API Throughput (HTTP-запросы)

**Конфигурация:**

- Granian: 4 workers × 2 threads = 8 параллельных обработчиков
- PostgreSQL: max 100 connections, pool 20+40 overflow
- Valkey: max 50 connections

**Типы запросов и их стоимость:**

| Тип запроса                      | Latency (avg) | DB queries       | Доля трафика |
| -------------------------------- | ------------- | ---------------- | ------------ |
| GET /books/ (список)             | 15ms          | 1-2 SELECT       | 25%          |
| GET /chapters/{cfi} (чтение)     | 20ms          | 1 SELECT + cache | 40%          |
| POST /reading-sessions/heartbeat | 10ms          | 1 UPDATE         | 20%          |
| GET /entities/book/{id}          | 50ms          | 3-5 JOIN         | 10%          |
| POST /images/generate            | 5ms (async)   | 1 INSERT         | 3%           |
| Other (auth, profile, etc.)      | 30ms          | 1-3 queries      | 2%           |

**Средневзвешенная latency:** ~20ms per request

**Теоретический максимум:**

```
8 workers × (1000ms / 20ms) = 400 RPS
```

**Реальный максимум (с учётом DB/cache overhead):**

```
~250-300 RPS (при P95 < 100ms)
```

**Перевод в одновременных пользователей:**

Активный читатель генерирует:

- Heartbeat: 1 req / 30 сек
- Page turn + chapter load: 1 req / 60 сек (в среднем)
- Entity check: 1 req / 120 сек
- **Итого: ~4 requests/min = 0.067 RPS на пользователя**

```
Max concurrent readers = 300 RPS / 0.067 RPS = ~4,500 пользователей
```

**Но** при активных действиях (загрузка книги, просмотр профиля, листание сущностей):

```
Active user = ~10-15 requests/min = 0.25 RPS
Max concurrent active = 300 / 0.25 = ~1,200 пользователей
```

### 3.2 Background Processing (книги и изображения)

#### Обработка книг

**Один process_book task:**

- 100 глав × 170 API calls ≈ **3-часовое окно** (soft limit)
- Реальное время: **30-90 минут** (зависит от API latency)
- RAM: 500 МБ - 1.5 ГБ (зависит от размера книги)
- Concurrency внутри: asyncio.Semaphore(10) — до 10 глав параллельно

**Ограничения:**

| Фактор                       | Лимит                | Bottleneck? |
| ---------------------------- | -------------------- | ----------- |
| Celery workers × concurrency | 2 × 6 = 12 tasks     | Нет         |
| RAM (8 ГБ на Celery)         | ~8-10 книг по 1 ГБ   | Средний     |
| Gemini API Paid Tier 1       | 300 RPM / 1,500 RPD  | **ДА**      |
| PostgreSQL connections       | 60 available         | Нет         |
| NVMe I/O                     | 100 ГБ, ~3 ГБ/с read | Нет         |

**Расчёт максимума книг:**

```
Gemini Paid Tier 1: 300 RPM = 18,000 requests/hour

Одна книга (100 глав): ~170 API calls
При 10 параллельных главах: ~17 RPM на книгу

Max параллельных книг = 300 RPM / 17 RPM = ~17 книг
Но RPD лимит: 1,500 / 170 = ~8-9 книг в день
```

**Итого при Gemini Paid Tier 1:**

- Одновременно: **до 17 книг** (RPM ограничение)
- В день: **8-9 книг** (RPD ограничение)
- В месяц: **~250-270 книг**

**При апгрейде на Tier 2 (RPM/RPD растут):**

- Одновременно: **до 50+ книг** (серверных ресурсов хватит)
- В день: **50+ книг**

#### Генерация изображений

**Один generate_image_task:**

- Перевод через Gemini: ~2с (кэшируется)
- Imagen API: ~5-15с
- **Итого: ~10-20с на изображение**

**Ограничения:**

| Фактор     | Free tier | Paid Tier 1 |
| ---------- | --------- | ----------- |
| Imagen IPM | 2         | 300         |
| Imagen RPD | 100       | —           |
| Стоимость  | $0        | $0.02/image |
| Max/hour   | 120       | 18,000      |
| Max/day    | 100       | ~432,000    |

**Расчёт пользовательских квот:**

Free plan: 50 images/month
Premium: 500 images/month

```
Free tier API (100 images/day):
  2 free пользователя × 50/month = 100/month → 3-4 images/day average
  Сервер обслужит: ~25-30 active free users per day

Paid Tier 1 API ($0.02/image):
  100 premium users × 500/month = 50,000/month = ~1,700/day
  Стоимость: $1,000/month (!!)
  Сервер: легко (300 IPM)
```

### 3.3 Storage и дисковое пространство

**100 ГБ NVMe распределение:**

| Компонент                    | Размер        | Расчёт                                        |
| ---------------------------- | ------------- | --------------------------------------------- |
| OS + Docker images           | 10 ГБ         | Фиксированная                                 |
| PostgreSQL data              | 5-15 ГБ       | ~50 МБ/книга (entities, descriptions, events) |
| Uploaded books               | 5-20 ГБ       | ~20 МБ avg × 500 книг = 10 ГБ                 |
| Generated images             | 10-30 ГБ      | ~500 КБ/image × 50K = 25 ГБ                   |
| Valkey data                  | 2 ГБ          | Cache + queues                                |
| Logs                         | 2-5 ГБ        | С ротацией                                    |
| Backups (pgBackRest)         | 10-20 ГБ      | Incremental                                   |
| Monitoring (VictoriaMetrics) | 5-10 ГБ       | 6 months retention                            |
| **Запас**                    | **~10-30 ГБ** |                                               |

**Ёмкость по книгам:**

```
При 50 МБ DB + 20 МБ файл + 500 КБ × 100 images на книгу:
~120 МБ на книгу total

100 ГБ available / 120 МБ = ~800 книг
С учётом overhead: ~500-600 книг комфортно
```

### 3.4 Итоговая модель нагрузки

```
┌─────────────────────────────────────────────────────┐
│           CAPACITY MODEL: 12 CPU / 32 GB / 100 GB   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  HTTP API Layer                                      │
│  ├─ Max RPS: ~300 (P95 < 100ms)                     │
│  ├─ Concurrent readers: ~4,500                       │
│  ├─ Concurrent active users: ~1,200                  │
│  └─ WebSocket connections: ~500 (Caddy limit)        │
│                                                      │
│  Background Processing (Gemini Paid Tier 1)          │
│  ├─ Parallel book processing: 17                     │
│  ├─ Books per day: 8-9                               │
│  ├─ Books per month: ~250                            │
│  ├─ Images per day: unlimited by server              │
│  └─ Images per day: 100 (Free) / unlimited (Paid)   │
│                                                      │
│  Storage                                             │
│  ├─ Total books capacity: ~500-600                   │
│  ├─ Total images capacity: ~50,000                   │
│  └─ DB growth: ~50 МБ/book                           │
│                                                      │
│  Real Bottleneck: GEMINI API RATE LIMITS             │
│  ├─ Free: 1.5 books/day, 100 images/day             │
│  ├─ Tier 1: 9 books/day, unlimited images ($)       │
│  └─ Tier 2: 50+ books/day                            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## Часть 4: Рекомендации по тарифам

### Модель себестоимости на пользователя

**Одноразовые расходы (при первой загрузке книги):**

| Действие                 | Gemini calls | Imagen calls | Стоимость      |
| ------------------------ | ------------ | ------------ | -------------- |
| Парсинг книги (100 глав) | ~170         | 0            | ~$0.05-0.15    |
| Entity synthesis         | ~50          | 0            | ~$0.02-0.05    |
| **Итого на книгу**       | **~220**     | **0**        | **$0.07-0.20** |

**Ежемесячные расходы (на активного пользователя):**

| Действие                             | Gemini calls | Imagen calls | Стоимость   |
| ------------------------------------ | ------------ | ------------ | ----------- |
| Генерация изображений (Free: 50)     | 50 (перевод) | 50           | $1.00       |
| Генерация изображений (Premium: 500) | 500          | 500          | $10.00      |
| Чтение (API calls)                   | 0            | 0            | $0 (сервер) |

### Предлагаемые тарифы

#### Free tier

- 3 книги
- 50 изображений/месяц
- **Себестоимость: ~$1.20/месяц** (при активном использовании)
- **Рекомендация:** Конверсия в Premium через value proposition

#### Premium tier — $4.99/месяц

- 50 книг
- 500 изображений/месяц
- **Себестоимость: ~$10.15/месяц** (при максимальном использовании!)
- **Проблема: УБЫТОЧНЫЙ при текущих ценах Imagen**
- **Решение 1:** Поднять цену до $14.99/месяц
- **Решение 2:** Снизить лимит до 200 изображений ($4.00 себестоимость)
- **Решение 3:** Кэширование — не генерировать одинаковые изображения повторно

#### Ultimate tier — $14.99/месяц

- Unlimited книг (до capacity ~600)
- 2,000 изображений/месяц
- **Себестоимость: ~$40/месяц при максимуме**
- **Нужно:** Ограничить фактическое использование или поднять цену до $29.99

### Оптимизация стоимости AI API

| Оптимизация                                                  | Экономия         | Сложность            |
| ------------------------------------------------------------ | ---------------- | -------------------- |
| **Gemini Context Caching**                                   | До 90% на Gemini | Средняя              |
| **Image deduplication** (не генерить одно и то же)           | 30-50% на Imagen | Низкая               |
| **Batch API для книг** (50% скидка, async)                   | 50% на Gemini    | Средняя              |
| **Gemini Imagen** вместо Imagen 4 (бесплатно для text→image) | До 100%          | Требует тестирования |
| **Prompt caching** в Redis (уже частично есть)               | 10-20%           | Уже есть             |

**С оптимизациями:**

- Gemini: $0.07-0.20 → $0.01-0.05 на книгу (context caching + batch)
- Imagen: $0.02/image → $0.01/image (dedup) или $0 (Gemini native image gen)

---

## Часть 5: Пересмотренная итоговая таблица

| #   | Компонент         | v1 рекомендация     | v2 рекомендация                           | Изменение     |
| --- | ----------------- | ------------------- | ----------------------------------------- | ------------- |
| 1   | Reverse Proxy     | Caddy 2.x           | **Caddy 2.x**                             | Без изменений |
| 2   | ASGI Server       | Granian             | **Granian**                               | Без изменений |
| 3   | Cache/Broker      | Valkey 8.x          | **Valkey 8.x**                            | Без изменений |
| 4   | Task Queue        | Оставить Celery     | **Taskiq (Phase 2)**                      | ПЕРЕСМОТРЕНО  |
| 5   | Database          | PostgreSQL (тюнинг) | **PostgreSQL (тюнинг)**                   | Без изменений |
| 6   | Connection Pool   | Добавить PgBouncer  | **НЕ нужен на Phase 1**                   | ПЕРЕСМОТРЕНО  |
| 7   | Orchestration     | Docker Compose      | **Podman + systemd Quadlet**              | ПЕРЕСМОТРЕНО  |
| 8   | Monitoring        | VictoriaMetrics     | **VictoriaMetrics**                       | Без изменений |
| 9   | Backups           | pgBackRest          | **pgBackRest**                            | Без изменений |
| 10  | Gemini model      | Не упомянуто        | **Миграция на 2.5 Flash + Context Cache** | НОВОЕ (P0!)   |
| 11  | Frontend serving  | Отдельный контейнер | **Статика через Caddy**                   | НОВОЕ         |
| 12  | Cost optimization | Не упомянуто        | **Imagen dedup + Batch API + Cache**      | НОВОЕ         |

---

## Часть 6: Пересмотренное распределение ресурсов

### RAM (32 ГБ) — v2

| Сервис                       | v1         | v2       | Изменение                          |
| ---------------------------- | ---------- | -------- | ---------------------------------- |
| PostgreSQL                   | 10 ГБ      | 10 ГБ    | =                                  |
| Valkey                       | 2 ГБ       | 2 ГБ     | =                                  |
| Backend (Granian, 6 workers) | 4 ГБ       | 5 ГБ     | +1 ГБ (6 вместо 4 workers)         |
| Celery Workers               | 8 ГБ       | 6 ГБ     | -2 ГБ (2 workers × 6, не 8 × 1 ГБ) |
| Celery Beat                  | 256 МБ     | 256 МБ   | =                                  |
| ~~PgBouncer~~                | ~~128 МБ~~ | 0        | Убран                              |
| Caddy                        | 128 МБ     | 128 МБ   | =                                  |
| ~~Frontend container~~       | ~~128 МБ~~ | 0        | Убран (статика через Caddy)        |
| VictoriaMetrics + Grafana    | 1.5 ГБ     | 1.5 ГБ   | =                                  |
| pgBackRest                   | 512 МБ     | 512 МБ   | =                                  |
| OS + Podman                  | 3 ГБ       | 2.5 ГБ   | -0.5 ГБ (Podman daemonless)        |
| **Запас**                    | **2.5 ГБ** | **5 ГБ** | +2.5 ГБ                            |

### CPU (12 ядер) — v2

| Сервис              | v1            | v2                   | Причина                           |
| ------------------- | ------------- | -------------------- | --------------------------------- |
| PostgreSQL          | 4             | 4                    | Без изменений                     |
| Granian             | 3 (4w×2t)     | 4 (6w×2t)            | +1 worker для лучшего throughput  |
| Celery              | 4 (8 workers) | 3 (2w×6c, I/O-bound) | I/O-bound задачи не нагружают CPU |
| System + monitoring | 1             | 1                    | Без изменений                     |

---

## Часть 7: Пересмотренный план миграции

### Phase 0: Аварийный фикс (НЕМЕДЛЕННО, до 3 марта 2026)

1. **Мигрировать Gemini модель с 2.0-flash на 2.5-flash**
2. Включить context caching для повторяющихся промптов
3. Протестировать на staging

### Phase 1: Подготовка инфраструктуры (1 неделя)

1. Арендовать новый сервер на vdsina.com
2. Установить Podman + podman-compose
3. Создать /data/fancai/ структуру (bind mounts)
4. Написать docker-compose.v2.yml:
   - Caddy (вместо Nginx)
   - Valkey (вместо Redis)
   - Granian (вместо Gunicorn+Uvicorn)
   - PostgreSQL 17 (с тюнингом 32 ГБ)
   - Celery (пока оставляем, Taskiq на Phase 3)
5. Протестировать stack без данных

### Phase 2: Миграция (4-6 часов downtime в off-peak)

1. За 7 дней: DNS TTL → 60s
2. Maintenance mode на старом сервере
3. pg_dump --format=custom → scp → pg_restore на новом
4. rsync /data/fancai/uploads/
5. Поднять сервисы на новом сервере
6. Переключить DNS A-запись
7. Caddy автоматически получит SSL
8. Smoke tests (API health, book loading, image generation)
9. Мониторинг 24h, старый сервер в standby

### Phase 3: Оптимизация (после стабилизации, 2-4 недели)

1. Настроить pgBackRest + automated backups
2. Настроить VictoriaMetrics + Grafana dashboards
3. Мигрировать Celery → Taskiq
4. Внедрить Gemini Context Caching
5. Внедрить Imagen image deduplication
6. Load testing (wrk/k6)
7. Настроить alerting (Grafana → Telegram)

---

## Часть 8: Ответы на ключевые вопросы

### Сколько одновременных пользователей выдержит сервер?

| Сценарий                      | Concurrent users                   | Лимитирующий фактор       |
| ----------------------------- | ---------------------------------- | ------------------------- |
| Только чтение книг            | **4,500**                          | Backend RPS (300)         |
| Чтение + навигация            | **1,200**                          | Backend RPS (300)         |
| Чтение + обработка книг       | **1,200 читателей + 17 процессов** | Gemini API RPM            |
| Чтение + генерация картинок   | **1,200 + 300 IPM**                | Imagen API (Paid)         |
| **Максимальный реалистичный** | **~500 DAU, ~50-80 concurrent**    | Контент (количество книг) |

### Сколько книг обработает одновременно?

| API Tier    | Параллельно | В день | В месяц |
| ----------- | ----------- | ------ | ------- |
| Free        | 1           | 1-2    | ~40     |
| Paid Tier 1 | 17          | 8-9    | ~250    |
| Paid Tier 2 | 50+         | 50+    | 1,500+  |

### Рекомендации для тарифов

| Тариф   | Цена   | Книг | Изобр./мес | Себестоимость (макс.) | Margin |
| ------- | ------ | ---- | ---------- | --------------------- | ------ |
| Free    | $0     | 3    | 30         | $0.70                 | -$0.70 |
| Reader  | $4.99  | 20   | 100        | $2.50                 | +$2.49 |
| Creator | $9.99  | 50   | 300        | $6.50                 | +$3.49 |
| Pro     | $19.99 | 200  | 1,000      | $20.50                | -$0.51 |

**Ключевой инсайт:** Тариф Pro убыточен при максимальном использовании. Нужно:

- Snizить лимит изображений на Pro до 500 ($10.50 себестоимость, +$9.49 margin)
- ИЛИ внедрить image dedup/caching (снизит себестоимость на 30-50%)
- ИЛИ перейти на Gemini native image gen (бесплатно, но качество ниже)

---

## Источники

### Gemini API

- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 2.5 Context Caching](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)
- [Gemini 3 Flash](https://blog.google/innovation-and-ai/technology/developers-tools/build-with-gemini-3-flash/)
- [Gemini API Free Tier Slash](https://www.howtogeek.com/gemini-slashed-free-api-limits-what-to-use-instead/)

### Imagen API

- [Imagen 4 Pricing](https://www.imagine.art/blogs/imagen-4-pricing)
- [AI Image Pricing Comparison 2026](https://intuitionlabs.ai/articles/ai-image-generation-pricing-google-openai)
- [Imagen 4 Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate)

### Task Queues

- [Taskiq Documentation](https://taskiq-python.github.io/)
- [Taskiq FastAPI Integration](https://github.com/taskiq-python/taskiq-fastapi)
- [TaskIQ — The Celery for FastAPI](https://www.nahid.link/posts/taskiq-the-celery-for-fastapi)

### Containers

- [Podman vs Docker 2026](https://last9.io/blog/podman-vs-docker/)
- [How to Use Podman Compose 2026](https://oneuptime.com/blog/post/2026-01-27-podman-compose/view)
- [Docker to Podman Migration](https://oneuptime.com/blog/post/2026-01-16-docker-to-podman-migration/view)

### Capacity Planning

- [FastAPI Scaling](https://medium.com/@aahana.khanal11/scaling-a-fastapi-application-handling-multiple-requests-at-once-e5c128720c95)
- [FastAPI Gunicorn Config Discussion](https://github.com/fastapi/fastapi/discussions/7351)
- [Granian GitHub](https://github.com/emmett-framework/granian)
