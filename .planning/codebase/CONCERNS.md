# Codebase Concerns

**Analysis Date:** 2026-02-27

## Tech Debt

**NLP System Remnants (Post-Removal Cleanup Incomplete):**
- Issue: NLP system was removed in Dec 2025 but dead config and settings remain active
- Files:
  - `backend/app/core/config.py` (lines 79-90): `SPACY_MODEL`, `NLTK_DATA_PATH`, `MULTI_NLP_MODE`, `CONSENSUS_THRESHOLD`, `SPACY_WEIGHT`, `NATASHA_WEIGHT`, `STANZA_WEIGHT` all unused
  - `backend/app/services/settings_manager.py`: Full `nlp_global`, `nlp_spacy`, `nlp_natasha`, `nlp_stanza`, `nlp_gliner` config sections still active
  - `backend/app/schemas/responses/admin.py`: Admin schemas expose NLP settings that no longer exist
  - `backend/test_nlp_processors.py`, `backend/test_gliner_integration.py`, `backend/test_deeppavlov_integration.py`, `backend/test_advanced_parser*.py`, `backend/test_langextract_processor.py`, `backend/test_enrichment_integration.py`: 14 root-level test files for removed NLP system clutter the project root
- Impact: Misleads future developers; dead config increases cognitive load; root-level test files fail or are ignored

**Unimplemented Sync Endpoints:**
- Issue: The `/api/v1/sync/batch` endpoint accepts bookmark and reading-session sync ops but immediately fails them with TODO stubs
- Files: `backend/app/routers/sync.py` (lines 297-310)
- Impact: Frontend offline sync for bookmarks and highlights returns errors, data is silently lost when user goes offline

**Missing Batch Description API Endpoint:**
- Issue: `useBookDescriptions` hook in frontend is permanently disabled — stub returns `[]` with `enabled: false`
- Files: `frontend/src/hooks/api/useDescriptions.ts` (lines 355-369)
- Impact: Cannot fetch all descriptions for a book at once; feature is a no-op

**WebSocket Disabled (Backend Cookie Auth Gap):**
- Issue: `WebSocketService` in frontend is a no-op stub; all methods return `Promise.resolve()`. The backend WebSocket router exists at `backend/app/routers/websocket.py` but no cookie auth is implemented
- Files: `frontend/src/services/websocket.tsx`
- Impact: All real-time push updates (book processing, image generation, entity updates) fall back to polling; user experience is degraded for long-running operations

**Incomplete Reprocess — Orphaned Descriptions:**
- Issue: When triggering a book reprocess, old descriptions are NOT deleted. The code to delete them is commented out
- Files: `backend/app/routers/books/crud.py` (lines 741-743)
- Impact: After reprocessing, stale descriptions from the old analysis may persist in the database alongside new ones

**LLM Reduce Without Recursion:**
- Issue: `ConsistencyManager.optimize_entities()` truncates entity lists >300K chars instead of splitting into recursive reduce passes
- Files: `backend/app/services/consistency_manager.py` (lines 581-585)
- Impact: For large books (>500 entities), the deduplication reduce step silently drops entities at the end of the list

**Unimplemented Health Check:**
- Issue: The `/health` endpoint in `main.py` returns `"database": "checking..."` as a hardcoded string, not an actual check
- Files: `backend/app/main.py` (line 331)
- Impact: Health monitoring and alerting tools may report false-positive healthy status when DB is down

**Payment System Stubs:**
- Issue: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `CLOUDPAYMENTS_PUBLIC_ID` are defined in config but no payment routes exist. Subscription tier enforcement is present but upgrading subscription requires manual DB edits
- Files: `backend/app/core/config.py` (lines 75-78)
- Impact: Premium subscription is a one-way door — users can't self-serve upgrade; monetization is non-functional

## Known Bugs

**Chunk Boundary Entity Loss:**
- Symptoms: Entities mentioned only once near a 100K-char chunk boundary may not appear in the glossary
- Files: `backend/app/services/gemini_extractor.py` (lines 231-234, 370-382)
- Trigger: Books with chapters longer than 100K characters; 15% overlap partially mitigates but doesn't guarantee boundary entities are captured
- Workaround: None; increasing `chunk_overlap_percent` reduces frequency but increases LLM cost

