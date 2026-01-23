
import asyncio
from uuid import UUID
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
import os

async def verify():
    output = []
    try:
        async with AsyncSessionLocal() as db:
            bid = '97a0c89f-cadf-4915-a9f4-749edc18505f'
            output.append(f"Verifying book {bid}...")
            result = await db.execute(text(f"SELECT id, is_processing, is_parsed, parsing_progress, parsing_error FROM books WHERE id = '{bid}'"))
            row = result.one()
            output.append(f"STATE: is_processing={row[1]}, is_parsed={row[2]}, progress={row[3]}, error='{row[4]}'")
            
            # Also check User ID to be sure
            res_uid = await db.execute(text(f"SELECT user_id FROM books WHERE id = '{bid}'"))
            uid = res_uid.scalar()
            output.append(f"USER_ID: {uid}")

    except Exception as e:
        output.append(f"Error: {e}")

    with open("/app/verify_output.txt", "w") as f:
        f.write("\n".join(output))

if __name__ == "__main__":
    asyncio.run(verify())
