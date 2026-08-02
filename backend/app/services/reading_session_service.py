"""
Reading Session Service для оптимизированных query operations.

Содержит оптимизированные database queries с eager loading,
cursor-based pagination и background task coordination.
"""

import logging
from typing import Optional, List, Dict, Any, Tuple
from uuid import UUID
from datetime import datetime, timezone, timedelta
import base64
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import joinedload

from ..models.reading_session import ReadingSession
from ..core.exceptions import ReadingSessionNotFoundException

logger = logging.getLogger(__name__)

# ============================================================================
# Constants
# ============================================================================

# Maximum duration for a single reading session (in minutes)
# Sessions longer than this are considered orphaned/invalid
MAX_SESSION_DURATION_MINUTES = 240  # 4 hours


# ============================================================================
# Cursor Encoding/Decoding для pagination
# ============================================================================


class PaginationCursor:
    """
    Курсор для cursor-based pagination.

    Attributes:
        timestamp: Время для сортировки (started_at)
        id: UUID сессии для стабильной сортировки
    """

    def __init__(self, timestamp: datetime, session_id: UUID):
        self.timestamp = timestamp
        self.session_id = session_id

    def encode(self) -> str:
        """
        Кодирует курсор в base64 строку.

        Returns:
            Base64 encoded cursor string
        """
        cursor_data = {
            "timestamp": self.timestamp.isoformat(),
            "id": str(self.session_id),
        }
        cursor_json = json.dumps(cursor_data)
        cursor_bytes = cursor_json.encode("utf-8")
        return base64.urlsafe_b64encode(cursor_bytes).decode("utf-8")

    @classmethod
    def decode(cls, cursor_str: str) -> "PaginationCursor":
        """
        Декодирует base64 строку в курсор.

        Args:
            cursor_str: Base64 encoded cursor

        Returns:
            PaginationCursor instance

        Raises:
            ValueError: При невалидном cursor формате
        """
        try:
            cursor_bytes = base64.urlsafe_b64decode(cursor_str.encode("utf-8"))
            cursor_json = cursor_bytes.decode("utf-8")
            cursor_data = json.loads(cursor_json)

            timestamp = datetime.fromisoformat(cursor_data["timestamp"])
            session_id = UUID(cursor_data["id"])

            return cls(timestamp, session_id)
        except Exception as e:
            raise ValueError(f"Invalid cursor format: {str(e)}")


# ============================================================================
# Reading Session Service
# ============================================================================