**Fuzzy Entity Matching Misses Short Russian Names:**
- Symptoms: "Гарри" and "Гарри Поттер" may not be recognized as the same entity by TSA parser (threshold 0.85 too high)
- Files:
  - `backend/app/services/tsa_parser.py` (lines 59, 62): `FUZZY_THRESHOLD = 0.85`
  - `backend/app/services/gemini_extractor.py` (line 245): `tsa_fuzzy_threshold: float = 0.85`
- Trigger: Russian proper names where short form has ≤0.85 SequenceMatcher similarity to long form
- Workaround: LLM deduplication pass catches some missed cases, but not all

**Password Reset URL Hardcodes localhost:**
- Symptoms: Password reset emails sent in production contain `http://localhost:5173/reset-password` links
- Files: `backend/app/core/config.py` (line 135): `PASSWORD_RESET_BASE_URL: str = "http://localhost:5173/reset-password"`
- Trigger: Any user requesting password reset in production (email feature must be enabled via `EMAIL_ENABLED=True`)
- Workaround: Must override `PASSWORD_RESET_BASE_URL` env var in production deployment

**Gemini Sync API Called in Async Context via `asyncio.to_thread`:**
- Symptoms: Thread pool blocking under high Celery concurrency; potential deadlocks if thread pool exhausted
- Files:
  - `backend/app/services/gemini_extractor.py` (lines 747-753): `asyncio.to_thread(self._client.models.generate_content, ...)`
  - `backend/app/services/imagen_generator.py` (lines 176, 668-670)
- Trigger: Multiple concurrent book processing tasks; Celery concurrency >1
- Workaround: `CELERY_CONCURRENCY=1` (current default) reduces risk but limits throughput

## Security Considerations

**Default Debug Mode in Production:**
- Risk: `DEBUG: bool = True` is the default; if env var is not set, production runs in debug mode exposing SQL queries, tracebacks, and stack traces
- Files: `backend/app/core/config.py` (lines 19-21)
- Current mitigation: `validate_production_settings()` validator checks SECRET_KEY and DB passwords in non-debug mode, but only fires when `DEBUG=False`
- Recommendations: Flip default to `DEBUG = False`; add startup warning if DEBUG is True in production context

**Default Secret Key Hardcoded:**
- Risk: `SECRET_KEY: str = "dev-secret-key-change-in-production"` — if DEBUG env var is misconfigured, JWTs signed with this key are trivially forgeable
- Files: `backend/app/core/config.py` (line 22)
- Current mitigation: Production validator rejects this value when `DEBUG=False`
- Recommendations: Generate random key at startup if not set; log critical error on startup

**Access Token Expiry Extended to 7 Days:**
- Risk: `ACCESS_TOKEN_EXPIRE_MINUTES = 10080` (7 days). Stolen access tokens remain valid for a week without any rotation mechanism
- Files: `backend/app/core/config.py` (lines 46-48)
- Current mitigation: Refresh token is 30 days; no token revocation on logout observed unless blacklist is invoked
- Recommendations: Reduce access token to 15-30 minutes; verify token blacklist is consistently applied on logout

**CSP Nonce Not Implemented:**
- Risk: CSP `script-src` directive has `'unsafe-inline'` removed but there is no nonce generation — any inline scripts will be blocked, potentially breaking the frontend; or the CSP is less restrictive than intended
- Files: `backend/app/middleware/security_headers.py` (lines 76, 84-90)
- Current mitigation: Comment states nonces are TODO
- Recommendations: Implement nonce generation per-request or document that no inline scripts are used

**Metrics Endpoint Uses Hardcoded Default Password:**
- Risk: `METRICS_PASSWORD: str = "metrics_secure_password"` — Prometheus `/health/metrics` is protected only by HTTP Basic Auth with this default
- Files: `backend/app/core/config.py` (line 126)
- Current mitigation: Must be overridden via env var; production validator does not check this value
- Recommendations: Add `METRICS_PASSWORD` to production secrets check

**File Upload: Extension-Only Validation (No Magic Bytes Check):**
- Risk: EPUB/FB2 file type is validated by extension only; a malicious file with `.epub` extension but arbitrary content would pass validation
- Files: `backend/app/core/config.py` (line 55): `ALLOWED_EXTENSIONS: list = [".epub", ".fb2"]`; `backend/app/routers/books/validation.py`
- Current mitigation: ebooklib parser will fail to parse invalid EPUBs and raise exceptions
- Recommendations: Add magic byte validation (EPUB is a ZIP; ZIP magic = `PK\x03\x04`)

## Performance Bottlenecks

