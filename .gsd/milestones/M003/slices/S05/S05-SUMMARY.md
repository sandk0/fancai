---
id: S05
parent: M003
milestone: M003
provides:
  - "Inline touch-action/user-select убраны из useEpubRendition (CSS из useContentHooks имеет приоритет)"
  - "Непрозрачный фон drawer-ов (bg-base вместо bg-elevated)"
  - "elementFromPoint для edge zones в gesture controller"
  - "Entity handler в edge zones (description + entity тапы у краёв экрана)"
  - "bookmarksRef pattern -- stale closure fix for debounced annotation rendering"
  - "Differentiated debounce: 50ms for bookmark changes, 200ms for rendered event"
  - "Click handler reads from ref (no unnecessary re-registrations)"
requires: []
affects: []
key_files:
  - frontend/src/hooks/epub/useEpubRendition.ts
  - frontend/src/hooks/epub/useGestureController.ts
  - frontend/src/hooks/epub/useAnnotationRendering.ts
  - frontend/src/hooks/epub/useContentHooks.ts
  - frontend/src/components/Reader/EntityBottomSheet.tsx
  - frontend/src/components/Reader/DescriptionDrawer.tsx
key_decisions:
  - "Inline touchAction/userSelect/webkitUserSelect убраны полностью, CSS из useContentHooks теперь единственный источник touch-action"
  - "bg-[var(--color-bg-base)] выбран для drawer-ов (solid, theme-adaptive, непрозрачный во всех 4 темах)"
  - "elementFromPoint с fallback на e.target для обратной совместимости"
  - "Click handler обновлён аналогично touch handler для консистентности (entity + description)"
  - "bookmarksRef.current вместо closure -- гарантирует актуальные данные при debounced вызове"
  - "50ms debounce для bookmark changes (optimistic update), 200ms для rendered event (навигация)"
  - "Click handler переведён на bookmarksRef -- убрана зависимость от bookmarks в useEffect deps"
patterns_established:
  - "elementFromPoint: использовать document.elementFromPoint(x, y) вместо e.target для touch events"
  - "Drawer backgrounds: bg-[var(--color-bg-base)] для standalone модальных компонентов"
  - "useRef для данных потребляемых в debounced callbacks -- избегает stale closure"
observability_surfaces: []
drill_down_paths: []
duration: 13min
verification_result: failed
completed_at: null
blocker_discovered: true
---
# S05: Uat Edge Taps

## What Happened

Выполнены 2 задачи (T01 + T02), направленные на исправление 5 UAT-багов. Unit-тесты прошли, build успешен. Однако **UAT на устройстве показал, что 3 из 5 багов не исправлены** — фиксы оказались недостаточными.

### T01: Inline touch-action, drawer backgrounds, elementFromPoint (коммиты 2de7397, 8ce1cac)
- Убраны inline touchAction/userSelect/webkitUserSelect из useEpubRendition.ts
- Drawer-ы переведены на непрозрачный bg-[var(--color-bg-base)]
- Edge zones используют elementFromPoint + entity handler

### T02: bookmarksRef stale closure fix (коммиты 3a2de79, 8860255)
- bookmarksRef вместо closure для debounced annotation rendering
- Дифференцированный debounce: 50ms/200ms

## UAT Verification: FAILED

**3 из 5 багов не исправлены после device-тестирования:**

### BUG-1: Выделение текста срабатывает при простом тапе ❌ НЕ ИСПРАВЛЕН
- **Симптом:** Любой тап по тексту вызывает выделение/каретку — не нужно удерживать палец
- **Ожидание:** Выделение должно активироваться ТОЛЬКО через long-press (удержание ~500ms), простой тап НЕ должен выделять текст
- **Что было сделано:** Убраны inline `userSelect='text'` и `webkitUserSelect='text'` из useEpubRendition.ts, CSS `touch-action: pan-x pan-y` из useContentHooks оставлен как единственный источник
- **Почему не помогло:** CSS `touch-action` контролирует pan/zoom, но НЕ контролирует user-select. Удаление inline `userSelect='text'` убирает явное разрешение, но epub.js iframe содержимое по умолчанию selectable. Нужен другой подход — возможно `user-select: none` по умолчанию + `user-select: text` только в состоянии `selecting` gesture controller

