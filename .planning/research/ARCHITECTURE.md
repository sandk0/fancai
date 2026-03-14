# Архитектура: iOS Touch Events в epub.js Reader

**Домен:** Навигация и жесты iOS в epub.js iframe-ридере
**Исследовано:** 2026-03-14
**Достоверность:** HIGH (анализ исходного кода epub.js + документация WebKit + аудит кодовой базы)

## Рекомендуемая архитектура

### Принцип: Единый конвейер событий без capture-phase блокировки

Текущая архитектура имеет **критический баг**: `useEpubIOSFixes.ts` добавляет capture-phase `stopPropagation()` на ВСЕ touch-события в iframe на iOS (строки 133-148). Это полностью убивает touch-события для `useGestureController`, который слушает те же события на фазе bubbling.

**Правильная архитектура:** Отключить epub.js Snap manager через его собственный API (`manager.gestures.destroy()`), НЕ блокируя propagation всех touch-событий в iframe.

### Текущий поток событий (СЛОМАН на iOS)

```
Палец касается iframe
    |
    v
[capture phase] useEpubIOSFixes.ts blockEpubJsTouchHandler()
    |-- stopPropagation() <-- БЛОКИРУЕТ ВСЕ НИЖЕСТОЯЩИЕ ОБРАБОТЧИКИ
    |
    X (события НЕ доходят до bubble-phase обработчиков)
    |
    useGestureController.ts touchstart/move/end -- НИКОГДА НЕ ВЫЗЫВАЕТСЯ
    epub.js Contents.triggerEvent -- НИКОГДА НЕ ВЫЗЫВАЕТСЯ
    epub.js Rendition.passEvents -- НИКОГДА НЕ ВЫЗЫВАЕТСЯ
    useContentHooks.ts touchstart/end -- НИКОГДА НЕ ВЫЗЫВАЕТСЯ
```

**Доказательство:** В `useEpubIOSFixes.ts` строки 136-141:
```typescript
const blockEpubJsTouchHandler = (e: TouchEvent) => {
  e.stopPropagation();
};
doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true, passive: true });
```

### Правильный поток событий (ЦЕЛЬ)

```
Палец касается iframe document
    |
    v
[bubble phase, порядок регистрации]
    |
    +-- useContentHooks.ts touchstart (passive:true)
    |     selection-blocked + long-press timer
    |
    +-- useGestureController.ts touchstart (passive:true)
    |     FSM: idle -> pending
    |     записывает startX, startY, boundary
    |
    +-- epub.js Contents.triggerEvent (passive:true)
    |     emit('touchstart') -> Rendition.triggerViewEvent
    |     (Snap уже уничтожен через gestures.destroy())
    |
    v
Палец двигается (touchmove)
    |
    +-- useContentHooks.ts touchmove (passive:true)
    |     cancel long-press timer + scroll lock cleanup
    |
    +-- useGestureController.ts touchmove (passive:false!)
    |     FSM: pending -> swiping (если deltaX > 10px)
    |     preventDefault() для горизонтального свайпа
    |     translateX.set(deltaX) -- follow-finger
    |
    v
Палец отпущен (touchend)
    |
    +-- useGestureController.ts touchend (passive:true)
    |     TAP: если deltaX < 20px и duration < 250ms
    |       -> зона определение (prev/center/next)
    |       -> навигация или toggleUI
    |     SWIPE: если state === 'swiping'
    |       -> shouldNavigate() проверка
    |       -> spring animation + instantNextPage/PrevPage
```

### Ключевой конфликт: epub.js Snap vs useGestureController

epub.js имеет встроенный Snap manager (`epubjs/src/managers/helpers/snap.js`) который:
1. Слушает touch-события на `stage.container` (scroller) напрямую
2. Слушает touch-события через `contents.on('touchstart/move/end')` (проксированные из iframe)
3. На `onTouchMove` двигает `element.scrollLeft` напрямую (строка 199: `this.element.scrollLeft -= screenX - this.endTouchX`)
4. На `onTouchEnd` вызывает `snap()` -- анимирует scrollLeft к ближайшей странице

Наш `useGestureController` делает то же самое, но лучше (spring physics, rubber-band, follow-finger). Поэтому Snap должен быть **полностью уничтожен**, но **без** capture-phase блокировки.

### Рекомендуемый подход отключения Snap (уже частично реализован)