class ReadingSessionService:
    """
    Service для оптимизированных операций с reading sessions.

    Features:
    - Eager loading (joinedload/selectinload) для предотвращения N+1 queries
    - Cursor-based pagination для стабильной пагинации
    - Batch operations для массовых обновлений
    - Query optimization для высокой производительности
    """

    @staticmethod
    async def get_user_sessions_optimized(
        db: AsyncSession,
        user_id: UUID,
        limit: int = 20,
        cursor: Optional[str] = None,
        book_id: Optional[UUID] = None,
    ) -> Tuple[List[ReadingSession], Optional[str], int]:
        """
        Получает сессии пользователя с cursor-based pagination.

        Использует eager loading для предотвращения N+1 queries.

        Args:
            db: AsyncSession для БД
            user_id: UUID пользователя
            limit: Максимум сессий для возврата
            cursor: Cursor для пагинации (опционально)
            book_id: Фильтр по книге (опционально)

        Returns:
            Tuple: (sessions, next_cursor, total_count)

        Example:
            >>> sessions, next_cursor, total = await ReadingSessionService.get_user_sessions_optimized(
            ...     db, user_id, limit=20
            ... )
            >>> print(f"Found {len(sessions)} sessions, total: {total}")
        """
        # Базовый query с eager loading
        query = (
            select(ReadingSession)
            .options(
                joinedload(ReadingSession.book),  # Eager load book
                joinedload(ReadingSession.user),  # Eager load user
            )
            .where(ReadingSession.user_id == user_id)
        )

        # Фильтр по книге (опционально)
        if book_id:
            query = query.where(ReadingSession.book_id == book_id)

        # Cursor-based pagination
        if cursor:
            try:
                decoded_cursor = PaginationCursor.decode(cursor)
                # Фильтруем сессии после курсора
                query = query.where(
                    or_(
                        ReadingSession.started_at < decoded_cursor.timestamp,
                        and_(
                            ReadingSession.started_at == decoded_cursor.timestamp,
                            ReadingSession.id < decoded_cursor.session_id,
                        ),
                    )
                )
            except ValueError as e:
                logger.warning(f"Invalid cursor: {str(e)}")

        # Сортировка по started_at DESC + id DESC (stable sort)
        query = query.order_by(
            ReadingSession.started_at.desc(), ReadingSession.id.desc()
        )

        # Fetch limit + 1 для определения has_next
        query = query.limit(limit + 1)

        # Выполняем запрос
        result = await db.execute(query)
        sessions = list(result.unique().scalars().all())

        # Определяем next_cursor и has_next
        has_next = len(sessions) > limit
        if has_next:
            sessions = sessions[:limit]  # Удаляем лишнюю сессию

        next_cursor = None
        if has_next and sessions:
            last_session = sessions[-1]
            cursor_obj = PaginationCursor(last_session.started_at, last_session.id)
            next_cursor = cursor_obj.encode()

        # Считаем total count (опционально, может быть expensive)
        count_query = select(func.count(ReadingSession.id)).where(
            ReadingSession.user_id == user_id
        )
        if book_id:
            count_query = count_query.where(ReadingSession.book_id == book_id)

        count_result = await db.execute(count_query)
        total_count = count_result.scalar() or 0

        return sessions, next_cursor, total_count

    @staticmethod
    async def get_active_session_optimized(
        db: AsyncSession, user_id: UUID
    ) -> Optional[ReadingSession]:
        """
        Получает активную сессию пользователя с eager loading.

        Оптимизировано для частых запросов (используется в 90% reads).

        Args:
            db: AsyncSession для БД
            user_id: UUID пользователя

        Returns:
            ReadingSession если найдена активная сессия, иначе None
        """
        query = (
            select(ReadingSession)
            .options(
                joinedload(ReadingSession.book),  # Eager load book
            )
            .where(
                ReadingSession.user_id == user_id,
                ReadingSession.is_active == True,  # noqa: E712
            )
        )

        result = await db.execute(query)
        session = result.unique().scalar_one_or_none()

        return session

    @staticmethod
    async def get_session_by_id_optimized(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> Optional[ReadingSession]:
        """
        Получает сессию по ID с eager loading и проверкой владельца.

        Args:
            db: AsyncSession для БД
            session_id: UUID сессии
            user_id: UUID пользователя (для проверки доступа)

        Returns:
            ReadingSession если найдена, иначе None

        Raises:
            ReadingSessionNotFoundException: Если сессия не найдена
        """
        query = (
            select(ReadingSession)
            .options(
                joinedload(ReadingSession.book),
                joinedload(ReadingSession.user),
            )
            .where(ReadingSession.id == session_id, ReadingSession.user_id == user_id)
        )

        result = await db.execute(query)
        session = result.unique().scalar_one_or_none()

        if not session:
            raise ReadingSessionNotFoundException(session_id)

        return session

    @staticmethod
    async def get_user_reading_streak(
        db: AsyncSession, user_id: UUID, days: int = 30
    ) -> Dict[str, Any]:
        """
        Вычисляет reading streak пользователя за последние N дней.

        Args:
            db: AsyncSession для БД
            user_id: UUID пользователя
            days: Количество дней для анализа (default: 30)

        Returns:
            Словарь с метриками streak:
            - current_streak: текущая серия (дни подряд)
            - longest_streak: максимальная серия за период
            - total_reading_days: всего дней с чтением
            - days_without_reading: дни без чтения
        """
        # Запрос сессий за последние N дней
        start_date = datetime.now(timezone.utc) - timedelta(days=days)

        query = (
            select(func.date(ReadingSession.started_at).label("date"))
            .where(
                ReadingSession.user_id == user_id,
                ReadingSession.started_at >= start_date,
                ReadingSession.is_active == False,  # noqa: E712
                ReadingSession.duration_minutes >= 1,  # Минимум 1 минута
            )
            .group_by(func.date(ReadingSession.started_at))
            .order_by(func.date(ReadingSession.started_at).desc())
        )

        result = await db.execute(query)
        reading_dates = [row[0] for row in result.all()]

        # Вычисляем streak
        current_streak = 0
        longest_streak = 0
        temp_streak = 0

        today = datetime.now(timezone.utc).date()
        expected_date = today

        for reading_date in reading_dates:
            if reading_date == expected_date:
                temp_streak += 1
                current_streak = (
                    temp_streak
                    if expected_date == today
                    or expected_date == today - timedelta(days=current_streak)
                    else 0
                )
                longest_streak = max(longest_streak, temp_streak)
                expected_date = expected_date - timedelta(days=1)
            elif reading_date < expected_date:
                # Gap in streak
                temp_streak = 1
                expected_date = reading_date - timedelta(days=1)
            else:
                break

        return {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "total_reading_days": len(reading_dates),
            "days_without_reading": days - len(reading_dates),
        }

    @staticmethod
    async def cleanup_orphan_active_sessions(
        db: AsyncSession, hours_threshold: int = 24
    ) -> int:
        """
        Завершает активные сессии старше N часов.

        Это необходимо для случаев когда:
        - Браузер был закрыт без корректного завершения
        - Потеряно соединение
        - Краш приложения

        Args:
            db: AsyncSession для БД
            hours_threshold: Порог в часах (default: 24)

        Returns:
            Количество завершённых сессий
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_threshold)

        query = select(ReadingSession).where(
            ReadingSession.is_active == True,  # noqa: E712
            ReadingSession.started_at < cutoff,
        )

        result = await db.execute(query)
        orphan_sessions = result.scalars().all()

        count = 0
        for session in orphan_sessions:
            # Завершаем сессию с последними известными данными
            session.is_active = False
            # Используем started_at как fallback, так как updated_at отсутствует в модели
            session.ended_at = datetime.now(timezone.utc)

            # Рассчитываем duration на основе started_at и ended_at
            # Cap to MAX_SESSION_DURATION_MINUTES to avoid stats pollution
            if session.started_at:
                raw_duration = int(
                    (session.ended_at - session.started_at).total_seconds() / 60
                )
                session.duration_minutes = min(
                    raw_duration, MAX_SESSION_DURATION_MINUTES
                )

            count += 1

        if count > 0:
            await db.commit()
            logger.info(
                f"Cleaned up {count} orphan active sessions "
                f"(older than {hours_threshold} hours)"
            )

        return count

    @staticmethod
    async def cleanup_old_inactive_sessions(
        db: AsyncSession, days_threshold: int = 90
    ) -> int:
        """
        Очищает старые неактивные сессии (архивирование или удаление).

        Используется в Celery scheduled task для maintenance.
        Автоматически завершает осиротевшие активные сессии перед удалением.

        Args:
            db: AsyncSession для БД
            days_threshold: Удалять сессии старше N дней (default: 90)

        Returns:
            Количество удаленных сессий
        """
        # Сначала завершаем осиротевшие активные сессии
        orphan_count = await ReadingSessionService.cleanup_orphan_active_sessions(db)
        if orphan_count > 0:
            logger.info(f"Pre-cleanup: closed {orphan_count} orphan active sessions")

        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_threshold)

        # Используется idx_reading_sessions_cleanup index
        query = select(ReadingSession).where(
            ReadingSession.is_active == False,  # noqa: E712
            ReadingSession.ended_at < cutoff_date,
        )

        result = await db.execute(query)
        old_sessions = result.scalars().all()

        count = len(old_sessions)

        # Удаляем старые сессии
        for session in old_sessions:
            await db.delete(session)

        if count > 0:
            await db.commit()

        logger.info(
            f"Cleaned up {count} old inactive sessions (older than {days_threshold} days)"
        )

        return count


# ============================================================================
# Global Service Instance
# ============================================================================

reading_session_service = ReadingSessionService()
