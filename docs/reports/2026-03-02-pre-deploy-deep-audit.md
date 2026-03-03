# Глубокий аудит кодовой базы и инфраструктуры fancai

**Дата:** 2026-03-02
**Scope:** Полный pre-deploy аудит (фазы 1–4.1, инфраструктура, безопасность)
**Автор:** Claude Opus 4.6
**Файлов проанализировано:** 60+
**Строк кода проверено:** ~15 000

---

## Executive Summary

Проект fancai в целом **готов к production-деплою** после устранения 5 критических и 10 высокоприоритетных проблем. Все 4 основные фазы (безопасность, очистка, миграция, инфраструктура) успешно завершены с высоким качеством реализации. AI-сервисы полностью мигрированы на OpenRouter, PyJWT заменил python-jose, мониторинг через Hawk Tracker настроен. Однако обнаружены **2 критические проблемы в конфигурации Celery/Redis** (broker использует ту же Redis DB, что и cache), **1 критическая CSP-проблема** (frame-src блокирует epub.js), проблемы с безопасностью мониторинга и несколько устаревших файлов.

**Общая оценка: 85% готовности.** Блокирующие проблемы — типовые конфигурационные фиксы, не требующие архитектурных изменений.

---

## Верификация выполненных фаз

### Phase 1: Безопасность продакшена

**Статус:** ✅ Выполнена полностью

| Критерий                                       | Статус | Доказательство                                                                                 |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| DEBUG=False по умолчанию                       | ✅     | `config.py:19-21` — `DEBUG: bool = False`                                                      |
| validate_production_settings блокирует запуск  | ✅     | `config.py:149-188` — model_validator проверяет SECRET_KEY, DATABASE_URL, REDIS_URL            |
| PyJWT вместо python-jose                       | ✅     | `requirements.txt:6` — `PyJWT[crypto]==2.10.1`. Grep по всему backend: python-jose отсутствует |
| Health check реально проверяет PG/Redis/Celery | ✅     | `healthcheck.py` вызывает `/health`, ожидает `status == 'healthy'`                             |
| Hawk Tracker в backend + celery                | ✅     | `main.py:91-95` — init_hawk(app), `celery_app.py:92-95` — init_hawk_celery()                   |
| Gunicorn + UvicornWorker                       | ✅     | `gunicorn.conf.py:15` — `worker_class = "uvicorn.workers.UvicornWorker"`                       |
| Celery visibility_timeout > time_limit         | ✅     | `celery_app.py:42-44` — 14400 > 1800 ✓                                                         |
| PG 17.9-alpine                                 | ✅     | `docker-compose.prod.yml:221` — `postgres:17.9-alpine`                                         |
| Memory limits единообразны                     | ✅     | `celery_app.py:29-31` — 512MB unified                                                          |

### Phase 2: Очистка мёртвого кода

**Статус:** ✅ Выполнена полностью

| Критерий                               | Статус | Доказательство                                                    |
| -------------------------------------- | ------ | ----------------------------------------------------------------- |
| Нет celery_config.py                   | ✅     | Grep по всему проекту: 0 совпадений                               |
| Нет NLP-полей в config.py              | ✅     | config.py не содержит SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE |
| sync endpoint возвращает 501           | ✅     | `sync.py:301,308,314` — три 501-заглушки                          |
| 14 осиротевших тестовых файлов удалены | ✅     | Нет test\_\*.py в корне backend/                                  |

### Phase 3: Миграция сервисов

**Статус:** ✅ Выполнена полностью

| Критерий                                | Статус | Доказательство                                                                                                                                      |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Все 5 AI-сервисов на OpenRouter         | ✅     | gemini_extractor, entity_deduplication_service, consistency_manager, entity_synthesis, imagen_generator — все импортируют `get_openrouter_client()` |
| google-genai удалён из requirements.txt | ✅     | Grep: 0 совпадений. **НО:** `requirements.lite.txt:33` всё ещё содержит `google-genai==1.61.0` (мёртвый файл)                                       |
| Fallback chain корректен                | ✅     | `openrouter_client.py:49-53` — Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite                                                            |
| FLUX.2 Klein для изображений            | ✅     | `openrouter_client.py:58` — `DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"`                                                             |
| Caddy вместо nginx                      | ✅     | `docker-compose.prod.yml:24` — `caddy:2.11.1-alpine`. Нет nginx-контейнеров в compose                                                               |
| Rate limiting по user ID                | ✅     | `rate_limit.py:94-144` — Redis-based sliding window                                                                                                 |

