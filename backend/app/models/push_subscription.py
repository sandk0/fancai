"""
Model for Push Notification subscriptions in fancai.

Stores Web Push subscription information for each user device,
enabling PWA push notifications for book parsing completion,
image generation, and other events.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import String, ForeignKey, Index, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User


class PushSubscription(Base):
    """
    Model for storing Web Push subscriptions.

    Each subscription represents a unique browser/device endpoint for a user.
    Multiple devices per user are supported.

    Attributes:
        id: Unique identifier for the subscription
        user_id: Foreign key to the user who owns this subscription
        endpoint: The push service endpoint URL (unique per device)
        p256dh_key: The client's public key for encryption (P-256 curve)
        auth_key: Authentication secret for the subscription
        created_at: When the subscription was created
        updated_at: When the subscription was last updated
        is_active: Whether the subscription is still valid
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Push subscription data
    endpoint: Mapped[str] = mapped_column(
        String(500), unique=True, nullable=False, index=True
    )
    p256dh_key: Mapped[str] = mapped_column(String(200), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(50), nullable=False)

    # Status
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User", back_populates="push_subscriptions", lazy="raise"
    )

    # Composite index for user active subscriptions lookup
    __table_args__ = (
        Index("idx_push_subscriptions_user_active", "user_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<PushSubscription(id={self.id}, user_id={self.user_id}, endpoint='{self.endpoint[:50]}...')>"
