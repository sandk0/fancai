"""
Structured logging configuration for fancai.

Uses loguru for structured logging with JSON output in production
and colorized human-readable output in development.

Usage:
    from app.core.logging import logger

    logger.info("Processing book", book_id=book_id, user_email=user.email)
    logger.opt(exception=True).error(f"Failed to parse: {e}")

Created: December 2025
Author: fancai Team
"""

import logging
import sys
from typing import Any, Dict, TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:  # loguru.Logger — только для аннотаций
    from loguru import Logger


# Экранируем, а не выкидываем: содержимое записи сохраняется, но одна
# запись остаётся ровно одной строкой.
_NEWLINES = str.maketrans({"\r": "\\r", "\n": "\\n"})


def _scrub(value: Any) -> Any:
    """Экранирует переводы строк, если значение — строка с ними."""
    if isinstance(value, str) and ("\n" in value or "\r" in value):
        return value.translate(_NEWLINES)
    return value


def _scrub_loguru_record(record: Dict[str, Any]) -> None:
    """Patcher loguru: гасит переводы строк в тексте записи.

    Защита от подделки лог-строк. Значение с `\\n` разрывает запись на две,
    и вторая половина выглядит как самостоятельное событие с любым уровнем
    и текстом, какие подберёт атакующий.

    JSON-синк экранирует переводы строк и сам, текстовый — нет; patcher
    работает до обоих.
    """
    record["message"] = _scrub(record["message"])


def _install_stdlib_scrubber() -> None:
    """То же самое для stdlib `logging` — и это основной путь, не loguru.

    Через `from loguru import logger` пишет меньшинство модулей. Все семь
    файлов, где CodeQL нашёл `log-injection` (`routers/websocket.py` с
    `book_id: str` из пути, `routers/admin/entities.py`, `entity_service.py`,
    `entity_deduplication_service.py`, `feature_flag_manager.py`,
    `settings_manager.py`, `illustration_service.py`), берут
    `logging.getLogger(__name__)` — мимо loguru целиком.

    Хук — фабрика записей, а не фильтр и не хендлер, потому что:
    * фильтр на логгере не видит записи дочерних логгеров (они приходят
      в хендлер уже пропагированными);
    * набор хендлеров тут неопределённый — `core/database.py` вызывает
      `basicConfig()`, а до него работает `logging.lastResort`;
    * фабрика вызывается ровно один раз на запись, до любого хендлера,
      и не зависит от уровня.

    `msg` и `args` обрабатываются раздельно, чтобы не терять ленивое
    %-форматирование: у f-string'ов всё содержимое в `msg`, у %-стиля —
    в `args`.
    """
    previous = logging.getLogRecordFactory()

    # Идемпотентность: `setup_logging` зовётся и при импорте модуля,
    # и из тестов, а фабрики иначе вложились бы друг в друга.
    if getattr(previous, "_fancai_scrubber", False):
        return

    def factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        record.msg = _scrub(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: _scrub(v) for k, v in record.args.items()}
            else:
                record.args = tuple(_scrub(a) for a in record.args)
        return record

    factory._fancai_scrubber = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)


def setup_logging(debug: bool = True, log_level: str = "INFO") -> None:
    """
    Configure loguru for the application.

    Args:
        debug: If True, use colorized human-readable format.
               If False, use JSON structured format for production.
        log_level: Minimum log level to output (DEBUG, INFO, WARNING, ERROR).
    """
    # Remove default handler
    logger.remove()

    # Оба пути логирования, которые есть в приложении. Patcher вешается
    # до синков и действует на оба loguru-синка; `configure` без `handlers=`
    # существующие обработчики не сносит.
    logger.configure(patcher=_scrub_loguru_record)
    _install_stdlib_scrubber()

    if debug:
        # Development: colorized, human-readable format
        logger.add(
            sys.stderr,
            format=(
                "<green>{time:HH:mm:ss}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
                "<level>{message}</level>"
            ),
            level=log_level,
            colorize=True,
            backtrace=True,
            diagnose=True,
        )
    else:
        # Production: JSON structured logging
        logger.add(
            sys.stderr,
            format="{message}",
            level=log_level,
            serialize=True,
            backtrace=False,
            diagnose=False,
        )

    logger.info(
        "Logging configured",
        mode="development" if debug else "production",
        level=log_level,
    )


def get_logger(name: str = __name__) -> "Logger":
    """
    Get a logger instance bound with the module name.

    Args:
        name: Module name for the logger (usually __name__)

    Returns:
        Bound logger instance with the module name
    """
    return logger.bind(name=name)


# Initialize logging on module import
def _auto_configure() -> None:
    """
    Auto-configure logging based on settings.

    This runs on module import to ensure logging is configured
    before any log statements are executed.
    """
    try:
        from app.core.config import settings

        setup_logging(
            debug=settings.DEBUG,
            log_level=settings.LOG_LEVEL,
        )
    except Exception:
        # Fallback if settings not available (e.g., during testing)
        setup_logging(debug=True, log_level="DEBUG")


# Auto-configure on import
_auto_configure()

# Export configured logger
__all__ = ["logger", "setup_logging", "get_logger"]
