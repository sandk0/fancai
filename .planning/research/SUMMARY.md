# Сводка исследования проекта

**Проект:** fancai v1.1 -- Mobile/PWA Reader
**Область:** Мобильный EPUB-ридер с follow-finger свайпами, PWA-полировкой и offline-чтением
**Исследовано:** 2026-03-09
**Уверенность:** ВЫСОКАЯ

## Общий обзор

fancai v1.0 -- зрелый EPUB-ридер с уникальными AI-фичами (entity wiki, описания, генерация изображений), но его мобильный UX значительно уступает нативным конкурентам (Apple Books, Google Play Books, Kindle). Главный пробел -- отсутствие follow-finger перелистывания: текущие свайпы работают по пороговому принципу ("свайпни и подожди"), тогда как все нативные ридеры дают ощущение "палец двигает страницу". Это table stakes, без которого мобильная версия ощущается сломанной. Среди web-based ридеров (Flow, Thorium Web, Readium) ни один не реализовал follow-finger для reflowable EPUB -- это одновременно table stakes для пользователя и differentiator среди web-ридеров. PWA-инфраструктура (Service Worker 870+ строк, Workbox, Background Sync, Push Notifications) уже зрелая и не требует переписывания.

Рекомендуемый подход -- минимализм в зависимостях и максимализм в рефакторинге. Исследование стека показало, что **никаких новых npm-пакетов не требуется** -- все инструменты для follow-finger уже в проекте (motion 12.x с useMotionValue/useTransform, raw touch events через epub.js content hooks). Единственное действие по стеку -- обновить motion до 12.35.x для bugfix velocity transfer в spring-анимациях. Архитектурное исследование подтвердило ключевой инсайт: epub.js в paginated mode уже пре-рендерит все колонки главы, поэтому для follow-finger достаточно CSS transform на stage.container -- следующая страница видна автоматически, без двойного iframe или html2canvas. Все изменения исключительно на фронтенде; бэкенд не затрагивается (кроме NLP SBD в последней фазе).

Основные риски: (1) race condition при быстром листании -- существующий баг, который усугубится с follow-finger и должен быть исправлен первым; (2) конфликт трех параллельных gesture-систем (useSwipeNavigation + useTouchNavigation + IOSTapZones), вызывающий двойную навигацию; (3) iOS Safari PWA standalone -- агрессивный reload при resume (MIN_BACKGROUND_TIME_FOR_RELOAD = 0), потеря UI-состояния, отсутствие back-навигации. Все три риска имеют конкретные, документированные решения: navigation mutex с instant cancel, unified gesture handler с state machine, градуированная стратегия reload.

## Ключевые находки

### Рекомендуемый стек

Никаких новых зависимостей. Текущий стек полностью покрывает все потребности. Подробности: [STACK.md](STACK.md).

**Основные технологии:**
- **motion 12.35.x** (обновление с 12.31.0): useMotionValue для follow-finger без re-render, spring-анимации с velocity transfer. Уже интегрирован в 40 файлах. Bugfix 12.34.3 критичен для корректного velocity в spring.
- **Workbox 7.4 + vite-plugin-pwa 1.2.0**: оставить без изменений, полностью покрывают PWA-нужды (precaching, runtime caching, background sync, push)
- **Raw Touch Events через epub.js content hooks**: единственный надежный способ работы с touch в iframe. `rendition.hooks.content.register()` привязывает handlers к iframe document напрямую.

**Отклоненные технологии (с обоснованием):**
- `@use-gesture/react` -- не работает с iframe (не получит events), заброшен 2+ года, дублирует motion
- `react-spring` -- дублирует motion (два animation runtime = больший bundle)
- `hammer.js` -- заброшен с 2016, не поддерживает Pointer Events
- Pointer Events вместо Touch Events -- epub.js iframe на iOS не forwarding pointer events, регрессия

### Ожидаемые фичи

Подробности: [FEATURES.md](FEATURES.md).

