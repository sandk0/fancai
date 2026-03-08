# Архитектура интеграции Mobile/PWA в существующий ридер

**Область:** Мобильный ридер EPUB с follow-finger свайпами, offline-чтением и iOS PWA
**Исследовано:** 2026-03-09
**Уверенность:** ВЫСОКАЯ -- на основе прямого анализа кодовой базы (~25 файлов) и исследования ограничений платформ

## Обзор текущей системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                      EpubReader.tsx (655 строк)                     │
│  Оркестрирует 25+ хуков, 5 дочерних компонентов                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐              │
│  │ useSwipe    │  │ useTouchNav   │  │ IOSTapZones  │              │
│  │ Navigation  │  │ (tap mode)    │  │ (iOS overlay)│              │
│  │ (iframe     │  │ (iframe       │  │ (parent DOM) │              │
│  │  events)    │  │  events)      │  │              │              │
│  └──────┬──────┘  └──────┬────────┘  └──────┬───────┘              │
│         │                │                  │                       │
│  ┌──────┴────────────────┴──────────────────┴───────────────┐      │
│  │              useEpubNavigation                            │      │
│  │  directScroll() + getMeasuredScrollUnit() + epub.js API  │      │
│  └──────────────────────┬───────────────────────────────────┘      │
│                         │                                           │
│  ┌──────────────────────┴───────────────────────────────────┐      │
│  │              epub.js Rendition (iframe)                    │      │
│  │  manager.stage.container → scrollLeft навигация            │      │
│  │  hooks.content.register() → привязка событий               │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐     │
│  │ SwipeOverlay │  │ useEpubIOSFi-│  │ useEpubRendition     │     │
│  │ (visual      │  │ xes (layout  │  │ (safe-area, height   │     │
│  │  feedback)   │  │  patches)    │  │  calculation)        │     │
│  └──────────────┘  └──────────────┘  └──────────────────────┘     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Данные: Zustand (reader.ts) + IndexedDB (epubCache, chapterCache) │
│  Сеть: TanStack Query + Service Worker (sw.ts, Workbox)            │
└─────────────────────────────────────────────────────────────────────┘
```

### Ключевые характеристики текущей архитектуры

1. **Навигация разделена на 3 параллельных механизма:**
   - `useSwipeNavigation` -- свайп-жесты внутри iframe (через `rendition.hooks.content.register()`)
   - `useTouchNavigation` -- тап-навигация внутри iframe (тот же механизм)
   - `IOSTapZones` -- DOM-оверлеи поверх iframe (обход WebKit бага с событиями iframe)

2. **epub.js навигация уже переписана:** `useEpubNavigation` использует `directScroll()` с прямым управлением `stage.scrollLeft` вместо нестабильных `rendition.next()/prev()`. Включает 5-уровневую цепочку fallback для измерения ширины колонки.

3. **iOS fix-слой объемный:** `useEpubIOSFixes` отключает `manager.snap()`, `manager.gestures`, блокирует `stage.scrollBy()`, фиксирует layout.divisor -- все из-за несовместимостей epub.js 0.3.93 с iOS Safari.

4. **Service Worker полноценный:** 870+ строк, Workbox injectManifest, включает: precaching, runtime caching (API, изображения, шрифты), Background Sync (reading progress, sessions), Push Notifications, Navigation Preload, offline fallback.

5. **Кэширование книг работает:** `epubCache.ts` (IndexedDB через Dexie) -- LRU, TTL 30 дней, лимит 200MB, user isolation. Книга загружается из кэша если доступна.

---

## Карта интеграции: Новое vs Модифицируемое

### Новые компоненты

| Компонент | Назначение | Зависит от |
|-----------|-----------|------------|
| `useFollowFingerSwipe.ts` | Follow-finger свайп с трансформами на контейнере | rendition, useEpubNavigation |
| `SwipePagePreview.tsx` | Рендеринг preview следующей/предыдущей страницы во время свайпа | rendition manager |
| `useViewportManager.ts` | Единый менеджер viewport: safe-area, ориентация, keyboard | -- |
| `useMobileGestures.ts` | Унифицированный gesture handler (объединяет swipe/tap/long-press) | rendition |
| `OfflineStatusBanner.tsx` | UI-индикатор offline-режима + pending sync | useOnlineStatus, SW |
| `InstallPrompt.tsx` | PWA install prompt (iOS инструкции + Android beforeinstallprompt) | iosSupport.ts |
| `useServiceWorkerUpdate.ts` | Управление обновлением SW + prompt пользователю | VitePWA registerSW |

### Модифицируемые компоненты

| Компонент | Текущие строки | Изменения | Масштаб |
|-----------|---------------|-----------|---------|
| `useSwipeNavigation.ts` | 507 | **ПЕРЕПИСАТЬ** -- заменить binary swipe на follow-finger с CSS transform | Большой |
| `SwipeOverlay.tsx` | 172 | **ПЕРЕПИСАТЬ** -- заменить на реальный page preview вместо gradient overlay | Большой |
| `useEpubNavigation.ts` | 477 | **Модифицировать** -- добавить preload следующей/предыдущей страницы для instant turn | Средний |
| `useEpubRendition.ts` | 262 | **Модифицировать** -- улучшить расчет viewport height, устранить height caching баги | Средний |
| `IOSTapZones.tsx` | 439 | **Модифицировать** -- интегрировать с новым gesture handler, убрать дублирование свайп-логики | Средний |
| `EpubReader.tsx` | 655 | **Модифицировать** -- подключить новые хуки, убрать дублирование навигации | Малый |
| `ReaderOverlays.tsx` | 119 | **Модифицировать** -- подключить новый SwipePagePreview вместо SwipeOverlay | Малый |
| `reader.ts` (store) | 404 | **Модифицировать** -- добавить gesture sensitivity settings | Малый |
| `sw.ts` | 877 | **Модифицировать** -- добавить стратегию кэширования EPUB файлов через SW | Средний |
| `manifest.json` | 95 | **Модифицировать** -- добавить иконки, screenshots, description на русском | Малый |
| `iosSupport.ts` | 486 | **Модифицировать** -- добавить iOS version-specific feature detection | Малый |

### Компоненты НЕ затрагиваемые

| Компонент | Причина |
|-----------|---------|
| `useAnnotationRendering.ts` (460 строк) | DOM span wrapping не связан с навигацией |
| `useDescriptionHighlighting.ts` | Подсветка описаний работает независимо |
| `useEntityNameHighlighting.ts` | Entity highlighting не связан с жестами |
| `useBookmarks.ts` / `useBookmarkActions` | CRUD заметок не зависит от навигации |
| `useProgressSync.ts` | Синхронизация прогресса работает через debounced callback |
| Backend (FastAPI, Celery) | Все изменения только на фронтенде |

---

## Архитектура follow-finger свайпа

### Проблема

Текущий `useSwipeNavigation` работает по принципу "detect swipe -> navigate":
1. Слушает touchstart/touchmove/touchend внутри iframe
2. Накапливает offset, показывает gradient overlay
3. На touchend -- если distance >= 30px, вызывает `onNavigate('next'|'prev')`
4. Навигация = мгновенный scrollTo на stage.container

Пользователь НЕ видит следующую страницу во время свайпа. Overlay показывает только gradient и chevron-индикаторы. Это не "follow-finger" -- это "swipe and jump".

### Решение: CSS Transform на контейнере + Page Preview

```
┌─────────────────────────────────────────────────────────┐
│  Слой 1: epub.js iframe (текущая страница)              │
│  transform: translateX(offset) -- следует за пальцем     │
├─────────────────────────────────────────────────────────┤
│  Слой 2: Preview канвас (следующая/предыдущая страница) │
│  position: absolute, рядом с текущей страницей          │
│  Заполняется через offscreen rendering или screenshot    │
└─────────────────────────────────────────────────────────┘
```

### Паттерн реализации

```typescript
// useFollowFingerSwipe.ts -- Ключевая идея

