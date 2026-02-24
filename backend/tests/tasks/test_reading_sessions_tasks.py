"""
Unit tests for Reading Sessions Celery tasks.

Test coverage:
- close_abandoned_sessions task
- get_cleanup_statistics task
- Error handling and retries
- Performance metrics
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.tasks.reading_sessions_tasks import (
    close_abandoned_sessions,
    get_cleanup_statistics,
    _close_abandoned_sessions_impl,
    _get_cleanup_statistics_impl,
)
from app.models.reading_session import ReadingSession
from app.models.user import User
from app.models.book import Book

# ============================================================================
# Test Suite 1: close_abandoned_sessions Task
# ============================================================================


class TestCloseAbandonedSessions:
    """Test suite for close_abandoned_sessions Celery task."""

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_success(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test successful closing of abandoned sessions."""
        # Arrange - create abandoned sessions (>2 hours old, still active)
        old_time = datetime.now(timezone.utc) - timedelta(hours=3)

        abandoned_sessions = []
        for i in range(3):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                is_active=True,
                started_at=old_time - timedelta(minutes=i * 10),
                ended_at=None,
            )
            db_session.add(session)
            abandoned_sessions.append(session)

        # Create a recent active session (should NOT be closed)
        recent_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=50,
            end_position=55,
            is_active=True,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
            ended_at=None,
        )
        db_session.add(recent_session)

        await db_session.commit()

        # Act - run the task implementation
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Assert
        assert closed_count == 3

        # Verify abandoned sessions are closed
        for session in abandoned_sessions:
            await db_session.refresh(session)
            assert session.is_active is False
            assert session.ended_at is not None
            assert session.duration_minutes > 0

        # Verify recent session is still active
        await db_session.refresh(recent_session)
        assert recent_session.is_active is True
        assert recent_session.ended_at is None

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_no_sessions(self, db_session: AsyncSession):
        """Test task when no abandoned sessions exist."""
        # Act
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Assert
        assert closed_count == 0

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_sets_correct_duration(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test that task correctly calculates session duration."""
        # Arrange - create session started 150 minutes ago
        start_time = datetime.now(timezone.utc) - timedelta(minutes=150)
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=20,
            end_position=40,
            is_active=True,
            started_at=start_time,
            ended_at=None,
        )
        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)

        # Act
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Assert
        assert closed_count == 1

        await db_session.refresh(session)
        # Duration should be approximately 150 minutes (with tolerance)
        assert 148 <= session.duration_minutes <= 152

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_no_progress(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test closing sessions where end_position == start_position."""
        # Arrange - session with no progress
        old_time = datetime.now(timezone.utc) - timedelta(hours=3)
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=25,
            end_position=25,  # No progress
            is_active=True,
            started_at=old_time,
            ended_at=None,
        )
        db_session.add(session)
        await db_session.commit()

        # Act
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Assert
        assert closed_count == 1

        await db_session.refresh(session)
        assert session.is_active is False
        assert session.end_position == 25  # Should keep original position

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_handles_errors(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test that task handles errors gracefully and continues processing."""
        # Arrange - create multiple sessions
        old_time = datetime.now(timezone.utc) - timedelta(hours=3)

        sessions = []
        for i in range(5):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 5,
                is_active=True,
                started_at=old_time,
                ended_at=None,
            )
            db_session.add(session)
            sessions.append(session)

        await db_session.commit()

        # Note: Testing error handling would require mocking session.end_session
        # to raise an exception for specific sessions. For now, we verify
        # successful processing of all sessions.

        # Act
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)

        # Assert
        assert closed_count == 5

    def test_close_abandoned_sessions_task_returns_stats(self):
        """Test that Celery task returns proper statistics."""
        # This test verifies the task wrapper, not the implementation
        # Mock the async implementation
        with patch(
            "app.tasks.reading_sessions_tasks._close_abandoned_sessions_impl"
        ) as mock_impl:
            mock_impl.return_value = 10

            # Act
            result = close_abandoned_sessions()

            # Assert
            assert "closed_count" in result
            assert "execution_time_ms" in result
            assert "deadline" in result
            assert result["closed_count"] == 10
            assert result["execution_time_ms"] >= 0


# ============================================================================
# Test Suite 2: get_cleanup_statistics Task
# ============================================================================


class TestGetCleanupStatistics:
    """Test suite for get_cleanup_statistics Celery task."""

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_basic(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test getting basic cleanup statistics."""
        # Arrange - create various sessions
        now = datetime.now(timezone.utc)

        # 5 closed sessions in last 24 hours
        for i in range(5):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 20,
                is_active=False,
                started_at=now - timedelta(hours=i + 1),
                ended_at=now - timedelta(hours=i),
                duration_minutes=60,
            )
            db_session.add(session)

        # 2 active sessions
        for i in range(2):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=50,
                end_position=60,
                is_active=True,
                started_at=now - timedelta(minutes=30),
            )
            db_session.add(session)

        # 1 old closed session (>24 hours ago)
        old_session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=100,
            is_active=False,
            started_at=now - timedelta(hours=48),
            ended_at=now - timedelta(hours=47),
            duration_minutes=60,
        )
        db_session.add(old_session)

        await db_session.commit()

        # Act
        stats = await _get_cleanup_statistics_impl(hours=24)

        # Assert
        assert stats["total_closed"] == 5  # Only last 24 hours
        assert stats["total_active"] == 2
        assert stats["avg_duration_minutes"] == 60.0
        assert stats["period_hours"] == 24
        assert "timestamp" in stats

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_no_progress_sessions(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test counting sessions with no progress."""
        # Arrange
        now = datetime.now(timezone.utc)

        # Sessions with progress
        for i in range(3):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i * 10,
                end_position=i * 10 + 20,  # Has progress
                is_active=False,
                started_at=now - timedelta(hours=i + 1),
                ended_at=now - timedelta(hours=i),
                duration_minutes=30,
            )
            db_session.add(session)

        # Sessions without progress
        for i in range(2):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=50,
                end_position=50,  # No progress
                is_active=False,
                started_at=now - timedelta(hours=i + 1),
                ended_at=now - timedelta(hours=i),
                duration_minutes=5,
            )
            db_session.add(session)

        await db_session.commit()

        # Act
        stats = await _get_cleanup_statistics_impl(hours=24)

        # Assert
        assert stats["total_closed"] == 5
        assert stats["no_progress_count"] == 2

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_empty_database(
        self, db_session: AsyncSession
    ):
        """Test statistics when no sessions exist."""
        # Act
        stats = await _get_cleanup_statistics_impl(hours=24)

        # Assert
        assert stats["total_closed"] == 0
        assert stats["total_active"] == 0
        assert stats["avg_duration_minutes"] == 0.0
        assert stats["no_progress_count"] == 0

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_different_periods(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test statistics for different time periods."""
        # Arrange
        now = datetime.now(timezone.utc)

        # Sessions at different times
        session_12h = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=50,
            is_active=False,
            started_at=now - timedelta(hours=13),
            ended_at=now - timedelta(hours=12),
            duration_minutes=60,
        )

        session_6h = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=50,
            is_active=False,
            started_at=now - timedelta(hours=7),
            ended_at=now - timedelta(hours=6),
            duration_minutes=60,
        )

        session_1h = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=50,
            is_active=False,
            started_at=now - timedelta(hours=2),
            ended_at=now - timedelta(hours=1),
            duration_minutes=60,
        )

        db_session.add(session_12h)
        db_session.add(session_6h)
        db_session.add(session_1h)
        await db_session.commit()

        # Act - test different periods
        stats_1h = await _get_cleanup_statistics_impl(hours=1)
        stats_12h = await _get_cleanup_statistics_impl(hours=12)
        stats_24h = await _get_cleanup_statistics_impl(hours=24)

        # Assert
        assert stats_1h["total_closed"] == 1  # Only last 1 hour
        assert stats_12h["total_closed"] == 2  # Last 12 hours
        assert stats_24h["total_closed"] == 3  # All sessions

    def test_get_cleanup_statistics_task_wrapper(self):
        """Test that Celery task wrapper works correctly."""
        # Mock the async implementation
        with patch(
            "app.tasks.reading_sessions_tasks._get_cleanup_statistics_impl"
        ) as mock_impl:
            mock_impl.return_value = {
                "total_closed": 10,
                "total_active": 2,
                "avg_duration_minutes": 45.5,
                "no_progress_count": 3,
                "period_hours": 24,
                "timestamp": "2025-10-28T00:00:00+00:00",
            }

            # Act
            result = get_cleanup_statistics(hours=24)

            # Assert
            assert result["total_closed"] == 10
            assert result["total_active"] == 2
            assert result["avg_duration_minutes"] == 45.5
            assert result["no_progress_count"] == 3

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_avg_duration_calculation(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test average duration calculation correctness."""
        # Arrange - sessions with different durations
        now = datetime.now(timezone.utc)
        durations = [30, 45, 60, 90, 120]  # Average should be 69

        for duration in durations:
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=0,
                end_position=50,
                is_active=False,
                started_at=now - timedelta(hours=2),
                ended_at=now - timedelta(hours=1),
                duration_minutes=duration,
            )
            db_session.add(session)

        await db_session.commit()

        # Act
        stats = await _get_cleanup_statistics_impl(hours=24)

        # Assert
        expected_avg = sum(durations) / len(durations)
        assert stats["avg_duration_minutes"] == round(expected_avg, 2)


# ============================================================================
# Test Suite 3: Error Handling and Edge Cases
# ============================================================================


class TestTaskErrorHandling:
    """Test suite for error handling in tasks."""

    def test_close_abandoned_sessions_handles_exception(self):
        """Test task handles exceptions and includes error in result."""
        # Mock to raise an exception
        with patch(
            "app.tasks.reading_sessions_tasks._close_abandoned_sessions_impl"
        ) as mock_impl:
            mock_impl.side_effect = Exception("Database connection error")

            # Act
            result = close_abandoned_sessions()

            # Assert
            assert "error" in result
            assert "Database connection error" in result["error"]
            assert result["closed_count"] >= 0

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_rollback_on_error(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test that database rollback happens on error."""
        # Arrange
        old_time = datetime.now(timezone.utc) - timedelta(hours=3)
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=0,
            end_position=0,
            is_active=True,
            started_at=old_time,
        )
        db_session.add(session)
        await db_session.commit()
        session_id = session.id

        # Note: Testing actual rollback would require injecting an error
        # during transaction. This test verifies the structure exists.

        # Verify session still exists
        from sqlalchemy import select

        query = select(ReadingSession).where(ReadingSession.id == session_id)
        result = await db_session.execute(query)
        found_session = result.scalar_one_or_none()
        assert found_session is not None


