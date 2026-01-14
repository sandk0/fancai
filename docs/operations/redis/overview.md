# Redis Configuration для BookReader AI

Этот директория содержит оптимизированный конфигурационный файл Redis для production/staging deployment.

## Файлы

### redis.conf
Оптимизированная конфигурация Redis для:
- **4GB RAM server** (staging/development)
- **Memory budget: 256-512MB**
- **10-50 concurrent users**
- **Use cases:** Session storage, Celery queue, API caching, rate limiting

**Ключевые оптимизации:**
- `maxmemory 512mb` (memory limit)
- `maxmemory-policy allkeys-lru` (eviction strategy)
- `appendonly yes` (AOF persistence enabled)
- `appendfsync everysec` (balanced durability)
- `activedefrag yes` (reduce memory fragmentation)
- Security: FLUSHDB/FLUSHALL disabled, password required

## Использование

### Docker Compose Integration

Конфигурация автоматически монтируется в docker-compose.production.yml:

```yaml
redis:
  volumes:
    - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
  command: >
    redis-server /usr/local/etc/redis/redis.conf
    --requirepass ${REDIS_PASSWORD}
```

### Ручное применение (без Docker)

```bash
# Copy config to Redis config directory
sudo cp redis.conf /etc/redis/redis.conf

# Restart Redis
sudo systemctl restart redis

# Or start Redis with custom config
redis-server /path/to/redis.conf
```

## Redis Databases Layout

BookReader AI использует multiple logical databases:

| Database | Purpose | Example Keys | TTL Strategy |
|----------|---------|--------------|--------------|
| db=0 | Session storage | `session:{user_id}` | 7 days |
| db=1 | Celery broker | `celery-task-meta-{id}` | 1 day |
| db=2 | Celery results | `celery-task-result-{id}` | 1 hour |
| db=3 | API caching | `api:books:{user_id}` | 5 minutes |
| db=4 | Rate limiting | `ratelimit:{ip}:{endpoint}` | 1 minute |

## Memory Optimization

**Data Structure Settings:**

```conf
# Hash optimization (session objects)
hash-max-ziplist-entries 512
hash-max-ziplist-value 64

# List optimization (Celery queues)
list-max-ziplist-size -2

# Set optimization
set-max-intset-entries 512

# Sorted Set optimization
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
```

**Active Defragmentation:**

```conf
activedefrag yes
active-defrag-threshold-lower 10   # Start at 10% fragmentation
active-defrag-threshold-upper 100
active-defrag-cycle-min 5          # CPU usage: 5-75%
active-defrag-cycle-max 75
```

## Persistence Strategy

### RDB Snapshots (Point-in-time backups)

```conf
# Automatic snapshots
save 900 1      # After 15 min if ≥1 key changed
save 300 10     # After 5 min if ≥10 keys changed
save 60 10000   # After 1 min if ≥10k keys changed

# Files
dbfilename dump.rdb
dir /data
rdbcompression yes
rdbchecksum yes
```

### AOF (Append-Only File - more durable)

```conf
appendonly yes
appendfilename appendonly.aof
appendfsync everysec                # Sync every second (balanced)
auto-aof-rewrite-percentage 100     # Rewrite when file doubles
auto-aof-rewrite-min-size 64mb      # Minimum size to trigger rewrite
```

**Backup Strategy:**
- RDB: fast snapshots для quick recovery
- AOF: detailed log для minimal data loss (<1 second)
- Hybrid: RDB preamble in AOF для best of both worlds

## Security

**Password Protection:**

```bash
# Set password via environment variable
REDIS_PASSWORD=your_secure_password_here

# Password in docker-compose.yml
command: redis-server /usr/local/etc/redis/redis.conf --requirepass ${REDIS_PASSWORD}
```

**Disabled Dangerous Commands:**

