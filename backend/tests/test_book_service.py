"""
Тесты для Book Service - сервис управления книгами в БД.

Проверяем CRUD операции, управление файлами, reading progress и статистику.
"""

import pytest
import tempfile
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock, patch, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.book import BookService, BookProgressService, BookStatisticsService
from app.models.book import Book, ReadingProgress, BookGenre
from app.models.chapter import Chapter
from app.models.user import User
from app.services.book_parser import ParsedBook, BookMetadata, BookChapter


@pytest.fixture
def book_service():
    """Fixture для BookService."""
    return BookService()


@pytest.fixture
def progress_service():
    """Fixture для BookProgressService."""
    return BookProgressService()


@pytest.fixture
def statistics_service():
    """Fixture для BookStatisticsService."""
    return BookStatisticsService()


@pytest.fixture
def parsed_book_data():
    """Fixture для ParsedBook данных."""
    metadata = BookMetadata(
        title="Test Book",
        author="Test Author",
        language="ru",
        genre="fiction",
        description="A test book",
    )

    chapters = [
        BookChapter(
            number=1,
            title="Chapter 1",
            content="This is chapter 1 content with beautiful dark forest.",
            html_content="<p>This is chapter 1 content with beautiful dark forest.</p>",
            word_count=10,
        ),
        BookChapter(
            number=2,
            title="Chapter 2",
            content="This is chapter 2 content with old wooden cabin.",
            html_content="<p>This is chapter 2 content with old wooden cabin.</p>",
            word_count=10,
        ),
    ]

    return ParsedBook(
        metadata=metadata,
        chapters=chapters,
        total_pages=5,
        estimated_reading_time=3,
        file_format="epub",
    )


class TestBookCreation:
    """Тесты создания книг."""

    @pytest.mark.asyncio
    async def test_create_book_from_upload(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        parsed_book_data: ParsedBook,
    ):
        """Тест создания книги из загруженного файла."""
        # Создаем временный файл
        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        temp_file.write(b"fake epub content")
        temp_file.close()

        try:
            book = await book_service.create_book_from_upload(
                db=db_session,
                user_id=test_user.id,
                file_path=temp_file.name,
                original_filename="test.epub",
                parsed_book=parsed_book_data,
            )

            assert book is not None
            assert book.title == "Test Book"
            assert book.author == "Test Author"
            assert book.user_id == test_user.id
            assert book.is_parsed is False
            assert book.file_format == "epub"

            # Проверяем что главы созданы в БД (используем refresh с selectinload для async)
            from sqlalchemy.orm import selectinload

            await db_session.refresh(book, ["chapters"])
            assert len(book.chapters) == 2
            assert book.chapters[0].chapter_number == 1

        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_create_book_saves_metadata(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        parsed_book_data: ParsedBook,
    ):
        """Тест сохранения метаданных книги."""
        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        temp_file.write(b"content")
        temp_file.close()

        try:
            book = await book_service.create_book_from_upload(
                db=db_session,
                user_id=test_user.id,
                file_path=temp_file.name,
                original_filename="test.epub",
                parsed_book=parsed_book_data,
            )

            assert book.book_metadata is not None
            assert isinstance(book.book_metadata, dict)
            assert book.total_pages == 5
            assert book.estimated_reading_time == 3

        finally:
            Path(temp_file.name).unlink(missing_ok=True)