### Phase 4: Обслуживание инфраструктуры

**Статус:** ✅ Выполнена полностью

| Критерий                     | Статус      | Доказательство                                                                                       |
| ---------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 5 Prometheus counters        | ✅          | `metrics.py:400-432` — llm_cost, llm_fallback, auth_registrations, auth_logins, rate_limit_triggered |
| llm_usage_log модель         | ✅          | Alembic миграция + SQLAlchemy модель `LlmUsageLog`                                                   |
| Мониторинг-стек (5 сервисов) | ✅          | `docker-compose.monitoring.yml` — Netdata, VictoriaMetrics, Uptime Kuma, Dozzle, Flower              |
| PG тюнинг для 32GB           | ✅          | `docker-compose.prod.yml:231-245` — shared_buffers, work_mem, wal_compression и т.д.                 |
| Docker images зафиксированы  | ⚠️ Частично | Prod: ✅ все pinned. Monitoring: ❌ Netdata/VictoriaMetrics используют `:stable` тег                 |

### Phase 4.1: Интеграция и ребрендинг

**Статус:** ⚠️ 2/3 планов завершены (план 04.1-03 не начат)

| Критерий                                   | Статус      | Доказательство                                                                               |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| fancai_network в prod.yml и monitoring.yml | ✅          | `docker-compose.prod.yml:306` — `fancai_network`, monitoring.yml line 127 — `external: true` |
| Мёртвые env vars удалены из compose        | ✅          | LANGEXTRACT\_\*, GOOGLE_API_KEY отсутствуют в docker-compose файлах                          |
| HAWK_TOKEN в celery-worker и celery-beat   | ✅          | `docker-compose.prod.yml:153,201`                                                            |
| Ребрендинг bookreader → fancai в Docker    | ✅          | Контейнеры: fancai\__, образы: fancai-_, сеть: fancai_network                                |
| Ребрендинг в документации/скриптах         | ❌ Не начат | 100+ совпадений `bookreader` в .md, .conf, .sh файлах (план 04.1-03)                         |

---

## Верификация server-setup-plan.md

### Подтверждённые находки

| #      | Находка                                       | Подтверждение                                                                                                                                                                                |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2** | Celery игнорирует CELERY_BROKER_URL env       | ✅ **ПОДТВЕРЖДЕНО.** `celery_app.py:13-14` использует `settings.REDIS_URL`. Grep по всему backend: 0 совпадений `CELERY_BROKER_URL`. Env vars из compose (db 1, db 2) полностью игнорируются |
| **C3** | Redis allkeys-lru + shared db                 | ✅ **ПОДТВЕРЖДЕНО.** `docker-compose.prod.yml:272` — `--maxmemory-policy allkeys-lru`. Celery broker на db 0 = cache                                                                         |
| **C4** | effective_cache_size=24GB при контейнере 12GB | ✅ **ПОДТВЕРЖДЕНО.** `docker-compose.prod.yml:233` — hint превышает реальную память контейнера                                                                                               |
| **C5** | Нет max_wal_size                              | ✅ **ПОДТВЕРЖДЕНО.** Строки 230-245 — max_wal_size отсутствует. Дефолт 1GB мал для 8GB shared_buffers                                                                                        |
| **H1** | shared_buffers=8GB = 66% от 12GB контейнера   | ✅ **ПОДТВЕРЖДЕНО.** `docker-compose.prod.yml:232,262` — 8GB / 12G limit = 66.7%                                                                                                             |
| **H2** | Нет effective_io_concurrency                  | ✅ **ПОДТВЕРЖДЕНО.** Отсутствует в PG command section                                                                                                                                        |
| **H6** | redis.conf (411 строк) не монтируется         | ✅ **ПОДТВЕРЖДЕНО.** `redis/redis.conf` существует (411 строк), но не подключён ни в одном compose-файле                                                                                     |
| **H8** | Docker NAT обходит nftables                   | ✅ **ПОДТВЕРЖДЕНО.** Порты 80/443 биндятся через Docker NAT                                                                                                                                  |
| **H9** | Нет HSTS в Caddyfile                          | ✅ **ПОДТВЕРЖДЕНО.** Strict-Transport-Security отсутствует в Caddyfile                                                                                                                       |

### Опровергнутые или уточнённые

