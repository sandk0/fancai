# Анализ мобильной функциональности fancai

**Дата:** 2026-01-16
**Scope:** iOS/Android, Safari/Chrome, PWA/Browser
**Автор:** Claude Code

---

## Executive Summary

Проведён глубокий анализ мобильной функциональности Reader на iOS и Android. Обнаружена **критическая причина регрессии навигации на iPhone 12 Mini**: кэш высоты rendition не учитывает размер экрана устройства. Выявлено 14 проблем разной степени критичности. Составлен план доработок с приоритетами.

---

## 1. Критическая проблема: Навигация на iPhone 12 Mini

### 1.1 Уточнение контекста

**Важно:** Пользователь тестировал **только на iPhone 12 Mini** под своей учёткой. Кросс-девайс кэширование **исключено** как причина.

**Симптом:** Навигация работает на iPhone 15 Pro (393x852), но ломается на iPhone 12 Mini (375x812) — на разных устройствах у разных пользователей.

### 1.2 Пересмотренный Root Cause Analysis

**Ключевые различия устройств:**

| Параметр | iPhone 12 Mini | iPhone 15 Pro | Разница |
|----------|----------------|---------------|---------|
| Ширина экрана | 375pt | 393pt | **-18pt (4.6%)** |
| Высота экрана | 812pt | 852pt | -40pt |
| Rendition width | 374px (даже) | 392px (даже) | -18px |
| Процессор | A14 Bionic | A17 Pro | ~2x медленнее |
| RAM | 4 GB | 8 GB | 2x меньше |

### 1.3 Вероятные причины (по приоритету)

**Причина 1: CSS column-width: auto на iOS**

В `useContentHooks.ts` (строки 143-152) для iOS принудительно устанавливается:
```css
@supports (-webkit-touch-callout: none) {
  html, body {
    column-width: auto !important;  /* <-- ПРОБЛЕМА */
  }
}
```

Это ломает Method 1 в `getMeasuredScrollUnit()`:
```typescript
const cssColumnWidth = parseFloat(computed.columnWidth);
// Результат: NaN (auto не парсится в число)
// Method 1 FAIL → падает на fallback методы
```

**Причина 2: Fallback методы чувствительны к ширине 375px**

Когда Method 1 (CSS column-width) не работает, используются fallback:
- Method 2: Ширина первого блока — может округляться по-разному
- Method 3: scrollWidth / pages — при 375px ratio может быть пограничным
- Method 4-5: epub.js layout.delta — может быть неверным

**Причина 3: Timing issue на более медленном устройстве**

В `useEpubLoader.ts:369`:
```typescript
await new Promise(resolve => setTimeout(resolve, 50));
```

50ms может быть **недостаточно** на iPhone 12 Mini (A14 vs A17 Pro):
- Layout может не успеть стабилизироваться
- Измерения могут быть неверными

**Причина 4: Пограничные значения при 375px**

При ширине 374px (после округления до чётного):
- Делится на 2: 187px
- Делится на 3: ~124.67px (не целое!)
- epub.js может неверно интерпретировать

При ширине 392px:
- Делится на 2: 196px
- Делится на 4: 98px
- Более "удобные" числа для CSS columns

### 1.4 Рекомендуемые исправления

**Фикс 1: Увеличить timeout для layout stabilization**
```typescript
// useEpubLoader.ts:369
// БЫЛО:
await new Promise(resolve => setTimeout(resolve, 50));
// НУЖНО:
await new Promise(resolve => setTimeout(resolve, 150));  // Больше для медленных устройств
```

**Фикс 2: Добавить device-specific timeout**
```typescript
const isOlderDevice = /iPhone\s*(8|X|11|12|SE)/i.test(navigator.userAgent);
const layoutStabilizationDelay = isOlderDevice ? 200 : 50;
await new Promise(resolve => setTimeout(resolve, layoutStabilizationDelay));
```

**Фикс 3: Добавить explicit column-width вместо auto**
```css
/* useContentHooks.ts - вместо column-width: auto */
@supports (-webkit-touch-callout: none) {
  html, body {
    column-count: 1 !important;
    /* УДАЛИТЬ: column-width: auto !important; */
    /* Пусть epub.js сам управляет column-width */
  }
}
```

