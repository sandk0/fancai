"""
API роуты для генерации изображений в fancai.

Содержит endpoints для генерации изображений по описаниям из книг
с использованием AI и управления очередью генерации.
"""

from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Dict, Any, List, Optional
from uuid import UUID
from pydantic import BaseModel
from pathlib import Path
import os

from ..utils.etag import (
    check_conditional_request,
    get_mime_type_from_extension,
)

from ..core.database import get_database_session
from ..core.auth import get_current_active_user, get_current_admin_user
from ..services.image_generator import ImageGeneratorService
from ..core.container import get_image_generator_service_dep
from ..models.user import User
from ..models.book import Book
from ..models.chapter import Chapter
from ..models.description import Description, DescriptionType
from ..models.image import GeneratedImage
from ..schemas.responses.images import (
    ImageGenerationStatusResponse,
    UserImageStatsResponse,
    ImageGenerationSuccessResponse,
    QueueStats,
    UserGenerationInfo,
    APIProviderInfo,
)


router = APIRouter()

# Directory where Imagen saves images (persistent storage)
# Uses /app/storage which is mounted as Docker volume for persistence
GENERATED_IMAGES_DIR = Path("/app/storage/generated_images")


@router.get("/images/file/{filename}")
async def get_generated_image_file(
    filename: str,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
):
    """
    Serve generated image file with ownership verification and HTTP caching.

    This endpoint serves image files from the generated_images directory.
    Authentication required - verifies image belongs to a book owned by the user.

    Supports HTTP caching via:
    - ETag header for conditional requests (If-None-Match)
    - Last-Modified header for conditional requests (If-Modified-Since)
    - Cache-Control header for browser caching (immutable, 1 year max-age)

    Args:
        filename: The image filename (UUID-based)
        request: FastAPI request object for accessing headers
        current_user: Current authenticated user
        db: Database session

    Returns:
        FileResponse with the image and caching headers, or
        304 Not Modified if the client has a valid cached copy

    Raises:
        HTTPException 400: Invalid filename
        HTTPException 403: Access denied (image doesn't belong to user)
        HTTPException 404: Image not found
    """
    # Validate filename (prevent path traversal)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename"
        )

    # Build full file path
    file_path = GENERATED_IMAGES_DIR / filename

    # Check if file exists
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )

    # SECURITY FIX: Verify ownership through database
    # Image -> Description -> Chapter -> Book -> User
    # OR Image -> Chapter -> Book -> User (for new schema)
    image_result = await db.execute(
        select(GeneratedImage)
        .where(GeneratedImage.local_path == str(file_path))
    )
    image = image_result.scalar_one_or_none()

    if not image:
        # Try matching by filename in image_url field (API path format)
        api_path = f"/api/v1/images/file/{filename}"
        image_result = await db.execute(
            select(GeneratedImage)
            .where(GeneratedImage.image_url == api_path)
        )
        image = image_result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found in database"
        )

    # Check ownership: image.user_id should match current_user.id
    if image.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Image does not belong to current user"
        )

    # HTTP Caching: Check conditional request headers
    if_none_match = request.headers.get("if-none-match")
    if_modified_since = request.headers.get("if-modified-since")

    should_304, etag, last_modified = check_conditional_request(
        file_path=file_path,
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )

    # Cache-Control header: images are immutable (content-addressable by filename)
    # - public: can be cached by CDN/proxies
    # - max-age=31536000: cache for 1 year
    # - immutable: content will never change (same filename = same content)
    cache_control = "public, max-age=31536000, immutable"

    # Return 304 Not Modified if client has valid cached copy
    if should_304:
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Last-Modified": last_modified,
                "Cache-Control": cache_control,
            },
        )

    # Determine MIME type from file extension
    media_type = get_mime_type_from_extension(file_path)

    # Use content_disposition_type="inline" to display image in browser
    # instead of forcing download (which happens with filename parameter)
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        content_disposition_type="inline",
        headers={
            "ETag": etag,
            "Last-Modified": last_modified,
            "Cache-Control": cache_control,
        },
    )


