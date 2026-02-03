# Повторный аудит Frontend после плана доработок

**Дата:** 3 февраля 2026  
**Контекст:** После выполнения всех 4 фаз плана (`frontend-improvement-plan-2026-02-03.md`), 84 файла изменены, +1316/-3209 строк  
**Метод:** 6 параллельных аудит-агентов + ручная верификация командами

---

## Executive Summary

### Метрики до/после

| Метрика | До доработок | После доработок | Изменение |
|---------|-------------|-----------------|-----------|
| `tsc --noEmit` ошибки | 0 | 0 | — |
| ESLint warnings | 0 | 0 | — |
| `npm run build` | ✅ | ❌ 2 TS-ошибки в `tsconfig-build.json` | 🔴 РЕГРЕССИЯ |
| `npm run build:unsafe` | ✅ | ✅ | — |
| `any` в prod-коде (без тестов) | ~35 | 10 (`as any`) | -71% |
| `eslint-disable` комментарии | 17+ | 8 | -53% |
| `exhaustive-deps` нарушения | 9 | 0 | -100% |
| `DEBUG = import.meta.env.DEV` | 16 | 0 | -100% |
| Самый большой файл (prod) | HomePage 830 строк | useBooks 701 строк | ✅ |
| console.log в prod-коде | ~600 | 559 (без sw.ts, logger.ts) | -7% |
| Хардкод русских строк | ~500 | ~877 (больше UI) | ⚠️ |
| Bundle size (gzip) | не замерялся | 567 KB | задокументировано |

### Оценка: B+ (82/100)

**Значительные улучшения:** архитектура, type safety, exhaustive-deps, логирование  
**Новые проблемы:** регрессия build, console.log не убраны, i18n покрытие неполное  
**Критические находки:** XSS через dangerouslySetInnerHTML, нет CSP, 17 неиспользуемых backend endpoints

---

## Часть 1: Верификация 19 задач плана

### Фаза 0 — Критические исправления

| # | Задача | Статус | Верификация |
|---|--------|--------|-------------|
| 0.1 | Удалить `useNavigate` из `useReadingSession.ts` | ✅ Done | `grep -n useNavigate useReadingSession.ts` → 0 |
| 0.2 | Утечка памяти UIStore (notificationTimers) | ✅ Done | `stores/ui.ts` — Map + clearTimeout ✅ |
| 0.3 | SEO: react-helmet-async + PageMeta на 14 страницах | ✅ Done | `grep -rn PageMeta pages/` → 14 страниц |
| 0.4 | Удалить 9 `eslint-disable exhaustive-deps` | ✅ Done | `grep -rn exhaustive-deps src/` → 0 ✅ |

### Фаза 1 — Type Safety + ESLint

| # | Задача | Статус | Верификация |
|---|--------|--------|-------------|
| 1.1 | Исправить 13 `any` в API layer | ✅ Done | Проверено в client.ts, books.ts, readingSessions.ts |
| 1.2 | Исправить 22 `any` в hooks/components | ✅ Done | Создан `types/epub-internals.d.ts` (36 строк) |
| 1.3 | Исправить `any` в тестах | ❌ Отменено | ESLint не флагует `any` в тестах — корректно |
| 1.4 | 17 react-refresh warnings | ✅ Done | Извлечены entityTypeLabels.ts, useReaderContext.ts, useDialog.ts, WebSocketStatus.tsx |
| 1.5 | Заменить 16 `DEBUG = import.meta.env.DEV` на logger | ✅ Done | `grep -rn "const DEBUG" src/` → 0, `lib/logger.ts` (50 строк) |

### Фаза 2 — Архитектура

| # | Задача | Статус | Верификация |
|---|--------|--------|-------------|
| 2.1 | HomePage.tsx 830→94 строк | ✅ Done | `wc -l pages/HomePage.tsx` → 96 строк |
| 2.2 | useImages.ts 820→3 модуля | ✅ Done | `hooks/api/useImages/` — 4 файла (index + 3 модуля) |
| 2.3 | useEpubLoader.ts 730→188 строк | ✅ Done | + useEpubIOSFixes.ts (151), useEpubRendition.ts (254) |
| 2.4 | Слияние дублей useKeyboardNavigation | ✅ Done | `hooks/shared/useKeyboardNavigation.ts` (87 строк) |
| 2.5 | SyncQueue: sendBeacon + IndexedDB persist | ✅ Done | `services/syncQueue.ts` (887 строк), `db.ts` — таблица pendingSyncRequests |
| 2.6 | Cross-tab sync через BroadcastChannel | ✅ Done | `services/tabSync.ts` (75 строк), интеграция с auth + reader |

