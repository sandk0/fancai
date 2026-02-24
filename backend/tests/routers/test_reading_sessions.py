"""
Comprehensive unit tests for Reading Sessions API endpoints.

Test coverage:
- POST /reading-sessions/start
- PUT /reading-sessions/{session_id}/update
- PUT /reading-sessions/{session_id}/end
- GET /reading-sessions/active
- GET /reading-sessions/history
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models.user import User
from app.models.book import Book
from app.models.reading_session import ReadingSession

# ============================================================================
# Test Suite 1: Start Session Endpoint
# ============================================================================


class TestStartSession:
    """Test suite for POST /reading-sessions/start endpoint."""

    @pytest.mark.asyncio
    async def test_start_session_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test successful start of a new reading session."""
        # Arrange
        request_data = {
            "book_id": str(test_book.id),
            "start_position": 25,
            "device_type": "mobile",
        }

        # Mock authentication
        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 201
        data = response.json()

        assert "id" in data
        assert data["user_id"] == str(test_user.id)
        assert data["book_id"] == str(test_book.id)
        assert data["start_position"] == 25
        assert data["end_position"] == 25  # Initially same as start
        assert data["device_type"] == "mobile"
        assert data["is_active"] is True
        assert data["duration_minutes"] == 0
        assert data["progress_delta"] == 0

    @pytest.mark.asyncio
    async def test_start_session_auto_closes_previous(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test that starting a new session auto-closes previous active session."""
        # Arrange - create an existing active session
        existing_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=10,
            end_position=10,
            device_type="desktop",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        )
        db_session.add(existing_session)
        await db_session.commit()
        await db_session.refresh(existing_session)

        request_data = {
            "book_id": str(test_book.id),
            "start_position": 50,
            "device_type": "mobile",
        }

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 201
        data = response.json()

        # New session created
        assert data["start_position"] == 50
        assert data["is_active"] is True

        # Check that old session was closed
        await db_session.refresh(existing_session)
        assert existing_session.is_active is False
        assert existing_session.ended_at is not None
        assert existing_session.duration_minutes > 0  # At least 30 minutes

    @pytest.mark.asyncio
    async def test_start_session_book_not_found(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        """Test starting session with non-existent book returns 404."""
        # Arrange
        non_existent_book_id = str(uuid4())
        request_data = {
            "book_id": non_existent_book_id,
            "start_position": 0,
        }

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 404
        assert "not found" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_start_session_invalid_position(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test starting session with invalid position fails validation."""
        # Arrange
        request_data = {
            "book_id": str(test_book.id),
            "start_position": 150,  # Invalid: must be 0-100
        }

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 422  # Pydantic validation error

    @pytest.mark.asyncio
    async def test_start_session_invalid_device_type(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test starting session with invalid device type fails validation."""
        # Arrange
        request_data = {
            "book_id": str(test_book.id),
            "start_position": 0,
            "device_type": "smartwatch",  # Invalid: must be mobile/tablet/desktop
        }

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_start_session_unauthorized(
        self, client: AsyncClient, test_book: Book
    ):
        """Test starting session without authentication fails."""
        # Arrange
        request_data = {
            "book_id": str(test_book.id),
            "start_position": 0,
        }

        # Act - no headers, no authentication
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data
        )

        # Assert
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_start_session_other_user_book(
        self, client: AsyncClient, db_session: AsyncSession, test_book: Book
    ):
        """Test starting session for book owned by another user fails."""
        # Arrange - create another user
        from app.services.auth_service import AuthService

        auth_service = AuthService()
        other_user = User(
            email="other@example.com",
            full_name="Other User",
            password_hash=auth_service.get_password_hash("password123"),
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)

        request_data = {
            "book_id": str(test_book.id),  # test_book belongs to test_user
            "start_position": 0,
        }

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(other_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.post(
            "/api/v1/reading-sessions/start", json=request_data, headers=headers
        )

        # Assert
        assert response.status_code == 404  # Book not found for this user


# ============================================================================
# Test Suite 2: Update Session Endpoint
# ============================================================================


class TestUpdateSession:
    """Test suite for PUT /reading-sessions/{session_id}/update endpoint."""

    @pytest_asyncio.fixture
    async def active_session(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ) -> ReadingSession:
        """Fixture: create an active reading session."""
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=20,
            end_position=20,
            device_type="tablet",
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )
        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)
        return session

    @pytest.mark.asyncio
    async def test_update_session_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        active_session: ReadingSession,
    ):
        """Test successful update of current position in session."""
        # Arrange
        request_data = {"current_position": 45}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{active_session.id}/update",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["end_position"] == 45
        assert data["progress_delta"] == 25  # 45 - 20 = 25
        assert data["is_active"] is True

        # Verify in database
        await db_session.refresh(active_session)
        assert active_session.end_position == 45

    @pytest.mark.asyncio
    async def test_update_session_not_found(self, client: AsyncClient, test_user: User):
        """Test updating non-existent session returns 404."""
        # Arrange
        non_existent_session_id = uuid4()
        request_data = {"current_position": 50}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{non_existent_session_id}/update",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_session_already_ended(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test updating inactive session returns 400."""
        # Arrange - create ended session
        ended_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=50,
            is_active=False,
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            ended_at=datetime.now(timezone.utc),
            duration_minutes=60,
        )
        db_session.add(ended_session)
        await db_session.commit()
        await db_session.refresh(ended_session)

        request_data = {"current_position": 60}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{ended_session.id}/update",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 400
        assert "inactive" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_update_session_access_denied(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        active_session: ReadingSession,
    ):
        """Test updating session of another user returns 404."""
        # Arrange - create another user
        from app.services.auth_service import AuthService

        auth_service = AuthService()
        other_user = User(
            email="other@example.com",
            full_name="Other User",
            password_hash=auth_service.get_password_hash("password123"),
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)

        request_data = {"current_position": 50}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(other_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{active_session.id}/update",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 404  # Session not found for this user

    @pytest.mark.asyncio
    async def test_update_session_invalid_position(
        self,
        client: AsyncClient,
        test_user: User,
        active_session: ReadingSession,
    ):
        """Test updating with invalid position fails validation."""
        # Arrange
        request_data = {"current_position": -10}  # Invalid: negative

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{active_session.id}/update",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 422


# ============================================================================
# Test Suite 3: End Session Endpoint
# ============================================================================


class TestEndSession:
    """Test suite for PUT /reading-sessions/{session_id}/end endpoint."""

    @pytest_asyncio.fixture
    async def active_session(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ) -> ReadingSession:
        """Fixture: create an active reading session."""
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=30,
            end_position=30,
            device_type="desktop",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=45),
        )
        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)
        return session

    @pytest.mark.asyncio
    async def test_end_session_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        active_session: ReadingSession,
    ):
        """Test successful end of a reading session."""
        # Arrange
        request_data = {"end_position": 75}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{active_session.id}/end",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["end_position"] == 75
        assert data["is_active"] is False
        assert data["ended_at"] is not None
        assert data["duration_minutes"] >= 45  # At least 45 minutes
        assert data["progress_delta"] == 45  # 75 - 30 = 45

        # Verify in database
        await db_session.refresh(active_session)
        assert active_session.is_active is False
        assert active_session.ended_at is not None
        assert active_session.end_position == 75

    @pytest.mark.asyncio
    async def test_end_session_validates_position(
        self,
        client: AsyncClient,
        test_user: User,
        active_session: ReadingSession,
    ):
        """Test ending session validates end_position >= start_position."""
        # Arrange
        request_data = {"end_position": 10}  # Less than start_position (30)

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{active_session.id}/end",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 400
        assert "must be >=" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_end_session_calculates_duration(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test that ending session correctly calculates duration."""
        # Arrange - create session started 90 minutes ago
        start_time = datetime.now(timezone.utc) - timedelta(minutes=90)
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=0,
            is_active=True,
            started_at=start_time,
        )
        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)

        request_data = {"end_position": 100}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{session.id}/end",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()

        # Duration should be approximately 90 minutes (with some tolerance)
        assert 88 <= data["duration_minutes"] <= 92

    @pytest.mark.asyncio
    async def test_end_session_idempotent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test that ending already ended session returns 400."""
        # Arrange - create already ended session
        ended_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=50,
            is_active=False,
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            ended_at=datetime.now(timezone.utc),
            duration_minutes=60,
        )
        db_session.add(ended_session)
        await db_session.commit()
        await db_session.refresh(ended_session)

        request_data = {"end_position": 60}

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.put(
            f"/api/v1/reading-sessions/{ended_session.id}/end",
            json=request_data,
            headers=headers,
        )

        # Assert
        assert response.status_code == 400
        assert "already ended" in response.json()["detail"].lower()


