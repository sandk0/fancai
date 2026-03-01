"""
Hawk Tracker — мониторинг ошибок для FastAPI и Celery.

Интеграция с hawk-tracker.ru для отслеживания ошибок на бэкенде.
Поддерживает:
- FastAPI middleware для перехвата HTTP ошибок
- Celery task_failure signal для перехвата ошибок задач
- Graceful skip при отсутствии HAWK_TOKEN
"""

from celery.signals import task_failure

from .config import settings
from .logging import logger

try:
    from hawk_python_sdk.modules.fastapi import HawkFastapi
    from hawk_python_sdk import Hawk

    _hawk_sdk_available = True
except ImportError:
    HawkFastapi = None  # type: ignore[assignment,misc]
    Hawk = None  # type: ignore[assignment,misc]
    _hawk_sdk_available = False

_hawk_fastapi = None
_hawk_celery = None


def init_hawk(app):
    """
    Инициализация Hawk Tracker для FastAPI приложения.

    Добавляет middleware для перехвата и отправки HTTP ошибок в Hawk.
    При отсутствии HAWK_TOKEN или hawk_python_sdk возвращает None (graceful skip).

    :param app: FastAPI application instance
    :return: HawkFastapi instance или None если токен не задан или SDK не установлен
    """
    global _hawk_fastapi
    if not _hawk_sdk_available:
        logger.warning(
            "Hawk Tracker SDK не установлен (pip install hawk-python-sdk[fastapi])"
        )
        return None
    token = settings.HAWK_TOKEN
    if not token:
        logger.info("Hawk Tracker отключен (HAWK_TOKEN не установлен)")
        return None
    _hawk_fastapi = HawkFastapi(
        {
            "app_instance": app,
            "token": token,
            "release": f"fancai@{settings.APP_VERSION}",
        }
    )
    logger.info("Hawk Tracker инициализирован для FastAPI")
    return _hawk_fastapi


def init_hawk_celery(celery_app_instance=None):
    """
    Инициализация Hawk Tracker для Celery workers.

    Подключает сигнал task_failure для автоматической отправки
    ошибок Celery-задач в Hawk Tracker.
    При отсутствии HAWK_TOKEN возвращает None (graceful skip).

    :param celery_app_instance: Celery application instance (не используется напрямую)
    :return: Hawk instance или None если токен не задан
    """
    global _hawk_celery
    if not _hawk_sdk_available:
        return None
    token = settings.HAWK_TOKEN
    if not token:
        return None
    _hawk_celery = Hawk({"token": token})

    @task_failure.connect
    def on_task_failure(
        sender=None,
        exception=None,
        traceback=None,
        task_id=None,
        args=None,
        kwargs=None,
        **kw,
    ):
        """Отправить ошибку Celery-задачи в Hawk Tracker."""
        if _hawk_celery and exception:
            _hawk_celery.send(
                exception,
                {
                    "task_id": task_id,
                    "task_name": sender.name if sender else "unknown",
                    "args": str(args)[:200],
                },
            )

    logger.info(
        "Hawk Tracker инициализирован для Celery (task_failure signal подключён)"
    )
    return _hawk_celery
