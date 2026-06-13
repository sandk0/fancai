# Migration Plan: fancai-prod → новый VPS

> **Статус:** план готов к исполнению, бэкап ещё не создан
> **Дата составления:** 2026-05-10
> **Источник:** `fancai-prod` (Debian 13, x86_64, 159.195.53.244)
> **Цель:** insurance backup + runbook на случай экстренной миграции
> **Owner:** sandkme@gmail.com

---

## 0. TL;DR

1. **Бэкап маленький** — без AI-моделей всего ~700 MB, с моделями ~3.9 GB. Это шок-маленько для production-сервиса с пользователями.
2. **Главный риск миграции** — `caddy_data` volume (16 KB!) c Let's Encrypt account и сертификатами для 4 доменов. Без него — rate-limit от ACME при первом запуске на новом сервере.
3. **Drift минимальный** — на сервере один untracked файл (`monitoring/netdata/netdata.conf`) и 3 stash'а. Код фактически идентичен `origin/main` коммиту `5f6f309`.
4. **Архитектура** — x86_64 Debian 13 на Hetzner (через VDSina-реселлера), AMD EPYC 9645 12 vCPU, 32 GB RAM. Целевой VPS должен быть таким же.
5. **DNS-зона у VDSina** (`ns1-4.vdsina.com`), при миграции меняем только A-запись.
6. **Весь стек уже работает 5+ недель без перезапуска** (uptime 69 дней) — backup-окно нулевое (read snapshots), downtime для cold-tar Postgres ~30 секунд.
7. **Стек запускается через ДВА compose-файла** (`docker-compose.prod.yml` + `docker-compose.monitoring.yml`) с одним `COMPOSE_PROJECT_NAME=app`. Это зафиксировано в скриптах и runbook'е — без правильного project-name восстановленные volumes не будут найдены контейнерами.

---

## 1. Что уже сделано локально (готово в репо)

| Артефакт       | Путь                                                      | Назначение                                                                        |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Backup script  | `scripts/migration-backup.sh`                             | Полный migration-grade бэкап (idempotent, age-encrypted secrets, sha256 manifest) |
| Restore script | `scripts/migration-restore.sh`                            | Парный restore-скрипт для нового VPS                                              |
| Recon report   | `docs/operations/migration/00-RECON-REPORT.md`            | Реальный snapshot текущего состояния production                                   |
| Inventory      | `docs/operations/migration/02-BACKUP_INVENTORY.md`        | Таблица всех компонентов с размерами и критичностью                               |
| External deps  | `docs/operations/migration/03-EXTERNAL_DEPENDENCIES.md`   | DNS, VPS-провайдер, OpenRouter, Yandex SMTP                                       |
| Runbook        | `docs/operations/migration/04-MIGRATION_RUNBOOK.md`       | Пошаговое восстановление на новом VPS                                             |
| Promot         | `docs/prompts/2026-05-10-server-full-backup-migration.md` | Промпт для повторного запуска под Opus 4.7                                        |

---

## 2. Что нужно сделать владельцу до запуска бэкапа

Эти шаги — **единственное**, что блокирует выполнение бэкапа. Каждый займёт <10 минут.

### 2.1. Сгенерировать age-ключ для шифрования секретов

На локальной машине (macOS):

```bash
brew install age
mkdir -p ~/.age && chmod 700 ~/.age
age-keygen -o ~/.age/fancai-migration.key
# Сохрани ВЫВОД — он содержит public key (age1xxx...)
# private key уже в ~/.age/fancai-migration.key — НЕ заливай его в бэкап!
chmod 600 ~/.age/fancai-migration.key
```

**Сохрани оба:**

- public key (`age1...`) — нужен для `migration-backup.sh`
- private key file (`~/.age/fancai-migration.key`) — нужен для `migration-restore.sh` на новом сервере. Положи в **Apple Keychain / 1Password / Bitwarden** + бумажную копию в сейф (это единственный ключ к секретам).

### 2.2. Выбрать off-site бэкап-хранилище

| Вариант                          | Стоимость для ~700 MB     | Скорость      | Юрисдикция |
| -------------------------------- | ------------------------- | ------------- | ---------- |
| **Backblaze B2** (рекомендуется) | $0.005/GB/mes ≈ бесплатно | Хорошая       | US         |
| AWS S3 Standard                  | $0.023/GB/mes             | Очень быстро  | US/EU      |
| Yandex Object Storage            | ₽1.7/GB/mes               | Очень быстро  | RU         |
| Hetzner Storage Box              | ~$3.5/mes за 1 TB         | Хорошая, SFTP | EU         |
| Локальный диск владельца         | $0                        | Зависит       | DIY        |

