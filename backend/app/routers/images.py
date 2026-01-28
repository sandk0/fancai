"""
API роуты для генерации изображений в fancai.
Thin router layer - delegates to ImageCRUDService and ImageGeneratorService.
"""

from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from uuid import UUID
from pydantic import BaseModel
from pathlib import Path
import os
from loguru import logger

from ..utils.etag import check_conditional_request, get_mime_type_from_extension
from ..core.database import get_database_session
from ..core.auth import get_current_active_user, get_current_admin_user
from ..services.image_generator import ImageGeneratorService
from ..services.image_crud_service import ImageCRUDService
from ..core.container import get_image_generator_service_dep
from ..models.user import User
from ..models.description import DescriptionType
from ..schemas.responses.images import (
    ImageGenerationStatusResponse,
    UserImageStatsResponse,
    ImageGenerationSuccessResponse,
    QueueStats,
    UserGenerationInfo,
    APIProviderInfo,
)

router = APIRouter()
GENERATED_IMAGES_DIR = Path("/app/storage/generated_images")


def get_image_service(db: AsyncSession) -> ImageCRUDService:
    return ImageCRUDService(db)


class ImageGenerationParams(BaseModel):
    style_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    width: Optional[int] = 1024
    height: Optional[int] = 768


class BatchGenerationRequest(BaseModel):
    chapter_id: UUID
    max_images: int = 5
    style_prompt: Optional[str] = None
    description_types: Optional[List[DescriptionType]] = None


class AsyncGenerationRequest(BaseModel):
    style_prompt: Optional[str] = None
    book_genre: Optional[str] = None


