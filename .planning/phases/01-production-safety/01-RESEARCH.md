# Phase 1: Production Safety - Research

**Researched:** 2026-02-27
**Domain:** Security hardening, monitoring infrastructure, production deployment, database backups
**Confidence:** HIGH

## Summary

Phase 1 addresses the foundational production safety requirements for fancai. The codebase already has substantial infrastructure in place: `config.py` has a `validate_production_settings` model validator that checks SECRET_KEY and DEBUG, `secrets.py` has a comprehensive startup validation system, the health check router (`/api/v1/health/deep`) already performs real connectivity checks for PostgreSQL, Redis, and Celery. However, several critical gaps remain: (1) the root-level `/health` endpoint at `main.py:313` is a stub with hardcoded `"database": "checking..."`, (2) JWT tokens use the unmaintained `python-jose` library with known CVEs, (3) `sentry-sdk[fastapi]==2.51.0` is installed but never initialized via `sentry_sdk.init()`, (4) the backend runs via raw `uvicorn --reload` in the docker-compose.lite.yml command, and (5) the backup container only backs up uploaded files to local disk, not PostgreSQL to S3.

The migration from `python-jose` to `PyJWT` is nearly a drop-in replacement for this project since only HS256 symmetric signing is used. Sentry SDK is already in requirements.txt and the frontend config already has `VITE_SENTRY_DSN` and `VITE_SENTRY_ENABLED` env vars prepared. The user decided on self-hosted Sentry, which requires a 16+ GB RAM server upgrade and its own docker-compose setup.

