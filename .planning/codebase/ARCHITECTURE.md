# Архитектура

**Дата анализа:** 2026-03-04

> **Historical codebase snapshot.** Не использовать как current source of truth: после
> этого анализа shipped Gemini Direct/Vertex, Vite 8 и другие изменения. Актуальная
> архитектура — [`docs/architecture/overview.md`](../../docs/architecture/overview.md),
> AI routing — [`docs/architecture/ai-pipeline.md`](../../docs/architecture/ai-pipeline.md),
> operational gaps — [`.planning/STATE.md`](../STATE.md).

## Обзор паттерна

**Общий паттерн:** Fullstack SPA с асинхронным AI-конвейером

**Ключевые характеристики:**
- Frontend — React SPA (PWA) отдаётся Caddy как статика; все запросы проксируются через единый домен
- Backend — FastAPI с async SQLAlchemy; тяжёлые AI-задачи вынесены в Celery-воркер
- Все AI-вызовы (LLM + генерация изображений) идут через единый клиент `openrouter_client.py` → OpenRouter API
- Сессии аутентификации — HttpOnly cookie с JWT; token blacklist хранится в Redis
- Прогресс обработки книги передаётся через Redis PubSub → WebSocket (endpoint `/ws/book-progress/{book_id}`)

## Слои

### Frontend

**Слой страниц:**
- Назначение: Точки входа маршрутов, компоновка UI
- Расположение: `frontend/src/pages/`
- Содержит: `LibraryPage.tsx`, `BookReaderPage.tsx`, `AdminDashboardEnhanced.tsx`, и ещё 13 страниц
- Зависит от: компонентов, хуков API, хранилищ Zustand

**Слой компонентов:**
- Назначение: UI-блоки с изоляцией логики
- Расположение: `frontend/src/components/`
- Ключевые группы: `Reader/` (23 файла), `Entities/` (12 файлов), `Books/`, `Auth/`, `Admin/`, `UI/`
- Reader декомпозирован: `EpubReader.tsx` (286 строк) + `Core/` (4 файла) + 25+ хуков в `hooks/epub/`

**Слой хуков:**
- Назначение: Логика взаимодействия с API и EPUB
- Расположение: `frontend/src/hooks/`
- Подгруппы:
  - `hooks/api/` — 8 файлов TanStack Query (useBooks, useChapter, useDescriptions, useImages, useRecap и др.)
  - `hooks/epub/` — 26 хуков для EPUB: CFI-трекинг, навигация, подсветка описаний, темы, свайпы
  - `hooks/reader/` — хуки специфичные для Reader (позиция, навигация по главам)

**Слой сервисов (frontend):**
- Назначение: Офлайн-кэширование, фоновая синхронизация
- Расположение: `frontend/src/services/`
- Ключевые: `chapterCache.ts` (IndexedDB через Dexie, TTL 7 дней), `imageCache.ts`, `syncQueue.ts`, `tabSync.ts`, `websocket.tsx` (заглушка — WS cookie auth не реализован)

**Слой хранилищ (Zustand):**
- Назначение: Клиентское глобальное состояние
- Расположение: `frontend/src/stores/`
- Три хранилища: `auth.ts` (пользователь, токены), `reader.ts` (настройки читалки, прогресс), `ui.ts` (уведомления)

**Слой API-клиента:**
- Назначение: HTTP-обёртка над axios
- Расположение: `frontend/src/api/client.ts`
- Синглтон `apiClient`; автоматический refresh токена при 401; поддержка FormData

---

### Backend

**Слой роутеров (API):**
- Назначение: HTTP-эндпоинты, валидация входящих данных через Pydantic
- Расположение: `backend/app/routers/`
- Состав: 25 файлов, 97 маршрутов + 1 WebSocket
- Ключевые модули:
  - `routers/books/` — подпакет (рефакторинг 2026-03-01): `crud.py` (792 строки), `entities.py`, `processing.py`, `validation.py`, `__init__.py` (сборка)
  - `routers/admin/` — подпакет: 9 модулей (stats, parsing, images, system, users, reading_sessions, cache, feature_flags, entities)
  - `routers/images.py` — 957 строк (13 маршрутов)
  - `routers/reading_sessions.py` — 1089 строк (8 маршрутов)
  - `routers/websocket.py` — WebSocket для прогресса обработки книги

