---
phase: 26-fix-images
plan: 01
subsystem: ui
tags: [tanstack-query, image-generation, description-drawer, cache-invalidation, regeneration]

# Dependency graph
requires:
  - phase: 26-fix-images
    provides: "RESEARCH.md с анализом корневых причин багов изображений"
provides:
  - "DescriptionDrawer с TQ-based изображением (SSoT) вместо stale prop"
  - "Кнопка регенерации изображений с overlay-спиннером"
  - "Корректная инвалидация imageKeys.byBook при генерации"
  - "Сброс мутации при смене описания (фикс Bug 2)"
affects: [26-fix-images]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TQ query как SSoT для изображений в drawer (вместо prop drilling)"
    - "mutation.reset() при смене контекста для предотвращения stale data"
    - "description_id guard на mutation.data для защиты от показа чужих данных"

key-files:
  created: []
  modified:
    - "frontend/src/components/Reader/DescriptionDrawer.tsx"
    - "frontend/src/components/Reader/EpubReader.tsx"
    - "frontend/src/hooks/api/useImages/useImageMutations.ts"
    - "frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx"

key-decisions:
  - "useImageForDescription TQ query как единственный источник правды для изображений в drawer"
  - "generateMutation.reset() + regenerateMutation.reset() в useEffect на description?.id"
  - "Удалён drawerImage state и GeneratedImage import из EpubReader.tsx"

patterns-established:
  - "TQ SSoT pattern: компонент сам запрашивает данные через query, а не получает через props"
  - "Mutation reset pattern: сброс мутации при смене контекста через useEffect"

requirements-completed: [BUG-01, BUG-02, REGEN, INVALIDATE]

# Metrics
duration: 9min
completed: 2026-03-16
---

# Phase 26 Plan 01: Исправление багов изображений Summary

**TQ-based SSoT для изображений в DescriptionDrawer с кнопкой регенерации, исправлением инвалидации byBook и сбросом мутации при смене описания**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-16T15:02:50Z
- **Completed:** 2026-03-16T15:12:23Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Исправлен Bug 1: изображение больше не пропадает при повторном открытии drawer (useImageForDescription TQ query вместо stale prop)
- Исправлен Bug 2: чужое изображение не показывается при смене описания (generateMutation.reset() + description_id guard)
- Добавлена кнопка "Генерировать заново" рядом с "Посмотреть" с overlay-спиннером
- Исправлена инвалидация imageKeys.byBook в useGenerateImage для обновления images[] в useChapterData
- Обновлены тесты DescriptionDrawer для новой TQ-based архитектуры (11 тестов, все зелёные)

## Task Commits

Each task was committed atomically:

1. **Task 1: Исправить инвалидацию query keys в useGenerateImage** - `8f94b48` (fix)
2. **Task 2: Рефакторинг DescriptionDrawer на TQ query + регенерация + сброс мутации** - `3403846` (fix)

## Files Created/Modified
- `frontend/src/hooks/api/useImages/useImageMutations.ts` - Добавлена инвалидация imageKeys.byBook в useGenerateImage onSuccess
- `frontend/src/components/Reader/DescriptionDrawer.tsx` - Полный рефакторинг: TQ query, регенерация, сброс мутации, overlay-спиннер
- `frontend/src/components/Reader/EpubReader.tsx` - Удалён drawerImage state, убран image prop из DescriptionDrawer
- `frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx` - Обновлены моки для TQ-based архитектуры, добавлен тест Bug 2 guard

## Decisions Made
- Использовали useImageForDescription TQ query как SSoT вместо передачи image через props (устраняет stale data)
- Удалили GeneratedImage из import в EpubReader.tsx (больше не используется после удаления drawerImage)
- Добавили eslint-disable для exhaustive-deps на useEffect с mutation.reset() (reset стабилен, но ESLint не знает)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Обновлены тесты DescriptionDrawer**
- **Found during:** Task 2
- **Issue:** Тесты передавали `image` prop, который удалён из интерфейса
- **Fix:** Переписаны моки для useImageForDescription, useRegenerateImage, notify. Добавлен тест для Bug 2 guard (description_id mismatch)
- **Files modified:** frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx
- **Verification:** 11/11 тестов зелёные
- **Committed in:** 3403846 (часть Task 2 коммита)

---

**Total deviations:** 1 auto-fixed (1 bug - тесты)
**Impact on plan:** Обновление тестов необходимо для корректности. Без scope creep.

## Issues Encountered
- Параллельный коммит 16137f2 (plan 26-02) модифицировал DescriptionDrawer.tsx между Task 1 и Task 2 коммитами. Write tool перезаписал файл корректной версией, git разрешил без конфликтов.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DescriptionDrawer готов для production с корректным TQ-based отображением изображений
- Plan 26-02 (useImageModal refactoring) уже выполнен параллельно
- Оба бага исправлены, кнопка регенерации добавлена

## Self-Check: PASSED

All files exist on disk. All commit hashes verified in git log.

---
*Phase: 26-fix-images*
*Completed: 2026-03-16*
