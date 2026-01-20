"""
Модели для книг и прогресса чтения в fancai.

Содержит модели Book, ReadingProgress и связанные функции.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    Text,
    ForeignKey,
    Float,
    select,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
import enum
from typing import TYPE_CHECKING

from ..core.database import Base

if TYPE_CHECKING:
    pass


class BookFormat(enum.Enum):
    """Форматы поддерживаемых книг."""

    EPUB = "epub"
    FB2 = "fb2"


class BookGenre(enum.Enum):
    """Жанры книг для настройки стилей генерации изображений."""

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
    """
    Модель книги в системе.

    Attributes:
        id: Уникальный идентификатор книги
        user_id: ID владельца книги
        title: Название книги
        author: Автор книги
        genre: Жанр (влияет на стиль генерации изображений)
        language: Язык книги
        file_path: Путь к файлу книги на сервере
        file_format: Формат файла (EPUB, FB2)
        file_size: Размер файла в байтах
        cover_image: Путь к обложке книги
        description: Описание/аннотация книги
        metadata: Дополнительные метаданные из файла
        total_pages: Общее количество страниц (расчетное)
        estimated_reading_time: Расчетное время чтения в минутах
        is_parsed: Флаг завершения парсинга содержимого
        parsing_progress: Прогресс парсинга (0-100)
    """

    __tablename__ = "books"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Основная информация
    title = Column(String(500), nullable=False, index=True)
    author = Column(String(255), nullable=True, index=True)
    genre = Column(String(50), default=BookGenre.OTHER.value, nullable=False)
    language = Column(String(10), default="ru", nullable=False)

    # Файл
    file_path = Column(String(1000), nullable=False)
    file_format = Column(String(10), nullable=False)  # epub, fb2
    file_size = Column(Integer, nullable=False)  # размер в байтах

    # Контент
    cover_image = Column(String(1000), nullable=True)
    description = Column(Text, nullable=True)
    book_metadata = Column(
        JSONB, nullable=True
    )  # метаданные из файла (JSONB для быстрого поиска)

    # Статистика
    total_pages = Column(Integer, default=0, nullable=False)
    estimated_reading_time = Column(Integer, default=0, nullable=False)  # минуты

    # Статус обработки
    is_parsed = Column(Boolean, default=False, nullable=False)
    is_processing = Column(Boolean, default=True, nullable=False)  # True while Celery task is running
    parsing_progress = Column(Integer, default=0, nullable=False)  # 0-100%
    parsing_error = Column(Text, nullable=True)
    
    # Статус обработки описаний (ручной запуск)
    descriptions_extracted = Column(Boolean, default=False, nullable=False)  # Описания извлечены?
    descriptions_processing_error = Column(Text, nullable=True)  # Ошибка обработки описаний

    # Временные метки
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_accessed = Column(DateTime(timezone=True), nullable=True)

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user = relationship("User", back_populates="books", lazy="raise")
    chapters = relationship(
        "Chapter", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )
    reading_progress = relationship(
        "ReadingProgress", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )
    reading_sessions = relationship(
        "ReadingSession", back_populates="book", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self):
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    book_id = Column(
        UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True
    )

    # Позиция чтения
    current_chapter = Column(Integer, default=1, nullable=False)
    current_page = Column(Integer, default=1, nullable=False)
    current_position = Column(Integer, default=0, nullable=False)  # позиция в главе
    reading_location_cfi = Column(
        String(500), nullable=True
    )  # CFI для epub.js (точная позиция)
    scroll_offset_percent = Column(
        Float, default=0.0, nullable=False
    )  # Точный % скролла внутри страницы (0-100)

    # Статистика чтения
    reading_time_minutes = Column(Integer, default=0, nullable=False)
    reading_speed_wpm = Column(Float, default=0.0, nullable=False)

    # Временные метки
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_read_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    user = relationship("User", back_populates="reading_progress", lazy="raise")
    book = relationship("Book", back_populates="reading_progress", lazy="raise")

    def __repr__(self):
        return f"<ReadingProgress(user_id={self.user_id}, book_id={self.book_id}, chapter={self.current_chapter})>"
