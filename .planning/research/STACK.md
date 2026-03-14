# Технологический стек: iOS Touch Event Fixes

**Проект:** fancai v1.3 — iOS Reader Navigation Fixes
**Исследовано:** 2026-03-14
**Общая уверенность:** HIGH (основано на официальной документации Apple, caniuse, epub.js source code, реальном коде проекта)

## Контекст текущей реализации

Жестовый пайплайн работает на Android/desktop, но полностью сломан на iOS (Safari, Chrome, PWA). Текущая архитектура содержит 4 слоя touch event обработки, конфликтующих на iOS:

| Слой | Файл | Где слушает | passive | Что делает |
|------|------|-------------|---------|------------|
| epub.js Contents | `contents.js:895` | iframe doc | `true` | Пробрасывает touch events через EventEmitter (`_triggerEvent`) |
| epub.js Snap | `snap.js:112-122` | stage container + content EventEmitter | `true` | Своя навигация свайпами + snap-анимация scrollLeft |
| useGestureController | `useGestureController.ts:856-859` | iframe doc | touchstart: `true`, touchmove: `false` | FSM (idle/pending/swiping) + follow-finger |
| useEpubIOSFixes | `useEpubIOSFixes.ts:139-141` | iframe doc (capture phase) | `true` | `stopPropagation()` блокирует epub.js touch обработку |

## Корневая проблема

`useEpubIOSFixes.ts` добавляет capture-phase touch listeners с `stopPropagation()` (строки 136-141). На iOS Safari это блокирует ВСЕ обработчики на iframe document, включая собственные bubble-phase listeners из `useGestureController`. На Android timing event dispatch отличается, и bubble-phase handlers успевают сработать.

Дополнительно: epub.js Snap class (через `afterDisplayed`, строка 151-156 snap.js) подписывается на content view touch events и вызывает собственный `scrollLeft` manipulation (строка 199: `this.element.scrollLeft -= screenX - this.endTouchX`), что конфликтует с follow-finger CSS transform из useGestureController.

---

## Рекомендуемый стек (изменения для iOS фиксов)

### Новых зависимостей НЕ требуется

Все проблемы решаются правильным использованием существующих Web APIs. Ноль новых npm-пакетов (Eruda опционально для dev).

### Ключевые технологии для фикса

| Технология | Версия | Назначение | Почему |
|------------|--------|------------|--------|
| Pointer Events API | W3C Level 2 | Основной gesture detection в useGestureController | Unified API для touch/mouse/pen. iOS 13+ полная поддержка. Pointer events приходят ДО touch events на iOS — более надёжная доставка |
| `touch-action` CSS | Spec Level 1 | Декларативный контроль браузерных жестов | iOS Safari 13+ поддерживает ВСЕ значения (включая `pan-x`, `pan-y`, `none`). Текущее использование корректно |
| Safari Web Inspector | Built-in | Remote debugging | USB-подключение iPhone к Mac. Единственный способ дебажить iframe содержимое на реальном устройстве |
| DebugPanel (свой) | `/?debug=1` | iOS-специфичное touch event логирование | Уже есть, нужно расширить трассировкой touch/pointer events и FSM state transitions |

### Опционально: Eruda для PWA standalone

| Технология | Версия | Назначение | Когда нужна |
|------------|--------|------------|-------------|
| Eruda | 3.4.x | In-app DevTools console | Только если нужно дебажить standalone PWA (Web Inspector НЕ работает в standalone mode) |

```bash
# Опционально, только dev
cd frontend && npm install -D eruda
```

---

## iOS Safari touch-action: актуальная поддержка

**Устаревшая информация (часто встречается в Интернете):** "iOS Safari поддерживает только `auto` и `manipulation`."

**Реальность (caniuse.com, проверено 2026-03-14):**

| Значение | iOS 9.3-12.x | iOS 13+ (текущие) |
|----------|-------------|-------------------|
| `auto` | Да | Да |
| `manipulation` | Да | Да |
| `none` | Нет | **Да** |
| `pan-x` | Нет | **Да** |
| `pan-y` | Нет | **Да** |
| `pan-x pan-y` | Нет | **Да** |
| `pinch-zoom` | Нет | **Да** |

**Уверенность:** HIGH — проверено через caniuse.com/mdn-css_properties_touch-action_none и caniuse.com/mdn-css_properties_touch-action_pan-y.

**Вывод:** Текущий CSS `touch-action: pan-x pan-y` в проекте корректен. Проблема НЕ в CSS, а в JS event handling (capture-phase stopPropagation).

---

## Модель touch событий iOS Safari: отличия от Android

