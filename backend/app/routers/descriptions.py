"""
API роуты для работы с описаниями в книгах fancai.

Thin router layer - delegates business logic to DescriptionExtractionService.
"""

from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from ..middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS

from ..core.database import get_database_session, AsyncSessionLocal
from ..core.auth import get_current_active_user
from ..core.exceptions import (
    ChapterNotFoundException,
    BookNotFoundException,
)
from ..services.book import book_service
from ..services.description_extraction_service import (
    DescriptionExtractionService,
    ExtractionLockError,
    ExtractionTimeoutError,
    LLMUnavailableError,
)
from ..models.user import User
from ..schemas.responses.descriptions import (
    ChapterDescriptionsResponse,
    BatchDescriptionsRequest,
    BatchDescriptionsResponse,
    BackgroundExtractionResponse,
)
from ..schemas.responses import DescriptionResponse

from loguru import logger

router = APIRouter()


def get_description_service(db: AsyncSession) -> DescriptionExtractionService:
    return DescriptionExtractionService(db)


@router.get(
    "/{book_id}/chapters/{chapter_number}/descriptions",
    response_model=ChapterDescriptionsResponse,
    summary="Get descriptions from chapter",
    description="Returns all extracted descriptions from a specific chapter",
)
async def get_chapter_descriptions(
    book_id: UUID,
    chapter_number: int,
    extract_new: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ChapterDescriptionsResponse:
    service = get_description_service(db)

    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )
    if not book:
        raise BookNotFoundException(book_id)

    chapters_by_number = {c.chapter_number: c for c in book.chapters}
    chapter = chapters_by_number.get(chapter_number)

    if not chapter:
        raise ChapterNotFoundException(chapter_number, book_id)

    is_service_page = chapter.check_is_service_page()
    needs_service_page_update = chapter.is_service_page is None
    if needs_service_page_update:
        chapter.is_service_page = is_service_page

    if is_service_page:
        if needs_service_page_update:
            await db.commit()
        return service.build_empty_chapter_response(chapter)

    if extract_new:
        try:
            result = await service.extract_for_chapter(chapter)
            await service.invalidate_cache(book_id, chapter_number)
            return service.build_chapter_response(
                chapter,
                result.descriptions,
                processing_time_seconds=result.extraction_time_ms / 1000,
            )
        except LLMUnavailableError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="LLM processor unavailable. Check GOOGLE_API_KEY.",
            )
        except ExtractionLockError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Description extraction already in progress for this chapter",
                    "retry_after_seconds": 15,
                    "chapter_id": str(chapter.id),
                },
            )
        except ExtractionTimeoutError as e:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "message": "Description extraction timed out. Please try again.",
                    "chapter_id": str(chapter.id),
                    "timeout_seconds": e.timeout_seconds,
                },
            )

    if needs_service_page_update:
        await db.commit()
    return await service.get_chapter_with_response(chapter, book_id, use_cache=True)


@router.get(
    "/descriptions/{description_id}",
    response_model=DescriptionResponse,
    summary="Get description by ID",
    description="Returns a specific description by its ID",
)
async def get_description(
    description_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> DescriptionResponse:
    service = get_description_service(db)

    description = await service.get_by_id(description_id, user_id=current_user.id)

    if not description:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Description not found or access denied",
        )

    return service.build_description_response(description)


@router.post(
    "/{book_id}/chapters/batch",
    response_model=BatchDescriptionsResponse,
    summary="Get descriptions for multiple chapters",
    description="Returns existing descriptions for multiple chapters in a single request. "
    "Does NOT trigger LLM extraction.",
)
async def get_batch_descriptions(
    book_id: UUID,
    request: BatchDescriptionsRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> BatchDescriptionsResponse:
    logger.info(
        f"📦 Batch descriptions request: book={book_id}, "
        f"chapters={request.chapter_numbers}"
    )

    service = get_description_service(db)

    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )
    if not book:
        raise BookNotFoundException(book_id)

    chapters_by_number = {c.chapter_number: c for c in book.chapters}

    return await service.get_batch_with_response(
        book_id=book_id,
        chapter_numbers=request.chapter_numbers,
        chapters_by_number=chapters_by_number,
    )


async def _background_extract_descriptions(
    chapter_id: str,
    book_id: str,
    chapter_number: int,
) -> None:
    logger.info(f"[BG] Starting background extraction: chapter={chapter_id}")

    async with AsyncSessionLocal() as db:
        try:
            service = DescriptionExtractionService(db)

            from sqlalchemy import select
            from ..models.chapter import Chapter

            chapter_uuid = UUID(chapter_id)
            result = await db.execute(select(Chapter).where(Chapter.id == chapter_uuid))
            chapter = result.scalar_one_or_none()

            if not chapter:
                logger.warning(f"[BG] Chapter {chapter_id} not found")
                return

            if await service.check_has_descriptions(chapter_uuid):
                logger.info(
                    f"[BG] Chapter {chapter_id} already has descriptions, skipping"
                )
                return

            if not service.is_llm_available():
                logger.error("[BG] LLM processor unavailable")
                return

            try:
                extraction_result = await service.extract_for_chapter(chapter)
                await service.invalidate_cache(UUID(book_id), chapter_number)
                logger.info(
                    f"[BG] Extraction complete for chapter {chapter_id}: "
                    f"{len(extraction_result.descriptions)} descriptions"
                )
            except ExtractionLockError:
                logger.info(f"[BG] Lock not acquired for chapter {chapter_id}")
            except ExtractionTimeoutError:
                logger.error(f"[BG] LLM extraction timeout for chapter {chapter_id}")

        except Exception as e:
            logger.exception(f"[BG] Error extracting descriptions: {e}")


@router.post(
    "/{book_id}/chapters/{chapter_number}/extract-background",
    response_model=BackgroundExtractionResponse,
    summary="Trigger background LLM extraction",
    description="Starts LLM extraction in background. Returns immediately.",
)
@rate_limit(**RATE_LIMIT_PRESETS["ai_operation"])
async def trigger_background_extraction(
    book_id: UUID,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> BackgroundExtractionResponse:
    service = get_description_service(db)

    book = await book_service.get_book_by_id(
        db=db, book_id=book_id, user_id=current_user.id
    )
    if not book:
        raise BookNotFoundException(book_id)

    chapters_by_number = {c.chapter_number: c for c in book.chapters}
    chapter = chapters_by_number.get(chapter_number)

    if not chapter:
        raise ChapterNotFoundException(chapter_number, book_id)

    if chapter.check_is_service_page():
        return BackgroundExtractionResponse(
            status="skipped", chapter_number=chapter_number, reason="service_page"
        )

    if await service.check_has_descriptions(chapter.id):
        return BackgroundExtractionResponse(
            status="already_extracted", chapter_number=chapter_number, reason=None
        )

    if not service.is_llm_available():
        return BackgroundExtractionResponse(
            status="unavailable",
            chapter_number=chapter_number,
            reason="llm_processor_unavailable",
        )

    background_tasks.add_task(
        _background_extract_descriptions,
        chapter_id=str(chapter.id),
        book_id=str(book_id),
        chapter_number=chapter_number,
    )

    logger.info(f"[API] Triggered background extraction: chapter={chapter_number}")

    return BackgroundExtractionResponse(
        status="extraction_started", chapter_number=chapter_number, reason=None
    )
