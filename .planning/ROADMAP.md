# Дорожная карта: fancai

## Milestones

- v1.0 Готовность к продакшену (shipped 2026-03-09) -- archived
- v1.1 Reader Mobile / PWA (shipped 2026-03-09) -- archived
- v1.2 Reader Stability & Polish (shipped 2026-03-13) -- archived
- v1.3 iOS Reader Navigation Fixes (in progress)

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

<details>
<summary>v1.2 Reader Stability & Polish (Phases 16-20) -- SHIPPED 2026-03-13</summary>

- [x] Phase 16: Навигация и свайпы (2/2 plans) -- completed 2026-03-11
- [x] Phase 17: Шапка и панели (5/5 plans) -- completed 2026-03-11
- [x] Phase 18: Выделение текста и заметки (2/2 plans) -- completed 2026-03-11
- [x] Phase 19: Описания и Entity Popup (2/2 plans) -- completed 2026-03-11
- [x] Phase 19.1: UAT-фиксы (3/3 plans) -- completed 2026-03-12
- [x] Phase 19.2: Мобильные баги ридера (2/2 plans) -- completed 2026-03-12
- [x] Phase 19.3: ResizeObserver cascade fix (3/3 plans) -- completed 2026-03-12
- [x] Phase 20: Очистка dead code (2/2 plans) -- completed 2026-03-13

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

### v1.3 iOS Reader Navigation Fixes (In Progress)

**Milestone Goal:** Навигация (тапы, свайпы) и выделение текста в ридере работают на iOS Safari, Chrome и PWA standalone так же, как на Android и десктопе

- [x] **Phase 21: Диагностика iOS touch pipeline** - Debug-логирование touch-событий и верификация CSS touch-action на реальном iOS устройстве (completed 2026-03-15)
- [x] **Phase 22: Корневой фикс touch event pipeline** - Полноэкранный iOS overlay с FSM для всех жестов (тапы, свайпы, rubber-band) (completed 2026-03-16)
- [x] **Phase 23: Навигация и iOS overlay ревизия** - Дедупликация FSM, динамический overlay top, верификация на iOS (completed 2026-03-16)
- [ ] **Phase 24: Выделение текста на iOS** - Long-press selection и scroll lock на iOS Safari/Chrome/PWA
- [ ] **Phase 25: Регрессионное тестирование** - Кросс-платформенная верификация: Android + десктоп после всех iOS-фиксов
- [x] **Phase 26: fix(images)** - Исправление багов генерации/отображения изображений, рефакторинг useImageModal на TanStack Query (completed 2026-03-16)

## Phase Details

### Phase 21: Диагностика iOS touch pipeline

**Goal**: Разработчик видит полную картину touch-событий на реальном iOS устройстве и может подтвердить корневую причину блокировки
**Depends on**: Nothing (первая фаза milestone)
**Requirements**: DEBUG-01, DEBUG-02
**Success Criteria** (что должно быть TRUE):

1. DebugPanel (`/?debug=1`) показывает каждый touch/pointer event (touchstart, touchmove, touchend) с координатами, типом и cancelable/defaultPrevented на iOS
2. DebugPanel показывает computed значение CSS `touch-action` для iframe элемента на iOS
3. Baseline данные собраны: видно, какие события доставляются, а какие блокируются capture-phase stopPropagation в useEpubIOSFixes.ts
   **Plans:** 1/1 plans complete

Plans:

- [x] 21-01-PLAN.md — Диагностический hook useTouchDiagnostics + расширение DebugPanel вкладками Touch/CSS

### Phase 22: Корневой фикс touch event pipeline

**Goal**: Полноэкранный iOS overlay обрабатывает ВСЕ touch-жесты (edge taps, center taps, свайпы) через FSM, идентичную iframe handler
**Depends on**: Phase 21
**Requirements**: TOUCH-01, TOUCH-02
**Success Criteria** (что должно быть TRUE):

1. Touch-события обрабатываются iOS overlay и приводят к корректной навигации (taps, swipes) на iOS Safari, Chrome и PWA standalone
2. CSS `touch-action: none` на overlay, `touch-action: pan-x pan-y` на iframe элементах
3. epub.js Snap gesture system остается деактивированной (gestures.destroy() + snap = noop)
   **Plans:** 1/1 plans complete

Plans:

- [x] 22-01-PLAN.md — Расширение iOS overlay до полноэкранного с полной FSM (taps + swipes + rubber-band)

### Phase 23: Навигация и iOS overlay ревизия

**Goal**: Пользователь перелистывает страницы тапами и свайпами на iOS, iOS overlay убран или переработан
**Depends on**: Phase 22
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (что должно быть TRUE):

