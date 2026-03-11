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

# Architecture Research: Gesture Handling и Анимация Ридера v1.2

**Domain:** Мобильный EPUB-ридер -- gesture handling, iframe-интеграция, Apple Books-like анимация
**Researched:** 2026-03-10
**Confidence:** HIGH (полный аудит кодовой базы: 15+ файлов, 5000+ строк gesture/navigation кода)

## Обзор текущей системы

```
                              EpubReader.tsx (координатор, 750 строк)
                                      |
        ┌────────────────────────────┼─────────────────────────────┐
        |                           |                              |
  useGestureController     useTextSelection              useDescriptionHighlighting
  (FSM: idle->pending->    (epub.js 'selected')          useEntityNameHighlighting
   swiping|cancelled)                                    useAnnotationRendering
   863 строки                                                      |
        |                                                         |
        |   ┌──────────────────────────┐                          |
        |   | FollowFingerContainer    |    ┌──────────────────┐  |
        |   | (m.div + translateX +    |    | iOS Overlay      |  |
        |   |  box-shadow + hints)     |    | (center-tap DIV  |  |
        |   |  117 строк               |    |  15%-85% ширины) |  |
        |   └──────────────────────────┘    └──────────────────┘  |
        |                                                         |
        ├── useEpubNavigation (directScroll / rendition.next())   |
        ├── useNavigationLock (ref-based mutex, 2s auto-recovery) |
        └── useAutoHideUI (header show/hide, immersive mode)      |
                                                                  |
                          epub.js iframe                          |
                    ┌────────────────────────┐                    |
                    | rendition.hooks.content |  <── Touch events |
                    | .register(contentHook)  |      привязаны    |
                    | touchstart/move/end     |      через        |
                    | click (desktop)         |      contentHook   |
                    | DOM: description-highlight, entity-mention  |
                    └────────────────────────┘
```

### Ответственности компонентов (текущее состояние)

| Компонент | Ответственность | Строки | Состояние |
|-----------|----------------|--------|-----------|
| `useGestureController` | Единый FSM для touch/click в iframe + iOS overlay | 863 | Монолит, конфликтует |
| `useFollowFingerSwipe` | Утилиты (spring configs, velocity, rubber-band) + неиспользуемый hook | 609 | Hook dead, утилиты live |
| `FollowFingerContainer` | GPU-ускоренный CSS transform wrapper (m.div) | 117 | Работает |
| `useEpubNavigation` | Навигация внутри главы: directScroll + epub.js fallback | 363 | Работает, но smooth scroll конфликтует |
| `useNavigationLock` | Ref-based mutex с 2s auto-recovery | 114 | Работает |
| `useTextSelection` | Обработка выделения текста (epub.js 'selected') | 148 | Работает, но блокируется gesture controller |
| `useDescriptionHighlighting` | Подсветка описаний (8 стратегий поиска) | 496 | Работает, клики перехватываются |
| `useEntityNameHighlighting` | Подсветка имен сущностей (первое вхождение) | 197 | Работает, клики перехватываются |
| `useAnnotationRendering` | Рендер заметок/выделений (DOM span wrapping) | 460+ | Работает |
| `useAutoHideUI` | Управление видимостью шапки (immersive mode) | 111 | Работает |
| `useTouchNavigation` | Tap-навигация в iframe | 18KB | Dead code, не импортируется |
| `IOSTapZones` | DOM overlay для iOS тапов | 12.5KB | Dead code, не импортируется |

## Диагностика проблем

### Проблема 1: Монолитный FSM перегружен

`useGestureController` имеет FSM с 4 состояниями (`idle`, `pending`, `swiping`, `cancelled`), но обрабатывает 5+ типов жестов:

| Жест | Нужная реакция | Текущая обработка | Конфликт |
|------|---------------|-------------------|----------|
| Swipe | Follow-finger + spring animation | `pending` -> `swiping` -> animate | OK |
| Edge tap | Slide animation + navigate | `pending` -> touchend -> tap detection | OK |
| Center tap | Toggle UI ИЛИ open description | `pending` -> touchend -> onCenterTap + onToggleUI | **КОНФЛИКТ**: оба вызываются |
| Long press | Native text selection | `pending` -> touchend -> duration >= 350ms -> return | **КОНФЛИКТ**: gesture controller может заблокировать |
| Description click | Open drawer | isInteractiveElement check в touchend | **КОНФЛИКТ**: не detectится через iOS overlay |
| Entity click | Open popup | Отдельный click handler в useEntityNameHighlighting | **КОНФЛИКТ**: gesture controller touchend мешает |

### Проблема 2: Двойная анимация при tap-навигации

При edge-tap происходит одновременно:
1. **Spring animation** в FollowFingerContainer: `animate(translateX, -viewportWidth, SPRING_FAST)` -- 200-400ms
2. **CSS smooth scroll** в useEpubNavigation: `stage.scrollTo({ behavior: 'smooth' })` -- 300-500ms

Результат: пользователь видит "дёрганое" двойное движение. Контент двигается и через transform, и через scroll одновременно.

### Проблема 3: iOS overlay блокирует interactive elements

iOS overlay (прозрачный DIV, left: 15%, right: 15%) перехватывает все touch events в центральной зоне:
- Клики на `.description-highlight` в центре экрана не работают
- Entity-mention клики в центре не работают
- Text selection (long press) невозможна в центральной зоне

### Проблема 4: onCenterTap + onToggleUI вызываются одновременно

Строки 468-476 в useGestureController:
```typescript
if (action === 'center') {
  onCenterTapRef.current(viewportX, viewportY); // проверяет description
  onToggleUIRef.current();                       // ВСЕГДА toggle-ит UI
  return;
}
```

Если тап попал на описание -- открывается drawer И шапка toggle-ится. Нужно: если description найдена -- НЕ toggle-ить шапку.

### Проблема 5: Нет свайпа между главами

Chapter change через rubber-band работает, но:
- Rubber-band snap-back занимает 200-400ms (SPRING_RUBBER)
- `onChapterChange` вызывается ПОСЛЕ завершения animation
- `rendition.next()`/`rendition.prev()` загружает новую главу -- ещё 100-300ms
- Суммарная задержка 300-700ms -- пользователь уже потерял терпение

## Рекомендуемая архитектура

### Решение: Layered Gesture Architecture с Gesture Arena

Вместо одного FSM -- три слоя с чёткими приоритетами:

```
                    Touch Event (из iframe)
                           |
                    ┌──────┴──────┐
                    | GestureArena |  <-- НОВЫЙ: арбитр жестов
                    | (приоритеты) |
                    └──────┬──────┘
                           |
            ┌──────────────┼──────────────┐
            |              |              |
      ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
      | Interactive|  | Swipe    |  | Tap       |
      | Passthru  |  | Handler  |  | Handler   |
      | (prio 0)  |  | (prio 2) |  | (prio 3)  |
      └────────────┘  └──────────┘  └───────────┘
            |              |              |
      description     FollowFinger    Edge/Center
      entity-mention  Container       tap zones
      links/buttons   spring anim     UI toggle
      text selection
```

**Правило приоритетов (Gesture Arena):**

| Приоритет | Тип | Условие | Действие |
|-----------|-----|---------|----------|
| 0 | Interactive | target = `.description-highlight`, `.entity-mention`, `<a>`, `<button>` | Пропустить к нативной обработке |
| 1 | Selection | long press (>350ms без движения) | Отпустить контроль для native selection |
| 2 | Swipe | горизонтальное движение >10px | Claim arena, begin follow-finger tracking |
| 3 | Tap | touchend без movement (<20px) и без long press | Edge/center tap обработка |

### Новые компоненты

| Компонент | Файл | ~Строки | Роль |
|-----------|------|---------|------|
| `useGestureArena` | `hooks/epub/useGestureArena.ts` | ~150 | Арбитр: маршрутизация touch events по приоритетам, WeakMap для cleanup |
| `useSwipeGesture` | `hooks/epub/useSwipeGesture.ts` | ~300 | Follow-finger tracking, velocity, spring animation, rubber-band, chapter hint |
| `useTapGesture` | `hooks/epub/useTapGesture.ts` | ~150 | Зонирование (edge/center), slide animation, center-tap description detection |
| `useInteractivePassthrough` | `hooks/epub/useInteractivePassthrough.ts` | ~80 | Detection описаний/сущностей/ссылок/кнопок в target chain |
| `gesture-utils.ts` | `hooks/epub/gesture-utils.ts` | ~170 | Утилиты из useFollowFingerSwipe (spring configs, velocity, rubber-band, getStageInfo) |

### Модифицируемые компоненты

| Компонент | Файл | Изменение | Масштаб |
|-----------|------|-----------|---------|
| `useGestureController` | `hooks/epub/useGestureController.ts` | ПЕРЕПИСАТЬ: тонкий координатор (~200 строк вместо 863), делегирует arena | Большой |
| `useEpubNavigation` | `hooks/epub/useEpubNavigation.ts` | МОДИФИЦИРОВАТЬ: публичный параметр `smooth` для directScroll, по умолчанию `false` для tap | Средний |
| `EpubReader.tsx` | `components/Reader/EpubReader.tsx` | МОДИФИЦИРОВАТЬ: onCenterTap возвращает boolean, условный toggleUI | Малый |
| `FollowFingerContainer` | `components/Reader/FollowFingerContainer.tsx` | СОХРАНИТЬ как есть | Нет изменений |
| `useAutoHideUI` | `hooks/reader/useAutoHideUI.ts` | СОХРАНИТЬ как есть | Нет изменений |
| `useTextSelection` | `hooks/epub/useTextSelection.ts` | СОХРАНИТЬ (gesture arena решает конфликт через passthrough) | Нет изменений |
| `useDescriptionHighlighting` | `hooks/epub/useDescriptionHighlighting.ts` | СОХРАНИТЬ (клики работают через arena passthrough) | Нет изменений |
| `useEntityNameHighlighting` | `hooks/epub/useEntityNameHighlighting.ts` | СОХРАНИТЬ (клики работают через arena passthrough) | Нет изменений |

### Удалённый мёртвый код

| Файл | Строки | Статус | Действие |
|------|--------|--------|----------|
| `useFollowFingerSwipe.ts` | 609 | Hook не используется, утилиты экспортируются в useGestureController | ПЕРЕНЕСТИ утилиты в `gesture-utils.ts`, удалить hook |
| `useTouchNavigation.ts` | 18KB | Dead code, не импортируется | УДАЛИТЬ |
| `IOSTapZones.tsx` | 12.5KB | Dead code, экспортируется но не импортируется | УДАЛИТЬ |

## Архитектурные паттерны

### Паттерн 1: Gesture Arena (арбитр жестов)

**Что:** Каждый gesture handler объявляет claim на touch event. Arena определяет победителя по приоритету + текущему состоянию. Вдохновлено Flutter Gesture Arena.

**Когда использовать:** Когда несколько gesture recognizers конкурируют за одни touch events.

**Компромиссы:**
- PRO: Чёткое разделение ответственностей, каждый handler тестируется изолированно
- PRO: Добавление нового жеста = новый handler + приоритет, без изменения существующих
- CON: 4 файла вместо 1, но каждый радикально проще и тестируемее
- CON: Дополнительный уровень абстракции

**Пример:**

```typescript
// useGestureArena.ts
type GestureWinner = 'interactive' | 'selection' | 'swipe' | 'tap' | null;

interface ArenaState {
  state: 'idle' | 'pending' | 'claimed';
  winner: GestureWinner;
  startX: number;
  startY: number;
  startTime: number;
  target: HTMLElement | null;
}

// Cleanup через WeakMap вместо @ts-expect-error на doc
const cleanupMap = new WeakMap<Document, () => void>();

export const useGestureArena = (options: ArenaOptions) => {
  const arenaRef = useRef<ArenaState>(INITIAL);

  const contentHook = (contents: Contents) => {
    const doc = contents.document;
    if (!doc) return;

    const handleTouchStart = (e: TouchEvent) => {
      arenaRef.current = {
        state: 'pending',
        winner: null,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTime: Date.now(),
        target: e.target as HTMLElement,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const arena = arenaRef.current;
      if (arena.state === 'idle') return;

      const deltaX = Math.abs(e.touches[0].clientX - arena.startX);

      // Swipe claims arena при горизонтальном движении >10px
      if (arena.state === 'pending' && deltaX > SWIPE_THRESHOLD) {
        // Priority 0: interactive element -- не claim
        if (options.isInteractive(arena.target)) return;

        arena.state = 'claimed';
        arena.winner = 'swipe';
        options.onSwipeStart(e);
      }

      if (arena.winner === 'swipe') {
        options.onSwipeMove(e);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const arena = arenaRef.current;

      if (arena.winner === 'swipe') {
        options.onSwipeEnd(e);
      } else if (arena.state === 'pending') {
        const duration = Date.now() - arena.startTime;

        // Priority 1: long press -> selection
        if (duration >= LONG_PRESS_TIMEOUT) {
          arenaRef.current = INITIAL;
          return;
        }

        // Priority 0: interactive element -> passthrough
        if (options.isInteractive(arena.target)) {
          arenaRef.current = INITIAL;
          return;
        }

        // Priority 3: tap
        options.onTap(e);
      }

      arenaRef.current = INITIAL;
    };

    doc.addEventListener('touchstart', handleTouchStart, { passive: true });
    doc.addEventListener('touchmove', handleTouchMove, { passive: false });
    doc.addEventListener('touchend', handleTouchEnd, { passive: true });
    doc.addEventListener('touchcancel', () => { arenaRef.current = INITIAL; }, { passive: true });

    // WeakMap cleanup вместо @ts-expect-error
    cleanupMap.set(doc, () => {
      doc.removeEventListener('touchstart', handleTouchStart);
      doc.removeEventListener('touchmove', handleTouchMove);
      doc.removeEventListener('touchend', handleTouchEnd);
    });
  };
};
```

### Паттерн 2: Animate-Then-Navigate (раздельная анимация и навигация)

**Что:** Визуальная анимация запускается ДО фактической навигации. Анимация маскирует задержку epub.js.

**Когда использовать:** Для tap-навигации и завершения swipe.

**Компромиссы:**
- PRO: Мгновенный визуальный feedback, epub.js delay (50-200ms) незаметен
- CON: Теоретический рассинхрон анимации и контента при медленном рендере
- MITIGATION: translateX.set(0) после завершения И анимации, И навигации

**Критическое исправление:** Для tap-навигации `directScroll` должен использовать `behavior: 'instant'`, а не `'smooth'`. Spring animation в FollowFingerContainer обеспечивает визуальный эффект. Две параллельные анимации -- root cause "дёрганого" пролистывания.

```typescript
// Tap-навигация: spring animation + instant scroll
const handleEdgeTap = async (direction: 'next' | 'prev') => {
  // 1. Запустить spring animation (визуальный feedback)
  const target = direction === 'next' ? -viewportWidth : viewportWidth;
  animate(translateX, target, {
    ...SPRING_FAST,
    onComplete: () => {
      translateX.set(0);
      setPhase('idle');
    },
  });

  // 2. Instant scroll (фактическая навигация, без CSS smooth)
  await directScroll(direction, false); // false = instant
};

// Swipe-завершение: spring animation -> onComplete -> instant scroll
const handleSwipeEnd = (direction: 'next' | 'prev', velocity: number) => {
  const target = direction === 'next' ? -viewportWidth : viewportWidth;
  animate(translateX, target, {
    ...getSpringConfig(velocity),
    velocity: velocity * 1000,
    onComplete: async () => {
      translateX.set(0);
      setPhase('idle');
      await directScroll(direction, false); // instant
    },
  });
};
```

### Паттерн 3: Conditional Center Tap (description-aware toggle)

**Что:** `onCenterTap` возвращает boolean: true если description найдена, false если нет. UI toggle вызывается ТОЛЬКО если false.

**Когда использовать:** Всегда -- заменяет текущий unconditional toggle.

**Пример:**

```typescript
// В EpubReader.tsx:
const handleCenterTap = useCallback(
  async (x: number, y: number): Promise<boolean> => {
    if (!rendition) return false;
    try {
      const contents = rendition.getContents();
      if (!contents?.length) return false;
      const doc = contents[0].document;
      let target = doc.elementFromPoint(x, y) as HTMLElement | null;
      while (target && target !== doc.body) {
        if (target.classList?.contains('description-highlight')) {
          const id = target.getAttribute('data-description-id');
          if (id) {
            handleDescriptionClick(id);
            return true; // description найдена, НЕ toggle UI
          }
        }
        target = target.parentElement;
      }
    } catch (err) { logger.error(err); }
    return false; // description не найдена, toggle UI
  },
  [rendition, handleDescriptionClick]
);

// В useTapGesture:
const handleCenterTap = async (x: number, y: number) => {
  const descriptionFound = await onCenterTapRef.current(x, y);
  if (!descriptionFound) {
    onToggleUIRef.current();
  }
};
```

## Data Flow

### Текущий touch event flow (проблемный)

```
iframe touchstart
    ↓
useGestureController.contentHook (монолитный FSM)
    ↓
pending ──────────────────────────────────────┐
    ↓ (>10px horizontal)                     ↓ (touchend без движения)
swiping                                   TAP DETECTION
    ↓                                         ↓
touchmove → translateX.set()             isInteractiveElement(target)?
    ↓                                    YES → return
touchend                                 NO → getTapAction(screenX)
    ↓                                         ↓
shouldNavigate?                          center → onCenterTap(x,y)
YES → spring to edge                          + onToggleUI()    ← ПРОБЛЕМА: оба всегда
    → onComplete: navigate               edge → spring animation
NO → snap back                                + onEdgeTap()
                                              + directScroll(smooth=true) ← ПРОБЛЕМА: двойная анимация

iOS overlay (center 15%-85%):
    touchstart/touchend → onCenterTap(x,y)    ← ПРОБЛЕМА: блокирует description/entity clicks
                       + onToggleUI()
```

### Рекомендуемый touch event flow

```
iframe touchstart
    ↓
GestureArena.handleTouchStart
    ↓ (сохранить start state, арбитр ещё ничего не решает)
pending
    ↓
touchmove
    ↓
GestureArena.handleTouchMove
    ↓
    ├── isInteractive(target)? → skip, не claim (приоритет 0)
    │
    ├── deltaX > 10px? → claim 'swipe'
    │       ↓
    │   SwipeHandler.onStart → setPhase('tracking')
    │       ↓
    │   SwipeHandler.onMove → translateX.set(deltaX)
    │       ↓ (rubber-band на boundary: clamp + resistance)
    │   touchend → SwipeHandler.onEnd
    │       ↓
    │   shouldNavigate? → spring to edge → onComplete: instant directScroll
    │   snap back?      → spring to 0
    │   boundary+enough? → spring to 0 → onComplete: rendition.next()/prev()
    │
    └── deltaX <= 10px? → continue pending
            ↓
        touchend (никто не claim)
            ↓
        GestureArena.handleTouchEnd
            ↓
            ├── duration >= 350ms? → LONG PRESS → return (native selection)
            │
            ├── isInteractive(target)? → return (native click handler)
            │
            └── TAP → TapHandler.handle(screenX, screenY)
                    ↓
                    ├── center zone → onCenterTap(x,y): boolean
                    │       ↓
                    │   true (desc found) → drawer opens (NO toggle UI)
                    │   false             → toggleUI()
                    │
                    └── edge zone → spring animation + instant directScroll
```

### Ключевые изменения в data flow

1. **onCenterTap возвращает boolean** -- если description найдена, НЕ toggle-ить UI
2. **Tap-навигация: instant scroll** -- `directScroll(dir, false)`, spring animation обеспечивает визуал
3. **GestureArena маршрутизирует** вместо монолитного FSM
4. **iOS overlay удалён** -- все touch events через iframe contentHook
5. **WeakMap для cleanup** вместо `@ts-expect-error doc.__gestureControllerCleanup`

## Навигация между главами

### Текущая реализация

Rubber-band на boundary → spring snap-back → `onChapterChange` (в `onComplete`) → `rendition.next()` → новая глава загружается, iframe DOM полностью перезаписывается → `hooks.content.register` вызывает contentHook для нового Contents → touch events привязываются.

**Работает корректно**, но медленно (300-700ms от release до нового контента).

### Рекомендуемая оптимизация

1. **Уменьшить rubber-band spring** для быстрого snap-back: `SPRING_RUBBER` stiffness 200→300, damping 28→34
2. **Chapter change без ожидания snap-back**: вызывать `rendition.next()` параллельно со spring animation, а не в `onComplete`
3. **Preload hint**: при rubber-band >20px offset, начать prefetch следующей главы через `rendition.next()` в фоне (если epub.js поддерживает)

**Confidence: MEDIUM** -- параллельный вызов `rendition.next()` во время animation может вызвать race condition с touch events. Требует тестирования.

## Интеграция с epub.js iframe

### Ключевое ограничение

epub.js рендерит контент в sandboxed iframe. Touch events из iframe НЕ bubble в parent document. Единственный способ перехватить -- `rendition.hooks.content.register(contentHook)`. contentHook вызывается с объектом `Contents` (доступ к `document`, `window` iframe).

### Удаление iOS overlay

**Текущее:** Прозрачный DIV (left: 15%, right: 15%) поверх iframe для center-tap на iOS. Создаётся в `useEffect` при `isIOS()`.

**Проблема:** Блокирует все touch events к iframe в центральной зоне -- description clicks, entity clicks, text selection.

**Решение:** Удалить overlay. Причины:
1. `body.style.cursor = 'pointer'` (строка 299) уже обеспечивает click delegation на iOS
2. Touch events через contentHook уже работают на iOS (tap detection в touchend)
3. Click events в iframe работают на iOS Safari с `cursor: pointer`

**Fallback если center-tap не работает на iOS после удаления:**
- Сделать overlay `pointer-events: none` (пропускает все events к iframe)
- Обрабатывать center-tap исключительно через iframe contentHook

**Confidence: MEDIUM** -- требует тестирования на реальном iOS устройстве.

### Описания и сущности: click handlers

Описания (`useDescriptionHighlighting`) и сущности (`useEntityNameHighlighting`) уже имеют собственные click handlers, привязанные через `rendition.on('click')`. Gesture arena не должна вмешиваться -- `isInteractiveElement` проверка на target обеспечивает passthrough.

**Важно:** `isInteractiveElement` текущая реализация проверяет `description-highlight` и `<a>`, `<button>`. Нужно добавить `entity-mention`:

```typescript
const isInteractiveElement = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.classList?.contains('description-highlight') ||
      target.closest?.('.description-highlight')) return true;
  if (target.classList?.contains('entity-mention') ||
      target.closest?.('.entity-mention')) return true;  // ДОБАВИТЬ
  if (target.tagName === 'A' || target.closest?.('a')) return true;
  if (target.tagName === 'BUTTON' || target.closest?.('button')) return true;
  return false;
};
```

## Порядок сборки (Build Order)

### Волна 1: Утилиты и очистка (нет зависимостей)

| # | Задача | Файл(ы) | Зависимости |
|---|--------|---------|-------------|
| 1.1 | Извлечь утилиты из useFollowFingerSwipe в gesture-utils.ts | `gesture-utils.ts` (НОВЫЙ) | Нет |
| 1.2 | Удалить dead code | `useTouchNavigation.ts` (удалить), `IOSTapZones.tsx` (удалить) | Нет |
| 1.3 | Добавить `entity-mention` в isInteractiveElement | `useGestureController.ts` | Нет |
| 1.4 | Модифицировать useEpubNavigation: публичный параметр smooth | `useEpubNavigation.ts` | Нет |

