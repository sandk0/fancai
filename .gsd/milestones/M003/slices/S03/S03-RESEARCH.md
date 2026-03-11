# Phase 18: Выделение текста и заметки - Research

**Researched:** 2026-03-11
**Domain:** Мобильное выделение текста в epub.js iframe, интеграция с gesture controller
**Confidence:** HIGH

## Summary

Фаза 18 фокусируется на разблокировке выделения текста на мобильных устройствах и создании tooltip для существующих highlights. Вся инфраструктура заметок уже реализована и работает на десктопе: useTextSelection (147 строк), SelectionMenu (349 строк), useBookmarks, useAnnotationRendering (460+ строк). Ключевая проблема -- CSS `user-select: none` в useContentHooks.ts (строки 154-163) блокирует выделение на мобильных, а gesture controller должен корректно пропускать touchmove при активном выделении.

Исследование кода выявило три основные задачи: (1) снятие CSS-блокировки выделения на мобильных, (2) подавление нативного контекстного меню браузера при сохранении нативных drag handles, (3) создание HighlightTooltip компонента для тапа по существующим highlights. Все необходимые данные (highlightPopup state) уже доступны из useAnnotationRendering, но не подключены к UI.

**Основная рекомендация:** Убрать `user-select: none` для мобильных, добавить `contextmenu` event preventDefault, подключить highlightPopup из useAnnotationRendering к новому HighlightTooltip компоненту, добавить CSS-блокировку выделения во время spring-анимации.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Long-press всегда работает -- как в Kindle/Apple Books, без кнопки-переключателя режима
- Убрать CSS `user-select: none` для мобильных из useContentHooks.ts (строки 154-163)
- Gesture controller уже отступает при long-press (LONG_PRESS_TIMEOUT=350ms) -- без изменений
- Любой непустой текст показывает SelectionMenu -- без минимального порога символов
- Выделение сбрасывается при перелистывании страницы (CFI change) -- уже реализовано
- Во время spring-анимации (phase !== 'idle') выделение заблокировано
- Нативное выделение с CSS ::selection цветами по теме (уже есть)
- На мобильных: скрыть нативное контекстное меню, показывать только SelectionMenu
- На десктопе: оба меню -- нативное (right-click) и SelectionMenu -- не конфликтуют
- Drag handles нативные должны остаться для расширения выделения
- Текущий SelectionMenu без изменений: Main (Copy/Note) -> Note (палитра + стили + textarea + Save)
- Позиционирование SelectionMenu: текущее fixed сверху/снизу -- без изменений
- После Save: highlight мгновенно появляется (useAnnotationRendering реагирует на изменения bookmarks)
- Без haptic feedback, без toast
- При активном выделении gesture controller полностью отключает свайп-навигацию (passthrough)
- Проверка в touchstart: `sel.toString().length > 0` -- уже реализовано (useGestureController.ts:335-336)
- Тап вне выделения/меню снимает selection и возвращает навигацию
- Тап на rendered highlight показывает компактный tooltip: текст заметки + Редактировать / Удалить
- Long-press на highlight запускает новое выделение поверх
- Gesture controller уже распознаёт клик по `.user-annotation` (getInteractiveType)
- Никакой индикации что выделение возможно -- стандартный мобильный паттерн

### Claude's Discretion
- Технический подход к подавлению нативного контекстного меню на мобильных (contextmenu event, -webkit-touch-callout)
- Как именно блокировать выделение во время анимации (CSS toggle vs. JS guard)
- Дизайн tooltip для существующих highlights (размеры, стили, анимация)
- Точная реализация passthrough -- может потребоваться дополнительная проверка selection state в touchmove

### Deferred Ideas (OUT OF SCOPE)
Нет -- обсуждение осталось в рамках фазы.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEL-01 | Пользователь может выделить текст long-press и drag без перехвата gesture controller | Снятие user-select: none в useContentHooks.ts; подавление contextmenu; gesture controller passthrough при активном selection; блокировка выделения во время анимации |
| SEL-02 | Пользователь может создать заметку/выделение из выделенного текста | SelectionMenu уже реализован; HighlightTooltip для тапа по существующим highlights; подключение highlightPopup из useAnnotationRendering к UI |
</phase_requirements>

## Standard Stack

