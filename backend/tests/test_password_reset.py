"""
Tests for password reset (forgot/reset password) functionality.

Covers OWASP-compliant password reset flow:
1. forgot-password endpoint (no user enumeration)
2. reset-password endpoint (token validation, password update)
3. Session invalidation (Option A: tokens_invalidated_at)
4. Rate limiting and timing safety
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.password_reset import PasswordResetToken
from app.models.user import User
from app.services.auth_service import AuthService


class TestForgotPassword:
    """Tests for POST /auth/forgot-password."""

    @pytest.mark.asyncio
    async def test_forgot_password_existing_user(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Existing user receives 200 with generic message (no user enumeration)."""
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": test_user.email},
        )

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

        # Verify token was created in DB
        result = await db_session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == test_user.id
            )
        )
        token = result.scalar_one_or_none()
        assert token is not None
        assert token.used_at is None
        assert token.expires_at > datetime.now(timezone.utc)

    @pytest.mark.asyncio
    async def test_forgot_password_nonexistent_email(self, client: AsyncClient):
        """Non-existent email still returns 200 (OWASP: no user enumeration)."""
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nobody@example.com"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    @pytest.mark.asyncio
    async def test_forgot_password_deactivated_user(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Deactivated user gets 200 but no token is created."""
        test_user.is_active = False
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": test_user.email},
        )

        assert response.status_code == 200

        # No token should be created for deactivated users
        result = await db_session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == test_user.id
            )
        )
        assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_multiple_reset_requests_invalidate_old_tokens(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Second reset request invalidates (deletes) the first token."""
        # First request
        await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": test_user.email},
        )

        result = await db_session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == test_user.id
            )
        )
        first_tokens = result.scalars().all()
        assert len(first_tokens) == 1
        first_token_hash = first_tokens[0].token_hash

        # Second request
        await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": test_user.email},
        )

        result = await db_session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == test_user.id
            )
        )
        tokens = result.scalars().all()
        assert len(tokens) == 1
        # The old token should be replaced
        assert tokens[0].token_hash != first_token_hash


class TestRateLimiting:
    """Tests for rate limiting on password reset endpoints."""

    @pytest.mark.asyncio
    async def test_rate_limit_forgot_password(self, client: AsyncClient):
        """More than 3 requests per minute triggers 429 Too Many Requests."""
        for i in range(3):
            resp = await client.post(
                "/api/v1/auth/forgot-password",
                json={"email": f"user{i}@example.com"},
            )
            assert resp.status_code == 200

        # 4th request should be rate-limited
        resp = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "extra@example.com"},
        )
        assert resp.status_code == 429


