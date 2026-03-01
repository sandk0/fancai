# Архитектура

**Дата анализа:** 2026-02-27

## Обзор паттернов

**В целом:** Полностековый разделённый монолит с асинхронным бэкендом и PWA-фронтендом

**Ключевые характеристики:**
- Бэкенд — асинхронный REST + WebSocket API на FastAPI, с Celery для тяжёлых асинхронных задач
- Фронтенд — React SPA (PWA) с TanStack Query для серверного состояния и Zustand для клиентского состояния
- Два отдельных AI-пайплайна: извлечение Gemini (сущности/описания) и генерация Imagen (изображения). Оба мигрируют на OpenRouter в Phase 3 (Imagen 4 → FLUX.2)
- Offline-first фронтенд с кешированием в IndexedDB через `chapterCache`, `epubCache`, `imageCache`
- Система сущностей без спойлеров, использующая CFI-позиции EPUB для фильтрации данных сущностей до текущей позиции чтения

## Слои

**Бэкенд: Базовая инфраструктура:**
- Назначение: конфигурация, фабрика DB-сессий, кеш Redis, аутентификация, ограничение частоты запросов, Celery
- Расположение: `backend/app/core/`
- Содержит: `config.py`, `database.py`, `cache.py`, `auth.py`, `celery_app.py`, `dependencies.py`, `exceptions.py`, `retry.py`, `container.py`
- Зависит от: ничего внутреннего
- Используется: всеми остальными слоями бэкенда

**Бэкенд: Модели данных:**
- Назначение: определения ORM-моделей SQLAlchemy
- Расположение: `backend/app/models/`
- Содержит: `book.py`, `chapter.py`, `entity.py`, `entity_mention.py`, `entity_relationship.py`, `description.py`, `description_entity.py`, `user.py`, `reading_session.py`, `image.py`
- Зависит от: `core/database.py` (базовый класс)
- Используется: сервисами, роутерами (через внедрение зависимостей)

