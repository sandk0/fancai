# Development

Эта директория после модернизации документации (2026-04-30) практически
пуста — основная информация для разработчиков теперь живёт ближе к коду.

## Куда идти

| Что нужно                              | Где это                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| Setup, conventions, PR-процесс         | [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)                     |
| Backend Python/FastAPI rules           | [`../../backend/CLAUDE.md`](../../backend/CLAUDE.md)                 |
| Frontend React/Vite rules              | [`../../frontend/CLAUDE.md`](../../frontend/CLAUDE.md)               |
| Reader/EPUB-специфичные правила        | [`../../.claude/rules/reader.md`](../../.claude/rules/reader.md)     |
| iOS/theme/Reader frontend rules        | [`../../.claude/rules/frontend.md`](../../.claude/rules/frontend.md) |
| GSD planning artifacts                 | [`../../.planning/`](../../.planning/)                               |
| Текущий phase / state                  | [`../../.planning/STATE.md`](../../.planning/STATE.md)               |
| Roadmap                                | [`../../.planning/ROADMAP.md`](../../.planning/ROADMAP.md)           |
| Milestone history                      | [`../../.planning/MILESTONES.md`](../../.planning/MILESTONES.md)     |
| Changelog                              | [`../../CHANGELOG.md`](../../CHANGELOG.md)                           |
| Исторические dev-отчёты (Oct–Nov 2025) | [`../_archive/development/`](../_archive/development/)               |

## Когда писать что-то сюда

Live development документ (например, post-mortem паттерн отладки конкретной
системы, который останется полезным надолго) — добавляйте сюда с осмысленным
именем, без даты в названии.

Snapshot отчёта или анализа (актуален в момент написания, через год
устареет) — кладите в [`../reports/`](../reports/) с datestamp:
`YYYY-MM-DD-<topic>.md`.

---

_Last updated: 2026-04-30._
