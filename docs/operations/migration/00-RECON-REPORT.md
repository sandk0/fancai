# Recon report — fancai-prod

> **Дата сбора:** 2026-05-10 ~01:10 UTC
> **Метод:** read-only SSH commands из локальной Claude Code сессии
> **Подтверждение владельца:** получено через AskUserQuestion перед началом
> **Содержит секреты:** **нет** (только метаданные, ключи `.env` без значений)

---

## 1. Identity

| Параметр     | Значение                                                   |
| ------------ | ---------------------------------------------------------- |
| Hostname     | `fancai-prod`                                              |
| OS           | Debian GNU/Linux 13 (trixie), version 13.3                 |
| Kernel       | `6.12.73+deb13-amd64` (2026-02-17)                         |
| Architecture | **x86_64**                                                 |
| Timezone     | Europe/Berlin (CEST, UTC+2)                                |
| NTP          | active, синхронизирован                                    |
| Uptime       | 69 days, 11h (с ~2026-02-29)                               |
| Boot mode    | EFI (vfat 241 MB, vda2)                                    |
| Reverse PTR  | `v2202603341452437776.hotsrv.de` → **Hetzner Cloud** инфра |

## 2. Hardware

| Параметр   | Значение                                     |
| ---------- | -------------------------------------------- |
| CPU        | AMD EPYC 9645 96-Core Processor (физический) |
| vCPU       | **12** (NUMA node 0, range 0-11)             |
| Hypervisor | KVM (full virtualization)                    |
| RAM total  | 31 GiB                                       |
| RAM used   | 7 GiB (24 GiB available включая buff/cache)  |
| Swap       | 4 GiB (332 MiB used)                         |

## 3. Disk

```
/dev/vda4   ext4   1.0 TB   48 GB used (5%), 919 GB free       /
/dev/vda3   ext4   944 MB   135 MB used                         /boot
/dev/vda2   vfat   241 MB   512 KB used                         /boot/efi
```

`pgbackup` mounted as bind to root partition: `/var/lib/docker/volumes/app_pgbackup_data/_data` → `/backups/postgres`.

**Свободно: 919 GB.** Места для бэкапа в избытке.

## 4. Network

```
eth0       UP    159.195.53.244/22 (RIPE, RU geo)
              + 2a0a:4cc0:c1:d183:1486:46ff:fe05:b978/64 (IPv6)
br-fancai  UP    172.22.0.1/16  (Docker bridge для prod-стека)
br-184f7e751f09 UP 10.200.0.1/24 (Docker bridge для monitoring)
docker0    DOWN  172.17.0.1/16  (default Docker bridge — не используется)
```

**Default route:** `159.195.52.1` (gateway на /22-сети)
**DNS resolvers:** `46.38.252.230`, `46.38.225.230` (вероятно VDSina/Aeza/Selectel)

### Открытые порты наружу (наблюдаемые с интернета)

| Port     | Process | Note                     |
| -------- | ------- | ------------------------ |
| 80/tcp   | Caddy   | HTTP → редирект на HTTPS |
| 443/tcp  | Caddy   | HTTPS                    |
| 443/udp  | Caddy   | HTTP/3 (QUIC)            |
| 2222/tcp | sshd    | SSH (нестандартный порт) |

### Loopback-only порты (мониторинг и внутренние)

| Port            | Process                                                         |
| --------------- | --------------------------------------------------------------- |
| 127.0.0.1:5555  | Flower (Celery monitoring)                                      |
| 127.0.0.1:8080  | pgbackup health endpoint                                        |
| 127.0.0.1:8428  | Victoria Metrics                                                |
| 127.0.0.1:19999 | Netdata                                                         |
| 127.0.0.1:11434 | **Ollama? (подозрительно — есть локальный сервис на ML-порту)** |
| 127.0.0.1:3001  | Uptime Kuma                                                     |
| \*:9323         | Docker metrics endpoint                                         |

> **TODO:** Узнать у владельца, что слушает 11434. Если это dead Ollama от старого AI-стека — удалить при миграции.

## 5. Public DNS (fancai.ru)

| Тип                | Значение                                                             |
| ------------------ | -------------------------------------------------------------------- |
| A                  | `159.195.53.244` (совпадает с IP сервера, без CDN)                   |
| AAAA               | (нет) — IPv6 у домена не настроен                                    |
| MX                 | `10 mx.fancai.ru`                                                    |
| TXT (SPF)          | `v=spf1 include:_spf.cloud.yandex.net ~all`                          |
| TXT (verification) | `602c3682-0b43-4413-bd67-6bf9b2dbb3fd` (вероятно сервис верификации) |
| NS                 | `ns1-4.vdsina.com` (DNS-зона у VDSina)                               |