| #      | Находка из отчёта                       | Реальность                                                                                                                                                         |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C6** | PG mem_limit=12GB + HugePages=try → OOM | ⚠️ **ЧАСТИЧНО.** huge_pages=try (не =on) — PG попробует, но не упадёт без HugePages. Риск OOM от work_mem более реален: 64MB \* 100 connections = 6.4GB worst case |
| **H3** | shutdown-timeout:30 в daemon.json       | ❓ **НЕ ВЕРИФИЦИРУЕМО** из кодовой базы (это серверная настройка Docker daemon, не в репозитории)                                                                  |
| **H4** | MaxSessions 3 в SSH                     | ❓ **НЕ ВЕРИФИЦИРУЕМО** — серверная конфигурация                                                                                                                   |

### Пропущенные проблемы (отчёт НЕ нашёл)

| #         | Проблема                                              | Детали                                                                                                                                                                                       |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NEW-1** | HAWK_TOKEN отсутствует в backend service              | `docker-compose.prod.yml:77-107` — HAWK_TOKEN есть в celery-worker (строка 153) и celery-beat (строка 201), но **отсутствует** в backend service. Hawk Tracker для FastAPI не будет работать |
| **NEW-2** | CSP frame-src 'none' блокирует epub.js                | `frontend/index.html:13` — `frame-src 'none'` заблокирует iframe-рендеринг epub.js                                                                                                           |
| **NEW-3** | Legacy NLP-проверки в entrypoint.prod.sh              | `entrypoint.prod.sh:71-116` — проверяет SpaCy/Stanza/Natasha, удалённые в Dec 2025                                                                                                           |
| **NEW-4** | deploy-production.sh ссылается на несуществующий файл | `scripts/deploy-production.sh:10` — `docker-compose.production.yml` (реально `docker-compose.prod.yml`)                                                                                      |
| **NEW-5** | deploy-production.sh ссылается на nginx               | `scripts/deploy-production.sh:173` — `docker pull nginx` (проект использует Caddy)                                                                                                           |
| **NEW-6** | Dozzle без аутентификации                             | `docker-compose.monitoring.yml:85` — `DOZZLE_AUTH_PROVIDER: none`. Логи всех контейнеров (включая секреты) доступны без пароля                                                               |
| **NEW-7** | Flower без пароля                                     | `docker-compose.monitoring.yml:94-101` — нет аутентификации. Celery broker URL с паролем виден в UI                                                                                          |
| **NEW-8** | Мониторинг-порты на 0.0.0.0                           | Порты 8428, 3001, 8080, 5555 доступны с любого IP (обходятся через Caddy basicauth на monitor.fancai.ru, но прямой доступ к портам открыт)                                                   |

---

## Реестр проблем

### CRITICAL (блокируют деплой)

| #   | Проблема                                                                                                                                                    | Файл(ы)                                                     | Рекомендуемый фикс                                                                                                                                                                                       | Сложность |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| C1  | **Celery broker/backend игнорирует CELERY_BROKER_URL/CELERY_RESULT_BACKEND env vars** — все 3 Redis-сервиса (cache, broker, results) работают на одной DB 0 | `celery_app.py:13-14`                                       | Заменить `broker=settings.REDIS_URL` на `broker=os.getenv('CELERY_BROKER_URL', settings.REDIS_URL)` и аналогично для backend. Добавить `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` в config.py Settings | 15 мин    |
| C2  | **Redis maxmemory-policy allkeys-lru** — может удалить Celery task данные при нехватке памяти (особенно опасно совместно с C1)                              | `docker-compose.prod.yml:272`, `docker-compose.dev.yml:237` | Заменить `--maxmemory-policy allkeys-lru` → `--maxmemory-policy volatile-lru` в обоих файлах                                                                                                             | 2 мин     |
| C3  | **CSP frame-src 'none'** — блокирует iframe-рендеринг epub.js, ломает основную функциональность приложения                                                  | `frontend/index.html:13`                                    | Заменить `frame-src 'none'` → `frame-src 'self' blob:`                                                                                                                                                   | 1 мин     |
| C4  | **Dozzle без аутентификации** — логи всех контейнеров (включая API-ключи, пароли в логах) доступны без авторизации                                          | `docker-compose.monitoring.yml:85`                          | Заменить `DOZZLE_AUTH_PROVIDER: none` → `simple`, добавить `DOZZLE_SIMPLE_USERNAME` и `DOZZLE_SIMPLE_PASSWORD`                                                                                           | 5 мин     |
| C5  | **Legacy NLP-проверки в entrypoint.prod.sh** — проверяет SpaCy/Stanza/Natasha, которые удалены в Dec 2025. Создаёт confusing WARNING-логи при старте        | `backend/entrypoint.prod.sh:71-116`                         | Удалить секцию целиком или заменить на: `echo "✅ Using OpenRouter LLM — no local NLP models required"`                                                                                                  | 5 мин     |

