# Phase 4: Обслуживание инфраструктуры - Context

**Gathered:** 2026-03-02 (v3, после глубокого аудита)
**Status:** Ready for planning

<domain>
## Phase Boundary

Сервер мониторится в реальном времени (системные + кастомные бизнес-метрики + Docker + Celery), зависимости фронтенда и бэкенда обновлены до актуальных безопасных версий, PostgreSQL оптимизирован для 32GB RAM / 12 vCPU. Продакшен-сервера с пользователями сейчас нет — полная свобода для деструктивных изменений.

</domain>

<decisions>
## Implementation Decisions

### Мониторинг-стек: замена существующего

- **Удалить полностью** старый стек: `docker-compose.monitoring.yml` (Grafana 11.3 + Prometheus + Loki + Promtail + Node Exporter + cAdvisor — 6 контейнеров, ~1.5GB RAM)
- Удалить директорию `monitoring/` (конфиги Grafana, Prometheus, Loki, Promtail), **но сохранить `monitoring/prometheus/alerts/` как reference** для настройки алертов Netdata (17 alert rules, 88 дашборд-панелей — не мигрировать формально, использовать как шпаргалку)
- **Новый стек** (5 контейнеров, ~500-600MB RAM):
  - **Netdata v2.8** — системные метрики, Docker-контейнеры, PostgreSQL и Redis (built-in), Prometheus scraping `/metrics` endpoint, авто-дашборды, Telegram-алерты, 400+ предустановленных алертов (~150-200MB RAM)
  - **VictoriaMetrics single-node** — долгосрочное хранение метрик с первого дня, MetricsQL (надмножество PromQL), 7-10x эффективнее Prometheus по диску, remote_write из Netdata (~50-100MB RAM)
  - **Uptime Kuma 2.1** — мониторинг доступности endpoint'ов и Docker-контейнеров, Telegram с кастомными шаблонами, 90+ каналов уведомлений (~80MB RAM)
  - **Dozzle v10** — просмотр логов Docker в реальном времени, SQL-поиск, shell-доступ к контейнерам, вебхуки (~20MB RAM)
  - **Flower v2** — Celery Web UI + Prometheus /metrics в одном контейнере, мониторинг очередей, история задач, дебаг (~50-100MB RAM)
- Размещение: **отдельный `docker-compose.monitoring.yml`** (можно поднимать/опускать мониторинг независимо от основного приложения)

### Мониторинг: алерты и мониторы

- Алерты при даунтайме: **Telegram-бот** (встроенная поддержка Netdata + Uptime Kuma + Flower)
- Мониторы Uptime Kuma: **расширенный набор** — fancai.ru (главная), `/api/v1/health` (бэкенд + БД + Redis), `/api/v1/health/deep` (внутренний, через Docker-сеть), прямой пинг PostgreSQL, Redis, Docker container status checks (5+ мониторов)

### Мониторинг: доступ и защита

- Поддомен **`monitor.fancai.ru`** через Caddy для всех мониторинг-инструментов (Netdata, VictoriaMetrics, Uptime Kuma, Dozzle, Flower — по субпутям)
- Защита: **только Caddy basicauth** (без VPN/IP whitelist — упрощённый доступ с любого устройства)

### Мониторинг PostgreSQL

- **Только Netdata built-in** — авто-обнаружение PostgreSQL, базовые метрики (connections, query time, locks, buffer hit ratio). Без отдельного postgres_exporter

### Бизнес-метрики (3 волны)

**Результаты аудита кодовой базы:** 21 Prometheus-метрика определена, но 80% мёртвый код. ReadingSessionsMetricsMiddleware и update_gauges_periodically написаны, но не подключены. OpenRouter полностью игнорирует tokens/cost из ответов. В reading_sessions.py — 0 вызовов record_*. В Celery tasks — 0 метрик. В auth — 0 метрик.

**Wave 1 — Quick Wins (подключение существующего кода):**
- Подключить `prometheus-fastapi-instrumentator` в main.py (3 строки — http_requests_total, http_request_duration_seconds)
- Подключить `ReadingSessionsMetricsMiddleware` в main.py (1 строка — авто-сбор API latency для reading sessions)
- Запустить `update_gauges_periodically` background task (обновление gauges active/abandoned/concurrent каждые 30 сек)
- Wiring вызовов record_session_started/ended/updated/error в reading_sessions.py (проводка к существующим helper-функциям)
- Записывать OpenRouter usage/cost из ответов API — **Prometheus Counter `llm_cost_dollars_total` + таблица `llm_usage_log` в PostgreSQL** для истории расходов (новая миграция Alembic)
- Вызвать существующую `record_llm_tokens()` в openrouter_client.py (парсить `usage.prompt_tokens`, `usage.completion_tokens` из ответов)
- Добавить auth метрики (registrations, logins, login_failures)
- Добавить fallback Counter в openrouter_client.py (`llm_fallback_total(from_model, to_model)`)
- Добавить rate_limit метрику (`rate_limit_triggered_total`)

