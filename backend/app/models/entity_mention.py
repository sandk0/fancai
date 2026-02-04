"""
Модель упоминания сущности в тексте.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .chapter import Chapter
    from .entity import Entity


class EntityMention(Base):
    """
    Упоминание сущности в конкретной главе.

    Связывает Chapter и Entity (Many-to-Many with attributes).
    Позволяет точно знать, ГДЕ и КАК упоминался персонаж.
    """

    __tablename__ = "entity_mentions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    chapter_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Контекст упоминания
    mention_text: Mapped[str] = mapped_column(
        String(500), nullable=False
    )  # Текст, который нашли (например "Геральт" или "Белый Волк")
    context: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # Окружающий текст для контекста

    # Позиция в тексте (для подсветки/навигации)
    start_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # CFI position for precise spoiler protection (e.g., "epubcfi(/6/4!/4/2:0)")
    mention_cfi: Mapped[str | None] = mapped_column(
        String(500), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="mentions")
    entity: Mapped["Entity"] = relationship("Entity", back_populates="mentions")

    def __repr__(self) -> str:
        return f"<EntityMention(chapter={self.chapter_id}, entity={self.entity_id}, text='{self.mention_text}')>"
