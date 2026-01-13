# iOS EPUB Navigation Fix - Phase 1 Complete

**Date:** 2026-01-13
**Status:** Phase 1 Implemented
**Commit:** e3e840a

## Корневая причина бага

### Проблема
При свайпе на iOS происходил скачок на несколько страниц вместо одной.

### Найденная причина
Функция `directScroll()` использовала `viewportWidth` (stage.clientWidth) как единицу скролла. Однако на iOS Safari CSS columns могут рендерить несколько колонок внутри вьюпорта. При использовании `viewportWidth` происходил скип ВСЕХ колонок, что вызывало multi-page jump.

### Решение
Использовать `layout.delta` вместо `viewportWidth`. `layout.delta` - это правильная единица скролла, вычисленная epub.js для навигации на одну страницу.

## Внесённые изменения

### 1. useEpubNavigation.ts - Исправление directScroll

```typescript
// БЫЛО: scrollUnit = viewportWidth (неправильно на iOS)
// СТАЛО:
let scrollUnit: number;
if (layout?.delta && layout.delta > 0 && layout.delta <= viewportWidth) {
  scrollUnit = layout.delta;  // Правильная единица от epub.js
} else if (layout?.columnWidth && layout.columnWidth > 0) {
  scrollUnit = layout.columnWidth + (layout.gap || 0);  // Fallback
} else {
  scrollUnit = viewportWidth;  // Последний fallback
}

// Дополнительная защита для iOS
if (isIOS() && layout?.divisor && layout.divisor > 1) {
  scrollUnit = Math.floor(viewportWidth / layout.divisor);
}
```

### 2. useEpubLoader.ts - Усиление divisor fix

```typescript
const fixIOSLayout = (layout: any, source: string) => {
  layout.divisor = 1;
  layout._spread = 'none';
  layout.spreadWidth = 0;

  // КРИТИЧНО: Пересчитать delta и columnWidth
  if (width > 0) {
    layout.delta = width;        // Единица навигации
    layout.columnWidth = width;  // Ширина колонки
    layout.pageWidth = width;    // Ширина страницы
  }
};

// Перехватываем на всех этапах
newRendition.on('layout', (layout) => fixIOSLayout(layout, 'layout'));
newRendition.on('displayed', () => fixIOSLayout(..., 'displayed'));
newRendition.on('rendered', () => fixIOSLayout(..., 'rendered'));
```

### 3. useContentHooks.ts - CSS исправления

```css
/* БЫЛО: touch-action: pan-y !important; */
/* pan-y блокировал stage.scrollTo() */

/* СТАЛО: */
touch-action: manipulation !important;
/* manipulation позволяет JS управлять горизонтальным скроллом */
```

Также удалён код блокировки горизонтального свайпа, который мешал работе `stage.scrollTo()`.

### 4. types/epub.ts - Расширение типов

```typescript
layout?: {
  // ...existing
  delta?: number;  // Добавлено
  gap?: number;    // Добавлено
};
```

## Тестирование

- TypeScript проверка: ✅ Passed
- Production build: ✅ Passed (6.81s)
- Pushed to main: ✅ e3e840a

## Следующие шаги

1. **Тестирование на iOS устройстве**
   - Проверить навигацию свайпом
   - Проверить тап-навигацию
   - Проверить переходы между главами

2. **Если баг не исправлен - Фаза 2:**
   - Дополнительное логирование
   - Анализ реальных значений layout.delta
   - Альтернативный метод навигации

3. **Если баг не исправлен - Фаза 3:**
   - Реализация собственной навигации без epub.js
   - Миграция на альтернативную библиотеку

## Файлы изменений

| Файл | Изменения |
|------|-----------|
| `useEpubNavigation.ts` | directScroll использует layout.delta |
| `useEpubLoader.ts` | divisor fix пересчитывает delta |
| `useContentHooks.ts` | touch-action: manipulation |
| `types/epub.ts` | Добавлены delta и gap |

## Теория исправления

**Почему это должно работать:**

1. `layout.delta` вычисляется epub.js на основе реальной ширины колонки CSS
2. Даже если iOS рендерит несколько колонок, `layout.delta` будет равен ширине одной колонки
3. `touch-action: manipulation` позволяет нашему JS коду управлять скроллом
4. Комплексное исправление divisor на всех этапах гарантирует правильные значения

**Риски:**
- Если epub.js неправильно вычисляет delta на iOS - потребуется Фаза 2
- Если touch-action: manipulation вызывает другие проблемы - нужно будет корректировать
