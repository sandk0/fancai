# Frontend Architecture Analysis

**Дата:** 2026-01-21
**Scope:** Полный анализ frontend архитектуры fancai
**Автор:** Claude Code

## Executive Summary

Frontend проекта fancai представляет собой **зрелое PWA-приложение** для чтения художественной литературы с AI-генерацией изображений. Архитектура включает **86 React компонентов** (18,355 LOC), **52 custom hooks**, **6 Zustand stores** и **7 service классов**. Ключевая особенность — sophisticated offline-first архитектура с многоуровневым кэшированием (TanStack Query + IndexedDB + Object URLs).

**Ключевые метрики:**
| Метрика | Значение |
|---------|----------|
| Компоненты | 86 файлов, 18,355 LOC |
| Custom Hooks | 52 файла |
| Zustand Stores | 6 |
| API Hooks | 25+ |
| IndexedDB Таблицы | 5 |
| Bundle Chunks | 7 |

---

## 1. Technology Stack

| Layer | Technology | Version | Status |
|-------|-----------|---------|--------|
| Framework | React | 19.0.0 | Latest |
| Build Tool | Vite | 6.0.6 | Latest |
| TypeScript | TypeScript | 5.7.2 | Latest |
| Routing | React Router | 7.1.0 | Latest |
| State (Server) | TanStack Query | 5.90.12 | Latest |
| State (Client) | Zustand | 5.0.2 | Latest |
| HTTP Client | Axios | 1.7.9 | Current |
| EPUB Reader | epub.js | 0.3.93 | Original |
| UI Components | shadcn/ui + Radix | Latest | Current |
| Styling | Tailwind CSS | 3.4.17 | Stable |
| Animations | Framer Motion | 11.15.0 | Latest |
| Offline Storage | Dexie (IndexedDB) | 4.2.1 | Latest |
| PWA | Workbox | 7.4.0 | Latest |
| Testing | Vitest + Playwright | Latest | Current |

---

## 2. Directory Structure

```
frontend/src/
├── main.tsx                 # Entry point
├── App.tsx                  # Router configuration (154 LOC)
├── sw.ts                    # Service Worker (25KB, custom Workbox)
│
├── api/                     # API layer (7 files)
│   ├── client.ts            # Axios instance with interceptors
│   ├── auth.ts, books.ts, images.ts, admin.ts
│   └── readingSessions.ts
│
├── components/              # React components (86 files, 18,355 LOC)
│   ├── Reader/              # EPUB Reader (20 files) ⭐ KEY
│   ├── UI/                  # shadcn/ui components (29 files)
│   ├── Library/             # Book library (8 files)
│   ├── Layout/              # App layout (3 files)
│   ├── Settings/            # User settings (6 files)
│   ├── Admin/               # Admin panel (7 files)
│   └── ...others
│
├── hooks/                   # Custom hooks (52 files)
│   ├── epub/                # EPUB hooks (15 files) ⭐ KEY
│   ├── api/                 # TanStack Query hooks (7 files)
│   ├── reader/              # Reader page hooks (6 files)
│   └── ...utility hooks
│
├── services/                # Business logic (7 files)
│   ├── db.ts                # Dexie IndexedDB config
│   ├── chapterCache.ts      # Chapter caching
│   ├── epubCache.ts         # EPUB file caching
│   ├── imageCache.ts        # Image caching + Object URLs
│   ├── syncQueue.ts         # Offline sync queue
│   ├── storageManager.ts    # Storage quota management
│   └── websocket.tsx        # Real-time notifications
│
├── stores/                  # Zustand stores (6 files)
│   ├── auth.ts              # Auth state (persisted)
│   ├── reader.ts            # Reader settings (persisted)
│   ├── ui.ts                # UI state (modals, notifications)
│   ├── books.ts             # Books list state
│   └── images.ts            # Image generation state
│
├── pages/                   # Page components (14 files)
├── types/                   # TypeScript types (4 files)
├── utils/                   # Utility functions (10 files)
├── lib/                     # Shared libraries (3 files)
├── locales/                 # i18n (en, ru)
└── styles/                  # CSS (globals, animations, typography)
```

---

## 3. Component Architecture

### 3.1 Component Distribution

| Module | Files | LOC | Purpose |
|--------|-------|-----|---------|
| **Reader** | 20 | ~5,500 | EPUB/FB2 reading, navigation, progress |
| **UI** | 29 | ~2,500 | shadcn/ui base + custom components |
| **Library** | 8 | ~1,500 | Book grid, search, pagination |
| **Settings** | 6 | ~800 | User preferences |
| **Admin** | 7 | ~1,200 | Admin dashboard |
| **Layout** | 3 | ~600 | Header, Sidebar, Layout |
| **Others** | 13 | ~600 | Auth, Navigation, Images, Errors |

### 3.2 Key Component: EpubReader

**Файл:** `src/components/Reader/EpubReader.tsx`
**Размер:** 1,122 LOC
**Зависимости:** 18+ custom hooks

