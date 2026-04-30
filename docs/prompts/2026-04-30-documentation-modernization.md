# Промпт: Глубокая модернизация документации проекта fancai

**Целевая модель:** Claude Opus 4.7 (1M context), max effort
**Дата составления:** 2026-04-30
**Автор задачи:** sandk (sandkme@gmail.com)
**Длительность работы:** 1–2 рабочих дня (с перерывами для review)

---

## 1. Роль и цель

Ты — **старший технический писатель**, только что присоединившийся к команде fancai. Задача: навести порядок в документации проекта, которая системно устарела за последние 2–3 месяца после серии product pivots. Работа разовая, но критичная: на основе этой документации новые контрибьюторы и потенциальные пользователи будут принимать решение о вовлечении.

**Главная цель:** все важные `.md` файлы (корень репо + ключевые в `docs/`) **точно и без украшений** отражают текущее состояние проекта по состоянию на 2026-04-30.

**Принцип:** не выдумывай, верифицируй. Источник истины — код и оперативные артефакты GSD, а не существующие `.md`.

---

## 2. Контекст проекта

**fancai** — веб-приложение для чтения художественной литературы с двумя AI-функциями:

1. **Entity Wiki / интерактивный глоссарий (главная фича)** — AI-собранная энциклопедия персонажей, локаций, объектов с защитой от спойлеров: показывает информацию только до текущей главы читателя.
2. **AI-генерация иллюстраций** — извлекает визуальные описания из текста, генерирует картинки.

Production: <https://fancai.ru>. Mobile-first PWA, offline-first ридер.

### Текущий стек (production, верифицировано на 2026-04-30)

**Frontend:**

- React 19 + TypeScript 5.7
- Vite 7 (build tool)
- TanStack Query (server state)
- Zustand (client state, `frontend/src/stores/`)
- Tailwind CSS
- epub.js 0.3.93 (рендеринг EPUB через CFI)
- IndexedDB (offline кэш глав)
- vitest + Playwright (тесты)

**Backend:**

- Python 3.12
- FastAPI 0.135.1 (см. `backend/requirements.txt:2`)
- SQLAlchemy 2.0.48 + Alembic 1.18.4
- PostgreSQL 17 (с pgvector 0.4.2)
- Redis 7.3 + Celery 5.6.2
- uv (package manager)
- pytest

**AI (всё через OpenRouter):**

- LLM: **Gemini 2.5 Flash tiered + Gemini 3.1 Flash Lite** (после A/B-теста с Qwen3.5-397B, см. коммиты `5f6f3093`, `e8f6a2f0`, `ab2ec5ca`, `0b2b3a45`)
- Image generation: **FLUX.2 Klein**
- Pollinations.ai как fallback для картинок

**Infrastructure:**

- Docker Compose
- Caddy (reverse proxy)
- Hawk (error tracking, опционально)
- Netdata + Uptime Kuma + Dozzle (мониторинг)

### Эволюция за последние 2–3 месяца (что нужно учесть в доках)

| Дата           | Событие                                                                                      | Источник                         |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| 2025-12        | Удалена NLP-система (RAM-оптимизация)                                                        | `backend/requirements.txt:21–22` |
| 2026-03-09     | Shipped v1.0+v1.1 (production-ready, mobile/PWA)                                             | `.planning/MILESTONES.md`        |
| 2026-03-13     | Shipped v1.2 (reader stability, gestures, Vaul panels)                                       | `.planning/MILESTONES.md`        |
| 2026-03-23     | Shipped v1.3 (iOS reader navigation fixes)                                                   | `.planning/MILESTONES.md`        |
| 2026-03-27     | v1.4 abandoned: strategic pivot к Modal vLLM                                                 | `.planning/STATE.md`             |
| 2026-03-29     | v1.5 closed-partial: Modal staging провален (40+ мин вместо 7–8), pivot обратно к OpenRouter | `.planning/STATE.md`             |
| 2026-04-22..26 | LLM A/B: Gemini 3.1 Flash Lite → Qwen3.5-397B → Gemini 2.5 Flash tiered (текущий)            | git log                          |
| 2026-04        | v1.6 TBD: кандидат — Gemini Direct API + admin panel                                         | `.planning/ROADMAP.md`           |

