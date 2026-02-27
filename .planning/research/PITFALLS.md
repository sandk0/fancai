# Pitfalls Research

**Domain:** Production hardening of an AI-powered EPUB reader (FastAPI + React + Celery + Gemini/Imagen)
**Researched:** 2026-02-27
**Confidence:** HIGH (based on codebase analysis + verified external research)

## Critical Pitfalls

### Pitfall 1: Security Defaults Ship to Production Undetected

**What goes wrong:**
The app has `DEBUG = True` as default, `SECRET_KEY = "dev-secret-key-change-in-production"`, `METRICS_PASSWORD = "metrics_secure_password"`, and `PASSWORD_RESET_BASE_URL = "http://localhost:5173/reset-password"` all hardcoded in `config.py`. The production validator only fires when `DEBUG=False`, meaning if the env var is missing or misconfigured, the entire security gate is bypassed. Password reset emails go to localhost. Prometheus metrics are accessible with a known default password. JWTs are signed with a guessable key.

**Why it happens:**
Development-friendly defaults are the path of least resistance. The production validator is a chicken-and-egg problem: it only validates when `DEBUG=False`, but `DEBUG` itself defaults to `True`. Admin endpoints (`/health/metrics`) have their own separate credentials that the validator does not check.

**How to avoid:**
1. Flip `DEBUG` default to `False` -- force developers to explicitly opt into debug mode
2. Generate a random `SECRET_KEY` at startup if not set via env var, and log a CRITICAL warning
3. Add `METRICS_PASSWORD` and `PASSWORD_RESET_BASE_URL` to the production validator
4. Add a startup check: if `PASSWORD_RESET_BASE_URL` contains `localhost` and `DEBUG=False`, refuse to start
5. Use `python-decouple` or Pydantic's `SecretStr` for all secrets so they never appear in logs or tracebacks

**Warning signs:**
- Health check shows `database: "checking..."` (proves you are running the fake health endpoint)
- Password reset links in emails point to `localhost:5173`
- `/health/metrics` accessible without custom credentials
- Stack traces visible in API error responses (indicates DEBUG mode)

**Phase to address:**
Security hardening phase -- this must be the FIRST thing fixed, before any other production deployment work.

---

### Pitfall 2: TODO Stubs Masquerading as Working Features

**What goes wrong:**
Three distinct areas pretend to work but silently fail: (1) The sync router accepts bookmark/highlight/reading-session operations but immediately returns failures with `# TODO: Implement` comments. (2) The `useBookDescriptions` hook is permanently `enabled: false`, returning `[]`. (3) The health endpoint returns `"database": "checking..."` as a string, not an actual DB check. Users and monitoring systems see "success" responses from endpoints that do nothing.

**Why it happens:**
Stubs were created as scaffolding during rapid development. They compile, they return HTTP 200 (or structured errors), and they pass cursory testing. Nobody goes back to remove or implement them. The frontend offline sync queue accumulates operations that are silently lost when replayed.

**How to avoid:**
1. Audit every `TODO` and `FIXME` in the codebase. For each: implement, remove the endpoint entirely, or return HTTP 501 (Not Implemented) with a clear message
2. For sync: either implement bookmark/highlight sync or remove the endpoint and disable the frontend sync queue for those operation types. Silent data loss is worse than a visible "not supported" error
3. For health: implement actual PostgreSQL `SELECT 1` check and Redis `PING`. Monitoring tools (Docker healthcheck, uptime services) depend on this being real
4. For `useBookDescriptions`: either implement the batch endpoint or remove the hook entirely so it does not confuse future developers

**Warning signs:**
- `grep -r "TODO\|FIXME\|STUB\|HACK" backend/app/` returns hits in router/service files (not just comments)
- Frontend sync queue grows without bound (check IndexedDB `syncQueue` table size)
- Health monitoring shows 100% uptime even during known outages

**Phase to address:**
Dead code cleanup phase -- pair with NLP remnant removal. Must be completed before UX polishing (so users do not encounter broken features that look intentional).

