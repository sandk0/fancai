---
phase: 08-reader-features
plan: 01
subsystem: api, database, ui
tags: [bookmarks, highlights, cfi, sqlalchemy, pydantic, tanstack-query, zustand, optimistic-updates]

# Dependency graph
requires:
  - phase: 07-ux
    provides: Стабильная обработка ошибок в Reader
provides:
  - SQLAlchemy модели Bookmark и Highlight с CFI-позиционированием
  - 7 REST CRUD endpoints для закладок и выделений
  - Batch sync обработчики для bookmarks/highlights (замена 501 заглушек)
  - Pydantic v2 схемы для валидации запросов/ответов
  - Обновленный Zustand store с CFI вместо page number
  - 7 TanStack Query хуков с optimistic updates
  - Alembic миграция для таблиц bookmarks и highlights
affects: [08-02-PLAN, 08-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [CFI-based bookmarks, optimistic Zustand + TQ mutations, batch sync handlers]

key-files:
  created:
    - backend/app/models/bookmark.py
    - backend/app/models/highlight.py
    - backend/app/schemas/sync.py
    - backend/alembic/versions/2026_03_05_0001_add_bookmarks_and_highlights_tables.py
    - frontend/src/hooks/api/useSync.ts
  modified:
    - backend/app/models/__init__.py
    - backend/app/routers/sync.py
    - frontend/src/stores/reader.ts
    - frontend/src/hooks/api/queryKeys.ts
    - frontend/src/types/state.ts
    - frontend/src/utils/cacheManager.ts

key-decisions:
  - "UniqueConstraint(user_id, book_id, cfi) предотвращает дубликаты закладок на одной CFI позиции"
  - "Highlight updated_at с onupdate=func.now() для трекинга изменений заметок"
  - "Batch sync использует process_bookmark_sync/process_highlight_sync вместо 501 заглушек"
  - "Optimistic updates: Zustand store обновляется мгновенно, TQ кэш инвалидируется в onSettled"
  - "page поле в bookmarks стало опциональным для обратной совместимости с localStorage данными"

patterns-established:
  - "CFI-based bookmarks: cfi вместо page number для точного позиционирования"
  - "Dual optimistic updates: Zustand (мгновенный UI) + TQ cache (серверная синхронизация)"
  - "syncKeys в queryKeys.ts: ['books', userId, bookId, 'bookmarks'|'highlights']"

requirements-completed: [READ-03, READ-01, READ-02]

# Metrics
duration: 7min
completed: 2026-03-05
---

# Phase 8 Plan 01: Bookmark/Highlight Data Layer Summary

**SQLAlchemy модели + Alembic миграция + 7 REST CRUD endpoints + Zustand CFI store + 7 TanStack Query хуков с optimistic updates для закладок и выделений**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-05T10:58:32Z
- **Completed:** 2026-03-05T11:05:32Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Bookmark модель с CFI позиционированием, UniqueConstraint для предотвращения дубликатов
- Highlight модель с CFI range, цвет, заметка, composite index для быстрых запросов
- 7 REST endpoints (GET/POST/DELETE bookmarks, GET/POST/PUT/DELETE highlights) с проверкой ownership
- Batch sync обрабатывает bookmarks/highlights вместо 501 заглушек
- Zustand store обновлен: CFI вместо page number, обратная совместимость сохранена
- 7 TanStack Query хуков с optimistic updates через Zustand + query cache rollback

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend модели + миграция + CRUD endpoints + Pydantic схемы** - `c60ec76` (feat)
2. **Task 2: Zustand store (CFI) + TanStack Query хуки с optimistic updates** - `3d00729` (feat)

## Files Created/Modified
- `backend/app/models/bookmark.py` - SQLAlchemy модель Bookmark (CFI, user_id, book_id, UniqueConstraint)
- `backend/app/models/highlight.py` - SQLAlchemy модель Highlight (CFI range, цвет, заметка)
- `backend/app/models/__init__.py` - Регистрация новых моделей
- `backend/app/schemas/sync.py` - Pydantic v2 схемы (BookmarkCreate/Response, HighlightCreate/Update/Response)
- `backend/app/routers/sync.py` - 7 CRUD endpoints + batch sync обработчики
- `backend/alembic/versions/2026_03_05_0001_add_bookmarks_and_highlights_tables.py` - Миграция
- `frontend/src/stores/reader.ts` - Zustand store с CFI bookmarks/highlights
- `frontend/src/hooks/api/queryKeys.ts` - syncKeys для bookmarks/highlights
- `frontend/src/hooks/api/useSync.ts` - 7 TanStack Query хуков с optimistic updates
- `frontend/src/types/state.ts` - Обновленные LocalBookmark/LocalHighlight типы
- `frontend/src/utils/cacheManager.ts` - Обновленный ReadingProgressBackup тип

## Decisions Made
- UniqueConstraint(user_id, book_id, cfi) для предотвращения дубликатов закладок
- `page` поле стало опциональным в bookmarks для обратной совместимости с существующими localStorage данными
- Highlight `updated_at` с `onupdate=func.now()` для автоматического трекинга изменений
- Batch sync handlers используют те же модели/логику что и REST endpoints
- Optimistic updates: Zustand обновляется в onMutate, rollback из snapshot в onError, invalidate в onSettled

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Исправлен конфликт revision ID в Alembic миграции**
- **Found during:** Task 1 (Alembic migration)
- **Issue:** Изначально использованный ID `a1b2c3d4e5f6` уже существовал в другой миграции
- **Fix:** Сгенерирован уникальный ID `c01994cc9354`
- **Files modified:** backend/alembic/versions/2026_03_05_0001_add_bookmarks_and_highlights_tables.py
- **Verification:** Alembic chain valid: HEAD c01994cc9354 -> down ff9dd781cd6e
- **Committed in:** c60ec76

**2. [Rule 3 - Blocking] Обновлен ReadingProgressBackup тип в cacheManager.ts**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** ReadingProgressBackup использовал старые типы (page: number, без cfi/cfiRange)
- **Fix:** Обновлен интерфейс для соответствия новым типам bookmark/highlight
- **Files modified:** frontend/src/utils/cacheManager.ts
- **Verification:** TypeScript компиляция и build проходят без ошибок
- **Committed in:** 3d00729

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Оба исправления необходимы для корректной работы. Без scope creep.

## Issues Encountered
- PostgreSQL не запущен локально - миграция создана вручную (будет применена на сервере через `alembic upgrade head`)
- 2 pre-existing TS ошибки в тестовых файлах (EpubReader.test.tsx, errorMessages.test.ts) - не связаны с изменениями

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data layer полностью готов для визуального UI закладок/выделений (план 08-02)
- API endpoints протестированы через import проверку, все 8 routes зарегистрированы
- Frontend build проходит, TypeScript без новых ошибок
- Миграция готова к применению на сервере

## Self-Check: PASSED

All 10 created/modified files verified on disk. Both task commits (c60ec76, 3d00729) verified in git log.

---
*Phase: 08-reader-features*
*Completed: 2026-03-05*
