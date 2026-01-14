# Исправление вертикального скролла iOS и отключение системного zoom

**Дата:** 2026-01-14
**Статус:** ✅ Реализовано
**Тип:** UX улучшения для мобильных устройств

---

## Проблема 1: Вертикальный скролл в iOS Safari

### Симптомы
- В Safari браузере на iOS появляется нежелательный вертикальный скролл
- "Резиновый" bounce-эффект при достижении границ прокрутки
- Страница "дёргается" при прокрутке

### Анализ текущего состояния

**globals.css** — частичные решения:
```css
/* Есть для iframe и модальных окон */
.modal-scrollable {
  overscroll-behavior: contain;
}

#viewer iframe body {
  overscroll-behavior: contain !important;
}
```

**Проблема:** `overscroll-behavior` применяется только к отдельным элементам, но НЕ к html/body глобально.

### Корневая причина

Safari поддерживает `overscroll-behavior` начиная с Safari 16 (сентябрь 2022). Однако для полного отключения bounce-эффекта необходимо:

1. Применить `overscroll-behavior: none` к html и body
2. Правильно настроить `overflow` на корневых элементах
3. Для reader-страницы: фиксировать высоту viewport

### ✅ Решение

**Подход 1: CSS overscroll-behavior (рекомендуется)**

```css
/* Глобально отключить bounce для iOS Safari */
html, body {
  overscroll-behavior: none;
  overscroll-behavior-y: none;
}

/* Для reader-страницы: фиксированная высота */
.reader-container {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
```

**Подход 2: Фиксация body (fallback)**

```css
/* Альтернатива для старых Safari */
html {
  overflow: hidden;
  height: 100%;
}

body {
  overflow: auto;
  height: 100%;
  position: relative;
}
```

