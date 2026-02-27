# Codebase Structure

**Analysis Date:** 2026-02-27

## Directory Layout

```
fancai-vibe-hackathon/             # Repo root
├── backend/                       # FastAPI Python backend
│   ├── app/                       # Application code
│   │   ├── core/                  # Infrastructure: config, DB, Redis, auth, Celery
│   │   ├── models/                # SQLAlchemy ORM models
│   │   ├── routers/               # FastAPI route handlers (API endpoints)
│   │   │   ├── books/             # Modular books sub-router
│   │   │   └── admin/             # Admin-only endpoints
│   │   ├── schemas/               # Pydantic v2 request/response schemas
│   │   │   └── responses/         # Response-only schemas
│   │   ├── services/              # Business logic and AI integration
│   │   │   ├── book/              # Book-specific services (SRP pattern)
│   │   │   └── email/             # Email service
│   │   ├── tasks/                 # Celery async tasks
│   │   ├── middleware/            # FastAPI middleware (security, cache, rate limit)
│   │   ├── monitoring/            # Prometheus metrics
│   │   ├── parsers/               # Legacy parser code
│   │   ├── utils/                 # Backend utility functions
│   │   └── main.py                # FastAPI application entry point
│   ├── alembic/                   # Database migrations
│   │   └── versions/              # Migration files (timestamped)
│   ├── tests/                     # Backend test suite (pytest)
│   ├── scripts/                   # Utility scripts
│   ├── sql/                       # Raw SQL (init.sql)
│   ├── storage/                   # Local file storage (books, covers)
│   └── docs/                      # Backend-specific documentation
├── frontend/                      # React TypeScript PWA frontend
│   └── src/
│       ├── api/                   # Axios API client + per-domain API functions
│       ├── components/            # React components (domain-organized)
│       │   ├── Reader/            # EPUB reader UI components
│       │   ├── Entities/          # Entity glossary/wiki UI
│       │   ├── Books/             # Book upload, delete modals
│       │   ├── UI/                # Design system primitives
│       │   ├── Admin/             # Admin dashboard
│       │   ├── Auth/              # AuthGuard, login forms
│       │   ├── Layout/            # App shell, navigation
│       │   ├── Library/           # Library page components
│       │   ├── Home/              # Homepage components
│       │   ├── Images/            # Image gallery components
│       │   ├── Settings/          # Settings UI
│       │   └── SEO/               # Meta tags
│       ├── hooks/                 # React hooks
│       │   ├── api/               # TanStack Query hooks (server state)
│       │   ├── epub/              # epub.js integration hooks (25+ hooks)
│       │   ├── reader/            # Reader-specific non-epub hooks
│       │   ├── pwa/               # PWA hooks
│       │   └── shared/            # Shared utility hooks
│       ├── pages/                 # Route-level page components
│       ├── services/              # Client-side services (IndexedDB, PWA, caching)
│       ├── stores/                # Zustand state stores
│       ├── lib/                   # Utilities: queryClient, i18n, logger, zIndex
│       ├── utils/                 # Utility functions
│       ├── types/                 # TypeScript type definitions
│       ├── config/                # Frontend constants
│       ├── styles/                # Global CSS (themes, variables)
│       ├── locales/               # i18n translation files
│       ├── assets/                # Static assets
│       ├── test/                  # Test setup and utilities
│       ├── App.tsx                # Root component with routing
│       ├── main.tsx               # React entry point
│       └── sw.ts                  # Service worker
├── nginx/                         # Nginx config for production
├── docker/                        # Docker support files
├── monitoring/                    # Prometheus/Grafana config
├── postgres/                      # PostgreSQL config
├── redis/                         # Redis config
├── scripts/                       # Root-level utility scripts
├── deploy/                        # Deployment scripts
├── docs/                          # Project-level documentation
├── docker-compose.lite.yml        # Primary dev/prod compose file
├── docker-compose.lite.prod.yml   # Production-specific overrides
└── CLAUDE.md                      # Project instructions for Claude
```

