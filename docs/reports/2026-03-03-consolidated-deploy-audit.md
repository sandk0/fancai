# Консолидированный аудит готовности к деплою fancai

**Дата:** 2026-03-03
**Scope:** Верификация 7 отчётов от 2026-03-01/02 + глубокий аудит 50+ файлов кодовой базы и инфраструктуры
**Метод:** 5 параллельных агентов-аудиторов (отчёты, backend security, инфраструктура, frontend/AI, планирование/миграции)
**Модель:** Claude Opus 4.6

---

## Executive Summary

**Общая оценка готовности: ~88%**

- **Блокирующих проблем (BLOCKER):** 3
- **CRITICAL (исправить до деплоя):** 5
- **HIGH (исправить до/сразу после деплоя):** 10
- **MEDIUM:** 22
- **LOW:** 15

**Рекомендация: ДЕПЛОИТЬ ПОСЛЕ ФИКСОВ BLOCKER + CRITICAL (~2-3 часа работы)**

Проект прошёл масштабную подготовку (фазы 1-4.1, 50/54 задач security-hardening-plan). Все ранее найденные CRITICAL-проблемы из предыдущих аудитов **исправлены**. Однако верификация выявила **новые проблемы**, не покрытые предыдущими отчётами: CSP фактически отключён в production, CI тестирует на других версиях, build-arg несовпадение в docker-compose.

---

## 1. Актуальность существующих документов

### 1.1 Полностью актуальные

| Документ                      | Примечание                                         |
| ----------------------------- | -------------------------------------------------- |
| `security-hardening-plan.md`  | 50/54 задач выполнено, верифицировано кодом        |
| `cross-audit-verification.md` | 9 ошибок и 8 противоречий — все учтены в hardening |

### 1.2 Частично устаревшие

| Документ                               | Актуально                                              | Устарело                                                                       |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `pre-deploy-deep-audit.md`             | Структура аудита, методология                          | C1-C5 все исправлены, некоторые HIGH тоже                                      |
| `deep-audit-gaps.md`                   | NEW-C1 (str(exc)) исправлен, NEW-C2 (CSRF) — by design | NEW-C3 (SW cache) частично актуален, NEW-C6 (metrics pwd) — защищён валидацией |
| `server-setup-plan.md`                 | 22 корректировки полезны                               | Celery/Redis пункты уже исправлены в коде                                      |
| `infrastructure-audit-v5-verified.md`  | Верификационная методология                            | visibility_timeout, celery_config.py — уже исправлены                          |
| `infrastructure-migration-analysis.md` | Сравнительный анализ полезен                           | Granian/Valkey/PgBouncer — не принятые решения                                 |

### 1.3 Полностью устаревшие

Нет полностью устаревших — все документы содержат полезный контекст.

### 1.4 Codebase-документация (.planning/codebase/)

| Файл            | Актуальность | Проблемы                                                            |
| --------------- | ------------ | ------------------------------------------------------------------- |
| ARCHITECTURE.md | ~70%         | Упоминает python-jose (удалён), Imagen 4 (заменён на FLUX.2)        |
| CONCERNS.md     | ~60%         | Часть проблем исправлена, файл не обновлён                          |
| CONVENTIONS.md  | ~95%         | Актуален                                                            |
| INTEGRATIONS.md | ~50%         | Упоминает google-genai, python-jose, Sentry, Imagen 4, Grafana/Loki |
| TESTING.md      | ~90%         | Актуален                                                            |

---

## 2. Статус ранее найденных проблем

### 2.1 Исправленные (верифицировано кодом)

