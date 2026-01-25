"""
Модели для книг и прогресса чтения в fancai.

Содержит модели Book, ReadingProgress и связанные функции.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import Integer, String, Text, Float, ForeignKey, func, select
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import Base

if TYPE_CHECKING:
    from .user import User
    from .chapter import Chapter
    from .reading_session import ReadingSession


class BookFormat(enum.Enum):
    EPUB = "epub"
    FB2 = "fb2"


class BookGenre(enum.Enum):
    FANTASY = "fantasy"
    DETECTIVE = "detective"
    SCIFI = "science_fiction"
    HISTORICAL = "historical"
    ROMANCE = "romance"
    THRILLER = "thriller"
    HORROR = "horror"
    CLASSIC = "classic"
    OTHER = "other"


class Book(Base):
    __tablename__ = "books"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    genre: Mapped[str] = mapped_column(String(50), default=BookGenre.OTHER.value, nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="ru", nullable=False)

    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_format: Mapped[str] = mapped_column(String(10), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    cover_image: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    book_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    total_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_reading_time: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_parsed: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_processing: Mapped[bool] = mapped_column(default=True, nullable=False)
    parsing_progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parsing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    descriptions_extracted: Mapped[bool] = mapped_column(default=False, nullable=False)
    descriptions_processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_accessed: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="books", lazy="raise")
    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )
    reading_progress: Mapped[list["ReadingProgress"]] = relationship(
        "ReadingProgress", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )
    reading_sessions: Mapped[list["ReadingSession"]] = relationship(
        "ReadingSession", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Book(id={self.id}, title='{self.title}', author='{self.author}')>"

    def get_user_progress(self, user_id: UUID) -> "ReadingProgress | None":
        """
        Получает прогресс чтения для конкретного пользователя из pre-loaded данных.

        P1.2 OPTIMIZATION: Использует relationship вместо дополнительного запроса.
        Требует: selectinload(Book.reading_progress) при загрузке книги.

        Args:
            user_id: ID пользователя

        Returns:
            ReadingProgress или None
        """
        if not hasattr(self, 'reading_progress') or self.reading_progress is None:
            return None

        for progress in self.reading_progress:
            if progress.user_id == user_id:
                return progress
        return None

    def calculate_progress_percent(self, user_id: UUID) -> float:
        """
        Вычисляет прогресс чтения книги синхронно из pre-loaded данных.

        P1.2 OPTIMIZATION: Не делает дополнительных запросов к БД.
        Требует: selectinload(Book.chapters) и selectinload(Book.reading_progress).

        Args:
            user_id: ID пользователя

        Returns:
            Прогресс чтения от 0.0 до 100.0
        """
        try:
            progress = self.get_user_progress(user_id)

            if not progress:
                return 0.0

            # НОВАЯ ЛОГИКА: Если есть CFI - это EPUB reader с точным процентом
            if progress.reading_location_cfi:
                current_position = max(
                    0.0, min(100.0, float(progress.current_position))
                )
                return current_position

            # СТАРАЯ ЛОГИКА: Для обратной совместимости со старыми данными без CFI
            # Используем pre-loaded chapters вместо запроса
            total_chapters = len(self.chapters) if self.chapters else 0

            if total_chapters == 0:
                return 0.0

            # Валидация данных
            current_chapter = max(1, min(progress.current_chapter, total_chapters))
            current_position = max(0.0, min(100.0, float(progress.current_position)))

            if current_chapter > total_chapters:
                return 100.0

            completed_chapters_progress = ((current_chapter - 1) / total_chapters) * 100
            current_chapter_progress = (current_position / 100) * (100 / total_chapters)

            return min(100.0, max(0.0, completed_chapters_progress + current_chapter_progress))
        except Exception as e:
            print(f"⚠️ Error calculating reading progress: {e}")
            return 0.0

    async def get_reading_progress_percent(
        self, db: AsyncSession, user_id: UUID
    ) -> float:
        """
        Получает прогресс чтения книги пользователем в процентах.

        P1.2 OPTIMIZATION: Сначала пытается использовать pre-loaded данные,
        fallback на DB запрос только если данные не загружены.

        Для EPUB книг с CFI (epub.js): current_position уже содержит точный процент 0-100
        Для старых данных без CFI: используется формула на основе глав

        Args:
            db: Асинхронная сессия БД
            user_id: ID пользователя

        Returns:
            Прогресс чтения от 0.0 до 100.0
        """
        # P1.2: Try pre-loaded data first (no DB query)
        if hasattr(self, 'reading_progress') and self.reading_progress is not None:
            if hasattr(self, 'chapters') and self.chapters is not None:
                return self.calculate_progress_percent(user_id)

        # Fallback: Query DB (legacy path)
        try:
            from .chapter import Chapter

            progress_query = select(ReadingProgress).where(
                ReadingProgress.book_id == self.id, ReadingProgress.user_id == user_id
            )
            progress_result = await db.execute(progress_query)
            progress = progress_result.scalar_one_or_none()

            if not progress:
                return 0.0

            if progress.reading_location_cfi:
                return max(0.0, min(100.0, float(progress.current_position)))

            chapters_count_query = select(func.count(Chapter.id)).where(
                Chapter.book_id == self.id
            )
            total_chapters = await db.scalar(chapters_count_query)

            if not total_chapters or total_chapters == 0:
                return 0.0

            current_chapter = max(1, min(progress.current_chapter, total_chapters))
            current_position = max(0.0, min(100.0, float(progress.current_position)))

            if current_chapter > total_chapters:
                return 100.0

            completed_chapters_progress = ((current_chapter - 1) / total_chapters) * 100
            current_chapter_progress = (current_position / 100) * (100 / total_chapters)

            return min(100.0, max(0.0, completed_chapters_progress + current_chapter_progress))
        except Exception as e:
            print(f"⚠️ Error calculating reading progress: {e}")
            return 0.0


class ReadingProgress(Base):
    """
    Модель прогресса чтения книги пользователем.

    Attributes:
        id: Уникальный идентификатор записи
        user_id: ID пользователя
        book_id: ID книги
        current_chapter: Номер текущей главы
        current_page: Номер текущей страницы
        current_position: Позиция в главе (для точного позиционирования)
        reading_time_minutes: Время чтения в минутах
        reading_speed_wpm: Скорость чтения (слов в минуту)
    """

    __tablename__ = "reading_progress"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    book_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True
    )

    # Позиция чтения
    current_chapter: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_page: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # позиция в главе
    reading_location_cfi: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # CFI для epub.js (точная позиция)
    scroll_offset_percent: Mapped[float] = mapped_column(
        Float, default=0.0, nullable=False
    )  # Точный % скролла внутри страницы (0-100)

    # Статистика чтения
    reading_time_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reading_speed_wpm: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Временные метки
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_read_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user: Mapped["User"] = relationship("User", back_populates="reading_progress", lazy="raise")
    book: Mapped["Book"] = relationship("Book", back_populates="reading_progress", lazy="raise")

    def __repr__(self) -> str:
        return f"<ReadingProgress(user_id={self.user_id}, book_id={self.book_id}, chapter={self.current_chapter})>"
