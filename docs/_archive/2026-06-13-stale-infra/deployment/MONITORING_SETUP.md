# Monitoring & Observability Setup - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Prometheus Configuration](#prometheus-configuration)
3. [Grafana Dashboards](#grafana-dashboards)
4. [Alerting Rules](#alerting-rules)
5. [Application Metrics](#application-metrics)
6. [Database Monitoring](#database-monitoring)
7. [Redis Monitoring](#redis-monitoring)
8. [Error Tracking (Sentry)](#error-tracking-sentry)
9. [Uptime Monitoring](#uptime-monitoring)
10. [Performance Monitoring](#performance-monitoring)

---

## Overview

BookReader AI monitoring stack provides comprehensive observability across all system components:

```
┌─────────────────────────────────────────────────────┐
│                  Grafana (Port 3001)                │
│           Dashboards + Alerting + Visualization     │
└────────────────┬────────────────────────────────────┘
                 │
    ┌────────────┴────────────┬───────────────┐
    │                         │               │
┌───▼──────┐         ┌────────▼─────┐   ┌────▼──────┐
│Prometheus│         │     Loki     │   │  Sentry   │
│ (Metrics)│         │    (Logs)    │   │ (Errors)  │
│Port 9090 │         │  Port 3100   │   │  Cloud    │
└────┬─────┘         └────────┬─────┘   └───────────┘
     │                        │
     │  ┌─────────────────────┤
     │  │                     │
┌────▼──▼──┐  ┌──────────┐  ┌▼────────┐
│ Exporters│  │ Promtail │  │ App Logs│
├──────────┤  └──────────┘  └─────────┘
│- Node    │
│- cAdvisor│
│- Postgres│
│- Redis   │
│- Backend │
└──────────┘
```

### Key Metrics Tracked

**Application Metrics:**
- Request rate (RPS)
- Response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Active users
- API endpoint performance

**Infrastructure Metrics:**
- CPU usage
- Memory usage
- Disk I/O
- Network traffic
- Container stats

**Database Metrics:**
- Connection pool status
- Query performance
- Cache hit ratio
- Replication lag (if applicable)

**Business Metrics:**
- Books uploaded
- Images generated
- Active subscriptions
- User engagement

---

## Prometheus Configuration

### 1. Main Configuration

**`monitoring/prometheus/prometheus.yml`:**

```yaml
# Global settings
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'bookreader-production'
    environment: 'production'

# Alertmanager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - 'alertmanager:9093'

# Alert rules
rule_files:
  - '/etc/prometheus/alerts/*.yml'

# Scrape configurations
scrape_configs:
  # Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # Backend API metrics
  - job_name: 'backend'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['backend:8000']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+)(?::\d+)?'
        replacement: '$1'

  # Node Exporter (system metrics)
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']
    relabel_configs:
      - source_labels: [__address__]
        target_label: hostname

  # cAdvisor (container metrics)
  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']
    metric_relabel_configs:
      # Keep only necessary container metrics
      - source_labels: [__name__]
        regex: 'container_(cpu|memory|network|fs).*'
        action: keep

  # PostgreSQL Exporter
  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  # Redis Exporter
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  # Nginx Exporter
  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx-exporter:9113']
    metrics_path: '/metrics'

  # Celery Exporter
  - job_name: 'celery'
    static_configs:
      - targets: ['celery-exporter:9808']
```

### 2. PostgreSQL Exporter

Add to `docker-compose.monitoring.yml`:

```yaml
services:
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    container_name: bookreader_postgres_exporter
    restart: unless-stopped
    environment:
      DATA_SOURCE_NAME: "postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}?sslmode=disable"
      PG_EXPORTER_EXTEND_QUERY_PATH: "/etc/postgres-exporter/queries.yaml"
    volumes:
      - ./monitoring/postgres-exporter/queries.yaml:/etc/postgres-exporter/queries.yaml:ro
    ports:
      - "9187:9187"
    networks:
      - bookreader_network
```

**Custom Queries (`monitoring/postgres-exporter/queries.yaml`):**

```yaml
# Database size
pg_database:
  query: "SELECT pg_database.datname, pg_database_size(pg_database.datname) as size_bytes FROM pg_database"
  master: true
  metrics:
    - datname:
        usage: "LABEL"
        description: "Name of the database"
    - size_bytes:
        usage: "GAUGE"
        description: "Size of the database in bytes"

# Table sizes
pg_table_size:
  query: |
    SELECT
      schemaname,
      tablename,
      pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  master: true
  metrics:
    - schemaname:
        usage: "LABEL"
    - tablename:
        usage: "LABEL"
    - size_bytes:
        usage: "GAUGE"

# Connection stats
pg_stat_database_connections:
  query: |
    SELECT
      datname,
      numbackends as connections,
      xact_commit as transactions_committed,
      xact_rollback as transactions_rolled_back,
      blks_read as blocks_read,
      blks_hit as blocks_hit,
      tup_returned as tuples_returned,
      tup_fetched as tuples_fetched
    FROM pg_stat_database
    WHERE datname IS NOT NULL
  master: true
  metrics:
    - datname:
        usage: "LABEL"
    - connections:
        usage: "GAUGE"
    - transactions_committed:
        usage: "COUNTER"
    - transactions_rolled_back:
        usage: "COUNTER"
    - blocks_read:
        usage: "COUNTER"
    - blocks_hit:
        usage: "COUNTER"
    - tuples_returned:
        usage: "COUNTER"
    - tuples_fetched:
        usage: "COUNTER"

# Slow queries
pg_slow_queries:
  query: |
    SELECT
      count(*) as count
    FROM pg_stat_activity
    WHERE state = 'active'
      AND now() - query_start > interval '5 seconds'
  master: true
  metrics:
    - count:
        usage: "GAUGE"
        description: "Number of queries running longer than 5 seconds"

# Replication lag (for replicas)
pg_replication_lag:
  query: |
    SELECT
      COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())), 0) as lag_seconds
  master: false
  metrics:
    - lag_seconds:
        usage: "GAUGE"
        description: "Replication lag in seconds"
```

### 3. Redis Exporter

Add to `docker-compose.monitoring.yml`:

```yaml
services:
  redis-exporter:
    image: oliver006/redis_exporter:latest
    container_name: bookreader_redis_exporter
    restart: unless-stopped
    environment:
      REDIS_ADDR: "redis:6379"
      REDIS_PASSWORD: "${REDIS_PASSWORD}"
    ports:
      - "9121:9121"
    networks:
      - bookreader_network
```

### 4. Nginx Exporter

Add to `docker-compose.monitoring.yml`:

```yaml
services:
  nginx-exporter:
    image: nginx/nginx-prometheus-exporter:latest
    container_name: bookreader_nginx_exporter
    restart: unless-stopped
    command:
      - '-nginx.scrape-uri=http://nginx:8080/stub_status'
    ports:
      - "9113:9113"
    networks:
      - bookreader_network
```

**Nginx stub_status configuration:**

Add to `nginx.conf`:

```nginx
server {
    listen 8080;
    server_name localhost;
    location /stub_status {
        stub_status;
        access_log off;
        allow 127.0.0.1;
        allow 172.16.0.0/12;  # Docker network
        deny all;
    }
}
```

---

## Grafana Dashboards

### 1. Provisioning Configuration

**`monitoring/grafana/provisioning/dashboards.yml`:**

```yaml
apiVersion: 1

providers:
  - name: 'BookReader AI'
    orgId: 1
    folder: 'Production'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
```

### 2. Main System Dashboard

**`monitoring/grafana/dashboards/system-overview.json`:**

```json
{
  "dashboard": {
    "title": "BookReader AI - System Overview",
    "uid": "bookreader-system",
    "tags": ["bookreader", "production", "overview"],
    "timezone": "browser",
    "refresh": "30s",
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{endpoint}}"
          }
        ]
      },
      {
        "title": "Response Time (p95)",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p50"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "5xx errors"
          },
          {
            "expr": "rate(http_requests_total{status=~\"4..\"}[5m])",
            "legendFormat": "4xx errors"
          }
        ]
      },
      {
        "title": "Active Users",
        "type": "stat",
        "gridPos": {"h": 8, "w": 6, "x": 12, "y": 8},
        "targets": [
          {
            "expr": "active_users_total"
          }
        ]
      },
      {
        "title": "API Success Rate",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 6, "x": 18, "y": 8},
        "targets": [
          {
            "expr": "100 * (1 - (rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])))"
          }
        ],
        "options": {
          "min": 0,
          "max": 100,
          "thresholds": [
            {"value": 0, "color": "red"},
            {"value": 95, "color": "yellow"},
            {"value": 99, "color": "green"}
          ]
        }
      },
      {
        "title": "CPU Usage",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
        "targets": [
          {
            "expr": "100 - (avg by(instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
            "legendFormat": "{{instance}}"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
        "targets": [
          {
            "expr": "(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100",
            "legendFormat": "Memory %"
          }
        ]
      },
      {
        "title": "Disk Usage",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 24},
        "targets": [
          {
            "expr": "(node_filesystem_size_bytes{mountpoint=\"/\"} - node_filesystem_avail_bytes{mountpoint=\"/\"}) / node_filesystem_size_bytes{mountpoint=\"/\"} * 100",
            "legendFormat": "Disk %"
          }
        ]
      },
      {
        "title": "Network Traffic",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 24},
        "targets": [
          {
            "expr": "rate(node_network_receive_bytes_total[5m])",
            "legendFormat": "Receive"
          },
          {
            "expr": "rate(node_network_transmit_bytes_total[5m])",
            "legendFormat": "Transmit"
          }
        ]
      }
    ]
  }
}
```

### 3. Database Dashboard

**`monitoring/grafana/dashboards/database.json`:**

```json
{
  "dashboard": {
    "title": "BookReader AI - Database",
    "uid": "bookreader-database",
    "tags": ["bookreader", "postgresql", "database"],
    "refresh": "30s",
    "panels": [
      {
        "title": "Database Connections",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "targets": [
          {
            "expr": "pg_stat_database_connections{datname=\"bookreader\"}",
            "legendFormat": "Active connections"
          }
        ],
        "alert": {
          "conditions": [
            {
              "evaluator": {"params": [180], "type": "gt"},
              "operator": {"type": "and"},
              "query": {"params": ["A", "5m", "now"]},
              "reducer": {"params": [], "type": "avg"},
              "type": "query"
            }
          ],
          "name": "High database connections"
        }
      },
      {
        "title": "Query Performance",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "targets": [
          {
            "expr": "rate(pg_stat_database_xact_commit[5m])",
            "legendFormat": "Commits/sec"
          },
          {
            "expr": "rate(pg_stat_database_xact_rollback[5m])",
            "legendFormat": "Rollbacks/sec"
          }
        ]
      },
      {
        "title": "Cache Hit Ratio",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 8, "x": 0, "y": 8},
        "targets": [
          {
            "expr": "100 * (pg_stat_database_blks_hit / (pg_stat_database_blks_hit + pg_stat_database_blks_read))"
          }
        ],
        "options": {
          "min": 0,
          "max": 100,
          "thresholds": [
            {"value": 0, "color": "red"},
            {"value": 90, "color": "yellow"},
            {"value": 95, "color": "green"}
          ]
        }
      },
      {
        "title": "Database Size",
        "type": "stat",
        "gridPos": {"h": 8, "w": 8, "x": 8, "y": 8},
        "targets": [
          {
            "expr": "pg_database_size_bytes{datname=\"bookreader\"}"
          }
        ],
        "options": {
          "unit": "bytes"
        }
      },
      {
        "title": "Slow Queries",
        "type": "stat",
        "gridPos": {"h": 8, "w": 8, "x": 16, "y": 8},
        "targets": [
          {
            "expr": "pg_slow_queries_count"
          }
        ]
      },
      {
        "title": "Replication Lag",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
        "targets": [
          {
            "expr": "pg_replication_lag_lag_seconds",
            "legendFormat": "Lag (seconds)"
          }
        ]
      },
      {
        "title": "Table Sizes (Top 10)",
        "type": "table",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
        "targets": [
          {
            "expr": "topk(10, pg_table_size_size_bytes)",
            "format": "table",
            "instant": true
          }
        ]
      }
    ]
  }
}
```

### 4. Redis Dashboard

**`monitoring/grafana/dashboards/redis.json`:**

```json
{
  "dashboard": {
    "title": "BookReader AI - Redis",
    "uid": "bookreader-redis",
    "tags": ["bookreader", "redis", "cache"],
    "refresh": "30s",
    "panels": [
      {
        "title": "Memory Usage",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "targets": [
          {
            "expr": "redis_memory_used_bytes",
            "legendFormat": "Used"
          },
          {
            "expr": "redis_memory_max_bytes",
            "legendFormat": "Max"
          }
        ]
      },
      {
        "title": "Commands per Second",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "targets": [
          {
            "expr": "rate(redis_commands_processed_total[5m])",
            "legendFormat": "Commands/sec"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 8, "x": 0, "y": 8},
        "targets": [
          {
            "expr": "100 * (redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total))"
          }
        ],
        "options": {
          "min": 0,
          "max": 100,
          "thresholds": [
            {"value": 0, "color": "red"},
            {"value": 70, "color": "yellow"},
            {"value": 90, "color": "green"}
          ]
        }
      },
      {
        "title": "Connected Clients",
        "type": "stat",
        "gridPos": {"h": 8, "w": 8, "x": 8, "y": 8},
        "targets": [
          {
            "expr": "redis_connected_clients"
          }
        ]
      },
      {
        "title": "Evicted Keys",
        "type": "stat",
        "gridPos": {"h": 8, "w": 8, "x": 16, "y": 8},
        "targets": [
          {
            "expr": "rate(redis_evicted_keys_total[5m])"
          }
        ]
      },
      {
        "title": "Keys by Database",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
        "targets": [
          {
            "expr": "redis_db_keys",
            "legendFormat": "DB {{db}}"
          }
        ]
      },
      {
        "title": "Network I/O",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
        "targets": [
          {
            "expr": "rate(redis_net_input_bytes_total[5m])",
            "legendFormat": "Input"
          },
          {
            "expr": "rate(redis_net_output_bytes_total[5m])",
            "legendFormat": "Output"
          }
        ]
      }
    ]
  }
}
```

### 5. Application Dashboard

**`monitoring/grafana/dashboards/application.json`:**

```json
{
  "dashboard": {
    "title": "BookReader AI - Application",
    "uid": "bookreader-app",
    "tags": ["bookreader", "application", "business"],
    "refresh": "1m",
    "panels": [
      {
        "title": "Books Uploaded (24h)",
        "type": "stat",
        "gridPos": {"h": 6, "w": 6, "x": 0, "y": 0},
        "targets": [
          {
            "expr": "increase(books_uploaded_total[24h])"
          }
        ]
      },
      {
        "title": "Images Generated (24h)",
        "type": "stat",
        "gridPos": {"h": 6, "w": 6, "x": 6, "y": 0},
        "targets": [
          {
            "expr": "increase(images_generated_total[24h])"
          }
        ]
      },
      {
        "title": "Active Subscriptions",
        "type": "stat",
        "gridPos": {"h": 6, "w": 6, "x": 12, "y": 0},
        "targets": [
          {
            "expr": "active_subscriptions_total"
          }
        ]
      },
      {
        "title": "Revenue (24h)",
        "type": "stat",
        "gridPos": {"h": 6, "w": 6, "x": 18, "y": 0},
        "targets": [
          {
            "expr": "increase(revenue_rub_total[24h])"
          }
        ],
        "options": {
          "unit": "currencyRUB"
        }
      },
      {
        "title": "API Endpoints Performance",
        "type": "table",
        "gridPos": {"h": 10, "w": 24, "x": 0, "y": 6},
        "targets": [
          {
            "expr": "topk(10, avg by(endpoint) (http_request_duration_seconds_sum / http_request_duration_seconds_count))",
            "format": "table",
            "instant": true
          }
        ]
      },
      {
        "title": "Celery Queue Length",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
        "targets": [
          {
            "expr": "celery_queue_length",
            "legendFormat": "{{queue}}"
          }
        ]
      },
      {
        "title": "Celery Task Processing Time",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(celery_task_duration_seconds_bucket[5m]))",
            "legendFormat": "p95 - {{task}}"
          }
        ]
      },
      {
        "title": "NLP Processing Time",
        "type": "graph",
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 24},
        "targets": [
          {
            "expr": "rate(nlp_processing_duration_seconds_sum[5m]) / rate(nlp_processing_duration_seconds_count[5m])",
            "legendFormat": "{{processor}}"
          }
        ]
      },
      {
        "title": "Image Generation Success Rate",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 24},
        "targets": [
          {
            "expr": "100 * (rate(images_generated_success_total[5m]) / rate(images_generated_total[5m]))"
          }
        ],
        "options": {
          "min": 0,
          "max": 100,
          "thresholds": [
            {"value": 0, "color": "red"},
            {"value": 90, "color": "yellow"},
            {"value": 95, "color": "green"}
          ]
        }
      }
    ]
  }
}
```

---

## Alerting Rules

### 1. Alert Configuration

**`monitoring/prometheus/alerts/bookreader.yml`:**

```yaml
groups:
  - name: bookreader_alerts
    interval: 30s
    rules:
      # High Error Rate
      - alert: HighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.01
        for: 5m
        labels:
          severity: critical
          component: backend
        annotations:
          summary: "High API error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"
          runbook: "https://docs.bookreader.ai/runbooks/high-error-rate"

      # Slow Response Time
      - alert: SlowResponseTime
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 0.5
        for: 10m
        labels:
          severity: warning
          component: backend
        annotations:
          summary: "API response time is slow"
          description: "p95 response time is {{ $value }}s (threshold: 0.5s)"

      # High CPU Usage
      - alert: HighCPUUsage
        expr: |
          100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 10m
        labels:
          severity: warning
          component: infrastructure
        annotations:
          summary: "High CPU usage on {{ $labels.instance }}"
          description: "CPU usage is {{ $value }}% (threshold: 80%)"

      # High Memory Usage
      - alert: HighMemoryUsage
        expr: |
          (
            (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)
            /
            node_memory_MemTotal_bytes
          ) * 100 > 90
        for: 5m
        labels:
          severity: critical
          component: infrastructure
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is {{ $value }}% (threshold: 90%)"

      # Disk Space Low
      - alert: DiskSpaceLow
        expr: |
          (
            (node_filesystem_size_bytes{mountpoint="/"} - node_filesystem_avail_bytes{mountpoint="/"})
            /
            node_filesystem_size_bytes{mountpoint="/"}
          ) * 100 > 80
        for: 5m
        labels:
          severity: warning
          component: infrastructure
        annotations:
          summary: "Low disk space on {{ $labels.instance }}"
          description: "Disk usage is {{ $value }}% (threshold: 80%)"

      # Database Connection Pool Exhausted
      - alert: DatabaseConnectionPoolExhausted
        expr: pg_stat_database_connections{datname="bookreader"} > 180
        for: 5m
        labels:
          severity: critical
          component: database
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "{{ $value }} connections active (max: 200)"

      # Database Replication Lag
      - alert: DatabaseReplicationLag
        expr: pg_replication_lag_lag_seconds > 60
        for: 5m
        labels:
          severity: warning
          component: database
        annotations:
          summary: "Database replication lag detected"
          description: "Replication lag is {{ $value }}s (threshold: 60s)"

      # Redis Memory High
      - alert: RedisMemoryHigh
        expr: |
          (redis_memory_used_bytes / redis_memory_max_bytes) * 100 > 90
        for: 5m
        labels:
          severity: warning
          component: cache
        annotations:
          summary: "Redis memory usage high"
          description: "Redis using {{ $value }}% of max memory (threshold: 90%)"

      # Celery Queue Length High
      - alert: CeleryQueueLengthHigh
        expr: celery_queue_length > 1000
        for: 10m
        labels:
          severity: warning
          component: workers
        annotations:
          summary: "Celery queue {{ $labels.queue }} is backed up"
          description: "Queue length is {{ $value }} (threshold: 1000)"

      # Service Down
      - alert: ServiceDown
        expr: up{job=~"backend|postgres|redis"} == 0
        for: 2m
        labels:
          severity: critical
          component: infrastructure
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "{{ $labels.instance }} has been down for more than 2 minutes"

      # SSL Certificate Expiring
      - alert: SSLCertificateExpiring
        expr: |
          (ssl_certificate_expiry_seconds - time()) / 86400 < 30
        for: 1h
        labels:
          severity: warning
          component: infrastructure
        annotations:
          summary: "SSL certificate expiring soon"
          description: "Certificate expires in {{ $value }} days"
```

### 2. Alertmanager Configuration

**`monitoring/alertmanager/config.yml`:**

```yaml
global:
  resolve_timeout: 5m
  slack_api_url: '${SLACK_WEBHOOK_URL}'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'default'
  routes:
    # Critical alerts to PagerDuty + Slack
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      continue: true

    - match:
        severity: critical
      receiver: 'slack-critical'

    # Warning alerts to Slack only
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'default'
    slack_configs:
      - channel: '#bookreader-alerts'
        title: 'BookReader AI Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}'

  - name: 'slack-critical'
    slack_configs:
      - channel: '#bookreader-critical'
        title: ':fire: CRITICAL: {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}'
        color: 'danger'

  - name: 'slack-warnings'
    slack_configs:
      - channel: '#bookreader-alerts'
        title: ':warning: Warning: {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}'
        color: 'warning'

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_SERVICE_KEY}'
        description: '{{ .GroupLabels.alertname }}: {{ .CommonAnnotations.summary }}'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'instance']
```

---

## Application Metrics

### 1. FastAPI Metrics Integration

**`backend/app/core/metrics.py`:**

```python
from prometheus_client import Counter, Histogram, Gauge, Info
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request, Response
import time

# Request metrics
http_requests_total = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

http_request_duration_seconds = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint'],
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0]
)

# Business metrics
books_uploaded_total = Counter(
    'books_uploaded_total',
    'Total books uploaded',
    ['format']
)

images_generated_total = Counter(
    'images_generated_total',
    'Total images generated',
    ['service', 'status']
)

active_users_total = Gauge(
    'active_users_total',
    'Current active users'
)

active_subscriptions_total = Gauge(
    'active_subscriptions_total',
    'Current active subscriptions',
    ['tier']
)

# NLP metrics
nlp_processing_duration_seconds = Histogram(
    'nlp_processing_duration_seconds',
    'NLP processing duration',
    ['processor', 'mode'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)

# Celery metrics
celery_queue_length = Gauge(
    'celery_queue_length',
    'Celery queue length',
    ['queue']
)

celery_task_duration_seconds = Histogram(
    'celery_task_duration_seconds',
    'Celery task duration',
    ['task'],
    buckets=[1, 5, 10, 30, 60, 120, 300]
)

# Application info
app_info = Info('bookreader_app', 'Application information')
app_info.info({
    'version': '1.0.0',
    'environment': 'production'
})


async def prometheus_middleware(request: Request, call_next):
    """Middleware to track request metrics."""
    start_time = time.time()

    # Process request
    response = await call_next(request)

    # Record metrics
    duration = time.time() - start_time
    endpoint = request.url.path
    method = request.method
    status = response.status_code

    http_requests_total.labels(
        method=method,
        endpoint=endpoint,
        status=status
    ).inc()

    http_request_duration_seconds.labels(
        method=method,
        endpoint=endpoint
    ).observe(duration)

    return response


async def metrics_endpoint():
    """Prometheus metrics endpoint."""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )
```

**Add to `main.py`:**

```python
from app.core.metrics import prometheus_middleware, metrics_endpoint

# Add middleware
app.middleware("http")(prometheus_middleware)

# Add metrics endpoint
@app.get("/metrics")
async def metrics():
    return await metrics_endpoint()
```

### 2. Custom Metrics Usage

```python
from app.core.metrics import (
    books_uploaded_total,
    images_generated_total,
    nlp_processing_duration_seconds
)

# Track book upload
@router.post("/books")
async def upload_book(file: UploadFile):
    # ... upload logic ...
    books_uploaded_total.labels(format=file_format).inc()
    return {"id": book.id}

# Track image generation
@celery_app.task
def generate_image(description: str):
    start = time.time()
    try:
        image_url = pollinations_service.generate(description)
        images_generated_total.labels(
            service="pollinations",
            status="success"
        ).inc()
        return image_url
    except Exception as e:
        images_generated_total.labels(
            service="pollinations",
            status="failed"
        ).inc()
        raise
    finally:
        duration = time.time() - start

# Track NLP processing
@celery_app.task
def process_text_nlp(text: str):
    start = time.time()
    result = nlp_manager.process(text, mode="ensemble")
    duration = time.time() - start
    nlp_processing_duration_seconds.labels(
        processor="ensemble",
        mode="ensemble"
    ).observe(duration)
    return result
```

---

## Error Tracking (Sentry)

### 1. Backend Integration

**Install Sentry SDK:**

```bash
pip install sentry-sdk[fastapi]
```

**Configure (`backend/app/core/sentry.py`):**

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.redis import RedisIntegration
from sentry_sdk.integrations.celery import CeleryIntegration
import os

def init_sentry():
    """Initialize Sentry error tracking."""
    sentry_dsn = os.getenv("SENTRY_DSN")

    if not sentry_dsn:
        return

    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        release=os.getenv("VERSION", "1.0.0"),

        # Integrations
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            RedisIntegration(),
            CeleryIntegration(),
        ],

        # Performance monitoring
        traces_sample_rate=0.1,  # 10% of transactions

        # Error sampling
        sample_rate=1.0,  # 100% of errors

        # Additional context
        attach_stacktrace=True,
        send_default_pii=False,  # Don't send PII

        # Before send hook
        before_send=filter_errors,
    )


def filter_errors(event, hint):
    """Filter out certain errors before sending to Sentry."""
    # Don't send 404 errors
    if event.get("exception"):
        exc_value = event["exception"]["values"][0]
        if "404" in str(exc_value.get("value", "")):
            return None

    # Add custom tags
    event.setdefault("tags", {})
    event["tags"]["region"] = os.getenv("AWS_REGION", "unknown")

    return event
```

**Initialize in `main.py`:**

```python
from app.core.sentry import init_sentry

# Initialize Sentry
init_sentry()

app = FastAPI(title="BookReader AI")
```

### 2. Frontend Integration

**Install Sentry SDK:**

```bash
npm install @sentry/react @sentry/tracing
```

**Configure (`frontend/src/sentry.ts`):**

```typescript
import * as Sentry from "@sentry/react";
import { BrowserTracing } from "@sentry/tracing";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || "1.0.0",

    integrations: [
      new BrowserTracing(),
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    beforeSend(event) {
      // Filter out non-errors
      if (event.level === "info") {
        return null;
      }
      return event;
    },
  });
}
```

**Initialize in `main.tsx`:**

```typescript
import { initSentry } from "./sentry";

initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## Uptime Monitoring

### External Uptime Monitoring Services

**Recommended: UptimeRobot (Free tier):**

```yaml
Monitors:
  1. HTTPS Monitor:
     URL: https://bookreader.ai
     Interval: 5 minutes
     Alert: Email + Slack

  2. API Health Check:
     URL: https://bookreader.ai/api/health
     Interval: 5 minutes
     Expected Response: 200

  3. WebSocket Check:
     URL: wss://bookreader.ai/ws
     Interval: 10 minutes
```

### Internal Health Checks

**`backend/app/routers/health.py`:**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.redis import redis_client
import httpx

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
async def health_check():
    """Basic health check."""
    return {"status": "healthy", "timestamp": time.time()}

@router.get("/detailed")
async def detailed_health_check(db: AsyncSession = Depends(get_db)):
    """Detailed health check with dependencies."""
    health = {
        "status": "healthy",
        "checks": {}
    }

    # Database check
    try:
        await db.execute("SELECT 1")
        health["checks"]["database"] = "healthy"
    except Exception as e:
        health["checks"]["database"] = f"unhealthy: {e}"
        health["status"] = "unhealthy"

    # Redis check
    try:
        await redis_client.ping()
        health["checks"]["redis"] = "healthy"
    except Exception as e:
        health["checks"]["redis"] = f"unhealthy: {e}"
        health["status"] = "unhealthy"

    # External API check (pollinations.ai)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://pollinations.ai/health",
                timeout=5.0
            )
            if response.status_code == 200:
                health["checks"]["pollinations"] = "healthy"
            else:
                health["checks"]["pollinations"] = f"unhealthy: {response.status_code}"
    except Exception as e:
        health["checks"]["pollinations"] = f"unhealthy: {e}"

    return health
```

---

## Performance Monitoring

### Application Performance Monitoring (APM)

**Option 1: Elastic APM**

```python
from elasticapm.contrib.starlette import make_apm_client, ElasticAPM

apm = make_apm_client({
    'SERVICE_NAME': 'bookreader-api',
    'SERVER_URL': os.getenv('ELASTIC_APM_SERVER_URL'),
    'SECRET_TOKEN': os.getenv('ELASTIC_APM_SECRET_TOKEN'),
    'ENVIRONMENT': os.getenv('ENVIRONMENT', 'production'),
})

app.add_middleware(ElasticAPM, client=apm)
```

**Option 2: New Relic**

```python
import newrelic.agent
newrelic.agent.initialize('/app/newrelic.ini')

@newrelic.agent.background_task()
def background_task():
    # Your task
    pass
```

---

## Deployment

**Start Monitoring Stack:**

```bash
# Production
docker-compose -f docker-compose.production.yml \
               -f docker-compose.monitoring.yml \
               up -d

# Verify all services running
docker-compose ps

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Access Grafana
open http://localhost:3001
# Login: admin / ${GRAFANA_PASSWORD}
```

**Import Dashboards:**

```bash
# Dashboards auto-loaded from:
monitoring/grafana/dashboards/*.json
```

---

## Maintenance

**Weekly:**
- Review dashboard metrics
- Check alert noise (false positives)
- Verify backup systems

**Monthly:**
- Review retention policies
- Optimize slow queries from metrics
- Update alert thresholds based on trends

**Quarterly:**
- Review and update dashboards
- Performance baseline updates
- Capacity planning review

---

## Next Steps

1. **Setup Logging**: See `LOGGING_SETUP.md`
2. **Configure Alerts**: Customize alert thresholds
3. **Setup Sentry**: Add DSN to environment variables
4. **Test Alerts**: Trigger test alerts to verify notification channels

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
**Next Review:** November 30, 2025
