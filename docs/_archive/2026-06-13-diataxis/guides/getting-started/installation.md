# Инструкция по установке BookReader AI

Данное руководство поможет вам установить и запустить BookReader AI как для разработки, так и для production использования.

## Системные требования

### Минимальные требования
- **ОС:** Linux/macOS/Windows 10+
- **Память:** 4GB RAM (минимум для одного NLP процессора)
- **Процессор:** 2 CPU cores
- **Место на диске:** 10GB свободного места
- **Docker:** 20.10+ и Docker Compose 2.0+
- **Node.js:** 18+ (для frontend разработки)
- **Python:** 3.11+ (для backend разработки)

### Рекомендуемые требования
- **ОС:** Ubuntu 20.04+ / CentOS 8+ / macOS 12+
- **Память:** 8GB+ RAM (для всех трёх NLP процессоров)
- **Процессор:** 4+ CPU cores
- **Место на диске:** 50GB+ SSD
- **Интернет:** Стабильное соединение для AI сервисов
- **NLP Models:** ~2GB для всех трёх моделей (SpaCy, Natasha, Stanza)

## Установка Docker

### Ubuntu/Debian
```bash
# Обновление пакетов
sudo apt update
sudo apt install -y curl

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Добавление пользователя в группу docker
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезагрузка для применения изменений
sudo reboot
```

### CentOS/RHEL
```bash
# Установка Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io

# Запуск Docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

sudo reboot
```

### macOS
```bash
# С помощью Homebrew
brew install docker docker-compose

# Или скачать Docker Desktop с официального сайта
# https://docs.docker.com/desktop/mac/install/
```

### Windows
1. Скачайте Docker Desktop для Windows: https://docs.docker.com/desktop/windows/install/
2. Следуйте инструкциям установщика
3. Убедитесь, что WSL2 включен

## Клонирование репозитория

```bash
# Клонирование проекта
git clone <your-repository-url>
cd fancai-vibe-hackathon

# Проверка содержимого
ls -la
```

## Development установка

### 1. Настройка переменных окружения

```bash
# Копирование example файла
cp .env.example .env

# Редактирование настроек
nano .env
```

Основные переменные для development:
```env
# Database
DATABASE_URL=postgresql+asyncpg://bookreader_user:bookreader_pass@postgres:5432/bookreader

# Redis
REDIS_URL=redis://redis:6379/0

# API Keys (опционально)
OPENAI_API_KEY=your-openai-key-here
POLLINATIONS_ENABLED=true

# Security
SECRET_KEY=your-secret-key-change-in-production
JWT_SECRET_KEY=your-jwt-secret-key-change-in-production

# Development settings
DEBUG=true
ENVIRONMENT=development
```

### 2. Запуск в development режиме

```bash
# Запуск всех сервисов для разработки
docker-compose -f docker-compose.dev.yml up -d

# Проверка статуса
docker-compose -f docker-compose.dev.yml ps
```

### 3. Инициализация базы данных

```bash
# Применение миграций
docker-compose -f docker-compose.dev.yml exec backend alembic upgrade head

# Создание тестового пользователя (опционально)
docker-compose -f docker-compose.dev.yml exec backend python scripts/create_test_user.py
```

### 4. Установка зависимостей

#### Frontend зависимости (epub.js для чтения книг)

```bash
cd frontend

# Установка всех зависимостей проекта (включая epub.js)
npm install

# Ключевые зависимости для EPUB чтения:
# - epubjs@0.3.93 - профессиональная библиотека для EPUB рендеринга
# - react@18+ - React библиотека
# - typescript@5+ - TypeScript для type safety
```

#### Backend NLP модели (для извлечения описаний)

```bash
# Установка SpaCy модели (Entity Recognition)
docker-compose -f docker-compose.dev.yml exec backend python -m spacy download ru_core_news_lg

# Установка Natasha (Russian Specialist)
# Natasha устанавливается автоматически через requirements.txt
docker-compose -f docker-compose.dev.yml exec backend pip install natasha

# Установка Stanza модели (Complex Syntax)
docker-compose -f docker-compose.dev.yml exec backend python -c "import stanza; stanza.download('ru')"

# Проверка установки всех процессоров
docker-compose -f docker-compose.dev.yml exec backend python -c "
from app.services.multi_nlp_manager import multi_nlp_manager
import asyncio
asyncio.run(multi_nlp_manager.initialize())
print('All NLP processors initialized successfully!')
"
```

**Примечание:** Multi-NLP система работает в 5 режимах:
- **SINGLE** - один процессор (быстро)
- **PARALLEL** - все процессоры одновременно (максимальное покрытие)
- **SEQUENTIAL** - последовательная обработка
- **ENSEMBLE** - voting с consensus алгоритмом (рекомендуется, максимальное качество)
- **ADAPTIVE** - автоматический выбор оптимального режима

### 5. Проверка работоспособности

Откройте браузер и перейдите по адресам:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000/docs
- **PgAdmin:** http://localhost:5050 (admin@admin.com / admin)
- **Redis Commander:** http://localhost:8081

## Production установка

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y curl git ufw

# Настройка firewall
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. Настройка домена

Убедитесь, что ваш домен настроен правильно:
```bash
# Проверка DNS записей
dig yourdomain.com
dig www.yourdomain.com

# Должны указывать на IP вашего сервера
```

### 3. Настройка production переменных

```bash
# Копирование production шаблона
cp .env.production .env.production.local

# Редактирование (ОБЯЗАТЕЛЬНО!)
nano .env.production.local
```