### Core (уже в проекте)
| Library | Version | Purpose | Почему используется |
|---------|---------|---------|---------------------|
| epub.js | 0.3.93 | EPUB рендеринг | Единственный рендер-движок, `rendition.on('selected')` для выделения |
| React | 19 | UI фреймворк | Проект на React |
| motion/react | latest | Анимации | Используется в gesture controller, phase state |
| @tanstack/react-query | latest | Серверное состояние | Sync bookmarks через useBookmarks |

### Существующие модули (переиспользуются)
| Модуль | Строки | Назначение | Изменения |
|--------|--------|------------|-----------|
| `useTextSelection.ts` | 147 | Слушает rendition 'selected', извлекает CFI range, text, position | Без изменений |
| `SelectionMenu.tsx` | 349 | Copy/Note flow, палитра цветов, стили, textarea, positioning | Без изменений |
| `useBookmarks.ts` | 93 | CRUD через TanStack Query sync hooks | Без изменений |
| `useAnnotationRendering.ts` | 479 | DOM span wrapping, click handler, highlightPopup state | Минимальные изменения: wiring popup к UI |
| `useGestureController.ts` | 1016 | FSM gesture controller с touch detection | Добавить проверку selection в touchmove |
| `useContentHooks.ts` | 216 | CSS injection в epub iframe | Убрать user-select: none, добавить contextmenu |

## Architecture Patterns

### Рекомендуемая структура изменений
```
frontend/src/
├── hooks/epub/
│   ├── useContentHooks.ts        # MODIFY: убрать user-select:none, добавить contextmenu suppression
│   ├── useGestureController.ts   # MODIFY: добавить selection passthrough в touchmove
│   ├── useAnnotationRendering.ts # MINOR: возможно мелкие правки для highlight tap
│   └── useTextSelection.ts       # БЕЗ ИЗМЕНЕНИЙ
├── components/Reader/
│   ├── HighlightTooltip.tsx      # NEW: компонент tooltip для тапа по highlight
│   ├── SelectionMenu.tsx         # БЕЗ ИЗМЕНЕНИЙ
│   ├── EpubReader.tsx            # MODIFY: подключить highlightPopup + HighlightTooltip
│   └── Core/ReaderModals.tsx     # MODIFY: добавить HighlightTooltip render
```

### Pattern 1: CSS-блокировка выделения во время анимации
**Что:** Динамическое переключение `user-select` в iframe через CSS class или rendition.themes
**Когда использовать:** Во время spring-анимации (phase !== 'idle') выделение должно быть заблокировано
**Рекомендация: CSS toggle через content hook**

```typescript
// В useContentHooks.ts: добавить CSS class для блокировки
// Вместо статического user-select: none для @media (pointer: coarse)
// Использовать .selection-blocked класс, управляемый из gesture controller

// CSS в iframe:
// body.selection-blocked * { user-select: none !important; }

// JS: toggle class на body при phase change
```

Обоснование: CSS toggle через class на body надёжнее JS guard, потому что:
1. Работает даже если JS не успевает отреагировать на быстрый touch
2. Не требует синхронизации между gesture controller и useTextSelection
3. Легко тестируется -- достаточно проверить наличие class

Альтернатива (JS guard в useTextSelection): проще, но рискует пропустить edge case когда пользователь начинает выделение в момент перехода idle->animating.

**Решение:** CSS toggle -- добавить `body.selection-blocked` class, управляемый из gesture controller. Gesture controller уже имеет доступ к contents.document через hooks.content.register.

### Pattern 2: Подавление нативного контекстного меню
**Что:** Предотвращение появления нативного меню при long-press на мобильных
**Рекомендация: комбинация CSS и JS**

```typescript
// CSS в useContentHooks.ts (для мобильных):
// -webkit-touch-callout: none -- подавляет callout на iOS
// НО: не применять к body глобально (ломает copy/paste)
// Применять через contextmenu event listener

// JS в useContentHooks.ts:
const handleContextMenu = (e: Event) => {
  // Подавить только на мобильных (touch devices)
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    e.preventDefault();
  }
};
doc.addEventListener('contextmenu', handleContextMenu);
```

Обоснование:
- `-webkit-touch-callout: none` на iOS подавляет popup "Copy/Look Up/Share"
- `contextmenu` event preventDefault на Android подавляет нативное меню
- На десктопе оставляем оба меню (нативное right-click + SelectionMenu)
- Нативные drag handles сохраняются -- они управляются через Selection API, не через contextmenu

