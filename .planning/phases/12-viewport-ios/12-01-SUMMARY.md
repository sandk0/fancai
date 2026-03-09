---
phase: 12-viewport-ios
plan: 01
subsystem: ui
tags: [ios, viewport, keyboard, css-variables, safe-area, react-hooks, visual-viewport-api]

# Dependency graph
requires:
  - phase: 11-gesture-mobile-ui
    provides: Gesture controller, auto-hide UI, immersive mode
provides:
  - useVisualViewportHandler хук для отслеживания iOS клавиатуры
  - CSS-переменная --keyboard-height для реактивного позиционирования
  - Динамический top для SearchPanel (immersive mode)
  - Keyboard-aware bottom для ProgressIndicator
affects: [12-viewport-ios plan 02, reader-mobile-pwa]

# Tech tracking
tech-stack:
  added: []
  patterns: [VisualViewport API для iOS keyboard detection, CSS-переменная обновляемая из React хука]

key-files:
  created:
    - frontend/src/hooks/shared/useVisualViewportHandler.ts
    - frontend/src/hooks/shared/__tests__/useVisualViewportHandler.test.ts
  modified:
    - frontend/src/styles/globals.css
    - frontend/src/components/Reader/SearchPanel.tsx
    - frontend/src/components/Reader/ProgressIndicator.tsx
    - frontend/src/components/Reader/EpubReader.tsx

key-decisions:
  - "Порог 150px для отличия клавиатуры от адресной строки iOS (50-70px)"
  - "CSS-переменная --keyboard-height на documentElement, не inline styles"
  - "IOSTapZones не модифицирован — полностью заменен gesture controller в Phase 11"

patterns-established:
  - "VisualViewport API resize/scroll listeners для iOS keyboard tracking"
  - "CSS-переменная обновляемая из React hook через document.documentElement.style.setProperty"

requirements-completed: [VPT-01, VPT-02]

# Metrics
duration: 5min
completed: 2026-03-09
---

# Phase 12 Plan 01: iOS Viewport Handler Summary

**useVisualViewportHandler хук с VisualViewport API, CSS-переменная --keyboard-height, динамический top для SearchPanel в immersive mode**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-09T08:26:59Z
- **Completed:** 2026-03-09T08:32:32Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- useVisualViewportHandler хук создан с 6 тестами (TDD: RED-GREEN)
- CSS-переменная --keyboard-height обновляется при появлении/скрытии iOS клавиатуры
- SearchPanel корректно позиционируется в immersive mode (header скрыт)
- ProgressIndicator учитывает высоту клавиатуры в bottom offset с плавной анимацией

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): useVisualViewportHandler failing tests** - `05177eb` (test)
2. **Task 1 (GREEN): useVisualViewportHandler hook + CSS variable** - `9400a05` (feat)
3. **Task 2: Overlay component safe area fixes** - `c57e5d0` (fix)

_Note: Task 1 is TDD with RED-GREEN commits_

## Files Created/Modified
- `frontend/src/hooks/shared/useVisualViewportHandler.ts` - VisualViewport API хук для iOS keyboard detection
- `frontend/src/hooks/shared/__tests__/useVisualViewportHandler.test.ts` - 6 тестов для хука
- `frontend/src/styles/globals.css` - CSS-переменная --keyboard-height в :root
- `frontend/src/components/Reader/SearchPanel.tsx` - Динамический top (isHeaderVisible prop)
- `frontend/src/components/Reader/ProgressIndicator.tsx` - bottom с --keyboard-height + transition
- `frontend/src/components/Reader/EpubReader.tsx` - Передача isHeaderVisible в SearchPanel

## Decisions Made
- Порог 150px для отличия клавиатуры от адресной строки iOS (адресная строка ~50-70px)
- CSS-переменная --keyboard-height обновляется через document.documentElement.style.setProperty
- IOSTapZones не модифицирован — полностью заменен gesture controller (Phase 11), не рендерится

## Deviations from Plan

None - plan executed exactly as written. IOSTapZones пропущен как указано в плане (gesture controller заменил его).

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- useVisualViewportHandler готов к использованию другими компонентами в Phase 12 Plan 02
- CSS-переменная --keyboard-height доступна для любого элемента через var()
- Билд проходит без ошибок TypeScript

## Self-Check: PASSED

All 6 created/modified files verified on disk. All 3 task commits verified in git log.

---
*Phase: 12-viewport-ios*
*Completed: 2026-03-09*
