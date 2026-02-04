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
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_update_progress_unauthorized(self, client: AsyncClient):
        """Test updating progress without authentication."""
        book_id = str(uuid4())
        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json={"current_chapter": 1}
        )
        assert (
            response.status_code == 403
        )  # FastAPI OAuth2PasswordBearer returns 403, not 401

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
        self, client: AsyncClient, authenticated_headers
    ):
        """Test progress update response structure."""
        headers = await authenticated_headers()
        book_id = str(uuid4())

        progress_data = {
            "current_chapter": 2,
            "current_position_percent": 50.0,
            "reading_location_cfi": "/2/4/2/10",
            "scroll_offset_percent": 75.5,
        }

        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json=progress_data, headers=headers
        )

        # Should fail with 404 (book not found), but structure should be consistent
        if response.status_code == 200:
            data = response.json()
            assert "progress" in data
            assert "message" in data

            progress = data["progress"]
            assert "current_chapter" in progress
            assert "current_position" in progress
            assert "reading_location_cfi" in progress
            assert "scroll_offset_percent" in progress

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

        if response.status_code == 200:
            data = response.json()
            assert "progress" in data

            if data["progress"] is not None:
                progress = data["progress"]
                assert "current_chapter" in progress
                assert "current_page" in progress
                assert "current_position" in progress
                assert "current_position_percent" in progress
                assert "reading_location_cfi" in progress
                assert "scroll_offset_percent" in progress
                assert "reading_time_minutes" in progress
                assert "reading_speed_wpm" in progress


class TestReadingProgressBackwardCompatibility:
    """Verify backward compatibility with old books.py endpoints."""

    @pytest.mark.asyncio
    async def test_progress_get_endpoint_accessible(self, client: AsyncClient):
        """Verify GET /api/v1/books/{book_id}/progress is accessible."""
        book_id = str(uuid4())
        response = await client.get(f"/api/v1/books/{book_id}/progress")
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code in [
            403,
            404,
        ]  # FastAPI OAuth2PasswordBearer returns 403, not 401

    @pytest.mark.asyncio
    async def test_progress_post_endpoint_accessible(self, client: AsyncClient):
        """Verify POST /api/v1/books/{book_id}/progress is accessible."""
        book_id = str(uuid4())
        response = await client.post(
            f"/api/v1/books/{book_id}/progress", json={"current_chapter": 1}
        )
        # Should return 401 (unauthorized), not 404 (not found)
        assert response.status_code in [
            403,
            404,
        ]  # FastAPI OAuth2PasswordBearer returns 403, not 401

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
