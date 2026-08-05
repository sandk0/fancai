"""
Интеграционные тесты для BookParsingService.

Тестирует то, что сервис делает СЕЙЧАС:
- извлечение описаний из главы по запросу через Gemini (без записи в БД);
- сбор описаний по всем главам книги с фильтром по типу и лимитом;
- статус парсинга в его текущем виде.

Из набора убрано вместе с удалением NLP-системы (`0c110210`):
`update_parsing_progress` (метода больше нет), патчи `multi_nlp_manager`
(модуль работает через `gemini_extractor`), ключи статуса `is_parsed`,
`parsing_progress`, `parsed_chapters`, `total_descriptions` и проверки
сохранения описаний в БД — сервис их не сохраняет.

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.book.book_parsing_service import BookParsingService
from app.services.book.book_service import BookService
from app.models.book import Book, BookGenre
from app.models.description import DescriptionType


def _description_dict(content: str, desc_type: str, priority: float) -> dict:
    """Описание в том виде, в каком его отдаёт экстрактор (уже словарём)."""
    return {
        "type": desc_type,
        "content": content,
        "context": "Context",
        "confidence_score": 0.9,
        "priority_score": priority,
        "position_in_chapter": 0,
        "word_count": len(content.split()),
    }


def _extractor(descriptions, available=True):
    """Заглушка `gemini_extractor`: он импортируется внутри методов сервиса."""
    mock = MagicMock()
    mock.is_available.return_value = available
    mock.extract_descriptions = AsyncMock(return_value=descriptions)
    return mock


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
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Описания главы отдаются словарями, как их вернул экстрактор."""
        chapter = test_book.chapters[0]
        extracted = [_description_dict("Beautiful forest", "location", 0.9)]

        with patch(
            "app.services.gemini_extractor.gemini_extractor",
            _extractor(extracted),
        ):
            descriptions = await parsing_service.extract_chapter_descriptions(
                db=db_session, chapter_id=chapter.id
            )

        assert len(descriptions) == 1
        assert descriptions[0]["type"] == "location"
        assert descriptions[0]["content"] == "Beautiful forest"

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_extractor_unavailable(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Недоступный экстрактор — пустой список, а не исключение."""
        chapter = test_book.chapters[0]

        with patch(
            "app.services.gemini_extractor.gemini_extractor",
            _extractor([], available=False),
        ):
            descriptions = await parsing_service.extract_chapter_descriptions(
                db=db_session, chapter_id=chapter.id
            )

        assert descriptions == []

    @pytest.mark.asyncio
    async def test_extract_chapter_descriptions_chapter_not_found(
        self, parsing_service: BookParsingService, db_session: AsyncSession
    ):
        """Тест извлечения описаний для несуществующей главы."""
        with pytest.raises(ValueError, match="not found"):
            await parsing_service.extract_chapter_descriptions(
                db=db_session, chapter_id=uuid4()
            )

    # ==================== GET DESCRIPTIONS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_descriptions_success(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Описания собираются по всем главам и сортируются по приоритету."""
        extracted = [
            _description_dict("Low", "location", 0.1),
            _description_dict("High", "location", 0.9),
        ]

        with patch(
            "app.services.gemini_extractor.gemini_extractor", _extractor(extracted)
        ):
            descriptions = await parsing_service.get_book_descriptions(
                db=db_session, book_id=test_book.id
            )

        # 3 главы фикстуры × 2 описания
        assert len(descriptions) == 6
        assert descriptions[0]["priority_score"] == 0.9
        assert descriptions[-1]["priority_score"] == 0.1

    @pytest.mark.asyncio
    async def test_get_book_descriptions_filtered_by_type(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Фильтр по типу отбрасывает описания других типов."""
        extracted = [
            _description_dict("Location", DescriptionType.LOCATION.value, 0.8),
            _description_dict("Character", DescriptionType.CHARACTER.value, 0.7),
        ]

        with patch(
            "app.services.gemini_extractor.gemini_extractor", _extractor(extracted)
        ):
            descriptions = await parsing_service.get_book_descriptions(
                db=db_session,
                book_id=test_book.id,
                description_type=DescriptionType.LOCATION.value,
            )

        assert len(descriptions) == 3  # по одному на главу
        assert {d["type"] for d in descriptions} == {DescriptionType.LOCATION.value}

    @pytest.mark.asyncio
    async def test_get_book_descriptions_book_without_chapters(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_user,
    ):
        """Книга без глав — пустой список, экстрактор не зовётся."""
        book = Book(
            user_id=test_user.id,
            title="No Chapters",
            genre=BookGenre.OTHER.value,
            language="ru",
            file_path="/tmp/no-chapters.epub",
            file_format="epub",
            file_size=1024,
        )
        db_session.add(book)
        await db_session.commit()

        extractor = _extractor([_description_dict("X", "location", 0.5)])
        with patch("app.services.gemini_extractor.gemini_extractor", extractor):
            descriptions = await parsing_service.get_book_descriptions(
                db=db_session, book_id=book.id
            )

        assert descriptions == []
        extractor.extract_descriptions.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_get_book_descriptions_limit(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Лимит обрезает выдачу и прекращает обход глав."""
        extracted = [
            _description_dict(f"Description {i}", "location", 0.9 - i * 0.01)
            for i in range(10)
        ]

        with patch(
            "app.services.gemini_extractor.gemini_extractor", _extractor(extracted)
        ):
            descriptions = await parsing_service.get_book_descriptions(
                db=db_session, book_id=test_book.id, limit=5
            )

        assert len(descriptions) == 5

    # ==================== PARSING STATUS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_parsing_status_shape(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Статус отдаёт число глав и режим извлечения по запросу."""
        with patch(
            "app.services.gemini_extractor.gemini_extractor", _extractor([])
        ):
            status = await parsing_service.get_parsing_status(
                db=db_session, book_id=test_book.id
            )

        assert status["total_chapters"] == len(test_book.chapters)
        assert status["llm_available"] is True
        assert status["extraction_mode"] == "on_demand"

    @pytest.mark.asyncio
    async def test_get_parsing_status_reports_unavailable_llm(
        self,
        parsing_service: BookParsingService,
        db_session: AsyncSession,
        test_book: Book,
    ):
        """Недоступность LLM видна в статусе."""
        with patch(
            "app.services.gemini_extractor.gemini_extractor",
            _extractor([], available=False),
        ):
            status = await parsing_service.get_parsing_status(
                db=db_session, book_id=test_book.id
            )

        assert status["llm_available"] is False

    @pytest.mark.asyncio
    async def test_get_parsing_status_book_not_found(
        self, parsing_service: BookParsingService, db_session: AsyncSession
    ):
        """Тест получения статуса для несуществующей книги."""
        with pytest.raises(ValueError, match="not found"):
            await parsing_service.get_parsing_status(db=db_session, book_id=uuid4())