| #   | Проблема                                | Доказательство                                                    |
| --- | --------------------------------------- | ----------------------------------------------------------------- |
| C1  | Celery broker Redis DB 0 = cache        | `docker-compose.prod.yml:86-88` — DB 0/1/2 разделены              |
| C2  | 500-ошибки утекают str(exc)             | `main.py:286` — возвращает `"Internal server error"`              |
| C3  | CSRF middleware не подключён            | `main.py:205-210` — by design, JWT Bearer не уязвим к CSRF        |
| C4  | chmod 777 в Dockerfile.prod             | `Dockerfile.prod:62-65` — теперь chmod 755/775                    |
| C5  | Swagger/ReDoc без auth в production     | `main.py:171-172` — `docs_url=None if not DEBUG`                  |
| C6  | docker system prune --volumes           | `deploy-production.sh:236-238` — безопасный container/image prune |
| C7  | Redis allkeys-lru                       | `docker-compose.prod.yml:295` — теперь volatile-lru               |
| C8  | CSP frame-src 'none'                    | `index.html:13` — `frame-src 'self' blob:`                        |
| H1  | deploy-production.sh ссылается на nginx | Не найдено упоминаний nginx/logrotate                             |
| H2  | max_connections=100 при пике 120        | `docker-compose.prod.yml:260` — увеличен до 150                   |

### 2.2 НЕ исправленные

| #   | Проблема                                | Текущее состояние                       | Severity     |
| --- | --------------------------------------- | --------------------------------------- | ------------ |
| H3  | CI: Python 3.11 + PG 15 + Node 18       | `ci.yml:15,51,16` — prod: 3.12/17/22    | **CRITICAL** |
| H4  | certbot-dns-setup.sh ссылается на nginx | Файл удалён, но удаление не закоммичено | LOW          |

### 2.3 Частично исправленные

| #   | Проблема                            | Статус                                                                                                               |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| H5  | metrics_secure_password захардкожен | Дефолт остался (`config.py:108`), но production-валидация (`config.py:176-180`) блокирует запуск с дефолтом          |
| H6  | pool_size=20 + max_overflow=40      | PG max_connections=150, но 2 workers × 60 + Celery = впритык                                                         |
| H7  | SW кеширует user-specific данные    | Очистка при logout реализована (`auth.ts:126`, `sw.ts:425-434`), но при закрытии браузера без logout данные остаются |

---

## 3. Новые находки

### 3.1 BLOCKER — деплой невозможен без исправления

**BLOCKER-1: CSP фактически отключён в production**

- **Файл:** `frontend/index.html:13`
- **Проблема:** `script-src 'self' 'unsafe-inline' 'unsafe-eval'` — позволяет выполнение произвольного JS через `eval()`, `Function()`, inline scripts. Полностью нивелирует защиту от XSS.
- **Причина:** Vite/React в dev-режиме требуют `unsafe-eval`, но в production это не нужно
- **Фикс:** Использовать Caddyfile для установки production CSP без `unsafe-eval`/`unsafe-inline`, убрать meta-тег CSP из index.html или сделать его dev-only. Сложность: **M**

**BLOCKER-2: CI тестирует на других версиях чем production**

- **Файл:** `.github/workflows/ci.yml:15,16,51`
- **Проблема:** Python 3.11 vs prod 3.12, PostgreSQL 15 vs prod 17, Node.js 18 vs prod 22
- **Риск:** Тесты проходят в CI, но ломаются в production (различия в API, SQL planner, нативные модули)
- **Фикс:** Обновить `PYTHON_VERSION: '3.12'`, `postgres:17-alpine`, `NODE_VERSION: '22'`. Сложность: **S**

**BLOCKER-3: VITE_API_URL vs VITE_API_BASE_URL — неверный build-arg**

- **Файл:** `docker-compose.prod.yml:65`
- **Проблема:** Compose передаёт `VITE_API_URL`, а Dockerfile.prod и код используют `VITE_API_BASE_URL`. Переменная игнорируется, используется дефолт `/api/v1`. Работает "случайно" (относительный путь корректен), но сломается при абсолютных URL.
- **Фикс:** Переименовать `VITE_API_URL` → `VITE_API_BASE_URL` в docker-compose.prod.yml. Сложность: **S**

### 3.2 CRITICAL — исправить до деплоя

**CRIT-1: /users/test-db без аутентификации — утечка информации о БД**

- **Файл:** `backend/app/routers/users.py:39`
- **Проблема:** Endpoint доступен без auth, возвращает версию PostgreSQL, имя БД, имя пользователя БД, количество таблиц
- **Фикс:** Добавить `Depends(get_current_admin_user)` или удалить endpoint. Сложность: **S**

