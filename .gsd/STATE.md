# GSD State

**Active Milestone:** M003 — Reader Stability & Polish
**Active Slice:** S05 — Uat Edge Taps (UAT FAILED — 3 бага не исправлены)
**Phase:** execute (T01+T02 done, need T03+)
**Requirements Status:** 1 active · 12 validated · 0 deferred · 0 out of scope

## Milestone Registry
- ✅ **M001:** Готовность к продакшену (completed 2026-03-09)
- ✅ **M002:** Reader Mobile / PWA (completed 2026-03-09, summary written)
- 🔄 **M003:** Reader Stability & Polish (S01-S04 done, S05 in progress, S06 pending)

## Current Bugs (S05 UAT failures)

### BUG-1: Выделение текста при простом тапе ❌
- Любой тап по тексту вызывает выделение — нужен long-press (~500ms)
- T01 убрал inline userSelect='text', но epub.js iframe контент по умолчанию selectable
- **Гипотеза:** Нужно инжектировать `user-select: none` в iframe contentDocument, включать `user-select: text` только в FSM-состоянии `selecting` (long-press)
- **Ключевые файлы:** `useContentHooks.ts`, `useGestureController.ts`

### BUG-2: Заметки показывают ПРЕДЫДУЩУЮ вместо текущей ❌
- Создал заметку A → нет подсветки. Создал B → появляется A. Стабильно воспроизводится.
- T02 добавил bookmarksRef + 50ms debounce, но проблема осталась
- **Гипотеза:** DOM tree меняется после wrapping spans — Range API для следующего bookmark работает с устаревшим DOM. Или epub.js relocated event сбрасывает DOM после injection
- **Ключевые файлы:** `useAnnotationRendering.ts`

### BUG-3: Edge taps на entity/description → перелистывание ❌
- Тап на description-highlight или entity-mention у краёв экрана вызывает перелистывание
- T01 добавил elementFromPoint, но document.elementFromPoint на wrapper-уровне не видит элементы внутри iframe
- **Гипотеза:** Нужно iframeDoc.elementFromPoint(adjustedX, adjustedY) ИЛИ проверять event.target ПЕРЕД проверкой edge zone (priority inversion)
- **Ключевые файлы:** `useGestureController.ts`

## Completed T01/T02 commits
- `2de7397` fix(19.1-01): remove inline touch-action/user-select, opaque drawer backgrounds
- `8ce1cac` fix(19.1-01): elementFromPoint for edge zones + entity handler
- `3a2de79` test(19.1-02): add failing tests for stale closure (RED)
- `8860255` fix(19.1-02): resolve stale closure race condition in annotation rendering

## Recent Decisions
- Inline touchAction/userSelect/webkitUserSelect убраны — CSS единственный источник
- bg-[var(--color-bg-base)] для drawer-ов
- elementFromPoint с fallback на e.target
- bookmarksRef.current вместо closure
- 50ms/200ms дифференцированный debounce

## Blockers
- 3 UAT-бага требуют deep debug на реальном устройстве или через browser tools
- Unit-тесты проходят — проблема воспроизводится только в runtime с epub.js iframe

## Next Action
Спланировать и выполнить T03+ для S05 — deep debug и исправление 3 оставшихся багов. Рекомендуется загрузить skill debug-like-expert для BUG-1/BUG-3 (cross-iframe interaction). Начать с BUG-3 (priority inversion — самый вероятный quick win).
