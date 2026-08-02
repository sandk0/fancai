"""Auth-related Celery tasks."""

from typing import Dict, Any, cast
from datetime import datetime, timezone, timedelta

from sqlalchemy import CursorResult, delete

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.password_reset import PasswordResetToken
from app.tasks.common import run_async


@celery_app.task(name="cleanup_expired_reset_tokens")
def cleanup_expired_reset_tokens() -> Dict[str, Any]:
    """Удаляет просроченные токены сброса пароля (запускается ежедневно)."""
    try:
        result = run_async(_cleanup_expired_tokens_async())
        logger.info(
            "Cleanup expired reset tokens completed",
            deleted_count=result.get("deleted", 0),
        )
        return result
    except Exception as e:
        logger.error("Error cleaning up expired reset tokens", error=str(e))
        return {"status": "failed", "error": str(e), "deleted": 0}


async def _cleanup_expired_tokens_async() -> Dict[str, Any]:
    """Асинхронная функция очистки просроченных токенов."""
    async with AsyncSessionLocal() as db:
        # Удалить токены, которые просрочены более 24 часов назад
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        result = await db.execute(
            delete(PasswordResetToken).where(PasswordResetToken.expires_at < cutoff)
        )
        await db.commit()

        return {
            "status": "completed",
            "deleted": cast(CursorResult, result).rowcount,
            "cutoff_date": cutoff.isoformat(),
        }
