import logging
import re
from typing import List, Dict, Optional, Set
from uuid import UUID
from functools import lru_cache

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.models.entity import Entity
from app.models.entity_relationship import EntityRelationship
from app.models.description import Description
from app.models.description_entity import DescriptionEntity
from app.models.chapter import Chapter
from app.models.entity_mention import EntityMention
from app.models.entity_event import EntityEvent
from app.schemas.responses.entities import (
    EntityNetworkResponse,
    EntityDetailSchema,
    NetworkEdgeSchema,
    EntityNoteSchema,
    EntityEventSchema,
)
from app.core.cache import cache_manager
from app.core.database import get_database_session

logger = logging.getLogger(__name__)



@lru_cache(maxsize=1000)
def _normalize_name(name: str) -> str:
    if not name:
        return ""
    return name.lower().strip().replace("ё", "е")


class EntityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _get_earliest_cfi(self, cfi_list: List[str]) -> Optional[str]:
        if not cfi_list:
            return None

        def parse_cfi_for_sort(cfi: str) -> tuple:
            match = re.match(r"^epubcfi\((.+)\)$", cfi)
            if not match:
                return (float("inf"),)

            inner = match.group(1)
            parts = inner.split("!")

            numbers = []
            for part in parts:
                segments = part.split("/")
                for seg in segments:
                    num_match = re.match(r"^(\d+)", seg)
                    if num_match:
                        numbers.append(int(num_match.group(1)))

            offset_match = re.search(r":(\d+)", inner)
            if offset_match:
                numbers.append(int(offset_match.group(1)))

            return tuple(numbers) if numbers else (float("inf"),)

        return min(cfi_list, key=parse_cfi_for_sort)

    @staticmethod
    def _get_current_milestone(
        milestones: list[dict] | None, current_chapter: int
    ) -> dict | None:
        """Возвращает актуальный milestone для текущей главы."""
        if not milestones:
            return None
        valid = [m for m in milestones if m.get("up_to_chapter", 0) <= current_chapter]
        if not valid:
            return None
        return max(valid, key=lambda m: m["up_to_chapter"])

    @staticmethod
    def _filter_events_by_chapter(
        events: list[dict], current_chapter: int
    ) -> list[dict]:
        """Фильтрует events до текущей главы включительно."""
        return [e for e in events if e.get("chapter_number", 0) <= current_chapter]

    @staticmethod
    def _get_current_relationship_milestone(
        milestones: list[dict] | None, current_chapter: int
    ) -> dict | None:
        """Возвращает актуальный relationship milestone для текущей главы."""
        if not milestones:
            return None
        valid = [m for m in milestones if m.get("up_to_chapter", 0) <= current_chapter]
        if not valid:
            return None
        return max(valid, key=lambda m: m["up_to_chapter"])

    @staticmethod
    def _filter_aliases_from_raw(
        aliases_with_reveal: list[dict], current_chapter: int
    ) -> List[str]:
        """Filter aliases using raw reveal data and current chapter."""
        visible: List[str] = []
        for alias_data in aliases_with_reveal:
            if not isinstance(alias_data, dict):
                continue
            reveal_ch = alias_data.get("reveal_chapter")
            alias_name = alias_data.get("name", "")
            if reveal_ch is None or reveal_ch <= current_chapter:
                if alias_name:
                    visible.append(alias_name)
        return visible

    @staticmethod
    def _process_visual_summary(
        summary: Optional[str], current_chapter: Optional[int]
    ) -> Optional[str]:
        """
        Filters and formats the visual summary based on reading progress.
        1. Splits by [Глава N] markers.
        2. Filters out parts from future chapters.
        3. Removes the [Глава N] markers to return a clean, cohesive text.
        """
        if not summary:
            return None

        parts = re.split(r"(\[Глава \d+\]: )", summary)
        result_parts = []

        base_text = parts[0].strip()
        if base_text:
            result_parts.append(base_text)

        for i in range(1, len(parts), 2):
            if i + 1 >= len(parts):
                break

            marker = parts[i]
            text = parts[i + 1].strip()

            match = re.search(r"\[Глава (\d+)\]", marker)
            if match:
                chapter_num = int(match.group(1))
                if current_chapter is None or chapter_num <= current_chapter:
                    result_parts.append(text)
            else:
                result_parts.append(text)

        if not result_parts:
            return None

        return "\n\n".join(result_parts)

    # ──────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────

    async def get_book_entity_network(
        self, book_id: UUID, current_chapter: Optional[int] = None
    ) -> EntityNetworkResponse:
        """
        Возвращает граф сущностей книги с дедупликацией и спойлер-фильтрацией.

        Стратегия кеширования (Design Doc §5.1):
        - Кешируем RAW данные (все сущности, все события, все milestones)
          без привязки к конкретной главе. Один кеш на книгу.
        - На каждый запрос применяем фильтрацию по current_chapter.
          Это гарантирует, что User A на главе 5 и User B на главе 10
          получают корректно отфильтрованные данные из одного кеша.
        """
        logger.info(f"[EntityService] Loading entity network for book_id={book_id}")

        # v5: RAW cache — chapter-agnostic. Fixes cache poisoning from v4.
        cache_key = f"book:{book_id}:entity_network_raw_v5"
        cached_data = await cache_manager.get(cache_key)

        if cached_data:
            logger.debug(f"[EntityService] Cache HIT for book_id={book_id}")
        else:
            logger.debug(
                f"[EntityService] Cache MISS for book_id={book_id}, loading from DB"
            )
            cached_data = await self._build_raw_network_cache(book_id)
            await cache_manager.set(cache_key, cached_data, ttl=3600)

        # Always filter per-request — even on cache HIT
        return self._apply_chapter_filter(cached_data, current_chapter)

    # ──────────────────────────────────────────────────────────────
    # Raw cache building (DB → dict, chapter-agnostic)
    # ──────────────────────────────────────────────────────────────

    async def _build_raw_network_cache(self, book_id: UUID) -> dict:
        """
        Build complete entity network from DB without chapter filtering.
        Stores source data (_raw_* fields) alongside computed fields
        so that per-request chapter filtering can be applied cheaply.
        """
        # 1. Load entities
        q_entities = select(Entity).where(Entity.book_id == book_id)
        entities_res = await self.db.execute(q_entities)
        all_entities = entities_res.scalars().all()
        logger.info(
            f"[EntityService] Loaded {len(all_entities)} entities for book_id={book_id}"
        )

        # 2. Load descriptions with chapters
        q_descriptions = (
            select(Description)
            .join(Chapter)
            .where(Chapter.book_id == book_id)
            .options(joinedload(Description.chapter))
        )
        desc_res = await self.db.execute(q_descriptions)
        all_descriptions = desc_res.scalars().all()
        descriptions_by_id = {d.id: d for d in all_descriptions}
        logger.info(
            f"[EntityService] Loaded {len(all_descriptions)} descriptions for book_id={book_id}"
        )

        # 3. Load description-entity links
        q_desc_entities = (
            select(
                DescriptionEntity.description_id,
                DescriptionEntity.entity_id,
                DescriptionEntity.mention_cfi,
            )
            .join(Description)
            .join(Chapter)
            .where(Chapter.book_id == book_id)
        )
        desc_entities_res = await self.db.execute(q_desc_entities)

        entity_to_descriptions: Dict[UUID, List[Description]] = {}
        description_cfi_map: Dict[UUID, str] = {}
        for desc_id, entity_id, mention_cfi in desc_entities_res.all():
            if entity_id not in entity_to_descriptions:
                entity_to_descriptions[entity_id] = []
            if desc_id in descriptions_by_id:
                entity_to_descriptions[entity_id].append(descriptions_by_id[desc_id])
            if mention_cfi:
                description_cfi_map[desc_id] = mention_cfi

        logger.info(
            f"[EntityService] Loaded description_entities links for {len(entity_to_descriptions)} entities"
        )

        # 4. Load hard link mentions
        q_mentions = (
            select(
                EntityMention.entity_id,
                Chapter.chapter_number,
                EntityMention.mention_cfi,
                EntityMention.start_index,
            )
            .join(Chapter)
            .where(Chapter.book_id == book_id)
        )
        mentions_res = await self.db.execute(q_mentions)

        hard_mentions_map: Dict[UUID, Set[int]] = {}
        cfi_mentions_map: Dict[UUID, List[str]] = {}
        offset_mentions_map: Dict[UUID, List[int]] = {}
        mentions_count = 0

        for eid, cnum, cfi, start_idx in mentions_res.all():
            if eid not in hard_mentions_map:
                hard_mentions_map[eid] = set()
                cfi_mentions_map[eid] = []
                offset_mentions_map[eid] = []
            hard_mentions_map[eid].add(cnum)
            if cfi:
                cfi_mentions_map[eid].append(cfi)
            if start_idx is not None:
                offset_mentions_map[eid].append(start_idx)
            mentions_count += 1
        logger.info(
            f"[EntityService] Loaded {mentions_count} hard mentions for {len(hard_mentions_map)} entities"
        )

        # 5. Load relationships
        entity_ids = [e.id for e in all_entities]
        if not entity_ids:
            return {"entities": {}, "edges": []}

        q_edges = select(EntityRelationship).where(
            EntityRelationship.source_id.in_(entity_ids)
        )
        edges_res = await self.db.execute(q_edges)
        all_edges = edges_res.scalars().all()

        # 6. Load entity events
        q_events = select(EntityEvent).where(EntityEvent.entity_id.in_(entity_ids))
        events_res = await self.db.execute(q_events)
        all_entity_events = events_res.scalars().all()

        events_by_entity: Dict[UUID, List[EntityEvent]] = {}
        for ev in all_entity_events:
            if ev.entity_id not in events_by_entity:
                events_by_entity[ev.entity_id] = []
            events_by_entity[ev.entity_id].append(ev)

        # 7. Soft merge (deduplication) + build raw cache
        return self._build_raw_merged_network(
            list(all_entities),
            list(all_edges),
            hard_mentions_map,
            cfi_mentions_map,
            offset_mentions_map,
            entity_to_descriptions,
            description_cfi_map,
            events_by_entity,
        )

    def _build_raw_merged_network(
        self,
        entities: List[Entity],
        edges: List[EntityRelationship],
        hard_mentions_map: Dict[UUID, Set[int]],
        cfi_mentions_map: Dict[UUID, List[str]],
        offset_mentions_map: Dict[UUID, List[int]],
        entity_to_descriptions: Dict[UUID, List[Description]],
        description_cfi_map: Dict[UUID, str],
        events_by_entity: Dict[UUID, List[EntityEvent]],
    ) -> dict:
        """
        Soft merge (alias-based deduplication) + build raw cache dict.
        Chapter-agnostic: stores ALL data with source fields for filtering.
        """
        # ── Alias-based grouping ──
        alias_to_canonical: Dict[str, str] = {}
        groups: Dict[str, List[Entity]] = {}

        for e in entities:
            norm_name = _normalize_name(str(e.name))

            found_canonical = alias_to_canonical.get(norm_name)

            if not found_canonical:
                stored_aliases = []
                metadata = e.entity_metadata
                if metadata and isinstance(metadata, dict):
                    stored_aliases = metadata.get("aliases", [])

                for alias in stored_aliases:
                    if isinstance(alias, str):
                        norm_alias = _normalize_name(alias)
                        if norm_alias in alias_to_canonical:
                            found_canonical = alias_to_canonical[norm_alias]
                            break

            canonical = found_canonical if found_canonical else norm_name

            alias_to_canonical[norm_name] = canonical

            metadata = e.entity_metadata
            if metadata and isinstance(metadata, dict):
                for alias in metadata.get("aliases", []):
                    if isinstance(alias, str):
                        alias_to_canonical[_normalize_name(alias)] = canonical

            if canonical not in groups:
                groups[canonical] = []
            groups[canonical].append(e)

        # ── Build master entities (raw cache format) ──
        id_remap: Dict[UUID, UUID] = {}
        raw_entities: Dict[str, dict] = {}

        for _norm_name, group in groups.items():
            master = max(
                group, key=lambda x: (100 if x.visual_summary else 0, x.importance or 0)
            )

            related_descriptions: List[Description] = []
            related_events: List[EntityEvent] = []
            for entity in group:
                related_descriptions.extend(entity_to_descriptions.get(entity.id, []))
                related_events.extend(events_by_entity.get(entity.id, []))

            raw_detail = self._create_raw_entity_cache(
                master,
                related_descriptions,
                hard_mentions_map,
                cfi_mentions_map,
                offset_mentions_map,
                description_cfi_map,
                related_events,
            )
            raw_entities[str(master.id)] = raw_detail

            for entity in group:
                id_remap[entity.id] = master.id

        # ── Build edges (raw cache format with source data) ──
        raw_edges: List[dict] = []
        processed_edges: Set[tuple] = set()

        for edge in edges:
            source_id = edge.source_id
            target_id = edge.target_id

            if source_id not in id_remap or target_id not in id_remap:
                continue

            new_source = id_remap[source_id]
            new_target = id_remap[target_id]

            if new_source == new_target:
                continue

            edge_key = (new_source, new_target, str(edge.type))
            if edge_key in processed_edges:
                continue

            processed_edges.add(edge_key)

            edge_metadata = edge.relationship_metadata
            context = (
                edge_metadata.get("context")
                if isinstance(edge_metadata, dict)
                else None
            )

            raw_edges.append(
                {
                    "source": str(new_source),
                    "target": str(new_target),
                    "type": str(edge.type),
                    "weight": int(edge.weight or 0),
                    "first_interaction_cfi": edge.first_interaction_cfi,
                    "first_interaction_chapter": edge.first_interaction_chapter,
                    # Source data for per-request relationship description filtering
                    "_context": context,
                    "_relationship_milestones": edge.relationship_milestones,
                }
            )

        return {"entities": raw_entities, "edges": raw_edges}

    def _create_raw_entity_cache(
        self,
        master: Entity,
        descriptions: List[Description],
        hard_mentions_map: Dict[UUID, Set[int]],
        cfi_mentions_map: Dict[UUID, List[str]],
        offset_mentions_map: Dict[UUID, List[int]],
        description_cfi_map: Dict[UUID, str],
        entity_events: List[EntityEvent],
    ) -> dict:
        """
        Build raw cache dict for a single merged entity.
        Includes both computed fields and _raw source data for filtering.
        """
        # ── Mentions & CFI (chapter-independent) ──
        all_mentions: Set[int] = set(hard_mentions_map.get(master.id, set()))

        cfi_list = cfi_mentions_map.get(master.id, [])
        first_mention_cfi: Optional[str] = None
        if cfi_list:
            first_mention_cfi = self._get_earliest_cfi(cfi_list)

        offset_list = offset_mentions_map.get(master.id, [])
        first_mention_offset: Optional[int] = min(offset_list) if offset_list else None

        # ── Notes (all, unfiltered) ──
        notes: List[dict] = []
        for d in descriptions:
            chapter_idx = 0
            if d.chapter:
                chapter_idx = d.chapter.chapter_number

            all_mentions.add(chapter_idx)

            note_cfi = description_cfi_map.get(d.id)
            notes.append(
                {
                    "text": d.content,
                    "chapter_index": chapter_idx,
                    "cfi": note_cfi,
                    "is_spoiler": False,
                    "type": d.type.value if d.type else "UNKNOWN",
                }
            )

        notes.sort(key=lambda x: x["chapter_index"])

        final_mentions = sorted(list(all_mentions))
        if not final_mentions:
            logger.warning(
                f"[EntityService] EMPTY MENTIONS for entity '{master.name}' (id={master.id}): "
                f"hard_mentions={len(hard_mentions_map.get(master.id, set()))}, "
                f"soft_links={len(descriptions)}"
            )

        # ── All events (unfiltered, for per-request filtering) ──
        all_events = [
            {
                "chapter_number": e.chapter_number,
                "event_action": e.event_action,
                "event_inner_state": e.event_inner_state,
            }
            for e in sorted(entity_events, key=lambda e: e.chapter_number)
        ]

        # ── All aliases from metadata (for current_chapter=None case) ──
        metadata = master.entity_metadata
        all_aliases: List[str] = []
        if metadata and isinstance(metadata, dict):
            all_aliases = metadata.get("aliases", [])

        return {
            # Standard fields (chapter-independent)
            "id": str(master.id),
            "name": master.name,
            "type": master.type,
            "avatar_url": master.master_portrait_url,
            "importance": master.importance or 5,
            "mentions": final_mentions,
            "first_mention_cfi": first_mention_cfi,
            "first_mention_offset": first_mention_offset,
            "first_mention_chapter": master.first_mention_chapter,
            "base_role": master.base_role,
            "notes": notes,
            # Source data for per-request chapter filtering
            "_all_aliases": all_aliases,
            "_aliases_with_reveal": master.aliases_with_reveal or [],
            "_biography_milestones": master.biography_milestones,
            "_raw_visual_summary": master.visual_summary,
            "_all_events": all_events,
        }

    # ──────────────────────────────────────────────────────────────
    # Per-request chapter filtering (dict → Pydantic response)
    # ──────────────────────────────────────────────────────────────

    def _apply_chapter_filter(
        self, raw_data: dict, current_chapter: Optional[int]
    ) -> EntityNetworkResponse:
        """
        Filter cached raw entity data by current chapter.
        Returns clean EntityNetworkResponse (no _raw_* fields).
        """
        entities: Dict[UUID, EntityDetailSchema] = {}
        for eid_str, entity_data in raw_data.get("entities", {}).items():
            eid = UUID(eid_str)
            entities[eid] = self._filter_entity_detail(entity_data, current_chapter)

        edges: List[NetworkEdgeSchema] = []
        for edge_data in raw_data.get("edges", []):
            edges.append(self._filter_edge_detail(edge_data, current_chapter))

        return EntityNetworkResponse(entities=entities, edges=edges)

    def _filter_entity_detail(
        self, data: dict, current_chapter: Optional[int]
    ) -> EntityDetailSchema:
        """Filter a single entity's cached data by chapter."""
        # ── Aliases ──
        if current_chapter is not None:
            aliases = self._filter_aliases_from_raw(
                data.get("_aliases_with_reveal", []), current_chapter
            )
        else:
            aliases = data.get("_all_aliases", [])

        # ── Biography / dynamic_role / visual_summary_clean from milestones ──
        biography: Optional[str] = None
        dynamic_role: Optional[str] = None
        visual_summary_clean: Optional[str] = None
        milestones = data.get("_biography_milestones")
        if milestones and isinstance(milestones, list) and len(milestones) > 0:
            if current_chapter is not None:
                ms = self._get_current_milestone(milestones, current_chapter)
            else:
                ms = max(milestones, key=lambda m: m.get("up_to_chapter", 0))
            if ms:
                biography = ms.get("biography")
                dynamic_role = ms.get("dynamic_role")
                visual_summary_clean = ms.get("visual_summary_clean")

        # ── Events ──
        all_events = data.get("_all_events", [])
        if current_chapter is not None:
            filtered_events = [
                e for e in all_events if e["chapter_number"] <= current_chapter
            ]
        else:
            filtered_events = all_events

        events_schema = [
            EntityEventSchema(**e)
            for e in sorted(filtered_events, key=lambda e: e["chapter_number"])
        ]

        # ── Visual summary ──
        raw_vs = data.get("_raw_visual_summary")
        visual_summary = self._process_visual_summary(raw_vs, current_chapter)

        # ── Notes: mark future chapters as spoilers ──
        raw_notes = data.get("notes", [])
        notes_schema: List[EntityNoteSchema] = []
        for note in raw_notes:
            is_spoiler = (
                current_chapter is not None
                and note.get("chapter_index", 0) > current_chapter
            )
            notes_schema.append(
                EntityNoteSchema(
                    text=note["text"],
                    chapter_index=note["chapter_index"],
                    cfi=note.get("cfi"),
                    is_spoiler=is_spoiler,
                    type=note["type"],
                )
            )

        return EntityDetailSchema(
            id=UUID(data["id"]) if isinstance(data["id"], str) else data["id"],
            name=data["name"],
            type=data["type"],
            avatar_url=data.get("avatar_url"),
            visual_summary=visual_summary,
            importance=data.get("importance", 5),
            mentions=data.get("mentions", []),
            first_mention_cfi=data.get("first_mention_cfi"),
            first_mention_offset=data.get("first_mention_offset"),
            first_mention_chapter=data.get("first_mention_chapter"),
            aliases=aliases,
            notes=notes_schema,
            biography=biography,
            base_role=data.get("base_role"),
            dynamic_role=dynamic_role,
            visual_summary_clean=visual_summary_clean,
            events=events_schema,
        )

    @staticmethod
    def _filter_edge_detail(
        data: dict, current_chapter: Optional[int]
    ) -> NetworkEdgeSchema:
        """Filter a single edge's cached data by chapter."""
        # Use relationship milestones for description if available
        description = data.get("_context")
        milestones = data.get("_relationship_milestones")
        if current_chapter is not None and milestones:
            ms = EntityService._get_current_relationship_milestone(
                milestones, current_chapter
            )
            if ms:
                description = ms.get("description", description)

        return NetworkEdgeSchema(
            source=UUID(data["source"])
            if isinstance(data["source"], str)
            else data["source"],
            target=UUID(data["target"])
            if isinstance(data["target"], str)
            else data["target"],
            type=data["type"],
            weight=data.get("weight", 0),
            description=description,
            first_interaction_cfi=data.get("first_interaction_cfi"),
            first_interaction_chapter=data.get("first_interaction_chapter"),
        )


def get_entity_service(
    db: AsyncSession = Depends(get_database_session),
) -> EntityService:
    return EntityService(db)