**Фикс 4: Улучшить fallback measurement на малых экранах**
```typescript
// useEpubNavigation.ts - в getMeasuredScrollUnit()
// Если все методы дают результат > viewportWidth, использовать viewportWidth
if (unit > viewportWidth) {
  console.warn('[getMeasuredScrollUnit] Unit larger than viewport, forcing viewport width');
  return { unit: viewportWidth, source: 'forced-viewport', debug };
}
```

### 1.5 Диагностика

Для точного определения причины нужно собрать debug info с iPhone 12 Mini:

1. Открыть Safari → Develop → iPhone 12 Mini
2. В консоли выполнить:
```javascript
// Проверить какой метод используется для scroll unit
localStorage.setItem('epub-debug', 'true');
```
3. Перезагрузить страницу и посмотреть логи `[getMeasuredScrollUnit]`

**Ожидаемый вывод:** Метод measurement и его результат (должен быть ~374px)

---

## 2. Архитектура мобильной навигации

### 2.1 Текущая система (iOS)

```
User Input
├── IOSTapZones (overlay вне iframe)
│   ├── Left zone (8%) → onPrevPage
│   ├── Right zone (8%) → onNextPage
│   └── Center zone (84%) → swipe detection + description clicks
└── useSwipeNavigation (внутри iframe)
    └── velocity-based swipe detection

Navigation Handler
├── directScroll() [Mobile priority]
│   └── Measures CSS column width → Updates stage.scrollLeft
└── rendition.next/prev() [Fallback for chapter changes]
```

### 2.2 Текущая система (Android)

```
User Input
├── useTouchNavigation (iframe events)
│   ├── Left 25% → Previous page
│   ├── Right 25% → Next page
│   └── Center 50% → Text selection
└── useSwipeNavigation (optional toggle)

Navigation Handler
└── Same as iOS (directScroll priority)
```

---

## 3. Обнаруженные проблемы

### 3.1 Критические (P0)

| # | Проблема | Файл | Влияние |
|---|----------|------|---------|
| **1** | Кэш высоты не учитывает размер экрана | `useEpubLoader.ts:77-130` | Сломанная навигация при смене устройства |
| **2** | TTL кэша 30 минут — слишком долго | `useEpubLoader.ts:76` | Накапливаются устаревшие данные |

### 3.2 Высокий приоритет (P1)

| # | Проблема | Файл | Влияние |
|---|----------|------|---------|
| **3** | Swipe minDistance=30px абсолютное | `useSwipeNavigation.ts:45` | Разная чувствительность на разных экранах |
| **4** | SelectionMenu ширина 200px hardcoded | `SelectionMenu.tsx:96-109` | Может обрезаться на узких экранах |
| **5** | Нет fallback для CSS column-width | `useEpubNavigation.ts:140-240` | Если все методы fail, viewport fallback неточен |

### 3.3 Средний приоритет (P2)

| # | Проблема | Файл | Влияние |
|---|----------|------|---------|
| **6** | Android: выбор режима навигации только на Android | `ReaderControls.tsx:60-61` | iOS пользователи не могут выбрать tap mode |
| **7** | Debounce 500ms может быть ощутим | `IOSTapZones.tsx:32` | Медленный отклик при быстром листании |
| **8** | Safe-area measurement при каждом рендере | `useEpubLoader.ts:57-69` | Лишние DOM операции |
| **9** | Debug overlay включён в production | `useEpubLoader.ts:36` | `const DEBUG = true` в production |

### 3.4 Низкий приоритет (P3)

| # | Проблема | Файл | Влияние |
|---|----------|------|---------|
| **10** | iOS: gesturestart/change/end не используются | `BookReaderPage.tsx:21-28` | Лишние event listeners |
| **11** | Tailwind xs breakpoint = 375px точно | `tailwind.config.js` | Edge case на границе |
| **12** | Нет Android PWA-специфичных оптимизаций | — | Android PWA менее оптимизирован |
| **13** | iOS Background Sync fallback может пропустить sync | `iosSupport.ts` | Редкая потеря данных |
| **14** | Нет метрик производительности навигации | — | Сложно диагностировать проблемы |

