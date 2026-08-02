"""
Celery задачи для управления reading sessions в fancai.

Содержит периодические задачи для автоматического закрытия
заброшенных сессий чтения и очистки данных.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List
from sqlalchemy import select, and_, func

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.models.reading_session import ReadingSession

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.close_abandoned_sessions",
    bind=True,
    max_retries=3,
    default_retry_delay=300,  # 5 minutes
)
def close_abandoned_sessions(self) -> dict:
    """
    Периодическая задача для закрытия заброшенных reading sessions.

    Закрывает сессии где:
    - is_active=True
    - Прошло более 2 часов с started_at
    - ended_at is NULL

    Для каждой заброшенной сессии:
    - Устанавливает is_active=False
    - Устанавливает ended_at=now
    - Устанавливает end_position=start_position (если не было прогресса)
    - Вычисляет duration_minutes

    Returns:
        dict: Статистика выполнения задачи
            {
                "closed_count": int,
                "execution_time_ms": float,
                "error": str (optional)
            }

    Example:
        >>> result = close_abandoned_sessions.delay()
        >>> print(result.get())
        {"closed_count": 15, "execution_time_ms": 234.5}
    """
    start_time = datetime.now(timezone.utc)
    closed_count = 0
    error_message = None

    try:
        logger.info("Starting close_abandoned_sessions task")

        # Вычисляем deadline: сессии старше 2 часов
        deadline = datetime.now(timezone.utc) - timedelta(hours=2)

        # Синхронно вызываем async функцию
        from app.tasks.common import run_async

        closed_count = run_async(_close_abandoned_sessions_impl(deadline))

        execution_time_ms = (
            datetime.now(timezone.utc) - start_time
        ).total_seconds() * 1000

        logger.info(
            f"Closed {closed_count} abandoned sessions in {execution_time_ms:.2f}ms"
        )

        return {
            "closed_count": closed_count,
            "execution_time_ms": execution_time_ms,
            "deadline": deadline.isoformat(),
        }

    except Exception as e:
        error_message = str(e)
        logger.error(
            f"Error closing abandoned sessions: {error_message}",
            exc_info=True,
        )

        # Retry с exponential backoff
        try:
            raise self.retry(exc=e, countdown=2**self.request.retries * 60)
        except self.MaxRetriesExceededError:
            logger.error("Max retries exceeded for close_abandoned_sessions")

        return {
            "closed_count": closed_count,
            "execution_time_ms": (
                datetime.now(timezone.utc) - start_time
            ).total_seconds()
            * 1000,
            "error": error_message,
        }


async def _close_abandoned_sessions_impl(deadline: datetime) -> int:
    """
    Внутренняя async реализация закрытия заброшенных сессий.

    Args:
        deadline: Время, до которого сессии считаются заброшенными

    Returns:
        Количество закрытых сессий
    """
    async with AsyncSessionLocal() as db:
        try:
            # Находим все активные сессии старше deadline
            query = select(ReadingSession).where(
                and_(
                    ReadingSession.is_active.is_(True),
                    ReadingSession.started_at < deadline,
                    ReadingSession.ended_at.is_(None),
                )
            )

            result = await db.execute(query)
            abandoned_sessions: List[ReadingSession] = list(result.scalars().all())

            if not abandoned_sessions:
                logger.info("No abandoned sessions found")
                return 0

            logger.info(f"Found {len(abandoned_sessions)} abandoned sessions")

            # Закрываем каждую сессию
            closed_count = 0
            now = datetime.now(timezone.utc)

            for session in abandoned_sessions:
                try:
                    # Если end_position не установлен, используем start_position
                    # (пользователь открыл книгу но не читал)
                    end_position = (
                        session.end_position
                        if session.end_position > 0
                        else session.start_position
                    )

                    # Вызываем метод модели для закрытия сессии
                    session.end_session(end_position=end_position, ended_at=now)

                    closed_count += 1

                    logger.debug(
                        f"Closed session {session.id} for user {session.user_id}, "
                        f"book {session.book_id}, duration {session.duration_minutes}min"
                    )

                except Exception as e:
                    logger.warning(
                        f"Failed to close session {session.id}: {e}",
                        exc_info=True,
                    )
                    continue

            # Commit всех изменений
            await db.commit()

            logger.info(
                f"Successfully closed {closed_count}/{len(abandoned_sessions)} sessions"
            )

            return closed_count

        except Exception as e:
            await db.rollback()
            logger.error(
                f"Database error while closing sessions: {e}",
                exc_info=True,
            )
            raise


@celery_app.task(name="app.tasks.get_cleanup_statistics")
def get_cleanup_statistics(hours: int = 24) -> dict:
    """
    Возвращает статистику закрытых сессий за последние N часов.

    Args:
        hours: Количество часов для анализа (по умолчанию 24)

    Returns:
        dict: Статистика
            {
                "total_closed": int,
                "total_active": int,
                "avg_duration_minutes": float,
                "period_hours": int
            }

    Example:
        >>> stats = get_cleanup_statistics.delay(hours=24)
        >>> print(stats.get())
        {"total_closed": 150, "total_active": 45, "avg_duration_minutes": 23.5}
    """
    from app.tasks.common import run_async

    return run_async(_get_cleanup_statistics_impl(hours))


async def _get_cleanup_statistics_impl(hours: int) -> dict:
    """
    Внутренняя async реализация получения статистики.

    Args:
        hours: Период для анализа

    Returns:
        Словарь со статистикой
    """
    async with AsyncSessionLocal() as db:
        try:
            # Временной порог
            time_threshold = datetime.now(timezone.utc) - timedelta(hours=hours)

            # Количество закрытых сессий за период
            closed_query = select(func.count(ReadingSession.id)).where(
                and_(
                    ReadingSession.is_active.is_(False),
                    ReadingSession.ended_at >= time_threshold,
                    ReadingSession.ended_at.is_not(None),
                )
            )
            total_closed = await db.scalar(closed_query) or 0

            # Количество активных сессий
            active_query = select(func.count(ReadingSession.id)).where(
                ReadingSession.is_active.is_(True)
            )
            total_active = await db.scalar(active_query) or 0

            # Средняя длительность закрытых сессий
            avg_duration_query = select(
                func.avg(ReadingSession.duration_minutes)
            ).where(
                and_(
                    ReadingSession.is_active.is_(False),
                    ReadingSession.ended_at >= time_threshold,
                    ReadingSession.ended_at.is_not(None),
                )
            )
            avg_duration = await db.scalar(avg_duration_query) or 0.0

            # Количество сессий без прогресса (end_position == start_position)
            no_progress_query = select(func.count(ReadingSession.id)).where(
                and_(
                    ReadingSession.is_active.is_(False),
                    ReadingSession.ended_at >= time_threshold,
                    ReadingSession.end_position == ReadingSession.start_position,
                )
            )
            no_progress_count = await db.scalar(no_progress_query) or 0

            return {
                "total_closed": total_closed,
                "total_active": total_active,
                "avg_duration_minutes": round(float(avg_duration), 2),
                "no_progress_count": no_progress_count,
                "period_hours": hours,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error(f"Error getting cleanup statistics: {e}", exc_info=True)
            raise
