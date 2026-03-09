# Project Research Summary

**Project:** fancai v1.2 -- Reader Stability & Polish
**Domain:** Стабилизация мобильного EPUB-ридера (жесты, анимации, панели, выделение текста)
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

fancai v1.2 -- это milestone стабилизации, а не добавления фич. Ридер уже реализовал уникальные для web-based EPUB-ридеров возможности (follow-finger свайпы, spring physics, FSM gesture controller), но v1.1 оставил ряд регрессий: монолитный gesture controller (863 строки) конфликтует с text selection и interactive elements, двойная анимация (CSS smooth scroll + spring transform) вызывает визуальное "дерганье", iOS overlay блокирует описания и сущности в центре экрана, шапка ридера переполняется на узких экранах (<375px). Все проблемы диагностированы до уровня конкретных строк кода.

Ключевая рекомендация: **новые библиотеки не нужны**. Весь текущий стек (motion v12, vaul v1.1.2, нативные Touch Events) достаточен. Проблемы вызваны архитектурными решениями в коде навигации, а не ограничениями библиотек. Центральное изменение -- рефакторинг монолитного FSM в Gesture Arena (паттерн из Flutter): три отдельных handler-а (swipe, tap, interactive passthrough) с арбитром приоритетов. Это устраняет корневую причину большинства конфликтов между жестами, описаниями, сущностями и выделением текста.

Основные риски: (1) удаление iOS overlay может сломать center-tap на iOS Safari -- требует ручного тестирования; (2) переход на instant scroll при свайп-навигации может вызвать визуальный рывок на медленных устройствах; (3) рефакторинг gesture controller затрагивает 863 строки критического кода навигации. Митигация: волновая структура build order (утилиты -> handlers -> arena -> интеграция), каждая волна тестируемая изолированно.

## Key Findings

### Recommended Stack

Никаких изменений стека не требуется. Все проблемы решаемы текущими инструментами. Опциональное обновление motion с 12.31.0 до 12.35.0 (velocity transfer фиксы), но не блокер. Подробности: [STACK.md](STACK.md).

**Core technologies:**
- **motion v12** (анимация) -- useMotionValue + animate() с GPU-ускорением через CSS transforms. Spring physics уже реализованы, нужна настройка параметров для Apple Books-like feel
- **vaul v1.1.2** (панели) -- snap points покрывают все сценарии. Убрать max-h constraints, использовать snap points для управления высотой
- **Нативные Touch Events** (жесты) -- единственный способ работать с epub.js iframe. Gesture библиотеки (@use-gesture, hammer.js) не совместимы с iframe контекстом
- **CSS touch-action / user-select** (конфликты) -- точная настройка по зонам для разрешения конфликта свайп vs выделение

**Категорически не добавлять:** @use-gesture/react (+15KB, не работает с iframe), react-spring (+30KB, дублирует motion), hammer.js (заброшен), StPageFlip (несовместимо с epub.js reflowable).

### Expected Features

Подробности: [FEATURES.md](FEATURES.md).

**Must have (table stakes):**
- Fix: gesture controller vs description-highlight tap -- onCenterTap возвращает boolean, conditional toggle UI
- Fix: header overflow на мобильных -- overflow menu для info/entities/settings, оставить back + TOC + search
- Fix: text selection drag handles vs swайп -- проверка rangeCount + selectionchange flag
- Fix: slide animation при tap nav -- navigation внутрь onComplete, instant scroll вместо smooth
- Fix: панели без авто-клавиатуры -- отключить autoFocus в Vaul sheets

**Should have (competitive):**
- Мини-footer или inline progress bar (2-4px)
- Адаптивные snap points для Vaul panels (полная высота для TOC, частичная для Settings)
- Spring config tuning для Apple Books-like ощущений (stiffness 300, damping 28, mass 0.8)

**Defer (v2+):**
- Haptic feedback (iOS Safari ограничивает)
- Настраиваемые тап-зоны
- Page Flip preview (свайп от низа)
- Scroll mode (epub.js 0.3.93 нестабилен)

### Architecture Approach

Подробности: [ARCHITECTURE.md](ARCHITECTURE.md).

Центральное изменение -- **Layered Gesture Architecture с Gesture Arena**. Вместо одного 863-строчного FSM -- три слоя с приоритетами: Interactive Passthrough (prio 0) > Selection (prio 1) > Swipe (prio 2) > Tap (prio 3). Arena маршрутизирует touch events, каждый handler тестируется изолированно. Добавление нового жеста = новый handler + приоритет, без модификации существующих.

**Major components:**
1. **useGestureArena** (~150 строк) -- арбитр touch events, WeakMap для cleanup вместо @ts-expect-error
2. **useSwipeGesture** (~300 строк) -- follow-finger, velocity, spring animation, rubber-band
3. **useTapGesture** (~150 строк) -- зонирование edge/center, slide animation, conditional center-tap
4. **useInteractivePassthrough** (~80 строк) -- detection описаний/сущностей/ссылок в target chain
5. **gesture-utils.ts** (~170 строк) -- утилиты из useFollowFingerSwipe (spring configs, velocity, rubber-band)

