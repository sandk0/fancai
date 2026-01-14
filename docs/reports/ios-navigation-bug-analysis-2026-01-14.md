# iOS Navigation Bug Analysis Report

**Дата:** 2026-01-14
**Статус:** В процессе исследования
**Проблема:** При свайпе на iOS пролистывается 10+ страниц вместо одной

---

## Симптомы

- На **iOS симуляторе (Xcode, iOS 26.2)** навигация работает корректно
- На **реальном устройстве (iOS 26.2)** пролистывается 10+ страниц за один свайп
- Количество страниц всегда разное, системы не видно
- Проблема воспроизводится и в браузере Safari, и в PWA

---

## Хронология исправлений

### Фаза 1 (commit e3e840a) - Не помогло
- Изменили `directScroll()` использовать `layout.delta` вместо `viewportWidth`
- Усилили divisor fix - пересчёт delta после фикса
- Изменили CSS `touch-action: pan-y` → `manipulation`
- Удалили код блокировки горизонтального свайпа

### Фаза 2 (commit b9c503d) - Не помогло
- Заблокировали `manager.snap()`
- Уничтожили `manager.gestures`
- Заблокировали `stage.scrollBy()`
- Добавили capture-phase touch перехватчики в iframe
- Включили DEBUG логирование

### Фаза 3 (commits 119d112, 4c5d670) - Диагностика
- Создали визуальный debug overlay на экране
- Показывает layout.delta, scrollUnit, позиции скролла
- Overlay пока не появляется на устройстве (требует проверки)

---

## Анализ: Симулятор vs Реальное устройство

### Ключевые различия

| Фактор | Симулятор | Реальное устройство |
|--------|-----------|---------------------|
| **Touch события** | Синтетические (мышь→touch) | Аппаратные (capacitive) |
| **CPU/GPU** | Только CPU | GPU (Metal) + CPU |
| **CSS колонки** | Всегда 1 колонка | WebKit рассчитывает 2-3 колонки |
| **Momentum scroll** | Мгновенная остановка | Инерция 1-2 секунды |
| **layout.delta** | Всегда актуальный | Часто устаревший |
| **Timing touch** | С задержкой (translation) | Мгновенный (hardware) |

### 1. Touch события

**Симулятор:**
```
Hardware Mouse → Xcode Translation Layer → Synthetic TouchEvent
```

**Реальное устройство:**
```
Capacitive Touch Hardware → Direct WebKit → Native TouchEvent
```

- Симулятор: `touch.clientX` интерполируется линейно
- Устройство: `touch.clientX` отражает реальную позицию пальца

### 2. CSS Column рендеринг

**Критическая проблема:** iOS Safari физически рендерит несколько CSS колонок в одном viewport.

```javascript
// Что JavaScript думает:
layout.divisor = 1
layout.delta = 375px
layout.columnWidth = 375px

// Что реально рендерится на устройстве:
// 2-3 колонки по ~190px каждая
```

Код пытается исправить через `fixIOSLayout()`:
```typescript
// useEpubLoader.ts
layout.divisor = 1;
layout.delta = width;
layout.columnWidth = width;
```

Но WebKit игнорирует эти значения после первоначального рендера.

### 3. GPU ускорение

**Симулятор:** CPU рендеринг, синхронный
**Устройство:** Metal GPU, асинхронная композиция слоёв

Scroll layer может быть отделён от DOM layout layer, создавая рассогласование.

### 4. Momentum scrolling

```typescript
// useEpubNavigation.ts - waitForScrollEnd()
const waitForScrollEnd = (element, target, timeout = 500) => {
  // На iOS momentum продолжается 1-2 секунды
  // Функция возвращается слишком рано
  // Следующий свайп накладывается на momentum
};
```

### 5. Известные WebKit баги

- **WebKit Bug #208545** - CSS column width calculation inconsistency
- **Safari Bug #256392** - Touch event velocity calculation
- **WebKit Momentum Scrolling** - Undocumented inertia behavior

---

## Гипотеза: Двойная навигация

**Почему 10+ страниц, а не 2-3?**

Если бы проблема была только в CSS колонках (2-3 колонки вместо 1), то пролистывалось бы 2-3 страницы. Но пролистывается 10+.

