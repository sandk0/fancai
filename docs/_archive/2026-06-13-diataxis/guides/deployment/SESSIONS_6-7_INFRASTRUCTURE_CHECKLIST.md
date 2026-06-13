# Sessions 6-7 Infrastructure Checklist

**Детальный чеклист инфраструктурных требований**

---

## 📋 Pre-Deployment Infrastructure Audit

### Ресурсы (Memory & Disk)

#### Memory Requirements
```
╔════════════════════════════════════════════════════════════════╗
║ Component               │ Min    │ Recommended │ Peak Usage     ║
╠════════════════════════════════════════════════════════════════╣
║ PostgreSQL              │ 512MB  │ 1GB        │ 512MB          ║
║ Redis                   │ 256MB  │ 512MB      │ 256MB          ║
║ Backend (base)          │ 512MB  │ 1GB        │ 1GB            ║
║ - SpaCy model           │ 400MB  │ 400MB      │ 400MB          ║
║ - Natasha               │ 50MB   │ 50MB       │ 50MB           ║
║ - GLiNER model          │ 700MB  │ 700MB      │ 700MB          ║
║ - Stanza model (NEW)    │ 630MB  │ 630MB      │ 780MB*         ║
║ Celery Worker           │ 512MB  │ 1.5GB      │ 1.5GB          ║
║ Celery Beat             │ 256MB  │ 512MB      │ 256MB          ║
║ Frontend (Vite)         │ 256MB  │ 512MB      │ 256MB          ║
╠════════════════════════════════════════════════════════════════╣
║ TOTAL (Sessions 1-5)    │ 3.5GB  │ 6.7GB      │ 5.5GB          ║
║ + Stanza (Session 6)    │ +630MB │ +630MB     │ +780MB*        ║
║ TOTAL (Sessions 6-7)    │ 4.1GB  │ 7.3GB      │ 6.3GB          ║
╚════════════════════════════════════════════════════════════════╝

* Stanza runtime memory может быть выше чем размер модели
```

#### Disk Space Requirements
```
Component                   │ Size (MB) │ Location
───────────────────────────────────────────────────────
PostgreSQL data             │ 100-500   │ postgres_data volume
Redis data                  │ 50-100    │ redis_data volume
Backend code                │ 100-200   │ Mounted /app
- SpaCy model               │ 400       │ NLP persistent volume
- Natasha                   │ 50        │ NLP persistent volume
- GLiNER model              │ 700       │ NLP persistent volume
- Stanza model (NEW)        │ 630       │ nlp_stanza_models volume
Frontend code               │ 100-200   │ Mounted /app
- node_modules              │ 200-300   │ frontend_node_modules
Celery worker storage       │ 50-100    │ Mounted /app
───────────────────────────────────────────────────────
TOTAL Minimum               │ 2.8 GB    │
RECOMMENDED FREE SPACE      │ 5 GB      │ For safety margin
```

### Проверка ресурсов

```bash
# Текущее использование памяти
free -h

# Свободное место на диске
df -h

# Использование Docker volumes
docker system df

# Ожидаемый вывод:
# Memory: ~3-4GB available (minimum for dev)
# Disk: ~5GB available
# Docker volumes: clean state
```

### ✅ Pre-Deployment Checklist

#### Hardware & Resources
- [ ] Минимум 4GB RAM доступно (рекомендуется 8GB+)
- [ ] Минимум 5GB свободного дискового пространства
- [ ] CPU: 2+ cores (для параллельной обработки)
- [ ] Интернет connection: >5 Mbps (для загрузки моделей)

#### Docker Setup
- [ ] Docker Desktop или Docker Engine установлен
- [ ] Docker Compose v2+ установлен (`docker-compose --version`)
- [ ] Docker daemon работает (`docker ps`)
- [ ] Достаточно ресурсов в Docker (Settings → Resources):
  ```
  - CPUs: 4+ (или что доступно)
  - Memory: 6GB+ (или что доступно)
  - Swap: 2GB+
  - Disk Image Size: 50GB+
  ```

