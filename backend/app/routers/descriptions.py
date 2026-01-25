"""
API роуты для работы с описаниями в книгах fancai.

Этот модуль содержит endpoints для управления описаниями:
- Получение описаний главы
- Извлечение новых описаний с помощью LLM (LangExtract)
- Статистика по описаниям
"""

import asyncio

from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, List
from uuid import UUID
from datetime import datetime

from ..core.database import get_database_session, AsyncSessionLocal
from ..core.auth import get_current_active_user
from ..core.cache import cache_manager
from ..core.exceptions import (
    ChapterNotFoundException,
    BookNotFoundException,
)
from ..services.book import book_service
from ..services.langextract_processor import langextract_processor
from ..models.user import User
from ..models.description import Description, DescriptionType
from ..models.chapter import Chapter
from ..schemas.responses.descriptions import (
    ChapterDescriptionsResponse,
    ChapterMinimalInfo,
    NLPAnalysisResult,
    BatchDescriptionsRequest,
    BatchDescriptionsResponse,
    ChapterDescriptionsResult,
)
from ..schemas.responses import DescriptionResponse

from loguru import logger


router = APIRouter()


@router.get(
    "/{book_id}/chapters/{chapter_number}/descriptions",
    response_model=ChapterDescriptionsResponse,
    summary="Get descriptions from chapter",
    description="Returns all extracted descriptions from a specific chapter"
)
async def get_chapter_descriptions(
    book_id: UUID,
    chapter_number: int,
    extract_new: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ChapterDescriptionsResponse:
    """
    Получает описания для конкретной главы книги.

    Может либо вернуть существующие описания из БД, либо
    выполнить новый LLM анализ главы (extract_new=True).

    Args:
        book_id: ID книги
        chapter_number: Номер главы (1-indexed)
        extract_new: Извлечь новые описания (перепарсить главу)
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        ChapterDescriptionsResponse: Анализ главы с описаниями
    """
    # Получаем книгу
    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )

    if not book:
        raise BookNotFoundException(book_id)

    # Ищем главу
    chapter = None
    for c in book.chapters:
        if c.chapter_number == chapter_number:
            chapter = c
            break

    if not chapter:
        raise ChapterNotFoundException(chapter_number, book_id)

    # Проверка на служебные страницы (не парсим их)
    # P1.1 OPTIMIZATION: Use cached method from Chapter model
    is_service_page = chapter.check_is_service_page()

    # Cache the result if not already cached
    if chapter.is_service_page is None:
        chapter.is_service_page = is_service_page
        await db.commit()
        logger.debug(f"📝 Cached is_service_page={is_service_page} for chapter {chapter.id}")

    if is_service_page:
        # Return empty result for service pages
        chapter_info = ChapterMinimalInfo(
            id=chapter.id,
            number=chapter.chapter_number,
            title=chapter.title or f"Глава {chapter.chapter_number}",
            word_count=chapter.word_count,
        )
        return ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=NLPAnalysisResult(
                total_descriptions=0,
                by_type={},
                descriptions=[],
            ),
        )

    # Если требуется извлечь новые описания
    if extract_new:
        if not langextract_processor.is_available():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="LLM processor unavailable. Check GOOGLE_API_KEY.",
            )

        # DISTRIBUTED LOCK: Prevent parallel LLM extraction for same chapter
        # This prevents duplicate API calls and data corruption
        lock_key = f"llm_extract_lock:chapter:{chapter.id}"
        lock_acquired = await cache_manager.acquire_lock(
            lock_key, ttl=120  # 2 minutes timeout for LLM extraction
        )

        if not lock_acquired:
            logger.info(
                f"🔒 LLM extraction already in progress for chapter {chapter.id}, "
                "returning existing descriptions"
            )
            # Return existing descriptions without re-extraction
            # (another request is already processing this chapter)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Description extraction already in progress for this chapter",
                    "retry_after_seconds": 15,
                    "chapter_id": str(chapter.id),
                }
            )

        try:
            logger.info(f"🔄 Starting LLM extraction for chapter {chapter.id}")

            # Удаляем старые описания для этой главы
            old_descriptions = (
                (
                    await db.execute(
                        select(Description).where(Description.chapter_id == chapter.id)
                    )
                )
                .scalars()
                .all()
            )

            for old_desc in old_descriptions:
                await db.delete(old_desc)

            # Извлекаем описания из контента главы через LLM
            # TIMEOUT PROTECTION (P0.3): Prevent infinite hangs on LLM API issues
            LLM_EXTRACTION_TIMEOUT = 30.0  # seconds (API response + processing)
            try:
                result = await asyncio.wait_for(
                    langextract_processor.extract_descriptions(chapter.content),
                    timeout=LLM_EXTRACTION_TIMEOUT
                )
            except asyncio.TimeoutError:
                logger.error(
                    f"⏱️ LLM extraction timeout ({LLM_EXTRACTION_TIMEOUT}s) for "
                    f"chapter {chapter.id}"
                )
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail={
                        "message": "Description extraction timed out. Please try again.",
                        "chapter_id": str(chapter.id),
                        "timeout_seconds": LLM_EXTRACTION_TIMEOUT,
                    }
                )

            # ProcessingResult has 'descriptions' list directly, not 'success' attr
            descriptions_data = result.descriptions if result.descriptions else []

            # Сохраняем новые описания в базе
            position = 0
            for desc_data in descriptions_data:
                desc_dict = desc_data.to_dict() if hasattr(desc_data, 'to_dict') else desc_data

                # Map string type to enum
                type_str = desc_dict.get("type", "location")
                try:
                    desc_type = DescriptionType(type_str)
                except ValueError:
                    desc_type = DescriptionType.LOCATION

                new_description = Description(
                    chapter_id=chapter.id,
                    type=desc_type,
                    content=desc_dict.get("content", ""),
                    confidence_score=desc_dict.get("confidence_score", 0.8),
                    priority_score=desc_dict.get("priority_score", 0.5),
                    position_in_chapter=position,
                    word_count=desc_dict.get("word_count", len(desc_dict.get("content", "").split())),
                )
                position += 1
                db.add(new_description)

            # Update chapter stats
            chapter.descriptions_found = len(descriptions_data)
            chapter.is_description_parsed = True
            chapter.parsed_at = datetime.utcnow()

            await db.commit()
            await db.refresh(chapter)

            logger.info(
                f"✅ LLM extraction complete for chapter {chapter.id}: "
                f"{len(descriptions_data)} descriptions"
            )

            # Инвалидируем кэш для этой главы (новые описания)
            invalidate_key = f"descriptions:book:{book_id}:chapter:{chapter_number}"
            await cache_manager.delete(invalidate_key)
            logger.debug(f"🗑️ Invalidated cache: {invalidate_key}")

        finally:
            # Always release the lock
            await cache_manager.release_lock(lock_key)

    # Redis cache key для описаний главы
    cache_key = f"descriptions:book:{book_id}:chapter:{chapter_number}"

    # Проверяем кэш (только если НЕ extract_new)
    if not extract_new:
        cached_response = await cache_manager.get(cache_key)
        if cached_response:
            logger.debug(f"🎯 Redis cache HIT for chapter {chapter_number} descriptions")
            # Reconstruct response from cached data
            try:
                return ChapterDescriptionsResponse(**cached_response)
            except Exception as e:
                logger.warning(f"Failed to parse cached descriptions: {e}")
                # Continue to DB fetch if cache is corrupted

    # Получаем описания для этой главы
    descriptions_result = await db.execute(
        select(Description)
        .where(Description.chapter_id == chapter.id)
        .order_by(Description.position_in_chapter)
    )
    descriptions = descriptions_result.scalars().all()

    # Формируем ответ
    chapter_info = ChapterMinimalInfo(
        id=chapter.id,
        number=chapter.chapter_number,  # Field name is 'number', not 'chapter_number'
        title=chapter.title or f"Глава {chapter.chapter_number}",
        word_count=chapter.word_count,
    )

    # Группируем по типам
    by_type: Dict[str, int] = {}
    desc_responses: List[DescriptionResponse] = []

    for desc in descriptions:
        type_value = desc.type.value if desc.type else "location"
        by_type[type_value] = by_type.get(type_value, 0) + 1

        desc_responses.append(DescriptionResponse(
            id=desc.id,
            chapter_id=desc.chapter_id,
            type=desc.type,
            content=desc.content,
            context=desc.context or "",
            confidence_score=desc.confidence_score,
            priority_score=desc.priority_score,
            position_in_chapter=desc.position_in_chapter,
            word_count=desc.word_count,
            is_suitable_for_generation=desc.is_suitable_for_generation,
            image_generated=desc.image_generated,
            created_at=desc.created_at,
            updated_at=desc.updated_at,
        ))

    analysis_result = NLPAnalysisResult(
        total_descriptions=len(descriptions),
        by_type=by_type,
        descriptions=desc_responses,
    )

    response = ChapterDescriptionsResponse(
        chapter_info=chapter_info,  # Fixed: was 'chapter'
        nlp_analysis=analysis_result,  # Fixed: was 'analysis'
    )

    # Кэшируем результат (TTL 1 hour)
    # Кэшируем только если есть описания (не кэшируем пустые результаты)
    if len(descriptions) > 0:
        try:
            await cache_manager.set(
                cache_key,
                response.model_dump(mode='json'),
                ttl=3600  # 1 hour
            )
            logger.debug(f"💾 Cached {len(descriptions)} descriptions for chapter {chapter_number}")
        except Exception as e:
            logger.warning(f"Failed to cache descriptions: {e}")

    return response


