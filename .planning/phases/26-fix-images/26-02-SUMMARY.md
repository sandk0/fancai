---
phase: 26-fix-images
plan: 02
subsystem: ui
tags: [tanstack-query, polling, refetchInterval, celery, image-generation, react-hooks]

# Dependency graph
requires:
  - phase: 26-fix-images plan 01
    provides: "Исправления багов генерации и отображения изображений"
provides:
  - "useImageModal рефакторирован на TanStack Query polling (useQuery + refetchInterval)"
  - "taskStatus query key factory в queryKeys.ts"
  - "Автоматическая инвалидация byDescription + byBook + userStats при успешной генерации"
  - "P7 visibility пауза через TQ focusManager (вместо ручного useVisibilityManager)"
affects: [image-generation, reader, epub-hooks]

# Tech tracking
tech-stack:
  added: []
  patterns: [TQ refetchInterval polling, focusManager visibility pause]

key-files:
  created: []
  modified:
    - frontend/src/hooks/epub/useImageModal.ts
    - frontend/src/hooks/api/queryKeys.ts
    - frontend/src/hooks/reader/useReaderImageModal.ts
    - frontend/src/components/Reader/DescriptionDrawer.tsx

key-decisions:
  - "TQ useQuery refetchInterval заменяет ручной setInterval для Celery task polling"
  - "Visibility пауза через встроенный focusManager вместо useVisibilityManager"
  - "useReaderImageModal помечен @deprecated (используется только orphaned BookReader.tsx)"

patterns-established:
  - "Polling pattern: useQuery с refetchInterval для async task status"
  - "Task status key без userId (taskId уже уникален через Celery)"

requirements-completed: [MODAL-TQ, BUILD]

# Metrics
duration: 6min
completed: 2026-03-16
---

# Phase 26 Plan 02: useImageModal TQ Refactoring Summary

**useImageModal рефакторирован с setInterval на TanStack Query refetchInterval для Celery task polling, с автоматической visibility паузой и query invalidation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-16T15:03:08Z
- **Completed:** 2026-03-16T15:09:27Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Полная перезапись useImageModal.ts: ручной setInterval/clearInterval/AbortController/useVisibilityManager заменён на TQ useQuery с refetchInterval
- P7 visibility пауза теперь "из коробки" через focusManager (уже настроен в queryClient.ts)
- Добавлена инвалидация byDescription + byBook + userStats при успешной генерации
- Добавлен taskStatus query key factory в queryKeys.ts
- Сокращение кода: 584 -> 329 строк (уменьшение на 44%)
- Внешний API (UseImageModalReturn) полностью сохранён -- EpubReader.tsx не изменён

## Task Commits

Each task was committed atomically:

1. **Task 1: Добавить taskStatus query key и рефакторировать useImageModal на TQ** - `16137f2` (refactor)

**Plan metadata:** TBD

## Files Created/Modified
- `frontend/src/hooks/epub/useImageModal.ts` - Полностью переписан на TQ: useQuery с refetchInterval для polling
- `frontend/src/hooks/api/queryKeys.ts` - Добавлен taskStatus query key factory
- `frontend/src/hooks/reader/useReaderImageModal.ts` - Добавлена @deprecated аннотация
- `frontend/src/components/Reader/DescriptionDrawer.tsx` - Исправлен тип error в onError callback (Rule 3)

## Decisions Made
- TQ useQuery refetchInterval заменяет ручной setInterval для Celery task polling
- Visibility пауза через встроенный focusManager вместо useVisibilityManager -- упрощение без потери функциональности
- useReaderImageModal помечен @deprecated а не удалён -- для сохранения совместимости с orphaned BookReader.tsx
- taskStatus key не содержит userId -- taskId уже уникален через Celery

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Исправлен тип error в DescriptionDrawer.tsx onError callback**
- **Found during:** Task 1 (build verification)
- **Issue:** `error.message` на `unknown` типе -- TypeScript strict mode ошибка (из предыдущего плана 26-01)
- **Fix:** Добавлена проверка `error instanceof Error ? error.message : String(error)`
- **Files modified:** `frontend/src/components/Reader/DescriptionDrawer.tsx`
- **Verification:** `npm run build` проходит успешно
- **Committed in:** `16137f2` (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Минимальный auto-fix для прохождения build. Не scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Image generation pipeline полностью на TanStack Query: мутации (26-01), polling (26-02)
- Все image-related hooks унифицированы с TQ архитектурой проекта
- Готово к дальнейшей работе над milestone

## Self-Check: PASSED

- FOUND: frontend/src/hooks/epub/useImageModal.ts
- FOUND: frontend/src/hooks/api/queryKeys.ts
- FOUND: frontend/src/hooks/reader/useReaderImageModal.ts
- FOUND: .planning/phases/26-fix-images/26-02-SUMMARY.md
- FOUND: commit 16137f2

---
*Phase: 26-fix-images*
*Completed: 2026-03-16*
