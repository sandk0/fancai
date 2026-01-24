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
from app.services.gemini_extractor import get_gemini_extractor
from app.services.consistency_manager import ConsistencyManager
from app.core.pubsub import publish_book_progress


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
    time_limit=10800,  # 3 hours hard limit
    soft_time_limit=10500,  # 2 hours 55 minutes soft limit
    track_started=True,  # Celery 5.6+: Track STARTED state
)
def process_book_task(self, book_id_str: str) -> Dict[str, Any]:
    """
    Асинхронная обработка книги: валидация и подготовка к on-demand извлечению.

    После удаления NLP системы эта задача только:
    - Валидирует книгу и главы
    - Проверяет доступность LLM
    - Помечает книгу как готовую к обработке

    Phase 2 Improvements:
    - SoftTimeLimitExceeded handling for graceful timeout
    - Finally block for atomic state cleanup
    - Redis lock cleanup on all exit paths
    
    Phase 4 Improvements:
    - Redis distributed lock to prevent duplicate processing

    Args:
        book_id_str: String ID книги для обработки (UUID)

    Returns:
        Результат обработки
    """
    from celery.exceptions import SoftTimeLimitExceeded
    import redis
    from app.core.config import settings
    
    book_id = None
    redis_lock = None
    lock_key = f"book:processing:{book_id_str}"
    
    # Define async wrapper to keep everything in ONE event loop
    async def task_wrapper():
        nonlocal book_id, redis_lock
        
        try:
            # Phase 4: Acquire distributed lock
            # Note: redis-py is sync here, but that's fine inside async wrapper
            # provided we don't block for long.
            # Ideally we'd use redis.asyncio, but we are reusing the existing sync client pattern 
            # for the lock acquisition part which is fast.
            # Or better: keep sync lock logic outside, only run async process inside.
            # BUT: cleanup needs async DB session. So cleanup must be in the loop.
            
            # Since Redis Lock logic is sync, let's keep it here.
            
            logger.info("Starting book processing", book_id=book_id_str, task="process_book")
            book_id = UUID(book_id_str)

            # RUN MAIN PROCESSING
            result = await _process_book_async(book_id)

            logger.info(
                "Book processing completed",
                book_id=book_id_str,
                status=result.get("status"),
                chapters_preparsed=result.get("chapters_preparsed"),
            )
            return result

        except SoftTimeLimitExceeded:
            # Celery 5.6+: Graceful timeout handling
            logger.warning(
                "Book processing soft time limit exceeded",
                book_id=book_id_str,
                timeout_seconds=10500
            )
            if book_id:
                try:
                    await _atomic_cleanup_book_state(book_id, "Timeout: soft limit exceeded (2h 55m)")
                except Exception as cleanup_e:
                     logger.error(f"Cleanup failed during timeout: {cleanup_e}")
            raise  # Re-raise so Celery marks task as failed

        except Exception as e:
            logger.error(
                "Error processing book",
                book_id=book_id_str,
                error=str(e),
                exc_info=True,
            )
            # Ensure we update the book state in DB so it doesn't get stuck processing
            if book_id:
                try:
                    # Run cleanup in the SAME loop
                    await _atomic_cleanup_book_state(book_id, str(e))
                except Exception as db_e:
                    logger.error(
                        "Failed to update book error state", 
                        book_id=book_id_str, 
                        error=str(db_e)
                    )
            
            return {"book_id": book_id_str, "status": "failed", "error": str(e)}

    # Acquire lock first (SYNC)
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        redis_lock = redis_client.lock(
            lock_key,
            timeout=10800,  # 3 hours (match task time limit)
            blocking=False
        )
        
        if not redis_lock.acquire(blocking=False):
            logger.warning(
                "Book already being processed (lock exists)",
                book_id=book_id_str,
                lock_key=lock_key
            )
            return {
                "book_id": book_id_str,
                "status": "skipped",
                "error": "Book is already being processed by another worker"
            }
            
        # Run everything in ONE loop
        return asyncio.run(task_wrapper())
        
    except Exception as outer_e:
        # If redis fails or asyncio.run fails totally
        logger.error(f"Critical task failure: {outer_e}")
        raise outer_e

    
    finally:
        # Phase 4: Always release Redis lock
        if redis_lock is not None:
            try:
                redis_lock.release()
                logger.debug(f"Released Redis lock for book {book_id_str}")
            except Exception as lock_e:
                logger.warning(f"Failed to release Redis lock: {lock_e}")


