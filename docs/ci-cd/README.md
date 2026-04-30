# CI/CD

GitHub Actions pipeline, branch protection и deployment guides.

## Содержание

| Файл                                                                 | Описание                    |
| -------------------------------------------------------------------- | --------------------------- |
| [`CI_CD_SETUP.md`](CI_CD_SETUP.md)                                   | Первичная настройка CI/CD   |
| [`CI_CD_IMPLEMENTATION_SUMMARY.md`](CI_CD_IMPLEMENTATION_SUMMARY.md) | Сводка реализации           |
| [`GITHUB_ACTIONS_GUIDE.md`](GITHUB_ACTIONS_GUIDE.md)                 | GitHub Actions workflows    |
| [`BRANCH_PROTECTION_RULES.md`](BRANCH_PROTECTION_RULES.md)           | Branch protection (main)    |
| [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)                         | Deployment через CI/CD      |
| [`QUICK_REFERENCE.md`](QUICK_REFERENCE.md)                           | Быстрая шпаргалка           |
| [`error-index.md`](error-index.md)                                   | Типовые CI-ошибки и решения |

## Связанное

- Workflows на диске: `.github/workflows/*.yml`
- Production deploy: [`../deployment/`](../deployment/)
- Runbook'и: [`../operations/`](../operations/)

> Файлы в этой директории могут содержать устаревшие упоминания CI-стека
> от 2025 года; принципы остаются валидными, но сверяйте имена workflow и
> shell-команд с актуальным `.github/workflows/`.

---

_Last updated: 2026-04-30._
