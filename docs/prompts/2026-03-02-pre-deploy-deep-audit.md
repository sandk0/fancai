# Промпт: Глубокий аудит кодовой базы и инфраструктуры перед деплоем на сервер

**Дата:** 2026-03-02
**Модель:** Claude Opus 4.6
**Формат вывода:** Markdown-отчёт → `docs/reports/2026-03-02-pre-deploy-deep-audit.md`

---

## Контекст проекта

**fancai** — приложение для чтения книг с двумя AI-фичами: генерация иллюстраций (Imagen → FLUX.2 через OpenRouter) и интерактивная энциклопедия сущностей (Gemini 3.0 Flash → OpenRouter).

**Стек:**

- Frontend: React 19 + TypeScript 5.7 + Vite 7 + Tailwind CSS 4 + TanStack Query 5 + epub.js 0.3.93 + Zustand 5
- Backend: FastAPI 0.135 + Python 3.11 + SQLAlchemy 2.0 + Celery 5.6 + Pydantic 2.12
- Infrastructure: PostgreSQL 17.9-alpine + Redis 7.4.8-alpine + Caddy 2.11.1-alpine
- Мониторинг: Netdata + VictoriaMetrics + Uptime Kuma 2 + Dozzle v10 + Flower 2
- Ошибки: Hawk Tracker (hawk-tracker.ru), НЕ Sentry
- AI: OpenRouter API (LLM: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite; Images: FLUX.2 Klein 4B)
- Production: https://fancai.ru | Сервер: netcup VPS 4000 G12 (12 vCPU EPYC 9645, 32 GB DDR5, 1 TB NVMe, Debian 13.3)

**Что уже сделано (4 фазы + 1 вставная, 14 планов):**

1. **Phase 1: Безопасность** — PyJWT вместо python-jose, DEBUG=False по умолчанию, production-валидация SECRET_KEY, реальный health check (PG+Redis+Celery), Hawk Tracker мониторинг, Gunicorn с UvicornWorker, Celery visibility_timeout/time_limit фикс, PG 17.9
2. **Phase 2: Очистка** — удаление NLP-кода, celery_config.py, мёртвых полей конфигурации, NLP тестовых файлов, фикс sync endpoint (501)
3. **Phase 3: Миграция** — OpenRouter client с fallback chain + \_inline_defs, миграция 5 AI-сервисов, FLUX.2 вместо Imagen 4, Caddy вместо nginx (auto-HTTPS, HTTP/3)
4. **Phase 4: Инфраструктура** — Prometheus метрики (5 счётчиков + llm_usage_log), мониторинг-стек (Netdata+VM+Kuma+Dozzle+Flower), обновление npm/pip, PG тюнинг для 32GB
5. **Phase 4.1: Интеграция и ребрендинг** — Docker-сеть fancai_network, очистка Gemini/LangExtract переменных, HAWK_TOKEN в celery, .env.example, ребрендинг bookreader → fancai

---

## Задача

Проведи **глубокий и исчерпывающий аудит** текущей кодовой базы и инфраструктуры перед деплоем на новый production-сервер. Это масштабная задача — подойди ответственно, не пропускай ничего.

### Цели аудита

1. **Верификация 4 выполненных фаз** — проверить, что все заявленные изменения действительно реализованы в коде и конфигурации
2. **Поиск несоответствий и пробелов** — найти расхождения между фазовыми планами и реальным состоянием кодовой базы
3. **Аудит инфраструктуры** — Docker, Caddy, PostgreSQL, Redis, мониторинг на соответствие best practices 2026 года
4. **Верификация отчёта server-setup-plan** — тщательно проверить `docs/reports/2026-03-02-server-setup-plan.md` на соответствие реальным данным в кодовой базе
5. **Готовность к production-деплою** — составить checklist блокирующих проблем

---

## Файлы для обязательного чтения

### Инфраструктура (Docker + Caddy)

- `docker-compose.prod.yml` — production compose
- `docker-compose.dev.yml` — development compose
- `docker-compose.monitoring.yml` — мониторинг-стек
- `Caddyfile` — production Caddy config
- `Caddyfile.dev` — dev Caddy config
- `backend/Dockerfile.prod` — production Dockerfile бэкенда
- `backend/Dockerfile.dev` — dev Dockerfile бэкенда
- `frontend/Dockerfile.prod` — production Dockerfile фронтенда
- `frontend/Dockerfile.dev` — dev Dockerfile фронтенда
- `backend/entrypoint.prod.sh` — entrypoint для production
- `frontend/docker-entrypoint.sh` + `frontend/entrypoint.sh` — entrypoint фронтенда
- `.dockerignore`, `backend/.dockerignore`, `frontend/.dockerignore`

