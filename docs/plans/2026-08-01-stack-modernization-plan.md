# План обновления стека fancai — 2026-08-01

> Основан на [`docs/research/2026-08-01-stack-modernization-audit.md`](../research/2026-08-01-stack-modernization-audit.md)
> и [`docs/_drafts/2026-08-01-stack-version-matrix.md`](../_drafts/2026-08-01-stack-version-matrix.md).
> **Статус: proposed.** Исполнение не начиналось — требуется согласование по §12.1 промпта.

---

## 0. Предусловия, без которых план невыполним

Эти факты установлены аудитом и меняют формулировку критериев выхода. Их нужно принять
до старта, иначе волны будут «закрываться» на недостижимых условиях.

| Предусловие | Состояние | Влияние |
| --- | --- | --- |
| GitHub Actions на репозитории | **отключены**, последний прогон `main` упал в 2025-11 (источник: `docs/superpowers/plans/2026-07-18-production-reliability-baseline.md`) | «CI зелёный» нельзя использовать как критерий выхода Волны 0 до включения Actions |
| Backend-тесты | по снимку 2026-07-18: 672 passed / 72 failed / 387 DB errors при широком прогоне | «pytest зелёный» — **не** текущая база; нужен зафиксированный до-срез, иначе поломки от обновления неотличимы от унаследованных |
| Frontend-тесты | по тому же снимку: 564 passed / 1 skipped | база пригодна |
| Workbox precache | сборка оставляет 2 пустых entry из-за override `brace-expansion` | снятие override в Волне 0 должно это починить; проверять |
| Пересечение с планом надёжности | Task 1.4 того плана — это по сути Волны 1–3 здесь | выполнять один раз, не дублировать |

**Первое действие перед Волной 0 — зафиксировать до-срез тестов** (`pytest` и `npm test`
с сохранением списка падающих тестов). Без него ни один критерий выхода не проверяем.

---

## Волна 0 — Разблокировка

Ничего не обновляет функционально; делает процесс обновления воспроизводимым.

### Состав

| # | Изменение | Файлы |
| --- | --- | --- |
| 0.1 | Запинить `hypothesis==6.164.0` | `backend/requirements.txt:58` |
| 0.2 | Заменить `modal>=0.73` на точный пин `modal==1.5.3` (удаление — в Волне 2, после дочистки кода) | `backend/requirements.txt:89` |
| 0.3 | `security.yml`: `PYTHON_VERSION 3.11 → 3.12`, `NODE_VERSION 18 → 22` | `.github/workflows/security.yml:23-24` |
| 0.4 | `trivy-action@master → @v0.36.0` (5 вхождений), `trufflehog@main → @v3.96.0` (3 вхождения) | `ci.yml:280,297`, `security.yml:220,248,282,310,327,336` |
| 0.5 | Закрепить плавающие теги сервисов CI: `postgres:17-alpine → 17.10-alpine`, `redis:7-alpine → 7.4.10-alpine` | `ci.yml:51,65` |
| 0.6 | Переписать `.pre-commit-config.yaml`: убрать ссылку на несуществующий `backend/pyproject.toml`, убрать `detect-secrets` либо создать `.secrets.baseline`, поднять хуки до версий из `requirements.txt` (`ruff 0.15.6`, `black 26.3.1`, `mypy 1.19.1`), `eslint 8.54.0 → 9.39.4`, `language_version: python3.12` | `.pre-commit-config.yaml` |
| 0.7 | Удалить `overrides.cross-spawn` (no-op), удалить `overrides.brace-expansion` (вреден), поднять `overrides.serialize-javascript` до `^7.0.5` | `frontend/package.json:101-105` |
| 0.8 | Зафиксировать текущую конфигурацию прода в git: закоммитить правки `Caddyfile` и `docker-compose.prod.yml` | `Caddyfile`, `docker-compose.prod.yml` |

Пункт 0.8 требует отдельного согласования: это не обновление версии, а фиксация того,
что боевая конфигурация сейчас существует только как незакоммиченный diff.

### Коммиты

```
ci: pin floating action refs and align security workflow runtimes
chore(deps): pin hypothesis and modal, remove floating floors
build(precommit): repair hook config and sync tool versions
chore(deps): drop harmful brace-expansion override, refresh overrides
```

### Проверка

```bash
pre-commit run --all-files                         # должен пройти
cd frontend && rm -rf node_modules package-lock.json && npm install && npm audit
cd frontend && npm run build && npm run build:size # precache должен содержать реальные assets
git diff --stat                                    # 0.8: рабочее дерево чистое
```

