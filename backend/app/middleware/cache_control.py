"""
Cache-Control Headers Middleware для fancai.

Управляет HTTP кэшированием для различных типов endpoints:
- User-specific endpoints: private, no-cache (предотвращает кэширование личных данных)
- Static/public endpoints: public, max-age (оптимизирует производительность)
- Admin endpoints: no-store (максимальная безопасность)

Работает совместно с frontend TanStack Query для оптимальной cache invalidation стратегии.
"""

import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


# ============================================================================
# Cache Control Policy Configuration
# ============================================================================

# User-specific endpoints (PRIVATE data - не должны кэшироваться браузером)
# Эти endpoints возвращают user-specific данные и должны всегда проверяться с сервером
USER_SPECIFIC_PATHS = [
    "/api/v1/books",  # Список книг пользователя
    "/api/v1/chapters",  # Главы книг (user-specific через book ownership)
    "/api/v1/descriptions",  # Описания из книг (user-specific)
    "/api/v1/images",  # Сгенерированные изображения (user-specific)
    "/api/v1/reading-sessions",  # Сессии чтения (user-specific)
    "/api/v1/users/me",  # Профиль пользователя
    "/api/v1/users/stats",  # Статистика пользователя
    "/api/v1/auth/me",  # Текущий пользователь
]

# Admin endpoints (NO caching, NO storage - максимальная безопасность)
ADMIN_PATHS = [
    "/api/v1/admin/",  # Все admin endpoints
]

# Authentication endpoints (NO caching - security critical)
AUTH_PATHS = [
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
]

# Static/public endpoints (PUBLIC data - можно кэшировать)
# Эти endpoints возвращают публичные данные или статические ресурсы
PUBLIC_PATHS = [
    "/health",  # Health check - можно кэшировать на короткий период
    "/api/v1/info",  # API info - редко меняется
    "/docs",  # OpenAPI docs - статический контент
    "/redoc",  # ReDoc docs - статический контент
    "/openapi.json",  # OpenAPI schema - статический контент
]

# File serving endpoints (PUBLIC files - агрессивное кэширование)
# Статические файлы по URL не меняются (immutable content addressing)
FILE_SERVING_PATHS = [
    "/api/v1/images/file/",  # Сгенерированные изображения (immutable by filename)
]


# ============================================================================
# Cache-Control Header Strategies
# ============================================================================


def get_cache_control_header(path: str, method: str = "GET") -> str:
    """
    Определяет правильный Cache-Control header для endpoint.

    Args:
        path: URL path запроса
        method: HTTP method (GET, POST, etc.)

    Returns:
        Cache-Control header value

    Стратегия:
    1. Admin endpoints: no-store (никакого кэширования)
    2. Auth endpoints: no-store (security critical)
    3. User-specific endpoints: private, no-cache (требует revalidation)
    4. File serving: public, max-age=31536000, immutable (годовое кэширование)
    5. Public endpoints: public, max-age=3600 (1 час кэширование)
    6. Default: no-cache (безопасная стратегия)

    Cache-Control директивы:
    - no-store: Не сохранять ни в каком кэше (browser, CDN, proxy)
    - no-cache: Можно сохранить, но ВСЕГДА revalidate с сервером
    - private: Только browser cache, НЕ shared caches (CDN, proxy)
    - public: Можно кэшировать в shared caches
    - max-age=N: Время жизни в секундах
    - must-revalidate: После истечения max-age ОБЯЗАТЕЛЬНО revalidate
    - immutable: Контент никогда не изменится (для static assets)
    """
    # POST/PUT/DELETE никогда не кэшируются
    if method != "GET":
        return "no-store, no-cache, must-revalidate"

    # 1. Admin endpoints - NO caching (security)
    if any(admin_path in path for admin_path in ADMIN_PATHS):
        return "no-store, no-cache, must-revalidate, private"

    # 2. Authentication endpoints - NO caching (security)
    if any(auth_path in path for auth_path in AUTH_PATHS):
        return "no-store, no-cache, must-revalidate, private"

    # 3. File serving - Aggressive caching (immutable content)
    # Файлы имеют уникальные имена, поэтому можно кэшировать навсегда
    if any(file_path in path for file_path in FILE_SERVING_PATHS):
        return "public, max-age=31536000, immutable"

    # 3.5. Book covers - Long-term caching with revalidation
    # Обложки книг редко меняются, кэшируем на 30 дней
    if "/cover" in path:
        return "private, max-age=2592000, must-revalidate"

    # 4. User-specific endpoints - Private, revalidate
    # Данные персональные, но можно кэшировать в browser с обязательной проверкой
    if any(user_path in path for user_path in USER_SPECIFIC_PATHS):
        return "private, no-cache, must-revalidate"

    # 5. Public endpoints - Short-term caching
    # Публичные данные, можно кэшировать в shared caches на 1 час
    if any(public_path in path for public_path in PUBLIC_PATHS):
        return "public, max-age=3600"

    # 6. Default - No caching (safe default)
    # Для неизвестных endpoints применяем консервативную стратегию
    return "no-cache, must-revalidate"


# ============================================================================
# Cache Control Middleware
# ============================================================================


