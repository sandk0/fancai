# Фаза 1: Безопасность продакшена — Исследование

**Исследовано:** 2026-03-01
**Область:** Усиление безопасности, мониторинг ошибок (Hawk Tracker), продакшен-деплой (Gunicorn), исправление инфраструктурных багов
**Уверенность:** ВЫСОКАЯ

<user_constraints>
## Ограничения пользователя (из CONTEXT.md)

### Зафиксированные решения
- Hawk Tracker SaaS (hawk-tracker.ru) для мониторинга ошибок — НЕ Sentry, НЕ self-hosted
- Два отдельных проекта Hawk: Python-бэкенд и React-фронтенд
- Интеграция с Celery обязательна — отслеживание сбоев AI-пайплайна (Gemini/Imagen; Phase 3: мигрируют на OpenRouter)
- Только внутренний health check эндпоинт (без внешнего мониторинга аптайма)
- Логи в stdout через Docker (без структурированного JSON-логирования в файлы)
- Без пуш-уведомлений (Telegram/email) — пока только UI Hawk
- nginx в качестве реверс-прокси уже настроен с Let's Encrypt SSL
- Gunicorn: 2 воркера с UvicornWorker (консервативно для RAM)
- Celery: 2 воркера (параллельная обработка AI-задач), memory limit 512MB
- Сервер: 12 vCPU, 32 ГБ RAM, NVMe SSD
- Лимиты памяти Docker на контейнер (предотвращение OOM)
- Политика restart: unless-stopped для всех контейнеров
- Кратковременный даунтайм при деплоях допустим (zero-downtime не требуется)
- Единый docker-compose.lite.yml для продакшена (без отдельного prod-файла)
- Без rate limiting в этой фазе
- Файл .env на сервере (не в git), Docker Compose читает env_file
- SECRET_KEY уже читается из окружения (есть дефолтный fallback — нужно удалить)
- Ручная генерация SECRET_KEY (надёжный ключ, без ротации)
- Создать шаблон .env.example в репозитории с placeholder-значениями
- Проверить, что .env в .gitignore
- Fail-fast при запуске: приложение отказывается запускаться, если отсутствуют обязательные переменные окружения (SECRET_KEY, DATABASE_URL)

### На усмотрение Claude
- Улучшения процесса деплоя в docker-compose.lite.yml
- Полный список обязательных переменных окружения для валидации при запуске (Claude проверяет код)
- Значения лимитов памяти на контейнер (распределение 32 ГБ между сервисами)
- Формат ответа health check и значения таймаутов
- Конфигурация таймаута и keep-alive для Gunicorn

### Отложенные идеи (ВНЕ СКОУПА)
Нет — обсуждение не выходило за рамки фазы
</user_constraints>

<phase_requirements>
## Требования фазы

| ID | Описание | Текущее состояние кода | Что нужно сделать |
|----|----------|----------------------|-------------------|
| SEC-01 | Исправить значение DEBUG по умолчанию на False в config.py | `config.py:19` содержит `DEBUG: bool = True` — НУЖНО ИЗМЕНИТЬ | Строка 19-21: `DEBUG: bool = False` |
| SEC-02 | Fail-fast при дефолтном SECRET_KEY вне debug-режима | `validate_production_settings` в config.py уже проверяет SECRET_KEY при DEBUG=False — ИНФРАСТРУКТУРА ЕСТЬ | Удалить дефолт или добавить fail-fast для DATABASE_URL; удалить `validate_nlp_weights` (ломает запуск) |
| SEC-03 | Заменить python-jose на PyJWT | PyJWT[crypto]==2.10.1 установлен, python-jose удалён из requirements — ВЫПОЛНЕНО | Проверить что auth_service.py не импортирует jose |
| DEPLOY-01 | Gunicorn в продакшене (убрать --reload) | `docker-compose.lite.yml:155`: `uvicorn ... --reload` — НУЖНО ИЗМЕНИТЬ | Создать gunicorn.conf.py, заменить command в docker-compose.lite.yml |
| DEPLOY-02 | Hawk Tracker на бэкенде (hawk-python-sdk[fastapi]) | `sentry-sdk[fastapi]==2.51.0` в requirements — НЕ ВЫПОЛНЕНО | Установить hawk-python-sdk[fastapi], удалить sentry-sdk, создать core/hawk.py |
| DEPLOY-03 | Hawk Tracker на фронтенде (@hawk.so/javascript) | Пакет не установлен — НЕ ВЫПОЛНЕНО | `npm install @hawk.so/javascript`, создать config/hawk.ts |
| DEPLOY-05 | Celery visibility_timeout (3600→14400) | `celery_app.py:42` содержит `visibility_timeout: 3600` — НУЖНО ИЗМЕНИТЬ | `broker_transport_options={"visibility_timeout": 14400}` |
| DEPLOY-06 | Синхронизировать LANGEXTRACT_MODEL | docker-compose.lite.yml:110,174: `gemini-2.0-flash` — НУЖНО ИЗМЕНИТЬ | Заменить на `gemini-3-flash-preview` во всех docker-compose файлах |
| DEPLOY-07 | Обновить PostgreSQL до 17.9-alpine (CVE-2025-8715, CVE-2025-1094) | docker-compose.lite.yml:29: `postgres:15-alpine` (dev окружение — не трогать); docker-compose.lite.prod.yml — проверить | Обновить в prod-конфигурации |
| DEPLOY-08 | Унифицировать memory limits Celery workers на 512MB | celery_app.py:29-31: `CELERY_MAX_MEMORY_PER_CHILD` default=150000 (150MB) — НУЖНО ИЗМЕНИТЬ | `worker_max_memory_per_child=512000` в celery_app.py и docker-compose файлах |
| UX-01 | Реальный health check (не захардкоженный "checking...") | `main.py:331`: `"database": "checking..."` — НУЖНО ИСПРАВИТЬ | Реальная проверка через `SELECT 1` к PostgreSQL, проверка Celery ping |
</phase_requirements>