### Бэкенд: ядро

- `backend/app/core/config.py` — основная конфигурация (Settings)
- `backend/app/core/celery_app.py` — Celery конфигурация
- `backend/app/core/openrouter_client.py` — OpenRouter клиент (LLM + images)
- `backend/app/main.py` — FastAPI entry point
- `backend/app/core/hawk.py` — Hawk Tracker интеграция
- `backend/gunicorn.conf.py` — Gunicorn конфиг
- `backend/requirements.txt` — Python зависимости
- `backend/alembic.ini` + `backend/alembic/env.py` — миграции

### Бэкенд: AI-сервисы

- `backend/app/services/gemini_extractor.py` — Gemini extraction
- `backend/app/services/entity_service.py` — Entity система
- `backend/app/services/entity_deduplication_service.py` — дедупликация
- `backend/app/services/consistency_manager.py` — consistency checking
- `backend/app/services/entity_synthesis.py` — entity synthesis
- `backend/app/routers/images.py` — image generation (33K lines!)

### Бэкенд: мониторинг и безопасность

- `backend/app/monitoring/metrics.py` — Prometheus метрики
- `backend/app/middleware/rate_limit.py` — rate limiting
- `backend/app/routers/auth.py` — аутентификация
- `backend/app/core/security.py` или подобный — JWT/безопасность

### Фронтенд

- `frontend/package.json` — зависимости
- `frontend/vite.config.ts` — Vite конфигурация
- `frontend/src/components/Reader/EpubReader.tsx` — главный файл ридера (84 изменения)
- `frontend/index.html` — проверить CSP meta-тег (frame-src)
- `frontend/src/App.tsx` или router — проверить маршрутизацию

### Database и Redis

- `postgres/postgresql.conf` — PG конфиг (если используется)
- `postgres/init/01-extensions.sql` + `postgres/init/init.sql`
- `redis/redis.conf` — Redis конфиг (411 строк — проверить, монтируется ли)

### Env-файлы (шаблоны)

- `backend/.env.production.example`
- `frontend/.env.example`
- `frontend/.env.production`

### CI/CD

- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`

### Скрипты

- `scripts/deploy.sh` + `scripts/deploy-production.sh`
- `scripts/backup.sh` + `scripts/backup-database.sh` + `scripts/restore.sh`
- `scripts/validate-infrastructure.sh` + `scripts/infrastructure-health-check.sh`
- `scripts/generate-secrets.sh` + `backend/scripts/generate-production-secrets.sh`

### Nginx (legacy — должен быть удалён)

- `frontend/nginx.conf` + `frontend/nginx.prod.conf` — ПРОВЕРИТЬ: это легаси после миграции на Caddy?

### Отчёт для верификации

- `docs/reports/2026-03-02-server-setup-plan.md` — ОБЯЗАТЕЛЬНО прочитать ЦЕЛИКОМ и верифицировать

### Планы и саммари выполненных фаз

- `.planning/ROADMAP.md`
- `.planning/phases/01-production-safety/` — все PLAN.md и SUMMARY.md
- `.planning/phases/02-dead-code-cleanup/` — все PLAN.md и SUMMARY.md
- `.planning/phases/03-migration-services/` — все PLAN.md и SUMMARY.md
- `.planning/phases/04-infrastructure-maintenance/` — все PLAN.md и SUMMARY.md
- `.planning/phases/04.1-integration-rebrand/` — все PLAN.md и SUMMARY.md

---

## Направления аудита

### 1. ВЕРИФИКАЦИЯ ВЫПОЛНЕННЫХ ФАЗ

Для каждой из 5 завершённых фаз:

- Прочитать все PLAN.md и SUMMARY.md
- Проверить, что каждый заявленный критерий успеха выполнен в реальном коде
- Найти незавершённые или частично реализованные пункты
- Найти побочные эффекты или регрессии

**Конкретные проверки:**

**Phase 1:**

- [ ] `config.py`: DEBUG=False по умолчанию + validate_production_settings блокирует запуск с дефолтными секретами
- [ ] PyJWT используется вместо python-jose (проверить imports, requirements.txt — python-jose отсутствует)
- [ ] Health check endpoint реально проверяет PG, Redis, Celery (не захардкоженный)
- [ ] Hawk Tracker инициализируется в backend + celery (проверить hawk.py, main.py, celery_app.py)
- [ ] Gunicorn с UvicornWorker в production (проверить gunicorn.conf.py, entrypoint.prod.sh)
- [ ] Celery: visibility_timeout (14400) > task_time_limit — проверить в celery_app.py
- [ ] PG образ postgres:17.9-alpine во всех compose-файлах

**Phase 2:**

- [ ] Нет файлов celery_config.py нигде в проекте
- [ ] Нет NLP-полей в config.py, settings_manager.py
- [ ] sync endpoint возвращает 501

**Phase 3:**

- [ ] Все AI-сервисы используют openrouter_client.py (не google-genai)
- [ ] google-genai полностью удалён из requirements.txt
- [ ] Fallback chain: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite
- [ ] FLUX.2 Klein для изображений (не Imagen)
- [ ] Caddy обслуживает фронтенд (нет nginx в production compose)

**Phase 4:**

- [ ] Prometheus метрики: llm_cost, llm_fallback, auth_registrations, auth_logins, rate_limit_triggered
- [ ] llm_usage_log таблица существует (проверить alembic миграции)
- [ ] Мониторинг-стек: все 5 сервисов в monitoring.yml с корректными конфигами
- [ ] PG тюнинг для 32GB в docker-compose.prod.yml

**Phase 4.1:**

- [ ] Docker-сеть fancai_network в prod.yml и monitoring.yml
- [ ] Мёртвые env vars (LANGEXTRACT_MODEL, GOOGLE_API_KEY и т.д.) удалены из ВСЕХ compose-файлов
- [ ] HAWK_TOKEN передаётся в celery-worker и celery-beat
- [ ] Ребрендинг bookreader → fancai: контейнеры, образы, celery app name, localStorage ключи

### 2. ВЕРИФИКАЦИЯ SERVER-SETUP-PLAN

Тщательно проверить каждое утверждение в `docs/reports/2026-03-02-server-setup-plan.md`:

**Критические несоответствия (C1-C7):**

- [ ] **C2**: celery_app.py — действительно ли игнорирует CELERY_BROKER_URL env? Проверить строку `broker=settings.REDIS_URL` vs `os.getenv("CELERY_BROKER_URL")`
- [ ] **C3**: Redis maxmemory-policy — действительно `allkeys-lru` в prod compose? Должен быть `volatile-lru`
- [ ] **C4/C5**: PG config — `effective_cache_size=24GB`, отсутствие `max_wal_size` — проверить в docker-compose.prod.yml command section
- [ ] **C6**: PG mem_limit=12GB + HugePages расчёт — сравнить с реальным compose

**HIGH (H1-H10):**

- [ ] **H1**: `shared_buffers=8GB` при mem_limit=12GB — подтвердить значения в compose
- [ ] **H6**: redis.conf (411 строк) — проверить, монтируется ли в каком-либо compose
- [ ] **H8**: Docker порты 80/443 — биндятся на 0.0.0.0 (через Docker NAT обходят nftables)
- [ ] **H9**: Отсутствие HSTS, CSP, COOP в Caddyfile — сравнить реальный Caddyfile с рекомендуемым в отчёте

**Код-фиксы:**

- [ ] Celery broker/backend URL — реальный код vs рекомендация отчёта
- [ ] CSP frame-src в frontend/index.html — проверить meta-тег

**Ресурсные лимиты:**

- Сравнить таблицу распределения ресурсов из отчёта с реальными `deploy.resources.limits` в compose-файлах
- Проверить, что суммарное потребление не превышает 32GB

### 3. ИНФРАСТРУКТУРА DOCKER

**docker-compose.prod.yml:**

- [ ] Все контейнеры используют конкретные версии образов (не latest, не :stable)
- [ ] Все сервисы имеют healthcheck
- [ ] Все сервисы имеют resource limits (memory + CPU)
- [ ] `restart: unless-stopped` на всех сервисах
- [ ] Frontend: `condition: service_completed_successfully` (build-only pattern)
- [ ] Backend: `condition: service_healthy` с зависимостями
- [ ] PostgreSQL: `stop_signal: SIGINT` + `stop_grace_period: 60s` (предотвращение WAL corruption)
- [ ] PG: `shm_size` адекватен для shared_buffers
- [ ] Redis: отдельные БД для cache/broker/results (db 0/1/2)
- [ ] Нет `ports:` для внутренних сервисов (PG, Redis) в prod
- [ ] Volumes: named volumes для persistence, bind mounts для config
- [ ] Networks: единая `fancai_network` для всех сервисов

**docker-compose.dev.yml:**

- [ ] PG и Redis биндятся на 127.0.0.1 (не 0.0.0.0)
- [ ] Source code mounts для hot reload
- [ ] Адекватные memory limits для MacBook Air M4 (16GB RAM, ~5GB budget)

**docker-compose.monitoring.yml:**

- [ ] Flower подключён к той же Redis/fancai_network
- [ ] Monitoring ports не выставлены наружу (или защищены)
- [ ] Dozzle: DOZZLE_AUTH_PROVIDER — должна быть аутентификация в production

**Dockerfiles:**

- [ ] Multi-stage builds для production
- [ ] Non-root user
- [ ] Минимальный размер образа (alpine base, .dockerignore)
- [ ] Нет dev-зависимостей в production image
- [ ] HEALTHCHECK инструкции
- [ ] Корректные COPY порядки для кэширования слоёв

### 4. CADDY

- [ ] HSTS header (Strict-Transport-Security с includeSubDomains и preload)
- [ ] X-Frame-Options: SAMEORIGIN (не DENY — epub.js использует iframe)
- [ ] X-Content-Type-Options: nosniff
- [ ] Referrer-Policy
- [ ] Cross-Origin-Opener-Policy
- [ ] Permissions-Policy
- [ ] Удалён Server header
- [ ] www → non-www редирект
- [ ] Upload limit для EPUB (50MB)
- [ ] try_files для SPA routing
- [ ] Health check для backend reverse_proxy
- [ ] Response timeout для долгих AI-запросов (>120s)
- [ ] Мониторинг-субдомен: basic_auth защита
- [ ] HTTP/3 (QUIC) — порт 443/udp
- [ ] Логирование с ротацией

### 5. PostgreSQL

- [ ] shared_buffers: 25-40% от выделенной памяти контейнера
- [ ] effective_cache_size: адекватен для выделенной памяти
- [ ] work_mem: не вызовет OOM при max_connections \* work_mem
- [ ] maintenance_work_mem: 1GB разумно для 32GB сервера
- [ ] max_wal_size: указан (дефолт 1GB мал)
- [ ] wal_compression: zstd (PG 17 поддерживает)
- [ ] effective_io_concurrency: указан (200 для NVMe)
- [ ] maintenance_io_concurrency: указан
- [ ] max_parallel_workers + max_parallel_workers_per_gather
- [ ] autovacuum_max_workers
- [ ] random_page_cost: 1.1 для SSD/NVMe
- [ ] huge_pages: try
- [ ] log_min_duration_statement: для slow query logging
- [ ] max_connections: адекватно для backend + celery workers
- [ ] Миграции: alembic head соответствует текущим моделям
- [ ] Init scripts: расширения (pg_trgm, uuid-ossp и др.)

### 6. Redis

- [ ] maxmemory-policy: volatile-lru (НЕ allkeys-lru — может удалить Celery данные)
- [ ] Отдельные БД: cache (db 0), broker (db 1), results (db 2)
- [ ] redis.conf: монтируется или не монтируется? (411 строк мёртвого конфига)
- [ ] appendonly: yes (persistence)
- [ ] save intervals адекватны
- [ ] requirepass: задан
- [ ] maxmemory: адекватен для нагрузки

### 7. БЭКЕНД: БЕЗОПАСНОСТЬ И КОНФИГУРАЦИЯ

- [ ] SECRET_KEY: не захардкожен, валидируется в production
- [ ] JWT: PyJWT, не python-jose; algorithm HS256
- [ ] CORS: корректен для production домена
- [ ] Rate limiting: реализован, адекватные лимиты
- [ ] Пароли: bcrypt хэширование
- [ ] SQL injection: параметризованные запросы (SQLAlchemy ORM)
- [ ] XSS: DOMPurify на фронтенде, sanitization на бэкенде
- [ ] File upload: валидация типов, ограничение размера
- [ ] Error handling: не утекают стектрейсы в production (DEBUG=False)
- [ ] Конфиденциальные данные: не логируются API ключи, пароли, токены

### 8. БЭКЕНД: CELERY

- [ ] Broker URL: использует отдельную Redis DB (не db 0)
- [ ] Result backend: использует отдельную Redis DB
- [ ] task_acks_late + task_reject_on_worker_lost: для at-least-once
- [ ] Time limits: soft + hard
- [ ] max_memory_per_child: предотвращает утечки памяти
- [ ] max_tasks_per_child: предотвращает длительные утечки
- [ ] beat_schedule: корректные расписания
- [ ] worker_soft_shutdown_timeout: для graceful shutdown
- [ ] Task routes: тяжёлые задачи в отдельной очереди
- [ ] Hawk Tracker интеграция работает для Celery

### 9. ФРОНТЕНД

- [ ] CSP meta-тег: frame-src разрешает blob: (epub.js)
- [ ] Нет прямых fetch() — всё через TanStack Query
- [ ] Sensitive data: нет API ключей в клиентском коде
- [ ] Сборка: `npm run build` без ошибок TypeScript
- [ ] Размер бандла: разумный (проверить наличие tree-shaking)
- [ ] Service Worker / PWA: корректная конфигурация workbox
- [ ] i18n: правильная настройка i18next

### 10. LEGACY / МЁРТВЫЙ КОД

- [ ] `frontend/nginx.conf` и `frontend/nginx.prod.conf` — легаси после миграции на Caddy? Удалить?
- [ ] `postgres/postgresql.conf` — используется ли? (PG конфиг передаётся через command в compose)
- [ ] `redis/redis.conf` — используется ли? (Redis конфиг передаётся через command в compose)
- [ ] Legacy AI settings в config.py: IMAGEN\_\*, GEMINI_MODEL, OPENAI_API_KEY, MIDJOURNEY_API_KEY — нужны ли?
- [ ] `requirements.lite.txt` — актуален ли?
- [ ] `.github/workflows_disabled/` — можно ли удалить?
- [ ] `backend/scripts/` — все скрипты актуальны?
- [ ] `logrotate/logrotate.conf` — используется ли с новым стеком?
- [ ] `.auto-claude/` — нужна ли эта директория?

### 11. CI/CD

- [ ] `ci.yml`: тесты запускаются, линтинг проходит
- [ ] `security.yml`: сканирование зависимостей
- [ ] Нет секретов в коде (grep для API_KEY, PASSWORD, SECRET, TOKEN паттернов)
- [ ] .gitignore покрывает все чувствительные файлы (.env, storage/, node_modules/)

### 12. СКРИПТЫ

- [ ] `scripts/deploy.sh` + `scripts/deploy-production.sh` — актуальны для нового стека (Caddy, не nginx)?
- [ ] `scripts/backup*.sh` — используют корректные контейнеры (fancai*postgres, не bookreader*\*)
- [ ] `scripts/restore.sh` — работает с текущей версией PG
- [ ] `scripts/validate-infrastructure.sh` — проверяет актуальные сервисы
- [ ] `scripts/generate-secrets.sh` — генерирует все необходимые секреты

---

## Известные проблемы для проверки

Эти проблемы УЖЕ были выявлены в предыдущих аудитах. Проверь, исправлены ли они:

1. **celery_app.py использует settings.REDIS_URL** — строка `broker=settings.REDIS_URL` игнорирует env var CELERY_BROKER_URL. Все три сервиса (cache, broker, results) работают на одной Redis DB 0
2. **Redis allkeys-lru** — может удалить Celery broker данные. Должен быть volatile-lru
3. **PG shared_buffers=8GB при mem_limit=12G** — 66% контейнера, рекомендуется 25-40%
4. **Нет max_wal_size в PG** — дефолт 1GB мал для 8GB shared_buffers
5. **Нет effective_io_concurrency в PG** — дефолт 1, должен быть 200 для NVMe
6. **Нет stop_signal/stop_grace_period для PG** — Docker SIGKILL через 10 сек → WAL corruption
7. **Нет oom_score_adj для PG** — OOM killer может убить PG первым
8. **Monitoring ports (8428, 3001, 8080, 5555)** — биндятся на 0.0.0.0, доступны извне
9. **Dozzle без аутентификации** — DOZZLE_AUTH_PROVIDER=none
10. **CSP frame-src в index.html** — может блокировать epub.js blob: iframes
11. **Legacy nginx конфиги** — до сих пор в репозитории
12. **Legacy Gemini/Imagen settings в config.py** — IMAGEN\_\*, GEMINI_MODEL, OPENAI_API_KEY

---

## Формат отчёта

```markdown
# Глубокий аудит кодовой базы и инфраструктуры fancai

