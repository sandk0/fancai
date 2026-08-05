"""
Integration tests for reading progress flow.

Tests the complete reading progress user journey:
1. Upload book and start reading
2. Save reading progress (CFI location, scroll offset)
3. Sync progress across sessions
4. Restore progress when reopening book
5. Update progress as user reads

Запрос принимает `current_position_percent`, но ответ его не отдаёт:
`ReadingProgressResponse` хранит процент в целочисленном `current_position`
(`book_progress_service.py:305-307`), поэтому проверки идут по нему.
"""

import pytest
import io
import zipfile
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.book import ReadingProgress


def create_minimal_epub() -> io.BytesIO:
    """
    Create a minimal valid EPUB file for testing.

    Главы намеренно длинные: парсер отбрасывает короткие страницы как
    служебные (`_is_service_page`), и на абзаце в одну строку книга
    разбиралась в НОЛЬ глав — прогресс на главу 2 и 3 не сохранялся,
    потому что номер клампился к числу глав.

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
        <dc:title>Reading Progress Test Book</dc:title>
        <dc:creator>Progress Author</dc:creator>
        <dc:language>en</dc:language>
        <dc:identifier id="bookid">progress-book-001</dc:identifier>
    </metadata>
    <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    </manifest>
    <spine toc="ncx">
        <itemref idref="chapter1"/>
        <itemref idref="chapter2"/>
        <itemref idref="chapter3"/>
    </spine>
</package>"""
        epub.writestr("OEBPS/content.opf", content_opf)

        # OEBPS/toc.ncx
        toc_ncx = """<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="progress-book-001"/>
    </head>
    <docTitle><text>Reading Progress Test Book</text></docTitle>
    <navMap>
        <navPoint id="chapter1">
            <navLabel><text>Chapter 1</text></navLabel>
            <content src="chapter1.xhtml"/>
        </navPoint>
        <navPoint id="chapter2">
            <navLabel><text>Chapter 2</text></navLabel>
            <content src="chapter2.xhtml"/>
        </navPoint>
        <navPoint id="chapter3">
            <navLabel><text>Chapter 3</text></navLabel>
            <content src="chapter3.xhtml"/>
        </navPoint>
    </navMap>
</ncx>"""
        epub.writestr("OEBPS/toc.ncx", toc_ncx)

        # OEBPS/chapter1.xhtml
        chapter1 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Chapter 1</title>
</head>
<body>
    <h1>Chapter 1: Beginning the Journey</h1>
    <p>This is the first chapter of the book.</p>
    <p>The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree</p>
</body>
</html>"""
        epub.writestr("OEBPS/chapter1.xhtml", chapter1)

        # OEBPS/chapter2.xhtml
        chapter2 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Chapter 2</title>
</head>
<body>
    <h1>Chapter 2: Continuing Forward</h1>
    <p>This is the second chapter where the story develops.</p>
    <p>The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree</p>
</body>
</html>"""
        epub.writestr("OEBPS/chapter2.xhtml", chapter2)

        # OEBPS/chapter3.xhtml
        chapter3 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Chapter 3</title>
</head>
<body>
    <h1>Chapter 3: The Conclusion</h1>
    <p>This is the final chapter where everything comes together.</p>
    <p>The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree The road went ever on and on over rock and under tree</p>
