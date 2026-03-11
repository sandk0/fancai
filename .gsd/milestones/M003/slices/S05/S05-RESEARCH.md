# Phase 19.1: UAT-фиксы: выделение, прозрачность, edge taps, задержка заметок — Исследование

**Исследовано:** 2026-03-12
**Область:** Мобильный UX ридера — touch events, CSS-переменные, annotation rendering, gesture controller
**Уверенность:** HIGH

## Краткое резюме

Фаза 19.1 исправляет 5 конкретных UAT-багов, обнаруженных при ручном тестировании на Pixel 9. Все 5 багов имеют чётко локализованные корневые причины в конкретных файлах, что позволяет точечные исправления без рефакторинга.

**BUG-1** (выделение при тапе) вызвано конфликтом: `useEpubRendition.ts:236` устанавливает `touch-action: manipulation` на iframe body (что включает текстовое выделение), а `useEpubRendition.ts:238` явно ставит `user-select: text`. При этом `useContentHooks.ts` инжектирует `body { touch-action: pan-x pan-y }`, но inline-стиль из `useEpubRendition` имеет приоритет. Результат: на мобильных любой тап размещает каретку, а epub.js может отправлять `selected` event при любом selection change.

**BUG-2/3** (прозрачные drawer/sheet) — CSS-переменная `--color-bg-elevated` определена как полупрозрачная (`rgba(0,0,0,0.03)` для light, `rgba(255,255,255,0.05)` для dark). Это дизайн-токен для "приподнятых" поверхностей поверх основного фона, но для standalone drawer-ов нужен непрозрачный фон.

**BUG-4** (предыдущая заметка) — race condition: оптимистичное обновление TanStack Query cache (`useSync.ts:114`) добавляет запись с id `optimistic-${Date.now()}`, но `onSettled` (строка 137) вызывает `invalidateQueries`, что триггерит рефетч. Между рефетчем и применением аннотаций проходит 200ms debounce (`useAnnotationRendering.ts:433`). Кроме того, `useCallback` для `applyAnnotations` зависит от `bookmarks` — при оптимистичном обновлении создаётся новый массив, но debounce timer от предыдущего вызова может ещё работать, и `clearTimeout` + `setTimeout` создают окно, в котором применяются данные из предыдущего closure.

**BUG-5** (edge taps) — `getInteractiveType(e.target)` использует `e.target` из touchend event. По спецификации Touch Events, target touchend = target touchstart, что не всегда совпадает с визуальным элементом под пальцем. Кроме того, description-highlight span может быть узким (~20px шириной текста), и палец легко попадает на соседний текстовый узел. Решение в Phase 19 (`handleCenterTap` с `elementFromPoint`) работает только в center zone (строки 543-551), но не в edge zones (строки 528-535 проверяют `e.target` напрямую).

**Основная рекомендация:** Все 5 багов исправляются точечными изменениями в 5-6 файлах. Один план может покрыть все фиксы, так как они небольшие и независимые.

<user_constraints>
## Ограничения пользователя (из CONTEXT.md)

### Решения (заблокировано)
- BUG-1: Выделение текста должно активироваться ТОЛЬКО через long-press (~500ms), простой тап НЕ должен выделять текст
- BUG-2: EntityBottomSheet должен иметь полностью непрозрачный фон
- BUG-3: DescriptionDrawer должен иметь полностью непрозрачный фон
- BUG-4: Каждая созданная заметка должна СРАЗУ отображаться визуально
- BUG-5: Тап на интерактивный элемент ВСЕГДА открывает popup, независимо от позиции на экране
- Ключевые файлы и строки чётко определены в CONTEXT.md

### На усмотрение Claude
- Выбор механизма блокировки tap-selection (CSS vs JS)
- Выбор непрозрачного CSS-токена для drawer-ов (`bg-background`, `bg-card` или другой)
- Стратегия исправления annotation race condition (optimistic update vs убрать debounce vs увеличить hit area)
- Способ расширения hit area для edge entities (CSS padding vs elementFromPoint с radius поиска)

