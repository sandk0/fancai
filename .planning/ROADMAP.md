# Дорожная карта: fancai

## Milestones

- v1.0 Готовность к продакшену (shipped 2026-03-09) -- archived
- v1.1 Reader Mobile / PWA (shipped 2026-03-09) -- archived
- v1.2 Reader Stability & Polish -- Phases 16-20 (active)

## Phases

<details>
<summary>v1.0 Готовность к продакшену (Phases 1-8) -- SHIPPED 2026-03-09</summary>

- [x] Phase 1: Безопасность продакшена (2/2 plans) -- completed 2026-03-01
- [x] Phase 2: Очистка мертвого кода (2/2 plans) -- completed 2026-03-01
- [x] Phase 3: Миграция сервисов (4/4 plans) -- completed 2026-03-01
- [x] Phase 4: Обслуживание инфраструктуры (3/3 plans) -- completed 2026-03-02
- [x] Phase 4.1: Фиксы интеграции и ребрендинг (3/3 plans) -- completed 2026-03-04
- [x] Phase 5: Стабилизация AI и техдолг (2/2 plans) -- completed 2026-03-04
- [x] Phase 6: Качество Entity Wiki (2/2 plans) -- completed 2026-03-04
- [x] Phase 7: Обработка ошибок и UX (2/2 plans) -- completed 2026-03-05
- [x] Phase 8: Функции ридера (3/3 plans) -- completed 2026-03-07

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Reader Mobile / PWA (Phases 9-14) -- SHIPPED 2026-03-09</summary>

- [x] Phase 9: Стабилизация навигации (2/2 plans) -- completed 2026-03-09
- [x] Phase 10: Follow-finger свайпы (2/2 plans) -- completed 2026-03-09
- [x] Phase 11: Единый gesture handler и мобильный UI (3/3 plans) -- completed 2026-03-09
- [x] Phase 12: Viewport и iOS (2/2 plans) -- completed 2026-03-09
- [x] Phase 13: PWA и offline (2/2 plans) -- completed 2026-03-09
- [x] Phase 14: Фикс описаний (2/2 plans) -- completed 2026-03-09

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### v1.2 Reader Stability & Polish

**Milestone Goal:** Исправление регрессий v1.1 и полировка мобильного UX -- навигация, анимации, шапка, панели, выделение текста, описания.

- [x] **Phase 16: Навигация и свайпы** - Стабильная gesture pipeline: плавные свайпы, тапы, переход между главами без дублирования -- completed 2026-03-11
- [x] **Phase 17: Шапка и панели** - Адаптивная шапка (320px+) и панели с полной высотой без авто-клавиатуры (gap closure) (completed 2026-03-11)
- [x] **Phase 18: Выделение текста и заметки** - Работающее выделение текста и создание заметок без перехвата жестами (completed 2026-03-11)
- [x] **Phase 19: Описания и Entity Popup** - Кликабельные описания и сущности в любой зоне экрана (completed 2026-03-11)
- [x] **Phase 19.1: UAT-фиксы** - Точечные исправления 5 UAT-багов: выделение при тапе, прозрачные drawer-ы, edge taps, задержка заметок (INSERTED) (gap closure — 3/4 fixes failed human UAT) (completed 2026-03-12)
- [x] **Phase 19.2: Мобильные баги ридера** - Глубокое исправление 3 UAT-багов: Touch to Search, координаты iframe, annotation timing (INSERTED) (completed 2026-03-12)
- [x] **Phase 19.3: ResizeObserver cascade fix + highlighting coordination** - Устранение корневой причины: resize cascade при span wrapping, координация highlighting-систем, CSS padding fix (INSERTED) (completed 2026-03-12)
- [ ] **Phase 20: Очистка dead code** - Удаление устаревшего кода навигации (~38KB)

## Phase Details

### Phase 16: Навигация и свайпы

**Goal**: Пользователь перелистывает страницы свайпами и тапами плавно, без визуальных артефактов и дублирования -- фундамент для всех остальных фаз
**Depends on**: Nothing (первая фаза milestone)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):

1. Свайп вперёд/назад перелистывает ровно одну страницу с плавной spring-анимацией (без двойного перелистывания, без рывков)
2. Тап по правому/левому краю перелистывает страницу мгновенно (instant scroll) без видимой задержки или дёрганой анимации
3. Свайп на последней/первой странице главы переходит к следующей/предыдущей главе с визуальной обратной связью
4. Анимация свайпа выглядит как Apple Books slide -- 60fps, follow-finger tracking, spring с микро-bounce на завершении
   **Plans:** 2/2 plans complete

Plans:

- [x] 16-01-PLAN.md -- Исправление pipeline: двухфазная навигация, spring configs, instant scroll (11 min)
- [x] 16-02-PLAN.md -- Тесты и верификация на реальном устройстве (~60 min, 4 iterations)

### Phase 17: Шапка и панели

**Goal**: Шапка ридера и выдвижные панели корректно отображаются на всех размерах экранов, от iPhone SE (320px) до планшетов
**Depends on**: Nothing (параллелизуема с Phase 16, не затрагивает gesture controller)
**Requirements**: HDR-01, HDR-02, PNL-01, PNL-02
**Success Criteria** (what must be TRUE):

