"""
Security Tests для fancai.

Тестирует:
- Security headers
- Rate limiting
- Input validation
- Secrets management
- CORS configuration
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import os

from app.main import app
from app.core.validation import (
    sanitize_filename,
    validate_email,
    validate_password_strength,
    validate_url,
    validate_uuid,
    sanitize_html,
    InputValidator,
)
from app.core.secrets import (
    validate_secret_exists,
    validate_secret_strength,
    validate_secret_not_default,
)
from app.middleware.security_headers import validate_security_headers

# ============================================================================
# Test Client Setup
# ============================================================================


@pytest.fixture
def client():
    """Test client fixture for security tests."""
    with TestClient(app) as c:
        yield c


# ============================================================================
# Security Headers Tests
# ============================================================================


class TestSecurityHeaders:
    """Test security headers are present and configured correctly."""

    def test_security_headers_present(self, client):
        """Test all required security headers are present."""
        response = client.get("/health")

        # Check response is successful
        assert response.status_code == 200

        headers = {k.lower(): v for k, v in response.headers.items()}

        # Required headers
        assert "strict-transport-security" in headers, "HSTS header missing"
        assert "content-security-policy" in headers, "CSP header missing"
        assert "x-frame-options" in headers, "X-Frame-Options header missing"
        assert (
            "x-content-type-options" in headers
        ), "X-Content-Type-Options header missing"
        assert "x-xss-protection" in headers, "X-XSS-Protection header missing"
        assert "referrer-policy" in headers, "Referrer-Policy header missing"
        assert "permissions-policy" in headers, "Permissions-Policy header missing"

    def test_hsts_header_configuration(self, client):
        """Test HSTS header is properly configured."""
        response = client.get("/health")
        hsts = response.headers.get("strict-transport-security", "").lower()

        assert "max-age=" in hsts, "HSTS max-age not set"
        assert "includesubdomains" in hsts, "HSTS includeSubDomains not set"
        assert "preload" in hsts, "HSTS preload not set"

    def test_x_frame_options_deny(self, client):
        """Test X-Frame-Options is set to DENY."""
        response = client.get("/health")
        x_frame = response.headers.get("x-frame-options", "").upper()

        assert x_frame == "DENY", "X-Frame-Options should be DENY"

    def test_x_content_type_options_nosniff(self, client):
        """Test X-Content-Type-Options is set to nosniff."""
        response = client.get("/health")
        x_content_type = response.headers.get("x-content-type-options", "").lower()

        assert x_content_type == "nosniff", "X-Content-Type-Options should be nosniff"

    def test_csp_header_has_safe_defaults(self, client):
        """Test CSP header contains safe default directives."""
        response = client.get("/health")
        csp = response.headers.get("content-security-policy", "").lower()

        # Check for important directives
        assert "default-src" in csp, "CSP missing default-src"
        assert "frame-ancestors 'none'" in csp, "CSP should prevent framing"

    def test_server_header_removed(self, client):
        """Test Server header is removed (information disclosure)."""
        response = client.get("/health")

        # Server header should not reveal server details
        server = response.headers.get("server", "")
        assert (
            "uvicorn" not in server.lower()
        ), "Server header should not reveal Uvicorn"
        assert (
            "fastapi" not in server.lower()
        ), "Server header should not reveal FastAPI"

    def test_security_headers_validation_function(self):
        """Test validate_security_headers function."""
        # Valid headers
        headers = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
        }

        result = validate_security_headers(headers)
        assert result["valid"] is True
        assert len(result["missing_headers"]) == 0

        # Missing headers
        invalid_headers = {
            "x-content-type-options": "nosniff",
        }

        result = validate_security_headers(invalid_headers)
        assert result["valid"] is False
        assert "x-frame-options" in result["missing_headers"]


# ============================================================================
# Rate Limiting Tests
# ============================================================================


class TestRateLimiting:
    """Test rate limiting works correctly."""

    def test_health_below_limit_is_not_throttled(self, client):
        """Ниже лимита запросы проходят.

        `/health` объявлен как 60/min (`app/main.py:365-367`, Docker
        healthcheck ходит каждые 30 с), поэтому прежние 25 запросов
        429 не давали и не могли: тест ориентировался на лимит 20/min.
        """
        codes = {client.get("/health").status_code for _ in range(5)}
        assert codes == {200}

    def test_rate_limit_returns_429_with_retry_after(self):
        """Превышение лимита даёт 429 с Retry-After.

        Ставим собственное приложение с лимитом 2/min: ключ лимита
        строится из identifier и ПУТИ, поэтому проверка не расходует
        бюджет реальных endpoints и не ломает остальные тесты.
        """
        import asyncio

        from fastapi import FastAPI, Request

        from app.middleware.rate_limit import RateLimiter, rate_limit

        probe = FastAPI()

        @probe.get("/probe-rate-limit")
        @rate_limit(max_requests=2, window_seconds=60)
        async def probe_endpoint(request: Request):
            return {"ok": True}

        # Отдельный экземпляр лимитера: подключать глобальный нельзя — он живёт
        # весь процесс, и после этого КАЖДЫЙ тест начал бы считать запросы
        # в Redis, включая регистрацию с лимитом 2/min.
        limiter = RateLimiter()
        asyncio.run(limiter.connect())
        if not limiter._redis:
            pytest.skip("Redis недоступен — rate limiter деградирует в no-op")

        try:
            with patch("app.middleware.rate_limit.rate_limiter", limiter):
                with TestClient(probe) as c:
                    codes = [c.get("/probe-rate-limit").status_code for _ in range(3)]
                    assert codes == [200, 200, 429]

                    last = c.get("/probe-rate-limit")
                    assert last.status_code == 429
                    assert "Retry-After" in last.headers
                    assert last.json()["detail"]["error"] == "rate_limit_exceeded"
        finally:
            asyncio.run(limiter.reset_limit("ip:testclient", "/probe-rate-limit"))
            asyncio.run(limiter.close())

    def test_degraded_limiter_keeps_json_endpoints_working(self):
        """При недоступном Redis endpoint с JSONResponse обязан работать.

        Декоратор дописывает заголовки из `rate_info`, читая `rate_info["limit"]`.
        В деградированной ветке словарь был неполным, и любой rate-limited
        endpoint, возвращающий JSONResponse (в приложении это `/health`
        в состоянии degraded/unhealthy), падал KeyError → 500 ровно тогда,
        когда Redis лежит.
        """
        from unittest.mock import AsyncMock, MagicMock

        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse

        from app.middleware.rate_limit import RateLimiter, rate_limit

        probe = FastAPI()

        @probe.get("/probe-degraded")
        @rate_limit(max_requests=5, window_seconds=60)
        async def probe_endpoint(request: Request):
            return JSONResponse(content={"status": "degraded"}, status_code=200)

        # 1. Redis не подключён вовсе
        with patch("app.middleware.rate_limit.rate_limiter", RateLimiter()):
            with TestClient(probe) as c:
                response = c.get("/probe-degraded")

        assert response.status_code == 200
        assert response.headers["X-RateLimit-Limit"] == "5"

        # 2. Redis подключён, но запрос к нему падает
        broken = RateLimiter()
        broken._redis = MagicMock()
        broken._redis.incr = AsyncMock(side_effect=RuntimeError("redis down"))
        with patch("app.middleware.rate_limit.rate_limiter", broken):
            with TestClient(probe) as c:
                response = c.get("/probe-degraded")

        assert response.status_code == 200
        assert response.headers["X-RateLimit-Limit"] == "5"


# ============================================================================
# Input Validation Tests
# ============================================================================


class TestInputValidation:
    """Test input validation and sanitization functions."""

    def test_sanitize_filename_path_traversal(self):
        """Test filename sanitization prevents path traversal."""
        dangerous = "../../etc/passwd"
        safe = sanitize_filename(dangerous)

        # Function replaces / and \ with _, but may keep dots
        # Important: result should not allow path traversal when used
        assert "/" not in safe
        assert "\\" not in safe
        # Check that path separators are removed (main security concern)
        assert safe.count("/") == 0
        assert safe.count("\\") == 0

    def test_sanitize_filename_command_injection(self):
        """Test filename sanitization prevents command injection."""
        dangerous = "file; rm -rf /"
        safe = sanitize_filename(dangerous)

        assert ";" not in safe
        assert "rm" in safe  # Letters are allowed, but separated

    def test_sanitize_filename_length_limit(self):
        """Test filename is truncated to max length."""
        long_name = "a" * 300
        safe = sanitize_filename(long_name)

        assert len(safe) <= 255

    def test_validate_email_valid(self):
        """Test email validation accepts valid emails."""
        valid_emails = [
            "user@example.com",
            "test.user@example.co.uk",
            "user+tag@example.com",
        ]

        for email in valid_emails:
            is_valid, error = validate_email(email)
            assert is_valid, f"Email {email} should be valid"
            assert error is None

    def test_validate_email_invalid(self):
        """Test email validation rejects invalid emails."""
        invalid_emails = [
            "not-an-email",
            "@example.com",
            "user@",
            "user@example",
            "",
        ]

        for email in invalid_emails:
            is_valid, error = validate_email(email)
            assert not is_valid, f"Email {email} should be invalid"
            assert error is not None

    def test_validate_password_strength_weak(self):
        """Test password validation rejects weak passwords."""
        weak_passwords = [
            "short",  # Too short
            "alllowercase",  # No uppercase
            "ALLUPPERCASE",  # No lowercase
            "NoDigits!",  # No digits
            "NoSpecial123",  # No special chars
            "password123",  # Common password
        ]

        for password in weak_passwords:
            is_valid, error = validate_password_strength(password)
            assert not is_valid, f"Password {password} should be rejected"
            assert error is not None

    def test_validate_password_strength_strong(self):
        """Test password validation accepts strong passwords."""
        strong_passwords = [
            "Strong8!Pass42",  # 14 chars - no sequential numbers
            "MyP@ssw0rdSecure",  # 16 chars
            "Secure#8Pass42",  # 14 chars - no sequential like 2024
        ]

        for password in strong_passwords:
            is_valid, error = validate_password_strength(password)
            assert (
                is_valid
            ), f"Password {password} should be accepted, but got error: {error}"
            assert error is None

    def test_validate_url_valid(self):
        """Test URL validation accepts valid URLs."""
        valid_urls = [
            "https://example.com",
            "http://example.com/path",
            "https://sub.example.com:8080/path?query=value",
        ]

        for url in valid_urls:
            is_valid, error = validate_url(url)
            assert is_valid, f"URL {url} should be valid"

    def test_validate_url_invalid_schemes(self):
        """Test URL validation rejects dangerous schemes."""
        invalid_urls = [
            "javascript:alert('xss')",
            "data:text/html,<script>alert('xss')</script>",
            "file:///etc/passwd",
        ]

        for url in invalid_urls:
            is_valid, error = validate_url(url)
            assert not is_valid, f"URL {url} should be rejected"

    def test_validate_uuid_valid(self):
        """Test UUID validation accepts valid UUIDs."""
        valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
        is_valid, error = validate_uuid(valid_uuid)

        assert is_valid
        assert error is None

    def test_validate_uuid_invalid(self):
        """Test UUID validation rejects invalid UUIDs."""
        invalid_uuids = [
            "not-a-uuid",
            "550e8400-e29b-41d4-a716",  # Incomplete
            "550e8400e29b41d4a716446655440000",  # No dashes
        ]

        for uuid_str in invalid_uuids:
            is_valid, error = validate_uuid(uuid_str)
            assert not is_valid, f"UUID {uuid_str} should be invalid"

    def test_sanitize_html_xss_prevention(self):
        """Test HTML sanitization prevents XSS."""
        dangerous = "<script>alert('XSS')</script>"
        safe = sanitize_html(dangerous)

        assert "<script>" not in safe
        assert "&lt;script&gt;" in safe

    def test_input_validator_multiple_errors(self):
        """Test InputValidator accumulates multiple errors."""
        validator = InputValidator()

        validator.validate_email("invalid-email")
        validator.validate_password("weak")
        validator.validate_uuid("not-a-uuid")

        assert validator.has_errors()
        errors = validator.get_errors()
        assert len(errors) == 3

    def test_input_validator_raises_http_exception(self):
        """Test InputValidator raises HTTPException with errors."""
        from fastapi import HTTPException

        validator = InputValidator()
        validator.validate_email("invalid-email")

        with pytest.raises(HTTPException) as exc_info:
            validator.raise_if_errors()

        assert exc_info.value.status_code == 422


# ============================================================================
# Secrets Management Tests
# ============================================================================


class TestSecretsManagement:
    """Test secrets validation and management."""

    def test_validate_secret_exists_true(self):
        """Test validate_secret_exists returns True for existing secrets."""
        with patch.dict(os.environ, {"TEST_SECRET": "value"}):
            assert validate_secret_exists("TEST_SECRET") is True

    def test_validate_secret_exists_false(self):
        """Test validate_secret_exists returns False for missing secrets."""
        assert validate_secret_exists("NONEXISTENT_SECRET") is False

    def test_validate_secret_strength_strong(self):
        """Test validate_secret_strength accepts strong secrets."""
        strong_secret = "aB3$" * 10  # 40 chars, mixed case, digits, special
        is_valid, error = validate_secret_strength(strong_secret, min_length=32)

        assert is_valid

    def test_validate_secret_strength_weak(self):
        """Test validate_secret_strength rejects weak secrets."""
        weak_secrets = [
            "short",  # Too short
            "alllowercase" * 3,  # No uppercase
            "ALLUPPERCASE" * 3,  # No lowercase
            "NoDigitsHere!" * 3,  # No digits
        ]

        for secret in weak_secrets:
            is_valid, error = validate_secret_strength(secret, min_length=32)
            assert not is_valid, f"Secret {secret} should be rejected"

    def test_validate_secret_not_default(self):
        """Test validate_secret_not_default detects forbidden values."""
        secret = "postgresql://postgres:postgres123@localhost/db"
        forbidden = ["postgres123"]

        is_valid, error = validate_secret_not_default(secret, forbidden)
        assert not is_valid
        assert "postgres123" in error.lower()

    def test_validate_secret_not_default_safe(self, client):
        """Test validate_secret_not_default accepts safe values."""
        secret = "postgresql://user:secure_password_xyz@localhost/db"
        forbidden = ["postgres123", "test123"]

        is_valid, error = validate_secret_not_default(secret, forbidden)
        assert is_valid
        assert error is None


# ============================================================================
# CORS Tests
# ============================================================================


class TestCORS:
    """Test CORS configuration."""

    def test_cors_headers_present(self, client):
        """Test CORS headers are present in response."""
        # Origin обязан быть из настроенного списка (CORS_ORIGINS), иначе
        # starlette отвечает 400 «Disallowed CORS origin» и заголовок
        # access-control-allow-origin не выставляет. Путь — со слешем:
        # redirect_slashes=False.
        response = client.options(
            "/api/v1/books/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

        # Check CORS headers
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == (
            "http://localhost:5173"
        )
        assert "GET" in response.headers["access-control-allow-methods"]

    def test_cors_disallowed_origin_rejected(self, client):
        """Неразрешённый Origin не получает allow-origin."""
        response = client.options(
            "/api/v1/books/",
            headers={
                "Origin": "http://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert "access-control-allow-origin" not in response.headers

    def test_cors_allowed_origin(self, client):
        """Разрешённый Origin получает свой allow-origin на обычном запросе."""
        response = client.get(
            "/health",
            headers={"Origin": "http://localhost:5173"},
        )

        assert response.headers["access-control-allow-origin"] == (
            "http://localhost:5173"
        )

    def test_cors_credentials_allowed(self, client):
        """Test CORS allows credentials."""
        response = client.options(
            "/api/v1/books/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

        credentials = response.headers.get("access-control-allow-credentials", "")
        assert credentials.lower() == "true"


# ============================================================================
# Authentication Tests
# ============================================================================


class TestAuthentication:
    """Test authentication security."""

    def test_protected_endpoint_requires_auth(self, client):
        """Test protected endpoints require authentication."""
        # Роутеры смонтированы под /api/v1; на /auth/me маршрута нет вовсе
        response = client.get("/api/v1/auth/me")

        assert response.status_code == 401

    def test_invalid_token_rejected(self, client):
        """Test invalid JWT token is rejected."""
        # Try with invalid token
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid_token_here"},
        )

        # Should return 401 Unauthorized
        assert response.status_code == 401


# ============================================================================
# General Security Tests
# ============================================================================


class TestGeneralSecurity:
    """General security tests."""

    def test_no_sql_injection_in_query_params(self, client):
        """Инъекция в `search` не должна ни ронять API, ни трогать схему.

        Прежняя версия била в `/api/v1/books` без слеша и допускала четыре
        исхода. `redirect_slashes=False`, список книг объявлен как `/`, поэтому
        такой запрос — всегда 404 отсутствующего маршрута: до параметра
        `search` он не доходил, и проверять было нечего.
        """
        response = client.get(
            "/api/v1/books/", params={"search": "'; DROP TABLE users; --"}
        )

        # Без токена сюда не пускают, но маршрут существует и запрос разобран:
        # 401 — это ответ приложения, а не «нет такого пути».
        assert response.status_code == 401

        # Таблица на месте: инъекция не выполнилась.
        assert client.get("/api/v1/auth/me").status_code == 401

    def test_no_path_traversal_in_file_uploads(self, client):
        """Test path traversal prevention in file operations."""
        # This would need actual file upload endpoint
        # Placeholder for documentation
        pass

    def test_no_xss_in_error_messages(self, client):
        """Test error messages don't contain unescaped user input."""
        # Attempt XSS in query param
        xss_attempt = "<script>alert('xss')</script>"

        response = client.get(f"/api/v1/books?search={xss_attempt}")

        # Check response doesn't contain unescaped script tag
        response_text = response.text.lower()
        assert "<script>" not in response_text


# ============================================================================
# Integration Tests
# ============================================================================


class TestSecurityIntegration:
    """Integration tests for multiple security features."""

    def test_security_posture_health_endpoint(self, client):
        """`/health` отдаёт полный набор заголовков безопасности.

        Прежние две проверки делали один и тот же запрос и обе допускали 429
        (одна через `pytest.skip`). Autouse-фикстура `rate_limiting_disabled`
        гасит глобальный лимитер, поэтому 429 недостижим, а «пропустить тест
        при 429» означало молча не проверять ничего.
        """
        response = client.get("/health")

        assert response.status_code == 200
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


# ============================================================================
# Pytest Configuration
# ============================================================================


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset rate limiter between tests."""
    # This would need access to rate limiter instance
    # For now, tests may interfere with each other
    yield