### Отложенные задачи (ВНЕ SCOPE)
- Полный рефакторинг gesture controller (>1000 строк)
- iOS-специфичные edge cases (тестирование только на Android/Pixel 9)
- Performance-оптимизация annotation rendering для книг с 100+ заметками
</user_constraints>

## Стандартный стек

### Используемые библиотеки (уже в проекте)
| Библиотека | Версия | Назначение | Релевантность к фазе |
|-----------|--------|-----------|---------------------|
| epub.js | 0.3.93 | EPUB рендеринг | `selected` event, `getRange()`, iframe DOM |
| vaul | (текущая) | Bottom sheets | EntityBottomSheet, DescriptionDrawer |
| TanStack Query | 5.90.12 | Серверный стейт | Оптимистичные обновления bookmarks |
| Tailwind CSS | 4.1.18 | Стили | CSS-переменные, bg-классы |

### Дополнительные зависимости
Не требуются. Все исправления используют существующий стек.

## Архитектурные паттерны

### Паттерн 1: CSS-приоритеты в epub.js iframe

Iframe body получает стили из трёх источников (в порядке приоритета):
1. **Inline-стили** (`useEpubRendition.ts:236-239`) — `touch-action: manipulation`, `user-select: text` — **ВЫСШИЙ приоритет**
2. **Injected `<style>`** (`useContentHooks.ts:34-176`) — body { touch-action: pan-x pan-y } — перебивается inline
3. **CSS классы** (`body.selection-blocked *`) — работает через `!important`

**Критически важно:** Inline-стиль `touch-action: manipulation` из useEpubRendition перебивает CSS из useContentHooks (`touch-action: pan-x pan-y`). Значение `manipulation` эквивалентно `pan-x pan-y pinch-zoom` — оно не контролирует text selection, но вместе с `user-select: text` создаёт условия для мгновенного выделения при тапе.

### Паттерн 2: Touch Event target

```
touchstart target = элемент под пальцем при начале касания
touchend target   = ВСЕГДА = touchstart target (по W3C spec)
```

В gesture controller `e.target` в `handleTouchEnd` — это элемент, определённый при touchstart. Если палец слегка сдвинулся или CSS layout изменился, визуальный элемент под пальцем может не совпадать с `e.target`.

**Решение:** Использовать `document.elementFromPoint(x, y)` вместо `e.target` для определения интерактивного элемента. Это уже реализовано для center zone в `handleCenterTap`, но НЕ для edge zones.

### Паттерн 3: TanStack Query оптимистичные обновления + debounced consumers

Текущий pipeline:
```
1. createBookmark.mutate()
2. onMutate → cancelQueries + setQueryData (оптимистичная запись с id: optimistic-*)
3. Компонент useBookmarks получает обновлённый массив
4. useAnnotationRendering: applyAnnotations useCallback пересоздаётся
5. debouncedApply: clearTimeout старого + setTimeout(200ms) нового
6. Через 200ms: applyAnnotations() читает bookmarks из closure
7. onSettled → invalidateQueries → рефетч с сервера
8. Новые данные приходят → goto 4 (ещё один цикл apply с debounce 200ms)
```

Проблема: между шагами 5 и 6 приходит рефетч (шаг 7), который создаёт НОВЫЙ debouncedApply, но предыдущий timeout уже в очереди. В результате может сработать старый timeout с закрытым closure (без новой заметки).

### Анти-паттерны
- **Inline-стили для toggle-поведения:** `useEpubRendition.ts` ставит inline `touch-action: manipulation`, который невозможно переопределить из CSS без `!important`. Лучше использовать CSS-классы.
- **Debounce для реактивных обновлений:** 200ms debounce маскирует race condition вместо решения. Если данные уже в кэше (оптимистичное обновление), apply должен происходить немедленно.

## Не реализовывать вручную

