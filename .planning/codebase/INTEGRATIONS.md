# External Integrations

**Analysis Date:** 2026-02-27

## APIs & External Services

**AI / Machine Learning:**
- Google Gemini 3.0 Flash (`gemini-3-flash-preview` / `gemini-2.0-flash`) - Chapter analysis, entity extraction, description extraction, and Russian-to-English prompt translation
  - SDK/Client: `google-genai` 1.61.0 (`backend/requirements.txt`)
  - Integration: `backend/app/services/gemini_extractor.py`
  - Auth: `GOOGLE_API_KEY` or `LANGEXTRACT_API_KEY` env var
  - Called via: `analyze_chapter()` — extracts both descriptions AND entities in one call
  - Retry: tenacity with exponential backoff (`backend/app/core/retry.py`)

- Google Imagen 4 (`imagen-4.0-generate-001`) - AI illustration generation from book descriptions
  - SDK/Client: `google-genai` 1.61.0 (same SDK as Gemini)
  - Integration: `backend/app/services/imagen_generator.py`, `backend/app/services/image_generator.py`
  - Auth: `GOOGLE_API_KEY` env var (same key as Gemini)
  - Config: `IMAGEN_ENABLED`, `IMAGEN_MODEL`, `IMAGEN_ASPECT_RATIO`, `IMAGEN_SAFETY_LEVEL`, `IMAGEN_TIMEOUT_SECONDS`
  - Models available: `imagen-4.0-generate-001`, `imagen-4.0-fast-generate-001`, `imagen-4.0-ultra-generate-001`

**Legacy / Optional AI (configured but not primary):**
- OpenAI - Optional; key configured in `OPENAI_API_KEY`, not actively used in core pipeline
- Midjourney - Optional; key configured in `MIDJOURNEY_API_KEY`, not actively used

## Data Storage

**Databases:**
- PostgreSQL 15 (Docker: `postgres:15-alpine`)
  - Connection: `DATABASE_URL` env var (`postgresql+asyncpg://...`)
  - Client: SQLAlchemy 2.0 async engine with asyncpg driver
  - ORM: SQLAlchemy 2.0 with `lazy="raise"` on all relationships (explicit eager loading required)
  - Migrations: Alembic (`backend/alembic/`)
  - Config: `backend/alembic.ini`, `backend/app/core/database.py`
  - Connection pool: configurable via `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_RECYCLE`, `DB_POOL_TIMEOUT`

**Queue / Cache:**
- Redis 7.4 (Docker: `redis:7.4-alpine`)
  - Connection: `REDIS_URL` env var (`redis://:password@host:6379`)
  - Client: `redis.asyncio` (async Redis client)
  - Uses: Celery broker + backend, API response cache, rate limiting, distributed locks, token blacklist
  - Config: 640MB maxmemory, `allkeys-lru` eviction policy, AOF persistence enabled
  - Integration: `backend/app/core/cache.py` (`CacheManager`, `DistributedLock`)

**File Storage:**
- Local filesystem (Docker volume: `uploaded_books`)
  - Path: `backend/storage/` and `backend/uploads/`
  - Stores: EPUB/FB2 uploads, generated images
  - Backup: Daily via Alpine container to `/root/backups/` (7-day retention)

**Frontend Offline Storage:**
- IndexedDB via Dexie.js 4.2.1 - Caches chapters, book metadata, pending sync queue
  - Integration: `frontend/src/services/db.ts` (centralized Dexie database)
  - Chapter cache: `frontend/src/services/chapterCache.ts`
  - Image cache: `frontend/src/services/imageCache.ts`
  - Sync queue: `frontend/src/services/syncQueue.ts` (offline-first operation queue)

## Authentication & Identity

**Auth Provider:**
- Custom (no third-party OAuth provider)
  - Implementation: JWT (HS256) with HttpOnly cookies
  - Token types: Access token (7 days) + Refresh token (30 days)
  - Library: `python-jose[cryptography]` 3.5.0 (token generation/validation)
  - Password hashing: `passlib[bcrypt]` 1.7.4
  - Backend: `backend/app/services/auth_service.py`, `backend/app/core/auth.py`
  - Token blacklist: Redis-backed blacklist for logout (`backend/app/services/token_blacklist.py`)
  - Frontend: `frontend/src/api/client.ts` (automatic token refresh via axios interceptor), `frontend/src/stores/auth.ts`

## Monitoring & Observability

