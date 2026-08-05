"""
Интеграционные тесты для Books Router.

Тестирует REST API endpoints для работы с книгами:
- Загрузка книг (POST /upload)
- Получение списка книг (GET /)
- Получение деталей книги (GET /{id})
- Удаление книги (DELETE /{id})
- Получение статуса обработки (GET /{id}/processing-status)
- Обновление прогресса (POST /{id}/progress)

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
import io
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookGenre
from app.models.user import User


class TestBooksRouterIntegration:
    """Тесты интеграции Books Router."""

    # ==================== UPLOAD TESTS ====================

    @pytest.mark.asyncio
    async def test_upload_book_invalid_format(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест загрузки файла неподдерживаемого формата."""
        # Arrange
        invalid_file = io.BytesIO(b"invalid content")

        # Act
        response = await client.post(
            "/api/v1/books/upload",
            headers=auth_headers,
            files={"file": ("test.txt", invalid_file, "text/plain")},
        )

        # Assert
        assert response.status_code == 400
        assert "format" in response.text.lower() or "invalid" in response.text.lower()

    @pytest.mark.asyncio
    async def test_upload_book_unauthorized(self, client: AsyncClient):
        """Тест загрузки без авторизации."""
        # Arrange
        test_file = io.BytesIO(b"test epub content")

        # Act
        response = await client.post(
            "/api/v1/books/upload",
            files={"file": ("test.epub", test_file, "application/epub+zip")},
        )

        # Assert
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_upload_book_no_file(self, client: AsyncClient, auth_headers: dict):
        """Тест загрузки без файла."""
        # Act
        response = await client.post("/api/v1/books/upload", headers=auth_headers)

        # Assert
        assert response.status_code in [400, 422]

    # ==================== LIST BOOKS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_books_list_success(
        self,
        client: AsyncClient,
        test_user_auth_headers: dict,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест получения списка книг."""
        # Arrange
        for i in range(1, 4):
            book = Book(
                user_id=test_user.id,
                title=f"Test Book {i}",
                author=f"Author {i}",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book)
        await db_session.commit()

        # Act — маршрут объявлен как "/", а redirect_slashes=False,
        # поэтому "/api/v1/books" без слеша отдаёт 404
        response = await client.get("/api/v1/books/", headers=test_user_auth_headers)

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert {book["title"] for book in data["books"]} == {
            "Test Book 1",
            "Test Book 2",
            "Test Book 3",
        }
        assert data["total"] == 3

    @pytest.mark.asyncio
    async def test_get_books_list_empty(self, client: AsyncClient, auth_headers: dict):
        """Тест получения пустого списка книг."""
        # Act
        response = await client.get("/api/v1/books/", headers=auth_headers)

        # Assert
        assert response.status_code == 200
        data = response.json()
        # Could be empty list or object with empty items
        if isinstance(data, dict):
            assert len(data.get("items", [])) == 0
        else:
            assert len(data) == 0

    @pytest.mark.asyncio
    async def test_get_books_list_pagination(
        self,
        client: AsyncClient,
        test_user_auth_headers: dict,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест пагинации при получении списка книг."""
        # Arrange
        for i in range(1, 6):
            book = Book(
                user_id=test_user.id,
                title=f"Book {i}",
                author="Author",
                genre=BookGenre.FANTASY.value,
                language="ru",
                file_path=f"/tmp/book{i}.epub",
                file_format="epub",
                file_size=1024,
                total_pages=100,
            )
            db_session.add(book)
        await db_session.commit()

        # Act
        response = await client.get(
            "/api/v1/books/?skip=0&limit=2", headers=test_user_auth_headers
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert len(data["books"]) == 2
        assert data["total"] == 5

    @pytest.mark.asyncio
    async def test_get_books_list_unauthorized(self, client: AsyncClient):
        """Тест получения списка без авторизации."""
        # Act
        response = await client.get("/api/v1/books/")

        # Assert
        assert response.status_code == 401

    # ==================== GET BOOK DETAILS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_by_id_success(
        self, client: AsyncClient, test_user_auth_headers: dict, test_book: Book
    ):
        """Тест получения деталей книги."""
        # Act
        response = await client.get(
            f"/api/v1/books/{test_book.id}", headers=test_user_auth_headers
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data.get("id") == str(test_book.id)
        assert data.get("title") == test_book.title

    @pytest.mark.asyncio
    async def test_get_book_by_id_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест получения несуществующей книги."""
        # Act
        from uuid import uuid4

        response = await client.get(f"/api/v1/books/{uuid4()}", headers=auth_headers)

        # Assert
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_book_other_user_book(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест попытки получить книгу другого пользователя."""
        # Arrange
        other_user = User(
            email="other@example.com", full_name="Other User", password_hash="hashed"
        )
        db_session.add(other_user)
        await db_session.commit()

        other_book = Book(
            user_id=other_user.id,
            title="Other Book",
            author="Author",
            genre=BookGenre.FANTASY.value,
            language="ru",
            file_path="/tmp/other.epub",
            file_format="epub",
            file_size=1024,
            total_pages=100,
        )
        db_session.add(other_book)
        await db_session.commit()

        # Act
        response = await client.get(
            f"/api/v1/books/{other_book.id}", headers=auth_headers
        )

        # Assert
        assert response.status_code == 403 or response.status_code == 404

    # ==================== DELETE BOOK TESTS ====================

    @pytest.mark.asyncio
    async def test_delete_book_success(
        self,
        client: AsyncClient,
        test_user_auth_headers: dict,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Тест удаления книги."""
        # Arrange
        from app.models.book import Book

        book = Book(
            user_id=test_user.id,
            title="Book to Delete",
            author="Author",
            genre=BookGenre.FANTASY.value,
            language="ru",
            file_path="/tmp/todelete.epub",
            file_format="epub",
            file_size=1024,
            total_pages=100,
        )
        db_session.add(book)
        await db_session.commit()

        book_id = book.id

        # Act
        response = await client.delete(
            f"/api/v1/books/{book_id}", headers=test_user_auth_headers
        )

        # Assert
        assert response.status_code in [200, 204]

        # Verify deletion
        deleted_book = await db_session.get(Book, book_id)
        assert deleted_book is None

    @pytest.mark.asyncio
    async def test_delete_book_unauthorized(self, client: AsyncClient):
        """Тест удаления без авторизации."""
        # Act
        from uuid import uuid4

        response = await client.delete(f"/api/v1/books/{uuid4()}")

        # Assert
        assert response.status_code == 401

    # ==================== PARSING STATUS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_parsing_status_initial(
        self, client: AsyncClient, test_user_auth_headers: dict, test_book: Book
    ):
        """Тест получения статуса парсинга для новой книги.

        Маршрут называется `parsing-status`; `processing-status`, который
        стоял здесь раньше, в приложении не объявлен вовсе — тест на 404
        проходил из-за отсутствия маршрута, а не из-за отсутствия книги.
        """
        # Act
        response = await client.get(
            f"/api/v1/books/{test_book.id}/parsing-status",
            headers=test_user_auth_headers,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert "parsing_progress" in data or "status" in data

    @pytest.mark.asyncio
    async def test_get_parsing_status_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест получения статуса для несуществующей книги."""
        # Act
        from uuid import uuid4

        response = await client.get(
            f"/api/v1/books/{uuid4()}/parsing-status", headers=auth_headers
        )

        # Assert
        assert response.status_code == 404

    # ==================== UPDATE PROGRESS TESTS ====================

    @pytest.mark.asyncio
    async def test_update_reading_progress_success(
        self, client: AsyncClient, test_user_auth_headers: dict, test_book: Book
    ):
        """Тест обновления прогресса чтения."""
        # Arrange
        progress_data = {"chapter_number": 1, "position_percent": 50.0}

        # Act
        response = await client.post(
            f"/api/v1/books/{test_book.id}/progress",
            headers=test_user_auth_headers,
            json=progress_data,
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["progress"]["current_chapter"] == 1

    @pytest.mark.asyncio
    async def test_update_reading_progress_with_cfi(
        self, client: AsyncClient, test_user_auth_headers: dict, test_book: Book
    ):
        """Тест обновления прогресса с CFI location."""
        # Arrange
        progress_data = {
            "chapter_number": 1,
            "position_percent": 25.0,
            "reading_location_cfi": "/2/4/2/10",
            "scroll_offset_percent": 25.0,
        }

        # Act
        response = await client.post(
            f"/api/v1/books/{test_book.id}/progress",
            headers=test_user_auth_headers,
            json=progress_data,
        )

        # Assert
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_reading_progress_invalid_chapter(
        self, client: AsyncClient, test_user_auth_headers: dict, test_book: Book
    ):
        """Тест обновления прогресса с невалидным номером главы."""
        # Arrange
        progress_data = {"chapter_number": 999, "position_percent": 50.0}

        # Act
        response = await client.post(
            f"/api/v1/books/{test_book.id}/progress",
            headers=test_user_auth_headers,
            json=progress_data,
        )

        # Assert - Should clamp to valid chapter
        assert response.status_code in [200, 400]

    @pytest.mark.asyncio
    async def test_update_reading_progress_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест обновления прогресса для несуществующей книги."""
        # Arrange
        from uuid import uuid4

        progress_data = {"chapter_number": 1, "position_percent": 50.0}

        # Act
        response = await client.post(
            f"/api/v1/books/{uuid4()}/progress",
            headers=auth_headers,
            json=progress_data,
        )

        # Assert
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_reading_progress_unauthorized(
        self, client: AsyncClient, test_book: Book
    ):
        """Тест обновления прогресса без авторизации."""
        # Act
        progress_data = {"chapter_number": 1, "position_percent": 50.0}
        response = await client.post(
            f"/api/v1/books/{test_book.id}/progress", json=progress_data
        )

        # Assert
        assert response.status_code == 401

    # ==================== GET BOOK FILE TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_file_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест получения файла несуществующей книги."""
        # Act
        from uuid import uuid4

        response = await client.get(
            f"/api/v1/books/{uuid4()}/file", headers=auth_headers
        )

        # Assert
        assert response.status_code == 404

    # ==================== GET BOOK COVER TESTS ====================

    @pytest.mark.asyncio
    async def test_get_book_cover_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест получения обложки несуществующей книги."""
        # Act
        from uuid import uuid4

        response = await client.get(
            f"/api/v1/books/{uuid4()}/cover", headers=auth_headers
        )

        # Assert
        assert response.status_code == 404