**Дата:** 2026-03-02
**Scope:** Полный pre-deploy аудит (фазы 1-4.1, инфраструктура, безопасность)
**Автор:** Claude Opus 4.6

## Executive Summary

[3-5 предложений: общее состояние, количество проблем, готовность к деплою]

## Верификация выполненных фаз

### Phase 1: Безопасность продакшена

**Статус:** ✅ / ⚠️ / ❌
[Для каждого критерия успеха: выполнен / частично / не выполнен с доказательствами из кода]

### Phase 2: Очистка мертвого кода

...

### Phase 3: Миграция сервисов

...

### Phase 4: Обслуживание инфраструктуры

...

### Phase 4.1: Интеграция и ребрендинг

...

## Верификация server-setup-plan.md

### Подтверждённые находки

[Что из отчёта подтверждается реальным кодом]

### Опровергнутые или устаревшие

[Что из отчёта уже исправлено или не соответствует реальности]

### Пропущенные проблемы

[Что отчёт НЕ нашёл, но существует в коде]

## Реестр проблем

### CRITICAL (блокируют деплой)

| #   | Проблема | Файл(ы) | Рекомендуемый фикс | Сложность |
| --- | -------- | ------- | ------------------ | --------- |

### HIGH (исправить до деплоя или в первую неделю)

