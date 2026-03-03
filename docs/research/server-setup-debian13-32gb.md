# Server Setup Research: Debian 13 / 32GB RAM / 12 vCPU AMD EPYC / NVMe SSD

**Date:** 2026-03-01
**Target:** Production server for fancai.ru (FastAPI + Celery + PostgreSQL + Redis + Caddy)

---

## 1. Docker Engine on Debian 13

### 1.1 Installation

Debian 13 (Trixie) uses nftables by default. Docker 29+ has experimental native nftables support.

```bash
# Install Docker Engine (official repo)
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 1.2 daemon.json (Production-Ready)

```json
{
  "storage-driver": "overlay2",
  "data-root": "/var/lib/docker",

  "exec-opts": ["native.cgroupdriver=systemd"],

  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5",
    "compress": "true"
  },

  "live-restore": true,
  "shutdown-timeout": 30,

  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 32768 },
    "nproc": { "Name": "nproc", "Hard": 4096, "Soft": 2048 }
  },

  "default-address-pools": [{ "base": "172.80.0.0/16", "size": 24 }],

  "metrics-addr": "127.0.0.1:9323",

  "features": {
    "buildkit": true
  },

  "icc": false
}
```

### 1.3 Storage Driver: overlay2

**Verdict: overlay2 is the only correct choice.**

- overlay2 is the default and recommended storage driver since Docker 18.09.
- On Debian 13 with ext4 or xfs on NVMe, overlay2 performs optimally.
- Alternatives (devicemapper, btrfs, zfs) are either deprecated, slower, or add unnecessary complexity.
- NVMe SSDs benefit from overlay2's efficient copy-on-write mechanism with minimal I/O overhead.

Verify after installation:

```bash
docker info | grep -E "Storage Driver|Backing Filesystem"
# Expected: Storage Driver: overlay2, Backing Filesystem: extfs
```

### 1.4 Log Driver: json-file vs journald

| Aspect              | json-file                    | journald                        |
| ------------------- | ---------------------------- | ------------------------------- |
| Default             | Yes                          | No                              |
| `docker logs` works | Yes                          | Yes                             |
| Log rotation        | Built-in (max-size/max-file) | Managed by systemd-journald     |
| Disk risk           | Low with rotation configured | Low with journald limits        |
| Kubernetes compat   | Required                     | Not compatible                  |
| Performance         | Good                         | Slightly better (binary format) |
| Search/filter       | Basic (via `docker logs`)    | Rich (via `journalctl`)         |

**Verdict: json-file with rotation.** It is the safest default, compatible with all tooling, and log rotation via `max-size`/`max-file` prevents disk exhaustion. The `local` driver is another option (performs rotation by default, uses protobuf internally), but has less ecosystem support.

### 1.5 live-restore

`"live-restore": true` keeps containers running during Docker daemon restarts/upgrades.

**Limitations:**

- Only supported for patch releases (e.g., 27.0.1 -> 27.0.2), NOT major upgrades (27.x -> 28.x).
- Does NOT restore iptables/nftables rules after daemon restart -- networking may break until daemon fully restarts.
- Recommended for production to reduce downtime during daemon updates.

### 1.6 cgroup v2 (Debian 13 default)

Debian 13 uses cgroup v2 exclusively. Docker automatically detects this:

- When systemd is available (always on Debian 13), Docker uses `native.cgroupdriver=systemd` automatically.
- Explicitly setting `"exec-opts": ["native.cgroupdriver=systemd"]` is best practice for clarity.
- No additional configuration needed -- cgroup v2 is fully supported in modern Docker.

### 1.7 Docker Metrics for Prometheus

```json
{
  "metrics-addr": "127.0.0.1:9323"
}
```

- Exposes Prometheus-compatible metrics at `http://127.0.0.1:9323/metrics`.
- Bind to `127.0.0.1` (not `0.0.0.0`) to prevent exposure to the network.
- Add to Prometheus scrape config:
  ```yaml
  - job_name: "docker"
    static_configs:
      - targets: ["127.0.0.1:9323"]
  ```

### 1.8 userns-remap

**Verdict: NOT recommended for this setup.**

Reasons:

- Adds complexity to volume permissions (PostgreSQL data, Redis data, uploaded books).
- Breaks bind mounts that require specific UID/GID ownership.
- Better to enable on a fresh installation, not an existing deployment.
- For this single-tenant server, container isolation via network policies and resource limits is sufficient.
- Alternative: Use `--security-opt=no-new-privileges` per container instead.

