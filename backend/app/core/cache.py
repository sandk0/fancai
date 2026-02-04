"""
Redis caching layer for fancai backend.

Provides:
- Redis connection management with connection pooling
- Generic caching decorators for functions and FastAPI endpoints
- Cache invalidation utilities
- Cache key pattern management
- JSON serialization for complex objects
- Graceful fallback to database if Redis unavailable

Performance targets:
- API response time: <50ms for cached data
- Cache hit rate: >80% for read-heavy endpoints
- Database load reduction: -80%
"""

import json
import asyncio
import functools
from typing import Any, Callable, Optional, TypeVar, Union, TYPE_CHECKING
from datetime import timedelta
from redis.asyncio import Redis, ConnectionPool
from redis.exceptions import RedisError, ConnectionError as RedisConnectionError
from loguru import logger

from .config import settings

T = TypeVar("T")

if TYPE_CHECKING:
    from .cache import CacheManager as CacheManagerType


class DistributedLock:
    """
    Async context manager for distributed locks with auto-renewal.
    Prevents lock expiration during long-running operations.

    Usage:
        async with DistributedLock(cache_manager, "my_lock", ttl=60, renewal_interval=30):
            await long_running_operation()
    """

    def __init__(
        self,
        cache_manager: "CacheManagerType",
        lock_key: str,
        ttl: int = 60,
        renewal_interval: int = 30,
    ):
        self._cache = cache_manager
        self._lock_key = lock_key
        self._ttl = ttl
        self._renewal_interval = renewal_interval
        self._renewal_task: Optional[asyncio.Task] = None
        self._acquired = False

    async def __aenter__(self) -> bool:
        self._acquired = await self._cache.acquire_lock(self._lock_key, self._ttl)
        if self._acquired:
            self._renewal_task = asyncio.create_task(self._renewal_loop())
        return self._acquired

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._renewal_task:
            self._renewal_task.cancel()
            try:
                await self._renewal_task
            except asyncio.CancelledError:
                pass
        if self._acquired:
            await self._cache.release_lock(self._lock_key)

    async def _renewal_loop(self):
        while True:
            await asyncio.sleep(self._renewal_interval)
            try:
                await self._cache.renew_lock(self._lock_key, self._ttl)
            except Exception as e:
                logger.warning(f"Lock renewal failed for {self._lock_key}: {e}")