В `useEpubIOSFixes.ts` строки 101-116 уже делают правильную деактивацию:
```typescript
// Уничтожение Snap manager через его API
if (manager.gestures) {
  manager.gestures.destroy(); // вызывает removeListeners() -- убирает ВСЕ обработчики Snap
  manager.gestures = null;
}

// Блокировка snap() на случай программного вызова
if (typeof manager.snap === 'function') {
  manager.snap = () => Promise.resolve();
}
```

Проблема: ПОСЛЕ этого правильного кода добавляется capture-phase блокировка (строки 133-148), которая ПЕРЕБИВАЕТ всё -- включая наши собственные обработчики.

## Границы компонентов

| Компонент | Ответственность | Взаимодействует с |
|-----------|----------------|-------------------|
| `useEpubIOSFixes.ts` | Отключение epub.js Snap, фикс layout/divisor | epub.js manager, rendition |
| `useGestureController.ts` | FSM жестов (свайпы + тапы), iOS overlay для center-tap | iframe document, FollowFingerContainer |
| `useContentHooks.ts` | CSS инъекция, Touch to Search подавление, scroll lock | iframe document, stage.container |
| `useTextSelection.ts` | Обработка `selected` event от epub.js | rendition events (selectionchange) |
| `FollowFingerContainer.tsx` | GPU-ускоренный transform wrapper | motion values от gesture controller |
| `useEpubRendition.ts` | Создание rendition, вызов iOS fixes | epub.js Book, IOSFixes |
| `ReaderPage.tsx` | Body scroll lock, gesture event prevention | document |
| `gestureUtils.ts` | Чистые утилиты: config, spring params, стейдж info | нет зависимостей |
| `iosSupport.ts` | Platform detection (isIOS, isSafari, etc.) | navigator |

### Поток данных

```
ReaderPage.tsx
  |-- useReaderBodyLock: gesturestart/change/end prevention на document
  |
  |-- EpubReader.tsx
        |
        |-- useEpubLoader -> createRendition (useEpubRendition.ts)
        |     |-- applyIOSSpreadFix: layout.divisor=1, spread='none'
        |     |-- on('rendered') -> applyIOSRenderedFixes:
        |           |-- manager.gestures.destroy()     [ПРАВИЛЬНО]
        |           |-- manager.snap = noop             [ПРАВИЛЬНО]
        |           |-- stage.scrollBy = noop           [ПРАВИЛЬНО]
        |           |-- capture-phase stopPropagation   [СЛОМАНО -- УДАЛИТЬ]
        |
        |-- useContentHooks: CSS + Touch to Search fix
        |     |-- hooks.content.register -> iframe doc listeners
        |     |-- touchstart: selection-blocked class
        |     |-- touchmove: cancel long-press timer
        |     |-- touchend: cleanup + deferred unblock
        |     |-- pointerdown/pointerup на parentDoc (scroll lock)
        |
        |-- useGestureController: FSM + touch handling
        |     |-- hooks.content.register -> iframe doc listeners
        |     |     touchstart -> pending
        |     |     touchmove -> swiping (+ translateX.set)
        |     |     touchend -> tap detection / swipe completion
        |     |
        |     |-- iOS overlay для center-tap (если isIOS())
        |     |     div#gesture-controller-ios-overlay
        |     |     z-index:5, left:15%, right:15%
        |     |     Обрабатывает ТОЛЬКО center tap
        |
        |-- useTextSelection: rendition.on('selected')
              |-- epub.js Contents.onSelectionChange -> selectionchange event
              |-- НЕ зависит от touch-событий (отдельный pipeline)
```

## Паттерны для применения

### Паттерн 1: Диагностика через debug logger

**Что:** Расширить существующий logger (`?debug=1`) для iOS-специфичной диагностики touch-событий.
**Когда:** Первым шагом перед любыми фиксами -- нужно видеть что происходит.
**Пример:**

```typescript
// В useGestureController.ts, в начале touchstart handler:
logger.debug('[gesture:ios] touchstart', {
  x: touch.clientX,
  y: touch.clientY,
  target: (e.target as HTMLElement)?.tagName,
  targetClass: (e.target as HTMLElement)?.className?.slice?.(0, 50),
  state: touchRef.current.state,
  touches: e.touches.length,
});
```

**Важно:** Logger уже буферизирует в памяти (`debugBuffer`, `MAX_BUFFER_SIZE=500`). На iOS PWA нет DevTools, поэтому `?debug=1` с overlay -- единственный способ видеть логи. Debug overlay уже существует.