---

### Pitfall 3: Removing Dead NLP Code Breaks Working Config Validation

**What goes wrong:**
The NLP system was removed in Dec 2025, but `config.py` still has `SPACY_MODEL`, `NLTK_DATA_PATH`, `MULTI_NLP_MODE`, `CONSENSUS_THRESHOLD`, `SPACY_WEIGHT`, `NATASHA_WEIGHT`, `STANZA_WEIGHT` fields. Critically, there is a `validate_nlp_weights` Pydantic validator that sums the NLP weights and rejects the config if total is outside 0.5-10.0. If you naively delete the NLP fields without deleting the validator, the app crashes on startup. If you delete just the validator, you might miss other code that references these fields.

**Why it happens:**
Incremental deletion is dangerous when config has cross-field validators. The 14 root-level test files (`test_nlp_processors.py`, `test_gliner_integration.py`, etc.) also import from removed modules, which may cause import-time failures if test discovery touches them.

**How to avoid:**
1. Map the full dependency graph of NLP config fields BEFORE deleting anything: `config.py` fields -> validators -> `settings_manager.py` sections -> admin schemas -> admin frontend
2. Delete in one atomic PR: config fields + validators + settings_manager NLP sections + admin schemas + root test files
3. Run the full test suite after deletion, including `pytest --collect-only` to verify no import failures in test discovery
4. Check `settings_manager.py` for `nlp_global`, `nlp_spacy`, `nlp_natasha`, `nlp_stanza`, `nlp_gliner` config sections -- these expose NLP settings to the admin panel and will cause frontend errors if the admin panel tries to read/write them

**Warning signs:**
- `python -c "from app.core.config import settings"` fails after partial deletion
- Admin panel shows NLP configuration sections with no effect
- `pytest --collect-only` shows import errors in root-level test files

**Phase to address:**
Dead code cleanup phase -- do this as a single focused operation, not piecemeal across multiple PRs.

---

### Pitfall 4: Spoiler Leak Through Cache Poisoning

**What goes wrong:**
The entity spoiler-free system stores ALL entity data (including future spoilers) in Redis cache, then filters at response time based on the reader's current chapter. If the filtering logic in `entity_service.py` (`_apply_chapter_filter`, `_filter_entity_detail`) has a bug, future character deaths, plot twists, or relationship reveals leak to users who have not reached that chapter. This is a product-destroying bug for a spoiler-free reading app.

**Why it happens:**
Caching raw unfiltered data is a performance optimization that trades safety for speed. The filtering is a runtime operation that must be correct every time, for every entity type, across chapter boundaries. The test file `test_entity_spoiler_free.py` exists but may not cover all edge cases (e.g., entity relationships where one entity is revealed in chapter 5 but the relationship with another entity is not established until chapter 12).

**How to avoid:**
1. Write exhaustive property-based tests for spoiler filtering: generate random entity data with chapter assignments, query at each chapter, verify no future data leaks
2. Add a "spoiler canary" integration test: create a book with a known twist at chapter 10, read at chapter 5, assert the twist is not visible
3. Consider caching already-filtered data per chapter (trades cache size for safety), or at minimum add a post-filter assertion that no entity mention has a chapter number > current chapter
4. Treat ANY change to `entity_service.py` filtering as a high-risk change requiring the full spoiler test suite

**Warning signs:**
- Entity detail responses contain `chapter_first_mentioned` values greater than the requested chapter
- Users report seeing information about characters they have not met yet
- Entity relationship data references events from later chapters

**Phase to address:**
Entity Wiki quality phase -- must add comprehensive tests before making any changes to entity filtering logic.

---

### Pitfall 5: python-jose JWT Library Has Known Critical Vulnerability

**What goes wrong:**
The app uses `python-jose[cryptography]==3.5.0` for all JWT operations. CVE-2025-61152 allows JWT tokens with `alg=none` to be decoded and accepted without signature verification, meaning an attacker can forge arbitrary JWT tokens. The library is unmaintained and will not receive patches.

