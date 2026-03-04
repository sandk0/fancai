# Technology Stack

**Дата анализа:** 2026-03-04

## Языки

**Основные:**
- TypeScript 5.7.2 — фронтенд (React-компоненты, хуки, типизация)
- Python 3.12 — бэкенд (FastAPI, Celery-задачи, сервисы)

**Вспомогательные:**
- HTML5 / CSS3 — разметка, стили (Tailwind v4 utility-first)
- SQL — миграции Alembic (PostgreSQL 17)

## Среда выполнения

**Окружение:**
- Node.js (сборка фронтенда внутри Docker, `Dockerfile.prod`)
- Python 3.12 (бэкенд, gunicorn + uvicorn workers)

**Менеджер пакетов:**
- npm (фронтенд) — lockfile `frontend/package-lock.json` присутствует
- pip (бэкенд) — `backend/requirements.txt` (без pyproject.toml)

## Фреймворки

**Фронтенд:**
- React 19.0.0 — основной UI-фреймворк (`react`, `react-dom`)
- React Router DOM 7.1.0 — маршрутизация SPA (`react-router-dom`)
- Vite 7.3.1 — сборщик и dev-сервер (`vite`, `@vitejs/plugin-react`)
- Tailwind CSS 4.1.18 — утилитарные стили (`tailwindcss`, `@tailwindcss/vite`)

**Бэкенд:**
- FastAPI 0.135.1 — HTTP API (97 роутов + 1 WebSocket, `fastapi`)
- Uvicorn 0.41.0 — ASGI-сервер (`uvicorn[standard]`)
- Gunicorn 25.1.0 — process manager для prod (`gunicorn.conf.py`)

**Фоновые задачи:**
- Celery 5.6.2 — очередь задач (`celery==5.6.2`, `kombu==5.6.2`)
- Redis 7.4.8 (Alpine) — брокер (DB 1) и хранилище результатов (DB 2)
- Celery Beat — планировщик периодических задач (сервис `celery-beat`)

**Тестирование:**
- Vitest 4.0.18 — unit-тесты фронтенда (`vitest`, `@vitest/coverage-v8`)
- Playwright 1.49.1 — e2e-тесты фронтенда (`@playwright/test`)
- @testing-library/react 16.1.0 — рендер компонентов (`@testing-library/react`)
- pytest 9.0.2 — unit/integration-тесты бэкенда (`pytest`)
- pytest-asyncio 1.3.0 — асинхронные тесты (`pytest-asyncio`)
- aiosqlite 0.22.1 — SQLite in-memory для тестов бэкенда

**Сборка/Dev:**
- rollup-plugin-visualizer 6.0.5 — анализ бандла (`dist/stats.html`)
- vite-plugin-pwa 1.2.0 — PWA/Service Worker (Workbox injectManifest)

## Ключевые зависимости

**Критические (фронтенд):**
- `epubjs ^0.3.93` — парсинг и рендер EPUB-книг (CFI-позиционирование, НЕ страницы)
- `@tanstack/react-query ^5.90.12` — управление серверным состоянием (все API-вызовы)
- `zustand ^5.0.10` — клиентский state (3 сторы: auth, reader, ui)
- `dexie ^4.2.1` + `dexie-react-hooks ^4.2.0` — IndexedDB-кеш глав offline
- `axios ^1.7.9` — HTTP-клиент для API-запросов
- `react-hook-form ^7.54.2` + `zod ^4.3.6` — формы и валидация

**Критические (бэкенд):**
- `sqlalchemy==2.0.47` — ORM (async + `lazy="raise"`, обязателен `selectinload`)
- `alembic==1.18.4` — миграции БД (48 файлов в `backend/alembic/versions/`)
- `asyncpg==0.31.0` — асинхронный PostgreSQL-драйвер
- `pydantic[email]==2.12.5` — валидация данных (Rust-ядро)
- `pydantic-settings==2.13.1` — загрузка настроек из env
- `httpx[socks]==0.28.1` — HTTP-клиент для OpenRouter API (SOCKS5 прокси)
- `PyJWT[crypto]==2.10.1` — JWT-токены (заменил python-jose в 2026-02)
- `bcrypt==5.0.0` — хеширование паролей
- `tenacity==9.1.4` — retry с exponential backoff для внешних вызовов
- `networkx==3.6.1` — граф сущностей в `graph_service.py`
- `loguru==0.7.3` — структурированное логирование
- `pywebpush==2.3.0` — Web Push уведомления (VAPID)
- `aioboto3==15.5.0` — email через Yandex Cloud Postbox (AWS SES v2 compatible)

