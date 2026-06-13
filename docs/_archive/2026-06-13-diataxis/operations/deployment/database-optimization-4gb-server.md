# Database Optimization для 4GB RAM Server

**Дата создания:** 2025-11-15
**Версия:** 1.0
**Целевое окружение:** Development/Staging (4GB RAM, 2 CPU cores, 100GB storage)

## Обзор

Этот документ описывает оптимизацию PostgreSQL и Redis для production deployment на сервере с ограниченными ресурсами (4GB RAM). Конфигурация оптимизирована для staging/development окружения с умеренной нагрузкой (10-50 одновременных пользователей).

## Характеристики Сервера

- **RAM:** 4GB
- **CPU:** 2 cores
- **Storage:** 100GB SSD
- **Concurrent Users:** 10-50 (design target)
- **Database Size:** ~5-10GB (books metadata, images)

## Memory Budget

| Компонент | Выделено RAM | Примечание |
|-----------|--------------|------------|
| PostgreSQL | 512MB-1GB | Shared buffers + connections |
| Redis | 256MB-512MB | Maxmemory limit |
| Backend API | 500MB-1GB | Gunicorn workers (4 workers) |
| Celery Worker | 500MB-1GB | NLP models + tasks |
| OS + Overhead | 500MB-800MB | Kernel, system processes |
| **TOTAL** | **~3.5GB** | Safe margin для 4GB server |

## 1. PostgreSQL Configuration

### 1.1. Файлы Конфигурации

**Основной конфиг:** `/postgres/postgresql.conf`

Ключевые параметры для 4GB RAM server:

```conf
# Memory
shared_buffers = 256MB          # 25% от PostgreSQL RAM allocation
effective_cache_size = 1GB      # 50% от server RAM (OS cache estimate)
work_mem = 4MB                  # Per-operation memory (sort/hash)
maintenance_work_mem = 64MB     # VACUUM, CREATE INDEX memory

# Connections
max_connections = 100           # Conservative для low-memory server

# WAL (Write-Ahead Log)
wal_level = replica
max_wal_size = 1GB
min_wal_size = 256MB
wal_compression = on

# Autovacuum (Critical!)
autovacuum = on
autovacuum_max_workers = 2
autovacuum_vacuum_scale_factor = 0.1
autovacuum_analyze_scale_factor = 0.05

# Performance
random_page_cost = 1.1          # Optimized для SSD
effective_io_concurrency = 200  # SSD parallelism
```

**Initialization Script:** `/postgres/init/01-extensions.sql`

Устанавливает необходимые расширения:
- `pg_stat_statements` - мониторинг производительности queries
- `pg_trgm` - full-text search
- `btree_gin` - composite indexes
- `uuid-ossp` - UUID generation

### 1.2. Docker Compose Integration

```yaml
postgres:
  image: postgres:15-alpine
  command: postgres -c config_file=/etc/postgresql/postgresql.conf
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./postgres/init:/docker-entrypoint-initdb.d:ro
    - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
    - postgres_logs:/var/log/postgresql
  deploy:
    resources:
      limits:
        memory: 1G
      reservations:
        memory: 512M
```

### 1.3. SQLAlchemy Connection Pool

**Backend Configuration** (настраивается через environment variables):

```python
# Environment Variables для Staging (4GB RAM server)
DB_POOL_SIZE=10           # Base pool size (per worker)
DB_MAX_OVERFLOW=10        # Additional connections under load
DB_POOL_RECYCLE=3600      # Recycle connections every 1 hour
DB_POOL_TIMEOUT=30        # Wait timeout для connection

# Total connections calculation:
# - Gunicorn workers: 4
# - Pool per worker: 10 + 10 overflow = 20 max
# - Total capacity: 4 workers * 20 = 80 connections
# - PostgreSQL max_connections: 100 (safe margin)
```