### Волна 2: Gesture handlers (зависят от gesture-utils)

| # | Задача | Файл(ы) | Зависимости |
|---|--------|---------|-------------|
| 2.1 | Создать useInteractivePassthrough | `useInteractivePassthrough.ts` (НОВЫЙ) | gesture-utils |
| 2.2 | Создать useSwipeGesture | `useSwipeGesture.ts` (НОВЫЙ) | gesture-utils, motion/react |
| 2.3 | Создать useTapGesture | `useTapGesture.ts` (НОВЫЙ) | gesture-utils |

### Волна 3: Arena и координатор (зависят от handlers)

| # | Задача | Файл(ы) | Зависимости |
|---|--------|---------|-------------|
| 3.1 | Создать useGestureArena | `useGestureArena.ts` (НОВЫЙ) | 2.1, 2.2, 2.3 |
| 3.2 | Переписать useGestureController как координатор | `useGestureController.ts` | 3.1 |

### Волна 4: Интеграция (зависят от координатора)

| # | Задача | Файл(ы) | Зависимости |
|---|--------|---------|-------------|
| 4.1 | Обновить EpubReader.tsx: onCenterTap returns boolean | `EpubReader.tsx` | 3.2 |
| 4.2 | Удалить iOS overlay из useGestureController | `useGestureController.ts` | 4.1, тестирование на iOS |
| 4.3 | Tap-навигация: instant scroll вместо smooth | `useEpubNavigation.ts`, `useTapGesture.ts` | 3.2 |

### Волна 5: Полировка (зависят от интеграции)

| # | Задача | Файл(ы) | Зависимости |
|---|--------|---------|-------------|
| 5.1 | Ускорить rubber-band spring для chapter transition | `useSwipeGesture.ts` | 4.1 |
| 5.2 | Удалить useFollowFingerSwipe hook (утилиты уже в gesture-utils) | `useFollowFingerSwipe.ts` | 1.1 |
| 5.3 | Тестирование на iOS: center-tap без overlay | Ручное тестирование | 4.2 |

## Анти-паттерны

### Анти-паттерн 1: Монолитный FSM для разных типов жестов

**Что делают:** Один state machine с 4 состояниями обрабатывает 5+ типов взаимодействий (текущий useGestureController).

**Почему плохо:** Состояние `pending` перегружено -- одновременно ждёт tap, swipe, long press, interactive click. Добавление нового жеста требует модификации всей машины. Конфликты между gesture types проявляются как трудно-воспроизводимые баги (text selection работает на десктопе, ломается на iOS).

**Вместо этого:** Gesture Arena -- каждый тип жеста в своём handler с чётким приоритетом. Arena маршрутизирует. Добавление нового жеста = новый handler + приоритет.

### Анти-паттерн 2: Параллельные CSS smooth scroll и Spring animation

**Что делают:** Tap запускает spring animation (translateX) И CSS smooth scroll (directScroll) одновременно.

**Почему плохо:** Два визуальных эффекта дают "дёрганое" двойное пролистывание. На медленных устройствах CSS smooth scroll отстаёт от spring, создавая "прыжок".

**Вместо этого:** Одна анимация. Spring/translateX -- визуал. directScroll -- `behavior: 'instant'`. Никогда не два параллельных motion.

### Анти-паттерн 3: DOM overlay для gesture interception

**Что делают:** Прозрачный DIV поверх iframe для перехвата тапов (iOS overlay в useGestureController).

**Почему плохо:** Блокирует ВСЕ touch events к iframe в зоне overlay. Каждый новый тип интерактивного элемента требует проброса через overlay.

**Вместо этого:** Все touch events через iframe contentHook. `body.style.cursor = 'pointer'` на iOS обеспечивает click delegation.

### Анти-паттерн 4: @ts-expect-error для cleanup storage

**Что делают:** `doc.__gestureControllerCleanup = () => { ... }` через @ts-expect-error.

**Почему плохо:** TypeScript safety нарушена. При re-register listeners могут дублироваться (старый cleanup не вызван).

**Вместо этого:** `WeakMap<Document, () => void>` для привязки cleanup к document. TypeScript-safe, garbage collected при удалении document.

### Анти-паттерн 5: Unconditional UI toggle при center tap

**Что делают:** `onCenterTap(x,y)` и `onToggleUI()` вызываются всегда, независимо от результата.

**Почему плохо:** Если тап попал на описание -- drawer открывается И шапка toggle-ится.

**Вместо этого:** `onCenterTap` возвращает boolean. Toggle UI только если false (description не найдена).

## Точки интеграции

### Внешние сервисы

| Сервис | Паттерн интеграции | Примечания |
|--------|---------------------|------------|
| epub.js iframe | `rendition.hooks.content.register()` | Единственный способ привязать events; вызывается при каждой смене главы; contentHook получает Contents |
| motion/react | `useMotionValue()`, `animate()` | GPU-ускоренный transform; MotionValue обновляется без React re-render; spring physics |
| epub.js rendition | `.next()`, `.prev()`, `.display()` | Async навигация (50-200ms); вызывает 'rendered'+'relocated'; полная перезагрузка iframe DOM |
| epub.js events | `rendition.on('selected'/'click'/'relocated')` | Click forwarding из iframe; 'selected' для text selection; 'relocated' для CFI tracking |

### Внутренние границы

| Граница | Коммуникация | Примечания |
|---------|--------------|------------|
| GestureArena <-> SwipeHandler | Callback refs (onSwipeStart/Move/End) | Ref-based для zero re-renders на touchmove |
| GestureArena <-> TapHandler | Callback refs (onTap) | Синхронный, после touchend |
| GestureArena <-> InteractivePassthrough | Pure function (isInteractive) | Проверка target chain без side effects |
| SwipeHandler <-> FollowFingerContainer | MotionValue (translateX) | GPU-ускоренный, без re-render |
| SwipeHandler <-> useEpubNavigation | `directScroll(dir, smooth=false)` | Serialized promise chain; instant для tap/swipe |
| TapHandler <-> EpubReader | `onCenterTap(x,y): Promise<boolean>` | ИЗМЕНЕНИЕ: возвращает boolean |
| TapHandler <-> useAutoHideUI | `toggleUI()`, `onTapNavigate()` | Conditional на результат onCenterTap |
| Все handlers <-> useNavigationLock | `acquire()/release()` | Ref-based mutex; 2s auto-recovery |
| useDescriptionHighlighting <-> iframe DOM | `rendition.on('click')` | Независимый click handler; не конфликтует с arena (passthrough) |
| useEntityNameHighlighting <-> iframe DOM | `rendition.on('click')` | Независимый click handler; passthrough через isInteractive |

## Масштабируемость архитектуры

| Аспект | Текущее | С arena | Изменение |
|--------|---------|---------|-----------|
| Добавить новый жест | Модифицировать 863-строчный FSM | Новый handler ~100 строк + приоритет | Радикально проще |
| Тестирование gesture | Тест всего FSM (complex setup) | Тест каждого handler изолированно | Unit tests возможны |
| iOS-специфичные workarounds | Вшиты в FSM + отдельный overlay | Отдельный handler или fallback в arena | Изолированы |
| Количество event listeners на iframe | 5 (touchstart/move/end/cancel, click) | 5 (те же) | Не растёт |
| Re-render на touchmove | 0 (ref-based) | 0 (ref-based) | Сохраняется |

## Источники

