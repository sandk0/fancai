# Sessions 6-7 Monitoring & Alerting Strategy

**Рекомендации по мониторингу и оповещениям для production deployment**

---

## 📊 Key Metrics to Monitor

### 1. Processing Metrics (NLP Pipeline)

#### F1 Score & Quality Metrics
```
Metric                 Default (S1-5)  Target (S6-7)  Alert Threshold
───────────────────────────────────────────────────────────────
F1 Score Overall       0.87-0.88       0.88-0.90      < 0.85 (ERROR)
F1 Location            0.86            0.88           < 0.84
F1 Character           0.89            0.90           < 0.86
F1 Atmosphere          0.84            0.86           < 0.81
Precision              0.90            0.91           < 0.88
Recall                 0.85            0.87           < 0.83
Descriptions extracted 95/chapter      100/chapter    < 80 (WARNING)
```

**How to track:**
```python
# From API
GET /api/v1/admin/multi-nlp-settings/stats

# From Multi-NLP Manager
from app.services.multi_nlp_manager import multi_nlp_manager
stats = multi_nlp_manager.get_quality_metrics()
print(f"F1 Score: {stats['ensemble_f1_score']}")
print(f"Description Count: {stats['total_descriptions']}")
```

#### Processing Time Metrics
```
Metric                    Target      Warning      Critical
──────────────────────────────────────────────────────
Avg processing time       1.8s        >2.5s        >5s
p95 processing time       2.5s        >3.5s        >7s
p99 processing time       3.0s        >4.5s        >10s
Stanza-only latency       +200ms      >+500ms      >+1000ms
Advanced Parser latency   +1.3s       >+2.0s       >+3.0s
LLM enrichment latency    +2.3s/desc  >+3.5s       >+5.0s
```

**How to track:**
```python
# From logs
docker-compose logs backend | grep "processing_time"

# From metrics
processing_times = manager.processing_statistics['processing_times']
print(f"Avg: {processing_times['avg_time']}s")
print(f"P95: {processing_times.get('p95_time', 'N/A')}s")
```

### 2. System Resource Metrics

#### Memory Usage
```
Component         Normal    Warning   Critical   Action
──────────────────────────────────────────────────
Backend           1-1.5GB   1.8GB     2.0GB+     Investigate
Celery Worker     600-800MB 1.2GB     1.5GB+     Restart
Stanza model      630MB     -         -          (static)
Total system      3-4GB     5.5GB     6.5GB+     Scale up
```

**How to track:**
```bash
# Real-time monitoring
docker stats backend --no-stream

# Memory history
docker-compose exec backend ps aux | grep -E "backend|python"

# Per-process tracking
docker-compose exec backend python -c "
import psutil
backend = psutil.Process()
print(f'Backend Memory: {backend.memory_info().rss / 1024 / 1024:.1f}MB')
print(f'Memory %: {backend.memory_percent():.1f}%')
"
```

#### CPU Usage
```
Component    Idle   Normal  Warning  Critical
─────────────────────────────────────────────
Backend      <5%    5-20%   20-50%   >50%
Worker       <5%    5-15%   15-40%   >40%
Total        <10%   10-30%  30-60%   >60%
```

#### Disk Space
```
Metric              Target    Warning   Critical   Action
─────────────────────────────────────────────────────────
Free disk space     >5GB      2-5GB     <2GB       Clean/Scale
DB volume growth    <100MB/d  >200MB/d  >500MB/d   Investigate
Docker usage        <10GB     15GB      >20GB      Cleanup
```

### 3. Service Availability Metrics

```
Service       Normal     Warning    Critical   SLA
──────────────────────────────────────────────────
Backend       100%       95%+       <95%       99.9%
Database      100%       95%+       <95%       99.9%
Redis         100%       95%+       <95%       99%
Celery        100%       95%+       <95%       95%
```

**How to track:**
```bash
# Health check
curl -s http://localhost:8000/health | jq .status

# Service status
docker-compose ps | awk '{print $1, $6}'

# Uptime tracking
docker inspect backend | jq '.State.StartedAt'
```

