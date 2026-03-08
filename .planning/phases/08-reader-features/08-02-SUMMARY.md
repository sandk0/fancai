---
phase: 08-reader-features
plan: 02
subsystem: ui, api, database
tags: [bookmarks, highlights, annotations, notes, selection-menu, epub.js, dom-wrapping, cfi]

# Dependency graph
requires:
  - phase: 08-reader-features/01
    provides: "Bookmark/Highlight модели, CRUD endpoints, Zustand store, TanStack Query хуки"
provides:
  - "Единая модель заметок (Notes) — слияние bookmarks и highlights"
  - "SelectionMenu с подменю цветов и текстовым редактором заметок"
  - "DOM span wrapping для рендеринга аннотаций (вместо SVG overlay epub.js)"
  - "BookmarksList с группировкой по главам и навигацией"
  - "Вкладки в TocSidebar: Оглавление | Заметки"
  - "text_color и bg_color поддержка для аннотаций"
  - "CFI fallback для epub.js path mismatches"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DOM span wrapping вместо epub.js SVG annotations — корректные bg-color, text-color, bold/italic/underline"
    - "TreeWalker с parentNode root для обхода text nodes в Range"
    - "resolveRangeFallback() для CFI path mismatches от epub.js anonymous span wrapping"
    - "compareBoundaryPoints: START_TO_END сравнивает this.END vs source.START (counterintuitive)"

key-files:
  created:
    - frontend/src/hooks/epub/useAnnotationRendering.ts
    - frontend/src/hooks/epub/useBookmarks.ts
    - frontend/src/components/Reader/BookmarksList.tsx
    - backend/alembic/versions/2026_03_06_0001_merge_bookmarks_highlights.py
  modified:
    - frontend/src/components/Reader/SelectionMenu.tsx
    - frontend/src/components/Reader/TocSidebar.tsx
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/components/Reader/Core/ReaderModals.tsx
    - frontend/src/hooks/api/useSync.ts
    - frontend/src/hooks/api/queryKeys.ts
    - frontend/src/stores/reader.ts
    - frontend/src/services/db.ts
    - frontend/src/services/syncQueue.ts
    - frontend/src/types/epub.ts
    - frontend/src/utils/cacheManager.ts
    - backend/app/models/bookmark.py
    - backend/app/routers/sync.py
    - backend/app/schemas/sync.py
  deleted:
    - frontend/src/hooks/epub/useHighlights.ts
    - frontend/src/components/Reader/HighlightsList.tsx
    - backend/app/models/highlight.py

key-decisions:
  - "Слияние highlights в bookmarks — единая модель 'Notes' вместо двух отдельных сущностей"
  - "DOM span wrapping вместо epub.js rendition.annotations.highlight() — SVG overlay не поддерживает bg-color/text-color"
  - "text_color добавлен как отдельное поле (Alembic миграция) для поддержки цветного текста"
  - "TreeWalker root = parentNode (не commonAncestorContainer) — text nodes не имеют descendants"
  - "resolveRangeFallback() для epub.js anonymous span wrapping, сдвигающего CFI paths"
  - "compareBoundaryPoints: START_TO_END и END_TO_START имеют counterintuitive семантику"

patterns-established:
  - "Unified Notes model: bookmark = note без выделенного текста, highlight = note с cfi_range + color"
  - "DOM-based annotation rendering: TreeWalker + Range + span wrapping для точного контроля стилей"
  - "CFI fallback chain: resolveRange -> resolveRangeFallback (getElementById + TreeWalker offset)"

requirements-completed: [READ-01, READ-02]

# Metrics
duration: ~2h (3 сессии: первичная реализация + рефакторинг слияния + фиксы рендеринга)
completed: 2026-03-07
---

# Phase 8 Plan 02: Visual UI закладок и выделений — Summary

**Контекстное меню, annotation rendering через DOM span wrapping, списки заметок в TocSidebar + архитектурный рефакторинг: слияние highlights в bookmarks → единая модель Notes**

## Performance

