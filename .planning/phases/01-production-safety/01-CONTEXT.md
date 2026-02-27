# Phase 1: Production Safety - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix security vulnerabilities (JWT migration to PyJWT, reject alg=none, reject default SECRET_KEY), switch to production deployment mode (Gunicorn + UvicornWorker, DEBUG=False), implement real health checks (PostgreSQL, Redis, Celery connectivity), add Sentry monitoring (backend + frontend + Celery), and set up database backups. No new user-facing features.

</domain>

<decisions>
## Implementation Decisions

### Monitoring & Sentry
- Self-hosted Sentry on the same server (server upgrade from 8 GB to 16+ GB planned)
- Two separate Sentry projects: Python backend and React frontend
- 100% sample rate for errors (self-hosted, no limits)
- Errors + performance traces enabled (API latency, Celery task duration)
- Celery integration mandatory — track AI pipeline failures (Gemini/Imagen)
- AI API call tracing: latency, error rate, timeouts for Gemini/Imagen
- Only internal health check endpoint (no external uptime monitoring)
- Logs to stdout via Docker (no structured JSON logging to files)
- No push notifications (Telegram/email) — Sentry UI only for now

### Backup Strategy
- Daily PostgreSQL backups at 03:00 MSK via cron on host
- Only PostgreSQL — no file backups (EPUBs/images can be regenerated)
- Storage: Yandex Object Storage (S3-compatible, need to create bucket)
- Compression: pg_dump | gzip before upload
- Retention: 7 days
- Backup failures reported to Sentry as events
- No encryption — private S3 bucket access is sufficient

### Deploy Configuration
- nginx reverse proxy already configured with Let's Encrypt SSL
- Gunicorn: 2 workers with UvicornWorker (conservative for RAM)
- Celery: 2 workers (parallel AI task processing)
- Server: 4 CPU cores, 8 GB RAM (upgrade to 16+ GB planned for Sentry)
- Docker memory limits per container (prevent OOM)
- restart: unless-stopped policy for all containers
- Short downtime during deploys is acceptable (no zero-downtime needed)
- Single docker-compose.lite.yml for production (no separate prod file)
- No rate limiting in this phase

### Secret Management
- .env file on server (not in git), Docker Compose reads env_file
- SECRET_KEY already reads from environment (has default fallback — must remove)
- Manual SECRET_KEY generation (strong key, no rotation)
- Create .env.example template in repository with placeholder values
- Verify .env is in .gitignore
- Fail-fast startup: app refuses to start if required env vars missing (SECRET_KEY, DATABASE_URL)

### Claude's Discretion
- Exact Sentry version and Docker Compose configuration for self-hosted
- Deploy flow improvements to docker-compose.lite.yml
- Full list of required env vars to validate at startup (Claude inspects code)
- Memory limit values per container (distribute 16 GB across services)
- Health check response format and timeout values
- Gunicorn timeout and keep-alive configuration

</decisions>

<specifics>
## Specific Ideas

- Server upgrade to 16+ GB RAM is prerequisite for self-hosted Sentry
- Yandex Object Storage chosen for S3 (Russian datacenter, matches fancai.ru hosting)
- Backup script should be simple bash + pg_dump + aws-cli (s3 compatible)
- Current deployment is ssh root@server -> docker compose

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-production-safety*
*Context gathered: 2026-02-27*
