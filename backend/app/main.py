"""
fancai - FastAPI Main Application

Главный файл FastAPI приложения для веб-приложения чтения книг
с автоматической генерацией изображений по описаниям.
"""

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn
from datetime import datetime, timezone
from typing import Dict, Any, Union
from prometheus_fastapi_instrumentator import Instrumentator

from .routers import (
    users,
    auth,
    images,
    chapters,
    reading_progress,
    reading_sessions_router,
    health_router,
    descriptions_router,
    push_router,
    sync_router,
)
from .routers.admin import admin_router
from .routers.books import books_router
from .routers.books.entities import router as entities_router
from .routers.websocket import router as websocket_router
from .core.config import settings
from .core.cache import cache_manager
from .core.database import AsyncSessionLocal, get_database_session
from .core.secrets import startup_secrets_check
from .core.logging import logger
from .core.hawk import init_hawk
from .core.celery_app import celery_app
from .services.settings_manager import settings_manager
from .middleware.security_headers import SecurityHeadersMiddleware
from .middleware.cache_control import CacheControlMiddleware
from .middleware.rate_limit import rate_limiter, rate_limit
from .monitoring.middleware import (
    ReadingSessionsMetricsMiddleware,
    update_gauges_periodically,
)
from .core.exceptions import ProblemDetail, problem_detail_exception_handler

# Версия приложения
VERSION = "0.1.0"


