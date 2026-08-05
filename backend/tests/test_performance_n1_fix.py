"""
Performance tests for N+1 query optimization.

Tests verify that the book list endpoint uses efficient eager loading
instead of making separate queries for each book's reading progress.

Оптимизированный путь — `BookProgressService.get_books_with_progress()`
(его зовёт `routers/books/crud.py:269`). Метода
`BookService.get_user_books_with_progress` в проекте нет: eager loading живёт
в `BookService.get_user_books` (selectinload по chapters и reading_progress),
а прогресс считается из уже загруженных связей.

Expected: ≤5 queries for 50 books (instead of 51)
"""

import pytest
import time
from uuid import uuid4
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.book import Book, ReadingProgress
from app.models.chapter import Chapter
from app.services.book import BookProgressService


class QueryCounter:
    """Helper class to count SQL queries."""

    def __init__(self):
        self.queries = []
        self.count = 0

    def reset(self):
        self.queries = []
        self.count = 0

    def receive(self, conn, cursor, statement, parameters, context, executemany):
        """Callback to count queries."""
        self.queries.append(statement)
        self.count += 1


@pytest.fixture
def query_counter():
    """Fixture to count database queries."""
    counter = QueryCounter()
    return counter


@pytest.mark.asyncio
async def test_book_list_no_n1_queries(
    db_session: AsyncSession, test_user: User, query_counter: QueryCounter
):
    """
    Test that book list endpoint doesn't have N+1 query problem.

    Expected behavior:
    - Query 1: Load books for user
    - Query 2: Load all reading_progress for loaded books (eager loading)
    - NO additional queries per book

    Before optimization: 51 queries for 50 books
    After optimization: 2 queries for 50 books
    """
    progress_service = BookProgressService()

    # Create 50 test books with reading progress
    num_books = 50
    print(f"\n[TEST] Creating {num_books} test books...")

    for i in range(num_books):
        book = Book(
            id=uuid4(),
            user_id=test_user.id,
            title=f"Test Book {i + 1}",
            author=f"Author {i + 1}",
            genre="fantasy",
            language="ru",
            file_path=f"/test/book_{i}.epub",
            file_format="epub",
            file_size=1024 * 1024,
            is_parsed=True,
            total_pages=300,
        )
        db_session.add(book)
        await db_session.flush()

        # Add reading progress
        progress = ReadingProgress(
            id=uuid4(),
            user_id=test_user.id,
            book_id=book.id,
            current_chapter=1,
            current_page=1,
            current_position=25,
        )
        db_session.add(progress)

        # Add one chapter for progress calculation
        chapter = Chapter(
            id=uuid4(),
            book_id=book.id,
            chapter_number=1,
            title="Chapter 1",
            content="Test content",
            word_count=1000,
        )
        db_session.add(chapter)

    await db_session.commit()
    print(f"[TEST] Created {num_books} books with reading progress")

    # Clear query counter
    query_counter.reset()

    # Attach query listener (for async, we need to access the sync engine)
    sync_engine = db_session.sync_session.bind
    event.listen(sync_engine, "before_cursor_execute", query_counter.receive)

    try:
        # Execute the optimized method
        print("\n[TEST] Fetching books with optimized method...")
        start_time = time.time()

        books_with_progress = await progress_service.get_books_with_progress(
            db_session, test_user.id, skip=0, limit=50
        )

        elapsed_time = (time.time() - start_time) * 1000  # Convert to ms

        print(f"[TEST] Fetched {len(books_with_progress)} books")
        print(f"[TEST] Query count: {query_counter.count}")
        print(f"[TEST] Elapsed time: {elapsed_time:.2f}ms")

        # Assertions
        assert len(books_with_progress) == num_books, "Should return all books"

        # CRITICAL: Should be max 3-4 queries, NOT 51
        # Query 1: SELECT books WHERE user_id = ?
        # Query 2: SELECT reading_progress WHERE book_id IN (...)
        # Query 3: SELECT chapters WHERE book_id IN (...)
        # Query 4: Possible metadata query
        assert query_counter.count <= 5, (
            f"N+1 query detected! Expected ≤5 queries for {num_books} books, "
            f"got {query_counter.count} queries. "
            f"This indicates reading progress is being queried separately for each book."
        )

        print(
            f"\n[TEST] ✅ PASS: No N+1 queries detected ({query_counter.count} queries for {num_books} books)"
        )

        # Verify reading progress is calculated correctly
        for book, progress_percent in books_with_progress:
            assert 0.0 <= progress_percent <= 100.0, "Progress should be 0-100%"
            # We set current_position=25 in chapter 1 of 1 chapter
            assert progress_percent == 25.0, (
                f"Expected 25% progress, got {progress_percent}%"
            )

        print("[TEST] ✅ PASS: Reading progress calculated correctly for all books")

    finally:
        # Remove listener
        event.remove(sync_engine, "before_cursor_execute", query_counter.receive)


@pytest.mark.asyncio
async def test_progress_per_book_adds_no_queries(
    db_session: AsyncSession, test_user: User, query_counter: QueryCounter
):
    """Расчёт прогресса по каждой книге не должен добавлять запрос на книгу.

    Это и есть регрессионный сторож N+1. Прежний тест (`test_old_method_has_n1_queries`)
    требовал ОБРАТНОГО — что запросов ≥ числа книг, то есть что дефект на месте.
    После eager loading в `get_user_books` он стал падать на 3 запросах вместо 10,
    и «починить» его можно было только вернув N+1.
    """
    progress_service = BookProgressService()
    num_books = 10

    for i in range(num_books):
        book = Book(
            id=uuid4(),
            user_id=test_user.id,
            title=f"Guard Book {i + 1}",
            author="Author",
            genre="fantasy",
            language="ru",
            file_path=f"/test/guard_book_{i}.epub",
            file_format="epub",
            file_size=1024 * 1024,
            is_parsed=True,
        )
        db_session.add(book)
        await db_session.flush()

        db_session.add(
            ReadingProgress(
                id=uuid4(),
                user_id=test_user.id,
                book_id=book.id,
                current_chapter=1,
                current_position=50,
            )
        )
        db_session.add(
            Chapter(
                id=uuid4(),
                book_id=book.id,
                chapter_number=1,
                title="Chapter 1",
                content="Test",
                word_count=1000,
            )
        )

    await db_session.commit()
    query_counter.reset()

    sync_engine = db_session.sync_session.bind
    event.listen(sync_engine, "before_cursor_execute", query_counter.receive)

    try:
        books_with_progress = await progress_service.get_books_with_progress(
            db_session, test_user.id, skip=0, limit=num_books
        )

        assert len(books_with_progress) == num_books
        assert query_counter.count < num_books, (
            f"N+1 вернулся: {query_counter.count} запросов на {num_books} книг"
        )
        for _book, progress_percent in books_with_progress:
            assert progress_percent == 50.0
    finally:
        event.remove(sync_engine, "before_cursor_execute", query_counter.receive)




if __name__ == "__main__":
    # Run with: pytest backend/tests/test_performance_n1_fix.py -v -s
    pytest.main([__file__, "-v", "-s"])