### 1.9 Docker Compose: Plugin vs Standalone

**Verdict: Plugin only. Standalone is legacy.**

- Standalone `docker-compose` (Python, v1) reached EOL in July 2023.
- Plugin `docker compose` (Go, v2) ships with Docker Engine and is the only maintained version.
- Significantly faster (Go vs Python).
- Supports Compose Specification, service profiles, GPU access.
- Command: `docker compose` (with space), NOT `docker-compose` (with hyphen).

### 1.10 Docker and nftables Compatibility

Debian 13 uses nftables by default. Three approaches:

**Option A: iptables-nft compatibility layer (RECOMMENDED)**

```bash
# Verify iptables-nft is active (usually default on Debian 13)
iptables --version
# Should show: iptables v1.8.x (nf_tables)

# If not, switch:
update-alternatives --set iptables /usr/sbin/iptables-nft
update-alternatives --set ip6tables /usr/sbin/ip6tables-nft
```

Docker translates iptables calls to nftables rules transparently. Works since Docker 20.10+.

**Option B: Native nftables backend (Docker 29+, EXPERIMENTAL)**

```json
{
  "firewall-backend": "nftables"
}
```

Limitations: No overlay network support, no Swarm mode, Docker won't enable IP forwarding itself.

**Option C: Force iptables-legacy (NOT recommended)**
Downgrade to legacy iptables. Defeats the purpose of nftables migration.

**Recommendation:** Use Option A (iptables-nft). It is transparent, stable, and fully supported.

---

## 2. PostgreSQL 17 Tuning (32GB RAM / 12 vCPU / NVMe)

### 2.1 Complete Configuration

```ini
# =============================================================================
# PostgreSQL 17 — Production Configuration
# Server: 32GB RAM, 12 vCPU AMD EPYC, NVMe SSD
# Workload: FastAPI + Celery (mixed read/write, ~50-100 connections)
# =============================================================================

# --- Memory ---
shared_buffers = 8GB                    # 25% of RAM
effective_cache_size = 24GB             # 75% of RAM (OS page cache estimate)
work_mem = 64MB                         # Per sort/hash operation (careful: multiplied by parallel workers)
maintenance_work_mem = 2GB              # For VACUUM, CREATE INDEX, ALTER TABLE
huge_pages = try                        # Use huge pages if available (see 2.5)

# --- Connections ---
max_connections = 100                   # Sufficient with connection pooling
                                        # FastAPI: 2 workers x 20 pool = 40
                                        # Celery: 2 workers x 10 pool = 20
                                        # Admin/monitoring: 10
                                        # Buffer: 30

# --- WAL ---
wal_compression = zstd                  # PG15+ feature, 30% better than lz4
wal_buffers = 64MB                      # -1 auto-tunes to 1/32 of shared_buffers (256MB), but 64MB is optimal
checkpoint_completion_target = 0.9      # Spread checkpoint I/O over 90% of interval (default since PG17)
max_wal_size = 4GB                      # Allow WAL to grow before forced checkpoint
min_wal_size = 1GB                      # Keep at least this much WAL

# --- NVMe SSD Optimization ---
random_page_cost = 1.1                  # NVMe: random ~= sequential (default 4.0 is for HDD)
seq_page_cost = 1.0                     # Default
effective_io_concurrency = 200          # NVMe can handle high parallelism (default 1)
maintenance_io_concurrency = 200        # Same for VACUUM/CREATE INDEX

# --- Parallelism ---
max_parallel_workers = 12               # Match vCPU count
max_parallel_workers_per_gather = 4     # Per-query parallel workers
max_parallel_maintenance_workers = 4    # For parallel CREATE INDEX, VACUUM
max_worker_processes = 16               # Total background workers (parallel + custom)

# --- Planner ---
default_statistics_target = 200         # More stats for better query plans (default 100)
enable_partitionwise_join = on
enable_partitionwise_aggregate = on

# --- Logging ---
log_min_duration_statement = 1000       # Log queries > 1 second
log_checkpoints = on
log_connections = off                   # Disable in production (noisy)
log_disconnections = off
log_lock_waits = on
log_temp_files = 0                      # Log all temp file usage
log_autovacuum_min_duration = 0         # Log all autovacuum runs

# --- Autovacuum ---
autovacuum_max_workers = 4              # More workers for 12 vCPU
autovacuum_vacuum_scale_factor = 0.05   # Trigger vacuum at 5% dead tuples (default 20%)
autovacuum_analyze_scale_factor = 0.025 # Trigger analyze at 2.5% changes

# --- PG17 New Features ---
# Incremental backup support (must enable for pg_basebackup --incremental)
# summarize_wal = on                   # Enable if using incremental backups
```

