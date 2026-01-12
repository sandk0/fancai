# Технический анализ проекта fancai

**Дата:** 12 января 2026
**Статус:** Завершён

---

## Содержание

1. [Архитектура Frontend](#архитектура-frontend)
2. [Система кеширования](#система-кеширования)
3. [Мобильная адаптивность](#мобильная-адаптивность)
4. [Backend API](#backend-api)
5. [Дополнительные проблемы](#дополнительные-проблемы)

---

## Архитектура Frontend

### Структура страниц

| Страница | Файл | Строк | Статус |
|----------|------|-------|--------|
| HomePage | `src/pages/HomePage.tsx` | 784 | ⚠️ Требует оптимизации |
| LibraryPage | `src/pages/LibraryPage.tsx` | 636 | ⚠️ Мобильные проблемы |
| BookPage | `src/pages/BookPage.tsx` | 313 | ✅ OK |
| BookReaderPage | `src/pages/BookReaderPage.tsx` | 172 | ⚠️ Фон |
| ImagesGalleryPage | `src/pages/ImagesGalleryPage.tsx` | 386 | ❌ Критические проблемы |
| SettingsPage | `src/pages/SettingsPage.tsx` | 1069 | ⚠️ Удалены настройки чтения |
| ChapterPage | `src/pages/ChapterPage.tsx` | 10 | ❌ Deprecated |

### Компоненты Reader

```
EpubReader.tsx (573 строки)
├── ReaderHeader.tsx - Навигация и прогресс
├── ReaderControls.tsx - Quick settings dropdown
├── ReaderSettingsPanel.tsx - Полные настройки
├── IOSTapZones.tsx - iOS-специфичная навигация
├── PositionConflictDialog.tsx - Синхронизация позиции
└── Hooks:
    ├── useCFITracking.ts (450) - CFI навигация
    ├── useChapterMapping.ts (189) - Mapping глав
    ├── useDescriptionHighlighting.ts (566) - 9 стратегий
    ├── useLocationGeneration.ts - Генерация locations
    └── useEpubThemes.ts - Синхронизация тем
```

### Stores (Zustand)

```typescript
// Основные stores:
reader.ts - Настройки читалки (fontSize, theme, etc.)
auth.ts - Аутентификация
settings.ts - Общие настройки

// Проблема: Нет единого store для изображений
// Каждый компонент использует локальный state
```

---

## Система кеширования

### Многоуровневая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Cache                          │
│  └─ HTTP Cache-Control headers                              │
│     └─ ❌ Не работает для обложек (no-cache)                │
├─────────────────────────────────────────────────────────────┤
│                      Service Worker                         │
│  └─ Workbox strategies:                                     │
│     ├─ CacheFirst: fonts, local images                      │
│     ├─ StaleWhileRevalidate: external images                │
│     ├─ NetworkFirst: API GET                                │
│     └─ ❌ Не перехватывает blob fetch                       │
├─────────────────────────────────────────────────────────────┤
│                      TanStack Query                         │
│  └─ In-memory cache:                                        │
│     ├─ staleTime: 5 минут (по умолчанию)                    │
│     ├─ gcTime: 24 часа                                      │
│     └─ ❌ HomePage staleTime: 0 (всегда refetch)            │
├─────────────────────────────────────────────────────────────┤
│                      IndexedDB (Dexie.js)                   │
│  └─ Persistent storage:                                     │
│     ├─ chapterCache - главы + описания                      │
│     ├─ imageCache - сгенерированные изображения             │
│     ├─ epubCache - EPUB файлы                               │
│     └─ locationCache - epub.js locations                    │
└─────────────────────────────────────────────────────────────┘
```

### Проблемы кеширования

| Ресурс | Ожидаемое | Фактическое | Проблема |
|--------|-----------|-------------|----------|
| Обложки | HTTP Cache 30 дней | Каждый раз fetch | Cache-Control: no-cache |
| Изображения | IndexedDB | IndexedDB ✅ | Токен может истечь |
| Главы | TQ 5 мин + IndexedDB | TQ 5 мин + IndexedDB ✅ | OK |
| Books list | TQ 1 мин | TQ 10 сек | Слишком агрессивно |
| HomePage books | TQ 1 мин | staleTime: 0 | Всегда refetch |

### Cache-Control Headers

```python
# backend/app/middleware/cache_control.py

# Текущая конфигурация:
AUTH_PATHS = ["no-store, no-cache, must-revalidate"]  # ✅
USER_SPECIFIC_PATHS = ["private, no-cache, must-revalidate"]  # ⚠️
IMAGE_FILE_PATHS = ["public, max-age=31536000, immutable"]  # ✅
COVER_PATHS = NOT CONFIGURED  # ❌ ПРОБЛЕМА

# Рекомендация:
COVER_PATHS = ["private, max-age=2592000, must-revalidate"]  # 30 дней
```

---

## Мобильная адаптивность

### Tailwind Breakpoints

```css
/* Используемые breakpoints: */
sm: 640px   /* Планшеты portrait */
md: 768px   /* Планшеты landscape */
lg: 1024px  /* Десктопы */
xl: 1280px  /* Большие десктопы */

/* Проблемные устройства: */
- iPhone SE: 320px (< sm)
- Galaxy Fold: 280px (очень узкий)
- iPad Mini: 768px (граница md)
```

### Проблемные компоненты

#### 1. LibraryPage Filters
```typescript
// Проблема: Progress buttons не помещаются
<div className="flex gap-2 overflow-x-auto">
  {/* 4 кнопки с whitespace-nowrap */}
</div>

// Решение:
<div className="grid grid-cols-2 sm:flex gap-2">
```

#### 2. Sort Dropdown
```typescript
// Проблема: Фиксированная ширина
<div className="min-w-[160px]">

// Решение:
<div className="w-full sm:min-w-[160px]">
```

#### 3. BookCard Dropdown
```typescript
// Проблема: Текст обрезается
<DropdownMenuContent className="w-40">

// Решение:
<DropdownMenuContent className="w-48 sm:w-56 min-w-max">
```

#### 4. ImagesGalleryPage Modal
```typescript
// Проблема: Не помещается на экран
<div className="max-w-4xl">
  <img className="max-h-[70vh]" />
  <div className="p-6">
    <h3 className="text-2xl">

// Решение:
<div className="max-w-4xl max-h-[90vh] flex flex-col">
  <img className="max-h-[60vh] sm:max-h-[70vh] flex-shrink-0" />
  <div className="p-4 sm:p-6 overflow-y-auto">
    <h3 className="text-lg sm:text-2xl">
```

#### 5. Stats Cards
```typescript
// Проблема: 1 колонка на мобильных
<div className="grid grid-cols-1 md:grid-cols-4">

// Решение:
<div className="grid grid-cols-2 md:grid-cols-4">
```

### Touch Targets

```typescript
// Минимальный размер по Apple HIG: 44x44px

// Проблемные компоненты:
ImageGallery.tsx:178   - p-2 = ~24x24px ❌
ImageModal.tsx:276     - min-w-[44px] min-h-[44px] ✅
IOSTapZones.tsx:36     - 8% ширины = ~25px на SE ❌
```

---

## Backend API

### Проблемы Endpoints

#### 1. Chapter endpoint возвращает пустые descriptions
```python
# chapters.py:112-221
response = ChapterDetailResponse(
    descriptions=[],  # ← ВСЕГДА ПУСТО!
    images=images_data,  # ← Изображения есть
)
# Frontend должен запросить /descriptions отдельно
```

#### 2. Нет индекса на GeneratedImage.local_path
```python
# Каждый image request = full table scan
image_result = await db.execute(
    select(GeneratedImage)
    .where(GeneratedImage.local_path == str(file_path))  # ❌ Нет индекса
)
```

#### 3. Cover endpoint без Cache-Control
```python
# books/crud.py:502-537
return FileResponse(
    path=book.cover_image,
    media_type="image/jpeg",
    # ❌ Нет Cache-Control header!
)
```

#### 4. CORS expose headers
```python
# main.py:172-188
expose_headers=["Content-Disposition", "X-Total-Count", "X-Page-Count"]
# ❌ Нет Cache-Control, ETag, Last-Modified
```

### Redis Cache TTL

```python
# core/cache.py:450-460
CACHE_TTL = {
    "book_list": 10,        # ⚠️ Очень короткий
    "chapter_content": 3600,  # ✅ 1 час
    "book_descriptions": 3600,  # ✅ 1 час
}

# Инвалидация:
# ❌ При добавлении описаний chapter_content НЕ инвалидируется
```

---

## Дополнительные проблемы

### Найденные при анализе (не в списке пользователя)

#### Frontend

| # | Проблема | Файл | Серьёзность |
|---|----------|------|-------------|
| 1 | Утечка памяти Object URLs | AuthenticatedImage.tsx:30-102 | 🟠 HIGH |
| 2 | Два useEffect для cleanup | AuthenticatedImage.tsx | 🟡 MEDIUM |
| 3 | Нет IntersectionObserver | ImageGallery.tsx:235 | 🟡 MEDIUM |
| 4 | Promise.all для 50+ запросов | ImagesGalleryPage.tsx:57-81 | 🟠 HIGH |
| 5 | Неправильный cache key | useImages.ts:80-86 | 🟡 MEDIUM |
| 6 | Нет focus trap в modal | ImagesGalleryPage.tsx:342 | 🟡 MEDIUM |
| 7 | Нет Escape handler | ImagesGalleryPage.tsx | 🟡 MEDIUM |
| 8 | Animations без reduced-motion | Весь проект | 🔵 LOW |
| 9 | Нет drag & drop upload | LibraryPage.tsx | 🔵 LOW |
| 10 | Нет undo для удаления | LibraryPage.tsx | 🔵 LOW |

#### Backend

| # | Проблема | Файл | Серьёзность |
|---|----------|------|-------------|
| 1 | Нет ETag/Last-Modified | images.py:44-123 | 🟡 MEDIUM |
| 2 | Нет 304 Not Modified | images.py | 🟡 MEDIUM |
| 3 | Кэш не синхронизирован | chapters.py / descriptions.py | 🟠 HIGH |
| 4 | Orphaned images cleanup | Нет | 🟡 MEDIUM |
| 5 | Race conditions при deletion | images.py | 🟡 MEDIUM |

#### Architecture

| # | Проблема | Описание | Серьёзность |
|---|----------|----------|-------------|
| 1 | Dual progress tracking | CFI + legacy coexist | 🟡 MEDIUM |
| 2 | ChapterPage deprecated | Файл существует но не используется | 🔵 LOW |
| 3 | Settings UI duplication | Accordion + Sidebar разные компоненты | 🟡 MEDIUM |
| 4 | fetch vs axios inconsistency | Разные подходы к auth | 🟠 HIGH |

---

## Рекомендации по архитектуре

### 1. Унификация HTTP клиента

```typescript
// Проблема: fetch не использует interceptors
// Решение: Создать единый wrapper

// frontend/src/api/fetchWithAuth.ts
export async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = getToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
    cache: 'default',
  });

  if (response.status === 401) {
    const newToken = await refreshToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        'Authorization': `Bearer ${newToken}`,
      },
    });
  }

  return response;
}
```

### 2. Централизованный Image Store

```typescript
// frontend/src/stores/images.ts
interface ImageStore {
  // Кэш Object URLs
  objectUrls: Map<string, { url: string; createdAt: number }>;

