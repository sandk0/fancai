"""
API роуты для работы с главами книг в fancai.

Этот модуль содержит endpoints для управления главами книг:
- Получение списка глав
- Получение содержимого конкретной главы
- Навигация между главами

NLP REMOVAL (December 2025):
- Description model removed - descriptions extracted on-demand via LLM
- GeneratedImage linked directly to chapters (description_id deprecated)
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict, Any, List
from loguru import logger

from ..core.database import get_database_session
from ..core.auth import get_current_active_user
from ..core.dependencies import get_user_book, get_chapter_by_number
from ..core.cache import cache_manager, cache_key, CACHE_TTL
from ..core.exceptions import ChapterFetchException
from ..services.book import book_service
from ..models.user import User
from ..models.book import Book
from ..models.chapter import Chapter
from ..models.image import GeneratedImage
from ..schemas.responses import (
    ChapterResponse,
    ChapterDetailResponse,
    NavigationInfo,
    BookMinimalInfo,
)
from ..schemas.responses.chapters import ChaptersListResponse, ChapterListItem


router = APIRouter()


@router.get("/{book_id}/chapters", response_model=ChaptersListResponse)
async def list_chapters(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ChaptersListResponse:
    """
    Получает список всех глав книги.

    Args:
        book: Книга (автоматически получена через dependency)
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        Список глав с метаданными

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен

    Cache:
        TTL: 1 hour (rarely changes)
        Key: book:{book_id}:chapters:list
    """
    cache_key_str = cache_key("book", book.id, "chapters", "list")
    cached_result = await cache_manager.get(cache_key_str)
    if cached_result is not None:
        try:
            return ChaptersListResponse.model_validate(cached_result)
        except Exception:
            await cache_manager.delete(cache_key_str)

    try:
        chapters = await book_service.get_book_chapters(
            db=db, book_id=book.id, user_id=current_user.id
        )

        chapters_list = [
            ChapterListItem(
                id=chapter.id,
                number=chapter.chapter_number,
                title=chapter.title or f"Chapter {chapter.chapter_number}",
                word_count=chapter.word_count,
                estimated_reading_time_minutes=chapter.estimated_reading_time,
                is_description_parsed=chapter.is_description_parsed,
                descriptions_found=chapter.descriptions_found,
            )
            for chapter in sorted(chapters, key=lambda c: c.chapter_number)
        ]

        response = ChaptersListResponse(
            book_id=book.id,
            total_chapters=len(chapters_list),
            chapters=chapters_list,
        )

        await cache_manager.set(
            cache_key_str, response.model_dump(mode="json"), ttl=CACHE_TTL["book_chapters"]
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching chapters list: {e}")
        raise ChapterFetchException("Failed to fetch chapters")


@router.get("/{book_id}/chapters/{chapter_number}", response_model=ChapterDetailResponse)
async def get_chapter(
    chapter: Chapter = Depends(get_chapter_by_number),
    db: AsyncSession = Depends(get_database_session),
) -> ChapterDetailResponse:
    """
    Получает содержимое конкретной главы книги.

    Args:
        chapter: Глава (автоматически получена через dependency)
        db: Сессия базы данных

    Returns:
        Содержимое главы с навигационной информацией

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ к книге запрещен
        ChapterNotFoundException: Если глава не найдена

    Cache:
        TTL: 1 hour (content rarely changes)
        Key: book:{book_id}:chapter:{chapter_number}

    Example:
        ```bash
        curl -X GET http://localhost:8000/api/v1/books/{book_id}/chapters/{chapter_number} \\
             -H "Authorization: Bearer <token>"
        ```
    """
    # Try to get from cache
    cache_key_str = cache_key(
        "book", chapter.book_id, "chapter", chapter.chapter_number
    )
    cached_result = await cache_manager.get(cache_key_str)
    if cached_result is not None:
        return cached_result

    try:
        # Загружаем книгу для навигационной информации с eager loading для chapters
        book_result = await db.execute(
            select(Book)
            .where(Book.id == chapter.book_id)
            .options(selectinload(Book.chapters))
        )
        book = book_result.scalar_one()

        # NLP REMOVAL: Descriptions are now extracted on-demand via LLM API
        # Get images for this chapter (images now linked to chapters, not descriptions)
        images_result = await db.execute(
            select(GeneratedImage)
            .where(GeneratedImage.chapter_id == chapter.id)
            .limit(50)
        )
        images = images_result.scalars().all()

        # Convert images to dict format for response
        images_data: List[Dict[str, Any]] = []
        for img in images:
            images_data.append({
                "id": str(img.id),
                "image_url": img.image_url,
                "description_text": img.description_text,
                "description_type": img.description_type,
                "status": img.status,
            })

        # Навигационная информация
        has_previous = chapter.chapter_number > 1
        has_next = chapter.chapter_number < len(book.chapters)
        previous_chapter = chapter.chapter_number - 1 if has_previous else None
        next_chapter = chapter.chapter_number + 1 if has_next else None

        # Создаем response objects
        chapter_response = ChapterResponse.model_validate(chapter)

        navigation = NavigationInfo(
            has_previous=has_previous,
            has_next=has_next,
            previous_chapter=previous_chapter,
            next_chapter=next_chapter,
        )

        book_info = BookMinimalInfo(
            id=book.id,
            title=book.title,
            author=book.author,
            total_chapters=len(book.chapters),
        )

        response = ChapterDetailResponse(
            chapter=chapter_response,
            descriptions=[],  # Descriptions extracted on-demand via /descriptions endpoint
            navigation=navigation,
            book_info=book_info,
            images=images_data,  # Images linked directly to chapter
        )

        # Cache the result (1 hour TTL for chapter content)
        await cache_manager.set(
            cache_key_str, response, ttl=CACHE_TTL["chapter_content"]
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching chapter: {e}")
        raise ChapterFetchException("Failed to fetch chapter content")
