"""
Tests for sync router bookmark CRUD endpoints.

Verifies READ-03: bookmark creation (201), listing (200),
deletion (204), and ownership checks.
"""

import pytest
from httpx import AsyncClient
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bookmark import Bookmark
from app.models.user import User
from app.models.book import Book


class TestBookmarkCRUD:
    """Test CRUD operations for /sync/books/{book_id}/bookmarks endpoints."""

    @pytest.mark.asyncio
    async def test_create_bookmark_returns_201(
        self, client: AsyncClient, auth_headers: dict, test_book: Book
    ):
        """POST /sync/books/{book_id}/bookmarks creates a bookmark and returns 201."""
        payload = {
            "cfi_range": "epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)",
            "chapter_number": 1,
            "text": "Sample highlighted text",
            "color": "#fbbf24",
            "style": "highlight",
        }

        response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            json=payload,
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["cfi_range"] == payload["cfi_range"]
        assert data["chapter_number"] == 1
        assert data["text"] == "Sample highlighted text"
        assert data["color"] == "#fbbf24"
        assert data["style"] == "highlight"
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data

    @pytest.mark.asyncio
    async def test_get_bookmarks_returns_user_bookmarks(
        self, client: AsyncClient, auth_headers: dict, test_book: Book
    ):
        """GET /sync/books/{book_id}/bookmarks returns the user's bookmarks."""
        # Create two bookmarks first
        for i in range(2):
            await client.post(
                f"/api/v1/sync/books/{test_book.id}/bookmarks",
                json={
                    "cfi_range": f"epubcfi(/6/4!/4/2/{i}:0,/6/4!/4/2/{i}:10)",
                    "chapter_number": 1,
                    "text": f"Text {i}",
                    "style": "none",
                },
                headers=auth_headers,
            )

        response = await client.get(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_delete_bookmark_returns_204(
        self, client: AsyncClient, auth_headers: dict, test_book: Book
    ):
        """DELETE /sync/books/{book_id}/bookmarks/{id} returns 204."""
        # Create a bookmark
        create_response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            json={
                "cfi_range": "epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)",
                "chapter_number": 1,
                "text": "To be deleted",
                "style": "none",
            },
            headers=auth_headers,
        )
        bookmark_id = create_response.json()["id"]

        # Delete it
        response = await client.delete(
            f"/api/v1/sync/books/{test_book.id}/bookmarks/{bookmark_id}",
            headers=auth_headers,
        )

        assert response.status_code == 204

        # Verify it's gone
        list_response = await client.get(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            headers=auth_headers,
        )
        assert len(list_response.json()) == 0

    @pytest.mark.asyncio
    async def test_delete_bookmark_not_owned_returns_404(
        self,
        client: AsyncClient,
        auth_headers: dict,
        admin_auth_headers: dict,
        test_book: Book,
    ):
        """User cannot delete another user's bookmark (returns 404)."""
        # Create a bookmark as admin
        create_response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            json={
                "cfi_range": "epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)",
                "chapter_number": 1,
                "text": "Admin's bookmark",
                "style": "none",
            },
            headers=admin_auth_headers,
        )
        bookmark_id = create_response.json()["id"]

        # Try to delete as regular user — should fail with 404 (ownership check)
        response = await client.delete(
            f"/api/v1/sync/books/{test_book.id}/bookmarks/{bookmark_id}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_bookmarks_unauthorized_returns_403(
        self, client: AsyncClient, test_book: Book
    ):
        """GET /sync/books/{book_id}/bookmarks without auth returns 403."""
        response = await client.get(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_bookmark_with_note(
        self, client: AsyncClient, auth_headers: dict, test_book: Book
    ):
        """POST creates bookmark with optional note field."""
        payload = {
            "cfi_range": "epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)",
            "chapter_number": 2,
            "text": "Important passage",
            "color": "#4ade80",
            "style": "underline",
            "note": "Remember this for later",
        }

        response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            json=payload,
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["note"] == "Remember this for later"
        assert data["color"] == "#4ade80"
        assert data["style"] == "underline"

    @pytest.mark.asyncio
    async def test_update_bookmark_note(
        self, client: AsyncClient, auth_headers: dict, test_book: Book
    ):
        """PUT /sync/books/{book_id}/bookmarks/{id} updates note and color."""
        # Create bookmark
        create_response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            json={
                "cfi_range": "epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)",
                "chapter_number": 1,
                "text": "Text to update",
                "style": "none",
            },
            headers=auth_headers,
        )
        bookmark_id = create_response.json()["id"]

        # Update note
        response = await client.put(
            f"/api/v1/sync/books/{test_book.id}/bookmarks/{bookmark_id}",
            json={"note": "Updated note", "color": "#f472b6"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["note"] == "Updated note"
        assert data["color"] == "#f472b6"
