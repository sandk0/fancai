# Feature Research: iOS Reader Navigation Fixes

**Domain:** iOS touch event pipeline для iframe-based EPUB reader
**Researched:** 2026-03-14
**Confidence:** HIGH

## Executive Summary

iOS Safari (и все браузеры на iOS, включая Chrome и PWA) имеет фундаментально иную модель обработки touch-событий в iframe по сравнению с Android/Desktop. Корень проблемы -- WebKit обрабатывает touch events в iframe с особенностями: координатные сдвиги, агрессивный перехват жестов для навигации браузера, ограниченная поддержка `touch-action` CSS, и несовместимое поведение `passive` event listeners. Существующая кодовая база уже содержит обширные iOS-специфичные workaround'ы (useEpubIOSFixes.ts, iOS overlay в useGestureController.ts, CSS @supports hacks), но все они нацелены на layout/spread проблемы, а не на полный touch event pipeline.

Ключевая проблема: **touch events регистрируются внутри iframe, но iOS WebKit искажает их координаты, перехватывает жесты для своей навигации, и не уважает `preventDefault()` на passive listeners** -- в результате тапы, свайпы и выделение текста не работают.

Наиболее вероятная корневая причина (требует диагностического подтверждения): **capture-phase `stopPropagation()` в useEpubIOSFixes.ts блокирует все touch events до того, как они достигают gesture controller handlers в bubble phase**.

## Feature Landscape

### Table Stakes (Пользователь ожидает, отсутствие = продукт сломан)

| Feature | Почему ожидается | Сложность | Заметки |
|---------|-----------------|-----------|---------|
| Тап по краю страницы = перелистывание | Базовая навигация, Apple Books / Kindle работают так | MEDIUM | На iOS тапы внутри iframe могут не генерировать click event без `cursor: pointer` на body. Уже есть в CSS, но iOS overlay покрывает только center zone (15%-85%). Edge taps (0-15%, 85-100%) обрабатываются только через iframe touchend, который может не срабатывать если capture-phase stopPropagation блокирует bubble phase |
| Свайп = перелистывание с follow-finger | Стандарт iOS-ридеров, пользователь ожидает Apple Books-подобное поведение | HIGH | touchmove внутри iframe + `e.preventDefault()` для отмены скролла. На iOS: 1) `passive: true` по умолчанию для touchstart -- `preventDefault()` игнорируется; 2) `touch-action: none` НЕ поддерживается iOS Safari (только `auto` и `manipulation`); 3) epub.js собственные gesture handlers конфликтуют (уже блокируются в useEpubIOSFixes.ts через `stopPropagation`) |
| Выделение текста long-press | Базовая функция чтения, копирование цитат | HIGH | iOS Safari имеет документированный баг с drag handles в iframe -- при смещении iframe от верха страницы (padding/margin) координаты drag handles сдвигаются. Баг был исправлен в iOS 12.2, но может рецидивировать. Текущий scroll lock механизм (useContentHooks.ts) привязан к parent document pointerdown/pointerup -- на iOS pointer events могут не срабатывать корректно |
| Центральный тап = показать/скрыть UI | Стандарт всех ридеров | LOW | Уже есть iOS overlay div для center zone. Проблема: overlay может перехватывать touches, предназначенные для iframe (описания, entity mentions) |
| Отсутствие двойного перелистывания | Один тап/свайп = одна страница | MEDIUM | Уже есть: useEpubIOSFixes.ts блокирует `manager.snap()`, фиксит `layout.divisor=1`. Но если touch event pipeline сломан, могут проскакивать двойные навигации |

### Differentiators (Конкурентное преимущество)

