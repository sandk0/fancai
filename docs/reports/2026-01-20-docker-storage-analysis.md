# Отчёт: Анализ Docker и Хранения Данных — fancai

## Дата: 20 января 2026

---

## 1. Обзор Текущей Ситуации

### 1.1 Инцидент, который привёл к анализу

При проверке страницы "Изображения" обнаружены 404 ошибки:
- `imagen_20260118_002948_86924df5.png` — запись в БД есть, файла нет
- `imagen_20260114_174135_cdb6bade.png` — запись в БД есть, файла нет

**Вывод:** Файлы были потеряны при каком-то этапе работы с контейнерами.

---

## 2. Критические Проблемы

### 🔴 КРИТИЧНО #1: Несогласованность Storage между Dev и Prod

| Конфигурация | Файл | Тип Mount | Проблема |
|-------------|------|-----------|----------|
| **Dev (текущий)** | `docker-compose.lite.yml` | Named Volume: `uploaded_books:/app/storage` | ✅ Правильно |
| **Prod** | `docker-compose.lite.prod.yml` | Bind Mount: `./backend/storage:/app/storage` | ⚠️ Отличается |

**Риск:** При миграции с dev на prod все данные из named volume будут недоступны!

```yaml
# docker-compose.lite.yml (DEV) - строка 132
volumes:
  - uploaded_books:/app/storage   # Named volume

# docker-compose.lite.prod.yml (PROD) - строка 139
volumes:
  - ./backend/storage:/app/storage  # Bind mount
```

---

### 🔴 КРИТИЧНО #2: Backup скрипт не работает с Named Volumes

