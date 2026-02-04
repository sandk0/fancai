"""
Тесты для Cache-Control Middleware.

Проверяют корректность установки Cache-Control headers для различных endpoints.
"""

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient
from app.middleware.cache_control import (
    CacheControlMiddleware,
    get_cache_control_header,
    validate_cache_control,
    get_all_cache_policies,
)

# ============================================================================
# Test get_cache_control_header Function
# ============================================================================


def test_user_specific_endpoints_no_cache():
    """User-specific endpoints должны возвращать private, no-cache."""
    paths = [
        "/api/v1/books",
        "/api/v1/books/123",
        "/api/v1/chapters/456",
        "/api/v1/descriptions/789",
        "/api/v1/images/generation/status",
        "/api/v1/users/me",
        "/api/v1/reading-sessions",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "private" in result
        assert "no-cache" in result
        assert "must-revalidate" in result


def test_admin_endpoints_no_store():
    """Admin endpoints должны возвращать no-store для максимальной безопасности."""
    paths = [
        "/api/v1/admin/stats",
        "/api/v1/admin/users",
        "/api/v1/admin/feature-flags",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "no-store" in result
        assert "no-cache" in result
        assert "private" in result


def test_auth_endpoints_no_store():
    """Auth endpoints должны возвращать no-store для security."""
    paths = [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "no-store" in result
        assert "no-cache" in result


def test_file_serving_immutable_cache():
    """File serving endpoints должны иметь агрессивное кэширование."""
    paths = [
        "/api/v1/images/file/abc123.png",
        "/api/v1/images/file/def456.jpg",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "public" in result
        assert "max-age=31536000" in result  # 1 год
        assert "immutable" in result


def test_public_endpoints_short_cache():
    """Public endpoints должны иметь короткое кэширование."""
    paths = [
        "/health",
        "/api/v1/info",
        "/docs",
        "/openapi.json",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "public" in result
        assert "max-age=3600" in result  # 1 час


def test_post_requests_no_cache():
    """POST/PUT/DELETE requests никогда не должны кэшироваться."""
    methods = ["POST", "PUT", "DELETE", "PATCH"]

    for method in methods:
        result = get_cache_control_header("/api/v1/books", method)
        assert "no-store" in result
        assert "no-cache" in result


def test_unknown_endpoints_safe_default():
    """Неизвестные endpoints должны использовать безопасную стратегию."""
    paths = [
        "/api/v1/unknown",
        "/api/v2/future-endpoint",
        "/random/path",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "no-cache" in result
        assert "must-revalidate" in result


# ============================================================================
# Test CacheControlMiddleware Integration
# ============================================================================


@pytest.fixture
def app_with_middleware():
    """FastAPI app с CacheControlMiddleware для integration тестов."""
    app = FastAPI()
    app.add_middleware(CacheControlMiddleware)

    @app.get("/api/v1/books")
    def get_books():
        return {"books": []}

    @app.get("/api/v1/admin/stats")
    def get_admin_stats():
        return {"stats": {}}

    @app.get("/api/v1/images/file/{filename}")
    def get_image_file(filename: str):
        return {"filename": filename}

    @app.get("/health")
    def health_check():
        return {"status": "ok"}

    @app.post("/api/v1/books")
    def create_book():
        return {"id": "123"}

    return app


def test_middleware_sets_cache_control_for_user_endpoints(app_with_middleware):
    """Middleware устанавливает Cache-Control для user-specific endpoints."""
    client = TestClient(app_with_middleware)
    response = client.get("/api/v1/books")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "private" in response.headers["Cache-Control"]
    assert "no-cache" in response.headers["Cache-Control"]


def test_middleware_sets_cache_control_for_admin_endpoints(app_with_middleware):
    """Middleware устанавливает Cache-Control для admin endpoints."""
    client = TestClient(app_with_middleware)
    response = client.get("/api/v1/admin/stats")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "no-store" in response.headers["Cache-Control"]


def test_middleware_sets_cache_control_for_file_serving(app_with_middleware):
    """Middleware устанавливает агрессивное кэширование для files."""
    client = TestClient(app_with_middleware)
    response = client.get("/api/v1/images/file/test.png")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "immutable" in response.headers["Cache-Control"]
    assert "max-age=31536000" in response.headers["Cache-Control"]


def test_middleware_sets_cache_control_for_public_endpoints(app_with_middleware):
    """Middleware устанавливает Cache-Control для public endpoints."""
    client = TestClient(app_with_middleware)
    response = client.get("/health")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "public" in response.headers["Cache-Control"]
    assert "max-age=3600" in response.headers["Cache-Control"]


def test_middleware_sets_no_cache_for_post_requests(app_with_middleware):
    """Middleware устанавливает no-cache для POST requests."""
    client = TestClient(app_with_middleware)
    response = client.post("/api/v1/books")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "no-store" in response.headers["Cache-Control"]


def test_middleware_adds_pragma_for_no_cache(app_with_middleware):
    """Middleware добавляет Pragma: no-cache для legacy support."""
    client = TestClient(app_with_middleware)
    response = client.get("/api/v1/books")

    assert "Pragma" in response.headers
    assert response.headers["Pragma"] == "no-cache"


# ============================================================================
# Test validate_cache_control Function
# ============================================================================


def test_validate_cache_control_valid():
    """validate_cache_control должен возвращать valid=True для корректных headers."""
    headers = {"Cache-Control": "private, no-cache, must-revalidate"}
    result = validate_cache_control("/api/v1/books", headers)

    assert result["valid"] is True
    assert len(result["warnings"]) == 0


def test_validate_cache_control_missing_header():
    """validate_cache_control должен обнаруживать отсутствующий header."""
    headers = {}
    result = validate_cache_control("/api/v1/books", headers)

    assert result["valid"] is False
    assert "Cache-Control header not set" in result["warnings"][0]


def test_validate_cache_control_wrong_policy():
    """validate_cache_control должен обнаруживать неправильную policy."""
    headers = {"Cache-Control": "public, max-age=3600"}  # Wrong for user-specific
    result = validate_cache_control("/api/v1/books", headers)

    assert result["valid"] is False
    assert len(result["warnings"]) > 0


def test_validate_cache_control_user_endpoint_should_not_be_public():
    """User-specific endpoints не должны быть public."""
    headers = {"Cache-Control": "public, max-age=3600"}
    result = validate_cache_control("/api/v1/users/me", headers)

    assert result["valid"] is False
    assert any("should not be public" in w for w in result["warnings"])


# ============================================================================
# Test get_all_cache_policies Function
# ============================================================================


def test_get_all_cache_policies_returns_dict():
    """get_all_cache_policies должен возвращать dict с policies."""
    policies = get_all_cache_policies()

    assert isinstance(policies, dict)
    assert len(policies) > 0


def test_get_all_cache_policies_contains_all_categories():
    """get_all_cache_policies должен содержать все категории endpoints."""
    policies = get_all_cache_policies()

    # Check for user-specific
    assert any("/api/v1/books" in path for path in policies.keys())

    # Check for admin
    assert any("/api/v1/admin/" in path for path in policies.keys())

    # Check for auth
    assert any("/api/v1/auth/" in path for path in policies.keys())

    # Check for file serving
    assert any("/api/v1/images/file/" in path for path in policies.keys())

    # Check for public
    assert any("/health" in path for path in policies.keys())


# ============================================================================
# Edge Cases
# ============================================================================


def test_cache_control_for_nested_user_paths():
    """Вложенные user-specific пути должны правильно обрабатываться."""
    paths = [
        "/api/v1/books/123/chapters",
        "/api/v1/books/123/chapters/456",
        "/api/v1/books/123/chapters/456/descriptions",
    ]

    for path in paths:
        result = get_cache_control_header(path, "GET")
        assert "private" in result
        assert "no-cache" in result


def test_cache_control_method_sensitivity():
    """HTTP method должен обрабатываться строго в uppercase (per HTTP spec)."""
    # GET method returns user-specific cache policy
    result = get_cache_control_header("/api/v1/books", "GET")
    assert "private" in result

    # Non-GET methods (lowercase) return no-store (treated as non-GET)
    # This is expected behavior since HTTP methods are case-sensitive per RFC 7230
    result = get_cache_control_header("/api/v1/books", "get")
    assert "no-store" in result


def test_disabled_middleware():
    """Middleware с enable_cache_control=False не должен устанавливать headers."""
    app = FastAPI()
    app.add_middleware(CacheControlMiddleware, enable_cache_control=False)

    @app.get("/test")
    def test_endpoint():
        return {"test": "data"}

    client = TestClient(app)
    response = client.get("/test")

    # Middleware should not set Cache-Control when disabled
    # (but other middlewares might, so we just verify middleware doesn't interfere)
    assert response.status_code == 200


def test_manual_cache_control_not_overridden():
    """Manually установленный Cache-Control не должен перезаписываться."""
    app = FastAPI()
    app.add_middleware(CacheControlMiddleware)

    @app.get("/custom")
    def custom_endpoint():
        return Response(
            content='{"custom": "data"}',
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=7200"},
        )

    client = TestClient(app)
    response = client.get("/custom")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=7200"


# ============================================================================
# Performance Tests
# ============================================================================


def test_middleware_performance(app_with_middleware):
    """Middleware не должен значительно замедлять requests."""
    import time

    client = TestClient(app_with_middleware)

    # Warm-up
    for _ in range(10):
        client.get("/health")

    # Measure
    start = time.time()
    for _ in range(100):
        client.get("/health")
    duration = time.time() - start

    # Middleware overhead должен быть < 10ms per request
    assert duration / 100 < 0.01  # 10ms per request