| Проблема | Не делать | Использовать | Почему |
|---------|----------|-------------|--------|
| Определение тапа на элементе | Touch target comparison | `elementFromPoint(x, y)` | Стабильно работает вне зависимости от touch target shifting |
| Фон для модалов | Кастомные rgba значения | Дизайн-токены Tailwind (`bg-background`, `bg-card`) | Автоматически адаптируются ко всем темам |
| Блокировка выделения при тапе | JS preventDefault на selection events | CSS `user-select: none` + класс toggle | Надёжнее, не ломает long-press |

## Частые ошибки

### Ошибка 1: touch-action: manipulation включает pinch-zoom
**Что идёт не так:** `manipulation` = `pan-x pan-y pinch-zoom`. Это может вызвать нежелательный zoom на iOS.
**Почему:** Код в useContentHooks.ts специально комментирует: "Note: manipulation = pan-x pan-y pinch-zoom, which ALLOWS zoom!"
**Как избежать:** Использовать `pan-x pan-y` вместо `manipulation` в inline-стилях useEpubRendition.
**Признаки:** Нежелательный zoom при double-tap.

### Ошибка 2: user-select: text разрешает caret placement при тапе
**Что идёт не так:** На мобильных `user-select: text` + тап = размещение каретки. Браузер создаёт collapsed selection, epub.js может отправить `selected` event.
**Почему:** `user-select: text` — дефолтное значение, которое разрешает любое взаимодействие с текстом (caret placement, selection, copy).
**Как избежать:** Не ставить `user-select: text` через inline-стиль. Вместо этого положиться на CSS из useContentHooks, где selection разрешена по умолчанию (browser default), а блокировка делается через класс `selection-blocked`.
**Признаки:** Синяя каретка появляется при обычном тапе на текст.

### Ошибка 3: Debounce маскирует stale closure
**Что идёт не так:** `useCallback` создаёт closure с определённым значением `bookmarks`. Debounce откладывает вызов на 200ms. За это время `bookmarks` может обновиться, но старый timeout вызовет функцию со старым closure.
**Почему:** `clearTimeout + setTimeout` — это не `useEffect` cleanup, новый debounce timer не отменяет старый, если debouncedApply пересоздался.
**Как избежать:** Использовать ref для bookmarks или убрать debounce для оптимистичных обновлений.
**Признаки:** Визуальное обновление аннотаций показывает ПРЕДЫДУЩЕЕ состояние.

### Ошибка 4: CSS-переменная с opacity в standalone компоненте
**Что идёт не так:** `--color-bg-elevated: rgba(0,0,0,0.03)` задумана для "приподнятой" поверхности поверх существующего фона. Но в standalone drawer/sheet без видимого фона позади — контент становится прозрачным.
**Как избежать:** Для standalone модальных компонентов использовать непрозрачные токены: `--color-bg-base`, `--color-bg-subtle`, `--color-bg-muted`.

## Конкретные исправления (код)

### BUG-1: Убрать inline touch-action и user-select

**Файл:** `frontend/src/hooks/epub/useEpubRendition.ts:236-239`

Текущий код:
```typescript
iframe.contentDocument.body.style.touchAction = 'manipulation';
iframe.contentDocument.body.style.overscrollBehaviorX = 'none';
iframe.contentDocument.body.style.userSelect = 'text';
iframe.contentDocument.body.style.webkitUserSelect = 'text';
```

Исправление: Убрать `touchAction = 'manipulation'` (использовать `pan-x pan-y` из CSS useContentHooks) и убрать `userSelect = 'text'` (browser default, не нужен inline):
```typescript
// touch-action и user-select управляются CSS из useContentHooks
iframe.contentDocument.body.style.overscrollBehaviorX = 'none';
```

Дополнительно: Убедиться, что `useTextSelection.ts` фильтрует collapsed selections (пустой текст). Текущий код уже проверяет `selectedText.trim()` (строка 61), но epub.js может отправлять event ДО полного формирования selection. Нужно также проверить, что `selected` event не срабатывает при простом тапе — возможно, добавить минимальную длину текста (>0 символов) как дополнительный guard.

### BUG-2/3: Непрозрачный фон для drawer-ов

**Рекомендация:** Заменить `bg-[var(--color-bg-elevated)]` на `bg-[var(--color-bg-base)]` (solid, theme-adaptive).