### 2.2 Docker Compose Command Translation

```yaml
postgres:
  image: postgres:17-alpine
  command: >
    postgres
    -c shared_buffers=8GB
    -c effective_cache_size=24GB
    -c work_mem=64MB
    -c maintenance_work_mem=2GB
    -c max_connections=100
    -c wal_compression=zstd
    -c wal_buffers=64MB
    -c checkpoint_completion_target=0.9
    -c max_wal_size=4GB
    -c min_wal_size=1GB
    -c random_page_cost=1.1
    -c effective_io_concurrency=200
    -c maintenance_io_concurrency=200
    -c max_parallel_workers=12
    -c max_parallel_workers_per_gather=4
    -c max_parallel_maintenance_workers=4
    -c max_worker_processes=16
    -c default_statistics_target=200
    -c huge_pages=try
    -c autovacuum_max_workers=4
    -c autovacuum_vacuum_scale_factor=0.05
    -c autovacuum_analyze_scale_factor=0.025
    -c log_min_duration_statement=1000
    -c log_checkpoints=on
    -c log_lock_waits=on
    -c log_temp_files=0
    -c log_autovacuum_min_duration=0
```

### 2.3 Current Config vs Recommended

| Parameter                    | Current (8GB server) | Recommended (32GB) | Impact                   |
| ---------------------------- | -------------------- | ------------------ | ------------------------ |
| shared_buffers               | 512MB                | **8GB**            | 16x more cached data     |
| effective_cache_size         | 1GB                  | **24GB**           | Better query plans       |
| work_mem                     | 16MB                 | **64MB**           | Fewer temp files on disk |
| maintenance_work_mem         | 128MB                | **2GB**            | Faster VACUUM/INDEX      |
| max_connections              | 100                  | 100                | Same (use pooling)       |
| random_page_cost             | 1.1                  | 1.1                | Already optimal          |
| effective_io_concurrency     | (default 1)          | **200**            | Massive NVMe improvement |
| max_parallel_workers         | (default 8)          | **12**             | Match vCPU count         |
| wal_compression              | (off)                | **zstd**           | ~30% less WAL volume     |
| wal_buffers                  | (default ~16MB)      | **64MB**           | Better write throughput  |
| checkpoint_completion_target | (default 0.9)        | 0.9                | Already default in PG17  |
| huge_pages                   | (off)                | **try**            | Reduced TLB misses       |

### 2.4 Connection Management: PgBouncer Recommendation

For FastAPI + Celery, consider adding PgBouncer:

```yaml
pgbouncer:
  image: edoburu/pgbouncer:latest
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_USER=${DB_USER}
    - DB_PASSWORD=${DB_PASSWORD}
    - DB_NAME=${DB_NAME}
    - POOL_MODE=transaction
    - MAX_CLIENT_CONN=200
    - DEFAULT_POOL_SIZE=30
    - MIN_POOL_SIZE=5
    - SERVER_LIFETIME=3600
    - SERVER_IDLE_TIMEOUT=600
```

This allows max_connections=100 on PostgreSQL while supporting 200+ application connections via transaction pooling.

### 2.5 Huge Pages Setup

```bash
# Calculate required huge pages for shared_buffers=8GB
# Each huge page = 2MB on x86_64
# 8GB / 2MB = 4096 pages + ~10% overhead = 4500

# Persistent configuration
echo "vm.nr_hugepages = 4500" >> /etc/sysctl.d/30-postgresql.conf
sysctl -p /etc/sysctl.d/30-postgresql.conf

# Verify
grep HugePages /proc/meminfo
# HugePages_Total:    4500
# HugePages_Free:     4500

# CRITICAL: Disable Transparent Huge Pages (THP)
echo 'never' > /sys/kernel/mm/transparent_hugepage/enabled
echo 'never' > /sys/kernel/mm/transparent_hugepage/defrag

# Make persistent via systemd service or kernel cmdline:
# transparent_hugepage=never
```