**Memory Calculation:**
```
PostgreSQL Memory = shared_buffers + (connections * work_mem) + overhead
                  = 256MB + (100 * 4MB) + 200MB
                  = 856MB (в пределах 1GB limit)
```

### 1.4. Monitoring Queries

**Database Size:**
```sql
SELECT * FROM get_database_size();
```

**Table Sizes:**
```sql
SELECT * FROM get_table_sizes();
```

**Top 10 Slow Queries:**
```sql
SELECT * FROM get_slow_queries(10);
```

**Active Connections:**
```sql
SELECT * FROM get_active_connections();
```

**Cache Hit Ratio (должен быть >99%):**
```sql
SELECT
    sum(heap_blks_hit)::NUMERIC /
    nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100
    as cache_hit_ratio
FROM pg_statio_user_tables;
```

## 2. Redis Configuration

### 2.1. Файл Конфигурации

**Redis Config:** `/redis/redis.conf`

Ключевые параметры:

```conf
# Memory
maxmemory 512mb                 # Maximum memory limit
maxmemory-policy allkeys-lru    # Eviction policy (LRU for caching)
maxmemory-samples 5             # LRU algorithm accuracy

# Persistence (RDB Snapshots)
save 900 1                      # Save if 1 key changed in 15 min
save 300 10                     # Save if 10 keys changed in 5 min
save 60 10000                   # Save if 10k keys changed in 1 min

# Persistence (AOF)
appendonly yes                  # Enable AOF (more durable)
appendfsync everysec            # Sync every second (balanced)
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Security
requirepass ${REDIS_PASSWORD}
rename-command FLUSHDB ""       # Disable dangerous commands
rename-command FLUSHALL ""

# Performance
tcp-keepalive 300
timeout 300
maxclients 1000

# Defragmentation
activedefrag yes
active-defrag-threshold-lower 10
active-defrag-cycle-min 5
active-defrag-cycle-max 75
```

### 2.2. Docker Compose Integration

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server /usr/local/etc/redis/redis.conf
    --requirepass ${REDIS_PASSWORD}
  volumes:
    - redis_data:/data
    - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
  deploy:
    resources:
      limits:
        memory: 512M
      reservations:
        memory: 256M
```

### 2.3. Redis Databases Layout

BookReader AI использует несколько логических БД в Redis:

| Database | Purpose | TTL Strategy |
|----------|---------|--------------|
| db=0 | Session storage (JWT tokens) | TTL: 7 days |
| db=1 | Celery broker (task queue) | TTL: 1 day |
| db=2 | Celery results (task results) | TTL: 1 hour |
| db=3 | API caching | TTL: varies |
| db=4 | Rate limiting | TTL: 1 minute |

### 2.4. Memory Optimization

**Data Structure Optimization:**

```conf
# Hash optimization (для session objects)
hash-max-ziplist-entries 512
hash-max-ziplist-value 64

# List optimization (для Celery queues)
list-max-ziplist-size -2
list-compress-depth 0

# Set optimization
set-max-intset-entries 512

# Sorted Set optimization
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
```

### 2.5. Monitoring Commands

**Memory Usage:**
```bash
redis-cli -a ${REDIS_PASSWORD} INFO MEMORY
```

**Keyspace Statistics:**
```bash
redis-cli -a ${REDIS_PASSWORD} INFO KEYSPACE
```

**Slow Queries:**
```bash
redis-cli -a ${REDIS_PASSWORD} SLOWLOG GET 10
```

**Current Connections:**
```bash
redis-cli -a ${REDIS_PASSWORD} INFO CLIENTS
```

## 3. Backup Strategy

### 3.1. Automated Backups

**Script:** `/scripts/backup-database.sh`

**Features:**
- Compressed pg_dump (custom format, level 9)
- Automatic retention (7 days default)
- Docker-aware (works with containerized PostgreSQL)
- Error handling and logging
- Backup verification

**Usage:**

```bash
# Manual backup
./scripts/backup-database.sh

# Custom retention
./scripts/backup-database.sh --keep-days 14

