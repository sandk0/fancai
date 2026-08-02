# Production Reliability Baseline — implementation plan

> Статус: proposed. Основан на code/production audit 2026-07-18. Не включает новые продуктовые фичи.

## Goal

Вернуть проекту воспроизводимые quality/security gates и исправить уже подтверждённые
operational defects, не меняя продуктовый UX и AI-модели.

## Exit criteria

- GitHub Actions включены и `main` проходит обязательные backend/frontend/security jobs.
- Celery workers явно обслуживают `heavy`, `normal` и `light`; backlog отсутствует, а probe
  и реальный upload подтверждают dispatch каждой очереди.
- Backend test suite запускается в одинаковом Python 3.12 + PostgreSQL 17 окружении локально
  и в CI; нет pre-existing failures, Ruff/Black зелёные.
- Frontend lint/unit/build зелёные; Workbox build без warning и precache содержит реальные
  app assets, а не 2 пустых entries.
- Production dependency audit не содержит известных high/critical vulnerabilities либо
  каждое исключение имеет зафиксированный upstream blocker и компенсирующую меру.
- Netdata собирает backend metrics и экспортирует их в VictoriaMetrics без connection errors.
- Production deploy использует один канонический env-файл `.env`; rollback и smoke checks
  подтверждены.
- Один production EPUB проходит upload → extraction → Entity Wiki → image end-to-end.

## Scope boundaries

В scope: Celery queue orchestration/recovery, CI, тестовый bootstrap, dependency updates,
PWA build, monitoring networking, deploy scripts, AI rollback contract, production smoke/runbook.

Вне scope: Gemini admin panel, новые AI-модели, subscription/payment, redesign, новые reader
features и новый Modal deployment. Удаление legacy routing drift входит в scope.

---

## Workstream 0 — Immediate operational containment

### Task 0.0 — Restore Celery queue consumption

**Files/systems:** `docker-compose.prod.yml`, `backend/Dockerfile.celery`,
`backend/app/core/celery_app.py`, production Celery/Redis.

1. Остановить `celery-beat` на короткое maintenance window, чтобы backlog не менялся.
2. Сохранить counts/task names из broker DB и подтвердить, что `light` содержит только
   периодические housekeeping tasks. Не использовать глобальный `celery purge`.
3. Удалить только Redis queue key `light`; не трогать result backend, `normal`, `heavy`
   и остальные broker keys. Зафиксировать before/after counts.
4. Настроить NLP worker на `heavy,normal` и отдельный lean worker на `light`; healthcheck
   должен проверять конкретный worker, а не любой ответивший node.
5. Пересобрать/поднять workers и beat. Проверить `inspect active_queues`, затем отправить
   по одной безопасной probe-задаче в каждую очередь.

**Acceptance:** `heavy`, `normal` и `light` имеют ожидаемых consumers; stale backlog равен
нулю; новые beat tasks исполняются, а не накапливаются; controlled upload доходит до
`process_book_task`.

### Task 0.1 — Confirm and contain mixed production routing

**Files/systems:** production `feature_flags`, Celery env/logs,
`backend/app/services/consistency_manager.py`, `backend/app/tasks/book_tasks.py`,
`backend/app/tasks/image_tasks.py`.

1. Зафиксировать текущие `AI_PROVIDER`, `GEMINI_BACKEND`, `USE_MODAL_PIPELINE`,
   `USE_BATCH_MODE` и наличие provider credentials без вывода секретов.
2. Сохранить `USE_MODAL_PIPELINE=false` до отдельного решения: live Celery check уже
   подтвердил false; произвольное включение вернёт abandoned Modal extraction/image route.
3. На canary подтвердить фактический маршрут: Gemini extraction, direct OpenRouter
   consistency reduce, Gemini image. Сверить logs, `llm_usage_log` и `service_used`.
4. Если canary не проходит, не переключать provider вслепую: отключить новые пользовательские
   запуски проблемного шага штатным feature/API control и исправлять конкретный route.

