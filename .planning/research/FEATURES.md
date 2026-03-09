# Feature Research: Стабилизация мобильного ридера v1.2

**Domain:** Мобильный EPUB-ридер (PWA), навигация, жесты и взаимодействие
**Researched:** 2026-03-10
**Confidence:** HIGH (анализ Apple Books, Kindle, Kobo, Google Play Books + ревью кода fancai v1.1)

## Текущее состояние (после v1.1)

Реализовано и требует полировки:
- Follow-finger свайпы с spring physics (`useFollowFingerSwipe.ts`) -- CSS transform на wrapper div
- FSM gesture controller (`useGestureController.ts`, 863 строки) -- unified: idle -> pending -> swiping | cancelled
- Тап-зоны: 25% iframe edges, 15% iOS overlay, center tap toggle UI
- Auto-hide header (`useAutoHideUI`) -- immersive mode по умолчанию
- Text selection через epub.js `selected` event (`useTextSelection.ts`)
- Selection popup с Copy/Note (`SelectionMenu.tsx`)
- Vaul bottom sheets для TOC, Settings, Entities, BookInfo
- Rubber-band на границах глав с chapter hint
- Navigation lock (ref-based mutex, guaranteed-last pattern)

## Feature Landscape

### Table Stakes (Пользователи ожидают это)

Фичи, которые пользователь считает само собой разумеющимися. Отсутствие = ридер ощущается сломанным.

| Feature | Почему ожидается | Сложность | Зависимости от epub.js | Заметки |
|---------|-----------------|-----------|----------------------|---------|
| **Slide-анимация при свайпе** | Apple Books (iOS 16+), Kindle, Kobo -- slide по умолчанию. Apple даже отказался от curl в пользу slide | LOW | Нет -- CSS transform на wrapper div вне iframe | Реализовано. Spring physics: stiffness 400, damping 40 (critical damping). Нужна полировка timing при tap navigation |
| **Follow-finger tracking** | Палец тянет -- страница следует. Нативный UX. Ни один web-ридер конкурент этого не делает | MEDIUM | Нет -- MotionValue translateX на FollowFingerContainer | Реализовано. Потенциальная проблема: setState в touchmove (setPhase, setIsAtBoundary) может давать рывки на медленных устройствах |
| **Тап-зоны (edge = nav, center = toggle UI)** | Apple Books, Kindle, Kobo, Google Play Books -- единообразный паттерн | LOW | Нет -- обработка touch events в iframe document | Реализовано. Пропорции: 25% edge (iframe), 15% (iOS overlay). Apple Books ~25%, Kindle ~40%, Kobo ~20% |
| **Long press = выделение текста** | Системная конвенция iOS/Android. Все ридеры делегируют long press нативному selection | LOW | epub.js `selected` event для CFI range через iframe | Реализовано. Известный баг: epub.js #904 -- iOS Safari drag handles коллапсируют к 1 символу. Workaround: не мешать нативному selection, что уже делается |
| **Selection popup (Copy / Highlight / Note)** | Apple Books: Copy, Highlight (4 цвета), Note, Translate, Search. Kindle: 4 цвета + Note. Kobo: Highlight + Note + Define | MEDIUM | epub.js `selected` для CFI range | Реализовано: Copy + Note submenu с цветами и стилями. Проблема: popup позиционируется relative to iframe bounds, может обрезаться на краю экрана |
| **Immersive mode (auto-hide toolbar)** | Apple Books, Kindle: при чтении toolbar скрыт. Тап по центру -- показывает/скрывает | LOW | Нет | Реализовано. Header скрыт по умолчанию, spring animation при показе |
| **Rubber-band на границе главы** | iOS-нативное ощущение. Apple Books: пружинный отскок + hint "Следующая глава" | LOW | `getStageInfo()` для определения scrollLeft vs maxScroll | Реализовано. Resistance factor 0.4, max 80px, chapter hint при offset >15px |
| **Блокировка жестов при открытых панелях** | Свайп не должен переключать страницы при открытом оглавлении/настройках | LOW | Нет | Реализовано. `isPanelOpen` check в gesture controller |
| **Свайп отменяется при вертикальном скролле** | Горизонтальный свайп не должен конфликтовать с вертикальной прокруткой | LOW | Нет | Реализовано. `maxVerticalRatio: 2.0` -- если deltaY/deltaX > 2, свайп отменяется |
| **Прогресс чтения (%, страница/всего)** | Все ридеры показывают progress. Apple Books: внизу page number, вверху "X pages left in chapter" | LOW | epub.js locations | Реализовано в ReaderHeader. Показывается при видимом header |
| **Компактная шапка на мобильных** | Кнопки 44px+, без перекрытия, responsive layout. Apple Books: 2 кнопки (back + menu). Kindle: back + search | MEDIUM | Нет | **ПРОБЛЕМА**: 6 кнопок (back, TOC, info, entities, search, settings) + progress bar на 375px экране -- переполнение |
| **Bottom sheet для панелей** | Apple Books, Kindle: настройки в bottom sheet. Drag-to-dismiss, snap points | LOW | Нет | Реализовано через Vaul. Нужны snap points: полная высота для TOC (много контента), частичная для Settings |

