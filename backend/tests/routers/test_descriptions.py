"""
Tests for descriptions router endpoints.

Проверяется единственный публичный маршрут главы:
`GET /api/v1/books/{book_id}/chapters/{chapter_number}/descriptions`.

Из набора убраны тесты `/api/v1/books/{book_id}/descriptions`
и `/api/v1/books/analyze-chapter`: таких маршрутов в приложении нет
(`curl /openapi.json` — только `/books/descriptions/{description_id}`
и маршруты глав), поэтому «проверки обратной совместимости» ловили
не 403 без авторизации, а 404/405 отсутствующего маршрута.
"""

import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.services.description_extraction_service import (
    ExtractionLockError,
    ExtractionResult,
    ExtractionTimeoutError,
    LLMUnavailableError,
)


async def _make_prose_chapter(
    db: AsyncSession, book, *, number: int, word_count: int = 500, title: str = ""
) -> Chapter:
    """Глава, которую парсер НЕ сочтёт служебной.

    Две ловушки сразу:

    * `Chapter.check_is_service_page()` объявляет служебной любую главу
      короче 100 слов, а главы `test_book` — по 10 слов; без своей главы
      весь путь извлечения короткозамыкается на пустой ответ;
    * вставлять главу надо ЧЕРЕЗ `book.chapters`. Фикстура отдаёт книгу
      с уже загруженной коллекцией, роутер получает из identity map тот же
      объект, и `selectinload` её не перечитывает — глава мимо коллекции
      для роутера просто не существует (404).
    """
    chapter = Chapter(
        chapter_number=number,
        title=title or f"Глава {number}",
        content="Ведьмак шёл по тракту. " * 120,
        word_count=word_count,
        is_service_page=False,
    )
    book.chapters.append(chapter)
    await db.commit()
    await db.refresh(chapter)
    return chapter


async def _make_description(db: AsyncSession, chapter: Chapter) -> Description:
    description = Description(
        chapter_id=chapter.id,
        type=DescriptionType.LOCATION,
        content="Тёмный лес под дождём",
        confidence_score=0.9,
        priority_score=0.7,
        position_in_chapter=0,
        word_count=4,
    )
    db.add(description)
    await db.commit()
    await db.refresh(description)
    return description


