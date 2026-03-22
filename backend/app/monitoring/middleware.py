"""
FastAPI middleware для автоматического сбора метрик reading sessions.

Integration:
- Добавляется в main.py через app.add_middleware()
- Автоматически собирает метрики для всех /reading-sessions/* endpoints
- Обновляет Prometheus gauges периодически

Usage:
    from app.monitoring.middleware import ReadingSessionsMetricsMiddleware

    app.add_middleware(ReadingSessionsMetricsMiddleware)
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import Request, Response
from sqlalchemy import select, func
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from ..models.reading_session import ReadingSession
from .metrics import (
    session_api_latency_seconds,
    session_errors_total,
    sessions_updated_total,
    update_active_sessions_gauge,
    update_abandoned_sessions_gauge,
    update_concurrent_users_gauge,
    active_sessions_count,
)


class ReadingSessionsMetricsMiddleware(BaseHTTPMiddleware):
    """
    Middleware для автоматического сбора метрик reading sessions endpoints.

    Собирает:
    - Латентность API запросов
    - HTTP статус коды
    - Счетчики операций (start, update, end)
    - Ошибки по типам

    Example:
        app = FastAPI()
        app.add_middleware(ReadingSessionsMetricsMiddleware)
    """

    def __init__(self, app: ASGIApp):
        """
        Инициализация middleware.

        Args:
            app: ASGI приложение (FastAPI instance)
        """
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        Обработка HTTP запроса с измерением метрик.

        Args:
            request: HTTP request
            call_next: Следующий middleware в цепочке

        Returns:
            Response от endpoint
        """
        # Фильтруем только reading-sessions endpoints
        if not request.url.path.startswith("/api/v1/reading-sessions"):
            return await call_next(request)

        # Определяем endpoint name из path
        endpoint = self._extract_endpoint_name(request.url.path)

        # Измеряем время выполнения
        start_time = time.time()
        try:
            response = await call_next(request)
            duration = time.time() - start_time

            # Записываем латентность
            session_api_latency_seconds.labels(
                endpoint=endpoint,
                method=request.method,
                status_code=str(response.status_code),
            ).observe(duration)

            # Если это update endpoint, инкрементируем счетчик
            if endpoint == "update" and response.status_code == 200:
                # Достаем device_type из request (если есть)
                # NOTE: парсить request body для device_type — дорого в middleware, оставляем "unknown"
                sessions_updated_total.labels(device_type="unknown").inc()

            return response

        except Exception as e:
            duration = time.time() - start_time

            # Записываем ошибку
            session_api_latency_seconds.labels(
                endpoint=endpoint, method=request.method, status_code="500"
            ).observe(duration)

            # Инкрементируем счетчик ошибок
            error_type = type(e).__name__
            session_errors_total.labels(operation=endpoint, error_type=error_type).inc()

            raise

    def _extract_endpoint_name(self, path: str) -> str:
        """
        Извлечь название endpoint из URL path.

        Args:
            path: URL path (/api/v1/reading-sessions/start)

        Returns:
            Название endpoint (start, update, end, active, history)
        """
        # /api/v1/reading-sessions/start → start
        # /api/v1/reading-sessions/{id}/update → update
        # /api/v1/reading-sessions/{id}/end → end
        # /api/v1/reading-sessions/active → active
        # /api/v1/reading-sessions/history → history

        parts = path.strip("/").split("/")

        if len(parts) >= 4:
            # Последняя часть path
            last_part = parts[-1]

            if last_part in ["start", "active", "history"]:
                return last_part
            elif last_part in ["update", "end"]:
                # /reading-sessions/{id}/update
                return last_part
            else:
                return "unknown"
        else:
            return "unknown"


# ============================================================================
# Background Task для периодического обновления Gauges
# ============================================================================


async def update_gauges_periodically(db_session_factory, interval_seconds: int = 30):
    """
    Периодически обновляет Prometheus gauges из базы данных.

    Обновляет:
    - active_sessions_count
    - abandoned_sessions_count
    - concurrent_users_count

    Args:
        db_session_factory: Функция для создания database session
        interval_seconds: Интервал обновления (по умолчанию 30 секунд)

    Usage:
        # In main.py lifespan context manager:
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            # Startup
            asyncio.create_task(
                update_gauges_periodically(get_database_session, interval_seconds=30)
            )
            yield
            # Shutdown
    """
    while True:
        try:
            # Создаем новую database session
            async for db in db_session_factory():
                # Активные сессии (всего)
                total_active_query = select(func.count(ReadingSession.id)).where(
                    ReadingSession.is_active.is_(True)
                )
                total_active_result = await db.execute(total_active_query)
                total_active = total_active_result.scalar() or 0

                # Активные сессии по device_type
                device_query = (
                    select(
                        ReadingSession.device_type,
                        func.count(ReadingSession.id).label("count"),
                    )
                    .where(ReadingSession.is_active.is_(True))
                    .group_by(ReadingSession.device_type)
                )

                device_result = await db.execute(device_query)
                device_stats = {
                    row.device_type or "unknown": row.count for row in device_result
                }

                # Заброшенные сессии (активные > 24 часа)
                threshold = datetime.now(timezone.utc) - timedelta(hours=24)
                abandoned_query = select(func.count(ReadingSession.id)).where(
                    ReadingSession.is_active.is_(True),
                    ReadingSession.started_at < threshold,
                )
                abandoned_result = await db.execute(abandoned_query)
                abandoned = abandoned_result.scalar() or 0

                # Одновременные пользователи
                users_query = select(
                    func.count(func.distinct(ReadingSession.user_id))
                ).where(ReadingSession.is_active.is_(True))
                users_result = await db.execute(users_query)
                concurrent_users = users_result.scalar() or 0

                # Обновляем gauges
                update_active_sessions_gauge(total_active)
                update_abandoned_sessions_gauge(abandoned)
                update_concurrent_users_gauge(concurrent_users)

                # Обновляем по device_type
                for device_type, count in device_stats.items():
                    active_sessions_count.labels(device_type=device_type).set(count)

                # Закрываем session
                break

        except Exception as e:
            # Логируем ошибку, но не останавливаем цикл
            print(f"Error updating gauges: {str(e)}")

        # Ждем интервал перед следующим обновлением
        await asyncio.sleep(interval_seconds)
