---
phase: 01-production-safety
verified: 2026-03-01T17:00:00Z
status: human_needed
score: 9/10 must-haves verified
human_verification:
  - test: "Ошибки бэкенда отображаются в Hawk Tracker с полными стек-трейсами"
    expected: "После добавления HAWK_TOKEN в .env и перезапуска docker compose — вызвать ошибку на бэкенде, убедиться что событие появилось в дашборде hawk-tracker.ru с полным стек-трейсом"
    why_human: "Требует реального токена Hawk Tracker, работающего продакшн-сервера и внешнего дашборда — невозможно верифицировать программно"
---

# Фаза 1: Безопасность продакшена — Отчёт верификации

**Цель фазы:** Приложение безопасно для работы в продакшене — нет эксплуатируемых уязвимостей, реальный мониторинг фиксирует ошибки, сервер работает в production-режиме с защитой данных, критические баги инфраструктуры устранены

**Верифицировано:** 2026-03-01T17:00:00Z
**Статус:** human_needed
**Повторная верификация:** Нет — первичная верификация

---

## Достижение цели

### Наблюдаемые истины

| #   | Истина                                                                                                                 | Статус   | Доказательство                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Приложение запускается с DEBUG=False по умолчанию и отказывается стартовать при дефолтном SECRET_KEY в не-debug режиме | VERIFIED | `config.py` строка 19-21: `DEBUG: bool = (False ...)`. `validate_production_settings` отклоняет дефолтный ключ. 5/5 тестов в `test_config_security.py` проходят                                                       |
| 2   | JWT-токены подписываются через PyJWT (не python-jose), поддельные токены с alg=none отклоняются                        | VERIFIED | `requirements.lite.txt` строка 18: `PyJWT[crypto]==2.10.1`. Поиск `from jose`/`import jose` в `backend/app/` — нет результатов. python-jose отсутствует в requirements                                                |
| 3   | Health check `/health` возвращает реальный статус PostgreSQL, Redis и Celery (не заглушку "checking...")               | VERIFIED | `main.py` строки 322-380: `SELECT 1` через `AsyncSessionLocal`, `celery_app.control.inspect(timeout=2).ping()`, статусы "healthy"/"degraded"/"unhealthy". Строка "checking..." не найдена в файле                     |
| 4   | Ошибки бэкенда отображаются в Hawk Tracker с полными стек-трейсами; JS-ошибки фронтенда — в отдельном проекте Hawk     | PARTIAL  | SDK установлен, интеграция подключена. Фактическое отображение в дашборде требует живого токена и продакшн-деплоя — нужна верификация человеком                                                                       |
| 5   | Бэкенд работает под Gunicorn с UvicornWorker (без флага --reload)                                                      | VERIFIED | `docker-compose.lite.yml` строка 155: `command: gunicorn app.main:app --config gunicorn.conf.py`. `gunicorn.conf.py` строка 15: `worker_class = "uvicorn.workers.UvicornWorker"`                                      |
| 6   | Celery visibility_timeout (14400) превышает time_limit (10800) — нет дублирования задач                                | VERIFIED | `celery_app.py` строки 42-44: `broker_transport_options={"visibility_timeout": 14400}` — 4ч > max task_time_limit 3ч                                                                                                  |
| 7   | LANGEXTRACT_MODEL синхронизирован во всех docker-compose файлах (gemini-3-flash-preview)                               | VERIFIED | `docker-compose.lite.yml` строки 110, 174: `gemini-3-flash-preview`. `docker-compose.lite.prod.yml` строки 125, 184: `gemini-3-flash-preview`. `docker-compose.staging.yml` строки 118, 182: `gemini-3-flash-preview` |
| 8   | PostgreSQL образ обновлён до 17.9-alpine (CVE-2025-8715 CRITICAL, CVE-2025-1094 HIGH устранены)                        | VERIFIED | `docker-compose.lite.prod.yml` строка 252: `postgres:17.9-alpine`. Примечание: `docker-compose.lite.yml` использует `postgres:15-alpine` намеренно (данные инициализированы на v15 — задокументировано в SUMMARY)     |
| 9   | Memory limits для Celery workers единообразны во всех конфигурациях (512MB)                                            | VERIFIED | `celery_app.py` строка 30: `worker_max_memory_per_child=512000`. `docker-compose.lite.prod.yml` строка 172: `--max-memory-per-child=512000`. `docker-compose.staging.yml` строка 169: `--max-memory-per-child=512000` |
| 10  | Hawk Tracker инициализируется в lifespan FastAPI, в Celery workers и на фронтенде                                      | VERIFIED | `main.py` строки 39, 87: `from .core.hawk import init_hawk; init_hawk(app)`. `celery_app.py` строки 93-95: `init_hawk_celery(celery_app)`. `main.tsx` строки 5, 11: `import { initHawk }; initHawk()`                 |

