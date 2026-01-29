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
    
    notes: List[EntityNoteSchema] = []

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

    entities: Dict[UUID, EntityDetailSchema] # Key = Entity ID
    edges: List[NetworkEdgeSchema]
