# Production Deployment Guide - BookReader AI

Comprehensive guide for deploying BookReader AI to production environment.

## 🚀 Quick Production Deployment

### 1. Prerequisites

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose (v2)
sudo apt install docker-compose-plugin

# Install Git
sudo apt install git -y

# Logout and login to apply group changes
```

**Recommended Server Specifications:**
- CPU: 2+ cores (4GB RAM server)
- RAM: 4GB minimum (tested on 4GB VPS)
- Storage: 20GB+ SSD
- OS: Ubuntu 22.04 LTS (recommended)
- Network: Public IP with domain name

### 2. Environment Configuration

```bash
# Copy environment template
cp .env.production.example .env.production

# Edit with your production values
nano .env.production
```

**⚠️ Critical Environment Variables:**
```bash
# Domain & SSL
DOMAIN_NAME=bookreader.yourdomain.com
DOMAIN_URL=https://bookreader.yourdomain.com

# Strong passwords (minimum 16+ characters)
DB_PASSWORD=your_super_secure_db_password_here
REDIS_PASSWORD=your_super_secure_redis_password_here

# Application secrets (minimum 32 characters)
SECRET_KEY=your_super_secret_key_for_app_here_min_32_chars
JWT_SECRET_KEY=your_jwt_secret_key_here_min_32_chars

# AI Services
OPENAI_API_KEY=sk-your-openai-api-key-here  # Optional
POLLINATIONS_ENABLED=true
```

### 3. SSL Certificate Setup

#### Option A: Docker-based Let's Encrypt (Recommended - No Downtime)

**Quick Start:**

```bash
# 1. Create directories
mkdir -p nginx/ssl nginx/certbot-www/.well-known/acme-challenge
chmod -R 755 nginx/certbot-www
echo "OK" > nginx/certbot-www/.well-known/acme-challenge/test.txt

# 2. Start temporary nginx (HTTP only)
docker compose -f docker-compose.temp-ssl.yml up -d

# 3. Test webroot accessibility
curl http://yourdomain.com/.well-known/acme-challenge/test.txt
# Should return: OK

# 4. Get certificate (STAGING first - for testing)
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --webroot -w /var/www/certbot \
  --email your@email.com \
  --agree-tos --no-eff-email \
  --staging \
  -d yourdomain.com -d www.yourdomain.com

# 5. If successful, get PRODUCTION certificate
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --webroot -w /var/www/certbot \
  --email your@email.com \
  --agree-tos --no-eff-email \
  -d yourdomain.com -d www.yourdomain.com

# 6. Copy certificates to nginx directory
cp nginx/ssl/live/yourdomain.com/fullchain.pem nginx/ssl/fullchain.pem
cp nginx/ssl/live/yourdomain.com/privkey.pem nginx/ssl/privkey.pem
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem

# 7. Stop temporary nginx and start production
docker compose -f docker-compose.temp-ssl.yml down
docker compose -f docker-compose.prod.yml up -d

# 8. Setup auto-renewal (add to crontab: sudo crontab -e)
# 0 0,12 * * * cd /opt/bookreader && docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" -v "$(pwd)/nginx/certbot-www:/var/www/certbot" certbot/certbot:latest renew --quiet && docker compose -f docker-compose.prod.yml restart nginx
```

**📖 Complete Guide:** See `SSL-QUICKSTART.md` in project root or `docs/operations/deployment/ssl-setup-manual.md`

#### Option B: Traditional Certbot (Requires Downtime)

```bash
# Install Certbot
sudo apt install certbot

# Stop nginx if running
docker compose -f docker-compose.prod.yml stop nginx

# Obtain certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
sudo chown -R $USER:$USER nginx/ssl/
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem
```

#### Option C: Self-Signed (Development Only)

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx/ssl/privkey.pem \
    -out nginx/ssl/fullchain.pem \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=yourdomain.com"
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem
```

**⚠️ SSL Troubleshooting:**

- **"Connection refused"**: Check DNS (`nslookup yourdomain.com`), firewall (`sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`)
- **"Invalid response"**: DNS not propagated yet, wait 5-10 minutes
- **"too many certificates"**: Used staging server first with `--staging` flag
- **HTTPS not working**: Check `docker compose -f docker-compose.prod.yml logs nginx`

### 4. Deploy Application

