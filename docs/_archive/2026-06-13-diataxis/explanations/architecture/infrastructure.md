# BookReader AI - Infrastructure Architecture Diagram

## Production Deployment Architecture

```
                         INTERNET
                            |
                    ┌───────▼────────┐
                    │  GitHub Actions│
                    │   CI/CD Pipeline│
                    └────────┬────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
            ┌──────▼──────┐    ┌──────▼──────┐
            │  Build &    │    │  Push to    │
            │  Test       │    │  GHCR       │
            └──────┬──────┘    └──────┬──────┘
                   │                   │
                   └─────────┬─────────┘
                             │
                    ┌────────▼────────┐
                    │  SSH Deployment │
                    │  to Production  │
                    └────────┬────────┘
                             │
                ┌────────────▼────────────┐
                │                         │
        ┌───────▼────────┐      ┌────────▼────────┐
        │  STAGING ENV   │      │  PRODUCTION ENV │
        │  (Optional)    │      │  (Primary)      │
        └────────────────┘      └────────┬────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
   ┌────▼─────┐                     ┌────▼──────────┐                    │
   │  NGINX    │◄───────────────────┤ Load Balancer │                    │
   │ (SSL/TLS) │    Port 443/80      └───────────────┘                    │
   └────┬─────┘                                                           │
        │                                                                  │
   ┌────┴──────────────┬──────────────┬──────────────┬──────────────┐    │
   │                   │              │              │              │    │
   │         ┌─────────▼──┐    ┌──────▼────┐  ┌─────▼─────┐  ┌───▼──┐  │
   │         │ React App  │    │ FastAPI   │  │  Celery   │  │ Nginx│  │
   │         │ (Frontend) │    │ (Backend) │  │  Workers  │  │      │  │
   │         │ Port 3000  │    │ Port 8000 │  │           │  │ Logs │  │
   │         │            │    │           │  │ (Async)   │  │      │  │
   │         └────────────┘    │ ✅ Health │  └─────┬─────┘  └──────┘  │
   │                           │   checks  │        │                   │
   │                           └────┬──────┘        │                   │
   │                                │               │                   │
   │                        ┌────────▼───┐  ┌───────▼──────┐            │
   │                        │  Celery    │  │ Celery Beat  │            │
   │                        │  Beat      │  │ Scheduler    │            │
   │                        │ (Scheduler)│  │              │            │
   │                        └────────────┘  └──────────────┘            │
   │                                                                     │
   └─────────────────────────────┬─────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ┌─────▼──────┐          ┌──────▼────┐
              │ PostgreSQL │          │   Redis   │
              │ Database   │          │   Cache   │
              │ Port 5432  │          │ Port 6379 │
              │            │          │           │
              │ ✅ Health  │          │ ✅ Health │
              │   check    │          │   check   │
              │ DB size:   │          │ Memory:   │
              │ ~100MB-1GB │          │ 512MB max │
              │            │          │           │
              │ Features:  │          │ Features: │
              │ ✅ Backups │          │ ✅ Persist│
              │ ✅ Restore │          │ ✅ AOF    │
              │ ✅ Stats   │          │ ✅ RDB    │
              └────────────┘          └───────────┘

    ┌──────────────────────────────────────────────────────┐
    │           DOCKER NETWORKS & ISOLATION              │
    │  bookreader_network: 172.20.0.0/16                 │
    │  Services communicate via Docker DNS                │
    │  External communication via Nginx only              │
    └──────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────┐
    │           RESOURCE ALLOCATION (PRODUCTION)          │
    │                                                      │
    │  Backend:        4G limit / 1G reserved             │
    │  Celery Worker:  2G limit / 1G reserved             │
    │  Celery Beat:    512M limit                         │
    │  PostgreSQL:     1G limit / 512M reserved           │
    │  Redis:          512M limit / 256M reserved         │
    │  Nginx:          unlimited (but <100M typical)      │
    │                                                      │
    │  Total Minimum:  ~3.5GB RAM for all services        │
    │  Recommended:    8GB+ for comfortable operation     │
    └──────────────────────────────────────────────────────┘
```

---

## Development Environment Architecture

