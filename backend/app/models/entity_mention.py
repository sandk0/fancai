"""
Модель упоминания сущности в тексте.
"""

from sqlalchemy import Column, Integer, String, Text, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy import DateTime
import uuid

from ..core.database import Base

class EntityMention(Base):
    """
    Упоминание сущности в конкретной главе.
    
    Связывает Chapter и Entity (Many-to-Many with attributes).
    Позволяет точно знать, ГДЕ и КАК упоминался персонаж.
    """
    __tablename__ = "entity_mentions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    chapter_id = Column(UUID(as_uuid=True), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Контекст упоминания
    mention_text = Column(String(500), nullable=False) # Текст, который нашли (например "Геральт" или "Белый Волк")
    context = Column(Text, nullable=True) # Окружающий текст для контекста
    
    # Позиция в тексте (для подсветки/навигации)
    start_index = Column(Integer, nullable=True) 
    end_index = Column(Integer, nullable=True) 
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    chapter = relationship("Chapter", back_populates="mentions")
    entity = relationship("Entity", back_populates="mentions")

    def __repr__(self):
        return f"<EntityMention(chapter={self.chapter_id}, entity={self.entity_id}, text='{self.mention_text}')>"