- **Duration:** ~2 часа (3 сессии)
- **Started:** 2026-03-06
- **Completed:** 2026-03-07
- **Tasks:** 2 auto + 1 checkpoint (+ 3 follow-up фикса)
- **Files modified:** 29

## Accomplishments

- Контекстное меню SelectionMenu с подменю: Копировать | Заметка (цвета + textarea)
- DOM span wrapping для рендеринга аннотаций (заменил нерабочий epub.js SVG overlay)
- BookmarksList с группировкой по главам, навигацией и удалением
- Вкладки в TocSidebar: Оглавление | Заметки
- **Архитектурный рефакторинг**: слияние Highlight модели в Bookmark → единая модель Notes
- text_color + bg_color поддержка для аннотаций
- 3 бага в annotation rendering исправлены: compareBoundaryPoints, TreeWalker root, CFI fallback

## Task Commits

Каждая задача зафиксирована атомарно:

1. **Task 1: Хуки + SelectionMenu + annotation rendering** — `a6ed27f` (feat)
2. **Task 2: BookmarksList + HighlightsList + TocSidebar + EpubReader wiring** — `986d0a7` (feat)
3. **Рефакторинг: слияние highlights в bookmarks** — `1c90400` (feat) — архитектурное решение после Task 2
4. **Fix: i18n переименование bookmarks → notes** — `10a68db` (fix)
5. **Fix: annotation rendering — 3 бага** — `58e5d82` (fix)

## Files Created/Modified

### Созданные файлы
- `frontend/src/hooks/epub/useAnnotationRendering.ts` — DOM span wrapping для рендеринга аннотаций (460+ строк)
- `frontend/src/hooks/epub/useBookmarks.ts` — Хук CRUD заметок, связывающий UI с useSync
- `frontend/src/components/Reader/BookmarksList.tsx` — Список заметок с группировкой по главам
- `backend/alembic/versions/2026_03_06_0001_merge_bookmarks_highlights.py` — Миграция слияния таблиц
- `backend/alembic/versions/*_add_text_color_to_bookmarks.py` — Миграция text_color

### Удалённые файлы
- `frontend/src/hooks/epub/useHighlights.ts` — Заменён useBookmarks
- `frontend/src/components/Reader/HighlightsList.tsx` — Заменён BookmarksList
- `backend/app/models/highlight.py` — Данные мигрированы в bookmark таблицу

### Существенно изменённые файлы
- `frontend/src/components/Reader/SelectionMenu.tsx` — Переработан UI: подменю цветов + textarea
- `frontend/src/components/Reader/TocSidebar.tsx` — Добавлены вкладки Оглавление | Заметки
- `frontend/src/components/Reader/EpubReader.tsx` — Wiring хуков через ReaderModals
- `frontend/src/hooks/api/useSync.ts` — Упрощён: удалены highlight хуки
- `frontend/src/stores/reader.ts` — Единый store для notes (бывшие bookmarks + highlights)
- `frontend/src/services/db.ts` — IndexedDB schema обновлена
- `frontend/src/services/syncQueue.ts` — Очередь синхронизации упрощена
- `backend/app/routers/sync.py` — Удалены highlight endpoints, упрощены bookmark endpoints
- `backend/app/schemas/sync.py` — Единые схемы для notes
- `backend/app/models/bookmark.py` — Добавлены color, text_color, cfi_range, text_excerpt, note

## Decisions Made

### Архитектурное решение: слияние highlights в bookmarks
- **Причина:** Две отдельные модели (Bookmark + Highlight) создавали избыточную сложность — одинаковые CRUD, одинаковый UI flow, разница только в наличии цвета и текста
- **Результат:** Единая модель `Bookmark` (концептуально "Note") с опциональными полями color, text_color, cfi_range, note
- **Различие:** Закладка = note без выделенного текста (только CFI позиция), Выделение = note с cfi_range + color
- **Влияние:** 2 Alembic миграции (merge данных + добавление text_color), удаление 3 файлов

