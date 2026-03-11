# Phase 16: Навигация и свайпы - Research

**Researched:** 2026-03-10
**Domain:** Touch gesture pipeline, spring animations, epub.js scroll navigation
**Confidence:** HIGH

## Summary

Фаза 16 исправляет четыре регрессии v1.1 в gesture pipeline ридера: двойное перелистывание свайпом, дёрганая анимация, нерабочий переход между главами, артефакты тапов. Все баги локализованы в трёх существующих файлах (`useGestureController.ts`, `useFollowFingerSwipe.ts`, `useEpubNavigation.ts`) и их интеграции через `EpubReader.tsx`.

Корневая причина двойного перелистывания -- архитектурная: CSS transform wrapper (`FollowFingerContainer`) визуально сдвигает контент, затем вызывает `onNavigate` -> `nextPage()` -> `directScroll()`, который делает ещё один `scrollTo` на stage container. Итого: два визуальных перемещения за один свайп. Нерабочий переход между главами вызван тем, что `onChapterChange` вызывается в `onComplete` callback spring-анимации обратно к нулю -- к моменту вызова UI уже вернулся, и визуально ничего не происходит.

**Первичная рекомендация:** Перестроить pipeline на двухфазную модель "animate -> navigate -> reset": сначала spring-анимация доводит transform до края, затем (в onComplete) делается instant scroll на stage (без smooth), затем translateX сбрасывается в 0. Это устраняет двойное перелистывание и делает переход визуально чистым.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Ощущение свайпа: Apple Books-like, 1:1 follow-finger tracking, мягкий spring с микро-bounce на завершении
- Отмена свайпа: мягкий snap-back с spring-анимацией ("резинка")
- Тонкая тень на краю страницы при свайпе (как в Apple Books)
- Тап по боковым зонам: быстрая spring-анимация (~100-150ms), не мгновенный jump
- Центральный тап: toggle UI
- Тап на краю последней/первой страницы главы: переход к следующей/предыдущей главе
- Подсказка при свайпе на границе: простой индикатор "Следующая глава" / "Предыдущая глава" (без названия главы)

### Claude's Discretion
- Flick-поведение (порог скорости, минимальная дистанция)
- Быстрые повторные тапы ("тап-тап-тап"): debounce vs каждый тап = перелистывание
- Анимация перехода между главами (fade, slide, или другая)
- Поведение на краях книги (первая/последняя страница): rubber-band, подсказка, или стоп

### Deferred Ideas (OUT OF SCOPE)
- Настраиваемые зоны тапов (NAV-v2-01)
- Haptic feedback (NAV-v2-02)
- Название главы в подсказке при переходе
- Перехват тапов на описаниях/сущностях у краёв (решается в Phase 19)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NAV-01 | Свайпы перелистывают страницу плавно без дублирования анимации (двухфазная: animate -> navigate -> reset) | Анализ root cause двойного перелистывания, архитектурный паттерн двухфазной навигации |
| NAV-02 | Свайп-анимация работает как Apple Books slide -- 60fps, spring с микро-bounce, follow-finger tracking | Конфигурация spring параметров Motion v12, under-damped spring для микро-bounce |
| NAV-03 | Пользователь может свайпом перейти к следующей/предыдущей главе на границах текущей главы | Исправление timing: chapter change до snap-back анимации, визуальный feedback |
| NAV-04 | Тапы по боковым зонам перелистывают страницу мгновенно (instant scroll) без дёрганой анимации | Перевод тапов на instant directScroll + spring-анимация только визуальная |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| motion | 12.34.3 | Spring animations, motion values, GPU transforms | Уже используется; `animate()`, `useMotionValue()`, `m.div` |
| epub.js | 0.3.93 | EPUB rendering, iframe-based content | Уже используется; stage.scrollLeft для навигации |
| React | 19.0.0 | UI framework | Уже используется |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-i18next | installed | Локализация подсказок ChapterHint | Уже используется для "Следующая глава" |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| motion spring | CSS transitions | Нет velocity inheritance, нет spring physics, нет follow-finger |
| motion spring | @use-gesture/react | Оverkill для текущей задачи, лишняя зависимость |
| Собственная FSM | XState | Текущая FSM простая (4 состояния), XState оverkill |