**Why it happens:**
python-jose was the FastAPI tutorial default for years. Migration seems low-priority because "auth works." But `alg=none` bypass means any attacker who knows the vulnerability can forge admin tokens.

**How to avoid:**
1. Replace `python-jose` with `PyJWT>=2.10.1` (actively maintained, API-compatible for HS256)
2. Migration is straightforward: change `from jose import JWTError, jwt` to `from jwt import PyJWTError as JWTError; import jwt`
3. Explicitly set `algorithms=["HS256"]` in all `jwt.decode()` calls to prevent algorithm confusion attacks
4. Pin PyJWT to `>=2.10.1` to include the fix for CVE-2025-45768
5. After migration, verify token blacklist behavior still works (`token_blacklist.py`)

**Warning signs:**
- `pip audit` or `safety check` flags python-jose
- Dependabot/Snyk alerts for the dependency
- Auth tests pass with `alg: "none"` tokens (should fail)

**Phase to address:**
Security hardening phase -- combine with other security fixes (DEBUG default, secrets, token expiry).

---

### Pitfall 6: Gemini Sync API in Async Context Creates Thread Pool Exhaustion

**What goes wrong:**
`gemini_extractor.py` calls the synchronous Gemini client via `asyncio.to_thread()`, and `asyncio.gather()` runs ALL chunks in parallel. For a large book with 20+ chunks, this fires 20+ simultaneous threads, each making a blocking Gemini API call. The default thread pool (40 threads, shared with FastAPI/Starlette) can be exhausted, blocking all HTTP request handling. At `CELERY_CONCURRENCY=1` this is masked; at concurrency >1, the app deadlocks.

**Why it happens:**
The Google `genai` Python client is synchronous. Wrapping it in `asyncio.to_thread` is the textbook solution, but without a bounded semaphore limiting concurrent calls, the unbounded `asyncio.gather()` can spawn more threads than the pool supports. The semaphore (`_semaphore`) exists in the code but its interaction with the thread pool size is undocumented.

**How to avoid:**
1. Document and enforce the semaphore value: set it to max 5 concurrent Gemini calls (well within both thread pool and API rate limits)
2. Consider using the async Gemini client (`google.genai.aio`) if available, eliminating the thread pool dependency entirely
3. If staying with `asyncio.to_thread`, create a dedicated `ThreadPoolExecutor` for Gemini calls (not the shared default) with explicit max workers
4. Add monitoring: log when semaphore wait time exceeds 30 seconds (indicates pool pressure)

**Warning signs:**
- Book processing hangs indefinitely for large books
- FastAPI stops responding to HTTP requests during book processing
- Thread count in process metrics spikes during processing
- Celery tasks hit the 3-hour soft time limit without completing

**Phase to address:**
AI pipeline stabilization phase -- must be fixed before considering `CELERY_CONCURRENCY > 1`.

---

### Pitfall 7: Chunk Boundary Entity Loss is Silent and Undetectable

**What goes wrong:**
When a book chapter exceeds 100K characters, it is split into chunks with 15% overlap. Entities mentioned only in the overlap zone or at the exact boundary may be extracted by one chunk but not the other, leading to duplicate or missing entities. The `ConsistencyManager` truncates entity lists over 300K chars instead of recursively reducing, silently dropping entities at the end of the list. For large books (500+ entities), this means the glossary is incomplete with no error or warning visible to users.

**Why it happens:**
Chunk boundaries are an inherent problem with any LLM-based extraction over long documents. The 15% overlap mitigates but does not solve it. The truncation in `ConsistencyManager` (line 581-585) is a TODO stub that was never replaced with proper recursive reduce. The entities dropped are whichever happen to be at the end of the serialized list -- effectively random.

**How to avoid:**
1. Implement recursive reduce: if entity list exceeds 300K chars, split into groups, reduce each group, then reduce the results. This is a standard map-reduce pattern
2. Add a post-extraction audit: count entities per chapter, flag chapters with suspiciously few entities compared to text length
3. Track entity extraction coverage: store chunk boundaries and overlap regions, verify entities from overlap zones appear in the merged result
4. Add a warning in the book's processing log when truncation occurs, visible to the admin panel

