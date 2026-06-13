# Production Deployment Checklist - BookReader AI

**Version:** 1.0
**Last Updated:** October 30, 2025

---

## Pre-Deployment Checklist

### 1. Code Quality ✅

- [ ] All tests passing (`pytest -v --cov=app`)
- [ ] Type checking passed (`mypy app/ --strict`)
- [ ] Linting passed (`ruff check .`)
- [ ] Code coverage > 80%
- [ ] No critical security vulnerabilities (`safety check`)
- [ ] Frontend build successful (`npm run build`)
- [ ] No console errors in production build

### 2. Database Preparation ✅

- [ ] Database migrations created (`alembic revision`)
- [ ] Migrations tested on staging
- [ ] Backward compatible migrations (no breaking changes)
- [ ] Database backup taken
- [ ] Rollback plan documented
- [ ] Indexes created for new queries
- [ ] No long-running queries (< 5s)

### 3. Configuration ✅

- [ ] `.env.production` updated with correct values
- [ ] All secrets rotated (if needed)
- [ ] API keys valid and tested
- [ ] Domain/DNS configured correctly
- [ ] SSL certificates valid (> 30 days remaining)
- [ ] CORS origins configured
- [ ] Rate limits configured appropriately
- [ ] Log levels set to INFO or WARNING

### 4. Infrastructure ✅

- [ ] Server resources sufficient (CPU, RAM, Disk)
- [ ] Docker images built and tagged correctly
- [ ] Docker registry accessible
- [ ] Backup systems operational
- [ ] Monitoring stack running
- [ ] Log aggregation working
- [ ] Health check endpoints responding
- [ ] Load balancer configured (if multi-server)

### 5. Dependencies ✅

- [ ] All Python dependencies pinned in `requirements.txt`
- [ ] All npm dependencies have `package-lock.json`
- [ ] NLP models downloaded (`ru_core_news_lg`, `natasha`, `stanza`)
- [ ] External APIs accessible (pollinations.ai)
- [ ] Redis connection tested
- [ ] PostgreSQL connection tested
- [ ] S3/storage accessible

### 6. Security ✅

- [ ] Firewall rules configured
- [ ] SSH keys rotated (if needed)
- [ ] Database passwords strong and rotated
- [ ] Redis password set
- [ ] Secret keys rotated
- [ ] fail2ban configured
- [ ] No hardcoded secrets in code
- [ ] Security headers configured in Nginx
- [ ] HTTPS enforced

### 7. Documentation ✅

- [ ] Deployment runbook updated
- [ ] Changelog updated
- [ ] API documentation current
- [ ] Architecture diagrams up to date
- [ ] Rollback procedures documented
- [ ] Monitoring dashboards configured

---

## Deployment Steps

### Phase 1: Preparation (30 minutes)

```bash
# 1. Announce maintenance window
curl -X POST $SLACK_WEBHOOK -d '{"text":"🚀 Deployment starting in 30 minutes"}'

# 2. Create deployment branch
git checkout main
git pull origin main
git checkout -b deploy/$(date +%Y%m%d-%H%M)

# 3. Tag release
git tag -a v1.x.x -m "Release v1.x.x"
git push origin v1.x.x

# 4. Backup current state
./scripts/backup-db.sh
./scripts/backup-storage.sh
./scripts/backup-config.sh

# 5. Document current version
docker-compose ps > /tmp/pre-deployment-state.txt
```

### Phase 2: Database Migration (15 minutes)

```bash
# 1. Put application in maintenance mode (optional)
# Create maintenance.html and configure Nginx to serve it

# 2. Stop workers (prevent job processing during migration)
docker-compose stop celery-worker celery-beat

# 3. Backup database immediately before migration
docker exec bookreader_postgres pg_dump -U postgres bookreader > /tmp/pre-migration-backup.sql

# 4. Run migrations
docker-compose exec backend alembic upgrade head

# 5. Verify migration success
docker-compose exec backend alembic current

# 6. Test critical queries
docker exec bookreader_postgres psql -U postgres -d bookreader -c "SELECT COUNT(*) FROM books;"
docker exec bookreader_postgres psql -U postgres -d bookreader -c "SELECT COUNT(*) FROM users;"
```

### Phase 3: Application Deployment (20 minutes)