```
                    ┌─────────────────────────────┐
                    │   Docker Compose (Dev)      │
                    │   docker-compose.yml        │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   ┌────▼─────┐          ┌─────────▼────────┐        ┌───────▼──┐
   │ Vite Dev │          │  FastAPI Dev     │        │ Celery   │
   │ Server   │          │  (--reload)      │        │ Worker   │
   │ Port     │          │  Port 8000       │        │(testing) │
   │ 5173     │          │                  │        │          │
   │          │          │  ✅ Live reload  │        └──────────┘
   │ Hot      │          │  ✅ Auto-reload  │
   │ reload   │          │  ✅ Debug mode   │        ┌──────────┐
   │ enabled  │          │  ✅ Health check │        │Celery    │
   └────┬─────┘          └─────────┬────────┘        │Beat      │
        │                          │                 │(testing) │
        │                    ┌─────▼──────┐          └──────────┘
        │                    │  Hot reload│
        │                    │  NLP models│
        │                    │  Download  │
        │                    └────────────┘
        │
   ┌────┴─────────────────────────────────────┐
   │                                           │
   │  ┌───────────────┬──────────┬──────────┐ │
   │  │               │          │          │ │
   │  ▼               ▼          ▼          ▼ │
   │┌─────────────────────────────────────────┤
   ││  PostgreSQL 15      Redis 7       Nginx │
   ││  (port 5432)        (port 6379)  (dev) │
   ││  localhost          localhost           │
   ││  Dev DB: bookreader_dev                 │
   ││  ✅ Health check    ✅ Health check     │
   ││  No persistence     LRU policy          │
   │└─────────────────────────────────────────┤
   │                                           │
   └───────────────────────────────────────────┘

    ┌───────────────────────────────────────────┐
    │    VOLUMES FOR DATA PERSISTENCE          │
    │                                           │
    │  ✅ postgres_data:/var/lib/postgresql    │
    │  ✅ redis_data:/data                     │
    │  ✅ uploaded_books:/app/uploads          │
    │  ✅ frontend_node_modules:/app/node...   │
    └───────────────────────────────────────────┘
```

---

## CI/CD Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Repository                          │
│                    (main, develop branches)                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         ┌────▼─────┐               ┌──────▼──────┐
         │   PUSH   │               │  PULL       │
         │  to main │               │  REQUEST    │
         └────┬─────┘               └──────┬──────┘
              │                            │
         ┌────▼────────────────────────────▼───────┐
         │      GITHUB ACTIONS: CI.yml             │
         │      (Automated Quality Gates)          │
         └────┬────────────────────────────────────┘
              │
    ┌─────────┴──────────┬────────────┬─────────────┐
    │                    │            │             │
┌───▼────┐        ┌──────▼──┐  ┌─────▼───┐  ┌──────▼─────┐
│Backend │        │Frontend │  │Security │  │Docker      │
│Linting │        │Linting  │  │Scanning │  │Build Test  │
│& Tests │        │& Tests  │  │(Trivy)  │  │            │
│        │        │         │  │         │  │(Buildx)    │
│pytest  │        │vitest   │  │         │  │            │
│mypy    │        │tsc      │  │         │  │            │
│ruff    │        │eslint   │  │         │  │            │
└────┬───┘        └────┬────┘  └─────┬───┘  └──────┬─────┘
     │                 │            │              │
     └─────────────────┼────────────┼──────────────┘
                       │
              ┌────────▼─────────┐
              │  E2E Tests       │
              │  (Playwright)    │
              │  on staging      │
              └────────┬─────────┘
                       │
              ┌────────▼─────────────────┐
              │  ✅ ALL CHECKS PASSED?   │
              └────────┬─────────────────┘
                       │
                    ┌──┴───┐
              YES───┤      ├───NO───► ❌ FAILED (Notify & Stop)
                    │      │
                    └──┬───┘
                       │
              ┌────────▼──────────────────────────────┐
              │  GITHUB ACTIONS: deploy.yml          │
              │  (Only on tags: v*.*.* or manual)    │
              └────────┬──────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
   ┌────▼──────────────────┐   ┌──────▼──────────────────┐
   │  BUILD & PUSH         │   │  DEPLOY TO STAGING     │
   │  Docker Images        │   │                        │
   │                       │   │  1. SSH to staging     │
   │  1. Build backend     │   │  2. Pull code          │
   │  2. Build frontend    │   │  3. docker-compose up  │
   │  3. Push to GHCR      │   │  4. alembic upgrade    │
   │  4. Tag: version      │   │  5. Health check       │
   │  5. Tag: latest       │   │                        │
   └────────┬──────────────┘   └──────┬──────────────────┘
            │                          │
            └──────────────┬───────────┘
                           │
              ┌────────────▼──────────────┐
              │  DEPLOY TO PRODUCTION    │
              │  (Blue-Green Strategy)   │
              └────────┬──────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
     ┌────▼─────────┐        ┌─────▼──────┐
     │  1. Backup   │        │  2. Deploy │
     │     Database │        │     New    │
     │              │        │  Containers│
     │  pg_dump     │        │            │
     └────┬─────────┘        └─────┬──────┘
          │                        │
          └────────────┬───────────┘
                       │
          ┌────────────▼────────────┐
          │  3. Run Migrations      │
          │     alembic upgrade     │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │  4. Reload Nginx        │
          │     (Zero-downtime)     │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │  5. Health Checks       │
          │     (5 retries, 10s)    │
          └────────────┬────────────┘
                       │
                    ┌──┴────┐
              SUCCESS───┤    ├───FAILURE
                       │    │
                    ┌──▼─┐  │
                    │✅ │  │
                    │OK │  │
                    └────┘  │
                            │
                    ┌───────▼─────────┐
                    │  AUTO-ROLLBACK  │
                    │  Restore from   │
                    │  backup & retry │
                    │  previous ver   │
                    └─────────────────┘
