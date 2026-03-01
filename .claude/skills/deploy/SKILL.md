---
name: deploy
description: Deploy fancai to production VPS. Use when deploying, shipping, or pushing to production.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Deploy to Production

## Pre-deployment Checks

1. Run frontend build: `cd frontend && npm run build`
2. Run backend type-check: `cd backend && python -m mypy app/ --ignore-missing-imports`
3. Run tests: `cd frontend && npm test -- --watchAll=false` and `cd backend && pytest -v --tb=short`
4. Check git status is clean: `git status`
5. Check current branch is main: `git branch --show-current`

## Deployment Steps

1. Push to main: `git push origin main`
2. SSH to server and deploy:

```bash
ssh root@77.246.106.109 "cd /root/fancai-vibe-hackathon && git pull origin main && docker compose -f docker-compose.prod.yml build backend && docker compose -f docker-compose.prod.yml up -d backend"
```

## Post-deployment Verification

1. Wait 10 seconds for container startup
2. Check containers: `ssh root@77.246.106.109 "cd /root/fancai-vibe-hackathon && docker compose -f docker-compose.prod.yml ps"`
3. Check logs: `ssh root@77.246.106.109 "cd /root/fancai-vibe-hackathon && docker compose -f docker-compose.prod.yml logs --tail=20 backend"`
4. Report deployment status

## Optional: Flush Redis

Only if requested: `ssh root@77.246.106.109 "docker exec bookreader_redis redis-cli FLUSHDB"`
