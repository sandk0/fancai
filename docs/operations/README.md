# Operations

Day-2 операции: бэкапы, восстановление, прокси, runbook'и.

> Production deploy и infrastructure setup — в [`../deployment/`](../deployment/).
> CI/CD pipeline — в [`../ci-cd/`](../ci-cd/).

## Содержание

| Файл                                                                       | Описание                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md)                           | Процедуры backup и restore PostgreSQL                                                                                                       |
| [`BACKUP_AND_RESTORE.ru.md`](BACKUP_AND_RESTORE.ru.md)                     | То же на русском                                                                                                                            |
| [`VLESS_QUICK_REFERENCE.md`](VLESS_QUICK_REFERENCE.md)                     | Быстрые команды для VLESS proxy                                                                                                             |
| [`VLESS_PROXY_RESEARCH_2025-11-30.md`](VLESS_PROXY_RESEARCH_2025-11-30.md) | Research-документ по VLESS (snapshot 2025-11-30)                                                                                            |
| [`migration/`](migration/)                                                 | Пакет аварийной готовности / миграции сервера (recon, plan, inventory, runbook; 2026-05-10) — RTO ≤ 4ч. Страховка, не исполненное действие. |

## Конвенции

- **Live runbook** (нужен и сейчас, и через год) — без datestamp в имени
- **Snapshot research** (привязан ко времени) — `<topic>_<YYYY-MM-DD>.md`

---

_Последнее обновление: 2026-06-13. Сверено с: `docs/operations/migration/`, `scripts/`._
