"""Pydantic-схемы для structured output Modal LLM."""

from typing import List, Optional
from pydantic import BaseModel, Field


class ModalEntitySchema(BaseModel):
    name: str
    type: str = Field(default="character", description="character, location, object")
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
        default="",
        description="English image prompt, 30-60 words, visual details only, SFW",
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
