"""
Интеграционные тесты для BookStatisticsService.

Тестирует функциональность сбора статистики:
- Подсчет количества книг пользователя
- Сбор детальной статистики чтения
- Работа с пустыми данными

Статистика по описаниям из набора убрана: `get_book_statistics` перестал
её отдавать вместе с удалением NLP-системы (`0c110210`), ключей
`descriptions_extracted` и `descriptions_by_type` в контракте больше нет.

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
        assert stats["total_chapters"] == 0
        assert stats["total_pages_read"] == 0
        assert stats["total_reading_time_hours"] == 0.0

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
        # Книги созданы без глав — JOIN не должен ничего насчитать
        assert stats["total_chapters"] == 0

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

    # ==================== EDGE CASES ====================

    @pytest.mark.asyncio
    async def test_statistics_counts_chapters_of_user_books(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест что статистика считает главы книг пользователя."""
        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert — фикстура test_book создаёт ровно 3 главы
        assert stats["total_books"] == 1
        assert stats["total_chapters"] == 3

    @pytest.mark.asyncio
    async def test_statistics_multiple_books_with_chapters(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест статистики по нескольким книгам с главами."""
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

        for book in books:
            chapter = Chapter(
                book_id=book.id,
                chapter_number=1,
                title="Chapter 1",
                content="Content",
                word_count=100,
            )
            db_session.add(chapter)
        await db_session.commit()

        # Act
        stats = await statistics_service.get_book_statistics(
            db=db_session, user_id=test_user.id
        )

        # Assert — по одной главе на каждую из трёх книг
        assert stats["total_books"] == 3
        assert stats["total_chapters"] == 3

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
        assert stats["total_chapters"] == 0
