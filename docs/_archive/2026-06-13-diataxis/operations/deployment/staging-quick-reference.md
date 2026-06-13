# Staging Deployment - Quick Reference Card

**Version:** 1.0 | **Last Updated:** 2025-11-15
**Server:** 4GB RAM, 2 CPU cores | **Environment:** Staging

---

## Essential Commands

### Service Management

```bash
# Start all services
docker compose -f docker-compose.staging.yml up -d

# Stop all services
docker compose -f docker-compose.staging.yml down

# Restart specific service
docker compose -f docker-compose.staging.yml restart backend

# View logs (live)
docker compose -f docker-compose.staging.yml logs -f --tail=100 backend

# Check status
docker compose -f docker-compose.staging.yml ps
```

### Resource Monitoring

```bash
# Docker stats (real-time)
docker stats

# System resources
free -h && df -h

# PostgreSQL size
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "SELECT pg_size_pretty(pg_database_size('bookreader_staging'));"

# Redis memory
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} INFO MEMORY | grep used_memory_human
```

### Database Operations

```bash
# Run migrations
docker compose -f docker-compose.staging.yml exec backend alembic upgrade head

# Check migration status
docker compose -f docker-compose.staging.yml exec backend alembic current

# Backup database
./scripts/backup-database.sh

# List backups
./scripts/backup-database.sh --list

# PostgreSQL shell
docker exec -it bookreader_postgres_staging psql -U postgres -d bookreader_staging
```

### Health Checks

```bash
# Main health endpoint
curl https://staging.yourdomain.com/health

# API health
curl https://staging.yourdomain.com/api/health

# Check SSL
curl -I https://staging.yourdomain.com

# Full smoke test
curl -sf https://staging.yourdomain.com/health && echo "✅ OK" || echo "❌ FAIL"
```

---

## Common Issues

### Out of Memory

```bash
# Check memory usage
docker stats --no-stream
free -h

# SOLUTION 1: Reduce workers
# Edit .env.staging: WORKERS_COUNT=1

# SOLUTION 2: Disable Celery
# Edit .env.staging: CELERY_CONCURRENCY=0

# SOLUTION 3: Add swap
sudo fallocate -l 4G /swapfile2
sudo chmod 600 /swapfile2
sudo mkswap /swapfile2
sudo swapon /swapfile2
```

### Service Won't Start

```bash
# Check logs
docker compose -f docker-compose.staging.yml logs <service>

# PostgreSQL permission fix
sudo chown -R 999:999 volumes/postgres_data

# Port conflict check
sudo netstat -tlnp | grep :80

# Full restart
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.staging.yml up -d
```

### Database Connection Error

```bash
# Check PostgreSQL running
docker compose -f docker-compose.staging.yml ps postgres

# Test connection
docker compose -f docker-compose.staging.yml exec backend \
  nc -zv postgres 5432

# Check active connections
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "SELECT count(*) FROM pg_stat_activity;"

# SOLUTION: Increase pool size
# Edit .env.staging: DB_POOL_SIZE=15
```

### SSL Certificate Issues

```bash
# Renew Let's Encrypt
sudo certbot renew --force-renewal

# Copy to nginx
sudo cp /etc/letsencrypt/live/staging.yourdomain.com/*.pem nginx/ssl/

# Restart nginx
docker compose -f docker-compose.staging.yml restart nginx

# Check expiry
openssl x509 -in nginx/ssl/fullchain.pem -noout -dates
```

---

## Deployment Workflow

### Update Application

```bash
# 1. Pull latest code
git pull origin develop

# 2. Rebuild images
docker compose -f docker-compose.staging.yml build

# 3. Restart services
docker compose -f docker-compose.staging.yml up -d

# 4. Run migrations
docker compose -f docker-compose.staging.yml exec backend alembic upgrade head

# 5. Verify
curl https://staging.yourdomain.com/health
```

### Rollback

```bash
# 1. Checkout previous version
git checkout <previous_commit_or_tag>

# 2. Rebuild
docker compose -f docker-compose.staging.yml build

# 3. Restart
docker compose -f docker-compose.staging.yml up -d

# 4. Restore database (if needed)
# See Emergency Procedures below
```

---

## Emergency Procedures

### Complete Service Restart

```bash
# 1. Stop all services
docker compose -f docker-compose.staging.yml down

# 2. Clear any stuck containers
docker ps -a | grep bookreader | awk '{print $1}' | xargs docker rm -f

# 3. Start services
docker compose -f docker-compose.staging.yml up -d

# 4. Watch logs
docker compose -f docker-compose.staging.yml logs -f
```

### Database Recovery