**Критерий выхода:** `pre-commit run --all-files` проходит; `npm audit` во фронте не содержит
находок от `brace-expansion`/`cross-spawn`; сборка фронта не выдаёт warning
`brace_expansion_1.expand`; precache содержит реальные хешированные JS/CSS, а не 2 пустых entry.
«CI зелёный» переносится в отдельный критерий после включения Actions.

### Откат

`git revert` каждого коммита независимо. Для 0.7 — восстановить блок `overrides`
и перегенерировать lock. Риск отката нулевой: продовый код не затронут.

---

## Волна 1 — Удаление мёртвого веса

Самая выгодная волна: убирает 20 уникальных advisory без единого обновления версии.

### Состав

| # | Изменение | Что даёт |
| --- | --- | --- |
| 1.1 | Удалить `pillow==12.1.1` | −18 advisories |
| 1.2 | Удалить `ecdsa==0.19.1` | −2 advisories |
| 1.3 | Удалить `python-decouple==3.8` | −1 мёртвый пин |
| 1.4 | Удалить `python-dateutil==2.9.0.post0` | −1 мёртвый пин |
| 1.5 | Удалить `dompurify` + `@types/dompurify` из фронта и правило `dompurify` из `manualChunks` (`vite.config.ts:107`) | −13 advisories |
| 1.6 | Удалить `i18next-http-backend` | −1 advisory |
| 1.7 | Удалить `sentence-transformers`, `scikit-learn` и дубль `pgvector` из `Dockerfile.celery:38-40` | −размер celery-образа |
| 1.8 | Удалить блок `devDependencies` и `package-lock.json` в корне, оставив скрипты | −4 high-advisory отдельного дерева |

### Коммиты

```
chore(deps): drop unused backend pins (pillow, ecdsa, decouple, dateutil)
chore(deps): drop unused frontend deps (dompurify, i18next-http-backend)
build(docker): drop unused ML packages from celery image
chore(deps): collapse root package.json to scripts only
```

### Проверка

```bash
cd backend && python -c "import app.main"          # импорт приложения не сломан
cd backend && pytest -v                            # сверить с до-срезом
cd frontend && rm -rf node_modules package-lock.json && npm install
cd frontend && npm run lint && npm run type-check && npm test && npm run build:size
npm run build && npm test                          # из корня — скрипты должны работать
docker build -f backend/Dockerfile.celery -t fancai-celery:wave1 backend/
pip-audit -r backend/requirements.txt              # сравнить с базовым срезом
```

**Критерий выхода:** число уникальных advisory Python снизилось с 63 до ≤43;
`npm audit` во фронте не содержит `dompurify` и `i18next-http-backend`;
корневой `npm audit` пуст; список падающих backend-тестов не вырос относительно до-среза;
`docker build` celery проходит и образ меньше 1,78 ГБ.

**Ожидаемые поломки:** ни одной — все удаляемые пакеты не имеют импортов и пустой `Required-by`.
Если `pip install` начнёт тянуть `pillow` транзитивно, это ожидаемо и нормально: важно,
что версия перестанет быть закреплена на уязвимой.

### Откат

`git revert`; каждое удаление независимо.

---

## Волна 2 — Backend: патчи, миноры и разблокировка starlette

### Состав

**2.1. Атомарная группа «starlette» — только целиком:**

```
fastapi==0.135.1                         → 0.141.1
prometheus-fastapi-instrumentator==7.1.0 → 8.1.0
```

Порознь не разрешится: 7.1.0 пинит `starlette<1.0.0`. После группы starlette
поднимется до 1.3.1 и закроет 5 CVE.

**2.2. Безопасность и HTTP:**

```
PyJWT[crypto]==2.12.1  → 2.13.0      python-multipart==0.0.22 → 0.0.32
aiohttp==3.13.3        → 3.14.3      requests==2.32.5         → 2.34.2
lxml==6.0.2            → 6.1.1       cryptography==46.0.5     → 50.0.0
pydantic-settings==2.13.1 → 2.14.2
```

**2.3. Сервер и данные:**

```
uvicorn[standard]==0.42.0 → 0.52.0   gunicorn==25.1.0 → 26.0.0
sqlalchemy==2.0.48 → 2.0.51          alembic==1.18.4  → 1.18.5
pgvector==0.4.2    → 0.5.0           celery==5.6.2    → 5.6.3
pydantic==2.12.5   → 2.13.4          beautifulsoup4==4.14.3 → 4.15.0
prometheus-client==0.24.1 → 0.26.0   google-genai==2.8.0 → 2.16.0
```

