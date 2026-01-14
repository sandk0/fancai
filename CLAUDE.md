# CLAUDE.md

Guidance for Claude Code when working with fancai repository.

## Project Overview

**fancai** - Web application for reading fiction with automatic image generation from book descriptions. Subscription-based monetization (FREE/PREMIUM/ULTIMATE).

**Core Value:** LLM-powered extraction of visual descriptions + AI image generation.

> **NLP REMOVAL (December 2025):** Multi-NLP system (SpaCy, Natasha, Stanza, GLiNER) removed for server optimization. Description extraction now via Google Gemini API. RAM: 10-12 GB -> 2-3 GB (-75%), Docker: 2.5 GB -> 800 MB (-68%).

## Technology Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 19 + TypeScript 5.7 | UI framework |
| epub.js 0.3.93 | EPUB rendering with CFI navigation |
| Tailwind CSS 3.4 | Styling |
| TanStack Query 5.90 | Server state management |
| Zustand 5 | Client state |
| Vite 6 | Build tool |

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI 0.125 + Python 3.11 | API framework |
| PostgreSQL 15 | Primary database |
| Redis 5.2 | Caching + task queue |
| Celery 5.4 | Background processing |
| SQLAlchemy 2.0.45 + Alembic 1.14 | ORM + migrations |

### Description Extraction (December 2025)

**Current Architecture:** LLM-Only Mode via Google Gemini 3.0 Flash API
- Extracts descriptions on-demand when user opens chapter
- Supports Russian -> English translation for image prompts
- Cost: ~$0.02/book (Gemini 3.0 Flash: $0.50/1M input, $3/1M output tokens)
- RAM: ~500 MB (vs 2.2 GB for NLP models)

> **DEPRECATED:** Multi-NLP Ensemble (SpaCy, Natasha, Stanza, GLiNER) removed December 2025.

**Image Generation:** Google Imagen 4 GA (imagen-4.0-generate-001, $0.04/image)

### Feature Flags
Database-backed feature control. Key flags:
```
ENABLE_IMAGE_CACHING = True       # Image generation cache
```
Admin API: `GET/POST/PUT/DELETE /api/v1/admin/feature-flags`

### Theme System (January 2026)

**Single Source of Truth:** shadcn/ui CSS variables in `globals.css`

**Themes:**
- Light (default)
- Dark (`.dark` class)
- Sepia (`.sepia` class)
- System (auto-detect via `prefers-color-scheme`)

**CSS Variables Location:** `frontend/src/styles/globals.css`

**Tailwind Integration:**
- Semantic tokens: `bg-background`, `text-foreground`, `border-border`, etc.
- Sepia variant: `sepia-theme:` for sepia-specific styles
- Highlight colors: `bg-highlight`, `border-highlight-border`

**Theme Hooks:**
- `useTheme()` - returns theme, resolvedTheme, setTheme
- `useEpubThemes()` - syncs EPUB reader with app theme

**Storage:** `localStorage` key `app-theme`

## Key Files

### Backend Services (Total: 8,400+ lines in 17+ services)
| File | Lines | Purpose |
|------|-------|---------|
| `app/services/book_parser.py` | 925 | EPUB/FB2 parsing + CFI generation |
| `app/services/langextract_processor.py` | 815 | LLM-based description extraction |
| `app/services/gemini_extractor.py` | 661 | Direct Gemini API for extraction |
| `app/services/imagen_generator.py` | 644 | Google Imagen 4 image generation |
| `app/core/retry.py` | 515 | **NEW:** Exponential backoff decorators (tenacity) |
| `app/services/reading_session_cache.py` | 454 | Redis session caching |
| `app/services/settings_manager.py` | 422 | Redis-backed settings |
| `app/services/llm_description_enricher.py` | 413 | Description post-processing |
| `app/services/user_statistics_service.py` | 407 | Reading analytics |
| `app/services/reading_session_service.py` | 379 | Optimized DB queries |
| `app/services/feature_flag_manager.py` | 378 | Feature control |
| `app/services/auth_service.py` | 373 | JWT authentication |
| `app/services/parsing_manager.py` | 319 | Global parsing queue |
| `app/services/image_generator.py` | 283 | Image generation orchestration |
| `app/services/vless_http_client.py` | 255 | Proxy-aware HTTP client |
| `app/services/token_blacklist.py` | 156 | **NEW:** JWT token revocation (Redis) |
| `app/services/book/` | 1,028 | Book CRUD (4 services) |

