"""
Retry Utilities with Exponential Backoff.

This module provides configurable retry decorators and utilities using tenacity
for resilient API calls and async operations.

Features:
- Exponential backoff with configurable parameters
- Jitter to prevent thundering herd problem
- Exception-based retry filtering
- Async-compatible decorators
- Pre-configured decorators for common use cases

Usage:
    from app.core.retry import (
        retry_api_call,
        retry_image_generation,
        retry_llm_extraction,
        create_retry_decorator,
    )

    @retry_image_generation
    async def generate_image(prompt: str) -> bytes:
        ...

    @retry_api_call
    async def fetch_data(url: str) -> dict:
        ...

Created: 2025-12-28
"""

import asyncio
import logging
from typing import Any, Callable, Optional, Sequence, Type, TypeVar

from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
    wait_exponential,
    before_sleep_log,
    after_log,
)
from tenacity.wait import wait_base

logger = logging.getLogger(__name__)

# Type variable for generic function signatures
F = TypeVar("F", bound=Callable[..., Any])


# ============================================================================
# Custom Exception Types for Retry Logic
# ============================================================================


class RetryableError(Exception):
    """Base class for errors that should trigger a retry."""

    pass


class RateLimitError(RetryableError):
    """Error when API rate limit is exceeded."""

    def __init__(
        self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None
    ):
        super().__init__(message)
        self.retry_after = retry_after


class ServiceUnavailableError(RetryableError):
    """Error when external service is temporarily unavailable."""

    pass


class TimeoutError(RetryableError):
    """Error when operation times out."""

    pass


class TransientNetworkError(RetryableError):
    """Error for transient network issues."""

    pass


class ImageGenerationError(RetryableError):
    """Error during image generation that may be retryable."""

    pass


class LLMExtractionError(RetryableError):
    """Error during LLM-based extraction that may be retryable."""

    pass


# ============================================================================
# Retry Configuration
# ============================================================================


# Default retryable exceptions
DEFAULT_RETRYABLE_EXCEPTIONS: tuple[Type[Exception], ...] = (
    RetryableError,
    RateLimitError,
    ServiceUnavailableError,
    TimeoutError,
    TransientNetworkError,
    asyncio.TimeoutError,
    ConnectionError,
    OSError,
)

# Image generation specific exceptions
IMAGE_GENERATION_EXCEPTIONS: tuple[Type[Exception], ...] = (
    ImageGenerationError,
    RateLimitError,
    ServiceUnavailableError,
    TimeoutError,
    asyncio.TimeoutError,
    ConnectionError,
    RuntimeError,  # OpenRouter missing choices — transient
)

# LLM extraction specific exceptions
LLM_EXTRACTION_EXCEPTIONS: tuple[Type[Exception], ...] = (
    LLMExtractionError,
    RateLimitError,
    ServiceUnavailableError,
    TimeoutError,
    asyncio.TimeoutError,
    ConnectionError,
)


# ============================================================================
# Logging Callbacks
# ============================================================================


def log_retry_attempt(retry_state: RetryCallState) -> None:
    """
    Log retry attempt with details.

    Args:
        retry_state: Current retry state from tenacity
    """
    attempt = retry_state.attempt_number
    exception = retry_state.outcome.exception() if retry_state.outcome else None
    wait_time = retry_state.next_action.sleep if retry_state.next_action else 0

    logger.warning(
        f"Retry attempt {attempt}: {type(exception).__name__ if exception else 'Unknown'} - "
        f"{str(exception)[:100] if exception else 'No error'} "
        f"(waiting {wait_time:.2f}s before next attempt)"
    )


def log_final_failure(retry_state: RetryCallState) -> None:
    """
    Log when all retries are exhausted.

    Args:
        retry_state: Final retry state from tenacity
    """
    exception = retry_state.outcome.exception() if retry_state.outcome else None
    logger.error(
        f"All {retry_state.attempt_number} retry attempts exhausted: "
        f"{type(exception).__name__ if exception else 'Unknown'} - "
        f"{str(exception) if exception else 'No error'}"
    )


# ============================================================================
# Decorator Factory
# ============================================================================