### Паттерн 2: Удаление capture-phase блокировки

**Что:** Убрать `stopPropagation()` из `useEpubIOSFixes.ts`, оставив только `gestures.destroy()` + `snap = noop`.
**Когда:** После добавления debug-логирования и подтверждения baseline-поведения.
**Конкретный diff:**

```diff
// useEpubIOSFixes.ts, функция applyIOSRenderedFixes()

  // ... gestures.destroy() и snap блокировка остаются ...

- let touchCleanup: (() => void) | undefined;
- if (iframe?.contentDocument) {
-   const doc = iframe.contentDocument;
-   const blockEpubJsTouchHandler = (e: TouchEvent) => {
-     e.stopPropagation();
-   };
-   doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true, passive: true });
-   doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true, passive: true });
-   doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true, passive: true });
-   touchCleanup = () => { ... };
- }

  // Final safety net: fix layout after render
  // ... оставить как есть ...

- return touchCleanup;
+ return undefined;
```

### Паттерн 3: iOS overlay ревизия

**Что:** Текущий iOS overlay (строки 921-1020 `useGestureController.ts`) покрывает только center zone (left:15%, right:15%). Свайпы и edge-тапы идут через iframe.

```
Текущая структура:
+--------------------------------------------------+
|              Parent Document                       |
|  +------+----------------------------+------+     |
|  | edge | iOS Center-Tap Overlay     | edge |     |
|  | 15%  | z-index:5                  | 15%  |     |
|  |      | left:15%, right:15%        |      |     |
|  | NO   | Handles: center tap only   | NO   |     |
|  | OVRL |                            | OVRL |     |
|  +------+----------------------------+------+     |
|  +----------------------------------------------+ |
|  |        epub.js iframe (under overlay)         | |
|  |        touch events -> useGestureController   | |
|  |        Handles: swipe, edge tap, center tap   | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

**Проблема на iOS:** Touch-события в iframe блокируются capture-phase handler. Overlay работает для center zone, но edge zones (15% слева/справа) и свайпы в iframe -- мертвы.

**После фикса:** Если iframe touch-события работают на iOS, overlay для center-tap становится избыточным -- `useGestureController` уже обрабатывает center-tap через iframe events (строка 584-589, 549). Overlay можно убрать, упростив архитектуру.

### Паттерн 4: touch-action CSS корректность

**Факт:** `touch-action: pan-x pan-y` поддерживается в iOS Safari 13+ (подтверждено WebKit bug #133112, resolved). Текущий CSS корректен для iOS 18+ (наш таргет).

Текущая конфигурация touch-action по слоям:
- `.reader-scroll-lock` (ReaderPage div): `touch-action: manipulation` -- **корректно**
- `iframe` (globals.css): `touch-action: pan-x pan-y !important` -- **корректно** (iOS 13+)
- iframe `body` (useContentHooks.ts): `touch-action: pan-x pan-y` -- **корректно**
- `@supports (-webkit-touch-callout: none)` (useContentHooks.ts): `touch-action: pan-x pan-y !important` -- **корректно**
- `.description-highlight` (useContentHooks.ts): `touch-action: pan-x pan-y` -- **корректно**
- iOS overlay: `touch-action: pan-x pan-y` -- **корректно**

**Замечание:** `manipulation` = `pan-x pan-y pinch-zoom`. Разница: `pan-x pan-y` без `manipulation` НЕ отключает 300ms click delay на iOS. Но мы используем touch events, не click, для навигации -- поэтому 300ms delay не проблема.

### Паттерн 5: epub.js event pipeline (Contents -> Rendition)

epub.js имеет автоматический event proxy chain:

```
iframe document
  |
  +-- Contents.addEventListeners() [passive:true]
  |     addEventListener(eventName, triggerEvent) для КАЖДОГО DOM_EVENT
  |     DOM_EVENTS = ["keydown","keyup","keypressed","mouseup","mousedown",
  |                   "mousemove","click","touchend","touchstart","touchmove"]
  |
  +-- Contents.triggerEvent(e) -> this.emit(e.type, e)
  |
  +-- Rendition.passEvents(contents) [registered via hooks.content]
  |     contents.on(eventName, (ev) => this.triggerViewEvent(ev, contents))
  |     contents.on('selected', (e) => this.triggerSelectedEvent(e, contents))
  |
  +-- Snap.afterDisplayed(view) [registered via manager ADDED event]
        contents.on('touchstart/move/end', (ev) => this.triggerViewEvent(ev, contents))