### Differentiators (Конкурентное преимущество)

| Feature | Ценность | Сложность | Зависимости от epub.js | Заметки |
|---------|---------|-----------|----------------------|---------|
| **AI-описания с highlight в тексте** | Уникальная фича: подсветка фрагментов + тап открывает drawer с AI-иллюстрацией. Ни у одного конкурента нет | HIGH | `rendition.hooks.content` для инъекции span-ов в iframe DOM | Реализовано. 8 fallback стратегий поиска текста. **Конфликт**: тап на description-highlight вызывает И `onCenterTap` И `onToggleUI` |
| **Entity Wiki со спойлер-защитой** | Интерактивная энциклопедия персонажей без спойлеров. Ближайший аналог -- Kindle X-Ray, но без спойлер-защиты | HIGH | CFI tracking для текущей главы | Реализовано. Fuzzy matching threshold ~0.70-0.75 для русских имён |
| **Follow-finger в web-ридере** | Ни один web-based EPUB ридер (Flow, Thorium Web, Readium Web) не реализовал follow-finger для reflowable EPUB | MEDIUM | Нет | Реализовано -- уникальное преимущество среди web-ридеров |
| **Graduated resume (3 уровня)** | <30s passthrough, 30s-5min soft, >5min full reinit. Ни один web-ридер не делает | LOW | Нет | Реализовано |
| **Haptic feedback при навигации** | Тактильная обратная связь при перелистывании. Kindle Voyage пионерировал. Усиливает native feel | LOW | Нет -- `navigator.vibrate()` | В backlog (NAV-v2-02). iOS: ограничения на programmatic haptics в Safari |
| **Настраиваемые тап-зоны** | KOReader: полная настройка зон. Power-users ценят | MEDIUM | Нет | В backlog (NAV-v2-01) |

### Anti-Features (Часто запрашиваемые, но проблемные)

| Feature | Почему запрашивают | Почему проблемно | Альтернатива |
|---------|-------------------|-----------------|-------------|
| **3D curl-анимация** | Скевоморфизм, "как настоящая книга" | Несовместимо с epub.js reflowable + iframe. Apple контролирует весь стек (Metal/CoreAnimation). Apple сам сделал slide по умолчанию в iOS 16 -- curl стал legacy опцией | Slide с spring physics. Уже реализована, ощущается нативно |
| **Pinch-to-zoom** | "Хочу увеличить мелкий текст" | epub.js не поддерживает zoom. Reflowable + CSS columns ломается. `touch-action: pan-x pan-y` явно блокирует pinch | Настройки размера шрифта (уже есть). Системный zoom accessibility |
| **Drag-to-select (без long press)** | "Выделять как на десктопе" | Невозможно отличить от свайпа навигации. Все мобильные ОС и ридеры используют long press. Это системная конвенция, не наше решение | Long press (нативный) + epub.js `selected` event |
| **Авто-фокус textarea при открытии панели** | "Сразу печатать" | Клавиатура пушит viewport, ломает layout на iOS Safari. VisualViewport API нестабилен | Клавиатура появляется только при явном тапе на поле ввода |
| **Постоянный bottom bar с прогрессом** | "Всегда видеть прогресс как в Kindle" | Уменьшает площадь чтения на 44px+. Конфликтует с immersive mode. Apple Books отказался от постоянного bottom bar в iOS 16 | Минималистичная строка прогресса (2-4px) внизу, или тапабельный номер страницы |
| **Scroll mode (вместо paginated)** | "Удобнее скроллить" | epub.js 0.3.93 -- нестабильный scroll mode: CFI tracking ломается, пагинация непредсказуема. Двойная работа по QA | Оставить paginated. Scroll mode -- отдельный milestone |

## Feature Dependencies

