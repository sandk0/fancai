---
name: celery-debug
description: Debug Celery task failures, memory issues, and queue problems. Use when celery tasks fail, book processing hangs, image generation times out, or workers consume too much memory.
allowed-tools: Bash, Read, Grep, Glob
---

# Celery Task Debugging

## Quick Diagnosis

### 1. Check Worker Status

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml exec celery-worker celery -A app.celery_app inspect active"
```

### 2. Check Flower Dashboard

URL: https://fancai.ru (via Caddy reverse proxy to Flower)

### 3. Check Redis Queues

```bash
ssh fancai "docker exec fancai_redis redis-cli -n 1 LLEN celery"
ssh fancai "docker exec fancai_redis redis-cli INFO memory"
```

### 4. Check Worker Logs

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=100 celery-worker"
```

## Common Issues

### Task Stuck

1. Check distributed lock: `redis-cli -n 0 KEYS "lock:*"`
2. Check OOM: `docker inspect --format='{{.State.OOMKilled}}' fancai_celery_worker`
3. Worker memory limit: 512MB unified

### Image Generation Timeout

- Soft limit 300s, hard limit 360s
- Check OpenRouter: `curl -s https://openrouter.ai/api/v1/models | head -20`
- Use `/openrouter-monitor` for detailed diagnostics

### Book Processing Failure

- 100K char chunks with 15% overlap
- Entity loss at chunk boundaries (known issue)
- Check: `grep -iE "error|exception|timeout" <worker_logs>`

## Redis DB Layout (CRITICAL)

| DB  | Purpose        | Can Flush?           |
| --- | -------------- | -------------------- |
| 0   | App cache      | Yes (with caution)   |
| 1   | Celery broker  | NEVER in production  |
| 2   | Celery results | Safe for old results |

## Key Files

- `backend/app/celery_app.py` — Celery config
- `backend/app/tasks/book_tasks.py` — Book processing (soft limit 3h)
- `backend/app/tasks/image_tasks.py` — Image generation (soft limit 300s)
- `backend/app/tasks/cleanup_tasks.py` — Cleanup tasks

## Recovery

1. Restart worker: `ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml restart celery-worker"`
2. Purge stuck tasks: `docker compose exec celery-worker celery -A app.celery_app purge`
3. Clear lock: `docker exec fancai_redis redis-cli -n 0 DEL 'lock:<book_id>:processing'`
