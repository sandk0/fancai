# Структура кодовой базы

**Дата анализа:** 2026-03-04

> **Historical codebase snapshot.** Дерево/счётчики ниже сняты 2026-03-04 и не являются
> текущим inventory. Актуальный high-level map —
> [`docs/architecture/overview.md`](../../docs/architecture/overview.md).

## Общая компоновка директорий

```
fancai-vibe-hackathon/
├── frontend/               # React 19 SPA (TypeScript 5.7 + Vite 7)
├── backend/                # FastAPI + Python 3.12
├── monitoring/             # Конфигурации мониторинга (Grafana, Loki, Prometheus, Netdata)
├── postgres/               # Инициализационные SQL-скрипты
├── redis/                  # Конфигурация Redis
├── scripts/                # Bash-скрипты деплоя и обслуживания
├── docs/                   # Документация и отчёты
├── Caddyfile               # Конфигурация реверс-прокси (продакшн)
├── Caddyfile.dev           # Конфигурация Caddy (локальная разработка)
├── docker-compose.prod.yml # Продакшн Docker Compose
├── docker-compose.dev.yml  # Разработческий Docker Compose
├── docker-compose.monitoring.yml  # Стек мониторинга
├── .env                    # Переменные окружения (не коммитится)
├── .env.example            # Шаблон env-переменных (dev)
├── .env.production.example # Шаблон env-переменных (prod)
├── .planning/              # GSD-планирование (ROADMAP, STATE, фазы)
└── .claude/                # Claude Code конфигурация (agents, hooks, skills, rules)
```

## Frontend: структура