| # | Проблема | Файл(ы) | Рекомендуемый фикс | Сложность |

### MEDIUM (исправить в первый месяц)

| # | Проблема | Файл(ы) | Рекомендуемый фикс | Сложность |

### LOW (желательно)

| # | Проблема | Файл(ы) | Рекомендуемый фикс | Сложность |

## Legacy / Мёртвый код

[Список файлов для удаления с обоснованием]

## Best Practices 2026

[Рекомендации по актуальным практикам для стека на март 2026:

- Docker Compose V2 (не v1)
- Caddy 2.11+ (HTTP/3, security headers)
- PostgreSQL 17.x (zstd WAL, improved parallelism)
- Redis 7.4+ (functions, triggers)
- React 19 (use(), actions, server functions если применимо)
- Vite 7+ (environment API, HMR improvements)
- Celery 5.6+ (soft shutdown, Pydantic support)
- FastAPI 0.135+ (response_model_exclude_unset и прочие оптимизации)
- Python 3.11/3.12/3.13 — рассмотреть обновление
- TypeScript 5.7+ (target ES2024, --isolatedDeclarations)]

## Checklist готовности к деплою

- [ ] CRITICAL проблемы: 0
- [ ] Celery broker URL fix: ✅/❌
- [ ] Redis eviction policy: ✅/❌
- [ ] PG ресурсы: адекватны для 32GB
- [ ] Security headers: полный набор
- [ ] Legacy код: удалён
- [ ] Все env vars: задокументированы в .env.example
- [ ] Backup скрипты: протестированы
- [ ] CI: зелёный

