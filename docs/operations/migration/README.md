# Migration Documentation

Полный комплект артефактов для **insurance backup** и **миграции** fancai на идентичный VPS.

> **Контекст:** владелец опасается удаления текущего сервера; на нём — single source of truth (свежий код + EPUB пользователей + AI-сгенерированные изображения). Этот пакет даёт возможность поднять идентичный сервис с нуля за ≤ 4 часа.

---

## 📂 Структура папки

| Файл                                                       | Назначение                                                                         | Когда читать                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| **[01-MIGRATION_PLAN.md](01-MIGRATION_PLAN.md)**           | Главный план — TL;DR, что сделано, что нужно от владельца, action plan на 60 минут | **Начни отсюда**                     |
| [00-RECON-REPORT.md](00-RECON-REPORT.md)                   | Реальный snapshot production-сервера (recon на 2026-05-10)                         | Для понимания текущего состояния     |
| [02-BACKUP_INVENTORY.md](02-BACKUP_INVENTORY.md)           | Таблица всех компонентов с размерами и критичностью                                | Когда нужно понять что и как бэкапим |
| [03-EXTERNAL_DEPENDENCIES.md](03-EXTERNAL_DEPENDENCIES.md) | DNS, VPS, OpenRouter, регистратор — `<TODO>` поля для заполнения                   | Заполнить **до** запуска бэкапа      |
| [04-MIGRATION_RUNBOOK.md](04-MIGRATION_RUNBOOK.md)         | Пошаговое восстановление на новом VPS — 11 этапов                                  | Когда сервер упал и нужно поднимать  |
| README.md                                                  | Этот файл                                                                          | Точка входа                          |

---

## 🛠 Инструменты

| Скрипт                       | Локация                                                                                                               | Назначение                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `migration-backup.sh`        | [`scripts/migration-backup.sh`](../../../scripts/migration-backup.sh)                                                 | Создание migration-grade бэкапа на сервере       |
| `migration-restore.sh`       | [`scripts/migration-restore.sh`](../../../scripts/migration-restore.sh)                                               | Восстановление на новом VPS                      |
| `backup.sh` (existing)       | [`scripts/backup.sh`](../../../scripts/backup.sh)                                                                     | Регулярный бэкап (продолжает работать ежедневно) |
| `restore.sh` (existing)      | [`scripts/restore.sh`](../../../scripts/restore.sh)                                                                   | Восстановление из регулярного бэкапа             |
| Промпт для повторного аудита | [`docs/prompts/2026-05-10-server-full-backup-migration.md`](../../prompts/2026-05-10-server-full-backup-migration.md) | Если нужно повторить под Opus 4.7                |

---

## 🚦 Как пользоваться

### Сценарий 1: Создать первый migration-backup

```
[Прочитать 01-MIGRATION_PLAN.md § 0-3]
         ↓
[Заполнить 03-EXTERNAL_DEPENDENCIES.md (твои реквизиты)]
         ↓
[Сгенерировать age key, создать B2 bucket]
         ↓
[Запустить scripts/migration-backup.sh на сервере]
         ↓
[Verify checksums (см. 02-BACKUP_INVENTORY.md § 11)]
         ↓
[Загрузить в B2 + локально → 3-2-1 готово]
```

### Сценарий 2: Сервер упал, восстанавливаем

```
[Прочитать 04-MIGRATION_RUNBOOK.md § 1-2]
         ↓
[Заказать новый VPS (Hetzner CCX33) — 5 мин]
         ↓
[Подготовить новый VPS — 10 мин]
         ↓
[Скачать backup на сервер — 5 мин]
         ↓
[Запустить scripts/migration-restore.sh — 30-60 мин]
         ↓
[Build custom images если нужно — 15 мин]
         ↓
[Сменить DNS A-record — 5 мин + TTL]
         ↓
[Smoke tests UAT (см. § 8) — 15 мин]
         ↓
[Финализация → стек живой]
```

### Сценарий 3: Регулярная репетиция (раз в 6 месяцев)

```
[Заказать одноразовый CCX33 на 1 час — €0.05]
         ↓
[Прогнать 04-MIGRATION_RUNBOOK.md от начала до конца]
         ↓
[UAT smoke tests]
         ↓
[Удалить тестовый VPS]
         ↓
[Записать lessons learned, обновить runbook]
```

---

## ⚡ Quick reference (для случая «прямо сейчас, что нажимать»)

### Backup на сервере

```bash
ssh fancai
cd /opt/fancai/app
git pull origin main  # получить свежие migration-* скрипты

# Один раз на хосте
sudo mkdir -p /var/backups/fancai-migration
sudo chown deploy:deploy /var/backups/fancai-migration

# Запуск (нужен age public key владельца)
AGE_RECIPIENT="age1..." \
    bash scripts/migration-backup.sh
```

### Восстановление на новом сервере

