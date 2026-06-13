# Disaster Recovery Plan - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025
**RTO:** 4 hours | **RPO:** 24 hours

---

## Overview

### Recovery Objectives

- **RTO (Recovery Time Objective):** 4 hours - Maximum acceptable downtime
- **RPO (Recovery Point Objective):** 24 hours - Maximum acceptable data loss
- **MTD (Maximum Tolerable Downtime):** 24 hours

### Disaster Scenarios

1. **Hardware Failure** - Server crash, disk failure
2. **Data Corruption** - Database corruption, file system errors
3. **Human Error** - Accidental deletion, misconfiguration
4. **Security Incident** - Ransomware, data breach
5. **Natural Disaster** - Data center outage

---

## Backup Strategy

### 1. Database Backups

**Schedule:**
- **Full Backup:** Daily at 2 AM (pg_dump)
- **Incremental:** Continuous WAL archiving
- **Retention:** 30 days local + 365 days S3

**Script:** `scripts/backup-db.sh` (see DATABASE_PRODUCTION.md)

**Verification:**
```bash
# Test restore weekly
scripts/test-db-restore.sh
```

### 2. File Storage Backups

**Books and Images:**

```bash
#!/bin/bash
# scripts/backup-storage.sh

STORAGE_DIR="./backend/storage"
BACKUP_DIR="/var/backups/storage"
S3_BUCKET="s3://bookreader-backups/storage"
DATE=$(date +%Y%m%d_%H%M%S)

# Sync to backup directory
rsync -av --delete "$STORAGE_DIR/" "$BACKUP_DIR/"

# Create tarball
tar -czf "/tmp/storage_$DATE.tar.gz" -C "$BACKUP_DIR" .

# Upload to S3
aws s3 cp "/tmp/storage_$DATE.tar.gz" "$S3_BUCKET/"

# Clean up
rm "/tmp/storage_$DATE.tar.gz"

echo "Storage backup completed"
```

### 3. Redis Backups

**Script:** `scripts/backup-redis.sh` (see REDIS_PRODUCTION.md)

**Schedule:**
- **RDB Snapshot:** Every 6 hours
- **AOF:** Continuous
- **Retention:** 7 days

### 4. Configuration Backups

```bash
#!/bin/bash
# scripts/backup-config.sh

CONFIG_FILES=(
    "docker-compose.production.yml"
    "docker-compose.monitoring.yml"
    ".env.production"
    "nginx/nginx.prod.conf"
    "monitoring/prometheus/prometheus.yml"
    "monitoring/grafana/datasources/"
)

tar -czf "/tmp/config_$(date +%Y%m%d).tar.gz" "${CONFIG_FILES[@]}"
aws s3 cp "/tmp/config_$(date +%Y%m%d).tar.gz" s3://bookreader-backups/config/
```

---

## Recovery Procedures

### Scenario 1: Complete Server Failure

**Estimated Recovery Time:** 2-4 hours

**Prerequisites:**
- Backup server ready (same specs)
- S3 access configured
- DNS/domain access

**Steps:**

```bash
# 1. Provision new server
# - Ubuntu 22.04
# - Docker + Docker Compose installed
# - Network configured

# 2. Clone repository
git clone https://github.com/your-org/bookreader.git
cd bookreader

# 3. Restore configuration
aws s3 cp s3://bookreader-backups/config/config_latest.tar.gz .
tar -xzf config_latest.tar.gz

# 4. Restore .env file (from secure backup)
cp .env.production.backup .env.production

# 5. Restore database
# Download latest backup
aws s3 cp s3://bookreader-backups/daily/bookreader_latest.sql.gz .

# Start PostgreSQL
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
sleep 30

# Restore database
gunzip -c bookreader_latest.sql.gz | docker exec -i bookreader_postgres psql -U postgres -d bookreader

# 6. Restore storage files
aws s3 sync s3://bookreader-backups/storage/ ./backend/storage/

# 7. Restore Redis (optional, cache will rebuild)
aws s3 cp s3://bookreader-backups/redis/redis_latest.rdb.gz .
gunzip redis_latest.rdb.gz
docker-compose up -d redis
docker cp redis_latest.rdb bookreader_redis:/data/dump.rdb
docker-compose restart redis

# 8. Start all services
docker-compose -f docker-compose.production.yml up -d

# 9. Verify services
docker-compose ps
curl https://your-domain.com/health

# 10. Update DNS (if IP changed)
# Point domain to new server IP

# 11. Monitor for 1 hour
docker-compose logs -f
```

