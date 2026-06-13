# PostgreSQL Configuration для BookReader AI

Этот директория содержит оптимизированные конфигурационные файлы PostgreSQL для production/staging deployment.

## Файлы

### postgresql.conf
Основной конфигурационный файл PostgreSQL, оптимизированный для:
- **4GB RAM server** (staging/development)
- **2 CPU cores**
- **100GB storage**
- **10-50 concurrent users**

**Ключевые оптимизации:**
- `shared_buffers = 256MB` (memory cache)
- `max_connections = 100` (conservative для low-memory)
- `work_mem = 4MB` (per-operation memory)
- `effective_cache_size = 1GB` (OS cache estimate)
- Autovacuum агрессивно настроен для preventing table bloat
- Logging включен для slow queries (>1 second)

### init/01-extensions.sql
Initialization script выполняется при первом запуске PostgreSQL container:
- Создает необходимые extensions (pg_stat_statements, pg_trgm, btree_gin, uuid-ossp)
- Настраивает database settings (timezone, text search config)
- Создает monitoring user (read-only access для Prometheus/Grafana)
- Создает helper functions для мониторинга (get_slow_queries, get_table_sizes, etc.)

## Использование

### Docker Compose Integration

Конфигурация автоматически монтируется в docker-compose.production.yml:

```yaml
postgres:
  volumes:
    - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
    - ./postgres/init:/docker-entrypoint-initdb.d:ro
  command: postgres -c config_file=/etc/postgresql/postgresql.conf
```

### Ручное применение (без Docker)

```bash
# Copy config to PostgreSQL data directory
sudo cp postgresql.conf /var/lib/postgresql/data/postgresql.conf

# Reload configuration
sudo -u postgres psql -c "SELECT pg_reload_conf();"

# Restart PostgreSQL
sudo systemctl restart postgresql
```

## Мониторинг

После инициализации доступны helper functions для мониторинга:

```sql
-- Database size
SELECT * FROM get_database_size();

-- Table sizes with row counts
SELECT * FROM get_table_sizes();

-- Top 10 slow queries
SELECT * FROM get_slow_queries(10);

-- Active connections
SELECT * FROM get_active_connections();

-- Table bloat estimate
SELECT * FROM get_table_bloat();
```

## Настройка для Production

Для более мощного сервера (8GB+ RAM):

```conf
# Increase memory allocation
shared_buffers = 512MB
effective_cache_size = 4GB
work_mem = 8MB
maintenance_work_mem = 128MB

# More connections
max_connections = 200

# Enable replication
wal_level = replica
max_wal_senders = 3
```

## Troubleshooting

**Issue: Config not loaded**
```bash
# Check if config file exists in container
docker exec bookreader_postgres cat /etc/postgresql/postgresql.conf

# Check PostgreSQL logs
docker logs bookreader_postgres
```

**Issue: Permission denied**
```bash
# Ensure config is readable
chmod 644 postgres/postgresql.conf
```

**Issue: Extensions not created**
```bash
# Check init script execution
docker logs bookreader_postgres | grep "extensions.sql"

# Manually run init script
docker exec -i bookreader_postgres psql -U postgres -d bookreader < postgres/init/01-extensions.sql
```

## Документация

Полная документация по оптимизации database:
- [Database Optimization для 4GB Server](../docs/operations/deployment/database-optimization-4gb-server.md)

## Monitoring User

Init script создает `monitoring` user с read-only доступом:

```bash
# Default password (CHANGE IN PRODUCTION!)
Username: monitoring
Password: change_in_production_monitoring

# Change password
docker exec -it bookreader_postgres psql -U postgres -d bookreader -c \
  "ALTER USER monitoring PASSWORD 'new_secure_password';"
```

## Performance Benchmarks

**Expected metrics для 4GB server:**
- Query latency (p95): <100ms
- Cache hit ratio: >99%
- Concurrent connections: 10-50
- Database size: 5-10GB

**Monitoring:**
```sql
-- Cache hit ratio (target >99%)
SELECT
    sum(heap_blks_hit)::NUMERIC /
    nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100
    as cache_hit_ratio
FROM pg_statio_user_tables;

-- Connection count
SELECT count(*) as total, state
FROM pg_stat_activity
WHERE datname = 'bookreader'
GROUP BY state;
```

---

**Last Updated:** 2025-11-15
**Optimized For:** 4GB RAM staging/development environment