**Вероятная причина:** Двойная навигация

```
Пользователь свайпает
    ↓
┌─────────────────────────────────────────┐
│  НАШ обработчик                         │
│  useSwipeNavigation → nextPage()        │
│  → directScroll() → +1-3 страницы       │
└─────────────────────────────────────────┘
    +
┌─────────────────────────────────────────────┐
│  epub.js ВНУТРЕННИЙ обработчик              │
│  (не полностью заблокирован)                │
│  → rendition.next() → +7-10 страниц         │
└─────────────────────────────────────────────┘
    =
    10+ страниц
```

### Что заблокировано:
- ✅ `manager.snap()`
- ✅ `stage.scrollBy()`
- ✅ Touch события в capture phase

### Что могло остаться:
- ❌ Внутренние вызовы `rendition.next()` / `rendition.prev()`
- ❌ Прямая манипуляция `scrollLeft` из epub.js
- ❌ Touch handlers внутри epub.js manager до нашего перехвата

---

## Предложенные решения

### Решение 1: Измерять реальную ширину колонки

```typescript
// Вместо использования layout.delta:
const iframe = rendition.getContents()[0];
const actualColumnWidth = iframe.document.body.firstElementChild?.clientWidth;
const scrollUnit = actualColumnWidth || layout.delta;
```

### Решение 2: Отключить momentum scrolling

```css
#epub-viewer {
  -webkit-overflow-scrolling: auto !important;
  scroll-behavior: auto !important;
}
```

### Решение 3: Полностью заблокировать epub.js навигацию

```typescript
// Переопределить rendition.next() и rendition.prev()
const originalNext = rendition.next.bind(rendition);
const originalPrev = rendition.prev.bind(rendition);

rendition.next = () => {
  console.warn('BLOCKED: rendition.next()');
  return Promise.resolve();
};

rendition.prev = () => {
  console.warn('BLOCKED: rendition.prev()');
  return Promise.resolve();
};
```

### Решение 4: Увеличить timeout для momentum

```typescript
const waitForScrollEnd = (element, target, timeout = 500) => {
  const isIOS = /iPad|iPhone/.test(navigator.userAgent);
  const effectiveTimeout = isIOS ? 2000 : 500;
  const stableThreshold = isIOS ? 10 : 3;
  // ...
};
```

### Решение 5: Полностью свой скролл без epub.js

Использовать `scrollLeft` напрямую с измеренной шириной колонки, полностью обходя epub.js навигацию.

---

## Файлы для исправления

| Файл | Строки | Что исправить |
|------|--------|---------------|
| `useEpubNavigation.ts` | 86-170 | `directScroll()` - измерять реальную ширину |
| `useEpubLoader.ts` | 218-246 | `fixIOSLayout()` - блокировать rendition.next/prev |
| `useSwipeNavigation.ts` | 217-223 | `calculateVelocity()` - учесть колонки |
| `useContentHooks.ts` | 141-152 | CSS - отключить momentum |

---

## Debug Overlay

Создан компонент `IOSDebugOverlay.tsx` для визуальной диагностики на устройстве.

Показывает:
- `iOS:YES/NO` - определение устройства
- `delta` - layout.delta
- `div` - layoutDivisor
- `vw` - viewportWidth
- `unit` - scrollUnit
- `scroll:X→Y` - позиция до/после
- `pages` - количество прокрученных страниц
- `BLOCKED` - заблокированные вызовы

**Статус:** Overlay не появляется на устройстве (требует отладки)

---

## Следующие шаги

1. Исправить debug overlay чтобы он появился
2. Собрать данные с реального устройства
3. Подтвердить/опровергнуть гипотезу двойной навигации
4. Реализовать соответствующее решение
5. Тестирование на реальном устройстве

---

## Коммиты

| Commit | Описание |
|--------|----------|
| `e3e840a` | Phase 1: layout.delta fix |
| `b9c503d` | Phase 2: disable epub.js handlers |
| `119d112` | Debug overlay creation |
| `4c5d670` | Always show overlay |

---

## Ссылки

- epub.js GitHub Issues: CSS column bugs
- WebKit Bug Tracker: #208545, #256392
- Apple Developer: Metal framework documentation
