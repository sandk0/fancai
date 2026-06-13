# Backup and Restore Documentation

**Project:** fancai
**Document Version:** 1.0
**Last Updated:** 2025-10-24
**Purpose:** Complete guide for backing up and restoring the fancai system

---

## Table of Contents

1. [Backup System Overview](#backup-system-overview)
2. [Full Backup Components](#full-backup-components)
3. [Creating Backups](#creating-backups)
   - [Automated Backup Script](#automated-backup-script)
   - [Manual Step-by-Step Backup](#manual-step-by-step-backup)
4. [Restoration Procedures](#restoration-procedures)
   - [Complete System Restore](#complete-system-restore)
   - [Partial Restoration](#partial-restoration)
5. [Backup Schedule Recommendations](#backup-schedule-recommendations)
6. [Backup Integrity Verification](#backup-integrity-verification)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Backup System Overview

The fancai backup system is designed to ensure complete data recovery capability in case of system failures, data corruption, or disaster scenarios. The backup strategy follows the **3-2-1 rule**:

- **3** copies of your data
- **2** different storage media types
- **1** copy offsite

### Architecture

```
fancai Backup Architecture
├── Primary Data (Production)
│   ├── PostgreSQL Database
│   ├── Redis Cache
│   ├── Storage Files (books, images, covers)
│   └── Configuration Files
│
├── Local Backups (Daily)
│   ├── /backups/postgresql/
│   ├── /backups/redis/
│   ├── /backups/storage/
│   └── /backups/config/
│
└── Remote Backups (Weekly)
    ├── Cloud Storage (S3/GCS)
    └── Git Repository (code only)
```

### Backup Types

1. **Full Backup:** Complete system snapshot (weekly)
2. **Incremental Backup:** Only changed data (daily)
3. **Continuous Backup:** Real-time for critical data (optional)

---

## Full Backup Components

A complete backup of fancai includes:

### 1. PostgreSQL Database

**What's included:**
- All user accounts and authentication data
- Book metadata and content
- Chapters and descriptions
- Generated images references
- Reading progress and bookmarks
- Subscriptions and payment history
- System logs

**Size:** ~500MB - 10GB (depending on user base)
**Format:** `.sql` dump file or custom PostgreSQL format
**Location:** `backups/postgresql/bookreader_backup_YYYY-MM-DD.sql`

### 2. Redis Data

**What's included:**
- Session data
- Cache entries
- Celery task queues
- Rate limiting counters
- Temporary processing data

**Size:** ~10MB - 500MB
**Format:** `.rdb` (Redis Database Backup)
**Location:** `backups/redis/dump_YYYY-MM-DD.rdb`

### 3. Storage Files

**What's included:**
- **Books:** Original EPUB/FB2 files uploaded by users
- **Generated Images:** AI-generated illustrations
- **Book Covers:** Extracted or uploaded cover images
- **User Avatars:** Profile pictures (optional)

**Size:** ~10GB - 1TB+ (depending on library size)
**Format:** Original file formats in tar.gz archive
**Location:** `backups/storage/storage_backup_YYYY-MM-DD.tar.gz`

**Structure:**
```
storage/
├── books/              # Original book files
│   ├── epub/
│   └── fb2/
├── images/             # Generated illustrations
│   ├── locations/
│   ├── characters/
│   └── atmospheres/
└── covers/             # Book cover images
```

### 4. Git Repository

**What's included:**
- Application source code
- Configuration templates
- Database migration scripts
- Documentation
- Docker configurations

**Size:** ~50MB
**Format:** Git repository
**Location:** Remote Git hosting (GitHub/GitLab)

### 5. Configuration Files

**What's included:**
- `docker-compose.yml`
- `.env` files (encrypted)
- Nginx configurations
- SSL certificates
- Service configurations

**Size:** ~5MB
**Format:** Encrypted tar.gz
**Location:** `backups/config/config_backup_YYYY-MM-DD.tar.gz.enc`

---

## Creating Backups

### Automated Backup Script

Create and use the automated backup script for regular backups.

#### Step 1: Create Backup Script

Create file: `scripts/backup.sh`

```bash
#!/bin/bash

# fancai Automated Backup Script
# Version: 1.0
# Author: fancai Team

set -e  # Exit on any error

# Configuration
BACKUP_DIR="/var/backups/bookreader"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
RETENTION_DAYS=30
LOG_FILE="/var/log/bookreader_backup.log"

# Docker container names
DB_CONTAINER="bookreader-db"
REDIS_CONTAINER="bookreader-redis"
BACKEND_CONTAINER="bookreader-backend"

# Database credentials (load from .env or set here)
DB_NAME="bookreader"
DB_USER="postgres"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Functions
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

create_directories() {
    mkdir -p "$BACKUP_DIR"/{postgresql,redis,storage,config,logs}
}

# 1. Backup PostgreSQL
backup_postgresql() {
    log_message "Starting PostgreSQL backup..."

    docker exec "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -F c \
        -b \
        -v \
        -f "/tmp/backup.dump"

    docker cp "$DB_CONTAINER:/tmp/backup.dump" \
        "$BACKUP_DIR/postgresql/bookreader_${DATE}.dump"

    # Also create SQL text format for easier inspection
    docker exec "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --clean \
        --if-exists \
        > "$BACKUP_DIR/postgresql/bookreader_${DATE}.sql"

    # Compress SQL file
    gzip "$BACKUP_DIR/postgresql/bookreader_${DATE}.sql"

    log_message "PostgreSQL backup completed: $(du -h $BACKUP_DIR/postgresql/bookreader_${DATE}.dump | cut -f1)"
}

# 2. Backup Redis
backup_redis() {
    log_message "Starting Redis backup..."

    # Trigger BGSAVE
    docker exec "$REDIS_CONTAINER" redis-cli BGSAVE

    # Wait for BGSAVE to complete
    sleep 5

    # Copy dump.rdb
    docker cp "$REDIS_CONTAINER:/data/dump.rdb" \
        "$BACKUP_DIR/redis/dump_${DATE}.rdb"

    # Compress
    gzip "$BACKUP_DIR/redis/dump_${DATE}.rdb"

    log_message "Redis backup completed: $(du -h $BACKUP_DIR/redis/dump_${DATE}.rdb.gz | cut -f1)"
}

# 3. Backup Storage Files
backup_storage() {
    log_message "Starting storage files backup..."

    # Copy storage directory
    docker cp "$BACKEND_CONTAINER:/app/storage" /tmp/storage_backup

    # Create compressed archive
    tar -czf "$BACKUP_DIR/storage/storage_${DATE}.tar.gz" \
        -C /tmp storage_backup

    # Cleanup
    rm -rf /tmp/storage_backup

    log_message "Storage backup completed: $(du -h $BACKUP_DIR/storage/storage_${DATE}.tar.gz | cut -f1)"
}

# 4. Backup Configuration Files
backup_config() {
    log_message "Starting configuration backup..."

    mkdir -p /tmp/config_backup

    # Copy important config files
    cp docker-compose.yml /tmp/config_backup/
    cp -r nginx/ /tmp/config_backup/ 2>/dev/null || true

    # Copy .env files (will be encrypted)
    cp .env /tmp/config_backup/.env.backup 2>/dev/null || true

    # Create archive
    tar -czf /tmp/config_${DATE}.tar.gz -C /tmp config_backup

    # Encrypt with GPG (optional but recommended)
    if command -v gpg &> /dev/null; then
        gpg --symmetric --cipher-algo AES256 \
            --output "$BACKUP_DIR/config/config_${DATE}.tar.gz.gpg" \
            /tmp/config_${DATE}.tar.gz
        rm /tmp/config_${DATE}.tar.gz
        log_message "Configuration backup completed and encrypted"
    else
        mv /tmp/config_${DATE}.tar.gz "$BACKUP_DIR/config/"
        log_message "Configuration backup completed (not encrypted)"
    fi

    # Cleanup
    rm -rf /tmp/config_backup
}

# 5. Create Backup Manifest
create_manifest() {
    log_message "Creating backup manifest..."

    cat > "$BACKUP_DIR/backup_manifest_${DATE}.txt" <<EOF
fancai Backup Manifest
=============================
Date: $DATE
Hostname: $(hostname)
Backup Directory: $BACKUP_DIR

Components:
-----------
PostgreSQL: $(ls -lh $BACKUP_DIR/postgresql/bookreader_${DATE}.dump 2>/dev/null | awk '{print $5}')
Redis: $(ls -lh $BACKUP_DIR/redis/dump_${DATE}.rdb.gz 2>/dev/null | awk '{print $5}')
Storage: $(ls -lh $BACKUP_DIR/storage/storage_${DATE}.tar.gz 2>/dev/null | awk '{print $5}')
Config: $(ls -lh $BACKUP_DIR/config/config_${DATE}.tar.gz* 2>/dev/null | awk '{print $5}')

Database Statistics:
-------------------
$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
SELECT
    'Users: ' || COUNT(*) FROM users
    UNION ALL
    SELECT 'Books: ' || COUNT(*) FROM books
    UNION ALL
    SELECT 'Images: ' || COUNT(*) FROM generated_images;
")

Checksums (SHA256):
------------------
$(cd $BACKUP_DIR && find . -name "*${DATE}*" -type f -exec sha256sum {} \;)
EOF

    log_message "Manifest created: backup_manifest_${DATE}.txt"
}

# 6. Cleanup Old Backups
cleanup_old_backups() {
    log_message "Cleaning up backups older than $RETENTION_DAYS days..."

    find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -delete

    log_message "Cleanup completed"
}

# 7. Upload to Cloud (optional)
upload_to_cloud() {
    if [ -n "$AWS_S3_BUCKET" ]; then
        log_message "Uploading to S3..."

        aws s3 sync "$BACKUP_DIR" "s3://$AWS_S3_BUCKET/bookreader-backups/" \
            --storage-class STANDARD_IA \
            --exclude "*" \
            --include "*${DATE}*"

        log_message "Upload to S3 completed"
    fi
}

# Main execution
main() {
    log_message "========== Starting fancai Backup =========="

    create_directories
    backup_postgresql
    backup_redis
    backup_storage
    backup_config
    create_manifest
    cleanup_old_backups
    upload_to_cloud

    log_message "========== Backup Completed Successfully =========="
    log_message "Total backup size: $(du -sh $BACKUP_DIR | cut -f1)"
}

# Run main function
main
```

#### Step 2: Set Permissions

```bash
chmod +x scripts/backup.sh
```

#### Step 3: Schedule with Cron

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/fancai-vibe-hackathon/scripts/backup.sh

# Add weekly full backup on Sunday at 3 AM
0 3 * * 0 /path/to/fancai-vibe-hackathon/scripts/backup.sh --full
```

#### Step 4: Run Backup

```bash
# Manual execution
./scripts/backup.sh

# Check logs
tail -f /var/log/bookreader_backup.log
```

---

### Manual Step-by-Step Backup

For manual backups or understanding the process:

#### 1. Backup PostgreSQL Database

```bash
# Method 1: Custom format (recommended)
docker exec bookreader-db pg_dump \
    -U postgres \
    -d bookreader \
    -F c \
    -b \
    -v \
    -f /tmp/backup.dump

docker cp bookreader-db:/tmp/backup.dump ./bookreader_$(date +%Y-%m-%d).dump

# Method 2: SQL text format
docker exec bookreader-db pg_dump \
    -U postgres \
    -d bookreader \
    --clean \
    --if-exists \
    > bookreader_$(date +%Y-%m-%d).sql

# Compress
gzip bookreader_$(date +%Y-%m-%d).sql
```

#### 2. Backup Redis

```bash
# Trigger save
docker exec bookreader-redis redis-cli BGSAVE

# Wait for completion
docker exec bookreader-redis redis-cli LASTSAVE

# Copy dump file
docker cp bookreader-redis:/data/dump.rdb ./redis_dump_$(date +%Y-%m-%d).rdb

# Compress
gzip redis_dump_$(date +%Y-%m-%d).rdb
```

#### 3. Backup Storage Files

```bash
# Copy storage directory
docker cp bookreader-backend:/app/storage ./storage_backup

# Create compressed archive
tar -czf storage_$(date +%Y-%m-%d).tar.gz storage_backup

# Cleanup
rm -rf storage_backup
```

#### 4. Backup Configuration Files

```bash
# Create backup directory
mkdir -p config_backup

# Copy files
cp docker-compose.yml config_backup/
cp .env config_backup/.env.backup
cp -r nginx/ config_backup/ 2>/dev/null || true

# Archive and encrypt
tar -czf config_$(date +%Y-%m-%d).tar.gz config_backup
gpg --symmetric --cipher-algo AES256 config_$(date +%Y-%m-%d).tar.gz

# Cleanup
rm -rf config_backup
rm config_$(date +%Y-%m-%d).tar.gz
```

#### 5. Verify Backup Files

```bash
# Check file sizes
ls -lh *.dump *.tar.gz *.rdb.gz

# Generate checksums
sha256sum *.dump *.tar.gz *.rdb.gz > backup_checksums_$(date +%Y-%m-%d).txt
```

---

## Restoration Procedures

### Complete System Restore

Full system restoration from backup (disaster recovery scenario).

#### Prerequisites

- Fresh server or VM with Docker installed
- Access to backup files
- Database credentials
- SSL certificates (if applicable)

#### Step 1: Prepare Environment

```bash
# Create project directory
mkdir -p /opt/bookreader-ai
cd /opt/bookreader-ai

# Clone repository
git clone <repository-url> .

# Create storage directories
mkdir -p storage/{books,images,covers}
mkdir -p logs
```

#### Step 2: Restore Configuration

```bash
# Decrypt and extract config
gpg --decrypt config_backup.tar.gz.gpg > config_backup.tar.gz
tar -xzf config_backup.tar.gz

# Copy files to correct locations
cp config_backup/docker-compose.yml .
cp config_backup/.env.backup .env
cp -r config_backup/nginx/ nginx/ 2>/dev/null || true
```

#### Step 3: Start Database Container

```bash
# Start only PostgreSQL
docker-compose up -d db

# Wait for PostgreSQL to be ready
sleep 10
```

#### Step 4: Restore PostgreSQL Database

```bash
# Method 1: From custom format dump
docker cp bookreader_backup.dump bookreader-db:/tmp/
docker exec bookreader-db pg_restore \
    -U postgres \
    -d postgres \
    -c \
    -C \
    -v \
    /tmp/bookreader_backup.dump

# Method 2: From SQL file
gunzip bookreader_backup.sql.gz
docker exec -i bookreader-db psql -U postgres < bookreader_backup.sql

# Verify restoration
docker exec bookreader-db psql -U postgres -d bookreader -c "
    SELECT 'Users: ' || COUNT(*) FROM users
    UNION ALL
    SELECT 'Books: ' || COUNT(*) FROM books;
"
```

#### Step 5: Restore Redis

```bash
# Stop Redis if running
docker-compose stop redis

# Copy backup file
gunzip redis_dump_backup.rdb.gz
docker cp redis_dump_backup.rdb bookreader-redis:/data/dump.rdb

# Set permissions
docker exec bookreader-redis chown redis:redis /data/dump.rdb

# Start Redis
docker-compose start redis
```

#### Step 6: Restore Storage Files

```bash
# Extract storage backup
tar -xzf storage_backup.tar.gz

# Copy to container
docker cp storage_backup bookreader-backend:/app/storage

# Set permissions
docker exec bookreader-backend chown -R app:app /app/storage
```

#### Step 7: Start All Services

```bash
# Start all containers
docker-compose up -d

# Check logs
docker-compose logs -f

# Verify services
curl http://localhost:8000/api/v1/health
```

#### Step 8: Verify Restoration

```bash
# Run verification script
./scripts/verify_restore.sh

# Manual checks:
# 1. Login to web interface
# 2. Check book library
# 3. Test image generation
# 4. Verify reading progress
```

---

### Partial Restoration

Restore specific components without affecting others.

#### Database Only Restore

```bash
# Backup current database (safety)
docker exec bookreader-db pg_dump -U postgres -d bookreader -F c > current_backup.dump

# Restore from backup
docker exec -i bookreader-db pg_restore \
    -U postgres \
    -d bookreader \
    -c \
    -v \
    /tmp/bookreader_backup.dump

# If restore fails, rollback:
# docker exec -i bookreader-db pg_restore -U postgres -d bookreader current_backup.dump
```

#### Storage Files Only Restore

```bash
# Stop backend to avoid file locks
docker-compose stop backend celery-worker

# Backup current storage
docker cp bookreader-backend:/app/storage ./storage_current_backup

# Restore from backup
tar -xzf storage_backup.tar.gz
docker cp storage_backup bookreader-backend:/app/storage

# Start services
docker-compose start backend celery-worker
```

#### Redis Only Restore

```bash
# Stop Redis
docker-compose stop redis

# Backup current Redis data
docker cp bookreader-redis:/data/dump.rdb ./redis_current_backup.rdb

# Restore from backup
gunzip redis_dump_backup.rdb.gz
docker cp redis_dump_backup.rdb bookreader-redis:/data/dump.rdb

# Start Redis
docker-compose start redis
```

#### Single Table Restore (PostgreSQL)

```bash
# Export specific table from backup
pg_restore -U postgres \
    -d bookreader \
    -t users \
    --clean \
    bookreader_backup.dump

# Or using SQL dump:
psql -U postgres -d bookreader << EOF
BEGIN;
TRUNCATE TABLE users CASCADE;
\i users_table_backup.sql
COMMIT;
EOF
```

---

## Backup Schedule Recommendations

### Production Environment

| Backup Type | Frequency | Retention | Storage Location |
|-------------|-----------|-----------|------------------|
| **Full System** | Weekly (Sunday 3 AM) | 4 weeks | Local + Cloud |
| **Database** | Daily (2 AM) | 7 days local, 30 days cloud | Local + Cloud |
| **Storage Files** | Daily (3 AM) | 7 days local, 30 days cloud | Local + Cloud |
| **Configuration** | On change | 10 versions | Git + Cloud |
| **Redis** | Daily (2:30 AM) | 3 days | Local only |
| **Logs** | Continuous | 30 days | Local + Cloud |

### Development/Staging Environment

| Backup Type | Frequency | Retention | Storage Location |
|-------------|-----------|-----------|------------------|
| **Database** | Daily (3 AM) | 3 days | Local only |
| **Storage Files** | Weekly | 2 weeks | Local only |
| **Configuration** | On change | 5 versions | Git only |

### Critical Backup Windows

**Recommended backup times:**
- **02:00 - 04:00 AM** - Lowest traffic period
- **Sunday 03:00 AM** - Full system backup
- **Before deployments** - Pre-deployment snapshot
- **After major updates** - Post-update verification backup

---

## Backup Integrity Verification

### Automated Verification Script

Create file: `scripts/verify_backup.sh`

```bash
#!/bin/bash

# Backup Verification Script
# Verifies integrity and restorability of backups

BACKUP_FILE=$1
BACKUP_TYPE=$2

verify_postgresql_backup() {
    echo "Verifying PostgreSQL backup..."

    # Test restore to temporary database
    docker exec bookreader-db createdb -U postgres test_restore
    docker exec bookreader-db pg_restore \
        -U postgres \
        -d test_restore \
        /tmp/backup.dump \
        2>&1 | grep -i error

    # Check table counts
    docker exec bookreader-db psql -U postgres -d test_restore -c "
        SELECT COUNT(*) as total_tables
        FROM information_schema.tables
        WHERE table_schema = 'public';
    "

    # Cleanup
    docker exec bookreader-db dropdb -U postgres test_restore

    echo "PostgreSQL backup verified successfully"
}

verify_storage_backup() {
    echo "Verifying storage backup..."

    # Test extraction
    tar -tzf "$BACKUP_FILE" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "Storage archive is valid"

        # Count files
        file_count=$(tar -tzf "$BACKUP_FILE" | wc -l)
        echo "Files in archive: $file_count"
    else
        echo "ERROR: Storage archive is corrupted"
        exit 1
    fi
}

verify_redis_backup() {
    echo "Verifying Redis backup..."

    # Check RDB file integrity
    gunzip -c "$BACKUP_FILE" | docker exec -i bookreader-redis redis-check-rdb - > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "Redis backup is valid"
    else
        echo "ERROR: Redis backup is corrupted"
        exit 1
    fi
}

# Main verification
case "$BACKUP_TYPE" in
    postgresql)
        verify_postgresql_backup
        ;;
    storage)
        verify_storage_backup
        ;;
    redis)
        verify_redis_backup
        ;;
    *)
        echo "Unknown backup type: $BACKUP_TYPE"
        exit 1
        ;;
esac
```

### Manual Verification Steps

#### 1. Check File Integrity

```bash
# Verify checksums
sha256sum -c backup_checksums.txt

# Check file sizes (should not be 0)
ls -lh backup_*

# Test archive extraction
tar -tzf storage_backup.tar.gz > /dev/null
gunzip -t redis_dump.rdb.gz
```

#### 2. Test Database Restore

```bash
# Create test database
docker exec bookreader-db createdb -U postgres test_restore

# Attempt restore
docker exec bookreader-db pg_restore \
    -U postgres \
    -d test_restore \
    /tmp/backup.dump

# Verify data
docker exec bookreader-db psql -U postgres -d test_restore -c "
    SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

# Cleanup
docker exec bookreader-db dropdb -U postgres test_restore
```

#### 3. Verify Backup Completeness

```bash
# Check manifest file
cat backup_manifest_*.txt

# Verify all components exist
ls -1 backups/postgresql/
ls -1 backups/redis/
ls -1 backups/storage/
ls -1 backups/config/
```

---

## Best Practices

### 1. Security Best Practices

**Encrypt Sensitive Backups:**
```bash
# Encrypt with GPG
gpg --symmetric --cipher-algo AES256 backup.tar.gz

# Decrypt when needed
gpg --decrypt backup.tar.gz.gpg > backup.tar.gz
```

**Secure Storage Permissions:**
```bash
# Restrict access to backup directory
chmod 700 /var/backups/bookreader
chown root:root /var/backups/bookreader

# Encrypt database credentials in scripts
# Use environment variables or secrets management
```

**Never Commit Sensitive Data:**
```bash
# Add to .gitignore
echo "*.dump" >> .gitignore
echo "*.sql" >> .gitignore
echo "*.env.backup" >> .gitignore
echo "backups/" >> .gitignore
```

### 2. Storage Best Practices

**Use Multiple Storage Locations:**
- Local disk (immediate recovery)
- Network storage (NAS/SAN)
- Cloud storage (disaster recovery)

**Implement Lifecycle Policies:**
```bash
# S3 lifecycle example
aws s3api put-bucket-lifecycle-configuration \
    --bucket bookreader-backups \
    --lifecycle-configuration file://lifecycle.json
```

lifecycle.json:
```json
{
  "Rules": [
    {
      "Id": "Move to Glacier after 30 days",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 365
      }
    }
  ]
}
```

### 3. Testing Best Practices

**Regular Restore Testing:**
- Test full restoration quarterly
- Test partial restoration monthly
- Document restore times and issues

**Disaster Recovery Drills:**
- Simulate complete system failure
- Practice restoration procedures
- Update documentation based on findings

### 4. Monitoring Best Practices

**Setup Backup Monitoring:**
```bash
# Create monitoring script
cat > /usr/local/bin/check_backup_status.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/var/backups/bookreader"
MAX_AGE_HOURS=26  # 1 day + 2 hours buffer

latest_backup=$(find $BACKUP_DIR -name "*.dump" -mmin -$((MAX_AGE_HOURS * 60)) | wc -l)

if [ $latest_backup -eq 0 ]; then
    echo "WARNING: No recent backup found!"
    # Send alert (email, Slack, etc.)
    exit 1
else
    echo "OK: Recent backup exists"
    exit 0
fi
EOF

chmod +x /usr/local/bin/check_backup_status.sh

# Add to cron for monitoring
echo "0 */4 * * * /usr/local/bin/check_backup_status.sh" | crontab -
```

### 5. Documentation Best Practices

**Maintain Backup Logs:**
- Record all backup operations
- Log retention and deletion activities
- Document any restoration attempts

**Keep Restoration Procedures Updated:**
- Update after any infrastructure changes
- Include contact information for emergencies
- Document lessons learned from restore tests

---

## Troubleshooting

### Common Backup Issues

#### 1. Backup Script Fails

**Problem:** Backup script exits with errors

**Solutions:**
```bash
# Check disk space
df -h /var/backups

# Check Docker container status
docker-compose ps

# Check database connectivity
docker exec bookreader-db pg_isready -U postgres

# Review logs
tail -100 /var/log/bookreader_backup.log
```

#### 2. PostgreSQL Backup Fails

**Problem:** pg_dump returns errors

**Solutions:**
```bash
# Check PostgreSQL version compatibility
docker exec bookreader-db psql -U postgres -c "SELECT version();"

# Verify database exists
docker exec bookreader-db psql -U postgres -l

# Check user permissions
docker exec bookreader-db psql -U postgres -c "\du"

# Test connection
docker exec bookreader-db pg_dump -U postgres -d bookreader --schema-only
```

#### 3. Storage Backup Too Large

**Problem:** Storage backups consuming too much space

**Solutions:**
```bash
# Analyze storage usage
docker exec bookreader-backend du -sh /app/storage/*

# Identify large files
docker exec bookreader-backend find /app/storage -type f -size +100M

# Implement compression
tar -czf storage_backup.tar.gz --use-compress-program=pigz storage/

# Consider incremental backups with rsync
rsync -av --link-dest=/var/backups/bookreader/storage/latest \
    storage/ /var/backups/bookreader/storage/$(date +%Y-%m-%d)/
```

#### 4. Redis Backup Incomplete

**Problem:** Redis dump.rdb file is 0 bytes or corrupted

**Solutions:**
```bash
# Check Redis configuration
docker exec bookreader-redis redis-cli CONFIG GET save

# Manually trigger save
docker exec bookreader-redis redis-cli SAVE

# Check Redis logs
docker logs bookreader-redis

# Verify RDB file
docker exec bookreader-redis redis-check-rdb /data/dump.rdb
```

### Common Restoration Issues

#### 1. Database Restore Fails

**Problem:** pg_restore returns errors

**Solutions:**
```bash
# Check backup file integrity
pg_restore --list backup.dump | head

# Restore without dropping existing objects
pg_restore -U postgres -d bookreader --clean --if-exists backup.dump

# Restore specific schema only
pg_restore -U postgres -d bookreader -n public backup.dump

# Skip errors and continue
pg_restore -U postgres -d bookreader --exit-on-error backup.dump
```

#### 2. Permission Issues After Restore

**Problem:** Application cannot access restored files

**Solutions:**
```bash
# Fix storage permissions
docker exec bookreader-backend chown -R app:app /app/storage
docker exec bookreader-backend chmod -R 755 /app/storage

# Fix database permissions
docker exec bookreader-db psql -U postgres -d bookreader -c "
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bookreader_user;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bookreader_user;
"
```

#### 3. Restored System Not Working

**Problem:** Services start but application doesn't work correctly

**Checklist:**
```bash
# 1. Verify database schema version
docker exec bookreader-db psql -U postgres -d bookreader -c "SELECT version FROM alembic_version;"

# Run migrations if needed
docker exec bookreader-backend alembic upgrade head

# 2. Check environment variables
docker exec bookreader-backend env | grep -E 'DATABASE_URL|REDIS_URL'

# 3. Verify Redis connection
docker exec bookreader-backend redis-cli -h redis ping

# 4. Check application logs
docker logs bookreader-backend --tail 100

# 5. Test API endpoints
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/books
```

---

## Contact and Support

For backup and restoration assistance:

- **Documentation:** `/docs/operations/`
- **Backup Logs:** `/var/log/bookreader_backup.log`
- **Support:** devops@bookreader-ai.com
- **Emergency:** +1-XXX-XXX-XXXX

---

## Appendix

### A. Backup File Naming Convention

```
Format: <component>_<date>_<time>[_<type>].<extension>

Examples:
- bookreader_2025-10-24_02-00-00.dump
- storage_2025-10-24_03-00-00_full.tar.gz
- redis_dump_2025-10-24_02-30-00.rdb.gz
- config_2025-10-24_encrypted.tar.gz.gpg
```

### B. Backup Size Estimates

| Component | Small Site | Medium Site | Large Site |
|-----------|------------|-------------|------------|
| Database | 100 MB | 1 GB | 10 GB |
| Storage | 1 GB | 50 GB | 500 GB |
| Redis | 10 MB | 100 MB | 1 GB |
| Config | 5 MB | 5 MB | 5 MB |
| **Total** | **~1 GB** | **~51 GB** | **~511 GB** |

### C. Recovery Time Objectives

| Scenario | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) |
|----------|-------------------------------|--------------------------------|
| Database corruption | 1 hour | Last daily backup (24h) |
| Storage loss | 2 hours | Last daily backup (24h) |
| Complete system failure | 4 hours | Last weekly backup (168h) |
| Single file restoration | 15 minutes | Last daily backup (24h) |

---

**Document Version:** 1.0
**Last Updated:** 2025-10-24
**Next Review Date:** 2025-11-24