**Important:** THP (Transparent Huge Pages) is known to cause performance degradation with PostgreSQL due to latency jitter. Always disable THP even when using explicit huge pages.

### 2.6 PG17 New Features Relevant for Tuning

1. **Incremental Backup** -- `pg_basebackup --incremental` backs up only changed blocks using WAL summaries. Requires `summarize_wal = on`.
2. **WAL Compression (zstd)** -- Available since PG15, fully mature in PG17. Reduces WAL by ~30% vs no compression.
3. **Improved parallel query planner** -- PG17 is more aggressive with parallel scans. Ensure `work_mem` and `max_parallel_workers_per_gather` are properly tuned, or some queries may perform worse.
4. **checkpoint_completion_target** -- Default changed to 0.9 in PG17 (was 0.5 in earlier versions).
5. **Async I/O** -- PG17 still uses synchronous I/O. PG18 introduces true async I/O with `io_method = worker` (or `io_uring`). The `effective_io_concurrency` parameter is still important in PG17 for bitmap heap scans.

---

## 3. Redis 7.4 Configuration

### 3.1 Complete Redis Configuration

```conf
# =============================================================================
# Redis 7.4 — Production Configuration
# Server: 32GB RAM total, Redis allocated 768MB container limit
# Usage: Cache (db0) + Celery broker (db1) + Celery results (db2)
# =============================================================================

# --- Memory ---
maxmemory 640mb
maxmemory-policy volatile-lru
# volatile-lru: Evicts LRU keys ONLY among keys with TTL set.
# This protects Celery broker data (no TTL) while evicting cache entries (with TTL).
# CRITICAL: All cache keys MUST have TTL set, or they become un-evictable.

# --- Lazy Freeing (async deletion) ---
lazyfree-lazy-eviction yes
lazyfree-lazy-expire yes
lazyfree-lazy-server-del yes
lazyfree-lazy-user-del yes

# --- Persistence ---
# RDB snapshots (periodic point-in-time saves)
save 900 1          # Save if 1 key changed in 15 minutes
save 300 10         # Save if 10 keys changed in 5 minutes
save 60 10000       # Save if 10000 keys changed in 1 minute

# AOF (append-only file) for durability
appendonly yes
appendfsync everysec           # Fsync once per second (good balance)
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-use-rdb-preamble yes       # Hybrid: RDB preamble + AOF tail (faster loads)

# RDB compression
rdbcompression yes
rdbchecksum yes

# --- Networking ---
tcp-backlog 4096               # High value for burst connections
tcp-keepalive 300              # Detect dead connections
timeout 0                      # No idle timeout (Celery needs persistent connections)

# --- Performance ---
io-threads 4                   # ~75% of available vCPU for Redis container (allocated ~1 vCPU, use 4 threads for burst)
                               # For 768MB container with 0.5 CPU limit, 2-4 is optimal
io-threads-do-reads yes        # Also use threads for reads (not just writes)

# --- Security ---
requirepass ${REDIS_PASSWORD}

# --- Memory Optimization ---
activedefrag yes               # Active defragmentation
active-defrag-enabled yes
hz 10                          # Server frequency (default, increase to 100 for low-latency)
dynamic-hz yes                 # Auto-adjust based on load

# --- Clients ---
maxclients 1000                # Sufficient for FastAPI + Celery + monitoring
```

### 3.2 Docker Compose Command

```yaml
redis:
  image: redis:7.4-alpine
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --maxmemory 640mb
    --maxmemory-policy volatile-lru
    --appendonly yes
    --appendfsync everysec
    --aof-use-rdb-preamble yes
    --save "900 1"
    --save "300 10"
    --save "60 10000"
    --tcp-backlog 4096
    --tcp-keepalive 300
    --io-threads 2
    --io-threads-do-reads yes
    --lazyfree-lazy-eviction yes
    --lazyfree-lazy-expire yes
    --lazyfree-lazy-server-del yes
    --activedefrag yes
    --maxclients 1000
```

### 3.3 Eviction Policy Decision

