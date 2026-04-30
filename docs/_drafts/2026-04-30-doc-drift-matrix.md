# Drift Matrix: документация vs реальность (2026-04-30)

Артефакт Фазы 1 модернизации документации. Систематическая фиксация расхождений
между текущими `.md` и фактическим состоянием кода/инфры.

**Метод:** для каждого утверждения в существующих доках — найти источник истины
в коде (`backend/`, `frontend/`), манифестах (`requirements.txt`, `package.json`),
инфраструктуре (`docker-compose.prod.yml`, `Caddyfile`) или GSD-артефактах
(`.planning/PROJECT.md`, `.planning/STATE.md`).

**Источник истины (в порядке приоритета):**

1. Код в `backend/` и `frontend/`
2. `backend/requirements.txt`, `frontend/package.json`
3. `docker-compose.prod.yml`
4. `backend/CLAUDE.md`, `frontend/CLAUDE.md` (вложенные, обновляются автоматически)
5. `.planning/PROJECT.md`, `.planning/STATE.md`

---

## 1. Стек: критические расхождения

### 1.1. README.md (английский)

| Файл:строка       | Заявлено                                                               | Фактически                                                                                                                                 | Источник истины                                                 |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| README.md:7       | Python 3.11                                                            | Python 3.12                                                                                                                                | backend/CLAUDE.md, .planning/PROJECT.md                         |
| README.md:8       | FastAPI 0.125                                                          | FastAPI 0.135.1                                                                                                                            | requirements.txt:2                                              |
| README.md:11      | PostgreSQL 15                                                          | PostgreSQL 17                                                                                                                              | docker-compose.prod.yml:postgres → pgvector/pgvector:0.8.2-pg17 |
| README.md:12      | Redis 7.4 (без точки)                                                  | Redis 7.4.8-alpine                                                                                                                         | docker-compose.prod.yml                                         |
| README.md:67      | Vite 6.0                                                               | Vite 8.x (`^8.0.0`)                                                                                                                        | frontend/package.json:90                                        |
| README.md:68      | Tailwind 3.4                                                           | Tailwind 4.2.x                                                                                                                             | frontend/package.json:87 (`tailwindcss ^4.2.2`)                 |
| README.md:69      | TanStack Query 5.90                                                    | TanStack Query 5.91                                                                                                                        | frontend/package.json:38                                        |
| README.md:73      | FastAPI 0.125 (badges)                                                 | FastAPI 0.135.1                                                                                                                            | requirements.txt:2                                              |
| README.md:74      | PostgreSQL 15.7                                                        | PostgreSQL 17                                                                                                                              | docker-compose.prod.yml                                         |
| README.md:76      | Celery 5.4                                                             | Celery 5.6.2                                                                                                                               | requirements.txt:17                                             |
| README.md:79      | Gemini 3.0 Flash                                                       | google/gemini-2.5-flash (primary)                                                                                                          | backend/app/core/openrouter_client.py:58                        |
| README.md:80      | Imagen 4.0 (Google)                                                    | black-forest-labs/flux.2-klein-4b                                                                                                          | backend/app/core/openrouter_client.py:65                        |
| README.md:48      | "Google Imagen 4 creates illustrations"                                | FLUX.2 Klein через OpenRouter                                                                                                              | openrouter_client.py                                            |
| README.md:53      | Subscription Model FREE/PREMIUM/ULTIMATE                               | НЕ реализовано (out of scope)                                                                                                              | .planning/PROJECT.md:74                                         |
| README.md:94      | Google Cloud API key (Gemini + Imagen)                                 | OpenRouter API key                                                                                                                         | backend/CLAUDE.md, openrouter_client.py                         |
| README.md:101     | `cd bookreader-ai`                                                     | `cd fancai`                                                                                                                                | проект переименован                                             |
| README.md:110     | `docker-compose up -d`                                                 | `docker compose -f docker-compose.prod.yml up -d` (или dev файл)                                                                           | нет файла `docker-compose.yml` без суффикса                     |
| README.md:127     | `GOOGLE_API_KEY=...`                                                   | `OPENROUTER_API_KEY=...`                                                                                                                   | openrouter_client.py, backend/CLAUDE.md                         |
| README.md:155     | Gemini 3.0 Flash в архитектурной диаграмме                             | gemini-2.5-flash                                                                                                                           | openrouter_client.py:58                                         |
| README.md:158     | Imagen 4 в архитектурной диаграмме                                     | flux.2-klein-4b                                                                                                                            | openrouter_client.py:65                                         |
| README.md:163     | PostgreSQL 15 в диаграмме                                              | PostgreSQL 17                                                                                                                              | docker-compose.prod.yml                                         |
| README.md:170-181 | Список Core Services с устаревшими LOC                                 | Реальные размеры в backend/CLAUDE.md: gemini_extractor.py 1221 строк, book_parser.py 1199, entity_service.py 680, openrouter_client.py 537 | grep wc на коде                                                 |
| README.md:174     | imagen_generator.py (644 LOC)                                          | НЕ существует (заменено OpenRouter)                                                                                                        | удалено вместе с миграцией                                      |
| README.md:251     | "AI image generation (Imagen 4)"                                       | FLUX.2 Klein                                                                                                                               | openrouter_client.py                                            |
| README.md:254     | "Subscription system" в roadmap как done                               | НЕ реализован, out of scope                                                                                                                | .planning/PROJECT.md:74                                         |
| README.md:289     | `pip install -r requirements.txt`                                      | `uv sync` (uv package manager)                                                                                                             | CLAUDE.md:18 (`uv run python -m pytest`)                        |
| README.md:298     | `npm test` (с `--coverage`)                                            | `npm test` = `vitest run` (нет coverage по умолчанию)                                                                                      | package.json:14                                                 |
| README.md:307-310 | "Backend Unit 35+, Integration 8, Frontend Hooks 18, Total 60+"        | 46 backend test files, frontend больше; цифры устарели                                                                                     | backend/CLAUDE.md (46 test files)                               |
| README.md:343     | "Components 126"                                                       | 86 (frontend/CLAUDE.md имеет 22+12+другие); цифра спорная                                                                                  | frontend/CLAUDE.md                                              |
| README.md:349     | `docker-compose.lite.yml`                                              | НЕ существует — есть `dev`, `prod`, `monitoring`                                                                                           | `ls docker-compose*.yml`                                        |
| README.md:359-372 | Diataxis-структура с `guides/getting-started/`, `reference/api/`, etc. | Эти папки не существуют. Реальная docs/-структура плоская: `development/`, `deployment/`, `operations/`, `ci-cd/`, `reports/`, `research/` | `ls docs/`                                                      |
| README.md:367     | "[Guides](docs/guides/)" с подссылками                                 | docs/guides/README.md существует, но подпапок (`getting-started/`, `development/`, `deployment/`) НЕТ                                      | `ls docs/guides/`                                               |

