"""
Response schemas для reading progress endpoints в fancai.

Этот модуль содержит type-safe response schemas для endpoints
отслеживания прогресса чтения с поддержкой CFI (Canonical Fragment Identifier).
"""

from typing import Optional

from pydantic import BaseModel

from . import ReadingProgressResponse

# ============================================================================
# READING PROGRESS DETAIL SCHEMAS
# ============================================================================


class ReadingProgressDetailResponse(BaseModel):
    """
    Детальный прогресс чтения с CFI и метаданными.

    Используется в GET /api/v1/books/{book_id}/progress.

    Attributes:
        progress: Информация о прогрессе чтения (optional, может быть None если пользователь еще не читал)

    Example:
        {
            "progress": {
                "id": "uuid",
                "current_chapter": 3,
                "current_position": 45.5,
                "reading_location_cfi": "epubcfi(/6/14[chapter03]!/4/2/16,/1:125,/1:126)",
                "scroll_offset_percent": 23.4,
                "last_read_at": "2025-11-29T10:30:00"
            }
        }
    """

    progress: Optional[ReadingProgressResponse] = None


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "ReadingProgressDetailResponse",
]
