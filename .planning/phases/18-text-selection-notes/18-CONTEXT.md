# Phase 18: Выделение текста и заметки - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Работающее выделение текста и создание заметок на мобильных устройствах без конфликтов с gesture controller. Вся инфраструктура заметок (useTextSelection, SelectionMenu, useBookmarks, useAnnotationRendering) уже реализована и работает на десктопе. Фокус — разблокировка мобильного выделения и интеграция с gesture pipeline.

</domain>

<decisions>
## Implementation Decisions

### Активация выделения (SEL-01)
- Long-press всегда работает — как в Kindle/Apple Books, без кнопки-переключателя режима
- Убрать CSS `user-select: none` для мобильных из useContentHooks.ts (строки 154-163)
- Gesture controller уже отступает при long-press (LONG_PRESS_TIMEOUT=350ms) — без изменений
- Случайные выделения не проблема — тап по странице снимает выделение (уже реализовано)
- Любой непустой текст показывает SelectionMenu — без минимального порога символов
- Выделение сбрасывается при перелистывании страницы (CFI change) — уже реализовано в EpubReader.tsx:529
- Во время spring-анимации (phase !== 'idle') выделение заблокировано — предотвращает глитчи при движении DOM
- Нативное выделение с CSS ::selection цветами по теме (уже есть в useContentHooks.ts:180-184)

### Контекстное меню
- На мобильных: скрыть нативное контекстное меню браузера, показывать только наш SelectionMenu
- На десктопе: оба меню — нативное (right-click) и наш SelectionMenu (при отпускании мыши) — не конфликтуют
- Drag handles нативные должны остаться для расширения выделения

### Меню после выделения (SEL-02)
- Текущий SelectionMenu без изменений: Main (Copy/Note) → Note (палитра + стили + textarea + Save)
- Позиционирование: текущее fixed сверху/снизу выделения (SelectionMenu.tsx:119-146) — без изменений
- После Save: меню закрывается, highlight мгновенно появляется на странице (useAnnotationRendering реагирует на изменения bookmarks)
- Без haptic feedback, без toast — визуального отклика (появление highlight) достаточно

### Поведение drag handles
- При активном выделении gesture controller полностью отключает свайп-навигацию (passthrough)
- Проверка в touchstart: `sel.toString().length > 0` — уже реализовано (useGestureController.ts:335-336)
- Тап вне выделения/меню снимает selection и возвращает навигацию (уже реализовано в useTextSelection:110-123)

### Тап на существующий highlight
- Короткий тап на rendered highlight показывает компактный tooltip: текст заметки + кнопки Редактировать / Удалить
- Позиционируется как SelectionMenu — сверху/снизу точки тапа
- Long-press на highlight запускает новое выделение поверх — различается по длительности
- Gesture controller уже распознаёт клик по `.user-annotation` (getInteractiveType)

### Визуальная индикация
- Никакой индикации что выделение возможно — long-press стандартный мобильный паттерн
- Шапка не меняет состояние при выделении — остаётся как есть (immersive mode сохраняется)

### Claude's Discretion
- Технический подход к подавлению нативного контекстного меню на мобильных (contextmenu event, -webkit-touch-callout)
- Как именно блокировать выделение во время анимации (CSS toggle vs. JS guard)
- Дизайн tooltip для существующих highlights (размеры, стили, анимация)
- Точная реализация passthrough — может потребоваться дополнительная проверка selection state в touchmove

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useTextSelection.ts` (147 строк): полностью реализован — слушает rendition 'selected', извлекает CFI range, text, position для popup
- `SelectionMenu.tsx` (349 строк): полностью реализован — Copy/Note flow, палитра цветов, стили, textarea, positioning
- `useBookmarks.ts` (80+ строк): полностью реализован — CRUD через TanStack Query sync hooks
- `useAnnotationRendering.ts` (460+ строк): полностью реализован — DOM span wrapping для отображения highlights
- `useGestureController.ts` (1016 строк): FSM gesture controller с long-press detection и active selection check
- `useContentHooks.ts`: CSS injection включая user-select: none на мобильных (строки 154-163) и ::selection цвета (строки 180-184)

### Established Patterns
- FSM gesture controller: `idle → pending → swiping | tap | cancelled` — ref-based, zero re-renders
- `getInteractiveType()`: определяет тип интерактивного элемента (description, entity, annotation, link)
- CSS injection через rendition.themes.default() в useContentHooks
- BOOKMARK_COLORS: 4 цвета (yellow, green, blue, pink) — используется в SelectionMenu и BookmarksList
- DOM span wrapping: TreeWalker + Range API для рендеринга highlights (вместо epub.js SVG)

### Integration Points
- `EpubReader.tsx:374`: useTextSelection подключён, selection передаётся в SelectionMenu
- `EpubReader.tsx:529`: clearSelection при смене CFI
- `EpubReader.tsx:741`: SelectionMenu рендерится с onCopy, onBookmark, onClose
- `useGestureController.ts:335-336`: touchstart проверяет активное выделение перед началом жеста
- `useGestureController.ts:503-506`: touchend пропускает long-press (duration >= LONG_PRESS_TIMEOUT)

</code_context>

<specifics>
## Specific Ideas

- "Как в Kindle/Apple Books" — long-press зажал и потянул, стандартный мобильный паттерн
- Нативные drag handles для расширения выделения — не кастомные
- Чистый интерфейс без лишних элементов — immersive mode сохраняется

</specifics>

<deferred>
## Deferred Ideas

Нет — обсуждение осталось в рамках фазы.

</deferred>

---

*Phase: 18-text-selection-notes*
*Context gathered: 2026-03-11*
