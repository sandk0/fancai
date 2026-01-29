# Промпт для полного аудита Backend fancai

**Дата создания:** 29 января 2026
**Версия:** 1.0
**Для:** Claude Opus 4.5

---

## КОНТЕКСТ ПРОЕКТА

### Что такое fancai?

**fancai** — веб-приложение для чтения книг с автоматической AI-генерацией изображений по описаниям сцен.

**Основные сценарии использования:**
1. Пользователь загружает книгу (EPUB/FB2)
2. Система парсит книгу на главы
3. AI (Gemini) извлекает описания сцен, персонажей, локаций
4. Пользователь читает книгу с подсвеченными описаниями
5. По клику генерируется иллюстрация (Imagen 4)
6. Система отслеживает прогресс чтения (CFI-позиции)

### Технический стек

| Слой | Технологии |
|------|------------|
| **Backend** | FastAPI 0.125 + Python 3.11 + async/await |
| **База данных** | PostgreSQL 15 + SQLAlchemy 2.0 async + Alembic |
| **Кэширование** | Redis 7.4 (кэш, очереди, блокировки, PubSub) |
| **Задачи** | Celery 5.4 + Redis broker |
| **AI** | Google Gemini 3.0 Flash (извлечение) + Imagen 4 (генерация) |
| **Аутентификация** | JWT (access + refresh tokens) + Token blacklist |

### Статистика кодовой базы Backend

| Категория | Количество | Строк кода |
|-----------|------------|------------|
| Всего Python файлов | 118 | ~33,000 |
| Роутеры | 27 | ~8,000 |
| Сервисы | 27 | ~12,000 |
| Модели | 14 | ~2,500 |
| Celery задачи | 7 | ~2,500 |
| Core/Infrastructure | 19 | ~5,000 |
| Тесты | 24+ | ~3,000 |

---

## СТРУКТУРА BACKEND

### Роутеры (backend/app/routers/)

**Основные (13 файлов):**
- `auth.py` — Регистрация, логин, logout, refresh, профиль (7 endpoints)
- `chapters.py` — Контент глав, навигация (2 endpoints)
- `descriptions.py` — Извлечение описаний через LLM (4 endpoints)
- `health.py` — Health checks + Prometheus метрики (4 endpoints)
- `images.py` — Генерация изображений (12 endpoints)
- `push.py` — Web Push уведомления (5 endpoints)
- `reading_progress.py` — CFI-позиции чтения (2 endpoints)
- `reading_sessions.py` — Аналитика сессий (6 endpoints)
- `sync.py` — PWA offline sync (1 endpoint)
- `users.py` — Профиль, подписки, статистика (5 endpoints)
- `websocket.py` — Real-time прогресс обработки (1 WS endpoint)

**Books (4 файла в books/):**
- `crud.py` — Загрузка, список, удаление книг (9 endpoints)
- `validation.py` — Валидация файлов (3 endpoints)
- `processing.py` — Статус обработки (2 endpoints)
- `entities.py` — Граф сущностей (2 endpoints)

**Admin (9 файлов в admin/):**
- `stats.py`, `parsing.py`, `images.py`, `system.py`, `users.py`
- `reading_sessions.py`, `cache.py`, `feature_flags.py`, `entities.py`

### Сервисы (backend/app/services/)

**Core бизнес-логика:**
- `auth_service.py` — JWT, пароли, CRUD пользователей (373 строки)
- `token_blacklist.py` — Отзыв токенов через Redis (156 строк)
- `description_extraction_service.py` — Оркестрация извлечения описаний
- `gemini_extractor.py` — Интеграция с Gemini API (661 строка)
- `imagen_generator.py` — Интеграция с Imagen 4 (644 строки)
- `book_parser.py` — Парсинг EPUB/FB2 (925 строк)
- `tsa_parser.py` — Tagged Span Annotation для точных позиций

**Инфраструктура:**
- `consistency_manager.py` — Дедупликация сущностей, граф
- `graph_service.py` — PageRank, важность сущностей
- `reading_session_cache.py` — Redis кэширование сессий
- `feature_flag_manager.py` — Динамические флаги фич
- `parsing_manager.py` — Очередь парсинга
- `push_notification_service.py` — Web Push

### Модели (backend/app/models/)

