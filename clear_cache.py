
import asyncio
from uuid import UUID
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.config import settings
import redis.asyncio as aioredis # Check import path from tasks.py

async def clear_cache():
    user_id = None
    try:
        # 1. Get User ID
        async with AsyncSessionLocal() as db:
            bid = '97a0c89f-cadf-4915-a9f4-749edc18505f'
            print(f"Fetching user_id for book {bid}...")
            result = await db.execute(text(f"SELECT user_id FROM books WHERE id = '{bid}'"))
            row = result.one()
            user_id = row[0]
            print(f"User ID: {user_id}")
    except Exception as e:
        print(f"DB Error: {e}")
        return

    if not user_id:
        return

    try:
        # 2. Clear Redis
        print(f"Connecting to Redis at {settings.REDIS_URL}...")
        redis_client = await aioredis.from_url(settings.REDIS_URL)
        
        # Pattern 1: User books list
        pattern1 = f"user:{user_id}:books:*"
        # Pattern 2: Cached book details? (check cache manager)
        # It seems most caching is purely on the list or get_user_book might rely on it.
        
        # Let's clean everything related to user
        keys = await redis_client.keys(pattern1)
        if keys:
            print(f"Deleting {len(keys)} keys: {keys}")
            await redis_client.delete(*keys)
        else:
            print("No keys found for pattern.")
            
        await redis_client.close()
        print("Cache cleared.")
        
    except Exception as e:
        print(f"Redis Error: {e}")

if __name__ == "__main__":
    asyncio.run(clear_cache())
