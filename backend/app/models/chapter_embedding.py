"""
Модель chapter embeddings для pgvector поиска в fancai.

Хранит vector embeddings текстовых чанков глав для контекстного
обогащения при entity synthesis.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import (
    Integer,
    Text,
    ForeignKey,
    DateTime,
    func,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from ..core.database import Base

if TYPE_CHECKING:
    from .chapter import Chapter


class ChapterEmbedding(Base):
    __tablename__ = "chapter_embeddings"
    __table_args__ = (
        UniqueConstraint(
            "chapter_id", "chunk_index", name="uq_chapter_embeddings_chapter_chunk"
        ),
        Index(
            "ix_chapter_embeddings_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    chapter_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(Vector(384), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    chapter: Mapped["Chapter"] = relationship("Chapter", lazy="raise")

    def __repr__(self) -> str:
        return (
            f"<ChapterEmbedding(id={self.id}, chapter_id={self.chapter_id}, "
            f"chunk_index={self.chunk_index})>"
        )
