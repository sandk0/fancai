import logging
import re
from typing import List, Dict, Optional, Tuple, Set
from uuid import UUID
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

from app.models.entity import Entity, EntityType
from app.models.entity_relationship import EntityRelationship
from app.models.description import Description, DescriptionType
from app.models.chapter import Chapter
from app.schemas.responses.entities import (
    EntityNetworkResponse,
    EntityDetailSchema,
    NetworkEdgeSchema,
    EntityNoteSchema
)
from app.core.cache import cache_manager, CACHE_TTL

logger = logging.getLogger(__name__)

class EntityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @lru_cache(maxsize=1000)
    def _normalize_name(self, name: str) -> str:
        """
        Нормализует имя для дедупликации.
        Пример: "Геральт ", "геральт", "ГЕРАЛЬТ" -> "геральт"
        """
        if not name:
            return ""
        return name.lower().strip().replace("ё", "е")

    async def get_book_entity_network(self, book_id: UUID) -> EntityNetworkResponse:
        """
        Возвращает граф сущностей книги с примененной дедупликацией (Soft Merge).
        Результат кэшируется.
        """
        # 1. Проверяем кэш
        cache_key = f"book:{book_id}:entity_network_v2" # v2 cache key for new logic
        cached_data = await cache_manager.get(cache_key)
        if cached_data:
            return EntityNetworkResponse.model_validate(cached_data)

        # 2. Загружаем Сущности
        q_entities = select(Entity).where(Entity.book_id == book_id)
        entities_res = await self.db.execute(q_entities)
        all_entities = entities_res.scalars().all()

        # 3. Загружаем Описания (для сборки биографии)
        # Так как прямой связи нет, грузим все описания книги и линкуем вручную
        q_descriptions = (
            select(Description)
            .join(Chapter)
            .where(Chapter.book_id == book_id)
            .options(joinedload(Description.chapter))
        )
        desc_res = await self.db.execute(q_descriptions)
        all_descriptions = desc_res.scalars().all()

        # 4. Загружаем Связи
        entity_ids = [e.id for e in all_entities]
        if not entity_ids:
            return EntityNetworkResponse(entities={}, edges=[])

        q_edges = select(EntityRelationship).where(
            EntityRelationship.source_id.in_(entity_ids)
        )
        edges_res = await self.db.execute(q_edges)
        all_edges = edges_res.scalars().all()

        # 5. Применяем логику слияния (Soft Merge)
        response = self._build_network_response(all_entities, all_descriptions, all_edges)

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
        descriptions: List[Description],
        edges: List[EntityRelationship]
    ) -> EntityNetworkResponse:
        """
        Основная логика дедупликации и сборки ответа.
        """
        
        # --- Шаг 0: Подготовка описаний (Mapping: Entity Name -> List[Description]) ---
        # Это "Soft Link" - связывание по имени, так как нет внешнего ключа
        descriptions_map: Dict[str, List[Description]] = {}
        
        import json
        for d in descriptions:
            if not d.entities_mentioned:
                continue
                
            try:
                # entities_mentioned хранится как JSON строка списка имен ["Геральт", "Йен"]
                # ИЛИ как CSV строка "Геральт,Йен" (legacy/buggy format)
                mentioned_names = []
                
                # 1. Попытка распарсить как JSON
                try:
                    parsed = json.loads(d.entities_mentioned)
                    if isinstance(parsed, list):
                        mentioned_names = parsed
                    elif isinstance(parsed, dict):
                        # Handle rare case of {"name": "..."} dicts
                        mentioned_names = [parsed.get("name")] if parsed.get("name") else []
                except json.JSONDecodeError:
                    # 2. Fallback: Парсинг как CSV (если JSON не валиден)
                    if d.entities_mentioned:
                        mentioned_names = [x.strip() for x in d.entities_mentioned.split(",") if x.strip()]

                # 3. Обработка имен
                for name in mentioned_names:
                    if isinstance(name, str):
                        norm = self._normalize_name(name)
                        if norm:
                            if norm not in descriptions_map:
                                descriptions_map[norm] = []
                            descriptions_map[norm].append(d)
            except Exception as e:
                logger.warning(f"Failed to parse mentions for desc {d.id}: {e}")
                continue

        # --- Шаг 1: Группировка дубликатов сущностей ---
        groups: Dict[str, List[Entity]] = {}
        
        for e in entities:
            norm_name = self._normalize_name(e.name)
            if norm_name not in groups:
                groups[norm_name] = []
            groups[norm_name].append(e)

        # --- Шаг 2: Выбор Master Entity и обогащение данными ---
        id_remap: Dict[UUID, UUID] = {}
        master_entities: Dict[UUID, EntityDetailSchema] = {}

        for norm_name, group in groups.items():
            # Выбор мастера
            master = max(group, key=lambda x: (
                100 if x.visual_summary else 0,
                x.importance or 0
            ))
            
            # Получаем связанные описания по нормализованному имени
            related_descriptions = descriptions_map.get(norm_name, [])
            
            # Собираем данные
            merged_detail = self._create_merged_detail(master, related_descriptions)
            master_entities[master.id] = merged_detail
            
            # Ремаппинг ID
            for e in group:
                id_remap[e.id] = master.id

        # --- Шаг 3: Пересборка связей ---
        final_edges: List[NetworkEdgeSchema] = []
        processed_edges = set()

        for edge in edges:
            if edge.source_id not in id_remap or edge.target_id not in id_remap:
                continue

            new_source = id_remap[edge.source_id]
            new_target = id_remap[edge.target_id]

            if new_source == new_target:
                continue

            edge_key = (new_source, new_target, edge.type)
            if edge_key in processed_edges:
                continue
            
            processed_edges.add(edge_key)

            final_edges.append(NetworkEdgeSchema(
                source=new_source,
                target=new_target,
                type=edge.type,
                weight=edge.weight or 0,
                description=edge.relationship_metadata.get("context")
            ))

        return EntityNetworkResponse(
            entities=master_entities,
            edges=final_edges
        )

    def _create_merged_detail(self, master: Entity, descriptions: List[Description]) -> EntityDetailSchema:
        """
        Создает EntityDetailSchema из мастера и списка описаний.
        """
        all_notes: List[EntityNoteSchema] = []
        all_mentions: Set[int] = set()

        for d in descriptions:
            chapter_idx = 0
            if d.chapter:
                chapter_idx = d.chapter.chapter_number
            
            all_mentions.add(chapter_idx)

            all_notes.append(EntityNoteSchema(
                text=d.content,
                chapter_index=chapter_idx,
                is_spoiler=False,
                type=d.type.value if d.type else "UNKNOWN"
            ))

        all_notes.sort(key=lambda x: x.chapter_index)
        
        return EntityDetailSchema(
            id=master.id,
            name=master.name,
            type=master.type,
            avatar_url=master.master_portrait_url,
            visual_summary=master.visual_summary,
            importance=master.importance or 5,
            mentions=sorted(list(all_mentions)),
            notes=all_notes
        )

from fastapi import Depends
from app.core.database import get_database_session

# Dependency Injection Factory
def get_entity_service(db: AsyncSession = Depends(get_database_session)) -> EntityService:
    return EntityService(db)
