# Project Research Summary

**Project:** fancai — Production Hardening
**Domain:** AI-powered EPUB reader (React 19 PWA + FastAPI + Celery + Gemini/Imagen)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

fancai is a production-deployed AI book reader with two genuine competitive differentiators: a spoiler-free entity wiki (no major competitor has this) and AI-generated illustrations. The core architecture — React 19 PWA + FastAPI + Celery + PostgreSQL + Redis — is fundamentally sound and has been running in production for 5.5 months. The product is feature-rich, with 13 table-stakes reader features all implemented. The problem is not what was built, but how it was deployed: the app is running in development mode on a production server, with an abandoned JWT library containing a known CVE, a fake health check that returns "healthy" regardless of actual system state, and multiple stub endpoints that silently discard user data.

The recommended approach is surgical hardening in four phases rather than any architectural restructuring. The component boundaries are correct; the problems live within components. Security defaults must be fixed first (they are the highest-risk issues and have zero dependencies on other changes). Data integrity issues (orphaned descriptions, cache invalidation bugs) follow. Resilience patterns (circuit breakers, bounded thread pools) come third. Structural cleanup (dead NLP code, oversized router files) is last and can partially overlap with phase 3.

The two primary risks to manage are: (1) spoiler leaks from the entity filtering system — this is product-destroying if it occurs and needs exhaustive test coverage before any entity service changes; and (2) the python-jose CVE-2025-61152 allowing JWT forgery — this is an actively exploitable vulnerability that must be replaced before any other work. Both of these risks can be addressed in phase 1 without touching the feature surface at all.

## Key Findings

### Recommended Stack

The existing stack needs targeted replacements and activations, not additions. The monitoring infrastructure (Grafana + Prometheus + Loki + Sentry SDK) is already installed but not initialized. The production server is ASGI server (Gunicorn) is already in requirements but the Compose file uses `uvicorn --reload` instead.

**Core changes required:**
- **python-jose → PyJWT 2.11.0**: Replace the abandoned JWT library with a known CVE. Near-drop-in API replacement. This is the single highest-urgency change.
- **Sentry initialization (backend)**: `sentry-sdk[fastapi]==2.53.0` is installed but never initialized in `main.py`. Upgrade to 2.53.0 and add 5-line init block.
- **@sentry/react + @sentry/vite-plugin**: Not installed on frontend. React 19's `onCaughtError`/`onUncaughtError` hooks enable proper Sentry integration.
- **Gunicorn in production**: Already in requirements, but Compose uses `uvicorn --reload`. Switch to `gunicorn --worker-class uvicorn.workers.UvicornWorker` for process management and multi-core utilization.
- **flower 2.0.1**: Optional but useful — adds Celery monitoring UI and Prometheus metrics for queue depth alerting.
- **Keep as-is**: loguru, prometheus-fastapi-instrumentator, custom rate limiter, SecurityHeadersMiddleware, Grafana/Prometheus/Loki stack. These are correctly configured.

### Expected Features

fancai's core differentiators are fully implemented. The gap relative to competitors (Kindle, Kobo, Readest) is in annotating features — highlights and bookmarks — which have UI stubs but no backend implementation. These are table-stakes in 2026 and represent the most likely reason users would leave for a competing reader.

**Must have (table stakes — all DONE):**
- Reliable EPUB rendering, TOC navigation, progress tracking
- Font/theme customization (5 themes, 6 font families)
- Resume reading position with cross-device conflict resolution
- Offline reading via IndexedDB + service worker
- Mobile-responsive layout with swipe/tap navigation

**Must fix (table stakes — currently broken or missing):**
- Security defaults: `DEBUG=True`, forgeable `SECRET_KEY`, 7-day tokens, localhost password reset URL
- Real health check (current returns hardcoded "checking...")
- Bookmark/highlight sync (stub endpoint silently discards data)
- Book reprocess cleans up orphaned descriptions (code commented out)

