"""
Integration tests for book upload flow.

Tests the complete book upload user journey:
1. Upload EPUB file
2. Verify book parsing and database storage
3. Retrieve book details
4. Access book chapters
5. Verify book appears in user's library
"""

import pytest
import io
import zipfile
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.book import Book
from app.models.chapter import Chapter


def create_minimal_epub() -> io.BytesIO:
    """
    Create a minimal valid EPUB file for testing.

    Returns:
        BytesIO containing a minimal EPUB file
    """
    epub_buffer = io.BytesIO()

    with zipfile.ZipFile(epub_buffer, "w", zipfile.ZIP_DEFLATED) as epub:
        # mimetype file (must be first and uncompressed)
        epub.writestr(
            "mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED
        )

        # META-INF/container.xml
        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>"""
        epub.writestr("META-INF/container.xml", container_xml)

        # OEBPS/content.opf
        content_opf = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Test Book for Integration</dc:title>
        <dc:creator>Test Author</dc:creator>
        <dc:language>en</dc:language>
        <dc:identifier id="bookid">test-book-001</dc:identifier>
    </metadata>
    <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    </manifest>
    <spine toc="ncx">
        <itemref idref="chapter1"/>
        <itemref idref="chapter2"/>
    </spine>
</package>"""
        epub.writestr("OEBPS/content.opf", content_opf)

        # OEBPS/toc.ncx
        toc_ncx = """<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="test-book-001"/>
    </head>
    <docTitle><text>Test Book</text></docTitle>
    <navMap>
        <navPoint id="chapter1">
            <navLabel><text>Chapter 1</text></navLabel>
            <content src="chapter1.xhtml"/>
        </navPoint>
        <navPoint id="chapter2">
            <navLabel><text>Chapter 2</text></navLabel>
            <content src="chapter2.xhtml"/>
        </navPoint>
    </navMap>
</ncx>"""
        epub.writestr("OEBPS/toc.ncx", toc_ncx)

        # OEBPS/chapter1.xhtml
        chapter1 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Chapter 1: The Beginning</title>
</head>
<body>
    <h1>Chapter 1: The Beginning</h1>
    <p>In a beautiful forest with tall trees, there was a mysterious castle on the hill. The hero walked through the dark corridors filled with ancient artifacts.</p>
    <p>The landscape was breathtaking, with mountains in the distance and a crystal-clear lake nearby.</p>
</body>
</html>"""
        epub.writestr("OEBPS/chapter1.xhtml", chapter1)

        # OEBPS/chapter2.xhtml
        chapter2 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Chapter 2: The Journey</title>
</head>
<body>
    <h1>Chapter 2: The Journey</h1>
    <p>The hero continued through a dense forest with towering oak trees. In the clearing ahead, an old cottage with a thatched roof came into view.</p>
    <p>The character was wearing a long red cloak and carried a wooden staff.</p>
</body>
</html>"""
        epub.writestr("OEBPS/chapter2.xhtml", chapter2)

    epub_buffer.seek(0)
    return epub_buffer