**Large Router Files (Monolithic):**
- Problem: Two router files are significantly oversized, making them slow to parse, test, and modify
- Files:
  - `backend/app/routers/images.py` — 950 lines (noted in MEMORY.md as "33K lines", likely from earlier state)
  - `backend/app/routers/reading_sessions.py` — 1,088 lines (noted as "41K lines")
- Cause: All image generation, admin, stats, and batch endpoints in one file; all reading session CRUD and analytics in one file
- Improvement path: Split by concern — `images_crud.py`, `images_generation.py`, `images_admin.py`; separate `reading_sessions_service.py` logic is already extracted

**No Gemini Context Caching:**
- Problem: System prompt is resent with every Gemini API call; the system prompt alone (extraction + TSA instructions) is several KB
- Files: `backend/app/services/gemini_extractor.py` — full prompt rebuilt per chunk call
- Cause: Google Gemini Context Caching API (which can cache static system prompts for 60-70% token savings) is not implemented
- Improvement path: Use `google.genai.caching.CachedContent` to cache static portions of the extraction prompt; documented as 60-70% savings available in project audit

**Celery Concurrency Fixed at 1:**
- Problem: `CELERY_CONCURRENCY=1` means only one book can be processed at a time; queued books block
- Files: `backend/app/core/config.py` (line 107)
- Cause: Server memory constraints (4GB RAM / 2 CPU); each book processing task can use significant memory
- Improvement path: Implement priority queues; enable concurrency=2 with lower max memory per child

**Parallel Chunk Processing with Unbounded Semaphore:**
- Problem: `asyncio.gather()` on all chunks runs all chunks in parallel; for a large book this could fire 20+ simultaneous Gemini API calls
- Files: `backend/app/services/gemini_extractor.py` (lines 633-637)
- Cause: Semaphore exists (`_semaphore`) but its max limit and its interaction with Celery task concurrency is not documented
- Improvement path: Document semaphore value and tune to stay within Gemini rate limits

## Fragile Areas

**EpubReader.tsx — Hottest File:**
- Files: `frontend/src/components/Reader/EpubReader.tsx`
- Why fragile: 84 git changes — highest churn in the codebase; epub.js `CFI` tracking, touch navigation, description highlighting all converge here
- Safe modification: Extract logic into hooks before editing (pattern already started with 25+ hooks); read `useDescriptionHighlighting.ts` before any highlighting changes
- Test coverage: Unit tests in `frontend/src/components/Reader/__tests__/EpubReader.test.tsx` (1,069 lines); Playwright integration tests exist

**Description Highlighting — 8 Fallback Strategies:**
- Files: `frontend/src/hooks/epub/useDescriptionHighlighting.ts`
- Why fragile: 8 ordered search strategies with complex fallback chain; breaking any strategy degrades highlighting without obvious failure
- Safe modification: Run `frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.tsx` (679 lines) before and after changes
- Test coverage: Tests exist but do not cover all strategy fallbacks exhaustively

**ConsistencyManager — Entity Merge Logic:**
- Files: `backend/app/services/consistency_manager.py` (722 lines)
- Why fragile: Complex LLM-driven merge + PostgreSQL advisory locks + Celery task context; no dedicated unit test file; only tested indirectly via integration tests
- Safe modification: Use the advisory lock pattern (`_acquire_entity_lock`) for any new entity creation; never modify without running `tests/integration/test_entity_concurrent_upsert.py`
- Test coverage: No dedicated unit tests; `test_entity_concurrent_upsert.py` is the only direct test

**Entity Spoiler-Free Filtering — Runtime Chapter Filtering:**
- Files: `backend/app/services/entity_service.py` (lines 546-614)
- Why fragile: Spoiler filtering happens at response time by applying chapter filters to cached raw data; cache stores ALL data including future spoilers; if filtering logic has a bug, spoilers leak to users
- Safe modification: Run `tests/services/test_entity_spoiler_free.py` after any changes to `_apply_chapter_filter` or `_filter_entity_detail`
- Test coverage: `test_entity_spoiler_free.py` exists and covers key paths

**TSA Parser Fuzzy Matching:**
- Files: `backend/app/services/tsa_parser.py`
- Why fragile: Position-sensitive fuzzy matching; wrong threshold changes affect every description highlight position across all books; changing `FUZZY_THRESHOLD` has cascading effects on highlighting accuracy
- Safe modification: Test changes against multiple real book samples; threshold is baked into `GeminiConfig.tsa_fuzzy_threshold = 0.85`

## Scaling Limits

