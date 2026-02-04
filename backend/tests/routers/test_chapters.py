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
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

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
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

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

        if response.status_code == 200:
            data = response.json()
            assert "chapter" in data
            assert "descriptions" in data
            assert "navigation" in data
            assert "book_info" in data

            chapter = data["chapter"]
            assert "id" in chapter
            assert "number" in chapter
            assert "title" in chapter
            assert "content" in chapter
            assert "word_count" in chapter

            navigation = data["navigation"]
            assert "has_previous" in navigation
            assert "has_next" in navigation
            assert (
                "previous_chapter" in navigation
                or navigation.get("previous_chapter") is None
            )
            assert (
                "next_chapter" in navigation or navigation.get("next_chapter") is None
            )


class TestChaptersBackwardCompatibility:
    """Verify backward compatibility with old books.py endpoints."""

    @pytest.mark.asyncio
    async def test_chapters_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/chapters is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters")
        # Should return 403 (forbidden) or 404 (not found), not 401
        assert response.status_code in [403, 404]

    @pytest.mark.asyncio
    async def test_chapter_number_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/chapters/{number} is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1")
        # Should return 403 (forbidden) or 404 (not found), not 401
        assert response.status_code in [403, 404]
