"""
Response schemas for health check endpoints.

Используется в:
- GET /health/metrics - Prometheus metrics endpoint
"""

from pydantic import BaseModel, Field
from typing import Dict


class PrometheusMetricsResponse(BaseModel):
    """
    Response для Prometheus metrics endpoint.

    Технически возвращает plain text в Prometheus формате,
    но эта схема используется для documentation.

    Attributes:
        metrics_format: Формат метрик (prometheus)
        content_type: Content type (text/plain; version=0.0.4)
        metrics_available: Список доступных метрик
    """

    metrics_format: str = Field(
        default="prometheus", description="Формат метрик (prometheus)"
    )
    content_type: str = Field(
        default="text/plain; version=0.0.4",
        description="Content-Type для Prometheus scraping",
    )
    metrics_available: Dict[str, str] = Field(
        default_factory=lambda: {
            "active_sessions_total": "Gauge - Total active reading sessions",
            "abandoned_sessions_total": "Gauge - Total abandoned sessions (>24h)",
            "concurrent_users_total": "Gauge - Current concurrent users",
            "active_sessions_by_device": "Gauge - Active sessions by device type",
        },
        description="Список доступных метрик в Prometheus формате",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "metrics_format": "prometheus",
                "content_type": "text/plain; version=0.0.4",
                "metrics_available": {
                    "active_sessions_total": "Gauge - Total active reading sessions",
                    "abandoned_sessions_total": "Gauge - Total abandoned sessions",
                    "concurrent_users_total": "Gauge - Current concurrent users",
                },
            }
        }
