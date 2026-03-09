---
paths:
  - "docker-compose*.yml"
  - "Dockerfile*"
  - "Caddyfile*"
  - ".dockerignore"
---

## Docker & Infrastructure Rules

- ALWAYS use `docker compose` (NOT `docker-compose` with hyphen)
- Production: `docker-compose.prod.yml` | Development: `docker-compose.dev.yml`
- Do NOT create additional compose files (staging.yml, ssl.yml were removed)
- Caddy replaces nginx — do NOT add nginx config

### Container Memory Limits

- Celery workers: 512MB unified across all envs
- Backend: 2GB (prod), 1.5GB (dev)
- PostgreSQL: 12GB (prod), 1GB (dev)

### Redis DB Layout (CRITICAL)

| DB  | Purpose        | Can Flush?           |
| --- | -------------- | -------------------- |
| 0   | App cache      | Yes (with caution)   |
| 1   | Celery broker  | NEVER                |
| 2   | Celery results | Safe for old results |

### Environment Variables

- `OPENROUTER_API_KEY` — AI services (NOT GOOGLE_API_KEY)
- `SECRET_KEY` — JWT signing
- All config in `backend/app/core/config.py`
