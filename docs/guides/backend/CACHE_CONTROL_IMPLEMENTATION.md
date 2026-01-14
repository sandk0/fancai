# Cache-Control Headers Implementation

## Что сделано

Добавлены Cache-Control заголовки для правильного управления HTTP кэшированием в BookReader AI.

### Файлы

1. **app/middleware/cache_control.py** (401 строка)
   - `CacheControlMiddleware` - основной middleware
   - `get_cache_control_header()` - определение policy для endpoint
   - `validate_cache_control()` - валидация headers
   - Comprehensive documentation и типы

2. **app/main.py** (обновлен)
   - Добавлен `CacheControlMiddleware` в middleware stack
   - Позиция: после CORS, перед Security Headers

3. **app/middleware/__init__.py** (обновлен)
   - Экспортирует `CacheControlMiddleware`

4. **app/middleware/security_headers.py** (обновлен)
   - Удалена дублирующаяся Cache-Control логика
   - Теперь вся логика в `cache_control.py`

5. **tests/test_cache_control_middleware.py** (308 строк)
   - Comprehensive test suite
   - Unit tests для всех функций
   - Integration tests с FastAPI
   - Edge cases и performance tests

6. **docs/guides/backend/cache-control-headers.md** (полная документация)
   - Архитектура и cache policies
   - Использование и примеры
   - Frontend integration (TanStack Query)
   - Production considerations
   - Troubleshooting

## Cache Policies

### User-Specific Endpoints
```http
Cache-Control: private, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
```

**Endpoints:**
- `/api/v1/books` - Список книг пользователя
- `/api/v1/chapters/*` - Главы книг
- `/api/v1/descriptions/*` - Описания
- `/api/v1/images/*` - Изображения
- `/api/v1/reading-sessions/*` - Сессии чтения
- `/api/v1/users/me` - Профиль пользователя

**Почему:**
- `private` - Только browser cache, НЕ shared caches (CDN)
- `no-cache` - ВСЕГДА revalidate с сервером перед использованием
- Предотвращает утечку приватных данных через shared cache

### Admin/Auth Endpoints
```http
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
Expires: 0
```

**Endpoints:**
- `/api/v1/admin/*` - Admin panel
- `/api/v1/auth/*` - Authentication

**Почему:**
- `no-store` - НЕ сохранять ни в каком кэше
- Максимальная безопасность для sensitive data

### File Serving
```http
Cache-Control: public, max-age=31536000, immutable
```

**Endpoints:**
- `/api/v1/images/file/{filename}` - Сгенерированные изображения

**Почему:**
- `immutable` - Файлы никогда не изменяются (UUID filenames)
- `max-age=31536000` - 1 год кэширования
- `public` - Можно кэшировать в CDN
- Максимальная производительность

### Public Endpoints
```http
Cache-Control: public, max-age=3600
```

**Endpoints:**
- `/health` - Health check
- `/api/v1/info` - API info
- `/docs` - OpenAPI docs

**Почему:**
- Публичные данные, редко меняются
- 1 час TTL

## Проверка работы

### Локально (после docker-compose up)

```bash
# User-specific endpoint
curl -I http://localhost:8000/api/v1/books \
  -H "Authorization: Bearer YOUR_TOKEN"
# Ожидается: Cache-Control: private, no-cache, must-revalidate

# File serving
curl -I http://localhost:8000/api/v1/images/file/test.png
# Ожидается: Cache-Control: public, max-age=31536000, immutable

# Public endpoint
curl -I http://localhost:8000/health
# Ожидается: Cache-Control: public, max-age=3600

# Admin endpoint
curl -I http://localhost:8000/api/v1/admin/stats \
  -H "Authorization: Bearer ADMIN_TOKEN"
# Ожидается: Cache-Control: no-store, no-cache, must-revalidate, private
```

### Тесты

```bash
# Запустить все Cache-Control тесты
docker-compose exec backend pytest tests/test_cache_control_middleware.py -v

# Запустить specific test
docker-compose exec backend pytest tests/test_cache_control_middleware.py::test_user_specific_endpoints_no_cache -v

# С coverage
docker-compose exec backend pytest tests/test_cache_control_middleware.py --cov=app/middleware/cache_control --cov-report=term-missing
```

## Frontend Integration

### TanStack Query Coordination

```typescript
// Frontend автоматически получает benefit от Cache-Control headers

// Пример: Books list
const { data } = useQuery({
  queryKey: ['books'],
  queryFn: fetchBooks,
  staleTime: 0,  // Всегда считать stale
  cacheTime: 5 * 60 * 1000,  // Хранить 5 минут
});

// Backend response:
// Cache-Control: private, no-cache, must-revalidate

// Поведение:
// 1. TanStack Query делает request
// 2. Browser: Cache-Control = no-cache → делает HTTP request с If-None-Match
// 3. Backend: возвращает 304 Not Modified (если не изменилось)
// 4. Browser: использует cached response body
// 5. TanStack Query: обновляет UI
// → Optimal UX: быстрая загрузка + актуальные данные
```

