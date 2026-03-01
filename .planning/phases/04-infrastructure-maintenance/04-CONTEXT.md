# Phase 4: Обслуживание инфраструктуры - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Сервер мониторится в реальном времени (системные + кастомные бизнес-метрики + Docker + Celery), зависимости фронтенда и бэкенда обновлены до актуальных безопасных версий, PostgreSQL оптимизирован для 32GB RAM / 12 vCPU. Продакшен-сервера с пользователями сейчас нет — полная свобода для деструктивных изменений.

</domain>

<decisions>
## Implementation Decisions

### Мониторинг-стек: замена существующего

- **Удалить полностью** старый стек: `docker-compose.monitoring.yml` (Grafana 11.3 + Prometheus + Loki + Promtail + Node Exporter + cAdvisor — 6 контейнеров, ~1.5GB RAM)
- Удалить директорию `monitoring/` (конфиги Grafana, Prometheus, Loki, Promtail)
- **Новый стек** (5 контейнеров, ~450MB RAM):
  - **Netdata v2.8** — системные метрики, Docker-контейнеры, Prometheus scraping, авто-дашборды, Telegram-алерты (~200MB RAM)
  - **VictoriaMetrics single-node** — долгосрочное хранение метрик 12+ месяцев с полным разрешением, MetricsQL (~100MB RAM)
  - **Uptime Kuma :2** — мониторинг доступности, расширенный набор (~80MB RAM)
  - **Dozzle v9.0** — просмотр логов Docker-контейнеров (~30-50MB RAM)
  - **celery-exporter** — метрики очередей и задач Celery (~50MB RAM)
- Размещение: **отдельный `docker-compose.monitoring.yml`** (можно поднимать/опускать мониторинг независимо от основного приложения)

### Мониторинг: алерты и мониторы

- Алерты при даунтайме: **Telegram-бот** (встроенная поддержка Netdata + Uptime Kuma)
- Мониторы Uptime Kuma: **расширенный набор** — fancai.ru (главная), `/api/v1/health` (бэкенд + БД + Redis), прямой пинг PostgreSQL, Redis, Celery worker внутри Docker-сети (5+ мониторов)

### Мониторинг: доступ и защита

- Поддомен **`monitor.fancai.ru`** через Caddy для всех мониторинг-инструментов (Netdata, VictoriaMetrics, Uptime Kuma, Dozzle — по субпутям)
- Защита: **Caddy basicauth + IP whitelist** по VPN-подсети (WireGuard)
- Два уровня: без VPN вообще не попасть, с VPN нужен ещё логин/пароль

### Мониторинг: бизнес-метрики (4 волны)

Текущее состояние: 21 кастомная метрика определена, но критические проблемы — `prometheus-fastapi-instrumentator` не подключён, `llm_tokens_total` не записывается, reading session counters мёртвые, Celery tasks без метрик.

**Wave 1 — Quick Wins (0 новых контейнеров):**
- Подключить `prometheus-fastapi-instrumentator` в main.py (3 строки — сразу даёт http_requests_total, http_request_duration_seconds)
- Записывать OpenRouter usage/cost из ответов API (парсить `data["usage"]`, добавить Counter `llm_cost_dollars_total`)
- Добавить auth метрики (registrations, logins, login_failures)
- Добавить fallback Counter в openrouter_client.py (`llm_fallback_total(from_model, to_model)`)
- Добавить rate_limit метрику (`rate_limit_triggered_total`)

**Wave 2 — Business Metrics:**
- Book upload/parsing метрики (counters, histograms в book_service.py и book_tasks.py)
- Entity Wiki метрики (entities created/deduplicated, network query duration)
- Image generation метрики (отдельные Counter/Histogram, не смешивать с LLM text)
- Celery task метрики (duration, success/failure/retry в каждой задаче)
- Исправить reading session helpers (вызывать record_session_started/ended или удалить мёртвый код)

**Wave 3 — Infrastructure:**
- Настроить Netdata с Prometheus scraping существующего /metrics endpoint
- Добавить celery-exporter контейнер
- Настроить Uptime Kuma с расширенным набором мониторов + Telegram
- Настроить VictoriaMetrics как long-term storage (12 месяцев, remote_write из Netdata)

**Wave 4 — Business Analytics:**
- PostgreSQL aggregate table для долгосрочной аналитики (DAU/MAU, cost/day, books/day)
- Celery hourly task для агрегации метрик
- Cost alerts в Telegram при превышении LLM-расходов

### Обновление зависимостей

