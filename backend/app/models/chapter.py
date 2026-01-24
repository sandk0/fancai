"""
Модель глав книг для fancai.

Содержит структуру глав и их контент для парсинга описаний.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from ..core.database import Base


class Chapter(Base):
    """
    Модель главы книги.

    Attributes:
        id: Уникальный идентификатор главы
        book_id: ID книги (внешний ключ)
        chapter_number: Номер главы в книге
        title: Название главы
        content: Текстовое содержимое главы
        html_content: HTML содержимое (если есть форматирование)
        word_count: Количество слов в главе
        estimated_reading_time: Расчетное время чтения в минутах
        is_description_parsed: Флаг завершения парсинга описаний
        descriptions_found: Количество найденных описаний
    """

    __tablename__ = "chapters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    book_id = Column(
        UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True
    )

    # Информация о главе
    chapter_number = Column(Integer, nullable=False, index=True)
    title = Column(String(500), nullable=True)

    # Контент
    content = Column(Text, nullable=False)  # Чистый текст
    html_content = Column(Text, nullable=True)  # HTML с форматированием

    # Статистика
    word_count = Column(Integer, default=0, nullable=False)
    estimated_reading_time = Column(Integer, default=0, nullable=False)  # минуты

    # Статус парсинга описаний
    is_description_parsed = Column(Boolean, default=False, nullable=False)
    descriptions_found = Column(Integer, default=0, nullable=False)
    parsing_progress = Column(Integer, default=0, nullable=False)  # 0-100%

    # Service page detection cache (P1.1 optimization)
    # True = skip description extraction (ToC, copyright, etc.)
    is_service_page = Column(Boolean, default=None, nullable=True)
    
    # Internal file path for exact mapping (e.g. "Text/chapter1.xhtml")
    file_path = Column(String(500), nullable=True, index=True)

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
    parsed_at = Column(DateTime(timezone=True), nullable=True)

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    book = relationship("Book", back_populates="chapters", lazy="raise")
    descriptions = relationship(
        "Description", back_populates="chapter", cascade="all, delete-orphan", lazy="raise"
    )
    generated_images = relationship(
        "GeneratedImage", back_populates="chapter", cascade="all, delete-orphan", lazy="raise"
    )
    mentions = relationship(
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
        """
        Вычисляет и кэширует статус служебной страницы.

        Returns:
            True если это служебная страница
        """
        self.is_service_page = self.check_is_service_page()
        return self.is_service_page
