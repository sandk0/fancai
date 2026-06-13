# Production Deployment на fancai.ru - Руководство

**Версия документа:** 1.0
**Последнее обновление:** 16 ноября 2025
**Статус:** ✅ Актуально

---

## 📋 Содержание

1. [Обзор](#обзор)
2. [Требования к серверу](#требования-к-серверу)
3. [Предварительная подготовка](#предварительная-подготовка)
4. [Процесс развёртывания](#процесс-развёртывания)
5. [Конфигурация компонентов](#конфигурация-компонентов)
6. [Управление сервисами](#управление-сервисами)
7. [Мониторинг и логи](#мониторинг-и-логи)
8. [Backup и восстановление](#backup-и-восстановление)
9. [Troubleshooting](#troubleshooting)
10. [Безопасность](#безопасность)

---

## Обзор

### Архитектура deployment

BookReader AI развёрнут на сервере fancai.ru (88.210.35.41) используя Docker Compose с 7 основными сервисами:

```
┌─────────────────────────────────────────┐
│  Internet (HTTPS:443 / HTTP:80)         │
└──────────────┬──────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Nginx (SSL Term)    │
    │  - Reverse Proxy     │
    │  - Static Files      │
    └──┬────────────────┬──┘
       │                │
       ▼                ▼
  ┌─────────┐    ┌──────────┐
  │ Backend │    │ Frontend │
  │ :8000   │    │ :3000    │
  └────┬────┘    └──────────┘
       │
  ┌────┴─────────┬───────┬─────────┐
  ▼              ▼       ▼         ▼
PostgreSQL    Redis   Celery    Celery
:5432         :6379   Worker     Beat
```

### Технологический стек

| Компонент | Технология | Версия |
|-----------|------------|--------|
| OS | Ubuntu/Debian | Latest |
| Container Runtime | Docker | 24.x+ |
| Orchestration | Docker Compose | 2.40+ |
| Reverse Proxy | Nginx | 1.25 Alpine |
| Backend | FastAPI + Python | 3.11 |
| Frontend | React + Vite | Node 20 |
| Database | PostgreSQL | 15.7 Alpine |
| Cache | Redis | 7.4 Alpine |
| Queue | Celery | 5.3.4 |
| SSL | Let's Encrypt | - |

### Режимы deployment

В настоящее время поддерживаются 3 режима:

1. **Development (Local)** - `docker-compose.yml`
2. **Development с SSL** - `docker-compose.dev-ssl.yml` ⭐ (текущий на fancai.ru)
3. **Production** - `docker-compose.prod.yml` (планируется)

---

## Требования к серверу

### Минимальные требования

- **CPU:** 2 cores
- **RAM:** 4GB
- **Disk:** 20GB SSD
- **OS:** Ubuntu 20.04+ / Debian 11+
- **Network:** Публичный IP с открытыми портами 80, 443

### Рекомендуемые требования

- **CPU:** 4 cores
- **RAM:** 8GB
- **Disk:** 50GB SSD (для books storage)
- **Network:** 100 Mbps

### Программное обеспечение

Должно быть установлено:

```bash
# Docker
docker --version
# Docker version 24.0.0+

# Docker Compose
docker compose version
# Docker Compose version v2.40.0+

# Git
git --version
# git version 2.30.0+

# SSL (optional, если используется Docker-based certbot)
certbot --version
# certbot 1.21.0+
```

### Настройка DNS

DNS A-record должен указывать на IP сервера:

```
fancai.ru        A    88.210.35.41
www.fancai.ru    A    88.210.35.41
```

Проверка:
```bash
dig fancai.ru +short
# 88.210.35.41
```

---

## Предварительная подготовка

### 1. Установка Docker

```bash
# Обновление пакетов
sudo apt update && sudo apt upgrade -y

# Установка зависимостей
sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release

# Добавление Docker GPG ключа
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Добавление репозитория
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Установка Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Добавление текущего пользователя в группу docker
sudo usermod -aG docker $USER
newgrp docker

# Проверка установки
docker --version
docker compose version
```

### 2. Клонирование репозитория

```bash
# Создание директории
sudo mkdir -p /opt/bookreader
sudo chown $USER:$USER /opt/bookreader

# Клонирование
cd /opt
git clone https://github.com/sandk0/fancai-vibe-hackathon.git bookreader
cd bookreader

# Проверка ветки
git branch
# * main
```

### 3. Создание .env файла

```bash
cd /opt/bookreader

# Создание .env.development
cat > .env.development << 'EOF'
# ============================================================================
# Database Configuration
# ============================================================================
DB_NAME=bookreader_dev
DB_USER=postgres
DB_PASSWORD=CHANGE_ME_SECURE_PASSWORD_HERE

# ============================================================================
# Redis Configuration
# ============================================================================
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD_HERE

# ============================================================================
# Security
# ============================================================================
# Generate with: openssl rand -hex 32
SECRET_KEY=CHANGE_ME_64_CHARACTER_HEX_STRING_HERE

# ============================================================================
# Domain Configuration
# ============================================================================
DOMAIN_NAME=fancai.ru

# ============================================================================
# Application Mode
# ============================================================================
DEBUG=true
ENVIRONMENT=development

# ============================================================================
# Optional Services
# ============================================================================
# Sentry error tracking (optional in development)
SENTRY_DSN=https://fake@fake.ingest.sentry.io/0

# Email service (optional)
SMTP_PASSWORD=

# Image generation services (optional)
OPENAI_API_KEY=
MIDJOURNEY_API_KEY=

# Payment systems (optional)
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
CLOUDPAYMENTS_PUBLIC_ID=

# ============================================================================
# NLP Configuration
# ============================================================================
POLLINATIONS_ENABLED=true

# ============================================================================
# Celery Configuration
# ============================================================================
CELERY_CONCURRENCY=2
CELERY_MAX_TASKS_PER_CHILD=10
CELERY_WORKER_MAX_MEMORY_PER_CHILD=500000
EOF

# Установка прав доступа
chmod 600 .env.development
```

**⚠️ ВАЖНО:** Замените все `CHANGE_ME_*` значения на реальные secure пароли!

**Генерация паролей:**

```bash
# SECRET_KEY (64 символа hex)
openssl rand -hex 32

# Случайный пароль (32 символа)
openssl rand -base64 32

# Или используйте password manager
```

### 4. Проверка конфигурации

```bash
# Проверка синтаксиса docker-compose
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml config > /dev/null && echo "✅ Config OK" || echo "❌ Config ERROR"

# Проверка переменных окружения
grep -v '^#' .env.development | grep -v '^$'

# Убедиться что нет CHANGE_ME
grep "CHANGE_ME" .env.development && echo "⚠️ Не забудьте изменить пароли!" || echo "✅ Пароли изменены"
```

---

## Процесс развёртывания

### Шаг 1: Получение SSL сертификата

#### 1.1. Запуск временного HTTP сервера

```bash
cd /opt/bookreader

# Создать temp конфигурацию для ACME challenge
cat > docker-compose.temp-ssl.yml << 'EOF'
services:
  nginx-temp:
    image: nginx:1.25-alpine
    container_name: bookreader_nginx_temp
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.http-only.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certbot-www:/var/www/certbot:ro
    networks:
      - bookreader-network

networks:
  bookreader-network:
    driver: bridge
EOF

# Запустить
docker compose -f docker-compose.temp-ssl.yml up -d

# Проверить
curl -I http://fancai.ru/.well-known/acme-challenge/test
# HTTP/1.1 404 Not Found (это нормально - файла test не существует)
```

#### 1.2. Получение staging сертификата (тест)

```bash
# Создать директории
mkdir -p nginx/ssl nginx/certbot-www

# Получить staging сертификат для тестирования
docker run --rm \
  -v $(pwd)/nginx/ssl:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot-www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email YOUR_EMAIL@example.com \
  --agree-tos \
  --no-eff-email \
  --staging \
  -d fancai.ru

# Проверить получение
ls -la nginx/ssl/live/fancai.ru/
# fullchain.pem, privkey.pem должны существовать
```

#### 1.3. Получение production сертификата

```bash
# Удалить staging сертификат
rm -rf nginx/ssl/*

# Получить production сертификат
docker run --rm \
  -v $(pwd)/nginx/ssl:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot-www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email YOUR_EMAIL@example.com \
  --agree-tos \
  --no-eff-email \
  -d fancai.ru

# Копировать сертификаты в nginx директорию
cp -L nginx/ssl/live/fancai.ru/fullchain.pem nginx/ssl/
cp -L nginx/ssl/live/fancai.ru/privkey.pem nginx/ssl/

# Проверить
ls -lh nginx/ssl/*.pem
# fullchain.pem (~4KB)
# privkey.pem (~2KB)

# Установить права
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem
```

#### 1.4. Остановить временный nginx

```bash
docker compose -f docker-compose.temp-ssl.yml down
rm docker-compose.temp-ssl.yml
```

### Шаг 2: Запуск основных сервисов

```bash
cd /opt/bookreader

# Сборка образов (первый раз может занять 5-10 минут)
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml build

# Запуск всех сервисов
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml up -d

# Проверка статуса
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml ps
```

**Ожидаемый вывод:**

```
NAME                  STATUS
backend               Up (starting)
frontend              Up (starting)
nginx                 Up (starting)
postgres              Up (healthy)
redis                 Up (healthy)
celery-worker         Up (starting)
celery-beat           Up (starting)
```

Подождите 1-2 минуты пока все сервисы инициализируются.

### Шаг 3: Применение database migrations

```bash
# Применить миграции Alembic
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml \
  exec backend alembic upgrade head

# Ожидаемый вывод:
# INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
# INFO  [alembic.runtime.migration] Will assume transactional DDL.

# Проверить текущую версию
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml \
  exec backend alembic current

# Проверить список таблиц
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml \
  exec postgres psql -U postgres -d bookreader_dev -c "\dt"
```

### Шаг 4: Проверка здоровья сервисов

```bash
# Проверить все сервисы
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml ps

# Все должны быть (healthy)

# Проверить логи
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml logs --tail=50

# Проверить health endpoint
curl https://fancai.ru/api/v1/health
# {"status":"healthy","version":"0.1.0","database":"connected","redis":"connected"}

# Проверить frontend
curl -I https://fancai.ru/
# HTTP/2 200
```

### Шаг 5: Создание первого пользователя

```bash
# Через API
curl -X POST https://fancai.ru/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!",
    "full_name": "Admin User"
  }'

# Ожидаемый ответ:
# {
#   "user": { ... },
#   "access_token": "eyJhbG...",
#   "token_type": "bearer"
# }
```

### Шаг 6: Финальная проверка

```bash
# 1. Проверить SSL
openssl s_client -connect fancai.ru:443 -servername fancai.ru < /dev/null | grep "Verify return code"
# Verify return code: 0 (ok)

# 2. Проверить редирект HTTP → HTTPS
curl -I http://fancai.ru
# HTTP/1.1 301 Moved Permanently
# Location: https://fancai.ru/

# 3. Проверить healthcheck всех сервисов
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml ps | grep -c "healthy"
# 7 (все сервисы healthy)

# 4. Проверить логи на ошибки
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml logs | grep -i error | tail -20
# Не должно быть критичных ошибок
```

**✅ Deployment завершён успешно!**

---

## Конфигурация компонентов

### Nginx Configuration

**Файл:** `nginx/nginx.dev-ssl.conf`

#### HTTP Server (Port 80)

```nginx
server {
    listen 80;
    server_name _;

    # Health check (для Docker healthcheck)
    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect всего остального на HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}
```

#### HTTPS Server (Port 443)

```nginx
server {
    listen 443 ssl http2;
    server_name _;

    # SSL сертификаты
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Backend API
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }

    # WebSocket
    location /ws {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Static files
    location /storage/ {
        alias /var/www/storage/;
        expires 1d;
        add_header Cache-Control "public";
    }

    # Frontend (Vite dev server)
    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Vite HMR support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

### Backend Configuration

**Environment Variables:**

```bash
# Database
DATABASE_URL=postgresql+asyncpg://postgres:password@postgres:5432/bookreader_dev

# Redis
REDIS_URL=redis://:password@redis:6379

# Security
SECRET_KEY=64_character_hex_string

# Mode
ENVIRONMENT=development
DEBUG=true

# NLP
NLTK_DATA=/root/nltk_data
STANZA_RESOURCES_DIR=/root/stanza_resources
POLLINATIONS_ENABLED=true

# Celery
CELERY_CONCURRENCY=2
```

**Command:**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Configuration

**Environment Variables:**

```bash
# API endpoints
VITE_API_URL=https://fancai.ru/api/v1
VITE_WS_URL=wss://fancai.ru/ws
NODE_ENV=development
```

**Command:**
```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

**Vite Config (`vite.config.ts`):**

```typescript
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'fancai.ru',
      'www.fancai.ru',
      '.fancai.ru',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
```

### PostgreSQL Configuration

```yaml
postgres:
  image: postgres:15.7-alpine
  environment:
    POSTGRES_DB: bookreader_dev
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_INITDB_ARGS: --encoding=UTF8 --locale=C
  volumes:
    - postgres_data:/var/lib/postgresql/data
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 1G
```

### Redis Configuration

```yaml
redis:
  image: redis:7.4-alpine
  command: >
    redis-server
    --appendonly yes
    --requirepass ${REDIS_PASSWORD}
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
  volumes:
    - redis_data:/data
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M
```

### Celery Worker Configuration

```yaml
celery-worker:
  build: ./backend
  environment:
    - DATABASE_URL=...
    - REDIS_URL=...
    - CELERY_CONCURRENCY=2
    - CELERY_MAX_TASKS_PER_CHILD=10
  command: >
    celery -A app.core.celery_app worker
    --loglevel=info
    --concurrency=2
    --max-tasks-per-child=10
  deploy:
    resources:
      limits:
        memory: 1.5G
```

### Celery Beat Configuration

```yaml
celery-beat:
  build: ./backend
  volumes:
    - ./backend:/app
    - beat_schedule:/tmp/celerybeat
  command: >
    celery -A app.core.celery_app beat
    --loglevel=info
    --schedule=/tmp/celerybeat/schedule.db
  deploy:
    resources:
      limits:
        memory: 512M
```

---

## Управление сервисами

### Базовые команды

```bash
# Установить переменную для краткости
export DC="docker compose --env-file .env.development -f docker-compose.dev-ssl.yml"

# Запуск всех сервисов
$DC up -d

# Остановка всех сервисов
$DC down

# Перезапуск конкретного сервиса
$DC restart backend

# Перезапуск всех сервисов
$DC restart

# Просмотр статуса
$DC ps

# Просмотр логов
$DC logs -f

# Логи конкретного сервиса
$DC logs -f backend

# Последние 100 строк логов
$DC logs --tail=100

# Выполнить команду в контейнере
$DC exec backend bash

# Просмотр ресурсов
docker stats
```

### Обновление кода

```bash
cd /opt/bookreader

# Остановить сервисы
$DC down

# Обновить код
git pull origin main

# Пересобрать образы (если изменились Dockerfile или зависимости)
$DC build

# Применить миграции
$DC up -d postgres redis
sleep 10
$DC exec backend alembic upgrade head

# Запустить все сервисы
$DC up -d

# Проверить статус
$DC ps
$DC logs --tail=50
```

### Масштабирование

```bash
# Увеличить количество Celery workers
$DC up -d --scale celery-worker=3

# Проверить
$DC ps | grep celery-worker
# bookreader-celery-worker-1
# bookreader-celery-worker-2
# bookreader-celery-worker-3
```

### Очистка и обслуживание

```bash
# Очистить неиспользуемые образы
docker image prune -a -f

# Очистить неиспользуемые volumes
docker volume prune -f

# Очистить всё неиспользуемое
docker system prune -a --volumes -f

# Освободить место (будьте осторожны!)
# Это удалит все volumes, включая данные БД!
$DC down -v
```

---

## Мониторинг и логи

### Проверка здоровья

#### Healthcheck через Docker

```bash
# Проверить все healthcheck'и
$DC ps | grep healthy

# Должно быть:
# backend               Up (healthy)
# frontend              Up (healthy)
# nginx                 Up (healthy)
# postgres              Up (healthy)
# redis                 Up (healthy)
# celery-worker         Up (healthy)
# celery-beat           Up (healthy)
```

#### Healthcheck через API

```bash
# Backend health
curl https://fancai.ru/api/v1/health

# Ожидаемый ответ:
# {
#   "status": "healthy",
#   "version": "0.1.0",
#   "database": "connected",
#   "redis": "connected"
# }

# Nginx health
curl http://127.0.0.1/health
# OK
```

### Логи

#### Просмотр логов

```bash
# Все логи в реальном времени
$DC logs -f

# Только backend
$DC logs -f backend

# Последние 100 строк всех сервисов
$DC logs --tail=100

# Логи с временными метками
$DC logs -t backend

# Логи за последний час
$DC logs --since 1h backend

# Поиск ошибок
$DC logs | grep -i error

# Поиск конкретного запроса
$DC logs backend | grep "POST /api/v1/books/upload"
```

#### Сохранение логов

```bash
# Экспорт логов в файл
$DC logs > /var/log/bookreader/$(date +%Y%m%d-%H%M%S).log

# Автоматическая ротация (добавить в cron)
0 0 * * * cd /opt/bookreader && docker compose logs > /var/log/bookreader/$(date +\%Y\%m\%d).log && find /var/log/bookreader -mtime +7 -delete
```

### Метрики

#### Resource Usage

```bash
# Использование ресурсов всеми контейнерами
docker stats

# Конкретный контейнер
docker stats bookreader-backend-1

# Однократный вывод (не в реальном времени)
docker stats --no-stream
```

#### Database Statistics

```bash
# Размер базы данных
$DC exec postgres psql -U postgres -d bookreader_dev -c "\l+"

# Размер таблиц
$DC exec postgres psql -U postgres -d bookreader_dev -c "
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

# Количество записей
$DC exec postgres psql -U postgres -d bookreader_dev -c "
SELECT
  (SELECT count(*) FROM users) as users,
  (SELECT count(*) FROM books) as books,
  (SELECT count(*) FROM chapters) as chapters,
  (SELECT count(*) FROM descriptions) as descriptions;
"
```

#### Redis Statistics

```bash
# Информация о Redis
$DC exec redis redis-cli -a ${REDIS_PASSWORD} INFO

# Использование памяти
$DC exec redis redis-cli -a ${REDIS_PASSWORD} INFO memory

# Количество ключей
$DC exec redis redis-cli -a ${REDIS_PASSWORD} DBSIZE

# Список ключей (осторожно в production!)
$DC exec redis redis-cli -a ${REDIS_PASSWORD} KEYS '*'
```

#### Celery Statistics

```bash
# Статус workers
$DC exec celery-worker celery -A app.core.celery_app inspect active

# Зарегистрированные задачи
$DC exec celery-worker celery -A app.core.celery_app inspect registered

# Статистика
$DC exec celery-worker celery -A app.core.celery_app inspect stats
```

---

## Backup и восстановление

### Database Backup

#### Создание backup

```bash
# Ручной backup
$DC exec postgres pg_dump -U postgres bookreader_dev | \
  gzip > /opt/bookreader/backups/db_$(date +%Y%m%d_%H%M%S).sql.gz

# Проверить размер
ls -lh /opt/bookreader/backups/

# Автоматический backup (добавить в crontab)
0 2 * * * cd /opt/bookreader && docker compose exec -T postgres pg_dump -U postgres bookreader_dev | gzip > /opt/bookreader/backups/db_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz && find /opt/bookreader/backups -name "db_*.sql.gz" -mtime +30 -delete
```

#### Восстановление из backup

```bash
# Остановить backend и celery (чтобы не было активных подключений)
$DC stop backend celery-worker celery-beat

# Восстановить из backup
gunzip -c /opt/bookreader/backups/db_20251116_020000.sql.gz | \
  $DC exec -T postgres psql -U postgres -d bookreader_dev

# Запустить сервисы
$DC start backend celery-worker celery-beat
```

### Uploaded Books Backup

```bash
# Найти путь к volume
docker volume inspect bookreader_uploaded_books

# Результат: /var/lib/docker/volumes/bookreader_uploaded_books/_data

# Backup uploaded books
sudo tar -czf /opt/bookreader/backups/books_$(date +%Y%m%d).tar.gz \
  /var/lib/docker/volumes/bookreader_uploaded_books/_data/

# Восстановление
sudo tar -xzf /opt/bookreader/backups/books_20251116.tar.gz -C /
```

### Full System Backup

```bash
# Создать полный backup (DB + books + config)
#!/bin/bash
BACKUP_DIR="/opt/bookreader/backups/full_$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# Database
docker compose exec -T postgres pg_dump -U postgres bookreader_dev | \
  gzip > $BACKUP_DIR/database.sql.gz

# Uploaded books
sudo tar -czf $BACKUP_DIR/books.tar.gz \
  /var/lib/docker/volumes/bookreader_uploaded_books/_data/

# Configuration
cp -r /opt/bookreader/.env* $BACKUP_DIR/
cp -r /opt/bookreader/nginx $BACKUP_DIR/

# Docker compose files
cp /opt/bookreader/docker-compose*.yml $BACKUP_DIR/

echo "Backup completed: $BACKUP_DIR"
```

### Восстановление на новом сервере

```bash
# 1. Установить Docker, клонировать репозиторий
# (см. раздел "Предварительная подготовка")

# 2. Восстановить конфигурацию
cp backup/.env.development /opt/bookreader/
cp -r backup/nginx /opt/bookreader/

# 3. Запустить сервисы
cd /opt/bookreader
$DC up -d postgres redis
sleep 30

# 4. Восстановить базу данных
gunzip -c backup/database.sql.gz | \
  $DC exec -T postgres psql -U postgres -d bookreader_dev

# 5. Восстановить uploaded books
sudo tar -xzf backup/books.tar.gz -C /

# 6. Запустить все сервисы
$DC up -d

# 7. Проверить
$DC ps
curl https://fancai.ru/api/v1/health
```

---

## Troubleshooting

### Общие проблемы

#### Проблема: Container fails to start

**Симптомы:**
```bash
$DC ps
# backend    Restarting
```

**Решение:**
```bash
# 1. Проверить логи
$DC logs backend

# 2. Проверить healthcheck
docker inspect bookreader-backend-1 | jq '.[0].State.Health'

# 3. Проверить переменные окружения
$DC exec backend env | grep -E "(DATABASE_URL|REDIS_URL|SECRET_KEY)"

# 4. Попробовать запустить вручную
$DC run --rm backend bash
# Внутри контейнера:
python -c "from app.main import app; print('OK')"
```

#### Проблема: Database connection failed

**Симптомы:**
```
sqlalchemy.exc.OperationalError: could not connect to server
```

**Решение:**
```bash
# 1. Проверить что PostgreSQL запущен
$DC ps postgres
# postgres    Up (healthy)

# 2. Проверить подключение
$DC exec postgres psql -U postgres -c "SELECT 1"

# 3. Проверить DATABASE_URL
echo $DATABASE_URL
# должен быть вида: postgresql+asyncpg://postgres:password@postgres:5432/bookreader_dev

# 4. Проверить сеть
$DC exec backend ping postgres
```

#### Проблема: SSL certificate expired

**Симптомы:**
```
NET::ERR_CERT_DATE_INVALID
```

**Решение:**
```bash
# 1. Проверить срок действия
openssl x509 -in nginx/ssl/fullchain.pem -noout -dates

# 2. Обновить сертификат
docker run --rm \
  -v $(pwd)/nginx/ssl:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot-www:/var/www/certbot \
  certbot/certbot renew

# 3. Перезапустить nginx
$DC restart nginx
```

#### Проблема: High memory usage

**Симптомы:**
```bash
docker stats
# backend    1.8GB / 2GB    90%
```

**Решение:**
```bash
# 1. Проверить лимиты
docker inspect bookreader-backend-1 | jq '.[0].HostConfig.Memory'

# 2. Увеличить лимит в docker-compose.yml
# deploy:
#   resources:
#     limits:
#       memory: 3G

# 3. Перезапустить с новыми лимитами
$DC up -d --force-recreate backend

# 4. Проверить утечки памяти
$DC logs backend | grep -i "memory"
```

### Специфичные проблемы

#### Permission denied на /app/storage

**Решение:**
```bash
# Найти volume
docker volume inspect bookreader_uploaded_books

# Установить права
sudo chmod -R 777 /var/lib/docker/volumes/bookreader_uploaded_books/_data/

# Перезапустить backend
$DC restart backend
```

#### Celery worker не обрабатывает задачи

**Решение:**
```bash
# 1. Проверить очередь Redis
$DC exec redis redis-cli -a ${REDIS_PASSWORD} LLEN celery

# 2. Проверить что worker зарегистрирован
$DC exec celery-worker celery -A app.core.celery_app inspect active

# 3. Перезапустить worker
$DC restart celery-worker

# 4. Проверить логи
$DC logs celery-worker | tail -100
```

#### 502 Bad Gateway от nginx

**Решение:**
```bash
# 1. Проверить что backend работает
$DC ps backend
curl http://localhost:8000/health

# 2. Проверить nginx конфигурацию
$DC exec nginx nginx -t

# 3. Проверить логи nginx
$DC logs nginx | grep error

# 4. Перезапустить nginx
$DC restart nginx
```

---

## Безопасность

### SSL/TLS Configuration

#### Проверка SSL

```bash
# SSL Labs test (онлайн)
# https://www.ssllabs.com/ssltest/analyze.html?d=fancai.ru

# Локальная проверка
testssl.sh https://fancai.ru

# Или openssl
openssl s_client -connect fancai.ru:443 -servername fancai.ru
```

#### Обновление сертификатов

```bash
# Ручное обновление
docker run --rm \
  -v $(pwd)/nginx/ssl:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot-www:/var/www/certbot \
  certbot/certbot renew

# Автоматическое обновление (cron)
0 0 * * * docker run --rm -v /opt/bookreader/nginx/ssl:/etc/letsencrypt -v /opt/bookreader/nginx/certbot-www:/var/www/certbot certbot/certbot renew --quiet && docker compose -f /opt/bookreader/docker-compose.dev-ssl.yml restart nginx
```

### Firewall Configuration

```bash
# Установить UFW (если не установлен)
sudo apt install -y ufw

# Разрешить SSH (ВАЖНО! Иначе потеряете доступ)
sudo ufw allow 22/tcp

# Разрешить HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Включить firewall
sudo ufw enable

# Проверить статус
sudo ufw status
```

### Secrets Management

#### Rotation паролей

```bash
# 1. Сгенерировать новые пароли
NEW_DB_PASSWORD=$(openssl rand -base64 32)
NEW_REDIS_PASSWORD=$(openssl rand -base64 32)
NEW_SECRET_KEY=$(openssl rand -hex 32)

# 2. Обновить .env файл
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASSWORD/" .env.development
sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$NEW_REDIS_PASSWORD/" .env.development
sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$NEW_SECRET_KEY/" .env.development

# 3. Обновить пароль в PostgreSQL
$DC exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD '$NEW_DB_PASSWORD';"

# 4. Обновить пароль в Redis
$DC exec redis redis-cli CONFIG SET requirepass "$NEW_REDIS_PASSWORD"

# 5. Перезапустить все сервисы
$DC restart
```

### Security Headers

Проверить наличие security headers:

```bash
curl -I https://fancai.ru

# Должны быть:
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
# Content-Security-Policy: ...
```

### Rate Limiting

Backend уже имеет встроенный rate limiting (см. `app/middleware/rate_limit.py`).

Дополнительно можно настроить в nginx:

```nginx
# Добавить в nginx.conf
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        # ...
    }
}
```

---

## Приложения

### Полезные команды

```bash
# Alias для быстрого доступа (добавить в ~/.bashrc)
alias bookreader='cd /opt/bookreader && docker compose --env-file .env.development -f docker-compose.dev-ssl.yml'
alias br-logs='bookreader logs -f'
alias br-ps='bookreader ps'
alias br-restart='bookreader restart'

# Использование:
bookreader up -d
br-logs backend
br-ps
```

### Monitoring Scripts

```bash
# Скрипт проверки здоровья
cat > /opt/bookreader/scripts/health-check.sh << 'EOF'
#!/bin/bash

echo "🔍 BookReader Health Check"
echo "=========================="

# API Health
echo -n "API Health: "
if curl -sf https://fancai.ru/api/v1/health > /dev/null; then
  echo "✅ OK"
else
  echo "❌ FAILED"
fi

# SSL Certificate
echo -n "SSL Certificate: "
EXPIRY=$(openssl x509 -in /opt/bookreader/nginx/ssl/fullchain.pem -noout -enddate | cut -d= -f2)
echo "Valid until $EXPIRY"

# Docker Services
echo ""
echo "Docker Services:"
cd /opt/bookreader
docker compose --env-file .env.development -f docker-compose.dev-ssl.yml ps | grep -E "(Up|healthy)" | wc -l
echo "services healthy"

# Disk Space
echo ""
echo "Disk Usage:"
df -h /var/lib/docker | tail -1

echo ""
echo "=========================="
EOF

chmod +x /opt/bookreader/scripts/health-check.sh

# Запуск
/opt/bookreader/scripts/health-check.sh
```

---

## Changelog

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2025-11-16 | 1.0 | Первая версия документации |

---

**Поддержка:**
- GitHub Issues: https://github.com/sandk0/fancai-vibe-hackathon/issues
- Email: support@bookreader.ai
- Documentation: /docs/operations/deployment/

**Лицензия:** MIT
