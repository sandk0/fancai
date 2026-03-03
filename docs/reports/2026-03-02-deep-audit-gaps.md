# Глубокий аудит: пропущенные проблемы

**Дата:** 2026-03-02
**Scope:** Находки, отсутствующие во ВСЕХ предыдущих отчётах (pre-deploy-deep-audit, server-setup-plan, cross-audit-verification)
**Метод:** 4 параллельных агента (backend security, Docker/runtime, frontend security, app logic) + ручная верификация каждой находки
**Файлов проверено:** 150+

---

## Executive Summary

Предыдущие 3 отчёта покрыли инфраструктуру (Docker Compose, PG tuning, Redis, Caddy) и верифицировали друг друга. Однако они **почти не затронули** прикладной код — backend security, frontend security, application logic. Данный аудит обнаружил **6 критических**, **8 высокоприоритетных** и **7 средних** проблем, полностью пропущенных всеми предыдущими отчётами.

Самые опасные находки:

1. **500-ошибки возвращают str(exc) клиенту** — утечка стектрейсов и внутренних деталей
2. **CSRF middleware реализован, но НЕ подключён** — защита от CSRF фактически отсутствует
3. **Service worker кеширует user-specific API данные** без очистки при logout — утечка между пользователями
4. **chmod 777 в Dockerfile.prod** — world-writable директории storage/uploads/logs
5. **Swagger/ReDoc доступны без аутентификации** в production
6. **Пароль metrics endpoint захардкожен** — `metrics_secure_password`

---

## CRITICAL — Блокируют деплой

### NEW-C1: Internal Server Error утекает str(exc) клиенту

**Файл:** `backend/app/main.py:471`
**Верификация:** ✅ Подтверждено чтением кода

```python
"message": f"An internal server error occurred: {str(exc)}"
```

**Проблема:** Любая необработанная ошибка 500 возвращает полный текст исключения клиенту. Это может включать:

- Пути к файлам на сервере
- SQL-запросы и структуру БД
- API-ключи из стектрейсов
- Внутренние имена сервисов

**Фикс:**

```python
content={
    "error": "Internal Server Error",
    "message": "An unexpected error occurred. Please try again later.",
    "timestamp": datetime.now(timezone.utc).isoformat(),
}
```

**Сложность:** 1 мин

---

### NEW-C2: CSRF middleware определён, но НЕ подключён

**Файл:** `backend/app/core/csrf.py` (228 строк реализации)
**Файл:** `backend/app/main.py` — grep по "csrf" = 0 результатов
**Верификация:** ✅ Подтверждено grep

**Проблема:** Полноценная CSRF-защита (Double Submit Cookie, `secrets.compare_digest()`) реализована в `csrf.py`, но **не добавлена в middleware stack** в `main.py`. Защита фактически отсутствует.

**Смягчающие факторы:**

- SameSite=Lax на cookies (частичная защита)
- Только API-эндпоинты (нет server-rendered форм)
- CORS ограничивает origins

**Фикс:** Добавить в `main.py` после CORS middleware:

```python
from app.core.csrf import CSRFProtectMiddleware
app.add_middleware(CSRFProtectMiddleware)
```

**Сложность:** 5 мин (но требует тестирования с фронтендом)

---

### NEW-C3: Service worker кеширует user-specific данные без очистки при logout

**Файл:** `frontend/src/sw.ts:103-125`
**Файл:** `frontend/src/stores/auth.ts` — нет postMessage к SW при logout
**Верификация:** ✅ Подтверждено grep (0 совпадений "LOGOUT"/"CACHE_CLEAR" в sw.ts, 0 совпадений "serviceWorker.\*postMessage" в auth.ts)

**Проблема:** Service worker кеширует **все** GET-запросы к `/api/v1/*` (кроме auth/admin/parsing-status/images) через StaleWhileRevalidate с TTL 1 час:

```typescript
// Кешируются:
// - /api/v1/books/{id} — данные книг пользователя
// - /api/v1/books/{id}/entities — глоссарий
// - /api/v1/reading-sessions/* — прогресс чтения
// - /api/v1/books/{id}/descriptions — описания
```

При logout кеш **не очищается**. Если другой пользователь войдёт на том же устройстве в течение часа, он увидит данные предыдущего пользователя из кеша.