| Policy       | Cache keys (with TTL)  | Celery broker (no TTL) | Rate limiter (with TTL) | Verdict                     |
| ------------ | ---------------------- | ---------------------- | ----------------------- | --------------------------- |
| allkeys-lru  | Evicted (LRU)          | **ALSO evicted** (!)   | Evicted (LRU)           | RISKY -- can lose task data |
| volatile-lru | Evicted (LRU)          | **Protected**          | Evicted (LRU)           | **BEST for mixed use**      |
| volatile-ttl | Evicted (shortest TTL) | Protected              | Evicted (shortest TTL)  | Also viable                 |
| noeviction   | Error when full        | Protected              | Error when full         | Too aggressive              |

**Current setup uses `allkeys-lru`** -- this is RISKY because Celery task data (without TTL) could be evicted under memory pressure.

**Recommendation: Switch to `volatile-lru`** with the requirement that ALL cache keys and rate limiter keys MUST have TTL set. Celery broker keys (without TTL) will be protected from eviction.

### 3.4 Persistence Strategy

For fancai's mixed-use case (cache + broker + results):

| Strategy             | Data safety | Performance | Disk usage   | Verdict            |
| -------------------- | ----------- | ----------- | ------------ | ------------------ |
| RDB only             | Low (gaps)  | Best        | Small        | Cache-only         |
| AOF only             | High        | Good        | Larger       | Overkill for cache |
| **RDB + AOF hybrid** | **High**    | **Good**    | **Moderate** | **RECOMMENDED**    |
| No persistence       | None        | Best        | None         | Never for broker   |

The hybrid approach (`aof-use-rdb-preamble yes`) combines fast RDB loading with AOF's incremental durability. On restart, Redis loads the RDB preamble quickly, then replays only the recent AOF commands.

### 3.5 Redis 7.4 Specific Features

1. **Hash field expiration** -- Set TTL on individual hash fields (not just the key). Useful for session data where some fields expire before others.
2. **BFLOAT16/FLOAT16 types** -- 47% memory reduction for vector embeddings (relevant if adding vector search later).
3. **Improved memory stats** -- `INFO MEMORY` now shows detailed overhead tracking for database hashtables.
4. **jemalloc for Lua VM** -- Lua scripts now use jemalloc instead of libc, improving memory management.

### 3.6 OS-Level Tuning for Redis

```bash
# Increase TCP backlog to match Redis config
echo "net.core.somaxconn = 4096" >> /etc/sysctl.d/30-redis.conf
echo "net.ipv4.tcp_max_syn_backlog = 4096" >> /etc/sysctl.d/30-redis.conf

# Disable THP (also needed for PostgreSQL)
echo 'never' > /sys/kernel/mm/transparent_hugepage/enabled

# Overcommit memory (Redis background saves fork the process)
echo "vm.overcommit_memory = 1" >> /etc/sysctl.d/30-redis.conf

sysctl -p /etc/sysctl.d/30-redis.conf
```

---

## 4. Caddy v2 as Reverse Proxy

### 4.1 Caddyfile (Production)

```caddyfile
# =============================================================================
# Caddy v2 — Production Reverse Proxy for fancai.ru
# Auto-HTTPS via Let's Encrypt (automatic, zero config)
# =============================================================================

{
    # Global options
    email admin@fancai.ru

    # Performance
    servers {
        protocols h1 h2 h3
    }
}

fancai.ru {
    # Compression: zstd preferred, gzip fallback
    encode zstd gzip

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    # API routes -> FastAPI backend
    handle /api/* {
        reverse_proxy backend:8000 {
            # Health checking
            health_uri /health
            health_interval 30s
            health_timeout 5s

            # Timeouts
            transport http {
                dial_timeout 5s
                response_header_timeout 120s
                read_buffer 8192
                write_buffer 8192
            }

            # Headers
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }

    # WebSocket support (future use)
    handle /ws/* {
        reverse_proxy backend:8000 {
            transport http {
                dial_timeout 5s
            }
        }
    }

    # Static file uploads / storage
    handle /storage/* {
        root * /var/www
        file_server
    }

    # Frontend (React SPA)
    handle {
        reverse_proxy frontend:80 {
            transport http {
                dial_timeout 5s
            }
        }
    }

    # Logging
    log {
        output file /var/log/caddy/access.log {
            roll_size 50MiB
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }
}

# HTTP -> HTTPS redirect (automatic, but explicit for clarity)
http://fancai.ru {
    redir https://fancai.ru{uri} permanent
}
```