  // Методы
  getImageUrl(descriptionId: string): Promise<string>;
  revokeExpired(): void;
  clear(): void;
}
```

### 3. Responsive Design System

```typescript
// frontend/src/utils/responsive.ts
export const breakpoints = {
  xs: 320,   // iPhone SE
  sm: 640,   // Tailwind sm
  md: 768,   // Tailwind md
  lg: 1024,  // Tailwind lg
};

export function useBreakpoint() {
  const [width, setWidth] = useState(window.innerWidth);
  // ...
  return {
    isXs: width < breakpoints.sm,
    isSm: width >= breakpoints.sm && width < breakpoints.md,
    // ...
  };
}
```

### 4. Cache Invalidation Strategy

```python
# backend/app/core/cache.py

class CacheInvalidator:
    @staticmethod
    async def on_description_added(book_id: str, chapter_number: int):
        # Инвалидировать все связанные кэши
        await redis.delete(f"chapter_content:{book_id}:{chapter_number}")
        await redis.delete(f"book_descriptions:{book_id}:{chapter_number}")
        await redis.delete(f"chapter_images:{book_id}:{chapter_number}")

    @staticmethod
    async def on_image_generated(description_id: str):
        # Инвалидировать кэш изображений
        await redis.delete(f"description_image:{description_id}")
```

---

## Метрики для мониторинга

| Метрика | Как измерить | Цель |
|---------|--------------|------|
| Cache Hit Rate | Service Worker stats | > 80% |
| Image Load Time | Performance API | < 500ms |
| Token Refresh Rate | API logs | < 1% requests |
| Memory Usage | Chrome DevTools | < 100MB |
| Error Rate | Sentry/Analytics | < 1% |

---

*Связанные документы:*
- [Главный отчёт](./2026-01-12-project-analysis-main.md)
- [Анализ проблем](./2026-01-12-user-issues-analysis.md)
- [План доработок](./2026-01-12-improvements-plan.md)
