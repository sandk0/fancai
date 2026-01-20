"""
Модель отношений между сущностями (Граф Знаний).
"""

from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    Float,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from ..core.database import Base

class EntityRelationship(Base):
    """
    Связь между двумя сущностями (Ребро графа).
    
    Attributes:
        source_id: От кого (Субъект)
        target_id: К кому (Объект)
        relation_type: Тип связи (FRIEND, ENEMY, LOCATED_IN, OWNS)
        weight: Вес связи (0.0 - 1.0) на основе частоты взаимодействий
    """
    __tablename__ = "entity_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    source_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    
    relation_type = Column(String(50), nullable=False) # e.g. "FRIEND", "PARENT", "LOCATED_IN"
    weight = Column(Float, default=1.0, nullable=False) # Strength of relationship
    
    relationship_metadata = Column(JSONB, default={}, nullable=False) # Context, evidence snippets

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    source = relationship("Entity", foreign_keys=[source_id], backref="outgoing_relationships", lazy="raise")
    target = relationship("Entity", foreign_keys=[target_id], backref="incoming_relationships", lazy="raise")

    def __repr__(self):
        return f"<EntityRelationship({self.source_id} -> {self.relation_type} -> {self.target_id})>"