# ============================================================================
# Lifespan Context Manager (replaces deprecated on_event decorators)
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.

    Startup logic runs before yield, shutdown logic runs after yield.
    This replaces the deprecated @app.on_event("startup") and @app.on_event("shutdown").
    """
    # ========================================================================
    # STARTUP
    # ========================================================================
    logger.info("Starting fancai", version=VERSION)

    # DEBUG: Log CORS configuration
    logger.debug(
        "CORS configuration",
        cors_origins=settings.CORS_ORIGINS,
        cors_origins_list=settings.cors_origins_list,
    )

    # SECURITY: Validate secrets before starting
    try:
        is_production = not settings.DEBUG
        startup_secrets_check(is_production=is_production)
    except SystemExit:
        # Re-raise to stop application if secrets validation failed
        raise
    except Exception as e:
        logger.warning("Secrets validation error", error=str(e))
        # Continue with warning (non-critical error)

    # Мониторинг ошибок: Hawk Tracker
    try:
        init_hawk(app)
    except Exception as e:
        logger.warning("Failed to initialize Hawk Tracker", error=str(e))

    # Initialize Rate Limiter
    try:
        await rate_limiter.connect()
        if rate_limiter.enabled:
            logger.info("Rate limiter initialized and connected to Redis")
        else:
            logger.warning("Rate limiter disabled (Redis unavailable)")
    except Exception as e:
        logger.warning("Failed to initialize rate limiter", error=str(e))

    # Инициализация Redis cache
    try:
        await cache_manager.initialize()
        if cache_manager.is_available:
            logger.info("Redis cache initialized and ready")
        else:
            logger.warning("Redis cache unavailable - running without cache")
    except Exception as e:
        logger.warning("Failed to initialize Redis cache", error=str(e))

    # Инициализация настроек по умолчанию
    try:
        await settings_manager.initialize_default_settings()
        logger.info("Default settings initialized")
    except Exception as e:
        logger.warning("Failed to initialize settings", error=str(e))

    # Prometheus: запустить фоновую задачу обновления reading sessions gauges
    try:
        asyncio.create_task(
            update_gauges_periodically(get_database_session, interval_seconds=30)
        )
        logger.info("Reading sessions metrics background task started")
    except Exception as e:
        logger.warning("Failed to start metrics background task", error=str(e))

    # ========================================================================
    # APPLICATION RUNS HERE
    # ========================================================================
    yield

    # ========================================================================
    # SHUTDOWN
    # ========================================================================
    logger.info("Shutting down fancai")

    # Закрываем Rate Limiter
    try:
        await rate_limiter.close()
        logger.info("Rate limiter closed")
    except Exception as e:
        logger.warning("Error closing rate limiter", error=str(e))

    # Закрываем Redis connection pool
    try:
        await cache_manager.close()
        logger.info("Redis cache closed")
    except Exception as e:
        logger.warning("Error closing Redis cache", error=str(e))


# Инициализация FastAPI приложения
app = FastAPI(
    title="fancai API",
    description="API для чтения книг с ИИ-генерацией изображений",
    version=VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    # Отключаем автоматический редирект с trailing slash
    # Это предотвращает 307 редиректы которые могут нарушить HTTPS
    redirect_slashes=False,
    lifespan=lifespan,
)

# ============================================================================
# Middleware Configuration
# ============================================================================

# Middleware добавляются в обратном порядке выполнения!
# Последний добавленный = первый выполняется

# Prometheus FastAPI Instrumentator.
# Добавляется здесь, а не в lifespan: instrument() внутри вызывает
# app.add_middleware, а Starlette >= 1.0 запрещает добавлять middleware
# после старта приложения (RuntimeError: Cannot add middleware after an
# application has started). Вызов первым в цепочке => выполняется последним,
# то есть CORS и остальные middleware остаются снаружи, как и раньше.
# ТОЛЬКО instrument() — expose() НЕ вызываем, /metrics endpoint уже есть в health.py
Instrumentator().instrument(app)

# 0. Reading Sessions Metrics Middleware (добавляется самым первым, выполняется последним в цепочке)
# Собирает API latency для /reading-sessions/* endpoints автоматически
app.add_middleware(ReadingSessionsMetricsMiddleware)

# 1. GZip Compression Middleware (добавляется первым, выполняется последним)
# Сжимает ответы > 1KB для снижения bandwidth и latency
app.add_middleware(
    GZipMiddleware,
    minimum_size=1000,  # Сжимать только ответы > 1KB
    compresslevel=6,  # Баланс скорость/размер (1=fastest, 9=best compression)
)

# 2. Cache-Control Middleware (добавляется вторым, выполняется третьим)
# Управляет HTTP кэшированием для optimal performance + security
# - User-specific endpoints: private, no-cache (предотвращает кэширование личных данных)
# - Static files: public, max-age=31536000, immutable (агрессивное кэширование)
# - Admin/Auth: no-store (максимальная безопасность)
app.add_middleware(CacheControlMiddleware)

# 2.5. CSRF Protection Middleware (Double Submit Cookie)
# DISABLED: Frontend does not implement CSRF token handling.
# JWT Bearer auth in Authorization header is not vulnerable to CSRF.
# Re-enable only after frontend integration (X-CSRF-Token header support).
# from .core.csrf import CSRFProtectMiddleware
# app.add_middleware(CSRFProtectMiddleware)

# 3. Security Headers Middleware (добавляется третьим, выполняется предпоследним)
# Защита от XSS, clickjacking, MIME sniffing, etc.
app.add_middleware(SecurityHeadersMiddleware)

# 4. CORS Middleware (добавляется последним, выполняется ПЕРВЫМ)
# КРИТИЧЕСКИ ВАЖНО: должен быть последним чтобы обрабатывать preflight запросы до всех остальных middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    # SEC-004: Restricted headers (was "*", 27 Dec 2025)
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "Cache-Control",
    ],
    expose_headers=[
        "Content-Disposition",
        "X-Total-Count",
        "X-Page-Count",
        "ETag",
        "Last-Modified",
        "Cache-Control",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# ============================================================================
# Exception Handlers - CORS headers for error responses
# ============================================================================


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Обработчик HTTP exceptions с CORS headers.

    Гарантирует что CORS headers присутствуют даже в error responses.

    `exc.headers` обязан доезжать до клиента: на нём висят `WWW-Authenticate`
    для 401 (RFC 7235 требует его в ответе, а браузер без него не покажет
    Basic-диалог для `/health/metrics`), `Retry-After` и `X-RateLimit-*`
    для 429 из декоратора `rate_limit` и `X-RateLimit-*` для 402 при
    исчерпанной квоте генерации. Стандартный обработчик Starlette их
    передаёт, этот — терял.
    """
    origin = request.headers.get("origin")

    response = JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )

    # Добавляем CORS headers если origin разрешен
    if origin and origin in settings.cors_origins_list:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = (
            "Content-Disposition, X-Total-Count, X-Page-Count, ETag, Last-Modified, Cache-Control"
        )

    return response


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Обработчик всех необработанных exceptions с CORS headers.

    Предотвращает CORS ошибки при 500 Internal Server Error.
    """
    origin = request.headers.get("origin")

    response = JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

    # Добавляем CORS headers если origin разрешен
    if origin and origin in settings.cors_origins_list:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = (
            "Content-Disposition, X-Total-Count, X-Page-Count, ETag, Last-Modified, Cache-Control"
        )

    return response


# ProblemDetail — подкласс HTTPException, регистрация корректна в рантайме;
# Starlette типизирует handler как принимающий голый Exception.
app.add_exception_handler(ProblemDetail, problem_detail_exception_handler)  # type: ignore[arg-type]


# Подключение роутеров
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(images.router, prefix="/api/v1", tags=["images"])
app.include_router(admin_router, prefix="/api/v1")

# Books routers (refactored into modular structure)
app.include_router(books_router, prefix="/api/v1")
app.include_router(chapters.router, prefix="/api/v1/books", tags=["chapters"])


app.include_router(entities_router, prefix="/api/v1/books", tags=["entities"])
app.include_router(descriptions_router, prefix="/api/v1/books", tags=["descriptions"])
app.include_router(
    reading_progress.router, prefix="/api/v1/books", tags=["reading_progress"]
)

# Reading Sessions router
app.include_router(reading_sessions_router, prefix="/api/v1", tags=["reading-sessions"])

# Health & Monitoring router
app.include_router(health_router, prefix="/api/v1", tags=["health"])

# Push Notifications router (January 2026)
app.include_router(push_router, prefix="/api/v1", tags=["push"])

# Sync router for PWA offline queue batch operations (January 2026)
app.include_router(sync_router, prefix="/api/v1", tags=["sync"])

# WebSocket router for real-time progress updates (Phase 5, January 2026)


app.include_router(websocket_router, tags=["websocket"])


@app.get("/")
async def root() -> Dict[str, Any]:
    """
    Базовый endpoint для проверки работоспособности API.

    Returns:
        Dict с информацией о сервисе
    """
    response: Dict[str, Any] = {
        "message": "fancai API",
        "version": VERSION,
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if settings.DEBUG:
        response["docs"] = "/docs"
    return response


# response_model=None: возвращаемый тип — объединение dict и JSONResponse
# (503 при отказе критичных зависимостей), и FastAPI не умеет вывести из него
# pydantic-модель. Схему этот эндпоинт и так не публикует.
@app.get("/health", response_model=None)
@rate_limit(
    max_requests=60, window_seconds=60
)  # Docker healthcheck вызывает каждые 30 сек
async def health_check(request: Request) -> Union[Dict[str, Any], JSONResponse]:
    """
    Health check endpoint для мониторинга.

    Выполняет реальные проверки подключения к PostgreSQL, Redis и Celery.
    Возвращает статус 200 если API работает, 503 если все критические сервисы недоступны.

    Returns:
        Dict со статусом здоровья сервиса
    """
    from sqlalchemy import text

    checks: Dict[str, str] = {"api": "ok"}
    all_critical_down = False

    # Проверка PostgreSQL
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        logger.warning("Health check: database unavailable", error=str(e))
        checks["database"] = "error"

    # Проверка Redis
    checks["redis"] = "ok" if cache_manager.is_available else "unavailable"

    # Проверка Celery (с таймаутом 2 секунды)
    try:
        inspect = celery_app.control.inspect(timeout=2)
        ping_result = inspect.ping()
        checks["celery"] = "ok" if ping_result else "unavailable"
    except Exception as e:
        logger.debug("Health check: celery unavailable", error=str(e))
        checks["celery"] = "unavailable"

    # Определяем общий статус
    critical_checks = ["database"]
    all_critical_down = all(checks.get(c) != "ok" for c in critical_checks)
    any_degraded = any(v != "ok" for v in checks.values())

    if all_critical_down:
        status = "unhealthy"
    elif any_degraded:
        status = "degraded"
    else:
        status = "healthy"

    response_data = {
        "status": status,
        "version": VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }

    if all_critical_down:
        return JSONResponse(status_code=503, content=response_data)

    return response_data


@app.get("/api/v1/info")
async def api_info() -> Dict[str, Any]:
    """
    Информация о API и доступных endpoints.

    Returns:
        Dict с информацией об API
    """
    return {
        "api_version": "v1",
        "app_version": VERSION,
        "features": [
            "book_upload",
            "epub_parsing",
            "fb2_parsing",
            "llm_description_extraction",
            "ai_image_generation",
            "user_authentication",
            "subscription_management",
        ],
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "books": "/api/v1/books",
            "users": "/api/v1/users",
            "auth": "/api/v1/auth",
            "images": "/api/v1/images",
        },
    }


# Обработчик ошибок
@app.exception_handler(404)
async def not_found_handler(request, exc):
    """Обработчик 404 ошибок."""
    return JSONResponse(
        status_code=404,
        content={
            "error": "Not Found",
            "message": "Requested resource not found",
            "path": str(request.url.path),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.exception_handler(500)
async def internal_error_handler(request, exc):
    """Обработчик внутренних ошибок сервера."""
    logger.opt(exception=True).error(
        f"Internal server error: {exc}",
        path=str(request.url.path),
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred. Please try again later.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


if __name__ == "__main__":
    # Запуск сервера для локальной разработки
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",  # nosec B104
    )
