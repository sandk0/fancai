# S05: Uat Edge Taps

**Goal:** Исправление 4 из 5 UAT-багов: убрать выделение текста при простом тапе, сделать непрозрачный фон drawer-ов, исправить edge taps на интерактивных элементах.
**Demo:** Исправление 4 из 5 UAT-багов: убрать выделение текста при простом тапе, сделать непрозрачный фон drawer-ов, исправить edge taps на интерактивных элементах.

## Must-Haves


## Tasks

- [x] **T01: 19.1-uat-edge-taps 01** `est:4min`
  - Исправление 4 из 5 UAT-багов: убрать выделение текста при простом тапе, сделать непрозрачный фон drawer-ов, исправить edge taps на интерактивных элементах.

Purpose: Пользователь может комфортно читать без ложных выделений, видит контент drawer-ов на непрозрачном фоне, может тапать на описания/сущности у краёв экрана.
Output: 4 точечных исправления в 4 файлах + тест BUG-1 + обновлённые тесты.
- [x] **T02: 19.1-uat-edge-taps 02** `est:9min`
  - Исправление BUG-4: race condition в annotation rendering — заметки отображаются с задержкой, показывая ПРЕДЫДУЩУЮ заметку вместо текущей.

Purpose: Пользователь создаёт заметку и сразу видит визуальную подсветку текста, без необходимости создавать ещё одну заметку для "проявления" предыдущей.
Output: Исправленный useAnnotationRendering.ts без stale closure проблемы + тест.

## Files Likely Touched

- `frontend/src/hooks/epub/useEpubRendition.ts`
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts`
- `frontend/src/components/Reader/EntityBottomSheet.tsx`
- `frontend/src/components/Reader/DescriptionDrawer.tsx`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/hooks/epub/useAnnotationRendering.ts`
- `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts`
