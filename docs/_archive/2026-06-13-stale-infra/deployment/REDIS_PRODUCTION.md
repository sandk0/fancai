# Redis Production Setup - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025
**Redis Version:** 7+

---

## Overview

BookReader AI uses Redis for:
- **Cache**: User sessions, API responses, NLP results
- **Celery Broker**: Task queue management
- **Celery Results**: Task result storage
- **Rate Limiting**: API throttling
- **Pub/Sub**: Real-time notifications

---

## Production Configuration

### Single Instance (MVP)

**`docker-compose.production.yml` (already configured):**

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: bookreader_redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --save 900 1 60 100 10 10000
      --tcp-keepalive 300
      --timeout 0
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    networks:
      - bookreader_network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### Master-Replica with Sentinel (HA)

**`docker-compose.redis-ha.yml`:**

```yaml
services:
  redis-master:
    image: redis:7-alpine
    container_name: redis_master
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --masterauth ${REDIS_PASSWORD}
      --appendonly yes
      --maxmemory 1gb
      --maxmemory-policy allkeys-lru
    volumes:
      - redis_master_data:/data
    networks:
      - bookreader_network

  redis-replica-1:
    image: redis:7-alpine
    container_name: redis_replica_1
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --masterauth ${REDIS_PASSWORD}
      --slaveof redis-master 6379
      --appendonly yes
    depends_on:
      - redis-master
    networks:
      - bookreader_network

  redis-replica-2:
    image: redis:7-alpine
    container_name: redis_replica_2
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --masterauth ${REDIS_PASSWORD}
      --slaveof redis-master 6379
      --appendonly yes
    depends_on:
      - redis-master
    networks:
      - bookreader_network

  redis-sentinel-1:
    image: redis:7-alpine
    container_name: redis_sentinel_1
    command: >
      redis-sentinel /etc/redis/sentinel.conf
    volumes:
      - ./redis/sentinel-1.conf:/etc/redis/sentinel.conf
    networks:
      - bookreader_network

  redis-sentinel-2:
    image: redis:7-alpine
    container_name: redis_sentinel_2
    command: >
      redis-sentinel /etc/redis/sentinel.conf
    volumes:
      - ./redis/sentinel-2.conf:/etc/redis/sentinel.conf
    networks:
      - bookreader_network

  redis-sentinel-3:
    image: redis:7-alpine
    container_name: redis_sentinel_3
    command: >
      redis-sentinel /etc/redis/sentinel.conf
    volumes:
      - ./redis/sentinel-3.conf:/etc/redis/sentinel.conf
    networks:
      - bookreader_network
```

**`redis/sentinel.conf`:**

```conf
port 26379
sentinel monitor mymaster redis-master 6379 2
sentinel auth-pass mymaster ${REDIS_PASSWORD}
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 10000
```

---

## Persistence Strategy

### RDB + AOF (Recommended)

```bash
# RDB Snapshots (fast recovery)
save 900 1      # After 900s if 1 key changed
save 300 10     # After 300s if 10 keys changed
save 60 10000   # After 60s if 10000 keys changed

# AOF (durability)
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec  # Balance between performance and durability

# AOF rewrite
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

---

## Memory Management

### Eviction Policies

```redis
# LRU: Least Recently Used (recommended for cache)
maxmemory-policy allkeys-lru

# Alternative policies:
# - volatile-lru: Evict keys with TTL
# - allkeys-lfu: Least Frequently Used
# - volatile-ttl: Evict keys with shortest TTL
```

### Memory Optimization

```bash
# Check memory usage
redis-cli -a ${REDIS_PASSWORD} INFO memory

# Find large keys
redis-cli -a ${REDIS_PASSWORD} --bigkeys

# Sample memory usage by key pattern
redis-cli -a ${REDIS_PASSWORD} --memkeys
```

---

## Backup and Restore

**Backup script:**

```bash
#!/bin/bash
# scripts/backup-redis.sh

REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD="${REDIS_PASSWORD}"
BACKUP_DIR="/var/backups/redis"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Trigger BGSAVE
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" BGSAVE

# Wait for save to complete
while [ $(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" LASTSAVE) -eq $(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" LASTSAVE) ]; do
    sleep 1
done

# Copy dump file
cp /var/lib/redis/dump.rdb "$BACKUP_DIR/redis_$DATE.rdb"

# Compress
gzip "$BACKUP_DIR/redis_$DATE.rdb"

# Upload to S3 (optional)
aws s3 cp "$BACKUP_DIR/redis_$DATE.rdb.gz" s3://bookreader-backups/redis/

# Clean old backups (keep 7 days)
find "$BACKUP_DIR" -name "redis_*.rdb.gz" -mtime +7 -delete

echo "Redis backup completed: redis_$DATE.rdb.gz"
```

**Restore:**

```bash
# Stop Redis
docker-compose stop redis

# Copy backup to data directory
gunzip -c /var/backups/redis/redis_20251030_020000.rdb.gz > /var/lib/docker/volumes/redis_data/_data/dump.rdb

# Start Redis
docker-compose start redis
```

---

## Monitoring

**Key Metrics:**

```bash
# Memory usage
redis-cli INFO memory | grep used_memory_human

# Hit rate
redis-cli INFO stats | grep keyspace_hits
redis-cli INFO stats | grep keyspace_misses

# Connected clients
redis-cli INFO clients | grep connected_clients

# Operations per second
redis-cli INFO stats | grep instantaneous_ops_per_sec
```

**Prometheus Exporter** (already in MONITORING_SETUP.md)

---

## Troubleshooting

### High Memory Usage

```bash
# Find memory usage by database
redis-cli INFO keyspace

# Find large keys
redis-cli --bigkeys

# Delete keys matching pattern
redis-cli --scan --pattern "cache:old:*" | xargs redis-cli DEL
```

### Slow Queries

```bash
# Enable slow log
redis-cli CONFIG SET slowlog-log-slower-than 10000  # 10ms

# View slow log
redis-cli SLOWLOG GET 10
```

---

## Application Integration

**Python (FastAPI):**

```python
import redis.asyncio as redis
from typing import Optional
import json

class RedisCache:
    def __init__(self, url: str):
        self.redis = redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> Optional[str]:
        return await self.redis.get(key)

    async def set(self, key: str, value: str, ttl: int = 3600):
        await self.redis.setex(key, ttl, value)

    async def delete(self, key: str):
        await self.redis.delete(key)

    async def exists(self, key: str) -> bool:
        return await self.redis.exists(key)

# Usage
cache = RedisCache(os.getenv("REDIS_URL"))

# Cache API response
@router.get("/books/{book_id}")
async def get_book(book_id: str):
    cache_key = f"book:{book_id}"

    # Check cache
    cached = await cache.get(cache_key)
    if cached:
        return json.loads(cached)

    # Fetch from DB
    book = await db.get(book_id)

    # Cache result
    await cache.set(cache_key, json.dumps(book), ttl=3600)

    return book
```

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