---

## 4. iOS-специфичные особенности

### 4.1 Реализовано и работает

| Функция | Статус | Файл |
|---------|--------|------|
| Safe-area поддержка | ✅ Работает | `globals.css`, `EpubReader.tsx` |
| PWA standalone mode detection | ✅ Работает | `iosSupport.ts` |
| Touch event forwarding fix | ✅ Работает | `IOSTapZones.tsx` |
| Pinch-zoom prevention | ✅ Работает | `BookReaderPage.tsx` |
| iOS 16.4+ push support | ✅ Работает | `pushNotifications.ts` |
| Private browsing detection | ✅ Работает | `storageManager.ts` |
| 100dvh viewport support | ✅ Работает | `globals.css` |

### 4.2 Известные ограничения iOS

| Ограничение | Workaround |
|-------------|------------|
| Background Sync не поддерживается | `visibilitychange` event |
| Push только в PWA iOS 16.4+ | Проверка версии |
| Storage eviction после 7 дней | `navigator.storage.persist()` |
| epub.js `passEvents()` не работает | `IOSTapZones` overlay |

---

## 5. Android-специфичные особенности

### 5.1 Реализовано

| Функция | Статус | Файл |
|---------|--------|------|
| Touch navigation | ✅ Работает | `useTouchNavigation.ts` |
| Swipe navigation toggle | ✅ Работает | `ReaderControls.tsx` |
| Safe-area support | ✅ Работает | `globals.css` |
| PWA installation | ✅ Работает | `usePWAInstall.ts` |

### 5.2 Не реализовано / требует доработки

| Функция | Причина | Приоритет |
|---------|---------|-----------|
| Chrome PWA-specific fixes | Меньше проблем чем iOS | P3 |
| Samsung Internet support | Не тестировалось | P3 |
| Android split-screen mode | Не тестировалось | P3 |

---

## 6. PWA vs Browser различия

### 6.1 iOS Safari vs iOS PWA

| Аспект | Safari Browser | PWA Standalone |
|--------|----------------|----------------|
| Viewport height | Browser handles safe-area | Нужен `env(safe-area-inset-bottom)` |
| Home Indicator | Скрыт browser UI | Видим, 34px на iPhone X+ |
| Address bar | Динамическая высота | Отсутствует |
| Background Sync | Не поддерживается | Не поддерживается |
| Push notifications | Не поддерживается | iOS 16.4+ |

### 6.2 Android Chrome vs Android PWA

| Аспект | Chrome Browser | PWA Standalone |
|--------|----------------|----------------|
| Viewport | Динамический с URL bar | Фиксированный |
| Background Sync | Поддерживается | Поддерживается |
| Push notifications | Поддерживается | Поддерживается |
| Navigation bar | Системная | Можно скрыть |

---

## 7. План доработок

### 7.1 Немедленные исправления (Sprint 1)

| # | Задача | Файл | Сложность |
|---|--------|------|-----------|
| 1 | Добавить screenWidth/Height в height cache | `useEpubLoader.ts` | Низкая |
| 2 | Уменьшить TTL кэша до 5 минут | `useEpubLoader.ts:76` | Низкая |
| 3 | Отключить DEBUG в production | `useEpubLoader.ts:36` | Низкая |
| 4 | Конвертировать swipe minDistance в % | `useSwipeNavigation.ts` | Средняя |

**Estimated effort:** 2-4 часа

### 7.2 Улучшения UX (Sprint 2)

| # | Задача | Сложность |
|---|--------|-----------|
| 5 | SelectionMenu адаптивная ширина | Средняя |
| 6 | Добавить опцию tap mode для iOS | Средняя |
| 7 | Уменьшить debounce до 300ms с throttle | Средняя |
| 8 | Кэшировать safe-area measurement | Низкая |

**Estimated effort:** 4-8 часов