**Warning signs:**
- Log message "Too many entities for single Reduce pass. Truncating" appears in production logs
- Books with 50+ chapters have noticeably fewer entities per chapter in later chapters
- Users report missing characters from the glossary

**Phase to address:**
AI pipeline stabilization phase -- requires careful testing with real large books.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `asyncio.to_thread` for Gemini sync client | Quick integration without rewriting to async | Thread pool exhaustion at scale, deadlock risk | Only with bounded semaphore AND dedicated thread pool |
| Redis single instance for cache + broker + rate limiting + pub/sub | Simple deployment, one service to manage | Single point of failure -- Redis down = entire app degrades | Only at current scale (<100 concurrent users) |
| 7-day access token with no rotation | Users stay logged in for reading sessions | Stolen tokens valid for a week; no revocation mechanism | Never in production -- reduce to 30-60 minutes with proper refresh flow |
| `enabled: false` hooks as feature stubs | Compiles, does not break anything | Confuses developers, dead code in bundle, false feature impression | Only if clearly documented with `@deprecated` annotation |
| Admin Redis `from_url` with localhost fallback | Works in dev without config | Production admin endpoints may connect to wrong Redis or fail silently | Never -- always use `settings.REDIS_URL` from config |
| Inline localhost in CSP connect-src | WebSocket works in dev | CSP allows localhost connections in production (potential security issue) | Only behind `DEBUG` conditional |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gemini API | Not handling 429 rate limits with per-dimension awareness (RPM vs TPM vs RPD) | Implement exponential backoff that reads `Retry-After` header; track RPM and TPM separately; Google can change quotas without notice (happened Dec 2025) |
| Gemini API | Assuming response format is stable | Always unwrap potential `data` wrapper; validate response structure with Pydantic before processing; Gemini response format has changed between versions |
| Imagen 4 | Not handling content safety rejections | Imagen rejects prompts it deems unsafe; book descriptions of violence, intimacy, etc. will fail. Implement fallback (retry with sanitized prompt, or skip image) instead of crashing the task |
| Imagen 4 | Assuming image generation always succeeds | Base64 PNG detection fallback exists but is untested (test file is `_TEMPLATE.py`). Image generation can fail silently, leaving descriptions without illustrations |
| Redis | Creating new `from_url` connections per request instead of using the connection pool | Admin routes in `parsing.py` create fresh Redis connections with `redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))` instead of using `cache_manager`. This bypasses connection pooling and can leak connections |
| ebooklib | Assuming all EPUBs are well-formed | `ebooklib` has limited error handling for malformed EPUBs. Add ZIP magic byte validation (`PK\x03\x04`) before parsing, and wrap all ebooklib calls in try/except with informative error messages |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded `asyncio.gather()` for chunk processing | Process hangs, thread pool exhaustion | Cap semaphore at 5 concurrent calls | Books with >10 chunks (~1M+ chars) |
| Spoiler filtering on every request (no per-chapter cache) | Slow entity drawer loading | Cache filtered results keyed by `(book_id, chapter)` with invalidation on new extraction | Books with 500+ entities, frequent entity drawer opens |
| Single Celery worker, concurrency=1 | Book processing queue grows, hours-long waits | Priority queues, increase concurrency after thread pool fix | >5 concurrent book uploads |
| No IndexedDB cleanup | Browser storage grows unbounded, eventual quota exceeded | Implement LRU eviction for cached chapters/images based on last-read date | After user reads ~20+ books without clearing cache |
| Full entity list serialization for LLM dedup | Truncation at 300K chars, entity loss | Recursive map-reduce pattern | Books with >300 entities |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| `python-jose` with `alg=none` vulnerability (CVE-2025-61152) | Attacker forges admin JWT tokens, gains full system access | Replace with `PyJWT>=2.10.1`, explicitly set `algorithms=["HS256"]` |
| CSP `connect-src` includes `ws://localhost:*` in production | Allows malicious scripts to exfiltrate data to local services | Make localhost CSP entries conditional on `DEBUG` mode |
| CSP `script-src` has no nonce, but `unsafe-inline` is removed | Legitimate inline scripts break; OR CSP is silently ineffective | Implement per-request nonce generation, or verify zero inline scripts exist |
| File upload validates extension only, not magic bytes | Malicious files with `.epub` extension bypass validation | Add ZIP magic byte check (`PK\x03\x04`) for EPUB, XML check for FB2 |
| Access token valid for 7 days with no revocation on logout | Stolen tokens remain valid; logout is cosmetic | Reduce to 15-30 minutes; implement token blacklist check on every request |
| `METRICS_PASSWORD` not checked by production validator | Prometheus metrics endpoint accessible with default password | Add to `validate_production_settings()` alongside SECRET_KEY check |