**Acceptance:** текущий mixed route доказан end-to-end либо конкретный failing hop
локализован; Modal остаётся выключен; evidence не противоречит status/progress docs.

---


## Workstream 1 — Security and CI gate

### Task 1.1 — Rotate exposed Postbox credentials

**Manual systems:** Yandex Cloud IAM/Postbox, `/opt/fancai/app/.env`.

1. Создать новый static access key для service account с минимальной ролью Postbox sender.
2. Обновить `YANDEX_POSTBOX_ACCESS_KEY`/`YANDEX_POSTBOX_SECRET_KEY` в production `.env` без
   вывода значений в shell history/chat/logs.
3. Пересоздать только backend и выполнить реальную отправку password-reset.
4. Удалить старый ключ и подтвердить, что он больше не авторизуется.

**Acceptance:** новый тестовый reset email доставлен; старый ключ отозван; секреты не попали
в Git, логи или артефакты.

### Task 1.2 — Fix CI database contract before enabling Actions

**Files:** `.github/workflows/ci.yml`, `backend/tests/conftest.py`, при необходимости
`backend/.env.test.example`.

1. Выбрать один явный контракт: CI задаёт `TEST_DATABASE_URL` на существующую
   `fancai_test`; `conftest.py` не выводит второе `_test` из уже тестового имени.
2. Добавить unit-test для `_build_test_database_url()` с `fancai_dev`, `fancai_test` и URL
   query parameters.
3. Запустить backend suite в Python 3.12 с PostgreSQL 17/Redis 7, теми же env, что в CI.
4. Удалить `mypy ... || true`; либо сделать job обязательным, либо явно убрать из blocking
   CI до отдельного type-debt цикла — silent green запрещён.
5. После зелёного локального воспроизведения включить GitHub Actions repository permission.

**Acceptance:** fresh Actions run на `main` запускается и использует существующую test DB;
не скрывает mypy/test failures.

### Task 1.3 — Repair backend baseline

**Files:** `backend/app/`, `backend/tests/`, `backend/requirements.txt`.

1. Удалить 3 Ruff unused imports; применить Black только после фикса поведения.
2. Обновить stale schema tests под текущие Pydantic contracts или исправить schema, если
   устарел runtime contract. Решение принимать по API response, не по удобству теста.
3. Перевести `ConsistencyManager` tests с patch `get_openrouter_client` на
   `get_ai_provider`/provider injection; тесты не должны обращаться к Modal token или сети.
4. Исправить warning `_log_usage_to_db was never awaited`: при mocked `asyncio.create_task`
   coroutine должен быть закрыт/awaited либо usage logging вынесен в тестируемый scheduler.
5. Запустить полный suite с coverage threshold из `pytest.ini`.

**Acceptance:** Ruff, Black, pytest и coverage зелёные без network credentials и без
resource warnings.

### Task 1.4 — Upgrade vulnerable dependencies

**Files:** `backend/requirements.txt`, reproducible lock/constraints artifact,
`frontend/package.json`, `frontend/package-lock.json`.

1. Повторить `pip-audit` в чистом Python 3.12 окружении, а не по локальному Python 3.14 venv.
2. Обновлять backend пакетами по совместимым группам: auth/security, parser/image, HTTP,
   framework. После каждой группы — targeted tests; после всех — full suite.
3. Выполнить `npm audit`; обновить прямые `axios`, `dompurify`, `i18next-http-backend`,
   `react-router-dom` и транзитивные packages.
4. `epubjs@0.4` не принимать автоматически: это breaking renderer upgrade. Для
   `@xmldom/xmldom` сначала проверить targeted override/fork и reader regression suite.
5. Добавить audit jobs в blocking CI; исключения документировать advisory ID + reason +
   expiry date.

**Acceptance:** high/critical = 0 либо есть узкое временное исключение; reader/auth/upload
regressions отсутствуют.

---

## Workstream 2 — PWA and monitoring correctness

