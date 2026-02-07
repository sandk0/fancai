from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field
from loguru import logger

from app.core.database import get_database_session
from app.core.auth import get_current_active_user
from app.core.dependencies import get_user_book
from app.core.cache import cache_manager
from app.models.user import User
from app.models.book import Book
from app.models.entity import Entity
from app.services.entity_service import EntityService, get_entity_service
from app.schemas.responses.entities import (
    EntityNetworkResponse,
    RecapResponse,
    RecapEntitySchema,
    EntityEventSchema,
)
from app.models.entity_event import EntityEvent


class UpdateEntityCFIRequest(BaseModel):
    first_mention_cfi: str = Field(..., min_length=10, max_length=500)


class UpdateEntityCFIResponse(BaseModel):
    entity_id: UUID
    first_mention_cfi: str
    message: str


router = APIRouter()


@router.get(
    "/{book_id}/entities/network",
    response_model=EntityNetworkResponse,
    summary="Get book entity network (graph)",
)
async def get_book_entity_network_endpoint(
    book_id: UUID,
    current_chapter: Optional[int] = Query(
        None, description="Current chapter for spoiler filtering"
    ),
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    entity_service: EntityService = Depends(get_entity_service),
) -> EntityNetworkResponse:
    return await entity_service.get_book_entity_network(
        book_id, current_chapter=current_chapter
    )


@router.patch(
    "/{book_id}/entities/{entity_id}/cfi",
    response_model=UpdateEntityCFIResponse,
    summary="Update entity first mention CFI",
)
async def update_entity_cfi(
    book_id: UUID,
    entity_id: UUID,
    request: UpdateEntityCFIRequest,
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> UpdateEntityCFIResponse:
    """
    Update first_mention_cfi for an entity.
    Called by frontend after epub.js resolves offset to CFI.
    """
    entity = await db.scalar(
        select(Entity).where(Entity.id == entity_id, Entity.book_id == book_id)
    )

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    try:
        entity.first_mention_cfi = request.first_mention_cfi
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to update entity CFI: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    cache_key = f"book:{book_id}:entity_network_raw_v4"
    await cache_manager.delete(cache_key)

    logger.info(
        f"Updated first_mention_cfi for entity {entity_id}: {request.first_mention_cfi[:50]}..."
    )

    return UpdateEntityCFIResponse(
        entity_id=entity_id,
        first_mention_cfi=request.first_mention_cfi,
        message="CFI updated successfully",
    )


@router.get(
    "/{book_id}/entities/recap",
    response_model=RecapResponse,
    summary="Get book recap (top entities with latest events)",
)
async def get_book_recap(
    book_id: UUID,
    current_chapter: int = Query(..., description="Current reading chapter"),
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> RecapResponse:
    """Возвращает 'Ранее в книге' — топ-5 entities с последним событием."""
    from sqlalchemy.orm import selectinload

    # Load top entities by importance
    entities_q = await db.execute(
        select(Entity)
        .where(Entity.book_id == book_id)
        .order_by(Entity.importance.desc().nulls_last())
        .limit(5)
    )
    top_entities = entities_q.scalars().all()

    recap_entities = []
    for entity in top_entities:
        # Get latest event up to current chapter
        event_q = await db.execute(
            select(EntityEvent)
            .where(
                EntityEvent.entity_id == entity.id,
                EntityEvent.chapter_number <= current_chapter,
            )
            .order_by(EntityEvent.chapter_number.desc())
            .limit(1)
        )
        last_event_row = event_q.scalar_one_or_none()

        last_event = None
        if last_event_row:
            last_event = EntityEventSchema(
                chapter_number=last_event_row.chapter_number,
                event_action=last_event_row.event_action,
                event_inner_state=last_event_row.event_inner_state,
            )

        # Get dynamic_role from current milestone
        dynamic_role = None
        if entity.biography_milestones:
            from app.services.entity_service import EntityService
            milestone = EntityService._get_current_milestone(
                entity.biography_milestones, current_chapter
            )
            if milestone:
                dynamic_role = milestone.get("dynamic_role")

        recap_entities.append(
            RecapEntitySchema(
                id=entity.id,
                name=entity.name,
                avatar_url=entity.master_portrait_url,
                dynamic_role=dynamic_role,
                last_event=last_event,
            )
        )

    return RecapResponse(entities=recap_entities)