```bash
# 1. Stop write operations
docker compose -f docker-compose.staging.yml stop backend celery-worker

# 2. Restore from latest backup
LATEST_BACKUP=$(ls -t /backups/postgresql/backup_*.dump | head -1)
docker exec -i bookreader_postgres_staging pg_restore \
  -U postgres \
  -d bookreader_staging \
  --clean --if-exists \
  -v < $LATEST_BACKUP

# 3. Restart services
docker compose -f docker-compose.staging.yml start backend celery-worker

# 4. Verify
curl https://staging.yourdomain.com/health
```

### Disk Space Full

```bash
# Check usage
df -h
docker system df

# Clean old images
docker image prune -a -f

# Clean old containers
docker container prune -f

# Clean old volumes (CAUTION!)
docker volume prune -f

# Clean old backups (keep last 3)
cd /backups/postgresql
ls -t backup_*.dump | tail -n +4 | xargs rm -f

# Clean logs
sudo journalctl --vacuum-time=7d
docker compose -f docker-compose.staging.yml exec backend find /var/log -name "*.log" -mtime +7 -delete
```

---

## Performance Tuning

### If Memory > 3.5GB

```bash
# Gradual reduction:

# Level 1: Reduce workers
# .env.staging: WORKERS_COUNT=1

# Level 2: Disable Celery
# .env.staging: CELERY_CONCURRENCY=0

# Level 3: Reduce PostgreSQL buffers
# docker-compose.staging.yml:
# -c shared_buffers=64MB
# -c effective_cache_size=256MB

# Level 4: Reduce Redis maxmemory
# docker-compose.staging.yml:
# --maxmemory 256mb

# Apply changes
docker compose -f docker-compose.staging.yml up -d
```

### If CPU > 80%

```bash
# Find slow queries
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT pid, now() - query_start as duration, query
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC
  LIMIT 10;
"

# Reduce workers
# .env.staging: WORKERS_COUNT=1

# Add rate limiting
# nginx.conf: limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
```

---

## Monitoring Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| RAM usage | >3.5GB | >3.8GB | Reduce workers |
| Swap usage | >500MB | >1GB | Add RAM |
| Disk usage | >80% | >90% | Clean backups/logs |
| PostgreSQL connections | >80 | >95 | Increase pool |
| CPU usage | >80% | >95% | Optimize queries |
| Response time | >2s | >5s | Check logs |

---

## Key File Locations

```
/opt/bookreader/fancai-vibe-hackathon/
├── .env.staging              # Environment variables
├── docker-compose.staging.yml # Staging compose file
├── scripts/
│   └── backup-database.sh    # Backup script
├── nginx/
│   └── ssl/                  # SSL certificates
│       ├── fullchain.pem
│       └── privkey.pem
└── backend/
    └── storage/              # Uploaded books

/backups/postgresql/           # Database backups
/var/log/
├── backup-database.log       # Backup logs
└── smoke-test.log            # Test logs
```

---

## Environment Variables (Critical)

```bash
# MUST change from defaults:
DOMAIN_NAME=staging.yourdomain.com
DB_PASSWORD=<32+ chars>
REDIS_PASSWORD=<32+ chars>
SECRET_KEY=<64+ chars>
JWT_SECRET_KEY=<64+ chars>

# Generate secrets:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"  # DB/Redis
python3 -c "import secrets; print(secrets.token_urlsafe(64))"  # SECRET/JWT
```

---

## Ports

| Service | Internal | External | Access |
|---------|----------|----------|--------|
| HTTP | 80 | 80 | Public |
| HTTPS | 443 | 443 | Public |
| SSH | 22 | 22 | Restricted |
| PostgreSQL | 5432 | - | Internal only |
| Redis | 6379 | - | Internal only |

**Firewall rules:**

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Useful SQL Queries

### Database Health

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('bookreader_staging'));

-- Table sizes
SELECT
  schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- Active connections
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'bookreader_staging'
GROUP BY state;

-- Cache hit ratio (should be >99%)
SELECT
  sum(heap_blks_hit)::NUMERIC /
  nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100
  as cache_hit_ratio
FROM pg_statio_user_tables;

-- Slow queries (if helper function exists)
SELECT * FROM get_slow_queries(10);
```

---

## Contact Information

**On-Call:** [Your phone/Slack/PagerDuty]
**Email:** devops@yourdomain.com
**Documentation:** https://github.com/your-org/fancai-vibe-hackathon/tree/main/docs
**Issues:** https://github.com/your-org/fancai-vibe-hackathon/issues

---

## Escalation Path

1. **Level 1:** Check logs and this quick reference
2. **Level 2:** Review full deployment guide (staging-deployment-4gb-server.md)
3. **Level 3:** Check GitHub issues
4. **Level 4:** Contact on-call engineer
5. **Level 5:** Create incident and page senior engineer

---

**Print this page and keep near your desk!**

*This is a quick reference. For complete procedures, see:*
*[Staging Deployment Guide](./staging-deployment-4gb-server.md)*
