# PostgreSQL Production Setup - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025
**PostgreSQL Version:** 15+

---

## Table of Contents

1. [High Availability Architecture](#high-availability-architecture)
2. [Master-Replica Replication](#master-replica-replication)
3. [Connection Pooling (PgBouncer)](#connection-pooling-pgbouncer)
4. [Performance Tuning](#performance-tuning)
5. [Backup Strategy](#backup-strategy)
6. [Monitoring](#monitoring)
7. [Failover Procedures](#failover-procedures)

---

## High Availability Architecture

```
┌─────────────┐         ┌─────────────┐
│   PgBouncer │         │   PgBouncer │
│   (Pool)    │         │   (Pool)    │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────────┬───────────┘
                   │
           ┌───────▼────────┐
           │   PostgreSQL   │
           │    MASTER      │
           │   (Read/Write) │
           └───────┬────────┘
                   │ Streaming Replication
         ┌─────────┴──────────┐
         │                    │
   ┌─────▼─────┐        ┌─────▼─────┐
   │ Replica 1 │        │ Replica 2 │
   │(Read Only)│        │(Read Only)│
   └───────────┘        └───────────┘
         │                    │
         └─────────┬──────────┘
                   │
            Automated Backups
                   ▼
          ┌────────────────┐
          │  S3 / Backup   │
          │    Storage     │
          └────────────────┘
```

---

## Master-Replica Replication

### 1. Master Configuration

**`postgresql.conf` for Master:**

```ini
# Connection Settings
listen_addresses = '*'
port = 5432
max_connections = 200
superuser_reserved_connections = 3

# Memory Settings
shared_buffers = 4GB                    # 25% of RAM
effective_cache_size = 12GB             # 75% of RAM
work_mem = 10MB                         # RAM / max_connections
maintenance_work_mem = 1GB
wal_buffers = 16MB

# Checkpoint Settings
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB

# Replication Settings
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 2GB
hot_standby = on
hot_standby_feedback = on

# Query Performance
random_page_cost = 1.1                  # For SSD
effective_io_concurrency = 200
default_statistics_target = 100

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_truncate_on_rotation = off
log_rotation_age = 1d
log_rotation_size = 100MB
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_min_duration_statement = 1000       # Log slow queries (>1s)
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_statement = 'ddl'
log_temp_files = 0

# Performance
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
pg_stat_statements.max = 10000
```

**`pg_hba.conf` for Master:**

```conf
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# Local connections
local   all             postgres                                peer
local   all             all                                     md5

# Host connections
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256

# Application connections
host    bookreader      bookreader_app  172.20.0.0/16          scram-sha-256

# Replication connections
host    replication     replicator      172.20.0.0/16          scram-sha-256
host    replication     replicator      <replica-1-ip>/32      scram-sha-256
host    replication     replicator      <replica-2-ip>/32      scram-sha-256
```

### 2. Setup Replication User

```sql
-- On Master
CREATE ROLE replicator WITH REPLICATION PASSWORD 'STRONG_PASSWORD_HERE' LOGIN;

-- Create replication slot for each replica
SELECT * FROM pg_create_physical_replication_slot('replica_1_slot');
SELECT * FROM pg_create_physical_replication_slot('replica_2_slot');

-- Verify slots
SELECT * FROM pg_replication_slots;
```

### 3. Replica Configuration

**Take base backup:**

```bash
# On Replica server
# Stop PostgreSQL if running
systemctl stop postgresql

# Clear data directory
rm -rf /var/lib/postgresql/15/main/*

# Take base backup from master
pg_basebackup \
  -h <master-ip> \
  -U replicator \
  -p 5432 \
  -D /var/lib/postgresql/15/main \
  -Fp \
  -Xs \
  -P \
  -R \
  -S replica_1_slot

# Fix permissions
chown -R postgres:postgres /var/lib/postgresql/15/main
chmod 700 /var/lib/postgresql/15/main
```

**`postgresql.conf` additions for Replica:**

```ini
# Same as master, plus:
hot_standby = on
primary_conninfo = 'host=<master-ip> port=5432 user=replicator password=STRONG_PASSWORD application_name=replica_1'
primary_slot_name = 'replica_1_slot'
promote_trigger_file = '/tmp/postgresql.trigger.5432'
```

**Start replica:**

```bash
systemctl start postgresql

# Verify replication
psql -U postgres -c "SELECT * FROM pg_stat_wal_receiver;"
```

### 4. Verify Replication

**On Master:**

```sql
-- Check replication status
SELECT
    client_addr,
    application_name,
    state,
    sync_state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn) AS pending_bytes,
    pg_wal_lsn_diff(pg_current_wal_lsn(), write_lsn) AS write_lag,
    pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn) AS flush_lag,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag
FROM pg_stat_replication;

-- Check replication lag in seconds
SELECT
    application_name,
    EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds
FROM pg_stat_replication;
```

**On Replica:**

```sql
-- Check if in recovery mode (should be true)
SELECT pg_is_in_recovery();

-- Check last received WAL location
SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();

-- Check replication lag
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

---

## Connection Pooling (PgBouncer)

### 1. PgBouncer Installation

**Docker Compose addition:**

```yaml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer:latest
    container_name: bookreader_pgbouncer
    restart: unless-stopped
    environment:
      - DATABASES_HOST=postgres
      - DATABASES_PORT=5432
      - DATABASES_USER=bookreader_app
      - DATABASES_PASSWORD=${DB_PASSWORD}
      - DATABASES_DBNAME=bookreader
      - PGBOUNCER_POOL_MODE=transaction
      - PGBOUNCER_MAX_CLIENT_CONN=1000
      - PGBOUNCER_DEFAULT_POOL_SIZE=50
      - PGBOUNCER_MIN_POOL_SIZE=10
      - PGBOUNCER_RESERVE_POOL_SIZE=10
      - PGBOUNCER_LISTEN_PORT=6432
    ports:
      - "6432:6432"
    networks:
      - bookreader_network
    depends_on:
      postgres:
        condition: service_healthy
```

### 2. PgBouncer Configuration

**`/etc/pgbouncer/pgbouncer.ini`:**

```ini
[databases]
bookreader = host=postgres port=5432 dbname=bookreader

[pgbouncer]
listen_addr = *
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
admin_users = postgres
stats_users = stats, postgres

# Connection pooling
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 50
min_pool_size = 10
reserve_pool_size = 10
reserve_pool_timeout = 3
max_db_connections = 100
max_user_connections = 100

# Timeouts
server_idle_timeout = 600
server_lifetime = 3600
server_connect_timeout = 15
query_timeout = 0
query_wait_timeout = 120
client_idle_timeout = 0

# Logging
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
application_name_add_host = 1

# Performance
ignore_startup_parameters = extra_float_digits
```

**Update application connection string:**

```bash
# Before (direct connection)
DATABASE_URL=postgresql+asyncpg://user:pass@postgres:5432/bookreader

# After (via PgBouncer)
DATABASE_URL=postgresql+asyncpg://user:pass@pgbouncer:6432/bookreader
```

---

## Performance Tuning

### 1. Index Optimization

**Common indexes for BookReader AI:**

```sql
-- Books table
CREATE INDEX CONCURRENTLY idx_books_user_id ON books(user_id);
CREATE INDEX CONCURRENTLY idx_books_status ON books(processing_status);
CREATE INDEX CONCURRENTLY idx_books_created_at ON books(created_at DESC);

-- Chapters table
CREATE INDEX CONCURRENTLY idx_chapters_book_id ON chapters(book_id);
CREATE INDEX CONCURRENTLY idx_chapters_chapter_number ON chapters(book_id, chapter_number);

-- Descriptions table
CREATE INDEX CONCURRENTLY idx_descriptions_chapter_id ON descriptions(chapter_id);
CREATE INDEX CONCURRENTLY idx_descriptions_type ON descriptions(description_type);
CREATE INDEX CONCURRENTLY idx_descriptions_has_image ON descriptions(has_generated_image) WHERE has_generated_image = true;

-- Generated images
CREATE INDEX CONCURRENTLY idx_generated_images_description_id ON generated_images(description_id);
CREATE INDEX CONCURRENTLY idx_generated_images_status ON generated_images(status);

-- Reading progress
CREATE INDEX CONCURRENTLY idx_reading_progress_user_book ON reading_progress(user_id, book_id);
CREATE INDEX CONCURRENTLY idx_reading_progress_updated_at ON reading_progress(updated_at DESC);

-- Users and subscriptions
CREATE INDEX CONCURRENTLY idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX CONCURRENTLY idx_subscriptions_active ON subscriptions(user_id, is_active) WHERE is_active = true;
```

### 2. Query Analysis

**Enable pg_stat_statements:**

```sql
-- Check if enabled
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';

-- Create extension if not exists
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slow queries
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Reset statistics
SELECT pg_stat_statements_reset();
```

### 3. VACUUM and ANALYZE

**Automated maintenance:**

```sql
-- Configure autovacuum (in postgresql.conf)
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 30s
autovacuum_vacuum_threshold = 50
autovacuum_analyze_threshold = 50
autovacuum_vacuum_scale_factor = 0.1
autovacuum_analyze_scale_factor = 0.05

-- Manual maintenance (if needed)
VACUUM ANALYZE books;
VACUUM FULL ANALYZE descriptions;  -- Requires lock, use sparingly

-- Check last vacuum/analyze times
SELECT
    schemaname,
    relname,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
ORDER BY last_autovacuum DESC NULLS LAST;
```

---

## Backup Strategy

### 1. Automated Backups with pg_dump

**Daily backup script (`scripts/backup-db.sh`):**

```bash
#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/var/backups/postgresql"
DB_HOST="postgres"
DB_NAME="bookreader"
DB_USER="postgres"
RETENTION_DAYS=30
S3_BUCKET="s3://bookreader-backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/bookreader_$DATE.sql.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Dump database
echo "Starting backup: $BACKUP_FILE"
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "$BACKUP_FILE"

# Verify backup
if [ -f "$BACKUP_FILE" ]; then
    echo "Backup created: $(ls -lh $BACKUP_FILE)"

    # Upload to S3
    if command -v aws &> /dev/null; then
        echo "Uploading to S3..."
        aws s3 cp "$BACKUP_FILE" "$S3_BUCKET/daily/"
        echo "Uploaded to S3"
    fi
else
    echo "ERROR: Backup failed!"
    exit 1
fi

# Delete old backups
find "$BACKUP_DIR" -name "bookreader_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "Deleted backups older than $RETENTION_DAYS days"

# Backup metadata
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "\l+" > "$BACKUP_DIR/db_info_$DATE.txt"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "\dt+" > "$BACKUP_DIR/table_info_$DATE.txt"

echo "Backup completed successfully"
```

**Cron job:**

```bash
# Daily at 2 AM
0 2 * * * /opt/bookreader/scripts/backup-db.sh >> /var/log/backup-db.log 2>&1

# Weekly full backup (Sunday 3 AM)
0 3 * * 0 /opt/bookreader/scripts/backup-db-full.sh >> /var/log/backup-db.log 2>&1
```

### 2. Continuous WAL Archiving

**Configure WAL archiving (`postgresql.conf`):**

```ini
# WAL archiving
archive_mode = on
archive_command = 'test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f'
archive_timeout = 300  # Force WAL rotation every 5 minutes
```

**WAL archive script (`scripts/wal-archive-to-s3.sh`):**

```bash
#!/bin/bash
# Archive WAL files to S3 for point-in-time recovery

WAL_ARCHIVE_DIR="/var/lib/postgresql/wal_archive"
S3_BUCKET="s3://bookreader-backups/wal"

# Sync WAL files to S3
aws s3 sync "$WAL_ARCHIVE_DIR" "$S3_BUCKET" --delete

# Delete local WAL files older than 7 days
find "$WAL_ARCHIVE_DIR" -type f -mtime +7 -delete

echo "WAL files archived to S3"
```

### 3. Point-in-Time Recovery (PITR)

**Restore procedure:**

```bash
# 1. Stop PostgreSQL
systemctl stop postgresql

# 2. Backup current data directory
mv /var/lib/postgresql/15/main /var/lib/postgresql/15/main.old

# 3. Restore base backup
mkdir /var/lib/postgresql/15/main
cd /var/lib/postgresql/15/main
gunzip -c /var/backups/postgresql/bookreader_20251030_020000.sql.gz | psql -U postgres

# 4. Create recovery.conf (PostgreSQL 12+: postgresql.auto.conf)
cat > /var/lib/postgresql/15/main/postgresql.auto.conf << EOF
restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
recovery_target_time = '2025-10-30 14:30:00'
recovery_target_action = 'promote'
EOF

# 5. Create recovery signal file
touch /var/lib/postgresql/15/main/recovery.signal

# 6. Fix permissions
chown -R postgres:postgres /var/lib/postgresql/15/main

# 7. Start PostgreSQL
systemctl start postgresql

# 8. Verify recovery
psql -U postgres -c "SELECT pg_is_in_recovery();"
# Should return false when recovery is complete
```

---

## Monitoring

**Key Metrics to Monitor:**

```sql
-- Database size
SELECT
    pg_size_pretty(pg_database_size('bookreader')) AS db_size;

-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- Active connections
SELECT count(*) AS active_connections
FROM pg_stat_activity
WHERE state = 'active';

-- Waiting queries
SELECT count(*) AS waiting_queries
FROM pg_stat_activity
WHERE wait_event IS NOT NULL;

-- Cache hit ratio (should be > 95%)
SELECT
    sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0) * 100 AS cache_hit_ratio
FROM pg_statio_user_tables;

-- Index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

**Prometheus postgres_exporter queries** (already in MONITORING_SETUP.md)

---

## Failover Procedures

### Automatic Failover with Patroni (Advanced)

For production environments requiring automatic failover, consider Patroni:

```yaml
# docker-compose.patroni.yml
services:
  etcd:
    image: quay.io/coreos/etcd:latest
    # ... etcd configuration

  patroni-master:
    image: patroni/patroni:latest
    # ... patroni configuration

  patroni-replica:
    image: patroni/patroni:latest
    # ... patroni configuration
```

### Manual Failover

**Promote replica to master:**

```bash
# 1. Stop writes to master (update DNS or load balancer)

# 2. Wait for replica to catch up
# On replica:
psql -U postgres -c "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();"

# 3. Promote replica to master
pg_ctl promote -D /var/lib/postgresql/15/main

# Or create trigger file:
touch /tmp/postgresql.trigger.5432

# 4. Verify promotion
psql -U postgres -c "SELECT pg_is_in_recovery();"
# Should return false

# 5. Reconfigure old master as replica (when recovered)
# Follow replica setup procedure from step 3
```

---

## Troubleshooting

### High Connection Count

```sql
-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND now() - state_change > interval '10 minutes';

-- Kill long-running queries
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
  AND now() - query_start > interval '1 hour';
```

### Replication Lag

```sql
-- Check lag on master
SELECT application_name, state, sync_state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS byte_lag
FROM pg_stat_replication;

-- Increase wal_keep_size if lag is due to WAL recycling
ALTER SYSTEM SET wal_keep_size = '4GB';
SELECT pg_reload_conf();
```

### Disk Space Issues

```bash
# Check WAL directory
du -sh /var/lib/postgresql/15/main/pg_wal

# Clean old WAL files (if archiving is configured)
pg_archivecleanup /var/lib/postgresql/15/main/pg_wal <oldest-wal-to-keep>

# Vacuum to reclaim space
VACUUM FULL VERBOSE;
```

---

## Maintenance Checklist

**Daily:**
- ✅ Verify backups completed successfully
- ✅ Check replication lag < 10 seconds
- ✅ Monitor connection count < 180

**Weekly:**
- ✅ Review slow queries
- ✅ Check table/index bloat
- ✅ Test backup restoration
- ✅ Review pg_stat_statements

**Monthly:**
- ✅ Update statistics
- ✅ Reindex if needed
- ✅ Review and optimize indexes
- ✅ Capacity planning review

---

## Next Steps

1. **Review**: `REDIS_PRODUCTION.md` for cache layer
2. **Setup**: Automated backups with S3
3. **Configure**: PgBouncer connection pooling
4. **Test**: Failover procedures

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
**Next Review:** November 30, 2025
