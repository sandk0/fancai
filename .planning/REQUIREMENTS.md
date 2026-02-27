# Requirements: fancai Production Readiness

**Defined:** 2026-02-27
**Core Value:** Пользователь может загрузить книгу, читать, получить AI-глоссарий без спойлеров и видеть иллюстрации — стабильно и без сбоев

## v1 Requirements

Requirements for production release. Each maps to roadmap phases.

### Security

- [ ] **SEC-01**: Fix DEBUG default to False in config.py
- [ ] **SEC-02**: Fix hardcoded SECRET_KEY — fail startup if default key used in non-debug
- [ ] **SEC-03**: Replace python-jose (CVE) with PyJWT for JWT operations

### Dead Code & Stubs Cleanup

- [ ] **CLEAN-01**: Remove 14 NLP root-level test files (test_nlp_processors.py, test_gliner_integration.py, etc.)
- [ ] **CLEAN-02**: Remove NLP config fields from config.py (SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE, etc.) and settings_manager.py (nlp_global, nlp_spacy, nlp_natasha, nlp_stanza, nlp_gliner sections)
- [ ] **CLEAN-03**: Remove dead celery_config.py (only celery_app.py is used)
- [ ] **CLEAN-04**: Fix sync.py TODO stubs — return 501 Not Implemented instead of silent failure
- [ ] **CLEAN-05**: Remove NLP schemas from admin response schemas

### Error Handling & UX

- [ ] **UX-01**: Implement real health check endpoint (actual DB + Redis + Celery connectivity check)
- [ ] **UX-02**: Standardize error messages across all failure states (use ErrorMessage.tsx consistently)
- [ ] **UX-03**: Add user-friendly error states for book parsing failures (informative message + retry action)
- [ ] **UX-04**: Add chapter transition loading states (shimmer/skeleton while epub.js re-renders)
- [ ] **UX-05**: Improve AI extraction failure recovery UX (clear "what went wrong" + retry)
- [ ] **UX-06**: Fix orphaned descriptions on book reprocess (uncomment/fix deletion of old descriptions)

### Entity Wiki Quality

- [ ] **WIKI-01**: Lower fuzzy matching threshold for Russian names (0.85 → ~0.70-0.75 with validation)
- [ ] **WIKI-02**: Fix chunk boundary entity loss — implement recursive reduce instead of truncation at 300K chars
- [ ] **WIKI-03**: Add ConsistencyManager unit tests (merge decisions, advisory locks, LLM reduce)
- [ ] **WIKI-04**: Add exhaustive spoiler-free filtering tests (edge cases, boundary chapters, empty entities)

### AI Pipeline Stability

- [ ] **AI-01**: Bound Gemini API semaphore — limit concurrent chunk processing to prevent rate limit hits
- [ ] **AI-02**: Add circuit breaker for Gemini/Imagen API calls (prevent cascading timeouts)
- [ ] **AI-03**: Fix asyncio.to_thread pattern — use async Google GenAI client or properly bounded thread pool

### Production Deployment

- [ ] **DEPLOY-01**: Switch to Gunicorn in production (remove --reload flag from docker-compose.lite.yml)
- [ ] **DEPLOY-02**: Initialize Sentry backend (sentry-sdk already in requirements, needs sentry_sdk.init())
- [ ] **DEPLOY-03**: Add frontend Sentry SDK (@sentry/react) for error tracking
- [ ] **DEPLOY-04**: Add database backup strategy (pg_dump via sidecar container with scheduled cron)

### Reader Polish

- [ ] **READ-01**: Implement bookmarks functionality (persist to backend, show in sidebar)
- [ ] **READ-02**: Implement text highlights/annotations (SelectionMenu UI stubs exist, wire up)
- [ ] **READ-03**: Implement bookmark/highlight sync endpoint (replace sync.py TODO stubs with real implementation)
- [ ] **READ-04**: Add in-book text search (search within current book text)
- [ ] **READ-05**: Add entity-to-text linking (tap character name in text → entity profile)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Security Enhancements

- **SEC-04**: Reduce access token expiry to 15-30 minutes
- **SEC-05**: Fix password reset URL (localhost → production domain)
- **SEC-06**: Add file upload magic byte validation (EPUB = ZIP magic)
- **SEC-07**: Add METRICS_PASSWORD to production secrets check
- **SEC-08**: Implement CSP nonce generation

### Performance & Scaling

- **PERF-01**: Implement Gemini Context Caching (60-70% token savings)
- **PERF-02**: Increase Celery concurrency (currently fixed at 1)
- **PERF-03**: Split oversized router files (images.py, reading_sessions.py)

### Features

- **FEAT-01**: WebSocket real-time updates (replace polling for book processing)
- **FEAT-02**: Batch description fetch endpoint
- **FEAT-03**: Notes on highlights
- **FEAT-04**: OAuth social login (Google, GitHub)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Payment system (YooKassa/CloudPayments) | Monetization deferred; stubs exist but no routes |
| Social/community features | Scope creep; reading is solitary; no competitive moat |
| Built-in book store/marketplace | Complex legal/licensing; users source books elsewhere |
| Text-to-speech / audio narration | Better served by OS-level accessibility tools |
| AI book recommendations | Cold start problem; not related to core reading experience |
| Multi-format beyond EPUB/FB2 | EPUB is the standard; recommend Calibre for conversion |
| Collaborative annotations | Single-user first |
| Inline dictionary/translation | Tangential to core value; OS-level dictionary available |
| Mobile native app | Web-first approach |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1: Production Safety | Pending |
| SEC-02 | Phase 1: Production Safety | Pending |
| SEC-03 | Phase 1: Production Safety | Pending |
| DEPLOY-01 | Phase 1: Production Safety | Pending |
| DEPLOY-02 | Phase 1: Production Safety | Pending |
| DEPLOY-03 | Phase 1: Production Safety | Pending |
| DEPLOY-04 | Phase 1: Production Safety | Pending |
| UX-01 | Phase 1: Production Safety | Pending |
| CLEAN-01 | Phase 2: Dead Code Cleanup | Pending |
| CLEAN-02 | Phase 2: Dead Code Cleanup | Pending |
| CLEAN-03 | Phase 2: Dead Code Cleanup | Pending |
| CLEAN-04 | Phase 2: Dead Code Cleanup | Pending |
| CLEAN-05 | Phase 2: Dead Code Cleanup | Pending |
| AI-01 | Phase 3: AI Pipeline Stability | Pending |
| AI-02 | Phase 3: AI Pipeline Stability | Pending |
| AI-03 | Phase 3: AI Pipeline Stability | Pending |
| WIKI-01 | Phase 4: Entity Wiki Quality | Pending |
| WIKI-02 | Phase 4: Entity Wiki Quality | Pending |
| WIKI-03 | Phase 4: Entity Wiki Quality | Pending |
| WIKI-04 | Phase 4: Entity Wiki Quality | Pending |
| UX-06 | Phase 4: Entity Wiki Quality | Pending |
| UX-02 | Phase 5: Error Handling & UX | Pending |
| UX-03 | Phase 5: Error Handling & UX | Pending |
| UX-04 | Phase 5: Error Handling & UX | Pending |
| UX-05 | Phase 5: Error Handling & UX | Pending |
| READ-01 | Phase 6: Reader Features | Pending |
| READ-02 | Phase 6: Reader Features | Pending |
| READ-03 | Phase 6: Reader Features | Pending |
| READ-04 | Phase 6: Reader Features | Pending |
| READ-05 | Phase 6: Reader Features | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
