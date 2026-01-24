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
        cache_key = f"book:{book_id}:entity_network"
        cached_data = await cache_manager.get(cache_key)
        if cached_data:
            # Pydantic v2: model_validate handles dict -> model conversion
            return EntityNetworkResponse.model_validate(cached_data)

        # 2. Загружаем данные из БД (Optimized Eager Loading)
        # Сущности + Описания + Главы (для chapter index)
        q_entities = (
            select(Entity)
            .where(Entity.book_id == book_id)
            .options(
                # selectinload(Entity.descriptions).joinedload(Description.chapter)
            )
        )
        entities_res = await self.db.execute(q_entities)
        all_entities = entities_res.scalars().all()

        # Связи
        entity_ids = [e.id for e in all_entities]
        if not entity_ids:
            return EntityNetworkResponse(entities={}, edges=[])

        q_edges = select(EntityRelationship).where(
            EntityRelationship.source_id.in_(entity_ids)
        )
        edges_res = await self.db.execute(q_edges)
        all_edges = edges_res.scalars().all()

        # 3. Применяем логику слияния (Soft Merge)
        response = self._build_network_response(all_entities, all_edges)

        # 4. Сохраняем в кэш (сериализуем через model_dump)
        await cache_manager.set(
            cache_key, 
            response.model_dump(mode='json'), 
            ttl=3600 # 1 час
        )

        return response

    def _build_network_response(
        self, 
        entities: List[Entity], 
        edges: List[EntityRelationship]
    ) -> EntityNetworkResponse:
        """
        Основная логика дедупликации и сборки ответа.
        """
        
        # --- Шаг 1: Группировка дубликатов ---
        groups: Dict[str, List[Entity]] = {}
        
        for e in entities:
            norm_name = self._normalize_name(e.name)
            if norm_name not in groups:
                groups[norm_name] = []
            groups[norm_name].append(e)

        # --- Шаг 2: Выбор Master Entity в каждой группе ---
        # Map: Old ID -> Master ID
        id_remap: Dict[UUID, UUID] = {}
        master_entities: Dict[UUID, EntityDetailSchema] = {}

        for norm_name, group in groups.items():
            # Эвристика выбора мастера:
            # 1. Есть visual_summary (значит уже генерировали арт)
            # 2. Максимальный importance
            # 3. Самое длинное имя (обычно "Геральт из Ривии" > "Геральт") - спорно, оставим importance
            
            master = max(group, key=lambda x: (
                100 if x.visual_summary else 0,
                x.importance or 0,
                len(x.descriptions)
            ))
            
            # Собираем данные со всех дублей в мастера
            merged_detail = self._merge_group_to_master(master, group)
            master_entities[master.id] = merged_detail
            
            # Запоминаем ремаппинг
            for e in group:
                id_remap[e.id] = master.id

        # --- Шаг 3: Пересборка связей (Edges) с учетом ремаппинга ---
        final_edges: List[NetworkEdgeSchema] = []
        processed_edges = set() # (source, target, type) для исключения дублей ребер

        for edge in edges:
            # Если source или target были удалены (не попали в выборку) - пропускаем
            if edge.source_id not in id_remap or edge.target_id not in id_remap:
                continue

            new_source = id_remap[edge.source_id]
            new_target = id_remap[edge.target_id]

            # Исключаем петли (связь сама с собой после мержа)
            if new_source == new_target:
                continue

            edge_key = (new_source, new_target, edge.type)
            if edge_key in processed_edges:
                continue # Уже есть такая связь между мастерами
            
            processed_edges.add(edge_key)

            final_edges.append(NetworkEdgeSchema(
                source=new_source,
                target=new_target,
                type=edge.type,
                weight=edge.weight or 0,
                description=edge.relationship_metadata.get("context") # Берем контекст
            ))

        return EntityNetworkResponse(
            entities=master_entities,
            edges=final_edges
        )

    def _merge_group_to_master(self, master: Entity, group: List[Entity]) -> EntityDetailSchema:
        """
        Собирает данные из списка сущностей в одну схему.
        """
        all_notes: List[EntityNoteSchema] = []
        all_mentions: Set[int] = set()

        for e in group:
            # Собираем описания (Temporarily disabled: No DB relationship yet)
            # for d in e.descriptions:
            #     # Определяем номер главы
            #     chapter_idx = 0
            #     if d.chapter:
            #         chapter_idx = d.chapter.chapter_number
            #     
            #     # Добавляем в mentions
            #     all_mentions.add(chapter_idx)
            #
            #     all_notes.append(EntityNoteSchema(
            #         text=d.content,
            #         chapter_index=chapter_idx,
            #         is_spoiler=False, # Пока логика спойлеров на фронте
            #         type=d.type.value if d.type else "UNKNOWN"
            #     ))

        # Сортируем описания по главам
        all_notes.sort(key=lambda x: x.chapter_index)
        
        return EntityDetailSchema(
            id=master.id,
            name=master.name,
            type=master.type, # TODO: Enum handling string conversion
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