**Фикс SW:**

```typescript
self.addEventListener("message", (event) => {
  if (event.data.type === "LOGOUT") {
    caches.delete("api-cache");
  }
});
```

**Фикс auth.ts (logout):**

```typescript
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.controller.postMessage({ type: "LOGOUT" });
}
```

**Сложность:** 15 мин

---

### NEW-C4: chmod 777 на storage/uploads/logs в Dockerfile.prod

**Файл:** `backend/Dockerfile.prod:66`
**Верификация:** ✅ Подтверждено чтением кода

```dockerfile
chmod -R 777 /app/storage /app/uploads /app/logs
```

**Проблема:** World-writable директории. Хотя контейнер запускается от appuser (line 69), любой процесс (включая скомпрометированный) может:

- Перезаписать загруженные книги
- Инжектировать вредоносные файлы в uploads
- Модифицировать логи для уничтожения audit trail

**Фикс:**

```dockerfile
chmod -R 775 /app/storage /app/uploads /app/logs
```

**Сложность:** 1 мин

---

### NEW-C5: Swagger UI и ReDoc доступны без аутентификации в production

**Файл:** `backend/app/main.py:171-172`
**Верификация:** ✅ Подтверждено чтением кода

```python
app = FastAPI(
    docs_url="/docs",      # Всегда включён
    redoc_url="/redoc",    # Всегда включён
)
```

**Проблема:** API-документация доступна всем в production. Раскрывает:

- Полную структуру API (все эндпоинты, параметры, типы)
- Модели данных (Pydantic schemas)
- Возможность отправки запросов прямо из UI

**Фикс:**

```python
app = FastAPI(
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)
```

**Сложность:** 1 мин

---

### NEW-C6: Пароль metrics endpoint захардкожен

**Файл:** `backend/app/core/config.py:119-121`
**Верификация:** ✅ Подтверждено чтением кода

```python
METRICS_USER: str = "admin"
METRICS_PASSWORD: str = "metrics_secure_password"  # Override via env in production
```

**Проблема:** Дефолтный пароль `metrics_secure_password` — если не переопределён через env, Prometheus-метрики (включая counters запросов, ошибок, LLM-косты) доступны с предсказуемыми credentials.

**Фикс:** Добавить проверку в `validate_production_settings()`:

```python
if self.METRICS_PASSWORD == "metrics_secure_password":
    raise ValueError("METRICS_PASSWORD must be overridden in production")
```

**Сложность:** 5 мин

---

## HIGH — Исправить до деплоя

### NEW-H1: ErrorBoundary показывает стектрейсы в production

**Файл:** `frontend/src/components/ErrorBoundary.tsx:189-218`
**Верификация:** ✅ Подтверждено чтением кода

Безусловно показывает `error.toString()`, `error.message` и `errorInfo.componentStack` через `<details>` блок. Нет проверки `isProduction`.

**Фикс:** Обернуть details-блок в условие:

```typescript
{import.meta.env.DEV && error && (
  <details>...</details>
)}
```

**Сложность:** 2 мин

---

### NEW-H2: Entity deduplication без distributed lock (race condition)

**Файл:** `backend/app/services/entity_deduplication_service.py:90-99`

**Проблема:** `suggest_merges()` не использует Redis lock. Два параллельных вызова для одной книги могут:

1. Загрузить одни и те же entities
2. Оба предложить merge
3. Один из merge'ей отработает на уже удалённых entities → ошибка или потеря данных

**Фикс:** По аналогии с `book_tasks.py:162-204`, добавить:

```python
lock_key = f"entity:dedup:{book_id}"
redis_lock = redis_client.lock(lock_key, timeout=300, blocking=False)
```

**Сложность:** 15 мин

---

### NEW-H3: Admin может включить debug mode через API

**Файл:** `backend/app/routers/admin/system.py:69`
**Верификация:** ✅ Подтверждено чтением кода

```python
await settings_manager.set_setting("system", "enable_debug_mode", settings.enable_debug_mode)
```

**Проблема:** Скомпрометированный admin-аккаунт может включить debug mode, что потенциально раскрывает больше информации в ошибках.

**Фикс:** Сделать debug mode read-only в production или требовать env var:

