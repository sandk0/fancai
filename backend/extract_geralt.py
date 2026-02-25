import asyncio
import json
import sys
from uuid import UUID
from sqlalchemy import select, or_, and_

# Add /app to pythonpath
sys.path.append('/app')

from app.core.database import AsyncSessionLocal
from app.models.entity import Entity
from app.models.entity_relationship import EntityRelationship
from app.models.description import Description, DescriptionType
from app.models.description_entity import DescriptionEntity

async def main():
    # NEW Book ID
    book_id = UUID('dd515deb-26e6-4dc8-9177-b29f3d7b1b72')
    char_name = "Геральт"

    async with AsyncSessionLocal() as db:
        # 1. Fetch Entity
        stmt = select(Entity).where(
            and_(
                Entity.book_id == book_id,
                Entity.name_lower.contains(char_name.casefold())
            )
        )
        result = await db.execute(stmt)
        entities = result.scalars().all()
        
        if not entities:
            print(json.dumps({"error": f"Character '{char_name}' not found in book {book_id}"}))
            return

        final_output = []

        for entity in entities:
            # 2. Fetch Relationships
            rel_stmt = select(EntityRelationship).where(
                or_(
                    EntityRelationship.source_id == entity.id,
                    EntityRelationship.target_id == entity.id
                )
            )
            rel_result = await db.execute(rel_stmt)
            relationships = rel_result.scalars().all()

            # Resolve names
            related_ids = {r.source_id for r in relationships} | {r.target_id for r in relationships}
            if entity.id in related_ids: related_ids.remove(entity.id)
            
            related_entities = {}
            if related_ids:
                rel_ent_stmt = select(Entity).where(Entity.id.in_(related_ids))
                rel_ent_res = await db.execute(rel_ent_stmt)
                for re in rel_ent_res.scalars().all():
                    related_entities[re.id] = re.name

            # Format Relationships
            rels_formatted = []
            for r in relationships:
                other_id = r.target_id if r.source_id == entity.id else r.source_id
                direction = "outgoing" if r.source_id == entity.id else "incoming"
                
                rels_formatted.append({
                    "other_name": related_entities.get(other_id, "Unknown"),
                    "relationship_type": r.type,
                    "description": r.relationship_metadata.get("context", "No description"),
                    "strength": r.weight,
                    "direction": direction
                })

            # 3. Fetch descriptions via description_entities M:N table
            desc_stmt = (
                select(Description)
                .join(DescriptionEntity, Description.id == DescriptionEntity.description_id)
                .where(
                    and_(
                        DescriptionEntity.entity_id == entity.id,
                        Description.type == DescriptionType.CHARACTER
                    )
                )
                .limit(10)
            )
            
            desc_result = await db.execute(desc_stmt)
            descriptions = [d.content for d in desc_result.scalars().all()]
            
            # Fallback if no specific CHARACTER descriptions found
            if not descriptions:
                 descriptions = ["No specific character descriptions found. (Check DescriptionType.CHARACTER filter)"]

            final_output.append({
                "entity_id": str(entity.id),
                "name": entity.name,
                "type": entity.type,
                "visual_summary": entity.visual_summary,
                "importance": entity.importance,
                "metadata": entity.entity_metadata,
                "relationships": rels_formatted,
                "descriptions": descriptions 
            })

        print(json.dumps(final_output, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
