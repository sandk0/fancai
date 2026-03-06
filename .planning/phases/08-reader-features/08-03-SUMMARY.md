---
phase: 08-reader-features
plan: 03
subsystem: ui
tags: [epub.js, search, entity-linking, react, typescript, framer-motion]

# Dependency graph
requires:
  - phase: 06-entity-wiki
    provides: "Entity deduplication и качество данных сущностей для popup"
  - phase: 08-reader-features/01
    provides: "Bookmark/Highlight data layer и Zustand store reader.ts"
provides:
  - "Полнотекстовый поиск по книге через epub.js spine iteration"
  - "SearchPanel UI с навигацией между результатами и переходом между главами"
  - "EntityPopup мини-карточка при тапе на подсвеченное имя персонажа"
  - "Расширенный useEntityNameHighlighting с передачей позиции клика"
affects: [08-reader-features/02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch search по spine items (5 за раз) с AbortController для отмены"
    - "Позиционирование popup через iframe getBoundingClientRect offset"
    - "AnimatePresence для slide-down/scale анимаций панелей"

key-files:
  created:
    - frontend/src/hooks/epub/useBookSearch.ts
    - frontend/src/components/Reader/SearchPanel.tsx
    - frontend/src/components/Reader/EntityPopup.tsx
  modified:
    - frontend/src/hooks/epub/useEntityNameHighlighting.ts
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/components/Reader/ReaderHeader.tsx
    - frontend/src/components/Reader/Core/ReaderUI.tsx
    - frontend/src/components/Reader/__tests__/EpubReader.test.tsx

key-decisions:
  - "Batch search по 5 глав с setTimeout(0) между батчами для non-blocking UI"
  - "Позиция popup вычисляется через iframe offset + target getBoundingClientRect"
  - "onEntityClick расширен с позицией: (entity, position) вместо только (entity)"

patterns-established:
  - "Spine iteration search: загрузка section -> find(query) -> unload -> следующая"
  - "Entity popup positioning: iframe rect + target rect для абсолютной позиции"

requirements-completed: [READ-04, READ-05]

# Metrics
duration: ~15min
completed: 2026-03-06
---

# Phase 8 Plan 03: Поиск по книге и Entity Popup Summary

**Полнотекстовый поиск по epub через spine iteration с навигацией между главами + мини-popup при тапе на имя персонажа с аватаркой и ссылкой на EntityDrawer**

## Performance

- **Duration:** ~15 мин (выполнение в 2 сессиях с checkpoint)
- **Started:** 2026-03-05
- **Completed:** 2026-03-06
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files modified:** 8

## Accomplishments

- Полнотекстовый поиск по всей книге через epub.js spine items с прогрессом и AbortController
- SearchPanel UI: выдвижная панель сверху с debounce, навигацией стрелками, keyboard shortcuts (Enter/Shift+Enter/Escape)
- EntityPopup: мини-карточка с аватаркой, описанием и ссылкой "Подробнее" на EntityDrawer
- Расширен useEntityNameHighlighting для передачи позиции клика в callback
- Визуальная проверка пользователем пройдена (approved)

## Task Commits

Each task was committed atomically:

1. **Task 1: useBookSearch + SearchPanel UI + кнопка поиска** - `3c5354e`, `cfad95f` (feat)
2. **Task 2: EntityPopup + useEntityNameHighlighting + wiring** - `1fb1479`, `4f66667`, `be4daea` (feat/test)
3. **Task 3: Checkpoint визуальная проверка** - approved пользователем

## Files Created/Modified

- `frontend/src/hooks/epub/useBookSearch.ts` - Хук полнотекстового поиска: spine iteration, batch processing, AbortController, навигация между результатами
- `frontend/src/components/Reader/SearchPanel.tsx` - Выдвижная панель поиска: input с debounce, стрелки навигации, счетчик результатов, прогресс поиска
- `frontend/src/components/Reader/EntityPopup.tsx` - Мини-popup при тапе на имя: аватарка, описание, ссылка на EntityDrawer, adaptive positioning
- `frontend/src/hooks/epub/useEntityNameHighlighting.ts` - Расширен callback с позицией клика через iframe offset
- `frontend/src/components/Reader/EpubReader.tsx` - Wiring: isSearchOpen state, popupEntity/popupPosition state, SearchPanel и EntityPopup
- `frontend/src/components/Reader/ReaderHeader.tsx` - Добавлена кнопка поиска (Search icon) в тулбар
- `frontend/src/components/Reader/Core/ReaderUI.tsx` - Интеграция SearchPanel и EntityPopup в layout
- `frontend/src/components/Reader/__tests__/EpubReader.test.tsx` - Обновлены моки для spine.first и новых пропсов

## Decisions Made

- Batch search по 5 глав с `setTimeout(0)` между батчами -- non-blocking UI для больших книг
- Позиция EntityPopup вычисляется через `iframe.getBoundingClientRect()` + `target.getBoundingClientRect()` -- точное позиционирование относительно viewport
- `onEntityClick` расширен до `(entity, position)` -- обратная совместимость сохранена, position опционален
- Используется `section.find()` вместо `section.search()` -- find() надежнее в epub.js 0.3.93

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Подавление ошибок при поиске в проблемных секциях**

- **Found during:** Task 1 (useBookSearch)
- **Issue:** Некоторые spine items могут выбросить ошибку при load/find (поврежденные секции)
- **Fix:** try/catch вокруг каждой section iteration, ошибки логируются но не прерывают поиск
- **Files modified:** frontend/src/hooks/epub/useBookSearch.ts
- **Committed in:** cfad95f

**2. [Rule 3 - Blocking] Обновление тестовых моков**

- **Found during:** Task 2 (EpubReader wiring)
- **Issue:** Существующие тесты EpubReader.test.tsx сломались из-за новых пропсов и spine.first
- **Fix:** Обновлены моки для spine, добавлены mock для новых пропсов
- **Files modified:** frontend/src/components/Reader/**tests**/EpubReader.test.tsx
- **Committed in:** be4daea

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Оба исправления необходимы для корректной работы. Без scope creep.

## Issues Encountered

None -- план выполнен без проблем.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Поиск и entity-linking работают, визуально подтверждено пользователем
- Осталось: план 08-02 (Bookmark/Highlight визуальный UI) -- data layer уже готов из плана 08-01
- Все reader features (поиск, entity popup, закладки/выделения) могут использоваться вместе

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commits: 3c5354e FOUND, cfad95f FOUND, 1fb1479 FOUND, 4f66667 FOUND, be4daea FOUND
- Created files: useBookSearch.ts FOUND, SearchPanel.tsx FOUND, EntityPopup.tsx FOUND

---

_Phase: 08-reader-features_
_Completed: 2026-03-06_
