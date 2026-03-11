---
id: S05
parent: M003
milestone: M003
provides:
  - "Inline touch-action/user-select убраны из useEpubRendition (CSS из useContentHooks имеет приоритет)"
  - "Непрозрачный фон drawer-ов (bg-base вместо bg-elevated)"
  - "elementFromPoint для edge zones в gesture controller"
  - "Entity handler в edge zones (description + entity тапы у краёв экрана)"
  - "bookmarksRef pattern -- stale closure fix for debounced annotation rendering"
  - "Differentiated debounce: 50ms for bookmark changes, 200ms for rendered event"
  - "Click handler reads from ref (no unnecessary re-registrations)"
requires: []
affects: []
key_files: []
key_decisions:
  - "Inline touchAction/userSelect/webkitUserSelect убраны полностью, CSS из useContentHooks теперь единственный источник touch-action"
  - "bg-[var(--color-bg-base)] выбран для drawer-ов (solid, theme-adaptive, непрозрачный во всех 4 темах)"
  - "elementFromPoint с fallback на e.target для обратной совместимости"
  - "Click handler обновлён аналогично touch handler для консистентности (entity + description)"
  - "bookmarksRef.current вместо closure -- гарантирует актуальные данные при debounced вызове"
  - "50ms debounce для bookmark changes (optimistic update), 200ms для rendered event (навигация)"
  - "Click handler переведён на bookmarksRef -- убрана зависимость от bookmarks в useEffect deps"
patterns_established:
  - "elementFromPoint: использовать document.elementFromPoint(x, y) вместо e.target для touch events"
  - "Drawer backgrounds: bg-[var(--color-bg-base)] для standalone модальных компонентов, bg-[var(--color-bg-elevated)] только для overlay-поверхностей"
  - "useRef для данных потребляемых в debounced callbacks -- избегает stale closure"
observability_surfaces: []
drill_down_paths: []
duration: 9min
verification_result: passed
completed_at: 2026-03-12
blocker_discovered: false
---
# S05: Uat Edge Taps

**# Phase 19.1 Plan 01: UAT-фиксы Summary**

## What Happened

# Phase 19.1 Plan 01: UAT-фиксы Summary

**Убран inline touch-action/user-select (BUG-1), непрозрачные фоны drawer-ов (BUG-2/3), elementFromPoint для edge taps на entity/description (BUG-5)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T21:37:13Z
- **Completed:** 2026-03-11T21:41:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Убраны inline touchAction='manipulation', userSelect='text', webkitUserSelect='text' из useEpubRendition.ts -- CSS из useContentHooks (touch-action: pan-x pan-y) теперь имеет приоритет, простой тап не вызывает выделение
- EntityBottomSheet и DescriptionDrawer используют непрозрачный bg-[var(--color-bg-base)] во всех 4 темах
- Edge zone в gesture controller использует elementFromPoint вместо e.target, обрабатывает и description и entity тапы
- Новый тест подтверждает, что touch-action: pan-x pan-y инжектируется через CSS (единственный источник)

## Task Commits

Each task was committed atomically:

1. **Task 1: Убрать inline touch-action/user-select + тест BUG-1 + непрозрачные фоны drawer-ов** - `2de7397` (fix)
2. **Task 2: elementFromPoint для edge zones + entity handler в gesture controller** - `8ce1cac` (fix)

## Files Created/Modified
- `frontend/src/hooks/epub/useEpubRendition.ts` - Убраны 3 inline-стиля (touchAction, userSelect, webkitUserSelect), оставлен overscrollBehaviorX
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` - Новый тест: touch-action: pan-x pan-y инжектируется через CSS
- `frontend/src/components/Reader/EntityBottomSheet.tsx` - bg-[var(--color-bg-base)] вместо bg-[var(--color-bg-elevated)]
- `frontend/src/components/Reader/DescriptionDrawer.tsx` - bg-[var(--color-bg-base)] вместо bg-[var(--color-bg-elevated)]
- `frontend/src/hooks/epub/useGestureController.ts` - elementFromPoint для edge zones, entity handler в touch/click handlers

## Decisions Made
- Inline touchAction/userSelect/webkitUserSelect убраны полностью, CSS из useContentHooks теперь единственный источник touch-action: pan-x pan-y
- bg-[var(--color-bg-base)] выбран для drawer-ов -- solid, theme-adaptive, непрозрачный во всех 4 темах (light=#ffffff, dark=#121212, sepia=#fbf0d9, outdoor=#fffef5)
- elementFromPoint с fallback на e.target для обратной совместимости (если document недоступен)
- Click handler (desktop) обновлён аналогично touch handler для консистентности entity + description обработки

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Entity handling в desktop click handler**
- **Found during:** Task 2 (elementFromPoint для edge zones)
- **Issue:** Click handler (desktop fallback) обрабатывал только 'description' тип, entity-mention игнорировался
- **Fix:** Обновлён click handler аналогично touch handler: elementFromPoint + description/entity обработка
- **Files modified:** frontend/src/hooks/epub/useGestureController.ts
- **Verification:** Все 5 тестов gesture controller проходят, build успешен
- **Committed in:** 8ce1cac (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Необходимое дополнение для консистентности touch/click обработки. Без scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BUG-1, BUG-2, BUG-3, BUG-5 исправлены
- BUG-4 (задержка аннотаций) -- отдельный план 19.1-02
- Все 30 тестов проходят, build успешен
- Готово для ручного UAT тестирования на устройстве

## Self-Check: PASSED

All 5 modified files verified on disk. Both commits (2de7397, 8ce1cac) verified in git log.

---
*Phase: 19.1-uat-edge-taps*
*Completed: 2026-03-12*

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