Критически важные настройки:
```env
# Domain Configuration (ОБЯЗАТЕЛЬНО ИЗМЕНИТЬ!)
DOMAIN_NAME=yourdomain.com
DOMAIN_URL=https://yourdomain.com

# Security (ОБЯЗАТЕЛЬНО ИЗМЕНИТЬ!)
DB_PASSWORD=your-super-secure-database-password-123!
REDIS_PASSWORD=your-redis-password-456!
SECRET_KEY=very-long-secret-key-minimum-64-characters-change-this!
JWT_SECRET_KEY=another-very-long-jwt-secret-key-change-this!

# SSL Email (ОБЯЗАТЕЛЬНО ИЗМЕНИТЬ!)
SSL_EMAIL=admin@yourdomain.com

# Performance
WORKERS_COUNT=4
CELERY_WORKERS=2

# Security
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
```

### 4. Запуск production деплоя

```bash
# Сделать скрипт исполняемым
chmod +x scripts/deploy.sh

# Инициализация production окружения
./scripts/deploy.sh init

# Настройка SSL сертификатов
./scripts/deploy.sh ssl

# Деплой приложения
./scripts/deploy.sh deploy
```

### 5. Проверка production деплоя

```bash
# Проверка статуса всех сервисов
./scripts/deploy.sh status

# Просмотр логов
./scripts/deploy.sh logs

# Проверка здоровья API
curl -I https://yourdomain.com/health
```

## Установка мониторинга (опционально)

### 1. Запуск мониторинга

```bash
# Сделать скрипт исполняемым
chmod +x scripts/setup-monitoring.sh

# Настройка директорий и разрешений
./scripts/setup-monitoring.sh setup

# Запуск мониторинга
./scripts/setup-monitoring.sh start
```

### 2. Доступ к мониторингу

- **Grafana:** http://your-server:3000 (admin / пароль из .env.production.local)
- **Prometheus:** http://your-server:9090  
- **cAdvisor:** http://your-server:8080

### 3. Импорт дашбордов

```bash
# Создание базового дашборда
./scripts/setup-monitoring.sh dashboard
```

## Устранение проблем

### Проблема: Docker не запускается

**Решение:**
```bash
# Проверка статуса Docker
sudo systemctl status docker

# Запуск Docker
sudo systemctl start docker

# Добавление в автозагрузку
sudo systemctl enable docker

# Проверка разрешений
groups $USER
# Если нет группы docker, добавить:
sudo usermod -aG docker $USER
# Затем перезайти в систему
```

### Проблема: Ошибки с портами

**Решение:**
```bash
# Проверка занятых портов
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443

# Остановка конфликтующих сервисов
sudo systemctl stop apache2
sudo systemctl stop nginx

# Освобождение портов Docker
docker-compose down
```

### Проблема: SSL сертификаты не получаются

**Решение:**
```bash
# Проверка DNS
dig yourdomain.com

# Проверка доступности домена
curl -I http://yourdomain.com

# Принудительное обновление сертификатов
docker-compose -f docker-compose.ssl.yml run --rm certbot renew --force-renewal

# Проверка логов Certbot
docker-compose -f docker-compose.ssl.yml logs certbot
```

### Проблема: База данных не подключается

**Решение:**
```bash
# Проверка статуса PostgreSQL
docker-compose ps postgres

# Проверка логов
docker-compose logs postgres

# Подключение к базе для диагностики
docker-compose exec postgres psql -U bookreader_user -d bookreader

# Применение миграций заново
docker-compose exec backend alembic upgrade head
```

### Проблема: Frontend не открывается

**Решение:**
```bash
# Проверка статуса Nginx
docker-compose ps nginx

# Проверка логов Nginx
docker-compose logs nginx

# Проверка конфигурации Nginx
docker-compose exec nginx nginx -t

# Перезагрузка Nginx
docker-compose restart nginx
```

### Проблема: Celery задачи не выполняются

**Решение:**
```bash
# Проверка воркеров Celery
docker-compose ps | grep celery

# Проверка логов воркеров
docker-compose logs celery-worker

# Проверка очереди Redis
docker-compose exec redis redis-cli
> LLEN celery

# Перезапуск воркеров
docker-compose restart celery-worker celery-beat
```

## Обновление приложения

### Development
```bash
# Получение последних изменений
git pull origin main

# Перестроение контейнеров
docker-compose -f docker-compose.dev.yml build --no-cache

# Перезапуск
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d
```

### Production
```bash
# Получение обновлений
git pull origin main

# Применение обновлений
./scripts/deploy.sh deploy

# Проверка статуса
./scripts/deploy.sh status
```

## Резервное копирование

### Создание бэкапа
```bash
# Создание полного бэкапа
./scripts/deploy.sh backup

# Бэкап будет сохранен в ./backups/backup_YYYYMMDD_HHMMSS/
```

### Восстановление из бэкапа
```bash
# Остановка сервисов
./scripts/deploy.sh stop

# Восстановление базы данных
docker-compose exec postgres psql -U bookreader_user -d bookreader < backups/backup_YYYYMMDD_HHMMSS/database.sql

# Восстановление файлов
cp -r backups/backup_YYYYMMDD_HHMMSS/storage/* ./backend/storage/

# Запуск сервисов
./scripts/deploy.sh start
```

## Поддержка и документация

### Дополнительная документация
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Подробное руководство по production деплою
- [README.md](../../README.md) - Общая информация о проекте
- [CLAUDE.md](../../CLAUDE.md) - Руководство для разработчиков

### Получение помощи
1. Проверьте логи: `./scripts/deploy.sh logs [service-name]`
2. Проверьте статус: `./scripts/deploy.sh status`
3. Создайте issue в GitHub репозитории
4. Обратитесь к документации компонентов в папке `docs/`

---

**Успешной установки!** 🚀

После установки вы получите полнофункциональное приложение для чтения книг с AI-генерацией изображений, готовое для использования тысячами пользователей.