- Объём: **фронтенд + бэкенд** (npm + pip)
- Стратегия: **по группам** — сначала фронтенд, потом бэкенд, каждый с отдельным коммитом и прогоном тестов
- Major-версии: **обновлять включая major** с breaking changes, исправлять сразу
- Docker images: **pin к patch-версиям** (`caddy:2.9.1-alpine`, `redis:7.4.2-alpine` и т.д.) для reproducible builds

### PostgreSQL-тюнинг для 32GB RAM / 12 vCPU

- **Полный тюнинг** (не только OPS-06):
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
- Resource limits для postgres: Claude's Discretion (нужно рассчитать оптимальные limits с учётом shared_buffers=8GB + effective_cache_size — hint для планировщика, не аллокация)
- Стратегия применения: **прямое применение** без бэкапа (нет продакшен-данных/пользователей)

### Claude's Discretion

- Оптимальные memory limits для postgres-контейнера в docker-compose
- Конкретные patch-версии для pin Docker images (исследовать актуальные на момент выполнения)
- Структура субпутей на monitor.fancai.ru (какой инструмент на каком пути)
- Порядок обновления пакетов внутри групп (фронтенд/бэкенд)
- Netdata dbengine tier конфигурация (распределение диска между Tier 0/1/2)
- Конфигурация VictoriaMetrics retention и scrape interval

</decisions>

<specifics>
## Specific Ideas

- Netdata скрейпит существующий `/api/v1/health/metrics` endpoint через `go.d/prometheus` — код бэкенда для метрик не переписывается
- OpenRouter возвращает `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cost` в каждом ответе — fancai сейчас полностью игнорирует эти данные, нужно парсить и записывать
- `prometheus-fastapi-instrumentator` уже установлен в requirements.txt, но не подключён в main.py — 3 строки кода дают базовые HTTP-метрики
- celery-exporter (`danihodovic/celery-exporter`) скрейпит Redis для queue metrics — дополняет встроенные метрики в tasks
- VictoriaMetrics принимает данные через Netdata remote_write (`exporting.conf`) или vmagent scrape
- Для PostgreSQL: `effective_cache_size` — не аллокация, а подсказка планировщику запросов (сколько кеша ОС доступно)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/app/monitoring/metrics.py` — 21 Prometheus-метрика (12 reading sessions + 9 LLM), helper-функции record_*
- `backend/app/monitoring/middleware.py` — middleware для автоматического сбора метрик reading sessions
- `backend/app/routers/health.py` — `/metrics` endpoint с Basic Auth, обновляет gauges при скрейпинге
- `prometheus-fastapi-instrumentator` — установлен в requirements.txt, не подключён (3 строки для подключения)
- `backend/app/core/openrouter_client.py` — OpenRouter клиент с fallback chain, место для добавления cost/token tracking

### Established Patterns
- Prometheus-метрики через `prometheus_client` (Counter, Histogram, Gauge, Info)
- Helper-функции `record_*()` в metrics.py для инкапсуляции записи метрик
- `/metrics` endpoint защищён Basic Auth (METRICS_USER/METRICS_PASSWORD)
- Docker Compose с resource limits (deploy.resources.limits/reservations)
- Caddy как reverse proxy с volumes для Caddyfile и SSL-сертификатов

### Integration Points
- `docker-compose.monitoring.yml` — текущий файл для перезаписи новым стеком
- `docker-compose.prod.yml` — postgres service (тюнинг параметров), Docker image versions (pin)
- `Caddyfile` — добавить блок для monitor.fancai.ru с basicauth + IP whitelist
- `backend/app/main.py` — подключить prometheus-fastapi-instrumentator
- `backend/app/core/openrouter_client.py` — добавить парсинг usage/cost из ответов
- `backend/app/routers/auth.py` — добавить auth метрики
- `backend/app/tasks/` — добавить Celery task метрики
- `frontend/package.json` — обновление npm-зависимостей
- `backend/requirements.txt` — обновление pip-зависимостей

</code_context>

<deferred>
## Deferred Ideas

- Grafana как 3-й контейнер для кастомных дашбордов — подключается к VictoriaMetrics если авто-дашборды Netdata окажутся недостаточными
- Admin dashboard endpoint (`/admin/analytics`) — JSON с ключевыми бизнес-метриками за 30 дней
- OpenTelemetry миграция — если появится микросервисная архитектура или потребность в distributed tracing
- Бэкап базы данных (DEPLOY-04) — отложен на следующие фазы

</deferred>

---

*Phase: 04-infrastructure-maintenance*
*Context gathered: 2026-03-02*