@router.get(
    "/descriptions/{description_id}",
    response_model=DescriptionResponse,
    summary="Get description by ID",
    description="Returns a specific description by its ID"
)
async def get_description(
    description_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> DescriptionResponse:
    """
    Получает описание по ID.

    Args:
        description_id: ID описания
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        DescriptionResponse: Информация об описании
    """
    from ..models.book import Book

    # Get description with access check
    result = await db.execute(
        select(Description)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Description.id == description_id)
        .where(Book.user_id == current_user.id)
    )
    description = result.scalar_one_or_none()

    if not description:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Description not found or access denied",
        )

    return DescriptionResponse(
        id=description.id,
        chapter_id=description.chapter_id,
        type=description.type,
        content=description.content,
        context=description.context or "",
        confidence_score=description.confidence_score,
        priority_score=description.priority_score,
        position_in_chapter=description.position_in_chapter,
        word_count=description.word_count,
        is_suitable_for_generation=description.is_suitable_for_generation,
        image_generated=description.image_generated,
        created_at=description.created_at,
        updated_at=description.updated_at,
    )


# ============================================================================
# BATCH API (Phase 3 - 2025-12-25)
# ============================================================================


async def _get_chapter_descriptions_internal(
    db: AsyncSession,
    book_id: UUID,
    chapter_number: int,
    chapters: list,
) -> ChapterDescriptionsResponse:
    """
    Internal helper to get descriptions for a single chapter.
    Used by both single and batch endpoints.

    Note: Does NOT trigger LLM extraction - only returns existing descriptions.
    """
    # Find chapter
    chapter = None
    for c in chapters:
        if c.chapter_number == chapter_number:
            chapter = c
            break

    if not chapter:
        raise ChapterNotFoundException(chapter_number, book_id)

    # P1.1 OPTIMIZATION: Use cached method from Chapter model
    is_service_page = chapter.check_is_service_page()

    chapter_info = ChapterMinimalInfo(
        id=chapter.id,
        number=chapter.chapter_number,
        title=chapter.title or f"Глава {chapter.chapter_number}",
        word_count=chapter.word_count,
    )

    if is_service_page:
        return ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=NLPAnalysisResult(
                total_descriptions=0,
                by_type={},
                descriptions=[],
            ),
        )

    # Get descriptions from DB
    descriptions_result = await db.execute(
        select(Description)
        .where(Description.chapter_id == chapter.id)
        .order_by(Description.position_in_chapter)
    )
    descriptions = descriptions_result.scalars().all()

    # Build response
    by_type: Dict[str, int] = {}
    desc_responses: List[DescriptionResponse] = []

    for desc in descriptions:
        type_value = desc.type.value if desc.type else "location"
        by_type[type_value] = by_type.get(type_value, 0) + 1

        desc_responses.append(DescriptionResponse(
            id=desc.id,
            chapter_id=desc.chapter_id,
            type=desc.type,
            content=desc.content,
            context=desc.context or "",
            confidence_score=desc.confidence_score,
            priority_score=desc.priority_score,
            position_in_chapter=desc.position_in_chapter,
            word_count=desc.word_count,
            is_suitable_for_generation=desc.is_suitable_for_generation,
            image_generated=desc.image_generated,
            created_at=desc.created_at,
            updated_at=desc.updated_at,
        ))

    return ChapterDescriptionsResponse(
        chapter_info=chapter_info,
        nlp_analysis=NLPAnalysisResult(
            total_descriptions=len(descriptions),
            by_type=by_type,
            descriptions=desc_responses,
        ),
    )


