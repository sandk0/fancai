# Cache-Control Headers в BookReader AI

## Обзор

BookReader AI использует `CacheControlMiddleware` для автоматического управления HTTP кэшированием через Cache-Control headers. Это обеспечивает:

- **Безопасность**: Предотвращает кэширование приватных данных пользователей
- **Производительность**: Агрессивное кэширование статических файлов
- **UX**: Координация с TanStack Query для optimal cache invalidation

## Архитектура

### Middleware Stack

```
Request → CORS → Security Headers → Cache Control → GZip → Response
```

**Порядок выполнения** (обратный порядку добавления):
1. CORS (первым) - обрабатывает preflight requests
2. Security Headers - добавляет security headers
3. **Cache Control** - устанавливает Cache-Control
4. GZip (последним) - сжимает response

### Файлы

| Файл | Назначение |
|------|------------|
| `app/middleware/cache_control.py` | Cache-Control middleware |
| `app/main.py` | Регистрация middleware |
| `tests/test_cache_control_middleware.py` | Unit тесты |

## Cache Policies

### User-Specific Endpoints

**Policy:** `private, no-cache, must-revalidate`

**Endpoints:**
- `/api/v1/books` - Список книг пользователя
- `/api/v1/chapters/*` - Главы книг
- `/api/v1/descriptions/*` - Описания из текста
- `/api/v1/images/*` - Генерация изображений
- `/api/v1/reading-sessions/*` - Сессии чтения
- `/api/v1/users/me` - Профиль пользователя

**Почему:**
- `private` - Только browser cache, НЕ shared caches (CDN, proxy)
- `no-cache` - ВСЕГДА revalidate с сервером перед использованием
- `must-revalidate` - После истечения TTL обязательна проверка

**Frontend Integration:**
```typescript
// TanStack Query автоматически revalidates при:
// 1. Window focus
// 2. Network reconnect
// 3. Manual invalidation (queryClient.invalidateQueries)

// Cache-Control: private, no-cache гарантирует что browser
// не вернет stale данные другому пользователю (shared cache)
```

### Admin Endpoints

**Policy:** `no-store, no-cache, must-revalidate, private`

**Endpoints:**
- `/api/v1/admin/*` - Все admin endpoints

**Почему:**
- `no-store` - НЕ сохранять ни в каком кэше (максимальная безопасность)
- Sensitive system data не должна попасть в browser cache

### Authentication Endpoints

**Policy:** `no-store, no-cache, must-revalidate, private`

**Endpoints:**
- `/api/v1/auth/login`
- `/api/v1/auth/register`
- `/api/v1/auth/refresh`
- `/api/v1/auth/logout`

**Почему:**
- Security critical endpoints
- Credentials не должны кэшироваться

### File Serving

**Policy:** `public, max-age=31536000, immutable`

**Endpoints:**
- `/api/v1/images/file/{filename}` - Сгенерированные изображения

**Почему:**
- `immutable` - Файлы никогда не изменяются (content-addressed by unique filename)
- `max-age=31536000` - 1 год кэширования (максимально допустимый)
- `public` - Можно кэшировать в CDN/proxy (файлы публичные)

**Механизм:**
```python
# Imagen генерирует файлы с UUID именами
filename = f"{uuid4()}.png"
# Один и тот же filename ВСЕГДА содержит одно и то же изображение
# → можно кэшировать навсегда
```

### Public Endpoints

**Policy:** `public, max-age=3600`

**Endpoints:**
- `/health` - Health check
- `/api/v1/info` - API информация
- `/docs` - OpenAPI docs
- `/openapi.json` - OpenAPI schema

**Почему:**
- Публичные данные, редко меняются
- 1 час TTL - баланс freshness vs performance

### Default (Unknown)

**Policy:** `no-cache, must-revalidate`

**Применяется:** Для всех неизвестных endpoints

**Почему:**
- Безопасная стратегия по умолчанию
- Предотвращает случайное кэширование sensitive data

## Использование

### Автоматическое применение

Middleware автоматически применяется ко всем endpoints:

```python
# app/main.py
app.add_middleware(CacheControlMiddleware)

# Все endpoints автоматически получают правильные headers
@router.get("/api/v1/books")
async def list_books(...):
    # Response будет иметь: Cache-Control: private, no-cache, must-revalidate
    return {"books": [...]}
```

### Ручное управление

Если нужна custom policy, установите header вручную:

```python
from fastapi import Response
from app.middleware.cache_control import add_cache_control_header

@router.get("/custom")
async def custom_endpoint():
    response = JSONResponse(content={"data": "value"})

    # Middleware НЕ перезапишет manually установленный header
    response.headers["Cache-Control"] = "public, max-age=7200"

    return response

# Или используйте helper function
@router.get("/custom2")
async def custom_endpoint2():
    response = JSONResponse(content={"data": "value"})
    return add_cache_control_header(response, "public, max-age=7200")
```

### Отключение для specific endpoint

```python
from fastapi import Response

@router.get("/no-cache-control")
async def no_cache_control():
    response = JSONResponse(content={"data": "value"})
    # Установите пустой header чтобы предотвратить middleware
    response.headers["Cache-Control"] = ""
    return response
```

## Тестирование

### Unit Tests

```bash
# Запустить все Cache-Control тесты
docker-compose exec backend pytest tests/test_cache_control_middleware.py -v

# Запустить specific test
docker-compose exec backend pytest tests/test_cache_control_middleware.py::test_user_specific_endpoints_no_cache -v
```

### Manual Testing

```bash
# Проверить Cache-Control для user endpoint
curl -I http://localhost:8000/api/v1/books \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected:
# Cache-Control: private, no-cache, must-revalidate
# Pragma: no-cache
# Expires: 0

# Проверить Cache-Control для file serving
curl -I http://localhost:8000/api/v1/images/file/abc123.png

# Expected:
# Cache-Control: public, max-age=31536000, immutable
```

### Validation Helper

```python
from app.middleware.cache_control import validate_cache_control

# Использовать в тестах
result = validate_cache_control("/api/v1/books", response.headers)
assert result["valid"], result["warnings"]
```

## Cache-Control Директивы

### Основные директивы

| Директива | Значение |
|-----------|----------|
| `no-store` | НЕ сохранять в кэше (браузер, CDN, proxy) |
| `no-cache` | Можно сохранить, но ВСЕГДА revalidate |
| `private` | Только browser cache, НЕ shared caches |
| `public` | Можно кэшировать в shared caches |
| `max-age=N` | Время жизни в секундах |
| `must-revalidate` | После истечения max-age обязательна проверка |
| `immutable` | Контент никогда не изменится |

### Комбинации

```
no-store, no-cache
→ Максимальная безопасность, нет кэширования

private, no-cache, must-revalidate
→ Browser может кэшировать, но ВСЕГДА проверяет с сервером

public, max-age=31536000, immutable
→ Агрессивное кэширование, файл никогда не изменится

public, max-age=3600
→ Кэширование на 1 час в shared caches
```

## Координация с Frontend

### TanStack Query + Cache-Control

```typescript
// Frontend (TanStack Query)
const { data } = useQuery({
  queryKey: ['books'],
  queryFn: fetchBooks,
  staleTime: 0,  // Всегда считать stale
  cacheTime: 5 * 60 * 1000,  // Хранить 5 минут
});

// Backend (Cache-Control)
// Cache-Control: private, no-cache, must-revalidate

// Результат:
// 1. TanStack Query делает request
// 2. Browser проверяет: Cache-Control = no-cache → ВСЕГДА revalidate
// 3. Browser делает HTTP request с If-None-Match/If-Modified-Since
// 4. Backend возвращает 304 Not Modified (если не изменилось)
// 5. Browser использует cached response body
// 6. TanStack Query обновляет UI

// → Optimal UX: быстрая загрузка + актуальные данные
```

### Service Worker Exclusion

```javascript
// frontend/src/service-worker.ts
const CACHE_EXCLUDE_PATTERNS = [
  /\/api\/v1\/books/,      // User-specific, управляется Cache-Control
  /\/api\/v1\/chapters/,   // User-specific
  /\/api\/v1\/users/,      // User-specific
];

// Service Worker НЕ кэширует user-specific данные
// → Cache-Control headers контролируют browser HTTP cache
```