**CRIT-2: HTTPException в service layer ломает Celery**

- **Файл:** `backend/app/services/entity_deduplication_service.py:99-103`
- **Проблема:** `raise HTTPException(409)` внутри сервиса — при вызове из Celery task (`book_tasks.py:683`) ловится как обычный Exception, метрики некорректны
- **Фикс:** Заменить на доменное исключение `EntityDeduplicationInProgressError`. Сложность: **S**

**CRIT-3: Отсутствует .env.production.example**

- **Файл:** Нет файла (все .env.\*.example удалены в git status)
- **Проблема:** `.env.example` существует, но `deploy-production.sh:11` ожидает `.env.production`. Новый разработчик не знает полный список prod-переменных (DB*USER, REDIS_PASSWORD, VAPID*\*, MONITOR_PASSWORD_HASH и др.)
- **Фикс:** Создать `.env.production.example` с полным списком переменных из docker-compose.prod.yml. Сложность: **S**

**CRIT-4: 68 незакоммиченных удалений в git**

- **Проблема:** Отладочные артефакты, легаси конфиги, устаревшие .env файлы — висят как unstaged deletions
- **Фикс:** `git add -u && git commit -m "chore: cleanup legacy configs and debug artifacts"`. Сложность: **S**

**CRIT-5: pytest-asyncio==1.3.0 не существует**

- **Файл:** `backend/requirements.txt`
- **Проблема:** Версия 1.3.0 не существует в PyPI (актуальная — 0.25.x). Docker build может падать при `pip install`
- **Фикс:** Исправить на `pytest-asyncio==0.25.0` (или актуальную). Сложность: **S**

### 3.3 HIGH — исправить до/сразу после деплоя

| #       | Проблема                                                         | Файл:строка                                                           | Сложность |
| ------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | --------- |
| HIGH-1  | CSP backend не содержит `frame-src`, конфликтует с frontend      | `security_headers.py:82-125`                                          | S         |
| HIGH-2  | `connect-src wss://` без ограничения домена в CSP                | `security_headers.py:115`                                             | S         |
| HIGH-3  | `ws://localhost:*` в production CSP                              | `security_headers.py:116`                                             | S         |
| HIGH-4  | `_inline_defs` мутирует входной словарь через `pop`              | `openrouter_client.py:82`                                             | S         |
| HIGH-5  | Нет client-side rate limiting в OpenRouter                       | `openrouter_client.py`                                                | M         |
| HIGH-6  | raw fetch() в pushNotifications.ts (нет token refresh)           | `pushNotifications.ts:220,398,420`                                    | M         |
| HIGH-7  | Gunicorn triple config — логи в файлы, не видны в docker logs    | `Dockerfile.prod:79-92` vs `gunicorn.conf.py` vs `entrypoint.prod.sh` | M         |
| HIGH-8  | entrypoint.prod.sh — мёртвый код (не вызывается)                 | `entrypoint.prod.sh` (весь файл)                                      | M         |
| HIGH-9  | deploy-production.sh тегирует `:latest`, compose ожидает `:lite` | `deploy-production.sh:183-185`                                        | S         |
| HIGH-10 | X-Frame-Options: Caddy SAMEORIGIN vs backend DENY (конфликт)     | `Caddyfile:50` vs `security_headers.py:189`                           | S         |

### 3.4 MEDIUM

