# Frontend Reference (Январь 2026)

Полная документация компонентов, хуков и сервисов фронтенда приложения Fancai.

**Продакшен:** https://fancai.ru

---

## Статистика

| Категория | Количество файлов |
|-----------|-------------------|
| Components | 86 |
| Hooks | 56 |
| Services | 9 |
| Stores | 6 |
| Pages | 13 |
| Utils | 10 |

---

## Компоненты

### Reader/ (15 файлов)

Компоненты EPUB-ридера — ядро приложения.

| Компонент | Строк | Описание |
|-----------|-------|----------|
| `EpubReader.tsx` | 573 | Главный EPUB-ридер с CFI навигацией |
| `IOSTapZones.tsx` | ~200 | iOS-специфичные зоны касания для навигации |
| `IOSDebugOverlay.tsx` | ~100 | Отладочный оверлей для iOS (показывает touch events) |
| `PositionConflictDialog.tsx` | 123 | Диалог конфликта позиций чтения (offline sync) |
| `ReaderHeader.tsx` | ~150 | Заголовок ридера с навигацией назад |
| `ReaderSettingsPanel.tsx` | ~300 | Панель настроек (шрифт, размер, тема, режим навигации) |
| `TocSidebar.tsx` | ~200 | Боковая панель содержания книги |
| `SwipeIndicator.tsx` | ~80 | Визуальный индикатор направления свайпа |
| `ProgressIndicator.tsx` | ~100 | Индикатор прогресса чтения (% и страница) |
| `SelectionMenu.tsx` | ~150 | Меню при выделении текста (копировать, выделить) |
| `BookInfo.tsx` | ~100 | Информация о книге (автор, название) |
| `ReaderControls.tsx` | ~120 | Элементы управления ридером |
| `ImageGenerationStatus.tsx` | ~80 | Статус генерации изображений для описания |
| `ExtractionIndicator.tsx` | ~60 | Индикатор извлечения описаний (Gemini API) |
| `ProgressSaveIndicator.tsx` | ~50 | Индикатор сохранения прогресса чтения |

#### EpubReader.tsx — Главный компонент

```typescript
interface EpubReaderProps {
  book: Book;
}

// Ключевые функции:
// - Загрузка и рендеринг EPUB через epub.js
// - CFI-навигация (сохранение/восстановление позиции)
// - Подсветка описаний (9 стратегий поиска)
// - iOS touch-action: pan-x pan-y (без pinch-zoom)
// - Safe-area padding для устройств с notch
```

#### IOSTapZones.tsx — iOS навигация

```typescript
// Три зоны касания:
// - Левая (20%) - предыдущая страница
// - Центр (60%) - показ/скрытие UI
// - Правая (20%) - следующая страница

// CSS:
// touch-action: pan-x pan-y (исключает pinch-zoom)
// overscroll-behavior: contain
```

---

### Settings/ (8 файлов)

Компоненты настроек приложения.

| Компонент | Описание |
|-----------|----------|
| `ReaderSettings.tsx` | Общие настройки ридера |
| `StorageQuotaInfo.tsx` | Информация о квоте хранилища IndexedDB |
| `sections/AccountSettingsSection.tsx` | Настройки аккаунта (email, подписка) |
| `sections/ReadingSettingsSection.tsx` | Настройки чтения (шрифт, размер) |
| `sections/PWASettingsSection.tsx` | Настройки PWA (офлайн-кэш, обновления) |
| `sections/NotificationsSettingsSection.tsx` | Push-уведомления |
| `sections/PrivacySettingsSection.tsx` | Приватность и данные |
| `sections/AboutSettingsSection.tsx` | О приложении |

---

### UI/ (20+ файлов)

Общие UI-компоненты (shadcn/ui + кастомные).