def create_retry_decorator(
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    retryable_exceptions: Optional[Sequence[Type[Exception]]] = None,
    log_retries: bool = True,
) -> Callable[[F], F]:
    """
    Create a retry decorator with configurable parameters.

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        initial_delay: Initial delay in seconds before first retry (default: 1.0)
        max_delay: Maximum delay cap in seconds (default: 60.0)
        exponential_base: Base for exponential backoff (default: 2.0)
        jitter: Whether to add random jitter (default: True)
        retryable_exceptions: Tuple of exception types to retry on
        log_retries: Whether to log retry attempts (default: True)

    Returns:
        A retry decorator configured with the specified parameters

    Example:
        @create_retry_decorator(max_retries=5, initial_delay=2.0)
        async def my_function():
            ...
    """
    if retryable_exceptions is None:
        retryable_exceptions = DEFAULT_RETRYABLE_EXCEPTIONS

    # Choose wait strategy based on jitter setting
    # Аннотация обязательна: ветки дают разные классы tenacity, и вывод по первой отверг бы вторую.
    wait_strategy: wait_base
    if jitter:
        wait_strategy = wait_exponential_jitter(
            initial=initial_delay,
            max=max_delay,
            exp_base=exponential_base,
        )
    else:
        wait_strategy = wait_exponential(
            multiplier=initial_delay,
            min=initial_delay,
            max=max_delay,
            exp_base=exponential_base,
        )

    # Build retry decorator
    retry_kwargs: dict[str, Any] = {
        "stop": stop_after_attempt(
            max_retries + 1
        ),  # +1 because first attempt isn't a retry
        "wait": wait_strategy,
        "retry": retry_if_exception_type(tuple(retryable_exceptions)),
        "reraise": True,
    }
    if log_retries:
        retry_kwargs["before_sleep"] = before_sleep_log(logger, logging.WARNING)
        retry_kwargs["after"] = after_log(logger, logging.DEBUG)
    retry_decorator = retry(**retry_kwargs)

    return retry_decorator


# ============================================================================
# Pre-configured Decorators
# ============================================================================


# Standard API call retry (3 retries, 1-10s delay with jitter)
retry_api_call = create_retry_decorator(
    max_retries=3,
    initial_delay=1.0,
    max_delay=10.0,
    exponential_base=2.0,
    jitter=True,
    retryable_exceptions=DEFAULT_RETRYABLE_EXCEPTIONS,
)


# Image generation retry (4 retries, 2-60s delay with jitter)
retry_image_generation = create_retry_decorator(
    max_retries=4,
    initial_delay=2.0,
    max_delay=60.0,
    exponential_base=2.0,
    jitter=True,
    retryable_exceptions=IMAGE_GENERATION_EXCEPTIONS,
)


# LLM extraction retry (3 retries, 1-30s delay with jitter)
retry_llm_extraction = create_retry_decorator(
    max_retries=3,
    initial_delay=1.0,
    max_delay=30.0,
    exponential_base=2.0,
    jitter=True,
    retryable_exceptions=LLM_EXTRACTION_EXCEPTIONS,
)


# Fast retry for non-critical operations (2 retries, 0.5-3s delay)
retry_fast = create_retry_decorator(
    max_retries=2,
    initial_delay=0.5,
    max_delay=3.0,
    exponential_base=1.5,
    jitter=True,
    retryable_exceptions=DEFAULT_RETRYABLE_EXCEPTIONS,
)


# Critical operations retry (5 retries, 1-60s delay)
retry_critical = create_retry_decorator(
    max_retries=5,
    initial_delay=1.0,
    max_delay=60.0,
    exponential_base=2.0,
    jitter=True,
    retryable_exceptions=DEFAULT_RETRYABLE_EXCEPTIONS,
)


# ============================================================================
# Async Retry Context Manager
# ============================================================================


