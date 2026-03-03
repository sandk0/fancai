"""
Common utilities for Celery tasks.
"""

import asyncio
from typing import TypeVar, Coroutine, Any

T = TypeVar("T")


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    """
    Run async function in Celery task context.

    Uses asyncio.run() which creates a new event loop each call and closes it after.
    The module-level SQLAlchemy async engine retains pooled connections bound to the
    previous (now closed) loop. Disposing the pool before each run forces fresh
    connections on the new loop, preventing 'Event loop is closed' errors.
    """

    async def _with_fresh_pool() -> T:
        from app.core.database import engine

        await engine.dispose()
        return await coro

    return asyncio.run(_with_fresh_pool())