# List backups
./scripts/backup-database.sh --list

# Verify last backup
./scripts/backup-database.sh --verify-only
```

**Cron Setup (daily at 2 AM):**

```cron
0 2 * * * /path/to/fancai-vibe-hackathon/scripts/backup-database.sh >> /var/log/backup-database.log 2>&1
```

### 3.2. Redis Persistence

**RDB Snapshots:**
- Automatic snapshots based on save rules
- File: `/data/dump.rdb`
- Compressed with LZF

**AOF (Append-Only File):**
- Logs every write operation
- File: `/data/appendonly.aof`
- Fsync strategy: everysec (balanced)
- Automatic rewrite when file grows 100%

**Backup Location:**
```
/backups/
├── postgresql/
│   ├── backup_bookreader_20251115_020000.dump
│   ├── backup_bookreader_20251114_020000.dump
│   └── backup.log
└── redis/
    ├── dump.rdb (copy from container)
    └── appendonly.aof (copy from container)
```

## 4. Environment Variables

### 4.1. Staging Environment (.env.production)

```bash
# ============================================================================
# DATABASE CONFIGURATION (4GB RAM Server Optimized)
# ============================================================================

# PostgreSQL Connection
DB_NAME=bookreader
DB_USER=postgres
DB_PASSWORD=<strong_password_here>
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}

# SQLAlchemy Connection Pool (STAGING PROFILE)
DB_POOL_SIZE=10               # Conservative для low-memory server
DB_MAX_OVERFLOW=10            # Total capacity: 20 connections per worker
DB_POOL_RECYCLE=3600          # Recycle connections every 1 hour
DB_POOL_TIMEOUT=30            # Wait timeout (30 seconds)

# Redis Configuration
REDIS_PASSWORD=<strong_redis_password_here>
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# Celery Configuration
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2
CELERY_CONCURRENCY=1          # 1 worker для low-memory server

# Application Workers
WORKERS_COUNT=4               # Gunicorn workers (4 для 2 CPU cores)

# Logging
LOG_LEVEL=INFO                # Production logging level
```

### 4.2. Production Environment (8GB+ RAM)

Если в будущем используется более мощный сервер:

```bash
# SQLAlchemy Connection Pool (PRODUCTION PROFILE)
DB_POOL_SIZE=20               # High concurrency baseline
DB_MAX_OVERFLOW=40            # Total capacity: 60 connections per worker
DB_POOL_RECYCLE=3600
DB_POOL_TIMEOUT=30

# Celery Configuration
CELERY_CONCURRENCY=2          # 2 workers для более мощного сервера

# Application Workers
WORKERS_COUNT=8               # More workers для high traffic
```

## 5. Performance Tuning

### 5.1. PostgreSQL Query Optimization

**Index Strategy:**

```sql
-- Composite index для частых queries
CREATE INDEX idx_books_user_created ON books (user_id, created_at);

-- Partial index для фильтрации
CREATE INDEX idx_books_parsed ON books (user_id) WHERE is_parsed = true;

-- GIN index для full-text search
CREATE INDEX idx_books_title_trgm ON books USING gin (title gin_trgm_ops);
```

**Query Examples:**

```python
# ❌ BAD - N+1 queries
books = await db.execute(select(Book).where(Book.user_id == user_id))
for book in books.scalars():
    chapters = book.chapters  # Separate query for each book!

# ✅ GOOD - Eager loading
stmt = (
    select(Book)
    .options(selectinload(Book.chapters))
    .where(Book.user_id == user_id)
)
books = await db.execute(stmt)
```

### 5.2. Redis Cache Strategy

**TTL Best Practices:**

```python
# User sessions (JWT tokens)
redis.setex(f"session:{user_id}", 7 * 24 * 3600, session_data)  # 7 days

# API responses
redis.setex(f"api:books:{user_id}", 300, json_data)  # 5 minutes