**Primary recommendation:** Fix the six concrete gaps (JWT library swap, root health endpoint, Sentry init, gunicorn command, pg_dump backup script, env validation), all of which have existing infrastructure to build on.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Self-hosted Sentry on the same server (server upgrade from 8 GB to 16+ GB planned)
- Two separate Sentry projects: Python backend and React frontend
- 100% sample rate for errors (self-hosted, no limits)
- Errors + performance traces enabled (API latency, Celery task duration)
- Celery integration mandatory -- track AI pipeline failures (Gemini/Imagen)
- AI API call tracing: latency, error rate, timeouts for Gemini/Imagen
- Only internal health check endpoint (no external uptime monitoring)
- Logs to stdout via Docker (no structured JSON logging to files)
- No push notifications (Telegram/email) -- Sentry UI only for now
- Daily PostgreSQL backups at 03:00 MSK via cron on host
- Only PostgreSQL -- no file backups (EPUBs/images can be regenerated)
- Storage: Yandex Object Storage (S3-compatible, need to create bucket)
- Compression: pg_dump | gzip before upload
- Retention: 7 days
- Backup failures reported to Sentry as events
- No encryption -- private S3 bucket access is sufficient
- nginx reverse proxy already configured with Let's Encrypt SSL
- Gunicorn: 2 workers with UvicornWorker (conservative for RAM)
- Celery: 2 workers (parallel AI task processing)
- Server: 4 CPU cores, 8 GB RAM (upgrade to 16+ GB planned for Sentry)
- Docker memory limits per container (prevent OOM)
- restart: unless-stopped policy for all containers
- Short downtime during deploys is acceptable (no zero-downtime needed)
- Single docker-compose.lite.yml for production (no separate prod file)
- No rate limiting in this phase
- .env file on server (not in git), Docker Compose reads env_file
- SECRET_KEY already reads from environment (has default fallback -- must remove)
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Fix DEBUG default to False in config.py | `config.py:19` already has `DEBUG: bool = True`. Change default to `False`. `validate_production_settings` already checks SECRET_KEY when DEBUG=False. docker-compose.lite.yml already passes `DEBUG=${DEBUG:-false}` so production is already False. |
| SEC-02 | Fix hardcoded SECRET_KEY -- fail startup if default key used in non-debug | `config.py:22` has default `"dev-secret-key-change-in-production"`. `validate_production_settings` already raises ValueError. `secrets.py` has full SecretsValidator. Need to also fail-fast for missing DATABASE_URL. Infrastructure exists. |
| SEC-03 | Replace python-jose (CVE) with PyJWT for JWT operations | Only file using jose: `auth_service.py:10`. Uses `jwt.encode`, `jwt.decode`, `JWTError`. PyJWT API is nearly identical for HS256. Swap import + exception class. See Code Examples section. |
| DEPLOY-01 | Switch to Gunicorn in production (remove --reload from docker-compose.lite.yml) | Current command at `docker-compose.lite.yml:155`: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`. Replace with gunicorn command. Config already has WORKERS_COUNT, WORKER_TIMEOUT, WORKER_MAX_REQUESTS fields. |
| DEPLOY-02 | Initialize Sentry backend (sentry-sdk already in requirements, needs sentry_sdk.init()) | `sentry-sdk[fastapi]==2.51.0` in requirements.txt. `secrets.py` already expects `SENTRY_DSN` env var. Need `sentry_sdk.init()` in `main.py` lifespan with FastAPI, Starlette, Celery integrations. |
| DEPLOY-03 | Add frontend Sentry SDK (@sentry/react) for error tracking | `frontend/src/config/env.ts` already has `sentry.dsn` and `sentry.enabled` config. `ErrorBoundary.tsx` has TODO comment for Sentry integration. Install `@sentry/react` + `@sentry/vite-plugin`. |
| DEPLOY-04 | Add database backup strategy (pg_dump to S3) | Current backup container only backs up uploaded_books volume. Need new backup script: `pg_dump | gzip | aws s3 cp` to Yandex Object Storage. Cron on host at 03:00 MSK. Report failures to Sentry. |
| UX-01 | Implement real health check endpoint (actual DB + Redis + Celery connectivity) | Two health endpoints exist: `/health` (main.py, stub with "checking...") and `/api/v1/health` (health.py router, real checks). Fix: make `/health` delegate to the real checks or replace the stub. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PyJWT | 2.10.x | JWT token encode/decode (HS256) | Drop-in replacement for unmaintained python-jose; actively maintained, no CVEs |
| sentry-sdk[fastapi] | 2.51.0 | Backend error tracking + performance | Already in requirements.txt, official SDK with FastAPI/Celery integrations |
| @sentry/react | 9.x | Frontend error tracking | Official React SDK with React 19 error hooks support |
| @sentry/vite-plugin | 3.x | Source map upload for Sentry | Automatically uploads sourcemaps during `npm run build` |
| gunicorn | 25.0.1 | WSGI/ASGI process manager | Already in requirements.txt, production standard for Python web apps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| aws-cli | 2.x (via pip or apk) | S3-compatible upload for backups | In backup cron script, talks to Yandex Object Storage |
| self-hosted Sentry | 24.x | Error monitoring platform | Docker compose on same server, requires 16 GB RAM |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PyJWT | joserfc (authlib) | joserfc is fuller-featured (JWE, JWK), but overkill -- project only uses HS256 JWT signing |
| Self-hosted Sentry | Sentry SaaS | Free tier has quotas; self-hosted has no limits but needs server RAM |
| aws-cli for S3 | boto3 in Python | boto3 requires Python script; aws-cli is simpler for cron one-liner |

**Installation:**
```bash
# Backend
pip install PyJWT==2.10.1
pip uninstall python-jose

# Frontend
cd frontend && npm install @sentry/react @sentry/vite-plugin --save
```

## Architecture Patterns

### Recommended Project Structure
No new directories needed. Changes touch existing files:
```
backend/
├── app/
│   ├── core/
│   │   ├── config.py           # SEC-01, SEC-02: DEBUG default, env validation
│   │   ├── secrets.py          # SEC-02: startup_secrets_check already exists
│   │   └── sentry.py           # NEW: sentry_sdk.init() configuration
│   ├── services/
│   │   └── auth_service.py     # SEC-03: python-jose -> PyJWT swap
│   └── main.py                 # UX-01: fix /health stub; DEPLOY-02: import sentry init
├── gunicorn.conf.py            # NEW: gunicorn configuration file
├── requirements.txt            # Update: PyJWT replaces python-jose
├── requirements.lite.txt       # Update: PyJWT replaces python-jose
scripts/
└── backup-postgres.sh          # NEW: pg_dump + gzip + S3 upload script
docker-compose.lite.yml         # DEPLOY-01: gunicorn command; DEPLOY-04: backup container update
.env.example                    # NEW: template with placeholder values
frontend/
├── src/
│   ├── config/
│   │   └── sentry.ts           # NEW: Sentry.init() configuration
│   ├── main.tsx                # DEPLOY-03: import sentry init, configure createRoot error hooks
│   └── components/
│       └── ErrorBoundary.tsx   # DEPLOY-03: integrate Sentry.ErrorBoundary
├── vite.config.ts              # DEPLOY-03: add sentryVitePlugin
└── package.json                # @sentry/react, @sentry/vite-plugin
```

### Pattern 1: Sentry SDK Initialization (Backend)
**What:** Initialize sentry-sdk early in application lifecycle with FastAPI, Starlette, and Celery integrations
**When to use:** In `main.py` lifespan, before other startup logic
**Example:**
```python
# Source: Context7 /getsentry/sentry-python
# backend/app/core/sentry.py
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.celery import CeleryIntegration
from .config import settings

