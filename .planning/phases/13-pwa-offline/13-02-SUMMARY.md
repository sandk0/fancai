---
phase: 13-pwa-offline
plan: 02
subsystem: ui
tags: [pwa, offline, react, lucide-react, zustand-persist, service-worker]

# Dependency graph
requires:
  - phase: 13-pwa-offline
    provides: useOnlineStatus, useEpubOffline, SW caching strategies
provides:
  - Offline-aware BookCard с затемнением и блокировкой для некэшированных книг
  - Скрытие кнопки регенерации изображений офлайн
  - Верификация безопасности SW update для позиции чтения
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useOnlineStatus() в UI-компонентах для условного рендеринга офлайн"
    - "Dim overlay с WifiOff иконкой для недоступных элементов"

key-files:
  created: []
  modified:
    - frontend/src/components/Library/BookCard/BookCard.tsx
    - frontend/src/components/Library/BookCard/BookCover.tsx
    - frontend/src/components/Library/BookCard/types.ts
    - frontend/src/components/Images/ImageControls.tsx
    - frontend/src/locales/ru/translation.json
    - frontend/src/locales/en/translation.json

key-decisions:
  - "useOnlineStatus() в каждом компоненте, а не через контекст -- минимальное вмешательство"
  - "Entity drawer без изменений -- SW StaleWhileRevalidate автоматически отдаёт кэш офлайн"
  - "Regenerate скрыт, но ImageModal доступен -- уже сгенерированные изображения показываются из SW кэша"

patterns-established:
  - "Offline UI pattern: проверка isOnline + isAvailableOffline для условного рендеринга"
  - "Dim overlay: bg-background/60 + WifiOff иконка для визуального индикатора недоступности"

requirements-completed: [PWA-02, PWA-03]

# Metrics
duration: 8min
completed: 2026-03-09
---

# Phase 13 Plan 02: Offline Degradation Summary

**Offline-aware BookCard с WifiOff затемнением некэшированных книг, скрытие regenerate офлайн, верификация SW update safety через Zustand persist**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-09T14:30:09Z
- **Completed:** 2026-03-09T14:38:18Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- BookCard офлайн: книги без кэша затемнены иконкой WifiOff и не кликабельны, книги с кэшем полностью функциональны
- Кнопка регенерации изображений скрыта офлайн в ImageControls, уже сгенерированные изображения отдаются из SW кэша
- Верифицировано: SW update через PWAUpdatePrompt не теряет позицию чтения (Zustand persist + localStorage backup)
- Entity wiki работает через SW cache (StaleWhileRevalidate) без дополнительной офлайн-логики

## Task Commits

Each task was committed atomically:

1. **Task 1: Offline-aware BookCard и BookCover с затемнением и блокировкой** - `73ad446` (feat)
2. **Task 2: Скрытие AI-кнопок офлайн + верификация SW update safety** - `cfb0642` (feat)

## Files Created/Modified

- `frontend/src/components/Library/BookCard/BookCard.tsx` - Добавлен useOnlineStatus, isClickable учитывает offline + cache
- `frontend/src/components/Library/BookCard/BookCover.tsx` - Dim overlay с WifiOff для некэшированных книг офлайн
- `frontend/src/components/Library/BookCard/types.ts` - Добавлен isOnline в BookCoverProps
- `frontend/src/components/Images/ImageControls.tsx` - Скрыта кнопка regenerate и панель опций офлайн
- `frontend/src/locales/ru/translation.json` - Ключ ui.offline.book_unavailable
- `frontend/src/locales/en/translation.json` - Ключ ui.offline.book_unavailable

## Decisions Made

- **useOnlineStatus() в каждом компоненте:** Минимальное вмешательство, не требует рефакторинга контекста. Хук легковесный, повторные подписки на online/offline события не создают overhead.
- **Entity drawer без изменений:** SW StaleWhileRevalidate для api-cache автоматически отдаёт кэшированные entity данные офлайн. TanStack Query показывает error state если нет ни кэша, ни сети -- Entity компоненты уже обрабатывают это.
- **ImageModal доступен, только regenerate скрыт:** Пользователь может просматривать уже сгенерированные изображения офлайн (из SW generated-images-cache), но не может запустить новую генерацию.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## SW Update Safety Verification

Подтверждено, что обновление Service Worker через PWAUpdatePrompt безопасно для позиции чтения:

1. **Zustand persist:** `useReaderStore` использует `persist` middleware с ключом `'fancai-reader'` в localStorage. `readingProgress` включён в `partialize`.
2. **useReaderPosition:** Восстанавливает CFI из серверного прогресса + локальный backup из localStorage.
3. **PWAUpdatePrompt:** `updateServiceWorker(true)` делает reload страницы. После reload Zustand persist восстанавливает состояние из localStorage.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 13 полностью завершена (Plan 01: SW + caching, Plan 02: offline degradation)
- Все PWA-требования покрыты: установка, кэширование, offline UI, SW update safety

## Self-Check: PASSED

All 6 modified files verified. Both task commits (73ad446, cfb0642) confirmed.

---
*Phase: 13-pwa-offline*
*Completed: 2026-03-09*