**Рекомендация:** **Backblaze B2** + локальная копия. Начни с B2: бесплатный tier 10 GB достаточно. Создай `application key` с правами **только на запись и чтение** в один новый bucket `fancai-migration`.

### 2.3. Подтвердить инфраструктурные данные

Проверить и зафиксировать в `03-EXTERNAL_DEPENDENCIES.md`:

- [ ] Кто домен-регистратор `fancai.ru`? (по nameserver `ns1.vdsina.com` — скорее всего VDSina или Reg.ru)
- [ ] У какого провайдера VPS: VDSina (виртуально) — но физически Hetzner (по reverse-PTR `*.hotsrv.de`). Это значит, что для миграции на «такой же» VPS можно взять Hetzner Cloud напрямую (CCX или CPX серии).
- [ ] OpenRouter аккаунт — какой email, есть ли биллинг-card, остаток кредитов
- [ ] Yandex Cloud — для SMTP (есть SPF `_spf.cloud.yandex.net`); если письма больше не отправляются — можно убрать из планов
- [ ] HawkBit — проект ID, токен (значение в `.env` — `HAWK_TOKEN`, `VITE_HAWK_TOKEN`)

### 2.4. Решить три опциональных вопроса

| Вопрос                               | Default                               | Альтернатива                                                       |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Включать `nlp_models` (~3.16 GB)     | **Нет** (регенерируется за ~10 минут) | Да, если боишься лимитов на HuggingFace                            |
| Включать `vm_data` + Netdata cache   | **Нет**                               | Да, если хочешь сохранить историю метрик                           |
| Cold tar Postgres (downtime ~30 сек) | **Нет**                               | Да, для bit-perfect снапшота — но `pg_dump` сам по себе достаточен |

---

