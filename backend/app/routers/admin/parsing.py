"""
Admin API routes for parsing settings and queue management.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict
import os
import redis.asyncio as redis
from loguru import logger

from ...core.auth import get_current_admin_user
from ...models.user import User
from ...schemas.responses.admin import (
    ParsingSettingsUpdateResponse,
    ParsingQueueStatusResponse,
    ClearQueueResponse,
    UnlockParsingResponse,
)

router = APIRouter()


class ParsingSettings(BaseModel):
    max_concurrent_parsing: int
    queue_priority_weights: Dict[str, int]
    timeout_minutes: int
    retry_attempts: int


@router.get("/parsing-settings", response_model=ParsingSettings)
async def get_parsing_settings(admin_user: User = Depends(get_current_admin_user)):
    """Get current parsing queue configuration."""

    from ...services.settings_manager import settings_manager

    max_concurrent = await settings_manager.get_setting(
        "parsing", "max_concurrent_parsing", 1
    )
    free_priority = await settings_manager.get_setting("parsing", "priority_free", 1)
    premium_priority = await settings_manager.get_setting(
        "parsing", "priority_premium", 5
    )
    ultimate_priority = await settings_manager.get_setting(
        "parsing", "priority_ultimate", 10
    )
    timeout_minutes = await settings_manager.get_setting(
        "parsing", "timeout_minutes", 30
    )
    retry_attempts = await settings_manager.get_setting("parsing", "retry_attempts", 3)

    return ParsingSettings(
        max_concurrent_parsing=max_concurrent,
        queue_priority_weights={
            "free": free_priority,
            "premium": premium_priority,
            "ultimate": ultimate_priority,
        },
        timeout_minutes=timeout_minutes,
        retry_attempts=retry_attempts,
    )


@router.put("/parsing-settings", response_model=ParsingSettingsUpdateResponse)
async def update_parsing_settings(
    settings: ParsingSettings, admin_user: User = Depends(get_current_admin_user)
) -> ParsingSettingsUpdateResponse:
    """Update parsing queue configuration."""

    # Validate settings
    if settings.max_concurrent_parsing < 1 or settings.max_concurrent_parsing > 10:
        raise HTTPException(
            status_code=400, detail="Max concurrent parsing must be between 1-10"
        )

    if settings.timeout_minutes < 10 or settings.timeout_minutes > 120:
        raise HTTPException(
            status_code=400, detail="Timeout must be between 10-120 minutes"
        )

    from ...services.settings_manager import settings_manager

    # Save settings to database
    await settings_manager.set_setting(
        "parsing", "max_concurrent_parsing", settings.max_concurrent_parsing
    )
    await settings_manager.set_setting(
        "parsing", "priority_free", settings.queue_priority_weights["free"]
    )
    await settings_manager.set_setting(
        "parsing", "priority_premium", settings.queue_priority_weights["premium"]
    )
    await settings_manager.set_setting(
        "parsing", "priority_ultimate", settings.queue_priority_weights["ultimate"]
    )
    await settings_manager.set_setting(
        "parsing", "timeout_minutes", settings.timeout_minutes
    )
    await settings_manager.set_setting(
        "parsing", "retry_attempts", settings.retry_attempts
    )

    return ParsingSettingsUpdateResponse(
        message="Parsing settings updated successfully", settings=settings.model_dump()
    )


@router.get("/queue-status", response_model=ParsingQueueStatusResponse)
async def get_queue_status(
    admin_user: User = Depends(get_current_admin_user),
) -> ParsingQueueStatusResponse:
    """Get detailed parsing queue status."""

    try:
        redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

        # Get current parsing lock info
        lock_data = await redis_client.get("global_parsing_lock")

        # Get queue items
        queue_items = await redis_client.lrange("parsing_queue", 0, -1)

        await redis_client.close()

        return ParsingQueueStatusResponse(
            is_parsing_active=lock_data is not None,
            current_parsing=lock_data,
            queue_size=len(queue_items),
            queue_items=queue_items[:10],  # Show first 10 items
        )
    except Exception as e:
        return ParsingQueueStatusResponse(
            is_parsing_active=False,
            current_parsing=None,
            queue_size=0,
            queue_items=[],
            error=str(e),
        )


@router.post("/clear-queue", response_model=ClearQueueResponse)
async def clear_parsing_queue(
    admin_user: User = Depends(get_current_admin_user),
) -> ClearQueueResponse:
    """Clear all items from parsing queue (emergency function)."""

    try:
        redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

        # Clear the queue
        await redis_client.delete("parsing_queue")

        await redis_client.close()

        return ClearQueueResponse(message="Parsing queue cleared successfully")
    except Exception as e:
        logger.exception(f"Failed to clear queue: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear parsing queue")


@router.post("/unlock-parsing", response_model=UnlockParsingResponse)
async def unlock_parsing(
    admin_user: User = Depends(get_current_admin_user),
) -> UnlockParsingResponse:
    """Force unlock parsing (emergency function)."""

    try:
        redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

        # Remove parsing lock
        await redis_client.delete("global_parsing_lock")

        await redis_client.close()

        return UnlockParsingResponse(message="Parsing lock removed successfully")
    except Exception as e:
        logger.exception(f"Failed to unlock parsing: {e}")
        raise HTTPException(status_code=500, detail="Failed to unlock parsing")