```

**Ключевой момент:** `useTextSelection` зависит от `rendition.on('selected')`, который работает через `Contents.onSelectionChange()` -> `selectionchange` event на iframe document. Это **отдельный pipeline** от touch events -- selectionchange НЕ входит в DOM_EVENTS и НЕ проходит через triggerEvent. Поэтому capture-phase блокировка touch-событий не ломает selection detection.

Однако, `rendition.on('click')` используется в EpubReader.tsx (строка 602) для dismiss popup при клике в iframe. Click входит в DOM_EVENTS и проксируется через Contents. На десктопе click работает (отдельно от touch). На мобильных click синтезируется из touch -- если touch blocked, click тоже не сработает.

## Анти-паттерны для избежания

### Анти-паттерн 1: Capture-phase stopPropagation для подавления библиотечных обработчиков

**Что:** `addEventListener('touchstart', handler, { capture: true })` с `stopPropagation()`.
**Почему плохо:** Блокирует ВСЕ bubble-phase обработчики, включая собственные. Невозможно избирательно блокировать один обработчик через capture-phase. Вместо хирургического удаления Snap -- ядерная бомба на все touch events.
**Вместо:** `manager.gestures.destroy()` убирает именно Snap listeners без side effects.

### Анти-паттерн 2: Дублирование touch-handling на overlay + iframe

**Что:** Разделение touch-обработки между iOS overlay (center) и iframe (edge/swipe).
**Почему плохо:** Два параллельных конвейера событий с разной координатной системой. iOS overlay не может обрабатывать свайпы (нет `passive:false` на touchmove, нет tracking state). Overlay видит только тапы в center zone. Любой свайп, начатый над overlay, не обрабатывается gesture controller (iframe не получает touch sequence, overlay не имеет swipe logic).
**Вместо:** Единый конвейер через iframe document. Если iframe touch-события работают на iOS после фикса -- overlay не нужен.

### Анти-паттерн 3: Множественная регистрация через hooks.content.register

**Что:** И `useGestureController`, и `useContentHooks` регистрируют touch-обработчики через `hooks.content.register`. Это валидный паттерн epub.js, но создаёт неявный порядок выполнения.
**Риск:** Порядок вызова hooks зависит от порядка `useEffect` execution. Если useContentHooks добавляет `selection-blocked` класс на touchstart, а useGestureController проверяет selection на touchstart -- race condition возможен.
**Текущий статус:** Работает на практике (useContentHooks проверяет selection только на touchend, не touchstart). Но при рефакторинге важно сохранить этот порядок.

### Анти-паттерн 4: Conditional platform branching в gesture handler

**Что:** `if (isIOS()) { ... } else { ... }` внутри touch handlers.
**Почему плохо:** Увеличивает количество code paths, каждый из которых нужно тестировать отдельно. Touch events на iOS и Android работают одинаково (W3C Touch Events spec), различия только в CSS (`touch-action` поддержка) и browser chrome (300ms delay, gesture events).
**Вместо:** Единый touch handler для всех платформ. Platform-specific код только там, где поведение ДЕЙСТВИТЕЛЬНО отличается (iOS spread fix, cursor:pointer).

## iOS-специфичные особенности Touch Events

### 1. Touch events в iframe -- одно окно за раз

На iOS touch-события dispatched только в "innermost frame". Если палец начинает на iframe -- все touchmove/touchend идут в iframe document, НЕ в parent document. Это значит:
- Parent document listeners **не получают** touch-события от iframe
- `useGestureController` правильно регистрирует обработчики на iframe document (через `hooks.content.register`) -- это корректный подход
- iOS overlay (`gesture-controller-ios-overlay`) находится в parent DOM и получает touch-события которые начинаются **на самом overlay** (поверх iframe, z-index:5)

### 2. Координаты: iframe-local vs screen

Touch events в iframe имеют `clientX/clientY` относительно iframe viewport, НЕ родительского окна. Текущий код корректно обрабатывает это:
- `getIframeOffset()` вычисляет смещение iframe через `frameElement.getBoundingClientRect()`
- `screenX = touch.clientX + iframeOffset` для zone detection (строка 569)
- `elementFromPoint(touch.clientX, touch.clientY)` использует iframe-local координаты (корректно)
- iOS overlay конвертирует координаты: `viewportX = touch.clientX - iframeRect.left` (строка 995-996)

### 3. 300ms delay и double-tap zoom

- `touch-action: manipulation` убирает 300ms delay и double-tap zoom (работает на iOS)
- `touch-action: pan-x pan-y` НЕ убирает 300ms delay (только manipulation делает это)
- Мы не используем `click` для навигации в iframe -- только touch events, поэтому 300ms delay не влияет на user experience
- Desktop click handler (строки 769-847) имеет 500ms dedup (`Date.now() - lastTouchTimeRef.value < 500`)

### 4. Selection и touch interaction на iOS

iOS Safari text selection через long-press:
1. `touchstart` -- наш обработчик получает
2. ~500ms задержка (iOS selection threshold)
3. Браузер показывает selection handles
4. `selectionchange` events на iframe document (epub.js слушает через `Contents.onSelectionChange`)
5. Пользователь двигает handles -- это НЕ touchmove (gesture selection, отдельный от touch pipeline)
6. `touchend` может НЕ fire (selection gesture отменяет touch sequence)

Текущий код в `useContentHooks.ts` правильно обрабатывает это:
- `selection-blocked` класс на touchstart предотвращает Touch to Search
- Через 200ms (`LONG_PRESS_THRESHOLD`) класс убирается, разрешая selection
- Scroll lock включается только если `pointerDown === true`
- pointerDown отслеживается через **parent document** `pointerdown/pointerup` (строки 209-221)

**Потенциальная проблема на iOS:** `pointerDown` tracking через `parentDoc` (`doc.defaultView?.parent?.document`). На iOS pointer events в parent document могут не коррелировать с touch events в iframe (разные frame boundaries). Нужно проверить при тестировании.

### 5. gesturestart/change/end prevention

`ReaderPage.tsx` (`useReaderBodyLock`) блокирует Safari-specific gesture events на document level:
```typescript
document.addEventListener('gesturestart', preventGesture, { passive: false });
document.addEventListener('gesturechange', preventGesture, { passive: false });
document.addEventListener('gestureend', preventGesture, { passive: false });
```
Это Safari-only события для pinch-zoom gesture (не W3C стандарт). Блокировка корректна и не мешает touch events.

## Точки интеграции для iOS фиксов

### Что нужно МОДИФИЦИРОВАТЬ (существующие файлы)

| Файл | Изменение | Сложность | Причина |
|------|-----------|-----------|---------|
| `useEpubIOSFixes.ts` | Удалить capture-phase touch blockers (строки 133-148) | Low | Root cause: разблокирует touch-события |
| `useGestureController.ts` | Добавить debug-логирование на все touch events | Low | Необходимо для iOS диагностики без DevTools |
| `useGestureController.ts` | Ревизия iOS overlay -- проверить нужен ли после фикса | Med | Деоптимизация если overlay избыточен |
| `useContentHooks.ts` | Проверить pointerDown tracking на iOS | Low | parentDoc pointer events могут не работать cross-frame |
| `logger.ts` (опционально) | Touch event counter/summary в debug buffer | Low | Предотвращает flood при 60fps touchmove logging |

### Что НЕ нужно создавать (новые файлы)

Архитектурно новых компонентов не требуется. Проблема в одном конкретном месте (`useEpubIOSFixes.ts` capture-phase blockers). После удаления блокировки существующий pipeline должен заработать, потому что:
- `useGestureController` уже обрабатывает touch events из iframe document
- `useContentHooks` уже настраивает CSS для iOS
- `gestureUtils` не зависит от платформы
- iOS overlay может быть убран (не добавлен)

### Порядок сборки (build order) для iOS фиксов

```
Фаза 1: Диагностика
  [1.1] Debug logging в useGestureController touchstart/move/end
  [1.2] Debug logging в useEpubIOSFixes (что именно блокируется)
  [1.3] Тест на iOS: подтвердить что touch events НЕ приходят в gesture controller

