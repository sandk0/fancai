"""
Модель событий сущности по главам (Entity Events).

Хранит что персонаж ДЕЛАЕТ и ЧУВСТВУЕТ в каждой главе.
Используется для timeline и recap.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Text, Integer, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .entity import Entity
    from .chapter import Chapter


class EntityEvent(Base):
    __tablename__ = "entity_events"
    __table_args__ = (
        Index("idx_entity_events_entity_chapter", "entity_id", "chapter_number"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4
    )
    entity_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    event_action: Mapped[str] = mapped_column(Text, nullable=False)
    event_inner_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    entity: Mapped["Entity"] = relationship(
        "Entity", back_populates="events", lazy="raise"
    )
    chapter: Mapped["Chapter"] = relationship("Chapter", lazy="raise")

    def __repr__(self) -> str:
        return f"<EntityEvent(entity={self.entity_id}, ch={self.chapter_number}, action='{self.event_action[:30]}')>"
