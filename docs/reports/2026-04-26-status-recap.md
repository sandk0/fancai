# Состояние проекта fancai на 2026-04-26 — recap

**Дата:** 2026-04-26
**Scope:** восстановление контекста после ~3-недельной паузы; синхронизация GSD `STATE.md` / `ROADMAP.md` с реальностью; идентификация открытых направлений
**Автор:** Claude Code (Opus 4.7, 1M context)
**Источники:** session JSONL `~/.claude/projects/-Users-sandk-Documents-GitHub-fancai/`, `git log`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `MEMORY.md`, `docs/research/`

---

## 1. Executive Summary

Реальная продуктовая работа над fancai остановилась **30 марта 2026** на резком развороте от Modal batch к OpenRouter-оптимизации (Gemini 2.5 Flash tiered + 3.1 Flash Lite). Между 30 марта и 24 апреля проект был в фактической паузе. Активность 24-26 апреля носит организационный характер: обновление GSD toolchain v1.32 → v1.38.3 и сравнительный research SDD-инструментов с выводом «не мигрировать с GSD».

GSD `STATE.md` и `ROADMAP.md` остались замороженными на снимке 28 марта (Phase 37 Plan 01 завершён, Plan 02 «следующий») — это противоречит реальному решению отказаться от Modal pipeline. Самое крупное **незапущенное** проектное направление — план админ-панели Gemini API от 31 марта (`docs/research/gemini-admin-panel-plan-2026-03-31.md`).

---

## 2. Findings

### 2.1 Хронология (детальная)

| Дата           | Событие                                                                                                          | Артефакт                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 2026-03-28     | Phase 37 Plan 01 завершён (3 коммита, 26 тестов)                                                                 | STATE.md, `52261d21..1e9ebd5a`                                      |
| 2026-03-29     | Phase 37 staging провалился: batch отрабатывал 40+ мин вместо 7-8 мин                                            | MEMORY.md `project_modal_abandoned.md`                              |
| 2026-03-29     | Phase 37 staging fix попытки: `d1eef1e0` (Modal SDK 1.4.0 compat), `0b2b3a45` (Gemini 3.1 Flash Lite -75% input) | git                                                                 |
| 2026-03-29     | CSP / SW hotfixes: `7a373d7f`, `c0b5bdfb`                                                                        | git                                                                 |
| 2026-03-30     | Полная перестановка приоритетов: `feat(ai): switch LLM to Qwen3.5-397B for A/B testing` (`e8f6a2f0`)             | git                                                                 |
| 2026-03-30     | A/B завершён: `feat(ai): switch to Gemini 2.5 Flash tiered strategy after Qwen3.5 A/B test` (`5f6f3093`)         | git                                                                 |
| 2026-03-30..31 | Серия research-документов о Gemini API (caching, batch, fine-tuning, model optimization, admin panel)            | `docs/research/gemini-*`                                            |
| 2026-04-05     | Промпт SDD comparison написан (`PROMPT-sdd-tools-comparison.md`)                                                 | docs                                                                |
| 2026-04-05..23 | **Пауза по продукту: 18 дней без коммитов**                                                                      | git                                                                 |
| 2026-04-24     | Обновление GSD toolchain v1.32.0 → v1.38.3 (`cededd96`, +4491/-188, 60 файлов)                                   | git, session `f6fe6e38`                                             |
| 2026-04-26     | Research SDD tools (6 параллельных агентов, 19 инструментов сравнено)                                            | `docs/research/sdd-tools-comparison-2026-04.md`, session `a6793b44` |
| 2026-04-26     | Текущая сессия — recap                                                                                           | этот отчёт                                                          |

### 2.2 Расхождение между источниками истины

| Источник                    | Состояние v1.5                            | Состояние Phase 37                | Состояние Phase 38 |
| --------------------------- | ----------------------------------------- | --------------------------------- | ------------------ |
| `.planning/STATE.md`        | in_progress (85%)                         | Plan 01 done, Plan 02 «следующий» | not started        |
| `.planning/ROADMAP.md`      | in progress                               | Plan 01 done, Plan 02 not started | TBD                |
| `MEMORY.md`                 | partially shipped                         | staging failed (40+ min)          | cancelled          |
| Реальность (git + behavior) | Phases 35-36 в проде, остальное abandoned | Code не дошёл до production       | Не начато          |