# ============================================================================
# Test Suite 4: Get Active Session Endpoint
# ============================================================================


class TestGetActiveSession:
    """Test suite for GET /reading-sessions/active endpoint."""

    @pytest.mark.asyncio
    async def test_get_active_session_exists(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test getting active session when one exists."""
        # Arrange - create active session
        active_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=40,
            end_position=55,
            device_type="mobile",
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
        db_session.add(active_session)
        await db_session.commit()
        await db_session.refresh(active_session)

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.get("/api/v1/reading-sessions/active", headers=headers)

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data is not None
        assert data["id"] == str(active_session.id)
        assert data["is_active"] is True
        assert data["start_position"] == 40
        assert data["end_position"] == 55
        assert data["device_type"] == "mobile"

    @pytest.mark.asyncio
    async def test_get_active_session_none(self, client: AsyncClient, test_user: User):
        """Test getting active session when none exists returns null."""
        # Arrange
        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.get("/api/v1/reading-sessions/active", headers=headers)

        # Assert
        assert response.status_code == 200
        assert response.json() is None


# ============================================================================
# Test Suite 5: Get History Endpoint
# ============================================================================


class TestGetHistory:
    """Test suite for GET /reading-sessions/history endpoint."""

    @pytest.mark.asyncio
    async def test_get_history_with_pagination(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test getting history with pagination."""
        # Arrange - create 25 sessions
        for i in range(25):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 2,
                end_position=i * 2 + 10,
                is_active=False,
                started_at=datetime.now(timezone.utc) - timedelta(days=i),
                ended_at=datetime.now(timezone.utc) - timedelta(days=i, hours=-1),
                duration_minutes=60,
            )
            db_session.add(session)
        await db_session.commit()

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act - get first page
        response = await client.get(
            "/api/v1/reading-sessions/history?page=1&page_size=10", headers=headers
        )

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert len(data["sessions"]) == 10
        assert data["total"] == 25
        assert data["page"] == 1
        assert data["page_size"] == 10
        assert data["has_next"] is True

        # Verify ordering (newest first)
        sessions = data["sessions"]
        for i in range(len(sessions) - 1):
            # Compare timestamps
            current_time = datetime.fromisoformat(
                sessions[i]["started_at"].replace("Z", "+00:00")
            )
            next_time = datetime.fromisoformat(
                sessions[i + 1]["started_at"].replace("Z", "+00:00")
            )
            assert current_time >= next_time

    @pytest.mark.asyncio
    async def test_get_history_filter_by_book(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test filtering history by specific book."""
        # Arrange - create another book
        from app.models.book import BookGenre

        other_book = Book(
            user_id=test_user.id,
            title="Other Book",
            author="Other Author",
            genre=BookGenre.SCIFI.value,
            language="ru",
            file_path="/tmp/other.epub",
            file_format="epub",
            file_size=512000,
            total_pages=50,
            is_parsed=True,
        )
        db_session.add(other_book)
        await db_session.flush()

        # Create sessions for both books
        for i in range(5):
            session1 = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                is_active=False,
                started_at=datetime.now(timezone.utc) - timedelta(days=i),
                ended_at=datetime.now(timezone.utc) - timedelta(days=i, hours=-1),
                duration_minutes=30,
            )
            session2 = ReadingSession(
                user_id=test_user.id,
                book_id=other_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                is_active=False,
                started_at=datetime.now(timezone.utc) - timedelta(days=i),
                ended_at=datetime.now(timezone.utc) - timedelta(days=i, hours=-1),
                duration_minutes=30,
            )
            db_session.add(session1)
            db_session.add(session2)

        await db_session.commit()

        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act - filter by test_book
        response = await client.get(
            f"/api/v1/reading-sessions/history?book_id={test_book.id}",
            headers=headers,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["total"] == 5
        for session in data["sessions"]:
            assert session["book_id"] == str(test_book.id)

    @pytest.mark.asyncio
    async def test_get_history_empty(self, client: AsyncClient, test_user: User):
        """Test getting history when no sessions exist."""
        # Arrange
        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.get("/api/v1/reading-sessions/history", headers=headers)

        # Assert
        assert response.status_code == 200
        data = response.json()

        assert data["sessions"] == []
        assert data["total"] == 0
        assert data["has_next"] is False

    @pytest.mark.asyncio
    async def test_get_history_invalid_book_id(
        self, client: AsyncClient, test_user: User
    ):
        """Test filtering with invalid book_id format returns 400."""
        # Arrange
        from app.core.auth import create_access_token

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act
        response = await client.get(
            "/api/v1/reading-sessions/history?book_id=invalid-uuid", headers=headers
        )

        # Assert
        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()
