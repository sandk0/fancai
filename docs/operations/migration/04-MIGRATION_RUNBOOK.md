# Migration runbook — поднять fancai на новом VPS из бэкапа

> **Целевой RTO:** ≤ 4 часа
> **Целевой RPO:** = время с последнего migration-backup'а
> **Сложность:** medium (если бэкап сделан правильно, runbook идеально проходим)

> ⚠️ **Архитектурный нюанс:** на production используются **ДВА compose-файла одновременно** с одним project-name'ом:
>
> ```bash
> cd /opt/fancai/app
> COMPOSE_PROJECT_NAME=app docker compose \
>     -f docker-compose.prod.yml \
>     -f docker-compose.monitoring.yml \
>     up -d
> ```
>
> - `docker-compose.prod.yml` — caddy, backend, celery-worker, celery-beat, postgres, redis, pgbackup
> - `docker-compose.monitoring.yml` — netdata, victoriametrics, uptime-kuma, dozzle, flower
> - **Project name `app`** — фиксирует префикс volumes (`app_postgres_data`, `app_caddy_data`, ...). Если запустить с другим project-name, volumes окажутся под другим префиксом и не найдут данные из бэкапа.
>
> `migration-restore.sh` экспортирует `COMPOSE_PROJECT_NAME=app` сам и подключает оба файла через переменную `RESTORE_MONITORING=1` (default). Если хочешь поднять только prod без мониторинга — `RESTORE_MONITORING=0`.

---

## 0. Когда использовать этот runbook

Любой из сценариев:

- Старый сервер удалён или недоступен > 30 минут
- Дата-центр VDSina/Hetzner отключился, владельцу известно что нет ETA
- Атака/компрометация — нужно поднять чистую копию на новом VPS
- Плановая миграция (без аварии) — заранее предусмотреть downtime ~1 час

Если ничего из этого не применимо — **этим runbook'ом не пользуйся**, он destructive.

---

## 1. Pre-flight: что нужно иметь на руках

Перед началом миграции владелец должен иметь:

- [ ] **age private key** (файл `~/.age/fancai-migration.key`) — из 1Password
- [ ] **migration-backup tar** — скачан локально или доступен в B2/S3
- [ ] **SHA256 checksum** master tar'а — для верификации после скачивания
- [ ] **Доступ к DNS-провайдеру** (VDSina или иной) — для смены A-записи
- [ ] **Учётка нового VPS-провайдера** (Hetzner Cloud рекомендуется)
- [ ] **GitHub аккаунт** (опционально — если bundle не достаточно)
- [ ] **OpenRouter API key** — на случай rate-limit при reset

Если что-то отсутствует — **остановись**, найди прежде чем заказывать новый VPS.

---

## 2. Этап 1 — Заказ нового VPS (~10 минут)

### 2.1. Hetzner Cloud (рекомендуется)

1. Войти в https://console.hetzner.cloud
2. Project → Select project (или создать `fancai-prod`)
3. **Add Server**
4. Параметры:
   - Location: **Falkenstein/Helsinki/Nuremberg** (любой EU)
   - Image: **Debian 13 (trixie)**
   - Type: **Dedicated vCPU CCX33** (8 vCPU AMD, 32 GB RAM, 240 GB NVMe)
     - Альтернатива при нагрузке: CCX43 (16 vCPU, 64 GB RAM)
   - Networking: **IPv4 + IPv6** (yes на оба)
   - SSH keys: добавить публичный ключ владельца
   - Cloud-init (опционально):
     ```yaml
     #cloud-config
     packages:
       - docker.io
       - docker-compose-plugin
       - git
       - age
       - rclone
       - htop
       - curl
       - vim
       - jq
     runcmd:
       - systemctl enable docker
       - systemctl start docker
       - usermod -aG docker root
     ```
   - Hostname: `fancai-prod-2` (или новое имя)
5. **Create & Buy**

После старта — IP появится в панели. Записать:

- IPv4: `<NEW_IP>`
- IPv6: `<NEW_IPV6>`

### 2.2. Verify архитектура

```bash
ssh root@<NEW_IP> 'uname -m'
# Ожидается: x86_64
```

Если **другая архитектура** — `migration-restore.sh` пожалуется и попросит rebuild custom-images. Это работает, но дольше (~25 минут).

---

## 3. Этап 2 — Подготовка нового VPS (~10 минут)