### 4. NLP-Specific Metrics

#### Processor Usage Distribution
```
Processor               Expected    Warning    Action
─────────────────────────────────────────────────────
Standard Ensemble      95%+        <90%       Check flags
Advanced Parser        0-5%        >10%       Monitor latency
Stanza usage           ~20-30%     >40%       Optimize
SpaCy usage            ~100%       <90%       Check health
Natasha usage          ~100%       <90%       Check health
```

**How to track:**
```python
stats = manager.processing_statistics
processor_usage = stats['processor_usage']
print(f"Advanced Parser: {processor_usage.get('advanced_parser', 0)}")
print(f"Standard Ensemble: {processor_usage.get('standard_ensemble', 0)}")
```

#### Stanza-Specific Metrics
```
Metric                   Normal      Warning     Critical
──────────────────────────────────────────────────────────
Stanza load time         <5s         5-10s       >10s
Stanza memory            630MB       >700MB      >900MB
Dependency parse quality 0.80-0.85   <0.78       <0.75
Stanza availability      100%        >95%        <95%
```

#### Advanced Parser Metrics
```
Metric                    Normal    Warning   Critical
────────────────────────────────────────────────────
Extraction success rate   100%      98%+      <95%
Descriptions per chapter  100+      80-100    <80
Confidence score avg      0.70      0.60-0.70 <0.60
Premium descriptions %    25-30%    <20%      <15%
Enrichment rate (LLM)     30-40%    <25%      <20%
```

### 5. External API Metrics (Optional LLM)

#### LangExtract / Ollama Metrics
```
Metric                    Target      Warning    Critical
──────────────────────────────────────────────────────
API availability          100%        >95%       <95%
API latency               <2s         2-3s       >3s
API error rate            <1%         1-5%       >5%
Daily API cost            <$5         $5-20      >$20
Monthly budget usage      <30%        30-70%     >70%
```

**How to track:**
```python
from app.services.advanced_parser.extractor import AdvancedDescriptionExtractor

extractor = AdvancedDescriptionExtractor()
if extractor.enricher:
    stats = extractor.enricher.get_statistics()
    print(f"Enrichment available: {extractor.enricher.is_available()}")
    print(f"Last API error: {stats.get('last_error')}")
```

---

## 🚨 Alerting Rules

### Critical Alerts (Immediate Action Required)

```python
# Rule 1: Backend Service Down
if service_health != "healthy" for 1 minute:
    alert("CRITICAL: Backend service is down")
    action: restart_service()

# Rule 2: Out of Memory
if backend_memory_usage > 2.5GB:
    alert("CRITICAL: Backend memory usage critical")
    action: investigate_memory_leak()

# Rule 3: F1 Score Drop
if f1_score < 0.85:
    alert("CRITICAL: F1 score dropped below threshold")
    action: review_recent_changes()

# Rule 4: Processing Time Spike
if avg_processing_time > 5 seconds:
    alert("CRITICAL: Processing time spike detected")
    action: check_system_resources()

# Rule 5: Stanza/Advanced Parser Failures
if processor_error_rate > 5%:
    alert("CRITICAL: Processor error rate elevated")
    action: check_logs_and_fallback()
```

### Warning Alerts (Investigate Soon)

```python
# Rule 1: Memory Approaching Limit
if backend_memory_usage > 1.8GB:
    alert("WARNING: Backend memory approaching limit")
    action: schedule_investigation()

# Rule 2: Processing Time Degradation
if avg_processing_time > 2.5 seconds:
    alert("WARNING: Processing time degradation detected")
    action: check_load()

# Rule 3: API Cost Overrun
if daily_api_cost > $10:
    alert("WARNING: LLM API costs high")
    action: review_enrichment_threshold()

# Rule 4: High Disk Usage
if free_disk_space < 2GB:
    alert("WARNING: Low disk space")
    action: cleanup_old_data()

# Rule 5: Processor Availability
if advanced_parser_availability < 95%:
    alert("WARNING: Advanced Parser availability low")
    action: check_dependencies()
```

