# S05 Research: UAT Bug Analysis

## Контекст
T01+T02 выполнены, unit-тесты проходят, но UAT на устройстве показал что 3 бага не решены. Проблема в том, что фиксы были applied на уровне wrapper div, а баги проявляются на уровне epub.js iframe.

## Архитектура touch events в ридере

```
Пользовательский тап
  → epub.js iframe (contentDocument)
    → event bubbles up / postMessage
      → wrapper div (gesture controller)
        → handleTouchEnd / handleClick
          → проверка зоны (edge/center)
          → dispatch навигации или callback
```

## BUG-1: Text selection on tap

### Что известно
- epub.js рендерит контент в iframe
- `useContentHooks.ts` инжектирует CSS в iframe через `rendition.hooks.content`
- Удалён inline `userSelect='text'` из useEpubRendition.ts (был на wrapper)
- CSS `touch-action: pan-x pan-y` инжектируется в iframe — контролирует pan/zoom но НЕ user-select

### Гипотезы (по вероятности)
1. **[ВЫСОКАЯ] CSS в iframe не блокирует selection:** useContentHooks инжектирует `touch-action` но НЕ инжектирует `user-select: none`. Контент в iframe по умолчанию selectable.
2. **[СРЕДНЯЯ] WebKit специфика:** iOS Safari может игнорировать `user-select: none` на text nodes внутри iframe при определённых условиях.
3. **[НИЗКАЯ] epub.js override:** epub.js может устанавливать свои стили после hook injection.

### Что проверить
- `useContentHooks.ts` — какие CSS правила инжектируются в iframe
- `useGestureController.ts` — есть ли FSM состояние для selection
- Проверить `user-select` в computed styles iframe body через browser tools

## BUG-2: Stale annotation rendering

### Что известно
- bookmarksRef.current используется в debounced applyAnnotations
- 50ms debounce для bookmark changes (optimistic update)
- Annotation rendering использует Range API для wrapping текста в <span>

### Гипотезы (по вероятности)
1. **[ВЫСОКАЯ] DOM mutation invalidates ranges:** После wrapping bookmark A в span, текстовые узлы Split-ятся. Когда приходит bookmark B, CFI → Range resolution может fail потому что DOM tree изменился после A wrapping. applyAnnotations вызывается целиком (все bookmarks), но DOM state уже содержит spans от предыдущего вызова.
2. **[СРЕДНЯЯ] Double-apply без cleanup:** applyAnnotations может не очищать предыдущие span wraps перед повторным применением. Если есть removeAnnotations + applyAnnotations cycle, timing может быть проблемой.
3. **[СРЕДНЯЯ] epub.js relocated event:** После DOM modification (span wrapping), epub.js может fire relocated/rendered event, который триггерит re-render и сбрасывает DOM. Это создаёт race: bookmark B → applyAnnotations → wraps → epub.js relocated → DOM reset → visual loss.

### Что проверить
- `useAnnotationRendering.ts` — flow: clearAnnotations → applyAnnotations. Есть ли clear перед apply?
- Как epub.js реагирует на DOM modification через injected spans
- Порядок events: bookmark mutation → debounce → apply → relocated?

## BUG-3: Edge tap entity/description

### Что известно
- Gesture controller в `handleTouchEnd` проверяет координаты для edge zone detection
- Edge zone = 15% viewport от каждого края
- elementFromPoint добавлен, но вызывается на wrapper document, не на iframe contentDocument
- Entity/description elements живут ВНУТРИ iframe

### Гипотезы (по вероятности)
1. **[ВЫСОКАЯ] Priority inversion:** Gesture controller проверяет edge zone ПЕРЕД проверкой target элемента. Логика: `if (isEdgeZone(x)) → navigate`. Должно быть: `if (isInteractiveElement(target)) → handle; else if (isEdgeZone(x)) → navigate`
2. **[ВЫСОКАЯ] Cross-iframe elementFromPoint:** `document.elementFromPoint(x, y)` на уровне основного документа возвращает iframe element, НЕ элементы внутри iframe. Нужно `iframeContentDocument.elementFromPoint(localX, localY)`
3. **[СРЕДНЯЯ] Event target уже правильный:** Touch event из iframe может содержать правильный target (entity/description span). Проблема в том, что gesture controller игнорирует target и смотрит только на координаты.

### Рекомендуемый подход
Инвертировать приоритет: сначала проверить event.target (или iframe elementFromPoint) на entity/description class, потом зону. Это самый быстрый fix и самый надёжный.

## Рекомендуемый порядок исправления

1. **BUG-3 первым** — вероятно самый простой fix (priority inversion в gesture controller). Одно условие.
2. **BUG-1 вторым** — инжектировать `user-select: none` в iframe CSS, включать через class toggle при long-press
3. **BUG-2 последним** — самый сложный, требует понимания DOM mutation + epub.js lifecycle
