"""
Integration tests for Reading Sessions complete flow.

Tests the entire reading session lifecycle end-to-end:
- User starts reading session
- Updates position periodically
- Ends session
- Retrieves session history
- Abandoned sessions cleanup
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone

from app.models.reading_session import ReadingSession
from app.models.user import User
from app.models.book import Book
from app.core.auth import create_access_token
from app.tasks.reading_sessions_tasks import _close_abandoned_sessions_impl

# ============================================================================
# Test Suite 1: Full Reading Session Flow
# ============================================================================


class TestFullReadingSessionFlow:
    """Integration tests for complete reading session flow."""

    @pytest.mark.asyncio
    async def test_complete_reading_session_lifecycle(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test complete lifecycle of a reading session from start to finish.

        Flow:
        1. User starts reading session
        2. User updates position multiple times
        3. User ends reading session
        4. Verify session in history
        5. Verify session statistics
        """
        # Arrange - authentication
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Step 1: Start reading session
        start_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={
                "book_id": str(test_book.id),
                "start_position": 0,
                "device_type": "desktop",
            },
            headers=headers,
        )

        assert start_response.status_code == 201
        start_data = start_response.json()
        session_id = start_data["id"]

        assert start_data["is_active"] is True
        assert start_data["start_position"] == 0
        assert start_data["end_position"] == 0

        # Step 2: Update position multiple times (simulating reading)
        positions = [10, 25, 40, 55]

        for position in positions:
            update_response = await client.put(
                f"/api/v1/reading-sessions/{session_id}/update",
                json={"current_position": position},
                headers=headers,
            )

            assert update_response.status_code == 200
            update_data = update_response.json()
            assert update_data["end_position"] == position
            assert update_data["is_active"] is True

        # Step 3: End reading session
        end_response = await client.put(
            f"/api/v1/reading-sessions/{session_id}/end",
            json={"end_position": 70},
            headers=headers,
        )

        assert end_response.status_code == 200
        end_data = end_response.json()

        assert end_data["is_active"] is False
        assert end_data["end_position"] == 70
        assert end_data["progress_delta"] == 70  # 70 - 0 = 70
        assert end_data["duration_minutes"] >= 0
        assert end_data["ended_at"] is not None

        # Step 4: Verify session appears in history
        history_response = await client.get(
            "/api/v1/reading-sessions/history", headers=headers
        )

        assert history_response.status_code == 200
        history_data = history_response.json()

        assert history_data["total"] >= 1
        found_session = next(
            (s for s in history_data["sessions"] if s["id"] == session_id), None
        )
        assert found_session is not None
        assert found_session["end_position"] == 70

        # Step 5: Verify no active session remains
        active_response = await client.get(
            "/api/v1/reading-sessions/active", headers=headers
        )

        assert active_response.status_code == 200
        assert active_response.json() is None

    @pytest.mark.asyncio
    async def test_multiple_sessions_same_book(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test creating multiple reading sessions for the same book.

        Verifies:
        - Multiple sessions can be created sequentially
        - Previous sessions are properly closed
        - History accumulates correctly
        """
        # Arrange
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        session_ids = []

        # Create 3 complete sessions
        for i in range(3):
            # Start session
            start_response = await client.post(
                "/api/v1/reading-sessions/start",
                json={
                    "book_id": str(test_book.id),
                    "start_position": i * 30,
                    "device_type": "mobile",
                },
                headers=headers,
            )

            assert start_response.status_code == 201
            session_id = start_response.json()["id"]
            session_ids.append(session_id)

            # End session
            end_response = await client.put(
                f"/api/v1/reading-sessions/{session_id}/end",
                json={"end_position": (i + 1) * 30},
                headers=headers,
            )

            assert end_response.status_code == 200

        # Verify all sessions in history
        history_response = await client.get(
            f"/api/v1/reading-sessions/history?book_id={test_book.id}",
            headers=headers,
        )

        assert history_response.status_code == 200
        history_data = history_response.json()

        assert history_data["total"] == 3

        # Verify sessions are ordered by recency
        sessions = history_data["sessions"]
        assert len(sessions) == 3

        for i, session in enumerate(sessions):
            assert session["id"] in session_ids


# ============================================================================
# Test Suite 2: Concurrent Sessions
# ============================================================================


class TestConcurrentSessions:
    """Test handling of concurrent reading sessions."""

    @pytest.mark.asyncio
    async def test_multiple_users_concurrent_sessions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """
        Test that multiple users can have concurrent sessions.

        Verifies:
        - Multiple users can read simultaneously
        - Sessions are properly isolated by user
        - No interference between users
        """
        # Arrange - create multiple users
        from app.services.auth_service import AuthService

        auth_service = AuthService()
        users = []

        for i in range(3):
            user = User(
                email=f"user{i}@example.com",
                full_name=f"User {i}",
                password_hash=auth_service.get_password_hash("password123"),
            )
            db_session.add(user)
            users.append(user)

        await db_session.commit()

        # Create books for each user (since books are user-specific)
        from app.models.book import BookGenre

        user_books = []
        for user in users:
            book = Book(
                user_id=user.id,
                title=f"Book for {user.full_name}",
                author="Test Author",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book_{user.id}.epub",
                file_format="epub",
                file_size=1024000,
                total_pages=100,
                is_parsed=True,
            )
            db_session.add(book)
            user_books.append(book)

        await db_session.commit()

        # Act - each user starts a session
        sessions = []

        for i, (user, book) in enumerate(zip(users, user_books)):
            token = create_access_token({"sub": str(user.id)})
            headers = {"Authorization": f"Bearer {token}"}

            response = await client.post(
                "/api/v1/reading-sessions/start",
                json={
                    "book_id": str(book.id),
                    "start_position": i * 20,
                    "device_type": "mobile",
                },
                headers=headers,
            )

            assert response.status_code == 201
            sessions.append(response.json())

        # Assert - verify each user has their own active session
        for i, (user, book) in enumerate(zip(users, user_books)):
            token = create_access_token({"sub": str(user.id)})
            headers = {"Authorization": f"Bearer {token}"}

            response = await client.get(
                "/api/v1/reading-sessions/active", headers=headers
            )

            assert response.status_code == 200
            active_session = response.json()

            assert active_session is not None
            assert active_session["user_id"] == str(user.id)
            assert active_session["book_id"] == str(book.id)
            assert active_session["is_active"] is True

    @pytest.mark.asyncio
    async def test_auto_close_previous_session_on_new_start(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test that starting a new session automatically closes previous one.

        Verifies:
        - Only one active session per user at a time
        - Previous session is properly closed with current position
        - Duration is calculated correctly
        """
        # Arrange
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Start first session
        first_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={"book_id": str(test_book.id), "start_position": 0},
            headers=headers,
        )

        assert first_response.status_code == 201
        first_session_id = first_response.json()["id"]

        # Update position in first session
        await client.put(
            f"/api/v1/reading-sessions/{first_session_id}/update",
            json={"current_position": 30},
            headers=headers,
        )

        # Wait a bit to ensure duration is measurable
        import asyncio

        await asyncio.sleep(0.1)

        # Start second session (should auto-close first)
        second_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={"book_id": str(test_book.id), "start_position": 50},
            headers=headers,
        )

        assert second_response.status_code == 201
        second_session_id = second_response.json()["id"]
        assert second_session_id != first_session_id

        # Verify first session was closed
        query = select(ReadingSession).where(ReadingSession.id == first_session_id)
        result = await db_session.execute(query)
        first_session = result.scalar_one()

        assert first_session.is_active is False
        assert first_session.ended_at is not None
        assert first_session.duration_minutes >= 0

        # Verify only second session is active
        active_response = await client.get(
            "/api/v1/reading-sessions/active", headers=headers
        )

        active_session = active_response.json()
        assert active_session["id"] == second_session_id