**Should have (differentiators — DONE):**
- Spoiler-free entity wiki with chapter-based filtering (unique vs. all competitors)
- AI-generated illustrations with description highlighting (unique vs. all competitors)
- Entity relationships graph, event timeline, recap panel
- Reading statistics, streaks, achievements

**Should complete (differentiators — partial/stub):**
- Entity deduplication quality: lower fuzzy threshold 0.85 → 0.70-0.75 for Russian names
- In-text entity linking (tap character name → entity profile): not yet built
- WebSocket for book processing progress (currently polling with a no-op WS stub)

**Defer to v2+:**
- Bookmark/highlight sync full implementation (stubs become 501 Not Implemented for now)
- Payment/subscription system
- OAuth social login
- Text-to-speech, inline dictionary, multi-format beyond EPUB/FB2

### Architecture Approach

The architecture is a separated monolith: React PWA → Nginx → FastAPI → (PostgreSQL + Redis + Celery). It does not need restructuring. It needs hardening: closing the gap between "works in dev" and "reliable in production." Three cross-cutting data flow issues dominate: (1) Redis serves as cache, Celery broker, pub/sub, and rate limiter simultaneously — a single point of failure with no health monitoring for recovery detection; (2) the Gemini API is called via `asyncio.to_thread()` inside `asyncio.gather()` with up to 20+ concurrent chunks, risking thread pool exhaustion; (3) the frontend's `apiClient.get()` sends `Cache-Control: no-cache, no-store, must-revalidate` on every GET request, defeating all server-side HTTP caching.

**Major components and their gaps:**
1. **FastAPI backend** — `DEBUG=True` default, fake health check, dead NLP config fields with active validators, stub endpoints in `sync.py`, `uvicorn --reload` in production
2. **Celery worker** — uses raw lock acquire/release instead of `DistributedLock` context manager, `asyncio.to_thread()` without bounded executor for Gemini calls, dead `celery_config.py` that nobody imports
3. **Redis** — single instance for 4 purposes; `_is_available` flag set at startup never updated on recovery; admin routes in `parsing.py` create fresh `redis.from_url()` connections bypassing the pool
4. **Frontend** — blanket cache-busting headers on all GETs; WebSocket service is a no-op stub; stale Redis cache can show restricted spoiler data for newly-read chapters

### Critical Pitfalls

1. **python-jose CVE-2025-61152** — `alg=none` bypass allows forged JWT tokens including admin tokens. Replace with `PyJWT>=2.10.1`, explicitly set `algorithms=["HS256"]` in all decode calls, verify token blacklist still works. Do this first, before any other change.

2. **Security defaults ship to production undetected** — `DEBUG=True` default means the production validator never runs unless the env var is explicitly set. Flip to `DEBUG=False`; add `METRICS_PASSWORD` and `PASSWORD_RESET_BASE_URL` to validator; add startup rejection if password reset URL contains `localhost` in non-debug mode.

3. **Spoiler leak through cache** — entity filtering happens at read time on cached unfiltered data; one bug in `_apply_chapter_filter` or `_filter_entity_detail` leaks future plot data. This is reputationally unrecoverable. Write property-based + canary integration tests before touching any entity service code.

4. **Chunk boundary entity loss is silent** — `ConsistencyManager` truncates entity lists over 300K chars with no warning to users. Books with 500+ entities silently have incomplete glossaries. Implement recursive map-reduce for the reduce pass; add post-extraction audit logging.

5. **Thread pool exhaustion from unbounded Gemini calls** — `asyncio.gather()` on 20+ chunks via `asyncio.to_thread()` can exhaust the shared thread pool (max ~40 threads), blocking HTTP request handling. A semaphore exists but its value relative to thread pool size is undocumented. Cap at 5 concurrent Gemini calls with a dedicated `ThreadPoolExecutor`.

6. **NLP code removal breaks config validation** — `validate_nlp_weights` Pydantic validator references the NLP config fields being deleted. Deleting fields without deleting the validator crashes the app at startup. Map the full dependency graph (config → validators → settings_manager → admin schemas → frontend) before touching anything.

## Implications for Roadmap