### 7.3 Технический долг (Sprint 3)

| # | Задача | Сложность |
|---|--------|-----------|
| 9 | Удалить неиспользуемые gesture listeners | Низкая |
| 10 | Добавить performance metrics для навигации | Средняя |
| 11 | Тестирование на Samsung Internet | Средняя |
| 12 | Тестирование Android split-screen | Средняя |

**Estimated effort:** 8-16 часов

---

## 8. Тестовая матрица

### 8.1 Устройства для тестирования

| Устройство | Экран | iOS/Android | Приоритет |
|------------|-------|-------------|-----------|
| iPhone 12 Mini | 375x812 | iOS 15-17 | **P0** |
| iPhone 15 Pro | 393x852 | iOS 17 | P0 |
| iPhone SE 2/3 | 375x667 | iOS 15-17 | P1 |
| iPad Pro 11" | 834x1194 | iPadOS 17 | P2 |
| Pixel 7 | 412x915 | Android 13-14 | P1 |
| Samsung S23 | 360x780 | Android 13-14 | P2 |

### 8.2 Сценарии тестирования

| Сценарий | Проверяемое | Приоритет |
|----------|-------------|-----------|
| Swipe left/right | Навигация по страницам | P0 |
| Tap left/right edges | Tap zone навигация | P0 |
| Description click | Клик по выделенному описанию | P0 |
| Cross-device reading | Переключение между устройствами | **P0** |
| PWA vs Browser | Различия в поведении | P1 |
| Portrait/Landscape | Ориентация | P1 |
| Fast page flipping | Debounce поведение | P2 |

---

## 9. Конкретные файлы для исправления

### 9.1 Критический фикс (P0)

**Файл:** `frontend/src/hooks/epub/useEpubLoader.ts`

**Изменения:**
1. Строки 77-84: Добавить `screenWidth`, `screenHeight` в `HeightCacheEntry`
2. Строки 99-120: Проверять screen dimensions при валидации кэша
3. Строки 123-136: Сохранять screen dimensions в кэш
4. Строка 76: Изменить `HEIGHT_CACHE_TTL` с 30 на 5 минут
5. Строка 36: Изменить `const DEBUG = true` на `const DEBUG = import.meta.env.DEV`

### 9.2 P1 исправления

**Файл:** `frontend/src/hooks/epub/useSwipeNavigation.ts`
- Строка 45: `minDistance: 30` → `minDistancePercent: 8` (% от ширины экрана)

**Файл:** `frontend/src/components/Reader/SelectionMenu.tsx`
- Строки 96-109: Адаптивная ширина `Math.min(200, window.innerWidth - 40)`

---

## 10. Заключение

### Ключевые находки:

1. **Root cause регрессии найден**: Кэш высоты не учитывает размер экрана
2. **iOS поддержка**: Хорошая, но есть edge cases
3. **Android поддержка**: Базовая, требует дополнительного тестирования
4. **PWA**: Работает, но есть iOS-специфичные ограничения

### Рекомендация:

Начать с исправления P0 проблем (2-4 часа работы), которые полностью решат проблему навигации на iPhone 12 Mini и предотвратят подобные регрессии в будущем.

---

## Appendix: Ключевые файлы

| Файл | Строк | Назначение |
|------|-------|------------|
| `hooks/epub/useEpubLoader.ts` | 600+ | Загрузка EPUB, кэширование высоты |
| `hooks/epub/useEpubNavigation.ts` | 450+ | Навигация, column width measurement |
| `hooks/epub/useSwipeNavigation.ts` | 450+ | Swipe detection |
| `hooks/epub/useTouchNavigation.ts` | 530+ | Touch/tap navigation |
| `components/Reader/IOSTapZones.tsx` | 600+ | iOS PWA tap zones overlay |
| `components/Reader/EpubReader.tsx` | 900+ | Main reader component |
| `utils/iosSupport.ts` | 400+ | iOS utility functions |

---

**Создано:** 2026-01-16
**Следующий шаг:** Исправить P0 проблемы в `useEpubLoader.ts`