class CacheManager:
    """
    Redis cache manager with connection pooling and error handling.

    Features:
    - Async Redis operations
    - Connection pooling for performance
    - Automatic JSON serialization/deserialization
    - Graceful error handling with fallback
    - Cache key pattern management
    - TTL (Time-To-Live) support
    """

    def __init__(self):
        """Initialize Redis connection pool."""
        self._redis: Optional[Redis] = None
        self._pool: Optional[ConnectionPool] = None
        self._is_available = False

    async def initialize(self):
        """
        Initialize Redis connection pool.

        Called during application startup.
        """
        try:
            # Parse Redis URL
            # Format: redis://:password@host:port/db
            redis_url = settings.REDIS_URL

            # Create connection pool (configurable for different deployment scenarios)
            self._pool = ConnectionPool.from_url(
                redis_url,
                decode_responses=True,
                max_connections=settings.REDIS_MAX_CONNECTIONS,  # Configurable: 50 (staging) or 100 (production)
                socket_connect_timeout=5,
                socket_keepalive=True,
            )

            self._redis = Redis(connection_pool=self._pool)

            # Test connection
            await self._redis.ping()
            self._is_available = True
            logger.info(f"✅ Redis cache initialized: {redis_url}")

        except Exception as e:
            logger.warning(f"⚠️ Redis initialization failed: {e}")
            logger.warning(
                "📊 Application will work without caching (fallback to database)"
            )
            self._is_available = False

    async def close(self):
        """
        Close Redis connection pool.

        Called during application shutdown.
        """
        if self._redis:
            await self._redis.close()
            logger.info("Redis connection closed")

    @property
    def is_available(self) -> bool:
        """Check if Redis is available."""
        return self._is_available

    async def _with_retry(
        self,
        operation: Callable[[], Any],
        max_retries: int = 2,
        base_delay: float = 0.1,
    ) -> Any:
        """
        TD-P19-2: Execute Redis operation with retry on transient failures.
        Uses exponential backoff: 0.1s, 0.2s for 2 retries.
        """
        last_error: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                return await operation()
            except (RedisError, RedisConnectionError, asyncio.TimeoutError) as e:
                last_error = e
                if attempt < max_retries:
                    delay = base_delay * (2**attempt)
                    logger.debug(f"Redis retry {attempt + 1}/{max_retries}: {e}")
                    await asyncio.sleep(delay)
                else:
                    logger.warning(
                        f"Redis operation failed after {max_retries + 1} attempts: {e}"
                    )
        raise last_error if last_error else RuntimeError("Redis retry exhausted")

    async def get(self, key: str) -> Optional[Any]:
        """
        Get value from cache.

        Args:
            key: Cache key

        Returns:
            Cached value (deserialized from JSON) or None if not found
        """
        if not self._is_available or not self._redis:
            return None

        try:

            async def _get():
                return await self._redis.get(key)

            value = await self._with_retry(_get)
            if value:
                logger.debug(f"🎯 Cache HIT: {key}")
                return json.loads(value)
            logger.debug(f"❌ Cache MISS: {key}")
            return None
        except Exception as e:
            logger.warning(f"Redis GET error for key {key}: {e}")
            return None

    async def set(
        self, key: str, value: Any, ttl: Optional[Union[int, timedelta]] = None
    ) -> bool:
        """
        Set value in cache with optional TTL.

        Args:
            key: Cache key
            value: Value to cache (will be JSON serialized)
            ttl: Time-to-live in seconds or timedelta (None = no expiration)

        Returns:
            True if successful, False otherwise
        """
        if not self._is_available or not self._redis:
            return False

        try:
            if isinstance(ttl, timedelta):
                ttl = int(ttl.total_seconds())

            serialized = json.dumps(value, default=str)

            async def _set():
                if ttl:
                    await self._redis.setex(key, ttl, serialized)
                else:
                    await self._redis.set(key, serialized)

            await self._with_retry(_set)
            logger.debug(f"💾 Cache SET: {key} (TTL: {ttl}s)")
            return True

        except (TypeError, ValueError) as e:
            logger.warning(f"Redis SET serialization error for key {key}: {e}")
            return False
        except Exception as e:
            logger.warning(f"Redis SET error for key {key}: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """
        Delete key from cache.

        Args:
            key: Cache key to delete

        Returns:
            True if successful, False otherwise
        """
        if not self._is_available or not self._redis:
            return False

        try:

            async def _delete():
                await self._redis.delete(key)

            await self._with_retry(_delete)
            logger.debug(f"🗑️ Cache DELETE: {key}")
            return True
        except Exception as e:
            logger.warning(f"Redis DELETE error for key {key}: {e}")
            return False

    async def delete_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching pattern.

        Args:
            pattern: Redis key pattern (e.g., "book:*", "user:123:*")

        Returns:
            Number of keys deleted
        """
        if not self._is_available or not self._redis:
            return 0

        try:
            # Find all matching keys
            keys = []
            async for key in self._redis.scan_iter(match=pattern):
                keys.append(key)

            # Delete all keys
            if keys:
                deleted = await self._redis.delete(*keys)
                logger.info(f"🗑️ Cache DELETE pattern '{pattern}': {deleted} keys")
                return deleted

            return 0

        except RedisError as e:
            logger.warning(f"Redis DELETE pattern error for '{pattern}': {e}")
            return 0

    async def clear_all(self) -> bool:
        """
        Clear all cache (DANGEROUS - use with caution).

        Returns:
            True if successful, False otherwise
        """
        if not self._is_available or not self._redis:
            return False

        try:
            await self._redis.flushdb()
            logger.warning("🗑️ Cache CLEARED (all keys deleted)")
            return True
        except RedisError as e:
            logger.error(f"Redis FLUSH error: {e}")
            return False

    async def acquire_lock(
        self, lock_key: str, ttl: int = 60, value: str = "locked"
    ) -> bool:
        """
        Acquire a distributed lock using Redis SET NX.

        Args:
            lock_key: Unique key for the lock
            ttl: Lock expiration in seconds (default: 60s)
            value: Value to set (default: "locked")

        Returns:
            True if lock acquired, False if already locked
        """
        if not self._is_available or not self._redis:
            logger.warning(f"Redis unavailable, cannot acquire lock: {lock_key}")
            return True

        try:

            async def _acquire():
                return await self._redis.set(lock_key, value, nx=True, ex=ttl)

            result = await self._with_retry(_acquire)
            if result:
                logger.debug(f"🔒 Lock ACQUIRED: {lock_key} (TTL: {ttl}s)")
                return True
            else:
                logger.debug(f"⏳ Lock BUSY: {lock_key}")
                return False
        except Exception as e:
            logger.warning(f"Redis lock acquire error for {lock_key}: {e}")
            return True

    async def release_lock(self, lock_key: str) -> bool:
        """
        Release a distributed lock.

        Args:
            lock_key: Lock key to release

        Returns:
            True if released, False otherwise
        """
        if not self._is_available or not self._redis:
            return True

        try:

            async def _release():
                await self._redis.delete(lock_key)

            await self._with_retry(_release)
            logger.debug(f"🔓 Lock RELEASED: {lock_key}")
            return True
        except Exception as e:
            logger.warning(f"Redis lock release error for {lock_key}: {e}")
            return False

    async def renew_lock(self, lock_key: str, ttl: int = 60) -> bool:
        """
        Renew TTL on an existing lock. Use to prevent expiration during long operations.
        """
        if not self._is_available or not self._redis:
            return True

        try:
            result = await self._redis.expire(lock_key, ttl)
            if result:
                logger.debug(f"🔄 Lock RENEWED: {lock_key} (TTL: {ttl}s)")
            return bool(result)
        except RedisError as e:
            logger.warning(f"Redis lock renew error for {lock_key}: {e}")
            return False

    async def get_stats(self) -> dict:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache statistics
        """
        if not self._is_available or not self._redis:
            return {"available": False, "error": "Redis not available"}

        try:
            info = await self._redis.info()

            # Calculate hit rate
            hits = info.get("keyspace_hits", 0)
            misses = info.get("keyspace_misses", 0)
            total = hits + misses
            hit_rate = (hits / total * 100) if total > 0 else 0

            return {
                "available": True,
                "keys_count": await self._redis.dbsize(),
                "memory_used_mb": round(info.get("used_memory", 0) / 1024 / 1024, 2),
                "memory_peak_mb": round(
                    info.get("used_memory_peak", 0) / 1024 / 1024, 2
                ),
                "hits": hits,
                "misses": misses,
                "hit_rate_percent": round(hit_rate, 2),
                "connected_clients": info.get("connected_clients", 0),
                "uptime_seconds": info.get("uptime_in_seconds", 0),
            }

        except RedisError as e:
            logger.error(f"Redis INFO error: {e}")
            return {"available": False, "error": str(e)}


# Global cache manager instance
cache_manager = CacheManager()


def cache_key(*args, **kwargs) -> str:
    """
    Generate cache key from arguments.

    Uses consistent hashing for complex objects.

    Example:
        cache_key("book", book_id, user_id=123)
        -> "book:uuid:user:123"
    """
    parts = []

    # Add positional arguments
    for arg in args:
        parts.append(str(arg))

    # Add keyword arguments (sorted for consistency)
    for key in sorted(kwargs.keys()):
        parts.append(f"{key}:{kwargs[key]}")

    return ":".join(parts)


def cache_result(
    ttl: Union[int, timedelta] = 3600,
    key_prefix: Optional[str] = None,
):
    """
    Decorator to cache function results.

    Args:
        ttl: Cache TTL in seconds or timedelta (default: 1 hour)
        key_prefix: Custom key prefix (default: function name)

    Example:
        @cache_result(ttl=300, key_prefix="book_metadata")
        async def get_book_metadata(book_id: UUID) -> dict:
            ...
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key
            prefix = key_prefix or func.__name__
            key = cache_key(prefix, *args, **kwargs)

            # Try to get from cache
            cached = await cache_manager.get(key)
            if cached is not None:
                return cached

            # Execute function
            result = await func(*args, **kwargs)

            # Cache result
            await cache_manager.set(key, result, ttl)

            return result

        return wrapper

    return decorator


def invalidate_cache(*patterns: str):
    """
    Decorator to invalidate cache after function execution.

    Args:
        patterns: Cache key patterns to invalidate

    Example:
        @invalidate_cache("book:*", "user:{user_id}:*")
        async def update_book(book_id: UUID, user_id: UUID, data: dict):
            ...
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Execute function first
            result = await func(*args, **kwargs)

            # Invalidate cache patterns
            for pattern in patterns:
                # Replace placeholders with actual values
                # Example: "user:{user_id}:*" -> "user:123:*"
                formatted_pattern = pattern.format(**kwargs)
                await cache_manager.delete_pattern(formatted_pattern)

            return result

        return wrapper

    return decorator


# Common cache key patterns (documentation)
CACHE_KEY_PATTERNS = {
    # Books
    "book_metadata": "book:{book_id}:metadata",
    "book_chapters": "book:{book_id}:chapters",
    "book_list": "user:{user_id}:books:skip:{skip}:limit:{limit}",
    "book_toc": "book:{book_id}:toc",
    # Chapters
    "chapter_content": "book:{book_id}:chapter:{chapter_number}",
    "chapter_list": "book:{book_id}:chapters:list",
    # Reading Progress
    "user_progress": "user:{user_id}:progress:{book_id}",
    # Descriptions
    "book_descriptions": "book:{book_id}:descriptions",
    "chapter_descriptions": "book:{book_id}:chapter:{chapter_number}:descriptions",
    # Images
    "description_image": "description:{description_id}:image",
    # User Statistics (December 2025)
    "user_stats": "user_stats:{user_id}",
    # LLM Response Caching (January 2026)
    "llm_response": "llm:{model}:{text_hash}",
}


# Cache TTL configuration (in seconds)
CACHE_TTL = {
    "book_metadata": 3600,
    "book_chapters": 3600,
    "book_list": 10,
    "chapter_content": 3600,
    "user_progress": 300,
    "book_descriptions": 3600,
    "book_toc": 3600,
    "user_stats": 300,
    "llm_response": 86400,
}
