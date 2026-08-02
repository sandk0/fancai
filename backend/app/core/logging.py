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

import sys
from typing import Any, Dict, TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:  # loguru.Logger — только для аннотаций
    from loguru import Logger


def _serialize_extra(record: Dict[str, Any]) -> str:
    """
    Serialize extra fields for structured logging.

    Formats extra key-value pairs as JSON-like string for log messages.
    """
    extra = record.get("extra", {})
    # Filter out loguru internal keys
    user_extra = {
        k: v
        for k, v in extra.items()
        if not k.startswith("_") and k not in ("name", "function", "line")
    }
    if not user_extra:
        return ""
    return " | " + " ".join(f"{k}={v}" for k, v in user_extra.items())


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