**Обязательные (table stakes):**
- **Follow-finger свайпы** -- палец двигает страницу, как Apple Books / Google Play Books / Kindle
- **Фикс быстрого пролистывания** -- баг: быстрые свайпы ломают навигацию (isNavigatingRef блокируется)
- **Slide-анимация перехода** -- CSS transition при завершении свайпа (без нее -- "телепортация")
- **Адаптивный мобильный UI** -- автоскрытие header/footer, 44px тап-таргеты, thumb-zone дизайн
- **Корректные safe area insets** -- фикс keyboard handling, Dynamic Island, home indicator

**Конкурентные преимущества (should-have):**
- **PWA Install Prompt** -- код почти готов (iosSupport.ts), нужен только UI-компонент
- **Offline graceful degradation** -- AI-фичи молча отключаются при offline, offline-badge вместо ошибок
- **NLP sentence boundary (бэкенд)** -- Python spaCy ru_core_news_sm при extraction (однозначно бэкенд, не фронтенд -- wink-nlp/compromise не поддерживают русский)
- **Настраиваемые зоны навигации** -- выбор layout тап-зон (3-zone, edge-only, zones-off)

**Отложить (v2+):**
- Curl-анимация (нет способа для reflowable EPUB в web без Canvas screenshot -- Apple Books делает это через Metal)
- Pinch-to-zoom для font-size (конфликт с touch-action, требует пересмотра всей gesture-системы)
- Background загрузка книг для offline (полная загрузка EPUB + метаданные -- сложнее чем кажется)
- Озвучка текста (TTS) -- out of scope, Web Speech API нестабилен, Russian TTS слабый
- Множественные режимы отображения (scroll mode) -- epub.js 0.3.93 нестабилен в scroll mode

### Архитектурный подход

Подробности: [ARCHITECTURE.md](ARCHITECTURE.md).

Архитектура строится на **CSS transform на epub.js stage.container** как основном механизме follow-finger. Ключевое открытие: epub.js в paginated mode уже пре-рендерит все колонки главы в scrollWidth. При translateX на контейнере следующая колонка видна автоматически -- не нужен ни двойной iframe (OOM на мобильных), ни html2canvas (не работает с iframe). На границе главы (scrollLeft = maxScroll) используется rubber-band эффект с placeholder. Три параллельные gesture-системы объединяются в unified gesture handler с платформенным разделением: на iOS -- parent DOM overlay для тапов + iframe hooks для свайпов; на Android -- только iframe hooks.

**Основные компоненты:**
1. **useFollowFingerSwipe** (НОВЫЙ) -- CSS transform + motion useMotionValue (без re-render на touchmove), spring-анимация через animate(), интеграция с directScroll() после завершения анимации
2. **useMobileGestures** (НОВЫЙ) -- unified gesture recognizer с state machine (idle -> touching -> swiping/tapping/selecting), единая точка входа для всех touch events
3. **useViewportManager** (НОВЫЙ) -- единый менеджер viewport: VisualViewport API, safe areas, ориентация, keyboard detection, заменяет разрозненную логику из useEpubRendition + useResizeHandler
4. **Переписываемые**: useSwipeNavigation (MotionValue вместо useState), SwipeOverlay (реальный page preview вместо gradient)
5. **Модифицируемые**: useEpubNavigation (preload), IOSTapZones (интеграция с gesture handler), sw.ts (EPUB caching), manifest.json
6. **Не затрагиваемые**: useAnnotationRendering, useDescriptionHighlighting, useEntityNameHighlighting, useBookmarks, весь бэкенд (кроме NLP SBD)

### Критические ловушки

Подробности: [PITFALLS.md](PITFALLS.md).

1. **Race condition при быстром листании** -- `directScroll()` с `behavior: 'smooth'` при серии свайпов вызывает накопление ошибок scrollLeft. Решение: navigation mutex с instant cancel предыдущего scroll + абсолютные позиции (`pageIndex * scrollUnit`) вместо относительных (`currentScroll + scrollUnit`).

