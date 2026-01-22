
import asyncio
import os
import sys

# Add project root to path
sys.path.append('.')

from app.core.database import AsyncSessionLocal
from app.models.book import Book
from sqlalchemy import select
from uuid import UUID

async def check_book():
    book_id = UUID('3b17cafe-738a-40c6-93db-5dc25620e762')
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        
        if book:
            print(f"Book: {book.title}")
            print(f"ID: {book.id}")
            print(f"is_processing: {book.is_processing}")
            print(f"is_parsed: {book.is_parsed}")
            print(f"parsing_progress: {book.parsing_progress}")
            print(f"parsing_error: {book.parsing_error}")
            print(f"updated_at: {book.updated_at}")
            
            # Check detailed chapter progress
            from app.models.chapter import Chapter
            from sqlalchemy import func
            
            # Total chapters
            total_chapters = await session.scalar(
                select(func.count(Chapter.id)).where(Chapter.book_id == book_id)
            )
            
            # Parsed chapters
            parsed_chapters = await session.scalar(
                select(func.count(Chapter.id))
                .where(Chapter.book_id == book_id)
                .where(Chapter.is_description_parsed == True)
            )
            
            print(f"Chapters: {parsed_chapters}/{total_chapters}")
            if total_chapters > 0:
                print(f"Real Progress: {(parsed_chapters / total_chapters) * 100:.2f}%")
        else:
            print("Book not found")

if __name__ == "__main__":
    asyncio.run(check_book())
