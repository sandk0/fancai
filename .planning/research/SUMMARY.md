# Project Research Summary

**Project:** fancai v1.3 -- iOS Reader Navigation Fixes
**Domain:** iOS touch event pipeline для iframe-based EPUB reader
**Researched:** 2026-03-14
**Confidence:** HIGH

## Executive Summary

fancai v1.3 -- milestone по починке полностью нерабочей навигации (тапы, свайпы, выделение текста) на iOS Safari, iOS Chrome и PWA standalone. Все четыре исследования сходятся к одной корневой причине: **capture-phase `stopPropagation()` в `useEpubIOSFixes.ts` (строки 136-141) полностью блокирует доставку touch-событий** к gesture controller, который слушает их в bubble phase. Этот блокер был добавлен как "safety net" для отключения epub.js Snap gesture system, но epub.js Snap уже корректно деактивируется через `manager.gestures.destroy()` + `manager.snap = noop` в том же файле. Удаление capture-phase blockers -- хирургическое изменение (3 строки addEventListener + 1 функция-обработчик), которое должно разблокировать весь touch pipeline.

Рекомендуемый подход -- итеративный, диагностика-first. Сначала добавить debug-логирование в gesture controller для визуализации touch-событий на реальном iOS устройстве (DebugPanel `/?debug=1` уже существует). Затем удалить capture-phase blockers и верифицировать, что touch-события начали доставляться. После этого -- поэтапное тестирование тапов, свайпов, выделения текста, iOS overlay (center zone), и edge cases (PWA standalone, landscape, keyboard). Новых зависимостей и новых файлов не требуется -- все изменения в существующем коде.

Ключевые риски: (1) **Противоречие между исследованиями по `touch-action` CSS.** STACK.md утверждает, что `pan-x pan-y` поддерживается iOS 13+ (подтверждено caniuse.com), PITFALLS.md и FEATURES.md утверждают обратное -- что iOS Safari поддерживает только `auto` и `manipulation`. Caniuse -- более авторитетный источник, но это ТРЕБУЕТ проверки на реальном устройстве через computed style. (2) iOS overlay (`gesture-controller-ios-overlay`) перехватывает touch-события в center zone (70% ширины экрана), блокируя свайпы. После починки root cause overlay, вероятно, станет избыточен. (3) PWA standalone mode имеет недокументированные отличия в обработке touch-событий -- требуется тестирование на физическом устройстве.

## Key Findings

### Рекомендуемый стек

Подробнее: [STACK.md](STACK.md)

Новых зависимостей НЕ требуется. Все проблемы решаются правильным использованием существующих Web APIs. Ноль новых npm-пакетов.

**Ключевые технологии для фикса:**
- **Touch Events API** (текущий): основной gesture detection в useGestureController -- надёжнее на iOS чем Pointer Events в iframe
- **Pointer Events API** (fallback, вариант B): для parent document listeners (scroll lock) и как план B если Touch Events окажутся ненадёжны после фикса
- **`touch-action` CSS**: декларативный контроль браузерных жестов -- текущий `pan-x pan-y` вероятно работает на iOS 13+ (caniuse), но требует верификации computed style
- **Safari Web Inspector**: единственный способ полноценной отладки iframe на реальном iOS устройстве
- **DebugPanel `/?debug=1`**: расширить для iOS-специфичной диагностики touch-событий (координаты, cancelable, FSM state)
- **Eruda 3.4.x** (dev-only, опционально): in-app DevTools для standalone PWA, ~100KB gzipped

**Стратегия фикса (два варианта):**
- Вариант A (рекомендуемый): Убрать capture-phase blockers + оставить `gestures.destroy()` + touch events в iframe
- Вариант B (fallback): Перейти на Pointer Events в useGestureController если вариант A недостаточен

### Ожидаемые фичи

Подробнее: [FEATURES.md](FEATURES.md)