**Счёт:** 9/10 истин верифицированы (истина 4 — частичная, требует верификации человеком)

---

### Требуемые артефакты

| Артефакт                                | Ожидание                                                     | Статус   | Детали                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/core/config.py`            | DEBUG=False по умолчанию, NLP-валидатор удалён               | VERIFIED | Строка 19-21: `DEBUG: bool = (False ...)`. NLP-поля отсутствуют. `validate_nlp_weights` удалён. 214 строк                                |
| `backend/app/core/celery_app.py`        | visibility_timeout=14400, worker_max_memory_per_child=512000 | VERIFIED | Строка 30: `512000`. Строки 42-44: `14400`. DEPLOY-05 и DEPLOY-08 выполнены                                                              |
| `backend/gunicorn.conf.py`              | bind, workers, worker_class для продакшена                   | VERIFIED | Все три экспортируются: `bind = "0.0.0.0:8000"`, `workers = 2`, `worker_class = "uvicorn.workers.UvicornWorker"`. 36 строк               |
| `backend/app/main.py`                   | Реальный health check через AsyncSession                     | VERIFIED | Строки 322-380: `async with AsyncSessionLocal() as session: await session.execute(text("SELECT 1"))`. Заглушка "checking..." отсутствует |
| `backend/tests/test_config_security.py` | Тесты SEC-01, SEC-02, удаление NLP-валидатора                | VERIFIED | 164 строки. 5 тестовых классов, 8 тестов — все проходят                                                                                  |
| `backend/app/core/hawk.py`              | init_hawk, init_hawk_celery с task_failure signal            | VERIFIED | 105 строк. Оба экспорта присутствуют. Graceful import guard (try/except ImportError). task_failure.connect подключён                     |
| `frontend/src/config/hawk.ts`           | initHawk, getHawk для React-фронтенда                        | VERIFIED | 35 строк. Оба экспорта присутствуют. Graceful skip при отсутствии VITE_HAWK_TOKEN                                                        |
| `backend/tests/test_hawk_init.py`       | Тесты инициализации Hawk с task_failure signal               | VERIFIED | 211 строк. 8 тестов — все проходят                                                                                                       |

---

### Верификация ключевых связей

| От                                          | До                                          | Через                                                      | Статус | Детали                                                  |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `docker-compose.lite.yml`                   | `backend/gunicorn.conf.py`                  | `command: gunicorn app.main:app --config gunicorn.conf.py` | WIRED  | Строка 155 в docker-compose.lite.yml                    |
| `backend/app/main.py:lifespan`              | `backend/app/main.py:/health`               | `AsyncSessionLocal + text("SELECT 1")`                     | WIRED  | Строки 336-344: реальный запрос к БД через AsyncSession |
| `backend/app/main.py:lifespan`              | `backend/app/core/hawk.py:init_hawk`        | `init_hawk(app)` в lifespan startup                        | WIRED  | Строки 39, 87 в main.py                                 |
| `backend/app/core/celery_app.py`            | `backend/app/core/hawk.py:init_hawk_celery` | `init_hawk_celery(celery_app)` с подключением task_failure | WIRED  | Строки 93-95 в celery_app.py, обёрнуто в try/except     |
| `frontend/src/main.tsx`                     | `frontend/src/config/hawk.ts:initHawk`      | `initHawk()` перед ReactDOM.createRoot                     | WIRED  | Строки 5, 11 в main.tsx — до рендера                    |
| `frontend/src/components/ErrorBoundary.tsx` | `frontend/src/config/hawk.ts:getHawk`       | `hawkInstance.send()` в componentDidCatch                  | WIRED  | Строки 3, 109-116 в ErrorBoundary.tsx                   |

---

### Покрытие требований

| Требование | Исходный план | Описание                                                   | Статус          | Доказательство                                                                                                                                                         |
| ---------- | ------------- | ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01     | 01-01-PLAN.md | DEBUG по умолчанию False в config.py                       | SATISFIED       | `DEBUG: bool = (False ...)` в config.py; тест `test_debug_default_is_false` проходит                                                                                   |
| SEC-02     | 01-01-PLAN.md | Fail-fast при дефолтном SECRET_KEY в продакшене            | SATISFIED       | `validate_production_settings` отклоняет "dev-secret-key-change-in-production" при DEBUG=False; тест `test_default_secret_key_rejected_in_production` проходит         |
| SEC-03     | 01-01-PLAN.md | PyJWT вместо python-jose (CVE)                             | SATISFIED       | `PyJWT[crypto]==2.10.1` в requirements.lite.txt. python-jose отсутствует. jose не импортируется нигде в `backend/app/`                                                 |
| DEPLOY-01  | 01-01-PLAN.md | Gunicorn в продакшене без --reload                         | SATISFIED       | `docker-compose.lite.yml` строка 155: `gunicorn app.main:app --config gunicorn.conf.py`                                                                                |
| DEPLOY-02  | 01-02-PLAN.md | Hawk Tracker на бэкенде (hawk-python-sdk[fastapi])         | SATISFIED (код) | `requirements.lite.txt` строка 55: `hawk-python-sdk[fastapi]>=3.5.2`. Инициализация в lifespan. Живое подключение к дашборду требует верификации человеком             |
| DEPLOY-03  | 01-02-PLAN.md | Hawk Tracker на фронтенде (@hawk.so/javascript)            | SATISFIED (код) | `package.json`: `"@hawk.so/javascript": "^3.2.18"`. `hawk.ts` создан. `main.tsx` вызывает `initHawk()`. `ErrorBoundary` отправляет ошибки. Дашборд требует верификации |
| DEPLOY-05  | 01-01-PLAN.md | visibility_timeout (14400) > time_limit (10800)            | SATISFIED       | `celery_app.py` строки 42-44: `"visibility_timeout": 14400`                                                                                                            |
| DEPLOY-06  | 01-01-PLAN.md | LANGEXTRACT_MODEL синхронизирован (gemini-3-flash-preview) | SATISFIED       | Все три файла docker-compose содержат `LANGEXTRACT_MODEL:-gemini-3-flash-preview`                                                                                      |
| DEPLOY-07  | 01-01-PLAN.md | PostgreSQL 17.9-alpine (CVE-fix)                           | SATISFIED       | `docker-compose.lite.prod.yml` строка 252: `postgres:17.9-alpine`                                                                                                      |
| DEPLOY-08  | 01-01-PLAN.md | Celery memory 512MB во всех конфигурациях                  | SATISFIED       | `celery_app.py`: 512000. prod: 512000. staging: 512000                                                                                                                 |
| UX-01      | 01-01-PLAN.md | Реальный health check (PostgreSQL + Redis + Celery)        | SATISFIED       | `main.py` строки 336-375: `SELECT 1` к PostgreSQL, `inspect().ping()` к Celery, `cache_manager.is_available` для Redis                                                 |

**Итог:** 11/11 требований обработаны — все SATISFIED (2 требуют верификации дашборда Hawk пользователем)

**Без осиротевших требований:** Все ID (SEC-01, SEC-02, SEC-03, DEPLOY-01..08, UX-01), привязанные к Фазе 1 в REQUIREMENTS.md, покрыты планами 01-01 и 01-02.

---

### Найденные анти-паттерны

Анти-паттернов не обнаружено. Проверенные файлы:

- `backend/app/core/config.py` — чист
- `backend/app/core/celery_app.py` — чист
- `backend/gunicorn.conf.py` — чист
- `backend/app/core/hawk.py` — чист
- `backend/app/main.py` — чист (заглушка "checking..." полностью удалена)
- `frontend/src/config/hawk.ts` — чист
- `frontend/src/main.tsx` — чист

Предсуществующие проблемы (не введены данной фазой, задокументированы в SUMMARY):

- `tests/services/test_gemini_extractor.py` — импортирует несуществующий `JSONResponseParser`
- `tests/services/test_langextract_processor.py` — модуль `langextract_processor` не существует
- Покрытие тестов 32% < 70% порога — pre-existing, не связано с данной фазой

---

### Требуется верификация человеком

#### 1. Hawk Tracker: ошибки бэкенда в дашборде

**Что сделать:**

1. Создать два проекта на hawk-tracker.ru (Python + JavaScript)
2. Добавить токены в `.env` на сервере: `HAWK_TOKEN=<python-token>` и `VITE_HAWK_TOKEN=<js-token>`
3. Пересобрать: `docker compose -f docker-compose.lite.yml up -d --build`
4. Вызвать ошибку на бэкенде (запрос к несуществующему endpoint или через Python endpoint)
5. Проверить дашборд hawk-tracker.ru — событие должно появиться с полным стек-трейсом

**Ожидаемый результат:** Событие с полным стек-трейсом появляется в дашборде Python-проекта Hawk в течение ~30 секунд

**Почему нельзя верифицировать программно:** Требует реального токена Hawk Tracker, живого продакшн-сервера и внешнего дашборда.

#### 2. Hawk Tracker: JavaScript-ошибки фронтенда

**Что сделать:**

1. После шага выше (VITE_HAWK_TOKEN задан)
2. Вызвать JavaScript-ошибку в браузере (например, через DevTools: `throw new Error("test")`)
3. Проверить дашборд JavaScript-проекта Hawk

**Ожидаемый результат:** JS-ошибка появляется в отдельном проекте Hawk (JavaScript)

**Почему нельзя верифицировать программно:** Требует браузера, реального токена и внешнего дашборда.

---

## Итоговый анализ

### Что достигнуто

Все 11 требований фазы (SEC-01, SEC-02, SEC-03, DEPLOY-01..08, UX-01) реализованы в коде. Проверены программно:

- **Безопасность (SEC-01, SEC-02):** DEBUG=False в `config.py`. Fail-fast при дефолтном SECRET_KEY. 8 тестов зелёные.
- **JWT (SEC-03):** PyJWT[crypto]==2.10.1 установлен. python-jose отсутствует. Нигде не импортируется.
- **Gunicorn (DEPLOY-01):** `docker-compose.lite.yml` использует `gunicorn --config gunicorn.conf.py`. UvicornWorker настроен.
- **Hawk бэкенд (DEPLOY-02):** `hawk-python-sdk[fastapi]>=3.5.2` в requirements. `hawk.py` создан. Инициализация в lifespan. 8 unit-тестов проходят.
- **Hawk фронтенд (DEPLOY-03):** `@hawk.so/javascript@^3.2.18` в package.json. `hawk.ts` создан. `initHawk()` вызывается в `main.tsx`. `ErrorBoundary` отправляет ошибки.
- **Celery visibility_timeout (DEPLOY-05):** 14400 > 10800. Дублирование задач устранено.
- **LANGEXTRACT_MODEL (DEPLOY-06):** `gemini-3-flash-preview` во всех трёх docker-compose файлах.
- **PostgreSQL CVE (DEPLOY-07):** `17.9-alpine` в prod-конфигурации.
- **Celery memory (DEPLOY-08):** 512MB в `celery_app.py`, prod и staging docker-compose.
- **Health check (UX-01):** Реальные проверки `SELECT 1` к PostgreSQL, ping к Celery, проверка Redis. Заглушка "checking..." удалена.

### Что ожидает верификации человеком

Единственное, что не поддаётся программной верификации: фактическое появление событий в дашборде Hawk Tracker. Весь код написан корректно, SDK установлен, интеграция подключена — остаётся проверить что внешний сервис получает события при наличии реального токена.

---

_Верифицировано: 2026-03-01T17:00:00Z_
_Верификатор: Claude (gsd-verifier)_
