# Pitfalls Research: iOS Touch Events в iframe-based EPUB Reader

**Domain:** Починка iOS touch-событий для epub.js reader с iframe-рендерингом
**Researched:** 2026-03-14
**Confidence:** HIGH (многочисленные источники + анализ кодовой базы + документированные WebKit баги)

## Critical Pitfalls

### Pitfall 1: touch-action: pan-x pan-y НЕ РАБОТАЕТ на iOS Safari

**What goes wrong:**
Кодовая база повсеместно использует `touch-action: pan-x pan-y` (useContentHooks.ts:129, 146, 165; useGestureController.ts:941; EpubReader.tsx:715; globals.css:1071). Эти значения **НЕ поддерживаются** iOS Safari. WebKit поддерживает только `auto` и `manipulation`. Любые `pan-x`, `pan-y`, `pan-up`, `pan-down`, `none` -- игнорируются полностью. Browser falls back to `auto`, что означает: Safari обрабатывает ВСЕ жесты сам (pinch-zoom, double-tap zoom, scroll), потенциально перехватывая touch-события до JS.

**Why it happens:**
Can I Use показывает "full support" для iOS Safari 13+, что вводит в заблуждение. В реальности WebKit реализовал только `manipulation` (что является сокращением для `pan-x pan-y pinch-zoom`). Индивидуальные значения `pan-x` и `pan-y` (без pinch-zoom) не реализованы. Тест useContentHooks.test.ts:142 явно проверяет, что `manipulation` НЕ используется ("MUST NOT contain touch-action: manipulation") -- это ошибочное решение, принятое для Android без проверки на iOS.

**How to avoid:**
- Заменить ВСЕ `touch-action: pan-x pan-y` на `touch-action: manipulation` на iOS
- Использовать `@supports (-webkit-touch-callout: none)` для iOS-специфичных правил (уже есть в useContentHooks.ts:137)
- Pinch-zoom, который `manipulation` разрешает (но `pan-x pan-y` пытался запретить), на практике не проблема: epub.js iframe не масштабируется стандартным pinch-zoom
- Обновить тест useContentHooks.test.ts:142 -- `manipulation` корректен для iOS

**Warning signs:**
- На iOS: touch-события от жестов перехватываются Safari до JS-обработчиков
- `/?debug=1` показывает touchstart/touchmove/touchend в логах на Android/desktop, но НЕ на iOS
- Double-tap zoom срабатывает на iOS (потому что `pan-x pan-y` = `auto` = zoom включен)

**Phase to address:**
Phase 1 (Диагностика) -- первая проверка, Phase 2 (CSS-фикс) -- первый фикс

