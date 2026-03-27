"""Pydantic-схемы для structured output Modal LLM."""

from typing import List, Optional
from pydantic import BaseModel, Field


class ModalEntitySchema(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(
        default="character", max_length=50, description="character, location, object"
    )
    visual_summary: str = Field(default="", max_length=500)
    aliases: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = Field(default=None, max_length=300)
    chapter_event_inner: Optional[str] = Field(default=None, max_length=300)


class ModalDescriptionSchema(BaseModel):
    content: str = Field(max_length=2000)
    type: str = Field(default="location", max_length=50)
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list)
    text_offset: Optional[int] = None
    image_prompt_en: str = Field(
        default="",
        max_length=300,
        description="English image prompt, 30-60 words, visual details only, SFW",
    )


class ModalRelationshipSchema(BaseModel):
    source: str = Field(max_length=200)
    target: str = Field(max_length=200)
    type: str = Field(max_length=100)
    weight: float = Field(default=0.5)
    context: str = Field(default="", max_length=300)


class ModalExtractionResponse(BaseModel):
    descriptions: List[ModalDescriptionSchema]
    entities: List[ModalEntitySchema]
    relationships: List[ModalRelationshipSchema]


class ModalReduceResponse(BaseModel):
    merge_operations: List[dict] = Field(default_factory=list)
    delete_operations: List[dict] = Field(default_factory=list)
