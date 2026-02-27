# Stack Research: Production Readiness Tooling

**Domain:** Production hardening for AI book reader (React 19 + FastAPI + Celery + PostgreSQL + Redis)
**Researched:** 2026-02-27
**Confidence:** HIGH (most recommendations verified via official docs/PyPI/npm)

## Context: What Already Exists

Before recommending additions, here is what the codebase already has in place:

| Category | Already In Place | Status |
|----------|-----------------|--------|
| Error tracking (backend) | `sentry-sdk[fastapi]==2.51.0` in requirements.txt | Installed but NOT initialized in main.py |
| Error tracking (frontend) | ErrorBoundary component exists | No Sentry SDK installed |
| Metrics | `prometheus-fastapi-instrumentator==7.1.0` + `prometheus-client==0.24.1` | Installed, Prometheus/Grafana stack in docker-compose.monitoring.yml |
| Logging | `loguru==0.7.3` with JSON production mode | Configured, working |
| Security headers | SecurityHeadersMiddleware (HSTS, CSP, X-Frame-Options, etc.) | Implemented, CSP nonces TODO |
| Rate limiting | Custom Redis-based RateLimiter with sliding window | Implemented, per-endpoint presets |
| Secrets validation | SecretsValidator with startup check | Implemented, production enforcement |
| Health checks | Docker Compose healthchecks on all services | Working, but app /health endpoint is fake |
| Backups | Storage volume backup (7-day retention) | Working, but NO database backup |
| Monitoring stack | Grafana + Prometheus + Loki + Promtail + Node Exporter + cAdvisor | Defined in docker-compose.monitoring.yml |
| JWT auth | `python-jose==3.5.0` | VULNERABILITY: unmaintained, known security issues |

**Key finding:** The monitoring infrastructure is already extensive. The main gaps are: (1) actually initializing Sentry, (2) adding Sentry to frontend, (3) replacing python-jose, (4) database backups, (5) fixing the health check, and (6) Gunicorn for production.

---

## Recommended Stack Additions

### 1. Error Monitoring -- Backend (Sentry Init)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| sentry-sdk[fastapi] | 2.53.0 | Error tracking + performance monitoring | Already installed (2.51.0), just needs initialization and version bump. Auto-integrates with FastAPI, Celery, SQLAlchemy, Redis. Industry standard. | HIGH |

**Action:** Upgrade from 2.51.0 to 2.53.0. Initialize in main.py lifespan:

```python
import sentry_sdk

sentry_sdk.init(
    dsn=settings.SENTRY_DSN,
    traces_sample_rate=0.2,          # 20% in production (cost control)
    profiles_sample_rate=0.1,        # 10% profiling
    send_default_pii=False,          # GDPR: no user PII
    environment="production",
    release=VERSION,
    integrations=[],                  # FastAPI/Celery auto-detected
    before_send=filter_sensitive_data, # Strip API keys from breadcrumbs
)
```

**Why these values:** 0.2 traces_sample_rate balances visibility with cost on a single-server deployment. Set `send_default_pii=False` because this handles user reading data (potentially sensitive).

**Source:** [Sentry FastAPI docs](https://docs.sentry.io/platforms/python/integrations/fastapi/), [PyPI sentry-sdk](https://pypi.org/project/sentry-sdk/) -- version 2.53.0 confirmed 2026-02-16

### 2. Error Monitoring -- Frontend (Sentry SDK)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| @sentry/react | ^10.40.0 | Frontend error tracking | React 19 support (onCaughtError/onUncaughtError hooks). Unified error tracking with backend Sentry. | HIGH |
| @sentry/vite-plugin | ^5.1.0 | Source map upload | Maps minified production errors to original TypeScript source. Required for meaningful frontend error reports. | HIGH |

**Action:** Install and initialize:

```bash
# Frontend dependencies
cd frontend && npm install @sentry/react
cd frontend && npm install -D @sentry/vite-plugin
```

**React 19 initialization pattern:**

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_ENVIRONMENT,
  tracesSampleRate: 0.1,           // 10% for frontend
  replaysSessionSampleRate: 0.1,   // 10% session replay
  replaysOnErrorSampleRate: 1.0,   // 100% replay on error
});