**Must have (table stakes -- ридер сломан без них):**
- Тап по краю страницы = перелистывание (базовая навигация)
- Свайп = перелистывание с follow-finger (стандарт iOS-ридеров)
- Выделение текста long-press (core reading feature)
- Центральный тап = показать/скрыть UI (стандарт всех ридеров)
- Отсутствие двойного перелистывания (одно касание = одна страница)

**Should have (дифференциаторы):**
- Debug overlay с визуализацией touch events (dev-only, ускоряет отладку)
- Follow-finger spring physics на iOS (плавность Apple Books)
- Тап на description/entity в edge zone (интерактивные элементы у краёв)

**Defer (v2+):**
- Haptic feedback (navigator.vibrate() не поддерживается iOS Safari)
- Настраиваемые зоны тапов
- Полная миграция на Pointer Events

### Архитектурный подход

Подробнее: [ARCHITECTURE.md](ARCHITECTURE.md)

Принцип: **единый конвейер событий без capture-phase блокировки.** Все touch-обработчики для gesture detection должны регистрироваться в bubble phase на iframe document. Capture phase -- ТОЛЬКО для предотвращения browser defaults через preventDefault.

**Ключевые компоненты:**
1. **useEpubIOSFixes.ts** -- отключение epub.js Snap, фикс layout/divisor. **Удалить capture-phase blockers**
2. **useGestureController.ts** -- FSM жестов (idle/pending/swiping/cancelled), iOS overlay для center-tap. **Добавить debug-логирование, ревизировать overlay**
3. **useContentHooks.ts** -- CSS инъекция, Touch to Search подавление, scroll lock через parent pointerdown/pointerup
4. **useTextSelection.ts** -- обработка `selected` event от epub.js (отдельный pipeline от touch events, через selectionchange)
5. **FollowFingerContainer.tsx** -- GPU-ускоренный transform wrapper (зависит от работающего touchmove)

**Критическое замечание:** `useTextSelection` работает через `selectionchange` event, который НЕ проходит через `Contents.triggerEvent` и НЕ блокируется capture-phase stopPropagation. Починка touch pipeline НЕ должна сломать text selection detection. Однако scroll lock зависит от parentDoc pointerDown -- на iOS это требует отдельной верификации.

### Критические подводные камни

Подробнее: [PITFALLS.md](PITFALLS.md)

1. **capture-phase stopPropagation убивает весь touch pipeline** -- удалить 3 addEventListener из useEpubIOSFixes.ts, оставить `gestures.destroy()` + `snap = noop`
2. **iOS overlay "проглатывает" свайпы в center zone** -- overlay обрабатывает только тапы, не имеет touchmove logic; свайпы начинающиеся в center zone (70% экрана) не доходят до gesture controller. Решение: убрать overlay после починки root cause
3. **preventDefault() молча игнорируется на passive listeners** -- iOS Safari НЕ выводит предупреждение (в отличие от Chrome). touchmove ОБЯЗАТЕЛЬНО с `{ passive: false }` если нужен preventDefault
4. **iOS Safari не генерирует события на "не-кликабельных" элементах** -- `cursor: pointer` на body iframe обязателен. Уже реализовано, но может быть перезаписано epub.js при навигации
5. **PWA standalone mode отличается от Safari tab** -- edge swipe перехватывается iOS для back-navigation, touch events могут "проходить сквозь" overlays. Требует тестирования на физическом устройстве

## Implications for Roadmap

На основании исследований предлагается 5 фаз с чёткой зависимостью: каждая следующая зависит от предыдущей.

### Phase 1: Диагностика iOS touch pipeline
**Rationale:** Без видимости происходящего на реальном iOS устройстве невозможно подтвердить корневую причину и верифицировать фиксы. DebugPanel уже существует, нужно расширить.
**Delivers:** Debug-логирование touch-событий в gesture controller (координаты, event type, cancelable, defaultPrevented, FSM state). Baseline данные: какие события доставляются/блокируются на iOS. Верификация computed style `touch-action` на iOS.
**Addresses:** Touch event диагностика (P1)
**Avoids:** Слепое кодирование без данных с реального устройства

