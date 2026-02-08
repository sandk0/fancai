"""Модель токена сброса пароля."""

import uuid as uuid_module
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base


class PasswordResetToken(Base):
    """Токен для сброса пароля (OWASP-compliant)."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid_module.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4
    )
    user_id: Mapped[uuid_module.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )  # SHA-256 hex digest
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", lazy="raise")
