"""
Background tasks for fancai.
Фоновые задачи для fancai.

NLP REMOVAL (December 2025):
- Удален multi_nlp_manager (требовал 10-12 ГБ RAM)
- Используется langextract_processor (LLM-based, ~500 МБ)
- Описания извлекаются on-demand, не сохраняются в БД
- Задачи обработки книг упрощены
"""

from app.core.celery_app import celery_app
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.book import Book
from app.models.chapter import Chapter
from app.services.image_generator import image_generator_service
from app.services.push_notification_service import push_notification_service


def _run_async_task(coro):
    """
    Helper function to run async functions in Celery tasks.

    Uses asyncio.run() which is the recommended approach in Python 3.10+.
    This properly handles event loop creation and cleanup.

    Note: Each call creates a new event loop, which is appropriate for
    Celery tasks where each task should be isolated.
    """
    return asyncio.run(coro)


@celery_app.task(
    name="process_book", 
    bind=True, 
    max_retries=3, 
    default_retry_delay=60,
    time_limit=3600,  # 1 hour hard limit
    soft_time_limit=3300  # 55 minutes soft limit
)
def process_book_task(self, book_id_str: str) -> Dict[str, Any]:
    """
    Асинхронная обработка книги: валидация и подготовка к on-demand извлечению.

    После удаления NLP системы эта задача только:
    - Валидирует книгу и главы
    - Проверяет доступность LLM
    - Помечает книгу как готовую к обработке

    Args:
        book_id_str: String ID книги для обработки (UUID)

    Returns:
        Результат обработки
    """
    try:
        logger.info("Starting book processing", book_id=book_id_str, task="process_book")
        book_id = UUID(book_id_str)

        result = _run_async_task(_process_book_async(book_id))

        logger.info(
            "Book processing completed",
            book_id=book_id_str,
            status=result.get("status"),
            chapters_preparsed=result.get("chapters_preparsed"),
        )
        return result

    except Exception as e:
        logger.error(
            "Error processing book",
            book_id=book_id_str,
            error=str(e),
            exc_info=True,
        )
        # Ensure we update the book state in DB so it doesn't get stuck processing
        try:
            _run_async_task(_handle_book_processing_error_async(UUID(book_id_str), str(e)))
        except Exception as db_e:
            logger.error(
                "Failed to update book error state", 
                book_id=book_id_str, 
                error=str(db_e)
            )
            
        return {"book_id": book_id_str, "status": "failed", "error": str(e)}


async def _handle_book_processing_error_async(book_id: UUID, error_msg: str):
    """
    Updates book state on processing failure.
    Sets is_processing=False and descriptions_processing_error.
    """
    try:
        async with AsyncSessionLocal() as db:
            book_result = await db.execute(select(Book).where(Book.id == book_id))
            book = book_result.scalar_one_or_none()
            
            if book:
                book.is_processing = False
                book.descriptions_processing_error = error_msg
                await db.commit()
                
                # Invalidate cache
                from app.core.cache import cache_manager
                pattern = f"user:{book.user_id}:books:*"
                await cache_manager.delete_pattern(pattern)
                
    except Exception as e:
        logger.error("Error in _handle_book_processing_error_async", error=str(e))