## Резюме

Фаза 1 исправляет фундаментальные проблемы безопасности и инфраструктуры продакшена. Кодовая база уже содержит значительную часть нужной инфраструктуры: `validate_production_settings` проверяет SECRET_KEY, `secrets.py` имеет полный SecretsValidator, роутер `/api/v1/health/deep` уже выполняет реальные проверки PostgreSQL/Redis/Celery. Gunicorn уже в requirements.txt. PyJWT уже установлен вместо python-jose.

Критические пробелы, которые НУЖНО исправить: (1) `DEBUG: bool = True` по умолчанию в config.py:19 — открывает debug-интерфейс в продакшене; (2) заглушка `"database": "checking..."` в `/health` main.py:331 — Docker healthcheck видит всегда "healthy", даже при падении БД; (3) `uvicorn --reload` в docker-compose.lite.yml:155 — production запускается как dev-сервер; (4) `visibility_timeout=3600` при `time_limit=10800` — Celery дублирует задачи; (5) `sentry-sdk` в requirements — нужно заменить на `hawk-python-sdk[fastapi]`; (6) LANGEXTRACT_MODEL не синхронизирован между файлами; (7) PostgreSQL с критическими CVE в prod-конфигурации.

**SEC-03 ВЫПОЛНЕНО:** PyJWT[crypto]==2.10.1 уже в requirements, python-jose удалён. Нужно проверить auth_service.py на отсутствие jose импортов.

**Основная рекомендация:** Все изменения этой фазы — хирургические правки в существующих файлах. Новые файлы: `backend/app/core/hawk.py`, `backend/gunicorn.conf.py`, `backend/tests/test_config_security.py`, `backend/tests/test_hawk_init.py`, `frontend/src/config/hawk.ts`, `.env.example`.

## Стандартный стек

### Основные библиотеки

| Библиотека | Версия | Назначение | Почему стандартная |
|------------|--------|------------|-------------------|
| PyJWT[crypto] | 2.10.1 | JWT токены (HS256) | Уже установлен; активно поддерживается; без CVE |
| gunicorn | 25.0.1 | Менеджер процессов WSGI/ASGI | Уже в requirements.txt; продакшен-стандарт для FastAPI |
| uvicorn.workers.UvicornWorker | (часть uvicorn[standard]) | ASGI-воркер для Gunicorn | Официальный способ запуска FastAPI под Gunicorn |
| hawk-python-sdk[fastapi] | latest (>=1.0.0) | Мониторинг ошибок бэкенда | Выбор пользователя; официальный Python SDK для Hawk Tracker SaaS |
| @hawk.so/javascript | latest | Мониторинг ошибок фронтенда | Официальный JS SDK; source maps нативно |

### Вспомогательные библиотеки

| Библиотека | Версия | Назначение | Когда использовать |
|------------|--------|------------|-------------------|
| asyncpg | 0.31.0 | Async PostgreSQL драйвер | Уже используется; нужен для SELECT 1 в health check |
| redis | 7.1.0 | Redis клиент | Уже используется; ping() для health check Redis |
| celery | 5.6.2 | Очередь задач | Уже используется; control.inspect().ping() для health check |

