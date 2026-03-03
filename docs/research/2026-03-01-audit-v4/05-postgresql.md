# PostgreSQL: бэкапы и тюнинг

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секции 6, 10

---

## Часть 1: Бэкапы PostgreSQL

### 1.1 Критическая находка

Текущие бэкапы покрывают только `uploaded_books` (EPUB файлы). **База PostgreSQL НЕ бэкапится вообще.** Потеря диска = потеря всех данных пользователей.

### 1.2 Рекомендация: pg_dump через Docker контейнер

**Tier 1 (немедленно, 15 мин setup, $0):**

```yaml
pgbackup:
  image: prodrigestivill/postgres-backup-local:17-alpine
  container_name: bookreader_pgbackup
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    - POSTGRES_HOST=postgres
    - POSTGRES_DB=${DB_NAME}
    - POSTGRES_USER=${DB_USER}
    - POSTGRES_PASSWORD=${DB_PASSWORD}
    - POSTGRES_EXTRA_OPTS=-Z6 --format=custom --blobs
    - SCHEDULE=@daily
    - BACKUP_ON_START=TRUE
    - BACKUP_KEEP_DAYS=7
    - BACKUP_KEEP_WEEKS=4
    - BACKUP_KEEP_MONTHS=6
    - HEALTHCHECK_PORT=8080
    - TZ=Europe/Moscow
  volumes:
    - /root/backups/postgres:/backups
  restart: unless-stopped
```

**Tier 2 (в течение недели, $0):**

- Offsite на **Backblaze B2** или **Cloudflare R2** (10GB бесплатно)
- rclone sync по cron после ежедневного бэкапа

### 1.3 Почему не pgBackRest/Barman

| Решение             | Сложность | Для кого                 | Для fancai              |
| ------------------- | --------- | ------------------------ | ----------------------- |
| pg_dump (контейнер) | 1/5       | Solo dev, малая БД       | **Идеально**            |
| pgBackRest          | 4/5       | DBA, БД 500GB+           | Overkill                |
| Barman              | 4/5       | Enterprise, multi-server | Не подходит             |
| WAL-G               | 3/5       | DevOps, cloud-native     | Следующий шаг при росте |

### 1.4 RPO/RTO

| Метрика                   | Цель     |
| ------------------------- | -------- |
| RPO (макс. потеря данных) | 24 часа  |
| RTO (макс. downtime)      | 1-2 часа |

---

## Часть 2: PostgreSQL тюнинг

### 2.1 Ключевые параметры для 12 vCPU / 32GB / NVMe

```ini
# Memory
shared_buffers = 2GB              # 25% от контейнера (8GB)
effective_cache_size = 6GB        # shared_buffers + OS cache
work_mem = 32MB                   # per-sort per-connection
maintenance_work_mem = 512MB      # VACUUM, CREATE INDEX

# WAL
wal_buffers = 64MB
min_wal_size = 1GB
max_wal_size = 4GB
wal_compression = zstd            # PG17 new

# Checkpoints
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min

# Connections
max_connections = 80

# Parallelism
max_worker_processes = 12
max_parallel_workers = 8
max_parallel_workers_per_gather = 4
max_parallel_maintenance_workers = 4

# NVMe
random_page_cost = 1.1            # vs default 4.0
effective_io_concurrency = 200    # vs default 1
maintenance_io_concurrency = 200

# Autovacuum
autovacuum_max_workers = 4
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = 800

# Extensions
shared_preload_libraries = 'pg_stat_statements,auto_explain'
```

### 2.2 Docker-специфичные настройки

```yaml
postgres:
  image: postgres:17-alpine
  shm_size: "4g" # ОБЯЗАТЕЛЬНО для shared_buffers=2GB
  deploy:
    resources:
      limits:
        cpus: "6.0"
        memory: 10G
      reservations:
        cpus: "2.0"
        memory: 4G
  tmpfs:
    - /var/lib/postgresql/data/pg_stat_tmp:size=256m,uid=70,gid=70
```

### 2.3 Новые индексы

```sql
-- GIN для fuzzy matching сущностей
CREATE INDEX idx_entities_name_gin_trgm ON entities USING GIN (name gin_trgm_ops);

-- BRIN для time-series reading_sessions
CREATE INDEX idx_reading_sessions_started_brin ON reading_sessions
  USING BRIN (started_at) WITH (pages_per_range = 32);

-- Partial для очереди генерации изображений
CREATE INDEX idx_descriptions_pending_images ON descriptions (priority_score DESC)
  WHERE image_generated = FALSE AND is_suitable_for_generation = TRUE;
```

### 2.4 PgBouncer

**Не нужен сейчас.** SQLAlchemy pool_size=20 + max_overflow=40 + Celery ~12 = ~74 соединения. max_connections=80 покрывает это. Добавлять при 200+ пользователях.

---

## Источники

- [prodrigestivill/postgres-backup-local](https://github.com/prodrigestivill/docker-postgres-backup-local)
- [Backblaze B2 Pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [PostgreSQL 17 Release Notes](https://www.postgresql.org/docs/release/17.0/)
- [PGTune Calculator](https://pgtune.leopard.in.ua/)
- [PostgreSQL Docker shm_size](https://www.instaclustr.com/blog/postgresql-docker-and-shared-memory/)