### HIGH (исправить до деплоя или в первую неделю)

| #   | Проблема                                                                                                   | Файл(ы)                                        | Рекомендуемый фикс                                                                        | Сложность |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| H1  | **HAWK_TOKEN отсутствует в backend service** — Hawk Tracker работает для Celery, но не для FastAPI API     | `docker-compose.prod.yml:77-107`               | Добавить `- HAWK_TOKEN=${HAWK_TOKEN:-}` в environment секцию backend service              | 1 мин     |
| H2  | **PG missing stop_signal/stop_grace_period** — Docker SIGTERM → 10s → SIGKILL. Может повредить WAL         | `docker-compose.prod.yml:220`                  | Добавить `stop_signal: SIGINT` + `stop_grace_period: 60s` после restart                   | 2 мин     |
| H3  | **PG shared_buffers=8GB при контейнере 12GB (66%)** — рекомендуется 25-40% от контейнера                   | `docker-compose.prod.yml:232,262`              | Уменьшить `shared_buffers=4GB` ИЛИ увеличить mem_limit до 20GB                            | 5 мин     |
| H4  | **PG effective_cache_size=24GB > контейнер 12GB** — query planner получает неверные данные                 | `docker-compose.prod.yml:233`                  | Заменить `effective_cache_size=24GB` → `effective_cache_size=8GB` (12GB - shared_buffers) | 1 мин     |
| H5  | **PG missing max_wal_size** — дефолт 1GB вызывает частые checkpoints при 8GB shared_buffers                | `docker-compose.prod.yml:230-245`              | Добавить `-c max_wal_size=4GB`                                                            | 1 мин     |
| H6  | **PG missing effective_io_concurrency** — дефолт 1 (HDD), должен быть 200 для NVMe                         | `docker-compose.prod.yml:230-245`              | Добавить `-c effective_io_concurrency=200`                                                | 1 мин     |
| H7  | **Мониторинг-порты биндятся на 0.0.0.0** — прямой доступ к мониторинг-сервисам в обход Caddy basicauth     | `docker-compose.monitoring.yml:44,64,80,105`   | Заменить на `127.0.0.1:PORT:PORT` для всех 4 сервисов                                     | 5 мин     |
| H8  | **Unpinned monitoring image versions** — `:stable` для Netdata/VictoriaMetrics может сломать совместимость | `docker-compose.monitoring.yml:10,40,60,76,95` | Зафиксировать конкретные patch-версии                                                     | 10 мин    |
| H9  | **Caddyfile: отсутствует HSTS header** — нет Strict-Transport-Security                                     | `Caddyfile:48-54`                              | Добавить `Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"`       | 2 мин     |
| H10 | **deploy-production.sh ссылается на несуществующий docker-compose.production.yml**                         | `scripts/deploy-production.sh:10`              | Заменить `docker-compose.production.yml` → `docker-compose.prod.yml`                      | 1 мин     |

### MEDIUM (исправить в первый месяц)