### 1.2. README-ru.md (русский)

| Файл:строка        | Заявлено                                                                  | Фактически                                                             | Источник истины              |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| README-ru.md:7-13  | Те же badges что в README.md (Python 3.11, FastAPI 0.125, PostgreSQL 15)  | См. таблицу 1.1                                                        | manifesti                    |
| README-ru.md:48    | "Google Imagen 4 создаёт качественные иллюстрации"                        | FLUX.2 Klein через OpenRouter                                          | openrouter_client.py         |
| README-ru.md:52    | Тарифы FREE / PREMIUM / ULTIMATE                                          | НЕ реализовано                                                         | .planning/PROJECT.md:74      |
| README-ru.md:63    | Vite 6.0                                                                  | Vite 8.x                                                               | package.json                 |
| README-ru.md:75-76 | Gemini 3.0 Flash + Imagen 4.0                                             | gemini-2.5-flash + flux.2-klein-4b                                     | openrouter_client.py         |
| README-ru.md:90    | "API-ключ Google Cloud"                                                   | OPENROUTER_API_KEY                                                     | openrouter_client.py         |
| README-ru.md:97    | `cd bookreader-ai`                                                        | `cd fancai`                                                            | rename                       |
| README-ru.md:106   | `docker-compose up -d`                                                    | `docker compose -f docker-compose.prod.yml up -d`                      | нет default compose-файла    |
| README-ru.md:123   | `GOOGLE_API_KEY=`                                                         | `OPENROUTER_API_KEY=`                                                  | openrouter_client.py         |
| README-ru.md:151   | Gemini 3.0 Flash + Imagen 4 в архитектурной диаграмме                     | gemini-2.5-flash + FLUX.2 Klein                                        | openrouter_client.py         |
| README-ru.md:159   | PostgreSQL 15 в диаграмме                                                 | PostgreSQL 17                                                          | docker-compose.prod.yml      |
| README-ru.md:170   | "imagen_generator.py 644 строк"                                           | НЕ существует                                                          | удалено                      |
| README-ru.md:174   | "Всего backend: 15+ сервисов, 7 757 строк"                                | 28 services, размеры обновлены                                         | backend/CLAUDE.md            |
| README-ru.md:225   | "Размер бандла 386KB gzipped" — устарело и расходится с README.md (202KB) | Не верифицировал, цифру убрать или обновить через `npm run build:size` | scripts/check-bundle-size.js |
| README-ru.md:245   | "ИИ-генерация изображений (Imagen 4)"                                     | FLUX.2 Klein                                                           | openrouter_client.py         |
| README-ru.md:248   | "Система подписок" как done                                               | Не реализовано                                                         | PROJECT.md                   |
| README-ru.md:283   | `pip install -r requirements.txt`                                         | `uv sync`                                                              | CLAUDE.md                    |

