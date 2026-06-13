# Документация по резервному копированию и восстановлению

**Проект:** fancai
**Версия документа:** 1.0
**Последнее обновление:** 2025-10-24
**Цель:** Полное руководство по резервному копированию и восстановлению системы fancai

---

## Содержание

1. [Обзор системы резервного копирования](#обзор-системы-резервного-копирования)
2. [Компоненты полного резервного копирования](#компоненты-полного-резервного-копирования)
3. [Создание резервных копий](#создание-резервных-копий)
   - [Автоматический скрипт резервного копирования](#автоматический-скрипт-резервного-копирования)
   - [Ручное пошаговое резервное копирование](#ручное-пошаговое-резервное-копирование)
4. [Процедуры восстановления](#процедуры-восстановления)
   - [Полное восстановление системы](#полное-восстановление-системы)
   - [Частичное восстановление](#частичное-восстановление)
5. [Рекомендации по расписанию резервного копирования](#рекомендации-по-расписанию-резервного-копирования)
6. [Проверка целостности резервных копий](#проверка-целостности-резервных-копий)
7. [Лучшие практики](#лучшие-практики)
8. [Устранение неполадок](#устранение-неполадок)

---

## Обзор системы резервного копирования

Система резервного копирования fancai разработана для обеспечения полной возможности восстановления данных в случае сбоев системы, повреждения данных или аварийных сценариев. Стратегия резервного копирования следует правилу **3-2-1**:

- **3** копии ваших данных
- **2** разных типа носителей
- **1** копия вне площадки

### Архитектура

```
Архитектура резервного копирования fancai
├── Основные данные (Production)
│   ├── База данных PostgreSQL
│   ├── Кэш Redis
│   ├── Файлы хранилища (книги, изображения, обложки)
│   └── Конфигурационные файлы
│
├── Локальные резервные копии (Ежедневно)
│   ├── /backups/postgresql/
│   ├── /backups/redis/
│   ├── /backups/storage/
│   └── /backups/config/
│
└── Удаленные резервные копии (Еженедельно)
    ├── Облачное хранилище (S3/GCS)
    └── Git-репозиторий (только код)
```

### Типы резервного копирования

1. **Полное резервное копирование:** Полный снимок системы (еженедельно)
2. **Инкрементное резервное копирование:** Только измененные данные (ежедневно)
3. **Непрерывное резервное копирование:** В реальном времени для критических данных (опционально)

---

## Компоненты полного резервного копирования

Полная резервная копия fancai включает:

### 1. База данных PostgreSQL

**Что включено:**
- Все учетные записи пользователей и данные аутентификации
- Метаданные и содержимое книг
- Главы и описания
- Ссылки на сгенерированные изображения
- Прогресс чтения и закладки
- Подписки и история платежей
- Системные логи

**Размер:** ~500MB - 10GB (в зависимости от базы пользователей)
**Формат:** дамп-файл `.sql` или пользовательский формат PostgreSQL
**Расположение:** `backups/postgresql/bookreader_backup_YYYY-MM-DD.sql`

### 2. Данные Redis

**Что включено:**
- Данные сессий
- Записи кэша
- Очереди задач Celery
- Счетчики ограничения скорости
- Временные данные обработки

**Размер:** ~10MB - 500MB
**Формат:** `.rdb` (Redis Database Backup)
**Расположение:** `backups/redis/dump_YYYY-MM-DD.rdb`

### 3. Файлы хранилища

**Что включено:**
- **Книги:** Оригинальные файлы EPUB/FB2, загруженные пользователями
- **Сгенерированные изображения:** Иллюстрации, созданные ИИ
- **Обложки книг:** Извлеченные или загруженные изображения обложек
- **Аватары пользователей:** Фотографии профилей (опционально)

**Размер:** ~10GB - 1TB+ (в зависимости от размера библиотеки)
**Формат:** Оригинальные форматы файлов в архиве tar.gz
**Расположение:** `backups/storage/storage_backup_YYYY-MM-DD.tar.gz`

**Структура:**
```
storage/
├── books/              # Оригинальные файлы книг
│   ├── epub/
│   └── fb2/
├── images/             # Сгенерированные иллюстрации
│   ├── locations/
│   ├── characters/
│   └── atmospheres/
└── covers/             # Изображения обложек книг
```

### 4. Git-репозиторий

**Что включено:**
- Исходный код приложения
- Шаблоны конфигурации
- Скрипты миграции базы данных
- Документация
- Конфигурации Docker

**Размер:** ~50MB
**Формат:** Git-репозиторий
**Расположение:** Удаленный хостинг Git (GitHub/GitLab)

### 5. Конфигурационные файлы

**Что включено:**
- `docker-compose.yml`
- файлы `.env` (зашифрованные)
- Конфигурации Nginx
- SSL сертификаты
- Конфигурации сервисов

**Размер:** ~5MB
**Формат:** Зашифрованный tar.gz
**Расположение:** `backups/config/config_backup_YYYY-MM-DD.tar.gz.enc`

---

## Создание резервных копий

### Автоматический скрипт резервного копирования

Создайте и используйте автоматический скрипт резервного копирования для регулярных бэкапов.

#### Шаг 1: Создание скрипта резервного копирования

Создайте файл: `scripts/backup.sh`

```bash
#!/bin/bash

# Скрипт автоматического резервного копирования fancai
# Версия: 1.0
# Автор: fancai Team

set -e  # Выход при любой ошибке

# Конфигурация
BACKUP_DIR="/var/backups/bookreader"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
RETENTION_DAYS=30
LOG_FILE="/var/log/bookreader_backup.log"

# Имена Docker контейнеров
DB_CONTAINER="bookreader-db"
REDIS_CONTAINER="bookreader-redis"
BACKEND_CONTAINER="bookreader-backend"

# Учетные данные базы данных (загрузить из .env или установить здесь)
DB_NAME="bookreader"
DB_USER="postgres"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Функции
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

create_directories() {
    mkdir -p "$BACKUP_DIR"/{postgresql,redis,storage,config,logs}
}

# 1. Резервное копирование PostgreSQL
backup_postgresql() {
    log_message "Начало резервного копирования PostgreSQL..."

    docker exec "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -F c \
        -b \
        -v \
        -f "/tmp/backup.dump"

    docker cp "$DB_CONTAINER:/tmp/backup.dump" \
        "$BACKUP_DIR/postgresql/bookreader_${DATE}.dump"

    # Также создать текстовый SQL формат для упрощения проверки
    docker exec "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --clean \
        --if-exists \
        > "$BACKUP_DIR/postgresql/bookreader_${DATE}.sql"

    # Сжать SQL файл
    gzip "$BACKUP_DIR/postgresql/bookreader_${DATE}.sql"

    log_message "Резервное копирование PostgreSQL завершено: $(du -h $BACKUP_DIR/postgresql/bookreader_${DATE}.dump | cut -f1)"
}

# 2. Резервное копирование Redis
backup_redis() {
    log_message "Начало резервного копирования Redis..."

    # Запустить BGSAVE
    docker exec "$REDIS_CONTAINER" redis-cli BGSAVE

    # Подождать завершения BGSAVE
    sleep 5

    # Скопировать dump.rdb
    docker cp "$REDIS_CONTAINER:/data/dump.rdb" \
        "$BACKUP_DIR/redis/dump_${DATE}.rdb"

    # Сжать
    gzip "$BACKUP_DIR/redis/dump_${DATE}.rdb"

    log_message "Резервное копирование Redis завершено: $(du -h $BACKUP_DIR/redis/dump_${DATE}.rdb.gz | cut -f1)"
}

# 3. Резервное копирование файлов хранилища
backup_storage() {
    log_message "Начало резервного копирования файлов хранилища..."

    # Скопировать директорию storage
    docker cp "$BACKEND_CONTAINER:/app/storage" /tmp/storage_backup

    # Создать сжатый архив
    tar -czf "$BACKUP_DIR/storage/storage_${DATE}.tar.gz" \
        -C /tmp storage_backup

    # Очистка
    rm -rf /tmp/storage_backup

    log_message "Резервное копирование хранилища завершено: $(du -h $BACKUP_DIR/storage/storage_${DATE}.tar.gz | cut -f1)"
}

# 4. Резервное копирование конфигурационных файлов
backup_config() {
    log_message "Начало резервного копирования конфигурации..."

    mkdir -p /tmp/config_backup

    # Скопировать важные конфигурационные файлы
    cp docker-compose.yml /tmp/config_backup/
    cp -r nginx/ /tmp/config_backup/ 2>/dev/null || true

    # Скопировать .env файлы (будут зашифрованы)
    cp .env /tmp/config_backup/.env.backup 2>/dev/null || true

    # Создать архив
    tar -czf /tmp/config_${DATE}.tar.gz -C /tmp config_backup

    # Зашифровать с помощью GPG (опционально, но рекомендуется)
    if command -v gpg &> /dev/null; then
        gpg --symmetric --cipher-algo AES256 \
            --output "$BACKUP_DIR/config/config_${DATE}.tar.gz.gpg" \
            /tmp/config_${DATE}.tar.gz
        rm /tmp/config_${DATE}.tar.gz
        log_message "Резервное копирование конфигурации завершено и зашифровано"
    else
        mv /tmp/config_${DATE}.tar.gz "$BACKUP_DIR/config/"
        log_message "Резервное копирование конфигурации завершено (не зашифровано)"
    fi

    # Очистка
    rm -rf /tmp/config_backup
}

# 5. Создание манифеста резервной копии
create_manifest() {
    log_message "Создание манифеста резервной копии..."

    cat > "$BACKUP_DIR/backup_manifest_${DATE}.txt" <<EOF
Манифест резервной копии fancai
======================================
Дата: $DATE
Хост: $(hostname)
Директория резервных копий: $BACKUP_DIR

Компоненты:
-----------
PostgreSQL: $(ls -lh $BACKUP_DIR/postgresql/bookreader_${DATE}.dump 2>/dev/null | awk '{print $5}')
Redis: $(ls -lh $BACKUP_DIR/redis/dump_${DATE}.rdb.gz 2>/dev/null | awk '{print $5}')
Хранилище: $(ls -lh $BACKUP_DIR/storage/storage_${DATE}.tar.gz 2>/dev/null | awk '{print $5}')
Конфигурация: $(ls -lh $BACKUP_DIR/config/config_${DATE}.tar.gz* 2>/dev/null | awk '{print $5}')

Статистика базы данных:
----------------------
$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
SELECT
    'Пользователей: ' || COUNT(*) FROM users
    UNION ALL
    SELECT 'Книг: ' || COUNT(*) FROM books
    UNION ALL
    SELECT 'Изображений: ' || COUNT(*) FROM generated_images;
")

Контрольные суммы (SHA256):
--------------------------
$(cd $BACKUP_DIR && find . -name "*${DATE}*" -type f -exec sha256sum {} \;)
EOF

    log_message "Манифест создан: backup_manifest_${DATE}.txt"
}

# 6. Очистка старых резервных копий
cleanup_old_backups() {
    log_message "Очистка резервных копий старше $RETENTION_DAYS дней..."

    find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -delete

    log_message "Очистка завершена"
}

# 7. Загрузка в облако (опционально)
upload_to_cloud() {
    if [ -n "$AWS_S3_BUCKET" ]; then
        log_message "Загрузка в S3..."

        aws s3 sync "$BACKUP_DIR" "s3://$AWS_S3_BUCKET/bookreader-backups/" \
            --storage-class STANDARD_IA \
            --exclude "*" \
            --include "*${DATE}*"

        log_message "Загрузка в S3 завершена"
    fi
}

# Основное выполнение
main() {
    log_message "========== Начало резервного копирования fancai =========="

    create_directories
    backup_postgresql
    backup_redis
    backup_storage
    backup_config
    create_manifest
    cleanup_old_backups
    upload_to_cloud

    log_message "========== Резервное копирование успешно завершено =========="
    log_message "Общий размер резервной копии: $(du -sh $BACKUP_DIR | cut -f1)"
}

# Запуск основной функции
main
```

#### Шаг 2: Установка прав

```bash
chmod +x scripts/backup.sh
```

#### Шаг 3: Настройка расписания с помощью Cron

```bash
# Редактировать crontab
crontab -e

# Добавить ежедневное резервное копирование в 2 часа ночи
0 2 * * * /path/to/fancai-vibe-hackathon/scripts/backup.sh

# Добавить еженедельное полное резервное копирование в воскресенье в 3 часа ночи
0 3 * * 0 /path/to/fancai-vibe-hackathon/scripts/backup.sh --full
```

#### Шаг 4: Запуск резервного копирования

```bash
# Ручное выполнение
./scripts/backup.sh

# Проверка логов
tail -f /var/log/bookreader_backup.log
```

---

### Ручное пошаговое резервное копирование

Для ручного резервного копирования или понимания процесса:

#### 1. Резервное копирование базы данных PostgreSQL

```bash
# Метод 1: Пользовательский формат (рекомендуется)
docker exec bookreader-db pg_dump \
    -U postgres \
    -d bookreader \
    -F c \
    -b \
    -v \
    -f /tmp/backup.dump

docker cp bookreader-db:/tmp/backup.dump ./bookreader_$(date +%Y-%m-%d).dump

# Метод 2: Текстовый SQL формат
docker exec bookreader-db pg_dump \
    -U postgres \
    -d bookreader \
    --clean \
    --if-exists \
    > bookreader_$(date +%Y-%m-%d).sql

# Сжать
gzip bookreader_$(date +%Y-%m-%d).sql
```

#### 2. Резервное копирование Redis

```bash
# Запустить сохранение
docker exec bookreader-redis redis-cli BGSAVE

# Подождать завершения
docker exec bookreader-redis redis-cli LASTSAVE

# Скопировать файл дампа
docker cp bookreader-redis:/data/dump.rdb ./redis_dump_$(date +%Y-%m-%d).rdb

# Сжать
gzip redis_dump_$(date +%Y-%m-%d).rdb
```

#### 3. Резервное копирование файлов хранилища

```bash
# Скопировать директорию storage
docker cp bookreader-backend:/app/storage ./storage_backup

# Создать сжатый архив
tar -czf storage_$(date +%Y-%m-%d).tar.gz storage_backup

# Очистка
rm -rf storage_backup
```

#### 4. Резервное копирование конфигурационных файлов

```bash
# Создать директорию для резервной копии
mkdir -p config_backup

# Скопировать файлы
cp docker-compose.yml config_backup/
cp .env config_backup/.env.backup
cp -r nginx/ config_backup/ 2>/dev/null || true

# Архивировать и зашифровать
tar -czf config_$(date +%Y-%m-%d).tar.gz config_backup
gpg --symmetric --cipher-algo AES256 config_$(date +%Y-%m-%d).tar.gz

# Очистка
rm -rf config_backup
rm config_$(date +%Y-%m-%d).tar.gz
```

#### 5. Проверка файлов резервной копии

```bash
# Проверить размеры файлов
ls -lh *.dump *.tar.gz *.rdb.gz

# Сгенерировать контрольные суммы
sha256sum *.dump *.tar.gz *.rdb.gz > backup_checksums_$(date +%Y-%m-%d).txt
```

---

## Процедуры восстановления

### Полное восстановление системы

Полное восстановление системы из резервной копии (сценарий аварийного восстановления).

#### Предварительные требования

- Новый сервер или VM с установленным Docker
- Доступ к файлам резервных копий
- Учетные данные базы данных
- SSL сертификаты (если применимо)

#### Шаг 1: Подготовка окружения

```bash
# Создать директорию проекта
mkdir -p /opt/bookreader-ai
cd /opt/bookreader-ai

# Клонировать репозиторий
git clone <repository-url> .

# Создать директории storage
mkdir -p storage/{books,images,covers}
mkdir -p logs
```

#### Шаг 2: Восстановление конфигурации

```bash
# Расшифровать и извлечь конфигурацию
gpg --decrypt config_backup.tar.gz.gpg > config_backup.tar.gz
tar -xzf config_backup.tar.gz

# Скопировать файлы в правильные расположения
cp config_backup/docker-compose.yml .
cp config_backup/.env.backup .env
cp -r config_backup/nginx/ nginx/ 2>/dev/null || true
```

#### Шаг 3: Запуск контейнера базы данных

```bash
# Запустить только PostgreSQL
docker-compose up -d db

# Подождать готовности PostgreSQL
sleep 10
```

#### Шаг 4: Восстановление базы данных PostgreSQL

```bash
# Метод 1: Из пользовательского формата дампа
docker cp bookreader_backup.dump bookreader-db:/tmp/
docker exec bookreader-db pg_restore \
    -U postgres \
    -d postgres \
    -c \
    -C \
    -v \
    /tmp/bookreader_backup.dump

# Метод 2: Из SQL файла
gunzip bookreader_backup.sql.gz
docker exec -i bookreader-db psql -U postgres < bookreader_backup.sql

# Проверить восстановление
docker exec bookreader-db psql -U postgres -d bookreader -c "
    SELECT 'Пользователей: ' || COUNT(*) FROM users
    UNION ALL
    SELECT 'Книг: ' || COUNT(*) FROM books;
"
```

#### Шаг 5: Восстановление Redis

```bash
# Остановить Redis, если запущен
docker-compose stop redis

# Скопировать файл резервной копии
gunzip redis_dump_backup.rdb.gz
docker cp redis_dump_backup.rdb bookreader-redis:/data/dump.rdb

# Установить права
docker exec bookreader-redis chown redis:redis /data/dump.rdb

# Запустить Redis
docker-compose start redis
```

#### Шаг 6: Восстановление файлов хранилища

```bash
# Извлечь резервную копию storage
tar -xzf storage_backup.tar.gz

# Скопировать в контейнер
docker cp storage_backup bookreader-backend:/app/storage

# Установить права
docker exec bookreader-backend chown -R app:app /app/storage
```

#### Шаг 7: Запуск всех сервисов

```bash
# Запустить все контейнеры
docker-compose up -d

# Проверить логи
docker-compose logs -f

# Проверить сервисы
curl http://localhost:8000/api/v1/health
```

#### Шаг 8: Проверка восстановления

```bash
# Запустить скрипт проверки
./scripts/verify_restore.sh

# Ручные проверки:
# 1. Войти в веб-интерфейс
# 2. Проверить библиотеку книг
# 3. Протестировать генерацию изображений
# 4. Проверить прогресс чтения
```

---

### Частичное восстановление

Восстановление определенных компонентов без влияния на остальные.

#### Восстановление только базы данных

```bash
# Резервная копия текущей базы данных (для безопасности)
docker exec bookreader-db pg_dump -U postgres -d bookreader -F c > current_backup.dump

# Восстановление из резервной копии
docker exec -i bookreader-db pg_restore \
    -U postgres \
    -d bookreader \
    -c \
    -v \
    /tmp/bookreader_backup.dump

# Если восстановление не удалось, откатить:
# docker exec -i bookreader-db pg_restore -U postgres -d bookreader current_backup.dump
```

#### Восстановление только файлов хранилища

```bash
# Остановить backend, чтобы избежать блокировок файлов
docker-compose stop backend celery-worker

# Резервная копия текущего storage
docker cp bookreader-backend:/app/storage ./storage_current_backup

# Восстановление из резервной копии
tar -xzf storage_backup.tar.gz
docker cp storage_backup bookreader-backend:/app/storage

# Запустить сервисы
docker-compose start backend celery-worker
```

#### Восстановление только Redis

```bash
# Остановить Redis
docker-compose stop redis

# Резервная копия текущих данных Redis
docker cp bookreader-redis:/data/dump.rdb ./redis_current_backup.rdb

# Восстановление из резервной копии
gunzip redis_dump_backup.rdb.gz
docker cp redis_dump_backup.rdb bookreader-redis:/data/dump.rdb

# Запустить Redis
docker-compose start redis
```

#### Восстановление одной таблицы (PostgreSQL)

```bash
# Экспорт определенной таблицы из резервной копии
pg_restore -U postgres \
    -d bookreader \
    -t users \
    --clean \
    bookreader_backup.dump

# Или используя SQL дамп:
psql -U postgres -d bookreader << EOF
BEGIN;
TRUNCATE TABLE users CASCADE;
\i users_table_backup.sql
COMMIT;
EOF
```

---

## Рекомендации по расписанию резервного копирования

### Production окружение

| Тип резервной копии | Частота | Хранение | Место хранения |
|---------------------|---------|----------|----------------|
| **Полная система** | Еженедельно (Вс 3:00) | 4 недели | Локально + Облако |
| **База данных** | Ежедневно (2:00) | 7 дней локально, 30 дней облако | Локально + Облако |
| **Файлы хранилища** | Ежедневно (3:00) | 7 дней локально, 30 дней облако | Локально + Облако |
| **Конфигурация** | При изменении | 10 версий | Git + Облако |
| **Redis** | Ежедневно (2:30) | 3 дня | Только локально |
| **Логи** | Непрерывно | 30 дней | Локально + Облако |

### Development/Staging окружение

| Тип резервной копии | Частота | Хранение | Место хранения |
|---------------------|---------|----------|----------------|
| **База данных** | Ежедневно (3:00) | 3 дня | Только локально |
| **Файлы хранилища** | Еженедельно | 2 недели | Только локально |
| **Конфигурация** | При изменении | 5 версий | Только Git |

### Критические окна резервного копирования

**Рекомендуемое время для резервного копирования:**
- **02:00 - 04:00** - Период наименьшего трафика
- **Воскресенье 03:00** - Полное резервное копирование системы
- **Перед развертыванием** - Снимок перед развертыванием
- **После крупных обновлений** - Проверочная резервная копия после обновления

---

## Проверка целостности резервных копий

### Скрипт автоматической проверки

Создайте файл: `scripts/verify_backup.sh`

```bash
#!/bin/bash

# Скрипт проверки резервных копий
# Проверяет целостность и возможность восстановления резервных копий

BACKUP_FILE=$1
BACKUP_TYPE=$2

verify_postgresql_backup() {
    echo "Проверка резервной копии PostgreSQL..."

    # Тестовое восстановление во временную базу данных
    docker exec bookreader-db createdb -U postgres test_restore
    docker exec bookreader-db pg_restore \
        -U postgres \
        -d test_restore \
        /tmp/backup.dump \
        2>&1 | grep -i error

    # Проверка количества таблиц
    docker exec bookreader-db psql -U postgres -d test_restore -c "
        SELECT COUNT(*) as total_tables
        FROM information_schema.tables
        WHERE table_schema = 'public';
    "

    # Очистка
    docker exec bookreader-db dropdb -U postgres test_restore

    echo "Резервная копия PostgreSQL успешно проверена"
}

verify_storage_backup() {
    echo "Проверка резервной копии хранилища..."

    # Тест извлечения
    tar -tzf "$BACKUP_FILE" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "Архив хранилища валиден"

        # Подсчет файлов
        file_count=$(tar -tzf "$BACKUP_FILE" | wc -l)
        echo "Файлов в архиве: $file_count"
    else
        echo "ОШИБКА: Архив хранилища поврежден"
        exit 1
    fi
}

verify_redis_backup() {
    echo "Проверка резервной копии Redis..."

    # Проверка целостности RDB файла
    gunzip -c "$BACKUP_FILE" | docker exec -i bookreader-redis redis-check-rdb - > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "Резервная копия Redis валидна"
    else
        echo "ОШИБКА: Резервная копия Redis повреждена"
        exit 1
    fi
}

# Основная проверка
case "$BACKUP_TYPE" in
    postgresql)
        verify_postgresql_backup
        ;;
    storage)
        verify_storage_backup
        ;;
    redis)
        verify_redis_backup
        ;;
    *)
        echo "Неизвестный тип резервной копии: $BACKUP_TYPE"
        exit 1
        ;;
esac
```

### Шаги ручной проверки

#### 1. Проверка целостности файлов

```bash
# Проверка контрольных сумм
sha256sum -c backup_checksums.txt

# Проверка размеров файлов (не должны быть 0)
ls -lh backup_*

# Тест извлечения архива
tar -tzf storage_backup.tar.gz > /dev/null
gunzip -t redis_dump.rdb.gz
```

#### 2. Тест восстановления базы данных

```bash
# Создать тестовую базу данных
docker exec bookreader-db createdb -U postgres test_restore

# Попытка восстановления
docker exec bookreader-db pg_restore \
    -U postgres \
    -d test_restore \
    /tmp/backup.dump

# Проверка данных
docker exec bookreader-db psql -U postgres -d test_restore -c "
    SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

# Очистка
docker exec bookreader-db dropdb -U postgres test_restore
```

#### 3. Проверка полноты резервной копии

```bash
# Проверка файла манифеста
cat backup_manifest_*.txt

# Проверка наличия всех компонентов
ls -1 backups/postgresql/
ls -1 backups/redis/
ls -1 backups/storage/
ls -1 backups/config/
```

---

## Лучшие практики

### 1. Лучшие практики безопасности

**Шифрование конфиденциальных резервных копий:**
```bash
# Шифрование с помощью GPG
gpg --symmetric --cipher-algo AES256 backup.tar.gz

# Расшифровка при необходимости
gpg --decrypt backup.tar.gz.gpg > backup.tar.gz
```

**Безопасные права доступа к хранилищу:**
```bash
# Ограничить доступ к директории резервных копий
chmod 700 /var/backups/bookreader
chown root:root /var/backups/bookreader

# Шифровать учетные данные базы данных в скриптах
# Использовать переменные окружения или управление секретами
```

**Никогда не коммитить конфиденциальные данные:**
```bash
# Добавить в .gitignore
echo "*.dump" >> .gitignore
echo "*.sql" >> .gitignore
echo "*.env.backup" >> .gitignore
echo "backups/" >> .gitignore
```

### 2. Лучшие практики хранения

**Использовать несколько мест хранения:**
- Локальный диск (немедленное восстановление)
- Сетевое хранилище (NAS/SAN)
- Облачное хранилище (аварийное восстановление)

**Реализовать политики жизненного цикла:**
```bash
# Пример S3 lifecycle
aws s3api put-bucket-lifecycle-configuration \
    --bucket bookreader-backups \
    --lifecycle-configuration file://lifecycle.json
```

lifecycle.json:
```json
{
  "Rules": [
    {
      "Id": "Перемещение в Glacier через 30 дней",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 365
      }
    }
  ]
}
```

### 3. Лучшие практики тестирования

**Регулярное тестирование восстановления:**
- Тест полного восстановления ежеквартально
- Тест частичного восстановления ежемесячно
- Документировать время восстановления и проблемы

**Учения по аварийному восстановлению:**
- Симулировать полный сбой системы
- Практиковать процедуры восстановления
- Обновлять документацию на основе результатов

### 4. Лучшие практики мониторинга

**Настройка мониторинга резервного копирования:**
```bash
# Создать скрипт мониторинга
cat > /usr/local/bin/check_backup_status.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/var/backups/bookreader"
MAX_AGE_HOURS=26  # 1 день + 2 часа буфер

latest_backup=$(find $BACKUP_DIR -name "*.dump" -mmin -$((MAX_AGE_HOURS * 60)) | wc -l)

if [ $latest_backup -eq 0 ]; then
    echo "ВНИМАНИЕ: Не найдено недавних резервных копий!"
    # Отправить оповещение (email, Slack и т.д.)
    exit 1
else
    echo "OK: Недавняя резервная копия существует"
    exit 0
fi
EOF

chmod +x /usr/local/bin/check_backup_status.sh

# Добавить в cron для мониторинга
echo "0 */4 * * * /usr/local/bin/check_backup_status.sh" | crontab -
```

### 5. Лучшие практики документации

**Ведение логов резервного копирования:**
- Записывать все операции резервного копирования
- Логировать действия по хранению и удалению
- Документировать любые попытки восстановления

**Поддерживать актуальность процедур восстановления:**
- Обновлять после любых изменений инфраструктуры
- Включать контактную информацию для чрезвычайных ситуаций
- Документировать уроки, извлеченные из тестов восстановления

---

## Устранение неполадок

### Распространенные проблемы резервного копирования

#### 1. Сбой скрипта резервного копирования

**Проблема:** Скрипт резервного копирования завершается с ошибками

**Решения:**
```bash
# Проверить место на диске
df -h /var/backups

# Проверить статус Docker контейнеров
docker-compose ps

# Проверить подключение к базе данных
docker exec bookreader-db pg_isready -U postgres

# Просмотреть логи
tail -100 /var/log/bookreader_backup.log
```

#### 2. Сбой резервного копирования PostgreSQL

**Проблема:** pg_dump возвращает ошибки

**Решения:**
```bash
# Проверить совместимость версии PostgreSQL
docker exec bookreader-db psql -U postgres -c "SELECT version();"

# Проверить существование базы данных
docker exec bookreader-db psql -U postgres -l

# Проверить права пользователя
docker exec bookreader-db psql -U postgres -c "\du"

# Проверить подключение
docker exec bookreader-db pg_dump -U postgres -d bookreader --schema-only
```

#### 3. Слишком большие резервные копии хранилища

**Проблема:** Резервные копии хранилища потребляют слишком много места

**Решения:**
```bash
# Анализ использования storage
docker exec bookreader-backend du -sh /app/storage/*

# Идентификация больших файлов
docker exec bookreader-backend find /app/storage -type f -size +100M

# Реализация сжатия
tar -czf storage_backup.tar.gz --use-compress-program=pigz storage/

# Рассмотрение инкрементных резервных копий с rsync
rsync -av --link-dest=/var/backups/bookreader/storage/latest \
    storage/ /var/backups/bookreader/storage/$(date +%Y-%m-%d)/
```

#### 4. Неполная резервная копия Redis

**Проблема:** Файл Redis dump.rdb имеет размер 0 байт или поврежден

**Решения:**
```bash
# Проверить конфигурацию Redis
docker exec bookreader-redis redis-cli CONFIG GET save

# Вручную запустить сохранение
docker exec bookreader-redis redis-cli SAVE

# Проверить логи Redis
docker logs bookreader-redis

# Проверить RDB файл
docker exec bookreader-redis redis-check-rdb /data/dump.rdb
```

### Распространенные проблемы восстановления

#### 1. Сбой восстановления базы данных

**Проблема:** pg_restore возвращает ошибки

**Решения:**
```bash
# Проверить целостность файла резервной копии
pg_restore --list backup.dump | head

# Восстановление без удаления существующих объектов
pg_restore -U postgres -d bookreader --clean --if-exists backup.dump

# Восстановление только определенной схемы
pg_restore -U postgres -d bookreader -n public backup.dump

# Пропуск ошибок и продолжение
pg_restore -U postgres -d bookreader --exit-on-error backup.dump
```

#### 2. Проблемы с правами после восстановления

**Проблема:** Приложение не может получить доступ к восстановленным файлам

**Решения:**
```bash
# Исправить права storage
docker exec bookreader-backend chown -R app:app /app/storage
docker exec bookreader-backend chmod -R 755 /app/storage

# Исправить права базы данных
docker exec bookreader-db psql -U postgres -d bookreader -c "
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bookreader_user;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bookreader_user;
"
```

#### 3. Восстановленная система не работает

**Проблема:** Сервисы запускаются, но приложение не работает корректно

**Чек-лист:**
```bash
# 1. Проверить версию схемы базы данных
docker exec bookreader-db psql -U postgres -d bookreader -c "SELECT version FROM alembic_version;"

# Запустить миграции при необходимости
docker exec bookreader-backend alembic upgrade head

# 2. Проверить переменные окружения
docker exec bookreader-backend env | grep -E 'DATABASE_URL|REDIS_URL'

# 3. Проверить подключение к Redis
docker exec bookreader-backend redis-cli -h redis ping

# 4. Проверить логи приложения
docker logs bookreader-backend --tail 100

# 5. Протестировать API endpoints
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/books
```

---

## Контакты и поддержка

Для помощи по резервному копированию и восстановлению:

- **Документация:** `/docs/operations/`
- **Логи резервного копирования:** `/var/log/bookreader_backup.log`
- **Поддержка:** devops@bookreader-ai.com
- **Экстренная связь:** +1-XXX-XXX-XXXX

---

## Приложение

### A. Соглашение об именовании файлов резервных копий

```
Формат: <компонент>_<дата>_<время>[_<тип>].<расширение>

Примеры:
- bookreader_2025-10-24_02-00-00.dump
- storage_2025-10-24_03-00-00_full.tar.gz
- redis_dump_2025-10-24_02-30-00.rdb.gz
- config_2025-10-24_encrypted.tar.gz.gpg
```

### B. Оценка размеров резервных копий

| Компонент | Малый сайт | Средний сайт | Большой сайт |
|-----------|------------|--------------|--------------|
| База данных | 100 MB | 1 GB | 10 GB |
| Хранилище | 1 GB | 50 GB | 500 GB |
| Redis | 10 MB | 100 MB | 1 GB |
| Конфигурация | 5 MB | 5 MB | 5 MB |
| **Итого** | **~1 GB** | **~51 GB** | **~511 GB** |

### C. Целевые показатели восстановления

| Сценарий | RTO (Целевое время восстановления) | RPO (Целевая точка восстановления) |
|----------|------------------------------------|------------------------------------|
| Повреждение базы данных | 1 час | Последняя ежедневная копия (24ч) |
| Потеря хранилища | 2 часа | Последняя ежедневная копия (24ч) |
| Полный сбой системы | 4 часа | Последняя еженедельная копия (168ч) |
| Восстановление одного файла | 15 минут | Последняя ежедневная копия (24ч) |

---

**Версия документа:** 1.0
**Последнее обновление:** 2025-10-24
**Дата следующего пересмотра:** 2025-11-24