## Directory Purposes

**`backend/app/core/`:**
- Purpose: Cross-cutting infrastructure shared by all backend layers
- Contains: `config.py` (Pydantic settings), `database.py` (async SQLAlchemy engine + session factory), `cache.py` (Redis cache manager), `auth.py` (JWT helpers), `celery_app.py` (Celery + beat schedule), `dependencies.py` (FastAPI dependency functions), `exceptions.py` (RFC 9457 ProblemDetail), `retry.py` (tenacity decorators for LLM calls), `container.py` (DI container with Protocol interfaces), `rate_limiter.py`, `validation.py`
- Key files: `backend/app/core/config.py`, `backend/app/core/database.py`, `backend/app/core/container.py`

**`backend/app/models/`:**
- Purpose: All SQLAlchemy ORM model definitions
- Contains: `book.py` (Book, ReadingProgress), `chapter.py`, `entity.py`, `entity_mention.py`, `entity_relationship.py`, `description.py`, `description_entity.py`, `user.py`, `reading_session.py`, `image.py`, `entity_event.py`
- Key files: `backend/app/models/book.py`, `backend/app/models/entity.py`

**`backend/app/services/`:**
- Purpose: All business logic, AI pipeline, and domain operations
- Contains: Flat file services + `book/` subdirectory (SRP decomposition)
- AI files: `gemini_extractor.py` (Gemini 3.0 Flash, description + entity extraction), `imagen_generator.py` (Imagen 4), `description_extraction_service.py`
- Entity files: `entity_service.py`, `entity_deduplication_service.py`, `entity_synthesis_service.py`, `graph_service.py`
- Key files: `backend/app/services/gemini_extractor.py`, `backend/app/services/entity_service.py`, `backend/app/services/book_parser.py`

**`backend/app/routers/`:**
- Purpose: HTTP request/response handlers; thin layer delegating to services
- Heavy files (known tech debt): `images.py` (33K lines), `reading_sessions.py` (41K lines)
- Modular: `books/` split into `crud.py`, `entities.py`, `processing.py`, `validation.py`
- Key files: `backend/app/routers/books/crud.py`, `backend/app/routers/websocket.py`

**`backend/app/tasks/`:**
- Purpose: Celery async task definitions
- Contains: `book_tasks.py` (3h limit, distributed Redis lock), `image_tasks.py`, `reading_sessions_tasks.py`, `cleanup_tasks.py`, `auth_tasks.py`, `utility_tasks.py`
- Key files: `backend/app/tasks/book_tasks.py`, `backend/app/tasks/image_tasks.py`

**`backend/alembic/versions/`:**
- Purpose: Database migration files, one per schema change
- Naming: `YYYY_MM_DD_HHMM-{hash}_{description}.py`
- Key files: Latest is `backend/alembic/versions/` (48 files as of 2026-02-27)

**`frontend/src/api/`:**
- Purpose: All network communication; Axios client + per-domain API functions
- Contains: `client.ts` (singleton class with interceptors), `books.ts`, `images.ts`, `readingSessions.ts`, `auth.ts`, `admin.ts`, `descriptions.ts`, `health.ts`, `push.ts`
- Key files: `frontend/src/api/client.ts`, `frontend/src/api/books.ts`

**`frontend/src/hooks/api/`:**
- Purpose: TanStack Query hooks wrapping API layer; all server data fetching lives here
- Contains: `useBooks.ts`, `useChapter.ts`, `useDescriptions.ts`, `useImages/`, `useParsingStatus.ts`, `queryKeys.ts`
- Key files: `frontend/src/hooks/api/queryKeys.ts`, `frontend/src/hooks/api/useBooks.ts`