### 1.3. CONTRIBUTING.md

| Файл:строка             | Заявлено                                                     | Фактически                                                                         | Источник истины               |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------- |
| CONTRIBUTING.md:1       | "Руководство по внесению вклада в **BookReader AI**"         | проект называется fancai                                                           | rename                        |
| CONTRIBUTING.md:3       | "проекту BookReader AI"                                      | fancai                                                                             | rename                        |
| CONTRIBUTING.md:26      | Python 3.11+                                                 | Python 3.12                                                                        | backend/CLAUDE.md             |
| CONTRIBUTING.md:27      | Node.js 18+                                                  | Node.js 20+ (для Vite 8 нужен Node 20.19+)                                         | Vite 8 docs                   |
| CONTRIBUTING.md:36      | `https://github.com/YOUR_USERNAME/fancai-vibe-hackathon.git` | `https://github.com/<USERNAME>/fancai.git`                                         | repo rename                   |
| CONTRIBUTING.md:46      | `pip install -r requirements.txt`                            | `uv sync`                                                                          | CLAUDE.md                     |
| CONTRIBUTING.md:52      | `docker-compose -f docker-compose.dev.yml up -d`             | OK (правильно для dev)                                                             | docker-compose.dev.yml exists |
| CONTRIBUTING.md:91      | `cd frontend && npm test`                                    | OK                                                                                 | package.json                  |
| CONTRIBUTING.md:93-94   | `cd frontend && npm run test:e2e`                            | OK                                                                                 | package.json:17               |
| CONTRIBUTING.md:104     | `mypy app/ --strict`                                         | OK (через uv)                                                                      | requirements.txt:63           |
| CONTRIBUTING.md:114     | "Мы используем pre-commit хуки"                              | НЕ верифицировано — нет `.pre-commit-config.yaml` в корне?                         | проверить `ls .pre-commit*`   |
| CONTRIBUTING.md:373     | "docs/development/planning/development-plan.md"              | НЕ существует — файлы плоско в `docs/development/`                                 | `ls docs/development/`        |
| CONTRIBUTING.md:376     | "docs/development/changelog/2025.md"                         | НЕ существует — есть `docs/development/changelog.md` плоско                        | `ls docs/development/`        |
| CONTRIBUTING.md:377     | "docs/development/status/current-status.md"                  | НЕ существует — есть `docs/development/current-status.md` плоско                   | `ls docs/development/`        |
| CONTRIBUTING.md:441-444 | `pytest tests/unit/`                                         | НЕ существует — реальная структура `backend/tests/services/`, `tests/integration/` | grep tests структуру          |
| CONTRIBUTING.md:519     | "security@bookreader.ai"                                     | sandkme@gmail.com                                                                  | userEmail                     |
| CONTRIBUTING.md:595     | `fancai-vibe-hackathon/`                                     | `fancai/`                                                                          | rename                        |
| CONTRIBUTING.md:619     | "Спасибо за ваш вклад в **BookReader AI**!"                  | fancai                                                                             | rename                        |