| #      | Проблема                                                      | Файл:строка                            |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| MED-1  | Дефолтный SECRET_KEY виден в VCS                              | `config.py:22`                         |
| MED-2  | Дефолтный METRICS_PASSWORD виден в VCS                        | `config.py:108`                        |
| MED-3  | JWT_SECRET_KEY в compose не используется в config.py          | `docker-compose.prod.yml:82`           |
| MED-4  | sync endpoint: raw body без size limit                        | `sync.py:232`                          |
| MED-5  | Exception swallowing в admin/system.py                        | `admin/system.py:82`                   |
| MED-6  | --preload с asyncio может вызвать проблемы                    | `Dockerfile.prod:88`                   |
| MED-7  | Нет CSP для статических файлов в Caddy                        | `Caddyfile`                            |
| MED-8  | Нет rate limiting в Caddy                                     | `Caddyfile`                            |
| MED-9  | @uploads matcher после handle-блока                           | `Caddyfile:41-46`                      |
| MED-10 | Устаревшая документация в deploy скрипте (Prometheus/Grafana) | `deploy-production.sh:420`             |
| MED-11 | Мониторинг запуск через --profile (не работает)               | `deploy-production.sh:402`             |
| MED-12 | health-check.sh проверяет docker-compose.yml (не существует)  | `infrastructure-health-check.sh:44-66` |
| MED-13 | health-check.sh проверяет Dockerfile (не существует)          | `infrastructure-health-check.sh:80`    |
| MED-14 | verify-database-config.sh проверяет несуществующие конфиги    | `verify-database-config.sh:81,206`     |
| MED-15 | Stack traces в localStorage без проверки env                  | `ErrorBoundary.tsx:88-96`              |
| MED-16 | Глобальный timeout 2мин для всех запросов                     | `client.ts:15`                         |
| MED-17 | Race condition при rehydrate (100ms window)                   | `auth.ts:214-219`                      |
| MED-18 | Fire-and-forget create_task без сохранения ref                | `openrouter_client.py:246,375,493`     |
| MED-19 | API key может быть None, \_available всё равно True           | `gemini_extractor.py:501`              |
| MED-20 | record_llm_error с неправильными аргументами                  | `entity_dedup_service.py:127`          |
| MED-21 | Alembic env.py — неполные импорты моделей (Entity и др.)      | `alembic/env.py`                       |
| MED-22 | Тестовые зависимости в production requirements.txt            | `requirements.txt`                     |

### 3.5 LOW

| #      | Проблема                                                         | Файл:строка                        |
| ------ | ---------------------------------------------------------------- | ---------------------------------- |
| LOW-1  | Access Token TTL 7 дней                                          | `config.py:48`                     |
| LOW-2  | 404 handler раскрывает путь запроса                              | `main.py:461`                      |
| LOW-3  | Root endpoint указывает на /docs даже в production               | `main.py:349`                      |
| LOW-4  | Redis пароль виден в healthcheck args                            | `docker-compose.prod.yml:302`      |
| LOW-5  | `gunicorn.ctl` — пустой файл (0 байт)                            | `backend/gunicorn.ctl`             |
| LOW-6  | `docker-compose` с дефисом в сообщениях                          | `verify-database-config.sh:75,200` |
| LOW-7  | Нет user context в Hawk ошибках                                  | `hawk.ts:25-28`                    |
| LOW-8  | refreshAccessToken передает пустую строку                        | `auth.ts:162`                      |
| LOW-9  | epubjs 0.3.93 — unmaintained                                     | `package.json:46`                  |
| LOW-10 | Устаревший build-timestamp в index.html                          | `index.html:35`                    |
| LOW-11 | push.py: user ID как "timestamp" в test notification             | `push.py:307`                      |
| LOW-12 | celery_app.py include: `app.core.tasks` (может не существовать)  | `celery_app.py:15`                 |
| LOW-13 | Непинованные зависимости (hawk-sdk, pywebpush, aioboto3)         | `requirements.txt`                 |
| LOW-14 | ROADMAP.md не синхронизирован с STATE.md (Phase 4.1)             | `.planning/ROADMAP.md`             |
| LOW-15 | PROJECT.md — 9 решений в статусе "Ожидает" (часть уже выполнены) | `.planning/PROJECT.md`             |

---

## 4. Анализ инфраструктуры

### 4.1 Docker Compose Production

**Файл:** `docker-compose.prod.yml` (337 строк)

Сервисы: backend (FastAPI+Gunicorn), frontend (Vite SPA), postgres (17.9-alpine), redis (7.4-alpine), celery-worker, celery-beat, caddy.

**Положительное:**

- Redis DB разделены: cache=0, broker=1, results=2
- `volatile-lru` для Redis
- `max_connections=150` для PostgreSQL
- Health checks для всех сервисов
- Resource limits (`mem_limit`, `cpus`)
- `restart: unless-stopped` для всех

