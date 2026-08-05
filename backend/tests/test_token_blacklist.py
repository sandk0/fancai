"""
Tests for JWT Token Blacklist functionality.

Tests cover:
- Token blacklisting on logout
- Rejection of blacklisted tokens
- Token expiration handling
- Blacklist service operations
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient

from app.services.token_blacklist import TokenBlacklist


class TestTokenBlacklistService:
    """Test TokenBlacklist service directly."""

    @pytest.fixture
    def mock_cache_manager(self):
        """Create mock cache manager."""
        with patch("app.services.token_blacklist.cache_manager") as mock:
            mock.set = AsyncMock(return_value=True)
            mock.get = AsyncMock(return_value=None)
            mock.delete = AsyncMock(return_value=True)
            mock.is_available = True
            mock._redis = MagicMock()
            yield mock

    @pytest.mark.asyncio
    async def test_add_token_to_blacklist(self, mock_cache_manager):
        """Test adding a token to the blacklist."""
        blacklist = TokenBlacklist()
        token = "test_token_123"
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

        result = await blacklist.add(token, expires_at)

        assert result is True
        mock_cache_manager.set.assert_called_once()
        call_args = mock_cache_manager.set.call_args
        assert call_args[0][0] == f"token_blacklist:{token}"
        assert call_args[0][1] == "1"
        # TTL should be approximately 3600 seconds (1 hour)
        assert 3500 < call_args[1]["ttl"] < 3700

    @pytest.mark.asyncio
    async def test_add_expired_token_skips_blacklist(self, mock_cache_manager):
        """Test that already expired tokens are not added to blacklist."""
        blacklist = TokenBlacklist()
        token = "expired_token"
        expires_at = datetime.now(timezone.utc) - timedelta(hours=1)

        result = await blacklist.add(token, expires_at)

        assert result is True
        mock_cache_manager.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_is_blacklisted_returns_true_for_blacklisted_token(
        self, mock_cache_manager
    ):
        """Test checking if a blacklisted token is detected."""
        mock_cache_manager.get = AsyncMock(return_value="1")
        blacklist = TokenBlacklist()
        token = "blacklisted_token"

        result = await blacklist.is_blacklisted(token)

        assert result is True
        mock_cache_manager.get.assert_called_once_with(f"token_blacklist:{token}")

    @pytest.mark.asyncio
    async def test_is_blacklisted_returns_false_for_valid_token(
        self, mock_cache_manager
    ):
        """Test checking if a valid token returns False."""
        mock_cache_manager.get = AsyncMock(return_value=None)
        blacklist = TokenBlacklist()
        token = "valid_token"

        result = await blacklist.is_blacklisted(token)

        assert result is False
        mock_cache_manager.get.assert_called_once_with(f"token_blacklist:{token}")

    @pytest.mark.asyncio
    async def test_remove_token_from_blacklist(self, mock_cache_manager):
        """Test removing a token from the blacklist."""
        blacklist = TokenBlacklist()
        token = "token_to_remove"

        result = await blacklist.remove(token)

        assert result is True
        mock_cache_manager.delete.assert_called_once_with(f"token_blacklist:{token}")

    @pytest.mark.asyncio
    async def test_add_token_handles_naive_datetime(self, mock_cache_manager):
        """Test that naive datetime is converted to UTC."""
        blacklist = TokenBlacklist()
        token = "naive_datetime_token"
        # Naive datetime (no timezone info)
        expires_at = datetime.now() + timedelta(hours=1)

        result = await blacklist.add(token, expires_at)

        assert result is True
        mock_cache_manager.set.assert_called_once()


class TestTokenBlacklistIntegration:
    """Integration tests for token blacklist with auth endpoints."""

    @pytest.mark.asyncio
    async def test_logout_blacklists_token(self, client: AsyncClient, sample_user_data):
        """Test that logout adds token to blacklist."""
        # Register user
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # Login
        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        assert login_response.status_code == 200
        tokens = login_response.json()["tokens"]
        access_token = tokens["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Verify token works before logout
        me_response = await client.get("/api/v1/auth/me", headers=headers)
        assert me_response.status_code == 200

        # Logout
        logout_response = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout_response.status_code == 200
        assert "logout" in logout_response.json()["message"].lower()

    @pytest.fixture
    def in_memory_blacklist(self):
        """Настоящий цикл blacklist на словаре вместо общего dev-Redis.

        Без подмены исход теста зависит от того, поднят ли Redis рядом:
        при живом Redis токен отзывается (401), при мёртвом `is_blacklisted`
        ловит исключение. Проверять надо контракт, а не окружение.
        """
        store: dict[str, str] = {}

        async def _set(key, value, ttl=None):
            store[key] = value
            return True

        async def _get(key):
            return store.get(key)

        with patch("app.services.token_blacklist.cache_manager") as mock:
            mock.set = AsyncMock(side_effect=_set)
            mock.get = AsyncMock(side_effect=_get)
            mock.delete = AsyncMock(return_value=True)
            yield store

    @pytest.mark.asyncio
    async def test_blacklisted_token_rejected(
        self, client: AsyncClient, sample_user_data, in_memory_blacklist
    ):
        """После logout тот же access-токен обязан получать 401."""
        await client.post("/api/v1/auth/register", json=sample_user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200

        logout = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout.status_code == 200
        assert f"token_blacklist:{access_token}" in in_memory_blacklist

        me_response = await client.get("/api/v1/auth/me", headers=headers)
        assert me_response.status_code == 401

    @pytest.mark.asyncio
    async def test_unreachable_redis_fails_closed(
        self, client: AsyncClient, sample_user_data
    ):
        """`get_current_user` зовёт проверку с `require_online=True`.

        Недоступный Redis обязан закрывать доступ, а не открывать: иначе
        достаточно уронить кэш, чтобы все отозванные токены снова заработали.
        """
        await client.post("/api/v1/auth/register", json=sample_user_data)
        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        headers = {
            "Authorization": f"Bearer {login_response.json()['tokens']['access_token']}"
        }

        with patch(
            "app.services.token_blacklist.cache_manager.get",
            AsyncMock(side_effect=ConnectionError("redis down")),
        ):
            me_response = await client.get("/api/v1/auth/me", headers=headers)

        assert me_response.status_code == 401

    @pytest.mark.asyncio
    async def test_new_token_works_after_logout(
        self, client: AsyncClient, sample_user_data
    ):
        """Test that new login creates a valid token after logout."""
        # Register user
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # First login
        login_response1 = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        tokens1 = login_response1.json()["tokens"]
        headers1 = {"Authorization": f"Bearer {tokens1['access_token']}"}

        # Logout
        await client.post("/api/v1/auth/logout", headers=headers1)

        # Login again
        login_response2 = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        assert login_response2.status_code == 200
        tokens2 = login_response2.json()["tokens"]
        headers2 = {"Authorization": f"Bearer {tokens2['access_token']}"}

        # New token should work
        me_response = await client.get("/api/v1/auth/me", headers=headers2)
        assert me_response.status_code == 200
        assert me_response.json()["user"]["email"] == sample_user_data["email"]

    @pytest.mark.asyncio
    async def test_multiple_sessions_independent(
        self, client: AsyncClient, sample_user_data
    ):
        """Test that logging out one session doesn't affect others."""
        # Register user
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # Login twice (simulating two devices)
        login_response1 = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        tokens1 = login_response1.json()["tokens"]
        headers1 = {"Authorization": f"Bearer {tokens1['access_token']}"}

        login_response2 = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        tokens2 = login_response2.json()["tokens"]
        headers2 = {"Authorization": f"Bearer {tokens2['access_token']}"}

        # Logout first session
        await client.post("/api/v1/auth/logout", headers=headers1)

        # Second session should still work
        me_response = await client.get("/api/v1/auth/me", headers=headers2)
        assert me_response.status_code == 200


