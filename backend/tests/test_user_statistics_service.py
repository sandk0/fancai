"""
Unit тесты для UserStatisticsService.

Тестирует методы:
- get_weekly_activity
- get_reading_streak
- get_books_count_by_status
- get_favorite_genres
"""

import pytest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.services.user_statistics_service import UserStatisticsService
from app.models.reading_session import ReadingSession
from app.models.book import Book, ReadingProgress
from app.models.user import User, Subscription


@pytest.mark.asyncio
async def test_weekly_activity_empty(db_session):
    """Тест weekly_activity для пользователя без сессий."""
    user_id = uuid4()

    # Получаем weekly activity
    weekly_activity = await UserStatisticsService.get_weekly_activity(
        db_session, user_id, days=7
    )

    # Должно быть 7 дней с нулями
    assert len(weekly_activity) == 7

    # Все значения должны быть нулевые
    for day_stats in weekly_activity:
        assert day_stats["minutes"] == 0
        assert day_stats["sessions"] == 0
        assert day_stats["progress"] == 0
        assert "date" in day_stats
        assert "day" in day_stats


@pytest.mark.asyncio
async def test_reading_streak_empty(db_session):
    """Тест reading_streak для пользователя без сессий."""
    user_id = uuid4()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user_id)

    # Streak должен быть 0
    assert streak == 0


@pytest.mark.asyncio
async def test_books_count_empty(db_session):
    """Тест подсчета книг для нового пользователя."""
    # Создаем пользователя (но без книг)
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Получаем статистику
    books_stats = await UserStatisticsService.get_books_count_by_status(
        db_session, user.id
    )

    # Все счетчики должны быть 0
    assert books_stats["total"] == 0
    assert books_stats["in_progress"] == 0
    assert books_stats["completed"] == 0


@pytest.mark.asyncio
async def test_favorite_genres_empty(db_session):
    """Тест любимых жанров для пользователя без книг."""
    user_id = uuid4()

    # Получаем любимые жанры
    favorite_genres = await UserStatisticsService.get_favorite_genres(
        db_session, user_id, limit=5
    )

    # Список должен быть пустым
    assert len(favorite_genres) == 0


@pytest.mark.asyncio
async def test_weekday_names():
    """Тест правильности названий дней недели."""
    weekdays = UserStatisticsService.WEEKDAY_NAMES_RU

    # Проверяем все дни недели
    assert weekdays[0] == "Пн"  # Понедельник
    assert weekdays[1] == "Вт"  # Вторник
    assert weekdays[2] == "Ср"  # Среда
    assert weekdays[3] == "Чт"  # Четверг
    assert weekdays[4] == "Пт"  # Пятница
    assert weekdays[5] == "Сб"  # Суббота
    assert weekdays[6] == "Вс"  # Воскресенье


@pytest.mark.asyncio
async def test_total_reading_time_empty(db_session):
    """Тест общего времени чтения для пользователя без сессий."""
    user_id = uuid4()

    # Получаем общее время
    total_time = await UserStatisticsService.get_total_reading_time(db_session, user_id)

    # Должно быть 0
    assert total_time == 0


@pytest.mark.asyncio
async def test_average_reading_speed_empty(db_session):
    """Тест средней скорости чтения для пользователя без данных."""
    user_id = uuid4()

    # Получаем среднюю скорость
    avg_speed = await UserStatisticsService.get_average_reading_speed(
        db_session, user_id
    )

    # Должно быть 0.0
    assert avg_speed == 0.0


# ======================================================================
# COMPREHENSIVE READING STREAK TESTS (P1-4 FIX)
# ======================================================================


@pytest.mark.asyncio
async def test_reading_streak_read_yesterday_not_today(db_session):
    """
    P1-4: Streak НЕ должен быть 0 если читал вчера (но не сегодня).

    Сценарий: Пользователь читал 7 дней подряд (включая вчера),
    но не читал сегодня. Streak должен сохраниться = 7.
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии за последние 7 дней (НЕ включая сегодня)
    now = datetime.now(timezone.utc)
    for i in range(1, 8):  # Дни -7, -6, -5, -4, -3, -2, -1 (вчера)
        session_time = now - timedelta(days=i)
        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            started_at=session_time,
            ended_at=session_time + timedelta(minutes=30),
            start_position=0,
            end_position=10,
            duration_minutes=30,
            is_active=False,
        )
        db_session.add(session)

    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 7 (НЕ 0!)
    assert streak == 7, f"Expected streak=7 (читал вчера), got {streak}"


@pytest.mark.asyncio
async def test_reading_streak_read_today(db_session):
    """
    P1-4: Streak должен подсчитываться если читал сегодня.

    Сценарий: Пользователь читал каждый день последние 5 дней (включая сегодня).
    Streak = 5.
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии за последние 5 дней (включая сегодня)
    now = datetime.now(timezone.utc)
    for i in range(5):  # Дни: сегодня, -1, -2, -3, -4
        session_time = now - timedelta(days=i)
        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            started_at=session_time,
            ended_at=session_time + timedelta(minutes=30),
            start_position=0,
            end_position=10,
            duration_minutes=30,
            is_active=False,
        )
        db_session.add(session)

    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 5
    assert streak == 5, f"Expected streak=5 (читал сегодня), got {streak}"


