import pytest
from httpx import AsyncClient


class TestAuth:
    """Test authentication endpoints."""

    @pytest.mark.asyncio
    async def test_register_user(self, client: AsyncClient, sample_user_data):
        """Test user registration."""
        response = await client.post("/api/v1/auth/register", json=sample_user_data)

        assert response.status_code == 201
        data = response.json()
        assert data["user"]["email"] == sample_user_data["email"]
        assert data["user"]["full_name"] == sample_user_data["full_name"]
        assert "tokens" in data
        assert "access_token" in data["tokens"]
        assert "refresh_token" in data["tokens"]

    @pytest.mark.asyncio
    async def test_register_duplicate_email(
        self, client: AsyncClient, sample_user_data
    ):
        """Test registration with duplicate email."""
        # Register first user
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # Try to register again with same email
        response = await client.post("/api/v1/auth/register", json=sample_user_data)

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_invalid_email(self, client: AsyncClient, sample_user_data):
        """Test registration with invalid email."""
        sample_user_data["email"] = "invalid-email"

        response = await client.post("/api/v1/auth/register", json=sample_user_data)

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_register_weak_password(self, client: AsyncClient, sample_user_data):
        """Слабый пароль отвергается на двух рубежах.

        Короче 12 символов — схемой `UserRegistrationRequest` (min_length=12),
        то есть 422 до обработчика. Достаточно длинный, но простой —
        `validate_password_strength` внутри обработчика, то есть 400.
        """
        sample_user_data["password"] = "123"

        response = await client.post("/api/v1/auth/register", json=sample_user_data)

        assert response.status_code == 422

        sample_user_data["password"] = "alllowercase1!"
        response = await client.post("/api/v1/auth/register", json=sample_user_data)

        assert response.status_code == 400
        assert "uppercase" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, sample_user_data):
        """Test successful login."""
        # Register user first
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # Login
        login_data = {
            "email": sample_user_data["email"],
            "password": sample_user_data["password"],
        }
        response = await client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == sample_user_data["email"]
        assert "tokens" in data
        assert "access_token" in data["tokens"]

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(
        self, client: AsyncClient, sample_user_data
    ):
        """Test login with invalid credentials."""
        # Register user first
        await client.post("/api/v1/auth/register", json=sample_user_data)

        # Try login with wrong password
        login_data = {"email": sample_user_data["email"], "password": "wrongpassword"}
        response = await client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 401
        assert (
            "incorrect" in response.json()["detail"].lower()
            or "invalid" in response.json()["detail"].lower()
        )

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client: AsyncClient):
        """Test login with non-existent user."""
        login_data = {"email": "nonexistent@example.com", "password": "password123"}
        response = await client.post("/api/v1/auth/login", json=login_data)

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_current_user(
        self, client: AsyncClient, authenticated_headers, sample_user_data
    ):
        """Test getting current authenticated user."""
        headers = await authenticated_headers()

        response = await client.get("/api/v1/auth/me", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert data["user"]["email"] == sample_user_data["email"]
        assert data["user"]["full_name"] == sample_user_data["full_name"]

    @pytest.mark.asyncio
    async def test_get_current_user_unauthorized(self, client: AsyncClient):
        """Test getting current user without authentication."""
        response = await client.get("/api/v1/auth/me", follow_redirects=False)

        # Auth middleware may redirect or return 401/403
        assert response.status_code in [401, 403, 307]

    @pytest.mark.asyncio
    async def test_get_current_user_invalid_token(self, client: AsyncClient):
        """Test getting current user with invalid token."""
        headers = {"Authorization": "Bearer invalid_token"}

        response = await client.get("/api/v1/auth/me", headers=headers)

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token(self, client: AsyncClient, sample_user_data):
        """Test token refresh."""
        # Register and login
        await client.post("/api/v1/auth/register", json=sample_user_data)
        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )

        refresh_token = login_response.json()["tokens"]["refresh_token"]

        # Refresh token
        response = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": refresh_token}
        )

        # Схема RefreshTokenResponse: токен лежит в корне ответа
        assert response.status_code == 200
        data = response.json()
        assert data["token_type"] == "bearer"
        assert data["access_token"]

    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self, client: AsyncClient):
        """Test refresh with invalid token."""
        response = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": "invalid_token"}
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_logout(self, client: AsyncClient, authenticated_headers):
        """Test user logout."""
        headers = await authenticated_headers()

        response = await client.post("/api/v1/auth/logout", headers=headers)

        assert response.status_code == 200
        assert "logout" in response.json()["message"].lower()
        assert "successful" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_logout_without_token_is_idempotent(self, client: AsyncClient):
        """Выход без токена — 200.

        Endpoint не требует аутентификации (`app/routers/auth.py:300-306`):
        токен читается опционально, а без него просто чистятся cookies.
        Прежний список `[401, 403, 307]` описывал поведение, которого нет.
        """
        response = await client.post("/api/v1/auth/logout", follow_redirects=False)

        assert response.status_code == 200
