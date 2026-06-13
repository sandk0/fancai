# Staging Deployment Plan - fancai.ru (88.210.35.41)

**Дата:** 15 ноября 2025
**Сервер:** Ubuntu 24.04, 4GB RAM, 2 CPU cores, 100GB Storage
**IP:** 88.210.35.41
**Домен:** fancai.ru
**Стратегия:** Полуавтоматический deployment с ручным первым запуском

---

## ⚠️ ВАЖНО: SSH Доступ

**Проблема:** SSH-ключ не настроен на сервере. Нужно добавить публичный ключ в `authorized_keys`.

### Решение 1: Добавить SSH-ключ через пароль

Если у вас есть пароль от root:

```bash
# Локально на вашей машине
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@88.210.35.41
# Введите пароль когда спросит

# Проверка
ssh root@88.210.35.41 'echo "✅ SSH OK"'
```

### Решение 2: Добавить через панель управления хостинга

1. Войти в панель управления сервера (VPS provider dashboard)
2. Найти раздел SSH Keys или Security
3. Скопировать ваш публичный ключ:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
4. Добавить в authorized_keys через веб-интерфейс

### Решение 3: Вручную через консоль хостинга

1. Открыть VNC/Console в панели хостинга
2. Залогиниться как root с паролем
3. Выполнить:
   ```bash
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   # Вставить ваш публичный ключ в следующую команду:
   echo "ssh-ed25519 AAAA... user@host" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

---

## 📋 План Deployment (После настройки SSH)

### Фаза 1: Подготовка Сервера (30-40 минут)

**1.1. Базовая настройка системы**
```bash
# Обновление системы
apt update && apt upgrade -y

# Установка базовых утилит
apt install -y curl wget git vim htop net-tools ufw

# Настройка timezone
timedatectl set-timezone Europe/Moscow

# Настройка hostname
hostnamectl set-hostname fancai-staging
```

**1.2. Установка Docker и Docker Compose**
```bash
# Установка Docker (официальный метод)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Установка Docker Compose plugin
apt install docker-compose-plugin -y

# Проверка установки
docker --version
docker compose version

# Включить Docker autostart
systemctl enable docker
systemctl start docker
```

**1.3. Настройка Firewall (UFW)**
```bash
# Базовые правила
ufw default deny incoming
ufw default allow outgoing

# Разрешить SSH (ВАЖНО!)
ufw allow 22/tcp comment 'SSH'

# Разрешить HTTP/HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Включить firewall
ufw --force enable

# Проверка
ufw status verbose
```

**1.4. Настройка Swap (для 4GB RAM)**
```bash
# Создать 2GB swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Добавить в fstab для persistence
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Проверка
free -h
swapon --show
```

**1.5. Создание non-root пользователя (best practice)**
```bash
# Создать deployer пользователя
useradd -m -s /bin/bash deployer
usermod -aG sudo deployer
usermod -aG docker deployer

# Скопировать SSH ключи
mkdir -p /home/deployer/.ssh
cp ~/.ssh/authorized_keys /home/deployer/.ssh/
chown -R deployer:deployer /home/deployer/.ssh
chmod 700 /home/deployer/.ssh
chmod 600 /home/deployer/.ssh/authorized_keys

# Тест (из локальной машины)
ssh deployer@88.210.35.41 'echo "✅ Deployer user OK"'
```

---

### Фаза 2: Клонирование и Конфигурация Проекта (15-20 минут)

**2.1. Клонирование репозитория**
```bash
# Как deployer пользователь
su - deployer

# Создать директорию для приложения
sudo mkdir -p /opt/bookreader
sudo chown deployer:deployer /opt/bookreader
cd /opt/bookreader

# Клонировать репозиторий
git clone https://github.com/your-username/fancai-vibe-hackathon.git .

# Проверка
git branch
git log --oneline -5
```

**2.2. Настройка Environment Variables**
```bash
cd /opt/bookreader