> **REMOVED December 2025:** `multi_nlp_manager.py`, `nlp/` directory, NLP processors

### Frontend Components (January 2026)

#### Reader Components (15 files)
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/Reader/EpubReader.tsx` | 573 | Главный EPUB-ридер с CFI навигацией |
| `src/components/Reader/IOSTapZones.tsx` | ~200 | iOS-специфичные зоны касания для навигации |
| `src/components/Reader/IOSDebugOverlay.tsx` | ~100 | Отладочный оверлей для iOS |
| `src/components/Reader/PositionConflictDialog.tsx` | 123 | Диалог конфликта позиций чтения |
| `src/components/Reader/ReaderHeader.tsx` | ~150 | Заголовок ридера с навигацией |
| `src/components/Reader/ReaderSettingsPanel.tsx` | ~300 | Панель настроек ридера |
| `src/components/Reader/TocSidebar.tsx` | ~200 | Боковая панель содержания |
| `src/components/Reader/SwipeIndicator.tsx` | ~80 | Визуальный индикатор свайпа |
| `src/components/Reader/ProgressIndicator.tsx` | ~100 | Индикатор прогресса чтения |
| `src/components/Reader/SelectionMenu.tsx` | ~150 | Меню выделения текста |
| `src/components/Reader/BookInfo.tsx` | ~100 | Информация о книге |
| `src/components/Reader/ReaderControls.tsx` | ~120 | Элементы управления ридером |
| `src/components/Reader/ImageGenerationStatus.tsx` | ~80 | Статус генерации изображений |
| `src/components/Reader/ExtractionIndicator.tsx` | ~60 | Индикатор извлечения описаний |
| `src/components/Reader/ProgressSaveIndicator.tsx` | ~50 | Индикатор сохранения прогресса |

#### Settings Components (8 files)
| File | Purpose |
|------|---------|
| `src/components/Settings/ReaderSettings.tsx` | Общие настройки ридера |
| `src/components/Settings/StorageQuotaInfo.tsx` | Информация о квоте хранилища |
| `src/components/Settings/sections/AccountSettingsSection.tsx` | Настройки аккаунта |
| `src/components/Settings/sections/ReadingSettingsSection.tsx` | Настройки чтения |
| `src/components/Settings/sections/PWASettingsSection.tsx` | Настройки PWA |
| `src/components/Settings/sections/NotificationsSettingsSection.tsx` | Уведомления |
| `src/components/Settings/sections/PrivacySettingsSection.tsx` | Приватность |
| `src/components/Settings/sections/AboutSettingsSection.tsx` | О приложении |

#### UI Components (20+ files)
| File | Purpose |
|------|---------|
| `src/components/UI/ThemeSwitcher.tsx` | Переключатель темы |
| `src/components/UI/OfflineBanner.tsx` | Баннер офлайн-режима |
| `src/components/UI/PWAUpdatePrompt.tsx` | Промпт обновления PWA |
| `src/components/UI/IOSInstallInstructions.tsx` | Инструкции установки iOS |
| `src/components/UI/ParsingOverlay.tsx` | Оверлей парсинга |
| `src/components/UI/LazyImage.tsx` | Ленивая загрузка изображений |
| `src/components/UI/AuthenticatedImage.tsx` | Изображение с авторизацией |
| `src/components/UI/NotificationContainer.tsx` | Контейнер уведомлений |
| `src/components/UI/ErrorMessage.tsx` | Компонент ошибок |
| `src/components/UI/LoadingSpinner.tsx` | Спиннер загрузки |
| `src/components/UI/Modal.tsx`, `Dialog.tsx` | Модальные окна |
| `src/components/UI/Skeleton.tsx` | Скелетон загрузки |

#### Key Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/styles/globals.css` | ~350 | Theme CSS + iOS scroll/zoom fixes |
| `src/pages/LibraryPage.tsx` | 195 | Book library (refactored from 739) |
| `src/hooks/epub/useDescriptionHighlighting.ts` | 566 | 9 search strategies for highlighting |
| `src/utils/retryWithBackoff.ts` | 442 | Exponential backoff for API calls |
| `src/services/syncQueue.ts` | 312 | Offline sync queue (localStorage) |
| `src/hooks/useOnlineStatus.ts` | 87 | Online/offline status detection |
| `src/hooks/useTheme.ts` | ~80 | Theme management hook |
| `src/hooks/epub/useEpubThemes.ts` | ~60 | EPUB reader theme sync |
| `src/hooks/epub/useContentHooks.ts` | 217 | epub.js content hooks (styling, iOS fixes) |