```python
if settings.enable_debug_mode and not current_settings.DEBUG:
    raise HTTPException(400, "Debug mode can only be enabled via environment variable")
```

**Сложность:** 10 мин

---

### NEW-H4: Celery Beat запускается как root в dev compose

**Файл:** `docker-compose.dev.yml:169`
**Верификация:** ✅ Подтверждено чтением кода

```yaml
user: root
```

С volume mount `./backend:/app` (line 175) — любой scheduled task может модифицировать host-файлы от root.

**Фикс:** Удалить `user: root` (унаследует non-root из Dockerfile.dev).
**Сложность:** 1 мин

---

### NEW-H5: max_connections=100 < пиковых 120 от 2 workers

**Файл:** `docker-compose.prod.yml:242` — `max_connections=100`
**Файл:** `backend/gunicorn.conf.py:14` — `workers = 2`
**Файл:** `backend/app/core/database.py:60-61` — `pool_size=20`, `max_overflow=40`

**Расчёт:** 2 workers × (20 pool + 40 overflow) = **120 пиковых коннектов** > 100 max_connections

**Проблема:** Под нагрузкой PostgreSQL начнёт отклонять коннекты с `FATAL: too many connections`. Celery worker тоже имеет свой pool.

**Фикс:** `max_connections=200` или уменьшить `max_overflow=30` (2×50=100).
**Сложность:** 1 мин

---

### NEW-H6: Нет SSL mode для database connection

**Файл:** `backend/app/core/database.py:57-75`
**Верификация:** ✅ Подтверждено grep (0 совпадений "sslmode"/"ssl=")

**Проблема:** Нет explicit `sslmode=require` в connection string. В Docker-сети трафик не шифруется.

**Смягчающий фактор:** PostgreSQL и backend находятся в одной Docker bridge network, трафик не покидает хост.

**Фикс (для production):** Добавить в connect_args:

```python
"ssl": True  # Для asyncpg
```

**Сложность:** 5 мин + настройка PG SSL certs

---

### NEW-H7: Pagination limits не enforced на нескольких endpoints

**Файлы:**

- `backend/app/routers/books/crud.py:219` — `limit: int = 50` (нет max)
- `backend/app/routers/admin/users.py:20` — `limit: int = 50` (нет max)
- `backend/app/routers/images.py:596` — `limit` без max

**Проблема:** Можно передать `limit=1000000` и получить все записи → memory exhaustion, slow query.

**Фикс:** На каждом endpoint:

```python
limit: int = Query(default=50, ge=1, le=100)
skip: int = Query(default=0, ge=0)
```

**Сложность:** 10 мин (3 файла)

---

### NEW-H8: localStorage хранит user data без TTL

**Файл:** `frontend/src/stores/auth.ts:35`
**Верификация:** ✅ Подтверждено чтением кода

```typescript
localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
```

**Проблема:** Данные пользователя (email, имя, ID) хранятся в localStorage бессрочно. На shared устройствах данные предыдущего пользователя видны через DevTools даже после logout (если JS crash предотвратил очистку).

**Фикс:** Использовать sessionStorage для user data или добавить TTL через wrapper.
**Сложность:** 15 мин

---

## MEDIUM — Исправить в первый месяц

### NEW-M1: Reading session batch updates без optimistic locking

**Файл:** `backend/app/routers/reading_sessions.py:381-549`

Batch update до 50 сессий без проверки `updated_at`. Два устройства могут потерять прогресс друг друга при одновременном обновлении.

**Сложность:** 30 мин

---

### NEW-M2: DOMPurify разрешает data-\* атрибуты через whitelist

**Файл:** `frontend/src/components/Reader/ReaderContent.tsx:25,30`

`ALLOW_DATA_ATTR: false` (line 30) конфликтует с explicit `data-description-id`, `data-entity-id` в ALLOWED_ATTR (line 25). Whitelisted data-attrs пройдут, а ALLOW_DATA_ATTR: false — нет. Работает корректно, но код вводит в заблуждение. Реальный риск: `href` и `src` в ALLOWED_ATTR позволяют relative URLs, которые могут навигировать на вредоносные страницы.

**Сложность:** 10 мин

---

### NEW-M3: Hawk token встроен во frontend build

**Файл:** `frontend/src/config/hawk.ts:17`

```typescript
const token = import.meta.env.VITE_HAWK_TOKEN;
```