```

---

## Service Dependencies & Health Checks

```
┌────────────────────────────────────────────────────────────────┐
│              SERVICE DEPENDENCY GRAPH                          │
│         (with Health Check Status)                             │
└────────────────────────────────────────────────────────────────┘

                    NGINX (Reverse Proxy)
                        ✅ 30s interval
                        ✅ /health check
                            │
            ┌───────────────┼────────────────┐
            │               │                │
        ┌───▼──┐         ┌──▼──┐        ┌───▼──┐
        │React │         │Back-│        │Workers
        │Frontend        │ end │        │
        │✅ /health      │✅ /health    │(monitored)
        └───┬──┘         └──┬──┘        └───┬──┘
            │               │              │
            └───────────────┼──────────────┘
                            │
            ┌───────────────┼────────────────┐
            │               │                │
        ┌───▼──────┐   ┌────▼─────┐  ┌──────▼──┐
        │PostgreSQL│   │ Redis    │  │Celery   │
        │✅ pg_    │   │✅ redis- │  │Beat     │
        │isready   │   │cli ping  │  │(no check)
        └──────────┘   └──────────┘  └─────────┘

Dependencies (must be healthy before):
  ├─ Backend:    Requires PostgreSQL + Redis ✅
  ├─ Frontend:   Requires Backend ✅
  ├─ Celery W.:  Requires Backend + PostgreSQL + Redis ✅
  ├─ Celery B.:  Requires PostgreSQL + Redis ✅
  └─ Nginx:      Requires Frontend + Backend ✅

Health Check Parameters:
  Interval:     30 seconds
  Timeout:      10 seconds
  Retries:      3-5 attempts
  Start Period: 30-60 seconds (grace period)