**Слой сервисов:**
- Назначение: Бизнес-логика, AI-вызовы, парсинг книг
- Расположение: `backend/app/services/`
- Ключевые сервисы:
  - `gemini_extractor.py` — 1221 строк; извлечение описаний и сущностей за один вызов `analyze_chapter()`; чанки 100K символов с 15% перекрытием
  - `book_parser.py` — 1199 строк; парсинг EPUB (ebooklib) и FB2 (lxml)
  - `entity_service.py` — 680 строк; управление сущностями, спойлер-безопасная фильтрация по CFI
  - `entity_deduplication_service.py` — fuzzy matching + LLM семантический merge
  - `image_generator.py` / `imagen_generator.py` — генерация изображений через OpenRouter (FLUX.2 Klein); перевод RU→EN перед запросом
  - `reading_session_service.py` / `reading_session_cache.py` — сессии чтения с кэшированием в Redis

**Слой ядра (core):**
- Назначение: Инфраструктура, конфигурация, утилиты
- Расположение: `backend/app/core/`
- Ключевые файлы:
  - `openrouter_client.py` — 537 строк; единый AI-клиент с цепочкой fallback-моделей
  - `config.py` — `Settings` через pydantic-settings; все параметры из env
  - `database.py` — async SQLAlchemy engine, connection pool (pool_size=20, max_overflow=40)
  - `auth.py` — JWT из HttpOnly cookie или Bearer-заголовка; token blacklist проверка
  - `celery_app.py` — Celery с Redis DB1 как брокером, DB2 как backend; очереди: heavy/normal/light
  - `cache.py` — Redis DB0 для кэширования; TTL управляемый
  - `pubsub.py` — Redis PubSub для прогресса обработки книги
  - `exceptions.py` — RFC 9457 ProblemDetail исключения
  - `retry.py` — tenacity декораторы для внешних вызовов

**Слой моделей:**
- Назначение: SQLAlchemy ORM-модели
- Расположение: `backend/app/models/`
- 18 моделей; все с `lazy="raise"` (требует явного selectinload/joinedload)
- Ключевые: `book.py`, `entity.py`, `entity_relationship.py`, `entity_mention.py`, `description.py`, `chapter.py`, `user.py`, `reading_session.py`

**Слой задач Celery:**
- Назначение: Фоновые AI-задачи и периодические задания
- Расположение: `backend/app/tasks/`
- Файлы: `book_tasks.py` (soft limit 3h), `image_tasks.py` (soft limit 300s), `cleanup_tasks.py`, `reading_sessions_tasks.py`, `auth_tasks.py`, `utility_tasks.py`

**Слой схем:**
- Назначение: Pydantic-схемы запросов и ответов
- Расположение: `backend/app/schemas/` и `backend/app/schemas/responses/`
- 15 файлов схем ответов

**Слой миддлвара:**
- Расположение: `backend/app/middleware/`
- `security_headers.py` — XSS, clickjacking, MIME-sniffing защита
- `cache_control.py` — HTTP-кэширование
- `rate_limit.py` — ограничение запросов через Redis

## Потоки данных

### Загрузка и обработка книги

1. Frontend: `POST /api/v1/books/upload` (multipart form) → `routers/books/crud.py`
2. Backend: сохраняет EPUB-файл в `backend/storage/books/`, создаёт запись `Book` в PostgreSQL
3. Frontend: `POST /api/v1/books/{id}/process` → `routers/books/processing.py`
4. Backend: ставит задачу `process_book_task` в Celery очередь `heavy`
5. Celery Worker: парсит книгу (`book_parser.py`) → делит текст на чанки по 100K символов с 15% перекрытием
6. Для каждого чанка: вызов `gemini_extractor.analyze_chapter()` через `openrouter_client.py` → OpenRouter API (Gemini 3 Flash)
7. Результат: создаются записи `Description` и `Entity` в PostgreSQL
8. Прогресс: каждый шаг публикует в Redis PubSub → WebSocket → Frontend
9. Frontend: опрашивает `GET /api/v1/books/{id}/parsing-status` (polling), обновляет UI