**Выводы:**

- DNS управляется через **VDSina** (нужен доступ к их панели для смены A-record при миграции)
- Реальный VPS — **Hetzner Cloud** (по reverse-PTR `*.hotsrv.de`); VDSina выступает реселлером
- Email отправка — **через Yandex Cloud SMTP** (но сами SMTP-credentials, похоже, нигде в `.env` — нужно уточнить, отправляются ли вообще письма)

## 6. SSH и системная безопасность

| Параметр                 | Значение            | Комментарий                                |
| ------------------------ | ------------------- | ------------------------------------------ |
| SSH порт                 | 2222                | Нестандартный — хорошо                     |
| `PermitRootLogin`        | **yes**             | ⚠️ Рекомендую `no` или `prohibit-password` |
| `PasswordAuthentication` | **yes**             | ⚠️ Рекомендую `no` (только ключи)          |
| Authorized keys (deploy) | 1 ключ              | OK                                         |
| Fail2ban                 | active, jail `sshd` | ✓                                          |
| UFW                      | **не установлен**   | Полагаемся на iptables (не аудитировано)   |
| Установленные пакеты     | 1014 (dpkg)         | Стандартный Debian 13                      |

> **Рекомендация для нового VPS:** настроить SSH на key-only, отключить root login, поставить ufw.

## 7. Cron на хосте

```
deploy:  no crontab
root:    no crontab
/etc/cron.d/:        e2scrub_all, kernel, sysstat (стандартные Debian)
/etc/cron.daily/:    apt-compat, dpkg, logrotate, sysstat
/etc/cron.hourly/:   (пусто)
```

**Кастомных cron-задач у хоста нет.** Вся автоматизация бэкапов — внутри Docker (`fancai_pgbackup` контейнер делает ежедневный pg_dump).

## 8. Docker

| Параметр       | Значение                |
| -------------- | ----------------------- |
| Engine         | Docker version 29.2.1   |
| Compose        | v5.1.0                  |
| Storage Driver | (по умолчанию overlay2) |

### Запущенные контейнеры (12 штук, все healthy)

#### Production stack (compose: `docker-compose.prod.yml`)

| Container         | Image                                      | Status            |
| ----------------- | ------------------------------------------ | ----------------- |
| `fancai_caddy`    | `caddy:2.11.1-alpine`                      | healthy, 5 weeks  |
| `fancai_backend`  | `fancai-backend:latest` (custom)           | healthy, 5 weeks  |
| `fancai_celery`   | `fancai-celery:latest` (custom)            | healthy, 5 weeks  |
| `fancai_beat`     | `fancai-backend:latest`                    | healthy, 5 weeks  |
| `fancai_postgres` | `pgvector/pgvector:0.8.2-pg17`             | healthy, 6 weeks  |
| `fancai_redis`    | `redis:7.4.8-alpine`                       | healthy, 2 months |
| `fancai_pgbackup` | `prodrigestivill/postgres-backup-local:17` | healthy, 2 months |

#### Monitoring stack (compose: `docker-compose.monitoring.yml`)

| Container                | Image                                       | Status           |
| ------------------------ | ------------------------------------------- | ---------------- |
| `fancai_netdata`         | `netdata/netdata:v2.9.0`                    | healthy, 7 weeks |
| `fancai_victoriametrics` | `victoriametrics/victoria-metrics:v1.137.0` | up, 7 weeks      |
| `fancai_dozzle`          | `amir20/dozzle:v10.1.1`                     | up, 7 weeks      |
| `fancai_flower`          | `mher/flower:2.0.1`                         | up, 7 weeks      |
| `fancai_uptime_kuma`     | `louislam/uptime-kuma:2.2.1`                | healthy, 7 weeks |

### Docker images (suma)

| Image                                       | Size        | Notes                                              |
| ------------------------------------------- | ----------- | -------------------------------------------------- |
| `fancai-celery:latest`                      | **1.76 GB** | Custom (PyTorch + GLiNER2 + sentence-transformers) |
| `fancai-backend:latest`                     | **553 MB**  | Custom (FastAPI + uvicorn + dependencies)          |
| `louislam/uptime-kuma:2.2.1`                | 1.69 GB     | Public                                             |
| `netdata/netdata:v2.9.0`                    | 1.18 GB     | Public                                             |
| `pgvector/pgvector:0.8.2-pg17`              | 442 MB      | Public                                             |
| `prodrigestivill/postgres-backup-local:17`  | 467 MB      | Public                                             |
| `caddy:2.11.1-alpine`                       | 62 MB       | Public                                             |
| `mher/flower:2.0.1`                         | 85.5 MB     | Public, **2 года old** ⚠️                          |
| `amir20/dozzle:v10.1.1`                     | 58.5 MB     | Public                                             |
| `redis:7.4.8-alpine`                        | 41.4 MB     | Public                                             |
| `victoriametrics/victoria-metrics:v1.137.0` | 35.1 MB     | Public                                             |