### Рассмотренные альтернативы

| Вместо | Можно использовать | Компромисс |
|--------|-------------------|------------|
| hawk-python-sdk | Sentry SaaS | Sentry мощнее, но требует много RAM self-hosted или платного тарифа; Hawk бесплатный для РФ |
| gunicorn + UvicornWorker | uvicorn с несколькими процессами (--workers) | `uvicorn --workers N` работает, но gunicorn даёт лучшее управление процессами и graceful restart |
| gunicorn.conf.py | inline параметры в command | Файл конфигурации легче поддерживать и версионировать |

**Установка:**
```bash
# Бэкенд — заменить sentry-sdk на hawk-python-sdk
pip install hawk-python-sdk[fastapi]

# Фронтенд
cd frontend && npm install @hawk.so/javascript --save
```

**Примечание:** gunicorn==25.0.1 уже в requirements.txt. PyJWT[crypto]==2.10.1 уже установлен.

## Архитектурные паттерны

### Файлы, которые нужно создать/изменить

```
backend/
├── app/
│   ├── core/
│   │   ├── config.py           # SEC-01: DEBUG=False; SEC-02: удалить validate_nlp_weights
│   │   ├── secrets.py          # SEC-02: SENTRY_DSN → HAWK_TOKEN
│   │   └── hawk.py             # НОВЫЙ — DEPLOY-02: init_hawk, init_hawk_celery
│   ├── core/celery_app.py      # DEPLOY-05: visibility_timeout=14400; DEPLOY-08: memory=512000
│   └── main.py                 # UX-01: реальный /health; DEPLOY-02: вызов init_hawk(app)
├── gunicorn.conf.py            # НОВЫЙ — DEPLOY-01: конфигурация Gunicorn
├── requirements.txt            # DEPLOY-02: hawk-python-sdk, удалить sentry-sdk
├── requirements.lite.txt       # DEPLOY-02: hawk-python-sdk, удалить sentry-sdk
└── tests/
    ├── test_config_security.py # НОВЫЙ — тесты SEC-01, SEC-02, UX-01
    └── test_hawk_init.py       # НОВЫЙ — тесты DEPLOY-02
docker-compose.lite.yml         # DEPLOY-01: gunicorn; DEPLOY-06: LANGEXTRACT_MODEL; DEPLOY-08
docker-compose.lite.prod.yml    # DEPLOY-06: LANGEXTRACT_MODEL; DEPLOY-07: postgres:17.9-alpine; DEPLOY-08
docker-compose.staging.yml      # DEPLOY-06: LANGEXTRACT_MODEL; DEPLOY-08
.env.example                    # НОВЫЙ — шаблон с placeholder-значениями
frontend/
├── src/
│   ├── config/hawk.ts          # НОВЫЙ — DEPLOY-03: initHawk()
│   ├── main.tsx                # DEPLOY-03: вызов initHawk()
│   └── components/ErrorBoundary.tsx  # DEPLOY-03: hawk.send(error) в componentDidCatch
└── package.json                # @hawk.so/javascript
```

### Паттерн 1: Исправление config.py (SEC-01, SEC-02)

**Что:** Изменить DEBUG=False по умолчанию, убрать validate_nlp_weights (блокирует запуск при отсутствии NLP env vars)

**ВАЖНО:** validate_nlp_weights (строки 193-214 в config.py) выбрасывает ValueError при DEBUG=False, если NLP переменные не установлены. Это побочный эффект удаления NLP (Phase 2), но блокирует продакшен-запуск прямо сейчас. В рамках Phase 1 удаляем этот валидатор (минимальное вторжение в Phase 2).

```python
# backend/app/core/config.py — только правка строки 19
# ДО:
DEBUG: bool = (
    True  # Development mode по умолчанию
)

# ПОСЛЕ:
DEBUG: bool = False
```

### Паттерн 2: Конфигурация Gunicorn (DEPLOY-01)

**Что:** Файл `gunicorn.conf.py` вместо inline-параметров в docker command

```python
# backend/gunicorn.conf.py
import os

bind = "0.0.0.0:8000"
workers = int(os.getenv("WORKERS_COUNT", "2"))
worker_class = "uvicorn.workers.UvicornWorker"
timeout = int(os.getenv("WORKER_TIMEOUT", "300"))  # 5 мин — для длительных AI запросов
keepalive = 5
max_requests = int(os.getenv("WORKER_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("WORKER_MAX_REQUESTS_JITTER", "100"))
accesslog = "-"   # stdout
errorlog = "-"    # stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
```

