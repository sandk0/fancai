# Architecture Patterns: Production Hardening

**Domain:** AI-powered fiction reader (FastAPI + React SPA + Celery + PostgreSQL + Redis)
**Researched:** 2026-02-27
**Mode:** Production hardening of existing architecture

## Current Architecture Assessment

The application is a separated monolith: React 19 PWA frontend communicating via REST API with a FastAPI async backend, Celery for heavy background processing, PostgreSQL for persistence, and Redis serving triple duty as cache, Celery broker, and pub/sub channel. The architecture is fundamentally sound but has accumulated dev-mode defaults, dead code, stub endpoints, and missing production safeguards through 5.5 months of rapid feature development.

**Confidence:** HIGH -- based on direct codebase analysis of all layers.

## Recommended Architecture Changes

The existing architecture does not need restructuring. It needs hardening: fixing the gaps between "works in dev" and "reliable in production." The component boundaries are correct; the problems are within components, not between them.

### Component Boundaries (Current)

| Component | Responsibility | Communicates With | Production Gap |
|-----------|---------------|-------------------|----------------|
| **Nginx** | TLS termination, static files, reverse proxy | Frontend (static), Backend (proxy), Storage (file serving) | Healthy -- resource limits set, health checks configured |
| **Frontend (React PWA)** | UI rendering, offline support, client state | Backend API (Axios/TanStack Query), IndexedDB (offline cache) | Stale cache risk, no error tracking service, WebSocket stub |
| **Backend (FastAPI)** | REST API, auth, business logic orchestration | PostgreSQL (async ORM), Redis (cache), Celery (task dispatch) | Fake health check, DEBUG=True default, dead NLP config, stub endpoints |
| **Celery Worker** | Book processing, image generation, cleanup | PostgreSQL (direct), Redis (broker + locks), Gemini/Imagen APIs | Single concurrency, NLP config remnants, unbounded API parallelism |
| **Celery Beat** | Periodic task scheduling | Redis (broker) | Healthy -- schedules are reasonable |
| **PostgreSQL** | Data persistence | Backend, Celery Worker | Healthy -- tuned for 8GB, connection pool configured |
| **Redis** | Cache, broker, pub/sub, distributed locks | All backend services | Single point of failure -- serves cache, broker, and pub/sub simultaneously |
| **Gemini API** | Text extraction (entities + descriptions) | Celery Worker (via gemini_extractor.py) | No circuit breaker, unbounded parallel chunk calls, sync-in-async thread pool |
| **Imagen API** | Image generation | Celery Worker (via imagen_generator.py) | No circuit breaker, sync-in-async pattern |

### Data Flow (Production-Relevant Paths)

**Happy path -- user reads a book:**
```
Browser -> Nginx -> Frontend (static) -> API call
  -> Nginx (proxy) -> FastAPI -> PostgreSQL (chapter data)
  -> Redis (cache check) -> Response
  -> Frontend -> TanStack Query cache -> Render
```

**Heavy path -- book processing:**
```
Upload -> FastAPI -> Save file + DB record -> Celery task dispatch
  -> Redis broker -> Celery Worker picks up
  -> Worker: parse chapters -> for each chapter:
    -> Gemini API (100K chunks, 15% overlap) -> entities + descriptions
    -> PostgreSQL (save results)
    -> Redis pub/sub (progress update)
  -> Frontend polls or listens for completion
```

**Failure cascade risk (current):**
```
Redis down -> cache unavailable AND Celery broker dead AND pub/sub dead
  -> rate limiter disabled, new tasks can't queue, progress updates lost
  -> but API still serves from PostgreSQL (graceful degradation exists)
```

## Patterns to Follow

### Pattern 1: Real Health Checks with Dependency Probing

**What:** Replace the fake `"database": "checking..."` health endpoint with actual async probes of PostgreSQL, Redis, and Celery.

**When:** Immediately -- this is the foundation of production monitoring.

**Confidence:** HIGH -- standard FastAPI pattern, verified in official docs and multiple production guides.

