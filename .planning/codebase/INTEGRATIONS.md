# Внешние интеграции

**Дата анализа:** 2026-02-27

## API и внешние сервисы

**AI / Машинное обучение:**
- Google Gemini 3.0 Flash (`gemini-3-flash-preview` / `gemini-2.0-flash`) — анализ глав, извлечение сущностей, извлечение описаний и перевод промптов с русского на английский
  - SDK/клиент: `google-genai` 1.61.0 (`backend/requirements.txt`)
  - Интеграция: `backend/app/services/gemini_extractor.py`
  - Аутентификация: переменная окружения `GOOGLE_API_KEY` или `LANGEXTRACT_API_KEY`
  - Вызывается через: `analyze_chapter()` — извлекает описания И сущности за один вызов
  - Повторные попытки: tenacity с экспоненциальной задержкой (`backend/app/core/retry.py`)

- Google Imagen 4 (`imagen-4.0-generate-001`) — AI-генерация иллюстраций по описаниям из книг
  - SDK/клиент: `google-genai` 1.61.0 (тот же SDK, что и для Gemini)
  - Интеграция: `backend/app/services/imagen_generator.py`, `backend/app/services/image_generator.py`
  - Аутентификация: переменная окружения `GOOGLE_API_KEY` (тот же ключ, что и для Gemini)
  - Конфигурация: `IMAGEN_ENABLED`, `IMAGEN_MODEL`, `IMAGEN_ASPECT_RATIO`, `IMAGEN_SAFETY_LEVEL`, `IMAGEN_TIMEOUT_SECONDS`
  - Доступные модели: `imagen-4.0-generate-001`, `imagen-4.0-fast-generate-001`, `imagen-4.0-ultra-generate-001`
  - **РЕШЕНИЕ Phase 3:** Мигрируется на OpenRouter image-модели (FLUX.2 Pro/Klein). google-genai SDK полностью удаляется. NSFW-фильтрация через отдельный механизм (Imagen 4 имел встроенный safety filter)

**Устаревшие / Опциональные AI (настроены, но не основные):**
- OpenAI — опционально; ключ настроен в `OPENAI_API_KEY`, активно не используется в основном пайплайне
- Midjourney — опционально; ключ настроен в `MIDJOURNEY_API_KEY`, активно не используется

## Хранение данных

**Базы данных:**
- PostgreSQL 15 (Docker: `postgres:15-alpine`)
  - Подключение: переменная окружения `DATABASE_URL` (`postgresql+asyncpg://...`)
  - Клиент: асинхронный движок SQLAlchemy 2.0 с драйвером asyncpg
  - ORM: SQLAlchemy 2.0 с `lazy="raise"` на всех связях (требуется явная жадная загрузка)
  - Миграции: Alembic (`backend/alembic/`)
  - Конфигурация: `backend/alembic.ini`, `backend/app/core/database.py`
  - Пул соединений: настраивается через `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_RECYCLE`, `DB_POOL_TIMEOUT`

**Очередь / Кеш:**
- Redis 7.4 (Docker: `redis:7.4-alpine`)
  - Подключение: переменная окружения `REDIS_URL` (`redis://:password@host:6379`)
  - Клиент: `redis.asyncio` (асинхронный Redis-клиент)
  - Используется для: Celery-брокер + бэкенд, кеш API-ответов, ограничение частоты запросов, распределённые блокировки, чёрный список токенов
  - Конфигурация: maxmemory 640MB, политика вытеснения `allkeys-lru`, AOF-персистентность включена
  - Интеграция: `backend/app/core/cache.py` (`CacheManager`, `DistributedLock`)

**Файловое хранилище:**
- Локальная файловая система (Docker-том: `uploaded_books`)
  - Путь: `backend/storage/` и `backend/uploads/`
  - Хранит: загруженные EPUB/FB2, сгенерированные изображения
  - Бэкап: ежедневно через Alpine-контейнер в `/root/backups/` (хранение 7 дней)

**Офлайн-хранилище фронтенда:**
- IndexedDB через Dexie.js 4.2.1 — кеширование глав, метаданных книг, очередь отложенной синхронизации
  - Интеграция: `frontend/src/services/db.ts` (централизованная база данных Dexie)
  - Кеш глав: `frontend/src/services/chapterCache.ts`
  - Кеш изображений: `frontend/src/services/imageCache.ts`
  - Очередь синхронизации: `frontend/src/services/syncQueue.ts` (offline-first очередь операций)

## Аутентификация и идентификация

**Провайдер аутентификации:**
- Собственный (без сторонних OAuth-провайдеров)
  - Реализация: JWT (HS256) с HttpOnly-куки
  - Типы токенов: Access-токен (7 дней) + Refresh-токен (30 дней)
  - Библиотека: `python-jose[cryptography]` 3.5.0 (генерация/валидация токенов)
  - Хеширование паролей: `passlib[bcrypt]` 1.7.4
  - Бэкенд: `backend/app/services/auth_service.py`, `backend/app/core/auth.py`
  - Чёрный список токенов: на основе Redis, для logout (`backend/app/services/token_blacklist.py`)
  - Фронтенд: `frontend/src/api/client.ts` (автоматическое обновление токена через axios-интерцептор), `frontend/src/stores/auth.ts`

## Мониторинг и наблюдаемость