| Модель | Полей | Связей | Назначение |
|--------|-------|--------|------------|
| User | 12 | 7 | Пользователи |
| Subscription | 10 | 1 | FREE/PREMIUM/ULTIMATE |
| Book | 20 | 4 | Книги EPUB/FB2 |
| Chapter | 15 | 4 | Главы книг |
| Description | 14 | 3 | Извлечённые описания (5 типов) |
| GeneratedImage | 22 | 3 | Сгенерированные изображения |
| Entity | 12 | 3 | Персонажи/локации/объекты |
| EntityRelationship | 6 | 2 | Рёбра графа |
| EntityMention | 6 | 2 | Hard Links к тексту |
| DescriptionEntity | 5 | 2 | M2M описание-сущность |
| ReadingProgress | 10 | 2 | CFI-позиции |
| ReadingSession | 12 | 2 | Аналитика чтения |
| ReadingGoal | 8 | 1 | Цели чтения |
| FeatureFlag | 8 | 0 | Динамические флаги |
| PushSubscription | 6 | 1 | Web Push endpoints |

### Celery задачи (backend/app/tasks/)

| Файл | Задачи | Тип |
|------|--------|-----|
| `book_tasks.py` | `process_book_task` | Async, 3ч timeout |
| `image_tasks.py` | `generate_image_task`, `generate_image_batch_task` | Async, retry |
| `cleanup_tasks.py` | `cleanup_old_images_task`, `cleanup_stuck_books` | Periodic |
| `reading_sessions_tasks.py` | `close_abandoned_sessions` | Periodic |
| `utility_tasks.py` | `health_check_task`, `system_stats_task` | Utility |

---

## СУЩЕСТВУЮЩИЕ ПРОБЛЕМЫ (из предыдущих аудитов)

### Часть 13: Аудит безопасности (28 января)

| ID | Проблема | Статус |
|----|----------|--------|
| TD-AUDIT-8 | SQLAlchemy case() crash | ✅ Исправлено |
| TD-AUDIT-9 | Python `is True` вместо SQL `==` | ✅ Исправлено |
| TD-AUDIT-10 | Отсутствие Pydantic валидации | ❌ Открыто |
| TD-AUDIT-11 | Redis fail-open в token_blacklist | ❌ Открыто |
| TD-AUDIT-12 | 7-дневный access token | ❌ Открыто |
| TD-AUDIT-13 | Redis connection leak в websocket | ❌ Открыто |
| TD-AUDIT-14 | str(e) в HTTP responses (8 файлов) | ❌ Открыто |
| TD-AUDIT-15 | Race condition в reading_sessions | ❌ Открыто |

### Часть 14: Глубокий аудит (29 января)

**CRITICAL (6 открытых):**
- TD-P3-1: TSA Position Validation Bug — ВСЕ описания отбрасываются
- TD-P3-2: Semaphore Per-Call — Rate limiting broken
- TD-P3-3: Redis Lock Key Mismatch — Deadlock
- TD-P3-4: TaskGroup ExceptionGroup — Unhandled
- TD-P3-5: Delete Before LLM — Data loss при таймауте
- TD-P3-6: Stats Race Condition — Thread safety

**HIGH (11 открытых):**
- TD-P3-8..18: Shared DB session, unbounded memory, dead code, и др.

**MEDIUM (14 открытых):**
- TD-P3-19..32: Race conditions, missing timeouts, singleton safety, и др.

---

## ЗАДАНИЕ НА АУДИТ

### Цель

Провести **полный масштабный аудит** всего backend fancai с учётом:
1. **Бизнес-логики** — Корректность реализации функциональности
2. **UX/API дизайна** — Удобство использования API, консистентность
3. **Архитектуры** — Паттерны проектирования, модульность, масштабируемость
4. **Современных практик** — Соответствие best practices 2025-2026

### Области анализа

#### 1. БИЗНЕС-ЛОГИКА

**Потоки для анализа:**
- Загрузка и парсинг книг (EPUB/FB2)
- Извлечение описаний (Gemini LLM)
- Генерация изображений (Imagen 4)
- Отслеживание прогресса чтения (CFI)
- Управление сущностями (Entity graph)
- Подписки и лимиты