| Компонент | Описание |
|-----------|----------|
| `ThemeSwitcher.tsx` | Переключатель темы (Light/Dark/Sepia/System) |
| `OfflineBanner.tsx` | Баннер офлайн-режима |
| `PWAUpdatePrompt.tsx` | Промпт обновления PWA |
| `IOSInstallInstructions.tsx` | Инструкции установки для iOS Safari |
| `ParsingOverlay.tsx` | Оверлей парсинга книги (Celery) |
| `LazyImage.tsx` | Ленивая загрузка изображений |
| `AuthenticatedImage.tsx` | Изображение с JWT-авторизацией |
| `NotificationContainer.tsx` | Контейнер уведомлений (toast) |
| `ErrorMessage.tsx` | Компонент отображения ошибок |
| `LoadingSpinner.tsx` | Спиннер загрузки |
| `Modal.tsx` | Модальное окно |
| `Dialog.tsx` | Диалоговое окно (shadcn/ui) |
| `Skeleton.tsx` | Скелетон загрузки |
| `Card.tsx` | Карточка |
| `Accordion.tsx` | Аккордеон |
| `Input.tsx`, `Select.tsx` | Элементы форм |
| `Switch.tsx`, `Checkbox.tsx`, `Radio.tsx` | Элементы выбора |

---

### Library/ (6 файлов)

Модульные компоненты библиотеки книг.

| Компонент | Описание |
|-----------|----------|
| `LibraryHeader.tsx` | Заголовок библиотеки |
| `LibraryStats.tsx` | Статистика (всего книг, прочитано) |
| `LibrarySearch.tsx` | Поиск и фильтрация |
| `BookCard.tsx` | Карточка книги |
| `BookGrid.tsx` | Сетка книг |
| `Pagination.tsx` | Пагинация |

---

### Admin/ (5 файлов)

Компоненты админ-панели.

| Компонент | Описание |
|-----------|----------|
| `AdminHeader.tsx` | Заголовок админки |
| `AdminStats.tsx` | Системная статистика |
| `AdminTabNavigation.tsx` | Навигация по вкладкам |
| `AdminMultiNLPSettings.tsx` | Настройки NLP (deprecated) |
| `AdminParsingSettings.tsx` | Настройки парсинга |

---

## Хуки

### /hooks/epub/ (22 файла)

Хуки для работы с EPUB-ридером.

| Хук | Строк | Описание |
|-----|-------|----------|
| `useDescriptionHighlighting.ts` | 566 | 9 стратегий поиска для подсветки описаний |
| `useContentHooks.ts` | 217 | Инъекция стилей в iframe (iOS fixes) |
| `useSwipeGestures.ts` | ~200 | Обработка свайп-жестов |
| `useKeyboardNavigation.ts` | ~150 | Клавиатурная навигация (← → PgUp PgDn) |
| `useEpubThemes.ts` | ~60 | Синхронизация темы EPUB с приложением |
| `useEpubOfflineCache.ts` | ~200 | Офлайн-кэш EPUB (IndexedDB) |
| `useReadingProgress.ts` | ~150 | Прогресс чтения + CFI позиция |
| `useChapterContent.ts` | ~100 | Загрузка контента главы |
| `useChapterLocations.ts` | ~80 | Карта локаций глав |
| `usePageIndicator.ts` | ~60 | Индикатор текущей страницы |
| `usePageMetrics.ts` | ~100 | Метрики страницы (размеры, позиция) |
| `usePageProgress.ts` | ~80 | Прогресс страницы в % |
| `usePageTracking.ts` | ~100 | Трекинг просмотренных страниц |
| `useReaderDimensions.ts` | ~80 | Размеры ридера |
| `useScrollSync.ts` | ~100 | Синхронизация скролла |
| `useSelectionHandler.ts` | ~120 | Обработчик выделения текста |
| `useSidebarToc.ts` | ~100 | Боковое содержание |
| `useTextSelection.ts` | ~80 | Выделение текста |
| `useDescription.ts` | ~100 | Работа с описаниями |
| `useDescriptionExtractor.ts` | ~150 | Извлечение описаний (Gemini API) |
| `useImageHighlight.ts` | ~100 | Подсветка изображений |
| `useEpubEvents.ts` | ~80 | Обработка событий EPUB |

#### useDescriptionHighlighting — 9 стратегий поиска

```typescript
// Стратегии поиска текста описания в контенте:
// 1. Exact match - точное совпадение
// 2. Normalized whitespace - нормализация пробелов
// 3. Word boundary - поиск по границам слов
// 4. Sentence start - начало предложения
// 5. Fuzzy match - нечёткое сопоставление
// 6. Character-level - посимвольный поиск
// 7. Levenshtein distance - расстояние Левенштейна
// 8. Trigram similarity - триграммное сходство
// 9. Semantic fallback - семантический фоллбэк
```

