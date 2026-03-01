# Структура кодовой базы

**Дата анализа:** 2026-02-27

## Схема каталогов

```
fancai-vibe-hackathon/             # Корень репозитория
├── backend/                       # Python-бэкенд на FastAPI
│   ├── app/                       # Код приложения
│   │   ├── core/                  # Инфраструктура: конфигурация, БД, Redis, аутентификация, Celery
│   │   ├── models/                # ORM-модели SQLAlchemy
│   │   ├── routers/               # Обработчики маршрутов FastAPI (API-эндпоинты)
│   │   │   ├── books/             # Модульный суб-роутер книг
│   │   │   └── admin/             # Эндпоинты только для администраторов
│   │   ├── schemas/               # Pydantic v2 схемы запросов/ответов
│   │   │   └── responses/         # Схемы только для ответов
│   │   ├── services/              # Бизнес-логика и AI-интеграция
│   │   │   ├── book/              # Сервисы для книг (паттерн SRP)
│   │   │   └── email/             # Почтовый сервис
│   │   ├── tasks/                 # Асинхронные задачи Celery
│   │   ├── middleware/            # Middleware FastAPI (безопасность, кеш, ограничение частоты)
│   │   ├── monitoring/            # Метрики Prometheus
│   │   ├── parsers/               # Устаревший код парсеров
│   │   ├── utils/                 # Утилитарные функции бэкенда
│   │   └── main.py                # Точка входа FastAPI-приложения
│   ├── alembic/                   # Миграции базы данных
│   │   └── versions/              # Файлы миграций (с временными метками)
│   ├── tests/                     # Тестовый набор бэкенда (pytest)
│   ├── scripts/                   # Утилитарные скрипты
│   ├── sql/                       # Чистый SQL (init.sql)
│   ├── storage/                   # Локальное файловое хранилище (книги, обложки)
│   └── docs/                      # Документация, специфичная для бэкенда
├── frontend/                      # React TypeScript PWA-фронтенд
│   └── src/
│       ├── api/                   # Axios API-клиент + доменные API-функции
│       ├── components/            # React-компоненты (организованы по доменам)
│       │   ├── Reader/            # UI-компоненты EPUB-ридера
│       │   ├── Entities/          # UI глоссария/вики сущностей
│       │   ├── Books/             # Модалки загрузки и удаления книг
│       │   ├── UI/                # Примитивы дизайн-системы
│       │   ├── Admin/             # Админ-панель
│       │   ├── Auth/              # AuthGuard, формы входа
│       │   ├── Layout/            # Оболочка приложения, навигация
│       │   ├── Library/           # Компоненты страницы библиотеки
│       │   ├── Home/              # Компоненты главной страницы
│       │   ├── Images/            # Компоненты галереи изображений
│       │   ├── Settings/          # UI настроек
│       │   └── SEO/               # Мета-теги
│       ├── hooks/                 # React-хуки
│       │   ├── api/               # Хуки TanStack Query (серверное состояние)
│       │   ├── epub/              # Хуки интеграции с epub.js (25+ хуков)
│       │   ├── reader/            # Специфичные для ридера хуки (не epub)
│       │   ├── pwa/               # PWA-хуки
│       │   └── shared/            # Общие утилитарные хуки
│       ├── pages/                 # Компоненты страниц уровня маршрутов
│       ├── services/              # Клиентские сервисы (IndexedDB, PWA, кеширование)
│       ├── stores/                # Zustand-хранилища состояния
│       ├── lib/                   # Утилиты: queryClient, i18n, logger, zIndex
│       ├── utils/                 # Утилитарные функции
│       ├── types/                 # Определения TypeScript-типов
│       ├── config/                # Константы фронтенда
│       ├── styles/                # Глобальный CSS (темы, переменные)
│       ├── locales/               # Файлы переводов i18n
│       ├── assets/                # Статические ресурсы
│       ├── test/                  # Настройка и утилиты тестов
│       ├── App.tsx                # Корневой компонент с маршрутизацией
│       ├── main.tsx               # Точка входа React
│       └── sw.ts                  # Service Worker
├── nginx/                         # Конфигурация Nginx для продакшена
├── docker/                        # Вспомогательные файлы Docker
├── monitoring/                    # Конфигурация Prometheus/Grafana
├── postgres/                      # Конфигурация PostgreSQL
├── redis/                         # Конфигурация Redis
├── scripts/                       # Утилитарные скрипты корневого уровня
├── deploy/                        # Скрипты развёртывания
├── docs/                          # Документация уровня проекта
├── docker-compose.lite.yml        # Основной compose-файл для разработки/продакшена
├── docker-compose.lite.prod.yml   # Продакшен-специфичные переопределения
└── CLAUDE.md                      # Инструкции проекта для Claude
```