```conf
rename-command FLUSHDB ""      # Completely disabled
rename-command FLUSHALL ""     # Completely disabled
rename-command CONFIG "CONFIG_4dM1n_0nLy_S3cR3t"  # Renamed to secret
```

**Change Password:**

```bash
# Via docker-compose
docker exec -it bookreader_redis redis-cli -a ${REDIS_PASSWORD} CONFIG SET requirepass new_password

# Or edit .env.production
REDIS_PASSWORD=new_secure_password
docker-compose restart redis
```

## Мониторинг

### Memory Usage

```bash
# Check memory stats
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} INFO MEMORY

# Key metrics:
# - used_memory_human: current memory usage
# - maxmemory_human: memory limit
# - mem_fragmentation_ratio: fragmentation (should be <1.5)
```

**Example Output:**
```
used_memory_human:245.67M
maxmemory_human:512.00M
mem_fragmentation_ratio:1.12
```

### Keyspace Statistics

```bash
# Check database sizes
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} INFO KEYSPACE

# Example output:
# db0:keys=1523,expires=1200,avg_ttl=604800000
# db1:keys=45,expires=45,avg_ttl=86400000
```

### Cache Hit Rate

```bash
# Calculate hit rate
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} INFO STATS | grep keyspace

# Formula: hit_rate = keyspace_hits / (keyspace_hits + keyspace_misses)
# Target: >90% hit rate
```

### Slow Log

```bash
# Check slow queries (>10ms)
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} SLOWLOG GET 10

# Configure threshold (microseconds)
CONFIG SET slowlog-log-slower-than 10000  # 10ms
```

### Current Connections

```bash
# Check connected clients
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} INFO CLIENTS

# Example output:
# connected_clients:12
# client_recent_max_input_buffer:8
```

### Real-time Monitoring

```bash
# Monitor all commands in real-time (CAUTION: verbose)
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} MONITOR

# Monitor specific database
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} -n 0 MONITOR
```

## Performance Tuning

### Eviction Policy

**Current:** `allkeys-lru` (Least Recently Used)

**Alternatives:**

```conf
# For pure cache (no persistence needed)
maxmemory-policy allkeys-lru        # Current setting

# For mix of cache + persistent data
maxmemory-policy volatile-lru       # Only evict keys with TTL

# For frequency-based eviction
maxmemory-policy allkeys-lfu        # Least Frequently Used

# For time-based eviction
maxmemory-policy volatile-ttl       # Evict keys with shortest TTL
```

### Network Optimization

```conf
# Connection timeout (close idle clients)
timeout 300                         # 5 minutes

# TCP keepalive
tcp-keepalive 300                   # Send ACKs every 5 min

# Max clients
maxclients 1000                     # Conservative для staging
```

### Latency Optimization

```conf
# Latency monitoring
latency-monitor-threshold 100       # Log events causing >100ms latency

# Check latency events
LATENCY DOCTOR
LATENCY HISTORY command
```

## Troubleshooting

### Issue: OOM (Out of Memory)

**Symptoms:**
```
OOM command not allowed when used memory > 'maxmemory'
```

**Solutions:**

1. Check memory usage:
```bash
redis-cli -a ${REDIS_PASSWORD} INFO MEMORY
```

2. Check eviction stats:
```bash
redis-cli -a ${REDIS_PASSWORD} INFO STATS | grep evicted
```

3. Increase maxmemory (if RAM available):
```conf
maxmemory 768mb  # Increase from 512mb
```

4. Optimize eviction policy:
```conf
maxmemory-policy volatile-lru  # Only evict keys with TTL
```

5. Reduce TTLs для cached data:
```python
redis.setex(key, 300, value)  # 5 min instead of 1 hour
```

### Issue: High Fragmentation

**Symptoms:**
```
mem_fragmentation_ratio: 2.5  # >1.5 is problematic
```

**Solutions:**

1. Enable active defragmentation (already enabled):
```conf
activedefrag yes
```

2. Monitor defragmentation progress:
```bash
redis-cli -a ${REDIS_PASSWORD} INFO MEMORY | grep defrag
```