### Informational Alerts (Log & Monitor)

```python
# Rule 1: Stanza Model Loading Time
if stanza_load_time > 5s:
    log("INFO: Stanza model took longer to load")

# Rule 2: Advanced Parser Usage
if advanced_parser_usage > 10%:
    log(f"INFO: Advanced Parser usage at {advanced_parser_usage}%")

# Rule 3: Graceful Degradation
if fallback_to_standard_ensemble:
    log(f"INFO: Fallback to standard ensemble (Advanced Parser unavailable)")
```

---

## 📈 Monitoring Dashboard (Prometheus/Grafana)

### Required Metrics Collection

```yaml
# Metrics to export from backend
nlp_f1_score{strategy="standard"}
nlp_f1_score{strategy="advanced"}
nlp_processing_time_seconds{strategy="standard"}
nlp_processing_time_seconds{strategy="advanced"}
nlp_memory_bytes{component="backend"}
nlp_memory_bytes{component="stanza"}
nlp_processor_usage_total{processor="standard_ensemble"}
nlp_processor_usage_total{processor="advanced_parser"}
nlp_stanza_availability{status="enabled"}
nlp_enrichment_rate{enabled="true"}
nlp_enrichment_latency_seconds
nlp_api_cost_usd{service="langextract"}
```

### Dashboard Panels

**Panel 1: F1 Score Trend**
```
Query: nlp_f1_score over time
Range: 7 days
Threshold: 0.85 (red), 0.87 (yellow)
Type: Line chart with annotations
```

**Panel 2: Processing Time Distribution**
```
Queries:
  - nlp_processing_time_seconds (avg, p95, p99)
  - Separate lines for standard vs advanced
Range: 24 hours
Type: Line chart with error bands
```

**Panel 3: Memory Usage**
```
Queries:
  - nlp_memory_bytes[backend]
  - nlp_memory_bytes[stanza]
  - system memory available
Range: 24 hours
Type: Area chart with threshold line (2GB)
```

**Panel 4: Processor Usage**
```
Query: nlp_processor_usage_total
Range: 24 hours
Type: Pie chart / Stacked bar
Labels: standard_ensemble, advanced_parser
```

**Panel 5: Error Rate**
```
Queries:
  - nlp_processing_errors_total
  - nlp_processor_errors{processor="stanza"}
Range: 24 hours
Type: Line chart with threshold
```

**Panel 6: API Costs (if LLM enabled)**
```
Query: nlp_api_cost_usd rate over time
Range: 30 days
Threshold: $5/day (warning), $20/day (critical)
Type: Bar chart with running total
```

---

## 🔍 Log Monitoring Strategy

### Important Log Patterns to Track

```bash
# Session 6: Stanza Loading
docker-compose logs backend | grep -i "stanza"
# Expected: "Stanza model loaded successfully"
# Alert if: "Stanza not found" or "OOMKilled"

# Session 7: Advanced Parser
docker-compose logs backend | grep -i "advanced parser"
# Expected: "Advanced Parser enabled" or "Advanced Parser disabled"
# Alert if: "AdvancedParserAdapter initialization failed"

# Processing errors
docker-compose logs backend | grep -i "error" | grep -i "nlp\|description"
# Alert threshold: >1 error per 100 requests

# Memory warnings
docker-compose logs backend | grep -i "memory\|oom"
# Alert immediately: "OOMKilled" or "out of memory"

# Graceful degradation
docker-compose logs backend | grep -i "fallback\|degraded"
# Track frequency: should be rare (<1%)
```

### ELK Stack Setup (Optional)

```yaml
# docker-compose addition for logging
logstash:
  image: docker.elastic.co/logstash/logstash:8.0.0
  environment:
    - xpack.monitoring.collection.enabled=false
  volumes:
    - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
  depends_on:
    - elasticsearch

elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
  environment:
    - discovery.type=single-node
    - xpack.security.enabled=false

kibana:
  image: docker.elastic.co/kibana/kibana:8.0.0
  ports:
    - "5601:5601"
```

