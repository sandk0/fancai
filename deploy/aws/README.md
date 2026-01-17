# AWS Deployment Files for fancai

Готовые конфигурационные файлы для деплоя fancai на AWS.

## Структура файлов

```
deploy/aws/
├── README.md                           # Этот файл
├── docker-compose.single-ec2.tier1.yml # Вариант A: Single EC2 (Base)
├── docker-compose.single-ec2.tier2.yml # Вариант A: Single EC2 (Enhanced)
├── docker-compose.single-ec2.tier3.yml # Вариант A: Single EC2 (Pro)
├── docker-compose.ec2-rds.tier1.yml    # Вариант B: EC2 + RDS (Base) ⭐
├── docker-compose.ec2-rds.tier2.yml    # Вариант B: EC2 + RDS (Enhanced)
├── docker-compose.ec2-rds.tier3.yml    # Вариант B: EC2 + RDS (Pro)
├── docker-compose.lightsail.tier1.yml  # Вариант C: Lightsail (Base)
├── .env.tier1.example                  # Пример переменных окружения Tier 1
├── .env.tier2.example                  # Пример переменных окружения Tier 2
├── .env.tier3.example                  # Пример переменных окружения Tier 3
└── nginx/
    ├── nginx.conf                      # Nginx для Tier 1/2
    ├── nginx-tier3.conf                # Nginx с load balancing для Tier 3
    └── ssl/                            # SSL сертификаты (создать)
```

## Быстрый старт

### 1. Выберите вариант

| Бюджет | Рекомендация | Файл |
|--------|--------------|------|
| ~$37/мес | EC2 + RDS Tier 1 (Free Tier) | `docker-compose.ec2-rds.tier1.yml` |
| ~$85/мес | Single EC2 Tier 2 | `docker-compose.single-ec2.tier2.yml` |
| ~$115/мес | EC2 + RDS Tier 2 | `docker-compose.ec2-rds.tier2.yml` |
| ~$220/мес | EC2 + RDS Tier 3 | `docker-compose.ec2-rds.tier3.yml` |

### 2. Создайте .env файл

```bash
# Скопируйте пример
cp .env.tier1.example .env.tier1

# Отредактируйте с вашими значениями
nano .env.tier1
```

### 3. Запустите

```bash
# Сборка
docker-compose -f docker-compose.ec2-rds.tier1.yml build

# Миграции
docker-compose -f docker-compose.ec2-rds.tier1.yml run --rm backend alembic upgrade head

# Запуск
docker-compose -f docker-compose.ec2-rds.tier1.yml up -d

# Логи
docker-compose -f docker-compose.ec2-rds.tier1.yml logs -f
```

## Сравнение конфигураций

### Вариант A: Single EC2 (всё в Docker)

| Tier | EC2 | RAM | PostgreSQL | Redis | Стоимость |
|------|-----|-----|------------|-------|-----------|
| 1 | t3.small | 2 GB | Docker 512MB | Docker 300MB | ~$55 |
| 2 | t3.medium | 4 GB | Docker 1GB | Docker 600MB | ~$85 |
| 3 | t3.large | 8 GB | Docker 2GB | Docker 1.2GB | ~$140 |

**Плюсы:** Дешевле, проще настройка
**Минусы:** Нет автоматических backups DB

### Вариант B: EC2 + RDS (рекомендуется)

| Tier | EC2 | RDS | ElastiCache | Стоимость |
|------|-----|-----|-------------|-----------|
| 1 | t3.small (2GB) | db.t4g.micro (1GB)* | cache.t3.micro (0.5GB)* | ~$37* / $68 |
| 2 | t3.medium (4GB) | db.t4g.small (2GB) | cache.t3.small (1.5GB) | ~$136 |
| 3 | t3.large (8GB) | db.t4g.medium (4GB) | cache.t3.medium (3GB) | ~$279 |

*\* Free Tier eligible (первый год)*

**Плюсы:** Managed services, автоматические backups, легко масштабировать
**Минусы:** Дороже после Free Tier

### Вариант C: Lightsail

| Tier | Instance | Database | Стоимость |
|------|----------|----------|-----------|
| 1 | 2GB RAM | 1GB RAM | ~$37 |
| 2 | 4GB RAM | 2GB RAM | ~$70 |
| 3 | 8GB RAM | 4GB RAM | ~$145 |

**Плюсы:** Фиксированная цена, простой интерфейс
**Минусы:** Нет ElastiCache (Redis в Docker)

## Nginx конфигурация

### Tier 1/2: nginx.conf
- Single backend instance
- Rate limiting: 10 req/s API, 50 req/s static
- Gzip compression
- SSL/TLS 1.2+

### Tier 3: nginx-tier3.conf
- Load balancing между backend instances
- Повышенные лимиты: 50 req/s API, 200 req/s static
- Health checks и failover
- OCSP stapling

## SSL сертификаты

### Вариант 1: Let's Encrypt (бесплатно)

```bash
# На EC2
sudo certbot certonly --webroot -w /var/www/certbot -d fancai.ru -d www.fancai.ru

# Скопировать в deploy/aws/nginx/ssl/
sudo cp /etc/letsencrypt/live/fancai.ru/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/fancai.ru/privkey.pem nginx/ssl/
```

### Вариант 2: AWS ACM (для CloudFront)

Используйте ACM сертификат с CloudFront distribution.

## Обновление приложения

```bash
# Pull последние изменения
git pull origin main

# Пересборка и перезапуск
docker-compose -f docker-compose.ec2-rds.tier1.yml build
docker-compose -f docker-compose.ec2-rds.tier1.yml up -d

# Миграции (если есть)
docker-compose -f docker-compose.ec2-rds.tier1.yml run --rm backend alembic upgrade head
```

## Мониторинг

### Docker logs
```bash
docker-compose -f docker-compose.ec2-rds.tier1.yml logs -f backend
docker-compose -f docker-compose.ec2-rds.tier1.yml logs -f celery-worker
```

### Container stats
```bash
docker stats
```

### Health check
```bash
curl https://fancai.ru/health
```

## Troubleshooting

### Backend не стартует
```bash
# Проверить логи
docker-compose logs backend

# Проверить подключение к DB
docker-compose exec backend python -c "from app.core.database import engine; engine.connect()"
```

### Celery worker падает
```bash
# Проверить Redis
docker-compose exec backend redis-cli -h $REDIS_HOST ping

# Увеличить память (в docker-compose.yml)
deploy:
  resources:
    limits:
      memory: 1G  # было 768M
```

### 502 Bad Gateway
```bash
# Backend запущен?
docker-compose ps

# Nginx видит backend?
docker-compose exec nginx curl http://backend:8000/health
```

## Дополнительная документация

Полная инструкция по деплою: `docs/reports/2026-01-16-aws-deployment-guide.md`