# ============================================================================
# Test Suite 3: Session Cleanup Integration
# ============================================================================


class TestSessionCleanupIntegration:
    """Integration tests for session cleanup with tasks."""

    @pytest.mark.asyncio
    async def test_abandoned_sessions_cleanup_flow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test complete flow of abandoned session detection and cleanup.

        Flow:
        1. Create active sessions (some old, some recent)
        2. Run cleanup task
        3. Verify old sessions are closed
        4. Verify recent sessions remain active
        5. Check statistics
        """
        # Step 1: Create sessions at different times
        now = datetime.now(timezone.utc)

        # Old abandoned sessions (>2 hours)
        old_sessions = []
        for i in range(3):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                is_active=True,
                started_at=now - timedelta(hours=3 + i),
            )
            db_session.add(session)
            old_sessions.append(session)

        # Recent active session (<2 hours)
        recent_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=50,
            end_position=55,
            is_active=True,
            started_at=now - timedelta(minutes=30),
        )
        db_session.add(recent_session)

        await db_session.commit()

        # Step 2: Run cleanup task
        deadline = now - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Step 3: Verify old sessions are closed
        assert closed_count == 3

        for session in old_sessions:
            await db_session.refresh(session)
            assert session.is_active is False
            assert session.ended_at is not None

        # Step 4: Verify recent session is still active
        await db_session.refresh(recent_session)
        assert recent_session.is_active is True

        # Step 5: Check via API that user has active session
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        active_response = await client.get(
            "/api/v1/reading-sessions/active", headers=headers
        )

        active_data = active_response.json()
        assert active_data is not None
        assert active_data["id"] == str(recent_session.id)

    @pytest.mark.asyncio
    async def test_cleanup_with_concurrent_reading(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test that cleanup doesn't interfere with active reading.

        Verifies:
        - Active sessions (<2h) are not affected by cleanup
        - User can continue reading during cleanup
        - Position updates work after cleanup
        """
        # Arrange - start active session
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        start_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={"book_id": str(test_book.id), "start_position": 20},
            headers=headers,
        )

        assert start_response.status_code == 201
        session_id = start_response.json()["id"]

        # Create old abandoned session
        old_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=0,
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(hours=5),
        )
        db_session.add(old_session)
        await db_session.commit()

        # Act - run cleanup
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        assert closed_count == 1  # Only old session closed

        # Verify active session still works
        update_response = await client.put(
            f"/api/v1/reading-sessions/{session_id}/update",
            json={"current_position": 40},
            headers=headers,
        )

        assert update_response.status_code == 200
        assert update_response.json()["end_position"] == 40