- Аудит кодовой базы: `useGestureController.ts` (863 строки), `useFollowFingerSwipe.ts` (609), `useEpubNavigation.ts` (363), `useTextSelection.ts` (148), `useDescriptionHighlighting.ts` (496), `useEntityNameHighlighting.ts` (197), `FollowFingerContainer.tsx` (117), `ReaderHeader.tsx` (145), `EpubReader.tsx` (750), `useAutoHideUI.ts` (111), `useNavigationLock.ts` (114), `reader.ts` store (442)
- [epub.js #904: Mobile Safari text selection](https://github.com/futurepress/epub.js/issues/904) -- текст selection проблемы в iframe
- [epub.js #905: preventDefault on touch event](https://github.com/futurepress/epub.js/issues/905) -- passive event listener warnings
- [Flutter Gesture Arena](https://docs.flutter.dev/ui/interactivity/gestures) -- gesture disambiguation pattern reference
- [Gestures - Material Design](https://m1.material.io/patterns/gestures.html) -- tap vs swipe vs long press disambiguation
- [Motion for React](https://motion.dev/docs/react) -- spring animation API, useMotionValue
- PROJECT.md constraints: epub.js 0.3.93, React 19, motion/react, TypeScript 5.7

---
*Architecture research for: Gesture Handling и Анимация Ридера v1.2*
*Researched: 2026-03-10*

# Stack Research: v1.2 Reader Stability & Polish

**Область:** Стабилизация мобильного EPUB-ридера (анимации, жесты, панели)
**Исследовано:** 2026-03-10
**Уверенность:** ВЫСОКАЯ (основан на анализе 863 строк useGestureController.ts, 608 строк useFollowFingerSwipe.ts, vaul docs, motion docs, epub.js wiki)

## Ключевой вывод

**Новые библиотеки НЕ нужны.** Все проблемы решаемы текущим стеком: `motion` v12 для анимаций, `vaul` v1.1.2 для панелей, нативные touch events для жестов. Проблемы вызваны не ограничениями библиотек, а архитектурными багами в коде навигации и конфликтами touch event handlers.

---

## Текущий стек (без изменений)

### Анимация

| Технология | Версия | Назначение | Статус |
|------------|--------|------------|--------|
| `motion` (ex Framer Motion) | 12.31.0 | Spring-анимации, useMotionValue, GPU-ускорение | Оставить. Последняя стабильная 12.35.0, обновление опционально |

**Почему motion достаточен:**
- `useMotionValue` + `animate()` уже используются для follow-finger и работают на GPU через CSS transforms
- Spring physics с critically-damped конфигами (`SPRING_FAST`, `SPRING_NORMAL`, `SPRING_RUBBER`) уже реализованы в `useFollowFingerSwipe.ts`
- Проблема не в библиотеке, а в логике: дублирование анимации при tap-навигации, отсутствие двухфазной анимации (slide-out -> navigate -> reset), race conditions между tap и swipe

### Панели

| Технология | Версия | Назначение | Статус |
|------------|--------|------------|--------|
| `vaul` | 1.1.2 | Bottom sheet панели (TOC, настройки, заметки) | Оставить. Последняя версия стабильна |

**Почему vaul достаточен:**
- Snap points `[0.5, 0.9]` уже используются в MobilePanel.tsx, но `max-h-[90vh]` на Drawer.Content и `max-h-[60vh]` на DescriptionDrawer ограничивают высоту
- Решается через `snapPoints: [0.6, 1]` (полная высота) + убрать `max-h` constraints
- Известный баг vaul (#579): при snap points высота может рассчитываться некорректно. Workaround: установить высоту Drawer.Content в `h-full` для корректной работы snap point `1`

### Touch Events

| Технология | Версия | Назначение | Статус |
|------------|--------|------------|--------|
| Нативные TouchEvent API | - | Gesture detection в iframe epub.js | Оставить. Нет причин добавлять абстракции |

**Почему НЕ нужна @use-gesture или другая gesture-библиотека:**
- Жесты привязываются к iframe document через `rendition.hooks.content.register()` -- это нестандартный контекст, абстракции не помогут
- `useGestureController.ts` (863 строки) -- зрелая FSM-реализация с 4 состояниями (idle/pending/swiping/cancelled), проблемы не в распознавании жестов, а в конфликтах между обработчиками
- Добавление gesture-библиотеки усложнит отладку iframe-специфичных edge cases без реальной пользы

---

## Рекомендуемый стек (БЕЗ новых зависимостей)

### Core Technologies

| Технология | Версия | Назначение | Почему рекомендуется |
|------------|--------|------------|---------------------|
| `motion` | 12.31.0+ | Анимация свайпов, spring physics | Уже используется. GPU-ускоренные transforms через useMotionValue. Все нужные API (animate, useMotionValue, useMotionValueEvent) уже в проекте |
| `vaul` | 1.1.2 | Адаптивные bottom sheet панели | Уже используется. Snap points покрывают все сценарии |
| Touch Events API (native) | - | FSM gesture controller в iframe | Единственный способ работать с epub.js iframe. rendition.hooks.content.register() для привязки к iframe document |
| CSS `touch-action` | - | Управление нативными жестами браузера | Уже применяется (`pan-x pan-y`), нужна точная настройка по зонам |
| CSS `user-select` | - | Контроль выделения текста | Ключ к разрешению конфликта свайп vs выделение |

### Supporting Libraries (уже в проекте)

| Библиотека | Версия | Назначение | Когда используется |
|------------|--------|------------|-------------------|
| `motion/react` (m, AnimatePresence) | 12.31.0 | UI-анимации (header slide, popup scale) | Для header show/hide, entity popup, модалов |
| `@tanstack/react-virtual` | 3.13.18 | Виртуализация длинных списков | Для TOC > 20 глав в TocSidebar |
| `lucide-react` | 0.563.0 | Иконки UI | Для всех кнопок header и панелей |

---

## Архитектурные решения по каждой проблеме

### Проблема 1: Свайпы дёрганые, дублирование анимации

**Диагноз:** В `useGestureController.ts` строки 488-511 -- при tap на край экрана анимация slide-in (animate() к +-viewportWidth) запускается ПАРАЛЛЕЛЬНО с навигацией epub.js (`onEdgeTapRef.current(action)`). Когда epub.js обновляет DOM iframe (новая страница), CSS transform анимация конфликтует с layout recalculation, вызывая визуальный "дёрг".

**Решение (motion API, без новых библиотек):**

Двухфазная анимация: slide-out текущей страницы -> навигация при скрытом контенте -> мгновенный reset.

```typescript
// БЫЛО (строки 488-511 useGestureController.ts):
// Анимация и навигация параллельно = race condition
animationRef.current = animate(translateX, slideTarget, {
  ...SPRING_FAST,
  onComplete: () => {
    translateX.set(0);
    setPhase('idle');
  },
});
onEdgeTapRef.current(action);  // <-- параллельно!

// РЕКОМЕНДАЦИЯ: последовательная двухфазная
animationRef.current = animate(translateX, slideTarget, {
  ...SPRING_PAGE_TURN,
  onComplete: async () => {
    // Навигация происходит когда страница "за экраном"
    await onNavigateRef.current(direction);
    // Мгновенный reset после навигации
    translateX.set(0);
    setPhase('idle');
  },
});
```

**То же для swipe completion (строки 566-584):** анимация spring к краю -> onComplete -> навигация -> reset. Текущий код уже делает это правильно для свайпов, но для tap-навигации -- нет.

### Проблема 2: Анимация не как в Apple Books

**Диагноз:** Apple Books (режим Slide) использует ~250ms ease-out переход с микро-bounce в конце. Текущий `SPRING_FAST` (stiffness: 400, damping: 40) -- critically damped, ~150ms, без bounce. Слишком резкий.

**Решение -- новая spring конфигурация:**

```typescript
// Apple Books-like: ~250ms, микро-bounce, быстрый старт
export const SPRING_PAGE_TURN = {
  type: 'spring' as const,
  stiffness: 300,     // Мягче SPRING_FAST для плавности
  damping: 28,        // Чуть ниже critical (2*sqrt(300*0.8)=30.98) для микро-bounce
  mass: 0.8,          // Легче для быстрого отклика на жест
};

// Для flick (быстрый свайп) -- сохранить быстрый
export const SPRING_FLICK = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 42,        // Slightly underdamped для energy feel
  mass: 1,
};

// Для rubber-band (граница главы) -- оставить текущий
export const SPRING_RUBBER = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 28,
  mass: 1,
};
```

**Почему эти параметры:** iOS UIView spring с damping ratio ~0.9 (чуть ниже 1.0 = critically damped) дает характерный Apple "feel" -- быстрый приход к target с едва заметным overshoot. В motion это достигается damping чуть ниже `2*sqrt(stiffness*mass)`.

**Источник:** [Apple interpolatingSpring docs](https://developer.apple.com/documentation/swiftui/animation/interpolatingspring), анализ `SPRING_FAST` в useFollowFingerSwipe.ts.

### Проблема 3: Переход между главами не работает

**Диагноз:** В useGestureController.ts строки 533-557 -- при rubber-band на границе главы, chapter change вызывается в onComplete spring-анимации возврата к 0. Но `onChapterChangeRef.current(dir)` вызывает `rendition.next()/prev()`, которые меняют iframe. Если navLock не acquired или promise rejected -- глава не меняется, но визуально rubber-band уже отработал.

**Решение:**

```typescript
// Проблема: shouldTransition проверяется по визуальному offset rubber-band,
// но rubber-band ограничен maxRubberBand (80px),
// а chapterTransitionThreshold = 0.35 * viewportWidth (~131px на 375px экране)
// 80px < 131px --> НИКОГДА не сработает!

// ИСПРАВЛЕНИЕ: снизить chapterTransitionThreshold для rubber-band
export const FOLLOW_FINGER_CONFIG = {
  // ...
  chapterTransitionThreshold: 0.15,  // Было 0.35, при maxRubberBand=80px и 375px viewport:
                                      // 0.15 * 375 = 56px < 80px -- достижимо
  maxRubberBand: 80,                  // Оставить
};
```

### Проблема 4: Выделение текста перехватывается gesture handler

**Диагноз:** `handleTouchStart` в useGestureController.ts (строка 303-341) устанавливает state в `pending` на КАЖДЫЙ touchstart. Затем `handleTouchMove` (строки 344-421) при deltaX > 10px переходит в `swiping` и вызывает `e.preventDefault()`, блокируя нативное выделение текста.

Long-press (350ms) для text selection учтен в handleTouchEnd (строка 448: `if (duration >= LONG_PRESS_TIMEOUT) return`), но проблема в touchmove -- если пользователь чуть двинул палец при long-press (что нормально), gesture controller переходит в swiping и блокирует selection.

**Решение:**

```typescript
const handleTouchMove = (e: TouchEvent) => {
  const t = touchRef.current;
  if (t.state !== 'pending' && t.state !== 'swiping') return;

  const touch = e.touches[0];
  if (!touch) return;

  // НОВОЕ: если прошло больше LONG_PRESS_TIMEOUT с touchstart и
  // мы ещё не в swiping -- это text selection, отменить gesture
  const elapsed = Date.now() - t.startTime;
  if (elapsed > LONG_PRESS_TIMEOUT && t.state === 'pending') {
    touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;  // Дать браузеру обработать как text selection
  }

  // Также: проверить, есть ли уже активное выделение
  const sel = doc.defaultView?.getSelection?.();
  if (sel && !sel.isCollapsed) {
    touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;  // Пользователь выделяет текст
  }

  // ... остальная логика свайпа
};
```

**CSS дополнение для iframe body:**

```css
/* Разрешить нативное выделение текста в iframe */
body {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;  /* Разрешить callout для long-press */
}
```

**Источник:** [MDN Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events), [epub.js issue #904](https://github.com/futurepress/epub.js/issues/904).

### Проблема 5: Тапы на описания/сущности у краёв экрана перехватываются навигацией

**Диагноз:** В useGestureController.ts строки 456-511 -- handleTouchEnd определяет tap zone через `getTapAction(screenX, false)`. Если entity или description highlight находится в крайних 25% экрана (`EDGE_ZONE_IFRAME = 0.25`), то tap интерпретируется как навигация prev/next. Проверка `isInteractiveElement(e.target)` (строка 458) выполняется ДО зонирования, но `isInteractiveElement` проверяет только `.description-highlight`, `<a>`, `<button>` -- НЕ проверяет `.entity-name-highlight` и `[data-entity-id]`.

**Решение:**

```typescript
// Расширить isInteractiveElement:
const isInteractiveElement = useCallback((target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  // Описания
  if (target.classList?.contains('description-highlight') ||
      target.closest?.('.description-highlight')) return true;
  // Сущности (entity name highlighting)
  if (target.classList?.contains('entity-name-highlight') ||
      target.closest?.('.entity-name-highlight') ||
      target.hasAttribute?.('data-entity-id') ||
      target.closest?.('[data-entity-id]')) return true;
  // Стандартные interactive
  if (target.tagName === 'A' || target.closest?.('a')) return true;
  if (target.tagName === 'BUTTON' || target.closest?.('button')) return true;
  return false;
}, []);
```

**Уверенность:** ВЫСОКАЯ -- прямой анализ кода, строки 272-283 useGestureController.ts.

### Проблема 6: Панели ограничены по высоте

**Диагноз:** `MobilePanel.tsx` (строка 48): `max-h-[90vh]` на Drawer.Content. `DescriptionDrawer.tsx` (строка 38): `max-h-[60vh]`. При snap point `0.9` и max-h `90vh` -- корректно, но snap point `1` (fullscreen) невозможен из-за max-h ограничения.

**Решение:**

```typescript
// MobilePanel.tsx: адаптивные snap points + убрать max-h
<Drawer.Content className="bg-background flex flex-col rounded-t-2xl fixed bottom-0 left-0 right-0 z-50">
  {/* Убрать max-h-[90vh], высоту контролируют snap points */}

// Адаптивные snap points по типу контента:
interface MobilePanelProps {
  snapPoints?: (number | string)[];
  // ...
}

// В TocSidebar: snapPoints={[0.6, 1]} -- 60% и fullscreen
// В ReaderControls: snapPoints={[0.5, 0.85]} -- настройки компактнее
// В DescriptionDrawer: snapPoints={[0.4, 0.75]} -- вместо max-h-[60vh]
```

**Для scrollable content внутри drawer (известный баг vaul #575):**

```typescript
// Drawer.Content нужен overflow-hidden на wrapper, overflow-y-auto на content
<Drawer.Content className="...">
  <div className="flex flex-col h-full">
    <div className="flex-shrink-0">{/* handle bar + header */}</div>
    <div className="flex-1 overflow-y-auto pb-safe">{children}</div>
  </div>
</Drawer.Content>
```

**Источник:** [Vaul GitHub #575](https://github.com/emilkowalski/vaul/issues/575), [Vaul GitHub #579](https://github.com/emilkowalski/vaul/issues/579), [Vaul docs](https://vaul.emilkowal.ski/getting-started).

### Проблема 7: Шапка ридера не помещается на мобильных

**Диагноз:** `ReaderHeader.tsx` содержит 7 кнопок в одной строке (Back, TOC, Info + progress bar + Entities, Search, Settings). На экранах < 360px (iPhone SE, Galaxy A Series) элементы не помещаются, прогресс-бар сжимается до нечитаемости.

**Решение (CSS/React, без библиотек):**

Стратегия: вынести Secondary actions в overflow menu.

```
Primary (всегда видны): Back, Progress, Menu (overflow)
Secondary (в overflow menu): TOC, Search, Info, Entities, Settings
```

Overflow menu реализуется через `@radix-ui/react-dropdown-menu` (уже в проекте) или `@radix-ui/react-popover` (уже в проекте).

На breakpoint `sm:` (640px) -- показывать все кнопки напрямую (текущий вид).

**Уверенность:** ВЫСОКАЯ -- это UI-дизайн решение, не зависит от библиотек.

---

## Обновление зависимостей (опционально)

| Пакет | Текущая | Последняя | Нужно ли? | Обоснование |
|-------|---------|-----------|-----------|-------------|
| `motion` | 12.31.0 | 12.35.0 | Опционально | Фиксы velocity transfer в spring (12.34.3), hardware-accelerated scroll (12.34.0). Полезно но не блокер |
| `vaul` | 1.1.2 | 1.1.2 | Нет | Последняя версия уже установлена |
| `epubjs` | 0.3.93 | 0.3.93 | Нет | Последняя версия, не обновляется |

---

## Alternatives Considered

| Рекомендация | Альтернатива | Почему НЕ альтернатива |
|-------------|-------------|----------------------|
| Нативные Touch Events | `@use-gesture/react` | Работа через iframe hooks -- абстракция добавит сложности без выгоды. @use-gesture не привязывается к iframe document. Последний релиз 2+ года назад, не протестирован с React 19 |
| `motion` spring | `react-spring` | Уже используется motion в 40+ файлах, нет причин менять. Два animation runtime = больше bundle, больше когнитивной нагрузки |
| `vaul` | `@radix-ui/react-dialog` | vaul создан для mobile bottom sheets с snap points. Radix dialog -- модальное окно, не drawer |
| CSS `touch-action` | Pointer Events API | touch-action декларативен и работает в iframe. Pointer Events не пробрасываются из epub.js iframe на iOS |
| Двухфазная анимация | Single-pass animation | Двухфазная (slide-out -> navigate -> reset) решает дёргание при DOM update от epub.js |
| Overflow menu в header | Второй ряд кнопок | Overflow menu -- стандартный паттерн мобильных приложений, второй ряд увеличивает высоту header |

## What NOT to Use

| Избегать | Почему | Использовать вместо |
|----------|--------|---------------------|
| `@use-gesture/react` | +15KB, не работает с iframe epub.js, заброшен 2+ года | Нативные TouchEvent + текущий FSM controller |
| `react-spring` | +30KB, дублирование motion, разные API spring physics | `motion` animate() + useMotionValue |
| `hammer.js` | Устаревшая (не обновляется с 2016). Не поддерживает iframe events | Нативные TouchEvent |
| `swiper` | Для карусолей/слайдеров, не для book readers. Конфликтует с epub.js layout | CSS transform через motion |
| `StPageFlip` (3D curl) | Несовместимо с epub.js reflowable + iframe. Из PROJECT.md: "3D curl -- out of scope" | Slide animation (SPRING_PAGE_TURN) |
| `react-spring-bottom-sheet` | Deprecated, последний релиз 3+ года назад. vaul -- его духовный наследник | `vaul` |
| `@xelene/vaul-with-scroll-fix` | Fork vaul с фиксами скролла. Нестабильный, может отстать от upstream | Стандартный vaul + workaround (overflow-y-auto на inner div) |

---

## Совместимость с epub.js iframe (критически важно)

### Архитектурные ограничения:

1. **epub.js рендерит контент в iframe** -- touch events НЕ всплывают из iframe в parent document
2. **Привязка через `rendition.hooks.content.register()`** -- единственный способ получить touch events из iframe
3. **CSS transforms применяются к WRAPPER div** (FollowFingerContainer), НЕ к iframe -- это безопасно для epub.js
4. **Coordinate conversion нужна** -- touch.clientX в iframe !== screen coordinates. Используется `getIframeOffset()` (строка 240 useGestureController.ts)
5. **При смене главы epub.js пересоздаёт iframe** -- все event listeners теряются, hooks.content.register() автоматически вызовется для нового iframe
6. **iOS: тапы из iframe overlay** -- на iOS center-tap через iframe может не работать, поэтому есть iOS overlay (строки 727-810 useGestureController.ts)

### Что это означает для стека:

- Любая gesture library (use-gesture, hammer.js) НЕ может быть просто подключена -- iframe контекст требует специфичной интеграции
- motion MotionValue и animate() работают на parent document уровне, не зависят от iframe -- безопасно для анимации wrapper div
- vaul drawers работают в parent document -- не конфликтуют с iframe

---

## Установка

```bash
# Новые пакеты НЕ нужны. Всё уже установлено.
# Опционально: обновить motion до последней минорной версии
cd frontend && npm update motion
```

---

## Sources

- [Motion docs: React Transitions](https://motion.dev/docs/react-transitions) -- spring конфигурация, анимации (ВЫСОКАЯ уверенность)
- [Motion docs: Motion Values](https://motion.dev/docs/react-motion-value) -- useMotionValue для GPU-ускорения (ВЫСОКАЯ уверенность)
- [Motion changelog](https://motion.dev/changelog) -- v12.31.0 -> 12.35.0 изменения (ВЫСОКАЯ уверенность)
- [Vaul GitHub issues #575](https://github.com/emilkowalski/vaul/issues/575) -- scrollable content в drawer (ВЫСОКАЯ уверенность)
- [Vaul GitHub issues #579](https://github.com/emilkowalski/vaul/issues/579) -- snap points height bug (ВЫСОКАЯ уверенность)
- [Vaul docs: Getting Started](https://vaul.emilkowal.ski/getting-started) -- snap points API (ВЫСОКАЯ уверенность)
- [MDN: touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) -- CSS touch-action reference (ВЫСОКАЯ уверенность)
- [MDN: Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events) -- нативный Touch API (ВЫСОКАЯ уверенность)
- [epub.js Tips and Tricks](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks) -- iframe event handling (ВЫСОКАЯ уверенность)
- [epub.js swipe example](https://github.com/futurepress/epub.js/blob/master/examples/swipe.html) -- official swipe implementation (ВЫСОКАЯ уверенность)
- [epub.js issue #904](https://github.com/futurepress/epub.js/issues/904) -- text selection broken on iOS (ВЫСОКАЯ уверенность)
- [Apple: interpolatingSpring](https://developer.apple.com/documentation/swiftui/animation/interpolatingspring(mass:stiffness:damping:initialvelocity:)) -- iOS spring параметры (ВЫСОКАЯ уверенность)
- [Apple Books re-enable curl animation](https://www.macrumors.com/how-to/re-enable-page-turning-animation-apple-books/) -- Apple Books animation modes: Slide/Curl/None (СРЕДНЯЯ уверенность)
- [We Are Mobile First: Apple Books UI Animations](https://www.wearemobilefirst.com/blog/apple-books-ui-animations-2) -- reverse engineering Apple Books UI (СРЕДНЯЯ уверенность)
- Анализ кодовой базы fancai: `useGestureController.ts` (863 строки), `useFollowFingerSwipe.ts` (608 строк), `FollowFingerContainer.tsx` (117 строк), `MobilePanel.tsx` (70 строк), `ReaderHeader.tsx` (145 строк), `TocSidebar.tsx` (348 строк), `ReaderControls.tsx` (283 строки), `DescriptionDrawer.tsx` (71 строка), `EntityPopup.tsx` (163 строки), `EpubReader.tsx` (750 строк)

---
*Stack research для: v1.2 Reader Stability & Polish*
*Исследовано: 2026-03-10*

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

# Исследование: AI-powered reading/ebook apps (март 2026)

Обзор доступных на рынке приложений для чтения с AI-функциями, включая open-source проекты, коммерческие продукты и ключевых конкурентов fancai.

---

## 1. Прямые конкуренты (читалка + AI glossary/entity tracking)

### 1.1 Book Companion
- **URL**: https://read.crasome.com/
- **Платформы**: Web
- **Тип**: Коммерческий (freemium)
- **Форматы**: EPUB, PDF, FB2
- **AI-фичи**:
  - X-Ray — отслеживание персонажей, локаций, концептов по книге
  - Spoiler-free AI чат — ИИ знает только прочитанные главы
  - Автоматические summaries по главам
  - Многоязычная поддержка (EN, RU, DE, ES, FR)
- **AI-модель**: Anthropic Claude (через API); поддержка BYOK (Bring Your Own Key)
- **Ценообразование**: Первая книга бесплатно, далее ~€3/книга (3 pass за €10 или 5 за €15); BYOK — безлимит
- **Tech stack**: Неизвестен
- **Активность**: Активно развивается (2025-2026)
- **Релевантность для fancai**: **ВЫСОКАЯ** — ближайший конкурент по X-Ray/entity tracking + spoiler-free. Отсутствуют: AI-иллюстрации.

### 1.2 Amazon Kindle X-Ray + Ask This Book + Story So Far
- **URL**: https://www.amazon.com (Kindle app)
- **Платформы**: iOS, Android, Kindle devices (не web)
- **Тип**: Коммерческий (в составе Kindle)
- **AI-фичи**:
  - X-Ray — персонажи, локации, термины с таймлайном появлений
  - Ask This Book (2025) — AI Q&A по книге, якобы spoiler-free
  - Story So Far (анонс 2026) — AI-summary для возврата к чтению
- **AI-модель**: Собственные Amazon модели
- **Ценообразование**: Бесплатно для владельцев Kindle книг
- **Проблемы**: X-Ray может спойлерить (таймлайн-бары); авторы не могут opt-out из AI-фич
- **Релевантность для fancai**: Концептуальный ориентир. X-Ray — эталон функции, но со спойлерами.

### 1.3 Fictionary
- **URL**: https://www.thefictionary.net/
- **Платформы**: Kindle (e-ink + iOS), FBReader, Moon+ Reader (StarDict)
- **Тип**: Бесплатный сервис
- **AI-фичи**:
  - Кастомные словари для вымышленных терминов, персонажей, мест
  - Spoiler-free дизайн — snapshot контента без timeline-данных
  - Альтернатива Amazon X-Ray без спойлеров
- **AI-модель**: Неизвестно (возможно, ручная/полуавтоматическая генерация)
- **Ценообразование**: Бесплатно
- **Релевантность для fancai**: Идейный предшественник spoiler-free glossary. Не web-платформа, не AI-powered в полном смысле.

### 1.4 Merrilin
- **URL**: https://tech.stonecharioteer.com/posts/2026/merrilin/
- **Платформы**: Мобильные (включая e-ink Boox), web неизвестно
- **Тип**: Коммерческий (в разработке, pre-launch)
- **AI-фичи**:
  - Spoiler-free AI-компаньон по книге
  - Поддержка серий книг (вопросы по всей серии)
  - Live sync между устройствами
  - Шаринг цитат
- **AI-модель**: Неизвестна
- **Tech stack**: Неизвестен
- **Статус**: Pre-launch, ограниченный trial через newsletter (март 2026)
- **Релевантность для fancai**: **ВЫСОКАЯ** — прямой конкурент по spoiler-free компаньону. Статус неясен.

### 1.5 No Spoiler AI
- **URL**: https://nospoilerai.com/
- **Платформы**: Web
- **Тип**: Коммерческий
- **AI-фичи**:
  - Отслеживание прогресса чтения
  - Spoiler-free ответы о книге
- **AI-модель**: Неизвестна
- **Tech stack**: Неизвестен
- **Релевантность для fancai**: Нишевый инструмент; не полноценная читалка. Только Q&A без спойлеров.

---

## 2. AI-читалки с чатом/компаньоном (без entity tracking)

### 2.1 BookWith
- **URL**: https://github.com/shutootaki/bookwith
- **Платформы**: Web
- **Тип**: Open source (AGPL-3.0)
- **GitHub Stars**: ~285
- **AI-фичи**:
  - Контекстно-зависимый AI-ассистент чтения (знает содержание книги)
  - AI-подкаст генерация (5-10 мин аудио из секции книги)
  - Мульти-уровневая система памяти (short/mid/long-term)
  - Умные аннотации (5 цветов + Markdown)
  - Семантический поиск cross-book
  - Полная поддержка японского
- **AI-модель**: OpenAI + LangChain
- **Tech stack**: TypeScript 55% + Python 41%, React + FastAPI + Supabase + LangChain + Google TTS
- **Активность**: ~567 коммитов, активен до марта 2025
- **Релевантность для fancai**: **ВЫСОКАЯ** — схожий стек (React + FastAPI). AI podcast и semantic search — уникальные фичи. Нет entity tracking, нет иллюстраций.

### 2.2 Readever (ChatEpub)
- **URL**: https://www.readever.app/
- **Платформы**: Web, Desktop (Mac, Windows)
- **Тип**: Коммерческий (freemium)
- **AI-фичи**:
  - ChatEpub — AI-чат прямо при чтении EPUB
  - AI auto-highlighting ключевых идей
  - Детекция концептов, аргументов, доказательств в реальном времени
  - Перевод и культурный контекст
  - Q&A по книге
- **AI-модель**: Неизвестна
- **Ценообразование**: Free (10 книг), Premium $6.99/мес или $59.99/год; студентам -50%
- **Языки**: EN, CN, JP
- **Релевантность для fancai**: Конкурент по AI-чату при чтении. Нет entity tracking, нет иллюстраций.

### 2.3 Kairos (Every.to)
- **URL**: https://every.to/source-code/a-new-way-to-read
- **Платформы**: iOS только (TestFlight, experimental)
- **Тип**: Коммерческий (proof-of-concept)
- **AI-фичи**:
  - AI-компаньон при чтении (кнопка AI в интерфейсе)
  - Chapter summaries
  - Контекстный чат по книге
  - Catch-up на предыдущие секции
- **AI-модель**: Неизвестна
- **Tech stack**: Неизвестен
- **Статус**: Experimental, iOS-only, не web
- **Релевантность для fancai**: Концептуальный аналог. Не web. Нет entity tracking.

### 2.4 Readwise Reader (Ghostreader)
- **URL**: https://readwise.io/read
- **Платформы**: Web, Desktop, Mobile
- **Тип**: Коммерческий ($8.99/мес)
- **AI-фичи**:
  - Ghostreader — встроенный AI-ассистент
  - Авто-суммаризация документов (GPT-5 Mini)
  - Lookup слов, терминов, персонажей, локаций
  - Кастомные промпты (BYOK для GPT-4.1/o3)
  - Перевод пассажей
  - Для fiction: "Previously on..." recap стиль
  - Для non-fiction: straight summary
- **AI-модель**: GPT-5 Mini (default), GPT-4.1-mini (included), o3 (BYOK)
- **Tech stack**: Неизвестен
- **Ценообразование**: $8.99/мес (включает Readwise + Reader)
- **Релевантность для fancai**: Мощный read-it-later с AI. Не специализирован на fiction entity tracking. Нет иллюстраций. Лучший в классе по AI Q&A.

### 2.5 Myreader.ai
- **URL**: https://www.myreader.ai/
- **Платформы**: Web
- **Тип**: Коммерческий (freemium)
- **AI-фичи**:
  - Чат с одной книгой, коллекцией или всей библиотекой
  - Мульти-документ анализ
  - Суммаризация
  - Text-to-audiobook (50+ голосов, 30+ языков)
  - 16 языков
- **Форматы**: PDF, EPUB, AZW, DOC, PPT
- **AI-модель**: Неизвестна
- **Ценообразование**: Free ($0, 5 запросов/день), Lite ($8/мес, 100/день), Pro ($20/мес, 1000/день)
- **Релевантность для fancai**: Больше research/academic tool. Нет fiction-специфичных фич.

### 2.6 Ivory Mind
- **URL**: https://www.ivorymind.com/
- **Платформы**: Web
- **Тип**: Коммерческий
- **AI-фичи**:
  - Суммаризация книг/глав
  - AI Reader с clickable page references
  - Генерация mind maps, flashcards, presentations
  - 90+ языков
- **Форматы**: EPUB, PDF, DOC, PPT, Kindle и 20+ форматов
- **AI-модель**: Неизвестна
- **Ценообразование**: Free (2 файла), Unlimited $30/мес или $144/год
- **Релевантность для fancai**: Больше productivity tool. Нет fiction-специфичных фич.

---

## 3. Open-source AI book readers (GitHub)

### 3.1 Readest
- **URL**: https://github.com/readest/readest | https://readest.com/ | https://web.readest.com
- **Платформы**: macOS, Windows, Linux, Android, iOS, **Web**
- **Тип**: Open source (GPL-3.0)
- **GitHub Stars**: ~14,500+
- **AI-фичи**:
  - AI-суммаризация книг/глав
  - Встроенный словарь + Wiki lookup
  - Перевод
  - TTS
- **Tech stack**: Next.js 16 + Tauri v2, TypeScript
- **Форматы**: EPUB, MOBI, AZW3, TXT, CBZ, FB2
- **Фичи**: Split-screen, highlights, bookmarks, notes, cloud sync
- **Последнее обновление**: Активен (март 2026)
- **Релевантность для fancai**: Крупнейший open-source reader с базовым AI. Нет entity tracking, нет иллюстраций. Потенциальная база для fork, но другой стек (Next.js/Tauri vs React/Vite).

### 3.2 Anx Reader
- **URL**: https://github.com/Anxcye/anx-reader
- **Платформы**: Android, iOS, Windows, macOS, Linux (beta) — **нет Web**
- **Тип**: Open source (MIT)
- **GitHub Stars**: ~7,700
- **AI-фичи**:
  - AI-суммаризация
  - AI Dictionary + перевод
  - Mind maps генерация
  - Perspective analysis
  - Чат с AI по книге
  - Поддержка провайдеров: OpenAI, Claude, Gemini, DeepSeek
- **Tech stack**: Flutter + foliate-js (гибридная архитектура)
- **Форматы**: EPUB, MOBI, AZW3, FB2, TXT
- **Фичи**: WebDAV sync, heatmaps, TTS, полная книжная translation
- **Последнее обновление**: Март 2026
- **Релевантность для fancai**: Мощный мульти-AI reader, но не web. Хороший пример интеграции нескольких AI-провайдеров.

### 3.3 reader3 (Karpathy)
- **URL**: https://github.com/karpathy/reader3
- **Платформы**: Web (self-hosted)
- **Тип**: Open source (MIT)
- **GitHub Stars**: ~3,300
- **AI-фичи**:
  - Чтение EPUB по главам + copy-paste в любой LLM
  - Не встроенная AI-интеграция, а workflow
- **Tech stack**: Python 61% + HTML 39%, используется `uv`
- **Последнее обновление**: 2025
- **Релевантность для fancai**: Минимальный proof-of-concept от Karpathy. "90% vibe coded". Показывает спрос на LLM+reading, но не конкурент.

### 3.4 epub-ai-reader
- **URL**: https://github.com/alekcangp/epub-ai-reader
- **Платформы**: Web
- **Тип**: Open source (MIT)
- **GitHub Stars**: 1
- **AI-фичи**:
  - **AI Image Generation из текста книги** — уникальная фича!
  - 6 арт-стилей (Cyberpunk, Fantasy, Futuristic, Abstract, Retro Wave, Sci-Fi)
  - Суммаризация текущей страницы/выделенного текста
  - Zora ERC-20 токен minting (blockchain)
- **AI-модели**: Stable Diffusion XL (Cloudflare Workers AI) для изображений; BART (fallback) для текста
- **Tech stack**: Vue 72.7% + TypeScript 16.3%, Vercel deploy
- **Live Demo**: https://epub-ai-reader-multi.vercel.app/
- **Последнее обновление**: Декабрь 2024
- **Релевантность для fancai**: **ВЫСОКАЯ** — единственный найденный open-source reader с AI-иллюстрациями! Но мертвый проект (1 star, 1 contributor). Другой стек (Vue vs React). Blockchain-фича ненужная.

### 3.5 BookWith (см. раздел 2.1)
- Повтор — описан выше. Open source, React + FastAPI.

### 3.6 ReaderPal
- **URL**: https://github.com/khoanguyen-3fc/ReaderPal
- **Платформы**: Web (client-side)
- **Тип**: Open source (MIT)
- **GitHub Stars**: 7
- **AI-фичи**:
  - AI-компаньон при чтении (GPT-3)
  - Client-side, хранит API key в localStorage
- **Tech stack**: HTML (100%), OpenAI API (GPT-3)
- **Статус**: WIP, последний коммит февраль 2024
- **Релевантность для fancai**: Минимальный прототип. Мертвый проект.

### 3.7 Emdash
- **URL**: https://github.com/dmotz/emdash | https://emdash.ai/
- **Платформы**: Web
- **Тип**: Open source
- **GitHub Stars**: ~165
- **AI-фичи**:
  - On-device AI анализ highlights
  - Semantic matching похожих идей между авторами
  - Перефразирование и объяснение через метафоры
  - Импорт из Kindle
- **Tech stack**: Elm
- **Релевантность для fancai**: Не reader, а highlight organizer. Интересный подход к cross-book semantic matching.

### 3.8 KOReader AI Assistant Plugin
- **URL**: https://github.com/omer-faruq/assistant.koplugin
- **Платформы**: KOReader (e-ink readers, Android, Linux)
- **Тип**: Open source
- **GitHub Stars**: ~447
- **AI-фичи**:
  - **X-Ray** — spoiler-free структурированный обзор книги до текущего прогресса
  - **Term X-Ray** — значение слова/фразы по контексту появлений
  - **Recap** — быстрый recap при возврате к книге (>28 часов)
  - **Book Info** — summary, background, author, similar books
  - AI Dictionary с контекстом
  - Gesture-based промпты
  - Поддержка: Claude, GPT-4, Gemini, DeepSeek, Ollama
- **Tech stack**: Lua (KOReader plugin)
- **Последнее обновление**: Март 2026 (активен)
- **Релевантность для fancai**: **ВЫСОКАЯ** — X-Ray + Term X-Ray + Recap — фичи очень близкие к entity system fancai. Но это plugin для e-ink, не web. Хороший источник идей для UX.

---

## 4. AI readers с фокусом на иллюстрации

### 4.1 PPG AI eBook Reader Text2Image
- **URL**: https://play.google.com/store/apps/details?id=com.lb.aibookreader
- **Платформы**: Android только
- **Тип**: Коммерческий
- **AI-фичи**:
  - Long-tap текст → AI-иллюстрация
  - Подключение кастомных AI backends (Ollama, Automatic1111, OpenAI-compatible, TogetherAI)
  - Темы (dark, light, sepia)
  - PIN-защита
- **Форматы**: TXT, PDF, EPUB
- **AI-модель**: Пользовательская (BYOB — Bring Your Own Backend)
- **Релевантность для fancai**: **ВЫСОКАЯ** — ближайший конкурент по AI-иллюстрациям в reader. Но Android-only, не web. Целевая аудитория — romance/fanfiction.

### 4.2 epub-ai-reader (см. раздел 3.4)
- Повтор — единственный web-based reader с AI-иллюстрациями.

---

## 5. LLM-чат для Kindle/e-ink

### 5.1 KindLLM
- **URL**: https://kindllm.app/ | https://github.com/andersrex/kindllm
- **Платформы**: Web (оптимизирован для Kindle browser)
- **Тип**: Open source
- **AI-фичи**: Distraction-free LLM чат на Kindle
- **AI-модель**: Mixtral (Mistral AI)
- **Релевантность для fancai**: Не reader, просто чат. Нишевый.

### 5.2 QuietLLM
- **URL**: https://quietllm.com/
- **Платформы**: Web (e-ink optimized)
- **Тип**: Коммерческий
- **AI-фичи**: ChatGPT для Kindle / e-ink дисплеев
- **Релевантность для fancai**: Не reader, просто чат.

---

## 6. Сводная таблица ключевых конкурентов

| Продукт | Тип | Web | Entity/X-Ray | Spoiler-free | AI Illustrations | AI Chat | Open Source | Stars |
|---------|-----|-----|-------------|-------------|-----------------|---------|-------------|-------|
| **fancai** | — | Yes | Yes | Yes | Yes | Planned | — | — |
| Book Companion | Commercial | Yes | **Yes** | **Yes** | No | **Yes** | No | — |
| Kindle X-Ray | Commercial | No | **Yes** | Partial | No | **Yes** | No | — |
| BookWith | OSS | Yes | No | No | No | **Yes** | **Yes** | 285 |
| Readest | OSS | Yes | No | No | No | Basic | **Yes** | 14.5k |
| Anx Reader | OSS | No | No | No | No | **Yes** | **Yes** | 7.7k |
| Readever | Commercial | Yes | No | No | No | **Yes** | No | — |
| KOReader Plugin | OSS | No | **Yes** | **Yes** | No | **Yes** | **Yes** | 447 |
| PPG Text2Image | Commercial | No | No | No | **Yes** | No | No | — |
| epub-ai-reader | OSS | Yes | No | No | **Yes** | No | **Yes** | 1 |
| Readwise Reader | Commercial | Yes | No | No | No | **Yes** | No | — |
| Merrilin | Commercial | ? | ? | **Yes** | No | **Yes** | No | — |
| Fictionary | Free | No | **Yes** | **Yes** | No | No | No | — |
| No Spoiler AI | Commercial | Yes | No | **Yes** | No | **Yes** | No | — |

---

## 7. Выводы и уникальное позиционирование fancai

### Что уже есть на рынке:
1. **Spoiler-free AI chat** — Book Companion, KOReader plugin, Merrilin, Kindle Ask This Book
2. **Entity/Character tracking (X-Ray)** — Book Companion, Kindle, KOReader plugin, Fictionary
3. **AI-иллюстрации при чтении** — PPG Text2Image (Android), epub-ai-reader (мертвый web проект)
4. **AI-суммаризация** — практически все (Readwise, Readest, Readever, Myreader и т.д.)

### Уникальность fancai:
**fancai — единственное живое web-приложение, совмещающее все три ключевые фичи:**
1. AI entity glossary/wiki со spoiler-free tracking
2. AI-иллюстрации генерация при чтении
3. Web-платформа

Ближайший конкурент **Book Companion** закрывает пункты 1 и 3, но не имеет иллюстраций.
**PPG Text2Image** закрывает пункт 2, но Android-only и без entity tracking.
**epub-ai-reader** закрывал пункты 2 и 3, но мертв (1 star, декабрь 2024).

### Рекомендации:
- Изучить UX Book Companion (X-Ray, pricing model с passes, BYOK)
- Изучить KOReader plugin (X-Ray prompt design, Term X-Ray, Recap feature)
- Изучить BookWith как reference архитектуры (React + FastAPI + LangChain)
- AI-иллюстрации — реальный дифференциатор, конкуренция минимальна на web
- Spoiler-free entity system — конкуренция растет (Book Companion, Merrilin), нужно делать качественнее

---

*Исследование проведено: 10 марта 2026*

# AI-Powered Reading/Ebook Apps Landscape (March 2026)

Research date: 2026-03-10

---

## Executive Summary

The market for AI-powered reading apps is rapidly expanding but remains fragmented. Most apps focus on **TTS (text-to-speech)**, **AI summaries**, and **Q&A chatbots**. Very few apps offer fiction-specific AI features like **character tracking**, **entity glossaries**, **AI illustrations**, or **spoiler-free character wikis**. The fancai project occupies a genuinely unique niche.

### Key findings:
- **No app combines AI illustrations + spoiler-free entity glossary** (fancai's core value proposition)
- Amazon Kindle's "Ask This Book" is the closest competitor for spoiler-free Q&A, but it's a chatbot, not a structured wiki
- Character relationship visualization exists only in standalone web tools (Textify), not in reader apps
- Most AI reading apps are TTS-focused (Speechify, ElevenReader, Readify)
- Open-source options exist (Readest, Anx Reader, Koodo Reader) but with basic AI features
- The fiction-specific AI reading niche is severely underserved

---

## Tier 1: Major Platform Players

### 1. Amazon Kindle — "Ask This Book"
- **URL**: [Kindle iOS App](https://apps.apple.com/us/app/amazon-kindle/id302584613), [Kindle Android](https://play.google.com/store/apps/details?id=com.amazon.kindle)
- **Platforms**: iOS (launched Dec 2025), Android (coming 2026), Kindle devices (coming 2026)
- **AI Features**:
  - "Ask This Book" — in-book AI chatbot for character, plot, and theme questions
  - **Spoiler-free** — only reveals information up to current reading position
  - Highlight text and ask AI to explain selected passages
  - Available on thousands of English best-selling titles
- **How it works**: Uses book content as prompt context; Amazon states content is not retained or used to train models. Specific model not disclosed (likely Amazon Nova or Bedrock-hosted model)
- **Pricing**: Free with purchased/borrowed books
- **Ratings**: Kindle app: 4.5+ stars, 1M+ ratings on both stores
- **Activity**: Actively rolling out (Dec 2025 - 2026)
- **Key limitation**: Chatbot-only (no structured wiki/glossary), no character tracking, no illustrations, authors cannot opt out

### 2. Google Play Books — "Ask Gemini" (Upcoming)
- **URL**: [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)
- **Platforms**: Android (upcoming), possibly iOS
- **AI Features** (not yet live, found in APK teardown):
  - "Ask Gemini" button in text selection menu
  - Contextual Q&A about selected passages
  - Summaries and explanations of complex text
  - Historical context for narratives
  - AI-generated book summaries already available
  - AI-narrated audiobooks
- **How it works**: Integrates Google Gemini model directly into reading flow
- **Pricing**: Free with purchased books
- **Activity**: Found in beta v2025.11.29.2, not yet live
- **Key limitation**: General-purpose Q&A, not fiction-specific

### 3. Apple Books
- **URL**: [Apple Books](https://apps.apple.com/us/app/apple-books/id364709193)
- **Platforms**: iOS, iPadOS, macOS
- **AI Features**:
  - AI-narrated audiobooks (publisher opt-in, launched 2023)
  - AI-based book recommendations
  - No in-book AI assistant or Q&A
- **How it works**: AI narration uses Apple's speech synthesis models
- **Pricing**: Books purchased individually
- **Activity**: Active but AI features are minimal
- **Key limitation**: No in-book AI features for fiction comprehension

### 4. Audible (Amazon)
- **URL**: [Audible](https://www.audible.com)
- **Platforms**: iOS, Android, Web
- **AI Features**:
  - AI narration production (100+ AI voices, English/French/Spanish/Italian)
  - AI translation (speech-to-speech preserving original narrator voice)
  - Maven — AI-powered semantic search for audiobook discovery
  - Personalized collections via AI
- **How it works**: End-to-end AI production pipeline; speech-to-speech translation preserves voice
- **Pricing**: Subscription ($14.95/mo)
- **Activity**: Actively expanding AI catalog (May 2025+)
- **Key limitation**: Audiobook-only, no reading features, no character tracking

---

## Tier 2: AI-Native Reading Apps

### 5. Speechify
- **URL**: [speechify.com](https://speechify.com), [iOS](https://apps.apple.com/us/app/speechify-voice-ai-assistant/id1209815023), [Android](https://play.google.com/store/apps/details?id=com.cliffweitzman.speechify2)
- **Platforms**: iOS, Android, Web, Mac, Chrome Extension
- **AI Features**:
  - AI text-to-speech: 200+ lifelike voices, 60+ languages, up to 4.5x speed
  - AI Voice Assistant: ask questions about content ("What are the main takeaways?", "Quiz me")
  - AI Podcasts: converts articles/documents into podcast-style audio
  - Voice Typing: dictation with auto grammar correction
  - AI meeting transcription and summarization (2026)
- **How it works**: Proprietary TTS models, LLM-powered Q&A
- **Pricing**: Freemium, Premium ~$139/year
- **Downloads**: 50M+ users total, ~500K downloads/month
- **Ratings**: 4.0 stars (Google Play), 4.7 (App Store), 1M+ 5-star reviews claimed
- **Activity**: Very active, major 2026 updates
- **Key limitation**: TTS/productivity-focused, not a fiction reader

### 6. ElevenReader (ElevenLabs)
- **URL**: [elevenreader.io](https://elevenreader.io), [iOS](https://apps.apple.com/us/app/elevenreader-read-text-aloud/id6479373050), [Android](https://play.google.com/store/apps/details?id=io.elevenlabs.readerapp)
- **Platforms**: iOS, Android
- **AI Features**:
  - AI TTS with 10,000+ voices (including celebrity voices: Judy Garland, James Dean, etc.)
  - Voice cloning (clone your own voice in seconds)
  - 30+ language support with natural-sounding local voices
  - Audiobook publishing platform for authors
  - Fan fiction / romance / thriller content library
  - Text highlighting synchronized with audio
- **How it works**: ElevenLabs neural voice technology
- **Pricing**: Free (ad-supported), Premium plans available
- **Activity**: Very active (major AI voice company)
- **Key limitation**: TTS-only, no comprehension or character features

### 7. Readify
- **URL**: [readifyai.com](https://readifyai.com), [iOS](https://apps.apple.com/us/app/readify-ai-natural-read-aloud/id6743287753), [Android](https://play.google.com/store/apps/details?id=com.readin.app)
- **Platforms**: iOS, Android, Web, Chrome Extension
- **AI Features**:
  - AI TTS with LLM-powered narration, 100+ voices, 40+ languages
  - AI Book Search: enter mood/interests, get personalized recommendations
  - AI Q&A: ask questions while reading, get explanations and insights
  - Cross-device sync
- **Formats**: PDF, EPUB, TXT, MOBI, AZW
- **Pricing**: Completely FREE (no subscriptions, no limitations)
- **Activity**: Active (launched late 2025)
- **Key limitation**: Light on fiction-specific features

### 8. BookRead: AI Reader & Insights
- **URL**: [iOS](https://apps.apple.com/ca/app/bookread-ai-reader-insights/id6737578649)
- **Platforms**: iOS only (requires iOS 17.6+)
- **AI Features**:
  - AI Text Explanation: select text, get contextual explanation considering author/book/preceding text
  - Chapter summaries (auto-generated)
  - Auto-generated flashcards for retention
  - AI translation
  - Reading analytics with daily goals and yearly progress
  - Infinite scroll reading interface
- **Pricing**: Freemium, Premium $14.99/month
- **Activity**: Active
- **Key limitation**: iOS-only, no character tracking, no illustrations

### 9. 2Read: AI Kindle Reading Buddy
- **URL**: [iOS](https://apps.apple.com/us/app/2read-ai-kindle-reading-buddy/id6480341554), [Android](https://play.google.com/store/apps/details?id=com.randomoranges.highlights)
- **Platforms**: iOS, Android
- **AI Features**:
  - WordWise: context-aware definitions and explanations
  - AI Highlight Insights: deeper explanations for key passages
  - AI Summary: general or topic-specific summaries
  - Kindle highlight sync
  - Daily review prompts (spaced repetition)
  - Bookshots: pre-made summaries of popular books
  - PDF to Kindle conversion
- **Pricing**: Core features free; advanced AI uses credit system (pay-as-you-go)
- **Activity**: Active
- **Key limitation**: Companion app (not a standalone reader), no fiction-specific features

### 10. easyreads
- **URL**: [easyreads.ai](https://easyreads.ai), [iOS](https://apps.apple.com/us/app/easyread-your-ai-epub-reader/id6745745088)
- **Platforms**: iOS, Web
- **AI Features**:
  - AI narration with natural voices, adjustable up to 4x speed
  - Word-by-word highlighting during audio playback
  - AI Chat: ask questions, get explanations, summaries, and insights about content
  - RSVP speed reading mode (150-600+ WPM)
  - Cross-device sync
- **Formats**: EPUB, PDF, web articles, Twitter threads
- **Pricing**: Freemium
- **Activity**: Active (2026)
- **Key limitation**: No fiction-specific features, limited platform support

### 11. MyReader AI
- **URL**: [myreader.ai](https://www.myreader.ai)
- **Platforms**: Web (primarily)
- **AI Features**:
  - AI Q&A on uploaded documents
  - Library-wide search (chat with entire document library)
  - Page-specific navigation to answers
  - TTS in 50+ voices, 30+ languages
  - Multi-format support (PDF, EPUB, Kindle, Word, YouTube, web articles)
- **Pricing**: Free ($0, 5 daily queries) / Lite ($8/mo, 100 queries) / Pro ($20/mo, 1000 queries)
- **Users**: 100,000+
- **Activity**: Active
- **Key limitation**: Web-only, document-focused not fiction-focused

### 12. Books Aloud AI Reader
- **URL**: [iOS](https://apps.apple.com/us/app/books-aloud-ai-reader/id6473523196)
- **Platforms**: iOS only
- **AI Features**:
  - AI TTS with realistic pronunciation
  - Kindle library sync
  - Scan-and-read: camera OCR for printed text
  - Multi-format support (PDF, EPUB, DOCX, FB2)
- **Pricing**: Free download; Full Access $8.99-$44.99; Unlimited weekly $5.99
- **Activity**: Active
- **Key limitation**: TTS-focused, iOS-only

---

## Tier 3: Social/Discovery Reading Apps with AI

### 13. Inkitt / Galatea
- **URL**: [inkitt.com](https://www.inkitt.com), [Galatea iOS](https://apps.apple.com/us/app/galatea-books-audiobooks/id1380362212), [Galatea Android](https://play.google.com/store/apps/details?id=com.colt)
- **Platforms**: iOS, Android, Web
- **AI Features (Backend)**:
  - ML-powered content discovery: predicts bestsellers from reader behavior data
  - AI-assisted editing of stories
  - AI-generated A/B testing of plot rewrites
  - AI-ghostwritten sequels
  - AI-generated covers, audiobooks, translations
  - Future: AI-personalized fiction versions per reader
- **Pricing**: Galatea subscription-based
- **Downloads**: 5M+ (Galatea on Google Play), 9.8M total
- **Ratings**: 4.57/5 (550K ratings)
- **Funding**: $37M raised (Feb 2024)
- **Activity**: Very active
- **Key limitation**: AI is behind the scenes (publishing pipeline), not reader-facing features; genre fiction (romance) focused

### 14. The StoryGraph
- **URL**: [thestorygraph.com](https://www.thestorygraph.com), [iOS](https://apps.apple.com/us/app/storygraph-reading-tracker/id1570489264), [Android](https://play.google.com/store/apps/details?id=com.thestorygraph.thestorygraph)
- **Platforms**: iOS, Android, Web
- **AI Features**:
  - ML-powered book recommendation engine (mood, pace, character-vs-plot preference)
  - Mood-based book discovery
  - Reading analytics with charts/graphs
  - Spoiler-safe live reactions tied to specific pages
  - Buddy reads with page-gated comments
- **Pricing**: Free / Plus ($4.99/month)
- **Activity**: Active, growing alternative to Goodreads
- **Key limitation**: Book tracking/social, not an ebook reader, AI is recommendation-only

### 15. Fable
- **URL**: [fable.co](https://fable.co), [iOS](https://apps.apple.com/us/app/fable-track-discuss-books/id1488170618), [Android](https://play.google.com/store/apps/details?id=co.fable.fable)
- **Platforms**: iOS, Android
- **AI Features**:
  - AI-powered "For You" feed with personalized book recommendations
  - Previously had AI-generated reader summaries (disabled Jan 2025 due to controversy — generated offensive content)
  - Built-in ebook reader with social annotations
  - Book clubs with BookTokkers, authors, celebrities
- **Pricing**: Free
- **Activity**: Active but AI features reduced after controversy
- **Key limitation**: Social platform first, AI features pulled back

### 16. Kairos (by Every.to)
- **URL**: [every.to article](https://every.to/source-code/a-new-way-to-read)
- **Platforms**: iOS (App Store)
- **AI Features**:
  - AI reading companion (like "a knowledgeable friend reading alongside you")
  - Chapter-by-chapter summaries
  - AI Q&A about book content with full chapter context
  - Thought-provoking questions from AI
  - Interface similar to Apple Books with discrete AI button
- **Pricing**: Unknown (likely free)
- **Activity**: DEAD — launched Feb 2025, 1000 downloads on day one, "ghost town by day three"
- **Key limitation**: Failed launch, apparently abandoned

---

## Tier 4: Open-Source Readers with AI Features

### 17. Readest
- **URL**: [readest.com](https://readest.com), [GitHub](https://github.com/readest/readest)
- **Platforms**: macOS, Windows, Linux, Android, iOS, Web, PWA
- **GitHub Stars**: 18.6K
- **License**: AGPL-3.0
- **Tech Stack**: Next.js 16, React 19, Tauri v2, Rust backend, TypeScript, daisyUI/Tailwind CSS, foliate-js, PDF.js
- **AI Features**:
  - AI-powered TTS (multilingual narration)
  - AI book/chapter summaries (in development)
  - DeepL + Yandex translation integration
  - Dictionary/Wikipedia lookups
- **Other Features**: Split-screen reading, highlights/bookmarks/notes, full-text search, cloud sync
- **Pricing**: Free, open-source
- **Activity**: Very active (18.6K stars, 119 open issues, monthly commits)
- **Key limitation**: AI features are basic (TTS + summary), no character tracking or fiction-specific AI

### 18. Anx Reader
- **URL**: [anx.anxcye.com](https://anx.anxcye.com), [GitHub](https://github.com/Anxcye/anx-reader)
- **Platforms**: Android (F-Droid + GitHub), iOS (App Store), Windows, macOS, Linux (beta)
- **GitHub Stars**: 7.8K
- **License**: MIT
- **Tech Stack**: Flutter/Dart (92.3%), foliate-js for ebook rendering, C++, Swift
- **AI Features**:
  - AI integration via OpenAI, Claude, Gemini, DeepSeek APIs
  - AI-generated mind maps for book structure
  - AI dictionary and translation
  - AI perspective analysis and summaries
  - AI shelf organization by progress and tone
  - Multi-voice TTS with speed/tone/sleep timer
  - Full-book translation with side-by-side view
- **Other Features**: WebDAV sync, reading analytics/heatmaps, extensive customization
- **Formats**: EPUB, MOBI, AZW3, FB2, TXT, PDF
- **Pricing**: Free, open-source
- **Activity**: Very active (v1.12.0, Feb 2026, 2189 commits)
- **Key limitation**: No fiction-specific features (character tracking, glossary, illustrations)

### 19. Koodo Reader
- **URL**: [koodoreader.com](https://koodoreader.com), [GitHub](https://github.com/koodo-reader/koodo-reader)
- **Platforms**: Windows, macOS, Linux, Android, iOS, Web
- **GitHub Stars**: 26.2K
- **License**: AGPL-3.0
- **Tech Stack**: JavaScript (73.8%), TypeScript (23.1%), React, Electron, Webpack
- **AI Features**:
  - AI translation (92 languages, LLM-powered)
  - AI dictionary lookups
  - AI summarization
  - AI TTS via Kokoro-82M open-source model (54 voices, 8 languages) — Pro only
- **Other Features**: 15+ format support, cloud sync (OneDrive, Google Drive, Dropbox, WebDAV)
- **Pricing**: Free (open-source core), Pro tier for AI voice
- **Activity**: Very active (v2.3.0, Mar 9, 2026, 26.2K stars)
- **Key limitation**: General-purpose reader, no fiction-specific AI

---

## Tier 5: Niche/Specialized Tools

### 20. Textify — AI Character Relationship Diagrams
- **URL**: [textify.dou.so](https://textify.dou.so/)
- **Platforms**: Web only
- **AI Features**:
  - Upload a book (PDF/ebook), AI generates character relationship diagrams
  - NLP-based character name, role, and relationship extraction
  - Visual relationship graph output
- **Pricing**: Free, no registration required
- **Activity**: Unknown (small project)
- **Key limitation**: Web-only, single feature (relationship diagrams), not a reader

### 21. Novelcrafter (Writing Tool, Relevant for Codex)
- **URL**: [novelcrafter.com](https://www.novelcrafter.com)
- **Platforms**: Web
- **AI Features**:
  - **Codex**: interactive glossary/wiki for characters, locations, objects, lore
  - AI automatically tracks entities and links them
  - Progressions: documents how characters change through narrative
  - Smart Highlighting: flags inconsistencies and repetitive phrasing
  - AI Chat with Codex memory (interview characters)
  - Connects to multiple AI services (OpenAI, Claude, etc.)
- **Pricing**: Subscription (writing tool, not free)
- **Activity**: Active
- **Key limitation**: Writing tool, not a reading app; no ebook reading capability

### 22. UPDF AI
- **URL**: [updf.com](https://updf.com), [iOS](https://apps.apple.com/us/app/updf-ai-powered-pdf-editor/id1595826623), [Android](https://updf-ai-powered-pdf-editor.en.uptodown.com/android)
- **Platforms**: Windows, Mac, iOS, Android
- **AI Features**:
  - AI summarization (one-click ebook summary)
  - AI translation into local languages
  - AI term/concept explanation
  - AI chat with PDF
  - Mind map generation from PDF
  - TTS (iOS Speak feature)
- **Pricing**: Subscription-based
- **Activity**: Active
- **Key limitation**: PDF-focused editor, not an ebook reader

### 23. Readwise Reader
- **URL**: [readwise.io/reader](https://readwise.io/reader)
- **Platforms**: Web, Desktop (Mac, Windows), iOS, Android
- **AI Features**:
  - **Ghostreader**: AI assistant for definitions, encyclopedia entries, simplification, document Q&A
  - Chat with documents using LLMs (web/desktop, mobile coming)
  - AI-powered TTS with high-quality voices
  - Audio Reviews: AI converts daily highlight reviews into podcast-like audio
  - Smart tagging and filtering
- **Other Features**: EPUBs v2 (chapter-by-chapter loading), highlights, notes, RSS, newsletter management
- **Pricing**: $8.99/month (Reader), $13.99/month (Full Readwise + Reader)
- **Activity**: Very active (major updates in 2025-2026)
- **Key limitation**: "Read-it-later" focus, not primarily a fiction reader; Ghostreader is general-purpose

### 24. Literal
- **URL**: [literalapp.com](https://literalapp.com)
- **Platforms**: Web, iOS, Android
- **AI Features**:
  - AI-enhanced search
  - AI formative assessments
  - Personalized reading recommendations
  - AI in-book explanations
  - Real-time collaborative "Multiplayer" annotation
  - 50+ language translation
- **Pricing**: Educational subscription
- **Activity**: Active
- **Key limitation**: K-12 education focused, not consumer fiction

### 25. Yandex Books (with Alisa AI)
- **URL**: [yandex.ru](https://yandex.ru/support/yandex-app-android-alice/ru/app/reader)
- **Platforms**: Android, iOS, Web
- **AI Features**:
  - AI reader voice for books without professional narration
  - Voice assistant (Alisa) integration
  - Book recommendations
- **Formats**: EPUB, FB2, MOBI
- **Pricing**: Yandex Books subscription from 399 RUB
- **Activity**: Active (Russian market)
- **Key limitation**: TTS-focused, Russian market only, no fiction-specific AI

---

## Competitive Analysis Matrix

| Feature | fancai | Kindle "Ask This Book" | Readest | Anx Reader | Koodo | Speechify | ElevenReader | BookRead |
|---|---|---|---|---|---|---|---|---|
| **AI Illustrations** | YES | No | No | No | No | No | No | No |
| **Character Glossary/Wiki** | YES (spoiler-free) | No (chatbot only) | No | No | No | No | No | No |
| **Spoiler-free AI** | YES | YES | No | No | No | No | No | No |
| **Entity Tracking** | YES (chapter-level) | No | No | No | No | No | No | No |
| **AI Q&A/Chat** | Planned | YES | No | YES | No | YES | No | YES |
| **AI Summaries** | Planned | No | In dev | YES | YES | No | No | YES |
| **AI TTS** | No | No | YES | YES | YES (Pro) | YES | YES | No |
| **AI Translation** | No | No | YES | YES | YES | No | No | YES |
| **Character Relationships** | Planned | No | No | No | No | No | No | No |
| **Open Source** | No | No | YES | YES | YES | No | No | No |
| **Cross-platform** | Web | iOS (expanding) | All | All | All | All | iOS/Android | iOS |

---

## Key Insights for fancai

### 1. Unique positioning
No app on the market combines AI illustrations with a spoiler-free entity glossary/wiki. This is a genuinely unoccupied niche.

### 2. Closest competitors
- **Amazon Kindle "Ask This Book"**: Spoiler-free Q&A, but chatbot-style (not structured wiki), no illustrations, limited to Kindle ecosystem
- **Novelcrafter Codex**: Structured entity wiki with AI, but it's a writing tool, not a reader
- **Textify**: Character relationship extraction, but web-only single-purpose tool

### 3. Market gaps fancai fills
- No reader app builds a structured, browsable character encyclopedia
- No reader app generates AI illustrations synchronized with reading position
- No reader app tracks entity appearances chapter-by-chapter
- The combination of visual (illustrations) + informational (glossary) AI is unique

### 4. Trends to watch
- Amazon will likely expand "Ask This Book" to more features and platforms in 2026
- Google is about to ship "Ask Gemini" in Play Books
- Open-source readers (Readest 18.6K stars, Koodo 26.2K stars) are growing fast but AI features remain basic
- TTS is becoming commoditized; the differentiator is moving to comprehension/analysis
- Anx Reader (7.8K stars) shows strong demand for AI integration in open-source readers

### 5. Potential threats
- Amazon could add structured character glossaries to Kindle (they have the data and models)
- Google could leverage Gemini for fiction-specific features in Play Books
- An open-source project could add character extraction to Readest or Anx Reader

### 6. Opportunities
- fancai is ahead on the fiction-specific AI reading experience
- The mobile market has no AI-illustrated fiction reader
- Russian-language market (Yandex Books is TTS-only, no AI reading comprehension)
- Community around fantasy/sci-fi readers who need character tracking (Wheel of Time, Malazan, etc.)

# Competitive Landscape: AI + Book Reading (March 2026)

## Содержание

1. [Прямые конкуренты (AI + EPUB Reading)](#1-прямые-конкуренты)
2. [Крупные игроки с AI-фичами](#2-крупные-игроки)
3. [Open-Source EPUB-ридеры с AI](#3-open-source-epub-ридеры-с-ai)
4. [Entity Extraction / Character Tracking](#4-entity-extraction--character-tracking)
5. [AI-иллюстрации для книг](#5-ai-иллюстрации-для-книг)
6. [NLP / Academic Tools для литературного анализа](#6-nlp--academic-tools)
7. [AI-стартапы в книжной индустрии](#7-ai-стартапы-в-книжной-индустрии)
8. [Knowledge Graphs и визуализация](#8-knowledge-graphs-и-визуализация)
9. [Ключевые выводы для fancai](#9-ключевые-выводы-для-fancai)

---

## 1. Прямые конкуренты

### Book Companion (Crasome) --- CLOSEST COMPETITOR
- **URL**: https://read.crasome.com/
- **Что делает**: Upload book + AI companion, spoiler-free character tracking, X-Ray feature (characters, locations, concepts), chapter summaries
- **Spoiler-free**: DA --- AI tracks reading progress chapter-by-chapter, never reveals content ahead
- **X-Ray**: Tracks entities, shows when they first appear, descriptions, mentions --- like a "smart glossary that builds as you read"
- **Форматы**: EPUB, PDF, FB2
- **Модель**: Freemium --- first book free, then ~EUR3 per book pass
- **Open source**: Net
- **Уникальность**: Ближайший аналог fancai по entity glossary + spoiler-free. Но нет иллюстраций, нет self-hosted.
- **ВАЖНО**: Это единственный найденный продукт, который делает spoiler-free entity tracking с X-Ray для произвольных книг

### Readever
- **URL**: https://www.readever.app/
- **ProductHunt**: https://www.producthunt.com/products/readever
- **Что делает**: AI reading assistant с highlight + explain + AI mentors (5,000+ персон)
- **Фичи**: Auto-highlighting ключевых пассажей, in-context Q&A, AI mentors (Elon Musk, Marquez etc.), перевод
- **Форматы**: EPUB (PDF soon)
- **Open source**: Net
- **Модель**: SaaS (startup)
- **Уникальность**: Mentor personas --- можно "читать с Маркесом" и задавать вопросы. Нет entity tracking.

### BookRead
- **URL**: https://www.producthunt.com/products/bookread
- **Что делает**: AI reading companion с ChatGPT, self-tests, flashcards, chapter summaries
- **Фичи**: AI Explain (highlight -> explain), flashcards по методу Huberman, rewriting, translation
- **Форматы**: EPUB, PDF
- **Open source**: Net
- **Уникальность**: Flashcards для запоминания. Нет entity system.

### BookChat Studio
- **URL**: https://www.bookchat.studio/
- **Что делает**: Upload PDF, chat about characters/themes/plot, character relationship analysis
- **Фичи**: Page references, visual timelines, theme extraction, character development arcs
- **Open source**: Net
- **Уникальность**: Visual timelines для сложных нарративов. Только PDF.

### Bookwise
- **URL**: https://bookwiseapp.com
- **Что делает**: Book tracking + spoiler-aware AI companion chat
- **Фичи**: Spoiler-free chat, mood-based discovery, reading analytics, Goodreads import, Kindle highlights import
- **Open source**: Net
- **Уникальность**: Позиционируется как "modern Goodreads" с AI. Скорее трекер, чем ридер.

### BookLinker (iOS App)
- **URL**: https://apps.apple.com/us/app/booklinker/id6757022145
- **Что делает**: Manual character tracking с AI voice input и visual relationship graph
- **Фичи**: AI voice input ("John, enemy, tall man"), visual relationship network diagram, smart alias tracking (Daenerys/Dany/Khaleesi)
- **Open source**: Net (iOS only)
- **Уникальность**: Visual relationship graph + alias tracking. Но ручной ввод, не автоматический.

---

## 2. Крупные игроки

### Amazon Kindle "Ask this Book" + X-Ray
- **URL**: Встроено в Kindle app
- **Что делает**: Spoiler-free AI Q&A по книге + X-Ray (character/location/term glossary)
- **Запуск**: December 2025 (iOS), Android 2026
- **Фичи**: Highlight -> ask question, spoiler-free (только до текущей позиции), "Story So Far" recaps
- **AI**: Amazon's own models
- **Ограничения**: Только для Kindle books, только English, только тысячи bestsellers (не все книги)
- **ВАЖНО**: Amazon --- главный валидатор идеи spoiler-free AI reading. Их X-Ray существует давно (без AI), теперь добавили "Ask this Book".
- **Авторы**: Authors Guild raises concerns --- authors can't opt out

### Readwise Reader
- **URL**: https://readwise.io/read
- **Что делает**: Read-it-later app для power readers с AI (Ghostreader)
- **Фичи**: AI chat with highlights library, Ghostreader (GPT copilot: questions, definitions, simplification), multi-color highlights, keyboard-first UX
- **AI**: OpenAI GPT models
- **Модель**: Subscription ($8.99/mo)
- **Уникальность**: Лучший в классе annotation/highlight workflow. Но не fiction-focused, нет entity system.

### Calibre (v8.11+)
- **URL**: https://calibre-ebook.com/
- **Что делает**: Open-source ebook manager, добавил AI features в 2025
- **Фичи**: "Ask AI" tab (highlight -> explain), "Discuss book with AI", "Ask AI what to read next"
- **AI**: OpenRouter, Google, GitHub, Ollama, LM Studio --- пользователь выбирает
- **Open source**: DA (GPLv3)
- **Stars**: Calibre --- один из крупнейших open-source проектов
- **Уникальность**: Huge installed base, plugin ecosystem, local AI support. Но AI --- простой chat, нет entity tracking.

---

## 3. Open-Source EPUB-ридеры с AI

### Koodo Reader
- **GitHub**: https://github.com/koodo-reader/koodo-reader
- **Stars**: 26,218
- **Language**: JavaScript
- **License**: AGPL-3.0
- **Что делает**: Cross-platform ebook manager/reader с AI dictionary, translation, summarization
- **Фичи**: AI dictionary (92 languages), AI translation, AI summarization, 15+ formats, bookmarks/notes/highlights
- **AI**: Pluggable translation backends (Google, Bing, Baidu, etc.)
- **Активность**: Very active (updated 2026-03-09)
- **Уникальность**: Самый звёздный open-source ebook reader. AI --- утилитарный (перевод/словарь).

### Readest
- **GitHub**: https://github.com/readest/readest
- **Stars**: 18,575
- **Language**: TypeScript
- **Stack**: Next.js 16 + Tauri v2
- **License**: AGPL-3.0
- **Что делает**: Modern Foliate rewrite, cross-platform reader с AI summaries и TTS
- **Фичи**: AI summaries, AI translation (100K/day), AI TTS narration, parallel read, highlights/notes
- **Активность**: Very active (updated 2026-03-09)
- **Уникальность**: Лучший стек (Next.js + Tauri), красивый UI. AI --- базовый.

### Anx Reader
- **GitHub**: https://github.com/Anxcye/anx-reader
- **Stars**: 7,844
- **Language**: Dart (Flutter)
- **License**: MIT
- **Что делает**: Flutter-based reader с AI features
- **Фичи**: OpenAI/Claude/Gemini/DeepSeek integration, AI summarization, AI dictionary, AI translation, mind maps, reading analytics, WebDAV sync, TTS
- **Активность**: Very active (updated 2026-03-09)
- **Уникальность**: Multi-provider AI, reading analytics (heatmaps), mind maps. Flutter = mobile-first.

### Karpathy's reader3
- **GitHub**: https://github.com/karpathy/reader3
- **Stars**: 3,339
- **Language**: Python
- **License**: MIT
- **Что делает**: Minimalist EPUB reader для copy-paste в LLM
- **Фичи**: Chapter-by-chapter view, easy copy to LLM, self-hosted
- **Активность**: "90% vibe coded", author won't maintain it
- **Уникальность**: Proof of concept от Karpathy. Viral (1,576 stars за 48 часов). Показывает спрос на "read with LLM".

### BookWith
- **GitHub**: https://github.com/shutootaki/bookwith
- **Stars**: 285
- **Language**: TypeScript
- **License**: AGPL-3.0
- **Что делает**: Conversational reading platform, fork of Flow
- **Фичи**: Real-time Q&A about book content, instant answers, deep insight support, Japanese support
- **Активность**: Active (updated 2026-03-08)
- **Уникальность**: Full book comprehension by AI --- not just selected text.

### EPUB AI Reader
- **GitHub**: https://github.com/alekcangp/epub-ai-reader
- **Stars**: 1
- **Language**: Vue
- **Что делает**: EPUB reader + AI illustrations + blockchain (Zora coins)
- **Фичи**: AI summarization (io.net, fallback to Cloudflare Workers), image generation (SDXL via Cloudflare), NFT minting
- **AI models**: Cloudflare Workers AI (BART, SDXL)
- **Уникальность**: Единственный найденный open-source проект, совмещающий EPUB reading + AI illustration generation. Но мёртвый (1 star, blockchain focus).

### KOReader AI Assistant Plugin
- **GitHub**: https://github.com/omer-faruq/assistant.koplugin
- **Stars**: 448
- **Language**: Lua
- **License**: GPL-3.0
- **Что делает**: AI plugin для KOReader (e-ink ebook reader)
- **Фичи**: Highlight -> ask AI, dictionary with context, custom prompts, translate, "Term X-Ray" (word meaning based on prior context), streaming on e-ink
- **AI**: Claude, GPT-4, Gemini, DeepSeek, Ollama
- **Уникальность**: "Term X-Ray" --- meaning based on previously mentioned places. Works on e-ink devices.

### ReaderPal
- **GitHub**: https://github.com/khoanguyen-3fc/ReaderPal
- **Stars**: 7
- **Language**: HTML
- **License**: MIT
- **Что делает**: Minimal web EPUB reader + AI companion
- **Активность**: Low

### BookLore
- **GitHub**: https://github.com/booklore-app/booklore
- **Stars**: 11,266
- **Language**: Java
- **License**: AGPL-3.0
- **Что делает**: Self-hosted digital library (Kobo/KOReader sync, OPDS, metadata)
- **AI**: Planned (roadmap), not yet implemented
- **Уникальность**: Strong library management, но AI ещё не реализован.

---

## 4. Entity Extraction / Character Tracking

### BookNLP
- **GitHub**: https://github.com/booknlp/booknlp
- **Stars**: 892
- **Language**: Python
- **License**: MIT
- **Что делает**: NLP pipeline для книг: NER, character name clustering, coreference resolution, speaker attribution, entity categorization
- **Возможности**: "Tom"/"Tom Sawyer"/"Mr. Sawyer" -> TOM_SAWYER clustering, trained on 968K tokens (LitBank + 500 contemporary books)
- **Активность**: Active maintenance (updated 2026-03-08)
- **Уникальность**: THE gold standard для character extraction из книг. Academic quality.

### LitBank
- **GitHub**: https://github.com/dbamman/litbank
- **Stars**: 372
- **Language**: Python
- **Что делает**: Annotated dataset of 100 fiction works для NER, coreference, events, quotation attribution
- **Данные**: 210,532 tokens, 6 entity categories, coreference chains, quotation attribution
- **Уникальность**: Ключевой training dataset для literary NLP.

### fiction-ner-750m (HuggingFace)
- **URL**: https://huggingface.co/datasets/SaladTechnologies/fiction-ner-750m
- **Что делает**: Fiction-specific NER dataset для training edge-device models
- **Метод**: LLM prompting + text matching на Fiction 1B dataset, cascading prompts с ~25K tokens
- **Уникальность**: Designed for small models (DeBERTa v3, 184M params) для fiction NER.

### FanfictionNLP
- **GitHub**: https://github.com/michaelmilleryoder/fanfiction-nlp
- **Stars**: 34
- **Language**: Python
- **License**: GPL-3.0
- **Что делает**: NLP pipeline для character extraction из фанфикшн (вдохновлён BookNLP)
- **Уникальность**: Фанфикшн-специфический, Carnegie Mellon University.

### Character Network (Harry Potter)
- **GitHub**: https://github.com/hzjken/character-network
- **Stars**: 60
- **Language**: Python
- **Что делает**: NER + sentiment analysis -> relationship network graph
- **Метод**: Co-occurrence (14-word window) + sentiment matrix -> networkX visualization
- **Уникальность**: Демонстрационный проект, хороший reference для визуализации.

---

## 5. AI-иллюстрации для книг

### Standalone Illustration Generators (не ридеры)
- **Recraft** (recraft.ai) --- professional AI illustration creator
- **Fotor** (fotor.com) --- multimodal diffusion models, multiple styles
- **OpenArt** (openart.ai) --- free text-to-illustration
- **Bylo.ai** --- free AI book illustration generator
- **Lovart** (lovart.ai) --- consistent character design across dozens of illustrations
- **BookBildr** (bookbildr.com) --- how-to guide for AI book illustration

### Key Insight
- Все найденные AI illustration tools --- standalone generators (paste description -> get image)
- НИКТО не интегрирует AI illustration generation прямо в reading flow
- epub-ai-reader (1 star) --- единственная попытка, но мёртвый проект
- **fancai's approach (extract descriptions while reading -> generate illustrations) is UNIQUE**

### Adobe + Book Creator
- Adobe AI Image Generator интегрирован в Book Creator (education platform)
- Но это для создания книг, не для reading experience

---

## 6. NLP / Academic Tools

### Authors AI (Marlowe)
- **URL**: https://authors.ai/marlowe/
- **Что делает**: Analytical AI для fiction manuscripts --- character arcs, plot structure, pacing, narrative arcs
- **Метод**: Analytical (not generative) AI, comparison against thousands of published novels
- **Модель**: $19.95/mo (Marlowe Pro)
- **Уникальность**: For writers, not readers. Character analysis, but manuscript-level (not chapter-by-chapter reading).

### Portrayal
- **URL**: https://naimulh0que.github.io/docs/dis23-42.pdf
- **Что делает**: Web-based interactive system для visualizing character patterns from text
- **Метод**: NLP indicator extraction -> interactive visualization
- **Уникальность**: Academic research tool.

### Academic Survey: "Extraction and Analysis of Fictional Character Networks"
- **URL**: https://arxiv.org/pdf/1907.02704
- **Ключевые выводы**: Character network = graph from narrative (vertices=characters, edges=interactions). Challenges: relatives sharing names, nicknames, fictional character names, outdated honorifics. NER alone misses many co-occurrences; coreference resolution needed.

---

## 7. AI-стартапы в книжной индустрии

### Ello (YC) --- $20M+ funded
- **URL**: https://www.ello.com
- **Бэкеры**: Y Combinator, Goodwater Capital, Homebrew, Reed Hastings, Khosla Ventures
- **Что делает**: AI reading coach for children (K-3rd grade)
- **Фичи**: Speech recognition listens to kids reading, provides support, creates personalized stories
- **Funding**: $15M Series A (Sep 2023), total >$20M
- **Traction**: 10K families, 300K+ books read
- **Уникальность**: Children's literacy, not adult fiction reading.

### Inkitt / Galatea --- $117M funded
- **URL**: https://www.inkitt.com/galatea-app
- **Что делает**: AI-powered fiction publishing platform
- **Фичи**: "Create Your Own Fan Fiction" (select universe/characters -> AI generates story), A/B testing fiction elements, AI-driven content optimization
- **AI**: OpenAI, Anthropic, Mistral для narrative construction
- **Funding**: $117M total ($37M in Feb 2024)
- **Уникальность**: AI generates/personalizes fiction content. Not a reading companion --- a publisher.

### Litnerd (YC)
- **URL**: https://www.ycombinator.com/companies/litnerd
- **Что делает**: Kids create + AI illustrate + publish books
- **Location**: New York, 6 employees
- **Уникальность**: Children's book creation, not reading.

### Spines
- **Что делает**: AI-powered book publishing (proofread, produce, publish, distribute)
- **Goal**: 8,000 books in 2025
- **Уникальность**: Publishing automation, not reading experience.

### StoryFit --- $13.1M funded
- **Что делает**: AI predicts audience reception before publication
- **Уникальность**: Publisher-side analytics.

### Storio (formerly HeartByte)
- **URL**: https://www.storioai.com/
- **Что делает**: AI writing platform for fiction, fan fiction, interactive stories
- **Уникальность**: Writing tool, not reading companion.

### Novelcrafter
- **URL**: https://www.novelcrafter.com/
- **Что делает**: Fiction writing platform с "Codex" (wiki-like knowledge base for story bible)
- **Codex**: Characters, locations, objects, lore + AI-powered consistency checking
- **Фичи**: "Progressions" (how characters change over time), chat with characters, inline entity references
- **Модель**: Subscription (hobbyist+ for AI)
- **Уникальность**: Codex --- WRITER-side entity system. fancai делает READER-side entity system.

---

## 8. Knowledge Graphs и визуализация

### Knowledge Graph from Text (rahulnyk)
- **GitHub**: https://github.com/rahulnyk/knowledge_graph
- **Stars**: 3,039
- **License**: MIT
- **Что делает**: Convert text to knowledge graph с LLM

### AI Knowledge Graph (robert-mcdermott)
- **GitHub**: https://github.com/robert-mcdermott/ai-knowledge-graph
- **Stars**: 1,919
- **License**: Apache-2.0
- **Что делает**: LLM-based entity extraction -> Subject-Predicate-Object triples -> interactive graph
- **Метод**: Entity unification, LLM reasoning for relationship inference

### Neo4j + Harry Potter Example
- **URL**: https://neo4j.com/blog/developer/turn-a-harry-potter-book-into-a-knowledge-graph/
- **Метод**: SpaCy NER -> GPT-4 relationships -> Neo4j graph database

### KGGen (Feb 2025)
- **URL**: https://arxiv.org/html/2502.09956v1
- **Что делает**: Extract knowledge graphs from plaintext с LLMs
- **Уникальность**: Entity clustering to reduce sparsity.

---

## 9. Ключевые выводы для fancai

### Уникальная позиция fancai

| Feature | fancai | Book Companion | Kindle Ask Book | Readever | Anx Reader | Koodo |
|---------|--------|---------------|-----------------|----------|------------|-------|
| Spoiler-free entity wiki | **DA** | DA (X-Ray) | Partial | Net | Net | Net |
| AI illustrations while reading | **DA** | Net | Net | Net | Net | Net |
| Open source / self-hosted | **DA** | Net | Net | Net | DA | DA |
| Chapter-by-chapter entity building | **DA** | DA | Partial | Net | Net | Net |
| Custom AI provider (OpenRouter) | **DA** | ? | Net (Amazon) | ? | DA | Partial |

### Что делает fancai уникальным:
1. **AI illustrations during reading** --- никто этого не делает в integrated reader. Standalone tools есть, но не в reading flow.
2. **Spoiler-free entity wiki** --- только Book Companion (Crasome) делает нечто похожее, и Kindle X-Ray (ограниченно). fancai --- open-source.
3. **Комбинация illustrations + entity wiki** --- нет аналогов.

### Главные конкуренты для отслеживания:
1. **Book Companion (Crasome)** --- ближайший по функционалу entity system + spoiler-free
2. **Amazon Kindle "Ask this Book"** --- validates the market, but closed ecosystem
3. **Readest** (18.5K stars) --- лучший open-source reader, может добавить AI features
4. **Anx Reader** (7.8K stars) --- Flutter reader с multi-AI integration
5. **Koodo Reader** (26.2K stars) --- самый популярный open-source reader

### Возможности для дифференциации:
1. AI illustrations --- **blue ocean**, никто не делает
2. Relationship graph visualization (BookLinker-style, но автоматический)
3. "Progression" tracking (как в Novelcrafter Codex, но для reader)
4. Multilingual entity extraction (Russian name handling: fuzzy matching ~0.70-0.75)
5. Self-hosted + open-source с spoiler-free guarantees

### Технологические инсайты:
- **BookNLP** (892 stars) --- gold standard для character extraction, можно использовать идеи
- **Fiction NER dataset** на HuggingFace --- training data для маленьких моделей
- **KOReader AI plugin** --- "Term X-Ray" feature (word meaning in prior context) --- хорошая идея
- **Amazon's approach**: "only reveals information up to your current reading position" --- exact same philosophy as fancai
- **Coreference resolution** критически важна (NER alone misses many character co-occurrences)

### Риски:
- Amazon может расширить "Ask this Book" на все книги и все языки
- Readest/Koodo могут добавить entity tracking
- Book Companion может открыть API или стать freemium

---

*Исследование проведено 2026-03-10*

# Исследование конкурентов с AI-функциональностью (март 2026)

Комплексный анализ всех найденных приложений для чтения с AI-функциями.
Платформы: Web, Android, iOS, Desktop (Windows, macOS, Linux), E-ink.

---

## Сводная матрица ключевых конкурентов

| Продукт | Платформы | Entity/X-Ray | Spoiler-free | AI-иллюстрации | AI Chat/Q&A | AI TTS | Open Source | Stars |
|---------|-----------|:------------:|:------------:|:--------------:|:-----------:|:------:|:-----------:|------:|
| **fancai** | Web | **DA** | **DA** | **DA** | Planned | — | — | — |
| **FantasyRead.ai** | Web, iOS, Android | **DA** | **DA** | — | **DA** | — | — | — |
| **Where We Left Off** | Web (self-hosted) | **DA** | **DA** | — | **DA** | — | **DA** | 0 |
| **StorySide** | Web | — | **DA** | — | **DA** | — | — | — |
| Book Companion | Web | **DA** | **DA** | — | **DA** | — | — | — |
| Kindle "Ask This Book" | iOS, Kindle | Partial | **DA** | — | **DA** | — | — | — |
| KOReader AI Plugin | E-ink, Android | **DA** | **DA** | — | **DA** | — | **DA** | 448 |
| Fictionary | Kindle, FBReader | **DA** | **DA** | — | — | — | — | — |
| Merrilin | Mobile (pre-launch) | ? | **DA** | — | **DA** | — | — | — |
| No Spoiler AI | Web | — | **DA** | — | **DA** | — | — | — |
| Bookwise | Web, Mobile | — | **DA** | — | **DA** | — | — | — |
| PPG Text2Image | Android | — | — | **DA** | — | — | — | — |
| epub-ai-reader | Web (dead) | — | — | **DA** | — | — | **DA** | 1 |
| Readest | All | — | — | — | Basic | **DA** | **DA** | 18,575 |
| Koodo Reader | All | — | — | — | — | **DA** | **DA** | 26,218 |
| Anx Reader | Mobile, Desktop | — | — | — | **DA** | **DA** | **DA** | 7,844 |
| Calibre (v9.4) | Desktop | — | — | — | **DA** | — | **DA** | ~20k |
| BookWith | Web | — | — | — | **DA** | — | **DA** | 285 |
| Readwise Reader | All | — | — | — | **DA** | **DA** | — | — |
| Readever (ChatEpub) | Web, Desktop | — | — | — | **DA** | — | — | — |
| BookRead | iOS | — | — | — | **DA** | — | — | — |
| Speechify | All | — | — | — | **DA** | **DA** | — | — |
| ElevenReader | iOS, Android | — | — | — | — | **DA** | — | — |
| Readify | iOS, Android, Web | — | — | — | **DA** | **DA** | — | — |
| Inkitt/Galatea | iOS, Android | — | — | — | — | — | — | — |
| StoryGraph | iOS, Android, Web | — | — | — | — | — | — | — |
| Yandex Books | Android, iOS, Web | — | — | — | — | **DA** | — | — |
| BookLinker | iOS | Manual | — | — | — | — | — | — |
| BookChat Studio | Web | Partial | — | — | **DA** | — | — | — |
| Novelcrafter Codex | Web (writing tool) | **DA** | — | — | **DA** | — | — | — |

---

## Tier 1: Прямые конкуренты (entity tracking + spoiler-free)

### 0a. FantasyRead.ai — КЛЮЧЕВОЙ КОНКУРЕНТ (NEW!)
- **URL**: https://fantasyread.ai/
- **Платформы**: Web, iOS, Android (cross-device sync, offline)
- **Тип**: Коммерческий (freemium)
- **Компания**: NO2V (основана 2025)
- **Форматы**: EPUB (DRM-free)
- **AI-фичи**:
  - **"The Sage"** — проприетарный AI-движок, встроенный inline в текст
  - **Entity detection** — автоматически определяет персонажей, локации, концепты, сюжетные точки
  - **Spoiler-free** — контекст привязан к прогрессу чтения, никогда не показывает future content
  - **Inline highlights** — AI встраивает rich context прямо в текст (tap для раскрытия)
  - **Offline** — pre-processing при загрузке, далее работает без интернета
  - **Без отдельного чат-интерфейса** — контекст появляется inline, без loading screens
- **AI-модель**: Не раскрыта (проприетарная "Sage")
- **Ценообразование**: Free (unlimited uploads, cross-device, offline, 1 мес Pro бесплатно в beta); Pro $8.99/мес (скидка с $18.99, до 31.12.2026)
- **Рейтинг**: 4.8/5 (127 reviews)
- **Язык**: English only
- **Чего НЕТ**: AI-иллюстрации, русский язык, open source
- **Релевантность**: **КРИТИЧЕСКАЯ** — прямой конкурент fancai по entity tracking + spoiler-free. Инновационный подход с inline context (без чат-интерфейса). Мультиплатформенный. Но нет иллюстраций, нет русского.

### 0b. Where We Left Off (Project Velcro) — OPEN-SOURCE КОНКУРЕНТ (NEW!)
- **URL**: https://github.com/gamefreakoneone/Where-we-left-off-reader
- **Платформы**: Web (self-hosted)
- **Тип**: Open source (MIT)
- **Stars**: 0, 24 commits
- **Форматы**: PDF only (пока)
- **AI-фичи**:
  - **Character Intelligence** — автоматическая детекция персонажей, алиасов, ролей, статусов
  - **Relationship Mapping** — визуализация эволюции отношений (ReactFlow), категоризация (allies, rivals, family), scoring важности
  - **Spoiler-free Q&A** — agent-based система, уважает текущую позицию чтения
  - **Story Summarization** — chapter summaries (≤160 слов) + cumulative overviews (≤250 слов)
  - **Semantic Search** — vector embeddings (ChromaDB) для поиска по смыслу
  - **Entity Resolution** — "Elizabeth"/"Lizzy"/"Ms. Bennet" -> один персонаж (two-pass approach)
- **Tech stack**:
  - Frontend: **Next.js 15.5.2** + React 19.1.0 + TypeScript + Tailwind + ReactFlow
  - Backend: **FastAPI** + LangGraph + LangChain + OpenAI API + ChromaDB + PyMuPDF
  - Two-pass processing: 1) Chapter Analysis -> JSON, 2) Story Consolidation -> entity resolution
- **Архитектура**: Очень похожа на fancai! (Next.js + FastAPI + OpenAI)
- **Чего НЕТ**: AI-иллюстрации, EPUB support (только PDF), production deployment, community
- **Релевантность**: **ВЫСОКАЯ** — архитектурно близкий open-source проект с entity resolution + relationship mapping + spoiler-free. Хороший источник идей (two-pass processing, ReactFlow для relationship graphs). Ранняя стадия (0 stars).

### 0c. StorySide — SPOILER-FREE COMPANION (NEW!)
- **URL**: https://storyside.app/
- **Платформы**: Web
- **Тип**: Коммерческий (freemium)
- **Форматы**: EPUB (upload или shared library)
- **AI-фичи**:
  - **Hard spoiler boundary** — "Set your page. We keep the boundary." UI показывает "Discussing up to page X"
  - **Shared Memory** — помнит вопросы и интерпретации между сессиями (continuity)
  - **Personal Recaps** — персонализированные "Until now" summaries (не generic, а based на том что reader спрашивал)
  - **Smart Discussions** — characters, plot points, themes без риска спойлеров
- **Tech stack**: Next.js (React SSR), Google OAuth
- **Чего НЕТ**: Entity tracking/X-Ray, AI-иллюстрации, mobile app
- **Релевантность**: **ВЫСОКАЯ** — инновационный подход к spoiler-free (hard page boundary + shared memory + personalized recaps). Нет entity system, но UX-идеи ценны.

### 1. Book Companion (Crasome) — БЛИЖАЙШИЙ КОНКУРЕНТ (⚠️ СТАТУС НЕЯСЕН)
- **URL**: https://read.crasome.com/
- **Платформы**: Web
- **Тип**: Коммерческий (freemium)
- **Форматы**: EPUB, PDF, FB2
- **AI-фичи** (по данным из поисковых индексов):
  - **X-Ray** — отслеживание персонажей, локаций, концептов по книге (кто с кем взаимодействует, как динамика меняется по главам)
  - **Spoiler-free AI чат** — ИИ знает только прочитанные главы
  - **Автоматические summaries по главам** — ключевые события и персонажные моменты
  - **Многоязычная поддержка**: EN, RU, DE, ES, FR
- **AI-модель**: Anthropic Claude (через API); поддержка BYOK
- **Ценообразование**: 1-я книга бесплатно, далее ~EUR3/книга (3 pass за EUR10, 5 за EUR15); BYOK — безлимит
- **Чего НЕТ**: AI-иллюстрации, self-hosted
- **⚠️ СТАТУС**: Сайт не отвечает (ECONNREFUSED) на 10 марта 2026. Присутствует в поисковых индексах Google с корректным описанием и Privacy Policy. Возможно: временно недоступен, закрыт, или indie-проект с нестабильной инфраструктурой. Требует мониторинга.
- **Релевантность**: Если жив — единственный найденный продукт со spoiler-free entity tracking для произвольных книг. Прямой конкурент fancai по entity system.

### 2. Amazon Kindle — X-Ray + "Ask This Book" + "Story So Far"
- **URL**: Kindle app (iOS, Android, Kindle devices)
- **Платформы**: iOS (запуск дек. 2025), Android и Kindle devices (2026)
- **Тип**: Коммерческий (в составе Kindle)
- **AI-фичи**:
  - **X-Ray** — персонажи, локации, термины с таймлайном появлений (существует давно, без AI)
  - **"Ask This Book"** (дек. 2025) — AI Q&A по книге, spoiler-free (только до текущей позиции)
  - **"Story So Far"** (анонс 2026) — AI-summary для возврата к чтению
  - Highlight -> ask question
- **AI-модель**: Собственные Amazon модели (вероятно RAG)
- **Ограничения**: Только для Kindle books, только English, тысячи bestsellers (не все книги), X-Ray может спойлерить через таймлайн-бары, авторы не могут opt-out
- **Релевантность**: Главный валидатор идеи spoiler-free AI reading. Эталон X-Ray, но закрытая экосистема.

### 3. KOReader AI Assistant Plugin
- **URL**: https://github.com/omer-faruq/assistant.koplugin
- **Платформы**: KOReader (e-ink readers, Android, Linux)
- **Тип**: Open source (GPL-3.0), 448 stars
- **AI-фичи**:
  - **X-Ray** — spoiler-free структурированный обзор книги до текущего прогресса
  - **Term X-Ray** — значение слова/фразы по контексту всех предыдущих появлений (уникальная фича!)
  - **Recap** — быстрый recap при возврате к книге (>28 часов перерыва)
  - **Book Info** — summary, background, author, similar books
  - AI Dictionary с контекстом
  - Gesture-based промпты
- **AI-модели**: Claude, GPT-4, Gemini, DeepSeek, Ollama
- **Язык**: Lua (KOReader plugin)
- **Активность**: Март 2026, активно развивается
- **Релевантность**: X-Ray + Term X-Ray + Recap — фичи очень близкие к entity system fancai. Отличный источник идей для UX. Но только для e-ink, не web.

### 4. Fictionary
- **URL**: https://www.thefictionary.net/
- **Платформы**: Kindle (e-ink + iOS), FBReader, Moon+ Reader (StarDict)
- **Тип**: Бесплатный сервис
- **AI-фичи**:
  - Кастомные словари для вымышленных терминов, персонажей, мест
  - Spoiler-free дизайн — snapshot контента без timeline-данных
- **Релевантность**: Идейный предшественник spoiler-free glossary. Вероятно не AI-powered в полном смысле.

### 5. Merrilin
- **URL**: https://tech.stonecharioteer.com/posts/2026/merrilin/
- **Платформы**: Мобильные (включая e-ink Boox)
- **Статус**: Pre-launch, ограниченный trial через newsletter (март 2026)
- **AI-фичи**:
  - Spoiler-free AI-компаньон по книге
  - Поддержка серий книг (вопросы по всей серии)
  - Live sync между устройствами
- **Релевантность**: Прямой конкурент по spoiler-free, но статус неясен (pre-launch).

### 6. No Spoiler AI
- **URL**: https://nospoilerai.com/
- **Платформы**: Web
- **AI-фичи**: Отслеживание прогресса + spoiler-free ответы о книге
- **Релевантность**: Нишевый инструмент, только Q&A без спойлеров, не полноценная читалка.

---

## Tier 2: AI-читалки с иллюстрациями

### 7. PPG AI eBook Reader Text2Image
- **URL**: https://play.google.com/store/apps/details?id=com.lb.aibookreader
- **Платформы**: Android only
- **Тип**: Коммерческий
- **AI-фичи**:
  - Long-tap текст -> AI-иллюстрация
  - Подключение кастомных AI backends (Ollama, Automatic1111, OpenAI-compatible, TogetherAI)
  - Темы (dark, light, sepia), PIN-защита
- **Форматы**: TXT, PDF, EPUB
- **AI-модель**: BYOB (Bring Your Own Backend)
- **Целевая аудитория**: Romance/fanfiction
- **Релевантность**: Ближайший конкурент по AI-иллюстрациям в reader. Но Android-only, без entity tracking.

### 8. epub-ai-reader (DEAD)
- **URL**: https://github.com/alekcangp/epub-ai-reader
- **Платформы**: Web
- **Тип**: Open source (MIT), 1 star
- **AI-фичи**:
  - AI Image Generation из текста книги (6 арт-стилей)
  - Суммаризация текущей страницы/выделенного текста
  - Blockchain (Zora ERC-20 токен minting) — ненужная фича
- **AI-модели**: SDXL (Cloudflare Workers AI) для изображений; BART для текста
- **Tech stack**: Vue 72.7% + TypeScript 16.3%, Vercel deploy
- **Статус**: МЕРТВЫЙ проект (последнее обновление дек. 2024, 1 star, 1 contributor)
- **Релевантность**: Единственный найденный open-source reader с AI-иллюстрациями на Web. Мёртвый.

### 9. Visual Novel Stories
- **URL**: https://visualnovelstories.com/
- **Платформы**: Web
- **Тип**: Коммерческий (freemium)
- **AI-фичи**: Upload текст (TXT, PDF, EPUB, DOC) -> AI автоматически генерирует иллюстрации для каждой сцены, экспорт как PDF flipbook
- **Релевантность**: Не reader, а standalone генератор иллюстрированных книг.

---

## Tier 3: Open-Source ридеры с AI

### 10. Koodo Reader — 26,218 stars
- **URL**: https://github.com/koodo-reader/koodo-reader | https://koodoreader.com
- **Платформы**: Windows, macOS, Linux, Android, iOS, Web
- **Лицензия**: AGPL-3.0
- **Tech stack**: JavaScript (73.8%), TypeScript (23.1%), React, Electron, Webpack
- **AI-фичи**: AI translation (92 языка, LLM), AI dictionary, AI summarization, AI TTS через Kokoro-82M (54 голоса, 8 языков — Pro only)
- **Форматы**: 15+ форматов, cloud sync (OneDrive, Google Drive, Dropbox, WebDAV)
- **Обновление**: v2.3.0, 9 марта 2026
- **Релевантность**: Самый популярный open-source reader. AI утилитарный (перевод/словарь). Нет entity tracking, нет иллюстраций.

### 11. Readest — 18,575 stars
- **URL**: https://github.com/readest/readest | https://readest.com
- **Платформы**: macOS, Windows, Linux, Android, iOS, Web, PWA
- **Лицензия**: AGPL-3.0
- **Tech stack**: Next.js 16, React 19, Tauri v2, Rust backend, TypeScript, foliate-js, PDF.js
- **AI-фичи**: AI-powered TTS, AI book/chapter summaries, DeepL + Yandex translation, Dictionary/Wikipedia lookups
- **Фичи**: Split-screen, highlights/bookmarks/notes, full-text search, cloud sync, OPDS/Calibre integration
- **Обновление**: Март 2026
- **Релевантность**: Лучший стек (Next.js + Tauri), красивый UI. Modern rewrite Foliate. AI — базовый.

### 12. Anx Reader — 7,844 stars
- **URL**: https://github.com/Anxcye/anx-reader
- **Платформы**: Android (F-Droid), iOS, Windows, macOS, Linux (beta) — **нет Web**
- **Лицензия**: MIT
- **Tech stack**: Flutter/Dart (92.3%), foliate-js, C++, Swift
- **AI-фичи**:
  - Интеграция OpenAI, Claude, Gemini, DeepSeek APIs
  - AI-generated mind maps для структуры книги
  - AI dictionary и translation
  - AI perspective analysis и summaries
  - Full-book translation с side-by-side view
  - Multi-voice TTS
- **Фичи**: WebDAV sync, reading analytics (heatmaps), 2189 commits
- **Форматы**: EPUB, MOBI, AZW3, FB2, TXT, PDF
- **Обновление**: v1.12.0, февраль 2026
- **Релевантность**: Мощный multi-AI reader. Хороший пример интеграции нескольких AI-провайдеров. Нет web.

### 13. BookLore — 11,266 stars
- **URL**: https://github.com/booklore-app/booklore
- **Платформы**: Self-hosted (Java)
- **Лицензия**: AGPL-3.0
- **AI-фичи**: AI planned (roadmap), ещё не реализован
- **Релевантность**: Сильная библиотека (Kobo/KOReader sync, OPDS, metadata). Потенциальный конкурент когда добавят AI.

### 14. Calibre (v9.4) — ~20k stars
- **URL**: https://calibre-ebook.com | https://github.com/kovidgoyal/calibre
- **Платформы**: Windows, macOS, Linux
- **Лицензия**: GPL-3.0
- **Tech stack**: Python, Qt
- **AI-фичи** (с v8.11, 2025):
  - "Ask AI" tab — highlight -> ask AI, get explanations/context/summaries
  - "Discuss selected book(s) with AI" — обсуждение без открытия книги
  - "Ask AI what to read next" — рекомендации
  - **Сотни провайдеров**: Google, OpenRouter, GitHub, Ollama, LM Studio (local)
- **Плагины**: Ask Grok (multi-provider), Calibre-AI-Magic (metadata/tagging), Ebook-Translator (2.3k stars)
- **Обновление**: v9.4.0, март 2026
- **Релевантность**: Доминирует в desktop open-source. AI — простой chat, нет entity tracking.

### 15. BookWith — 285 stars
- **URL**: https://github.com/shutootaki/bookwith
- **Платформы**: Web
- **Лицензия**: AGPL-3.0
- **Tech stack**: TypeScript 55% + Python 41%, React + FastAPI + Supabase + LangChain + Google TTS
- **AI-фичи**:
  - Контекстно-зависимый AI-ассистент чтения
  - **AI-подкаст генерация** (5-10 мин аудио из секции книги — уникальная фича!)
  - Мульти-уровневая система памяти (short/mid/long-term)
  - Умные аннотации (5 цветов + Markdown)
  - Семантический поиск cross-book
  - Полная поддержка японского
- **AI-модель**: OpenAI + LangChain
- **Обновление**: Март 2025
- **Релевантность**: Ближайший по архитектуре (React + FastAPI). AI podcast — уникально. Нет entity tracking, нет иллюстраций.

### 16. reader3 (Karpathy) — 3,339 stars
- **URL**: https://github.com/karpathy/reader3
- **Платформы**: Web (self-hosted)
- **Лицензия**: MIT
- **Tech stack**: Python 61% + HTML 39%
- **AI-фичи**: Чтение EPUB по главам + copy-paste в любой LLM (не встроенная интеграция)
- **Статус**: "90% vibe coded", author won't maintain
- **Релевантность**: Proof of concept от Karpathy. 1,576 stars за 48 часов. Показывает спрос на "read with LLM".

### 17. Librum — ~3,500 stars
- **URL**: https://github.com/Librum-Reader/Librum | https://librumreader.com
- **Платформы**: Linux (Flatpak), Windows/macOS в разработке
- **Лицензия**: Open source
- **Tech stack**: QML, C++
- **AI-фичи**: AI explain, summarize на выделенный текст
- **Фичи**: Cloud library sync, 70k+ free books

---

## Tier 4: Коммерческие AI-читалки (без entity tracking)

### 18. Readwise Reader (Ghostreader)
- **URL**: https://readwise.io/read
- **Платформы**: Web, Desktop, iOS, Android
- **Ценообразование**: $8.99/мес (включает Reader + Readwise)
- **AI-фичи**:
  - **Ghostreader** — AI-ассистент: definitions, encyclopedia entries, simplification, document Q&A
  - Chat with documents (GPT-5 Mini default, GPT-4.1-mini included, o3 BYOK)
  - AI-powered TTS
  - Audio Reviews: AI converts highlights into podcast-like audio
  - Smart tagging
  - Для fiction: "Previously on..." recap
- **Релевантность**: Лучший в классе annotation/highlight workflow + AI. Не fiction-specific.

### 19. Readever (ChatEpub)
- **URL**: https://www.readever.app/
- **Платформы**: Web, Mac, Windows
- **Ценообразование**: Free (10 книг), Premium $6.99/мес или $59.99/год, студенты -50%
- **AI-фичи**:
  - ChatEpub — AI-чат при чтении EPUB
  - AI auto-highlighting ключевых идей
  - Детекция концептов, аргументов, доказательств в реальном времени
  - Co-read с 5,000+ AI personas (исторические фигуры, эксперты)
  - Focus Pulse для ADHD-friendly тайминга
- **Языки**: EN, CN, JP
- **Релевантность**: AI mentor personas — уникальная фича. Нет entity tracking.

### 20. Speechify
- **URL**: https://speechify.com
- **Платформы**: iOS, Android, Web, Mac, Chrome Extension
- **Ценообразование**: Freemium, Premium ~$139/год
- **Пользователи**: 50M+ total
- **AI-фичи**: AI TTS (200+ голосов, 60+ языков, до 4.5x speed), AI Voice Assistant (Q&A по контенту), AI Podcasts, Voice Typing, AI meeting transcription
- **Релевантность**: TTS-focused, не fiction reader.

### 21. ElevenReader (ElevenLabs)
- **URL**: https://elevenreader.io
- **Платформы**: iOS, Android
- **AI-фичи**: AI TTS с 10,000+ голосов (включая celebrity), Voice cloning, 30+ языков
- **Релевантность**: TTS-only, нет comprehension фич.

### 22. BookRead
- **URL**: iOS App Store
- **Платформы**: iOS only (iOS 17.6+)
- **Ценообразование**: Freemium, Premium $14.99/мес
- **AI-фичи**: AI Text Explanation (контекстная), Chapter summaries, Auto-flashcards, AI translation, Reading analytics
- **Релевантность**: iOS-only, нет entity tracking.

### 23. 2Read: AI Kindle Reading Buddy
- **URL**: iOS, Android
- **AI-фичи**: WordWise (context-aware definitions), AI Highlight Insights, AI Summary (topic-specific), Kindle highlight sync, Daily review (spaced repetition), Bookshots
- **Релевантность**: Companion app, не standalone reader. Нет fiction-specific фич.

---

## Tier 5: Крупные платформы

### 24. Google Play Books — "Ask Gemini" (planned)
- **Платформы**: Android (upcoming), iOS
- **AI-фичи** (найдено в APK teardown, ещё не live):
  - "Ask Gemini" в text selection menu
  - Contextual Q&A о выбранных пассажах
  - Summaries и explanations
  - Historical context для нарративов
  - AI-generated book summaries (уже доступно)
  - AI-narrated audiobooks
- **Статус**: Beta v2025.11.29.2, не запущено
- **Релевантность**: Google с Gemini — потенциальная угроза. Но general-purpose, не fiction-specific.

### 25. Apple Books
- **Платформы**: iOS, iPadOS, macOS
- **AI-фичи**: AI-narrated audiobooks (Madison, Amberly голоса), AI-based рекомендации
- **Apple Intelligence (2026)**: Framework есть, но Apple Books не объявляла reader-facing AI (summaries, glossaries)
- **Релевантность**: Минимальные AI-фичи для читателей.

### 26. Kobo
- **Платформы**: iOS, Android, Kobo devices
- **AI-фичи** (planned, в Terms of Service):
  - AI Recaps (~150 слов) — персонализированные, с references к highlights/annotations
  - Авторский opt-out доступен
- **Статус**: Ещё не запущено (март 2026)
- **Релевантность**: AI Recaps — close к "Story So Far" Kindle. Ещё не live.

### 27. Audible (Amazon)
- **Платформы**: iOS, Android, Web
- **AI-фичи**: AI narration production (100+ AI voices), AI translation (speech-to-speech, сохраняя голос), Maven (semantic search), Personalized collections
- **Ценообразование**: $14.95/мес
- **Релевантность**: Audiobook-only, нет reading features.

### 28. Yandex Books (с Alisa AI)
- **Платформы**: Android, iOS, Web
- **AI-фичи**: AI reader voice, Alisa voice assistant, рекомендации
- **Форматы**: EPUB, FB2, MOBI
- **Ценообразование**: от 399 руб.
- **Релевантность**: Русский рынок, TTS-only, нет fiction-specific AI.

---

## Tier 6: Инструменты для авторов (релевантные для идей)

### 29. Novelcrafter Codex
- **URL**: https://www.novelcrafter.com/features/codex
- **Платформы**: Web
- **AI-фичи**:
  - **Codex** — интерактивный wiki для персонажей, локаций, объектов, лора
  - AI автоматически отслеживает entities и линкует
  - **Progressions** — как персонажи меняются по нарративу (уникальная концепция!)
  - Smart Highlighting: флаги несоответствий и повторов
  - AI Chat с Codex memory (интервью с персонажами)
  - Подключение OpenAI, Claude, etc.
- **Релевантность**: Writer-side entity system. fancai делает reader-side. Concept "Progressions" — потенциальная roadmap-фича.

### 30. StoryWriter
- **URL**: https://storywriter.app/
- **AI-фичи**: Upload manuscript -> AI extracts "series bible" (characters, locations, factions, rules), visual character relationship maps (drag nodes, draw edges)
- **Релевантность**: Automatic entity extraction + visual relationship graphs. Идеи для fancai roadmap.

### 31. Authors AI (Marlowe)
- **URL**: https://authors.ai/marlowe/
- **AI-фичи**: Character personality trait analysis, plot arc/pacing analysis, story beat detection, genre comparison, cliche detection
- **Метод**: "Classical AI" (analytical, не generative), сравнение с корпусом тысяч опубликованных романов
- **Ценообразование**: Marlowe Basic free / Pro $19.95/мес
- **Релевантность**: Analytical подход к fiction analysis.

---

## Tier 7: NLP / Entity Extraction инструменты

### 32. BookNLP — 892 stars
- **URL**: https://github.com/booknlp/booknlp
- **Лицензия**: MIT
- **Tech stack**: Python, spaCy, HuggingFace Transformers
- **Возможности**:
  - Character name clustering ("Tom"/"Tom Sawyer"/"Mr. Sawyer" -> TOM_SAWYER)
  - Coreference resolution
  - Named entity recognition для literary characters
  - Event tagging (Actor, Action, Recipient)
  - Referential gender inference
  - Speaker attribution
  - Large model (GPU) и small model (CPU)
- **Обновление**: Март 2026
- **Релевантность**: Gold standard для character extraction из книг. Академическое качество. Можно использовать идеи.

### 33. LitBank — 372 stars
- **URL**: https://github.com/dbamman/litbank
- **Данные**: 100 annotated fiction works, 210,532 tokens, 6 entity categories, coreference chains, quotation attribution
- **Релевантность**: Ключевой training dataset для literary NLP.

### 34. fiction-ner-750m (HuggingFace)
- **URL**: https://huggingface.co/datasets/SaladTechnologies/fiction-ner-750m
- **Метод**: LLM prompting + text matching на Fiction 1B dataset, cascading prompts с ~25K tokens
- **Целевая модель**: DeBERTa v3 (184M params) для fiction NER на edge devices
- **Релевантность**: Training data для маленьких моделей fiction NER.

### 35. Knowledge Graph инструменты
- **Knowledge Graph from Text** (rahulnyk) — 3,039 stars, MIT, convert text to knowledge graph с LLM
- **AI Knowledge Graph** (robert-mcdermott) — 1,919 stars, Apache-2.0, entity extraction -> Subject-Predicate-Object -> interactive graph
- **KGGen** (arxiv, Feb 2025) — extract KG from plaintext с LLMs, entity clustering
- **Character Network** (hzjken) — 60 stars, NER + sentiment -> networkX visualization (co-occurrence 14-word window)
- **Neo4j + Harry Potter Example** — SpaCy NER -> GPT-4 relationships -> Neo4j graph

---

## Tier 8: Социальные / Discovery платформы

### 36. Inkitt / Galatea — $117M funded
- **URL**: https://www.inkitt.com
- **Платформы**: iOS, Android, Web
- **AI-фичи (backend)**: ML-powered content discovery, AI-assisted editing, A/B testing plot rewrites, AI-ghostwritten sequels, AI covers/audiobooks/translations, будущее — AI-personalized fiction per reader
- **Downloads**: 9.8M, Rating: 4.57/5
- **Релевантность**: AI behind the scenes (publishing pipeline), не reader-facing. Genre fiction (romance).

### 37. StoryGraph
- **URL**: https://thestorygraph.com
- **Платформы**: iOS, Android, Web
- **AI-фичи**: ML-powered рекомендации (mood, pace, character-vs-plot preference), mood-based discovery, spoiler-safe live reactions tied to specific pages
- **Ценообразование**: Free / Plus $4.99/мес
- **Релевантность**: Book tracking/social, не ebook reader. AI — только рекомендации.

### 38. Fable
- **URL**: https://fable.co
- **Платформы**: iOS, Android
- **AI-фичи**: AI-powered "For You" feed, ранее AI-generated reader summaries (disabled Jan 2025 из-за скандала — генерировали offensive content)
- **Статус**: Acquired by Everand/Scribd
- **Релевантность**: Социальная платформа. AI features сокращены после скандала.

### 39. Bookwise
- **URL**: https://bookwiseapp.com
- **Платформы**: Web, Mobile
- **AI-фичи**: Spoiler-aware AI companion chat, mood-based discovery, reading analytics, Goodreads/Kindle highlights import
- **Релевантность**: "Modern Goodreads" с AI. Скорее трекер, чем ридер.

---

## Tier 9: AI-стартапы в книжной индустрии (funded)

| Стартап | Funding | Фокус | AI-фичи |
|---------|---------|-------|---------|
| **Inkitt/Galatea** | $117M | AI fiction publishing | AI content optimization, A/B testing |
| **Ello** (YC) | $20M+ | Children's literacy AI coach | Speech recognition, personalized stories |
| **StoryFit** | $13.1M | Audience prediction | AI predicts reception before publication |
| **Spines** | Unknown | AI publishing pipeline | Proofread, produce, publish, distribute |
| **Litnerd** (YC) | Unknown | Kids book creation | AI illustration + publish |
| **Storio** (HeartByte) | Unknown | AI fiction writing | Interactive stories |

---

## Ключевые выводы

### 1. Уникальная позиция fancai

**fancai — единственное живое web-приложение, совмещающее ВСЕ ТРИ:**
1. AI entity glossary/wiki со spoiler-free chapter-level tracking
2. AI-иллюстрации при чтении
3. Web-платформа

**НИ ОДИН конкурент не имеет этой комбинации.** Но конкуренция в spoiler-free entity tracking ЗНАЧИТЕЛЬНО выше чем казалось ранее.

### 2. Конкурентная карта по фичам

```
                    Entity/X-Ray Tracking
                           |
     FantasyRead.ai ▲      |   fancai ★
     Book Companion (?)     |
     Where We Left Off      |
     KOReader Plugin        |
     Kindle X-Ray           |
                            |
    ────────────────────────┼───────────────────────
                            |
     StorySide              |   PPG Text2Image
     Readwise               |   epub-ai-reader (dead)
     Readest                |
     Anx Reader             |
     Calibre                |
                            |
                     AI Illustrations
```

fancai — единственный в правом верхнем квадранте. Но **FantasyRead.ai** — серьёзный конкурент по entity tracking + spoiler-free, с мультиплатформенностью и рейтингом 4.8.

### 3. ⚠️ ОБНОВЛЁННАЯ ОЦЕНКА УГРОЗ (после доп. исследования)

**FantasyRead.ai — главная угроза:**
- Мультиплатформенный (Web + iOS + Android), fancai — только Web
- Inline context (без chat UI) — более seamless UX чем отдельный drawer
- Offline support — fancai requires connection для AI
- Рейтинг 4.8/5, уже 127 reviews
- НО: нет AI-иллюстраций, нет русского языка, English only, проприетарный

**Where We Left Off — архитектурная валидация:**
- Two-pass processing (chapter analysis -> entity resolution) — та же идея что у fancai
- ReactFlow для relationship graphs — reference implementation
- Пока 0 stars, PDF only — не угроза, но показывает что другие разработчики идут тем же путём

**StorySide — UX-инновации:**
- "Shared Memory" между сессиями — помнит что reader спрашивал
- "Personal Recaps" — персонализированные, не generic summaries
- Hard page boundary UI — "Discussing up to page X"

### 4. Что делают конкуренты ЛУЧШЕ fancai (потенциальные идеи для roadmap)

| Фича | Кто делает | Как работает |
|------|-----------|-------------|
| **Inline Context (no chat UI)** | FantasyRead.ai "The Sage" | Tap на entity -> inline popup с контекстом, без отдельного чат-интерфейса |
| **Offline AI pre-processing** | FantasyRead.ai | Pre-process при загрузке, далее offline — instant context без задержек |
| **Relationship Graph (auto)** | Where We Left Off | ReactFlow визуализация, auto-detected отношения с scoring |
| **Two-pass Entity Resolution** | Where We Left Off | Pass 1: chapter analysis, Pass 2: entity consolidation + alias resolution |
| **Shared Memory** | StorySide | AI помнит вопросы и интерпретации reader между сессиями |
| **Personal Recaps** | StorySide | Персонализированные summaries (не generic, а based на интересах reader) |
| **Hard Page Boundary UI** | StorySide | Явный UI: "Discussing up to page X" — transparency |
| **Term X-Ray** | KOReader Plugin | Значение слова/фразы на основе ВСЕХ предыдущих контекстов появления |
| **Progressions** | Novelcrafter | Отслеживание как персонаж меняется по нарративу |
| **Recap / "Story So Far"** | KOReader Plugin, Kindle | AI-сводка при возврате к чтению после перерыва |
| **AI Podcast** | BookWith | 5-10 мин аудио из секции книги |
| **AI Mentor Personas** | Readever | Co-read с 5,000+ AI persona (Маркес, Толстой...) |
| **Relationship Graph (manual)** | BookLinker, BookChat Studio | Визуальный граф связей между персонажами |
| **Cross-book Semantic Search** | BookWith, Emdash | Семантическое сопоставление идей между книгами |
| **Mind Maps** | Anx Reader | AI-generated mind maps структуры книги |
| **BYOK / Multi-provider** | Calibre, Anx Reader, Book Companion | Пользователь выбирает AI-провайдера |
| **Flashcards** | BookRead | Spaced repetition из книжных пассажей |

### 4. Технологические инсайты

- **BookNLP** (892 stars) — gold standard для character extraction: name clustering, coreference resolution, speaker attribution
- **Coreference resolution** критически важна: NER alone пропускает много co-occurrences персонажей
- **Co-occurrence within 14-word window** — проверенная эвристика для детекции взаимодействий персонажей
- **Amazon "Ask This Book"**: "only reveals information up to your current reading position" — точно та же философия что у fancai
- **fiction-ner-750m** — training data для маленьких моделей fiction NER (184M params на edge)
- **Readwise** использует GPT-5 Mini default, GPT-4.1-mini included — показывает тренд к дешёвым fast моделям

### 6. Угрозы (обновлено)

1. **FantasyRead.ai** — ГЛАВНАЯ УГРОЗА. Мультиплатформенный, inline entity context, offline, 4.8 rating. Но English only, нет иллюстраций
2. **Amazon** может расширить "Ask This Book" + добавить structured character glossaries (у них данные и модели)
3. **Google** скоро запустит "Ask Gemini" в Play Books
4. **Open-source readers** (Readest 18.5K, Koodo 26.2K) активно растут и могут добавить entity tracking
5. **Book Companion** — если жив, ближайший конкурент с X-Ray + spoiler-free + русский
6. **StorySide** — инновационный подход к spoiler-free с shared memory
7. **Where We Left Off** — open-source с entity resolution + relationship graphs (пока ранняя стадия)
8. **Kobo** планирует AI Recaps
9. **Merrilin** — spoiler-free компаньон в pre-launch (статус неясен)

### 6. Возможности

1. **AI-иллюстрации** — blue ocean, практически нет конкуренции на web
2. **Русскоязычный рынок** — Yandex Books = TTS-only, Book Companion поддерживает RU но не фокусируется
3. **Fantasy/Sci-Fi community** — потребность в character tracking для сложных серий (Wheel of Time, Malazan, Stormlight Archive)
4. **Relationship graph** — BookLinker делает вручную, fancai может автоматически
5. **"Progressions"** — отслеживание развития персонажа по нарративу (Novelcrafter делает для авторов, никто для читателей)
6. **Multi-provider AI** — тренд к BYOK, fancai уже на OpenRouter
7. **Self-hosted / privacy** — растущий тренд (Calibre, BookLore)

---

## Рекомендации для roadmap fancai

### Высокий приоритет (конкурентное преимущество)
- Усилить entity system — это ключевой дифференциатор наряду с иллюстрациями
- Добавить relationship graph visualization (автоматический, по данным entity system)
- Реализовать "Recap" / "Story So Far" — при возврате к чтению после перерыва

### Средний приоритет (дифференциация)
- "Term X-Ray" — значение слова/фразы на основе всех предыдущих контекстов (отличная UX-фича KOReader)
- "Progressions" — отслеживание развития персонажа по главам (концепт Novelcrafter для readers)
- BYOK / multi-provider support — тренд рынка

### Низкий приоритет (nice-to-have)
- AI TTS — commodity, конкуренция огромная
- AI podcast из секций книги — уникально, но нишево
- Cross-book semantic search — для power readers
- Mind maps — Anx Reader уже делает, не уникально

---

## Дополнительные находки (второй раунд)

### Epub-Illustrator — БЛИЗКИЙ АНАЛОГ ИЛЛЮСТРАЦИЙ fancai (NEW!)
- **URL**: https://github.com/beinoriusju/epub-illustrator
- **Платформы**: CLI (Python)
- **Тип**: Open source (MIT)
- **AI-фичи**:
  - Анализирует EPUB контент, определяет точки для иллюстраций
  - Gemini 2.5 Pro для генерации описаний сцен
  - Stability AI для генерации изображений
  - Пересобирает EPUB с встроенными иллюстрациями
- **Tech stack**: Python, Gemini, Stability AI
- **Обновление**: 2025
- **Чего НЕТ**: Reader UI, entity tracking, spoiler-free, real-time generation
- **Релевантность**: **ВЫСОКАЯ для иллюстраций** — standalone реализация illustration pipeline fancai. Не reader, а CLI tool для post-processing. Показывает что другие разработчики идут тем же путём.

### vladthelittleone/epub-ai-reader (NEW!)
- **URL**: https://github.com/vladthelittleone/epub-ai-reader
- **Платформы**: Web (Next.js)
- **Тип**: Open source
- **AI-фичи**: AI translation (10 языков), interactive chat по книге, сохранение прогресса
- **Tech stack**: Next.js, React, OpenAI/OpenRouter API, epub.js, Tailwind CSS
- **Обновление**: 2025 ("vibecoded with love")
- **Релевантность**: Средняя — похожий стек (React, epub.js, OpenRouter!), но фокус на перевод/чат. Русский разработчик.

### Messync (NEW!)
- **URL**: https://messync.com
- **Платформы**: Web (beta)
- **Тип**: Коммерческий (все premium фичи бесплатны в beta)
- **AI-фичи**: Chat с EPUB/MOBI, **character development tracking**, theme analysis, study guide generation, multi-book synthesis, exact quote finding
- **Релевантность**: Средняя — упоминает "character development tracking", но chat-based, не structured glossary.

### Webnovels AI (NEW!)
- **URL**: https://webnovelsai.com
- **Платформы**: Web
- **AI-фичи**: AI translation с **auto-generated glossary** персонажей, терминов, мест. Consistent terminology across chapters/volumes.
- **Форматы**: EPUB, PDF, TXT, DOCX
- **Ценообразование**: Free tier + paid (own GPT key)
- **Релевантность**: Средняя — auto-glossary для перевода close к entity system, но translation-focused.

### FABLE — Fiction NER Model (NEW!)
- **URL**: https://blog.salad.com/fable/ | https://huggingface.co/datasets/SaladTechnologies/fiction-ner-750m
- **Что делает**: Domain-adapted DeBERTa модель, обученная на 1B слов fiction для Named Entity Recognition
- **Данные**: 750M token dataset с fiction-specific entity labels (Characters, Objects, Locations)
- **Компания**: SaladTechnologies / SaladCloud
- **Open source**: DA (model + dataset на HuggingFace)
- **Релевантность**: **ВЫСОКАЯ** — может быть использована для entity extraction в fancai. Напрямую решает проблему что standard NER models fail on fiction text.

### Rebind (NEW!)
- **URL**: https://rebind.ai
- **Платформы**: Web
- **AI-фичи**: 20+ часов экспертного комментария на книгу (Margaret Atwood, Roxane Gay), AI-driven дискуссии
- **Ценообразование**: $30/книга или $120/год
- **Релевантность**: Низкая — фокус на literary classics с экспертным commentary, не fiction entity tracking.

### Bookly — Manual Character Tracking (NEW!)
- **URL**: https://getbookly.com
- **Платформы**: iOS, Android
- **AI-фичи**: Ручной ввод персонажей с traits (death, physical traits, relationships). НЕ AI-powered extraction.
- **Релевантность**: Средняя по концепту — character tracking в reader app, но полностью ручной, нет AI.

### Bookrack (NEW!)
- **URL**: https://apps.apple.com/us/app/bookrack-ai-book-tracker/id6738010131
- **Платформы**: iOS
- **AI-фичи**: AI chapter summaries, AI chat (themes, characters, plots), AI quizzes
- **Релевантность**: Низкая — AI chat mentions characters, но нет structured glossary.

### KOAssistant (NEW!)
- **URL**: https://github.com/zeeyado/koassistant.koplugin
- **Платформы**: KOReader plugin (e-ink, Android, Linux)
- **AI-фичи**: Fork/расширение assistant.koplugin — spoiler-free X-Ray с категориями (Cast, World, Ideas, Lexicon, Story Arc), tap-to-reveal spoiler protection, 16 AI providers
- **Релевантность**: Высокая — ещё одна реализация spoiler-free X-Ray для KOReader. Растущее community.

### Lorebook Generator for NovelAI (NEW!)
- **URL**: https://github.com/grahamwaters/lorebook_generator_for_novelai
- **Что делает**: Сканирует текст, находит significant nouns, генерирует NovelAI lorebooks с keyword activation
- **Релевантность**: Средняя — концепт automated lorebook/wiki generation из текста близок к entity system fancai.

### Bookaroozie
- **URL**: https://bookaroozie.com/
- **Платформы**: Web
- **Тип**: Коммерческий (one-time: Free / $39 / $69)
- **AI-фичи**: Highlight -> chat с AI (ChatGPT, Claude), AI explanations
- **Релевантность**: Низкая — generic AI chat, нет entity tracking.

### Hello Literature
- **URL**: https://www.helloliterature.ai/
- **Платформы**: iOS, Android
- **Компания**: Humy.ai
- **AI-фичи**: Чат с литературными персонажами, voice generation, US/British/Russian/Japanese/Indian literature
- **Релевантность**: Низкая — не reader, а chat с персонажами.

### Epub Reader with AI — Books Pro (Kairoos Solutions)
- **URL**: https://apps.apple.com/us/app/epub-reader-with-ai-books-pro/id6448806720
- **Платформы**: iOS only
- **AI-фичи**: AI summaries, translations, discussions
- **Релевантность**: Низкая — generic AI assistant в reader.

### book-persona-retriever
- **URL**: https://github.com/nicolay-r/book-persona-retriever
- **Stars**: 8, 410 commits
- **Что делает**: Profiling personalities литературных персонажей через анализ диалогов (13,000 Project Gutenberg books)
- **Релевантность**: Средняя — идеи для расширения entity system (personality traits).

### ⚠️ Kairos (Every.to) — ПРЕДОСТЕРЕЖЕНИЕ
- Запущен в начале 2025, **мёртв через несколько дней**
- 1,000 загрузок в 1-й день, "ghost town by day 3"
- **Урок для fancai**: generic "chat with book" не удерживает пользователей. Structured entity glossary + illustrations — лучшая стратегия retention чем generic AI chat.

---

---

## Итоговая статистика исследования

- **Дата**: 10 марта 2026
- **Агенты**: 5 параллельных + 1 дополнительный раунд ручного поиска
- **Поисковые запросы**: 300+
- **Проанализировано продуктов**: 55+
- **Платформы**: Web, iOS, Android, Desktop (Win/Mac/Linux), E-ink, CLI
- **Источники**: GitHub, ProductHunt, App Store, Play Store, web, academic papers, HuggingFace

## Финальный вердикт

**fancai остаётся единственным продуктом, совмещающим:**
1. AI entity glossary/wiki со spoiler-free chapter-level tracking
2. AI-иллюстрации при чтении
3. Web-платформа

**Ближайшие конкуренты покрывают максимум 2 из 3:**
- FantasyRead.ai: (1) + web ✓, но нет иллюстраций
- Where We Left Off: (1) + web ✓, но нет иллюстраций, только PDF
- Epub-Illustrator: иллюстрации ✓, но нет entity tracking, не reader
- PPG Text2Image: иллюстрации ✓, но Android only, нет entity tracking

**AI-иллюстрации в reading flow — главный дифференциатор fancai.**

# Исследование: замена epub.js в fancai

**Дата:** 2026-03-10
**Цель:** Найти качественную, поддерживаемую, коммерчески пригодную замену epub.js для подписочной модели распространения fancai

---

## 1. Текущее использование epub.js в fancai

### 1.1 Масштаб интеграции

epub.js глубоко интегрирован в проект: **25+ хуков**, **45+ методов API**, **34 файла** напрямую используют epub.js API.

**Единственная точка входа:** `ePub(arrayBuffer)` в `useEpubLoader.ts` — создание объекта Book.

### 1.2 Используемые API по категориям

#### Книга и жизненный цикл
| API | Файл | Назначение |
|-----|-------|-----------|
| `ePub(arrayBuffer)` | useEpubLoader.ts | Создание книги из ArrayBuffer |
| `book.ready` | useEpubLoader.ts | Ожидание инициализации |
| `book.destroy()` | useEpubLoader.ts | Освобождение ресурсов |
| `book.renderTo(el, opts)` | useEpubRendition.ts | Создание Rendition |

#### Навигация и отображение
| API | Файл | Назначение |
|-----|-------|-----------|
| `rendition.display(target)` | useEpubNavigation.ts, useBookSearch.ts | Переход по CFI/индексу |
| `rendition.next()` / `prev()` | useEpubNavigation.ts | Перелистывание |
| `rendition.currentLocation()` | useCFITracking.ts и др. | Текущая позиция |
| `rendition.getContents()` | useTextSelection.ts и др. | Доступ к iframe-содержимому |
| `rendition.getRange(cfi)` | useAnnotationRendering.ts | CFI → DOM Range |

#### Темы и стили
| API | Файл | Назначение |
|-----|-------|-----------|
| `rendition.themes.default(styles)` | useEpubRendition.ts | Стили по умолчанию |
| `rendition.themes.register(name, styles)` | useEpubThemes.ts | Регистрация темы |
| `rendition.themes.select(name)` | useEpubThemes.ts | Переключение темы |
| `rendition.themes.fontSize(size)` | useEpubThemes.ts | Размер шрифта |

#### Content Hooks (критично для кастомизации DOM)
| API | Файл | Назначение |
|-----|-------|-----------|
| `rendition.hooks.content.register(cb)` | useContentHooks.ts, useTouchNavigation.ts, useAnnotationRendering.ts | Инъекция кода в iframe |
| `rendition.hooks.content.deregister(cb)` | useContentHooks.ts и др. | Удаление хука |

#### Система событий (8 типов)
| Событие | Назначение | Где используется |
|---------|-----------|-----------------|
| `rendered` | Секция отрисована | useEpubRendition.ts, useAnnotationRendering.ts |
| `relocated` | Пользователь перешёл на новую позицию | useCFITracking.ts, useChapterManagement.ts, useDescriptionHighlighting.ts |
| `selected` | Выделение текста | useTextSelection.ts |
| `markClicked` | Клик по аннотации | useTextSelection.ts |
| `click` | Клик по странице | useTextSelection.ts, useTouchNavigation.ts |
| `touchstart` / `touchend` | Тач-события | useTouchNavigation.ts |
| `resized` | Изменение размера | useResizeHandler.ts |
| `layout` / `displayed` | Изменение лейаута | useEpubIOSFixes.ts |

#### Locations (прогресс чтения)
| API | Файл | Назначение |
|-----|-------|-----------|
| `book.locations.generate(chars)` | useLocationGeneration.ts | Генерация карты позиций |
| `book.locations.save()` / `load()` | useLocationGeneration.ts | Сериализация для IndexedDB |
| `book.locations.percentageFromCfi(cfi)` | useCFITracking.ts | CFI → % прогресса |
| `book.locations.locationFromCfi(cfi)` | useCFITracking.ts | CFI → номер "страницы" |

#### Spine и навигация по оглавлению
| API | Файл | Назначение |
|-----|-------|-----------|
| `book.spine.items` / `get()` / `each()` | useChapterMapping.ts, useBookSearch.ts | Итерация по главам |
| `book.navigation.toc` | useToc.ts | Оглавление |
| `book.loaded.navigation` / `metadata` | useToc.ts, useBookMetadata.ts | Промисы загрузки |

#### Внутренние API (workarounds для iOS)
| API | Файл | Назначение |
|-----|-------|-----------|
| `rendition.manager.layout.divisor` | useEpubIOSFixes.ts | Принудительно 1 колонка на iOS |
| `rendition.manager.stage.container` | useEpubNavigation.ts | Доступ к скроллу |
| `rendition.manager.gestures.destroy()` | useEpubIOSFixes.ts | Отключение жестов epub.js |
| `rendition.spread('none', 99999)` | useEpubIOSFixes.ts | Одноколоночный режим |

### 1.3 CFI-центричная архитектура

Вся система позиционирования в fancai построена на EPUB CFI:
- **Закладки** — хранятся как CFI
- **Хайлайты** — хранятся как CFI-диапазоны (cfi_range)
- **Прогресс чтения** — CFI текущей позиции
- **Поиск сущностей** — CFI позиций упоминаний в тексте
- **Подсветка описаний** — 8 стратегий поиска с fallback, все возвращают CFI

Утилиты в `cfiUtils.ts`: `compareCFI()`, `isCFIBefore()`, `isCFIAfter()`.

### 1.4 Кастомный рендеринг аннотаций

**Критическая особенность:** fancai НЕ использует встроенные аннотации epub.js (SVG overlay), т.к. они не поддерживают `background-color` и `text-color`. Вместо этого реализован кастомный DOM-wrapping через TreeWalker + Range API в `useAnnotationRendering.ts` (460+ строк).

### 1.5 Известные workarounds для epub.js

1. **iOS: "1 страница = 2 экрана"** — принудительный divisor=1
2. **Анонимный `<span>` вокруг body** — сдвигает CFI-пути на 1 уровень
3. **Мобильный percentageFromCfi() возвращает 0** — кастомный fallback
4. **Конфликт жестов** — отключение epub.js gestures на iOS
5. **SVG overlay не поддерживает стили текста** — кастомный DOM wrapping
6. **Смещение страниц при ресайзе** — кеширование высоты рендера

---

## 2. Обзор альтернатив

### 2.1 foliate-js — основной кандидат

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/johnfactotum/foliate-js](https://github.com/johnfactotum/foliate-js) |
| **Лицензия** | **MIT** (коммерчески свободна) |
| **Тип** | Библиотека (встраиваемая) |
| **Stars** | ~913 |
| **Последняя активность** | Январь 2025 (активная разработка) |
| **Архитектура** | iframe (blob: URL) + Web Components (Shadow DOM) |
| **Форматы** | EPUB, MOBI, KF8, FB2, CBZ, PDF (экспериментально) |
| **CFI** | Полная поддержка (парсинг, сравнение, Range ↔ CFI) |
| **TypeScript** | Нет (чистый JS, ES модули) |
| **Размер** | ~376 KB (без зависимостей) vs epub.js ~6.4 MB |

**Архитектура рендеринга:**
- Основной элемент `<foliate-view>` — Web Component с closed Shadow DOM
- Дочерние компоненты: `<foliate-paginator>` (reflowable) и `<foliate-fxl>` (fixed-layout)
- Каждая секция/глава загружается в sandboxed iframe (аналогично epub.js)
- Пагинация через CSS multi-column (та же стратегия, что и epub.js)
- **Улучшение:** bisecting-алгоритм для определения видимой области (точнее epub.js)
- Переключение paginated/scrolled без перезагрузки книги

**API навигации:**
```
goTo(target)         — переход по CFI/href/секции
goToFraction(frac)   — переход по проценту (0–1)
goLeft() / goRight() — направленное перелистывание
prev() / next()      — постраничная навигация
```

**CFI-модуль (`epubcfi.js`):**
```
parse(cfi)           — парсинг CFI-строки
toRange(doc, parts)  — CFI → DOM Range
fromRange(range)     — DOM Range → CFI
compare(a, b)        — сравнение позиций
collapse(cfi)        — свёртка диапазона в точку
```

**Система аннотаций (`overlayer.js`):**
- SVG-оверлей с примитивами: highlight, underline, strikethrough, squiggly, outline
- Настраиваемые цвета, прозрачность, blend modes
- Hit-testing для клика по аннотации
- Поддержка vertical writing mode
- **Ограничение:** SVG overlay НЕ может менять inline-стили текста (text-color)

**Система событий:**
| Событие | Данные | Аналог в epub.js |
|---------|--------|-----------------|
| `relocate` | `{ tocItem, cfi, fraction, range, index }` | `relocated` |
| `load` | `{ doc, index }` | `rendered` |
| `create-overlayer` | `{ doc, index, attach }` | — (нет аналога) |
| `link` | cancelable | — |
| `external-link` | cancelable | — |

**Темизация:**
- `paginator.setStyles(styles)` — инъекция CSS в iframe
- CSS-фильтры через `::part(filter)`
- Менее структурировано, чем epub.js themes API (нет register/select)

**Продакшн-использование:**
- **Foliate** — Linux desktop reader
- **Readest** (18.6k stars) — кроссплатформенный ридер на Next.js + Tauri
- **Booklore** — мигрировал с epub.js на foliate-js

**Известные проблемы:**
1. API явно помечено как **нестабильное** — нет semver, нет changelog
2. Нет TypeScript-типов (автор принципиально против TS-порта)
3. iOS: выделение текста воспринимается как свайп (#86)
4. Chrome Android: сдвиг лейаута при выделении (#84)
5. Firefox Android: pinch zoom ломает touch-пагинацию (#79)
6. Нет continuous scrolling между секциями
7. Поиск "extremely slow" по собственной документации
8. Solo-maintainer (bus factor = 1)

---

### 2.2 Readium Web (ts-toolkit) — enterprise-решение

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/readium/ts-toolkit](https://github.com/readium/ts-toolkit) |
| **Лицензия** | **BSD-3-Clause** (коммерчески свободна) |
| **Тип** | Модульный тулкит (3 npm-пакета) |
| **Stars** | ~130 |
| **Последняя активность** | Февраль 2026 (Navigator 2.3.0) |
| **TypeScript** | Полный (97.3% кодовой базы) |
| **CFI** | **НЕТ** — использует Readium Locators |
| **Организация** | EDRLab / Readium Foundation |

**Архитектура:**
- `@readium/shared` — общие модели
- `@readium/navigator` — веб-навигатор
- `@readium/navigator-html-injectables` — инъекции в iframe

**Readium Locators vs CFI:**
Readium сознательно отказался от EPUB CFI в пользу собственного формата Locator, который сочетает:
- `progression` (% прогресса)
- `cssSelector` (CSS-селектор элемента)
- `text` (текстовый контекст: before/highlight/after)
- `position` (абсолютная позиция)

**Это означает полную перезапись** системы позиционирования fancai (закладки, хайлайты, прогресс, поиск сущностей).

**Возможности:**
- EPUB reflowable + fixed-layout
- Аудиокниги и комиксы/манга
- Annotations через Decorator API (W3C Web Annotation Data Model)
- Readium CSS — профессиональная типографика
- Пользовательские настройки (шрифты, интервалы, темы)
- Content protection (LCP DRM)

**Продакшн-использование:**
- NYPL (Нью-Йоркская публичная библиотека)
- Bokbasen (Норвежский дистрибьютор электронных книг)
- Bibliotheca CloudLibrary
- Thorium Web (референсная реализация)
- 100+ приложений по всему миру через Readium Foundation

**Риски:**
- Полный отказ от CFI → масштабная миграция данных
- Требует серверный компонент для оптимальной работы
- Маленькое сообщество (130 stars)
- Более крутая кривая обучения

---

### 2.3 R2D2BC (D2Reader) — встраиваемый Readium

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/d-i-t-a/R2D2BC](https://github.com/d-i-t-a/R2D2BC) |
| **Лицензия** | **Apache 2.0** (коммерчески свободна) |
| **Stars** | ~65 |
| **Последний релиз** | v2.4.12 (декабрь 2025) — 215 релизов |
| **TypeScript** | Полный (75.4%) |
| **CFI** | Нет (Readium Locators) |

**Особенности:**
- Специально спроектирован для встраивания (намеренно минимальный UI)
- EPUB reflowable + fixed-layout
- Закладки, аннотации, хайлайты
- Полнотекстовый поиск
- TTS / Read Aloud + Media Overlays
- Инъекция шрифтов, CSS, JavaScript
- Модульная архитектура с callbacks

**Продакшн-использование:**
- CAST Clusive (платформа доступности)
- Bokbasen, NYPL, Bibliotheca CloudLibrary, Bluefire Reader

**Риски:**
- Маленькое сообщество (65 stars)
- 45 открытых PR — ограниченная пропускная способность мейнтейнера
- Нет CFI

---

### 2.4 Vivliostyle — движок CSS-вёрстки

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/vivliostyle/vivliostyle.js](https://github.com/vivliostyle/vivliostyle.js) |
| **Лицензия** | **AGPL v3** — НЕСОВМЕСТИМА с коммерческим встраиванием |
| **Stars** | ~737 |
| **TypeScript** | Частичный (54.9%) |

**Вердикт:** AGPL-лицензия **исключает коммерческое использование** без раскрытия кода. Основная специализация — CSS-типографика и генерация PDF, а не интерактивное чтение. Нет API аннотаций/закладок.

---

### 2.5 Bibi — встраиваемый ридер

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/satorumurmur/bibi](https://github.com/satorumurmur/bibi) |
| **Лицензия** | **MIT** |
| **Stars** | ~902 |
| **Последняя активность** | Июль 2020 — **ЗАБРОШЕН** |

**Вердикт:** Заброшен 6 лет назад. Нет TypeScript, нет CFI. **Не рекомендуется.**

---

### 2.6 @intity/epub-js — активный форк epub.js

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/intity/epub-js](https://github.com/intity/epub-js) |
| **Лицензия** | **BSD** (как epub.js) |
| **CFI** | Да (унаследован от epub.js) |
| **Совместимость** | **НЕТ** — ломающие изменения API |

**Вердикт:** Интересен как модернизация epub.js, но ломающий API делает миграцию не проще, чем переход на foliate-js. Маленькое сообщество, solo-разработчик.

---

### 2.7 Readest — подтверждение жизнеспособности foliate-js

| Параметр | Значение |
|----------|---------|
| **URL** | [github.com/readest/readest](https://github.com/readest/readest) |
| **Лицензия** | **AGPL-3.0** — НЕСОВМЕСТИМА |
| **Stars** | 18.6k |

**Вердикт:** Полноценное приложение (не библиотека). **AGPL** исключает прямое использование. Но **подтверждает**, что foliate-js работает в продакшне на масштабе (18.6k stars, Next.js + Tauri, TypeScript-интеграция).

---

## 3. Сводная таблица

| Библиотека | Лицензия | Stars | Активна | TS | CFI | Аннотации | Рекомендация |
|-----------|---------|-------|---------|-----|-----|-----------|-------------|
| **epub.js** (текущая) | BSD | 6.9k | 2020 (мёртв) | Частичный | Да | SVG (ограниченный) | Заменять |
| **foliate-js** | MIT | 913 | Янв 2025 | Нет | Да | SVG overlay | **1-й выбор** |
| **Readium ts-toolkit** | BSD-3 | 130 | Фев 2026 | Полный | Нет (Locators) | Decorator API | **2-й выбор** |
| **R2D2BC** | Apache 2.0 | 65 | Дек 2025 | Полный | Нет (Locators) | Да | 3-й выбор |
| **Vivliostyle** | AGPL | 737 | Янв 2026 | Частичный | Нет | Нет | Исключён |
| **Bibi** | MIT | 902 | 2020 (мёртв) | Нет | Нет | Нет | Исключён |
| **@intity/epub-js** | BSD | Low | Активна | Неизвестно | Да | Да | Рискованный |
| **Readest** | AGPL | 18.6k | Активна | Полный | — | — | Исключён |

---

## 4. Анализ совместимости с fancai

### 4.1 foliate-js: карта миграции

#### Прямые соответствия API

| fancai (epub.js) | foliate-js | Сложность |
|-----------------|-----------|-----------|
| `ePub(arrayBuffer)` | `view.open(blob)` | Низкая |
| `rendition.display(cfi)` | `view.goTo(cfi)` | Низкая |
| `rendition.next()` / `prev()` | `view.next()` / `view.prev()` | Низкая |
| `rendition.currentLocation()` | событие `relocate` | Средняя (другая модель) |
| `book.navigation.toc` | `book.toc` | Низкая |
| `book.spine.items` | `book.sections` | Средняя (другой интерфейс) |
| `book.locations.generate()` | `view.goToFraction()` | Средняя (другая концепция) |
| `book.locations.percentageFromCfi()` | `relocate.fraction` | Низкая |
| `rendition.themes.*` | `paginator.setStyles()` | Средняя (нет register/select) |
| `rendition.hooks.content.register()` | событие `load` | Низкая |
| `rendition.getContents()` | через `load` event | Средняя |
| `rendition.getRange(cfi)` | `epubcfi.toRange(doc, parsed)` | Средняя |
| CFI-утилиты | `epubcfi.compare()` и др. | Низкая |
| `rendition.on('relocated')` | `view.addEventListener('relocate')` | Низкая |
| `rendition.on('selected')` | кастомная реализация через `load` | Высокая |
| `rendition.on('rendered')` | `view.addEventListener('load')` | Низкая |

#### Проблемные области миграции

**1. Система аннотаций (Высокая сложность)**
- fancai: кастомный DOM wrapping (TreeWalker + Range) для поддержки `text-color`
- foliate-js: SVG overlay (не поддерживает inline text-color)
- **Решение A:** Продолжить кастомный DOM wrapping на iframe-контенте foliate-js (через событие `load` для доступа к document)
- **Решение B:** Перейти на SVG overlay foliate-js, отказавшись от text-color (только background-color)
- **Решение C:** Гибрид — SVG overlay для обычных хайлайтов + DOM wrapping только для text-color

**2. Locations / прогресс (Средняя сложность)**
- fancai: `book.locations.generate(1600)` → карта позиций → IndexedDB кеширование
- foliate-js: нет эквивалента locations. Прогресс через `fraction` (0–1) в событии `relocate`
- **Решение:** Использовать `fraction` как основу прогресса. Миграция существующих данных: CFI → fraction через однократную конвертацию

**3. TypeScript типы (Средняя сложность)**
- foliate-js не имеет TS-типов
- **Решение:** Написать `.d.ts` файлы (~200-300 строк для используемого API). Readest показывает, что это реально

**4. iOS workarounds (Неизвестная сложность)**
- fancai имеет обширные iOS-фиксы для epub.js
- foliate-js: документированы проблемы с iOS (выделение = свайп)
- **Решение:** Потребуется новый набор iOS-фиксов. Часть текущих workarounds станет ненужной, но появятся новые

**5. Система поиска (Средняя сложность)**
- fancai: итерация по spine + поиск в каждой главе
- foliate-js: `async generator` для поиска (documented as "extremely slow")
- **Решение:** Текущая реализация поиска в fancai (batch по 5 глав на rAF) может быть адаптирована

**6. Тема-менеджер (Низкая сложность)**
- fancai: `themes.register()` / `themes.select()`
- foliate-js: `setStyles()` — инъекция CSS
- **Решение:** Обёртка: хранить темы как объекты стилей, применять через `setStyles()`

### 4.2 Readium ts-toolkit: карта миграции

#### Масштаб перезаписи: ЗНАЧИТЕЛЬНЫЙ

| Область | Объём работ |
|---------|-----------|
| CFI → Locators | Полная перезапись всех 25+ хуков + миграция данных в БД |
| Bookmark/Highlight модель | Замена cfi/cfi_range на Locator JSON |
| Серверный компонент | Новый микросервис для Readium publication server |
| Entity CFI population | Полная перезапись useEntityCFIPopulation.ts |
| IndexedDB cache | Новый формат кеширования |
| API sync | Изменение контрактов sync.py |

**Оценка:** миграция на Readium — это по сути **переписывание всего EPUB-related frontend** (20+ хуков, ~5000 строк), плюс backend-изменения.

---

## 5. Рекомендации

### 5.1 Первый выбор: foliate-js

**Обоснование:**
- **MIT лицензия** — полная свобода коммерческого использования
- **CFI-совместимость** — минимизирует объём миграции (наша CFI-система сохраняется)
- **Аналогичная архитектура** — iframe + CSS multi-column (знакомые паттерны)
- **Проверена в продакшне** — Readest (18.6k stars) демонстрирует жизнеспособность с TypeScript/React
- **Активная разработка** — в отличие от мёртвого epub.js
- **Малый размер** — 376 KB vs 6.4 MB (17x меньше)

**Риски:**
- Нестабильный API (нет semver)
- Нет TypeScript-типов (нужно писать самим)
- Solo-maintainer
- Мобильные проблемы (iOS, Android)

**Стратегия миграции:**
1. Написать TypeScript-обёртку/адаптер поверх foliate-js
2. Создать слой совместимости, сохраняющий интерфейс существующих хуков
3. Мигрировать хук за хуком, сохраняя работающую систему
4. Для аннотаций: начать с SVG overlay, добавить DOM wrapping для text-color по необходимости

### 5.2 Второй выбор: Readium ts-toolkit

**Когда выбрать Readium вместо foliate-js:**
- Если планируется поддержка DRM (LCP)
- Если планируются аудиокниги / мультимедиа
- Если стабильность API важнее объёма миграции
- Если есть ресурсы на 2-3 месяца рефакторинга

### 5.3 Не рекомендуется

- **Readest** — AGPL, исключён
- **Vivliostyle** — AGPL, исключён
- **Bibi** — заброшен
- **@intity/epub-js** — ломающий API, маленькое сообщество
- **Оставаться на epub.js** — проект мёртв с 2020 года, 485 открытых issues

---

## 6. Источники

- [epub.js GitHub](https://github.com/futurepress/epub.js/)
- [foliate-js GitHub](https://github.com/johnfactotum/foliate-js)
- [Readium ts-toolkit GitHub](https://github.com/readium/ts-toolkit)
- [R2D2BC GitHub](https://github.com/d-i-t-a/R2D2BC)
- [Vivliostyle GitHub](https://github.com/vivliostyle/vivliostyle.js/)
- [Bibi GitHub](https://github.com/satorumurmur/bibi)
- [Readest GitHub](https://github.com/readest/readest)
- [@intity/epub-js npm](https://www.npmjs.com/package/@intity/epub-js)
- [Readium CFI Discussion](https://github.com/readium/readium-cfi-js/wiki/Some-thoughts-about-CFIs)
- [Booklore: epub.js replacement discussion](https://github.com/booklore-app/booklore/issues/1831)
- [Readest DeepWiki](https://deepwiki.com/readest/readest)
- [ePUB.js vs Readium.js comparison](https://kitaboo.com/epub-js-vs-readium-js-comparison-of-epub-readers/)
- [foliate-js npm](https://www.npmjs.com/package/foliate-js)
- [Readium Web overview](https://readium.org/web/)