### Генерация изображений

1. Frontend: `POST /api/v1/images/generate` → `routers/images.py`
2. Backend: ставит задачу `generate_image_task` в Celery очередь `normal`
3. Celery Worker: переводит описание RU→EN (OpenRouter LLM), генерирует изображение (FLUX.2 Klein через OpenRouter)
4. Сохраняет изображение в `backend/storage/books/` (или S3 при настройке)
5. Frontend: опрашивает статус изображения

### Чтение с EPUB

1. Frontend: `GET /api/v1/books/{id}/file` → файл EPUB отдаётся из `backend/storage/`
2. epub.js рендерит EPUB в iframe; позиция отслеживается через CFI (не номера страниц)
3. При переходе по CFI: хук `useProgressSync` сохраняет позицию в `POST /api/v1/books/{id}/reading-progress`
4. Описания загружаются через `GET /api/v1/books/{id}/descriptions`; `useDescriptionHighlighting` применяет 8 стратегий поиска для подсветки текста
5. Данные главы кэшируются в IndexedDB (Dexie, `chapterCache.ts`) для офлайн-доступа

### Система сущностей (спойлер-безопасная)

1. Frontend: при изменении главы вызывает `GET /api/v1/books/{id}/entities/network?current_chapter=N`
2. Backend `entity_service.py`: фильтрует сущности по CFI текущей главы — показывает только те, что появились не позже текущей позиции читателя
3. Данные возвращаются как граф (узлы + рёбра отношений)
4. Frontend: компоненты `Entities/EntityDrawer.tsx`, `EntityList.tsx`, `EntityProfile.tsx` рендерят энциклопедию

### Управление состоянием

- Серверное состояние: TanStack Query (кэш, инвалидация, фоновое обновление)
- Клиентское состояние: Zustand (3 хранилища)
- Офлайн: IndexedDB (Dexie) + Service Worker (Workbox)
- Сессия: HttpOnly cookie (access_token, refresh_token)

## Ключевые абстракции

### AI-конвейер (OpenRouter Client)

- Назначение: Единая точка входа для всех AI-вызовов
- Файл: `backend/app/core/openrouter_client.py`
- Паттерн: Facade с fallback chain (Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite)
- Методы: `generate_text()`, `generate_structured()`, `generate_image()`
- Fallback триггер: только на `httpx.HTTPStatusError` и `httpx.TimeoutException`; `JSONDecodeError` и `ValidationError` не вызывают fallback

### Система сущностей

- Назначение: Интерактивная энциклопедия персонажей/локаций/объектов
- Backend: `entity_service.py`, `entity_deduplication_service.py`, `graph_service.py`, `entity_synthesis_service.py`
- Модели: `entity.py`, `entity_mention.py`, `entity_relationship.py`, `description_entity.py`, `entity_event.py`
- Frontend: `components/Entities/` (12 файлов)
- Ключевая особенность: спойлер-безопасность — CFI первого упоминания сущности сравнивается с текущей позицией читателя

### EPUB Reader

- Назначение: Читалка с подсветкой описаний и навигацией
- Главный файл: `frontend/src/components/Reader/EpubReader.tsx` (286 строк, ~84 коммита)
- Декомпозиция: 25+ хуков в `hooks/epub/`, UI-слои в `Core/` (ReaderUI, ReaderModals, ReaderOverlays)
- Критично: позиция = CFI (не номера страниц), iOS-специфичные фиксы в `useEpubIOSFixes.ts`
- Подсветка: 8 fallback-стратегий поиска в `useDescriptionHighlighting.ts`

### Аутентификация

