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

    async def process_chapter_analysis(self, book_id: str, result: ChapterAnalysisResult, chapter_id: Optional[str] = None) -> Dict[str, Entity]:
        """
        Process the raw results from agentic parsing.
        1. Resolve Entities (get or create, merge aliases) - BATCH mode.
        2. Create Entity Mentions (Link Chapter <-> Entity).
        3. Update Relationships.
        4. Trigger Master Reference generation (if needed).
        
        Phase 2: Batch entity resolution for performance.
        
        Returns:
            entity_map: Dict[str, Entity] - mapping of lowercase names to Entity objects,
                        used by book_tasks.py to create DescriptionEntity links.
        """
        if not result.entities:
            return {}

        logger.info(f"Processing {len(result.entities)} entities for book {book_id}")
        
        # 1. BATCH Entity Resolution & Upsert (Phase 2 optimization)
        entity_map = await self._batch_resolve_entities(book_id, result.entities)
        
        # Flush to get IDs
        await self.db.flush()

        # 2. Create Entity Mentions (Hard Links) with offset from extraction
        if chapter_id:
            from app.models.entity_mention import EntityMention
            
            seen_entity_ids = set()
            for raw_entity in result.entities:
                resolved_entity = entity_map.get(raw_entity.name.lower())
                if not resolved_entity or resolved_entity.id in seen_entity_ids:
                    continue
                    
                seen_entity_ids.add(resolved_entity.id)
                mention = EntityMention(
                    chapter_id=chapter_id,
                    entity_id=resolved_entity.id,
                    mention_text=raw_entity.name,
                    start_index=raw_entity.first_mention_offset,
                )
                self.db.add(mention)

        # 3. Relationship processing
        if result.relationships:
            await self._process_relationships(book_id, result.relationships, entity_map)
            
        # 4. Trigger Master Reference generation (for top entities)
        # We process this in background or check if needed
        # For now, let's just trigger for newly created entities with high confidence
        for raw_entity in result.entities:
            if raw_entity.confidence > 0.8 and raw_entity.visual_summary:
                # We can check if it needs master ref in _generate...
                # Ideally this is a separate background task to not slow down extraction
                pass 
        
        return entity_map
                
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
                    existing.weight = int((existing.weight + (rel.weight / 10.0)) / 2)
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

    async def _batch_resolve_entities(
        self, book_id: str, raw_entities: List[ExtractedEntity]
    ) -> Dict[str, Entity]:
        """
        Batch resolve entities with alias-aware deduplication.
        """
        if not raw_entities:
            return {}
        
        all_names = set()
        for raw in raw_entities:
            all_names.add(raw.name.lower())
            for alias in raw.aliases:
                all_names.add(alias.lower())
        
        from sqlalchemy import or_, func, cast
        from sqlalchemy.dialects.postgresql import JSONB
        
        query = select(Entity).where(Entity.book_id == book_id)
        result = await self.db.execute(query)
        all_book_entities = list(result.scalars().all())
        
        existing_entities: Dict[str, Entity] = {}
        for entity in all_book_entities:
            existing_entities[entity.name.lower()] = entity
            
            stored_aliases = entity.entity_metadata.get("aliases", []) if entity.entity_metadata else []
            for alias in stored_aliases:
                if isinstance(alias, str):
                    existing_entities[alias.lower()] = entity
        
        # 3. Build entity map and create new entities
        entity_map: Dict[str, Entity] = {}
        
        for raw in raw_entities:
            name_lower = raw.name.lower()
            
            if name_lower in existing_entities:
                # Update existing entity if new summary is better
                entity = existing_entities[name_lower]
                if len(raw.visual_summary) > len(entity.visual_summary or ""):
                    entity.visual_summary = raw.visual_summary
                    self.db.add(entity)
            elif name_lower not in entity_map:
                # Create new entity (avoiding duplicates within same batch)
                type_enum = EntityType.OBJECT
                if raw.type.lower() == "character":
                    type_enum = EntityType.CHARACTER
                elif raw.type.lower() == "location":
                    type_enum = EntityType.LOCATION
                    
                entity = Entity(
                    book_id=book_id,
                    name=raw.name,
                    type=type_enum.value,
                    visual_summary=raw.visual_summary,
                    importance=raw.importance if raw.importance else 5,
                    entity_metadata={
                        "aliases": raw.aliases,
                        "confidence": raw.confidence,
                        "first_mention_offset": raw.first_mention_offset,
                    }
                )
                self.db.add(entity)
                existing_entities[name_lower] = entity
            else:
                entity = entity_map[name_lower]
            
            # Map both name and aliases
            entity_map[name_lower] = entity
            for alias in raw.aliases:
                entity_map[alias.lower()] = entity
        
        logger.info(
            f"Batch resolved {len(raw_entities)} entities: "
            f"{len(existing_entities)} existing, {len(entity_map)} total mapped"
        )
        
        return entity_map

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
            importance=raw.importance if raw.importance else 5,
            entity_metadata={
                "aliases": raw.aliases,
                "confidence": raw.confidence,
                "first_mention_offset": raw.first_mention_offset,
            }
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
            # Gatekeeper: Skip if description is too short OR Importance < 7
            # Default importance 5 if None
            imp = entity.importance if entity.importance is not None else 5
            visual_summary = entity.visual_summary or ""
            if len(visual_summary) < 50 or imp < 7:
                logger.debug(f"Skipping Master Ref for {entity.name} (Imp: {imp}, Len: {len(visual_summary)})")
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
                    import os
                    filename = os.path.basename(gen_result.local_path) if gen_result.local_path else None
                    if filename:
                        entity.master_portrait_url = f"/api/v1/images/file/{filename}"
                        self.db.add(entity)
                        logger.info(f"Master Reference set for {entity.name}")
            except Exception as e:
                logger.error(f"Failed to generate master ref for {entity.name}: {e}")
                
                error_str = str(e)
                if "RESOURCE_EXHAUSTED" in error_str or "429" in error_str or "Quota exceeded" in error_str:
                    logger.warning("Quota exceeded. Stopping Master Reference generation for remaining entities.")
                    break
                    
                continue
        
        # TD-P17-3 FIX: Single commit after loop instead of N commits inside loop
        await self.db.commit()

    async def optimize_book_entities(self, book_id: str):
        """
        [Phase 2] Map-Reduce Barrier: Reduce Phase.
        
        Optimizes entities for the entire book AFTER parallel extraction is done.
        1. Fetches ALL entities for the book.
        2. Sends list to Gemini with instructions to:
           - Merge duplicates (Harry = Potter)
           - Filter out Importance < 7 (Garbage collection)
        3. Updates DB (Merge & Delete).
        """
        logger.info(f"Starting Entity Optimization (Reduce Phase) for book {book_id}")
        
        # 1. Fetch all entities
        query = select(Entity).where(Entity.book_id == book_id)
        result = await self.db.execute(query)
        entities = result.scalars().all()
        
        if not entities:
            logger.warning("No entities found to optimize")
            return
            
        logger.info(f"Fetched {len(entities)} raw entities. Preparing LLM Reduce payload...")
        
        entity_list_text = ""
        for e in entities:
             summary = (e.visual_summary or "")[:100]
             entity_list_text += f"ID: {e.id} | Name: {e.name} | Type: {e.type} | Importance: {e.importance} | Summary: {summary}...\n"
        
        if len(entity_list_text) > 300000:
             logger.warning("Too many entities for single Reduce pass. Truncating (TODO: Implement Recursive Reduce)")
             entity_list_text = entity_list_text[:300000]

        # 3. Call Gemini (LLM Reduce)
        from app.services.gemini_extractor import get_gemini_extractor
        extractor = get_gemini_extractor()
        if not extractor.is_available():
            logger.warning("LLM not available for optimization")
            return
            
        REDUCE_PROMPT = f"""
        You are a Data Consistency Expert. I have extracted entities from a book, but there are duplicates and unimportant items.
        
        INPUT DATA:
        {entity_list_text}
        
        TASK:
        1. IDENTIFY DUPLICATES: Regard "Harry", "Harry Potter", "Mr. Potter" as the SAME entity.
        2. FILTER GARBAGE: Remove any entity with Importance < 7 (unless it is clearly a main character).
        3. OUTPUT JSON: List of operations to clean the database.
        
        Output JSON Schema:
        {{
            "merge_operations": [
                {{ "keep_id": "uuid", "merge_ids": ["uuid", "uuid"] }}
            ],
            "delete_operations": [ "uuid", "uuid" ] 
        }}
        """
        
        try:
            # We use the raw client to get JSON directly (or string parsing)
            # For now, simplistic raw call wrapper since prompt is custom
            # Ideally add method to gemini_extractor `generate_raw(prompt)`
            # Using _call_gemini_with_retry but we need schema.
            # Let's bypass and trust simple text parsing or use a targeted schema?
            # Let's define schema dynamically or use a simple Text response and parse JSON.
            
            # Since _call_gemini_with_retry enforces GeminiResponseSchema, we cannot use it directly if payload differs.
            # WORKAROUND: Create a bespoke method or use the generic one in a flexible way? 
            # We'll rely on a manual implementation here using the client directly for custom task.
            
            import google.genai.types as types
            # Use client from extractor
            client = extractor._client
            model = extractor._model
            
            response = await client.aio.models.generate_content(
                model=model,
                contents=REDUCE_PROMPT,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            
            import json
            plan = json.loads(response.text)
            
            # 4. Execute Plan (DB Updates)
            
            # A. Merges
            for merge in plan.get("merge_operations", []):
                keep_id = merge["keep_id"]
                merge_ids = merge["merge_ids"]
                
                # Logic: Re-link relationships from merged_ids to keep_id, then delete merged_ids
                # Update EntityRelationship set source_id = keep_id where source_id in merge_ids
                # Update EntityRelationship set target_id = keep_id where target_id in merge_ids
                if not merge_ids: continue
                
                # Skip VALIDATION for speed (Assume LLM is strict)
                try:
                    # Update source edges
                    stmt_source = update(EntityRelationship).where(
                        EntityRelationship.source_id.in_(merge_ids)
                    ).values(source_id=keep_id)
                    await self.db.execute(stmt_source)
                    
                    # Update target edges
                    stmt_target = update(EntityRelationship).where(
                        EntityRelationship.target_id.in_(merge_ids)
                    ).values(target_id=keep_id)
                    await self.db.execute(stmt_target)
                    
                    # Delete merged entities
                    stmt_del = select(Entity).where(Entity.id.in_(merge_ids)) # Wait, delete is separate
                    # Actually directly delete
                    from sqlalchemy import delete
                    stmt_del = delete(Entity).where(Entity.id.in_(merge_ids))
                    await self.db.execute(stmt_del)
                    
                except Exception as e:
                    logger.error(f"Failed merge op for {keep_id}: {e}")
            
            # B. Deletes (Garbage Collection)
            delete_ids = plan.get("delete_operations", [])
            if delete_ids:
                from sqlalchemy import delete
                stmt_del_garbage = delete(Entity).where(Entity.id.in_(delete_ids))
                await self.db.execute(stmt_del_garbage)
                
            await self.db.commit()
            logger.info(f"Optimization Complete. Merged: {len(plan.get('merge_operations',[]))}, Deleted: {len(delete_ids)}")
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Entity Optimization Failed: {e}", exc_info=True)