### Task 2.1 — Fix Workbox precache generation

**Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`.

1. Удалить глобальный override `brace-expansion@^2.0.2`, который ломает `glob@11` API.
2. Если старые `minimatch` ветки всё ещё требуют security override, ограничить override
   только совместимой major-веткой; не подменять dependency для всего дерева.
3. Добавить post-build assertion: `dist/sw.js`/manifest содержит ожидаемые hashed JS/CSS и
   число precache entries выше минимального порога, основанного на реальном build.
4. Прогнать Vitest, build и browser smoke offline/update flow.

**Acceptance:** build без `brace_expansion_1.expand` warning; SW precache включает app shell;
offline reload работает в Chromium и iOS/PWA regression не ухудшена.

### Task 2.2 — Restore Netdata data path

**Files:** `docker-compose.monitoring.yml`, `monitoring/netdata/exporting.conf`,
`monitoring/netdata/go.d/prometheus.conf`, `.env.production.example`.

1. Заменить VictoriaMetrics target `localhost:8428` на service DNS
   `victoriametrics:8428` внутри `monitoring_net`.
2. Дать Netdata network path к backend: подключить его к `fancai_network` и использовать
   `backend:8000/api/v1/health/metrics`, либо выбрать эквивалентный явный route. Localhost
   внутри Netdata запрещён.
3. Передать `METRICS_USER`/`METRICS_PASSWORD` в Netdata способом, который реально
   поддерживает его config parser; проверить итоговый rendered config внутри контейнера.
4. Добавить healthchecks для VictoriaMetrics ingestion и backend scrape, не только process
   liveness.
5. Пересоздать только monitoring stack и проверить logs/series ingestion.

**Acceptance:** 15 минут без `EXPPRW connection refused`; VictoriaMetrics query возвращает
новые Netdata series; backend request/latency metrics обновляются.

---

## Workstream 3 — Deploy and incident readiness

### Task 3.1 — Canonicalize production env and deploy scripts

**Files:** `scripts/deploy-production.sh`, `scripts/deploy.sh`, `.env.production.example`,
`docs/deployment/README.md`.

1. Закрепить `.env` как единственный runtime-файл; `.env.production.example` остаётся
   шаблоном, но никогда не читается Compose в production.
2. Проверить все `docker compose` вызовы на явный `--env-file .env` или единый cwd contract.
3. Исправить backup path так, чтобы копировался фактический env-файл; не логировать его
   содержимое.
4. Добавить preflight проверки Gemini/Vertex, email, metrics и required secrets по выбранным
   feature flags.
5. Выполнить `bash -n`, `docker compose config --quiet`, затем production dry-run/ordered
   deploy с backup и rollback checkpoint.

**Acceptance:** скрипт на сервере видит `.env`, создаёт backup, применяет migration head,
пересоздаёт нужные services и проходит deep health; rollback протестирован на безопасном
контрольном шаге.

### Task 3.2 — Document and test VPS outage recovery

**Files:** новый live runbook в `docs/operations/`, ссылка из `docs/operations/README.md`.

1. Зафиксировать признаки инцидента 2026-07-17: TCP connect есть, SSH banner/HTTPS зависают,
   web-console доступна; soft reboot восстановил сеть.
2. Описать Netcup console sequence: console login, route/address/DNS checks, process/load/OOM,
   nftables/fail2ban, graceful reboot → provider soft reboot только при необходимости.
3. После восстановления: SSH 2222, site/API/deep health, containers, migration head, disk,
   latest backup, failed units, kernel errors.
4. Не объявлять IPv6 RA error root cause без подтверждения; оформить как наблюдение и
   отдельную проверку provider/network config.

**Acceptance:** runbook выполняется без знания предыдущего чата и не требует root SSH до
восстановления сети.

---

## Workstream 4 — AI pipeline proof and rollback contract

### Task 4.1 — Make provider contract coherent

**Files:** `backend/app/core/ai_provider*.py`, `backend/app/core/gemini_client.py`,
`backend/app/services/consistency_manager.py`, `backend/app/tasks/image_tasks.py`,
`backend/app/services/nano_banana_generator.py`, `backend/app/services/imagen_generator.py`,
provider tests and docs.

1. Удалить параллельные route selectors: `ConsistencyManager` и `image_tasks` не должны
   обходить `AIProvider` через `USE_MODAL_PIPELINE`, прямой OpenRouter или прямой Gemini.
2. Решить контракт явно:
   - либо provider abstraction покрывает extraction, synthesis, reduce и images;
   - либо иметь отдельные явно названные `TEXT_AI_PROVIDER`/`IMAGE_AI_PROVIDER` с status API.
3. Определить fallback semantics: manual operational switch или automatic cross-provider
   fallback. Не называть manual switch fallback chain.
4. Удалить stale OpenRouter/FLUX/Pollinations/Modal strings из runtime UI/status/docstrings
   после обновления контракта.

**Acceptance:** provider contract покрыт tests для Gemini Developer, Gemini Vertex и
разрешённой rollback-ветки; status API/UI показывает фактический provider/model для каждой
операции; ни один task не имеет недокументированного feature-flag override.

### Task 4.2 — Production end-to-end canary

**Systems:** production API/UI, Postgres `llm_usage_log`, Celery/Redis logs.

1. Создать отдельную canary книгу без пользовательских данных.
2. Проверить upload, chapter parsing, extraction, consistency reduce, entity spoiler
   boundary, WebSocket completion status и отсутствие stuck Celery messages.
3. Сгенерировать одну картинку ожидаемым production provider и проверить
   `service_used`, storage/cache/UI.
4. Сверить `llm_usage_log` model/cost/latency, provider logs и удалить canary data штатным API.

**Acceptance:** полный путь завершён один раз без ручного изменения DB; фактические
provider/model attribution и cost record соответствуют документированному contract.

---

## Recommended order

1. Task 1.1 — credential rotation.
2. Task 0.0 — Celery queue recovery.
3. Task 0.1 — AI routing containment.
4. Tasks 1.2–1.4 — CI, tests, dependencies.
5. Tasks 2.1–2.2 — PWA и monitoring.
6. Tasks 3.1–3.2 — deploy/runbook.
7. Tasks 4.1–4.2 — долгосрочный provider contract и production proof.
8. Только после exit criteria — решение о Gemini admin panel milestone.

## Evidence captured by the audit

- Production deep health: DB, Redis, Celery healthy; migration `a1e2f3b4c5d6`.
- Celery worker отвечает healthy, но `inspect active_queues` показывает только `normal`.
  Broker counts: `heavy=0`, `normal=0`, `light=7212`; `light` состоит из 6532
  `close_abandoned_sessions`, 544 `cleanup_stuck_books`, 136
  `cleanup_expired_reset_tokens`.
- Frontend: 564 passed / 1 skipped; build warning leaves 2 precache entries.
- Backend Gemini suite: 71 passed; broad run 672 passed / 72 failed / 387 DB errors.
- GitHub Actions repository permission: disabled; last `main` run failed in 2025-11.
- Netdata exporter: repeated attempts to `127.0.0.1:8428`/`::1:8428`; VictoriaMetrics
  responds `OK` in its own container.
- Production dependency audit: frontend 7 high + 3 moderate; local backend venv 84 advisory
  matches across 20 packages (requires clean Python 3.12 confirmation).
- Production routing: `AI_PROVIDER=gemini`; live Celery check вернул
  `is_modal_enabled=False`, `USE_BATCH_MODE=false`. Modal SDK/credentials присутствуют,
  но route выключен.
- При false-ветке extraction/synthesis/images используют Gemini branches, а
  `ConsistencyManager` напрямую вызывает OpenRouter для reduce.
- Последние production image records: `service_used=imagen`, последний 2026-06-22;
  свежего полного canary нет.