`STATE.md` отстал на 28 дней. `MEMORY.md` ближе к правде.

### 2.3 Незапущенные направления (открытые планы и аудиты)

1. **`docs/research/gemini-admin-panel-plan-2026-03-31.md`** — детальный план: вынести всю runtime-конфигурацию Gemini API в админ-панель, поддержать Direct API + OpenRouter одновременно, версионирование настроек, A/B-тесты, audit trail. Диагностика текущей админки: `frontend/src/pages/AdminDashboardEnhanced.tsx` имеет лишь placeholders для images/system/users; `backend/app/services/gemini_extractor.py` хранит `GeminiConfig` hardcoded в коде. План **не начат**.

2. **`docs/research/gemini-api-consolidated.md`** + **`gemini-api-consolidated-merged-audit-2026-03-31.md`** — финальный справочник по моделям и ценам Gemini 3.x / 2.5. Решение записано: `gemini-3-flash-preview` baseline, `3.1 Pro` для hard cases, `3.1 Flash-Lite` для дешёвого tier. Реализация частично выполнена в `0b2b3a45` (переход на 3.1 Flash Lite), но без админ-панели и без tier-routing.

3. **`docs/research/gemini-context-caching-batch-api-research.md`** + **`gemini-api-direct-integration-research.md`** — обоснование перехода с OpenRouter на Direct Gemini API (для batch + caching + File Search). Не реализовано.

4. **`docs/research/fine-tuning-distillation-research-2026-03.md`** + **`2026-03-30-llm-model-optimization.md`** — исследование fine-tuning / distillation как альтернативы prompt engineering. Информационное, без actionable плана.

5. **`docs/research/sdd-tools-comparison-2026-04.md`** — вывод «не мигрировать с GSD», quick wins: обновить GSD до v1.33.0+ (выполнено: 1.38.3), наблюдать за Augment Intent. Только информационное.

### 2.4 Что было сделано вне GSD после 28 марта

GSD не отслеживал работу после Phase 37 Plan 01. Реальные коммиты:

- `5f6f3093 feat(ai): switch to Gemini 2.5 Flash tiered strategy after Qwen3.5 A/B test`
- `e8f6a2f0 feat(ai): switch LLM to Qwen3.5-397B for A/B testing Russian extraction`
- `c0b5bdfb fix(sw): check preloadResponse.ok before using navigation preload`
- `7a373d7f fix(csp): add blob: and data: to font-src for epub.js book fonts`
- `ab2ec5ca fix: remove gemini-3-flash from fallback chain, update tests`
- `0b2b3a45 feat: switch primary LLM to Gemini 3.1 Flash Lite (-75% input cost)`
- `d1eef1e0 fix(modal): move .env() before .add_local_dir() for SDK 1.4.0 compat`
- `d8e38aea fix(security): redact exposed OpenRouter API key from research doc`
- `cededd96 chore(gsd): sync GSD toolchain update + ultrareview fixes` (организационно)

Эти изменения **не имеют PLAN-файлов**, не учтены в `STATE.md`, не привязаны к Phase. Это «вне-фазовая» техническая стабилизация и быстрый pivot к Gemini.

---

## 3. Recommendations

| #   | Действие                                                                                      | Приоритет | Сложность | Обоснование                                                  |
| --- | --------------------------------------------------------------------------------------------- | --------- | --------- | ------------------------------------------------------------ |
| 1   | Закрыть Phase 37 Plan 02 как abandoned, Phase 38 как cancelled                                | P0        | Низкая    | Расхождение `STATE.md` ↔ memory активно вводит в заблуждение |
| 2   | Переоформить v1.5 в `partially_shipped`: 35-36 в проде, 37/38 abandoned                       | P0        | Низкая    | Соответствует реальности и memory                            |
| 3   | Зафиксировать pivot к Gemini в `STATE.md` решениях (entries для `0b2b3a45`, `5f6f3093`)       | P1        | Низкая    | Это архитектурное решение, не должно теряться                |
| 4   | Создать v1.6 milestone (Gemini Direct + admin panel) или открыть phase 39+                    | P1        | Средняя   | Есть готовый план — `gemini-admin-panel-plan-2026-03-31.md`  |
| 5   | Обновить `MEMORY.md` ссылки и last_activity → 2026-04-26                                      | P2        | Низкая    | Auto-memory должна быть актуальна                            |
| 6   | Перенести SDD comparison решение в STATE.md decisions (toolchain locked on GSD + SuperPowers) | P2        | Низкая    | Чтобы не пересматривать раз в квартал                        |

