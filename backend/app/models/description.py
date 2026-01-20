"""
Модель описаний для генерации изображений в fancai.

Содержит извлеченные NLP-парсером описания из текста книг.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    Text,
    ForeignKey,
    Float,
    Enum as SQLEnum,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from ..core.database import Base


class DescriptionType(enum.Enum):
    """
    Типы описаний с приоритетами согласно техническому заданию.

    Приоритеты:
    - LOCATION: 75% (высший приоритет)
    - CHARACTER: 60%
    - ATMOSPHERE: 45%
    - OBJECT: 40%
    - ACTION: 30% (низший приоритет)
    """

    LOCATION = "LOCATION"  # Локации (интерьеры, экстерьеры, природа)
    CHARACTER = "CHARACTER"  # Персонажи (внешность, одежда, эмоции)
    ATMOSPHERE = "ATMOSPHERE"  # Атмосфера (время суток, погода, настроение)
    OBJECT = "OBJECT"  # Объекты (оружие, артефакты, транспорт)
    ACTION = "ACTION"  # Действия/сцены (битвы, церемонии, события)


class Description(Base):
    """
    Модель описания, извлеченного из текста книги.

    Attributes:
        id: Уникальный идентификатор описания
        chapter_id: ID главы (внешний ключ)
        type: Тип описания (location, character, atmosphere, object, action)
        content: Текст описания
        context: Контекст вокруг описания (для лучшего понимания)
        confidence_score: Уверенность NLP-парсера (0.0-1.0)
        position_in_chapter: Позиция описания в главе
        word_count: Количество слов в описании
        is_suitable_for_generation: Подходит ли для генерации изображений
        priority_score: Приоритетный счет для генерации
        entities_mentioned: Упомянутые сущности (персонажи, места)
    """

    __tablename__ = "descriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    chapter_id = Column(
        UUID(as_uuid=True), ForeignKey("chapters.id"), nullable=False, index=True
    )

    # Основная информация
    type = Column(SQLEnum(DescriptionType), nullable=False, index=True)
    content = Column(Text, nullable=False)
    context = Column(Text, nullable=True)  # Контекст вокруг описания

    # Метрики парсинга
    confidence_score = Column(Float, nullable=False, default=0.0)  # 0.0-1.0
    position_in_chapter = Column(Integer, nullable=False)  # Позиция в тексте главы
    word_count = Column(Integer, nullable=False, default=0)

    # Оценка для генерации
    is_suitable_for_generation = Column(Boolean, default=True, nullable=False)
    priority_score = Column(Float, nullable=False, default=0.0)  # Расчетный приоритет

    # NLP анализ
    entities_mentioned = Column(Text, nullable=True)  # JSON список сущностей
    emotional_tone = Column(String(50), nullable=True)  # positive, negative, neutral
    complexity_level = Column(String(20), nullable=True)  # simple, medium, complex

    # Статус генерации изображения
    image_generated = Column(Boolean, default=False, nullable=False)
    generation_requested = Column(Boolean, default=False, nullable=False)

    # Временные метки
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    chapter = relationship("Chapter", back_populates="descriptions", lazy="raise")
    generated_images = relationship(
        "GeneratedImage", back_populates="description", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        type_val = self.type.value if self.type else "unknown"
        return f"<Description(id={self.id}, type={type_val}, confidence={self.confidence_score:.2f})>"

    def get_type_priority(self) -> int:
        """
        Возвращает приоритет типа описания согласно техническому заданию.

        Returns:
            Приоритет от 30 до 75
        """
        if not self.type:
            return 30

        priorities = {
            DescriptionType.LOCATION: 75,
            DescriptionType.CHARACTER: 60,
            DescriptionType.ATMOSPHERE: 45,
            DescriptionType.OBJECT: 40,
            DescriptionType.ACTION: 30,
        }
        return priorities.get(self.type, 30)

    def calculate_priority_score(self) -> float:
        """
        Рассчитывает общий приоритетный счет для генерации изображения.

        Учитывает:
        - Тип описания (приоритет)
        - Уверенность парсера
        - Длину описания
        - Подходит ли для генерации

        Returns:
            Приоритетный счет от 0.0 до 100.0
        """
        if not self.is_suitable_for_generation:
            return 0.0

        type_priority = self.get_type_priority()
        confidence_weight = float(self.confidence_score or 0) * 20  # 0-20 points

        # Бонус за оптимальную длину (15-300 символов)
        length_score: float = 0
        content_length = len(self.content or "")
        if 15 <= content_length <= 300:
            length_score = 15
        elif content_length < 15:
            length_score = float(max(0, content_length - 5))
        else:
            length_score = max(0.0, 15.0 - (content_length - 300) / 50.0)

        return min(100.0, type_priority + confidence_weight + length_score)

    def get_excerpt(self, max_length: int = 100) -> str:
        """
        Получает отрывок описания для предварительного просмотра.

        Args:
            max_length: Максимальная длина отрывка

        Returns:
            Отрывок описания
        """
        content = self.content or ""
        if len(content) <= max_length:
            return content

        excerpt_parts = content[:max_length].rsplit(" ", 1)
        return excerpt_parts[0] + "..." if excerpt_parts else ""
