# Технологический стек

**Дата анализа:** 2026-02-27

## Языки программирования

**Основные:**
- TypeScript 5.7 — фронтенд (React SPA)
- Python 3.11 — бэкенд (FastAPI API + Celery воркеры)

**Вспомогательные:**
- CSS (Tailwind v4) — стилизация
- SQL — миграции базы данных через Alembic

## Среда выполнения

**Фронтенд-окружение:**
- Node.js (через npm) — инструменты разработки и сборки
- Браузер — целевая среда выполнения (ES2020)

**Бэкенд-окружение:**
- Python 3.11
- Uvicorn 0.40.0 (ASGI-сервер, разработка) / Gunicorn 25.0.1 (продакшен)

**Пакетные менеджеры:**
- npm — фронтенд (присутствует `frontend/package-lock.json`)
- pip — бэкенд (`backend/requirements.txt` и `backend/requirements.lite.txt`)

## Фреймворки

**Основной фронтенд:**
- React 19.0.0 — UI-фреймворк (только функциональные компоненты)
- Vite 7.3.1 — инструмент сборки и дев-сервер
- React Router DOM 7.1.0 — клиентская маршрутизация
- TanStack Query 5.90.12 — управление серверным состоянием и получение данных через API
- Zustand 5.0.10 — управление клиентским состоянием (авторизация, ридер, UI)
- React Hook Form 7.54.2 + Zod 4.3.6 — валидация форм

**Основной бэкенд:**
- FastAPI 0.128.0 — HTTP API-фреймворк с асинхронной поддержкой
- SQLAlchemy 2.0.46 — ORM с асинхронным движком (`asyncpg`)
- Alembic 1.18.3 — миграции базы данных
- Celery 5.6.2 — асинхронная очередь задач (обработка книг, генерация изображений)
- Pydantic 2.12.5 — валидация схем (v2, Rust-ядро)

**UI-библиотеки компонентов:**
- Radix UI — headless-компоненты (`@radix-ui/react-*`)
- Tailwind CSS 4.1.18 — utility-first CSS (через плагин `@tailwindcss/vite`)
- Motion 12.31.0 — анимации
- Lucide React 0.563.0 — иконки
- Sonner 2.0.7 — всплывающие уведомления (toast)
- Vaul 1.1.2 — выдвижная панель (drawer/bottom sheet)

**Тестирование:**
- Vitest 4.0.18 — модульные/интеграционные тесты (фронтенд)
- Playwright 1.49.1 — E2E-тесты (фронтенд)
- Testing Library (React, DOM, user-event) — тестирование компонентов
- pytest 9.0.2 + pytest-asyncio 1.3.0 — тесты бэкенда

**Сборка/Разработка:**
- Vite PWA plugin 1.2.0 — Service Worker через Workbox, стратегия `injectManifest`
- Rollup Visualizer 6.0.5 — анализ бандла
- ESLint 9.17.0 + typescript-eslint 8.54.0 — линтинг фронтенда
- Black 26.1.0 + Ruff 0.15.0 + mypy 1.19.1 — форматирование/линтинг бэкенда

## Ключевые зависимости

**Критичные для фронтенда:**
- `epubjs` 0.3.93 — рендеринг и навигация по EPUB (отслеживание позиции на основе CFI)
- `dexie` 4.2.1 — обёртка для IndexedDB, офлайн-кеширование глав
- `axios` 1.7.9 — HTTP-клиент (обёрнут в синглтон `src/api/client.ts`)
- `i18next` 25.8.0 + `react-i18next` 16.5.4 — интернационализация
- `dompurify` 3.3.0 — санитизация HTML для содержимого EPUB
- `@tanstack/react-virtual` 3.13.18 — виртуализация списков сущностей

