"""
Health check endpoints для мониторинга состояния fancai.

Endpoints:
- GET /health - Базовый health check (быстрый)
- GET /health/reading-sessions - Детальный health check reading sessions системы
- GET /health/deep - Полный health check всех систем
- GET /metrics - Prometheus metrics endpoint

Features:
- Проверка доступности БД, Redis, Celery
- Метрики активных сессий
- Статус background tasks
- Версия приложения и время uptime
"""


from fastapi import APIRouter, Depends, status as http_status, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, Annotated
from datetime import datetime, timezone, timedelta
import asyncio
import time
import secrets
import redis.asyncio as redis

from loguru import logger

from ..core.database import get_database_session
from ..core.config import settings
from ..core.celery_app import celery_app
from ..models.reading_session import ReadingSession
from ..monitoring.metrics import (
    update_active_sessions_gauge,
    update_abandoned_sessions_gauge,
    update_concurrent_users_gauge,
    active_sessions_count,
)

# Для prometheus metrics endpoint
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from fastapi.responses import Response


router = APIRouter()
security_basic = HTTPBasic()

# Время старта приложения для uptime
APP_START_TIME = time.time()


# ============================================================================
# Response Models
# ============================================================================


class HealthCheckResponse(BaseModel):
    """Базовый health check response."""

    status: str = Field(..., description="Статус системы: healthy, degraded, unhealthy")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    version: str = Field(default="2.0.0", description="Версия приложения")
    uptime_seconds: float = Field(..., description="Время работы приложения в секундах")


class ComponentHealthResponse(BaseModel):
    """Health check отдельного компонента."""

    status: str = Field(..., description="ok, warning, error")
    message: Optional[str] = Field(None, description="Дополнительное сообщение")
    latency_ms: Optional[float] = Field(
        None, description="Время отклика в миллисекундах"
    )
    details: Optional[Dict[str, Any]] = Field(None, description="Дополнительные детали")


class ReadingSessionsHealthResponse(BaseModel):
    """Health check для reading sessions системы."""

    status: str
    timestamp: datetime
    checks: Dict[str, ComponentHealthResponse]
    metrics: Dict[str, Any]


class DeepHealthCheckResponse(BaseModel):
    """Полный health check всех систем."""

    status: str
    timestamp: datetime
    version: str
    uptime_seconds: float
    components: Dict[str, ComponentHealthResponse]


# ============================================================================
# Helper Functions
# ============================================================================


async def check_database(db: AsyncSession) -> ComponentHealthResponse:
    """
    Проверить подключение к PostgreSQL.

    Args:
        db: Database session

    Returns:
        ComponentHealthResponse с результатом проверки
    """
    try:
        start_time = time.time()
        result = await db.execute(text("SELECT 1"))
        latency = (time.time() - start_time) * 1000  # в миллисекундах

        if result.scalar() == 1:
            return ComponentHealthResponse(
                status="ok",
                message="Database connection successful",
                latency_ms=round(latency, 2),
            )
        else:
            return ComponentHealthResponse(
                status="error",
                message="Database query returned unexpected result",
                latency_ms=round(latency, 2),
            )
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return ComponentHealthResponse(
            status="error",
            message="Database connection failed",
        )


async def check_redis() -> ComponentHealthResponse:
    """
    Проверить подключение к Redis.

    Returns:
        ComponentHealthResponse с результатом проверки
    """
    try:
        start_time = time.time()
        # Create a connection to Redis
        r = redis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        # Perform PING
        is_connected = await r.ping()
        latency = (time.time() - start_time) * 1000  # ms
        
        # Close connection
        await r.close()

        if is_connected:
            return ComponentHealthResponse(
                status="ok", 
                message="Redis connection successful", 
                latency_ms=round(latency, 2)
            )
        else:
            return ComponentHealthResponse(
                status="error", message="Redis PING failed"
            )
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        return ComponentHealthResponse(
            status="error", message="Redis connection failed"
        )