---

## 3. Состояние документации (на момент задачи)

### Корень репозитория

| Файл              | Размер | Дата       | Состояние                                                                                                                                                                                                                                                                                                                                                          | Действие                                      |
| ----------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `README.md`       | 17KB   | 2026-02-03 | **Устарел.** Imagen 4 (на самом деле FLUX.2 Klein), Gemini 3.0 Flash (на самом деле 2.5 Flash tiered + 3.1 Flash Lite), PostgreSQL 15 (на самом деле 17), Vite 6 (на самом деле 7), FastAPI 0.125 (на самом деле 0.135.1), Subscription model (не реализовано — out of scope). Описана только image generation; Entity Wiki вообще не упомянут как отдельная фича. | **Полная переписка**                          |
| `README-ru.md`    | 19KB   | 2026-01-15 | Ещё старее английского.                                                                                                                                                                                                                                                                                                                                            | **Полная переписка**, синхронно с английской  |
| `CONTRIBUTING.md` | 21KB   | 2025-11-14 | **Критически устарел.** Называет проект "BookReader AI" (старое имя!), Python 3.11, не упоминает GSD, uv, ruff.                                                                                                                                                                                                                                                    | **Полная переписка**                          |
| `CHANGELOG.md`    | 1KB    | 2026-02-25 | Очень короткий, без milestone history v1.0..v1.5.                                                                                                                                                                                                                                                                                                                  | **Расширить**                                 |
| `CLAUDE.md`       | 5KB    | 2026-03-18 | Относительно свежий, в целом точный.                                                                                                                                                                                                                                                                                                                               | **Точечная правка**: проверить версии моделей |
| `AGENTS.md`       | 29KB   | 2026-04-27 | OMX (oh-my-codex) конфиг для AI-CLI. **НЕ пользовательская документация.**                                                                                                                                                                                                                                                                                         | **Не трогать**                                |
| `GEMINI.md`       | 5KB    | 2026-03-25 | Конфиг для Gemini CLI.                                                                                                                                                                                                                                                                                                                                             | **Не трогать**                                |

### `docs/`

```
docs/
├── README.md                       — навигатор (актуализировать)
├── SECURITY.md                     — security policy (актуализировать)
├── DEVELOPMENT_PROGRESS.md         — от 2025-08, архивировать
├── FRONTEND-AUDIT.md               — март, можно перенести в reports/
├── IMAGE-GENERATION-BUGS-AUDIT.md  — март, можно перенести в reports/
├── AUDIT-2026-03-21-...md          — перенести в reports/
├── pencil-landing-prompt.md        — артефакт для UI-генерации, оставить
├── variant-prompt.md               — артефакт для UI-генерации, оставить
│
├── ci-cd/                          — README + 8 файлов, актуализировать README
├── deployment/                     — 11 файлов, актуализировать README или создать
├── development/                    — README + 24 файла (большая часть устарела)
├── operations/                     — README + 5 файлов, актуализировать
├── security/                       — README, актуализировать
├── ru/                             — русские версии, синхронизировать
├── design/                         — UI-промпты, не трогать
├── ios/                            — iOS-планы (отложены), оставить как есть
│
├── reports/                        — 200+ исторических отчётов, НЕ ТРОГАТЬ (архив)
├── research/                       — 50+ research-документов, НЕ ТРОГАТЬ (архив)
├── plans/                          — артефакты прошлой работы, НЕ ТРОГАТЬ
├── prompts/                        — артефакты для AI-агентов, НЕ ТРОГАТЬ
├── refactoring/                    — артефакты ноябрьского рефакторинга, НЕ ТРОГАТЬ
├── reference/, guides/, explanations/, questions/, analysis/  — точечно проверить
```

