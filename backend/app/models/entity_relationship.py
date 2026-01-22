"""
Модель связей между сущностями (Knowledge Graph Edges).
"""

from sqlalchemy import (
    Column,
    String,
    Integer,
    ForeignKey,
    DateTime,
    Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from ..core.database import Base

class EntityRelationship(Base):
    """
    Связь графа (Adjacency List Pattern).
    
    Attributes:
        source_id: ID сущности-источника
        target_id: ID сущности-цели
        type: Тип связи (KINSHIP, ALLY, ENEMY, etc.)
        weight: Вес связи (-100..100)
        relationship_metadata: JSON с контекстом (почему они связаны)
    """
    __tablename__ = "entity_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    source_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    
    type = Column(String(50), nullable=False) # KINSHIP, ALLY, ENEMY
    weight = Column(Integer, default=0) # -100 (Enemy) to +100 (Soulmate)
    
    relationship_metadata = Column(JSONB, default={}, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    source = relationship("Entity", foreign_keys=[source_id], backref="outgoing_relations")
    target = relationship("Entity", foreign_keys=[target_id], backref="incoming_relations")

    # Composite Index for fast lookup of "All friends of X"
    __table_args__ = (
        Index('idx_source_type', 'source_id', 'type'),
    )

    def __repr__(self):
        return f"<EntityRelationship({self.source_id} -> {self.target_id} [{self.type}])>"
