"""
Модель выделения текста для fancai.

Позволяет пользователям выделять текст с цветом и заметками в книгах.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User
    from .book import Book


class Highlight(Base):
    """
    Выделение текста пользователем в книге.

    Использует CFI range (start,end) для точного определения выделенного фрагмента.
    Поддерживает цвет выделения и опциональную заметку.
    """

    __tablename__ = "highlights"

    __table_args__ = (
        Index("ix_highlight_user_book_chapter", "user_id", "book_id", "chapter_number"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    book_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    cfi_range: Mapped[str] = mapped_column(String(1000), nullable=False)
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(String(2000), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#fbbf24")
    note: Mapped[Optional[str]] = mapped_column(String(5000), nullable=True)

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
    user: Mapped["User"] = relationship("User", lazy="raise")
    book: Mapped["Book"] = relationship("Book", lazy="raise")

    def __repr__(self) -> str:
        return f"<Highlight(user={self.user_id}, book={self.book_id}, color='{self.color}')>"