```
frontend/
├── src/
│   ├── api/                # HTTP-клиент и API-вызовы
│   │   ├── client.ts       # Axios singleton (автоматический refresh токенов)
│   │   ├── books.ts        # CRUD книг
│   │   ├── auth.ts         # Аутентификация
│   │   ├── images.ts       # Генерация изображений
│   │   ├── descriptions.ts # Описания главы
│   │   ├── readingSessions.ts
│   │   ├── push.ts         # Web Push
│   │   ├── health.ts
│   │   ├── admin.ts
│   │   └── index.ts
│   ├── components/         # UI-компоненты
│   │   ├── Reader/         # Читалка EPUB (23 файла + поддиректории)
│   │   │   ├── EpubReader.tsx              # Главный компонент (286 строк, ~84 коммита)
│   │   │   ├── Core/                       # Слои UI читалки
│   │   │   │   ├── ReaderUI.tsx
│   │   │   │   ├── ReaderModals.tsx
│   │   │   │   ├── ReaderOverlays.tsx
│   │   │   │   ├── ReaderContext.tsx
│   │   │   │   └── useReaderContext.ts
│   │   │   ├── ReaderSettingsPanel/        # Панель настроек
│   │   │   ├── ReaderControls.tsx
│   │   │   ├── ReaderHeader.tsx
│   │   │   ├── ReaderContent.tsx
│   │   │   ├── TocSidebar.tsx
│   │   │   ├── BookInfo.tsx
│   │   │   ├── DescriptionPeek.tsx
│   │   │   └── ...
│   │   ├── Entities/       # Система сущностей (12 файлов)
│   │   │   ├── EntityCard.tsx
│   │   │   ├── EntityDrawer.tsx
│   │   │   ├── EntityList.tsx
│   │   │   ├── EntityProfile.tsx
│   │   │   ├── EntityGallery.tsx
│   │   │   ├── EntityMiniCard.tsx
│   │   │   ├── EntityEventTimeline.tsx
│   │   │   ├── RecapPanel.tsx
│   │   │   ├── RelationshipCard.tsx
│   │   │   ├── SpoilerText.tsx
│   │   │   └── index.ts
│   │   ├── Books/          # Компоненты работы с книгами
│   │   ├── Library/        # Библиотека + BookCard/
│   │   ├── Auth/           # Формы аутентификации
│   │   ├── Admin/          # Панель администратора
│   │   ├── Navigation/     # Навигация приложения
│   │   ├── Layout/         # Обёртки раскладки
│   │   ├── Settings/       # Страница настроек + sections/
│   │   ├── Home/           # Главная страница
│   │   ├── Images/         # Галерея изображений
│   │   ├── Stats/          # Статистика чтения
│   │   ├── SEO/            # SEO-компоненты
│   │   ├── UI/             # Общие UI-примитивы
│   │   └── ErrorBoundary/  # Обработка ошибок
│   ├── hooks/              # React-хуки
│   │   ├── epub/           # 26 хуков для EPUB (CFI, навигация, подсветка и т.д.)
│   │   │   ├── useEpubLoader.ts            # Загрузка книги в epub.js
│   │   │   ├── useCFITracking.ts           # Отслеживание CFI-позиции
│   │   │   ├── useDescriptionHighlighting.ts # 8 стратегий поиска текста
│   │   │   ├── useEpubNavigation.ts
│   │   │   ├── useChapterManagement.ts
│   │   │   ├── useProgressSync.ts          # Синхронизация прогресса с backend
│   │   │   ├── useSwipeNavigation.ts       # Свайп-навигация (iOS)
│   │   │   ├── useEpubThemes.ts            # Темы читалки
│   │   │   ├── useEntityCFIPopulation.ts   # Привязка сущностей к CFI
│   │   │   └── index.ts
│   │   ├── api/            # TanStack Query хуки (8 файлов)
│   │   │   ├── queryKeys.ts                # Типизированные ключи запросов
│   │   │   ├── useBooks.ts                 # CRUD книг
│   │   │   ├── useChapter.ts               # Данные главы
│   │   │   ├── useDescriptions.ts          # Описания
│   │   │   ├── useImages/                  # Генерация изображений
│   │   │   ├── useParsingStatus.ts         # Статус обработки
│   │   │   ├── useRecap.ts                 # Рекап сущностей
│   │   │   └── index.ts
│   │   ├── reader/         # Хуки специфичные для Reader
│   │   │   ├── useReaderPosition.ts
│   │   │   ├── useChapterNavigation.ts
│   │   │   ├── useReadingProgress.ts
│   │   │   ├── useAutoParser.ts
│   │   │   ├── useDescriptionManagement.ts
│   │   │   └── usePagination.ts
│   │   ├── library/        # Хуки для библиотеки
│   │   ├── pwa/            # PWA (установка, уведомления)
│   │   └── shared/         # Общие утилитарные хуки
│   ├── stores/             # Zustand-хранилища
│   │   ├── auth.ts         # Пользователь, состояние аутентификации
│   │   ├── reader.ts       # Настройки читалки, прогресс чтения
│   │   └── ui.ts           # Уведомления, глобальный UI
│   ├── services/           # Frontend-сервисы (офлайн, кэш)
│   │   ├── chapterCache.ts # IndexedDB через Dexie (TTL 7 дней, LRU)
│   │   ├── db.ts           # Dexie схема базы данных
│   │   ├── imageCache.ts   # Кэш изображений
│   │   ├── syncQueue.ts    # Офлайн-очередь операций
│   │   ├── tabSync.ts      # Синхронизация между вкладками
│   │   ├── downloadManager.ts
│   │   ├── EntityService.ts
│   │   ├── pushNotifications.ts
│   │   ├── storageManager.ts
│   │   ├── visibilityManager.ts
│   │   └── websocket.tsx   # ЗАГЛУШКА — WS отключён (нет cookie auth)
│   ├── pages/              # Страницы-маршруты
│   │   ├── LibraryPage.tsx
│   │   ├── BookReaderPage.tsx
│   │   ├── BookPage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── ProfilePage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── AdminDashboardEnhanced.tsx
│   │   └── ...             # ещё 8 страниц
│   ├── types/              # TypeScript-типы
│   ├── lib/                # Утилитарные библиотеки (logger)
│   ├── utils/              # Утилиты
│   │   └── text-search/    # Нормализация и стратегии поиска для подсветки
│   ├── config/             # Конфигурация frontend
│   ├── styles/             # Глобальные CSS-стили (globals.css с CSS-переменными тем)
│   ├── locales/            # i18n переводы
│   │   ├── ru/             # Русский
│   │   └── en/             # Английский
│   ├── assets/             # Статические ресурсы
│   └── test/               # Утилиты тестирования
├── public/                 # Статические файлы (manifest.json, иконки)
├── tests/                  # Playwright E2E тесты
├── vite.config.ts          # Vite конфигурация (PWA, chunks, aliases)
├── vitest.config.ts        # Vitest конфигурация
├── tsconfig.json           # TypeScript конфигурация
├── eslint.config.js        # ESLint конфигурация
├── Dockerfile.prod         # Production Docker образ (static build)
└── Dockerfile.dev          # Dev Docker образ (hot reload)
```

