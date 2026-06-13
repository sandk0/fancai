# Backup inventory — что бэкапим, как, куда восстанавливаем

> Снимок 2026-05-10. Размеры реальные с production-сервера.

---

## Легенда критичности

- ⭐⭐⭐ — потеря = безвозвратная утрата данных пользователей или критичная переустановка
- ⭐⭐ — потеря восстановима, но дорого/сложно (rate-limits, time-consuming rebuild)
- ⭐ — потеря восстановима автоматически или быстро вручную
- — — не нужно бэкапить

---

## 1. Application code

| Артефакт                                     | Источник                                                  | Размер       | Метод бэкапа                | Метод восстановления             | Crit   |
| -------------------------------------------- | --------------------------------------------------------- | ------------ | --------------------------- | -------------------------------- | ------ |
| Git repo (полный)                            | `.git` в `/opt/fancai/app`                                | ~50 MB       | `git bundle --all`          | `git clone bundle.bundle target` | ⭐⭐⭐ |
| Working tree                                 | `/opt/fancai/app` (без `.git`, `node_modules`, `storage`) | ~5 MB сжатый | `tar --exclude`             | `tar -xzf` после clone           | ⭐⭐⭐ |
| Git diff vs HEAD                             | `git diff`                                                | <100 KB      | как файл                    | `git apply`                      | ⭐⭐   |
| Stash entries                                | `git stash list` (3 stash'а)                              | <50 KB       | список + раздельные patch'и | `git stash apply`                | ⭐     |
| Untracked: `monitoring/netdata/netdata.conf` | bind                                                      | <10 KB       | tar в working-tree          | расположить по тому же пути      | ⭐⭐   |

**Замечание:** работаем с `git bundle`, потому что **GitHub remote есть** и до коммита `5f6f309` всё уже там. Bundle перекрывает риск «GitHub удалён/недоступен» и захватывает stash'ы.

---

## 2. Secrets (encrypted with age)

| Артефакт                 | Источник               | Размер | Метод бэкапа     | Метод восстановления | Crit           |
| ------------------------ | ---------------------- | ------ | ---------------- | -------------------- | -------------- | -------- | ------ |
| `.env`                   | `/opt/fancai/app/.env` | 3.1 KB | `tar             | age -r`              | `age -d -i key | tar -xf` | ⭐⭐⭐ |
| `~/.ssh/authorized_keys` | `~deploy/.ssh/`        | <1 KB  | tar в age-bundle | tar -xf в `~deploy`  | ⭐⭐           |

**Ключ шифрования:** age public key владельца. Private key хранится **отдельно** (Apple Keychain / 1Password). **Без него секреты невозможно восстановить.**

---

## 3. Database (PostgreSQL 17.9 + pgvector 0.8.2)

| Артефакт                                     | Источник                                  | Размер                      | Метод бэкапа                             | Метод восстановления                             | Crit          |
| -------------------------------------------- | ----------------------------------------- | --------------------------- | ---------------------------------------- | ------------------------------------------------ | ------------- | ----- | --------------------------- |
| `pg_dump` custom format                      | container `fancai_postgres`, db `fancai`  | ~30 MB сжатый               | `docker exec ... pg_dump -F custom -Z 9` | `docker exec ... pg_restore --clean --if-exists` | ⭐⭐⭐        |
| `pg_dump` plain SQL                          | то же                                     | ~25 MB сжатый               | `docker exec ... pg_dump                 | gzip`                                            | `gunzip       | psql` | ⭐⭐ (дубль для inspection) |
| `pg_dumpall --globals-only`                  | container                                 | <1 KB                       | роли, tablespaces                        | `psql -d postgres < globals.sql`                 | ⭐⭐          |
| Alembic version                              | `SELECT version_num FROM alembic_version` | <100 байт                   | `psql -tAc`                              | для verify после restore                         | ⭐⭐          |
| Postgres metadata (extensions, table sizes)  | system catalog                            | <10 KB                      | `psql` queries                           | для verify                                       | ⭐            |
| **Optional:** raw `app_postgres_data` volume | docker volume                             | 88 MB сырой / ~40 MB сжатый | cold tar (downtime ~30s)                 | `docker volume create + tar -x`                  | — (избыточен) |

**База маленькая (88 MB).** `pg_dump` достаточен; cold-tar опционален.

---

## 4. Redis 7.4.8

| Артефакт                    | Источник                                      | Размер        | Метод бэкапа       | Метод восстановления          | Crit             |
| --------------------------- | --------------------------------------------- | ------------- | ------------------ | ----------------------------- | ---------------- |
| RDB snapshot                | container, `BGSAVE` → `/data/dump.rdb`        | ~20 MB сжатый | `docker cp` + gzip | копировать в volume + restart | ⭐⭐             |
| AOF                         | `/data/appendonly.aof` (или `appendonlydir/`) | ~30 MB        | `docker cp`        | копировать в volume           | ⭐⭐ опционально |
| Redis info (server, memory) | `INFO` команды                                | <10 KB        | metadata           | для verify                    | ⭐               |

**Redis layout (Compose):** DB 0 — app cache, DB 1 — Celery broker (NEVER flush), DB 2 — Celery results.

---

## 5. User storage (bind mount `./backend/storage`)

| Артефакт                             | Источник   | Размер             | Метод бэкапа                  | Метод восстановления            | Crit                                                   |
| ------------------------------------ | ---------- | ------------------ | ----------------------------- | ------------------------------- | ------------------------------------------------------ |
| `books/` (62 EPUB файла, UUID-named) | bind mount | 56 MB              | `tar -czf books.tar.gz`       | `tar -xzf` в `backend/storage/` | ⭐⭐⭐ **single source of truth**                      |
| `books/covers/` (внутри books)       | bind mount | (включено в books) | то же                         | то же                           | ⭐⭐⭐                                                 |
| `generated_images/` (FLUX.2 PNG)     | bind mount | 428 MB             | `tar -czf` (PNG плохо жмётся) | `tar -xzf`                      | ⭐⭐ (можно регенерировать через AI, но дорого по API) |

**После restore — chown 1000:1000** (UID контейнера backend).

---

## 6. Docker volumes

| Volume               | Содержимое                                                       | Размер       | Бэкапить?                                        | Crit                       |
| -------------------- | ---------------------------------------------------------------- | ------------ | ------------------------------------------------ | -------------------------- |
| `app_caddy_data`     | Let's Encrypt account + 4 сертификата + ZeroSSL fallback account | **16.52 KB** | ✓ ОБЯЗАТЕЛЬНО                                    | ⭐⭐⭐                     |
| `app_caddy_config`   | Caddy autogen cache                                              | 5.2 KB       | ✓ (тривиально)                                   | ⭐                         |
| `app_beat_schedule`  | Celery Beat расписание (last-run timestamps)                     | 24.58 KB     | ✓                                                | ⭐⭐                       |
| `app_postgres_data`  | Сырая БД                                                         | 88.71 MB     | ✗ (есть `pg_dump`)                               | —                          |
| `app_redis_data`     | Redis RDB+AOF                                                    | 41.78 MB     | ✗ (есть `dump.rdb`)                              | —                          |
| `app_frontend_build` | Vite build output                                                | 3.4 MB       | ✗ (rebuilds via `docker compose build frontend`) | —                          |
| `app_nlp_models`     | HuggingFace cache (GLiNER2 + sentence-transformers)              | **3.16 GB**  | Опционально                                      | ⭐ (10 мин на регенерацию) |
| `app_vm_data`        | Victoria Metrics history                                         | 46 MB        | Опционально                                      | ⭐ (history полезна)       |
| `app_kuma_data`      | Uptime Kuma config + history                                     | 7.26 MB      | Опционально                                      | ⭐ (мониторинг настройки)  |
| `app_netdataconfig`  | Netdata config                                                   | 10.5 KB      | Опционально                                      | ⭐                         |
| `app_netdatalib`     | Netdata lib state                                                | 5 KB         | Опционально                                      | —                          |
| `app_netdatacache`   | Netdata cache                                                    | 2.26 GB      | ✗ regenerable                                    | —                          |
| `app_pgbackup_data`  | bind mount → `/backups/postgres/`                                | 99 MB        | ✓ secondary insurance                            | ⭐                         |

---

## 7. System metadata хоста

| Артефакт                          | Источник                                    | Размер            | Crit                                      |
| --------------------------------- | ------------------------------------------- | ----------------- | ----------------------------------------- |
| Crontab user (deploy)             | `crontab -l`                                | <100 байт (пусто) | —                                         |
| Crontab root                      | `sudo crontab -l`                           | <100 байт (пусто) | —                                         |
| `/etc/cron.{d,daily,...}` listing | `ls`                                        | <1 KB             | ⭐                                        |
| iptables rules                    | `sudo iptables-save`                        | <10 KB            | ⭐⭐ (нужно для воспроизведения firewall) |
| sshd_config                       | `/etc/ssh/sshd_config`                      | ~3 KB             | ⭐ (для воспроизведения настроек SSH)     |
| fail2ban status                   | `fail2ban-client status`                    | <1 KB             | ⭐                                        |
| dpkg -l                           | список 1014 пакетов                         | ~100 KB           | ⭐ (для воспроизведения окружения)        |
| systemd enabled units             | `systemctl list-unit-files --state=enabled` | <10 KB            | ⭐                                        |
| `/etc/hosts`, `/etc/resolv.conf`  | bind mount                                  | <1 KB             | ⭐                                        |
| `ip addr`, `ip route`             | system                                      | <1 KB             | ⭐                                        |

---

## 8. Docker metadata

| Артефакт                                                                | Источник                                              | Размер         | Crit                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | -------------- | ----------------------------------------------- |
| `docker images` listing                                                 | system                                                | <5 KB          | ⭐⭐ (версии public-образов)                    |
| `compose-config-resolved-full.yml`                                      | `compose -f prod.yml -f monitoring.yml config`        | ~25 KB         | ⭐⭐⭐ (resolved YAML обоих стеков)             |
| `compose-config-resolved-prod-only.yml`                                 | `compose -f prod.yml config`                          | ~12 KB         | ⭐⭐ (резерв если detection сломается)          |
| `compose-detection.txt`                                                 | docker labels per container                           | <2 KB          | ⭐⭐ (доказательство какие файлы реально use'd) |
| `compose-context.env`                                                   | вычислено: project_name, working_dir, startup-команда | <1 KB          | ⭐⭐⭐ (для restore!)                           |
| `docker-compose.prod.yml`, `docker-compose.monitoring.yml`, `Caddyfile` | raw файлы из репо (на случай drift)                   | ~30 KB         | ⭐⭐                                            |
| `docker network ls`, `volume ls`                                        | system                                                | <1 KB          | ⭐                                              |
| **Optional:** `docker save` custom-images                               | `fancai-backend`, `fancai-celery`, `fancai-frontend`  | ~2.3 GB сжатый | — (rebuild через 15 минут на новом VPS)         |

> ⚠️ **На production используются ДВА compose-файла одновременно** с одним project name `app`:
>
> - `docker-compose.prod.yml` запускает 7 сервисов (caddy, frontend, backend, celery-worker, celery-beat, postgres, redis, pgbackup)
> - `docker-compose.monitoring.yml` запускает 5 сервисов (netdata, victoriametrics, uptime-kuma, dozzle, flower)
>
> При restore **обязательно** использовать оба файла, иначе мониторинг не поднимется. `migration-restore.sh` делает это автоматически через `RESTORE_MONITORING=1` (default).

---

## 9. Внешние сервисы (НЕ в архиве, но фиксируем доступы)

| Сервис            | Что фиксируем                                  | Где хранить                   |
| ----------------- | ---------------------------------------------- | ----------------------------- |
| OpenRouter        | Email аккаунта, API key, биллинг status        | 1Password / Keychain          |
| Modal             | Token ID + Secret                              | 1Password (если используется) |
| HawkBit           | Project ID + token                             | 1Password (значение в `.env`) |
| VAPID keys        | public + private                               | 1Password (значение в `.env`) |
| Yandex Cloud SMTP | Email + password / OAuth                       | 1Password                     |
| VDSina (DNS)      | Аккаунт + пароль для смены A-record            | 1Password                     |
| VPS provider      | VDSina (виртуальный) или Hetzner (если direct) | 1Password                     |
| Domain registrar  | Регистратор `fancai.ru` (узнать у владельца)   | 1Password                     |

---

## 10. Финальный размер архива

### Минимальный (что нужно для миграции)

```
code/                            ~55 MB
secrets/env-bundle.tar.age          3 KB
database/                        ~55 MB
redis/                           ~20 MB
storage/                         ~485 MB
volumes/caddy_data, beat_schedule  ~50 KB
pgbackup/                        ~99 MB
docker/, system/                  ~150 KB
─────────────────────────────────────────
Total                            ~715 MB
```

### С опциональным (для полной consistency)

```
+ volumes/nlp_models             3.16 GB
+ volumes/vm_data + kuma         53 MB
+ docker/custom-images.tar.gz    ~2.3 GB
─────────────────────────────────────────
Total                            ~6.2 GB
```

**Рекомендация:** минимальная версия (~715 MB) + опциональный nlp_models при первом backup'е (~3.9 GB total). Custom images **не сохранять** — собираются за 15 минут на новом VPS из исходников.

---

## 11. Чек-лист verify (после backup)

```bash
cd /var/backups/fancai-migration/<TIMESTAMP>

# 1. Все sha256 совпадают
sha256sum -c checksums.sha256

# 2. Postgres dump читается
pg_restore --list database/dump.custom | head
zcat database/dump.sql.gz | head -3

# 3. Tar архивы открываются
for f in storage/*.tar.gz volumes/*.tar.gz code/*.tar.gz pgbackup/*.tar.gz; do
    tar -tzf "$f" >/dev/null 2>&1 && echo "OK: $f" || echo "FAIL: $f"
done

# 4. Age bundle расшифровывается (требует age key)
age -d -i ~/.age/fancai-migration.key secrets/env-bundle.tar.age | tar -tf - | head

# 5. Git bundle валиден
git bundle verify code/repo.bundle
```

Все 5 проверок должны вернуть OK перед загрузкой в off-site.