### DOM span wrapping вместо epub.js annotations API
- **Причина:** epub.js `rendition.annotations.highlight()` создаёт SVG overlay, который не поддерживает background-color, text-color, bold/italic/underline стили
- **Результат:** Собственная реализация через TreeWalker + Range + `<span>` wrapping с inline стилями
- **Сложность:** 3 бага в первой реализации (см. Deviations)

### compareBoundaryPoints семантика
- **Открытие:** `Range.START_TO_END` сравнивает `this.END` vs `source.START` (не this.START vs source.END) — имена counterintuitive
- **Влияние:** Первоначальная реализация отфильтровывала ВСЕ text nodes, оставляя 0 wrapped spans

### TreeWalker root для text node ranges
- **Открытие:** Когда Range покрывает один text node, `commonAncestorContainer` IS тот text node. TreeWalker обходит только descendants, а у text nodes их нет → 0 результатов
- **Fix:** Использовать `parentNode` как root для TreeWalker

### CFI path fallback
- **Открытие:** epub.js оборачивает body content в анонимный `<span>`, сдвигая CFI paths на один уровень
- **Fix:** `resolveRangeFallback()` — getElementById + TreeWalker offset resolution

## Deviations from Plan

### Архитектурное отклонение: слияние моделей

- **Тип:** Scope change — архитектурное решение после Task 2
- **Причина:** После реализации двух отдельных UI (BookmarksList + HighlightsList) стало очевидно, что модели дублируют друг друга
- **Влияние:** Значительное — 27 файлов затронуто, 2 миграции, удаление 3 файлов
- **Коммит:** `1c90400`

### Auto-fixed Issues

**1. [Rule 1 — Bug] epub.js SVG annotations не поддерживают нужные стили**
- **Found during:** Task 1 (useAnnotationRendering)
- **Issue:** `rendition.annotations.highlight()` создаёт SVG overlay, не поддерживающий bg-color
- **Fix:** Замена на DOM span wrapping через TreeWalker + Range API
- **Committed in:** `1c90400`

**2. [Rule 1 — Bug] compareBoundaryPoints constants swapped**
- **Found during:** Визуальное тестирование после `1c90400`
- **Issue:** START_TO_END и END_TO_START имеют counterintuitive семантику
- **Fix:** Исправлены условия фильтрации в TreeWalker
- **Committed in:** `58e5d82`

**3. [Rule 1 — Bug] TreeWalker root = text node**
- **Found during:** Визуальное тестирование
- **Issue:** Для single-text-node ranges, commonAncestorContainer = text node, у которого нет descendants
- **Fix:** root = parentNode
- **Committed in:** `58e5d82`

**4. [Rule 1 — Bug] CFI path mismatch от epub.js anonymous span**
- **Found during:** Визуальное тестирование
- **Issue:** epub.js оборачивает body в `<span>`, сдвигая paths
- **Fix:** `resolveRangeFallback()` с getElementById fallback
- **Committed in:** `58e5d82`

---

**Total deviations:** 1 scope change + 4 auto-fixed bugs
**Impact on plan:** Scope change улучшил архитектуру, баги были неизбежны при переходе на DOM wrapping

## Issues Encountered

- epub.js annotations API оказался непригодным для нужных стилей — потребовалась полная замена на DOM wrapping
- 3 неочевидных бага в DOM annotation rendering потребовали отдельной сессии фиксов

## User Setup Required

- Применить миграции: `cd backend && alembic upgrade head` (2 новые миграции)

## Next Phase Readiness

- Все 3 плана фазы 8 выполнены
- Функции ридера: заметки (закладки + выделения), поиск, entity popup — работают
- Готово к верификации фазы и закрытию milestone v1.0

## Self-Check: PASSED

- Commits: a6ed27f FOUND, 986d0a7 FOUND, 1c90400 FOUND, 10a68db FOUND, 58e5d82 FOUND
- Created files: useAnnotationRendering.ts FOUND, useBookmarks.ts FOUND, BookmarksList.tsx FOUND
- Deleted files: useHighlights.ts NOT FOUND (deleted), HighlightsList.tsx NOT FOUND (deleted), highlight.py NOT FOUND (deleted)

---

_Phase: 08-reader-features_
_Completed: 2026-03-07_