### Pattern 3: HighlightTooltip компонент
**Что:** Компактный popup при тапе по существующему highlight
**Архитектура:**

```typescript
// HighlightTooltip.tsx -- новый компонент
// Данные: highlightPopup из useAnnotationRendering (уже содержит position, note, color, bookmarkId)
// UI: компактная карточка с текстом заметки, кнопками Edit/Delete
// Позиционирование: аналогично SelectionMenu (fixed, сверху/снизу точки тапа)
// Закрытие: тап вне tooltip

interface HighlightTooltipProps {
  popup: HighlightPopup | null;
  onEdit: (bookmarkId: string) => void;
  onDelete: (bookmarkId: string) => void;
  onClose: () => void;
}
```

### Anti-Patterns
- **Не кастомизировать drag handles:** Нативные drag handles iOS/Android работают надёжно. Попытка создать custom drag handles приведёт к несовместимости между устройствами.
- **Не использовать rendition.annotations.highlight():** Уже задокументировано в MEMORY.md -- SVG overlay, не поддерживает bg-color. DOM span wrapping (useAnnotationRendering) -- правильный подход.
- **Не блокировать выделение через JS в touchstart:** user-select CSS надёжнее, JS может не успеть отработать.

## Don't Hand-Roll

| Problem | Не делать | Использовать | Почему |
|---------|-----------|--------------|--------|
| Drag handles | Кастомные touch drag handles | Нативные браузерные drag handles | iOS/Android handle selection расширение, кросс-браузерная совместимость |
| Контекстное меню | Сложная система подавления | `contextmenu` event + `-webkit-touch-callout` | Стандартный web-подход, работает на всех мобильных |
| Highlight рендеринг | epub.js annotations API | useAnnotationRendering (DOM span wrapping) | Уже реализовано, SVG overlay не подходит |
| Selection detection | Custom selection tracking | epub.js `rendition.on('selected')` | Уже реализовано в useTextSelection |

## Common Pitfalls

### Pitfall 1: Конфликт touchmove между selection drag и swipe
**Что происходит:** При расширении выделения (drag handle) gesture controller может перехватить touchmove и начать свайп-навигацию.
**Почему:** Текущий gesture controller проверяет selection только в touchstart (строка 335-336), но НЕ проверяет в touchmove.
**Как избежать:** Добавить дополнительную проверку selection state в handleTouchMove. Если `doc.defaultView?.getSelection?.()?.toString().length > 0`, немедленно перейти в state 'cancelled'.
**Warning signs:** Свайп начинается при попытке расширить выделение drag handles.

### Pitfall 2: -webkit-touch-callout конфликт с выделением
**Что происходит:** `-webkit-touch-callout: none` на iOS может помешать работе nативного выделения.
**Почему:** Текущий useContentHooks.ts уже имеет `-webkit-touch-callout: none` на `.description-highlight` (строка 175). Если применить глобально, сломается long-press selection.
**Как избежать:** НЕ применять `-webkit-touch-callout: none` глобально к body. Только через `contextmenu` event listener. Для iOS -- добавить `-webkit-touch-callout: none` только к уже выделенному тексту (через `::selection` pseudoelement не работает, поэтому только через event).
**Warning signs:** Long-press не начинает выделение на iOS.

### Pitfall 3: Selection сбрасывается при touchstart gesture controller
**Что происходит:** Gesture controller записывает touchstart в handleTouchStart, что может сбросить selection.
**Почему:** Текущий код проверяет `sel.toString().length > 0` в touchstart и делает early return. Но если тач произошёл ВНЕ выделенного текста, selection уже сброшено браузером до touchstart.
**Как избежать:** Текущая реализация уже корректна -- браузер сбрасывает selection при тапе вне, и gesture controller начинает нормально. Проблема может возникнуть только если пользователь тапает ВНУТРИ выделения (drag handle) -- в этом случае selection ещё жив, и early return корректен.
**Warning signs:** Выделение пропадает при попытке передвинуть drag handle.

