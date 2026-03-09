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
