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
    chapter_index: int  # ! Ключевое поле: 0-based index или номер главы
    is_spoiler: bool = False
    type: str # CHARACTER, ACTION, LOCATION, etc. (DescriptionType value)

class EntityDetailSchema(BaseModel):
    """
    Детальная информация о сущности (смерженная).
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str              # Основное (нормализованное) имя
    type: str              # CHARACTER / LOCATION / OBJECT
    avatar_url: Optional[str] = None
    visual_summary: Optional[str] = None
    importance: int = 5    # 1-10
    
    # Спойлер-защита
    mentions: List[int] = [] # Список номеров глав, где сущность упоминается
    
    # Собранные описания из всех дублей
    notes: List[EntityNoteSchema] = []

class NetworkEdgeSchema(BaseModel):
    """
    Связь между сущностями (ребро графа).
    """
    model_config = ConfigDict(from_attributes=True)

    source: UUID
    target: UUID
    type: str              # KINSHIP, ALLY, ENEMY
    weight: int = 0
    description: Optional[str] = None # Контекст связи

class EntityNetworkResponse(BaseModel):
    """
    Полный граф сущностей книги.
    """
    model_config = ConfigDict(from_attributes=True)

    entities: Dict[UUID, EntityDetailSchema] # Key = Entity ID
    edges: List[NetworkEdgeSchema]