## Backend: структура

```
backend/
├── app/
│   ├── main.py             # Точка входа FastAPI; middleware, роутеры, lifespan
│   ├── core/               # Инфраструктура приложения
│   │   ├── config.py       # Settings (pydantic-settings, из env)
│   │   ├── database.py     # Async SQLAlchemy engine + AsyncSessionLocal
│   │   ├── auth.py         # JWT dependency (cookie + Bearer)
│   │   ├── openrouter_client.py  # Единый AI-клиент (537 строк)
│   │   ├── celery_app.py   # Celery + Beat конфигурация
│   │   ├── cache.py        # Redis кэш (DB0)
│   │   ├── pubsub.py       # Redis PubSub (прогресс обработки)
│   │   ├── exceptions.py   # RFC 9457 ProblemDetail
│   │   ├── retry.py        # Tenacity декораторы
│   │   ├── logging.py      # Loguru настройка
│   │   ├── hawk.py         # Hawk Tracker инициализация
│   │   ├── dependencies.py # FastAPI dependencies (get_user_book и др.)
│   │   ├── rate_limiter.py # Redis rate limiter
│   │   ├── secrets.py      # Проверка секретов при старте
│   │   ├── tasks.py        # Обёртки задач Celery
│   │   └── types.py        # Общие типы
│   ├── routers/            # HTTP-маршруты (25 файлов)
│   │   ├── books/          # Подпакет книг (рефакторинг 2026-03-01)
│   │   │   ├── __init__.py # Сборка books_router из sub-routers
│   │   │   ├── crud.py     # Загрузка, список, детали, файлы (792 строки)
│   │   │   ├── entities.py # Эндпоинты сущностей книги
│   │   │   ├── processing.py  # Запуск обработки, статус парсинга
│   │   │   └── validation.py  # Валидация и preview операции
│   │   ├── admin/          # Подпакет администрирования
│   │   │   ├── __init__.py # Сборка admin_router
│   │   │   ├── stats.py
│   │   │   ├── parsing.py
│   │   │   ├── images.py
│   │   │   ├── system.py
│   │   │   ├── users.py
│   │   │   ├── reading_sessions.py
│   │   │   ├── cache.py
│   │   │   ├── feature_flags.py
│   │   │   └── entities.py
│   │   ├── auth.py         # /auth/* (login, logout, refresh)
│   │   ├── users.py        # /users/* (профиль, настройки)
│   │   ├── images.py       # /images/* (957 строк, 13 маршрутов)
│   │   ├── chapters.py     # /books/{id}/chapters/*
│   │   ├── descriptions.py # /books/{id}/descriptions/*
│   │   ├── reading_progress.py
│   │   ├── reading_sessions.py  # 1089 строк, 8 маршрутов
│   │   ├── health.py       # /health, /metrics (Prometheus)
│   │   ├── push.py         # Web Push уведомления
│   │   ├── sync.py         # PWA offline sync
│   │   └── websocket.py    # /ws/book-progress/{book_id}
│   ├── services/           # Бизнес-логика (28 сервисов)
│   │   ├── gemini_extractor.py      # Извлечение описаний+сущностей (1221 строка)
│   │   ├── book_parser.py           # EPUB/FB2 парсер (1199 строк)
│   │   ├── entity_service.py        # Управление сущностями (680 строк)
│   │   ├── entity_deduplication_service.py
│   │   ├── entity_synthesis_service.py
│   │   ├── graph_service.py         # Граф отношений сущностей
│   │   ├── image_generator.py       # Оркестрация генерации изображений
│   │   ├── imagen_generator.py      # Прямые вызовы OpenRouter Images
│   │   ├── auth_service.py          # JWT, пароли
│   │   ├── reading_session_service.py
│   │   ├── reading_session_cache.py
│   │   ├── push_notification_service.py
│   │   ├── settings_manager.py
│   │   ├── user_statistics_service.py
│   │   ├── tsa_parser.py            # TSA (XML-теги) формат ответа LLM
│   │   ├── llm_cache_service.py     # Кэш LLM-ответов
│   │   ├── consistency_manager.py
│   │   ├── description_extraction_service.py
│   │   ├── feature_flag_manager.py
│   │   ├── image_crud_service.py
│   │   ├── parsing_manager.py
│   │   ├── token_blacklist.py
│   │   ├── vless_http_client.py
│   │   ├── book/                    # Утилиты парсинга книги
│   │   └── email/                   # Email-сервис
│   ├── models/             # SQLAlchemy ORM-модели (18 моделей)
│   │   ├── book.py
│   │   ├── chapter.py
│   │   ├── user.py
│   │   ├── entity.py
│   │   ├── entity_mention.py
│   │   ├── entity_relationship.py
│   │   ├── entity_event.py
│   │   ├── description.py
│   │   ├── description_entity.py
│   │   ├── image.py
│   │   ├── reading_session.py
│   │   ├── reading_goal.py
│   │   ├── llm_usage_log.py
│   │   ├── feature_flag.py
│   │   ├── password_reset.py
│   │   ├── push_subscription.py
│   │   └── ...
│   ├── schemas/            # Pydantic-схемы
│   │   ├── responses/      # Схемы ответов API (15 файлов)
│   │   │   ├── entities.py
│   │   │   ├── books_validation.py
│   │   │   ├── chapters.py
│   │   │   ├── descriptions.py
│   │   │   ├── images.py
│   │   │   └── ...
│   │   └── push.py
│   ├── tasks/              # Celery-задачи (10 задач)
│   │   ├── book_tasks.py            # Обработка книги (soft limit 3h)
│   │   ├── image_tasks.py           # Генерация изображений (soft limit 300s)
│   │   ├── cleanup_tasks.py
│   │   ├── reading_sessions_tasks.py
│   │   ├── auth_tasks.py
│   │   ├── utility_tasks.py
│   │   └── common.py
│   ├── middleware/         # FastAPI middleware
│   │   ├── security_headers.py
│   │   ├── cache_control.py
│   │   └── rate_limit.py
│   ├── monitoring/         # Prometheus метрики
│   │   ├── metrics.py
│   │   └── middleware.py
│   ├── parsers/            # Дополнительные парсеры
│   ├── api/                # Дополнительные API-утилиты
│   └── utils/              # Вспомогательные утилиты
├── alembic/                # Миграции БД
│   ├── versions/           # 48 файлов миграций
│   └── env.py
├── tests/                  # Тесты pytest (46 файлов)
│   ├── services/
│   ├── routers/
│   ├── integration/
│   ├── performance/
│   ├── core/
│   ├── middleware/
│   ├── schemas/
│   ├── tasks/
│   └── fixtures/
├── storage/                # Хранилище файлов книг
│   └── books/
│       └── covers/
├── uploads/                # Временные загрузки
│   └── covers/
├── scripts/                # Утилитарные скрипты backend
├── sql/                    # Сырые SQL-запросы
├── Dockerfile.prod         # Production образ (uvicorn, 2 workers)
├── Dockerfile.dev          # Dev образ (hot reload, volume mount)
├── pyproject.toml          # Python зависимости (+ uv.lock)
└── pyproject.toml          # Конфигурация инструментов (ruff, mypy)
```

