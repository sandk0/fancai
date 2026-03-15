---
phase: 21-ios-touch-diagnostics
plan: 01
status: complete
started: 2026-03-15
completed: 2026-03-15
---

## Итог

Создан диагностический тулкит для анализа touch-событий на iOS Safari.

## Что построено

### useTouchDiagnostics hook
- **Файл:** `frontend/src/hooks/epub/useTouchDiagnostics.ts`
- Passive capture-phase listeners для 6 типов событий (touchstart/move/end, pointerdown/move/up)
- Логирование в iframe и parent документах
- Throttle для move-событий (100ms)
- `getTouchActionInfo()` — сбор computed CSS `touch-action` для элементов reader
- 8 unit-тестов: экспорты, listeners, cleanup, формат логов, throttle

### DebugPanel расширен
- **Файл:** `frontend/src/components/UI/DebugPanel.tsx`
- 3 вкладки: Logs / Touch / CSS
- Touch tab: фильтрует `[touch-diag]` записи с цветовой кодировкой (зелёный=start/down, красный=end/up, серый=move)
- CSS tab: таблица computed touch-action для всех элементов reader (красный warning для `auto`)
- Pause/Resume кнопка — замораживает обновление лога для чтения
- Copy через `navigator.share()` — нативный share sheet для iOS Safari

### Интеграция
- **Файл:** `frontend/src/components/Reader/EpubReader.tsx`
- `useTouchDiagnostics(rendition)` вызывается после `useGestureController`
- Активен только при `?debug=1`

## Ключевые файлы

### key-files
- created:
  - `frontend/src/hooks/epub/useTouchDiagnostics.ts`
  - `frontend/src/hooks/epub/__tests__/useTouchDiagnostics.test.ts`
- modified:
  - `frontend/src/components/UI/DebugPanel.tsx`
  - `frontend/src/components/Reader/EpubReader.tsx`

## Коммиты
- `6473ed7` — feat(21-01): add useTouchDiagnostics hook with TDD tests
- `e5724ad` — feat(21-01): extend DebugPanel with Touch/CSS tabs and integrate hook in EpubReader
- `cf1b128` — fix(debug): iOS Safari copy + pause button for DebugPanel
- `a596fba` — fix(debug): use navigator.share() for iOS copy, add pause button

## Диагностические данные (iPhone 15 Pro, iOS 26.3.1)

### CSS touch-action
| Элемент | Значение |
|---------|----------|
| #epub-viewer | pan-x pan-y |
| iOS overlay | pan-x pan-y |
| iframe (element) | pan-x pan-y |
| iframe body | pan-x pan-y |
| iframe html | pan-x pan-y |

**Вывод:** touch-action корректен на всех уровнях DOM. Pinch-zoom заблокирован.

### Touch events
- **100% событий** приходят с `source:"parent"`, **0% с `source:"iframe"`**
- iOS overlay полностью перехватывает все касания до iframe
- `defaultPrevented: false` у подавляющего большинства событий
- При быстром скролле `touchmove` становится `cancelable: false` (Safari берёт контроль для инерции)
- Порядок: pointerdown → touchstart → (pointermove → touchmove)* → pointerup → touchend

### Ключевой вывод для Phase 22
iOS overlay (`gesture-controller-ios-overlay`) поглощает все touch-события. Iframe document не получает ни одного touch/pointer event. Это означает, что навигация работает только через gesture controller на уровне parent document. Для фиксов навигации нужно работать с iOS overlay, а не с iframe touch handlers.

## Self-Check: PASSED
