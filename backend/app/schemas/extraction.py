# backend/app/schemas/extraction.py
"""Общие dataclass'ы для Gemini, Modal и NER пайплайнов."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from app.models.description import DescriptionType


@dataclass
class ExtractedEntity:
    """Извлеченная сущность (Персонаж, Локация, Предмет)."""

    name: str
    type: str  # character, location, object
    visual_summary: str
    aliases: List[str] = field(default_factory=list)
    confidence: float = 0.0
    importance: int = 0
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None


@dataclass
class ExtractedRelationship:
    """Связь между сущностями."""

    source: str
    target: str
    type: str
    weight: float
    context: str = ""


@dataclass
class ExtractedDescription:
    """Извлеченное описание из LLM."""

    content: str
    description_type: DescriptionType
    confidence: float
    entities: List[Dict[str, Any]] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    position: int = 0
    source_span: Tuple[int, int] = (0, 0)

    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в формат Multi-NLP системы."""
        entity_names = []
        for e in self.entities:
            if isinstance(e, dict):
                entity_names.append(e.get("name", ""))
            elif isinstance(e, str):
                entity_names.append(e)
            else:
                entity_names.append(str(e))
        return {
            "content": self.content,
            "type": self.description_type.value,
            "confidence_score": self.confidence,
            "priority_score": self._calculate_priority(),
            "source": "gemini_direct",
            "position": self.position,
            "word_count": len(self.content.split()),
            "entities_mentioned": entity_names,
            "metadata": {
                "llm_extracted": True,
                "entities": self.entities,
                "attributes": self.attributes,
                "source_span": self.source_span,
                "char_length": len(self.content),
            },
        }

    def _calculate_priority(self) -> float:
        """Расчет приоритета для генерации изображений."""
        type_priority = {
            DescriptionType.LOCATION: 75,
            DescriptionType.CHARACTER: 60,
            DescriptionType.ATMOSPHERE: 45,
            DescriptionType.OBJECT: 50,
        }.get(self.description_type, 40)
        length = len(self.content)
        if 200 <= length <= 500:
            length_bonus = 15
        elif 100 <= length < 200:
            length_bonus = 10
        elif 500 < length <= 1000:
            length_bonus = 5
        else:
            length_bonus = 0
        confidence_bonus = self.confidence * 10
        return min(100.0, type_priority + length_bonus + confidence_bonus)


@dataclass
class ChapterAnalysisResult:
    """Полный результат анализа главы."""

    descriptions: List[ExtractedDescription]
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]


# --- Pydantic-схемы для Modal structured output ---


class ModalEntitySchema(BaseModel):
    name: str
    type: str = Field(default="character")
    visual_summary: str = Field(default="")
    aliases: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None


class ModalDescriptionSchema(BaseModel):
    content: str
    type: str = Field(default="location")
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list)
    text_offset: Optional[int] = None
    image_prompt_en: str = Field(
        default="", description="English image prompt, 30-60 words, SFW"
    )


class ModalRelationshipSchema(BaseModel):
    source: str
    target: str
    type: str
    weight: float = Field(default=0.5)
    context: str = Field(default="")


class ModalExtractionResponse(BaseModel):
    descriptions: List[ModalDescriptionSchema]
    entities: List[ModalEntitySchema]
    relationships: List[ModalRelationshipSchema]


class ModalReduceResponse(BaseModel):
    merge_operations: List[dict] = Field(default_factory=list)
    delete_operations: List[dict] = Field(default_factory=list)