### 4.2 Docker Compose Service

```yaml
caddy:
  image: caddy:2-alpine
  container_name: bookreader_caddy
  ports:
    - "80:80"
    - "443:443"
    - "443:443/udp" # HTTP/3 (QUIC)
  volumes:
    - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data # TLS certificates
    - caddy_config:/config # Caddy configuration
    - ./backend/storage:/var/www/storage:ro
    - caddy_logs:/var/log/caddy
  restart: unless-stopped
  networks:
    - bookreader_network
  deploy:
    resources:
      limits:
        cpus: "1.0"
        memory: 256M
      reservations:
        cpus: "0.2"
        memory: 128M
  healthcheck:
    test:
      [
        "CMD",
        "wget",
        "--no-verbose",
        "--tries=1",
        "--spider",
        "http://localhost:80/",
      ]
    interval: 30s
    timeout: 10s
    retries: 3
```

### 4.3 Advantages Over nginx for This Use Case

| Aspect                  | Caddy                                      | nginx                            |
| ----------------------- | ------------------------------------------ | -------------------------------- |
| HTTPS/TLS               | **Automatic** (Let's Encrypt, zero config) | Manual (certbot + cron renewal)  |
| Configuration           | ~30 lines Caddyfile                        | ~150 lines nginx.conf            |
| HTTP/3 (QUIC)           | Built-in                                   | Requires separate module/build   |
| WebSocket proxy         | **Works out of the box**                   | Requires explicit headers        |
| Config reload           | `caddy reload` (graceful)                  | `nginx -s reload`                |
| Certificate renewal     | **Automatic, zero-downtime**               | Requires certbot hook + reload   |
| Performance (raw)       | Slightly lower (Go vs C)                   | Slightly higher                  |
| Performance (practical) | **Equivalent** for <10K req/s              | Equivalent                       |
| Maintenance burden      | **Minimal**                                | Higher (certs, configs, updates) |

**Key advantage for fancai:** Automatic HTTPS with zero maintenance. The current nginx setup requires SSL certificate management, template processing, and more configuration. Caddy eliminates all of that.

### 4.4 WebSocket Proxying

Caddy v2 proxies WebSocket connections transparently -- no special configuration needed. Unlike nginx, there is no need to add `proxy_set_header Upgrade`, `Connection`, etc. The `reverse_proxy` directive handles WebSocket upgrade automatically.

```caddyfile
# This is ALL you need for WebSocket:
handle /ws/* {
    reverse_proxy backend:8000
}
```

### 4.5 Performance Tuning

For a low-to-medium traffic site like fancai.ru:

1. **Compression:** `encode zstd gzip` -- zstd is preferred (better ratio), gzip is fallback for older clients.
2. **HTTP/3:** Enable via `protocols h1 h2 h3` and exposing UDP port 443.
3. **Flush interval:** For API responses, the default buffering is fine. For SSE/streaming, use `flush_interval -1`.
4. **Keep-alive:** Caddy manages keep-alive connections to upstreams automatically.
5. **Buffer sizes:** `read_buffer` and `write_buffer` in transport settings (default 4096, increase to 8192 for larger payloads).

---

## 5. OS-Level Sysctl Tuning

Combined sysctl configuration for the server:

```bash
# /etc/sysctl.d/30-production.conf

# --- Network ---
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.core.netdev_max_backlog = 5000

# --- Memory ---
vm.overcommit_memory = 1           # Required for Redis background saves
vm.swappiness = 1                  # Minimize swap usage (don't set 0, keep 1 for emergencies)
vm.dirty_ratio = 10                # Max % of memory for dirty pages before sync
vm.dirty_background_ratio = 5      # Start flushing dirty pages at 5%

# --- Huge Pages (for PostgreSQL) ---
vm.nr_hugepages = 4500             # 8GB shared_buffers / 2MB page size + overhead

# --- File descriptors ---
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
```

```bash
# /etc/security/limits.d/30-production.conf
* soft nofile 65536
* hard nofile 65536
root soft nofile 65536
root hard nofile 65536
```

---

## Sources

### Docker

- [Docker OverlayFS Storage Driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)
- [Docker Live Restore](https://docs.docker.com/engine/daemon/live-restore/)
- [Docker userns-remap](https://docs.docker.com/engine/security/userns-remap/)
- [Docker nftables](https://docs.docker.com/engine/network/firewall-nftables/)
- [Docker Compose Install](https://docs.docker.com/compose/install)
- [Docker Compose Standalone (Legacy)](https://docs.docker.com/compose/install/standalone/)
- [Docker Logging Drivers](https://docs.docker.com/engine/logging/configure/)
- [Docker Prometheus Metrics](https://docs.docker.com/engine/daemon/prometheus/)
- [Docker daemon.json Configuration Guide (2026)](https://oneuptime.com/blog/post/2026-02-08-how-to-configure-docker-daemon-with-a-custom-daemonjson-file/view)
- [Docker Ulimits for Production (2026)](https://oneuptime.com/blog/post/2026-01-16-docker-ulimits-production/view)
- [Docker Compose Complete Guide 2026](https://devtoolbox.dedyn.io/blog/docker-compose-complete-guide)
- [Installing Docker on Debian with nftables](https://www.naturalborncoder.com/2024/10/installing-docker-on-debian-with-nftables/)
- [How to Use nftables with Docker (2026)](https://oneuptime.com/blog/post/2026-02-08-how-to-use-nftables-with-docker/view)

### PostgreSQL

- [PostgreSQL Wiki: Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)
- [PGTune Calculator](https://pgtune.leopard.in.ua/)
- [PostgreSQL Memory Golden Ratios (2026)](https://www.mytechmantra.com/postgresql/postgresql-performance-tuning-the-golden-ratios-for-memory-configuration/)
- [PostgreSQL Performance Tuning (2026)](https://oneuptime.com/blog/post/2026-02-20-postgresql-performance-tuning/view)
- [PostgreSQL 17 Biggest Upgrade](https://medium.com/@DevBoostLab/postgresql-17-performance-upgrade-2026-f4222e71f577)
- [PostgreSQL 18 Async I/O Benchmarks](https://postgresqlhtx.com/postgresql-18-async-i-o-in-production-real-world-benchmarks-configuration-patterns-and-storage-performance-in-2026/)
- [WAL Compression in PostgreSQL](https://www.percona.com/blog/wal-compression-in-postgresql-and-recent-improvements-in-version-15/)
- [PostgreSQL Huge Pages Configuration](https://stormatics.tech/blogs/configuring-linux-huge-pages-for-postgresql)
- [Huge Pages and PostgreSQL](https://www.cybertec-postgresql.com/en/huge-pages-postgresql/)
- [PG17 Incremental Backup](https://www.enterprisedb.com/blog/why-postgresql-17s-incremental-backup-feature-game-changer)
- [PostgreSQL 17 max_connections Management](https://medium.com/@jramcloud1/postgresql-17-database-administration-mastering-max-connections-and-connection-management-a8c28db60aad)
- [PgBouncer for PostgreSQL](https://www.percona.com/blog/pgbouncer-for-postgresql-how-connection-pooling-solves-enterprise-slowdowns/)

### Redis

- [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis Key Eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis 7.4 What's New](https://redis.io/docs/latest/develop/whats-new/7-4/)
- [Redis 7.4 Community Edition Release Notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisce-7.4-release-notes/)
- [Redis Memory Optimization](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/)
- [Redis Performance Optimization (2026)](https://medium.com/@slow_tech/redis-performance-optimization-must-know-configuration-options-09bf6eeb86b6)
- [Redis Initial Tuning](https://redis.io/learn/operate/redis-at-scale/talking-to-redis/initial-tuning)
- [Redis Cache Eviction Strategies](https://redis.io/blog/cache-eviction-strategies/)
- [Redis RDB vs AOF (2026)](https://oneuptime.com/blog/post/2026-01-27-rdb-vs-aof-persistence-redis/view)

### Caddy

- [Caddy reverse_proxy Documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy Common Caddyfile Patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Caddy encode Directive](https://caddyserver.com/docs/caddyfile/directives/encode)
- [Caddy Global Options](https://caddyserver.com/docs/caddyfile/options)
- [Serving SPAs and API with Caddy v2](https://haykot.dev/blog/serving-spas-and-api-with-caddy-v2/)
- [Caddy vs Nginx Benchmark](https://blog.tjll.net/reverse-proxy-hot-dog-eating-contest-caddy-vs-nginx/)
- [Caddy vs Nginx Comparison](https://selfhosting.sh/compare/caddy-vs-nginx/)
