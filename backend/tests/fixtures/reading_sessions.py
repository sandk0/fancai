"""
Fixtures for Reading Sessions tests.

Provides reusable test data and factory functions for creating
reading session objects in tests.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reading_session import ReadingSession
from app.models.user import User
from app.models.book import Book

# ============================================================================
# Sample Data Generators
# ============================================================================


def generate_sample_session_data(
    start_position: int = 0,
    end_position: int = 0,
    is_active: bool = True,
    device_type: str = "desktop",
) -> dict:
    """
    Generate sample reading session data.

    Args:
        start_position: Starting position in book (0-100%)
        end_position: Ending position in book (0-100%)
        is_active: Whether session is active
        device_type: Device type (mobile, tablet, desktop)

    Returns:
        Dictionary with session data
    """
    return {
        "start_position": start_position,
        "end_position": end_position,
        "is_active": is_active,
        "device_type": device_type,
        "started_at": datetime.now(timezone.utc),
    }


def generate_completed_session_data(
    start_position: int = 0,
    end_position: int = 50,
    duration_minutes: int = 30,
    hours_ago: int = 1,
) -> dict:
    """
    Generate sample completed reading session data.

    Args:
        start_position: Starting position in book (0-100%)
        end_position: Ending position in book (0-100%)
        duration_minutes: Duration of session in minutes
        hours_ago: How many hours ago session started

    Returns:
        Dictionary with completed session data
    """
    now = datetime.now(timezone.utc)
    started_at = now - timedelta(hours=hours_ago)
    ended_at = started_at + timedelta(minutes=duration_minutes)

    return {
        "start_position": start_position,
        "end_position": end_position,
        "is_active": False,
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_minutes": duration_minutes,
    }


def generate_abandoned_session_data(hours_old: int = 3) -> dict:
    """
    Generate data for an abandoned reading session.

    Args:
        hours_old: How many hours ago session started

    Returns:
        Dictionary with abandoned session data (active but old)
    """
    old_time = datetime.now(timezone.utc) - timedelta(hours=hours_old)
    return {
        "start_position": 25,
        "end_position": 30,
        "is_active": True,
        "started_at": old_time,
        "ended_at": None,
    }


# ============================================================================
# Session Factory Fixtures
# ============================================================================


@pytest_asyncio.fixture
async def create_reading_session(db_session: AsyncSession):
    """
    Factory fixture for creating reading sessions.

    Usage:
        session = await create_reading_session(
            user=test_user,
            book=test_book,
            start_position=20
        )
    """

    async def _create_session(
        user: User,
        book: Book,
        start_position: int = 0,
        end_position: int = 0,
        is_active: bool = True,
        device_type: str = "desktop",
        started_at: datetime = None,
        ended_at: datetime = None,
        duration_minutes: int = 0,
    ) -> ReadingSession:
        """
        Create a reading session in the database.

        Args:
            user: User who owns the session
            book: Book being read
            start_position: Starting position (0-100%)
            end_position: Ending position (0-100%)
            is_active: Whether session is active
            device_type: Device type
            started_at: Start timestamp (default: now)
            ended_at: End timestamp (default: None)
            duration_minutes: Duration in minutes

        Returns:
            Created ReadingSession instance
        """
        if started_at is None:
            started_at = datetime.now(timezone.utc)

        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            start_position=start_position,
            end_position=end_position,
            is_active=is_active,
            device_type=device_type,
            started_at=started_at,
            ended_at=ended_at,
            duration_minutes=duration_minutes,
        )

        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)

        return session

    return _create_session


@pytest_asyncio.fixture
async def create_multiple_sessions(create_reading_session):
    """
    Factory fixture for creating multiple reading sessions at once.

    Usage:
        sessions = await create_multiple_sessions(
            user=test_user,
            book=test_book,
            count=10,
            is_active=False
        )
    """

    async def _create_multiple(
        user: User,
        book: Book,
        count: int = 5,
        is_active: bool = False,
        hours_apart: int = 1,
    ) -> List[ReadingSession]:
        """
        Create multiple reading sessions.

        Args:
            user: User who owns the sessions
            book: Book being read
            count: Number of sessions to create
            is_active: Whether sessions are active
            hours_apart: Hours between session start times

        Returns:
            List of created ReadingSession instances
        """
        sessions = []
        now = datetime.now(timezone.utc)

        for i in range(count):
            started_at = now - timedelta(hours=i * hours_apart)
            ended_at = None if is_active else started_at + timedelta(hours=1)

            session = await create_reading_session(
                user=user,
                book=book,
                start_position=i * 10,
                end_position=i * 10 + 20,
                is_active=is_active,
                started_at=started_at,
                ended_at=ended_at,
                duration_minutes=0 if is_active else 60,
            )
            sessions.append(session)

        return sessions

    return _create_multiple


# ============================================================================
# Specific Session Type Fixtures
# ============================================================================


@pytest_asyncio.fixture
async def active_session(
    db_session: AsyncSession, test_user: User, test_book: Book
) -> ReadingSession:
    """
    Fixture providing a single active reading session.

    Returns:
        Active ReadingSession started 10 minutes ago
    """
    session = ReadingSession(
        user_id=test_user.id,
        book_id=test_book.id,
        start_position=20,
        end_position=35,
        device_type="tablet",
        is_active=True,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
    )
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    return session


@pytest_asyncio.fixture
async def completed_session(
    db_session: AsyncSession, test_user: User, test_book: Book
) -> ReadingSession:
    """
    Fixture providing a completed reading session.

    Returns:
        Completed ReadingSession from 2 hours ago, 45 minutes duration
    """
    started_at = datetime.now(timezone.utc) - timedelta(hours=2)
    ended_at = started_at + timedelta(minutes=45)

    session = ReadingSession(
        user_id=test_user.id,
        book_id=test_book.id,
        start_position=0,
        end_position=50,
        is_active=False,
        started_at=started_at,
        ended_at=ended_at,
        duration_minutes=45,
    )
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    return session


@pytest_asyncio.fixture
async def abandoned_session(
    db_session: AsyncSession, test_user: User, test_book: Book
) -> ReadingSession:
    """
    Fixture providing an abandoned reading session.

    Returns:
        Active ReadingSession started 3 hours ago (should be closed)
    """
    old_time = datetime.now(timezone.utc) - timedelta(hours=3)

    session = ReadingSession(
        user_id=test_user.id,
        book_id=test_book.id,
        start_position=25,
        end_position=30,
        is_active=True,
        started_at=old_time,
        ended_at=None,
    )
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    return session


@pytest_asyncio.fixture
async def multiple_device_sessions(
    db_session: AsyncSession, test_user: User, test_book: Book
) -> List[ReadingSession]:
    """
    Fixture providing sessions from different devices.

    Returns:
        List of 3 sessions: mobile, tablet, desktop
    """
    devices = ["mobile", "tablet", "desktop"]
    sessions = []

    for i, device in enumerate(devices):
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=i * 20,
            end_position=i * 20 + 15,
            device_type=device,
            is_active=False,
            started_at=datetime.now(timezone.utc) - timedelta(hours=i + 1),
            ended_at=datetime.now(timezone.utc) - timedelta(hours=i),
            duration_minutes=60,
        )
        db_session.add(session)
        sessions.append(session)

    await db_session.commit()

    for session in sessions:
        await db_session.refresh(session)

    return sessions


@pytest_asyncio.fixture
async def sessions_with_different_progress(
    db_session: AsyncSession, test_user: User, test_book: Book
) -> List[ReadingSession]:
    """
    Fixture providing sessions with varying progress deltas.

    Returns:
        List of sessions with 0%, 25%, 50%, 75%, 100% progress
    """
    progress_deltas = [0, 25, 50, 75, 100]
    sessions = []

    for i, delta in enumerate(progress_deltas):
        start_pos = 0
        end_pos = delta

        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            start_position=start_pos,
            end_position=end_pos,
            is_active=False,
            started_at=datetime.now(timezone.utc) - timedelta(hours=i + 1),
            ended_at=datetime.now(timezone.utc) - timedelta(hours=i),
            duration_minutes=60,
        )
        db_session.add(session)
        sessions.append(session)

    await db_session.commit()

    for session in sessions:
        await db_session.refresh(session)

    return sessions


# ============================================================================
# Mock Data Fixtures
# ============================================================================


@pytest.fixture
def sample_session_response():
    """
    Sample API response for a reading session.

    Returns:
        Dictionary mimicking ReadingSessionResponse
    """
    return {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "user_id": "123e4567-e89b-12d3-a456-426614174001",
        "book_id": "123e4567-e89b-12d3-a456-426614174002",
        "started_at": "2025-10-28T10:00:00Z",
        "ended_at": None,
        "duration_minutes": 0,
        "start_position": 25,
        "end_position": 40,
        "pages_read": 15,
        "device_type": "mobile",
        "is_active": True,
        "progress_delta": 15,
    }


@pytest.fixture
def sample_sessions_history():
    """
    Sample API response for reading sessions history.

    Returns:
        Dictionary mimicking ReadingSessionListResponse
    """
    return {
        "sessions": [
            {
                "id": f"123e4567-e89b-12d3-a456-42661417400{i}",
                "user_id": "123e4567-e89b-12d3-a456-426614174001",
                "book_id": "123e4567-e89b-12d3-a456-426614174002",
                "started_at": f"2025-10-28T{10 + i}:00:00Z",
                "ended_at": f"2025-10-28T{11 + i}:00:00Z",
                "duration_minutes": 60,
                "start_position": i * 10,
                "end_position": i * 10 + 20,
                "pages_read": 20,
                "device_type": "desktop",
                "is_active": False,
                "progress_delta": 20,
            }
            for i in range(5)
        ],
        "total": 5,
        "page": 1,
        "page_size": 20,
        "has_next": False,
    }


@pytest.fixture
def celery_task_result_success():
    """
    Mock successful Celery task result for close_abandoned_sessions.

    Returns:
        Dictionary with task execution results
    """
    return {
        "closed_count": 15,
        "execution_time_ms": 234.5,
        "deadline": "2025-10-28T08:00:00+00:00",
    }


@pytest.fixture
def celery_task_result_error():
    """
    Mock failed Celery task result.

    Returns:
        Dictionary with error information
    """
    return {
        "closed_count": 0,
        "execution_time_ms": 123.4,
        "error": "Database connection timeout",
    }


@pytest.fixture
def cleanup_statistics_sample():
    """
    Sample cleanup statistics data.

    Returns:
        Dictionary with statistics data
    """
    return {
        "total_closed": 150,
        "total_active": 45,
        "avg_duration_minutes": 42.5,
        "no_progress_count": 23,
        "period_hours": 24,
        "timestamp": "2025-10-28T12:00:00+00:00",
    }


# ============================================================================
# Authentication Fixtures
# ============================================================================


@pytest.fixture
def auth_headers_for_session(test_user: User):
    """
    Generate authentication headers for reading session requests.

    Args:
        test_user: User to authenticate as

    Returns:
        Dictionary with Authorization header
    """
    from app.core.auth import create_access_token

    token = create_access_token({"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# Validation Test Data
# ============================================================================


@pytest.fixture
def invalid_session_positions():
    """
    Invalid position values for validation testing.

    Returns:
        List of tuples (position, error_message)
    """
    return [
        (-1, "Position must be >= 0"),
        (101, "Position must be <= 100"),
        (-50, "Position must be >= 0"),
        (150, "Position must be <= 100"),
    ]


@pytest.fixture
def invalid_device_types():
    """
    Invalid device types for validation testing.

    Returns:
        List of invalid device type strings
    """
    return [
        "smartwatch",
        "tv",
        "console",
        "car",
        "refrigerator",
    ]


@pytest.fixture
def edge_case_session_data():
    """
    Edge case data for comprehensive testing.

    Returns:
        Dictionary with various edge cases
    """
    return {
        "min_position": {"start_position": 0, "end_position": 0},
        "max_position": {"start_position": 100, "end_position": 100},
        "full_book": {"start_position": 0, "end_position": 100},
        "no_progress": {"start_position": 50, "end_position": 50},
        "backwards": {"start_position": 75, "end_position": 25},  # Invalid
    }
