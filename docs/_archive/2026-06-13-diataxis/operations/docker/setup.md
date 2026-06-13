# Docker Setup Guide для BookReader AI

**Обновлено**: 2025-10-30
**Статус**: Development Environment настроен и готов к использованию

---

## Быстрый старт

### 1. Проверка предварительных требований

```bash
# Проверить Docker установлен
docker --version
# Должно быть: Docker version 24.0+

# Проверить Docker Compose установлен
docker compose version
# Должно быть: Docker Compose version v2.20+
```

### 2. Настройка окружения

```bash
# Скопировать .env.example в .env
cp .env.example .env

# Отредактировать .env и заполнить переменные
# Минимум нужно изменить:
# - DB_PASSWORD
# - REDIS_PASSWORD
# - SECRET_KEY

# Генерация безопасных секретов:
python -c "import secrets; print('DB_PASSWORD:', secrets.token_urlsafe(32))"
python -c "import secrets; print('REDIS_PASSWORD:', secrets.token_urlsafe(32))"
python -c "import secrets; print('SECRET_KEY:', secrets.token_urlsafe(64))"
```

### 3. Запуск приложения

```bash
# Запустить все сервисы
docker compose up -d

# Проверить статус
docker compose ps

# Проверить логи
docker compose logs -f backend
docker compose logs -f frontend
```

### 4. Доступ к приложению

- **Frontend**: http://localhost:5173 (Vite dev server)
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **PostgreSQL**: localhost:5432 (username: postgres)
- **Redis**: localhost:6379

---

## Структура конфигурации

### Файлы конфигурации

```
.
├── .env                          # Переменные окружения (НЕ коммитить!)
├── .env.example                  # Шаблон переменных окружения
├── docker-compose.yml            # Основная конфигурация
├── docker-compose.override.yml   # Локальные overrides (НЕ коммитить!)
├── frontend/
│   ├── Dockerfile                # Frontend image (Vite dev server)
│   └── vite.config.ts            # Vite конфигурация (порт 5173)
└── backend/
    └── Dockerfile                # Backend image (FastAPI)
```

### Сервисы

| Сервис         | Container Name        | Порты       | Описание                    |
|----------------|-----------------------|-------------|-----------------------------|
| postgres       | bookreader_postgres   | 5432:5432   | PostgreSQL 15.7             |
| redis          | bookreader_redis      | 6379:6379   | Redis 7.4                   |
| backend        | bookreader_backend    | 8000:8000   | FastAPI backend             |
| frontend       | bookreader_frontend   | 5173:5173   | Vite dev server             |
| celery-worker  | bookreader_celery     | -           | Celery worker               |
| celery-beat    | bookreader_beat       | -           | Celery scheduler            |

---

## Переменные окружения

### Docker Compose (.env в корне проекта)

```bash
# Database
DB_NAME=bookreader_dev
DB_USER=postgres
DB_PASSWORD=dev_postgres_2025

# Redis
REDIS_PASSWORD=dev_redis_2025

# Application
SECRET_KEY=dev-secret-key...
DEBUG=true
POLLINATIONS_ENABLED=true

# CORS (порты 5173 для Vite, 3000 для legacy support)
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000

# Celery
CELERY_CONCURRENCY=2
```

### Frontend (передается в Vite через docker-compose.yml)

```bash
# Vite environment variables (VITE_ prefix обязателен!)
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_DEBUG=true
VITE_ENVIRONMENT=development
```

**ВАЖНО**: Vite требует префикс `VITE_` для всех переменных окружения!
Старые `REACT_APP_` переменные НЕ работают.

---

## Управление сервисами

### Запуск и остановка

```bash
# Запустить все сервисы
docker compose up -d

# Запустить конкретный сервис
docker compose up -d backend

# Остановить все сервисы
docker compose down

# Остановить и удалить volumes (⚠️ удалит данные БД!)
docker compose down -v

# Перезапустить сервис
docker compose restart backend
```

### Логи и мониторинг

```bash
# Все логи
docker compose logs -f

# Логи конкретного сервиса
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f celery-worker

# Последние 100 строк
docker compose logs --tail=100 backend

# Статус всех контейнеров
docker compose ps

# Использование ресурсов
docker stats
```

### Выполнение команд внутри контейнеров

```bash
# Backend: выполнить миграции
docker compose exec backend alembic upgrade head

# Backend: создать миграцию
docker compose exec backend alembic revision --autogenerate -m "description"

# Backend: запустить Python shell
docker compose exec backend python

# Backend: запустить тесты
docker compose exec backend pytest -v

# Frontend: установить зависимости
docker compose exec frontend npm install

# Frontend: запустить тесты
docker compose exec frontend npm test

# PostgreSQL: подключиться к БД
docker compose exec postgres psql -U postgres -d bookreader_dev

# Redis: подключиться к CLI
docker compose exec redis redis-cli -a ${REDIS_PASSWORD}
```

---

## Rebuild и обновления

### Пересборка образов

```bash
# Пересобрать все образы
docker compose build

# Пересобрать без кэша
docker compose build --no-cache

# Пересобрать конкретный сервис
docker compose build backend

# Пересобрать и перезапустить
docker compose up -d --build backend
```

### Обновление зависимостей

```bash
# Backend: обновить Python пакеты
docker compose exec backend pip install -r requirements.txt

# Frontend: обновить npm пакеты
docker compose exec frontend npm install

# Или пересобрать образы полностью
docker compose build --no-cache
```

---

## Порты и сетевая конфигурация

### Изменение портов

