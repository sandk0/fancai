"""
Redis PubSub utilities for real-time communication.

This module is specifically designed to avoid circular imports.
It can be safely imported from tasks.py without triggering router imports.
"""

import json
from app.core.logging import logger
from app.core.config import settings


async def publish_book_progress(
    book_id: str,
    progress: int,
    chapter: int = 0,
    total_chapters: int = 0,
    status: str = "processing",
    message: str = ""
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
        status: "processing", "completed", "failed", "cancelled"
        message: Optional status message
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
            "message": message
        }
        
        channel = f"book_progress:{book_id}"
        
        # Log before publish for debugging
        logger.info(
            "Publishing WebSocket progress",
            book_id=book_id,
            progress=progress,
            channel=channel
        )
        
        result = await redis_client.publish(channel, json.dumps(data))
        await redis_client.aclose()  # Use aclose() instead of close()
        
        logger.info(
            "WebSocket progress published",
            book_id=book_id,
            progress=progress,
            subscribers=result
        )
        
    except Exception as e:
        logger.error(f"Failed to publish progress: {e}", exc_info=True)
