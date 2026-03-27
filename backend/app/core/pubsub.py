import json
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)


async def publish_book_progress(
    book_id: str,
    progress: int,
    chapter: int = 0,
    total_chapters: int = 0,
    status: str = "processing",
    message: str = "",
    **kwargs,
):
    """
    Publish book processing progress to Redis PubSub.

    Called from tasks.py during book processing.
    WebSocket handler in websocket.py subscribes to this channel
    and forwards messages to connected clients.

    Args:
        book_id: Book UUID string
        progress: 0-100 percent
        chapter: Current chapter number
        total_chapters: Total chapters in book
        status: "processing", "completed", "completed_with_errors", "failed", "cancelled"
        message: Optional status message
        **kwargs: Extra fields forwarded to WebSocket data (e.g. chapters_failed, failed_chapter_numbers)
    """
    try:
        import redis.asyncio as aioredis

        redis_client = await aioredis.from_url(settings.REDIS_URL)

        data = {
            "type": "progress" if status == "processing" else status,
            "book_id": book_id,
            "progress": progress,
            "chapter": chapter,
            "total_chapters": total_chapters,
            "status": status,
            "message": message,
        }
        data.update(kwargs)

        channel = f"book_progress:{book_id}"

        logger.info(
            f"Publishing WebSocket progress: book_id={book_id}, progress={progress}, channel={channel}"
        )

        result = await redis_client.publish(channel, json.dumps(data))
        await redis_client.aclose()

        logger.info(
            f"WebSocket progress published: book_id={book_id}, progress={progress}, subscribers={result}"
        )

    except Exception as e:
        logger.opt(exception=True).error(f"Failed to publish progress: {e}")


async def publish_entities_updated(
    book_id: str,
    entities_count: int,
    message: str = "",
):
    try:
        import redis.asyncio as aioredis

        redis_client = await aioredis.from_url(settings.REDIS_URL)

        data = {
            "type": "entities_updated",
            "book_id": book_id,
            "entities_count": entities_count,
            "message": message,
        }

        channel = f"book_progress:{book_id}"
        result = await redis_client.publish(channel, json.dumps(data))
        await redis_client.aclose()

        logger.info(
            f"Entities updated event published: book_id={book_id}, count={entities_count}, subscribers={result}"
        )

    except Exception as e:
        logger.opt(exception=True).error(f"Failed to publish entities_updated: {e}")
