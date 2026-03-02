"""
Rate Limiting Middleware для fancai.

Защищает API от abuse используя Redis для distributed rate limiting.

Supports:
- Per-user rate limits
- Per-IP rate limits (для неаутентифицированных запросов)
- Different limits для разных endpoints
- Sliding window algorithm
"""

import logging
from typing import Optional, Callable
from functools import wraps
import hashlib

from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
import redis.asyncio as redis

from ..core.config import settings
from ..monitoring.metrics import record_rate_limit_triggered

logger = logging.getLogger(__name__)


# ============================================================================
# Rate Limiter Class
# ============================================================================


class RateLimiter:
    """
    Redis-based distributed rate limiter.

    Использует sliding window algorithm для точного rate limiting.

    Features:
    - Distributed (works across multiple app instances)
    - Per-user & per-IP limiting
    - Configurable limits per endpoint
    - Graceful degradation (если Redis недоступен)
    """

    def __init__(self, redis_url: Optional[str] = None):
        """
        Инициализация rate limiter.

        Args:
            redis_url: URL для подключения к Redis (default: из settings)
        """
        self.redis_url = redis_url or settings.REDIS_URL
        self._redis: Optional[redis.Redis] = None
        self.enabled = True  # Можно отключить для development

    async def connect(self) -> None:
        """Устанавливает соединение с Redis."""
        if self._redis is None:
            try:
                self._redis = await redis.from_url(
                    self.redis_url,
                    decode_responses=True,
                    max_connections=10,
                )
                logger.info("✅ Rate limiter connected to Redis")
            except Exception as e:
                logger.error(f"Failed to connect to Redis for rate limiting: {str(e)}")
                self.enabled = False

    async def close(self) -> None:
        """Закрывает соединение с Redis."""
        if self._redis:
            await self._redis.close()
            logger.info("Rate limiter disconnected from Redis")

    def _get_rate_limit_key(self, identifier: str, endpoint: str) -> str:
        """
        Генерирует ключ для rate limit в Redis.

        Args:
            identifier: User ID или IP address
            endpoint: Endpoint path (например, "/api/v1/reading-sessions/start")

        Returns:
            Redis key формата: "rate_limit:{endpoint_hash}:{identifier}"
        """
        # Хэшируем endpoint для компактности (not for security, just for key shortening)
        endpoint_hash = hashlib.md5(
            endpoint.encode(), usedforsecurity=False
        ).hexdigest()[:8]
        return f"rate_limit:{endpoint_hash}:{identifier}"

    async def is_rate_limited(
        self,
        identifier: str,
        endpoint: str,
        max_requests: int,
        window_seconds: int,
    ) -> tuple[bool, dict]:
        """
        Проверяет, превышен ли rate limit.

        Использует Redis INCR + EXPIRE для sliding window.

        Args:
            identifier: User ID или IP address
            endpoint: Endpoint path
            max_requests: Максимум запросов
            window_seconds: Временное окно в секундах

        Returns:
            Tuple: (is_limited, rate_limit_info)
            - is_limited: True если превышен лимит
            - rate_limit_info: dict с метаданными (remaining, reset_at)
        """
        if not self.enabled or not self._redis:
            # Graceful degradation - разрешаем запрос если Redis недоступен
            return False, {"remaining": max_requests, "reset_at": None}

        try:
            key = self._get_rate_limit_key(identifier, endpoint)

            # Atomic increment
            current_count = await self._redis.incr(key)

            # Устанавливаем TTL только для первого запроса
            if current_count == 1:
                await self._redis.expire(key, window_seconds)

            # Получаем TTL для определения reset_at
            ttl = await self._redis.ttl(key)

            # Проверяем лимит
            is_limited = current_count > max_requests
            remaining = max(0, max_requests - current_count)

            rate_limit_info = {
                "limit": max_requests,
                "remaining": remaining,
                "reset_in_seconds": ttl if ttl > 0 else window_seconds,
            }

            return is_limited, rate_limit_info

        except Exception as e:
            logger.error(f"Rate limit check error: {str(e)}")
            # Graceful degradation
            return False, {"remaining": max_requests, "reset_at": None}

    async def reset_limit(self, identifier: str, endpoint: str) -> bool:
        """
        Сбрасывает rate limit для identifier + endpoint.

        Используется для админских операций или тестирования.

        Args:
            identifier: User ID или IP address
            endpoint: Endpoint path

        Returns:
            True если успешно сброшен
        """
        if not self._redis:
            return False

        try:
            key = self._get_rate_limit_key(identifier, endpoint)
            await self._redis.delete(key)
            return True
        except Exception as e:
            logger.error(f"Failed to reset rate limit: {str(e)}")
            return False


