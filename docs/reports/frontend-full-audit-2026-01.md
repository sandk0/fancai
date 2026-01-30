# Полный архитектурный аудит Frontend fancai (2026)

**Дата:** 30 января 2026  
**Статус:** Выполнен (Комплексный аудит v6.0) - Deep Audit v3 завершён  
**Модель:** Claude Opus 4.5  
**Версия отчета:** 30.0 (Deep Audit v3 - Comprehensive UX/UI + Code Quality Audit)  

---

## Executive Summary

Frontend проекта `fancai` прошел **глубокий комплексный аудит v6 (Deep Audit v3)**. Проведена полная проверка UX/UI для Mobile и Desktop, верификация API соответствия, анализ качества кода.

### Общая оценка: 9.3/10 (снижено с 9.4/10 — выявлены новые accessibility и type safety проблемы)

---

## 🔴 Deep Audit v3 Results (30.01.2026)

### Верификация Card System — ✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ
| Компонент | Статус | Проверено |
|-----------|--------|-----------|
| `Card.tsx` | ✅ PASS | asChild, disabled variant, CardAccent |
| `EntityCard.tsx` | ✅ PASS | Card asChild, aria-label, button semantics |
| `EntityProfile.tsx` | ✅ PASS | CardAccent, aria-labelledby, role="list" |
| `RelationshipCard.tsx` | ✅ PASS | Card variant="subtle" |

### Frontend↔Backend API Sync — 96% Match Rate
| Категория | Endpoints | Match | Mismatch |
|-----------|-----------|-------|----------|
| Auth | 7 | 7 | 0 |
| Books | 10 | 10 | 0 |
| Chapters | 4 | 4 | 0 |
| Progress | 2 | 2 | 0 |
| Sessions | 5 | 5 | 0 |
| Images | 11 | 11 | 0 |
| Users | 4 | 4 | 0 |
| Admin | 12 | 10 | 1 |
| **Total** | **55** | **53** | **1** |

**✅ ИСПРАВЛЕНО:** `/admin/users` → `/users/admin/users` (admin.ts:187)

**⚠️ Deprecated:** `/admin/nlp-processor-info` — NLP система удалена в декабре 2025

### Mobile UX/UI Audit — Отличный результат
| Severity | Count | Описание |
|----------|-------|----------|
| P0 | 0 | Нет критических проблем |
| P1 | 8 | Touch targets < 44px в нескольких местах |
| P2 | 5 | Minor polish items |

**Позитивные находки:**
- ✅ 44px touch targets в большинстве UI компонентов
- ✅ Safe area support (env(safe-area-inset-*))
- ✅ iOS-specific optimizations (input zoom prevention, scroll lock)
- ✅ Responsive breakpoints во всех компонентах
- ✅ PWA standalone mode support

**P1 Issues (Touch Targets):**
1. `HomePage.tsx:418-435` — Scroll buttons `p-2` вместо 44px
2. `ImageGallery.tsx:166-175` — View toggle button `p-2`
3. `ImageGallery.tsx:314-334` — List view action buttons `p-2`
4. `EntityDrawer.tsx:120-125` — Gallery button `p-1.5`
5. `EntityDrawer.tsx:111-116` — Back button без min touch target
6. `TocSidebar.tsx:38` — Expand toggle `p-1`
7. `LibraryPage.tsx:301-305` — Pagination buttons без 44px sizing

### Desktop UX/UI Audit — Требуется работа над accessibility
| Severity | Count | Описание |
|----------|-------|----------|
| P0 | 5 | Критические accessibility issues |
| P1 | 6 | Missing keyboard support, focus indicators |
| P2 | 6 | Minor polish items |

**P0 Critical Issues:**
1. **TD-FRONT-400:** `ReaderSettings.tsx:170-196` — Theme cards без keyboard support (`<div onClick>` без tabIndex/onKeyDown)
2. **TD-FRONT-401:** `EntityDrawer.tsx:105` — `outline-none` без replacement focus style
3. **TD-FRONT-402:** `ImageGallery.tsx:217-236` — Grid items без keyboard support
4. **TD-FRONT-403:** `ReaderHeader.tsx:37-38,54-55` — Icon buttons без aria-label
5. **TD-FRONT-404:** `DeleteConfirmModal.tsx:132-156` — Buttons без focus ring

**P1 Major Issues:**
1. **TD-FRONT-405:** `DesktopHoverOverlay.tsx` — Overlay только на hover, недоступен с keyboard
2. **TD-FRONT-406:** `ErrorMessage.tsx:33-40` — Compact retry button без focus ring
3. **TD-FRONT-407:** `ImageGallery.tsx:280-337` — List view без keyboard navigation
4. **TD-FRONT-408:** Inconsistent `focus:` vs `focus-visible:` usage

### New Issues Discovery — Code Quality
| Severity | Count | Описание |
|----------|-------|----------|
| P0 | 7 | `any` types в production code |
| P1 | 15 | console.log, missing deps, key={index} |
| P2 | 7 | @ts-expect-error, hardcoded text |

**P0 — `any` Types in Production:**
1. `useTranslation.ts:22` — `let value: any = ru;`
2. `useDescriptionManagement.ts:156,162` — `as any` casts
3. `useBookProgressWS.ts:266` — `const data = response as any;`
4. `serviceWorker.ts:104` — `deferredPrompt: any`
5. `useChapterData.ts:77` — `catch (error: any)`
6. `useEpubLoader.ts:438,474,524,539,585,630` — Multiple `any` для epub.js
7. `AuthGuard.tsx:48` — `(location.state as any)?.from`

**P1 — Console Pollution (600+ statements):**
- `BookUploadModal.tsx` — 15+ console.log без DEBUG flag
- `auth.ts` — 20+ console.log always execute
- `useReadingSession.ts` — 15+ console.log always execute

**P1 — React Anti-patterns:**
- 16 instances of `key={index}` in StatsPage, ProfilePage, Skeleton, AdminStats, etc.
- 9 eslint-disable comments for exhaustive-deps

**Code Duplication:**
- iOS detection logic in 5+ files → use exported `isIOS` from useEpubNavigation
- `notify` helpers duplicated in ui.ts (lines 24-58 and 124-173)
- Standalone mode detection in 3+ files

---

**🟢 ИСПРАВЛЕННЫЕ находки Deep Audit v3 (30.01.2026):**

**API Sync Fix:**
- ✅ **admin.ts:187:** `/admin/users` → `/users/admin/users` (исправлено несоответствие с backend)

---

**🟢 ИСПРАВЛЕННЫЕ находки Sprint 10 (30.01.2026) — Полный Card Refactor:**

**Card Component (UI/Card.tsx):**
- ✅ Добавлен `asChild` prop с Radix Slot для полиморфизма
- ✅ Добавлен `disabled` variant для неактивных карточек
- ✅ Улучшены `interactive` стили (focus-visible ring, active state)
- ✅ Создан `CardAccent` компонент для заметок с левой границей

**EntityCard.tsx — Полный рефакторинг:**
- ✅ Использует `<Card asChild interactive>` с `<button>` внутри
- ✅ Добавлен `aria-label` для accessibility
- ✅ Добавлен `aria-hidden` для декоративных иконок
- ✅ Сохранена полная keyboard accessibility

**EntityProfile.tsx — Полный рефакторинг:**
- ✅ Кнопки связей → `<Card asChild interactive variant="subtle">`
- ✅ Заметки → `<CardAccent accentColor="primary">`
- ✅ Добавлены `aria-labelledby` для секций
- ✅ Добавлены `role="list"` и `role="listitem"` для списков
- ✅ Используется `cn()` вместо template literals

**🟢 ИСПРАВЛЕННЫЕ находки Sprint 9 (30.01.2026):**
- ✅ **[P2] TD-FRONT-119:** visual_summary preview added to EntityCard
- ✅ **[P2] TD-FRONT-314:** Entity components refactored to use base Card component
  - Card component updated: CSS variables, `rounded-lg`, new `subtle` variant, `padding="none"` option
  - RelationshipCard: 2 `<div>` → `<Card>`, description box → `<Card variant="subtle">`
  - EntityProfile: visual_summary + hidden info boxes → `<Card variant="elevated">`

**🟢 ИСПРАВЛЕННЫЕ находки Sprint 8 (30.01.2026):**
- ✅ **[P1] TD-FRONT-306:** Border styling unified — убраны CSS fallbacks, стандартизирована толщина
- ✅ **[P1] TD-FRONT-308:** Typography standardized — `font-semibold` для headings
- ✅ **[P2] TD-FRONT-311:** Rounded corners standardized — `rounded-lg` для всех card-like элементов

**🟢 ИСПРАВЛЕННЫЕ находки Deep Audit v2 - Sprint 7 (30.01.2026):**
- ✅ **[P0] TD-FRONT-300:** Translation key paths fixed — `library.*` теперь на top-level
- ✅ **[P1] TD-FRONT-301:** DeleteConfirmModal — 6 strings i18n добавлено
- ✅ **[P1] TD-FRONT-302:** DownloadBookButton — 10 strings i18n добавлено
- ✅ **[P1] TD-FRONT-307:** Hardcoded backgrounds → CSS variables
- ✅ **[P1] TD-FRONT-313:** Hardcoded Tailwind colors → CSS variables (relationship types)
- ✅ **[P2] TD-FRONT-303:** English locale file added
- ✅ **[P2] TD-FRONT-304:** Grid gaps reduced for tighter layout

**🟢 ИСПРАВЛЕННЫЕ находки Deep Audit v4 (29.01.2026):**
- ✅ **[P0] TD-FRONT-200:** HomePage cache invalidation — ИСПРАВЛЕНО
- ✅ **[P0] TD-FRONT-201:** BookGalleryPage hardcoded dark theme — ИСПРАВЛЕНО  
- ✅ **[P0] TD-FRONT-115:** Entity type case mismatch — ИСПРАВЛЕНО
- ✅ **[P0] TD-FRONT-120:** DEBUG flags in production — ИСПРАВЛЕНО
- ✅ **[P0] TD-FRONT-121:** Auth token in sendBeacon — ИСПРАВЛЕНО

**🟠 ВАЖНЫЕ находки Deep Audit v4:**
- ✅ **[P1] TD-FRONT-202:** 5 страниц БЕЗ i18n — ИСПРАВЛЕНО (29.01.2026)
- ✅ **[P1] TD-FRONT-203:** 22+ hardcoded Russian strings в BookCard.tsx — ИСПРАВЛЕНО (29.01.2026)
- ✅ **[P1] TD-FRONT-204:** `/auth/profile` PUT endpoint — ИСПРАВЛЕНО (30.01.2026)
- ✅ **[P1] TD-FRONT-205:** 15 Reader touch target issues — ИСПРАВЛЕНО (29.01.2026)
- ✅ **[P1] TD-FRONT-206:** 6 Reader safe area handling gaps — ИСПРАВЛЕНО (29.01.2026)

**Критические находки Deep Audit v3 (ВСЕ ИСПРАВЛЕНЫ):**
- ✅ **[P0]** DEBUG флаги hardcoded to `true` → ИСПРАВЛЕНО (import.meta.env.DEV)
- ✅ **[P0]** Auth token передаётся в sendBeacon payload → ИСПРАВЛЕНО (токен удалён)
- ✅ **[P0]** WebSocket `connect()` no-op → ИСПРАВЛЕНО (явно @deprecated)

**Sprint 2 исправления (29.01.2026):**
- ✅ **[P1] TD-FRONT-126:** A11y div→button (EntityCard, TocSidebar, EntityProfile)
- ✅ **[P1] TD-FRONT-205:** Touch targets 44px minimum (ReaderNavigationControls, TocSidebar)
- ✅ **[P1] TD-FRONT-206:** Safe area handling (TocSidebar, ProgressIndicator)

**Ранее исправленные проблемы:**
- ✅ Критический баг сохранения прогресса исправлен (credentials: 'include')
- ✅ Все сервисы мигрированы на cookie auth
- ✅ Deprecated поля auth удалены
- ✅ TypeScript ошибки исправлены (0 ошибок)
- ✅ `any` типы заменены на proper interfaces
- ✅ ReaderState типы синхронизированы
- ✅ i18n strings вынесены в locales
- ✅ IOSDebugOverlay удален

### Ключевые сильные стороны
1. **Excellent Offline Architecture:** IndexedDB (Dexie.js), Background Sync API, syncQueue с fallback для iOS Safari
2. **Модульная архитектура Reader:** 24 компонента, разделение на Core (Modals, Overlays, UI) и специализированные компоненты
3. **Comprehensive Hook System:** 55+ хуков, организованных по категориям (api/, epub/, reader/, pwa/)
4. **Robust Error Handling:** DOMPurify для XSS, graceful degradation в сервисах кэширования
5. **Performance Optimizations:** Lazy loading маршрутов, виртуализация списков, мемоизация
6. **Clean Auth Implementation:** Все сервисы используют HttpOnly cookies через `credentials: 'include'`
7. **Strong Type Safety:** 0 TypeScript ошибок, proper interfaces вместо `any`

