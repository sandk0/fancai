"""
Модель описаний для генерации изображений в fancai.

Содержит извлеченные NLP-парсером описания из текста книг.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import (
    Integer,
    String,
    Text,
    ForeignKey,
    Float,
    DateTime,
    Enum as SQLEnum,
    func,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column

from ..core.database import Base

if TYPE_CHECKING:
    from .chapter import Chapter
    from .image import GeneratedImage
    from .description_entity import DescriptionEntity


# NOTE: PostgreSQL descriptiontype enum contains a zombie 'OBJECT' value alongside
# lowercase 'object'. PostgreSQL does not support DROP VALUE for enums, so 'OBJECT'
# cannot be removed without recreating the type (risky on production). All rows use
# lowercase 'object'; the zombie is harmless. See: audit report #5 (2026-02-25).
class DescriptionType(enum.StrEnum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"

    @classmethod
    def _missing_(cls, value: object) -> "DescriptionType | None":
        """Case-insensitive lookup для backward compat с Celery tasks."""
        if isinstance(value, str):
            lower = value.lower()
            for member in cls:
                if member.value == lower:
                    return member
        return None


class Description(Base):
    __tablename__ = "descriptions"
    __table_args__ = (
        Index("idx_descriptions_chapter_position", "chapter_id", "position_in_chapter"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )
    chapter_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("chapters.id"), nullable=False, index=True
    )

    type: Mapped[DescriptionType] = mapped_column(
        SQLEnum(DescriptionType, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)

    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_in_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    is_suitable_for_generation: Mapped[bool] = mapped_column(
        default=True, nullable=False
    )
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    emotional_tone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    complexity_level: Mapped[str | None] = mapped_column(String(20), nullable=True)

    image_generated: Mapped[bool] = mapped_column(default=False, nullable=False)
    generation_requested: Mapped[bool] = mapped_column(default=False, nullable=False)

    extraction_source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="llm",
        index=True,
        comment="Source: 'llm'=OpenRouter LLM, 'gliner'=local GLiNER2, 'hybrid'=combined",
    )
    pipeline_version: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
        comment="Pipeline version: null=legacy LLM, 'hybrid_v1'=GLiNER2+classifier",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    chapter: Mapped["Chapter"] = relationship(
        "Chapter", back_populates="descriptions", lazy="raise"
    )
    generated_images: Mapped[list["GeneratedImage"]] = relationship(
        "GeneratedImage",
        back_populates="description",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    linked_entities: Mapped[list["DescriptionEntity"]] = relationship(
        "DescriptionEntity",
        back_populates="description",
        cascade="all, delete-orphan",
        lazy="raise",
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