### 1.4. CHANGELOG.md

| Проблема   | Описание                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Объём      | Всего 1KB на 2026-02-25, покрывает только 1.0.0 — нет v1.1, v1.2, v1.3 milestone'ов                          |
| Стиль      | Не Keep-a-Changelog, не Conventional Changelog — фрагментарный                                               |
| Содержание | Не отражает milestone arc v1.0..v1.5, ключевые pivots (NLP removal, Modal abandoned), миграцию на OpenRouter |
| Источник   | `.planning/MILESTONES.md`, `.planning/milestones/v1.X-ROADMAP.md`                                            |

### 1.5. CLAUDE.md (root)

| Файл:строка | Заявлено                                                                      | Фактически                                                     | Источник истины            |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| CLAUDE.md:9 | "AI: OpenRouter (LLM: Gemini 3.0 Flash) \| OpenRouter (Images: FLUX.2 Klein)" | LLM primary: gemini-2.5-flash, fallback: gemini-2.5-flash-lite | openrouter_client.py:58-59 |

(остальное в CLAUDE.md актуально на 2026-03-18)

### 1.6. docs/README.md

| Файл:строка          | Заявлено                                                                                                                           | Фактически                                                                                     | Источник истины                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| docs/README.md:9-22  | Diataxis-структура с `guides/getting-started/`, `reference/api/`, `reference/database/`, `reference/components/`, `reference/cli/` | НЕ существует — папки не созданы                                                               | `ls docs/guides/`, `ls docs/reference/` |
| docs/README.md:54-61 | "Refactoring section с Plans/Reports/Database/NLP/Code Quality"                                                                    | Реально папка `docs/refactoring/` содержит только 5 файлов 2025-11-03-\* (в плоской структуре) | `ls docs/refactoring/`                  |
| docs/README.md:124   | "Архитектура: Multi-NLP система удалена в декабре 2025"                                                                            | OK (это правда)                                                                                | requirements.txt:21-22                  |
| docs/README.md:112   | "Обновлено: 2026-01-15"                                                                                                            | 3+ месяца не обновлялось                                                                       | дата файла                              |

### 1.7. docs/SECURITY.md

| Файл:строка          | Заявлено                                                                                                                                                                                                                                   | Фактически                                 | Источник истины                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------- |
| docs/SECURITY.md:1   | "Security Guidelines - **BookReader AI**"                                                                                                                                                                                                  | fancai                                     | rename                           |
| docs/SECURITY.md:283 | "security@bookreader.ai"                                                                                                                                                                                                                   | sandkme@gmail.com                          | userEmail                        |
| docs/SECURITY.md:326 | path `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/...`                                                                                                                                                                             | `/Users/sandk/Documents/GitHub/fancai/...` | абсолютные пути из старого имени |
| docs/SECURITY.md:529 | "Document Version 2.0, Last Audit 2025-10-30, Next Review 2025-11-30"                                                                                                                                                                      | давно не обновлялось                       | дата файла                       |
| Содержание           | Документ — отчёт о P0-1, P0-6, P0-7 fixes от 2025-10-30. Это **исторический отчёт**, не security policy. Должно быть переписано как SECURITY.md (policy + how-to-report) и архивировано как `docs/reports/2025-10-30-p0-security-fixes.md` |

