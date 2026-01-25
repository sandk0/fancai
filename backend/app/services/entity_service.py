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
from app.schemas.responses.entities import (
    EntityNetworkResponse,
    EntityDetailSchema,
    NetworkEdgeSchema,
    EntityNoteSchema
)
from app.core.cache import cache_manager
from app.core.database import get_database_session

logger = logging.getLogger(__name__)


class EntityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @lru_cache(maxsize=1000)
    def _normalize_name(self, name: str) -> str:
        if not name:
            return ""
        return name.lower().strip().replace("ё", "е")

    def _get_earliest_cfi(self, cfi_list: List[str]) -> Optional[str]:
        if not cfi_list:
            return None
        
        def parse_cfi_for_sort(cfi: str) -> tuple:
            match = re.match(r'^epubcfi\((.+)\)$', cfi)
            if not match:
                return (float('inf'),)
            
            inner = match.group(1)
            parts = inner.split('!')
            
            numbers = []
            for part in parts:
                segments = part.split('/')
                for seg in segments:
                    num_match = re.match(r'^(\d+)', seg)
                    if num_match:
                        numbers.append(int(num_match.group(1)))
            
            offset_match = re.search(r':(\d+)', inner)
            if offset_match:
                numbers.append(int(offset_match.group(1)))
            
            return tuple(numbers) if numbers else (float('inf'),)
        
        return min(cfi_list, key=parse_cfi_for_sort)

    async def get_book_entity_network(self, book_id: UUID) -> EntityNetworkResponse:
        """
        Возвращает граф сущностей книги с примененной дедупликацией (Soft Merge).
        Результат кэшируется.
        """
        logger.info(f"[EntityService] Loading entity network for book_id={book_id}")
        
        # 1. Проверяем кэш
        cache_key = f"book:{book_id}:entity_network_v3" # v3 cache key for Hard Links
        cached_data = await cache_manager.get(cache_key)
        if cached_data:
            logger.debug(f"[EntityService] Cache HIT for book_id={book_id}")
            return EntityNetworkResponse.model_validate(cached_data)

        logger.debug(f"[EntityService] Cache MISS for book_id={book_id}, loading from DB")
        
        # 2. Загружаем Сущности
        q_entities = select(Entity).where(Entity.book_id == book_id)
        entities_res = await self.db.execute(q_entities)
        all_entities = entities_res.scalars().all()
        logger.info(f"[EntityService] Loaded {len(all_entities)} entities for book_id={book_id}")

        q_descriptions = (
            select(Description)
            .join(Chapter)
            .where(Chapter.book_id == book_id)
            .options(joinedload(Description.chapter))
        )
        desc_res = await self.db.execute(q_descriptions)
        all_descriptions = desc_res.scalars().all()
        descriptions_by_id = {d.id: d for d in all_descriptions}
        logger.info(f"[EntityService] Loaded {len(all_descriptions)} descriptions for book_id={book_id}")
        
        q_desc_entities = (
            select(DescriptionEntity.description_id, DescriptionEntity.entity_id)
            .join(Description)
            .join(Chapter)
            .where(Chapter.book_id == book_id)
        )
        desc_entities_res = await self.db.execute(q_desc_entities)
        
        entity_to_descriptions: Dict[UUID, List[Description]] = {}
        for desc_id, entity_id in desc_entities_res.all():
            if entity_id not in entity_to_descriptions:
                entity_to_descriptions[entity_id] = []
            if desc_id in descriptions_by_id:
                entity_to_descriptions[entity_id].append(descriptions_by_id[desc_id])
        
        logger.info(f"[EntityService] Loaded description_entities links for {len(entity_to_descriptions)} entities")
        
        # 3.1. Загружаем Hard Link Mentions с CFI и offset
        q_mentions = (
            select(EntityMention.entity_id, Chapter.chapter_number, EntityMention.mention_cfi, EntityMention.start_index)
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
        logger.info(f"[EntityService] Loaded {mentions_count} hard mentions for {len(hard_mentions_map)} entities")

        # 4. Загружаем Связи
        entity_ids = [e.id for e in all_entities]
        if not entity_ids:
            return EntityNetworkResponse(entities={}, edges=[])

        q_edges = select(EntityRelationship).where(
            EntityRelationship.source_id.in_(entity_ids)
        )
        edges_res = await self.db.execute(q_edges)
        all_edges = edges_res.scalars().all()

        response = self._build_network_response(
            list(all_entities), list(all_edges), hard_mentions_map, cfi_mentions_map, offset_mentions_map, entity_to_descriptions
        )

        # 6. Сохраняем в кэш
        await cache_manager.set(
            cache_key, 
            response.model_dump(mode='json'), 
            ttl=3600 
        )

        return response

    def _build_network_response(
        self, 
        entities: List[Entity], 
        edges: List[EntityRelationship],
        hard_mentions_map: Dict[UUID, Set[int]],
        cfi_mentions_map: Dict[UUID, List[str]],
        offset_mentions_map: Dict[UUID, List[int]],
        entity_to_descriptions: Dict[UUID, List[Description]]
    ) -> EntityNetworkResponse:
        alias_to_canonical: Dict[str, str] = {}
        groups: Dict[str, List[Entity]] = {}
        
        for e in entities:
            norm_name = self._normalize_name(str(e.name))
            
            found_canonical = alias_to_canonical.get(norm_name)
            
            if not found_canonical:
                stored_aliases = []
                metadata = e.entity_metadata
                if metadata and isinstance(metadata, dict):
                    stored_aliases = metadata.get("aliases", [])
                
                for alias in stored_aliases:
                    if isinstance(alias, str):
                        norm_alias = self._normalize_name(alias)
                        if norm_alias in alias_to_canonical:
                            found_canonical = alias_to_canonical[norm_alias]
                            break
            
            canonical = found_canonical if found_canonical else norm_name
            
            alias_to_canonical[norm_name] = canonical
            
            metadata = e.entity_metadata
            if metadata and isinstance(metadata, dict):
                for alias in metadata.get("aliases", []):
                    if isinstance(alias, str):
                        alias_to_canonical[self._normalize_name(alias)] = canonical
            
            if canonical not in groups:
                groups[canonical] = []
            groups[canonical].append(e)

        id_remap: Dict[UUID, UUID] = {}
        master_entities: Dict[UUID, EntityDetailSchema] = {}

        for _norm_name, group in groups.items():
            master = max(group, key=lambda x: (
                100 if x.visual_summary else 0,
                x.importance or 0
            ))
            
            related_descriptions: List[Description] = []
            for entity in group:
                related_descriptions.extend(entity_to_descriptions.get(entity.id, []))
            
            merged_detail = self._create_merged_detail(
                master, related_descriptions, hard_mentions_map, cfi_mentions_map, offset_mentions_map
            )
            master_entities[master.id] = merged_detail
            
            for entity in group:
                id_remap[entity.id] = master.id

        final_edges: List[NetworkEdgeSchema] = []
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
            context = edge_metadata.get("context") if isinstance(edge_metadata, dict) else None

            final_edges.append(NetworkEdgeSchema(
                source=new_source,
                target=new_target,
                type=str(edge.type),
                weight=int(edge.weight or 0),
                description=context
            ))

        return EntityNetworkResponse(
            entities=master_entities,
            edges=final_edges
        )

    def _create_merged_detail(
        self, 
        master: Entity, 
        descriptions: List[Description],
        hard_mentions_map: Dict[UUID, Set[int]],
        cfi_mentions_map: Dict[UUID, List[str]],
        offset_mentions_map: Dict[UUID, List[int]]
    ) -> EntityDetailSchema:
        all_notes: List[EntityNoteSchema] = []
        all_mentions: Set[int] = set(hard_mentions_map.get(master.id, set()))
        
        cfi_list = cfi_mentions_map.get(master.id, [])
        first_mention_cfi: Optional[str] = None
        if cfi_list:
            first_mention_cfi = self._get_earliest_cfi(cfi_list)
        
        offset_list = offset_mentions_map.get(master.id, [])
        first_mention_offset: Optional[int] = min(offset_list) if offset_list else None

        for d in descriptions:
            chapter_idx = 0
            if d.chapter:
                chapter_idx = d.chapter.chapter_number
            
            all_mentions.add(chapter_idx)

            all_notes.append(EntityNoteSchema(
                text=d.content,
                chapter_index=chapter_idx,
                cfi=None,
                is_spoiler=False,
                type=d.type.value if d.type else "UNKNOWN"
            ))

        all_notes.sort(key=lambda x: x.chapter_index)
        
        final_mentions = sorted(list(all_mentions))
        if not final_mentions:
            logger.warning(
                f"[EntityService] EMPTY MENTIONS for entity '{master.name}' (id={master.id}): "
                f"hard_mentions={len(hard_mentions_map.get(master.id, set()))}, "
                f"soft_links={len(descriptions)}"
            )
        
        return EntityDetailSchema(
            id=master.id,
            name=master.name,
            type=master.type,
            avatar_url=master.master_portrait_url,
            visual_summary=master.visual_summary,
            importance=master.importance or 5,
            mentions=final_mentions,
            first_mention_cfi=first_mention_cfi,
            first_mention_offset=first_mention_offset,
            notes=all_notes
        )


def get_entity_service(db: AsyncSession = Depends(get_database_session)) -> EntityService:
    return EntityService(db)