## UX Pitfalls

Common user experience mistakes in this domain (EPUB reader + AI features).

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Fake health endpoint returning `"checking..."` | Users see "healthy" status when DB is down; no one investigates outages | Implement real PostgreSQL + Redis health checks; return HTTP 503 when unhealthy |
| Sync endpoint silently losing bookmarks | User creates bookmarks offline, goes online, bookmarks vanish with no error | Either implement sync or disable bookmark creation in offline mode with a clear message |
| Password reset emails pointing to localhost | User clicks reset link, gets "page not found" in browser | Use `PASSWORD_RESET_BASE_URL` from env, validate it does not contain localhost in production |
| Book processing queue with no user feedback | User uploads a book, sees spinning forever, does not know 3 books are ahead | Show queue position and estimated time; WebSocket exists but is a no-op stub, so enhance polling with queue depth info |
| Reprocess creates orphaned descriptions | User triggers reprocess expecting fresh results, sees old + new descriptions mixed | Delete old descriptions before reprocessing (code exists but is commented out in `books/crud.py` lines 741-743) |
| Fuzzy matching misses short Russian names | "Garri" and "Garri Potter" treated as different entities in the glossary | Lower `FUZZY_THRESHOLD` from 0.85 to ~0.75 for Russian text; add name-form normalization |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Health endpoint:** Returns "healthy" but does not check database -- verify `SELECT 1` runs against PostgreSQL
- [ ] **Sync endpoint:** Accepts requests but TODO-stubs all operations -- verify bookmarks/highlights actually persist
- [ ] **WebSocket service:** Frontend service exists but all methods return `Promise.resolve()` -- verify actual WS connection is established
- [ ] **Batch descriptions hook:** `useBookDescriptions` exists but is `enabled: false` -- verify it returns real data
- [ ] **Token blacklist on logout:** `token_blacklist.py` exists but verify it is actually called during logout flow
- [ ] **Email service:** `EMAIL_ENABLED=False` by default -- verify password reset emails actually send in production
- [ ] **CSP security headers:** `unsafe-inline` removed from `script-src` but no nonce system -- verify frontend does not use inline scripts
- [ ] **Reprocess flow:** Button exists but old descriptions are not deleted (commented out) -- verify clean reprocess
- [ ] **Image generation tests:** Test file exists as `_TEMPLATE.py` (never implemented) -- verify image generation error handling works
- [ ] **NLP admin panel:** Admin UI may show NLP config sections that do nothing -- verify no dead UI sections remain after cleanup
- [ ] **Production CORS:** Default is `localhost` origins only -- verify production `CORS_ORIGINS` env var includes `fancai.ru`

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Security defaults shipped to production | MEDIUM | Rotate SECRET_KEY (invalidates all JWTs, logs everyone out); change METRICS_PASSWORD; fix PASSWORD_RESET_BASE_URL; redeploy. Check logs for suspicious auth activity during exposure window |
| Spoiler data leaked to users | HIGH | Cannot un-spoil a reader. Add post-hoc filtering verification. If widespread, communicate transparently. The reputational damage is permanent for affected users |
| python-jose `alg=none` exploited | HIGH | Immediately replace with PyJWT; rotate SECRET_KEY; invalidate all tokens; audit all admin actions during exposure; check for unauthorized data access |
| Dead code removal breaks startup | LOW | Revert the PR; map dependencies more carefully; re-attempt with full dependency graph |
| Entity loss from chunk truncation | MEDIUM | Re-extract affected books with fixed reduce logic; notify users that their glossary has been updated |
| Thread pool exhaustion during processing | LOW | Restart Celery worker; reduce semaphore value; the system recovers automatically once threads free |
| Orphaned descriptions after reprocess | MEDIUM | Write a migration script to identify and delete orphaned descriptions; uncomment the deletion code |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Security defaults ship to production | Security Hardening (FIRST) | `pytest` with `DEBUG=False` passes; startup check rejects insecure defaults; `pip audit` clean |
| TODO stubs masquerading as features | Dead Code Cleanup | `grep -r "TODO\|FIXME" backend/app/routers/` returns zero hits in active endpoints; all endpoints return real data or HTTP 501 |
| NLP removal breaks config | Dead Code Cleanup | `python -c "from app.core.config import settings"` succeeds; `pytest --collect-only` has no import errors; admin panel shows no NLP sections |
| Spoiler leak through cache | Entity Wiki Quality | Property-based tests pass; spoiler canary integration test passes; no entity response contains future chapter data |
| python-jose vulnerability | Security Hardening | `pip audit` reports no critical vulnerabilities; auth tests verify `alg=none` tokens are rejected |
| Thread pool exhaustion | AI Pipeline Stabilization | Semaphore value documented and tested; book with 20+ chunks processes without hanging; FastAPI stays responsive during processing |
| Chunk boundary entity loss | AI Pipeline Stabilization | Recursive reduce implemented; no truncation warnings in logs for test corpus; entity count per chapter is consistent |
| Orphaned descriptions on reprocess | Bug Fixes | Reprocess test: old descriptions deleted, new descriptions present, no duplicates |
| Fuzzy matching misses short names | Entity Wiki Quality | Test with Russian name pairs at various similarity thresholds; "Garri"/"Garri Potter" recognized as same entity |
| Admin Redis connection leaks | Code Quality | All Redis usage goes through `cache_manager`; no `redis.from_url` calls in router code |
| CSP incomplete (no nonces, localhost in prod) | Security Hardening | CSP header inspection in production shows no localhost entries; inline script test verifies no breakage |