**Бэкенд: Сервисы (бизнес-логика):**
- Назначение: вся бизнес-логика, AI-интеграция, операции с данными
- Расположение: `backend/app/services/`
- Содержит:
  - AI: `gemini_extractor.py` (Gemini API для извлечения сущностей/описаний), `imagen_generator.py` (генерация изображений Imagen 4; мигрирует на FLUX.2 через OpenRouter в Phase 3)
  - Сущности: `entity_service.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `graph_service.py`
  - Книги: `book/book_service.py`, `book/book_progress_service.py`, `book/book_parsing_service.py`, `book/book_statistics_service.py`
  - Парсинг: `book_parser.py` (парсер EPUB/FB2), `description_extraction_service.py`
  - Аутентификация: `auth_service.py`, `token_blacklist.py`
  - Чтение: `reading_session_service.py`, `reading_session_cache.py`
  - Инфраструктура: `settings_manager.py`, `push_notification_service.py`, `llm_cache_service.py`
- Зависит от: моделей, базовой инфраструктуры
- Используется: роутерами, задачами Celery

**Бэкенд: Роутеры (API-эндпоинты):**
- Назначение: обработка HTTP-запросов, валидация входных данных, сериализация ответов
- Расположение: `backend/app/routers/`
- Содержит: `auth.py`, `users.py`, `images.py` (33K строк), `reading_sessions.py` (41K строк), `chapters.py`, `descriptions.py`, `health.py`, `push.py`, `sync.py`, `websocket.py`
- Модульные суб-роутеры: `books/crud.py`, `books/entities.py`, `books/processing.py`, `books/validation.py`
- Админка: каталог `admin/` с отдельными admin-эндпоинтами
- Зависит от: сервисов, базовой инфраструктуры (для зависимостей/аутентификации), схем
- Используется: FastAPI-приложением в `main.py`

**Бэкенд: Схемы:**
- Назначение: валидация запросов/ответов через Pydantic v2
- Расположение: `backend/app/schemas/`
- Содержит: `push.py`, `responses/` (entities, images, reading_sessions и др.)
- Зависит от: ничего
- Используется: роутерами

**Бэкенд: Задачи Celery:**
- Назначение: тяжёлая асинхронная обработка: парсинг книг, генерация изображений, очистка сессий
- Расположение: `backend/app/tasks/`
- Содержит: `book_tasks.py` (лимит 3ч, распределённая блокировка), `image_tasks.py` (300с), `reading_sessions_tasks.py`, `cleanup_tasks.py`, `auth_tasks.py`
- Зависит от: сервисов, моделей, базовой инфраструктуры
- Используется: роутерами (запуск через task.delay()), Celery Beat (по расписанию)

**Фронтенд: API-слой:**
- Назначение: вся HTTP-коммуникация с бэкендом
- Расположение: `frontend/src/api/`
- Содержит: `client.ts` (Axios-синглтон с интерцепторами + автоматическое обновление токена), `books.ts`, `images.ts`, `readingSessions.ts`, `admin.ts`, `auth.ts`, `descriptions.ts`, `push.ts`
- Зависит от: ничего во фронтенде
- Используется: хуками TanStack Query

**Фронтенд: Хуки TanStack Query:**
- Назначение: управление серверным состоянием — получение данных, кеширование, мутации
- Расположение: `frontend/src/hooks/api/`
- Содержит: `useBooks.ts`, `useChapter.ts`, `useDescriptions.ts`, `useImages/`, `useParsingStatus.ts`, `queryKeys.ts`
- Зависит от: API-слоя
- Используется: страницами, компонентами

**Фронтенд: EPUB-хуки:**
- Назначение: интеграция с epub.js, отслеживание CFI-позиций, навигация по главам, подсветка описаний
- Расположение: `frontend/src/hooks/epub/`
- Содержит: `useEpubLoader.ts`, `useEpubNavigation.ts`, `useEpubRendition.ts`, `useCFITracking.ts`, `useDescriptionHighlighting.ts`, `useChapterMapping.ts`, `useEpubThemes.ts`, `useSwipeNavigation.ts`, `useTouchNavigation.ts`, всего 25+ хуков
- Зависит от: API-слоя, слоя сервисов, сторов
- Используется: исключительно `EpubReader.tsx`

**Фронтенд: Хранилища состояния (Zustand):**
- Назначение: глобальное клиентское состояние
- Расположение: `frontend/src/stores/`
- Содержит: `auth.ts` (JWT + пользователь), `reader.ts` (режим навигации, настройки), `ui.ts` (уведомления, модалки), `index.ts` (инициализация)
- Зависит от: ничего
- Используется: всеми компонентами/хуками, которым нужно глобальное состояние

**Фронтенд: Сервисы (клиентские):**
- Назначение: IndexedDB, PWA, кеширование, офлайн-функциональность
- Расположение: `frontend/src/services/`
- Содержит: `chapterCache.ts`, `epubCache.ts`, `imageCache.ts`, `db.ts` (обёртка IndexedDB), `storageManager.ts`, `downloadManager.ts`, `syncQueue.ts`, `pushNotifications.ts`
- Зависит от: ничего
- Используется: хуками, компонентами

**Фронтенд: Страницы:**
- Назначение: компоненты уровня маршрутов, компонуют доменные компоненты
- Расположение: `frontend/src/pages/`
- Содержит: `LibraryPage.tsx`, `BookPage.tsx`, `BookReaderPage.tsx`, `BookImagesPage.tsx`, `ProfilePage.tsx`, `AdminDashboardEnhanced.tsx` и др.
- Зависит от: хуков TanStack Query, компонентов, сторов
- Используется: роутером в `App.tsx`

**Фронтенд: Компоненты:**
- Назначение: переиспользуемые UI-компоненты
- Расположение: `frontend/src/components/`
- Ключевые домены: `Reader/` (UI EPUB-ридера), `Entities/` (UI глоссария сущностей), `Books/`, `UI/` (дизайн-система), `Admin/`, `Auth/`

## Потоки данных

**Поток загрузки и обработки книги:**
1. Пользователь загружает EPUB/FB2 через `BookUploadModal.tsx` → `POST /api/v1/books`
2. Роутер сохраняет файл, создаёт запись Book с `is_processing=True`
3. Роутер запускает `process_book_task.delay(book_id)` (Celery)
4. Задача Celery парсит книгу через `book_parser.py`, создаёт записи `Chapter`
5. Фронтенд опрашивает `GET /api/v1/books/{id}` или подписывается на WebSocket `wss://.../ws/book-progress/{id}`
6. WebSocket транслирует обновления прогресса через Redis PubSub (поддержка нескольких воркеров)
7. По завершении `is_processing=False`, кеш TanStack Query на фронтенде инвалидируется