@pytest.mark.asyncio
async def test_reading_streak_broken_2_days_ago(db_session):
    """
    P1-4: Streak = 0 если не читал 2+ дней.

    Сценарий: Последний раз читал 2 дня назад. Streak прерван.
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии за дни: -2, -3, -4, -5 (НЕ вчера, НЕ сегодня)
    now = datetime.now(timezone.utc)
    for i in range(2, 6):  # Дни -2, -3, -4, -5
        session_time = now - timedelta(days=i)
        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            started_at=session_time,
            ended_at=session_time + timedelta(minutes=30),
            start_position=0,
            end_position=10,
            duration_minutes=30,
            is_active=False,
        )
        db_session.add(session)

    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 0 (прерван)
    assert streak == 0, f"Expected streak=0 (прерван 2+ дня), got {streak}"


@pytest.mark.asyncio
async def test_reading_streak_with_gap_in_middle(db_session):
    """
    P1-4: Streak подсчитывается только до первого пропуска.

    Сценарий: Читал дни [1,2,3, ПРОПУСК, 5,6,7], сегодня день 8.
    Streak = 3 (дни 5, 6, 7).
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии за дни: -1, -2, -3 (последние 3 дня), затем -5, -6, -7 (с пропуском -4)
    now = datetime.now(timezone.utc)
    days_to_create = [1, 2, 3, 5, 6, 7]  # День 4 пропущен

    for day_offset in days_to_create:
        session_time = now - timedelta(days=day_offset)
        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            started_at=session_time,
            ended_at=session_time + timedelta(minutes=30),
            start_position=0,
            end_position=10,
            duration_minutes=30,
            is_active=False,
        )
        db_session.add(session)

    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 3 (дни -1, -2, -3 до пропуска)
    assert streak == 3, f"Expected streak=3 (до пропуска дня -4), got {streak}"


@pytest.mark.asyncio
async def test_reading_streak_read_today_but_not_yesterday(db_session):
    """
    P1-4: Streak = 1 если читал сегодня, но не читал вчера.

    Сценарий: Читал сегодня, но пропустил вчера. Streak = 1.
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии только за сегодня (пропуск вчера)
    now = datetime.now(timezone.utc)
    session = ReadingSession(
        user_id=user.id,
        book_id=book.id,
        started_at=now,
        ended_at=now + timedelta(minutes=30),
        start_position=0,
        end_position=10,
        duration_minutes=30,
        is_active=False,
    )
    db_session.add(session)
    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 1 (только сегодня)
    assert streak == 1, f"Expected streak=1 (читал только сегодня), got {streak}"


@pytest.mark.asyncio
async def test_reading_streak_long_consecutive_days(db_session):
    """
    P1-4: Streak для длинной серии последовательных дней.

    Сценарий: Читал каждый день последние 30 дней (включая вчера, но не сегодня).
    Streak = 30.
    """
    # Создаем пользователя
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash="hashed",
        full_name="Test User",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Создаем книгу
    book = Book(
        user_id=user.id,
        title="Test Book",
        author="Test Author",
        genre="fiction",
        file_format="epub",
        file_path="/test/book.epub",
        file_size=1024000,
        total_pages=200,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)

    # Создаем сессии за последние 30 дней (НЕ включая сегодня)
    now = datetime.now(timezone.utc)
    for i in range(1, 31):  # Дни -1 до -30
        session_time = now - timedelta(days=i)
        session = ReadingSession(
            user_id=user.id,
            book_id=book.id,
            started_at=session_time,
            ended_at=session_time + timedelta(minutes=30),
            start_position=0,
            end_position=10,
            duration_minutes=30,
            is_active=False,
        )
        db_session.add(session)

    await db_session.commit()

    # Получаем streak
    streak = await UserStatisticsService.get_reading_streak(db_session, user.id)

    # Streak должен быть 30
    assert streak == 30, (
        f"Expected streak=30 (читал 30 дней подряд до вчера), got {streak}"
    )