**Ключевые паттерны:**
- **Animate-Then-Navigate**: spring animation маскирует задержку epub.js, directScroll использует `behavior: 'instant'`
- **Conditional Center Tap**: onCenterTap возвращает boolean -- если description найдена, НЕ toggle UI
- **WeakMap cleanup**: вместо @ts-expect-error на iframe document

**Dead code для удаления:** useTouchNavigation.ts (18KB), IOSTapZones.tsx (12.5KB), useFollowFingerSwipe.ts hook (608 строк, утилиты переносятся).

### Critical Pitfalls

Подробности: [PITFALLS.md](PITFALLS.md).

1. **Двойная навигация при свайпе** -- CSS smooth scroll и spring animation работают параллельно, страница перелистывается дважды. Решение: navLock.acquire() ДО начала анимации, instant scroll вместо smooth, подавление relocated event.

2. **Text selection блокируется gesture controller-ом** -- iOS drag handles после выделения генерируют новый touchstart, FSM начинает свайп. Решение: проверка Selection.type + состояние 'selecting' в FSM, или passthrough через Gesture Arena.

3. **elementFromPoint промахивается при активном CSS transform** -- при translateX !== 0 тап по описанию попадает в неверный элемент. Решение: guard `phase !== 'idle'` в handleCenterTap, или компенсация translateX.get().

4. **iOS overlay блокирует все interactive elements в центре** -- прозрачный DIV с z-index:5 перехватывает тапы по описаниям и сущностям. Решение: удалить overlay, использовать contentHook + cursor:pointer на body.

5. **Vaul drawer max-height + клавиатура** -- max-h-[60vh] + iOS клавиатура (~260px) сжимает drawer до нечитаемости. Решение: max-h-[85dvh] + snap points + отложенный focus на 300ms.

## Implications for Roadmap

### Phase 1: Навигация и свайпы
**Rationale:** Все остальные фичи (выделение, popup-ы, панели) зависят от стабильной навигации. Это фундамент.
**Delivers:** Плавная Apple Books-like анимация, стабильные свайпы и тапы, переход между главами.
**Addresses:** Fix slide animation дерганье (P1), fix двойная навигация, gesture-utils.ts extraction, instant scroll pipeline.
**Avoids:** Pitfall 1 (двойная навигация), Pitfall 4 (смешивание smooth scroll и spring).
**Build order:** Волна 1 (gesture-utils, dead code cleanup, instant scroll param) -> Волна 2 (useSwipeGesture, useTapGesture) -> Волна 3 (useGestureArena, координатор).

### Phase 2: Шапка и панели
**Rationale:** Не зависит от gesture controller рефакторинга, может частично параллелиться с Phase 1. Устраняет самые заметные визуальные проблемы.
**Delivers:** Адаптивная шапка на всех экранах (320px-430px+), overflow menu, адаптивные Vaul panels с snap points, fix авто-клавиатуры.
**Addresses:** Fix header overflow (P1), snap points для panels (P2), max-height fix, keyboard fix.
**Avoids:** Pitfall 6 (шапка переполняется), Pitfall 7 (Vaul max-height + keyboard).

