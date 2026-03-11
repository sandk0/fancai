# M003: Reader Stability & Polish

**Vision:** Исправление регрессий v1.1 и полировка мобильного UX — навигация, анимации, шапка, панели, выделение текста, описания и entity popup-ы. Финальная стабилизация перед feature work.

## Success Criteria


## Slices

- [x] **S01: Navigation Swipes** `risk:medium` `depends:[]`
  > After this: Gesture pipeline стабилен — свайпы плавные, тапы мгновенные, chapter transition работает.
- [x] **S02: Shapka I Paneli** `risk:medium` `depends:[S01]`
  > After this: Адаптивная шапка ридера с overflow menu и перенос кнопки Инфо в TocSidebar.
- [x] **S03: Text Selection Notes** `risk:medium` `depends:[S02]`
  > After this: Разблокировка мобильного выделения текста в epub.
- [x] **S04: Description Entity Popup** `risk:medium` `depends:[S03]`
  > After this: Расширить DescriptionDrawer (snap points, генерация изображений, превью) и заменить EntityPopup (floating card) на EntityBottomSheet (Vaul bottom sheet).
- [x] **S05: Uat Edge Taps** `risk:medium` `depends:[S04]`
  > After this: Исправление 4 из 5 UAT-багов: убрать выделение текста при простом тапе, сделать непрозрачный фон drawer-ов, исправить edge taps на интерактивных элементах.
- [ ] **S06: Очистка dead code** `risk:medium` `depends:[S05]`
  > After this: unit tests prove Очистка dead code works