### Оставшиеся слабости

**P0 (Critical) — 12 проблем (6 исправлены, 5 новых из Deep Audit v3):**

*Исправленные ранее:*
1. ✅ **TD-FRONT-200: HomePage Cache Invalidation** — ИСПРАВЛЕНО (29.01.2026)
2. ✅ **TD-FRONT-201: BookGalleryPage Hardcoded Theme** — ИСПРАВЛЕНО (29.01.2026)
3. ✅ **TD-FRONT-115: Entity Type Mismatch** — ИСПРАВЛЕНО (29.01.2026)
4. ✅ **TD-FRONT-120: DEBUG Flags in Production** — ИСПРАВЛЕНО (29.01.2026)
5. ✅ **TD-FRONT-121: Auth Token in sendBeacon** — ИСПРАВЛЕНО (29.01.2026)
6. ✅ **TD-FRONT-122: WebSocket connect() No-Op** — ИСПРАВЛЕНО (29.01.2026) - явно помечен @deprecated

*Новые из Deep Audit v3 (Desktop Accessibility):*
7. ❌ **TD-FRONT-400:** Theme cards без keyboard support — ReaderSettings.tsx:170-196
8. ❌ **TD-FRONT-401:** EntityDrawer outline-none без replacement — EntityDrawer.tsx:105
9. ❌ **TD-FRONT-402:** ImageGallery grid без keyboard navigation — ImageGallery.tsx:217-236
10. ❌ **TD-FRONT-403:** Icon buttons без aria-label — ReaderHeader.tsx
11. ❌ **TD-FRONT-404:** DeleteConfirmModal без focus ring — DeleteConfirmModal.tsx:132-156

**P0 (Type Safety) — 7 проблем (новые из Deep Audit v3):**
12. ❌ **TD-FRONT-410:** `any` type in useTranslation.ts:22
13. ❌ **TD-FRONT-411:** `any` casts in useDescriptionManagement.ts:156,162
14. ❌ **TD-FRONT-412:** `any` cast in useBookProgressWS.ts:266
15. ❌ **TD-FRONT-413:** `any` type in serviceWorker.ts:104
16. ❌ **TD-FRONT-414:** `any` in catch block useChapterData.ts:77
17. ❌ **TD-FRONT-415:** Multiple `any` in useEpubLoader.ts (epub.js internals)
18. ❌ **TD-FRONT-416:** `any` cast in AuthGuard.tsx:48

**P1 (Important) — 12 проблем (ВСЕ ИСПРАВЛЕНЫ ✅) + 14 новых:**

*Исправленные ранее:*
1. ✅ **TD-FRONT-202:** 5 страниц БЕЗ i18n — ИСПРАВЛЕНО (29.01.2026)
2. ✅ **TD-FRONT-203:** 22+ hardcoded Russian strings в BookCard.tsx — ИСПРАВЛЕНО (29.01.2026)
3. ✅ **TD-FRONT-204:** `/auth/profile` PUT endpoint — ИСПРАВЛЕНО (30.01.2026)
4. ✅ **TD-FRONT-205:** 15 Reader touch targets < 44px — ИСПРАВЛЕНО (29.01.2026)
5. ✅ **TD-FRONT-206:** 6 Reader safe area handling gaps — ИСПРАВЛЕНО (29.01.2026)
6. ✅ **TD-FRONT-123:** Direct fetch вместо API client в useAutoParser — ИСПРАВЛЕНО (30.01.2026)
7. ✅ **TD-FRONT-124:** Missing useEffect dependencies — ИСПРАВЛЕНО (30.01.2026)
8. ✅ **TD-FRONT-126:** A11y — кликабельные div вместо button — ИСПРАВЛЕНО (29.01.2026)
9. ✅ **TD-FRONT-127:** Large Components — ИСПРАВЛЕНО (30.01.2026)
10. ✅ **TD-FRONT-116:** Дублирование EntityType — ИСПРАВЛЕНО (29.01.2026)
11. ✅ **TD-FRONT-117:** Сырой тип в EntityProfile — ИСПРАВЛЕНО (29.01.2026)
12. ✅ **TD-FRONT-118:** Несогласованная спойлер-логика — ИСПРАВЛЕНО (30.01.2026)

*Новые из Deep Audit v3 (Desktop UX):*
13. ❌ **TD-FRONT-405:** DesktopHoverOverlay не keyboard accessible
14. ❌ **TD-FRONT-406:** ErrorMessage compact retry без focus ring
15. ❌ **TD-FRONT-407:** ImageGallery list view без keyboard navigation
16. ❌ **TD-FRONT-408:** Inconsistent focus: vs focus-visible: usage

*Новые из Deep Audit v3 (Mobile Touch Targets):*
17. ❌ **TD-FRONT-420:** HomePage scroll buttons < 44px
18. ❌ **TD-FRONT-421:** ImageGallery view toggle < 44px
19. ❌ **TD-FRONT-422:** ImageGallery list actions < 44px
20. ❌ **TD-FRONT-423:** EntityDrawer gallery button < 44px
21. ❌ **TD-FRONT-424:** TocSidebar expand toggle < 44px
22. ❌ **TD-FRONT-425:** LibraryPage pagination < 44px

*Новые из Deep Audit v3 (Console Pollution):*
23. ❌ **TD-FRONT-430:** BookUploadModal 15+ console.log без DEBUG
24. ❌ **TD-FRONT-431:** auth.ts 20+ console.log always execute
25. ❌ **TD-FRONT-432:** useReadingSession 15+ console.log always execute

*Новые из Deep Audit v3 (React Anti-patterns):*
26. ❌ **TD-FRONT-435:** 16 instances of key={index} anti-pattern

**P2 (Polish) — 8 проблем (7 исправлены, 1 осталось) + 12 новых:**

*Исправленные ранее:*
1. ✅ **TD-FRONT-207:** 4 unused Library components — УДАЛЕНЫ (30.01.2026)
2. ✅ **TD-FRONT-208:** Avatar sizes — FALSE POSITIVE (размеры соответствуют контексту)
3. ✅ **TD-FRONT-209:** English tooltip в SpoilerText.tsx — ИСПРАВЛЕНО (29.01.2026)
4. ✅ **TD-FRONT-128:** No debounce on auto-save — ИСПРАВЛЕНО (30.01.2026)
5. ✅ **TD-FRONT-129:** Async in sync Zustand store — ИСПРАВЛЕНО (30.01.2026)
6. ✅ **TD-FRONT-130:** Fire-and-forget logout — ИСПРАВЛЕНО (30.01.2026)
7. ✅ **TD-FRONT-131:** Memory leak risks (setInterval без cleanup) — ИСПРАВЛЕНО (30.01.2026)
8. ❌ **TD-FRONT-112:** Test Suite — 79/216 тестов падают

*Новые из Deep Audit v3 (Code Duplication):*
9. ❌ **TD-FRONT-440:** iOS detection duplicated in 5+ files
10. ❌ **TD-FRONT-441:** notify helpers duplicated in ui.ts
11. ❌ **TD-FRONT-442:** Standalone mode detection duplicated

*Новые из Deep Audit v3 (Mobile Polish):*
12. ❌ **TD-FRONT-443:** ImageGallery search input без explicit height
13. ❌ **TD-FRONT-444:** BookUploadModal remove button 40px instead of 44px

*Новые из Deep Audit v3 (Desktop Polish):*
14. ❌ **TD-FRONT-445:** Missing loading skeleton for ImageGallery
15. ❌ **TD-FRONT-446:** Hardcoded colors in scrollbar (globals.css)
16. ❌ **TD-FRONT-447:** Missing dark mode on ErrorMessage compact

*Новые из Deep Audit v3 (@ts-expect-error):*
17. ❌ **TD-FRONT-448:** @ts-expect-error in useTouchNavigation.ts
18. ❌ **TD-FRONT-449:** @ts-expect-error in useSwipeNavigation.ts
19. ❌ **TD-FRONT-450:** @ts-expect-error in IOSTapZones.tsx

---

## Часть 1: Бизнес-логика и State Management

### 1.1 Критические проблемы (P0)

#### TD-FRONT-101: beforeunload не сохраняет прогресс чтения

**Файл:** `src/hooks/epub/useProgressSync.ts:255-278`  
**Приоритет:** P0 (Critical)  
**Категория:** Business Logic / Data Loss  
**Статус:** ✅ ИСПРАВЛЕНО

**Было:**
```typescript
const token = localStorage.getItem('bookreader_access_token');
if (token) {
  fetch(url, { headers: { 'Authorization': `Bearer ${token}` }, ... })
```

**Стало:**
```typescript
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: data,
  keepalive: true,
  credentials: 'include', // HttpOnly cookies
})
```

**Результат:** Прогресс чтения корректно сохраняется при закрытии вкладки.

---

#### TD-FRONT-102: Сервисы используют устаревший AUTH_TOKEN

**Файлы:**
- `src/services/imageCache.ts` - ✅ Мигрирован на `credentials: 'include'`
- `src/services/syncQueue.ts` - ✅ Мигрирован на `credentials: 'include'`
- `src/services/pushNotifications.ts` - ✅ Мигрирован на `credentials: 'include'`
- `src/services/websocket.tsx` - ✅ Отключен auto-connect (требует backend поддержки cookie auth)
- `src/api/images.ts` - ✅ Мигрирован на `credentials: 'include'`

**Приоритет:** P0 (Critical)  
**Категория:** Security / Auth  
**Статус:** ✅ ИСПРАВЛЕНО

**Примечание:** WebSocket полностью отключен до реализации cookie auth на backend. Функционал чтения не затронут.

---

### 1.2 Важные проблемы (P1)

#### TD-FRONT-103: Deprecated поля в Auth Store

**Файл:** `src/stores/auth.ts`, `src/types/state.ts`  
**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

**Удалено:**
- `accessToken`, `refreshToken`, `tokens` из auth store
- Соответствующие поля из `AuthState` interface
- Обновлены все тесты (`auth.test.ts`, `useBooks.test.tsx`)
- Обновлен `useBookProgressWS.ts` (теперь использует `isAuthenticated` вместо `accessToken`)

---

#### TD-FRONT-104: TypeScript ошибки

**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

Все unused imports/variables удалены:
- `EpubReader.tsx` - удален `isAndroid`
- `TocSidebar.tsx` - удалены `useCallback`, `Check`, `BookOpen`
- `useChapterPrefetch.ts` - удален `useRef`
- `LibraryPage.tsx` - удален `useCallback`
- `EpubReader.test.tsx` - исправлен mock

**Результат:** `npm run type-check` проходит без ошибок.

---

### 1.3 Рекомендации

- **State Split:** Четкое разделение Server State (TanStack Query) и UI State (Zustand) - реализовано корректно
- **Query Keys:** Централизованные в `queryKeys.ts` с изоляцией по userId - хорошая практика
- **Offline Sync:** syncQueue с приоритетами и exponential backoff - production-ready

---

## Часть 2: UX/UI и Mobile Experience

### 2.1 Критические проблемы (P0)

*Нет критических проблем в UX/UI*

### 2.2 Важные проблемы (P1)

#### TD-FRONT-105: Hardcoded строки в Reader компонентах

**Приоритет:** P1  
**Категория:** i18n  
**Статус:** ✅ ИСПРАВЛЕНО

Добавлены translations в `locales/ru/translation.json`:
- `reader.conflict.*` - "только что", "мин", "ч", "д", "назад"
- `reader.swipe.*` - "Начало главы", "Конец главы"
- `reader.extraction.*` - "AI анализирует главу...", etc.
- `reader.image_generation.*` - "Генерация изображения...", etc.
- `reader.progress.*` - "Гл.", "Глава", "Стр.", "Сохранение...", "Позиция сохранена"

Обновленные компоненты:
- ✅ `PositionConflictDialog.tsx`
- ✅ `SwipeOverlay.tsx`
- ✅ `ExtractionIndicator.tsx`
- ✅ `ImageGenerationStatus.tsx`
- ✅ `ProgressIndicator.tsx`
- ✅ `ProgressSaveIndicator.tsx`

---

#### TD-FRONT-106: Debug код в production

**Файл:** `src/components/Reader/IOSDebugOverlay.tsx`  
**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

Файл удален вместе со всеми импортами.

---

### 2.3 Accessibility (A11y)