```
EpubReader (Container)
├── useEpubLoader          # EPUB initialization + IndexedDB cache
├── useLocationGeneration  # CFI locations (5-10s → <100ms cached)
├── useCFITracking         # Hybrid CFI + scroll position
├── useProgressSync        # Debounced sync (60→0.2 req/s)
├── useDescriptionHighlighting  # 9 search strategies
├── useSwipeNavigation     # Touch gestures
├── useTouchNavigation     # iOS tap zones
├── useKeyboardNavigation  # Arrow keys
├── useEpubThemes          # Light/Dark/Sepia
└── ... 10+ more hooks
```

### 3.3 Component Patterns

**Паттерн 1: Memoization**
```tsx
export const ReaderHeader = memo(function ReaderHeader({...props}) {
  return <div>...</div>;
});
// 60+ мемоизаций в Reader компонентах
```

**Паттерн 2: CVA для вариантов**
```tsx
const buttonVariants = cva("base-styles", {
  variants: {
    variant: { default: "...", destructive: "...", outline: "..." },
    size: { default: "h-10", sm: "h-9", lg: "h-11" }
  }
});
```

---

## 4. State Management

### 4.1 Hybrid Architecture

```
┌─────────────────────────────────────────────────────┐
│ Server State: TanStack Query                        │
│ - API data caching (staleTime: 1-5 min)             │
│ - Automatic background refetch                      │
│ - Optimistic updates                                │
│ - Offline placeholderData from IndexedDB            │
└─────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────┐
│ Client State: Zustand                               │
│ - Auth (persisted + rehydration)                    │
│ - Reader settings (persisted)                       │
│ - UI (modals, notifications)                        │
│ - Books list pagination                             │
└─────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────┐
│ Local State: useState/useRef                        │
│ - Component-specific state                          │
│ - EPUB CFI tracking                                 │
│ - Transient UI state                                │
└─────────────────────────────────────────────────────┘
```

### 4.2 Query Key Security

```typescript
// Все query keys ТРЕБУЮТ userId для изоляции данных
const bookKeys = {
  all: (userId) => ['books', userId],
  detail: (userId, bookId) => [...bookKeys.all(userId), bookId],
};

// Предотвращает утечку данных между пользователями
```

### 4.3 Zustand Stores Summary

| Store | Persistence | Purpose |
|-------|-------------|---------|
| `useAuthStore` | localStorage + rehydration | User session, tokens |
| `useReaderStore` | localStorage | Reader settings, bookmarks |
| `useUIStore` | Memory only | Modals, notifications |
| `useBooksStore` | Memory only | Books list pagination |
| `useImagesStore` | Memory only | Image generation |

---

## 5. Services Architecture

### 5.1 IndexedDB Schema (Dexie)

| Table | Purpose | Keys | TTL |
|-------|---------|------|-----|
| `chapters` | Cached chapter content | `[userId+bookId], lastAccessedAt` | 7 days |
| `images` | Cached generated images | `userId, bookId, descriptionId` | 30 days |
| `offlineBooks` | Downloaded book metadata | `userId, bookId` | - |
| `syncQueue` | Offline operations queue | `userId, priority, status` | - |
| `readingProgress` | Offline progress | `userId, bookId` | - |

### 5.2 Multi-Layer Caching

```
┌──────────────────────────────────┐
│ Layer 1: TanStack Query          │ staleTime: 1-5 min
│ (Memory Cache)                   │ instant access
└────────────────┬─────────────────┘
                 │
┌────────────────▼─────────────────┐
│ Layer 2: Dexie IndexedDB         │ TTL: 7-30 days
│ (Persistent Cache)               │ milliseconds access
└────────────────┬─────────────────┘
                 │
┌────────────────▼─────────────────┐
│ Layer 3: API Server              │ network latency
│ (Source of Truth)                │
└──────────────────────────────────┘
```

### 5.3 Offline-First Flow

```
1. Check IndexedDB cache → instant return if found
2. If online → background refetch
3. If offline → show cached data only
4. Mutations → add to SyncQueue
5. On reconnect → process SyncQueue
```

### 5.4 iOS Safari Fallbacks

| Feature | iOS Support | Fallback |
|---------|------------|----------|
| Background Sync | ❌ | Periodic sync (30s) |
| Persistent Storage | ⚠️ | sendBeacon + localStorage |
| storage.estimate() | ⚠️ | 50 MB fallback |

---

## 6. Build Configuration

### 6.1 Bundle Optimization

```javascript
// vite.config.ts manualChunks
{
  'vendor-react': ['react', 'react-dom'],
  'vendor-router': ['react-router-dom'],
  'vendor-data': ['@tanstack/react-query', 'zustand', 'axios'],
  'vendor-ui': ['framer-motion', 'lucide-react'],
  'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
  'vendor-radix': ['@radix-ui/*'],
  'vendor-utils': ['clsx', 'tailwind-merge', 'dompurify']
}
```

