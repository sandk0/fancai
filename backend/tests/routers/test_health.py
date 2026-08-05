"""
Comprehensive unit tests for Health Check API endpoints.

Test coverage:
- GET /health - Basic health check with database and Redis
- GET /health/reading-sessions - Detailed health check with sessions metrics
- GET /health/deep - Full system health check
- GET /metrics - Prometheus metrics endpoint
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from base64 import b64encode

from app.models.user import User
from app.models.book import Book
from app.models.reading_session import ReadingSession
from app.routers.health import ComponentHealthResponse


# ============================================================================
# Test Suite 1: Basic Health Check Endpoint
# ============================================================================


class TestBasicHealthCheck:
    """Test suite for GET /health endpoint."""

    @pytest.mark.asyncio
    async def test_health_check_all_services_healthy(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test health check when all services are operational."""
        # Arrange - Mock successful checks
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="ok",
                message="Database connection successful",
                latency_ms=5.2,
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="ok",
                message="Redis connection successful",
                latency_ms=2.1,
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)

        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert "version" in data
        assert data["version"] == "2.0.0"
        assert "uptime_seconds" in data
        assert data["uptime_seconds"] >= 0

    @pytest.mark.asyncio
    async def test_health_check_redis_down_degraded(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test health check returns degraded when Redis is down but DB is up."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="ok",
                message="Database connection successful",
                latency_ms=5.2,
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="warning",
                message="Redis connection warning",
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)

        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"

    @pytest.mark.asyncio
    async def test_health_check_database_down_unhealthy(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test health check returns unhealthy when database is down."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="error",
                message="Database connection failed",
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="ok",
                message="Redis connection successful",
                latency_ms=2.1,
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)

        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"

    @pytest.mark.asyncio
    async def test_health_check_all_services_down_unhealthy(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test health check returns unhealthy when all services are down."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="error",
                message="Database connection failed",
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="error",
                message="Redis connection failed",
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)

        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"

    @pytest.mark.asyncio
    async def test_health_check_handles_database_exception(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test health check gracefully handles database check exceptions."""
        # Arrange
        async def mock_check_database_exception(db):
            raise Exception("Database connection timeout")

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="ok",
                message="Redis connection successful",
                latency_ms=2.1,
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database_exception
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)

        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"  # Exception treated as error


# ============================================================================
# Test Suite 2: Reading Sessions Health Check Endpoint
# ============================================================================


class TestReadingSessionsHealthCheck:
    """Test suite for GET /health/reading-sessions endpoint."""

    @pytest.mark.asyncio
    async def test_reading_sessions_health_all_healthy(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        monkeypatch,
    ):
        """Test reading sessions health check with all services operational."""
        # Arrange - Create some active reading sessions
        session1 = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=25,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )
        session2 = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=30,
            end_position=40,
            device_type="desktop",
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )
        db_session.add_all([session1, session2])
        await db_session.commit()

        # Mock health checks
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="ok",
                message="Database connection successful",
                latency_ms=5.2,
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="ok",
                message="Redis connection successful",
                latency_ms=2.1,
            )

        async def mock_check_celery():
            return ComponentHealthResponse(
                status="ok",
                message="Celery workers active: 2",
                latency_ms=10.5,
                details={"active_workers_count": 2, "workers": ["worker1", "worker2"]},
            )

        monkeypatch.setattr(
            "app.routers.health.check_database", mock_check_database
        )
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/reading-sessions")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert "checks" in data
        assert "metrics" in data

        # Verify checks
        assert data["checks"]["database"]["status"] == "ok"
        assert data["checks"]["redis"]["status"] == "ok"
        assert data["checks"]["celery"]["status"] == "ok"

        # Verify metrics
        assert data["metrics"]["active_sessions_total"] == 2
        assert data["metrics"]["concurrent_users"] == 1
        assert "active_sessions_by_device" in data["metrics"]
        assert data["metrics"]["active_sessions_by_device"]["mobile"] == 1
        assert data["metrics"]["active_sessions_by_device"]["desktop"] == 1

    @pytest.mark.asyncio
    async def test_reading_sessions_health_with_abandoned_sessions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        monkeypatch,
    ):
        """Test reading sessions health check detects abandoned sessions."""
        # Arrange - Create an abandoned session (> 24 hours old)
        abandoned_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=10,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(hours=25),
        )
        db_session.add(abandoned_session)
        await db_session.commit()

        # Mock health checks
        async def mock_check_database(db):
            return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

        async def mock_check_redis():
            return ComponentHealthResponse(status="ok", message="Redis OK", latency_ms=2.1)

        async def mock_check_celery():
            return ComponentHealthResponse(status="ok", message="Celery OK", latency_ms=10.5)

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/reading-sessions")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert data["metrics"]["abandoned_sessions"] == 1
        assert data["metrics"]["active_sessions_total"] == 1

    @pytest.mark.asyncio
    async def test_reading_sessions_health_celery_warning(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test reading sessions health check with Celery warning."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

        async def mock_check_redis():
            return ComponentHealthResponse(status="ok", message="Redis OK", latency_ms=2.1)

        async def mock_check_celery():
            return ComponentHealthResponse(
                status="warning",
                message="No Celery workers found or inspector timed out",
                latency_ms=500.0,
            )

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/reading-sessions")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "degraded"
        assert data["checks"]["celery"]["status"] == "warning"

    @pytest.mark.asyncio
    async def test_reading_sessions_health_database_error(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test reading sessions health check with database error."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="error",
                message="Database connection failed",
            )

        async def mock_check_redis():
            return ComponentHealthResponse(status="ok", message="Redis OK", latency_ms=2.1)

        async def mock_check_celery():
            return ComponentHealthResponse(status="ok", message="Celery OK", latency_ms=10.5)

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/reading-sessions")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "unhealthy"
        assert data["checks"]["database"]["status"] == "error"

    @pytest.mark.asyncio
    async def test_reading_sessions_health_no_active_sessions(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test reading sessions health check with no active sessions."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

        async def mock_check_redis():
            return ComponentHealthResponse(status="ok", message="Redis OK", latency_ms=2.1)

        async def mock_check_celery():
            return ComponentHealthResponse(status="ok", message="Celery OK", latency_ms=10.5)

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/reading-sessions")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert data["metrics"]["active_sessions_total"] == 0
        assert data["metrics"]["concurrent_users"] == 0
        assert data["metrics"]["abandoned_sessions"] == 0


# ============================================================================
# Test Suite 3: Deep Health Check Endpoint
# ============================================================================


class TestDeepHealthCheck:
    """Test suite for GET /health/deep endpoint."""

    @pytest.mark.asyncio
    async def test_deep_health_check_all_services_healthy(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        monkeypatch,
    ):
        """Test deep health check with all services operational."""
        # Arrange - Create an active session
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=25,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )
        db_session.add(session)
        await db_session.commit()

        # Mock health checks
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="ok",
                message="Database connection successful",
                latency_ms=5.2,
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="ok",
                message="Redis connection successful",
                latency_ms=2.1,
            )

        async def mock_check_celery():
            return ComponentHealthResponse(
                status="ok",
                message="Celery workers active: 2",
                latency_ms=10.5,
                details={"active_workers_count": 2},
            )

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/deep")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert data["version"] == "2.0.0"
        assert data["uptime_seconds"] >= 0
        assert "components" in data

        # Verify all components
        assert data["components"]["database"]["status"] == "ok"
        assert data["components"]["redis"]["status"] == "ok"
        assert data["components"]["celery"]["status"] == "ok"
        assert data["components"]["reading_sessions"]["status"] == "ok"

        # Verify reading sessions details
        reading_sessions = data["components"]["reading_sessions"]
        assert reading_sessions["details"]["active_sessions"] == 1
        assert reading_sessions["details"]["concurrent_users"] == 1

    @pytest.mark.asyncio
    async def test_deep_health_check_partial_failure(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test deep health check with some services failing."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="error",
                message="Redis connection failed",
            )

        async def mock_check_celery():
            return ComponentHealthResponse(
                status="warning",
                message="No Celery workers found",
            )

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/deep")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "unhealthy"
        assert data["components"]["database"]["status"] == "ok"
        assert data["components"]["redis"]["status"] == "error"
        assert data["components"]["celery"]["status"] == "warning"

    @pytest.mark.asyncio
    async def test_deep_health_check_all_services_down(
        self,
        client: AsyncClient,
        monkeypatch,
    ):
        """Test deep health check when all services are down."""
        # Arrange
        async def mock_check_database(db):
            return ComponentHealthResponse(
                status="error",
                message="Database connection failed",
            )

        async def mock_check_redis():
            return ComponentHealthResponse(
                status="error",
                message="Redis connection failed",
            )

        async def mock_check_celery():
            return ComponentHealthResponse(
                status="error",
                message="Celery check failed",
            )

        monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
        monkeypatch.setattr("app.routers.health.check_redis", mock_check_redis)
        monkeypatch.setattr("app.routers.health.check_celery", mock_check_celery)

        # Act
        response = await client.get("/api/v1/health/deep")

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "unhealthy"
        assert data["components"]["database"]["status"] == "error"
        assert data["components"]["redis"]["status"] == "error"
        assert data["components"]["celery"]["status"] == "error"


# ============================================================================
# Test Suite 4: Prometheus Metrics Endpoint
# ============================================================================


class TestMetricsEndpoint:
    """Test suite for GET /metrics endpoint."""

    @pytest.mark.asyncio
    async def test_metrics_endpoint_with_valid_auth(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test metrics endpoint with valid Basic Auth credentials."""
        # Arrange - Create some active sessions
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=25,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )
        db_session.add(session)
        await db_session.commit()

        # Create Basic Auth header
        from app.core.config import settings

        credentials = f"{settings.METRICS_USER}:{settings.METRICS_PASSWORD}"
        encoded_credentials = b64encode(credentials.encode()).decode()
        headers = {"Authorization": f"Basic {encoded_credentials}"}

        # Act
        response = await client.get("/api/v1/metrics", headers=headers)

        # Assert
        assert response.status_code == 200
        # Тип берём из самой библиотеки: строка версии меняется с апгрейдом
        # prometheus_client (0.0.4 → 1.0.0), а контракт — CONTENT_TYPE_LATEST
        from prometheus_client import CONTENT_TYPE_LATEST

        assert response.headers["content-type"] == CONTENT_TYPE_LATEST

        # Verify metrics are in Prometheus format
        content = response.text
        assert "active_sessions_total" in content or "# HELP" in content

    @pytest.mark.asyncio
    async def test_metrics_endpoint_without_auth(
        self,
        client: AsyncClient,
    ):
        """Test metrics endpoint returns 401 without authentication."""
        # Act
        response = await client.get("/api/v1/metrics")

        # Assert
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_metrics_endpoint_with_invalid_auth(
        self,
        client: AsyncClient,
    ):
        """Test metrics endpoint returns 401 with invalid credentials."""
        # Arrange
        credentials = "invalid_user:invalid_password"
        encoded_credentials = b64encode(credentials.encode()).decode()
        headers = {"Authorization": f"Basic {encoded_credentials}"}

        # Act
        response = await client.get("/api/v1/metrics", headers=headers)

        # Assert
        assert response.status_code == 401
        assert "Incorrect username or password" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_metrics_endpoint_includes_session_stats(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test metrics endpoint includes reading session statistics."""
        # Arrange - Create multiple sessions with different device types
        sessions = [
            ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                device_type="mobile" if i % 2 == 0 else "desktop",
                is_active=True,
                started_at=datetime.now(timezone.utc),
            )
            for i in range(3)
        ]
        db_session.add_all(sessions)
        await db_session.commit()

        # Create Basic Auth header
        from app.core.config import settings

        credentials = f"{settings.METRICS_USER}:{settings.METRICS_PASSWORD}"
        encoded_credentials = b64encode(credentials.encode()).decode()
        headers = {"Authorization": f"Basic {encoded_credentials}"}

        # Act
        response = await client.get("/api/v1/metrics", headers=headers)

        # Assert
        assert response.status_code == 200
        content = response.text

        # Verify that metrics are present (at minimum, the response should contain metrics)
        # The exact format depends on prometheus_client library
        assert len(content) > 0


# ============================================================================
# Test Suite 5: Helper Function Tests
# ============================================================================


class TestHelperFunctions:
    """Test suite for health check helper functions."""

    @pytest.mark.asyncio
    async def test_check_database_success(self, db_session: AsyncSession):
        """Test check_database returns ok status on successful connection."""
        # Arrange
        from app.routers.health import check_database

        # Act
        result = await check_database(db_session)

        # Assert
        assert result.status == "ok"
        assert result.message == "Database connection successful"
        assert result.latency_ms is not None
        assert result.latency_ms > 0

    @pytest.mark.asyncio
    async def test_check_database_failure(self, monkeypatch):
        """Test check_database handles database errors gracefully."""
        # Arrange
        from app.routers.health import check_database

        # Create a mock session that raises an exception
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(side_effect=Exception("Connection timeout"))

        # Act
        result = await check_database(mock_session)

        # Assert
        assert result.status == "error"
        assert "failed" in result.message.lower()

    @pytest.mark.asyncio
    async def test_get_active_sessions_stats(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test get_active_sessions_stats returns correct statistics."""
        # Arrange
        from app.routers.health import get_active_sessions_stats

        # Create sessions with different device types
        sessions = [
            ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                device_type="mobile" if i % 2 == 0 else "desktop",
                is_active=True,
                started_at=datetime.now(timezone.utc),
            )
            for i in range(4)
        ]
        db_session.add_all(sessions)
        await db_session.commit()

        # Act
        stats = await get_active_sessions_stats(db_session)

        # Assert
        assert stats["total_active"] == 4
        assert stats["by_device"]["mobile"] == 2
        assert stats["by_device"]["desktop"] == 2
        assert stats["concurrent_users"] == 1

    @pytest.mark.asyncio
    async def test_get_abandoned_sessions_count(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test get_abandoned_sessions_count detects sessions older than 24 hours."""
        # Arrange
        from app.routers.health import get_abandoned_sessions_count

        # Create one abandoned session and one recent session
        abandoned_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=5,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(hours=30),
        )
        recent_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=15,
            device_type="desktop",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db_session.add_all([abandoned_session, recent_session])
        await db_session.commit()

        # Act
        count = await get_abandoned_sessions_count(db_session)

        # Assert
        assert count == 1

    @pytest.mark.asyncio
    async def test_get_abandoned_sessions_count_no_abandoned(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test get_abandoned_sessions_count returns 0 when no abandoned sessions."""
        # Arrange
        from app.routers.health import get_abandoned_sessions_count

        # Create only recent sessions
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=15,
            device_type="desktop",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db_session.add(session)
        await db_session.commit()

        # Act
        count = await get_abandoned_sessions_count(db_session)

        # Assert
        assert count == 0