**Wave 2 — Business Metrics (новые метрики):**
- Book upload/parsing метрики (counters, histograms в book_service.py и book_tasks.py)
- Entity Wiki метрики (entities created/deduplicated, network query duration)
- Image generation метрики (отдельные Counter/Histogram, не смешивать с LLM text)

**Wave 3 — Infrastructure (настройка контейнеров):**
- Настроить Netdata с Prometheus scraping существующего /metrics endpoint (`go.d/prometheus`)
- Настроить Netdata remote_write в VictoriaMetrics (`exporting.conf`)
- Настроить Flower для Celery мониторинга (Web UI + Prometheus /metrics)
- Настроить Uptime Kuma с расширенным набором мониторов + Telegram
- Настроить Netdata Telegram-алерты

### Обновление зависимостей

- Объём: **фронтенд + бэкенд** (npm + pip)
- Стратегия: **по группам** — сначала фронтенд, потом бэкенд, каждый с отдельным коммитом и прогоном тестов
- Major-версии: **обновлять включая major** с breaking changes, исправлять сразу (пользователей нет — идеальный момент)
- Docker images: **pin к patch-версиям** для reproducible builds (конкретные версии исследовать на момент выполнения)
- `prometheus-fastapi-instrumentator`: **подключить** (уже установлен, 3 строки в main.py)

### PostgreSQL-тюнинг для 32GB RAM / 12 vCPU

- **Полный тюнинг сразу** (не только OPS-06):
  - `shared_buffers=8GB`
  - `effective_cache_size=24GB`
  - `huge_pages=try`
  - `wal_compression=zstd`
  - `work_mem=64MB`
  - `maintenance_work_mem=1GB`
  - `max_parallel_workers_per_gather=4`
  - `wal_buffers=64MB`
  - `checkpoint_completion_target=0.9`
  - `default_statistics_target=200`
- `shm_size: 10g` в docker-compose для postgres-контейнера
- Resource limits для postgres: **Claude's Discretion** (рассчитать оптимальные limits)
- Мониторинг PG: **только Netdata built-in** (auto-discover, без postgres_exporter)
- Стратегия применения: **прямое применение** без бэкапа (нет продакшен-данных/пользователей)

### Claude's Discretion

- Оптимальные memory limits для postgres-контейнера в docker-compose
- Конкретные patch-версии для pin Docker images (исследовать актуальные на момент выполнения)
- Структура субпутей на monitor.fancai.ru (какой инструмент на каком пути)
- Порядок обновления пакетов внутри групп (фронтенд/бэкенд)
- Netdata dbengine tier конфигурация (распределение диска между Tier 0/1/2)
- Конфигурация VictoriaMetrics retention и scrape interval
- Схема таблицы `llm_usage_log` (поля, индексы)

</decisions>

<specifics>
## Specific Ideas

