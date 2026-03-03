# Промпт: Полный аудит изменений по security hardening плану

**Дата создания:** 2026-03-02
**Модель:** Claude Opus 4.6 (Claude Code CLI)
**Контекст:** Аудит всех изменений, внесённых по плану `docs/plans/2026-03-02-security-hardening-plan.md`

---

## Промпт

Ты — опытный security-инженер и code reviewer. Проведи полный, подробный и тщательный аудит всех изменений, внесённых в проект fancai по плану security hardening (`docs/plans/2026-03-02-security-hardening-plan.md`). План содержит 54 задачи в 8 блоках (50 выполнены, 4 пропущены).

### Контекст проекта

- **Стек:** React 19 + TypeScript 5.7 + Vite 7 | FastAPI + Python 3.11 + PostgreSQL 17 + Redis 7.4 + Celery 5.6
- **AI:** OpenRouter (Gemini 3.0 Flash + FLUX.2 Klein)
- **Инфра:** Docker Compose, Caddy (reverse proxy), VPS 32GB RAM / 12 vCPU / NVMe SSD
- **Статус:** Проект НЕ задеплоен на продакшен, данных нет — можно рисковать с breaking changes
- **Важно:** Все изменения по плану находятся в незакоммиченном состоянии (`git diff HEAD`)

### Что нужно проверить

Проведи аудит по каждому из 8 блоков. Для каждой задачи:

1. **Прочитай изменённый файл** — убедись, что фикс действительно применён корректно
2. **Проверь побочные эффекты** — не сломал ли фикс существующую функциональность
3. **Проверь согласованность** — согласуются ли изменения с остальным кодом проекта
4. **Выполни верификационные команды** из плана
5. **Найди пропущенное** — есть ли аналогичные проблемы в других местах, которые план не покрывает

---

### Блок 1: Backend Security (9 задач, 8 выполнены)

Файлы для проверки:

- `backend/app/main.py` — задачи 1.1 (str(exc) утечка), 1.2 (CSRF middleware), 1.3 (Swagger disable в prod)
- `backend/app/core/config.py` — задача 1.4 (metrics password), 1.9 (legacy AI settings)
- `backend/app/routers/admin/system.py` — задача 1.5 (debug mode protection)
- `backend/app/routers/books/crud.py` — задача 1.6 (pagination limits)
- `backend/app/routers/admin/users.py` — задача 1.6 (pagination limits)
- `backend/app/routers/images.py` — задача 1.6 (pagination limits)
- `backend/app/routers/auth.py` — задача 1.8 (password field constraints)

**Проверить:**

- [ ] 1.1: `str(exc)` полностью удалён из error handlers? Нет ли аналогичных утечек в ДРУГИХ error handlers по всему backend?
- [ ] 1.2: CSRFProtectMiddleware подключён? Правильный ли порядок middleware? Не конфликтует ли с CORS? Как frontend передаёт CSRF token?
- [ ] 1.3: `/docs` и `/redoc` используют `settings.DEBUG`? Корректно ли работает условие?
- [ ] 1.4: Валидация `METRICS_PASSWORD` добавлена в `validate_production_settings()`?
- [ ] 1.5: Debug mode проверка корректна? Правильное имя атрибута settings?
- [ ] 1.6: `Query(default=50, ge=1, le=100)` на ВСЕХ list endpoints? Проверь не только упомянутые — поищи ВСЕ endpoints с `limit` параметром через `grep`
- [ ] 1.7: (пропущена — ОК, Docker bridge network)
- [ ] 1.8: `Field(..., min_length=12, max_length=128)` — применено? Нет ли конфликта с существующими пользователями (min_length=12 вместо 8)?
- [ ] 1.9: Legacy AI settings удалены? Нет ли оставшихся ссылок в ДРУГИХ файлах?

**Дополнительно проверить по Блоку 1:**

- Нет ли других мест в backend, где `str(exc)` или `repr(exc)` утекает в response?
- Нет ли других endpoints с неограниченным `limit`?
- Все ли Pydantic models с `password` полями имеют constraints?

---

### Блок 2: Frontend Security (9 задач, 9 выполнены)

Файлы для проверки:

- `frontend/index.html` — задача 2.1 (CSP frame-src)
- `frontend/src/sw.ts` — задача 2.2 (SW cache cleanup при logout)
- `frontend/src/stores/auth.ts` — задачи 2.2 (SW notify), 2.4 (localStorage TTL)
- `frontend/src/components/ErrorBoundary.tsx` — задача 2.3 (stack trace скрытие)
- `frontend/src/components/Reader/ReaderContent.tsx` — задача 2.5 (DOMPurify)
- `frontend/src/config/hawk.ts` — задача 2.6 (Hawk token комментарий)
- `frontend/src/api/client.ts` — задача 2.7 (client-side rate limiting)
- `frontend/src/services/pushNotifications.ts` — задача 2.8 (VAPID try/catch)
- `.github/workflows/ci.yml` — задача 2.9 (build:unsafe → build)