#### useContentHooks — iOS iframe fixes

```css
/* Инъекция стилей в iframe epub.js */
body {
  touch-action: pan-x pan-y;  /* НЕ manipulation! */
  overscroll-behavior: contain;
  cursor: pointer;  /* iOS click event delegation fix */
}

@supports (-webkit-touch-callout: none) {
  /* iOS-only fixes */
  html, body {
    touch-action: pan-x pan-y !important;
    overscroll-behavior-x: none !important;
  }
}
```

---

### /hooks/api/ (5 файлов)

TanStack Query хуки для работы с API.

| Хук | Описание |
|-----|----------|
| `queryKeys.ts` | Централизованные ключи кэша для invalidation |
| `useBooks.ts` | CRUD книг + prefetching + infinite scroll |
| `useChapter.ts` | Загрузка глав + IndexedDB offline cache |
| `useDescriptions.ts` | Описания + LLM extraction trigger |
| `useImages.ts` | Генерация изображений + кэширование |

#### queryKeys.ts — Структура ключей

```typescript
export const queryKeys = {
  books: {
    all: ['books'] as const,
    list: (params?: BookListParams) => [...queryKeys.books.all, 'list', params] as const,
    detail: (id: string) => [...queryKeys.books.all, 'detail', id] as const,
  },
  chapters: {
    all: ['chapters'] as const,
    content: (id: string) => [...queryKeys.chapters.all, 'content', id] as const,
  },
  descriptions: {
    all: ['descriptions'] as const,
    byChapter: (chapterId: string) => [...queryKeys.descriptions.all, 'chapter', chapterId] as const,
  },
  images: {
    all: ['images'] as const,
    byDescription: (descriptionId: string) => [...queryKeys.images.all, 'description', descriptionId] as const,
  },
};
```

---

### /hooks/ (15 top-level файлов)

Общие хуки приложения.

| Хук | Описание |
|-----|----------|
| `useTheme.ts` | Управление темой (Light/Dark/Sepia/System) |
| `useOnlineStatus.ts` | Детекция онлайн/офлайн статуса |
| `usePWAInstall.ts` | Установка PWA (beforeinstallprompt) |
| `useWakeLock.ts` | Wake Lock API (экран не гаснет при чтении) |
| `useHaptics.ts` | Haptic feedback (navigator.vibrate) |
| `useDownloadBook.ts` | Скачивание книги для офлайн |
| `useOfflineBook.ts` | Работа с офлайн-книгой |
| `useEpubOffline.ts` | Офлайн EPUB (IndexedDB) |
| `useReadingSession.ts` | Сессия чтения (time tracking) |
| `useStorageInfo.ts` | Информация о хранилище (quota) |
| `useDebounce.ts` | Debounce значений |
| `useFocusTrap.ts` | Focus trap для модальных окон |
| `useIntersectionObserver.ts` | Intersection Observer |
| `useTranslation.ts` | i18n (ru.ts локализация) |
| `usePushNotifications.ts` | Push-уведомления (VAPID) |

---

## Сервисы

### /services/ (9 файлов)

Сервисы кэширования и синхронизации.

| Сервис | Строк | Описание |
|--------|-------|----------|
| `chapterCache.ts` | ~600 | IndexedDB кэш глав (descriptions + images) |
| `imageCache.ts` | ~500 | IndexedDB офлайн-кэш изображений с auto-cleanup |
| `syncQueue.ts` | 312 | Очередь офлайн-операций с auto-sync |
| `storageManager.ts` | ~600 | Управление хранилищем + quota monitoring |
| `downloadManager.ts` | ~300 | Менеджер скачивания книг |
| `epubCache.ts` | ~200 | Кэш EPUB файлов |
| `websocket.tsx` | ~150 | WebSocket клиент (real-time updates) |
| `pushNotifications.ts` | ~200 | Push-уведомления сервис |
| `db.ts` | ~100 | IndexedDB инициализация (Dexie) |

#### syncQueue.ts — Офлайн синхронизация