### `.planning/` (GSD-внутреннее)

**НЕ ТРОГАТЬ.** Обновляется через `/gsd:*` команды:

- `PROJECT.md`, `STATE.md`, `ROADMAP.md` — оперативные данные, актуальны на 2026-04-26
- `MILESTONES.md`, `REQUIREMENTS.md`, `RETROSPECTIVE.md` — архивы

---

## 4. Источники истины

В порядке убывания приоритета (если конфликт — побеждает верхний):

1. **Исходный код**:
   - `backend/app/` (FastAPI, models, services, tasks, routers)
   - `frontend/src/` (App.tsx, components, hooks, api, stores)
   - `modal/` (если ещё используется — проверь)
2. **Манифесты зависимостей**:
   - `backend/requirements.txt` — реальные Python-версии
   - `frontend/package.json` — реальные npm-версии и scripts
   - `backend/pyproject.toml` (если есть)
3. **Инфраструктура**:
   - `docker-compose.yml`, `docker-compose.prod.yml` — реальные сервисы
   - `Caddyfile`, `caddy/Caddyfile` — реальные роуты
   - `backend/Dockerfile`, `frontend/Dockerfile`
4. **Эволюция БД**:
   - `backend/alembic/versions/` — последние миграции
5. **Оперативные артефакты GSD**:
   - `.planning/PROJECT.md` — vision, scope, what's-in/out
   - `.planning/STATE.md` — текущее состояние, blockers
   - `.planning/ROADMAP.md` — milestones и phases
6. **Конвенции для AI**:
   - `CLAUDE.md` — актуальный краткий стек, известные баги, профиль разработчика
7. **`git log`** — что произошло (commit messages не врут, в отличие от README)

### НЕ источники истины

- Старые отчёты в `docs/reports/` — снапшоты прошлых анализов
- Промпты в `docs/prompts/` — артефакты для AI
- Research в `docs/research/` — гипотезы, могут быть устаревшими
- Сами `README.md` / `README-ru.md` — то, что обновляем

---

## 5. Скоуп

### В скоупе — обновить или переписать

**Корень:**

- [ ] `README.md` — полная переписка
- [ ] `README-ru.md` — полная переписка, синхронно с английской
- [ ] `CONTRIBUTING.md` — полная переписка (имя проекта, актуальные процессы, GSD)
- [ ] `CHANGELOG.md` — расширить с milestone history v1.0..v1.5
- [ ] `CLAUDE.md` — точечная сверка с реальностью

**docs/:**

- [ ] `docs/README.md` — навигатор по документации
- [ ] `docs/SECURITY.md` — security policy
- [ ] `docs/development/README.md` — dev setup, conventions, тесты, debugging
- [ ] `docs/deployment/README.md` (создать, если нет) — production deploy quick reference
- [ ] `docs/operations/README.md` — runbooks, мониторинг, инциденты
- [ ] `docs/ci-cd/README.md` — GitHub Actions, branch protection
- [ ] `docs/security/README.md` — security overview (если есть)
- [ ] `docs/ru/README.md` — синхронизировать с `docs/README.md`

### ВНЕ скоупа (НЕ ТРОГАТЬ)

- `docs/reports/*` — исторический архив
- `docs/research/*` — research, может быть устаревшим
- `docs/plans/*` — артефакты прошлой работы
- `docs/prompts/*` — для AI-агентов
- `docs/refactoring/*` — артефакты конкретного рефакторинга 2025-11
- `docs/ios/*` — отложенные планы, оставить как есть
- `docs/analysis/`, `docs/questions/` — артефакты прошлой работы
- `.planning/*` — GSD-территория
- `AGENTS.md`, `GEMINI.md` — конфиги AI-CLI
- `backend/`, `frontend/`, `modal/`, `scripts/` — это документационная задача, кодом не правим