### 1. Порядок dispatch событий

```
iOS Safari (touch на экран):
  pointerover > pointerenter > pointerdown > touchstart >
  [pointermove > touchmove]* > pointerup > touchend >
  mouseover > mousemove > mousedown > mouseup > click

Android Chrome (touch на экран):
  pointerdown > touchstart > [pointermove > touchmove]* >
  pointerup > touchend > mousemove > mousedown > mouseup > click
```

**Ключевое отличие:** iOS отправляет pointer events ПЕРЕД touch events. Это означает, что pointerdown уже доступен к моменту touchstart — можно перейти на Pointer Events для gesture detection.

### 2. Click event delegation

**iOS Safari quirk:** Click events НЕ bubbling на non-clickable элементах (div, span, p). Обходное решение — `cursor: pointer` на body.

**Текущее состояние проекта:** Уже применено в `useContentHooks.ts:132` (`cursor: pointer`) и `useGestureController.ts:329` (`body.style.cursor = 'pointer'`). Не является проблемой.

### 3. 300ms tap delay

С `touch-action: manipulation` или viewport `width=device-width` задержка убирается. Проект использует оба. **Не является проблемой.**

### 4. Content change прерывает event sequence

**iOS-only:** Если DOM изменяется во время `mousemove`, остальные emulated mouse events (mousedown, mouseup, click) НЕ отправляются. Это НЕ касается touch/pointer events.

### 5. Iframe touchend ненадёжен

**Из проектного опыта (feedback_selection_scroll_lock.md):** Iframe получает `touchstart`, но НЕ всегда получает `touchend`/`touchmove` надёжно. Pointer events через parent document (`parentDoc.addEventListener('pointerdown'/'pointerup')`) надёжнее.

### 6. stopPropagation в capture phase

**iOS-специфичная проблема:** `stopPropagation()` в capture phase (useEpubIOSFixes.ts:139) блокирует ВСЕ последующие обработчики на том же элементе, включая собственные bubble-phase listeners из useGestureController.

### 7. Pointer events pointerType

