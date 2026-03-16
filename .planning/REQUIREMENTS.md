# Requirements: fancai v1.3

**Defined:** 2026-03-14
**Core Value:** Навигация и выделение текста в ридере должны работать на iOS так же, как на Android и десктопе

## v1.3 Requirements

Требования для фикса iOS навигации. Каждое привязано к фазам roadmap.

### Диагностика

- [ ] **DEBUG-01**: DebugPanel показывает touch/pointer events с координатами и типом на iOS
- [ ] **DEBUG-02**: DebugPanel показывает computed `touch-action` CSS значение для iframe

### Touch Pipeline

- [x] **TOUCH-01**: Touch events доставляются из iframe к gesture controller на iOS Safari/Chrome/PWA
- [x] **TOUCH-02**: `touch-action` CSS корректно работает на iOS (верификация pan-x pan-y vs manipulation)

### Навигация

- [x] **NAV-01**: Тап по левому/правому краю перелистывает страницу на iOS
- [x] **NAV-02**: Тап по центру переключает immersive mode на iOS
- [x] **NAV-03**: Свайп влево/вправо перелистывает страницу на iOS
- [x] **NAV-04**: iOS overlay ревизия — убрать или починить если избыточен после root cause fix

### Выделение текста

- [ ] **SEL-01**: Long-press выделяет текст на iOS
- [ ] **SEL-02**: Scroll lock работает при выделении текста на iOS

### Регрессия

- [ ] **REG-01**: Навигация (тапы + свайпы) продолжает работать на Android и десктопе после всех изменений

### Изображения (Phase 26)

- [ ] **BUG-01**: Изображение не пропадает при повторном открытии drawer после генерации
- [ ] **BUG-02**: Чужое изображение не показывается при смене описания в drawer
- [ ] **REGEN**: Кнопка "Генерировать заново" при наличии существующего изображения
- [ ] **INVALIDATE**: TanStack Query cache корректно инвалидируется при генерации (byBook + byDescription + userStats)
- [x] **MODAL-TQ**: useImageModal использует TanStack Query polling вместо setInterval
- [x] **BUILD**: TypeScript компиляция и production build проходят после всех изменений

## v2 Requirements

### Навигация

- **NAV-v2-01**: Настраиваемые зоны тапов
- **NAV-v2-02**: Haptic feedback при перелистывании

### Описания

- **DSC-v2-01**: Умный парсинг описаний с начала предложения (NLP sentence boundary, spaCy)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Поддержка iOS < 18 | Фокус на актуальной iOS 26.3.1, обратная совместимость — backlog |
| iOS Simulator тестирование | Только реальное устройство (iPhone 15 Pro) |
| Переписывание epub.js gesture system | Минимальный фикс (удаление blockers), не переписывание |
| Pointer Events API миграция | Исследование показало, что touch events достаточны после фикса |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBUG-01 | Phase 21 | Pending |
| DEBUG-02 | Phase 21 | Pending |
| TOUCH-01 | Phase 22 | Complete |
| TOUCH-02 | Phase 22 | Complete |
| NAV-01 | Phase 23 | Complete |
| NAV-02 | Phase 23 | Complete |
| NAV-03 | Phase 23 | Complete |
| NAV-04 | Phase 23 | Complete |
| SEL-01 | Phase 24 | Pending |
| SEL-02 | Phase 24 | Pending |
| REG-01 | Phase 25 | Pending |
| BUG-01 | Phase 26 | Pending |
| BUG-02 | Phase 26 | Pending |
| REGEN | Phase 26 | Pending |
| INVALIDATE | Phase 26 | Pending |
| MODAL-TQ | Phase 26 | Complete |
| BUILD | Phase 26 | Complete |

**Coverage:**
- v1.3 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-16 after Phase 26 planning*
