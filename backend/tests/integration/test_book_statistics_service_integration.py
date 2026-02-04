"""
Интеграционные тесты для BookStatisticsService.

Тестирует функциональность сбора статистики:
- Подсчет количества книг пользователя
- Сбор детальной статистики чтения
- Статистика по описаниям
- Статистика по типам описаний
- Работа с пустыми данными

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.book.book_statistics_service import BookStatisticsService
from app.services.book.book_service import BookService
from app.models.book import Book, BookGenre, ReadingProgress
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.reading_session import ReadingSession
from app.models.user import User


class TestBookStatisticsServiceIntegration:
    """Тесты интеграции BookStatisticsService."""

    @pytest.fixture
    def book_service(self):
        """Инициализация BookService."""
        return BookService()

    @pytest.fixture
    def statistics_service(self, book_service):
        """Инициализация BookStatisticsService."""
        return BookStatisticsService(book_service=book_service)

    # ==================== BOOK COUNT TESTS ====================

    @pytest.mark.asyncio
    async def test_count_user_books_empty(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест подсчета книг при пустой библиотеке."""
        # Act
        count = await statistics_service.count_user_books(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert count == 0

    @pytest.mark.asyncio
    async def test_count_user_books_multiple(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест подсчета нескольких книг."""
        # Arrange
        for i in range(1, 6):
            book = Book(
                user_id=test_user.id,
                title=f"Book {i}",
                author=f"Author {i}",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book)
        await db_session.commit()

        # Act
        count = await statistics_service.count_user_books(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert count == 5

    @pytest.mark.asyncio
    async def test_count_user_books_ignores_other_users(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест что подсчет не включает книги других пользователей."""
        # Arrange
        other_user = User(
            email="other@example.com", full_name="Other User", password_hash="hashed"
        )
        db_session.add(other_user)
        await db_session.commit()

        # Create books for both users
        for i in range(1, 4):
            book1 = Book(
                user_id=test_user.id,
                title=f"User Book {i}",
                author="Author",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            book2 = Book(
                user_id=other_user.id,
                title=f"Other Book {i}",
                author="Author",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/other{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book1)
            db_session.add(book2)
        await db_session.commit()

        # Act
        count = await statistics_service.count_user_books(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert count == 3

    # ==================== BOOK STATISTICS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_statistics_empty_user(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест получения статистики для пользователя без книг."""
        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["total_books"] == 0
        assert stats["total_pages_read"] == 0
        assert stats["total_reading_time_hours"] == 0.0
        assert stats["descriptions_extracted"] == 0

    @pytest.mark.asyncio
    async def test_get_book_statistics_with_books(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест получения статистики с несколькими книгами."""
        # Arrange
        books = []
        for i in range(1, 4):
            book = Book(
                user_id=test_user.id,
                title=f"Book {i}",
                author=f"Author {i}",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book)
            books.append(book)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["total_books"] == 3
        assert isinstance(stats["descriptions_extracted"], int)

    @pytest.mark.asyncio
    async def test_get_book_statistics_includes_pages_read(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест что статистика включает прочитанные страницы."""
        # Arrange
        progress = ReadingProgress(
            user_id=test_user.id,
            book_id=test_book.id,
            current_chapter=2,
            current_page=10,
            current_position=50.0,
        )
        db_session.add(progress)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["total_pages_read"] >= 10

    @pytest.mark.asyncio
    async def test_get_book_statistics_includes_reading_time(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест что статистика включает время чтения.

        ОБНОВЛЕНО: Теперь время чтения берется из ReadingSession, а не ReadingProgress.
        """
        # Arrange
        from datetime import datetime, timezone

        # Создаем ReadingProgress
        progress = ReadingProgress(
            user_id=test_user.id,
            book_id=test_book.id,
            current_chapter=1,
            current_page=1,
            current_position=25.0,
            reading_time_minutes=60,  # 1 час (устаревшее поле, больше не используется)
        )
        db_session.add(progress)

        # Создаем завершенную ReadingSession (источник времени чтения)
        session = ReadingSession(
            user_id=test_user.id,
            book_id=test_book.id,
            started_at=datetime.now(timezone.utc),
            ended_at=datetime.now(timezone.utc),
            duration_minutes=60,  # 1 час чтения
            start_position=0,
            end_position=25,
            is_active=False,  # Завершенная сессия
        )
        db_session.add(session)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["total_reading_time_hours"] >= 1.0

    # ==================== DESCRIPTION STATISTICS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_statistics_count_descriptions(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест подсчета всех извлеченных описаний."""
        # Arrange
        chapter = test_book.chapters[0]
        for i in range(1, 6):
            description = Description(
                book_id=test_book.id,
                chapter_id=chapter.id,
                text=f"Description {i}",
                description_type=DescriptionType.LOCATION.value,
                confidence_score=0.9,
                priority_score=0.8,
                chapter_position=i * 10,
            )
            db_session.add(description)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["descriptions_extracted"] == 5

    @pytest.mark.asyncio
    async def test_get_book_statistics_descriptions_by_type(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест распределения описаний по типам."""
        # Arrange
        chapter = test_book.chapters[0]

        # Create descriptions of different types
        location_desc = Description(
            book_id=test_book.id,
            chapter_id=chapter.id,
            text="Beautiful forest",
            description_type=DescriptionType.LOCATION.value,
            confidence_score=0.9,
            priority_score=0.8,
            chapter_position=10,
        )
        character_desc = Description(
            book_id=test_book.id,
            chapter_id=chapter.id,
            text="Mysterious hero",
            description_type=DescriptionType.CHARACTER.value,
            confidence_score=0.85,
            priority_score=0.8,
            chapter_position=20,
        )
        atmosphere_desc = Description(
            book_id=test_book.id,
            chapter_id=chapter.id,
            text="Dark atmosphere",
            description_type=DescriptionType.ATMOSPHERE.value,
            confidence_score=0.8,
            priority_score=0.7,
            chapter_position=30,
        )

        db_session.add(location_desc)
        db_session.add(character_desc)
        db_session.add(atmosphere_desc)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["descriptions_extracted"] == 3
        assert "descriptions_by_type" in stats
        assert len(stats["descriptions_by_type"]) == 3

    @pytest.mark.asyncio
    async def test_get_book_statistics_no_descriptions(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест статистики при отсутствии описаний."""
        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["descriptions_extracted"] == 0
        assert stats["descriptions_by_type"] == {}

    # ==================== EDGE CASES ====================

    @pytest.mark.asyncio
    async def test_statistics_multiple_chapters_with_descriptions(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест статистики описаний из нескольких глав."""
        # Arrange
        chapters = test_book.chapters

        # Add descriptions to each chapter
        for chapter in chapters:
            for i in range(1, 4):
                description = Description(
                    book_id=test_book.id,
                    chapter_id=chapter.id,
                    text=f"Description {i} in chapter {chapter.chapter_number}",
                    description_type=DescriptionType.LOCATION.value,
                    confidence_score=0.9,
                    priority_score=0.8,
                    chapter_position=i * 10,
                )
                db_session.add(description)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        expected_count = len(chapters) * 3
        assert stats["descriptions_extracted"] == expected_count

    @pytest.mark.asyncio
    async def test_statistics_multiple_books_with_descriptions(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест статистики описаний из нескольких книг."""
        # Arrange
        books = []
        for book_idx in range(1, 4):
            book = Book(
                user_id=test_user.id,
                title=f"Book {book_idx}",
                author=f"Author {book_idx}",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{book_idx}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book)
            books.append(book)
        await db_session.commit()

        # Add chapters and descriptions for each book
        for book in books:
            chapter = Chapter(
                book_id=book.id,
                chapter_number=1,
                title="Chapter 1",
                content="Content",
                word_count=100,
            )
            db_session.add(chapter)
            await db_session.flush()

            for i in range(1, 4):
                description = Description(
                    book_id=book.id,
                    chapter_id=chapter.id,
                    text=f"Description {i}",
                    description_type=DescriptionType.LOCATION.value,
                    confidence_score=0.9,
                    priority_score=0.8,
                    chapter_position=i * 10,
                )
                db_session.add(description)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        expected_count = 3 * 3  # 3 books * 3 descriptions each
        assert stats["total_books"] == 3
        assert stats["descriptions_extracted"] == expected_count

    @pytest.mark.asyncio
    async def test_statistics_description_type_distribution(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест распределения типов описаний в статистике."""
        # Arrange
        chapter = test_book.chapters[0]

        # Create many descriptions of different types
        type_counts = {
            DescriptionType.LOCATION: 5,
            DescriptionType.CHARACTER: 3,
            DescriptionType.ATMOSPHERE: 2,
        }

        for desc_type, count in type_counts.items():
            for i in range(count):
                description = Description(
                    book_id=test_book.id,
                    chapter_id=chapter.id,
                    text=f"{desc_type.value} {i}",
                    description_type=desc_type.value,
                    confidence_score=0.9,
                    priority_score=0.8,
                    chapter_position=i * 10,
                )
                db_session.add(description)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert
        assert stats["descriptions_extracted"] == 10
        descriptions_by_type = stats["descriptions_by_type"]
        assert descriptions_by_type.get("location") == 5
        assert descriptions_by_type.get("character") == 3
        assert descriptions_by_type.get("atmosphere") == 2

    @pytest.mark.asyncio
    async def test_statistics_non_existent_user(
        self, statistics_service: BookStatisticsService, db_session: AsyncSession
    ):
        """Тест статистики для несуществующего пользователя."""
        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=uuid4()
        )

        # Assert
        assert stats["total_books"] == 0
        assert stats["descriptions_extracted"] == 0