| #   | Проблема                                                                                           | Файл(ы)                                                                                   | Рекомендуемый фикс                                                                                                                | Сложность |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| M1  | **Caddyfile: отсутствуют Permissions-Policy и COOP** — defense-in-depth                            | `Caddyfile`                                                                               | Добавить `Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()"` и `Cross-Origin-Opener-Policy "same-origin"` | 2 мин     |
| M2  | **Flower без аутентификации** — Celery broker URL с Redis-паролем виден в UI                       | `docker-compose.monitoring.yml:94-101`                                                    | Добавить `FLOWER_BASIC_AUTH=admin:${FLOWER_PASSWORD}`                                                                             | 3 мин     |
| M3  | **Missing healthchecks** для Caddy, Celery-worker, Celery-beat                                     | `docker-compose.prod.yml:23,134,184`                                                      | Добавить healthcheck блоки                                                                                                        | 10 мин    |
| M4  | **Legacy Gemini/Imagen/OpenAI settings в config.py** — не используются, но загрязняют конфигурацию | `config.py:65-80`                                                                         | Пометить как deprecated или удалить (GEMINI*MODEL, IMAGEN*\*, OPENAI_API_KEY, MIDJOURNEY_API_KEY)                                 | 5 мин     |
| M5  | **PG: отсутствует autovacuum tuning** — default autovacuum_vacuum_cost_limit=200 мал для NVMe      | `docker-compose.prod.yml:230-245`                                                         | Добавить `-c autovacuum_vacuum_cost_limit=2000`                                                                                   | 1 мин     |
| M6  | **deploy-production.sh ссылается на nginx** (pull image, ssl dirs)                                 | `scripts/deploy-production.sh:83,173`                                                     | Удалить nginx-ссылки, обновить на Caddy                                                                                           | 10 мин    |
| M7  | **validate-infrastructure.sh и health-check.sh ссылаются на несуществующие файлы**                 | `scripts/validate-infrastructure.sh:109-113`, `scripts/infrastructure-health-check.sh:52` | Обновить на актуальные workflow и compose файлы                                                                                   | 10 мин    |
| M8  | **CI: build:unsafe вместо build** — пропускает type-checking                                       | `.github/workflows/ci.yml:217`                                                            | Заменить `npm run build:unsafe` → `npm run build`                                                                                 | 1 мин     |
| M9  | **Ребрендинг bookreader → fancai** не завершён в документации/скриптах                             | 30+ файлов (docs/, scripts/README, \*.conf)                                               | Выполнить план 04.1-03                                                                                                            | 2ч        |

### LOW (желательно)