@pytest.mark.integration
@pytest.mark.asyncio
class TestBookUploadFlowIntegration:
    """Integration tests for complete book upload flow."""

    async def test_complete_book_upload_flow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test complete book upload flow from file upload to chapter access.

        Flow:
        1. Register and login user
        2. Upload EPUB file
        3. Verify book was created in database
        4. Get book details
        5. Get book chapters
        6. Verify book appears in library list
        """
        # Step 1: Register and login user
        user_data = {
            "email": "bookupload@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Book Upload User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Step 2: Upload EPUB file
        epub_file = create_minimal_epub()

        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("test_book.epub", epub_file, "application/epub+zip")},
        )

        assert upload_response.status_code == 200
        upload_data = upload_response.json()

        assert "book" in upload_data
        assert "id" in upload_data["book"]
        book_id = upload_data["book"]["id"]

        assert upload_data["book"]["title"] == "Test Book for Integration"
        assert upload_data["book"]["author"] == "Test Author"
        assert upload_data["book"]["file_format"] == "epub"

        # Step 3: Verify book was created in database
        book_query = select(Book).where(Book.id == book_id)
        book_result = await db_session.execute(book_query)
        book = book_result.scalar_one_or_none()

        assert book is not None
        assert book.title == "Test Book for Integration"
        assert book.author == "Test Author"
        assert book.file_format == "epub"
        assert book.is_parsed is True

        # Step 4: Get book details
        detail_response = await client.get(f"/api/v1/books/{book_id}", headers=headers)

        assert detail_response.status_code == 200
        detail_data = detail_response.json()

        assert detail_data["id"] == book_id
        assert detail_data["title"] == "Test Book for Integration"
        assert detail_data["author"] == "Test Author"

        # Step 5: Get book chapters
        # First, verify chapters were created in database
        chapters_query = (
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.chapter_number)
        )
        chapters_result = await db_session.execute(chapters_query)
        chapters = chapters_result.scalars().all()

        assert len(chapters) > 0

        # Get first chapter via API. Маршрут вложенный:
        # /books/{book_id}/chapters/{chapter_number}; плоского /chapters/{id}
        # в приложении нет — прежний запрос отвечал 404.
        first_chapter = chapters[0]
        chapter_response = await client.get(
            f"/api/v1/books/{book_id}/chapters/{first_chapter.chapter_number}",
            headers=headers,
        )

        assert chapter_response.status_code == 200
        chapter_data = chapter_response.json()

        assert chapter_data["chapter"]["id"] == str(first_chapter.id)
        assert chapter_data["chapter"]["content"]

        # Step 6: Verify book appears in library list
        library_response = await client.get("/api/v1/books/", headers=headers)

        assert library_response.status_code == 200
        library_data = library_response.json()

        assert "books" in library_data
        assert len(library_data["books"]) >= 1

        # Find our uploaded book in the list
        uploaded_book = next(
            (b for b in library_data["books"] if b["id"] == book_id), None
        )

        assert uploaded_book is not None
        assert uploaded_book["title"] == "Test Book for Integration"

    async def test_upload_invalid_file_format(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test uploading file with invalid format fails."""
        # Register and login
        user_data = {
            "email": "invalidfile@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Invalid File User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Try to upload a text file
        invalid_file = io.BytesIO(b"This is not an EPUB file")

        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("test.txt", invalid_file, "text/plain")},
        )

        assert upload_response.status_code == 400
        error_data = upload_response.json()

        assert "detail" in error_data
        assert (
            "format" in error_data["detail"].lower()
            or "invalid" in error_data["detail"].lower()
        )

    async def test_upload_without_authentication(self, client: AsyncClient):
        """Test uploading book without authentication fails."""
        epub_file = create_minimal_epub()

        upload_response = await client.post(
            "/api/v1/books/upload",
            files={"file": ("test_book.epub", epub_file, "application/epub+zip")},
        )

        assert upload_response.status_code == 401

    async def test_upload_corrupted_epub(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test uploading corrupted EPUB file fails gracefully."""
        # Register and login
        user_data = {
            "email": "corruptedepub@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Corrupted EPUB User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Create corrupted EPUB (not a valid zip)
        corrupted_epub = io.BytesIO(b"PK\x03\x04" + b"corrupted data" * 100)

        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("corrupted.epub", corrupted_epub, "application/epub+zip")},
        )

        # 500, а не 400: `crud.py:207` заворачивает ЛЮБОЕ исключение разбора
        # в `BookProcessingException` (HTTP 500). Битый файл пользователя тем
        # самым неотличим для клиента от отказа сервера — известный долг,
        # разведение «плохой ввод / отказ сервера» меняет контракт API.
        assert upload_response.status_code == 500

    async def test_get_book_chapters_flow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test getting book chapters after upload.

        Flow:
        1. Register and login
        2. Upload book
        3. Get all chapters for the book
        4. Verify chapter count and content
        """
        # Step 1: Register and login
        user_data = {
            "email": "chapters@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Chapters User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Step 2: Upload book
        epub_file = create_minimal_epub()

        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("test_book.epub", epub_file, "application/epub+zip")},
        )

        book_id = upload_response.json()["book"]["id"]

        # Step 3: Get all chapters from database
        chapters_query = (
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.chapter_number)
        )
        chapters_result = await db_session.execute(chapters_query)
        chapters = chapters_result.scalars().all()

        # Step 4: Verify chapters
        assert len(chapters) == 2  # Our test EPUB has 2 chapters

        # Verify first chapter
        chapter1 = chapters[0]
        assert chapter1.chapter_number == 1
        assert (
            "forest" in chapter1.content.lower()
            or "forest" in (chapter1.html_content or "").lower()
        )

        # Verify second chapter
        chapter2 = chapters[1]
        assert chapter2.chapter_number == 2
        assert "journey" in chapter2.title.lower()

    async def test_upload_multiple_books(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test uploading multiple books for the same user.

        Flow:
        1. Register and login
        2. Upload first book
        3. Upload second book
        4. Verify both books appear in library
        5. Verify books are separate entities
        """
        # Step 1: Register and login
        user_data = {
            "email": "multibooks@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Multi Books User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Step 2: Upload first book
        epub_file_1 = create_minimal_epub()

        upload_response_1 = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("book1.epub", epub_file_1, "application/epub+zip")},
        )

        book_id_1 = upload_response_1.json()["book"]["id"]

        # Step 3: Upload second book
        epub_file_2 = create_minimal_epub()

        upload_response_2 = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("book2.epub", epub_file_2, "application/epub+zip")},
        )

        book_id_2 = upload_response_2.json()["book"]["id"]

        # Step 4: Verify both books appear in library
        library_response = await client.get("/api/v1/books/", headers=headers)
        library_data = library_response.json()

        assert len(library_data["books"]) >= 2

        book_ids = [book["id"] for book in library_data["books"]]
        assert book_id_1 in book_ids
        assert book_id_2 in book_ids

        # Step 5: Verify books are separate entities
        assert book_id_1 != book_id_2

        # Verify in database
        books_query = select(Book).where(Book.id.in_([book_id_1, book_id_2]))
        books_result = await db_session.execute(books_query)
        books = books_result.scalars().all()

        assert len(books) == 2

    async def test_get_nonexistent_book(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test getting details of non-existent book fails with 404."""
        # Register and login
        user_data = {
            "email": "nonexistent@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Nonexistent User",
        }

        await client.post("/api/v1/auth/register", json=user_data)

        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user_data["email"],
                "password": user_data["password"],
            },
        )

        access_token = login_response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Try to get non-existent book (using a random UUID)
        fake_book_id = "00000000-0000-0000-0000-000000000000"

        response = await client.get(f"/api/v1/books/{fake_book_id}", headers=headers)

        assert response.status_code == 404
