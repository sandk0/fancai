---
id: T04
parent: S02
milestone: M003
provides:
  - "iOS overlay не перехватывает тапы по шапке"
  - "Entity Wiki и Settings всегда видны в шапке"
  - "Overflow menu содержит только TOC и Search для < 375px"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---
# T04: 17-shapka-i-paneli 04

**# Phase 17 Plan 04: Фикс iOS overlay и реорганизация кнопок шапки**

## What Happened

# Phase 17 Plan 04: Фикс iOS overlay и реорганизация кнопок шапки

**Фикс перехвата тапов iOS overlay в области шапки и вынос Entity Wiki / Settings из overflow menu**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T01:48:34Z
- **Completed:** 2026-03-11T01:51:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- iOS overlay теперь начинается ниже шапки (top: calc(env(safe-area-inset-top) + 64px))
- Добавлен clientY < 80px guard в handleOverlayTouchEnd как fallback-защита
- Entity Wiki (Library icon) всегда видна в шапке на всех размерах экрана
- Settings всегда видна в шапке на всех размерах экрана
- Overflow menu содержит только TOC и Search для экранов < 375px

## Task Commits

Each task was committed atomically:

1. **Task 1: Фикс iOS overlay -- исключить область шапки** - `e67ee14` (fix)
2. **Task 2: Вынести Entity Wiki и Settings из overflow в шапку** - `d2a72c0` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/useGestureController.ts` - iOS overlay top offset + clientY guard в handleOverlayTouchEnd
- `frontend/src/components/Reader/ReaderHeader.tsx` - Entity Wiki и Settings всегда видны, overflow упрощен

## Decisions Made
- iOS overlay top: calc(env(safe-area-inset-top) + 64px) -- 64px = высота шапки (~56px header + 8px padding)
- clientY < 80px guard как дополнительная fallback-защита (safe-area + header height)
- Entity Wiki и Settings: `flex` без hidden prefix -- всегда видны как ключевые функции
- Search: `hidden xs:flex` -- виден от 375px
- Overflow trigger: `xs:hidden` -- скрыт от 375px (все основные кнопки уже видны)
- На 320px: [Back] [spacer] [Entities] [Settings] [Overflow] -- помещается (176px + spacer)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 gap closure завершена (все 5 планов выполнены)
- Готовность к Phase 18 (Выделение текста и заметки)
- iOS overlay fix требует ручного тестирования на iOS Safari для подтверждения

---
*Phase: 17-shapka-i-paneli*
*Completed: 2026-03-11*