**Проблемы:** См. BLOCKER-3 (VITE_API_URL), PROD-03 (JWT_SECRET_KEY), PROD-07 (Redis пароль в healthcheck)

### 4.2 Caddy конфигурация

**Файл:** `Caddyfile` (102 строки)

- Auto-HTTPS через Let's Encrypt (корректно)
- Reverse proxy на backend:8000 и frontend:3000
- Basic auth для мониторинга (`monitor.fancai.ru`)
- Upload limit 50MB для book endpoints

**Проблемы:** Нет CSP заголовка для статических файлов, нет rate limiting, X-Frame-Options конфликт с backend

### 4.3 PostgreSQL

- Версия: 17.9-alpine (актуальная)
- `max_connections=150`, `shared_buffers=4GB`, `effective_cache_size=8GB`
- `work_mem=32MB`, `maintenance_work_mem=512MB`
- `mem_limit: 5g` в compose
- Комментарий: конфигурация адекватна для 32GB сервера

### 4.4 Redis

- Версия: 7.4-alpine
- `maxmemory 640mb`, `volatile-lru` (исправлено)
- `appendonly yes` (persistence)
- DB separation: 0/1/2

### 4.5 Celery

- Worker: `concurrency=2`, `max-memory-per-child=512000`
- Beat: отдельный контейнер
- Broker: Redis DB 1, Results: Redis DB 2 (исправлено)
- `visibility_timeout=14400` (исправлено)

### 4.6 CI/CD Pipeline

**Файл:** `.github/workflows/ci.yml` (358 строк)

**BLOCKER:** Python 3.11, PG 15, Node 18 — не соответствуют production (3.12, 17, 22). См. BLOCKER-2.

Пайплайн содержит: lint (ruff, mypy), backend tests (pytest), frontend tests (vitest), build checks. Структура хорошая, версии устарели.

### 4.7 Deploy скрипты

**Файл:** `scripts/deploy-production.sh` (445 строк)

- `docker system prune --volumes` — **исправлено** (безопасный prune)
- nginx/logrotate ссылки — **исправлены** (удалены)
- Проблемы: тегирование `:latest` vs `:lite`, устаревшая документация, мониторинг через `--profile`

### 4.8 Мониторинг-стек

**Файл:** `docker-compose.monitoring.yml` (134 строки)

Сервисы: Netdata (системный мониторинг), VictoriaMetrics (метрики), Uptime Kuma (uptime), Dozzle (логи), Flower (Celery).

- Все порты привязаны к 127.0.0.1 + Caddy basic_auth (двойная защита)
- Docker socket смонтирован в Netdata и Dozzle (ожидаемо для мониторинга)
- Dozzle `ENABLE_ACTIONS=true` позволяет перезапуск контейнеров через UI

---

## 5. Анализ .planning/

### 5.1 Состояние GSD-планирования

- **Прогресс:** 5 фаз завершены (1, 2, 3, 4, 4.1), 14/14 планов выполнены
- **Скорость:** Средняя ~22 мин на план, всего ~3.2 часа
- **Следующая фаза:** Phase 5 — Стабильность AI-пайплайна
- **Рассогласование:** STATE.md считает Phase 4.1 завершённой, ROADMAP.md — нет (чекбоксы не обновлены)

### 5.2 Актуальность .planning/codebase/

ARCHITECTURE.md, CONCERNS.md и INTEGRATIONS.md содержат устаревшие ссылки (python-jose, google-genai, Sentry, Imagen 4). Рекомендуется обновить перед Phase 5.

### 5.3 Актуальность .planning/research/

Research документы от 2026-02-27 — актуальны как исторический контекст. Рекомендованная структура фаз реализована.

### 5.4 Что блокирует деплой из незавершённых фаз?

Фазы 5-8 (AI stability, testing, performance, monitoring) — **не блокируют деплой**. Это улучшения, которые можно выполнить после деплоя. Единственные блокеры — технические проблемы из раздела 3.1.

---

## 6. Checklist: Go / No-Go для деплоя

### Безопасность