### Pitfall 4: Highlight tap конфликтует с text selection
**Что происходит:** Тап на `.user-annotation` сейчас обрабатывается через click event в useAnnotationRendering (строка 330). Long-press на highlight должен начинать новое выделение, а short tap -- показывать tooltip.
**Почему:** getInteractiveType в gesture controller возвращает 'annotation' для `.user-annotation`, что предотвращает навигацию. Но useAnnotationRendering click handler не различает short tap и long-press.
**Как избежать:** useAnnotationRendering click handler уже срабатывает только на click (не на long-press). Long-press на highlight запускает нативное выделение, которое перехватывается epub.js 'selected' event. Highlight tooltip показывается по click, новое выделение -- по long-press. Разделение уже работает через timing.
**Warning signs:** Tooltip появляется при попытке выделить текст поверх highlight.

### Pitfall 5: Spring анимация и выделение -- race condition
**Что происходит:** Пользователь начинает long-press в момент, когда spring-анимация ещё не завершилась (phase === 'animating').
**Почему:** DOM движется во время анимации, координаты selection будут неверными.
**Как избежать:** Блокировать user-select через CSS class `selection-blocked` на body, когда `phase !== 'idle'`. Снимать class в resetState gesture controller.
**Warning signs:** Глитчи выделения при быстром тапе-и-зажатии.

## Code Examples

### Изменение 1: Снятие user-select: none в useContentHooks.ts
```typescript
// БЫЛО (строки 154-163):
/* Disable text selection on touch devices (mobile) */
@media (pointer: coarse), (hover: none) {
  body, p, span, div, h1, h2, h3, h4, h5, h6, li, td, th, blockquote {
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }
}

// СТАНЕТ:
/* Selection blocked during animation (toggled via JS) */
body.selection-blocked * {
  -webkit-user-select: none !important;
  user-select: none !important;
}
```

### Изменение 2: Подавление contextmenu в useContentHooks.ts
```typescript
// Добавить в contentHook после создания style element:
const handleContextMenu = (e: Event) => {
  // Подавить на мобильных, чтобы показывать только SelectionMenu
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    e.preventDefault();
  }
};
doc.addEventListener('contextmenu', handleContextMenu);
```

### Изменение 3: Selection passthrough в useGestureController.ts touchmove
```typescript
// В handleTouchMove, перед обработкой свайпа:
const handleTouchMove = (e: TouchEvent) => {
  if (!enabledRef.current) return;

  const t = touchRef.current;
  if (t.state !== 'pending' && t.state !== 'swiping') return;

  // Проверить активное выделение -- отменить жест если пользователь drag-ит selection
  const sel = doc.defaultView?.getSelection?.();
  if (sel && sel.toString().length > 0) {
    touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;
  }
  // ... rest of handleTouchMove
};
```

### Изменение 4: Toggle selection-blocked class
```typescript
// В gesture controller contentHook, управление CSS class:
// При phase !== 'idle': body.classList.add('selection-blocked')
// При phase === 'idle': body.classList.remove('selection-blocked')

// Реализация через ref на document + useEffect:
useEffect(() => {
  if (!rendition) return;
  const contents = rendition.getContents();
  contents.forEach((c: unknown) => {
    const doc = (c as { document: Document }).document;
    if (!doc?.body) return;
    if (phase !== 'idle') {
      doc.body.classList.add('selection-blocked');
    } else {
      doc.body.classList.remove('selection-blocked');
    }
  });
}, [rendition, phase]);
```

### Изменение 5: HighlightTooltip компонент (новый файл)
```typescript
// frontend/src/components/Reader/HighlightTooltip.tsx
// Компактный popup: текст заметки + кнопки Edit / Delete
// Стилистика: аналогична SelectionMenu (bg-popover, rounded-lg, shadow-lg)
// Позиционирование: fixed, аналогично SelectionMenu.getMenuStyle()
// Закрытие: click outside, Escape key
// Props: popup (HighlightPopup | null), onEdit, onDelete, onClose
```

### Изменение 6: Wiring в EpubReader.tsx
```typescript
// Добавить destructuring highlightPopup, closePopup из useAnnotationRendering
const { highlightPopup, closePopup, flashAnnotation } = useAnnotationRendering({...});

// Передать в ReaderModals или рендерить HighlightTooltip напрямую
<HighlightTooltip
  popup={highlightPopup}
  onEdit={(id) => { /* открыть редактирование */ }}
  onDelete={(id) => { deleteBookmark(id); closePopup(); }}
  onClose={closePopup}
/>
```

## State of the Art

