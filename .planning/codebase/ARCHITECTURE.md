# Architecture

**Analysis Date:** 2026-02-27

## Pattern Overview

**Overall:** Full-stack separated monolith with async backend and PWA frontend

**Key Characteristics:**
- Backend is FastAPI async REST + WebSocket API, with Celery for heavy async tasks
- Frontend is React SPA (PWA) with TanStack Query for server state and Zustand for client state
- Two distinct AI pipelines: Gemini extraction (entity/description) and Imagen generation (images)
- Offline-first frontend with IndexedDB caching via `chapterCache`, `epubCache`, `imageCache`
- Spoiler-free entity system using EPUB CFI positions to filter entity data to current reading position

## Layers

**Backend: Core Infrastructure:**
- Purpose: Configuration, DB session factory, Redis cache, authentication, rate limiting, Celery
- Location: `backend/app/core/`
- Contains: `config.py`, `database.py`, `cache.py`, `auth.py`, `celery_app.py`, `dependencies.py`, `exceptions.py`, `retry.py`, `container.py`
- Depends on: Nothing internal
- Used by: All other backend layers

**Backend: Data Models:**
- Purpose: SQLAlchemy ORM model definitions
- Location: `backend/app/models/`
- Contains: `book.py`, `chapter.py`, `entity.py`, `entity_mention.py`, `entity_relationship.py`, `description.py`, `description_entity.py`, `user.py`, `reading_session.py`, `image.py`
- Depends on: `core/database.py` (Base class)
- Used by: Services, Routers (via dependency injection)

**Backend: Services (Business Logic):**
- Purpose: All business logic, AI integration, data operations
- Location: `backend/app/services/`
- Contains:
  - AI: `gemini_extractor.py` (Gemini API for entity/description extraction), `imagen_generator.py` (Imagen 4 image generation)
  - Entity: `entity_service.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `graph_service.py`
  - Book: `book/book_service.py`, `book/book_progress_service.py`, `book/book_parsing_service.py`, `book/book_statistics_service.py`
  - Parsing: `book_parser.py` (EPUB/FB2 parser), `description_extraction_service.py`
  - Auth: `auth_service.py`, `token_blacklist.py`
  - Reading: `reading_session_service.py`, `reading_session_cache.py`
  - Infrastructure: `settings_manager.py`, `push_notification_service.py`, `llm_cache_service.py`
- Depends on: Models, Core
- Used by: Routers, Celery Tasks

**Backend: Routers (API Endpoints):**
- Purpose: HTTP request handling, input validation, response serialization
- Location: `backend/app/routers/`
- Contains: `auth.py`, `users.py`, `images.py` (33K lines), `reading_sessions.py` (41K lines), `chapters.py`, `descriptions.py`, `health.py`, `push.py`, `sync.py`, `websocket.py`
- Modular sub-routers: `books/crud.py`, `books/entities.py`, `books/processing.py`, `books/validation.py`
- Admin: `admin/` directory with separate admin endpoints
- Depends on: Services, Core (for dependencies/auth), Schemas
- Used by: FastAPI application in `main.py`

**Backend: Schemas:**
- Purpose: Pydantic v2 request/response validation
- Location: `backend/app/schemas/`
- Contains: `push.py`, `responses/` (entities, images, reading_sessions, etc.)
- Depends on: Nothing
- Used by: Routers

**Backend: Celery Tasks:**
- Purpose: Heavy async processing: book parsing, image generation, session cleanup
- Location: `backend/app/tasks/`
- Contains: `book_tasks.py` (3h time limit, distributed lock), `image_tasks.py` (300s), `reading_sessions_tasks.py`, `cleanup_tasks.py`, `auth_tasks.py`
- Depends on: Services, Models, Core
- Used by: Routers (trigger via task.delay()), Celery Beat (scheduled)

**Frontend: API Layer:**
- Purpose: All HTTP communication with backend
- Location: `frontend/src/api/`
- Contains: `client.ts` (Axios singleton with interceptors + auto token refresh), `books.ts`, `images.ts`, `readingSessions.ts`, `admin.ts`, `auth.ts`, `descriptions.ts`, `push.ts`
- Depends on: Nothing else in frontend
- Used by: TanStack Query hooks

**Frontend: TanStack Query Hooks:**
- Purpose: Server state management — fetching, caching, mutations
- Location: `frontend/src/hooks/api/`
- Contains: `useBooks.ts`, `useChapter.ts`, `useDescriptions.ts`, `useImages/`, `useParsingStatus.ts`, `queryKeys.ts`
- Depends on: API layer
- Used by: Pages, Components

**Frontend: EPUB Hooks:**
- Purpose: epub.js integration, CFI position tracking, chapter navigation, description highlighting
- Location: `frontend/src/hooks/epub/`
- Contains: `useEpubLoader.ts`, `useEpubNavigation.ts`, `useEpubRendition.ts`, `useCFITracking.ts`, `useDescriptionHighlighting.ts`, `useChapterMapping.ts`, `useEpubThemes.ts`, `useSwipeNavigation.ts`, `useTouchNavigation.ts`, 25+ hooks total
- Depends on: API layer, Services layer, Stores
- Used by: `EpubReader.tsx` exclusively

**Frontend: State Stores (Zustand):**
- Purpose: Client-side global state
- Location: `frontend/src/stores/`
- Contains: `auth.ts` (JWT + user), `reader.ts` (navigation mode, settings), `ui.ts` (notifications, modals), `index.ts` (initialization)
- Depends on: Nothing
- Used by: All components/hooks that need global state

**Frontend: Services (Client-side):**
- Purpose: IndexedDB, PWA, caching, offline functionality
- Location: `frontend/src/services/`
- Contains: `chapterCache.ts`, `epubCache.ts`, `imageCache.ts`, `db.ts` (IndexedDB wrapper), `storageManager.ts`, `downloadManager.ts`, `syncQueue.ts`, `pushNotifications.ts`
- Depends on: Nothing
- Used by: Hooks, Components

**Frontend: Pages:**
- Purpose: Route-level components, compose domain components
- Location: `frontend/src/pages/`
- Contains: `LibraryPage.tsx`, `BookPage.tsx`, `BookReaderPage.tsx`, `BookImagesPage.tsx`, `ProfilePage.tsx`, `AdminDashboardEnhanced.tsx`, etc.
- Depends on: TanStack Query hooks, Components, Stores
- Used by: Router in `App.tsx`

**Frontend: Components:**
- Purpose: Reusable UI components
- Location: `frontend/src/components/`
- Key domains: `Reader/` (epub reader UI), `Entities/` (entity glossary UI), `Books/`, `UI/` (design system), `Admin/`, `Auth/`

## Data Flow

**Book Upload and Processing Flow:**
1. User uploads EPUB/FB2 via `BookUploadModal.tsx` → `POST /api/v1/books`
2. Router saves file, creates Book record with `is_processing=True`
3. Router triggers `process_book_task.delay(book_id)` (Celery)
4. Celery task parses book with `book_parser.py`, creates `Chapter` records
5. Frontend polls `GET /api/v1/books/{id}` or subscribes to WebSocket `wss://.../ws/book-progress/{id}`
6. WebSocket pushes progress updates via Redis PubSub (supports multi-worker)
7. When complete, `is_processing=False`, frontend TanStack Query cache invalidated