```
[Gesture Controller FSM]
    +--requires--> [Follow-finger swipe] (translateX, spring physics)
    +--requires--> [Tap zone detection] (edge/center classification)
    +--requires--> [Navigation lock] (ref-based mutex, guaranteed-last)
    +--enhances--> [Auto-hide UI] (onSwipeStart, onTapNavigate callbacks)

[Text Selection]
    +--requires--> [epub.js 'selected' event] (CFI range из iframe)
    +--CONFLICTS--> [Gesture Controller] (long press vs pending state)
    +--enhances--> [Selection Menu] (position, text, cfiRange)

[Selection Menu]
    +--requires--> [Text Selection] (selection state)
    +--requires--> [Bookmark Actions] (createBookmark)
    +--CONFLICTS--> [Virtual Keyboard] (iOS viewport resize при note textarea)

[Description Highlighting]
    +--requires--> [rendition.hooks.content] (DOM injection в iframe)
    +--CONFLICTS--> [Gesture Controller center-tap] (тап на highlight = onCenterTap + onToggleUI оба)

[Reader Header]
    +--requires--> [Auto-hide UI] (isHeaderVisible)
    +--enhances--> [Все панели] (кнопки open/close)
    +--CONFLICTS--> [Screen width 375px] (6 кнопок + progress bar не помещаются)

[Bottom Sheet Panels (Vaul)]
    +--requires--> [isPanelOpen] (блокирует gesture controller)
    +--CONFLICTS--> [Virtual Keyboard] (textarea фокус в note submenu)
    +--CONFLICTS--> [Content scroll] (drag на sheet handle vs scroll контента)

[Chapter Boundary Navigation]
    +--requires--> [Rubber-band] (visual feedback, spring back)
    +--requires--> [getStageInfo()] (isAtStart, isAtEnd detection)
    +--requires--> [rendition.next()/prev()] (chapter transition)
```

### Заметки о зависимостях

- **Text Selection CONFLICTS with Gesture Controller**: Когда пользователь делает long press, FSM в состоянии `pending`. Если long press >350ms (LONG_PRESS_TIMEOUT), touchend не обрабатывается как tap -- корректно. НО: drag handles после selection -- это новые touch events, которые gesture controller может перехватить как новый свайп. Текущий guard: `sel.toString().length > 0` в touchstart. Проблема: selection может быть снята к моменту нового touch event. Решение: добавить состояние `selecting` в FSM, которое блокирует все жесты пока selection активен.

- **Description Highlight CONFLICTS with Gesture Controller center-tap**: Тап на `.description-highlight` вызывает handleCenterTap (который ищет description и открывает drawer) И onToggleUI (который toggle header). В EpubReader.tsx onCenterTap и onToggleUI вызываются последовательно в gesture controller. Правильное поведение: если onCenterTap нашёл описание и открыл drawer -- не вызывать onToggleUI. Решение: onCenterTap должен возвращать boolean (handled/not-handled), или использовать callback pattern.

- **Reader Header CONFLICTS with Screen Width**: 6 кнопок (back, TOC, info, entities, search, settings) + progress bar с процентами и страницами. На 375px экране (iPhone SE/13 mini): ~231px на кнопки (6 * 44px = 264px с gap) + ~100px на progress bar = 364px. Без gap не помещается. Apple Books: 2 кнопки вверху (back, reading menu button). Kindle: back + chapter title (truncated) + search. Решение: объединить info + entities + settings в один "..." menu, или вынести search и info в overflow.

- **Virtual Keyboard CONFLICTS with Bottom Sheets**: При открытии SelectionMenu -> Note submenu -> textarea -> focus -> keyboard. На iOS Safari клавиатура пушит viewport вверх, Vaul drawer может сдвинуться за видимую область. VisualViewport API (`useVisualViewportHandler`) уже используется, но поведение нестабильно на старых iOS. Решение: для note input использовать отдельный full-screen modal, а не inline textarea в floating popup.

## Эталонное поведение топ-ридеров

### Apple Books (основной эталон)

