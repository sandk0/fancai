# Deployment Guide for BookReader AI

Comprehensive guide for deploying BookReader AI to staging and production environments using automated CI/CD pipelines.

## Table of Contents

- [Deployment Overview](#deployment-overview)
- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Deployment Methods](#deployment-methods)
- [Zero-Downtime Deployment](#zero-downtime-deployment)
- [Rollback Procedures](#rollback-procedures)
- [Health Checks](#health-checks)
- [Troubleshooting](#troubleshooting)
- [Post-Deployment](#post-deployment)

---

## Deployment Overview

### Deployment Architecture

```
┌─────────────────┐
│  GitHub Actions │
│   (CI/CD)       │
└────────┬────────┘
         │
         ├──────────────────┬──────────────────┐
         │                  │                  │
         v                  v                  v
    Build Images      Deploy Staging   Deploy Production
         │                  │                  │
         v                  v                  v
   ┌─────────────┐    ┌──────────┐      ┌──────────────┐
   │   GitHub    │    │ Staging  │      │  Production  │
   │  Container  │    │  Server  │      │    Server    │
   │  Registry   │    └──────────┘      └──────────────┘
   └─────────────┘
```

### Deployment Strategies

**BookReader AI uses three deployment strategies:**

1. **Staging (Auto)** - Automatic deployment on main branch push
2. **Production (Manual Tag)** - Requires version tag (v1.0.0)
3. **Production (Manual Dispatch)** - Manual workflow trigger with approval

---

## Prerequisites

### Required Access

- [ ] GitHub repository admin access
- [ ] SSH access to staging/production servers
- [ ] Docker Hub or GitHub Container Registry credentials
- [ ] Database backup access
- [ ] DNS/Domain configuration (for SSL)

### Server Requirements

**Minimum (Staging):**
- 2 CPU cores
- 4 GB RAM
- 40 GB SSD
- Ubuntu 20.04+ / Debian 11+

**Recommended (Production):**
- 4 CPU cores
- 8 GB RAM
- 100 GB SSD
- Ubuntu 22.04 LTS

### Software Prerequisites

**On deployment server:**
```bash
# Docker Engine 24.0+
docker --version

# Docker Compose 2.20+
docker-compose --version

# Git
git --version

# Basic utilities
curl --version
```

---

## Server Setup

### Step 1: Initial Server Configuration

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Create deployment user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy

# Setup SSH for deploy user
sudo su - deploy
mkdir -p ~/.ssh
chmod 700 ~/.ssh
```

### Step 2: Add GitHub Actions SSH Key

```bash
# On your local machine, generate deployment key
ssh-keygen -t ed25519 -f ~/.ssh/github-actions-deploy -C "github-actions@bookreader"

# Display public key
cat ~/.ssh/github-actions-deploy.pub

# On server, add to authorized_keys
sudo su - deploy
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

### Step 3: Clone Repository

```bash
sudo su - deploy
cd /opt
sudo mkdir bookreader
sudo chown deploy:deploy bookreader
cd bookreader

# Clone repository
git clone https://github.com/YOUR_USERNAME/fancai-vibe-hackathon.git .

# Verify
ls -la
```

### Step 4: Configure Environment

```bash
# Copy environment template
cp .env.example .env.production

# Edit environment variables
nano .env.production
```

**Required variables:**
```bash
# Database
DATABASE_URL=postgresql+asyncpg://postgres:STRONG_PASSWORD@postgres:5432/bookreader
POSTGRES_PASSWORD=STRONG_PASSWORD

# Redis
REDIS_URL=redis://redis:6379

# Application
SECRET_KEY=GENERATE_STRONG_SECRET_KEY
DEBUG=false
ENVIRONMENT=production

# API Keys
OPENAI_API_KEY=sk-...
POLLINATIONS_ENABLED=true

# Domain
DOMAIN=bookreader.example.com
```

**Generate strong secret key:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### Step 5: Setup Nginx and SSL

```bash
# Install certbot for Let's Encrypt
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot certonly --standalone -d bookreader.example.com

# Certificates will be at:
# /etc/letsencrypt/live/bookreader.example.com/fullchain.pem
# /etc/letsencrypt/live/bookreader.example.com/privkey.pem
```

### Step 6: Initial Deployment

```bash
# Build and start services
docker-compose -f docker-compose.production.yml up -d

# Run database migrations
docker-compose -f docker-compose.production.yml exec backend alembic upgrade head

# Check status
docker-compose -f docker-compose.production.yml ps
```

### Step 7: Verify Deployment

```bash
# Test backend health
curl http://localhost:8000/health

# Test frontend
curl http://localhost:3000

# Test Nginx
curl https://bookreader.example.com/api/health
```

---

## Deployment Methods

### Method 1: Automatic Deployment (Recommended)

**Via Git Tags (Production):**

```bash
# Create release tag
git tag -a v1.0.0 -m "Release version 1.0.0"

# Push tag to trigger deployment
git push origin v1.0.0
```

**What happens:**
1. GitHub Actions builds Docker images
2. Images pushed to GitHub Container Registry
3. Workflow waits for manual approval (production environment)
4. Database backup created
5. New containers deployed (blue-green)
6. Health checks performed
7. Old containers stopped if successful
8. Automatic rollback if health checks fail

**Timeline:**
- Build images: 3-5 minutes
- Waiting for approval: Manual
- Deployment: 2-3 minutes
- Total: 5-10 minutes (+ approval time)

### Method 2: Manual Deployment (Emergency)

**Via GitHub Actions UI:**

1. Go to repository **Actions** tab
2. Select **Deploy to Production** workflow
3. Click **Run workflow** button
4. Select environment:
   - `staging` - No approval required
   - `production` - Requires approval
5. Click **Run workflow**

**Via GitHub CLI:**

```bash
# Install GitHub CLI
brew install gh  # macOS
# or visit: https://cli.github.com/

# Login
gh auth login

# Trigger deployment
gh workflow run deploy.yml \
  -f environment=production

# Monitor deployment
gh run watch
```

### Method 3: Direct Server Deployment (Emergency Only)

**Use only when GitHub Actions is unavailable!**

```bash
# SSH to server
ssh deploy@prod-server

# Navigate to project
cd /opt/bookreader

# Pull latest code
git pull origin main

# Pull latest images (if available)
docker-compose -f docker-compose.production.yml pull

# Or build locally
docker-compose -f docker-compose.production.yml build

# Deploy
docker-compose -f docker-compose.production.yml up -d

# Run migrations
docker-compose -f docker-compose.production.yml exec backend alembic upgrade head

# Verify
curl http://localhost:8000/health
```

---

## Zero-Downtime Deployment

### Blue-Green Deployment Strategy

**How it works:**

```
┌─────────────┐         ┌─────────────┐
│   Blue      │ ◄──┐    │   Green     │
│ (Current)   │    │    │   (New)     │
│  Running    │    │    │  Starting   │
└─────────────┘    │    └─────────────┘
                   │
              Nginx routes
              traffic here
                   │
                   │
    ┌──────────────▼──────────────┐
    │  Health Check Passes        │
    │  Switch Traffic to Green    │
    └──────────────┬──────────────┘
                   │
                   ▼
         Stop Blue containers
```

**Implementation in deploy.yml:**

```yaml
- name: Deploy to production server
  run: |
    ssh ${{ secrets.PROD_USER }}@${{ secrets.PROD_HOST }} << 'EOF'
      cd /opt/bookreader

      # Start new containers (green)
      docker-compose -f docker-compose.production.yml up -d --no-deps backend frontend

      # Wait for health check
      sleep 30

      # Run migrations
      docker-compose -f docker-compose.production.yml exec -T backend alembic upgrade head

      # Reload Nginx (seamless handoff)
      docker-compose -f docker-compose.production.yml exec -T nginx nginx -s reload
    EOF
```

**Benefits:**
- Zero downtime during deployment
- Instant rollback if issues detected
- Database migrations applied safely
- No user-facing errors

### Rolling Updates

**For horizontal scaling (multiple replicas):**

```yaml
services:
  backend:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1        # Update 1 at a time
        delay: 10s            # Wait 10s between updates
        failure_action: rollback
        order: start-first    # Start new before stopping old
```

---

## Rollback Procedures

### Automatic Rollback (Built-in)

**Triggered when:**
- Health check fails 5 times
- Container fails to start
- Database migration fails

**What happens:**
```yaml
- name: Rollback on failure
  if: failure()
  run: |
    ssh ${{ secrets.PROD_USER }}@${{ secrets.PROD_HOST }} << 'EOF'
      cd /opt/bookreader
      docker-compose -f docker-compose.production.yml down
      git checkout HEAD~1
      docker-compose -f docker-compose.production.yml up -d
    EOF
```

### Manual Rollback (Emergency)

**Step 1: Identify previous working version**

```bash
# SSH to server
ssh deploy@prod-server
cd /opt/bookreader

# View recent tags/commits
git tag --sort=-version:refname | head -5
git log --oneline -10
```

**Step 2: Rollback to previous version**

```bash
# Stop current containers
docker-compose -f docker-compose.production.yml down

# Checkout previous version
git checkout v1.0.0  # Replace with working version

# Start containers
docker-compose -f docker-compose.production.yml up -d

# Verify
curl http://localhost:8000/health
```

**Step 3: Rollback database migrations (if needed)**

```bash
# Identify migration to rollback to
docker-compose -f docker-compose.production.yml exec backend alembic history

# Rollback to specific revision
docker-compose -f docker-compose.production.yml exec backend alembic downgrade <revision>

# Or rollback one step
docker-compose -f docker-compose.production.yml exec backend alembic downgrade -1
```

**Step 4: Restore database backup (if needed)**

```bash
# List available backups
ls -lh /opt/bookreader/backups/

# Restore backup
docker-compose -f docker-compose.production.yml exec -T postgres \
  psql -U postgres -d bookreader < /opt/bookreader/backups/backup-20250129.sql
```

### Rollback Checklist

- [ ] Identify issue and root cause
- [ ] Determine last known good version
- [ ] Backup current state (if possible)
- [ ] Stop current containers
- [ ] Checkout previous version
- [ ] Rollback database migrations (if needed)
- [ ] Restore database backup (if needed)
- [ ] Start containers
- [ ] Verify health checks
- [ ] Monitor application logs
- [ ] Notify team and users
- [ ] Document incident

---

## Health Checks

### Automated Health Checks

**During deployment (deploy.yml):**

```yaml
- name: Health check
  run: |
    sleep 60  # Wait for containers to start

    for i in {1..5}; do
      if curl -f https://bookreader.example.com/api/health; then
        echo "Health check passed"
        exit 0
      fi
      echo "Attempt $i failed, retrying..."
      sleep 10
    done

    echo "Health check failed after 5 attempts"
    exit 1
```

### Manual Health Checks

**Backend health:**
```bash
# Basic health
curl https://bookreader.example.com/api/health

# Expected response:
{
  "status": "healthy",
  "version": "1.0.0",
  "database": "connected",
  "redis": "connected"
}
```

**Database connectivity:**
```bash
docker-compose -f docker-compose.production.yml exec postgres \
  psql -U postgres -d bookreader -c "SELECT 1;"
```

**Redis connectivity:**
```bash
docker-compose -f docker-compose.production.yml exec redis redis-cli ping
# Expected: PONG
```

**Container status:**
```bash
docker-compose -f docker-compose.production.yml ps

# Expected: All containers "Up" and "healthy"
```

**Application logs:**
```bash
# Backend logs
docker-compose -f docker-compose.production.yml logs backend --tail=50

# Frontend logs
docker-compose -f docker-compose.production.yml logs frontend --tail=50

# Nginx logs
docker-compose -f docker-compose.production.yml logs nginx --tail=50
```

### Monitoring Health

**Setup monitoring endpoint:**

```bash
# Add to crontab for continuous monitoring
crontab -e

# Add:
*/5 * * * * curl -f https://bookreader.example.com/api/health || echo "Health check failed" | mail -s "BookReader Alert" admin@example.com
```

**Use external monitoring:**
- UptimeRobot (https://uptimerobot.com)
- Pingdom (https://www.pingdom.com)
- StatusCake (https://www.statuscake.com)

---

## Troubleshooting

### Issue 1: Deployment Fails - SSH Connection

**Symptoms:**
```
ssh: connect to host prod-server port 22: Connection refused
```

**Solutions:**

```bash
# Verify SSH key is correct
cat ~/.ssh/github-actions-deploy.pub

# Test SSH connection manually
ssh -i ~/.ssh/github-actions-deploy deploy@prod-server

# Check server SSH service
systemctl status sshd

# Verify firewall rules
sudo ufw status
sudo ufw allow 22/tcp
```

### Issue 2: Container Fails to Start

**Symptoms:**
```
Error response from daemon: Container exited with status 1
```

**Solutions:**

```bash
# Check container logs
docker-compose -f docker-compose.production.yml logs backend

# Common issues:
# 1. Environment variables missing
docker-compose -f docker-compose.production.yml exec backend env

# 2. Database not ready
docker-compose -f docker-compose.production.yml exec postgres pg_isready

# 3. Port conflicts
sudo netstat -tulpn | grep :8000
```

### Issue 3: Database Migration Fails

**Symptoms:**
```
ERROR: relation "users" already exists
```

**Solutions:**

```bash
# Check current migration state
docker-compose -f docker-compose.production.yml exec backend alembic current

# View migration history
docker-compose -f docker-compose.production.yml exec backend alembic history

# Force migration to specific revision
docker-compose -f docker-compose.production.yml exec backend alembic stamp <revision>

# Re-run migrations
docker-compose -f docker-compose.production.yml exec backend alembic upgrade head
```

### Issue 4: Health Check Fails

**Symptoms:**
```
curl: (7) Failed to connect to localhost port 8000: Connection refused
```

**Solutions:**

```bash
# Check if backend is running
docker-compose -f docker-compose.production.yml ps backend

# Check backend logs
docker-compose -f docker-compose.production.yml logs backend --tail=100

# Check if port is exposed
docker-compose -f docker-compose.production.yml port backend 8000

# Test internal health
docker-compose -f docker-compose.production.yml exec backend curl http://localhost:8000/health
```

### Issue 5: Nginx 502 Bad Gateway

**Symptoms:**
```
502 Bad Gateway
nginx/1.24.0
```

**Solutions:**

```bash
# Check backend is reachable from nginx
docker-compose -f docker-compose.production.yml exec nginx curl http://backend:8000/health

# Check nginx configuration
docker-compose -f docker-compose.production.yml exec nginx nginx -t

# Check nginx logs
docker-compose -f docker-compose.production.yml logs nginx --tail=100

# Restart nginx
docker-compose -f docker-compose.production.yml restart nginx
```

---

## Post-Deployment

### Verification Checklist

After successful deployment:

- [ ] Health endpoint returns 200 OK
- [ ] Homepage loads correctly
- [ ] User login works
- [ ] Book upload works
- [ ] Image generation works
- [ ] Database queries fast (<100ms)
- [ ] No errors in logs
- [ ] SSL certificate valid
- [ ] Monitoring alerts configured
- [ ] Backup system working

### Monitoring Setup

**Application Monitoring:**
```bash
# Start monitoring stack (optional)
docker-compose -f docker-compose.monitoring.yml up -d

# Access dashboards:
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3000
```

**Log Aggregation:**
```bash
# Setup log rotation
sudo nano /etc/logrotate.d/bookreader

# Add:
/opt/bookreader/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 deploy deploy
    sharedscripts
}
```

### Performance Optimization

**After deployment:**

```bash
# Check application performance
curl -w "@curl-format.txt" -o /dev/null -s https://bookreader.example.com

# Check database performance
docker-compose -f docker-compose.production.yml exec postgres \
  psql -U postgres -d bookreader -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"

# Check Redis cache hit rate
docker-compose -f docker-compose.production.yml exec redis redis-cli INFO stats | grep keyspace
```

### Documentation Updates

After deployment:

- [ ] Update CHANGELOG.md with release notes
- [ ] Tag GitHub release with notes
- [ ] Update deployment log
- [ ] Document any issues encountered
- [ ] Update runbooks if procedures changed

---

## Deployment Schedule

### Recommended Schedule

**Staging:**
- Deploy: Daily (automatic on main merge)
- Purpose: Test new features
- Downtime: Acceptable

**Production:**
- Deploy: Weekly (Tuesday/Thursday)
- Purpose: Stable releases
- Downtime: Zero tolerance

**Emergency Hotfixes:**
- Deploy: As needed
- Process: Fast-track review + deploy
- Rollback plan: Required

### Maintenance Windows

**Scheduled Maintenance:**
- Time: Sundays 2-4 AM UTC (lowest traffic)
- Frequency: Monthly
- Activities:
  - Database optimization
  - Security updates
  - Log cleanup
  - Backup verification

**Communication:**
- Announce 48 hours in advance
- Status page update
- Email notification to users

---

## Additional Resources

- [CI/CD Setup Guide](./CI_CD_SETUP.md)
- [GitHub Actions Guide](./GITHUB_ACTIONS_GUIDE.md)
- [Branch Protection Rules](./BRANCH_PROTECTION_RULES.md)
- [Infrastructure Documentation](../deployment/INFRASTRUCTURE_OPTIMIZATION.md)
- [Security Guide](../deployment/SECURITY.md)

---

**Last Updated:** 2025-10-29
**Version:** 1.0.0
**Maintainer:** DevOps Team
