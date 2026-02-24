import pytest
from httpx import AsyncClient
from unittest.mock import patch
from uuid import uuid4


class TestBooks:
    """Test book management endpoints."""

    @pytest.mark.asyncio
    async def test_get_books_empty(self, client: AsyncClient, authenticated_headers):
        """Test getting books when none exist."""
        headers = await authenticated_headers()

        response = await client.get("/api/v1/books/", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["books"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_upload_book_unauthorized(self, client: AsyncClient):
        """Test uploading book without authentication."""
        files = {"file": ("test.epub", b"fake epub content", "application/epub+zip")}

        response = await client.post("/api/v1/books/upload", files=files)

        # FastAPI returns 403 for missing auth (not 401)
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_upload_book_success(
        self, client: AsyncClient, authenticated_headers, sample_book_data
    ):
        """Test successful book upload (simplified - checks validation only)."""
        headers = await authenticated_headers()

        # Mock the parser and celery to avoid actual processing
        with patch("app.services.book_parser.book_parser.parse_book") as mock_parse:
            with patch("app.core.tasks.process_book_task.delay"):
                from app.services.book_parser import ParsedBook, BookMetadata

                mock_parse.return_value = ParsedBook(
                    metadata=BookMetadata(
                        title=sample_book_data["title"],
                        author=sample_book_data["author"],
                    ),
                    chapters=[],
                    file_format="epub",
                    total_pages=100,
                    estimated_reading_time=50,
                )

                files = {
                    "file": ("test.epub", b"fake epub content", "application/epub+zip")
                }

                response = await client.post(
                    "/api/v1/books/upload", files=files, headers=headers
                )

        # Check successful response
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == sample_book_data["title"]
        assert data["is_processing"] is True

    @pytest.mark.asyncio
    async def test_upload_book_invalid_format(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test uploading book with invalid format."""
        headers = await authenticated_headers()
        files = {"file": ("test.txt", b"not an epub file", "text/plain")}

        response = await client.post(
            "/api/v1/books/upload", files=files, headers=headers
        )

        assert response.status_code == 400
        assert "invalid file format" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_upload_book_too_large(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test uploading book that's too large."""
        headers = await authenticated_headers()

        # Create a large fake file (over 50MB)
        large_content = b"x" * (50 * 1024 * 1024 + 1)
        files = {"file": ("large.epub", large_content, "application/epub+zip")}

        response = await client.post(
            "/api/v1/books/upload", files=files, headers=headers
        )

        assert response.status_code == 400
        assert "too large" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_get_book_by_id(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test getting a book by ID."""
        headers = await authenticated_headers()

        response = await client.get(f"/api/v1/books/{test_book.id}", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(test_book.id)
        assert data["title"] == test_book.title

    @pytest.mark.asyncio
    async def test_get_nonexistent_book(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test getting a non-existent book."""
        headers = await authenticated_headers()

        # Use valid UUID4 format
        nonexistent_id = uuid4()
        response = await client.get(f"/api/v1/books/{nonexistent_id}", headers=headers)

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_book_invalid_uuid(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test getting a book with invalid UUID format."""
        headers = await authenticated_headers()

        response = await client.get(
            "/api/v1/books/invalid-uuid-format", headers=headers
        )

        # FastAPI returns 422 for invalid UUID
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_books_with_pagination(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test getting books with pagination."""
        headers = await authenticated_headers()

        response = await client.get("/api/v1/books/?skip=0&limit=3", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert "books" in data
        assert "total" in data
        assert data["skip"] == 0
        assert data["limit"] == 3

    @pytest.mark.asyncio
    async def test_get_book_file(
        self, client: AsyncClient, authenticated_headers, test_book, db_session
    ):
        """Test getting book EPUB file."""
        headers = await authenticated_headers()

        # Create a temporary epub file for testing
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(mode="wb", suffix=".epub", delete=False) as f:
            f.write(b"fake epub content")
            temp_path = f.name

        # Update book file path to the temp file
        test_book.file_path = temp_path
        db_session.add(test_book)
        await db_session.commit()

        try:
            response = await client.get(
                f"/api/v1/books/{test_book.id}/file", headers=headers
            )

            assert response.status_code == 200
            assert response.headers["content-type"] == "application/epub+zip"
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_path)
            except:
                pass

    @pytest.mark.asyncio
    async def test_get_book_cover(self, client: AsyncClient, test_book, db_session):
        """Test getting book cover image."""
        # This endpoint doesn't require authentication for covers

        # Create a temporary image file
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(mode="wb", suffix=".jpg", delete=False) as f:
            f.write(b"fake image content")
            temp_path = f.name

        # Update book cover path
        test_book.cover_image = temp_path
        db_session.add(test_book)
        await db_session.commit()

        try:
            response = await client.get(f"/api/v1/books/{test_book.id}/cover")

            assert response.status_code == 200
            assert response.headers["content-type"] == "image/jpeg"
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass

    @pytest.mark.asyncio
    async def test_get_book_cover_not_found(self, client: AsyncClient, test_book):
        """Test getting book cover when it doesn't exist."""
        response = await client.get(f"/api/v1/books/{test_book.id}/cover")

        assert response.status_code == 404
        # API returns JSON with error information
        response_data = response.json()
        # Check if either "detail" or "message" key exists (different error formats)
        assert "detail" in response_data or "message" in response_data
        error_message = response_data.get(
            "detail", response_data.get("message", "")
        ).lower()
        assert "cover" in error_message or "not found" in error_message

    @pytest.mark.asyncio
    async def test_process_book(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test starting book processing for descriptions."""
        headers = await authenticated_headers()

        with patch(
            "app.services.parsing_manager.parsing_manager.can_start_parsing"
        ) as mock_can_start:
            with patch(
                "app.services.parsing_manager.parsing_manager.get_user_priority"
            ) as mock_priority:
                with patch(
                    "app.services.parsing_manager.parsing_manager.acquire_parsing_lock"
                ) as mock_lock:
                    with patch("app.core.tasks.process_book_task.delay"):
                        mock_can_start.return_value = (True, "Ready to parse")
                        mock_priority.return_value = 1
                        mock_lock.return_value = True

                        response = await client.post(
                            f"/api/v1/books/{test_book.id}/process", headers=headers
                        )

        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    @pytest.mark.asyncio
    async def test_get_parsing_status(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test getting parsing status for a book."""
        headers = await authenticated_headers()

        response = await client.get(
            f"/api/v1/books/{test_book.id}/parsing-status", headers=headers
        )

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "progress" in data
        assert data["book_id"] == str(test_book.id)