- Схема: HttpOnly cookie (`access_token`) + опционально Bearer-заголовок
- Access token: JWT HS256, срок действия 7 дней
- Refresh token: 30 дней
- Token blacklist: хранится в Redis (инвалидация при logout)
- Frontend: автоматический refresh в `api/client.ts` при 401

## Точки входа

**Backend — `backend/app/main.py`:**
- Создаёт FastAPI app с lifespan-менеджером
- Порядок middleware (выполняется в обратном порядке добавления): CORS → SecurityHeaders → CacheControl → GZip → ReadingSessionsMetrics
- Подключает 12+ роутеров с префиксом `/api/v1`
- Инициализирует при старте: Hawk Tracker, Rate Limiter, Redis Cache, Settings Manager, Prometheus

**Frontend — `frontend/src/main.tsx`:**
- React 19 StrictMode + React Router + TanStack Query Provider
- PWA Service Worker регистрация (Workbox)

**Celery — `backend/app/core/celery_app.py`:**
- Подключается к Redis DB1 как брокер
- Beat schedule: закрытие брошенных сессий каждые 30 минут

## Обработка ошибок

**Backend:**
- RFC 9457 `ProblemDetail` исключения (`core/exceptions.py`)
- Кастомные исключения: `InvalidFileFormatException`, `ParsingStartException` и др.
- Общий обработчик в `main.py` гарантирует наличие CORS-заголовков даже в error responses
- Tenacity retry декораторы (`core/retry.py`) для всех внешних вызовов

**Frontend:**
- `ErrorBoundary` компонент (`components/ErrorBoundary/`)
- TanStack Query обрабатывает network errors и retry
- `api/client.ts` конвертирует ошибки axios в типизированный `ApiError`

## Сквозные заботы

**Логирование:**
- Backend: loguru (`core/logging.py`); структурированные логи
- Frontend: `lib/logger.ts`; только в dev-режиме подробный вывод

**Мониторинг ошибок:**
- Backend: Hawk Tracker (`hawk-python-sdk[fastapi]`) инициализируется в `core/hawk.py`
- Frontend: `@hawk.so/javascript`
- Метрики: Prometheus (`monitoring/metrics.py`) + prometheus-fastapi-instrumentator

**Валидация:**
- Backend: Pydantic v2 для всех схем; входные данные валидируются в роутерах
- Frontend: Zod + react-hook-form

**Аутентификация:**
- Dependency Injection через FastAPI `Depends(get_current_active_user)` на каждом защищённом маршруте

## Архитектура деплоя

```
Internet
    │
    ▼
Caddy 2.11.1 (Auto-HTTPS, HTTP/3, zstd/gzip)
    │  /api/*     → backend:8000 (FastAPI)
    │  /ws/*      → backend:8000 (WebSocket)
    │  /storage/* → /var/www/storage (файлы с диска)
    │  /*         → /var/www/frontend (SPA static build)
    │
    ├─► FastAPI (Uvicorn, 2 workers, 2G RAM limit)
    │       │
    │       ├─► PostgreSQL 17 (12G RAM, shared_buffers=4GB)
    │       ├─► Redis 7.4 (640MB, volatile-lru)
    │       │     ├── DB0: кэш API-ответов
    │       │     ├── DB1: Celery broker (НЕ очищать!)
    │       │     └── DB2: Celery results
    │       └─► Celery Worker (1.5G RAM, concurrency=2)
    │               └─► OpenRouter API (LLM + Images)
    │
    └─► monitor.fancai.ru (basicauth)
            ├── /netdata  → Netdata :19999
            ├── /victoria → VictoriaMetrics :8428
            ├── /uptime   → Uptime Kuma :3001
            ├── /dozzle   → Dozzle (логи) :8080
```

**Docker Compose:**
- Prod: `docker-compose.prod.yml` — сеть `fancai_network` (172.22.0.0/16)
- Dev: `docker-compose.dev.yml` — hot reload через volume mount источника backend
- Frontend: build-контейнер (exits after build) записывает в shared volume `frontend_build`; Caddy читает из него

---

*Анализ архитектуры: 2026-03-04*