**2.4. Инструменты и стабы:**

```
pytest==9.0.2 → 9.1.1        pytest-asyncio==1.3.0 → 1.4.0
pytest-cov==7.0.0 → 7.1.0    black==26.3.1 → 26.5.1
ruff==0.15.6  → 0.16.1       types-requests → 2.33.0.20260712
types-aiofiles → 25.1.0.20260518
sqlalchemy[mypy] → 2.0.51 (синхронно с 2.3)
```

**2.5. Дочистка Modal** (после подтверждения, что ветки недостижимы): удалить
`modal_client.py`, `prompts/modal_extraction.py`, ветки `use_modal` в `book_tasks.py`,
`image_tasks.py`, `consistency_manager.py`, затем убрать пин `modal` и переменные
`MODAL_TOKEN_*` из compose. **Это рефакторинг, а не обновление версии** — выполнять только
по явному согласованию; иначе оставить пин 1.5.3 из Волны 0.

**Не входит:** `mypy` (HOLD — бессмысленно при `ignore_errors=True`),
`redis-py` (HOLD — kombu), `kombu` (уже последняя), `torch`/`gliner2` (HOLD — флаг выключен).

### Коммиты

```
chore(deps): unblock starlette via fastapi 0.141 + instrumentator 8.1
chore(deps): patch security-relevant backend packages
chore(deps): update server, ORM and observability packages
chore(deps): update test and lint tooling, sync type stubs
docs(deps): fix stale Gemini 3.0 comment in requirements
```

### Проверка

```bash
cd backend && pip install -r requirements.txt
cd backend && python -c "import app.main; print('ok')"
cd backend && pytest -v                     # сверить список падающих с до-срезом
cd backend && ruff check app/ && black --check app/
pip-audit -r backend/requirements.txt
docker build -f backend/Dockerfile.prod   -t fancai-backend:wave2 backend/
docker build -f backend/Dockerfile.celery -t fancai-celery:wave2  backend/
docker compose -f docker-compose.dev.yml up -d && sleep 40
docker compose -f docker-compose.dev.yml ps   # все healthy
curl -fsS localhost:8000/health
curl -fsS localhost:8000/api/v1/health/metrics | head -5   # instrumentator жив
```

**Критерий выхода:** приложение импортируется и стартует; `/health` отвечает; метрики
Prometheus отдаются (проверка того, что instrumentator 8 подключился); `pip-audit`
не содержит `starlette`, `PyJWT`, `python-multipart`, `aiohttp`, `lxml`, `requests`,
`cryptography`, `pydantic-settings`; список падающих тестов не вырос; оба `docker build` проходят.

**Ожидаемые поломки:**

| Что | Почему | Что делать |
| --- | --- | --- |
| Тесты, патчащие внутренности starlette | переход 0.52 → 1.3 | чинить тест, не откатывать пакет |
| `Instrumentator().instrument(app)` | публичный API не менялся, но middleware принимает `ASGIApp` вместо `Starlette` | вызов в `main.py:127` не передаёт тип явно — риск низкий |
| `cryptography` 50 при сборке образа | нужен wheel под linux/amd64 | wheels публикуются; на локальном Intel-Mac с 49.0.0 wheel'ов x86_64 больше нет — использовать arm64 или Docker |
| `gunicorn` 26 требует `gunicorn_h1c>=0.6.5` | быстрый парсер | подтянется автоматически; проверить, что образ собрался |

### Откат

Каждая группа — отдельный коммит; `git revert` группы. Группа 2.1 откатывается только
целиком. При откате обязательна пересборка образов.

---

## Волна 3 — Frontend: патчи, миноры и безопасность

### Состав

**3.1. Безопасность (наивысший приоритет):**

```
axios            1.13.6 → 1.19.0    (30 advisories)
react-router-dom 7.13.1 → 7.18.2    (12 advisories, RCE/open redirect/DoS)
vite             8.0.0  → 8.2.0     (5 advisories)
@vitest/ui       4.1.0  → 4.1.10    (flatted high)
```

**3.2. Атомарная группа PWA — только целиком:**

```
vite-plugin-pwa 1.2.0 → 1.3.0
workbox-{background-sync,cacheable-response,expiration,precaching,routing,strategies,window} 7.4.0 → 7.4.1
```