### Frontend Caching Services
| File | Lines | Purpose |
|------|-------|---------|
| `src/services/chapterCache.ts` | ~600 | IndexedDB cache for chapters (descriptions + images) |
| `src/services/imageCache.ts` | ~500 | IndexedDB offline image cache with auto-cleanup |
| `src/services/syncQueue.ts` | 312 | **NEW:** Offline operation queue with auto-sync |

### TanStack Query Hooks (src/hooks/api/)
| File | Purpose |
|------|---------|
| `queryKeys.ts` | Centralized cache key management |
| `useBooks.ts` | Book list, get, upload with prefetching |
| `useChapter.ts` | Chapters with IndexedDB + offline support |
| `useDescriptions.ts` | Descriptions with LLM extraction caching |
| `useImages.ts` | Image generation and management |

### Modular Components
| Directory | Components | Purpose |
|-----------|-----------|---------|
| `src/components/Library/` | Header, Stats, Search, BookCard, BookGrid, Pagination | Library page modules |
| `src/components/Admin/` | Header, Stats, TabNavigation, MultiNLPSettings, ParsingSettings | Admin panel modules |

### Core Models
| Model | Key Fields |
|-------|------------|
| `User` | email, subscription_type |
| `Book` | title, author, genre, file_format |
| `ReadingProgress` | reading_location_cfi, scroll_offset_percent |
| `Description` | content, type, confidence_score |
| `GeneratedImage` | image_url, service_used |

## Docker Services

```yaml
services:
  postgres:     PostgreSQL 15.7
  redis:        Cache + task queue
  backend:      FastAPI (LLM-only, ~800MB image)
  celery-worker: Background processing
  celery-beat:   Scheduled tasks
  frontend:     Vite + React
```

Production: `docker-compose.lite.yml` (optimized images)

## Development Commands

```bash
# Start development
docker-compose up -d

# Backend tests
cd backend && pytest -v --cov=app

# Frontend tests
cd frontend && npm test

# Type checking
cd frontend && npm run type-check
cd backend && mypy app/

# Database migrations
cd backend && alembic upgrade head
cd backend && alembic revision --autogenerate -m "description"

# View logs
docker-compose logs -f backend celery-worker
```

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost/bookreader
REDIS_URL=redis://localhost:6379
SECRET_KEY=change-in-production

# Optional
GOOGLE_API_KEY=...              # For Gemini + Imagen
POLLINATIONS_ENABLED=true       # Fallback image generation
YOOKASSA_SHOP_ID=...           # Payments
```

## API Quick Reference

### Core Endpoints
```
POST /api/v1/auth/login          # JWT authentication
POST /api/v1/auth/register       # User registration

GET  /api/v1/books               # List user books
POST /api/v1/books/upload        # Upload EPUB/FB2
GET  /api/v1/books/{id}          # Book details + progress
PUT  /api/v1/books/{id}/progress # Update reading position

GET  /api/v1/chapters/{id}       # Chapter content
GET  /api/v1/descriptions/{chapter_id}  # Extracted descriptions
POST /api/v1/images/generate/{description_id}  # Generate image
```

### Admin Endpoints
```
GET  /api/v1/admin/stats              # System statistics
GET  /api/v1/admin/feature-flags      # Feature flags management
POST /api/v1/admin/parsing/{book_id}  # Trigger manual parsing
```

## Database Notes

**Enums stored as VARCHAR:**
- `books.genre` -> String(50), not Enum
- `books.file_format` -> String(10)
- `generated_images.status` -> String(20)

**CFI Fields (EPUB position tracking):**
- `reading_progress.reading_location_cfi` - String(500)
- `reading_progress.scroll_offset_percent` - Float (0-100)

## Code Standards

### Commits
```
<type>(<scope>): <subject>

