---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: iOS Reader Navigation Fixes
status: Phase 27 Plan 01 завершена (choices validation + 400/429 handling)
last_updated: "2026-03-16T18:52:40.814Z"
last_activity: 2026-03-16 — Phase 27 Plan 01 завершена (choices validation + 400/429 handling, 5 min)
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 8
  completed_plans: 7
  percent: 87
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-14)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 27 (OpenRouter FLUX.2 retry и error handling). Plan 01 завершена, Plan 02 следующая.

## Текущая позиция

Phase: 27 (7 of 7) — Надёжность генерации изображений (OpenRouter FLUX.2 retry и error handling)
Plan: 01 of 02 (Plan 01 завершена)
Status: Phase 27 Plan 01 завершена (choices validation + 400/429 handling)
Last activity: 2026-03-16 — Phase 27 Plan 01 завершена (choices validation + 400/429 handling, 5 min)

Progress: [████████░░] 87%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | --           |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 8    | 21    | 4 дня  | --           |
| v1.3      | 5    | —     | —      | —            |

## Накопленный контекст

### Решения

Полная таблица решений: .planning/PROJECT.md

- Корневая причина: iOS Safari НЕ доставляет touch events в iframe contentDocument (100% source:parent)
- Стратегия фикса: полноэкранный iOS overlay с FSM для всех жестов (Phase 22)
- Overlay left:10px для Safari back gesture, touch-action:none
- FSM вынесена в shared utility gestureUtils.ts (Phase 23 Plan 01)
- Shared touchRef между overlay и iframe handler (platform-exclusive)
- Shared FSM через dependency injection (GestureFSMDeps interface)
- Overlay top динамический: 0 в immersive, safe-area+64px с header
- UAT на iPhone 15 Pro: все 8 проверок пройдены (Safari, Chrome, PWA) -- Phase 23 Plan 02
- Строго последовательный pipeline: каждая фаза зависит от предыдущей
- TQ useQuery refetchInterval заменяет ручной setInterval для Celery task polling (Phase 26 Plan 02)
- Visibility пауза через встроенный focusManager вместо useVisibilityManager (Phase 26 Plan 02)
- useImageForDescription TQ query как SSoT для изображений в DescriptionDrawer (Phase 26 Plan 01)
- mutation.reset() при смене описания для предотвращения stale data (Phase 26 Plan 01)
- imageKeys.byBook инвалидация в useGenerateImage для обновления images[] (Phase 26 Plan 01)
- ValueError для HTTP 400 (non-retryable), RateLimitError для HTTP 429 (retryable) в generate_image (Phase 27 Plan 01)
- RuntimeError для missing choices в OpenRouter ответе -- транзиентная ошибка (Phase 27 Plan 01)
- Structured logging extra: model, duration, response_preview, prompt_preview (Phase 27 Plan 01)

### Ожидающие задачи

Нет.

### Эволюция Roadmap

- Phase 26 добавлена: fix(images): исправить баги генерации и отображения изображений в читалке
- Phase 27 добавлена: Надёжность генерации изображений (OpenRouter FLUX.2 retry и error handling)

### Блокеры/Опасения

- Противоречие `touch-action: pan-x pan-y` vs `manipulation` на iOS -- разрешить в Phase 21
- Тестирование только на физическом iPhone 15 Pro (iOS 26.3.1)
- PWA standalone mode имеет недокументированные отличия от Safari tab

## Непрерывность сессий

Последняя сессия: 2026-03-16
Phase 27 Plan 01 завершена. Task 1 (0e56df6): 7 failing TDD tests for generate_image. Task 2 (7dc326c): choices validation + HTTP 400/429 handling in generate_image. Все 23 теста зелёные.
Resume file: .planning/phases/27-openrouter-flux-2-retry-error-handling/27-02-PLAN.md
