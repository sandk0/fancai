# Исправление регрессий после safe-area fix на iOS

**Дата:** 2026-01-14
**Статус:** Реализовано
**Тип:** Критические исправления
**Затронутые файлы:**
- `frontend/src/components/Reader/IOSTapZones.tsx`
- `frontend/src/hooks/epub/useEpubLoader.ts`
- `frontend/src/components/Reader/IOSDebugOverlay.tsx`

---

## Обзор

После внедрения исправления safe-area-inset-bottom (уменьшение renditionHeight) обнаружены две регрессии:

1. **Клик по описанию не работает на iOS** (PWA + Safari)
2. **Прогресс чтения сбивается на 1-2 страницы** при перезагрузке

---

## Проблема 1: Клик по описанию не работает

### Симптомы
- На iOS (PWA и Safari browser) клик по выделенному описанию не открывает модальное окно с изображением
- Debug overlay показывает координаты, но описание не находится

### Корневая причина

В `IOSTapZones.tsx` координаты тапа вычислялись относительно **viewer container**, а не iframe:

```typescript
// БЫЛО (неверно):
const viewerRect = viewer.getBoundingClientRect();
const viewportX = touch.clientX - viewerRect.left;
const viewportY = touch.clientY - viewerRect.top;
```

После safe-area fix:
- Viewer container: полная высота (700px)
- Iframe внутри: уменьшенная высота (650px, минус safe-area)

Координаты, вычисленные относительно viewer, не соответствовали coordinate system iframe, и `elementFromPoint()` внутри iframe не находил элементы.

### Исправление

Вычисление координат относительно **iframe** вместо viewer:

```typescript
// СТАЛО (правильно):
const iframeRect = iframe.getBoundingClientRect();
const viewportX = touch.clientX - iframeRect.left;
const viewportY = touch.clientY - iframeRect.top;
```

---

## Проблема 2: Прогресс сбивается на 1-2 страницы

### Симптомы
- При перезагрузке страницы позиция чтения сдвигается на 1-2 страницы
- Баг воспроизводится даже при ожидании сохранения прогресса
- Также воспроизводится при сворачивании/разворачивании браузера

### Корневая причина

`getUsableViewportHeight()` могла возвращать разные значения при каждой загрузке из-за:

1. **Состояние адресной строки Safari** - скрыта/видна влияет на `window.innerHeight`
2. **Время измерения** - измерение до стабилизации layout дает некорректные значения
3. **Анимации браузера** - address bar animation может влиять на измерения

При разной высоте rendition:
- Границы страниц смещаются
- Тот же CFI отображается на другой визуальной позиции
- Пользователь видит сдвиг на 1-2 страницы

### Исправление

1. **Кэширование высоты** - сохранение измеренной высоты в `localStorage` для консистентности:

```typescript
const HEIGHT_CACHE_KEY = 'epub-rendition-height-cache';
const HEIGHT_CACHE_TTL = 30 * 60 * 1000; // 30 минут

// При первом измерении - сохраняем
cacheHeight(finalHeight);

// При последующих загрузках - используем кэш
const cachedHeight = getCachedHeight();
if (cachedHeight !== null) {
  return cachedHeight;
}
```

2. **Задержка перед измерением** - 50ms для стабилизации layout:

```typescript
// Ждем стабилизации layout перед измерением
await new Promise(resolve => setTimeout(resolve, 50));
const containerRect = viewerRef.current.getBoundingClientRect();
```

3. **Учет ориентации** - кэш per-orientation:

```typescript
interface HeightCacheEntry {
  height: number;
  orientation: 'portrait' | 'landscape';
  timestamp: number;
}
```

---

## Изменения в Debug Overlay

Добавлено отображение закэшированной высоты:

```
SAB:34px | innerH:844 | svh:780 | diff:64 | H:650(cached)
```

- `H:650(cached)` - показывает, что используется закэшированная высота

---

## Тестирование

### Сценарии для проверки

1. **Клик по описанию (iOS PWA)**
   - [ ] Открыть книгу с подсвеченными описаниями
   - [ ] Кликнуть по описанию
   - [ ] Должно открыться модальное окно с изображением

2. **Клик по описанию (iOS Safari)**
   - [ ] То же самое в Safari browser

3. **Прогресс при перезагрузке**
   - [ ] Прочитать до определенной позиции
   - [ ] Дождаться сохранения (индикатор)
   - [ ] Перезагрузить страницу
   - [ ] Позиция должна быть точно такой же

4. **Прогресс при сворачивании**
   - [ ] Прочитать до позиции
   - [ ] Свернуть браузер/PWA
   - [ ] Развернуть обратно
   - [ ] Позиция не должна измениться

### Критерии успеха

- Debug overlay показывает `H:XXX(cached)` при повторных загрузках
- Клики по описаниям работают на iOS
- Позиция не сдвигается при перезагрузке

---

## Связанные документы

- `2026-01-14-safe-area-bottom-fix.md` - исходное исправление safe-area
- `2026-01-14-mobile-navigation-scroll-unit-fix.md` - исправление scroll unit
- `2026-01-14-mobile-navigation-improvement-plan.md` - план доработок

---

## Коммит

```
fix(ios): fix description click and progress restore after safe-area fix

- Fix description click: use iframe rect instead of viewer rect for coordinates
- Fix progress restore: cache rendition height to prevent page boundary shifts
- Add 50ms delay before measuring to let browser layout stabilize
- Cache height per orientation with 30-minute TTL
- Update debug overlay to show cached height status
```