```bash
# 1. Pull latest code
git pull origin main

# 2. Build new Docker images
docker-compose -f docker-compose.production.yml build --no-cache

# 3. Tag images with version
docker tag bookreader-backend:latest bookreader-backend:v1.x.x
docker tag bookreader-frontend:latest bookreader-frontend:v1.x.x

# 4. Stop old containers (rolling restart)
docker-compose -f docker-compose.production.yml stop backend

# 5. Start new containers
docker-compose -f docker-compose.production.yml up -d backend

# 6. Wait for health check
sleep 30
curl -f http://localhost:8000/health || (echo "Health check failed" && exit 1)

# 7. Restart workers
docker-compose -f docker-compose.production.yml up -d celery-worker celery-beat

# 8. Restart frontend (zero downtime with Nginx)
docker-compose -f docker-compose.production.yml up -d --no-deps frontend

# 9. Reload Nginx (if config changed)
docker-compose exec nginx nginx -t
docker-compose exec nginx nginx -s reload
```

### Phase 4: Verification (15 minutes)

```bash
# 1. Check all services running
docker-compose ps

# 2. Check logs for errors
docker-compose logs --tail=100 backend | grep -i error
docker-compose logs --tail=100 celery-worker | grep -i error

# 3. Test critical endpoints
curl -f https://bookreader.ai/health
curl -f https://bookreader.ai/api/v1/books
curl -f https://bookreader.ai/api/v1/users/me -H "Authorization: Bearer $TEST_TOKEN"

# 4. Test authentication
curl -X POST https://bookreader.ai/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# 5. Test book upload (critical path)
curl -X POST https://bookreader.ai/api/v1/books \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -F "file=@test.epub"

# 6. Check Celery queue
docker-compose exec backend python -c "from app.core.celery_app import app; print(app.control.inspect().active())"

# 7. Verify Prometheus metrics
curl http://localhost:9090/api/v1/query?query=up

# 8. Check Grafana dashboards
open http://localhost:3001

# 9. Monitor error rate
watch -n 5 'docker-compose logs --tail=50 backend | grep ERROR | wc -l'
```

---

## Post-Deployment Checklist

### Immediate (0-1 hour) ✅

- [ ] All services running (green in `docker-compose ps`)
- [ ] Health checks passing
- [ ] No errors in logs
- [ ] Response times < 500ms p95
- [ ] Error rate < 0.1%
- [ ] Database connections normal (< 180/200)
- [ ] Redis memory usage normal (< 80%)
- [ ] Celery queues processing
- [ ] Monitoring dashboards showing data
- [ ] Alerts not firing
- [ ] SSL certificate valid
- [ ] CDN cache working

### Short-term (1-4 hours) ✅

- [ ] User traffic normal
- [ ] No user-reported issues
- [ ] Background jobs processing
- [ ] Image generation working
- [ ] NLP processing functional
- [ ] Email notifications sending
- [ ] Payment processing working (if applicable)
- [ ] Subscription renewals working
- [ ] API rate limiting effective
- [ ] Search functionality working

### Medium-term (4-24 hours) ✅

- [ ] Database replication lag < 10s
- [ ] No memory leaks (stable memory usage)
- [ ] No disk space issues
- [ ] Backup completed successfully
- [ ] Performance metrics stable
- [ ] No unusual error patterns
- [ ] User engagement metrics normal
- [ ] Revenue metrics tracking

### Long-term (24-72 hours) ✅

- [ ] System stability confirmed
- [ ] Performance improvements visible
- [ ] No regression issues
- [ ] User feedback positive
- [ ] Analytics showing expected behavior
- [ ] Cost metrics within budget

---

## Rollback Procedure

### When to Rollback

Rollback immediately if:
- Critical functionality broken
- Error rate > 5%
- Database corruption detected
- Security vulnerability introduced
- Data loss occurring

### Rollback Steps (< 15 minutes)

```bash
# 1. Announce rollback
curl -X POST $SLACK_WEBHOOK -d '{"text":"⚠️ Rolling back deployment"}'

# 2. Stop current services
docker-compose -f docker-compose.production.yml stop

# 3. Rollback database (if migration was run)
docker-compose start postgres
docker exec -i bookreader_postgres psql -U postgres bookreader < /tmp/pre-migration-backup.sql

# Alternative: Use Alembic downgrade
docker-compose exec backend alembic downgrade -1

# 4. Switch to previous version
git checkout v1.x.x  # Previous stable version
docker-compose pull  # Pull previous images

# 5. Start services with old version
docker-compose -f docker-compose.production.yml up -d

# 6. Verify rollback success
curl -f https://bookreader.ai/health
docker-compose ps

# 7. Monitor for stability
docker-compose logs -f

# 8. Notify team
curl -X POST $SLACK_WEBHOOK -d '{"text":"✅ Rollback completed successfully"}'
```

