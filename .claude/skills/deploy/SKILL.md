---
name: deploy
description: Deploy fancai to production VPS. Use when deploying, shipping, or pushing to production.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Deploy to Production

## Pre-deployment Checks

1. Run frontend build: `cd frontend && npm run build`
2. Run backend tests: `cd backend && pytest -v --tb=short`
3. Check git status is clean: `git status`
4. Check current branch is main: `git branch --show-current`

## Deployment Options

### Full Stack (default)

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend backend && docker compose -f docker-compose.prod.yml up -d"
```

### Backend Only

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build backend && docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat"
```

### Frontend Only

```bash
ssh fancai "cd /opt/fancai/app && git pull origin main && docker compose -f docker-compose.prod.yml build frontend && docker compose -f docker-compose.prod.yml up -d frontend caddy"
```

## Database Migrations (if needed)

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml exec backend alembic upgrade head"
```

## Post-deployment Verification

1. Wait 10 seconds for container startup
2. Check containers: `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml ps"`
3. Check backend logs: `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=20 backend"`
4. Check frontend: `curl -s -o /dev/null -w '%{http_code}' https://fancai.ru`
5. Report deployment status

## Optional: Flush Redis Cache

Only if requested: `ssh fancai "docker exec fancai_redis redis-cli -n 0 FLUSHDB"`

Note: Redis DB 0 = cache, DB 1 = Celery broker (DO NOT flush), DB 2 = Celery results
