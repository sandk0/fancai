# Верификация правок fancai — 2026-03-03

## Executive Summary

Проведена глубокая верификация 26 исправлений из двух сессий (133 изменённых файла). **Все 5 CRITICAL и 3 BLOCKER находок из предыдущих аудитов исправлены.** Из 26 фиксов: 21 применён корректно (OK), 5 — частично (PARTIAL). Обнаружено **3 новых CRITICAL-проблемы**: `frontend/public/js/` не закоммичен в git (404 в CI/prod), `.env.production.example` критически устарел, Caddy не может проксировать к мониторингу (разные Docker-сети). Также найдена 1 HIGH-проблема — несовпадение CSP `connect-src` между meta-тегом и Caddyfile (блокирует Pollinations.ai). **Вердикт: GO с оговорками** — основное приложение готово к деплою после 2 обязательных фиксов (git add public/js/, CSP sync), мониторинг требует отдельной доработки.

---

## 1. Верификация фиксов (26 items)

### Сессия 1: Pre-deploy (5 фиксов)

| #   | Фикс                                   | Файл                              | Статус | Проблемы                                                                  |
| --- | -------------------------------------- | --------------------------------- | ------ | ------------------------------------------------------------------------- |
| 1   | Убран unsafe-eval из CSP meta-тега     | frontend/index.html:13            | **OK** | Минорно: backend/SECURITY.md:160 ещё упоминает unsafe-eval (документация) |
| 2   | /users/test-db защищён admin auth      | backend/app/routers/users.py:41   | **OK** | Нет                                                                       |
| 3   | CI: Python 3.12, Node 22, PG 17-alpine | .github/workflows/ci.yml:15-16,51 | **OK** | Совпадает с Dockerfile.prod и Dockerfile.dev                              |
| 4   | Все 18 моделей в alembic/env.py        | backend/alembic/env.py:14-29      | **OK** | Совпадает с models/**init**.py                                            |
| 5   | Gunicorn логирует в stdout             | backend/gunicorn.conf.py:30-31    | **OK** | accesslog="-", errorlog="-"                                               |

### Сессия 1: Post-deploy (12 фиксов)

| #   | Фикс                                              | Файл                                                | Статус      | Проблемы                                                                                          |
| --- | ------------------------------------------------- | --------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| 6   | CSP + HSTS + Permissions-Policy + COOP            | Caddyfile:48-58                                     | **OK**      | Все заголовки присутствуют и корректны                                                            |
| 7   | Убран --preload                                   | Dockerfile.prod:82                                  | **OK**      | Нет --preload ни в CMD, ни в gunicorn.conf.py                                                     |
| 8   | Image tags :lite → :latest                        | docker-compose.prod.yml, deploy-production.sh       | **OK**      | 0 упоминаний :lite                                                                                |
| 9   | VITE_API_URL → VITE_API_BASE_URL                  | useReadingSession.ts:426,467; docker-compose.\*.yml | **OK**      | 0 упоминаний старого VITE_API_URL во frontend                                                     |
| 10  | Убран JWT_SECRET_KEY                              | docker-compose.prod.yml, deploy-production.sh       | **OK**      | Остался только в docs/ (исторические отчёты)                                                      |
| 11  | infrastructure-health-check.sh — имена файлов     | scripts/infrastructure-health-check.sh              | **PARTIAL** | Строки 264, 274 ссылаются на `docker-compose.yml` (не существует) вместо `docker-compose.dev.yml` |
| 12  | verify-database-config.sh — убраны .conf проверки | scripts/verify-database-config.sh                   | **OK**      | Проверяет через docker exec и compose CLI args                                                    |
| 13  | entrypoint.prod.sh подключён как ENTRYPOINT       | Dockerfile.prod:79                                  | **OK**      | ENTRYPOINT + exec "$@" + chmod 755                                                                |
| 14  | CMD в exec form + gunicorn.conf.py                | Dockerfile.prod:82                                  | **OK**      | `["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]`                                          |
| 15  | init: true для backend и celery-worker            | docker-compose.prod.yml:82,147                      | **PARTIAL** | celery-beat (строка ~198) НЕ имеет init: true                                                     |
| 16  | worker_tmp_dir = /dev/shm                         | gunicorn.conf.py:27                                 | **OK**      | + явный volume mount /dev/shm в compose                                                           |
| 17  | Исправлен help text deploy скрипта                | deploy-production.sh                                | **OK**      | Корректные ссылки на docker-compose.prod.yml                                                      |

### Сессия 1: Дополнительные фиксы (вне плана)

| #   | Фикс                                          | Файл                                                    | Статус | Проблемы                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------- | ------ | --------------------------------------------------------- |
| E1  | Celery broker/backend из env vars             | celery_app.py:13-14; docker-compose.prod.yml:88-89      | **OK** | В dev compose нет CELERY_BROKER_URL — всё на DB 0         |
| E2  | Redis volatile-lru                            | docker-compose.prod.yml:296; docker-compose.dev.yml:238 | **OK** | Оба compose файла                                         |
| E3  | CSP frame-src 'self' blob:                    | frontend/index.html:13                                  | **OK** | Нет                                                       |
| E4  | Мониторинг: auth + порты 127.0.0.1            | docker-compose.monitoring.yml                           | **OK** | Dozzle полагается на Caddy basic_auth (приемлемо)         |
| E5  | PG tuning: stop_signal, shared_buffers и т.д. | docker-compose.prod.yml:238-289                         | **OK** | Хорошая настройка для 32GB/12vCPU/NVMe                    |
| E6  | HAWK_TOKEN + healthchecks                     | docker-compose.prod.yml                                 | **OK** | Healthchecks для всех 6 сервисов                          |
| E7  | Убраны GEMINI*MODEL, IMAGEN*\*                | config.py                                               | **OK** | Только OPENROUTER_API_KEY, legacy Optional с комментарием |
| E8  | Deploy: docker-compose.prod.yml, без nginx    | deploy-production.sh:10                                 | **OK** | Caddy pull на строке 172                                  |
| E9  | CI: npm run build (не build:unsafe)           | ci.yml:217                                              | **OK** | Нет                                                       |

### Сессия 2 (9 фиксов)

| #    | Фикс                                        | Файл                                          | Статус      | Проблемы                                                                   |
| ---- | ------------------------------------------- | --------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| S2-1 | Удалён пустой gunicorn.ctl                  | —                                             | **OK**      | Файл не существует, 0 ссылок в коде                                        |
| S2-2 | 4 зависимости запинены (==)                 | requirements.txt:40,47,71,74                  | **OK**      | Все 37 зависимостей используют ==                                          |
| S2-3 | except ValueError as e → except ValueError: | entities.py:243, reading_sessions.py:367      | **PARTIAL** | reading_sessions.py:535 и :729 — тот же паттерн не исправлен               |
| S2-4 | Root / показывает docs только при DEBUG     | main.py:339-355                               | **OK**      | settings.DEBUG=False по умолчанию + production validator                   |
| S2-5 | refreshToken() без параметра                | auth.ts:29, stores/auth.ts:162, client.ts:128 | **OK**      | Все 4 call-site без аргументов, тест обновлён                              |
| S2-6 | record_llm_error консистентность            | entity_deduplication_service.py:127           | **OK**      | "openrouter-dedup" + type(e).**name** — совпадает с Prometheus constraints |
| S2-7 | .env.production.example                     | .env.production.example                       | **PARTIAL** | Файл критически устарел (см. раздел 3, NEW-3)                              |
| S2-8 | Sync: Content-Length + body size check      | sync.py:231-239                               | **PARTIAL** | int(content_length) без try/except → 500 на невалидном заголовке           |
| S2-9 | Inline скрипты вынесены в public/js/        | index.html:224,240; public/js/\*.js           | **OK**      | 0 inline script, 0 inline event handlers                                   |

---

## 2. Кросс-валидация аудит-отчётов

### Отчёт 1: Pre-Deploy Deep Audit (2026-03-02)

| ID    | Severity | Описание                                                                                                        | Статус                                              |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| C1    | CRITICAL | Celery broker/backend всё на Redis DB 0                                                                         | **FIXED**                                           |
| C2    | CRITICAL | Redis allkeys-lru — может выселить данные Celery                                                                | **FIXED**                                           |
| C3    | CRITICAL | CSP frame-src 'none' блокирует epub.js                                                                          | **FIXED**                                           |
| C4    | CRITICAL | Dozzle без аутентификации                                                                                       | **FIXED**                                           |
| C5    | CRITICAL | Legacy NLP проверки в entrypoint.prod.sh                                                                        | **FIXED**                                           |
| H1    | HIGH     | HAWK_TOKEN не передан в backend                                                                                 | **FIXED**                                           |
| H2    | HIGH     | PG без stop_signal/stop_grace_period                                                                            | **FIXED**                                           |
| H3    | HIGH     | PG shared_buffers=8GB (66% от 12GB)                                                                             | **FIXED** → 4GB (33%)                               |
| H4    | HIGH     | PG effective_cache_size=24GB > контейнер 12GB                                                                   | **FIXED** → 8GB                                     |
| H5    | HIGH     | PG max_wal_size по умолчанию 1GB                                                                                | **FIXED** → 4GB                                     |
| H6    | HIGH     | PG effective_io_concurrency=1 (HDD) на NVMe                                                                     | **FIXED** → 200                                     |
| H7    | HIGH     | Мониторинг порты на 0.0.0.0                                                                                     | **FIXED** → 127.0.0.1                               |
| H8    | HIGH     | Непинённые версии образов мониторинга                                                                           | **FIXED**                                           |
| H9    | HIGH     | Caddyfile без HSTS                                                                                              | **FIXED**                                           |
| H10   | HIGH     | Deploy ссылается на docker-compose.production.yml                                                               | **FIXED**                                           |
| M1    | MEDIUM   | Нет Permissions-Policy и COOP                                                                                   | **FIXED**                                           |
| M2    | MEDIUM   | Flower без аутентификации                                                                                       | **FIXED**                                           |
| M3    | MEDIUM   | Нет healthchecks для Caddy/celery-worker/beat                                                                   | **FIXED**                                           |
| M4    | MEDIUM   | Legacy Gemini/Imagen в config.py                                                                                | **NOT FIXED** (deferred — с комментарием)           |
| M5    | MEDIUM   | PG autovacuum не настроен                                                                                       | **FIXED**                                           |
| M6    | MEDIUM   | Deploy ссылается на nginx                                                                                       | **FIXED**                                           |
| M7    | MEDIUM   | health-check + validate ссылаются на несущ. файлы                                                               | **PARTIAL** (verify OK, health-check:264,274 — нет) |
| M8    | MEDIUM   | CI build:unsafe вместо build                                                                                    | **FIXED**                                           |
| M9    | MEDIUM   | Rebrand bookreader → fancai                                                                                     | **NOT FIXED** (plan 04.1-03 deferred)               |
| L1-L8 | LOW      | Конф-файлы, requirements.lite, wget, allowedHosts, entrypoint.sh, логирование, .auto-claude, workflows_disabled | 5 FIXED, 3 deferred                                 |

**Итого R1: 22 FIXED, 1 PARTIAL, 5 NOT FIXED (deferred)**

### Отчёт 2: Deep Verification Audit (2026-03-03)

| ID         | Severity (заявл.) | Описание                                                   | Статус                                                   |
| ---------- | ----------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| BLOCKER-1  | BLOCKER→HIGH      | CSP unsafe-eval/unsafe-inline                              | **FIXED**                                                |
| BLOCKER-2  | BLOCKER→HIGH      | CI versions ≠ production                                   | **FIXED**                                                |
| BLOCKER-3  | BLOCKER→LOW       | VITE_API_URL mismatch                                      | **FIXED**                                                |
| CRIT-1     | CRIT→HIGH         | /users/test-db без auth                                    | **FIXED**                                                |
| CRIT-2     | CRIT→LOW          | HTTPException в service layer                              | **NOT FIXED** (deferred — не крашит Celery)              |
| CRIT-3     | CRIT→MED          | Нет .env.production.example                                | **PARTIAL** (файл создан, но устарел)                    |
| CRIT-4     | CRIT→INFO         | 68 uncommitted deletions                                   | **N/A** (рабочая директория разработчика)                |
| CRIT-5     | CRIT→N/A          | pytest-asyncio==1.3.0 не существует                        | **N/A** (v1.3.0 существует на PyPI, released 2025-11-10) |
| HIGH-1..10 | HIGH              | CSP conflicts, wss://, \_inline_defs, rate limiting и т.д. | 4 FIXED, 6 deferred/N/A                                  |
| MED-1..22  | MEDIUM            | Secrets defaults, sync limit, preload, CSP header и т.д.   | 7 FIXED, 2 PARTIAL, 13 deferred/by-design                |
| LOW-1..15  | LOW               | Token TTL, 404 paths, gunicorn.ctl и т.д.                  | 1 FIXED, 14 deferred                                     |
| NEW-1..2   | LOW               | VITE_API_URL, TS test error                                | 1 FIXED, 1 deferred                                      |

**Итого R2: 26 FIXED, 2 PARTIAL, 25 deferred/by-design, 7 N/A (false positive)**

---

## 3. Новые проблемы

### NEW-1: frontend/public/js/ не закоммичен в git

- **Severity: CRITICAL**
- **Файлы:** frontend/public/js/theme-init.js, frontend/public/js/loading-screen.js
- **Описание:** Git status показывает `?? frontend/public/js/`. Эти файлы загружаются в index.html (строки 224, 240), но отсутствуют в git. В CI и при Docker build на сервере они будут 404.
- **Последствия:** FOUC (белая вспышка перед темой), loading screen висит 5 секунд (fallback timeout). Не JS-ошибки, но деградированный UX.
- **Рекомендация:** `git add frontend/public/js/` и закоммитить.

### NEW-2: CSP connect-src расхождение — Pollinations.ai

- **Severity: HIGH**
- **Файлы:** frontend/index.html:13 vs Caddyfile:50
- **Описание:** Meta-тег содержит `https://image.pollinations.ai` в connect-src, Caddyfile — нет. Браузер применяет ОБА CSP (наиболее строгое объединение). Caddy заблокирует Pollinations.ai.
- **Последствия:** Если `POLLINATIONS_ENABLED=true` (docker-compose.prod.yml:104), генерация изображений через Pollinations не будет работать.
- **Рекомендация:** Добавить `https://image.pollinations.ai` в connect-src Caddyfile.

### NEW-3: .env.production.example критически устарел

- **Severity: CRITICAL**
- **Файл:** .env.production.example
- **Описание:** Файл содержит: `OPENAI_API_KEY` (должен быть `OPENROUTER_API_KEY`), `JWT_SECRET_KEY` (не используется), `GRAFANA_USER/PASSWORD` (должен быть `MONITOR_USER/PASSWORD`), `REACT_APP_*` (Vite → `VITE_*`), `DB_NAME=bookreader_prod`, `VITE_APP_NAME=BookReader AI`. Отсутствуют 15+ обязательных переменных: `HAWK_TOKEN`, `VAPID_*`, `DOMAIN_URL`, `DOMAIN_NAME`, `MONITOR_PASSWORD_HASH`, `CELERY_*` и другие.
- **Рекомендация:** Полностью переписать файл на основе docker-compose.prod.yml.

### NEW-4: Caddy не может проксировать к мониторингу

- **Severity: CRITICAL (мониторинг)**
- **Файлы:** Caddyfile:69-92, docker-compose.monitoring.yml
- **Описание:** Caddy в bridge-сети `fancai_network` использует `reverse_proxy localhost:PORT`. Но localhost внутри контейнера Caddy — это сам контейнер. Мониторинг-сервисы в `monitoring_net`, Netdata на host network. Caddy не в `monitoring_net` → connection refused.
- **Последствия:** `monitor.fancai.ru` не работает. Все мониторинг-дашборды недоступны через Caddy.
- **Рекомендация:** Добавить Caddy в `monitoring_net` и использовать DNS-имена контейнеров (`reverse_proxy victoriametrics:8428`) вместо localhost.
- **Примечание:** Не блокирует деплой основного приложения — мониторинг запускается отдельным compose файлом.

### NEW-5: PG work_mem × max_connections может превысить лимит контейнера

- **Severity: HIGH**
- **Файл:** docker-compose.prod.yml:253,261
- **Описание:** work_mem=64MB × max_connections=150 = 9.6GB worst case + shared_buffers=4GB = 13.6GB > mem_limit=12GB. При массовых сложных запросах PostgreSQL может получить OOM.
- **Последствия:** OOM killer убьёт PostgreSQL при высокой нагрузке с множеством параллельных запросов с сортировкой/хешированием.
- **Рекомендация:** Снизить work_mem до 32MB (worst case: 32×150+4=8.8GB < 12GB) или max_connections до 100 (64×100+4=10.4GB < 12GB).

### NEW-6: Backend SecurityHeadersMiddleware CSP расходится с Caddy

- **Severity: MEDIUM**
- **Файл:** backend/app/middleware/security_headers.py:82-125
- **Описание:** Backend ставит свой CSP на ВСЕ ответы с Google APIs, `ws://localhost:*`, `frame-ancestors: 'none'`. Для JSON API это неактуально (браузер игнорирует), но создаёт мёртвый код и потенциальную путаницу.
- **Рекомендация:** Отключить CSP в backend middleware (Caddy — единственный источник CSP для SPA).

### NEW-7: record_llm_request не вызывается при ошибке в dedup-сервисе

- **Severity: MEDIUM**
- **Файл:** backend/app/services/entity_deduplication_service.py:127
- **Описание:** На error path вызывается только `record_llm_error()`, но не `record_llm_request(..., status="error", duration)`. Для сравнения — openrouter_client.py:268-271 вызывает оба. Это делает метрики error rate неточными (неполный знаменатель).
- **Рекомендация:** Добавить `record_llm_request("openrouter-dedup", "error", duration)` рядом с record_llm_error.

### NEW-8: int(content_length) без обработки ValueError

- **Severity: LOW**
- **Файл:** backend/app/routers/sync.py:233
- **Описание:** Если Content-Length = "abc", `int(content_length)` бросит ValueError. Ловится общим `except Exception` → HTTP 500 вместо 400.
- **Рекомендация:** Обернуть в try/except ValueError: pass (fallback на len(body) check).

### NEW-9: fetchWithTokenRefresh.ts использует localStorage

- **Severity: LOW**
- **Файл:** frontend/src/utils/fetchWithTokenRefresh.ts:31-43
- **Описание:** Читает refresh_token из localStorage, но cookie-based auth не заполняет localStorage. При 401 retry рефреш не сработает.
- **Последствия:** Изображения, загружаемые через эту утилиту, не смогут обновить токен после 401.
- **Рекомендация:** Использовать cookie-based refresh (POST /auth/refresh без body).

### NEW-10 (pre-existing): sendBeacon batch sync не аутентифицируется

- **Severity: CRITICAL (pre-existing)**
- **Файлы:** frontend/src/services/syncQueue.ts:282-285; backend/app/routers/sync.py:259
- **Описание:** Frontend отправляет sendBeacon без token в payload. Backend ожидает `data.get("token")` → всегда None → "Authentication required". Вся batch-синхронизация через sendBeacon не работает.
- **Примечание:** Это НЕ результат наших правок — проблема существовала до обеих сессий.

---

## 4. Системный обзор

### 4.1 Docker-архитектура

**Статус: OK (с оговоркой)**

Цепочка запуска корректна:

```
tini (PID 1, init: true)
  → /app/entrypoint.prod.sh (валидация env, startup log)
    → exec "$@" (замена shell-процесса)
      → gunicorn -c gunicorn.conf.py app.main:app
```

- ENTRYPOINT + CMD в exec form — правильная комбинация
- gunicorn.conf.py — единственный источник конфигурации, конфликтов нет
- entrypoint.prod.sh: set -euo pipefail, валидация DATABASE_URL/REDIS_URL/SECRET_KEY
- Celery worker и beat: command override в compose, но ENTRYPOINT всё равно запускается
- **Оговорка:** celery-beat без init: true (inconsistent)

### 4.2 CSP полная цепочка

**Статус: ISSUE**

| Источник              | Применяется к                  | Кто побеждает                    |
| --------------------- | ------------------------------ | -------------------------------- |
| Meta-тег (index.html) | SPA HTML                       | Всегда (в HTML)                  |
| Caddy Header          | SPA HTML (через reverse_proxy) | Оба — intersection               |
| Backend Middleware    | API JSON ответы                | Игнорируется браузером для fetch |

- При online: meta + Caddy = intersection → Caddy блокирует pollinations.ai
- При offline (SW cache): только meta → pollinations.ai разрешён
- Backend CSP на JSON — мёртвый код (браузер применяет CSP только к document responses)

### 4.3 Redis разделение DB

**Статус: OK (production)**

| DB  | Назначение                             | Где настроено              |
| --- | -------------------------------------- | -------------------------- |
| 0   | Application cache (REDIS_URL)          | docker-compose.prod.yml:87 |
| 1   | Celery broker (CELERY_BROKER_URL)      | docker-compose.prod.yml:88 |
| 2   | Celery results (CELERY_RESULT_BACKEND) | docker-compose.prod.yml:89 |

- volatile-lru в обоих compose файлах — защищает Celery данные от выселения
- REDIS_MAX_CONNECTIONS=50 — достаточно для 2 gunicorn workers + Celery
- **Dev:** всё на DB 0 (CELERY_BROKER_URL и CELERY_RESULT_BACKEND не заданы)

### 4.4 PostgreSQL tuning

**Статус: WARNING**

| Параметр                 | Значение | Анализ                                                              |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| shared_buffers           | 4GB      | 33% от 12GB — в допустимом диапазоне (25-40%)                       |
| effective_cache_size     | 8GB      | 12GB - 4GB = 8GB — корректно                                        |
| work_mem                 | 64MB     | 64MB × 150 connections = 9.6GB worst case + 4GB = 13.6GB **> 12GB** |
| max_connections          | 150      | С work_mem 64MB — рискованно                                        |
| maintenance_work_mem     | 1GB      | OK                                                                  |
| max_wal_size             | 4GB      | OK для moderate writes                                              |
| effective_io_concurrency | 200      | Корректно для NVMe                                                  |
| random_page_cost         | 1.1      | Корректно для SSD                                                   |
| shm_size                 | 10g      | Достаточно для shared_buffers 4GB                                   |

### 4.5 Мониторинг

**Статус: CRITICAL (сетевая связность)**

- Все порты на 127.0.0.1 — OK
- Все image versions запинены — OK
- Flower: --basic-auth + Caddy basic_auth = двойная аутентификация (не критично)
- Netdata: network_mode: host — видит хост-метрики и Docker socket
- **CRITICAL:** Caddy в bridge `fancai_network`, мониторинг в `monitoring_net` → `localhost` в Caddyfile не резолвится к мониторинг-контейнерам

### 4.6 CI/CD

**Статус: WARNING**

- `npm run build` (не build:unsafe) — корректно, TS проверки перед сборкой
- **WARNING:** `frontend/public/js/` не в git → 404 в CI build
- Docker build job запускается только на PR — OK
- E2E тесты: Playwright с `PLAYWRIGHT_BASE_URL: http://localhost:5173` — нет запущенного dev server в CI job (нужна проверка playwright.config.ts на webServer directive)

---

## 5. Оставшийся техдолг

### Обязательно перед деплоем

| #   | Проблема                                                         | Сложность | Время |
| --- | ---------------------------------------------------------------- | --------- | ----- |
| 1   | `git add frontend/public/js/`                                    | Trivial   | 1 мин |
| 2   | Добавить `https://image.pollinations.ai` в connect-src Caddyfile | Trivial   | 2 мин |
| 3   | Снизить work_mem до 32MB или max_connections до 100              | Trivial   | 2 мин |

### Рекомендовано до деплоя

| #   | Проблема                                     | Сложность | Время  |
| --- | -------------------------------------------- | --------- | ------ |
| 4   | Полностью переписать .env.production.example | Средняя   | 15 мин |
| 5   | Добавить init: true для celery-beat          | Trivial   | 1 мин  |
| 6   | Обернуть int(content_length) в try/except    | Trivial   | 2 мин  |

### Рекомендовано после деплоя

| #   | Проблема                                                                 | Сложность | Время  |
| --- | ------------------------------------------------------------------------ | --------- | ------ |
| 7   | Исправить Caddy monitoring proxy (сети Docker)                           | Средняя   | 20 мин |
| 8   | Отключить CSP в backend SecurityHeadersMiddleware                        | Лёгкая    | 5 мин  |
| 9   | Добавить record_llm_request на error path в dedup                        | Лёгкая    | 5 мин  |
| 10  | Обновить fetchWithTokenRefresh.ts на cookie-based                        | Средняя   | 15 мин |
| 11  | infrastructure-health-check.sh:264,274 → docker-compose.dev.yml          | Trivial   | 2 мин  |
| 12  | reading_sessions.py:535,729 — except ValueError as e → except ValueError | Trivial   | 2 мин  |
| 13  | Dev compose: добавить CELERY_BROKER_URL/RESULT_BACKEND с DB 1/2          | Лёгкая    | 5 мин  |
| 14  | /api/v1/info — скрыть docs при DEBUG=False                               | Trivial   | 2 мин  |

### Известный отложенный техдолг

| #   | Проблема                                                   | Статус                                       |
| --- | ---------------------------------------------------------- | -------------------------------------------- |
| 15  | Rebrand bookreader → fancai (1332 упоминания в 168 файлах) | Plan 04.1-03 deferred                        |
| 16  | Legacy OPENAI_API_KEY/MIDJOURNEY_API_KEY в config.py       | Deferred (с комментарием)                    |
| 17  | Test dependencies в production requirements.txt (+50MB)    | Deferred                                     |
| 18  | Caddy rate limiting                                        | Deferred (backend Redis-based limiting есть) |
| 19  | sendBeacon batch sync без аутентификации (pre-existing)    | Deferred (не результат наших правок)         |
| 20  | epub.js 0.3.93 unmaintained                                | Known risk accepted                          |

---

## 6. Go/No-Go вердикт

### GO — с 3 обязательными фиксами перед деплоем

**Основное приложение готово к деплою.** Все 5 оригинальных CRITICAL и 3 BLOCKER-находок исправлены. Redis DB разделён, CSP корректен для epub.js, все порты мониторинга на 127.0.0.1, gunicorn правильно настроен.

**Перед деплоем (5 минут работы):**

1. `git add frontend/public/js/ && git commit` — без этого theme-init.js и loading-screen.js будут 404
2. Добавить `https://image.pollinations.ai` в connect-src в Caddyfile — без этого генерация изображений через Pollinations будет заблокирована CSP
3. Снизить `work_mem` до 32MB в docker-compose.prod.yml — предотвращает потенциальный OOM PostgreSQL

**После деплоя (приоритетно):**

4. Полностью переписать `.env.production.example`
5. Исправить Caddy → мониторинг сетевую связность (отдельный compose)
6. Добавить `init: true` для celery-beat

**Оценка рисков:**

- **Основное приложение (fancai.ru):** После 3 фиксов — безопасно для деплоя
- **Мониторинг (monitor.fancai.ru):** Не будет работать через Caddy до исправления Docker-сетей — можно деплоить мониторинг позже
- **sendBeacon sync:** Pre-existing баг, не регрессия — батч-синхронизация при закрытии страницы не работает, но обычная синхронизация через API работает