## 3. План исполнения бэкапа (вторник, ~30 минут)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 0. Pre-flight                                          ~2 мин   │
│  - SSH на сервер                                                    │
│  - Создать /var/backups/fancai-migration                            │
│  - Проверить df -h (нужно ≥5 GB свободно — есть 919 GB ✓)          │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 1. Запуск migration-backup.sh                          ~10 мин  │
│  AGE_RECIPIENT=age1xxx... bash scripts/migration-backup.sh          │
│  - System inventory + recon                                         │
│  - git bundle + working tree                                        │
│  - .env → encrypted age                                             │
│  - pg_dump custom + globals + alembic                               │
│  - Redis BGSAVE → dump.rdb.gz                                       │
│  - storage tar (books, generated_images)                            │
│  - volumes tar (caddy_data!, beat_schedule)                         │
│  - pgbackup-archive snapshot                                        │
│  - Manifest + sha256                                                │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 2. Verify integrity                                    ~3 мин   │
│  - sha256sum -c checksums.sha256                                    │
│  - pg_restore --list dump.custom (читается?)                        │
│  - tar -tzf storage/books.tar.gz | head                             │
│  - age -d -i ... env-bundle.tar.age | tar -tf - (расшифровывается?) │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 3. Off-site upload                                     ~5 мин   │
│  - rclone copy /var/backups/fancai-migration/...tar b2:fancai-migr/ │
│  - rclone copy ...sha256 b2:fancai-migration/                       │
│  - scp на локальный диск владельца                                  │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 4. 3-2-1 проверка                                      ~5 мин   │
│  Копия 1: /var/backups/fancai-migration/ на сервере                 │
│  Копия 2: B2 bucket s3://fancai-migration/                          │
│  Копия 3: ~/Documents/fancai-backups/ на локальной машине           │
│  Все три SHA256 совпадают                                           │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Шаг 5. Финальный отчёт                                     ~5 мин   │
│  Записать в MIGRATION_BACKUP_REPORT-YYYYMMDD.md:                    │
│  - URLs трёх копий                                                  │
│  - Master SHA256                                                    │
│  - Дата истечения retention (по умолчанию 12 месяцев)               │
└─────────────────────────────────────────────────────────────────────┘
```

**Итого:** ~30 минут. Из них реально активного времени человека ~10 минут — остальное скрипты.

---

## 4. Размер бэкапа — точные оценки на основе recon

| Компонент                             | Размер сырой | Размер сжатый                            | Включён по умолчанию |
| ------------------------------------- | ------------ | ---------------------------------------- | -------------------- |
| Postgres dump (custom)                | 88.71 MB     | ~30 MB                                   | ✓                    |
| Postgres dump (plain)                 | —            | ~25 MB                                   | ✓ (для удобства)     |
| Postgres globals                      | —            | <1 KB                                    | ✓                    |
| Redis dump.rdb                        | 41.78 MB     | ~20 MB                                   | ✓                    |
| Redis AOF                             | (если есть)  | —                                        | ✓ опционально        |
| storage/books                         | 56 MB        | ~50 MB (epub плохо жмётся)               | ✓                    |
| storage/generated_images              | 428 MB       | ~430 MB (PNG плохо жмётся)               | ✓                    |
| caddy_data (SSL!)                     | 16.52 KB     | ~10 KB                                   | ✓ КРИТИЧНО           |
| caddy_config                          | 5.2 KB       | ~3 KB                                    | ✓                    |
| beat_schedule                         | 24.58 KB     | ~10 KB                                   | ✓                    |
| nlp_models (HF cache)                 | 3.16 GB      | ~3 GB                                    | ✗ опционально        |
| vm_data (Victoria Metrics)            | 46 MB        | ~40 MB                                   | ✗ опционально        |
| kuma_data (Uptime Kuma)               | 7.26 MB      | ~6 MB                                    | ✗ опционально        |
| netdataconfig + lib + cache           | 2.27 GB      | ~50 MB (cache не сжимается, но не нужен) | ✗ опционально        |
| pgbackup-archive (последние 7 дней)   | 99 MB        | ~90 MB                                   | ✓                    |
| Code: git bundle                      | —            | ~50 MB                                   | ✓                    |
| Code: working tree (без node_modules) | —            | ~5 MB                                    | ✓                    |
| Secrets: .env (age-encrypted)         | 3.1 KB       | ~3 KB                                    | ✓                    |
| System metadata (cron, dpkg, ip…)     | —            | ~500 KB                                  | ✓                    |
| Docker compose-config-resolved        | —            | ~5 KB                                    | ✓                    |

**Ожидаемый размер финального tar (без опциональных):** ~700 MB
**С `nlp_models`:** ~3.7 GB
**С полным комплектом мониторинга и моделей:** ~3.9 GB

---

## 5. Сценарий миграции (что произойдёт когда удалят сервер)

> Этот раздел — **executive summary** для понимания общей картины. Детальный шаг-за-шагом — в `04-MIGRATION_RUNBOOK.md`.

```
[Старый сервер ушёл]
    │
    ├─ DNS A-record fancai.ru ещё указывает на 159.195.53.244 (down)
    ├─ Сайт: 502/timeout — пользователи не могут зайти
    ├─ AI-задачи в очереди Celery — потеряны (если не было свежего бэкапа)
    │
    ▼
[Hour 0 — Ты узнаёшь]
    │
    ├─ Скачать tar бэкапа из B2 (~30 секунд при 100 Мбит)
    ├─ Скачать age private key из 1Password
    │
    ▼
[Hour 0:15 — Заказ нового VPS]
    │
    ├─ Hetzner Cloud CCX33 (тот же класс, x86_64, 8 vCPU, 32 GB RAM)
    │   ИЛИ Selectel/VDSina/etc — главное та же арх + спеки
    ├─ Debian 13 минимальный образ
    ├─ Получить новый IP (например, 65.21.X.X для Hetzner)
    │
    ▼
[Hour 0:30 — SSH на новый сервер]
    │
    ├─ apt install docker.io docker-compose-plugin git age
    ├─ Залить tar и age key на сервер
    │
    ▼
[Hour 1:00 — Запуск migration-restore.sh]
    │
    ├─ Скрипт извлекает архив, верифицирует sha256
    ├─ Клонит код через git bundle, восстанавливает .env (age decrypt)
    ├─ Запускает postgres + redis
    ├─ pg_restore + redis dump.rdb
    ├─ Извлекает storage (books + images)
    ├─ Восстанавливает caddy_data → SSL-сертификаты сохраняются!
    ├─ docker compose up -d
    │
    ▼
[Hour 2:00 — Образы билдятся (если не были в бэкапе)]
    │
    ├─ docker compose build (PyTorch + GLiNER2 = 10-15 минут)
    ├─ Backend + frontend здоровы (healthcheck)
    │
    ▼
