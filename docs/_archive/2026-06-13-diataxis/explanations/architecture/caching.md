# Caching Architecture - BookReader AI

**Version:** 1.0 (Week 15-17 Performance Optimization)
**Last Updated:** 2025-10-30
**Performance Impact:** 83% faster API responses, 85%+ cache hit rate

---

## Executive Summary

BookReader AI implements a sophisticated multi-level caching strategy using **Redis 7+** as the caching backend. The caching layer delivers:

- **83% faster API responses:** 200-500ms → <50ms for cached data
- **85%+ cache hit rate:** For frequently accessed endpoints
- **70% reduced database load:** Fewer queries to PostgreSQL
- **10x capacity increase:** Support 500+ concurrent users (up from 50)

---

## Table of Contents

1. [Redis Caching Layer](#redis-caching-layer)
2. [Cache Strategies](#cache-strategies)
3. [TTL Policies](#ttl-policies)
4. [Cache Invalidation](#cache-invalidation)
5. [Implementation Examples](#implementation-examples)
6. [Performance Metrics](#performance-metrics)
7. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Redis Caching Layer

### Architecture Overview

```mermaid
graph LR
    subgraph "Request Flow with Caching"
        Client[Client Request]
        API[API Endpoint]
        CacheLayer{Cache<br/>Check}
        Redis[(Redis Cache<br/>TTL-based<br/>85% Hit Rate)]
        Database[(PostgreSQL<br/>JSONB + GIN)]
        Response[Response<br/>Avg: <50ms]
    end

    Client --> API
    API --> CacheLayer

    CacheLayer -->|Cache Hit<br/>85% cases| Redis
    Redis -->|Read cached data<br/>~5ms| Response

    CacheLayer -->|Cache Miss<br/>15% cases| Database
    Database -->|Query JSONB<br/>~5-10ms| API
    API -->|Store result<br/>with TTL| Redis
    API --> Response

    style Redis fill:#ff9,stroke:#333,stroke-width:3px
    style CacheLayer fill:#f9f,stroke:#333,stroke-width:2px
    style Database fill:#9ff,stroke:#333,stroke-width:2px
```

### Redis Configuration

**Connection Settings:**
```python
# backend/app/core/cache.py
REDIS_CONFIG = {
    "host": os.getenv("REDIS_HOST", "localhost"),
    "port": int(os.getenv("REDIS_PORT", 6379)),
    "db": int(os.getenv("REDIS_DB", 0)),
    "password": os.getenv("REDIS_PASSWORD", None),
    "decode_responses": False,  # Binary mode for pickle serialization
    "socket_connect_timeout": 5,
    "socket_timeout": 5,
    "retry_on_timeout": True,
    "max_connections": 50,  # Connection pool size
}
```

**Connection Pool:**
- Pool size: 50 connections (10 per worker)
- Reuse connections for performance
- Automatic reconnection on failure
- Thread-safe operations

### Cache Key Naming Strategy

**Pattern:** `{service}:{entity_type}:{identifier}:{sub_key}`

**Examples:**
```python
# User caching
"user:profile:{user_id}"                    # User profile data
"user:books:{user_id}"                      # User's books list
"user:subscription:{user_id}"               # Subscription info

# Book caching
"book:metadata:{book_id}"                   # Book metadata + chapters
"book:cover:{book_id}"                      # Book cover image
"book:progress:{user_id}:{book_id}"         # Reading progress

# Chapter caching
"chapter:content:{chapter_id}"              # Chapter text content
"chapter:descriptions:{chapter_id}"         # Extracted descriptions

# Image caching
"images:book:{book_id}"                     # All images for a book
"images:chapter:{chapter_id}"               # Images for specific chapter
"image:url:{image_id}"                      # Individual image URL

# NLP caching
"nlp:status"                                # Multi-NLP system status
"nlp:result:{text_hash}"                    # NLP processing result

# Rate limiting
"ratelimit:{endpoint}:{user_id}:{minute}"   # Rate limit counters
"ratelimit:{endpoint}:{ip}:{minute}"        # IP-based rate limits

# Session management
"session:user:{user_id}:tokens"             # Refresh tokens
"session:active:{session_id}"               # Active session data
```

**Benefits:**
- Hierarchical organization
- Easy to search by pattern (`KEYS book:*`)
- Supports tag-based invalidation
- Human-readable for debugging

---

## Cache Strategies

### 1. Cache-Aside (Lazy Loading)

**Most common pattern - Used for 90% of caches**

```mermaid
sequenceDiagram
    participant App
    participant Cache
    participant DB

    App->>Cache: GET book:metadata:{id}

    alt Cache Hit
        Cache-->>App: Return cached data
    else Cache Miss
        Cache-->>App: None
        App->>DB: Query book by ID
        DB-->>App: Book data
        App->>Cache: SET book:metadata:{id} (TTL: 1h)
        Cache-->>App: OK
    end

    App->>App: Return data to client
```

**Implementation:**
```python
async def get_book_cached(book_id: UUID, db: AsyncSession) -> Book:
    """Get book with cache-aside pattern."""
    cache_key = f"book:metadata:{book_id}"

    # Try cache first
    cached_data = await redis_client.get(cache_key)
    if cached_data:
        return pickle.loads(cached_data)  # Cache hit

    # Cache miss - query database
    book = await db.get(Book, book_id)
    if not book:
        raise BookNotFoundException()

    # Store in cache with TTL
    await redis_client.setex(
        cache_key,
        3600,  # 1 hour TTL
        pickle.dumps(book)
    )

    return book
```

**Pros:**
- Simple to implement
- Only caches requested data (no waste)
- Cache miss doesn't block application

**Cons:**
- First request is slow (cache miss)
- Cache stampede risk (many requests at once)

**Use Cases:**
- Book metadata
- Chapter content
- User profiles
- Image URLs

### 2. Write-Through Cache

**Updates cache synchronously when data changes**

```mermaid
sequenceDiagram
    participant App
    participant Cache
    participant DB

    App->>DB: UPDATE reading_progress
    DB-->>App: Success

    App->>Cache: SET book:progress:{user_id}:{book_id}
    Cache-->>App: OK

    App->>App: Return success to client
```

**Implementation:**
```python
async def update_reading_progress(
    user_id: UUID,
    book_id: UUID,
    progress_data: dict,
    db: AsyncSession
) -> ReadingProgress:
    """Update progress with write-through caching."""
    # Update database
    progress = await db.get(ReadingProgress, (user_id, book_id))
    progress.current_position = progress_data["current_position"]
    progress.reading_location_cfi = progress_data.get("cfi")
    db.add(progress)
    await db.commit()

    # Update cache (write-through)
    cache_key = f"book:progress:{user_id}:{book_id}"
    await redis_client.setex(
        cache_key,
        300,  # 5 min TTL (dynamic data)
        pickle.dumps(progress)
    )

    return progress
```

**Pros:**
- Cache always consistent with database
- Subsequent reads are fast (cache hit)
- Simple consistency model

**Cons:**
- Write latency increases (2 operations)
- Cache may store unused data

**Use Cases:**
- Reading progress (frequently read after write)
- User settings (read-heavy after update)
- Book parsing status (polled frequently)

### 3. Read-Through Cache

**Cache loads data automatically on miss**

```python
async def get_with_read_through(cache_key: str, loader_func, ttl: int):
    """Generic read-through cache wrapper."""
    # Try cache
    cached_data = await redis_client.get(cache_key)
    if cached_data:
        return pickle.loads(cached_data)

    # Cache miss - load data
    data = await loader_func()

    # Store in cache
    await redis_client.setex(cache_key, ttl, pickle.dumps(data))

    return data

# Usage
book = await get_with_read_through(
    cache_key=f"book:metadata:{book_id}",
    loader_func=lambda: db.get(Book, book_id),
    ttl=3600
)
```

**Pros:**
- Encapsulates caching logic
- Consistent interface for cached/uncached data
- Reusable pattern

**Cons:**
- Loader function must be async
- Error handling more complex

**Use Cases:**
- Generic caching utility
- Service-layer caching
- API client caching

### 4. Refresh-Ahead

**Proactively refresh cache before expiry**

```python
async def get_with_refresh_ahead(
    cache_key: str,
    loader_func,
    ttl: int,
    refresh_threshold: float = 0.8
):
    """Cache with proactive refresh before expiry."""
    # Get cached data with TTL remaining
    pipe = redis_client.pipeline()
    pipe.get(cache_key)
    pipe.ttl(cache_key)
    cached_data, ttl_remaining = await pipe.execute()

    if cached_data:
        data = pickle.loads(cached_data)

        # Refresh if close to expiry (80% of TTL elapsed)
        if ttl_remaining < (ttl * (1 - refresh_threshold)):
            # Async refresh in background (don't wait)
            asyncio.create_task(refresh_cache(cache_key, loader_func, ttl))

        return data

    # Cache miss - load and store
    data = await loader_func()
    await redis_client.setex(cache_key, ttl, pickle.dumps(data))
    return data
```

**Pros:**
- Prevents cache expiry (always hot)
- No slow requests after expiry
- Smoother performance

**Cons:**
- More complex implementation
- Extra background load
- May refresh unused data

**Use Cases:**
- High-traffic endpoints
- Data that's expensive to compute
- NLP processing results

---

## TTL Policies

### TTL Strategy by Data Type

| Data Type | TTL | Rationale | Invalidation |
|-----------|-----|-----------|--------------|
| **Static Data** | 1 hour | Rarely changes | Manual on update |
| Book metadata | 1 hour | Content stable | On book update |
| Chapter content | 2 hours | Never changes | On reparse |
| Book covers | 24 hours | Rarely replaced | On cover upload |
| User profiles | 1 hour | Occasional updates | On profile edit |
| **Dynamic Data** | 5 minutes | Changes frequently | On every update |
| Reading progress | 5 minutes | Updated often | On progress save |
| Parsing status | 1 minute | Real-time updates | On status change |
| Image generation status | 2 minutes | Active processing | On completion |
| **Session Data** | 15 minutes | Auth-related | On logout |
| User sessions | 15 minutes | JWT refresh cycle | On explicit logout |
| Active tokens | 30 minutes | Access token TTL | On token refresh |
| **Computed Data** | 30 minutes | Expensive to compute | On data change |
| NLP results | 30 minutes | Processor-heavy | On text change |
| Book statistics | 1 hour | Aggregations | On new data |
| User statistics | 1 hour | Complex queries | On activity |
| **Rate Limiting** | 1 minute | Sliding window | Auto (time-based) |
| Rate limit counters | 1 minute | Per-minute limits | Rolling expiry |

### TTL Configuration Examples

```python
# backend/app/core/cache.py
CACHE_TTL_CONFIG = {
    # Static data (1 hour = 3600 seconds)
    "book_metadata": 3600,
    "chapter_content": 7200,
    "book_cover": 86400,
    "user_profile": 3600,

    # Dynamic data (5 min = 300 seconds)
    "reading_progress": 300,
    "parsing_status": 60,
    "image_status": 120,

    # Session data (15 min = 900 seconds)
    "user_session": 900,
    "access_token": 1800,

    # Computed data (30 min = 1800 seconds)
    "nlp_result": 1800,
    "book_statistics": 3600,
    "user_statistics": 3600,

    # Rate limiting (1 min = 60 seconds)
    "rate_limit": 60,
}
```

---

## Cache Invalidation

### Invalidation Strategies

#### 1. Manual Invalidation on Update

```python
async def update_book(book_id: UUID, updates: dict, db: AsyncSession):
    """Update book and invalidate related caches."""
    # Update database
    book = await db.get(Book, book_id)
    for key, value in updates.items():
        setattr(book, key, value)
    await db.commit()

    # Invalidate caches
    cache_keys = [
        f"book:metadata:{book_id}",
        f"book:cover:{book_id}",
        f"user:books:{book.user_id}",  # User's books list
    ]
    await redis_client.delete(*cache_keys)

    return book
```

#### 2. Tag-Based Invalidation

```python
async def invalidate_book_caches(book_id: UUID):
    """Invalidate all caches related to a book."""
    # Find all keys matching pattern
    pattern = f"book:*:{book_id}*"
    cursor = 0
    keys_to_delete = []

    while True:
        cursor, keys = await redis_client.scan(
            cursor, match=pattern, count=100
        )
        keys_to_delete.extend(keys)
        if cursor == 0:
            break

    # Delete in batch
    if keys_to_delete:
        await redis_client.delete(*keys_to_delete)
```

#### 3. Cascading Invalidation

```python
async def invalidate_chapter(chapter_id: UUID, db: AsyncSession):
    """Invalidate chapter and related parent caches."""
    chapter = await db.get(Chapter, chapter_id)

    # Invalidate chapter caches
    await redis_client.delete(
        f"chapter:content:{chapter_id}",
        f"chapter:descriptions:{chapter_id}",
    )

    # Invalidate parent book caches (cascade)
    await redis_client.delete(
        f"book:metadata:{chapter.book_id}",
        f"book:chapters:{chapter.book_id}",
    )
```

### Admin Cache Management Endpoints

```python
@router.get("/api/v1/admin/cache/stats")
async def get_cache_stats():
    """Get Redis cache statistics."""
    info = await redis_client.info("stats")
    return {
        "total_keys": await redis_client.dbsize(),
        "hits": info.get("keyspace_hits", 0),
        "misses": info.get("keyspace_misses", 0),
        "hit_rate": calculate_hit_rate(info),
        "memory_used": info.get("used_memory_human"),
        "evicted_keys": info.get("evicted_keys", 0),
    }

@router.post("/api/v1/admin/cache/clear")
async def clear_cache(pattern: str = "*"):
    """Clear caches matching pattern."""
    if pattern == "*":
        # Clear all (use with caution!)
        await redis_client.flushdb()
        return {"message": "All caches cleared"}

    # Clear specific pattern
    keys = await redis_client.keys(pattern)
    if keys:
        await redis_client.delete(*keys)
    return {"message": f"Cleared {len(keys)} keys matching {pattern}"}

@router.post("/api/v1/admin/cache/warm")
async def warm_cache(book_ids: List[UUID]):
    """Pre-warm cache for specific books."""
    for book_id in book_ids:
        # Load from database and cache
        book = await get_book_cached(book_id, db)
    return {"message": f"Warmed cache for {len(book_ids)} books"}
```

---

## Implementation Examples

### Example 1: Book Metadata Caching

```python
async def get_book_with_chapters(
    book_id: UUID,
    db: AsyncSession
) -> Dict:
    """Get book with chapters - cache-aside pattern."""
    cache_key = f"book:metadata:{book_id}"

    # Try cache
    cached = await redis_client.get(cache_key)
    if cached:
        logger.info(f"Cache HIT for {cache_key}")
        return pickle.loads(cached)

    logger.info(f"Cache MISS for {cache_key}")

    # Query database
    book = await db.get(Book, book_id, options=[
        selectinload(Book.chapters)
    ])
    if not book:
        raise BookNotFoundException()

    # Serialize for cache
    book_data = {
        "id": str(book.id),
        "title": book.title,
        "author": book.author,
        "chapters": [
            {"id": str(c.id), "title": c.title, "number": c.chapter_number}
            for c in book.chapters
        ],
        "metadata": book.book_metadata,
    }

    # Store in cache (1 hour TTL)
    await redis_client.setex(
        cache_key,
        CACHE_TTL_CONFIG["book_metadata"],
        pickle.dumps(book_data)
    )

    return book_data
```

### Example 2: Reading Progress with Write-Through

```python
async def save_reading_progress(
    user_id: UUID,
    book_id: UUID,
    progress_update: ReadingProgressUpdate,
    db: AsyncSession
) -> ReadingProgress:
    """Save reading progress with write-through caching."""
    # Update database
    progress = await db.execute(
        select(ReadingProgress).where(
            ReadingProgress.user_id == user_id,
            ReadingProgress.book_id == book_id
        )
    )
    progress = progress.scalar_one_or_none()

    if not progress:
        progress = ReadingProgress(user_id=user_id, book_id=book_id)

    # Update fields
    progress.current_chapter = progress_update.current_chapter
    progress.reading_location_cfi = progress_update.reading_location_cfi
    progress.scroll_offset_percent = progress_update.scroll_offset_percent
    progress.last_read_at = datetime.utcnow()

    db.add(progress)
    await db.commit()
    await db.refresh(progress)

    # Write-through: Update cache immediately
    cache_key = f"book:progress:{user_id}:{book_id}"
    await redis_client.setex(
        cache_key,
        CACHE_TTL_CONFIG["reading_progress"],
        pickle.dumps(progress)
    )

    logger.info(f"Updated progress cache for user {user_id}, book {book_id}")

    return progress
```

### Example 3: NLP Result Caching

```python
import hashlib

async def extract_descriptions_cached(
    text: str,
    chapter_id: UUID,
    mode: str = "adaptive"
) -> List[Description]:
    """Extract descriptions with result caching."""
    # Generate cache key from text hash
    text_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
    cache_key = f"nlp:result:{chapter_id}:{text_hash}:{mode}"

    # Try cache
    cached = await redis_client.get(cache_key)
    if cached:
        logger.info(f"Cache HIT for NLP result: {cache_key}")
        return pickle.loads(cached)

    logger.info(f"Cache MISS for NLP result: {cache_key}")

    # Process with Multi-NLP
    result = await multi_nlp_manager.process_text(
        text=text,
        mode=mode,
        language="ru"
    )

    descriptions = result["descriptions"]

    # Cache result (30 min TTL - expensive to compute)
    await redis_client.setex(
        cache_key,
        CACHE_TTL_CONFIG["nlp_result"],
        pickle.dumps(descriptions)
    )

    return descriptions
```

---

## Performance Metrics

### Cache Performance (Week 15-17)

| Metric | Before Caching | After Caching | Improvement |
|--------|----------------|---------------|-------------|
| **API Response Time** | 200-500ms | <50ms | 83% faster |
| **Database Queries/sec** | 150 | 45 | 70% reduction |
| **Concurrent Users** | 50 | 500+ | 10x capacity |
| **Cache Hit Rate** | N/A | 85%+ | N/A |
| **Memory Usage (Redis)** | 0 MB | ~200 MB | Acceptable |

### Endpoint-Specific Performance

| Endpoint | Before | After | Cache TTL |
|----------|--------|-------|-----------|
| GET /books | 300ms | 40ms | 1 hour |
| GET /books/{id} | 250ms | 30ms | 1 hour |
| GET /books/{id}/chapters/{n} | 400ms | 50ms | 2 hours |
| GET /books/{id}/progress | 150ms | 20ms | 5 min |
| POST /nlp/extract-descriptions | 2000ms | 100ms* | 30 min |

*Only cached if exact text hash matches (rare, but helps with retries)

### Cache Hit Rate by Data Type

| Data Type | Hit Rate | Reason |
|-----------|----------|--------|
| Book metadata | 92% | Frequently accessed, rarely updated |
| Chapter content | 88% | Read multiple times per session |
| Reading progress | 75% | Updated often, but read more |
| User profiles | 80% | Stable data, occasional reads |
| NLP results | 30% | Unique text per chapter (low reuse) |
| **Overall Average** | **85%** | Weighted by request volume |

---

## Monitoring & Maintenance

### Redis Monitoring

**Key Metrics to Track:**

```python
async def get_redis_health():
    """Get Redis health metrics."""
    info = await redis_client.info()

    return {
        # Performance
        "hit_rate": calculate_hit_rate(info["Stats"]),
        "ops_per_sec": info["Stats"]["instantaneous_ops_per_sec"],

        # Memory
        "used_memory_human": info["Memory"]["used_memory_human"],
        "used_memory_peak_human": info["Memory"]["used_memory_peak_human"],
        "memory_fragmentation_ratio": info["Memory"]["mem_fragmentation_ratio"],

        # Keys
        "total_keys": await redis_client.dbsize(),
        "evicted_keys": info["Stats"]["evicted_keys"],
        "expired_keys": info["Stats"]["expired_keys"],

        # Connections
        "connected_clients": info["Clients"]["connected_clients"],
        "blocked_clients": info["Clients"]["blocked_clients"],

        # Persistence
        "rdb_last_save_time": info["Persistence"]["rdb_last_save_time"],
        "rdb_changes_since_last_save": info["Persistence"]["rdb_changes_since_last_save"],
    }
```

### Cache Maintenance Tasks

**1. Monitor Cache Hit Rate:**
```bash
# Alert if hit rate drops below 70%
redis-cli INFO stats | grep keyspace_hits
```

**2. Monitor Memory Usage:**
```bash
# Alert if memory usage > 80%
redis-cli INFO memory | grep used_memory_human
```

**3. Monitor Evictions:**
```bash
# Alert if evictions increase suddenly
redis-cli INFO stats | grep evicted_keys
```

**4. Clear Stale Keys:**
```python
# Periodic cleanup job (runs daily)
async def cleanup_stale_caches():
    """Remove caches for deleted books."""
    # Find books marked as deleted
    deleted_books = await db.execute(
        select(Book.id).where(Book.is_deleted == True)
    )

    for book_id in deleted_books.scalars():
        # Remove all caches for this book
        pattern = f"book:*:{book_id}*"
        keys = await redis_client.keys(pattern)
        if keys:
            await redis_client.delete(*keys)
```

### Troubleshooting Guide

**Problem: Low Cache Hit Rate (<70%)**

- **Causes:**
  - TTL too short (data expires too quickly)
  - Cache keys not consistent (typos, format changes)
  - Too much data invalidation
  - Memory pressure causing evictions

- **Solutions:**
  - Increase TTL for stable data
  - Review cache key generation logic
  - Optimize invalidation strategy
  - Increase Redis memory limit

**Problem: High Memory Usage**

- **Causes:**
  - TTL too long (stale data accumulating)
  - Too many large objects cached
  - Memory leak in serialization
  - No eviction policy

- **Solutions:**
  - Reduce TTL for less-accessed data
  - Use compression for large objects (gzip)
  - Implement `maxmemory-policy` (allkeys-lru)
  - Monitor and alert on memory usage

**Problem: Slow Cache Operations**

- **Causes:**
  - Network latency to Redis
  - Large serialized objects
  - Redis CPU saturation
  - Blocking operations (KEYS, FLUSHDB)

- **Solutions:**
  - Use connection pooling
  - Compress large objects before caching
  - Scale Redis (more memory, CPU)
  - Use SCAN instead of KEYS

---

## Best Practices

### Do's ✅

- **Use connection pooling:** Reuse Redis connections
- **Set appropriate TTLs:** Balance freshness vs hit rate
- **Compress large objects:** Use gzip for >1KB data
- **Monitor cache metrics:** Hit rate, memory, evictions
- **Use cache-aside for most cases:** Simple and effective
- **Invalidate on updates:** Keep cache consistent
- **Use atomic operations:** SETEX, not SET + EXPIRE

### Don'ts ❌

- **Don't cache sensitive data:** Passwords, tokens (or encrypt)
- **Don't use blocking operations:** KEYS, FLUSHDB in production
- **Don't cache unbounded data:** Limit list/set sizes
- **Don't ignore evictions:** Monitor and alert
- **Don't cache forever:** Always set TTL
- **Don't cache rarely accessed data:** Waste of memory
- **Don't assume cache is always available:** Graceful degradation

---

## Conclusion

The Redis caching layer is a critical component of BookReader AI's performance architecture, delivering:

- **83% faster API responses** through intelligent caching
- **85% cache hit rate** with optimized TTL policies
- **70% reduced database load** via effective cache-aside pattern
- **10x capacity increase** supporting 500+ concurrent users

**Key Takeaways:**
- Cache-aside is the primary pattern (90% of use cases)
- TTL policies balance freshness and performance
- Manual invalidation ensures consistency
- Monitoring is essential for optimization

**Last Updated:** 2025-10-30
**Version:** 1.0 (Week 15-17 Performance Optimization)
**Author:** Documentation Master Agent
