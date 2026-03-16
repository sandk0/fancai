---
phase: 28-frontend-backend-ux-error-handling
plan: 02
subsystem: ui
tags: [react, tanstack-query, mutation, cache-invalidation, dead-code-cleanup]

# Dependency graph
requires:
  - phase: 26-image-generation-fixes
    provides: useRegenerateImage mutation hook с TQ cache invalidation
provides:
  - ImageModal использует useRegenerateImage mutation вместо прямого API вызова
  - Удалены 314 строк dead code (useAsyncImageGeneration + useReaderImageModal)
  - bookId проброс через EpubReader -> ReaderModals -> ImageModal
affects: [image-generation, reader]

# Tech tracking
tech-stack:
  added: []
  patterns: [direct-hook-in-conditional-render, mutation-for-cache-invalidation]

key-files:
  created: []
  modified:
    - frontend/src/components/Images/ImageModal.tsx
    - frontend/src/components/Reader/Core/ReaderModals.tsx
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/hooks/api/useImages/index.ts
    - frontend/src/hooks/api/index.ts
    - frontend/src/hooks/reader/index.ts
    - frontend/src/components/Reader/BookReader.tsx

key-decisions:
  - "useRegenerateImage() вызывается напрямую внутри ImageModal (direct hook) -- безопасно т.к. ImageModal условно рендерится (mount/unmount), а не условно вызывается"
  - "BookReader.tsx: useReaderImageModal заменён на inline state вместо удаления всего компонента (минимально инвазивный подход)"

patterns-established:
  - "Direct hook pattern: mutation hooks можно вызывать в компонентах с conditional rendering (mount/unmount) -- Rules of Hooks соблюдены"

requirements-completed: [FIMG-01, FIMG-05, FIMG-06]

# Metrics
duration: 10min
completed: 2026-03-16
---

# Phase 28 Plan 02: Image Regeneration Mutation + Dead Code Cleanup Summary

**ImageModal переключён на useRegenerateImage mutation hook с автоматической TQ cache invalidation, удалены 314 строк dead code (useAsyncImageGeneration + useReaderImageModal)**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-16T19:55:48Z
- **Completed:** 2026-03-16T20:06:27Z
- **Tasks:** 2
- **Files modified:** 9 (3 modified + 2 deleted + 4 barrel exports updated)

## Accomplishments
- ImageModal.tsx использует useRegenerateImage() mutation вместо прямого imagesAPI.regenerateImage() -- TQ cache invalidation (byDescription + all) происходит автоматически
- bookId проброшен через EpubReader -> ReaderModals -> ImageModal для корректной cache isolation
- useAsyncImageGeneration.ts (241 строка) и useReaderImageModal.ts (73 строки) удалены как dead code
- Все barrel exports обновлены, production build проходит без ошибок

## Task Commits

Each task was committed atomically:

1. **Task 1: ImageModal -- переключение на useRegenerateImage mutation** - `4ed214b` (fix)
2. **Task 2: Dead code cleanup -- удаление useAsyncImageGeneration и useReaderImageModal** - `6d622df` (chore)

## Files Created/Modified
- `frontend/src/components/Images/ImageModal.tsx` - Замена imagesAPI.regenerateImage() на useRegenerateImage mutation hook, добавлен bookId prop
- `frontend/src/components/Reader/Core/ReaderModals.tsx` - Добавлен bookId в imageModal interface и проброс в ImageModal
- `frontend/src/components/Reader/EpubReader.tsx` - Передача book.id как bookId в imageModal prop
- `frontend/src/hooks/api/useImages/useAsyncImageGeneration.ts` - DELETED (241 строка dead code)
- `frontend/src/hooks/reader/useReaderImageModal.ts` - DELETED (73 строки dead code)
- `frontend/src/hooks/api/useImages/index.ts` - Удалён export useAsyncImageGeneration
- `frontend/src/hooks/api/index.ts` - Удалён re-export useAsyncImageGeneration
- `frontend/src/hooks/reader/index.ts` - Удалён export useReaderImageModal
- `frontend/src/components/Reader/BookReader.tsx` - useReaderImageModal заменён на inline state

## Decisions Made
- useRegenerateImage() вызывается как direct hook внутри ImageModal (безопасно: условный render = mount/unmount, не условный hook call)
- BookReader.tsx: вместо удаления всего orphaned компонента, useReaderImageModal заменён на inline state -- минимально инвазивный подход для build compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Фикс BookReader.tsx после удаления useReaderImageModal**
- **Found during:** Task 2 (dead code cleanup)
- **Issue:** BookReader.tsx импортировал useReaderImageModal из @/hooks/reader -- после удаления файла build ломался
- **Fix:** Заменён import и вызов useReaderImageModal() на inline state с идентичным интерфейсом
- **Files modified:** frontend/src/components/Reader/BookReader.tsx
- **Verification:** npm run build проходит без ошибок
- **Committed in:** 6d622df (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix необходим для корректной компиляции. Предусмотрен в плане как fallback сценарий. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 28 Plan 02 завершён -- все frontend image bug fixes/cleanup выполнены
- Production build проходит, TypeScript ошибок в production коде нет
- Pre-existing тест ошибки (EpubReader.test.tsx) не связаны с этим планом

---
## Self-Check: PASSED

All 7 modified files exist, 2 deleted files confirmed absent, both commits (4ed214b, 6d622df) verified in git log.

---
*Phase: 28-frontend-backend-ux-error-handling*
*Completed: 2026-03-16*