### 1.8. docs/ru/README.md

| Файл:строка          | Заявлено                                                          | Фактически                 | Источник истины        |
| -------------------- | ----------------------------------------------------------------- | -------------------------- | ---------------------- |
| docs/ru/README.md:1  | "Документация **BookReader AI**"                                  | fancai                     | rename                 |
| docs/ru/README.md:3  | "русскоязычную документацию **BookReader AI**"                    | fancai                     | rename                 |
| docs/ru/README.md:22 | "[NLP](reference/nlp/) - Multi-NLP система, процессоры, ансамбль" | NLP удалён в декабре 2025  | requirements.txt:21-22 |
| docs/ru/README.md:28 | "[Архитектура] - Системная архитектура, инфраструктура, NLP"      | NLP не должен фигурировать | то же                  |

### 1.9. docs/development/README.md, docs/operations/README.md, docs/ci-cd/README.md

| Проблема                          | Описание                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Подссылки на несуществующие файлы | Ссылается на `planning/development-plan.md`, `changelog/2025.md`, `status/current-status.md`, `deployment/overview.md`, etc. — большинство этих файлов НЕТ либо они в плоской структуре, не в подпапках                                                               |
| Структура                         | README предполагают вложенные подпапки (`planning/`, `changelog/`, `status/`, `testing/`, `performance/`, `parser/`, `deployment/`, `docker/`, `backup/`, `monitoring/`, `maintenance/`, `workflows/`, `action-plans/`, `error-reports/`), которые на деле не созданы |
| Решение                           | Полностью переписать README'ы под фактическую плоскую структуру, или создать недостающие подпапки и переместить файлы                                                                                                                                                 |

---

## 2. Скоуп: что в скоупе обновления

### 2.1. Обновить (rewrite или substantial update)

| Файл                         | Размер | Действие                                            | Приоритет             |
| ---------------------------- | ------ | --------------------------------------------------- | --------------------- |
| `README.md`                  | 17KB   | Полная переписка                                    | **P0** (критично)     |
| `README-ru.md`               | 19KB   | Полная переписка, синхронно с EN                    | **P0**                |
| `CONTRIBUTING.md`            | 21KB   | Полная переписка                                    | **P0** (имя проекта!) |
| `CHANGELOG.md`               | 1KB    | Расширить с milestone history                       | **P1**                |
| `CLAUDE.md`                  | 5KB    | Точечная правка LLM-моделей (line 9)                | **P1**                |
| `docs/README.md`             | 7KB    | Переписать под фактическую структуру                | **P1**                |
| `docs/SECURITY.md`           | 13KB   | Переписать как policy + архивировать old как report | **P1**                |
| `docs/ru/README.md`          | ?      | Синхронизировать с docs/README.md                   | **P1**                |
| `docs/development/README.md` | 1KB    | Переписать под плоскую структуру                    | **P2**                |
| `docs/operations/README.md`  | 1KB    | Переписать под плоскую структуру                    | **P2**                |
| `docs/ci-cd/README.md`       | 1KB    | Переписать под плоскую структуру                    | **P2**                |
| `docs/security/README.md`    | ?      | Синхронизировать с SECURITY.md                      | **P2**                |
| `docs/refactoring/README.md` | ?      | Переоценить или архивировать                        | **P3**                |

### 2.2. НЕ трогать

- `docs/reports/*` (200+ исторических отчётов)
- `docs/research/*` (50+ research, могут быть устаревшими гипотезами)
- `docs/plans/*`, `docs/prompts/*`, `docs/refactoring/2025-11-03-*` (артефакты)
- `docs/ios/*` (отложенные планы, оставить)
- `docs/analysis/`, `docs/questions/` (артефакты)
- `.planning/*` (GSD-территория)
- `AGENTS.md`, `GEMINI.md` (конфиги AI-CLI)
- `frontend/CLAUDE.md`, `backend/CLAUDE.md` (актуальны, обновляются автоматически)
- Код: `backend/`, `frontend/`, `modal/`, `scripts/`

