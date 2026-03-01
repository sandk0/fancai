"""
Celery configuration for fancai.
Настройка Celery для фоновых задач.
"""

from celery import Celery
import os
from app.core.config import settings

# Create Celery instance with basic config
celery_app = Celery(
    "bookreader",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.core.tasks", "app.tasks.reading_sessions_tasks"],
)

# Basic Celery configuration (compatible with existing code)
celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Worker settings (optimized)
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=int(os.getenv("CELERY_MAX_TASKS_PER_CHILD", "100")),
    worker_max_memory_per_child=int(
        os.getenv("CELERY_MAX_MEMORY_PER_CHILD", "512000")
    ),  # DEPLOY-08: 512MB (было 150MB)
    # Task settings
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_soft_time_limit=int(os.getenv("CELERY_SOFT_TIME_LIMIT", "1500")),  # 25 min
    task_time_limit=int(os.getenv("CELERY_TIME_LIMIT", "1800")),  # 30 min
    # Result settings
    result_expires=3600,  # 1 hour
    result_compression="gzip",
    # Broker settings
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": 14400
    },  # DEPLOY-05: 4h > max task_time_limit (10800s)
    # Rate limiting (basic)
    task_routes={
        "app.core.tasks.process_book_task": {"queue": "heavy"},
        "generate_image_task": {"queue": "normal"},
        "generate_image_batch_task": {"queue": "normal"},
    },
    # Default queue
    task_default_queue="normal",
    # Beat schedule для периодических задач
    beat_schedule={
        "close-abandoned-reading-sessions": {
            "task": "app.tasks.close_abandoned_sessions",
            "schedule": 1800.0,  # Каждые 30 минут (30 * 60 = 1800 секунд)
            "options": {
                "queue": "light",
                "priority": 2,
            },
        },
        # NEW: Cleanup stuck books every 6 hours (Phase 1)
        "cleanup-stuck-processing-books": {
            "task": "app.core.tasks.cleanup_stuck_books",
            "schedule": 21600.0,  # 6 hours (6 * 60 * 60)
            "options": {
                "queue": "light",
                "priority": 1,
            },
        },
        # Password reset tokens cleanup (daily)
        "cleanup-expired-reset-tokens": {
            "task": "cleanup_expired_reset_tokens",
            "schedule": 86400.0,  # 24 hours
            "options": {
                "queue": "light",
                "priority": 1,
            },
        },
    },
    # Celery 5.6+ Soft Shutdown (Phase 1: Dependency Updates)
    # Allows graceful completion of long-running tasks before worker shutdown
    worker_soft_shutdown_timeout=120,  # 2 minutes to finish current task
    task_track_started=True,  # Enable STARTED state tracking
)

# Auto-discover tasks
celery_app.autodiscover_tasks()

# Мониторинг ошибок: Hawk Tracker для Celery workers
try:
    from app.core.hawk import init_hawk_celery

    init_hawk_celery(celery_app)
except Exception as e:
    # Не ломаем запуск Celery при ошибке инициализации Hawk
    import logging

    logging.getLogger(__name__).warning(
        f"Failed to initialize Hawk Tracker for Celery: {e}"
    )