### Под вопросом — предложить решение пользователю

- `docs/DEVELOPMENT_PROGRESS.md` (от 2025-08) — архивировать в `docs/_archive/`?
- `docs/development/EPUB_READER_COMPREHENSIVE_ANALYSIS.md` (январь) — перенести в `docs/reports/`?
- `docs/development/EPUB_READER_FIX_PLAN.md` — устарел, в `docs/_archive/`?
- `docs/development/PERFORMANCE_REFACTORING_ANALYSIS.md` (.ru) — старый, архивировать?
- `docs/FRONTEND-AUDIT.md`, `docs/IMAGE-GENERATION-BUGS-AUDIT.md` (март) — в `docs/reports/`?
- `docs/AUDIT-2026-03-21-session-fixes.md` — в `docs/reports/`?

---

## 6. Методология (4 фазы)

### Фаза 0: Подготовка (5 мин)

1. Прочитай этот промпт целиком, выпиши незакрытые вопросы.
2. Задай **уточняющие вопросы пользователю только если** действительно неоднозначно. По умолчанию — двигайся.

### Фаза 1: Инвентаризация и верификация (1–2 часа, read-only)

1. Полная инвентаризация `.md` в скоупе:
   ```bash
   ls *.md
   find docs -maxdepth 3 -name "*.md" | sort
   ```
2. **Верификация стека** — для каждого утверждения в текущих README найди источник в коде:
   - Backend versions → `backend/requirements.txt`, `backend/Dockerfile`
   - Frontend versions → `frontend/package.json`, `frontend/vite.config.ts`
   - Infra → `docker-compose.yml`, `docker-compose.prod.yml`
   - AI models → `backend/app/core/openrouter_client.py`, `backend/app/services/llm_*`, `backend/.env.production.example`
   - DB schema → `backend/alembic/versions/` (последние 5)
3. **Создай drift matrix** в `docs/_drafts/2026-04-30-doc-drift-matrix.md`:
   ```markdown
   | Файл:строка  | Заявлено      | Фактически    | Источник истины                       |
   | ------------ | ------------- | ------------- | ------------------------------------- |
   | README.md:13 | PostgreSQL 15 | PostgreSQL 17 | docker-compose.yml:42                 |
   | README.md:60 | Imagen 4      | FLUX.2 Klein  | backend/app/core/openrouter_client.py |
   ```
4. Прочитай `.planning/PROJECT.md`, `STATE.md`, `ROADMAP.md` — vision и scope.
5. Прочитай `git log --since="60 days ago" --oneline` — что произошло.
6. Прочитай 5–10 ключевых файлов кода (главные роутеры, App.tsx, главные хуки) — откалибровать понимание архитектуры.

### Фаза 2: Согласование структуры (записать план, дождаться OK)

1. Сформируй **карту целевой документации**: структура директорий, новые файлы, переименования, архивация.
2. Покажи пользователю план одной таблицей: «обновить N файлов, создать M, архивировать K».
3. Жди ОК. Если пользователь говорит «действуй» — фаза 3.

### Фаза 3: Обновление (основная работа)

1. **Файл-за-файлом**, каждый — отдельный коммит формата `docs(scope): subject`.
2. Для каждого `.md`:
   - Определи аудиторию (новый разработчик / DevOps / контрибьютор / пользователь).
   - Определи единый источник истины для каждого утверждения.
   - Используй реальные пути и команды (проверены через `ls`/`grep`).
   - Никаких выдуманных API, скриптов, версий.
3. Соблюдай стиль (раздел 8).
4. После каждой группы изменений — `git status`, `git diff --stat`, проверка работоспособности команд из README.

### Фаза 4: Верификация (30 мин)