| Токен | Light | Dark | Sepia | Outdoor |
|-------|-------|------|-------|---------|
| `--color-bg-base` | `#ffffff` | `#121212` | `#fbf0d9` | `#fffef5` |
| `--color-bg-subtle` | `#f9fafb` | `#1a1a1a` | `#f7ebcf` | `#fffdf0` |
| `--color-bg-elevated` | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.03)` | `rgba(0,0,0,0.04)` |

`bg-[var(--color-bg-base)]` — основной фон, полностью непрозрачный во всех темах. Идеально для standalone модальных компонентов. Альтернатива: `bg-[var(--color-bg-subtle)]` — чуть темнее/светлее основного фона, визуально отличается от контента за drawer.

**Файлы:**
- `EntityBottomSheet.tsx:76` — `Drawer.Content className`
- `DescriptionDrawer.tsx:103` — `Drawer.Content className`

### BUG-4: Устранение race condition в annotation rendering

**Рекомендация:** Два изменения:

1. **Использовать ref для bookmarks вместо closure:** Создать `bookmarksRef` и обновлять его в useEffect. `applyAnnotations` читает из ref, а не из closure:

```typescript
const bookmarksRef = useRef(bookmarks);
useEffect(() => { bookmarksRef.current = bookmarks; }, [bookmarks]);

const applyAnnotations = useCallback(() => {
  const currentBookmarks = bookmarksRef.current; // всегда актуальные данные
  // ... остальная логика
}, [rendition, enabled, currentChapter]); // bookmarks убрать из deps
```

2. **Уменьшить debounce до 50ms или убрать для оптимистичных обновлений:** Текущий 200ms debounce был нужен чтобы дождаться description/entity hooks. Но для обновления bookmarks это слишком долго. Вариант: проверить, что debounce 200ms нужен только при `rendered` event (навигация между главами), а при изменении bookmarks — 50ms или немедленно.

Альтернативный подход (проще): убрать `bookmarks` из зависимостей `applyAnnotations` useCallback, вместо этого передавать bookmarks как аргумент в `applyAnnotations(currentBookmarks)` — тогда каждый вызов гарантированно получает актуальные данные.

### BUG-5: elementFromPoint для edge zones

**Рекомендация:** В `handleTouchEnd` (gesture controller, строки 528-535), вместо проверки `getInteractiveType(e.target)`, использовать `elementFromPoint` аналогично тому, как это делается в center zone:

```typescript
// Вместо:
const interactiveType = getInteractiveType(e.target);