**Installation:**
```bash
# Новые зависимости НЕ НУЖНЫ -- всё уже установлено
```

## Architecture Patterns

### Рекомендуемая структура изменений
```
frontend/src/
├── hooks/epub/
│   ├── useGestureController.ts    # ОСНОВНОЙ ФАЙЛ: refactor pipeline
│   ├── useFollowFingerSwipe.ts    # Utility functions (без изменений или минимальные)
│   └── useEpubNavigation.ts       # Refactor: добавить instant scroll mode
├── components/Reader/
│   ├── FollowFingerContainer.tsx   # Без изменений или минимальные
│   └── ChapterHint.tsx             # Без изменений
└── (EpubReader.tsx -- минимальные изменения в интеграции)
```

### Pattern 1: Двухфазная навигация (Animate -> Navigate -> Reset)

**Что:** Разделение визуальной анимации и фактической навигации на две последовательные фазы.
**Когда использовать:** Для каждого свайпа и тапа, приводящего к перелистыванию.
**Почему:** Устраняет корневую причину двойного перелистывания.

**Текущий (СЛОМАННЫЙ) pipeline:**
```
touchend -> spring animate(translateX, -vw) -> onComplete -> translateX.set(0) -> onNavigate('next') -> nextPage() -> directScroll(smooth) -> ещё одна визуальная анимация
```
Результат: пользователь видит ДВА визуальных перемещения.

**Правильный pipeline:**
```
touchend -> spring animate(translateX, -vw) -> onComplete:
  1. directScroll('next', false)   // instant, без анимации
  2. translateX.set(0)             // reset transform
  3. resetState()                  // idle
```
```typescript
// Пример исправленного onComplete для свайпа
onComplete: async () => {
  animationRef.current = null;
  // Фаза 2: instant scroll (без visual smooth)
  if (navLockRef.current.acquire()) {
    try {
      await onNavigateRef.current(direction); // directScroll(dir, false)
    } finally {
      navLockRef.current.release();
    }
  }
  // Фаза 3: reset visual state
  translateX.set(0);
  resetState();
}
```

### Pattern 2: Instant scroll для тапов

**Что:** Тапы используют instant directScroll (behavior: 'instant') вместо smooth.
**Когда использовать:** При edge-tap навигации.
**Почему:** Smooth scroll создаёт видимую CSS-анимацию поверх spring-анимации, что вызывает "дёрганую" анимацию.

```typescript
// В useEpubNavigation -- добавить параметр smooth=false по умолчанию для тапов
// Или создать отдельную функцию instantNavigate
const instantNavigate = useCallback(async (dir: 'next' | 'prev') => {
  if (!rendition) return;
  if (isIOS() || isAndroid()) {
    const scrolled = await directScroll(dir, false); // instant
    if (scrolled) return;
  }
  // Fall through to epub.js for chapter changes
  if (dir === 'next') await rendition.next();
  else await rendition.prev();
}, [rendition, directScroll]);
```

### Pattern 3: Chapter transition с визуальным feedback

**Что:** При переходе между главами -- вызывать chapter change ДО snap-back анимации, а не после.
**Когда использовать:** Когда rubber-band offset превышает threshold на границе главы.
**Почему:** Текущий код вызывает chapter change в onComplete snap-back (к 0), но к этому моменту UI уже вернулся -- нет визуального feedback.

```typescript
// Текущий (сломанный):
animate(translateX, 0, { onComplete: () => { if (shouldTransition) onChapterChange(dir) } })

// Правильный:
if (shouldTransition) {
  // 1. Animate slide-out (в сторону перехода)
  animate(translateX, slideTarget, {
    ...SPRING_FAST,
    onComplete: async () => {
      // 2. Выполнить переход главы
      await onChapterChangeRef.current(dir);
      // 3. Reset
      translateX.set(0);
      resetState();
    },
  });
} else {
  // Snap back (не достаточный offset)
  animate(translateX, 0, { ...SPRING_RUBBER, onComplete: resetState });
}
```