**Вопросы:**
- Корректно ли реализована основная функциональность?
- Есть ли пропущенные edge cases?
- Обрабатываются ли все ошибочные состояния?
- Работает ли бизнес-логика как ожидает пользователь?

#### 2. UX/API ДИЗАЙН

**Аспекты:**
- Консистентность response schemas
- Паттерны пагинации (cursor vs offset)
- Формат ошибок (RFC 7807/9457)
- HTTP status codes
- Rate limiting headers
- API versioning
- Idempotency

**Вопросы:**
- Удобно ли API для разработчиков?
- Консистентны ли форматы ответов?
- Понятны ли сообщения об ошибках?
- Документировано ли API достаточно?

#### 3. АРХИТЕКТУРА И ПРОЕКТИРОВАНИЕ

**Аспекты:**
- Разделение ответственности (роутеры vs сервисы)
- Dependency injection
- Transaction boundaries
- Connection pooling
- Caching strategies
- Background tasks vs Celery
- Error propagation

**Вопросы:**
- Следует ли код принципам Clean Architecture?
- Есть ли God Objects или анти-паттерны?
- Правильно ли используются транзакции?
- Оптимально ли настроен connection pool?

#### 4. БЕЗОПАСНОСТЬ

**Аспекты:**
- Authentication/Authorization
- Input validation
- SQL injection prevention
- File upload security
- Rate limiting coverage
- Secrets management
- Security headers
- CORS configuration

**Вопросы:**
- Есть ли уязвимости?
- Корректно ли валидируются входные данные?
- Защищены ли чувствительные операции?

#### 5. ПРОИЗВОДИТЕЛЬНОСТЬ

**Аспекты:**
- N+1 queries
- Index usage
- Caching effectiveness
- Async/await correctness
- Memory management
- Query optimization

**Вопросы:**
- Есть ли N+1 запросы?
- Используются ли индексы оптимально?
- Эффективен ли кэш?
- Корректно ли используется async?

#### 6. НАДЁЖНОСТЬ

**Аспекты:**
- Retry strategies
- Graceful degradation
- Health checks
- Error recovery
- Distributed locks
- Idempotency

**Вопросы:**
- Что происходит при сбое внешних сервисов?
- Есть ли graceful degradation?
- Корректны ли health checks?

#### 7. OBSERVABILITY

**Аспекты:**
- Logging patterns
- Metrics
- Tracing
- Error tracking

**Вопросы:**
- Достаточно ли логирования для отладки?
- Есть ли метрики для мониторинга?
- Можно ли отследить запрос через систему?

---

## BEST PRACTICES ДЛЯ СРАВНЕНИЯ

### FastAPI (2025-2026)

1. **Конфигурация:** `pydantic-settings` с `SettingsConfigDict`, валидация secrets при старте
2. **DI:** `Annotated` type aliases для зависимостей
3. **Database:** `expire_on_commit=False`, `async_sessionmaker`
4. **Lifecycle:** `lifespan` context manager (не `on_startup`/`on_shutdown`)
5. **Errors:** Глобальные exception handlers, RFC 9457 Problem Details
6. **Background:** `BackgroundTasks` для лёгких задач, Celery для тяжёлых
7. **Testing:** `AsyncClient` + `dependency_overrides`

### SQLAlchemy 2.0 Async

1. **Session:** `expire_on_commit=False`, `autoflush=False`
2. **Loading:** `selectinload` для коллекций, `joinedload` для single
3. **N+1:** `lazy="raise"` на всех relationships
4. **Bulk:** `insert().returning()` для batch operations
5. **Transactions:** Explicit `async with session.begin()` для multi-step
6. **Indexes:** Composite indexes для частых паттернов, GIN для JSONB

### Celery для AI/LLM

1. **Config:** `worker_prefetch_multiplier=1`, `task_acks_late=True`
2. **Timeouts:** `soft_time_limit` + `time_limit` для LLM задач
3. **Retry:** `autoretry_for` с exponential backoff
4. **Memory:** `worker_max_tasks_per_child`, `worker_max_memory_per_child`
5. **Visibility:** `visibility_timeout=86400` для долгих задач
6. **Async:** `asyncio.run()` wrapper для async кода

### LLM Integration