### Scenario 2: Database Corruption

**Estimated Recovery Time:** 1-2 hours

```bash
# 1. Stop application
docker-compose stop backend celery-worker

# 2. Backup current (corrupted) database
docker exec bookreader_postgres pg_dump -U postgres bookreader > /tmp/corrupted_backup.sql

# 3. Drop and recreate database
docker exec -it bookreader_postgres psql -U postgres << EOF
DROP DATABASE bookreader;
CREATE DATABASE bookreader;
EOF

# 4. Restore from latest good backup
aws s3 cp s3://bookreader-backups/daily/bookreader_20251029_020000.sql.gz .
gunzip -c bookreader_20251029_020000.sql.gz | docker exec -i bookreader_postgres psql -U postgres -d bookreader

# 5. Verify data integrity
docker exec bookreader_postgres psql -U postgres -d bookreader -c "SELECT count(*) FROM books;"
docker exec bookreader_postgres psql -U postgres -d bookreader -c "SELECT count(*) FROM users;"

# 6. Run migrations (if needed)
docker-compose exec backend alembic upgrade head

# 7. Restart services
docker-compose start backend celery-worker

# 8. Verify functionality
curl https://your-domain.com/api/v1/books
```

### Scenario 3: Accidental Data Deletion

**Point-in-Time Recovery:**

```bash
# 1. Identify exact time of deletion
# User reports deletion at 14:35 UTC

# 2. Stop application
docker-compose stop backend celery-worker

# 3. Perform PITR (see DATABASE_PRODUCTION.md)
# Restore to 14:30 UTC (5 minutes before deletion)

# 4. Export deleted records
docker exec bookreader_postgres psql -U postgres -d bookreader -c \
  "COPY (SELECT * FROM books WHERE deleted_at IS NULL) TO STDOUT CSV HEADER" > recovered_data.csv

# 5. Restore latest backup to live database
# (to get most recent data)

# 6. Import recovered records
docker exec -i bookreader_postgres psql -U postgres -d bookreader -c \
  "COPY books FROM STDIN CSV HEADER" < recovered_data.csv

# 7. Verify and restart
docker-compose start backend celery-worker
```

### Scenario 4: Ransomware Attack

**Estimated Recovery Time:** 4-8 hours

```bash
# 1. IMMEDIATELY isolate server
# - Disconnect from network
# - Do NOT shut down (preserve memory for forensics)

# 2. Assess damage
# - Take snapshots/images of affected systems
# - Document what was encrypted

# 3. DO NOT PAY RANSOM

# 4. Provision clean server
# - New IP address
# - Fresh OS install

# 5. Restore from backups (BEFORE encryption)
# Identify last clean backup:
aws s3 ls s3://bookreader-backups/daily/ | grep "2025-10-29"

# 6. Follow "Complete Server Failure" procedure above

# 7. Security hardening
# - Change ALL passwords
# - Rotate ALL API keys
# - Review firewall rules
# - Update all software

# 8. Post-incident review
# - How did ransomware enter?
# - What vulnerabilities exist?
# - Update security policies
```

---

## Backup Verification

### Automated Testing

**`scripts/test-db-restore.sh`:**

```bash
#!/bin/bash
# Test database restore weekly

set -e

TEST_DB_NAME="bookreader_test_restore"
LATEST_BACKUP=$(ls -t /var/backups/postgresql/bookreader_*.sql.gz | head -1)

echo "Testing restore of: $LATEST_BACKUP"

# Create test database
docker exec bookreader_postgres psql -U postgres -c "DROP DATABASE IF EXISTS $TEST_DB_NAME;"
docker exec bookreader_postgres psql -U postgres -c "CREATE DATABASE $TEST_DB_NAME;"

# Restore backup
gunzip -c "$LATEST_BACKUP" | docker exec -i bookreader_postgres psql -U postgres -d "$TEST_DB_NAME"

# Verify data
BOOK_COUNT=$(docker exec bookreader_postgres psql -U postgres -d "$TEST_DB_NAME" -t -c "SELECT count(*) FROM books;")
USER_COUNT=$(docker exec bookreader_postgres psql -U postgres -d "$TEST_DB_NAME" -t -c "SELECT count(*) FROM users;")

echo "Books: $BOOK_COUNT"
echo "Users: $USER_COUNT"

if [ "$BOOK_COUNT" -gt 0 ] && [ "$USER_COUNT" -gt 0 ]; then
    echo "✅ Restore test PASSED"
    # Send success notification
    curl -X POST "${SLACK_WEBHOOK_URL}" -d '{"text":"✅ Weekly backup restore test passed"}'
else
    echo "❌ Restore test FAILED"
    # Send alert
    curl -X POST "${SLACK_WEBHOOK_URL}" -d '{"text":"❌ Weekly backup restore test FAILED - Check immediately!"}'
    exit 1
fi

# Clean up
docker exec bookreader_postgres psql -U postgres -c "DROP DATABASE $TEST_DB_NAME;"
```