### Источники
- [MDN: overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior)
- [Bram.us: Prevent overscroll bounce](https://www.bram.us/2016/05/02/prevent-overscroll-bounce-in-ios-mobilesafari-pure-css/)
- [Chrome Blog: Overscroll behavior](https://developer.chrome.com/blog/overscroll-behavior)

---

## Проблема 2: Системное масштабирование (pinch-to-zoom)

### Симптомы
- Пользователи случайно увеличивают страницу жестом pinch
- После zoom верстка текста "ломается"
- Сложно вернуться к исходному масштабу

### Анализ текущего состояния

**index.html** — текущий viewport:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**Проблема:** Отсутствуют `maximum-scale` и `user-scalable` для ограничения zoom.

**globals.css** — частичные решения:
```css
/* Есть для кнопок и ссылок */
button, a, [role="button"] {
  touch-action: manipulation;
}

/* Есть для input (предотвращение auto-zoom) */
@media screen and (max-width: 768px) {
  input, select, textarea {
    font-size: max(16px, 1rem) !important;
  }
}
```

### Корневая причина

1. **iOS игнорирует `user-scalable=no`** начиная с iOS 10 (accessibility reasons)
2. **`maximum-scale=1.0`** тоже часто игнорируется браузерами
3. Единственный надёжный способ — CSS `touch-action`

### ✅ Решение

**Подход 1: CSS touch-action (рекомендуется)**

```css
/* Отключить pinch-zoom глобально */
html {
  touch-action: pan-x pan-y;
  /* или более строго для reader: */
  touch-action: manipulation;
}
```

Значения `touch-action`:
- `manipulation` — разрешает pan + tap, запрещает pinch-zoom и double-tap-zoom
- `pan-x pan-y` — разрешает только pan в обоих направлениях
- `none` — полностью блокирует touch (НЕ рекомендуется)

**Подход 2: Viewport meta (для совместимости)**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

⚠️ **Внимание:** Это нарушает WCAG accessibility guidelines и игнорируется iOS Safari.

**Подход 3: JavaScript fallback**

```javascript
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
```

⚠️ Работает только для Safari-specific gesture events.

### Рекомендуемый подход

**Комбинированное решение:**
1. `touch-action: manipulation` на html для reader-страницы
2. `maximum-scale=5.0` в viewport (для accessibility compliance)
3. Input font-size >= 16px (уже реализовано)

### Источники
- [MDN: Viewport meta tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag)
- [Luke Plant: user-scalable=no](https://lukeplant.me.uk/blog/posts/you-can-stop-using-user-scalable-no-and-maximum-scale-1-in-viewport-meta-tags-now/)
- [W3Docs: Disable zoom](https://www.w3docs.com/snippets/css/how-to-disable-zoom-on-a-mobile-web-page-using-html-and-css.html)
- [Hall of Fame Wall: Disable pinch zoom](https://halloffamewall.com/blog/disable-pinch-zoom-css-html-js-kiosk/)

---

## План реализации

### Этап 1: CSS изменения (globals.css)

```css
/* ========================================
   iOS Safari Scroll & Zoom Fixes (January 2026)
   ======================================== */

/* Отключить rubber-band bounce на iOS Safari */
html, body {
  overscroll-behavior: none;
  overscroll-behavior-y: none;
}

/* Отключить pinch-zoom на мобильных устройствах */
/* manipulation = pan + tap, без pinch-zoom и double-tap-zoom */
@media (pointer: coarse) {
  html {
    touch-action: manipulation;
  }
}

/* Reader-specific: полная блокировка скролла и zoom */
.reader-fullscreen-lock {
  position: fixed;
  inset: 0;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: manipulation;
}
```

### Этап 2: HTML изменения (index.html)

```html
<!-- Обновлённый viewport с ограничением масштабирования -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
```

⚠️ Или для accessibility compliance:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

### Этап 3: Reader component (BookReaderPage.tsx)

Добавить класс `reader-fullscreen-lock` к контейнеру reader:

```tsx
<div className="fixed inset-0 overflow-hidden bg-background reader-container reader-fullscreen-lock">
```

### Этап 4: JavaScript fallback (опционально)

Для Safari-specific gesture prevention в EpubReader:

```typescript
useEffect(() => {
  const preventGesture = (e: Event) => e.preventDefault();

  document.addEventListener('gesturestart', preventGesture);
  document.addEventListener('gesturechange', preventGesture);
  document.addEventListener('gestureend', preventGesture);

  return () => {
    document.removeEventListener('gesturestart', preventGesture);
    document.removeEventListener('gesturechange', preventGesture);
    document.removeEventListener('gestureend', preventGesture);
  };
}, []);
```

---

## Изменяемые файлы

| Файл | Изменения |
|------|-----------|
| `frontend/src/styles/globals.css` | Добавить overscroll-behavior и touch-action |
| `frontend/index.html` | Обновить viewport meta tag |
| `frontend/src/pages/BookReaderPage.tsx` | Добавить класс для reader lock |

---

## Тестирование

### Чек-лист

| Платформа | Вертикальный скролл | Pinch zoom |
|-----------|---------------------|------------|
| iOS Safari browser | ✅ Исправлено | ✅ Исправлено |
| iOS PWA | ✅ Исправлено | ✅ Исправлено |
| Android Chrome browser | ✅ Работает | ✅ Работает |
| Android PWA | ✅ Работает | ✅ Работает |

**Результат тестирования (2026-01-15):** Пользователь подтвердил работоспособность исправлений.

### Сценарии тестирования

1. **Вертикальный скролл:**
   - Открыть reader
   - Попытаться прокрутить вертикально за границы
   - Bounce-эффект НЕ должен появляться

2. **Pinch zoom:**
   - Открыть reader
   - Попытаться увеличить двумя пальцами
   - Zoom НЕ должен срабатывать

3. **Pan navigation:**
   - Проверить что горизонтальный swipe работает
   - Проверить что вертикальная прокрутка текста работает

---

## Accessibility примечания

⚠️ Отключение zoom может нарушать WCAG 2.1 Success Criterion 1.4.4:
> "Except for captions and images of text, text can be resized without assistive technology up to 200 percent"

**Компромисс:**
- Для reader: отключить zoom (есть встроенное управление размером шрифта)
- Для остальных страниц: разрешить zoom (accessibility)

---

---

## Реализованные изменения

### 1. globals.css — CSS классы для reader

```css
/* Reader Scroll & Zoom Lock */
.reader-scroll-lock {
  overscroll-behavior: none;
  overscroll-behavior-y: none;
  touch-action: manipulation;
  overflow: hidden;
  position: fixed;
  inset: 0;
}

body.reader-active {
  overflow: hidden;
  position: fixed;
  width: 100%;
  height: 100%;
  overscroll-behavior: none;
}
```

### 2. BookReaderPage.tsx — хук useReaderBodyLock

```typescript
const useReaderBodyLock = () => {
  useEffect(() => {
    document.body.classList.add('reader-active');

    // Safari-specific gesture events prevention
    const preventGesture = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      document.body.classList.remove('reader-active');
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
    };
  }, []);
};
```

### 3. touch-action: pan-x pan-y (везде в reader)

**ВАЖНО:** `manipulation` = `pan-x pan-y pinch-zoom` — он РАЗРЕШАЕТ zoom!

```typescript
// БЫЛО:
touchAction: effectiveNavigationMode === 'swipe' ? 'pan-y pinch-zoom' : 'auto',
// или
touchAction: 'manipulation', // ← НЕПРАВИЛЬНО, разрешает zoom!

// СТАЛО:
touchAction: 'pan-x pan-y',
// Разрешает pan для JS-обработчиков, явно ИСКЛЮЧАЕТ pinch-zoom
```

**Изменённые файлы:**
- `EpubReader.tsx` — viewer div
- `IOSTapZones.tsx` — overlay zones
- `useContentHooks.ts` — iframe content (body, iOS-specific, description-highlight)

---

## История изменений

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2026-01-14 | 1.0 | Первоначальный анализ и план |
| 2026-01-14 | 2.0 | Реализация: CSS классы, хук useReaderBodyLock |
| 2026-01-14 | 2.1 | Исправление: `pan-x pan-y` вместо `manipulation` (manipulation разрешает zoom!) |
| 2026-01-15 | 3.0 | Деплой на fancai.ru, тестирование подтверждено пользователем |

---

## Деплой

**Коммит:** `f28762a fix(reader): disable iOS vertical scroll bounce and pinch-zoom`

**Сервер:** fancai.ru (77.246.106.109)

**Дата деплоя:** 2026-01-15

**Статус:** ✅ Успешно задеплоено и протестировано
