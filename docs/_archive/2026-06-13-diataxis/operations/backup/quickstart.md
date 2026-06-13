# BookReader AI - Backup & Restore Quick Start

Quick reference guide for backup and restore operations.

---

## Quick Commands

### Backup

```bash
# Full backup with compression (RECOMMENDED)
./scripts/backup.sh --compress

# Database only (fast, for daily backups)
./scripts/backup.sh --type db

# All backup types
./scripts/backup.sh --type full      # Database + Redis + Storage + Git + Archive
./scripts/backup.sh --type db        # Database + Redis only
./scripts/backup.sh --type files     # Storage files only
./scripts/backup.sh --type git       # Git repository only
```

### Restore

```bash
# List available backups
./scripts/restore.sh

# Restore from backup (interactive)
./scripts/restore.sh backup-2025-10-24-173231

# Restore database only
./scripts/restore.sh backup-2025-10-24-173231 --type db

# Restore without confirmation (DANGEROUS!)
./scripts/restore.sh backup-2025-10-24-173231 --force
```

---

## Common Scenarios

### Before Database Migration

```bash
# 1. Create database backup
./scripts/backup.sh --type db --compress

# 2. Run migration
docker exec bookreader_backend alembic upgrade head

# 3. If migration fails, restore:
./scripts/restore.sh backup-YYYY-MM-DD-HHMMSS --type db
```

### Before Production Deployment

```bash
# 1. Full backup
./scripts/backup.sh --compress

# 2. Deploy
./scripts/deploy-production.sh

# 3. If deployment fails, restore:
./scripts/restore.sh backup-YYYY-MM-DD-HHMMSS
docker-compose restart
```

### Daily Automated Backups

```bash
# Add to crontab:
crontab -e

# Daily database backup at 2 AM
0 2 * * * cd /opt/bookreader && ./scripts/backup.sh --type db --compress >> /var/log/backup.log 2>&1
```

### Clone Production to Staging

```bash
# Production server:
./scripts/backup.sh --type db --compress
scp backups/backup-*.tar.gz staging:/tmp/

# Staging server:
./scripts/restore.sh /tmp/backup-*.tar.gz --type db --force
docker-compose restart
```

---

## Backup Contents

| Type | PostgreSQL | Redis | Storage | Git | Archive | Size | Time |
|------|-----------|-------|---------|-----|---------|------|------|
| `full` | ✅ | ✅ | ✅ | ✅ | ✅ | ~700MB | 2-3 min |
| `db` | ✅ | ✅ | ❌ | ❌ | ❌ | ~150MB | 30-60s |
| `files` | ❌ | ❌ | ✅ | ❌ | ❌ | ~500MB | 1-2 min |
| `git` | ❌ | ❌ | ❌ | ✅ | ❌ | ~50MB | 10-20s |

---

## Backup Output Structure

```
backups/backup-2025-10-24-173231/
├── database/
│   ├── postgres_bookreader_dev.sql    # Full database dump (158MB)
│   ├── schema_bookreader_dev.sql      # Schema only
│   └── db_metadata.txt                # Database info
├── redis/
│   ├── dump.rdb                       # Redis snapshot (4KB)
│   └── redis_info.txt                 # Redis stats
├── storage/                           # Books, images, covers
├── git/
│   └── repository.bundle              # Git bundle
└── manifest.txt                       # Backup metadata
```

---

## Safety Features

### Backup

- ✅ Timestamped backups (never overwrites)
- ✅ Manifest with metadata
- ✅ Health checks before backup
- ✅ Auto-detects database name
- ✅ Creates full project archive

### Restore

- ✅ Confirmation prompts (skip with `--force`)
- ✅ Backup validation
- ✅ Backs up current storage before overwriting
- ✅ Container health checks
- ✅ Safely terminates DB connections

---

## Troubleshooting

### Container Not Running

```bash
# Start containers
docker-compose up -d

# Verify
docker ps | grep bookreader
```

### Permission Denied

```bash
# Create backup directory
mkdir -p backups
chmod 755 backups
```

### Disk Space Full

```bash
# Check space
df -h

# Clean old backups (older than 7 days)
find backups/ -name "backup-*" -mtime +7 -delete

# Use compression
./scripts/backup.sh --compress
```

### Database Dump Empty

```bash
# Check database name
docker exec bookreader_postgres psql -U postgres -l

# Verify credentials
cat .env | grep POSTGRES
```

---

## Best Practices

### Production

1. **Daily database backups** - Automated at 2 AM
2. **Weekly full backups** - Sunday at 3 AM
3. **Before critical operations** - Manual backup
4. **Compress for storage** - Use `--compress`
5. **Remote backup** - Copy to cloud/remote server
6. **Test restores** - Monthly verification
7. **Retention policy** - 7 daily, 4 weekly, 12 monthly

### Development

1. **Before migrations** - Database backup
2. **Before major changes** - Full backup
3. **Quick snapshots** - `--type db`

---

## Environment Variables

```bash
# Override defaults (optional)
export POSTGRES_USER=postgres
export POSTGRES_DB=bookreader_dev
export POSTGRES_PASSWORD=postgres
export POSTGRES_CONTAINER=bookreader_postgres
export REDIS_CONTAINER=bookreader_redis
```

---

## Full Documentation

See [scripts/README_BACKUP.md](scripts/README_BACKUP.md) for:
- Detailed usage examples
- Automation setup (cron, systemd)
- Performance metrics
- Migration scenarios
- Security considerations
- Complete troubleshooting guide

---

## Support

**Help commands:**

```bash
./scripts/backup.sh --help
./scripts/restore.sh --help
```

**Check logs:**

```bash
# Backup manifest
cat backups/backup-YYYY-MM-DD-HHMMSS/manifest.txt

# Container logs
docker logs bookreader_postgres
docker logs bookreader_redis
```

---

**Last Updated:** 2025-10-24
**Scripts Location:** `/Users/sandk/Documents/GitHub/fancai-vibe-hackathon/scripts/`