### BUG-2: Заметки выделяются с задержкой (показывается ПРЕДЫДУЩАЯ заметка) ❌ НЕ ИСПРАВЛЕН
- **Симптом:** Пользователь создаёт заметку A → она не выделяется визуально. Создаёт заметку B → B не выделяется, но появляется выделение A
- **Ожидание:** Каждая созданная заметка должна СРАЗУ отображаться визуально (подсветка текста)
- **Что было сделано:** bookmarksRef pattern, дифференцированный debounce 50ms/200ms
- **Почему не помогло:** Stale closure fix решает проблему устаревших данных в debounced callback, но root cause может быть в другом — возможно, TanStack Query invalidation приходит после debounced call, или DOM manipulation (wrapping spans) конфликтует с epub.js relocation. Нужен debug с реальным устройством

### BUG-3: Edge taps на сущностях/описаниях вызывают перелистывание ❌ НЕ ИСПРАВЛЕН
- **Симптом:** Тап на description-highlight или entity-mention у левого/правого края экрана вызывает перелистывание вместо открытия popup
- **Ожидание:** Тап на интерактивный элемент ВСЕГДА открывает popup, независимо от позиции на экране
- **Что было сделано:** elementFromPoint в gesture controller для edge zones, entity handler в touch/click handlers
- **Почему не помогло:** elementFromPoint вызывается из wrapper div, но тапы внутри epub.js iframe проходят через iframe → wrapper event propagation. `document.elementFromPoint` на wrapper-уровне может не видеть элементы внутри iframe. Нужно проверять iframe contentDocument

## Root Cause Hypotheses для следующего агента

### BUG-1 (text selection on tap):
1. **epub.js iframe user-select:** Контент внутри iframe по умолчанию selectable. CSS `user-select: none` нужно инжектировать в iframe contentDocument, а не в wrapper
2. **Gesture controller state:** Нужно различать idle tap (no selection) и long-press (start selection). Возможно, gesture controller FSM должен иметь отдельное состояние `selecting` с user-select: text

### BUG-2 (stale annotation rendering):
1. **Timing issue:** applyAnnotations может вызываться ДО того, как новый bookmark сохранён через sync API. bookmarksRef.current может содержать optimistic update, но DOM ещё не готов
2. **DOM state mismatch:** После wrapping spans для bookmark A, DOM tree меняется. Когда приходит bookmark B, Range API может работать с устаревшим DOM
3. **Re-render cycle:** epub.js relocated event после annotation injection может сбрасывать DOM

### BUG-3 (edge tap entity/description):
1. **Cross-frame elementFromPoint:** `document.elementFromPoint(x, y)` на уровне основного документа видит wrapper div, а не элементы внутри iframe. Нужно `iframeDoc.elementFromPoint(adjustedX, adjustedY)`
2. **Event target vs visual position:** Touch event target из iframe может иметь правильный target, но координаты относительно wrapper попадают в edge zone. Нужно проверять target ДО проверки зоны
3. **Priority inversion:** Gesture controller проверяет edge zone ПЕРЕД проверкой entity/description target. Нужно инвертировать: сначала проверить target, потом зону

## Files Modified in S05

- `frontend/src/hooks/epub/useEpubRendition.ts` — убраны inline стили
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` — новый тест CSS injection
- `frontend/src/components/Reader/EntityBottomSheet.tsx` — непрозрачный фон
- `frontend/src/components/Reader/DescriptionDrawer.tsx` — непрозрачный фон
- `frontend/src/hooks/epub/useGestureController.ts` — elementFromPoint, entity handler
- `frontend/src/hooks/epub/useAnnotationRendering.ts` — bookmarksRef, debounce
- `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts` — тесты stale closure
