"""
Модель связи Description <-> Entity (Many-to-Many).

Заменяет текстовое поле entities_mentioned в Description
на нормализованную связь через foreign keys.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Boolean, String, Float, ForeignKey, UniqueConstraint, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .description import Description
    from .entity import Entity


class DescriptionEntity(Base):
    """
    Связь между Description и Entity.

    Позволяет точно знать какие сущности упоминаются в каком описании,
    с confidence score и текстом упоминания.
    """

    __tablename__ = "description_entities"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    description_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("descriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    mention_cfi: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mention_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_focus: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("description_id", "entity_id", name="uq_description_entity"),
    )

    description: Mapped["Description"] = relationship(
        "Description", back_populates="linked_entities", lazy="raise"
    )
    entity: Mapped["Entity"] = relationship(
        "Entity", back_populates="linked_descriptions", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<DescriptionEntity(description={self.description_id}, entity={self.entity_id})>"