### Pattern 4: Under-damped spring для микро-bounce

**Что:** Spring с `damping < 2*sqrt(stiffness*mass)` создаёт лёгкий overshoot (bounce).
**Когда использовать:** Для завершающей анимации свайпа (Apple Books feel).
**Почему:** Текущие spring configs critically damped (damping = 2*sqrt(stiffness)) -- нет bounce.

```typescript
// Текущий SPRING_NORMAL: critically damped (нет bounce)
{ stiffness: 300, damping: 35, mass: 1 }  // 2*sqrt(300) ≈ 34.6

// Для микро-bounce: slightly under-damped
export const SPRING_SWIPE = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 28,    // < 34.6 -- создаёт ~5-10% overshoot
  mass: 1,
};

// Или использовать bounce parameter Motion v12:
export const SPRING_SWIPE = {
  type: 'spring' as const,
  bounce: 0.15,     // 15% bounce
  duration: 0.4,    // visual duration
};
```

### Anti-Patterns to Avoid
- **Двойная анимация:** НЕ делать spring transform + smooth scrollTo. Выбрать ОДНО: либо spring transform (визуально), либо CSS smooth scroll.
- **setState в touchmove:** НЕ вызывать setState (кроме phase) в touchmove handler -- это создаёт re-renders и jank. Использовать refs и прямые DOM manipulations.
- **Синхронный chapter change:** НЕ вызывать `rendition.next()` / `rendition.prev()` синхронно с анимацией -- ждать завершения анимации.
- **Blocking navLock в animation callback:** Если navLock не приобретён, навигация полностью пропускается. Нужен fallback или retry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spring physics | Собственный spring solver | `motion` `animate()` с type: spring | Проверенная GPU-accelerated реализация, velocity inheritance |
| Touch gesture FSM | Новая state machine | Существующий `useGestureController` FSM | Уже работает, нужен refactor pipeline, не rewrite |
| Scroll unit measurement | Простой `clientWidth` | Существующий `getMeasuredScrollUnit()` | 5-method fallback chain уже решает edge cases |
| Navigation mutex | setTimeout debounce | Существующий `useNavigationLock` | Ref-based, auto-recovery, tested |

**Key insight:** Все необходимые утилиты уже существуют. Проблема не в отсутствии компонентов, а в неправильном порядке их вызова (pipeline ordering).

## Common Pitfalls