| Feature | Value Proposition | Сложность | Заметки |
|---------|-------------------|-----------|---------|
| Debug overlay для iOS диагностики | Позволяет диагностировать touch проблемы на реальном устройстве без подключения к Mac | MEDIUM | Текущий DebugPanel (`/?debug=1`) логирует через `logger.debug()`. Нужно: 1) визуальный индикатор touch events (красная точка на touchstart, синяя на touchmove, зеленая на touchend); 2) лог координат, event.cancelable, event.defaultPrevented; 3) состояние FSM gesture controller в реальном времени |
| Follow-finger с spring physics на iOS | Плавность Apple Books, визуальный feedback при свайпе | HIGH | translateX MotionValue работает на GPU через CSS transform. Сам transform работает на iOS. Проблема -- touchmove events, питающие translateX, могут не доставляться если iOS перехватывает жест для back-navigation |
| Тап на описание/entity в edge zone | Интерактивные элементы работают даже у краев страницы | LOW | `elementFromPoint` + `getInteractiveType()` уже реализованы. На iOS -- координаты в iframe могут быть сдвинуты (WebKit bug #128924, исправлен, но аналогичные проблемы появляются) |
| Тактильная обратная связь spring animations | Пользователь чувствует "вес" страницы через rubber-band | LOW | `SPRING_RUBBER`, `SPRING_TAP`, `SPRING_FAST` уже настроены. Зависит от работающего touch pipeline |

### Anti-Features (Часто запрашиваются, создают проблемы)

| Feature | Почему запрашивается | Почему проблематична | Альтернатива |
|---------|---------------------|---------------------|-------------|
| Pointer Events вместо Touch Events | "Pointer Events -- унифицированный API" | iOS Safari имеет документированные баги с pointer events (WebKit bug #214609 -- pointerenter с неправильным pointerType). Touch events надежнее на iOS. React pointer events могут не работать в iframe (issue #12901) | Оставить Touch Events, использовать pointer events только для parent document (scroll lock pointerdown/pointerup уже работает) |
| `touch-action: none` для полного контроля | "Отменить все браузерные жесты" | iOS Safari НЕ поддерживает `touch-action: none` -- только `auto` и `manipulation`. Попытка использовать сломает ожидания | Использовать `touch-action: pan-x pan-y` (уже в CSS) + `preventDefault()` на `touchmove` с `{passive: false}` для подавления конкретных жестов |
| Дублирование touch handlers на parent + iframe | "Ловить события в двух местах для надежности" | Двойная обработка одного touch = двойная навигация, конфликты между parent и iframe handlers | Единственный источник truth: iframe touch handlers через `hooks.content.register()`. iOS overlay -- только для center tap, не для navigation |
| Замена epub.js iframe на shadow DOM | "Убрать iframe -- убрать проблемы" | epub.js архитектурно построен на iframe. Замена = переписать epub.js | Работать с iframe, но правильно: 1) `cursor: pointer` на body (есть); 2) touch handlers с `{passive: false}` для touchmove; 3) координатная трансформация через `iframe.getBoundingClientRect()` |
| 3D page curl анимация | "Как настоящая книга" | Несовместима с epub.js CSS column layout + iframe. Apple Books реализует это нативно (WKWebView с Metal), веб-версия не может конкурировать | Slide анимация (уже реализована), Spring physics для тактильности |

## Feature Dependencies

```
[iOS Touch Event Диагностика]
    |
    v
[Fix touchstart/touchmove/touchend pipeline в iframe]
    |
    +---> [Fix тап навигации по краям]
    |         |
    |         +---> [Fix center tap (show/hide UI)]
    |
    +---> [Fix свайп навигации]
    |         |
    |         +---> [Follow-finger spring physics на iOS]
    |
    +---> [Fix выделения текста]
              |
              +---> [Scroll lock для iOS]
              |
              +---> [HighlightTooltip позиционирование на iOS]
```

### Dependency Notes

