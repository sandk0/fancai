"""
Consistency Manager Service.

Responsible for:
1. Entity Resolution (Merging duplicates "Bob" == "Robert")
2. Master Reference Management (Generating/Storing portraits)
3. Knowledge Graph Updates
"""

import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.entity import Entity, EntityType
from app.models.entity_relationship import EntityRelationship
from app.models.book import Book
from app.services.gemini_extractor import ChapterAnalysisResult, ExtractedEntity

logger = logging.getLogger(__name__)

class ConsistencyManager:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def process_chapter_analysis(self, book_id: str, result: ChapterAnalysisResult):
        """
        Process the raw results from agentic parsing.
        1. Resolve Entities (get or create, merge aliases).
        2. Update Relationships.
        3. Trigger Master Reference generation (if needed).
        """
        if not result.entities:
            return

        logger.info(f"Processing {len(result.entities)} entities for book {book_id}")
        
        # 1. Entity Resolution
        for raw_entity in result.entities:
            await self._resolve_and_upsert_entity(book_id, raw_entity)
            
        # 2. Relationship processing (TODO: Implement graph logic)
        pass

    async def _resolve_and_upsert_entity(self, book_id: str, raw: ExtractedEntity) -> Entity:
        """
        Find existing entity by name/alias or create new.
        """
        # Simple exact match for now (MVP)
        # TODO: Vector search or fuzzy match for robust resolution
        query = select(Entity).where(
            Entity.book_id == book_id,
            Entity.name == raw.name
        )
        existing = await self.db.scalar(query)
        
        if existing:
            # Update visual summary if new one is better (naive logic: longer is better?)
            if len(raw.visual_summary) > len(existing.visual_summary or ""):
                existing.visual_summary = raw.visual_summary
                self.db.add(existing)
            return existing
        
        # Create new
        type_enum = EntityType.OBJECT
        if raw.type.lower() == "character":
            type_enum = EntityType.CHARACTER
        elif raw.type.lower() == "location":
            type_enum = EntityType.LOCATION
            
        new_entity = Entity(
            book_id=book_id,
            name=raw.name,
            type=type_enum.value,
            visual_summary=raw.visual_summary,
            entity_metadata={"aliases": raw.aliases, "confidence": raw.confidence}
        )
        self.db.add(new_entity)
        # await self.db.flush() # Needed if we want ID immediately
        return new_entity

    async def generate_master_references(self, book_id: str):
        """
        Trigger generation of Master Images for top entities.
        This would call ImagenGenerator with special prompts.
        """
        # TODO: Implement generation logic
        pass