**AI Extraction Flow (On-demand per chapter):**
1. Reader opens chapter via `GET /api/v1/books/{id}/chapters/{num}`
2. If not yet extracted, triggers `description_extraction_service.py`
3. `gemini_extractor.py` calls Gemini 3.0 Flash with 100K char chunks + 15% overlap
4. Extracts both descriptions (visual paragraphs) and entities (characters/locations/objects)
5. Two modes: TSA (XML tags, default) and Legacy (JSON)
6. Results stored in `descriptions`, `entities`, `entity_mentions` tables
7. Subsequent reads served from DB + Redis cache

**Entity Spoiler-Free Flow:**
1. Reader reaches chapter N (tracked by CFI position)
2. Frontend calls `GET /api/v1/books/{id}/entities?chapter={N}`
3. `entity_service.py` filters entities to only those first mentioned in chapters ≤ N
4. Entity details (descriptions, relationships) also filtered to chapter ≤ N
5. `EntityDrawer.tsx` → `EntityProfile.tsx` displays spoiler-safe wiki

**Image Generation Flow:**
1. Descriptions extracted → image generation task queued
2. `image_tasks.py` calls `imagen_generator.py`
3. `imagen_generator.py` translates RU→EN via Gemini, then calls Imagen 4 API
4. Generated image stored, `Image` record created in DB
5. Reader shows images overlaid on matching text passages via `useDescriptionHighlighting.ts`

**Reading Session Flow:**
1. `useReadingSession.ts` tracks active reading time
2. Progress synced via `useProgressSync.ts` to `PUT /api/v1/books/{id}/progress`
3. Offline reads queued in `syncQueue.ts`, replayed when online
4. Reading sessions recorded in `reading_sessions` table for statistics

**State Management:**
- Server state: TanStack Query with user-scoped keys (`['books', userId, ...]`)
- Client-side UI state: Zustand stores (`auth`, `reader`, `ui`)
- Offline data: IndexedDB via `db.ts` (books, chapters, images)
- Cross-tab sync: `tabSync.ts` broadcasts state changes

## Key Abstractions

**GeminiDirectExtractor:**
- Purpose: Unified AI extraction producing both descriptions and entities
- Files: `backend/app/services/gemini_extractor.py`
- Pattern: Pydantic Structured Output with `GeminiEntitySchema`, `GeminiRelationshipSchema`; tenacity retries via `retry_llm_extraction`