def init_sentry() -> None:
    """Initialize Sentry SDK if DSN is configured."""
    dsn = getattr(settings, "SENTRY_DSN", None) or ""
    if not dsn:
        return

    sentry_sdk.init(
        dsn=dsn,
        environment="production" if not settings.DEBUG else "development",
        release=f"fancai@{settings.APP_VERSION}",
        traces_sample_rate=1.0,  # 100% -- self-hosted, no limits
        send_default_pii=False,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
            CeleryIntegration(monitor_beat_tasks=True),
        ],
        attach_stacktrace=True,
    )
```

### Pattern 2: PyJWT Migration (Drop-in Replacement)
**What:** Replace `from jose import JWTError, jwt` with `import jwt` and `jwt.exceptions.PyJWTError`
**When to use:** In auth_service.py
**Example:**
```python
# Source: Context7 /jpadilla/pyjwt + migration guide
# BEFORE (python-jose):
from jose import JWTError, jwt

# AFTER (PyJWT):
import jwt
from jwt.exceptions import PyJWTError

# encode -- identical API for HS256:
token = jwt.encode(payload, secret_key, algorithm="HS256")

# decode -- identical API:
payload = jwt.decode(token, secret_key, algorithms=["HS256"])

# exception -- rename:
except PyJWTError:  # was: except JWTError:
    return None
```

### Pattern 3: Frontend Sentry with React 19 Error Hooks
**What:** Configure createRoot with Sentry error hooks + Sentry.ErrorBoundary
**When to use:** In main.tsx and ErrorBoundary.tsx
**Example:**
```typescript
// Source: https://docs.sentry.io/platforms/javascript/guides/react/
// frontend/src/config/sentry.ts
import * as Sentry from "@sentry/react";
import { config } from "./env";

export function initSentry(): void {
  if (!config.sentry.enabled || !config.sentry.dsn) return;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.app.environment,
    release: `fancai@${config.app.version}`,
    sampleRate: 1.0,
    tracesSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

// main.tsx -- React 19 error hooks:
import * as Sentry from "@sentry/react";
const root = createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});
```

### Pattern 4: Gunicorn Configuration
**What:** gunicorn.conf.py for production with UvicornWorker
**When to use:** Production deployment via docker-compose.lite.yml
**Example:**
```python
# backend/gunicorn.conf.py
import os

