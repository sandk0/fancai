"""
Модель целей чтения для fancai.

Содержит модель ReadingGoal для постановки и отслеживания целей чтения пользователями.
"""

from sqlalchemy import (
    String,
    DateTime,
    Boolean,
    ForeignKey,
    Float,
    Index,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
import uuid
import enum
from typing import TYPE_CHECKING, Optional
from datetime import datetime, timezone

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User


class GoalType(enum.Enum):
    """
    Типы целей чтения.

    BOOKS: Прочитать N книг
    MINUTES: Читать N минут
    PAGES: Прочитать N страниц
    STREAK: Читать N дней подряд (без пропусков)
    """

    BOOKS = "books"
    MINUTES = "minutes"
    PAGES = "pages"
    STREAK = "streak"


class GoalPeriod(enum.Enum):
    """
    Периоды для целей чтения.

    DAILY: Ежедневная цель
    WEEKLY: Еженедельная цель
    MONTHLY: Ежемесячная цель
    YEARLY: Годовая цель
    """

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class ReadingGoal(Base):
    """
    Модель цели чтения пользователя.

    Позволяет пользователям ставить различные цели по чтению:
    - Прочитать N книг за период
    - Читать N минут в день/неделю/месяц
    - Прочитать N страниц за период
    - Читать N дней подряд (streak)

    Attributes:
        id: Уникальный идентификатор цели
        user_id: ID пользователя (внешний ключ)
        goal_type: Тип цели (books, minutes, pages, streak)
        goal_period: Период цели (daily, weekly, monthly, yearly)
        target_value: Целевое значение (N книг, N минут, N страниц, N дней)
        current_value: Текущее значение (сколько выполнено)
        start_date: Дата начала периода цели
        end_date: Дата окончания периода цели
        is_active: Активна ли цель в данный момент
        is_completed: Выполнена ли цель
        completed_at: Когда была выполнена цель (nullable)
        last_progress_update: Когда последний раз обновлялся прогресс
        created_at: Дата создания цели
        updated_at: Дата последнего обновления

    Examples:
        >>> # Прочитать 5 книг в месяц
        >>> goal = ReadingGoal(
        ...     user_id=user_id,
        ...     goal_type=GoalType.BOOKS,
        ...     goal_period=GoalPeriod.MONTHLY,
        ...     target_value=5.0
        ... )

        >>> # Читать 30 минут каждый день
        >>> goal = ReadingGoal(
        ...     user_id=user_id,
        ...     goal_type=GoalType.MINUTES,
        ...     goal_period=GoalPeriod.DAILY,
        ...     target_value=30.0
        ... )

        >>> # Читать 7 дней подряд
        >>> goal = ReadingGoal(
        ...     user_id=user_id,
        ...     goal_type=GoalType.STREAK,
        ...     goal_period=GoalPeriod.WEEKLY,
        ...     target_value=7.0
        ... )
    """

    __tablename__ = "reading_goals"

    # Primary Key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True
    )

    # Foreign Key
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Goal Configuration
    goal_type: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # 'books', 'minutes', 'pages', 'streak'
    goal_period: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # 'daily', 'weekly', 'monthly', 'yearly'

    # Goal Values
    target_value: Mapped[float] = mapped_column(
        Float, nullable=False
    )  # Целевое значение (N книг, N минут, N страниц)
    current_value: Mapped[float] = mapped_column(
        Float, default=0.0, nullable=False
    )  # Текущее значение (прогресс)

    # Goal Period Dates
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    end_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # Goal Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, index=True
    )
    is_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Progress Tracking
    last_progress_update: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user: Mapped["User"] = relationship(
        "User", back_populates="reading_goals", lazy="raise"
    )

    # Constraints & Indexes
    __table_args__ = (
        # CHECK constraints для enum values
        CheckConstraint(
            "goal_type IN ('books', 'minutes', 'pages', 'streak')",
            name="ck_reading_goals_goal_type",
        ),
        CheckConstraint(
            "goal_period IN ('daily', 'weekly', 'monthly', 'yearly')",
            name="ck_reading_goals_goal_period",
        ),
        # CHECK constraints для values
        CheckConstraint(
            "target_value > 0",
            name="ck_reading_goals_target_value_positive",
        ),
        CheckConstraint(
            "current_value >= 0",
            name="ck_reading_goals_current_value_nonnegative",
        ),
        # CHECK constraint для dates
        CheckConstraint(
            "end_date >= start_date",
            name="ck_reading_goals_end_after_start",
        ),
        # Composite index: поиск активных целей пользователя
        Index("idx_reading_goals_user_active", "user_id", "is_active", "start_date"),
        # Composite index: поиск по типу и периоду
        Index("idx_reading_goals_type_period", "goal_type", "goal_period"),
        # Partial index: только активные цели
        Index(
            "idx_reading_goals_active_only",
            "user_id",
            "is_active",
            postgresql_where=(is_active.is_(True)),
        ),
        # Partial index: только завершенные цели
        Index(
            "idx_reading_goals_completed_only",
            "user_id",
            "is_completed",
            "completed_at",
            postgresql_where=(is_completed.is_(True)),
        ),
        # Composite index: period filtering (start_date, end_date)
        Index("idx_reading_goals_period_range", "user_id", "start_date", "end_date"),
        # Composite index: progress updates
        Index(
            "idx_reading_goals_progress_update",
            "user_id",
            "last_progress_update",
            "is_active",
        ),
    )

    def __repr__(self) -> str:
        """Строковое представление для отладки."""
        return (
            f"<ReadingGoal(id={self.id}, user_id={self.user_id}, "
            f"type={self.goal_type}, period={self.goal_period}, "
            f"progress={self.current_value}/{self.target_value})>"
        )

    def get_progress_percent(self) -> float:
        """
        Вычисляет прогресс выполнения цели в процентах.

        Returns:
            Прогресс от 0.0 до 100.0

        Examples:
            >>> goal = ReadingGoal(target_value=10.0, current_value=7.0)
            >>> goal.get_progress_percent()
            70.0

            >>> goal = ReadingGoal(target_value=10.0, current_value=15.0)
            >>> goal.get_progress_percent()  # Capped at 100
            100.0
        """
        if self.target_value <= 0:
            return 0.0

        progress = (self.current_value / self.target_value) * 100.0
        return min(100.0, max(0.0, progress))

    def is_goal_achieved(self) -> bool:
        """
        Проверяет, достигнута ли цель.

        Returns:
            True если current_value >= target_value

        Examples:
            >>> goal = ReadingGoal(target_value=10.0, current_value=10.0)
            >>> goal.is_goal_achieved()
            True

            >>> goal = ReadingGoal(target_value=10.0, current_value=9.5)
            >>> goal.is_goal_achieved()
            False
        """
        return self.current_value >= self.target_value

    def update_progress(self, value: float) -> None:
        """
        Обновляет прогресс выполнения цели.

        Args:
            value: Новое значение текущего прогресса

        Raises:
            ValueError: Если value отрицательное

        Examples:
            >>> goal = ReadingGoal(target_value=10.0, current_value=5.0)
            >>> goal.update_progress(7.0)
            >>> goal.current_value
            7.0
            >>> goal.is_completed
            False

            >>> goal.update_progress(10.0)
            >>> goal.is_completed
            True
        """
        if value < 0:
            raise ValueError("Progress value cannot be negative")

        self.current_value = value
        self.last_progress_update = datetime.now(timezone.utc)

        # Автоматически помечаем цель как выполненную
        if self.is_goal_achieved() and not self.is_completed:
            self.is_completed = True
            self.completed_at = datetime.now(timezone.utc)

    def increment_progress(self, delta: float) -> None:
        """
        Увеличивает прогресс на указанное значение.

        Args:
            delta: Значение для увеличения прогресса

        Examples:
            >>> goal = ReadingGoal(target_value=10.0, current_value=5.0)
            >>> goal.increment_progress(2.0)
            >>> goal.current_value
            7.0
        """
        new_value = self.current_value + delta
        self.update_progress(max(0.0, new_value))

    def reset_progress(self) -> None:
        """
        Сбрасывает прогресс цели до 0.

        Полезно для повторяющихся целей (daily, weekly, monthly).

        Examples:
            >>> goal = ReadingGoal(
            ...     target_value=30.0,
            ...     current_value=30.0,
            ...     is_completed=True
            ... )
            >>> goal.reset_progress()
            >>> goal.current_value
            0.0
            >>> goal.is_completed
            False
            >>> goal.completed_at is None
            True
        """
        self.current_value = 0.0
        self.is_completed = False
        self.completed_at = None
        self.last_progress_update = datetime.now(timezone.utc)

    def is_goal_period_active(self) -> bool:
        """
        Проверяет, находится ли текущее время в периоде цели.

        Returns:
            True если сейчас между start_date и end_date

        Examples:
            >>> from datetime import datetime, timedelta, timezone
            >>> now = datetime.now(timezone.utc)
            >>> goal = ReadingGoal(
            ...     start_date=now - timedelta(days=1),
            ...     end_date=now + timedelta(days=1)
            ... )
            >>> goal.is_goal_period_active()
            True

            >>> goal = ReadingGoal(
            ...     start_date=now + timedelta(days=1),
            ...     end_date=now + timedelta(days=2)
            ... )
            >>> goal.is_goal_period_active()
            False
        """
        now = datetime.now(timezone.utc)
        return self.start_date <= now <= self.end_date

    def deactivate(self) -> None:
        """
        Деактивирует цель.

        Examples:
            >>> goal = ReadingGoal(is_active=True)
            >>> goal.deactivate()
            >>> goal.is_active
            False
        """
        self.is_active = False
