# T01: 19-description-entity-popup 01

**Slice:** S04 — **Milestone:** M003

## Description

Расширить DescriptionDrawer (snap points, генерация изображений, превью) и заменить EntityPopup (floating card) на EntityBottomSheet (Vaul bottom sheet). Подключить оба компонента к panel dismiss flow.

Purpose: ENT-01 -- popup описания показывает кнопку генерации и полное содержимое; entity popup унифицирован как bottom sheet.
Output: Обновленный DescriptionDrawer, новый EntityBottomSheet, тесты, i18n ключи.

## Must-Haves

- [ ] "Тап на описание открывает DescriptionDrawer с типом, текстом и кнопкой генерации/просмотра"
- [ ] "Кнопка генерации видна ВСЕГДА: 'Сгенерировать' без изображения, 'Посмотреть' с изображением"
- [ ] "Генерация запускается по кнопке в drawer, НЕ автоматически при открытии"
- [ ] "Тап на сущность открывает EntityBottomSheet (Vaul) вместо floating popup"
- [ ] "Кнопка 'Подробнее' в EntityBottomSheet закрывает sheet и открывает EntityDrawer"
- [ ] "DescriptionDrawer и EntityBottomSheet закрываются при навигации (свайп/тап)"

## Files

- `frontend/src/components/Reader/DescriptionDrawer.tsx`
- `frontend/src/components/Reader/EntityBottomSheet.tsx`
- `frontend/src/components/Reader/EntityPopup.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/locales/ru/translation.json`
- `frontend/src/locales/en/translation.json`
- `frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx`
- `frontend/src/components/Reader/__tests__/EntityBottomSheet.test.tsx`