Фаза 2: Корневой фикс
  [2.1] Удаление capture-phase blockers из useEpubIOSFixes.ts
  [2.2] Тест на iOS: подтвердить что touch events ПРИХОДЯТ в gesture controller
  [2.3] Тест на Android/desktop: убедиться что ничего не сломалось

Фаза 3: Навигация
  [3.1] Тест тапов на iOS (edge zones: prev/next, center: toggleUI)
  [3.2] Тест свайпов на iOS (follow-finger, spring animation)
  [3.3] Тест interactive elements (description highlights, entity mentions, links)

Фаза 4: Selection
  [4.1] Тест text selection на iOS (long-press, handles, selectionchange)
  [4.2] Проверить pointerDown tracking (scroll lock via parentDoc)
  [4.3] Тест HighlightTooltip и SelectionMenu на iOS

Фаза 5: Cleanup
  [5.1] Ревизия iOS overlay -- убрать если не нужен
  [5.2] Убрать cursor:pointer если не нужен на iOS 18+
  [5.3] Edge cases: rubber-band, chapter transition, concurrent touches
```

### Зависимости между фиксами

```
[1. Debug logging] -- нет зависимостей, ПЕРВЫЙ шаг
    |
    v
[2. Удаление capture-phase blockers] -- зависит от (1) для baseline
    |
    v