**Example:**
```python
# backend/app/routers/health.py
import asyncio
from sqlalchemy import text

async def check_database(db: AsyncSession) -> dict:
    try:
        result = await asyncio.wait_for(
            db.execute(text("SELECT 1")),
            timeout=5.0
        )
        return {"status": "ok", "latency_ms": measured_latency}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

async def check_redis() -> dict:
    try:
        start = time.monotonic()
        await asyncio.wait_for(cache_manager._redis.ping(), timeout=5.0)
        latency = (time.monotonic() - start) * 1000
        return {"status": "ok", "latency_ms": round(latency, 2)}
    except Exception:
        return {"status": "error"}

@router.get("/health")
async def health(db: AsyncSession = Depends(get_database_session)):
    db_check, redis_check = await asyncio.gather(
        check_database(db),
        check_redis(),
        return_exceptions=True
    )
    overall = "healthy" if all checks pass else "degraded"
    return {"status": overall, "checks": {"database": db_check, "redis": redis_check}}
```

**Sources:**
- [FastAPI Health Check Best Practices](https://www.index.dev/blog/how-to-implement-health-check-in-python) (MEDIUM confidence)
- [FastAPI Production Deployment](https://render.com/articles/fastapi-production-deployment-best-practices) (MEDIUM confidence)

---

### Pattern 2: Security Defaults Inversion

**What:** Flip `DEBUG: bool = True` to `DEBUG: bool = False`. Change `SECRET_KEY` default to raise on startup if not overridden. Remove dead NLP config fields and their validators.

**When:** Before any public-facing deployment. This is the single highest-risk production gap.

**Confidence:** HIGH -- this is the codebase itself; the defaults are visible in `config.py` lines 19-22.

**Implementation notes:**
- `SECRET_KEY` should use `os.urandom(32).hex()` as fallback for dev, but fail loudly in non-DEBUG mode (existing validator already does this -- just flip the default)
- Remove `validate_nlp_weights()` validator entirely -- it validates weights for a system that no longer exists
- Remove all NLP config fields: `SPACY_MODEL`, `NLTK_DATA_PATH`, `MULTI_NLP_MODE`, `CONSENSUS_THRESHOLD`, `SPACY_WEIGHT`, `NATASHA_WEIGHT`, `STANZA_WEIGHT`
- Add `METRICS_PASSWORD` to production secrets validation

---

### Pattern 3: Cache Invalidation Discipline

**What:** The frontend already has a well-structured `queryKeys.ts` with user-scoped keys and `queryKeyUtils` for coordinated invalidation. The problem is that the *backend* Redis cache uses manual key patterns without consistent invalidation on writes. The `cache_result` decorator caches function results but the `invalidate_cache` decorator is defined but underused.

**When:** During the data layer hardening phase.

**Confidence:** HIGH -- verified by reading both `cache.py` and `queryKeys.ts` directly.

**The actual problems:**
1. Backend caches entity network data including future spoilers; filtering happens on read. If the cache TTL (3600s) outlasts a reading session where a user advances chapters, they get stale spoiler-free data that is *too restrictive* (not showing entities from newly-read chapters).
2. The `CACHE_TTL["book_list"]` is 10 seconds, which is fine, but `CACHE_TTL["book_descriptions"]` is 3600 seconds. After a reprocess (which currently does NOT delete old descriptions -- commented out code in `crud.py:741-743`), stale descriptions persist in both the DB and cache for up to an hour.
3. Frontend `apiClient.get()` adds `Cache-Control: no-cache, no-store, must-revalidate` to *every* GET request, completely bypassing browser-level HTTP caching. This is a dev-mode safety blanket that hurts production performance.

**Fix approach:**
- Backend: Invalidate Redis cache on entity/description writes, not just reads. Use the existing `invalidate_cache` decorator on mutation paths.
- Backend: Fix the reprocess endpoint to actually delete old descriptions before re-extraction.
- Frontend: Remove blanket no-cache headers from `apiClient.get()`. Let the backend `CacheControlMiddleware` and TanStack Query `staleTime` handle caching properly.
- Frontend: Set appropriate `staleTime` values per query type (chapters: Infinity since content is immutable, entities: 30s since they change as user reads, book list: 5s since uploads/deletes are infrequent).

---

### Pattern 4: Circuit Breaker for External API Calls

**What:** Wrap Gemini and Imagen API calls in a circuit breaker pattern to prevent cascading failures when Google APIs are degraded. Currently, the retry decorators (`retry_llm_extraction`, `retry_image_generation`) will retry failed calls with backoff, but if the API is down for an extended period, every chapter extraction will block for up to 30 seconds of retries before failing -- multiplied by every chunk.

**When:** During the external service resilience phase.

**Confidence:** MEDIUM -- circuit breaker for async Python is well-documented, but specific integration with Celery tasks needs testing. The `aiobreaker` library supports async natively.

**Example:**
```python
from aiobreaker import CircuitBreaker

gemini_breaker = CircuitBreaker(
    fail_max=5,          # Open after 5 failures
    timeout_duration=60  # Stay open for 60 seconds before half-open
)

@gemini_breaker
@retry_llm_extraction
async def extract_with_gemini(self, chunk: str, config: GeminiConfig) -> dict:
    # existing extraction logic
    ...
```

**Sources:**
- [Circuit Breaker Pattern in FastAPI](https://blog.stackademic.com/system-design-1-implementing-the-circuit-breaker-pattern-in-fastapi-e96e8864f342) (MEDIUM confidence)
- [aiobreaker PyPI](https://pypi.org/project/aiobreaker/) (HIGH confidence -- official package docs)

---

### Pattern 5: Stub Endpoint Resolution

**What:** Replace TODO stub endpoints with either real implementations or explicit 501 Not Implemented responses with documentation. Current stubs silently fail or return misleading data.

**When:** During the dead code cleanup phase, before feature hardening.

**Confidence:** HIGH -- stubs identified directly in codebase analysis.

**Specific stubs to resolve:**
| Endpoint | Current Behavior | Resolution |
|----------|-----------------|------------|
| `POST /sync/batch` (bookmarks, highlights) | Accepts request, returns failure for each op | Remove bookmark/highlight ops; keep reading session sync which works |
| `GET /books/{id}/descriptions/batch` | Frontend hook permanently disabled (`enabled: false`) | Either implement or remove the hook entirely |
| `GET /health` DB check | Returns `"checking..."` string | Implement real DB probe (Pattern 1) |
| WebSocket service (frontend) | All methods return `Promise.resolve()` | Keep as polling-first with WebSocket as progressive enhancement; document that WS is not functional |

---

### Pattern 6: Celery Task Idempotency and Lock Safety

**What:** The existing distributed lock pattern in `book_tasks.py` is good but has a gap: if a worker crashes between acquiring a lock and the `finally` block, the lock TTL (from Redis `SET NX EX`) is the only protection. The `DistributedLock` context manager in `cache.py` has auto-renewal but is not used by book tasks.

**When:** During the task reliability phase.

**Confidence:** HIGH -- verified by reading both `book_tasks.py` and `cache.py`.

**Improvements:**
1. Use the `DistributedLock` context manager (which has auto-renewal) instead of raw `acquire_lock`/`release_lock` calls in book tasks.
2. Add Celery config: `task_acks_late=True` + `task_reject_on_worker_lost=True` are already set -- good. Verify `worker_prefetch_multiplier=1` is set in production Docker Compose (it is in `celery_app.py` but Docker Compose overrides may differ).
3. Book processing should be idempotent: if restarted, it should detect partially-processed state and resume, not duplicate. Currently, the `is_processing` flag on the Book model serves this purpose but there is no chapter-level resume.

**Sources:**
- [Celery Task Resilience](https://blog.gitguardian.com/celery-tasks-retries-errors/) (MEDIUM confidence)
- [Celery Redis Production Guide](https://medium.com/@dewasheesh.rana/celery-redis-fastapi-the-ultimate-2025-production-guide-broker-vs-backend-explained-5b84ef508fa7) (LOW confidence -- single source)

## Anti-Patterns to Avoid

### Anti-Pattern 1: Sync-in-Async Thread Pool Exhaustion
**What:** `gemini_extractor.py` and `imagen_generator.py` use `asyncio.to_thread()` to call synchronous Google API clients from async Celery tasks. Each thread pool slot is a blocking OS thread.
**Why bad:** With unbounded parallel chunk processing via `asyncio.gather()` on 20+ chunks, the default thread pool (max_workers = min(32, os.cpu_count() + 4) = ~8) can be exhausted. Additional chunks block waiting for threads while holding async event loop time.
**Instead:** Either (a) use the async Google GenAI client if available, or (b) bound the concurrency with `asyncio.Semaphore(4)` explicitly applied to the `asyncio.gather()` call, or (c) process chunks sequentially in Celery (since it's already a background task, latency is acceptable).
**Confidence:** HIGH -- visible in `gemini_extractor.py` lines 633-637 and 747-753.

### Anti-Pattern 2: Blanket Cache-Busting on All API GETs
**What:** `apiClient.get()` adds `Cache-Control: no-cache, no-store, must-revalidate` headers to every single GET request.
**Why bad:** Defeats browser HTTP caching entirely, forces the backend to serve every request from scratch, and negates the work done in `CacheControlMiddleware`. For immutable data like chapter content, this means unnecessary network round trips.
**Instead:** Remove the blanket headers. Use TanStack Query's `staleTime` and `gcTime` for client-side caching. Let the backend's `CacheControlMiddleware` set appropriate `Cache-Control` headers per response type.
**Confidence:** HIGH -- visible in `client.ts` lines 192-201.

### Anti-Pattern 3: Global Singleton CacheManager Without Connection Health Monitoring
**What:** `cache_manager` is a global singleton initialized at startup. If Redis becomes unavailable after startup, `_is_available` stays `True` (set during initialization) and every operation silently fails in the `except` clauses with a log warning.
**Why bad:** There is no mechanism to detect Redis recovery. Once Redis goes down and comes back, the app continues treating it as available but failing, logging warnings on every cache operation.
**Instead:** Add a periodic health check (every 30s) that updates `_is_available` based on `PING` response. Or check on each operation failure and attempt reconnection.
**Confidence:** HIGH -- verified in `cache.py` lines 97-135 and 188-204.

### Anti-Pattern 4: Two Competing Celery Configurations
**What:** Both `celery_app.py` and `celery_config.py` define Celery configurations. `celery_app.py` is the one actually used (imported by tasks). `celery_config.py` defines a `ResourceAwareCelery` class, different queue definitions, and NLP-era settings that are never imported anywhere.
**Why bad:** Developers may edit the wrong config file. The NLP cache config, resource limits, and `create_celery_app()` factory in `celery_config.py` are completely dead code.
**Instead:** Delete `celery_config.py` entirely. Move any useful patterns (like the `task_prerun` resource check) into `celery_app.py` if desired.
**Confidence:** HIGH -- verified by grep that no file imports from `celery_config.py`.

## Scalability Considerations

| Concern | Current (production: 8GB/4CPU) | At 100 concurrent users | At 1K concurrent users |
|---------|-------------------------------|------------------------|----------------------|
| **API response time** | <50ms cached, ~200ms uncached | Same (PostgreSQL pool handles 60 connections) | Need PgBouncer; consider read replicas |
| **Book processing queue** | 1 concurrent task, ~30min per book | Queue depth grows; users wait hours | Multiple Celery workers on separate machines |
| **Redis single instance** | 640MB max, serves all purposes | Fine -- 640MB is plenty for cache + broker | Split into 2 instances: cache vs broker |
| **Gemini API rate limits** | Unbounded parallel calls per chunk | Risk hitting rate limits during bursts | Semaphore + circuit breaker mandatory |
| **Image storage** | Local filesystem (`/app/storage`) | Works with Docker volume | Need S3/object storage |
| **WebSocket connections** | Not functional (polling fallback) | Polling at 100 users = 100 requests/interval | WebSocket becomes necessary to reduce polling load |

## Build Order for Production Hardening

Based on dependency analysis of the components above, the recommended build order is:

### Phase 1: Safety Net (no behavioral changes, just protection)
1. Fix `DEBUG=False` default and security defaults inversion
2. Implement real health checks (database + Redis probes)
3. Delete dead code: `celery_config.py`, NLP config fields, NLP test files, NLP settings manager sections
- **Rationale:** These changes protect production without altering any feature behavior. Health checks are prerequisite for monitoring. Dead code removal reduces cognitive load for all subsequent work.

### Phase 2: Data Integrity (fix correctness bugs)
4. Fix reprocess endpoint to delete old descriptions before re-extraction
5. Fix cache invalidation on entity/description writes
6. Remove blanket cache-busting headers from frontend API client
7. Configure TanStack Query `staleTime` values per data type
- **Rationale:** These changes fix data correctness issues (stale cache, orphaned descriptions) that directly affect user trust. Depends on Phase 1 because monitoring needs to be in place before changing caching behavior.

### Phase 3: Resilience (prevent cascading failures)
8. Add circuit breaker for Gemini/Imagen API calls
9. Bound parallel chunk processing with explicit semaphore
10. Fix Redis `_is_available` health monitoring for connection recovery
11. Resolve stub endpoints (remove or implement)
- **Rationale:** These changes prevent operational failures from cascading. Depends on Phase 2 because cache correctness must be solid before adding resilience patterns that may serve stale data during circuit-open states.

### Phase 4: Structural Cleanup (reduce maintenance burden)
12. Split oversized router files (`images.py`, `reading_sessions.py`)
13. Migrate `python-jose` to `PyJWT`
14. Use `DistributedLock` context manager in book tasks
- **Rationale:** These are non-urgent improvements that reduce future maintenance cost. Placed last because they don't affect production stability directly and carry higher risk of regression.

**Dependency chain:**
```
Phase 1 (Safety) -> Phase 2 (Data Integrity) -> Phase 3 (Resilience) -> Phase 4 (Cleanup)
                                                                              |
Security defaults are prerequisite for everything                    Can be parallelized
Health checks enable monitoring changes in Phase 2+                  with Phase 3 work
```

## Sources

- Codebase analysis: `backend/app/main.py`, `core/config.py`, `core/cache.py`, `core/celery_app.py`, `core/celery_config.py`, `core/retry.py`, `core/exceptions.py`, `frontend/src/api/client.ts`, `frontend/src/hooks/api/queryKeys.ts`, `docker-compose.lite.prod.yml`
- [FastAPI Production Best Practices (Render)](https://render.com/articles/fastapi-production-deployment-best-practices) (MEDIUM confidence)
- [FastAPI Best Practices 2026 (FastLaunchAPI)](https://fastlaunchapi.dev/blog/fastapi-best-practices-production-2026) (MEDIUM confidence)
- [zhanymkanov/fastapi-best-practices (GitHub)](https://github.com/zhanymkanov/fastapi-best-practices) (MEDIUM confidence)
- [TanStack Query Cache Invalidation (official docs)](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) (HIGH confidence)
- [Celery Task Resilience (GitGuardian)](https://blog.gitguardian.com/celery-tasks-retries-errors/) (MEDIUM confidence)
- [Circuit Breaker in FastAPI (Stackademic)](https://blog.stackademic.com/system-design-1-implementing-the-circuit-breaker-pattern-in-fastapi-e96e8864f342) (MEDIUM confidence)
- [FastAPI Health Check Implementation (Index.dev)](https://www.index.dev/blog/how-to-implement-health-check-in-python) (MEDIUM confidence)
- [aiobreaker (PyPI)](https://pypi.org/project/aiobreaker/) (HIGH confidence)
- `.planning/codebase/ARCHITECTURE.md` -- existing architecture map (HIGH confidence)
- `.planning/codebase/CONCERNS.md` -- known issues catalog (HIGH confidence)

---

*Architecture research: 2026-02-27*
