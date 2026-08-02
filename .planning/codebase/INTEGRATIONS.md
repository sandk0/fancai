# External Integrations

**Дата анализа:** 2026-03-04

> **Historical codebase snapshot.** OpenRouter-only описание ниже верно для 2026-03-04,
> но superseded Gemini Direct/Vertex cutover 2026-06-16. Актуальные integration routes —
> [`docs/architecture/ai-pipeline.md`](../../docs/architecture/ai-pipeline.md), production
> evidence и gaps — [`.planning/STATE.md`](../STATE.md).

## AI-сервисы

**OpenRouter (основной AI-провайдер):**
- Используется для ВСЕХ AI-вызовов — LLM и генерация изображений
- SDK/клиент: `httpx.AsyncClient` (без OpenAI SDK), реализован в `backend/app/core/openrouter_client.py`
- Auth: `OPENROUTER_API_KEY` (НЕ GOOGLE_API_KEY)
- Базовый URL: `https://openrouter.ai/api/v1`
- Заголовки: `HTTP-Referer: https://fancai.ru`, `X-Title: fancai`

**LLM (текстовая генерация) — через OpenRouter:**
- Основная модель: `google/gemini-3-flash-preview`
- Первый fallback: `anthropic/claude-haiku-4.5`
- Второй fallback: `google/gemini-2.5-flash-lite`
- Цепочка fallback срабатывает только на `httpx.HTTPStatusError` (5xx) и `httpx.TimeoutException`
- `json.JSONDecodeError` и `ValidationError` НЕ вызывают fallback
- Методы клиента: `generate_text()` (JSON mode), `generate_structured()` (JSON Schema)
- Особенность: `_inline_defs()` разворачивает `$defs/$ref` для Google-моделей через OpenRouter

**Генерация изображений — через OpenRouter:**
- Модель: `black-forest-labs/flux.2-klein-4b` (FLUX.2 Klein 4B)
- Метод: `/chat/completions` с `modalities=["image"]` — НЕ `/images/generations`
- Ответ: `choices[0].message.images[0].image_url.url` (base64 data URL)
- Настройка в `config.py`: `OPENROUTER_IMAGE_MODEL`
- Реализация: `backend/app/services/imagen_generator.py` → вызывает `openrouter_client.generate_image()`
- Промпты переводятся RU→EN перед отправкой в FLUX

**Pollinations.ai (вторичный, опциональный):**
- Feature flag: `POLLINATIONS_ENABLED` (env)
- Используется как fallback или альтернатива в `backend/app/services/vless_http_client.py`
- VLESS-прокси: при `USE_VLESS_PROXY=true` запросы к `pollinations.ai` идут через `socks5://vless-proxy:1080` или `http://vless-proxy:8123`

## Хранилище данных

**PostgreSQL 17.9 (Alpine):**
- Основная БД приложения
- Подключение: `DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}`
- ORM: SQLAlchemy 2.0 async + asyncpg 0.31.0
- Pool: `DB_POOL_SIZE=20`, `DB_MAX_OVERFLOW=40`, `DB_POOL_RECYCLE=3600`
- Миграции: Alembic 1.18.4, 48 файлов в `backend/alembic/versions/`
- 18 моделей в `backend/app/models/`
- Production: `shared_buffers=4GB`, `effective_cache_size=8GB`, `max_connections=150`
- Development: `shared_buffers=256MB`, `max_connections=50`

**Redis 7.4.8 (Alpine) — три логических БД:**
- DB 0: кеш приложения (`REDIS_URL=redis://:...@redis:6379/0`)
  - TTL по умолчанию: 3600 сек, политика `volatile-lru`
  - Реализация: `backend/app/core/cache.py` (CacheManager + DistributedLock)
- DB 1: Celery broker (`CELERY_BROKER_URL=redis://:...@redis:6379/1`) — НЕ сбрасывать
- DB 2: Celery results backend (`CELERY_RESULT_BACKEND=redis://:...@redis:6379/2`)
- Production maxmemory: 640MB, dev: 256MB
- КРИТИЧНО: Redis DB 1 (broker) нельзя сбрасывать — потеря задач Celery

**IndexedDB (браузер, фронтенд):**
- Библиотека: Dexie 4.2.1 + dexie-react-hooks 4.2.0
- Назначение: offline-кеш глав EPUB, изображений
- Реализация: `frontend/src/services/chapterCache.ts`, `frontend/src/services/db.ts`
- Offline-first: книги доступны без сети после загрузки

**Файловое хранилище (локальное):**
- Директория: `backend/storage/` (монтируется в Docker)
- Сгенерированные изображения: `backend/storage/images/`
- Загруженные книги (EPUB/FB2): `backend/uploads/`
- Caddy отдаёт статику напрямую через `/storage/*` без проксирования на бэкенд

## Аутентификация и идентификация

**Собственная реализация (без внешнего провайдера):**
- JWT access token (HS256) + refresh token
- Access token: 7 дней (10080 мин) — увеличено для reading app UX
- Refresh token: 30 дней
- Реализация: `backend/app/services/auth_service.py`
- JWT библиотека: `PyJWT[crypto]==2.10.1` (заменил python-jose в феврале 2026)
- Хеширование паролей: bcrypt 5.0.0
- Token blacklist: Redis (`backend/app/services/token_blacklist.py`)
- Токен читается из `Authorization: Bearer` заголовка ИЛИ HttpOnly cookie `access_token`
- Сброс пароля: email-токен через Yandex Postbox

## Мониторинг и наблюдаемость