**Error Tracking:**
- Sentry - `sentry-sdk[fastapi]` 2.51.0
  - Integration: FastAPI integration (auto-captures exceptions)
  - Configuration: `SENTRY_DSN` env var (not explicitly listed in `config.py` but SDK is installed)

**Metrics:**
- Prometheus - `prometheus-client` 0.24.1 + `prometheus-fastapi-instrumentator` 7.1.0
  - Metrics endpoint: `/api/v1/health/metrics` (Basic Auth protected via `METRICS_USER`/`METRICS_PASSWORD`)
  - Custom metrics: reading sessions, LLM requests, image generation, cache hits in `backend/app/monitoring/metrics.py`
  - Collected by: Prometheus Docker container (`monitoring/prometheus/`)

**Logs:**
- Loguru 0.7.3 - Structured logging in backend (`backend/app/core/logging.py`)
- Loki + Promtail - Log aggregation (`docker-compose.monitoring.yml`)
- Grafana 11.3.0 - Metrics and log visualization (`monitoring/grafana/`)
- Node Exporter + cAdvisor - System and container metrics

## Push Notifications

**Web Push (VAPID):**
- pywebpush 2.2.0 - VAPID-signed Web Push notifications to browsers
  - Integration: `backend/app/services/push_notification_service.py`
  - Auth: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env vars
  - Frontend: `frontend/src/services/pushNotifications.ts`, `frontend/src/hooks/usePushNotifications.ts`
  - Router: `backend/app/routers/push.py` (at `/api/v1/push`)

## Email

**Yandex Cloud Postbox (SES v2 compatible):**
- Uses AWS SES v2 API protocol via `aioboto3` 13.0.0
  - Provider: `backend/app/services/email/yandex_postbox.py`
  - Endpoint: `https://postbox.cloud.yandex.net` (configurable via `YANDEX_POSTBOX_ENDPOINT`)
  - Auth: `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY` env vars
  - Sender: `noreply@fancai.ru`
  - Use cases: Password reset emails
  - Toggle: `EMAIL_ENABLED` env var (default: `false` in dev, `true` in production)

## Payments (Configured, Not Active)

**YooKassa:**
- Config: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` env vars in `backend/app/core/config.py`
- Status: Configured but no active integration code found

**CloudPayments:**
- Config: `CLOUDPAYMENTS_PUBLIC_ID` env var in `backend/app/core/config.py`
- Status: Configured but no active integration code found

## Proxy / Network

**VLESS Proxy:**
- Custom VLESS-aware HTTP client: `backend/app/services/vless_http_client.py`
- Purpose: Routes requests for specific domains (e.g., `pollinations.ai`) through a proxy
- Config: `HTTP_PROXY_URL`, `SOCKS5_PROXY_URL` env vars (implied by implementation)

## CI/CD & Deployment

**Hosting:**
- Self-hosted VPS at `fancai.ru` (server in Russia, 8GB RAM / 4 CPU)
- Docker Compose (`docker-compose.lite.yml`) - primary production deployment

**CI Pipeline:**
- Not detected (no GitHub Actions workflows or CI config found)

**Deployment Method:**
- SSH to server, `docker compose` commands
- Deploy skill: `/deploy` (documented in CLAUDE.md)

## PWA / Service Worker

**Workbox:**
- Workbox 7.4.0 libraries - Service Worker caching strategies
  - Strategy: `injectManifest` (custom SW at `frontend/src/sw.ts`)
  - Background Sync API: offline queue auto-retry for progress updates, reading sessions, image generation
  - iOS Safari fallback: periodic sync timer (30s) + `sendBeacon` for critical data

## WebSocket

**Real-time Updates:**
- Backend WebSocket router: `backend/app/routers/websocket.py`
- Frontend WebSocket service: `frontend/src/services/websocket.tsx`
- Status: DISABLED on frontend (cookie auth not implemented for WS; marked `@deprecated`)
- Events defined: `book_processing_*`, `image_generation_*`, `entities_updated`, `user_notification`

## Environment Configuration

**Required env vars (production):**
- `DB_PASSWORD` - PostgreSQL password
- `REDIS_PASSWORD` - Redis password
- `SECRET_KEY` - JWT signing key (must not be default value)
- `GOOGLE_API_KEY` or `LANGEXTRACT_API_KEY` - Google AI services
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` - Web Push
- `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY` - Email (if EMAIL_ENABLED=true)

**Secrets location:**
- `.env` file at project root (loaded by pydantic-settings in backend)
- Build-time frontend vars passed as Docker build args (VITE_ prefix)

---

*Integration audit: 2026-02-27*