class TestTokenBlacklistEdgeCases:
    """Edge case tests for token blacklist."""

    @pytest.mark.asyncio
    async def test_logout_with_invalid_token_returns_200(self, client: AsyncClient):
        """Logout не защищён `get_current_user` — он лишь чистит куки.

        Токен берётся из `security`/куки напрямую, `verify_token` на мусоре
        отдаёт None, ветка blacklist пропускается. Значит 200, а не 401:
        клиент должен уметь разлогиниться с протухшим токеном.
        """
        response = await client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": "Bearer invalid_token_format"},
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_double_logout_is_safe(self, client: AsyncClient, sample_user_data):
        """Test that calling logout twice with same token is safe."""
        # Register and login
        await client.post("/api/v1/auth/register", json=sample_user_data)
        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )
        tokens = login_response.json()["tokens"]
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        # First logout
        logout1 = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout1.status_code == 200

        # Повтор идемпотентен: logout не проверяет отозванность, а повторная
        # запись в blacklist перезаписывает тот же ключ.
        logout2 = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout2.status_code == 200

    @pytest.fixture
    def mock_cache_unavailable(self):
        """Mock cache manager as unavailable."""
        with patch("app.services.token_blacklist.cache_manager") as mock:
            mock.set = AsyncMock(return_value=False)
            mock.get = AsyncMock(return_value=None)
            mock.is_available = False
            mock._redis = None
            yield mock

    @pytest.mark.asyncio
    async def test_blacklist_graceful_degradation(self, mock_cache_unavailable):
        """Test that blacklist operations handle Redis unavailability gracefully."""
        blacklist = TokenBlacklist()
        token = "test_token"

        # is_blacklisted should return False (fail-open)
        result = await blacklist.is_blacklisted(token)
        assert result is False

        # add should return False but not crash
        result = await blacklist.add(
            token, datetime.now(timezone.utc) + timedelta(hours=1)
        )
        assert result is False
