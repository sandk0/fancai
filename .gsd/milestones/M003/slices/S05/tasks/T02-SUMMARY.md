---
id: T02
parent: S05
milestone: M003
provides:
  - "bookmarksRef pattern -- stale closure fix for debounced annotation rendering"
  - "Differentiated debounce: 50ms for bookmark changes, 200ms for rendered event"
  - "Click handler reads from ref (no unnecessary re-registrations)"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 9min
verification_result: passed
completed_at: 2026-03-12
blocker_discovered: false
---
# T02: 19.1-uat-edge-taps 02

**# Phase 19.1 Plan 02: Annotation Stale Closure Fix Summary**

## What Happened

# Phase 19.1 Plan 02: Annotation Stale Closure Fix Summary

**bookmarksRef pattern fixes BUG-4 race condition -- новая заметка отображается за 50ms вместо 200ms+ задержки через stale closure**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-11T21:37:09Z
- **Completed:** 2026-03-11T21:46:09Z
- **Tasks:** 1 (TDD: RED -> GREEN)
- **Files modified:** 2

## Accomplishments

- Устранена race condition между TanStack Query optimistic update и debounced applyAnnotations
- bookmarksRef используется вместо closure -- всегда актуальные данные при debounced вызове
- Дифференцированный debounce: 50ms для bookmark changes, 200ms для rendered event
- 2 новых теста подтверждают исправление (stale closure + fast debounce)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED):** Failing tests for stale closure - `3a2de79` (test)
2. **Task 1 (GREEN):** bookmarksRef + differentiated debounce fix - `8860255` (fix)

_TDD task: RED commit (failing tests) followed by GREEN commit (implementation)_

## Files Created/Modified

- `frontend/src/hooks/epub/useAnnotationRendering.ts` -- bookmarksRef, differentiated debounce, click handler ref
- `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts` -- 2 new BUG-4 test cases (stale closure, fast debounce)

## Decisions Made

- **bookmarksRef.current вместо closure:** applyAnnotations читает bookmarks из ref, bookmarks убран из useCallback deps. Гарантирует что debounced вызов всегда использует актуальные данные.
- **50ms / 200ms дифференцированный debounce:** При изменении bookmarks (optimistic update) данные уже в кэше -- debounce 50ms достаточен. При rendered event (навигация) нужно дождаться description/entity hooks -- 200ms.
- **Click handler на bookmarksRef:** Убрана зависимость от bookmarks в click handler useEffect, уменьшая количество re-registrations при каждом изменении bookmarks.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

- Test для stale closure изначально проверял DOM rendering (data-bookmark-id на span элементах), но DOM modification при wrapping первого bookmark меняет структуру текстовых узлов, делая второй getRange невалидным в mock-окружении. Переписан на проверку вызовов getRange с правильными CFI (более надёжно для unit-теста).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- BUG-4 исправлен, аннотации отображаются мгновенно после optimistic update
- Все 7 тестов useAnnotationRendering проходят
- Production build успешен

---
*Phase: 19.1-uat-edge-taps*
*Completed: 2026-03-12*