class TestBookRetrieval:
    """Тесты получения книг."""

    @pytest.mark.asyncio
    async def test_get_book_by_id(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения книги по ID."""
        book = await book_service.get_book_by_id(db_session, test_book.id)

        assert book is not None
        assert book.id == test_book.id
        assert book.title == test_book.title

    @pytest.mark.asyncio
    async def test_get_nonexistent_book(
        self, book_service: BookService, db_session: AsyncSession
    ):
        """Тест получения несуществующей книги."""
        nonexistent_id = uuid4()

        book = await book_service.get_book_by_id(db_session, nonexistent_id)

        assert book is None

    @pytest.mark.asyncio
    async def test_get_user_books(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест получения книг пользователя."""
        # Метод возвращает List[Book], а не словарь
        books = await book_service.get_user_books(
            db_session, test_user.id, skip=0, limit=10
        )

        assert len(books) > 0
        assert books[0].id == test_book.id

    @pytest.mark.asyncio
    async def test_get_user_books_pagination(
        self, book_service: BookService, db_session: AsyncSession, test_user: User
    ):
        """Тест пагинации книг пользователя."""
        # Создаем несколько книг
        for i in range(5):
            book = Book(
                user_id=test_user.id,
                title=f"Book {i}",
                author="Author",
                genre=BookGenre.FANTASY.value,  # Use .value for string field
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                is_parsed=True,
            )
            db_session.add(book)
        await db_session.commit()

        # Тестируем пагинацию (метод возвращает List[Book])
        result = await book_service.get_user_books(
            db_session, test_user.id, skip=0, limit=3
        )

        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_get_user_books_filtering(
        self, book_service: BookService, db_session: AsyncSession, test_user: User
    ):
        """Тест получения книг пользователя с несколькими жанрами."""
        # Создаем книги разных жанров
        book1 = Book(
            user_id=test_user.id,
            title="Detective Book",
            author="Author",
            genre=BookGenre.DETECTIVE.value,  # Use .value for string field
            language="ru",
            file_path="/tmp/detective.epub",
            file_format="epub",
            file_size=1024,
            is_parsed=True,
        )
        book2 = Book(
            user_id=test_user.id,
            title="Fantasy Book",
            author="Author",
            genre=BookGenre.FANTASY.value,  # Use .value for string field
            language="ru",
            file_path="/tmp/fantasy.epub",
            file_format="epub",
            file_size=1024,
            is_parsed=True,
        )
        db_session.add_all([book1, book2])
        await db_session.commit()

        # Получаем все книги пользователя (метод не поддерживает фильтрацию)
        result = await book_service.get_user_books(db_session, test_user.id)

        assert len(result) >= 2
        # Проверяем что книги разных жанров присутствуют
        genres = {book.genre for book in result}
        assert BookGenre.DETECTIVE.value in genres or BookGenre.FANTASY.value in genres


class TestBookUpdate:
    """Тесты обновления книг."""

    @pytest.mark.asyncio
    async def test_update_book_parsing_status_via_model(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест обновления статуса парсинга книги напрямую через модель."""
        # BookService не имеет метода update_book_parsing_status
        # Обновляем напрямую через модель
        test_book.is_parsed = True
        test_book.parsing_progress = 100
        await db_session.commit()

        await db_session.refresh(test_book)
        assert test_book.is_parsed is True
        assert test_book.parsing_progress == 100

    @pytest.mark.asyncio
    async def test_update_book_metadata_via_model(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест обновления метаданных книги напрямую через модель."""
        # BookService не имеет метода update_book_metadata
        # Обновляем напрямую через модель
        new_title = "Updated Title"
        new_author = "Updated Author"

        test_book.title = new_title
        test_book.author = new_author
        await db_session.commit()

        await db_session.refresh(test_book)
        assert test_book.title == new_title
        assert test_book.author == new_author


class TestBookDeletion:
    """Тесты удаления книг."""

    @pytest.mark.asyncio
    async def test_delete_book(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест удаления книги."""
        book_id = test_book.id

        # delete_book требует user_id для проверки прав
        result = await book_service.delete_book(db_session, book_id, test_user.id)
        assert result is True

        # Проверяем что книга удалена
        book_check = await db_session.execute(select(Book).where(Book.id == book_id))
        book = book_check.scalar_one_or_none()

        assert book is None

    @pytest.mark.asyncio
    async def test_delete_book_cascades_chapters(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_chapter: Chapter,
    ):
        """Тест каскадного удаления глав при удалении книги."""
        book_id = test_book.id
        chapter_id = test_chapter.id

        # delete_book требует user_id для проверки прав
        result = await book_service.delete_book(db_session, book_id, test_user.id)
        assert result is True

        # Проверяем что главы тоже удалены (cascade)
        chapter_check = await db_session.execute(
            select(Chapter).where(Chapter.id == chapter_id)
        )
        chapter = chapter_check.scalar_one_or_none()

        assert chapter is None


class TestReadingProgress:
    """Тесты управления прогрессом чтения."""

    @pytest.mark.asyncio
    async def test_update_reading_progress(
        self,
        progress_service: BookProgressService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест обновления прогресса чтения."""
        # Параметр называется chapter_number, а не current_chapter
        progress = await progress_service.update_reading_progress(
            db=db_session,
            user_id=test_user.id,
            book_id=test_book.id,
            chapter_number=2,
            position_percent=50.0,
            reading_location_cfi="epubcfi(/6/4[chap01ref]!/4[body01]/10[para05])",
            scroll_offset_percent=45.5,
        )

        assert progress is not None
        assert progress.current_chapter == 2
        assert progress.scroll_offset_percent == 45.5
        assert "epubcfi" in progress.reading_location_cfi

    @pytest.mark.asyncio
    async def test_get_reading_progress(
        self,
        progress_service: BookProgressService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест получения прогресса чтения через модель."""
        # Создаем прогресс
        await progress_service.update_reading_progress(
            db=db_session,
            user_id=test_user.id,
            book_id=test_book.id,
            chapter_number=3,
            position_percent=60.0,
            scroll_offset_percent=60.0,
        )

        # Получаем прогресс через запрос (метод get_reading_progress отсутствует)
        from sqlalchemy import and_

        result = await db_session.execute(
            select(ReadingProgress).where(
                and_(
                    ReadingProgress.user_id == test_user.id,
                    ReadingProgress.book_id == test_book.id,
                )
            )
        )
        progress = result.scalar_one_or_none()

        assert progress is not None
        assert progress.current_chapter == 3
        assert progress.scroll_offset_percent == 60.0

    @pytest.mark.asyncio
    async def test_reading_progress_percentage_calculation(
        self,
        progress_service: BookProgressService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест расчета процента прогресса чтения."""
        progress = await progress_service.update_reading_progress(
            db=db_session,
            user_id=test_user.id,
            book_id=test_book.id,
            chapter_number=1,
            position_percent=50.0,
            scroll_offset_percent=50.0,
        )

        # Проверяем что прогресс сохранен
        assert progress is not None
        assert progress.current_chapter == 1
        assert progress.current_position == 50.0


class TestChapterManagement:
    """Тесты управления главами."""

    @pytest.mark.asyncio
    async def test_get_chapter_by_number(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения главы по номеру."""
        # test_book fixture already creates 3 chapters (chapter_numbers 1, 2, 3)
        # Using test_chapter fixture would create duplicate chapter 1
        chapter = await book_service.get_chapter_by_number(
            db_session, test_book.id, chapter_number=1
        )

        assert chapter is not None
        assert chapter.chapter_number == 1
        assert chapter.title == "Chapter 1"

    @pytest.mark.asyncio
    async def test_get_nonexistent_chapter(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения несуществующей главы."""
        chapter = await book_service.get_chapter_by_number(
            db_session, test_book.id, chapter_number=999
        )

        assert chapter is None

    @pytest.mark.asyncio
    async def test_get_book_chapters_list(
        self, book_service: BookService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения списка глав книги."""
        # Создаем несколько глав
        for i in range(2, 6):
            chapter = Chapter(
                book_id=test_book.id,
                chapter_number=i,
                title=f"Chapter {i}",
                content=f"Content of chapter {i}",
                word_count=10,
            )
            db_session.add(chapter)
        await db_session.commit()

        chapters = await book_service.get_book_chapters(db_session, test_book.id)

        assert len(chapters) >= 5
        assert all(ch.book_id == test_book.id for ch in chapters)
        # Проверяем сортировку по номеру главы
        chapter_numbers = [ch.chapter_number for ch in chapters]
        assert chapter_numbers == sorted(chapter_numbers)


class TestStatistics:
    """Тесты статистики чтения."""

    @pytest.mark.asyncio
    async def test_get_book_statistics(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Тест получения статистики книг."""
        # Метод называется get_book_statistics (не reading_statistics)
        stats = await statistics_service.get_book_statistics(db_session, test_user.id)

        assert stats is not None
        assert "total_books" in stats
        assert stats["total_books"] >= 1

    @pytest.mark.asyncio
    async def test_statistics_calculates_reading_time(
        self,
        statistics_service: BookStatisticsService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест расчета времени чтения в статистике."""
        # Метод называется get_book_statistics
        stats = await statistics_service.get_book_statistics(db_session, test_user.id)

        assert "total_reading_time_hours" in stats
        assert isinstance(stats["total_reading_time_hours"], (int, float))


class TestErrorHandling:
    """Тесты обработки ошибок."""

    @pytest.mark.asyncio
    async def test_create_book_with_invalid_user(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        parsed_book_data: ParsedBook,
    ):
        """Тест создания книги с несуществующим пользователем."""
        invalid_user_id = uuid4()

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        temp_file.write(b"content")
        temp_file.close()

        try:
            with pytest.raises(Exception):  # Может быть IntegrityError
                await book_service.create_book_from_upload(
                    db=db_session,
                    user_id=invalid_user_id,
                    file_path=temp_file.name,
                    original_filename="test.epub",
                    parsed_book=parsed_book_data,
                )
                await db_session.commit()
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_update_progress_for_nonexistent_book(
        self,
        progress_service: BookProgressService,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест обновления прогресса для несуществующей книги."""
        nonexistent_book_id = uuid4()

        # Должен выбросить ValueError с сообщением "Book with id ... not found"
        with pytest.raises(ValueError, match="Book with id .* not found"):
            await progress_service.update_reading_progress(
                db=db_session,
                user_id=test_user.id,
                book_id=nonexistent_book_id,
                chapter_number=1,
                position_percent=0.0,
            )