iOS Safari 13.1+ поддерживает pointer events, но с особенностью: `pointerenter` иногда приходит с `pointerType: "mouse"` вместо `"touch"` (WebKit Bug #214609). Не критично для gesture detection, но стоит учитывать при логировании.

### 8. iOS 13.1 touchstart/touchend skip

При быстром двойном тапе одним пальцем iOS 13.1+ может пропустить touchstart/touchend для второго тапа. Pointer events этим не затронуты.

---

## CSS свойства, критичные для iOS

| Свойство | Значение | Где применять | Эффект на iOS Safari |
|----------|----------|---------------|---------------------|
| `touch-action: pan-x pan-y` | iframe body, epub-viewer | Разрешает JS-контролируемый скролл (epub.js stage.scrollLeft), запрещает pinch-zoom и double-tap-zoom |
| `touch-action: manipulation` | reader-scroll-lock, кнопки, interactive elements | Убирает 300ms tap delay. Разрешает pan + pinch-zoom |
| `touch-action: none` | Свайп-зона когда state === 'swiping' | Полный JS контроль, блокирует все нативные жесты. Использовать ТОЛЬКО временно через JS |
| `-webkit-touch-callout: none` | description-highlight, entity-mention | Отключает iOS информационный пузырь при длинном нажатии |
| `-webkit-tap-highlight-color: transparent` | Все тапабельные элементы | Убирает серый полупрозрачный overlay при тапе |
| `overscroll-behavior: none` | reader-scroll-lock, body.reader-active | Отключает rubber-band bounce effect iOS Safari |
| `cursor: pointer` | iframe body | **ОБЯЗАТЕЛЬНО:** без этого click events не делегируются на iOS |
| `user-select: none` (через класс) | iframe body (временно, 200ms) | Блокировка Chrome Touch to Search + iOS native selection при коротких тапах |
| `-webkit-overflow-scrolling: touch` | epub.js stage container | Momentum scrolling для CSS column pagination. Уже применяется epub.js Snap class (строка 55) |

**Текущее состояние CSS в проекте:** Все критичные свойства уже применены в `useContentHooks.ts` и `globals.css`. CSS не является причиной проблемы.

---

## Стратегия фикса (архитектурная)

### Вариант A (рекомендуемый): Убрать capture-phase blockers + усилить отключение epub.js gesture system

1. **Убрать capture-phase `stopPropagation` из useEpubIOSFixes.ts** (строки 136-148) — это корневая причина. Epub.js snap и gestures уже отключаются через `manager.gestures.destroy()` и заглушку `manager.snap()`.

2. **Дополнительно убрать epub.js DOM_EVENTS listeners** для touch events:
   ```typescript
   // В useEpubIOSFixes.ts, после получения contents:
   const doc = contents.document;
   // Удалить epub.js touch event forwarding
   ['touchstart', 'touchmove', 'touchend'].forEach(eventName => {
     doc.removeEventListener(eventName, contents._triggerEvent, { passive: true });
   });
   ```

3. **Сохранить текущие touch events** в useGestureController как есть (touchstart/touchmove/touchend на iframe doc).

**Плюсы:** Минимальные изменения, низкий риск регрессии на Android/desktop.
**Минусы:** Touch events на iOS iframe всё ещё менее надёжны, чем pointer events.

### Вариант B (альтернативный): Перейти на Pointer Events в useGestureController

1. Заменить `touchstart`/`touchmove`/`touchend` на `pointerdown`/`pointermove`/`pointerup` в useGestureController.

2. Использовать `setPointerCapture()` для гарантированной доставки pointermove/pointerup после pointerdown:
   ```typescript
   const handlePointerDown = (e: PointerEvent) => {
     if (e.pointerType === 'mouse' && e.button !== 0) return; // только LMB
     (e.target as Element).setPointerCapture(e.pointerId);
     // ... FSM logic
   };
   ```

3. Touch events оставить только для scroll lock в useContentHooks (где pointer events не нужны).

**Плюсы:** Pointer events надёжнее на iOS (приходят ДО touch events), unified API для mouse/touch/pen.
**Минусы:** Больше изменений, нужно тестировать на Android (хотя pointer events там тоже работают), `e.changedTouches[0]` заменяется на `e.clientX/e.clientY` напрямую.

### Рекомендация: начать с варианта A, перейти к B если A недостаточно

Вариант A — хирургическое удаление capture-phase blockers — должен решить основную проблему с минимальным риском. Если после этого останутся iOS-специфичные проблемы доставки событий, перейти к варианту B.

### Что НЕ менять

- `touch-action: pan-x pan-y` в CSS — работает корректно на iOS 13+
- `cursor: pointer` на iframe body — критично для iOS click delegation
- `overscroll-behavior: none` — работает на iOS
- Spring physics через motion/react — не связан с touch events
- FSM архитектуру gesture controller (idle/pending/swiping/cancelled) — проблема в delivery событий, не в логике
- iOS overlay для center-tap (useGestureController строки 921-1020) — может понадобиться как fallback

---

## Инструменты для удалённой отладки iOS

### 1. Safari Web Inspector (основной)

| Шаг | Действие |
|-----|----------|
| 1 | iPhone: Настройки > Safari > Дополнения > Web Inspector: ВКЛ |
| 2 | Mac: Safari > Preferences > Advanced > Show Develop menu: ВКЛ |
| 3 | Подключить iPhone USB-кабелем к Mac |
| 4 | Открыть сайт в Safari на iPhone |
| 5 | Mac Safari > Develop > [имя iPhone] > fancai.ru |
| 6 | Console, Elements, Network, Timeline — всё доступно |

**Критическое ограничение:** Web Inspector НЕ работает для standalone PWA (добавлено на Home Screen). Только вкладки Safari.

**Обходной путь:** Тестировать в Safari browser (не PWA), верифицировать в standalone после фикса.

### 2. Xcode Simulator

```bash
open -a Simulator
# Safari Web Inspector работает с Simulator — можно дебажить
# даже standalone PWA через Simulator (в отличие от реального устройства)
```

**Преимущество:** В Simulator Web Inspector работает для standalone PWA.
**Ограничение:** Simulator НЕ идентичен реальному устройству для touch events. Используется мышь вместо пальца.

### 3. DebugPanel (свой, расширение)

Существующий `/?debug=1` logger нужно расширить для iOS touch диагностики:

```typescript
// Добавить в useGestureController contentHook:
const handleTouchStart = (e: TouchEvent) => {
  logger.debug('[gesture] touchstart', {
    touches: e.touches.length,
    x: e.touches[0]?.clientX?.toFixed(0),
    y: e.touches[0]?.clientY?.toFixed(0),
    cancelable: e.cancelable,
    defaultPrevented: e.defaultPrevented,
    target: (e.target as HTMLElement)?.tagName,
    className: (e.target as HTMLElement)?.className?.slice(0, 50),
    state: touchRef.current.state,
  });
};
```

Также добавить трассировку в useEpubIOSFixes для проверки, что touch blockers/snap/gestures корректно отключены.

### 4. Eruda (опционально, для standalone PWA)

```typescript
// В main.tsx или App.tsx — условная загрузка
if (new URLSearchParams(location.search).has('eruda')) {
  import('eruda').then(({ default: eruda }) => eruda.init());
}
```

**Характеристики:**
- ~100KB gzipped — загружать только по запросу (`?eruda=true`)
- Console, Elements, Network панели
- Работает в standalone PWA
- НЕ видит iframe содержимое (epub.js) — для iframe нужен свой DebugPanel

---

## epub.js Snap class: полный анализ конфликта

### Как Snap работает (snap.js)

1. **Init (строки 36-39):** Если `supportsTouch()` (проверяет `'ontouchstart' in window`), вызывает `setup()`.
2. **Setup (строки 42-87):** Привязывает `stage.container` как scroller, добавляет `touchstart`/`touchmove`/`touchend` listeners на scroller.
3. **afterDisplayed (строки 151-156):** Подписывается на touch events от каждого content view через EventEmitter. Пробрасывает их как `this.emit(e.type, e, contents)`.
4. **onTouchMove (строки 191-205):** `this.element.scrollLeft -= screenX - this.endTouchX` — ПРЯМО ДВИГАЕТ scrollLeft stage container! Это конфликтует с follow-finger CSS transform из useGestureController.
5. **onTouchEnd (строки 207-228):** Вызывает `this.snap()` → `smoothScrollTo()` — анимирует scrollLeft к snap position. Конфликтует с навигацией через `rendition.next()/prev()`.

### Как проект отключает Snap (useEpubIOSFixes.ts)

1. `manager.snap = function() { return Promise.resolve(); }` — заглушка snap() метода (строка 102)
2. `manager.gestures.destroy()` + `manager.gestures = null` — уничтожение gesture объекта (строки 109-113)
3. `stage.scrollBy = function() {}` — блокировка scrollBy (строки 127-129)
4. Capture-phase touch event blockers с stopPropagation (строки 136-148)

**Проблема:** Шаги 1-3 достаточны для отключения Snap. Шаг 4 (capture-phase blockers) — избыточен и вредит, блокируя СОБСТВЕННЫЕ touch handlers из useGestureController.

### Рекомендация: убрать шаг 4, усилить шаг 1

Вместо capture-phase blockers, дополнительно отключить epub.js Contents event forwarding:

```typescript
// В useEpubIOSFixes, после получения iframe:
const doc = iframe?.contentDocument;
if (doc) {
  // Найти и отключить epub.js _triggerEvent для touch events
  // (contents.js:894-895 добавляет их с { passive: true })
  // Это предотвращает прокидывание touch events в Snap EventEmitter
}
```

---

## Альтернативы рассмотренные

| Категория | Рекомендовано | Альтернатива | Почему нет |
|-----------|---------------|--------------|------------|
| Event API | Touch Events (вариант A) / Pointer Events (вариант B) | @use-gesture, Hammer.js | Лишняя зависимость, не работает с iframe, текущий FSM уже работает |
| Блокировка epub.js | Отключить snap/gestures при init + убрать EventEmitter forwarding | stopPropagation в capture phase | capture-phase blocking ломает собственные обработчики |
| Debug iOS | DebugPanel + Safari Web Inspector | Eruda | Eruda 100KB, не видит iframe; DebugPanel уже есть, Inspector мощнее |
| iOS gesture detection | Единый pipeline (iframe touch events) | Отдельный iOS overlay для всего | Overlay усложняет event pipeline, увеличивает площадь потенциальных конфликтов |
| epub.js замена | Оставить epub.js 0.3.93, отключить конфликтующие части | Readium, Vivliostyle, foliate-js | Замена ридера = переписать проект. epub.js работает после правильной изоляции |

---

## Установка

```bash
# Новые зависимости НЕ нужны. Все фиксы через изменение существующего кода.

# Опционально: Eruda для dev (standalone PWA debugging)
cd frontend && npm install -D eruda
```

---

## Источники

### Официальная документация Apple
- [Safari Web Content Guide: Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) — touch event model, click delegation, cursor:pointer requirement (HIGH confidence)
- [Safari Web Inspector Guide](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Safari_Developer_Guide/GettingStarted/GettingStarted.html) — remote debugging setup (HIGH confidence)

### Caniuse (проверено 2026-03-14)
- [touch-action CSS property](https://caniuse.com/css-touch-action) — iOS Safari 13+ full support (HIGH confidence)
- [touch-action: none](https://caniuse.com/mdn-css_properties_touch-action_none) — iOS Safari 13+ supported (HIGH confidence)
- [touch-action: pan-y](https://caniuse.com/mdn-css_properties_touch-action_pan-y) — iOS Safari 13+ supported (HIGH confidence)

### Touch/Pointer Events исследования
- [Patrick H. Lauke: Touch/pointer events test results](https://patrickhlauke.github.io/touch/tests/results/) — cross-browser event ordering matrix (HIGH confidence)
- [Patrick H. Lauke: Getting Touchy](https://patrickhlauke.github.io/getting-touchy-presentation/) — comprehensive touch/pointer events reference (HIGH confidence)
- [WebKit: More Responsive Tapping on iOS](https://webkit.org/blog/5610/more-responsive-tapping-on-ios/) — 300ms delay elimination (HIGH confidence)
- [Gravity Department: JS click event bubbling on iOS](https://gravitydept.com/blog/js-click-event-bubbling-on-ios) — click delegation, cursor:pointer workaround (MEDIUM confidence)

### WebKit bug tracker
- [#128924: Shifted document touch handling in iframes](https://bugs.webkit.org/show_bug.cgi?id=128924) — iframe touch coordinate issues (MEDIUM confidence)
- [#133112: Touch-action CSS property support](https://bugs.webkit.org/show_bug.cgi?id=133112) — historical context (MEDIUM confidence)
- [#214609: pointerenter with mouse pointerType](https://bugs.webkit.org/show_bug.cgi?id=214609) — iOS pointer event quirk (MEDIUM confidence)
- [Apple Forums: iOS 13.1 touchstart/touchend not fired](https://developer.apple.com/forums/thread/125073) — double-tap skip bug (HIGH confidence)

### epub.js source code (проверено в node_modules)
- `epubjs/src/managers/helpers/snap.js` — internal gesture handler, 338 строк (HIGH confidence — прямой анализ кода)
- `epubjs/src/utils/constants.js:4` — `DOM_EVENTS` includes touchstart/touchmove/touchend (HIGH confidence)
- `epubjs/src/contents.js:894-895` — `addEventListeners()` с `{ passive: true }` на все DOM_EVENTS (HIGH confidence)
- `epubjs/src/managers/continuous/index.js:409-411` — Snap instantiation при `settings.snap` (HIGH confidence)

### epub.js GitHub Issues
- [#904: Mobile Safari text selection broken](https://github.com/futurepress/epub.js/issues/904) — iPad text selection drag handle bug (MEDIUM confidence)
- [#905: preventDefault on rendition touch event](https://github.com/futurepress/epub.js/issues/905) — passive listener conflict (MEDIUM confidence)
- [#925: touchstart event not responded](https://github.com/futurepress/epub.js/issues/925) — touch event delivery issues (MEDIUM confidence)

### iOS PWA debugging
- [Apple Forums: Inspect PWA in Web Inspector](https://developer.apple.com/forums/thread/122084) — standalone PWA not inspectable (HIGH confidence)
- [web.dev: Tools and Debug](https://web.dev/learn/pwa/tools-and-debug) — PWA debugging overview (MEDIUM confidence)
- [Eruda: Console for mobile browsers](https://github.com/liriliri/eruda) — 3.4.x, ~100KB gzipped (HIGH confidence)

### WebKit/Safari 2025-2026 updates
- [WebKit Features for Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/) — Pointer/Mouse events interop improvements (HIGH confidence)
- [Announcing Interop 2025](https://webkit.org/blog/16458/announcing-interop-2025/) — browser interop priorities (MEDIUM confidence)

### Проектные файлы (верифицировано)
- `useGestureController.ts` (1096 строк) — FSM gesture controller, iOS overlay, tap/swipe detection
- `useEpubIOSFixes.ts` (159 строк) — iOS layout fix, snap/gestures disable, capture-phase touch blockers
- `useContentHooks.ts` (345 строк) — CSS injection, scroll lock, selection-blocked management
- `gestureUtils.ts` (150 строк) — pure functions: spring configs, boundary detection, velocity
- `iosSupport.ts` (486 строк) — platform detection, PWA capabilities
- `logger.ts` (56 строк) — debug buffer, `/?debug=1` activation
- `DebugPanel.tsx` (179 строк) — floating debug log viewer
- `globals.css` — reader-scroll-lock, reader-active, touch-action rules, safe-area utilities
- `ReaderPage.tsx` (219 строк) — gesturestart/gesturechange/gestureend prevention
- `feedback_selection_scroll_lock.md` — empirical finding: iframe touchend unreliable, use parent pointerdown/pointerup

---
*Stack research for: v1.3 iOS Reader Navigation Fixes*
*Researched: 2026-03-14*
