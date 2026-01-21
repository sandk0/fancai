import asyncio
import os
import sys
from uuid import UUID
from sqlalchemy import select, update

# Add app to path
sys.path.append("/app")

from app.core.database import AsyncSessionLocal
from app.models.book import Book

async def reset_book(book_id_str):
    try:
        book_id = UUID(book_id_str)
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            
            if not book:
                print(f"Book {book_id} not found")
                return

            print(f"Resetting book {book.title} ({book.id})")
            print(f"Current status: is_processing={book.is_processing}, progress={book.parsing_progress}")
            
            # Reset fields
            book.is_processing = False
            book.parsing_progress = 0
            book.parsing_error = "Manually stopped by user request"
            book.descriptions_processing_error = "Manually stopped by user request"
            
            await db.commit()
            print("Book status reset successfully.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reset_book.py <book_id>")
        sys.exit(1)
        
    asyncio.run(reset_book(sys.argv[1]))
