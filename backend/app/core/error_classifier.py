"""Error classification for pipeline observability (OBS-01).

Classifies pipeline exceptions into normalized error types for structured
logging, DB storage (chapter.error_type), and retry strategy selection.

Uses type(exc).__name__ for Modal SDK exceptions (not isinstance) because
Modal SDK is an optional dependency -- import may not exist in tests or VPS.
"""

# Error type constants -- single source of truth for Phase 36-38 (D-02)
ERROR_TYPE_TIMEOUT = "timeout"
ERROR_TYPE_JSON_ERROR = "json_error"
ERROR_TYPE_MODAL_ERROR = "modal_error"
ERROR_TYPE_CANCELLED = "cancelled"
ERROR_TYPE_TRUNCATED = "truncated"

VALID_ERROR_TYPES = {
    ERROR_TYPE_TIMEOUT,
    ERROR_TYPE_JSON_ERROR,
    ERROR_TYPE_MODAL_ERROR,
    ERROR_TYPE_CANCELLED,
    ERROR_TYPE_TRUNCATED,
}


def classify_error(exc: BaseException) -> str:
    """Classify pipeline exception into normalized error_type.

    Uses type(exc).__name__ for Modal SDK exceptions (not isinstance)
    because Modal SDK is optional dependency -- import may not exist in tests.

    Args:
        exc: The caught exception

    Returns:
        Normalized error type string from VALID_ERROR_TYPES
    """
    import asyncio
    import json

    exc_type = type(exc).__name__

    # Modal SDK exceptions -- string comparison (no import needed)
    if exc_type == "FunctionTimeoutError":
        return ERROR_TYPE_TIMEOUT
    if exc_type == "InputCancellation":
        return ERROR_TYPE_CANCELLED
    if exc_type == "RemoteError":
        return ERROR_TYPE_MODAL_ERROR

    # Standard library exceptions -- isinstance safe
    if isinstance(exc, json.JSONDecodeError):
        return ERROR_TYPE_JSON_ERROR
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return ERROR_TYPE_TIMEOUT

    # Fallback: unknown -> modal_error
    return ERROR_TYPE_MODAL_ERROR