**Redis Single Instance:**
- Current capacity: Single Redis instance at `REDIS_URL` handles caching, rate limiting, Celery broker, and pub/sub simultaneously
- Limit: If Redis goes down, the entire application degrades — rate limiting disabled, cache unavailable, Celery tasks unable to queue
- Scaling path: Separate Redis instances for cache vs. Celery broker; add Redis Sentinel or Redis Cluster for HA

**PostgreSQL Connection Pool:**
- Current capacity: Pool size 20, max overflow 40 (60 total connections) — appropriate for current load
- Limit: At high concurrent user load (hundreds of simultaneous reading sessions), connection pool exhaustion causes 503 errors
- Scaling path: PgBouncer connection pooling layer between app and PostgreSQL

**Book Processing Queue:**
- Current capacity: Single Celery worker, concurrency=1 — one book processed at a time
- Limit: Queue depth grows linearly with uploaded books; users may wait hours for processing during peak upload periods
- Scaling path: Scale Celery workers horizontally; priority queues so premium users process faster

## Dependencies at Risk

**`python-jose` (JWT Library):**
- Risk: `python-jose` has known security vulnerabilities and is no longer actively maintained; it's used for all JWT encode/decode operations
- Files: `backend/app/services/auth_service.py` (line 10): `from jose import JWTError, jwt`
- Impact: Potential JWT vulnerabilities in auth layer
- Migration plan: Replace with `python-jwt` or `PyJWT` (actively maintained); API is similar

**`ebooklib` (EPUB Parsing):**
- Risk: `ebooklib` has limited active maintenance; some EPUB 3.0 features are unsupported; errors on malformed EPUBs surface as unhandled exceptions in book_parser.py
- Files: `backend/app/services/book_parser.py` (lines 20-27): wrapped in `try/except ImportError`
- Impact: EPUB books with unusual structures may fail to parse without informative errors
- Migration plan: No obvious drop-in replacement; contribute fixes upstream or add more robust exception handling

## Missing Critical Features

**Email Service Disabled by Default:**
- Problem: `EMAIL_ENABLED: bool = False` in config; password reset flow generates tokens but silently skips email delivery unless explicitly enabled
- Files: `backend/app/core/config.py` (line 138)
- Blocks: Password reset is non-functional in any deployment without setting `EMAIL_ENABLED=True` and Yandex Postbox credentials

**Bookmark and Highlight Sync Not Implemented:**
- Problem: The sync endpoint accepts bookmark and highlight operations but immediately returns failure; frontend offline queue accumulates these operations and they are never applied
- Files: `backend/app/routers/sync.py` (lines 297-310)
- Blocks: Reading bookmarks created offline are lost when device comes online; feature is documented but broken

## Test Coverage Gaps

**ConsistencyManager — No Unit Tests:**
- What's not tested: Entity merge decisions, PostgreSQL advisory lock behavior, LLM reduce truncation logic
- Files: `backend/app/services/consistency_manager.py` (722 lines)
- Risk: Silent entity data corruption on concurrent book processing
- Priority: High

**Gemini Extractor Chunk Boundary Behavior:**
- What's not tested: Entity extraction at 100K-char chunk boundaries; overlap deduplication correctness
- Files: `backend/app/services/gemini_extractor.py` (1,319 lines); `backend/tests/services/test_gemini_extractor.py` (mocked tests only)
- Risk: Entity loss at chunk boundaries goes undetected; real API calls never tested in CI
- Priority: High

**Sync Router — All TODO Paths Untested:**
- What's not tested: Bookmark sync, highlight sync, reading session sync (all return errors currently)
- Files: `backend/app/routers/sync.py`
- Risk: When sync is implemented, regression testing baseline does not exist
- Priority: Medium

**Frontend WebSocket Service:**
- What's not tested: `frontend/src/services/websocket.tsx` is a no-op stub with no tests; reconnection logic, message parsing, event routing are all untested
- Files: `frontend/src/services/websocket.tsx`
- Risk: When WebSocket auth is implemented, untested reconnection logic may cause memory leaks or missed events
- Priority: Medium

**Imagen Generator — No Integration Tests:**
- What's not tested: Actual image generation flow, base64 PNG detection fallback, retries on rate limit
- Files: `backend/tests/services/test_image_generator_TEMPLATE.py` — filename ends in `_TEMPLATE.py` indicating it was never implemented
- Risk: Image generation failures in production are discovered by users, not CI
- Priority: Medium

---

*Concerns audit: 2026-02-27*