| #   | Проблема                                                                              | Файл(ы)                                        | Рекомендуемый фикс                                                    | Сложность |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | --------- |
| L1  | **redis.conf (411 строк) и postgresql.conf (408 строк)** не используются, мёртвый код | `redis/redis.conf`, `postgres/postgresql.conf` | Удалить или задокументировать как reference                           | 5 мин     |
| L2  | **requirements.lite.txt** содержит google-genai, устаревший                           | `backend/requirements.lite.txt`                | Удалить (requirements.txt — актуальный)                               | 1 мин     |
| L3  | **Frontend healthcheck использует wget вместо curl** — несогласованность с backend    | `frontend/Dockerfile.dev:33`                   | Заменить wget на curl -f                                              | 2 мин     |
| L4  | **Vite allowedHosts: true** — отключает проверку хостов                               | `frontend/vite.config.ts:72`                   | Заменить на whitelist конкретных доменов                              | 5 мин     |
| L5  | **frontend/entrypoint.sh** — legacy nginx entrypoint, не используется                 | `frontend/entrypoint.sh`                       | Удалить                                                               | 1 мин     |
| L6  | **Caddy: нет явного логирования** — полагается на Docker stdout                       | `Caddyfile`                                    | Добавить `log { output file ... roll_size 100mb }` если нужна ротация | 5 мин     |
| L7  | **.auto-claude/** — 50+ файлов от стороннего инструмента                              | `.auto-claude/`                                | Удалить если не используется                                          | 1 мин     |
| L8  | **.github/workflows_disabled/** — отключённые workflows                               | `.github/workflows_disabled/`                  | Удалить если не планируется возвращение                               | 1 мин     |

---

## Legacy / Мёртвый код

### Файлы для удаления

| Файл                            | Обоснование                                                  | Риск                      |
| ------------------------------- | ------------------------------------------------------------ | ------------------------- |
| `frontend/nginx.conf`           | Legacy dev nginx, заменён Caddy                              | Нулевой — не используется |
| `frontend/nginx.prod.conf`      | Legacy prod nginx, заменён Caddy                             | Нулевой — не используется |
| `frontend/entrypoint.sh`        | Legacy nginx entrypoint, не подключён в compose              | Нулевой                   |
| `backend/requirements.lite.txt` | Содержит google-genai, заменён requirements.txt              | Нулевой                   |
| `logrotate/logrotate.conf`      | Ссылается на bookreader\_\* контейнеры, не подключён         | Нулевой                   |
| `redis/redis.conf`              | 411 строк, не монтируется ни в одном compose                 | Нулевой                   |
| `postgres/postgresql.conf`      | 408 строк, PG конфигурируется через command в compose        | Нулевой                   |
| `.auto-claude/`                 | Стороннее расширение, 50+ файлов, не используется в workflow | Низкий                    |
| `.github/workflows_disabled/`   | 4 отключённых workflow + README                              | Низкий                    |

### Файлы с bookreader-ссылками (требуют ребрендинга)

| Категория            | Файлы                                                                 | Примерное кол-во совпадений |
| -------------------- | --------------------------------------------------------------------- | --------------------------- |
| Документация backend | SECURITY.md, PERFORMANCE_ACTION_PLAN.md, alembic/README_MIGRATIONS.md | ~30                         |
| Документация корня   | README.md, README-ru.md, CONTRIBUTING.md                              | ~10                         |
| Конфигурации         | .pre-commit-config.yaml, postgres/README.md, redis/README.md          | ~30                         |
| Скрипты              | scripts/README_BACKUP.md                                              | ~40                         |
| Отчёты               | docs/reports/_.md, docs/ru/refactoring/_.md                           | ~20                         |
| Deploy skill         | .claude/skills/deploy/SKILL.md:36                                     | 1                           |

---

## Best Practices 2026

### Docker Compose V2

- ✅ Используется `docker compose` (без дефиса)
- ✅ deploy.resources.limits для всех сервисов
- ⚠️ Нет profiles для dev/prod разделения (не критично при отдельных файлах)

### Caddy 2.11.1

- ✅ Auto-HTTPS (Let's Encrypt)
- ✅ HTTP/3 (QUIC) — порт 443/udp
- ✅ Server header removed
- ❌ Нет HSTS (добавить)
- ❌ Нет Permissions-Policy (добавить)
- ❌ Нет COOP (добавить)

### PostgreSQL 17.9

- ✅ wal_compression=zstd (PG 17 feature)
- ✅ random_page_cost=1.1 для NVMe
- ✅ max_parallel_workers_per_gather=4
- ❌ Нет max_wal_size (добавить 4GB)
- ❌ Нет effective_io_concurrency (добавить 200)
- ❌ effective_cache_size завышен (24GB → 8GB)
- ❌ shared_buffers завышен для контейнера (8GB/12GB = 66%)

### Redis 7.4.8

- ✅ appendonly yes (persistence)
- ✅ requirepass (auth)
- ❌ allkeys-lru → volatile-lru
- ❌ redis.conf не используется

### React 19 + TypeScript 5.7 + Vite 7

- ✅ Актуальные версии
- ✅ Lazy loading / code splitting
- ✅ PWA с injectManifest
- ✅ TanStack Query (нет прямых fetch)
- ⚠️ CSP frame-src 'none' (CRITICAL fix)

### Celery 5.6.2

- ✅ worker_soft_shutdown_timeout=120 (5.6 feature)
- ✅ task_track_started=True
- ✅ task_acks_late + task_reject_on_worker_lost
- ❌ Broker не использует отдельную Redis DB (fix C1)

### FastAPI 0.135

- ✅ CORS корректно ограничен
- ✅ Rate limiting через Redis
- ✅ Prometheus Instrumentator
- ✅ SecurityHeadersMiddleware
- ✅ Hawk Tracker integration

### Python 3.12

- ✅ Dockerfile использует python:3.12-slim (актуальная ветка)
- ⚠️ Рассмотреть обновление до Python 3.13 (perf improvements) в будущей фазе

---

## Checklist готовности к деплою

### Блокирующие (CRITICAL)

- [ ] **C1:** Celery broker URL fix — celery_app.py должен читать CELERY_BROKER_URL/CELERY_RESULT_BACKEND env vars
- [ ] **C2:** Redis eviction policy — allkeys-lru → volatile-lru в prod и dev compose
- [ ] **C3:** CSP frame-src fix — 'none' → 'self' blob: в index.html
- [ ] **C4:** Dozzle authentication — включить simple auth с паролем
- [ ] **C5:** entrypoint.prod.sh — удалить NLP model checks

### Высокоприоритетные (HIGH — до деплоя)

- [ ] **H1:** HAWK_TOKEN в backend service compose
- [ ] **H2:** PG stop_signal + stop_grace_period
- [ ] **H3-H6:** PG tuning (shared_buffers, effective_cache_size, max_wal_size, effective_io_concurrency)
- [ ] **H7:** Monitoring ports → 127.0.0.1
- [ ] **H8:** Pin monitoring image versions
- [ ] **H9:** HSTS header в Caddyfile
- [ ] **H10:** deploy-production.sh → docker-compose.prod.yml

### Среднеприоритетные (MEDIUM — первый месяц)

- [ ] Permissions-Policy и COOP в Caddyfile
- [ ] Flower authentication
- [ ] Healthchecks для Caddy/Celery
- [ ] Legacy settings cleanup в config.py
- [ ] PG autovacuum tuning
- [ ] Scripts ребрендинг (deploy-production.sh, validate, health-check)
- [ ] CI build:unsafe → build
- [ ] Завершить план 04.1-03 (ребрендинг bookreader → fancai)

### Низкоприоритетные (LOW — желательно)

- [ ] Удалить legacy файлы (nginx.conf, requirements.lite.txt, redis.conf, postgresql.conf)
- [ ] Удалить .auto-claude/, workflows_disabled/
- [ ] Caddy logging с ротацией
- [ ] Vite allowedHosts whitelist
- [ ] Frontend Dockerfile.dev healthcheck consistency

---

## Рекомендуемый порядок исправлений

### Этап 1: Критические фиксы (30 минут)

1. **C1:** `celery_app.py` — добавить чтение `CELERY_BROKER_URL` и `CELERY_RESULT_BACKEND` из env:
   ```python
   celery_app = Celery(
       "fancai",
       broker=os.getenv("CELERY_BROKER_URL", settings.REDIS_URL),
       backend=os.getenv("CELERY_RESULT_BACKEND", settings.REDIS_URL),
       include=[...],
   )
   ```
2. **C2:** `docker-compose.prod.yml:272` и `docker-compose.dev.yml:237` — `allkeys-lru` → `volatile-lru`
3. **C3:** `frontend/index.html:13` — `frame-src 'none'` → `frame-src 'self' blob:`
4. **C4:** `docker-compose.monitoring.yml:85` — добавить Dozzle auth
5. **C5:** `backend/entrypoint.prod.sh:71-116` — удалить NLP checks

### Этап 2: Высокоприоритетные фиксы (1 час)

6. **H1:** Добавить HAWK_TOKEN в backend service environment
7. **H2:** PG stop_signal: SIGINT + stop_grace_period: 60s
8. **H3-H6:** PG tuning:
   - `shared_buffers=4GB` (или увеличить mem_limit до 20GB)
   - `effective_cache_size=8GB`
   - добавить `max_wal_size=4GB`
   - добавить `effective_io_concurrency=200`
9. **H7:** Monitoring ports → `127.0.0.1:PORT:PORT`
10. **H8:** Зафиксировать monitoring image versions
11. **H9:** HSTS header в Caddyfile
12. **H10:** Fix deploy-production.sh compose filename

### Этап 3: Средний приоритет (первая неделя)

13. Security headers в Caddyfile (Permissions-Policy, COOP)
14. Flower auth + monitoring hardening
15. Healthchecks для Caddy/Celery
16. Legacy cleanup (config.py, dead files)
17. Scripts update (deploy, validate, health-check)

### Этап 4: Чистка (первый месяц)

18. Ребрендинг bookreader → fancai (план 04.1-03)
19. Удаление legacy файлов
20. CI/CD improvements

---

## Приложение: Сводная таблица ресурсов (prod)

| Сервис                    | CPU limit | Memory limit | Memory reservation | Примечание                        |
| ------------------------- | --------- | ------------ | ------------------ | --------------------------------- |
| Caddy                     | 0.5       | 128M         | 64M                | Reverse proxy                     |
| Frontend                  | —         | —            | —                  | Build-only, exits                 |
| Backend                   | 2.0       | 2G           | 768M               | FastAPI + Gunicorn                |
| Celery Worker             | 1.5       | 1.5G         | 512M               | AI tasks                          |
| Celery Beat               | 0.3       | 256M         | 128M               | Scheduler                         |
| PostgreSQL                | 4.0       | 12G          | 8G                 | ⚠️ shared_buffers=8GB             |
| Redis                     | 0.5       | 768M         | 384M               | Cache + Broker                    |
| **Итого**                 | **8.8**   | **~16.65G**  | —                  | 52% от 32GB                       |
| + Monitoring (5 сервисов) | ~1.0      | ~704M        | —                  | Netdata, VM, Kuma, Dozzle, Flower |
| **Всего**                 | **~9.8**  | **~17.35G**  | —                  | 54% от 32GB, 14.65GB headroom     |
