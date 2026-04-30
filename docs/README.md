# Документация fancai

Навигатор по документации. Текущее состояние документации актуально на
**2026-04-30**.

> **Project overview:** [`README.md`](../README.md) | [`README-ru.md`](../README-ru.md)
> **Vision / scope:** [`.planning/PROJECT.md`](../.planning/PROJECT.md)
> **Текущее состояние:** [`.planning/STATE.md`](../.planning/STATE.md)
> **Roadmap:** [`.planning/ROADMAP.md`](../.planning/ROADMAP.md)
> **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)

---

## Для разработчиков

| Что                                   | Где                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Setup, conventions, tests, PR-процесс | [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                                            |
| Контекст для AI-агентов (Claude Code) | [`../CLAUDE.md`](../CLAUDE.md)                                                        |
| Backend-conventions (Python/FastAPI)  | [`../backend/CLAUDE.md`](../backend/CLAUDE.md)                                        |
| Frontend-conventions (React/Vite/TS)  | [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md)                                      |
| Подразделение `development/`          | [`development/`](development/) (минимальный — основное в CLAUDE.md и CONTRIBUTING.md) |

---

## Для DevOps / Production

### [`deployment/`](deployment/) — production deploy

- [`PRODUCTION_INFRASTRUCTURE.md`](deployment/PRODUCTION_INFRASTRUCTURE.md) — обзор инфраструктуры
- [`DEPLOYMENT_CHECKLIST.md`](deployment/DEPLOYMENT_CHECKLIST.md) — чеклист релиза
- [`QUICK_REFERENCE.md`](deployment/QUICK_REFERENCE.md) — быстрые команды
- [`DATABASE_PRODUCTION.md`](deployment/DATABASE_PRODUCTION.md) — PostgreSQL prod-setup
- [`REDIS_PRODUCTION.md`](deployment/REDIS_PRODUCTION.md) — Redis prod-setup
- [`MONITORING_SETUP.md`](deployment/MONITORING_SETUP.md), [`LOGGING_SETUP.md`](deployment/LOGGING_SETUP.md)
- [`INFRASTRUCTURE_OPTIMIZATION.md`](deployment/INFRASTRUCTURE_OPTIMIZATION.md)
- [`DISASTER_RECOVERY.md`](deployment/DISASTER_RECOVERY.md)

### [`operations/`](operations/) — day-2 операции

- [`BACKUP_AND_RESTORE.md`](operations/BACKUP_AND_RESTORE.md) ([`BACKUP_AND_RESTORE.ru.md`](operations/BACKUP_AND_RESTORE.ru.md))
- [`VLESS_QUICK_REFERENCE.md`](operations/VLESS_QUICK_REFERENCE.md), [`VLESS_PROXY_RESEARCH_2025-11-30.md`](operations/VLESS_PROXY_RESEARCH_2025-11-30.md) — proxy
- [`nlp-canary-deployment-runbook.md`](operations/nlp-canary-deployment-runbook.md) — исторический runbook (NLP удалён в декабре 2025)

### [`ci-cd/`](ci-cd/) — CI/CD pipeline

- [`CI_CD_SETUP.md`](ci-cd/CI_CD_SETUP.md), [`CI_CD_IMPLEMENTATION_SUMMARY.md`](ci-cd/CI_CD_IMPLEMENTATION_SUMMARY.md)
- [`GITHUB_ACTIONS_GUIDE.md`](ci-cd/GITHUB_ACTIONS_GUIDE.md)
- [`BRANCH_PROTECTION_RULES.md`](ci-cd/BRANCH_PROTECTION_RULES.md)
- [`DEPLOYMENT_GUIDE.md`](ci-cd/DEPLOYMENT_GUIDE.md)
- [`QUICK_REFERENCE.md`](ci-cd/QUICK_REFERENCE.md), [`error-index.md`](ci-cd/error-index.md)

---

## Безопасность

- **Policy + how-to-report:** [`SECURITY.md`](SECURITY.md)
- **Архивный отчёт о P0-фиксах (2025-10-30):** [`reports/2025-10-30-p0-security-fixes.md`](reports/2025-10-30-p0-security-fixes.md)
- **Backend security notes:** [`../backend/SECURITY.md`](../backend/SECURITY.md)
- [`security/`](security/) — placeholder-директория, может содержать дополнительные security-отчёты

---

## Архивы (read-only)

| Директория                                                                 | Что внутри                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`reports/`](reports/)                                                     | Исторические отчёты по фазам, аудиты, анализы (200+ файлов). Снапшоты во времени, не текущая истина.                                               |
| [`research/`](research/)                                                   | Research-документы по AI-моделям, GPU, payment, NLP, Modal, Gemini API и т.д. Гипотезы и сравнения.                                                |
| [`plans/`](plans/)                                                         | Артефакты прошлых планов (entity-wiki, PWA, NLP removal и т.д.).                                                                                   |
| [`prompts/`](prompts/)                                                     | Промпты для AI-агентов (включая [`2026-04-30-documentation-modernization.md`](prompts/2026-04-30-documentation-modernization.md) — этот документ). |
| [`refactoring/`](refactoring/)                                             | Артефакты ноябрьского рефакторинга 2025 (`2025-11-03-*`) + [`INDEX.md`](refactoring/INDEX.md).                                                     |
| [`ios/`](ios/)                                                             | Отложенные iOS native-планы (текущая стратегия — PWA).                                                                                             |
| [`_archive/`](_archive/)                                                   | Документы, перемещённые сюда при модернизации 2026-04-30. См. [`_archive/README.md`](_archive/README.md).                                          |
| [`analysis/`](analysis/), [`design/`](design/), [`questions/`](questions/) | Точечные артефакты прошлых исследований.                                                                                                           |

