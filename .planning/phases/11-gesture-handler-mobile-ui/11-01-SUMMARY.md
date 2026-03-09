---
phase: 11-gesture-handler-mobile-ui
plan: 01
subsystem: ui
tags: [gesture, fsm, motion, touch, swipe, tap, ios, mobile, auto-hide, header, epub]

# Dependency graph
requires:
  - phase: 10-follow-finger-swipe
    provides: "useFollowFingerSwipe утилиты (spring-конфиги, getStageInfo, shouldNavigate, calculateVelocity, getRubberBandOffset)"
provides:
  - "Единый useGestureController с FSM (idle->pending->swiping/tap/cancelled)"
  - "useAutoHideUI — immersive mode с auto-hide header при навигации"
  - "useIsMobile — shared хук для определения мобильного устройства"
  - "ReaderHeader с AnimatePresence slide+fade spring-анимацией"
affects: [11-02-PLAN, 12-pwa-offline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FSM gesture controller координирует свайп + тап + long-press через единый хук"
    - "Ref-based touch state для zero re-renders на touchmove"
    - "iOS center-tap overlay создается через DOM manipulation внутри контроллера"
    - "AnimatePresence + spring transition для header auto-hide"

key-files:
  created:
    - "frontend/src/hooks/epub/useGestureController.ts"
    - "frontend/src/hooks/reader/useAutoHideUI.ts"
    - "frontend/src/hooks/shared/useIsMobile.ts"
  modified:
    - "frontend/src/components/Reader/EpubReader.tsx"
    - "frontend/src/components/Reader/ReaderHeader.tsx"
    - "frontend/src/components/Reader/Core/ReaderUI.tsx"
    - "frontend/src/components/Reader/Core/ReaderOverlays.tsx"
    - "frontend/src/components/Reader/BookReader.tsx"
    - "frontend/src/components/Reader/ReaderSettingsPanel/hooks.ts"
    - "frontend/src/components/Reader/__tests__/EpubReader.test.tsx"
    - "frontend/src/hooks/epub/index.ts"

key-decisions:
  - "FSM с 4 состояниями (idle/pending/swiping/cancelled) вместо boolean-флагов — детерминированный gesture dispatch"
  - "Inline slide animation в контроллере для edge-тапов — избегает циклической ссылки на gestureController"
  - "iOS center-tap через DOM overlay, все остальное через iframe hooks.content.register()"
  - "Header скрыт по умолчанию (immersive mode) — максимум текста на экране"
  - "useIsMobile через matchMedia вместо window.innerWidth — реактивное определение"

patterns-established:
  - "Unified gesture controller: один хук управляет всеми touch-жестами через FSM"
  - "Auto-hide UI: header видимость управляется через gesture callbacks (onSwipeStart/onTapNavigate/toggleUI)"
  - "Shared hooks: повторно используемые хуки в hooks/shared/ (useIsMobile)"

requirements-completed: [NAV-05, MUI-02]

# Metrics
duration: 20min
completed: 2026-03-09
---

# Phase 11 Plan 01: Единый gesture controller и автоскрытие header — Summary

**FSM-based gesture controller (idle->pending->swiping/tap/cancelled) заменяет 3 параллельные системы жестов, header автоскрывается при навигации через spring-анимацию**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-09T07:14:47Z
- **Completed:** 2026-03-09T07:34:47Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Объединены useFollowFingerSwipe + useTouchNavigation + IOSTapZones в единый useGestureController с FSM
- Реализован immersive mode — header скрыт при открытии книги, появляется по тапу в центре
- Header автоскрывается при свайпе (>10px) и тапе по краю с spring-анимацией через AnimatePresence
- useIsMobile вынесен в shared-хуки с matchMedia для реактивного определения мобильного устройства
- Жесты навигации блокируются при открытых панелях (drawer, settings, TOC, search, book info)

## Task Commits

Каждая задача закоммичена атомарно:

1. **Task 1: useIsMobile + useAutoHideUI + useGestureController** - `de0809b` (feat)
2. **Task 2: Интеграция контроллера в EpubReader + ReaderHeader с AnimatePresence** - `a431197` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/useGestureController.ts` - Единый FSM gesture controller (~860 строк), заменяет 3 системы
- `frontend/src/hooks/reader/useAutoHideUI.ts` - Управление видимостью header с immersive mode
- `frontend/src/hooks/shared/useIsMobile.ts` - Определение мобильного устройства через matchMedia
- `frontend/src/components/Reader/EpubReader.tsx` - Заменены useFollowFingerSwipe + useTouchNavigation на useGestureController + useAutoHideUI
- `frontend/src/components/Reader/ReaderHeader.tsx` - Добавлена AnimatePresence spring-анимация, position: fixed overlay
- `frontend/src/components/Reader/Core/ReaderUI.tsx` - Добавлен isHeaderVisible prop для раздельного управления header
- `frontend/src/components/Reader/Core/ReaderOverlays.tsx` - Удалены IOSTapZones, tapZones prop, theme/navigationMode
- `frontend/src/components/Reader/BookReader.tsx` - Добавлен isVisible={true} для ReaderHeader
- `frontend/src/components/Reader/ReaderSettingsPanel/hooks.ts` - Реэкспорт useIsMobile из shared
- `frontend/src/components/Reader/__tests__/EpubReader.test.tsx` - Обновлены моки для useGestureController и useAutoHideUI
- `frontend/src/hooks/epub/index.ts` - Удален экспорт useTouchNavigation

## Decisions Made
- **FSM вместо boolean-флагов:** 4 состояния (idle/pending/swiping/cancelled) обеспечивают детерминированный dispatch жестов без конфликтов
- **Inline slide animation:** Edge-tap slide анимация реализована внутри контроллера, а не через внешний callback — избегает циклической ссылки на gestureController при деструктуризации
- **iOS гибридный подход:** Свайп через iframe hooks.content.register() на всех платформах, center-tap на iOS через DOM overlay (Safari не пробрасывает touch из iframe надежно)
- **Immersive mode по умолчанию:** Header скрыт при открытии — максимизирует пространство для текста на мобильных
- **matchMedia для useIsMobile:** Реактивнее window.innerWidth, автоматически обновляется при изменении размера окна

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] BookReader.tsx missing isVisible prop**
- **Found during:** Task 2 (интеграция ReaderHeader)
- **Issue:** После добавления isVisible как обязательного prop в ReaderHeader, BookReader.tsx (который тоже использует ReaderHeader) не компилировался
- **Fix:** Добавлен `isVisible={true}` в BookReader.tsx
- **Files modified:** `frontend/src/components/Reader/BookReader.tsx`
- **Verification:** TypeScript компиляция проходит
- **Committed in:** a431197

**2. [Rule 1 - Bug] Self-referencing gestureController в onEdgeTap**
- **Found during:** Task 2 (интеграция в EpubReader)
- **Issue:** `onEdgeTap: (dir) => { gestureController.triggerSlideAnimation(dir); ... }` ссылается на gestureController до его присвоения
- **Fix:** Slide animation логика инлайнена внутри gesture controller touch/click обработчиков для edge тапов
- **Files modified:** `frontend/src/hooks/epub/useGestureController.ts`
- **Verification:** TypeScript компиляция проходит, жесты работают
- **Committed in:** a431197

**3. [Rule 1 - Bug] State variables declared after use**
- **Found during:** Task 2 (интеграция useGestureController)
- **Issue:** isTocOpen, isEntityDrawerOpen, isSearchOpen, isBookInfoOpen объявлялись после использования в isPanelOpen
- **Fix:** Перенесены useState объявления в начало компонента (после isSettingsOpen), удалены дубликаты
- **Files modified:** `frontend/src/components/Reader/EpubReader.tsx`
- **Verification:** TypeScript компиляция проходит
- **Committed in:** a431197

**4. [Rule 1 - Bug] handleCenterTap declared after useGestureController**
- **Found during:** Task 2 (интеграция useGestureController)
- **Issue:** handleCenterTap определялся после useGestureController, который получает его как параметр — на первом рендере undefined
- **Fix:** Перенесены handleDescriptionClick и handleCenterTap перед вызовом useGestureController
- **Files modified:** `frontend/src/components/Reader/EpubReader.tsx`
- **Verification:** TypeScript компиляция проходит
- **Committed in:** a431197

---

**Total deviations:** 4 auto-fixed (3 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** Все исправления необходимы для корректной компиляции и работы. Нет расширения скоупа.

## Issues Encountered
- 10 из 424 тестов падают, но все 10 — pre-existing failures (проверено через git stash + запуск тестов на чистом коде). Не связаны с изменениями этого плана.

## User Setup Required

None - нет необходимости в конфигурации внешних сервисов.

## Next Phase Readiness
- Gesture controller полностью интегрирован, готов для Plan 02 (vaul bottom sheet + mobile settings)
- useAutoHideUI можно расширить в Plan 02 для управления дополнительными UI-элементами
- useIsMobile доступен как shared хук для любых mobile-specific компонентов

## Self-Check: PASSED

- All 8 key files: FOUND
- Commit de0809b (Task 1): FOUND
- Commit a431197 (Task 2): FOUND

---
*Phase: 11-gesture-handler-mobile-ui*
*Completed: 2026-03-09*
