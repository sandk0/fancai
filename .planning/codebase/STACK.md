# Technology Stack

**Analysis Date:** 2026-02-27

## Languages

**Primary:**
- TypeScript 5.7 - Frontend (React SPA)
- Python 3.11 - Backend (FastAPI API + Celery workers)

**Secondary:**
- CSS (Tailwind v4) - Styling
- SQL - Database migrations via Alembic

## Runtime

**Frontend Environment:**
- Node.js (via npm) - Development and build tooling
- Browser - Runtime target (ES2020)

**Backend Environment:**
- Python 3.11
- Uvicorn 0.40.0 (ASGI server, dev) / Gunicorn 25.0.1 (production)

**Package Managers:**
- npm - Frontend (`frontend/package-lock.json` present)
- pip - Backend (`backend/requirements.txt` and `backend/requirements.lite.txt`)

## Frameworks

**Core Frontend:**
- React 19.0.0 - UI framework (functional components only)
- Vite 7.3.1 - Build tool and dev server
- React Router DOM 7.1.0 - Client-side routing
- TanStack Query 5.90.12 - Server state management and API data fetching
- Zustand 5.0.10 - Client-side state management (auth, reader, UI)
- React Hook Form 7.54.2 + Zod 4.3.6 - Form validation

**Core Backend:**
- FastAPI 0.128.0 - HTTP API framework with async support
- SQLAlchemy 2.0.46 - ORM with async engine (`asyncpg`)
- Alembic 1.18.3 - Database migrations
- Celery 5.6.2 - Async task queue (book processing, image generation)
- Pydantic 2.12.5 - Schema validation (v2, Rust core)

**UI Component Libraries:**
- Radix UI - Headless components (`@radix-ui/react-*`)
- Tailwind CSS 4.1.18 - Utility-first CSS (via `@tailwindcss/vite` plugin)
- Motion 12.31.0 - Animations
- Lucide React 0.563.0 - Icons
- Sonner 2.0.7 - Toast notifications
- Vaul 1.1.2 - Drawer/bottom sheet

**Testing:**
- Vitest 4.0.18 - Unit/integration test runner (frontend)
- Playwright 1.49.1 - E2E tests (frontend)
- Testing Library (React, DOM, user-event) - Component testing
- pytest 9.0.2 + pytest-asyncio 1.3.0 - Backend test runner

**Build/Dev:**
- Vite PWA plugin 1.2.0 - Service Worker via Workbox `injectManifest` strategy
- Rollup Visualizer 6.0.5 - Bundle analysis
- ESLint 9.17.0 + typescript-eslint 8.54.0 - Frontend linting
- Black 26.1.0 + Ruff 0.15.0 + mypy 1.19.1 - Backend formatting/linting

## Key Dependencies

**Critical Frontend:**
- `epubjs` 0.3.93 - EPUB rendering and navigation (CFI-based position tracking)
- `dexie` 4.2.1 - IndexedDB wrapper for offline chapter caching
- `axios` 1.7.9 - HTTP client (wrapped in `src/api/client.ts` singleton)
- `i18next` 25.8.0 + `react-i18next` 16.5.4 - Internationalization
- `dompurify` 3.3.0 - HTML sanitization for EPUB content
- `@tanstack/react-virtual` 3.13.18 - Virtualization for entity lists

**Critical Backend:**
- `google-genai` 1.61.0 - Google Gemini and Imagen SDK (primary AI integration)
- `asyncpg` 0.31.0 - Async PostgreSQL driver
- `redis` 7.1.0 (async) - Cache + Celery broker/backend
- `tenacity` 9.1.2 - Retry with exponential backoff for all LLM calls
- `python-jose` 3.5.0 - JWT token generation and validation
- `passlib[bcrypt]` 1.7.4 - Password hashing
- `networkx` 3.6.1 - Entity graph analysis
- `ebooklib` 0.20 + `lxml` 6.0.2 - EPUB parsing
- `beautifulsoup4` 4.14.3 - HTML extraction from EPUB chapters
- `loguru` 0.7.3 - Structured logging
- `sentry-sdk[fastapi]` 2.51.0 - Error tracking
- `prometheus-client` 0.24.1 + `prometheus-fastapi-instrumentator` 7.1.0 - Metrics
- `pywebpush` 2.2.0 - Web Push (VAPID) notifications
- `aioboto3` 13.0.0 - Async AWS/SES-compatible client (for Yandex Postbox email)
- `pillow` 12.1.0 - Image processing

**PWA / Service Worker:**
- Workbox 7.4.0 (`workbox-routing`, `workbox-strategies`, `workbox-background-sync`, etc.) - Service Worker caching and offline sync

## Configuration

**Frontend Environment Variables (VITE_ prefix):**
- `VITE_API_BASE_URL` - API base URL (default: `/api/v1`)
- `VITE_WS_URL` - WebSocket URL (default: `/ws`)
- `VITE_APP_NAME` - Application name
- `VITE_ENVIRONMENT` - Environment name

**Backend Environment Variables (loaded via pydantic-settings from `.env`):**
- `DATABASE_URL` - PostgreSQL connection string (`postgresql+asyncpg://...`)
- `REDIS_URL` - Redis connection string (`redis://:password@host:port`)
- `SECRET_KEY` - JWT signing key
- `GOOGLE_API_KEY` / `LANGEXTRACT_API_KEY` - Google AI API key (Gemini + Imagen)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` - Web Push
- `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY` - Email
- `CORS_ORIGINS` - Comma-separated allowed origins
- `DEBUG` - Dev/prod toggle (validates secrets when `false`)
- `SENTRY_DSN` - Error tracking (configured via sentry-sdk)

**Build Configuration:**
- `frontend/vite.config.ts` - Vite build config with manual chunks, PWA, proxy
- `frontend/tsconfig.json` - TypeScript with strict mode, path aliases (`@/*` → `src/*`)
- `frontend/vitest.config.ts` - Vitest with jsdom, v8 coverage
- `backend/pytest.ini` - pytest with asyncio-mode=auto, 70% coverage threshold
- `backend/alembic.ini` - Alembic migrations config

## Platform Requirements

**Development:**
- Docker + Docker Compose (V2, `docker compose` not `docker-compose`)
- Node.js (frontend dev server on port 5173)
- Python 3.11 (backend on port 8000)

**Production:**
- Docker Compose via `docker-compose.lite.yml` (primary production config)
- PostgreSQL 15-alpine (data initialized on v15, not upgradeable to v17)
- Redis 7.4-alpine (640MB maxmemory, allkeys-lru eviction)
- nginx (reverse proxy, frontend static serving)
- Target server: 8GB RAM, 4 CPU cores
- Deployed to: `fancai.ru` (Russian domain, Europe/Moscow timezone)

---

*Stack analysis: 2026-02-27*