---

## Smoke Tests

### Critical User Journeys

**Test Script (`scripts/smoke-tests.sh`):**

```bash
#!/bin/bash

BASE_URL="${1:-https://bookreader.ai}"
TEST_EMAIL="smoke-test@example.com"
TEST_PASSWORD="test123"

echo "Running smoke tests against: $BASE_URL"

# Test 1: Health Check
echo -n "1. Health check... "
if curl -sf "$BASE_URL/health" > /dev/null; then
    echo "✅ PASS"
else
    echo "❌ FAIL"
    exit 1
fi

# Test 2: User Registration
echo -n "2. User registration... "
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/users/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"full_name\":\"Test User\"}")

if echo "$REGISTER_RESPONSE" | grep -q "id"; then
    echo "✅ PASS"
else
    echo "❌ FAIL"
    exit 1
fi

# Test 3: User Login
echo -n "3. User login... "
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token')

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    echo "✅ PASS"
else
    echo "❌ FAIL"
    exit 1
fi

# Test 4: Get User Profile
echo -n "4. Get user profile... "
if curl -sf "$BASE_URL/api/v1/users/me" \
    -H "Authorization: Bearer $TOKEN" > /dev/null; then
    echo "✅ PASS"
else
    echo "❌ FAIL"
    exit 1
fi

# Test 5: List Books
echo -n "5. List books... "
if curl -sf "$BASE_URL/api/v1/books" \
    -H "Authorization: Bearer $TOKEN" > /dev/null; then
    echo "✅ PASS"
else
    echo "❌ FAIL"
    exit 1
fi

echo ""
echo "✅ All smoke tests passed!"
```

---

## Monitoring During Deployment

### Key Metrics to Watch

```bash
# Open Grafana dashboard
open http://localhost:3001/d/bookreader-system

# Watch metrics in terminal
watch -n 2 '
echo "=== Service Status ==="
docker-compose ps | grep -E "(Up|Exit)"
echo ""
echo "=== Error Rate (last 5min) ==="
curl -s "http://localhost:9090/api/v1/query?query=rate(http_requests_total{status=~\"5..\"}[5m])" | jq -r ".data.result[0].value[1]"
echo ""
echo "=== Response Time (p95) ==="
curl -s "http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,rate(http_request_duration_seconds_bucket[5m]))" | jq -r ".data.result[0].value[1]"
echo ""
echo "=== Database Connections ==="
docker exec bookreader_postgres psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity;"
echo ""
echo "=== Redis Memory ==="
docker exec bookreader_redis redis-cli -a $REDIS_PASSWORD INFO memory | grep used_memory_human
'
```

---

## Communication Template

### Pre-Deployment Announcement

```
🚀 **Scheduled Maintenance**

We will be deploying a new version of BookReader AI:

**When:** October 30, 2025, 2:00 AM - 3:00 AM UTC
**Duration:** ~1 hour
**Impact:** The service will remain available. Some features may be briefly unavailable.
**Changes:**
- Performance improvements
- Bug fixes
- New features

We will keep you updated throughout the deployment.
```

### Deployment Complete

```
✅ **Deployment Complete**

BookReader AI v1.x.x has been successfully deployed.

**Changes:**
- Improved API response times (83% faster)
- Enhanced NLP processing
- Bug fixes

Everything is running smoothly. Thank you for your patience!
```

### Rollback Announcement

```
⚠️ **Service Notice**

We've identified an issue with the latest deployment and are rolling back to the previous stable version. Your data is safe. The service will be fully operational shortly.
```

---

## Post-Deployment Tasks

### Documentation

- [ ] Update `CHANGELOG.md`
- [ ] Update `docs/development/current-status.md`
- [ ] Document any issues encountered
- [ ] Update runbooks if procedures changed
- [ ] Record deployment metrics (duration, downtime)

### Team Communication

- [ ] Announce completion in Slack
- [ ] Update status page
- [ ] Send email to stakeholders
- [ ] Schedule post-mortem (if issues occurred)

### Cleanup

- [ ] Remove old Docker images (`docker image prune -a`)
- [ ] Clean up old backups (keep per retention policy)
- [ ] Remove temporary files
- [ ] Archive deployment logs

---

## Emergency Contacts

```yaml
DevOps On-Call: +7-XXX-XXX-XXXX
CTO: +7-XXX-XXX-XXXX
Slack: #incidents
Email: oncall@bookreader.ai
```

---

**Document Version:** 1.0
**Last Updated:** October 30, 2025
**Next Review:** After each deployment