interface FollowFingerState {
  phase: 'idle' | 'tracking' | 'settling' | 'navigating';
  offsetX: number;          // Текущее смещение (px) -- следует за пальцем
  velocity: number;         // Скорость (px/ms) -- для инерции
  direction: 'left' | 'right' | null;
  previewReady: boolean;    // Готов ли preview следующей страницы
}

// Критическая точка интеграции с epub.js:
// epub.js rendition рендерит в iframe. Мы НЕ можем анимировать
// содержимое iframe через CSS transform снаружи.
//
// Два подхода:
//
// Подход A (рекомендуемый): Transform на stage.container
//   - epub.js manager.stage.container -- это div, содержащий iframe
//   - Применяем translateX() к нему -- iframe двигается целиком
//   - Preview: клонируем содержимое или используем второй rendition
//   - PRO: Работает, контент двигается плавно
//   - CON: Нужен preview рядом для "показать следующую страницу"
//
// Подход B (fallback): Overlay с screenshot
//   - Делаем screenshot текущей страницы (html2canvas или Canvas API)
//   - Показываем overlay с screenshot, двигаем его
//   - На завершении -- убираем overlay, показываем реальную страницу
//   - PRO: Не трогаем epub.js вообще
//   - CON: Screenshot не в реальном времени, артефакты
```

### Рекомендуемая архитектура (Подход A)

```
touchstart (iframe doc)
    │
    ├─ Фиксируем startX, startY, timestamp
    │