```

---

## Database & Cache Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│               DATA LAYER ARCHITECTURE                           │
└──────────────────────────────────────────────────────────────────┘

PostgreSQL (Primary Data Store):
┌─────────────────────────────────────────────────────────────┐
│  Hostname: postgres (Docker DNS)                            │
│  Port: 5432                                                 │
│  Database: bookreader_dev (dev) / bookreader_prod (prod)   │
│  Encoding: UTF8, Locale: C                                  │
│                                                             │
│  Tables:                                                    │
│    ✅ users              (authentication, subscriptions)    │
│    ✅ books              (book metadata, CFI tracking)     │
│    ✅ chapters           (book chapters)                    │
│    ✅ descriptions       (extracted text & images)         │
│    ✅ generated_images   (AI-generated images)             │
│    ✅ reading_progress   (user reading position)           │
│    ✅ bookmarks          (user bookmarks)                  │
│    ✅ highlights         (user highlights)                 │
│    ✅ reading_sessions   (reading statistics)              │
│                                                             │
│  Production Tuning:                                         │
│    ✅ max_connections = 200                                │
│    ✅ shared_buffers = 256MB                               │
│    ✅ effective_cache_size = 1GB                           │
│    ✅ work_mem = 4MB                                       │
│    ✅ maintenance_work_mem = 64MB                          │
│    ✅ pg_stat_statements enabled                           │
│    ✅ Slow query logging (>1 second)                       │
│    ✅ Connection/lock monitoring                           │
│                                                             │
│  Backup Strategy:                                           │
│    ✅ Pre-deployment backup (pg_dump)                      │
│    ✅ Automated daily backup (scripts/backup.sh)           │
│    ✅ 7-day retention in production                        │
│    ✅ S3 storage optional (configured in .env)             │
│                                                             │
│  Persistence:                                               │
│    Volume: postgres_data:/var/lib/postgresql/data          │
│    Size: ~100MB-1GB depending on activity                  │
└─────────────────────────────────────────────────────────────┘

Redis (Cache & Message Queue):
┌─────────────────────────────────────────────────────────────┐
│  Hostname: redis (Docker DNS)                               │
│  Port: 6379                                                 │
│  Database: 3 separate DBs                                   │
│                                                             │
│  DB 0: Application Cache                                    │
│    ✅ Session cache                                         │
│    ✅ User data cache                                       │
│    ✅ Book metadata cache                                   │
│    ✅ Image generation cache                                │
│                                                             │
│  DB 1: Celery Broker Queue                                  │
│    ✅ Async task queue                                      │
│    ✅ Book parsing tasks                                    │
│    ✅ Image generation tasks                                │
│                                                             │
│  DB 2: Celery Result Backend                                │
│    ✅ Task results                                          │
│    ✅ Task status                                           │
│    ✅ Task history                                          │
│                                                             │
│  Persistence Settings:                                      │
│    ✅ AOF (Append-Only File) enabled                        │
│    ✅ RDB (snapshot) enabled                                │
│    ✅ Save points: 900s (1 change), 60s (100 changes)      │
│                                                             │
│  Memory Management:                                         │
│    ✅ max_memory = 512MB                                    │
│    ✅ maxmemory-policy = allkeys-lru                        │
│    ✅ Auto-eviction of least recently used keys             │
│                                                             │
│  Persistence:                                               │
│    Volume: redis_data:/data                                 │
│    Files: dump.rdb (RDB), appendonly.aof (AOF)             │
└─────────────────────────────────────────────────────────────┘

Data Flow in Production:
┌─────────────────────────────────────────────────────────────┐

  User Request (HTTP/HTTPS)
         │
         ▼
  ┌─────────────────────┐
  │  Nginx (SSL/TLS)    │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │  FastAPI Backend    │
  │  (8000)             │
  └─────────┬───────────┘
            │
    ┌───────┴────────┐
    │                │
    ▼                ▼
┌──────────┐   ┌──────────┐
│PostgreSQL│   │Redis     │
│(5432)    │   │(6379)    │
│  Data    │   │ Cache+Q  │
└──────────┘   └────┬─────┘
                    │
            ┌───────┴────────┐
            │                │
            ▼                ▼
        ┌─────────┐    ┌──────────┐
        │Celery   │    │Celery    │
        │Worker   │    │Beat      │
        │         │    │(Scheduler)
        │Async    │    │          │
        │Tasks    │    │Scheduled │
        │         │    │Tasks     │
        └─────────┘    └──────────┘

┌─────────────────────────────────────────────────────────────┐
```

---

## Monitoring & Observability Stack