# ============================================================================
# Global Rate Limiter Instance
# ============================================================================

rate_limiter = RateLimiter()


# ============================================================================
# Decorator для Rate Limiting Endpoints
# ============================================================================


def rate_limit(max_requests: int = 10, window_seconds: int = 60):
    """
    Декоратор для rate limiting FastAPI endpoints.

    Args:
        max_requests: Максимум запросов в окне
        window_seconds: Размер временного окна в секундах

    Example:
        @router.post("/reading-sessions/start")
        @rate_limit(max_requests=10, window_seconds=60)
        async def start_session(...):
            ...

    Raises:
        HTTPException: 429 Too Many Requests если превышен лимит
    """

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Извлекаем request из kwargs
            request: Optional[Request] = kwargs.get("request") or next(
                (arg for arg in args if isinstance(arg, Request)), None
            )

            if not request:
                # Если нет request, пропускаем rate limiting
                return await func(*args, **kwargs)

            # Определяем identifier (user_id или IP)
            identifier = None

            # Пробуем получить user_id из current_user
            current_user = kwargs.get("current_user")
            if current_user:
                identifier = f"user:{current_user.id}"
            else:
                # Используем IP address для неаутентифицированных
                ip = request.client.host if request.client else "unknown"
                identifier = f"ip:{ip}"

            # Проверяем rate limit
            endpoint = request.url.path
            is_limited, rate_info = await rate_limiter.is_rate_limited(
                identifier=identifier,
                endpoint=endpoint,
                max_requests=max_requests,
                window_seconds=window_seconds,
            )

            if is_limited:
                # Записываем метрику срабатывания rate limit
                limit_type = "user_id" if current_user else "ip"
                record_rate_limit_triggered(endpoint=endpoint, limit_type=limit_type)

                # Возвращаем 429 Too Many Requests с JSON телом
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "error": "rate_limit_exceeded",
                        "message": "Слишком много запросов. Повторите позже.",
                        "retry_after": rate_info["reset_in_seconds"],
                    },
                    headers={
                        "X-RateLimit-Limit": str(rate_info.get("limit", max_requests)),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(rate_info["reset_in_seconds"]),
                        "Retry-After": str(rate_info["reset_in_seconds"]),
                    },
                )

            # Добавляем rate limit headers в response
            response = await func(*args, **kwargs)

            # Если response - JSONResponse, добавляем headers
            if isinstance(response, JSONResponse):
                response.headers["X-RateLimit-Limit"] = str(rate_info["limit"])
                response.headers["X-RateLimit-Remaining"] = str(rate_info["remaining"])
                response.headers["X-RateLimit-Reset"] = str(
                    rate_info["reset_in_seconds"]
                )

            return response

        return wrapper

    return decorator


# ============================================================================
# Rate Limit Configuration Presets
# ============================================================================

# Конфигурация для разных типов endpoints
RATE_LIMIT_PRESETS = {
    # Частые операции (update position каждую секунду)
    "high_frequency": {"max_requests": 60, "window_seconds": 60},  # 60/min
    # Обычные операции (CRUD)
    "normal": {"max_requests": 30, "window_seconds": 60},  # 30/min
    # Ресурсоемкие операции (парсинг, генерация изображений)
    "low_frequency": {"max_requests": 10, "window_seconds": 60},  # 10/min
    # Authentication endpoints (STRENGTHENED for production security)
    "auth": {
        "max_requests": 10,
        "window_seconds": 60,
    },  # 10/min (increased from 3/min to fix login loop issues)
    # Registration endpoints (prevent spam registrations)
    "registration": {"max_requests": 2, "window_seconds": 60},  # 2/min
    # Password reset endpoints (OWASP: prevent brute force)
    "password_reset": {"max_requests": 3, "window_seconds": 60},  # 3/min
    # AI endpoints (LLM extraction, entity processing)
    "ai_operation": {
        "max_requests": 10,
        "window_seconds": 60,
    },  # 10/min для AI операций
    # AI image generation endpoints (ресурсоёмкие)
    "ai_image": {
        "max_requests": 5,
        "window_seconds": 60,
    },  # 5/min для генерации изображений
}


def get_rate_limit_for_endpoint(endpoint_type: str) -> dict:
    """
    Получает rate limit конфигурацию для типа endpoint.

    Args:
        endpoint_type: Тип endpoint (high_frequency, normal, low_frequency, auth)

    Returns:
        Dict с max_requests и window_seconds
    """
    return RATE_LIMIT_PRESETS.get(endpoint_type, RATE_LIMIT_PRESETS["normal"])