### Phase 3: Выделение текста и заметки
**Rationale:** Зависит от стабильного FSM / Gesture Arena из Phase 1. Text selection конфликтует с gesture controller.
**Delivers:** Работающее выделение текста на iOS и Android, drag handles не перехватываются, SelectionMenu без конфликтов.
**Addresses:** Fix text selection vs swipe (P1), Selection.type guard, selectionchange event.
**Avoids:** Pitfall 2 (touchstart блокирует selection), iOS drag handle collapse (epub.js #904).

### Phase 4: Описания и Entity Popup
**Rationale:** Зависит от Gesture Arena (Phase 1) для корректного passthrough interactive elements. Зависит от стабильного translateX (Phase 1) для elementFromPoint.
**Delivers:** Описания и сущности кликабельны в любой зоне экрана, conditional center-tap (drawer без toggle header), корректное позиционирование popup-ов.
**Addresses:** Fix gesture vs description tap (P1), fix тапы у краёв (P1), isInteractiveElement расширение.
**Avoids:** Pitfall 3 (elementFromPoint offset), Pitfall 5 (iOS overlay blocking).

### Phase 5: Полировка и dead code cleanup
**Rationale:** Финальная фаза после стабилизации всех компонентов. Оптимизация и удаление tech debt.
**Delivers:** Spring tuning (Apple Books-like feel), мини-footer progress, удаление dead code (useTouchNavigation, IOSTapZones, useFollowFingerSwipe hook), box-shadow -> gradient optimization.
**Addresses:** Spring config tuning (P2), мини-footer (P2).

### Phase Ordering Rationale

- **Phase 1 первой** -- навигация является фундаментом: все touch events проходят через gesture controller. Без стабильного gesture pipeline нельзя фиксить selection или description clicks.
- **Phase 2 может частично параллелиться с Phase 1** -- шапка и панели не затрагивают gesture controller напрямую. Но Vaul panel open/close взаимодействует с isPanelOpen flag в gesture controller.
- **Phase 3 строго после Phase 1** -- text selection конфликтует с gesture controller FSM, фикс требует стабильной Arena.
- **Phase 4 строго после Phase 1** -- isInteractiveElement passthrough и conditional center-tap реализуются в Arena.
- **Phase 5 последней** -- полировка и cleanup не должны начинаться, пока все функциональные фиксы не стабилизированы.

### Research Flags

Фазы, требующие дополнительного исследования при планировании:
- **Phase 1 (Навигация):** Удаление iOS overlay требует ручного тестирования на iOS Safari. Если center-tap не работает без overlay -- нужен fallback (pointer-events: none + contentHook). Confidence: MEDIUM.
- **Phase 3 (Выделение текста):** iOS-специфичное поведение drag handles плохо документировано. epub.js issue #904 не закрыт. Потребуется экспериментальный подход.

Фазы со стандартными паттернами (не требуют research-phase):
- **Phase 2 (Шапка и панели):** UI-дизайн решения, хорошо задокументированы (Radix Popover/DropdownMenu уже в проекте, Vaul snap points API).
- **Phase 4 (Описания и Entity):** Изменения минимальны -- расширение isInteractiveElement, boolean return из onCenterTap. Архитектура описана до уровня кода.
- **Phase 5 (Полировка):** Удаление dead code и настройка spring параметров -- стандартные задачи.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Полный аудит кодовой базы (15+ файлов, 5000+ строк). Все рекомендации -- "не менять", подтверждено анализом epub.js iframe ограничений |
| Features | HIGH | Анализ Apple Books, Kindle, Kobo, Google Play Books. Feature prioritization привязана к конкретным строкам кода |
| Architecture | HIGH | Gesture Arena паттерн из Flutter, адаптирован под epub.js iframe. Build order с волнами. Код arena приведён полностью |
| Pitfalls | HIGH | 7 pitfalls с root cause analysis до конкретных строк. Recovery strategies с оценкой стоимости |

**Overall confidence:** HIGH

### Gaps to Address

- **iOS overlay удаление**: Уверенность MEDIUM. `body.style.cursor = 'pointer'` должен обеспечить click delegation на iOS, но требует верификации на реальном устройстве. Plan B: overlay с pointer-events: none.
- **Параллельный chapter change**: Вызов `rendition.next()` во время spring animation может создать race condition с touch events. Рекомендуется начать с последовательного подхода (chapter change в onComplete), оптимизировать позже если задержка критична.
- **Performance на mid-range Android**: setState в touchmove (setShowChapterHint, setChapterHintDirection, setIsAtBoundary) может давать рывки на устройствах <4GB RAM. Требует профилирования.
- **box-shadow на FollowFingerContainer**: Триггерит paint вместо compositing. Замена на gradient pseudo-element -- оптимизация для Phase 5, не блокер.
- **2 сломанных теста**: test_langextract_processor.py, test_circuit_breaker.py -- pre-existing, не связаны с v1.2, но могут маскировать регрессии.

## Sources

### Primary (HIGH confidence)
- Аудит кодовой базы fancai: useGestureController.ts (863), useFollowFingerSwipe.ts (609), useEpubNavigation.ts (363), useTextSelection.ts (148), useDescriptionHighlighting.ts (496), useEntityNameHighlighting.ts (197), FollowFingerContainer.tsx (117), ReaderHeader.tsx (145), EpubReader.tsx (750), MobilePanel.tsx (70), DescriptionDrawer.tsx (71)
- [Motion docs](https://motion.dev/docs/react-transitions) -- spring config, useMotionValue, GPU acceleration
- [Vaul docs + issues #575, #579](https://vaul.emilkowal.ski/getting-started) -- snap points, scrollable content, height bugs
- [epub.js issues #904, #905, #910, #1067](https://github.com/futurepress/epub.js/issues) -- iOS selection, touch events, cleanup
- [MDN: Touch Events, touch-action, elementFromPoint](https://developer.mozilla.org/) -- web standards reference

### Secondary (MEDIUM confidence)
- [Flutter Gesture Arena](https://docs.flutter.dev/ui/interactivity/gestures) -- gesture disambiguation pattern
- [Apple interpolatingSpring](https://developer.apple.com/documentation/swiftui/animation/interpolatingspring) -- iOS spring parameters
- [MacRumors, 9to5Mac, TidBITS](https://www.macrumors.com/how-to/re-enable-page-turning-animation-apple-books/) -- Apple Books slide/curl behavior
- [Good e-Reader, Epubor](https://goodereader.com/blog/kindle/) -- Kindle page turn behavior
- [NN/G Bottom Sheet Guidelines](https://www.nngroup.com/articles/bottom-sheet/) -- mobile UX patterns

### Tertiary (LOW confidence)
- Параллельный chapter change с spring animation -- теоретическое предложение, не проверено
- iOS overlay удаление как безопасная операция -- основано на анализе кода, не протестировано на устройстве

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