| Критерий                                    | Статус | Файл                   | Комментарий                                 |
| ------------------------------------------- | ------ | ---------------------- | ------------------------------------------- |
| JWT реализация (PyJWT, explicit algorithms) | ✅     | `auth_service.py`      | Корректно                                   |
| CORS настроен                               | ✅     | `main.py`              | Только разрешённые origins                  |
| CSP защищает от XSS                         | ❌     | `index.html:13`        | **BLOCKER-1:** unsafe-eval + unsafe-inline  |
| CSRF защита                                 | ✅     | `main.py:205-210`      | By design — JWT Bearer не уязвим            |
| 500-ошибки не утекают детали                | ✅     | `main.py:286`          | Generic message                             |
| Secrets не захардкожены в production        | ⚠️     | `config.py:22,108`     | Дефолты есть, но валидация блокирует запуск |
| /docs /redoc закрыты в production           | ✅     | `main.py:171-172`      | Зависит от DEBUG                            |
| /users/test-db закрыт                       | ❌     | `users.py:39`          | **CRIT-1:** Нет auth                        |
| Admin endpoints защищены                    | ✅     | `admin/*.py`           | get_current_admin_user                      |
| Password hashing (bcrypt)                   | ✅     | `auth_service.py`      | Корректно                                   |
| Rate limiting на auth endpoints             | ✅     | `auth.py`              | Реализовано                                 |
| File upload validation                      | ✅     | `books/crud.py:93-109` | Расширение + размер                         |
| Path traversal protection                   | ✅     | `images.py:208-211`    | Проверка .. / \                             |

### Инфраструктура

| Критерий                        | Статус | Файл                            | Комментарий                                      |
| ------------------------------- | ------ | ------------------------------- | ------------------------------------------------ |
| Docker resource limits          | ✅     | `docker-compose.prod.yml`       | mem_limit для всех                               |
| Redis DB separation             | ✅     | `docker-compose.prod.yml:86-88` | DB 0/1/2                                         |
| Redis eviction policy           | ✅     | `docker-compose.prod.yml:295`   | volatile-lru                                     |
| PG max_connections достаточен   | ⚠️     | `docker-compose.prod.yml:260`   | 150, впритык при 2 workers                       |
| Caddy auto-HTTPS                | ✅     | `Caddyfile`                     | Let's Encrypt                                    |
| Health checks для всех сервисов | ✅     | `docker-compose.prod.yml`       | Да                                               |
| Deploy script безопасен         | ⚠️     | `deploy-production.sh`          | Prune исправлен, но теги `:latest` vs `:lite`    |
| CI версии = production версии   | ❌     | `ci.yml:15,16,51`               | **BLOCKER-2:** 3.11/15/18 vs 3.12/17/22          |
| Build-args корректны            | ❌     | `docker-compose.prod.yml:65`    | **BLOCKER-3:** VITE_API_URL vs VITE_API_BASE_URL |

### AI-сервисы

| Критерий                    | Статус | Файл                         | Комментарий                     |
| --------------------------- | ------ | ---------------------------- | ------------------------------- |
| OpenRouter fallback chain   | ✅     | `openrouter_client.py:49-53` | 3 модели                        |
| Rate limiting на LLM-вызовы | ⚠️     | `gemini_extractor.py:523`    | Semaphore(3) только в extractor |
| Celery task retry/timeout   | ✅     | `book_tasks.py:56-64`        | max_retries=3, time_limit=10800 |
| Error handling в tasks      | ✅     | `book_tasks.py:134-148`      | SoftTimeLimitExceeded обработан |
| Redis distributed lock      | ✅     | `book_tasks.py:169-211`      | С cleanup в finally             |

### Мониторинг

| Критерий                      | Статус | Файл                           | Комментарий              |
| ----------------------------- | ------ | ------------------------------ | ------------------------ |
| Hawk Tracker (backend)        | ✅     | `main.py`                      | hawk-python-sdk[fastapi] |
| Hawk Tracker (frontend)       | ✅     | `hawk.ts`                      | @hawk.so/javascript      |
| Мониторинг-стек за basic_auth | ✅     | `Caddyfile:68-95`              | monitor.fancai.ru        |
| Health check endpoints        | ✅     | Backend + compose healthchecks | Да                       |