1. **Все внутренние ссылки** между `.md` ведут на существующие файлы:
   ```bash
   grep -rE "\]\([^)]+\.md[^)]*\)" *.md docs/*.md docs/**/README.md
   ```
2. **Команды из README реально работают**:
   - `docker compose up -d` — запускается
   - `cd frontend && npm install && npm run dev` — стартует
   - `cd backend && uv sync && alembic upgrade head` — мигрирует
   - `cd frontend && npm test`, `cd backend && uv run pytest -v` — тесты идут
3. **Финальный отчёт** `docs/reports/2026-04-30-documentation-modernization.md` со списком изменений и решений.

---

## 7. Принципы качества

1. **Verify, don't fabricate.** Если не нашёл подтверждения в коде/конфигах — не пиши. Лучше пометь TODO и спроси.
2. **Single source of truth.** Для каждого утверждения — точный источник. Не дублируй спецификации в нескольких файлах. Лучше: один файл-источник, остальные ссылаются.
3. **No marketing fluff.** Сухо и точно. Без "stunning", "revolutionary", "state-of-the-art". Конкретика: «Gemini 2.5 Flash tiered», а не «AI-powered».
4. **Concrete commands.** Все примеры команд должны запускаться copy-paste. Никаких `your-database-name` в продакшен-инструкциях.
5. **Точные версии.** Не «React 19», а «React 19.0» (или диапазон из package.json). Источник: `package.json`, `requirements.txt`, lock-файлы.
6. **Honesty over completeness.** Фича анонсирована но не реализована? Не пиши о ней. Реализована частично? Помечай «(Planned for v1.6)».
7. **Уважай профиль разработчика.** Terse-direct, fast-intuitive, hypothesis-driven. Длинные нудные intro не нужны. Конкретика, примеры, команды.
8. **No redundant comments in markdown.** Если заголовок и так «## Установка», не пиши под ним «В этом разделе описана установка».

---

## 8. Стиль и формат

- **Язык:** русский для пользовательских docs (`README-ru.md`, `CONTRIBUTING.md`, `docs/ru/`, `docs/operations/`, `docs/development/`), английский для технических конфигов (`CLAUDE.md`). Если есть и `-ru` и не-ru версии — синхронизируй.
- **Markdown:** GitHub-flavored. Таблицы, списки, code-fences с языком.
- **Code blocks:** всегда с языком: ` ```bash `, ` ```python `, ` ```typescript `.
- **Команды:** с пояснением, если не очевидно.
- **Headings:** один H1 в начале, остальное H2–H4. Не злоупотребляй H4+.
- **Длина:** README — 200–500 строк. Если больше — выноси в отдельные `docs/`.
- **Ссылки:** относительные внутри репо (`docs/deployment/...`), абсолютные на внешние ресурсы.
- **Эмодзи:** умеренно. README может иметь несколько (📚 🤖 🎨), CONTRIBUTING — без.
- **Badges:** только актуальные. Версии в badge должны совпадать с реальностью.
- **Дата актуализации:** внизу каждого крупного `.md`: `Last updated: 2026-04-30, verified against commit <hash>`.

---

## 9. Конкретные требования к ключевым файлам

### 9.1. `README.md` (английский)

**Цель:** технический обзор для разработчика, который впервые пришёл в репо.

**Обязательно:**

- Hero: что это, для кого, ссылка на live (`https://fancai.ru`).
- **Two core features (НЕ один!):**
  1. **Entity Wiki / interactive glossary** — главная фича, spoiler-free
  2. **AI-generated illustrations** — вторичная фича
- Реальный стек с точными версиями из `requirements.txt` и `package.json`.
- Quick start: 3 шага: `clone` → `docker compose up` → `localhost:5173`.
- Architecture overview (1 ASCII-диаграмма или ссылка).
- Project structure (дерево топ-уровень).
- Development workflow: dev server, тесты, билд (с реальными командами).
- Production: ссылка на `docs/deployment/`.
- Roadmap: ссылка на `.planning/ROADMAP.md`.
- Contributing: ссылка на `CONTRIBUTING.md`.
- License (Proprietary).