async def _process_book_async(book_id: UUID) -> Dict[str, Any]:
    """
    Асинхронная функция обработки книги.

    После загрузки:
    1. Валидирует книгу и главы
    2. Парсит первые 2 главы с помощью LLM для предзагрузки
    3. Помечает книгу как готовую
    """
    from app.services.langextract_processor import langextract_processor
    from app.models.description import Description, DescriptionType

    async with AsyncSessionLocal() as db:
        logger.debug("Starting async processing", book_id=str(book_id))

        # Проверяем доступность LLM
        llm_available = langextract_processor.is_available()

        if not llm_available:
            logger.warning("LangExtract processor not available", book_id=str(book_id))

        # Получаем книгу
        book_result = await db.execute(select(Book).where(Book.id == book_id))
        book = book_result.scalar_one_or_none()

        if not book:
            logger.error("Book not found", book_id=str(book_id))
            raise ValueError(f"Book with id {book_id} not found")

        logger.info("Found book", book_id=str(book_id), title=book.title, author=book.author)

        # Получаем главы
        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = chapters_result.scalars().all()

        logger.info("Found chapters", book_id=str(book_id), chapters_count=len(chapters))

        # ИЗМЕНЕНО: Обрабатываем ВСЕ главы книги (ранее было только 5)
        # Теперь обработка запускается вручную, поэтому обрабатываем полностью
        chapters_parsed = 0
        total_descriptions = 0
        total_chapters = len(chapters)

        if llm_available and chapters:
            for idx, chapter in enumerate(chapters):
                try:
                    logger.debug(
                        "Parsing chapter",
                        chapter_number=chapter.chapter_number,
                        chapter_title=chapter.title,
                        progress=f"{idx+1}/{total_chapters}",
                    )

                    # Пропускаем служебные страницы
                    SERVICE_PAGE_KEYWORDS = [
                        "содержание", "оглавление", "table of contents", "contents",
                        "от автора", "слово автора", "предисловие", "послесловие",
                        "аннотация", "annotation", "synopsis",
                        "эпиграф", "epigraph", "цитата",
                        "посвящение", "dedication",
                        "благодарности", "acknowledgments",
                        "примечания", "notes", "сноски",
                        "библиография", "bibliography", "references",
                        "об авторе", "about the author", "биография",
                        "copyright", "издательство", "publisher",
                        "isbn", "все права защищены", "all rights reserved",
                    ]

                    chapter_title_lower = (chapter.title or "").lower()
                    chapter_content_lower = (chapter.content or "")[:500].lower()

                    is_service_page = any(
                        keyword in chapter_title_lower or keyword in chapter_content_lower
                        for keyword in SERVICE_PAGE_KEYWORDS
                    )

                    if chapter.word_count and chapter.word_count < 100:
                        is_service_page = True

                    # P1.1: Use cached is_service_page method
                    if chapter.is_service_page is None:
                        chapter.is_service_page = is_service_page

                    if is_service_page:
                        logger.debug(
                            "Skipping service page",
                            chapter_number=chapter.chapter_number,
                            chapter_title=chapter.title,
                        )
                        chapter.is_description_parsed = True
                        chapter.parsed_at = datetime.now(timezone.utc)
                        chapters_parsed += 1
                        # Обновляем прогресс после каждой главы
                        book.parsing_progress = int((chapters_parsed / total_chapters) * 100)
                        await db.commit()
                        continue

                    # Извлекаем описания через LLM
                    result = await langextract_processor.extract_descriptions(chapter.content)
                    descriptions_data = result.descriptions if result.descriptions else []

                    logger.info(
                        "Extracted descriptions",
                        chapter_number=chapter.chapter_number,
                        descriptions_count=len(descriptions_data),
                    )

                    # Сохраняем описания в базу
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
                            entities_mentioned=",".join(desc_dict.get("entities_mentioned", [])),
                            position_in_chapter=position,
                            word_count=desc_dict.get("word_count", len(desc_dict.get("content", "").split())),
                        )
                        position += 1
                        db.add(new_description)
                        total_descriptions += 1

                    # Обновляем статус главы
                    chapter.descriptions_found = len(descriptions_data)
                    chapter.is_description_parsed = True
                    chapter.parsed_at = datetime.now(timezone.utc)
                    chapters_parsed += 1

                    # Обновляем прогресс книги и коммитим каждую главу
                    # (для real-time отображения прогресса в UI)
                    book.parsing_progress = int((chapters_parsed / total_chapters) * 100)
                    await db.commit()
                    
                    logger.debug(
                        "Chapter processed",
                        chapter_number=chapter.chapter_number,
                        progress=book.parsing_progress,
                    )

                except Exception as e:
                    logger.error(
                        "Error parsing chapter",
                        chapter_number=chapter.chapter_number,
                        error=str(e),
                        exc_info=True,
                    )
                    # Продолжаем с следующей главой
                    continue

        # Помечаем книгу как готовую с извлечёнными описаниями
        book.is_processing = False
        book.is_parsed = True
        book.parsing_progress = 100
        book.descriptions_extracted = True  # НОВОЕ: флаг успешного извлечения
        book.descriptions_processing_error = None  # Сбрасываем ошибку
        await db.commit()

        # Инвалидируем кэш
        try:
            from app.core.cache import cache_manager
            logger.debug("Invalidating book list cache", user_id=str(book.user_id))
            pattern = f"user:{book.user_id}:books:*"
            deleted_count = await cache_manager.delete_pattern(pattern)
            logger.debug("Cache invalidated", keys_deleted=deleted_count)
        except Exception as e:
            logger.warning("Failed to invalidate cache", error=str(e))

        result = {
            "book_id": str(book_id),
            "status": "completed",
            "chapters_count": len(chapters),
            "chapters_preparsed": chapters_parsed,
            "descriptions_extracted": total_descriptions,
            "llm_available": llm_available,
            "extraction_mode": "full_book",  # ИЗМЕНЕНО с preparse_first_chapters
            "message": f"Book fully processed. {chapters_parsed} chapters with {total_descriptions} descriptions."
        }

        logger.info(
            "Book processing finished",
            book_id=str(book_id),
            chapters_count=len(chapters),
            chapters_preparsed=chapters_parsed,
            descriptions_extracted=total_descriptions,
        )

        # Send push notification to user (non-blocking)
        try:
            await push_notification_service.send_book_ready_notification(
                db=db,
                user_id=book.user_id,
                book_id=book.id,
                book_title=book.title,
            )
            logger.debug("Push notification sent for book ready", book_id=str(book_id))
        except Exception as e:
            # Don't fail the task if push notification fails
            logger.warning("Failed to send book ready push notification", error=str(e))

        return result


