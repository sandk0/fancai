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