**Проверить:**

- [ ] 2.1: CSP `frame-src 'self' blob:` — достаточно ли для epub.js? Нет ли других CSP директив, которые блокируют функциональность? Весь CSP мета-тег согласован?
- [ ] 2.2: SW message handler добавлен? `caches.delete('api-cache')` — совпадает ли имя кеша с реально используемым? Auth.ts отправляет сообщение SW при logout? Исключены ли user-specific endpoints из кеширования?
- [ ] 2.3: `import.meta.env.DEV` оборачивает error details? Что показывается в production вместо стектрейса?
- [ ] 2.4: TTL wrapper работает? `loadUserFromStorage` корректно парсит и старый, и новый формат? Edge case: что если `JSON.parse` упадёт?
- [ ] 2.5: DOMPurify `afterSanitizeAttributes` хук добавлен? Не перезаписывает ли другие хуки? Комментарий к data-\* attrs?
- [ ] 2.6: Комментарий к VITE_HAWK_TOKEN?
- [ ] 2.7: Rate limiting interceptor — работает ли с TanStack Query (retry, refetch)? Не блокирует ли легитимные быстрые запросы (pagination, filters)? `axios.Cancel` — корректный API в текущей версии axios?
- [ ] 2.8: try/catch в `urlBase64ToUint8Array`?
- [ ] 2.9: CI использует `npm run build` вместо `build:unsafe`?

**Дополнительно проверить по Блоку 2:**

- Нет ли других мест с `import.meta.env.DEV` инверсиями (показ sensitive данных в prod)?
- Нет ли других мест с `localStorage.setItem` без TTL для sensitive данных?
- CSP в `index.html` полностью корректен для всех фич приложения?
- Нет ли TS compilation errors после изменений?

---

### Блок 3: Docker & Build (5 задач, 4 выполнены)

Файлы для проверки:

- `backend/Dockerfile.prod` — задача 3.1 (chmod 777 → 775)
- `backend/entrypoint.prod.sh` — задача 3.2 (legacy NLP removal)
- `docker-compose.dev.yml` — задача 3.3 (celery-beat root user)
- `frontend/entrypoint.sh` — задача 3.5 (удалён?)

**Проверить:**

- [ ] 3.1: `chmod 775` вместо `777`? Правильный ли user/group у процессов в контейнере?
- [ ] 3.2: NLP checks удалены? Нет ли других legacy NLP ссылок в entrypoint или Dockerfile?
- [ ] 3.3: `user: root` удалён из celery-beat в dev compose? Не сломается ли celery-beat без root (права на файловую систему)?
- [ ] 3.4: (пропущена — ОК)
- [ ] 3.5: `frontend/entrypoint.sh` удалён? Нет ли на него ссылок в Dockerfile или compose?

**Дополнительно проверить по Блоку 3:**

- Нет ли других `chmod 777` в проекте?
- Нет ли других `user: root` в compose файлах?
- Dockerfile.prod собирается корректно?

---

### Блок 4: PostgreSQL Tuning (7 задач, 7 выполнены)

Файл для проверки: `docker-compose.prod.yml` (секция postgres command)

**Проверить:**

- [ ] 4.1: `shared_buffers=4GB` (не 8GB)?
- [ ] 4.2: `effective_cache_size=8GB` (не 24GB)?
- [ ] 4.3: `max_wal_size=4GB` добавлен?
- [ ] 4.4: `effective_io_concurrency=200` добавлен?
- [ ] 4.5: `stop_signal: SIGINT` и `stop_grace_period: 60s` у postgres service?
- [ ] 4.6: `max_connections=150` (не 100)?
- [ ] 4.7: `autovacuum_vacuum_cost_limit=2000` добавлен?

**Дополнительно проверить по Блоку 4:**

- Все параметры PostgreSQL внутренне согласованы? (shared_buffers vs wal_buffers vs work_mem vs memory limit контейнера)
- `mem_limit` контейнера postgres достаточен для всех параметров?
- `random_page_cost=1.1` корректен для NVMe?
- Нет ли конфликта с `postgres/postgresql.conf` (если не удалён)?

---

### Блок 5: Redis & Celery (4 задачи, 4 выполнены)

Файлы для проверки:

- `backend/app/core/celery_app.py` — задача 5.1 (broker/backend env vars)
- `docker-compose.prod.yml` — задача 5.2 (allkeys-lru → volatile-lru)
- `docker-compose.dev.yml` — задача 5.2 (allkeys-lru → volatile-lru)
- `backend/app/services/entity_deduplication_service.py` — задача 5.3 (distributed lock)
- `backend/app/routers/reading_sessions.py` — задача 5.4 (optimistic locking)

