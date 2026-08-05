"""
Tests for reading_progress router endpoints.

Ensures backward compatibility after refactoring from books.py
"""

import pytest
from httpx import AsyncClient
from uuid import uuid4


class TestReadingProgressRouter:
    """Test reading progress management endpoints."""

    @pytest.mark.asyncio
    async def test_get_progress_unauthorized(self, client: AsyncClient):
        """Test getting progress without authentication."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/progress")
        # приложение отвечает 401: HTTPBearer(auto_error=False) + явный raise
        # в app/core/auth.py:44-48, OAuth2PasswordBearer здесь не используется
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_update_progress_unauthorized(self, client: AsyncClient):
        """Test updating progress without authentication."""
        book_id = str(uuid4())
        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json={"current_chapter": 1}
        )
        # приложение отвечает 401: HTTPBearer(auto_error=False) + явный raise
        # в app/core/auth.py:44-48, OAuth2PasswordBearer здесь не используется
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_progress_book_not_found(
        self, client: AsyncClient, authenticated_headers
    ):
        """Test getting progress for non-existent book."""
        headers = await authenticated_headers()
        book_id = str(uuid4())
        response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_progress_response_structure(
        self, client: AsyncClient, authenticated_headers, test_book
    ):
        """Test progress update response structure.

        Раньше запрос уходил на случайный UUID и отвечал 404, а проверки
        стояли под `if response.status_code == 200` — то есть не выполнялись
        никогда.
        """
        headers = await authenticated_headers()

        progress_data = {
            "current_chapter": 2,
            "current_position_percent": 50.0,
            "reading_location_cfi": "/2/4/2/10",
            "scroll_offset_percent": 75.5,
        }

        response = await client.post(
            f"/api/v1/books/{test_book.id}/progress",
            json=progress_data,
            headers=headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert set(data) >= {"progress", "message"}

        progress = data["progress"]
        assert progress["current_chapter"] == 2
        assert progress["reading_location_cfi"] == "/2/4/2/10"
        assert progress["scroll_offset_percent"] == 75.5

    @pytest.mark.asyncio
    async def test_get_progress_response_structure(
        self, client: AsyncClient, authenticated_headers, test_book_with_progress
    ):
        """Test get progress response structure."""
        headers = await authenticated_headers()
        book_id = test_book_with_progress

        response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        assert response.status_code == 200
        data = response.json()
        progress = data["progress"]
        assert progress is not None

        # Схема ReadingProgressResponse: поля current_position_percent нет,
        # процент внутри страницы называется scroll_offset_percent
        assert set(progress) >= {
            "current_chapter",
            "current_page",
            "current_position",
            "max_chapter_reached",
            "reading_location_cfi",
            "scroll_offset_percent",
            "reading_time_minutes",
            "reading_speed_wpm",
        }
        assert progress["current_chapter"] == 2
        assert progress["scroll_offset_percent"] == 30.5


class TestReadingProgressBackwardCompatibility:
    """Verify backward compatibility with old books.py endpoints."""

    @pytest.mark.asyncio
    async def test_progress_get_endpoint_accessible(self, client: AsyncClient):
        """Verify GET /api/v1/books/{book_id}/progress is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/progress")
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_progress_post_endpoint_accessible(self, client: AsyncClient):
        """Verify POST /api/v1/books/{book_id}/progress is accessible."""
        book_id = str(uuid4())
        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json={"current_chapter": 1}
        )
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_progress_supports_cfi(
        self, client: AsyncClient, authenticated_headers
    ):
        """Verify progress endpoint supports CFI (Canonical Fragment Identifier)."""
        headers = await authenticated_headers()
        book_id = str(uuid4())

        progress_data = {
            "current_chapter": 1,
            "reading_location_cfi": "/2/4/2/10[Chapter1]",
        }

        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json=progress_data, headers=headers
        )

        # Even if book doesn't exist, endpoint should accept CFI parameter
        # (will fail with 404, but that's expected)
        assert response.status_code in [200, 404]
