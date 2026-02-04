"""
Модель связей между сущностями (Knowledge Graph Edges).
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import String, Integer, ForeignKey, Index, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .entity import Entity


class EntityRelationship(Base):
    """
    Связь графа (Adjacency List Pattern).

    Attributes:
        source_id: ID сущности-источника
        target_id: ID сущности-цели
        type: Тип связи (KINSHIP, ALLY, ENEMY, etc.)
        weight: Вес связи (-100..100)
        relationship_metadata: JSON с контекстом (почему они связаны)
    """

    __tablename__ = "entity_relationships"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    source_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # KINSHIP, ALLY, ENEMY
    weight: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # -100 (Enemy) to +100 (Soulmate)

    first_interaction_cfi: Mapped[str | None] = mapped_column(
        String(500), nullable=True, index=True
    )
    first_interaction_chapter: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )

    relationship_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default={}, nullable=False
    )

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
    source: Mapped["Entity"] = relationship(
        "Entity", foreign_keys=[source_id], back_populates="outgoing_relations"
    )
    target: Mapped["Entity"] = relationship(
        "Entity", foreign_keys=[target_id], back_populates="incoming_relations"
    )

    # Composite Index for fast lookup of "All friends of X"
    __table_args__ = (Index("idx_source_type", "source_id", "type"),)

    def __repr__(self) -> str:
        return (
            f"<EntityRelationship({self.source_id} -> {self.target_id} [{self.type}])>"
        )
