# Pitfalls Research: Стабилизация мобильного ридера v1.2

**Domain:** Исправление регрессий gesture handling, анимации, text selection, popup-ов в iframe-based EPUB ридере
**Researched:** 2026-03-10
**Confidence:** HIGH (основано на анализе кодовой базы + epub.js issues + iOS/Android-специфичные баги + community patterns)

---

## Critical Pitfalls

### Pitfall 1: Двойная навигация при конкуренции свайп-анимации и epub.js scroll

**What goes wrong:**
Свайп-анимация через CSS transform (translateX на wrapper div) завершается, вызывает `onNavigate` -> `directScroll()`, но epub.js одновременно реагирует на собственный scroll event (relocated). Результат: страница перелистывается дважды, пользователь пропускает страницу.

**Why it happens:**
В текущей архитектуре анимация и навигация разделены: `animate(translateX, target, { onComplete: () => { translateX.set(0); onNavigate(dir); } })`. Между `translateX.set(0)` и завершением `directScroll()` проходит время, за которое epub.js может обработать собственный relocated event. Также `rendition.next()` / `rendition.prev()` (fallback для смены глав) запускают свою анимацию scroll, которая конфликтует с `directScroll()`.

**How to avoid:**
1. Гарантировать, что `navLock.acquire()` вызывается ДО начала анимации, а не в `onComplete`. Текущий код вызывает `navLock.acquire()` внутри `onComplete` -- к этому моменту параллельный tap мог уже пройти.
2. Использовать `scrollBehavior: 'instant'` при свайп-навигации (анимация уже была визуально через transform), не дублировать `smooth` scroll.
3. Подавлять epub.js `relocated` event во время активного свайпа через `skipNextRelocated`.
4. Не вызывать `rendition.next()` для inter-chapter navigation во время активной анимации -- ждать завершения.

**Warning signs:**
- Тесты показывают, что после свайпа `currentPage` перескакивает на +2 вместо +1.
- В консоли два последовательных `[useEpubNavigation] directScroll` лога с одинаковым direction.
- `scrollChainRef` содержит более одного pending Promise.

**Phase to address:**
Фаза "Навигация и свайпы" -- первая, так как все остальные фичи (выделение, popup-ы) зависят от стабильной навигации.

---

### Pitfall 2: Перехват touchstart gesture controller-ом блокирует нативное выделение текста

**What goes wrong:**
`useGestureController` регистрирует touchstart/touchmove/touchend на iframe document. Даже с проверкой `sel.toString().length > 0`, gesture controller перехватывает начало нового выделения, потому что в момент touchstart выделения ещё нет. Long press (350ms) корректно пропускается, но на iOS drag handles после выделения текста генерируют новый touchstart, который FSM воспринимает как начало свайпа.