touchmove (iframe doc)
    │
    ├─ Вычисляем deltaX, проверяем вертикальный порог
    ├─ Если горизонтальный свайп:
    │   ├─ preventDefault() (блокируем scroll)
    │   ├─ Устанавливаем stage.container.style.transform = translateX(deltaX)
    │   ├─ Устанавливаем stage.container.style.transition = 'none'
    │   └─ Если !previewReady: запускаем preparePreview()
    │
touchend (iframe doc)
    │
    ├─ Вычисляем velocity = deltaX / deltaTime
    ├─ Решение о навигации:
    │   ├─ |deltaX| > threshold (30% ширины) → navigate
    │   ├─ |velocity| > quickThreshold (0.3 px/ms) → navigate
    │   └─ Иначе → snap back
    │
    ├─ Если navigate:
    │   ├─ Animate stage.container to -viewportWidth (или +viewportWidth)
    │   ├─ transition: transform 250ms ease-out
    │   ├─ По завершении анимации:
    │   │   ├─ stage.container.style.transform = ''
    │   │   ├─ directScroll(direction) -- фактическая навигация
    │   │   └─ cleanup preview
    │   │
    ├─ Если snap back:
    │   ├─ stage.container.style.transform = translateX(0)
    │   ├─ transition: transform 200ms ease-out
    │   └─ cleanup