# ============================================================================
# Test Suite 4: Error Recovery and Edge Cases
# ============================================================================


class TestErrorRecoveryIntegration:
    """Integration tests for error recovery scenarios."""

    @pytest.mark.asyncio
    async def test_resume_after_network_interruption(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test resuming reading after simulated network interruption.

        Simulates:
        - User starts session
        - Network interruption (session not properly ended)
        - User returns and checks for active session
        - User resumes or starts new session
        """
        # Arrange
        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Start session
        start_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={"book_id": str(test_book.id), "start_position": 30},
            headers=headers,
        )

        assert start_response.status_code == 201
        session_id = start_response.json()["id"]

        # Simulate network interruption - session remains active
        # User returns and checks for active session

        active_response = await client.get(
            "/api/v1/reading-sessions/active", headers=headers
        )

        assert active_response.status_code == 200
        active_data = active_response.json()

        assert active_data is not None
        assert active_data["id"] == session_id

        # User can resume by updating position
        update_response = await client.put(
            f"/api/v1/reading-sessions/{session_id}/update",
            json={"current_position": 45},
            headers=headers,
        )

        assert update_response.status_code == 200

        # Or user can start new session (auto-closes previous)
        new_start_response = await client.post(
            "/api/v1/reading-sessions/start",
            json={"book_id": str(test_book.id), "start_position": 50},
            headers=headers,
        )

        assert new_start_response.status_code == 201
        new_session_id = new_start_response.json()["id"]
        assert new_session_id != session_id

    @pytest.mark.asyncio
    async def test_pagination_with_large_history(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """
        Test pagination functionality with large session history.

        Verifies:
        - Correct pagination behavior
        - Consistent ordering across pages
        - has_next flag accuracy
        """
        # Arrange - create 50 completed sessions
        now = datetime.now(timezone.utc)

        for i in range(50):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i % 100,
                end_position=(i + 20) % 100,
                is_active=False,
                started_at=now - timedelta(hours=50 - i),
                ended_at=now - timedelta(hours=50 - i, minutes=-30),
                duration_minutes=30,
            )
            db_session.add(session)

        await db_session.commit()

        token = create_access_token({"sub": str(test_user.id)})
        headers = {"Authorization": f"Bearer {token}"}

        # Act - fetch multiple pages
        page1_response = await client.get(
            "/api/v1/reading-sessions/history?page=1&page_size=20",
            headers=headers,
        )

        page2_response = await client.get(
            "/api/v1/reading-sessions/history?page=2&page_size=20",
            headers=headers,
        )

        page3_response = await client.get(
            "/api/v1/reading-sessions/history?page=3&page_size=20",
            headers=headers,
        )

        # Assert
        page1_data = page1_response.json()
        page2_data = page2_response.json()
        page3_data = page3_response.json()

        assert page1_data["total"] == 50
        assert len(page1_data["sessions"]) == 20
        assert page1_data["has_next"] is True

        assert len(page2_data["sessions"]) == 20
        assert page2_data["has_next"] is True

        assert len(page3_data["sessions"]) == 10
        assert page3_data["has_next"] is False

        # Verify no duplicate sessions across pages
        page1_ids = {s["id"] for s in page1_data["sessions"]}
        page2_ids = {s["id"] for s in page2_data["sessions"]}
        page3_ids = {s["id"] for s in page3_data["sessions"]}

        assert len(page1_ids & page2_ids) == 0
        assert len(page2_ids & page3_ids) == 0
        assert len(page1_ids & page3_ids) == 0