- Netdata скрейпит существующий `/api/v1/health/metrics` endpoint через `go.d/prometheus` — код бэкенда для метрик не переписывается
- Netdata remote_write в VictoriaMetrics через `exporting.conf` — данные копятся для long-term анализа
- OpenRouter возвращает `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cost` в каждом ответе — парсить и записывать в Prometheus Counter + PostgreSQL таблицу
- `prometheus-fastapi-instrumentator` уже установлен в requirements.txt — 3 строки в main.py для generic HTTP-метрик
- `ReadingSessionsMetricsMiddleware` уже написан в `monitoring/middleware.py` — 1 строка в main.py для подключения
- `update_gauges_periodically` уже написана в `monitoring/middleware.py` — запустить как asyncio background task
- Flower v2 даёт и Web UI для дебага Celery задач, и Prometheus /metrics endpoint — два в одном
- Netdata имеет встроенный мониторинг PostgreSQL и Redis — не нужны отдельные exporters
- Netdata имеет 400+ предустановленных алертов — покрывают базовые кейсы без ручной настройки
- Старые Prometheus alert rules (17 шт) и Grafana дашборды (88 панелей) сохранить как reference при настройке Netdata
- Для PostgreSQL: `effective_cache_size` — не аллокация, а подсказка планировщику запросов

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets (подключить, не переписывать)
- `backend/app/monitoring/metrics.py` — 21 Prometheus-метрика (12 reading sessions + 9 LLM), 12 helper-функций record_*, MetricsCollector context manager
- `backend/app/monitoring/middleware.py` — ReadingSessionsMetricsMiddleware (авто-сбор API latency) + update_gauges_periodically (фоновое обновление gauges). **Оба написаны, не подключены — нужна 1 строка в main.py**
- `backend/app/routers/health.py` — 3 health endpoints + `/metrics` endpoint с Basic Auth (METRICS_USER/METRICS_PASSWORD). **Полностью работает**
- `prometheus-fastapi-instrumentator==7.1.0` — установлен в requirements.txt, **не подключён** (3 строки для подключения)
- `backend/app/core/openrouter_client.py` — записывает llm_requests_total и llm_errors_total, **но игнорирует tokens и cost**
- `backend/app/core/hawk.py` — Hawk Tracker для бэкенда (FastAPI middleware + Celery task_failure signal). **Полностью работает**
- `frontend/src/config/hawk.ts` + `ErrorBoundary.tsx` — Hawk Tracker для фронтенда. **Полностью работает**

### Мёртвый код (подключить или удалить)
- `record_llm_tokens()` — написана, никогда не вызывается
- `record_llm_cache_hit/miss()` — написаны, никогда не вызываются
- `MetricsCollector.measure_duration()` — написан, никогда не используется
- `update_active_sessions_gauge()` — содержит placeholder вместо реального кода для multi-device
- `reading_system_info` — хардкод `deployed_at: 2025-10-28`, устарел

### Established Patterns
- Prometheus-метрики через `prometheus_client` (Counter, Histogram, Gauge, Info)
- Helper-функции `record_*()` в metrics.py для инкапсуляции записи метрик
- `/metrics` endpoint защищён Basic Auth (METRICS_USER/METRICS_PASSWORD)
- Docker Compose с resource limits (deploy.resources.limits/reservations)
- Caddy как reverse proxy с volumes для Caddyfile и SSL-сертификатов
- Hawk Tracker (hawk-python-sdk + @hawk.so/javascript) для error tracking

### Integration Points
- `docker-compose.monitoring.yml` — перезаписать новым стеком (5 контейнеров)
- `docker-compose.prod.yml` — postgres service (тюнинг), Docker image versions (pin к patch)
- `Caddyfile` — добавить блок для monitor.fancai.ru с basicauth + субпути для 5 инструментов
- `backend/app/main.py` — подключить instrumentator + ReadingSessionsMetricsMiddleware + запустить update_gauges_periodically
- `backend/app/core/openrouter_client.py` — парсить usage/cost, вызывать record_llm_tokens(), писать в llm_usage_log
- `backend/app/routers/auth.py` — добавить auth метрики
- `backend/app/routers/reading_sessions.py` — wiring вызовов record_session_* (41K строк — осторожно)
- `backend/alembic/` — новая миграция для таблицы llm_usage_log
- `frontend/package.json` — обновление npm-зависимостей
- `backend/requirements.txt` — обновление pip-зависимостей
- `monitoring/prometheus/alerts/` — сохранить как reference, не удалять с директорией

</code_context>

<deferred>
## Deferred Ideas

- **Wave 4 аналитика** — PostgreSQL aggregate table (DAU/MAU, cost/day, books/day), Celery hourly task, cost alerts в Telegram — до появления пользователей
- **postgres_exporter** — если Netdata built-in мониторинг PG окажется недостаточно детальным
- **Grafana** — как дополнительный контейнер для кастомных дашбордов поверх VictoriaMetrics, если авто-дашборды Netdata окажутся недостаточными
- **OpenTelemetry** — миграция если появится микросервисная архитектура или потребность в distributed tracing
- **Loki** — persistent log aggregation, если Dozzle недостаточно для поиска/алертинга по логам
- **Frontend Web Vitals** — `web-vitals` библиотека для LCP/CLS/INP, отправка на свой endpoint через sendBeacon
- **OpenRouter Broadcast** — автоматическая отправка traces в Langfuse/Datadog без кода
- **Admin dashboard endpoint** (`/admin/analytics`) — JSON с ключевыми бизнес-метриками за 30 дней

</deferred>

---

*Phase: 04-infrastructure-maintenance*
*Context gathered: 2026-03-02 (v3, после аудита)*