| Старый подход | Текущий подход | Когда изменено | Влияние |
|---------------|----------------|----------------|---------|
| user-select: none на мобильных | user-select разрешён, блокировка только при анимации | Phase 18 | Разблокирует text selection на мобильных |
| Нет tooltip для highlights | HighlightTooltip компонент | Phase 18 | Позволяет редактировать/удалять заметки |
| highlightPopup не подключён к UI | highlightPopup -> HighlightTooltip | Phase 18 | Замыкает цикл highlight -> tooltip -> edit |

## Open Questions

1. **iOS drag handles поведение**
   - Что знаем: iOS Safari имеет свои drag handles для text selection, которые могут конфликтовать с gesture controller
   - Что неясно: STATE.md упоминает "iOS drag handles при text selection плохо документированы (epub.js issue #904)"
   - Рекомендация: Тестирование на реальном iOS устройстве после реализации. Текущая проверка selection в touchstart/touchmove должна быть достаточной.
   - Confidence: MEDIUM

2. **iOS overlay и text selection**
   - Что знаем: iOS center-tap overlay (строки 866-962 useGestureController.ts) покрывает центр экрана с z-index 5. Он имеет `user-select: none`.
   - Что неясно: Не помешает ли overlay выделению текста в центральной зоне на iOS?
   - Рекомендация: iOS overlay занимает только 70% ширины (left:15%, right:15%). Выделение начинается в iframe (z ниже), а drag handles нативные и могут проходить поверх overlay. Если будут проблемы -- добавить `pointer-events: none` на overlay при активном выделении.
   - Confidence: MEDIUM

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npx vitest run --reporter=verbose` |
| Full suite command | `cd frontend && npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEL-01 | user-select CSS не содержит none для мобильных | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useContentHooks.test.ts -x` | Wave 0 |
| SEL-01 | gesture controller отменяет свайп при активном selection | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts -x` | Wave 0 |
| SEL-01 | selection заблокировано во время анимации (selection-blocked class) | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useContentHooks.test.ts -x` | Wave 0 |
| SEL-02 | HighlightTooltip рендерится при наличии popup | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/HighlightTooltip.test.tsx -x` | Wave 0 |
| SEL-02 | HighlightTooltip вызывает onEdit/onDelete | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/HighlightTooltip.test.tsx -x` | Wave 0 |
| SEL-01+SEL-02 | Мобильное выделение работает end-to-end | manual-only | Ручное тестирование на Pixel 9 / iOS Safari | N/A |

### Sampling Rate
- **Per task commit:** `cd frontend && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd frontend && npx vitest run --reporter=verbose && cd frontend && npm run build`
- **Phase gate:** Full suite green + build success before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` -- покрывает SEL-01 (user-select, contextmenu)
- [ ] `frontend/src/hooks/epub/__tests__/useGestureController.test.ts` -- покрывает SEL-01 (selection passthrough)
- [ ] `frontend/src/components/Reader/__tests__/HighlightTooltip.test.tsx` -- покрывает SEL-02 (tooltip render, actions)

## Sources

### Primary (HIGH confidence)
- Исходный код проекта: useContentHooks.ts, useGestureController.ts, useAnnotationRendering.ts, useTextSelection.ts, SelectionMenu.tsx, EpubReader.tsx, useBookmarks.ts
- Исходный код тестов: EpubReader.test.tsx, useAnnotationRendering.test.ts
- CONTEXT.md Phase 18 -- решения пользователя

### Secondary (MEDIUM confidence)
- [MDN: -webkit-touch-callout](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout) -- iOS-only CSS property
- [MDN: user-select](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/user-select) -- стандартная CSS property
- [Preventing context menu on mobile](https://additionalknowledge.com/2024/08/02/how-to-prevent-the-default-context-menu-live-preview-on-long-press-in-mobile-safari-chrome/) -- contextmenu event + CSS подход

### Tertiary (LOW confidence)
- STATE.md упоминает "iOS drag handles при text selection плохо документированы (epub.js issue #904)" -- требует тестирования на реальном устройстве

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- весь код уже в проекте, изменения минимальны
- Architecture: HIGH -- паттерны устоявшиеся (hooks, CSS injection, gesture FSM)
- Pitfalls: MEDIUM -- iOS-специфичные проблемы требуют ручного тестирования

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (стабильный стек, epub.js 0.3.93 не обновляется)