1. На экране 320px (iPhone SE) шапка не переполняется -- второстепенные кнопки уходят в overflow menu
2. Поле поиска и кнопка закрытия полностью видны на любом экране, ничего не обрезается
3. Панели оглавления, настроек и заметок открываются на полную высоту и показывают всё содержимое (Vaul snap points)
4. При открытии оглавления клавиатура не появляется автоматически
5. Клик по кнопкам шапки не скрывает шапку (iOS overlay не перехватывает)
6. Entity Wiki имеет отдельную видимую кнопку в шапке
7. Панели закрываются по клику вне них (включая тап внутри epub iframe)
8. Прогресс-линия отображается внизу читалки, не в шапке
   **Plans:** 5/5 plans complete

Plans:

- [x] 17-01-PLAN.md -- Адаптивная шапка с overflow menu + перенос Инфо в TocSidebar (7 min)
- [x] 17-02-PLAN.md -- Snap points панелей + autofocus fix + SearchPanel на 320px (5 min)
- [x] 17-03-PLAN.md -- ReaderFooter с прогресс-линией, удаление прогресса из шапки
- [x] 17-04-PLAN.md -- Фикс iOS overlay + вынос Entity Wiki и Settings из overflow
- [x] 17-05-PLAN.md -- Закрытие панелей по клику вне них (iframe bridge, MobilePanel fix, SearchPanel backdrop)

### Phase 18: Выделение текста и заметки

**Goal**: Пользователь может выделить текст и создать заметку/выделение без конфликтов с gesture controller
**Depends on**: Phase 16 (gesture pipeline должен поддерживать passthrough для text selection)
**Requirements**: SEL-01, SEL-02
**Success Criteria** (what must be TRUE):

1. Пользователь выделяет текст long-press + drag -- gesture controller не перехватывает drag handles и не начинает свайп
2. После выделения текста появляется SelectionMenu, через который можно создать заметку или цветное выделение
3. Созданные заметки/выделения сохраняются и отображаются при повторном открытии книги
   **Plans:** 2/2 plans complete

Plans:

- [ ] 18-01-PLAN.md -- Разблокировка мобильного выделения: CSS user-select, contextmenu, gesture passthrough
- [ ] 18-02-PLAN.md -- HighlightTooltip компонент и wiring в EpubReader/ReaderModals

### Phase 19: Описания и Entity Popup

**Goal**: Тапы на описания и сущности корректно открывают popup-ы в любой зоне экрана, не конфликтуя с навигацией
**Depends on**: Phase 16 (conditional center-tap и interactive passthrough реализуются в gesture pipeline)
**Requirements**: ENT-01, ENT-02
**Success Criteria** (what must be TRUE):

1. Тап на выделенное описание открывает DescriptionDrawer с полным содержимым и кнопкой генерации изображения
2. Тап на выделенную сущность открывает Entity popup с информацией о персонаже/локации/объекте
3. Описания и сущности у левого/правого края экрана кликабельны -- навигация не перехватывает тап
   **Plans:** 2/2 plans complete

Plans:

- [ ] 19-01-PLAN.md -- DescriptionDrawer с генерацией + EntityBottomSheet + panel dismiss wiring
- [ ] 19-02-PLAN.md -- CSS opacity приглушение + active states + settings toggle + ENT-02 fix

### Phase 19.3: ResizeObserver cascade fix + highlighting coordination (INSERTED)

**Goal:** Устранение корневой причины: ResizeObserver cascade при DOM span wrapping, конфликт highlighting-систем (description/entity/annotation), Chrome Touch to Search. Исследование: .planning/phases/19.2-touch-selection-iframe-annotation-timing/RESEARCH-post-uat.md
**Requirements**: BUG-1, BUG-4, BUG-5
**Depends on:** Phase 19.2
**Plans:** 1/1 plans complete

Plans:
- [x] 19.3-01-PLAN.md — ResizeObserver suppression утилита + координация highlighting-систем + CSS padding fix + Touch to Search усиление (17 min)

### Phase 19.1: UAT-фиксы: выделение, прозрачность, edge taps, задержка заметок (INSERTED)

**Goal:** Исправление 5 UAT-багов мобильного ридера: ложное выделение при тапе, прозрачные фоны drawer-ов, edge taps на интерактивных элементах, задержка отображения заметок
**Depends on:** Phase 19
**Requirements**: BUG-1, BUG-2, BUG-3, BUG-4, BUG-5
**Success Criteria** (what must be TRUE):

1. Простой тап по тексту НЕ вызывает выделение/каретку -- только long-press (~500ms)
2. EntityBottomSheet и DescriptionDrawer отображают контент на полностью непрозрачном фоне
3. Тап на description-highlight или entity-mention у края экрана открывает popup, а не перелистывает
4. Созданная заметка сразу отображается визуально, без необходимости создавать вторую
   **Plans:** 3/3 plans complete

