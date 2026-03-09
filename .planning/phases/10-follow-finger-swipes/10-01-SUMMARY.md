---
phase: 10-follow-finger-swipes
plan: 01
subsystem: ui
tags: [motion, spring-physics, touch-gestures, epub, follow-finger, swipe]

requires:
  - phase: 09-navigation-stabilization
    provides: useNavigationLock ref-based mutex для координации жестов

provides:
  - useFollowFingerSwipe хук с touch tracking, velocity flick, spring-анимацией, rubber-band
  - FollowFingerContainer wrapper с GPU transform и box-shadow
  - ChapterHint компонент для подсказки при rubber-band свайпе
  - Exported утилиты: shouldNavigate, calculateVelocity, getStageInfo, getRubberBandOffset, getSpringConfig

affects: [10-02-integration, reader-gestures, epub-navigation]

tech-stack:
  added: []
  patterns: [useMotionValue для ref-based tracking без ререндеров, useMotionValueEvent для прямых DOM-мутаций тени, critically-damped spring configs]

key-files:
  created:
    - frontend/src/hooks/epub/useFollowFingerSwipe.ts
    - frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts
    - frontend/src/components/Reader/FollowFingerContainer.tsx
    - frontend/src/components/Reader/ChapterHint.tsx
  modified:
    - frontend/src/locales/en/translation.json
    - frontend/src/locales/ru/translation.json

key-decisions:
  - "CSS transform на wrapper div (не на stage.container) -- безопасно для epub.js"
  - "useMotionValueEvent для box-shadow -- прямые DOM-мутации без ререндеров"
  - "Три spring-конфига (FAST/NORMAL/RUBBER) с critically damped параметрами"
  - "Resistance 0.4 и maxRubberBand 80px для boundary rubber-band"

patterns-established:
  - "Dual-layer transform: визуальный CSS transform на wrapper + scrollLeft для навигации"
  - "Touch events через rendition.hooks.content.register() с passive:false на touchmove"
  - "Exported utility функции для тестирования без DOM-зависимостей"

requirements-completed: [NAV-01, NAV-02]

duration: 6min
completed: 2026-03-09
---

# Phase 10 Plan 01: Follow-finger свайпы -- ядро Summary

**Хук useFollowFingerSwipe с touch tracking через iframe, velocity flick detection (>0.3px/ms), critically damped spring-анимацией (3 конфига), rubber-band на границе главы, и компоненты FollowFingerContainer (GPU transform + box-shadow) и ChapterHint (плашка при boundary свайпе)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-09T01:26:16Z
- **Completed:** 2026-03-09T01:32:31Z
- **Tasks:** 2 (Task 1 TDD, Task 2 auto)
- **Files modified:** 6

## Accomplishments

- useFollowFingerSwipe хук полностью реализован: touch tracking через iframe hooks.content.register, velocity-based flick detection, spring-анимация (critically damped), rubber-band на boundary, tap/swipe discrimination (10px threshold)
- FollowFingerContainer wrapper с m.div GPU transform, реактивным box-shadow через useMotionValueEvent, pointer-events:none при tracking
- ChapterHint с AnimatePresence для плавного показа "Следующая/Предыдущая глава" при rubber-band свайпе
- 31 тест проходит, TypeScript компилируется, production build успешен

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests** - `246a2df` (test)
2. **Task 1 GREEN: useFollowFingerSwipe hook** - `d9224e0` (feat)
3. **Task 2: FollowFingerContainer + ChapterHint** - `01787b7` (feat)

## Files Created/Modified

- `frontend/src/hooks/epub/useFollowFingerSwipe.ts` -- Основной хук follow-finger: конфигурация, spring configs, utility функции, touch event handlers через iframe
- `frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts` -- 31 тест: config, tracking, tap/swipe, navigate threshold, velocity flick, spring config, boundary, rubber-band, velocity calculation
- `frontend/src/components/Reader/FollowFingerContainer.tsx` -- Wrapper с m.div (GPU transform), box-shadow между страницами, pointer-events при tracking
- `frontend/src/components/Reader/ChapterHint.tsx` -- Плашка "Следующая/Предыдущая глава" с AnimatePresence
- `frontend/src/locales/en/translation.json` -- Добавлены ключи reader.swipe.next_chapter, reader.swipe.prev_chapter
- `frontend/src/locales/ru/translation.json` -- Добавлены ключи reader.swipe.next_chapter, reader.swipe.prev_chapter

## Decisions Made

- **CSS transform на wrapper div:** Не на stage.container напрямую -- epub.js может перезаписать стили при resize. Wrapper безопаснее.
- **useMotionValueEvent для box-shadow:** Прямые DOM-мутации ref-элемента без React ререндеров -- производительность на каждый touchmove frame.
- **Три spring-конфига:** FAST (stiffness=400, damping=40) для flick, NORMAL (300, 35) для обычного свайпа, RUBBER (200, 28) для boundary возврата. Критическое затухание: damping ~= 2*sqrt(stiffness*mass).
- **Resistance 0.4 и maxRubberBand 80px:** Баланс между отзывчивостью и ограничением -- пользователь чувствует сопротивление, но не может "утащить" страницу слишком далеко.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Все компоненты готовы к интеграции в EpubReader (Plan 02)
- useFollowFingerSwipe экспортирует полный интерфейс: translateX, phase, isAtBoundary, showChapterHint, chapterHintDirection
- FollowFingerContainer принимает все props из хука и рендерит children
- Следующий шаг: замена useSwipeNavigation на useFollowFingerSwipe в EpubReader.tsx, удаление SwipeOverlay/SwipeIndicator

---
*Phase: 10-follow-finger-swipes*
*Completed: 2026-03-09*