### 2.3. Архивировать в `docs/_archive/<original-path>/`

| Файл                                                                                                   | Причина                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `docs/DEVELOPMENT_PROGRESS.md` (от 2025-08)                                                            | очень старый, исторический                     |
| `docs/development/EPUB_READER_COMPREHENSIVE_ANALYSIS.md`                                               | большой анализ, сейчас неактуален              |
| `docs/development/EPUB_READER_FIX_PLAN.md`                                                             | план реализованный, исторический               |
| `docs/development/PERFORMANCE_REFACTORING_ANALYSIS.md` (.md и .ru.md)                                  | старые перформанс-аудиты                       |
| `docs/development/testing-refactoring-analysis.md` (.md и .ru.md)                                      | старые testing-аудиты                          |
| `docs/development/AGENT_SYSTEM_IMPROVEMENTS_2025-11-18.md`                                             | артефакт ноября                                |
| `docs/development/agents-update-summary-2025-11-18.md`                                                 | артефакт ноября                                |
| `docs/development/GAP_ANALYSIS_REPORT.md`                                                              | устарел                                        |
| `docs/development/orchestrator-agent-guide.md`                                                         | устарел (агент-система v1)                     |
| `docs/development/claude-code-agents-system.md`                                                        | устарел                                        |
| `docs/development/changelog.md`, `current-status.md`, `development-calendar.md`, `development-plan.md` | дублируют GSD-артефакты                        |
| `docs/development/parser-optimizations.md`                                                             | старый                                         |
| `docs/FRONTEND-AUDIT.md` (март), `docs/IMAGE-GENERATION-BUGS-AUDIT.md` (март)                          | в `docs/_archive/reports/` или `docs/reports/` |
| `docs/AUDIT-2026-03-21-session-fixes.md`                                                               | в `docs/_archive/reports/`                     |

---

## 3. Сводка решений

### 3.1. Ключевые правки фактов (применить везде)

1. **Имя проекта:** `fancai` (не "BookReader AI", не "fancai-vibe-hackathon", не "bookreader-ai").
2. **Python:** 3.12 (не 3.11).
3. **FastAPI:** 0.135.1 (не 0.125, не 0.128).
4. **PostgreSQL:** 17 (не 15, не 15.7).
5. **Redis (server):** 7.4.8 (не 7.4 без точки).
6. **Vite:** 8.x (не 6.0, не 7).
7. **Tailwind:** 4.x (не 3.4).
8. **Celery:** 5.6.2 (не 5.4).
9. **TypeScript:** 5.7.x (OK, без изменений).
10. **React:** 19.x (OK, без изменений).
11. **TanStack Query:** 5.91 (не 5.90).
12. **AI LLM:** primary `google/gemini-2.5-flash`, fallback `google/gemini-2.5-flash-lite` (через OpenRouter). НЕ Gemini 3.0 Flash, НЕ Gemini 3.1.
13. **AI Image:** `black-forest-labs/flux.2-klein-4b` (через OpenRouter). НЕ Imagen 4, НЕ Imagen.
14. **AI provider:** OpenRouter (единственный). НЕ Google Cloud, НЕ Vertex AI.
15. **API key env:** `OPENROUTER_API_KEY` (не `GOOGLE_API_KEY`).
16. **Package manager (Python):** `uv` (не `pip` напрямую).
17. **Docker:** `docker compose` (без дефиса) с явным `-f docker-compose.{dev,prod,monitoring}.yml`.
18. **Default compose file:** не существует (`docker-compose.yml` отсутствует) — всегда `-f`.
19. **NLP system:** удалён в декабре 2025 (RAM-оптимизация). Не упоминать в архитектуре.
20. **Modal vLLM:** abandoned 2026-03-29 (после провала staging). В CHANGELOG отметить.

