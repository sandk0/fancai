"""
Tests for chapters router endpoints.

Ensures backward compatibility after refactoring from books.py
"""

import pytest
from httpx import AsyncClient
from uuid import uuid4


class TestChaptersRouter:
    """Test chapter management endpoints."""

    @pytest.mark.asyncio
    async def test_list_chapters_unauthorized(self, client: AsyncClient):
        """Test listing chapters without authentication."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters")
        # приложение отвечает 401: HTTPBearer(auto_error=False) + явный raise
        # в app/core/auth.py:44-48, OAuth2PasswordBearer здесь не используется
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_chapters_book_not_found(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test listing chapters for non-existent book."""
        headers = await authenticated_headers()
        book_id = str(uuid4())
        response = await client.get(
            f"/api/v1/books/{book_id}/chapters", headers=headers
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_chapter_unauthorized(self, client: AsyncClient):
        """Test getting chapter without authentication."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1")
        # приложение отвечает 401: HTTPBearer(auto_error=False) + явный raise
        # в app/core/auth.py:44-48, OAuth2PasswordBearer здесь не используется
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_chapter_not_found(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test getting non-existent chapter."""
        headers = await authenticated_headers()
        book_id = str(uuid4())
        response = await client.get(
            f"/api/v1/books/{book_id}/chapters/999", headers=headers
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_chapter_response_structure(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test chapter response has correct structure."""
        headers = await authenticated_headers()
        # test_book fixture creates a book with 3 chapters (chapter_numbers 1, 2, 3)
        book_id = test_book.id

        response = await client.get(
            f"/api/v1/books/{book_id}/chapters/1", headers=headers
        )

        assert response.status_code == 200
        data = response.json()
        assert set(data) >= {"chapter", "descriptions", "navigation", "book_info"}

        # Схема ChapterResponse: номер главы называется chapter_number
        chapter = data["chapter"]
        assert set(chapter) >= {
            "id",
            "chapter_number",
            "title",
            "content",
            "word_count",
        }
        assert chapter["chapter_number"] == 1

        navigation = data["navigation"]
        assert set(navigation) >= {"has_previous", "has_next"}
        assert navigation["has_previous"] is False
        assert navigation["has_next"] is True


class TestChaptersBackwardCompatibility:
    """Verify backward compatibility with old books.py endpoints."""

    @pytest.mark.asyncio
    async def test_chapters_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/chapters is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters")
        # Маршрут существует, поэтому без токена — 401, а не 404
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_chapter_number_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/chapters/{number} is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1")
        # Маршрут существует, поэтому без токена — 401, а не 404
        assert response.status_code == 401