class TestDescriptionsRouter:
    """Test descriptions management endpoints."""

    @pytest.mark.asyncio
    async def test_get_chapter_descriptions_unauthorized(self, client: AsyncClient):
        """Без токена — 401.

        Приложение использует `HTTPBearer(auto_error=False)` и поднимает 401
        само (`app/core/auth.py:44-48`); 403 из старого комментария давал
        OAuth2PasswordBearer, которого здесь нет.
        """
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1/descriptions")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_chapter_descriptions_book_not_found(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test getting descriptions for non-existent book."""
        headers = await authenticated_headers()
        book_id = str(uuid4())
        response = await client.get(
            f"/api/v1/books/{book_id}/chapters/1/descriptions", headers=headers
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_chapter_descriptions_foreign_book(
        self, client: AsyncClient, auth_headers, test_book
    ):
        """Книга другого пользователя не видна — 404, а не 200."""
        response = await client.get(
            f"/api/v1/books/{test_book.id}/chapters/1/descriptions",
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_chapter_descriptions_response_structure(
        self, client: AsyncClient, test_user_auth_headers, test_book
    ):
        """Структура ответа для главы без описаний."""
        response = await client.get(
            f"/api/v1/books/{test_book.id}/chapters/1/descriptions",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert set(data) >= {"chapter_info", "nlp_analysis", "message"}

        chapter_info = data["chapter_info"]
        assert set(chapter_info) >= {"id", "number", "title", "word_count"}
        assert chapter_info["number"] == 1

        nlp_analysis = data["nlp_analysis"]
        assert set(nlp_analysis) >= {"total_descriptions", "by_type", "descriptions"}
        assert nlp_analysis["descriptions"] == []
        assert nlp_analysis["total_descriptions"] == 0

    @pytest.mark.asyncio
    async def test_chapter_descriptions_unknown_chapter(
        self, client: AsyncClient, test_user_auth_headers, test_book
    ):
        """Несуществующий номер главы — 404 (фикстура создаёт три главы)."""
        response = await client.get(
            f"/api/v1/books/{test_book.id}/chapters/999/descriptions",
            headers=test_user_auth_headers,
        )
        assert response.status_code == 404


class TestChapterExtractionOnDemand:
    """`?extract_new=true` — синхронный вызов LLM из HTTP-запроса."""

    @pytest.mark.asyncio
    async def test_extraction_result_is_returned_and_cache_dropped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        chapter = await _make_prose_chapter(db_session, test_book, number=10)
        description = await _make_description(db_session, chapter)

        with (
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.extract_for_chapter",
                AsyncMock(
                    return_value=ExtractionResult(
                        descriptions=[description],
                        chapter_id=chapter.id,
                        extraction_time_ms=2500,
                    )
                ),
            ),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.invalidate_cache",
                AsyncMock(),
            ) as invalidate,
        ):
            response = await client.get(
                f"/api/v1/books/{test_book.id}/chapters/10/descriptions"
                "?extract_new=true",
                headers=test_user_auth_headers,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["nlp_analysis"]["total_descriptions"] == 1
        assert body["nlp_analysis"]["processing_time_seconds"] == 2.5
        # Кэш главы обязан быть сброшен: иначе следующий чтец получит старый ответ.
        invalidate.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_llm_unavailable_is_503(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        await _make_prose_chapter(db_session, test_book, number=11)

        with patch(
            "app.services.description_extraction_service"
            ".DescriptionExtractionService.extract_for_chapter",
            AsyncMock(side_effect=LLMUnavailableError()),
        ):
            response = await client.get(
                f"/api/v1/books/{test_book.id}/chapters/11/descriptions"
                "?extract_new=true",
                headers=test_user_auth_headers,
            )

        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_concurrent_extraction_is_409_with_retry_hint(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        """Клиент читалки повторяет запрос по `retry_after_seconds`."""
        chapter = await _make_prose_chapter(db_session, test_book, number=12)

        with patch(
            "app.services.description_extraction_service"
            ".DescriptionExtractionService.extract_for_chapter",
            AsyncMock(side_effect=ExtractionLockError(chapter.id)),
        ):
            response = await client.get(
                f"/api/v1/books/{test_book.id}/chapters/12/descriptions"
                "?extract_new=true",
                headers=test_user_auth_headers,
            )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["retry_after_seconds"] == 15
        assert detail["chapter_id"] == str(chapter.id)

    @pytest.mark.asyncio
    async def test_timeout_is_504_with_budget(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        chapter = await _make_prose_chapter(db_session, test_book, number=13)

        with patch(
            "app.services.description_extraction_service"
            ".DescriptionExtractionService.extract_for_chapter",
            AsyncMock(side_effect=ExtractionTimeoutError(chapter.id, 90.0)),
        ):
            response = await client.get(
                f"/api/v1/books/{test_book.id}/chapters/13/descriptions"
                "?extract_new=true",
                headers=test_user_auth_headers,
            )

        assert response.status_code == 504
        assert response.json()["detail"]["timeout_seconds"] == 90.0

    @pytest.mark.asyncio
    async def test_service_page_verdict_is_persisted(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        """Вердикт считается один раз и записывается в главу."""
        chapter = Chapter(
            chapter_number=14,
            title="Оглавление",
            content="Глава 1 ... Глава 2 ...",
            word_count=400,
        )
        test_book.chapters.append(chapter)
        await db_session.commit()
        assert chapter.is_service_page is None

        response = await client.get(
            f"/api/v1/books/{test_book.id}/chapters/14/descriptions",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["nlp_analysis"]["descriptions"] == []
        await db_session.refresh(chapter, ["is_service_page"])
        assert chapter.is_service_page is True


class TestGetDescriptionById:
    @pytest.mark.asyncio
    async def test_owner_gets_description(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        chapter = await _make_prose_chapter(db_session, test_book, number=20)
        description = await _make_description(db_session, chapter)

        response = await client.get(
            f"/api/v1/books/descriptions/{description.id}",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == str(description.id)
        assert body["content"] == "Тёмный лес под дождём"
        assert body["type"] == "location"

    @pytest.mark.asyncio
    async def test_foreign_description_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        auth_headers,
    ):
        chapter = await _make_prose_chapter(db_session, test_book, number=21)
        description = await _make_description(db_session, chapter)

        response = await client.get(
            f"/api/v1/books/descriptions/{description.id}", headers=auth_headers
        )

        assert response.status_code == 404


class TestBatchDescriptions:
    @pytest.mark.asyncio
    async def test_batch_reports_per_chapter_outcome(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        """Одна глава с описанием, одна служебная, одной не существует."""
        chapter = await _make_prose_chapter(db_session, test_book, number=30)
        await _make_description(db_session, chapter)

        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/batch",
            json={"chapter_numbers": [30, 1, 999]},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total_requested"] == 3
        assert body["total_success"] == 2
        assert body["total_descriptions"] == 1

        # Порядок ответа повторяет порядок запроса.
        assert [c["chapter_number"] for c in body["chapters"]] == [30, 1, 999]
        assert body["chapters"][0]["data"]["nlp_analysis"]["total_descriptions"] == 1
        assert body["chapters"][1]["data"]["nlp_analysis"]["descriptions"] == []
        assert body["chapters"][2]["success"] is False
        assert body["chapters"][2]["error"] == "Chapter 999 not found"

    @pytest.mark.asyncio
    async def test_batch_for_foreign_book_is_404(
        self, client: AsyncClient, test_book, auth_headers
    ):
        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/batch",
            json={"chapter_numbers": [1]},
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestBackgroundExtractionTrigger:
    """`POST /{book_id}/chapters/{n}/extract-background` — постановка задачи."""

    @pytest.mark.asyncio
    async def test_service_page_is_skipped_without_task(
        self, client: AsyncClient, test_book, test_user_auth_headers
    ):
        """Главы фикстуры — по 10 слов, парсер считает их служебными."""
        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/1/extract-background",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        assert response.json() == {
            "status": "skipped",
            "chapter_number": 1,
            "reason": "service_page",
        }

    @pytest.mark.asyncio
    async def test_already_extracted_chapter_is_not_requeued(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        chapter = await _make_prose_chapter(db_session, test_book, number=40)
        await _make_description(db_session, chapter)

        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/40/extract-background",
            headers=test_user_auth_headers,
        )

        assert response.json()["status"] == "already_extracted"

    @pytest.mark.asyncio
    async def test_unavailable_llm_is_reported_not_queued(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        await _make_prose_chapter(db_session, test_book, number=41)

        with patch(
            "app.services.description_extraction_service"
            ".DescriptionExtractionService.is_llm_available",
            return_value=False,
        ):
            response = await client.post(
                f"/api/v1/books/{test_book.id}/chapters/41/extract-background",
                headers=test_user_auth_headers,
            )

        assert response.json() == {
            "status": "unavailable",
            "chapter_number": 41,
            "reason": "llm_processor_unavailable",
        }

    @pytest.mark.asyncio
    async def test_unknown_chapter_is_404(
        self, client: AsyncClient, test_book, test_user_auth_headers
    ):
        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/999/extract-background",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_foreign_book_is_404(
        self, client: AsyncClient, test_book, auth_headers
    ):
        response = await client.post(
            f"/api/v1/books/{test_book.id}/chapters/1/extract-background",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_task_is_queued_and_runs_extraction(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book,
        test_user_auth_headers,
    ):
        """Фоновая задача открывает СВОЮ сессию — подменяем на тестовую."""
        from tests.conftest import TestSessionLocal

        chapter = await _make_prose_chapter(db_session, test_book, number=42)
        description = await _make_description(db_session, chapter)
        # Описание нужно только как заготовка результата: сам чек «уже
        # извлечено» должен видеть пустую главу, поэтому удаляем.
        await db_session.delete(description)
        await db_session.commit()

        with (
            patch("app.routers.descriptions.AsyncSessionLocal", TestSessionLocal),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.is_llm_available",
                return_value=True,
            ),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.extract_for_chapter",
                AsyncMock(
                    return_value=ExtractionResult(
                        descriptions=[], chapter_id=chapter.id, extraction_time_ms=10
                    )
                ),
            ) as extract,
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.invalidate_cache",
                AsyncMock(),
            ),
        ):
            response = await client.post(
                f"/api/v1/books/{test_book.id}/chapters/42/extract-background",
                headers=test_user_auth_headers,
            )

        assert response.json()["status"] == "extraction_started"
        # BackgroundTasks выполняются до возврата управления из ASGI-вызова.
        extract.assert_awaited_once()
        assert extract.await_args.args[0].id == chapter.id


class TestBackgroundExtractionWorker:
    """`_background_extract_descriptions` — то, что реально идёт в фоне."""

    @pytest.fixture(autouse=True)
    def worker_uses_test_db(self):
        from tests.conftest import TestSessionLocal

        with patch("app.routers.descriptions.AsyncSessionLocal", TestSessionLocal):
            yield

    @pytest.mark.asyncio
    async def test_missing_chapter_is_silent(self, test_db):
        from app.routers.descriptions import _background_extract_descriptions

        await _background_extract_descriptions(
            chapter_id=str(uuid4()), book_id=str(uuid4()), chapter_number=1
        )

    @pytest.mark.asyncio
    async def test_chapter_with_descriptions_is_skipped(
        self, db_session: AsyncSession, test_book
    ):
        from app.routers.descriptions import _background_extract_descriptions

        chapter = await _make_prose_chapter(db_session, test_book, number=50)
        await _make_description(db_session, chapter)

        with patch(
            "app.services.description_extraction_service"
            ".DescriptionExtractionService.extract_for_chapter",
            AsyncMock(),
        ) as extract:
            await _background_extract_descriptions(
                chapter_id=str(chapter.id),
                book_id=str(test_book.id),
                chapter_number=50,
            )

        extract.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unavailable_llm_stops_before_extraction(
        self, db_session: AsyncSession, test_book
    ):
        from app.routers.descriptions import _background_extract_descriptions

        chapter = await _make_prose_chapter(db_session, test_book, number=51)

        with (
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.is_llm_available",
                return_value=False,
            ),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.extract_for_chapter",
                AsyncMock(),
            ) as extract,
        ):
            await _background_extract_descriptions(
                chapter_id=str(chapter.id),
                book_id=str(test_book.id),
                chapter_number=51,
            )

        extract.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_persisted_descriptions_survive_the_worker(
        self, db_session: AsyncSession, test_book
    ):
        """Фон пишет через собственную сессию — проверяем именно запись в БД."""
        from app.routers.descriptions import _background_extract_descriptions

        chapter = await _make_prose_chapter(db_session, test_book, number=52)

        async def _extract(target_chapter):
            from tests.conftest import TestSessionLocal

            async with TestSessionLocal() as session:
                session.add(
                    Description(
                        chapter_id=target_chapter.id,
                        type=DescriptionType.CHARACTER,
                        content="Седой ведьмак",
                        confidence_score=0.9,
                        priority_score=0.6,
                        position_in_chapter=0,
                        word_count=2,
                    )
                )
                await session.commit()
            return ExtractionResult(
                descriptions=[], chapter_id=target_chapter.id, extraction_time_ms=5
            )

        with (
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.is_llm_available",
                return_value=True,
            ),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.extract_for_chapter",
                AsyncMock(side_effect=_extract),
            ),
            patch(
                "app.services.description_extraction_service"
                ".DescriptionExtractionService.invalidate_cache",
                AsyncMock(),
            ),
        ):
            await _background_extract_descriptions(
                chapter_id=str(chapter.id),
                book_id=str(test_book.id),
                chapter_number=52,
            )

        stored = await db_session.scalar(
            select(Description).where(Description.chapter_id == chapter.id)
        )
        assert stored is not None
        assert stored.content == "Седой ведьмак"

    @pytest.mark.asyncio
    async def test_lock_and_timeout_do_not_escape(
        self, db_session: AsyncSession, test_book
    ):
        """Задача уходит в BackgroundTasks: необработанное исключение — 500 клиенту."""
        from app.routers.descriptions import _background_extract_descriptions

        chapter = await _make_prose_chapter(db_session, test_book, number=53)

        for error in (
            ExtractionLockError(chapter.id),
            ExtractionTimeoutError(chapter.id, 90.0),
        ):
            with (
                patch(
                    "app.services.description_extraction_service"
                    ".DescriptionExtractionService.is_llm_available",
                    return_value=True,
                ),
                patch(
                    "app.services.description_extraction_service"
                    ".DescriptionExtractionService.extract_for_chapter",
                    AsyncMock(side_effect=error),
                ),
            ):
                await _background_extract_descriptions(
                    chapter_id=str(chapter.id),
                    book_id=str(test_book.id),
                    chapter_number=53,
                )
