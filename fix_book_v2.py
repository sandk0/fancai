
import asyncio
import sys
import os
# Ensure /app is in path
sys.path.append('/app')

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def fix():
    bid = '97a0c89f-cadf-4915-a9f4-749edc18505f'
    print(f"Starting fix for {bid}...")
    try:
        async with AsyncSessionLocal() as db:
            print("Connected to DB.")
            # Verify current state
            res = await db.execute(text(f"SELECT is_processing, is_parsed FROM books WHERE id = '{bid}'"))
            row = res.one()
            print(f"Current state: processing={row[0]}, parsed={row[1]}")
            
            # Force Update
            print("Executing update...")
            await db.execute(text(f"""
                UPDATE books 
                SET is_processing = false, 
                    is_parsed = true, 
                    parsing_progress = 100, 
                    descriptions_extracted = false,
                    parsing_error = 'Manual V2 Fix' 
                WHERE id = '{bid}'
            """))
            await db.commit()
            print("Update committed.")
            
            # Verify new state
            res = await db.execute(text(f"SELECT is_processing, is_parsed FROM books WHERE id = '{bid}'"))
            row = res.one()
            print(f"New state: processing={row[0]}, parsed={row[1]}")
            
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Script started.")
    try:
        asyncio.run(fix())
    except Exception as e:
        print(f"Top level error: {e}")
    print("Script finished.")