**Критичные для бэкенда:**
- `google-genai` 1.61.0 — SDK для Google Gemini и Imagen (основная AI-интеграция; планируется полное удаление при миграции на OpenRouter в Phase 3)
- `asyncpg` 0.31.0 — асинхронный драйвер PostgreSQL
- `redis` 7.1.0 (async) — кеш + Celery-брокер/бэкенд
- `tenacity` 9.1.2 — повторные попытки с экспоненциальной задержкой для всех LLM-вызовов
- `python-jose` 3.5.0 — генерация и валидация JWT-токенов
- `passlib[bcrypt]` 1.7.4 — хеширование паролей
- `networkx` 3.6.1 — анализ графов сущностей
- `ebooklib` 0.20 + `lxml` 6.0.2 — парсинг EPUB
- `beautifulsoup4` 4.14.3 — извлечение HTML из глав EPUB
- `loguru` 0.7.3 — структурированное логирование
- `sentry-sdk[fastapi]` 2.51.0 — отслеживание ошибок
- `prometheus-client` 0.24.1 + `prometheus-fastapi-instrumentator` 7.1.0 — метрики
- `pywebpush` 2.2.0 — Web Push (VAPID) уведомления
- `aioboto3` 13.0.0 — асинхронный AWS/SES-совместимый клиент (для Yandex Postbox, отправка email)
- `pillow` 12.1.0 — обработка изображений

**PWA / Service Worker:**
- Workbox 7.4.0 (`workbox-routing`, `workbox-strategies`, `workbox-background-sync` и др.) — кеширование и офлайн-синхронизация через Service Worker

## Конфигурация

**Переменные окружения фронтенда (префикс VITE_):**
- `VITE_API_BASE_URL` — базовый URL API (по умолчанию: `/api/v1`)
- `VITE_WS_URL` — URL WebSocket (по умолчанию: `/ws`)
- `VITE_APP_NAME` — название приложения
- `VITE_ENVIRONMENT` — название окружения

**Переменные окружения бэкенда (загружаются через pydantic-settings из `.env`):**
- `DATABASE_URL` — строка подключения к PostgreSQL (`postgresql+asyncpg://...`)
- `REDIS_URL` — строка подключения к Redis (`redis://:password@host:port`)
- `SECRET_KEY` — ключ подписи JWT
- `GOOGLE_API_KEY` / `LANGEXTRACT_API_KEY` — API-ключ Google AI (Gemini + Imagen; будет заменён на OPENROUTER_API_KEY в Phase 3)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push
- `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY` — Email
- `CORS_ORIGINS` — разрешённые источники через запятую
- `DEBUG` — переключатель разработка/продакшен (при `false` проверяет секреты)
- `SENTRY_DSN` — отслеживание ошибок (настраивается через sentry-sdk)

**Конфигурация сборки:**
- `frontend/vite.config.ts` — конфигурация сборки Vite с ручным разделением чанков, PWA, прокси
- `frontend/tsconfig.json` — TypeScript со strict-режимом, алиасы путей (`@/*` → `src/*`)
- `frontend/vitest.config.ts` — Vitest с jsdom, покрытие через v8
- `backend/pytest.ini` — pytest с asyncio-mode=auto, порог покрытия 70%
- `backend/alembic.ini` — конфигурация миграций Alembic

## Требования к платформе

**Разработка:**
- Docker + Docker Compose (V2, `docker compose`, а не `docker-compose`)
- Node.js (дев-сервер фронтенда на порту 5173)
- Python 3.11 (бэкенд на порту 8000)

**Продакшен:**
- Docker Compose через `docker-compose.lite.yml` (основная продакшен-конфигурация)
- PostgreSQL 17-alpine (обновлять до 17.9-alpine для закрытия CVE)
- Redis 7.4-alpine (maxmemory 640MB, политика вытеснения allkeys-lru)
- nginx (обратный прокси, раздача статики фронтенда) → планируется замена на Caddy
- Сервер: 32 ГБ ОЗУ, 12 vCPU, NVMe SSD
- Развёрнуто на: `fancai.ru` (российский домен, часовой пояс Europe/Moscow)

---

*Анализ стека: 2026-02-27*
*Обновлено: 2026-03-01 (серверные характеристики, PostgreSQL версия)*
