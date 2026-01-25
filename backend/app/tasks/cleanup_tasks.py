"""
Cleanup Celery tasks.
"""

from app.core.celery_app import celery_app
from typing import Dict, Any
from datetime import datetime, timezone
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.book import Book
from app.tasks.common import run_async


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

        result = run_async(_cleanup_old_images_async(days_old))

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
        result = run_async(_cleanup_stuck_books_async())
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
    
    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=4)
        
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