### Фаза 3 — UX-polish + i18n

| # | Задача | Статус | Верификация |
|---|--------|--------|-------------|
| 3.1 | i18n для 5 страниц + 6 Home-компонентов | ✅ Done | ~50 ключей в ru/en translation.json |
| 3.2 | Виртуализация BookPage + TocSidebar | ✅ Done | `@tanstack/react-virtual` в BookPage, TocSidebar |
| 3.3 | Удалить 72 мёртвых shadcn HSL переменных | ✅ Done | `globals.css` 1137→1050 строк |
| 3.4 | Graceful degradation IndexedDB | ✅ Done | `services/memoryFallbackCache.ts` (169 строк) |
| 3.5 | Bundle baseline | ✅ Done | 567 KB gzip в `bundle-size-baseline-2026-02-03.md` |

**Итого:** 18/19 выполнено (1 отменено — корректно), все верифицированы командами.

---

## Часть 2: Глубокий аудит текущего состояния

### 2.1 Общая статистика

| Метрика | Значение |
|---------|----------|
| Prod-файлов (.ts/.tsx без тестов, .d.ts) | 252 |
| Prod-строк кода | 49,826 |
| Компонентов (.tsx в components/) | 97 |
| Страниц | 14 |
| Хуков | 66 файлов, 14,165 строк |
| Сервисов | 16 файлов, 5,649 строк |
| Zustand stores | 5 (1,215 строк) |
| Типов | 6 файлов, 1,206 строк |
| Тестов (unit) | 12 файлов |
| Тестов (E2E) | 8 файлов |

### 2.2 Архитектура

**Сильные стороны:**
- ✅ Чёткое разделение: pages → components → hooks → api → services → stores
- ✅ Path aliases (`@/`) используются на 100%
- ✅ 0 циклических зависимостей
- ✅ 9 страниц lazy-loaded через React.lazy
- ✅ 11 barrel-exports (index.ts) в ключевых директориях

**Проблемы:**

| Проблема | Файлы | Строки |
|----------|-------|--------|
| Компоненты > 200 строк | PWASettingsSection (525), Radio (523), IOSTapZones (488), Skeleton (464), BookUploadModal (462), ImageModal (421), Modal (410), ReaderSettingsPanel (392), BookReader (387), ImageGallery (375) | 10 файлов |
| Страницы > 300 строк | ImagesGalleryPage (601), StatsPage (484), RegisterPage (410), BookPage (374), ProfilePage (363), AdminDashboard (342), LibraryPage (318) | 7 файлов |
| Хуки > 400 строк | useBooks (701), useImageModal (606), useTouchNavigation (535), useChapter (518), useSwipeNavigation (506), useReadingSession (491), useEpubNavigation (477), useCFITracking (451), useDescriptions (438), queryKeys (425) | 10 файлов |
| Отсутствуют barrel exports | Reader/ (19 файлов), UI/ (34 файла), Library/, Admin/, Entities/, Layout/, Images/, SEO/, Books/, Auth/ | 10 директорий |

### 2.3 Type Safety

| Категория | Количество | Детали |
|-----------|------------|--------|
| `as any` в prod (без тестов) | 10 | iosSupport:1, useEpubNavigation:4 (`__iosDebug`), useSwipeNavigation:1, test/setup.ts:4 |
| `as unknown as` | 24 | Все оправданы: epub.js interop, Dexie fallback, experimental APIs |
| `@ts-expect-error` | 7 | IOSTapZones:1, useTouchNavigation:3, useSwipeNavigation:3 — Safari/epub.js custom properties |
| `eslint-disable` | 8 | test/setup:1, iosSupport:1, useEpubNavigation:4, useSwipeNavigation:1, memoryFallbackCache:1 |
| Типы (types/) | 1,206 строк | api.ts (400), epub.ts (265), state.ts (249), push.ts (216), entity.ts (40), epub-internals.d.ts (36) |