[backup.sh](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/scripts/backup.sh#L230-L270):
```bash
backup_storage_files() {
    local storage_source="${PROJECT_ROOT}/backend/storage"  # ❌ Ищет в bind mount
    # ...
    cp -r "${storage_source}"/* "${storage_backup_dir}/"    # ❌ Не найдёт файлы из named volume!
}
```

**Реальное расположение данных:**
- Named volume: `/var/lib/docker/volumes/fancai-vibe-hackathon_uploaded_books/_data/`
- Предполагаемое скриптом: `/root/fancai-vibe-hackathon/backend/storage/` (пустой!)

---

### 🟠 ВАЖНО #3: Отсутствует CI/CD Pipeline

В `.github/workflows_disabled/` — все workflows отключены:
- Нет автоматических тестов перед деплоем
- Нет автоматического backup перед обновлением
- Ручной деплой через SSH подвержен ошибкам

---

### 🟠 ВАЖНО #4: Docker Volume не имеет внешнего backup

На сервере сейчас:
```
/var/lib/docker/volumes/fancai-vibe-hackathon_uploaded_books/_data/
├── books/          # Загруженные книги
└── generated_images/   # 233 файла, ~380MB
```

**Проблема:** При `docker system prune` или пересоздании без флага volume данные будут потеряны!

---

### 🟡 ПРЕДУПРЕЖДЕНИЕ #5: Конфликт прав доступа в Dockerfile

[Dockerfile.lite.prod](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backend/Dockerfile.lite.prod#L70-L74):
```dockerfile
RUN mkdir -p /app/storage/books /app/storage/images ... && \
    chmod -R 777 /app/storage /app/uploads /app/logs
```

При mount volume поверх этой директории:
- Права могут не сохраниться
- Владелец может не совпадать с `appuser`

---

## 3. Анализ Лучших Практик DevOps 2024-2025

> [!NOTE]
> Основано на исследовании Docker best practices, immutable infrastructure, cloud-native patterns.

### 3.1 Named Volumes vs Bind Mounts

| Аспект | Named Volume | Bind Mount |
|--------|--------------|------------|
| **Рекомендация** | ✅ Production | ⚠️ Development |
| **Изоляция** | Высокая | Низкая |
| **Backup** | Требует специальных команд | Простое копирование |
| **Производительность** | Высокая (особенно на macOS) | Зависит от FS |
| **Безопасность** | Изолирован от хоста | Прямой доступ к хосту |

**Вывод:** Проект правильно использует named volumes в dev, нужно согласовать prod.

### 3.2 Современный подход к Storage

```
┌─────────────────────────────────────────────────────────────┐
│                    Production Architecture                   │
│                                                              │
│  ┌─────────┐     ┌─────────────┐     ┌─────────────────┐   │
│  │ Backend │────▶│ Named Volume│────▶│ S3/MinIO/NFS   │   │
│  └─────────┘     └─────────────┘     │ (External)      │   │
│                         │            └─────────────────┘   │
│                         │                    │              │
│                         ▼                    ▼              │
│                  ┌─────────────┐     ┌─────────────────┐   │
│                  │ Docker Host │     │ Backup Service  │   │
│                  │ /var/lib/...│     │ (Cron + S3)     │   │
│                  └─────────────┘     └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Ключевые Практики

1. **Immutable Infrastructure** — контейнеры не модифицируются после деплоя
2. **Data Persistence Decoupling** — данные отделены от контейнеров
3. **Automated Backups** — ежедневные backup с retention policy
4. **Monitoring** — мониторинг использования volumes
5. **GitOps** — все конфигурации в Git, CI/CD автоматизация

---

## 4. План Доработок

### Фаза 1: Критические исправления (до релиза)

#### 1.1 Унифицировать Storage между Dev и Prod

```yaml
# НОВЫЙ подход: использовать named volumes везде
# docker-compose.lite.prod.yml
volumes:
  - storage_data:/app/storage  # Named volume, не bind mount!

volumes:
  storage_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/fancai/storage  # Постоянная директория на хосте
```

> [!IMPORTANT]
> Перед миграцией скопировать данные из текущего named volume!

#### 1.2 Исправить backup.sh для работы с Named Volumes

```bash
backup_storage_files() {
    local storage_backup_dir="${BACKUP_PATH}/storage"
    mkdir -p "${storage_backup_dir}"
    
    # Получить данные из Docker volume
    local volume_name="fancai-vibe-hackathon_uploaded_books"
    
    docker run --rm \
        -v "${volume_name}:/source:ro" \
        -v "${storage_backup_dir}:/backup" \
        alpine tar czf /backup/storage.tar.gz -C /source .
    
    print_success "Storage backup from volume: $(du -sh ${storage_backup_dir}/storage.tar.gz)"
}
```

#### 1.3 Создать скрипт миграции данных

```bash
#!/bin/bash
# migrate-storage.sh
# Переносит данные из named volume в bind mount

SRC_VOLUME="fancai-vibe-hackathon_uploaded_books"
DEST_DIR="/data/fancai/storage"

mkdir -p "$DEST_DIR"
docker run --rm \
    -v "${SRC_VOLUME}:/source:ro" \
    -v "${DEST_DIR}:/dest" \
    alpine sh -c "cp -a /source/* /dest/"
```

---

### Фаза 2: Автоматизация (неделя 1-2)

#### 2.1 Настроить автоматический backup

```yaml
# docker-compose.lite.prod.yml - добавить сервис
backup:
  image: alpine:latest
  volumes:
    - storage_data:/data/storage:ro
    - ./backups:/backups
  command: |
    sh -c "
      while true; do
        tar czf /backups/storage-$(date +%Y%m%d).tar.gz -C /data/storage .
        find /backups -name 'storage-*.tar.gz' -mtime +7 -delete
        sleep 86400
      done
    "
  restart: unless-stopped
```

#### 2.2 Включить CI/CD

Активировать `.github/workflows/`:
- `deploy.yml` — автоматический деплой при push в main
- `backup.yml` — ежедневный backup cron job
- `health-check.yml` — проверка здоровья после деплоя

---

### Фаза 3: Мониторинг и Observability (неделя 2-3)

#### 3.1 Добавить мониторинг volumes

```yaml
# docker-compose.monitoring.yml
node-exporter:
  image: prom/node-exporter
  volumes:
    - /:/host:ro
  command:
    - '--path.rootfs=/host'
    - '--collector.filesystem.mount-points-exclude=^/(dev|proc|sys|run)'
```

#### 3.2 Alerting на переполнение

```yaml
# prometheus/alerts/storage.yml
groups:
  - name: storage
    rules:
      - alert: StorageSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 5m
        labels:
          severity: critical
```

---

### Фаза 4: External Storage (опционально, после релиза)

Для масштабирования рассмотреть:

| Решение | Плюсы | Минусы |
|---------|-------|--------|
| **MinIO (S3-compatible)** | Self-hosted, бесплатный | Нужен отдельный сервер |
| **AWS S3** | Масштабируемость, надёжность | Стоимость, зависимость |
| **NFS Volume** | Простота | Single point of failure |

---

## 5. Чек-лист Перед Релизом

- [ ] Проверить, что все named volumes имеют backup
- [ ] Синхронизировать docker-compose dev и prod конфигурации
- [ ] Протестировать процедуру восстановления из backup
- [ ] Настроить автоматический backup (минимум ежедневный)
- [ ] Создать документацию по восстановлению данных
- [ ] Добавить healthcheck для проверки доступности storage
- [ ] Исправить backup.sh для работы с named volumes

---

## 6. Рекомендуемая Архитектура Storage

```
/data/fancai/                    # Постоянное хранилище на хосте
├── storage/
│   ├── books/                   # EPUB/FB2 файлы
│   ├── generated_images/        # AI-сгенерированные изображения
│   └── covers/                  # Обложки книг
├── backups/
│   ├── daily/                   # Ежедневные бэкапы (7 дней)
│   ├── weekly/                  # Еженедельные (4 недели)
│   └── monthly/                 # Ежемесячные (3 месяца)
└── postgres/                    # PostgreSQL data (отдельный volume)
```

---

## 7. Заключение

> [!CAUTION]
> Текущая конфигурация имеет риск потери данных при переключении между dev и prod compose файлами!

**Приоритеты:**
1. **СРОЧНО:** Исправить backup.sh и создать резервную копию
2. **ДО РЕЛИЗА:** Унифицировать storage конфигурацию
3. **ПОСЛЕ РЕЛИЗА:** Автоматизация, мониторинг, CI/CD

---

## Связанные Файлы

- [docker-compose.lite.yml](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/docker-compose.lite.yml)
- [docker-compose.lite.prod.yml](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/docker-compose.lite.prod.yml)
- [backup.sh](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/scripts/backup.sh)
- [Dockerfile.lite.prod](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backend/Dockerfile.lite.prod)
