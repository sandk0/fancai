# Исправление Safe-Area Bottom для мобильных устройств

**Дата:** 2026-01-14
**Статус:** Реализовано (v2)
**Тип:** Критическое исправление UX
**Затронутые файлы:**
- `frontend/src/hooks/epub/useEpubLoader.ts`
- `frontend/src/hooks/epub/useContentHooks.ts`
- `frontend/src/components/Reader/IOSDebugOverlay.tsx`

---

## Проблема

### Симптомы
На мобильных устройствах (iOS, Android) последние 1-2 строки текста скрываются:
- **PWA режим:** Текст скрыт за Home Indicator (34px на iPhone X+)
- **Safari браузер:** Текст скрыт за нижней панелью браузера (кнопки назад/вперёд, адресная строка)

### Первоначальный некорректный подход (v1)
Попытка добавить `padding-bottom` к `body` внутри epub iframe:
```css
body {
  padding: 0.75em 0.75em calc(0.75em + 34px) 0.75em !important;
}
```

**Почему не сработало:**
- epub.js использует CSS колонки для пагинации
- Высота колонок рассчитывается на основе `rendition.height`, а НЕ доступного пространства в body
- Body padding игнорируется при расчёте высоты колонок
- Контент переполняется за пределы видимой области

### Ключевое открытие
```
┌─────────────────────────────────┐
│  EpubReader.tsx                 │
│  paddingBottom: env(safe-area)  │  <- Не влияет на epub.js
│  ┌───────────────────────────┐  │
│  │  epub.js iframe           │  │
│  │  renditionHeight = 100%   │  │  <- Колонки рассчитаны на полную высоту!
│  │  body { padding: X }      │  │  <- Не влияет на высоту колонок
│  │  ┌─────────────────────┐  │  │
│  │  │  CSS Columns        │  │  │
│  │  │  height: 100%       │  │  │  <- Переполнение!
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### Дополнительная проблема: Safari браузер
- `env(safe-area-inset-bottom)` возвращает **0** в Safari браузере
- Причина: Панель браузера — это browser chrome, а не "safe area" в терминах CSS
- Нужен альтернативный подход для определения доступной высоты

---

## Решение (v2)

### Подход: Уменьшение высоты rendition

Вместо добавления padding к body, уменьшаем высоту, передаваемую в epub.js `renderTo()`:

```typescript
const newRendition = epubBook.renderTo(viewerRef.current, {
  width: renditionWidth,
  height: renditionHeight, // <- Уменьшенная высота!
  // ...
});
```

### Функция `getUsableViewportHeight()`

Новая функция для расчёта реально доступной высоты:

```typescript
const getUsableViewportHeight = (containerRect: DOMRect, headerHeight: number = 70): number => {
  const isStandalone = isStandaloneMode();
  const safeAreaBottom = measureSafeAreaBottom();
  const safeAreaTop = measureSafeAreaTop();
  const visualViewportHeight = window.innerHeight;

  // Измеряем 100svh (small viewport height) через CSS
  let svhHeight = measureSvhHeight();

  if (isStandalone) {
    // PWA: вычитаем header и safe-areas
    return visualViewportHeight - headerHeight - safeAreaTop - safeAreaBottom;
  } else {
    // Safari: innerHeight УЖЕ исключает toolbar
    // svh даёт ещё более точное значение
    const baseHeight = svhHeight > 0 ? svhHeight : visualViewportHeight;
    return baseHeight - headerHeight - safeAreaTop;
  }
};
```

### Логика определения высоты

| Режим | Источник высоты | Вычитаемые элементы |
|-------|----------------|---------------------|
| **PWA** | `window.innerHeight` | header (70px) + safeAreaTop + safeAreaBottom (34px) |
| **Safari** | `100svh` или `innerHeight` | header (70px) + safeAreaTop |

**Ключевое различие:**
- `window.innerHeight` в PWA = полный экран (включает Home Indicator)
- `window.innerHeight` в Safari = видимый viewport (уже исключает toolbar)
- `100svh` (small viewport height) = минимальная высота с видимым browser chrome

---

## Архитектура после исправления

```
┌─────────────────────────────────┐
│  EpubReader.tsx                 │
│  ┌───────────────────────────┐  │
│  │  epub.js iframe           │  │
│  │  renditionHeight =        │  │
│  │    innerH - header - SAB  │  │  <- Уменьшенная высота
│  │  ┌─────────────────────┐  │  │
│  │  │  CSS Columns        │  │  │
│  │  │  height: adjusted   │  │  │  <- Колонки вмещаются!
│  │  └─────────────────────┘  │  │
│  │  [свободное место]       │  │  <- Не используется
│  └───────────────────────────┘  │
│  [Safe Area / Home Indicator]   │
└─────────────────────────────────┘
```

---

## Debug информация

### Формат заголовка overlay
```
DEBUG | iOS:YES | PWA
SAB:34px | innerH:844 | svh:780 | diff:64
```

- `iOS:YES/NO` - обнаружено ли iOS устройство
- `PWA/Safari` - режим запуска
- `SAB:34px` - safe-area-inset-bottom
- `innerH:844` - window.innerHeight
- `svh:780` - 100svh (small viewport height)
- `diff:64` - разница (высота browser chrome)

### Типичные значения

| Устройство | Режим | SAB | innerH | svh | diff |
|------------|-------|-----|--------|-----|------|
| iPhone 15 | PWA | 34px | 844 | 844 | 0 |
| iPhone 15 | Safari | 0px | ~750 | ~780 | ~30 |
| iPhone SE | Safari | 0px | ~667 | ~667 | 0 |

---

## Изменения в коде

### `useEpubLoader.ts`
1. **Добавлена функция** `isStandaloneMode()` - определяет PWA vs браузер
2. **Добавлена функция** `measureSafeAreaBottom()` - измеряет safe-area
3. **Добавлена функция** `getUsableViewportHeight()` - рассчитывает доступную высоту
4. **Обновлено** создание rendition - использует уменьшенную высоту

### `useContentHooks.ts`
1. **Удалено** измерение и применение safe-area к body padding
2. **Обновлен комментарий** - указывает что safe-area обрабатывается в useEpubLoader

### `IOSDebugOverlay.tsx`
1. **Добавлена функция** `isStandaloneMode()` - определяет режим запуска
2. **Добавлена функция** `getViewportInfo()` - измеряет viewport параметры
3. **Обновлен заголовок** - показывает режим (PWA/Safari) и viewport info

---

## Тестирование

### Сценарии
1. **iOS Safari** - проверить innerH vs svh разницу
2. **iOS PWA** - проверить SAB вычитание
3. **Android Chrome** - проверить работу без safe-area
4. **Desktop** - регрессионный тест

### Критерии успеха
- [ ] Последние строки текста видны полностью
- [ ] В debug overlay корректные значения режима и viewport
- [ ] Нет пропуска контента при свайпе
- [ ] На desktop поведение не изменилось

---

## Связанные ресурсы

### Документация
- [Handling iOS Safari toolbar for full height web content](https://www.sabhya.dev/handling-ios-safari-toolbar-for-full-height-web-content)
- [Fixing iOS Safari's Menu Bar Overlap with CSS Viewport Units](https://opus.ing/posts/fixing-ios-safaris-menu-bar-overlap-css-viewport-units)
- [CSS env() - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [Safe Areas with CSS Environmental Variables - Frontend Masters](https://frontendmasters.com/courses/pwas-v2/safe-areas-with-css-environmental-variables/)

### Связанные отчёты
- `2026-01-14-mobile-navigation-scroll-unit-fix.md` - исправление scroll unit
- `2026-01-14-mobile-navigation-improvement-plan.md` - план доработок
- `ios-navigation-bug-analysis-2026-01-14.md` - анализ навигации

---

## Коммит

```
fix(ios): reduce rendition height for safe-area and Safari toolbar

- Add getUsableViewportHeight() to calculate actual usable viewport
- PWA mode: subtract safe-area-inset-bottom from rendition height
- Safari browser: use svh/innerHeight (already excludes toolbar)
- Remove body padding approach (doesn't affect epub.js columns)
- Update debug overlay to show PWA/Safari mode and viewport info
- env(safe-area-inset-bottom) is 0 in Safari browser (by design)
```
