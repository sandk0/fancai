---
name: deploy
description: Deploy fancai to production VPS. Use when deploying, shipping, or pushing to production.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Deploy to Production

## Pre-deployment Checks

1. Run frontend build: `cd frontend && npm run build`
2. Run backend tests (skip known broken):
   ```bash
   cd backend && uv run python -m pytest -v --tb=short \
     --ignore=tests/services/test_langextract_processor.py \
     --ignore=tests/services/test_circuit_breaker.py
   ```
   Note: Tests requiring Redis/DB (test_security, test_token_blacklist, test_user_statistics) will error locally — this is expected. Check that non-infra tests pass.
3. Check git status is clean: `git status`
4. Check current branch is main: `git branch --show-current`

## Deployment Options

### Full Stack (default)

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend backend && docker compose -f docker-compose.prod.yml down frontend caddy && docker volume rm app_frontend_build && docker compose -f docker-compose.prod.yml up -d"
```

### Backend Only

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build backend && docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat"
```

### Frontend Only

IMPORTANT: Named volume `app_frontend_build` caches static files. Must remove it to pick up new build.

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend && docker compose -f docker-compose.prod.yml down frontend caddy && docker volume rm app_frontend_build && docker compose -f docker-compose.prod.yml up -d"
```

## Database Migrations (if needed)

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml exec backend alembic upgrade head"
```

## Post-deployment Verification

1. Check containers: `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml ps"`
2. Verify frontend files are fresh (hash should match local build):
   ```bash
   ssh fancai "docker compose -f /opt/fancai/app/docker-compose.prod.yml exec caddy ls /var/www/frontend/assets/js/ | grep BookReaderPage"
   ```
3. Check site responds: `curl -s -o /dev/null -w '%{http_code}' https://fancai.ru`
4. Check backend logs: `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=20 backend"`
5. Report deployment status

## Optional: Flush Redis Cache

Only if requested: `ssh fancai "docker exec fancai_redis redis-cli -n 0 FLUSHDB"`

Note: Redis DB 0 = cache, DB 1 = Celery broker (DO NOT flush), DB 2 = Celery results
