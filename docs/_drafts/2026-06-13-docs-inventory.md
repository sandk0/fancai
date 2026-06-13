# Инвентарь документации (2026-06-13) — проход v2

Артефакт Фазы 0. Полная карта `.md` с классификацией. Источник истины — код (см. drift-matrix-v2).

## Сводные числа

| Множество                                  | Кол-во                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Корневые `.md`                             | 7 (README, README-ru, CHANGELOG, CONTRIBUTING, CLAUDE, AGENTS, GEMINI) |
| Вложенные agent-доки                       | 3 (backend/CLAUDE.md, frontend/CLAUDE.md, backend/SECURITY.md)         |
| `docs/**/*.md` всего                       | 873                                                                    |
| из них `docs/reports/` (историч. снапшоты) | 530 — **контент не трогаем**                                           |
| `docs/` без reports                        | 343                                                                    |

## Что менялось ПОСЛЕ v1 (newer than `docs/reports/2026-04-30-documentation-modernization.md`)

Ни один **существующий** живой док не правился после 30 апреля. Появились только НОВЫЕ (untracked):

- `docs/operations/migration/` (6 файлов, 2026-05-10) — пакет аварийной готовности/миграции сервера
- `docs/plans/2026-05-03-gemini-direct-migration-plan-v2-with-audits.md`
- `docs/prompts/2026-05-04-…`, `2026-05-10-…`, `2026-06-13-…`
- кластер `docs/research/*gemini*`, `PROMPT-*`, `_drafts/` (~15 untracked)
- `docs/reports/2026-04-26-status-recap.md`

⇒ **дрейф = код ушёл вперёд (май-июнь), живые доки заморожены на состоянии v1.**

## СТРУКТУРНАЯ НАХОДКА: docs/ не плоский (v1 и docs/README ошибаются)

`docs/README.md` называет `guides/`, `reference/`, `explanations/` «пустыми Diataxis-плейсхолдерами», а `development/` «минимальным». **Реальность:** под ними глубоко вложен исторический контент 2025-го.

Распределение **вложенного** контента по датам:

| Период               | Файлов |
| -------------------- | ------ |
| 2025-10              | 21     |
| 2025-11              | 86     |
| 2025-12              | 14     |
| 2026-01              | 12     |
| 2026-04 (README v1)  | 7      |
| 2026-05 (migration/) | 6      |

⇒ **~133 файла 2025-го** в `guides/{getting-started,deployment,development,backend,testing,agents,frontend}/`, `reference/{database,cli,components,nlp,api}/`, `explanations/{design-decisions,agents-system,architecture,concepts}/`, `development/{changelog,planning,status,parser,testing,performance}/`, `operations/{docker,redis,postgres,nginx,deployment,maintenance,backup}/`.

`docs/ru/` — большое параллельное русское дерево (36 подпапок), зеркалит EN-структуру, контент 2025-го. «Двойная бухгалтерия».

## Классификация каталогов

### Живые операционные (плоский верхний уровень — в основном валидны)

- `docs/deployment/*.md` (11) — инфра-доки прод; **подозрение на дрейф мониторинга** (Prometheus/Grafana/Loki → Netdata/VictoriaMetrics)
- `docs/operations/*.md` (флэт: BACKUP_AND_RESTORE, VLESS) + `operations/migration/` (новое, держим)
- `docs/ci-cd/*.md` (8) — CI/CD
- `docs/README.md`, `docs/SECURITY.md` — навигатор + security policy

### Каталоги-README + вложенный исторический контент (главный долг)

- `docs/guides/` (40), `docs/reference/` (27), `docs/explanations/` (16), `docs/development/` (18), `docs/operations/<nested>/`, `docs/ru/` (16+вложенное) — README от v1, под ними 2025-историческое

### Чисто исторические архивы (только индексация/перемещение)

- `docs/reports/` (530), `docs/research/` (79), `docs/plans/` (16), `docs/prompts/` (30), `docs/refactoring/` (12), `docs/ios/` (6), `docs/analysis/`, `docs/design/`, `docs/questions/`, `docs/superpowers/`, `docs/_archive/` (22)

### Мусор/гигиена

- `docs/.DS_Store`, `docs/.bg-shell/`, `docs/pencil-landing-prompt.md`, `docs/variant-prompt.md` (landing-промпты в корне docs/), пустая `docs/diagrams/`

## Untracked-доки на триаж

`docs/operations/migration/*` (держим+индекс), `docs/plans/2026-05-03-gemini-direct-*`, `docs/prompts/2026-05-{04,10}-*`, `docs/reports/2026-04-26-status-recap.md`, `docs/research/{gemini-*,PROMPT-*,kieai-*,sdd-*,fine-tuning-*,_drafts/}` (~15 — консолидация→archive).

_Артефакт Фазы 0. Дополняется по ходу. См. `2026-06-13-doc-drift-matrix-v2.md`._
