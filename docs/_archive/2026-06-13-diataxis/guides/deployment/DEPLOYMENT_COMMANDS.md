# Deployment Commands - Пошаговые инструкции для Termius

**Дата:** 15 ноября 2025
**Сервер:** 88.210.35.41 (fancai.ru)
**Выполнять:** В Termius, подключившись как root

---

## 📋 Содержание

1. [Подготовка сервера](#шаг-1-подготовка-сервера)
2. [Установка Docker](#шаг-2-установка-docker)
3. [Базовая настройка](#шаг-3-базовая-настройка)
4. [Клонирование проекта](#шаг-4-клонирование-проекта)
5. [Настройка environment](#шаг-5-настройка-environment)
6. [SSL сертификаты](#шаг-6-ssl-сертификаты)
7. [Deployment приложения](#шаг-7-deployment-приложения)
8. [Инициализация БД](#шаг-8-инициализация-бд)
9. [Verification](#шаг-9-verification)
10. [Post-deployment](#шаг-10-post-deployment)

---

## Шаг 1: Подготовка сервера

### 1.1. Проверка текущего состояния

```bash
# Проверить OS и ресурсы
echo "=== System Info ==="
uname -a
cat /etc/os-release | grep PRETTY_NAME
echo ""
echo "=== Resources ==="
free -h
df -h /
echo ""
echo "=== Network ==="
hostname -I
```

**Ожидаемый результат:**
- Ubuntu 24.04
- RAM: ~4GB
- Disk: >50GB free

### 1.2. Обновление системы

```bash
# Обновить пакеты (займет 2-5 минут)
apt update && apt upgrade -y
```

### 1.3. Установка базовых утилит

```bash
apt install -y curl wget git vim htop net-tools ufw python3 python3-pip
```

---

## Шаг 2: Установка Docker

### 2.1. Установка Docker Engine

```bash
# Установить Docker (официальный метод)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Включить autostart
systemctl enable docker
systemctl start docker

# Проверка
docker --version
```

**Ожидаемый вывод:** `Docker version 24.x.x` или новее

### 2.2. Установка Docker Compose

```bash
# Установить Docker Compose plugin
apt install -y docker-compose-plugin

# Проверка
docker compose version
```

**Ожидаемый вывод:** `Docker Compose version v2.x.x` или новее

---

## Шаг 3: Базовая настройка

### 3.1. Настройка Firewall

```bash
# Настроить UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Включить (подтвердить 'y')
ufw --force enable

# Проверка
ufw status verbose
```

**Ожидаемый вывод:** Правила для портов 22, 80, 443

### 3.2. Создание Swap (для 4GB RAM)

```bash
# Проверить есть ли уже swap
swapon --show

# Если пусто - создать 2GB swap
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "✅ Swap created"
else
  echo "✅ Swap already exists"
fi

# Проверка
free -h
```

**Ожидаемый вывод:** Swap: 2.0Gi

### 3.3. Настройка timezone и hostname

```bash
# Установить timezone
timedatectl set-timezone Europe/Moscow

# Установить hostname
hostnamectl set-hostname fancai-staging

# Проверка
echo "Timezone: $(timedatectl | grep 'Time zone')"
echo "Hostname: $(hostname)"
```

### 3.4. Создание deployer пользователя

```bash
# Создать deployer user
useradd -m -s /bin/bash deployer
usermod -aG sudo,docker deployer

# Скопировать SSH ключи
mkdir -p /home/deployer/.ssh
cp /root/.ssh/authorized_keys /home/deployer/.ssh/ 2>/dev/null || true
chown -R deployer:deployer /home/deployer/.ssh
chmod 700 /home/deployer/.ssh
chmod 600 /home/deployer/.ssh/authorized_keys 2>/dev/null || true

# Разрешить sudo без пароля
echo "deployer ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deployer
chmod 440 /etc/sudoers.d/deployer

echo "✅ Deployer user created"
```

---

## Шаг 4: Клонирование проекта

### 4.1. Создание директории

```bash
# Создать директорию для приложения
mkdir -p /opt/bookreader
chown deployer:deployer /opt/bookreader
cd /opt/bookreader
```

### 4.2. Клонирование репозитория

```bash
# Клонировать репозиторий
git clone https://github.com/sandk0/fancai-vibe-hackathon.git .

# Проверка
ls -la
git branch
git log --oneline -5
```

**Ожидаемый вывод:** Файлы проекта (docker-compose.staging.yml, backend/, frontend/, etc.)

**Если репозиторий приватный:**
```bash
# Нужно настроить SSH ключ для GitHub или использовать Personal Access Token
# Вариант 1: HTTPS с токеном
git clone https://<TOKEN>@github.com/<USERNAME>/fancai-vibe-hackathon.git .

# Вариант 2: SSH (если ключ настроен)
git clone git@github.com:<USERNAME>/fancai-vibe-hackathon.git .
```

---

## Шаг 5: Настройка Environment

### 5.1. Копирование template

```bash
cd /opt/bookreader

# Скопировать staging template
cp .env.staging.example .env.staging
```

### 5.2. Генерация секретов

```bash
# Генерировать все секреты
echo "Сгенерированные секреты (СОХРАНИТЕ ИХ!):"
echo ""
echo "DB_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
echo "REDIS_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo "JWT_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo "ADMIN_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')"
echo ""
echo "СКОПИРУЙТЕ ЭТИ ЗНАЧЕНИЯ ПЕРЕД ПРОДОЛЖЕНИЕМ!"
```

**ВАЖНО:** Сохраните все сгенерированные пароли в безопасное место!

### 5.3. Редактирование .env.staging

```bash
# Открыть в редакторе
vim .env.staging
# ИЛИ
nano .env.staging
```

**Замените следующие значения на сгенерированные:**

```bash
# DOMAIN CONFIGURATION
DOMAIN_NAME=fancai.ru
DOMAIN_URL=https://fancai.ru

# DATABASE
DB_PASSWORD=<ВАШ_СГЕНЕРИРОВАННЫЙ_DB_PASSWORD>

# REDIS
REDIS_PASSWORD=<ВАШ_СГЕНЕРИРОВАННЫЙ_REDIS_PASSWORD>

# SECURITY
SECRET_KEY=<ВАШ_СГЕНЕРИРОВАННЫЙ_SECRET_KEY>
JWT_SECRET_KEY=<ВАШ_СГЕНЕРИРОВАННЫЙ_JWT_SECRET_KEY>

# ADMIN USER
ADMIN_EMAIL=admin@fancai.ru
ADMIN_PASSWORD=<ВАШ_СГЕНЕРИРОВАННЫЙ_ADMIN_PASSWORD>

# ENVIRONMENT
ENVIRONMENT=staging
DEBUG=false
LOG_LEVEL=info
```

**Сохранение:**
- В vim: нажмите `Esc`, затем `:wq`, затем `Enter`
- В nano: нажмите `Ctrl+X`, затем `Y`, затем `Enter`

### 5.4. Проверка конфигурации

```bash
# Проверить что файл создан
ls -la .env.staging

# Проверить критические переменные (без показа паролей)
echo "DOMAIN_NAME: $(grep '^DOMAIN_NAME=' .env.staging | cut -d= -f2)"
echo "DB_PASSWORD set: $(grep '^DB_PASSWORD=' .env.staging | grep -v 'CHANGE_THIS' && echo 'YES' || echo 'NO - CHANGE IT!')"
echo "REDIS_PASSWORD set: $(grep '^REDIS_PASSWORD=' .env.staging | grep -v 'CHANGE_THIS' && echo 'YES' || echo 'NO - CHANGE IT!')"
```

---

## Шаг 6: SSL Сертификаты

### 6.1. Проверка DNS

```bash
# КРИТИЧНО: Проверить что DNS настроен
dig +short fancai.ru

# Должен вернуть: 88.210.35.41
# Если нет - настройте DNS перед продолжением!
```

**Если DNS не настроен:**
1. Зайти в панель управления доменом
2. Добавить A-запись: `fancai.ru` → `88.210.35.41`
3. Ждать 5-30 минут
4. Повторить `dig +short fancai.ru`

### 6.2. Получение Let's Encrypt сертификата

**Выполнять ТОЛЬКО если DNS настроен и отвечает!**

```bash
cd /opt/bookreader

# Создать директорию для SSL
mkdir -p nginx/ssl

# Запустить Certbot
docker compose -f docker-compose.ssl.yml --profile ssl-init run --rm certbot
```

**Certbot спросит:**
1. **Email:** Введите ваш email (например: `admin@fancai.ru`)
2. **Terms of Service:** Нажмите `Y` (Yes)
3. **Share email with EFF:** Нажмите `N` (No) - опционально

**Ожидаемый вывод:**
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/fancai.ru/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/fancai.ru/privkey.pem
```

### 6.3. Проверка сертификатов

```bash
# Проверить что сертификаты созданы
ls -la nginx/ssl/

# Должны быть: fullchain.pem, privkey.pem
```

### 6.4. Запуск auto-renewal

```bash
# Запустить сервис для автоматического обновления (каждые 12 часов)
docker compose -f docker-compose.ssl.yml --profile ssl-renew up -d

# Проверка
docker compose -f docker-compose.ssl.yml ps
```

### 6.5. Альтернатива: Self-Signed сертификат (ДЛЯ ТЕСТИРОВАНИЯ)

**Использовать ТОЛЬКО если DNS не готов:**

```bash
cd /opt/bookreader
mkdir -p nginx/ssl

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=fancai.ru"

echo "⚠️ Self-signed сертификат создан"
echo "Браузеры будут показывать предупреждение!"
```

---

## Шаг 7: Deployment приложения

### 7.1. Pre-deployment проверки

```bash
cd /opt/bookreader

# Проверить docker-compose конфигурацию
docker compose -f docker-compose.staging.yml config > /dev/null && echo "✅ Config OK" || echo "❌ Config ERROR"

# Проверить свободные порты
netstat -tuln | grep -E ':(80|443|5432|6379)' && echo "⚠️ Ports in use!" || echo "✅ Ports free"

# Проверить память
free -h

# Проверить disk
df -h /
```

**Ожидаемый результат:**
- Config OK
- Ports free
- RAM: ~3.5GB available (4GB total + 2GB swap)
- Disk: >50GB free

### 7.2. Pull base images

```bash
cd /opt/bookreader

echo "📥 Pulling base images..."
docker compose -f docker-compose.staging.yml pull postgres redis

# Проверка
docker images | grep -E "(postgres|redis)"
```

### 7.3. Build custom images

```bash
echo "🔨 Building custom images (это займет 5-10 минут)..."

# Build backend и frontend
docker compose -f docker-compose.staging.yml build --no-cache

# Проверка
docker images | grep bookreader
```

**Ожидаемый вывод:** Images для bookreader-backend и bookreader-frontend

### 7.4. Запуск всех сервисов

```bash
echo "🚀 Starting all services..."

# Запустить в detached mode
docker compose -f docker-compose.staging.yml up -d

# Проверка статуса
docker compose -f docker-compose.staging.yml ps
```

**Ожидаемый вывод:**
```
NAME                    STATUS          PORTS
bookreader_postgres     Up (healthy)    5432/tcp
bookreader_redis        Up (healthy)    6379/tcp
bookreader_backend      Up (healthy)    0.0.0.0:8000->8000/tcp
bookreader_celery...    Up
bookreader_frontend     Up (healthy)    0.0.0.0:80->80/tcp
bookreader_nginx        Up              0.0.0.0:443->443/tcp
```

### 7.5. Ожидание полного запуска

```bash
echo "⏳ Waiting for services to be ready (60 seconds)..."
sleep 60

# Проверить логи
docker compose -f docker-compose.staging.yml logs --tail=30
```

---

## Шаг 8: Инициализация БД

### 8.1. Проверка подключения к PostgreSQL

```bash
cd /opt/bookreader

# Ждать пока PostgreSQL готов
docker compose -f docker-compose.staging.yml exec backend \
  python -c "from app.core.database import engine; engine.connect()" && echo "✅ DB connection OK" || sleep 10
```

### 8.2. Выполнение миграций

```bash
echo "🗄️ Running database migrations..."

docker compose -f docker-compose.staging.yml exec backend \
  alembic upgrade head

# Проверка текущей миграции
docker compose -f docker-compose.staging.yml exec backend \
  alembic current
```

**Ожидаемый вывод:** ID последней миграции (например: `e94cab18247f`)

### 8.3. Verify database configuration

```bash
cd /opt/bookreader
chmod +x scripts/verify-database-config.sh
./scripts/verify-database-config.sh
```

### 8.4. Создание admin пользователя

```bash
echo "👤 Creating admin user..."

docker compose -f docker-compose.staging.yml exec backend \
  python -c "
from app.models.user import User
from app.core.database import SessionLocal
from passlib.context import CryptContext
import os

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
db = SessionLocal()

try:
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
except Exception as e:
    print(f'ℹ️  Admin may already exist or error: {e}')
finally:
    db.close()
"
```

**Ожидаемый вывод:** `✅ Admin user created: admin@fancai.ru`

---

## Шаг 9: Verification

### 9.1. Проверка resource usage

```bash
echo "📊 Resource Usage:"
docker stats --no-stream

# Должно быть <3.5GB total
```

**Ожидаемый результат:**
- postgres: 400-600MB
- redis: 200-300MB
- backend: 800MB-1.2GB
- celery: 600-900MB
- frontend: 150-250MB
- nginx: 80-150MB
- **TOTAL: ~3.0-3.5GB** ✅

### 9.2. Health checks

```bash
echo "🏥 Health Checks:"

# Backend
curl -f http://localhost:8000/health && echo " ✅ Backend OK" || echo " ❌ Backend FAIL"

# Frontend
curl -f http://localhost:80/health && echo " ✅ Frontend OK" || echo " ❌ Frontend FAIL"

# Public HTTP
curl -f http://88.210.35.41/health && echo " ✅ Public HTTP OK" || echo " ❌ Public HTTP FAIL"

# HTTPS (если Let's Encrypt работает)
curl -f https://fancai.ru/health && echo " ✅ HTTPS OK" || echo " ❌ HTTPS FAIL (check DNS/SSL)"
```

### 9.3. NLP models проверка

```bash
echo "🧠 Checking NLP models..."

docker compose -f docker-compose.staging.yml exec backend \
  python -c "
import spacy
try:
    nlp = spacy.load('ru_core_news_lg')
    print('✅ SpaCy model loaded successfully')
except Exception as e:
    print(f'❌ SpaCy model error: {e}')
"
```

### 9.4. Проверка в браузере

Откройте в браузере:
- **HTTP:** http://88.210.35.41
- **HTTPS:** https://fancai.ru (если DNS настроен)

**Попробуйте залогиниться:**
- Email: `admin@fancai.ru` (или ваш ADMIN_EMAIL)
- Password: ваш ADMIN_PASSWORD из .env.staging

---

## Шаг 10: Post-Deployment

### 10.1. Настройка automated backups

```bash
cd /opt/bookreader

# Сделать backup script исполняемым
chmod +x scripts/backup-database.sh

# Тестовый backup
./scripts/backup-database.sh

# Проверка
ls -lh /backups/postgresql/
```

### 10.2. Добавить в crontab

```bash
# Открыть crontab
crontab -e

# Добавить эту строку (нажать 'i' для вставки в vim):
0 2 * * * cd /opt/bookreader && ./scripts/backup-database.sh >> /var/log/bookreader-backup.log 2>&1

# Сохранить и выйти:
# В vim: Esc, затем :wq, затем Enter
# В nano: Ctrl+X, затем Y, затем Enter

# Проверка
crontab -l
```

### 10.3. Security hardening (ОПЦИОНАЛЬНО)

**Выполнять ТОЛЬКО после проверки что deployer user работает!**

```bash
# Установить fail2ban
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Настроить автообновления
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

echo "✅ Security hardening complete"
```

### 10.4. Отключить root SSH (ОПЦИОНАЛЬНО, ОСТОРОЖНО!)

**ТОЛЬКО после проверки что deployer может подключаться по SSH!**

```bash
# Протестировать deployer SSH (из другой сессии)
# ssh deployer@88.210.35.41

# Если работает - отключить root login
vim /etc/ssh/sshd_config

# Найти и изменить:
# PermitRootLogin no
# PasswordAuthentication no

# Перезапустить SSH
systemctl restart sshd
```

---

## ✅ Deployment Complete!

### Финальная проверка:

```bash
echo "================================================"
echo "✅ DEPLOYMENT VERIFICATION"
echo "================================================"
echo ""
echo "1. Docker containers:"
docker compose -f /opt/bookreader/docker-compose.staging.yml ps
echo ""
echo "2. Resource usage:"
docker stats --no-stream
echo ""
echo "3. Disk space:"
df -h / | grep -v Filesystem
echo ""
echo "4. Services accessible:"
curl -s http://localhost:8000/health | jq '.' 2>/dev/null || curl -s http://localhost:8000/health
echo ""
echo "================================================"
echo "🎉 BookReader AI deployed successfully!"
echo "================================================"
echo ""
echo "Access your application:"
echo "  HTTP:  http://88.210.35.41"
echo "  HTTPS: https://fancai.ru"
echo ""
echo "Admin credentials:"
echo "  Email: admin@fancai.ru"
echo "  Password: (check .env.staging)"
echo ""
echo "================================================"
```

---

## 🔧 Полезные команды

### Просмотр логов

```bash
# Все сервисы
docker compose -f /opt/bookreader/docker-compose.staging.yml logs -f

# Конкретный сервис
docker compose -f /opt/bookreader/docker-compose.staging.yml logs -f backend
docker compose -f /opt/bookreader/docker-compose.staging.yml logs -f frontend
docker compose -f /opt/bookreader/docker-compose.staging.yml logs -f postgres
```

### Перезапуск сервисов

```bash
# Все сервисы
docker compose -f /opt/bookreader/docker-compose.staging.yml restart

# Конкретный сервис
docker compose -f /opt/bookreader/docker-compose.staging.yml restart backend
```

### Остановка/Запуск

```bash
# Остановить все
docker compose -f /opt/bookreader/docker-compose.staging.yml down

# Запустить все
docker compose -f /opt/bookreader/docker-compose.staging.yml up -d
```

### Мониторинг

```bash
# Resource usage (live)
watch docker stats

# Disk usage
watch df -h

# Container status
watch 'docker compose -f /opt/bookreader/docker-compose.staging.yml ps'
```

### Backup

```bash
# Manual backup
cd /opt/bookreader && ./scripts/backup-database.sh

# List backups
ls -lh /backups/postgresql/
```

---

## 🆘 Troubleshooting

### Проблема: Контейнер не запускается

```bash
# Проверить логи
docker compose -f /opt/bookreader/docker-compose.staging.yml logs <service>

# Проверить память
free -h

# Restart
docker compose -f /opt/bookreader/docker-compose.staging.yml restart <service>
```

### Проблема: Out of Memory

```bash
# Проверить usage
docker stats
free -h

# Если памяти мало - уменьшить workers
vim /opt/bookreader/.env.staging
# WORKERS_COUNT=3
# CELERY_CONCURRENCY=1

# Restart
docker compose -f /opt/bookreader/docker-compose.staging.yml restart
```

### Проблема: SSL не работает

```bash
# Проверить DNS
dig +short fancai.ru

# Проверить сертификаты
ls -la /opt/bookreader/nginx/ssl/

# Пересоздать сертификат
docker compose -f /opt/bookreader/docker-compose.ssl.yml --profile ssl-init run --rm certbot --force-renewal
```

### Проблема: Backend не отвечает

```bash
# Логи
docker compose -f /opt/bookreader/docker-compose.staging.yml logs backend --tail=100

# Restart
docker compose -f /opt/bookreader/docker-compose.staging.yml restart backend

# Проверка health
curl http://localhost:8000/health
```

---

## 📞 Поддержка

Если возникли проблемы - проверьте:
1. Логи: `docker compose logs`
2. Resource usage: `docker stats`
3. Disk space: `df -h`
4. Network: `netstat -tuln | grep -E ":(80|443|8000)"`

**Документация:**
- `STAGING_DEPLOYMENT_PLAN.md` - Полный план
- `PRODUCTION_DEPLOYMENT_READY_SUMMARY.md` - Итоговый отчет
- `docs/operations/deployment/` - Детальные guides

---

**Готово! Следуйте командам шаг за шагом.** 🚀