## Sources

- Codebase analysis: `backend/app/core/config.py`, `backend/app/routers/sync.py`, `backend/app/services/gemini_extractor.py`, `backend/app/services/consistency_manager.py`, `backend/app/services/entity_service.py`, `backend/app/middleware/security_headers.py` -- HIGH confidence (direct code inspection)
- [CVE-2025-61152: python-jose alg=none bypass](https://vulert.com/vuln-db/debian-12-python-jose-362548) -- HIGH confidence
- [PyJWT migration guide from python-jose](https://github.com/jpadilla/pyjwt/issues/942) -- HIGH confidence
- [Celery + asyncio event loop problem](https://medium.com/@termtrix/using-celery-with-fastapi-the-async-inside-tasks-event-loop-problem-and-how-endpoints-save-79e33676ade9) -- MEDIUM confidence
- [FastAPI security guide - debug mode risks](https://docs.securesauce.dev/rules/PY524) -- MEDIUM confidence
- [Gemini API rate limits and Dec 2025 quota changes](https://ai.google.dev/gemini-api/docs/rate-limits) -- HIGH confidence
- [Dead code removal best practices](https://axify.io/blog/dead-code) -- MEDIUM confidence
- `.planning/codebase/CONCERNS.md` -- HIGH confidence (project-specific audit)
- `.planning/codebase/ARCHITECTURE.md` -- HIGH confidence (project-specific analysis)

---
*Pitfalls research for: fancai production hardening*
*Researched: 2026-02-27*