3. Manual defragmentation (last resort):
```bash
# Restart Redis (causes downtime)
docker-compose restart redis
```

### Issue: Slow Persistence

**Symptoms:**
```
AOF rewrite taking >30 seconds
```

**Solutions:**

1. Check disk I/O:
```bash
docker stats bookreader_redis
iostat -x 1
```

2. Reduce AOF rewrite frequency:
```conf
auto-aof-rewrite-percentage 200    # Increase from 100
auto-aof-rewrite-min-size 128mb    # Increase from 64mb
```

3. Consider RDB-only для staging:
```conf
appendonly no                      # Disable AOF
save 900 1                         # Keep RDB snapshots
```

### Issue: Connection Timeouts

**Symptoms:**
```
Connection to Redis server lost
```

**Solutions:**

1. Check TCP keepalive:
```conf
tcp-keepalive 300                  # Already enabled
```

2. Increase timeout:
```conf
timeout 600                        # Increase from 300
```

3. Check network:
```bash
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} PING
```

## Backup and Recovery

### Manual Backup

**RDB Snapshot:**
```bash
# Trigger manual snapshot
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} BGSAVE

# Copy snapshot from container
docker cp bookreader_redis:/data/dump.rdb /backups/redis/dump.rdb
```

**AOF File:**
```bash
# Trigger AOF rewrite
docker exec bookreader_redis redis-cli -a ${REDIS_PASSWORD} BGREWRITEAOF

# Copy AOF from container
docker cp bookreader_redis:/data/appendonly.aof /backups/redis/appendonly.aof
```

### Restore from Backup

**RDB Restore:**
```bash
# Stop Redis
docker-compose stop redis

# Copy backup to container
docker cp /backups/redis/dump.rdb bookreader_redis:/data/dump.rdb

# Start Redis
docker-compose start redis
```

**AOF Restore:**
```bash
# Stop Redis
docker-compose stop redis

# Copy backup to container
docker cp /backups/redis/appendonly.aof bookreader_redis:/data/appendonly.aof

# Start Redis
docker-compose start redis
```

## Production Recommendations

Для более мощного сервера (8GB+ RAM):

### 1. Increase Memory

```conf
maxmemory 2gb                      # Increase from 512mb
```

### 2. Enable Replication

```yaml
# docker-compose.yml
redis-replica:
  image: redis:7-alpine
  command: >
    redis-server
    --replicaof redis 6379
    --masterauth ${REDIS_PASSWORD}
    --requirepass ${REDIS_PASSWORD}
```

### 3. Setup Sentinel (High Availability)

```yaml
redis-sentinel:
  image: redis:7-alpine
  command: redis-sentinel /etc/redis/sentinel.conf
  volumes:
    - ./redis/sentinel.conf:/etc/redis/sentinel.conf:ro
```

### 4. Use Redis Cluster (Horizontal Scaling)

```yaml
redis-cluster:
  image: redis:7-alpine
  command: >
    redis-server
    --cluster-enabled yes
    --cluster-config-file nodes.conf
    --cluster-node-timeout 5000
```

## Документация

Полная документация по оптимизации database:
- [Database Optimization для 4GB Server](../docs/operations/deployment/database-optimization-4gb-server.md)

## Performance Benchmarks

**Expected metrics для 4GB server:**
- Command latency (p95): <5ms
- Cache hit rate: >90%
- Memory usage: ~250-400MB (из 512MB limit)
- Concurrent clients: 10-50

**Monitoring:**
```bash
# Latency test
redis-cli -a ${REDIS_PASSWORD} --latency

# Continuous stats
redis-cli -a ${REDIS_PASSWORD} --stat

# Big keys detection
redis-cli -a ${REDIS_PASSWORD} --bigkeys
```

---

**Last Updated:** 2025-11-15
**Optimized For:** 4GB RAM staging/development environment