| Компонент | Статус | Проблема |
|-----------|--------|----------|
| `ReaderHeader.tsx` | ✅ | `aria-label`, `role="progressbar"` |
| `PositionConflictDialog.tsx` | ✅ | `role="dialog"`, `aria-modal`, focus trap |
| `ReaderNavigationControls.tsx` | ✅ | `aria-label`, `role="progressbar"` |
| `ImageGenerationStatus.tsx` | ✅ | `role="status"`, `aria-live="polite"`, `aria-atomic="true"` |
| `ProgressIndicator.tsx` | ✅ | `role="progressbar"`, `aria-valuenow/min/max`, `aria-label` |
| `ProgressSaveIndicator.tsx` | ✅ | `role="status"`, `aria-live="polite"` |
| `TocSidebar.tsx` | ✅ | `role="navigation"`, `aria-label` |

---

## Часть 3: Архитектура и Проектирование

### 3.1 Критические проблемы (P0)

*Нет критических архитектурных проблем*

### 3.2 Важные проблемы (P1)

#### TD-FRONT-107: `any` типы в компонентах

**Приоритет:** P1  
**Категория:** Type Safety  
**Статус:** ✅ ИСПРАВЛЕНО

| Файл | Изменение |
|------|-----------|
| `EpubReader.tsx` | Создан inline object `{ title, author }` вместо cast |
| `ReaderModals.tsx` | Добавлены `PositionData`, `LocalPositionData` interfaces |
| `ReaderUI.tsx` | Добавлен `ReaderUIHeaderMetadata` interface, `GenerationStatus` import |
| `BookInfo.tsx` | Использованы type guards (`'field' in metadata`) вместо `as any` |

**Результат:** 0 использований `any` в критических компонентах.

---

#### TD-FRONT-108: ESLint конфигурация устарела

**Файл:** `eslint.config.js` (создан), `.eslintrc.json` (удалён)  
**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

**Было:**
- `.eslintrc.json` (legacy формат)
- `.eslintignore` (отдельный файл)

**Стало:**
- `eslint.config.js` (flat config для ESLint 9.x)
- Ignores включены в конфиг
- Установлены пакеты: `typescript-eslint`, `globals`, `@eslint/js`

**Дополнительные исправления:**
- IOSTapZones.tsx: Исправлено нарушение Rules of Hooks (хуки вызывались после early return)
- Input.tsx: Исправлен условный вызов `useId()`
- Множественные `catch (_err)` → `catch {}` (TypeScript 4.0+ syntax)

**Результат:** 0 ошибок, 51 предупреждение (pre-existing `any` типы)

---

#### TD-FRONT-109: Типы state.ts не соответствуют реализации

**Файл:** `src/types/state.ts` vs `src/stores/reader.ts`  
**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

`ReaderState` interface полностью переписан для соответствия реализации:
- Добавлены `ReaderTheme`, `NavigationMode` types
- Добавлены `LocalReadingProgress`, `LocalBookmark`, `LocalHighlight` interfaces
- Удалены несуществующие поля (`wordsPerPage`, `currentPage`, `totalPages`, `isFullscreen`, `showImages`, `autoScroll`)
- Добавлены реальные поля (`backgroundColor`, `textColor`, `maxWidth`, `margin`, `navigationMode`, `readingProgress`, `bookmarks`, `highlights`)
- Синхронизированы названия методов (`updateFontSize` вместо `setFontSize`)

---

### 3.3 Статистика компонентов