VITE\_-переменные запекаются в production build. Hawk token видим в JS-бандле.

**Сложность:** 30 мин (перенос на backend proxy)

---

### NEW-M4: EPUB.js 0.3.93 устарел (2021)

**Файл:** `frontend/package.json:47`

Библиотека парсит user-uploaded EPUB-файлы в iframe. 3+ лет без security-обновлений.

**Сложность:** Высокая (нет drop-in замены)

---

### NEW-M5: Password field в registration model без min/max length

**Файл:** `backend/app/routers/auth.py:54-82`

```python
password: str  # Нет Field(min_length=12, max_length=128)
```

Валидация происходит в handler, но model позволяет 1MB строку.

**Сложность:** 2 мин

---

### NEW-M6: Нет client-side rate limiting на frontend

**Файл:** `frontend/src/api/client.ts`

Backend имеет rate limiting, но frontend может спамить 1000 запросов/сек до получения 429.

**Сложность:** 15 мин

---

### NEW-M7: Service worker не валидирует VAPID key формат

**Файл:** `frontend/src/services/pushNotifications.ts:250-264`

`window.atob()` без try/catch. Malformed VAPID key из API = crash приложения.

**Сложность:** 5 мин

---

## Сводная таблица

| #      | Severity | Проблема                                      | Файл(ы)                            | Сложность |
| ------ | -------- | --------------------------------------------- | ---------------------------------- | --------- |
| NEW-C1 | CRITICAL | 500 error утекает str(exc)                    | main.py:471                        | 1 мин     |
| NEW-C2 | CRITICAL | CSRF middleware НЕ подключён                  | main.py (отсутствует)              | 5 мин     |
| NEW-C3 | CRITICAL | SW кеширует user data, нет очистки при logout | sw.ts:103-125, auth.ts             | 15 мин    |
| NEW-C4 | CRITICAL | chmod 777 на storage/uploads/logs             | Dockerfile.prod:66                 | 1 мин     |
| NEW-C5 | CRITICAL | Swagger/ReDoc без auth в production           | main.py:171-172                    | 1 мин     |
| NEW-C6 | CRITICAL | Metrics пароль захардкожен                    | config.py:121                      | 5 мин     |
| NEW-H1 | HIGH     | ErrorBoundary стектрейсы в production         | ErrorBoundary.tsx:189-218          | 2 мин     |
| NEW-H2 | HIGH     | Entity dedup race condition (нет lock)        | entity_deduplication_service.py:90 | 15 мин    |
| NEW-H3 | HIGH     | Admin toggle debug mode via API               | admin/system.py:69                 | 10 мин    |
| NEW-H4 | HIGH     | Celery Beat as root в dev compose             | docker-compose.dev.yml:169         | 1 мин     |
| NEW-H5 | HIGH     | max_connections=100 < пиковых 120             | prod.yml:242, gunicorn.conf.py:14  | 1 мин     |
| NEW-H6 | HIGH     | Нет SSL mode для PG connection                | database.py:57-75                  | 5 мин     |
| NEW-H7 | HIGH     | Pagination limits не enforced                 | crud.py, users.py, images.py       | 10 мин    |
| NEW-H8 | HIGH     | localStorage user data без TTL                | auth.ts:35                         | 15 мин    |
| NEW-M1 | MEDIUM   | Batch session updates без optimistic locking  | reading_sessions.py:381            | 30 мин    |
| NEW-M2 | MEDIUM   | DOMPurify href/src в ALLOWED_ATTR             | ReaderContent.tsx:24               | 10 мин    |
| NEW-M3 | MEDIUM   | Hawk token в frontend build                   | hawk.ts:17                         | 30 мин    |
| NEW-M4 | MEDIUM   | EPUB.js 0.3.93 устарел (2021)                 | package.json:47                    | Высокая   |
| NEW-M5 | MEDIUM   | Password без Field constraints в model        | auth.py:54                         | 2 мин     |
| NEW-M6 | MEDIUM   | Нет client-side rate limiting                 | client.ts                          | 15 мин    |
| NEW-M7 | MEDIUM   | VAPID key без валидации/try-catch             | pushNotifications.ts:250           | 5 мин     |

---

## Рекомендуемый порядок исправлений

