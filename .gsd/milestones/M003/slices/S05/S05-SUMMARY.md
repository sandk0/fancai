---
id: S05
parent: M003
milestone: M003
provides:
  - "Inline touch-action/user-select убраны — CSS из useContentHooks единственный источник"
  - "Непрозрачный фон drawer-ов (bg-base вместо bg-elevated) во всех 4 темах"
  - "elementFromPoint для edge zones в gesture controller (touch + click handlers)"
  - "Entity handler в edge zones (description + entity тапы у краёв экрана)"
  - "bookmarksRef pattern — stale closure fix для debounced annotation rendering"
  - "Дифференцированный debounce: 50ms bookmark changes, 200ms rendered event"
requires:
  - slice: S04
    provides: "EntityBottomSheet и DescriptionDrawer компоненты с Vaul bottom sheets"
affects:
  - S06
key_files:
  - frontend/src/hooks/epub/useEpubRendition.ts
  - frontend/src/hooks/epub/useGestureController.ts
  - frontend/src/hooks/epub/useAnnotationRendering.ts
  - frontend/src/components/Reader/EntityBottomSheet.tsx
  - frontend/src/components/Reader/DescriptionDrawer.tsx
key_decisions:
  - "Inline touchAction/userSelect убраны полностью — CSS из useContentHooks единственный источник"
  - "bg-[var(--color-bg-base)] для drawer-ов — solid, theme-adaptive, непрозрачный"
  - "elementFromPoint с fallback на e.target для обратной совместимости"
  - "Click handler обновлён аналогично touch handler (entity + description)"
  - "bookmarksRef.current вместо closure — актуальные данные при debounced вызове"
  - "50ms/200ms дифференцированный debounce по типу события"
patterns_established:
  - "bookmarksRef pattern для debounced callbacks с TanStack Query optimistic updates"
  - "elementFromPoint для edge zone click/touch detection вместо e.target"
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M003/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S05/tasks/T02-SUMMARY.md
duration: 13min
verification_result: passed
completed_at: 2026-03-12
---

# S05: Uat Edge Taps

**Исправлены 4 UAT-бага (ложное выделение текста, непрозрачные фоны drawer-ов, edge tap entity/description) + race condition аннотаций через bookmarksRef pattern**

## What Happened

Слайс исправил все оставшиеся UAT-баги из ручного тестирования на устройстве.

**T01** устранил 4 бага за одну итерацию:
- BUG-1: убраны inline touchAction/userSelect/webkitUserSelect из useEpubRendition — CSS из useContentHooks (`touch-action: pan-x pan-y`) теперь единственный источник, простой тап больше не вызывает ложное выделение текста
- BUG-2/3: EntityBottomSheet и DescriptionDrawer переведены на `bg-[var(--color-bg-base)]` — непрозрачный фон во всех 4 темах вместо полупрозрачного bg-elevated
- BUG-5: edge zone в gesture controller использует `elementFromPoint` вместо `e.target` для корректного определения description/entity элементов у краёв экрана. Click handler (desktop) обновлён аналогично touch handler для консистентности

**T02** исправил BUG-4 (race condition аннотаций) через TDD:
- Проблема: debounced `applyAnnotations` захватывал stale closure bookmarks — после optimistic update TanStack Query данные уже актуальны, но debounced callback читал старую версию
- Решение: `bookmarksRef.current` вместо closure — гарантирует актуальные данные при любом debounced вызове. Дифференцированный debounce: 50ms для bookmark changes (данные уже в кэше), 200ms для rendered event (навигация, нужно дождаться hooks)
- Click handler также переведён на ref — убрана зависимость от bookmarks в useEffect deps

## Verification

- 18 тестов, релевантных S05, проходят (useAnnotationRendering: 7, useContentHooks: 6, useGestureController: 5)
- Production build успешен
- 2 новых теста T02: stale closure + fast debounce (TDD: RED→GREEN)
- 1 новый тест T01: touch-action: pan-x pan-y инжектируется через CSS
- 2 предшествующих тест-фейла (ErrorBoundary i18n, EpubReader env var) подтверждены на main — не связаны с S05

## Requirements Advanced

- ENT-02 — elementFromPoint в edge zones гарантирует тапы на description/entity у краёв экрана

## Requirements Validated

- Нет новых валидаций — ENT-02, SEL-01, ENT-01, PNL-01 уже были в статусе validated

## New Requirements Surfaced

- Нет

## Requirements Invalidated or Re-scoped

- Нет

## Deviations

- T01: Click handler (desktop) обновлён аналогично touch handler — entity + description обработка добавлена для консистентности (auto-fixed, не в плане)

## Known Limitations

- 2 предшествующих теста сломаны: ErrorBoundary.test.tsx (i18n — ищет английский текст при русской локали), EpubReader.test.tsx (отсутствует VITE_API_BASE_URL)
- UAT подтверждение BUG-1..5 требует ручного тестирования на устройстве (unit-тесты проверяют логику, не UX)

## Follow-ups

- Починить ErrorBoundary.test.tsx (обновить текстовые матчеры под i18n)
- Починить EpubReader.test.tsx (добавить env var в test setup)

## Files Created/Modified

- `frontend/src/hooks/epub/useEpubRendition.ts` — убраны 3 inline-стиля (touchAction, userSelect, webkitUserSelect)
- `frontend/src/hooks/epub/useGestureController.ts` — elementFromPoint для edge zones, entity handler в touch+click handlers
- `frontend/src/hooks/epub/useAnnotationRendering.ts` — bookmarksRef, дифференцированный debounce, click handler ref
- `frontend/src/components/Reader/EntityBottomSheet.tsx` — bg-base вместо bg-elevated
- `frontend/src/components/Reader/DescriptionDrawer.tsx` — bg-base вместо bg-elevated
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts` — тест touch-action CSS injection
- `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts` — 2 теста BUG-4 (stale closure, fast debounce)

## Forward Intelligence

### What the next slice should know
- S06 (очистка dead code) может безопасно удалять useTouchNavigation.ts и IOSTapZones.tsx — вся touch/gesture логика живёт в useGestureController
- useFollowFingerSwipe.ts используется в useGestureController (импорт утилит) — нельзя удалять полностью, нужен аудит

### What's fragile
- `elementFromPoint` в gesture controller зависит от `document.elementFromPoint` — если iframe document недоступен, fallback на e.target. В реальном epub.js iframe всегда доступен, но mock-тесты требуют осторожности
- bookmarksRef pattern требует синхронного обновления ref перед debounced вызовом — если порядок useEffect нарушится, stale closure вернётся

### Authoritative diagnostics
- `npx vitest run src/hooks/epub/__tests__/useAnnotationRendering.test.ts` — 7 тестов покрывают stale closure, debounce timing, mount/unmount lifecycle
- `npx vitest run src/hooks/epub/__tests__/useGestureController.test.ts` — 5 тестов проверяют edge zone и entity handling

### What assumptions changed
- Предполагалось что T01+T02 решат все UAT-баги и потребуется T03+ — на практике 2 таска оказались достаточными, BUG-4 решён через bookmarksRef без глубокого debug
