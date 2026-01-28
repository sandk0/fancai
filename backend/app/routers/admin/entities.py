from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID
import logging

from ...core.database import get_database_session
from ...core.auth import get_current_admin_user
from ...core.cache import cache_manager
from ...models.user import User
from ...models.entity import Entity
from ...models.entity_mention import EntityMention
from ...models.description_entity import DescriptionEntity

router = APIRouter()
logger = logging.getLogger(__name__)


class DuplicateEntityGroup(BaseModel):
    book_id: UUID
    book_title: str
    normalized_name: str
    entities: List[dict]


class DuplicatesResponse(BaseModel):
    groups: List[DuplicateEntityGroup]
    total_duplicates: int


class MergeRequest(BaseModel):
    master_id: UUID
    duplicate_ids: List[UUID]


class MergeResponse(BaseModel):
    success: bool
    merged_count: int
    master_id: UUID
    message: str


def _normalize_name(name: str) -> str:
    if not name:
        return ""
    return name.lower().strip().replace("ё", "е")


@router.get("/entities/duplicates", response_model=DuplicatesResponse)
async def get_duplicate_entities(
    book_id: Optional[UUID] = None,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
):
    """
    Find potential duplicate entities based on normalized name matching.
    
    Duplicates are defined as entities with the same book_id and 
    normalized name (lowercase, trimmed, ё→е).
    
    Args:
        book_id: Optional filter by specific book
    """
    logger.info(f"[AdminEntities] Finding duplicates for book_id={book_id}")
    
    query = select(Entity).options(selectinload(Entity.book))
    if book_id:
        query = query.where(Entity.book_id == book_id)
    
    result = await db.execute(query.order_by(Entity.book_id, Entity.name))
    all_entities = result.scalars().all()
    
    groups_map: dict[tuple[UUID, str], list[Entity]] = {}
    for entity in all_entities:
        norm_name = _normalize_name(entity.name)
        key = (entity.book_id, norm_name)
        if key not in groups_map:
            groups_map[key] = []
        groups_map[key].append(entity)
    
    duplicate_groups = []
    total_duplicates = 0
    
    for (bid, norm_name), entities in groups_map.items():
        if len(entities) > 1:
            book_title = entities[0].book.title if entities[0].book else "Unknown"
            group = DuplicateEntityGroup(
                book_id=bid,
                book_title=book_title,
                normalized_name=norm_name,
                entities=[
                    {
                        "id": str(e.id),
                        "name": e.name,
                        "type": e.type.value if e.type else "unknown",
                        "importance": e.importance or 5,
                        "visual_summary": e.visual_summary,
                        "created_at": e.created_at.isoformat() if e.created_at else None,
                    }
                    for e in sorted(entities, key=lambda x: -(x.importance or 0))
                ]
            )
            duplicate_groups.append(group)
            total_duplicates += len(entities) - 1
    
    logger.info(f"[AdminEntities] Found {len(duplicate_groups)} duplicate groups, {total_duplicates} extra entities")
    
    return DuplicatesResponse(
        groups=duplicate_groups,
        total_duplicates=total_duplicates
    )


@router.post("/entities/merge", response_model=MergeResponse)
async def merge_entities(
    request: MergeRequest,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
):
    """
    Merge duplicate entities into a master entity.
    
    This operation:
    1. Moves all entity_mentions from duplicates to master
    2. Moves all description_entities from duplicates to master
    3. Merges aliases from duplicates into master's entity_metadata
    4. Deletes the duplicate entities
    5. Invalidates entity network cache for the book
    
    Args:
        request: MergeRequest with master_id and duplicate_ids
    """
    master_id = request.master_id
    duplicate_ids = request.duplicate_ids
    
    if not duplicate_ids:
        raise HTTPException(status_code=400, detail="No duplicate IDs provided")
    
    if master_id in duplicate_ids:
        raise HTTPException(status_code=400, detail="Master ID cannot be in duplicate IDs")
    
    logger.info(f"[AdminEntities] Merging {len(duplicate_ids)} entities into master {master_id}")
    
    master_result = await db.execute(select(Entity).where(Entity.id == master_id))
    master = master_result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail=f"Master entity {master_id} not found")
    
    duplicates_result = await db.execute(select(Entity).where(Entity.id.in_(duplicate_ids)))
    duplicates = duplicates_result.scalars().all()
    
    if len(duplicates) != len(duplicate_ids):
        found_ids = {str(d.id) for d in duplicates}
        missing = [str(did) for did in duplicate_ids if str(did) not in found_ids]
        raise HTTPException(status_code=404, detail=f"Duplicate entities not found: {missing}")
    
    book_ids = {master.book_id} | {d.book_id for d in duplicates}
    if len(book_ids) > 1:
        raise HTTPException(status_code=400, detail="All entities must belong to the same book")
    
    book_id = master.book_id
    
    try:
        await db.execute(
            update(EntityMention)
            .where(EntityMention.entity_id.in_(duplicate_ids))
            .values(entity_id=master_id)
        )
        
        existing_desc_ids_result = await db.execute(
            select(DescriptionEntity.description_id)
            .where(DescriptionEntity.entity_id == master_id)
        )
        existing_desc_ids = {row[0] for row in existing_desc_ids_result.all()}
        
        if existing_desc_ids:
            await db.execute(
                delete(DescriptionEntity)
                .where(
                    DescriptionEntity.entity_id.in_(duplicate_ids),
                    DescriptionEntity.description_id.in_(existing_desc_ids)
                )
            )
        
        await db.execute(
            update(DescriptionEntity)
            .where(DescriptionEntity.entity_id.in_(duplicate_ids))
            .values(entity_id=master_id)
        )
        
        all_names = {master.name}
        current_metadata = master.entity_metadata or {}
        current_aliases = set(current_metadata.get("aliases", []))
        
        for dup in duplicates:
            all_names.add(dup.name)
            dup_meta = dup.entity_metadata or {}
            dup_aliases = dup_meta.get("aliases", [])
            current_aliases.update(dup_aliases)
        
        all_names.discard(master.name)
        current_aliases.update(all_names)
        
        current_metadata["aliases"] = list(current_aliases)
        master.entity_metadata = current_metadata
        
        max_importance = max(
            [master.importance or 5] + [d.importance or 5 for d in duplicates]
        )
        master.importance = max_importance
        
        await db.execute(delete(Entity).where(Entity.id.in_(duplicate_ids)))
        await db.commit()
        
        cache_key = f"book:{book_id}:entity_network_v3"
        await cache_manager.delete(cache_key)
        
        logger.info(f"[AdminEntities] Successfully merged {len(duplicate_ids)} entities into {master_id}")
        
        return MergeResponse(
            success=True,
            merged_count=len(duplicate_ids),
            master_id=master_id,
            message=f"Successfully merged {len(duplicate_ids)} entities into master. Aliases: {list(current_aliases)}"
        )
        
    except Exception as e:
        await db.rollback()
        logger.exception(f"[AdminEntities] Merge failed: {e}")
        raise HTTPException(status_code=500, detail="Entity merge operation failed")