2. **Двойная навигация от трех gesture-систем** -- useSwipeNavigation + useTouchNavigation + IOSTapZones конфликтуют. На iOS оба слоя получают touch events, на Android два хука привязаны к одному iframe document. Решение: unified gesture controller с state machine, AbortController вместо `doc.__swipeNavCleanup`.

3. **iOS PWA standalone: агрессивный reload** -- `MIN_BACKGROUND_TIME_FOR_RELOAD = 0` для mobile вызывает reload при каждом resume (даже 1 сек в уведомлениях). Решение: градуированная стратегия: <5 сек -- ничего, 5-60 сек -- health check rendition, >60 сек -- reload. Persist UI state в sessionStorage.

4. **iOS viewport/keyboard/safe-area** -- клавиатура при поиске "прыгает" контент, `env(safe-area-inset-bottom)` не обновляется при keyboard, `100vh` включает скрытую часть Safari UI. Решение: `window.visualViewport` вместо `window.innerHeight`, freeze rendition resize при активной клавиатуре.

5. **Блокировка навигации после отмены генерации** -- существующий баг: isNavigatingRef остается true при race condition между закрытием модала и обновлением enabled-флага. Решение: timeout safety (3 сек автосброс) + cleanup в useEffect return + отвязать isModalOpen от navigation enabled.

## Импликации для дорожной карты

### Phase 1: Стабильная навигация
**Обоснование:** Фундамент для всего milestone. Без работающей базовой навигации follow-finger будет нестабильным. Текущие баги (блокировка isNavigatingRef, race condition при быстром листании, двойная навигация) -- первый приоритет.
**Результат:** Стабильная свайп-навигация без блокировок; navigation mutex с instant cancel; очередь навигации; AbortController для cleanup обработчиков.
**Фичи из FEATURES.md:** Фикс быстрого пролистывания
**Ловушки из PITFALLS.md:** #1 (race condition scrollLeft), #2 (двойная навигация), #6 (блокировка isNavigatingRef)
**Файлы:** useSwipeNavigation.ts, useEpubNavigation.ts, IOSTapZones.tsx

### Phase 2: Follow-finger свайпы + slide-анимация
**Обоснование:** Основная UX-фича milestone. Зависит от Phase 1 (стабильная навигация). CSS transform на stage.container + useMotionValue из motion -- хорошо задокументированный подход, epub.js пре-рендерит колонки.
**Результат:** Палец двигает страницу, видна следующая страница через scrollWidth, плавная spring-анимация завершения с velocity transfer от жеста.
**Фичи из FEATURES.md:** Follow-finger свайпы, Slide-анимация перехода
**Стек из STACK.md:** motion 12.35.x (useMotionValue, animate, spring physics)
**Архитектура из ARCHITECTURE.md:** useFollowFingerSwipe, CSS transform на stage.container, подход A (расширенный scrollWidth)
**Файлы:** useFollowFingerSwipe.ts (НОВЫЙ), useSwipeNavigation.ts (переписать), SwipeOverlay.tsx (переписать)

### Phase 3: Unified gesture handler + мобильный UI
**Обоснование:** После работающего follow-finger нужно интегрировать его с тап-навигацией и iOS overlays без конфликтов. Параллельно -- адаптивный мобильный UI (44px тап-таргеты, автоскрытие).
**Результат:** Единый gesture handler с state machine (устраняет дублирование), адаптивный UI с автоскрытием header/footer, 44px тап-таргеты, настраиваемые зоны навигации.
**Фичи из FEATURES.md:** Адаптивный мобильный UI, настраиваемые зоны навигации
**Архитектура из ARCHITECTURE.md:** useMobileGestures, рефакторинг IOSTapZones и useTouchNavigation
**Ловушки из PITFALLS.md:** #2 (gesture конфликты, double navigation)

### Phase 4: Viewport, iOS PWA, safe areas
**Обоснование:** Системный подход к viewport management. Зависит от Phase 2 для корректного тестирования на мобильных. Решает разрозненные баги (keyboard, safe-area, orientation, standalone reload) одним компонентом.
**Результат:** Корректный viewport на всех устройствах (iPhone SE, iPhone 14 Pro, iPad), keyboard handling, safe areas, ориентация, градуированная стратегия reload для PWA standalone.
**Фичи из FEATURES.md:** Корректные safe area insets
**Архитектура из ARCHITECTURE.md:** useViewportManager, рефакторинг useEpubRendition
**Ловушки из PITFALLS.md:** #3 (iOS standalone reload), #4 (viewport/keyboard/safe-area)