Based on combined research, a 4-phase structure is recommended. Each phase has hard dependencies on the previous phase being complete; they cannot be safely parallelized.

### Phase 1: Security and Safety Net
**Rationale:** Security vulnerabilities (active CVE, debug defaults, forged tokens) must be fixed before any other production deployment work. These changes have zero feature dependencies and high impact. Health checks are a prerequisite for monitoring changes in all subsequent phases.
**Delivers:** An app that is safe to run in production — no exploitable vulnerabilities, real monitoring, development mode turned off.
**Addresses:** Security defaults (DEBUG, SECRET_KEY, token expiry, password reset URL), python-jose CVE, fake health check, Gunicorn production mode, Sentry initialization.
**Avoids:** JWT forgery, debug mode information leakage, monitoring blindness, undetected service failures.
**Research flag:** Standard patterns. No deeper research needed — all changes are documented and specific.

### Phase 2: Data Integrity and Dead Code Cleanup
**Rationale:** Once production is safe, fix the correctness bugs that silently corrupt user data and confuse the codebase. Stale caches, orphaned descriptions, and silent stub failures are user-trust issues. NLP removal must be a single atomic operation to avoid breaking config validation.
**Delivers:** A codebase where every endpoint does what it says, cached data is correct, and there is no dead code triggering false mental models.
**Addresses:** Orphaned descriptions on reprocess, cache invalidation on entity/description writes, blanket cache-busting headers in frontend, stub endpoint resolution (501 Not Implemented), dead NLP config + validators + celery_config.py removal.
**Avoids:** Silent data loss, spoiler cache stale data, developer confusion from dead code that looks active.
**Research flag:** Standard patterns. Cache invalidation and dead code removal are well-understood; no research needed.

### Phase 3: Resilience and AI Pipeline Stabilization
**Rationale:** With data integrity solid, the focus shifts to preventing operational failures from cascading. The Gemini thread pool issue blocks increasing Celery concurrency. Circuit breakers prevent single API failures from blocking entire books. Redis recovery detection prevents phantom failures.
**Delivers:** An AI pipeline that degrades gracefully under API failures, processes large books without hanging, and recovers automatically from transient failures.
**Addresses:** Circuit breaker for Gemini/Imagen (aiobreaker), bounded semaphore for chunk processing (max 5 concurrent), Redis `_is_available` health monitoring for recovery, admin Redis connection pool fix, DistributedLock context manager in book tasks.
**Avoids:** Thread pool exhaustion on large books, cascading failures when Google APIs are degraded, Redis connection leaks from admin routes.
**Research flag:** Circuit breaker integration with Celery needs targeted testing. The `aiobreaker` async-in-Celery combination has limited documentation.

### Phase 4: Entity Wiki Quality and Reader Polish
**Rationale:** The core differentiator must be both reliable and complete. Spoiler-free filtering needs exhaustive test coverage before any changes. Entity deduplication quality directly affects user trust in the glossary. Polish items (bookmarks as 501, in-text entity linking, empty states) round out the product.
**Delivers:** A glossary that is provably spoiler-free (via property-based tests), more complete for Russian text (lower fuzzy threshold), and visually polished for edge cases.
**Addresses:** Spoiler filtering test coverage (property-based + canary integration tests), fuzzy threshold lowering for Russian names (0.85 → 0.70-0.75), chunk boundary recursive reduce, bookmark/highlight stub-to-501 conversion, Sentry frontend installation.
**Avoids:** Spoiler leaks from untested edge cases, entity deduplication misses for short Russian names, 300K char truncation silently dropping entities.
**Research flag:** Property-based testing for the spoiler system (Hypothesis library) may need research. Recursive map-reduce implementation for `ConsistencyManager` is a targeted algorithm problem with clear solution.

### Phase Ordering Rationale

- Security defaults must be first: they are the only zero-dependency changes with critical-severity risk.
- Dead code cleanup must follow security: the NLP validator removal is risky and should happen after security is stable, not during it.
- Resilience must follow data integrity: circuit breakers serve stale data during circuit-open states; the cache must be correct before adding resilience patterns that can bypass it.
- Entity wiki quality last: requires exhaustive tests before changes, and those tests require a stable, correct data layer (phases 1-3).