# Pydantic модели для запросов
class ImageGenerationParams(BaseModel):
    """Параметры генерации изображения."""

    style_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    width: Optional[int] = 1024
    height: Optional[int] = 768


class BatchGenerationRequest(BaseModel):
    """Запрос на пакетную генерацию изображений."""

    chapter_id: UUID
    max_images: int = 5
    style_prompt: Optional[str] = None
    description_types: Optional[List[DescriptionType]] = None


@router.get(
    "/images/generation/status",
    response_model=ImageGenerationStatusResponse,
    summary="Get image generation service status",
    description="Returns current status of image generation service including queue stats, user quota, and API info"
)
async def get_generation_status(
    current_user: User = Depends(get_current_active_user),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> ImageGenerationStatusResponse:
    """
    Получение статуса системы генерации изображений.

    Включает:
    - Статус сервиса (operational, degraded, down)
    - Статистику очереди генерации
    - Информацию о квоте пользователя
    - Информацию об API провайдере

    Args:
        current_user: Текущий авторизованный пользователь

    Returns:
        ImageGenerationStatusResponse: Полная информация о статусе генерации
    """
    # Получаем статистику (используем DI)
    stats = await image_gen_svc.get_generation_stats()

    # Map service stats to QueueStats
    queue_stats = QueueStats(
        pending_tasks=stats.get("queue_size", 0),
        processing_tasks=1 if stats.get("is_processing", False) else 0,
        completed_today=0,  # TODO: implement tracking
        failed_today=0,  # TODO: implement tracking
    )

    # User generation info
    user_info = UserGenerationInfo(
        id=current_user.id,
        can_generate=current_user.is_active,
        remaining_quota=None,  # None = unlimited for now
    )

    # API provider info
    api_info = APIProviderInfo(
        provider="Google Imagen 4",
        supported_formats=["PNG"],
        max_resolution="1024x1024",
        estimated_time_per_image="5-15 seconds",
    )

    return ImageGenerationStatusResponse(
        status="operational",
        queue_stats=queue_stats,
        user_info=user_info,
        api_info=api_info,
    )


@router.get(
    "/images/user/stats",
    response_model=UserImageStatsResponse,
    summary="Get user's image generation statistics",
    description="Returns statistics about generated images and found descriptions for the current user"
)
async def get_user_images_stats(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> UserImageStatsResponse:
    """
    Получение статистики изображений и описаний пользователя.

    Подсчитывает:
    - Реальное количество сгенерированных изображений
    - Общее количество найденных описаний
    - Распределение изображений по типам описаний

    Args:
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        UserImageStatsResponse: Статистика генерации изображений пользователя
    """
    # Подсчитываем реальное количество сгенерированных изображений
    images_count_query = await db.execute(
        select(func.count(GeneratedImage.id))
        .join(Description, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Book.user_id == current_user.id)
    )
    total_images = images_count_query.scalar() or 0

    # Подсчитываем общее количество найденных описаний
    descriptions_count_query = await db.execute(
        select(func.count(Description.id))
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Book.user_id == current_user.id)
    )
    total_descriptions = descriptions_count_query.scalar() or 0

    # Подсчитываем изображения по типам описаний
    images_by_type_query = await db.execute(
        select(Description.type, func.count(GeneratedImage.id))
        .join(GeneratedImage, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Book.user_id == current_user.id)
        .group_by(Description.type)
    )

    images_by_type = {
        desc_type.value: count
        for desc_type, count in images_by_type_query.fetchall()
    }

    return UserImageStatsResponse(
        total_images_generated=total_images,
        total_descriptions_found=total_descriptions,
        images_by_type=images_by_type,
    )


@router.post(
    "/images/generate/description/{description_id}",
    response_model=ImageGenerationSuccessResponse,
    status_code=201,
    summary="Generate image for description",
    description="Generates an AI image for a specific book description"
)
async def generate_image_for_description(
    description_id: UUID,
    params: ImageGenerationParams,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> ImageGenerationSuccessResponse:
    """
    Генерирует изображение для конкретного описания.

    Синхронно генерирует изображение через Google Imagen 4 API и
    сохраняет результат в базу данных.

    Args:
        description_id: ID описания из базы данных
        params: Параметры генерации (style_prompt, width, height, etc.)
        background_tasks: Фоновые задачи для асинхронной обработки
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        ImageGenerationSuccessResponse: Информация о сгенерированном изображении

    Raises:
        HTTPException 404: Description not found or access denied
        HTTPException 409: Image already exists for this description
        HTTPException 500: Image generation failed
    """
    # Получаем описание
    description_result = await db.execute(
        select(Description)
        .join(Chapter)
        .join(Book)
        .where(Description.id == description_id)
        .where(
            Book.user_id == current_user.id
        )  # Проверяем что книга принадлежит пользователю
    )
    description = description_result.scalar_one_or_none()

    if not description:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Description not found or access denied",
        )

    # Проверяем, не сгенерировано ли уже изображение для этого описания
    existing_image_result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.description_id == description_id)
    )
    existing_image = existing_image_result.scalar_one_or_none()
    if existing_image:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Image already exists for this description",
        )

    try:
        # Генерируем изображение (используем DI)
        result = await image_gen_svc.generate_image_for_description(
            description=description,
            user_id=str(current_user.id),
            custom_style=params.style_prompt,
        )

        if not result.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Image generation failed: {result.error_message}",
            )

        # Create HTTP URL from local_path (extract filename)
        filename = os.path.basename(result.local_path) if result.local_path else None
        http_url = f"/api/v1/images/file/{filename}" if filename else None

        # Сохраняем результат в базе данных
        generated_image = GeneratedImage(
            description_id=description.id,
            user_id=current_user.id,
            service_used="imagen",
            status="completed",
            image_url=http_url,  # Store HTTP URL instead of data URL
            local_path=result.local_path,
            prompt_used=result.prompt_used or params.style_prompt or "default",
            generation_time_seconds=result.generation_time_seconds,
        )

        db.add(generated_image)
        await db.commit()
        await db.refresh(generated_image)

        return ImageGenerationSuccessResponse(
            image_id=generated_image.id,
            description_id=description.id,
            image_url=http_url or result.image_url,
            generation_time=result.generation_time_seconds,
            status="completed",
            created_at=generated_image.created_at.isoformat(),
            message="Image generated successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during generation: {str(e)}",
        )