**Поток AI-извлечения (по запросу, для каждой главы):**
1. Ридер открывает главу через `GET /api/v1/books/{id}/chapters/{num}`
2. Если извлечение ещё не выполнялось, запускается `description_extraction_service.py`
3. `gemini_extractor.py` вызывает Gemini 3.0 Flash с чанками по 100K символов + перекрытие 15%
4. Извлекаются описания (визуальные абзацы) и сущности (персонажи/локации/объекты)
5. Два режима: TSA (XML-теги, по умолчанию) и Legacy (JSON)
6. Результаты сохраняются в таблицы `descriptions`, `entities`, `entity_mentions`
7. Последующие запросы обслуживаются из БД + кеша Redis

**Поток сущностей без спойлеров:**
1. Читатель доходит до главы N (отслеживается по CFI-позиции)
2. Фронтенд вызывает `GET /api/v1/books/{id}/entities?chapter={N}`
3. `entity_service.py` фильтрует сущности, оставляя только те, что впервые упомянуты в главах <= N
4. Детали сущностей (описания, связи) также фильтруются до главы <= N
5. `EntityDrawer.tsx` → `EntityProfile.tsx` отображает вики без спойлеров

**Поток генерации изображений:**
1. Описания извлечены → задача генерации изображений ставится в очередь
2. `image_tasks.py` вызывает `imagen_generator.py`
3. `imagen_generator.py` переводит RU→EN через Gemini, затем вызывает Imagen 4 API (мигрирует на FLUX.2 через OpenRouter в Phase 3)
4. Сгенерированное изображение сохраняется, запись `Image` создаётся в БД
5. Ридер показывает изображения, наложенные на соответствующие текстовые фрагменты, через `useDescriptionHighlighting.ts`

**Поток сессий чтения:**
1. `useReadingSession.ts` отслеживает активное время чтения
2. Прогресс синхронизируется через `useProgressSync.ts` на `PUT /api/v1/books/{id}/progress`
3. Офлайн-чтения ставятся в очередь `syncQueue.ts`, воспроизводятся при подключении к сети
4. Сессии чтения записываются в таблицу `reading_sessions` для статистики

**Управление состоянием:**
- Серверное состояние: TanStack Query с ключами, привязанными к пользователю (`['books', userId, ...]`)
- Клиентское UI-состояние: Zustand-сторы (`auth`, `reader`, `ui`)
- Офлайн-данные: IndexedDB через `db.ts` (книги, главы, изображения)
- Синхронизация между вкладками: `tabSync.ts` транслирует изменения состояния

## Ключевые абстракции

**GeminiDirectExtractor:**
- Назначение: унифицированное AI-извлечение, производящее описания и сущности одновременно
- Файлы: `backend/app/services/gemini_extractor.py`
- Паттерн: структурированный вывод Pydantic с `GeminiEntitySchema`, `GeminiRelationshipSchema`; повторные попытки через tenacity `retry_llm_extraction`

**EntityService:**
- Назначение: фильтрация данных сущностей без спойлеров и сортировка на основе CFI
- Файлы: `backend/app/services/entity_service.py`
- Паттерн: класс-сервис, внедряемый через FastAPI `Depends(get_database_session)`

**BookParser:**
- Назначение: парсинг файлов EPUB/FB2 в структурированные записи Chapter
- Файлы: `backend/app/services/book_parser.py`
- Паттерн: класс-сервис с методами `parse_book()`, `detect_format()`; использует `ebooklib` и `lxml`

**ApiClient:**
- Назначение: Axios-синглтон с автоматическим обновлением JWT и нормализацией ошибок
- Файлы: `frontend/src/api/client.ts`
- Паттерн: класс-синглтон, экспортируемый как `apiClient`; HttpOnly cookie-аутентификация; дедупликация одиночного обновления

**EpubReader:**
- Назначение: основной интерфейс чтения EPUB, оркестрирует 25+ хуков
- Файлы: `frontend/src/components/Reader/EpubReader.tsx`
- Паттерн: функциональный компонент, делегирующий всю логику хукам; UI разделён на `ReaderUI`, `ReaderModals`, `ReaderOverlays`