**Cron schedule:**

```bash
# Weekly restore test - Sunday at 4 AM
0 4 * * 0 /opt/bookreader/scripts/test-db-restore.sh >> /var/log/backup-test.log 2>&1
```

---

## Monitoring and Alerts

### Backup Monitoring

**Alert Rules:**

```yaml
# monitoring/prometheus/alerts/backups.yml
groups:
  - name: backup_alerts
    rules:
      - alert: BackupFailed
        expr: time() - backup_last_success_timestamp_seconds > 86400
        for: 1h
        labels:
          severity: critical
        annotations:
          summary: "Backup has not run in 24 hours"

      - alert: BackupSizeAnomalous
        expr: |
          (
            backup_size_bytes
            / backup_size_bytes offset 1d
          ) < 0.5 OR
          (
            backup_size_bytes
            / backup_size_bytes offset 1d
          ) > 2.0
        labels:
          severity: warning
        annotations:
          summary: "Backup size significantly different from previous day"
```

### Health Checks

```bash
#!/bin/bash
# scripts/health-check.sh

# Check services
docker-compose ps | grep -v "Up" && echo "❌ Some services are down" || echo "✅ All services up"

# Check disk space
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "❌ Disk usage at ${DISK_USAGE}%"
else
    echo "✅ Disk usage OK (${DISK_USAGE}%)"
fi

# Check database replication lag (if applicable)
LAG=$(docker exec bookreader_postgres psql -U postgres -t -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag;")
if (( $(echo "$LAG > 60" | bc -l) )); then
    echo "❌ Replication lag: ${LAG}s"
else
    echo "✅ Replication lag OK: ${LAG}s"
fi

# Check Redis
docker exec bookreader_redis redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1 && echo "✅ Redis OK" || echo "❌ Redis down"

# Check S3 backups
LATEST_BACKUP=$(aws s3 ls s3://bookreader-backups/daily/ | tail -1 | awk '{print $1, $2}')
echo "Latest backup: $LATEST_BACKUP"
```

---

## Contact Information

### Emergency Contacts

```yaml
Primary On-Call:
  Name: DevOps Engineer
  Phone: +7-XXX-XXX-XXXX
  Email: oncall@bookreader.ai

Secondary On-Call:
  Name: CTO
  Phone: +7-XXX-XXX-XXXX
  Email: cto@bookreader.ai

Vendor Support:
  Hosting Provider: support@provider.com
  Database Consultant: db@consultant.com
```

### Communication Channels

- **Slack:** #incidents
- **Email:** incidents@bookreader.ai
- **Status Page:** status.bookreader.ai

---

## Post-Incident Review

After any disaster recovery event, conduct a review within 48 hours:

1. **Timeline:** Document event timeline
2. **Root Cause:** Identify what went wrong
3. **Response:** Evaluate response effectiveness
4. **Improvements:** Update procedures
5. **Prevention:** Implement preventive measures

**Template:** `docs/operations/incident-review-template.md`

---

## Regular Drills

**Schedule disaster recovery drills:**

- **Quarterly:** Full DR test (restore to staging environment)
- **Monthly:** Backup verification
- **Weekly:** Automated restore tests

**Document results** in `docs/operations/dr-drill-results/`

---

## Document Maintenance

**Review quarterly:**
- Update RTO/RPO targets
- Verify contact information
- Test all procedures
- Update scripts for infrastructure changes

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
**Next Review:** December 30, 2025
**Next DR Drill:** November 15, 2025