**Why it happens:**
iOS Safari имеет задокументированный баг (epub.js issue #904): при попытке расширить выделение через drag handles, touch event перехватывается custom listeners, и выделение схлопывается до одного символа. Gesture controller сейчас использует `LONG_PRESS_TIMEOUT = 350ms` -- если пользователь держит палец дольше, touchend не обрабатывается. Но это не покрывает случай, когда пользователь уже выделил текст и пытается расширить выделение.

**How to avoid:**
1. В touchstart проверять не только `sel.toString().length > 0`, но и `document.getSelection().type === 'Range'` или наличие `::selection` pseudo-element.
2. Добавить состояние `'selecting'` в FSM gesture controller. Переход: если touchstart произошёл вблизи существующего выделения (selection range boundary), то FSM переходит в 'selecting' -> все touch events пробрасываются нативно.
3. На iframe document установить `user-select: auto` (не `none`). Проверить, что `touch-action` не блокирует выделение.
4. Критично: НЕ вызывать `e.preventDefault()` на touchmove, пока FSM не определил, что это свайп (текущий код уже делает это правильно -- `passive: false` + conditional `preventDefault`).

**Warning signs:**
- Пользователь не может расширить выделенный текст на iOS.
- `useTextSelection` получает пустое `selection` после попытки выделения.
- epub.js event `selected` не стреляет вообще.

**Phase to address:**
Отдельная фаза "Выделение текста и заметки" -- после стабилизации навигации, так как выделение требует stable FSM.

---

### Pitfall 3: elementFromPoint возвращает неверный элемент при активном CSS transform

**What goes wrong:**
Во время свайп-анимации или при `translateX !== 0`, тап по описанию/сущности промахивается. `elementFromPoint(x, y)` на iframe document возвращает элемент по координатам относительно iframe viewport, но визуально iframe сдвинут на `translateX` пикселей. Результат: тап на описание не открывает DescriptionDrawer, тап на entity не открывает EntityPopup.

**Why it happens:**
CSS transform на wrapper div (`FollowFingerContainer > m.div`) сдвигает визуальное положение iframe, но iframe document не знает об этом transform. `elementFromPoint()` работает в координатной системе iframe, которая не учитывает parent transform. Текущий код передаёт `touch.clientX` / `touch.clientY` напрямую в `onCenterTap`, но эти координаты валидны только при `translateX === 0`.

**How to avoid:**
1. Блокировать обработку тапов на описания/сущности, пока `phase !== 'idle'` (текущий `FollowFingerContainer` уже ставит `pointerEvents: 'none'` при `isActive`, но это не влияет на touch events, зарегистрированные напрямую на iframe document).
2. В `handleCenterTap` компенсировать текущий `translateX.get()` при вычислении координат для `elementFromPoint`.
3. Добавить guard: если `gestureController.phase !== 'idle'`, не вызывать `handleCenterTap`.

**Warning signs:**
- Тап по описанию (подсвеченный текст) не открывает drawer.
- EntityPopup появляется со смещением от места тапа.
- Проблема воспроизводится только при быстром тапе сразу после завершения свайп-анимации.

**Phase to address:**
Фаза "Описания и Entity Popup" -- после навигации, так как зависит от стабильного FSM и корректного translateX.

---

### Pitfall 4: Анимация дёрганая из-за смешивания CSS smooth scroll и spring physics

**What goes wrong:**
Текущая архитектура использует ДВА механизма анимации одновременно:
1. CSS transform (motion/react `animate()` со spring physics) для визуального follow-finger
2. CSS `scrollBehavior: 'smooth'` для фактической навигации (`directScroll()`)

При tap-навигации происходит: spring animation translateX -> reset to 0 -> smooth scroll внутри iframe. Результат: два последовательных визуальных движения с разной timing function (spring vs CSS smooth), что выглядит как "дёрганье".

**Why it happens:**
`directScroll(direction, true)` использует `stage.scrollTo({ behavior: 'smooth' })` для плавного скролла. Но визуально пользователь уже видел spring-анимацию через translateX. Два движения накладываются: spring пролетает по экрану -> translateX сбрасывается -> smooth scroll плавно двигает контент. Пользователь видит "рывок назад" между этими двумя анимациями.

**How to avoid:**
1. При свайп-навигации использовать `directScroll(direction, false)` (instant), так как визуальная анимация уже была через transform.
2. При tap-навигации: либо использовать ТОЛЬКО spring animation (без CSS smooth scroll), либо ТОЛЬКО CSS smooth scroll (без spring). Не смешивать.
3. Рекомендация: для tap -- spring animation через translateX с `onComplete: directScroll(dir, instant=true)`. Для свайпа -- follow-finger transform с `onComplete: directScroll(dir, instant=true)`.
4. Удалить `waitForScrollEnd` promise из critical path -- она добавляет 100-500ms задержки в RAf loop.

**Warning signs:**
- Визуально страница "прыгает назад" на долю секунды после завершения анимации.
- FPS падает ниже 30 на mid-range Android при быстром тапе по краям.
- DevTools Performance trace показывает два overlapping animation frames.

**Phase to address:**
Фаза "Навигация и свайпы" -- ключевая часть "Apple Books-like" анимации.

---

### Pitfall 5: iOS overlay для center-tap блокирует touch events для описаний и сущностей

**What goes wrong:**
На iOS создаётся прозрачный overlay div (`gesture-controller-ios-overlay`) поверх центральной зоны экрана (left: 15%, right: 15%). Этот overlay перехватывает ВСЕ тапы в центре, включая тапы на description-highlight и entity-mention элементы. `handleOverlayTouchEnd` вызывает `onCenterTap` с координатами, конвертированными через `iframeRect`, но overlay лежит ПОВЕРХ iframe, поэтому он ловит тап первым.

**Why it happens:**
Overlay имеет `z-index: 5` и расположен абсолютно поверх iframe. Тапы по описаниям должны проходить через iframe, но overlay перехватывает их. Текущий `handleOverlayTouchEnd` использует `elementFromPoint` через iframe, но тап уже "поглощён" overlay-ем -- touch event не дошёл до iframe document, где зарегистрированы click handlers для описаний.

**How to avoid:**
1. Использовать `pointer-events: none` на overlay и обрабатывать только через родительский listener (но тогда iOS Safari может не стрелять events).
2. Альтернатива: удалить iOS overlay полностью и обрабатывать center-tap через iframe touch events (как уже делается для Android/desktop). iOS-специфичная проблема с center-tap может быть решена через `cursor: pointer` на body (что уже сделано).
3. Если overlay необходим, после `elementFromPoint` проверять, является ли найденный элемент description-highlight или entity-mention, и вызывать соответствующий handler вместо `onToggleUI`.
4. Пробросить touch event в iframe через `iframe.contentDocument.elementFromPoint()` + programmatic click dispatch.

**Warning signs:**
- На iOS описания кликабельны, но тап всегда открывает/закрывает header вместо drawer.
- `handleDescriptionClick` никогда не вызывается на iOS.
- В консоли виден `[GestureController] center-tap`, но не `[useDescriptionHighlighting] click`.

**Phase to address:**
Фаза "Описания и Entity Popup" -- непосредственно связана с проблемой 9 (тапы на описания/сущности у краёв).

---

### Pitfall 6: Шапка ридера переполняется на узких экранах из-за фиксированных min-width

**What goes wrong:**
ReaderHeader содержит 7 интерактивных элементов в одной строке: [Back] [TOC] [Info] ... [progress+page] [Entities] [Search] [Settings]. На экранах шириной < 375px (iPhone SE, Android compact) элементы вылезают за экран. Крестик поиска (`SearchPanel`) оказывается за пределами viewport при visible header, так как SearchPanel позиционируется с `top: calc(70px + env(safe-area-inset-top))`.

**Why it happens:**
Каждая кнопка имеет `w-11 h-11` (44px) -- minimum touch target. 7 кнопок + прогресс-бар (`min-w-[100px]`) = 7*44 + 100 = 408px. iPhone SE viewport = 320px. Даже iPhone 14 (390px) будет тесно с gap.

**How to avoid:**
1. Разделить шапку на два ряда: навигация (Back, TOC) сверху, действия (Search, Entities, Settings) снизу.
2. Альтернатива: использовать overflow menu (... кнопка) для редко используемых действий (Info, Search).
3. Прогресс-бар вынести в отдельную строку или в footer.
4. Для SearchPanel: вместо позиционирования под header, встраивать поиск В header (заменяя кнопки на input).
5. Убрать `min-w-[100px]` у прогресса -- использовать `flex-shrink` для адаптивности.

**Warning signs:**
- Horizontal scroll на шапке.
- Кнопки наезжают друг на друга.
- Прогресс-бар обрезается.
- Close-кнопка SearchPanel за правым краем экрана.

**Phase to address:**
Фаза "Шапка и панели" -- может делаться параллельно с навигацией, так как не затрагивает gesture controller.

---

### Pitfall 7: Vaul drawer max-height ограничивает контент, клавиатура сдвигает drawer

**What goes wrong:**
DescriptionDrawer использует `max-h-[60vh]`, что на мобильных с экраном 667px = 400px. За вычетом handle bar (12px + margin) и padding (24px) остаётся ~360px для контента. Длинные описания обрезаются. При открытии TOC drawer с полем ввода заметки (bookmark note), iOS клавиатура (~260px) сдвигает весь viewport вверх, drawer "уезжает" за верхний край.

**Why it happens:**
1. `max-h-[60vh]` -- статическое ограничение, не учитывает реальное содержимое.
2. Vaul использует Visual Viewport API для обработки клавиатуры, но при `max-h-[60vh]` + клавиатура viewport уменьшается, 60vh тоже уменьшается, и drawer "сжимается".
3. Автоматическое фокусирование input полей (search, bookmark notes) при открытии drawer вызывает клавиатуру до завершения анимации открытия drawer.

**How to avoid:**
1. Использовать `max-h-[85vh]` или `max-h-[85dvh]` (dynamic viewport height) для полной высоты.
2. Для drawers с input: задерживать focus на 300ms после анимации открытия.
3. Для TOC/Notes drawer: использовать snap points Vaul (e.g., `snapPoints={[0.5, 0.95]}`), чтобы пользователь мог раскрыть на полный экран.
4. Использовать `dvh` единицы вместо `vh` для правильного расчёта с учётом мобильных браузерных панелей.
5. НЕ использовать `autoFocus` на input-ах внутри drawer -- вызывать focus программно после анимации.

**Warning signs:**
- Длинные описания обрезаны без scroll indicator.
- При фокусе на input drawer "прыгает" или уменьшается.
- Контент за drawer не виден из-за overlay, но drawer не достаточно высок для полного просмотра.

**Phase to address:**
Фаза "Шапка и панели".

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `@ts-expect-error` на iframe custom properties (`__gestureControllerCleanup`) | Быстрый cleanup через custom property на document | Нет type safety, легко забыть cleanup при рефакторе | На текущем этапе -- OK. Заменить на WeakMap при рефакторе gesture controller |
| `eslint-disable @typescript-eslint/no-explicit-any` на `rendition.manager` | Доступ к внутренним API epub.js без типов | Ломается при обновлении epub.js. Нет compile-time проверок | Приемлемо -- epub.js не экспортирует типы для manager. Создать local type declaration |
| `setTimeout(50)` в `useTextSelection` для click dedup | Работает для текущих timing | Race condition на медленных устройствах, ненадёжная деdup | Заменить на proper event ordering (mouseup before click sequence) |
| Два параллельных hook-а: `useFollowFingerSwipe` (dead code) + `useGestureController` | Исторический рефактор -- оба экспортируют утилиты | Путаница, какой hook используется. useFollowFingerSwipe = 609 LOC dead code | Удалить useFollowFingerSwipe, перенести экспортируемые утилиты в отдельный модуль |
| `LONG_PRESS_TIMEOUT = 350ms` как константа | Простота | Не учитывает accessibility settings пользователя (iOS может менять длительность long press) | Временно OK, но в будущем читать из системных настроек если возможно |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| epub.js `hooks.content.register()` | Регистрация hook без проверки уже существующих contents. При hot reload hook регистрируется дважды, events стреляют дважды | Всегда вызывать `deregister` перед `register`. Проверять `existingContents` и очищать предыдущие listeners. Текущий код делает это, но cleanup через custom property ненадёжен |
| epub.js `rendition.on('relocated')` | Слушать relocated для обновления UI без debounce -- relocated стреляет при КАЖДОМ scroll, включая directScroll. Результат: каскад re-renders во время свайпа | Использовать debounce (300ms) или `skipNextRelocated` flag при программной навигации. Текущий `useCFITracking` должен это учитывать |
| epub.js `rendition.getRange(cfiRange)` | Предполагать, что getRange всегда возвращает валидный Range. На практике epub.js anonymous span wrapping сдвигает CFI paths, и getRange возвращает null | Использовать `resolveRangeFallback()` (уже реализован в `useAnnotationRendering`). Всегда проверять результат getRange и иметь fallback через getElementById |
| Vaul Drawer + epub.js iframe | Vaul overlay (`bg-black/40`) ловит все touch events, но click на overlay закрывает drawer. Если пользователь свайпает overlay вниз -- Vaul закрывает drawer. Но свайп также может trigger gesture controller если drawer закрылся mid-gesture | Устанавливать `isPanelOpen = true` пока Vaul анимация закрытия не завершена (использовать `onOpenChange` с debounce) |
| motion/react `animate()` + DOM scroll | `animate()` возвращает AnimationPlaybackControls, `.stop()` останавливает анимацию, но не сбрасывает MotionValue. Если забыть `translateX.set(0)` после stop, следующий свайп начнётся со смещённой позиции | Всегда вызывать `translateX.set(0)` в cleanup и после `stop()`. Текущий код делает это, но в touchcancel handler не проверяет состояние анимации |
| iOS Safari `cursor: pointer` на iframe body | Без `cursor: pointer` iOS Safari не стреляет click events на non-interactive элементах внутри iframe. Текущий код устанавливает это | Не убирать `body.style.cursor = 'pointer'` при рефакторе gesture controller. Это не стилистическое решение, а функциональное для iOS |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| setState в touchmove handler | Каждый touchmove вызывает React re-render. При 60 touch events/sec = 60 re-renders/sec. Jank на mid-range Android | Использовать ТОЛЬКО refs и MotionValue в touchmove. setState допустим только для `phase` и `boundary` (текущий код нарушает: `setShowChapterHint`, `setChapterHintDirection`, `setIsAtBoundary` в touchmove) | На устройствах с < 4GB RAM, сложных компонентах |
| `waitForScrollEnd` с RAF polling | RAF polling каждый frame для проверки scroll position. 500ms timeout, 3-frame stable check. Блокирует следующую навигацию в `scrollChainRef` | Для instant scroll не нужен waitForScrollEnd. Для smooth scroll -- слушать `scrollend` event (поддерживается в Chrome 114+, Safari 17.4+) | При быстром тапе: пользователь ждёт 500ms перед следующим page turn |
| `rendition.getContents()` на каждый тап | `getContents()` может возвращать массив Contents объектов. Итерирование по ним для поиска document стоит N * iframe access | Кэшировать в ref при `hooks.content.register()`, обновлять при смене chapter | При книгах с embedded iframes внутри EPUB |
| CSS box-shadow анимация в FollowFingerContainer | `useMotionValueEvent` обновляет box-shadow на каждый frame через style.boxShadow. box-shadow триггерит paint, не compositing | Заменить box-shadow на pseudo-element с gradient + opacity (GPU-composited). Или использовать `filter: drop-shadow()` | На всех устройствах с GPU compositing -- box-shadow = paint, не composite |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Tap на край экрана перехватывается навигацией, хотя пользователь целился в описание/сущность у края | Пользователь не может кликнуть на подсвеченное слово, если оно находится в крайних 25% (Android) или 15% (iOS) экрана | Приоритизировать interactive elements: если `elementFromPoint` находит description-highlight или entity-mention, обработать как клик по элементу, а не как навигационный тап. Уменьшить edge zone до 15% на всех платформах |
| DescriptionDrawer не показывает кнопку генерации изображения для описаний без image | Пользователь не знает, что можно сгенерировать иллюстрацию. Сейчас кнопка показывается только если `image.status === 'completed'` | Показывать кнопку "Generate image" для всех описаний. Если image ещё нет -- кнопка запускает генерацию. Если image pending -- показать прогресс |
| SearchPanel input focus вызывает клавиатуру, которая перекрывает результаты поиска | На iOS клавиатура занимает ~40% экрана. SearchPanel позиционирован вверху. Результаты поиска могут быть под клавиатурой | Перенести SearchPanel вниз экрана (как в Safari) или использовать Visual Viewport API для корректного позиционирования. Альтернатива: после первого search результата скрыть клавиатуру |
| Center-tap toggles header И проверяет описания одновременно | Если пользователь хочет показать header, но тап попал на описание -- открывается и drawer и header. Двойное действие confusing | Разделить: если найдено описание -- открыть только drawer, НЕ toggle header. Если описания нет -- toggle header |
| Rubber-band свайп при переходе между главами не даёт visual feedback о загрузке | Пользователь свайпает за boundary, видит hint "Следующая глава", отпускает -- ничего не происходит визуально пока глава загружается | Показать loading spinner или skeleton при chapter transition. Добавить haptic feedback (если NAV-v2-02 включён) |

## "Looks Done But Isn't" Checklist

- [ ] **Свайп-навигация:** Работает внутри главы, но НЕ проверено: переход между главами через свайп (rubber-band -> chapter change). Убедиться, что `onChapterChange` корректно вызывает `rendition.next()`/`rendition.prev()` и ждёт завершения.
- [ ] **Text selection:** Работает при первом выделении, но НЕ проверено: расширение выделения через drag handles на iOS. Проверить, что drag handles не перехватываются gesture controller.
- [ ] **Анимация:** Визуально smooth на одном устройстве, но НЕ проверено: performance на mid-range Android (Samsung A-серия, Xiaomi Redmi). Проверить FPS в Chrome DevTools Performance tab.
- [ ] **EntityPopup позиционирование:** Работает в центре экрана, но НЕ проверено: popup для entity у верхнего/нижнего края viewport. Проверить clamping (`Math.max(VIEWPORT_PADDING, top)`).
- [ ] **Шапка на маленьких экранах:** Все кнопки видны на iPhone 14, но НЕ проверено: iPhone SE (320px), Android devices с навигационной панелью (занимает ~48px снизу).
- [ ] **Vaul drawers:** Открываются и закрываются, но НЕ проверено: scroll внутри drawer на длинном контенте + одновременное scroll iframe за drawer (должен быть заблокирован overlay).
- [ ] **Поиск крестик:** Виден при скрытом header, но НЕ проверено: виден ли при показанном header (`top: calc(70px + env(safe-area-inset-top))`). На iPhone с notch safe-area-inset-top = 47px, итого top = 117px.
- [ ] **Dark/Night theme:** Gesture controller и overlays работают в light theme, но НЕ проверено: box-shadow цвет, chapter hint текст, loading spinner видимость в dark/night themes.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Двойная навигация | LOW | Добавить navLock.acquire() перед анимацией, использовать instant scroll. Изменения только в useGestureController + useEpubNavigation |
| Text selection blocked | MEDIUM | Добавить 'selecting' state в FSM, проверка Selection.type. Изменения в useGestureController, тестирование на iOS |
| elementFromPoint offset | LOW | Добавить guard `phase !== 'idle'` в handleCenterTap. Одна строка в EpubReader |
| Дёрганая анимация | MEDIUM | Убрать smooth scroll при свайпе, унифицировать pipeline. Изменения в useEpubNavigation + useGestureController |
| iOS overlay blocking | MEDIUM | Приоритизировать interactive elements в overlay handler ИЛИ удалить overlay. Изменения в useGestureController |
| Шапка переполнена | HIGH | Редизайн header layout. Может затронуть SearchPanel позиционирование. UI/UX решение |
| Vaul max-height + keyboard | LOW | Заменить max-h-[60vh] на max-h-[85dvh], отложить focus. Изменения в DescriptionDrawer + TOC |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Двойная навигация | Phase 1: Навигация и свайпы | Быстрое тапание по краям 20 раз подряд -- currentPage увеличивается строго на +1 каждый раз |
| Дёрганая анимация | Phase 1: Навигация и свайпы | Slow-motion запись на iPhone -- нет визуальных "рывков" между transform и scroll анимациями |
| Свайп между главами | Phase 1: Навигация и свайпы | Rubber-band свайп на последней странице главы -> следующая глава загружается корректно |
| Шапка переполнена | Phase 2: Шапка и панели | Скриншот на iPhone SE (320px viewport) -- все кнопки видны и кликабельны |
| Поиск крестик | Phase 2: Шапка и панели | Открыть поиск при видимом header -- крестик внутри viewport на всех размерах экрана |
| Vaul max-height | Phase 2: Шапка и панели | Длинное описание в DescriptionDrawer скроллится, весь текст доступен |
| Клавиатура + drawer | Phase 2: Шапка и панели | Фокус на input в TOC drawer -- drawer не уезжает за viewport, input виден над клавиатурой |
| Text selection blocked | Phase 3: Выделение текста и заметки | Long press на слове -> выделение -> drag handle -> расширение на iOS Safari |
| elementFromPoint offset | Phase 4: Описания и Entity Popup | Тап на description-highlight при idle FSM -> DescriptionDrawer открывается |
| iOS overlay blocking | Phase 4: Описания и Entity Popup | На iOS тап по описанию в центральной зоне -> открывает drawer, НЕ toggle header |
| Edge tap vs description | Phase 4: Описания и Entity Popup | Описание в крайних 25% экрана кликабельно, открывает drawer |
| Center-tap двойное действие | Phase 4: Описания и Entity Popup | Тап по описанию в центре -> только drawer, без toggle header |

## Sources

- [epub.js Issue #904: Mobile Safari text selection broken](https://github.com/futurepress/epub.js/issues/904) -- drag handle selection bug на iOS
- [epub.js Issue #905: preventDefault on rendition touch event](https://github.com/futurepress/epub.js/issues/905) -- passive listener warning
- [epub.js Issue #910: unhook eventlistener from rendition](https://github.com/futurepress/epub.js/issues/910) -- cleanup hooks
- [epub.js Issue #1067: iFrame moving with page turn](https://github.com/futurepress/epub.js/issues/1067) -- iframe shift при page turn
- [epub.js Tips and Tricks (v0.3)](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)) -- debounce, gesture handling
- [Apple Developer: Safari Touch Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) -- iOS touch model
- [Stop touch events from bubbling in iOS Safari](https://gist.github.com/terrymun/967157a6a328ff17e873b425103dd733) -- iOS event bubbling
- [Vaul: Building a drawer component](https://emilkowal.ski/ui/building-a-drawer-component) -- Visual Viewport API handling
- [MDN: elementFromPoint()](https://developer.mozilla.org/en-US/docs/Web/API/Document/elementFromPoint) -- coordinate system docs
- [Motion docs: React animation](https://motion.dev/docs/react-animation) -- spring physics, useMotionValue
- [Framer Motion vs Motion One: Mobile Performance](https://reactlibraries.com/blog/framer-motion-vs-motion-one-mobile-animation-performance-in-2025) -- GPU acceleration, jank prevention
- Анализ кодовой базы: `useGestureController.ts`, `useFollowFingerSwipe.ts`, `useEpubNavigation.ts`, `useTextSelection.ts`, `EpubReader.tsx`, `FollowFingerContainer.tsx`, `DescriptionDrawer.tsx`, `EntityPopup.tsx`, `ReaderHeader.tsx`, `SearchPanel.tsx`

---
*Pitfalls research for: Стабилизация мобильного ридера fancai v1.2*
*Researched: 2026-03-10*
