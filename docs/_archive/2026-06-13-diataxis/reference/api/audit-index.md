# API Reference - Индекс Документации

## Быстрые Ссылки

### Начните Здесь
- **API Overview** → `overview.md` (1590+ строк, полная документация всех 76 endpoints)
- **Endpoint Verification** → `endpoint-verification.md` (верификация endpoints после рефакторинга)
- **Краткая Сводка** (этот файл)

### Для Разработчиков
- **Interactive API Docs** → http://localhost:8000/docs (Swagger UI)
- **ReDoc** → http://localhost:8000/redoc (альтернативная документация)
- **OpenAPI Schema** → http://localhost:8000/openapi.json

---

## Текущий Статус API (v1.3.0)

**Последнее Обновление:** 2025-11-14

**Всего Endpoints:** 76 (across 20 router files)

**Основные Изменения v1.3.0:**
- NEW: Admin Cache Management (4 endpoints)
- NEW: Admin Reading Sessions (3 endpoints)
- NEW: Admin System Management (3 endpoints)
- UPDATED: Документация актуализирована (было 35+ → стало 76 точных endpoints)

---

## Полная Статистика

- **Всего Endpoints:** 76 маршрутов
- **GET:** 42 (55%)
- **POST:** 23 (30%)
- **PUT:** 7 (9%)
- **DELETE:** 4 (5%)

**По Роутерам (детально):**
- Books Router (books/): 10 endpoints
- Admin Router (admin/): 21 endpoints
- Reading Sessions: 6 endpoints
- Reading Progress: 2 endpoints
- NLP Router: 4 endpoints
- Auth Router: 7 endpoints
- Users Router: 6 endpoints
- Images Router: 8 endpoints
- Chapters Router: 2 endpoints
- Descriptions Router: 3 endpoints
- Health Router: 4 endpoints
- **ИТОГО:** 76 endpoints

---

## Ключевые Характеристики API

### Архитектура
- **Framework:** FastAPI (async/await)
- **Database:** PostgreSQL 15+ (async SQLAlchemy)
- **Cache:** Redis (async aioredis)
- **Authentication:** JWT Bearer tokens
- **Validation:** Pydantic models
- **Documentation:** Auto-generated OpenAPI (Swagger/ReDoc)

### Модульность (Phase 3 Refactoring)
- **Books Router:** Разделен на 3 модуля (crud, validation, processing)
- **Admin Router:** Разделен на 6 модулей (stats, nlp_settings, parsing, images, users, system, cache, reading_sessions)
- **DRY Principles:** Custom exceptions (app/core/exceptions.py), reusable dependencies (app/core/dependencies.py)

### Performance
- **Async Operations:** 100% async database queries
- **Caching:** Redis с TTL (5m, 10s, 1h)
- **Eager Loading:** selectinload() для предотвращения N+1 запросов
- **Connection Pooling:** Managed by FastAPI Depends()

---

## Матрица Статусов Роутеров

| Роутер | Endpoints | Статус | Документация |
|--------|-----------|--------|--------------|
| auth.py | 7 | ✅ Работает | Полностью задокументирован |
| books/crud.py | 5 | ✅ Работает | Полностью задокументирован |
| books/validation.py | 3 | ✅ Работает | Полностью задокументирован |
| books/processing.py | 2 | ✅ Работает | Полностью задокументирован |
| chapters.py | 2 | ✅ Работает | Полностью задокументирован |
| descriptions.py | 3 | ✅ Работает | Полностью задокументирован |
| reading_progress.py | 2 | ✅ Работает | Полностью задокументирован |
| reading_sessions.py | 6 | ✅ Работает | Полностью задокументирован |
| users.py | 6 | ✅ Работает | Полностью задокументирован |
| images.py | 8 | ✅ Работает | Полностью задокументирован |
| nlp.py | 4 | ✅ Работает | Полностью задокументирован |
| health.py | 4 | ✅ Работает | Полностью задокументирован |
| admin/stats.py | 1 | ✅ Работает | Полностью задокументирован |
| admin/nlp_settings.py | 5 | ✅ Работает | Полностью задокументирован |
| admin/parsing.py | 5 | ✅ Работает | Полностью задокументирован |
| admin/images.py | 2 | ✅ Работает | Полностью задокументирован |
| admin/users.py | 1 | ✅ Работает | Полностью задокументирован |
| admin/system.py | 3 | ✅ Работает | Полностью задокументирован |
| admin/cache.py | 4 | ✅ Работает | Полностью задокументирован |
| admin/reading_sessions.py | 3 | ✅ Работает | Полностью задокументирован |
| **ИТОГО** | **76** | **100%** | **v1.3.0 актуализирована** |