**Регрессия build:**
```
src/api/books.ts(178,35): error TS2339: Property 'reading_location_cfi' does not exist on type
  'ReadingProgress | { progress: ReadingProgress; }'.
```
`npm run build` использует `tsconfig-build.json` (strict: false), `tsc --noEmit` — `tsconfig.json` (strict: true). Ошибка в narrowing на строке 178: после `'progress' in response` проверки, else-ветка не сужает тип корректно.

### 2.4 State Management

| Store | Строк | Назначение | Оценка |
|-------|-------|------------|--------|
| reader.ts | 310 | Настройки чтения, прогресс, закладки | ✅ Отлично — persist + tabSync |
| books.ts | 263 | Список книг, пагинация, текущая книга | 🔴 **Дублирует TanStack Query** |
| auth.ts | 198 | Пользователь, токены, авторизация | ✅ Отлично — persist + tabSync |
| ui.ts | 187 | Модалки, уведомления, загрузка | ✅ Отлично — таймеры без утечек |
| images.ts | 184 | Изображения, статус генерации | 🔴 **Дублирует TanStack Query** |
| index.ts | 73 | Инициализация + cleanup | ✅ Хорошо |

**Критическая проблема:** `books.ts` и `images.ts` дублируют серверное состояние, которое уже управляется через `useBooks()`, `useBookImages()` хуки TanStack Query. Два источника правды → несогласованность кеша, ручная инвалидация, ~450 лишних строк.

### 2.5 Hooks

- **273 вызова** useMemo/useCallback (хорошая мемоизация)
- **109 useEffect** — все с корректными зависимостями (ESLint enforces)
- **47 таймеров**, 41 cleanup — 6 без cleanup (проверены: все оправданы)
- **React.memo** на 6 компонентах (мало — рекомендуется больше для Reader/)
- **Виртуализация** в 4 компонентах: TocSidebar, BookGrid, EntityList, BookPage

### 2.6 Services

| Сервис | Строк | Назначение |
|--------|-------|------------|
| storageManager.ts | 1,021 | Квоты, LRU cleanup, мониторинг |
| syncQueue.ts | 887 | Offline-first sync + sendBeacon + iOS fallback |
| imageCache.ts | 630 | IndexedDB + Object URL tracking (100 URL max, 30 мин TTL) |
| chapterCache.ts | 587 | IndexedDB + TTL 7 дней + LRU 50 chapters/book |
| epubCache.ts | 582 | IndexedDB + LRU 200MB |
| pushNotifications.ts | 501 | Web Push API + iOS detection |
| downloadManager.ts | 462 | Offline downloads + progress |
| db.ts | 351 | Dexie.js — 6 таблиц + IndexedDB check |
| memoryFallbackCache.ts | 169 | In-memory fallback для private browsing ✅ NEW |
| errorClassifier.ts | 145 | Категоризация ошибок (NETWORK/AUTH/SERVER/CLIENT) |
| visibilityManager.ts | 143 | Центральная очередь visibilitychange |
| tabSync.ts | 75 | BroadcastChannel — logout/auth/progress ✅ NEW |
| websocket.tsx | 74 | ⚠️ ОТКЛЮЧЁН — backend не поддерживает cookie auth |
| EntityService.ts | 12 | Заглушка |
| WebSocketStatus.tsx | 10 | Заглушка |

### 2.7 i18n

| Файл | Строк | Ключей |
|------|-------|--------|
| ru/translation.json | 508 | ~90 top-level |
| en/translation.json | 418 | ~90 top-level |
| ru.ts (LEGACY) | 611 | **НЕ ИСПОЛЬЗУЕТСЯ** — удалить |

**Покрытие i18n:**
- ✅ 5 страниц используют `t()`: HomePage, StatsPage, ProfilePage, ImagesGalleryPage, AdminDashboard
- ❌ 9 страниц с хардкод русским: RegisterPage (~30 строк), LoginPage (~10), BookPage (~20), BookReaderPage (~10), SettingsPage (~6), LibraryPage, NotFoundPage, BookImagesPage, BookGalleryPage
- ❌ ~60+ хардкод строк в компонентах: ThemeSwitcher (5), PWAUpdatePrompt (4), IOSPushGuidance (15+), ParsingOverlay (8), ErrorMessage (2), OfflineBanner (6), ReaderSettingsPanel (4), EntityProfile (8), EntityList (3), RelationshipCard (6)
- ❌ ~15 хардкод строк в hooks: useAutoParser (4), useReadingSession (3), useBookProcessing (1), useLibraryFilters (JSDoc)