### Service Worker Exclusion

```javascript
// Service Worker НЕ кэширует user-specific endpoints
// → Cache-Control headers контролируют browser HTTP cache
const CACHE_EXCLUDE_PATTERNS = [
  /\/api\/v1\/books/,      // Managed by Cache-Control
  /\/api\/v1\/chapters/,   // Managed by Cache-Control
  /\/api\/v1\/users/,      // Managed by Cache-Control
];
```

## Кастомная Cache Policy

Если нужна custom policy для specific endpoint:

```python
from fastapi import Response

@router.get("/custom")
async def custom_endpoint():
    response = JSONResponse(content={"data": "value"})

    # Middleware НЕ перезапишет manually установленный header
    response.headers["Cache-Control"] = "public, max-age=7200"

    return response
```

## Добавление нового endpoint типа

Если добавляете новый path pattern:

```python
# app/middleware/cache_control.py

# Добавьте в соответствующий список:
USER_SPECIFIC_PATHS = [
    "/api/v1/books",
    "/api/v1/my-new-endpoint",  # ← Новый endpoint
]

# Добавьте тест:
# tests/test_cache_control_middleware.py
def test_new_endpoint_cache_control():
    result = get_cache_control_header("/api/v1/my-new-endpoint", "GET")
    assert "private" in result
```

## Monitoring

### Health Check

```bash
# Проверить все cache policies
curl http://localhost:8000/health/cache-control
```

### Validation

```python
from app.middleware.cache_control import validate_cache_control

# В тестах или monitoring
result = validate_cache_control("/api/v1/books", response.headers)
if not result["valid"]:
    print("Warnings:", result["warnings"])
```

## Rollback Plan

Если нужно отключить middleware:

```python
# app/main.py

# Опция 1: Закомментировать
# app.add_middleware(CacheControlMiddleware)

# Опция 2: Отключить через параметр
app.add_middleware(CacheControlMiddleware, enable_cache_control=False)
```

## Production Deployment

### Docker

```bash
# Build с новым middleware
docker-compose build backend

# Deploy
docker-compose up -d backend

# Проверить logs
docker-compose logs -f backend | grep "Cache-Control"
```

### Проверка в production

```bash
# User endpoint
curl -I https://fancai.ru/api/v1/books \
  -H "Authorization: Bearer YOUR_TOKEN"

# File serving
curl -I https://fancai.ru/api/v1/images/file/abc123.png

# Health check
curl -I https://fancai.ru/health
```

## Benefits

### Безопасность
- ✅ User-specific данные НЕ кэшируются в shared caches
- ✅ Admin/Auth endpoints имеют no-store
- ✅ Предотвращена утечка данных через browser cache

### Производительность
- ✅ Static files кэшируются на 1 год (immutable)
- ✅ Public endpoints кэшируются на 1 час
- ✅ Browser revalidation через If-None-Match (304 responses)

### Developer Experience
- ✅ Автоматическое применение ко всем endpoints
- ✅ Легко добавлять новые path patterns
- ✅ Comprehensive tests и documentation
- ✅ Координация с TanStack Query

## Troubleshooting

### Issue: Headers не появляются

**Решение:**
1. Проверьте что middleware зарегистрирован в `main.py`
2. Проверьте порядок middleware (Cache-Control должен быть перед Security Headers)
3. Проверьте что endpoint не устанавливает Cache-Control вручную

### Issue: Неправильный Cache-Control

**Решение:**
1. Проверьте path в `cache_control.py` lists
2. Запустите validation: `validate_cache_control(path, headers)`
3. Проверьте тесты: `pytest tests/test_cache_control_middleware.py -v`

### Issue: Кэширование не работает

**Решение:**
1. Проверьте browser DevTools → Network → Headers
2. Убедитесь что backend возвращает правильные headers
3. Проверьте CDN configuration (не перезаписывает ли Cache-Control)
4. Убедитесь что TanStack Query настроен правильно

## Дополнительные ресурсы

- [Полная документация](docs/guides/backend/cache-control-headers.md)
- [MDN: HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [TanStack Query: Caching](https://tanstack.com/query/latest/docs/react/guides/caching)

---

**Статус:** ✅ Готово к production deployment
**Тесты:** ✅ 20+ unit и integration tests
**Документация:** ✅ Comprehensive guide
**Совместимость:** ✅ Работает с существующей архитектурой
