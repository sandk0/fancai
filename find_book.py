
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def find():
    try:
        async with AsyncSessionLocal() as db:
            # Search by title
            result = await db.execute(text("SELECT id, title, is_processing, is_parsed FROM books WHERE title ILIKE '%Алхимик%' OR title ILIKE '%Alchemist%' ORDER BY created_at DESC LIMIT 1"))
            row = result.one_or_none()
            with open("/app/found_book.txt", "w") as f:
                if row:
                    f.write(f"{row[0]}|{row[1]}|{row[2]}|{row[3]}")
                else:
                    f.write("NOT_FOUND")
    except Exception as e:
         with open("/app/found_book.txt", "w") as f:
            f.write(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(find())