### Данные

| Критерий                        | Статус | Файл                      | Комментарий                               |
| ------------------------------- | ------ | ------------------------- | ----------------------------------------- |
| Alembic миграции без конфликтов | ✅     | `alembic/versions/`       | 47 миграций, 1 голова                     |
| Downgrade функции               | ✅     | Последние 5 миграций      | Все работают                              |
| Volumes persistence             | ✅     | `docker-compose.prod.yml` | Named volumes                             |
| .env.example актуален           | ⚠️     | `.env.example`            | Есть, но deploy ожидает `.env.production` |

### Frontend

| Критерий                     | Статус | Файл                           | Комментарий     |
| ---------------------------- | ------ | ------------------------------ | --------------- |
| SW очистка при logout        | ✅     | `sw.ts:425-434`, `auth.ts:126` | Реализовано     |
| Error boundary в production  | ✅     | `ErrorBoundary.tsx:190`        | Dev-only детали |
| Source maps отключены в prod | ✅     | `vite.config.ts:80`            | Корректно       |
| Нет хардкоженных секретов    | ✅     | Весь frontend                  | Не обнаружено   |

---

## 7. Приоритизированный план действий

### BLOCKER — деплой невозможен без исправления

| #   | Файл                                | Что менять                                                                                                                                                 | Сложность |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `frontend/index.html:13`            | Убрать CSP meta-тег, перенести production CSP в Caddyfile (без unsafe-eval/unsafe-inline). Или: оставить meta-тег для dev, Caddy header перезапишет в prod | **M**     |
| 2   | `.github/workflows/ci.yml:15,16,51` | `PYTHON_VERSION: '3.12'`, `NODE_VERSION: '22'`, `postgres:17-alpine`                                                                                       | **S**     |
| 3   | `docker-compose.prod.yml:65`        | `VITE_API_URL` → `VITE_API_BASE_URL`                                                                                                                       | **S**     |

### CRITICAL — исправить до деплоя

| #   | Файл                                                          | Что менять                                                                | Сложность |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| 4   | `backend/app/routers/users.py:39`                             | Добавить `Depends(get_current_admin_user)` к `/users/test-db` или удалить | **S**     |
| 5   | `backend/app/services/entity_deduplication_service.py:99-103` | Заменить HTTPException на доменное исключение                             | **S**     |
| 6   | —                                                             | Создать `.env.production.example` из переменных docker-compose.prod.yml   | **S**     |
| 7   | Git working tree                                              | `git add -u && git commit` — 68 незакоммиченных удалений                  | **S**     |
| 8   | `backend/requirements.txt`                                    | `pytest-asyncio==1.3.0` → `pytest-asyncio==0.25.0`                        | **S**     |

### PRE-DEPLOY — желательно до деплоя

| #   | Файл                               | Что менять                                                        | Сложность |
| --- | ---------------------------------- | ----------------------------------------------------------------- | --------- |
| 9   | `security_headers.py:115-116`      | `wss://` → `wss://*.fancai.ru`, убрать `ws://localhost:*`         | **S**     |
| 10  | `openrouter_client.py:82`          | `schema.pop("$defs")` → `schema.get("$defs", {})` + copy          | **S**     |
| 11  | `Caddyfile:50`                     | X-Frame-Options: согласовать с backend (DENY или убрать из Caddy) | **S**     |
| 12  | `Dockerfile.prod:79-92`            | Использовать gunicorn.conf.py, логи в stdout для docker logs      | **M**     |
| 13  | `deploy-production.sh:183-185`     | Теги `:latest` → `:lite`                                          | **S**     |
| 14  | `pushNotifications.ts:220,398,420` | Заменить raw fetch() на apiClient                                 | **M**     |
| 15  | `openrouter_client.py`             | Добавить Semaphore или token bucket rate limiter                  | **M**     |

### POST-DEPLOY — можно сразу после деплоя

