# Infrastructure Quick Reference

**Last Updated:** 2025-10-24

## Quick Commands

### Development

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
docker-compose logs -f celery-worker

# Restart specific service
docker-compose restart celery-worker

# Scale workers
docker-compose up -d --scale celery-worker=3

# Run tests
cd backend && pytest -v
cd frontend && npm test

# Database migrations
docker-compose exec backend alembic upgrade head
docker-compose exec backend alembic revision --autogenerate -m "description"
```

### Production

```bash
# Deploy via GitHub Actions
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# Manual deployment
ssh user@prod-server
cd /opt/bookreader
git pull origin main
docker-compose -f docker-compose.production.yml up -d

# Health check
curl https://bookreader.example.com/api/health

# View resource usage
docker stats

# Database backup
./scripts/backup.sh
```

## Configuration Values

### Memory Limits

| Service | Memory Limit | Concurrency | Max Tasks |
|---------|--------------|-------------|-----------|
| Backend | No limit | 4 workers (uvicorn) | - |
| Celery Worker | 6GB | 2 tasks | 10 before restart |
| Celery Beat | 512MB | - | - |
| PostgreSQL | No limit | 30 connections (10+20) | - |
| Redis | No limit | - | - |

### Environment Variables (Critical)

```bash
# Security (MUST CHANGE in production)
SECRET_KEY=<64-char-random>
JWT_SECRET_KEY=<64-char-random>
DB_PASSWORD=<32-char-random>
REDIS_PASSWORD=<32-char-random>

# Performance
CELERY_CONCURRENCY=2
CELERY_MAX_TASKS_PER_CHILD=10
CELERY_WORKER_MAX_MEMORY_PER_CHILD=5000000

# Database pool (configured in code)
pool_size=10
max_overflow=20
```

## Resource Budgets

### Memory Budget

```
Development:
├── Backend: ~500MB
├── Frontend: ~300MB
├── PostgreSQL: ~200MB
├── Redis: ~100MB
├── Celery Worker (1): ~6GB
└── Total: ~8GB

Production (5 workers):
├── Backend: ~500MB
├── Frontend: ~300MB
├── PostgreSQL: ~500MB
├── Redis: ~200MB
├── Celery Workers (5): ~30GB
├── Celery Beat: ~500MB
├── Nginx: ~50MB
└── Total: ~48GB (under 50GB target)
```

### Connection Limits

```
PostgreSQL:
├── Pool size: 10 (baseline)
├── Max overflow: 20 (burst)
└── Total capacity: 30 concurrent connections

Redis:
└── Unlimited (lightweight operations)
```

## CI/CD Workflows

### Triggers

| Workflow | Trigger | Actions |
|----------|---------|---------|
| CI Pipeline | Push to main/develop, PRs | Lint, test, build, security scan |
| Deploy | Version tags (v*.*.*) | Build images, deploy production |
| Deploy (manual) | Workflow dispatch | Deploy to staging/production |

### Status Checks

All PRs require these checks to pass:
- ✅ Backend lint (Ruff, Black, MyPy)
- ✅ Backend tests (pytest with coverage)
- ✅ Frontend lint (ESLint, TypeScript)
- ✅ Frontend tests (Vitest)
- ✅ Security scan (Trivy, TruffleHog)

## Health Checks

### Endpoints

```bash
# Backend health
curl http://localhost:8000/api/health

# Frontend (development)
curl http://localhost:3000

# Celery worker status
docker-compose exec celery-worker celery -A app.core.celery_app inspect active

# Database connections
docker-compose exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

### Expected Responses

```json
// /api/health
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "celery": "running"
}
```

## Troubleshooting

### Common Issues

**Issue:** Out of memory errors
```bash
# Check memory usage
docker stats

# Scale down workers
docker-compose up -d --scale celery-worker=2

# Restart with lower concurrency
export CELERY_CONCURRENCY=1
docker-compose restart celery-worker
```

**Issue:** Database connection pool exhausted
```bash
# Check active connections
docker-compose exec postgres psql -U postgres -c \
  "SELECT count(*) FROM pg_stat_activity;"

# Kill idle connections
docker-compose exec postgres psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND state_change < now() - interval '5 minutes';"
```