**QueryKeys:**
- Назначение: централизованный реестр ключей TanStack Query, привязанных к пользователю для безопасности
- Файлы: `frontend/src/hooks/api/queryKeys.ts`
- Паттерн: фабрики `bookKeys`, `chapterKeys` и др., требующие параметр `userId`

**DI-контейнер:**
- Назначение: внедрение зависимостей для сервисов бэкенда
- Файлы: `backend/app/core/container.py`
- Паттерн: абстракции Protocol/Interface + фабрики `lru_cache`; поддерживает переопределение в тестах

## Точки входа

**API бэкенда:**
- Расположение: `backend/app/main.py`
- Запуск: HTTP-сервер uvicorn
- Обязанности: создание FastAPI-приложения, стек middleware, регистрация роутеров, жизненный цикл (инициализация/закрытие Redis + ограничителя частоты)

**Фронтенд-приложение:**
- Расположение: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Запуск: дев-сервер Vite или раздача статических файлов
- Обязанности: корень React-дерева, определения маршрутов, провайдер TanStack Query, ленивая загрузка чанков, регистрация Service Worker

**Celery-воркер:**
- Расположение: `backend/app/core/celery_app.py`
- Запуск: `celery -A app.core.celery_app worker`
- Обязанности: маршрутизация задач (очередь `heavy` для обработки книг, `normal` для изображений, `light` для очистки), расписание beat

**WebSocket-сервер:**
- Расположение: `backend/app/routers/websocket.py`
- Запуск: клиент подключается к `wss://.../ws/book-progress/{book_id}`
- Обязанности: подписка на Redis PubSub по книге, рассылка подключённым клиентам, JWT cookie-аутентификация

## Обработка ошибок

**Стратегия:** RFC 9457 Problem Details на бэкенде, типизированные ответы об ошибках на фронтенде

**Паттерны бэкенда:**
- Кастомный `ProblemDetail(HTTPException)` из `backend/app/core/exceptions.py` для структурированных ответов об ошибках
- `problem_detail_exception_handler` зарегистрирован глобально в `main.py`
- CORS-заголовки сохраняются во всех ответах с ошибками через кастомные обработчики исключений
- Декораторы повторных попыток tenacity из `backend/app/core/retry.py` для всех вызовов LLM и внешних API
- Задачи Celery: `max_retries=3`, `default_retry_delay=60`, обработка `SoftTimeLimitExceeded`

**Паттерны фронтенда:**
- `ErrorBoundary` оборачивает всё приложение на корневом уровне (`main.tsx`) и по маршрутам через `ChunkLoadErrorBoundary`
- Axios-интерцептор в `client.ts` обрабатывает 401 → автоматическое обновление токена → повтор
- Встроенные повторные попытки TanStack Query с экспоненциальной задержкой
- Определение офлайн-режима через `useOnlineStatus.ts`, очередь синхронизации через `syncQueue.ts`

## Сквозные задачи

**Логирование:**
- Бэкенд: на основе `structlog` через `backend/app/core/logging.py`, структурированный JSON-вывод
- Фронтенд: обёртка `frontend/src/lib/logger.ts`, подавляющая логи в продакшене

**Валидация:**
- Бэкенд: Pydantic v2 для всех схем запросов/ответов; кастомные валидаторы в `core/validation.py`
- Фронтенд: TypeScript-типы в `frontend/src/types/api.ts`, `types/epub.ts`, `types/entity.ts`

**Аутентификация:**
- HttpOnly JWT-куки (access + refresh токены)
- `ACCESS_TOKEN_EXPIRE_MINUTES=10080` (7 дней), `REFRESH_TOKEN_EXPIRE_DAYS=30`
- Бэкенд: `core/auth.py`, `services/auth_service.py`, `services/token_blacklist.py`
- Фронтенд: хранится в `useAuthStore` (Zustand), cookie отправляется браузером автоматически

**Ограничение частоты запросов:**
- Ограничитель на основе Redis в `backend/app/core/rate_limiter.py`
- Применяется через декоратор `@rate_limit()` на чувствительных эндпоинтах
- Деградирует плавно при недоступности Redis

**Кеширование:**
- Бэкенд: менеджер кеша Redis в `backend/app/core/cache.py`; кеш результатов LLM в `services/llm_cache_service.py`
- Фронтенд: TanStack Query (сетевые ответы), IndexedDB (главы, EPUB, изображения)

---

*Анализ архитектуры: 2026-02-27*
