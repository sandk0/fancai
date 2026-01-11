# План миграции на Swipe-навигацию

**Дата:** Январь 2026
**Статус:** План утверждён
**Приоритет:** Критический (iOS навигация)

---

## Содержание

1. [Анализ текущего состояния](#анализ-текущего-состояния)
2. [Анализ решения Flow](#анализ-решения-flow)
3. [Проектирование улучшенного решения](#проектирование-улучшенного-решения)
4. [План доработок](#план-доработок)
5. [Технические детали реализации](#технические-детали-реализации)

---

## Анализ текущего состояния

### Текущая навигация в fancai

| Платформа | Метод | Статус |
|-----------|-------|--------|
| **iOS PWA** | IOSTapZones (8% края) | ⚠️ Multi-page bug |
| **iOS Safari** | IOSTapZones | ⚠️ Multi-page bug |
| **Android** | useTouchNavigation (25% края) | ✅ Работает |
| **Desktop** | Keyboard + Click | ✅ Работает |

### Проблемы текущей реализации

1. **iOS multi-page bug** — тап перелистывает несколько страниц за раз
2. **Нет swipe** — только tap, неестественно для мобильных
3. **Нет анимации** — мгновенный переход между страницами
4. **Direct scroll fix** — экспериментальный, не решает проблему полностью

### Текущий код навигации (useEpubNavigation.ts)

```typescript
// iOS Direct Scroll - обход epub.js
const iosDirectScroll = (direction: 'next' | 'prev'): boolean => {
  const stage = manager.stage?.container || manager.container
  const viewportWidth = stage.clientWidth
  const currentScroll = stage.scrollLeft

  // Мгновенное изменение scrollLeft - нет анимации!
  stage.scrollLeft = currentScroll + viewportWidth
  return true
}
```

**Проблема:** Нет плавной анимации, резкий переход.

---

## Анализ решения Flow

### Реализация свайпа в Flow (Reader.tsx)

```typescript
// Touch tracking
const handleTouchStart = (e: TouchEvent) => {
  const x0 = e.targetTouches[0]?.clientX ?? 0
  const y0 = e.targetTouches[0]?.clientY ?? 0
  const t0 = Date.now()
  // Store for later
}

const handleTouchEnd = (e: TouchEvent) => {
  const x1 = e.changedTouches[0]?.clientX ?? 0
  const t1 = Date.now()

  const deltaX = x1 - x0
  const deltaT = t1 - t0
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)

  // Фильтрация
  if (absX < 10) return              // Минимальное движение
  if (absY / absX > 2) return        // Вертикальный скролл
  if (deltaT > 100 || absX < 30) return  // Слишком долго или мало

  // Навигация
  if (deltaX > 0) tab.prev()
  else tab.next()
}
```

### Оценка решения Flow

| Аспект | Flow | Оценка |
|--------|------|--------|
| **Swipe detection** | Да | ✅ Хорошо |
| **Velocity-based** | Нет (только deltaT) | ⚠️ Можно улучшить |
| **Плавная анимация** | Нет | ❌ Критично! |
| **Finger tracking** | Нет | ❌ Нет |
| **iOS-specific** | Нет | ❌ Те же проблемы |

### Вывод

**Решение Flow НЕ подходит напрямую** — оно не имеет плавных анимаций, что является ключевым требованием. Нужно разработать собственное улучшенное решение.

---

## Проектирование улучшенного решения

### Требования

1. **iOS (обязательно)**
   - Swipe-only навигация (без тапов)
   - Плавная анимация следования за пальцем
   - Snap-to-page при отпускании
   - Работа в PWA и Safari

2. **Android (опционально)**
   - Выбор между swipe и tap в настройках
   - Та же анимация при выборе swipe
   - Дефолт: swipe (новое поведение)

3. **Анимация (обязательно)**
   - Страница следует за пальцем в реальном времени
   - При отпускании — плавный snap к ближайшей странице
   - Spring-based физика для естественности
   - Длительность snap: 300-400ms

### Архитектура решения

```
┌─────────────────────────────────────────────────────────┐
│                   SwipeNavigator.tsx                     │
│                                                          │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   Gesture Layer │    │       Animation Layer        │ │
│  │   (touch events)│───▶│   (framer-motion/CSS)       │ │
│  └─────────────────┘    └─────────────────────────────┘ │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │  Swipe State    │    │     Visual Feedback          │ │
│  │  (offset, phase)│    │     (translateX, opacity)    │ │
│  └─────────────────┘    └─────────────────────────────┘ │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │              epub.js Navigation                      ││
│  │              (after animation completes)             ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Варианты реализации анимации

#### Вариант A: CSS scroll-behavior: smooth

```typescript
// Простой вариант - плавный скролл
const smoothScroll = (direction: 'next' | 'prev') => {
  const stage = manager.stage?.container
  stage.style.scrollBehavior = 'smooth'

  const target = direction === 'next'
    ? currentScroll + viewportWidth
    : currentScroll - viewportWidth

  stage.scrollTo({ left: target, behavior: 'smooth' })
}
```

**Плюсы:** Просто, нативно
**Минусы:** Нет finger tracking, фиксированная скорость

#### Вариант B: CSS Transform overlay (Рекомендуется)

```typescript
// Оверлей следует за пальцем, потом скрывается
const SwipeOverlay = () => {
  const [offset, setOffset] = useState(0)
  const [swiping, setSwiping] = useState(false)

  return (
    <m.div
      style={{
        transform: `translateX(${offset}px)`,
        position: 'absolute',
        inset: 0,
        pointerEvents: swiping ? 'auto' : 'none'
      }}
      animate={{ x: swiping ? offset : 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Визуальная копия текущей страницы */}
    </m.div>
  )
}
```

**Плюсы:** Полный контроль, finger tracking
**Минусы:** Сложнее реализовать, нужна визуальная копия

#### Вариант C: Гибридный (Оптимальный)

```typescript
// 1. Finger tracking через CSS transform на overlay
// 2. После gesture end — smooth scroll к целевой странице
// 3. Скрытие overlay после завершения scroll

const handleSwipeEnd = async (velocity: number, offset: number) => {
  // Определяем направление по offset и velocity
  const shouldNavigate = Math.abs(offset) > threshold || Math.abs(velocity) > velocityThreshold
  const direction = offset > 0 ? 'prev' : 'next'

  if (shouldNavigate) {
    // 1. Запускаем smooth scroll
    await smoothScrollToPage(direction)

    // 2. Скрываем overlay
    setOverlayVisible(false)
  } else {
    // Snap back с анимацией
    animateOverlayTo(0)
  }
}
```

### Выбранное решение

**Вариант C (Гибридный)** — оптимальный баланс между UX и сложностью:

1. **Gesture detection** — собственный (не Flow, улучшенный)
2. **Finger tracking** — CSS transform на overlay div
3. **Snap animation** — `scrollTo({ behavior: 'smooth' })` или spring
4. **Page navigation** — стандартный epub.js после анимации

---

## План доработок

### Фаза 1: Подготовка (1 день)

| Задача | Файлы | Оценка |
|--------|-------|--------|
| Создать настройку navigationMode в localStorage | `stores/reader.ts` | 2ч |
| Добавить UI переключателя в ReaderSettingsPanel | `ReaderSettingsPanel.tsx` | 2ч |
| Добавить переводы | `locales/*.json` | 1ч |

**Настройка:**
```typescript
interface ReaderSettings {
  // ... existing
  navigationMode: 'swipe' | 'tap'  // default: 'swipe'
}

// iOS: всегда 'swipe', без выбора
// Android: выбор в настройках
```

### Фаза 2: Swipe Hook (2 дня)

| Задача | Файлы | Оценка |
|--------|-------|--------|
| Создать `useSwipeNavigation.ts` | `hooks/epub/` | 4ч |
| Gesture detection с velocity | | 2ч |
| Интеграция с epub.js manager | | 2ч |
| Тестирование на iOS | | 2ч |

**Основной hook:**
```typescript
// hooks/epub/useSwipeNavigation.ts
interface UseSwipeNavigationOptions {
  rendition: Rendition | null
  enabled: boolean
  onNavigate: (direction: 'next' | 'prev') => void
  onSwipeStart?: () => void
  onSwipeEnd?: () => void
}

interface SwipeState {
  swiping: boolean
  offset: number      // px от начала
  velocity: number    // px/ms
  direction: 'left' | 'right' | null
}

export const useSwipeNavigation = (options: UseSwipeNavigationOptions) => {
  // Implementation
  return {
    swipeState,
    overlayStyle,  // CSS для визуального фидбека
  }
}
```

### Фаза 3: Overlay компонент (2 дня)

| Задача | Файлы | Оценка |
|--------|-------|--------|
| Создать `SwipeOverlay.tsx` | `components/Reader/` | 4ч |
| Интеграция с framer-motion | | 2ч |
| Edge indicators (стрелки по краям) | | 2ч |
| Тестирование анимаций | | 2ч |

**Компонент:**
```typescript
// components/Reader/SwipeOverlay.tsx
interface SwipeOverlayProps {
  swipeState: SwipeState
  viewportWidth: number
  onAnimationComplete: () => void
}

export const SwipeOverlay: React.FC<SwipeOverlayProps> = ({
  swipeState,
  viewportWidth,
  onAnimationComplete
}) => {
  return (
    <m.div
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `translateX(${swipeState.offset}px)`,
        opacity: calculateOpacity(swipeState.offset, viewportWidth)
      }}
      animate={swipeState.swiping ? undefined : { x: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      onAnimationComplete={onAnimationComplete}
    >
      {/* Visual feedback elements */}
      <SwipeIndicator direction="left" visible={swipeState.offset > 50} />
      <SwipeIndicator direction="right" visible={swipeState.offset < -50} />
    </m.div>
  )
}
```

### Фаза 4: Smooth Scroll (1 день)

| Задача | Файлы | Оценка |
|--------|-------|--------|
| Добавить smooth scroll в direct scroll | `useEpubNavigation.ts` | 3ч |
| Обработка scroll end event | | 2ч |
| Fallback для старых браузеров | | 1ч |

**Улучшенный direct scroll:**
```typescript
const smoothDirectScroll = async (direction: 'next' | 'prev'): Promise<boolean> => {
  const stage = manager.stage?.container || manager.container
  const viewportWidth = stage.clientWidth
  const currentScroll = stage.scrollLeft

  const target = direction === 'next'
    ? Math.min(currentScroll + viewportWidth, maxScroll)
    : Math.max(currentScroll - viewportWidth, 0)

  // Smooth scroll
  stage.scrollTo({
    left: target,
    behavior: 'smooth'
  })

  // Wait for scroll to complete
  await waitForScrollEnd(stage, target)
  return true
}

const waitForScrollEnd = (element: HTMLElement, target: number): Promise<void> => {
  return new Promise(resolve => {
    const checkScroll = () => {
      if (Math.abs(element.scrollLeft - target) < 1) {
        resolve()
      } else {
        requestAnimationFrame(checkScroll)
      }
    }
    checkScroll()
  })
}
```

### Фаза 5: Интеграция (1 день)

| Задача | Файлы | Оценка |
|--------|-------|--------|
| Интеграция в EpubReader.tsx | `EpubReader.tsx` | 3ч |
| Условная логика iOS/Android | | 2ч |
| Удаление IOSTapZones (iOS) | | 1ч |

**Интеграция:**
```typescript
// EpubReader.tsx
const EpubReader = ({ book }: EpubReaderProps) => {
  const isIOS = useIsIOS()
  const [settings] = useReaderSettings()

  // Определяем режим навигации
  const navigationMode = isIOS ? 'swipe' : settings.navigationMode

  // Swipe navigation
  const { swipeState } = useSwipeNavigation({
    rendition,
    enabled: navigationMode === 'swipe',
    onNavigate: handlePageNavigation
  })

  return (
    <div className="reader-container">
      {/* Epub viewer */}
      <div id="epub-viewer" ref={viewerRef} />

      {/* Swipe overlay - only when swiping */}
      {navigationMode === 'swipe' && (
        <SwipeOverlay
          swipeState={swipeState}
          viewportWidth={viewportWidth}
        />
      )}

      {/* Tap zones - only for Android with tap mode */}
      {navigationMode === 'tap' && !isIOS && (
        <TapZones onPrev={prevPage} onNext={nextPage} />
      )}

      {/* iOS tap zones removed - swipe only */}
    </div>
  )
}
```

### Фаза 6: Тестирование (2 дня)

| Задача | Устройства | Оценка |
|--------|-----------|--------|
| iOS Safari | iPhone 13/14/15 | 2ч |
| iOS PWA | iPhone 13/14/15 | 2ч |
| Android Chrome | Samsung/Pixel | 2ч |
| Android PWA | Samsung/Pixel | 2ч |
| Desktop Chrome/Firefox/Safari | MacBook | 2ч |
| Edge cases | Low-end devices | 2ч |

**Чеклист тестирования:**
- [ ] Свайп влево → следующая страница
- [ ] Свайп вправо → предыдущая страница
- [ ] Быстрый свайп → навигация с меньшим offset
- [ ] Медленный свайп → snap back если мало
- [ ] Вертикальный скролл не триггерит навигацию
- [ ] Описания кликаются (iOS)
- [ ] Описания кликаются (Android)
- [ ] Анимация плавная 60fps
- [ ] Переключение tap/swipe работает (Android)
- [ ] Нет multi-page bug на iOS

---

## Технические детали реализации

### Параметры gesture detection

```typescript
const SWIPE_CONFIG = {
  // Минимальные значения для срабатывания
  minDistance: 30,        // px - минимальное смещение
  minVelocity: 0.3,       // px/ms - минимальная скорость

  // Максимальные значения для отмены
  maxVerticalRatio: 2,    // если deltaY/deltaX > 2, это вертикальный скролл
  maxDuration: 300,       // ms - максимальное время свайпа

  // Threshold для быстрого свайпа
  quickSwipeVelocity: 0.8, // px/ms - при такой скорости навигация даже при малом offset
  quickSwipeMinDistance: 20, // px

  // Finger tracking
  resistance: 0.5,        // Коэффициент сопротивления за пределами страницы
  rubberBandFactor: 0.3,  // Rubber band эффект на границах
}
```

### CSS для smooth scroll

```css
/* Добавить в useContentHooks.ts */
@supports (-webkit-touch-callout: none) {
  /* iOS only */
  .epub-container {
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }

  .epub-container > * {
    scroll-snap-align: start;
  }
}
```

### Анимация overlay

```typescript
// Параметры spring анимации
const SPRING_CONFIG = {
  // Snap to page
  snap: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
    mass: 1,
  },

  // Snap back (отмена свайпа)
  snapBack: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 35,
    mass: 0.8,
  },

  // Quick snap (быстрый свайп)
  quickSnap: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 40,
    mass: 0.5,
  }
}
```

### Обработка edge cases

```typescript
// Boundary handling
const handleSwipeAtBoundary = (direction: 'next' | 'prev', isAtBoundary: boolean) => {
  if (isAtBoundary) {
    // Rubber band effect
    return {
      maxOffset: 50, // px - максимальный offset за границей
      resistance: 3, // Увеличенное сопротивление
      onRelease: 'snapBack' as const
    }
  }
  return null
}