Для изменения портов используйте `docker-compose.override.yml`:

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "3001:5173"  # Изменить порт хоста с 5173 на 3001

  backend:
    ports:
      - "8001:8000"  # Изменить порт хоста с 8000 на 8001
```

**ВАЖНО**: Порт внутри контейнера (5173, 8000) должен оставаться прежним!

### CORS проблемы

Если фронтенд не может подключиться к API:

1. Проверьте CORS_ORIGINS в `.env`
2. Убедитесь что порт совпадает с тем, на котором запущен frontend
3. Добавьте нужный origin в CORS_ORIGINS

```bash
# В .env
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,http://192.168.1.100:5173
```

---

## Development Best Practices

### Hot Reload

Оба сервиса поддерживают hot reload:

- **Backend**: FastAPI `--reload` флаг включен
- **Frontend**: Vite dev server с HMR включен

Изменения в коде автоматически перезагружаются внутри контейнеров благодаря volume bindings:

```yaml
volumes:
  - ./backend:/app       # Backend код
  - ./frontend:/app      # Frontend код
  - /app/node_modules    # Exclude node_modules
```

### Отладка

#### Backend debugging с debugpy

1. Раскомментируйте в `docker-compose.override.yml`:

```yaml
services:
  backend:
    ports:
      - "5678:5678"  # Debugger port
```

2. Добавьте в `backend/app/main.py`:

```python
import debugpy
debugpy.listen(("0.0.0.0", 5678))
# debugpy.wait_for_client()  # Раскомментировать для breakpoint при старте
```

3. Настройте VS Code launch.json:

```json
{
  "name": "Python: Remote Attach",
  "type": "python",
  "request": "attach",
  "connect": {
    "host": "localhost",
    "port": 5678
  },
  "pathMappings": [
    {
      "localRoot": "${workspaceFolder}/backend",
      "remoteRoot": "/app"
    }
  ]
}
```

#### Frontend debugging

Vite dev server поддерживает source maps, используйте Chrome DevTools или VS Code debugger для браузера.

---

## Troubleshooting

### Проблема: Контейнер не запускается

```bash
# Проверить логи
docker compose logs backend

# Проверить что все зависимости установлены
docker compose build --no-cache backend

# Проверить health checks
docker compose ps
```

### Проблема: Port already in use

```bash
# Найти процесс на порту 5173
lsof -i :5173
# или
netstat -an | grep 5173

# Убить процесс
kill -9 <PID>

# Или изменить порт в docker-compose.override.yml
```

### Проблема: PostgreSQL connection refused

```bash
# Проверить что postgres контейнер запущен и healthy
docker compose ps postgres

# Проверить health check
docker compose exec postgres pg_isready -U postgres

# Проверить логи
docker compose logs postgres

# Пересоздать volume (⚠️ удалит данные!)
docker compose down -v
docker compose up -d
```

### Проблема: Vite не видит изменения в коде

```bash
# Перезапустить frontend
docker compose restart frontend

# Проверить что volume binding работает
docker compose exec frontend ls -la /app

# Очистить Vite cache
docker compose exec frontend rm -rf node_modules/.vite
docker compose restart frontend
```

### Проблема: npm install fails в frontend

```bash
# Удалить node_modules и package-lock.json
docker compose exec frontend rm -rf node_modules package-lock.json

# Переустановить
docker compose exec frontend npm install

# Или пересобрать образ
docker compose build --no-cache frontend
```

### Проблема: Environment variables не загружаются

```bash
# Проверить что .env файл существует
ls -la .env

# Проверить валидацию конфига
docker compose config

# Проверить что переменные загружены
docker compose config | grep VITE_API_BASE_URL
docker compose config | grep DB_PASSWORD

# Перезапустить с явным указанием .env
docker compose --env-file .env up -d
```

---

## Чистка и оптимизация

### Очистка Docker

```bash
# Остановить все контейнеры
docker compose down

# Удалить неиспользуемые образы
docker image prune -a

# Удалить неиспользуемые volumes
docker volume prune

# Удалить все (⚠️ опасно!)
docker system prune -a --volumes
```

### Оптимизация образов

- Frontend Dockerfile использует multi-stage builds
- Backend Dockerfile использует slim Python образ
- Layer caching оптимизирован (сначала копируются package files)

---

## Production Deployment (будет позже)

Для production используются отдельные файлы:

- `docker-compose.production.yml` - production конфигурация
- `frontend/Dockerfile.prod` - production frontend build
- `backend/Dockerfile.prod` - production backend (gunicorn)

Текущий `docker-compose.yml` НЕ предназначен для production!

---

## Полезные команды

```bash
# Валидация конфигурации
docker compose config

# Показать образы
docker compose images

# Показать volumes
docker volume ls

# Показать networks
docker network ls

# Подключиться к контейнеру (bash)
docker compose exec backend bash
docker compose exec frontend sh

# Скопировать файлы из/в контейнер
docker cp bookreader_backend:/app/uploads/file.epub ./
docker cp ./file.epub bookreader_backend:/app/uploads/
```

---

## Известные ограничения

1. **macOS Performance**: Volume bindings могут быть медленными. Используйте `:delegated` mode (уже настроен в docker-compose.override.yml)

2. **Windows Line Endings**: Если используете Windows, убедитесь что line endings установлены в LF, а не CRLF

3. **Memory Limits**: Celery worker имеет лимит 6GB памяти. Для больших книг может потребоваться увеличение

4. **Hot Reload on Windows**: Могут быть проблемы с file watching в Docker на Windows

---

## Дополнительные ресурсы

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Vite Configuration](https://vitejs.dev/config/)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)

---

**Автор**: DevOps Engineer Agent
**Дата**: 2025-10-30
**Версия**: 1.0
