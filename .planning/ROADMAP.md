# Roadmap: fancai Production Readiness

## Overview

fancai is a working AI-powered book reader deployed at fancai.ru, but it runs in development mode with an exploitable JWT vulnerability, fake health checks, dead NLP code, and an AI pipeline that can exhaust thread pools on large books. This roadmap takes it from "works in dev" to "reliable in production" across six phases: first securing the foundation, then cleaning the codebase, stabilizing the AI pipeline, hardening the core entity wiki differentiator, polishing error handling, and finally delivering missing reader table-stakes features (bookmarks, highlights, search).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Production Safety** - Fix security vulnerabilities, switch to production deployment mode, initialize monitoring, add database backups
- [ ] **Phase 2: Dead Code Cleanup** - Remove NLP remnants, fix stub endpoints, clean dead config and schemas
- [ ] **Phase 3: AI Pipeline Stability** - Bound Gemini concurrency, add circuit breakers, fix asyncio threading
- [ ] **Phase 4: Entity Wiki Quality** - Harden spoiler-free filtering, improve Russian fuzzy matching, fix chunk boundary entity loss
- [ ] **Phase 5: Error Handling & UX** - Standardize error states, add loading indicators, improve failure recovery flows
- [ ] **Phase 6: Reader Features** - Implement bookmarks, highlights, in-book search, and entity-to-text linking

## Phase Details

### Phase 1: Production Safety
**Goal**: The application is safe to run in production -- no exploitable vulnerabilities, real monitoring captures errors, and the server runs in production mode with data protection
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, UX-01
**Success Criteria** (what must be TRUE):
  1. Application starts with DEBUG=False by default and rejects startup if default SECRET_KEY is used in non-debug mode
  2. JWT tokens are signed and verified using PyJWT (not python-jose), and forged tokens with alg=none are rejected
  3. Health check endpoint returns actual connectivity status for PostgreSQL, Redis, and Celery (not hardcoded "checking...")
  4. Backend errors appear in Sentry dashboard with full stack traces; frontend JavaScript errors appear in a separate Sentry project
  5. Application runs under Gunicorn with UvicornWorker in production (no --reload flag), and database is backed up on a schedule
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD

### Phase 2: Dead Code Cleanup
**Goal**: The codebase contains only living code -- every config field is used, every endpoint does what it claims, and no NLP artifacts remain to confuse future development
**Depends on**: Phase 1
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. No NLP-related files exist in the backend root (14 test files removed) and no NLP config fields exist in config.py or settings_manager.py
  2. Application starts successfully after NLP removal -- no broken validators, no missing config references
  3. The sync endpoint returns 501 Not Implemented with a clear message instead of silently discarding data
  4. Only celery_app.py exists for Celery configuration (dead celery_config.py removed) and admin schemas contain no NLP-specific fields
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

### Phase 3: AI Pipeline Stability
**Goal**: The AI extraction pipeline degrades gracefully under load and API failures -- large books process without hanging, rate limits are respected, and transient failures do not cascade
**Depends on**: Phase 2
**Requirements**: AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. Gemini API calls are bounded to a maximum concurrent count (semaphore), preventing rate limit errors during large book processing
  2. Gemini and Imagen API failures trigger a circuit breaker that prevents repeated calls to a failing service, with automatic recovery when the service returns
  3. Async Gemini calls use a properly bounded thread pool (not the shared asyncio default), so HTTP request handling is never blocked by AI processing
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Entity Wiki Quality
**Goal**: The entity wiki -- fancai's core differentiator -- is provably spoiler-free, handles Russian names accurately, and processes books of any size without silently losing entities
**Depends on**: Phase 3
**Requirements**: WIKI-01, WIKI-02, WIKI-03, WIKI-04, UX-06
**Success Criteria** (what must be TRUE):
  1. Spoiler-free filtering has exhaustive test coverage including property-based tests, boundary chapter edge cases, and empty entity scenarios -- no future-chapter data leaks
  2. Russian name fuzzy matching uses a lower threshold (~0.70-0.75) so that short names like "Garri" correctly match "Garri Potter" during entity deduplication
  3. Books with 500+ entities are fully processed via recursive map-reduce instead of truncation at 300K chars -- no silent entity loss
  4. Reprocessing a book cleans up orphaned descriptions from the previous extraction run before writing new ones
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Error Handling & UX
**Goal**: Users see clear, helpful feedback for every failure state and every loading transition -- no silent failures, no blank screens, no mystery spinners
**Depends on**: Phase 1
**Requirements**: UX-02, UX-03, UX-04, UX-05
**Success Criteria** (what must be TRUE):
  1. All API error responses display using ErrorMessage.tsx with consistent styling and actionable guidance (no raw error codes or blank error states)
  2. Book parsing failures show an informative message explaining what went wrong and a retry button
  3. Chapter transitions show a shimmer/skeleton loading state while epub.js re-renders content
  4. AI extraction failures (Gemini/Imagen) show a clear explanation of what failed and offer a retry action
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Reader Features
**Goal**: The reader has the table-stakes annotation and navigation features that users expect from a modern book reader in 2026
**Depends on**: Phase 5
**Requirements**: READ-01, READ-02, READ-03, READ-04, READ-05
**Success Criteria** (what must be TRUE):
  1. User can create, view, and delete bookmarks that persist to the backend and appear in the reader sidebar
  2. User can highlight text passages and add annotations, with highlights visually rendered in the reading view
  3. Bookmarks and highlights sync to the backend via a real API endpoint (not a stub)
  4. User can search within the current book text and navigate to results
  5. Tapping a character name in the book text opens the corresponding entity profile
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
Note: Phases 5-6 depend on Phase 1 (not Phase 4). Phases 3-4 and 5-6 are independent tracks, but execute sequentially for solo dev workflow.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Production Safety | 0/2 | Not started | - |
| 2. Dead Code Cleanup | 0/1 | Not started | - |
| 3. AI Pipeline Stability | 0/1 | Not started | - |
| 4. Entity Wiki Quality | 0/2 | Not started | - |
| 5. Error Handling & UX | 0/1 | Not started | - |
| 6. Reader Features | 0/2 | Not started | - |
