---
name: incident
description: Respond to production incidents on fancai.ru. Use when the site is down, slow, returning errors, or AI features are broken.
allowed-tools: Bash, Read, Grep, Glob
---

# Production Incident Response

## Triage (< 2 minutes)

### 1. Is the site up?

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s' https://fancai.ru
curl -s -o /dev/null -w '%{http_code} %{time_total}s' https://fancai.ru/api/v1/health
```

### 2. Are containers running?

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml ps"
```

### 3. Resource usage

```bash
ssh fancai "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'"
```

### 4. Recent logs (last 5 min)

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --since 5m backend celery-worker"
```

## Decision Tree

| Symptom          | Likely Cause      | Action                       |
| ---------------- | ----------------- | ---------------------------- |
| 502/504          | Backend crashed   | Restart backend              |
| Slow (>3s)       | DB/memory         | Check PG connections, memory |
| Images broken    | OpenRouter down   | `/openrouter-monitor`        |
| Books stuck      | Celery OOM        | `/celery-debug`              |
| Entities missing | Extraction failed | `/entity-pipeline`           |
| SSL error        | Caddy cert        | Check Caddy logs             |

## Recovery Commands

```bash
# Restart single service
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml restart backend"

# Full restart
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d"
```

## Post-Incident

1. Document in `docs/reports/YYYY-MM-DD-incident-<desc>.md`
2. Identify root cause
3. Update monitoring if blind spot found
