# T01: 18-text-selection-notes 01

**Slice:** S03 — **Milestone:** M003

## Description

Разблокировка мобильного выделения текста в epub.js iframe.

Purpose: Сейчас CSS `user-select: none` в useContentHooks.ts (строки 154-163) полностью блокирует выделение на мобильных. Gesture controller проверяет selection только в touchstart, но не в touchmove. Нужно: (1) убрать CSS-блокировку, (2) добавить selection passthrough в gesture controller, (3) подавить нативное контекстное меню, (4) блокировать выделение во время анимации через CSS class.

Output: Мобильное выделение текста работает, gesture controller не конфликтует с drag handles.

## Must-Haves

- [ ] "Long-press + drag выделяет текст на мобильных устройствах"
- [ ] "Gesture controller не перехватывает drag handles при расширении выделения"
- [ ] "Нативное контекстное меню скрыто на мобильных, показывается только SelectionMenu"
- [ ] "Выделение заблокировано во время spring-анимации (phase !== 'idle')"

## Files

- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts`
- `frontend/src/hooks/epub/useContentHooks.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
