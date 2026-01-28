from datetime import datetime
from typing import Any, TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import String, Text, ForeignKey, Integer, DateTime, func, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB, ENUM as PG_ENUM
from sqlalchemy.orm import relationship, Mapped, mapped_column

from ..core.database import Base

if TYPE_CHECKING:
    from .book import Book
    from .entity_mention import EntityMention
    from .description_entity import DescriptionEntity


class EntityType(enum.Enum):
    CHARACTER = "character"
    LOCATION = "location"
    OBJECT = "object"


entity_type_pg_enum = PG_ENUM(
    'character', 'location', 'object',
    name='entitytype',
    create_type=False
)


class Entity(Base):
    __tablename__ = "entities"
    __table_args__ = (
        Index(
            "ix_entities_book_id_name_lower",
            "book_id",
            func.lower("name"),
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    book_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    
    type: Mapped[str] = mapped_column(entity_type_pg_enum, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    visual_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    master_portrait_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    importance: Mapped[int | None] = mapped_column(Integer, default=5, nullable=True)
    linked_entity_ids: Mapped[list[Any] | None] = mapped_column(JSONB, default=[], nullable=True)
    
    entity_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default={}, nullable=False)
    
    first_mention_cfi: Mapped[str | None] = mapped_column(
        String(500), nullable=True, index=True,
        comment="CFI of first mention for spoiler protection"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    book: Mapped["Book"] = relationship("Book", backref="entities", lazy="raise")
    
    mentions: Mapped[list["EntityMention"]] = relationship(
        "EntityMention", back_populates="entity", cascade="all, delete-orphan", lazy="raise"
    )
    linked_descriptions: Mapped[list["DescriptionEntity"]] = relationship(
        "DescriptionEntity", back_populates="entity", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Entity(id={self.id}, name='{self.name}', type='{self.type}')>"