**Проверить:**

- [ ] 5.1: Celery использует `os.getenv("CELERY_BROKER_URL", ...)` и `os.getenv("CELERY_RESULT_BACKEND", ...)`? Импорт `os` добавлен?
- [ ] 5.2: `volatile-lru` в ОБОИХ compose файлах (prod + dev)?
- [ ] 5.3: Redis lock в `suggest_merges()` — корректный import? Работает ли `get_redis_client()` с async lock? `blocking=False` — правильный параметр для redis-py? `timeout=300` — достаточно? `lock.release()` в finally?
- [ ] 5.4: `expected_updated_at` в `BatchUpdateItem`? Проверка `session.updated_at` при update?

**Дополнительно проверить по Блоку 5:**

- `CELERY_BROKER_URL` и `CELERY_RESULT_BACKEND` определены в environment секциях compose файлов?
- Redis DB разделены: 0=cache, 1=broker, 2=results?
- Celery worker/beat в compose тоже получают эти env vars?
- Нет ли race conditions в ДРУГИХ сервисах (не только deduplication)?

---

### Блок 6: Monitoring & Caddy (8 задач, 8 выполнены)

Файлы для проверки:

- `docker-compose.monitoring.yml` — задачи 6.1 (Dozzle auth), 6.3 (порты 127.0.0.1), 6.4 (pinned images), 6.5 (Flower auth)
- `docker-compose.prod.yml` — задачи 6.2 (HAWK_TOKEN), 6.8 (healthchecks)
- `Caddyfile` — задачи 6.6 (HSTS), 6.7 (Permissions-Policy, COOP)

**Проверить:**

- [ ] 6.1: Dozzle имеет `DOZZLE_AUTH_PROVIDER=simple` и `DOZZLE_USERNAME`/`DOZZLE_PASSWORD`?
- [ ] 6.2: `HAWK_TOKEN` в backend service environment?
- [ ] 6.3: ВСЕ monitoring порты привязаны к `127.0.0.1`? (8428, 3001, 8080, 5555)?
- [ ] 6.4: Образы закреплены на конкретных версиях (не `:stable`, не `:2`)? Версии актуальны?
- [ ] 6.5: Flower имеет `--basic-auth`?
- [ ] 6.6: `Strict-Transport-Security` в Caddyfile? Параметры (max-age, includeSubDomains, preload)?
- [ ] 6.7: `Permissions-Policy` и `Cross-Origin-Opener-Policy` в Caddyfile?
- [ ] 6.8: Healthchecks для Caddy, celery-worker, celery-beat в docker-compose.prod.yml?

**Дополнительно проверить по Блоку 6:**

- Caddyfile валиден? Нет ли синтаксических ошибок?
- Все три compose файла проходят `docker compose config --quiet`?
- HSTS, COOP, Permissions-Policy не конфликтуют с CSP в index.html?
- `MONITOR_USER` и `MONITOR_PASSWORD` определены в `.env.example`?

---

### Блок 7: Deploy Scripts (4 задачи, 4 выполнены)

Файлы для проверки:

- `scripts/deploy-production.sh` — задачи 7.1 (prune --volumes), 7.2 (compose filename), 7.3 (nginx → caddy)
- `scripts/infrastructure-health-check.sh` — задача 7.4 (актуальные пути)

**Проверить:**

- [ ] 7.1: `docker system prune -f --volumes` удалён? Заменён на `container prune` + `image prune`?
- [ ] 7.2: `COMPOSE_FILE="docker-compose.prod.yml"` (не `.production.yml`)?
- [ ] 7.3: Все `nginx` ссылки заменены на `caddy`? `logrotate`, `watchtower` удалены?
- [ ] 7.4: Пути в health-check актуализированы?

**Дополнительно проверить по Блоку 7:**

- Скрипты исполняемые (`chmod +x`)?
- Нет ли nginx/watchtower/logrotate ссылок в ДРУГИХ скриптах в `scripts/`?
- `deploy-production.sh` работоспособен от начала до конца (dry run логика)?

---

### Блок 8: Legacy Cleanup (8 задач, 6 выполнены)

**Проверить:**

- [ ] 8.1: bookreader → fancai ребрендинг завершён? Запусти `grep -rn "bookreader"` по всему проекту
- [ ] 8.2: (пропущена — ОК, нет CVE)
- [ ] 8.3: `redis/redis.conf` и `postgres/postgresql.conf` удалены или перемещены?
- [ ] 8.4: `backend/requirements.lite.txt` удалён?
- [ ] 8.5: Vite `allowedHosts` изменён с `true` на explicit список?
- [ ] 8.6: (пропущена — пользователь использует .auto-claude)
- [ ] 8.7: `.github/workflows_disabled/` удалён?
- [ ] 8.8: `frontend/nginx.conf`, `frontend/nginx.prod.conf`, `logrotate/logrotate.conf` удалены?