1. Тап по левому/правому краю страницы перелистывает на предыдущую/следующую страницу на iOS Safari, Chrome и PWA
2. Тап по центру экрана переключает immersive mode (показ/скрытие UI) на iOS
3. Свайп влево/вправо перелистывает страницу с follow-finger анимацией на iOS
4. iOS overlay (gesture-controller-ios-overlay) убран как избыточный, либо переработан для корректной работы со свайпами во всей области экрана
   **Plans:** 2/2 plans complete

Plans:

- [x] 23-01-PLAN.md — Вынос shared FSM в gestureUtils.ts, рефакторинг обоих handler-ов, динамический overlay top, обновление тестов
- [x] 23-02-PLAN.md — UAT на iPhone 15 Pro (8 проверок: taps, swipes, rubber-band, dynamic overlay top)

### Phase 24: Выделение текста на iOS

**Goal**: Пользователь может выделять текст и создавать заметки на iOS так же, как на Android и десктопе
**Depends on**: Phase 23
**Requirements**: SEL-01, SEL-02
**Success Criteria** (что должно быть TRUE):

1. Long-press на тексте в ридере вызывает выделение текста на iOS Safari, Chrome и PWA
2. Drag-ручки выделения работают корректно, текст можно расширять/сужать
3. Scroll lock активируется при выделении текста и снимается при завершении (pointerDown tracking через parent document работает на iOS)
   **Plans**: TBD

Plans:

- [ ] 24-01: TBD

### Phase 25: Регрессионное тестирование

**Goal**: Все iOS-фиксы не ломают навигацию и выделение на Android и десктопе
**Depends on**: Phase 24
**Requirements**: REG-01
**Success Criteria** (что должно быть TRUE):

1. Тапы по краям и центру работают на Android Chrome и десктопных браузерах (Firefox, Chrome, Safari)
2. Свайпы с follow-finger анимацией работают на Android
3. Выделение текста и scroll lock работают на Android и десктопе
4. Существующие автоматические тесты проходят (кроме pre-existing failures: ErrorBoundary 7, auth 1)
   **Plans**: TBD

Plans:

- [ ] 25-01: TBD

### Phase 26: fix(images): исправить баги генерации и отображения изображений в читалке

**Goal:** Исправить 2 бага генерации/отображения изображений в drawer, добавить кнопку регенерации, рефакторинг useImageModal на TanStack Query
**Depends on:** Phase 25
**Requirements**: BUG-01, BUG-02, REGEN, INVALIDATE, MODAL-TQ, BUILD
**Success Criteria** (что должно быть TRUE):

1. Изображение не пропадает при повторном открытии drawer (Баг 1)
2. Чужое изображение не показывается при смене описания (Баг 2)
3. Кнопка "Генерировать заново" при наличии изображения
4. useImageModal использует TQ polling вместо setInterval
5. TypeScript компиляция и production build проходят
   **Plans:** 2/2 plans complete

Plans:

- [ ] 26-01-PLAN.md — Фикс инвалидации query keys + рефакторинг DescriptionDrawer (TQ query, регенерация, сброс мутации) + обновление EpubReader
- [ ] 26-02-PLAN.md — Рефакторинг useImageModal на TanStack Query (useMutation + useQuery polling)

## Progress

**Execution Order:**
Фазы выполняются последовательно: 21 -> 22 -> 23 -> 24 -> 25 -> 26

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
| 19. Описания и Entity Popup               | v1.2      | 2/2            | Complete    | 2026-03-11 |
| 19.1. UAT-фиксы                           | v1.2      | 3/3            | Complete    | 2026-03-12 |
| 19.2. Мобильные баги ридера               | v1.2      | 2/2            | Complete    | 2026-03-12 |
| 19.3. ResizeObserver cascade fix          | v1.2      | 3/3            | Complete    | 2026-03-12 |
| 20. Очистка dead code                     | v1.2      | 2/2            | Complete    | 2026-03-13 |
| 21. Диагностика iOS touch pipeline        | v1.3      | 1/1            | Complete    | 2026-03-15 |
| 22. Корневой фикс touch event pipeline    | v1.3      | Complete       | 2026-03-16  | 2026-03-16 |
| 23. Навигация и iOS overlay ревизия       | v1.3      | 2/2            | Complete    | 2026-03-16 |
| 24. Выделение текста на iOS               | v1.3      | 0/?            | Not started | -          |
| 25. Регрессионное тестирование            | v1.3      | 0/?            | Not started | -          |
| 26. fix(images)                           | 2/2       | Complete       | 2026-03-16  | -          |
