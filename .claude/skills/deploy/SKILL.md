---
name: deploy
description: Deploy fancai to production VPS. Use when deploying, shipping, or pushing to production.
allowed-tools: Bash, Read, Grep, Glob
---

# Deploy to Production

You are an intelligent deploy agent. Analyze the current context and choose the right deployment strategy.

## Step 1: Analyze Changes

Determine WHAT changed since the last deploy:

```bash
# Find last deployed commit on server
DEPLOYED=$(ssh fancai "cd /opt/fancai/app && git rev-parse HEAD")
# Compare with local HEAD
git log --oneline --name-only $DEPLOYED..HEAD
```

Classify changes into categories:

- **frontend-only**: only `frontend/` files changed
- **backend-only**: only `backend/` files changed (excluding migrations)
- **full-stack**: both frontend and backend changed
- **has-migrations**: `backend/alembic/versions/` has new files
- **config-only**: only `.claude/`, `CLAUDE.md`, docs, etc. — NO deploy needed

## Step 2: Pre-deployment Checks

Run ONLY relevant checks based on what changed:

| Changed  | Check                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frontend | `cd frontend && npm run build`                                                                                                                              |
| backend  | `cd backend && uv run python -m pytest -v --tb=short --ignore=tests/services/test_langextract_processor.py --ignore=tests/services/test_circuit_breaker.py` |
| either   | `git status` must be clean, branch must be `main`                                                                                                           |

Note: Backend tests requiring Redis/DB (test_security, test_token_blacklist, test_user_statistics) error locally — expected. Only check non-infra tests pass.

If git is dirty — ask user whether to commit first or abort.

## Step 3: Push & Deploy

First push: `git push origin main`

Then deploy based on classification:

### Frontend Only

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend && docker compose -f docker-compose.prod.yml down frontend caddy && docker volume rm app_frontend_build && docker compose -f docker-compose.prod.yml up -d"
```

CRITICAL: Volume `app_frontend_build` MUST be removed — Docker named volumes don't update on container recreate.

### Backend Only

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build backend && docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat"
```

### Full Stack

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend backend && docker compose -f docker-compose.prod.yml down frontend caddy && docker volume rm app_frontend_build && docker compose -f docker-compose.prod.yml up -d"
```

### Config Only

Tell the user: no deploy needed, changes are docs/config only.

## Step 4: Migrations (if needed)

Run ONLY if `has-migrations` is true:

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml exec backend alembic upgrade head"
```

## Step 5: Verify

Always run ALL of these after deploy:

1. `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml ps"`
2. If frontend deployed — verify file hash:
   ```bash
   ssh fancai "docker compose -f /opt/fancai/app/docker-compose.prod.yml exec caddy ls /var/www/frontend/assets/js/ | grep BookReaderPage"
   ```
3. `curl -s -o /dev/null -w '%{http_code}' https://fancai.ru` — must be 200
4. If backend deployed — check logs:
   ```bash
   ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=20 backend"
   ```

Report: what was deployed, verification results, any issues.

## Optional: Flush Redis Cache

Only if user requests: `ssh fancai "docker exec fancai_redis redis-cli -n 0 FLUSHDB"`

Redis DB 0 = cache, DB 1 = Celery broker (DO NOT flush), DB 2 = Celery results