| Аспект | Поведение | Статус в fancai |
|--------|----------|----------------|
| Анимация по умолчанию | Slide (с iOS 16). Curl, None -- опциональные | Slide реализован |
| Follow-finger | Да, палец ведёт страницу 1:1 | Реализовано |
| Тап-зоны | Левый/правый ~25%: перелистывание. Центр: toggle Reading Menu | Реализовано (25% iframe, 15% iOS) |
| Reading Menu | Минималистичный. Тап центра показывает: back + "..." (Theme & Settings). Внизу: page number | **Нужна переработка** -- слишком много кнопок |
| Прогресс | Внизу: тапабельный номер страницы. В меню: "X pages left in chapter" вверху | Только в header |
| Выделение текста | Long press -> drag handles -> popup: Copy, Highlight (4 цвета), Note, Translate, Search, Lookup | Частично: Copy + Note |
| Настройки | Bottom sheet из Reading Menu: Font, Size, Theme, Brightness, Page Turn Effect, Scroll, Lock Rotation | Vaul drawer |
| TOC | Full-screen overlay или slide-in panel | Vaul drawer |
| Переход глав | Rubber-band на границе, slide к следующей главе | Реализовано |
| Immersive mode | Toolbar скрыт. Тап центра = показ/скрытие | Реализовано |

### Kindle (альтернативный эталон)

| Аспект | Поведение | Статус в fancai |
|--------|----------|----------------|
| Анимация | Slide (без follow-finger на mobile app). Curl -- опция | fancai лучше (follow-finger) |
| Тап-зоны | ~40% боковые зоны. Центр: показ dual toolbar (top + bottom) | Реализовано с другими пропорциями |
| Top toolbar | Back + Chapter title (truncated) + Search + Bookmark | **Нужна оптимизация** |
| Bottom toolbar | Slider прогресса + Location/Page number + стрелки nav | Нет bottom bar |
| Выделение | Long press -> drag -> inline color picker (4 цвета) + Note | Copy + Note submenu |
| Page Flip | Свайп от нижнего края = preview page без потери позиции | Нет (отложено) |
| X-Ray | Термины/персонажи со ссылками по тексту | Entity Wiki (конкурирует!) |

### Kobo

| Аспект | Поведение | Статус в fancai |
|--------|----------|----------------|
| Тап-зоны | Левый/правый край + центр. Long press на углу = быстрое пролистывание | Тапы -- да. Long press на углу -- нет |
| Выделение | Long press -> drag handles -> Highlight, Add Note, Define, Translate | Частично |
| Reading Menu | Тап центра -> overlay: навигация, настройки, закладки, TOC | Тап центра = header toggle |
| Font size | Pinch-to-zoom маппится на font size | Нет (A+/A- в settings) |

## Конкретные баги и конфликты для v1.2

### 1. Gesture Controller vs Description Highlight Tap

**Проблема**: В `useGestureController.ts` строки 468-476: при center tap вызываются оба `onCenterTapRef.current(viewportX, viewportY)` и `onToggleUIRef.current()`. Если тап попал на description-highlight и открыл drawer, toggle UI всё равно вызовется -- header мигнёт.

**Решение**: `handleCenterTap` в EpubReader.tsx (строки 255-277) должен возвращать Promise<boolean>. В gesture controller: `const handled = await onCenterTapRef.current(x, y); if (!handled) onToggleUIRef.current();`

**Сложность**: LOW. Изменение сигнатуры одного callback.

### 2. Text Selection Drag Handles vs Gesture Controller

**Проблема**: После long press и появления selection, пользователь тянет drag handles для расширения выделения. Эти touch events попадают в gesture controller, который может начать swipe (state: pending -> swiping).

**Текущий guard**: `useGestureController.ts` строка 307-308: `const sel = doc.defaultView?.getSelection?.(); if (sel && sel.toString().length > 0) return;` -- это в touchstart. Но selection может быть пустой если пользователь тянет handle ДО выделения новых символов.

**Решение**: Добавить проверку наличия selection handles. Или: в touchstart проверять `document.getSelection().rangeCount > 0` (наличие range, даже если toString пуст). Или: отслеживать `selectionchange` event и выставлять флаг `isSelecting`.

**Сложность**: MEDIUM. Нужно тестировать на iOS и Android.

### 3. Header Overflow на мобильных (375px)

**Проблема**: ReaderHeader.tsx содержит 6 кнопок (back, TOC, info, entities, search, settings) + progress bar. На iPhone SE (375px): 6 * 44px = 264px кнопок + 100px progress + gaps = не помещается.

**Эталон Apple Books**: 2 кнопки (back + reading menu). Всё остальное -- в reading menu.
**Эталон Kindle**: back + title + search + bookmark. Остальное -- в bottom bar или settings.

**Решение**: Оставить в header: back, TOC, search. Объединить info + entities + settings в "..." overflow menu (Popover). Progress bar вынести в мини-footer или показывать при header visible.

