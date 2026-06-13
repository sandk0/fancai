# Staging Deployment Checklist

**Version:** 1.0
**Date:** 2025-11-15
**Environment:** Staging (4GB RAM, 2 CPU cores)
**Deployment ID:** _____________
**Deployed By:** _____________
**Date:** _____________

---

## Pre-Deployment Checks

### Server Preparation

- [ ] Server accessible via SSH
- [ ] Non-root user created with sudo access
- [ ] SSH key authentication configured
- [ ] Password authentication disabled
- [ ] Server has 4GB+ RAM
- [ ] Server has 2+ CPU cores
- [ ] Server has 100GB+ storage (SSD preferred)
- [ ] Swap configured (2GB minimum)
- [ ] Timezone set correctly
- [ ] System packages updated (`sudo apt update && sudo apt upgrade -y`)

**Verification:**

```bash
free -h          # Check RAM and swap
df -h            # Check disk space
nproc            # Check CPU cores
timedatectl      # Check timezone
```

### Software Installation

- [ ] Docker 24.0+ installed
- [ ] Docker Compose 2.20+ installed (plugin version)
- [ ] Git 2.x+ installed
- [ ] curl/wget installed
- [ ] UFW firewall installed
- [ ] (Optional) htop installed
- [ ] (Optional) ncdu installed
- [ ] User added to docker group (`docker run hello-world` works without sudo)

**Verification:**

```bash
docker --version              # Should be 24.0+
docker compose version        # Should be 2.20+
git --version                 # Any 2.x
docker run hello-world        # Should work without sudo
```

### Network Configuration

- [ ] Domain DNS configured (A record pointing to server IP)
- [ ] DNS propagation verified (`dig +short staging.yourdomain.com`)
- [ ] Firewall rules configured (ports 22, 80, 443)
- [ ] UFW enabled
- [ ] (Optional) Fail2ban installed and configured
- [ ] Network bandwidth adequate (100 Mbps minimum)

**Verification:**

```bash
dig +short staging.yourdomain.com   # Should return server IP
sudo ufw status                      # Should show active with rules
ping -c 3 8.8.8.8                    # Internet connectivity
```

### Secrets Preparation

- [ ] SECRET_KEY generated (64+ chars)
- [ ] JWT_SECRET_KEY generated (64+ chars)
- [ ] DB_PASSWORD generated (32+ chars)
- [ ] REDIS_PASSWORD generated (32+ chars)
- [ ] All secrets stored in password manager
- [ ] Admin password chosen (16+ chars)
- [ ] SMTP credentials available (if using email)
- [ ] (Optional) OPENAI_API_KEY available

**Generation:**

```bash
# SECRET_KEY and JWT_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# DB_PASSWORD and REDIS_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Save all in password manager!
```

### SSL Strategy