# Скопировать staging template
cp .env.staging.example .env.staging

# ВАЖНО: Отредактировать .env.staging
vim .env.staging
```

**Обязательные переменные для заполнения:**
```bash
# ============================================
# DOMAIN CONFIGURATION
# ============================================
DOMAIN_NAME=fancai.ru
DOMAIN_URL=https://fancai.ru

# ============================================
# DATABASE CONFIGURATION
# ============================================
DB_NAME=bookreader
DB_USER=postgres
DB_PASSWORD=<СГЕНЕРИРОВАТЬ_СИЛЬНЫЙ_ПАРОЛЬ>  # Минимум 16 символов

# ============================================
# REDIS CONFIGURATION
# ============================================
REDIS_PASSWORD=<СГЕНЕРИРОВАТЬ_СИЛЬНЫЙ_ПАРОЛЬ>  # Минимум 16 символов

# ============================================
# SECURITY SECRETS
# ============================================
SECRET_KEY=<СГЕНЕРИРОВАТЬ_SECRET_KEY>  # 32+ символов
JWT_SECRET_KEY=<СГЕНЕРИРОВАТЬ_JWT_KEY>  # 32+ символов

# ============================================
# ADMIN USER (для первого запуска)
# ============================================
ADMIN_EMAIL=admin@fancai.ru
ADMIN_PASSWORD=<СГЕНЕРИРОВАТЬ_ADMIN_PASSWORD>  # Минимум 12 символов

# ============================================
# ENVIRONMENT
# ============================================
ENVIRONMENT=staging
DEBUG=false
LOG_LEVEL=info
```

**Генерация секретов:**
```bash
# SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# JWT_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# DB_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(24))"

# REDIS_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(24))"

# ADMIN_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(16))"
```

**2.3. Настройка DNS (КРИТИЧНО)**

**Проверить что DNS A-запись настроена:**
```bash
# Локально
dig +short fancai.ru
# Должен вернуть: 88.210.35.41

# Если не настроено - добавить A-запись в DNS provider:
# Type: A
# Name: @ (или fancai.ru)
# Value: 88.210.35.41
# TTL: 300 (5 минут для быстрого обновления)

# Ждать propagation (5-30 минут)
```

---

### Фаза 3: SSL Сертификаты (10-15 минут)

**3.1. Настройка Let's Encrypt**

```bash
cd /opt/bookreader

# ВАЖНО: Убедиться что DNS настроен и отвечает!
dig +short fancai.ru  # Должен вернуть 88.210.35.41

# Создать директории для SSL
mkdir -p nginx/ssl

# Инициализация Certbot (получение первого сертификата)
docker compose -f docker-compose.ssl.yml --profile ssl-init run --rm certbot

# Certbot спросит:
# 1. Email: ваш email для уведомлений
# 2. Agree to ToS: Yes
# 3. Domain: fancai.ru

# Если успешно - сертификаты будут в nginx/ssl/
ls -la nginx/ssl/
# Должно быть: fullchain.pem, privkey.pem

# Запустить auto-renewal (обновление каждые 12 часов)
docker compose -f docker-compose.ssl.yml --profile ssl-renew up -d

# Проверка
docker compose -f docker-compose.ssl.yml ps
```

**3.2. Альтернатива: Self-Signed сертификат (для тестирования)**

Если DNS еще не настроен или нужно быстро протестировать:

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=fancai.ru"

# ВНИМАНИЕ: Браузеры будут показывать предупреждение о безопасности
```

---

### Фаза 4: Deployment (20-30 минут)

**4.1. Pre-deployment Checks**

```bash
cd /opt/bookreader

# Проверка docker-compose конфигурации
docker compose -f docker-compose.staging.yml config

# Проверка доступности портов
netstat -tuln | grep -E ':(80|443|5432|6379|5173)'
# Должно быть пусто (порты свободны)

# Проверка доступной памяти
free -h
# Должно быть ~3.5GB свободно

# Проверка disk space
df -h /
# Должно быть >50GB свободно
```