## Назначение каталогов

**`backend/app/core/`:**
- Назначение: сквозная инфраструктура, общая для всех слоёв бэкенда
- Содержит: `config.py` (Pydantic-настройки), `database.py` (асинхронный движок SQLAlchemy + фабрика сессий), `cache.py` (менеджер кеша Redis), `auth.py` (JWT-хелперы), `celery_app.py` (Celery + расписание beat), `dependencies.py` (функции зависимостей FastAPI), `exceptions.py` (RFC 9457 ProblemDetail), `retry.py` (декораторы tenacity для вызовов LLM), `container.py` (DI-контейнер с Protocol-интерфейсами), `rate_limiter.py`, `validation.py`
- Ключевые файлы: `backend/app/core/config.py`, `backend/app/core/database.py`, `backend/app/core/container.py`

**`backend/app/models/`:**
- Назначение: все определения ORM-моделей SQLAlchemy
- Содержит: `book.py` (Book, ReadingProgress), `chapter.py`, `entity.py`, `entity_mention.py`, `entity_relationship.py`, `description.py`, `description_entity.py`, `user.py`, `reading_session.py`, `image.py`, `entity_event.py`
- Ключевые файлы: `backend/app/models/book.py`, `backend/app/models/entity.py`

**`backend/app/services/`:**
- Назначение: вся бизнес-логика, AI-пайплайн и доменные операции
- Содержит: плоские файлы сервисов + подкаталог `book/` (декомпозиция по SRP)
- AI-файлы: `gemini_extractor.py` (Gemini 3.0 Flash, извлечение описаний + сущностей), `imagen_generator.py` (Imagen 4; мигрирует на FLUX.2 через OpenRouter), `description_extraction_service.py`
- Файлы сущностей: `entity_service.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `graph_service.py`
- Ключевые файлы: `backend/app/services/gemini_extractor.py`, `backend/app/services/entity_service.py`, `backend/app/services/book_parser.py`

**`backend/app/routers/`:**
- Назначение: обработчики HTTP-запросов/ответов; тонкий слой, делегирующий сервисам
- Тяжёлые файлы (известный технический долг): `images.py` (33K строк), `reading_sessions.py` (41K строк)
- Модульные: `books/` разделён на `crud.py`, `entities.py`, `processing.py`, `validation.py`
- Ключевые файлы: `backend/app/routers/books/crud.py`, `backend/app/routers/websocket.py`

**`backend/app/tasks/`:**
- Назначение: определения асинхронных задач Celery
- Содержит: `book_tasks.py` (лимит 3ч, распределённая Redis-блокировка), `image_tasks.py`, `reading_sessions_tasks.py`, `cleanup_tasks.py`, `auth_tasks.py`, `utility_tasks.py`
- Ключевые файлы: `backend/app/tasks/book_tasks.py`, `backend/app/tasks/image_tasks.py`

**`backend/alembic/versions/`:**
- Назначение: файлы миграций базы данных, по одному на каждое изменение схемы
- Именование: `YYYY_MM_DD_HHMM-{hash}_{description}.py`
- Ключевые файлы: актуально `backend/alembic/versions/` (48 файлов по состоянию на 2026-02-27)

**`frontend/src/api/`:**
- Назначение: вся сетевая коммуникация; Axios-клиент + доменные API-функции
- Содержит: `client.ts` (класс-синглтон с интерцепторами), `books.ts`, `images.ts`, `readingSessions.ts`, `auth.ts`, `admin.ts`, `descriptions.ts`, `health.ts`, `push.ts`
- Ключевые файлы: `frontend/src/api/client.ts`, `frontend/src/api/books.ts`

**`frontend/src/hooks/api/`:**
- Назначение: хуки TanStack Query, оборачивающие API-слой; всё получение серверных данных — здесь
- Содержит: `useBooks.ts`, `useChapter.ts`, `useDescriptions.ts`, `useImages/`, `useParsingStatus.ts`, `queryKeys.ts`
- Ключевые файлы: `frontend/src/hooks/api/queryKeys.ts`, `frontend/src/hooks/api/useBooks.ts`

**`frontend/src/hooks/epub/`:**
- Назначение: интеграция с epub.js; отслеживание CFI, навигация, темы, подсветка
- Содержит: 25+ хуков, включая `useEpubLoader.ts`, `useCFITracking.ts`, `useDescriptionHighlighting.ts`, `useChapterMapping.ts`, `useEpubNavigation.ts`, `useSwipeNavigation.ts`, `useTouchNavigation.ts`
- Ключевые файлы: `frontend/src/hooks/epub/useEpubLoader.ts`, `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

