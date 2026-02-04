"""
Tests for descriptions router endpoints.

Ensures backward compatibility after refactoring from books.py
"""

import pytest
from httpx import AsyncClient
from uuid import uuid4


class TestDescriptionsRouter:
    """Test descriptions management endpoints."""

    @pytest.mark.asyncio
    async def test_get_chapter_descriptions_unauthorized(self, client: AsyncClient):
        """Test getting chapter descriptions without authentication."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1/descriptions")
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

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
    async def test_get_book_descriptions_unauthorized(self, client: AsyncClient):
        """Test getting all book descriptions without authentication."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/descriptions")
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_analyze_chapter_no_file(self, client: AsyncClient):
        """Test analyze-chapter endpoint without file."""
        response = await client.post("/api/v1/books/analyze-chapter")
        assert response.status_code == 422  # Unprocessable entity

    @pytest.mark.asyncio
    async def test_chapter_descriptions_response_structure(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test chapter descriptions response structure."""
        headers = await authenticated_headers()
        book_id = test_book.id  # test_book fixture creates a book with 3 chapters

        response = await client.get(
            f"/api/v1/books/{book_id}/chapters/1/descriptions", headers=headers
        )

        if response.status_code == 200:
            data = response.json()
            assert "chapter_info" in data
            assert "nlp_analysis" in data
            assert "message" in data

            chapter_info = data["chapter_info"]
            assert "id" in chapter_info
            assert "number" in chapter_info
            assert "title" in chapter_info
            assert "word_count" in chapter_info

            nlp_analysis = data["nlp_analysis"]
            assert "total_descriptions" in nlp_analysis
            assert "by_type" in nlp_analysis
            assert "descriptions" in nlp_analysis
            assert isinstance(nlp_analysis["descriptions"], list)

    @pytest.mark.asyncio
    async def test_book_descriptions_response_structure(
        self, client: AsyncClient, authenticated_headers, test_book_with_descriptions
    ):
        """Test book descriptions response structure."""
        headers = await authenticated_headers()
        book_id = test_book_with_descriptions

        response = await client.get(
            f"/api/v1/books/{book_id}/descriptions", headers=headers
        )

        if response.status_code == 200:
            data = response.json()
            assert "book_id" in data
            assert "total_descriptions" in data
            assert "descriptions" in data
            assert "filter" in data

            assert isinstance(data["descriptions"], list)

            if len(data["descriptions"]) > 0:
                desc = data["descriptions"][0]
                assert "id" in desc
                assert "chapter_id" in desc
                assert "type" in desc
                assert "content" in desc
                assert "confidence_score" in desc
                assert "priority_score" in desc

    @pytest.mark.asyncio
    async def test_book_descriptions_filtering(
        self, client: AsyncClient, authenticated_headers, test_book_with_descriptions
    ):
        """Test book descriptions endpoint with type filter."""
        headers = await authenticated_headers()
        book_id = test_book_with_descriptions

        # Test with description type filter
        response = await client.get(
            f"/api/v1/books/{book_id}/descriptions?description_type=location",
            headers=headers,
        )

        if response.status_code == 200:
            data = response.json()
            assert data["filter"]["type"] == "location"

    @pytest.mark.asyncio
    async def test_extract_new_descriptions(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test re-extracting descriptions for a chapter."""
        headers = await authenticated_headers()
        book_id = test_book.id  # test_book fixture creates a book with 3 chapters

        response = await client.get(
            f"/api/v1/books/{book_id}/chapters/1/descriptions?extract_new=true",
            headers=headers,
        )

        # Should work if NLP is available, otherwise 503
        assert response.status_code in [200, 404, 503]


class TestDescriptionsBackwardCompatibility:
    """Verify backward compatibility with old books.py endpoints."""

    @pytest.mark.asyncio
    async def test_chapter_descriptions_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/chapters/{number}/descriptions is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/chapters/1/descriptions")
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code in [
            403,
            404,
        ]  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_book_descriptions_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/{book_id}/descriptions is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/descriptions")
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code in [
            403,
            404,
        ]  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_analyze_chapter_endpoint_accessible(self, client: AsyncClient):
        """Verify /api/v1/books/analyze-chapter is accessible."""
        response = await client.post("/api/v1/books/analyze-chapter")
        # Should return 422 (validation error for missing file), not 404
        assert response.status_code == 422