- **Touch Event Pipeline является фундаментом**: Все остальные фичи (тапы, свайпы, выделение) зависят от корректной доставки и обработки touch events внутри iframe на iOS. Без диагностики невозможно понять что именно сломано.
- **Диагностика первична**: Debug overlay с визуализацией touch events позволит увидеть, какие events доставляются, с какими координатами, и какие перехватываются iOS.
- **Тап навигация проще свайпа**: Тапы -- дискретные events (touchstart + touchend без значительного движения). Свайпы -- continuous (touchstart + touchmove + touchend) с `preventDefault()`. На iOS `preventDefault()` на passive touchmove не работает -- это отдельная проблема.
- **Выделение текста конфликтует с жестами**: На iOS long-press запускает нативное выделение. Gesture controller должен правильно различать: short tap = навигация, long press = выделение, horizontal drag = свайп. Текущий FSM (idle -> pending -> swiping | cancelled) правильный по логике, но timing на iOS может отличаться.
- **Scroll lock зависит от pointer events**: Текущая реализация использует parent document pointerdown/pointerup для отслеживания состояния. На iOS pointer events в iframe могут работать иначе.
- **capture-phase stopPropagation конфликт**: useEpubIOSFixes.ts добавляет capture-phase listeners с `e.stopPropagation()` для блокировки epub.js handlers. Но это может также блокировать gesture controller handlers в bubble phase. Это **наиболее вероятная корневая причина**, требующая диагностического подтверждения и рефакторинга подхода к блокировке epub.js.

## MVP Definition

### Launch With (v1.3 -- iOS fix milestone)

- [ ] **Touch event диагностика** -- расширить DebugPanel для визуализации touch events: координаты, event type, cancelable, defaultPrevented, FSM state. Позволяет видеть проблему на реальном устройстве
- [ ] **Fix touch event pipeline** -- обеспечить доставку touchstart/touchmove/touchend из iframe в gesture controller на iOS. Вероятный fix: рефакторинг capture-phase stopPropagation в useEpubIOSFixes.ts -- заменить на более точечную блокировку epub.js handlers (по event target или handler reference) вместо тотального stopPropagation
- [ ] **Fix тап навигации** -- тапы по краям (prev/next zones) работают на iOS. Проверить: click event delegation (cursor:pointer), координатная трансформация (clientX в iframe vs screen coords), timing (300ms delay / double-tap zoom)
- [ ] **Fix свайп навигации** -- горизонтальные свайпы в iframe перелистывают страницы. Ключевое: `touchmove` listener с `{passive: false}` + `preventDefault()` для подавления iOS scroll/back-navigation
- [ ] **Fix выделения текста** -- long-press + drag handles работают на iOS. Проверить: scroll lock, координаты drag handles в iframe, suppression timing

### Add After Validation (v1.3.x)

- [ ] **Follow-finger spring physics на iOS** -- если touch pipeline работает, translateX feeding из touchmove должен работать автоматически
- [ ] **Rubber-band + chapter hints на iOS** -- зависит от корректного boundary detection (getStageInfo)
- [ ] **iOS-specific timing tuning** -- LONG_PRESS_TIMEOUT, TAP_MAX_DURATION могут требовать iOS-специфичных значений

### Future Consideration (v2+)

- [ ] **Haptic feedback** -- navigator.vibrate() не поддерживается iOS Safari. Web Vibration API = Android only
- [ ] **Настраиваемые зоны тапов** -- NAV-v2-01 из backlog
- [ ] **Pointer Events миграция** -- когда iOS Safari полноценно поддержит pointer events в iframe

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Touch event диагностика (debug) | LOW (dev-only) | LOW | P1 -- без нее невозможна отладка |
| Fix тап навигации на iOS | HIGH | MEDIUM | P1 -- базовая навигация |
| Fix свайп навигации на iOS | HIGH | HIGH | P1 -- основной UX-паттерн |
| Fix выделения текста на iOS | HIGH | HIGH | P1 -- core reading feature |
| Fix center tap (show/hide UI) | MEDIUM | LOW | P1 -- уже частично работает через overlay |
| Follow-finger spring на iOS | MEDIUM | LOW (зависит от fix свайпа) | P2 -- визуальное улучшение |
| Debug overlay визуализация touches | LOW | MEDIUM | P2 -- полезно, не критично |
| Rubber-band + chapter hints iOS | LOW | LOW | P3 -- polish |

**Priority key:**
- P1: Блокирует использование ридера на iOS -- must fix
- P2: Улучшает UX после базовой работоспособности
- P3: Polish, может подождать