Plans:
- [x] 19.1-01-PLAN.md -- Inline styles fix, непрозрачные drawer-ы, elementFromPoint для edge zones
- [x] 19.1-02-PLAN.md -- Race condition в annotation rendering: bookmarksRef + дифференцированный debounce
- [x] 19.1-03-PLAN.md -- Gap closure: CSS override fix, iframe coordinate conversion, раздельные debounce-таймеры

### Phase 19.2: Мобильные баги ридера: touch selection, iframe координаты, annotation timing (INSERTED)

**Goal:** Исправление 3 UAT-багов на основе глубокого исследования: (1) BUG-1 — подавление Chrome Touch to Search + selectstart в iframe; (2) BUG-5 — убрать двойное вычитание iframe offset для координат; (3) BUG-4 — hooks.content вместо rendered event + debounce для аннотаций
**Depends on:** Phase 19.1
**Requirements**: BUG-1, BUG-4, BUG-5
**Success Criteria** (what must be TRUE):

1. Короткий тап (<300ms) по тексту НЕ вызывает выделение и Chrome Touch to Search
2. Long-press (>300ms) по тексту корректно запускает выделение для создания заметки
3. elementFromPoint использует clientX/clientY напрямую для iframe events (без двойного вычитания)
4. Аннотации появляются сразу при загрузке страницы через hooks.content (без задержки rendered event)
   **Plans:** 2/2 plans complete

Plans:
- [ ] 19.2-01-PLAN.md — BUG-1 selectstart listener + BUG-5 координатная система iframe events
- [ ] 19.2-02-PLAN.md — BUG-4 hooks.content registration для annotation rendering

### Phase 20: Очистка dead code

**Goal**: Удаление устаревшего кода навигации, который заменён новой gesture pipeline
**Depends on**: Phase 16, Phase 18, Phase 19 (все фазы, использующие навигацию, должны быть стабилизированы)
**Requirements**: CLN-01
**Success Criteria** (what must be TRUE):

1. Файлы useTouchNavigation.ts, IOSTapZones.tsx и hook useFollowFingerSwipe.ts удалены из кодовой базы (~38KB)
2. Все тесты проходят, приложение собирается без ошибок после удаления
   **Plans**: TBD

Plans:

- [ ] 20-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 16 -> 17 -> 18 -> 19 -> 19.1 -> 19.2 -> 19.3 -> 20
(Phase 17 может начаться параллельно с Phase 16)

| Phase                                     | Milestone | Plans Complete | Status      | Completed  |
| ----------------------------------------- | --------- | -------------- | ----------- | ---------- |
| 1. Безопасность продакшена                | v1.0      | 2/2            | Complete    | 2026-03-01 |
| 2. Очистка мертвого кода                  | v1.0      | 2/2            | Complete    | 2026-03-01 |
| 3. Миграция сервисов                      | v1.0      | 4/4            | Complete    | 2026-03-01 |
| 4. Обслуживание инфраструктуры            | v1.0      | 3/3            | Complete    | 2026-03-02 |
| 4.1. Фиксы интеграции и ребрендинг        | v1.0      | 3/3            | Complete    | 2026-03-04 |
| 5. Стабилизация AI и техдолг              | v1.0      | 2/2            | Complete    | 2026-03-04 |
| 6. Качество Entity Wiki                   | v1.0      | 2/2            | Complete    | 2026-03-04 |
| 7. Обработка ошибок и UX                  | v1.0      | 2/2            | Complete    | 2026-03-05 |
| 8. Функции ридера                         | v1.0      | 3/3            | Complete    | 2026-03-07 |
| 9. Стабилизация навигации                 | v1.1      | 2/2            | Complete    | 2026-03-09 |
| 10. Follow-finger свайпы                  | v1.1      | 2/2            | Complete    | 2026-03-09 |
| 11. Единый gesture handler и мобильный UI | v1.1      | 3/3            | Complete    | 2026-03-09 |
| 12. Viewport и iOS                        | v1.1      | 2/2            | Complete    | 2026-03-09 |
| 13. PWA и offline                         | v1.1      | 2/2            | Complete    | 2026-03-09 |
| 14. Фикс описаний                         | v1.1      | 2/2            | Complete    | 2026-03-09 |
| 16. Навигация и свайпы                    | v1.2      | 2/2            | Complete    | 2026-03-11 |
| 17. Шапка и панели                        | v1.2      | 5/5            | Complete    | 2026-03-11 |
| 18. Выделение текста и заметки            | v1.2      | 2/2            | Complete    | 2026-03-11 |
| 19. Описания и Entity Popup              | v1.2      | 2/2            | Complete    | 2026-03-11 |
| 19.1. UAT-фиксы                          | v1.2      | 3/3            | Complete    | 2026-03-12 |
| 19.2. Мобильные баги ридера              | v1.2      | 2/2            | Complete    | 2026-03-12 |
| 19.3. ResizeObserver cascade fix          | v1.2      | 1/1            | Complete    | 2026-03-12 |
| 20. Очистка dead code                     | v1.2      | 0/1            | Not started | -          |