### Phase 5: Offline и PWA polish
**Обоснование:** SW и offline -- polish поверх работающего ридера. Не блокирует основные UX-фичи. PWA install prompt код почти готов.
**Результат:** Offline-чтение с graceful degradation (AI-фичи молча отключаются), install prompt для Android/iOS, SW update management, EPUB file caching через Workbox.
**Фичи из FEATURES.md:** PWA Install Prompt, Offline graceful degradation
**Ловушки из PITFALLS.md:** #5 (SW update застревает на iOS standalone)
**Файлы:** sw.ts, OfflineStatusBanner.tsx (НОВЫЙ), InstallPrompt.tsx (НОВЫЙ), manifest.json

### Phase 6: Описания и edge cases
**Обоснование:** Может идти параллельно с Phases 3-5. Затрагивает бэкенд (NLP SBD) и другие компоненты (CFI-DOM mapping). Независим от gesture/viewport работы.
**Результат:** Фикс обрезки описаний (CFI-DOM рассинхронизация), NLP sentence boundary на бэкенде (Python spaCy ru_core_news_sm), корректные границы предложений при extraction.
**Фичи из FEATURES.md:** NLP sentence boundary, фикс обрезки описаний
**Ловушки из PITFALLS.md:** #7 (CFI-DOM рассинхронизация при DOM-манипуляциях)

### Обоснование порядка фаз

- **Phase 1 -> Phase 2:** Follow-finger физически невозможен без стабильной навигации. Race condition при быстром листании сделает follow-finger непригодным -- scrollLeft будет накапливать ошибки.
- **Phase 2 -> Phase 3:** Unified gesture handler имеет смысл только когда есть follow-finger, который нужно интегрировать с тап-навигацией. Объединять gesture-системы без follow-finger -- преждевременная абстракция.
- **Phase 2 -> Phase 4:** Viewport management нужен для тестирования follow-finger на реальных устройствах, но не блокирует разработку на десктопе.
- **Phases 3-6 могут частично параллелиться:** Phase 6 (бэкенд NLP) полностью независим от фронтенда. Phase 5 (PWA polish) не конфликтует с Phase 3 (gesture handler). Phase 4 (viewport) можно делать параллельно с Phase 3.

### Флаги исследования

Фазы, требующие углубленного исследования при планировании:
- **Phase 2 (Follow-finger):** CSS transform на epub.js stage.container + iOS hit-testing на трансформированном iframe. Граница глав (нет следующей колонки) -- fallback (rubber band или placeholder). epub.js может сбрасывать styles на stage.container -- нужна проверка.
- **Phase 4 (Viewport/iOS):** VisualViewport API различается между iOS версиями. `env(safe-area-inset-*)` поведение при keyboard -- слабо документировано. Оптимальные пороги для градуированного reload -- определятся через тестирование.

Фазы с хорошо задокументированными паттернами (пропустить research-phase):
- **Phase 1 (Навигация):** Navigation mutex, AbortController для cleanup, debounce -- стандартные паттерны. Существующий код хорошо понятен.
- **Phase 3 (Gesture handler):** State machine для gesture recognition -- хорошо задокументированный паттерн (idle -> touching -> swiping/tapping). Платформенное разделение (iOS vs Android) уже реализовано частично.
- **Phase 5 (PWA):** Workbox caching strategies, install prompt, SW update -- хорошо задокументированы, код частично готов (iosSupport.ts, PWAUpdatePrompt.tsx).
- **Phase 6 (NLP SBD):** Python spaCy ru_core_news_sm -- стандартная библиотека, хорошо документирована.

## Оценка уверенности

