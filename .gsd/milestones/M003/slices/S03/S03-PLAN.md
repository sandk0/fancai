# S03: Text Selection Notes

**Goal:** Разблокировка мобильного выделения текста в epub.
**Demo:** Разблокировка мобильного выделения текста в epub.

## Must-Haves


## Tasks

- [x] **T01: 18-text-selection-notes 01** `est:6min`
  - Разблокировка мобильного выделения текста в epub.js iframe.

Purpose: Сейчас CSS `user-select: none` в useContentHooks.ts (строки 154-163) полностью блокирует выделение на мобильных. Gesture controller проверяет selection только в touchstart, но не в touchmove. Нужно: (1) убрать CSS-блокировку, (2) добавить selection passthrough в gesture controller, (3) подавить нативное контекстное меню, (4) блокировать выделение во время анимации через CSS class.

Output: Мобильное выделение текста работает, gesture controller не конфликтует с drag handles.
- [x] **T02: 18-text-selection-notes 02** `est:11min`
  - Создание HighlightTooltip компонента и подключение highlightPopup из useAnnotationRendering к UI.

Purpose: useAnnotationRendering уже генерирует highlightPopup state при клике по `.user-annotation`, но этот state нигде не отображается. EpubReader деструктурирует только `flashAnnotation`, игнорируя `highlightPopup` и `closePopup`. Нужно создать UI-компонент для отображения tooltip, подключить всё в EpubReader, и реализовать Edit через pre-populated SelectionMenu (per user decision).

Output: Рабочий tooltip при тапе по highlight с возможностью удаления и редактирования заметки.

## Files Likely Touched

- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts`
- `frontend/src/hooks/epub/useContentHooks.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/__tests__/HighlightTooltip.test.tsx`
- `frontend/src/components/Reader/HighlightTooltip.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/components/Reader/Core/ReaderModals.tsx`
- `frontend/src/hooks/epub/useAnnotationRendering.ts`
- `frontend/src/components/Reader/SelectionMenu.tsx`
