from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional
from uuid import UUID


class EntityNoteSchema(BaseModel):
    """
    Описание или упоминание сущности.
    Содержит номер главы для фильтрации спойлеров на фронтенде.
    """

    model_config = ConfigDict(from_attributes=True)

    text: str
    chapter_index: int
    cfi: Optional[str] = None
    is_spoiler: bool = False
    type: str


class EntityEventSchema(BaseModel):
    """Событие сущности в конкретной главе."""

    model_config = ConfigDict(from_attributes=True)

    chapter_number: int
    event_action: str
    event_inner_state: Optional[str] = None


class EntityDetailSchema(BaseModel):
    """
    Детальная информация о сущности (смерженная).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str
    avatar_url: Optional[str] = None
    visual_summary: Optional[str] = None
    importance: int = 5

    mentions: List[int] = []
    first_mention_cfi: Optional[str] = None
    first_mention_offset: Optional[int] = None
    first_mention_chapter: Optional[int] = None

    aliases: List[str] = []

    notes: List[EntityNoteSchema] = []

    # Entity Wiki fields (from milestones)
    biography: Optional[str] = None
    base_role: Optional[str] = None
    dynamic_role: Optional[str] = None
    visual_summary_clean: Optional[str] = None
    events: List[EntityEventSchema] = []


class NetworkEdgeSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: UUID
    target: UUID
    type: str
    weight: int = 0
    description: Optional[str] = None
    first_interaction_cfi: Optional[str] = None
    first_interaction_chapter: Optional[int] = None


class EntityNetworkResponse(BaseModel):
    """
    Полный граф сущностей книги.
    """

    model_config = ConfigDict(from_attributes=True)

    entities: Dict[UUID, EntityDetailSchema]  # Key = Entity ID
    edges: List[NetworkEdgeSchema]


class RecapEntitySchema(BaseModel):
    """Entity в recap — краткая карточка для 'Ранее в книге'."""

    id: UUID
    name: str
    avatar_url: Optional[str] = None
    dynamic_role: Optional[str] = None
    last_event: Optional[EntityEventSchema] = None


class RecapResponse(BaseModel):
    """Ответ recap endpoint — топ entities с последним событием."""

    entities: List[RecapEntitySchema]
