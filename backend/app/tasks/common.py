"""
Common utilities for Celery tasks.
"""

import asyncio
from typing import TypeVar, Coroutine, Any

T = TypeVar("T")


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    """
    Run async function in Celery task context.

    Uses asyncio.run() which is the recommended approach in Python 3.10+.
    Each call creates a new event loop, appropriate for isolated Celery tasks.
    """
    return asyncio.run(coro)