```bash
# Make script executable
chmod +x scripts/deploy-production.sh

# Standard deployment
./scripts/deploy-production.sh

# Deployment with monitoring (Prometheus, Grafana)
./scripts/deploy-production.sh --with-monitoring
```

### 5. Verify Deployment

```bash
# Check services status
docker compose -f docker-compose.production.yml ps

# Test endpoints
curl -k https://bookreader.yourdomain.com/health
curl -k https://bookreader.yourdomain.com/api/v1/health

# View logs
docker compose -f docker-compose.production.yml logs -f backend
```

---

## 🔧 Manual Deployment Steps

### 1. Build and Start Infrastructure

```bash
# Build images
docker compose -f docker-compose.production.yml build --no-cache

# Start database and Redis
docker compose -f docker-compose.production.yml up -d postgres redis

# Wait for services
sleep 30

# Run database migrations
docker compose -f docker-compose.production.yml run --rm backend alembic upgrade head
```

### 2. Start Application Services

```bash
# Start backend and workers
docker compose -f docker-compose.production.yml up -d backend celery-worker celery-beat

# Start frontend and nginx
docker compose -f docker-compose.production.yml up -d frontend nginx

# Start auxiliary services
docker compose -f docker-compose.production.yml up -d logrotate
```

### 3. Optional: Enable Monitoring

```bash
# Start monitoring stack
docker compose -f docker-compose.production.yml --profile monitoring up -d

# Access Grafana: https://yourdomain.com:3001
# Default login: admin / (GRAFANA_PASSWORD from env)
```

---

## 📊 Production Architecture

```
Internet
    ↓
Nginx (SSL termination, Load balancing)
    ↓
Frontend (React SPA) + Backend API (FastAPI)
    ↓
PostgreSQL (Database) + Redis (Cache/Queue)
    ↓
Celery (Background tasks) + Beat (Scheduler)
```

### Service Details:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| Nginx | bookreader_nginx | 80, 443 | Reverse proxy, SSL termination |
| Frontend | bookreader_frontend | - | React production build |
| Backend | bookreader_backend | - | FastAPI with Gunicorn |
| PostgreSQL | bookreader_postgres | - | Primary database |
| Redis | bookreader_redis | - | Cache and message broker |
| Celery Worker | bookreader_celery | - | Background task processing |
| Celery Beat | bookreader_beat | - | Task scheduler |
| Logrotate | bookreader_logrotate | - | Log management |

### Optional Services:

| Service | Container | Port | Profile |
|---------|-----------|------|---------|
| Prometheus | bookreader-prometheus | 9090 | monitoring |
| Grafana | bookreader-grafana | 3001 | monitoring |
| Watchtower | bookreader_watchtower | - | watchtower |

---

## 🛠 Operations & Maintenance

### Service Management

```bash
# View all services
docker compose -f docker-compose.production.yml ps

# Start specific service
docker compose -f docker-compose.production.yml start backend

# Stop specific service
docker compose -f docker-compose.production.yml stop backend

# Restart service
docker compose -f docker-compose.production.yml restart backend

# View logs
docker compose -f docker-compose.production.yml logs -f backend

# Scale workers
docker compose -f docker-compose.production.yml up -d --scale celery-worker=4
```

### Database Operations

```bash
# Database backup
docker compose -f docker-compose.production.yml exec postgres pg_dump \
  -U $DB_USER -d $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql

# Database restore
docker compose -f docker-compose.production.yml exec -T postgres psql \
  -U $DB_USER -d $DB_NAME < backup_file.sql

# Run migrations
docker compose -f docker-compose.production.yml exec backend alembic upgrade head

# Create new migration
docker compose -f docker-compose.production.yml exec backend alembic revision --autogenerate -m "description"
```

### SSL Certificate Renewal

```bash
# Auto-renewal (add to crontab)
0 0,12 * * * certbot renew --quiet && docker compose -f docker-compose.production.yml exec nginx nginx -s reload

# Manual renewal
sudo certbot renew
sudo cp /etc/letsencrypt/live/bookreader.yourdomain.com/* nginx/ssl/
docker compose -f docker-compose.production.yml exec nginx nginx -s reload
```

### Log Management