**4.2. Pull/Build Docker Images**

```bash
# Загрузить base images
docker compose -f docker-compose.staging.yml pull postgres redis

# Build custom images (backend, frontend)
docker compose -f docker-compose.staging.yml build --no-cache

# Проверка images
docker images | grep bookreader
```

**4.3. Запуск Сервисов**

```bash
# Запустить все сервисы
docker compose -f docker-compose.staging.yml up -d

# Проверка статуса
docker compose -f docker-compose.staging.yml ps

# Все сервисы должны быть в состоянии "Up" или "healthy"
# Ждать 30-60 секунд для полного запуска

# Проверка логов
docker compose -f docker-compose.staging.yml logs --tail=50
```

**4.4. Database Initialization**

```bash
# Ждать пока PostgreSQL будет ready
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from app.core.database import engine; engine.connect()" || sleep 10

# Выполнить миграции
docker compose -f docker-compose.staging.yml exec backend \
  alembic upgrade head

# Проверка текущей миграции
docker compose -f docker-compose.staging.yml exec backend \
  alembic current

# Verify database configuration
./scripts/verify-database-config.sh

# Создать admin пользователя
docker compose -f docker-compose.staging.yml exec backend \
  python -c "
from app.models.user import User
from app.core.database import SessionLocal
from passlib.context import CryptContext
import os

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
db = SessionLocal()

admin = User(
    email=os.getenv('ADMIN_EMAIL', 'admin@fancai.ru'),
    username='admin',
    hashed_password=pwd_context.hash(os.getenv('ADMIN_PASSWORD')),
    is_active=True,
    is_superuser=True
)
db.add(admin)
db.commit()
print(f'✅ Admin user created: {admin.email}')
"
```

**4.5. Verification**

```bash
# Проверка resource usage (должно быть <3.5GB)
docker stats --no-stream

# Проверка health endpoints
curl -f http://localhost:8000/health || echo "❌ Backend не отвечает"
curl -f http://localhost:80/health || echo "❌ Frontend не отвечает"

# Проверка через внешний IP
curl -f http://88.210.35.41/health || echo "❌ Публичный доступ не работает"

# Если DNS настроен
curl -f https://fancai.ru/health || echo "❌ HTTPS не работает"

# Проверка NLP models загружены
docker compose -f docker-compose.staging.yml exec backend \
  python -c "
import spacy
import stanza

spacy.load('ru_core_news_lg')
print('✅ SpaCy model loaded')

# Stanza проверка (может занять время при первом запуске)
# stanza.download('ru', verbose=False)
print('✅ NLP models OK')
"
```

---

### Фаза 5: Post-Deployment Configuration (15-20 минут)

**5.1. Настройка Automated Backups**

```bash
cd /opt/bookreader

# Сделать scripts исполняемыми
chmod +x scripts/backup-database.sh
chmod +x scripts/verify-database-config.sh

# Тестовый backup
./scripts/backup-database.sh

# Проверка backup создан
ls -lh /backups/postgresql/

# Добавить в crontab (ежедневно в 2 AM)
crontab -e
# Добавить строку:
0 2 * * * cd /opt/bookreader && ./scripts/backup-database.sh >> /var/log/bookreader-backup.log 2>&1
```

**5.2. Настройка Log Rotation**

```bash
# Log rotation уже настроен в docker-compose.staging.yml (logrotate сервис)
# Проверка что работает
docker compose -f docker-compose.staging.yml ps logrotate

# Логи будут ротироваться автоматически:
# - Backend: daily, 14 days retention
# - Celery: daily, 10 days retention
# - Nginx: daily, 30 days retention
# - PostgreSQL: weekly, 4 weeks retention
```

**5.3. Monitoring Setup (Optional)**