### Pitfall 1: Двойное перелистывание (ТЕКУЩИЙ БАГ)
**Что идёт не так:** Свайп визуально перелистывает 2 страницы.
**Почему:** Spring animate transform до -viewportWidth (визуальный сдвиг #1), затем в onComplete вызывается `nextPage()` -> `directScroll('next', true)` с smooth behavior (визуальный сдвиг #2).
**Как избежать:** В onComplete spring-анимации использовать `directScroll('next', false)` (instant, без визуальной анимации). Визуальный сдвиг обеспечивается ТОЛЬКО spring transform.
**Warning signs:** Любой путь кода, где spring animate + smooth scroll вызываются последовательно.

### Pitfall 2: Chapter transition не работает (ТЕКУЩИЙ БАГ)
**Что идёт не так:** Rubber-band тянется, но при отпускании страница всегда возвращается, переход не срабатывает.
**Почему:** `onChapterChange` вызывается в `onComplete` snap-back анимации к 0. К этому моменту `rendition.next()` может конфликтовать с уже сброшенным transform.
**Как избежать:** При `shouldTransition=true` -- НЕ snap-back к 0, а slide-out к краю viewport, затем chapter change, затем reset.
**Warning signs:** `onComplete` callback, который делает snap-back к 0 и потом пытается навигировать.

### Pitfall 3: Дёрганая анимация (ТЕКУЩИЙ БАГ)
**Что идёт не так:** Follow-finger tracking и spring-анимация выглядят "как 30fps".
**Почему вероятно:**
1. `setShowChapterHint`, `setChapterHintDirection`, `setIsAtBoundary` вызываются в touchmove -- это React setState, каждый вызов = re-render.
2. Smooth scroll (`behavior: 'smooth'`) работает одновременно со spring transform.
**Как избежать:**
1. Минимизировать setState в touchmove -- только `setPhase('tracking')` один раз. Остальное через refs + DOM mutations.
2. Убрать smooth scroll из pipeline свайпа.
**Warning signs:** Множественные `setState` вызовы внутри touchmove handler.

### Pitfall 4: Race condition при быстрых тапах
**Что идёт не так:** Быстрые тапы ("тап-тап-тап") могут пропускать страницы или замирать.
**Почему:** `navLock.acquire()` возвращает false, если предыдущая навигация ещё не завершилась. `pendingNavRef` хранит только ПОСЛЕДНИЙ тап.
**Как избежать:** Guaranteed-last pattern уже реализован корректно. Но нужно убедиться, что `navLock.release()` вызывается надёжно (в finally block).
**Warning signs:** Навигация "замирает" после серии быстрых тапов.

### Pitfall 5: epub.js stage width не делится на 8
**Что идёт не так:** На некоторых устройствах (OnePlus 6T и др.) iframe сдвигается при навигации.
**Почему:** epub.js bug: container width не делится на 8 -- iframe получает sub-pixel left padding.
**Как избежать:** Установить container width = `Math.floor(window.innerWidth / 8) * 8`. Это known workaround из epub.js issues.
**Warning signs:** Текст обрезается или сдвигается при навигации на Android устройствах.

### Pitfall 6: iOS iframe touch events
**Что идёт не так:** Touch events не пробрасываются из iframe в parent document на iOS.
**Почему:** WebKit limitation (Bug 128924).
**Как избежать:** Текущее решение (iOS overlay для center-tap + `hooks.content.register` для swipe) -- корректное. НЕ удалять iOS overlay.
**Warning signs:** Center-tap не работает на iOS Safari/PWA.

## Code Examples

### Ключевые точки изменений

#### 1. Исправление двойного перелистывания в useGestureController.ts
```typescript
// Строки 566-584: swipe completion (navigate=true)
// ТЕКУЩИЙ КОД (сломанный):
animationRef.current = animate(translateX, target, {
  ...spring,
  velocity: velocity * 1000,
  onComplete: () => {
    animationRef.current = null;
    translateX.set(0);
    resetState();
    // ЭТО ВЫЗЫВАЕТ ДВОЙНОЕ ПЕРЕЛИСТЫВАНИЕ:
    if (navLockRef.current.acquire()) {
      onNavigateRef.current(direction).finally(() => {
        navLockRef.current.release();
      });
    }
  },
});

// ИСПРАВЛЕННЫЙ КОД:
animationRef.current = animate(translateX, target, {
  ...spring,
  velocity: velocity * 1000,
  onComplete: async () => {
    animationRef.current = null;
    // Navigate FIRST (instant, без visual)
    if (navLockRef.current.acquire()) {
      try {
        await onNavigateRef.current(direction);
      } finally {
        navLockRef.current.release();
      }
    }
    // THEN reset visual
    translateX.set(0);
    resetState();
  },
});
```

#### 2. Instant scroll для навигации через свайп
```typescript
// В EpubReader.tsx: onNavigate callback должен использовать instant scroll
onNavigate: async (dir) => {
  // Для свайпов: spring animation уже сделала визуальный сдвиг
  // Нужен только instant scroll (без smooth)
  if (dir === 'next') await instantNextPage();
  else await instantPrevPage();
},
```

#### 3. Минимизация re-renders в touchmove
```typescript
// ВМЕСТО setState для chapter hint в touchmove:
// Использовать ref + прямую DOM мутацию
const chapterHintRef = useRef<{
  show: boolean;
  direction: 'next' | 'prev' | null;
}>({ show: false, direction: null });

// В touchmove:
chapterHintRef.current = { show: true, direction: 'next' };
// DOM: через callback ref или useMotionValueEvent
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| framer-motion | motion (standalone) | 2024, v11+ | Импорт из `motion/react` вместо `framer-motion` |
| CSS smooth scroll для навигации | Spring transform + instant scroll | Нужно сделать в Phase 16 | Устраняет двойное перелистывание |
| Critically damped springs | Under-damped для bounce | Phase 16 | Apple Books-like micro-bounce |
| epub.js `rendition.next()` | Direct `stage.scrollTo()` | Jan 2026 (v1.0) | Исправляет epub.js multi-page scroll bug |

**Deprecated/outdated:**
- `useFollowFingerSwipe` hook: функционально заменён `useGestureController`, но утилиты из него (`getStageInfo`, `shouldNavigate` и др.) активно используются как exports. Hook сам по себе -- dead code (Phase 20 CLN-01).
- `useTouchNavigation.ts`: dead code, заменён gesture controller (Phase 20 CLN-01).
- `IOSTapZones.tsx`: частично dead code -- iOS overlay для center-tap встроен в gesture controller, но компонент всё ещё существует (Phase 20 CLN-01).

## Рекомендации по Claude's Discretion

### Flick-поведение
**Рекомендация:** Текущие пороги (`quickSwipeVelocity: 0.3 px/ms`, `quickSwipeMinDistance: 15px`) -- разумные. Уменьшить `quickSwipeMinDistance` до 10px для более отзывчивого flick. Оставить velocity threshold на 0.3.

### Быстрые повторные тапы
**Рекомендация:** Каждый тап = перелистывание (через guaranteed-last pattern). НЕ debounce. Пользователь ожидает, что каждый тап = одна страница. `useNavigationLock` с `pendingNavRef` уже обеспечивает корректное поведение (последний тап выполняется гарантированно).

### Анимация перехода между главами
**Рекомендация:** Slide (тот же spring что и для обычного свайпа). Fade создаёт несвязный visual -- пользователь свайпит горизонтально, а контент фейдится. Slide -- естественное продолжение жеста.

### Поведение на краях книги
**Рекомендация:** Rubber-band + подсказка "Начало книги" / "Конец книги". Тот же паттерн, что для границ глав, но без перехода. Rubber-band обеспечивает тактильную обратную связь "дальше нельзя".

## Open Questions

1. **Timing directScroll vs translateX.set(0)**
   - Что мы знаем: `directScroll` -- async (ждёт `waitForScrollEnd`), `translateX.set(0)` -- sync
   - Что неясно: Нужно ли ждать directScroll перед reset translateX? Или instant scroll достаточно быстрый?
   - Рекомендация: При instant scroll (behavior: 'instant') -- `scrollTo` синхронный, можно сразу reset. Проверить на реальном устройстве.

2. **4 вызова setState в touchmove handler**
   - Что мы знаем: `setShowChapterHint`, `setChapterHintDirection`, `setIsAtBoundary`, `setPhase` вызываются в touchmove
   - Что неясно: Насколько React 19 batching компенсирует это? Нужно ли оптимизировать?
   - Рекомендация: React 19 автоматически batch-ит setState. Но 4 setState в 60fps touchmove всё ещё может создавать микро-jank. Конвертировать chapter hint state в refs с DOM mutations (как shadowRef в FollowFingerContainer).

3. **epub.js width divisible by 8 bug**
   - Что мы знаем: Описан в epub.js issues, workaround -- container width кратна 8
   - Что неясно: Воспроизводится ли на Pixel 9?
   - Рекомендация: Не делать в Phase 16 если не подтверждается. Пометить для проверки.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (jsdom environment) |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npx vitest run src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts --reporter=verbose` |
| Full suite command | `cd frontend && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | Свайп перелистывает ровно 1 страницу (no double) | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts -x` | No -- Wave 0 |
| NAV-01 | directScroll с instant behavior | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useEpubNavigation.test.ts -x` | Partial (existing, update) |
| NAV-02 | Spring config: under-damped для micro-bounce | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts -x` | Partial (spring config tests exist) |
| NAV-03 | Chapter transition при rubber-band > threshold | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts -x` | No -- Wave 0 |
| NAV-04 | Тап вызывает instant scroll + spring animation | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts -x` | No -- Wave 0 |
| ALL | Полный frontend build без TS ошибок | build | `cd frontend && npm run build` | N/A |

### Sampling Rate
- **Per task commit:** `cd frontend && npx vitest run src/hooks/epub/__tests__/ --reporter=verbose`
- **Per wave merge:** `cd frontend && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/hooks/epub/__tests__/useGestureController.test.ts` -- покрывает NAV-01, NAV-03, NAV-04
- [ ] Обновить `useEpubNavigation.test.ts` -- тесты для instant scroll mode
- [ ] Обновить `useFollowFingerSwipe.test.ts` -- тесты для под-демпфированного spring config

## Анализ корневых причин багов

### Bug 1: Двойное перелистывание (ВСЕГДА)
**Локализация:** `useGestureController.ts` строки 566-584 (swipe completion), строки 488-510 (tap slide animation)
**Root cause:** Двойная визуальная навигация:
1. Spring animate: `translateX` -> `-viewportWidth` (визуальный сдвиг wrapper div)
2. В onComplete: `onNavigate('next')` -> `nextPage()` -> `directScroll('next', true)` -> `stage.scrollTo(smooth)` (ещё один визуальный сдвиг stage container)
**Fix:** В onComplete использовать instant scroll (без smooth) + навигировать ДО reset translateX.

### Bug 2: Дёрганая анимация
**Локализация:** `useGestureController.ts` строки 396-416 (touchmove handler)
**Root cause (вероятно):**
1. 4x setState в каждом touchmove event: `setShowChapterHint`, `setChapterHintDirection`, `setIsAtBoundary`, плюс `setPhase` на первом move
2. Smooth CSS scroll overlay на spring transform
**Fix:**
1. Конвертировать hint/boundary state в refs + DOM mutations
2. Убрать smooth scroll из свайп pipeline

### Bug 3: Переход между главами не работает
**Локализация:** `useGestureController.ts` строки 533-557 (rubber-band completion)
**Root cause:** `shouldTransition` рассчитывается от `rubberOffset` (с resistance 0.4), но `chapterTransitionThreshold = 0.35` от `viewportWidth`. Для viewport 375px: нужно `rubberOffset >= 131px`, но `maxRubberBand = 80px`. Threshold НИКОГДА не достигается!
**Math:** `maxRubberBand (80) < viewportWidth * chapterTransitionThreshold (375 * 0.35 = 131.25)` -- невозможно!
**Fix:** Либо увеличить `maxRubberBand`, либо сравнивать threshold с raw offset (до resistance), либо уменьшить threshold.

### Bug 4: Тапы "выглядят не так"
**Локализация:** `useGestureController.ts` строки 488-510
**Root cause:** Тап вызывает spring animate(translateX, -viewportWidth) + `onEdgeTap` -> `nextPage()` -> `directScroll(smooth)`. Та же проблема, что Bug 1, но без дублирования (вероятно, timing отличается).
**Fix:** Тап = instant directScroll + spring animation чисто визуальная.

## Sources

### Primary (HIGH confidence)
- Исходный код проекта: `useGestureController.ts` (862 строки), `useFollowFingerSwipe.ts` (608 строк), `useEpubNavigation.ts` (363 строки), `FollowFingerContainer.tsx` (116 строк), `EpubReader.tsx` (750 строк)
- Existing tests: `useFollowFingerSwipe.test.ts`, `useEpubNavigation.test.ts`, `useNavigationLock.test.ts`
- CONTEXT.md -- пользовательские решения и описания багов

### Secondary (MEDIUM confidence)
- [Motion.dev spring docs](https://motion.dev/docs/spring) -- spring параметры (stiffness, damping, mass, bounce)
- [epub.js issue #1067](https://github.com/futurepress/epub.js/issues/1067) -- iframe width bug workaround (width divisible by 8)
- [Apple Books UI Animations](https://www.wearemobilefirst.com/blog/apple-books-ui-animations-2) -- референс анимации

### Tertiary (LOW confidence)
- Apple WWDC23 spring animation talk -- общие принципы spring physics для UI

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- всё уже установлено и используется
- Architecture: HIGH -- корневые причины всех 4 багов локализованы в коде
- Pitfalls: HIGH -- баги воспроизведены аналитически (math proof для Bug 3)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (стабильный стек, нет ожидаемых breaking changes)