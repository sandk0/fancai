# Centralized Logging Setup - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025
**Stack:** Loki + Promtail (Primary), ELK Stack (Alternative)

---

## Table of Contents

1. [Overview](#overview)
2. [Loki + Promtail Setup](#loki--promtail-setup)
3. [ELK Stack Alternative](#elk-stack-alternative)
4. [Log Format Standards](#log-format-standards)
5. [Log Retention Policies](#log-retention-policies)
6. [Querying Logs](#querying-logs)
7. [Common Log Queries](#common-log-queries)

---

## Overview

BookReader AI uses **Loki + Promtail** as the primary logging solution due to:
- Lower resource requirements vs ELK
- Native Grafana integration
- Label-based indexing (cost-effective)
- Excellent performance for log queries

```
┌─────────────┐
│  Services   │
│ (Containers)│
└──────┬──────┘
       │ Logs
       ▼
┌──────────────┐
│   Promtail   │ (Log collector)
└──────┬───────┘
       │ Push logs
       ▼
┌──────────────┐
│     Loki     │ (Log aggregation)
└──────┬───────┘
       │ Query
       ▼
┌──────────────┐
│   Grafana    │ (Visualization)
└──────────────┘
```

---

## Loki + Promtail Setup

### 1. Loki Configuration

**`monitoring/loki/config.yml`:**

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096
  log_level: info

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v12
      index:
        prefix: index_
        period: 24h

storage_config:
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache
  filesystem:
    directory: /loki/chunks

limits_config:
  # Ingestion limits
  ingestion_rate_mb: 15
  ingestion_burst_size_mb: 30
  max_line_size: 256KB
  max_entries_limit_per_query: 10000

  # Retention
  retention_period: 744h  # 31 days

  # Query limits
  max_query_series: 10000
  max_query_parallelism: 32
  max_streams_per_user: 10000
  max_global_streams_per_user: 50000

chunk_store_config:
  max_look_back_period: 744h  # 31 days

table_manager:
  retention_deletes_enabled: true
  retention_period: 744h  # 31 days

compactor:
  working_directory: /loki/compactor
  shared_store: filesystem
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150

query_range:
  align_queries_with_step: true
  max_retries: 5
  parallelise_shardable_queries: true
  cache_results: true

  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 500
        ttl: 24h
```

### 2. Promtail Configuration

**`monitoring/promtail/config.yml`:**

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0
  log_level: info

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push
    timeout: 10s
    backoff_config:
      min_period: 500ms
      max_period: 5m
      max_retries: 10

scrape_configs:
  # Docker container logs
  - job_name: containers
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s

    relabel_configs:
      # Container name as label
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'

      # Service name from compose
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'service'

      # Project name
      - source_labels: ['__meta_docker_container_label_com_docker_compose_project']
        target_label: 'project'

    pipeline_stages:
      # Parse JSON logs from backend
      - json:
          expressions:
            timestamp: time
            level: level
            message: message
            logger: name
            request_id: request_id

      # Extract timestamp
      - timestamp:
          source: timestamp
          format: RFC3339Nano

      # Set log level as label
      - labels:
          level:
          logger:
          request_id:

      # Multiline parsing for stack traces
      - multiline:
          firstline: '^[\d]{4}-[\d]{2}-[\d]{2}'
          max_lines: 500

      # Drop debug logs in production
      - match:
          selector: '{level="DEBUG"}'
          action: drop

  # Nginx access logs
  - job_name: nginx_access
    static_configs:
      - targets:
          - localhost
        labels:
          job: nginx
          type: access
          __path__: /var/log/nginx/access.log

    pipeline_stages:
      # Parse nginx log format
      - regex:
          expression: '^(?P<remote_addr>[\d\.]+) - (?P<remote_user>[^ ]*) \[(?P<time_local>[^\]]*)\] "(?P<method>[A-Z]+) (?P<path>[^ ]*) HTTP/[\d\.]+" (?P<status>[\d]+) (?P<bytes_sent>[\d]+) "(?P<http_referer>[^"]*)" "(?P<user_agent>[^"]*)"'

      # Extract fields as labels
      - labels:
          remote_addr:
          method:
          path:
          status:

      # Parse timestamp
      - timestamp:
          source: time_local
          format: '02/Jan/2006:15:04:05 -0700'

  # Nginx error logs
  - job_name: nginx_error
    static_configs:
      - targets:
          - localhost
        labels:
          job: nginx
          type: error
          __path__: /var/log/nginx/error.log

  # PostgreSQL logs
  - job_name: postgres
    static_configs:
      - targets:
          - localhost
        labels:
          job: postgres
          __path__: /var/lib/postgresql/data/log/*.log

    pipeline_stages:
      - regex:
          expression: '^(?P<timestamp>[\d-]+ [\d:\.]+) \[(?P<pid>[\d]+)\]: \[(?P<session_line>[\d]+)-[\d]+\] user=(?P<user>[^,]*),db=(?P<database>[^,]*),app=(?P<application>[^,]*),client=(?P<client>[^ ]*) (?P<level>[^:]+): (?P<message>.*)'

      - labels:
          level:
          user:
          database:

      - timestamp:
          source: timestamp
          format: '2006-01-02 15:04:05.000 MST'

  # Application logs (file-based)
  - job_name: backend_logs
    static_configs:
      - targets:
          - localhost
        labels:
          job: backend
          __path__: /var/log/bookreader/backend-*.log

    pipeline_stages:
      - json:
          expressions:
            level: level
            timestamp: timestamp
            message: message
            module: module
            request_id: request_id
            user_id: user_id

      - labels:
          level:
          module:
          request_id:

      - timestamp:
          source: timestamp
          format: RFC3339
```

### 3. Docker Compose Integration

Add to `docker-compose.monitoring.yml`:

```yaml
services:
  loki:
    image: grafana/loki:2.9.3
    container_name: bookreader_loki
    restart: unless-stopped
    command: -config.file=/etc/loki/config.yml
    volumes:
      - ./monitoring/loki/config.yml:/etc/loki/config.yml:ro
      - loki_data:/loki
    ports:
      - "3100:3100"
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M

  promtail:
    image: grafana/promtail:2.9.3
    container_name: bookreader_promtail
    restart: unless-stopped
    command: -config.file=/etc/promtail/config.yml
    volumes:
      - ./monitoring/promtail/config.yml:/etc/promtail/config.yml:ro
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - bookreader_network
    depends_on:
      - loki

volumes:
  loki_data:
    driver: local
```

### 4. Grafana Loki Data Source

**Auto-provision (`monitoring/grafana/datasources/loki.yml`):**

```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: false
    jsonData:
      maxLines: 1000
      derivedFields:
        # Link request_id to trace
        - name: TraceID
          matcherRegex: "request_id=(\\w+)"
          url: 'http://localhost:3000/explore?left=["now-1h","now","Tempo",{"query":"$${__value.raw}"}]'
```

---

## ELK Stack Alternative

For organizations requiring advanced log analysis and full-text search:

### 1. ELK Stack Architecture

```
Services → Filebeat → Logstash → Elasticsearch → Kibana
```

### 2. Docker Compose Configuration

**`docker-compose.elk.yml`:**

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    container_name: bookreader_elasticsearch
    environment:
      - discovery.type=single-node
      - "ES_JAVA_OPTS=-Xms1g -Xmx1g"
      - xpack.security.enabled=false
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          memory: 2G

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    container_name: bookreader_logstash
    volumes:
      - ./monitoring/logstash/pipeline:/usr/share/logstash/pipeline:ro
      - ./monitoring/logstash/logstash.yml:/usr/share/logstash/config/logstash.yml:ro
    ports:
      - "5044:5044"
      - "9600:9600"
    networks:
      - bookreader_network
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    container_name: bookreader_kibana
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - "5601:5601"
    networks:
      - bookreader_network
    depends_on:
      - elasticsearch

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.11.0
    container_name: bookreader_filebeat
    user: root
    volumes:
      - ./monitoring/filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - filebeat_data:/usr/share/filebeat/data
    networks:
      - bookreader_network
    depends_on:
      - logstash

volumes:
  elasticsearch_data:
  filebeat_data:
```

### 3. Logstash Pipeline

**`monitoring/logstash/pipeline/logstash.conf`:**

```conf
input {
  beats {
    port => 5044
  }
}

filter {
  # Parse JSON logs
  if [container][labels][com.docker.compose.service] == "backend" {
    json {
      source => "message"
      target => "log"
    }

    date {
      match => ["[log][timestamp]", "ISO8601"]
      target => "@timestamp"
    }

    mutate {
      add_field => {
        "service" => "backend"
        "level" => "%{[log][level]}"
        "logger" => "%{[log][name]}"
      }
    }
  }

  # Parse Nginx logs
  if [container][labels][com.docker.compose.service] == "nginx" {
    grok {
      match => {
        "message" => "%{IPORHOST:remote_addr} - %{DATA:remote_user} \[%{HTTPDATE:time_local}\] \"%{WORD:method} %{DATA:path} HTTP/%{NUMBER:http_version}\" %{NUMBER:status} %{NUMBER:bytes_sent} \"%{DATA:http_referer}\" \"%{DATA:user_agent}\""
      }
    }

    date {
      match => ["time_local", "dd/MMM/yyyy:HH:mm:ss Z"]
      target => "@timestamp"
    }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "bookreader-logs-%{+YYYY.MM.dd}"
  }

  # Debug output
  stdout { codec => rubydebug }
}
```

---

## Log Format Standards

### Backend (Python/FastAPI)

**`backend/app/core/logging_config.py`:**

```python
import logging
import sys
from pythonjsonlogger import jsonlogger
from fastapi import Request
import contextvars

# Context variable for request ID
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar('request_id', default='')

class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter with request context."""

    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)

        # Add standard fields
        log_record['timestamp'] = record.created
        log_record['level'] = record.levelname
        log_record['logger'] = record.name
        log_record['module'] = record.module
        log_record['function'] = record.funcName
        log_record['line'] = record.lineno

        # Add request context if available
        request_id = request_id_var.get()
        if request_id:
            log_record['request_id'] = request_id

        # Add exception info if present
        if record.exc_info:
            log_record['exception'] = self.formatException(record.exc_info)


def setup_logging(log_level: str = "INFO"):
    """Configure application logging."""

    # Create handler
    handler = logging.StreamHandler(sys.stdout)

    # Set formatter
    formatter = CustomJsonFormatter(
        '%(timestamp)s %(level)s %(logger)s %(message)s'
    )
    handler.setFormatter(formatter)

    # Configure root logger
    logging.root.setLevel(log_level)
    logging.root.addHandler(handler)

    # Silence noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


async def logging_middleware(request: Request, call_next):
    """Middleware to add request ID to logs."""
    import uuid

    # Generate or extract request ID
    request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))
    request_id_var.set(request_id)

    # Log request
    logger = logging.getLogger(__name__)
    logger.info(
        "Request received",
        extra={
            'method': request.method,
            'path': request.url.path,
            'client': request.client.host if request.client else None
        }
    )

    try:
        response = await call_next(request)

        # Log response
        logger.info(
            "Request completed",
            extra={
                'status_code': response.status_code
            }
        )

        # Add request ID to response headers
        response.headers['X-Request-ID'] = request_id

        return response
    except Exception as e:
        logger.exception("Request failed", exc_info=e)
        raise
```

**Usage:**

```python
import logging

logger = logging.getLogger(__name__)

# Simple log
logger.info("Book uploaded successfully", extra={
    'book_id': book.id,
    'user_id': user.id,
    'file_size': file.size
})

# Error log with context
try:
    result = process_book(book)
except Exception as e:
    logger.error(
        "Failed to process book",
        exc_info=True,
        extra={
            'book_id': book.id,
            'error_type': type(e).__name__
        }
    )
```

**Example JSON Output:**

```json
{
  "timestamp": 1698764400.123,
  "level": "INFO",
  "logger": "app.services.book_service",
  "module": "book_service",
  "function": "upload_book",
  "line": 145,
  "message": "Book uploaded successfully",
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "book_id": "uuid-here",
  "user_id": "user-uuid",
  "file_size": 1048576
}
```

---

## Log Retention Policies

### Retention Strategy

```yaml
Hot Storage (Fast SSD):
  Duration: 7 days
  Query: Real-time access
  Cost: High
  Use: Recent debugging, live monitoring

Warm Storage (Standard SSD):
  Duration: 8-30 days
  Query: 1-5 second latency
  Cost: Medium
  Use: Recent incidents, weekly reviews

Cold Storage (S3/Glacier):
  Duration: 31-365 days
  Query: Minutes to hours
  Cost: Low
  Use: Compliance, audit trails

Deletion:
  After: 365 days
  Exception: Error logs (2 years)
```

### Loki Retention Configuration

```yaml
# Already in loki config.yml
limits_config:
  retention_period: 744h  # 31 days in hot storage

compactor:
  retention_enabled: true
  retention_delete_delay: 2h  # Grace period before deletion
```

### Archive to S3 (Optional)

**Backup script (`scripts/archive-logs.sh`):**

```bash
#!/bin/bash
# Archive old Loki logs to S3

LOKI_DATA_DIR="/var/lib/docker/volumes/fancai-vibe-hackathon_loki_data/_data"
S3_BUCKET="s3://bookreader-logs-archive"
RETENTION_DAYS=30

# Find chunks older than retention period
find "$LOKI_DATA_DIR/chunks" -type f -mtime +$RETENTION_DAYS -print0 | \
  xargs -0 tar -czf /tmp/loki-archive-$(date +%Y%m%d).tar.gz

# Upload to S3
aws s3 cp /tmp/loki-archive-$(date +%Y%m%d).tar.gz "$S3_BUCKET/"

# Clean up local archive
rm /tmp/loki-archive-$(date +%Y%m%d).tar.gz

# Delete old chunks
find "$LOKI_DATA_DIR/chunks" -type f -mtime +$RETENTION_DAYS -delete

echo "Archived logs older than $RETENTION_DAYS days"
```

**Cron job:**

```bash
# Daily at 2 AM
0 2 * * * /opt/bookreader/scripts/archive-logs.sh >> /var/log/archive-logs.log 2>&1
```

---

## Querying Logs

### Grafana Explore (Loki)

**Access:**
```
http://localhost:3001/explore
```

**LogQL Basics:**

```logql
# All logs from backend service
{service="backend"}

# Filter by log level
{service="backend"} |= "ERROR"
{service="backend"} | json | level="ERROR"

# Search for specific message
{service="backend"} |~ "Failed to.*"

# Specific time range
{service="backend"} [5m]

# Rate of errors
rate({service="backend"} | json | level="ERROR" [5m])

# Count errors by endpoint
sum by (endpoint) (rate({service="backend"} | json | level="ERROR" [5m]))
```

---

## Common Log Queries

### 1. Find Errors in Last Hour

```logql
{service="backend"}
  | json
  | level="ERROR"
  | line_format "{{.timestamp}} {{.message}}"
```

### 2. Track Request by ID

```logql
{service="backend"}
  | json
  | request_id="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 3. Slow Database Queries

```logql
{service="backend"}
  |~ "Query took.*ms"
  | regexp "Query took (?P<duration>\\d+)ms"
  | duration > 1000
```

### 4. Failed Image Generations

```logql
{service="celery-worker"}
  | json
  | task="generate_image"
  | status="failed"
```

### 5. Nginx 5xx Errors

```logql
{job="nginx", type="access"}
  | regexp "HTTP/[\\d\\.]+ (?P<status>5\\d{2})"
```

### 6. Authentication Failures

```logql
{service="backend"}
  |~ "Authentication failed|Invalid credentials"
```

### 7. Top 10 Error Messages

```logql
topk(10,
  sum by (message) (
    rate({service="backend"} | json | level="ERROR" [1h])
  )
)
```

### 8. Request Rate by Endpoint

```logql
sum by (path) (
  rate({job="nginx", type="access"} | regexp "(?P<method>\\w+) (?P<path>/[^ ]*)" [5m])
)
```

---

## Grafana Logs Dashboard

**Create dashboard panels:**

```json
{
  "panels": [
    {
      "title": "Error Rate",
      "targets": [{
        "expr": "sum(rate({service=\"backend\"} | json | level=\"ERROR\" [5m]))"
      }]
    },
    {
      "title": "Recent Errors",
      "targets": [{
        "expr": "{service=\"backend\"} | json | level=\"ERROR\"",
        "refId": "A",
        "maxLines": 100
      }]
    },
    {
      "title": "Request Logs",
      "targets": [{
        "expr": "{service=\"backend\"} |~ \"Request (received|completed)\"",
        "refId": "A"
      }]
    }
  ]
}
```

---

## Log Alerts

**Alert on high error rate (`monitoring/prometheus/alerts/logs.yml`):**

```yaml
groups:
  - name: log_alerts
    interval: 1m
    rules:
      - alert: HighErrorLogRate
        expr: |
          sum(rate({service="backend"} | json | level="ERROR" [5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error log rate"
          description: "Backend producing {{ $value }} errors/sec"

      - alert: CriticalErrorDetected
        expr: |
          count_over_time({service="backend"} |~ "(?i)critical|fatal" [1m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Critical error in logs"
          description: "Critical/fatal error detected in backend logs"
```

---

## Maintenance

**Weekly:**
- Review log volume and costs
- Check for log spikes
- Verify retention policies working

**Monthly:**
- Optimize slow queries from logs
- Review and update log levels
- Check archive integrity

**Quarterly:**
- Review retention policies
- Update log parsing rules
- Audit logging coverage

---

## Troubleshooting

### Issue: Loki disk space full

```bash
# Check disk usage
df -h /var/lib/docker/volumes/fancai-vibe-hackathon_loki_data

# Manually trigger compaction
docker exec bookreader_loki loki -config.file=/etc/loki/config.yml -target=compactor

# Reduce retention period
# Edit monitoring/loki/config.yml:
# retention_period: 168h  # 7 days instead of 31
```

### Issue: Missing logs

```bash
# Check Promtail status
docker logs bookreader_promtail

# Verify Promtail can reach Loki
docker exec bookreader_promtail wget -O- http://loki:3100/ready

# Check Promtail positions file
docker exec bookreader_promtail cat /tmp/positions.yaml
```

### Issue: Slow log queries

```bash
# Check Loki performance
docker stats bookreader_loki

# Reduce query time range
# Use smaller time windows in queries

# Add more specific label filters
{service="backend", level="ERROR"}  # Good
{service="backend"} | level="ERROR"  # Slower
```

---

## Next Steps

1. **Review**: `MONITORING_SETUP.md` for metrics integration
2. **Configure**: Log retention policies
3. **Setup**: Log alerts in Prometheus
4. **Test**: Query logs in Grafana Explore

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
**Next Review:** November 30, 2025
