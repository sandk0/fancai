"""
Tests for POST /admin/reconcile-statuses endpoint.

Verifies that the reconciliation endpoint finds books with
descriptions_extracted=True but with chapters having parsing_error,
and corrects their status.
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.book import Book, BookGenre
from app.models.chapter import Chapter
from app.models.user import User
from app.services.auth_service import AuthService


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession):
    """Create an admin user for testing."""
    auth_service = AuthService()
    user = User(
        email="reconcile_admin@example.com",
        full_name="Reconcile Admin",
        password_hash=auth_service.get_password_hash("AdminPass123!"),
        is_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_headers(admin_user, client):
    """Get admin auth headers."""
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "reconcile_admin@example.com", "password": "AdminPass123!"},
    )
    assert (
        login_response.status_code == 200
    ), f"Admin login failed: {login_response.text}"
    tokens = login_response.json()["tokens"]
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest_asyncio.fixture
async def regular_user(db_session: AsyncSession):
    """Create a regular (non-admin) user for testing."""
    auth_service = AuthService()
    user = User(
        email="reconcile_regular@example.com",
        full_name="Regular User",
        password_hash=auth_service.get_password_hash("UserPass123!"),
        is_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def regular_headers(regular_user, client):
    """Get regular user auth headers."""
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "reconcile_regular@example.com", "password": "UserPass123!"},
    )
    assert login_response.status_code == 200
    tokens = login_response.json()["tokens"]
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest_asyncio.fixture
async def inconsistent_book(db_session: AsyncSession, admin_user: User):
    """Create a book with descriptions_extracted=True but a chapter with parsing_error."""
    book = Book(
        user_id=admin_user.id,
        title="Inconsistent Book",
        author="Test Author",
        genre=BookGenre.FANTASY.value,
        language="ru",
        file_path="/tmp/inconsistent.epub",
        file_format="epub",
        file_size=500000,
        total_pages=50,
        estimated_reading_time=25,
        is_parsed=True,
        descriptions_extracted=True,
    )
    db_session.add(book)
    await db_session.flush()

    # Chapter 1: OK
    ch1 = Chapter(
        book_id=book.id,
        chapter_number=1,
        title="Chapter 1",
        content="Normal chapter content.",
        word_count=50,
    )
    # Chapter 2: has parsing_error
    ch2 = Chapter(
        book_id=book.id,
        chapter_number=2,
        title="Chapter 2",
        content="Chapter with error.",
        word_count=30,
        parsing_error="timeout",
    )
    db_session.add_all([ch1, ch2])
    await db_session.commit()
    await db_session.refresh(book)
    return book


@pytest_asyncio.fixture
async def consistent_book(db_session: AsyncSession, admin_user: User):
    """Create a book with descriptions_extracted=True and no failed chapters."""
    book = Book(
        user_id=admin_user.id,
        title="Consistent Book",
        author="Good Author",
        genre=BookGenre.FANTASY.value,
        language="ru",
        file_path="/tmp/consistent.epub",
        file_format="epub",
        file_size=600000,
        total_pages=60,
        estimated_reading_time=30,
        is_parsed=True,
        descriptions_extracted=True,
    )
    db_session.add(book)
    await db_session.flush()

    ch1 = Chapter(
        book_id=book.id,
        chapter_number=1,
        title="Chapter 1",
        content="Good chapter.",
        word_count=100,
    )
    db_session.add(ch1)
    await db_session.commit()
    await db_session.refresh(book)
    return book


@pytest_asyncio.fixture
async def already_false_book(db_session: AsyncSession, admin_user: User):
    """Create a book with descriptions_extracted=False and a failed chapter."""
    book = Book(
        user_id=admin_user.id,
        title="Already False Book",
        author="Some Author",
        genre=BookGenre.FANTASY.value,
        language="ru",
        file_path="/tmp/already_false.epub",
        file_format="epub",
        file_size=400000,
        total_pages=40,
        estimated_reading_time=20,
        is_parsed=True,
        descriptions_extracted=False,
    )
    db_session.add(book)
    await db_session.flush()

    ch1 = Chapter(
        book_id=book.id,
        chapter_number=1,
        title="Chapter 1",
        content="Failed chapter.",
        word_count=20,
        parsing_error="some error",
    )
    db_session.add(ch1)
    await db_session.commit()
    await db_session.refresh(book)
    return book


@pytest.mark.asyncio
async def test_reconcile_finds_inconsistent_books(
    client, admin_headers, inconsistent_book, db_session
):
    """Endpoint should find books with descriptions_extracted=True and failed chapters."""
    response = await client.post(
        "/api/v1/admin/reconcile-statuses",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["found"] == 1
    assert len(data["fixed"]) == 1
    assert data["fixed"][0]["id"] == str(inconsistent_book.id)
    assert data["fixed"][0]["title"] == "Inconsistent Book"


@pytest.mark.asyncio
async def test_reconcile_fixes_inconsistent_books(
    client, admin_headers, inconsistent_book, db_session
):
    """After reconciliation, book.descriptions_extracted should be False."""
    await client.post(
        "/api/v1/admin/reconcile-statuses",
        headers=admin_headers,
    )

    # Reload book from DB to check updated values
    result = await db_session.execute(
        select(Book.descriptions_extracted, Book.descriptions_processing_error).where(
            Book.id == inconsistent_book.id
        )
    )
    row = result.one()
    assert row.descriptions_extracted is False
    assert row.descriptions_processing_error == "Требуется переобработка"


@pytest.mark.asyncio
async def test_reconcile_skips_consistent_books(
    client, admin_headers, consistent_book, db_session
):
    """Books with descriptions_extracted=True and 0 failed chapters should not be touched."""
    response = await client.post(
        "/api/v1/admin/reconcile-statuses",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["found"] == 0
    assert data["fixed"] == []


@pytest.mark.asyncio
async def test_reconcile_skips_already_false_books(
    client, admin_headers, already_false_book, db_session
):
    """Books with descriptions_extracted=False should not be included even with failed chapters."""
    response = await client.post(
        "/api/v1/admin/reconcile-statuses",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["found"] == 0
    assert data["fixed"] == []


@pytest.mark.asyncio
async def test_reconcile_requires_admin(client, regular_headers):
    """Non-admin users should get 403."""
    response = await client.post(
        "/api/v1/admin/reconcile-statuses",
        headers=regular_headers,
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_reconcile_requires_auth(client):
    """Unauthenticated requests should get 401."""
    response = await client.post("/api/v1/admin/reconcile-statuses")
    assert response.status_code == 401
