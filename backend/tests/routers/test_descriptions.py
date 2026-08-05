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
from uuid import uuid4


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