```bash
# View application logs
docker compose -f docker-compose.production.yml logs -f backend
docker compose -f docker-compose.production.yml logs -f celery-worker

# Access log files
tail -f logs/backend/access.log
tail -f logs/nginx/access.log

# Clean old logs (logrotate handles this automatically)
docker compose -f docker-compose.production.yml exec logrotate logrotate -f /etc/logrotate.conf
```

### Monitoring

```bash
# System resources
docker stats

# Service health
docker compose -f docker-compose.production.yml ps

# Database connections
docker compose -f docker-compose.production.yml exec postgres psql -U $DB_USER -d $DB_NAME \
  -c "SELECT count(*) FROM pg_stat_activity;"

# Redis info
docker compose -f docker-compose.production.yml exec redis redis-cli -a $REDIS_PASSWORD info
```

---

## 🚨 Troubleshooting

### Common Issues

#### 1. SSL Certificate Problems
```bash
# Check certificate
openssl x509 -in nginx/ssl/fullchain.pem -text -noout

# Test SSL configuration
openssl s_client -connect bookreader.yourdomain.com:443 -servername bookreader.yourdomain.com
```

#### 2. Database Connection Issues
```bash
# Check database logs
docker compose -f docker-compose.production.yml logs postgres

# Test database connection
docker compose -f docker-compose.production.yml exec postgres psql -U $DB_USER -d $DB_NAME -c "SELECT 1;"
```

#### 3. Backend API Issues
```bash
# Check backend logs
docker compose -f docker-compose.production.yml logs backend

# Test API directly
docker compose -f docker-compose.production.yml exec backend curl localhost:8000/health
```

#### 4. Celery Worker Issues
```bash
# Check worker logs
docker compose -f docker-compose.production.yml logs celery-worker

# Check queue status
docker compose -f docker-compose.production.yml exec redis redis-cli -a $REDIS_PASSWORD llen celery
```

### Performance Optimization

```bash
# Scale workers based on load
docker compose -f docker-compose.production.yml up -d --scale celery-worker=4

# Increase Gunicorn workers
# Edit WORKERS_COUNT in .env.production
WORKERS_COUNT=8
docker compose -f docker-compose.production.yml restart backend

# Monitor resource usage
docker stats --no-stream
```

### Emergency Procedures

#### Quick Rollback
```bash
# Stop current deployment
docker compose -f docker-compose.production.yml down

# Start previous version (if available)
docker compose -f docker-compose.production.yml up -d

# Check backup directory for database restore
ls -la /backups/
```

#### System Recovery
```bash
# Pull latest images and restart
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d --force-recreate

# Clean system resources
docker system prune -f --volumes
```

---

## 📋 Security Checklist

- [ ] Strong passwords for all services
- [ ] SSL certificate properly configured
- [ ] Firewall configured (ports 80, 443 only)
- [ ] Regular security updates enabled
- [ ] Log monitoring configured
- [ ] Backup strategy implemented
- [ ] Rate limiting configured in Nginx
- [ ] No default passwords in use
- [ ] Environment variables secured
- [ ] Database access restricted
- [ ] EPUB file upload validation enabled
- [ ] CFI injection prevention implemented
- [ ] epub.js XSS protection configured

---

## 🆕 October 2025 Production Updates

### Pre-Deployment Checklist

**Backend (Multi-NLP System):**
- [ ] Multi-NLP models installed and tested (SpaCy, Natasha, Stanza)
- [ ] CFI migrations applied (8ca7de033db9, e94cab18247f)
- [ ] EPUB file serving endpoint tested (`GET /api/v1/books/{id}/file`)
- [ ] Reading progress API with CFI fields tested
- [ ] Ensemble voting configured (60% consensus threshold)
- [ ] Admin multi-nlp settings API endpoints working

**Frontend (epub.js Integration):**
- [ ] epub.js 0.3.93 + react-reader 2.0.15 in package.json
- [ ] EpubReader component renders correctly (835 lines verified)
- [ ] CFI tracking saves to backend (debounced 2 seconds)
- [ ] Smart highlights work with descriptions
- [ ] Progress bar shows accurate percentage from CFI
- [ ] Location generation completes (<10 seconds for average book)

**Database (CFI Tracking):**
- [ ] `reading_location_cfi` field exists (VARCHAR 500)
- [ ] `scroll_offset_percent` field exists (FLOAT)
- [ ] Indexes on CFI field for performance
- [ ] Backward compatibility tested (old reading_progress data)
- [ ] `get_reading_progress_percent()` method working