**Hawk Tracker (hawk-tracker.ru) — трекер ошибок:**
- НЕ Sentry — используется hawk-tracker.ru
- Backend: `hawk-python-sdk[fastapi]==3.5.2` — FastAPI middleware + Celery signals
  - Конфигурация: `backend/app/core/hawk.py`
  - Auth: `HAWK_TOKEN` (env)
- Frontend: `@hawk.so/javascript ^3.2.18`
  - Конфигурация: `frontend/src/config/hawk.ts`
  - Auth: `VITE_HAWK_TOKEN` (build arg, встраивается в бандл)
- Graceful skip при отсутствии токена

**Prometheus + Netdata + VictoriaMetrics:**
- Backend экспортирует метрики: `prometheus-client==0.24.1` + `prometheus-fastapi-instrumentator==7.1.0`
- Эндпоинт: `/health/metrics` (basic auth через `METRICS_PASSWORD`)
- Метрики: LLM запросы/ошибки/токены/стоимость, reading sessions, активные пользователи
- Реализация: `backend/app/monitoring/metrics.py`, `backend/app/monitoring/middleware.py`
- Netdata v2.5.0 — системные метрики хоста + scraping Prometheus-метрик бэкенда
- VictoriaMetrics v1.112.0 — долгосрочное хранение (90 дней retention)
- Дашборд мониторинга: `monitor.fancai.ru` (basic auth, Caddy)

**Uptime Kuma 2.4.1:**
- Мониторинг доступности сервисов
- Доступен через `monitor.fancai.ru/uptime/`

**Dozzle v10.0.3:**
- Просмотр логов Docker-контейнеров в реальном времени
- Доступен через `monitor.fancai.ru/dozzle/`

## Email

**Yandex Cloud Postbox (AWS SES v2 compatible):**
- Используется для: сброс пароля, уведомления
- SDK: `aioboto3==15.5.0` (boto3-совместимый async)
- Реализация: `backend/app/services/email/yandex_postbox.py`
- Auth env vars: `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY`
- Endpoint: `https://postbox.cloud.yandex.net` (ru-central1)
- From: `noreply@fancai.ru`
- Feature flag: `EMAIL_ENABLED=false` по умолчанию

## Web Push уведомления

**Web Push API (VAPID):**
- Библиотека: `pywebpush==2.3.0`
- Реализация: `backend/app/services/push_notification_service.py`
- Auth: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:admin@fancai.ru`
- Frontend: `frontend/src/services/pushNotifications.ts`, хук `usePushNotifications.ts`
- Модель подписки: `backend/app/models/push_subscription.py`
- Отправка из Celery задач поддерживается (VAPID keys доступны в env воркера)

## CI/CD и деплой

**Хостинг:**
- Production: VPS с 32GB RAM, 12 vCPU (https://fancai.ru)
- Docker Compose V2 (`docker-compose.prod.yml`)
- Reverse proxy: Caddy 2.11.1 (автоматический TLS через Let's Encrypt, HTTP/3)

**CI Pipeline:**
- Не обнаружен (нет `.github/workflows/` или `.gitlab-ci.yml`)

**Deploy:**
- Ручной через `/deploy` skill (`.claude/skills/deploy/SKILL.md`)
- Команда: `docker compose -f docker-compose.prod.yml up -d --build`

## WebSocket

**Входящие (бэкенд слушает):**
- `/ws/{book_id}` — прогресс обработки книги в реальном времени
  - Реализация: `backend/app/routers/websocket.py`
  - ConnectionManager управляет активными соединениями по `book_id`
  - Celery публикует прогресс через Redis pub/sub (`backend/app/core/pubsub.py`)

**Исходящие (бэкенд инициирует):**
- Нет исходящих webhook-вызовов

## Платёжные системы (сконфигурированы, не активированы)

**YooKassa:**
- Config: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` в `backend/app/core/config.py`
- Статус: credentials в secrets check, но активная интеграция не обнаружена

**CloudPayments:**
- Config: `CLOUDPAYMENTS_PUBLIC_ID` в `backend/app/core/config.py`
- Статус: credentials в secrets check, но активная интеграция не обнаружена

## Конфигурация окружения

**Обязательные переменные (production):**
- `SECRET_KEY` — JWT signing (не может быть дефолтным)
- `DATABASE_URL` — PostgreSQL (asyncpg)
- `DB_USER`, `DB_PASSWORD`, `DB_NAME` — DB credentials
- `REDIS_URL`, `REDIS_PASSWORD` — Redis
- `CELERY_BROKER_URL` — Redis DB 1
- `CELERY_RESULT_BACKEND` — Redis DB 2
- `OPENROUTER_API_KEY` — все AI-сервисы
- `METRICS_PASSWORD` — защита `/health/metrics`
- `MONITOR_PASSWORD_HASH` — basic auth для `monitor.fancai.ru`

**Опциональные:**
- `HAWK_TOKEN` — Hawk Tracker backend
- `VITE_HAWK_TOKEN` — Hawk Tracker frontend (build arg)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push
- `YANDEX_POSTBOX_ACCESS_KEY` / `YANDEX_POSTBOX_SECRET_KEY` — email
- `POLLINATIONS_ENABLED` — Pollinations.ai fallback (default: true)
- `DOMAIN_URL`, `DOMAIN_NAME` — домен для CORS и Allowed Hosts

**Хранение секретов:**
- `.env` файл в корне проекта (не коммитится)
- Docker Compose передаёт через `environment:` блоки
- Проверка при старте бэкенда: `backend/app/core/secrets.py`

---

*Аудит интеграций: 2026-03-04*