```typescript
interface SyncOperation {
  id: string;
  type: 'progress' | 'bookmark' | 'highlight';
  payload: unknown;
  timestamp: number;
  retries: number;
}

// Автоматическая синхронизация при восстановлении соединения
window.addEventListener('online', () => syncQueue.processQueue());
```

---

## Stores (Zustand)

### /stores/ (6 файлов)

Zustand stores для клиентского состояния.

| Store | Размер | Описание |
|-------|--------|----------|
| `auth.ts` | 8,807 B | Аутентификация (JWT, user, tokens) |
| `reader.ts` | 8,697 B | Состояние ридера (position, settings, theme) |
| `books.ts` | 8,029 B | Состояние книг (list, current, filters) |
| `images.ts` | 5,040 B | Состояние изображений (generated, pending) |
| `ui.ts` | 3,779 B | UI-состояние (sidebar, modal, notifications) |
| `index.ts` | 2,045 B | Экспорты всех stores |

#### auth.ts — Аутентификация

```typescript
interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Методы:
// login(email, password)
// logout() - с invalidation токена через token_blacklist
// refreshAccessToken()
// checkAuth()
```

#### reader.ts — Состояние ридера

```typescript
interface ReaderState {
  currentBook: Book | null;
  currentChapter: number;
  position: CFIPosition;
  scrollOffset: number;
  settings: ReaderSettings;
  theme: ThemeName;
  navigationMode: 'swipe' | 'tap';
}
```

---

## Pages (13 файлов)

| Страница | Описание |
|----------|----------|
| `HomePage.tsx` | Главная страница (landing) |
| `LoginPage.tsx` | Авторизация |
| `RegisterPage.tsx` | Регистрация |
| `LibraryPage.tsx` | Библиотека книг |
| `BookPage.tsx` | Страница книги (детали) |
| `BookReaderPage.tsx` | Ридер книги |
| `BookImagesPage.tsx` | Галерея изображений книги |
| `ImagesGalleryPage.tsx` | Общая галерея изображений |
| `ProfilePage.tsx` | Профиль пользователя |
| `SettingsPage.tsx` | Настройки |
| `StatsPage.tsx` | Статистика чтения |
| `AdminDashboardEnhanced.tsx` | Админ-панель |
| `NotFoundPage.tsx` | 404 страница |

---

## Mobile Optimizations (Январь 2026)

### iOS Safari Fixes

**Проблемы:**
1. Вертикальный bounce-эффект при скролле
2. Pinch-to-zoom ломает верстку текста
3. Touch events не работают внутри iframe

**Решения:**

```css
/* globals.css */
body.reader-active {
  overflow: hidden;
  position: fixed;
  width: 100%;
  height: 100%;
  overscroll-behavior: none;
}

.reader-scroll-lock {
  touch-action: pan-x pan-y;  /* НЕ manipulation! */
  overscroll-behavior: none;
}
```

```typescript
// BookReaderPage.tsx - useReaderBodyLock
useEffect(() => {
  document.body.classList.add('reader-active');

  // Safari gesture prevention
  const preventGesture = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });

  return () => {
    document.body.classList.remove('reader-active');
    // cleanup...
  };
}, []);
```

**ВАЖНО:** `manipulation` = `pan-x pan-y pinch-zoom` — он РАЗРЕШАЕТ zoom! Используйте `pan-x pan-y`.

---

## Тестирование

### Покрытие тестами

| Категория | Тестов | Описание |
|-----------|--------|----------|
| Hooks | 18 | useOnlineStatus, useDescriptionHighlighting, useBooks, useProgressSync |
| Components | 5 | EpubReader, LibraryPage |
| Services | 3 | chapterCache, syncQueue |
| **Итого** | **26** | |

### Запуск тестов

```bash
cd frontend
npm test                    # Запуск всех тестов
npm run test:coverage       # С покрытием
npm run test:watch          # Watch mode
```

---

## См. также

- [CLAUDE.md](/CLAUDE.md) — Инструкции для разработки
- [iOS Scroll/Zoom Fix](/docs/reports/2026-01-14-ios-scroll-zoom-fix.md) — Отчёт по iOS-фиксам
- [Theme System](/docs/explanations/architecture/theme-system.md) — Архитектура тем

---

**Обновлено:** 2026-01-15
