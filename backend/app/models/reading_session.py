"""
Модель сессий чтения для детальной аналитики в fancai.

Содержит модель ReadingSession для отслеживания индивидуальных сессий чтения.
"""

from sqlalchemy import (
    Integer,
    String,
    DateTime,
    Boolean,
    ForeignKey,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
import uuid
from typing import TYPE_CHECKING, Optional
from datetime import datetime, timezone

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User
    from .book import Book


class ReadingSession(Base):
    """
    Модель сессии чтения книги пользователем.

    Каждая сессия представляет собой непрерывный период чтения книги.
    Используется для детальной аналитики поведения пользователей:
    - Средняя длительность сессий
    - Количество прочитанных страниц за сессию
    - Паттерны чтения (время дня, дни недели)
    - Скорость чтения

    Attributes:
        id: Уникальный идентификатор сессии
        user_id: ID пользователя (внешний ключ)
        book_id: ID книги (внешний ключ)
        started_at: Когда началась сессия чтения
        ended_at: Когда закончилась сессия (nullable для активных)
        duration_minutes: Длительность сессии в минутах
        start_position: Позиция в начале сессии (0-100%)
        end_position: Позиция в конце сессии (0-100%)
        pages_read: Количество прочитанных страниц
        device_type: Тип устройства (mobile, tablet, desktop)
        is_active: Активна ли сессия в данный момент
        created_at: Дата создания записи
    """

    __tablename__ = "reading_sessions"

    # Primary Key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True
    )

    # Foreign Keys
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Сессия чтения
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Прогресс за сессию
    start_position: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # Позиция в начале (0-100%)
    end_position: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # Позиция в конце (0-100%)
    pages_read: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Метаданные
    device_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # mobile, tablet, desktop
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, index=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user: Mapped["User"] = relationship(
        "User", back_populates="reading_sessions", lazy="raise"
    )
    book: Mapped["Book"] = relationship(
        "Book", back_populates="reading_sessions", lazy="raise"
    )

    # Indexes для производительности
    __table_args__ = (
        # Поиск сессий пользователя по дате (сортировка по убыванию)
        Index("idx_reading_sessions_user_started", "user_id", "started_at"),
        # Поиск сессий по книге
        Index("idx_reading_sessions_book", "book_id", "started_at"),
        # Partial index для активных сессий
        Index(
            "idx_reading_sessions_active",
            "user_id",
            "is_active",
            postgresql_where=(is_active.is_(True)),
        ),
        # Composite index для weekly analytics (user + started_at)
        Index(
            "idx_reading_sessions_weekly", "user_id", "started_at", "duration_minutes"
        ),
    )

    def __repr__(self) -> str:
        """Строковое представление для отладки."""
        return (
            f"<ReadingSession(id={self.id}, user_id={self.user_id}, "
            f"book_id={self.book_id}, duration={self.duration_minutes}min, "
            f"active={self.is_active})>"
        )

    def end_session(
        self, end_position: int, ended_at: Optional[datetime] = None
    ) -> None:
        """
        Завершает активную сессию чтения.

        Args:
            end_position: Позиция в конце сессии (0-100%)
            ended_at: Время завершения (по умолчанию - текущее время UTC)

        Raises:
            ValueError: Если сессия уже завершена или end_position невалидный
        """
        if not self.is_active:
            raise ValueError("Сессия уже завершена")

        if not (0 <= end_position <= 100):
            raise ValueError("end_position должен быть в диапазоне 0-100")

        # Устанавливаем время завершения
        if ended_at is None:
            ended_at = datetime.now(timezone.utc)

        self.ended_at = ended_at
        self.end_position = end_position
        self.is_active = False

        # Вычисляем длительность в минутах
        if self.started_at:
            duration = (ended_at - self.started_at).total_seconds() / 60
            self.duration_minutes = max(0, int(duration))

    def get_progress_delta(self) -> int:
        """
        Возвращает разницу в прогрессе за сессию.

        Returns:
            Прогресс в процентах (может быть отрицательным если листал назад)

        Example:
            >>> session = ReadingSession(start_position=20, end_position=45)
            >>> session.get_progress_delta()
            25
        """
        return self.end_position - self.start_position

    def get_reading_speed_ppm(self) -> float:
        """
        Вычисляет скорость чтения в процентах книги за минуту.

        Returns:
            Скорость чтения (% книги / минута)
            0.0 если сессия активна или нет данных

        Example:
            >>> session = ReadingSession(
            ...     start_position=20,
            ...     end_position=45,
            ...     duration_minutes=30
            ... )
            >>> session.get_reading_speed_ppm()
            0.83  # (45-20)/30 = 25/30 ≈ 0.83% за минуту
        """
        if self.is_active or self.duration_minutes == 0:
            return 0.0

        progress_delta = self.get_progress_delta()
        if progress_delta <= 0:
            return 0.0

        return progress_delta / self.duration_minutes

    def is_valid_session(self, min_duration_minutes: int = 1) -> bool:
        """
        Проверяет, является ли сессия валидной для аналитики.

        Фильтрует сессии со слишком короткой длительностью или
        без прогресса (пользователь просто открыл книгу).

        Args:
            min_duration_minutes: Минимальная длительность в минутах (по умолчанию 1)

        Returns:
            True если сессия валидна для учета в статистике
        """
        # Активные сессии всегда валидны
        if self.is_active:
            return True

        # Проверяем минимальную длительность
        if self.duration_minutes < min_duration_minutes:
            return False

        # Проверяем, что был прогресс
        if self.get_progress_delta() <= 0:
            return False

        return True
