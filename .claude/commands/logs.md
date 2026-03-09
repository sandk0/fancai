---
description: View production logs. Usage /logs [backend|celery|caddy|errors] [lines]
allowed-tools: Bash
---

# Production Logs

Usage: `/logs` (all, 50 lines) | `/logs backend` | `/logs celery` | `/logs errors`

```bash
SERVICE="${ARGUMENTS:-}"
if [ -z "$SERVICE" ]; then
  ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=50"
elif [ "$SERVICE" = "errors" ]; then
  ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=200 | grep -iE '(error|exception|traceback|critical|fatal)'"
else
  ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=50 $SERVICE"
fi
```

Report: error count, types, recommendations.