**EntityService:**
- Purpose: Spoiler-free entity data filtering and CFI-based sorting
- Files: `backend/app/services/entity_service.py`
- Pattern: Service class injected via FastAPI `Depends(get_database_session)`

**BookParser:**
- Purpose: EPUB/FB2 file parsing into structured Chapter records
- Files: `backend/app/services/book_parser.py`
- Pattern: Service class with `parse_book()`, `detect_format()` methods; uses `ebooklib` and `lxml`

**ApiClient:**
- Purpose: Axios singleton with automatic JWT refresh and error normalization
- Files: `frontend/src/api/client.ts`
- Pattern: Class singleton exported as `apiClient`; HttpOnly cookie auth; single refresh deduplication

**EpubReader:**
- Purpose: Main EPUB reading experience, orchestrates 25+ hooks
- Files: `frontend/src/components/Reader/EpubReader.tsx`
- Pattern: Functional component delegating all logic to hooks; UI split into `ReaderUI`, `ReaderModals`, `ReaderOverlays`

**QueryKeys:**
- Purpose: Centralized TanStack Query key registry, user-scoped for security
- Files: `frontend/src/hooks/api/queryKeys.ts`
- Pattern: `bookKeys`, `chapterKeys`, etc. factories requiring `userId` parameter

**DI Container:**
- Purpose: Dependency injection for backend services
- Files: `backend/app/core/container.py`
- Pattern: Protocol/Interface abstractions + `lru_cache` factories; supports test overrides

## Entry Points

**Backend API:**
- Location: `backend/app/main.py`
- Triggers: uvicorn HTTP server
- Responsibilities: FastAPI app creation, middleware stack, router registration, lifespan (Redis + rate limiter init/close)

**Frontend App:**
- Location: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Triggers: Vite dev server or static file serving
- Responsibilities: React tree root, route definitions, TanStack Query provider, lazy chunk loading, service worker registration

**Celery Worker:**
- Location: `backend/app/core/celery_app.py`
- Triggers: `celery -A app.core.celery_app worker`
- Responsibilities: Task routing (`heavy` queue for book processing, `normal` for images, `light` for cleanup), beat schedule

**WebSocket Server:**
- Location: `backend/app/routers/websocket.py`
- Triggers: Client connects to `wss://.../ws/book-progress/{book_id}`
- Responsibilities: Redis PubSub subscription per book, fan-out to connected clients, JWT cookie auth

## Error Handling

**Strategy:** RFC 9457 Problem Details on backend, typed error responses on frontend

**Backend Patterns:**
- Custom `ProblemDetail(HTTPException)` from `backend/app/core/exceptions.py` for structured error responses
- `problem_detail_exception_handler` registered globally in `main.py`
- CORS headers preserved on all error responses via custom exception handlers
- Tenacity retry decorators from `backend/app/core/retry.py` for all LLM and external API calls
- Celery tasks: `max_retries=3`, `default_retry_delay=60`, `SoftTimeLimitExceeded` handling

**Frontend Patterns:**
- `ErrorBoundary` wraps entire app at root level (`main.tsx`) and per-route via `ChunkLoadErrorBoundary`
- Axios interceptor in `client.ts` handles 401 → auto token refresh → retry
- TanStack Query built-in retry with exponential backoff
- Offline detection via `useOnlineStatus.ts`, queued sync via `syncQueue.ts`

## Cross-Cutting Concerns

**Logging:**
- Backend: `structlog`-based via `backend/app/core/logging.py`, structured JSON output
- Frontend: `frontend/src/lib/logger.ts` wrapper suppressing logs in production

**Validation:**
- Backend: Pydantic v2 for all request/response schemas; custom validators in `core/validation.py`
- Frontend: TypeScript types in `frontend/src/types/api.ts`, `types/epub.ts`, `types/entity.ts`

**Authentication:**
- HttpOnly JWT cookies (access + refresh tokens)
- `ACCESS_TOKEN_EXPIRE_MINUTES=10080` (7 days), `REFRESH_TOKEN_EXPIRE_DAYS=30`
- Backend: `core/auth.py`, `services/auth_service.py`, `services/token_blacklist.py`
- Frontend: Stored in `useAuthStore` (Zustand), cookie sent automatically by browser

**Rate Limiting:**
- Redis-backed rate limiter in `backend/app/core/rate_limiter.py`
- Applied via `@rate_limit()` decorator on sensitive endpoints
- Degrades gracefully when Redis unavailable

**Caching:**
- Backend: Redis cache manager in `backend/app/core/cache.py`; LLM result cache in `services/llm_cache_service.py`
- Frontend: TanStack Query (network responses), IndexedDB (chapters, EPUBs, images)

---

*Architecture analysis: 2026-02-27*
