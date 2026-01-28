"""
API роуты для работы с прогрессом чтения в fancai.

Этот модуль содержит endpoints для управления прогрессом чтения:
- Получение текущего прогресса
- Обновление прогресса чтения
- CFI (Canonical Fragment Identifier) tracking для epub.js
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Dict, Any, Optional
from uuid import UUID
from loguru import logger
from pydantic import BaseModel, Field

from ..core.database import get_database_session
from ..core.auth import get_current_active_user
from ..core.cache import cache_manager, cache_key, CACHE_TTL
from ..services.book import book_service, book_progress_service
from ..models.user import User
from ..models.book import ReadingProgress
from ..schemas.responses import (
    ReadingProgressDetailResponse,
    ReadingProgressResponse,
)


class ReadingProgressUpdateRequest(BaseModel):
    current_chapter: int = Field(default=1, ge=1)
    current_position_percent: Optional[float] = Field(default=None, ge=0, le=100)
    reading_location_cfi: Optional[str] = None
    scroll_offset_percent: float = Field(default=0.0, ge=0, le=100)
    current_page: Optional[int] = Field(default=None, deprecated=True)


router = APIRouter()


@router.get("/{book_id}/progress", response_model=ReadingProgressDetailResponse)
async def get_reading_progress(
    book_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ReadingProgressDetailResponse:
    """
    Получает прогресс чтения книги пользователем.

    Args:
        book_id: ID книги
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        Текущий прогресс чтения с CFI локацией

    Raises:
        HTTPException: 404 если книга не найдена

    Cache:
        TTL: 5 minutes (frequently updated)
        Key: user:{user_id}:progress:{book_id}

    Example:
        ```bash
        curl -X GET http://localhost:8000/api/v1/books/{book_id}/progress \\
             -H "Authorization: Bearer <token>"
        ```
    """
    # Try to get from cache
    cache_key_str = cache_key("user", current_user.id, "progress", book_id)
    cached_result = await cache_manager.get(cache_key_str)
    if cached_result is not None:
        # CRITICAL FIX (2026-01-06): Deserialize cached dict back to Pydantic model
        # Cache stores dict (via model_dump), so we need to reconstruct the model
        try:
            return ReadingProgressDetailResponse.model_validate(cached_result)
        except Exception as e:
            logger.warning(f"Cache validation failed, invalidating: {e}")
            await cache_manager.delete(cache_key_str)

    try:
        # Проверяем, что книга принадлежит пользователю
        book = await book_service.get_book_by_id(
            db=db, book_id=book_id, user_id=current_user.id
        )

        if not book:
            raise HTTPException(status_code=404, detail="Book not found")

        # Ищем прогресс напрямую в БД (избегаем кэширования)
        progress_query = select(ReadingProgress).where(
            and_(
                ReadingProgress.book_id == book_id,
                ReadingProgress.user_id == current_user.id,
            )
        )
        progress_result = await db.execute(progress_query)
        progress = progress_result.scalar_one_or_none()

        # Создаем response object
        progress_response = None
        if progress:
            progress_response = ReadingProgressResponse.model_validate(progress)

        response = ReadingProgressDetailResponse(progress=progress_response)

        # CRITICAL FIX (2026-01-06): Serialize to dict before caching
        # Pydantic models must be converted to dict for proper JSON serialization
        # mode='json' ensures datetime/UUID are converted to JSON-compatible types
        await cache_manager.set(
            cache_key_str,
            response.model_dump(mode="json"),
            ttl=CACHE_TTL["user_progress"],
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching progress: {e}")
        raise HTTPException(
            status_code=500, detail="An internal error occurred while fetching progress"
        )


@router.post("/{book_id}/progress")
async def update_reading_progress(
    book_id: UUID,
    progress_data: ReadingProgressUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, Any]:
    """
    Обновляет прогресс чтения книги пользователем.
    """
    try:
        book = await book_service.get_book_by_id(
            db=db, book_id=book_id, user_id=current_user.id
        )

        if not book:
            raise HTTPException(status_code=404, detail="Book not found")

        current_chapter = progress_data.current_chapter
        reading_location_cfi = progress_data.reading_location_cfi
        scroll_offset_percent = progress_data.scroll_offset_percent
        position_percent = progress_data.current_position_percent or 0.0

        # Обновляем прогресс чтения
        progress = await book_progress_service.update_reading_progress(
            db=db,
            user_id=current_user.id,
            book_id=book_id,
            chapter_number=current_chapter,
            position_percent=position_percent,
            reading_location_cfi=reading_location_cfi,
            scroll_offset_percent=scroll_offset_percent,
        )

        # Invalidate cache for this user's progress
        cache_key_str = cache_key("user", current_user.id, "progress", book_id)
        await cache_manager.delete(cache_key_str)

        # Also invalidate user's book list cache (progress affects book list)
        await cache_manager.delete_pattern(f"user:{current_user.id}:books:*")

        # FIX: Invalidate book metadata cache (BookPage displays progress from here)
        book_cache_key = cache_key("book", book_id, "metadata")
        await cache_manager.delete(book_cache_key)

        return {
            "progress": {
                "id": str(progress.id),
                "current_chapter": progress.current_chapter,
                "current_page": progress.current_page,
                "current_position": progress.current_position,
                "reading_location_cfi": progress.reading_location_cfi,
                "scroll_offset_percent": progress.scroll_offset_percent,
                "reading_time_minutes": progress.reading_time_minutes,
                "reading_speed_wpm": progress.reading_speed_wpm,
                "last_read_at": (
                    progress.last_read_at.isoformat() if progress.last_read_at else None
                ),
            },
            "message": "Reading progress updated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating progress: {e}")
        raise HTTPException(
            status_code=500, detail="An internal error occurred while updating progress"
        )