</body>
</html>"""
        epub.writestr("OEBPS/chapter3.xhtml", chapter3)

    epub_buffer.seek(0)
    return epub_buffer


@pytest.mark.integration
@pytest.mark.asyncio
class TestReadingProgressFlowIntegration:
    """Integration tests for complete reading progress flow."""

    async def test_complete_reading_progress_flow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test complete reading progress flow from start to finish.

        Flow:
        1. Register and login user
        2. Upload book
        3. Start reading (no initial progress)
        4. Save reading progress (chapter 1, CFI location)
        5. Get progress (verify saved)
        6. Update progress (chapter 2)
        7. Simulate closing and reopening book (verify progress restored)
        8. Update to final chapter
        9. Verify complete reading flow
        """
        # Step 1: Register and login user
        user_data = {
            "email": "progress@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Progress User",
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
            files={"file": ("progress_book.epub", epub_file, "application/epub+zip")},
        )

        book_id = upload_response.json()["book"]["id"]

        # Step 3: Get initial progress (should be None or empty)
        initial_progress_response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        assert initial_progress_response.status_code == 200
        initial_progress_data = initial_progress_response.json()

        # Progress should be None or have default values
        if initial_progress_data.get("progress"):
            # If progress exists, it should be at the beginning
            assert initial_progress_data["progress"]["current_chapter"] in [0, 1]
        else:
            # No progress yet
            assert initial_progress_data["progress"] is None

        # Step 4: Save reading progress (chapter 1, CFI location)
        progress_update_1 = {
            "current_chapter": 1,
            "current_page": 5,
            "current_position": 100,
            "current_position_percent": 10.0,
            "reading_location_cfi": "/6/4[chapter1]!/4/2/1:50",
            "scroll_offset_percent": 15.5,
        }

        update_response_1 = await client.post(
            f"/api/v1/books/{book_id}/progress", headers=headers, json=progress_update_1
        )

        assert update_response_1.status_code == 200

        # Step 5: Get progress (verify saved)
        progress_response_1 = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        assert progress_response_1.status_code == 200
        progress_data_1 = progress_response_1.json()

        assert progress_data_1["progress"] is not None
        assert progress_data_1["progress"]["current_chapter"] == 1
        assert progress_data_1["progress"]["current_position"] == 10
        assert (
            progress_data_1["progress"]["reading_location_cfi"]
            == "/6/4[chapter1]!/4/2/1:50"
        )
        assert progress_data_1["progress"]["scroll_offset_percent"] == 15.5

        # Verify in database
        progress_query_1 = select(ReadingProgress).where(
            ReadingProgress.book_id == book_id
        )
        progress_result_1 = await db_session.execute(progress_query_1)
        progress_db_1 = progress_result_1.scalar_one_or_none()

        assert progress_db_1 is not None
        assert progress_db_1.current_chapter == 1
        assert progress_db_1.reading_location_cfi == "/6/4[chapter1]!/4/2/1:50"

        # Step 6: Update progress (chapter 2)
        progress_update_2 = {
            "current_chapter": 2,
            "current_page": 15,
            "current_position": 250,
            "current_position_percent": 45.0,
            "reading_location_cfi": "/6/6[chapter2]!/4/2/1:100",
            "scroll_offset_percent": 30.0,
        }

        update_response_2 = await client.post(
            f"/api/v1/books/{book_id}/progress", headers=headers, json=progress_update_2
        )

        assert update_response_2.status_code == 200

        # Step 7: Simulate closing and reopening book (verify progress restored)
        # Get progress again to simulate reopening
        restored_progress_response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        assert restored_progress_response.status_code == 200
        restored_progress_data = restored_progress_response.json()

        assert restored_progress_data["progress"]["current_chapter"] == 2
        assert restored_progress_data["progress"]["current_position"] == 45
        assert (
            restored_progress_data["progress"]["reading_location_cfi"]
            == "/6/6[chapter2]!/4/2/1:100"
        )
        assert restored_progress_data["progress"]["scroll_offset_percent"] == 30.0

        # Step 8: Update to final chapter
        progress_update_3 = {
            "current_chapter": 3,
            "current_page": 30,
            "current_position": 500,
            "current_position_percent": 95.0,
            "reading_location_cfi": "/6/8[chapter3]!/4/2/1:200",
            "scroll_offset_percent": 85.0,
        }

        update_response_3 = await client.post(
            f"/api/v1/books/{book_id}/progress", headers=headers, json=progress_update_3
        )

        assert update_response_3.status_code == 200

        # Step 9: Verify complete reading flow
        final_progress_response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        final_progress_data = final_progress_response.json()

        assert final_progress_data["progress"]["current_chapter"] == 3
        assert final_progress_data["progress"]["current_position"] == 95

    async def test_progress_sync_across_updates(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test progress syncing with rapid updates.

        Flow:
        1. Register, login, upload book
        2. Perform multiple rapid progress updates
        3. Verify latest update is preserved
        """
        # Step 1: Setup
        user_data = {
            "email": "rapidsync@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "Rapid Sync User",
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

        epub_file = create_minimal_epub()

        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=headers,
            files={"file": ("sync_book.epub", epub_file, "application/epub+zip")},
        )

        book_id = upload_response.json()["book"]["id"]

        # Step 2: Perform multiple rapid updates
        updates = [
            {
                "current_chapter": 1,
                "current_position_percent": 10.0,
                "reading_location_cfi": "/6/4[chapter1]!/4/2/1:10",
            },
            {
                "current_chapter": 1,
                "current_position_percent": 20.0,
                "reading_location_cfi": "/6/4[chapter1]!/4/2/1:50",
            },
            {
                "current_chapter": 1,
                "current_position_percent": 30.0,
                "reading_location_cfi": "/6/4[chapter1]!/4/2/1:100",
            },
        ]

        for update in updates:
            await client.post(
                f"/api/v1/books/{book_id}/progress", headers=headers, json=update
            )

        # Step 3: Verify latest update is preserved
        final_response = await client.get(
            f"/api/v1/books/{book_id}/progress", headers=headers
        )

        final_data = final_response.json()

        assert final_data["progress"]["current_position"] == 30
        assert (
            final_data["progress"]["reading_location_cfi"]
            == "/6/4[chapter1]!/4/2/1:100"
        )

    async def test_progress_isolation_between_users(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """
        Test that reading progress is isolated between different users.

        Flow:
        1. User 1 uploads book and saves progress
        2. User 2 uploads same book
        3. User 2 saves different progress
        4. Verify each user sees only their own progress
        """
        # Step 1: User 1 setup
        user1_data = {
            "email": "user1@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "User One",
        }

        await client.post("/api/v1/auth/register", json=user1_data)

        login1_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user1_data["email"],
                "password": user1_data["password"],
            },
        )

        user1_token = login1_response.json()["tokens"]["access_token"]
        user1_headers = {"Authorization": f"Bearer {user1_token}"}

        epub_file_1 = create_minimal_epub()

        upload1_response = await client.post(
            "/api/v1/books/upload",
            headers=user1_headers,
            files={"file": ("book.epub", epub_file_1, "application/epub+zip")},
        )

        book1_id = upload1_response.json()["book"]["id"]

        # User 1 saves progress
        user1_progress = {
            "current_chapter": 1,
            "current_position_percent": 25.0,
            "reading_location_cfi": "/6/4[chapter1]!/4/2/1:50",
        }

        await client.post(
            f"/api/v1/books/{book1_id}/progress",
            headers=user1_headers,
            json=user1_progress,
        )

        # Step 2: User 2 setup
        user2_data = {
            "email": "user2@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "User Two",
        }

        await client.post("/api/v1/auth/register", json=user2_data)

        login2_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": user2_data["email"],
                "password": user2_data["password"],
            },
        )

        user2_token = login2_response.json()["tokens"]["access_token"]
        user2_headers = {"Authorization": f"Bearer {user2_token}"}

        epub_file_2 = create_minimal_epub()

        upload2_response = await client.post(
            "/api/v1/books/upload",
            headers=user2_headers,
            files={"file": ("book.epub", epub_file_2, "application/epub+zip")},
        )

        book2_id = upload2_response.json()["book"]["id"]

        # Step 3: User 2 saves different progress
        user2_progress = {
            "current_chapter": 3,
            "current_position_percent": 75.0,
            "reading_location_cfi": "/6/8[chapter3]!/4/2/1:100",
        }

        await client.post(
            f"/api/v1/books/{book2_id}/progress",
            headers=user2_headers,
            json=user2_progress,
        )

        # Step 4: Verify each user sees only their own progress
        user1_check = await client.get(
            f"/api/v1/books/{book1_id}/progress", headers=user1_headers
        )

        user1_check_data = user1_check.json()
        assert user1_check_data["progress"]["current_chapter"] == 1
        assert user1_check_data["progress"]["current_position"] == 25

        user2_check = await client.get(
            f"/api/v1/books/{book2_id}/progress", headers=user2_headers
        )

        user2_check_data = user2_check.json()
        assert user2_check_data["progress"]["current_chapter"] == 3
        assert user2_check_data["progress"]["current_position"] == 75

    async def test_progress_without_authentication(self, client: AsyncClient):
        """Test accessing progress without authentication fails."""
        fake_book_id = "00000000-0000-0000-0000-000000000000"

        response = await client.get(f"/api/v1/books/{fake_book_id}/progress")

        assert response.status_code == 401

    async def test_update_progress_for_nonexistent_book(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test updating progress for non-existent book fails."""
        # Register and login
        user_data = {
            "email": "nobook@example.com",
            "password": "SecureP@ss0w9rd!",
            "full_name": "No Book User",
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

        # Try to update progress for non-existent book
        fake_book_id = "00000000-0000-0000-0000-000000000000"

        progress_update = {
            "current_chapter": 1,
            "current_position_percent": 50.0,
            "reading_location_cfi": "/6/4[chapter1]!/4/2/1:50",
        }

        response = await client.post(
            f"/api/v1/books/{fake_book_id}/progress",
            headers=headers,
            json=progress_update,
        )

        assert response.status_code == 404
