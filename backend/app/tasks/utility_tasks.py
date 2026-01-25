"""
Utility Celery tasks.
"""

from app.core.celery_app import celery_app
from typing import Dict, Any
from datetime import datetime, timezone
from sqlalchemy import select, func

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.book import Book
from app.models.chapter import Chapter
from app.tasks.common import run_async


@celery_app.task(name="health_check")
def health_check_task() -> str:
    """Проверка работоспособности Celery worker."""
    return "Celery is working!"


@celery_app.task(name="system_stats")
def system_stats_task() -> Dict[str, Any]:
    """Получение системной статистики для мониторинга."""
    try:
        result = run_async(_get_system_stats_async())
        return result

    except Exception as e:
        logger.error("Error getting system stats", error=str(e))
        return {"status": "failed", "error": str(e)}


async def _get_system_stats_async() -> Dict[str, Any]:
    """Асинхронная функция получения системной статистики."""
    from app.models.image import GeneratedImage

    async with AsyncSessionLocal() as db:
        books_count = await db.execute(select(func.count(Book.id)))
        total_books = books_count.scalar()

        chapters_count = await db.execute(select(func.count(Chapter.id)))
        total_chapters = chapters_count.scalar()

        images_count = await db.execute(select(func.count(GeneratedImage.id)))
        total_images = images_count.scalar()

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
