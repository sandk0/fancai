"""
Tests for get_optional_current_user() cookie support.

Verifies that optional auth dependency works with:
1. Cookie-only auth (no Authorization header)
2. No auth at all → returns None
3. Blacklisted token in cookie → returns None
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.auth import get_optional_current_user
from app.models.user import User


@pytest.fixture
def test_user_id():
    return uuid4()


@pytest.fixture
def mock_user(test_user_id):
    """Create a mock User object."""
    user = MagicMock(spec=User)
    user.id = test_user_id
    user.email = "test@example.com"
    user.full_name = "Test User"
    user.is_active = True
    user.is_admin = False
    user.tokens_invalidated_at = None
    return user


def _build_app():
    """Create a minimal FastAPI app with an optional-auth endpoint."""
    app = FastAPI()

    @app.get("/test-optional")
    async def test_endpoint(user=Depends(get_optional_current_user())):
        if user is None:
            return {"user": None}
        return {"user": str(user.id), "email": user.email}

    return app


class TestOptionalAuthCookieSupport:
    """Tests for cookie fallback in get_optional_current_user."""

    @pytest.mark.asyncio
    async def test_cookie_only_returns_user(self, test_user_id, mock_user):
        """Request with access_token cookie (no Authorization header) → returns user."""
        app = _build_app()

        with (
            patch(
                "app.core.auth.auth_service.verify_token",
                return_value={"sub": str(test_user_id), "type": "access"},
            ),
            patch(
                "app.core.auth.auth_service.get_user_by_id",
                new_callable=AsyncMock,
                return_value=mock_user,
            ),
            patch(
                "app.core.auth.token_blacklist.is_blacklisted",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    "/test-optional",
                    cookies={"access_token": "valid-cookie-token"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["user"] == str(test_user_id)
        assert data["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_no_auth_returns_none(self):
        """Request without cookie and without Authorization header → returns None."""
        app = _build_app()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/test-optional")

        assert response.status_code == 200
        assert response.json() == {"user": None}

    @pytest.mark.asyncio
    async def test_blacklisted_cookie_returns_none(self):
        """Request with blacklisted token in cookie → returns None."""
        app = _build_app()

        with patch(
            "app.core.auth.token_blacklist.is_blacklisted",
            new_callable=AsyncMock,
            return_value=True,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    "/test-optional",
                    cookies={"access_token": "blacklisted-token"},
                )

        assert response.status_code == 200
        assert response.json() == {"user": None}

    @pytest.mark.asyncio
    async def test_header_still_works(self, test_user_id, mock_user):
        """Authorization header still works (backward compatibility)."""
        app = _build_app()

        with (
            patch(
                "app.core.auth.auth_service.verify_token",
                return_value={"sub": str(test_user_id), "type": "access"},
            ),
            patch(
                "app.core.auth.auth_service.get_user_by_id",
                new_callable=AsyncMock,
                return_value=mock_user,
            ),
            patch(
                "app.core.auth.token_blacklist.is_blacklisted",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    "/test-optional",
                    headers={"Authorization": "Bearer valid-header-token"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["user"] == str(test_user_id)

    @pytest.mark.asyncio
    async def test_header_preferred_over_cookie(self, test_user_id, mock_user):
        """When both header and cookie present, header takes precedence."""
        app = _build_app()

        call_args = []

        async def mock_is_blacklisted(token, **kwargs):
            call_args.append(token)
            return False

        with (
            patch(
                "app.core.auth.auth_service.verify_token",
                return_value={"sub": str(test_user_id), "type": "access"},
            ),
            patch(
                "app.core.auth.auth_service.get_user_by_id",
                new_callable=AsyncMock,
                return_value=mock_user,
            ),
            patch(
                "app.core.auth.token_blacklist.is_blacklisted",
                side_effect=mock_is_blacklisted,
            ),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    "/test-optional",
                    headers={"Authorization": "Bearer header-token"},
                    cookies={"access_token": "cookie-token"},
                )

        assert response.status_code == 200
        # Header token should be used, not cookie
        assert "header-token" in call_args