```

### Preview следующей страницы

Показ следующей страницы во время свайпа -- самая сложная часть. Варианты:

**Вариант 1: Расширенный scrollWidth (рекомендуемый)**
epub.js в paginated mode уже рендерит все колонки главы. `stage.container.scrollWidth` обычно > `clientWidth`. Если мы двигаем container через transform, а scroll остается на месте -- следующая колонка будет видна "за краем". Это работает ТОЛЬКО если epub.js пре-рендерит колонки (что он делает).

```
НЕ нужен отдельный preview! epub.js уже рендерит все страницы главы.
stage.container = [col1][col2][col3][col4]...
scrollLeft=0 показывает col1
Если translateX(-100px), видна часть col2 справа.
```

**Вариант 2: Fallback для смены глав**
На границе главы (scrollLeft = maxScroll) следующей колонки нет -- нужно загрузить новую главу. Здесь показываем placeholder или просто разрешаем rubber-band эффект с надписью "Следующая глава".

### Критическая деталь: iframe и CSS transform

epub.js `manager.stage.container` -- это обычный `<div>` с `overflow: hidden`. Внутри него iframe. Мы можем применить `transform: translateX()` к этому div и содержимое (включая iframe) будет двигаться.

**Но:** На iOS Safari, `transform` на элементе с iframe может вызывать проблемы с hit-testing (события касания могут не работать правильно на трансформированном iframe). Решение: во время tracking-фазы свайпа устанавливать `pointer-events: none` на iframe, а сами touch events ловить на parent div.

---

## Архитектура Service Worker для offline книг

### Текущее состояние

Service Worker (`sw.ts`) уже зрелый:
- Precaching статических ресурсов (Workbox injectManifest)
- Runtime caching: API (StaleWhileRevalidate), изображения (CacheFirst/NetworkFirst), шрифты
- Background Sync: reading progress, sessions, image generation
- Push Notifications: полный flow (push, click, routing)
- Navigation: NetworkFirst с Navigation Preload
- Offline fallback: поиск /offline.html в кэшах

**Чего НЕ хватает для offline-чтения:**
1. EPUB файлы кэшируются в IndexedDB (epubCache.ts), но НЕ через Service Worker
2. Нет caching-стратегии для `/api/v1/books/{id}/file` endpoint
3. Нет проактивного кэширования книги при первом открытии
4. Offline.html -- placeholder, нет полноценного offline UI

### Рекомендуемые изменения

```
┌─────────────────────────────────────────────────────────────┐
│                Service Worker (sw.ts)                         │
│                                                               │
│  СУЩЕСТВУЮЩЕЕ:                                                │
│  ├─ Precache (статика)              ✓ работает                │
│  ├─ API cache (StaleWhileRevalidate) ✓ работает              │
│  ├─ Background Sync (progress)       ✓ работает              │
│  ├─ Push Notifications               ✓ работает              │
│  └─ Navigation Preload               ✓ работает              │
│                                                               │
│  ДОБАВИТЬ:                                                    │
│  ├─ EPUB file caching:                                        │
│  │   GET /api/v1/books/{id}/file → CacheFirst + IndexedDB    │
│  │   (синхронизация с epubCache.ts)                           │
│  ├─ Chapter data caching:                                     │
│  │   GET /api/v1/books/{id}/chapters/{n}/descriptions         │
│  │   → StaleWhileRevalidate (синхронизация с chapterCache.ts) │
│  ├─ Entity network caching:                                   │
│  │   GET /api/v1/books/{id}/entity-network                    │
│  │   → StaleWhileRevalidate (для offline entity popup)        │
│  └─ Offline UI:                                               │
│      Navigation fallback → SPA index.html (уже кэширован)    │
│      SPA сам показывает offline-режим если API недоступен     │
└─────────────────────────────────────────────────────────────────┘
```

**Важное решение:** Не дублировать кэширование EPUB файлов. Книги УЖЕ хранятся в IndexedDB через `epubCache.ts`. Добавлять их в Cache API через Service Worker -- двойной расход хранилища. Вместо этого:

1. Service Worker перехватывает `/api/v1/books/{id}/file` requests
2. Проверяет наличие в epubCache (IndexedDB) через `postMessage` к клиенту
3. Если есть -- пропускает (клиент сам загрузит из IndexedDB)
4. Если нет -- делает network fetch, ответ кэшируется клиентом в IndexedDB

### iOS-специфичные ограничения offline

| Ограничение | Влияние | Workaround |
|-------------|---------|------------|
| Storage eviction через 7 дней неактивности | Книги могут удалиться | `navigator.storage.persist()` (уже есть в `setupIOSPersistence()`) |
| ~50MB лимит Cache API | Недостаточно для книг | Используем IndexedDB (больший лимит) |
| Нет Background Sync | Progress не синхронизируется offline | `setupIOSSync()` через visibilitychange (уже есть) |
| Нет Periodic Sync | Нет фонового обновления кэша | Sync при открытии приложения |

---

## Архитектура iOS Safari PWA: viewport и safe areas

### Текущее состояние

`useEpubRendition.ts` уже обрабатывает safe areas:
- `measureSafeAreaTop()`, `measureSafeAreaBottom()` -- измерение через temp div
- `measureSvhHeight()` -- 100svh через temp div
- `getUsableViewportHeight()` -- расчет с учетом standalone mode
- Height caching в localStorage (30 минут TTL)

`EpubReader.tsx` уже использует env(safe-area-inset-*) в стилях viewerRef.

### Проблемы и улучшения

**Проблема 1: Height cache stale при ротации**
Height кэшируется с ориентацией, но ротация может произойти внутри TTL. Решение: сбрасывать кэш при `orientationchange` event.

**Проблема 2: iOS standalone vs browser viewport отличаются**
В standalone mode нет адресной строки, viewport выше. В browser mode -- адресная строка может анимироваться (grow/shrink). Текущий код учитывает это, но `svhHeight` может быть неточным.

**Проблема 3: Keyboard appearance на iOS**
При открытии клавиатуры (поиск, заметки) viewport уменьшается. Текущий код НЕ обрабатывает это. Нужен `visualViewport.resize` listener.

### Рекомендуемый `useViewportManager`

```typescript
// useViewportManager.ts -- Единый менеджер viewport
//
// Объединяет логику из:
// - useEpubRendition.ts (measureSafeAreaTop/Bottom, getUsableViewportHeight)
// - useResizeHandler.ts (resize events)
// - Новое: orientation change, keyboard, visual viewport
//
// Возвращает:
interface ViewportState {
  width: number;
  height: number;           // Usable height (за вычетом header + safe areas)
  safeAreaTop: number;
  safeAreaBottom: number;
  orientation: 'portrait' | 'landscape';
  isKeyboardVisible: boolean;
  isStandalone: boolean;
}
```

---

## Архитектура gesture handler: взаимодействие с epub.js iframe

### Корневая проблема

epub.js рендерит контент в `<iframe>`. Touch events внутри iframe НЕ поднимаются (bubble) к родительскому документу. Это фундаментальное ограничение Web API.

### Текущие стратегии (3 параллельных)

1. **`rendition.hooks.content.register()`** -- привязка listeners напрямую к `iframe.document`. Используется в `useSwipeNavigation` и `useTouchNavigation`. Работает надежно.

2. **`rendition.on('touchstart'|'click')`** -- epub.js `passEvents()` forwarding. Работает на Android, ненадежно на iOS.

3. **`IOSTapZones`** -- DOM-оверлеи поверх iframe. Перехватывают touch/click на уровне parent document. iOS-only workaround.

### Проблема: три системы конфликтуют

- На iOS: IOSTapZones + useSwipeNavigation оба слушают touch events
- IOSTapZones имеет встроенный swipe detection (SWIPE_MIN_DISTANCE = 30px)
- useSwipeNavigation привязывается к iframe doc, IOSTapZones -- к parent DOM
- При fast-swipe оба могут сработать, вызывая double navigation

### Рекомендуемая архитектура: Unified Gesture Handler

```
┌─────────────────────────────────────────────────────────────┐
│              useMobileGestures (НОВЫЙ)                       │
│                                                               │
│  Единая точка входа для всех gesture events                   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Gesture Recognizer                                    │   │
│  │                                                         │   │
│  │  Input: touch events (iframe ИЛИ parent DOM)           │   │
│  │                                                         │   │
│  │  Распознает:                                            │   │
│  │  - TAP (single, double)                                 │   │
│  │  - SWIPE (horizontal, с velocity)                       │   │
│  │  - LONG_PRESS (для selection)                           │   │
│  │  - PAN (follow-finger tracking)                         │   │
│  │                                                         │   │
│  │  Output:                                                │   │
│  │  - onTap(zone: 'left'|'center'|'right', coords)        │   │
│  │  - onSwipe(direction: 'next'|'prev', velocity)          │   │
│  │  - onPan(offsetX, phase: 'start'|'move'|'end')          │   │
│  │  - onLongPress(coords)                                  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  Event source:                                                │
│  ├─ iOS:  IOSTapZones (parent DOM) -- для taps              │
│  │        hooks.content.register() -- для swipe/pan          │
│  └─ Android/Desktop: hooks.content.register() -- для всего   │
│                                                               │
│  Навигация:                                                   │
│  ├─ mode='swipe': pan events → useFollowFingerSwipe          │
│  ├─ mode='tap': tap events → zone-based navigation            │
│  └─ Both: long press → text selection                         │
└─────────────────────────────────────────────────────────────────┘
```

**Ключевое решение:** НЕ объединять iOS и Android event sources. На iOS всегда нужен parent-DOM overlay для надежного touch detection. На Android `hooks.content.register()` работает. Unified handler -- это абстракция поверх платформо-специфичных источников.

---

## Поток данных: навигация по свайпу

### Текущий поток

```
User swipe → iframe touchstart/move/end
    → useSwipeNavigation (state tracking)
    → SwipeOverlay (gradient visual)
    → touchend decision: navigate?
        → YES: useEpubNavigation.nextPage()
            → directScroll(direction, smooth=true)
                → stage.scrollTo({ left: newScroll, behavior: 'smooth' })
                → waitForScrollEnd()
            → FALLBACK: rendition.next()
        → NO: snap back (reset offset)
    → useCFITracking (relocate event → new CFI)
    → useProgressSync (debounced save)
