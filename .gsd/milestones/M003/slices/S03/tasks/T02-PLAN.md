# T02: 18-text-selection-notes 02

**Slice:** S03 — **Milestone:** M003

## Description

Создание HighlightTooltip компонента и подключение highlightPopup из useAnnotationRendering к UI.

Purpose: useAnnotationRendering уже генерирует highlightPopup state при клике по `.user-annotation`, но этот state нигде не отображается. EpubReader деструктурирует только `flashAnnotation`, игнорируя `highlightPopup` и `closePopup`. Нужно создать UI-компонент для отображения tooltip, подключить всё в EpubReader, и реализовать Edit через pre-populated SelectionMenu (per user decision).

Output: Рабочий tooltip при тапе по highlight с возможностью удаления и редактирования заметки.

## Must-Haves

- [ ] "Тап по существующему highlight показывает компактный tooltip с текстом заметки и кнопками Edit/Delete"
- [ ] "Кнопка Delete удаляет заметку, tooltip закрывается"
- [ ] "Кнопка Edit открывает SelectionMenu в режиме редактирования заметки"
- [ ] "Тап вне tooltip закрывает его"
- [ ] "highlightPopup из useAnnotationRendering подключён к UI"

## Files

- `frontend/src/components/Reader/__tests__/HighlightTooltip.test.tsx`
- `frontend/src/components/Reader/HighlightTooltip.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/components/Reader/Core/ReaderModals.tsx`
- `frontend/src/hooks/epub/useAnnotationRendering.ts`
- `frontend/src/components/Reader/SelectionMenu.tsx`
