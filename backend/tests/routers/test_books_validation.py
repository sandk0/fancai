"""Валидация и превью книги без сохранения: `app/routers/books/validation.py`.

Три маршрута — `/parser-status`, `/validate-file`, `/parse-preview` — не имеют
`Depends(get_current_active_user)`: они доступны без токена. Это зафиксировано
тестом намеренно, потому что `/parse-preview` запускает разбор произвольного
загруженного файла от анонима.
"""

import io
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.integration.test_book_upload_flow_integration import create_minimal_epub


def _padded_epub() -> io.BytesIO:
    """EPUB заведомо крупнее 1 КБ: меньший `/validate-file` отбивает как «too small»."""
    epub = create_minimal_epub()
    data = epub.getvalue()
    assert len(data) >= 1024, "фикстура EPUB стала меньше порога 1 КБ"
    return io.BytesIO(data)


def _upload(content: bytes, filename: str = "book.epub") -> dict:
    return {"file": (filename, io.BytesIO(content), "application/epub+zip")}


class TestParserStatus:
    @pytest.mark.asyncio
    async def test_reports_supported_formats(self, client: AsyncClient):
        response = await client.get("/api/v1/books/parser-status")

        assert response.status_code == 200
        body = response.json()
        assert set(body["supported_formats"]) == {"epub", "fb2"}
        assert body["parser_ready"] is True
        assert body["max_file_size_mb"] == 50

    @pytest.mark.asyncio
    async def test_not_ready_when_parser_supports_nothing(self, client: AsyncClient):
        """`parser_ready` — производное от списка форматов, а не константа."""
        with patch(
            "app.services.book_parser.book_parser.get_supported_formats",
            return_value=[],
        ):
            response = await client.get("/api/v1/books/parser-status")

        assert response.status_code == 200
        assert response.json()["parser_ready"] is False


class TestValidateFile:
    @pytest.mark.asyncio
    async def test_valid_epub_is_accepted(self, client: AsyncClient):
        epub = _padded_epub()

        response = await client.post(
            "/api/v1/books/validate-file", files=_upload(epub.getvalue())
        )

        assert response.status_code == 200
        body = response.json()
        assert body["validation"]["is_valid"] is True
        assert body["validation"]["format"] == "epub"
        assert body["message"] == "File validated successfully"
        assert body["file_size_bytes"] == len(epub.getvalue())

    @pytest.mark.asyncio
    async def test_unsupported_extension_is_400(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/books/validate-file",
            files={"file": ("book.pdf", io.BytesIO(b"x" * 2048), "application/pdf")},
        )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_oversized_file_is_400(self, client: AsyncClient):
        """Порог 50 МБ проверяется по прочитанному телу, до разбора."""
        response = await client.post(
            "/api/v1/books/validate-file",
            files=_upload(b"\x00" * (50 * 1024 * 1024 + 1)),
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "File too large (max 50MB)"

    @pytest.mark.asyncio
    async def test_tiny_file_is_400(self, client: AsyncClient):
        """Меньше 1 КБ — это не книга, разбор запускать незачем."""
        response = await client.post(
            "/api/v1/books/validate-file", files=_upload(b"tiny")
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "File too small"

    @pytest.mark.asyncio
    async def test_corrupted_epub_reports_invalid_not_error(self, client: AsyncClient):
        """Битый zip — валидный ответ с `is_valid: false`, а не 5xx."""
        response = await client.post(
            "/api/v1/books/validate-file",
            files=_upload(b"PK\x03\x04" + b"broken" * 400),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["validation"]["is_valid"] is False
        assert body["message"] == "File validation failed"


class TestParsePreview:
    @pytest.mark.asyncio
    async def test_preview_returns_metadata_and_first_chapters(
        self, client: AsyncClient
    ):
        epub = _padded_epub()

        response = await client.post(
            "/api/v1/books/parse-preview", files=_upload(epub.getvalue())
        )

        assert response.status_code == 200
        body = response.json()
        assert body["metadata"]["title"] == "Test Book for Integration"
        assert body["metadata"]["author"] == "Test Author"
        assert body["statistics"]["file_format"] == "epub"
        assert body["statistics"]["total_chapters"] >= 1
        # Превью ограничено тремя главами независимо от размера книги.
        assert len(body["chapters_preview"]) <= 3
        assert body["chapters_preview"][0]["estimated_reading_time_minutes"] >= 1

    @pytest.mark.asyncio
    async def test_long_chapter_preview_is_truncated(self, client: AsyncClient):
        """В превью уезжает 500 символов главы, а не вся глава."""
        from tests.conftest import MockParsedBook

        parsed = MockParsedBook()
        parsed.chapters = [
            MockParsedBook.Chapter(
                number=1,
                title="Длинная",
                content="я" * 900,
                html_content="<p/>",
                word_count=900,
            )
        ]

        with patch(
            "app.services.book_parser.book_parser.parse_book",
            AsyncMock(return_value=parsed),
        ):
            response = await client.post(
                "/api/v1/books/parse-preview", files=_upload(b"x" * 2048)
            )

        assert response.status_code == 200
        preview = response.json()["chapters_preview"][0]["content_preview"]
        assert preview == "я" * 500 + "..."

    @pytest.mark.asyncio
    async def test_long_description_is_truncated(self, client: AsyncClient):
        from tests.conftest import MockParsedBook

        parsed = MockParsedBook()
        parsed.metadata.description = "о" * 1500

        with patch(
            "app.services.book_parser.book_parser.parse_book",
            AsyncMock(return_value=parsed),
        ):
            response = await client.post(
                "/api/v1/books/parse-preview", files=_upload(b"x" * 2048)
            )

        assert response.status_code == 200
        assert response.json()["metadata"]["description"] == "о" * 1000 + "..."

    @pytest.mark.asyncio
    async def test_unsupported_extension_is_400(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/books/parse-preview",
            files={"file": ("book.txt", io.BytesIO(b"x" * 2048), "text/plain")},
        )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_oversized_file_is_400(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/books/parse-preview",
            files=_upload(b"\x00" * (50 * 1024 * 1024 + 1)),
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "File too large (max 50MB)"

    @pytest.mark.asyncio
    async def test_parser_failure_is_500_without_leaking_details(
        self, client: AsyncClient
    ):
        with patch(
            "app.services.book_parser.book_parser.parse_book",
            AsyncMock(side_effect=RuntimeError("Bad Zip file: /tmp/secret.epub")),
        ):
            response = await client.post(
                "/api/v1/books/parse-preview", files=_upload(b"x" * 2048)
            )

        assert response.status_code == 500
        # Путь временного файла и текст исключения наружу не уходят.
        body = response.text
        assert "secret.epub" not in body
        assert "/tmp/" not in body