#### Environment Configuration
- [ ] `.env` файл существует с обязательными переменными:
  ```bash
  DB_PASSWORD=<secure-password>
  REDIS_PASSWORD=<secure-password>
  SECRET_KEY=<secure-key>
  ```
- [ ] Все пути в docker-compose.yml корректны
- [ ] Нет конфликтов портов:
  - 8000 (backend)
  - 5173 (frontend)
  - 5432 (postgres)
  - 6379 (redis)

#### Network Configuration
- [ ] Booked network доступна: `docker network inspect bookreader_network`
- [ ] DNS resolve работает внутри сети
- [ ] Межконтейнерное общение настроено

#### Volumes Configuration
- [ ] Persistent volumes подготовлены:
  ```bash
  docker volume ls | grep bookreader

  # Ожидаемые volumes:
  # bookreader_nlp_nltk_data
  # bookreader_nlp_stanza_models (NEW for Session 6)
  # bookreader_postgres_data
  # bookreader_redis_data
  # bookreader_uploaded_books
  # bookreader_frontend_node_modules
  ```

---

## 🔧 Configuration Files Checklist

### docker-compose.yml
- [ ] Backend service имеет volume для Stanza:
  ```yaml
  volumes:
    - nlp_stanza_models:/root/stanza_resources
  ```
- [ ] Backend service имеет environment переменную:
  ```yaml
  environment:
    - STANZA_RESOURCES_DIR=/root/stanza_resources
  ```
- [ ] Memory limits установлены:
  ```yaml
  backend:
    deploy:
      resources:
        limits:
          memory: 2G
  celery-worker:
    deploy:
      resources:
        limits:
          memory: 1.5G
  ```

### Dockerfile (backend)
- [ ] BASE IMAGE: `python:3.11-slim`
- [ ] Зависимости установлены (`requirements.txt`)
- [ ] NLP модели могут загружаться в runtime (не в build time)
- [ ] Health check присутствует:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
  ```

### settings_manager.py
- [ ] Stanza configuration присутствует (Session 6):
  ```python
  "nlp_stanza": {
      "enabled": True,
      "weight": 0.8,
      "threshold": 0.3,
      "model": "ru",
  }
  ```
- [ ] Advanced Parser configuration присутствует (Session 7):
  ```python
  "advanced_parser": {
      "enabled": False,  # Disabled by default
      "min_text_length": 500,
  }
  ```

### config_loader.py
- [ ] Stanza processor loading logic присутствует
- [ ] Advanced Parser adapter import работает
- [ ] Graceful degradation при отсутствии зависимостей

---

## 🚀 Deployment Steps with Infrastructure Verification

### Step 1: Verify Base Infrastructure

```bash
# Project location
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon

# Check docker setup
docker --version                          # Docker version
docker-compose --version                 # v2+
docker ps                                 # Daemon working

# Check available resources
free -h                                   # Memory
df -h                                     # Disk space
docker system df                          # Docker disk usage
```

**✅ Expected Output:**
```
Docker version 24.0+
Docker Compose version 2.20+
CONTAINERS: 0
MEMORY: 3GB+ available
DISK: 5GB+ available
```

### Step 2: Prepare Docker Compose Environment

```bash
# Create/update .env if not exists
touch .env

# Add required variables (if not already there)
if ! grep -q "DB_PASSWORD" .env; then
  echo "DB_PASSWORD=$(openssl rand -base64 32)" >> .env
fi

if ! grep -q "REDIS_PASSWORD" .env; then
  echo "REDIS_PASSWORD=$(openssl rand -base64 32)" >> .env
fi

if ! grep -q "SECRET_KEY" .env; then
  echo "SECRET_KEY=$(openssl rand -base64 64)" >> .env
fi

# Verify
cat .env
```

### Step 3: Start Base Services

```bash
# Start only PostgreSQL and Redis (no NLP models yet)
docker-compose up -d postgres redis