// Chapter boundary
const handleChapterBoundary = async (direction: 'next' | 'prev') => {
  // При свайпе на границе главы
  // 1. Показать индикатор "Следующая глава"
  // 2. При отпускании — вызвать epub.js navigation
  // 3. Дождаться загрузки новой главы
  // 4. Сбросить анимацию
}
```

---

## Сводка плана

### Сроки

| Фаза | Задачи | Дни |
|------|--------|-----|
| 1 | Подготовка (настройки, UI) | 1 |
| 2 | useSwipeNavigation hook | 2 |
| 3 | SwipeOverlay компонент | 2 |
| 4 | Smooth Scroll | 1 |
| 5 | Интеграция | 1 |
| 6 | Тестирование | 2 |
| **Итого** | | **9 дней** |

### Файлы для создания

1. `frontend/src/hooks/epub/useSwipeNavigation.ts` — основной hook
2. `frontend/src/components/Reader/SwipeOverlay.tsx` — визуальный overlay
3. `frontend/src/components/Reader/SwipeIndicator.tsx` — индикаторы по краям

### Файлы для изменения

1. `frontend/src/stores/reader.ts` — добавить navigationMode
2. `frontend/src/components/Reader/ReaderSettingsPanel.tsx` — UI переключателя
3. `frontend/src/components/Reader/EpubReader.tsx` — интеграция
4. `frontend/src/hooks/epub/useEpubNavigation.ts` — smooth scroll
5. `frontend/src/components/Reader/IOSTapZones.tsx` — удалить/переработать
6. `frontend/src/locales/*.json` — переводы

### Риски

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| iOS scroll-behavior не работает | Средняя | Fallback на JS animation |
| Конфликт с epub.js событиями | Низкая | Использовать capture phase |
| Performance на старых устройствах | Низкая | will-change: transform, throttle |
| Конфликт с описаниями | Средняя | Увеличить center zone |

### Критерии успеха

- [ ] iOS: свайп работает стабильно в PWA и Safari
- [ ] iOS: нет multi-page bug
- [ ] Анимация 60fps на iPhone 12+
- [ ] Android: переключатель работает
- [ ] Описания кликаются на обеих платформах
- [ ] Нет регрессий в существующем функционале

---

*Документ создан: Январь 2026*
*Автор: Claude Code Analysis*
