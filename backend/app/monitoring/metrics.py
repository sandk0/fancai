"""
Prometheus metrics для мониторинга Reading Sessions в fancai.

Метрики:
- Counters: sessions_started_total, sessions_ended_total, session_errors_total
- Histograms: session_duration_seconds, session_pages_read
- Gauges: active_sessions_count, abandoned_sessions_count

Integration:
- Используется в routers/reading_sessions.py
- Экспортируется через /metrics endpoint
- Собирается Prometheus каждые 15 секунд
"""

from prometheus_client import Counter, Histogram, Gauge, Info
from typing import Optional
import time

# ============================================================================
# Counters - монотонно растущие счетчики
# ============================================================================

sessions_started_total = Counter(
    "reading_sessions_started_total",
    "Total number of reading sessions started",
    ["device_type", "book_genre"],
)

sessions_ended_total = Counter(
    "reading_sessions_ended_total",
    "Total number of reading sessions ended",
    ["completion_status", "device_type"],
)

sessions_updated_total = Counter(
    "reading_sessions_updated_total",
    "Total number of session position updates",
    ["device_type"],
)

session_errors_total = Counter(
    "reading_sessions_errors_total",
    "Total number of errors in reading sessions operations",
    ["operation", "error_type"],
)


# ============================================================================
# Histograms - распределение значений
# ============================================================================

session_duration_seconds = Histogram(
    "reading_session_duration_seconds",
    "Reading session duration in seconds",
    # Buckets: 1min, 5min, 10min, 30min, 1hour, 2hours, 4hours, 8hours
    buckets=[60, 300, 600, 1800, 3600, 7200, 14400, 28800],
    labelnames=["device_type", "completion_status"],
)

session_pages_read = Histogram(
    "reading_session_pages_read",
    "Number of pages read during session",
    buckets=[1, 5, 10, 20, 50, 100, 200, 500],
    labelnames=["device_type"],
)

session_progress_delta = Histogram(
    "reading_session_progress_delta_percent",
    "Progress delta (end - start position) in percent",
    buckets=[1, 5, 10, 20, 30, 50, 75, 100],
    labelnames=["device_type"],
)

session_api_latency_seconds = Histogram(
    "reading_session_api_latency_seconds",
    "API endpoint latency for reading sessions operations",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
    labelnames=["endpoint", "method", "status_code"],
)


# ============================================================================
# Gauges - значения, которые могут расти и падать
# ============================================================================

active_sessions_count = Gauge(
    "reading_sessions_active_count",
    "Current number of active reading sessions",
    ["device_type"],
)

abandoned_sessions_count = Gauge(
    "reading_sessions_abandoned_count",
    "Number of sessions abandoned (active > 24 hours)",
)

concurrent_users_count = Gauge(
    "reading_sessions_concurrent_users", "Number of unique users with active sessions"
)


# ============================================================================
# Info - метаинформация (не изменяется часто)
# ============================================================================

reading_system_info = Info(
    "reading_sessions_system", "Reading sessions system information"
)

# Устанавливаем версию системы и дату последнего деплоя
reading_system_info.info(
    {"version": "2.0.0", "feature": "reading_sessions", "deployed_at": "2025-10-28"}
)


# ============================================================================
# Helper Functions - обертки для удобного использования
# ============================================================================