[3. Тестирование тапов/свайпов] -- зависит от (2)
    |
    +---> [4a. iOS overlay ревизия] -- зависит от (3)
    |       если тапы работают через iframe -- overlay избыточен
    |
    +---> [4b. Selection фикс] -- зависит от (3)
    |       проверить selectionchange + pointerDown cross-frame
    |
    v
[5. Edge cases и polishing] -- зависит от (3), (4a), (4b)
```

### Критическая заметка: Android regression testing

После ЛЮБОГО изменения в `useEpubIOSFixes.ts` необходимо проверять Android. Функция `applyIOSRenderedFixes` вызывается ТОЛЬКО когда `isIOS() === true`, поэтому Android не затронут напрямую. Но:
- `useGestureController` -- общий для всех платформ
- `useContentHooks` -- общий для всех платформ
- Любые изменения в этих файлах влияют на Android тоже

## Источники

**HIGH confidence (исходный код):**
- `frontend/src/hooks/epub/useEpubIOSFixes.ts` -- capture-phase stopPropagation (root cause)
- `frontend/src/hooks/epub/useGestureController.ts` -- FSM gesture handler, iOS overlay
- `frontend/src/hooks/epub/useContentHooks.ts` -- CSS injection, Touch to Search fix, scroll lock
- `frontend/src/hooks/epub/useTextSelection.ts` -- selection handling via rendition events
- `frontend/src/hooks/epub/useEpubRendition.ts` -- rendition creation, iOS fixes invocation
- `frontend/src/hooks/epub/gestureUtils.ts` -- config, spring params, stage info
- `frontend/src/pages/ReaderPage.tsx` -- body scroll lock, gesture event prevention
- `frontend/src/components/Reader/FollowFingerContainer.tsx` -- GPU-accelerated transform
- `frontend/src/utils/iosSupport.ts` -- platform detection
- `frontend/node_modules/epubjs/src/managers/helpers/snap.js` -- epub.js Snap manager
- `frontend/node_modules/epubjs/src/contents.js` -- Contents.addEventListeners, DOM_EVENTS proxy
- `frontend/node_modules/epubjs/src/rendition.js` -- Rendition.passEvents, triggerViewEvent
- `frontend/node_modules/epubjs/src/utils/constants.js` -- DOM_EVENTS list

**HIGH confidence (документация):**
- [WebKit Bug #133112: touch-action CSS property support](https://bugs.webkit.org/show_bug.cgi?id=133112) -- pan-x/pan-y supported iOS 13+
- [Can I Use: CSS touch-action](https://caniuse.com/css-touch-action) -- iOS Safari 13+ full support

**MEDIUM confidence (внешние источники):**
- [WebKit Bug #128924: Shifted document touch handling in iframes](https://bugs.webkit.org/show_bug.cgi?id=128924) -- iframe touch coordinate offset issue (fixed)
- [Steven Waller: Prevent iFrames from eating touch events](https://stevenwaller.io/articles/prevent-iframes-from-eating-touch-events-in-ios/) -- iOS iframe touch propagation
- [Apple: Handling Events in Safari](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) -- iOS touch event model
- [epub.js Issue #905: preventDefault on rendition touch events](https://github.com/futurepress/epub.js/issues/905) -- epub.js touch handling discussion
- [epub.js Tips and Tricks v0.3](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)) -- official epub.js patterns

**LOW confidence (исторический контекст):**
- [WebKit Bug #33894: Touch Events are not sent to iframes](https://bugs.webkit.org/show_bug.cgi?id=33894) -- old bug, context only
