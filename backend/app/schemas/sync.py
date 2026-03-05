"""
Pydantic v2 схемы для закладок и выделений.

Используются в sync.py endpoints для валидации запросов и сериализации ответов.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ============================================================================
# Bookmark schemas
# ============================================================================


class BookmarkCreate(BaseModel):
    """Схема создания закладки."""

    cfi: str = Field(..., max_length=500, description="CFI позиция в EPUB")
    chapter_number: int = Field(..., ge=0, description="Номер главы")
    text_excerpt: str = Field(..., max_length=500, description="Сниппет текста")


class BookmarkResponse(BaseModel):
    """Схема ответа закладки."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    cfi: str
    chapter_number: int
    text_excerpt: str
    created_at: datetime


# ============================================================================
# Highlight schemas
# ============================================================================


class HighlightCreate(BaseModel):
    """Схема создания выделения."""

    cfi_range: str = Field(..., max_length=1000, description="CFI range (start,end)")
    chapter_number: int = Field(..., ge=0, description="Номер главы")
    text: str = Field(..., max_length=2000, description="Выделенный текст")
    color: str = Field(
        default="#fbbf24",
        max_length=20,
        description="Цвет выделения (#fbbf24, #4ade80, #60a5fa, #f472b6)",
    )
    note: Optional[str] = Field(
        None, max_length=5000, description="Заметка к выделению"
    )


class HighlightUpdate(BaseModel):
    """Схема обновления выделения (цвет и/или заметка)."""

    color: Optional[str] = Field(None, max_length=20, description="Новый цвет")
    note: Optional[str] = Field(None, max_length=5000, description="Новая заметка")


class HighlightResponse(BaseModel):
    """Схема ответа выделения."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    cfi_range: str
    chapter_number: int
    text: str
    color: str
    note: Optional[str]
    created_at: datetime
    updated_at: datetime
