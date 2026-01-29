"""
Response schemas для chapter endpoints в fancai.

Этот модуль содержит type-safe response schemas для endpoints
работы с главами книг, включая навигацию и метаданные.

NLP REMOVAL (December 2025):
- DescriptionWithImageResponse replaced with images field
- Descriptions extracted on-demand via LLM API
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from uuid import UUID

from . import ChapterResponse


# ============================================================================
# CHAPTER NAVIGATION SCHEMAS
# ============================================================================


class NavigationInfo(BaseModel):
    """
    Информация о навигации между главами.

    Attributes:
        has_previous: Есть ли предыдущая глава
        has_next: Есть ли следующая глава
        previous_chapter: Номер предыдущей главы (optional)
        next_chapter: Номер следующей главы (optional)
    """

    has_previous: bool = Field(description="Has previous chapter")
    has_next: bool = Field(description="Has next chapter")
    previous_chapter: Optional[int] = Field(None, ge=1, description="Previous chapter number")
    next_chapter: Optional[int] = Field(None, ge=1, description="Next chapter number")


class BookMinimalInfo(BaseModel):
    """
    Минимальная информация о книге для контекста главы.

    Attributes:
        id: UUID книги
        title: Название книги
        author: Автор книги (optional)
        total_chapters: Общее количество глав
    """

    id: UUID
    title: str = Field(description="Book title")
    author: Optional[str] = Field(None, description="Book author")
    total_chapters: int = Field(ge=0, description="Total chapters in book")


class ChapterDetailResponse(BaseModel):
    """
    Детальная информация о главе с содержимым и навигацией.

    Используется в GET /api/v1/books/{book_id}/chapters/{chapter_number}.

    NLP REMOVAL (December 2025):
    - descriptions field deprecated (empty list for backwards compatibility)
    - images field added for generated images linked to chapter
    - Descriptions extracted on-demand via /descriptions endpoint

    Attributes:
        chapter: Информация о главе с содержимым
        descriptions: DEPRECATED - always empty list
        navigation: Навигационная информация
        book_info: Минимальная информация о книге
        images: Список сгенерированных изображений для главы

    Example:
        {
            "chapter": {
                "id": "uuid",
                "chapter_number": 3,
                "title": "Chapter 3",
                "content": "...",
                "word_count": 3500
            },
            "descriptions": [],
            "images": [
                {
                    "id": "uuid",
                    "image_url": "/images/...",
                    "description_text": "A dark forest...",
                    "description_type": "location"
                }
            ],
            "navigation": {
                "has_previous": true,
                "has_next": true,
                "previous_chapter": 2,
                "next_chapter": 4
            },
            "book_info": {
                "id": "uuid",
                "title": "Book Title",
                "author": "Author Name",
                "total_chapters": 15
            }
        }
    """

    chapter: ChapterResponse
    descriptions: List[Dict[str, Any]] = Field(
        default_factory=list, description="DEPRECATED - use /descriptions endpoint"
    )
    navigation: NavigationInfo
    book_info: BookMinimalInfo
    images: List[Dict[str, Any]] = Field(
        default_factory=list, description="Generated images for this chapter"
    )


# ============================================================================
# CHAPTER LIST SCHEMAS
# ============================================================================


class ChapterListItem(BaseModel):
    """Summary info for chapter in list view."""

    id: UUID
    number: int = Field(ge=1)
    title: str
    word_count: int = Field(ge=0)
    estimated_reading_time_minutes: int = Field(ge=0)
    is_description_parsed: bool
    descriptions_found: int = Field(ge=0)


class ChaptersListResponse(BaseModel):
    """Response for GET /{book_id}/chapters endpoint."""

    book_id: UUID
    total_chapters: int = Field(ge=0)
    chapters: List[ChapterListItem]


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "NavigationInfo",
    "BookMinimalInfo",
    "ChapterDetailResponse",
    "ChapterListItem",
    "ChaptersListResponse",
]