### Этап 1: Критические фиксы (30 мин)

1. **NEW-C1** — заменить `str(exc)` на generic message в main.py:471
2. **NEW-C4** — `chmod 777` → `chmod 775` в Dockerfile.prod:66
3. **NEW-C5** — `docs_url=None` в production в main.py:171
4. **NEW-C6** — добавить проверку METRICS_PASSWORD в validate_production_settings()
5. **NEW-C3** — добавить logout handler в sw.ts + postMessage в auth.ts
6. **NEW-C2** — подключить CSRFProtectMiddleware в main.py (с тестированием)

### Этап 2: High-priority (1 час)

7. **NEW-H1** — скрыть error details в production ErrorBoundary
8. **NEW-H4** — удалить `user: root` из celery-beat в dev compose
9. **NEW-H5** — `max_connections=200` или уменьшить `max_overflow`
10. **NEW-H7** — добавить `Query(le=100)` на все list endpoints
11. **NEW-H2** — добавить Redis lock в entity dedup
12. **NEW-H3** — ограничить toggle debug mode в production
13. **NEW-H8** — sessionStorage или TTL для user data

### Этап 3: Medium (первая неделя)

14. **NEW-M5** — Field constraints на password
15. **NEW-M7** — try-catch для VAPID key
16. **NEW-M1** — optimistic locking для batch session updates
17. **NEW-M2** — пересмотреть href/src в DOMPurify
18. **NEW-M3** — перенести Hawk token на backend
19. **NEW-M6** — client-side rate limiting

---

## Что покрыто хорошо (подтверждено аудитом)

| Область                    | Статус       | Детали                                                    |
| -------------------------- | ------------ | --------------------------------------------------------- |
| SQL injection              | ✅ Безопасно | Только SQLAlchemy ORM, нет raw SQL                        |
| IDOR                       | ✅ Безопасно | Все endpoints проверяют user ownership через dependencies |
| Password hashing           | ✅ Безопасно | bcrypt с salt                                             |
| JWT implementation         | ✅ Безопасно | Token blacklist, revocation, validation                   |
| File upload                | ✅ Безопасно | Whitelist extensions, UUID-имена, size limit              |
| Path traversal             | ✅ Безопасно | validation.py + UUID-based paths                          |
| Rate limiting (backend)    | ✅ Безопасно | Redis sliding window, per-user/IP                         |
| Cookie security            | ✅ Безопасно | HttpOnly, Secure, SameSite=Lax                            |
| CORS                       | ✅ Безопасно | Restricted origins, methods, headers                      |
| Celery idempotency         | ✅ Безопасно | Redis distributed lock на book processing                 |
| Secrets at startup         | ✅ Безопасно | validate_production_settings() blocks default creds       |
| Security headers (backend) | ✅ Безопасно | HSTS, CSP, X-Frame-Options, Permissions-Policy            |
| .dockerignore              | ✅ Безопасно | .env, .git, node_modules excluded                         |

---

## Сравнение с предыдущими отчётами

| Область                           | pre-deploy-audit | server-setup-plan | cross-audit | Этот аудит |
| --------------------------------- | ---------------- | ----------------- | ----------- | ---------- |
| Docker Compose config             | ✅               | ✅                | ✅          | —          |
| PostgreSQL tuning                 | ✅               | ✅                | ✅          | —          |
| Redis config                      | ✅               | ✅                | ✅          | —          |
| Caddy/HSTS/headers                | ✅               | ✅                | ✅          | —          |
| Deploy scripts                    | ✅               | —                 | ✅          | —          |
| **Backend app security**          | ❌               | ❌                | ❌          | ✅         |
| **Frontend security**             | ❌               | ❌                | ❌          | ✅         |
| **Application logic**             | ❌               | ❌                | ❌          | ✅         |
| **Dockerfile security**           | ❌               | ❌                | ❌          | ✅         |
| **Service worker**                | ❌               | ❌                | ❌          | ✅         |
| **Auth/JWT deep dive**            | ❌               | ❌                | ❌          | ✅         |
| **API design (IDOR, pagination)** | ❌               | ❌                | ❌          | ✅         |

**Вывод:** Предыдущие отчёты покрыли ~40% attack surface (инфраструктура). Этот аудит закрывает оставшиеся ~60% (прикладной код).