**UI (фронтенд):**
- Radix UI (`@radix-ui/react-*`) — headless UI-примитивы (7 пакетов)
- `lucide-react ^0.563.0` — иконки
- `motion ^12.31.0` — анимации
- `sonner ^2.0.7` — toast-уведомления
- `vaul ^1.1.2` — bottom drawer
- `dompurify ^3.3.0` — санитизация HTML
- `i18next ^25.8.0` + `react-i18next` — интернационализация (ru/en)
- `@hawk.so/javascript ^3.2.18` — Hawk Tracker фронтенда

**Мониторинг (бэкенд):**
- `hawk-python-sdk[fastapi]==3.5.2` — Hawk Tracker для FastAPI и Celery
- `prometheus-client==0.24.1` + `prometheus-fastapi-instrumentator==7.1.0` — метрики `/metrics`

**Парсинг книг:**
- `ebooklib==0.20` — EPUB-парсер
- `beautifulsoup4==4.14.3` — HTML-парсинг глав
- `lxml==6.0.2` — XML/HTML backend для bs4
- `pillow==12.1.1` — обработка изображений

## Конфигурация

**Окружение (бэкенд):**
- Загрузка через `pydantic-settings` из `.env` и `../env` (`backend/app/core/config.py`)
- Production: валидация при `DEBUG=False` — запрещены дефолтные секреты
- CI: валидация пропускается при `CI=true` / `GITHUB_ACTIONS=true`

**Ключевые переменные:**
- `DATABASE_URL` — PostgreSQL (asyncpg)
- `REDIS_URL` — Redis DB 0 (кеш)
- `CELERY_BROKER_URL` — Redis DB 1 (НЕ сбрасывать)
- `CELERY_RESULT_BACKEND` — Redis DB 2
- `SECRET_KEY` — JWT signing
- `OPENROUTER_API_KEY` — все AI-сервисы (LLM + изображения)
- `HAWK_TOKEN` — Hawk Tracker (опционально)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push

**Конфигурационные файлы:**
- `backend/app/core/config.py` — Settings (pydantic-settings)
- `backend/gunicorn.conf.py` — gunicorn workers
- `frontend/vite.config.ts` — Vite + PWA + chunk splitting
- `frontend/tsconfig.json` — TypeScript (strict mode, paths alias `@/`)
- `frontend/vitest.config.ts` — Vitest
- `Caddyfile` — production reverse proxy (Let's Encrypt)
- `Caddyfile.dev` — dev reverse proxy (local CA)
- `docker-compose.prod.yml` — production (32GB, 12 vCPU)
- `docker-compose.dev.yml` — разработка (MacBook Air M4, ~5GB бюджет)
- `docker-compose.monitoring.yml` — мониторинг-стек (5 сервисов)

**Сборка:**
- Frontend: `tsc -p tsconfig-build.json --noEmit && vite build` (target ES2020)
- Backend: Dockerfile.prod (Python 3.12 slim)
- Production: фронтенд собирается в shared volume, Caddy отдаёт статику

## Требования к платформе

**Разработка:**
- macOS (MacBook Air M4) или Linux
- Docker Desktop / OrbStack
- ~5.5GB RAM для Docker
- `docker compose` (без дефиса — Compose V2)

**Production:**
- Сервер: 32GB RAM, 12 vCPU, NVMe SSD
- OS: Linux
- Docker Compose V2
- Домен с A-записью для Let's Encrypt (Caddy автоматический TLS)
- Внешний IP с доступом к OpenRouter API

**Инфраструктура (prod):**
- Caddy 2.11.1-alpine — reverse proxy, auto-HTTPS, HTTP/3 (QUIC)
- PostgreSQL 17.9-alpine — `shared_buffers=4GB`, `max_connections=150`
- Redis 7.4.8-alpine — `maxmemory=640mb`, `volatile-lru`
- Мониторинг: Netdata v2.5.0 + VictoriaMetrics v1.112.0 + Uptime Kuma 2.4.1 + Dozzle v10.0.3 + Flower 2.0.1

---

*Анализ стека: 2026-03-04*