[Hour 2:30 — DNS переключение]
    │
    ├─ Войти в панель VDSina (или другой DNS-провайдер)
    ├─ Заранее снизить TTL до 60 сек (если есть доступ к старому)
    ├─ Поменять A: fancai.ru, www.fancai.ru → новый IP
    ├─ TTL пройдёт за <60 секунд
    │
    ▼
[Hour 2:45 — Caddy получает запросы по новому IP]
    │
    ├─ Если caddy_data перенесён: cert уже валиден — HTTPS работает мгновенно
    ├─ Если НЕ перенесён: Caddy запросит новый — 5-30 секунд (если не словил rate-limit)
    │
    ▼
[Hour 3:00 — UAT]
    │
    ├─ curl https://fancai.ru/api/v1/health → 200
    ├─ Логин в браузере → существующий пользователь работает
    ├─ Открытие книги → CFI-позиция сохранена
    ├─ Генерация описания → OpenRouter работает (тот же API key)
    ├─ Push-уведомления → VAPID keys те же
    │
    ▼
[Hour 4:00 — Всё работает]
```

**RTO:** ≤ 4 часа (соответствует существующему DR plan)
**RPO:** = «дата последнего migration-backup'а». Если делать раз в неделю — RPO до 7 дней.

---

## 6. Когда обновлять migration-backup

Этот бэкап — **insurance**, не replacement регулярного pgbackup.

**Запускать заново при:**

- Крупный feature release (значительное изменение схемы БД)
- Импорт большого количества пользовательских книг
- Смена SECRET_KEY (хотя зачем?)
- Смена OpenRouter API key
- Каждые **3 месяца** автоматически (cron на сервере, ротация в B2)

**Retention:**

- Локально на сервере: последние **3** miscation backup'а (по 700 MB = 2 GB total)
- B2: **12 месяцев** с тегом immutable (Object Lock — если включён)
- Локально у владельца: latest + previous (2 копии)

---

## 7. Тест миграции (опционально, но рекомендуется)

### 7.1. Зачем тестировать

Бэкап без проверенного restore — **theatre security**. Сценарий:

- Думаешь: «у меня всё забэкаплено»
- Реальность через 6 месяцев: pg_restore падает на конкретной миграции, age key потерян, sha256 не сходится — узнаёшь только в момент кризиса.

### 7.2. Как тестировать дёшево

**Вариант 1 (рекомендуется):** Hetzner Cloud CCX33 на 1 час

- Стоит ~€0.05 за час
- Достаточно для полного цикла restore
- Удалить после теста

**Вариант 2:** Локально через docker compose с другим compose-project

- Залить backup на macOS, скрипт `migration-restore.sh` адаптировать (без caddy/SSL)
- Проверить только Postgres + Redis + storage

**Вариант 3:** Не тестировать

- Risk: тебя устроит выяснить, что бэкап нерабочий, в момент когда сервер мёртв
- Не рекомендую

### 7.3. UAT после restore

См. `04-MIGRATION_RUNBOOK.md § 7` — там 14 пунктов smoke-тестов.

---

## 8. Риски и mitigations

| Риск                                                    | Вероятность             | Импакт   | Mitigation                                                                       |
| ------------------------------------------------------- | ----------------------- | -------- | -------------------------------------------------------------------------------- |
| Сервер удалят без предупреждения                        | Low                     | Critical | Off-site backup в B2 (вне юрисдикции VDSina)                                     |
| age private key потерян                                 | Medium                  | High     | Apple Keychain + 1Password + бумажная копия в сейф                               |
| Архитектура целевого VPS отличается                     | Low                     | Medium   | Проверять `uname -m` ДО заказа — Hetzner есть x86_64 повсеместно                 |
| pgvector версии не совпадут                             | Low                     | Medium   | Compose жёстко прописан `pgvector/pgvector:0.8.2-pg17`                           |
| Let's Encrypt rate-limit при первом запуске на новом IP | Medium (без caddy_data) | Low      | Перенос `caddy_data` volume — ACME account сохраняется                           |
| DNS не переключится быстро                              | Medium                  | Medium   | Заранее снизить TTL на A-record до 60 секунд                                     |
| Custom Docker images недоступны                         | Low                     | Medium   | Они в Git — `docker compose build` поднимет с нуля за ~15 минут                  |
| OpenRouter API key invalidated                          | Low                     | High     | Записать в `.env` и в 1Password дублёр — может потребоваться сгенерировать новый |
| Pgbackup `/backups/postgres` владелец `root`            | Verified                | Low      | Скрипт пытается через sudo, fallback без него                                    |
| Yandex SMTP — IP allowlist                              | Unknown                 | Low      | Запросить у Yandex Cloud добавление нового IP до миграции                        |

---

## 9. Чек-лист готовности к запуску

Прежде чем владелец нажмёт «погнали»:

### Технические

- [ ] age-keygen выполнен, public + private keys сохранены
- [ ] B2 (или другой облачный) bucket создан, application key получен
- [ ] `rclone config` настроен на новой машине (либо на сервере)
- [ ] Подтверждена доступность ≥5 GB на сервере (есть **919 GB ✓**)
- [ ] Подтверждено отсутствие активных long-running queries в Postgres
- [ ] Решение о `nlp_models` принято (включать или нет)

### Организационные

- [ ] Зафиксированы реквизиты VPS-провайдера (где хост, кому биллинг)
- [ ] Зафиксированы реквизиты DNS-провайдера и регистратора
- [ ] Зафиксирован OpenRouter аккаунт (email, биллинг)
- [ ] Зафиксирован Yandex Cloud аккаунт (если используется SMTP)
- [ ] Локальная копия будет на 1Password или Apple Keychain (не в Dropbox в открытом виде)

### Документация

- [ ] `00-RECON-REPORT.md` прочитан и согласован
- [ ] `02-BACKUP_INVENTORY.md` прочитан, нет «забытых» компонентов
- [ ] `03-EXTERNAL_DEPENDENCIES.md` заполнен реальными значениями (пока шаблон)
- [ ] `04-MIGRATION_RUNBOOK.md` mentally end-to-end пройден

---

## 10. Что делать прямо сейчас (после прочтения)

Минимальный action plan на ближайшие 60 минут:

```bash
# 1. Установить age (5 мин)
brew install age