```yaml
# docker-compose.lite.yml — строка 155
# ДО:
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# ПОСЛЕ:
command: gunicorn app.main:app --config gunicorn.conf.py
```

### Паттерн 3: Реальный Health Check (UX-01)

**Что:** Заменить заглушку `"database": "checking..."` реальными async-проверками

**КЛЮЧЕВОЕ:** Эндпоинт `/health` декорирован `@rate_limit(max_requests=20, window_seconds=60)`. Docker healthcheck вызывает его каждые 30 сек — при 2 инстансах может превысить лимит. Нужно убрать rate_limit с /health или увеличить до 60/мин.

```python
# backend/app/main.py — заменить health_check
from sqlalchemy import text
from app.core.database import async_session_maker  # или get_database_session

@app.get("/health")
async def health_check(request: Request) -> Dict[str, Any]:
    checks = {"api": "ok"}

    # PostgreSQL check
    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {str(e)[:50]}"

    # Redis check — cache_manager.is_available уже есть
    checks["redis"] = "ok" if cache_manager.is_available else "unavailable"

    # Celery check
    try:
        from app.core.celery_app import celery_app
        inspector = celery_app.control.inspect(timeout=2.0)
        ping_result = inspector.ping()
        checks["celery"] = "ok" if ping_result else "unavailable"
    except Exception:
        checks["celery"] = "unavailable"

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if checks["api"] == "ok" else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if all_ok else "degraded",
            "version": VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": checks,
        }
    )
```

### Паттерн 4: Инициализация Hawk Tracker (DEPLOY-02)

**Что:** Создать `core/hawk.py`, вызывать в lifespan

```python
# backend/app/core/hawk.py
"""Hawk Tracker — мониторинг ошибок для FastAPI и Celery."""
from hawk_python_sdk.modules.fastapi import HawkFastapi
from hawk_python_sdk import Hawk
from .config import settings
from .logging import logger

_hawk_fastapi: HawkFastapi | None = None
_hawk_celery: Hawk | None = None

def init_hawk(app) -> HawkFastapi | None:
    """Инициализация Hawk Tracker для FastAPI. Вызывать в lifespan после settings."""
    global _hawk_fastapi
    token = getattr(settings, "HAWK_TOKEN", None)
    if not token:
        logger.info("Hawk Tracker отключен (HAWK_TOKEN не установлен)")
        return None
    _hawk_fastapi = HawkFastapi({
        'app_instance': app,
        'token': token,
        'release': f"fancai@{settings.APP_VERSION}",
    })
    logger.info("Hawk Tracker инициализирован для FastAPI")
    return _hawk_fastapi

def init_hawk_celery() -> Hawk | None:
    """Инициализация Hawk Tracker для Celery workers."""
    global _hawk_celery
    token = getattr(settings, "HAWK_TOKEN", None)
    if not token:
        return None
    _hawk_celery = Hawk({'token': token})
    logger.info("Hawk Tracker инициализирован для Celery")
    return _hawk_celery
```

```python
# backend/app/main.py — в lifespan, после startup_secrets_check
from .core.hawk import init_hawk
# ...
async with lifespan(app):
    startup_secrets_check(is_production=not settings.DEBUG)
    init_hawk(app)  # ДОБАВИТЬ ЗДЕСЬ
    await rate_limiter.connect()
    # ...
```

### Паттерн 5: Hawk на фронтенде (DEPLOY-03)

```typescript
// frontend/src/config/hawk.ts
import HawkCatcher from "@hawk.so/javascript";

let hawk: HawkCatcher | null = null;

export function initHawk(): void {
  const token = import.meta.env.VITE_HAWK_TOKEN;
  if (!token) {
    console.info("Hawk Tracker отключен (VITE_HAWK_TOKEN не установлен)");
    return;
  }
  hawk = new HawkCatcher({
    token,
    release: import.meta.env.VITE_APP_VERSION || "dev",
  });
}

export function getHawk(): HawkCatcher | null {
  return hawk;
}
```

```typescript
// frontend/src/main.tsx — перед ReactDOM.createRoot
import { initHawk } from "./config/hawk";
initHawk();
```

```typescript
// frontend/src/components/ErrorBoundary.tsx — в componentDidCatch
import { getHawk } from "@/config/hawk";
// ...
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  const hawk = getHawk();
  if (hawk) {
    hawk.send(error, { componentStack: errorInfo.componentStack });
  }
  // ... существующая логика
}
```

### Паттерн 6: Исправление Celery (DEPLOY-05, DEPLOY-08)

