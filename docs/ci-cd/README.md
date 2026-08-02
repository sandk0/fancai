# CI/CD

GitHub Actions. **Источник истины** — `.github/workflows/*.yml`; этот документ — обзор.

> Подробные ci-cd-доки октября 2025 (старое имя, аспирационные staging-стратегии)
> заархивированы в [`../_archive/2026-06-13-stale-infra/ci-cd/`](../_archive/2026-06-13-stale-infra/ci-cd/).

> **Фактический status 2026-07-18:** GitHub Actions на уровне репозитория выключены
> (`actions/permissions.enabled=false`). Последний run на `main` — 2025-11-13, failed.
> Поэтому описанные ниже workflows сейчас не являются действующим quality/security gate.

## Workflows

### `ci.yml` — push в `main`/`develop`, PR в `main`

8 джобов: **backend-lint** (ruff / black --check / mypy) · **backend-tests** (pytest + coverage,
service-контейнеры PostgreSQL 17 + Redis 7) · **frontend-lint** (ESLint + `tsc --noEmit`) ·
**frontend-tests** (vitest + `npm run build` + артефакт dist) · **e2e-tests** (Playwright chromium) ·
**security-scan** (Trivy fs + TruffleHog) · **docker-build** (на PR) · **all-checks-passed**.

Known blocker до включения: workflow создаёт `fancai_test`, но `backend/tests/conftest.py`
при пустом `TEST_DATABASE_URL` выводит `fancai_test_test`. Mypy также скрыт через `|| true`,
то есть текущий YAML не является строгим gate даже после включения Actions.

### `security.yml` — push/PR + еженедельно (понедельник)

pip-audit / safety (Python), npm audit (JS), Bandit, CodeQL (Python + JavaScript), Trivy image scan,
TruffleHog / Gitleaks (secrets), license-check. Результаты → GitHub Security tab (SARIF).

### `dependabot-auto-merge.yml`

Автоматизирует обработку Dependabot PR. Как и остальные Actions, не выполняется, пока
repository Actions выключены. Tracked `modal-deploy.yml` больше нет; Modal deployment не
является частью текущего CI/CD.

## Окружение CI

Python 3.12, Node 22. Тестовые БД/Redis — service-контейнеры (не прод).

Порядок восстановления CI и reproducible baseline:
[`Production Reliability Baseline`](../superpowers/plans/2026-07-18-production-reliability-baseline.md).

## Связанное

- Production deploy: [`../deployment/README.md`](../deployment/README.md)
- Day-2 runbook'и: [`../operations/`](../operations/)

---

_Последнее обновление: 2026-07-18. Сверено с GitHub Actions repository permission, recent runs и `.github/workflows/{ci,security,dependabot-auto-merge}.yml`._