## Ключевые расположения файлов

**Точки входа:**
- `backend/app/main.py` — FastAPI приложение
- `frontend/src/main.tsx` — React приложение
- `backend/app/core/celery_app.py` — Celery воркер
- `Caddyfile` — реверс-прокси (продакшн)
- `Caddyfile.dev` — реверс-прокси (разработка)

**Конфигурация:**
- `backend/app/core/config.py` — все настройки через env (pydantic-settings)
- `frontend/vite.config.ts` — Vite, PWA, chunks, алиасы
- `.env` — переменные окружения (не коммитится); `.env.example` — шаблон
- `docker-compose.prod.yml` — продакшн деплой
- `docker-compose.dev.yml` — локальная разработка

**Главный AI-клиент:**
- `backend/app/core/openrouter_client.py` — единственная точка входа для всех AI-вызовов

**Горячие файлы (менять осторожно):**
- `frontend/src/components/Reader/EpubReader.tsx` — ~84 коммита
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts` — 8 fallback-стратегий
- `backend/app/services/gemini_extractor.py` — 1221 строка, LLM extraction
- `backend/app/services/entity_service.py` — спойлер-безопасная фильтрация
- `backend/app/routers/images.py` — 957 строк
- `backend/app/routers/reading_sessions.py` — 1089 строк

**Базы данных:**
- `backend/alembic/versions/` — 48 миграций (alembic 1.18.4)
- `postgres/init/` — инициализационные SQL-скрипты

## Соглашения об именовании

**Файлы frontend:**
- Компоненты: `PascalCase.tsx` (например, `EntityCard.tsx`, `EpubReader.tsx`)
- Хуки: `camelCase` с префиксом `use` (например, `useDescriptionHighlighting.ts`, `useBooks.ts`)
- Сервисы: `camelCase.ts` (например, `chapterCache.ts`, `tabSync.ts`)
- Хранилища: `camelCase.ts` (например, `auth.ts`, `reader.ts`)
- API-файлы: `camelCase.ts` (например, `books.ts`, `readingSessions.ts`)
- Типы: `camelCase.ts` / `PascalCase` для интерфейсов

**Файлы backend:**
- Роутеры: `snake_case.py` (например, `reading_sessions.py`, `images.py`)
- Сервисы: `snake_case_service.py` (например, `entity_service.py`, `auth_service.py`)
- Модели: `snake_case.py` совпадает с именем таблицы (например, `entity.py` → таблица `entities`)
- Схемы: `snake_case.py` (например, `books_validation.py`, `entities.py`)
- Задачи: `snake_case_tasks.py` (например, `book_tasks.py`, `image_tasks.py`)

**Директории:**
- Frontend: `PascalCase` для компонентов (`Reader/`, `Entities/`), `camelCase` для хуков/сервисов (`epub/`, `api/`)
- Backend: `snake_case` для всех модулей

## Куда добавлять новый код

**Новый API-эндпоинт:**
- Роутер: `backend/app/routers/{domain}.py` или новый модуль в существующем подпакете
- Схемы: `backend/app/schemas/responses/{domain}.py`
- Подключение: в `backend/app/main.py` через `app.include_router(...)`

**Новый компонент React:**
- Компонент: `frontend/src/components/{Feature}/{ComponentName}.tsx`
- Тест: `frontend/src/components/{Feature}/__tests__/{ComponentName}.test.tsx` или рядом

**Новый API-хук (TanStack Query):**
- Файл: `frontend/src/hooks/api/use{Domain}.ts`
- Ключи запросов: добавить в `frontend/src/hooks/api/queryKeys.ts`

**Новый хук EPUB:**
- Файл: `frontend/src/hooks/epub/use{Feature}.ts`
- Экспорт: добавить в `frontend/src/hooks/epub/index.ts`

**Новая бизнес-логика backend:**
- Сервис: `backend/app/services/{domain}_service.py`
- Импортировать в роутер через FastAPI Depends

**Новая Celery-задача:**
- Файл: `backend/app/tasks/{domain}_tasks.py`
- Зарегистрировать в `backend/app/core/celery_app.py` (include или beat_schedule)

**Новая SQLAlchemy-модель:**
- Модель: `backend/app/models/{name}.py` наследуется от `Base`
- Миграция: `cd backend && alembic revision --autogenerate -m "description"`

**Новая страница:**
- Страница: `frontend/src/pages/{Name}Page.tsx`
- Маршрут: добавить в конфигурацию React Router (обычно в `frontend/src/main.tsx` или отдельный файл маршрутов)

## Особые директории

**`.planning/`:**
- Назначение: GSD-планирование проекта (ROADMAP, STATE, фазы)
- `codebase/` — документы анализа кодовой базы (этот файл)
- `phases/` — PLAN-файлы по фазам
- Генерируется: нет (ручное и автоматическое через GSD-агентов)

**`backend/storage/`:**
- Назначение: Файлы книг (EPUB/FB2) и обложки
- Монтируется в Caddy как `/storage/*`
- Генерируется: да (при загрузке файлов пользователем)
- Коммитится: нет (в `.gitignore`)

**`backend/alembic/versions/`:**
- Назначение: История миграций PostgreSQL (48 файлов)
- Генерируется: частично (через `alembic revision --autogenerate`)
- Коммитится: да (обязательно)

**`frontend/dist/`:**
- Назначение: Продакшн-сборка (статические файлы)
- Генерируется: при `npm run build`
- Коммитится: нет

**`backend/.venv/`:**
- Назначение: Python virtual environment
- Коммитится: нет

**`monitoring/`:**
- Назначение: Конфигурации Grafana, Prometheus, Loki, Netdata
- Используется: `docker-compose.monitoring.yml`

---

*Анализ структуры: 2026-03-04*
