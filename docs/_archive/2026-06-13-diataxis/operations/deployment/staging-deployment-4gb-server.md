# Staging Deployment Guide - 4GB RAM Server

**Версия:** 1.0
**Дата создания:** 2025-11-15
**Целевое окружение:** Development/Staging
**Минимальные требования:** 4GB RAM, 2 CPU cores, 100GB storage

---

## 1. Overview

### 1.1. Цель

Этот документ описывает процесс развертывания **staging environment** приложения BookReader AI на сервере с ограниченными ресурсами. Staging окружение предназначено для:

- Тестирования новых функций перед production deployment
- Демонстрации функциональности клиентам/заказчикам
- Обучения команды работе с production-like окружением
- Валидации конфигураций перед production

### 1.2. Что Будет Развернуто

**Все сервисы BookReader AI в оптимизированном режиме:**

- Nginx (reverse proxy + SSL termination)
- Frontend (React SPA в production build)
- Backend API (FastAPI + Gunicorn, 2 workers)
- Celery Worker (асинхронные задачи, concurrency=1)
- Celery Beat (планировщик задач)
- PostgreSQL 15 (512-768MB RAM allocation)
- Redis 7 (384MB RAM allocation)

**Общая память:** ~3.5GB (оставляя 500MB для системы)

### 1.3. Отличия от Production Deployment

| Параметр | Staging (4GB RAM) | Production (8GB+ RAM) |
|----------|-------------------|------------------------|
| Backend Workers | 2 | 4-9 (2*cores + 1) |
| Celery Concurrency | 1 | 2-4 |
| PostgreSQL RAM | 384-768MB | 1-2GB |
| Redis RAM | 192-384MB | 512MB-1GB |
| PostgreSQL shared_buffers | 128MB | 256-512MB |
| PostgreSQL max_connections | 100 | 200 |
| Logging Level | WARNING | INFO |
| Monitoring Stack | Disabled | Enabled (Prometheus+Grafana) |
| Watchtower Auto-updates | Disabled | Enabled |
| Backup Retention | 3 days | 7+ days |

---

## 2. Server Requirements

### 2.1. Hardware

**Minimum Requirements:**
- **CPU:** 2 cores (x86_64 или ARM64)
- **RAM:** 4GB minimum
- **Storage:** 100GB SSD (HDD возможен, но медленнее)
- **Network:** 100 Mbps minimum bandwidth
- **Swap:** 2GB recommended (для 4GB RAM servers)

**Recommended Setup:**
- **CPU:** 4 cores (для лучшей производительности)
- **RAM:** 4-6GB
- **Storage:** 250GB NVMe SSD
- **Network:** 1 Gbps
- **Swap:** 4GB

**Not Suitable:**
- Shared hosting (нужен dedicated/VPS)
- 2GB RAM servers (недостаточно для всех сервисов)
- 1 CPU core (bottleneck для Gunicorn workers)

### 2.2. Software

**Operating System:**
- **Recommended:** Ubuntu 22.04 LTS
- **Альтернативы:**
  - Debian 12
  - CentOS Stream 9
  - Rocky Linux 9
  - Amazon Linux 2023

**Required Software:**
- Docker 24.0+ (Docker Engine)
- Docker Compose 2.20+ (Plugin version)
- Git 2.x+
- curl/wget (для скриптов)
- ssh client (для доступа)

**Optional But Recommended:**
- gh CLI (для GitHub integration)
- htop (для мониторинга ресурсов)
- ncdu (для анализа дискового пространства)
- prometheus node_exporter (для метрик)

### 2.3. Network

**Firewall Rules (UFW/iptables):**

```bash
# Allow SSH (CRITICAL - don't lock yourself out!)
22/tcp     ALLOW       Anywhere

# Allow HTTP/HTTPS
80/tcp     ALLOW       Anywhere
443/tcp    ALLOW       Anywhere

# Optional - Monitoring (if Grafana enabled)
3000/tcp   ALLOW       <your_ip_only>  # Grafana
9090/tcp   ALLOW       <your_ip_only>  # Prometheus
```

**DNS Configuration:**

```
A record:       staging.yourdomain.com  →  <server_ip>
AAAA record:    staging.yourdomain.com  →  <server_ipv6>  (optional)
```

**SSL Certificates:**

Два варианта:
1. **Let's Encrypt** (recommended для публичных доменов)
2. **Self-signed** (для internal testing)

---

## 3. Pre-Deployment Checklist

### 3.1. Server Preparation

**Выполнить на сервере:**

- [ ] Server accessible via SSH (`ssh user@staging.yourdomain.com`)
- [ ] Non-root user с sudo access (НЕ используйте root напрямую!)
- [ ] SSH key authentication настроен (password auth отключен)
- [ ] Firewall configured (ports 22, 80, 443)
- [ ] Domain/subdomain configured (DNS A record)
- [ ] Docker установлен и работает (`docker --version`)
- [ ] Docker Compose plugin установлен (`docker compose version`)
- [ ] Swap configured (для 4GB RAM servers)
- [ ] System updated (`sudo apt update && sudo apt upgrade -y`)
- [ ] Timezone настроен (`timedatectl set-timezone Europe/Moscow`)

**Проверка готовности сервера:**

```bash
# Версии ПО
docker --version        # Должна быть 24.0+
docker compose version  # Должна быть 2.20+
git --version           # Любая 2.x

# Ресурсы
free -h                 # 4GB RAM или больше
df -h                   # 100GB+ свободного места
nproc                   # 2+ CPU cores

# Сеть
curl -I https://github.com  # Интернет работает
dig +short staging.yourdomain.com  # DNS настроен
```

### 3.2. Local Preparation

**Выполнить локально (на вашей машине):**

