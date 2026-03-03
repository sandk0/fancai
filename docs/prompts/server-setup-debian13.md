# Задача

Ты — опытный DevOps-инженер и Linux-администратор. Я получил SSH-доступ к новому VPS-серверу
и нужна первичная настройка и подготовка к деплою проекта fancai (fiction reader с AI-иллюстрациями
и интерактивным глоссарием).

## Что уже установлено на сервере

- **ОС:** Debian 13 (trixie), чистая установка
- **Docker:** последняя стабильная версия (установлен из официального репозитория Docker)
- **Пакеты:** репозитории обновлены, базовые пакеты обновлены (`apt update && apt upgrade`)
- **Доступ:** root по SSH (пароль), публичный IPv4

## Характеристики сервера

- **CPU:** 12 vCPU (AMD EPYC 9755, 4 GHz)
- **RAM:** 32 GB DDR5
- **Диск:** 100 GB NVMe SSD
- **Провайдер:** netcup.com
- **Домен:** fancai.ru (DNS уже направлен на IP сервера)

## Стек проекта (что будет деплоиться)

### Docker-сервисы (docker-compose):

| Сервис        | Образ                                       | RAM лимит | Назначение                                          |
| ------------- | ------------------------------------------- | --------- | --------------------------------------------------- |
| postgres      | postgres:17.9-alpine                        | 4-8 GB    | БД (asyncpg + SQLAlchemy)                           |
| redis         | redis:7.4-alpine                            | 768 MB    | Кэш + Celery broker/result + rate limiter + pub/sub |
| backend       | python:3.12-slim (Gunicorn + UvicornWorker) | 2-3 GB    | FastAPI API                                         |
| celery-worker | python:3.12-slim                            | 2.5 GB    | Фоновые задачи (AI extraction, image gen)           |
| celery-beat   | python:3.12-slim                            | 256 MB    | Периодические задачи                                |
| frontend      | node:22-alpine → nginx:1.27-alpine          | 256 MB    | React SPA (static)                                  |
| backup        | alpine:latest                               | 64 MB     | Ежедневный backup storage                           |

### Планируемые дополнительные сервисы:

- **Caddy v2** (заменит nginx как reverse proxy, auto-HTTPS Let's Encrypt + ZeroSSL)
- **Netdata v2** — мониторинг сервера (CPU, RAM, диск, сеть)
- **Uptime Kuma v2** — мониторинг uptime + алерты
- **Dozzle v9** — просмотр Docker-логов через веб
- **Grafana + Prometheus + Loki** (опционально, уже есть compose-файл)

### Ключевые технологии:

- Python 3.12, FastAPI, Celery 5.6, SQLAlchemy 2.0 (async)
- React 19, TypeScript 5.7, Vite 7
- PostgreSQL 17 (нужна оптимизация под 32 GB RAM)
- Redis 7.4 (4 роли: cache, broker, rate limiter, pub/sub)
- AI: Google Gemini 3.0 Flash + Imagen 4 (планируется миграция на OpenRouter)
- Мониторинг ошибок: Hawk Tracker (hawk-tracker.ru)
- Email: Yandex Cloud Postbox (SES-совместимый, aioboto3)

## Требования к настройке

### 1. Исследование и актуальные практики (ОБЯЗАТЕЛЬНО)

Перед выполнением настройки проведи глубокое исследование:

- **Debian 13 (trixie):** специфика этого релиза, отличия от Debian 12, новые возможности ядра,
  рекомендации по настройке, известные issues на март 2026
- **Безопасность Linux 2026:** актуальные best practices по hardening серверов, новые угрозы,
  рекомендации CIS Benchmark для Debian 13, актуальные CVE
- **Docker на Debian 13:** оптимальная конфигурация Docker Engine, storage driver (overlay2 vs
  btrfs на NVMe), live-restore, logging, cgroup v2
- **Сетевая безопасность:** nftables (не iptables!), fail2ban актуальная версия, SSH hardening
- **Файловые системы:** ext4 vs btrfs для NVMe SSD на Debian 13, оптимальные mount options
- **Systemd:** актуальные возможности systemd в Debian 13, hardening юнитов
- **PostgreSQL 17 tuning:** оптимальные параметры для 32 GB DDR5 + 12 vCPU + NVMe
  (shared_buffers, effective_cache_size, huge_pages, wal_compression=zstd)

### 2. Безопасность сервера (Security Hardening)

#### SSH:

- Создать непривилегированного пользователя (например `deploy`) с sudo
- Настроить SSH-ключи (Ed25519), отключить вход по паролю
- Отключить root login по SSH
- Изменить порт SSH (или оставить 22 с port knocking — обоснуй выбор)
- Настроить `sshd_config` по best practices 2026:
  - AllowUsers, MaxAuthTries, LoginGraceTime
  - ClientAliveInterval / ClientAliveCountMax
  - Только современные алгоритмы (Ed25519, ChaCha20-Poly1305)
- Настроить SSH banner

#### Firewall (nftables):

- Базовые правила: разрешить SSH (новый порт), HTTP (80), HTTPS (443)
- Заблокировать всё остальное входящее
- Rate limiting на SSH (защита от brute force)
- Разрешить Docker-подсети
- Логирование заблокированных пакетов

#### fail2ban:

- Защита SSH
- Настроить jail для повторных неудачных попыток
- Email/Telegram уведомления (опционально)

#### Дополнительно:

- Настроить automatic security updates (unattended-upgrades) для Debian 13
- Отключить ненужные сервисы
- Настроить `sysctl.conf` для сетевой безопасности и производительности
- Проверить и настроить AppArmor (в Debian 13 по умолчанию)

### 3. Системные настройки и оптимизация

#### Ядро и sysctl:

```
# Сеть
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5

# Безопасность
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Память (для PostgreSQL + Redis + Docker)
vm.overcommit_memory = 1  # Для Redis
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# Huge Pages (для PostgreSQL на DDR5)
vm.nr_hugepages = <рассчитать для shared_buffers=8GB>
```

- Проверь и дополни эти значения по актуальным рекомендациям для Debian 13 / Linux 6.x ядра
- Обоснуй каждый параметр

#### Лимиты (limits.conf / systemd):

- Настроить ulimits для Docker-контейнеров (nofile, nproc)
- Оптимальные значения для PostgreSQL и Redis

#### Swap:

- Нужен ли swap на 32 GB RAM? Обоснуй решение
- Если да — какой размер, swap file vs partition, приоритет

#### Время и локаль:

- Настроить NTP (systemd-timesyncd или chrony — обоснуй выбор)
- Часовой пояс: Europe/Moscow
- Локаль: en_US.UTF-8 + ru_RU.UTF-8

### 4. Docker оптимизация

#### daemon.json:

- Storage driver: overlay2 (обоснуй или предложи альтернативу для NVMe)
- Log driver: json-file с ротацией (max-size, max-file) — или journald (обоснуй)
- live-restore: true
- Default ulimits для контейнеров
- DNS настройки
- Metrics для Prometheus
- cgroup driver: systemd (cgroup v2 на Debian 13)
- Default address pools для Docker networks
- Userns-remap (если рекомендуется — обоснуй)

#### Docker Compose:

- Версия Compose (standalone vs plugin — что актуально в 2026)
- Рекомендации по организации compose-файлов

#### Прочее:

- Настроить logrotate для Docker-логов
- Чистка: настроить автоматический `docker system prune`
- Оптимизация build cache

### 5. Подготовка файловой системы

#### Структура директорий:

```
/opt/fancai/                    # Корень проекта
├── docker-compose.yml          # Основной compose
├── docker-compose.monitoring.yml
├── .env                        # Переменные окружения
├── backend/
├── frontend/
├── caddy/
│   └── Caddyfile
├── postgres/
│   └── postgresql.conf         # Кастомная конфигурация PG
├── redis/
│   └── redis.conf
├── backups/
│   ├── db/                     # PostgreSQL дампы
│   └── storage/                # Файлы пользователей
├── ssl/                        # Если нужны manual certs
└── logs/                       # Внешние логи (если нужно)
```

- Предложи оптимальную структуру и обоснуй
- Настроить permissions (какой пользователь владеет чем)
- Mount options для /opt (noatime, etc.)

#### Backup:

- Директория для бэкапов
- Cron/systemd timer для ежедневных бэкапов PostgreSQL (`pg_dump`)
- Ротация бэкапов (7 дней локально)
- Backup на внешнее хранилище (рекомендации)

### 6. Мониторинг системного уровня

- Настроить базовый мониторинг ДО деплоя приложения:
  - Disk usage alerts (>80%)
  - Memory usage
  - CPU load
  - Docker daemon health
- Рекомендации: через systemd timers + простой скрипт, или Netdata сразу

### 7. Подготовка к деплою

#### Checklist перед первым деплоем:

- [ ] SSH hardened, root отключён
- [ ] Firewall настроен (nftables)
- [ ] fail2ban активен
- [ ] Docker daemon настроен и оптимизирован
- [ ] Структура директорий создана
- [ ] .env файл подготовлен (шаблон)
- [ ] PostgreSQL конфигурация для 32 GB
- [ ] Redis конфигурация
- [ ] Backup настроен
- [ ] NTP синхронизация
- [ ] Automatic security updates
- [ ] sysctl оптимизация
- [ ] Swap настроен (если нужен)
- [ ] DNS resolving работает
- [ ] Домен fancai.ru резолвится на сервер

## Формат ответа

### Структура:

1. **Результаты исследования** — краткое summary актуальных практик для Debian 13 / Linux
   на март 2026, что нового и важного

2. **Пошаговая инструкция** — каждый шаг в формате:

   ````
   ### Шаг N: Название
   **Зачем:** обоснование
   **Команды:**
   ```bash
   # команды с комментариями
   ````

   **Проверка:**

   ```bash
   # как убедиться что всё работает
   ```

   ```

   ```

3. **Конфигурационные файлы** — полные файлы конфигурации, готовые к копированию:
   - `/etc/ssh/sshd_config.d/hardening.conf`
   - `/etc/nftables.conf`
   - `/etc/fail2ban/jail.local`
   - `/etc/docker/daemon.json`
   - `/etc/sysctl.d/99-fancai.conf`
   - `/etc/security/limits.d/fancai.conf`
   - Шаблон `.env` файла для проекта
   - `postgresql.conf` (оптимизированный под 32 GB)
   - `redis.conf` (оптимизированный)
   - Скрипт backup PostgreSQL
   - Caddyfile (базовый, для первого деплоя)

4. **Checklist верификации** — список команд для проверки каждого аспекта настройки

5. **Потенциальные проблемы** — что может пойти не так и как это починить

## Важные ограничения

- НЕ использовать iptables — только nftables (Debian 13 default)
- НЕ использовать docker-compose (с дефисом) — только `docker compose` (plugin)
- Redis 7.4 — НЕ обновлять до Redis 8.0 (AGPL/RSAL лицензия, требуется legal review)
- PostgreSQL — использовать именно 17.9-alpine (CVE-patched)
- Все пароли/ключи в примерах заменять на `<CHANGE_ME>` плейсхолдеры
- Учитывать что на сервере будет 7+ Docker-контейнеров одновременно
- Учитывать специфику AMD EPYC (huge pages, NUMA, если применимо)

## Контекст проекта

- Проект в продакшене, но мигрирует со старого сервера (8 GB RAM → 32 GB RAM)
- Сейчас используется nginx, планируется замена на Caddy (Phase 3 roadmap)
- На первом этапе можно настроить и nginx, и Caddy (или только Caddy — обоснуй)
- AI-задачи потребляют много RAM (Celery worker до 512 MB на задачу, concurrency=2-4)
- PostgreSQL должен быть оптимизирован под 32 GB (сейчас настроен на 8 GB — shared_buffers=512MB)
- Планируется добавление мониторинга: Netdata, Uptime Kuma, Dozzle
- Ошибки трекаются через Hawk Tracker (hawk-tracker.ru), НЕ Sentry

Пиши на русском языке. Будь конкретным, давай готовые к использованию команды и конфигурации.
Каждое решение обосновывай — почему именно так, а не иначе.
