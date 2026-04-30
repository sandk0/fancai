# Отчёт: модернизация документации (2026-04-30)

Системное обновление публичной документации проекта fancai после периода
быстрой эволюции стека (NLP removal в декабре 2025, миграция на OpenRouter,
serial pivot Modal → Modal abandoned → OpenRouter optimization, A/B Qwen
→ Gemini 2.5 Flash tiered).

**Базовый коммит:** `cededd96` (chore(gsd): sync GSD toolchain update + ultrareview fixes, 2026-04-26)
**Финальный коммит:** `aab11f4e` (docs(install): fix backend install command, 2026-04-30)

## Итоги

- **12 атомарных коммитов** в рамках модернизации
- **39 файлов** затронуто (+1 822 / −2 008 строк, чистый размер документации сократился)
- **21 устаревший документ** перенесён в `docs/_archive/` (без удаления)
- **Все 13 целевых `.md`-файлов** в корне и `docs/` обновлены или подтверждены актуальными
- **Все внутренние markdown-ссылки** в обновлённых файлах валидны (проверено grep + проверка существования путей)

## Цепочка коммитов

| #   | SHA        | Subject                                                                                     |
| --- | ---------- | ------------------------------------------------------------------------------------------- |
| 1   | `3741b7de` | `docs(archive): move stale dev/audit reports to _archive`                                   |
| 2   | `a58a3ab9` | `docs(readme): rewrite for accurate v1.5 stack and AI providers`                            |
| 3   | `4bf5f297` | `docs(readme-ru): sync with English README`                                                 |
| 4   | `513e90be` | `docs(contributing): rewrite for fancai with uv, Conventional Commits, GSD`                 |
| 5   | `09e1b913` | `docs(changelog): add milestone history v1.0..v1.5 in Keep-a-Changelog format`              |
| 6   | `93aa6af6` | `docs(claude): correct stack and AI models in summary`                                      |
| 7   | `f6cffaa2` | `docs(security): rewrite as policy, archive 2025-10-30 P0 fix report`                       |
| 8   | `4f7a9326` | `docs(navigation): rewrite docs/README under flat structure`                                |
| 9   | `cfbd96e7` | `docs(navigation-ru): rewrite under flat docs structure`                                    |
| 10  | `e5c612c5` | `docs(subdirs): rewrite README files for flat docs/ structure`                              |
| 11  | `e8e28989` | `docs(subdirs): rewrite Diataxis-skeleton README files with honest pointers`                |
| 12  | `aab11f4e` | `docs(install): fix backend install command — uv sync → uv pip install -r requirements.txt` |

## Ключевые правки фактов

| #   | Было                                                                        | Стало                                                                              | Источник истины                                            |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | «BookReader AI» / `fancai-vibe-hackathon` / `bookreader-ai`                 | **fancai**                                                                         | rename, везде                                              |
| 2   | Python 3.11                                                                 | **Python 3.12**                                                                    | `backend/Dockerfile.dev:1` (`FROM python:3.12-slim`)       |
| 3   | FastAPI 0.125 / 0.128                                                       | **FastAPI 0.135.1**                                                                | `backend/requirements.txt:2`                               |
| 4   | PostgreSQL 15 / 15.7                                                        | **PostgreSQL 17**                                                                  | `docker-compose.prod.yml` (`pgvector/pgvector:0.8.2-pg17`) |
| 5   | Vite 6.0                                                                    | **Vite 8**                                                                         | `frontend/package.json:90` (`"vite": "^8.0.0"`)            |
| 6   | Tailwind 3.4                                                                | **Tailwind 4.x**                                                                   | `frontend/package.json:87` (`"tailwindcss": "^4.2.2"`)     |
| 7   | Celery 5.4                                                                  | **Celery 5.6.2**                                                                   | `backend/requirements.txt:17`                              |
| 8   | Gemini 3.0 Flash                                                            | **`google/gemini-2.5-flash` (primary), `google/gemini-2.5-flash-lite` (fallback)** | `backend/app/core/openrouter_client.py:58–59`              |
| 9   | Google Imagen 4                                                             | **`black-forest-labs/flux.2-klein-4b`**                                            | `backend/app/core/openrouter_client.py:65`                 |
| 10  | `GOOGLE_API_KEY`                                                            | **`OPENROUTER_API_KEY`**                                                           | `backend/CLAUDE.md`, `openrouter_client.py`                |
| 11  | `pip install -r requirements.txt` (раннее) → `uv sync` (моя первая попытка) | **`uv pip install -r requirements.txt`** (или plain pip)                           | `backend/Dockerfile.dev`, отсутствует `pyproject.toml`     |
| 12  | `docker-compose up -d` без указания файла                                   | **`docker compose -f docker-compose.dev.yml up -d`**                               | нет default `docker-compose.yml`                           |
| 13  | Subscription tiers FREE/PREMIUM/ULTIMATE как фича                           | **out of scope**                                                                   | `.planning/PROJECT.md:74`                                  |
| 14  | Image generation как primary feature                                        | **Entity Wiki — primary**, image generation — secondary                            | `.planning/PROJECT.md:5`                                   |
| 15  | NLP-система упоминается                                                     | **удалена в декабре 2025**                                                         | `backend/requirements.txt:21–22`                           |
| 16  | Imagen / Imagen 4 / Vertex AI                                               | **исключено**                                                                      | openrouter_client.py                                       |