- [ ] Git repository cloned
- [ ] Environment variables prepared (см. раздел 4.3)
- [ ] Secrets generated (SECRET_KEY, JWT_SECRET_KEY, passwords)
- [ ] SSL strategy decided (Let's Encrypt vs self-signed)
- [ ] Backup plan defined (где хранить backups)
- [ ] Admin credentials prepared
- [ ] SMTP settings available (для email notifications)

**Генерация секретов:**

```bash
# SECRET_KEY (64 chars)
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# JWT_SECRET_KEY (64 chars)
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# DB_PASSWORD (32 chars)
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# REDIS_PASSWORD (32 chars)
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Сохраните все секреты в password manager!
```

---

## 4. Step-by-Step Deployment

### Step 1: Server Setup

**1.1. SSH в сервер:**

```bash
ssh user@staging.yourdomain.com
```

**1.2. Создать non-root user (если еще нет):**

```bash
# На сервере (если залогинились как root)
adduser deployer
usermod -aG sudo deployer
usermod -aG docker deployer

# Настроить SSH key
mkdir -p /home/deployer/.ssh
cp ~/.ssh/authorized_keys /home/deployer/.ssh/
chown -R deployer:deployer /home/deployer/.ssh
chmod 700 /home/deployer/.ssh
chmod 600 /home/deployer/.ssh/authorized_keys

# Протестировать
su - deployer
sudo ls  # Должно запросить пароль и сработать
```

**1.3. Update system:**

```bash
sudo apt update && sudo apt upgrade -y
```

**1.4. Install Docker (если не установлен):**

```bash
# Удалить старые версии (если есть)
sudo apt remove docker docker-engine docker.io containerd runc

# Установить Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Добавить пользователя в docker группу
sudo usermod -aG docker $USER
newgrp docker

# Проверить
docker run hello-world
```

**1.5. Install Docker Compose:**

```bash
# Уже включен в Docker 24.0+
docker compose version

# Если не установлен:
sudo apt install docker-compose-plugin
```

**1.6. Install additional tools:**

```bash
sudo apt install -y git curl wget htop ncdu ufw
```

**1.7. Configure swap (КРИТИЧЕСКИ ВАЖНО для 4GB RAM!):**

```bash
# Создать 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Сделать постоянным
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Настроить swappiness (как часто использовать swap)
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Проверить
free -h
# Должно показать 2GB swap
```

**1.8. Configure firewall:**

```bash
# Включить UFW
sudo ufw allow 22/tcp       # SSH (КРИТИЧНО!)
sudo ufw allow 80/tcp       # HTTP
sudo ufw allow 443/tcp      # HTTPS
sudo ufw enable

# Проверить
sudo ufw status
```

---

### Step 2: Clone Repository

**2.1. Выбрать директорию:**

```bash
# Recommended: /opt для production services
cd /opt
sudo mkdir -p bookreader
sudo chown deployer:deployer bookreader
cd bookreader

# Альтернатива: home directory
# cd ~
```

**2.2. Clone repo:**

```bash
git clone https://github.com/your-org/fancai-vibe-hackathon.git
cd fancai-vibe-hackathon

# Проверить
git status
git log --oneline -5
```

**2.3. Checkout нужную ветку (если не main):**

```bash
# Для production используйте stable tag
git checkout v1.0.0

# Для staging можно использовать develop
git checkout develop
```

---

### Step 3: Environment Configuration

**3.1. Copy staging template:**

```bash
cp .env.staging.example .env.staging
```

**3.2. Edit environment file:**

```bash
# Используйте любой редактор
nano .env.staging
# или
vim .env.staging
```

**3.3. ОБЯЗАТЕЛЬНЫЕ переменные для изменения:**

```bash
# ============================================================================
# DOMAIN CONFIGURATION
# ============================================================================
DOMAIN_NAME=staging.yourdomain.com      # Ваш домен!
DOMAIN_URL=https://staging.yourdomain.com  # С протоколом
SSL_EMAIL=admin@yourdomain.com          # Для Let's Encrypt

# ============================================================================
# DATABASE SETTINGS
# ============================================================================
DB_NAME=bookreader_staging
DB_USER=postgres
DB_PASSWORD=<СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ_32_CHARS>  # Из раздела 3.2!

# ============================================================================
# REDIS SETTINGS
# ============================================================================
REDIS_PASSWORD=<СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ_32_CHARS>  # Из раздела 3.2!

# ============================================================================
# SECURITY SECRETS (КРИТИЧНО!)
# ============================================================================
SECRET_KEY=<СГЕНЕРИРОВАННЫЙ_СЕКРЕТ_64_CHARS>     # Из раздела 3.2!
JWT_SECRET_KEY=<СГЕНЕРИРОВАННЫЙ_СЕКРЕТ_64_CHARS> # Из раздела 3.2!

# ============================================================================
# AI SERVICES (ОПЦИОНАЛЬНО)
# ============================================================================
OPENAI_API_KEY=sk-proj-...  # Если хотите использовать DALL-E
POLLINATIONS_ENABLED=true    # Бесплатный сервис
```

**3.4. РЕКОМЕНДУЕМЫЕ переменные для настройки:**

```bash
# Multi-NLP Mode (для staging можно использовать parallel вместо ensemble)
MULTI_NLP_MODE=parallel  # Быстрее, меньше памяти

# Logging (WARNING для staging)
LOG_LEVEL=warning

# Backup retention (короче для staging)
BACKUP_RETENTION_DAYS=3

# CORS (если frontend на другом домене)
CORS_ORIGINS=https://staging.yourdomain.com,https://app.yourdomain.com
```

**3.5. Проверить .env.staging:**

```bash
# Убедиться что нет пустых обязательных переменных
grep -E "REPLACE_WITH|<СГЕНЕРИРОВАННЫЙ" .env.staging
# Не должно быть вывода!

# Проверить базовую валидность
grep -E "^[A-Z_]+=.+" .env.staging | wc -l
# Должно быть 30+ переменных
```

---

### Step 4: SSL Certificates Setup

#### Option A - Let's Encrypt (Recommended для публичного домена)

**4.1. Ensure domain points to server:**

```bash
# Проверить DNS
dig +short staging.yourdomain.com

# Должно вернуть IP вашего сервера
# Если нет - подождите до 48 часов для DNS propagation
```

**4.2. Initialize Certbot:**

```bash
# ВАЖНО: Сначала нужно создать dummy SSL сертификаты
# Nginx не стартует без сертификатов в /nginx/ssl/

mkdir -p nginx/ssl
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -days 1 \
  -subj "/CN=${DOMAIN_NAME}"

# Теперь запустить Certbot init
# TODO: Нужен docker-compose.ssl.yml для certbot
# Пока используем manual certbot
sudo apt install -y certbot

# Временно остановить nginx если запущен
docker compose -f docker-compose.staging.yml stop nginx

# Получить сертификат
sudo certbot certonly --standalone \
  --preferred-challenges http \
  --email ${SSL_EMAIL} \
  --agree-tos \
  --no-eff-email \
  -d staging.yourdomain.com

# Скопировать сертификаты
sudo cp /etc/letsencrypt/live/staging.yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/staging.yourdomain.com/privkey.pem nginx/ssl/
sudo chown $USER:$USER nginx/ssl/*.pem

# Перезапустить nginx
docker compose -f docker-compose.staging.yml up -d nginx
```

**4.3. Setup auto-renewal:**

```bash
# Добавить cron job для renewal
sudo crontab -e

# Добавить строку (проверка каждый день в 3 AM):
0 3 * * * certbot renew --quiet --deploy-hook "cp /etc/letsencrypt/live/staging.yourdomain.com/*.pem /opt/bookreader/fancai-vibe-hackathon/nginx/ssl/ && docker compose -f /opt/bookreader/fancai-vibe-hackathon/docker-compose.staging.yml restart nginx"
```

#### Option B - Self-Signed (для internal testing)

**4.1. Generate self-signed certificate:**

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=BookReader AI/CN=staging.yourdomain.com"

# Проверить
ls -lh nginx/ssl/
# Должно быть 2 файла: privkey.pem, fullchain.pem
```

**4.2. Trust certificate locally (опционально):**

```bash
# На вашей локальной машине (macOS)
scp user@staging.yourdomain.com:/opt/bookreader/fancai-vibe-hackathon/nginx/ssl/fullchain.pem ./staging-cert.pem
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain staging-cert.pem

# Linux
# Скопировать в /usr/local/share/ca-certificates/ и запустить update-ca-certificates
```

---

### Step 5: Deploy Services

**5.1. Pull/build Docker images:**

```bash
# Build images (займет 5-10 минут при первом запуске)
docker compose -f docker-compose.staging.yml build

# Проверить созданные images
docker images | grep bookreader
```

**5.2. Create required directories:**

```bash
# Backend storage
mkdir -p backend/storage/{books,uploads,exports}

# Backups
sudo mkdir -p /backups/postgresql
sudo chown deployer:deployer /backups/postgresql

# Logs (опционально)
mkdir -p logs
```

**5.3. Start all services:**

```bash
# Start in background
docker compose -f docker-compose.staging.yml up -d

# Watch logs during startup (Ctrl+C to exit)
docker compose -f docker-compose.staging.yml logs -f
```

**5.4. Verify services started:**

```bash
# Check status
docker compose -f docker-compose.staging.yml ps

# All services should be "Up" and "healthy"
```

**5.5. Troubleshooting startup issues:**

```bash
# If PostgreSQL не стартует
docker compose -f docker-compose.staging.yml logs postgres

# If Redis не стартует
docker compose -f docker-compose.staging.yml logs redis

# If Backend не стартует
docker compose -f docker-compose.staging.yml logs backend

# Common issues:
# - Permission denied на volumes: sudo chown -R 999:999 volumes/postgres_data
# - Порты уже заняты: netstat -tlnp | grep :80
# - Out of memory: free -h (check swap enabled)
```

---

### Step 6: Database Initialization

**6.1. Wait for PostgreSQL to be ready:**

```bash
# Test connection
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from app.core.database import engine; import asyncio; asyncio.run(engine.connect())"

# Если ошибка - подождать еще 30 секунд
# PostgreSQL может инициализироваться до 1 минуты
```

**6.2. Run database migrations:**

```bash
# Check current migration status
docker compose -f docker-compose.staging.yml exec backend \
  alembic current

# Run migrations
docker compose -f docker-compose.staging.yml exec backend \
  alembic upgrade head

# Verify
docker compose -f docker-compose.staging.yml exec backend \
  alembic current

# Должно показать HEAD revision
```

**6.3. Verify database configuration:**

```bash
# Run verification script
./scripts/verify-database-config.sh

# Проверит:
# - PostgreSQL config loaded
# - Redis config loaded
# - Extensions installed
# - Helper functions created
# - Memory settings correct
```

**6.4. Check extensions and helper functions:**

```bash
# List installed extensions
docker compose -f docker-compose.staging.yml exec postgres \
  psql -U postgres -d bookreader_staging -c "SELECT * FROM pg_extension;"

# Should see: pg_stat_statements, pg_trgm, btree_gin, uuid-ossp

# Test helper functions
docker compose -f docker-compose.staging.yml exec postgres \
  psql -U postgres -d bookreader_staging -c "SELECT * FROM get_database_size();"

# Should return database size in human-readable format
```

---

### Step 7: Create Admin User

**7.1. Interactive method (recommended):**

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
            hashed_password=get_password_hash('CHANGE_THIS_PASSWORD'),
            is_active=True,
            is_admin=True
        )
        db.add(admin)
        await db.commit()
        print(f'Admin user created: {admin.email}')
        break

asyncio.run(create_admin())
"
```

**7.2. Using script (если есть create_admin.py):**

```bash
# Создать скрипт если еще нет
cat > backend/scripts/create_admin.py << 'EOF'
import asyncio
import sys
from app.core.database import get_db
from app.models.user import User
from app.core.security import get_password_hash

async def create_admin(email: str, password: str):
    async for db in get_db():
        admin = User(
            email=email,
            username=email.split('@')[0],
            hashed_password=get_password_hash(password),
            is_active=True,
            is_admin=True
        )
        db.add(admin)
        await db.commit()
        print(f'✅ Admin user created: {admin.email}')
        break

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python create_admin.py <email> <password>')
        sys.exit(1)

    asyncio.run(create_admin(sys.argv[1], sys.argv[2]))
EOF

# Запустить
docker compose -f docker-compose.staging.yml exec backend \
  python scripts/create_admin.py admin@yourdomain.com "SecurePassword123!"
```

---

### Step 8: Verification

**8.1. Check all services running:**

```bash
docker compose -f docker-compose.staging.yml ps

# All services should show:
# STATE: Up (healthy) или Up
```

**8.2. Check resource usage (should be <3.5GB):**

```bash
docker stats --no-stream

# Проверить MEMORY USAGE column
# Total should be ~3-3.5GB
```

**8.3. Test endpoints:**

```bash
# Health check (должно вернуть 200 OK)
curl -I https://staging.yourdomain.com/health

# API health (JSON response)
curl https://staging.yourdomain.com/api/health

# Should return:
# {"status":"ok","timestamp":"2025-11-15T..."}
```

**8.4. Test authentication:**

```bash
# Login (получить JWT token)
curl -X POST https://staging.yourdomain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "SecurePassword123!"
  }'

# Should return access_token
```

**8.5. Check NLP models loaded:**

```bash
# Test SpaCy
docker compose -f docker-compose.staging.yml exec backend \
  python -c "import spacy; nlp = spacy.load('ru_core_news_lg'); print('✅ SpaCy OK')"

# Test Natasha
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from natasha import NamesExtractor; print('✅ Natasha OK')"

# Test Stanza
docker compose -f docker-compose.staging.yml exec backend \
  python -c "import stanza; nlp = stanza.Pipeline('ru', download_method=None); print('✅ Stanza OK')"
```

**8.6. Test frontend:**

```bash
# Open in browser
# https://staging.yourdomain.com

# Should load React app
# Check browser console for errors
```

**8.7. Check logs for errors:**

```bash
# Backend logs (last 50 lines)
docker compose -f docker-compose.staging.yml logs --tail=50 backend

# Should not see ERROR or CRITICAL level logs

# Celery worker logs
docker compose -f docker-compose.staging.yml logs --tail=50 celery-worker
```

---

## 5. Post-Deployment Configuration

### 5.1. Setup Automated Backups

**5.1.1. Test backup script:**

```bash
# Make executable
chmod +x ./scripts/backup-database.sh

# Run test backup
./scripts/backup-database.sh

# Verify backup created
ls -lh /backups/postgresql/

# Should see backup_bookreader_staging_YYYYMMDD_HHMMSS.dump
```

**5.1.2. Add to crontab (daily at 2 AM):**

```bash
crontab -e

# Add line:
0 2 * * * cd /opt/bookreader/fancai-vibe-hackathon && ./scripts/backup-database.sh >> /var/log/backup-database.log 2>&1
```

**5.1.3. Test backup restoration:**

```bash
# List backups
./scripts/backup-database.sh --list

# Test restore (на staging можно безопасно)
# ВНИМАНИЕ: Это удалит текущие данные!
docker compose -f docker-compose.staging.yml exec postgres \
  pg_restore \
    -U postgres \
    -d bookreader_staging \
    --clean \
    --if-exists \
    /backups/postgresql/backup_bookreader_staging_20251115_020000.dump
```

### 5.2. Setup Log Rotation

**Already configured in docker-compose.staging.yml:**

```yaml
# Logrotate service (profile: logging)
# To enable:
docker compose -f docker-compose.staging.yml --profile logging up -d
```

**Manual logrotate configuration:**

```bash
# Create logrotate config
sudo tee /etc/logrotate.d/bookreader << EOF
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  size 10M
  missingok
  delaycompress
  copytruncate
}
EOF

# Test
sudo logrotate -d /etc/logrotate.d/bookreader
```

### 5.3. Configure Monitoring (Optional)

**5.3.1. Basic monitoring with docker stats:**

```bash
# Create monitoring script
cat > /usr/local/bin/docker-monitor.sh << 'EOF'
#!/bin/bash
while true; do
  clear
  echo "=== BookReader AI Resource Usage ==="
  echo "Date: $(date)"
  echo ""
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
  echo ""
  echo "=== System Resources ==="
  free -h
  echo ""
  sleep 5
done
EOF

chmod +x /usr/local/bin/docker-monitor.sh

# Run in screen/tmux
screen -S monitoring
/usr/local/bin/docker-monitor.sh
```

**5.3.2. Prometheus + Grafana (adds ~300MB RAM usage):**

```bash
# Only if you have RAM headroom
# Create docker-compose.monitoring.yml

docker compose -f docker-compose.monitoring.yml up -d

# Access Grafana: https://staging.yourdomain.com:3001
# Default credentials: admin/admin
```

### 5.4. Setup Health Checks Monitoring

**5.4.1. Simple uptime monitoring:**

```bash
# Add to crontab (check every 5 minutes)
crontab -e

# Add:
*/5 * * * * curl -sf https://staging.yourdomain.com/health || echo "BookReader staging DOWN!" | mail -s "ALERT: Staging Down" admin@yourdomain.com
```

**5.4.2. External monitoring services (recommended):**

- **UptimeRobot** (https://uptimerobot.com) - Free, 50 monitors
- **StatusCake** (https://www.statuscake.com) - Free tier available
- **Pingdom** (https://www.pingdom.com) - Paid

---

## 6. Resource Monitoring

### 6.1. Memory Usage Targets

**Expected memory allocation (safe для 4GB server):**

```
Service             Target RAM      Actual Usage (typical)
──────────────────────────────────────────────────────────
Nginx               100MB           64-128MB
Frontend            200MB           128-256MB
Backend             1.2GB           768MB-1.5GB (NLP models)
Celery Worker       800MB           512MB-1GB
Celery Beat         200MB           128-256MB
PostgreSQL          600MB           384-768MB
Redis               300MB           192-384MB
──────────────────────────────────────────────────────────
System Overhead     500MB           400-800MB (kernel, ssh, etc)
──────────────────────────────────────────────────────────
TOTAL               ~3.9GB          ~3-3.5GB
──────────────────────────────────────────────────────────
Available for Burst                 ~500MB
```

### 6.2. Monitoring Commands

**Real-time resource monitoring:**

```bash
# Docker containers
docker stats

# System memory
free -h

# Swap usage
swapon --show

# Disk usage
df -h /var/lib/docker

# Top processes
htop
```

**PostgreSQL-specific:**

```bash
# Database size
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT pg_size_pretty(pg_database_size('bookreader_staging'));
"

# Connection count
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT count(*) FROM pg_stat_activity;
"

# Cache hit ratio (should be >99%)
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT
    sum(heap_blks_hit)::NUMERIC /
    nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100
    as cache_hit_ratio
  FROM pg_statio_user_tables;
"
```

**Redis-specific:**

```bash
# Memory usage
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} INFO MEMORY | grep used_memory_human

# Keyspace
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} INFO KEYSPACE

# Connected clients
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} INFO CLIENTS | grep connected_clients
```

### 6.3. Alert Thresholds

**Set up alerts when:**

| Metric | Warning Threshold | Critical Threshold | Action |
|--------|-------------------|-------------------|--------|
| Total RAM usage | >3.5GB | >3.8GB | Restart services, check memory leaks |
| Swap usage | >500MB | >1GB | Optimize services, add RAM |
| Disk usage | >80% | >90% | Clean old backups, logs |
| PostgreSQL connections | >80 | >95 | Increase pool_size or max_connections |
| CPU usage | >80% | >95% | Scale workers, optimize queries |
| Response time | >2s | >5s | Check logs, database performance |

---

## 7. Common Operations

### 7.1. Update Application

**7.1.1. Pull latest code:**

```bash
cd /opt/bookreader/fancai-vibe-hackathon

# Stash local changes (if any)
git stash

# Pull latest
git pull origin develop  # or main

# Apply stashed changes back
git stash pop
```

**7.1.2. Rebuild and restart:**

```bash
# Rebuild images
docker compose -f docker-compose.staging.yml build

# Restart services (zero-downtime для stateless services)
docker compose -f docker-compose.staging.yml up -d

# Run new migrations (if any)
docker compose -f docker-compose.staging.yml exec backend alembic upgrade head
```

**7.1.3. Verify update:**

```bash
# Check logs
docker compose -f docker-compose.staging.yml logs --tail=100 backend

# Test health endpoint
curl https://staging.yourdomain.com/health
```

### 7.2. Restart Services

**Restart all services:**

```bash
docker compose -f docker-compose.staging.yml restart
```

**Restart specific service:**

```bash
# Backend only
docker compose -f docker-compose.staging.yml restart backend

# PostgreSQL only (ВНИМАНИЕ: кратковременный downtime!)
docker compose -f docker-compose.staging.yml restart postgres

# Redis only
docker compose -f docker-compose.staging.yml restart redis
```

**Graceful reload (без downtime для backend):**

```bash
# Reload Gunicorn workers
docker compose -f docker-compose.staging.yml exec backend kill -HUP 1
```

### 7.3. View Logs

**All services (live stream):**

```bash
docker compose -f docker-compose.staging.yml logs -f
```

**Specific service:**

```bash
# Backend (last 100 lines, then follow)
docker compose -f docker-compose.staging.yml logs -f --tail=100 backend

# Celery worker
docker compose -f docker-compose.staging.yml logs -f --tail=100 celery-worker

# PostgreSQL
docker compose -f docker-compose.staging.yml logs -f postgres
```

**Search logs:**

```bash
# Errors only
docker compose -f docker-compose.staging.yml logs backend | grep ERROR

# Specific time range
docker compose -f docker-compose.staging.yml logs --since=2h backend

# Save to file
docker compose -f docker-compose.staging.yml logs > logs/deployment_$(date +%Y%m%d).log
```

### 7.4. Database Backup/Restore

**Create backup:**

```bash
./scripts/backup-database.sh
```

**List backups:**

```bash
./scripts/backup-database.sh --list
```

**Restore from backup:**

```bash
# ВНИМАНИЕ: Это удалит все текущие данные!

# 1. Stop backend services
docker compose -f docker-compose.staging.yml stop backend celery-worker

# 2. Restore database
docker exec bookreader_postgres_staging pg_restore \
  -U postgres \
  -d bookreader_staging \
  --clean \
  --if-exists \
  -v \
  < /backups/postgresql/backup_bookreader_staging_YYYYMMDD_HHMMSS.dump

# 3. Restart services
docker compose -f docker-compose.staging.yml start backend celery-worker

# 4. Verify
curl https://staging.yourdomain.com/health
```

**Full disaster recovery procedure:**

См. раздел 11. Disaster Recovery

---

## 8. Troubleshooting

### 8.1. Out of Memory (OOM) Kills

**Symptoms:**

```bash
# Check kernel logs для OOM killer
sudo dmesg | grep -i oom

# Check docker events
docker events --filter 'event=oom' --since 1h
```

**Solutions:**

**Option 1: Reduce Celery concurrency**

```bash
# Edit .env.staging
CELERY_CONCURRENCY=0  # Disable Celery worker completely

# Or reduce to 1 (уже настроено по умолчанию)
CELERY_CONCURRENCY=1
```

**Option 2: Reduce backend workers**

```bash
# Edit .env.staging
WORKERS_COUNT=2  # Уже настроено, можно попробовать 1

# Restart
docker compose -f docker-compose.staging.yml restart backend
```

**Option 3: Disable monitoring stack**

```bash
# Stop monitoring services
docker compose -f docker-compose.monitoring.yml down
```

**Option 4: Add more swap**

```bash
# Create 4GB swap instead of 2GB
sudo fallocate -l 4G /swapfile2
sudo chmod 600 /swapfile2
sudo mkswap /swapfile2
sudo swapon /swapfile2
```

**Option 5: Reduce PostgreSQL/Redis memory**

See `docker-compose.staging.yml` and adjust memory limits.

### 8.2. Services Not Starting

**Check status:**

```bash
docker compose -f docker-compose.staging.yml ps
```

**Common issues:**

**PostgreSQL fails to start:**

```bash
# Check logs
docker compose -f docker-compose.staging.yml logs postgres

# Common causes:
# 1. Permission denied на volume
sudo chown -R 999:999 volumes/postgres_data

# 2. Port already in use
sudo netstat -tlnp | grep :5432
# Kill conflicting process или change port

# 3. Corrupted data
# Restore from backup или remove volume (ТЕРЯЕТ ДАННЫЕ!)
docker volume rm bookreader_postgres_data
```

**Redis fails to start:**

```bash
# Check logs
docker compose -f docker-compose.staging.yml logs redis

# Common causes:
# 1. Permission denied
sudo chown -R 999:999 volumes/redis_data

# 2. Config error
docker compose -f docker-compose.staging.yml exec redis \
  redis-server --test-config
```

**Backend fails to start:**

```bash
# Check logs
docker compose -f docker-compose.staging.yml logs backend

# Common causes:
# 1. Database not ready - wait 30 more seconds
# 2. Missing environment variables
docker compose -f docker-compose.staging.yml exec backend env | grep DATABASE_URL

# 3. Migration errors
docker compose -f docker-compose.staging.yml exec backend alembic current
```

### 8.3. Database Connection Errors

**Symptoms:**

```
sqlalchemy.exc.OperationalError: could not connect to server
```

**Check connection:**

```bash
# From backend container
docker compose -f docker-compose.staging.yml exec backend \
  nc -zv postgres 5432

# Should return: postgres (172.21.x.x:5432) open
```

**Check pool exhaustion:**

```bash
# Check active connections
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT count(*) FROM pg_stat_activity;
"

# If close to 100 (max_connections), increase DB_POOL_SIZE or investigate leaks
```

**Solutions:**

1. Increase `DB_POOL_SIZE` в `.env.staging`
2. Increase `DB_MAX_OVERFLOW`
3. Check для connection leaks в коде
4. Add PgBouncer (для production)

### 8.4. NLP Models Not Loading

**Symptoms:**

```
ModuleNotFoundError: No module named 'ru_core_news_lg'
```

**Check volumes exist:**

```bash
docker volume ls | grep nlp

# Should see:
# bookreader_nlp_nltk_data
# bookreader_nlp_stanza_models
```

**Check models in container:**

```bash
# SpaCy models
docker compose -f docker-compose.staging.yml exec backend \
  ls -lh /root/nltk_data

# Stanza models
docker compose -f docker-compose.staging.yml exec backend \
  ls -lh /root/stanza_resources
```

**Reinstall models:**

```bash
# SpaCy
docker compose -f docker-compose.staging.yml exec backend \
  python -m spacy download ru_core_news_lg

# Natasha (already in requirements.txt)
docker compose -f docker-compose.staging.yml exec backend \
  pip install natasha

# Stanza
docker compose -f docker-compose.staging.yml exec backend \
  python -c "import stanza; stanza.download('ru')"
```

### 8.5. SSL Certificate Errors

**Let's Encrypt renewal failed:**

```bash
# Check certbot logs
sudo cat /var/log/letsencrypt/letsencrypt.log

# Manual renewal
sudo certbot renew --force-renewal

# Copy to nginx
sudo cp /etc/letsencrypt/live/staging.yourdomain.com/*.pem nginx/ssl/
docker compose -f docker-compose.staging.yml restart nginx
```

**Self-signed certificate not trusted:**

- Expected для self-signed certificates
- Add exception в браузере
- Or install certificate в OS trust store (см. Step 4B)

### 8.6. High CPU Usage

**Identify culprit:**

```bash
# Docker stats
docker stats

# Check PostgreSQL queries
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
  SELECT pid, now() - query_start as duration, state, query
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC;
"
```

**Solutions:**

1. Optimize slow queries (add indexes)
2. Reduce worker count
3. Add rate limiting
4. Scale horizontally (more servers)

---

## 9. Security Best Practices

### 9.1. Firewall Configuration

**UFW (Ubuntu):**

```bash
# Basic rules (уже должны быть настроены)
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# Advanced: Rate limiting для SSH
sudo ufw limit 22/tcp

# Check status
sudo ufw status verbose
```

**Fail2ban (optional но recommended):**

```bash
# Install
sudo apt install -y fail2ban

# Configure
sudo tee /etc/fail2ban/jail.local << EOF
[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
EOF

# Start
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check
sudo fail2ban-client status
```

### 9.2. Secrets Management

**НИКОГДА:**
- ❌ Не коммитить .env.staging в git
- ❌ Не хранить passwords в plain text
- ❌ Не использовать weak passwords
- ❌ Не переиспользовать passwords между окружениями

**ВСЕГДА:**
- ✅ Использовать strong passwords (32+ chars)
- ✅ Хранить secrets в password manager (1Password, LastPass, Bitwarden)
- ✅ Rotate secrets регулярно (каждые 90 дней)
- ✅ Use environment variables для secrets
- ✅ Different secrets для staging/production

**Password requirements:**

```bash
# Generate strong password (32 chars, alphanumeric + special)
openssl rand -base64 32

# Or use password manager to generate
```

### 9.3. Regular Updates

**System updates (monthly):**

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Reboot if kernel updated
sudo reboot
```

**Docker updates (quarterly):**

```bash
# Update Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Verify
docker --version
```

**Application updates:**

See section 7.1. Update Application

### 9.4. SSL/TLS Configuration

**Check SSL configuration:**

```bash
# Test SSL with OpenSSL
openssl s_client -connect staging.yourdomain.com:443 -servername staging.yourdomain.com

# Test with SSL Labs (https://www.ssllabs.com/ssltest/)
# Should get A or A+ rating
```

**Harden nginx SSL config:**

Already configured in `nginx/nginx.prod.conf.template`:

```nginx
# TLS 1.2 and 1.3 only
ssl_protocols TLSv1.2 TLSv1.3;

# Strong ciphers
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256...';

# HSTS header (1 year)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### 9.5. Database Security

**PostgreSQL:**

```bash
# Use strong password (already configured via env)
DB_PASSWORD=<32+ char random password>

# Restrict network access (already in docker-compose)
# PostgreSQL port (5432) NOT exposed to host

# Backup encryption (optional)
# Encrypt backups with GPG
gpg --symmetric --cipher-algo AES256 /backups/postgresql/backup.dump
```

**Redis:**

```bash
# Require password (already configured)
REDIS_PASSWORD=<32+ char random password>

# Disable dangerous commands (already in redis.conf)
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

---

## 10. Performance Optimization

### 10.1. If Memory Usage Too High

**Gradual reduction strategy:**

1. **Level 1: Reduce backend workers**
   ```bash
   # .env.staging
   WORKERS_COUNT=1  # Down from 2
   ```

2. **Level 2: Reduce Celery concurrency**
   ```bash
   # .env.staging
   CELERY_CONCURRENCY=0  # Disable Celery completely

   # Or process tasks synchronously в backend
   ```

3. **Level 3: Reduce database buffers**
   ```bash
   # docker-compose.staging.yml - PostgreSQL command
   -c shared_buffers=64MB  # Down from 128MB
   -c effective_cache_size=256MB  # Down from 512MB
   ```

4. **Level 4: Reduce Redis maxmemory**
   ```bash
   # docker-compose.staging.yml - Redis command
   --maxmemory 256mb  # Down from 384mb
   ```

5. **Level 5: Disable services**
   ```bash
   # Disable Celery Beat (if not using scheduled tasks)
   docker compose -f docker-compose.staging.yml stop celery-beat
   ```

### 10.2. If CPU Usage Too High

**Solutions:**

1. **Add rate limiting (nginx)**
   ```nginx
   # nginx.conf
   limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

   location /api/ {
       limit_req zone=api burst=20 nodelay;
   }
   ```

2. **Optimize database queries**
   ```bash
   # Find slow queries
   docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "
     SELECT * FROM get_slow_queries(10);
   "

   # Add indexes for common queries
   ```

3. **Enable caching**
   ```python
   # In backend code, use Redis caching
   @cache(expire=300)  # 5 minutes
   def expensive_operation():
       ...
   ```

4. **Reduce worker processes**
   ```bash
   # .env.staging
   WORKERS_COUNT=1
   ```

### 10.3. Database Query Optimization

**Identify slow queries:**

```sql
-- Top 10 slowest queries
SELECT * FROM get_slow_queries(10);

-- Queries without indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
  AND correlation < 0.1;
```

**Add indexes:**

```sql
-- Example: Index для user_id lookups
CREATE INDEX CONCURRENTLY idx_books_user_id ON books(user_id);

-- Composite index
CREATE INDEX CONCURRENTLY idx_books_user_created
  ON books(user_id, created_at DESC);

-- Partial index
CREATE INDEX CONCURRENTLY idx_books_parsed
  ON books(user_id)
  WHERE is_parsed = true;
```

**Monitor index usage:**

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC
LIMIT 20;

-- Indexes with idx_scan = 0 are not being used (consider dropping)
```

---

## 11. Disaster Recovery

### 11.1. Backup Strategy

**What to backup:**

1. **PostgreSQL database** (CRITICAL)
   - Frequency: Daily (automated)
   - Retention: 3 days (staging), 7+ days (production)
   - Location: `/backups/postgresql/`

2. **Redis data** (NICE TO HAVE)
   - RDB snapshots: Automatic (see redis.conf)
   - AOF file: Continuous
   - Location: Redis data volume

3. **Uploaded files** (CRITICAL если есть user uploads)
   - Frequency: Weekly
   - Location: `backend/storage/`

4. **Configuration files** (IMPORTANT)
   - `.env.staging` (храните в password manager!)
   - `nginx/ssl/` (certificates)
   - Frequency: After changes

**Automated backup:**

```bash
# Already configured in Step 5.1
# Runs daily at 2 AM via cron
0 2 * * * cd /opt/bookreader/fancai-vibe-hackathon && ./scripts/backup-database.sh
```

**Manual backup:**

```bash
# Database
./scripts/backup-database.sh

# Storage files
tar -czf /backups/storage-$(date +%Y%m%d).tar.gz backend/storage/

# Configuration
tar -czf /backups/config-$(date +%Y%m%d).tar.gz .env.staging nginx/ssl/
```

### 11.2. Recovery Procedures

#### Scenario 1: Database Corrupted

**Symptoms:**
- PostgreSQL won't start
- Data corruption errors
- Queries failing

**Recovery:**

```bash
# 1. Stop services
docker compose -f docker-compose.staging.yml stop backend celery-worker celery-beat

# 2. Backup current (corrupted) database (just in case)
docker exec bookreader_postgres_staging pg_dumpall -U postgres > /tmp/corrupted_backup.sql

# 3. Drop and recreate database
docker exec bookreader_postgres_staging psql -U postgres -c "
  DROP DATABASE bookreader_staging;
  CREATE DATABASE bookreader_staging;
"

# 4. Restore from backup
LATEST_BACKUP=$(ls -t /backups/postgresql/backup_*.dump | head -1)
docker exec -i bookreader_postgres_staging pg_restore \
  -U postgres \
  -d bookreader_staging \
  -v \
  < $LATEST_BACKUP

# 5. Run migrations (to bring to latest schema)
docker compose -f docker-compose.staging.yml exec backend alembic upgrade head

# 6. Start services
docker compose -f docker-compose.staging.yml start backend celery-worker celery-beat

# 7. Verify
curl https://staging.yourdomain.com/health
```

#### Scenario 2: Complete Server Failure

**Prerequisites:**
- Backups stored offsite (S3, другой сервер, etc.)
- `.env.staging` saved в password manager
- SSL certificates backed up

**Recovery:**

```bash
# 1. Provision new server (same specs)
# Follow Steps 1-4 from main deployment guide

# 2. Restore code
git clone https://github.com/your-org/fancai-vibe-hackathon.git
cd fancai-vibe-hackathon

# 3. Restore configuration
# Manually create .env.staging from password manager
nano .env.staging

# Restore SSL certificates
scp backup-server:/backups/ssl/*.pem nginx/ssl/

# 4. Start services
docker compose -f docker-compose.staging.yml up -d

# 5. Wait for PostgreSQL ready
sleep 30

# 6. Restore database
scp backup-server:/backups/postgresql/latest.dump /tmp/
docker compose -f docker-compose.staging.yml exec postgres pg_restore \
  -U postgres \
  -d bookreader_staging \
  -v \
  < /tmp/latest.dump

# 7. Restore storage files
scp -r backup-server:/backups/storage/* backend/storage/

# 8. Verify
curl https://staging.yourdomain.com/health
```

#### Scenario 3: Accidental Data Deletion

**Example: User accidentally deleted all books**

```bash
# 1. Identify when data was last good
./scripts/backup-database.sh --list

# 2. Stop write operations
docker compose -f docker-compose.staging.yml stop backend celery-worker

# 3. Create snapshot of current state (before restore)
./scripts/backup-database.sh

# 4. Restore from backup BEFORE deletion
docker exec -i bookreader_postgres_staging pg_restore \
  -U postgres \
  -d bookreader_staging \
  --clean \
  -t books \
  -t chapters \
  -t descriptions \
  < /backups/postgresql/backup_20251115_010000.dump

# Note: --table flag to restore only specific tables

# 5. Start services
docker compose -f docker-compose.staging.yml start backend celery-worker
```

### 11.3. Offsite Backup (Recommended)

**Setup S3 backup:**

```bash
# Install AWS CLI
sudo apt install -y awscli

# Configure
aws configure
# Enter: Access Key, Secret Key, Region

# Modify backup script to upload to S3
# Add to /scripts/backup-database.sh or create wrapper:

cat > /scripts/backup-to-s3.sh << 'EOF'
#!/bin/bash
set -e

# Run local backup
/opt/bookreader/fancai-vibe-hackathon/scripts/backup-database.sh

# Upload latest to S3
LATEST=$(ls -t /backups/postgresql/backup_*.dump | head -1)
aws s3 cp $LATEST s3://your-bucket/bookreader-staging/$(basename $LATEST)

echo "Backup uploaded to S3: $(basename $LATEST)"
EOF

chmod +x /scripts/backup-to-s3.sh

# Add to cron
crontab -e
# Change line to:
0 2 * * * /scripts/backup-to-s3.sh >> /var/log/backup-s3.log 2>&1
```

---

## 12. Comparison: Staging vs Production

| Aspect | Staging (4GB RAM) | Production (8GB+ RAM) |
|--------|-------------------|----------------------|
| **Purpose** | Testing, demos | Live users |
| **Uptime SLA** | Best effort (~95%) | 99.9%+ |
| **Workers** | 2 Gunicorn workers | 4-9 workers |
| **Celery** | 1 concurrency | 2-4 concurrency |
| **PostgreSQL RAM** | 384-768MB | 1-2GB |
| **PostgreSQL shared_buffers** | 128MB | 256-512MB |
| **PostgreSQL max_connections** | 100 | 200 |
| **Redis RAM** | 192-384MB | 512MB-1GB |
| **Logging** | WARNING level | INFO level |
| **Monitoring** | Optional | Mandatory (Prometheus+Grafana) |
| **Backups** | Daily, 3 days retention | Hourly, 7+ days, offsite |
| **SSL** | Let's Encrypt или self-signed | Let's Encrypt + wildcard |
| **Auto-updates** | Manual (Watchtower disabled) | Automated (Watchtower) |
| **Load balancing** | Single instance | Multiple instances + LB |
| **Disaster recovery** | Best effort, daily backups | PITR, replicas, automated failover |
| **Cost** | $5-20/month VPS | $50-200+/month |

---

## 13. Next Steps After Deployment

### 13.1. Immediate (Day 1)

**Validation checklist:**

- [ ] All services running and healthy
- [ ] Health endpoints responding (/, /health, /api/health)
- [ ] Can login with admin user
- [ ] Can upload test book (EPUB or FB2)
- [ ] NLP processing works (check descriptions generated)
- [ ] Image generation works (pollinations.ai)
- [ ] Database backup successful
- [ ] No ERROR logs в recent logs
- [ ] Memory usage <3.5GB
- [ ] CPU usage <80%
- [ ] SSL certificate valid (check in browser)

**Test critical user flows:**

```bash
# 1. User registration
curl -X POST https://staging.yourdomain.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "TestPassword123!"
  }'

# 2. Login
curl -X POST https://staging.yourdomain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!"
  }'

# Save access_token from response

# 3. Upload book (use real EPUB file)
curl -X POST https://staging.yourdomain.com/api/v1/books/upload \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@test.epub"

# 4. Check processing status
curl https://staging.yourdomain.com/api/v1/books/<book_id> \
  -H "Authorization: Bearer <access_token>"
```

**Document any issues:**

```bash
# Create issue log
cat > /opt/bookreader/DEPLOYMENT_ISSUES.md << 'EOF'
# Staging Deployment Issues Log

## 2025-11-15 - Initial Deployment

### Issues Found
- [ ] Issue 1: Description here
- [ ] Issue 2: Description here

### Resolved
- [x] Issue 3: Description and solution

EOF
```

### 13.2. Short-term (Week 1)

**Performance monitoring:**

- [ ] Review resource usage trends (daily docker stats)
- [ ] Check database cache hit ratio (should be >99%)
- [ ] Review slow queries (optimize если >1 second)
- [ ] Monitor backup success (check cron logs)
- [ ] Test backup restoration (at least once!)
- [ ] Review error logs (any patterns?)
- [ ] Measure response times (use curl или monitoring tool)

**Optimization based on actual usage:**

```bash
# If memory too high:
# - Reduce workers
# - Disable unused services
# - Tune PostgreSQL/Redis

# If CPU too high:
# - Add indexes
# - Optimize queries
# - Add rate limiting

# If disk filling up:
# - Clean old logs
# - Reduce backup retention
# - Archive old data
```

**Setup automated testing:**

```bash
# Create smoke test script
cat > /scripts/smoke-test.sh << 'EOF'
#!/bin/bash
set -e

echo "Running smoke tests..."

# Test health endpoint
curl -sf https://staging.yourdomain.com/health || exit 1

# Test API health
curl -sf https://staging.yourdomain.com/api/health || exit 1

# Test login
TOKEN=$(curl -sf -X POST https://staging.yourdomain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourdomain.com","password":"<password>"}' \
  | jq -r '.access_token')

[ -n "$TOKEN" ] || exit 1

echo "✅ All smoke tests passed"
EOF

chmod +x /scripts/smoke-test.sh

# Add to cron (hourly)
0 * * * * /scripts/smoke-test.sh >> /var/log/smoke-test.log 2>&1
```

**Train team on operations:**

- How to view logs
- How to restart services
- How to update application
- How to restore from backup
- Escalation procedures (who to contact)

### 13.3. Long-term (Month 1)

**Plan для scaling:**

- [ ] Review user growth trends
- [ ] Estimate when 4GB will be insufficient
- [ ] Plan migration to larger server или multi-server setup
- [ ] Document scaling strategy

**Review security posture:**

- [ ] Rotate all secrets (passwords, keys)
- [ ] Review firewall rules
- [ ] Check SSL certificate expiry (Let's Encrypt = 90 days)
- [ ] Review access logs для suspicious activity
- [ ] Update all system packages
- [ ] Test disaster recovery procedures

**Optimize based on metrics:**

```sql
-- Find unused indexes
SELECT
  schemaname, tablename, indexname,
  idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Drop if confirmed unused
DROP INDEX CONCURRENTLY idx_name;
```

**Consider CDN для static assets:**

- CloudFlare (free tier available)
- AWS CloudFront
- Fastly

---

## 14. Support and Resources

### 14.1. Documentation

**In this repository:**

- [Database Optimization Guide](../database-optimization-4gb-server.md) - PostgreSQL/Redis tuning
- [Docker Fixes Summary](/DOCKER_FIXES_SUMMARY.md) - Recent infrastructure fixes
- [Development Plan](/docs/development/planning/development-plan.md) - Roadmap
- [API Documentation](/docs/reference/api/overview.md) - REST API reference

**External:**

- [Docker Documentation](https://docs.docker.com/)
- [PostgreSQL 15 Docs](https://www.postgresql.org/docs/15/)
- [Redis Configuration](https://redis.io/docs/management/config/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/docs/)

### 14.2. Logs Location

```
/var/log/
├── backup-database.log       # Backup script logs
├── backup-s3.log             # S3 upload logs
├── smoke-test.log            # Automated test logs
└── ...

/var/lib/docker/containers/
└── <container_id>/
    └── <container_id>-json.log  # Container logs

Docker logs via:
docker compose -f docker-compose.staging.yml logs <service>
```

### 14.3. Monitoring Tools

**Built-in:**

```bash
# Resource usage
docker stats

# System monitoring
htop

# Disk usage
ncdu /var/lib/docker
```

**Optional:**

- Prometheus + Grafana (if enabled)
- UptimeRobot (external monitoring)
- Sentry (error tracking)
- LogDNA/Papertrail (log aggregation)

### 14.4. Getting Help

**If stuck:**

1. **Check logs** first:
   ```bash
   docker compose -f docker-compose.staging.yml logs --tail=200
   ```

2. **Search documentation** in this repo:
   ```bash
   grep -r "your error" docs/
   ```

3. **Review troubleshooting section** (Section 8)

4. **Check GitHub issues**:
   ```bash
   gh issue list --repo your-org/fancai-vibe-hackathon
   ```

5. **Create new issue** with:
   - Exact error message
   - Steps to reproduce
   - Environment details (OS, Docker version, RAM, CPU)
   - Relevant logs

---

## Appendix

### A. Quick Reference Commands

**Service management:**

```bash
# Start
docker compose -f docker-compose.staging.yml up -d

# Stop
docker compose -f docker-compose.staging.yml down

# Restart
docker compose -f docker-compose.staging.yml restart

# Logs
docker compose -f docker-compose.staging.yml logs -f --tail=100

# Status
docker compose -f docker-compose.staging.yml ps
```

**Resource monitoring:**

```bash
# Docker stats
docker stats --no-stream

# System resources
free -h && df -h && uptime

# PostgreSQL size
docker exec bookreader_postgres_staging psql -U postgres -d bookreader_staging -c "SELECT pg_size_pretty(pg_database_size('bookreader_staging'));"

# Redis memory
docker exec bookreader_redis_staging redis-cli -a ${REDIS_PASSWORD} INFO MEMORY | grep used_memory_human
```

**Backup/Restore:**

```bash
# Backup
./scripts/backup-database.sh

# List
./scripts/backup-database.sh --list

# Restore
# See section 11.2
```

### B. Environment Variables Quick Reference

**Critical (MUST change):**

- `DOMAIN_NAME` - Your domain
- `DB_PASSWORD` - Database password (32+ chars)
- `REDIS_PASSWORD` - Redis password (32+ chars)
- `SECRET_KEY` - App secret (64+ chars)
- `JWT_SECRET_KEY` - JWT secret (64+ chars)

**Optional but recommended:**

- `OPENAI_API_KEY` - If using DALL-E
- `SSL_EMAIL` - For Let's Encrypt
- `BACKUP_S3_BUCKET` - For offsite backups

**Performance tuning:**

- `WORKERS_COUNT` - Backend workers (default: 2)
- `CELERY_CONCURRENCY` - Celery workers (default: 1)
- `LOG_LEVEL` - Logging verbosity (default: warning)
- `MULTI_NLP_MODE` - NLP mode (default: parallel)

### C. Port Reference

| Service | Internal Port | External Port | Public? |
|---------|---------------|---------------|---------|
| Nginx | 80, 443 | 80, 443 | Yes |
| Frontend | 80 | - | No (via Nginx) |
| Backend | 8000 | - | No (via Nginx) |
| PostgreSQL | 5432 | - | No |
| Redis | 6379 | - | No |
| Celery Worker | - | - | No |
| Celery Beat | - | - | No |

Only ports 80 and 443 are exposed to internet.
All other services accessible only within Docker network.

### D. File Sizes Reference

**Docker images:**

```
bookreader-backend:   ~2.5GB (Python + NLP models)
bookreader-frontend:  ~200MB (nginx + static files)
postgres:15-alpine:   ~200MB
redis:7-alpine:       ~30MB
nginx:1.25-alpine:    ~40MB
```

**Volumes (typical после 1 месяца staging):**

```
postgres_data:        ~500MB-2GB (depends on books uploaded)
redis_data:           ~50-200MB
nlp_nltk_data:        ~500MB
nlp_stanza_models:    ~800MB
backend_storage:      ~1-5GB (uploaded books)
```

**Backups (compressed):**

```
Database dump:        ~10-50MB (depends on data)
Storage tar.gz:       ~500MB-2GB
Config backup:        ~1MB
```

---

**Document Version:** 1.0
**Last Updated:** 2025-11-15
**Maintained By:** DevOps Team
**Review Schedule:** Monthly

**Changelog:**

- 2025-11-15: Initial version - comprehensive staging deployment guide
- Next review: 2025-12-15

