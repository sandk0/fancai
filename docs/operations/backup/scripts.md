# BookReader AI - Backup & Restore Documentation

Comprehensive backup and restore system for BookReader AI project.

## Quick Start

```bash
# Full backup (recommended for production)
./scripts/backup.sh --compress

# Database only backup (fastest)
./scripts/backup.sh --type db

# Restore from backup
./scripts/restore.sh backup-2025-10-24-173231

# Restore database only
./scripts/restore.sh backup-2025-10-24-173231 --type db
```

---

## Table of Contents

- [Backup Script](#backup-script)
- [Restore Script](#restore-script)
- [Backup Contents](#backup-contents)
- [Best Practices](#best-practices)
- [Automation](#automation)
- [Troubleshooting](#troubleshooting)

---

## Backup Script

### Usage

```bash
./scripts/backup.sh [--type TYPE] [--compress]
```

### Options

| Option | Values | Description |
|--------|--------|-------------|
| `--type` | `full`, `db`, `files`, `git` | Type of backup (default: `full`) |
| `--compress` | - | Compress backup into .tar.gz archive |
| `--help` | - | Show help message |

### Backup Types

#### Full Backup (`--type full`)

Creates complete backup of:
- PostgreSQL database (all tables, schema, data)
- Redis data (dump.rdb)
- Storage files (books, images, covers)
- Git repository (all branches, tags, stash)
- Project archive (full codebase)

**Use case:** Production backups, disaster recovery, migration

**Example:**
```bash
./scripts/backup.sh --compress
```

**Size:** ~500MB - 2GB depending on data
**Time:** 2-5 minutes

#### Database Backup (`--type db`)

Backs up only:
- PostgreSQL database
- Redis data

**Use case:** Daily backups, before database migrations, quick snapshots

**Example:**
```bash
./scripts/backup.sh --type db
```

**Size:** ~100-500MB
**Time:** 30-60 seconds

#### Files Backup (`--type files`)

Backs up only:
- Storage directory (books, images, covers)

**Use case:** Before storage cleanup, file migration

**Example:**
```bash
./scripts/backup.sh --type files
```

**Size:** ~200MB - 1GB
**Time:** 1-2 minutes

#### Git Backup (`--type git`)

Backs up only:
- Git repository bundle (all refs)

**Use case:** Before major code changes, repository migration

**Example:**
```bash
./scripts/backup.sh --type git
```

**Size:** ~50-100MB
**Time:** 10-20 seconds

### Examples

```bash
# Full backup with compression (recommended for production)
./scripts/backup.sh --compress

# Quick database backup before migration
./scripts/backup.sh --type db

# Backup storage files before cleanup
./scripts/backup.sh --type files

# Full backup without compression (faster)
./scripts/backup.sh
```

### Output Structure

```
backups/backup-2025-10-24-173231/
├── database/
│   ├── postgres_bookreader_dev.sql    # Full database dump
│   ├── schema_bookreader_dev.sql      # Schema only (reference)
│   └── db_metadata.txt                # Database info
├── redis/
│   ├── dump.rdb                       # Redis snapshot
│   └── redis_info.txt                 # Redis stats
├── storage/
│   ├── books/                         # Book files
│   ├── images/                        # Generated images
│   ├── covers/                        # Book covers
│   └── inventory.txt                  # File inventory
├── git/
│   ├── repository.bundle              # Git bundle (all refs)
│   ├── git_config.txt                 # Git config
│   ├── git_remotes.txt                # Remotes info
│   └── git_status.txt                 # Repository status
├── archive/
│   └── project.tar.gz                 # Full project archive
└── manifest.txt                       # Backup metadata
```

---

## Restore Script

### Usage

```bash
./scripts/restore.sh <backup-name> [--type TYPE] [--force]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `backup-name` | Yes | Backup directory or .tar.gz file name |

### Options

| Option | Values | Description |
|--------|--------|-------------|
| `--type` | `full`, `db`, `files` | Type of restore (default: `full`) |
| `--force` | - | Skip confirmation prompts |
| `--help` | - | Show help message |

### Restore Types

#### Full Restore (`--type full`)

Restores:
- PostgreSQL database (drops and recreates)
- Redis data (flushes and restores)
- Storage files (overwrites)

**WARNING:** This will OVERWRITE all current data!

**Example:**
```bash
./scripts/restore.sh backup-2025-10-24-173231
```

#### Database Restore (`--type db`)

Restores only:
- PostgreSQL database
- Redis data

**Example:**
```bash
./scripts/restore.sh backup-2025-10-24-173231 --type db
```

#### Files Restore (`--type files`)

Restores only:
- Storage files

**Example:**
```bash
./scripts/restore.sh backup-2025-10-24-173231 --type files
```

### Examples

```bash
# List available backups
./scripts/restore.sh

# Full restore (interactive)
./scripts/restore.sh backup-2025-10-24-173231

# Database only restore
./scripts/restore.sh backup-2025-10-24-173231 --type db

# Restore without prompts (dangerous!)
./scripts/restore.sh backup-2025-10-24-173231 --force

# Restore from compressed backup
./scripts/restore.sh backup-2025-10-24-173231.tar.gz
```

### Safety Features

1. **Confirmation prompts** - Requires explicit confirmation before destructive operations
2. **Backup validation** - Checks manifest and backup integrity
3. **Current backup** - Creates backup of current storage before overwriting
4. **Container health check** - Verifies containers are running
5. **Database termination** - Safely terminates active connections

### Post-Restore Steps

After successful restore:

```bash
# 1. Restart containers
docker-compose restart

# 2. Verify database
docker exec bookreader_postgres psql -U postgres -d bookreader_dev -c "\dt"

# 3. Check application logs
docker-compose logs -f backend

# 4. Test application
curl http://localhost:8000/api/v1/health
```

---

## Backup Contents

### PostgreSQL Database

**What's backed up:**
- All tables with data
- Indexes and constraints
- Sequences (for auto-increment)
- Views and functions
- Schema structure

**What's NOT backed up:**
- Roles and permissions (use `--no-owner`)
- Database settings

**Format:** SQL dump (plain text)

**Size:** ~100-300MB (depends on data volume)

### Redis Data

**What's backed up:**
- All keys and values
- All databases (DB 0-15)
- TTL information

**Format:** dump.rdb (binary)

**Size:** ~4-10KB (usually small)

### Storage Files

**What's backed up:**
- `backend/storage/books/` - Uploaded book files (EPUB, FB2)
- `backend/storage/images/` - Generated images
- `backend/storage/covers/` - Book covers

**Format:** Directory copy (preserves structure)

**Size:** ~200MB - 1GB (depends on uploaded content)

### Git Repository

**What's backed up:**
- All branches (local and remote)
- All tags
- Stash entries
- Git configuration
- Remote information

**Format:** Git bundle (portable repository)

**Size:** ~50-100MB

---

## Best Practices

### Production Backups

#### Daily Automated Backups

```bash
# Add to crontab: daily at 2 AM
0 2 * * * cd /opt/bookreader && ./scripts/backup.sh --type db --compress >> /var/log/backup.log 2>&1
```

#### Weekly Full Backups

```bash
# Add to crontab: Sunday at 3 AM
0 3 * * 0 cd /opt/bookreader && ./scripts/backup.sh --compress >> /var/log/backup.log 2>&1
```

#### Before Critical Operations

```bash
# Before database migration
./scripts/backup.sh --type db --compress

# Before major code deployment
./scripts/backup.sh --compress

# Before storage cleanup
./scripts/backup.sh --type files
```

### Retention Policy

Recommended retention:

- **Daily backups:** Keep last 7 days
- **Weekly backups:** Keep last 4 weeks
- **Monthly backups:** Keep last 12 months

**Cleanup script:**

```bash
# Delete backups older than 7 days
find /Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backups -name "backup-*" -mtime +7 -exec rm -rf {} \;
```

### Storage Management

**Compressed backups:**

```bash
# Always use --compress for production
./scripts/backup.sh --compress

# Size reduction: ~50-70%
# Before: 500MB → After: 150MB
```

**Remote backup:**

```bash
# After backup, copy to remote storage
rsync -avz backups/ user@backup-server:/backups/bookreader/

# Or use cloud storage
aws s3 sync backups/ s3://mybucket/bookreader-backups/
```

### Testing Restores

**Test restore regularly:**

```bash
# 1. Create test backup
./scripts/backup.sh --type db

# 2. Test restore on staging
./scripts/restore.sh backup-2025-10-24-173231 --type db

# 3. Verify data integrity
docker exec bookreader_postgres psql -U postgres -d bookreader_dev -c "SELECT COUNT(*) FROM books;"
```

---

## Automation

### Cron Jobs

**Setup automated backups:**

```bash
# Edit crontab
crontab -e

# Add these lines:

# Daily database backup at 2 AM
0 2 * * * cd /opt/bookreader && ./scripts/backup.sh --type db --compress >> /var/log/backup.log 2>&1

# Weekly full backup on Sunday at 3 AM
0 3 * * 0 cd /opt/bookreader && ./scripts/backup.sh --compress >> /var/log/backup.log 2>&1

# Cleanup old backups daily at 4 AM
0 4 * * * find /opt/bookreader/backups -name "backup-*" -mtime +7 -exec rm -rf {} \;
```

### Systemd Timer (Linux)

**Create backup service:**

```ini
# /etc/systemd/system/bookreader-backup.service
[Unit]
Description=BookReader AI Daily Backup
Wants=bookreader-backup.timer

[Service]
Type=oneshot
WorkingDirectory=/opt/bookreader
ExecStart=/opt/bookreader/scripts/backup.sh --type db --compress
User=bookreader
StandardOutput=journal
```

**Create backup timer:**

```ini
# /etc/systemd/system/bookreader-backup.timer
[Unit]
Description=BookReader AI Daily Backup Timer
Requires=bookreader-backup.service

[Timer]
OnCalendar=daily
OnCalendar=02:00
Persistent=true

[Install]
WantedBy=timers.target
```

**Enable timer:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable bookreader-backup.timer
sudo systemctl start bookreader-backup.timer
sudo systemctl status bookreader-backup.timer
```

### Backup Monitoring

**Create monitoring script:**

```bash
#!/bin/bash
# scripts/check-backup-status.sh

BACKUP_DIR="/opt/bookreader/backups"
ALERT_EMAIL="admin@example.com"

# Find latest backup
LATEST=$(find "${BACKUP_DIR}" -name "backup-*" -type d -printf '%T+ %p\n' | sort -r | head -1)

# Extract timestamp
BACKUP_TIME=$(echo "${LATEST}" | awk '{print $1}')
NOW=$(date +%s)
BACKUP_TS=$(date -d "${BACKUP_TIME}" +%s)

# Check if backup is older than 26 hours
AGE=$((NOW - BACKUP_TS))
if [ ${AGE} -gt 93600 ]; then
    echo "WARNING: Latest backup is ${AGE} seconds old!" | mail -s "BookReader Backup Alert" "${ALERT_EMAIL}"
fi
```

---

## Troubleshooting

### Common Issues

#### 1. Container Not Running

**Error:**
```
✗ Container bookreader_postgres is not running
```

**Solution:**
```bash
# Start containers
docker-compose up -d

# Verify
docker ps | grep bookreader
```

#### 2. Permission Denied

**Error:**
```
Permission denied: /Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backups
```

**Solution:**
```bash
# Create backup directory
mkdir -p backups

# Fix permissions
chmod 755 backups

# Or run as root (not recommended)
sudo ./scripts/backup.sh
```

#### 3. Database Dump Empty

**Error:**
```
✗ Database dump failed or is empty
```

**Solution:**
```bash
# Check database exists
docker exec bookreader_postgres psql -U postgres -l

# Manually test pg_dump
docker exec bookreader_postgres pg_dump -U postgres -d bookreader_dev > test.sql

# Check credentials in .env
cat .env | grep POSTGRES
```

#### 4. Disk Space Full

**Error:**
```
No space left on device
```

**Solution:**
```bash
# Check disk space
df -h

# Clean old backups
find backups/ -name "backup-*" -mtime +7 -delete

# Use compression
./scripts/backup.sh --compress
```

#### 5. Restore Fails

**Error:**
```
✗ Database restoration failed
```

**Solution:**
```bash
# Check backup integrity
cat backups/backup-2025-10-24-173231/manifest.txt

# Check PostgreSQL logs
docker logs bookreader_postgres

# Try manual restore
docker exec -i bookreader_postgres psql -U postgres -d bookreader_dev < backups/backup-2025-10-24-173231/database/postgres_bookreader_dev.sql
```

### Debug Mode

**Enable verbose output:**

```bash
# Add set -x to script
bash -x ./scripts/backup.sh --type db
```

### Verify Backup Integrity

```bash
# Check manifest
cat backups/backup-2025-10-24-173231/manifest.txt

# Verify database dump
head -50 backups/backup-2025-10-24-173231/database/postgres_bookreader_dev.sql

# Check file sizes
du -sh backups/backup-2025-10-24-173231/*

# Verify git bundle
git bundle verify backups/backup-2025-10-24-173231/git/repository.bundle
```

---

## Performance Metrics

### Backup Performance

| Type | Size | Time | CPU | Memory |
|------|------|------|-----|--------|
| Database only | ~150MB | 30s | 20% | 200MB |
| Files only | ~500MB | 60s | 15% | 100MB |
| Full backup | ~700MB | 120s | 25% | 300MB |
| Full compressed | ~200MB | 180s | 40% | 500MB |

### Restore Performance

| Type | Time | Downtime |
|------|------|----------|
| Database | 45s | ~60s (restart) |
| Files | 30s | 0s |
| Full | 90s | ~60s (restart) |

---

## Security Considerations

### Sensitive Data

**Backups contain:**
- User data (emails, passwords hashes)
- Book content (copyrighted material)
- API keys (if stored in DB)
- Session tokens (Redis)

**Recommendations:**

1. **Encrypt backups:**
   ```bash
   # Compress and encrypt
   ./scripts/backup.sh --compress
   gpg --encrypt backups/backup-2025-10-24-173231.tar.gz
   ```

2. **Secure storage:**
   ```bash
   # Restrict access
   chmod 600 backups/*.tar.gz

   # Move to secure location
   mv backups/*.tar.gz /secure/backups/
   ```

3. **Rotate credentials:**
   - Don't store in backups
   - Use environment variables
   - Rotate after restore

### Access Control

**Backup directory permissions:**

```bash
# Only owner can access
chmod 700 backups/

# Restrict script execution
chmod 750 scripts/backup.sh
chmod 750 scripts/restore.sh
```

---

## Migration Scenarios

### Migrate to New Server

```bash
# 1. On old server: create full backup
./scripts/backup.sh --compress

# 2. Copy to new server
scp backups/backup-2025-10-24-173231.tar.gz user@newserver:/tmp/

# 3. On new server: setup project
git clone <repo-url>
cd bookreader-ai
docker-compose up -d

# 4. Restore backup
./scripts/restore.sh /tmp/backup-2025-10-24-173231.tar.gz

# 5. Verify
curl http://localhost:8000/api/v1/health
```

### Clone Production to Staging

```bash
# 1. Production: database backup
./scripts/backup.sh --type db --compress

# 2. Copy to staging
scp backups/backup-*.tar.gz staging:/tmp/

# 3. Staging: restore
./scripts/restore.sh /tmp/backup-*.tar.gz --type db --force

# 4. Sanitize data (optional)
docker exec bookreader_postgres psql -U postgres -d bookreader_dev << EOF
UPDATE users SET email = CONCAT('user', id, '@staging.local');
UPDATE users SET password_hash = 'dummy';
EOF
```

---

## Appendix

### Environment Variables

Recognized environment variables:

```bash
# PostgreSQL
POSTGRES_USER=postgres      # Database user
POSTGRES_DB=bookreader_dev  # Database name
POSTGRES_PASSWORD=postgres  # Database password

# Docker containers (override defaults)
POSTGRES_CONTAINER=bookreader_postgres
REDIS_CONTAINER=bookreader_redis
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (missing backup, container not running) |
| 2 | User cancelled (restore only) |

### File Locations

| Path | Description |
|------|-------------|
| `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/scripts/backup.sh` | Backup script |
| `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/scripts/restore.sh` | Restore script |
| `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backups/` | Backup storage |
| `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backend/storage/` | Application storage |

---

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Review backup logs: `cat backups/backup-*/manifest.txt`
3. Check container logs: `docker logs bookreader_postgres`
4. Open GitHub issue with backup manifest

---

**Last Updated:** 2025-10-24
**Version:** 1.0.0
**Maintainer:** DevOps Team
