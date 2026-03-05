"""
Модель закладки для fancai.

Позволяет пользователям сохранять закладки на конкретных позициях (CFI) в книге.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import String, Integer, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User
    from .book import Book


class Bookmark(Base):
    """
    Закладка пользователя в книге.

    Использует CFI (Canonical Fragment Identifier) для точного позиционирования
    в EPUB. chapter_number используется для группировки закладок по главам.
    """

    __tablename__ = "bookmarks"

    __table_args__ = (
        UniqueConstraint("user_id", "book_id", "cfi", name="uq_bookmark_user_book_cfi"),
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

    cfi: Mapped[str] = mapped_column(String(500), nullable=False)
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    text_excerpt: Mapped[str] = mapped_column(String(500), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", lazy="raise")
    book: Mapped["Book"] = relationship("Book", lazy="raise")

    def __repr__(self) -> str:
        return f"<Bookmark(user={self.user_id}, book={self.book_id}, cfi='{self.cfi[:30]}...')>"