```bash
ssh root@<NEW_IP>

# 3.1. Обновление пакетов
apt update && apt upgrade -y

# 3.2. Если cloud-init не отработал — установить вручную
apt install -y docker.io docker-compose-plugin git age curl tar jq htop ufw fail2ban

# 3.3. Включить firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'temp ssh'           # пока на стандартном порту
ufw allow 2222/tcp comment 'fancai ssh'        # как на старом сервере
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw allow 443/udp comment 'http3'
ufw --force enable

# 3.4. Создать пользователя deploy (как на старом)
useradd -m -s /bin/bash -G docker deploy
mkdir -p /home/deploy/.ssh
# Добавить публичный ключ владельца:
echo '<PUBLIC_SSH_KEY>' >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# 3.5. Сменить SSH порт на 2222 (как на старом)
sed -i 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config
sed -i 's/^Port 22$/Port 2222/' /etc/ssh/sshd_config
systemctl restart ssh
# ВАЖНО: открыть новую SSH сессию ДО закрытия текущей!

# Проверка из новой сессии:
ssh -p 2222 deploy@<NEW_IP> 'echo OK'
```

### 3.6. Перенаправить будущий ssh alias

В `~/.ssh/config` владельца заранее (или после миграции):

```
# Закомментировать старую конфигурацию
# Host fancai-old
#     HostName 159.195.53.244
#     ...

Host fancai
    HostName <NEW_IP>
    Port 2222
    User deploy
    IdentityFile ~/.ssh/id_ed25519
```

---

## 4. Этап 3 — Скачивание и проверка backup'а (~5 минут)

### 4.1. Скачать архив на новый сервер

Из Backblaze B2:

```bash
ssh deploy@<NEW_IP>

# rclone configured locally; либо использовать одноразовый presigned URL
mkdir -p ~/migration-restore
cd ~/migration-restore

# Вариант A: через B2 CLI (предварительно sudo apt install rclone и rclone config)
rclone copy b2:fancai-migration/fancai-migration-<TIMESTAMP>.tar .
rclone copy b2:fancai-migration/fancai-migration-<TIMESTAMP>.tar.sha256 .

# Вариант B: scp с локальной машины владельца
# (запустить на локальной машине)
# scp ~/Documents/fancai-backups/fancai-migration-<TIMESTAMP>.tar deploy@<NEW_IP>:~/migration-restore/
```

### 4.2. Загрузить age private key

⚠️ **Не оставляй ключ на сервере дольше необходимого.**

С локальной машины владельца:

```bash
scp ~/.age/fancai-migration.key deploy@<NEW_IP>:/tmp/age-key
ssh deploy@<NEW_IP> 'chmod 600 /tmp/age-key'
```

### 4.3. Verify integrity

```bash
ssh deploy@<NEW_IP>
cd ~/migration-restore

sha256sum -c fancai-migration-<TIMESTAMP>.tar.sha256
# Должно вывести: fancai-migration-<TIMESTAMP>.tar: OK
```

Если **FAIL** — скачать заново (corrupted in transit).

---

## 5. Этап 4 — Запуск restore-скрипта (~30-60 минут)

### 5.1. Получить migration-restore.sh

```bash
# Сначала склонируем репо чтобы взять восстановительный скрипт
cd ~
git clone https://github.com/sandk0/fancai.git fancai-tmp
chmod +x fancai-tmp/scripts/migration-restore.sh
```

### 5.2. Запустить restore

```bash
cd ~
sudo BACKUP_ARCHIVE=$HOME/migration-restore/fancai-migration-<TIMESTAMP>.tar \
     AGE_IDENTITY=/tmp/age-key \
     TARGET_DIR=/opt/fancai/app \
     COMPOSE_PROJECT_NAME=app \
     RESTORE_MONITORING=1 \
     bash fancai-tmp/scripts/migration-restore.sh
```

**Что делают переменные:**

- `COMPOSE_PROJECT_NAME=app` — критично! Без этого volumes на новом сервере получат другой префикс (например `fancai-tmp_postgres_data` если скрипт запущен из `~/fancai-tmp`) и не найдут восстановленные данные.
- `RESTORE_MONITORING=1` — поднять весь стек (prod + monitoring). Если хочешь сначала только prod, проверить, что всё работает, и только потом добавить monitoring — сначала запусти с `RESTORE_MONITORING=0`, а после UAT добавь второй стек:
  ```bash
  cd /opt/fancai/app
  COMPOSE_PROJECT_NAME=app docker compose \
      -f docker-compose.prod.yml \
      -f docker-compose.monitoring.yml \
      up -d
  ```

Скрипт спросит подтверждение перед каждым destructive шагом. Он:

1. Проверит наличие инструментов
2. Распакует архив
3. Восстановит код в `/opt/fancai/app` через git bundle + uncommitted
4. Расшифрует и положит `.env`
5. Поднимет postgres + redis (только их)
6. Сделает `pg_restore`
7. Восстановит redis dump.rdb
8. Распакует `storage/` (books + generated_images)
9. Восстановит volumes (caddy_data — критично!)
10. Запустит весь стек (`docker compose up -d`)
11. Проверит health-checks

### 5.3. Если шаг падает

Каждый шаг логируется в `/tmp/fancai-restore-*.log`. Стандартные диагностики:

| Симптом                                | Причина                         | Решение                                     |
| -------------------------------------- | ------------------------------- | ------------------------------------------- |
| `pg_restore: error: connection failed` | postgres ещё не готов           | подождать 30s, перезапустить шаг            |
| `age: error: no identity matched`      | не тот age key                  | проверить в 1Password правильный ли key     |
| `tar: cannot open`                     | tar не установлен или повреждён | `apt install tar` или скачать backup заново |
| `cannot connect to docker`             | docker не запущен               | `systemctl start docker`                    |
| `dump.custom: not found`               | архив не извлечён               | проверить путь BACKUP_ARCHIVE               |
| `image fancai-backend not found`       | кастомные образы не подняты     | rebuild: `docker compose -f ... build`      |

### 5.4. Удалить age key после использования

```bash
shred -u /tmp/age-key
# Или хотя бы:
rm /tmp/age-key
```

---

## 6. Этап 5 — Build custom images (если нужно, ~15 минут)

`migration-backup.sh` по умолчанию **не сохраняет** custom Docker images (`fancai-backend`, `fancai-celery`, `fancai-frontend`) — они rebuild'ятся из исходников.

Если на новом сервере их нет:

```bash
cd /opt/fancai/app
export COMPOSE_PROJECT_NAME=app

# Build только то, что в prod.yml (мониторинг использует public-образы)
docker compose -f docker-compose.prod.yml build
# Это занимает 10-15 минут на CCX33:
#   - fancai-backend (~3 мин)
#   - fancai-celery (~10 мин — PyTorch + GLiNER2)
#   - fancai-frontend (~2 мин — Vite build)

# Перезапустить ВЕСЬ стек (prod + monitoring) с новыми образами
docker compose \
    -f docker-compose.prod.yml \
    -f docker-compose.monitoring.yml \
    up -d
```

---

## 7. Этап 6 — DNS переключение (~5 минут + TTL)

### 7.1. Войти в DNS-панель

VDSina (или ваш провайдер):

- URL панели: <запомнить заранее>
- Учётка: 1Password

### 7.2. Снизить TTL (если ещё не сделано заранее)

Изменить TTL на A-записях `fancai.ru`, `www.fancai.ru`, `monitor.fancai.ru`, `uptime.fancai.ru` до **60 секунд**. Подождать TTL прошлого значения (типично 3600s = 1 час).

### 7.3. Изменить A-записи

| Запись              | Старое           | Новое      |
| ------------------- | ---------------- | ---------- |
| `fancai.ru`         | `159.195.53.244` | `<NEW_IP>` |
| `www.fancai.ru`     | `159.195.53.244` | `<NEW_IP>` |
| `monitor.fancai.ru` | `159.195.53.244` | `<NEW_IP>` |
| `uptime.fancai.ru`  | `159.195.53.244` | `<NEW_IP>` |

### 7.4. Подождать пропагации

```bash
# С локальной машины владельца — ждём что DNS обновится
watch -n 5 'dig +short fancai.ru @1.1.1.1; dig +short fancai.ru @8.8.8.8'
```

Когда оба резолвера показывают `<NEW_IP>` — DNS пропагирован.

### 7.5. Caddy получит первый запрос

Если `caddy_data` был перенесён через бэкап:

- Сертификат уже валиден (срок до 90 дней с выпуска)
- HTTPS работает мгновенно

Если `caddy_data` НЕ перенесён:

- Caddy запросит новый сертификат через ACME
- Risk: rate-limit Let's Encrypt
- Caddy fallback на ZeroSSL

---

## 8. Этап 7 — Smoke tests UAT (~15 минут)

Прохожу **все 14 пунктов**. Если хоть один падает — расследовать перед публикацией.

### 8.1. Доступность

- [ ] `curl -I https://fancai.ru` → `HTTP/2 200` (или 301 от Caddy на www)
- [ ] `curl -I https://www.fancai.ru` → 301 на `fancai.ru`
- [ ] `curl -I https://fancai.ru/api/v1/health` → 200, JSON `{"status":"ok"}`
- [ ] Сертификат валиден: `curl -v https://fancai.ru 2>&1 | grep -E "subject|issuer|expire"`

### 8.2. Frontend

- [ ] Открыть `https://fancai.ru` в браузере (incognito) — главная грузится
- [ ] Service worker регистрируется (DevTools → Application)
- [ ] Нет 5xx в Network tab

### 8.3. Auth

- [ ] **Существующий пользователь** логинится своим паролем
- [ ] **Refresh token** работает (через 30 минут access token истечёт, должно автоматически продлеться)
- [ ] **Регистрация** нового пользователя работает (если этот flow доступен)

### 8.4. Книги (single source of truth!)

