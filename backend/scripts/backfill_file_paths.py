"""
Script to backfill 'file_path' for existing chapters.
Usage: python3 -m backend.scripts.backfill_file_paths
"""

import asyncio
import logging
import os
from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.models.book import Book
from app.models.chapter import Chapter
from app.services.book_parser import BookParser, ParserConfig

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def backfill_books():
    async with AsyncSessionLocal() as db:
        # 1. Get all books
        result = await db.execute(select(Book))
        books = result.scalars().all()
        
        logger.info(f"Found {len(books)} books to check.")
        
        parser = BookParser(ParserConfig())
        
        for book in books:
            try:
                # Check if file exists
                file_path = f"uploads/{book.id}.epub" # Assumption: standard path
                if not os.path.exists(file_path):
                    # Try finding it in storage dir if defined
                    # Or check book.file_path if it exists in model? 
                    # Usually files are in /app/uploads/ or similar.
                    # Let's assume standard uploads dir relative to app root.
                    # In docker it is /app/uploads. Locally depends.
                    # Try absolute path from env or config?
                    # For now try local relative.
                    if os.path.exists(f"backend/uploads/{book.id}.epub"):
                         file_path = f"backend/uploads/{book.id}.epub"
                    elif os.path.exists(f"uploads/{book.id}.epub"):
                         file_path = f"uploads/{book.id}.epub"
                    else:
                        logger.warning(f"File not found for book {book.id}: {file_path}")
                        continue

                logger.info(f"Processing book {book.title} ({book.id})...")
                
                # Parse book to get file paths
                parsed_book = parser.parse(file_path)
                
                # Fetch DB chapters
                chapters_res = await db.execute(
                    select(Chapter)
                    .where(Chapter.book_id == book.id)
                    .order_by(Chapter.chapter_number)
                )
                db_chapters = chapters_res.scalars().all()
                
                # Match and Update
                updates_count = 0
                
                # Create map of parsed chapters by number
                parsed_map = {ch.number: ch for ch in parsed_book.chapters}
                
                for db_ch in db_chapters:
                    if db_ch.file_path:
                        continue # Already has path
                        
                    match = parsed_map.get(db_ch.chapter_number)
                    if match:
                        # Validate matches roughly by title to be safe?
                        # Or trust chapter number alignment.
                        # Legacy parser relied on numbers, so number alignment is the best bet.
                        db_ch.file_path = match.file_path
                        db.add(db_ch)
                        updates_count += 1
                
                if updates_count > 0:
                    await db.commit()
                    logger.info(f"Updated {updates_count} chapters for book {book.title}")
                else:
                    logger.info(f"No updates needed for book {book.title}")
                    
            except Exception as e:
                logger.error(f"Error processing book {book.id}: {e}")

if __name__ == "__main__":
    asyncio.run(backfill_books())