## Архивированные файлы (21 шт)

В `docs/_archive/development/` (17 файлов, октябрь–ноябрь 2025):

- `AGENT_SYSTEM_IMPROVEMENTS_2025-11-18.md`
- `agents-update-summary-2025-11-18.md`
- `changelog.md` (107 KB, очень старый)
- `claude-code-agents-system.md` (81 KB)
- `current-status.md` (60 KB)
- `development-calendar.md`, `development-plan.md`
- `EPUB_READER_COMPREHENSIVE_ANALYSIS.md`, `EPUB_READER_FIX_PLAN.md`
- `GAP_ANALYSIS_REPORT.md`, `orchestrator-agent-guide.md`
- `parser-optimizations.md`
- `PERFORMANCE_REFACTORING_ANALYSIS.md` (.md и .ru.md)
- `testing-guide.md`, `testing-refactoring-analysis.md` (.md и .ru.md)

В `docs/_archive/` (4 файла):

- `DEVELOPMENT_PROGRESS.md` (август 2025 — самый ранний)
- `FRONTEND-AUDIT.md` (март 2026)
- `IMAGE-GENERATION-BUGS-AUDIT.md` (март 2026)
- `AUDIT-2026-03-21-session-fixes.md`

`docs/SECURITY.md` (старый отчёт о P0-фиксах) перенесён в
`docs/reports/2025-10-30-p0-security-fixes.md` (как датированный snapshot).

## Обновлённые файлы (16 шт)

| Файл                          | Действие                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `README.md`                   | полная переписка (406 → 282 строки)                                                  |
| `README-ru.md`                | полная переписка, синхронно с EN (387 → 283 строки)                                  |
| `CONTRIBUTING.md`             | полная переписка (622 → 261 строк); rename, conventional commits, uv, GSD            |
| `CHANGELOG.md`                | расширение в Keep-a-Changelog формат, milestone history v1.0..v1.5 (20 → 263 строки) |
| `CLAUDE.md`                   | точечная правка стека + LLM-моделей                                                  |
| `docs/SECURITY.md`            | rewrite как чистая security policy                                                   |
| `docs/README.md`              | rewrite под фактическую плоскую структуру                                            |
| `docs/ru/README.md`           | rewrite, навигатор без параллельной структуры                                        |
| `docs/development/README.md`  | rewrite (минимальный — основное в CLAUDE.md/CONTRIBUTING)                            |
| `docs/operations/README.md`   | rewrite под фактические файлы                                                        |
| `docs/ci-cd/README.md`        | rewrite под фактические файлы                                                        |
| `docs/security/README.md`     | rewrite как placeholder с pointer'ами                                                |
| `docs/guides/README.md`       | rewrite как placeholder                                                              |
| `docs/reference/README.md`    | rewrite, направление на Swagger UI и backend/                                        |
| `docs/explanations/README.md` | rewrite как placeholder с pointer'ами на `.planning/`                                |
| `docs/refactoring/README.md`  | rewrite под фактические файлы 2025-11-03 серии                                       |

## Что НЕ изменено

В скоупе но не модифицировано:

- `backend/`, `frontend/`, `modal/`, `scripts/` — это документационная задача
- `.planning/*` — GSD-территория (обновляется отдельными командами)
- `AGENTS.md`, `GEMINI.md` — конфиги AI-CLI, не пользовательская документация
- `frontend/CLAUDE.md`, `backend/CLAUDE.md` — актуальны (обновляются отдельно по другим триггерам)
- `docs/reports/*` (200+ файлов) — исторический архив, кроме добавления одного нового файла
- `docs/research/*` (50+) — research-материалы
- `docs/plans/*`, `docs/prompts/*`, `docs/refactoring/2025-11-03-*`, `docs/ios/*` — артефакты
- `docs/analysis/`, `docs/questions/`, `docs/design/` — точечные артефакты
- `.gitignore`, `backend/requirements.txt`, `.planning/STATE.md`, `.planning/ROADMAP.md` —
  pre-existing modifications вне скоупа этой задачи

## Верификация

### Markdown-ссылки

Всё внутренние ссылки проверены (grep + ls). **Broken ссылки: 0.**

