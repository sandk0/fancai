"""
Token Blacklist Service for fancai.

Provides secure JWT token revocation using Redis storage.
Tokens are stored until their natural expiration to prevent replay attacks.

Security considerations:
- Tokens are stored with TTL matching their original expiration
- Redis key prefix prevents collision with other cache keys
- Graceful degradation if Redis is unavailable (logs warning but allows operation)
"""

from datetime import datetime, timezone
from loguru import logger

from ..core.cache import cache_manager


class TokenBlacklist:
    """
    Redis-based token blacklist for JWT revocation.

    Stores revoked tokens until their natural expiration time,
    preventing replay attacks while minimizing storage overhead.

    Usage:
        # Add token to blacklist on logout
        await token_blacklist.add(token, expires_at)

        # Check if token is revoked before allowing access
        if await token_blacklist.is_blacklisted(token):
            raise HTTPException(status_code=401, detail="Token has been revoked")
    """

    PREFIX = "token_blacklist:"

    async def add(self, token: str, expires_at: datetime) -> bool:
        """
        Add token to blacklist until its natural expiration.

        Args:
            token: The JWT token string to blacklist
            expires_at: Token's original expiration datetime (from 'exp' claim)

        Returns:
            True if successfully added or token already expired,
            False if Redis operation failed

        Note:
            Token is stored with TTL = (expires_at - now), so it automatically
            cleans up after the token would have expired anyway.
        """
        now = datetime.now(timezone.utc)

        # Ensure expires_at is timezone-aware
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        ttl_seconds = int((expires_at - now).total_seconds())

        # Token already expired, no need to blacklist
        if ttl_seconds <= 0:
            logger.debug("Token already expired, skipping blacklist")
            return True

        key = f"{self.PREFIX}{token}"

        try:
            # `cache_manager.set` отдаёт False, когда Redis недоступен. Раньше
            # возврат игнорировался и `add` рапортовал True: logout сообщал об
            # успехе, а токен в blacklist не попадал и продолжал работать.
            if not await cache_manager.set(key, "1", ttl=ttl_seconds):
                logger.error("Failed to blacklist token: cache unavailable")
                return False
            logger.info(f"Token blacklisted (TTL: {ttl_seconds}s)")
            return True
        except Exception as e:
            logger.error(f"Failed to blacklist token: {e}")
            return False

    async def is_blacklisted(self, token: str, require_online: bool = False) -> bool:
        """
        Check if token is blacklisted (revoked).

        Args:
            token: The JWT token string to check
            require_online: If True, fail-closed when Redis unavailable.
                           If False (default), fail-open for offline mode support.

        Returns:
            True if token is blacklisted or (require_online=True and Redis down),
            False if not blacklisted or (require_online=False and Redis down)

        Behavior:
            - require_online=False: Allows offline reading of cached books
            - require_online=True: Use for sensitive operations (payments, admin)
        """
        key = f"{self.PREFIX}{token}"

        try:
            result = await cache_manager.get(key)
            is_revoked = result is not None

            if is_revoked:
                logger.debug("Blacklisted token access attempted")

            return is_revoked
        except Exception as e:
            logger.warning(f"Token blacklist check failed (Redis unavailable): {e}")
            if require_online:
                logger.warning(
                    "Fail-closed: Rejecting token due to Redis unavailability"
                )
                return True
            return False

    async def remove(self, token: str) -> bool:
        """
        Remove token from blacklist (for testing or admin override).

        Args:
            token: The JWT token string to remove from blacklist

        Returns:
            True if successfully removed, False otherwise
        """
        key = f"{self.PREFIX}{token}"

        try:
            await cache_manager.delete(key)
            logger.info("Token removed from blacklist")
            return True
        except Exception as e:
            logger.error(f"Failed to remove token from blacklist: {e}")
            return False

    async def get_blacklist_stats(self) -> dict:
        """
        Get statistics about blacklisted tokens.

        Returns:
            Dictionary with count of blacklisted tokens
        """
        if not cache_manager.is_available or not cache_manager._redis:
            return {"available": False, "count": 0}

        try:
            # Count keys with blacklist prefix
            count = 0
            async for _ in cache_manager._redis.scan_iter(match=f"{self.PREFIX}*"):
                count += 1

            return {"available": True, "count": count, "prefix": self.PREFIX}
        except Exception as e:
            logger.error(f"Failed to get blacklist stats: {e}")
            return {"available": False, "count": 0, "error": str(e)}


# Global singleton instance
token_blacklist = TokenBlacklist()