**Confidence:** HIGH
**Sources:**
- [WebKit Bug #133112: Touch-action css property support](https://bugs.webkit.org/show_bug.cgi?id=133112)
- [PEP Issue #350: touch-action: none not available for Safari/iOS](https://github.com/jquery/PEP/issues/350)
- [CSS-Tricks: touch-action](https://css-tricks.com/almanac/properties/t/touch-action/)
- [Can I Use: CSS touch-action](https://caniuse.com/css-touch-action)
- Анализ кодовой базы: useContentHooks.ts, useGestureController.ts, EpubReader.tsx

---

### Pitfall 2: useEpubIOSFixes.ts stopPropagation() блокирует ВСЕ touch-события

**What goes wrong:**
`applyIOSRenderedFixes()` (строки 136-141) добавляет capture-phase touch event listeners с `e.stopPropagation()` на iframe document:
```typescript
doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true, passive: true });
doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true, passive: true });
```
Эти listeners выполняются в capture-фазе (ДО bubble-фазы). `stopPropagation()` предотвращает доставку событий к ЛЮБЫМ другим listeners на том же документе, включая те, что регистрирует useGestureController через `hooks.content.register()`. **Это полная блокировка всех touch-событий в iframe на iOS.**

Цель этого кода -- заблокировать встроенные epub.js gesture handlers (manager.gestures) от вызова snap() и scrollTo(). Но побочный эффект -- блокировка ВСЕХ touch-обработчиков, включая свои собственные.

**Why it happens:**
Фикс был добавлен для борьбы с epub.js built-in snap/gesture system, которая конфликтовала с кастомным gesture controller. Правильный подход (уничтожение manager.gestures) уже реализован в том же файле (строки 107-116), но capture-phase blockers остались как "safety net". Этот safety net блокирует и нужные события.

**How to avoid:**
- Удалить capture-phase stopPropagation() blockers из useEpubIOSFixes.ts
- Вместо этого убедиться, что `manager.gestures.destroy()` + `manager.snap = noop` достаточно для подавления epub.js gesture system
- Если нужно блокировать конкретные epub.js handlers, блокировать их точечно (по имени функции или через monkey-patching), а не через capture-phase stopPropagation
- Тестировать удаление поэтапно: сначала убрать touchstart blocker, проверить тапы; затем touchmove, проверить свайпы

**Warning signs:**
- Логи `[useEpubIOSFixes] Added capture-phase touch blockers to iframe` присутствуют в консоли
- `[gesture] TAP detection` логи НИКОГДА не появляются на iOS
- Жесты работают на Android/desktop (где useEpubIOSFixes не вызывается)

**Phase to address:**
Phase 1 (Диагностика) -- подтверждение через debug-логирование, Phase 2 (Core fix)

**Confidence:** HIGH (прямой анализ кода -- capture-phase stopPropagation() гарантированно блокирует все downstream listeners)

---

### Pitfall 3: Порядок регистрации listeners -- hooks.content.register() vs capture-phase blockers

**What goes wrong:**
useGestureController регистрирует touch-listener через `rendition.hooks.content.register(contentHook)` (строка 874). Эти listeners добавляются к iframe document в bubble-фазе (по умолчанию). Но useEpubIOSFixes добавляет listeners в capture-фазе. Capture ВСЕГДА выполняется ДО bubble. Порядок регистрации в коде не имеет значения -- capture побеждает.

Даже если починить Pitfall 2 (удалить stopPropagation), при добавлении НОВЫХ iOS-специфичных handlers нужно учитывать фазу и приоритет.

**Why it happens:**
Разработчик может не знать разницу между capture и bubble фазой, или может добавить `{ capture: true }` "для надёжности", не понимая что это перехватит события до основных обработчиков.

**How to avoid:**
- Все touch-обработчики для gesture detection должны регистрироваться на ОДНОМ уровне (bubble-фаза на iframe document)
- Capture-фаза -- ТОЛЬКО для предотвращения конкретных нежелательных browser defaults (через preventDefault) или для event delegation
- Документировать порядок listener registration в комментариях

**Warning signs:**
- Touch-события не доходят до gesture controller, хотя они видны в Event Listener panel DevTools
- Логи gesture controller не вызываются, хотя finger events отображаются

**Phase to address:**
Phase 2 (Core fix) -- при рефакторинге touch event pipeline

**Confidence:** HIGH

---

### Pitfall 4: iOS Safari "не-кликабельные элементы не генерируют события"

**What goes wrong:**
Согласно Apple Developer Documentation: "If the user taps a nonclickable element, no events are generated." Это уникальное поведение iOS Safari. В отличие от Android/Chrome, где touch-события генерируются на ЛЮБОМ элементе, iOS Safari требует чтобы элемент был "clickable" (имел `cursor: pointer`, был `<a>`, `<button>`, `<input>`, или имел onclick handler).

Кодовая база частично решает это (`body.style.cursor = 'pointer'` в useGestureController.ts:329 и `cursor: pointer` в useContentHooks.ts:131), но эти фиксы могут не применяться или могут быть перезаписаны:
1. epub.js может перезаписать body styles при навигации
2. CSS specificity может перезаписать `cursor: pointer`
3. Динамически добавленный контент (аннотации, entity highlights) может не унаследовать cursor

**Why it happens:**
Это оптимизация iOS Safari для экономии батареи -- если элемент не интерактивен, нет смысла генерировать события. Но в нашем случае ВЕСЬ iframe -- интерактивная зона для жестов.

**How to avoid:**
- Убедиться, что `cursor: pointer` на body применяется ПОСЛЕ каждой навигации epub.js (через hooks.content.register, который уже используется)
- Добавить пустой `onclick=""` или `ontouchstart=""` атрибут на body как fallback
- Проверить через DevTools > Computed Styles, что cursor:pointer реально установлен на body iframe
- Использовать CSS `* { cursor: pointer !important; }` в iframe как nuclear option (может повлиять на визуал)

**Warning signs:**
- Тапы в "пустых" зонах iframe (без текста/ссылок) не генерируют НИКАКИХ событий
- Тапы на текст/ссылки работают, а на пустом фоне -- нет
- Cursor computed style не показывает `pointer` на body

**Phase to address:**
Phase 2 (CSS-фиксы) -- проверка + усиление cursor: pointer

**Confidence:** HIGH
**Sources:**
- [Apple Developer: Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)
- [QuirksBlog: Click event delegation on iPhone](https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html)

---

### Pitfall 5: iOS Safari одно-пальцевый скролл НЕ генерирует события во время движения

**What goes wrong:**
Apple документация: "One-finger panning does NOT generate events until the user stops panning -- an onscroll event is generated when the page stops moving and redraws." Это означает: touchstart срабатывает, но если iOS решает что это scroll (вертикальное движение), touchmove и touchend могут НЕ быть доставлены вашему JS. iOS "забирает" gesture у JS и передаёт её compositor thread для аппаратного скролла.

Для горизонтальных свайпов (page navigation) это может означать: если CSS позволяет scroll в обоих направлениях (touch-action: auto из-за Pitfall 1), iOS может "украсть" горизонтальный свайп для native scrolling.

**Why it happens:**
iOS WebKit использует "gesture recognition" на системном уровне. Если система определяет жест как scroll (на основе первых ~10px движения), она перехватывает его и не передаёт дальнейшие touch-события в JS.

**How to avoid:**
- `touch-action: manipulation` (не `none`, не `pan-x pan-y`) -- даёт iOS достаточно информации чтобы не перехватывать кастомные жесты
- Для iframe body: `touch-action: manipulation` + `overscroll-behavior: contain`
- Для page wrapper (parent document): `touch-action: manipulation` + `overscroll-behavior: none`
- НЕ полагаться на touchmove для определения жеста -- threshold должен быть minimal (10px в FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold = 10 -- это корректно)
- Вызывать `e.preventDefault()` на touchmove СРАЗУ при определении горизонтального свайпа (это уже сделано в useGestureController.ts:437, но требует `{ passive: false }` -- уже есть на строке 857)

**Warning signs:**
- touchstart приходит, touchmove -- нет (iOS перехватил gesture)
- Страница "прыгает" вместо follow-finger animation
- iOS rubber-band bounce срабатывает при горизонтальных свайпах

**Phase to address:**
Phase 2 (CSS-фиксы) + Phase 3 (Gesture pipeline фиксы)

**Confidence:** HIGH
**Sources:**
- [Apple Developer: Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)

---

### Pitfall 6: iOS overlay перехватывает touch-события до iframe

**What goes wrong:**
useGestureController создаёт iOS-specific overlay div (строки 921-1020) для center-tap detection. Этот overlay:
- position: absolute
- top: calc(env(safe-area-inset-top) + 64px) to bottom
- left: 15% to right: 15% (center zone)
- z-index: 5

Overlay находится ПОВЕРХ iframe. Touch-события на overlay НЕ проходят к iframe. Overlay обрабатывает ТОЛЬКО touchstart/touchend (для tap detection), но НЕ touchmove. Это означает:
1. Свайпы, начинающиеся в center zone (70% ширины экрана), НЕ перехватываются gesture controller (он слушает iframe touchmove)
2. Edge taps (left/right 15%) обрабатываются iframe gesture controller, НО если overlay перекрывает edge zones (left: 15% означает overlay начинается с 15%), то edge taps идут в iframe -- правильно
3. НО: свайп начинающийся в center zone НЕ генерирует touchmove events в iframe -- overlay их "проглатывает"

**Why it happens:**
Overlay был добавлен потому что "iOS center-tap from iframe may not work reliably" (комментарий в коде строка 917-919). Но overlay не передаёт touchmove события, что ломает свайпы.

**How to avoid:**
- Вариант A: Добавить pointer-events: none на overlay (тогда ВСЕ touch-события пройдут к iframe), но overlay потеряет возможность ловить center-taps
- Вариант B: Проброс touchmove/touchend от overlay к iframe document (сложно и fragile)
- Вариант C (рекомендуется): Убрать overlay полностью, починить root cause -- почему center-tap из iframe не работает на iOS (см. Pitfall 1 + Pitfall 2 + Pitfall 4). Overlay -- костыль поверх нерешённой проблемы
- Вариант D: touch-action: none на overlay + пробрасывать ВСЕ события в iframe программно

**Warning signs:**
- Свайпы в центральной зоне (70% экрана) не работают
- Edge swipes (начинающиеся в edge zones 15%) работают
- Center taps работают через overlay, но свайпы -- нет

**Phase to address:**
Phase 3 (Gesture integration) -- после починки core touch event pipeline

**Confidence:** HIGH (прямой анализ кода)

---

### Pitfall 7: preventDefault() на passive: true listener молча игнорируется

**What goes wrong:**
useEpubIOSFixes.ts:139 регистрирует touchmove handler с `{ capture: true, passive: true }`. Если разработчик попытается добавить `e.preventDefault()` в этот handler (например, чтобы предотвратить скролл), вызов будет МОЛЧА ПРОИГНОРИРОВАН -- без ошибки в консоли на iOS Safari (в Chrome -- выводит предупреждение).

useGestureController.ts:857 правильно использует `{ passive: false }` для touchmove, что позволяет вызывать preventDefault(). Но если capture-phase listener (useEpubIOSFixes) перехватит событие раньше, preventDefault из gesture controller никогда не вызовется.

**Why it happens:**
Safari молча игнорирует preventDefault() на passive listeners (в отличие от Chrome, который хотя бы логирует предупреждение). Разработчик может не заметить что preventDefault не работает.

**How to avoid:**
- ВСЕГДА использовать `{ passive: false }` для touchmove если планируется вызов preventDefault()
- Не использовать passive: true + stopPropagation на capture-фазе одновременно
- Добавить explicit логирование: `if (e.defaultPrevented) logger.debug('OK') else logger.warn('preventDefault FAILED')`
- Тестировать preventDefault-поведение на реальном iOS устройстве, не в эмуляторе

**Warning signs:**
- iOS Safari: страница скроллится несмотря на preventDefault() в обработчике
- Chrome DevTools показывает "[Intervention] Unable to preventDefault inside passive event listener"
- iOS Safari: НИЧЕГО не показывает, просто не работает

**Phase to address:**
Phase 2 (Core fix) -- при рефакторинге touch event pipeline

**Confidence:** HIGH
**Sources:**
- [WebKit Bug #182521: touchmove preventDefault() no longer respected](https://bugs.webkit.org/show_bug.cgi?id=182521)
- [uriports.com: Easy fix for passive event listener](https://www.uriports.com/blog/easy-fix-for-unable-to-preventdefault-inside-passive-event-listener/)

---

### Pitfall 8: Координаты touch-событий в iframe смещены на iOS

**What goes wrong:**
WebKit Bug #128924 документирует: координаты touch-событий в iframe document node смещены на величину margin/offset iframe от parent window. Область iframe, соответствующая левому margin parent window, не генерирует touch-события. Это было исправлено для основного случая, но edge cases могут оставаться.

В нашей кодовой базе: `getIframeOffset()` (useGestureController.ts:265-276) получает rect.left iframe для корректировки координат. `screenX = touch.clientX + iframeOffset` (строка 569). Если iframeOffset рассчитывается неверно на iOS, зоны тапов будут смещены.

Дополнительно: `touch.clientX` в iframe -- это координата относительно viewport IFRAME, а не parent window. При конвертации в screen coordinates нужно учитывать safe-area insets и padding (paddingTop/Left из env(safe-area-inset-*)).

**Why it happens:**
Cross-frame coordinate systems -- сложная тема. clientX/clientY в iframe relative к iframe viewport. getBoundingClientRect() iframe -- relative к parent viewport. Safe-area insets добавляют ещё один слой offset. На iOS с notch (iPhone 15 Pro) safe-area-inset-top = ~59px, что может сдвинуть все координаты.

**How to avoid:**
- Для зон тапов (edge vs center): использовать `window.innerWidth` (parent) а не iframe dimensions
- Проверить: `getIframeOffset()` может возвращать 0 если frameElement недоступен cross-origin
- Добавить debug-логирование координат: `[gesture] screenX=${screenX}, clientX=${touch.clientX}, iframeOffset=${offset}, screenWidth=${window.innerWidth}`
- Тестировать с КОНКРЕТНЫМ устройством (iPhone 15 Pro имеет специфичные safe-area значения)

**Warning signs:**
- Тапы регистрируются, но попадают в "неправильную" зону (edge tap распознаётся как center, center как edge)
- Tap zone boundaries визуально смещены относительно ожидаемых 15% зон
- `[gesture] Zone detection` логи показывают неожиданные screenX значения

**Phase to address:**
Phase 3 (Gesture pipeline) -- после core fix

**Confidence:** MEDIUM (WebKit Bug #128924 был исправлен, но edge cases могут оставаться на новых iOS версиях)
**Sources:**
- [WebKit Bug #128924: Shifted document touch handling in iframes on iOS](https://bugs.webkit.org/show_bug.cgi?id=128924)

---

### Pitfall 9: PWA standalone mode имеет отличное поведение touch-событий

**What goes wrong:**
iOS PWA в standalone mode (добавлено на Home Screen) обрабатывает touch-события иначе чем Safari tab. Documented differences:
- Pointer/touch события могут "проходить сквозь" overlays и backdrop
- overflow: hidden не всегда предотвращает скролл
- Edge swipe gestures (от края экрана) перехватываются iOS для навигации назад/вперёд между "страницами" PWA
- Safe-area insets могут отличаться от Safari tab

В нашей кодовой базе: `isStandalone()` проверяется (iosSupport.ts:100-123), но gesture controller НЕ учитывает standalone-специфичное поведение.

**Why it happens:**
PWA standalone mode использует другой WebKit runtime context с немного другими правилами event routing. Apple не документирует различия.

**How to avoid:**
- Тестировать ВСЕ жесты в трёх режимах: Safari tab, PWA standalone, Chrome iOS
- Добавить отдельный debug branch для standalone: `if (isStandalone()) logger.debug('[gesture] PWA standalone mode detected')`
- Edge swipe от левого края экрана может конфликтовать с "prev page" tap zone -- увеличить dead zone для iOS standalone
- Использовать `overscroll-behavior: none` + `position: fixed` на body для предотвращения PWA rubber band

**Warning signs:**
- Работает в Safari tab, не работает при запуске с Home Screen (или наоборот)
- Edge swipes вызывают iOS back-navigation вместо page turn
- Touch events "пробивают" через drawer/modal overlays

**Phase to address:**
Phase 4 (Тестирование и edge cases) -- финальная проверка во всех режимах

**Confidence:** MEDIUM (документировано в community, но специфичное поведение iOS 26.3.1 не верифицировано)
**Sources:**
- [shadcn-ui Issue #8507: Vaul breaks pointer isolation in iOS PWA standalone](https://github.com/shadcn-ui/ui/issues/8507)
- [Brainhub: PWA on iOS Current Status & Limitations 2025](https://brainhub.eu/library/pwa-on-ios)

---

### Pitfall 10: Text selection на iOS конфликтует с gesture recognition

**What goes wrong:**
iOS Safari обрабатывает long-press как trigger для text selection на системном уровне. Это может конфликтовать с gesture FSM:
1. Long press (>250ms) в useGestureController определяется как "не тап" (строка 514) и игнорируется -- правильно
2. Но iOS может начать text selection bubble/magnifier ПАРАЛЛЕЛЬНО с gesture detection
3. После text selection: `getSelection().toString().length > 0` в touchstart handler (строка 338) блокирует НОВЫЕ жесты
4. На iOS "selection change" может происходить ПОСЛЕ touchend (async), что создаёт race condition

Дополнительно: `selectionchange` listener в useTextSelection.ts (строка 227) слушает iframe document. На iOS selectionchange может не fire для programmatic selection changes.

**Why it happens:**
iOS gesture recognizer работает параллельно с JS gesture detection. Apple не даёт контроль над системным gesture recognizer из web. `SuppressesLongPressGesture` доступен только в native (Capacitor/Cordova).

**How to avoid:**
- `-webkit-user-select: none` на body во время swiping фазы (уже реализовано через `selection-blocked` class в строках 1067-1083)
- НЕ ставить `-webkit-user-select: none` на body постоянно -- это СЛОМАЕТ text selection feature
- Проверять `window.getSelection()` в ОБОИХ документах (parent и iframe)
- Использовать `selectionchange` event с debounce для iOS (может fire multiple times)
- `-webkit-touch-callout: none` на non-interactive elements чтобы предотвратить iOS callout menu

**Warning signs:**
- Long-press показывает iOS magnifying glass/callout одновременно с custom gesture
- После отмены text selection, следующий тап не регистрируется
- suppressSelectionUntil (useTextSelection.ts:47) не предотвращает ghost selection на iOS

**Phase to address:**
Phase 4 (Text selection fixes)

**Confidence:** HIGH
**Sources:**
- [Capacitor Discussion #3208: SuppressesLongPressGesture](https://github.com/ionic-team/capacitor/discussions/3208)
- [Apple Developer: Handling long-press gestures](https://developer.apple.com/documentation/uikit/handling-long-press-gestures)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Capture-phase stopPropagation для блокировки epub.js gestures | Быстро отключает epub.js native gestures | Блокирует ВСЕ touch-события включая custom gesture controller | Never -- нужно точечно отключать epub.js gestures |
| iOS overlay для center-tap вместо починки root cause | Быстрый workaround для нерабочего center-tap | Ломает свайпы в center zone (70% экрана), дублирует gesture logic | Временно, пока не починен root cause |
| touch-action: pan-x pan-y вместо manipulation | Точный контроль (нет pinch-zoom) | Не работает на iOS вообще | Never на iOS -- manipulation единственный рабочий вариант |
| Inline body.style.cursor = 'pointer' | Быстрый iOS click delegation fix | Может быть перезаписан epub.js при навигации | Допустимо как fallback рядом с CSS-правилом |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| epub.js hooks.content.register + iOS fixes | Регистрировать iOS fixes и gesture handlers независимо, без учёта порядка выполнения | Единый pipeline: iOS fixes применяются ПЕРЕД gesture handler registration, без capture-phase blocking |
| epub.js manager.gestures | Использовать stopPropagation для отключения | Вызвать manager.gestures.destroy() + monkey-patch manager.snap = noop |
| iOS overlay + iframe gesture controller | Overlay для тапов, iframe для свайпов (разная логика, разные точки входа) | Единый gesture controller через iframe, overlay убрать после починки root cause |
| VisualViewport API + touch events | Не учитывать viewport offset при keyboard popup | Корректировать touch coordinates через visualViewport.offsetTop/offsetLeft |
| Vaul drawer (bottom sheets) + iOS touch | Vaul перехватывает touch-события в standalone PWA mode | Тестировать drawer dismiss в PWA standalone, использовать Vaul `modal={false}` если нужно |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| setState в touchmove handler | Jank при follow-finger анимации, пропущенные кадры | Использовать useRef для touch state (уже сделано в кодовой базе), setState только для rendering state | При 60+ touchmove events/sec |
| Multiple addEventListener без cleanup | Memory leaks при навигации между главами | Cleanup через __gestureControllerCleanup (уже реализовано), проверять в DevTools > Memory | После 10+ chapter navigations |
| Re-registration listeners при каждом rendered event | Накопление duplicate listeners | Deregister before register, или проверять existence | Любое количество chapter navigations |
| Synchronous DOM query в touchmove | Forced reflow, jank | elementFromPoint ТОЛЬКО в touchend (для tap detection), НИКОГДА в touchmove | При сложном DOM (500+ elements) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Cross-frame DOM access без try-catch | Crash если iframe cross-origin | Всегда оборачивать iframe.contentDocument/contentWindow доступ в try-catch (уже сделано в кодовой базе) |
| Touch coordinate injection через crafted events | Fake tap navigation (low risk) | Не доверять coordinates для security decisions, только для UX |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Починить тапы но сломать text selection | Пользователь не может выделять текст для заметок | Тестировать text selection после КАЖДОГО изменения в touch pipeline |
| Слишком маленький TAP_MAX_MOVEMENT (20px) на iOS | iOS жесты менее точны из-за rubber tips, 20px может быть мало | Увеличить до 25-30px для iOS (isIOS() ? 30 : 20) |
| Анимация при каждом тапе навигации | На слабом iOS устройстве анимация лагает, пользователь думает что тап не сработал | Instant feedback (визуальная индикация тапа ПЕРЕД анимацией) |
| Edge swipe вместо iOS back gesture | Пользователь хочет вернуться назад в приложении, а получает page turn | Dead zone (первые 20px от edge) для iOS back gesture в standalone mode |
| Double-tap zoom на тексте вместо navigation | Пользователь double-taps для быстрой навигации, но получает zoom | touch-action: manipulation предотвращает double-tap zoom |

## "Looks Done But Isn't" Checklist

- [ ] **Touch-action CSS:** Проверен computed style в iframe body на реальном iOS -- `touch-action: manipulation` (не `pan-x pan-y` или `auto`)
- [ ] **Тапы:** Работают в edge zones (prev/next) И center zone (toggle UI) на iOS Safari, iOS Chrome, PWA standalone
- [ ] **Свайпы:** Follow-finger анимация работает на iOS с 60fps (не jank)
- [ ] **Text selection:** Long-press для выделения текста работает после починки touch-событий
- [ ] **Annotation tap:** Тап по выделенному тексту (user-annotation) открывает popup на iOS
- [ ] **Description/Entity tap:** Тап по description-highlight и entity-mention работает в center zone на iOS
- [ ] **Panel dismiss:** Тап в iframe при открытой панели (TOC, Settings, Search) закрывает панель на iOS
- [ ] **iOS overlay:** Удалён или не конфликтует со свайпами в center zone
- [ ] **Capture-phase blockers:** Удалены или не блокируют gesture controller
- [ ] **Keyboard:** Виртуальная клавиатура (при text selection + note) не ломает touch coordinates
- [ ] **Safari tab vs PWA standalone:** Все жесты работают в обоих режимах
- [ ] **Orientation change:** Landscape/portrait переключение не ломает gesture zones

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| touch-action: pan-x pan-y | LOW | Найти-заменить на `manipulation`, обновить тесты |
| Capture-phase stopPropagation | LOW | Удалить 3 addEventListener + blockEpubJsTouchHandler, проверить что manager.gestures.destroy() достаточно |
| iOS overlay конфликт | MEDIUM | Удалить overlay (50 строк), починить root cause в iframe touch pipeline |
| Coordinate offset на iOS | MEDIUM | Debug-логирование координат, пошаговая калибровка getIframeOffset() |
| Text selection conflict | MEDIUM | Итеративная настройка selection-blocked class и suppressSelection timing |
| PWA standalone differences | HIGH | Требует отдельной сессии тестирования на физическом устройстве |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| touch-action: pan-x pan-y | Phase 1 (диагностика + CSS-фиксы) | Computed style в DevTools = `manipulation` на iOS iframe body |
| Capture-phase stopPropagation | Phase 2 (Core touch pipeline fix) | `[gesture] TAP detection` логи появляются на iOS |
| Listener order/phase conflicts | Phase 2 (Core touch pipeline fix) | Все touch-event логи gesture controller fire на iOS |
| Non-clickable elements no events | Phase 2 (CSS-фиксы) | Тап в "пустое" место iframe генерирует touchstart |
| iOS scroll gesture interception | Phase 2 (CSS-фиксы) | Горизонтальный свайп не вызывает native scroll |
| iOS overlay vs swipes | Phase 3 (Gesture integration) | Свайп в center zone работает на iOS |
| preventDefault on passive | Phase 2 (Core fix) | `e.cancelable && e.preventDefault()` в touchmove handler |
| Touch coordinates offset | Phase 3 (Gesture integration) | Debug лог показывает корректные screenX/zone для edge/center |
| PWA standalone differences | Phase 4 (Testing) | Все жесты проверены в PWA standalone mode |
| Text selection conflict | Phase 4 (Text selection) | Long-press -> text selection работает, не конфликтует с gesture FSM |

## iOS-Specific Testing Requirements

### Обязательное тестирование на физическом устройстве
- iOS Simulator НЕ воспроизводит все touch event bugs (отсутствует gesture recognizer уровня ОС)
- Chrome DevTools touch emulation НЕ воспроизводит iOS-специфичное поведение
- Минимальный тест-сет: iPhone 15 Pro (iOS 26.3.1)

### Сценарии тестирования
1. **Safari tab:** Открыть fancai.ru -> открыть книгу -> тапы/свайпы/text selection
2. **PWA standalone:** Добавить на Home Screen -> тот же тест
3. **Chrome iOS:** Открыть в Chrome -> тот же тест (все iOS Chrome используют WebKit)
4. **Landscape:** Повернуть устройство -> проверить зоны тапов пересчитаны
5. **After keyboard dismiss:** Открыть клавиатуру (search/notes) -> закрыть -> проверить жесты работают
6. **Low battery mode:** iOS может throttle animations/events

### Debug инструментарий
- `/?debug=1` -- включить подробное логирование в gesture controller
- Safari Web Inspector (macOS) -- подключиться к iPhone через USB для полноценного DevTools
- `document.addEventListener('touchstart', e => console.log('TOUCHSTART', e))` на iframe document -- верификация что events fire

## Sources

- [Apple Developer: Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)
- [WebKit Bug #128924: Shifted document touch handling in iframes on iOS](https://bugs.webkit.org/show_bug.cgi?id=128924)
- [WebKit Bug #133112: Touch-action css property support](https://bugs.webkit.org/show_bug.cgi?id=133112)
- [WebKit Bug #182521: touchmove preventDefault() no longer respected](https://bugs.webkit.org/show_bug.cgi?id=182521)
- [WebKit Bug #211521: Regression with touch/pointer events](https://bugs.webkit.org/show_bug.cgi?id=211521)
- [Can I Use: CSS touch-action](https://caniuse.com/css-touch-action)
- [CSS-Tricks: touch-action](https://css-tricks.com/almanac/properties/t/touch-action/)
- [QuirksBlog: Click event delegation on iPhone](https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html)
- [PEP Issue #350: touch-action: none not available for Safari/iOS](https://github.com/jquery/PEP/issues/350)
- [epub.js Issue #904: Mobile Safari text selection broken](https://github.com/futurepress/epub.js/issues/904)
- [epub.js Issue #905: preventdefault on rendition touch event](https://github.com/futurepress/epub.js/issues/905)
- [shadcn-ui Issue #8507: Vaul breaks pointer isolation in iOS PWA standalone](https://github.com/shadcn-ui/ui/issues/8507)
- [Brainhub: PWA on iOS Current Status & Limitations 2025](https://brainhub.eu/library/pwa-on-ios)
- [iOS 13.1 touchstart/touchend not fired](https://developer.apple.com/forums/thread/125073)
- [Capacitor Discussion #3208: SuppressesLongPressGesture](https://github.com/ionic-team/capacitor/discussions/3208)
- Анализ кодовой базы: useGestureController.ts, useEpubIOSFixes.ts, useContentHooks.ts, useTextSelection.ts, iosSupport.ts

---
*Pitfalls research for: iOS Touch Events в iframe-based EPUB Reader*
*Researched: 2026-03-14*
