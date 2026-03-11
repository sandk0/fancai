# T01: 19.1-uat-edge-taps 01

**Slice:** S05 — **Milestone:** M003

## Description

Исправление 4 из 5 UAT-багов: убрать выделение текста при простом тапе, сделать непрозрачный фон drawer-ов, исправить edge taps на интерактивных элементах.

Purpose: Пользователь может комфортно читать без ложных выделений, видит контент drawer-ов на непрозрачном фоне, может тапать на описания/сущности у краёв экрана.
Output: 4 точечных исправления в 4 файлах + тест BUG-1 + обновлённые тесты.

## Must-Haves

- [ ] "Простой тап по тексту НЕ вызывает выделение/каретку — только long-press (~500ms)"
- [ ] "useEpubRendition.ts НЕ содержит inline touchAction='manipulation' и userSelect='text'"
- [ ] "EntityBottomSheet отображает контент на полностью непрозрачном фоне во всех темах"
- [ ] "DescriptionDrawer отображает контент на полностью непрозрачном фоне во всех темах"
- [ ] "Тап на description-highlight или entity-mention у края экрана открывает popup, а не перелистывает страницу"

## Files

- `frontend/src/hooks/epub/useEpubRendition.ts`
- `frontend/src/hooks/epub/__tests__/useContentHooks.test.ts`
- `frontend/src/components/Reader/EntityBottomSheet.tsx`
- `frontend/src/components/Reader/DescriptionDrawer.tsx`
- `frontend/src/hooks/epub/useGestureController.ts`
