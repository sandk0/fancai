"""
Image Generation Service for fancai.

Uses Google Imagen 4 API for high-quality image generation from book descriptions.
Replaces legacy Pollinations.ai integration.

Features:
- Automatic Russian -> English prompt translation
- Type-specific style templates (location, character, atmosphere)
- Genre-aware styling
- Batch generation support
- Celery-based persistent queue (replaces in-memory queue)

Architecture (December 2025):
- Synchronous generation: Direct calls to Imagen service for immediate results
- Async queue: Celery tasks with Redis backend for persistent queue
- Retry logic: Automatic retries with exponential backoff
"""

import asyncio
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
import logging

from ..models.description import Description, DescriptionType
from .imagen_generator import (
    get_imagen_service,
    ImageGenerationResult as ImagenResult,
    ImagenService,
)

logger = logging.getLogger(__name__)


@dataclass
class ImageGenerationRequest:
    """Request for image generation."""

    description_content: str
    description_type: DescriptionType
    chapter_id: str
    user_id: str
    book_genre: Optional[str] = None
    style_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None  # Not used by Imagen, kept for compatibility


@dataclass
class ImageGenerationResult:
    """Result of image generation."""

    success: bool
    image_url: Optional[str] = None
    local_path: Optional[str] = None
    error_message: Optional[str] = None
    generation_time_seconds: Optional[float] = None
    model_used: Optional[str] = None
    prompt_used: Optional[str] = None

    @classmethod
    def from_imagen_result(cls, result: ImagenResult) -> "ImageGenerationResult":
        """Convert from Imagen result."""
        return cls(
            success=result.success,
            image_url=result.image_url,
            local_path=result.local_path,
            error_message=result.error_message,
            generation_time_seconds=result.generation_time_seconds,
            model_used=result.model_used,
            prompt_used=result.prompt_used,
        )