**`frontend/src/components/Reader/`:**
- Назначение: UI EPUB-ридера — наиболее изменяемая область фронтенда
- Содержит: `EpubReader.tsx` (главный компонент, 84+ изменений), `BookReader.tsx`, `ReaderControls.tsx`, `TocSidebar.tsx`, `SelectionMenu.tsx`, `IOSTapZones.tsx` и подкаталог `Core/`
- Ключевые файлы: `frontend/src/components/Reader/EpubReader.tsx`

**`frontend/src/components/Entities/`:**
- Назначение: UI-компоненты глоссария/вики сущностей
- Содержит: `EntityList.tsx`, `EntityCard.tsx`, `EntityDrawer.tsx`, `EntityProfile.tsx`, `EntityEventTimeline.tsx`, `RelationshipCard.tsx`, `RecapPanel.tsx`, `SpoilerText.tsx`
- Ключевые файлы: `frontend/src/components/Entities/EntityProfile.tsx`, `frontend/src/components/Entities/EntityDrawer.tsx`

**`frontend/src/services/`:**
- Назначение: клиентская инфраструктура — IndexedDB, офлайн, PWA, синхронизация
- Содержит: `chapterCache.ts`, `epubCache.ts`, `imageCache.ts`, `db.ts`, `storageManager.ts`, `downloadManager.ts`, `syncQueue.ts`, `pushNotifications.ts`, `tabSync.ts`
- Ключевые файлы: `frontend/src/services/chapterCache.ts`, `frontend/src/services/db.ts`

**`frontend/src/stores/`:**
- Назначение: глобальное клиентское состояние на Zustand
- Содержит: `auth.ts` (JWT-токены + пользователь), `reader.ts` (режим навигации, настройки), `ui.ts` (тосты, модалки), `index.ts` (инициализация + очистка)
- Ключевые файлы: `frontend/src/stores/auth.ts`, `frontend/src/stores/reader.ts`

## Расположение ключевых файлов

**Точки входа:**
- `backend/app/main.py`: FastAPI-приложение, стек middleware, регистрация роутеров
- `frontend/src/main.tsx`: корень React DOM, оборачивает в ErrorBoundary
- `frontend/src/App.tsx`: React Router, определения маршрутов, QueryClientProvider
- `backend/app/core/celery_app.py`: Celery-приложение + расписание beat

**Конфигурация:**
- `backend/app/core/config.py`: все настройки бэкенда через pydantic-settings (из переменных окружения)
- `frontend/src/lib/queryClient.ts`: конфигурация клиента TanStack Query
- `docker-compose.lite.yml`: основной compose-файл для всех окружений