bind = "0.0.0.0:8000"
workers = int(os.getenv("WORKERS_COUNT", "2"))
worker_class = "uvicorn.workers.UvicornWorker"
timeout = int(os.getenv("WORKER_TIMEOUT", "300"))
keepalive = 5
max_requests = int(os.getenv("WORKER_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("WORKER_MAX_REQUESTS_JITTER", "100"))
accesslog = "-"  # stdout
errorlog = "-"   # stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
```

### Anti-Patterns to Avoid
- **Running uvicorn --reload in production:** Reload watches filesystem, wastes CPU, can crash on file changes during deploy. Use gunicorn with UvicornWorker instead.
- **Hardcoded health check responses:** The `/health` endpoint at `main.py:313` returns `"database": "checking..."` -- this hides real failures from Docker healthcheck and monitoring.
- **Using python-jose in 2026:** Last release 2021, has transitive CVEs via `ecdsa` and `rsa` packages. PyJWT is actively maintained.
- **Initializing Sentry in module scope:** Must be inside lifespan/startup so environment variables are loaded first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT token signing | Custom HMAC token signing | PyJWT | Handles exp/iat claims, algorithm enforcement, timing-safe comparison |
| Error monitoring | Custom error logging/email | Sentry SDK | Stack traces, source maps, context, deduplication, alerting -- all built in |
| Process management | Custom worker spawning | Gunicorn | Handles worker lifecycle, graceful restarts, pre-fork model |
| S3 uploads | Custom HTTP requests to S3 | aws-cli (s3 cp) | Handles auth signing, multipart, retries |
| Source map upload | Manual upload scripts | @sentry/vite-plugin | Automatic release association, cleanup, upload during build |

**Key insight:** Every component in this phase has a well-tested, standard solution. The risk is in misconfiguration, not in missing tools.

## Common Pitfalls

### Pitfall 1: PyJWT Returns String, python-jose Returns String (No Change)
**What goes wrong:** Some migration guides warn about PyJWT returning bytes in older versions
**Why it happens:** PyJWT < 2.0 returned bytes from `jwt.encode()`. PyJWT >= 2.0 returns string.
**How to avoid:** Current PyJWT 2.10.x returns strings. No bytes handling needed.
**Warning signs:** If you see `.decode('utf-8')` on jwt.encode result, it's unnecessary.

### Pitfall 2: Duplicate /health Endpoints
**What goes wrong:** Two `/health` endpoints exist -- one in `main.py` (stub) and one in `health.py` router (real checks). Docker healthcheck hits the stub.
**Why it happens:** The stub was created first, then the detailed router was added under `/api/v1/health` but the old one was never updated.
**How to avoid:** Either (a) replace the stub in `main.py` with a redirect/call to the real health checks, or (b) update Docker healthcheck URL to `/api/v1/health`. Option (b) is simpler and preserves the API structure. But the stub at `/health` is also used by the Docker HEALTHCHECK in `Dockerfile.lite:67` and `docker-compose.lite.yml:141`.
**Warning signs:** Health check always shows "healthy" even when database is down.

### Pitfall 3: Sentry Init Before Settings Load
**What goes wrong:** `sentry_sdk.init()` called before environment variables are available, resulting in empty DSN
**Why it happens:** If init is in module scope, it runs at import time before `.env` is read
**How to avoid:** Call `init_sentry()` inside the `lifespan()` function in `main.py`, after settings are loaded. For Celery, init in celery_app.py module scope is acceptable since Celery loads env before worker starts.
**Warning signs:** Sentry dashboard shows no events despite errors in logs.

### Pitfall 4: Self-Hosted Sentry RAM Requirements
**What goes wrong:** Sentry containers OOM-kill on 8 GB server
**Why it happens:** Self-hosted Sentry runs ~20 Docker containers (Kafka, ClickHouse, PostgreSQL, Redis, Snuba, etc.) requiring 16+ GB RAM
**How to avoid:** Server upgrade to 16+ GB is a prerequisite. Consider 16 GB RAM + 16 GB swap on fast SSD.
**Warning signs:** Containers restarting in loop, `docker stats` showing high memory usage.

### Pitfall 5: Gunicorn Timeout for Long AI Requests
**What goes wrong:** Gunicorn kills workers processing long Gemini/Imagen API calls
**Why it happens:** Default Gunicorn timeout is 30 seconds, but AI API calls can take 60+ seconds
**How to avoid:** Config already has `WORKER_TIMEOUT: int = 300` (5 minutes). Use this value in gunicorn.conf.py. Note: Celery handles the truly long tasks (book processing = 3 hours), so 300s is sufficient for synchronous API endpoints.
**Warning signs:** 502 Bad Gateway errors on AI-related endpoints.

### Pitfall 6: Backup Script S3 Authentication
**What goes wrong:** aws-cli fails to authenticate with Yandex Object Storage
**Why it happens:** Yandex Object Storage uses S3-compatible API but needs custom endpoint URL
**How to avoid:** Set `AWS_ENDPOINT_URL=https://storage.yandexcloud.net` and configure credentials via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Use `aws s3 cp --endpoint-url=...` in the backup script.
**Warning signs:** "Access Denied" or "InvalidAccessKeyId" errors in backup logs.

## Code Examples

Verified patterns from official sources:

### PyJWT Migration (auth_service.py)
```python
# Source: Context7 /jpadilla/pyjwt, GitHub issue #942
# CURRENT (python-jose):
from jose import JWTError, jwt

# REPLACEMENT (PyJWT):
import jwt
from jwt.exceptions import PyJWTError

# In AuthService.__init__:
# No changes needed -- self.algorithm = "HS256", self.secret_key = settings.SECRET_KEY

# In create_access_token / create_refresh_token:
# jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
# Identical API -- no change needed

# In verify_token:
# payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
# Identical API -- no change needed
# PyJWT already rejects alg=none when algorithms=["HS256"] is specified

# Exception handling:
# except JWTError:  -->  except PyJWTError:
```

### Gunicorn Docker Command
```yaml
# Source: FastAPI docs, Gunicorn docs
# docker-compose.lite.yml backend service command:
command: gunicorn app.main:app --config gunicorn.conf.py
```

### PostgreSQL Backup Script
```bash
#!/bin/bash
# scripts/backup-postgres.sh
# Source: pg_dump docs, aws-cli docs
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/fancai-backup-${TIMESTAMP}.sql.gz"
S3_BUCKET="${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
S3_ENDPOINT="${AWS_ENDPOINT_URL:-https://storage.yandexcloud.net}"

# Dump and compress
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST:-postgres}" \
  -U "${DB_USER:-postgres}" \
  -d "${DB_NAME:-bookreader_dev}" \
  --no-owner --no-acl \
  | gzip > "${BACKUP_FILE}"

# Upload to S3-compatible storage
aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/backups/${TIMESTAMP}.sql.gz" \
  --endpoint-url "${S3_ENDPOINT}"

# Cleanup local file
rm -f "${BACKUP_FILE}"

# Delete backups older than 7 days from S3
aws s3 ls "s3://${S3_BUCKET}/backups/" --endpoint-url "${S3_ENDPOINT}" \
  | awk '{print $4}' \
  | while read -r file; do
    file_date=$(echo "$file" | grep -oP '\d{8}')
    if [ -n "$file_date" ]; then
      file_epoch=$(date -d "$file_date" +%s 2>/dev/null || echo 0)
      cutoff_epoch=$(date -d "7 days ago" +%s)
      if [ "$file_epoch" -lt "$cutoff_epoch" ]; then
        aws s3 rm "s3://${S3_BUCKET}/backups/$file" --endpoint-url "${S3_ENDPOINT}"
      fi
    fi
  done

echo "[$(date)] Backup complete: ${TIMESTAMP}.sql.gz"
```

### Sentry Init for Celery Workers
```python
# Source: Context7 /getsentry/sentry-python
# In celery_app.py or a celery signal handler:
import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration

sentry_dsn = os.getenv("SENTRY_DSN", "")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        integrations=[CeleryIntegration(monitor_beat_tasks=True)],
        traces_sample_rate=1.0,
        environment=os.getenv("ENVIRONMENT", "production"),
    )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| python-jose for JWT | PyJWT 2.x | python-jose abandoned 2021 | PyJWT is actively maintained, no CVEs |
| uvicorn --reload in production | Gunicorn + UvicornWorker | Always best practice | Multi-process, graceful restarts, no file watching |
| Console.error for frontend errors | @sentry/react with React 19 hooks | React 19 (2024) | `onUncaughtError`, `onCaughtError`, `onRecoverableError` hooks |
| Local file backups | S3-compatible object storage | Industry standard | Off-site, durable, retention policies |

**Deprecated/outdated:**
- python-jose: No releases since 2021, depends on vulnerable packages. FastAPI community recommends PyJWT.
- `@app.on_event("startup")`: Already replaced with lifespan context manager in this project (good).

## Open Questions

1. **Self-hosted Sentry deployment timing**
   - What we know: Requires 16+ GB RAM, user plans server upgrade
   - What's unclear: Whether the server upgrade happens before or during this phase
   - Recommendation: Implement Sentry SDK initialization (DSN from env var) first. If DSN is empty, Sentry is silently disabled. Deploy self-hosted Sentry independently as infrastructure task. This decouples code changes from infra changes.

2. **Celery worker count configuration**
   - What we know: User decided 2 Celery workers. Current docker-compose.lite.yml has `--concurrency=4`.
   - What's unclear: Whether "2 workers" means 2 Celery processes or concurrency=2 within one process
   - Recommendation: Use `--concurrency=2` (2 concurrent tasks per single Celery worker process). This matches "conservative for RAM" decision.

3. **Memory limits for 16 GB server with Sentry**
   - What we know: Current limits total ~7 GB for 8 GB server. Sentry itself needs ~8-10 GB.
   - What's unclear: Exact distribution when running fancai + Sentry on same 16 GB server
   - Recommendation: Sentry runs its own docker-compose (separate from fancai). Fancai keeps current memory limits. Remaining ~8 GB for Sentry.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 with pytest-asyncio 1.3.0 |
| Config file | `backend/pytest.ini` |
| Quick run command | `cd backend && python -m pytest tests/test_file.py -x -v` |
| Full suite command | `cd backend && python -m pytest -v` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | DEBUG defaults to False, app starts in non-debug by default | unit | `pytest tests/test_config.py::test_debug_default_false -x` | No -- Wave 0 |
| SEC-02 | App refuses startup if default SECRET_KEY used in non-debug mode | unit | `pytest tests/test_security.py::TestSecretsManagement -x` | Partial (secrets validation exists, need startup refusal test) |
| SEC-03 | JWT tokens signed with PyJWT, alg=none tokens rejected | unit | `pytest tests/test_auth_jwt.py::test_alg_none_rejected -x` | No -- Wave 0 |
| DEPLOY-01 | docker-compose.lite.yml uses gunicorn (no --reload) | manual | `grep gunicorn docker-compose.lite.yml` | N/A (config check) |
| DEPLOY-02 | Backend errors appear in Sentry with stack traces | integration | `pytest tests/test_sentry_init.py -x` | No -- Wave 0 |
| DEPLOY-03 | Frontend JS errors appear in separate Sentry project | manual | Verify in Sentry dashboard after deploy | N/A (manual) |
| DEPLOY-04 | Database backed up on schedule, uploaded to S3 | integration | `bash scripts/backup-postgres.sh --dry-run` (if implemented) | No -- Wave 0 |
| UX-01 | Health check returns actual connectivity for PG, Redis, Celery | unit | `pytest tests/routers/test_health.py -x` | Yes (comprehensive tests exist) |

### Sampling Rate
- **Per task commit:** `cd backend && python -m pytest tests/test_file.py -x -v`
- **Per wave merge:** `cd backend && python -m pytest -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_auth_jwt.py` -- covers SEC-03: PyJWT encode/decode, alg=none rejection, expired token rejection
- [ ] `tests/test_config.py` -- covers SEC-01: DEBUG default value, production settings validation
- [ ] `tests/test_sentry_init.py` -- covers DEPLOY-02: sentry init with DSN, skip when no DSN, integration loading
- [ ] Update `requirements.txt` and `requirements.lite.txt` -- PyJWT replaces python-jose (prerequisite for all JWT tests)

*(Existing test infrastructure covers UX-01 via `tests/routers/test_health.py`. DEPLOY-01 and DEPLOY-04 are config/infra changes best verified manually.)*

## Sources

### Primary (HIGH confidence)
- Context7 `/jpadilla/pyjwt` -- JWT encode/decode API, algorithm enforcement, alg=none protection
- Context7 `/getsentry/sentry-python` -- FastAPI integration, Celery integration, performance tracing, init configuration
- Context7 `/getsentry/sentry` -- React frontend SDK, error boundary, browser integration

### Secondary (MEDIUM confidence)
- [PyJWT migration guide (GitHub issue #942)](https://github.com/jpadilla/pyjwt/issues/942) -- API differences from python-jose, exception class mapping
- [Sentry React Error Boundary docs](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/) -- React 19 createRoot error hooks setup
- [FastAPI Server Workers docs](https://fastapi.tiangolo.com/deployment/server-workers/) -- Gunicorn + UvicornWorker configuration
- [Self-hosted Sentry docs](https://develop.sentry.dev/self-hosted/) -- System requirements (16+ GB RAM), Docker Compose setup
- [Self-hosted Sentry GitHub](https://github.com/getsentry/self-hosted) -- Installation scripts, version info

### Tertiary (LOW confidence)
- [Sentry self-hosted RAM discussion (GitHub issue #3566)](https://github.com/getsentry/self-hosted/issues/3566) -- Community reports on 16 GB being tight, 32 GB recommended

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries are already in requirements.txt or are well-documented standard choices
- Architecture: HIGH -- existing codebase has infrastructure for every change (config validators, env vars, health checks)
- Pitfalls: HIGH -- verified through codebase inspection (two /health endpoints, uvicorn --reload, missing sentry init)

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain, slow-moving libraries)
