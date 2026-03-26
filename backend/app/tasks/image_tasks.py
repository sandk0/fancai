"""
Image generation Celery tasks.
"""

from app.core.celery_app import celery_app
from typing import Dict, Any, List, Optional
from uuid import UUID
from sqlalchemy import select

import asyncio

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.chapter import Chapter
from app.services.modal_client import MODAL_AVAILABLE, get_image_generator
from app.services.push_notification_service import push_notification_service
from app.tasks.common import run_async


@celery_app.task(
    name="generate_image_task",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def generate_image_task(
    self,
    description_id_str: str,
    user_id_str: str,
    description_content: str,
    description_type: str = "location",
    book_genre: Optional[str] = None,
    custom_style: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Celery task for image generation with Redis-backed persistence.

    Replaces in-memory queue with persistent Celery queue.
    Supports automatic retries with exponential backoff.

    Args:
        description_id_str: String ID of the description (UUID)
        user_id_str: String ID of the user (UUID)
        description_content: Text content of the description
        description_type: Type of description (location, character, atmosphere)
        book_genre: Genre of the book for style adaptation
        custom_style: Custom style instructions

    Returns:
        Dict with generation result including image_url or error
    """
    task_id = self.request.id
    logger.info(
        "Starting image generation task",
        task_id=task_id,
        description_id=description_id_str,
        attempt=self.request.retries + 1,
    )

    try:
        description_id = UUID(description_id_str)
        user_id = UUID(user_id_str)

        result = run_async(
            _generate_image_async(
                task_id=task_id,
                description_id=description_id,
                user_id=user_id,
                description_content=description_content,
                description_type=description_type,
                book_genre=book_genre,
                custom_style=custom_style,
            )
        )

        logger.info(
            "Image generation task completed",
            task_id=task_id,
            success=result.get("success", False),
        )
        return result

    except Exception as e:
        logger.error(
            "Image generation failed",
            task_id=task_id,
            description_id=description_id_str,
            error=str(e),
        )

        if self.request.retries < self.max_retries:
            logger.info(
                "Will retry image generation",
                task_id=task_id,
                attempt=self.request.retries + 1,
                max_retries=self.max_retries + 1,
            )
            raise

        return {
            "task_id": task_id,
            "description_id": description_id_str,
            "success": False,
            "error": str(e),
            "status": "failed",
            "retries": self.request.retries,
        }


async def _generate_image_async(
    task_id: str,
    description_id: UUID,
    user_id: UUID,
    description_content: str,
    description_type: str,
    book_genre: Optional[str] = None,
    custom_style: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Async function for image generation within Celery task.

    Handles the actual image generation and database persistence.
    """
    from app.models.image import GeneratedImage
    import os

    async with AsyncSessionLocal() as db:
        logger.debug("Starting async image generation", task_id=task_id)

        # Проверяем флаг USE_MODAL_PIPELINE — если включён, используем Modal
        use_modal = False
        if MODAL_AVAILABLE:
            from app.services.feature_flag_manager import FeatureFlagManager

            flag_mgr = FeatureFlagManager(db)
            await flag_mgr.initialize()
            use_modal = await flag_mgr.is_enabled("USE_MODAL_PIPELINE", default=False)

        if use_modal:
            # Modal ImageGenerator — приоритет: предвычисленный image_prompt_en из БД
            from app.models.description import Description as DescriptionModel

            prompt_en = None
            desc_result = await db.execute(
                select(DescriptionModel).where(DescriptionModel.id == description_id)
            )
            desc_obj = desc_result.scalar_one_or_none()
            if desc_obj and desc_obj.image_prompt_en:
                prompt_en = desc_obj.image_prompt_en

            if not prompt_en:
                # Фолбэк: строим промпт через существующий PromptTranslator
                from app.services.imagen_generator import get_imagen_service

                _fallback_service = get_imagen_service()
                prompt_en = await _fallback_service._prompt_engineer.create_prompt(
                    description=description_content,
                    description_type=description_type,
                    genre=book_genre,
                    custom_style=custom_style,
                )

            generator = get_image_generator()
            image_bytes = await asyncio.to_thread(
                generator.generate.remote, prompt=prompt_en
            )

            # Сохраняем файл на диск
            import hashlib
            import time as time_mod
            from pathlib import Path

            filename = (
                f"flux_{int(time_mod.time())}"
                f"_{hashlib.md5(prompt_en.encode()).hexdigest()[:8]}.png"
            )
            storage_dir = Path("/app/storage/generated_images")
            storage_dir.mkdir(parents=True, exist_ok=True)
            local_path = storage_dir / filename
            local_path.write_bytes(image_bytes)

            # Записываем результат в БД
            generated_image = GeneratedImage(
                description_id=description_id,
                user_id=user_id,
                service_used="modal_flux",
                status="completed",
                image_url=f"/api/v1/images/file/{filename}",
                local_path=str(local_path),
                prompt_used=prompt_en,
            )
            db.add(generated_image)
            await db.commit()
            await db.refresh(generated_image)

            # Помечаем описание как сгенерированное
            if desc_obj:
                desc_obj.image_generated = True
                desc_obj.generation_requested = False
                await db.commit()

            logger.info(
                "Modal image generated and saved",
                task_id=task_id,
                filename=filename,
            )
            return {
                "task_id": task_id,
                "image_id": str(generated_image.id),
                "description_id": str(description_id),
                "success": True,
                "image_url": f"/api/v1/images/file/{filename}",
                "local_path": str(local_path),
                "prompt_used": prompt_en,
                "service": "modal_flux",
                "status": "completed",
            }

        # --- Существующий путь через OpenRouter (без изменений) ---
        from app.services.imagen_generator import get_imagen_service

        imagen_service = get_imagen_service()

        if not imagen_service.is_available():
            logger.warning("Imagen service not available", task_id=task_id)
            return {
                "task_id": task_id,
                "description_id": str(description_id),
                "success": False,
                "error": "Image generation service not available. Check OPENROUTER_API_KEY.",
                "status": "service_unavailable",
            }

        generation_result = await imagen_service.generate_image(
            description=description_content,
            description_type=description_type,
            genre=book_genre,
            custom_style=custom_style,
        )

        if generation_result.success:
            logger.info(
                "Image generated successfully",
                task_id=task_id,
                local_path=generation_result.local_path,
            )

            filename = (
                os.path.basename(generation_result.local_path)
                if generation_result.local_path
                else None
            )
            http_url = f"/api/v1/images/file/{filename}" if filename else None

            generated_image = GeneratedImage(
                description_id=description_id,
                user_id=user_id,
                service_used="imagen",
                status="completed",
                image_url=http_url,
                local_path=generation_result.local_path,
                prompt_used=generation_result.prompt_used or custom_style or "default",
                generation_time_seconds=generation_result.generation_time_seconds,
            )

            db.add(generated_image)
            await db.commit()
            await db.refresh(generated_image)

            logger.info(
                "Image saved to DB",
                task_id=task_id,
                image_id=str(generated_image.id),
            )

            try:
                from app.models.description import Description

                desc_result = await db.execute(
                    select(Description).where(Description.id == description_id)
                )
                description_obj = desc_result.scalar_one_or_none()

                if description_obj:
                    chapter_result = await db.execute(
                        select(Chapter).where(Chapter.id == description_obj.chapter_id)
                    )
                    chapter_obj = chapter_result.scalar_one_or_none()

                    if chapter_obj:
                        await push_notification_service.send_image_ready_notification(
                            db=db,
                            user_id=user_id,
                            book_id=chapter_obj.book_id,
                            description_id=description_id,
                            image_count=1,
                        )
                        logger.debug(
                            "Push notification sent for image ready", task_id=task_id
                        )
            except Exception as e:
                logger.warning(
                    "Failed to send image ready push notification", error=str(e)
                )

            return {
                "task_id": task_id,
                "image_id": str(generated_image.id),
                "description_id": str(description_id),
                "image_url": http_url or generation_result.image_url,
                "local_path": generation_result.local_path,
                "generation_time": generation_result.generation_time_seconds,
                "success": True,
                "status": "completed",
            }
        else:
            logger.error(
                "Image generation failed",
                task_id=task_id,
                error=generation_result.error_message,
            )
            return {
                "task_id": task_id,
                "description_id": str(description_id),
                "success": False,
                "error": generation_result.error_message,
                "status": "failed",
            }


@celery_app.task(
    name="generate_image_batch_task",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def generate_image_batch_task(
    self,
    chapter_id_str: str,
    user_id_str: str,
    descriptions: List[Dict[str, Any]],
    book_genre: Optional[str] = None,
    max_images: int = 5,
) -> Dict[str, Any]:
    """
    Celery task for batch image generation for a chapter.

    Processes multiple descriptions and generates images for each.
    Uses Redis for persistence and supports retries.

    Args:
        chapter_id_str: String ID of the chapter (UUID)
        user_id_str: String ID of the user (UUID)
        descriptions: List of description dicts with id, content, type
        book_genre: Genre of the book for style adaptation
        max_images: Maximum number of images to generate

    Returns:
        Dict with batch generation results
    """
    task_id = self.request.id
    logger.info(
        "Starting batch image generation",
        task_id=task_id,
        chapter_id=chapter_id_str,
        descriptions_count=len(descriptions),
    )

    try:
        result = run_async(
            _generate_batch_async(
                task_id=task_id,
                chapter_id_str=chapter_id_str,
                user_id_str=user_id_str,
                descriptions=descriptions[:max_images],
                book_genre=book_genre,
            )
        )

        logger.info(
            "Batch image generation completed",
            task_id=task_id,
            successful=result.get("successful", 0),
            total=result.get("total", 0),
        )
        return result

    except Exception as e:
        logger.error(
            "Batch generation failed",
            task_id=task_id,
            chapter_id=chapter_id_str,
            error=str(e),
        )

        if self.request.retries < self.max_retries:
            raise self.retry(exc=e)

        return {
            "task_id": task_id,
            "chapter_id": chapter_id_str,
            "success": False,
            "error": str(e),
            "status": "failed",
        }


async def _generate_batch_async(
    task_id: str,
    chapter_id_str: str,
    user_id_str: str,
    descriptions: List[Dict[str, Any]],
    book_genre: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Async function for batch image generation within Celery task.
    """
    from app.services.imagen_generator import get_imagen_service
    from app.models.image import GeneratedImage
    import os
    import asyncio

    async with AsyncSessionLocal() as db:
        user_id = UUID(user_id_str)

        imagen_service = get_imagen_service()

        if not imagen_service.is_available():
            return {
                "task_id": task_id,
                "chapter_id": chapter_id_str,
                "success": False,
                "error": "Image generation service not available",
                "status": "service_unavailable",
            }

        results = []
        successful = 0
        failed = 0

        for desc_data in descriptions:
            try:
                description_id = UUID(desc_data["id"])
                description_content = desc_data["content"]
                description_type = desc_data.get("type", "location")

                generation_result = await imagen_service.generate_image(
                    description=description_content,
                    description_type=description_type,
                    genre=book_genre,
                )

                if generation_result.success:
                    filename = (
                        os.path.basename(generation_result.local_path)
                        if generation_result.local_path
                        else None
                    )
                    http_url = f"/api/v1/images/file/{filename}" if filename else None

                    generated_image = GeneratedImage(
                        description_id=description_id,
                        user_id=user_id,
                        service_used="imagen",
                        status="completed",
                        image_url=http_url,
                        local_path=generation_result.local_path,
                        prompt_used=generation_result.prompt_used or "default",
                        generation_time_seconds=generation_result.generation_time_seconds,
                    )

                    db.add(generated_image)

                    results.append(
                        {
                            "description_id": str(description_id),
                            "description_type": description_type,
                            "image_url": http_url or generation_result.image_url,
                            "generation_time": generation_result.generation_time_seconds,
                            "success": True,
                        }
                    )
                    successful += 1
                else:
                    results.append(
                        {
                            "description_id": str(description_id),
                            "error": generation_result.error_message,
                            "success": False,
                        }
                    )
                    failed += 1

                await asyncio.sleep(2)

            except Exception as e:
                logger.error(
                    "Error generating for description",
                    description_id=desc_data.get("id", "unknown"),
                    error=str(e),
                )
                results.append(
                    {
                        "description_id": desc_data.get("id", "unknown"),
                        "error": str(e),
                        "success": False,
                    }
                )
                failed += 1

        await db.commit()

        return {
            "task_id": task_id,
            "chapter_id": chapter_id_str,
            "total": len(descriptions),
            "successful": successful,
            "failed": failed,
            "results": results,
            "success": successful > 0,
            "status": "completed",
        }