Peer-требование `vite-plugin-pwa@1.3.0` — `workbox-build ^7.4.1` и `workbox-window ^7.4.1`.

**3.3. Остальные миноры и патчи** (все `UPGRADE-NOW` из матрицы §2): React 19.2.8,
Radix-примитивы, TanStack, dexie + dexie-react-hooks, motion, react-hook-form, zod,
zustand, tailwindcss + @tailwindcss/vite 4.3.3, tailwind-merge, @hawk.so/javascript,
@hookform/resolvers, globals, typescript-eslint 8.65, eslint-plugin-*, @vitejs/plugin-react,
vitest + @vitest/coverage-v8 4.1.10, @playwright/test 1.62.1, @types/react, @types/react-dom.

**Не входит:** TypeScript (HOLD), ESLint 10 (Волна 4), i18next 26 (Волна 4),
lucide-react 1 (Волна 4), jsdom 30 (Волна 4), jest-dom 7 (Волна 4), epubjs (HOLD).

### Коммиты

```
chore(deps): update axios, react-router and vite to patched versions
chore(deps): bump vite-plugin-pwa and workbox to 7.4.1
chore(deps): update remaining frontend minors and patches
```

### Проверка

```bash
cd frontend && rm -rf node_modules package-lock.json && npm install
cd frontend && npm ci                          # чистая установка с нуля должна пройти
cd frontend && npm audit
cd frontend && npm run lint && npm run type-check && npm test
cd frontend && npm run build && npm run build:size
cd frontend && npm run test:e2e
```

**Критерий выхода:** `npm ci` проходит с нуля; `npm audit` не содержит high, достижимых
в рантайме (остаются только `@xmldom/xmldom` через epubjs и инструментальные);
lint без warning; `build:size` в бюджете 500 КБ на чанк / 800 КБ raw; e2e зелёные;
`package-lock.json` перегенерирован и закоммичен.

**Ожидаемые поломки:**

| Что | Почему |
| --- | --- |
| Перехваты axios в тестах | 1.13 → 1.19, менялась обработка прототипного загрязнения в merge конфигов; `src/api/client.ts` использует interceptors и singleton-очередь refresh — проверить сценарий 401 |
| Тесты роутинга | 7.13 → 7.18 меняет обработку `//`-префиксов и backslash в `<Link>` |
| Snapshot-тесты Radix | патчи меняют генерируемые id |
| Размер бандла | обновление tailwind 4.2 → 4.3 может изменить объём CSS |

### Откат

`git revert` + `npm ci` из восстановленного lock. Группа 3.2 откатывается целиком.

---

## Волна 4 — Мажоры фронтенда

Каждый пункт — отдельный коммит с независимым откатом.

| # | Обновление | Риск | Что проверять отдельно |
| --- | --- | --- | --- |
| 4.1 | `eslint 9.39.4 → 10.8.0` + `@eslint/js 10.0.1` | R2 | проект уже на flat config; кастомных правил нет; проверить, что `--max-warnings 0` держится |
| 4.2 | `i18next 25 → 26.3.6` **вместе с** `react-i18next 16 → 17.0.11` | R2 | `src/lib/i18n.ts` использует только `interpolation.escapeValue` — удалённые опции не задействованы; проверить переключение языка и все `t()` |
| 4.3 | `jsdom 29 → 30.0.1` | R2 | engines `^22.22.2` — убедиться, что Node в CI и образах ≥22.22.2 |
| 4.4 | `@testing-library/jest-dom 6 → 7.0.0` | R2 | `@testing-library/dom` становится обязательным peer — он уже в devDependencies |
| 4.5 | `@types/node 25 → 26.1.2` | R1 | peer vitest допускает `>=24` |
| 4.6 | `lucide-react 0.577 → 1.28.0` | R2 | **89 файлов импортируют иконки по именам**; после обновления прогнать `type-check` и визуальную проверку ключевых экранов |
| 4.7 | `gitleaks-action v2 → v3.0.0` | R1 | требует прогона security-workflow |
| 4.8 | `actions/{checkout,setup-python,setup-node,upload-artifact}` до v7 | R1 | выполнять после включения Actions |

### Проверка

Та же, что в Волне 3, плюс после 4.6 — ручной осмотр экранов с иконками
(библиотека, читалка, панель сущностей, настройки).

**Критерий выхода:** всё из Волны 3 плюс визуальное подтверждение по 4.6.

---

## Волна 5 — Базовые образы и инфраструктура