# 2. Сгенерировать ключ (1 мин)
mkdir -p ~/.age && chmod 700 ~/.age
age-keygen -o ~/.age/fancai-migration.key
# скопировать public key (age1...) куда-то

# 3. Положить private key в 1Password / Keychain (5 мин)

# 4. Создать B2 bucket (10 мин)
# - https://www.backblaze.com/b2/cloud-storage.html
# - Bucket name: fancai-migration
# - Application key: fancai-write, scope = только этот bucket
# - Сохранить keyId + applicationKey в 1Password

# 5. Прочитать всю папку docs/operations/migration/ (15 мин)

# 6. Сделать pre-deploy commit с этой подготовкой (5 мин)
cd /Users/sandk/Documents/GitHub/fancai
git add docs/operations/migration scripts/migration-*.sh docs/prompts/2026-05-10-server-full-backup-migration.md
git commit -m "feat(ops): migration-grade backup tooling"
git push

# 7. Запустить бэкап на сервере (15 мин — но требует моего разрешения write-операций!)
ssh fancai
cd /opt/fancai/app
sudo mkdir -p /var/backups/fancai-migration
sudo chown deploy:deploy /var/backups/fancai-migration
git pull origin main  # получить наш скрипт
AGE_RECIPIENT="age1xxx..." bash scripts/migration-backup.sh

# 8. Скачать локально + загрузить в B2 (10 мин)
scp fancai:/var/backups/fancai-migration/fancai-migration-*.tar ~/Documents/fancai-backups/
rclone copy ~/Documents/fancai-backups/fancai-migration-*.tar b2:fancai-migration/
```

---

## 11. Контакты и ссылки

| Что                           | Где                                                               |
| ----------------------------- | ----------------------------------------------------------------- |
| Скрипты                       | `scripts/migration-backup.sh`, `scripts/migration-restore.sh`     |
| Промпт                        | `docs/prompts/2026-05-10-server-full-backup-migration.md`         |
| Существующий регулярный бэкап | `scripts/backup.sh` (продолжает работать, не заменяется)          |
| Pgbackup сервис               | `docker compose ps fancai_pgbackup` (ежедневно, 7 дней retention) |
| Прежний DR plan               | `docs/deployment/DISASTER_RECOVERY.md` (RTO 4h, RPO 24h)          |
| Прежняя backup doc            | `docs/operations/BACKUP_AND_RESTORE.md`                           |
| Production URL                | https://fancai.ru                                                 |
| Production IP                 | 159.195.53.244 (IPv4), `2a0a:4cc0:c1:d183::*` (IPv6)              |

---

**Статус документа:** готов к review.
**Следующий шаг владельца:** § 2 (4 пункта подготовки) → § 10 (запуск).