@router.post(
    "/{book_id}/chapters/batch",
    response_model=BatchDescriptionsResponse,
    summary="Get descriptions for multiple chapters",
    description="Returns existing descriptions for multiple chapters in a single request. "
                "Does NOT trigger LLM extraction - use individual endpoint with extract_new=true for that."
)
async def get_batch_descriptions(
    book_id: UUID,
    request: BatchDescriptionsRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> BatchDescriptionsResponse:
    """
    Получает описания для нескольких глав одним запросом.

    Оптимизация для prefetching - загружает описания для N глав за один HTTP запрос
    вместо N отдельных запросов. НЕ запускает LLM extraction.

    OPTIMIZED (2025-12-25): Fixed N+1 query problem.
    Previously: N separate queries for N chapters.
    Now: 1 batch query for all chapters + in-memory grouping.

    Args:
        book_id: ID книги
        request: Список номеров глав
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        BatchDescriptionsResponse: Описания для всех запрошенных глав
    """
    logger.info(
        f"📦 Batch descriptions request: book={book_id}, "
        f"chapters={request.chapter_numbers}"
    )

    # Get book with access check
    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )

    if not book:
        raise BookNotFoundException(book_id)

    # Build chapter lookup map
    chapters_by_number = {c.chapter_number: c for c in book.chapters}

    # Track chapters that need is_service_page cached
    chapters_to_cache: List[Chapter] = []

    # Phase 1: Check Redis cache for all chapters
    results: List[ChapterDescriptionsResult] = []
    chapters_to_fetch: List[int] = []  # Chapters not in cache
    chapter_ids_to_fetch: List[UUID] = []  # Their DB IDs

    for chapter_number in request.chapter_numbers:
        cache_key = f"descriptions:book:{book_id}:chapter:{chapter_number}"
        cached_response = await cache_manager.get(cache_key)

        if cached_response:
            logger.debug(f"🎯 Batch: Redis HIT for chapter {chapter_number}")
            try:
                chapter_data = ChapterDescriptionsResponse(**cached_response)
                results.append(ChapterDescriptionsResult(
                    chapter_number=chapter_number,
                    success=True,
                    data=chapter_data,
                ))
                continue
            except Exception:
                pass  # Fall through to DB fetch

        # Check if chapter exists
        chapter = chapters_by_number.get(chapter_number)
        if not chapter:
            results.append(ChapterDescriptionsResult(
                chapter_number=chapter_number,
                success=False,
                error=f"Chapter {chapter_number} not found",
            ))
            continue

        # P1.1 OPTIMIZATION: Use cached method from Chapter model
        is_service_page = chapter.check_is_service_page()

        # Track for batch caching
        if chapter.is_service_page is None:
            chapter.is_service_page = is_service_page
            chapters_to_cache.append(chapter)

        if is_service_page:
            # Return empty result for service pages
            chapter_info = ChapterMinimalInfo(
                id=chapter.id,
                number=chapter.chapter_number,
                title=chapter.title or f"Глава {chapter.chapter_number}",
                word_count=chapter.word_count,
            )
            results.append(ChapterDescriptionsResult(
                chapter_number=chapter_number,
                success=True,
                data=ChapterDescriptionsResponse(
                    chapter_info=chapter_info,
                    nlp_analysis=NLPAnalysisResult(
                        total_descriptions=0,
                        by_type={},
                        descriptions=[],
                    ),
                ),
            ))
            continue

        # Need to fetch from DB
        chapters_to_fetch.append(chapter_number)
        chapter_ids_to_fetch.append(chapter.id)

    # Phase 2: BATCH LOAD all descriptions in ONE query (N+1 FIX)
    descriptions_by_chapter: Dict[UUID, List[Description]] = {}

    if chapter_ids_to_fetch:
        logger.debug(
            f"🗄️ Batch: Loading descriptions for {len(chapter_ids_to_fetch)} chapters "
            "in single query"
        )
        descriptions_result = await db.execute(
            select(Description)
            .where(Description.chapter_id.in_(chapter_ids_to_fetch))
            .order_by(Description.chapter_id, Description.position_in_chapter)
        )
        all_descriptions = descriptions_result.scalars().all()

        # Group by chapter_id
        for desc in all_descriptions:
            if desc.chapter_id not in descriptions_by_chapter:
                descriptions_by_chapter[desc.chapter_id] = []
            descriptions_by_chapter[desc.chapter_id].append(desc)

        logger.debug(
            f"🗄️ Batch: Loaded {len(all_descriptions)} descriptions for "
            f"{len(descriptions_by_chapter)} chapters"
        )

    # Phase 3: Build responses for fetched chapters
    for chapter_number in chapters_to_fetch:
        chapter = chapters_by_number[chapter_number]
        descriptions = descriptions_by_chapter.get(chapter.id, [])

        # Build chapter info
        chapter_info = ChapterMinimalInfo(
            id=chapter.id,
            number=chapter.chapter_number,
            title=chapter.title or f"Глава {chapter.chapter_number}",
            word_count=chapter.word_count,
        )

        # Build descriptions response
        by_type: Dict[str, int] = {}
        desc_responses: List[DescriptionResponse] = []

        for desc in descriptions:
            type_value = desc.type.value if desc.type else "location"
            by_type[type_value] = by_type.get(type_value, 0) + 1

            desc_responses.append(DescriptionResponse(
                id=desc.id,
                chapter_id=desc.chapter_id,
                type=desc.type,
                content=desc.content,
                context=desc.context or "",
                confidence_score=desc.confidence_score,
                priority_score=desc.priority_score,
                position_in_chapter=desc.position_in_chapter,
                word_count=desc.word_count,
                is_suitable_for_generation=desc.is_suitable_for_generation,
                image_generated=desc.image_generated,
                created_at=desc.created_at,
                updated_at=desc.updated_at,
            ))

        chapter_data = ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=NLPAnalysisResult(
                total_descriptions=len(descriptions),
                by_type=by_type,
                descriptions=desc_responses,
            ),
        )

        results.append(ChapterDescriptionsResult(
            chapter_number=chapter_number,
            success=True,
            data=chapter_data,
        ))

        # Cache the result if non-empty
        if len(descriptions) > 0:
            try:
                cache_key = f"descriptions:book:{book_id}:chapter:{chapter_number}"
                await cache_manager.set(
                    cache_key,
                    chapter_data.model_dump(mode='json'),
                    ttl=3600
                )
            except Exception:
                pass  # Ignore cache errors

    # Sort results by original chapter order
    chapter_order = {num: idx for idx, num in enumerate(request.chapter_numbers)}
    results.sort(key=lambda r: chapter_order.get(r.chapter_number, 999))

    # Calculate totals
    total_descriptions = sum(
        r.data.nlp_analysis.total_descriptions
        for r in results
        if r.success and r.data
    )
    success_count = sum(1 for r in results if r.success)

    # P1.1: Batch commit is_service_page cache updates
    if chapters_to_cache:
        await db.commit()
        logger.debug(f"📝 Cached is_service_page for {len(chapters_to_cache)} chapters")

    logger.info(
        f"✅ Batch complete: {success_count}/{len(request.chapter_numbers)} chapters, "
        f"{total_descriptions} total descriptions (optimized: 1 DB query)"
    )

    return BatchDescriptionsResponse(
        book_id=book_id,
        chapters=results,
        total_requested=len(request.chapter_numbers),
        total_success=success_count,
        total_descriptions=total_descriptions,
    )