# Rate limiting
redis.setex(f"ratelimit:{ip}:{endpoint}", 60, count)  # 1 minute
```

**Cache Hit Optimization:**

1. Warm cache on startup (preload common data)
2. Use predictable keys (easier to invalidate)
3. Set appropriate TTLs (balance freshness vs load)
4. Monitor cache hit ratio (target >90%)

### 5.3. Autovacuum Tuning

**Monitor Table Bloat:**

```sql
SELECT * FROM get_table_bloat();
```

**Aggressive Autovacuum для High-Traffic Tables:**

```sql
ALTER TABLE reading_sessions SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);
```

## 6. Monitoring Setup

### 6.1. PostgreSQL Monitoring

**Key Metrics:**

```sql
-- Connection count
SELECT count(*) as total_connections, state
FROM pg_stat_activity
WHERE datname = 'bookreader'
GROUP BY state;

-- Slow queries (>1 second)
SELECT
    pid,
    now() - query_start as duration,
    state,
    LEFT(query, 100) as query
FROM pg_stat_activity
WHERE state != 'idle'
  AND now() - query_start > interval '1 second'
ORDER BY duration DESC;

-- Index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as scans,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

**pg_stat_statements Queries:**

```sql
-- Top 10 queries by total time
SELECT
    query,
    calls,
    ROUND(total_exec_time::NUMERIC, 2) as total_ms,
    ROUND(mean_exec_time::NUMERIC, 2) as mean_ms
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

### 6.2. Redis Monitoring

**Memory Stats:**

```bash
redis-cli -a ${REDIS_PASSWORD} INFO MEMORY | grep -E "(used_memory_human|maxmemory_human|mem_fragmentation_ratio)"
```

**Hit Rate:**

```bash
redis-cli -a ${REDIS_PASSWORD} INFO STATS | grep -E "(keyspace_hits|keyspace_misses)"
```

**Slow Log:**

```bash
redis-cli -a ${REDIS_PASSWORD} SLOWLOG GET 10
```

### 6.3. Grafana Dashboards (Recommended)

**Prometheus Exporters:**

1. **postgres_exporter** - PostgreSQL metrics
   ```yaml
   postgres_exporter:
     image: prometheuscommunity/postgres-exporter
     environment:
       DATA_SOURCE_NAME: postgresql://monitoring:password@postgres:5432/bookreader?sslmode=disable
   ```

2. **redis_exporter** - Redis metrics
   ```yaml
   redis_exporter:
     image: oliver006/redis_exporter
     environment:
       REDIS_ADDR: redis:6379
       REDIS_PASSWORD: ${REDIS_PASSWORD}
   ```

**Key Metrics to Monitor:**

- PostgreSQL:
  - Connection count
  - Query latency (p95, p99)
  - Cache hit ratio
  - Table bloat
  - Replication lag (если есть replicas)

- Redis:
  - Memory usage
  - Evicted keys
  - Hit rate
  - Command latency
  - Connected clients

## 7. Troubleshooting

### 7.1. PostgreSQL Issues

**Issue: Connection Pool Exhausted**

Symptoms:
```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 10 overflow 10 reached
```

Solutions:
1. Increase `DB_POOL_SIZE` и `DB_MAX_OVERFLOW` (если RAM позволяет)
2. Optimize long-running queries
3. Check для connection leaks (не закрытые sessions)
4. Use connection pooler (PgBouncer) для production

**Issue: High Memory Usage**

Symptoms:
```
PostgreSQL process using >1.5GB RAM
```

Solutions:
1. Reduce `shared_buffers` (currently 256MB)
2. Reduce `max_connections` (currently 100)
3. Decrease `work_mem` (currently 4MB)
4. Monitor и kill long-running queries

**Issue: Slow Queries**

Symptoms:
```
Queries taking >5 seconds
```

Solutions:
1. Check missing indexes: `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;`
2. Analyze slow queries: `SELECT * FROM get_slow_queries(10);`
3. Run ANALYZE on tables: `ANALYZE books;`
4. Enable query logging: `log_min_duration_statement = 1000` (already enabled)

### 7.2. Redis Issues

**Issue: Memory Limit Reached**

Symptoms:
```
OOM command not allowed when used memory > 'maxmemory'
```

Solutions:
1. Check `maxmemory-policy` (currently `allkeys-lru`)
2. Reduce TTLs for cached data
3. Increase `maxmemory` limit (if RAM available)
4. Monitor evicted keys: `INFO STATS | grep evicted_keys`

**Issue: High Fragmentation**

Symptoms:
```
mem_fragmentation_ratio > 1.5
```

Solutions:
1. Enable active defragmentation (already enabled)
2. Restart Redis (last resort)
3. Monitor fragmentation: `INFO MEMORY | grep fragmentation`

**Issue: Persistence Lag**

Symptoms:
```
AOF rewrite taking too long
```

Solutions:
1. Check disk I/O: `iostat -x 1`
2. Reduce `auto-aof-rewrite-percentage` (currently 100)
3. Consider RDB-only persistence для staging
4. Monitor: `INFO PERSISTENCE`

## 8. Disaster Recovery

### 8.1. PostgreSQL Recovery

**Restore from Backup:**

```bash
# Stop services
docker-compose down