Types: feat, fix, docs, style, refactor, test, chore
```

### Documentation
- All functions require docstrings
- React components require JSDoc
- Update docs after significant changes

### Type Safety
- Backend: 95%+ type coverage with Pydantic schemas
- Frontend: TypeScript strict mode
- Pre-commit hooks: mypy, ruff, black, eslint

## File Structure (January 2026)

```
fancai-vibe-hackathon/
├── frontend/
│   ├── src/components/
│   │   ├── Reader/               # EPUB reader (15 files)
│   │   │   ├── EpubReader.tsx    # Главный компонент ридера
│   │   │   ├── IOSTapZones.tsx   # iOS navigation zones
│   │   │   └── ...
│   │   ├── Settings/             # Настройки (8 files)
│   │   ├── Library/              # Библиотека (6 files)
│   │   ├── Admin/                # Админка (5 files)
│   │   └── UI/                   # Shared UI (20+ files)
│   ├── src/styles/
│   │   └── globals.css           # Theme CSS + iOS scroll/zoom fixes
│   ├── src/hooks/
│   │   ├── api/                  # TanStack Query (5 files)
│   │   ├── epub/                 # EPUB hooks (22 files)
│   │   │   ├── useContentHooks.ts    # iOS iframe fixes
│   │   │   ├── useDescriptionHighlighting.ts
│   │   │   └── useEpubThemes.ts
│   │   ├── reader/               # Reader logic (9 files)
│   │   ├── pwa/                  # PWA hooks
│   │   ├── library/              # Library filters
│   │   └── [15 top-level hooks]
│   ├── src/services/             # Caching services (9 files)
│   │   ├── chapterCache.ts       # IndexedDB chapter cache
│   │   ├── imageCache.ts         # IndexedDB image cache
│   │   └── syncQueue.ts          # Offline sync queue
│   ├── src/stores/               # Zustand stores (6 files)
│   ├── src/utils/
│   │   ├── retryWithBackoff.ts   # Exponential backoff
│   │   └── iosSupport.ts         # iOS detection
│   └── src/pages/                # Page components (13 files)
├── backend/
│   ├── app/core/                 # Config, DB, exceptions
│   │   └── retry.py              # Retry decorators (tenacity)
│   ├── app/models/               # SQLAlchemy models (9 files)
│   ├── app/routers/              # API endpoints
│   │   ├── admin/                # Admin endpoints (8 modules)
│   │   └── books/                # Book endpoints (3 modules)
│   ├── app/services/             # Business logic (17+ services)
│   │   ├── book/                 # Book CRUD (4 files)
│   │   └── token_blacklist.py    # JWT revocation
│   └── tests/
│       ├── services/             # Unit tests (15+ files)
│       └── integration/          # Integration tests (8 files)
├── docs/                         # Documentation (Diataxis)
│   ├── guides/                   # How-to (38 files)
│   ├── reference/                # API, DB (27 files)
│   ├── explanations/             # Architecture (17 files)
│   ├── operations/               # Deployment (19 files)
│   ├── development/              # Planning (33 files)
│   └── reports/                  # Session reports (400+ files)
└── docker-compose.lite.yml       # Production stack
```

### Frontend Statistics (January 2026)
| Category | Count |
|----------|-------|
| Components | 86 files |
| Hooks | 56 files |
| Services | 9 files |
| Stores | 6 files |
| Pages | 13 files |
| Utils | 10 files |

## Performance Requirements

| Metric | Target |
|--------|--------|
| Parser quality | >70% relevant descriptions |
| Image generation | <30 seconds |
| Page load | <2 seconds |
| Uptime | >99% |

## Current State (January 2026)

### Completed Improvement Phases
1. **P0 Hotfix** - Critical bug fixes and stability improvements
2. **P1 Security** - JWT token blacklist, secure token revocation
3. **P2 Stability** - Exponential backoff retry, error handling improvements
4. **P3 Comprehensive** - Offline sync queue, position conflict resolution, integration tests
5. **P4 Mobile UX** - iOS navigation fixes, scroll/zoom lock, safe-area support

### Completed Milestones
1. **LLM Migration** - Gemini API for description extraction (replacing Multi-NLP)
2. **Frontend Refactoring** - TanStack Query, modular components, IndexedDB caching
3. **Image Generation** - Google Imagen 4 with offline cache
4. **Performance** - 75% RAM reduction, 68% Docker image reduction
5. **Resilience** - Retry mechanisms with exponential backoff (backend + frontend)
6. **Security** - JWT blacklist for token revocation on logout
7. **Offline-First** - Sync queue for offline operations, online status detection
8. **Test Coverage** - 43 backend tests (8 integration), 18 frontend tests
9. **Theme System** - Light/Dark/Sepia themes with EPUB sync
10. **iOS Mobile Fixes** - Navigation, scroll bounce, pinch-zoom prevention

### Active Features
- Description extraction via Gemini Flash
- Image generation via Imagen 4
- CFI-based reading progress
- 9-strategy description highlighting
- Offline support with IndexedDB
- Exponential backoff retry (API calls, image generation, LLM)
- JWT token blacklist (secure logout)
- Offline sync queue (progress, bookmarks, highlights)
- Position conflict resolution dialog
- Theme system (Light/Dark/Sepia/System) with EPUB sync
- **iOS Mobile Optimizations:**
  - `touch-action: pan-x pan-y` - отключение pinch-zoom
  - `overscroll-behavior: none` - отключение bounce-эффекта
  - Safari gesture event prevention
  - Safe-area support for notch devices

## Frontend Architecture (January 2026)

### Caching Strategy
- **TanStack Query (v5)** - Server state with auto-invalidation
- **IndexedDB** - Offline storage (chapterCache, imageCache)
- **Stale-while-revalidate** - Optimal UX pattern

### Theme Architecture
- **CSS Variables** - shadcn/ui design tokens in `globals.css`
- **Tailwind Integration** - Semantic classes (`bg-background`, `text-foreground`)
- **EPUB Sync** - Reader theme synchronized with app theme via `useEpubThemes`
- **Persistence** - `localStorage` with system preference fallback

### Mobile Optimizations (January 2026)

**iOS Safari Fixes:**
```css
/* Отключение bounce-эффекта */
body.reader-active {
  overscroll-behavior: none;
  position: fixed;
}