@celery_app.task(name="generate_image_for_text")
def generate_image_for_text_task(
    text: str,
    chapter_id_str: str,
    user_id_str: str,
    description_type: str = "location"
) -> Dict[str, Any]:
    """
    Генерация изображения для текстового описания.

    После удаления NLP: изображения генерируются напрямую из текста,
    без сохранения в таблицу descriptions.

    Args:
        text: Текст описания для генерации
        chapter_id_str: String ID главы
        user_id_str: String ID пользователя
        description_type: Тип описания (location, character, atmosphere)

    Returns:
        Результат генерации
    """
    try:
        logger.info("Starting image generation", chapter_id=chapter_id_str)

        result = _run_async_task(
            _generate_image_for_text_async(text, chapter_id_str, user_id_str, description_type)
        )

        logger.info("Image generation completed", chapter_id=chapter_id_str)
        return result

    except Exception as e:
        logger.error("Error generating image", chapter_id=chapter_id_str, error=str(e))
        return {"chapter_id": chapter_id_str, "status": "failed", "error": str(e)}


async def _generate_image_for_text_async(
    text: str,
    chapter_id_str: str,
    user_id_str: str,
    description_type: str
) -> Dict[str, Any]:
    """Асинхронная функция генерации изображения из текста."""
    async with AsyncSessionLocal() as db:
        user_id = UUID(user_id_str)
        chapter_id = UUID(chapter_id_str)

        try:
            # Генерируем изображение напрямую
            generation_result = await image_generator_service.generate_image_from_text(
                text=text,
                description_type=description_type,
                user_id=str(user_id),
            )

            if generation_result.success:
                # Сохраняем результат
                from app.models.image import GeneratedImage

                generated_image = GeneratedImage(
                    chapter_id=chapter_id,
                    user_id=user_id,
                    image_url=generation_result.image_url,
                    local_path=generation_result.local_path,
                    generation_prompt=text[:500],  # Сохраняем начало текста
                    description_text=text,  # Денормализованное поле
                    description_type=description_type,
                    generation_time_seconds=generation_result.generation_time_seconds,
                )

                db.add(generated_image)
                await db.commit()
                await db.refresh(generated_image)

                return {
                    "id": str(generated_image.id),
                    "chapter_id": chapter_id_str,
                    "image_url": generation_result.image_url,
                    "generation_time": generation_result.generation_time_seconds,
                    "status": "success"
                }
            else:
                return {
                    "chapter_id": chapter_id_str,
                    "status": "failed",
                    "error": generation_result.error_message
                }

        except Exception as e:
            logger.error(
                "Error generating image for chapter",
                chapter_id=chapter_id_str,
                error=str(e),
            )
            return {
                "chapter_id": chapter_id_str,
                "status": "failed",
                "error": str(e)
            }


@celery_app.task(name="cleanup_old_images")
def cleanup_old_images_task(days_old: int = 30) -> Dict[str, Any]:
    """
    Очистка старых сгенерированных изображений.

    Args:
        days_old: Удалить изображения старше указанного количества дней

    Returns:
        Количество удаленных изображений
    """
    try:
        logger.info("Starting cleanup of old images", days_old=days_old)

        result = _run_async_task(_cleanup_old_images_async(days_old))

        logger.info("Image cleanup completed", deleted_records=result.get("deleted_records"))
        return result

    except Exception as e:
        logger.error("Error in image cleanup", error=str(e))
        return {"status": "failed", "error": str(e)}


