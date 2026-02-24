"""
Сервис для подсчета детальной статистики чтения пользователей.

Содержит методы для расчета:
- Weekly activity (активность по дням недели)
- Reading streak (непрерывная серия дней чтения)
- Общие метрики чтения

Performance optimization (December 2025):
- Redis caching for aggregated statistics with 5-minute TTL
- Graceful fallback to direct DB queries if Redis unavailable
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date, case, and_, Float
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any
from uuid import UUID

from loguru import logger

from ..models.reading_session import ReadingSession
from ..models.book import Book, ReadingProgress
from ..core.cache import cache_manager

# Cache configuration for user statistics
USER_STATS_CACHE_TTL = 300  # 5 minutes
USER_STATS_CACHE_KEY_PREFIX = "user_stats"

# Maximum valid session duration for statistics (in minutes)
# Sessions longer than this are considered invalid/orphaned
MAX_VALID_SESSION_DURATION = 480  # 8 hours


class UserStatisticsService:
    """Сервис для подсчета детальной статистики чтения пользователей."""

    # Русские названия дней недели (короткие)
    WEEKDAY_NAMES_RU = {
        0: "Пн",  # Monday
        1: "Вт",  # Tuesday
        2: "Ср",  # Wednesday
        3: "Чт",  # Thursday
        4: "Пт",  # Friday
        5: "Сб",  # Saturday
        6: "Вс",  # Sunday
    }

    @staticmethod
    async def get_weekly_activity(
        db: AsyncSession, user_id: UUID, days: int = 7
    ) -> List[Dict]:
        """
        Возвращает активность по дням за последние N дней.

        SQL запрос:
        SELECT
            DATE(started_at) as reading_date,
            SUM(duration_minutes) as total_minutes,
            COUNT(*) as sessions_count,
            SUM(end_position - start_position) as total_progress
        FROM reading_sessions
        WHERE user_id = :user_id
            AND started_at >= NOW() - INTERVAL 'N days'
            AND is_active = false
        GROUP BY DATE(started_at)
        ORDER BY reading_date DESC;

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя
            days: Количество дней для анализа (по умолчанию 7)

        Returns:
            Список с активностью по дням:
            [
                {
                    "date": "2025-10-26",
                    "day": "Вс",
                    "minutes": 45,
                    "sessions": 2,
                    "progress": 12
                },
                ...
            ]

            ВАЖНО: Массив ВСЕГДА содержит ровно `days` элементов.
            Дни без активности заполняются нулями.
        """
        # Расчет временного диапазона
        now = datetime.now(timezone.utc)
        start_date = (now - timedelta(days=days - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        # SQL запрос для агрегации сессий по дням
        # Фильтруем аномальные сессии (> MAX_VALID_SESSION_DURATION)
        query = (
            select(
                cast(ReadingSession.started_at, Date).label("reading_date"),
                func.sum(ReadingSession.duration_minutes).label("total_minutes"),
                func.count(ReadingSession.id).label("sessions_count"),
                func.sum(
                    ReadingSession.end_position - ReadingSession.start_position
                ).label("total_progress"),
            )
            .where(ReadingSession.user_id == user_id)
            .where(ReadingSession.started_at >= start_date)
            .where(ReadingSession.is_active == False)  # noqa: E712
            .where(ReadingSession.duration_minutes <= MAX_VALID_SESSION_DURATION)
            .group_by(cast(ReadingSession.started_at, Date))
            .order_by(cast(ReadingSession.started_at, Date).desc())
        )

        result = await db.execute(query)
        rows = result.fetchall()

        # Создаем словарь для быстрого доступа к данным по датам
        activity_by_date = {}
        for row in rows:
            reading_date = row.reading_date
            activity_by_date[reading_date] = {
                "date": reading_date.isoformat(),
                "day": UserStatisticsService.WEEKDAY_NAMES_RU[reading_date.weekday()],
                "minutes": int(row.total_minutes or 0),
                "sessions": int(row.sessions_count or 0),
                "progress": int(row.total_progress or 0),
            }

        # Заполняем массив за последние N дней (включая дни без активности)
        weekly_activity = []
        for i in range(days):
            # Считаем дни в обратном порядке от сегодня
            current_date = (now - timedelta(days=i)).date()

            if current_date in activity_by_date:
                # Есть активность за этот день
                weekly_activity.append(activity_by_date[current_date])
            else:
                # Нет активности - заполняем нулями
                weekly_activity.append(
                    {
                        "date": current_date.isoformat(),
                        "day": UserStatisticsService.WEEKDAY_NAMES_RU[
                            current_date.weekday()
                        ],
                        "minutes": 0,
                        "sessions": 0,
                        "progress": 0,
                    }
                )

        return weekly_activity

    @staticmethod
    async def get_reading_streak(db: AsyncSession, user_id: UUID) -> int:
        """
        Подсчитывает reading streak (сколько дней подряд читал).

        Алгоритм:
        1. Получить все уникальные даты чтения (DATE(started_at))
        2. Отсортировать по убыванию от последнего дня
        3. Проверить: streak активен (последний день = сегодня ИЛИ вчера)?
        4. Если НЕТ - streak = 0 (прерван)
        5. Если ДА - считать последовательные дни назад от последнего дня

        Примеры:
        - Читал [1,2,3,4,5,6,7], сегодня день 8 (не читал) → streak = 7 дней
        - Читал [1,2,3,5,6,7], сегодня день 8 (не читал) → streak = 3 дня
        - Читал [1,2,3,4,5], сегодня день 8 (не читал 3 дня) → streak = 0
        - Читал сегодня, но не читал вчера → streak = 1
        - Читал вчера, но не сегодня → streak сохраняется

        ИСПРАВЛЕНО P1-4: Streak НЕ сбрасывается в 0, если пользователь не читал
        только сегодня, но читал вчера. Streak сбрасывается только если
        последний день чтения был > 1 дня назад.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Количество последовательных дней чтения (активный streak)
        """
        # Получаем все уникальные даты чтения пользователя
        query = (
            select(cast(ReadingSession.started_at, Date).label("reading_date"))
            .where(ReadingSession.user_id == user_id)
            .where(ReadingSession.is_active == False)  # noqa: E712
            .distinct()
            .order_by(cast(ReadingSession.started_at, Date).desc())
        )

        result = await db.execute(query)
        reading_dates = [row.reading_date for row in result.fetchall()]

        if not reading_dates:
            # Нет завершенных сессий
            return 0

        # Получаем сегодняшнюю дату и вчера (без времени)
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        last_reading_date = reading_dates[0]

        # Streak активен, если последний день чтения = сегодня ИЛИ вчера
        # Если не читал 2+ дней - streak прерван
        if last_reading_date not in [today, yesterday]:
            return 0

        # Считаем последовательные дни от последнего дня чтения
        streak = 1  # Последний день считается
        expected_date = last_reading_date - timedelta(days=1)

        for reading_date in reading_dates[1:]:
            if reading_date == expected_date:
                # Читал в ожидаемый день
                streak += 1
                expected_date -= timedelta(days=1)
            else:
                # Пропуск - streak прерван
                break

        return streak

    @staticmethod
    async def get_total_reading_time(db: AsyncSession, user_id: UUID) -> int:
        """
        Возвращает общее время чтения в минутах.

        Фильтрует сессии с аномальной длительностью (> MAX_VALID_SESSION_DURATION).

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Общее количество минут чтения
        """
        query = select(func.sum(ReadingSession.duration_minutes)).where(
            ReadingSession.user_id == user_id,
            ReadingSession.is_active == False,  # noqa: E712
            # Filter out orphaned/invalid sessions with unreasonable duration
            ReadingSession.duration_minutes <= MAX_VALID_SESSION_DURATION,
        )

        result = await db.execute(query)
        total_minutes = result.scalar()

        return int(total_minutes or 0)

    @staticmethod
    async def get_average_reading_speed(db: AsyncSession, user_id: UUID) -> float:
        """
        Вычисляет среднюю скорость чтения в WPM (words per minute).

        Используется reading_speed_wpm из таблицы reading_progress
        и усредняется по всем книгам с данными о скорости.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Средняя скорость в WPM (слов в минуту)
            0.0 если данных нет
        """
        query = select(func.avg(ReadingProgress.reading_speed_wpm)).where(
            ReadingProgress.user_id == user_id,
            ReadingProgress.reading_speed_wpm > 0,  # Только валидные значения
        )

        result = await db.execute(query)
        avg_speed = result.scalar()

        return round(float(avg_speed or 0.0), 1)

    @staticmethod
    async def get_books_count_by_status(
        db: AsyncSession, user_id: UUID
    ) -> Dict[str, int]:
        """
        Возвращает количество книг по статусам:
        - total: Все книги
        - in_progress: Книги в процессе чтения
        - completed: Прочитанные книги

        Логика:
        - completed: Если прогресс >= 95%
        - in_progress: Если есть reading_progress и 0 < прогресс < 95%
        - total: Общее количество книг

        CFI-aware расчет прогресса (в SQL):
        - Для EPUB (reading_location_cfi IS NOT NULL): current_position уже содержит точный %
        - Для legacy: формула ((current_chapter - 1) + current_position/100) / total_chapters * 100

        ОПТИМИЗАЦИЯ (December 2025): Использует SQL COUNT и CASE вместо загрузки
        всех книг в память. Подсчет выполняется на стороне базы данных.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Словарь с количествами книг по статусам
        """
        from ..models.chapter import Chapter

        # Общее количество книг (простой COUNT)
        total_query = select(func.count(Book.id)).where(Book.user_id == user_id)
        total_result = await db.execute(total_query)
        total_books = total_result.scalar() or 0

        # Подзапрос для подсчета глав каждой книги (для legacy режима)
        chapter_counts = (
            select(Chapter.book_id, func.count(Chapter.id).label("chapter_count"))
            .group_by(Chapter.book_id)
            .subquery()
        )

        # SQL CASE для подсчета книг по статусам
        # CFI mode: reading_location_cfi IS NOT NULL -> current_position содержит точный %
        # Legacy mode: формула на основе глав
        status_query = (
            select(
                func.count(
                    case(
                        # CFI mode: completed (>= 95%)
                        (
                            and_(
                                ReadingProgress.reading_location_cfi.isnot(None),
                                ReadingProgress.current_position >= 95,
                            ),
                            Book.id,
                        ),
                        # Legacy mode: completed (>= 95%)
                        # progress = ((current_chapter - 1) + current_position/100) / total_chapters * 100
                        (
                            and_(
                                ReadingProgress.reading_location_cfi.is_(None),
                                func.coalesce(chapter_counts.c.chapter_count, 0) > 0,
                                (
                                    (
                                        cast(ReadingProgress.current_chapter - 1, Float)
                                        + cast(ReadingProgress.current_position, Float)
                                        / 100.0
                                    )
                                    / cast(chapter_counts.c.chapter_count, Float)
                                )
                                >= 0.95,
                            ),
                            Book.id,
                        ),
                    )
                ).label("completed"),
                func.count(
                    case(
                        # CFI mode: in_progress (0 < progress < 95)
                        (
                            and_(
                                ReadingProgress.reading_location_cfi.isnot(None),
                                ReadingProgress.current_position > 0,
                                ReadingProgress.current_position < 95,
                            ),
                            Book.id,
                        ),
                        # Legacy mode: in_progress (0 < progress < 95)
                        (
                            and_(
                                ReadingProgress.reading_location_cfi.is_(None),
                                func.coalesce(chapter_counts.c.chapter_count, 0) > 0,
                                (
                                    (
                                        cast(ReadingProgress.current_chapter - 1, Float)
                                        + cast(ReadingProgress.current_position, Float)
                                        / 100.0
                                    )
                                    / cast(chapter_counts.c.chapter_count, Float)
                                )
                                > 0,
                                (
                                    (
                                        cast(ReadingProgress.current_chapter - 1, Float)
                                        + cast(ReadingProgress.current_position, Float)
                                        / 100.0
                                    )
                                    / cast(chapter_counts.c.chapter_count, Float)
                                )
                                < 0.95,
                            ),
                            Book.id,
                        ),
                        # Legacy mode: in_progress fallback (no chapters but current_chapter > 1)
                        (
                            and_(
                                ReadingProgress.reading_location_cfi.is_(None),
                                func.coalesce(chapter_counts.c.chapter_count, 0) == 0,
                                ReadingProgress.current_chapter > 1,
                            ),
                            Book.id,
                        ),
                    )
                ).label("in_progress"),
            )
            .select_from(Book)
            .join(
                ReadingProgress,
                and_(
                    ReadingProgress.book_id == Book.id,
                    ReadingProgress.user_id == user_id,
                ),
            )
            .outerjoin(chapter_counts, chapter_counts.c.book_id == Book.id)
            .where(Book.user_id == user_id)
        )

        result = await db.execute(status_query)
        row = result.one()

        return {
            "total": total_books,
            "in_progress": row.in_progress or 0,
            "completed": row.completed or 0,
        }

    @staticmethod
    async def get_favorite_genres(
        db: AsyncSession, user_id: UUID, limit: int = 5
    ) -> List[Dict]:
        """
        Возвращает любимые жанры пользователя на основе количества книг.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя
            limit: Максимальное количество жанров (по умолчанию 5)

        Returns:
            Список жанров с количеством:
            [
                {"genre": "fantasy", "count": 6},
                {"genre": "sci-fi", "count": 4},
                ...
            ]
        """
        query = (
            select(Book.genre, func.count(Book.id).label("count"))
            .where(Book.user_id == user_id)
            .group_by(Book.genre)
            .order_by(func.count(Book.id).desc())
            .limit(limit)
        )

        result = await db.execute(query)
        rows = result.fetchall()

        return [{"genre": row.genre, "count": row.count} for row in rows]

    @staticmethod
    async def get_total_pages_read(db: AsyncSession, user_id: UUID) -> int:
        """
        Возвращает общее количество прочитанных страниц.

        Использует CFI-aware метод Book.get_reading_progress_percent()
        для корректного расчёта прогресса как для EPUB (CFI),
        так и для legacy форматов.

        ИСПРАВЛЕНО: Старая формула `total_pages * current_position / 100`
        некорректна для legacy записей, где current_position - это
        процент в ГЛАВЕ, а не общий прогресс по книге.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Общее количество прочитанных страниц
        """
        from sqlalchemy.orm import selectinload

        # Загружаем книги с прогрессом и главами для корректного расчёта
        books_query = (
            select(Book)
            .options(selectinload(Book.reading_progress))
            .options(selectinload(Book.chapters))
            .where(Book.user_id == user_id)
        )
        result = await db.execute(books_query)
        books = result.scalars().all()

        total_pages = 0
        for book in books:
            if not book.total_pages or book.total_pages == 0:
                continue

            # Используем CFI-aware метод для получения реального прогресса
            progress_percent = await book.get_reading_progress_percent(db, user_id)
            pages_read = int(book.total_pages * progress_percent / 100)
            total_pages += pages_read

        return total_pages

    @staticmethod
    async def get_total_chapters_read(db: AsyncSession, user_id: UUID) -> int:
        """
        Возвращает общее количество ПРОЧИТАННЫХ глав.

        current_chapter - это глава, которую ЧИТАЕТ пользователь (1-indexed).
        Прочитанные главы = current_chapter - 1.

        Пример:
        - Пользователь на главе 5 -> прочитано 4 главы
        - Пользователь на главе 1 -> прочитано 0 глав

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Общее количество прочитанных глав
        """
        # Используем GREATEST для защиты от отрицательных значений
        query = select(
            func.sum(func.greatest(ReadingProgress.current_chapter - 1, 0))
        ).where(ReadingProgress.user_id == user_id)

        result = await db.execute(query)
        total_chapters = result.scalar()

        return int(total_chapters or 0)

    @staticmethod
    async def get_average_reading_time_per_day(db: AsyncSession, user_id: UUID) -> int:
        """
        Возвращает среднее время чтения в минутах за день.

        Формула: total_minutes / days_with_reading_activity

        Это более точная метрика, чем деление на streak или на 7 дней,
        так как учитывает только дни с реальной активностью.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Среднее время в минутах (округлённое до целого)
        """
        # Получаем количество уникальных дней с активностью
        # Фильтруем аномальные сессии (> MAX_VALID_SESSION_DURATION)
        days_query = (
            select(func.count(func.distinct(cast(ReadingSession.started_at, Date))))
            .where(ReadingSession.user_id == user_id)
            .where(ReadingSession.is_active == False)  # noqa: E712
            .where(ReadingSession.duration_minutes >= 1)
            .where(ReadingSession.duration_minutes <= MAX_VALID_SESSION_DURATION)
        )
        days_result = await db.execute(days_query)
        days_count = days_result.scalar() or 0

        if days_count == 0:
            return 0

        # Общее время чтения
        total_minutes = await UserStatisticsService.get_total_reading_time(db, user_id)

        return total_minutes // days_count

    @staticmethod
    async def get_reading_streak_with_longest(
        db: AsyncSession, user_id: UUID
    ) -> Dict[str, int]:
        """
        Возвращает текущий и лучший streak.

        Автоматически обновляет longest_streak_days в User если
        текущий streak превышает сохраненный рекорд.

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Dict с ключами "current" и "longest"
        """
        from ..models.user import User

        current_streak = await UserStatisticsService.get_reading_streak(db, user_id)

        # Получаем пользователя для чтения/обновления longest_streak
        user = await db.get(User, user_id)
        if not user:
            return {"current": current_streak, "longest": current_streak}

        longest_streak = user.longest_streak_days or 0

        # Обновляем longest если текущий больше
        if current_streak > longest_streak:
            user.longest_streak_days = current_streak
            await db.commit()
            longest_streak = current_streak

        return {"current": current_streak, "longest": longest_streak}

    @staticmethod
    async def get_monthly_statistics(db: AsyncSession, user_id: UUID) -> Dict[str, int]:
        """
        Возвращает статистику чтения за текущий месяц.

        Включает:
        - books_this_month: количество книг начатых/читаемых этот месяц
        - reading_time_this_month: минуты чтения за этот месяц
        - pages_this_month: страницы прочитанные в этом месяце

        Args:
            db: Асинхронная сессия БД
            user_id: UUID пользователя

        Returns:
            Dict с ключами:
            - books_this_month: int
            - reading_time_this_month: int (минуты)
            - pages_this_month: int
        """
        # Начало текущего месяца
        now = datetime.now(timezone.utc)
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # 1. Время чтения за этот месяц (из reading_sessions)
        # Фильтруем аномальные сессии (> MAX_VALID_SESSION_DURATION)
        reading_time_query = select(func.sum(ReadingSession.duration_minutes)).where(
            ReadingSession.user_id == user_id,
            ReadingSession.started_at >= start_of_month,
            ReadingSession.is_active == False,  # noqa: E712
            ReadingSession.duration_minutes <= MAX_VALID_SESSION_DURATION,
        )
        reading_time_result = await db.execute(reading_time_query)
        reading_time_this_month = int(reading_time_result.scalar() or 0)

        # 2. Количество уникальных книг с активностью в этом месяце
        books_query = select(func.count(func.distinct(ReadingSession.book_id))).where(
            ReadingSession.user_id == user_id,
            ReadingSession.started_at >= start_of_month,
        )
        books_result = await db.execute(books_query)
        books_this_month = int(books_result.scalar() or 0)

        # 3. Страницы за этот месяц
        # Считаем прогресс на основе позиций в сессиях
        # Фильтруем аномальные сессии
        pages_query = select(
            func.sum(ReadingSession.end_position - ReadingSession.start_position)
        ).where(
            ReadingSession.user_id == user_id,
            ReadingSession.started_at >= start_of_month,
            ReadingSession.is_active == False,  # noqa: E712
            ReadingSession.duration_minutes <= MAX_VALID_SESSION_DURATION,
        )
        pages_result = await db.execute(pages_query)
        progress_this_month = int(pages_result.scalar() or 0)

        # progress - это разница позиций (0-100)
        # Для упрощенного подсчета: 1 единица прогресса ~ 1 страница
        pages_this_month = progress_this_month

        return {
            "books_this_month": books_this_month,
            "reading_time_this_month": reading_time_this_month,
            "pages_this_month": pages_this_month,
        }

    # =========================================================================
    # Redis Caching Methods (December 2025)
    # =========================================================================

    @staticmethod
    def _get_cache_key(user_id: UUID) -> str:
        """
        Generate Redis cache key for user statistics.

        Args:
            user_id: UUID of the user

        Returns:
            Cache key in format: "user_stats:{user_id}"
        """
        return f"{USER_STATS_CACHE_KEY_PREFIX}:{user_id}"

    @staticmethod
    async def get_all_reading_statistics(
        db: AsyncSession, user_id: UUID, use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Get all reading statistics for a user with Redis caching.

        This method aggregates all statistics into a single call and caches
        the result in Redis with a 5-minute TTL. On cache miss or Redis
        unavailability, it falls back to direct database queries.

        Args:
            db: Async database session
            user_id: UUID of the user
            use_cache: Whether to use Redis cache (default: True)

        Returns:
            Dictionary with all reading statistics:
            {
                "total_books": int,
                "books_in_progress": int,
                "books_completed": int,
                "total_reading_time_minutes": int,
                "reading_streak_days": int,
                "longest_streak_days": int,
                "average_reading_speed_wpm": float,
                "favorite_genres": List[Dict],
                "weekly_activity": List[Dict],
                "total_pages_read": int,
                "total_chapters_read": int,
                "avg_minutes_per_day": int
            }

        Example:
            >>> stats = await UserStatisticsService.get_all_reading_statistics(db, user_id)
            >>> print(f"User has read {stats['total_books']} books")
        """
        cache_key = UserStatisticsService._get_cache_key(user_id)

        # Try to get from cache first
        if use_cache:
            try:
                cached_stats = await cache_manager.get(cache_key)
                if cached_stats is not None:
                    logger.debug(f"User statistics cache HIT for user {user_id}")
                    return cached_stats
            except Exception as e:
                # Redis error - log and continue to DB query
                logger.warning(f"Redis GET error for user stats {user_id}: {e}")

        # Cache miss or error - compute from database
        logger.debug(
            f"User statistics cache MISS for user {user_id}, computing from DB"
        )
        stats = await UserStatisticsService._compute_all_statistics(db, user_id)

        # Try to cache the result
        if use_cache:
            try:
                await cache_manager.set(cache_key, stats, ttl=USER_STATS_CACHE_TTL)
                logger.debug(
                    f"User statistics cached for user {user_id} "
                    f"(TTL: {USER_STATS_CACHE_TTL}s)"
                )
            except Exception as e:
                # Redis error - log but don't fail the request
                logger.warning(f"Redis SET error for user stats {user_id}: {e}")

        return stats

    @staticmethod
    async def _compute_all_statistics(
        db: AsyncSession, user_id: UUID
    ) -> Dict[str, Any]:
        """
        Compute all reading statistics from database.

        Internal method that performs all database queries to gather
        statistics. Called on cache miss.

        Args:
            db: Async database session
            user_id: UUID of the user

        Returns:
            Dictionary with all reading statistics
        """
        # Get books count by status
        books_stats = await UserStatisticsService.get_books_count_by_status(db, user_id)

        # Total reading time
        total_reading_time = await UserStatisticsService.get_total_reading_time(
            db, user_id
        )

        # Reading streak (current and longest)
        streak_data = await UserStatisticsService.get_reading_streak_with_longest(
            db, user_id
        )

        # Average reading speed
        avg_reading_speed = await UserStatisticsService.get_average_reading_speed(
            db, user_id
        )

        # Favorite genres (top 5)
        favorite_genres = await UserStatisticsService.get_favorite_genres(
            db, user_id, limit=5
        )

        # Weekly activity (last 7 days)
        weekly_activity = await UserStatisticsService.get_weekly_activity(
            db, user_id, days=7
        )

        # Total pages and chapters read
        total_pages = await UserStatisticsService.get_total_pages_read(db, user_id)
        total_chapters = await UserStatisticsService.get_total_chapters_read(
            db, user_id
        )

        # Average reading time per day
        avg_minutes_per_day = (
            await UserStatisticsService.get_average_reading_time_per_day(db, user_id)
        )

        # Monthly statistics
        monthly_stats = await UserStatisticsService.get_monthly_statistics(db, user_id)

        return {
            "total_books": books_stats["total"],
            "books_in_progress": books_stats["in_progress"],
            "books_completed": books_stats["completed"],
            "total_reading_time_minutes": total_reading_time,
            "reading_streak_days": streak_data["current"],
            "longest_streak_days": streak_data["longest"],
            "average_reading_speed_wpm": avg_reading_speed,
            "favorite_genres": favorite_genres,
            "weekly_activity": weekly_activity,
            "total_pages_read": total_pages,
            "total_chapters_read": total_chapters,
            "avg_minutes_per_day": avg_minutes_per_day,
            "books_this_month": monthly_stats["books_this_month"],
            "reading_time_this_month": monthly_stats["reading_time_this_month"],
            "pages_this_month": monthly_stats["pages_this_month"],
        }

    @staticmethod
    async def invalidate_user_stats_cache(user_id: UUID) -> bool:
        """
        Invalidate cached statistics for a user.

        Call this method when user data changes that would affect statistics:
        - Reading session ended
        - Book added/deleted
        - Reading progress updated

        Args:
            user_id: UUID of the user

        Returns:
            True if cache was invalidated, False on error

        Example:
            >>> await UserStatisticsService.invalidate_user_stats_cache(user_id)
        """
        cache_key = UserStatisticsService._get_cache_key(user_id)

        try:
            result = await cache_manager.delete(cache_key)
            if result:
                logger.debug(f"User statistics cache invalidated for user {user_id}")
            return result
        except Exception as e:
            logger.warning(f"Redis DELETE error for user stats {user_id}: {e}")
            return False