```python
# backend/app/core/celery_app.py — обновить conf.update
celery_app.conf.update(
    # ...existing config...
    worker_max_memory_per_child=int(
        os.getenv("CELERY_MAX_MEMORY_PER_CHILD", "512000")  # DEPLOY-08: было 150000
    ),
    # ...
    broker_transport_options={"visibility_timeout": 14400},  # DEPLOY-05: было 3600; > time_limit(10800)
    # ...
)
```

### Антипаттерны, которых следует избегать

- **Запуск uvicorn --reload в продакшене:** reload следит за файловой системой, тратит CPU, может упасть. Всегда Gunicorn + UvicornWorker.
- **Захардкоженные ответы health check:** Docker HEALTHCHECK видит всегда "healthy", скрывая реальные сбои. Health check должен делать реальные проверки подключения.
- **Инициализация Hawk в области модуля:** init вызывается при импорте до загрузки env. Вызывать только внутри lifespan.
- **Celery visibility_timeout < time_limit:** задачи повторно подбираются до завершения, вызывая дублирование. visibility_timeout ДОЛЖЕН превышать time_limit.
- **sentry-sdk рядом с hawk-python-sdk:** только один SDK мониторинга, иначе дублирование событий.

## Не изобретайте велосипед

| Проблема | Не делайте сами | Используйте вместо этого | Почему |
|----------|----------------|-------------------------|--------|
| JWT подпись | HMAC вручную | PyJWT (уже установлен) | Handles exp/iat claims, timing-safe сравнение, alg=none защита |
| Мониторинг ошибок | Кастомный error logger | hawk-python-sdk / @hawk.so/javascript | Stack trace, source maps, дедупликация — всё встроено |
| Управление процессами | Собственный process manager | Gunicorn (уже в requirements) | Graceful restart, pre-fork, управление памятью воркеров |
| Health check PostgreSQL | Кастомная проверка файла сокета | `SELECT 1` через asyncpg | Реальная проверка round-trip, включая подключение к пулу |
| Celery health | Проверка PID | `celery_app.control.inspect().ping()` | Официальный механизм проверки живости воркеров |

**Ключевой вывод:** Для каждой задачи этой фазы есть проверенное стандартное решение. Риск — в неправильной конфигурации, а не в отсутствии инструментов.

## Типичные подводные камни

### Подводный камень 1: validate_nlp_weights блокирует запуск при DEBUG=False

**Что идёт не так:** После установки `DEBUG=False`, `validate_nlp_weights` в config.py выбрасывает `ValueError` из-за отсутствия NLP env vars (SPACY_MODEL и т.д.).

**Почему это происходит:** Pydantic model_validator выполняется при создании Settings. Валидатор NLP был нужен для legacy NLP pipeline (удалён в Dec 2025), но код валидатора остался.

**Как избежать:** Удалить `validate_nlp_weights` валидатор И NLP поля конфигурации (SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE, CONSENSUS_THRESHOLD и т.д.) в рамках задачи SEC-01/SEC-02. Полная зачистка NLP — Phase 2 (CLEAN-02), но валидатор нужно убрать сейчас.

**Признаки проблемы:** `ValueError: NLP weights must sum to 1.0` при запуске с DEBUG=False.

### Подводный камень 2: Дублирование эндпоинтов /health

**Что идёт не так:** Существуют два health эндпоинта:
- `/health` в `main.py:313` — заглушка с `"database": "checking..."` — Docker HEALTHCHECK использует именно его
- `/api/v1/health/deep` в `routers/health.py` — реальные проверки PostgreSQL/Redis/Celery

**Почему это происходит:** Заглушка создана первой, детальный роутер добавлен позже, старый не обновлён.

**Как избежать:** Заменить заглушку в `main.py` реальными проверками. НЕ менять URL Docker HEALTHCHECK — Dockerfile.lite использует `/health`, менять его сложнее.

**Признаки проблемы:** Docker показывает container "healthy", хотя PostgreSQL недоступен.

### Подводный камень 3: Rate limit на health check vs Docker HEALTHCHECK

**Что идёт не так:** `/health` имеет `@rate_limit(max_requests=20, window_seconds=60)`. Docker HEALTHCHECK запрашивает каждые 30 сек. При 2 Gunicorn воркерах = 4 запроса/мин. При prod + staging = больше. Может превысить лимит.

**Почему это происходит:** Rate limit применён ко всем публичным эндпоинтам как мера защиты, но healthcheck должен быть надёжным.

**Как избежать:** При реализации UX-01 убрать `@rate_limit` с `/health` или увеличить до `max_requests=60`.

