---
phase: 20-dead-code
plan: 01
subsystem: ui
tags: [react, typescript, gesture, refactoring, dead-code]

# Dependency graph
requires:
  - phase: 16-gesture
    provides: "Unified gesture controller (useGestureController), заменивший 3 параллельных системы"
provides:
  - "gestureUtils.ts -- чистые утилиты жестов, вынесенные из useFollowFingerSwipe"
  - "Удаление 6 dead code файлов (~1953 строк)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Вынос pure functions/конфигов в отдельные *Utils.ts модули"

key-files:
  created:
    - "frontend/src/hooks/epub/gestureUtils.ts"
    - "frontend/src/hooks/epub/__tests__/gestureUtils.test.ts"
  modified:
    - "frontend/src/hooks/epub/useGestureController.ts"
    - "frontend/src/components/Reader/FollowFingerContainer.tsx"
    - "frontend/src/components/Reader/index.ts"
    - "frontend/src/hooks/epub/__tests__/useGestureController.test.ts"
    - "frontend/src/components/Reader/EpubReader.tsx"
    - "frontend/src/hooks/epub/useContentHooks.ts"
    - "frontend/src/components/Reader/__tests__/EpubReader.test.tsx"

key-decisions:
  - "Вынесены только используемые экспорты: 8 named + 2 типа. SPRING_NORMAL, SPRING_SWIPE, getSpringConfig не перенесены (dead code)"

patterns-established:
  - "gestureUtils.ts: конфиги и pure functions отдельно от hook-логики"

requirements-completed: [CLN-01]

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 20 Plan 01: Dead Code Cleanup Summary

**gestureUtils.ts с 8 named exports + тестами, удалены 6 мертвых файлов (~1953 строк) устаревшей навигации**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T19:56:38Z
- **Completed:** 2026-03-13T20:04:55Z
- **Tasks:** 2
- **Files modified:** 13 (2 created, 5 modified, 6 deleted)

## Accomplishments
- Создан gestureUtils.ts с конфигами (FOLLOW_FINGER_CONFIG, SPRING_FAST, SPRING_RUBBER, SPRING_TAP), типами (StageInfo, FollowFingerPhase) и pure functions (getStageInfo, shouldNavigate, calculateVelocity, getRubberBandOffset)
- Создан gestureUtils.test.ts с 26 unit-тестами покрывающими все экспорты
- Удалены 6 dead code файлов: useFollowFingerSwipe.ts (623), useTouchNavigation.ts (559), IOSTapZones.tsx (374), TapZone.tsx, TapFeedback.tsx, useFollowFingerSwipe.test.ts (306)
- Обновлены все импорты (useGestureController, FollowFingerContainer, тесты)
- Вычищены комментарии-ссылки на удалённые файлы

## Task Commits

Each task was committed atomically:

1. **Task 1: Создать gestureUtils.ts и gestureUtils.test.ts** - `6acb579` (feat)
2. **Task 2: Обновить импорты, удалить dead files, вычистить комментарии** - `d2108b0` (refactor)

## Files Created/Modified
- `frontend/src/hooks/epub/gestureUtils.ts` - Pure утилиты жестов (конфиги, типы, functions)
- `frontend/src/hooks/epub/__tests__/gestureUtils.test.ts` - 26 unit-тестов
- `frontend/src/hooks/epub/useGestureController.ts` - Импорты обновлены на gestureUtils
- `frontend/src/components/Reader/FollowFingerContainer.tsx` - Импорт типа обновлён
- `frontend/src/components/Reader/index.ts` - Удалён экспорт IOSTapZones
- `frontend/src/hooks/epub/__tests__/useGestureController.test.ts` - Импорты и assertions обновлены
- `frontend/src/components/Reader/EpubReader.tsx` - Комментарий обновлён
- `frontend/src/hooks/epub/useContentHooks.ts` - Комментарий обновлён
- `frontend/src/components/Reader/__tests__/EpubReader.test.tsx` - Комментарий обновлён

### Удалённые файлы
- `frontend/src/hooks/epub/useFollowFingerSwipe.ts` (623 строки)
- `frontend/src/hooks/epub/useTouchNavigation.ts` (559 строк)
- `frontend/src/components/Reader/IOSTapZones.tsx` (374 строки)
- `frontend/src/components/Reader/TapZone.tsx` (~30 строк)
- `frontend/src/components/Reader/TapFeedback.tsx` (~30 строк)
- `frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts` (306 строк)

## Decisions Made
- Вынесены только 8 named exports + 2 типа, реально используемых useGestureController. SPRING_NORMAL, SPRING_SWIPE, getSpringConfig не перенесены -- они использовались только внутри useFollowFingerSwipe hook, который удалён.
- Исторические JSDoc комментарии в useGestureController (описание замещённых систем) сохранены -- полезный контекст.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Удалены ссылки на SPRING_SWIPE и getSpringConfig из useGestureController.test.ts**
- **Found during:** Task 2
- **Issue:** После замены `useFollowFingerSwipe` на `gestureUtils` в тестах, assertions проверяли SPRING_SWIPE и getSpringConfig, которые не экспортируются из gestureUtils (dead code)
- **Fix:** Удалены assertions для SPRING_SWIPE и getSpringConfig из describe('reused utilities')
- **Files modified:** frontend/src/hooks/epub/__tests__/useGestureController.test.ts
- **Verification:** Все 10 тестов проходят
- **Committed in:** d2108b0

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Минимальный -- убраны невалидные assertions на несуществующие экспорты.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Кодовая база очищена от мёртвого кода устаревшей навигации
- Готова к выполнению плана 20-02 (следующий dead code cleanup)

## Self-Check: PASSED

- All created files exist (gestureUtils.ts, gestureUtils.test.ts, SUMMARY.md)
- All 6 dead files confirmed deleted
- Both commits verified (6acb579, d2108b0)
- Build passes, 26 gestureUtils tests + 10 useGestureController tests green

---
*Phase: 20-dead-code*
*Completed: 2026-03-13*
