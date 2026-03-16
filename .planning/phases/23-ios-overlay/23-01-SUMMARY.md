---
phase: 23-ios-overlay
plan: 01
subsystem: ui
tags: [gesture, fsm, ios, refactoring, motion/react, touch-events]

requires:
  - phase: 22-touch-event-pipeline-fix
    provides: Full-screen iOS overlay with FSM for all gestures

provides:
  - Shared FSM functions in gestureUtils.ts (processTouchStart, processTouchMove, processSwipeCompletion, processTouchCancel)
  - GestureFSMDeps and SwipeCompletionDeps interfaces for dependency injection
  - Dynamic iOS overlay top based on isHeaderVisible
  - 454-line reduction in useGestureController.ts

affects: [23-02, gesture-controller, ios-overlay]

tech-stack:
  added: []
  patterns: [shared-fsm-with-deps-injection, separate-useeffect-for-style-updates]

key-files:
  created: []
  modified:
    - frontend/src/hooks/epub/gestureUtils.ts
    - frontend/src/hooks/epub/useGestureController.ts
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/hooks/epub/__tests__/gestureUtils.test.ts
    - frontend/src/hooks/epub/__tests__/useGestureController.test.ts

key-decisions:
  - "Shared FSM через dependency injection (GestureFSMDeps interface) -- refs передаются через deps объект, создаваемый внутри useEffect closure"
  - "Tap detection остается inline в обоих handlers -- фундаментально разные координатные системы (iframe-local vs screen-space)"
  - "Overlay top обновляется через отдельный useEffect по ID -- избегает пересоздания overlay и потери event listeners"
  - "vi.mock('motion/react') на уровне файла -- vi.mock hoisted, нельзя использовать внутри describe"

patterns-established:
  - "Shared FSM pattern: чистые функции принимают deps объект с refs и setters, вызываются из event handlers внутри useEffect"
  - "Separate style useEffect: обновление DOM стилей через getElementById + отдельный useEffect вместо добавления зависимости в основной effect"

requirements-completed: [NAV-01, NAV-02, NAV-03, NAV-04]

duration: 16min
completed: 2026-03-16
---

# Phase 23 Plan 01: Shared FSM Refactoring Summary

**Дедупликация ~454 строк FSM логики из useGestureController.ts в shared gestureUtils.ts с dependency injection, динамический overlay top через isHeaderVisible**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-16T04:12:46Z
- **Completed:** 2026-03-16T04:29:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Вынесены 4 shared FSM функции (processTouchStart, processTouchMove, processSwipeCompletion, processTouchCancel) в gestureUtils.ts
- useGestureController.ts уменьшен с 1487 до 1033 строк (-454 строки, превышает целевые ~400)
- iOS overlay top динамический: 0 в immersive mode, calc(env(safe-area-inset-top) + 64px) когда header видим
- 17 новых unit тестов для shared FSM функций, все 57 тестов зеленые

## Task Commits

1. **Task 1: Вынос shared FSM в gestureUtils.ts + динамический overlay top** - `a0698b2` (refactor)
2. **Task 2: Обновление тестов для shared FSM и source-code assertions** - `7028711` (test)

## Files Created/Modified
- `frontend/src/hooks/epub/gestureUtils.ts` - Расширен: +GestureState, +TouchState, +INITIAL_TOUCH, +GestureFSMDeps, +SwipeCompletionDeps, +processTouchStart, +processTouchMove, +processSwipeCompletion, +processTouchCancel (150 -> 507 строк)
- `frontend/src/hooks/epub/useGestureController.ts` - Рефакторинг: iframe и overlay handlers вызывают shared FSM функции, добавлен isHeaderVisible prop и отдельный useEffect для overlay top (1487 -> 1033 строк)
- `frontend/src/components/Reader/EpubReader.tsx` - Добавлен проп isHeaderVisible: autoHide.isHeaderVisible
- `frontend/src/hooks/epub/__tests__/gestureUtils.test.ts` - 17 новых тестов для shared FSM (26 -> 43 тестов)
- `frontend/src/hooks/epub/__tests__/useGestureController.test.ts` - 4 новых теста: shared FSM imports, source-code assertions, isHeaderVisible type, overlay top assertion (10 -> 14 тестов)

## Decisions Made
- Shared FSM через dependency injection (GestureFSMDeps interface) вместо прямой передачи отдельных refs -- один deps объект чище
- Tap detection остается inline -- координатные системы iframe/overlay фундаментально разные
- Отдельный useEffect для overlay.style.top вместо добавления isHeaderVisible в зависимости основного overlay useEffect -- избегает пересоздания overlay
- vi.mock('motion/react') на уровне файла теста -- vitest hoists vi.mock, использование внутри describe вызывает ReferenceError

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vi.mock position fix**
- **Found during:** Task 2 (тесты для shared FSM)
- **Issue:** vi.mock('motion/react') внутри describe block вызывал ReferenceError -- vitest hoists vi.mock to file top, переменные внутри describe еще не определены
- **Fix:** Переместил vi.mock на уровень файла, до импортов
- **Files modified:** frontend/src/hooks/epub/__tests__/gestureUtils.test.ts
- **Verification:** Все 57 тестов проходят
- **Committed in:** 7028711

**2. [Rule 1 - Bug] Удаление unused imports из useGestureController.ts**
- **Found during:** Task 1 (рефакторинг)
- **Issue:** После переноса FSM в shared функции, импорты FOLLOW_FINGER_CONFIG, SPRING_RUBBER, shouldNavigate, getRubberBandOffset, calculateVelocity стали unused
- **Fix:** Удалены из import statement
- **Files modified:** frontend/src/hooks/epub/useGestureController.ts
- **Verification:** Build проходит без ошибок
- **Committed in:** a0698b2

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Минимальные -- стандартные фиксы при рефакторинге. Без scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shared FSM функции готовы, useGestureController.ts на 454 строки короче
- Plan 02 (ручная верификация на iOS) может начинаться: все тесты зеленые, build проходит
- Overlay top динамический -- immersive mode корректно работает

## Self-Check: PASSED

All 5 modified files exist. Both task commits (a0698b2, 7028711) verified in git log.

---
*Phase: 23-ios-overlay*
*Completed: 2026-03-16*