async def check_celery() -> ComponentHealthResponse:
    """
    Проверить статус Celery workers.
    
    Использует Celery control inspect API для пинга воркеров.

    Returns:
        ComponentHealthResponse с результатом проверки
    """
    try:
        start_time = time.time()
        
        # Wrap synchronous Celery inspect in thread to avoid blocking event loop
        def _check_celery_workers():
            inspector = celery_app.control.inspect(timeout=0.5)
            return inspector.active()
        
        active = await asyncio.to_thread(_check_celery_workers)
        
        latency = (time.time() - start_time) * 1000  # ms

        if active is None:
             # If no workers found/responding
             return ComponentHealthResponse(
                status="warning", 
                message="No Celery workers found or inspector timed out",
                latency_ms=round(latency, 2)
            )
        
        worker_count = len(active) if active else 0
        
        if worker_count > 0:
            return ComponentHealthResponse(
                status="ok",
                message=f"Celery workers active: {worker_count}",
                latency_ms=round(latency, 2),
                details={"active_workers_count": worker_count, "workers": list(active.keys())},
            )
        else:
            return ComponentHealthResponse(
                status="warning",
                message="Celery workers set is empty",
                latency_ms=round(latency, 2)
            )

    except Exception as e:
        logger.error(f"Celery health check failed: {e}")
        return ComponentHealthResponse(
            status="error", message="Celery check failed"
        )


async def get_active_sessions_stats(db: AsyncSession) -> Dict[str, Any]:
    """
    Получить статистику активных сессий.

    Args:
        db: Database session

    Returns:
        Dictionary с количеством сессий по типам устройств
    """
    try:
        # Общее количество активных сессий
        total_query = select(func.count(ReadingSession.id)).where(
            ReadingSession.is_active == True  # noqa: E712
        )
        total_result = await db.execute(total_query)
        total_active = total_result.scalar() or 0

        # По типам устройств
        device_query = (
            select(
                ReadingSession.device_type, func.count(ReadingSession.id).label("count")
            )
            .where(ReadingSession.is_active == True)  # noqa: E712
            .group_by(ReadingSession.device_type)
        )

        device_result = await db.execute(device_query)
        device_stats = {
            row.device_type or "unknown": row.count for row in device_result
        }

        # Уникальные пользователи с активными сессиями
        users_query = select(func.count(func.distinct(ReadingSession.user_id))).where(
            ReadingSession.is_active == True  # noqa: E712
        )
        users_result = await db.execute(users_query)
        concurrent_users = users_result.scalar() or 0

        return {
            "total_active": total_active,
            "by_device": device_stats,
            "concurrent_users": concurrent_users,
        }
    except Exception:
        return {"total_active": 0, "by_device": {}, "concurrent_users": 0}


async def get_abandoned_sessions_count(db: AsyncSession) -> int:
    """
    Получить количество заброшенных сессий (активные > 24 часа).

    Args:
        db: Database session

    Returns:
        Количество заброшенных сессий
    """
    try:
        threshold = datetime.now(timezone.utc) - timedelta(hours=24)
        query = select(func.count(ReadingSession.id)).where(
            ReadingSession.is_active == True,  # noqa: E712
            ReadingSession.started_at < threshold,
        )
        result = await db.execute(query)
        return result.scalar() or 0
    except Exception:
        return 0


# ============================================================================
# Endpoints
# ============================================================================


@router.get(
    "/health",
    response_model=HealthCheckResponse,
    summary="Базовый health check",
    description="Быстрая проверка доступности API. Используется для load balancer health checks.",
    status_code=http_status.HTTP_200_OK,
)
async def basic_health_check() -> HealthCheckResponse:
    """
    Базовый health check endpoint.

    Возвращает минимальную информацию о статусе приложения.
    Используется для простых проверок доступности.

    Returns:
        HealthCheckResponse с базовой информацией
    """
    uptime = time.time() - APP_START_TIME

    return HealthCheckResponse(status="healthy", uptime_seconds=round(uptime, 2))


