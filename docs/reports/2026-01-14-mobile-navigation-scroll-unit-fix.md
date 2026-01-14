# Исправление навигации на мобильных устройствах: Измерение CSS Column Width

**Дата:** 2026-01-14
**Статус:** Реализовано
**Тип:** Критическое исправление
**Затронутые файлы:**
- `frontend/src/hooks/epub/useEpubNavigation.ts`
- `frontend/src/components/Reader/IOSDebugOverlay.tsx`

---

## Проблема

### Исходный баг
После исправления предыдущего бага с "10+ страниц за свайп" (см. `ios-navigation-bug-analysis-2026-01-14.md`), обнаружена новая проблема:

- **Симптом:** При свайпе пролистывается +1 "страница", но 1 страница ≠ 1 экрану
- **Поведение:** Обычно 1 страница epub.js = 2 экрана на мобильных устройствах
- **Результат:** При свайпе пропускается 1 экран с текстом

### Корневая причина

Предыдущая логика определения `scrollUnit` в `directScroll()` полагалась на значения epub.js:

```typescript
// СТАРАЯ ЛОГИКА (проблемная)
if (layout?.delta && layout.delta > 0 && layout.delta <= viewportWidth) {
  scrollUnit = layout.delta;
} else if (layout?.columnWidth ...) {
  scrollUnit = layout.columnWidth + gap;
} else {
  scrollUnit = viewportWidth;  // Fallback
}
```

**Проблема:** Условие `layout.delta <= viewportWidth` отбрасывает случаи, когда epub.js рассчитал `delta` как кратное viewport (например, `delta = 2 * viewportWidth`). При этом WebKit на iOS может физически рендерить контент иначе, чем ожидает JavaScript.

---

## Решение

### Подход: Измерение реальной ширины CSS колонки из DOM

Вместо полагания на значения epub.js (`layout.delta`), измеряем фактическую ширину CSS колонки напрямую из отрендеренного DOM.

### Новая функция `getMeasuredScrollUnit()`

Реализована функция с приоритетной цепочкой измерения:

| Приоритет | Метод | Описание |
|-----------|-------|----------|
| 1 | `CSS column-width` | `getComputedStyle(body).columnWidth` - самый точный метод |
| 2 | `First block width` | Ширина первого блочного элемента (`p`, `div`, etc.) |
| 3 | `Scroll ratio` | `scrollWidth / estimatedPages` - расчёт из соотношения |
| 4 | `layout.delta` | epub.js значение (fallback, если ≤ viewport) |
| 5 | `layout.columnWidth` | epub.js columnWidth + gap |
| 6 | `viewportWidth` | Финальный fallback |

### Код решения

```typescript
const getMeasuredScrollUnit = (
  rendition: Rendition,
  viewportWidth: number,
  scrollWidth: number,
  layout: EpubLayout | null
): MeasuredScrollUnit => {

  // Method 1: CSS computed column-width
  const cssColumnWidth = parseFloat(computed.columnWidth);
  if (cssColumnWidth > 0 && cssColumnWidth < viewportWidth) {
    return { unit: cssColumnWidth + cssColumnGap, source: 'css-column-width' };
  }

  // Method 2: First block element width
  const firstBlock = body.querySelector('p, div, section, article');
  const blockWidth = firstBlock?.getBoundingClientRect().width;
  if (blockWidth > 50 && blockWidth < viewportWidth * 0.95) {
    return { unit: blockWidth + gap, source: 'first-block-width' };
  }

  // Method 3: scrollWidth / estimated pages
  if (scrollWidth > viewportWidth * 1.1) {
    const estimatedPages = Math.round(scrollWidth / viewportWidth);
    return { unit: scrollWidth / estimatedPages, source: 'scroll-ratio' };
  }

  // Methods 4-6: Fallbacks...
};
```

---

## Изменения в коде

### `useEpubNavigation.ts`

1. **Добавлен интерфейс** `EpubLayout` для типизации
2. **Добавлен интерфейс** `MeasuredScrollUnit` с debug информацией
3. **Добавлена функция** `getMeasuredScrollUnit()` (120+ строк)
4. **Обновлена функция** `directScroll()`:
   - Заменена старая логика определения scrollUnit
   - Добавлен вызов `getMeasuredScrollUnit()`
   - Обновлено debug логирование с указанием источника измерения

### `IOSDebugOverlay.tsx`

1. **Добавлено поле** `measureSource` в интерфейс `DebugData`
2. **Обновлено отображение** - показывает источник измерения cyan цветом

---

## Debug информация

### Формат debug строки

```
S:0→375 U:375 [css-column-width] smooth
```

- `S:0→375` - scroll position: before → after
- `U:375` - scroll unit в пикселях
- `[css-column-width]` - источник измерения
- `smooth` - тип скролла

### iOS Debug Overlay

Debug overlay теперь показывает:
- `unit:375` - измеренный scroll unit
- `sw:1500` - scrollWidth
- `[css-column-width]` - источник измерения (cyan цвет)

---

## Преимущества решения

| Аспект | Старый подход | Новый подход |
|--------|---------------|--------------|
| **Источник данных** | epub.js layout values | Реальный DOM рендер |
| **Зависимость от платформы** | Высокая (iOS vs Android) | Низкая |
| **Устойчивость к багам epub.js** | Нет | Да |
| **Самовосстановление** | Нет | Да (пересчёт при resize) |
| **Debug возможности** | Базовые | Расширенные (источник измерения) |

---

## Тестирование

### Сценарии для проверки

1. **iOS Safari** - основной target
2. **iOS PWA** - standalone режим
3. **Android Chrome** - кросс-платформа
4. **Desktop Chrome** - регресс

### Ожидаемое поведение

- 1 свайп = 1 экран контента
- Debug overlay показывает `[css-column-width]` или `[first-block-width]`
- Плавная анимация скролла
- Корректный переход между главами

---

## Следующие шаги

1. **Тестирование на реальном iOS устройстве**
2. **Проверка всех методов измерения** через debug overlay
3. **Удаление IOSDebugOverlay** после подтверждения работоспособности
4. **Упрощение fixIOSLayout()** в `useEpubLoader.ts` (возможно, больше не нужна)

---

## Связанные файлы

- `docs/reports/ios-navigation-bug-analysis-2026-01-14.md` - анализ исходного бага
- `docs/reports/ios-navigation-fix-2026-01-13.md` - Phase 1-3 фиксы
- `docs/reports/swipe-navigation-implementation-2026-01-12.md` - реализация свайпов

---

## Коммит

```
fix(ios): measure actual CSS column width for mobile navigation

- Add getMeasuredScrollUnit() function with multi-method fallback chain
- Measure CSS column-width from DOM instead of relying on epub.js layout.delta
- Fix "1 page = 2 screens" bug on mobile devices
- Update debug overlay to show measurement source
- Priority: css-column-width → first-block-width → scroll-ratio → layout-delta → viewport
```
