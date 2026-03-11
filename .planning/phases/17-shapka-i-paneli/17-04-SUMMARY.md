---
phase: 17-shapka-i-paneli
plan: 04
subsystem: ui
tags: [react, gesture, ios, header, tailwind]

requires:
  - phase: 17-shapka-i-paneli
    provides: "Шапка с overflow menu и breakpoints (17-01), прогресс удален из шапки (17-03)"
provides:
  - "iOS overlay не перехватывает тапы по шапке"
  - "Entity Wiki и Settings всегда видны в шапке"
  - "Overflow menu содержит только TOC и Search для < 375px"
affects: [18-vydelenie-teksta, 19-opisaniya]

tech-stack:
  added: []
  patterns: ["iOS overlay top offset для исключения header area", "clientY guard как fallback-защита"]

key-files:
  created: []
  modified:
    - frontend/src/hooks/epub/useGestureController.ts
    - frontend/src/components/Reader/ReaderHeader.tsx

key-decisions:
  - "iOS overlay top: calc(env(safe-area-inset-top) + 64px) для исключения header area"
  - "clientY < 80px guard как fallback-защита в handleOverlayTouchEnd"
  - "Entity Wiki и Settings всегда видны (flex без hidden prefix)"
  - "Overflow menu содержит только TOC и Search (xs:hidden) для экранов < 375px"

patterns-established:
  - "iOS overlay offset: исключать фиксированные UI-элементы из overlay area"

requirements-completed: [HDR-01]

duration: 2min
completed: 2026-03-11
---

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