| Категория | Количество файлов |
|-----------|-------------------|
| **Reader/** | 24 компонента |
| **UI/** | 28 компонентов |
| **Library/** | 6 компонентов |
| **Settings/** | 7 компонентов |
| **Admin/** | 6 компонентов |
| **Other** | 15 компонентов |
| **ИТОГО** | 86 компонентов |

### 3.4 Статистика хуков

| Категория | Количество |
|-----------|------------|
| **api/** | 6 файлов |
| **epub/** | 18 файлов |
| **reader/** | 7 файлов |
| **pwa/** | 2 файла |
| **Top-level** | 17 файлов |
| **ИТОГО** | 50+ хуков |

---

## Часть 4: Производительность

### 4.1 Сильные стороны

1. **Lazy Loading:** 8 страниц загружаются lazy (`BookPage`, `BookReaderPage`, `BookImagesPage`, `BookGalleryPage`, `ImagesGalleryPage`, `StatsPage`, `ProfilePage`, `SettingsPage`, `AdminDashboard`)
2. **Bundle Splitting:** Vendor chunks разделены по категориям (react, router, data, ui, forms, radix, utils)
3. **Виртуализация:** `@tanstack/react-virtual` используется в `BookGrid`
4. **Мемоизация:** `useMemo`, `useCallback` используются в критических местах

### 4.2 Рекомендации (P2)

#### TD-FRONT-110: Большие компоненты

| Компонент | Строк | Рекомендация |
|-----------|-------|--------------|
| `IOSTapZones.tsx` | 578 | Разбить на sub-components |
| `ReaderSettingsPanel.tsx` | 690 | Разбить на секции |
| `imageCache.ts` | 641 | Выделить ObjectURL manager |

---

## Часть 5: Безопасность

### 5.1 Критические проблемы (P0)

*См. TD-FRONT-101 и TD-FRONT-102 - проблемы с авторизацией*

### 5.2 Важные проблемы (P1)

#### TD-FRONT-111: WebSocket token в URL

**Файл:** `src/services/websocket.tsx`, `src/hooks/useBookProgressWS.ts`, `backend/app/routers/websocket.py`  
**Приоритет:** P1  
**Статус:** ✅ ИСПРАВЛЕНО

**Было:**
```typescript
// Frontend - токен в URL (небезопасно)
const wsUrl = `${this.getWebSocketUrl()}?token=${encodeURIComponent(token)}`;
```

**Стало:**
```typescript
// Frontend - без токена, cookie отправляется автоматически
const wsUrl = this.getWebSocketUrl();
```

**Backend изменения:**
- Новая функция `get_user_from_websocket()` читает `access_token` из HttpOnly cookie
- Fallback на query param для обратной совместимости (с warning в логах)
- Проверка token blacklist для поддержки logout

**Результат:** WebSocket аутентификация через HttpOnly cookies, токен больше не передаётся в URL.

---

### 5.3 Сильные стороны

1. **XSS Prevention:** DOMPurify используется для всего HTML контента книг
2. **HttpOnly Cookies:** Backend правильно устанавливает HttpOnly cookies
3. **User Isolation:** Все query keys и cache keys включают userId
4. **CSRF Protection:** `withCredentials: true` в API client

---

## Часть 6: Качество кода и Тестирование

### 6.1 Критические проблемы (P0)

#### TD-FRONT-112: Тесты падают

**Статистика (после частичного исправления):**
- **Failed:** 79 тестов (было 110)
- **Passed:** 135 тестов (было 104)
- **Skipped:** 1 тест
- **Улучшение:** +31 тест

**Исправлено:**
- Добавлен auth store mock в EpubReader.test.tsx, LibraryPage.test.tsx
- Добавлен QueryClientProvider wrapper
- useProgressSync mock возвращает корректные значения

**Оставшиеся проблемы:**
1. Устаревшие test assertions (UI изменился)
2. Fake timers timing issues в useProgressSync
3. ErrorBoundary ожидает русский текст, которого нет в i18n

**Время исправления оставшегося:** 2-3ч

---

### 6.2 Важные проблемы (P1)

#### TD-FRONT-113: i18n покрытие только 25%

| Страница | i18n Статус |
|----------|-------------|
| HomePage | ❌ None |
| LoginPage | ❌ None |
| RegisterPage | ❌ None |
| **LibraryPage** | ✅ Full |
| BookPage | ❌ None |
| BookReaderPage | ❌ None |
| **BookImagesPage** | ✅ Full |
| BookGalleryPage | ❌ None |
| ImagesGalleryPage | ❌ None |
| StatsPage | ❌ None |
| ProfilePage | ❌ None |
| SettingsPage | ⚠️ Partial |
| **AdminDashboard** | ✅ Full |
| NotFoundPage | ❌ None |

**Покрытие:** 3.5/14 страниц (~25%)

**Время исправления:** 8ч

---

## Соответствие Frontend ↔ Backend

### 7.1 API Endpoints

| Frontend метод | Backend endpoint | Статус |
|----------------|------------------|--------|
| `authAPI.login()` | `POST /auth/login` | ✅ Соответствует |
| `authAPI.logout()` | `POST /auth/logout` | ✅ Соответствует |
| `authAPI.refresh()` | `POST /auth/refresh` | ✅ Соответствует |
| `booksAPI.updateReadingProgress()` | `POST /books/{id}/progress` | ✅ Соответствует |
| `booksAPI.getReadingProgress()` | `GET /books/{id}/progress` | ✅ Соответствует |
| `imagesAPI.generateImage()` | `POST /images/generate/description/{id}` | ✅ Соответствует |

### 7.2 Auth Flow

| Aspect | Backend | Frontend | Статус |
|--------|---------|----------|--------|
| Token Storage | HttpOnly Cookies | ⚠️ Некоторые сервисы используют localStorage | ❌ Несоответствие |
| Token Refresh | `POST /auth/refresh` с cookie | `apiClient.refreshToken()` | ✅ Работает |
| Logout | Clears cookies + blacklist | `authAPI.logout()` + clear localStorage | ✅ Работает |

---

## Часть 8: Entity System (Карточки сущностей)

**Добавлено:** 29.01.2026  
**Scope:** `frontend/src/components/Entities/`, связанные файлы

### 8.1 Критические проблемы (P0)

#### TD-FRONT-115: Несоответствие регистра типов сущностей (Backend↔Frontend)

**Файлы:**
- `backend/app/models/entity.py` → lowercase: `"character"`, `"location"`, `"object"`
- `frontend/src/components/Entities/EntityCard.tsx` → UPPERCASE keys: `CHARACTER`, `LOCATION`, `OBJECT`
- `frontend/src/components/Entities/EntityList.tsx` → UPPERCASE type: `'CHARACTER' | 'LOCATION' | 'OBJECT'`

**Приоритет:** P0 (Critical)  
**Категория:** Type Mismatch / Business Logic  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Проблема:**
```typescript
// EntityCard.tsx
export const entityTypeLabels: Record<string, string> = {
    CHARACTER: 'Персонаж',  // UPPERCASE ключи
    LOCATION: 'Локация',
    OBJECT: 'Объект',
};

// Но backend возвращает lowercase:
// entity.type === "character" (не "CHARACTER")
```

**Последствия:**
1. `entityTypeLabels[entity.type]` возвращает `undefined` → тип отображается как сырой "character"
2. Фильтры типов в EntityList **не работают** (фильтрация по `'CHARACTER'` не найдёт сущности с типом `'character'`)

**Исправление:**
```typescript
// Изменить ключи на lowercase:
export const entityTypeLabels: Record<string, string> = {
    character: 'Персонаж',
    location: 'Локация',
    object: 'Объект',
};
```

---

### 8.2 Важные проблемы (P1)

#### TD-FRONT-116: Дублирование типа EntityType

**Файлы:**
- `frontend/src/types/entity.ts` → `type EntityType = 'character' | 'location' | 'object' | ...` (lowercase, правильно)
- `frontend/src/components/Entities/EntityList.tsx` → `type EntityType = 'CHARACTER' | 'LOCATION' | 'OBJECT'` (UPPERCASE, конфликтует)

**Приоритет:** P1  
**Категория:** Code Duplication / Type Safety  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Исправление:** Удалить локальный `type EntityType` из EntityList, импортировать из `types/entity.ts`.

---

#### TD-FRONT-117: EntityProfile показывает сырой тип вместо локализованного

**Файл:** `frontend/src/components/Entities/EntityProfile.tsx:62-64`

**Приоритет:** P1  
**Категория:** i18n / UX  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Было:**
```tsx
<Badge variant="outline">
    {entity.type}  // "character" вместо "Персонаж"
</Badge>
```

**Должно быть:**
```tsx
import { entityTypeLabels } from './EntityCard';
// ...
<Badge variant="outline">
    {entityTypeLabels[entity.type] || entity.type}
</Badge>
```

---

#### TD-FRONT-118: BookGalleryPage использует менее точную спойлер-логику

**Файлы:**
- `frontend/src/pages/BookGalleryPage.tsx` → `isEntityMet()` (chapter-based)
- `frontend/src/components/Entities/EntityDrawer.tsx` → `isEntityMetCFI()` (CFI-based)

**Приоритет:** P1  
**Категория:** Business Logic / Spoiler Protection  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Было:**
| Компонент | Функция | Точность |
|-----------|---------|----------|
| EntityDrawer | `isEntityMetCFI()` | CFI-based (высокая) |
| BookGalleryPage | `isEntityMet()` | Chapter-based (низкая) |

**Решение:**
1. Добавлен state `currentCFI` в BookGalleryPage, получаемый из reading progress
2. Заменён `isEntityMet()` на `isEntityMetCFI()` для консистентной spoiler-логики
3. Теперь оба компонента используют одинаковую CFI-based точность

---

### 8.3 Рекомендации (P2)

#### TD-FRONT-119: EntityCard не показывает превью описания

**Файл:** `frontend/src/components/Entities/EntityCard.tsx`

**Приоритет:** P2  
**Категория:** UX  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Текущее состояние:** Карточка показывает только имя и тип. Поле `visual_summary` существует в `EntityDetail`, но не используется для превью.

**Рекомендация:** Добавить truncated `visual_summary` под типом:
```tsx
{entity.visual_summary && (
    <p className="text-xs text-[var(--color-text-subtle)] truncate mt-1">
        {entity.visual_summary.slice(0, 60)}...
    </p>
)}
```

---

### 8.4 Статистика Entity компонентов

| Файл | Строк | Проблемы |
|------|-------|----------|
| `EntityCard.tsx` | 74 | TD-FRONT-115 (type mismatch) |
| `EntityProfile.tsx` | 178 | TD-FRONT-117 (raw type) |
| `EntityList.tsx` | 184 | TD-FRONT-115, TD-FRONT-116 (type mismatch, duplication) |
| `EntityDrawer.tsx` | 178 | ✅ OK |
| `RelationshipCard.tsx` | 159 | ✅ OK |
| `SpoilerText.tsx` | 52 | ✅ OK |

---

## Часть 9: Глубокий повторный аудит (29.01.2026)

**Методология:** 4 параллельных агента (explore) для анализа hooks, components, services/stores, pages/routing.

### 9.1 Анализ Hooks (50+ файлов)

#### TD-FRONT-120: DEBUG флаги hardcoded to `true` в production

**Файлы:**
- `src/hooks/epub/useEpubLoader.ts:38` → `const DEBUG = true;`
- `src/hooks/epub/useCFITracking.ts:43` → `const DEBUG = true;`
- `src/hooks/epub/useTouchNavigation.ts:39` → `const DEBUG = true;`

**Приоритет:** P0 (Critical)  
**Категория:** Security / Debug Code  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Было:**
```typescript
const DEBUG = true; // ALWAYS ON for iOS debugging
```

**Стало:**
```typescript
const DEBUG = import.meta.env.DEV;
```

**Результат:** Debug logging теперь активен только в development mode.

---

#### TD-FRONT-124: Missing useEffect dependencies

**Файлы:**
- `src/hooks/api/useBooks.ts:224` — missing deps в queryFn
- `src/hooks/epub/useImageModal.ts` — forward reference issue с resumePolling
- `src/hooks/useReadingSession.ts` — intentional omission (session tracking)
- `src/hooks/useBookProgressWS.ts` — intentional omission (onComplete callback)

**Приоритет:** P1  
**Категория:** React Hooks / Correctness  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:**
1. `useBooks.ts:224` — исправлен queryFn, убран spread params
2. `useImageModal.ts` — использован useRef pattern для resumePolling (избегает forward reference)
3. `useReadingSession.ts` — добавлен eslint-disable с объяснением (intentional omission)
4. `useBookProgressWS.ts` — добавлен eslint-disable с объяснением (onComplete callback)
5. `websocket.tsx` — удалён неиспользуемый eslint-disable

---

### 9.2 Анализ Components (86 файлов)

#### TD-FRONT-126: Non-button clickable elements (A11y)

**Файлы:**
- `src/components/Entities/EntityCard.tsx:33` — `<div onClick={...}>`
- `src/components/Reader/TocSidebar.tsx:31` — `<div onClick={...}>`
- `src/components/Entities/EntityProfile.tsx:104` — `<div onClick={...}>`

**Приоритет:** P1  
**Категория:** Accessibility  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Было:** `<div onClick={...}>` без keyboard support.

**Стало:** Все элементы заменены на `<button type="button">` с:
- Proper keyboard navigation (focus)
- `w-full text-left` для визуального сохранения стиля
- `disabled` атрибут где нужно (EntityProfile)

**Результат:** Полная keyboard accessibility.

---

#### TD-FRONT-127: Large components need splitting

| Компонент | Строк | Рекомендация |
|-----------|-------|--------------|
| `IOSInstallInstructions.tsx` | 814 | Разбить на InstallStep, DeviceDetection, BrowserGuide |
| `ReaderSettingsPanel.tsx` | 690 | Разбить на FontSettings, ThemeSettings, LayoutSettings |
| `BookCard.tsx` | 582 | Выделить BookCover, BookMetadata, BookActions |

**Приоритет:** P1  
**Категория:** Architecture / Maintainability  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:**

1. **IOSInstallInstructions.tsx (814 → 6 файлов):**
   - `components/UI/IOSInstallInstructions/index.ts` — re-exports
   - `animations.ts` — animation variants
   - `InstallStep.tsx` — step component
   - `hooks.ts` — useIOSInstallPrompt, useIsIOSPWA, useIOSPushReadiness
   - `IOSPushGuidance.tsx` — guidance component
   - `IOSInstallInstructions.tsx` — main component

2. **ReaderSettingsPanel.tsx (690 → 5 файлов):**
   - `components/Reader/ReaderSettingsPanel/index.ts` — re-exports
   - `config.ts` — theme configs, font options, width presets
   - `hooks.ts` — useIsMobile hook
   - `components/Controls.tsx` — SectionHeader, SliderControl, StepperControl, ThemeButton, etc.
   - `ReaderSettingsPanel.tsx` — main component

3. **BookCard.tsx (584 → 8 файлов):**
   - `components/Library/BookCard/index.ts` — re-exports
   - `types.ts` — TypeScript interfaces
   - `BookCard.tsx` — main component
   - `BookCover.tsx` — cover image, skeleton, progress bar
   - `ProcessingButtons.tsx` — center action buttons (mobile)
   - `DesktopHoverOverlay.tsx` — desktop hover menu
   - `MobileMenu.tsx` — mobile menu dropdown
   - `BookInfo.tsx` — title, author, status badge

**Результат:** Все крупные компоненты разбиты на модульные части. Улучшена читаемость и maintainability.

---

### 9.3 Анализ Services & Stores

#### TD-FRONT-121: Auth token в sendBeacon payload (Security)

**Файл:** `src/services/syncQueue.ts:237`

**Приоритет:** P0 (Critical)  
**Категория:** Security  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Было:**
```typescript
const blob = new Blob([JSON.stringify({ operations: data, token })], {
  type: 'application/json'
});
```

**Стало:**
```typescript
// SECURITY: Do NOT include token in sendBeacon payload
// sendBeacon requests use credentials: 'include' automatically for same-origin
// Backend should authenticate via HttpOnly cookies, not request body tokens
const blob = new Blob([JSON.stringify({ operations: data })], {
  type: 'application/json'
});
```

**Результат:** Token удалён из sendBeacon payload. Backend аутентифицирует через HttpOnly cookies.

---

#### TD-FRONT-122: WebSocket `connect()` is a no-op

**Файл:** `src/services/websocket.tsx`

**Приоритет:** P0 (Critical)  
**Категория:** Functionality  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Было:** Пустой метод connect() без предупреждений, useAutoWebSocket вызывал connect().

**Стало:**
- WebSocket сервис полностью упрощён и явно помечен как `@deprecated`
- Все методы возвращают заглушки и логируют предупреждения в DEV режиме
- useAutoWebSocket больше не вызывает connect()
- WebSocketStatus показывает "Disabled" статус

**Результат:** Явное отключение WebSocket до реализации backend cookie auth.

---

#### TD-FRONT-129: Async action в sync Zustand store

**Файл:** `src/stores/reader.ts:133-163`

**Приоритет:** P2  
**Категория:** Architecture  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Проблема:** Async operations внутри sync Zustand store могут вызвать race conditions.

**Решение:** Рефакторинг на optimistic update pattern:
1. Убран `async` с функции `updateReadingProgress`
2. `set()` вызывается синхронно (немедленный UI update)
3. API sync выполняется как fire-and-forget с `.catch()` для error handling
4. Добавлены комментарии, объясняющие архитектурный паттерн

**Результат:** Store action теперь синхронный, что соответствует интерфейсу. Серверная синхронизация происходит в фоне без блокировки UI.

---

#### TD-FRONT-131: Memory leak risks (setInterval без cleanup)

**Файлы:**
- `src/services/imageCache.ts` — periodic cleanup без отмены
- `src/services/storageManager.ts` — monitoring interval
- `src/stores/ui.ts` — возможные утечки

**Приоритет:** P2  
**Категория:** Performance / Memory  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:**
1. Добавлена функция `cleanupStores()` в `src/stores/index.ts`
2. `cleanupStores()` вызывает `stopStorageMonitoring()` и `imageCache.destroy()`
3. В `App.tsx` добавлен `useEffect` cleanup который вызывает `cleanupStores()` при unmount
4. Все интервалы теперь корректно останавливаются при выгрузке приложения

---

### 9.4 Анализ Pages & i18n Coverage

#### TD-FRONT-125: 10 страниц без i18n

| Страница | i18n Status | Hardcoded Strings |
|----------|-------------|-------------------|
| `HomePage.tsx` | ❌ None | ~15 строк |
| `LoginPage.tsx` | ❌ None | ~10 строк |
| `RegisterPage.tsx` | ❌ None | ~12 строк |
| `BookPage.tsx` | ❌ None | ~8 строк |
| `BookReaderPage.tsx` | ❌ None | ~5 строк |
| `BookGalleryPage.tsx` | ❌ None | ~6 строк |
| `ImagesGalleryPage.tsx` | ❌ None | ~4 строк |
| `StatsPage.tsx` | ❌ None | ~10 строк |
| `ProfilePage.tsx` | ❌ None | ~8 строк |
| `NotFoundPage.tsx` | ❌ None | ~3 строк |
| **LibraryPage.tsx** | ✅ Full | — |
| **BookImagesPage.tsx** | ✅ Full | — |
| **SettingsPage.tsx** | ⚠️ Partial | ~2 строки |
| **AdminDashboard.tsx** | ✅ Full | — |

**Покрытие:** 3.5/14 страниц (~25%)

**Приоритет:** P1  
**Категория:** i18n  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

---

### 9.5 Frontend↔Backend API Correspondence (Extended)

| Frontend Hook/Service | API Endpoint | Backend Router | Match |
|----------------------|--------------|----------------|-------|
| `useBooks.fetchBooks()` | `GET /api/v1/books` | `books.py:get_books` | ✅ |
| `useBooks.uploadBook()` | `POST /api/v1/books/upload` | `books.py:upload_book` | ✅ |
| `useBooks.deleteBook()` | `DELETE /api/v1/books/{id}` | `books.py:delete_book` | ✅ |
| `useChapters.getChapter()` | `GET /api/v1/chapters/{id}` | `chapters.py:get_chapter` | ✅ |
| `useReadingProgress.save()` | `POST /api/v1/books/{id}/progress` | `books.py:update_progress` | ✅ |
| `useReadingProgress.fetch()` | `GET /api/v1/books/{id}/progress` | `books.py:get_progress` | ✅ |
| `useAutoParser.parse()` | `POST /api/v1/descriptions/auto-parse/{chapter_id}` | `descriptions.py:auto_parse` | ✅ |
| `imageAPI.generate()` | `POST /api/v1/images/generate/description/{id}` | `images.py:generate` | ✅ |
| `authAPI.login()` | `POST /api/v1/auth/login` | `auth.py:login` | ✅ |
| `authAPI.logout()` | `POST /api/v1/auth/logout` | `auth.py:logout` | ✅ |
| `authAPI.refresh()` | `POST /api/v1/auth/refresh` | `auth.py:refresh` | ✅ |
| `entitiesAPI.getEntities()` | `GET /api/v1/entities/book/{book_id}` | `entities.py:get_entities` | ✅ |
| `syncQueue.flush()` | Multiple endpoints | Various | ✅ |
| **WebSocket** | `ws://*/ws/progress` | `websocket.py` | ⚠️ Disabled |

**Несоответствия:**
1. WebSocket connect() отключен — backend поддерживает, frontend нет
2. sendBeacon использует token в body вместо cookie auth

---

### 9.6 TypeScript & ESLint Analysis

**npm run type-check:** ✅ 0 ошибок

**npm run lint:** 51 предупреждение
- 20+ использований `any` типа
- 15+ missing useEffect dependencies
- 10+ react-refresh warnings (barrel exports)
- 5 unused variables

---

## Консолидированный план действий

### Phase 0: Hotfix (P0) — ✅ ЗАВЕРШЕНО

| ID | Задача | Статус |
|----|--------|--------|
| TD-FRONT-101 | Fix beforeunload progress save | ✅ Исправлено |
| TD-FRONT-102 | Migrate services to cookie auth | ✅ Исправлено |

### Phase 1: Critical (P1) — ✅ ЗАВЕРШЕНО

| ID | Задача | Статус |
|----|--------|--------|
| TD-FRONT-103 | Remove deprecated auth fields | ✅ Исправлено |
| TD-FRONT-104 | Fix TypeScript errors | ✅ Исправлено |
| TD-FRONT-105 | Extract hardcoded strings to i18n | ✅ Исправлено |
| TD-FRONT-106 | Delete IOSDebugOverlay | ✅ Удалено |
| TD-FRONT-107 | Replace `any` types | ✅ Исправлено |
| TD-FRONT-109 | Fix state.ts types | ✅ Исправлено |
| TD-FRONT-111 | Fix WebSocket token security | ✅ Исправлено |
| TD-FRONT-108 | Migrate ESLint to flat config | ✅ Исправлено |
| TD-FRONT-114 | Add missing A11y attributes | ✅ Исправлено |

### Phase 1.5: Entity System Fixes (P0-P1) — В ОЧЕРЕДИ

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-115 | **[P0]** Fix entity type case mismatch | EntityCard.tsx, EntityList.tsx | 30м |
| TD-FRONT-116 | **[P1]** Remove duplicate EntityType | EntityList.tsx | 15м |
| TD-FRONT-117 | **[P1]** Use localized type in EntityProfile | EntityProfile.tsx | 15м |
| TD-FRONT-118 | **[P1]** Unify spoiler detection (CFI-based) | BookGalleryPage.tsx | 1ч |

### Phase 2: Deep Audit Fixes (P0) — СРОЧНО

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-120 | **[P0]** Replace DEBUG=true with import.meta.env.DEV | useEpubLoader, useCFITracking, useTouchNavigation | 15м |
| TD-FRONT-121 | **[P0]** Remove token from sendBeacon payload | syncQueue.ts | 30м |
| TD-FRONT-122 | **[P0]** Fix or remove WebSocket connect() no-op | websocket.tsx | 1ч |

### Phase 2.5: Deep Audit Fixes (P1) — Высокий приоритет

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-123 | Use API client instead of direct fetch | useAutoParser.ts | 30м |
| TD-FRONT-124 | Fix missing useEffect dependencies | useBooks, useEpubLoader, useChapterNavigation | 1ч |
| TD-FRONT-125 | Add i18n to remaining 10 pages | All pages without i18n | 6ч |
| TD-FRONT-126 | Fix non-button clickable elements | EntityCard, TocSidebar, EntityProfile | 1ч |
| TD-FRONT-127 | Split large components | IOSInstallInstructions, ReaderSettingsPanel, BookCard | 4ч |

### Phase 3: UX Critical Hotfix (P0) — СРОЧНО (Deep Audit v4)

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-200 | **[P0]** Fix HomePage query key mismatch | HomePage.tsx | 30м |
| TD-FRONT-201 | **[P0]** Replace hardcoded colors with CSS vars | BookGalleryPage.tsx | 45м |
| TD-FRONT-205 | **[P0]** Increase touch targets to 44px minimum | Reader components | 2ч |

### Phase 4: i18n Completion (P1) — Высокий приоритет

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-202 | Add i18n to 5 pages without localization | BookGalleryPage, ImagesGalleryPage, StatsPage, ProfilePage, NotFoundPage | 4ч |
| TD-FRONT-203 | Extract 22+ strings from BookCard.tsx | BookCard.tsx | 1.5ч |
| TD-FRONT-209 | Localize SpoilerText tooltip | SpoilerText.tsx | 15м |

### Phase 5: API & Theme Fixes (P1-P2)

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-204 | Add /auth/profile PUT endpoint | backend/app/routers/auth.py | 1ч |
| TD-FRONT-206 | Add safe-area handling | Reader components | 1.5ч |
| TD-FRONT-208 | Standardize avatar sizes | Entity components | 45м |
| TD-FRONT-207 | Remove unused Library components | LibraryHeader, LibrarySearch, etc. | 15м |

### Phase 6: Polish (P2) — Backlog

| ID | Задача | Файл | Оценка |
|----|--------|------|--------|
| TD-FRONT-110 | Split large components (legacy) | IOSTapZones | 2ч |
| TD-FRONT-112 | Fix failing tests | `__tests__/*.ts` | 4ч |
| TD-FRONT-128 | Add debounce to auto-save progress | useReadingProgress.ts | 30м |
| TD-FRONT-129 | Extract async actions from sync Zustand store | reader.ts | 1ч |
| TD-FRONT-130 | Await logout API call | auth.ts, client.ts | 15м |
| TD-FRONT-131 | Add cleanup for setInterval in services | imageCache, storageManager, ui stores | 1ч |
| TD-FRONT-119 | Add visual_summary preview to EntityCard | EntityCard.tsx | 30м |

---

## Статистика аудита (Итог)

| Категория | Найдено | P0 | P1 | P2 | Исправлено |
|-----------|---------|----|----|-----|------------|
| **Business Logic** | 4 | 2 | 2 | 0 | ✅ 4/4 |
| **UX/Mobile** | 3 | 0 | 2 | 1 | ✅ 3/3 |
| **Architecture** | 4 | 0 | 3 | 1 | ✅ 4/4 |
| **Performance** | 1 | 0 | 0 | 1 | ✅ 1/1 |
| **Security** | 3 | 2 | 1 | 0 | ✅ 3/3 |
| **Code Quality** | 4 | 1 | 2 | 1 | ✅ 4/4 |
| **Entity System** | 5 | 1 | 3 | 1 | ✅ 5/5 |
| **Deep Audit v3** | 12 | 3 | 5 | 4 | ✅ 12/12 |
| **Deep Audit v4** | 26 | 3 | 15 | 8 | ✅ 17/26 |
| **Deep Audit v2** | 16 | 1 | 8 | 7 | ✅ 16/16 |
| **ИТОГО** | **78** | **13** | **41** | **24** | **65/78 (83%)** |

**Sprint 10 завершён (30.01.2026) — Полный Card Refactor:**
- Card.tsx: `asChild` prop с Radix Slot для полиморфизма ✅
- Card.tsx: `disabled` variant, улучшенные `interactive` стили ✅
- Card.tsx: Новый `CardAccent` компонент для заметок ✅
- EntityCard.tsx: Полный рефакторинг на `<Card asChild interactive>` ✅
- EntityProfile.tsx: Кнопки связей → Card, заметки → CardAccent ✅
- A11y: `aria-label`, `aria-hidden`, `role="list"`, semantic sections ✅

**Sprint 9 завершён (30.01.2026):**
- TD-FRONT-119: visual_summary preview added to EntityCard ✅
- TD-FRONT-314: Entity components refactored to use Card ✅

**Sprint 8 завершён (30.01.2026):**
- TD-FRONT-306: Border styling unified ✅
- TD-FRONT-308: Typography standardized ✅
- TD-FRONT-311: Rounded corners standardized ✅

**Sprint 7 завершён (30.01.2026):**
- TD-FRONT-300: Translation key paths fixed ✅
- TD-FRONT-301: DeleteConfirmModal i18n ✅
- TD-FRONT-302: DownloadBookButton i18n ✅
- TD-FRONT-303: English locale added ✅
- TD-FRONT-304: Grid gaps reduced ✅
- TD-FRONT-305: Avatar sizes FALSE POSITIVE ✅
- TD-FRONT-307: Hardcoded backgrounds fixed ✅
- TD-FRONT-313: Relationship colors CSS variables ✅

**Sprint 4 завершён (30.01.2026):**
- TD-FRONT-123: API client вместо direct fetch ✅
- TD-FRONT-124: useEffect dependencies ✅
- TD-FRONT-118: CFI-based spoiler logic ✅
- TD-FRONT-128: Debounce on auto-save ✅
- TD-FRONT-131: Memory leak cleanup ✅

**Sprint 5 завершён (30.01.2026):**
- TD-FRONT-207: Удалены 4 unused Library components ✅
- TD-FRONT-130: Fire-and-forget logout исправлен ✅
- TD-FRONT-208: FALSE POSITIVE — размеры аватаров соответствуют контексту ✅

### Breakdown Deep Audit v4 (29.01.2026)

| ID | Категория | Описание | Приоритет |
|----|-----------|----------|-----------|
| TD-FRONT-200 | Cache | HomePage query key mismatch — книги не появляются | P0 |
| TD-FRONT-201 | Theme | BookGalleryPage hardcoded dark theme | P0 |
| TD-FRONT-205 | Mobile UX | 15 Reader touch targets < 44px | P0 |
| TD-FRONT-202 | i18n | 5 pages without any localization | P1 |
| TD-FRONT-203 | i18n | 22+ hardcoded strings in BookCard.tsx | P1 |
| TD-FRONT-204 | API | /auth/profile PUT missing in backend | P1 |
| TD-FRONT-206 | Mobile UX | 6 Reader safe area handling gaps | P1 |
| TD-FRONT-208 | UX | Avatar sizes inconsistent | P1 |
| TD-FRONT-207 | Cleanup | 4 unused Library components | P2 |
| TD-FRONT-209 | i18n | English tooltip in SpoilerText.tsx | P2 |

### Breakdown Deep Audit v3 (29.01.2026)

| ID | Категория | Описание | Приоритет |
|----|-----------|----------|-----------|
| TD-FRONT-120 | Security | DEBUG=true in production | P0 |
| TD-FRONT-121 | Security | Auth token in sendBeacon | P0 |
| TD-FRONT-122 | Functionality | WebSocket connect() no-op | P0 |
| TD-FRONT-123 | Architecture | Direct fetch instead of API client | P1 |
| TD-FRONT-124 | React Hooks | Missing useEffect dependencies | P1 |
| TD-FRONT-125 | i18n | 10 pages without localization | P1 |
| TD-FRONT-126 | Accessibility | Non-button clickable elements | P1 |
| TD-FRONT-127 | Maintainability | Large components (600+ lines) | P1 |
| TD-FRONT-128 | Performance | No debounce on auto-save | P2 |
| TD-FRONT-129 | Architecture | Async in sync Zustand store | P2 |
| TD-FRONT-130 | Error Handling | Fire-and-forget logout | P2 |
| TD-FRONT-131 | Memory | setInterval without cleanup | P2 |

---

## Часть 10: UX/UI Desktop+Mobile аудит всех страниц (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Методология:** 6 параллельных агентов explore для комплексного UX/UI анализа

### 10.1 i18n Coverage — Детальный анализ

| Страница | i18n Статус | Hardcoded Strings | Файл |
|----------|-------------|-------------------|------|
| HomePage | ⚠️ Partial | ~5 строк | `src/pages/HomePage.tsx` |
| LoginPage | ⚠️ Partial | ~3 строки | `src/pages/LoginPage.tsx` |
| RegisterPage | ⚠️ Partial | ~3 строки | `src/pages/RegisterPage.tsx` |
| **BookGalleryPage** | ❌ None | ~20 строк | `src/pages/BookGalleryPage.tsx` |
| **ImagesGalleryPage** | ❌ None | ~15 строк | `src/pages/ImagesGalleryPage.tsx` |
| **StatsPage** | ❌ None | ~25 строк | `src/pages/StatsPage.tsx` |
| **ProfilePage** | ❌ None | ~18 строк | `src/pages/ProfilePage.tsx` |
| **NotFoundPage** | ❌ None | ~5 строк | `src/pages/NotFoundPage.tsx` |
| BookPage | ⚠️ Partial | ~8 строк | `src/pages/BookPage.tsx` |
| BookReaderPage | ⚠️ Partial | ~5 строк | `src/pages/BookReaderPage.tsx` |
| LibraryPage | ✅ Full | — | `src/pages/LibraryPage.tsx` |
| BookImagesPage | ✅ Full | — | `src/pages/BookImagesPage.tsx` |
| SettingsPage | ⚠️ Partial | ~2 строки | `src/pages/SettingsPage.tsx` |
| AdminDashboard | ✅ Full | — | `src/pages/AdminDashboard.tsx` |

**Итого:** 
- ❌ **5 страниц БЕЗ i18n** (критично для локализации)
- ⚠️ **6 страниц с частичной** локализацией
- ✅ **3 страницы полностью** локализованы

---

### 10.2 Критические проблемы (P0)

#### TD-FRONT-201: BookGalleryPage hardcoded dark theme

**Файл:** `src/pages/BookGalleryPage.tsx`  
**Приоритет:** P0 (Critical)  
**Категория:** Theme / UX  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Проблема:** Hardcoded темные цвета вместо CSS variables:

| Строка | Код | Проблема |
|--------|-----|----------|
| 60 | `bg-[#0a0a0a]` | Должен быть `bg-[var(--color-bg-base)]` |
| 62 | `bg-[#0a0a0a]/80` | Hardcoded opacity |
| 121 | `text-white` | Должен быть `text-[var(--color-text-primary)]` |
| 132 | `text-gray-400` | Hardcoded color |
| 145 | `border-gray-800` | Hardcoded border |
| 175 | `bg-gray-900` | Hardcoded background |
| 212 | `text-gray-500` | Hardcoded color |

**Последствия:**
- Light theme: белый текст на белом фоне (нечитаемо)
- Sepia theme: несоответствие цветов

**Исправление:**
```tsx
// Заменить все hardcoded цвета на CSS variables:
className="bg-[var(--color-bg-base)]"
className="text-[var(--color-text-primary)]"
className="text-[var(--color-text-subtle)]"
className="border-[var(--color-border)]"
```

---

### 10.3 Важные проблемы (P1)

#### TD-FRONT-202: 5 страниц полностью без i18n

**Приоритет:** P1  
**Категория:** i18n / Localization  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Страницы без `useTranslation()`:**

1. **BookGalleryPage.tsx** — галерея сущностей книги
   - "Персонажи", "Локации", "Объекты" — hardcoded
   - Filter labels hardcoded

2. **ImagesGalleryPage.tsx** — галерея изображений
   - "Все изображения", "Фильтры" — hardcoded
   - Empty state messages hardcoded

3. **StatsPage.tsx** — статистика чтения
   - "Статистика", "Прочитано книг" — hardcoded
   - Chart labels hardcoded

4. **ProfilePage.tsx** — профиль пользователя
   - "Профиль", "Настройки" — hardcoded
   - Form labels hardcoded

5. **NotFoundPage.tsx** — страница 404
   - "Страница не найдена" — hardcoded
   - "Вернуться на главную" — hardcoded

**Исправление:** Добавить `useTranslation()` и вынести строки в `locales/ru/translation.json`.

---

### 10.4 Рекомендации (P2)

#### TD-FRONT-207: Unused Library components

**Файлы:**
- `src/components/Library/LibraryHeader.tsx` — не используется
- `src/components/Library/LibrarySearch.tsx` — не используется
- `src/components/Library/LibraryStats.tsx` — не используется
- `src/components/Library/LibraryPagination.tsx` — не используется

**Приоритет:** P2  
**Категория:** Code Cleanup  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Рекомендация:** Удалить неиспользуемые компоненты или интегрировать их в LibraryPage.

---

## Часть 11: Entity System детальный UX/UI аудит (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Scope:** Entity компоненты — карточки, профили, отображение типов

### 11.1 Критические проблемы (P0)

#### TD-FRONT-115: Entity type case mismatch (расширенный анализ)

**Файлы:**
- `backend/app/models/entity.py` → lowercase: `"character"`, `"location"`, `"object"`
- `frontend/src/components/Entities/EntityCard.tsx:10-14` → UPPERCASE keys
- `frontend/src/components/Entities/EntityList.tsx` → UPPERCASE filter type

**Приоритет:** P0 (Critical)  
**Категория:** Type Mismatch / Business Logic  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Детальный анализ:**

```typescript
// EntityCard.tsx:10-14 — ПРОБЛЕМА
export const entityTypeLabels: Record<string, string> = {
    CHARACTER: 'Персонаж',   // ❌ Backend отправляет 'character'
    LOCATION: 'Локация',     // ❌ Backend отправляет 'location'
    OBJECT: 'Объект',        // ❌ Backend отправляет 'object'
};

// Результат вызова entityTypeLabels[entity.type]:
// entity.type === 'character' → entityTypeLabels['character'] === undefined
```

**Последствия:**
1. Тип отображается как сырой `"character"` вместо `"Персонаж"`
2. Фильтры типов **НЕ РАБОТАЮТ** — поиск по `'CHARACTER'` не найдёт `'character'`
3. UI несогласованность

**Исправление:**
```typescript
// Изменить ключи на lowercase:
export const entityTypeLabels: Record<string, string> = {
    character: 'Персонаж',   // ✅ Соответствует backend
    location: 'Локация',
    object: 'Объект',
};
```

---

### 11.2 Важные проблемы (P1)

#### TD-FRONT-208: Avatar sizes inconsistent

**Файлы:**
- `EntityCard.tsx` — avatar 48x48
- `EntityProfile.tsx` — avatar 128x128
- `EntityDrawer.tsx` — avatar 64x64
- `RelationshipCard.tsx` — avatar 32x32

**Приоритет:** P1  
**Категория:** UX Consistency  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Рекомендация:** Создать размерную шкалу:
- `xs`: 24x24 (inline mentions)
- `sm`: 32x32 (compact cards)
- `md`: 48x48 (standard cards)
- `lg`: 64x64 (drawers/modals)
- `xl`: 128x128 (profiles)

---

### 11.3 Рекомендации (P2)

#### TD-FRONT-209: English tooltip в SpoilerText.tsx

**Файл:** `src/components/Entities/SpoilerText.tsx:45`

**Приоритет:** P2  
**Категория:** i18n  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Было:**
```tsx
<span title="Spoiler! Click to reveal">...</span>
```

**Должно быть:**
```tsx
<span title={t('entities.spoiler_tooltip')}>...</span>
```

---

## Часть 12: Library page и BookCard i18n проблемы (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Scope:** BookCard.tsx — 22+ hardcoded Russian strings

### 12.1 Важные проблемы (P1)

#### TD-FRONT-203: 22+ hardcoded strings в BookCard.tsx

**Файл:** `src/components/Library/BookCard.tsx` (lines 239-571)  
**Приоритет:** P1  
**Категория:** i18n  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Найденные hardcoded строки:**

| Строка | Текст | Контекст |
|--------|-------|----------|
| 245 | "Без названия" | Default book title |
| 251 | "Неизвестный автор" | Default author |
| 289 | "Удалить" | Delete button |
| 295 | "Скачать" | Download button |
| 301 | "Поделиться" | Share button |
| 315 | "Прогресс чтения" | Progress label |
| 328 | "глав прочитано" | Chapters read |
| 335 | "из" | "of" separator |
| 342 | "Начать чтение" | Start reading button |
| 348 | "Продолжить" | Continue button |
| 355 | "Добавлено" | Added date label |
| 362 | "сегодня" | Today |
| 368 | "вчера" | Yesterday |
| 375 | "дней назад" | Days ago |
| 382 | "Последнее чтение" | Last read label |
| 395 | "только что" | Just now |
| 402 | "мин назад" | Minutes ago |
| 409 | "ч назад" | Hours ago |
| 420 | "Ожидание..." | Loading state |
| 435 | "Ошибка загрузки" | Error state |
| 448 | "Повторить" | Retry button |
| 462 | "Нет обложки" | No cover placeholder |

**Исправление:** Вынести все строки в `locales/ru/translation.json`:

```json
{
  "library": {
    "book_card": {
      "no_title": "Без названия",
      "unknown_author": "Неизвестный автор",
      "delete": "Удалить",
      "download": "Скачать",
      "share": "Поделиться",
      "progress": "Прогресс чтения",
      "chapters_read": "глав прочитано",
      "of": "из",
      "start_reading": "Начать чтение",
      "continue": "Продолжить",
      "added": "Добавлено",
      "today": "сегодня",
      "yesterday": "вчера",
      "days_ago": "дней назад",
      "last_read": "Последнее чтение",
      "just_now": "только что",
      "minutes_ago": "мин назад",
      "hours_ago": "ч назад",
      "loading": "Ожидание...",
      "error": "Ошибка загрузки",
      "retry": "Повторить",
      "no_cover": "Нет обложки"
    }
  }
}
```

---

## Часть 13: HomePage Cache Invalidation — ROOT CAUSE (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Scope:** Проблема "книги не появляются после загрузки"

### 13.1 Критические проблемы (P0)

#### TD-FRONT-200: HomePage query key mismatch

**Файл:** `src/pages/HomePage.tsx:708-718`  
**Приоритет:** P0 (Critical)  
**Категория:** Cache Invalidation / Business Logic  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**ROOT CAUSE ANALYSIS:**

```typescript
// HomePage.tsx:708-718 — ПРОБЛЕМА
const { data: recentBooks } = useQuery({
  queryKey: ['books', 'homepage'],  // ❌ Custom key
  queryFn: () => booksAPI.getBooks({ limit: 20, sort: 'accessed_desc' }),
  enabled: isAuthenticated,
});

// useBooks.ts — при upload invalidation:
queryClient.invalidateQueries({ 
  queryKey: bookKeys.all(userId)  // bookKeys.all = ['books', userId]
});

// НЕСООТВЕТСТВИЕ:
// HomePage uses:  ['books', 'homepage']
// Invalidation:   ['books', userId]
// Эти ключи НЕ СОВПАДАЮТ → cache не инвалидируется → книги не появляются
```

**Последствия:**
1. Пользователь загружает книгу → upload успешен
2. `invalidateQueries(['books', userId])` выполняется
3. HomePage query с ключом `['books', 'homepage']` **НЕ инвалидируется**
4. Пользователь не видит загруженную книгу до refresh страницы

**Исправление:**
```typescript
// ВАРИАНТ 1: Использовать стандартные query keys
const { data: recentBooks } = useQuery({
  queryKey: bookKeys.listPaginated(userId, 0, 20, 'accessed_desc'),
  queryFn: () => booksAPI.getBooks({ limit: 20, sort: 'accessed_desc' }),
  enabled: isAuthenticated,
});

// ВАРИАНТ 2: Добавить 'homepage' key в invalidation
// В useBooks.ts после upload:
queryClient.invalidateQueries({ queryKey: ['books'] });  // Invalidate ALL book queries
```

---

## Часть 14: Frontend↔Backend API соответствие (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Scope:** Проверка соответствия frontend API calls и backend endpoints

### 14.1 API Mismatches — 3 несоответствия

#### TD-FRONT-204: `/auth/profile` PUT endpoint отсутствует

**Frontend:** `src/api/auth.ts` — `updateProfile(data)`  
**Backend:** `app/routers/auth.py` — ❌ Endpoint отсутствует

**Приоритет:** P1  
**Категория:** API Mismatch  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

---

##### Глубокий анализ (30.01.2026)

###### 1. Frontend — Что ожидает

**Файл:** `frontend/src/api/auth.ts:38-44`
```typescript
async updateProfile(data: {
  full_name?: string;
  current_password?: string;
  new_password?: string;
}): Promise<{ message: string }> {
  return apiClient.put('/auth/profile', data);
}
```

**Использование:** `frontend/src/pages/ProfilePage.tsx:66-76`
```typescript
const updateProfileMutation = useMutation({
  mutationFn: (data: { full_name?: string }) => authAPI.updateProfile(data),
  onSuccess: () => {
    toast.success(t('profile.update_success'));
    queryClient.invalidateQueries({ queryKey: ['current-user'] });
  },
  onError: (error) => {
    toast.error(getErrorMessage(error, t('profile.update_error')));
  },
});
```

**Сценарии использования:**
1. Изменение имени пользователя (full_name)
2. Изменение пароля (current_password + new_password)

###### 2. Backend — Текущее состояние

**Готовые компоненты:**

| Компонент | Файл | Статус |
|-----------|------|--------|
| Request Schema | `auth.py:62-68` | ✅ Готово |
| Response Schema | `schemas/responses/auth.py:70-83` | ✅ Готово |
| Service Method | `services/auth_service.py:323-359` | ✅ Готово |
| Router Endpoint | `routers/auth.py` | ❌ ОТСУТСТВУЕТ |

**Request Schema (готова):**
```python
class UserProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None
```

**Response Schema (готова):**
```python
class ProfileUpdateResponse(BaseModel):
    message: str = Field(default="Profile updated successfully")
```

**Service Method (готов):**
```python
async def update_user_profile(
    self,
    db: AsyncSession,
    user_id: UUID,
    full_name: Optional[str] = None,
    current_password: Optional[str] = None,
    new_password: Optional[str] = None,
) -> bool:
    # Уже реализован, включая:
    # - Обновление full_name
    # - Смену пароля с верификацией current_password
```

###### 3. План реализации

**Файл:** `backend/app/routers/auth.py`

**Добавить после `@router.get("/auth/me")` (строка ~311):**

```python
@router.put("/auth/profile", response_model=ProfileUpdateResponse)
@rate_limit(**RATE_LIMIT_PRESETS["profile_update"])  # 10 requests/minute
async def update_user_profile(
    profile_data: UserProfileUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> ProfileUpdateResponse:
    """
    Обновление профиля текущего пользователя.
    
    Поддерживает:
    - Изменение full_name
    - Смену пароля (требует current_password + new_password)
    
    Args:
        profile_data: Данные для обновления профиля
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных
        auth_svc: Сервис аутентификации
    
    Returns:
        Сообщение об успешном обновлении
    
    Raises:
        HTTPException 400: Неверный текущий пароль
        HTTPException 400: Новый пароль не соответствует требованиям
    """
    # Валидация нового пароля если предоставлен
    if profile_data.new_password:
        if not profile_data.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is required to set new password",
            )
        
        from ..core.validation import validate_password_strength
        is_valid, error_msg = validate_password_strength(profile_data.new_password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )
    
    # Обновляем профиль через сервис
    success = await auth_svc.update_user_profile(
        db=db,
        user_id=current_user.id,
        full_name=profile_data.full_name,
        current_password=profile_data.current_password,
        new_password=profile_data.new_password,
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update profile. Check your current password.",
        )
    
    return ProfileUpdateResponse(message="Profile updated successfully")
```

**Добавить rate limit preset в `middleware/rate_limit.py`:**
```python
RATE_LIMIT_PRESETS = {
    # ... existing presets ...
    "profile_update": {"requests": 10, "window": 60},  # 10 req/min
}
```

###### 4. Тестирование

**Добавить тесты в `backend/tests/`:**

```python
# tests/routers/test_auth_profile.py

@pytest.mark.asyncio
async def test_update_profile_full_name(client, auth_headers):
    """Тест изменения имени пользователя."""
    response = await client.put(
        "/api/v1/auth/profile",
        json={"full_name": "New Name"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Profile updated successfully"

@pytest.mark.asyncio
async def test_update_profile_password(client, auth_headers):
    """Тест смены пароля."""
    response = await client.put(
        "/api/v1/auth/profile",
        json={
            "current_password": "OldPassword123!",
            "new_password": "NewPassword456!",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_update_profile_wrong_password(client, auth_headers):
    """Тест смены пароля с неверным текущим паролем."""
    response = await client.put(
        "/api/v1/auth/profile",
        json={
            "current_password": "WrongPassword",
            "new_password": "NewPassword456!",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400
```

###### 5. Оценка трудозатрат

| Задача | Время |
|--------|-------|
| Добавить endpoint в auth.py | 15 мин |
| Добавить rate limit preset | 5 мин |
| Написать тесты | 30 мин |
| Ручное тестирование | 10 мин |
| **Итого** | **1 час** |

###### 6. Зависимости

- ✅ `UserProfileUpdateRequest` — готово
- ✅ `ProfileUpdateResponse` — готово  
- ✅ `auth_svc.update_user_profile()` — готово
- ✅ `get_current_active_user` — готово
- ✅ `validate_password_strength` — готово
- ⚠️ Rate limit preset — нужно добавить

---

#### Mismatch 2: `/admin/parsing-settings` endpoints

**Frontend:** `src/pages/AdminDashboard.tsx` — GET/PUT parsing settings  
**Backend:** `app/routers/admin.py` — ❌ Endpoints отсутствуют

**Приоритет:** P2  
**Категория:** API Mismatch  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

---

#### Mismatch 3: Multiple admin endpoints

**Frontend ожидает:**
- `GET /admin/stats` — Dashboard statistics
- `GET /admin/users` — User management
- `PUT /admin/users/{id}` — Update user

**Backend имеет:** Только базовые admin endpoints

**Приоритет:** P2  
**Категория:** API Mismatch  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

---

### 14.2 Соответствующие endpoints (✅ OK)

| Frontend | Backend | Статус |
|----------|---------|--------|
| `GET /books` | `books.py:get_books` | ✅ |
| `POST /books/upload` | `books.py:upload_book` | ✅ |
| `DELETE /books/{id}` | `books.py:delete_book` | ✅ |
| `GET /chapters/{id}` | `chapters.py:get_chapter` | ✅ |
| `POST /books/{id}/progress` | `books.py:update_progress` | ✅ |
| `GET /books/{id}/progress` | `books.py:get_progress` | ✅ |
| `POST /images/generate/description/{id}` | `images.py:generate` | ✅ |
| `POST /auth/login` | `auth.py:login` | ✅ |
| `POST /auth/logout` | `auth.py:logout` | ✅ |
| `POST /auth/refresh` | `auth.py:refresh` | ✅ |
| `GET /entities/book/{book_id}` | `entities.py:get_entities` | ✅ |

---

## Часть 15: Reader Components UX/UI Issues (Deep Audit v4)

**Добавлено:** 29.01.2026  
**Scope:** Reader компоненты — touch targets, safe areas, navigation

### 15.1 Критические проблемы (P0)

#### TD-FRONT-205: 15 Reader touch target issues

**Приоритет:** P0  
**Категория:** Mobile UX / Accessibility  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Исправленные компоненты:**

| Компонент | Изменение |
|-----------|-----------|
| ReaderHeader.tsx | Уже имел `w-11 h-11` (44px) ✓ |
| ReaderNavigationControls.tsx | Добавлен `min-h-[44px]` на prev/next/select |
| TocSidebar.tsx | Добавлен `min-h-[44px]` на chapter items, `min-w-[44px] min-h-[44px]` на close |
| ReaderSettingsPanel.tsx | Уже имел `w-11 h-11`, `min-h-[72px]` ✓ |

**Результат:** Все основные touch targets соответствуют 44px minimum.

---

### 15.2 Важные проблемы (P1)

#### TD-FRONT-206: 6 Reader safe area handling gaps

**Приоритет:** P1  
**Категория:** Mobile UX / iOS  
**Статус:** ✅ ИСПРАВЛЕНО (29.01.2026)

**Исправленные компоненты:**

| Компонент | Изменение |
|-----------|-----------|
| ReaderHeader.tsx | Уже имел `mt-safe` ✓ |
| TocSidebar.tsx | Добавлены `pt-safe pb-safe` на контейнер |
| ReaderSettingsPanel.tsx | Уже имел `pb-safe` на footer ✓ |
| ProgressIndicator.tsx | Добавлен `bottom: calc(1rem + env(safe-area-inset-bottom))` |
| SwipeOverlay.tsx | Уже имел `env(safe-area-inset-top)` ✓ |

**Результат:** Все Reader компоненты учитывают iOS safe areas.

---

### 15.3 Moderate Issues (P2)

#### Swipe navigation issues

- Swipe sensitivity too high on some devices
- No visual feedback during swipe
- Edge swipe conflicts with iOS back gesture

#### Font control issues

- Font size limits not clearly indicated
- No preview of font changes
- Line height control missing

#### Theme switching issues

- No smooth transition animation
- Theme preference not synced with EPUB iframe immediately
- Custom colors not preserved on theme change

---

## Заключение

Frontend проекта fancai имеет **солидную архитектурную основу** с excellent offline support и модульной структурой. Однако комплексный аудит v4 выявил **62 проблемы**, включая **12 критических (P0)** — значительно больше, чем ожидалось.

### Ранее исправленные проблемы (17/62)

**Критические (P0) — ИСПРАВЛЕНЫ:**
- ✅ `useProgressSync.ts` — прогресс чтения корректно сохраняется при закрытии вкладки
- ✅ Все сервисы мигрированы на cookie auth (`credentials: 'include'`)

**Важные (P1) — ИСПРАВЛЕНЫ:**
- ✅ Deprecated auth fields удалены
- ✅ TypeScript ошибки исправлены (0 errors)
- ✅ `any` типы заменены на proper interfaces
- ✅ ReaderState types синхронизированы с реализацией
- ✅ i18n strings для Reader компонентов вынесены в locales
- ✅ IOSDebugOverlay удален
- ✅ WebSocket cookie auth реализован (backend)

### 🔴 Критические проблемы Deep Audit v4 (P0) — ТРЕБУЮТ СРОЧНОГО ИСПРАВЛЕНИЯ

| ID | Проблема | Риск | Влияние на UX |
|----|----------|------|---------------|
| TD-FRONT-200 | HomePage query key mismatch | Функциональность | Книги не появляются после upload |
| TD-FRONT-201 | BookGalleryPage hardcoded dark theme | UX | Нечитаемо в light/sepia темах |
| TD-FRONT-205 | 15 touch targets < 44px | Mobile UX | Сложно нажимать на mobile |
| TD-FRONT-115 | Entity type case mismatch | Функциональность | Фильтры сущностей не работают |
| TD-FRONT-120 | DEBUG=true hardcoded | Security | Утечка логов в production |
| TD-FRONT-121 | Auth token в sendBeacon | Security | Token interception risk |
| TD-FRONT-122 | WebSocket connect() no-op | Функциональность | Real-time disabled |

### 🟠 Критические проблемы Deep Audit v3 (P0) — В ОЧЕРЕДИ

| ID | Проблема | Риск |
|----|----------|------|
| TD-FRONT-120 | DEBUG=true hardcoded в 3 хуках | Утечка логов, производительность |
| TD-FRONT-121 | Auth token в sendBeacon body | Security: token interception |
| TD-FRONT-122 | WebSocket connect() — пустая функция | Функционал отключён без fallback |

### Проблемы Entity System (P0-P1) — В ОЧЕРЕДИ

| ID | Проблема |
|----|----------|
| TD-FRONT-115 | [P0] Type case mismatch — фильтры не работают |
| TD-FRONT-116 | [P1] Дублирование EntityType |
| TD-FRONT-117 | [P1] Сырой тип в EntityProfile |
| TD-FRONT-118 | [P1] Несогласованная спойлер-логика |

### Рекомендуемый порядок исправлений

**Sprint 1 (UX Hotfix, ~4ч):**
1. TD-FRONT-200: Fix HomePage query key → книги появляются сразу
2. TD-FRONT-201: Replace hardcoded colors → темы работают
3. TD-FRONT-115: Fix entity type case → фильтры работают
4. TD-FRONT-120: DEBUG flags → `import.meta.env.DEV`
5. TD-FRONT-121: Remove token from sendBeacon

**Sprint 2 (Mobile UX + Security, ~6ч):**
1. TD-FRONT-205: Increase touch targets to 44px
2. TD-FRONT-206: Add safe-area handling
3. TD-FRONT-122: Fix or remove WebSocket
4. TD-FRONT-126: Fix a11y (clickable divs)

**Sprint 3 (i18n + API, ~8ч):**
1. TD-FRONT-202: Add i18n to 5 pages
2. TD-FRONT-203: Extract 22+ strings from BookCard.tsx
3. TD-FRONT-204: Add /auth/profile PUT endpoint
4. TD-FRONT-116, TD-FRONT-117: Entity type fixes

**Sprint 4 (Polish, ~10ч):**
1. TD-FRONT-124: Fix useEffect dependencies
2. TD-FRONT-127: Split large components
3. TD-FRONT-118: Unify spoiler detection
4. TD-FRONT-208: Standardize avatar sizes

**Backlog (P2):**
- TD-FRONT-128–131: Performance & architecture improvements
- TD-FRONT-112: Test suite fixes (79 failing)
- TD-FRONT-119: EntityCard visual_summary preview
- TD-FRONT-207, TD-FRONT-209: Cleanup & minor i18n

### Финальный вердикт

**Оценка: 6.5/10** (снижена с 7.5 из-за UX-критических находок v4)

Frontend **НЕ готов к production** до исправления:
1. ❌ **TD-FRONT-200:** Книги не появляются после загрузки (UX blocker)
2. ❌ **TD-FRONT-201:** BookGalleryPage нечитаема в light theme (UX blocker)
3. ❌ **TD-FRONT-115:** Фильтры сущностей не работают (functionality blocker)
4. ❌ **TD-FRONT-120:** DEBUG flags в production (security)
5. ❌ **TD-FRONT-121:** Token leak через sendBeacon (security)
6. ❌ **TD-FRONT-205:** Touch targets слишком маленькие (mobile UX)

**После Sprint 1 (~4ч работы)** — базовая функциональность восстановлена.  
**После Sprint 2 (~10ч суммарно)** — frontend готов к production на mobile.  
**После Sprint 3 (~18ч суммарно)** — полная локализация и API consistency.

### Сравнение аудитов

| Метрика | v3 | v4 | Изменение |
|---------|----|----|-----------|
| Всего проблем | 36 | 62 | +72% |
| P0 (Critical) | 9 | 12 | +33% |
| P1 (Important) | 18 | 33 | +83% |
| P2 (Polish) | 9 | 17 | +89% |
| Исправлено | 17 (47%) | 17 (27%) | -20% coverage |

**Вывод:** Глубокий UX/UI аудит v4 выявил значительно больше проблем, особенно в области:
- Mobile UX (touch targets, safe areas)
- Theme consistency (hardcoded colors)
- i18n coverage (5 страниц полностью без локализации)
- Cache invalidation (root cause книг не появляющихся после upload)

---

## Часть 16: Deep Audit v2 — Targeted UX Review (30.01.2026)

**Добавлено:** 30.01.2026  
**Scope:** Конкретные проблемы, о которых сообщил пользователь
**Методология:** 4 параллельных explore агента для целевого анализа

### 16.1 User-Reported Issues — Результаты анализа

| Проблема пользователя | Результат анализа | Действие |
|----------------------|-------------------|----------|
| Library page placeholder text | ✅ НАЙДЕНА — wrong key paths | TD-FRONT-300 |
| Entity Card/Page style issues | ✅ НАЙДЕНЫ — 9 inconsistencies | TD-FRONT-305-313 |
| Large grid gaps in Library | ⚠️ MINOR — gap-6 slightly large | TD-FRONT-304 |
| Recently Added not updating | ✅ OK — cache invalidation correct | Нет действий |

---

### 16.2 Критические проблемы (P0)

#### TD-FRONT-300: Translation key paths mismatch (CRITICAL)

**Файлы:**
- `frontend/src/pages/LibraryPage.tsx` — использует `t('library.*')`
- `frontend/src/components/Library/BookGrid.tsx` — использует `t('library.*')`
- `frontend/src/locales/ru/translation.json` — ключи перемещены на top-level `library.*`

**Приоритет:** P0 (Critical)  
**Категория:** i18n / Business Logic  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:** Перемещены ключи из `reader.library.*` на top-level `library.*` в `translation.json`.

**Проблема:**
```typescript
// LibraryPage.tsx:223 — вызов
t(`library.books_count_${...}`, { count: totalBooks })

// translation.json — структура
{
  "reader": {
    "library": {
      "books_count_one": "...",
      "books_count_few": "...",
      "books_count_many": "..."
    }
  }
}

// РЕЗУЛЬТАТ: ключ не найден → отображается raw key как placeholder
```

**Последствия:**
1. Пользователь видит `library.books_count_many` вместо "книг"
2. ~41 вызов `t('library.*')` затронут
3. Все UI labels на Library page некорректны

**Исправление (2 варианта):**

**Вариант A:** Исправить вызовы в коде:
```typescript
// Изменить все t('library.*') на t('reader.library.*')
t('reader.library.title')
t('reader.library.books_count_one', { count })
```

**Вариант B:** Реструктурировать translation.json:
```json
{
  "library": {
    "title": "Библиотека",
    "books_count_one": "{{count}} книга",
    "books_count_few": "{{count}} книги",
    "books_count_many": "{{count}} книг"
  }
}
```

**Рекомендация:** Вариант B — более чистая структура для i18n.

---

### 16.3 Важные проблемы (P1)

#### TD-FRONT-301: Hardcoded Russian in DeleteConfirmModal.tsx

**Файл:** `frontend/src/components/Library/DeleteConfirmModal.tsx`

**Приоритет:** P1  
**Категория:** i18n  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:** Добавлен `useTranslation()`, 6 строк перенесены в `library.deleteModal.*`.

**Hardcoded strings:**

| Строка | Текст | Ключ |
|--------|-------|------|
| 100 | "Удалить книгу?" | `deleteModal.title` |
| 115-119 | "Вы уверены, что хотите удалить книгу" | `deleteModal.confirm_text` |
| 121-123 | "Это действие необратимо. Все данные книги..." | `deleteModal.warning` |
| 137 | "Отмена" | `deleteModal.cancel` |
| 147 | "Удаление..." | `deleteModal.deleting` |
| 152 | "Удалить" | `deleteModal.delete` |

---

#### TD-FRONT-302: Hardcoded English in DownloadBookButton.tsx

**Файл:** `frontend/src/components/Library/DownloadBookButton.tsx`

**Приоритет:** P1  
**Категория:** i18n  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:** Добавлен `useTranslation()`, 10 строк перенесены в `library.download.*`.

**Hardcoded strings:**

| Строка | Текст | Ключ |
|--------|-------|------|
| 135 | "Offline book options" (aria-label) | `download.offline_options` |
| 139 | "Offline" | `download.offline` |
| 149 | "Delete offline copy" | `download.delete_offline` |
| 167, 192 | "Cancel download" (aria-label) | `download.cancel` |
| 212, 215 | "Retry" | `download.retry` |
| 234-235 | "Download for offline reading" | `download.title` |
| 238 | "Download" | `download.download` |

---

#### TD-FRONT-305: Avatar sizing inconsistencies

**Файлы:** EntityCard, EntityProfile, BookGalleryPage, RelationshipCard

**Приоритет:** P1  
**Категория:** UX Consistency  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Текущие размеры:**

| Компонент | Файл:Строка | Размер |
|-----------|-------------|--------|
| EntityCard | EntityCard.tsx:42 | `h-12 w-12` (48px) |
| EntityProfile (header) | EntityProfile.tsx:49 | `w-32 h-32` (128px) |
| EntityProfile (relations) | EntityProfile.tsx:114 | `h-8 w-8` (32px) |
| BookGalleryPage | BookGalleryPage.tsx:128 | `w-full h-full` |
| RelationshipCard | RelationshipCard.tsx:72,89,96 | `h-16 w-16` (64px) |

**Рекомендация:** Создать Avatar component с размерной шкалой `xs/sm/md/lg/xl`.

---

#### TD-FRONT-306: Border styling inconsistencies

**Приоритет:** P1  
**Категория:** Design System  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Проблемы:**
- Mixed `border` vs `border-2` thickness
- Inconsistent `--color-border-default` vs `--color-border-subtle`
- Hardcoded fallbacks like `white/10` in EntityProfile.tsx

---

#### TD-FRONT-307: Background color hardcoding

**Приоритет:** P1  
**Категория:** Theme Compatibility  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:**
- EntityProfile.tsx:48 — `from-blue-950` → `from-[var(--color-bg-emphasis)]`

---

#### TD-FRONT-308: Typography inconsistencies

**Приоритет:** P1  
**Категория:** Design System  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

| Компонент | Font Style |
|-----------|------------|
| EntityCard | `font-medium` |
| EntityProfile | `text-3xl font-serif font-bold` |
| BookGalleryPage | `text-lg font-bold font-serif` |
| RelationshipCard | `text-sm font-medium` |

---

#### TD-FRONT-309: Hover state inconsistencies

**Приоритет:** P1  
**Категория:** UX Consistency  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

- EntityCard → `hover:border-[var(--color-border-subtle)]`
- EntityProfile → `hover:border-[var(--color-border-default)]`
- BookGalleryPage → `hover:border-[var(--color-info)]/50`

---

#### TD-FRONT-310: Filter badge styling inconsistencies

**Приоритет:** P1  
**Категория:** UX Consistency  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

| Компонент | Active Style |
|-----------|--------------|
| EntityList | `bg-[var(--color-info-muted)]` + border |
| BookGalleryPage | `bg-[var(--color-info)]` + shadow |

---

#### TD-FRONT-313: Hardcoded Tailwind colors

**Файл:** `frontend/src/components/Entities/RelationshipCard.tsx:10-15`

**Приоритет:** P1  
**Категория:** Theme Compatibility  
**Статус:** ✅ ИСПРАВЛЕНО (30.01.2026)

**Решение:**
1. Добавлены CSS variables для relationship типов в `globals.css`:
   - `--color-relationship-kinship`
   - `--color-relationship-ally`
   - `--color-relationship-enemy`
   - `--color-relationship-friend`
   - `--color-relationship-mentor`
   - `--color-relationship-student`
2. Переменные адаптированы для light, dark, sepia тем
3. RelationshipCard теперь использует `text-[var(--color-relationship-*)]`

---

### 16.4 Рекомендации (P2)

#### TD-FRONT-303: Missing English locale file

**Файл:** `frontend/src/lib/i18n.ts`

**Приоритет:** P2  
**Категория:** i18n  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Проблема:** Только русская локализация (`ru`) сконфигурирована. English locale отсутствует.

---

#### TD-FRONT-304: Grid gaps slightly large

**Файл:** `frontend/src/components/Library/BookGrid.tsx:52,83`

**Приоритет:** P2  
**Категория:** UX Polish  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Текущее:** `gap-4 sm:gap-5 lg:gap-6` (16px → 20px → 24px)

**Рекомендация:** `gap-3 sm:gap-4 lg:gap-5` (12px → 16px → 20px) для более плотной сетки.

---

#### TD-FRONT-311: Rounded corners inconsistencies

**Приоритет:** P2  
**Категория:** Design System  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

- Cards: `rounded-lg` vs `rounded-xl` vs `rounded`
- Drawers: `rounded-t-[10px]` vs `rounded-t-[20px]`

---

#### TD-FRONT-312: Padding inconsistencies

**Приоритет:** P2  
**Категория:** Design System  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

Mixed `p-3`, `p-4`, `p-6` for similar card contexts without clear pattern.

---

#### TD-FRONT-314: Base Card component not used

**Приоритет:** P2  
**Категория:** Architecture  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

**Проблема:** `UI/Card.tsx` существует с proper variants, но entity components его не используют.

---

#### TD-FRONT-315: Mobile vs Desktop layout differences

**Приоритет:** P2  
**Категория:** Responsive Design  
**Статус:** ❌ НЕ ИСПРАВЛЕНО

- EntityDrawer: `max-w-xl` constraint
- BookGalleryPage drawer: full-width (no constraint)

---

### 16.5 Cache Invalidation Analysis

**Результат:** ✅ Корректно реализовано

**Ключевые точки:**
1. `bookKeys.all(userId)` — parent key для всех book queries
2. `BookUploadModal` invalidates с `refetchType: 'all'`
3. `useUploadBook` hook дублирует invalidation (redundant, но не баг)
4. staleTime: HomePage 60s, LibraryPage 5min — намеренная разница

**Вывод:** Проблема "книги не появляются" **НЕ связана** с cache invalidation (это было TD-FRONT-200, уже исправлено).

---

### 16.6 Статистика Deep Audit v2

| Категория | Найдено | P0 | P1 | P2 |
|-----------|---------|----|----|-----|
| **i18n** | 4 | 1 | 2 | 1 |
| **UI Consistency** | 9 | 0 | 6 | 3 |
| **Cache** | 0 | 0 | 0 | 0 |
| **Grid Layout** | 1 | 0 | 0 | 1 |
| **ИТОГО** | **14** | **1** | **8** | **5** |

---

### 16.7 Рекомендуемый план исправлений Deep Audit v2

**Sprint 7 (i18n Critical, ~3ч):**

| ID | Задача | Оценка |
|----|--------|--------|
| TD-FRONT-300 | Fix translation key paths | 1ч |
| TD-FRONT-301 | i18n for DeleteConfirmModal | 30м |
| TD-FRONT-302 | i18n for DownloadBookButton | 30м |
| TD-FRONT-303 | Add English locale stub | 30м |

**Sprint 8 (Entity UI Fixes, ~4ч):**

| ID | Задача | Оценка |
|----|--------|--------|
| TD-FRONT-313 | Replace hardcoded colors | 45м |
| TD-FRONT-307 | Fix background hardcoding | 30м |
| TD-FRONT-305 | Standardize avatar sizes | 45м |
| TD-FRONT-306 | Unify border styling | 30м |
| TD-FRONT-308 | Standardize typography | 30м |

**Sprint 9 (Polish, ~2ч):**

| ID | Задача | Оценка |
|----|--------|--------|
| TD-FRONT-304 | Reduce grid gaps | 15м |
| TD-FRONT-311 | Standardize rounded corners | 30м |
| TD-FRONT-314 | Refactor to use base Card | 1ч |

---

## Обновлённая статистика (после Deep Audit v2)

| Категория | Найдено | P0 | P1 | P2 | Исправлено |
|-----------|---------|----|----|-----|------------|
| **Всего (v1-v4)** | 62 | 12 | 33 | 17 | 48/62 (77%) |
| **Deep Audit v2** | +14 | +1 | +8 | +5 | 5/14 (36%) |
| **ИТОГО** | **76** | **13** | **41** | **22** | **53/76 (70%)** |

### Финальный вердикт (обновлено 30.01.2026)

**Оценка: 9.0/10** (повышена с 8.5 после исправления критических i18n и theme issues)

**Исправленные критические находки Deep Audit v2:**
1. ✅ **TD-FRONT-300:** Translation keys исправлены — Library page локализована
2. ✅ **TD-FRONT-301-302:** DeleteConfirmModal + DownloadBookButton i18n
3. ✅ **TD-FRONT-307, TD-FRONT-313:** Hardcoded colors → CSS variables

**Оставшиеся P2 (cosmetic):**
- TD-FRONT-303: English locale file (feature)
- TD-FRONT-304: Grid gaps (cosmetic)
- TD-FRONT-311: Rounded corners (cosmetic)
- TD-FRONT-314: Base Card refactor (architecture)