---

## 📱 Alert Delivery Channels

### Recommended Setup

```python
# Multi-channel alerting
alerting_config = {
    "critical": {
        "channels": ["slack", "email", "pagerduty"],
        "response_time": "5 minutes",
        "escalation": True
    },
    "warning": {
        "channels": ["slack", "email"],
        "response_time": "30 minutes",
        "escalation": False
    },
    "info": {
        "channels": ["slack"],
        "response_time": "none",
        "escalation": False
    }
}
```

### Slack Integration Example

```python
# Alert function
async def send_alert(severity: str, message: str, metrics: dict):
    webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    color_map = {"critical": "danger", "warning": "warning", "info": "good"}

    payload = {
        "attachments": [{
            "color": color_map[severity],
            "title": f"{severity.upper()}: {message}",
            "fields": [
                {"title": key, "value": str(val), "short": True}
                for key, val in metrics.items()
            ]
        }]
    }

    await send_webhook(webhook_url, payload)
```

---

## 🎯 Monitoring Checklist

### Initial Setup
- [ ] Prometheus/Grafana или equivalent setup
- [ ] Log aggregation configured (Loki or ELK)
- [ ] Alerting rules created (see above)
- [ ] Dashboard created with key panels
- [ ] Slack/Email/PagerDuty integration tested

### Daily Monitoring
- [ ] Check F1 score trend (should be stable)
- [ ] Monitor processing time (should be <3s avg)
- [ ] Review error logs (should be <1% errors)
- [ ] Check memory usage (should be <2GB)
- [ ] Verify API availability (>99%)

### Weekly Review
- [ ] Analyze F1 score improvements (+1-2% expected)
- [ ] Review processor usage distribution
- [ ] Check for memory leaks (gradual growth = bad)
- [ ] Analyze Advanced Parser effectiveness
- [ ] Review API costs (if LLM enabled)

### Monthly Review
- [ ] Full performance analysis
- [ ] Identify optimization opportunities
- [ ] Plan for scaling if needed
- [ ] Review SLA compliance
- [ ] Update thresholds based on production data

---

## 🔧 Example Monitoring Setup

### docker-compose.yml addition for Prometheus

```yaml
prometheus:
  image: prom/prometheus:latest
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
    - prometheus_data:/prometheus
  ports:
    - "9090:9090"
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.path=/prometheus'
    - '--storage.tsdb.retention.time=30d'

grafana:
  image: grafana/grafana:latest
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
  volumes:
    - grafana_data:/var/lib/grafana
    - ./grafana-dashboards:/etc/grafana/provisioning/dashboards
  ports:
    - "3000:3000"
  depends_on:
    - prometheus
```

### prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'backend'
    static_configs:
      - targets: ['backend:8000']
    metrics_path: '/metrics'

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

---

## 📊 SLA & KPIs

### Service Level Agreement (SLA)

```
Service          Availability Target   Monthly Downtime Budget
──────────────────────────────────────────────────────
Backend          99.9%                 43 minutes
Description Extraction
                 95%                   3.6 hours
Processing Quality
                 F1 > 0.85              N/A (qualitative)
```

### Key Performance Indicators (KPIs)

```
KPI                              Target      Current (After S6-7)
─────────────────────────────────────────────────────
Description extraction success   >95%        >98%
Processing time (avg)            <2.5s       1.8s
F1 score improvement (S6 vs S1-5) +1-2%      +1-2%
System availability              >99.9%      99.9%+
Memory efficiency                <2GB        1.5-2GB
Stanza contribution to F1         +0.5-1%    +0.5-1%
Advanced Parser adoption rate     0-5% (s1)  5-25% (s2)
LLM enrichment quality lift      +3-4%       Depends on API
```

---

**Document Created:** 2025-11-23
**Version:** 1.0
**Status:** Production-Ready
**Audience:** DevOps, SRE, Product Teams
