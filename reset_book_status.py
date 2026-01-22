
import asyncio
import os
import sys

# Add project root to path
sys.path.append('.')

from app.core.database import AsyncSessionLocal
from app.models.book import Book
from sqlalchemy import select
from uuid import UUID

async def reset_book():
    book_id = UUID('d82a9c66-ceac-4793-9a0c-b50f77eb7f4d')
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        
        if book:
            print(f"Resetting book: {book.title}")
            # Reset processing status
            book.is_processing = False
            # Ensure it's marked as parsed if it says 100%
            if book.parsing_progress == 100:
                book.is_parsed = True
            
            await session.commit()
            print("✅ Book status reset successfully to is_processing=False")
        else:
            print("Book not found")

if __name__ == "__main__":
    asyncio.run(reset_book())
