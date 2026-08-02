# Документация fancai

Навигатор по документации. Актуально на **2026-07-18**.

> **Project overview:** [`README.md`](../README.md) · [`README-ru.md`](../README-ru.md)
> **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)
> **Текущее состояние:** [`.planning/STATE.md`](../.planning/STATE.md) · **Roadmap:** [`.planning/ROADMAP.md`](../.planning/ROADMAP.md)

---

## Архитектура (как есть)

| Документ                                                     | О чём                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`architecture/overview.md`](architecture/overview.md)       | Обзор системы: стек, backend/frontend карта, поток обработки книги          |
| [`architecture/ai-pipeline.md`](architecture/ai-pipeline.md) | Gemini Direct / Vertex, mixed OpenRouter reduce route, legacy Modal flags |

## Разработчикам

| Что                                   | Где                                              |
| ------------------------------------- | ------------------------------------------------ |
| Setup, conventions, tests, PR-процесс | [`../CONTRIBUTING.md`](../CONTRIBUTING.md)       |
| Контекст для AI-агентов (Claude Code) | [`../CLAUDE.md`](../CLAUDE.md)                   |
| Backend-conventions (Python/FastAPI)  | [`../backend/CLAUDE.md`](../backend/CLAUDE.md)   |
| Frontend-conventions (React/Vite/TS)  | [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md) |

## DevOps / Production

| Раздел                       | О чём                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`deployment/`](deployment/) | Реальная инфра: single VPS + Caddy + Compose; current deploy/monitoring gaps |
| [`operations/`](operations/) | Day-2: backup/restore, outage status, [`migration/`](operations/migration/) |
| [`ci-cd/`](ci-cd/) | GitHub Actions workflow; repository Actions сейчас выключены |

## Безопасность

- **Policy + how-to-report:** [`SECURITY.md`](SECURITY.md)
- **Backend security notes:** [`../backend/SECURITY.md`](../backend/SECURITY.md)

---

## Архивы (read-only — снапшоты во времени, не текущая истина)

| Директория                                                                                                 | Что внутри                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`reports/`](reports/)                                                                                     | Исторические отчёты по фазам, аудиты (530 файлов)                                                                                                                                                     |
| [`research/`](research/)                                                                                   | Research по AI-моделям, Gemini API, GPU, payment, NLP, Modal — гипотезы и сравнения                                                                                                                   |
| [`plans/`](plans/)                                                                                         | Артефакты прошлых планов                                                                                                                                                                              |
| [`prompts/`](prompts/)                                                                                     | Промпты для AI-агентов (включая модернизации документации)                                                                                                                                            |
| [`refactoring/`](refactoring/)                                                                             | Артефакты рефакторинга 2025-11                                                                                                                                                                        |
| [`ios/`](ios/)                                                                                             | Отложенные iOS native-планы (текущая стратегия — PWA)                                                                                                                                                 |
| [`analysis/`](analysis/), [`design/`](design/), [`questions/`](questions/), [`superpowers/`](superpowers/) | Точечные артефакты                                                                                                                                                                                    |
| [`_archive/`](_archive/)                                                                                   | Устаревшее, перемещённое при модернизациях (2026-04-30, 2026-06-13): бывшие Diataxis-секции (`guides/`, `reference/`, `explanations/`, `development/`, `ru/`) и аспирационные infra-доки октября 2025 |

## Рабочее (не для review)

- [`_drafts/`](_drafts/) — артефакты текущей модернизации: `2026-06-13-docs-inventory.md`, `2026-06-13-doc-drift-matrix-v2.md`, `2026-06-13-docs-modernization-plan.md`

---

## Конвенции для авторов

При добавлении нового `.md`:

1. **Куда:**
   - Текущий operational doc → `deployment/`, `operations/`, `ci-cd/`, `architecture/`
   - Snapshot отчёта/анализа → `reports/` с datestamp `YYYY-MM-DD-<topic>.md`
   - Research / гипотезы → `research/` с datestamp
2. **Сверяй чувствительные ко времени утверждения с источником истины:**
   - Версии — `backend/pyproject.toml` + `backend/uv.lock`, `frontend/package.json`, `docker-compose.prod.yml`
   - AI routing — `backend/app/core/ai_provider_factory.py`, `core/gemini_client.py`,
     `services/consistency_manager.py`, `tasks/book_tasks.py`, `tasks/image_tasks.py`
   - Инфра — `docker-compose.prod.yml`, `docker-compose.monitoring.yml`, `Caddyfile`, `scripts/`
   - Vision / scope / gaps — `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`
3. **Футер** живого дока: `_Последнее обновление: YYYY-MM-DD. Сверено с: <файлы>._`

---

_Последнее обновление: 2026-07-18. Текущий audit baseline — `.planning/STATE.md`; предыдущая документационная модернизация — `reports/2026-06-13-documentation-modernization-v2.md`._