// In createRoot (React 19 hooks):
const root = createRoot(document.getElementById("root")!, {
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn("Uncaught error", error, errorInfo.componentStack);
  }),
});
```

**Vite config addition:**

```typescript
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    sentryVitePlugin({
      org: "fancai",
      project: "fancai-frontend",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
```

**Source:** [Sentry React docs](https://docs.sentry.io/platforms/javascript/guides/react/), [@sentry/react npm](https://www.npmjs.com/package/@sentry/react) -- version 10.40.0 confirmed, [@sentry/vite-plugin npm](https://www.npmjs.com/package/@sentry/vite-plugin) -- version 5.1.0 confirmed

### 3. JWT Library Replacement (CRITICAL SECURITY)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| PyJWT | 2.11.0 | JWT encode/decode | Replaces abandoned `python-jose`. Actively maintained, FastAPI docs officially recommend PyJWT. Near-drop-in replacement. | HIGH |

**Action:** Replace python-jose with PyJWT:

```bash
# In requirements.txt:
# REMOVE: python-jose[cryptography]==3.5.0
# ADD:    PyJWT[crypto]==2.11.0
```

**Migration (minimal code change):**

```python
# BEFORE (python-jose):
from jose import JWTError, jwt
token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

# AFTER (PyJWT):
import jwt
from jwt.exceptions import InvalidTokenError  # replaces JWTError
token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```

**Why critical:** python-jose has not been released in 3+ years, has known security vulnerabilities in dependencies, and FastAPI officially moved its documentation to PyJWT. JWT is the auth layer -- it must be actively maintained.

**Source:** [FastAPI JWT tutorial](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), [FastAPI discussion #11345](https://github.com/fastapi/fastapi/discussions/11345), [PyPI PyJWT](https://pypi.org/project/PyJWT/) -- version 2.11.0 confirmed 2026-01-30

### 4. Health Check Implementation

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| (built-in FastAPI) | -- | Real health check endpoint | Current /health returns fake "checking..." string. Docker healthcheck depends on this. Must actually check PostgreSQL + Redis connectivity. | HIGH |

**Action:** Replace fake health check with real one:

```python
@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    checks = {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

    # Database check
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "connected"
    except Exception:
        checks["database"] = "disconnected"
        checks["status"] = "unhealthy"

    # Redis check
    try:
        await cache_manager.ping()
        checks["redis"] = "connected"
    except Exception:
        checks["redis"] = "disconnected"
        checks["status"] = "unhealthy"

    status_code = 200 if checks["status"] == "healthy" else 503
    return JSONResponse(content=checks, status_code=status_code)
```

**Why important:** Docker Compose healthcheck calls `curl -f http://localhost:8000/health`. If this always returns 200, Docker never restarts unhealthy containers. The monitoring stack (Prometheus alerts) also depends on this endpoint reflecting reality.

### 5. Database Backup

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| pg_dump (via cron container) | PostgreSQL 15 built-in | Daily database backup | Current backup only covers uploaded files (storage volume). No database backup exists. Data loss on PostgreSQL failure is total. | HIGH |

**Action:** Add database backup service to docker-compose.lite.yml:

```yaml
db-backup:
  image: postgres:15-alpine
  container_name: bookreader_db_backup
  environment:
    - PGPASSWORD=${DB_PASSWORD}
    - TZ=Europe/Moscow
  volumes:
    - /root/backups/db:/backups
  entrypoint: /bin/sh
  command: |
    -c "
      while true; do
        BACKUP_FILE=/backups/db-$$(date +%Y%m%d-%H%M%S).sql.gz
        pg_dump -h postgres -U $${DB_USER:-postgres} $${DB_NAME:-bookreader_dev} | gzip > $$BACKUP_FILE
        echo \"[$$(/bin/date)] DB backup: $$(du -h $$BACKUP_FILE | cut -f1)\"
        find /backups -name 'db-*.sql.gz' -mtime +14 -delete
        sleep 86400
      done
    "
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - bookreader_network
  deploy:
    resources:
      limits:
        cpus: '0.2'
        memory: 256M
  restart: unless-stopped
```

**Retention:** 14 days for database backups (vs 7 for storage). Database is harder to recreate.

### 6. Gunicorn for Production

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| gunicorn | 25.0.1 | Production ASGI server | Already in requirements.txt but NOT used in docker-compose. Production runs bare uvicorn with `--reload` flag (development mode). Gunicorn provides process management, worker recycling, graceful restarts. | HIGH |

**Action:** Change docker-compose.lite.yml backend command:

```yaml
# BEFORE (development mode in production!):
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# AFTER (production mode):
command: >
  gunicorn app.main:app
  --worker-class uvicorn.workers.UvicornWorker
  --workers ${WORKERS_COUNT:-4}
  --bind 0.0.0.0:8000
  --timeout ${WORKER_TIMEOUT:-300}
  --max-requests ${WORKER_MAX_REQUESTS:-1000}
  --max-requests-jitter ${WORKER_MAX_REQUESTS_JITTER:-100}
  --graceful-timeout 30
  --access-logfile -
```

**Why critical:** `--reload` in production means the server watches all files for changes and restarts on any filesystem event. This wastes CPU, causes random restarts if backup files change, and provides zero production benefit. Gunicorn adds fault isolation (worker crashes don't kill the server), memory leak protection (max-requests), and multi-core utilization.

**Source:** [FastAPI Server Workers docs](https://fastapi.tiangolo.com/deployment/server-workers/)

### 7. Celery Monitoring (Flower)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| flower | 2.0.1 | Celery task monitoring UI + Prometheus metrics | Book processing tasks run for minutes-hours. Without Flower, diagnosing stuck/failed tasks requires log diving. Flower exposes Prometheus metrics for alerting on queue depth and failure rates. | MEDIUM |

**Action:** Add to docker-compose.monitoring.yml:

```yaml
flower:
  build:
    context: ./backend
    dockerfile: Dockerfile.lite
  container_name: bookreader_flower
  environment:
    - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
    - FLOWER_BASIC_AUTH=${FLOWER_USER:-admin}:${FLOWER_PASSWORD:?FLOWER_PASSWORD required}
  command: celery -A app.core.celery_app flower --port=5555 --broker_api=redis://:${REDIS_PASSWORD}@redis:6379/0 --prometheus_metrics
  networks:
    - bookreader_network
  deploy:
    resources:
      limits:
        cpus: '0.3'
        memory: 256M
  restart: unless-stopped
```

**Why MEDIUM confidence:** Flower 2.0.1 was released Aug 2023 and hasn't seen recent updates. It works, but the project's maintenance pace is slow. Still the standard tool for Celery monitoring.

**Source:** [Flower docs](https://flower.readthedocs.io/en/latest/prometheus-integration.html), [PyPI flower](https://pypi.org/project/flower/) -- version 2.0.1 confirmed

---

## Existing Stack: Keep As-Is

These are already correctly configured and need no changes:

| Technology | Current Version | Purpose | Assessment |
|------------|----------------|---------|------------|
| loguru | 0.7.3 | Structured logging | Correctly configured: JSON in production, colorized in dev. No changes needed. |
| prometheus-fastapi-instrumentator | 7.1.0 | HTTP metrics | Latest version. Already collecting request count, latency, response sizes. |
| prometheus-client | 0.24.1 | Custom metrics | Standard Prometheus client. |
| SecurityHeadersMiddleware | custom | Security headers | HSTS, CSP, X-Frame-Options, X-Content-Type-Options all present. Only gap: CSP nonces (TODO). |
| Rate limiter | custom Redis-based | API abuse prevention | Sliding window, per-user + per-IP, graceful degradation. Well-implemented. |
| SecretsValidator | custom | Startup secrets check | Validates SECRET_KEY, DATABASE_URL, REDIS_URL in production. |
| Docker Compose healthchecks | -- | Service health | All services have healthchecks with proper intervals, retries, start_period. |
| Grafana + Prometheus + Loki | -- | Monitoring stack | Full observability stack already defined. |

---

## Existing Stack: Upgrade Required

| Technology | Current | Target | Why Upgrade |
|------------|---------|--------|-------------|
| sentry-sdk[fastapi] | 2.51.0 | 2.53.0 | Bug fixes, latest integrations. Minor version bump. |
| python-jose | 3.5.0 | REMOVE | Replace with PyJWT 2.11.0 (see section 3). |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| python-jose | Abandoned 3+ years, known vulnerabilities, FastAPI dropped official support | PyJWT 2.11.0 |
| slowapi | Last release Feb 2024 (v0.1.9), still 0.x, limited maintenance | Keep existing custom Redis rate limiter (already better: distributed, sliding window, graceful degradation) |
| uvicorn --reload in production | File watching wastes CPU, causes random restarts | gunicorn with UvicornWorker |
| Datadog / New Relic | Expensive SaaS for a single-server pet project | Self-hosted Sentry + Prometheus/Grafana (already set up) |
| structlog | Adds complexity over loguru with no benefit for this project | loguru (already configured with JSON + dev modes) |
| celery-exporter | Separate container for Celery metrics | Flower with --prometheus_metrics (also gives UI) |
| passlib | Soft-deprecated, slow development | Keep for now (no urgent security issue, and bcrypt backend is stable). Consider argon2-cffi long-term. |

---

## Configuration Hardening (No New Libraries)

These changes require no new dependencies, just configuration fixes:

### Security Defaults

| Setting | Current | Recommended | Why |
|---------|---------|-------------|-----|
| `DEBUG` default | `True` | `False` | If env var is unset, production runs in debug mode. Flip default so missing config = safe. |
| `SECRET_KEY` default | `"dev-secret-key..."` | Generate random on startup | If env var is missing, startup should fail or generate random key, not use forgeable default. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 10080 (7 days) | 1440 (1 day) | 7-day access tokens are too long. Use 1-day access + 30-day refresh. Reading app UX preserved via refresh token. |
| `METRICS_PASSWORD` default | `"metrics_secure_password"` | Add to production validator | Currently not validated. Anyone with this default can scrape all Prometheus metrics. |
| `PASSWORD_RESET_BASE_URL` | `"http://localhost:5173/..."` | `""` (require env override) | Production emails send localhost links. Empty default forces explicit configuration. |

### CORS Hardening

| Setting | Current | Recommended |
|---------|---------|-------------|
| `CORS_ORIGINS` default | `"http://localhost:3000,http://localhost:5173,http://localhost:5174"` | Keep only localhost:5173 for dev; require env override in production |

### CSP Nonces (TODO in current code)

The CSP currently lacks nonce-based script-src. Since Vite produces external JS files (no inline scripts), the current `script-src 'self'` is actually correct and sufficient. Document this decision rather than implementing nonces.

---

## Installation Summary

### Backend (requirements.txt changes)

```diff
# SECURITY: Replace abandoned JWT library
- python-jose[cryptography]==3.5.0
+ PyJWT[crypto]==2.11.0

# MONITORING: Upgrade Sentry
- sentry-sdk[fastapi]==2.51.0
+ sentry-sdk[fastapi]==2.53.0

# MONITORING: Add Flower (optional, in requirements.monitoring.txt)
+ flower==2.0.1
```

### Frontend (npm changes)

```bash
# Error monitoring
npm install @sentry/react

# Dev dependencies (source map upload)
npm install -D @sentry/vite-plugin
```

### Environment Variables to Add

```bash
# Sentry (backend + frontend)
SENTRY_DSN=https://xxx@sentry.io/xxx          # Backend
VITE_SENTRY_DSN=https://xxx@sentry.io/xxx      # Frontend (different project)
SENTRY_AUTH_TOKEN=sntrys_xxx                    # CI/CD source map upload

# Flower (monitoring stack)
FLOWER_USER=admin
FLOWER_PASSWORD=<strong-password>
```

---

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| PyJWT 2.11.0 | Python >= 3.9, FastAPI 0.128.0 | Requires `PyJWT[crypto]` for RS256 (currently using HS256, so base PyJWT works, but crypto extra is safer) |
| sentry-sdk 2.53.0 | FastAPI >= 0.79.0, Python >= 3.7 | Auto-detects FastAPI, Celery, SQLAlchemy, Redis integrations |
| @sentry/react 10.40.0 | React >= 17, Vite 7.x | React 19 onCaughtError/onUncaughtError hooks supported |
| @sentry/vite-plugin 5.1.0 | Vite >= 4.x | Source map upload during `vite build` |
| flower 2.0.1 | Celery >= 5.0 | Prometheus metrics via `--prometheus_metrics` flag |

---

## Priority Order for Implementation

Based on severity and dependencies:

1. **Replace python-jose with PyJWT** -- CRITICAL SECURITY, zero-dependency on other changes
2. **Fix DEBUG default to False** -- CRITICAL SECURITY, one-line change
3. **Initialize Sentry (backend)** -- HIGH VALUE, library already installed
4. **Switch to Gunicorn in production** -- HIGH VALUE, library already installed
5. **Implement real /health endpoint** -- HIGH VALUE, no new deps
6. **Add database backup** -- HIGH VALUE, no new deps
7. **Add Sentry to frontend** -- MEDIUM VALUE, new npm deps
8. **Fix security defaults** (token expiry, metrics password, password reset URL) -- MEDIUM VALUE
9. **Add Flower to monitoring stack** -- LOW VALUE, nice-to-have

---

## Sources

- [Sentry FastAPI docs](https://docs.sentry.io/platforms/python/integrations/fastapi/) -- integration patterns, sample rates (HIGH confidence)
- [Sentry React docs](https://docs.sentry.io/platforms/javascript/guides/react/) -- React 19 hooks, initialization (HIGH confidence)
- [PyPI sentry-sdk 2.53.0](https://pypi.org/project/sentry-sdk/) -- version confirmed 2026-02-16 (HIGH confidence)
- [npm @sentry/react 10.40.0](https://www.npmjs.com/package/@sentry/react) -- version confirmed (HIGH confidence)
- [npm @sentry/vite-plugin 5.1.0](https://www.npmjs.com/package/@sentry/vite-plugin) -- version confirmed (HIGH confidence)
- [FastAPI JWT tutorial (PyJWT)](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) -- official FastAPI docs now use PyJWT (HIGH confidence)
- [FastAPI discussion #11345](https://github.com/fastapi/fastapi/discussions/11345) -- python-jose deprecation (HIGH confidence)
- [PyPI PyJWT 2.11.0](https://pypi.org/project/PyJWT/) -- version confirmed 2026-01-30 (HIGH confidence)
- [FastAPI Server Workers docs](https://fastapi.tiangolo.com/deployment/server-workers/) -- Gunicorn + Uvicorn pattern (HIGH confidence)
- [PyPI flower 2.0.1](https://pypi.org/project/flower/) -- version confirmed, last release Aug 2023 (MEDIUM confidence on maintenance)
- [Flower Prometheus integration](https://flower.readthedocs.io/en/latest/prometheus-integration.html) -- metrics configuration (HIGH confidence)
- [PyPI slowapi 0.1.9](https://pypi.org/project/slowapi/) -- last release Feb 2024, not recommended (HIGH confidence)
- [Sentry Vite source maps docs](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/) -- build integration (HIGH confidence)

---
*Stack research for: fancai production readiness*
*Researched: 2026-02-27*
