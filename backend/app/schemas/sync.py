"""
Pydantic v2 схемы для unified bookmarks.

Используются в sync.py endpoints для валидации запросов и сериализации ответов.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BookmarkCreate(BaseModel):
    """Схема создания закладки."""

    cfi_range: str = Field(..., max_length=1000, description="CFI range (start,end)")
    chapter_number: int = Field(..., ge=0, description="Номер главы")
    text: str = Field(..., max_length=2000, description="Выделенный текст")
    color: Optional[str] = Field(
        None,
        max_length=20,
        description="Цвет (null = без цвета, #fbbf24, #4ade80, #60a5fa, #f472b6)",
    )
    text_color: Optional[str] = Field(None, max_length=20, description="Цвет текста")
    style: str = Field(
        default="none",
        max_length=20,
        description="Стиль: none, highlight, underline, bold, italic",
    )
    note: Optional[str] = Field(None, max_length=5000, description="Заметка к закладке")


class BookmarkUpdate(BaseModel):
    """Схема обновления закладки (цвет, стиль и/или заметка)."""

    color: Optional[str] = Field(None, max_length=20, description="Новый цвет")
    text_color: Optional[str] = Field(
        None, max_length=20, description="Новый цвет текста"
    )
    style: Optional[str] = Field(None, max_length=20, description="Новый стиль")
    note: Optional[str] = Field(None, max_length=5000, description="Новая заметка")


class BookmarkResponse(BaseModel):
    """Схема ответа закладки."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    cfi_range: str
    chapter_number: int
    text: str
    color: Optional[str]
    text_color: Optional[str]
    style: str
    note: Optional[str]
    created_at: datetime
    updated_at: datetime