### Phase 2: Корневой фикс touch event pipeline
**Rationale:** Capture-phase stopPropagation -- доказанная корневая причина. Удаление -- хирургическое изменение (3 строки), `gestures.destroy()` уже правильно деактивирует Snap. Это разблокирует ВСЕ последующие фазы.
**Delivers:** Touch-события доставляются в gesture controller на iOS. Тапы и свайпы начинают работать.
**Addresses:** Fix touch event pipeline (P1), Fix тап навигации (P1), Fix свайп навигации (P1)
**Avoids:** Pitfall 2 (capture-phase stopPropagation), Pitfall 3 (listener order), Pitfall 7 (preventDefault на passive)

### Phase 3: iOS overlay ревизия и gesture integration
**Rationale:** После починки touch pipeline необходимо проверить, что overlay (center zone 70%) не конфликтует со свайпами. Если iframe touch-события работают -- overlay избыточен и его нужно убрать для упрощения архитектуры.
**Delivers:** Свайпы работают во ВСЕЙ области экрана (не только edge zones). Center tap работает через iframe (не через overlay). Единый gesture pipeline.
**Addresses:** Fix center tap (P1), Follow-finger spring на iOS (P2)
**Avoids:** Pitfall 6 (iOS overlay перехватывает свайпы), Анти-паттерн 2 (дублирование touch-handling на overlay + iframe)

### Phase 4: Text selection и scroll lock на iOS
**Rationale:** Selection pipeline (selectionchange) отделён от touch pipeline, но scroll lock зависит от pointerDown tracking через parent document. На iOS pointer events в parent могут не коррелировать с touch events в iframe. Требует отдельной верификации.
**Delivers:** Long-press для выделения текста, drag handles, HighlightTooltip работают на iOS.
**Addresses:** Fix выделения текста (P1)
**Avoids:** Pitfall 10 (text selection конфликт с gesture FSM)

### Phase 5: Edge cases, PWA standalone, cleanup
**Rationale:** PWA standalone mode имеет отдельные iOS-специфичные баги (edge swipe, overlay pass-through). Landscape, keyboard dismiss, chapter transitions требуют отдельного тестирования. Финальная верификация всех сценариев.
**Delivers:** Все жесты работают в Safari tab, PWA standalone и Chrome iOS. Regression test на Android/desktop. Удаление ненужного кода.
**Addresses:** Rubber-band + chapter hints на iOS (P3), iOS timing tuning
**Avoids:** Pitfall 9 (PWA standalone differences), Pitfall 8 (coordinate offset)

### Phase Ordering Rationale

- **Строго последовательный pipeline:** Каждая фаза зависит от предыдущей. Без диагностики (Phase 1) нельзя подтвердить root cause. Без root cause fix (Phase 2) overlay ревизия и selection бессмысленны.
- **Группировка по risk:** Phase 2 (core fix) -- минимальный diff, максимальный impact. Если это не сработает, нужен fallback на Pointer Events (вариант B из STACK.md), что увеличит scope Phase 3.
- **Selection отдельно от navigation:** Text selection использует другой event pipeline (selectionchange, не touch events). Фикс навигации не должен автоматически починить selection -- нужна отдельная верификация.
- **PWA standalone последним:** Недокументированные различия iOS PWA требуют ручного тестирования на физическом устройстве. Откладываем до момента когда базовый pipeline работает.

### Research Flags

Фазы, требующие углублённого исследования при планировании:
- **Phase 2:** Если удаление capture-phase blockers не решит проблему, нужен research по Pointer Events migration (вариант B). Также: разрешить противоречие STACK.md vs PITFALLS.md по `touch-action: pan-x pan-y` vs `manipulation` -- проверить computed style на реальном устройстве.
- **Phase 4:** Cross-frame pointer events (pointerDown tracking через parentDoc) на iOS -- недостаточно документировано, нужна эмпирическая проверка.
- **Phase 5:** PWA standalone touch event differences -- Apple не документирует, нужно эмпирическое тестирование.