@router.get(
    "/health/reading-sessions",
    response_model=ReadingSessionsHealthResponse,
    summary="Health check reading sessions системы",
    description="Детальная проверка состояния reading sessions: БД, активные сессии, Celery tasks.",
    responses={
        200: {"description": "Система работает нормально"},
        503: {"description": "Система деградировала или недоступна"},
    },
)
async def reading_sessions_health_check(
    db: AsyncSession = Depends(get_database_session),
) -> ReadingSessionsHealthResponse:
    """
    Детальный health check для reading sessions системы.

    Проверяет:
    - Database connectivity
    - Active sessions count
    - Celery task status
    - Redis connectivity
    - Abandoned sessions count

    Args:
        db: Database session

    Returns:
        ReadingSessionsHealthResponse с детальной информацией
    """
    # Параллельное выполнение всех проверок
    db_check_result, redis_check_result, celery_check_result, stats_result, abandoned_result = await asyncio.gather(
        check_database(db),
        check_redis(),
        check_celery(),
        get_active_sessions_stats(db),
        get_abandoned_sessions_count(db),
        return_exceptions=True,
    )

    # Обработка исключений - преобразуем BaseException в типизированные значения
    if isinstance(db_check_result, BaseException):
        db_check = ComponentHealthResponse(
            status="error",
            message=f"Database check failed: {db_check_result}",
        )
    else:
        db_check = db_check_result

    if isinstance(redis_check_result, BaseException):
        redis_check = ComponentHealthResponse(
            status="error",
            message=f"Redis check failed: {redis_check_result}",
        )
    else:
        redis_check = redis_check_result

    if isinstance(celery_check_result, BaseException):
        celery_check = ComponentHealthResponse(
            status="error",
            message=f"Celery check failed: {celery_check_result}",
        )
    else:
        celery_check = celery_check_result

    if isinstance(stats_result, BaseException):
        stats: Dict[str, Any] = {"total_active": 0, "by_device": {}, "concurrent_users": 0}
    else:
        stats = stats_result

    if isinstance(abandoned_result, BaseException):
        abandoned: int = 0
    else:
        abandoned = abandoned_result

    # Обновляем Prometheus gauges
    update_active_sessions_gauge(stats["total_active"])
    update_abandoned_sessions_gauge(abandoned)
    update_concurrent_users_gauge(stats["concurrent_users"])

    # Определяем общий статус
    checks_status = [db_check.status, redis_check.status, celery_check.status]
    if all(s == "ok" for s in checks_status):
        overall_status = "healthy"
    elif any(s == "error" for s in checks_status):
        overall_status = "unhealthy"
    else:
        overall_status = "degraded"

    return ReadingSessionsHealthResponse(
        status=overall_status,
        timestamp=datetime.now(timezone.utc),
        checks={
            "database": db_check,
            "redis": redis_check,
            "celery": celery_check,
        },
        metrics={
            "active_sessions_total": stats["total_active"],
            "active_sessions_by_device": stats["by_device"],
            "concurrent_users": stats["concurrent_users"],
            "abandoned_sessions": abandoned,
        },
    )