### Placeholder-директории (Diataxis-структура без наполнения)

- [`guides/`](guides/), [`reference/`](reference/), [`explanations/`](explanations/) — задумывались как Diataxis-секции, но не были заполнены. README этих директорий содержат ссылки на потенциальные подпапки, которых нет. Используйте напрямую source files (`.planning/`, `CLAUDE.md`, `CONTRIBUTING.md`) или создавайте новые документы в плоской структуре `docs/development/`, `docs/deployment/`, `docs/operations/`.

### [`ru/`](ru/) — русские версии

В целом дублирует структуру `docs/`. Не все файлы синхронизированы с английскими
эквивалентами — приоритет ставится на актуальность того файла, к которому
кто-то обращается чаще.

---

## Рабочие директории (не для review)

- [`_drafts/`](_drafts/) — черновики и WIP-документы. Например, [`2026-04-30-doc-drift-matrix.md`](_drafts/2026-04-30-doc-drift-matrix.md) — артефакт текущей модернизации документации.

---

## Конвенции для авторов

При добавлении нового `.md`:

1. Определите, куда он логически относится:
   - **Live operational doc** (нужен сейчас и в будущем) → `deployment/`,
     `operations/`, `ci-cd/`, или новая категория с понятным именем
   - **Snapshot отчёта/анализа** (актуален в момент написания) → `reports/`
     с datestamp в имени: `YYYY-MM-DD-<topic>.md`
   - **Research / гипотезы** → `research/` с datestamp
   - **Plan** для конкретной работы → используйте `.planning/phases/<NN>/PLAN.md`
     через `/gsd:plan-phase`, не пишите вручную

2. Для каждого утверждения, чувствительного ко времени, проверяйте источник:
   - Версии — `package.json`, `requirements.txt`, `docker-compose.prod.yml`
   - AI-модели — `backend/app/core/openrouter_client.py`
   - Vision / scope — `.planning/PROJECT.md`
   - Текущие phase'ы — `.planning/STATE.md`, `.planning/ROADMAP.md`

3. В конце добавьте `*Last updated: YYYY-MM-DD*` — помогает оценивать
   актуальность через год.

---

_Last updated: 2026-04-30. См. также CHANGELOG.md «Unreleased» для контекста
текущей модернизации._