| Область | Уверенность | Примечания |
|---------|-------------|------------|
| Стек | ВЫСОКАЯ | Анализ существующей кодовой базы (40+ файлов с motion), npm registry, changelog motion 12.33-12.35. Никаких новых зависимостей -- минимальный риск. |
| Фичи | СРЕДНЕ-ВЫСОКАЯ | Анализ конкурентов (Apple Books, Google Play Books, Kindle, Flow, Thorium Web). Follow-finger для reflowable EPUB в web -- ни один open-source ридер не реализовал, но подход CSS transform задокументирован в epub.js issues. |
| Архитектура | ВЫСОКАЯ | Прямой анализ 25+ файлов кодовой базы. Карта интеграции основана на реальном коде. Ключевой инсайт (epub.js пре-рендерит колонки в scrollWidth) подтвержден анализом manager.stage.container. |
| Ловушки | ВЫСОКАЯ | Комбинация анализа кода (существующие баги с isNavigatingRef), epub.js issues (#510, #962, #1377), iOS PWA limitations guides, Workbox documentation. Все pitfalls с конкретными решениями и recovery cost. |

**Общая уверенность:** ВЫСОКАЯ

### Пробелы для внимания

- **CSS transform на iframe container в iOS Safari:** Теоретически работает (GPU-ускорение), но hit-testing на трансформированном iframe может быть непредсказуемым. Решение: `pointer-events: none` на iframe во время tracking phase. Требует тестирования на реальном устройстве в Phase 2.
- **Граница глав при follow-finger:** Когда scrollLeft = maxScroll, следующей колонки нет. Нужен rubber-band эффект или placeholder "Следующая глава". Конкретная реализация определится при разработке Phase 2.
- **iOS PWA standalone reload пороги:** Оптимальные значения (5 сек? 30 сек? 60 сек?) определятся через тестирование. Текущий 0 сек однозначно плох, но слишком длинный порог рискует heap corruption в epub.js.
- **epub.js сброс styles на stage.container:** epub.js может сбрасывать inline styles на контейнере при определенных операциях (resize, chapter change). Нужно проверить и при необходимости перехватить через MutationObserver.

## Источники

### Первичные (ВЫСОКАЯ уверенность)
- Прямой анализ кодовой базы fancai: 25+ хуков, sw.ts (878 строк), manifest.json, iosSupport.ts (486 строк)
- [Motion Changelog](https://motion.dev/changelog) -- версии 12.33-12.35, bugfix velocity в spring
- [Motion React Gestures](https://motion.dev/docs/react-gestures) -- pan, drag API
- [npm motion 12.35.1](https://www.npmjs.com/package/motion) -- версия подтверждена
- [epub.js Wiki: Tips and Tricks](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)) -- swipe implementation
- [Workbox: Handling SW updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
- [MDN: touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action), [env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [Apple Books page turn docs](https://support.apple.com/en-mn/guide/iphone/iphc1af7c57/ios)

### Вторичные (СРЕДНЯЯ уверенность)
- [PWA iOS Limitations Guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [PWAs on iOS 2025](https://brainhub.eu/library/pwa-on-ios)
- [epub.js Issue #510: Page flip animation](https://github.com/futurepress/epub.js/issues/510)
- [epub.js Issue #1377: Paginated swipe animation](https://github.com/futurepress/epub.js/issues/1377)
- [epub.js Issue #962: SW + iframe](https://github.com/futurepress/epub.js/issues/962)
- [Flow EPUB reader PWA (source)](https://github.com/pacexy/flow)
- [Thorium Web reader (source)](https://github.com/edrlab/thorium-web)
- [iOS PWA Compatibility (firt.dev)](https://firt.dev/notes/pwa-ios/)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

### Третичные (НИЗКАЯ уверенность)
- [StPageFlip](https://nodlik.github.io/StPageFlip/) -- только fixed-layout, не применим к reflowable
- [CSS-Tricks Simple Swipe](https://css-tricks.com/simple-swipe-with-vanilla-javascript/) -- базовый vanilla swipe паттерн

---
*Исследование завершено: 2026-03-09*
*Готово для дорожной карты: да*