| # | Изменение | Файл |
| --- | --- | --- |
| 5.1 | `alpine:3.21 → 3.23` (EOL текущей 2026-11-01) | `frontend/Dockerfile.prod:47` |
| 5.2 | `caddy:2.11.1-alpine → 2.11.4-alpine` | `docker-compose.{prod,dev}.yml:25` |
| 5.3 | `pgvector/pgvector:0.8.2-pg17 → 0.8.6-pg17` | `docker-compose.prod.yml:275` |
| 5.4 | `postgres:17.9-alpine → 17.10-alpine` | `docker-compose.dev.yml:191` |
| 5.5 | `redis:7.4.8-alpine → 7.4.10-alpine` | оба compose |
| 5.6 | Мониторинг: netdata `v2.10.4`, victoria-metrics `v1.148.0`, uptime-kuma `2.4.0`, dozzle `v10.6.14` | `docker-compose.monitoring.yml` |
| 5.7 | Поднять лимит памяти `uptime-kuma` (сейчас 96 % от 128 МБ) и проверить лимиты netdata/VM | `docker-compose.monitoring.yml` |
| 5.8 | `node:22-alpine → 24-alpine` | `frontend/Dockerfile.{prod,dev}` |
| 5.9 | Убрать избыточные `gcc`/`g++` рядом с `build-essential`; убрать `libmagic1` из dev-образа; убрать дублирующий `wget` или `curl` из фронт-dev | 5 Dockerfile |
| 5.10 | Добавить OCI-метки `org.opencontainers.image.{revision,created,version}` во все Dockerfile и передачу build-args в compose | 5 Dockerfile + compose |

Пункт 5.10 — прямой ответ на находку «связь образ ↔ коммит недоказуема». Формально это
не обновление версии, но без него следующий такой аудит упрётся в ту же стену.

**Не входит:** PostgreSQL 18 (`UPGRADE-STAGED`, требует dump/restore — отдельный план),
`postgres-backup-local:18` (двигать только с СУБД), `mher/flower` (`REPLACE`, backlog).

### Проверка

```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d && sleep 60
docker compose -f docker-compose.dev.yml ps          # все healthy
docker exec <pg>    psql -U fancai -d fancai -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
docker exec <redis> redis-server -v
docker exec <caddy> caddy version
docker image inspect fancai-backend:latest --format '{{json .Config.Labels}}'   # 5.10
cd frontend && npm run build && npm run build:size
```

**Критерий выхода:** локальный стек поднимается, все сервисы healthy; расширение `vector`
резолвится в 0.8.6; сборка фронта на Node 24 проходит и укладывается в бюджет;
OCI-метки присутствуют и содержат актуальный SHA.

### Откат

Вернуть теги образов и `docker compose up -d --force-recreate`. Данные не затрагиваются:
ни один пункт волны не меняет мажор СУБД и не трогает volumes.

---

## Волна 6 — Переключение AI-моделей

Только после согласования по §8.4 и smoke-проверки из
[`docs/research/2026-08-01-llm-model-selection.md`](../research/2026-08-01-llm-model-selection.md) §7.

| # | Изменение | Файл:строка |
| --- | --- | --- |
| 6.1 | Добавить `gemini-3.6-flash` и `gemini-3.5-flash-lite` в таблицу цен | `gemini_pricing.py:8-13` |
| 6.2 | `GEMINI_EXTRACTION_MODEL → "gemini-3.6-flash"` | `config.py:67` |
| 6.3 | `GEMINI_LITE_MODEL → "gemini-3.5-flash-lite"` | `config.py:68-70` |
| 6.4 | `OPENROUTER_IMAGE_MODEL → "google/gemini-3.1-flash-image"` | `config.py:60-62` |
| 6.5 | `FALLBACK_MODELS → ["google/gemini-3.6-flash", "google/gemini-3.5-flash-lite"]` | `openrouter_client.py:57-60` |
| 6.6 | `GeminiConfig.model_*` → читать из `settings` | `gemini_extractor.py:126-132` |
| 6.7 | Убрать `temperature` из вызовов и протокола | `gemini_client.py:83,89,110,118`; `ai_provider.py:19,28`; `gemini_extractor.py:629` |
| 6.8 | `AI_PROVIDER → "gemini"` (по согласованию) | `config.py:66` |
| 6.9 | Снять комментарий «ID подтвердить smoke-тестом A3.1» | `config.py:72` |
| 6.10 | Обновить `test_config_gemini.py` | `backend/tests/core/test_config_gemini.py:6` |
| 6.11 | Инвалидировать LLM-кэш **локального** Redis DB 0 (DB 1 — брокер Celery — не трогать) | локальная операция |