### 3.2. Главные фичи (правильный порядок)

**Текущая ошибка:** README говорит «AI image generation» как primary feature, Entity Wiki не упомянут.

**Реальность (.planning/PROJECT.md:5):** Entity Wiki — **главная фича** (interactive AI-glossary с защитой от спойлеров), AI-image generation — **вторая фича**.

**Применить везде:** перечислять обе фичи, Entity Wiki — первой.

### 3.3. Out-of-scope (не упоминать как фичу)

Из `.planning/PROJECT.md:74`:

- Платежная система / Subscription tiers (FREE/PREMIUM/ULTIMATE) — out of scope
- Социальные/community-функции — out of scope
- Встроенный магазин книг — out of scope
- Озвучка текста — out of scope
- AI-рекомендации книг — out of scope
- Форматы помимо EPUB/FB2 — out of scope (EPUB стандарт, Calibre для конвертации)
- Совместные аннотации — out of scope
- Нативное мобильное приложение / React Native — out of scope (web-first PWA)
- 3D curl-анимация / Pinch-to-zoom — out of scope (epub.js не поддерживает)
- Push notifications — out of scope (не релевантно для ридера книг)

### 3.4. Структура docs/

Реальная плоская структура:

```
docs/
├── README.md                       — навигатор
├── SECURITY.md                     — security policy
├── analysis/, design/, ios/, questions/  — артефакты, оставить
├── ci-cd/, deployment/, development/, operations/, security/  — README+файлы плоско
├── explanations/, guides/, reference/  — README'ы есть, подпапок мало
├── refactoring/                    — артефакты ноября 2025
├── ru/                             — русские версии
├── plans/, prompts/, reports/, research/  — архивы (НЕ ТРОГАТЬ)
└── _drafts/, _archive/             — рабочие/архивные
```

Подпапки `guides/getting-started/`, `reference/api/`, `reference/database/`, `operations/deployment/` и т.п., упоминаемые в README'ах, **не существуют**. Решение: переписать README'ы под фактическую плоскую структуру (не создавать подпапки сейчас — это смены кодовой базы за пределами скоупа).

---

## 4. Открытые вопросы (для согласования с пользователем в Фазе 2)

1. **Имя проекта в badges README:** оставить «fancai» (lowercase) везде, или допустить «Fancai» (Title Case) в маркетинговых местах? Сейчас вперемешку.
2. **Лицензия:** Proprietary (как в текущем README) — подтвердить, что курс не изменился.
3. **Архивация старых docs:** удалять или сохранять в `docs/_archive/`? Промпт говорит «не удалять», но пользователь может разрешить delete для совсем мёртвого.
4. **CHANGELOG.md формат:** Keep-a-Changelog (стандарт) или произвольный по образцу прошлых notes?
5. **docs/SECURITY.md:** оставить старый отчёт о P0-1/P0-6/P0-7 фиксах или архивировать в `docs/reports/2025-10-30-p0-security-fixes.md` и SECURITY.md переписать как чистую policy?
6. **CONTRIBUTING.md:** упомянуть ли GSD workflow (`.planning/`, `/gsd:*` команды) — это специфика проекта, может смутить внешнего контрибьютора, но без неё руководство неполное.
7. **Pre-commit hooks:** текущий CONTRIBUTING упоминает их, но `.pre-commit-config.yaml` в репо отсутствует. Удалить упоминание или предложить добавить?
8. **README structure:** монолитный длинный README (как сейчас, ~400 строк) или разделить на короткий (≤200 строк) + ссылки в `docs/`?

---

## 5. Готовность к Фазе 2

**Drift matrix создана.** Все ключевые расхождения зафиксированы. Скоуп определён. Открытые вопросы подготовлены для согласования.

**Следующий шаг:** показать план изменений (Фаза 2) и дождаться OK перед записью.

---

_Last updated: 2026-04-30, verified against commit cededd96_