# Wait for health checks
sleep 10

# Verify they're healthy
docker-compose ps postgres redis
# Both should show: healthy in STATUS
```

### Step 4: Download Stanza Model (Session 6)

```bash
# Start backend service (will inherit from postgres/redis health)
docker-compose up -d backend

# Wait for backend to be ready
sleep 30

# Download Stanza model (this takes 10-20 minutes)
echo "Starting Stanza model download..."
docker-compose exec backend python -c "
import sys
import stanza
try:
    print('Downloading Stanza Russian model...')
    stanza.download('ru', verbose=True)
    print('✅ Stanza model downloaded successfully')
    sys.exit(0)
except Exception as e:
    print(f'❌ Error: {e}')
    sys.exit(1)
"

# Monitor download progress
docker-compose logs -f backend | grep -i stanza
```

**⏱️ Expected Time:** 10-20 minutes (depends on internet speed)

**✅ Verify:**
```bash
# Check model files
docker-compose exec backend ls -lh /root/stanza_resources/ru/

# Expected output:
# total ~630MB
# -rw-r--r-- tokenize/default.pt (~100MB)
# -rw-r--r-- pos/default.pt (~70MB)
# -rw-r--r-- lemma/default.pt (~20MB)
# -rw-r--r-- depparse/default.pt (~300MB) <- Main component
# -rw-r--r-- ner/default.pt (~50MB)
```

### Step 5: Start Remaining Services

```bash
# Start celery worker, celery beat, and frontend
docker-compose up -d celery-worker celery-beat frontend

# Wait for all services
sleep 30

# Verify all are running
docker-compose ps

# Expected: All services in "Up" state
```

### Step 6: Verify Infrastructure Health

```bash
# Check all services are healthy
docker-compose ps | grep -E "backend|postgres|redis"
# All should show: healthy or Up

# Check resource usage
docker stats --no-stream
# Backend should use: ~1-2GB memory, <30% CPU

# Check logs for errors
docker-compose logs backend | grep -i error
# Should be empty or only INFO level