## Competitor Feature Analysis

| Feature | Apple Books (native) | Kindle iOS (native) | Google Play Books (web) | fancai (текущее) |
|---------|---------------------|--------------------|-----------------------|-----------------|
| Тап навигация | Работает: нативные gesture recognizers | Работает: нативные handlers | Работает: собственный rendering (не iframe) | СЛОМАНО на iOS: iframe touch events не доставляются |
| Свайп с follow-finger | Идеально: Metal/CoreAnimation | Хорошо: UIKit animations | Среднее: Canvas-based | СЛОМАНО на iOS: touchmove не доставляется/перехватывается |
| Выделение текста | Идеально: нативный UITextView | Хорошо: кастомный selection | Среднее: кастомный rendering | СЛОМАНО на iOS: drag handles offset, scroll lock не работает |
| Page turn animation | Curl/Slide/None | Slide | Slide | Slide (Spring physics) -- работает на Android/Desktop |
| Debug tools | Нет | Нет | Chrome DevTools | DebugPanel (`/?debug=1`) -- работает |

**Критический вывод:** Нативные ридеры (Apple Books, Kindle) обходят все проблемы iOS WebKit, работая с WKWebView через нативные API. Web-ридеры (Google Play Books) обычно используют собственный rendering engine (Canvas), а не epub.js/iframe. fancai -- один из немногих полнофункциональных web-based EPUB ридеров с iframe, что делает iOS touch issues особенно актуальными.

## Технический анализ корневых проблем

### Проблема 1: capture-phase stopPropagation конфликт (ВЕРОЯТНАЯ КОРНЕВАЯ ПРИЧИНА)

useEpubIOSFixes.ts добавляет capture-phase listeners с `e.stopPropagation()` для блокировки epub.js handlers. Но это блокирует ВСЕ touch events до того, как они достигают gesture controller handlers в bubble phase.

**Порядок событий:**
1. Capture phase (parent -> child): useEpubIOSFixes `stopPropagation` БЛОКИРУЕТ дальнейшее распространение
2. Target phase: событие на элементе -- **НЕ ДОСТИГАЕТСЯ**
3. Bubble phase (child -> parent): gesture controller handlers -- **НИКОГДА НЕ ВЫЗЫВАЮТСЯ**

**Текущий код (useEpubIOSFixes.ts:136-141):**
```typescript
const blockEpubJsTouchHandler = (e: TouchEvent) => {
  e.stopPropagation();
};
doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true, passive: true });
```

Gesture controller добавляет handlers в bubble phase (useGestureController.ts:856-859):
```typescript
doc.addEventListener('touchstart', wrappedTouchStart, { passive: true });
doc.addEventListener('touchmove', handleTouchMove, { passive: false });
doc.addEventListener('touchend', handleTouchEnd, { passive: true });
```

**stopPropagation в capture phase останавливает событие ДО bubble phase -- gesture controller handlers не вызываются.**

**Confidence: HIGH** -- следует из стандарта DOM Events и анализа кода.

### Проблема 2: iOS Safari passive event listeners

iOS Safari по умолчанию делает touchstart listeners passive. Это означает:
- `addEventListener('touchstart', handler)` без explicit `passive` -- passive: true по умолчанию
- `handler(e) { e.preventDefault() }` -- **игнорируется**, потому что listener passive
- Нужно: `addEventListener('touchstart', handler, { passive: false })` если требуется preventDefault

**Текущее состояние в коде:**
- useGestureController.ts touchstart: `{ passive: true }` -- **правильно** (не нужен preventDefault на touchstart)
- useGestureController.ts touchmove: `{ passive: false }` -- **правильно** (нужен preventDefault для отмены скролла)

**Confidence: HIGH** -- подтверждено Apple Developer Documentation и WebKit bugzilla.

### Проблема 3: Координатный сдвиг в iframe

WebKit bug #128924 (FIXED): touch events привязанные к iframe document node имеют неправильные координаты, когда iframe имеет offset (margin/padding). Координатный регион начинается с (0,0) вместо реальной позиции iframe.