```bash
FILES="README.md README-ru.md CONTRIBUTING.md CHANGELOG.md CLAUDE.md \
       docs/SECURITY.md docs/README.md docs/ru/README.md \
       docs/{development,operations,ci-cd,security,guides,reference, \
              explanations,refactoring,_archive}/README.md"
# Каждая [text](path) проверена на существование `path` относительно файла
```

### Команды и пути

| Команда / путь                                                                             | Существование   | Источник                             |
| ------------------------------------------------------------------------------------------ | --------------- | ------------------------------------ |
| `docker-compose.dev.yml`                                                                   | ✓               | `ls docker-compose.dev.yml`          |
| `docker-compose.prod.yml`                                                                  | ✓               | git status                           |
| `.env.production.example`                                                                  | ✓               | git status                           |
| `backend/alembic.ini`                                                                      | ✓               | `ls backend/alembic.ini`             |
| `backend/requirements.txt`                                                                 | ✓               | `ls backend/requirements.txt`        |
| `backend/pyproject.toml`                                                                   | ✗ — отсутствует | (привело к коммиту 12 — fix install) |
| `backend/Dockerfile.dev`                                                                   | ✓               | `find`                               |
| `frontend/package.json` scripts (`dev`, `test`, `build`, `lint`, `type-check`, `test:e2e`) | ✓               | `grep package.json`                  |

### Стек верифицирован против

- `backend/requirements.txt` — Python deps (FastAPI 0.135.1, Celery 5.6.2, etc.)
- `backend/Dockerfile.dev` — Python 3.12-slim
- `frontend/package.json` — npm deps (React 19, TS 5.7, Vite 8, Tailwind 4)
- `docker-compose.prod.yml` — production-сервисы (Caddy 2.11, pg17, Redis 7.4.8)
- `backend/app/core/openrouter_client.py` — реальные AI-модели (FALLBACK_MODELS на строках 58–59)
- `.planning/PROJECT.md` — vision, scope, out-of-scope

## Открытые задачи (вне этой работы)

1. **Provisioning-ключ OpenRouter** — alert #2 на GitHub Secret Scanning всё
   ещё открыт, ключ `sk-or-v1-c4b...d30` активен на момент проверки 2026-04-30.
   Требуется ручное действие на <https://openrouter.ai/settings/provisioning-keys>
   и закрытие алерта через `gh api -X PATCH …/alerts/2 -f state=resolved -f resolution=revoked`.
2. **`.pre-commit-config.yaml`** — конфиг устарел (Black 23.11.0, ruff 0.1.6,
   mypy 1.7.1, Python 3.11), расходится с прод-зависимостями. Обновить
   отдельной задачей либо удалить файл.
3. **`backend/pyproject.toml`** отсутствует. Если хотите перевести проект на
   `uv sync` (с lock-файлом) — это полноценная миграция, не часть docs-задачи.
4. **`docs/development/`** теперь почти пуст (только README). Можно либо
   оставить как навигатор, либо удалить директорию вместе с README, перенаправив
   все ссылки на `CLAUDE.md` / `CONTRIBUTING.md` / `.planning/`.
5. **`docs/{guides,reference,explanations}/`** — placeholder-директории. Если
   не планируете заполнять Diataxis-структуру — можно удалить и убрать
   ссылки из `docs/README.md`.
6. **`docs/_drafts/2026-04-30-doc-drift-matrix.md`** — рабочий артефакт Фазы 1
   модернизации. Можно либо оставить (как track-record), либо переместить в
   `docs/_archive/2026-04-30-doc-drift-matrix.md`.

## Источники истины (для будущих обновлений)

```
backend/requirements.txt              ←  Python deps
frontend/package.json                 ←  npm deps + scripts
docker-compose.prod.yml               ←  production services & versions
backend/app/core/openrouter_client.py ←  AI models (FALLBACK_MODELS)
.planning/PROJECT.md                  ←  vision / scope / out-of-scope
.planning/STATE.md                    ←  current operational state
.planning/ROADMAP.md                  ←  phases / plans / milestones
.planning/MILESTONES.md               ←  shipped milestone history
backend/CLAUDE.md, frontend/CLAUDE.md ←  module-level conventions
```

При следующей правке корневой документации сверяйте утверждения именно с
этими файлами, а не с `README.md`/`README-ru.md` сами по себе.

---

_Подготовил: gsd модернизация документации, 2026-04-30._
_Связанные документы: [`docs/prompts/2026-04-30-documentation-modernization.md`](../prompts/2026-04-30-documentation-modernization.md) (исходный промпт), [`docs/_drafts/2026-04-30-doc-drift-matrix.md`](../_drafts/2026-04-30-doc-drift-matrix.md) (рабочая drift matrix Фазы 1)._