/* Отключение pinch-zoom (НЕ manipulation!) */
.reader-scroll-lock {
  touch-action: pan-x pan-y;  /* manipulation разрешает zoom! */
}
```

**Safari Gesture Prevention:**
```typescript
// BookReaderPage.tsx - useReaderBodyLock hook
document.addEventListener('gesturestart', preventGesture, { passive: false });
document.addEventListener('gesturechange', preventGesture, { passive: false });
document.addEventListener('gestureend', preventGesture, { passive: false });
```

**EPUB iframe styling (useContentHooks.ts):**
```css
@supports (-webkit-touch-callout: none) {  /* iOS only */
  html, body {
    touch-action: pan-x pan-y !important;
    overscroll-behavior-x: none !important;
  }
}
```

### Hooks Architecture (56 hooks total)

**EPUB Hooks (`/hooks/epub/` - 22 files):**
| Hook | Purpose |
|------|---------|
| `useDescriptionHighlighting` | 9 стратегий поиска для подсветки описаний |
| `useContentHooks` | Инъекция стилей в iframe (iOS fixes) |
| `useSwipeGestures` | Обработка свайп-жестов |
| `useKeyboardNavigation` | Клавиатурная навигация |
| `useEpubThemes` | Синхронизация темы EPUB с приложением |
| `useReadingProgress` | Прогресс чтения + CFI |
| `usePageIndicator` | Индикатор текущей страницы |

**API Hooks (`/hooks/api/` - 5 files):**
| Hook | Purpose |
|------|---------|
| `queryKeys` | Централизованные ключи кэша |
| `useBooks` | CRUD книг + prefetching |
| `useChapter` | Главы + IndexedDB offline |
| `useDescriptions` | Описания + LLM extraction |
| `useImages` | Генерация изображений |

**Top-level Hooks (15 files):**
| Hook | Purpose |
|------|---------|
| `useTheme` | Управление темой приложения |
| `useOnlineStatus` | Детекция онлайн/офлайн |
| `usePWAInstall` | Установка PWA |
| `useWakeLock` | Wake Lock API для чтения |
| `useHaptics` | Haptic feedback |

### Data Flow
```
Component -> TanStack Query hooks
    |
TanStack Query (queryKeys for caching)
    |
IndexedDB (offline) / API (online)
    |
Auto-refetch on focus/interval
```

## Quick Links

| Resource | Path |
|----------|------|
| API Documentation | `/docs` (Swagger UI) |
| Architecture | `docs/explanations/architecture/` |
| Deployment | `docs/guides/deployment/` |
| Testing | `docs/guides/testing/` |
| Reports | `docs/reports/` |

---

For detailed documentation, see `/docs/README.md`.