**Issue:** CI/CD pipeline failing
```bash
# View workflow logs
gh run list --workflow=ci.yml
gh run view <run-id> --log

# Re-run failed jobs
gh run rerun <run-id>
```

**Issue:** Deployment failed
```bash
# SSH to server and check logs
ssh user@server
cd /opt/bookreader
docker-compose logs --tail=100

# Rollback to previous version
git checkout HEAD~1
docker-compose down && docker-compose up -d
```

## Monitoring Queries

### PostgreSQL

```sql
-- Connection pool status
SELECT
  count(*) as total,
  sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
  sum(CASE WHEN state = 'idle' THEN 1 ELSE 0 END) as idle
FROM pg_stat_activity
WHERE datname = current_database();

-- Slow queries
SELECT pid, age(clock_timestamp(), query_start), query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start;

-- Database size
SELECT pg_size_pretty(pg_database_size(current_database()));
```

### Docker

```bash
# Resource usage (live)
docker stats

# Container logs (last 100 lines)
docker-compose logs --tail=100 <service>

# Follow logs in real-time
docker-compose logs -f <service>

# Inspect container
docker inspect bookreader_celery
```

### Celery

```bash
# Active tasks
docker-compose exec celery-worker celery -A app.core.celery_app inspect active

# Scheduled tasks
docker-compose exec celery-worker celery -A app.core.celery_app inspect scheduled

# Worker stats
docker-compose exec celery-worker celery -A app.core.celery_app inspect stats
```

## Security Checklist

**Before Production:**
- [ ] Changed all default passwords
- [ ] Generated strong SECRET_KEY and JWT_SECRET_KEY
- [ ] Set DEBUG=false
- [ ] Configured restrictive CORS_ORIGINS
- [ ] Setup SSL/TLS certificates
- [ ] Limited ALLOWED_HOSTS
- [ ] Removed hardcoded secrets from code
- [ ] Enabled automated backups
- [ ] Configured monitoring alerts
- [ ] Reviewed firewall rules

**Generate Secrets:**
```bash
# SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(64))"

# JWT_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Database password
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Redis password
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Performance Tuning

### Scaling Guidelines

| Concurrent Users | Workers | Concurrency | Total Tasks | Memory |
|-----------------|---------|-------------|-------------|--------|
| < 10 | 1 | 2 | 2 | ~8GB |
| 10-50 | 2 | 2 | 4 | ~16GB |
| 50-100 | 3 | 2 | 6 | ~24GB |
| 100-200 | 5 | 2 | 10 | ~48GB |

### Optimization Flags

```bash
# Development (fast iteration)
DEBUG=true
LOG_LEVEL=debug
CELERY_CONCURRENCY=1

# Staging (testing)
DEBUG=false
LOG_LEVEL=info
CELERY_CONCURRENCY=2
WORKERS_COUNT=2

# Production (performance)
DEBUG=false
LOG_LEVEL=warning
CELERY_CONCURRENCY=2
WORKERS_COUNT=4
```

## Backup & Recovery

### Automatic Backup

```bash
# Enable in .env
BACKUP_ENABLED=true
BACKUP_RETENTION_DAYS=7

# Runs daily via cron or systemd timer
```

### Manual Backup

```bash
# Database
docker-compose exec postgres pg_dump -U postgres bookreader_prod > backup.sql

# Volumes
docker run --rm -v bookreader_postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres-backup.tar.gz /data

# Full backup (using script)
./scripts/backup.sh
```

### Restore

```bash
# Database
cat backup.sql | docker-compose exec -T postgres psql -U postgres bookreader_prod

# Volumes
docker run --rm -v bookreader_postgres_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/postgres-backup.tar.gz -C /
```

## Useful Links

**Documentation:**
- [Infrastructure Optimization Report](./INFRASTRUCTURE_OPTIMIZATION.md)
- [Security Guide](./SECURITY.md)
- [GitHub Actions README](../../.github/workflows/README.md)

**External:**
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Celery Documentation](https://docs.celeryproject.org/)
- [PostgreSQL Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)

---

**Questions?** Check the full documentation or open an issue.