**Дополнительно проверить по Блоку 8:**

- Нет ли «мусорных» файлов в корне проекта (_.txt, _.py, не относящихся к проекту)?
- `.gitignore` актуален?
- Нет ли ссылок на удалённые файлы в оставшемся коде?

---

### Сквозная верификация (КРИТИЧНО — проверить обязательно!)

После проверки каждого блока по отдельности, проведи сквозные проверки:

#### A. Компиляция и тесты

```bash
# TypeScript build (type-checking)
cd frontend && npm run build

# Backend tests
cd backend && pytest -v

# Docker compose validation (все 3 файла)
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.dev.yml config --quiet
docker compose -f docker-compose.monitoring.yml config --quiet
```

#### B. Security grep — ни одна из этих строк НЕ ДОЛЖНА быть в коде

```bash
grep -rn "str(exc)" backend/app/ --include="*.py" | grep -v "# " | grep -v test
grep -rn "chmod.*777" backend/ --include="Dockerfile*"
grep -rn "allkeys-lru" docker-compose*.yml
grep -rn "build:unsafe" .github/
grep -rn "metrics_secure_password" backend/app/ --include="*.py" | grep -v "validate\|default\|==\|!="
grep -rn "frame-src.*none" frontend/
grep -rn "user: root" docker-compose*.yml
grep -rn "prune.*--volumes" scripts/
grep -rn "docker-compose.production.yml" scripts/
```

#### C. Согласованность между файлами

- Env vars в compose файлах совпадают с тем, что ожидает `config.py`?
- `.env.example` содержит ВСЕ необходимые переменные?
- CSRF middleware и frontend CSRF token handling согласованы?
- CSP в `index.html` и security headers в `Caddyfile` не конфликтуют?
- Redis DB numbering одинаковое в compose и в коде (celery_app.py, config.py)?

#### D. Новые проблемы, вызванные изменениями

- Не появились ли новые TypeScript ошибки?
- Не сломали ли CSRF middleware существующие API-вызовы?
- Не сломал ли rate limiting на клиенте нормальную работу приложения?
- Не конфликтует ли localStorage TTL wrapper с другими частями auth store?
- Не сломали ли удалённые legacy файлы какие-то import'ы или ссылки?

#### E. Пропущенные паттерны безопасности

Поищи проблемы, которые план НЕ покрывал:

- SQL injection (raw SQL queries без параметризации)
- Path traversal в file upload/download endpoints
- SSRF через user-controlled URLs (OpenRouter, image URLs)
- Insecure deserialization (pickle, yaml.load)
- Hardcoded secrets в коде (API ключи, пароли)
- Отсутствие rate limiting на критичных endpoints (login, register, password reset)
- JWT implementation (алгоритм, expiration, refresh token rotation)
- File upload validation (mimetype, size, content)

---

### Формат отчёта

Для каждого блока составь таблицу:

| #   | Задача          | Статус       | Проблема | Рекомендация  |
| --- | --------------- | ------------ | -------- | ------------- |
| 1.1 | str(exc) утечка | ✅ / ⚠️ / ❌ | Описание | Что исправить |

Статусы:

- ✅ **Корректно** — фикс применён правильно, побочных эффектов нет
- ⚠️ **Частично** — фикс применён, но есть замечания или неполнота
- ❌ **Проблема** — фикс не применён, применён неправильно, или создал новую проблему

В конце отчёта:

1. **Сводка по всем блокам** — таблица с количеством ✅/⚠️/❌ на блок
2. **CRITICAL находки** — проблемы, блокирующие деплой
3. **Рекомендации** — что нужно исправить до деплоя
4. **Новые проблемы** — что мы упустили или сломали нашими изменениями

### Инструкции по выполнению

- Используй все доступные инструменты Claude Code: Read, Grep, Glob, Bash
- **Читай каждый изменённый файл полностью** — не полагайся на git diff
- Выполняй верификационные команды из плана и проверяй их вывод
- Ищи паттерны проблем по всему проекту, не только в файлах из плана
- Будь дотошным и педантичным — лучше перепроверить, чем пропустить
- Используй параллельных агентов для независимых блоков, чтобы ускорить аудит
- Все текстовые выводы на русском языке
- Если находишь несогласованность — описывай конкретный файл, строку, и что не так
- Не предлагай «простые» решения — предлагай долгосрочные правильные решения