class CacheControlMiddleware(BaseHTTPMiddleware):
    """
    Middleware для управления Cache-Control headers в HTTP responses.

    Автоматически определяет правильную cache policy для каждого endpoint
    и добавляет соответствующие headers для оптимального кэширования.

    Работает совместно с:
    - Frontend TanStack Query (client-side caching)
    - Browser HTTP cache (disk/memory cache)
    - CDN/Proxy caches (shared caches)

    Usage:
        app.add_middleware(CacheControlMiddleware)

    Benefits:
    - Предотвращает кэширование приватных данных
    - Оптимизирует производительность через агрессивное кэширование static files
    - Обеспечивает security для auth/admin endpoints
    - Координирует с TanStack Query для optimal UX
    """

    def __init__(
        self,
        app,
        enable_cache_control: bool = True,
        default_cache_control: str = "no-cache, must-revalidate",
    ):
        """
        Инициализация cache control middleware.

        Args:
            app: FastAPI application instance
            enable_cache_control: Включить Cache-Control headers (default: True)
            default_cache_control: Default cache policy для unknown endpoints
        """
        super().__init__(app)
        self.enable_cache_control = enable_cache_control
        self.default_cache_control = default_cache_control

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        Обрабатывает request и добавляет Cache-Control headers к response.

        Args:
            request: Incoming HTTP request
            call_next: Next middleware в цепочке

        Returns:
            Response с Cache-Control headers
        """
        # Обработка request
        try:
            response = await call_next(request)
        except Exception as e:
            logger.warning(f"Error in cache control middleware: {type(e).__name__}: {e}")
            raise

        # Пропускаем middleware если отключен
        if not self.enable_cache_control:
            return response

        # Пропускаем если Cache-Control уже установлен вручную
        if "Cache-Control" in response.headers:
            logger.debug(
                f"Cache-Control already set for {request.url.path}: {response.headers['Cache-Control']}"
            )
            return response

        # Определяем правильный Cache-Control header
        cache_control = get_cache_control_header(
            path=request.url.path, method=request.method
        )

        # Устанавливаем Cache-Control header
        response.headers["Cache-Control"] = cache_control

        # Для no-store/no-cache также добавляем Pragma (legacy support)
        if "no-store" in cache_control or "no-cache" in cache_control:
            response.headers["Pragma"] = "no-cache"
            # Добавляем Expires для HTTP/1.0 clients
            response.headers["Expires"] = "0"

        # Логируем для debugging (только в development)
        logger.debug(
            f"Cache-Control set for {request.method} {request.url.path}: {cache_control}"
        )

        return response


# ============================================================================
# Utility Functions
# ============================================================================


def add_cache_control_header(
    response: Response, cache_control: str
) -> Response:
    """
    Utility function для ручного добавления Cache-Control header к response.

    Используется в endpoints где нужна кастомная cache policy.

    Args:
        response: FastAPI Response object
        cache_control: Cache-Control directive string

    Returns:
        Response с Cache-Control header

    Example:
        @router.get("/custom")
        async def custom_endpoint():
            response = JSONResponse(content={"data": "value"})
            return add_cache_control_header(response, "public, max-age=7200")
    """
    response.headers["Cache-Control"] = cache_control
    return response


def validate_cache_control(path: str, headers: dict) -> dict:
    """
    Валидирует корректность Cache-Control headers для endpoint.

    Используется для тестирования и мониторинга cache configuration.

    Args:
        path: URL path endpoint
        headers: Dict с response headers

    Returns:
        Dict с результатами валидации:
        {
            "valid": bool,
            "expected": str,
            "actual": str,
            "warnings": List[str]
        }

    Example:
        result = validate_cache_control("/api/v1/books", response.headers)
        assert result["valid"], result["warnings"]
    """
    expected = get_cache_control_header(path)
    actual = headers.get("Cache-Control", "")

    warnings = []

    # Check if Cache-Control is set
    if not actual:
        warnings.append(f"Cache-Control header not set for {path}")
        return {
            "valid": False,
            "expected": expected,
            "actual": None,
            "warnings": warnings,
        }

    # Check if matches expected policy
    if actual != expected:
        warnings.append(
            f"Cache-Control mismatch for {path}: expected '{expected}', got '{actual}'"
        )

    # Check for dangerous configurations
    if "private" in actual and "public" in actual:
        warnings.append("Conflicting directives: private and public")

    if "no-store" in actual and "max-age" in actual:
        warnings.append("Conflicting directives: no-store with max-age")

    # User-specific endpoints should NEVER be public
    if any(user_path in path for user_path in USER_SPECIFIC_PATHS):
        if "public" in actual:
            warnings.append(f"User-specific endpoint {path} should not be public")

    return {
        "valid": len(warnings) == 0,
        "expected": expected,
        "actual": actual,
        "warnings": warnings,
    }


# ============================================================================
# Testing Helpers
# ============================================================================


def get_all_cache_policies() -> dict:
    """
    Возвращает все cache policies для тестирования.

    Returns:
        Dict с path patterns и их cache policies

    Example:
        policies = get_all_cache_policies()
        for path, policy in policies.items():
            print(f"{path}: {policy}")
    """
    test_paths = {
        # User-specific
        "/api/v1/books": "private, no-cache, must-revalidate",
        "/api/v1/chapters/123": "private, no-cache, must-revalidate",
        "/api/v1/images/generation/status": "private, no-cache, must-revalidate",
        "/api/v1/users/me": "private, no-cache, must-revalidate",
        # Admin
        "/api/v1/admin/stats": "no-store, no-cache, must-revalidate, private",
        "/api/v1/admin/users": "no-store, no-cache, must-revalidate, private",
        # Auth
        "/api/v1/auth/login": "no-store, no-cache, must-revalidate, private",
        "/api/v1/auth/register": "no-store, no-cache, must-revalidate, private",
        # File serving
        "/api/v1/images/file/abc123.png": "public, max-age=31536000, immutable",
        # Public
        "/health": "public, max-age=3600",
        "/api/v1/info": "public, max-age=3600",
        "/docs": "public, max-age=3600",
        # Default
        "/api/v1/unknown": "no-cache, must-revalidate",
    }

    return {
        path: get_cache_control_header(path) for path in test_paths.keys()
    }
