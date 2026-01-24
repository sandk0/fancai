import asyncio
import sys
sys.path.append('/app')
from app.core.database import AsyncSessionLocal
from app.models.entity_relationship import EntityRelationship
from sqlalchemy import select, func

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(func.count(EntityRelationship.id)))
        count = res.scalar()
        print(f"Total relationships in DB: {count}")
        
        if count > 0:
            res = await db.execute(select(EntityRelationship).limit(5))
            for r in res.scalars().all():
                print(f"{r.source_id} -> {r.target_id} ({r.type})")

if __name__ == "__main__":
    asyncio.run(main())