**Performance Metrics:**
- [ ] Multi-NLP: <5 seconds for 2000+ descriptions
- [ ] CFI resolution: <100ms
- [ ] EPUB loading: <2 seconds
- [ ] Progress save debounce: 2 seconds working
- [ ] Bundle size: <3MB (frontend)

### New Environment Variables (October 2025)

```bash
# Multi-NLP Configuration
MULTI_NLP_MODE=ensemble              # Options: single, parallel, sequential, ensemble, adaptive
MULTI_NLP_PROCESSORS=spacy,natasha,stanza
CONSENSUS_THRESHOLD=0.6              # 60% consensus for ensemble mode

# Processor Weights
SPACY_WEIGHT=1.0                     # Entity recognition specialist
NATASHA_WEIGHT=1.2                   # Russian names specialist (higher weight)
STANZA_WEIGHT=0.8                    # Dependency parsing

# CFI Configuration
CFI_MAX_LENGTH=500                   # Maximum CFI string length
CFI_VALIDATION_ENABLED=true          # Enable CFI format validation

# epub.js Frontend
VITE_EPUB_VIEWER_ENABLED=true
VITE_CFI_TRACKING_ENABLED=true
VITE_SMART_HIGHLIGHTS_ENABLED=true
```

### Monitoring Alerts (October 2025)

```yaml
# Add to monitoring configuration
alerts:
  # Multi-NLP Performance
  - name: slow_nlp_processing
    condition: nlp_processing_time > 10s
    severity: warning
    description: "Multi-NLP processing taking longer than expected"

  - name: nlp_consensus_low
    condition: ensemble_consensus_rate < 0.5
    severity: info
    description: "Low consensus rate in ensemble voting"

  # CFI Tracking
  - name: cfi_resolution_slow
    condition: cfi_resolution_time > 500ms
    severity: warning
    description: "CFI resolution taking longer than expected"

  - name: cfi_save_failure_rate
    condition: cfi_save_error_rate > 5%
    severity: critical
    description: "High failure rate saving reading progress CFI"

  # epub.js Loading
  - name: epub_load_failed
    condition: epub_load_error_rate > 5%
    severity: critical
    description: "High failure rate loading EPUB files"

  - name: epub_load_slow
    condition: epub_load_time > 5s
    severity: warning
    description: "EPUB loading slower than target"

  # Resource Usage (Multi-NLP)
  - name: celery_worker_memory_high
    condition: celery_worker_memory > 2GB
    severity: warning
    description: "Celery worker using more memory than expected (NLP models)"
```

### Deployment Scripts (October 2025)

**NLP Models Installation Script:**
```bash
#!/bin/bash
# scripts/install-nlp-models.sh

set -e

echo "🧠 Installing Multi-NLP models for BookReader AI..."

# SpaCy Russian model (500MB)
echo "📦 Installing SpaCy ru_core_news_lg..."
python -m spacy download ru_core_news_lg

# Natasha (included in requirements.txt)
echo "📦 Natasha already installed via pip"

# Stanza Russian model (800MB)
echo "📦 Installing Stanza Russian model..."
python -c "import stanza; stanza.download('ru', verbose=True)"

# Verify installations
echo "✅ Verifying NLP models..."
python << EOF
from app.services.multi_nlp_manager import multi_nlp_manager
import asyncio

async def verify():
    await multi_nlp_manager.initialize()
    status = await multi_nlp_manager.get_processor_status()

    for processor, info in status.items():
        loaded = info.get('loaded', False)
        status_icon = '✅' if loaded else '❌'
        print(f"{status_icon} {processor}: {'Loaded' if loaded else 'Failed'}")

    all_loaded = all(info.get('loaded', False) for info in status.values())
    return all_loaded

if asyncio.run(verify()):
    print("\n🎉 All NLP models installed and verified!")
else:
    print("\n❌ Some NLP models failed to load")
    exit(1)
EOF

echo "📊 Disk usage:"
du -sh ~/.cache/spacy/
du -sh ~/stanza_resources/

echo "✅ NLP models installation complete!"
```