---

## Технические Характеристики API

### Async/Database Паттерны
- ✅ 100% async database queries (async SQLAlchemy)
- ✅ selectinload() для предотвращения N+1 запросов
- ✅ Connection pooling через FastAPI Depends()
- ✅ Нет блокирующих I/O операций

**Файлы:** books/crud.py, reading_progress.py, reading_sessions.py

### Обработка Ошибок
- ✅ Custom exceptions (app/core/exceptions.py) - 35+ классов
- ✅ Последовательное использование HTTP статусов
- ✅ Полезные сообщения об ошибках
- ✅ Error handling middleware

**Реализация:** core/exceptions.py, core/dependencies.py

### Кэширование
- ✅ Redis кэширование (async aioredis)
- ✅ Pattern-based invalidation
- ✅ Подходящие TTL (5m, 10s, 1h)
- ✅ Cache statistics endpoint (GET /admin/cache/stats)
- ✅ Manual cache management (4 admin endpoints)

**Управление:** admin/cache.py (4 endpoints)

### Документация (v1.3.0 - АКТУАЛИЗИРОВАНА)
- ✅ Все 76 endpoints задокументированы в overview.md
- ✅ Auto-generated OpenAPI (http://localhost:8000/docs)
- ✅ ReDoc alternative (http://localhost:8000/redoc)
- ✅ Endpoint verification document актуален

**Статус:** 100% покрытие документации

---

## Основные Endpoint Группы

### Books Management (10 endpoints)
**Функциональность:**
- Upload & validation (books/validation.py)
- CRUD operations (books/crud.py)
- Processing & parsing (books/processing.py)

**Ключевые endpoints:**
- POST /books/upload - загрузка EPUB/FB2 файлов
- GET /books/{id}/file - скачивание EPUB для custom reader (EpubReader.tsx)
- GET /books/{id}/cover - обложка книги
- POST /books/{id}/process - запуск NLP обработки

### Admin Management (21 endpoints)
**Модули:**
- admin/stats.py (1) - системная статистика
- admin/nlp_settings.py (5) - управление Multi-NLP
- admin/parsing.py (5) - управление парсингом
- admin/images.py (2) - управление генерацией изображений
- admin/users.py (1) - управление пользователями
- admin/system.py (3) - maintenance режим
- admin/cache.py (4) - управление Redis кэшем
- admin/reading_sessions.py (3) - управление сессиями

**Критические endpoints:**
- GET /admin/cache/stats - Redis статистика
- POST /admin/cache/clear - очистка кэша
- GET /admin/multi-nlp-settings/status - статус NLP процессоров

### Reading Features (8 endpoints)
**Progress Tracking:**
- POST /books/{id}/progress - обновление прогресса (CFI support)
- GET /books/{id}/progress - получение прогресса

**Session Management:**
- POST /reading-sessions/start - начало сессии
- PUT /reading-sessions/{id}/end - завершение сессии
- GET /reading-sessions/statistics - аналитика чтения

### Multi-NLP System (4 endpoints)
**Endpoints:**
- GET /nlp/status - статус всех 3 процессоров (SpaCy, Natasha, Stanza)
- POST /nlp/extract-descriptions - извлечение описаний (5 режимов)
- GET /nlp/test-book-sample - тестирование на примере
- GET /nlp/test-libraries - проверка установленных библиотек

---

## Следующие Шаги (Рекомендуемый Порядок)

### Немедленно (Сегодня - 45 минут)
1. [ ] Добавить is_processing в GET /books/{id} (5м)
2. [ ] Исправить поля ответа auth register (5м)
3. [ ] Выбрать формат токена auth (5м)
4. [ ] Реализовать выбранный формат токена (15м)
5. [ ] Запустить тесты (10м)
6. [ ] Закоммитить изменения (5м)

### На Этой Неделе (8 часов)
7. [ ] Создать директорию backend/app/schemas/
8. [ ] Добавить Pydantic модели для auth ответов
9. [ ] Добавить Pydantic модели для book ответов
10. [ ] Обновить api-documentation.md

### Следующий Спринт (8 часов)
11. [ ] Добавить response_model= во все декораторы
12. [ ] Проверить оставшиеся роутеры (admin, images, nlp)
13. [ ] Добавить отсутствующее ограничение частоты

---

## Стратегия Тестирования

После каждого исправления запускайте:

```bash
# Unit тесты
cd backend && pytest tests/ -v --cov=app

# Integration тесты
curl -X GET http://localhost:8000/api/v1/books/
curl -X POST http://localhost:8000/api/v1/auth/login

# OpenAPI валидация
curl http://localhost:8000/docs
```

---

## Справочник по Документации

### Файлы Reference Documentation
- **overview.md** (1590+ строк) - Полная документация всех 76 endpoints
  - Детальные request/response примеры
  - Authentication схемы
  - Error handling
  - Rate limiting
  - Changelog v1.0.0 → v1.3.0

- **endpoint-verification.md** - Верификация endpoints после Phase 3 refactoring
  - Mapping старых → новых endpoints
  - Обратная совместимость 100%
  - Примеры использования

- **audit-index.md** (этот файл) - Быстрый справочник
  - Статистика endpoints
  - Технические характеристики
  - Основные endpoint группы

### Исходный Код (20 Router Files)
**Books Router (3 файла):**
- books/crud.py (5 endpoints)
- books/validation.py (3 endpoints)
- books/processing.py (2 endpoints)

**Admin Router (8 файлов):**
- admin/stats.py (1 endpoint)
- admin/nlp_settings.py (5 endpoints)
- admin/parsing.py (5 endpoints)
- admin/images.py (2 endpoints)
- admin/users.py (1 endpoint)
- admin/system.py (3 endpoints)
- admin/cache.py (4 endpoints)
- admin/reading_sessions.py (3 endpoints)

**Other Routers (9 файлов):**
- auth.py (7 endpoints)
- users.py (6 endpoints)
- reading_sessions.py (6 endpoints)
- reading_progress.py (2 endpoints)
- chapters.py (2 endpoints)
- descriptions.py (3 endpoints)
- images.py (8 endpoints)
- nlp.py (4 endpoints)
- health.py (4 endpoints)

---

## Быстрый Доступ к API

### Development
```bash
# Запуск API server
cd backend && uvicorn app.main:app --reload --port 8000

# Interactive docs
open http://localhost:8000/docs

# ReDoc
open http://localhost:8000/redoc

# OpenAPI JSON schema
curl http://localhost:8000/openapi.json
```

### Testing
```bash
# Unit tests
cd backend && pytest tests/ -v --cov=app

# Test specific router
pytest tests/test_books.py -v

# Integration tests
pytest tests/integration/ -v
```

### Common Commands
```bash
# Получить токен
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Загрузить книгу
curl -X POST http://localhost:8000/api/v1/books/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@book.epub"

# Проверить NLP статус
curl http://localhost:8000/api/v1/nlp/status

# Admin: Cache stats
curl http://localhost:8000/api/v1/admin/cache/stats \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```


---

## Changelog

### v1.3.0 (2025-11-14)
- ✅ Документация актуализирована (35+ → 76 точных endpoints)
- ✅ Добавлена документация Admin Cache Management (4 endpoints)
- ✅ Добавлена документация Admin Reading Sessions (3 endpoints)
- ✅ Добавлена документация Admin System Management (3 endpoints)
- ✅ Обновлены матрицы статусов роутеров (100% покрытие)
- ✅ Актуализирован справочник по документации

### v1.2.0 (2025-10-23)
- Документация Multi-NLP & Custom EPUB Reader
- Endpoint verification после Phase 3 refactoring

---

**Расположение:** `/docs/reference/api/audit-index.md`
**Последнее Обновление:** 2025-11-14
**Статус:** ✅ Актуальна (v1.3.0)
