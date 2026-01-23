
import asyncio
from uuid import UUID
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def fix():
    try:
        async with AsyncSessionLocal() as db:
            bid = '97a0c89f-cadf-4915-a9f4-749edc18505f'
            print(f"Fixing book {bid}...")
            await db.execute(text(f"UPDATE books SET is_processing = false, parsing_error = 'Manual Fix script' WHERE id = '{bid}'"))
            await db.commit()
            print("Done. Book reset successfully.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(fix())
