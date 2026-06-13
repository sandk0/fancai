# CI/CD

GitHub Actions. **Источник истины** — `.github/workflows/*.yml`; этот документ — обзор.

> Подробные ci-cd-доки октября 2025 (старое имя, аспирационные staging-стратегии)
> заархивированы в [`../_archive/2026-06-13-stale-infra/ci-cd/`](../_archive/2026-06-13-stale-infra/ci-cd/).

## Workflows

### `ci.yml` — push в `main`/`develop`, PR в `main`

8 джобов: **backend-lint** (ruff / black --check / mypy) · **backend-tests** (pytest + coverage,
service-контейнеры PostgreSQL 17 + Redis 7) · **frontend-lint** (ESLint + `tsc --noEmit`) ·
**frontend-tests** (vitest + `npm run build` + артефакт dist) · **e2e-tests** (Playwright chromium) ·
**security-scan** (Trivy fs + TruffleHog) · **docker-build** (на PR) · **all-checks-passed** (gate).

### `security.yml` — push/PR + еженедельно (понедельник)

pip-audit / safety (Python), npm audit (JS), Bandit, CodeQL (Python + JavaScript), Trivy image scan,
TruffleHog / Gitleaks (secrets), license-check. Результаты → GitHub Security tab (SARIF).

### `modal-deploy.yml` — legacy

Триггер на `modal/**`. Modal-путь отключён (см. [`../architecture/ai-pipeline.md`](../architecture/ai-pipeline.md)) —
workflow оставлен как наследие.

## Окружение CI

Python 3.12, Node 22. Тестовые БД/Redis — service-контейнеры (не прод).

## Связанное

- Production deploy: [`../deployment/README.md`](../deployment/README.md)
- Day-2 runbook'и: [`../operations/`](../operations/)

---

_Последнее обновление: 2026-06-13. Сверено с `.github/workflows/{ci,security,modal-deploy}.yml`._