---

## 4. Next Steps (после этого recap)

1. **Применить рекомендации 1, 2, 3** в этой же сессии — синхронизировать `STATE.md` и `ROADMAP.md`.
2. **Решить с пользователем:** запускать ли Gemini admin panel как новую активную работу (рекомендация 4) или оставить как backlog. Это требует продуктового решения, не технического.
3. **Проверить продакшен:** Gemini 3.1 Flash Lite в проде с 29 марта — нужна ли retro-проверка cost/latency метрик за месяц.
4. **При следующем `/gsd-new-milestone`** — взять за основу `docs/research/gemini-admin-panel-plan-2026-03-31.md` как готовый scope.

---

## 5. Appendix

### 5.1 Изменённые/появившиеся файлы по периодам

**Период активной работы (2026-03-28..30):**

- `backend/app/services/llm_extractor.py` — A/B Qwen3.5 → Gemini 2.5 Flash tiered
- `backend/app/core/openrouter_client.py` — Gemini 3.1 Flash Lite primary, Gemini 3.0 Flash из fallback chain убран
- `backend/modal/` — попытки исправить Modal SDK 1.4.0 compat
- `frontend/public/sw.js` — preloadResponse.ok check
- `frontend/index.html` — CSP font-src

**Период organizational drift (2026-04-24..26):**

- `.claude/agents/gsd-*.md` — обновлены installer'ом до v1.38.3
- `.claude/commands/gsd/*.md` — 81 команда переустановлена
- `.claude/get-shit-done/references/` — 48 новых reference-файлов
- `.claude/hooks/gsd-*` — 6 новых хуков
- `.claude/settings.json` — wiring новых хуков
- `docs/research/sdd-tools-comparison-2026-04.md` — отчёт SDD comparison

### 5.2 Конфликт terminologies

`MEMORY.md` использует тег «Modal Abandoned». В терминологии GSD `abandoned` применялось ранее к v1.4 (целиком отброшен milestone). Для v1.5 точнее `partially_shipped` или `closed_partial` — потому что Phase 35-36 успешно в продакшене и принесли пользу (typed errors, reconciliation, status semantics).

### 5.3 Карта session-логов (последние 10)

| File       | Date             | Size  | Сюжет                                         |
| ---------- | ---------------- | ----- | --------------------------------------------- |
| `99c71e68` | 2026-04-26 21:22 | 73KB  | Текущая (этот recap)                          |
| `a6793b44` | 2026-04-26 21:19 | 532KB | SDD tools comparison (6 параллельных агентов) |
| `f6fe6e38` | 2026-04-24 03:27 | 421KB | GSD update wiring + staging fixes             |
| `70750507` | 2026-04-24 01:30 | 396KB | GSD installer v1.32 → v1.38.3                 |
| `b3f0903e` | 2026-04-15 04:47 | dir   | (короткая)                                    |
| `b77db4f5` | 2026-04-14 16:05 | dir   | (короткая)                                    |
| `487f3457` | 2026-04-14 04:02 | dir   | (короткая)                                    |
| `49a6b9ec` | 2026-04-12 19:27 | dir   | (короткая)                                    |
| `b0d73197` | 2026-04-11 21:13 | dir   | (короткая)                                    |

Между 5 апреля и 23 апреля — короткие session-директории без значительных JSONL-файлов, что подтверждает паузу.

### 5.4 Что НЕ было сделано (несмотря на наличие планов)

- Gemini admin panel (план есть, нет реализации)
- Direct Gemini API integration (research есть, нет переключения с OpenRouter)
- Phase 37 Plan 02 (Modal batch orchestration) — отброшено молча, без формального decision-record
- Phase 38 (Auto-fallback Modal → OpenRouter) — отброшено вместе с Modal pivot

---

**Контрольный вопрос для следующей сессии:** запускать ли новый milestone v1.6 «Gemini Direct + Admin Panel» с `docs/research/gemini-admin-panel-plan-2026-03-31.md` как scope, или сначала закрыть operational debt (метрики Gemini 3.1 Flash Lite за месяц, проверка падения cost)?