> **Граница §12.2.** Все пункты 6.1–6.10 — правки в репозитории. Пункт 6.11 в рамках этой
> задачи выполняется **только на локальном стеке**. Инвалидация продового Redis, смена env
> на проде и пересоздание боевых контейнеров — операции деплоя; они **не входят** ни в эту
> волну, ни в Фазу 5 и требуют отдельного явного разрешения. Согласование плана обновлений
> не является разрешением трогать прод.

### Порядок

6.1 строго перед 6.2 — иначе учёт расходов обнулится. 6.6 перед 6.2 — иначе ключ кэша
и метрики останутся с именем старой модели. 6.11 после всех правок.

### Проверка

Выполняется на локальном стеке (`docker-compose.dev.yml`), не на проде.

```bash
cd backend && pytest tests/core/test_config_gemini.py tests/services/test_extractor_provider.py -v
# локальный smoke на контрольной книге:
#   загрузка EPUB → парсинг → извлечение → Entity Wiki → генерация изображения → чтение
docker compose -f docker-compose.dev.yml exec postgres psql -U fancai -d fancai -c \
  "SELECT model, COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), ROUND(SUM(cost_dollars),4) \
   FROM llm_usage_log WHERE created_at > now() - interval '1 hour' GROUP BY 1;"
```

**Критерий выхода:** в локальном `llm_usage_log` появились записи с `model='gemini-3.6-flash'`
и **ненулевой** `cost_dollars`; изображение сгенерировано с `service_used=imagen`;
полнота извлечения не хуже базы из smoke-шага 4; расчётная стоимость обработки контрольной
главы снизилась относительно 3.5 Flash.

### Откат

В репозитории: `git revert` коммита волны — дефолты `config.py` возвращаются к 3.5 Flash.
Таблицу цен откатывать не нужно: лишние записи безвредны.

Отдельно, **вне этой задачи**: на проде откат делается переменной окружения
`GEMINI_EXTRACTION_MODEL=gemini-3.5-flash` без пересборки образа с последующим
пересозданием backend и celery. Это шаг deployment runbook, а не Фазы 5.

---

## Волна 7 — Кандидаты `REPLACE` (за пределами этой задачи)

Не выполняется. Перечислено для полноты графа.

| Компонент | Почему отдельно |
| --- | --- |
| `epub.js` | обновления нет, «фикс» из audit — откат в 2018 год; замена = переписывание 28 хуков и CFI-логики |
| `@xmldom/xmldom` через override | требует полной регрессии читалки; тихая поломка |
| `mher/flower` | образ не публикуется с 2023-08-13; нужен выбор замены или отказ |
| PostgreSQL 17 → 18 | dump/restore боевой БД |
| TypeScript 6/7 | заблокирован `typescript-eslint`; требует двойного alias и снятия `strict: false` |
| Lock-файл для бэкенда | смена инструментария (uv/pip-tools/constraints), не обновление версии |
| mypy 2 + снятие `ignore_errors` | type-debt цикл |

---

## Сводный порядок и трудозатрата

| Волна | Содержание | Трудозатрата | Блокирует |
| --- | --- | --- | --- |
| 0 | Разблокировка | 3–5 ч | всё остальное |
| 1 | Удаление мёртвого веса | 2–3 ч | — |
| 2 | Backend | 6–10 ч | Волну 6 (нужен google-genai 2.16) |
| 3 | Frontend минорный | 4–6 ч | Волну 4 |
| 4 | Frontend мажорный | 6–10 ч | — |
| 5 | Образы и инфраструктура | 4–6 ч | — |
| 6 | AI-модели | 3–4 ч + smoke ~$0,90 | — |
| 7 | `REPLACE` | отдельные проекты | — |

Волны 1 и 5 независимы от остальных и могут идти параллельно с 2–4.
Волна 6 требует завершённой Волны 2.

## Общая процедура отката

1. Каждая волна — отдельная ветка от `main`, мержится после зелёного критерия выхода.
2. Внутри волны атомарные группы (2.1, 3.2) откатываются только целиком.
3. После отката любого backend-коммита — пересборка `fancai-backend` и `fancai-celery`.
4. После отката любого frontend-коммита — `npm ci` из восстановленного lock и пересборка.
5. Деплой на прод в план **не входит** (§12.2) и выполняется отдельным решением.