> **На миграции:** все public-образы скачаются автоматически. Custom-образы (`fancai-backend`, `fancai-celery`, `fancai-frontend`) пересоберутся через `docker compose build` за ~15 минут.

### Docker volumes (size)

| Volume               | Size                                         | Критичность для миграции                                          |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `app_postgres_data`  | **88.71 MB**                                 | ⭐⭐⭐ (но `pg_dump` достаточен)                                  |
| `app_redis_data`     | **41.78 MB**                                 | ⭐⭐ (Celery очереди + cache)                                     |
| `app_caddy_data`     | **16.52 KB**                                 | ⭐⭐⭐ **СУПЕР-КРИТИЧНО** (Let's Encrypt account + 4 сертификата) |
| `app_caddy_config`   | 5.2 KB                                       | ⭐ (autogen, можно регенерировать)                                |
| `app_beat_schedule`  | 24.58 KB                                     | ⭐⭐ (расписание Celery Beat)                                     |
| `app_frontend_build` | 3.4 MB                                       | — (пере-билдится)                                                 |
| `app_nlp_models`     | **3.16 GB**                                  | ⭐ опционально (HF cache, регенерируется ~10 мин)                 |
| `app_vm_data`        | 46 MB                                        | ⭐ опционально (Victoria Metrics history)                         |
| `app_kuma_data`      | 7.26 MB                                      | ⭐ опционально (Uptime Kuma настройки)                            |
| `app_netdataconfig`  | 10.5 KB                                      | —                                                                 |
| `app_netdatalib`     | 5 KB                                         | —                                                                 |
| `app_netdatacache`   | 2.26 GB                                      | ✗ (cache, regenerable)                                            |
| `app_pgbackup_data`  | (bind mount → /backups/postgres = **99 MB**) | ⭐ secondary backup                                               |

## 9. Project state (`/opt/fancai/app`)

### Git

```
Branch:        main
Latest commit: 5f6f309 feat(ai): switch to Gemini 2.5 Flash tiered strategy after Qwen3.5 A/B test
Status:        clean (1 untracked file)
Untracked:     monitoring/netdata/netdata.conf
Stash entries: 3 (старые WIP, можно сохранить или дропнуть)
Remote:        https://github.com/sandk0/fancai.git
```

**Drift с Git: МИНИМАЛЬНЫЙ.** Только один untracked файл и 3 stash'а. Это упрощает миграцию: код = origin/main + 1 файл.

### Файлы в проекте (видимые без захода в .git)

```
backend/        — Python код
frontend/       — React код
docs/           — документация
modal/          — Modal AI scripts
monitoring/     — конфиги мониторинг-стека (включая untracked netdata.conf)
.planning/      — GSD planning artifacts
.claude/        — Claude Code config
.opencode/      — OpenCode config
docker-compose.{prod,dev,monitoring}.yml
Caddyfile, Caddyfile.dev
.env (3.1 KB, 77 строк, права 600 у deploy:deploy)
```

## 10. .env keys (значения НЕ извлечены)

26 ключей в `.env`:

```
DB_USER, DB_PASSWORD, DB_NAME
REDIS_PASSWORD
SECRET_KEY                          (JWT signing — потеря = инвалидация всех refresh tokens)
OPENROUTER_API_KEY                  (главный AI канал)
MODAL_TOKEN_ID, MODAL_TOKEN_SECRET  (резервный AI канал)
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (PWA push)
HAWK_TOKEN, VITE_HAWK_TOKEN         (error monitoring)
MONITOR_USER, MONITOR_PASSWORD,
MONITOR_PASSWORD_HASH               (доступ к monitor.fancai.ru)
METRICS_PASSWORD                    (/metrics)
DOMAIN_NAME, DOMAIN_URL
ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
LOG_LEVEL, MAX_FILE_SIZE
WORKERS_COUNT, CELERY_CONCURRENCY
POLLINATIONS_ENABLED                (новый — для image generation?)
```

> ⚠️ **Замечание по безопасности:** в `.env` есть и `MONITOR_PASSWORD` (raw), и `MONITOR_PASSWORD_HASH`. Если raw-пароль не используется для чего-то конкретного, его можно удалить — лишний lik-вектор. Это **вне scope** миграции, но стоит обработать отдельно.

## 11. PostgreSQL state

| Параметр        | Значение                                                                      |
| --------------- | ----------------------------------------------------------------------------- |
| Version         | **PostgreSQL 17.9** (Debian 17.9-1.pgdg12+1, gcc 12.2.0, x86_64-pc-linux-gnu) |
| Database        | **`fancai`** (НЕ `fancai_prod`)                                               |
| Encoding        | UTF8, locale C                                                                |
| Owner           | `fancai`                                                                      |
| Size            | 88.71 MB (на disk)                                                            |
| Extensions      | `plpgsql 1.0`, **`vector 0.8.2`** (pgvector)                                  |
| Alembic version | `a1e2f3b4c5d6`                                                                |
| Users           | 3                                                                             |
| Books           | 13                                                                            |

**Критично:** на новом сервере нужен **точно** `pgvector/pgvector:0.8.2-pg17` (это уже зашито в compose). Иначе HNSW/IVFFlat индексы могут не загрузиться.

## 12. Storage (bind-mount `./backend/storage`)

```
backend/storage/                       484 MB total
├── books/                             56 MB
│   ├── *.epub (62 файла, UUID-named)
│   └── covers/                        (cover thumbnails)
└── generated_images/                  428 MB
    └── flux_*.png                     (FLUX.2 generations)
```

**ВАЖНО:** структура реальная **отличается** от того, что в compose-документации:

- В compose упомянуты `storage/images/` и `storage/covers/` отдельно — **этих папок нет**
- Реально код пишет: `books/`, `books/covers/`, `generated_images/`
- Существующий `scripts/backup.sh` ищет `storage/images/` и `storage/covers/` — **бэкапит несуществующее**, теряет real `generated_images`

> Это найденный bug в существующем backup.sh — стоит зафиксировать в backlog (но за рамками миграции).

## 13. Caddy state

| Параметр               | Значение                                                              |
| ---------------------- | --------------------------------------------------------------------- |
| Version                | `v2.11.1`                                                             |
| ACME provider          | Let's Encrypt (acme-v02.api.letsencrypt.org)                          |
| ACME account email     | `admin@fancai.ru`                                                     |
| Сертификаты выпущены   | `fancai.ru`, `www.fancai.ru`, `monitor.fancai.ru`, `uptime.fancai.ru` |
| Резервный ACME account | ZeroSSL (`acme.zerossl.com-v2-dv90`) — на случай проблем с LE         |
| Staging account        | acme-staging-v02 LE — для test-выпусков                               |

**Размер `caddy_data` всего 16.52 KB** — но без него Caddy потеряет ACME account и при первом запуске на новом IP попадёт в [Let's Encrypt rate-limit](https://letsencrypt.org/docs/rate-limits/) (5 cert/неделю/домен).

## 14. Pgbackup status

```
/backups/postgres/                     99 MB
├── daily/    (последние 7 дней, последний 2026-05-10 02:00 UTC)
├── weekly/   (отключён в compose: BACKUP_KEEP_WEEKS=0)
├── monthly/  (отключён: BACKUP_KEEP_MONTHS=0)
└── last/     (всегда последний бэкап)
```

Конфигурация: ежедневно в 02:00 UTC, формат custom (`--format=custom`), сжатие zstd 6 (`-Z6`), включены blobs.

> **Это вторичный страховой слой**, который уже работает. Migration backup забирает копию `pgbackup-archive.tar.gz` для обеспечения дополнительной точки восстановления.

## 15. Сводная карта рисков (по итогам recon)

| Находка                                              | Риск   | Действие                             |
| ---------------------------------------------------- | ------ | ------------------------------------ |
| Public IPv6 у сервера, нет AAAA для домена           | Low    | OK как есть, проверить нужно ли AAAA |
| `PermitRootLogin yes` + `PasswordAuthentication yes` | Medium | Закрыть на новом VPS                 |
| Отсутствие UFW                                       | Low    | Поставить ufw на новом VPS           |
| Mystery service на `127.0.0.1:11434`                 | Low    | Узнать что это, нужен ли             |
| `MONITOR_PASSWORD` в `.env` (рядом с hash)           | Low    | Удалить raw, оставить только hash    |
| `flower` 2.0.1 — 2 года old                          | Low    | Обновить (вне scope)                 |
| `scripts/backup.sh` бэкапит несуществующие папки     | Medium | Поправить (вне scope migration)      |

---

**Итог:** инфраструктура понятная, состояние стабильное (uptime 69 дней, drift минимальный, размеры скромные). Бэкап будет лёгким, миграция — предсказуемой.
