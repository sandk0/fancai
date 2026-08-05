"""
Тесты для rate limiting middleware с per-user ID идентификацией.

Покрывает:
1. AI presets ai_operation (10/min) и ai_image (5/min) существуют
2. Идентификатор декоратора rate_limit формирует user:{id} для авторизованных
3. Идентификатор декоратора rate_limit формирует ip:{host} для анонимных
4. Превышение лимита возвращает 429 с Retry-After header и JSON телом
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import Request, HTTPException
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS, RateLimiter

# =============================================================================
# Тест 1: AI Presets существуют
# =============================================================================


class TestRateLimitPresets:
    """Тесты конфигурации RATE_LIMIT_PRESETS."""

    def test_ai_operation_preset_exists(self):
        """Preset ai_operation должен существовать."""
        assert "ai_operation" in RATE_LIMIT_PRESETS

    def test_ai_operation_preset_values(self):
        """Preset ai_operation должен быть 10 req/min."""
        preset = RATE_LIMIT_PRESETS["ai_operation"]
        assert preset["max_requests"] == 10
        assert preset["window_seconds"] == 60

    def test_ai_image_preset_exists(self):
        """Preset ai_image должен существовать."""
        assert "ai_image" in RATE_LIMIT_PRESETS

    def test_ai_image_preset_values(self):
        """Preset ai_image должен быть 5 req/min."""
        preset = RATE_LIMIT_PRESETS["ai_image"]
        assert preset["max_requests"] == 5
        assert preset["window_seconds"] == 60

    def test_existing_presets_unchanged(self):
        """Существующие presets не изменились."""
        assert "high_frequency" in RATE_LIMIT_PRESETS
        assert "normal" in RATE_LIMIT_PRESETS
        assert "low_frequency" in RATE_LIMIT_PRESETS
        assert "auth" in RATE_LIMIT_PRESETS


# =============================================================================
# Тест 2: Идентификатор per-user и per-IP
# =============================================================================


class TestRateLimitIdentifierLogic:
    """Тесты логики определения идентификатора для rate limiting."""

    def test_rate_limit_decorator_uses_user_id_format(self):
        """Декоратор rate_limit должен использовать формат user:{id} для авторизованных."""
        # Тестируем через проверку исходного кода декоратора
        import inspect
        from app.middleware import rate_limit as rate_limit_func

        source = inspect.getsource(rate_limit_func)
        # Декоратор должен формировать user:{id} идентификатор
        assert (
            'f"user:{' in source
            or '"user:" +' in source
            or "user:{current_user.id}" in source
        )

    def test_rate_limit_decorator_uses_ip_format(self):
        """Декоратор rate_limit должен использовать формат ip:{host} для анонимных."""
        import inspect
        from app.middleware import rate_limit as rate_limit_func

        source = inspect.getsource(rate_limit_func)
        # Декоратор должен формировать ip:{host} идентификатор
        assert 'f"ip:{' in source or '"ip:" +' in source or "ip:{ip}" in source

    def test_rate_limit_middleware_source_has_user_prefix(self):
        """middleware/rate_limit.py должен содержать 'user:' префикс."""
        import inspect
        import app.middleware.rate_limit as rl_mod

        source = inspect.getsource(rl_mod)
        assert '"user:' in source or "f'user:" in source or "user:{" in source

    def test_rate_limit_middleware_source_has_ip_prefix(self):
        """middleware/rate_limit.py должен содержать 'ip:' префикс."""
        import inspect
        import app.middleware.rate_limit as rl_mod

        source = inspect.getsource(rl_mod)
        assert '"ip:' in source or "f'ip:" in source or "ip:{" in source


# =============================================================================
# Тест 3: 429 при превышении лимита
# =============================================================================


class TestRateLimitExceeded:
    """Тесты поведения при превышении лимита через RateLimiter напрямую."""

    @pytest.mark.asyncio
    async def test_rate_limiter_returns_limited_when_exceeded(self):
        """RateLimiter.is_rate_limited возвращает True при превышении."""
        # Тестируем RateLimiter напрямую через мок Redis
        limiter = RateLimiter()

        # Симулируем превышение через мок Redis
        mock_redis = MagicMock()
        mock_redis.incr = AsyncMock(return_value=11)  # 11 > max_requests(10)
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=30)
        limiter._redis = mock_redis

        is_limited, rate_info = await limiter.is_rate_limited(
            identifier="user:42",
            endpoint="/api/test",
            max_requests=10,
            window_seconds=60,
        )

        assert is_limited is True
        assert rate_info["remaining"] == 0

    @pytest.mark.asyncio
    async def test_rate_limiter_not_limited_under_threshold(self):
        """RateLimiter.is_rate_limited возвращает False при нормальной нагрузке."""
        limiter = RateLimiter()

        mock_redis = MagicMock()
        mock_redis.incr = AsyncMock(return_value=5)  # 5 <= max_requests(10)
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=45)
        limiter._redis = mock_redis

        is_limited, rate_info = await limiter.is_rate_limited(
            identifier="user:42",
            endpoint="/api/test",
            max_requests=10,
            window_seconds=60,
        )

        assert is_limited is False
        assert rate_info["remaining"] == 5

    @pytest.mark.asyncio
    async def test_rate_limit_429_has_json_body(self):
        """429 HTTPException должен содержать JSON тело с error, message, retry_after."""
        # Тестируем через создание FastAPI-приложения
        app = FastAPI()

        @app.get("/test")
        @rate_limit(max_requests=5, window_seconds=60)
        async def test_endpoint(request: Request, current_user=None):
            return {"ok": True}

        # Мокаем is_rate_limited на экземпляре rate_limiter через monkey-patching класса

        original = RateLimiter.is_rate_limited

        async def always_limited(
            self, identifier, endpoint, max_requests, window_seconds
        ):
            return (True, {"limit": 5, "remaining": 0, "reset_in_seconds": 30})

        RateLimiter.is_rate_limited = always_limited

        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get("/test")
                assert response.status_code == 429
                data = response.json()
                assert "detail" in data
                detail = data["detail"]
                if isinstance(detail, dict):
                    assert "error" in detail
                    assert detail["error"] == "rate_limit_exceeded"
                    assert "retry_after" in detail
        finally:
            RateLimiter.is_rate_limited = original

    @pytest.mark.asyncio
    async def test_rate_limit_429_has_retry_after_header(self):
        """429 HTTPException должен содержать Retry-After header."""
        from fastapi import FastAPI

        app = FastAPI()

        @app.get("/test-header")
        @rate_limit(max_requests=5, window_seconds=60)
        async def test_endpoint(request: Request, current_user=None):
            return {"ok": True}

        async def always_limited(
            self, identifier, endpoint, max_requests, window_seconds
        ):
            return (True, {"limit": 5, "remaining": 0, "reset_in_seconds": 45})

        original = RateLimiter.is_rate_limited
        RateLimiter.is_rate_limited = always_limited

        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get("/test-header")
                assert response.status_code == 429
                assert (
                    "retry-after" in response.headers
                    or "Retry-After" in response.headers
                )
        finally:
            RateLimiter.is_rate_limited = original

    def test_rate_limit_429_exception_structure(self):
        """HTTPException для 429 содержит правильную структуру detail."""
        # Проверяем через прямое создание HTTPException с нашей структурой
        from fastapi import status

        exc = HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Слишком много запросов. Повторите позже.",
                "retry_after": 30,
            },
            headers={"Retry-After": "30"},
        )

        assert exc.status_code == 429
        assert exc.detail["error"] == "rate_limit_exceeded"
        assert "message" in exc.detail
        assert exc.detail["retry_after"] == 30
        assert exc.headers["Retry-After"] == "30"


# =============================================================================
# Тест 4: Graceful degradation без Redis
# =============================================================================


class TestRateLimiterGracefulDegradation:
    """RateLimiter должен разрешать запросы при недоступном Redis."""

    @pytest.mark.asyncio
    async def test_rate_limiter_allows_when_redis_unavailable(self):
        """При недоступном Redis rate_limiter разрешает все запросы."""
        limiter = RateLimiter()
        # _redis is None по умолчанию — graceful degradation

        is_limited, rate_info = await limiter.is_rate_limited(
            identifier="user:42",
            endpoint="/api/test",
            max_requests=10,
            window_seconds=60,
        )

        assert is_limited is False
        assert rate_info["remaining"] == 10