```
┌────────────────────────────────────────────────────────────┐
│         MONITORING & OBSERVABILITY ARCHITECTURE           │
│            (Optional - Can be enabled)                     │
└────────────────────────────────────────────────────────────┘

Currently DISABLED (ENV: PROMETHEUS_ENABLED=false)
Can be enabled: docker-compose -f docker-compose.monitoring.yml up

┌─────────────────────────────────────────────────────────────┐
│ METRICS COLLECTION (Prometheus)                             │
│                                                             │
│ Scrape Targets:                                             │
│  ├─ Backend:  /metrics endpoint (port 8000)                │
│  ├─ Database: postgres_exporter (port 9187)                │
│  ├─ Cache:    redis_exporter (port 9121)                   │
│  ├─ Web:      nginx_exporter (port 9113)                   │
│  └─ Tasks:    celery_exporter (port 9808)                  │
│                                                             │
│ Metrics Available:                                          │
│  ✅ HTTP requests (rate, duration, status codes)           │
│  ✅ Database queries (count, latency, errors)              │
│  ✅ Redis commands (hit/miss ratio, memory)                │
│  ✅ Worker tasks (running, completed, failed)              │
│  ✅ System resources (CPU, memory, disk)                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ VISUALIZATION (Grafana)                                     │
│                                                             │
│ Port: 3000                                                  │
│ User: admin                                                 │
│ Password: GRAFANA_PASSWORD (env var)                        │
│                                                             │
│ Dashboards:                                                 │
│  ✅ System Overview (CPU, Memory, Disk)                     │
│  ✅ Service Health (uptime, restarts)                       │
│  ✅ API Metrics (requests, errors, latency)                 │
│  ✅ Database Performance (queries, connections)             │
│  ✅ Cache Performance (hit ratio, memory)                   │
│  ✅ Worker Status (active tasks, queue depth)               │
│  ✅ Deployment History (deployments timeline)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALERTING (AlertManager)                                     │
│                                                             │
│ Critical Alerts:                                            │
│  ⚠  Service Down       (health check failed)                │
│  ⚠  High Error Rate    (>5% 5xx responses)                  │
│  ⚠  High Latency       (p95 > 500ms)                        │
│  ⚠  Database Issues    (connection pool exhausted)          │
│  ⚠  Memory Pressure    (>90% utilization)                   │
│  ⚠  Disk Space Low     (<10% free)                          │
│  ⚠  Worker Failures    (task crash rate)                    │
│                                                             │
│ Notification Channels:                                      │
│  ├─ Slack integration (SLACK_WEBHOOK_URL)                   │
│  ├─ Email notifications                                     │
│  └─ PagerDuty integration (optional)                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ LOG AGGREGATION (Loki)                                      │
│                                                             │
│ Log Sources:                                                │
│  ✅ Backend application logs                                │
│  ✅ Nginx access/error logs                                 │
│  ✅ Database logs (slow queries)                            │
│  ✅ Celery worker logs                                      │
│  ✅ Frontend logs (client-side)                             │
│                                                             │
│ Log Retention:                                              │
│  ✅ 7 days default                                          │
│  ✅ Configurable per service                                │
│                                                             │
│ Log Rotation (Logrotate):                                   │
│  ✅ Daily rotation                                          │
│  ✅ Compress old logs                                       │
│  ✅ 7-day retention                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Deployment Strategy Details

```
┌──────────────────────────────────────────────────────────────┐
│         ZERO-DOWNTIME DEPLOYMENT STRATEGY                   │
│              (Blue-Green with Health Checks)                │
└──────────────────────────────────────────────────────────────┘

BEFORE (Blue):                AFTER (Green):
┌─────────────┐              ┌─────────────┐
│ Old Backend │  ◄──────►    │ New Backend │
│ (stable)    │  Switching   │ (deployed)  │
└─────────────┘              └─────────────┘
      │                           │
      └──────────────┬────────────┘
                     │
              ┌──────▼──────┐
              │ Nginx Rules │
              │ Traffic Mgmt│
              └─────────────┘

Timeline:

T0: Current state (Old version running, healthy)
    Nginx ──► Backend v1 ──► DB
              (Users actively using)

T1: Build new version
    Docker Buildx builds:
    - backend:v2 image
    - frontend:v2 image

T2: Push to registry (GHCR)
    Images tagged:
    - ghcr.io/.../backend:v2
    - ghcr.io/.../backend:latest
    - ghcr.io/.../frontend:v2
    - ghcr.io/.../frontend:latest

T3: Database backup
    pg_dump bookreader > backup-$(date).sql
    (If migration fails, we can restore)

T4: Start new containers (Green)
    docker-compose up -d --no-deps backend frontend
    (New containers start alongside old ones)

    Old (Blue):  ◄── Active traffic
    New (Green): ◄── Starting up (no traffic yet)

T5: Wait for health checks
    Backend /health ──► ✅ 200 OK
    Frontend / ──► ✅ 200 OK
    (Wait 30-60 seconds)

T6: Run database migrations
    alembic upgrade head
    (Backward compatible migrations must be used)
    Schema changes applied incrementally

T7: Reload Nginx (critical for zero-downtime)
    nginx -s reload

    Old (Blue):  ◄── Closing connections
    New (Green): ◄── Accepting new requests

    Existing connections finish gracefully on old version
    New requests go to new version

T8: Final health check
    curl https://bookreader.example.com/api/health
    (5 retries with 10-second delays)

T9: Success!
    ✅ New version fully active
    ✅ Old containers can be stopped
    ✅ No downtime observed

ROLLBACK (if T8 fails):
    Automatic rollback triggered:
    ├─ Stop new containers
    ├─ Rollback database migrations
    │  (alembic downgrade -1)
    ├─ Restore from backup if needed
    └─ Switch Nginx back to old version

KEY POINTS:
✅ Old version keeps running until switch
✅ New version tested before traffic switch
✅ Nginx reload is atomic (no dropped requests)
✅ Database migrations are backward compatible
✅ Full rollback capability if anything fails
✅ Health checks ensure service stability
```

---

**Generated:** November 3, 2025
**Infrastructure Version:** Production-Ready ✅