@router.post("/images/generate/chapter/{chapter_id}")
async def generate_images_for_chapter(
    chapter_id: UUID,
    request: BatchGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Генерирует изображения для всех подходящих описаний в главе.

    Args:
        chapter_id: ID главы
        request: Параметры пакетной генерации
        background_tasks: Фоновые задачи
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Информация о запущенной пакетной генерации
    """
    # Проверяем, что глава принадлежит пользователю
    chapter_result = await db.execute(
        select(Chapter)
        .join(Book)
        .where(Chapter.id == chapter_id)
        .where(Book.user_id == current_user.id)
    )
    chapter = chapter_result.scalar_one_or_none()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found or access denied",
        )

    # Получаем описания для генерации
    descriptions_query = select(Description).where(Description.chapter_id == chapter_id)

    # Фильтруем по типам описаний если указано
    if request.description_types:
        descriptions_query = descriptions_query.where(
            Description.type.in_(request.description_types)
        )

    descriptions_result = await db.execute(
        descriptions_query.order_by(Description.priority_score.desc())
    )
    all_descriptions = descriptions_result.scalars().all()

    if not all_descriptions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No descriptions found in this chapter",
        )

    # Исключаем описания, для которых уже есть изображения
    existing_images = await db.execute(
        select(GeneratedImage.description_id).where(
            GeneratedImage.description_id.in_([d.id for d in all_descriptions])
        )
    )
    existing_desc_ids = set(img_id for img_id, in existing_images.fetchall())

    descriptions_to_process = [
        d for d in all_descriptions if d.id not in existing_desc_ids
    ][: request.max_images]

    if not descriptions_to_process:
        return {
            "message": "All suitable descriptions already have images",
            "chapter_id": str(chapter_id),
            "processed": 0,
            "skipped": len(all_descriptions),
        }

    # Запускаем пакетную генерацию (используем DI)
    try:
        results = await image_gen_svc.batch_generate_for_chapter(
            descriptions=descriptions_to_process,
            user_id=str(current_user.id),
            max_images=request.max_images,
        )

        # Сохраняем результаты в базе данных
        generated_images = []
        successful_generations = 0

        for i, result in enumerate(results):
            if result.success and i < len(descriptions_to_process):
                description = descriptions_to_process[i]

                # Create HTTP URL from local_path
                filename = os.path.basename(result.local_path) if result.local_path else None
                http_url = f"/api/v1/images/file/{filename}" if filename else None

                generated_image = GeneratedImage(
                    description_id=description.id,
                    user_id=current_user.id,
                    service_used="imagen",
                    status="completed",
                    image_url=http_url,  # Store HTTP URL instead of data URL
                    local_path=result.local_path,
                    prompt_used=result.prompt_used or request.style_prompt or "default",
                    generation_time_seconds=result.generation_time_seconds,
                )

                db.add(generated_image)
                generated_images.append(
                    {
                        "description_id": str(description.id),
                        "description_type": description.type.value,
                        "image_url": http_url or result.image_url,
                        "generation_time": result.generation_time_seconds,
                    }
                )
                successful_generations += 1

        await db.commit()

        return {
            "chapter_id": str(chapter_id),
            "total_descriptions": len(all_descriptions),
            "processed": len(descriptions_to_process),
            "successful": successful_generations,
            "failed": len(descriptions_to_process) - successful_generations,
            "images": generated_images,
            "message": f"Generated {successful_generations} images for chapter",
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch generation failed: {str(e)}",
        )


@router.get("/images/description/{description_id}")
async def get_image_for_description(
    description_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, Any]:
    """
    Получает изображение для конкретного описания.

    Args:
        description_id: ID описания
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Данные изображения или 404 если не найдено

    Raises:
        HTTPException 404: Описание или изображение не найдено
    """
    # Получаем изображение с описанием и главой
    query = (
        select(GeneratedImage, Description, Chapter)
        .join(Description, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Description.id == description_id)
        .where(Book.user_id == current_user.id)
    )

    result = await db.execute(query)
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found for this description",
        )

    generated_image, description, chapter = row

    return {
        "id": str(generated_image.id),
        "image_url": generated_image.image_url,
        "created_at": generated_image.created_at.isoformat(),
        "generation_time_seconds": generated_image.generation_time_seconds,
        "service_used": generated_image.service_used or "imagen",
        "status": generated_image.status or "completed",
        "is_moderated": generated_image.is_moderated or False,
        "view_count": generated_image.view_count or 0,
        "download_count": generated_image.download_count or 0,
        "description": {
            "id": str(description.id),
            "type": description.type.value,
            "text": description.content,
            "content": (
                description.content[:100] + "..."
                if len(description.content) > 100
                else description.content
            ),
            "confidence_score": description.confidence_score,
            "priority_score": description.priority_score,
        },
        "chapter": {
            "id": str(chapter.id),
            "number": chapter.chapter_number,
            "title": chapter.title,
        },
    }


@router.get("/images/book/{book_id}")
async def get_book_images(
    book_id: UUID,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, Any]:
    """
    Получает все сгенерированные изображения для книги.

    Args:
        book_id: ID книги
        skip: Количество изображений для пропуска
        limit: Максимальное количество изображений
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Список изображений книги
    """
    # Проверяем доступ к книге
    book_result = await db.execute(
        select(Book).where(Book.id == book_id).where(Book.user_id == current_user.id)
    )
    book = book_result.scalar_one_or_none()

    if not book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Book not found or access denied",
        )

    # Получаем изображения
    images_query = (
        select(GeneratedImage, Description, Chapter)
        .join(Description, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .where(Chapter.book_id == book_id)
        .order_by(Chapter.chapter_number, Description.priority_score.desc())
        .offset(skip)
        .limit(limit)
    )

    images_result = await db.execute(images_query)
    images_data = []

    for generated_image, description, chapter in images_result.fetchall():
        images_data.append(
            {
                "id": str(generated_image.id),
                "image_url": generated_image.image_url,
                "created_at": generated_image.created_at.isoformat(),
                "generation_time_seconds": generated_image.generation_time_seconds,
                "description": {
                    "id": str(description.id),
                    "type": description.type.value,
                    "text": description.content,  # Полный текст
                    "content": (
                        description.content[:100] + "..."
                        if len(description.content) > 100
                        else description.content
                    ),  # Сокращенный для превью
                    "confidence_score": description.confidence_score,
                    "priority_score": description.priority_score,
                    "entities_mentioned": description.entities_mentioned,
                },
                "chapter": {
                    "id": str(chapter.id),
                    "number": chapter.chapter_number,
                    "title": chapter.title,
                },
            }
        )

    return {
        "book_id": str(book_id),
        "book_title": book.title,
        "images": images_data,
        "pagination": {"skip": skip, "limit": limit, "total_found": len(images_data)},
    }


@router.delete("/images/{image_id}")
async def delete_generated_image(
    image_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, str]:
    """
    Удаляет сгенерированное изображение.

    Args:
        image_id: ID изображения
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Сообщение об успешном удалении
    """
    # Проверяем, что изображение принадлежит пользователю
    image_result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id, GeneratedImage.user_id == current_user.id
        )
    )
    image = image_result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found or access denied",
        )

    try:
        # Удаляем локальный файл если он существует
        if image.local_path:
            import os

            try:
                os.unlink(image.local_path)
            except OSError:
                pass  # Файл уже удален или недоступен

        # Удаляем запись из базы данных
        await db.delete(image)
        await db.commit()

        return {"message": "Image deleted successfully"}

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete image: {str(e)}",
        )


@router.post("/images/regenerate/{image_id}")
async def regenerate_image(
    image_id: UUID,
    params: ImageGenerationParams,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Перегенерирует существующее изображение с новыми параметрами.

    Args:
        image_id: ID существующего изображения
        params: Новые параметры генерации
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Информация о новом сгенерированном изображении
    """
    # Получаем существующее изображение с проверкой прав доступа
    existing_image_result = await db.execute(
        select(GeneratedImage, Description)
        .join(Description, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(GeneratedImage.id == image_id)
        .where(Book.user_id == current_user.id)
    )

    result_row = existing_image_result.first()
    if not result_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found or access denied",
        )

    existing_image, description = result_row

    try:
        # Удаляем старый локальный файл если существует
        if existing_image.local_path:
            import os

            try:
                os.unlink(existing_image.local_path)
            except OSError:
                pass  # Файл уже удален или недоступен

        # Генерируем новое изображение (используем DI)
        generation_result = (
            await image_gen_svc.generate_image_for_description(
                description=description,
                user_id=str(current_user.id),
                custom_style=params.style_prompt,
            )
        )

        if not generation_result.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Image regeneration failed: {generation_result.error_message}",
            )

        # Обновляем существующую запись в базе данных
        existing_image.image_url = generation_result.image_url
        existing_image.local_path = generation_result.local_path
        existing_image.prompt_used = params.style_prompt or "default"
        existing_image.generation_time_seconds = (
            generation_result.generation_time_seconds
        )
        existing_image.updated_at = func.now()  # Обновляем время изменения

        await db.commit()
        await db.refresh(existing_image)

        return {
            "image_id": str(existing_image.id),
            "description_id": str(description.id),
            "image_url": generation_result.image_url,
            "generation_time": generation_result.generation_time_seconds,
            "status": "regenerated",
            "updated_at": existing_image.updated_at.isoformat(),
            "message": "Image regenerated successfully",
            "description": {
                "id": str(description.id),
                "type": description.type.value,
                "text": description.content,
                "content": (
                    description.content[:100] + "..."
                    if len(description.content) > 100
                    else description.content
                ),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during regeneration: {str(e)}",
        )


@router.get("/images/admin/stats")
async def get_admin_image_stats(
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Получение статистики генерации изображений для администраторов.

    Args:
        current_admin: Текущий администратор
        db: Сессия базы данных

    Returns:
        Подробная статистика системы генерации
    """
    from sqlalchemy import func

    # Общее количество сгенерированных изображений
    total_images = await db.execute(select(func.count(GeneratedImage.id)))
    total_count = total_images.scalar()

    # Статистика по типам описаний
    type_stats = await db.execute(
        select(Description.type, func.count(GeneratedImage.id).label("count"))
        .join(GeneratedImage, GeneratedImage.description_id == Description.id)
        .group_by(Description.type)
    )

    type_distribution = {row.type.value: row.count for row in type_stats.fetchall()}

    # Среднее время генерации
    avg_time = await db.execute(
        select(func.avg(GeneratedImage.generation_time_seconds)).where(
            GeneratedImage.generation_time_seconds.is_not(None)
        )
    )
    average_generation_time = avg_time.scalar() or 0

    # Получаем статистику сервиса (используем DI)
    service_stats = await image_gen_svc.get_generation_stats()

    return {
        "total_images_generated": total_count,
        "generation_by_type": type_distribution,
        "performance": {
            "average_generation_time_seconds": round(average_generation_time, 2),
            "current_queue_size": service_stats["queue_size"],
            "is_processing": service_stats["is_processing"],
        },
        "system_status": {
            "service_operational": True,
            "api_provider": "Google Imagen 4",
            "supported_types": service_stats["supported_types"],
            "queue_backend": service_stats.get("queue_backend", "celery_redis"),
        },
        "celery_stats": service_stats.get("celery_stats", {}),
    }


# ============================================================================
# ASYNC GENERATION ENDPOINTS (Celery-based queue)
# ============================================================================


class AsyncGenerationRequest(BaseModel):
    """Request for async image generation via Celery queue."""
    style_prompt: Optional[str] = None
    book_genre: Optional[str] = None


@router.post(
    "/images/generate/async/{description_id}",
    status_code=202,
    summary="Queue async image generation",
    description="Queues image generation as a background task. Returns task ID for status tracking."
)
async def queue_async_image_generation(
    description_id: UUID,
    request: AsyncGenerationRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Queue async image generation via Celery.

    Unlike the synchronous endpoint, this returns immediately with a task ID.
    The task is persisted in Redis and survives server restarts.

    Use GET /images/task/{task_id} to check status.

    Args:
        description_id: ID of the description to generate image for
        request: Generation parameters
        current_user: Current authenticated user
        db: Database session

    Returns:
        Task information with task_id for tracking

    Raises:
        HTTPException 404: Description not found or access denied
        HTTPException 409: Image already exists for this description
    """
    # Validate description access
    description_result = await db.execute(
        select(Description)
        .join(Chapter)
        .join(Book)
        .where(Description.id == description_id)
        .where(Book.user_id == current_user.id)
    )
    description = description_result.scalar_one_or_none()

    if not description:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Description not found or access denied",
        )

    # Check for existing image
    existing_image_result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.description_id == description_id)
    )
    if existing_image_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Image already exists for this description",
        )

    # Queue the generation task (используем DI)
    queue_result = image_gen_svc.queue_image_generation(
        description_id=str(description_id),
        user_id=str(current_user.id),
        description_content=description.content,
        description_type=description.type.value if hasattr(description.type, 'value') else str(description.type),
        book_genre=request.book_genre,
        custom_style=request.style_prompt,
    )

    return {
        **queue_result,
        "message": "Image generation queued. Use task_id to check status.",
        "status_url": f"/api/v1/images/task/{queue_result['task_id']}",
    }