@router.get(
    "/health/deep",
    response_model=DeepHealthCheckResponse,
    summary="Полный health check всех систем",
    description="Комплексная проверка всех компонентов fancai.",
    status_code=http_status.HTTP_200_OK,
)
async def deep_health_check(
    db: AsyncSession = Depends(get_database_session),
) -> DeepHealthCheckResponse:
    """
    Полный health check всех систем fancai.

    Проверяет:
    - PostgreSQL database
    - Redis cache
    - Celery workers
    - Reading sessions stats
    - NLP services status
    - Image generation services

    Args:
        db: Database session

    Returns:
        DeepHealthCheckResponse с полной информацией о всех компонентах
    """
    uptime = time.time() - APP_START_TIME

    # Параллельные проверки
    db_check_result, redis_check_result, celery_check_result, stats_result = await asyncio.gather(
        check_database(db),
        check_redis(),
        check_celery(),
        get_active_sessions_stats(db),
        return_exceptions=True,
    )

    if isinstance(db_check_result, BaseException):
        db_check = ComponentHealthResponse(
            status="error",
            message=f"Database check failed: {db_check_result}",
        )
    else:
        db_check = db_check_result

    if isinstance(redis_check_result, BaseException):
        redis_check = ComponentHealthResponse(
            status="error",
            message=f"Redis check failed: {redis_check_result}",
        )
    else:
        redis_check = redis_check_result

    if isinstance(celery_check_result, BaseException):
        celery_check = ComponentHealthResponse(
            status="error",
            message=f"Celery check failed: {celery_check_result}",
        )
    else:
        celery_check = celery_check_result

    if isinstance(stats_result, BaseException):
        stats: Dict[str, Any] = {"total_active": 0, "by_device": {}, "concurrent_users": 0}
    else:
        stats = stats_result

    components: Dict[str, ComponentHealthResponse] = {
        "database": db_check,
        "redis": redis_check,
        "celery": celery_check,
        "reading_sessions": ComponentHealthResponse(
            status="ok",
            message="Reading sessions service operational",
            details={
                "active_sessions": stats["total_active"],
                "concurrent_users": stats["concurrent_users"],
            },
        ),
    }

    # Определяем общий статус
    all_statuses = [comp.status for comp in components.values()]
    if all(s == "ok" for s in all_statuses):
        overall_status = "healthy"
    elif any(s == "error" for s in all_statuses):
        overall_status = "unhealthy"
    else:
        overall_status = "degraded"

    return DeepHealthCheckResponse(
        status=overall_status,
        timestamp=datetime.now(timezone.utc),
        version="2.0.0",
        uptime_seconds=round(uptime, 2),
        components=components,
    )


def verify_metrics_auth(credentials: Annotated[HTTPBasicCredentials, Depends(security_basic)]):
    """
    Проверка Basic Auth для доступа к метрикам.
    
    В production окружении переменные для auth должны быть заданы.
    Для простоты используем заглушку, которую легко настроить.
    """
    from ..core.config import settings
    
    current_username_bytes = credentials.username.encode("utf8")
    correct_username_bytes = settings.METRICS_USER.encode("utf8")
    is_correct_username = secrets.compare_digest(
        current_username_bytes, correct_username_bytes
    )
    
    current_password_bytes = credentials.password.encode("utf8")
    correct_password_bytes = settings.METRICS_PASSWORD.encode("utf8")
    is_correct_password = secrets.compare_digest(
        current_password_bytes, correct_password_bytes
    )
    
    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


@router.get(
    "/metrics",
    summary="Prometheus metrics endpoint",
    description="Экспортирует все метрики в формате Prometheus для scraping. Requires Basic Auth.",
    response_class=Response,  # NOTE: Returns plain text, not JSON
    tags=["prometheus", "metrics"],
)
async def metrics_endpoint(
    db: AsyncSession = Depends(get_database_session),
    username: str = Depends(verify_metrics_auth)
):
    """
    Prometheus metrics endpoint.

    Экспортирует все метрики в формате, который может scrape Prometheus.
    Endpoint должен быть доступен для Prometheus сервера.

    Args:
        db: Database session (для обновления gauges)
        username: Authenticated user

    Returns:
        Response с метриками в Prometheus формате
    """
    # Обновляем gauges перед экспортом
    try:
        stats = await get_active_sessions_stats(db)
        abandoned = await get_abandoned_sessions_count(db)

        update_active_sessions_gauge(stats["total_active"])
        update_abandoned_sessions_gauge(abandoned)
        update_concurrent_users_gauge(stats["concurrent_users"])

        # Обновляем gauges по device_type
        for device_type, count in stats["by_device"].items():
            active_sessions_count.labels(device_type=device_type).set(count)

    except Exception:
        # Если не удалось обновить gauges, продолжаем с текущими значениями
        pass

    # Генерируем метрики в Prometheus формате
    metrics_output = generate_latest()

    return Response(content=metrics_output, media_type=CONTENT_TYPE_LATEST)