# ============================================================================
# BACKGROUND EXTRACTION API (Phase 4 - 2025-12-29)
# ============================================================================


async def _background_extract_descriptions(
    chapter_id: str,
    book_id: str,
    user_id: str,
) -> None:
    """
    Background task для извлечения описаний из главы.

    Создает новую DB сессию (background tasks не могут использовать request-scoped сессию)
    и вызывает LLM extraction сервис.

    Args:
        chapter_id: UUID главы (строка)
        book_id: UUID книги (строка)
        user_id: UUID пользователя (строка)
    """
    logger.info(
        f"[BG] Starting background extraction: chapter={chapter_id}, "
        f"book={book_id}, user={user_id}"
    )

    # Create new DB session for background task
    async with AsyncSessionLocal() as db:
        try:
            # Get chapter
            chapter_uuid = UUID(chapter_id)
            result = await db.execute(
                select(Chapter).where(Chapter.id == chapter_uuid)
            )
            chapter = result.scalar_one_or_none()

            if not chapter:
                logger.warning(f"[BG] Chapter {chapter_id} not found")
                return

            # Check if already extracted (race condition protection)
            existing = await db.execute(
                select(Description).where(Description.chapter_id == chapter_uuid).limit(1)
            )
            if existing.scalar_one_or_none():
                logger.info(f"[BG] Chapter {chapter_id} already has descriptions, skipping")
                return

            # Check if LLM processor is available
            if not langextract_processor.is_available():
                logger.error("[BG] LLM processor unavailable. Check GOOGLE_API_KEY.")
                return

            # Acquire distributed lock to prevent parallel extraction
            lock_key = f"llm_extract_lock:chapter:{chapter_id}"
            lock_acquired = await cache_manager.acquire_lock(lock_key, ttl=120)

            if not lock_acquired:
                logger.info(f"[BG] Lock not acquired for chapter {chapter_id}, another task is processing")
                return

            try:
                # Extract descriptions via LLM
                LLM_EXTRACTION_TIMEOUT = 30.0
                try:
                    extraction_result = await asyncio.wait_for(
                        langextract_processor.extract_descriptions(chapter.content),
                        timeout=LLM_EXTRACTION_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    logger.error(f"[BG] LLM extraction timeout for chapter {chapter_id}")
                    return

                descriptions_data = extraction_result.descriptions if extraction_result.descriptions else []

                # Save descriptions to DB
                position = 0
                for desc_data in descriptions_data:
                    desc_dict = desc_data.to_dict() if hasattr(desc_data, 'to_dict') else desc_data

                    type_str = desc_dict.get("type", "location")
                    try:
                        desc_type = DescriptionType(type_str)
                    except ValueError:
                        desc_type = DescriptionType.LOCATION

                    new_description = Description(
                        chapter_id=chapter.id,
                        type=desc_type,
                        content=desc_dict.get("content", ""),
                        confidence_score=desc_dict.get("confidence_score", 0.8),
                        priority_score=desc_dict.get("priority_score", 0.5),
                        position_in_chapter=position,
                        word_count=desc_dict.get("word_count", len(desc_dict.get("content", "").split())),
                    )
                    position += 1
                    db.add(new_description)

                # Update chapter stats
                chapter.descriptions_found = len(descriptions_data)
                chapter.is_description_parsed = True
                chapter.parsed_at = datetime.utcnow()

                await db.commit()

                # Invalidate cache
                cache_key = f"descriptions:book:{book_id}:chapter:{chapter.chapter_number}"
                await cache_manager.delete(cache_key)

                logger.info(
                    f"[BG] Extraction complete for chapter {chapter_id}: "
                    f"{len(descriptions_data)} descriptions"
                )

            finally:
                await cache_manager.release_lock(lock_key)

        except Exception as e:
            logger.exception(f"[BG] Error extracting descriptions for chapter {chapter_id}: {e}")


@router.post(
    "/{book_id}/chapters/{chapter_number}/extract-background",
    summary="Trigger background LLM extraction",
    description="Starts LLM extraction in background for the specified chapter. "
                "Returns immediately without blocking. Used for prefetching next chapter."
)
async def trigger_background_extraction(
    book_id: UUID,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Starts LLM extraction in background for the specified chapter.
    Returns immediately without blocking the client.

    Used for prefetching next chapter while user reads current one.

    Args:
        book_id: Book UUID
        chapter_number: Chapter number (1-indexed)
        background_tasks: FastAPI BackgroundTasks
        current_user: Current authenticated user
        db: Database session

    Returns:
        dict: Status of the extraction trigger
    """
    # 1. Verify book ownership
    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )

    if not book:
        raise BookNotFoundException(book_id)

    # 2. Find chapter
    chapter = None
    for c in book.chapters:
        if c.chapter_number == chapter_number:
            chapter = c
            break

    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # 3. Check for service page
    if chapter.check_is_service_page():
        return {"status": "skipped", "reason": "service_page", "chapter_number": chapter_number}

    # 4. Check for existing descriptions
    existing = await db.execute(
        select(Description).where(Description.chapter_id == chapter.id).limit(1)
    )
    if existing.scalar_one_or_none():
        return {"status": "already_extracted", "chapter_number": chapter_number}

    # 5. Check if LLM processor is available
    if not langextract_processor.is_available():
        return {"status": "unavailable", "reason": "llm_processor_unavailable", "chapter_number": chapter_number}

    # 6. Start background extraction
    background_tasks.add_task(
        _background_extract_descriptions,
        chapter_id=str(chapter.id),
        book_id=str(book_id),
        user_id=str(current_user.id),
    )

    logger.info(
        f"[API] Triggered background extraction: chapter={chapter_number}, "
        f"book={book_id}"
    )

    return {"status": "extraction_started", "chapter_number": chapter_number}
