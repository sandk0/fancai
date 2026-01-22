"""
Модель универсальной сущности (Персонаж, Локация, Объект).
"""

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Text,
    ForeignKey,
    Integer,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from ..core.database import Base

class EntityType(enum.Enum):
    """Типы сущностей для AI анализа."""
    CHARACTER = "character"
    LOCATION = "location"
    OBJECT = "object"

class Entity(Base):
    """
    Универсальная сущность (Персонаж, Локация, Предмет).
    
    Attributes:
        id: Уникальный ID
        book_id: Ссылка на книгу
        type: Тип сущности (CHARACTER, LOCATION, OBJECT)
        name: Имя или название
        visual_summary: Визуальное описание для генерации (промпт)
        master_portrait_url: Ссылка на эталонное изображение (Reference Image)
        seed: Фиксированный сид для генерации (Consistency Seed)
        meta: Дополнительные метаданные (alias names, role, appearance_count)
    """
    __tablename__ = "entities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    
    type = Column(String(50), nullable=False, index=True)  # EntityType value
    name = Column(String(255), nullable=False, index=True)
    visual_summary = Column(Text, nullable=True)  # Core visual description
    
    # Consistency Assets
    master_portrait_url = Column(String(1000), nullable=True)
    seed = Column(Integer, nullable=True)
    
    # Priority & Filtering (v16)
    importance = Column(Integer, default=5, nullable=True) # 1-10 scale
    linked_entity_ids = Column(JSONB, default=[], nullable=True) # List of related entity IDs for assets
    
    # Metadata (aliases, detailed traits, frequency)
    entity_metadata = Column(JSONB, default={}, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    book = relationship("Book", backref="entities", lazy="raise")
    
    # Relationships for graph (defined in EntityRelationship)
    # outgoing_relations = relationship("EntityRelationship", foreign_keys="EntityRelationship.source_id",back_populates="source")
    # incoming_relations = relationship("EntityRelationship", foreign_keys="EntityRelationship.target_id", back_populates="target")

    def __repr__(self):
        return f"<Entity(id={self.id}, name='{self.name}', type='{self.type}')>"
