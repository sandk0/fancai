# Requirements: fancai

**Defined:** 2026-03-10
**Core Value:** Пользователь загружает книгу, читает её, получает AI-глоссарий без спойлеров, видит иллюстрации, делает заметки -- и всё это работает стабильно на любом устройстве.

## v1.2 Requirements

Требования для milestone v1.2 Reader Stability & Polish. Исправление регрессий v1.1 и полировка мобильного UX.

### Навигация

- [x] **NAV-01**: Свайпы перелистывают страницу плавно без дублирования анимации (двухфазная: animate -> navigate -> reset)
- [x] **NAV-02**: Свайп-анимация работает как Apple Books slide -- 60fps, spring с микро-bounce, follow-finger tracking
- [x] **NAV-03**: Пользователь может свайпом перейти к следующей/предыдущей главе на границах текущей главы
- [x] **NAV-04**: Тапы по боковым зонам перелистывают страницу мгновенно (instant scroll) без дёрганой анимации

### Шапка и Layout

- [x] **HDR-01**: Шапка ридера помещается на экран от 320px (iPhone SE) -- overflow menu для второстепенных кнопок
- [x] **HDR-02**: Поле поиска и кнопка закрытия полностью видны на любом экране, крестик не обрезается

### Панели

- [x] **PNL-01**: Панели настроек, оглавления и заметок отображают всё содержимое (Vaul snap points, полная высота)
- [x] **PNL-02**: Клавиатура не открывается автоматически при открытии оглавления

### Выделение и заметки

- [x] **SEL-01**: Пользователь может выделить текст long-press и drag без перехвата gesture controller
- [x] **SEL-02**: Пользователь может создать заметку/выделение из выделенного текста

### Описания и сущности

- [x] **ENT-01**: Popup описания показывает кнопку генерации изображения и полное содержимое
- [ ] **ENT-02**: Тапы на выделенные описания и сущности у краёв экрана не перехватываются навигацией

### Очистка

- [ ] **CLN-01**: Удалён dead code: useTouchNavigation.ts, IOSTapZones.tsx, useFollowFingerSwipe.ts (~38KB)

## v2 Requirements

Отложено на будущие milestone.

### Навигация

- **NAV-v2-01**: Настраиваемые зоны тапов
- **NAV-v2-02**: Haptic feedback при перелистывании

### Описания

- **DSC-v2-01**: Умный парсинг описаний с начала предложения (NLP sentence boundary, spaCy)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Миграция на foliate-js | Проблемы архитектурные, не в библиотеке -- epub.js достаточен |
| 3D curl-анимация | Несовместима с epub.js reflowable + iframe |
| Pinch-to-zoom | epub.js не поддерживает, нативный zoom ОС достаточен |
| Полная переработка gesture controller с нуля | Инкрементальный рефакторинг безопаснее, чем rewrite |

## Traceability

Какие фазы покрывают какие требования. Обновляется при создании roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NAV-01 | Phase 16 | Complete |
| NAV-02 | Phase 16 | Complete |
| NAV-03 | Phase 16 | Complete |
| NAV-04 | Phase 16 | Complete |
| HDR-01 | Phase 17 | Complete |
| HDR-02 | Phase 17 | Complete |
| PNL-01 | Phase 17 | Complete |
| PNL-02 | Phase 17 | Complete |
| SEL-01 | Phase 18 | Complete |
| SEL-02 | Phase 18 | Complete |
| ENT-01 | Phase 19 | Complete |
| ENT-02 | Phase 19 | Pending |
| CLN-01 | Phase 20 | Pending |

**Coverage:**
- v1.2 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