### 6.2 TypeScript Configuration

| Config | strict | noUnusedLocals | Purpose |
|--------|--------|----------------|---------|
| tsconfig.json | ✅ true | ✅ true | Development |
| tsconfig-build.json | ❌ false | ❌ false | Production |

⚠️ **Проблема:** Build config намного мягче development config.

### 6.3 PWA Configuration

- **Strategy:** injectManifest (custom Service Worker)
- **Workbox:** 7.4.0
- **Offline:** Full chapter + image caching
- **Background Sync:** Workbox BackgroundSyncPlugin

---

## 7. Findings

### 7.1 Strengths

| # | Finding | Impact |
|---|---------|--------|
| 1 | Modern stack (React 19, Vite 6, TS 5.7) | High maintainability |
| 2 | Comprehensive offline-first architecture | Excellent UX |
| 3 | userId isolation in all queries | Data security |
| 4 | 52 focused custom hooks | Good separation |
| 5 | Multi-layer caching strategy | Performance |
| 6 | iOS-specific optimizations | Mobile UX |
| 7 | CVA pattern for UI variants | Consistency |
| 8 | Hybrid state management | Clean architecture |

### 7.2 Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | tsconfig-build.json too permissive | HIGH | `tsconfig-build.json` |
| 2 | EpubReader too large (1,122 LOC, 18+ hooks) | MEDIUM | `EpubReader.tsx` |
| 3 | epub.js not lazy-loaded (~800KB) | MEDIUM | `vite.config.ts` |
| 4 | Test coverage threshold 40% | MEDIUM | `vitest.config.ts` |
| 5 | No barrel exports in Reader/, Library/ | LOW | Component dirs |
| 6 | Mixed file naming (button.tsx vs Button.tsx) | LOW | UI components |
| 7 | No Storybook for UI documentation | LOW | - |

---

## 8. Recommendations

### P0 (Critical)

| # | Recommendation | Effort | Why |
|---|---------------|--------|-----|
| 1 | Align tsconfig-build.json with strict mode | Low | Prevents production bugs |

### P1 (Important)

| # | Recommendation | Effort | Why |
|---|---------------|--------|-----|
| 1 | Add barrel exports to Reader/, Library/, UI/ | Low | Simplifies imports |
| 2 | Lazy-load epub.js via code splitting | Medium | Reduces initial bundle |
| 3 | Increase test coverage threshold to 60% | Medium | Better reliability |
| 4 | Add Storybook for UI components | Medium | Documentation |

### P2 (Improvement)

| # | Recommendation | Effort | Why |
|---|---------------|--------|-----|
| 1 | Split EpubReader into smaller components | Medium | Reduce complexity |
| 2 | Standardize file naming (all PascalCase) | Low | Consistency |
| 3 | Centralize modal management | Medium | Cleaner state |
| 4 | Extract common EpubReader/BookReader logic | Medium | DRY |

### P3 (Optional)

| # | Recommendation | Effort | Why |
|---|---------------|--------|-----|
| 1 | Add snapshot tests for UI components | Medium | Visual regression |
| 2 | Consider Compound Components for Reader | High | Flexible API |

---

## 9. Next Steps

1. **Immediate:** Fix tsconfig-build.json strict settings
2. **This week:** Add barrel exports, increase test coverage
3. **This sprint:** Implement lazy loading for epub.js, add Storybook
4. **Planning:** Consider EpubReader refactoring

---

## Appendix A: Key Files Reference

### Backend Integration

| File | Purpose |
|------|---------|
| `src/api/client.ts` | Axios instance + auth interceptors |
| `src/api/books.ts` | Books API calls |
| `src/hooks/api/useBooks.ts` | TanStack Query hooks |
| `src/hooks/api/queryKeys.ts` | Centralized query keys |

### EPUB Reader

| File | Purpose |
|------|---------|
| `src/components/Reader/EpubReader.tsx` | Main reader container |
| `src/hooks/epub/useEpubLoader.ts` | EPUB initialization |
| `src/hooks/epub/useCFITracking.ts` | Position tracking |
| `src/hooks/epub/useDescriptionHighlighting.ts` | Text highlighting |

### Services

| File | Purpose |
|------|---------|
| `src/services/db.ts` | Dexie IndexedDB setup |
| `src/services/chapterCache.ts` | Chapter caching |
| `src/services/syncQueue.ts` | Offline sync |
| `src/services/storageManager.ts` | Storage management |

---

## Appendix B: Performance Metrics

| Optimization | Before | After | Improvement |
|--------------|--------|-------|-------------|
| Location generation | 5-10s | <100ms | 50-100x |
| Progress sync | 60 req/s | 0.2 req/s | 300x |
| Description search | Baseline | 3-5x faster | Strategy batching |
| Page restoration | 1-2 page offset | Pixel-perfect | Hybrid CFI |

---

**End of Report**
