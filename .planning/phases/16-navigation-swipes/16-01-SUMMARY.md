---
phase: 16-navigation-swipes
plan: 01
subsystem: ui
tags: [motion, spring-physics, epub.js, gesture, swipe, touch, animation]

# Dependency graph
requires: []
provides:
  - "Двухфазный gesture pipeline: animate -> instant scroll -> reset"
  - "Under-damped spring (SPRING_SWIPE) для micro-bounce при свайпе"
  - "Быстрый spring (SPRING_TAP) для тап-навигации (~100-150ms)"
  - "Исправленный chapterTransitionThreshold (достижимый при maxRubberBand 80px)"
  - "Публичный API instant scroll: instantNextPage, instantPrevPage, directScroll"
affects: [17-header-autohide, 18-text-selection, 19-descriptions, 20-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase navigation: spring animate -> instant scroll -> reset"
    - "Ref-based change-detection guards for setState in touchmove"
    - "Under-damped spring for micro-bounce (Apple Books feel)"

key-files:
  created: []
  modified:
    - frontend/src/hooks/epub/useFollowFingerSwipe.ts
    - frontend/src/hooks/epub/useEpubNavigation.ts
    - frontend/src/hooks/epub/useGestureController.ts
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts
    - frontend/src/hooks/epub/__tests__/useEpubNavigation.test.ts

key-decisions:
  - "SPRING_SWIPE: stiffness 300, damping 24 (under-damped, ~10-15% overshoot)"
  - "chapterTransitionThreshold: 0.15 (56px на 375px viewport, достижимо при maxRubberBand 80px)"
  - "Тап-навигация: instant scroll ПЕРЕД spring slide-in (не после)"
  - "onEdgeTap стал no-op -- навигация обрабатывается внутри gesture controller"

patterns-established:
  - "Two-phase pipeline: visual animation и фактический scroll разделены"
  - "Ref change-detection guards: setState вызывается только при изменении значения"

requirements-completed: [NAV-01, NAV-02, NAV-03, NAV-04]

# Metrics
duration: 11min
completed: 2026-03-10
---

# Phase 16 Plan 01: Gesture Pipeline Summary

**Двухфазный gesture pipeline с under-damped spring для micro-bounce, исправленный chapter transition threshold, instant scroll API для свайпов и тапов**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-10T01:20:01Z
- **Completed:** 2026-03-10T01:31:17Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Устранено двойное перелистывание свайпом через двухфазный pipeline (animate -> instant scroll -> reset)
- Тап-навигация переведена на паттерн "instant scroll FIRST -> spring slide-in from edge"
- Исправлен нерабочий переход между главами (chapterTransitionThreshold был математически недостижим)
- Минимизированы re-renders в touchmove через ref-based change-detection guards
- Добавлены under-damped spring для micro-bounce (SPRING_SWIPE) и быстрый spring для тапов (SPRING_TAP)

## Task Commits

Each task was committed atomically:

1. **Task 1: Spring configs, threshold fix, instant scroll API** - `3cf2da8` (feat)
2. **Task 2: Two-phase pipeline + EpubReader integration** - `eb3f481` (fix)

## Files Created/Modified
- `frontend/src/hooks/epub/useFollowFingerSwipe.ts` - SPRING_SWIPE, SPRING_TAP, chapterTransitionThreshold fix, getSpringConfig update
- `frontend/src/hooks/epub/useEpubNavigation.ts` - instantNextPage, instantPrevPage, directScroll export
- `frontend/src/hooks/epub/useGestureController.ts` - Two-phase pipeline для свайпов, тапов, chapter transitions; ref guards в touchmove
- `frontend/src/components/Reader/EpubReader.tsx` - onNavigate использует instantNextPage/instantPrevPage
- `frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts` - Тесты для новых spring configs, threshold reachability
- `frontend/src/hooks/epub/__tests__/useEpubNavigation.test.ts` - Тесты для instant scroll mode, обновленный interface

## Decisions Made
- SPRING_SWIPE: damping=24 (under-damped, 2*sqrt(300)=34.6 > 24, дает ~10-15% overshoot для micro-bounce)
- chapterTransitionThreshold: 0.15 вместо 0.35 (было математически невозможно: 0.35*375=131 > maxRubberBand 80)
- quickSwipeMinDistance: 10 вместо 15 для более отзывчивого flick
- getSpringConfig возвращает SPRING_SWIPE для обычных свайпов (вместо SPRING_NORMAL -> SPRING_RUBBER)
- onEdgeTap в EpubReader стал no-op -- навигация обрабатывается внутри gesture controller через onNavigateRef
- Desktop click handler использует тот же двухфазный паттерн что и touch tap

## Deviations from Plan

None -- план выполнен точно по спецификации.

## Issues Encountered

None.

## User Setup Required

None -- изменения только в frontend коде, внешняя конфигурация не требуется.

## Next Phase Readiness
- Gesture pipeline стабилен, готов к визуальному тестированию на устройствах
- Фундамент для Phase 17 (header autohide), Phase 18 (text selection), Phase 19 (descriptions) -- готов
- Все 139 тестов в hooks/epub/__tests__/ проходят, build чистый

---
## Self-Check: PASSED

All 6 modified files exist. Both task commits (3cf2da8, eb3f481) verified in git log.

---
*Phase: 16-navigation-swipes*
*Completed: 2026-03-10*