async def _atomic_cleanup_book_state(book_id: UUID, error_msg: str):
    """
    Atomic cleanup of book processing state.
    
    Guaranteed to:
    1. Set is_processing=False
    2. Set error message
    3. Invalidate user cache
    4. Clear Redis processing lock
    
    Phase 2: Replaces _handle_book_processing_error_async with more robust handling.
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
                try:
                    from app.core.cache import cache_manager
                    pattern = f"user:{book.user_id}:books:*"
                    await cache_manager.delete_pattern(pattern)
                except Exception as cache_e:
                    logger.warning(f"Cache invalidation failed: {cache_e}")
        
        # Clear Redis processing lock
        try:
            import redis.asyncio as aioredis
            from app.core.config import settings
            redis_client = await aioredis.from_url(settings.REDIS_URL)
            await redis_client.delete(f"book:processing:{book_id}")
            await redis_client.close()
        except Exception as redis_e:
            logger.warning(f"Redis lock cleanup failed: {redis_e}")
                
    except Exception as e:
        logger.error("Error in _atomic_cleanup_book_state", book_id=str(book_id), error=str(e))


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
    # from app.services.langextract_processor import langextract_processor # DEPRECATED
    # from app.models.description import Description, DescriptionType # Imported from gemini_extractor now

    async with AsyncSessionLocal() as db:
        logger.debug("Starting async processing", book_id=str(book_id))
        
        # Initialize services
        gemini_extractor = get_gemini_extractor()
        consistency_manager = ConsistencyManager(db)
        
        # Import DescriptionType for DB mapping
        from app.models.description import DescriptionType

        # Проверяем доступность LLM
        llm_available = gemini_extractor.is_available()

        if not llm_available:
            logger.warning("Gemini extractor not available", book_id=str(book_id))

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
            logger.info("Starting parallel chapter processing (v16 Async Architecture)", book_id=str(book_id))
            
            # Semaphore to limit massive concurrency
            chapter_semaphore = asyncio.Semaphore(10) 
            
            # Import TaskGroup safely (Python 3.11+)
            try:
                from asyncio import TaskGroup
            except ImportError:
                 # Fallback for older python if needed, though we are on 3.12
                 logger.error("Asyncio TaskGroup not found. Python 3.11+ required.")
                 raise

            # Progress tracking
            chapters_done_count = 0
            progress_lock = asyncio.Lock()

            async def process_chapter_safe(idx: int, chapter_id: UUID):
                """
                Process a single chapter in its own DB session to avoid concurrency issues.
                """
                async with AsyncSessionLocal() as session:
                    async with chapter_semaphore:
                        try:
                            # 1. Fetch Chapter
                            stmt = select(Chapter).where(Chapter.id == chapter_id)
                            res = await session.execute(stmt)
                            local_chapter = res.scalar_one_or_none()
                            
                            if not local_chapter:
                                return
                            
                            # Skip if already parsed
                            if local_chapter.is_description_parsed:
                                return

                            # 2. Check Service Page (Table of Contents, etc)
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
                            
                            content_lower = (local_chapter.content or "")[:500].lower()
                            title_lower = (local_chapter.title or "").lower()
                            
                            is_service = any(k in title_lower or k in content_lower for k in SERVICE_PAGE_KEYWORDS)
                            if local_chapter.word_count and local_chapter.word_count < 100: 
                                is_service = True

                            if is_service:
                                local_chapter.is_service_page = True
                                local_chapter.is_description_parsed = True
                                local_chapter.parsed_at = datetime.now(timezone.utc)
                                await session.commit()
                                return

                            # 3. Analyze with Gemini
                            # Extractor has its own internal semaphore/rate-limiting too
                            result = await gemini_extractor.analyze_chapter(local_chapter.content)
                            
                            # 4. Consistency & Logic (Map Phase)
                            # Use a local ConsistencyManager with this session
                            local_mgr = ConsistencyManager(session)
                            await local_mgr.process_chapter_analysis(str(book_id), result, chapter_id=str(local_chapter.id))

                            # 5. Save Descriptions
                            descriptions_data = result.descriptions or []
                            from app.models.description import Description as DescriptionModel
                            from app.models.description import DescriptionType
                            
                            for i, d in enumerate(descriptions_data):
                                d_dict = d.to_dict() if hasattr(d, 'to_dict') else d
                                try:
                                    d_type = DescriptionType(d_dict.get("type", "location"))
                                except: 
                                    d_type = DescriptionType.LOCATION
                                
                                new_desc = DescriptionModel(
                                    chapter_id=local_chapter.id,
                                    type=d_type,
                                    content=d_dict.get("content", ""),
                                    confidence_score=d_dict.get("confidence_score", 0.8),
                                    priority_score=d_dict.get("priority_score", 0.5),
                                    entities_mentioned=",".join(d_dict.get("entities_mentioned", [])),
                                    position_in_chapter=i,
                                    word_count=d_dict.get("word_count", 0)
                                )
                                session.add(new_desc)

                            local_chapter.descriptions_found = len(descriptions_data)
                            local_chapter.is_description_parsed = True
                            local_chapter.parsed_at = datetime.now(timezone.utc)
                            
                            await session.commit()
                            
                            logger.info(f"Chapter {local_chapter.chapter_number} parsed: {len(descriptions_data)} descriptions")

                            # Update progress
                            nonlocal chapters_done_count
                            async with progress_lock:
                                chapters_done_count += 1
                                current_progress = int((chapters_done_count / total_chapters) * 80)
                            
                            await publish_book_progress(
                                book_id=str(book_id),
                                progress=current_progress,
                                chapter=local_chapter.chapter_number,
                                total_chapters=total_chapters,
                                status="processing",
                                message=f"Обработка главы {local_chapter.chapter_number} из {total_chapters}"
                            )
                            
                        except Exception as e:
                            logger.error(f"Error parsing chapter {idx+1}: {e}", exc_info=True)
                            # Don't raise, just log so other chapters continue

            # Launch Parallel Processing
            logger.info(f"Spawning {len(chapters)} parallel tasks...")
            async with TaskGroup() as tg:
                for idx, chapter in enumerate(chapters):
                    tg.create_task(process_chapter_safe(idx, chapter.id))
            
            logger.info("Parallel processing complete.")

            # Update book progress to 100% (approximate)
            book.parsing_progress = 100


        # 4. Phase 2: Map-Reduce Barrier & Graph Analysis
        # Executed once after all chapters are extracted.
        
        # A. Reduce Phase: Merge Duplicates & Filter Garbage
        try:
            logger.info("Running Entity Optimization (Reduce Phase)...", book_id=str(book_id))
            await publish_book_progress(
                book_id=str(book_id),
                progress=85,
                status="processing",
                message="Оптимизация сущностей..."
            )
            await consistency_manager.optimize_book_entities(str(book_id))
        except Exception as e:
            logger.error(f"Reduce phase failed: {e}")
            
        # B. Graph Phase: PageRank & Importance
        try:
            from app.services.graph_service import get_graph_service
            graph_service = get_graph_service(db)
            logger.info("Calculating Graph Metrics (PageRank)...", book_id=str(book_id))
            await publish_book_progress(
                book_id=str(book_id),
                progress=90,
                status="processing",
                message="Анализ связей графа..."
            )
            await graph_service.calculate_pagerank(str(book_id))
        except Exception as e:
            logger.error(f"Graph analysis failed: {e}")

        # 5. Generate Master References for optimized entities
        # This is done once after all chapters are processed to ensure global consistency
        try:
            logger.info("Generating Master References for entities...", book_id=str(book_id))
            await publish_book_progress(
                book_id=str(book_id),
                progress=95,
                status="processing",
                message="Финальная сборка..."
            )
            await consistency_manager.generate_master_references(str(book_id))
        except Exception as e:
            logger.error("Failed to generate master references", error=str(e))


        # Помечаем книгу как готовую с извлечёнными описаниями
        book.is_processing = False
        book.is_parsed = True
        book.parsing_progress = 100
        book.descriptions_extracted = True  # НОВОЕ: флаг успешного извлечения
        book.descriptions_processing_error = None  # Сбрасываем ошибку
        await db.commit()
        
        # Публикуем завершение через WebSocket
        try:
            await publish_book_progress(
                book_id=str(book_id),
                progress=100,
                chapter=total_chapters,
                total_chapters=total_chapters,
                status="completed",
                message="Обработка завершена успешно!"
            )
        except Exception as ws_err:
            logger.warning("Failed to publish WebSocket completion", error=str(ws_err))

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


# =============================================================================
# Cleanup Tasks (Phase 1: Reliability)
# =============================================================================


@celery_app.task(name="cleanup_stuck_books")
def cleanup_stuck_books() -> Dict[str, Any]:
    """
    Очищает книги, застрявшие в is_processing=True более 4 часов.
    
    Запускается каждые 6 часов через Celery Beat.
    Это предотвращает ситуации, когда книга навсегда застряла в обработке
    из-за OOM, exception или других сбоев worker.
    
    Returns:
        Dict с количеством очищенных книг и их ID
    """
    try:
        result = _run_async_task(_cleanup_stuck_books_async())
        logger.info(
            "Cleanup stuck books completed",
            cleaned_count=result.get("cleaned", 0),
            book_ids=result.get("book_ids", [])
        )
        return result
    except Exception as e:
        logger.error("Error cleaning up stuck books", error=str(e))
        return {"status": "failed", "error": str(e), "cleaned": 0}


async def _cleanup_stuck_books_async() -> Dict[str, Any]:
    """
    Асинхронная функция очистки застрявших книг.
    
    Находит книги с is_processing=True, у которых updated_at > 4 часов назад,
    и сбрасывает их состояние.
    """
    from datetime import timedelta
    from sqlalchemy import update
    
    async with AsyncSessionLocal() as db:
        # Порог: 4 часа назад
        cutoff = datetime.now(timezone.utc) - timedelta(hours=4)
        
        # Найти застрявшие книги
        query = select(Book).where(
            Book.is_processing == True,
            Book.updated_at < cutoff
        )
        result = await db.execute(query)
        stuck_books = result.scalars().all()
        
        if not stuck_books:
            logger.info("No stuck books found during cleanup")
            return {"cleaned": 0, "book_ids": []}
        
        logger.warning(
            f"Found {len(stuck_books)} stuck books, cleaning up...",
            book_ids=[str(b.id) for b in stuck_books]
        )
        
        cleaned_ids = []
        for book in stuck_books:
            book.is_processing = False
            book.descriptions_processing_error = (
                f"Cleaned by scheduled task: stuck for 4+ hours (detected at {datetime.now(timezone.utc).isoformat()})"
            )
            cleaned_ids.append(str(book.id))
            
            # Инвалидировать кэш пользователя
            try:
                from app.core.cache import cache_manager
                await cache_manager.delete_pattern(f"user:{book.user_id}:books:*")
            except Exception as cache_e:
                logger.warning(f"Failed to invalidate cache for book {book.id}: {cache_e}")
        
        await db.commit()
        
        return {
            "cleaned": len(cleaned_ids),
            "book_ids": cleaned_ids,
            "status": "success"
        }

