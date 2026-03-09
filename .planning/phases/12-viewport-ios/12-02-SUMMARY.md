---
phase: 12-viewport-ios
plan: 02
subsystem: ui
tags: [pwa, standalone, ios, center-tap, onboarding, localStorage, i18n]

# Dependency graph
requires:
  - phase: 12-viewport-ios plan 01
    provides: useVisualViewportHandler, CSS --keyboard-height, overlay safe-area fixes
provides:
  - Standalone-aware useAutoHideUI с onboarding подсказкой для center-tap
  - i18n ключи для подсказки (ru/en)
affects: [13-pwa-offline, reader-mobile-pwa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      localStorage persistence для one-time onboarding hints,
      isStandalone() detection для PWA-specific UX,
    ]

key-files:
  created: []
  modified:
    - frontend/src/hooks/reader/useAutoHideUI.ts
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/locales/ru/translation.json
    - frontend/src/locales/en/translation.json

key-decisions:
  - "localStorage ключ reader_standalone_hint_dismissed для персистентного скрытия подсказки"
  - "AnimatePresence fade-in через 1.5с после renditionReady, auto-dismiss через 4с"
  - "Подсказка показывается ТОЛЬКО в isStandalone() mode — desktop и обычный браузер не затронуты"

patterns-established:
  - "One-time onboarding hint: isStandalone() + localStorage flag + auto-dismiss timer"

requirements-completed: [VPT-03]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 12 Plan 02: PWA Standalone Navigation Summary

**Standalone-aware center-tap подсказка с localStorage persistence и i18n, обеспечивающая навигацию обратно в библиотеку из PWA standalone mode**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T08:32:32Z
- **Completed:** 2026-03-09T08:45:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- useAutoHideUI расширен: showStandaloneHint + dismissStandaloneHint для PWA standalone mode
- Визуальная подсказка "тапните по центру для меню" в EpubReader с AnimatePresence анимацией
- i18n ключи добавлены для русского и английского языков
- Подсказка persisted в localStorage — показывается только один раз
- Полная верификация на устройстве: все viewport и iOS исправления Phase 12 подтверждены

## Task Commits

Each task was committed atomically:

1. **Task 1: Standalone-aware useAutoHideUI + hint in EpubReader** - `18a3c60` (feat)
2. **Task 2: Проверка viewport и iOS исправлений на устройстве** - checkpoint:human-verify (approved)

## Files Created/Modified

- `frontend/src/hooks/reader/useAutoHideUI.ts` - Standalone hint state + dismissStandaloneHint + auto-dismiss в toggleUI
- `frontend/src/components/Reader/EpubReader.tsx` - Standalone подсказка overlay с AnimatePresence, fade-in 1.5с, auto-dismiss 4с
- `frontend/src/locales/ru/translation.json` - i18n ключ reader.standalone.hint
- `frontend/src/locales/en/translation.json` - i18n ключ reader.standalone.hint

## Decisions Made

- localStorage ключ `reader_standalone_hint_dismissed` для one-time подсказки
- AnimatePresence с задержкой 1.5с после renditionReady для ненавязчивого появления
- Auto-dismiss через 4 секунды если пользователь не нажал
- Подсказка строго ограничена `isStandalone()` — обычный браузер и desktop не затронуты

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 12 полностью завершена: viewport, safe areas, клавиатура, PWA standalone
- Phase 13 (PWA и offline) может стартовать — все viewport prerequisites готовы
- isStandalone() утилита доступна для PWA-specific логики в Phase 13

## Self-Check: PASSED

All 4 modified files verified on disk. Task 1 commit (18a3c60) verified in git log. SUMMARY.md created.

---

_Phase: 12-viewport-ios_
_Completed: 2026-03-09_
