# Исправление Safe-Area Bottom для мобильных устройств

**Дата:** 2026-01-14
**Статус:** Реализовано
**Тип:** Исправление UX
**Затронутые файлы:**
- `frontend/src/hooks/epub/useContentHooks.ts`
- `frontend/src/components/Reader/IOSDebugOverlay.tsx`

---

## Проблема

### Симптом
На мобильных устройствах (iOS, Android) последние 1-2 строки текста скрываются за навигационными элементами системы (Home Indicator на iPhone, навигационная панель на Android).

### Причина
EPUB контент рендерится внутри iframe, который создаёт epub.js. Хотя внешний контейнер (`#epub-viewer`) имел `paddingBottom: 'env(safe-area-inset-bottom)'`, CSS `env()` переменные **не передаются** внутрь blob: iframe на iOS.

```typescript
// EpubReader.tsx - внешний контейнер УЖЕ имел safe-area
style={{
  paddingBottom: 'env(safe-area-inset-bottom)',  // НЕ работает для iframe
}}
```

### Архитектура проблемы
```
┌─────────────────────────────────┐
│  EpubReader.tsx                 │
│  paddingBottom: env(safe-area)  │  <- Работает для контейнера
│  ┌───────────────────────────┐  │
│  │  epub.js iframe (blob:)   │  │
│  │  body { padding: 0.75em } │  │  <- НЕ учитывает safe-area
│  │  ┌─────────────────────┐  │  │
│  │  │  Текст книги...     │  │  │
│  │  │  ...                │  │  │
│  │  │  Последние строки   │  │  │  <- Скрыты за Home Indicator
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## Решение

### Подход
Измерять `env(safe-area-inset-bottom)` в родительском окне через JavaScript и передавать это значение как фиксированный пиксель в CSS внутри iframe.

### Реализация

#### 1. Функция измерения safe-area (`useContentHooks.ts`)
```typescript
const getSafeAreaInsetBottom = (): number => {
  if (typeof window === 'undefined') return 0;

  try {
    // Создаём временный элемент для измерения CSS env()
    const measureDiv = document.createElement('div');
    measureDiv.style.cssText =
      'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;';
    document.body.appendChild(measureDiv);
    const computed = window.getComputedStyle(measureDiv);
    const safeAreaBottom = parseFloat(computed.paddingBottom) || 0;
    document.body.removeChild(measureDiv);
    return safeAreaBottom;
  } catch {
    return 0;
  }
};
```

#### 2. Применение к body iframe
```typescript
const safeAreaBottom = getSafeAreaInsetBottom();

style.textContent = `
  body {
    margin: 0 !important;
    padding: 0.75em 0.75em calc(0.75em + ${safeAreaBottom}px) 0.75em !important;
    /* ... остальные стили ... */
  }
`;
```

---

## Архитектура после исправления

```
┌─────────────────────────────────┐
│  EpubReader.tsx                 │
│  paddingBottom: env(safe-area)  │
│  ┌───────────────────────────┐  │
│  │  epub.js iframe (blob:)   │  │
│  │  body {                   │  │
│  │    padding-bottom:        │  │
│  │    calc(0.75em + 34px)    │  │  <- safe-area из parent
│  │  }                        │  │
│  │  ┌─────────────────────┐  │  │
│  │  │  Текст книги...     │  │  │
│  │  │  ...                │  │  │
│  │  │  Последние строки   │  │  │
│  │  │  [пустое место]     │  │  │  <- 34px safe-area padding
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
          Home Indicator
```

---

## Изменения в коде

### `useContentHooks.ts`
1. **Добавлена функция** `getSafeAreaInsetBottom()` - измеряет safe-area-inset-bottom из родительского окна
2. **Обновлено** body padding - теперь включает safe-area-inset-bottom как фиксированное значение в пикселях

### `IOSDebugOverlay.tsx`
1. **Добавлено** отображение safe-area-inset-bottom (`SAB:Xpx`) в заголовке overlay
2. **Добавлена функция** `getSafeAreaBottom()` для измерения

---

## Debug информация

### Формат заголовка overlay
```
DEBUG | iOS:YES | SAB:34px | UA:Mozilla/5.0 (iPhone...
```

- `iOS:YES/NO` - обнаружено ли iOS устройство
- `SAB:34px` - измеренное значение safe-area-inset-bottom
- `UA:...` - начало User-Agent

### Типичные значения safe-area-inset-bottom
| Устройство | Значение |
|------------|----------|
| iPhone X/XS/11/12/13/14/15 | 34px |
| iPhone без Home Indicator | 0px |
| iPad | 20px |
| Android (зависит от устройства) | 0-48px |
| Desktop | 0px |

---

## Тестирование

### Сценарии
1. **iOS Safari** - проверить что последние строки видны
2. **iOS PWA** - standalone mode с Home Indicator
3. **Android Chrome** - с навигационной панелью
4. **Desktop** - регрессионный тест (safe-area = 0)

### Критерии успеха
- [ ] SAB в debug overlay показывает корректное значение (>0 на iOS)
- [ ] Последние строки текста видны полностью
- [ ] Нет обрезания контента внизу экрана
- [ ] На desktop поведение не изменилось

---

## Требования

### Prerequisite: viewport-fit=cover
Для работы `env(safe-area-inset-bottom)` требуется:
```html
<meta name="viewport" content="..., viewport-fit=cover" />
```

**Статус:** Уже реализовано в `frontend/index.html` (строка 5)

---

## Связанные документы

- `2026-01-14-mobile-navigation-scroll-unit-fix.md` - исправление scroll unit
- `2026-01-14-mobile-navigation-improvement-plan.md` - план доработок
- `ios-navigation-bug-analysis-2026-01-14.md` - анализ навигации

---

## Коммит

```
fix(ios): add safe-area-inset-bottom padding for mobile devices

- Add getSafeAreaInsetBottom() to measure safe-area from parent window
- Apply measured value as fixed pixel padding in epub iframe body
- Fix last 2 lines hidden behind iOS Home Indicator / Android nav bar
- Update debug overlay to show SAB value
- CSS env() variables don't cascade into blob: iframes, hence JS measurement
```