| #   | Файл                             | Что менять                                                                | Сложность |
| --- | -------------------------------- | ------------------------------------------------------------------------- | --------- |
| 16  | `entrypoint.prod.sh`             | Либо использовать (содержит полезные проверки), либо удалить              | **M**     |
| 17  | `deploy-production.sh:402,420`   | Обновить мониторинг-команду, убрать Prometheus/Grafana                    | **S**     |
| 18  | `infrastructure-health-check.sh` | Обновить имена файлов (Dockerfile → Dockerfile.prod и т.д.)               | **S**     |
| 19  | `verify-database-config.sh`      | Убрать проверки монтируемых конфигов, `docker-compose` → `docker compose` | **S**     |
| 20  | `.planning/codebase/`            | Обновить ARCHITECTURE.md, CONCERNS.md, INTEGRATIONS.md                    | **M**     |
| 21  | `.planning/ROADMAP.md`           | Отметить Phase 4.1 и Plan 04.1-03 как завершённые                         | **S**     |

### BACKLOG — технический долг

| #   | Файл                      | Что менять                                                           | Сложность |
| --- | ------------------------- | -------------------------------------------------------------------- | --------- |
| 22  | `requirements.txt`        | Разделить на requirements.txt + requirements-dev.txt                 | **S**     |
| 23  | `requirements.txt`        | Пинировать hawk-python-sdk, pywebpush, aioboto3                      | **S**     |
| 24  | `config.py:33-34`         | Уменьшить DB_POOL_SIZE до 10 или увеличить PG max_connections до 200 | **S**     |
| 25  | `alembic/env.py`          | Добавить импорты Entity, EntityMention и др. моделей                 | **S**     |
| 26  | `gunicorn.ctl`            | Удалить пустой файл                                                  | **S**     |
| 27  | `ErrorBoundary.tsx:88-96` | Не сохранять stack traces в localStorage в production                | **S**     |
| 28  | `hawk.ts:25-28`           | Добавить user context в ошибки                                       | **S**     |
| 29  | `client.ts:15`            | Дифференцировать timeout (15s для GET, 120s для LLM)                 | **S**     |
| 30  | `Caddyfile`               | Добавить CSP для статических файлов, rate limiting                   | **M**     |
| 31  | `gemini_extractor.py:501` | Проверять api_key is not None в \_initialize()                       | **S**     |

---

## Приложение A: Размеры ключевых файлов

| Файл                                         | Строк |
| -------------------------------------------- | ----- |
| `backend/app/routers/images.py`              | 957   |
| `backend/app/routers/reading_sessions.py`    | 1089  |
| `backend/app/routers/books/crud.py`          | 792   |
| `backend/app/core/openrouter_client.py`      | 537   |
| `backend/app/routers/auth.py`                | 509   |
| `backend/app/core/exceptions.py`             | 500   |
| `frontend/src/sw.ts`                         | 878   |
| `frontend/src/services/pushNotifications.ts` | 503   |
| `backend/app/tasks/book_tasks.py`            | 923   |

## Приложение B: Статус ранее принятых архитектурных решений

| Решение                           | Рекомендация                      | Статус        |
| --------------------------------- | --------------------------------- | ------------- |
| Caddy вместо nginx                | infrastructure-migration-analysis | ✅ Выполнено  |
| VictoriaMetrics вместо Prometheus | infrastructure-migration-analysis | ✅ Выполнено  |
| Hawk Tracker вместо Sentry        | infrastructure-audit-v5-verified  | ✅ Выполнено  |
| OpenRouter для всех AI            | infrastructure-audit-v5-verified  | ✅ Выполнено  |
| FLUX.2 Klein для изображений      | infrastructure-audit-v5-verified  | ✅ Выполнено  |
| PyJWT вместо python-jose          | infrastructure-audit-v5-verified  | ✅ Выполнено  |
| Celery memory 512MB               | infrastructure-audit-v5-verified  | ✅ Выполнено  |
| Granian вместо Gunicorn           | infrastructure-migration-analysis | ❌ Не принято |
| Valkey вместо Redis               | infrastructure-migration-analysis | ❌ Не принято |
| PgBouncer                         | infrastructure-migration-analysis | ❌ Не принято |
| pgBackRest                        | infrastructure-migration-analysis | ❌ Не принято |