# Restore database
docker-compose exec postgres pg_restore \
    -U postgres \
    -d bookreader \
    --clean \
    --if-exists \
    /backups/postgresql/backup_bookreader_20251115_020000.dump

# Start services
docker-compose up -d
```

**Point-in-Time Recovery (PITR):**

Requires WAL archiving (disabled in staging):

```conf
# Enable in postgresql.conf
archive_mode = on
archive_command = 'cp %p /mnt/server/archivedir/%f'
```

### 8.2. Redis Recovery

**Restore from RDB:**

```bash
# Stop Redis
docker-compose stop redis

# Copy backup
docker cp /backups/redis/dump.rdb bookreader_redis:/data/dump.rdb

# Start Redis
docker-compose start redis
```

**Restore from AOF:**

```bash
# Stop Redis
docker-compose stop redis

# Copy AOF file
docker cp /backups/redis/appendonly.aof bookreader_redis:/data/appendonly.aof

# Start Redis
docker-compose start redis
```

## 9. Production Recommendations

Когда переходите на более мощный сервер (8GB+ RAM):

### 9.1. PostgreSQL Scaling

1. **Increase shared_buffers to 512MB**
   ```conf
   shared_buffers = 512MB
   ```

2. **Enable connection pooling (PgBouncer)**
   ```yaml
   pgbouncer:
     image: pgbouncer/pgbouncer
     environment:
       DATABASES_HOST: postgres
       POOL_MODE: transaction
       MAX_CLIENT_CONN: 1000
       DEFAULT_POOL_SIZE: 25
   ```

3. **Setup replication для high availability**
   ```yaml
   postgres-replica:
     image: postgres:15-alpine
     environment:
       POSTGRES_MASTER_SERVICE_HOST: postgres
   ```

4. **Enable point-in-time recovery**
   ```conf
   archive_mode = on
   archive_command = 'aws s3 cp %p s3://backups/wal/%f'
   ```

### 9.2. Redis Scaling

1. **Enable Redis Sentinel для failover**
   ```yaml
   redis-sentinel:
     image: redis:7-alpine
     command: redis-sentinel /etc/redis/sentinel.conf
   ```

2. **Setup replication (master-replica)**
   ```yaml
   redis-replica:
     image: redis:7-alpine
     command: redis-server --replicaof redis 6379
   ```

3. **Use Redis Cluster для horizontal scaling**
   ```yaml
   redis-cluster:
     image: redis:7-alpine
     command: redis-server --cluster-enabled yes
   ```

## 10. Checklist

### 10.1. Initial Setup

- [ ] Copy `postgres/postgresql.conf` to server
- [ ] Copy `postgres/init/01-extensions.sql` to server
- [ ] Copy `redis/redis.conf` to server
- [ ] Copy `scripts/backup-database.sh` to server
- [ ] Update `docker-compose.production.yml`
- [ ] Set environment variables in `.env.production`
- [ ] Test backup script: `./scripts/backup-database.sh`
- [ ] Verify PostgreSQL config: `docker exec bookreader_postgres cat /etc/postgresql/postgresql.conf`
- [ ] Verify Redis config: `docker exec bookreader_redis cat /usr/local/etc/redis/redis.conf`

### 10.2. Post-Deployment Verification

- [ ] Check PostgreSQL connections: `SELECT count(*) FROM pg_stat_activity;`
- [ ] Check Redis memory: `redis-cli INFO MEMORY`
- [ ] Verify extensions: `SELECT * FROM pg_extension;`
- [ ] Test slow query logging: `SELECT * FROM get_slow_queries(10);`
- [ ] Monitor cache hit ratio: `SELECT * FROM pg_statio_user_tables;`
- [ ] Setup cron для automated backups
- [ ] Test backup restoration
- [ ] Configure monitoring (Grafana/Prometheus)

### 10.3. Ongoing Maintenance

- [ ] Weekly: Review slow queries
- [ ] Weekly: Check table bloat
- [ ] Weekly: Monitor backup success
- [ ] Monthly: Review autovacuum settings
- [ ] Monthly: Analyze database growth
- [ ] Quarterly: Test disaster recovery procedures
- [ ] Quarterly: Review and optimize indexes

## Appendix

### A. Quick Reference Commands

**PostgreSQL:**
```bash
# Enter PostgreSQL shell
docker exec -it bookreader_postgres psql -U postgres -d bookreader

