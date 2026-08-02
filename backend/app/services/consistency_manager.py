"""
Consistency Manager Service.

Responsible for:
1. Entity Resolution (Merging duplicates "Bob" == "Robert")
2. Master Reference Management (Generating/Storing portraits)
3. Knowledge Graph Updates
"""

import logging
import hashlib
from typing import List, Dict, Optional
from difflib import SequenceMatcher
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import insert as pg_insert
import uuid as uuid_module
from app.models.entity import Entity, EntityType
from app.models.entity_relationship import EntityRelationship
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedEntity,
    ExtractedRelationship,
)
from app.services.imagen_generator import get_imagen_service
from app.core.json_utils import parse_json_safe
from app.core.openrouter_client import get_openrouter_client
import random

logger = logging.getLogger(__name__)


class ConsistencyManager:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _acquire_entity_lock(self, book_id: str, entity_name: str) -> None:
        """
        Acquire PostgreSQL advisory lock for entity creation.

        Uses pg_advisory_xact_lock (transaction-scoped) to serialize concurrent
        entity creation across Celery workers. The lock is automatically released
        on COMMIT/ROLLBACK.
        """
        lock_key = int(
            hashlib.sha256(f"{book_id}:{entity_name.casefold()}".encode()).hexdigest()[
                :15
            ],
            16,
        )
        await self.db.execute(
            sa_text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": lock_key},
        )

    def _merge_visual_summaries(
        self, existing: str, new: str, chapter_index: Optional[int] = None
    ) -> str:
        if not existing:
            return new
        if not new:
            return existing

        # Smarter merge: compare with the LAST entry, not the whole history
        parts = existing.split("\n\n")
        last_entry = parts[-1]

        # Clean up last entry (remove [Глава N]: prefix)
        if "]: " in last_entry:
            last_content = last_entry.split("]: ", 1)[1].lower()
        else:
            last_content = last_entry.lower()

        new_lower = new.lower()

        # 1. Similarity check against LAST entry
        if SequenceMatcher(None, last_content, new_lower).ratio() > 0.7:
            # If very similar, keep the longer one (replace last entry if new is better)
            # But simpler for now: just ignore new if it's similar to last
            return existing

        # 2. Substring check
        if new_lower in last_content:
            return existing

        if last_content in new_lower:
            # If new contains old, it's an expansion.
            # We could replace the last entry, but appending with new chapter is safer for history.
            # Unless it's the SAME chapter.
            # For now, append.
            pass

        chapter_marker = f"[Глава {chapter_index}]" if chapter_index is not None else ""
        combined = (
            f"{existing}\n\n{chapter_marker}: {new}"
            if chapter_marker
            else f"{existing}\n\n{new}"
        )

        if len(combined) > 2000:
            return existing

        return combined

    def _resolve_entity_advanced(
        self, name: str, existing_entities: Dict[str, "Entity"]
    ) -> Optional["Entity"]:
        name_lower = name.casefold()

        if name_lower in existing_entities:
            return existing_entities[name_lower]

        for entity in existing_entities.values():
            aliases = (
                entity.entity_metadata.get("aliases", [])
                if entity.entity_metadata
                else []
            )
            aliases_lower = [a.casefold() for a in aliases if isinstance(a, str)]
            if name_lower in aliases_lower:
                return entity

        name_tokens = set(name_lower.split())
        for key, entity in existing_entities.items():
            entity_tokens = set(key.split())
            overlap = name_tokens & entity_tokens
            if overlap:
                ratio = len(overlap) / max(len(name_tokens), len(entity_tokens))
                if ratio >= 0.5:
                    return entity

        for key, entity in existing_entities.items():
            if SequenceMatcher(None, name_lower, key).ratio() > 0.75:
                return entity

        return None

    @staticmethod
    def _deduplicate_events(events: list[dict]) -> list[dict]:
        """Дедуплицирует похожие events (SequenceMatcher > 0.8), оставляя более длинный."""
        if len(events) <= 1:
            return events
        result = []
        used: set[int] = set()
        for i, ev_a in enumerate(events):
            if i in used:
                continue
            best = ev_a
            for j, ev_b in enumerate(events[i + 1 :], start=i + 1):
                if j in used:
                    continue
                ratio = SequenceMatcher(
                    None, ev_a.get("action", ""), ev_b.get("action", "")
                ).ratio()
                if ratio > 0.8:
                    used.add(j)
                    if len(ev_b.get("action", "")) > len(best.get("action", "")):
                        best = ev_b
            result.append(best)
        return result

    async def process_chapter_analysis(
        self,
        book_id: str,
        result: ChapterAnalysisResult,
        chapter_id: Optional[str] = None,
        chapter_index: Optional[int] = None,
    ) -> Dict[str, Entity]:
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

        entity_map = await self._batch_resolve_entities(
            book_id, result.entities, chapter_index
        )

        # Flush to get IDs
        await self.db.flush()

        # 2. Create Entity Mentions (Hard Links) with offset from extraction
        if chapter_id:
            from app.models.entity_mention import EntityMention

            seen_entity_ids = set()
            for raw_entity in result.entities:
                resolved_entity = entity_map.get(raw_entity.name.casefold())
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

    async def _process_relationships(
        self,
        book_id: str,
        relationships: List[ExtractedRelationship],
        entity_map: Dict[str, Entity],
    ):
        """
        Update knowledge graph edges.
        """
        for rel in relationships:
            source = entity_map.get(rel.source.casefold())
            target = entity_map.get(rel.target.casefold())

            if source and target and source.id != target.id:
                # Check for existing relationship
                q = select(EntityRelationship).where(
                    EntityRelationship.source_id == source.id,
                    EntityRelationship.target_id == target.id,
                    EntityRelationship.type == rel.type,
                )
                existing = await self.db.scalar(q)

                if existing:
                    existing.weight = int((existing.weight + (rel.weight / 10.0)) / 2)
                    if rel.context:
                        current_context = ""
                        if existing.relationship_metadata:
                            current_context = existing.relationship_metadata.get(
                                "context", ""
                            )
                        if len(rel.context) > len(current_context):
                            existing.relationship_metadata = {
                                **(existing.relationship_metadata or {}),
                                "context": rel.context,
                            }
                    self.db.add(existing)
                else:
                    new_rel = EntityRelationship(
                        source_id=source.id,
                        target_id=target.id,
                        type=rel.type,
                        weight=rel.weight / 10.0,
                        relationship_metadata={"context": rel.context},
                    )
                    self.db.add(new_rel)

    async def _batch_resolve_entities(
        self,
        book_id: str,
        raw_entities: List[ExtractedEntity],
        chapter_index: Optional[int] = None,
    ) -> Dict[str, Entity]:
        """
        Batch resolve entities with alias-aware deduplication.
        """
        if not raw_entities:
            return {}

        all_names = set()
        for raw in raw_entities:
            all_names.add(raw.name.casefold())
            for alias in raw.aliases:
                all_names.add(alias.casefold())

        from sqlalchemy.orm import selectinload

        query = (
            select(Entity)
            .where(Entity.book_id == book_id)
            .options(
                selectinload(Entity.mentions), selectinload(Entity.linked_descriptions)
            )
        )
        result = await self.db.execute(query)
        all_book_entities = list(result.scalars().all())

        existing_entities: Dict[str, Entity] = {}
        for entity in all_book_entities:
            existing_entities[entity.name_lower] = entity

            stored_aliases = (
                entity.entity_metadata.get("aliases", [])
                if entity.entity_metadata
                else []
            )
            for alias in stored_aliases:
                if isinstance(alias, str):
                    existing_entities[alias.casefold()[:255]] = entity

        # 3. Build entity map and create new entities
        entity_map: Dict[str, Entity] = {}

        for raw in raw_entities:
            name_lower = raw.name.casefold()[:255]

            resolved = self._resolve_entity_advanced(raw.name, existing_entities)

            if resolved:
                entity = resolved
                merged_summary = self._merge_visual_summaries(
                    entity.visual_summary or "",
                    raw.visual_summary,
                    chapter_index=chapter_index,
                )
                updated = False
                if merged_summary != (entity.visual_summary or ""):
                    entity.visual_summary = merged_summary
                    updated = True

                if raw.aliases and chapter_index is not None:
                    existing_aliases = entity.aliases_with_reveal or []
                    existing_names = {
                        a.get("name", "").casefold() for a in existing_aliases
                    }
                    for alias in raw.aliases:
                        if alias.casefold() not in existing_names:
                            existing_aliases.append(
                                {"name": alias, "reveal_chapter": chapter_index}
                            )
                            updated = True
                    if updated:
                        entity.aliases_with_reveal = existing_aliases

                if updated:
                    self.db.add(entity)
            elif name_lower not in entity_map:
                type_enum = EntityType.OBJECT
                if raw.type.lower() == "character":
                    type_enum = EntityType.CHARACTER
                elif raw.type.lower() == "location":
                    type_enum = EntityType.LOCATION

                aliases_with_reveal = (
                    [
                        {"name": alias, "reveal_chapter": chapter_index}
                        for alias in raw.aliases
                    ]
                    if raw.aliases
                    else []
                )

                # Advisory lock to serialize entity creation across workers
                await self._acquire_entity_lock(book_id, raw.name)

                # Use INSERT ... ON CONFLICT to handle concurrent entity creation
                # from parallel chapter processing (race condition fix)
                entity_values = {
                    "id": uuid_module.uuid4(),
                    "book_id": book_id,
                    "name": raw.name,
                    "name_lower": raw.name.casefold()[:255],
                    "type": type_enum.value,
                    "visual_summary": raw.visual_summary,
                    "importance": raw.importance if raw.importance else 5,
                    "first_mention_chapter": chapter_index,
                    "aliases_with_reveal": aliases_with_reveal,
                    "entity_metadata": {
                        "aliases": raw.aliases,
                        "confidence": raw.confidence,
                        "first_mention_offset": raw.first_mention_offset,
                    },
                }
                stmt = pg_insert(Entity).values(**entity_values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["book_id", "name_lower"],
                    set_={
                        # Keep the earliest chapter where the entity first appeared.
                        # LEAST(COALESCE(a,b), COALESCE(b,a)) returns the minimum of
                        # two values even when one of them is NULL.
                        "first_mention_chapter": func.least(
                            func.coalesce(
                                Entity.first_mention_chapter,
                                stmt.excluded.first_mention_chapter,
                            ),
                            func.coalesce(
                                stmt.excluded.first_mention_chapter,
                                Entity.first_mention_chapter,
                            ),
                        ),
                        # Keep the existing visual_summary if already set; only
                        # populate it if the row is empty (e.g. won by a later chapter).
                        "visual_summary": func.coalesce(
                            Entity.visual_summary, stmt.excluded.visual_summary
                        ),
                        "entity_metadata": stmt.excluded.entity_metadata,
                        # Merge alias arrays from both parallel workers rather than
                        # replacing. For each alias name, keep the entry with the
                        # lowest reveal_chapter (NULL = always visible, treated as -1).
                        # DISTINCT ON deduplicates by name; ORDER BY picks the earliest.
                        # COALESCE on the aggregate: when both sides are empty,
                        # jsonb_agg over zero rows returns NULL and the NOT NULL
                        # column rejects the whole chapter.
                        "aliases_with_reveal": sa_text(
                            "(SELECT COALESCE(jsonb_agg(alias), '[]'::jsonb) "
                            " FROM ("
                            "   SELECT DISTINCT ON (alias->>'name') alias"
                            "   FROM jsonb_array_elements("
                            "     COALESCE(entities.aliases_with_reveal, '[]'::jsonb)"
                            "     || COALESCE(excluded.aliases_with_reveal, '[]'::jsonb)"
                            "   ) AS alias"
                            "   ORDER BY alias->>'name',"
                            "     CASE WHEN alias->>'reveal_chapter' IS NULL THEN -1"
                            "          ELSE (alias->>'reveal_chapter')::int"
                            "     END ASC"
                            " ) merged)"
                        ),
                        "updated_at": func.now(),
                    },
                )
                await self.db.execute(stmt)

                # Fetch the entity back as ORM object (whether inserted or conflict-updated)
                fetch_result = await self.db.execute(
                    select(Entity).where(
                        Entity.book_id == book_id,
                        Entity.name_lower
                        == name_lower,  # name_lower: Python casefold(), locale-independent
                    )
                )
                entity = fetch_result.scalar_one()
                existing_entities[name_lower] = entity
            else:
                entity = entity_map[name_lower]

            # Map both name and aliases
            entity_map[name_lower] = entity
            for alias in raw.aliases:
                entity_map[alias.casefold()[:255]] = entity

        logger.info(
            f"Batch resolved {len(raw_entities)} entities: "
            f"{len(existing_entities)} existing, {len(entity_map)} total mapped"
        )

        return entity_map

    async def generate_master_references(self, book_id: str):
        """
        Trigger generation of Master Images for entities that lack them.
        Should be called after extraction is complete or periodically.
        """
        # Find entities with visual_summary but NO master_portrait_url
        query = select(Entity).where(
            Entity.book_id == book_id,
            Entity.visual_summary.isnot(None),
            Entity.master_portrait_url.is_(None),
        )
        result = await self.db.execute(query)
        entities = result.scalars().all()

        imagen = get_imagen_service()
        if not imagen.is_available():
            logger.warning(
                "Imagen service not available for Master Reference generation"
            )
            return

        for entity in entities:
            # Gatekeeper: Skip if description is too short OR Importance < 7
            # Default importance 5 if None
            imp = entity.importance if entity.importance is not None else 5
            visual_summary = entity.visual_summary or ""
            if len(visual_summary) < 50 or imp < 7:
                logger.debug(
                    f"Skipping Master Ref for {entity.name} (Imp: {imp}, Len: {len(visual_summary)})"
                )
                continue

            logger.info(
                f"Generating Master Reference for {entity.name} ({entity.type})"
            )

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
                    description=full_prompt, description_type=entity.type, seed=seed
                )

                if gen_result.success and gen_result.image_url:
                    # `image_url` уже короткий HTTP-URL. Раньше здесь брался
                    # basename(local_path), которого на cache hit не было —
                    # master_portrait_url молча оставался пустым.
                    entity.master_portrait_url = gen_result.image_url
                    self.db.add(entity)
                    logger.info(f"Master Reference set for {entity.name}")
            except Exception as e:
                logger.error(f"Failed to generate master ref for {entity.name}: {e}")

                error_str = str(e)
                if (
                    "RESOURCE_EXHAUSTED" in error_str
                    or "429" in error_str
                    or "Quota exceeded" in error_str
                ):
                    logger.warning(
                        "Quota exceeded. Stopping Master Reference generation for remaining entities."
                    )
                    break

                continue

        # TD-P17-3 FIX: Single commit after loop instead of N commits inside loop
        await self.db.commit()

    # --- Batched Reduce constants ---
    BATCH_SIZE = 50
    MAX_DEPTH = 2

    async def _single_reduce_pass(self, entities: list) -> dict:
        """
        Execute a single LLM reduce pass on a list of entities.

        Formats entity data, sends to OpenRouter with REDUCE_PROMPT,
        parses the response via parse_json_safe.

        Args:
            entities: List of Entity objects to reduce.

        Returns:
            dict with 'merge_operations' and 'delete_operations' keys.
        """
        entity_list_text = ""
        for e in entities:
            summary = (e.visual_summary or "")[:100]
            entity_list_text += (
                f"ID: {e.id} | Name: {e.name} | Type: {e.type} "
                f"| Importance: {e.importance} | Summary: {summary}...\n"
            )

        REDUCE_PROMPT = f"""You are a Data Consistency Expert for a book entity database.

INPUT DATA:
{entity_list_text}

TASK:
1. **MERGE DUPLICATES**: Identify entities that refer to the same person/place:
   - "Harry", "Harry Potter", "Mr. Potter" → SAME entity
   - Consider aliases, partial names, nicknames

2. **DO NOT DELETE based on importance!** Keep ALL entities.
   - Deletion criteria: ONLY if entity is clearly garbage (typo, parsing error)
   - Example of garbage: "said", "ааааа", "Chapter 1"
   - NEVER delete entities just because they have low importance

3. **PRESERVE reveal_chapter for aliases:**
   - If an alias appears only from chapter N, mark it:
     {{ "alias": "Избранный", "reveal_chapter": 10 }}

OUTPUT JSON:
{{
    "merge_operations": [
        {{
            "keep_id": "uuid-of-most-detailed",
            "merge_ids": ["uuid", "uuid"],
            "merged_aliases": [
                {{ "name": "Potter", "reveal_chapter": null }},
                {{ "name": "The Chosen One", "reveal_chapter": 10 }}
            ]
        }}
    ],
    "delete_operations": [ "uuid-only-if-garbage" ]
}}

CRITICAL RULES:
- When merging, keep the entity with the LONGEST visual_summary
- NEVER delete entities just because they have low importance
- ALWAYS preserve chapter information for spoiler protection
"""

        openrouter = get_openrouter_client()
        raw_text = await openrouter.generate_text(
            prompt=REDUCE_PROMPT,
            system_prompt="Respond ONLY with valid JSON, no markdown.",
        )

        raw_plan = parse_json_safe(raw_text)
        plan: dict = raw_plan if isinstance(raw_plan, dict) else {}
        return plan

    async def _execute_reduce_operations(self, plan: dict, book_id: str) -> None:
        """
        Execute merge and delete operations from a reduce plan.

        For merge_operations: re-links EntityRelationship edges from merged
        entities to the kept entity, then deletes the merged entities.
        For delete_operations: deletes garbage entities.

        Args:
            plan: dict with 'merge_operations' and 'delete_operations'.
            book_id: Book ID for logging.
        """
        from sqlalchemy import delete

        # A. Merges
        merge_ops = plan.get("merge_operations", [])
        for merge in merge_ops:
            if not isinstance(merge, dict):
                continue
            keep_id = merge.get("keep_id")
            merge_ids = merge.get("merge_ids", [])

            if not keep_id or not merge_ids:
                continue

            try:
                # Update source edges
                stmt_source = (
                    update(EntityRelationship)
                    .where(EntityRelationship.source_id.in_(merge_ids))
                    .values(source_id=keep_id)
                )
                await self.db.execute(stmt_source)

                # Update target edges
                stmt_target = (
                    update(EntityRelationship)
                    .where(EntityRelationship.target_id.in_(merge_ids))
                    .values(target_id=keep_id)
                )
                await self.db.execute(stmt_target)

                # Delete merged entities
                stmt_del = delete(Entity).where(Entity.id.in_(merge_ids))
                await self.db.execute(stmt_del)

            except Exception as e:
                logger.error(f"Failed merge op for {keep_id}: {e}")

        # B. Deletes (Garbage Collection)
        delete_ids = plan.get("delete_operations", [])
        if delete_ids:
            stmt_del_garbage = delete(Entity).where(Entity.id.in_(delete_ids))
            await self.db.execute(stmt_del_garbage)

        total_merges = len(merge_ops)
        total_deletes = len(delete_ids)
        if total_merges or total_deletes:
            logger.info(
                f"Reduce ops applied for book {book_id}: "
                f"Merged: {total_merges}, Deleted: {total_deletes}"
            )

    async def optimize_book_entities(self, book_id: str) -> None:
        """
        [Phase 2] Map-Reduce Barrier: Reduce Phase (Batched).

        Optimizes entities for the entire book AFTER parallel extraction is done.
        Uses batched reduce for books with many entities (> BATCH_SIZE).
        Recurses up to MAX_DEPTH times to catch cross-batch duplicates.

        1. Fetches ALL entities for the book.
        2. If <= BATCH_SIZE: single reduce pass.
        3. If > BATCH_SIZE: split into batches of ~BATCH_SIZE, reduce each.
        4. Repeat up to MAX_DEPTH if list shrank (cross-batch merges possible).
        5. Updates DB (Merge & Delete) after each pass.
        """
        logger.info(f"Starting Entity Optimization (Reduce Phase) for book {book_id}")

        # 1. Fetch all entities
        query = select(Entity).where(Entity.book_id == book_id)
        result = await self.db.execute(query)
        entities = list(result.scalars().all())

        if not entities:
            logger.warning("No entities found to optimize")
            return

        logger.info(
            f"Fetched {len(entities)} raw entities. "
            f"BATCH_SIZE={self.BATCH_SIZE}, MAX_DEPTH={self.MAX_DEPTH}"
        )

        try:
            for depth in range(self.MAX_DEPTH):
                old_count = len(entities)

                if len(entities) <= self.BATCH_SIZE:
                    # Single pass for small lists
                    plan = await self._single_reduce_pass(entities)
                    await self._execute_reduce_operations(plan, book_id)
                    break
                else:
                    # Batched reduce for large lists
                    batches = [
                        entities[i : i + self.BATCH_SIZE]
                        for i in range(0, len(entities), self.BATCH_SIZE)
                    ]
                    all_ops: dict = {"merge_operations": [], "delete_operations": []}

                    for batch in batches:
                        batch_plan = await self._single_reduce_pass(batch)
                        all_ops["merge_operations"].extend(
                            batch_plan.get("merge_operations", [])
                        )
                        all_ops["delete_operations"].extend(
                            batch_plan.get("delete_operations", [])
                        )

                    await self._execute_reduce_operations(all_ops, book_id)

                    # Reload entities for next round
                    result = await self.db.execute(query)
                    entities = list(result.scalars().all())

                    if len(entities) >= old_count:
                        logger.info(
                            f"Entity count did not decrease ({old_count} -> {len(entities)}). "
                            f"Stopping reduce at depth {depth + 1}."
                        )
                        break

                    logger.info(
                        f"Reduce depth {depth + 1}: {old_count} -> {len(entities)} entities"
                    )

            await self.db.commit()
            logger.info(
                f"Optimization Complete for book {book_id}. "
                f"Final entity count: {len(entities)}"
            )

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Entity Optimization Failed: {e}", exc_info=True)