## Рекомендуемый порядок исправлений

1. [Самое критичное]
2. ...
   N. [Наименее критичное]
```

---

## Правила работы

1. **Читай реальные файлы** — не предполагай по названию. Открой каждый файл и проверь содержимое
2. **Цитируй строки кода** — каждая находка должна содержать точную ссылку: `файл:строка` + цитату кода
3. **Сравнивай с server-setup-plan** — для каждой находки из отчёта проверь, что она всё ещё актуальна
4. **Не пропускай файлы** — прочитай ВСЕ файлы из списка "Файлы для обязательного чтения"
5. **Best practices на март 2026** — ориентируйся на актуальные рекомендации для каждой технологии
6. **Приоритизируй** — CRITICAL = блокирует деплой, HIGH = risk в production, MEDIUM = tech debt, LOW = nice to have
7. **Конкретика** — не пиши "рекомендуется улучшить". Пиши "строка 14 в celery_app.py: `broker=settings.REDIS_URL` → заменить на `broker=os.getenv('CELERY_BROKER_URL', settings.REDIS_URL)`"
8. **Используй Explore-агентов** для параллельного чтения файлов — задача масштабная
9. **Отчёт на русском языке**
10. **Сохрани отчёт в** `docs/reports/2026-03-02-pre-deploy-deep-audit.md`