1. **Retry:** Exponential backoff с jitter, различать retryable/non-retryable ошибки
2. **Rate limiting:** Client-side Token Bucket, track RPM и TPM
3. **Caching:** Exact-match (Redis) + Semantic cache (Vector DB)
4. **Tokens:** Подсчёт до отправки, truncation, cost tracking
5. **Fallback:** Multi-provider с automatic failover
6. **Streaming:** SSE для real-time, handle disconnections

### API UX

1. **Errors:** RFC 9457 Problem Details с error codes
2. **Pagination:** Cursor-based для large datasets, consistent envelope
3. **Rate limiting:** Стандартные headers (RateLimit-Limit, -Remaining, -Reset)
4. **Versioning:** URL path (`/v1/`), deprecation headers
5. **Idempotency:** `Idempotency-Key` header для POST
6. **Response:** Consistent envelope (`data`, `meta`, `errors`)

---

## ФОРМАТ ВЫВОДА

### Структура отчёта

```markdown
# Полный аудит Backend fancai

## Executive Summary
- Общая оценка (1-10)
- Ключевые сильные стороны (3-5)
- Критические проблемы (топ-5)

## Часть 15: Аудит бизнес-логики
### 15.1 [Название flow]
- Текущая реализация
- Проблемы найденные
- Рекомендации
...

## Часть 16: Аудит API/UX
...

## Часть 17: Аудит архитектуры
...

## Часть 18: Аудит безопасности (дополнение)
...

## Часть 19: Аудит производительности
...

## Часть 20: Аудит надёжности
...

## Часть 21: Аудит observability
...

## Консолидированный план задач

### P0 — Critical (исправить сегодня)
| ID | Описание | Файл | Время |
|----|----------|------|-------|
| TD-Pxx-x | ... | ... | ... |

### P1 — High (эта неделя)
...

### P2 — Medium (следующая неделя)
...

### Backlog
...
```

### Формат проблемы

```markdown
#### TD-P{часть}-{номер}: {Краткое название}

**Файл:** `path/to/file.py:line`

**Текущий код:**
```python
# Проблемный код
```

**Проблема:** Описание проблемы и её последствий.

**Решение:**
```python
# Исправленный код
```

**Приоритет:** P0/P1/P2 — **Категория** (Security/Performance/UX/etc)
**Время исправления:** Xч/Xм
```

---

## ИНСТРУКЦИИ ДЛЯ АГЕНТА

1. **Читай файлы последовательно** — Начни с core/, затем models/, services/, routers/
2. **Ищи паттерны** — Не только баги, но и анти-паттерны, inconsistencies
3. **Сравнивай с best practices** — Используй чеклисты выше
4. **Учитывай контекст** — Это продакшен приложение для чтения книг
5. **Приоритизируй** — P0 = влияет на пользователя сейчас, P1 = важно, P2 = улучшение
6. **Будь конкретен** — Указывай файл:строка, давай код исправления
7. **Не дублируй** — Проверяй существующие проблемы в Части 13-14

### Файлы для обязательного анализа

**Приоритет 1 (Critical path):**
- `backend/app/services/gemini_extractor.py`
- `backend/app/services/description_extraction_service.py`
- `backend/app/tasks/book_tasks.py`
- `backend/app/services/imagen_generator.py`
- `backend/app/routers/books/crud.py`
- `backend/app/routers/images.py`

**Приоритет 2 (Auth & Security):**
- `backend/app/services/auth_service.py`
- `backend/app/services/token_blacklist.py`
- `backend/app/core/auth.py`
- `backend/app/middleware/`

**Приоритет 3 (Data & Models):**
- `backend/app/models/` (все файлы)
- `backend/app/core/database.py`
- `backend/alembic/versions/`

**Приоритет 4 (API & UX):**
- `backend/app/routers/` (все файлы)
- `backend/app/schemas/` (все файлы)
- `backend/app/core/exceptions.py`

**Приоритет 5 (Infrastructure):**
- `backend/app/core/config.py`
- `backend/app/core/cache.py`
- `backend/app/core/retry.py`
- `backend/app/services/reading_session_cache.py`

---

## ССЫЛКИ

- **Главный план:** `/docs/reports/unified-backend-analysis-2026-01-26.md`
- **AGENTS.md:** `/AGENTS.md`
- **Тесты:** `backend/tests/`
- **Миграции:** `backend/alembic/versions/`
