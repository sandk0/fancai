"""
fancai - FastAPI Main Application

Главный файл FastAPI приложения для веб-приложения чтения книг
с автоматической генерацией изображений по описаниям.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn
from datetime import datetime, timezone
from typing import Dict, Any

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
from .core.config import settings
from .core.cache import cache_manager
from .core.secrets import startup_secrets_check
from .core.logging import logger
from .services.settings_manager import settings_manager
from .middleware.security_headers import SecurityHeadersMiddleware
from .middleware.cache_control import CacheControlMiddleware
from .middleware.rate_limit import rate_limiter, rate_limit

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
    docs_url="/docs",
    redoc_url="/redoc",
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
    ],  # For file downloads, pagination & HTTP caching
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
    """
    origin = request.headers.get("origin")

    response = JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
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


# Подключение роутеров
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(images.router, prefix="/api/v1", tags=["images"])
app.include_router(admin_router, prefix="/api/v1")

# Books routers (refactored into modular structure)
app.include_router(books_router, prefix="/api/v1")
app.include_router(chapters.router, prefix="/api/v1/books", tags=["chapters"])
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


@app.get("/")
async def root() -> Dict[str, Any]:
    """
    Базовый endpoint для проверки работоспособности API.

    Returns:
        Dict с информацией о сервисе
    """
    return {
        "message": "fancai API",
        "version": VERSION,
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "docs": "/docs",
    }


@app.get("/health")
@rate_limit(max_requests=20, window_seconds=60)  # Public endpoint - stricter limit
async def health_check(request: Request) -> Dict[str, Any]:
    """
    Health check endpoint для мониторинга.

    Returns:
        Dict со статусом здоровья сервиса
    """
    # Check Redis status
    redis_status = "ok" if cache_manager.is_available else "unavailable"

    return {
        "status": "healthy",
        "version": VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": {
            "api": "ok",
            "database": "checking...",  # TODO: добавить проверку БД
            "redis": redis_status,
        },
    }


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
    logger.error(
        "Internal server error",
        error=str(exc),
        path=str(request.url.path),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": f"An internal server error occurred: {str(exc)}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


if __name__ == "__main__":
    # Запуск сервера для локальной разработки
    uvicorn.run(
        "main:app", host="0.0.0.0", port=8000, reload=True, log_level="info"  # nosec B104
    )