**`frontend/src/hooks/epub/`:**
- Purpose: epub.js integration; CFI tracking, navigation, themes, highlighting
- Contains: 25+ hooks including `useEpubLoader.ts`, `useCFITracking.ts`, `useDescriptionHighlighting.ts`, `useChapterMapping.ts`, `useEpubNavigation.ts`, `useSwipeNavigation.ts`, `useTouchNavigation.ts`
- Key files: `frontend/src/hooks/epub/useEpubLoader.ts`, `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

**`frontend/src/components/Reader/`:**
- Purpose: EPUB reader UI — the most modified area of the frontend
- Contains: `EpubReader.tsx` (main component, 84+ changes), `BookReader.tsx`, `ReaderControls.tsx`, `TocSidebar.tsx`, `SelectionMenu.tsx`, `IOSTapZones.tsx`, and `Core/` subdirectory
- Key files: `frontend/src/components/Reader/EpubReader.tsx`

**`frontend/src/components/Entities/`:**
- Purpose: Entity glossary/wiki UI components
- Contains: `EntityList.tsx`, `EntityCard.tsx`, `EntityDrawer.tsx`, `EntityProfile.tsx`, `EntityEventTimeline.tsx`, `RelationshipCard.tsx`, `RecapPanel.tsx`, `SpoilerText.tsx`
- Key files: `frontend/src/components/Entities/EntityProfile.tsx`, `frontend/src/components/Entities/EntityDrawer.tsx`

**`frontend/src/services/`:**
- Purpose: Client-side infrastructure — IndexedDB, offline, PWA, sync
- Contains: `chapterCache.ts`, `epubCache.ts`, `imageCache.ts`, `db.ts`, `storageManager.ts`, `downloadManager.ts`, `syncQueue.ts`, `pushNotifications.ts`, `tabSync.ts`
- Key files: `frontend/src/services/chapterCache.ts`, `frontend/src/services/db.ts`

**`frontend/src/stores/`:**
- Purpose: Zustand client-side global state
- Contains: `auth.ts` (JWT tokens + user), `reader.ts` (navigation mode, settings), `ui.ts` (toasts, modals), `index.ts` (init + cleanup)
- Key files: `frontend/src/stores/auth.ts`, `frontend/src/stores/reader.ts`

## Key File Locations

**Entry Points:**
- `backend/app/main.py`: FastAPI app, middleware stack, router registration
- `frontend/src/main.tsx`: React DOM root, wraps with ErrorBoundary
- `frontend/src/App.tsx`: React Router, route definitions, QueryClientProvider
- `backend/app/core/celery_app.py`: Celery app + beat schedule

**Configuration:**
- `backend/app/core/config.py`: All backend settings via pydantic-settings (env-driven)
- `frontend/src/lib/queryClient.ts`: TanStack Query client configuration
- `docker-compose.lite.yml`: Primary compose file for all environments

**Core Logic:**
- `backend/app/services/gemini_extractor.py`: Gemini AI extraction pipeline
- `backend/app/services/entity_service.py`: Entity spoiler-free filtering
- `backend/app/services/book_parser.py`: EPUB/FB2 parsing
- `backend/app/tasks/book_tasks.py`: Book processing Celery task
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts`: 8-strategy description highlighting
- `frontend/src/hooks/epub/useChapterMapping.ts`: EPUB spine to chapter number mapping
- `frontend/src/components/Reader/EpubReader.tsx`: Main reader orchestration

**Database:**
- `backend/alembic/versions/`: Migration history (48 migrations from Aug 2025)
- `backend/app/models/`: All ORM models

**Testing:**
- `backend/tests/`: pytest test suite
- `frontend/src/components/__tests__/`: Frontend component tests
- `frontend/src/hooks/__tests__/`: Frontend hook tests
- `frontend/src/hooks/epub/__tests__/`: EPUB hook tests

## Naming Conventions

**Backend Files:**
- Services: `snake_case_service.py` (e.g., `entity_service.py`, `auth_service.py`)
- Models: `snake_case.py` matching table name (e.g., `book.py`, `entity_mention.py`)
- Routers: `snake_case.py` (e.g., `reading_sessions.py`, `descriptions.py`)
- Tasks: `snake_case_tasks.py` (e.g., `book_tasks.py`, `image_tasks.py`)
- Migrations: `YYYY_MM_DD_HHMM-{hash}_{description}.py`

