---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Modal Batch Processing & Production Stability
status: Roadmap created — ready for /gsd:plan-phase 35
last_updated: "2026-03-27T19:00:00Z"
last_activity: 2026-03-27 — Roadmap v1.5 создан (4 фазы, 16 требований)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-27)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 35 — Стабилизация production semantics (корректные статусы, schema constraints, timeout защита)

## Текущая позиция

Phase: 35 (1 of 4 в v1.5) — Стабилизация production semantics
Plan: 0 of ? в текущей фазе
Status: Ready to plan
Last activity: 2026-03-27 — Roadmap v1.5 создан

Progress: [░░░░░░░░░░] 0%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | --           |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 8    | 21    | 4 дня  | --           |
| v1.3      | 10   | 14    | 9 дней | --           |
| v1.4      | 2/6  | 1/2   | 4 дня  | abandoned    |
| v1.5      | 0/4  | 0/?   | --     | --           |

## Накопленный контекст

### Решения

Полная таблица решений: .planning/PROJECT.md

- v1.4 -> v1.5: Стратегический разворот от self-hosted LLM к Modal batch + OpenRouter fallback
- Эталонный документ: `docs/research/FINAL-consolidated-audit.md` (перекрёстно проверен GPT 5.4)

### Блокеры/Опасения

- Production semantic corruption: `descriptions_extracted=True` при failed chapters (Phase 35 fix)
- vLLM Issue #37121 (OPEN): 7x KV cache overestimation для Qwen3.5 (Phase 35 workaround)
- vLLM Issue #16732 (closed, not fixed): batch error isolation отсутствует (Phase 37 pre-validation)
- Phase 37 требует phase research перед планированием (sub-batch size, KV cache profiling)

### Текущее состояние production (baseline)

- Modal pipeline: `USE_MODAL_PIPELINE = true`, Qwen3.5-9B на L40S ($1.95/hr)
- Sequential mode (Semaphore=1), LLM_TIMEOUT=600s
- 10/23 глав падают (timeout + broken JSON)
- `descriptions_extracted=True` безусловно (semantic corruption)
- `maxLength` в schemas отсутствует, `num_gpu_blocks_override` отсутствует

## Непрерывность сессий

Последняя сессия: 2026-03-28
Остановка: Phase 35 context gathered (discuss-phase)
Файл возобновления: `.planning/phases/35-production-semantics/35-CONTEXT.md`
Следующий шаг: `/gsd:plan-phase 35`
