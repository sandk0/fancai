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
from app.models.book import Book
from app.services.gemini_extractor import ChapterAnalysisResult, ExtractedEntity, ExtractedRelationship
from app.services.imagen_generator import get_imagen_service
import random
import asyncio

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
        
        # 1. Entity Resolution & Upsert
        entity_map = {} # name -> Entity object
        for raw_entity in result.entities:
            entity = await self._resolve_and_upsert_entity(book_id, raw_entity)
            if entity:
                entity_map[entity.name.lower()] = entity
                for alias in entity.entity_metadata.get("aliases", []):
                    entity_map[alias.lower()] = entity
        
        # Flush to get IDs
        await self.db.flush()

        # 2. Relationship processing
        if result.relationships:
            await self._process_relationships(book_id, result.relationships, entity_map)
            
        # 3. Trigger Master Reference generation (for top entities)
        # We process this in background or check if needed
        # For now, let's just trigger for newly created entities with high confidence
        for raw_entity in result.entities:
            if raw_entity.confidence > 0.8 and raw_entity.visual_summary:
                # We can check if it needs master ref in _generate...
                # Ideally this is a separate background task to not slow down extraction
                pass 
                
    async def _process_relationships(self, book_id: str, relationships: List[ExtractedRelationship], entity_map: Dict[str, Entity]):
        """
        Update knowledge graph edges.
        """
        for rel in relationships:
            source = entity_map.get(rel.source.lower())
            target = entity_map.get(rel.target.lower())
            
            if source and target and source.id != target.id:
                # Check for existing relationship
                q = select(EntityRelationship).where(
                    EntityRelationship.source_id == source.id,
                    EntityRelationship.target_id == target.id,
                    EntityRelationship.type == rel.type
                )
                existing = await self.db.scalar(q)
                
                if existing:
                    # Update weight (normalize input weight 1-10 to 0-1 range if needed, or just accumulate)
                    # Input weight is 1-10. Existing weight default 0.5.
                    # Let's average them? Or Max?
                    # Let's just update metadata and weight
                    existing.weight = (existing.weight + (rel.weight / 10.0)) / 2
                    self.db.add(existing)
                else:
                    new_rel = EntityRelationship(
                        source_id=source.id,
                        target_id=target.id,
                        type=rel.type,
                        weight=rel.weight / 10.0,
                        relationship_metadata={"context": rel.context}
                    )
                    self.db.add(new_rel)

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
        Trigger generation of Master Images for entities that lack them.
        Should be called after extraction is complete or periodically.
        """
        # Find entities with visual_summary but NO master_portrait_url
        query = select(Entity).where(
            Entity.book_id == book_id,
            Entity.visual_summary.isnot(None),
            Entity.master_portrait_url.is_(None)
        )
        result = await self.db.execute(query)
        entities = result.scalars().all()
        
        imagen = get_imagen_service()
        if not imagen.is_available():
            logger.warning("Imagen service not available for Master Reference generation")
            return

        for entity in entities:
            # Skip if description is too short
            if len(entity.visual_summary) < 50:
                continue
                
            logger.info(f"Generating Master Reference for {entity.name} ({entity.type})")
            
            try:
                # Determine seed
                seed = entity.seed if entity.seed else random.randint(100000, 999999)
                if not entity.seed:
                    entity.seed = seed
                    # Save seed immediately? mapping logic handled in generator
                
                # Generate
                # We use a specific style for Master Refs? Portrait?
                style_prompt = "Masterpiece portrait, character concept art, high detail, neutral background"
                if entity.type == EntityType.LOCATION:
                    style_prompt = "Masterpiece landscape, concept art, high detail, establishing shot"
                elif entity.type == EntityType.OBJECT:
                    style_prompt = "Masterpiece object closeup, concept art, high detail, neutral background"
                
                full_prompt = f"{style_prompt}. {entity.visual_summary}"
                
                gen_result = await imagen.generate_image(
                    description=full_prompt,
                    description_type=entity.type,
                    seed=seed
                )
                
                if gen_result.success:
                    # Save URL and path
                    # We need to construct a URL. Usually tasks.py handles this.
                    # But here we are in service.
                    import os
                    filename = os.path.basename(gen_result.local_path) if gen_result.local_path else None
                    if filename:
                        entity.master_portrait_url = f"/api/v1/images/file/{filename}"
                        self.db.add(entity)
                        await self.db.commit() # Commit each success
                        logger.info(f"Master Reference set for {entity.name}")
            except Exception as e:
                logger.error(f"Failed to generate master ref for {entity.name}: {e}")
                continue