**Сложность**: MEDIUM. Refactoring ReaderHeader + новый overflow menu компонент.

### 4. Slide Animation "Дёрганье" при Tap Navigation

**Проблема**: При тапе на край, gesture controller запускает slide animation (SPRING_FAST) и одновременно вызывает `onEdgeTap -> nextPage() -> rendition.next()`. epub.js перерисовывает iframe синхронно, что вызывает визуальный "дёрг" посередине анимации.

**Решение Apple Books**: Анимация и навигация разделены. Сначала анимация slide-out (текущая страница уезжает), потом мгновенный swap контента, потом нет slide-in (новая страница уже на месте). Или: slide-out текущей + slide-in новой параллельно.

**Текущий подход fancai**: animate translateX to -viewportWidth, onComplete: translateX.set(0). Проблема: epub.js display() может вызваться до завершения animation.

**Решение**: Порядок: (1) запустить slide animation, (2) вызвать navigation только в onComplete callback. Уже частично так (строки 498-511), но onEdgeTap вызывается ВНЕ animation callback (строка 509). Нужно перенести navigation внутрь onComplete.

**Сложность**: LOW-MEDIUM. Рефакторинг порядка вызовов в gesture controller.

### 5. Панели Settings/TOC и авто-клавиатура

**Проблема**: Открытие панели с Vaul может автоматически сфокусировать первый focusable element (input/textarea), что вызовет появление клавиатуры.

**Решение**: Vaul `shouldScaleBackground={false}`, `modal={true}`. Для Vaul drawer: не использовать `autoFocus` на input-ах внутри. Для SearchPanel: фокус на input только при явном открытии search, не при swipe-to-open.

**Сложность**: LOW.

## MVP для v1.2 (Стабилизация)

### P1: Обязательно (ридер ощущается сломанным без этого)

- [ ] **Fix: gesture vs description-highlight tap** -- onCenterTap возвращает boolean, не toggle UI если description открыт
- [ ] **Fix: header overflow мобильных** -- вынести info/entities/settings в overflow menu, оставить back + TOC + search
- [ ] **Fix: text selection drag handles vs swipe** -- проверка rangeCount или selectionchange flag
- [ ] **Fix: панели без авто-клавиатуры** -- отключить autoFocus в Vaul sheets
- [ ] **Fix: slide animation при tap nav** -- navigation внутрь onComplete callback

### P2: Желательно (полировка native feel)

- [ ] **Мини-footer или inline progress** -- постоянная минималистичная строка прогресса (2-4px) или тапабельный page number внизу
- [ ] **Snap points для Vaul panels** -- полная высота для TOC/Bookmarks, частичная для Settings
- [ ] **Улучшение spring config** -- тестирование на реальных устройствах, подбор stiffness/damping для ощущения Apple Books

### P3: Отложить (v2+)

- [ ] **Haptic feedback** -- `navigator.vibrate()`. Просто, но iOS Safari ограничивает
- [ ] **Настраиваемые тап-зоны** -- UI для настройки пропорций зон
- [ ] **Page Flip preview** -- свайп от низа для preview без потери позиции

## Feature Prioritization Matrix

| Feature | Ценность | Стоимость | Приоритет | Фаза |
|---------|---------|-----------|-----------|------|
| Fix: gesture vs description tap | HIGH | LOW | P1 | Ранняя |
| Fix: header overflow | HIGH | MEDIUM | P1 | Ранняя |
| Fix: selection vs swipe | HIGH | MEDIUM | P1 | Средняя |
| Fix: panel auto-keyboard | MEDIUM | LOW | P1 | Ранняя |
| Fix: tap-nav slide дёрганье | MEDIUM | LOW-MEDIUM | P1 | Средняя |
| Мини-footer progress | MEDIUM | LOW | P2 | Поздняя |
| Vaul snap points | MEDIUM | LOW | P2 | Средняя |
| Spring tuning | LOW | LOW | P2 | Поздняя |
| Haptic feedback | LOW | LOW | P3 | v2+ |
| Настраиваемые тап-зоны | LOW | MEDIUM | P3 | v2+ |

**Ключ приоритетов:**
- P1: Must fix -- без этого ридер ощущается сломанным на мобильных
- P2: Should fix -- полировка, усиливает native feel
- P3: Nice to have -- дифференциаторы для будущих версий

## Паттерн разрешения конфликта Gesture vs Text Selection

Сводная таблица подходов из анализа конкурентов:

| Аспект | Apple Books | Kindle | Kobo | fancai (текущий) | fancai (цель v1.2) |
|--------|-------------|--------|------|-----------------|-------------------|
| Дискриминация tap vs swipe | ~10px threshold + время | Мгновенный snap (нет follow-finger) | ~10px threshold | 10px threshold + FSM (pending -> swiping) | Текущий подход корректен |
| Long press timeout | ~350ms | ~500ms | ~400ms | 350ms | Оставить 350ms -- ближе к Apple |
| Selection блокирует swipe? | Да, selection handles получают приоритет | Да, полная блокировка свайпа | Да | Частично -- check sel.toString() в touchstart | Полная блокировка: `selectionchange` event + флаг в FSM |
| Tap на interactive element | Не toggle UI | Открывает element, не toggle | Открывает element | isInteractiveElement() + оба callback | onCenterTap returns boolean, conditional toggle |
| Отмена свайпа при vertical | Да | Нет (нет свайпа) | Да | maxVerticalRatio: 2.0 | Корректно |

## Технические ограничения epub.js (влияние на features)

| Ограничение | Влияние на feature | Workaround в fancai |
|------------|-------------------|---------------------|
| Контент в iframe | Touch events не всплывают. Все handlers через `hooks.content.register()` | Уже реализовано |
| CSS columns для paginated | scroll-snap не работает с CSS transform на iframe | Анимация на wrapper div (FollowFingerContainer), не на iframe |
| iOS Safari selection в iframe | epub.js #904: drag handles коллапсируют | Не мешать нативному selection; проверка `sel.toString()` в touchstart |
| Anonymous span wrapper | epub.js оборачивает body в `<span>`, сдвигая CFI paths | `resolveRangeFallback()` в useAnnotationRendering |
| getContents() timing | Contents может быть пустой при быстрой навигации | Retry с setTimeout, или ждать `rendered` event |
| rendition.display() синхронный reflow | Вызов display() во время animation = визуальный рывок | Вызывать display() только в onComplete animation callback |

## Sources

- Apple Books slide/curl: [MacRumors](https://www.macrumors.com/how-to/re-enable-page-turning-animation-apple-books/), [9to5Mac](https://9to5mac.com/2023/03/01/curl-page-turn-effect-apple-books-is-back/), [TidBITS iOS 16 Books changes](https://tidbits.com/2022/10/03/apples-books-ios-16/)
- Apple Books progress bar: [Apple Community discussions](https://discussions.apple.com/thread/254527336), [Gadget Hacks iOS update](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075/)
- Kobo gestures: [Kobo Help Center](https://help.kobo.com/hc/en-us/articles/360017639973-Use-gestures-on-the-touch-screen), [Kobo Highlight iOS](https://help.kobo.com/hc/en-us/articles/360017708134-Highlight-text-on-the-Kobo-Books-app-for-iOS)
- Kindle page turn: [Good e-Reader](https://goodereader.com/blog/kindle/the-kindle-paperwhite-5-has-a-new-page-turn-animation-system), [Epubor](https://www.epubor.com/kindle-turn-page.html)
- epub.js issues: [#904 iOS text selection](https://github.com/futurepress/epub.js/issues/904), [#46 swipe](https://github.com/futurepress/epub.js/issues/46)
- Bottom sheet UX: [NN/G guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- Spring physics: [Motion docs](https://motion.dev/docs/react-transitions), [Android spring](https://developer.android.com/develop/ui/views/animations/spring-animation)
- Virtual keyboard: [VirtualKeyboard API](https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/)
- Immersive mode: [Android Developers](https://developer.android.com/design/ui/mobile/guides/layout-and-content/immersive-content)
- Thumb zones: [Smashing Magazine](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/)
- Haptic feedback: [Good e-Reader](https://goodereader.com/blog/kindle/why-did-amazon-abandon-haptic-feedback-on-kindle-e-readers)
- Gesture conflict resolution: [ResearchGate Bezel Swipe](https://www.researchgate.net/publication/221518883_Bezel_swipe_conflict-free_scrolling_and_multiple_selection_on_mobile_touch_screen_devices), [Android gesture nav](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav)
- Анализ кода fancai v1.1: useGestureController.ts, useFollowFingerSwipe.ts, useTextSelection.ts, ReaderHeader.tsx, SelectionMenu.tsx, FollowFingerContainer.tsx, EpubReader.tsx

---
*Feature research для: fancai v1.2 Reader Stability & Polish*
*Researched: 2026-03-10*