@router.get("/images/file/{filename}")
async def get_generated_image_file(
    filename: str,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")
    
    file_path = GENERATED_IMAGES_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    
    service = get_image_service(db)
    
    image = await service.get_by_local_path(str(file_path))
    if not image:
        api_path = f"/api/v1/images/file/{filename}"
        image = await service.get_by_image_url(api_path)
    
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found in database")
    
    if not service.verify_ownership(image, current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    should_304, etag, last_modified = check_conditional_request(
        file_path=file_path,
        if_none_match=request.headers.get("if-none-match"),
        if_modified_since=request.headers.get("if-modified-since"),
    )
    
    cache_control = "public, max-age=31536000, immutable"
    
    if should_304:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Last-Modified": last_modified, "Cache-Control": cache_control},
        )
    
    return FileResponse(
        path=str(file_path),
        media_type=get_mime_type_from_extension(file_path),
        content_disposition_type="inline",
        headers={"ETag": etag, "Last-Modified": last_modified, "Cache-Control": cache_control},
    )


@router.get("/images/generation/status", response_model=ImageGenerationStatusResponse)
async def get_generation_status(
    current_user: User = Depends(get_current_active_user),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> ImageGenerationStatusResponse:
    stats = await image_gen_svc.get_generation_stats()
    
    return ImageGenerationStatusResponse(
        status="operational",
        queue_stats=QueueStats(
            pending_tasks=stats.get("queue_size", 0),
            processing_tasks=1 if stats.get("is_processing", False) else 0,
            completed_today=0,
            failed_today=0,
        ),
        user_info=UserGenerationInfo(
            id=current_user.id,
            can_generate=current_user.is_active,
            remaining_quota=None,
        ),
        api_info=APIProviderInfo(
            provider="Google Imagen 4",
            supported_formats=["PNG"],
            max_resolution="1024x1024",
            estimated_time_per_image="5-15 seconds",
        ),
    )


@router.get("/images/user/stats", response_model=UserImageStatsResponse)
async def get_user_images_stats(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> UserImageStatsResponse:
    service = get_image_service(db)
    stats = await service.get_user_full_stats(current_user.id)
    
    total_images = stats["total_images"]
    total_descriptions = stats["total_descriptions"]
    images_by_type = stats["images_by_type"]
    
    return UserImageStatsResponse(
        total_images_generated=total_images if isinstance(total_images, int) else 0,
        total_descriptions_found=total_descriptions if isinstance(total_descriptions, int) else 0,
        images_by_type=images_by_type if isinstance(images_by_type, dict) else {},
    )


@router.post("/images/generate/description/{description_id}", response_model=ImageGenerationSuccessResponse, status_code=201)
async def generate_image_for_description(
    description_id: UUID,
    params: ImageGenerationParams,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> ImageGenerationSuccessResponse:
    service = get_image_service(db)
    
    description = await service.get_description_with_access_check(description_id, current_user.id)
    if not description:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Description not found or access denied")
    
    if await service.exists_for_description(description_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image already exists for this description")
    
    try:
        result = await image_gen_svc.generate_image_for_description(
            description=description,
            user_id=str(current_user.id),
            custom_style=params.style_prompt,
        )
        
        if not result.success:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Generation failed: {result.error_message}")
        
        filename = os.path.basename(result.local_path) if result.local_path else None
        http_url = f"/api/v1/images/file/{filename}" if filename else None
        
        image = await service.create(
            description_id=description.id,
            user_id=current_user.id,
            image_url=http_url,
            local_path=result.local_path,
            prompt_used=result.prompt_used or params.style_prompt or "default",
            generation_time_seconds=result.generation_time_seconds,
            chapter_id=description.chapter_id,
        )
        
        return ImageGenerationSuccessResponse(
            image_id=image.id,
            description_id=description.id,
            image_url=http_url or result.image_url or "",
            generation_time=result.generation_time_seconds or 0.0,
            status="completed",
            created_at=image.created_at.isoformat(),
            message="Image generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating image for description: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred during image generation")


@router.post("/images/generate/chapter/{chapter_id}")
async def generate_images_for_chapter(
    chapter_id: UUID,
    request: BatchGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    service = get_image_service(db)
    
    chapter = await service.get_chapter_with_access_check(chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found or access denied")
    
    all_descriptions = await service.get_chapter_descriptions(chapter_id, request.description_types)
    if not all_descriptions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No descriptions found in this chapter")
    
    existing = await service.get_batch_existing([d.id for d in all_descriptions])
    descriptions_to_process = [d for d in all_descriptions if d.id not in existing][:request.max_images]
    
    if not descriptions_to_process:
        return {"message": "All suitable descriptions already have images", "chapter_id": str(chapter_id), "processed": 0, "skipped": len(all_descriptions)}
    
    descriptions_dicts = [
        {
            "id": str(d.id),
            "content": d.content,
            "type": d.type.value if hasattr(d.type, 'value') else str(d.type),
            "priority_score": d.priority_score,
        }
        for d in descriptions_to_process
    ]
    
    try:
        results = await image_gen_svc.batch_generate_for_chapter(
            descriptions=descriptions_dicts,
            user_id=str(current_user.id),
            max_images=request.max_images,
        )
        
        generated_images = []
        successful_generations = 0
        
        for i, result in enumerate(results):
            if result.success and i < len(descriptions_to_process):
                desc = descriptions_to_process[i]
                filename = os.path.basename(result.local_path) if result.local_path else None
                http_url = f"/api/v1/images/file/{filename}" if filename else None
                
                await service.create(
                    description_id=desc.id,
                    user_id=current_user.id,
                    image_url=http_url,
                    local_path=result.local_path,
                    prompt_used=result.prompt_used or request.style_prompt or "default",
                    generation_time_seconds=result.generation_time_seconds,
                    chapter_id=chapter_id,
                )
                
                generated_images.append({
                    "description_id": str(desc.id),
                    "description_type": desc.type.value,
                    "image_url": http_url or result.image_url,
                    "generation_time": result.generation_time_seconds,
                })
                successful_generations += 1
        
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
        logger.exception(f"Batch generation failed: {e}")
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred during batch generation")


@router.get("/images/description/{description_id}")
async def get_image_for_description(
    description_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, Any]:
    service = get_image_service(db)
    
    result = await service.get_image_with_relations(description_id, current_user.id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found for this description")
    
    image, description, chapter = result
    
    return {
        "id": str(image.id),
        "image_url": image.image_url,
        "created_at": image.created_at.isoformat(),
        "generation_time_seconds": image.generation_time_seconds,
        "service_used": image.service_used or "imagen",
        "status": image.status or "completed",
        "is_moderated": image.is_moderated or False,
        "view_count": image.view_count or 0,
        "download_count": image.download_count or 0,
        "description": {
            "id": str(description.id),
            "type": description.type.value,
            "text": description.content,
            "content": description.content[:100] + "..." if len(description.content) > 100 else description.content,
            "confidence_score": description.confidence_score,
            "priority_score": description.priority_score,
        },
        "chapter": {"id": str(chapter.id), "number": chapter.chapter_number, "title": chapter.title},
    }


@router.get("/images/book/{book_id}")
async def get_book_images(
    book_id: UUID,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, Any]:
    from ..models.book import Book
    from sqlalchemy import select
    
    book_result = await db.execute(select(Book).where(Book.id == book_id).where(Book.user_id == current_user.id))
    book = book_result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found or access denied")
    
    service = get_image_service(db)
    images_data = await service.get_for_book(book_id, current_user.id, skip, limit)
    
    result_images = []
    for image, description, chapter in images_data:
        result_images.append({
            "id": str(image.id),
            "image_url": image.image_url,
            "created_at": image.created_at.isoformat(),
            "generation_time_seconds": image.generation_time_seconds,
            "description": {
                "id": str(description.id),
                "type": description.type.value,
                "text": description.content,
                "content": description.content[:100] + "..." if len(description.content) > 100 else description.content,
                "confidence_score": description.confidence_score,
                "priority_score": description.priority_score,
            },
            "chapter": {"id": str(chapter.id), "number": chapter.chapter_number, "title": chapter.title},
        })
    
    return {
        "book_id": str(book_id),
        "book_title": book.title,
        "images": result_images,
        "pagination": {"skip": skip, "limit": limit, "total_found": len(result_images)},
    }


@router.delete("/images/{image_id}")
async def delete_generated_image(
    image_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> Dict[str, str]:
    service = get_image_service(db)
    
    deleted = await service.delete_with_file(image_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found or access denied")
    
    return {"message": "Image deleted successfully"}


@router.post("/images/regenerate/{image_id}")
async def regenerate_image(
    image_id: UUID,
    params: ImageGenerationParams,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    from ..models.image import GeneratedImage
    from ..models.description import Description
    from ..models.chapter import Chapter
    from ..models.book import Book
    from sqlalchemy import select
    
    result = await db.execute(
        select(GeneratedImage, Description)
        .join(Description, GeneratedImage.description_id == Description.id)
        .join(Chapter, Description.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(GeneratedImage.id == image_id)
        .where(Book.user_id == current_user.id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found or access denied")
    
    existing_image, description = row
    
    try:
        gen_result = await image_gen_svc.generate_image_for_description(
            description=description,
            user_id=str(current_user.id),
            custom_style=params.style_prompt,
        )
        
        if not gen_result.success:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Regeneration failed: {gen_result.error_message}")
        
        service = get_image_service(db)
        updated_image = await service.update_after_regeneration(
            image=existing_image,
            image_url=gen_result.image_url,
            local_path=gen_result.local_path,
            prompt_used=params.style_prompt or "default",
            generation_time_seconds=gen_result.generation_time_seconds,
        )
        
        return {
            "image_id": str(updated_image.id),
            "description_id": str(description.id),
            "image_url": gen_result.image_url,
            "generation_time": gen_result.generation_time_seconds,
            "status": "regenerated",
            "updated_at": updated_image.updated_at.isoformat() if updated_image.updated_at else None,
            "message": "Image regenerated successfully",
            "description": {
                "id": str(description.id),
                "type": description.type.value,
                "text": description.content,
                "content": description.content[:100] + "..." if len(description.content) > 100 else description.content,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error regenerating image: {e}")
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An internal error occurred during image regeneration")


@router.get("/images/admin/stats")
async def get_admin_image_stats(
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    service = get_image_service(db)
    stats = await service.get_admin_stats()
    service_stats = await image_gen_svc.get_generation_stats()
    
    return {
        "total_images_generated": stats["total_images"],
        "generation_by_type": stats["type_distribution"],
        "performance": {
            "average_generation_time_seconds": stats["avg_generation_time"],
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


@router.post("/images/generate/async/{description_id}", status_code=202)
async def queue_async_image_generation(
    description_id: UUID,
    request: AsyncGenerationRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    service = get_image_service(db)
    
    description = await service.get_description_with_access_check(description_id, current_user.id)
    if not description:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Description not found or access denied")
    
    if await service.exists_for_description(description_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image already exists for this description")
    
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


@router.post("/images/generate/async/chapter/{chapter_id}", status_code=202)
async def queue_async_batch_generation(
    chapter_id: UUID,
    request: BatchGenerationRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    service = get_image_service(db)
    
    chapter = await service.get_chapter_with_access_check(chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found or access denied")
    
    book = await service.get_book_for_chapter(chapter_id)
    book_genre = book.genre if book else None
    
    all_descriptions = await service.get_chapter_descriptions(chapter_id, request.description_types)
    if not all_descriptions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No descriptions found in this chapter")
    
    existing = await service.get_batch_existing([d.id for d in all_descriptions])
    descriptions_to_process = [d for d in all_descriptions if d.id not in existing][:request.max_images]
    
    if not descriptions_to_process:
        return {"message": "All suitable descriptions already have images", "chapter_id": str(chapter_id), "processed": 0, "skipped": len(all_descriptions)}
    
    descriptions_data = [
        {"id": str(d.id), "content": d.content, "type": d.type.value if hasattr(d.type, 'value') else str(d.type)}
        for d in descriptions_to_process
    ]
    
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
        "skipped_existing": len(existing),
        "status_url": f"/api/v1/images/task/{queue_result['task_id']}",
    }


@router.get("/images/task/{task_id}")
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_active_user),
    image_gen_svc: ImageGeneratorService = Depends(get_image_generator_service_dep),
) -> Dict[str, Any]:
    status_info = image_gen_svc.get_task_status(task_id)
    
    status_messages = {
        "PENDING": "Task is waiting in queue",
        "STARTED": "Task has started processing",
        "SUCCESS": "Task completed successfully",
        "FAILURE": "Task failed",
        "RETRY": "Task is being retried",
        "REVOKED": "Task was cancelled",
    }
    
    status_info["message"] = status_messages.get(status_info["status"], f"Task status: {status_info['status']}")
    return status_info