```bash
# Если нужен monitoring (adds ~300MB RAM usage)
docker compose -f docker-compose.monitoring.yml up -d

# Доступ к Grafana: http://fancai.ru:3001
# Default credentials: admin/admin (сменить при первом входе!)

# Prometheus: http://fancai.ru:9090
# cAdvisor: http://fancai.ru:8080
```

**5.4. Security Hardening**

```bash
# Отключить root SSH login (после проверки deployer работает)
vim /etc/ssh/sshd_config
# Изменить:
# PermitRootLogin no
# PasswordAuthentication no
systemctl restart sshd

# Настроить fail2ban (защита от brute-force)
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Автоматические security updates
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 🚀 Deployment Scripts (Полуавтоматический)

### Script 1: Server Preparation

**Файл:** `scripts/prepare-server.sh` (создать на локальной машине)

```bash
#!/bin/bash
set -e

SERVER_IP="88.210.35.41"
SERVER_USER="root"  # Или deployer после создания

echo "🚀 Preparing server for deployment..."

# 1. Update system
ssh $SERVER_USER@$SERVER_IP 'apt update && apt upgrade -y'

# 2. Install Docker
ssh $SERVER_USER@$SERVER_IP 'curl -fsSL https://get.docker.com | sh'
ssh $SERVER_USER@$SERVER_IP 'apt install -y docker-compose-plugin'

# 3. Setup firewall
ssh $SERVER_USER@$SERVER_IP '
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
'

# 4. Setup swap
ssh $SERVER_USER@$SERVER_IP '
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
'

# 5. Create deployer user
ssh $SERVER_USER@$SERVER_IP '
  useradd -m -s /bin/bash deployer
  usermod -aG sudo,docker deployer
  mkdir -p /home/deployer/.ssh
  cp ~/.ssh/authorized_keys /home/deployer/.ssh/
  chown -R deployer:deployer /home/deployer/.ssh
  chmod 700 /home/deployer/.ssh
  chmod 600 /home/deployer/.ssh/authorized_keys
'

echo "✅ Server preparation complete!"
```

### Script 2: Deploy Application

**Файл:** `scripts/deploy-staging.sh` (на сервере)

```bash
#!/bin/bash
set -e

APP_DIR="/opt/bookreader"
COMPOSE_FILE="docker-compose.staging.yml"

cd $APP_DIR

echo "🚀 Starting deployment..."

# 1. Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# 2. Backup database (если есть данные)
if docker compose -f $COMPOSE_FILE ps postgres | grep -q Up; then
  echo "💾 Creating database backup..."
  ./scripts/backup-database.sh
fi

# 3. Pull new images
echo "🐳 Pulling Docker images..."
docker compose -f $COMPOSE_FILE pull

# 4. Rebuild custom images
echo "🔨 Building custom images..."
docker compose -f $COMPOSE_FILE build

# 5. Stop services (graceful)
echo "⏸️  Stopping services..."
docker compose -f $COMPOSE_FILE down --timeout 30

# 6. Start services
echo "▶️  Starting services..."
docker compose -f $COMPOSE_FILE up -d

# 7. Wait for services
echo "⏳ Waiting for services to be healthy..."
sleep 30

# 8. Run migrations
echo "🗄️  Running database migrations..."
docker compose -f $COMPOSE_FILE exec -T backend alembic upgrade head

# 9. Verify deployment
echo "✅ Verifying deployment..."
./scripts/verify-database-config.sh

# 10. Check resource usage
echo "📊 Resource usage:"
docker stats --no-stream

# 11. Health checks
echo "🏥 Health checks:"
curl -f http://localhost:8000/health && echo "✅ Backend OK" || echo "❌ Backend FAIL"
curl -f http://localhost:80/health && echo "✅ Frontend OK" || echo "❌ Frontend FAIL"