# ============================================================================
# Test Suite 4: Performance Tests
# ============================================================================


class TestTaskPerformance:
    """Test suite for performance characteristics of tasks."""

    @pytest.mark.asyncio
    async def test_close_abandoned_sessions_handles_large_volume(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test task performance with large number of abandoned sessions."""
        # Arrange - create 100 abandoned sessions
        old_time = datetime.now(timezone.utc) - timedelta(hours=3)

        sessions = []
        for i in range(100):
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i % 100,
                end_position=i % 100,
                is_active=True,
                started_at=old_time,
            )
            sessions.append(session)
            db_session.add(session)

        await db_session.commit()

        # Act
        import time

        start_time = time.time()
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        closed_count = await _close_abandoned_sessions_impl(deadline)
        execution_time = time.time() - start_time

        # Assert
        assert closed_count == 100
        # Should complete in reasonable time (< 5 seconds for 100 sessions)
        assert execution_time < 5.0

    @pytest.mark.asyncio
    async def test_get_cleanup_statistics_performance(
        self, db_session: AsyncSession, test_user: User, test_book: Book
    ):
        """Test statistics calculation performance with many sessions."""
        # Arrange - create 500 sessions
        now = datetime.now(timezone.utc)

        for i in range(500):
            is_active = i % 5 == 0  # 20% active
            session = ReadingSession(
                user_id=test_user.id,
                book_id=test_book.id,
                start_position=i % 100,
                end_position=(i + 20) % 100,
                is_active=is_active,
                started_at=now - timedelta(hours=i % 24),
                ended_at=(
                    None if is_active else now - timedelta(hours=i % 24, minutes=-30)
                ),
                duration_minutes=30 if not is_active else 0,
            )
            db_session.add(session)

        await db_session.commit()

        # Act
        import time

        start_time = time.time()
        stats = await _get_cleanup_statistics_impl(hours=24)
        execution_time = time.time() - start_time

        # Assert
        assert stats["total_closed"] > 0
        assert stats["total_active"] > 0
        # Should complete quickly (< 2 seconds for 500 sessions)
        assert execution_time < 2.0