# Check current connections
SELECT count(*), state FROM pg_stat_activity GROUP BY state;

# Reload configuration
SELECT pg_reload_conf();

# Manual VACUUM
VACUUM ANALYZE books;

# Check database size
SELECT pg_size_pretty(pg_database_size('bookreader'));
```

**Redis:**
```bash
# Enter Redis CLI
docker exec -it bookreader_redis redis-cli -a ${REDIS_PASSWORD}

# Check memory
INFO MEMORY

# Check keyspace
INFO KEYSPACE

# Flush database (DANGEROUS!)
# Note: FLUSHDB and FLUSHALL are disabled in production config

# Monitor commands in real-time
MONITOR
```

**Docker:**
```bash
# View PostgreSQL logs
docker logs -f bookreader_postgres

# View Redis logs
docker logs -f bookreader_redis

# Check resource usage
docker stats bookreader_postgres bookreader_redis

# Restart services
docker-compose restart postgres redis
```

### B. Performance Benchmarks

**Expected Performance (4GB Server):**

| Metric | Target | Measurement |
|--------|--------|-------------|
| PostgreSQL query latency (p95) | <100ms | `SELECT * FROM get_slow_queries(10);` |
| Redis command latency (p95) | <5ms | `INFO COMMANDSTATS` |
| Cache hit ratio (PostgreSQL) | >99% | `pg_statio_user_tables` |
| Cache hit ratio (Redis) | >90% | `keyspace_hits / (keyspace_hits + keyspace_misses)` |
| Connection wait time | <50ms | Monitor pool timeout errors |
| Concurrent users supported | 10-50 | Load testing |

### C. Related Documentation

- [PostgreSQL 15 Official Documentation](https://www.postgresql.org/docs/15/)
- [Redis 7 Configuration Reference](https://redis.io/docs/management/config/)
- [SQLAlchemy Connection Pooling](https://docs.sqlalchemy.org/en/20/core/pooling.html)
- [pg_stat_statements Documentation](https://www.postgresql.org/docs/current/pgstatstatements.html)

---

**Last Updated:** 2025-11-15
**Author:** Database Architect Agent
**Version:** 1.0
