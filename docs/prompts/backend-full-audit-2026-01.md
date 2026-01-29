# Задача: Полный архитектурный аудит Backend fancai

**Дата:** 29 января 2026
**Модель:** Claude Opus 4.5
**Язык ответа:** Русский

---

## Контекст проекта

**fancai** — веб-приложение для чтения книг с AI-генерацией изображений по описаниям.

### Технологический стек
- **Backend:** FastAPI 0.125 + Python 3.11 + SQLAlchemy 2.0 async + PostgreSQL 15 + Redis 7.4
- **AI Services:** Google Gemini 3.0 Flash (извлечение описаний) + Google Imagen 4 (генерация изображений)
- **Task Queue:** Celery 5.4 с Redis backend
- **Auth:** JWT с token blacklist в Redis

### Структура Backend
- **27 роутеров** (70+ endpoints): auth, users, books/*, chapters, descriptions, images, reading_progress, reading_sessions, health, sync, websocket, push, admin/*
- **29 сервисов**: auth_service, book_parser, gemini_extractor, imagen_generator, entity_service, reading_session_service, llm_cache_service, и др.
- **14 моделей**: User, Subscription, Book, Chapter, Description, GeneratedImage, Entity, EntityRelationship, ReadingSession, и др.
- **45 тест-файлов**: unit tests, integration tests, performance tests

### Существующий план
Основной план находится в: `/docs/reports/unified-backend-analysis-2026-01-26.md`
Там уже описано 51 найденная проблема (7 P0, 17 P1, 27 P2), часть исправлена.

---

## Цель аудита

Провести **глубокий, всесторонний аудит** Backend по следующим направлениям:

### 1. Бизнес-логика (Business Logic)
- Проверить корректность бизнес-правил и их реализацию
- Найти edge cases и граничные условия
- Выявить race conditions и проблемы конкурентного доступа
- Проверить консистентность данных между связанными операциями
- Валидация пользовательского ввода

### 2. UX/API Design
- Соответствие REST best practices
- Консистентность форматов ответов (Pydantic vs raw dict)
- Информативность сообщений об ошибках (без утечки internal details)
- Pagination patterns (offset vs cursor)
- Rate limiting и headers (X-RateLimit-*)
- RFC 9457 Problem Details

### 3. Архитектура и проектирование
- Clean Architecture / Hexagonal Architecture compliance
- Разделение ответственности (routers vs services)
- Dependency Injection patterns
- Repository vs Service patterns
- Transaction management (Unit of Work)
- Event-driven patterns (domain events)

### 4. Производительность
- N+1 query detection
- Eager loading audit (selectinload, joinedload)
- Connection pooling
- Caching strategies (Redis, LLM cache)
- Async patterns и blocking calls
- Memory management

### 5. Надёжность и отказоустойчивость
- Error handling patterns
- Retry strategies (tenacity)
- Circuit breaker patterns
- Graceful degradation
- Distributed locks
- Idempotency

### 6. Безопасность
- Authentication/Authorization flows
- Input validation и sanitization
- SQL injection prevention
- Rate limiting
- Token management (blacklist, expiration)
- Secrets management
- OWASP API Top 10 compliance

### 7. Качество кода
- Dead code detection
- Code duplication
- Type safety (proper typing, no `Any`)
- Error swallowing (silent exceptions)
- Resource leaks (connections, files)

### 8. Тестируемость
- Test coverage gaps
- Testability of services (DI, mocking)
- Integration test patterns
- Missing test scenarios

---

## Лучшие практики для сравнения (2025-2026)

### FastAPI Best Practices
- Используй `@asynccontextmanager` с `lifespan` вместо deprecated `@app.on_event`
- `Annotated[Type, Depends(...)]` синтаксис для DI
- `expire_on_commit=False` для async sessions
- `ORJSONResponse` для производительности
- Global exception handlers с RFC 9457 Problem Details

### SQLAlchemy 2.0 Async
- `selectinload` для collections (async-safe)
- `joinedload` для many-to-one
- `raiseload('*')` для detection N+1 в dev
- Repository pattern с Identity Map
- Unit of Work для координации транзакций

### Pydantic v2
- `@field_validator` вместо `@validator`
- `@model_validator` для cross-field validation
- `Annotated` для reusable validators
- `computed_field` для derived fields

### AI/LLM Integration
- Exponential backoff с jitter для rate limits
- Structured output validation (Pydantic)
- Multi-layer caching (L1 memory + L2 Redis)
- Model tiering по сложности задачи
- Fallback strategies при failures

---

## Формат отчёта

### Структура отчёта

```
## Executive Summary
- Общая оценка (X/10)
- Ключевые проблемы (top 5)
- Ключевые сильные стороны (top 5)

## Часть 1: Бизнес-логика
### 1.1 Критические проблемы
### 1.2 Высокий приоритет
### 1.3 Средний приоритет
### 1.4 Рекомендации

## Часть 2: UX/API Design
[аналогично]

## Часть 3: Архитектура
[аналогично]

... [для каждого направления]

## Консолидированный план действий

### P0 — Critical (немедленно)
| ID | Задача | Файл | Время |
|----|--------|------|-------|

### P1 — High (этот спринт)
[таблица]

### P2 — Medium (backlog)
[таблица]

## Обновлённые задачи плана
[Обновить существующие задачи из unified-backend-analysis-2026-01-26.md]
- Отметить выполненные
- Добавить новые найденные
- Скорректировать приоритеты

## Статистика аудита
| Категория | Найдено | Выполнено | Осталось |
```

### Формат каждой проблемы

```
#### TD-AUDIT-XX: [Краткое название]

**Файл:** `path/to/file.py:line_number`
**Приоритет:** P0/P1/P2
**Категория:** Business Logic / UX / Architecture / Performance / Security / etc.

**Текущий код:**
\`\`\`python
[проблемный код]
\`\`\`

**Проблема:** [Описание проблемы и её последствий]

**Исправление:**
\`\`\`python
[исправленный код]
\`\`\`

**Время исправления:** Xч/Xмин
```

---

## Инструкции по выполнению

### Шаг 1: Изучение структуры
Прочитай ключевые файлы для понимания архитектуры:
- `backend/app/main.py` — точка входа
- `backend/app/core/` — конфигурация, база, auth
- `backend/app/routers/` — все роутеры
- `backend/app/services/` — бизнес-логика
- `backend/app/models/` — ORM модели
- `backend/app/tasks/` — Celery задачи

### Шаг 2: Существующий план
Прочитай существующий план:
- `/docs/reports/unified-backend-analysis-2026-01-26.md`

Определи:
- Какие задачи уже выполнены (верифицируй по коду)
- Какие задачи актуальны
- Что нужно добавить

### Шаг 3: Глубокий аудит
Для каждого направления (8 категорий):
1. Используй Grep/AST-grep для поиска паттернов
2. Проверяй LSP diagnostics на изменённых файлах
3. Сравнивай с best practices 2025-2026
4. Документируй каждую находку с конкретным кодом

### Шаг 4: Приоритизация
Приоритизируй по критериям:
- **P0 Critical:** Runtime crashes, data loss, security vulnerabilities
- **P1 High:** Bugs affecting users, performance degradation
- **P2 Medium:** Code quality, maintainability, tech debt

### Шаг 5: Обновление плана
Обнови unified-backend-analysis-2026-01-26.md:
- Добавь новую часть (Часть 24+)
- Обнови статистику
- Интегрируй новые задачи в общий план

---

## Ключевые файлы для аудита

### Высокий приоритет (критичная бизнес-логика)
- `backend/app/services/gemini_extractor.py` — LLM extraction
- `backend/app/services/imagen_generator.py` — Image generation
- `backend/app/tasks/book_tasks.py` — Book processing pipeline
- `backend/app/services/auth_service.py` — Authentication
- `backend/app/services/entity_service.py` — Entity management
- `backend/app/routers/images.py` — Image API (1189 строк)
- `backend/app/routers/descriptions.py` — Description API (903 строки)

### Средний приоритет
- `backend/app/routers/reading_sessions.py` — Session tracking
- `backend/app/services/consistency_manager.py` — Data consistency
- `backend/app/services/book/book_progress_service.py` — Progress tracking
- `backend/app/core/auth.py` — Auth middleware

### Тесты
- `backend/tests/` — Определить gaps в покрытии

---

## Ожидаемый результат

1. **Отчёт аудита** в формате Markdown (добавить к unified-backend-analysis)
2. **Обновлённый план** с новыми задачами и статусами
3. **Приоритизированный список** из 30-50 конкретных исправлений
4. **Статистика** по категориям и severity

---

## Важные ограничения

1. **Не начинай реализацию** — только аудит и план
2. **Конкретика** — каждая проблема с файлом и строкой
3. **Код** — приводи текущий и исправленный код
4. **Время** — оценивай время исправления каждой задачи
5. **Русский язык** — весь отчёт на русском
6. **Верификация** — проверяй, что проблема реально существует в коде

---

## Команды для запуска

```bash
# Проверка типов
cd backend && mypy app/ --ignore-missing-imports

# Линтер
cd backend && ruff check app/

# Тесты (если нужна верификация)
cd backend && pytest tests/ -v --no-cov
```

---

Начни с изучения структуры и существующего плана, затем проведи глубокий аудит по каждому направлению.