- [ ] SSL strategy decided (Let's Encrypt or Self-signed)
- [ ] If Let's Encrypt: SSL_EMAIL configured
- [ ] If Self-signed: Understanding of browser warnings

---

## Deployment Steps

### Step 1: Clone Repository

- [ ] SSH to server as non-root user
- [ ] Navigate to `/opt` (or chosen directory)
- [ ] Create `bookreader` directory
- [ ] Clone repository
- [ ] Verify repository structure (docker-compose files present)

**Commands:**

```bash
cd /opt
sudo mkdir -p bookreader
sudo chown $USER:$USER bookreader
cd bookreader
git clone https://github.com/your-org/fancai-vibe-hackathon.git
cd fancai-vibe-hackathon
```

**Verification:**

```bash
ls -la                           # Check files present
git log --oneline -5             # Check latest commits
```

### Step 2: Environment Configuration

- [ ] Copy `.env.staging.example` to `.env.staging`
- [ ] Set `DOMAIN_NAME` to your staging domain
- [ ] Set `DOMAIN_URL` to `https://staging.yourdomain.com`
- [ ] Set `SSL_EMAIL` for Let's Encrypt
- [ ] Set `DB_PASSWORD` from secrets
- [ ] Set `REDIS_PASSWORD` from secrets
- [ ] Set `SECRET_KEY` from secrets
- [ ] Set `JWT_SECRET_KEY` from secrets
- [ ] (Optional) Set `OPENAI_API_KEY` if using DALL-E
- [ ] Verify no placeholder values remain (`grep "REPLACE_WITH" .env.staging`)

**Commands:**

```bash
cp .env.staging.example .env.staging
nano .env.staging  # or vim

# Verify
grep "REPLACE_WITH" .env.staging  # Should have NO output
```

### Step 3: SSL Certificates

#### Option A: Let's Encrypt

- [ ] Verify DNS points to server
- [ ] Create temporary self-signed cert for initial nginx start
- [ ] Stop nginx if running
- [ ] Install certbot
- [ ] Run certbot to obtain certificate
- [ ] Copy certificates to `nginx/ssl/`
- [ ] Set correct permissions
- [ ] Setup auto-renewal cron job

**Commands:**

```bash
# Create temporary cert
mkdir -p nginx/ssl
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -days 1 -subj "/CN=${DOMAIN_NAME}"

# Install certbot
sudo apt install -y certbot

# Obtain certificate
sudo certbot certonly --standalone \
  --email ${SSL_EMAIL} \
  --agree-tos \
  -d staging.yourdomain.com

# Copy to nginx
sudo cp /etc/letsencrypt/live/staging.yourdomain.com/*.pem nginx/ssl/
sudo chown $USER:$USER nginx/ssl/*.pem
```

#### Option B: Self-Signed

- [ ] Generate self-signed certificate (365 days)
- [ ] Certificates created in `nginx/ssl/`
- [ ] Understand browsers will show warnings

**Commands:**

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=BookReader/CN=staging.yourdomain.com"
```

**Verification:**

- [ ] `nginx/ssl/fullchain.pem` exists
- [ ] `nginx/ssl/privkey.pem` exists
- [ ] Files are readable by user

### Step 4: Build and Start Services

- [ ] Create required directories
- [ ] Build Docker images
- [ ] Verify images built successfully
- [ ] Start all services in background
- [ ] Wait for services to initialize (30-60 seconds)
- [ ] Check all containers running
- [ ] Check all containers healthy

**Commands:**

```bash
# Create directories
mkdir -p backend/storage/{books,uploads,exports}
sudo mkdir -p /backups/postgresql
sudo chown $USER:$USER /backups/postgresql

# Build
docker compose -f docker-compose.staging.yml build

# Start
docker compose -f docker-compose.staging.yml up -d

# Wait
sleep 60

# Check status
docker compose -f docker-compose.staging.yml ps
```

**Verification:**

- [ ] All services show STATUS "Up"
- [ ] All services show HEALTH "healthy" (or no healthcheck)
- [ ] No containers restarting

### Step 5: Database Initialization

- [ ] Wait for PostgreSQL to be ready
- [ ] Test database connection from backend
- [ ] Check current migration status
- [ ] Run database migrations
- [ ] Verify migrations completed
- [ ] Run database verification script
- [ ] Check extensions installed (pg_stat_statements, pg_trgm, etc.)
- [ ] Verify helper functions created

**Commands:**

```bash
# Test connection
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from app.core.database import engine; import asyncio; asyncio.run(engine.connect())"

# Migrations
docker compose -f docker-compose.staging.yml exec backend alembic current
docker compose -f docker-compose.staging.yml exec backend alembic upgrade head
docker compose -f docker-compose.staging.yml exec backend alembic current

# Verification
./scripts/verify-database-config.sh
```

**Verification:**

- [ ] Migrations show HEAD revision
- [ ] Extensions verified: `pg_stat_statements`, `pg_trgm`, `btree_gin`, `uuid-ossp`
- [ ] Helper functions work: `SELECT * FROM get_database_size();`

### Step 6: Create Admin User

- [ ] Admin email decided
- [ ] Admin password chosen (16+ chars)
- [ ] Create admin user via script or direct command
- [ ] Verify admin user created

**Commands:**

```bash
docker compose -f docker-compose.staging.yml exec backend \
  python -c "
from app.core.database import get_db
from app.models.user import User
from app.core.security import get_password_hash
import asyncio

async def create_admin():
    async for db in get_db():
        admin = User(
            email='admin@yourdomain.com',
            username='admin',
            hashed_password=get_password_hash('YourAdminPassword123!'),
            is_active=True,
            is_admin=True
        )
        db.add(admin)
        await db.commit()
        print(f'Admin created: {admin.email}')
        break

asyncio.run(create_admin())
"
```

**Verification:**

- [ ] Admin user creation message shown
- [ ] No errors in command output

---

## Post-Deployment Verification

### Service Health Checks

- [ ] All containers running (`docker compose ps`)
- [ ] Memory usage <3.5GB (`docker stats --no-stream`)
- [ ] CPU usage <80% (`docker stats --no-stream`)
- [ ] Swap usage <500MB (`free -h`)
- [ ] Disk usage <80% (`df -h`)
- [ ] No critical errors in logs

**Commands:**

```bash
docker compose -f docker-compose.staging.yml ps
docker stats --no-stream
free -h
df -h
docker compose -f docker-compose.staging.yml logs --tail=200 | grep -i error
```

### Endpoint Testing

- [ ] Main site loads: `https://staging.yourdomain.com`
- [ ] Health endpoint: `GET /health` returns 200 OK
- [ ] API health endpoint: `GET /api/health` returns JSON
- [ ] API documentation: `GET /docs` loads Swagger UI
- [ ] SSL certificate valid (no browser warnings for Let's Encrypt)
- [ ] HTTPS redirect works (HTTP → HTTPS)

**Commands:**

```bash
# Health checks
curl -I https://staging.yourdomain.com/health        # Should return 200
curl https://staging.yourdomain.com/api/health       # Should return JSON

# SSL test
openssl s_client -connect staging.yourdomain.com:443 -servername staging.yourdomain.com

# HTTPS redirect
curl -I http://staging.yourdomain.com                # Should redirect 301/302 to HTTPS
```

### Authentication Testing

- [ ] Can access login page
- [ ] Admin login works
- [ ] JWT token received
- [ ] Authenticated API requests work

**Commands:**

```bash
# Login as admin
curl -X POST https://staging.yourdomain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "YourAdminPassword123!"
  }'

# Should return access_token

# Test authenticated endpoint (use token from above)
TOKEN="<access_token_from_login>"
curl https://staging.yourdomain.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN"
```

**Verification:**

- [ ] Login returns `access_token` and `refresh_token`
- [ ] `/users/me` returns admin user details

### NLP Models Testing

- [ ] SpaCy model loads
- [ ] Natasha library works
- [ ] Stanza model loads
- [ ] Multi-NLP status endpoint works

**Commands:**

```bash
# SpaCy
docker compose -f docker-compose.staging.yml exec backend \
  python -c "import spacy; nlp = spacy.load('ru_core_news_lg'); print('✅ SpaCy OK')"

# Natasha
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from natasha import NamesExtractor; print('✅ Natasha OK')"

# Stanza
docker compose -f docker-compose.staging.yml exec backend \
  python -c "import stanza; print('✅ Stanza OK')"

# Multi-NLP status (if endpoint exists)
curl https://staging.yourdomain.com/api/v1/admin/multi-nlp-settings/status \
  -H "Authorization: Bearer $TOKEN"
```

**Verification:**

- [ ] All three NLP libraries load without errors
- [ ] No "ModuleNotFoundError" messages

### Database Configuration

- [ ] PostgreSQL config loaded from custom postgresql.conf
- [ ] Redis config loaded from custom redis.conf
- [ ] Cache hit ratio >95% (will improve over time)
- [ ] Connection pool working
- [ ] No connection errors in logs

**Commands:**

```bash
# PostgreSQL config
docker exec bookreader_postgres_staging psql -U postgres -c "SHOW shared_buffers;"
docker exec bookreader_postgres_staging psql -U postgres -c "SHOW max_connections;"

# Cache hit ratio
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT
    ROUND(sum(heap_blks_hit)::NUMERIC /
          nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2)
    as cache_hit_ratio
  FROM pg_statio_user_tables;
"

# Redis config
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} CONFIG GET maxmemory
```

**Verification:**

- [ ] PostgreSQL `shared_buffers` = 128MB
- [ ] PostgreSQL `max_connections` = 100
- [ ] Redis `maxmemory` = 384MB

---

## Post-Deployment Configuration

### Backup Setup

- [ ] Backup script executable (`chmod +x scripts/backup-database.sh`)
- [ ] Test backup runs successfully
- [ ] Backup created in `/backups/postgresql/`
- [ ] Backup cron job added (daily at 2 AM)
- [ ] Cron job tested (`sudo crontab -l`)

**Commands:**

```bash
# Make executable
chmod +x scripts/backup-database.sh

# Test
./scripts/backup-database.sh

# Verify
ls -lh /backups/postgresql/

# Add cron
crontab -e
# Add line:
# 0 2 * * * cd /opt/bookreader/fancai-vibe-hackathon && ./scripts/backup-database.sh >> /var/log/backup-database.log 2>&1
```

**Verification:**

- [ ] Backup file exists: `backup_bookreader_staging_YYYYMMDD_HHMMSS.dump`
- [ ] Backup log shows success
- [ ] Cron job listed in `crontab -l`

### Monitoring Setup

- [ ] Resource monitoring script created (optional)
- [ ] Uptime monitoring configured (UptimeRobot, etc.)
- [ ] Health check cron job added (every 5 minutes)
- [ ] (Optional) Prometheus + Grafana enabled

**Commands:**

```bash
# Health check cron
crontab -e
# Add:
# */5 * * * * curl -sf https://staging.yourdomain.com/health || echo "Staging DOWN!" | mail -s "ALERT" admin@yourdomain.com
```

### Log Rotation

- [ ] Docker log limits configured in compose file
- [ ] (Optional) Logrotate service enabled
- [ ] (Optional) System logrotate configured

**Verification:**

```bash
# Check compose file has logging limits
grep -A 5 "logging:" docker-compose.staging.yml
```

### SSL Auto-Renewal (Let's Encrypt Only)

- [ ] Certbot renewal cron job added
- [ ] Test renewal command
- [ ] Renewal script restarts nginx

**Commands:**

```bash
# Add to crontab
sudo crontab -e
# Add:
# 0 3 * * * certbot renew --quiet --deploy-hook "cp /etc/letsencrypt/live/staging.yourdomain.com/*.pem /opt/bookreader/fancai-vibe-hackathon/nginx/ssl/ && docker compose -f /opt/bookreader/fancai-vibe-hackathon/docker-compose.staging.yml restart nginx"

# Test renewal (dry run)
sudo certbot renew --dry-run
```

---

## Functional Testing

### User Flows

- [ ] User registration works
- [ ] User login works
- [ ] JWT token refresh works
- [ ] (Optional) Book upload works
- [ ] (Optional) Book parsing works
- [ ] (Optional) Image generation works

**Test Scripts:**

```bash
# 1. Register user
curl -X POST https://staging.yourdomain.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "TestPass123!"
  }'

# 2. Login
curl -X POST https://staging.yourdomain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!"
  }'

# 3. Get user profile (use token from login)
TOKEN="<access_token>"
curl https://staging.yourdomain.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN"
```

### Load Testing (Optional)

- [ ] Simple load test performed (ab, wrk, or k6)
- [ ] Response times <2 seconds
- [ ] No errors under moderate load (10-50 concurrent users)
- [ ] Memory stable under load

**Commands:**

```bash
# Apache Bench (install: sudo apt install apache2-utils)
ab -n 100 -c 10 https://staging.yourdomain.com/health

# Should show:
# - Requests per second: >10
# - Mean response time: <500ms
# - Failed requests: 0
```

---

## Documentation

### Deployment Documentation

- [ ] Deployment date recorded
- [ ] Deployed version/commit recorded
- [ ] Any deviations from standard procedure documented
- [ ] Known issues documented
- [ ] Post-deployment notes added

**Create Deployment Log:**

```bash
cat > DEPLOYMENT_LOG.md << EOF
# Deployment Log - Staging

## 2025-11-15 Deployment

**Deployed By:** <your_name>
**Commit:** $(git rev-parse HEAD)
**Started:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")

### Changes Deployed
- Initial staging deployment
- All services configured for 4GB RAM server

### Deviations from Standard
- None

### Known Issues
- None

### Post-Deployment Notes
- All tests passed
- Performance within expected ranges

**Completed:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
EOF
```

### Team Handoff

- [ ] Operations team notified of deployment
- [ ] Access credentials shared (via secure channel)
- [ ] Quick reference card distributed
- [ ] Escalation procedures communicated
- [ ] Monitoring dashboards shared (if any)

---

## Sign-Off

### Pre-Deployment Sign-Off

I have verified that all pre-deployment checks are complete:

**Signature:** _________________ **Date:** _____________

### Deployment Sign-Off

I have successfully completed the deployment:

**Signature:** _________________ **Date:** _____________

### Verification Sign-Off

I have verified all post-deployment checks:

**Signature:** _________________ **Date:** _____________

---

## Rollback Plan (If Issues Found)

If critical issues discovered after deployment:

1. **Stop Services:**
   ```bash
   docker compose -f docker-compose.staging.yml down
   ```

2. **Checkout Previous Version:**
   ```bash
   git checkout <previous_working_commit>
   ```

3. **Restore Database (if schema changed):**
   ```bash
   # Use latest backup BEFORE this deployment
   ```

4. **Restart Services:**
   ```bash
   docker compose -f docker-compose.staging.yml up -d
   ```

5. **Document Issue:**
   - What went wrong
   - Why rollback needed
   - Lessons learned

---

## Next Steps

### Immediate (First 24 Hours)

- [ ] Monitor resource usage closely
- [ ] Review logs for any warnings/errors
- [ ] Test critical user flows manually
- [ ] Verify backups running successfully
- [ ] Check SSL certificate valid
- [ ] Monitor uptime

### Short-Term (First Week)

- [ ] Review performance metrics
- [ ] Optimize based on actual usage
- [ ] Test backup restoration procedure
- [ ] Train team on operations
- [ ] Document any issues found
- [ ] Fine-tune resource allocation if needed

### Ongoing

- [ ] Weekly: Review slow queries
- [ ] Weekly: Check backup success
- [ ] Monthly: Rotate secrets
- [ ] Monthly: Update system packages
- [ ] Quarterly: Test disaster recovery
- [ ] Quarterly: Review and optimize indexes

---

## Reference

**Full Guide:** [Staging Deployment Guide](./staging-deployment-4gb-server.md)
**Quick Reference:** [Quick Reference Card](./staging-quick-reference.md)
**Database Guide:** [Database Optimization](./database-optimization-4gb-server.md)

---

**Checklist Version:** 1.0
**Last Updated:** 2025-11-15
**Next Review:** 2025-12-15