```

### Новый поток (follow-finger)

```
User touch → iframe touchstart
    → useMobileGestures → onPan('start')
    → useFollowFingerSwipe: begin tracking

User drag → iframe touchmove
    → useMobileGestures → onPan('move', offsetX)
    → useFollowFingerSwipe:
        → stage.container.style.transform = translateX(offsetX)
        → stage.container.style.transition = 'none'
        → (следующая колонка уже видна через scrollWidth)

User release → iframe touchend
    → useMobileGestures → onPan('end', velocity)
    → useFollowFingerSwipe: decision
        → Navigate:
            → stage.container.style.transition = 'transform 250ms ease-out'
            → stage.container.style.transform = translateX(-viewportWidth)
            → onTransitionEnd:
                → stage.container.style.transform = ''
                → stage.container.style.transition = ''
                → directScroll(direction, smooth=false) // instant, контент уже виден
        → Snap back:
            → stage.container.style.transition = 'transform 200ms ease-out'
            → stage.container.style.transform = 'translateX(0)'
            → onTransitionEnd: cleanup

    → useCFITracking (relocate → new CFI)
    → useProgressSync (debounced save)
```

---

## Структура хуков (после рефакторинга)

### Текущая структура (hooks/epub/)

```
hooks/epub/
├── useEpubLoader.ts           # Загрузка книги (остается)
├── useEpubRendition.ts        # Создание rendition (модифицируется)
├── useEpubNavigation.ts       # directScroll + fallback (модифицируется)
├── useSwipeNavigation.ts      # Binary swipe (ПЕРЕПИСЫВАЕТСЯ)
├── useTouchNavigation.ts      # Tap zones внутри iframe (остается)
├── useEpubIOSFixes.ts         # iOS layout patches (остается)
├── useCFITracking.ts          # CFI position tracking (остается)
├── useProgressSync.ts         # Progress save debounce (остается)
├── useChapterManagement.ts    # Chapter loading (остается)
├── useAnnotationRendering.ts  # DOM span wrapping (остается)
├── useDescriptionHighlighting.ts # (остается)
├── useEntityNameHighlighting.ts  # (остается)
├── useBookmarks.ts            # (остается)
├── useResizeHandler.ts        # (модифицируется -- viewport manager)
├── useEpubThemes.ts           # (остается)
├── useContentHooks.ts         # (остается)
├── useTextSelection.ts        # (остается)
├── useToc.ts                  # (остается)
└── index.ts                   # Re-exports
```

### Новая структура

```
hooks/epub/
├── ... (все существующие хуки сохраняются)
│
├── useFollowFingerSwipe.ts    # НОВЫЙ: follow-finger с CSS transform
├── useMobileGestures.ts       # НОВЫЙ: unified gesture recognition
└── useViewportManager.ts      # НОВЫЙ: viewport state management

