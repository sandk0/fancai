"""
Celery tasks for fancai.
"""

from .reading_sessions_tasks import close_abandoned_sessions, get_cleanup_statistics

from .book_tasks import (
    process_book_task,
    _atomic_cleanup_book_state,
    _handle_book_processing_error_async,
    _process_book_async,
)

from .image_tasks import (
    generate_image_task,
    generate_image_batch_task,
    _generate_image_async,
    _generate_batch_async,
)

from .cleanup_tasks import (
    cleanup_old_images_task,
    cleanup_stuck_books,
    _cleanup_old_images_async,
    _cleanup_stuck_books_async,
)

from .utility_tasks import (
    health_check_task,
    system_stats_task,
    _get_system_stats_async,
)

from .common import run_async

__all__ = [
    "close_abandoned_sessions",
    "get_cleanup_statistics",
    "process_book_task",
    "_atomic_cleanup_book_state",
    "_handle_book_processing_error_async",
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
]
