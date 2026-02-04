"""
Rate Limiter for controlling concurrent book parsing
Prevents system overload by limiting simultaneous heavy operations
"""

import time
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import redis.asyncio as redis
import logging
import json
import psutil

logger = logging.getLogger(__name__)


class ParsingRateLimiter:
    """
    Controls the number of concurrent parsing operations
    Uses Redis for distributed locking across multiple workers
    """

    def __init__(
        self,
        redis_client: Optional[redis.Redis] = None,
        max_concurrent: int = 5,
        max_per_user: int = 1,
        cooldown_seconds: int = 60,
    ):
        self.redis_client = redis_client
        self.max_concurrent = max_concurrent
        self.max_per_user = max_per_user
        self.cooldown_seconds = cooldown_seconds

        # Redis keys
        self.ACTIVE_TASKS_KEY = "parsing:active_tasks"
        self.USER_TASKS_KEY = "parsing:user_tasks:{user_id}"
        self.COOLDOWN_KEY = "parsing:cooldown:{book_id}"
        self.QUEUE_KEY = "parsing:queue"
        self.STATS_KEY = "parsing:stats"

    async def can_start_parsing(self, book_id: str, user_id: str) -> tuple[bool, str]:
        """
        Check if a new parsing task can be started

        Returns:
            (can_start, reason_if_not)
        """

        if not self.redis_client:
            # If Redis is not available, allow but log warning
            logger.warning("Redis not available for rate limiting")
            return True, ""

        try:
            # Check cooldown
            cooldown_key = self.COOLDOWN_KEY.format(book_id=book_id)
            if await self.redis_client.exists(cooldown_key):
                ttl = await self.redis_client.ttl(cooldown_key)
                return False, f"Book in cooldown for {ttl} seconds"

            # Check global concurrent limit
            active_count = await self.redis_client.scard(self.ACTIVE_TASKS_KEY)
            if active_count >= self.max_concurrent:
                return (
                    False,
                    f"System at capacity ({active_count}/{self.max_concurrent} tasks)",
                )

            # Check per-user limit
            user_key = self.USER_TASKS_KEY.format(user_id=user_id)
            user_count = await self.redis_client.scard(user_key)
            if user_count >= self.max_per_user:
                return (
                    False,
                    f"User limit reached ({user_count}/{self.max_per_user} tasks)",
                )

            # Check system resources
            can_start, reason = await self._check_system_resources()
            if not can_start:
                return False, f"Resource constraint: {reason}"

            return True, ""

        except Exception as e:
            logger.error(f"Error checking rate limit: {str(e)}")
            # On error, be conservative and deny
            return False, "Rate limit check failed"

    async def acquire_slot(self, book_id: str, user_id: str, task_id: str) -> bool:
        """
        Acquire a parsing slot for the task
        """
        if not self.redis_client:
            return True

        try:
            # Add to active tasks
            await self.redis_client.sadd(self.ACTIVE_TASKS_KEY, task_id)

            # Add to user's active tasks
            user_key = self.USER_TASKS_KEY.format(user_id=user_id)
            await self.redis_client.sadd(user_key, task_id)
            await self.redis_client.expire(user_key, 3600)  # Auto-cleanup after 1 hour

            # Set cooldown
            cooldown_key = self.COOLDOWN_KEY.format(book_id=book_id)
            await self.redis_client.setex(cooldown_key, self.cooldown_seconds, "1")

            # Update stats
            await self._update_stats("started")

            logger.info(f"✅ Acquired parsing slot for task {task_id}")
            return True

        except Exception as e:
            logger.error(f"Error acquiring slot: {str(e)}")
            return False

    async def release_slot(self, book_id: str, user_id: str, task_id: str):
        """
        Release a parsing slot after task completion
        """
        if not self.redis_client:
            return

        try:
            # Remove from active tasks
            await self.redis_client.srem(self.ACTIVE_TASKS_KEY, task_id)

            # Remove from user's tasks
            user_key = self.USER_TASKS_KEY.format(user_id=user_id)
            await self.redis_client.srem(user_key, task_id)

            # Update stats
            await self._update_stats("completed")

            logger.info(f"✅ Released parsing slot for task {task_id}")

        except Exception as e:
            logger.error(f"Error releasing slot: {str(e)}")

    async def add_to_queue(self, book_id: str, user_id: str, priority: int = 5) -> int:
        """
        Add task to queue if can't start immediately
        Returns position in queue
        """
        if not self.redis_client:
            return 0

        try:
            task_data = {
                "book_id": book_id,
                "user_id": user_id,
                "priority": priority,
                "queued_at": datetime.now(timezone.utc).isoformat(),
            }

            # Add to sorted set with priority as score
            score = time.time() - (priority * 1000)  # Higher priority = lower score
            await self.redis_client.zadd(self.QUEUE_KEY, {json.dumps(task_data): score})

            # Get position in queue
            position = await self.redis_client.zrank(
                self.QUEUE_KEY, json.dumps(task_data)
            )

            return position + 1 if position is not None else 1

        except Exception as e:
            logger.error(f"Error adding to queue: {str(e)}")
            return 0

    async def get_next_from_queue(self) -> Optional[Dict[str, Any]]:
        """
        Get next task from queue
        """
        if not self.redis_client:
            return None

        try:
            # Get item with lowest score (highest priority)
            items = await self.redis_client.zrange(
                self.QUEUE_KEY, 0, 0, withscores=False
            )

            if items:
                task_data = json.loads(items[0])
                # Remove from queue
                await self.redis_client.zrem(self.QUEUE_KEY, items[0])
                return task_data

            return None

        except Exception as e:
            logger.error(f"Error getting from queue: {str(e)}")
            return None

    async def get_stats(self) -> Dict[str, Any]:
        """
        Get current rate limiter statistics
        """
        if not self.redis_client:
            return {}

        try:
            active_count = await self.redis_client.scard(self.ACTIVE_TASKS_KEY)
            queue_length = await self.redis_client.zcard(self.QUEUE_KEY)

            # Get stats from Redis
            stats_data = await self.redis_client.get(self.STATS_KEY)
            stats = json.loads(stats_data) if stats_data else {}

            return {
                "active_tasks": active_count,
                "max_concurrent": self.max_concurrent,
                "queue_length": queue_length,
                "total_started": stats.get("started", 0),
                "total_completed": stats.get("completed", 0),
                "capacity_percent": (
                    (active_count / self.max_concurrent * 100)
                    if self.max_concurrent > 0
                    else 0
                ),
            }

        except Exception as e:
            logger.error(f"Error getting stats: {str(e)}")
            return {}

    async def _check_system_resources(self) -> tuple[bool, str]:
        """
        Check if system has enough resources for new task
        """
        try:
            # Check memory
            memory = psutil.virtual_memory()
            if memory.percent > 85:
                return False, f"Memory usage too high: {memory.percent}%"

            if memory.available < 2 * 1024 * 1024 * 1024:  # Less than 2GB available
                return (
                    False,
                    "Insufficient memory: "
                    f"{memory.available / 1024 / 1024 / 1024:.1f}GB available",
                )

            # Check CPU
            cpu_percent = psutil.cpu_percent(interval=0.1)
            if cpu_percent > 90:
                return False, f"CPU usage too high: {cpu_percent}%"

            return True, ""

        except Exception as e:
            logger.error(f"Error checking system resources: {str(e)}")
            # If can't check, be conservative
            return False, "Unable to check system resources"

    async def _update_stats(self, event_type: str):
        """Update statistics in Redis"""
        if not self.redis_client:
            return

        try:
            # Get current stats
            stats_data = await self.redis_client.get(self.STATS_KEY)
            stats = json.loads(stats_data) if stats_data else {}

            # Update counter
            stats[event_type] = stats.get(event_type, 0) + 1
            stats["last_updated"] = datetime.now(timezone.utc).isoformat()

            # Save back
            await self.redis_client.setex(
                self.STATS_KEY,
                86400,
                json.dumps(stats),  # Keep stats for 24 hours
            )

        except Exception as e:
            logger.error(f"Error updating stats: {str(e)}")


# Global instance (to be initialized with Redis connection)
rate_limiter: Optional[ParsingRateLimiter] = None


async def init_rate_limiter(redis_url: str):
    """Initialize the global rate limiter"""
    global rate_limiter

    try:
        redis_client = await redis.from_url(redis_url)
        rate_limiter = ParsingRateLimiter(
            redis_client=redis_client,
            max_concurrent=5,  # Max 5 concurrent parsings
            max_per_user=1,  # Max 1 per user
            cooldown_seconds=60,  # 1 minute cooldown
        )
        logger.info("✅ Rate limiter initialized")
        return rate_limiter
    except Exception as e:
        logger.error(f"❌ Failed to initialize rate limiter: {str(e)}")
        rate_limiter = ParsingRateLimiter()  # Fallback without Redis
        return rate_limiter


__all__ = ["ParsingRateLimiter", "rate_limiter", "init_rate_limiter"]