### Подводный камень 4: PyJWT 2.x возвращает str, не bytes

**Что идёт не так:** При миграции с python-jose находим код вида `token.decode('utf-8')` на результате `jwt.encode()`.

**Почему это происходит:** PyJWT < 2.0 возвращал bytes. PyJWT >= 2.0 (текущий 2.10.1) возвращает str.

**Как избежать:** Удалить `.decode('utf-8')` если встречается. SEC-03 уже выполнен, но стоит проверить `auth_service.py` на этот паттерн.

**Признаки проблемы:** `AttributeError: 'str' object has no attribute 'decode'`.

### Подводный камень 5: Celery visibility_timeout < task_time_limit

**Что идёт не так:** При `visibility_timeout=3600` (1 час) и `task_time_limit=10800` (3 часа, для book processing) — Celery переставляет задачу в очередь через 1 час, хотя воркер её ещё обрабатывает. Задача выполняется дважды (или больше).

**Почему это происходит:** Redis считает задачу "потерянной" после visibility_timeout, даже если воркер работает.

**Как избежать:** `visibility_timeout` ДОЛЖЕН быть > максимального `task_time_limit`. При time_limit=10800 → visibility_timeout=14400 (4 часа).

**Признаки проблемы:** Книга обрабатывается дважды, дублирующиеся описания в БД.

### Подводный камень 6: Gunicorn timeout для длительных AI-запросов

**Что идёт не так:** Gunicorn убивает воркер после `timeout` секунд. Синхронные вызовы Gemini/Imagen могут занять > 30 сек (default timeout).

**Почему это происходит:** Gunicorn default timeout = 30 сек. AI API нестабильны по времени ответа.

**Как избежать:** Использовать `WORKER_TIMEOUT: int = 300` из config.py (уже есть). В `gunicorn.conf.py`: `timeout = int(os.getenv("WORKER_TIMEOUT", "300"))`.

**Признаки проблемы:** `[CRITICAL] WORKER TIMEOUT` в логах gunicorn, 502 Bad Gateway на AI эндпоинтах.

## Примеры кода

### SEC-03: Проверка завершённой миграции PyJWT

```python
# Источник: Context7 /jpadilla/pyjwt
# БЫЛО (python-jose):
from jose import JWTError, jwt
except JWTError:

# СТАЛО (PyJWT) — проверить backend/app/services/auth_service.py:
import jwt
from jwt.exceptions import PyJWTError
# jwt.encode() → возвращает str (не bytes в PyJWT 2.x)
# jwt.decode() → идентичный API, automatически отклоняет alg=none
except PyJWTError:
```

### DEPLOY-05+08: Celery конфигурация

```python
# Источник: Celery документация + PROJECT requirements
celery_app.conf.update(
    worker_max_memory_per_child=int(
        os.getenv("CELERY_MAX_MEMORY_PER_CHILD", "512000")  # 512MB
    ),
    task_soft_time_limit=int(os.getenv("CELERY_SOFT_TIME_LIMIT", "10800")),  # 3 часа
    task_time_limit=int(os.getenv("CELERY_TIME_LIMIT", "10800")),            # 3 часа
    broker_transport_options={"visibility_timeout": 14400},  # 4 часа > time_limit
)
```

### DEPLOY-06: Синхронизация LANGEXTRACT_MODEL

```yaml
# Источник: инспекция docker-compose файлов
# Изменить во ВСЕХ трёх файлах: docker-compose.lite.yml, docker-compose.lite.prod.yml, docker-compose.staging.yml
# ДО:
- LANGEXTRACT_MODEL=${LANGEXTRACT_MODEL:-gemini-2.0-flash}
# ПОСЛЕ:
- LANGEXTRACT_MODEL=${LANGEXTRACT_MODEL:-gemini-3-flash-preview}
```

### DEPLOY-07: PostgreSQL CVE fix

```yaml
# Источник: docker-compose.lite.prod.yml (production конфигурация)
# ПРИМЕЧАНИЕ: docker-compose.lite.yml использует postgres:15-alpine для dev
# (данные инициализированы на v15, не трогать dev)
# В prod конфигурации:
image: postgres:17.9-alpine  # CVE-2025-8715 CRITICAL устранён
```

### Hawk Celery интеграция

```python
# backend/app/core/celery_app.py — после conf.update
from app.core.hawk import init_hawk_celery
try:
    init_hawk_celery()
except Exception:
    pass  # Не блокировать запуск Celery
```

## Текущее состояние технологий

