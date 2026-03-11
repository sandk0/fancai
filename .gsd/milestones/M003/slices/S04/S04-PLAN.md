# S04: Description Entity Popup

**Goal:** Расширить DescriptionDrawer (snap points, генерация изображений, превью) и заменить EntityPopup (floating card) на EntityBottomSheet (Vaul bottom sheet).
**Demo:** Расширить DescriptionDrawer (snap points, генерация изображений, превью) и заменить EntityPopup (floating card) на EntityBottomSheet (Vaul bottom sheet).

## Must-Haves


## Tasks

- [x] **T01: 19-description-entity-popup 01** `est:12min`
  - Расширить DescriptionDrawer (snap points, генерация изображений, превью) и заменить EntityPopup (floating card) на EntityBottomSheet (Vaul bottom sheet). Подключить оба компонента к panel dismiss flow.

Purpose: ENT-01 -- popup описания показывает кнопку генерации и полное содержимое; entity popup унифицирован как bottom sheet.
Output: Обновленный DescriptionDrawer, новый EntityBottomSheet, тесты, i18n ключи.
- [x] **T02: 19-description-entity-popup 02** `est:16min`
  - Приглушить CSS стили описаний, добавить active state для тапов, toggle описаний в настройках, и исправить баг ENT-02 (тапы на описания/сущности у краёв экрана перехватываются навигацией).

Purpose: ENT-02 -- тапы на описания и сущности у краёв экрана не перехватываются навигацией. ENT-01 -- визуальная полировка и toggle.
Output: Приглушённые стили, active states, settings toggle, исправленный gesture controller.

## Files Likely Touched

- `frontend/src/components/Reader/DescriptionDrawer.tsx`
- `frontend/src/components/Reader/EntityBottomSheet.tsx`
- `frontend/src/components/Reader/EntityPopup.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/locales/ru/translation.json`
- `frontend/src/locales/en/translation.json`
- `frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx`
- `frontend/src/components/Reader/__tests__/EntityBottomSheet.test.tsx`
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts`
- `frontend/src/hooks/epub/useEntityNameHighlighting.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/stores/reader.ts`
- `frontend/src/components/Reader/ReaderControls.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`