echo "✅ Deployment complete!"
echo "📝 Check logs: docker compose -f $COMPOSE_FILE logs -f"
```

---

## 📊 Post-Deployment Checklist

### Immediate Verification (First 30 minutes)

- [ ] All Docker containers running (`docker compose ps`)
- [ ] Memory usage <3.5GB (`docker stats`)
- [ ] Disk space >50GB free (`df -h`)
- [ ] Health endpoints responding
  - [ ] Backend: `curl https://fancai.ru/api/health`
  - [ ] Frontend: `curl https://fancai.ru/health`
- [ ] Database migrations complete (`alembic current`)
- [ ] Admin user created (test login via frontend)
- [ ] SSL certificate valid (check in browser, no warnings)
- [ ] NLP models loaded (check backend logs)

### Day 1 Tasks

- [ ] Monitor resource usage trends
  - PostgreSQL memory: target ~600MB
  - Redis memory: target ~300MB
  - Backend memory: target ~1.2GB
  - Celery memory: target ~800MB
- [ ] Test critical user flows:
  - [ ] User registration
  - [ ] User login
  - [ ] Book upload (EPUB)
  - [ ] Book reading interface
  - [ ] NLP processing (if enabled)
- [ ] Check logs for errors
  - Backend: `docker compose logs backend --tail=100`
  - Frontend: `docker compose logs frontend --tail=100`
  - PostgreSQL: `docker compose logs postgres --tail=100`
- [ ] Setup monitoring alerts (if using Grafana)
- [ ] Document any issues or manual fixes needed

### Week 1 Tasks

- [ ] Review backup schedule working
  - Check `/backups/postgresql/` for daily backups
  - Test restore procedure
- [ ] Optimize based on actual usage
  - Slow queries: `SELECT * FROM get_slow_queries(10)`
  - Connection count: `SELECT * FROM get_active_connections()`
  - Cache hit ratio: Check PostgreSQL stats
- [ ] Security review
  - Disable root SSH if deployer works
  - Review firewall rules
  - Check fail2ban logs
  - Rotate any default passwords
- [ ] Performance baseline
  - Document current response times
  - Document current resource usage
  - Setup alerts for anomalies

---

## 🆘 Troubleshooting

### Issue: Docker containers не запускаются

```bash
# Проверка логов
docker compose -f docker-compose.staging.yml logs

# Проверка памяти
free -h
docker stats

# Очистка если нужно
docker system prune -af --volumes
```

### Issue: Out of Memory

```bash
# Проверка memory usage
docker stats
free -h

# Уменьшить workers если нужно
vim .env.staging
# WORKERS_COUNT=3 (вместо 4)
# CELERY_CONCURRENCY=1

# Restart
docker compose -f docker-compose.staging.yml restart
```

### Issue: SSL сертификат не работает

```bash
# Проверка DNS
dig +short fancai.ru

# Повторить certbot
docker compose -f docker-compose.ssl.yml --profile ssl-init run --rm certbot --force-renewal

# Проверка файлов
ls -la nginx/ssl/
```

### Issue: Database connection errors

```bash
# Проверка PostgreSQL
docker compose -f docker-compose.staging.yml ps postgres
docker compose -f docker-compose.staging.yml logs postgres --tail=50

# Restart database
docker compose -f docker-compose.staging.yml restart postgres

# Проверка connections
docker exec bookreader_postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## 📝 Next Steps

1. **После успешного deployment:**
   - Настроить GitHub Actions для automated deployments
   - Добавить staging в CI/CD pipeline
   - Настроить Slack/Email notifications для alerts

2. **Optimization:**
   - Monitor и tune based на actual usage
   - Optimize slow queries
   - Adjust worker counts if needed

3. **Documentation:**
   - Document любые custom configurations
   - Create runbooks для common operations
   - Update team on deployment procedures

---

**Готово к запуску!** Следуйте фазам последовательно, начиная с настройки SSH доступа.