### 2.8 SEO

| Элемент | Статус |
|---------|--------|
| PageMeta (react-helmet-async) | ✅ На 14 страницах |
| Open Graph tags | ✅ og:title, og:description, og:image, og:type |
| Twitter Cards | ❌ Отсутствуют |
| Canonical URL | ❌ Отсутствует |
| JSON-LD structured data | ❌ Отсутствует |
| manifest.json | ✅ 95 строк — PWA-ready |
| robots.txt | ❌ Отсутствует |
| sitemap.xml | ❌ Отсутствует |

### 2.9 Styles

- `globals.css` — 1,050 строк, 5 тем (light, dark, sepia, outdoor, night)
- Tailwind + CSS variables — чистая архитектура
- 82 inline `style={}` — все оправданы (dynamic values, z-index, virtualization)
- 0 CSS modules, 0 styled-components
- 0 явного мёртвого CSS

### 2.10 Performance

| Паттерн | Количество |
|---------|------------|
| useMemo + useCallback | 273 |
| React.memo | 6 компонентов |
| React.lazy | 9 страниц |
| @tanstack/react-virtual | 4 списка |
| loading="lazy" для img | 1 (мало!) |
| Code splitting | Хорошее — по страницам |

---

## Часть 3: Frontend ↔ Backend соответствие

### Покрытие по роутерам

