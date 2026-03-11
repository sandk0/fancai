---
id: S01
parent: M003
milestone: M003
provides:
  - "Двухфазный gesture pipeline: animate -> instant scroll -> reset"
  - "Under-damped spring (SPRING_SWIPE) для micro-bounce при свайпе"
  - "Быстрый spring (SPRING_TAP) для тап-навигации (~100-150ms)"
  - "Исправленный chapterTransitionThreshold (достижимый при maxRubberBand 80px)"
  - "Публичный API instant scroll: instantNextPage, instantPrevPage, directScroll"
  - "Regression tests для gesture pipeline"
  - "5 багфиксов анимаций (shadow, edge zones, cancel, chapter threshold)"
  - "Унификация анимаций + toggle в настройках"
  - "2x ускорение spring-анимаций"
requires: []
affects: []
key_files: []
key_decisions:
  - "SPRING_SWIPE: stiffness 300, damping 24 (under-damped, ~10-15% overshoot)"
  - "chapterTransitionThreshold: 0.15 (56px на 375px viewport, достижимо при maxRubberBand 80px)"
  - "Тап-навигация: instant scroll ПЕРЕД spring slide-in (не после)"
  - "onEdgeTap стал no-op -- навигация обрабатывается внутри gesture controller"
  - "Spring stiffness ×2 для быстрого отклика: SPRING_FAST 800/57, SPRING_SWIPE 600/34, SPRING_TAP 1000/57"
  - "chapterTransitionThreshold: 0.08 (30px на 375px viewport, достижимо при maxRubberBand 100px)"
  - "Тень свайпа: inline boxShadow вместо Tailwind (артефакты на мобильных)"
  - "Edge zone 15% viewport для entity clicks у краёв экрана"
  - "animationsEnabled toggle в reader store"
patterns_established:
  - "Two-phase pipeline: visual animation и фактический scroll разделены"
  - "Ref change-detection guards: setState вызывается только при изменении значения"
  - "Iterative verification: deploy -> test on device -> fix -> redeploy"
observability_surfaces: []
drill_down_paths: []
duration: ~60min (spread across verification iterations)
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---
# S01: Navigation Swipes

**# Phase 16 Plan 01: Gesture Pipeline Summary**

## What Happened

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

# Phase 16 Plan 02: Testing & Verification Summary

**Regression tests + iterative device verification: 5 багов исправлено, анимации ×2 ускорены, human-verified**

## Performance

- **Duration:** ~60 min (итеративная верификация на устройстве)
- **Started:** 2026-03-10T01:38:00Z
- **Completed:** 2026-03-11
- **Tasks:** 2 (auto tests + human verification)
- **Files modified:** 10
- **Verification iterations:** 4 (тесты → 5 багов → унификация + toggle → 2x скорость)

## Accomplishments

- Создан набор regression tests для gesture pipeline (useGestureController.test.ts, обновлены useFollowFingerSwipe.test.ts)
- Исправлены 5 багов анимаций: shadow артефакты, edge zones, cancel, chapter threshold
- Унифицированы анимации свайпа и тапа (единый spring pipeline)
- Добавлена настройка toggle анимаций (animationsEnabled) в reader store
- Исправлен перехват кликов entity у краёв экрана (edge zone расширена до 15%)
- Spring stiffness ×2 для быстрого отклика (все конфиги)
- Пользователь подтвердил приемлемый результат навигации на реальном устройстве

## Task Commits

1. **Task 1: Regression tests** — `f74b7b1` (test)
2. **Verification fix 1: 5 gesture animation bugs** — `81ff01d` (fix)
3. **Verification fix 2: Unify animations + toggle + edge entity** — `38796ad` (fix)
4. **Verification fix 3: Double animation speed** — `d859d16` (perf)

## Decisions Made

- Spring stiffness ×2 с damping ×√2 — сохраняет damping ratio, удваивает скорость
- Inline boxShadow вместо Tailwind drop-shadow — устраняет артефакты на мобильных
- Edge zone 15% (было ~12%) — entity clicks у краёв корректно обрабатываются
- Animation toggle по умолчанию включён — пользователь может отключить для слабых устройств

## Deviations from Plan

- План предполагал 2 задачи (тесты + human-verify). Фактически потребовались 3 дополнительных итерации багфиксов найденных при тестировании на устройстве.

## Issues Encountered

- Тень свайпа (Tailwind drop-shadow) создавала артефакты — заменена на inline boxShadow
- Анимации были слишком медленными для восприятия пользователя — ускорены ×2

## Deferred

- Дальнейшая полировка плавности анимаций — отложена на будущее

## Next Phase Readiness

- Gesture pipeline стабилен и подтверждён на устройстве
- Фундамент для Phase 17 (header/panels), Phase 18 (text selection), Phase 19 (descriptions) готов
- Все тесты проходят, build чистый

---
## Self-Check: PASSED

All commits verified: f74b7b1, 81ff01d, 38796ad, d859d16.

---
*Phase: 16-navigation-swipes*
*Completed: 2026-03-11*
