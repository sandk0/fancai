---
id: S03
parent: M003
milestone: M003
provides:
  - Разблокированное мобильное выделение текста в epub.js iframe
  - CSS class selection-blocked для блокировки при анимации
  - Подавление нативного контекстного меню на мобильных
  - Selection passthrough в gesture controller touchmove
  - HighlightTooltip компонент для отображения popup при тапе по highlight
  - Edit mode в SelectionMenu для редактирования существующих заметок
  - Полный wiring highlightPopup -> EpubReader -> ReaderModals -> HighlightTooltip
requires: []
affects: []
key_files: []
key_decisions:
  - "CSS class toggle (body.selection-blocked) вместо JS guard для блокировки выделения при анимации"
  - "contextmenu suppression через navigator.maxTouchPoints / ontouchstart проверку (не глобально)"
  - "HighlightTooltip позиционирование: выше/ниже точки тапа на основе 50% viewport"
  - "Edit mode в SelectionMenu через editMode prop с pre-populated полями (не отдельный компонент)"
  - "EditModeData экспортирован как отдельный интерфейс для type safety"
patterns_established:
  - "selection-blocked CSS class: добавляется/удаляется через useEffect на phase state"
  - "Mock rendition pattern для тестирования useContentHooks CSS injection"
  - "EditMode pattern: переиспользование SelectionMenu для edit через editMode prop"
  - "Highlight popup wiring: useAnnotationRendering -> EpubReader -> ReaderModals -> HighlightTooltip"
observability_surfaces: []
drill_down_paths: []
duration: 11min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---
# S03: Text Selection Notes

**# Phase 18 Plan 01: Разблокировка мобильного выделения текста Summary**

## What Happened

# Phase 18 Plan 01: Разблокировка мобильного выделения текста Summary

**Убран CSS user-select:none для мобильных, добавлен selection-blocked class для анимации, contextmenu suppression и selection passthrough в gesture controller**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-11T16:24:32Z
- **Completed:** 2026-03-11T16:31:06Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Удален CSS блок `@media (pointer: coarse)` с `user-select: none` -- основная причина неработающего выделения на мобильных
- Добавлен CSS class `body.selection-blocked *` для динамической блокировки выделения во время spring-анимации
- Добавлено подавление нативного контекстного меню на мобильных (только touch devices)
- Gesture controller теперь отменяет жест при активном text selection в touchmove (защита drag handles)
- useEffect в gesture controller toggle-ит selection-blocked class по phase state

## Task Commits

Each task was committed atomically:

1. **Task 0: Создание тест-стабов для useContentHooks** - `c11f583` (test)
2. **Task 1: CSS-разблокировка выделения и подавление контекстного меню** - `5a6126d` (feat)
3. **Task 2: Selection passthrough в gesture controller и toggle selection-blocked** - `c4213e6` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` -- Тесты для CSS injection: selection-blocked, contextmenu, отсутствие user-select:none
- `frontend/src/hooks/epub/useContentHooks.ts` -- Убран @media (pointer: coarse), добавлен selection-blocked CSS, contextmenu listener
- `frontend/src/hooks/epub/useGestureController.ts` -- Selection passthrough в touchmove, useEffect для toggle selection-blocked class

## Decisions Made
- CSS class toggle (`body.selection-blocked`) вместо JS guard -- надежнее, работает даже если JS не успевает
- contextmenu подавление через `navigator.maxTouchPoints > 0 || 'ontouchstart' in window` -- стандартный touch device detection
- `-webkit-touch-callout: none` НЕ применен глобально -- ломает long-press выделение на iOS, оставлен только на `.description-highlight`

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- Мобильное выделение текста разблокировано, готово для Plan 02 (HighlightTooltip)
- useTextSelection уже слушает rendition 'selected' event -- теперь должен корректно срабатывать на мобильных
- SelectionMenu готов показывать popup при выделении
- iOS drag handles поведение требует ручного тестирования (confidence MEDIUM, отмечено в STATE.md)

## Self-Check: PASSED

All files verified present. All 3 task commits verified in git log.

---
*Phase: 18-text-selection-notes*
*Completed: 2026-03-11*

# Phase 18 Plan 02: HighlightTooltip Summary

**Компактный tooltip при тапе по highlight с Edit (pre-populated SelectionMenu) и Delete, wiring highlightPopup через EpubReader**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-11T16:37:08Z
- **Completed:** 2026-03-11T16:48:37Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- HighlightTooltip компонент с текстом заметки (line-clamp-3), цветовым индикатором, кнопками Edit/Delete (44px touch targets)
- highlightPopup и closePopup из useAnnotationRendering подключены через EpubReader -> ReaderModals
- SelectionMenu поддерживает editMode: pre-populated поля, save через updateBookmark
- 6 тестов покрывают: null render, note text, onEdit/onDelete callbacks, click outside close

## Task Commits

Each task was committed atomically:

1. **Task 0: Создание тест-стабов для HighlightTooltip** - `5a9c2ce` (test)
2. **Task 1: Создание HighlightTooltip компонента** - `44ec77c` (feat)
3. **Task 2: Wiring HighlightTooltip в EpubReader и ReaderModals + Edit mode** - `e007090` (feat)

## Files Created/Modified
- `frontend/src/components/Reader/HighlightTooltip.tsx` - Компактный tooltip с note, Edit, Delete
- `frontend/src/components/Reader/__tests__/HighlightTooltip.test.tsx` - 6 тестов компонента
- `frontend/src/hooks/epub/useAnnotationRendering.ts` - Export HighlightPopup interface
- `frontend/src/components/Reader/EpubReader.tsx` - Wiring highlightPopup, editingBookmark state, highlight handlers
- `frontend/src/components/Reader/Core/ReaderModals.tsx` - HighlightTooltip + editMode props forwarding
- `frontend/src/components/Reader/SelectionMenu.tsx` - EditModeData interface, editMode prop, pre-populated fields

## Decisions Made
- Edit mode реализован через добавление editMode prop в существующий SelectionMenu (не отдельный компонент) -- минимум нового кода
- HighlightTooltip позиционируется выше/ниже точки тапа на основе 50% viewport (как в SelectionMenu)
- В edit mode кнопка Back (X) закрывает edit mode целиком (не возвращает в main submenu)
- EditModeData экспортирован как отдельный интерфейс из SelectionMenu для переиспользования в ReaderModals

## Deviations from Plan

None - план выполнен точно как описано.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Highlight tooltip полностью функционален для тапа по существующим annotation spans
- Phase 18 завершена: выделение текста разблокировано (18-01), tooltip и edit mode работают (18-02)
- Готово к Phase 19 (описания) или Phase 20 (полировка)

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 18-text-selection-notes*
*Completed: 2026-03-11*