| Backend Router | Endpoints | Frontend API | Frontend Hooks | Покрытие |
|---------------|-----------|-------------|----------------|----------|
| auth | 7 | ✅ 7/7 (auth.ts) | ❌ 0 hooks | API ✅ Hooks ❌ |
| users | 6 | ✅ 5/6 | ❌ 0 hooks | ⚠️ missing admin/stats |
| chapters | 2 | ✅ 1/2 | ✅ useChapter | ⚠️ missing list chapters |
| descriptions | 4 | ✅ 3/4 (через booksAPI) | ✅ useDescriptions | ⚠️ missing GET by ID |
| images | 13 | ✅ 12/13 | ✅ useImages/* (3 файла) | ⚠️ missing async batch |
| reading_sessions | 7 | ✅ 4/7 | ❌ 0 hooks | ⚠️ missing beacon/batch |
| reading_progress | 2 | ✅ 2/2 (через booksAPI) | ❌ 0 hooks | API ✅ Hooks ❌ |
| sync | 1 | ❌ 0 (service worker) | ❌ 0 | Обрабатывается SW |
| websocket | 1 | ❌ 0 (отключён) | ❌ 0 | Backend не поддерживает cookie auth |
| push | 5 | ❌ 0 | ❌ 0 | 🔴 Не реализовано |
| health | 4 | ✅ 1/4 (healthCheck) | ❌ 0 | ⚠️ missing deep/sessions/metrics |

### Общая статистика

- **Backend endpoints:** ~52 (без admin)
- **Frontend API покрытие:** ~35/52 (67%)
- **Frontend Hooks покрытие:** ~15/52 (29%)
- **Отсутствующие API файлы:** descriptions.ts, sync.ts, push.ts, health.ts

### Несоответствия типов

1. **Auth Response:** Backend возвращает `{ tokens: { access_token, refresh_token }, user, message }`, Frontend ожидает плоский `{ access_token, refresh_token, user }`
2. **Reading Progress (books.ts:178):** Тип `ReadingProgress | { progress: ReadingProgress }` — не narrowing корректно, вызывает TS2339 при build

### Неиспользуемые backend endpoints (17 штук)

1. `GET /users/admin/stats`
2. `GET /books/{id}/chapters` (список глав)
3. `GET /descriptions/{id}` (по ID)
4. `POST /images/generate/async/chapter/{id}` (batch async)
5. `POST /reading-sessions/{id}/beacon`
6. `POST /reading-sessions/{id}/end-beacon`
7. `POST /reading-sessions/batch-update`
8. `POST /sync/batch`
9. `WS /ws/book-progress/{id}`
10. `GET /push/vapid-public-key`
11. `POST /push/subscribe`
12. `DELETE /push/unsubscribe`
13. `GET /push/subscriptions`
14. `POST /push/test`
15. `GET /health/reading-sessions`
16. `GET /health/deep`
17. `GET /metrics`

---

## Часть 4: Новые находки

### 4.1 Security

| Проблема | Серьёзность | Файл | Строка |
|----------|-------------|------|--------|
| **XSS:** dangerouslySetInnerHTML для EPUB-контента | 🔴 HIGH | Reader/ReaderContent.tsx | 68 |
| **Нет CSP** (Content Security Policy) | 🔴 HIGH | index.html | — |
| localStorage для sensitive data (user info) | 🟡 MEDIUM | stores/auth.ts | 34 |
| CORS — нет frontend-side валидации | 🟡 MEDIUM | api/client.ts | 15 |

**Положительное:**
- ✅ HttpOnly cookies для auth-токенов
- ✅ Нет хардкод API-ключей в коде
- ✅ DOMPurify используется для sanitize (но конфиг не ужесточён)
- ✅ localStorage очищается при logout

### 4.2 Accessibility

| Категория | Количество | Оценка |
|-----------|------------|--------|
| aria-* атрибуты | 263 в 65 файлах | ✅ Хорошо |
| alt на изображениях | 18 в 14 файлах | ⚠️ Неинформативные ("Generated image") |
| Keyboard handlers | 18 в 11 файлах | ⚠️ Неполные |
| Focus trap | 2 модалки | 🔴 Мало (useFocusTrap хук есть, но не используется) |
| Skip link | 0 | 🔴 Отсутствует |
| Color contrast testing | 0 | 🔴 Нет автотестов |

### 4.3 Testing

| Категория | Файлов | Строк |
|-----------|--------|-------|
| Unit tests (Vitest) | 12 | 6,435 |
| E2E tests (Playwright) | 8 | — |
| Coverage threshold | 40% | 🔴 Низкий |

**Области без тестов:**
- Image generation flow (useImageModal)
- Reading sessions (useReadingSession)
- Offline sync (syncQueue)
- PWA features (sw.ts, push)
- Admin panel
- Settings pages
- Auth E2E flow

### 4.4 Другие проблемы

| Проблема | Количество | Детали |
|----------|------------|--------|
| console.log в prod-коде | 559 | books.ts:8, auth.ts:25, client.ts:11, config/env.ts:6, stores/reader.ts:2, и др. |
| TODO/FIXME | 5 | ErrorBoundary:1, useDescriptions:1, useImageMutations:1, NotFoundPage:1, websocket.tsx:1 |
| isIOS() дубль | 2 реализации | platform.ts (9 строк) vs iosSupport.ts (452 строк) — **разная логика!** |
| Legacy ru.ts | 611 строк | Не используется, нужно удалить |
| Bundle size в README | "386KB gzip" | Реальный: 567 KB gzip — обновить README |
| CI check-bundle-size.js | Сломан | Ищет JS в dist/assets/ вместо dist/assets/js/ |
| Outdated dependencies | ~19 пакетов | @hookform/resolvers (3→5), @vitejs/plugin-react (4→5), vitest (2→4) |

### 4.5 isIOS() дублирование — детали

```typescript
// utils/platform.ts (9 строк) — используется в 2 местах
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
}

// utils/iosSupport.ts (452 строк) — используется в 15+ местах
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}
```

**Разница:** platform.ts определяет iPadOS (MacIntel + touch), iosSupport.ts исключает MSStream (IE11). Нужно объединить.

---

## Приложение: Таблица верификации команд

| Команда | Результат |
|---------|-----------|
| `npx tsc --noEmit` | ✅ 0 ошибок |
| `npm run lint` | ✅ 0 warnings, 0 errors |
| `npm run build` | ❌ 2 TS2339 ошибки (books.ts:178) |
| `npm run build:unsafe` | ✅ Success |
| `grep -rn "exhaustive-deps" src/` | 0 |
| `grep -rn "const DEBUG" src/` | 0 |
| `grep -rn "as any" src/ (prod)` | 10 (4 в test/setup) |
| `grep -rn "@ts-expect-error" src/ (prod)` | 7 |
| `grep -rn "eslint-disable" src/ (prod)` | 8 |
| `grep -c "as unknown as" src/ (prod)` | 24 |
| `wc -l globals.css` | 1,050 |
| `wc -l ru/translation.json` | 508 |
| `wc -l en/translation.json` | 418 |
| Prod source files | 252 |
| Prod lines of code | 49,826 |
| console.log в prod (без sw.ts, logger.ts) | 559 |