**Отслеживание ошибок:**
- Sentry — `sentry-sdk[fastapi]` 2.51.0
  - Интеграция: FastAPI-интеграция (автоматически перехватывает исключения)
  - Конфигурация: переменная окружения `SENTRY_DSN` (явно не указана в `config.py`, но SDK установлен)

**Метрики:**
- Prometheus — `prometheus-client` 0.24.1 + `prometheus-fastapi-instrumentator` 7.1.0
  - Эндпоинт метрик: `/api/v1/health/metrics` (защищён Basic Auth через `METRICS_USER`/`METRICS_PASSWORD`)
  - Пользовательские метрики: сессии чтения, LLM-запросы, генерация изображений, попадания в кеш — в `backend/app/monitoring/metrics.py`
  - Собираются: Prometheus Docker-контейнером (`monitoring/prometheus/`)

**Логи:**
- Loguru 0.7.3 — структурированное логирование в бэкенде (`backend/app/core/logging.py`)
- Loki + Promtail — агрегация логов (`docker-compose.monitoring.yml`)
- Grafana 11.3.0 — визуализация метрик и логов (`monitoring/grafana/`)
- Node Exporter + cAdvisor — системные метрики и метрики контейнеров

## Push-уведомления

**Web Push (VAPID):**
- pywebpush 2.2.0 — подписанные VAPID Web Push-уведомления в браузеры
  - Интеграция: `backend/app/services/push_notification_service.py`
  - Аутентификация: переменные окружения `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  - Фронтенд: `frontend/src/services/pushNotifications.ts`, `frontend/src/hooks/usePushNotifications.ts`
  - Роутер: `backend/app/routers/push.py` (по адресу `/api/v1/push`)

## Электронная почта

**Yandex Cloud Postbox (SES v2-совместимый):**
- Использует протокол AWS SES v2 API через `aioboto3` 13.0.0
  - Провайдер: `backend/app/services/email/yandex_postbox.py`
  - Эндпоинт: `https://postbox.cloud.yandex.net` (настраивается через `YANDEX_POSTBOX_ENDPOINT`)
  - Аутентификация: переменные окружения `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY`
  - Отправитель: `noreply@fancai.ru`
  - Применение: письма для сброса пароля
  - Переключатель: переменная окружения `EMAIL_ENABLED` (по умолчанию: `false` в разработке, `true` в продакшене)

## Платежи (настроены, не активны)

**YooKassa:**
- Конфигурация: переменные окружения `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` в `backend/app/core/config.py`
- Статус: настроены, но активный код интеграции не найден

**CloudPayments:**
- Конфигурация: переменная окружения `CLOUDPAYMENTS_PUBLIC_ID` в `backend/app/core/config.py`
- Статус: настроена, но активный код интеграции не найден

## Прокси / Сеть

**VLESS-прокси:**
- Собственный VLESS-aware HTTP-клиент: `backend/app/services/vless_http_client.py`
- Назначение: маршрутизация запросов к определённым доменам (например, `pollinations.ai`) через прокси
- Конфигурация: переменные окружения `HTTP_PROXY_URL`, `SOCKS5_PROXY_URL` (следует из реализации)

## CI/CD и развёртывание

**Хостинг:**
- Собственный VPS на `fancai.ru` (сервер в России, 8 ГБ ОЗУ / 4 CPU)
- Docker Compose (`docker-compose.lite.yml`) — основное продакшен-развёртывание

**CI-пайплайн:**
- Не обнаружен (GitHub Actions workflows или конфигурация CI не найдены)

**Метод развёртывания:**
- SSH на сервер, команды `docker compose`
- Скилл развёртывания: `/deploy` (документирован в CLAUDE.md)

## PWA / Service Worker

**Workbox:**
- Библиотеки Workbox 7.4.0 — стратегии кеширования Service Worker
  - Стратегия: `injectManifest` (кастомный SW в `frontend/src/sw.ts`)
  - Background Sync API: автоматический повтор офлайн-очереди для обновлений прогресса, сессий чтения, генерации изображений
  - Фоллбэк для iOS Safari: периодический таймер синхронизации (30с) + `sendBeacon` для критичных данных

## WebSocket

**Обновления в реальном времени:**
- Бэкенд WebSocket-роутер: `backend/app/routers/websocket.py`
- Фронтенд WebSocket-сервис: `frontend/src/services/websocket.tsx`
- Статус: ОТКЛЮЧЕНО на фронтенде (cookie-аутентификация для WS не реализована; помечен `@deprecated`)
- Определённые события: `book_processing_*`, `image_generation_*`, `entities_updated`, `user_notification`

## Конфигурация окружения

**Обязательные переменные окружения (продакшен):**
- `DB_PASSWORD` — пароль PostgreSQL
- `REDIS_PASSWORD` — пароль Redis
- `SECRET_KEY` — ключ подписи JWT (не должен быть значением по умолчанию)
- `GOOGLE_API_KEY` или `LANGEXTRACT_API_KEY` — сервисы Google AI
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — Web Push
- `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY` — Email (если EMAIL_ENABLED=true)

**Расположение секретов:**
- Файл `.env` в корне проекта (загружается pydantic-settings в бэкенде)
- Переменные фронтенда передаются как Docker build args (префикс VITE_)

---

*Аудит интеграций: 2026-02-27*
