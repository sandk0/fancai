---
phase: 18-text-selection-notes
plan: 01
subsystem: ui
tags: [epub.js, text-selection, css, gesture-controller, mobile, touch]

# Dependency graph
requires:
  - phase: 16-page-animations
    provides: Gesture controller FSM, spring animations, phase state
provides:
  - Разблокированное мобильное выделение текста в epub.js iframe
  - CSS class selection-blocked для блокировки при анимации
  - Подавление нативного контекстного меню на мобильных
  - Selection passthrough в gesture controller touchmove
affects: [18-02-PLAN, useTextSelection, SelectionMenu]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSS class toggle (selection-blocked) управляемый из gesture controller через useEffect"
    - "contextmenu event suppression с проверкой touch device"

key-files:
  created:
    - frontend/src/hooks/epub/__tests__/useContentHooks.test.ts
  modified:
    - frontend/src/hooks/epub/useContentHooks.ts
    - frontend/src/hooks/epub/useGestureController.ts

key-decisions:
  - "CSS class toggle (body.selection-blocked) вместо JS guard для блокировки выделения при анимации"
  - "contextmenu suppression через navigator.maxTouchPoints / ontouchstart проверку (не глобально)"

patterns-established:
  - "selection-blocked CSS class: добавляется/удаляется через useEffect на phase state"
  - "Mock rendition pattern для тестирования useContentHooks CSS injection"

requirements-completed: [SEL-01]

# Metrics
duration: 6min
completed: 2026-03-11
---

# Phase 18 Plan 01: Разблокировка мобильного выделения текста Summary

**Убран CSS user-select:none для мобильных, добавлен selection-blocked class для анимации, contextmenu suppression и selection passthrough в gesture controller**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-11T16:24:32Z
- **Completed:** 2026-03-11T16:31:06Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Удален CSS блок `@media (pointer: coarse)` с `user-select: none` -- основная причина неработающего выделения на мобильных
- Добавлен CSS class `body.selection-blocked *` для динамической блокировки выделения во время spring-анимации
- Добавлено подавление нативного контекстного меню на мобильных (только touch devices)
- Gesture controller теперь отменяет жест при активном text selection в touchmove (защита drag handles)
- useEffect в gesture controller toggle-ит selection-blocked class по phase state

## Task Commits

Each task was committed atomically:

1. **Task 0: Создание тест-стабов для useContentHooks** - `c11f583` (test)
2. **Task 1: CSS-разблокировка выделения и подавление контекстного меню** - `5a6126d` (feat)
3. **Task 2: Selection passthrough в gesture controller и toggle selection-blocked** - `c4213e6` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` -- Тесты для CSS injection: selection-blocked, contextmenu, отсутствие user-select:none
- `frontend/src/hooks/epub/useContentHooks.ts` -- Убран @media (pointer: coarse), добавлен selection-blocked CSS, contextmenu listener
- `frontend/src/hooks/epub/useGestureController.ts` -- Selection passthrough в touchmove, useEffect для toggle selection-blocked class

## Decisions Made
- CSS class toggle (`body.selection-blocked`) вместо JS guard -- надежнее, работает даже если JS не успевает
- contextmenu подавление через `navigator.maxTouchPoints > 0 || 'ontouchstart' in window` -- стандартный touch device detection
- `-webkit-touch-callout: none` НЕ применен глобально -- ломает long-press выделение на iOS, оставлен только на `.description-highlight`

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- Мобильное выделение текста разблокировано, готово для Plan 02 (HighlightTooltip)
- useTextSelection уже слушает rendition 'selected' event -- теперь должен корректно срабатывать на мобильных
- SelectionMenu готов показывать popup при выделении
- iOS drag handles поведение требует ручного тестирования (confidence MEDIUM, отмечено в STATE.md)

## Self-Check: PASSED

All files verified present. All 3 task commits verified in git log.

---
*Phase: 18-text-selection-notes*
*Completed: 2026-03-11*
