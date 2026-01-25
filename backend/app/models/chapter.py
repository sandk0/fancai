"""
Модель глав книг для fancai.

Содержит структуру глав и их контент для парсинга описаний.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Integer, String, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column

from ..core.database import Base

if TYPE_CHECKING:
    from .book import Book
    from .description import Description
    from .image import GeneratedImage
    from .entity_mention import EntityMention


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    book_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True
    )

    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)

    content: Mapped[str] = mapped_column(Text, nullable=False)
    html_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_reading_time: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_description_parsed: Mapped[bool] = mapped_column(default=False, nullable=False)
    descriptions_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parsing_progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_service_page: Mapped[bool | None] = mapped_column(default=None, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )
    parsed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    book: Mapped["Book"] = relationship("Book", back_populates="chapters", lazy="raise")
    descriptions: Mapped[list["Description"]] = relationship(
        "Description", back_populates="chapter", cascade="all, delete-orphan", lazy="raise"
    )
    generated_images: Mapped[list["GeneratedImage"]] = relationship(
        "GeneratedImage", back_populates="chapter", cascade="all, delete-orphan", lazy="raise"
    )
    mentions: Mapped[list["EntityMention"]] = relationship(
        "EntityMention", back_populates="chapter", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self):
        return f"<Chapter(id={self.id}, book_id={self.book_id}, number={self.chapter_number}, title='{self.title}')>"

    def get_text_excerpt(self, max_length: int = 200) -> str:
        """
        Получает отрывок текста главы для предварительного просмотра.

        Args:
            max_length: Максимальная длина отрывка

        Returns:
            Отрывок текста с многоточием если текст длиннее max_length
        """
        if not self.content:
            return ""

        if len(self.content) <= max_length:
            return self.content

        # Находим последний пробел перед лимитом, чтобы не обрезать слово
        excerpt = self.content[:max_length]
        last_space = excerpt.rfind(" ")

        if last_space > max_length * 0.8:  # Если пробел не слишком далеко от конца
            excerpt = excerpt[:last_space]

        return excerpt + "..."

    def calculate_reading_time(self, words_per_minute: int = 200) -> int:
        """
        Рассчитывает предполагаемое время чтения главы.

        Args:
            words_per_minute: Скорость чтения (по умолчанию 200 слов/мин)

        Returns:
            Время чтения в минутах
        """
        if self.word_count == 0:
            return 0

        return max(1, round(self.word_count / words_per_minute))

    # Service page keywords for detection
    SERVICE_PAGE_KEYWORDS = [
        "содержание", "оглавление", "table of contents", "contents",
        "от автора", "слово автора", "предисловие", "послесловие",
        "аннотация", "annotation", "synopsis",
        "эпиграф", "epigraph", "цитата",
        "посвящение", "dedication",
        "благодарности", "acknowledgments",
        "примечания", "notes", "сноски",
        "библиография", "bibliography", "references",
        "об авторе", "about the author", "биография",
        "copyright", "издательство", "publisher",
        "isbn", "все права защищены", "all rights reserved",
    ]

    def check_is_service_page(self) -> bool:
        """
        Определяет, является ли глава служебной страницей.

        Служебные страницы (оглавление, copyright и т.д.) не парсятся
        для извлечения описаний.

        Returns:
            True если это служебная страница
        """
        # Используем кэшированное значение если есть
        if self.is_service_page is not None:
            return self.is_service_page

        # Вычисляем
        chapter_title_lower = (self.title or "").lower()
        chapter_content_lower = (self.content or "")[:500].lower()

        is_service = any(
            keyword in chapter_title_lower or keyword in chapter_content_lower
            for keyword in self.SERVICE_PAGE_KEYWORDS
        )

        # Очень короткие главы тоже считаем служебными
        if self.word_count and self.word_count < 100:
            is_service = True

        return is_service

    def cache_service_page_status(self) -> bool:
        result = self.check_is_service_page()
        self.is_service_page = result
        return result
