# Requirements: fancai v1.1

**Defined:** 2026-03-09
**Core Value:** AI-ридер с интерактивной Entity Wiki — загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки — стабильно и качественно на мобильных устройствах.

## v1.1 Requirements

### Навигация

- [x] **NAV-01**: Свайпы плавно следуют за пальцем в реальном времени (follow-finger)
- [x] **NAV-02**: Slide-анимация с spring physics при завершении свайпа
- [x] **NAV-03**: Быстрое пролистывание не смещает страницу (фикс race condition в directScroll)
- [x] **NAV-04**: Навигация не блокируется после отмены генерации изображений и других действий
- [x] **NAV-05**: Единый gesture controller вместо 3 параллельных систем (useSwipeNavigation + useTouchNavigation + IOSTapZones)
- [x] **NAV-06**: Корректная навигация при быстрых тапах (tap debounce / queue)

### Мобильный UI

- [x] **MUI-01**: Все интерактивные элементы имеют минимум 44px touch target
- [x] **MUI-02**: Header/footer автоскрываются при чтении, появляются по тапу в центральной зоне
- [x] **MUI-03**: Панели (entity drawer, settings, оглавление) адаптированы для мобильных экранов
- [x] **MUI-04**: Spring-анимации для открытия/закрытия панелей и drawer
- [x] **MUI-05**: Плавные motion transitions между экранами (библиотека → ридер)
- [x] **MUI-06**: Safe area insets корректно применяются на iOS (notch, home indicator)

### PWA

- [ ] **PWA-01**: Install prompt UI с кастомным баннером
- [ ] **PWA-02**: Graceful offline degradation (UI показывает доступные книги, AI-фичи скрыты)
- [ ] **PWA-03**: Service Worker update management с уведомлением пользователя
- [ ] **PWA-04**: Градуированный reload при возврате из фона (не reload при MIN_BACKGROUND_TIME = 0)
- [ ] **PWA-05**: Полное кэширование EPUB файлов для чтения без интернета

### Viewport и iOS

- [x] **VPT-01**: Корректный viewport на iOS (100dvh, env(safe-area-inset-\*))
- [x] **VPT-02**: Клавиатура не сдвигает контент (VisualViewport API)
- [x] **VPT-03**: PWA standalone mode работает корректно (navigation, status bar)

### Описания AI

- [ ] **DSC-01**: Выделенные описания полностью соответствуют CFI позиции из backend (фикс обрезки)

## v2 Requirements

### Описания AI

- **DSC-v2-01**: Умный парсинг описаний с начала предложения (NLP sentence boundary, spaCy бэкенд)

### Навигация

- **NAV-v2-01**: Настраиваемые зоны тапов (пользователь выбирает layout)
- **NAV-v2-02**: Haptic feedback при перелистывании

## Out of Scope

| Feature                       | Reason                                               |
| ----------------------------- | ---------------------------------------------------- |
| 3D curl-анимация              | Несовместима с epub.js reflowable + iframe           |
| Pinch-to-zoom                 | epub.js не поддерживает, нативный zoom ОС достаточен |
| Push notifications            | Не релевантно для ридера книг                        |
| Нативное мобильное приложение | Web-first подход, PWA покрывает потребности          |
| Платежная система             | Монетизация отложена                                 |

## Traceability

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| NAV-01      | Phase 10 | Complete |
| NAV-02      | Phase 10 | Complete |
| NAV-03      | Phase 9  | Complete |
| NAV-04      | Phase 9  | Complete |
| NAV-05      | Phase 11 | Complete |
| NAV-06      | Phase 9  | Complete |
| MUI-01      | Phase 11 | Complete |
| MUI-02      | Phase 11 | Complete |
| MUI-03      | Phase 11 | Complete |
| MUI-04      | Phase 11 | Complete |
| MUI-05      | Phase 11 | Complete |
| MUI-06      | Phase 11 | Complete |
| PWA-01      | Phase 13 | Pending  |
| PWA-02      | Phase 13 | Pending  |
| PWA-03      | Phase 13 | Pending  |
| PWA-04      | Phase 13 | Pending  |
| PWA-05      | Phase 13 | Pending  |
| VPT-01      | Phase 12 | Complete |
| VPT-02      | Phase 12 | Complete |
| VPT-03      | Phase 12 | Complete |
| DSC-01      | Phase 14 | Pending  |

**Coverage:**

- v1.1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---

_Requirements defined: 2026-03-09_
_Last updated: 2026-03-09 after roadmap creation_
