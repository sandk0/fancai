# Руководство по устранению неполадок

Распространенные проблемы и решения для BookReader AI.

## Содержание

- [Быстрая диагностика](#быстрая-диагностика)
- [Проблемы установки](#проблемы-установки)
- [Проблемы Docker](#проблемы-docker)
- [Проблемы базы данных](#проблемы-базы-данных)
- [Проблемы Backend](#проблемы-backend)
- [Проблемы Frontend](#проблемы-frontend)
- [Проблемы NLP системы](#проблемы-nlp-системы)
- [Проблемы генерации изображений](#проблемы-генерации-изображений)
- [Проблемы производительности](#проблемы-производительности)
- [Проблемы развертывания](#проблемы-развертывания)
- [Получение помощи](#получение-помощи)

---

## Быстрая диагностика

### Проверка работоспособности

Выполните эти команды для быстрой диагностики проблем:

```bash
# Проверка статуса всех сервисов
docker-compose ps

# Проверка работоспособности backend
curl http://localhost:8000/health

# Проверка frontend
curl http://localhost:5173

# Проверка логов
docker-compose logs --tail=50 backend
docker-compose logs --tail=50 frontend
docker-compose logs --tail=50 celery-worker

# Проверка места на диске
df -h

# Проверка памяти
free -h
```

### Контрольный список распространенных проблем

- [ ] Все Docker контейнеры запущены?
- [ ] Файл .env существует и настроен?
- [ ] Порты не конфликтуют (8000, 5173, 5432, 6379)?
- [ ] База данных инициализирована и мигрирована?
- [ ] NLP модели загружены?
- [ ] Достаточно места на диске (>5GB свободно)?
- [ ] Достаточно памяти (>2GB свободно)?

---

## Проблемы установки

### Проблема: Не удается клонировать репозиторий

**Ошибка:**
```
fatal: repository not found
```

**Решения:**
1. Проверьте правильность URL репозитория
2. Проверьте Git credentials/SSH ключи
3. Проверьте сетевое подключение
4. Попробуйте HTTPS вместо SSH (или наоборот)

```bash
# HTTPS
git clone https://github.com/your-org/fancai-vibe-hackathon.git

# SSH
git clone git@github.com:your-org/fancai-vibe-hackathon.git
```

### Проблема: Устаревшая версия Python

**Ошибка:**
```
Python 3.11+ required, you have 3.9
```

**Решения:**
```bash
# macOS
brew install python@3.11

# Ubuntu
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.11

# Проверка
python3.11 --version
```

### Проблема: Устаревшая версия Node.js

**Ошибка:**
```
Node.js 18+ required
```

**Решения:**
```bash
# Используя nvm (рекомендуется)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Проверка
node --version
```

### Проблема: Отсутствует файл .env

**Ошибка:**
```
Error: .env file not found
```

**Решение:**
```bash
# Скопировать файл-пример
cp .env.example .env

# Редактировать со своими значениями
nano .env

# Обязательные переменные:
# - DATABASE_URL
# - REDIS_URL
# - SECRET_KEY
# - POLLINATIONS_ENABLED=true
```

---

## Проблемы Docker

### Проблема: Docker daemon не запущен

**Ошибка:**
```
Cannot connect to the Docker daemon
```

**Решения:**
```bash
# Запуск Docker
# macOS
open -a Docker

# Linux
sudo systemctl start docker

# Проверка
docker ps
```

### Проблема: Порт уже используется

**Ошибка:**
```
Error: bind: address already in use
```

**Решения:**
```bash
# Найти процесс, использующий порт (пример: 8000)
lsof -i :8000

# Убить процесс
kill -9 <PID>

# Или изменить порт в docker-compose.yml
ports:
  - "8001:8000"  # Изменено с 8000:8000
```

### Проблема: Контейнер постоянно перезапускается

**Ошибка:**
```
backend_1 exited with code 1
```

**Решения:**
```bash
# Проверить логи на ошибки
docker-compose logs backend

# Распространенные причины:
# 1. База данных не готова - подождите 30с и повторите
# 2. Отсутствуют переменные окружения - проверьте .env
# 3. Конфликт портов - см. выше
# 4. Отсутствуют зависимости - пересоберите образ

# Пересборка образа
docker-compose build --no-cache backend
docker-compose up -d
```

### Проблема: Ошибки прав доступа

**Ошибка:**
```
mkdir: cannot create directory: Permission denied
```

**Решения:**
```bash
# Исправить владение (Linux)
sudo chown -R $USER:$USER .

# Или запустить с sudo (не рекомендуется)
sudo docker-compose up -d

# macOS: Сбросить общий доступ к файлам Docker Desktop
# Docker Desktop → Preferences → Resources → File Sharing
```

### Проблема: Не хватает места на диске

**Ошибка:**
```
No space left on device
```

**Решения:**
```bash
# Очистка системы Docker
docker system prune -a --volumes

# Удаление неиспользуемых образов
docker image prune -a

# Удаление неиспользуемых томов
docker volume prune

# Проверка освобожденного места
df -h
```

---

## Проблемы базы данных

### Проблема: Не удалось подключиться к базе данных

**Ошибка:**
```
sqlalchemy.exc.OperationalError: could not connect to server
```

**Решения:**
```bash
# Проверить, что PostgreSQL запущен
docker-compose ps postgres

# Проверить строку подключения
echo $DATABASE_URL

# Проверить формат
# postgresql://user:password@localhost:5432/dbname

# Перезапустить базу данных
docker-compose restart postgres

# Подождать 10с для запуска
sleep 10

# Проверить подключение
docker-compose exec backend python -c "from app.core.database import engine; engine.connect()"
```

### Проблема: Миграция не работает

**Ошибка:**
```
alembic.util.exc.CommandError: Can't locate revision
```

**Решения:**
```bash
# Проверить текущую версию
cd backend && alembic current

# Проверить доступные версии
alembic history

# Сброс к базовой (ДЕСТРУКТИВНО - только разработка!)
alembic downgrade base

# Применить все миграции
alembic upgrade head

# Принудительная очистка (ДЕСТРУКТИВНО - только разработка!)
docker-compose down -v
docker-compose up -d
cd backend && alembic upgrade head
```

### Проблема: Ошибка дублирования ключа

**Ошибка:**
```
psycopg2.errors.UniqueViolation: duplicate key value
```

**Решения:**
```bash
# Проверить существующие данные
docker-compose exec postgres psql -U postgres -d bookreader -c "SELECT * FROM table_name WHERE id='value';"

# Удалить дубликат (если уместно)
docker-compose exec postgres psql -U postgres -d bookreader -c "DELETE FROM table_name WHERE id='value';"

# Или сбросить базу данных (ДЕСТРУКТИВНО)
docker-compose down -v
docker-compose up -d
```

### Проблема: Таблица не существует

**Ошибка:**
```
psycopg2.errors.UndefinedTable: relation "table_name" does not exist
```

**Решения:**
```bash
# Запустить миграции
cd backend && alembic upgrade head

# Если не работает, проверить файлы миграций
ls backend/alembic/versions/

# Пересоздать базу данных (ДЕСТРУКТИВНО)
docker-compose down -v
docker-compose up -d
cd backend && alembic upgrade head
```

---

## Проблемы Backend

### Проблема: Ошибки импорта

**Ошибка:**
```
ModuleNotFoundError: No module named 'app'
```

**Решения:**
```bash
# Установить зависимости
cd backend
pip install -r requirements.txt

# Проверить установку
pip list | grep fastapi

# Если в Docker, пересобрать
docker-compose build backend
```

### Проблема: Celery worker не запускается

**Ошибка:**
```
[ERROR] Consumer: Cannot connect to redis
```

**Решения:**
```bash
# Проверить, что Redis запущен
docker-compose ps redis

# Проверить подключение Redis
docker-compose exec backend python -c "import redis; r = redis.from_url('redis://redis:6379'); r.ping()"

# Перезапустить Redis
docker-compose restart redis

# Перезапустить Celery worker
docker-compose restart celery-worker

# Проверить логи worker
docker-compose logs -f celery-worker
```

### Проблема: Ошибки JWT токена

**Ошибка:**
```
401 Unauthorized: Invalid token
```

**Решения:**
```bash
# Проверить, что SECRET_KEY установлен
echo $SECRET_KEY

# Сгенерировать новый секрет (если отсутствует)
openssl rand -hex 32

# Обновить .env
SECRET_KEY=<generated_key>

# Перезапустить backend
docker-compose restart backend

# Очистить cookies/localStorage браузера
# DevTools → Application → Clear Storage
```

### Проблема: Медленные ответы API

**Проблема:**
API вызовы занимают >1 секунды

**Решения:**
```bash
# Проверить индексы базы данных
docker-compose exec postgres psql -U postgres -d bookreader -c "\d+ books"

# Проверить кэш Redis
docker-compose exec redis redis-cli INFO stats

# Включить логирование запросов
# В backend/app/core/database.py
# engine = create_async_engine(url, echo=True)

# Перезапустить backend
docker-compose restart backend
```

---

## Проблемы Frontend

### Проблема: npm install не работает

**Ошибка:**
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Решения:**
```bash
# Чистая установка
cd frontend
rm -rf node_modules package-lock.json
npm install

# Использовать legacy peer deps (если нужно)
npm install --legacy-peer-deps

# Или использовать точные версии
npm ci
```

### Проблема: Сборка не работает

**Ошибка:**
```
ERROR in ./src/components/Component.tsx
Module not found: Error: Can't resolve 'module'
```

**Решения:**
```bash
# Проверить импорты
# Убедитесь, что пути правильные
# Используйте абсолютные импорты из 'src/'

# Очистить и пересобрать
rm -rf dist node_modules
npm install
npm run build

# Проверить ошибки TypeScript
npm run type-check
```

### Проблема: Сервер разработки не запускается

**Ошибка:**
```
Port 5173 is already in use
```

**Решения:**
```bash
# Найти процесс
lsof -i :5173

# Убить процесс
kill -9 <PID>

# Или изменить порт
# В vite.config.ts
server: {
  port: 5174
}
```

### Проблема: Hot reload не работает

**Проблема:**
Изменения не отражаются в браузере

**Решения:**
```bash
# Очистить кэш
# DevTools браузера → Network → Disable cache

# Перезапустить dev сервер
# Ctrl+C
npm run dev

# Проверить лимиты file watcher (Linux)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Проблема: Ошибки TypeScript

**Ошибка:**
```
Type 'X' is not assignable to type 'Y'
```

**Решения:**
```bash
# Проверить определения типов
npm run type-check

# Обновить типы
npm install --save-dev @types/node @types/react @types/react-dom

# Перезапустить TypeScript server (VS Code)
# Cmd+Shift+P → "TypeScript: Restart TS Server"
```

---

## Проблемы NLP системы

### Проблема: NLP модели не найдены

**Ошибка:**
```
OSError: Can't find model 'ru_core_news_lg'
```

**Решения:**
```bash
# Скачать модель SpaCy
python -m spacy download ru_core_news_lg

# Скачать модель Stanza
python -c "import stanza; stanza.download('ru')"

# Установить Natasha (если отсутствует)
pip install natasha

# Проверить установку
python -c "import spacy; nlp = spacy.load('ru_core_news_lg'); print('SpaCy OK')"
python -c "import stanza; nlp = stanza.Pipeline('ru'); print('Stanza OK')"
python -c "from natasha import Segmenter; print('Natasha OK')"
```

### Проблема: Низкое качество описаний

**Проблема:**
Слишком мало или нерелевантные описания извлечены

**Решения:**
```bash
# Переключиться на режим ENSEMBLE (лучшее качество)
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "ENSEMBLE"}'

# Настроить веса процессоров
# Увеличить Natasha (лучший для русской литературы)
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/natasha \
  -d '{"weight": 1.5, "threshold": 0.2}'

# Проверить статус процессоров
curl http://localhost:8000/api/v1/admin/multi-nlp-settings/status
```

### Проблема: NLP обработка слишком медленная

**Проблема:**
Парсинг книги занимает >30 секунд

**Решения:**
```bash
# Использовать режим SINGLE (самый быстрый)
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/mode \
  -d '{"mode": "SINGLE"}'

# Использовать только SpaCy (самый быстрый процессор)
# В backend/app/core/config.py
ACTIVE_PROCESSORS = ["spacy"]

# Увеличить размер батча (осторожно с памятью!)
# В multi_nlp_manager.py
BATCH_SIZE = 10  # По умолчанию: 5
```

### Проблема: Ошибки памяти во время NLP

**Ошибка:**
```
MemoryError: Unable to allocate array
```

**Решения:**
```bash
# Уменьшить размер батча
# В multi_nlp_manager.py
BATCH_SIZE = 3  # По умолчанию: 5

# Обрабатывать главы последовательно
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/mode \
  -d '{"mode": "SEQUENTIAL"}'

# Увеличить лимит памяти Docker
# В docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 4G  # Увеличить с 2G
```

---

## Проблемы генерации изображений

### Проблема: Изображения не генерируются

**Проблема:**
Изображения не появляются после загрузки книги

**Решения:**
```bash
# Проверить Celery worker
docker-compose logs celery-worker

# Проверить сервис pollinations.ai
curl https://image.pollinations.ai/prompt/test

# Проверить наличие описаний
curl http://localhost:8000/api/v1/books/{book_id}/descriptions

# Перезапустить Celery worker
docker-compose restart celery-worker

# Проверить очередь задач
docker-compose exec redis redis-cli LLEN celery
```

### Проблема: Генерация изображения не работает

**Ошибка:**
```
Task generate_image failed: Connection timeout
```

**Решения:**
```bash
# Проверить интернет-соединение
ping image.pollinations.ai

# Увеличить timeout
# В backend/app/services/image_generator.py
timeout = 60  # Увеличить с 30

# Использовать альтернативный сервис
# В .env
OPENAI_API_KEY=sk-...
```

### Проблема: Низкое качество изображений

**Проблема:**
Сгенерированные изображения не соответствуют описаниям

**Решения:**
```bash
# Улучшить промпты
# Редактировать backend/app/services/prompt_engineering.py
# Добавить больше контекста, деталей по жанрам

# Использовать лучший AI сервис
# DALL-E вместо pollinations.ai
# В .env
OPENAI_API_KEY=sk-...
IMAGE_SERVICE=openai

# Настроить параметры генерации
# В backend/app/services/image_generator.py
quality = "hd"  # Для DALL-E
steps = 50  # Для Stable Diffusion
```

---

## Проблемы производительности

### Проблема: Медленные запросы к базе данных

**Проблема:**
Ответы API >500ms

**Решения:**
```bash
# Проверить наличие индексов
docker-compose exec postgres psql -U postgres -d bookreader -c "\d+ books"

# Создать отсутствующие индексы
# Должны быть видны GIN индексы на JSONB колонках

# Запустить VACUUM
docker-compose exec postgres psql -U postgres -d bookreader -c "VACUUM ANALYZE;"

# Проверить медленные запросы
docker-compose exec postgres psql -U postgres -d bookreader -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### Проблема: Высокое использование памяти

**Проблема:**
Docker контейнеры используют >4GB RAM

**Решения:**
```bash
# Проверить использование памяти
docker stats

# Уменьшить Celery workers
# В docker-compose.yml
command: celery -A app.core.celery worker --concurrency=2

# Уменьшить размер NLP батча
# В multi_nlp_manager.py
BATCH_SIZE = 3

# Увеличить swap (Linux)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Проблема: Медленная загрузка frontend

**Проблема:**
Время загрузки страницы >3 секунд

**Решения:**
```bash
# Собрать production бандл
cd frontend
npm run build

# Проверить размер бандла
npm run build -- --mode=production --analyze

# Включить разделение кода
# Уже реализовано с React.lazy()

# Включить кэширование
# В nginx.conf
location /static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

---

## Проблемы развертывания

### Проблема: SSL сертификат не работает

**Ошибка:**
```
Failed to obtain Let's Encrypt certificate
```

**Решения:**
```bash
# Проверить DNS домена
nslookup your-domain.com

# Проверить доступность порта 80
curl http://your-domain.com

# Проверить логи Certbot
docker-compose logs certbot

# Ручной запрос сертификата
./scripts/deploy.sh ssl

# Если не работает, проверить firewall
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Проблема: Production развертывание не работает

**Ошибка:**
```
Health check failed
```

**Решения:**
```bash
# Проверить, что все сервисы запущены
./scripts/deploy.sh status

# Проверить логи
docker-compose -f docker-compose.prod.yml logs

# Проверить .env.production
cat .env.production | grep -v PASSWORD

# Перезапустить сервисы
./scripts/deploy.sh restart

# Полное повторное развертывание
./scripts/deploy.sh deploy
```

### Проблема: Nginx 502 Bad Gateway

**Ошибка:**
Браузер показывает "502 Bad Gateway"

**Решения:**
```bash
# Проверить, что backend запущен
docker-compose ps backend

# Проверить логи Nginx
docker-compose logs nginx

# Проверить конфигурацию Nginx
docker-compose exec nginx nginx -t

# Перезапустить Nginx
docker-compose restart nginx

# Если проблема сохраняется, проверить firewall
sudo ufw status
```

---

## Получение помощи

### Перед запросом помощи

1. Проверьте это руководство по устранению неполадок
2. Поищите существующие [GitHub Issues](https://github.com/your-org/fancai-vibe-hackathon/issues)
3. Проверьте [FAQ](FAQ.md)
4. Просмотрите соответствующую документацию в [docs/](docs/)

### Как сообщить о проблеме

Включите:
1. **Описание:** Что не так?
2. **Шаги для воспроизведения:** Как мы можем воспроизвести это?
3. **Ожидаемое поведение:** Что должно произойти?
4. **Фактическое поведение:** Что происходит на самом деле?
5. **Окружение:**
   - ОС (macOS 14, Ubuntu 22.04 и т.д.)
   - Версия Docker
   - Браузер (если проблема frontend)
6. **Логи:** Соответствующие сообщения об ошибках
7. **Скриншоты:** Если применимо

### Полезные диагностические команды

```bash
# Информация о системе
uname -a
docker --version
docker-compose --version

# Статус сервисов
docker-compose ps
docker-compose logs --tail=100

# Использование ресурсов
docker stats
df -h
free -h

# Сеть
netstat -tuln | grep -E '8000|5173|5432|6379'

# Окружение
env | grep -E 'DATABASE_URL|REDIS_URL|SECRET_KEY' | sed 's/=.*/=***/'
```

### Контакты

- **GitHub Issues:** https://github.com/your-org/fancai-vibe-hackathon/issues
- **Документация:** [docs/](docs/)
- **Email:** support@bookreader.ai (если доступен)

---

**Последнее обновление:** 14 ноября 2025