**НЕ нужно:**

- Маркетинговые фразы про "transform your reading".
- Subscription tiers (FREE/PREMIUM/ULTIMATE — out of scope).
- Imagen 4, Google Gemini SDK напрямую (всё через OpenRouter).
- Ссылки на NLP-систему (удалена).

### 9.2. `README-ru.md`

**Цель:** то же на русском, перевод не дословный — адаптация.

### 9.3. `CONTRIBUTING.md`

**Цель:** новый контрибьютор должен понять — как работать, какие инструменты, конвенции, как делать PR.

**Обязательно:**

- Имя проекта: **fancai** (не "BookReader AI"!).
- Setup: `docker compose up` + `uv` для backend + `npm` для frontend.
- Conventional commits: `<type>(<scope>): <subject>`.
- Lint: ruff (Python), eslint (TS).
- Tests: vitest, pytest, playwright e2e.
- GSD workflow: ссылка на `.planning/`, `/gsd:*` команды.
- PR процесс: ветка → коммиты → PR → review → merge.
- Code style: TS hooks, FastAPI patterns, no raw `fetch()`.
- Документация (`docs/` структура, что куда писать).
- Дружелюбность как принцип, без формального Code of Conduct.

### 9.4. `CHANGELOG.md`

**Цель:** хронология shipped milestones для пользователя/контрибьютора.

**Структура (Keep a Changelog format):**

```markdown
## [v1.5] — 2026-03-29 (closed-partial)

### Added

- ErrorClassifier с 5 типами ошибок
- Structured per-chapter logging (9 полей)

### Changed

- ...

### Abandoned

- Modal vLLM Qwen3.5-9B pipeline (staging провален)
```

Покрытие: v1.0 → v1.5 (источник: `.planning/MILESTONES.md`, milestone-папки).

### 9.5. `docs/README.md`

**Цель:** навигатор. Куда идти за чем.

```markdown
# Документация fancai

## Для разработчиков

- [Onboarding](development/README.md)
- [Conventions](development/conventions.md)

## Для DevOps

- [Production deploy](deployment/README.md)
- [Operations runbooks](operations/README.md)
- [CI/CD](ci-cd/README.md)

## Безопасность

- [Security policy](SECURITY.md)
- [Reporting vulnerabilities](SECURITY.md#reporting)

## Архивы (только чтение)

- [Reports](reports/) — исторические анализы
- [Research](research/) — exploratory research
- [Plans](plans/) — артефакты прошлой работы
```

### 9.6. `docs/SECURITY.md`

**Цель:** security policy + how to report.

**Содержание:**

- Reporting (sandkme@gmail.com).
- Scope (production: fancai.ru).
- Out-of-scope (DDoS, social engineering).
- Disclosure timeline.
- Текущие меры (HTTPS, JWT с blacklist, secrets management, CSP, CSRF protection).
- Известные ограничения.

### 9.7. `CLAUDE.md`

**Цель:** контекст для AI-агентов (Claude Code), не для людей.

**Точечные правки:**

- Сверить `Stack` секцию с реальностью.
- LLM model: Gemini 2.5 Flash tiered + Gemini 3.1 Flash Lite (текущий после A/B).
- Image: FLUX.2 Klein.
- Дата `currentDate` пусть остаётся динамической (не хардкодить).

---

## 10. Чек-лист готовности

Перед сдачей — проверить **каждый** пункт:

- [ ] `README.md` + `README-ru.md` синхронизированы по содержанию
- [ ] Все версии (Python, Node, FastAPI, React, etc.) проверены против `package.json`/`requirements.txt`/`Dockerfile`
- [ ] Все команды из README копируются и работают
- [ ] Имя проекта — **fancai**, не "BookReader AI" / "BookReader" / другое
- [ ] AI-стек: Gemini 2.5 Flash tiered + Gemini 3.1 Flash Lite (LLM), FLUX.2 Klein (Images), всё через OpenRouter
- [ ] PostgreSQL 17, Redis 7.4 (или то, что в реальности), Celery, FastAPI 0.135.x, Python 3.12, React 19, TypeScript 5.7, Vite 7
- [ ] Subscription model упомянут только если реализован (на 2026-04-30 — out of scope)
- [ ] Imagen 4 / Imagen / Vertex AI — НЕ упомянуты
- [ ] NLP system (spaCy, Stanza и т.п.) — НЕ упомянуты
- [ ] Modal vLLM — упомянут только в CHANGELOG как abandoned
- [ ] Все внутренние ссылки `[text](path)` ведут на существующие файлы
- [ ] Каждое крупное обновление — отдельный коммит с осмысленным сообщением
- [ ] Финальный отчёт `docs/reports/2026-04-30-documentation-modernization.md` написан
- [ ] `git log --since="today" --oneline` показывает атомарные коммиты с префиксом `docs(...)`
- [ ] Все файлы вне скоупа — **не модифицированы** (`git status` показывает только `.md` в скоупе и новые архивы)

---

## 11. Дополнительные инструкции

- **Дубли между `.md`** (одно объяснено в трёх местах) → выбери единственное место для каноники, остальные → ссылки.
- **Устаревшие, но потенциально ценные документы** в скоупе — НЕ удаляй. Перенеси в `docs/_archive/<original-path>` и оставь короткую заметку с ссылкой.
- **Конфликты** между `.md` (два говорят разное о статусе фичи) → выбери источник истины (PROJECT.md / STATE.md / код), отметь конфликт в drift matrix, задокументируй решение.
- **Не создавай новые `.md`** без явной нужды — лучше консолидировать существующие.
- **Не правь `.planning/`** — GSD-территория.
- **Не правь** `backend/`, `frontend/`, `modal/`, `scripts/` — это документационная задача.
- **Если упираешься в неоднозначность** в фичеспеке (например, что считать "v1.5 shipped") — спроси пользователя одной фразой через AskUserQuestion. Не молчаливо угадывай.

---

## 12. Что должно быть на выходе

1. **Drift matrix:** `docs/_drafts/2026-04-30-doc-drift-matrix.md` (артефакт фазы 1)
2. **Обновлённые `.md` в корне:** `README.md`, `README-ru.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, возможно правки `CLAUDE.md`
3. **Обновлённые `.md` в `docs/`:** `README.md`, `SECURITY.md`, `development/README.md`, `deployment/README.md`, `operations/README.md`, `ci-cd/README.md`, `ru/README.md`
4. **Архивация устаревших отчётов** в `docs/_archive/` (с сохранением исторической ценности — не `git rm`)
5. **Финальный отчёт:** `docs/reports/2026-04-30-documentation-modernization.md` со списком изменений и решений
6. **Серия атомарных коммитов** формата `docs(scope): subject`
7. **Никаких изменений** в `.planning/`, `backend/`, `frontend/`, `modal/`, `scripts/`

---

## 13. Запуск

Начни с **Фазы 0** (5 минут): прочитай промпт, выпиши вопросы. Задай уточняющие, только если есть критическая неоднозначность.

Дальше **Фаза 1** (инвентаризация и верификация — 1–2 часа). Не торопись с записью: треть времени на чтение и фактчек, две трети — на текст.

После Фазы 1 — **обязательно** покажи пользователю drift matrix и план изменений, дождись ОК, и только потом Фаза 3.

---

**Веди себя как старший технический писатель**, который только что присоединился к команде и хочет навести порядок без лишнего шума. Сухо, точно, с уважением к коду как источнику истины. Если что-то непонятно — лучше спросить, чем выдумать.

**Удачи.**