class TestResetPassword:
    """Tests for POST /auth/reset-password."""

    async def _create_reset_token(
        self,
        db_session: AsyncSession,
        user: User,
        expires_delta: timedelta | None = None,
        mark_used: bool = False,
    ) -> str:
        """Helper: create a valid reset token and return the plain-text token."""
        plain_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(plain_token.encode()).hexdigest()

        if expires_delta is None:
            expires_delta = timedelta(minutes=30)

        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + expires_delta,
            used_at=datetime.now(timezone.utc) if mark_used else None,
        )
        db_session.add(reset_token)
        await db_session.commit()
        return plain_token

    @pytest.mark.asyncio
    async def test_reset_password_valid_token(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Valid token + strong password => 200 and password is changed."""
        plain_token = await self._create_reset_token(db_session, test_user)
        new_password = "NewSecureP@ss99!"

        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": plain_token, "new_password": new_password},
        )

        assert response.status_code == 200

        # Verify password was actually changed
        auth_service = AuthService()
        await db_session.refresh(test_user)
        assert auth_service.verify_password(new_password, test_user.password_hash)

        # Verify token was consumed (deleted)
        result = await db_session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == test_user.id
            )
        )
        assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_reset_password_expired_token(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Expired token returns 400."""
        plain_token = await self._create_reset_token(
            db_session, test_user, expires_delta=timedelta(minutes=-5)
        )

        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": plain_token, "new_password": "NewSecureP@ss99!"},
        )

        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower() or "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_used_token(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Already-used token returns 400."""
        plain_token = await self._create_reset_token(
            db_session, test_user, mark_used=True
        )

        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": plain_token, "new_password": "NewSecureP@ss99!"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_reset_password_invalid_token(self, client: AsyncClient):
        """Completely bogus token returns 400."""
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "bogus-token-that-does-not-exist", "new_password": "NewSecureP@ss99!"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_reset_password_weak_password(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Weak new password is rejected (validation before token check)."""
        plain_token = await self._create_reset_token(db_session, test_user)

        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": plain_token, "new_password": "weak"},
        )

        assert response.status_code == 400
        assert "12 characters" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_invalidates_sessions(
        self, client: AsyncClient, db_session: AsyncSession, sample_user_data
    ):
        """After password reset, old JWT tokens are invalidated (Option A)."""
        # Register and login to get tokens
        reg_resp = await client.post("/api/v1/auth/register", json=sample_user_data)
        assert reg_resp.status_code == 201
        tokens = reg_resp.json()["tokens"]
        old_access_token = tokens["access_token"]
        old_refresh_token = tokens["refresh_token"]

        # Get the user from DB
        result = await db_session.execute(
            select(User).where(User.email == sample_user_data["email"])
        )
        user = result.scalar_one()

        # Create reset token and reset password
        plain_token = await self._create_reset_token(db_session, user)
        new_password = "BrandNewP@ss99!"

        reset_resp = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": plain_token, "new_password": new_password},
        )
        assert reset_resp.status_code == 200

        # Old access token should be rejected
        me_resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        assert me_resp.status_code == 401

        # Old refresh token should be rejected
        refresh_resp = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": old_refresh_token},
        )
        assert refresh_resp.status_code == 401

        # New login with new password should work
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": sample_user_data["email"], "password": new_password},
        )
        assert login_resp.status_code == 200

    @pytest.mark.asyncio
    async def test_reset_password_sends_confirmation_email(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Successful reset fires a confirmation email (fire-and-forget)."""
        plain_token = await self._create_reset_token(db_session, test_user)

        with patch(
            "app.routers.auth.get_email_service_dep"
        ) as mock_email_dep:
            mock_email_svc = AsyncMock()
            mock_email_svc.send_password_changed_confirmation = AsyncMock(return_value=True)
            mock_email_dep.return_value = mock_email_svc

            # We need to override the dependency
            from app.main import app as fastapi_app
            from app.core.container import get_email_service_dep

            fastapi_app.dependency_overrides[get_email_service_dep] = lambda: mock_email_svc

            try:
                response = await client.post(
                    "/api/v1/auth/reset-password",
                    json={"token": plain_token, "new_password": "NewSecureP@ss99!"},
                )
                assert response.status_code == 200

                # Give asyncio.ensure_future time to run
                import asyncio
                await asyncio.sleep(0.1)

                mock_email_svc.send_password_changed_confirmation.assert_called_once_with(
                    test_user.email
                )
            finally:
                fastapi_app.dependency_overrides.pop(get_email_service_dep, None)

    @pytest.mark.asyncio
    async def test_reset_password_timing_safety(self, client: AsyncClient):
        """Invalid token still takes non-trivial time (dummy bcrypt for timing safety)."""
        import time

        start = time.monotonic()
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "completely-invalid-token", "new_password": "NewSecureP@ss99!"},
        )
        elapsed = time.monotonic() - start

        assert response.status_code == 400
        # bcrypt hash takes measurable time (>10ms typically)
        # This ensures timing safety: invalid tokens don't return instantly
        assert elapsed > 0.01, f"Response too fast ({elapsed:.4f}s), timing safety may be broken"