```bash
ssh deploy@<NEW_IP>
git clone https://github.com/sandk0/fancai.git ~/fancai-tmp

sudo BACKUP_ARCHIVE=~/migration-restore/fancai-migration-XXX.tar \
     AGE_IDENTITY=/tmp/age-key \
     bash ~/fancai-tmp/scripts/migration-restore.sh
```

---

## 📊 Размеры (по recon 2026-05-10)

| Что                                  | Размер      |
| ------------------------------------ | ----------- |
| Минимальный migration-backup         | **~715 MB** |
| С `nlp_models` (~3 GB)               | ~3.9 GB     |
| С полным комплектом мониторинга      | ~6.2 GB     |
| Свободно на сервере                  | 919 GB      |
| Свободно для off-site (B2 free tier) | 10 GB       |

**Сжатый бэкап лежит вместе на B2 бесплатно (даже при ежемесячных снимках).**

---

## 🔐 Безопасность

- Все секреты (`.env`, ssh-keys) шифруются через [age](https://github.com/FiloSottile/age)
- Public key — у владельца, добавляется через env var `AGE_RECIPIENT` при бэкапе
- Private key — **никогда** не попадает в архив; хранится в 1Password / Apple Keychain + бумажная копия в сейфе
- Связь с off-site по HTTPS (B2/S3 API + TLS)
- SHA256 чексуммы на каждый артефакт + master tar

---

## 📅 График активностей

| Когда                                     | Что                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| **Сейчас (после получения этого пакета)** | Заполнить `03-EXTERNAL_DEPENDENCIES.md`                                |
| **В течение 24 часов**                    | Сгенерировать age key, настроить B2, запустить первый migration-backup |
| **Раз в 3 месяца**                        | Создать новый migration-backup (override старый, ротация в B2)         |
| **Раз в 6 месяцев**                       | Dry-run migration на одноразовом VPS                                   |
| **При крупных изменениях**                | Внеплановый migration-backup (новые поля БД, смена ключей и т.п.)      |

---

## 🤖 AI-prompt для повтора

Если в будущем потребуется повторить весь анализ — есть готовый промпт:

```
docs/prompts/2026-05-10-server-full-backup-migration.md
```

Он содержит **22 KB** инструкций для Claude Opus 4.7 max effort:

- Определяет роль (Senior SRE)
- Контекст fancai стека
- 7 этапов работы (recon → inventory → strategy → execute → off-site → runbook → tests)
- 11 чек-листов компонентов
- Стоп-листы (что НЕ делать)
- Troubleshooting сценарии

Запустить как:

```bash
cat docs/prompts/2026-05-10-server-full-backup-migration.md | pbcopy
# → вставить в новую сессию Claude Code (с SSH-доступом к серверу)
# → дать команду «Изучи промпт, дай план, жди подтверждение»
```

---

## ❓ FAQ

**Q: Нужно ли удалять `scripts/backup.sh` (existing)?**
A: **Нет.** Он продолжает делать регулярные ежедневные снимки в `./backups/`. Это вторичная страховка.

**Q: Нужно ли удалять `pgbackup` контейнер?**
A: **Нет.** Он делает daily pg_dump каждый день в 02:00 UTC. Migration-backup забирает копию его архива дополнительно.

**Q: Что если у меня нет 1Password / Keychain?**
A: Используй любой password manager с E2E encryption. Главное — **не** Dropbox / Google Drive в открытом виде. Бумажная копия age key в сейфе тоже работает.

**Q: Что если я хочу сменить VPS-провайдера сейчас, без аварии?**
A: Используй runbook как plan для **плановой** миграции — отличается тем, что у тебя есть время на «watch-period» (старый сервер работает параллельно), снизить TTL заранее, и `migration-backup.sh` запустить за 30 минут до часа X для свежего snapshot.

**Q: Можно ли мне бэкапить ежедневно автоматически?**
A: Да, но избыточно — `pgbackup` уже делает daily pg_dump. Migration-backup нужен **point-in-time** снимок всего стека, обычно раз в 1-3 месяца. Если хочешь автоматизацию — добавь cron на сервере с прокаткой в B2.

**Q: Что если мой age key компрометирован?**
A: Сгенерировать новый, перешифровать существующие бэкапы (decrypt + encrypt), удалить старые версии в B2.

---

## ✉️ Контакты

| Роль                | Контакт                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| Owner               | sandkme@gmail.com                                                             |
| Production URL      | https://fancai.ru                                                             |
| GitHub              | https://github.com/sandk0/fancai                                              |
| Existing DR plan    | [docs/deployment/DISASTER_RECOVERY.md](../../deployment/DISASTER_RECOVERY.md) |
| Existing backup doc | [docs/operations/BACKUP_AND_RESTORE.md](../BACKUP_AND_RESTORE.md)             |

---

**Создано 2026-05-10. Обновляется при каждой ротации backup'а или изменении инфраструктуры.**