**CFI Migration Verification Script:**
```bash
#!/bin/bash
# scripts/verify-cfi-migrations.sh

set -e

echo "🔍 Verifying CFI database migrations..."

# Check current migration version
CURRENT_VERSION=$(docker-compose -f docker-compose.production.yml exec -T backend alembic current | grep -oP '(?<=\()[a-f0-9]+')

echo "Current migration version: $CURRENT_VERSION"

# Expected migrations
EXPECTED_MIGRATIONS=("8ca7de033db9" "e94cab18247f")

for migration in "${EXPECTED_MIGRATIONS[@]}"; do
    if alembic history | grep -q "$migration"; then
        echo "✅ Migration $migration found in history"
    else
        echo "❌ Migration $migration NOT found"
        exit 1
    fi
done

# Verify table structure
echo "🔍 Verifying reading_progress table structure..."
docker-compose -f docker-compose.production.yml exec -T postgres psql -U $DB_USER -d $DB_NAME << EOF
\d reading_progress
EOF

# Check for CFI fields
HAS_CFI=$(docker-compose -f docker-compose.production.yml exec -T postgres psql -U $DB_USER -d $DB_NAME -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='reading_progress' AND column_name='reading_location_cfi';")

HAS_SCROLL=$(docker-compose -f docker-compose.production.yml exec -T postgres psql -U $DB_USER -d $DB_NAME -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='reading_progress' AND column_name='scroll_offset_percent';")

if [ -n "$HAS_CFI" ] && [ -n "$HAS_SCROLL" ]; then
    echo "✅ CFI fields verified in reading_progress table"
else
    echo "❌ CFI fields missing from reading_progress table"
    exit 1
fi

echo "🎉 CFI migrations verified successfully!"
```

### Post-Deployment Verification (October 2025)

```bash
#!/bin/bash
# scripts/verify-october-2025-deployment.sh

set -e

echo "🚀 Verifying October 2025 BookReader AI deployment..."

# 1. Check Multi-NLP status
echo "1️⃣ Checking Multi-NLP system..."
NLP_STATUS=$(curl -s http://localhost:8000/api/v1/admin/multi-nlp-settings/status)
echo "$NLP_STATUS" | jq .

# Verify all processors loaded
SPACY_LOADED=$(echo "$NLP_STATUS" | jq -r '.spacy.loaded')
NATASHA_LOADED=$(echo "$NLP_STATUS" | jq -r '.natasha.loaded')
STANZA_LOADED=$(echo "$NLP_STATUS" | jq -r '.stanza.loaded')

if [ "$SPACY_LOADED" = "true" ] && [ "$NATASHA_LOADED" = "true" ] && [ "$STANZA_LOADED" = "true" ]; then
    echo "✅ All NLP processors loaded"
else
    echo "❌ Some NLP processors failed to load"
    exit 1
fi

# 2. Check CFI endpoint
echo "2️⃣ Checking CFI tracking endpoint..."
# (requires auth token and book_id)
echo "⚠️  Manual verification required with auth token"

# 3. Check epub.js frontend
echo "3️⃣ Checking epub.js frontend build..."
if [ -f "frontend/dist/index.html" ]; then
    # Check for epub.js in bundle
    if grep -r "epubjs" frontend/dist/assets/*.js > /dev/null; then
        echo "✅ epub.js found in frontend bundle"
    else
        echo "❌ epub.js NOT found in frontend bundle"
        exit 1
    fi
else
    echo "❌ Frontend not built"
    exit 1
fi

# 4. Check database migrations
echo "4️⃣ Checking database migrations..."
./scripts/verify-cfi-migrations.sh

# 5. Resource check
echo "5️⃣ Checking resource usage..."
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"

echo "🎉 October 2025 deployment verification complete!"
```

---

## 🎯 Production Readiness

The deployment includes:

- ✅ Multi-stage Docker builds for optimization
- ✅ Production-optimized Nginx configuration
- ✅ PostgreSQL with performance tuning
- ✅ Redis with persistence and optimization
- ✅ Gunicorn with proper worker configuration
- ✅ Celery with memory limits and task management
- ✅ Comprehensive health checks
- ✅ Automatic log rotation
- ✅ Security headers and SSL
- ✅ Rate limiting and DoS protection
- ✅ Monitoring ready (Prometheus/Grafana)
- ✅ Backup and rollback procedures

Your BookReader AI application is now production-ready! 🚀