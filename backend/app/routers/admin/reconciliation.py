"""
Admin endpoint for reconciliation of book statuses.

POST /admin/reconcile-statuses -- finds books with inconsistent
descriptions_extracted=True when they have failed chapters, and fixes them.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from ...core.auth import get_current_admin_user
from ...core.database import get_database_session
from ...models.book import Book
from ...models.chapter import Chapter
from ...models.user import User

router = APIRouter(tags=["admin", "reconciliation"])


@router.post("/reconcile-statuses")
async def reconcile_book_statuses(
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
):
    """Find books with descriptions_extracted=True but failed chapters, and fix them."""
    # Subquery: book_ids with at least one failed chapter
    failed_books_subquery = (
        select(Chapter.book_id)
        .where(Chapter.parsing_error.isnot(None))
        .distinct()
        .subquery()
    )

    # Find inconsistent books: extracted=True but have failed chapters
    result = await db.execute(
        select(Book.id, Book.title).where(
            and_(
                Book.descriptions_extracted == True,  # noqa: E712
                Book.id.in_(select(failed_books_subquery.c.book_id)),
            )
        )
    )
    inconsistent_rows = result.all()

    fixed = []
    for row in inconsistent_rows:
        book_id, book_title = row
        # Load full Book object for update (safe with lazy="raise" -- no relationship access)
        book_result = await db.execute(select(Book).where(Book.id == book_id))
        book = book_result.scalar_one()
        book.descriptions_extracted = False
        book.descriptions_processing_error = "Требуется переобработка"
        fixed.append({"id": str(book_id), "title": book_title})

    await db.commit()

    return {
        "found": len(inconsistent_rows),
        "fixed": fixed,
        "message": f"Исправлено {len(inconsistent_rows)} книг",
    }