**Текущее состояние в коде:**
- useGestureController.ts: `getIframeOffset()` получает `iframe.getBoundingClientRect().left`
- Конвертация координат: `screenX = touch.clientX + iframeOffset`
- Может быть некорректна на iOS если iframe coordinates уже сдвинуты внутренним WebKit behavior

**Confidence: MEDIUM** -- баг помечен как FIXED, но аналогичные проблемы могут появляться в новых версиях iOS.

### Проблема 4: iOS back-navigation gesture конфликт

iOS Safari/PWA имеют edge-swipe gesture для навигации назад/вперед. Свайп от левого края (~20px) = browser back. Это конфликтует с "свайп вправо = предыдущая страница" в ридере.

**Текущее состояние в коде:**
- Tap zones: EDGE_ZONE_IFRAME = 0.15 (начинаются с 0% ширины)
- Нет явной обработки edge-swipe конфликта с iOS
- `touch-action: pan-x pan-y` позволяет панорамирование, но не блокирует edge gestures

**Confidence: HIGH** -- документировано в pqina.nl/blog и Ionic framework issues.

### Проблема 5: `touch-action` ограничения на iOS

iOS Safari поддерживает только `touch-action: auto` и `touch-action: manipulation`. Значения `none`, `pan-x`, `pan-y` и комбинации (`pan-x pan-y`) имеют **ограниченную** поддержку. `manipulation` = pan-x + pan-y + pinch-zoom (но отключает double-tap-to-zoom).

**Текущее состояние в коде:**
- CSS: `touch-action: pan-x pan-y` на body в iframe
- CSS: `touch-action: pan-x pan-y !important` в @supports (-webkit-touch-callout: none) блоке
- Эффект на iOS может быть эквивалентен `manipulation` или вообще игнорироваться

**Confidence: MEDIUM** -- Can I Use показывает partial support, конкретное поведение `pan-x pan-y` на iOS требует тестирования на устройстве.

## Sources

- [WebKit Bug #128924 -- Shifted document touch handling in iframes on iOS](https://bugs.webkit.org/show_bug.cgi?id=128924)
- [WebKit Bug #182521 -- touchmove preventDefault() regression](https://bugs.webkit.org/show_bug.cgi?id=182521)
- [WebKit Bug #133112 -- Touch-action CSS property support](https://bugs.webkit.org/show_bug.cgi?id=133112)
- [WebKit Bug #154807 -- CSS pointer-events:none not working on iOS Safari](https://bugs.webkit.org/show_bug.cgi?id=154807)
- [WebKit Bug #202143 -- iOS 13 does not send proper events](https://bugs.webkit.org/show_bug.cgi?id=202143)
- [epub.js Issue #904 -- Mobile Safari text selection broken](https://github.com/futurepress/epub.js/issues/904)
- [epub.js Issue #393 -- Swipe page in android and ios](https://github.com/futurepress/epub.js/issues/393)
- [epub.js Tips and Tricks -- hooks.content.register pattern](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3))
- [Apple Safari Web Content Guide -- Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)
- [PQINA -- Blocking Navigation Gestures on iOS](https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/)
- [PQINA -- How To Prevent Scrolling The Page On iOS Safari](https://pqina.nl/blog/how-to-prevent-scrolling-the-page-on-ios-safari/)
- [MDN -- touch-action CSS property](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- [Can I Use -- CSS touch-action](https://caniuse.com/css-touch-action)
- [React Issue #20999 -- preventDefault on onTouchMove not preventing scrolling on iOS](https://github.com/facebook/react/issues/20999)
- [Why your click events don't work on Mobile Safari](https://www.shdon.com/blog/2013/06/07/why-your-click-events-don-t-work-on-mobile-safari)
- [PWA on iOS -- Current Status and Limitations 2025](https://brainhub.eu/library/pwa-on-ios)

---
*Feature research for: iOS Reader Navigation Fixes (v1.3)*
*Researched: 2026-03-14*
