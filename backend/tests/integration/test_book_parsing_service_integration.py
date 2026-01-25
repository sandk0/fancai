"""
Интеграционные тесты для BookParsingService.

Тестирует функциональность управления парсингом:
- Извлечение описаний из глав
- Управление прогрессом парсинга
- Получение статуса парсинга
- Интеграция с Multi-NLP системой
- Сохранение описаний в БД
- Работа с разными типами описаний

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
from uuid import uuid4
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.book.book_parsing_service import BookParsingService
from app.services.book.book_service import BookService
from app.models.book import Book, BookGenre
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.user import User


class TestBookParsingServiceIntegration:
    """Тесты интеграции BookParsingService."""

    @pytest.fixture
    def book_service(self):
        """Инициализация BookService."""
        return BookService()

    @pytest.fixture
    def parsing_service(self, book_service):
        """Инициализация BookParsingService."""
        return BookParsingService(book_service=book_service)

    # ==================== EXTRACT DESCRIPTIONS TESTS ====================

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_success(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест успешного извлечения описаний из главы."""
        # Arrange
        chapter = test_book.chapters[0]

        # Mock multi_nlp_manager
        mock_result = AsyncMock()
        mock_result.descriptions = [
            {
                "type": "location",
                "content": "Beautiful forest",
                "context": "In the deep forest",
                "confidence_score": 0.95,
                "position": 10,
                "word_count": 3,
                "priority_score": 0.9
            }
        ]

        # Act
        with patch("app.services.book.book_parsing_service.multi_nlp_manager.extract_descriptions", return_value=mock_result):
            descriptions = await parsing_service.extract_chapter_descriptions(
                db=db_session,
                chapter_id=chapter.id
            )

        # Assert
        assert len(descriptions) > 0
        assert descriptions[0].type == "location"
        assert descriptions[0].content == "Beautiful forest"

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_marks_parsed(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест что глава отмечается как обработанная."""
        # Arrange
        chapter = test_book.chapters[0]

        mock_result = AsyncMock()
        mock_result.descriptions = [
            {
                "type": "location",
                "content": "Forest",
                "context": "Context",
                "confidence_score": 0.9,
                "position": 0,
                "word_count": 1,
                "priority_score": 0.8
            }
        ]

        # Act
        with patch("app.services.book.book_parsing_service.multi_nlp_manager.extract_descriptions", return_value=mock_result):
            await parsing_service.extract_chapter_descriptions(
                db=db_session,
                chapter_id=chapter.id
            )

        # Assert
        updated_chapter = await db_session.get(Chapter, chapter.id)
        assert updated_chapter.is_description_parsed is True
        assert updated_chapter.descriptions_found > 0
        assert updated_chapter.parsing_progress == 100

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_chapter_not_found(
        self, parsing_service: BookParsingService, db_session: AsyncSession
    ):
        """Тест извлечения описаний для несуществующей главы."""
        # Act & Assert
        with pytest.raises(ValueError, match="not found"):
            await parsing_service.extract_chapter_descriptions(
                db=db_session,
                chapter_id=uuid4()
            )

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_already_parsed(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест что уже обработанная глава не обрабатывается повторно."""
        # Arrange
        chapter = test_book.chapters[0]
        chapter.is_description_parsed = True

        # Create existing description
        existing_desc = Description(
            chapter_id=chapter.id,
            type=DescriptionType.LOCATION.value,
            content="Existing description",
            context="Context",
            confidence_score=0.9,
            position_in_chapter=0,
            word_count=2,
            priority_score=0.8
        )
        db_session.add(existing_desc)
        await db_session.commit()

        # Act
        descriptions = await parsing_service.extract_chapter_descriptions(
            db=db_session,
            chapter_id=chapter.id
        )

        # Assert
        assert len(descriptions) == 1
        assert descriptions[0].content == "Existing description"

    # ==================== GET DESCRIPTIONS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_descriptions_success(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения описаний из всех глав книги."""
        # Arrange
        chapter = test_book.chapters[0]
        for i in range(1, 4):
            description = Description(
                chapter_id=chapter.id,
                type=DescriptionType.LOCATION.value,
                content=f"Description {i}",
                context="Context",
                confidence_score=0.9,
                position_in_chapter=i * 10,
                word_count=2,
                priority_score=0.8 - (i * 0.1)
            )
            db_session.add(description)
        await db_session.commit()

        # Act
        descriptions = await parsing_service.get_book_descriptions(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert len(descriptions) == 3
        # Check sorting by priority score
        assert descriptions[0].priority_score >= descriptions[-1].priority_score

    @pytest.mark.asyncio
    async def test_get_book_descriptions_filtered_by_type(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения описаний конкретного типа."""
        # Arrange
        chapter = test_book.chapters[0]

        # Create descriptions of different types
        loc_desc = Description(
            chapter_id=chapter.id,
            type=DescriptionType.LOCATION.value,
            content="Location",
            context="Context",
            confidence_score=0.9,
            position_in_chapter=0,
            word_count=1,
            priority_score=0.8
        )
        char_desc = Description(
            chapter_id=chapter.id,
            type=DescriptionType.CHARACTER.value,
            content="Character",
            context="Context",
            confidence_score=0.85,
            position_in_chapter=10,
            word_count=1,
            priority_score=0.7
        )
        db_session.add(loc_desc)
        db_session.add(char_desc)
        await db_session.commit()

        # Act
        descriptions = await parsing_service.get_book_descriptions(
            db=db_session,
            book_id=test_book.id,
            description_type=DescriptionType.LOCATION
        )

        # Assert
        assert len(descriptions) == 1
        assert descriptions[0].type == DescriptionType.LOCATION.value

    @pytest.mark.asyncio
    async def test_get_book_descriptions_empty_book(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения описаний для книги без описаний."""
        # Act
        descriptions = await parsing_service.get_book_descriptions(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert len(descriptions) == 0

    @pytest.mark.asyncio
    async def test_get_book_descriptions_limit(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест лимита на количество описаний."""
        # Arrange
        chapter = test_book.chapters[0]
        for i in range(1, 11):
            description = Description(
                chapter_id=chapter.id,
                type=DescriptionType.LOCATION.value,
                content=f"Description {i}",
                context="Context",
                confidence_score=0.9,
                position_in_chapter=i * 10,
                word_count=2,
                priority_score=0.9 - (i * 0.01)
            )
            db_session.add(description)
        await db_session.commit()

        # Act
        descriptions = await parsing_service.get_book_descriptions(
            db=db_session,
            book_id=test_book.id,
            limit=5
        )

        # Assert
        assert len(descriptions) == 5

    # ==================== PARSING PROGRESS TESTS ====================

    @pytest.mark.asyncio
    async def test_update_parsing_progress_success(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест обновления прогресса парсинга."""
        # Act
        updated_book = await parsing_service.update_parsing_progress(
            db=db_session,
            book_id=test_book.id,
            progress_percent=50
        )

        # Assert
        assert updated_book.parsing_progress == 50
        assert updated_book.is_parsed is False

    @pytest.mark.asyncio
    async def test_update_parsing_progress_completion(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест что завершение парсинга обновляет флаг is_parsed."""
        # Act
        updated_book = await parsing_service.update_parsing_progress(
            db=db_session,
            book_id=test_book.id,
            progress_percent=100
        )

        # Assert
        assert updated_book.parsing_progress == 100
        assert updated_book.is_parsed is True

    @pytest.mark.asyncio
    async def test_update_parsing_progress_clamp_values(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест что прогресс ограничивается от 0 до 100."""
        # Act - test negative clamping
        updated_book = await parsing_service.update_parsing_progress(
            db=db_session,
            book_id=test_book.id,
            progress_percent=-50
        )
        assert updated_book.parsing_progress == 0

        # Act - test upper clamping
        updated_book = await parsing_service.update_parsing_progress(
            db=db_session,
            book_id=test_book.id,
            progress_percent=150
        )
        assert updated_book.parsing_progress == 100

    @pytest.mark.asyncio
    async def test_update_parsing_progress_book_not_found(
        self, parsing_service: BookParsingService, db_session: AsyncSession
    ):
        """Тест обновления прогресса для несуществующей книги."""
        # Act & Assert
        with pytest.raises(ValueError, match="not found"):
            await parsing_service.update_parsing_progress(
                db=db_session,
                book_id=uuid4(),
                progress_percent=50
            )

    # ==================== PARSING STATUS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_parsing_status_initial(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест получения статуса парсинга изначально."""
        # Act
        status = await parsing_service.get_parsing_status(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert status["is_parsed"] is False
        assert status["parsing_progress"] == 0
        assert status["total_chapters"] == len(test_book.chapters)
        assert status["parsed_chapters"] == 0
        assert status["total_descriptions"] == 0

    @pytest.mark.asyncio
    async def test_get_parsing_status_partially_parsed(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест статуса при частичном парсинге."""
        # Arrange
        chapter = test_book.chapters[0]
        chapter.is_description_parsed = True
        chapter.descriptions_found = 5

        description = Description(
            chapter_id=chapter.id,
            type=DescriptionType.LOCATION.value,
            content="Test",
            context="Context",
            confidence_score=0.9,
            position_in_chapter=0,
            word_count=1,
            priority_score=0.8
        )
        db_session.add(description)
        await db_session.commit()

        # Act
        status = await parsing_service.get_parsing_status(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert status["is_parsed"] is False
        assert status["parsed_chapters"] == 1
        assert status["total_descriptions"] >= 1

    @pytest.mark.asyncio
    async def test_get_parsing_status_fully_parsed(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест статуса при полном парсинге."""
        # Arrange
        test_book.is_parsed = True
        test_book.parsing_progress = 100

        for chapter in test_book.chapters:
            chapter.is_description_parsed = True
            chapter.descriptions_found = 3

        await db_session.commit()

        # Act
        status = await parsing_service.get_parsing_status(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert status["is_parsed"] is True
        assert status["parsing_progress"] == 100
        assert status["parsed_chapters"] == len(test_book.chapters)

    @pytest.mark.asyncio
    async def test_get_parsing_status_book_not_found(
        self, parsing_service: BookParsingService, db_session: AsyncSession
    ):
        """Тест получения статуса для несуществующей книги."""
        # Act & Assert
        with pytest.raises(ValueError, match="not found"):
            await parsing_service.get_parsing_status(
                db=db_session,
                book_id=uuid4()
            )

    # ==================== MULTIPLE CHAPTERS TESTS ====================

    @pytest.mark.asyncio
    async def test_parsing_multiple_chapters_tracking(
        self, parsing_service: BookParsingService, db_session: AsyncSession, test_book: Book
    ):
        """Тест отслеживания прогресса парсинга нескольких глав."""
        # Arrange
        total_chapters = len(test_book.chapters)

        # Parse each chapter
        for i, chapter in enumerate(test_book.chapters, 1):
            chapter.is_description_parsed = True
            chapter.descriptions_found = 5

            # Update book progress
            progress = int((i / total_chapters) * 100)
            await parsing_service.update_parsing_progress(
                db=db_session,
                book_id=test_book.id,
                progress_percent=progress
            )

        # Act
        status = await parsing_service.get_parsing_status(
            db=db_session,
            book_id=test_book.id
        )

        # Assert
        assert status["parsed_chapters"] == total_chapters
        assert status["parsing_progress"] >= 100 - (100 // total_chapters)
