"""Error classification for pipeline observability (OBS-01).

Classifies pipeline exceptions into normalized error types for structured
logging, DB storage (chapter.error_type), and retry strategy selection.

Провайдер-нейтрален. Раньше модуль распознавал исключения Modal SDK по
type(exc).__name__ и складывал всё неизвестное в "modal_error". После
удаления Modal-пайплайна эти ветки стали недостижимы, а fallback начал
помечать любую ошибку Gemini как модальную — то есть врать в логах и в
chapters.error_type. Имена сделаны нейтральными, миграция
c7d8e9f0a1b2 переписывает исторические строки.
"""

import asyncio
import json

# Error type constants -- single source of truth
ERROR_TYPE_TIMEOUT = "timeout"
ERROR_TYPE_JSON_ERROR = "json_error"
ERROR_TYPE_PROVIDER_ERROR = "provider_error"
ERROR_TYPE_CANCELLED = "cancelled"
ERROR_TYPE_TRUNCATED = "truncated"

VALID_ERROR_TYPES = {
    ERROR_TYPE_TIMEOUT,
    ERROR_TYPE_JSON_ERROR,
    ERROR_TYPE_PROVIDER_ERROR,
    ERROR_TYPE_CANCELLED,
    ERROR_TYPE_TRUNCATED,
}


def classify_error(exc: BaseException) -> str:
    """Classify pipeline exception into normalized error_type.

    Args:
        exc: The caught exception

    Returns:
        Normalized error type string from VALID_ERROR_TYPES
    """
    if isinstance(exc, json.JSONDecodeError):
        return ERROR_TYPE_JSON_ERROR
    # asyncio.CancelledError наследует BaseException, а не Exception,
    # поэтому проверяется до общих веток.
    if isinstance(exc, asyncio.CancelledError):
        return ERROR_TYPE_CANCELLED
    # В Python 3.11+ asyncio.TimeoutError — псевдоним TimeoutError.
    if isinstance(exc, TimeoutError):
        return ERROR_TYPE_TIMEOUT

    return ERROR_TYPE_PROVIDER_ERROR