Фазы со стандартными паттернами (research-phase не нужен):
- **Phase 1:** Стандартное debug-логирование, DebugPanel уже существует, нужно только расширить.
- **Phase 3:** iOS overlay -- чистый frontend рефакторинг (удаление ~50 строк), стандартные паттерны.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Прямой анализ epub.js source (snap.js, contents.js, constants.js), caniuse данные по touch-action, Apple official docs, Patrick H. Lauke touch events research |
| Features | HIGH | Анализ конкурентов (Apple Books, Kindle, Google Play Books), прямой анализ кодовой базы, WebKit bugzilla. Все table stakes features чётко идентифицированы |
| Architecture | HIGH | Прямой аудит исходного кода всех компонентов: useEpubIOSFixes, useGestureController, epub.js snap.js/contents.js/rendition.js. Event flow полностью прослежен |
| Pitfalls | HIGH | 10 подводных камней с HIGH/MEDIUM confidence, подтверждены Apple docs, WebKit bugs, анализом кода. Чёткие prevention strategies |

**Overall confidence:** HIGH

### Gaps to Address

- **`touch-action: pan-x pan-y` vs `manipulation` на iOS:** STACK.md (caniuse, HIGH) и PITFALLS.md (WebKit Bug #133112, PEP #350) противоречат друг другу. **Необходима проверка computed style на реальном iOS устройстве в Phase 1.** Если `pan-x pan-y` действительно игнорируется, нужно заменить на `manipulation` и обновить тест useContentHooks.test.ts:142.
- **epub.js Contents.triggerEvent после удаления blockers:** После удаления capture-phase stopPropagation, epub.js Contents будет снова проксировать touch events через EventEmitter. `gestures.destroy()` убирает Snap listeners, но Contents -> Rendition event chain (`rendition.on('touchstart')`) может вызывать побочные эффекты. Проверить подписчиков на `rendition.on('touchstart/move/end')` в кодовой базе.
- **Cross-frame pointerDown tracking:** Текущий scroll lock использует `parentDoc.addEventListener('pointerdown')`. На iOS pointer events в parent document могут не отражать touch events в iframe. Верификация в Phase 4.
- **iOS Simulator vs реальное устройство:** Все исследования предупреждают что Simulator не воспроизводит iOS-специфичные touch event баги. Обязательно тестирование на iPhone (iOS 26.x).

## Sources

### Primary (HIGH confidence)
- Apple Developer: [Handling Events in Safari](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) -- iOS touch event model, click delegation
- Can I Use: [CSS touch-action](https://caniuse.com/css-touch-action) -- iOS Safari 13+ support matrix
- Patrick H. Lauke: [Touch/pointer events test results](https://patrickhlauke.github.io/touch/tests/results/) -- cross-browser event ordering
- epub.js source code: snap.js, contents.js, constants.js, rendition.js -- direct code analysis
- Кодовая база: useEpubIOSFixes.ts, useGestureController.ts, useContentHooks.ts, useTextSelection.ts, gestureUtils.ts, iosSupport.ts

### Secondary (MEDIUM confidence)
- WebKit Bug #128924: Iframe touch coordinate offset (fixed, edge cases may remain)
- WebKit Bug #133112: touch-action CSS property support history
- WebKit Bug #182521: touchmove preventDefault() regression
- WebKit Bug #214609: pointerenter with mouse pointerType on iOS
- epub.js Issues #904, #905, #925: iOS Safari touch/selection bugs
- shadcn-ui Issue #8507: iOS PWA standalone pointer isolation

### Tertiary (LOW confidence)
- WebKit Bug #33894: Touch events in iframes (old, context only)
- Brainhub: PWA on iOS 2025 -- general limitations overview

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