| Старый подход | Современный подход | Когда изменилось | Влияние |
|---------------|-------------------|-----------------|---------|
| python-jose для JWT | PyJWT 2.x | python-jose заброшен 2021 | SEC-03 выполнен |
| uvicorn --reload в prod | Gunicorn + UvicornWorker | Всегда best practice | DEPLOY-01 — исправить |
| sentry-sdk[fastapi] | hawk-python-sdk[fastapi] | Решение 2026-02-27 | DEPLOY-02 — заменить |
| visibility_timeout=3600 | visibility_timeout=14400 | Анализ time_limit задач | DEPLOY-05 — исправить |
| Celery worker_max_memory 150MB | 512MB | Апгрейд сервера до 32GB | DEPLOY-08 — исправить |
| postgres:15-alpine (prod) | postgres:17.9-alpine | CVE-2025-8715 (CRITICAL) | DEPLOY-07 — исправить в prod |

**Устаревшее:**
- `python-jose`: Нет релизов с 2021, транзитивные CVE через `ecdsa` и `rsa`. Заменён (SEC-03 выполнен).
- `sentry-sdk`: В requirements.txt И requirements.lite.txt. Нужно удалить, добавить `hawk-python-sdk[fastapi]`.
- `@app.on_event("startup")`: Заменён на lifespan в проекте — хорошо, не трогать.
- `validate_nlp_weights`: NLP удалён Dec 2025, валидатор — мёртвый код, блокирует prod запуск.

## Открытые вопросы

1. **Точный API hawk-python-sdk**
   - Что известно: Официальный Python SDK Hawk Tracker существует, PyPI пакет `hawk-python-sdk`
   - Что неясно: Точная версия на PyPI и её стабильность; метод `.send()` у JS SDK (может называться `.send()` или `.catch()`)
   - Рекомендация: При реализации проверить `pip show hawk-python-sdk` для версии; проверить TypeScript типы `@hawk.so/javascript` перед использованием hawk.send()

2. **task_time_limit в celery_app.py vs декораторах задач**
   - Что известно: Глобальный `task_time_limit=1800` в celery_app.py. Тяжёлые задачи (book processing) имеют `soft_time_limit=10800` через декоратор задачи. `visibility_timeout=14400` покрывает оба случая.
   - Что неясно: Является ли глобальный `task_time_limit=1800` (30 мин) проблемой для book processing tasks?
   - Рекомендация: visibility_timeout=14400 (4 часа) решает проблему дублирования. Глобальный time_limit=1800 перекрывается декоратором задачи — оставить как есть.

3. **Лимиты памяти Docker контейнеров на 32GB RAM**
   - Что известно: Сервер 32GB. Celery worker: 512MB (решено). Backend memory limit: 2G в docker-compose.lite.yml.
   - Что неясно: Оптимальное распределение остальных 28GB между PostgreSQL, Redis, backend воркерами, OS.
   - Рекомендация: На усмотрение Claude при реализации; текущие лимиты (PostgreSQL 2G, Redis 768M) консервативны для 32GB сервера — можно увеличить PostgreSQL до 4G.

## Архитектура валидации

### Тестовый фреймворк

| Свойство | Значение |
|----------|----------|
| Фреймворк | pytest 9.0.2 + pytest-asyncio 1.3.0 |
| Файл конфигурации | `backend/pytest.ini` |
| Быстрый запуск | `cd backend && python -m pytest tests/test_config_security.py -x -v` |
| Полный прогон | `cd backend && python -m pytest -v` |

### Требования фазы → Карта тестов

