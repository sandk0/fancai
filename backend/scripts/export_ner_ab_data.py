"""
Export data for NER A/B testing.

Exports chapter content and LLM baseline entities from the production DB
as JSON fixtures for offline A/B testing of GLiNER2 NER quality.

Usage:
    uv run python scripts/export_ner_ab_data.py --book-id <UUID> --output tests/fixtures/ner_ab_data/
    uv run python scripts/export_ner_ab_data.py --auto-select 5 --output tests/fixtures/ner_ab_data/
"""

import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.book import Book  # noqa: E402
from app.models.chapter import Chapter  # noqa: E402
from app.models.entity import Entity  # noqa: E402
from app.models.entity_mention import EntityMention  # noqa: E402

logger = logging.getLogger(__name__)


def slugify_title(title: str) -> str:
    """Create a filesystem-safe slug from a book title."""
    return re.sub(r"[^\w]", "_", title.lower())[:30].strip("_")


async def get_books_by_ids(session: AsyncSession, book_ids: list[UUID]) -> list[Book]:
    """Fetch books by their IDs."""
    result = await session.execute(select(Book).where(Book.id.in_(book_ids)))
    return list(result.scalars().all())


async def get_top_books_by_entity_count(
    session: AsyncSession, n: int, min_entities: int
) -> list[dict]:
    """
    Select top N books with the most entities (minimum min_entities per book).

    Returns list of dicts with book_id, title, entity_count.
    """
    # Subquery: count entities per book
    stmt = (
        select(
            Entity.book_id,
            Book.title,
            func.count(Entity.id).label("entity_count"),
        )
        .join(Book, Book.id == Entity.book_id)
        .group_by(Entity.book_id, Book.title)
        .having(func.count(Entity.id) >= min_entities)
        .order_by(func.count(Entity.id).desc())
        .limit(n)
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {"book_id": row.book_id, "title": row.title, "entity_count": row.entity_count}
        for row in rows
    ]


async def export_book_data(
    session: AsyncSession,
    book_id: UUID,
    book_title: str,
    output_dir: Path,
) -> tuple[str, int, int]:
    """
    Export chapter content and LLM baseline entities for a single book.

    Creates two files:
    - {slug}_chapters.json: chapter texts
    - {slug}_baseline.json: LLM baseline entity list with chapter numbers

    Returns (slug, chapter_count, entity_count).
    """
    slug = slugify_title(book_title)

    # Export chapters
    chapters_result = await session.execute(
        select(Chapter)
        .where(Chapter.book_id == book_id)
        .order_by(Chapter.chapter_number)
    )
    chapters = chapters_result.scalars().all()

    chapters_data = {
        "book_title": book_title,
        "book_id": str(book_id),
        "chapters": [
            {
                "chapter_number": ch.chapter_number,
                "content": ch.content,
            }
            for ch in chapters
            if ch.content  # Skip empty chapters
        ],
    }

    chapters_path = output_dir / f"{slug}_chapters.json"
    with open(chapters_path, "w", encoding="utf-8") as f:
        json.dump(chapters_data, f, ensure_ascii=False, indent=2)

    # Export baseline entities with chapter mentions
    entities_result = await session.execute(
        select(Entity)
        .where(Entity.book_id == book_id)
        .options(selectinload(Entity.mentions))
    )
    entities = entities_result.scalars().all()

    # Build entity -> chapter_numbers mapping via mentions
    # We need chapter_number for each mention, which requires loading chapters
    chapter_id_to_number: dict[UUID, int] = {}
    for ch in chapters:
        chapter_id_to_number[ch.id] = ch.chapter_number

    entities_data = {
        "book_title": book_title,
        "book_id": str(book_id),
        "entities": [],
    }

    for entity in entities:
        chapter_numbers = sorted(
            set(
                chapter_id_to_number[m.chapter_id]
                for m in entity.mentions
                if m.chapter_id in chapter_id_to_number
            )
        )
        entities_data["entities"].append(
            {
                "name": entity.name,
                "type": (
                    entity.type if isinstance(entity.type, str) else entity.type.value
                ),
                "chapter_numbers": chapter_numbers,
            }
        )

    baseline_path = output_dir / f"{slug}_baseline.json"
    with open(baseline_path, "w", encoding="utf-8") as f:
        json.dump(entities_data, f, ensure_ascii=False, indent=2)

    logger.info(
        f"Exported {book_title}: {len(chapters_data['chapters'])} chapters, "
        f"{len(entities_data['entities'])} entities -> {slug}"
    )

    return slug, len(chapters_data["chapters"]), len(entities_data["entities"])


async def main(args: argparse.Namespace) -> None:
    """Main export logic."""
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    async with AsyncSessionLocal() as session:
        if args.book_id:
            # Export specific books
            book_ids = [UUID(bid) for bid in args.book_id]
            books = await get_books_by_ids(session, book_ids)
            if not books:
                logger.error(f"No books found for IDs: {args.book_id}")
                sys.exit(1)
            book_list = [{"book_id": b.id, "title": b.title} for b in books]
        elif args.auto_select:
            # Auto-select top N books by entity count
            book_list = await get_top_books_by_entity_count(
                session, args.auto_select, args.min_entities
            )
            if not book_list:
                logger.error(f"No books found with >= {args.min_entities} entities")
                sys.exit(1)
            logger.info(
                f"Auto-selected {len(book_list)} books: "
                + ", ".join(
                    f"{b['title']} ({b.get('entity_count', '?')} entities)"
                    for b in book_list
                )
            )
        else:
            logger.error("Specify --book-id or --auto-select")
            sys.exit(1)

        total_chapters = 0
        total_entities = 0

        for book_info in book_list:
            slug, ch_count, ent_count = await export_book_data(
                session,
                book_info["book_id"],
                book_info["title"],
                output_dir,
            )
            total_chapters += ch_count
            total_entities += ent_count

        logger.info(
            f"\nExport complete: {len(book_list)} books, "
            f"{total_chapters} chapters, {total_entities} entities "
            f"-> {output_dir}"
        )


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Export NER A/B test data from production DB"
    )
    parser.add_argument(
        "--book-id",
        nargs="+",
        help="One or more book UUIDs to export",
    )
    parser.add_argument(
        "--auto-select",
        type=int,
        help="Auto-select top N books by entity count",
    )
    parser.add_argument(
        "--output",
        default="tests/fixtures/ner_ab_data/",
        help="Output directory (default: tests/fixtures/ner_ab_data/)",
    )
    parser.add_argument(
        "--min-entities",
        type=int,
        default=10,
        help="Minimum entities per book for auto-select (default: 10)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    args = parse_args()
    asyncio.run(main(args))
