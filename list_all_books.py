import asyncio
import sys
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.book import Book

async def list_books():
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Book))
            books = result.scalars().all()
            
            print(f"{'ID':<38} | {'STATUS':<12} | {'PROGRESS':<5} | {'TITLE'}")
            print("-" * 100)
            for book in books:
                status = "PROCESSING" if book.is_processing else "DONE/IDLE"
                print(f"{str(book.id):<38} | {status:<12} | {str(book.parsing_progress)+'%':<5} | {book.title}")
                if book.parsing_error:
                    print(f"   Error: {book.parsing_error}")
            print("-" * 100)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import sys
    sys.path.append("/app") # Ensure app is in path
    asyncio.run(list_books())