class AsyncRetryContext:
    """
    Async context manager for retry logic.

    Useful when you need more control over the retry process
    or want to use retry logic in a with statement.

    Example:
        async with AsyncRetryContext(max_retries=3) as retry_ctx:
            async for attempt in retry_ctx:
                with attempt:
                    result = await some_operation()
    """

    def __init__(
        self,
        max_retries: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True,
        retryable_exceptions: Optional[Sequence[Type[Exception]]] = None,
    ):
        if retryable_exceptions is None:
            retryable_exceptions = DEFAULT_RETRYABLE_EXCEPTIONS

        # Аннотация обязательна: ветки дают разные классы tenacity, и вывод по первой отверг бы вторую.
        wait_strategy: wait_base
        if jitter:
            wait_strategy = wait_exponential_jitter(
                initial=initial_delay,
                max=max_delay,
                exp_base=exponential_base,
            )
        else:
            wait_strategy = wait_exponential(
                multiplier=initial_delay,
                min=initial_delay,
                max=max_delay,
                exp_base=exponential_base,
            )

        self._retrying = AsyncRetrying(
            stop=stop_after_attempt(max_retries + 1),
            wait=wait_strategy,
            retry=retry_if_exception_type(tuple(retryable_exceptions)),
            reraise=True,
        )

    async def __aenter__(self) -> "AsyncRetrying":
        return self._retrying

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        pass


# ============================================================================
# Utility Functions
# ============================================================================


async def retry_with_backoff_async(
    func: Callable[..., Any],
    *args: Any,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 60.0,
    jitter: bool = True,
    retryable_exceptions: Optional[Sequence[Type[Exception]]] = None,
    **kwargs: Any,
) -> Any:
    """
    Execute an async function with exponential backoff retry.

    This is a functional alternative to the decorator approach.

    Args:
        func: The async function to execute
        *args: Positional arguments for the function
        max_retries: Maximum retry attempts
        initial_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds
        jitter: Whether to add jitter
        retryable_exceptions: Exceptions that trigger retry
        **kwargs: Keyword arguments for the function

    Returns:
        The result of the function

    Example:
        result = await retry_with_backoff_async(
            fetch_data,
            url,
            max_retries=5,
            initial_delay=2.0,
        )
    """
    if retryable_exceptions is None:
        retryable_exceptions = DEFAULT_RETRYABLE_EXCEPTIONS

    # Аннотация обязательна: ветки дают разные классы tenacity, и вывод по первой отверг бы вторую.
    wait_strategy: wait_base
    if jitter:
        wait_strategy = wait_exponential_jitter(
            initial=initial_delay,
            max=max_delay,
        )
    else:
        wait_strategy = wait_exponential(
            multiplier=initial_delay,
            min=initial_delay,
            max=max_delay,
        )

    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(max_retries + 1),
        wait=wait_strategy,
        retry=retry_if_exception_type(tuple(retryable_exceptions)),
        reraise=True,
    ):
        with attempt:
            return await func(*args, **kwargs)


def wrap_exception_for_retry(
    exception: Exception,
    retryable: bool = True,
) -> Exception:
    """
    Wrap an exception to make it retryable or non-retryable.

    Args:
        exception: The original exception
        retryable: Whether the exception should trigger a retry

    Returns:
        A wrapped exception that is/isn't retryable

    Example:
        try:
            response = await client.generate()
        except SomeAPIError as e:
            if e.status_code == 429:
                raise wrap_exception_for_retry(e, retryable=True)
            raise wrap_exception_for_retry(e, retryable=False)
    """
    if retryable:
        wrapped = RetryableError(str(exception))
        wrapped.__cause__ = exception
        return wrapped
    else:
        # Return original exception without wrapping
        return exception


def is_rate_limit_error(exception: Exception) -> bool:
    """
    Check if an exception indicates a rate limit error.

    Args:
        exception: The exception to check

    Returns:
        True if the exception is a rate limit error
    """
    if isinstance(exception, RateLimitError):
        return True

    error_message = str(exception).lower()
    rate_limit_indicators = [
        "rate limit",
        "rate_limit",
        "too many requests",
        "429",
        "quota exceeded",
        "throttl",
    ]

    return any(indicator in error_message for indicator in rate_limit_indicators)


def is_transient_error(exception: Exception) -> bool:
    """
    Check if an exception indicates a transient (temporary) error.

    Args:
        exception: The exception to check

    Returns:
        True if the exception is likely transient
    """
    if isinstance(
        exception, (TransientNetworkError, ServiceUnavailableError, TimeoutError)
    ):
        return True

    error_message = str(exception).lower()
    transient_indicators = [
        "timeout",
        "connection reset",
        "connection refused",
        "temporarily unavailable",
        "service unavailable",
        "503",
        "502",
        "504",
        "network",
        "socket",
    ]

    return any(indicator in error_message for indicator in transient_indicators)