async def _cleanup_old_images_async(days_old: int) -> Dict[str, Any]:
    """Асинхронная функция очистки старых изображений."""
    from datetime import timedelta
    import os
    from app.models.image import GeneratedImage

    async with AsyncSessionLocal() as db:
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_old)

        old_images_result = await db.execute(
            select(GeneratedImage).where(GeneratedImage.created_at < cutoff_date)
        )
        old_images = old_images_result.scalars().all()

        deleted_files = 0
        deleted_records = 0

        for image in old_images:
            try:
                if image.local_path and os.path.exists(image.local_path):
                    os.unlink(image.local_path)
                    deleted_files += 1

                await db.delete(image)
                deleted_records += 1

            except Exception as e:
                logger.error("Error deleting image", image_id=str(image.id), error=str(e))
                continue

        await db.commit()

        return {
            "status": "completed",
            "deleted_files": deleted_files,
            "deleted_records": deleted_records,
            "cutoff_date": cutoff_date.isoformat(),
        }


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
    from app.services.imagen_generator import get_imagen_service
    from app.models.image import GeneratedImage
    from app.models.description import Description
    import os

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

        result = _run_async_task(
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
            success=result.get('success', False),
        )
        return result

    except Exception as e:
        logger.error(
            "Image generation failed",
            task_id=task_id,
            description_id=description_id_str,
            error=str(e),
        )

        # Let Celery handle retry with backoff
        if self.request.retries < self.max_retries:
            logger.info(
                "Will retry image generation",
                task_id=task_id,
                attempt=self.request.retries + 1,
                max_retries=self.max_retries + 1,
            )
            raise  # Celery will auto-retry due to autoretry_for

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
    from app.services.imagen_generator import get_imagen_service
    from app.models.image import GeneratedImage
    import os

    async with AsyncSessionLocal() as db:
        logger.debug("Starting async image generation", task_id=task_id)

        # Get Imagen service
        imagen_service = get_imagen_service()

        if not imagen_service.is_available():
            logger.warning("Imagen service not available", task_id=task_id)
            return {
                "task_id": task_id,
                "description_id": str(description_id),
                "success": False,
                "error": "Image generation service not available. Check GOOGLE_API_KEY.",
                "status": "service_unavailable",
            }

        # Generate image
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

            # Create HTTP URL from local_path
            filename = (
                os.path.basename(generation_result.local_path)
                if generation_result.local_path else None
            )
            http_url = f"/api/v1/images/file/{filename}" if filename else None

            # Save to database
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

            # Send push notification to user (non-blocking)
            try:
                # Get book_id from description -> chapter -> book
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
                        logger.debug("Push notification sent for image ready", task_id=task_id)
            except Exception as e:
                # Don't fail the task if push notification fails
                logger.warning("Failed to send image ready push notification", error=str(e))

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
        result = _run_async_task(
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
            successful=result.get('successful', 0),
            total=result.get('total', 0),
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
        chapter_id = UUID(chapter_id_str)
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

                # Generate image
                generation_result = await imagen_service.generate_image(
                    description=description_content,
                    description_type=description_type,
                    genre=book_genre,
                )

                if generation_result.success:
                    # Create HTTP URL from local_path
                    filename = (
                        os.path.basename(generation_result.local_path)
                        if generation_result.local_path else None
                    )
                    http_url = f"/api/v1/images/file/{filename}" if filename else None

                    # Save to database
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

                    results.append({
                        "description_id": str(description_id),
                        "description_type": description_type,
                        "image_url": http_url or generation_result.image_url,
                        "generation_time": generation_result.generation_time_seconds,
                        "success": True,
                    })
                    successful += 1
                else:
                    results.append({
                        "description_id": str(description_id),
                        "error": generation_result.error_message,
                        "success": False,
                    })
                    failed += 1

                # Small delay between requests to avoid rate limiting
                await asyncio.sleep(2)

            except Exception as e:
                logger.error(
                    "Error generating for description",
                    description_id=desc_data.get("id", "unknown"),
                    error=str(e),
                )
                results.append({
                    "description_id": desc_data.get("id", "unknown"),
                    "error": str(e),
                    "success": False,
                })
                failed += 1

        # Commit all successful generations
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


@celery_app.task(name="health_check")
def health_check_task() -> str:
    """Проверка работоспособности Celery worker."""
    return "Celery is working!"


@celery_app.task(name="system_stats")
def system_stats_task() -> Dict[str, Any]:
    """Получение системной статистики для мониторинга."""
    try:
        result = _run_async_task(_get_system_stats_async())
        return result

    except Exception as e:
        logger.error("Error getting system stats", error=str(e))
        return {"status": "failed", "error": str(e)}


async def _get_system_stats_async() -> Dict[str, Any]:
    """Асинхронная функция получения системной статистики."""
    from sqlalchemy import func
    from app.models.image import GeneratedImage

    async with AsyncSessionLocal() as db:
        # Общее количество книг
        books_count = await db.execute(select(func.count(Book.id)))
        total_books = books_count.scalar()

        # Общее количество глав
        chapters_count = await db.execute(select(func.count(Chapter.id)))
        total_chapters = chapters_count.scalar()

        # Общее количество сгенерированных изображений
        images_count = await db.execute(select(func.count(GeneratedImage.id)))
        total_images = images_count.scalar()

        # Проверяем LLM
        from app.services.langextract_processor import LangExtractProcessor
        processor = LangExtractProcessor()
        llm_available = processor.is_available()

        return {
            "status": "operational",
            "total_books": total_books,
            "total_chapters": total_chapters,
            "total_images": total_images,
            "llm_available": llm_available,
            "extraction_mode": "on_demand",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