hooks/pwa/                      # НОВАЯ директория
├── useServiceWorkerUpdate.ts  # НОВЫЙ: SW update management
├── useInstallPrompt.ts        # НОВЫЙ: PWA install prompt
└── useOfflineStatus.ts        # НОВЫЙ: расширение useOnlineStatus
```

---

## Паттерны реализации

### Паттерн 1: CSS Transform на stage container

**Что:** Применяем `transform: translateX()` к `manager.stage.container` для follow-finger эффекта.

**Когда:** Во время горизонтального свайпа (tracking phase).

**Компромиссы:**
- PRO: Нативно плавно (GPU-ускорение transform), не требует re-render
- PRO: epub.js уже пре-рендерит колонки -- следующая страница видна автоматически
- CON: На границе главы нет следующей колонки -- нужен fallback (rubber band)
- CON: iOS может иметь hit-testing проблемы на трансформированном iframe

**Пример:**
```typescript
// Во время touchmove:
const stage = rendition.manager.stage.container;
stage.style.transform = `translateX(${offsetX}px)`;
stage.style.transition = 'none';
stage.style.willChange = 'transform'; // GPU hint

// На touchend (navigate):
stage.style.transition = 'transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
stage.style.transform = `translateX(${-viewportWidth}px)`;
// После transitionend:
stage.style.transform = '';
stage.style.transition = '';
stage.style.willChange = '';
stage.scrollLeft += scrollUnit; // Фактический переход
```

### Паттерн 2: Unified Event Source с платформенным разделением

**Что:** Один gesture recognizer, разные источники событий для iOS и Android.

**Когда:** Всегда -- заменяет текущую "3 системы одновременно" архитектуру.

**Компромиссы:**
- PRO: Устраняет double navigation и race conditions
- PRO: Единый порог/настройки для всех платформ
- CON: Больше абстракции, сложнее дебаг

### Паттерн 3: Service Worker + IndexedDB координация

**Что:** SW перехватывает book file requests, но кэшированием управляет клиент (IndexedDB через Dexie).

**Когда:** Для offline чтения без дублирования данных.

**Компромиссы:**
- PRO: Одна копия книги (IndexedDB), нет дублирования в Cache API
- PRO: epubCache.ts уже имеет LRU, TTL, size limits
- CON: SW не может напрямую читать IndexedDB (только через postMessage)
- CON: Если app не открыт, SW не может обслужить book request из IndexedDB

---

## Антипаттерны

### Антипаттерн 1: Двойной rendition для preview

**Что делают:** Создают второй epub.js Rendition для рендеринга preview следующей страницы.

**Почему плохо:** epub.js Rendition тяжелый (создает iframe, парсит CSS, строит layout). Два rendition = двойной расход памяти (150-300MB для большой книги). На мобильных устройствах вызывает OOM.

**Вместо этого:** Использовать существующий scrollWidth. epub.js уже рендерит все колонки главы. Двигая container через transform, следующая колонка видна автоматически.

### Антипаттерн 2: html2canvas для page screenshot

**Что делают:** Используют html2canvas для создания bitmap preview страницы перед свайпом.

**Почему плохо:** html2canvas не работает с iframes (cross-origin restrictions), медленный (50-200ms), результат -- растровое изображение (размытое на retina). Также не работает на iOS Safari.

**Вместо этого:** CSS transform подход -- двигаем реальный DOM, не bitmap.

### Антипаттерн 3: Отключение overscroll-behavior для свайпов

**Что делают:** Ставят `overscroll-behavior: none` на body чтобы предотвратить pull-to-refresh/back-navigation, но это ломает вертикальный scroll.

**Вместо этого:** Ставить `overscroll-behavior-x: none` (только горизонтальный), а вертикальный оставить. Или использовать `touch-action: pan-y` на swipe-зоне.

### Антипаттерн 4: Полное кэширование книг в Cache API

**Что делают:** Кэшируют EPUB файлы (5-50MB каждый) в Cache API через Service Worker.

**Почему плохо:** Cache API на iOS имеет лимит ~50MB. Две книги -- и лимит исчерпан. Также дублирует данные из IndexedDB (epubCache.ts).

**Вместо этого:** Держать книги только в IndexedDB. Cache API использовать для API responses и static assets.

---

## Предложенный порядок реализации

### Фаза 1: Фиксы багов навигации (фундамент)
**Зависимости:** Нет
**Файлы:** `useSwipeNavigation.ts`, `useEpubNavigation.ts`, `IOSTapZones.tsx`
**Цель:** Устранить блокировку навигации (после отмены генерации изображений), fix double navigation, fix быстрое пролистывание.

**Обоснование:** Без работающей базовой навигации нельзя строить follow-finger поверх. Текущие баги (блокировка `isNavigatingRef`) должны быть исправлены первыми.

### Фаза 2: Follow-finger свайпы
**Зависимости:** Фаза 1
**Файлы:** `useFollowFingerSwipe.ts` (НОВЫЙ), `useSwipeNavigation.ts` (переписать), `SwipeOverlay.tsx` (переписать)
**Цель:** Палец двигает страницу, видна следующая страница, плавная анимация завершения.

**Обоснование:** Основная UX-фича milestone. Требует работающей навигации (Фаза 1). Не требует unified gestures -- можно реализовать поверх текущего `hooks.content.register()`.

### Фаза 3: Unified gesture handler
**Зависимости:** Фаза 2
**Файлы:** `useMobileGestures.ts` (НОВЫЙ), `IOSTapZones.tsx` (рефакторинг), `useTouchNavigation.ts` (рефакторинг)
**Цель:** Единый gesture handler, устранение дублирования, корректная обработка swipe/tap/long-press.

**Обоснование:** После того как follow-finger работает, нужно интегрировать его с tap navigation и iOS overlays без конфликтов.

### Фаза 4: Viewport и iOS PWA улучшения
**Зависимости:** Фаза 2 (для корректного тестирования)
**Файлы:** `useViewportManager.ts` (НОВЫЙ), `useEpubRendition.ts` (рефакторинг), `manifest.json`, `index.html`
**Цель:** Корректный viewport на всех устройствах, ориентация, keyboard, safe areas.

### Фаза 5: Offline и PWA polish
**Зависимости:** Фазы 1-4 (все UI готово)
**Файлы:** `sw.ts` (модификация), `OfflineStatusBanner.tsx` (НОВЫЙ), `InstallPrompt.tsx` (НОВЫЙ), `useServiceWorkerUpdate.ts` (НОВЫЙ)
**Цель:** Полноценное offline-чтение, install prompt, update management.

**Обоснование:** SW и offline -- это polish поверх работающего ридера. Не блокирует основные UX-фичи.

### Фаза 6: Описания и edge cases
**Зависимости:** Фаза 2 (для CSS-контекста)
**Файлы:** Описание-специфичные файлы (CFI->DOM mapping, sentence parsing)
**Цель:** Fix обрезки описаний, умный парсинг начала предложений.

**Обоснование:** Может идти параллельно с Фазами 3-5, так как затрагивает другие компоненты.

---

## Ключевые точки интеграции (матрица)

| Новый компонент | Интегрируется с | Через | Риск конфликта |
|-----------------|----------------|-------|----------------|
| useFollowFingerSwipe | useEpubNavigation | `directScroll()` для фактической навигации | Низкий -- четкий API |
| useFollowFingerSwipe | manager.stage.container | `style.transform`, `style.transition` | **ВЫСОКИЙ** -- epub.js может сбрасывать styles |
| useFollowFingerSwipe | useEpubIOSFixes | Конфликт с `snap()` blocking, `scrollBy()` blocking | Средний -- нужна координация |
| useMobileGestures | IOSTapZones | IOSTapZones дает events, gestures распознает | Низкий -- четкое разделение |
| useMobileGestures | hooks.content.register | iframe events → gesture recognizer | Низкий -- уже работает |
| useViewportManager | useEpubRendition | Заменяет `calculateMobileDimensions()` | Средний -- рефакторинг |
| SW EPUB caching | epubCache.ts | postMessage координация | Средний -- async |

---

## Источники

- Прямой анализ кодовой базы: EpubReader.tsx, 25+ hooks, sw.ts, manifest.json, iosSupport.ts
- [epub.js Wiki: Tips and Tricks](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3))
- [epub.js Issue #510: Page flip animation](https://github.com/futurepress/epub.js/issues/510)
- [epub.js Issue #1377: Paginated swipe animation](https://github.com/futurepress/epub.js/issues/1377)
- [PWA iOS Limitations Guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [PWAs on iOS 2025](https://brainhub.eu/library/pwa-on-ios)
- [CSS safe-area-inset for PWA standalone](https://gist.github.com/cvan/6c022ff9b14cf8840e9d28730f75fc14)
- [Understanding svh, lvh, dvh viewport units](https://medium.com/@tharunbalaji110/understanding-mobile-viewport-units-a-complete-guide-to-svh-lvh-and-dvh-0c905d96e21a)
- [Vite PWA: injectManifest](https://vite-pwa-org.netlify.app/workbox/inject-manifest)

---
*Архитектурное исследование для: Mobile/PWA интеграция в ридер fancai*
*Исследовано: 2026-03-09*