**Frontend Files:**
- Components: `PascalCase.tsx` (e.g., `EntityProfile.tsx`, `BookUploadModal.tsx`)
- Hooks: `camelCase.ts` starting with `use` (e.g., `useEpubLoader.ts`, `useCFITracking.ts`)
- API functions: `camelCase.ts` by domain (e.g., `books.ts`, `readingSessions.ts`)
- Stores: `camelCase.ts` (e.g., `auth.ts`, `reader.ts`)
- Types: `camelCase.ts` (e.g., `api.ts`, `epub.ts`, `entity.ts`)
- Services: `camelCase.ts` (e.g., `chapterCache.ts`, `storageManager.ts`)

**Directories:**
- Backend: `snake_case/` (e.g., `reading_sessions/`, `book/`)
- Frontend components: `PascalCase/` (e.g., `Reader/`, `Entities/`, `UI/`)
- Frontend hooks: `camelCase/` (e.g., `epub/`, `api/`, `reader/`)

## Where to Add New Code

**New Backend Feature (REST endpoint):**
- Service: `backend/app/services/{feature}_service.py`
- Router: `backend/app/routers/{feature}.py` or extend existing router
- Schema: `backend/app/schemas/responses/{feature}.py`
- Register router in `backend/app/main.py`
- Migration if DB changes: `cd backend && alembic revision --autogenerate -m "description"`

**New Backend Model:**
- File: `backend/app/models/{model_name}.py` extending `Base` from `core/database.py`
- Import in `backend/app/models/__init__.py`
- Create migration: `alembic revision --autogenerate`

**New Celery Task:**
- File: `backend/app/tasks/{domain}_tasks.py`
- Use `@celery_app.task` decorator with `bind=True`
- Register in `celery_app.conf.update(task_routes=...)` for queue routing

**New Frontend API Hook:**
- Add API function to `frontend/src/api/{domain}.ts`
- Add query key factory to `frontend/src/hooks/api/queryKeys.ts`
- Create hook in `frontend/src/hooks/api/use{Feature}.ts`
- Export from `frontend/src/hooks/api/index.ts`

**New Frontend Component:**
- Domain component: `frontend/src/components/{Domain}/MyComponent.tsx`
- UI primitive: `frontend/src/components/UI/MyComponent.tsx`
- Export from domain `index.ts`

**New Frontend Page:**
- File: `frontend/src/pages/{Name}Page.tsx`
- Add lazy import and route in `frontend/src/App.tsx`

**New EPUB Hook:**
- File: `frontend/src/hooks/epub/use{Feature}.ts`
- Export from `frontend/src/hooks/epub/index.ts`
- Import in `EpubReader.tsx` and wire via props

**New Zustand Store:**
- File: `frontend/src/stores/{name}.ts`
- Export from `frontend/src/stores/index.ts`
- Initialize in `initializeStores()` if needed

## Special Directories

**`backend/storage/`:**
- Purpose: Local file storage for uploaded EPUBs and generated images
- Generated: Yes (runtime)
- Committed: No (`.gitignore`)

**`backend/alembic/versions/`:**
- Purpose: Database migration history
- Generated: Via `alembic revision --autogenerate`
- Committed: Yes (required for reproducible deploys)

**`frontend/src/locales/`:**
- Purpose: i18n translation files (Russian primary language)
- Generated: No
- Committed: Yes

**`backend/htmlcov/`:**
- Purpose: pytest coverage HTML report
- Generated: Yes (`pytest --cov`)
- Committed: No

**`.planning/`:**
- Purpose: GSD planning documents (architecture, specs, phases)
- Generated: By GSD tools
- Committed: Yes

**`.claude/`:**
- Purpose: Claude Code skills, rules, hooks, agents
- Generated: Partially (some auto-generated, some hand-written)
- Committed: Yes

**`nginx/`:**
- Purpose: Nginx configuration for production reverse proxy
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-02-27*