# Check network connectivity
docker-compose exec backend curl -f http://localhost:8000/health
# Expected: {"status": "healthy"}
```

### Step 7: Verify Feature Flags & Configuration

```bash
# Check Stanza is enabled in settings
docker-compose exec backend python -c "
from app.services.settings_manager import settings_manager
import json
stanza_config = settings_manager._settings.get('nlp_stanza', {})
print('Stanza Config:')
print(json.dumps(stanza_config, indent=2))
print(f\"Enabled: {stanza_config.get('enabled')}\")
"

# Check Advanced Parser configuration
docker-compose exec backend python -c "
from app.services.settings_manager import settings_manager
import json
ap_config = settings_manager._settings.get('advanced_parser', {})
print('Advanced Parser Config:')
print(json.dumps(ap_config, indent=2))
print(f\"Enabled: {ap_config.get('enabled')}\")
"

# Both should show correctly loaded configurations
```

---

## 🔄 Monitoring & Health Checks

### Continuous Monitoring During Deployment

```bash
# Terminal 1: Watch Docker stats
watch -n 1 'docker stats --no-stream | grep -E "CONTAINER|backend|worker"'

# Terminal 2: Follow backend logs
docker-compose logs -f backend

# Terminal 3: Monitor memory usage of Stanza loading
docker exec bookreader-backend ps aux | grep stanza
```

### Health Check Endpoints

```bash
# General health
curl -s http://localhost:8000/health | jq .

# Detailed NLP status (if endpoint exists)
curl -s http://localhost:8000/api/v1/admin/multi-nlp-settings/status | jq .

# Frontend status
curl -s http://localhost:5173 -I | head -3
```

---

## 🚨 Infrastructure Troubleshooting

### Issue: Out of Memory

**Symptoms:**
```
docker-compose logs backend | grep -i "oomkilled\|memory\|killed"
```

**Solutions:**
```bash
# 1. Increase Docker memory limit
# Docker Desktop → Settings → Resources → Memory slider

# 2. Increase docker-compose limits
# Edit docker-compose.yml:
deploy:
  resources:
    limits:
      memory: 3G  # Increase from 2G

# 3. Restart with new limits
docker-compose down
docker-compose up -d

# 4. Monitor
docker stats backend
```

### Issue: Disk Space Exhausted

**Symptoms:**
```
docker-compose logs backend | grep -i "no space\|disk"
```

**Solutions:**
```bash
# Check what's using space
du -sh /var/lib/docker/*

# Clean up unused images/volumes
docker system prune -a  # WARNING: removes all unused
docker volume prune     # Safer: only volumes

# Increase Docker Desktop disk image size
# Settings → Resources → Disk Image Size slider
```

### Issue: Port Conflicts

**Symptoms:**
```
docker-compose logs backend | grep "Address already in use"
```

**Solutions:**
```bash
# Find what's using the port
lsof -i :8000

# Kill the process or change port in docker-compose.yml
ports:
  - "8001:8000"  # Change external port

# Restart
docker-compose restart backend
```

### Issue: Network Connectivity Issues

**Symptoms:**
```
docker-compose logs backend | grep "cannot connect\|connection refused"
```

**Solutions:**
```bash
# Check network
docker network inspect bookreader_network

# Verify DNS resolution
docker-compose exec backend ping postgres
docker-compose exec backend ping redis

# Restart network
docker-compose down
docker network prune
docker-compose up -d
```

---

## 📊 Post-Deployment Infrastructure Validation

After all services are running:

```bash
# 1. Resource usage validation
docker stats --no-stream

# Expected:
# backend:    ~1.5-2GB memory, <30% CPU
# postgres:   ~200-300MB memory, <10% CPU
# redis:      ~100-150MB memory, <5% CPU
# worker:     ~800MB memory, <20% CPU
# frontend:   ~100-150MB memory, <5% CPU

# 2. Volume usage
docker system df

# Expected:
# IMAGES: 4-5 images, ~2-3GB
# CONTAINERS: 5 containers, ~500MB
# VOLUMES: 6-7 volumes, ~2GB

# 3. Network verification
docker-compose exec backend ping -c 1 postgres
docker-compose exec backend ping -c 1 redis
docker-compose exec backend curl -s http://frontend:5173 -I

# All should succeed

# 4. Database connectivity
docker-compose exec backend python -c "
import asyncio
from app.core.database import get_db
async def test():
    async with get_db() as session:
        result = await session.execute('SELECT 1')
        print('✅ Database connected')
asyncio.run(test())
"

# 5. NLP models loaded
docker-compose exec backend python -c "
import spacy
import stanza
import natasha
print('✅ SpaCy loaded')
stanza.Pipeline('ru')
print('✅ Stanza loaded')
natasha.Segmenter()
print('✅ Natasha loaded')
"
```

---

## 🎯 Infrastructure Verification Checklist

### Final Validation

- [ ] All Docker services running (`docker-compose ps`)
- [ ] All services healthy (STATUS: healthy or Up)
- [ ] Memory usage stable and within limits
- [ ] Disk space available (>2GB free)
- [ ] Network connectivity working (services can reach each other)
- [ ] Stanza model files present (~630MB)
- [ ] API endpoints responding (health, admin endpoints)
- [ ] No ERROR logs in services
- [ ] Database migrations complete (no pending)
- [ ] Redis cache accessible
- [ ] Celery workers ready

### Performance Baseline

- [ ] Backend response time: <1 second for simple requests
- [ ] Processing time (descriptions): 1.5-3 seconds per chapter
- [ ] F1 score: >0.87 (baseline from Sessions 1-5)
- [ ] Memory growth stable (no memory leaks)
- [ ] CPU usage normal (<50% when idle)

---

**Document Created:** 2025-11-23
**Version:** 1.0
**Status:** Production-Ready
**Audience:** DevOps Engineers, System Administrators