// Использовать:
const doc = contents.document;
const el = doc?.elementFromPoint(touch.clientX, touch.clientY);
const interactiveType = getInteractiveType(el);
```

Это унифицирует логику определения интерактивных элементов для всех зон (edge + center). Но нужен доступ к `contents.document` из scope `handleTouchEnd` — он уже доступен через переменную `doc` в closure contentHook.

Дополнительно: если `interactiveType` === `'description'` или `'entity'`, вызывать `onCenterTapRef.current(touch.clientX, touch.clientY)` (как сейчас для описаний) вместо return. Для entity-mention нужно добавить обработку:

```typescript
if (interactiveType === 'description' || interactiveType === 'entity') {
  onCenterTapRef.current(touch.clientX, touch.clientY);
  return;
}
```

Текущий код (строка 531-533) обрабатывает только `'description'`, entity просто делает return без действия.

## Текущее состояние

| Старый подход | Текущий подход | Когда изменилось | Влияние |
|--------------|---------------|-----------------|---------|
| SVG overlay аннотации (epub.js API) | DOM span wrapping | Phase 8 | Полный CSS контроль, но сложнее lifecycle |
| Три параллельных gesture системы | Единый useGestureController | Phase 11 | Один FSM, но 1050 строк |
| `@media (pointer: coarse) { user-select: none }` | CSS class toggle `selection-blocked` | Phase 18 | Работает, но inline-стиль из useEpubRendition перебивает |

## Открытые вопросы

1. **epub.js `selected` event при collapsed selection**
   - Что знаем: useTextSelection проверяет `selectedText.trim()`, что должно отфильтровать пустые selections
   - Что неясно: Срабатывает ли epub.js `selected` при простом тапе с `user-select: text`? Возможно, браузер создаёт collapsed selection, которую epub.js НЕ передаёт как `selected` event (нужна верификация на реальном устройстве)
   - Рекомендация: Убрать inline `user-select: text` и проверить, решает ли это проблему полностью. Если нет — добавить guard в useTextSelection

2. **iOS поведение после фиксов**
   - Что знаем: Тестирование проводится только на Pixel 9 (Android)
   - Что неясно: Изменение touch-action и user-select может повлиять на iOS Safari
   - Рекомендация: Отложено (per CONTEXT.md), но при внесении изменений учитывать iOS комментарии в коде

## Валидационная архитектура

### Тестовый фреймворк
| Свойство | Значение |
|----------|---------|
| Фреймворк | Vitest + @testing-library/react |
| Файл конфигурации | `frontend/vitest.config.ts` |
| Быстрая команда | `cd frontend && npx vitest run --reporter=verbose {file}` |
| Полный запуск | `cd frontend && npm test -- --watchAll=false` |

### Требования фазы -> Карта тестов
| Req ID | Поведение | Тип теста | Команда | Файл существует? |
|--------|----------|-----------|---------|------------------|
| BUG-1 | user-select НЕ ставится inline | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useContentHooks.test.ts` | Да (нужен новый test case) |
| BUG-2 | EntityBottomSheet bg непрозрачный | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/EntityBottomSheet.test.tsx` | Да |
| BUG-3 | DescriptionDrawer bg непрозрачный | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/DescriptionDrawer.test.tsx` | Да |
| BUG-4 | Annotation rendering без stale closure | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useAnnotationRendering.test.ts` | Да (нужен новый test case) |
| BUG-5 | elementFromPoint вместо e.target | unit | `cd frontend && npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts` | Да |

### Частота проверок
- **При каждом коммите:** `cd frontend && npx vitest run --reporter=verbose` (затронутые файлы)
- **При завершении волны:** `cd frontend && npm test -- --watchAll=false`
- **Гейт фазы:** Полный набор тестов + `npm run build`

### Пробелы Wave 0
- [ ] BUG-1: Добавить тест "inline body styles do not set user-select or touch-action: manipulation" в useContentHooks.test.ts (или в новый useEpubRendition.test.ts)
- [ ] BUG-4: Добавить тест "applyAnnotations uses current bookmarks, not stale closure" в useAnnotationRendering.test.ts

## Источники

### Первичные (HIGH confidence)
- Исходный код: `useEpubRendition.ts:236-239` — inline-стили iframe body
- Исходный код: `useContentHooks.ts:128-132` — CSS body rules и комментарий про `manipulation`
- Исходный код: `useAnnotationRendering.ts:392-434` — debounce + useCallback pipeline
- Исходный код: `useGestureController.ts:528-535` — edge zone tap detection
- Исходный код: `useSync.ts:80-142` — optimistic updates pipeline
- Исходный код: `globals.css:253,311,369,427` — `--color-bg-elevated` определения

### Вторичные (MEDIUM confidence)
- W3C Touch Events spec — touchend target = touchstart target (общеизвестное поведение)
- MDN `user-select` — `text` разрешает caret placement при тапе на мобильных

### Третичные (LOW confidence)
- epub.js `selected` event: Не проверено, срабатывает ли при collapsed selection (caret placement). Требует тестирования на реальном устройстве.

## Метаданные

**Разбивка уверенности:**
- Стек: HIGH — все библиотеки уже в проекте, версии известны
- Архитектура: HIGH — все файлы прочитаны, корневые причины локализованы
- Ошибки: HIGH — 4 из 5 причин подтверждены чтением кода; BUG-1 требует верификации гипотезы на устройстве

**Дата исследования:** 2026-03-12
**Актуально до:** 2026-03-19 (7 дней — код активно меняется)