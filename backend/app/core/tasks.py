"""
Background tasks for fancai.

DEPRECATED: This module is a re-export layer for backward compatibility.
All tasks have been moved to app/tasks/ modules:
- app/tasks/book_tasks.py - Book processing
- app/tasks/image_tasks.py - Image generation
- app/tasks/cleanup_tasks.py - Cleanup tasks
- app/tasks/utility_tasks.py - Utility tasks
- app/tasks/reading_sessions_tasks.py - Reading session tasks
"""

from app.tasks.book_tasks import (
    process_book_task,
    _atomic_cleanup_book_state,
    _process_book_async,
)

from app.tasks.image_tasks import (
    generate_image_task,
    generate_image_batch_task,
    _generate_image_async,
    _generate_batch_async,
)

from app.tasks.cleanup_tasks import (
    cleanup_old_images_task,
    cleanup_stuck_books,
    _cleanup_old_images_async,
    _cleanup_stuck_books_async,
)

from app.tasks.utility_tasks import (
    health_check_task,
    system_stats_task,
    _get_system_stats_async,
)

from app.tasks.common import run_async

_run_async_task = run_async

__all__ = [
    "process_book_task",
    "_atomic_cleanup_book_state",
    "_process_book_async",
    "generate_image_task",
    "generate_image_batch_task",
    "_generate_image_async",
    "_generate_batch_async",
    "cleanup_old_images_task",
    "cleanup_stuck_books",
    "_cleanup_old_images_async",
    "_cleanup_stuck_books_async",
    "health_check_task",
    "system_stats_task",
    "_get_system_stats_async",
    "run_async",
    "_run_async_task",
]
