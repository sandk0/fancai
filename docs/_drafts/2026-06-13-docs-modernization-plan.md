# План модернизации документации v2 (2026-06-13)

Артефакт Фазы 3. Опирается на `2026-06-13-docs-inventory.md` + `2026-06-13-doc-drift-matrix-v2.md`.

## Целевое дерево docs/

```
docs/
  README.md            # навигатор — перестроен, честный, без GSD
  SECURITY.md          # security policy (свод с backend/SECURITY.md)
  architecture/        # НОВОЕ: current «as-is» доки
    ai-pipeline.md     #   каноника AI (OpenRouter/gemini-2.5/flux) — закрывает §4.1
    overview.md        #   обзор системы (backend/frontend/infra) [опц.]
  deployment/          # прод-инфра (флэт) — мониторинг обновлён на Netdata/VM
  operations/          # runbooks (флэт) + migration/ (DR-пакет, проиндексирован)
  ci-cd/               # CI/CD (флэт)
  reports/ research/ plans/ prompts/ refactoring/ ios/ analysis/ design/
  questions/ superpowers/                       # историческое — контент не трогаем
  _archive/            # СЮДА всё историческое 2025 из nested-Diataxis
  _drafts/             # рабочие артефакты (этот файл и матрицы)
```

Удаляются как абстракция: `guides/`, `reference/` (как Diataxis-секции), `explanations/`, `development/`, `docs/ru/` — их контент в `_archive/` с сохранением путей; пустые `diagrams/`.

## Операции (по группам = коммиты)

### C1. Корневые факты (`docs:` коммиты)

- `README.md` + `README-ru.md`: test counts (76 backend/38 unit/8 e2e), AI-пайплайн (OpenRouter — единственный активный путь; google-genai = legacy), мониторинг-стек. Версии стека подтвердить (актуальны).
- `CHANGELOG.md`: Unreleased — GSD toolchain removed (2026-06-13), migration-readiness package added (2026-05-10), Gemini-Direct evaluated & deferred (май). Почистить Imagen/Grafana как активные.
- `CLAUDE.md`: проверить «Known CC Bugs»; AI-строка ОК.
- `AGENTS.md` / `GEMINI.md`: вырезать мёртвые GSD/Modal/NLP-ссылки (сохранить структуру).
- `backend/CLAUDE.md`, `frontend/CLAUDE.md`: LOC EpubReader (~910), Vite 8 (не 7), test-числа.

### C2. Навигатор + новые architecture-доки

- `docs/architecture/ai-pipeline.md` — НОВЫЙ канон (из drift-matrix §1.1).
- `docs/architecture/overview.md` — обзор [опц., по решению Q5].
- `docs/README.md` — перестроить: убрать GSD, исправить ложь про placeholder'ы, отразить новое дерево, дата 2026-06-13.

### C3. Архивирование исторического nested (главный долг)

- `git mv` (для tracked) / `mv` (untracked) всего 2025-контента из `guides/**`, `reference/**`, `explanations/**`, `development/<nested>`, `operations/<nested историч.>`, `ru/**` → `docs/_archive/<original-path>`.
- Обновить `docs/_archive/README.md` индексом.
- Удалить опустевшие Diataxis-дир (по Q3).

### C4. Мониторинг/deployment дрейф

- `deployment/MONITORING_SETUP.md` + `LOGGING_SETUP.md`: обновить на Netdata/VictoriaMetrics/Uptime-Kuma/Dozzle/Flower ИЛИ архивировать + краткий свежий `monitoring.md`.
- `PRODUCTION_INFRASTRUCTURE.md`: сверить домены/мониторинг.
- `operations/nlp-canary-deployment-runbook.md` → archive (NLP удалён).

### C5. Триаж untracked + research-консолидация

- `operations/migration/` — индекс в `operations/README.md`, commit.
- research gemini-кластер (~15): выбрать канонический, остальные → `_archive/research/` или дисклеймер; commit untracked прочее на свои места.
- `reports/2026-04-26-status-recap.md` — на месте, commit.

### C6. Гигиена

- удалить `docs/.DS_Store`, разобраться с `docs/.bg-shell/`, разместить `pencil-landing-prompt.md`/`variant-prompt.md` (→ design/ или archive), убрать пустую `diagrams/`.

## Порядок коммитов

C3 (archive, git mv) → C4 → C5 → C2 (architecture+navigator) → C1 (root) → финал. Навигатор после перемещений. Каждому живому доку — футер сверки 2026-06-13.

## Верификация (Фаза 5)

линк-чек скрипт (0 битых), грепы запрещённого в живых доках, smoke-тест Quick Start, навигатор=дерево 1:1.

## Открытые вопросы (чекпоинт)

- Q1 archive-агрессивность nested-2025 (рек: архивировать всё)
- Q2 docs/ru/ (рек: архивировать дерево, RU остаётся README-ru.md + живые доки по-русски)
- Q3 Diataxis-дир после архива (рек: удалить пустые)
- Q4 объём новых architecture-доков (рек: ai-pipeline.md обязательно + overview.md)
- Q5 ветка vs main (рек: main, как v1)
- Q6 AGENTS.md/GEMINI.md (рек: чинить факты, не сокращать радикально)
