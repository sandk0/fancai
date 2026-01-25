"""
Модель пользователя для fancai.

Содержит модели User, Subscription и связанные таблицы.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import Integer, String, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .book import Book, ReadingProgress
    from .reading_session import ReadingSession
    from .reading_goal import ReadingGoal
    from .image import GeneratedImage
    from .push_subscription import PushSubscription


class SubscriptionPlan(enum.Enum):
    """Типы подписки."""

    FREE = "free"
    PREMIUM = "premium"
    ULTIMATE = "ultimate"


class SubscriptionStatus(enum.Enum):
    """Статусы подписки."""

    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    PENDING = "pending"


class User(Base):
    """
    Модель пользователя системы.

    Attributes:
        id: Уникальный идентификатор пользователя
        email: Email адрес (уникальный)
        password_hash: Хешированный пароль
        full_name: Полное имя пользователя
        is_active: Активен ли аккаунт
        is_verified: Подтвержден ли email
        created_at: Дата создания аккаунта
        updated_at: Дата последнего обновления
    """

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Статус аккаунта
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_admin: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Временные метки
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_login: Mapped[datetime | None] = mapped_column(nullable=True)

    # Статистика
    longest_streak_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # User preferences
    timezone: Mapped[str] = mapped_column(String(50), default="UTC", nullable=False)  # IANA timezone name (e.g., "Europe/Moscow")

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    books: Mapped[list["Book"]] = relationship(
        "Book", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )
    reading_progress: Mapped[list["ReadingProgress"]] = relationship(
        "ReadingProgress", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )
    reading_sessions: Mapped[list["ReadingSession"]] = relationship(
        "ReadingSession", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )
    reading_goals: Mapped[list["ReadingGoal"]] = relationship(
        "ReadingGoal", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )
    subscription: Mapped["Subscription | None"] = relationship(
        "Subscription",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="raise",
    )
    generated_images: Mapped[list["GeneratedImage"]] = relationship(
        "GeneratedImage", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )
    push_subscriptions: Mapped[list["PushSubscription"]] = relationship(
        "PushSubscription", back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}')>"


class Subscription(Base):
    """
    Модель подписки пользователя.

    Attributes:
        id: Уникальный идентификатор подписки
        user_id: ID пользователя (внешний ключ)
        plan: Тип подписки (FREE, PREMIUM, ULTIMATE)
        status: Статус подписки (ACTIVE, EXPIRED, CANCELLED)
        start_date: Дата начала подписки
        end_date: Дата окончания подписки
        auto_renewal: Автоматическое продление
    """

    __tablename__ = "subscriptions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    plan: Mapped[SubscriptionPlan] = mapped_column(
        SQLEnum(SubscriptionPlan), default=SubscriptionPlan.FREE, nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        SQLEnum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE, nullable=False
    )

    # Даты подписки
    start_date: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    end_date: Mapped[datetime | None] = mapped_column(nullable=True)

    # Настройки
    auto_renewal: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Использование лимитов
    books_uploaded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    images_generated_month: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_reset_date: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    # Временные метки
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user: Mapped["User"] = relationship("User", back_populates="subscription", lazy="raise")

    def __repr__(self) -> str:
        return f"<Subscription(id={self.id}, user_id={self.user_id}, plan={self.plan.value})>"

    def is_within_books_limit(self, limit: int) -> bool:
        """
        Проверяет, не превышен ли лимит загруженных книг.

        Args:
            limit: Максимальное количество книг для плана

        Returns:
            True если лимит не превышен
        """
        return self.books_uploaded < limit

    def is_within_generation_limit(self, limit: int) -> bool:
        """
        Проверяет, не превышен ли лимит генераций изображений за месяц.

        Args:
            limit: Максимальное количество генераций для плана

        Returns:
            True если лимит не превышен
        """
        return self.images_generated_month < limit