class MetricsCollector:
    """
    Класс для удобного сбора метрик с контекстным менеджером.

    Usage:
        with MetricsCollector.measure_duration(
            endpoint='start_session',
            method='POST'
        ) as collector:
            # ... операция ...
            collector.set_status(201)
    """

    def __init__(self, endpoint: str, method: str):
        """
        Инициализация коллектора метрик.

        Args:
            endpoint: Название endpoint (start, update, end, etc.)
            method: HTTP метод (GET, POST, PUT)
        """
        self.endpoint = endpoint
        self.method = method
        self.start_time = None
        self.status_code = 200

    def __enter__(self):
        """Начало измерения времени."""
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Завершение измерения и запись метрики."""
        duration = time.time() - self.start_time

        # Если было исключение, ставим 500
        if exc_type is not None:
            self.status_code = 500

        # Записываем латентность
        session_api_latency_seconds.labels(
            endpoint=self.endpoint,
            method=self.method,
            status_code=str(self.status_code),
        ).observe(duration)

    def set_status(self, status_code: int):
        """
        Установить статус код ответа.

        Args:
            status_code: HTTP статус код (200, 201, 400, 404, etc.)
        """
        self.status_code = status_code

    @classmethod
    def measure_duration(cls, endpoint: str, method: str):
        """
        Создать новый коллектор для измерения времени выполнения.

        Args:
            endpoint: Название endpoint
            method: HTTP метод

        Returns:
            MetricsCollector instance
        """
        return cls(endpoint, method)


def record_session_started(
    device_type: Optional[str] = None, book_genre: Optional[str] = None
):
    """
    Записать метрику старта сессии.

    Args:
        device_type: Тип устройства (mobile, tablet, desktop)
        book_genre: Жанр книги (fiction, non-fiction, etc.)
    """
    sessions_started_total.labels(
        device_type=device_type or "unknown", book_genre=book_genre or "unknown"
    ).inc()


def record_session_ended(
    duration_seconds: float,
    pages_read: int,
    progress_delta: int,
    device_type: Optional[str] = None,
    completion_status: str = "completed",
):
    """
    Записать метрики завершения сессии.

    Args:
        duration_seconds: Длительность сессии в секундах
        pages_read: Количество прочитанных страниц
        progress_delta: Прогресс за сессию (0-100%)
        device_type: Тип устройства
        completion_status: Статус завершения (completed, abandoned, auto_closed)
    """
    device = device_type or "unknown"

    # Counter
    sessions_ended_total.labels(
        completion_status=completion_status, device_type=device
    ).inc()

    # Histograms
    session_duration_seconds.labels(
        device_type=device, completion_status=completion_status
    ).observe(duration_seconds)

    session_pages_read.labels(device_type=device).observe(pages_read)

    session_progress_delta.labels(device_type=device).observe(progress_delta)


def record_session_updated(device_type: Optional[str] = None):
    """
    Записать метрику обновления позиции в сессии.

    Args:
        device_type: Тип устройства
    """
    sessions_updated_total.labels(device_type=device_type or "unknown").inc()


def record_session_error(operation: str, error_type: str):
    """
    Записать метрику ошибки в операции с сессией.

    Args:
        operation: Тип операции (start, update, end, get_active, get_history)
        error_type: Тип ошибки (validation, not_found, database, permission)
    """
    session_errors_total.labels(operation=operation, error_type=error_type).inc()


def update_active_sessions_gauge(count: int, device_type: Optional[str] = None):
    """
    Обновить gauge активных сессий.

    Args:
        count: Количество активных сессий
        device_type: Тип устройства (опционально)
    """
    if device_type:
        active_sessions_count.labels(device_type=device_type).set(count)
    else:
        active_sessions_count.labels(device_type="all").set(count)


def update_abandoned_sessions_gauge(count: int):
    """
    Обновить gauge заброшенных сессий.

    Args:
        count: Количество заброшенных сессий
    """
    abandoned_sessions_count.set(count)


def update_concurrent_users_gauge(count: int):
    """
    Обновить gauge одновременных пользователей.

    Args:
        count: Количество уникальных пользователей с активными сессиями
    """
    concurrent_users_count.set(count)


# ============================================================================
# LLM Metrics - Gemini API monitoring
# ============================================================================

llm_requests_total = Counter(
    "llm_requests_total",
    "Total number of LLM API requests",
    ["model", "status"],
)

llm_request_duration_seconds = Histogram(
    "llm_request_duration_seconds",
    "LLM API request duration in seconds",
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0],
    labelnames=["model"],
)

llm_tokens_total = Counter(
    "llm_tokens_total",
    "Total tokens processed by LLM",
    ["model", "direction"],
)

llm_errors_total = Counter(
    "llm_errors_total",
    "Total LLM API errors",
    ["model", "error_type"],
)

llm_rate_limit_hits = Counter(
    "llm_rate_limit_hits_total",
    "Number of rate limit hits from LLM API",
    ["model"],
)

llm_descriptions_extracted_count = Histogram(
    "llm_descriptions_extracted_count",
    "Number of descriptions extracted per chunk/chapter",
    buckets=[0, 1, 5, 10, 20, 50, 100],
    labelnames=["model"],
)

llm_visual_summary_length_chars = Histogram(
    "llm_visual_summary_length_chars",
    "Length of generated visual_summary in characters",
    buckets=[0, 50, 100, 200, 300, 500, 1000],
    labelnames=["model"],
)

llm_cache_hits_total = Counter(
    "llm_cache_hits_total",
    "Total LLM cache hits",
    ["model"],
)

llm_cache_misses_total = Counter(
    "llm_cache_misses_total",
    "Total LLM cache misses",
    ["model"],
)


def record_llm_request(model: str, status: str, duration: float):
    llm_requests_total.labels(model=model, status=status).inc()
    llm_request_duration_seconds.labels(model=model).observe(duration)


def record_llm_tokens(model: str, input_tokens: int, output_tokens: int):
    llm_tokens_total.labels(model=model, direction="input").inc(input_tokens)
    llm_tokens_total.labels(model=model, direction="output").inc(output_tokens)


def record_llm_error(model: str, error_type: str):
    llm_errors_total.labels(model=model, error_type=error_type).inc()


def record_llm_rate_limit(model: str):
    llm_rate_limit_hits.labels(model=model).inc()


def record_description_count(model: str, count: int):
    llm_descriptions_extracted_count.labels(model=model).observe(count)


def record_visual_summary_length(model: str, length: int):
    llm_visual_summary_length_chars.labels(model=model).observe(length)


def record_llm_cache_hit(model: str):
    llm_cache_hits_total.labels(model=model).inc()


def record_llm_cache_miss(model: str):
    llm_cache_misses_total.labels(model=model).inc()


# ============================================================================
# Business Metrics — Wave 1+2 additions (Plan 04-01)
# ============================================================================

# --- Circuit Breaker ---

circuit_breaker_state = Gauge(
    "circuit_breaker_state",
    "Circuit breaker state: 0=closed, 1=half-open, 2=open",
    ["name"],
)

circuit_breaker_failure_count = Gauge(
    "circuit_breaker_failure_count",
    "Current failure count of circuit breaker",
    ["name"],
)

# --- LLM Cost & Fallback ---

llm_cost_dollars_total = Counter(
    "llm_cost_dollars_total",
    "Total cost of OpenRouter LLM API calls in USD",
    ["model"],
)

llm_fallback_total = Counter(
    "llm_fallback_total",
    "Total number of LLM fallback switches in the fallback chain",
    ["from_model", "to_model"],
)

# --- Auth Metrics ---

auth_registrations_total = Counter(
    "auth_registrations_total",
    "Total number of successful user registrations",
)

auth_logins_total = Counter(
    "auth_logins_total",
    "Total number of user login attempts",
    ["status"],  # "success" | "failure"
)

# --- Rate Limit Metrics ---

rate_limit_triggered_total = Counter(
    "rate_limit_triggered_total",
    "Total number of rate limit triggers (HTTP 429 responses)",
    ["endpoint", "limit_type"],  # limit_type: "ip" | "user_id"
)


# --- Helper functions for new metrics ---


def record_llm_cost(model: str, cost: float) -> None:
    """
    Записать стоимость OpenRouter LLM вызова в Prometheus Counter.

    Args:
        model: Идентификатор модели (например, "google/gemini-3-flash-preview")
        cost: Стоимость вызова в USD
    """
    llm_cost_dollars_total.labels(model=model).inc(cost)


def record_llm_fallback(from_model: str, to_model: str) -> None:
    """
    Записать переключение fallback chain в Prometheus Counter.

    Args:
        from_model: Модель, с которой переключились
        to_model: Модель, на которую переключились
    """
    llm_fallback_total.labels(from_model=from_model, to_model=to_model).inc()


def record_auth_registration() -> None:
    """Записать успешную регистрацию пользователя."""
    auth_registrations_total.inc()


def record_auth_login(status: str) -> None:
    """
    Записать попытку входа пользователя.

    Args:
        status: "success" или "failure"
    """
    auth_logins_total.labels(status=status).inc()


def record_rate_limit_triggered(endpoint: str, limit_type: str) -> None:
    """
    Записать срабатывание rate limiter (HTTP 429).

    Args:
        endpoint: URL path endpoint
        limit_type: "ip" или "user_id"
    """
    rate_limit_triggered_total.labels(endpoint=endpoint, limit_type=limit_type).inc()


# ============================================================================
# Export all metrics for /metrics endpoint
# ============================================================================

__all__ = [
    "sessions_started_total",
    "sessions_ended_total",
    "sessions_updated_total",
    "session_errors_total",
    "session_duration_seconds",
    "session_pages_read",
    "session_progress_delta",
    "session_api_latency_seconds",
    "active_sessions_count",
    "abandoned_sessions_count",
    "concurrent_users_count",
    "reading_system_info",
    "MetricsCollector",
    "record_session_started",
    "record_session_ended",
    "record_session_updated",
    "record_session_error",
    "update_active_sessions_gauge",
    "update_abandoned_sessions_gauge",
    "update_concurrent_users_gauge",
    "llm_requests_total",
    "llm_request_duration_seconds",
    "llm_tokens_total",
    "llm_errors_total",
    "llm_rate_limit_hits",
    "record_llm_request",
    "record_llm_tokens",
    "record_llm_error",
    "record_llm_rate_limit",
    "llm_descriptions_extracted_count",
    "llm_visual_summary_length_chars",
    "llm_cache_hits_total",
    "llm_cache_misses_total",
    "record_description_count",
    "record_visual_summary_length",
    "record_llm_cache_hit",
    "record_llm_cache_miss",
    # Circuit breaker
    "circuit_breaker_state",
    "circuit_breaker_failure_count",
    # Wave 1+2 additions
    "llm_cost_dollars_total",
    "llm_fallback_total",
    "auth_registrations_total",
    "auth_logins_total",
    "rate_limit_triggered_total",
    "record_llm_cost",
    "record_llm_fallback",
    "record_auth_registration",
    "record_auth_login",
    "record_rate_limit_triggered",
]