### Research Flags

**Needs targeted research during planning:**
- **Phase 3:** `aiobreaker` behavior inside Celery workers (async event loop interaction). Limited production documentation.
- **Phase 4:** Hypothesis property-based testing for entity spoiler filtering — library setup and test design patterns.

**Standard patterns (skip deeper research):**
- **Phase 1:** All changes are well-documented in official FastAPI, Sentry, and PyJWT docs.
- **Phase 2:** Cache invalidation, dead code removal, stub-to-501 conversion — all established patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version recommendations verified via official PyPI/npm. Existing stack audited directly from codebase. |
| Features | HIGH | Competitive analysis based on official Kindle, Kobo, Readest, ReadEra documentation. Existing feature status verified via codebase audit. |
| Architecture | HIGH | Based on direct codebase analysis of all layers. Component gaps verified by reading source files, not inferred. |
| Pitfalls | HIGH | CVEs verified via vulert/NVD. Configuration bugs verified by reading `config.py` directly. Code patterns (thread pool, cache invalidation) verified by reading source. |

**Overall confidence:** HIGH

### Gaps to Address

- **Celery + aiobreaker async interaction:** The `aiobreaker` library supports async, but Celery tasks run their own event loop. Whether `@gemini_breaker` decorator works correctly inside a Celery task context needs a targeted proof-of-concept before committing to it in Phase 3.
- **Hypothesis test design for spoiler filtering:** The shape of property-based tests for the spoiler system is not pre-researched. Phase 4 planning should include a session to design the test corpus and property invariants before implementation.
- **TanStack Query staleTime values:** The specific values recommended (chapters: Infinity, entities: 30s, book list: 5s) are reasonable starting points but should be validated against actual user interaction patterns in production monitoring after Phase 2 deploys.

## Sources

### Primary (HIGH confidence)
- [Sentry FastAPI docs](https://docs.sentry.io/platforms/python/integrations/fastapi/) — backend Sentry initialization patterns
- [Sentry React docs](https://docs.sentry.io/platforms/javascript/guides/react/) — React 19 error hooks
- [FastAPI JWT tutorial (PyJWT)](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — official PyJWT recommendation
- [PyPI PyJWT 2.11.0](https://pypi.org/project/PyJWT/) — version confirmed 2026-01-30
- [PyPI sentry-sdk 2.53.0](https://pypi.org/project/sentry-sdk/) — version confirmed 2026-02-16
- [FastAPI Server Workers docs](https://fastapi.tiangolo.com/deployment/server-workers/) — Gunicorn + UvicornWorker pattern
- [CVE-2025-61152: python-jose alg=none bypass](https://vulert.com/vuln-db/debian-12-python-jose-362548) — vulnerability confirmed
- [PyPI aiobreaker](https://pypi.org/project/aiobreaker/) — circuit breaker async support
- [TanStack Query invalidation docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) — cache invalidation patterns
- `.planning/codebase/ARCHITECTURE.md` — existing architecture map (project-specific)
- `.planning/codebase/CONCERNS.md` — known issues catalog (project-specific)

### Secondary (MEDIUM confidence)
- [FastAPI production best practices (Render)](https://render.com/articles/fastapi-production-deployment-best-practices) — deployment patterns
- [Celery task resilience (GitGuardian)](https://blog.gitguardian.com/celery-tasks-retries-errors/) — task reliability patterns
- [Circuit breaker in FastAPI (Stackademic)](https://blog.stackademic.com/system-design-1-implementing-the-circuit-breaker-pattern-in-fastapi-e96e8864f342) — integration example
- [Skeleton screen best practices (NN/G)](https://www.nngroup.com/articles/skeleton-screens/) — UX loading patterns
- [PyPI flower 2.0.1](https://pypi.org/project/flower/) — Celery monitoring (maintenance pace is slow)

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