**Основная логика:**
- `backend/app/services/gemini_extractor.py`: AI-пайплайн извлечения Gemini
- `backend/app/services/entity_service.py`: фильтрация сущностей без спойлеров
- `backend/app/services/book_parser.py`: парсинг EPUB/FB2
- `backend/app/tasks/book_tasks.py`: задача Celery для обработки книг
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts`: подсветка описаний с 8 стратегиями
- `frontend/src/hooks/epub/useChapterMapping.ts`: маппинг EPUB spine на номер главы
- `frontend/src/components/Reader/EpubReader.tsx`: главная оркестрация ридера

**База данных:**
- `backend/alembic/versions/`: история миграций (48 миграций с августа 2025)
- `backend/app/models/`: все ORM-модели

**Тестирование:**
- `backend/tests/`: тестовый набор pytest
- `frontend/src/components/__tests__/`: тесты компонентов фронтенда
- `frontend/src/hooks/__tests__/`: тесты хуков фронтенда
- `frontend/src/hooks/epub/__tests__/`: тесты EPUB-хуков

## Соглашения об именовании

**Файлы бэкенда:**
- Сервисы: `snake_case_service.py` (например, `entity_service.py`, `auth_service.py`)
- Модели: `snake_case.py`, соответствующие имени таблицы (например, `book.py`, `entity_mention.py`)
- Роутеры: `snake_case.py` (например, `reading_sessions.py`, `descriptions.py`)
- Задачи: `snake_case_tasks.py` (например, `book_tasks.py`, `image_tasks.py`)
- Миграции: `YYYY_MM_DD_HHMM-{hash}_{description}.py`

**Файлы фронтенда:**
- Компоненты: `PascalCase.tsx` (например, `EntityProfile.tsx`, `BookUploadModal.tsx`)
- Хуки: `camelCase.ts` с префиксом `use` (например, `useEpubLoader.ts`, `useCFITracking.ts`)
- API-функции: `camelCase.ts` по домену (например, `books.ts`, `readingSessions.ts`)
- Сторы: `camelCase.ts` (например, `auth.ts`, `reader.ts`)
- Типы: `camelCase.ts` (например, `api.ts`, `epub.ts`, `entity.ts`)
- Сервисы: `camelCase.ts` (например, `chapterCache.ts`, `storageManager.ts`)

**Каталоги:**
- Бэкенд: `snake_case/` (например, `reading_sessions/`, `book/`)
- Компоненты фронтенда: `PascalCase/` (например, `Reader/`, `Entities/`, `UI/`)
- Хуки фронтенда: `camelCase/` (например, `epub/`, `api/`, `reader/`)

## Где добавлять новый код

**Новая фича бэкенда (REST-эндпоинт):**
- Сервис: `backend/app/services/{feature}_service.py`
- Роутер: `backend/app/routers/{feature}.py` или расширение существующего роутера
- Схема: `backend/app/schemas/responses/{feature}.py`
- Зарегистрировать роутер в `backend/app/main.py`
- Миграция при изменениях БД: `cd backend && alembic revision --autogenerate -m "description"`

**Новая модель бэкенда:**
- Файл: `backend/app/models/{model_name}.py`, наследующий `Base` из `core/database.py`
- Импортировать в `backend/app/models/__init__.py`
- Создать миграцию: `alembic revision --autogenerate`

**Новая задача Celery:**
- Файл: `backend/app/tasks/{domain}_tasks.py`
- Использовать декоратор `@celery_app.task` с `bind=True`
- Зарегистрировать в `celery_app.conf.update(task_routes=...)` для маршрутизации в очередь

**Новый хук API фронтенда:**
- Добавить API-функцию в `frontend/src/api/{domain}.ts`
- Добавить фабрику ключей запросов в `frontend/src/hooks/api/queryKeys.ts`
- Создать хук в `frontend/src/hooks/api/use{Feature}.ts`
- Экспортировать из `frontend/src/hooks/api/index.ts`

**Новый компонент фронтенда:**
- Доменный компонент: `frontend/src/components/{Domain}/MyComponent.tsx`
- UI-примитив: `frontend/src/components/UI/MyComponent.tsx`
- Экспортировать из доменного `index.ts`

**Новая страница фронтенда:**
- Файл: `frontend/src/pages/{Name}Page.tsx`
- Добавить ленивый импорт и маршрут в `frontend/src/App.tsx`

**Новый EPUB-хук:**
- Файл: `frontend/src/hooks/epub/use{Feature}.ts`
- Экспортировать из `frontend/src/hooks/epub/index.ts`
- Импортировать в `EpubReader.tsx` и подключить через пропсы

**Новый Zustand-стор:**
- Файл: `frontend/src/stores/{name}.ts`
- Экспортировать из `frontend/src/stores/index.ts`
- Инициализировать в `initializeStores()` при необходимости

## Специальные каталоги

**`backend/storage/`:**
- Назначение: локальное файловое хранилище для загруженных EPUB и сгенерированных изображений
- Генерируется: да (при выполнении)
- Коммитится: нет (`.gitignore`)

**`backend/alembic/versions/`:**
- Назначение: история миграций базы данных
- Генерируется: через `alembic revision --autogenerate`
- Коммитится: да (необходимо для воспроизводимых развёртываний)

**`frontend/src/locales/`:**
- Назначение: файлы переводов i18n (русский — основной язык)
- Генерируется: нет
- Коммитится: да

**`backend/htmlcov/`:**
- Назначение: HTML-отчёт о покрытии pytest
- Генерируется: да (`pytest --cov`)
- Коммитится: нет

**`.planning/`:**
- Назначение: документы планирования GSD (архитектура, спецификации, фазы)
- Генерируется: инструментами GSD
- Коммитится: да

**`.claude/`:**
- Назначение: скиллы, правила, хуки, агенты Claude Code
- Генерируется: частично (часть автогенерируется, часть написана вручную)
- Коммитится: да

**`nginx/`:**
- Назначение: конфигурация Nginx для продакшен-прокси
- Генерируется: нет
- Коммитится: да

---

*Анализ структуры: 2026-02-27*