class ImageGeneratorService:
    """
    Main service for generating images from book descriptions.

    Uses Google Imagen 4 for high-quality image generation.

    Queue Architecture (December 2025):
    - Replaced in-memory queue with Celery tasks
    - Queue persisted in Redis (survives server restarts)
    - Automatic retries with exponential backoff
    - Task status tracking via Celery result backend
    """

    def __init__(self):
        self.imagen_service: ImagenService = get_imagen_service()
        # REMOVED: in-memory queue (was: self.generation_queue = [])
        # REMOVED: self.is_processing flag
        # Now using Celery tasks with Redis persistence

        if self.imagen_service.is_available():
            logger.info(
                "ImageGeneratorService initialized with Google Imagen + Celery queue"
            )
        else:
            logger.warning("ImageGeneratorService: Imagen not available")

    async def generate_image_for_description(
        self,
        description: Description,
        user_id: str,
        book_genre: Optional[str] = None,
        custom_style: Optional[str] = None,
    ) -> ImageGenerationResult:
        """
        Generate image for a description from the database.

        Args:
            description: Description model from database
            user_id: ID of requesting user
            book_genre: Genre for style adaptation
            custom_style: Additional style instructions

        Returns:
            ImageGenerationResult with image URL or error
        """
        if not self.imagen_service.is_available():
            return ImageGenerationResult(
                success=False,
                error_message="Image generation service not available. Check OPENROUTER_API_KEY.",
            )

        # Generate using Imagen
        result = await self.imagen_service.generate_image(
            description=description.content,
            description_type=(
                description.type.value
                if hasattr(description.type, "value")
                else str(description.type)
            ),
            genre=book_genre,
            custom_style=custom_style,
        )

        logger.info(
            f"Image generation for description {description.id}: success={result.success}"
        )

        return ImageGenerationResult.from_imagen_result(result)

    async def generate_image_from_text(
        self,
        text: str,
        description_type: str = "location",
        genre: Optional[str] = None,
        custom_style: Optional[str] = None,
    ) -> ImageGenerationResult:
        """
        Generate image from raw text (for direct API calls).

        Args:
            text: Russian description text
            description_type: Type of description
            genre: Book genre
            custom_style: Additional style

        Returns:
            ImageGenerationResult
        """
        if not self.imagen_service.is_available():
            return ImageGenerationResult(
                success=False, error_message="Image generation service not available"
            )

        result = await self.imagen_service.generate_image(
            description=text,
            description_type=description_type,
            genre=genre,
            custom_style=custom_style,
        )

        return ImageGenerationResult.from_imagen_result(result)

    async def batch_generate_for_chapter(
        self,
        descriptions: List[Dict[str, Any]],
        user_id: str,
        book_genre: Optional[str] = None,
        max_images: int = 5,
    ) -> List[ImageGenerationResult]:
        """
        Generate images for a list of descriptions from a chapter.

        Args:
            descriptions: List of description dicts to generate images for
            user_id: ID of requesting user
            book_genre: Genre for style adaptation
            max_images: Maximum number of images to generate

        Returns:
            List of ImageGenerationResult
        """
        # Sort by priority and take top N
        sorted_descriptions = sorted(
            descriptions, key=lambda d: d.get("priority_score", 0), reverse=True
        )[:max_images]

        results = []

        for desc in sorted_descriptions:
            try:
                result = await self.generate_image_for_description(
                    desc, user_id, book_genre
                )
                results.append(result)

                # Small delay between requests to avoid rate limiting
                if len(results) < len(sorted_descriptions):
                    await asyncio.sleep(1)

            except Exception as e:
                logger.error(f"Error generating image for description: {e}")
                results.append(
                    ImageGenerationResult(
                        success=False, error_message=f"Generation error: {str(e)}"
                    )
                )

        return results

    def add_to_queue(self, request: ImageGenerationRequest) -> str:
        """
        Add request to Celery generation queue.

        Returns the Celery task ID for tracking.

        Args:
            request: ImageGenerationRequest with all generation parameters

        Returns:
            Celery task ID (UUID string)
        """
        from ..core.tasks import generate_image_task

        # Submit to Celery queue
        task = generate_image_task.delay(
            description_id_str=request.chapter_id,  # Note: repurposed for description_id
            user_id_str=request.user_id,
            description_content=request.description_content,
            description_type=(
                request.description_type.value
                if hasattr(request.description_type, "value")
                else str(request.description_type)
            ),
            book_genre=request.book_genre,
            custom_style=request.style_prompt,
        )

        logger.info(f"Added to Celery queue. Task ID: {task.id}")
        return task.id

    def queue_image_generation(
        self,
        description_id: str,
        user_id: str,
        description_content: str,
        description_type: str = "location",
        book_genre: Optional[str] = None,
        custom_style: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Queue image generation as a Celery task.

        This is the primary method for async image generation.
        Task is persisted in Redis and survives server restarts.

        Args:
            description_id: UUID string of the description
            user_id: UUID string of the user
            description_content: Text content of the description
            description_type: Type of description (location, character, etc.)
            book_genre: Genre for style adaptation
            custom_style: Custom style instructions

        Returns:
            Dict with task_id and status for tracking
        """
        from ..core.tasks import generate_image_task

        task = generate_image_task.delay(
            description_id_str=description_id,
            user_id_str=user_id,
            description_content=description_content,
            description_type=description_type,
            book_genre=book_genre,
            custom_style=custom_style,
        )

        logger.info(f"Image generation queued. Task ID: {task.id}")

        return {
            "task_id": task.id,
            "status": "queued",
            "description_id": description_id,
            "message": "Image generation task submitted to queue",
        }

    def queue_batch_generation(
        self,
        chapter_id: str,
        user_id: str,
        descriptions: List[Dict[str, Any]],
        book_genre: Optional[str] = None,
        max_images: int = 5,
    ) -> Dict[str, Any]:
        """
        Queue batch image generation as a Celery task.

        Args:
            chapter_id: UUID string of the chapter
            user_id: UUID string of the user
            descriptions: List of description dicts with id, content, type
            book_genre: Genre for style adaptation
            max_images: Maximum number of images to generate

        Returns:
            Dict with task_id and status for tracking
        """
        from ..core.tasks import generate_image_batch_task

        task = generate_image_batch_task.delay(
            chapter_id_str=chapter_id,
            user_id_str=user_id,
            descriptions=descriptions,
            book_genre=book_genre,
            max_images=max_images,
        )

        logger.info(
            f"Batch generation queued. Task ID: {task.id}, {len(descriptions)} descriptions"
        )

        return {
            "task_id": task.id,
            "status": "queued",
            "chapter_id": chapter_id,
            "descriptions_count": len(descriptions),
            "message": "Batch generation task submitted to queue",
        }

    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """
        Get status of a queued image generation task.

        Args:
            task_id: Celery task ID

        Returns:
            Dict with task status and result if available
        """
        from celery.result import AsyncResult

        result = AsyncResult(task_id)

        status_info = {
            "task_id": task_id,
            "status": result.status,
            "ready": result.ready(),
        }

        if result.ready():
            if result.successful():
                status_info["result"] = result.result
            elif result.failed():
                status_info["error"] = str(result.result)

        return status_info

    async def process_queue(self):
        """
        Legacy method - now handled by Celery workers.

        Kept for backward compatibility but does nothing.
        Queue processing is now automatic via Celery.
        """
        logger.info(
            "process_queue() called - now handled by Celery workers automatically"
        )

    async def preview_prompt(
        self,
        description: str,
        description_type: str = "location",
        genre: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Preview English prompt without generating image.

        Useful for debugging and testing.
        """
        if not self.imagen_service.is_available():
            return {"error": "Service not available"}

        return await self.imagen_service.preview_prompt(
            description=description, description_type=description_type, genre=genre
        )

    async def get_generation_stats(self) -> Dict[str, Any]:
        """
        Get generation service statistics.

        Returns:
            Dictionary with service status and statistics
        """
        status = self.imagen_service.get_status() if self.imagen_service else {}

        # Get Celery queue stats
        celery_stats = self._get_celery_queue_stats()

        return {
            "queue_size": celery_stats.get("pending_tasks", 0),
            "is_processing": celery_stats.get("active_tasks", 0) > 0,
            "celery_stats": celery_stats,
            "supported_types": [t.value for t in DescriptionType],
            "service_status": status,
            "api_status": (
                "operational" if self.imagen_service.is_available() else "unavailable"
            ),
            "queue_backend": "celery_redis",
        }

    def _get_celery_queue_stats(self) -> Dict[str, Any]:
        """
        Get statistics from Celery queue.

        Returns:
            Dict with pending, active, and completed task counts
        """
        try:
            from ..core.celery_app import celery_app

            # Get inspector for worker stats
            inspect = celery_app.control.inspect()

            # Get active tasks (currently processing)
            active = inspect.active() or {}
            active_count = sum(len(tasks) for tasks in active.values())

            # Get reserved tasks (waiting to be processed)
            reserved = inspect.reserved() or {}
            reserved_count = sum(len(tasks) for tasks in reserved.values())

            # Get scheduled tasks
            scheduled = inspect.scheduled() or {}
            scheduled_count = sum(len(tasks) for tasks in scheduled.values())

            return {
                "active_tasks": active_count,
                "pending_tasks": reserved_count + scheduled_count,
                "workers_online": len(active),
                "queue_backend": "redis",
            }

        except Exception as e:
            logger.warning(f"Could not get Celery stats: {e}")
            return {
                "active_tasks": 0,
                "pending_tasks": 0,
                "workers_online": 0,
                "error": str(e),
            }


# Global service instance
image_generator_service = ImageGeneratorService()