- [ ] Список книг показывает **все 13 книг** (как на старом сервере)
- [ ] Открытие существующей книги — рендерится EPUB через epub.js
- [ ] CFI-позиция сохранена (там где остановился)
- [ ] Закладки/highlights видны

### 8.5. AI

- [ ] Генерация описания нового параграфа: открыть книгу → выбрать абзац → запросить description (через `/extract`-flow)
  - Должен прийти ответ от Gemini 2.5 Flash через OpenRouter
- [ ] Генерация изображения: запросить иллюстрацию → должен прийти PNG от FLUX.2
- [ ] Существующая wiki-карточка персонажа: открывается, показывает spoiler-free инфу

### 8.6. Celery

- [ ] `docker compose -f docker-compose.prod.yml exec celery-worker celery -A app.core.celery_app inspect ping` — отвечает
- [ ] Flower UI на `https://monitor.fancai.ru/flower` — задачи проходят

### 8.7. Push notifications

- [ ] Существующая подписка на push-уведомления продолжает работать (VAPID keys те же)

---

## 9. Этап 8 — Финализация (~10 минут)

### 9.1. Если что-то падает

**Rollback план:**

1. В DNS-панели вернуть A-записи на старый IP `159.195.53.244` (если он ещё доступен)
2. TTL мал (60s), пользователи вернутся быстро
3. Расследовать на новом сервере без давления

### 9.2. Если всё работает

- [ ] Изменить SSH alias `~/.ssh/config` на новый IP
- [ ] Обновить `.claude/skills/deploy/SKILL.md` если жёстко указан старый IP (он там не указан, но проверить)
- [ ] Удалить старый migration-backup.tar с нового сервера: `rm ~/migration-restore/*.tar*`
- [ ] **Запланировать новый migration-backup на новом сервере** через 24 часа после миграции (clean snapshot стабильного состояния)
- [ ] Удалить старый VPS, как только удостоверишься, что новый работает >= 7 дней
- [ ] Записать в `MIGRATION_REPORT-<DATE>.md`:
  - Дата, время, продолжительность каждого этапа
  - Любые отклонения от runbook'а
  - Issues, замеченные в процессе
  - Рекомендации для следующего раза

### 9.3. Postmortem (если миграция была экстренной)

После остывания (1-2 дня):

- Что сработало хорошо?
- Что заняло больше времени, чем ожидалось?
- Где runbook оказался непонятен?
- Какие assumption'ы оказались ошибочны?

Обновить runbook с учётом lessons learned.

---

## 10. Аварийные сценарии

### 10.1. Старый сервер ещё доступен, мы делаем плановую миграцию

Самый комфортный сценарий. Можно:

1. Создать **свежий** migration-backup за 30 минут до часа Х
2. Снизить TTL заранее
3. Поднять новый VPS параллельно
4. Сделать `migration-restore.sh`
5. Переключить DNS
6. Удалить старый VPS

### 10.2. Старый сервер недоступен, у нас есть свежий backup

Мы используем backup из B2.

### 10.3. Старый сервер недоступен, последний backup старее 24 часов

⚠️ **RPO нарушен.** Что потеряно:

- Свежие книги пользователей, загруженные за последние 24 часа
- AI-описания / изображения, сгенерированные за этот период
- Закладки/highlights за этот период

После восстановления:

- Объявить пользователям через push/email о data loss
- Возможно, отдельно запросить пересмотр последних активных пользователей

### 10.4. Backup доступен, но `pg_restore` падает

Возможные причины:

1. Версия pgvector на новом сервере другая → проверить `docker compose ps postgres`, должен быть `pgvector/pgvector:0.8.2-pg17`
2. Дамп повреждён → попробовать plain dump (`dump.sql.gz`) вместо custom
3. Конфликты с globals → пропустить globals.sql

Fallback:

```bash
# Plain dump через psql
gunzip -c database/dump.sql.gz | docker exec -i fancai_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### 10.5. age key потерян

❌ **Catastrophic.** Без него `.env` не расшифровать.

Mitigation:

- На новом сервере создать новый `.env` из template `.env.production.example`
- Заново сгенерировать `SECRET_KEY` (но это инвалидирует все refresh tokens у пользователей)
- Заново получить OpenRouter API key, VAPID keys, и т.д.
- Сохранить bcrypt хэши паролей пользователей (они в Postgres dump, не в .env) — пользователи сохранят пароли

---

## 11. Регулярная репетиция

**Раз в 6 месяцев** проводить **dry-run миграцию**:

1. Заказать одноразовый CCX33 на 1 час (~€0.05)
2. Прогнать runbook полностью
3. UAT smoke tests
4. Удалить тестовый VPS

Это самая дешёвая insurance для уверенности, что бэкап реально рабочий.

Дата следующей репетиции: **2026-11-10**.

---

**Документ готов. RTO достижим. Удачи!**
