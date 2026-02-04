"""
Redis Caching Service for LLM Responses.

Implements "literal cache" strategy for LLM calls:
- Caches entire ChapterAnalysisResult objects
- Keys based on content hash + prompt version + model
- Reduces API costs by ~90% for repeated processing
"""

import json
import hashlib
import logging
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any, List
from datetime import datetime

from redis.asyncio import Redis
from app.core.config import settings
from app.core.json_utils import dump_json, parse_json_safe

logger = logging.getLogger(__name__)


@dataclass
class ChapterCacheKey:
    """
    Unique cache key components for chapter analysis.
    Any change in these fields invalidates the cache.
    """

    book_id: str
    chapter_id: str
    chapter_content_hash: str  # SHA-256[:16] of text content
    prompt_template_hash: str  # SHA-256[:8] of prompt template
    model_name: str  # e.g., "gemini-3-flash"
    analysis_type: str  # "descriptions" | "entities" | "tsa"

    def to_redis_key(self) -> str:
        """Generate a deterministic Redis key string."""
        # Sort keys to ensure deterministic JSON
        key_data = dump_json(asdict(self), sort_keys=True)
        key_hash = hashlib.sha256(key_data.encode()).hexdigest()
        return f"llm:chapter:{key_hash}"


class LLMCacheService:
    def __init__(self):
        self._redis: Optional[Redis] = None
        self._ttl = 86400 * 30  # 30 days default TTL

    async def connect(self):
        """Lazy connection to Redis."""
        if not self._redis:
            self._redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)

    async def get(self, key: ChapterCacheKey) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached LLM response.

        Returns:
            Dict with parsed response or None if cache miss.
        """
        await self.connect()
        redis_key = key.to_redis_key()

        try:
            data = await self._redis.get(redis_key)
            if data:
                logger.debug(f"LLM Cache HIT: {redis_key}")
                return parse_json_safe(data, log_error=True)

            logger.debug(f"LLM Cache MISS: {redis_key}")
            return None

        except Exception as e:
            logger.warning(f"Redis cache read error: {e}")
            return None

    async def set(self, key: ChapterCacheKey, value: Any, ttl: int = None) -> bool:
        """
        Cache LLM response.

        Args:
            key: Cache key components
            value: Data to cache (will be JSON serialized)
            ttl: Optional TTL override
        """
        await self.connect()
        redis_key = key.to_redis_key()

        try:
            # Add metadata for debugging
            payload = {
                "data": value,
                "metadata": {
                    "cached_at": datetime.utcnow().isoformat(),
                    "key_components": asdict(key),
                },
            }

            serialized = dump_json(payload)
            await self._redis.setex(redis_key, ttl or self._ttl, serialized)
            logger.debug(f"LLM Cache SET: {redis_key}")
            return True

        except Exception as e:
            logger.warning(f"Redis cache write error: {e}")
            return False

    @staticmethod
    def compute_content_hash(text: str) -> str:
        """Compute SHA-256 hash of text content."""
        return hashlib.sha256(text.encode()).hexdigest()[:16]


# Singleton instance
llm_cache = LLMCacheService()