@router.post(
    "/images/generate/async/chapter/{chapter_id}",
    status_code=202,
    summary="Queue batch async image generation",
    description="Queues batch image generation for a chapter as a background task."
)
async def queue_async_batch_generation(
    chapter_id: UUID,
    request: BatchGenerationRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Queue batch async image generation for a chapter via Celery.

    Args:
        chapter_id: ID of the chapter
        request: Batch generation parameters
        current_user: Current authenticated user
        db: Database session

    Returns:
        Task information with task_id for tracking
    """
    # Validate chapter access
    chapter_result = await db.execute(
        select(Chapter)
        .join(Book)
        .where(Chapter.id == chapter_id)
        .where(Book.user_id == current_user.id)
    )
    chapter = chapter_result.scalar_one_or_none()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found or access denied",
        )

    # Get book for genre
    book_result = await db.execute(
        select(Book).where(Book.id == chapter.book_id)
    )
    book = book_result.scalar_one_or_none()
    book_genre = book.genre if book else None

    # Get descriptions for this chapter
    descriptions_query = select(Description).where(Description.chapter_id == chapter_id)

    if request.description_types:
        descriptions_query = descriptions_query.where(
            Description.type.in_(request.description_types)
        )

    descriptions_result = await db.execute(
        descriptions_query.order_by(Description.priority_score.desc())
    )
    all_descriptions = descriptions_result.scalars().all()

    if not all_descriptions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No descriptions found in this chapter",
        )

    # Exclude descriptions with existing images
    existing_images = await db.execute(
        select(GeneratedImage.description_id).where(
            GeneratedImage.description_id.in_([d.id for d in all_descriptions])
        )
    )
    existing_desc_ids = set(img_id for img_id, in existing_images.fetchall())

    descriptions_to_process = [
        d for d in all_descriptions if d.id not in existing_desc_ids
    ][:request.max_images]

    if not descriptions_to_process:
        return {
            "message": "All suitable descriptions already have images",
            "chapter_id": str(chapter_id),
            "processed": 0,
            "skipped": len(all_descriptions),
        }

    # Prepare descriptions for Celery task
    descriptions_data = [
        {
            "id": str(d.id),
            "content": d.content,
            "type": d.type.value if hasattr(d.type, 'value') else str(d.type),
        }
        for d in descriptions_to_process
    ]

    # Queue the batch generation task (используем DI)
    queue_result = image_gen_svc.queue_batch_generation(
        chapter_id=str(chapter_id),
        user_id=str(current_user.id),
        descriptions=descriptions_data,
        book_genre=book_genre,
        max_images=request.max_images,
    )

    return {
        **queue_result,
        "total_descriptions": len(all_descriptions),
        "queued_for_processing": len(descriptions_to_process),
        "skipped_existing": len(existing_desc_ids),
        "status_url": f"/api/v1/images/task/{queue_result['task_id']}",
    }


@router.get(
    "/images/task/{task_id}",
    summary="Get async generation task status",
    description="Returns the status of an async image generation task."
)
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_active_user),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    """
    Get status of an async image generation task.

    Args:
        task_id: Celery task ID
        current_user: Current authenticated user

    Returns:
        Task status information including result if completed
    """
    # Получаем статус задачи (используем DI)
    status_info = image_gen_svc.get_task_status(task_id)

    # Add friendly status messages
    status_messages = {
        "PENDING": "Task is waiting in queue",
        "STARTED": "Task has started processing",
        "SUCCESS": "Task completed successfully",
        "FAILURE": "Task failed",
        "RETRY": "Task is being retried",
        "REVOKED": "Task was cancelled",
    }

    status_info["message"] = status_messages.get(
        status_info["status"],
        f"Task status: {status_info['status']}"
    )

    return status_info