| ID требования | Поведение | Тип теста | Автоматизированная команда | Файл существует? |
|---------------|-----------|-----------|--------------------------|-----------------|
| SEC-01 | Settings() c пустыми env создаётся с DEBUG=False | unit | `pytest tests/test_config_security.py::test_debug_default_false -x` | Нет — Волна 0 |
| SEC-02 | Приложение отказывается стартовать при дефолтном SECRET_KEY в prod | unit | `pytest tests/test_config_security.py::test_secret_key_validation -x` | Нет — Волна 0 |
| SEC-03 | JWT с alg=none отклоняется; токены подписаны PyJWT | unit | `pytest tests/test_security.py -x -k "jwt"` | Частично (test_security.py существует) |
| DEPLOY-01 | docker-compose.lite.yml использует gunicorn (без --reload) | manual | `grep gunicorn docker-compose.lite.yml && ! grep "\-\-reload" docker-compose.lite.yml` | Н/П |
| DEPLOY-02 | init_hawk(app) создаёт HawkFastapi при наличии токена | unit | `pytest tests/test_hawk_init.py -x` | Нет — Волна 0 |
| DEPLOY-02 | init_hawk(app) возвращает None при отсутствии токена | unit | `pytest tests/test_hawk_init.py -x` | Нет — Волна 0 |
| DEPLOY-03 | Hawk JS SDK инициализируется в main.tsx | manual | `cd frontend && npm run build` (сборка без ошибок) | Н/П |
| DEPLOY-05 | visibility_timeout=14400 в celery_app.py | manual | `grep "visibility_timeout.*14400" backend/app/core/celery_app.py` | Н/П |
| DEPLOY-06 | LANGEXTRACT_MODEL=gemini-3-flash-preview во всех docker-compose | manual | `grep -r "LANGEXTRACT_MODEL" docker-compose*.yml \| grep -v "gemini-3-flash"` | Н/П |
| DEPLOY-07 | PostgreSQL 17.9-alpine в prod конфигурации | manual | `grep "17.9-alpine" docker-compose.lite.prod.yml` | Н/П |
| DEPLOY-08 | Celery memory 512MB во всех конфигурациях | manual | `grep "512000" backend/app/core/celery_app.py` | Н/П |
| UX-01 | /health возвращает реальный статус PostgreSQL, Redis, Celery | unit | `pytest tests/routers/test_health.py -x` | Да (test_health.py существует — проверить) |

### Частота запуска тестов

- **При коммите задачи:** `cd backend && python -m pytest tests/test_config_security.py tests/test_hawk_init.py -x -v`
- **При слиянии волны:** `cd backend && python -m pytest -v`
- **Гейт фазы:** Полный прогон без ошибок перед `/gsd:verify-work`

### Пробелы Волны 0

- [ ] `backend/tests/test_config_security.py` — покрывает SEC-01 (DEBUG=False), SEC-02 (fail-fast SECRET_KEY)
- [ ] `backend/tests/test_hawk_init.py` — покрывает DEPLOY-02: init с токеном, graceful skip без токена, Celery интеграция
- [ ] Обновить `backend/requirements.txt` и `backend/requirements.lite.txt` — добавить `hawk-python-sdk[fastapi]`, удалить `sentry-sdk[fastapi]`

*(Существующий `tests/routers/test_health.py` покрывает UX-01 — проверить совместимость после изменений в `/health`. DEPLOY-01, 05, 06, 07, 08 — изменения конфигурации, проверяются grep-командами.)*

## Источники

### Основные (ВЫСОКАЯ уверенность)

- Прямая инспекция кода: `backend/app/core/config.py`, `celery_app.py`, `main.py`, `requirements.txt`, `requirements.lite.txt`, `docker-compose.lite.yml` — актуальное состояние кода подтверждено
- `backend/requirements.txt`: gunicorn==25.0.1, PyJWT[crypto]==2.10.1, celery==5.6.2 — версии подтверждены
- Существующие PLAN файлы: `01-01-PLAN.md`, `01-02-PLAN.md` — детальные реализационные планы уже разработаны

### Вторичные (СРЕДНЯЯ уверенность)

- [Документация Hawk Tracker](https://docs.hawk.so/catchers) — Python SDK и JavaScript SDK (проверено при создании CONTEXT.md)
- [Документация FastAPI Deployment](https://fastapi.tiangolo.com/deployment/server-workers/) — Gunicorn + UvicornWorker конфигурация
- [Celery документация: visibility_timeout](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html) — должен превышать longest running task

### Третичные (НИЗКАЯ уверенность, требует валидации)

- hawk-python-sdk API: точная сигнатура `HawkFastapi({'app_instance': app, 'token': ...})` — не верифицирована через Context7; требует проверки при реализации
- @hawk.so/javascript метод `.send()` — требует проверки TypeScript типов при реализации

## Метаданные

**Разбивка по уверенности:**
- Стандартный стек: ВЫСОКАЯ — все библиотеки уже в requirements или подтверждены официальной документацией
- Архитектура: ВЫСОКАЯ — каждое изменение привязано к конкретной строке существующего кода (инспекция выполнена)
- Подводные камни: ВЫСОКАЯ — обнаружены через прямую инспекцию кода (NLP validator, rate_limit на healthcheck, visibility_timeout)
- Hawk SDK точный API: СРЕДНЯЯ — официальная документация подтверждена, но конкретные параметры требуют валидации при реализации

**Дата исследования:** 2026-03-01
**Актуально до:** 2026-04-01 (стабильная область; gunicorn, PyJWT, Celery обновляются редко)