## Production Considerations

### CDN Configuration

```nginx
# nginx.conf
location /api/v1/images/file/ {
    # Respect backend Cache-Control headers
    proxy_cache_valid 200 365d;  # Match max-age=31536000
    proxy_cache_key "$scheme$request_method$host$request_uri";

    # ВАЖНО: не перезаписывать Cache-Control от backend
    proxy_pass http://backend:8000;
}

location /api/v1/ {
    # User-specific endpoints - НЕ кэшировать в CDN
    proxy_no_cache 1;
    proxy_cache_bypass 1;

    proxy_pass http://backend:8000;
}
```

### Monitoring

```python
# Добавить в health check endpoint
@router.get("/health/cache-control")
async def cache_control_health():
    """Проверяет корректность Cache-Control configuration."""
    from app.middleware.cache_control import get_all_cache_policies

    policies = get_all_cache_policies()

    return {
        "status": "ok",
        "policies": policies,
        "total_rules": len(policies),
    }
```

## Troubleshooting

### Issue: User видит данные другого пользователя

**Причина:** Shared cache (CDN/proxy) кэширует user-specific данные

**Решение:**
1. Убедитесь что endpoint в `USER_SPECIFIC_PATHS`
2. Проверьте header: должен быть `private, no-cache`
3. Проверьте CDN config: должен respect Cache-Control

### Issue: Изображения не обновляются

**Причина:** Aggressive caching с immutable

**Решение:**
1. Используйте unique filenames (UUID) для новых изображений
2. НЕ перезаписывайте существующие файлы
3. Frontend должен invalidate query при генерации нового изображения

### Issue: Performance проблемы

**Причина:** Слишком частые revalidations

**Решение:**
1. Увеличьте `max-age` для public endpoints
2. Используйте ETags для efficient revalidation
3. Включите HTTP/2 Server Push для critical resources

## Best Practices

### DO ✅

- Используйте `private` для user-specific данных
- Используйте `immutable` для static files с unique names
- Координируйте с TanStack Query staleTime/cacheTime
- Тестируйте cache headers в integration tests
- Мониторьте cache hit rates в production

### DON'T ❌

- НЕ используйте `public` для user-specific данных
- НЕ устанавливайте conflicting directives (`no-store` + `max-age`)
- НЕ кэшируйте authentication responses
- НЕ перезаписывайте immutable files
- НЕ игнорируйте Cache-Control в CDN configuration

## Migration Guide

### Обновление существующих endpoints

Если вы добавляете новый user-specific endpoint:

```python
# 1. Endpoint автоматически получит правильный Cache-Control
#    если path содержит /api/v1/books, /api/v1/chapters, etc.

# 2. Если новый path pattern, добавьте в cache_control.py:
USER_SPECIFIC_PATHS = [
    "/api/v1/books",
    "/api/v1/my-new-endpoint",  # ← Добавьте здесь
]

# 3. Добавьте тест:
def test_new_endpoint_cache_control():
    result = get_cache_control_header("/api/v1/my-new-endpoint", "GET")
    assert "private" in result
    assert "no-cache" in result
```

### Rollback Plan

Если нужно временно отключить middleware:

```python
# app/main.py

# Закомментируйте эту строку:
# app.add_middleware(CacheControlMiddleware)

# Или отключите через config:
app.add_middleware(CacheControlMiddleware, enable_cache_control=False)
```

## Дополнительные ресурсы

- [MDN: HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [TanStack Query: Caching](https://tanstack.com/query/latest/docs/react/guides/caching)
- [OWASP: Testing for Browser Cache Weaknesses](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/06-Testing_for_Browser_Cache_Weaknesses)

## Changelog

### v1.0 (2025-12-24)
- Initial implementation of `CacheControlMiddleware`
- Automatic Cache-Control headers для всех endpoints
- Integration с TanStack Query на frontend
- Comprehensive test suite
- Documentation
