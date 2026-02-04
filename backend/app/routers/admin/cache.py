"""
Admin endpoints для управления и мониторинга Redis cache.

Endpoints:
- GET /admin/cache/stats - Статистика кэша
- DELETE /admin/cache/clear - Очистить весь кэш
- DELETE /admin/cache/clear/{pattern} - Очистить по паттерну
"""

from fastapi import APIRouter, HTTPException, Depends

from ...core.auth import get_current_admin_user
from ...core.cache import cache_manager, CACHE_KEY_PATTERNS, CACHE_TTL
from ...models.user import User
from ...schemas.responses import (
    CacheStatsResponse,
    CacheClearResponse,
    CacheWarmResponse,
)

router = APIRouter(prefix="/cache", tags=["admin", "cache"])


@router.get("/stats", response_model=CacheStatsResponse)
async def get_cache_stats(
    current_user: User = Depends(get_current_admin_user),
) -> CacheStatsResponse:
    """
    Получает статистику Redis cache.

    Args:
        current_user: Текущий администратор

    Returns:
        Статистика cache: hit rate, keys count, memory usage
    """
    stats = await cache_manager.get_stats()

    return {
        "cache_stats": stats,
        "cache_patterns": CACHE_KEY_PATTERNS,
        "cache_ttl_config": CACHE_TTL,
    }


@router.delete("/clear", response_model=CacheClearResponse)
async def clear_all_cache(
    current_user: User = Depends(get_current_admin_user),
) -> CacheClearResponse:
    """
    Очищает весь Redis cache (ОПАСНО - использовать осторожно).

    Args:
        current_user: Текущий администратор

    Returns:
        Результат операции
    """
    if not cache_manager.is_available:
        raise HTTPException(status_code=503, detail="Redis cache is not available")

    success = await cache_manager.clear_all()

    if not success:
        raise HTTPException(status_code=500, detail="Failed to clear cache")

    return {
        "message": "Cache cleared successfully",
        "cleared_all": True,
        "admin": current_user.email,
    }


@router.delete("/clear/{pattern}", response_model=CacheClearResponse)
async def clear_cache_pattern(
    pattern: str,
    current_user: User = Depends(get_current_admin_user),
) -> CacheClearResponse:
    """
    Очищает cache по паттерну.

    Args:
        pattern: Redis key pattern (например: "book:*", "user:123:*")
        current_user: Текущий администратор

    Returns:
        Количество удаленных ключей

    Examples:
        DELETE /admin/cache/clear/book:* - Очистить все книги
        DELETE /admin/cache/clear/user:123:* - Очистить данные пользователя
    """
    if not cache_manager.is_available:
        raise HTTPException(status_code=503, detail="Redis cache is not available")

    deleted_count = await cache_manager.delete_pattern(pattern)

    return {
        "message": f"Cache pattern '{pattern}' cleared",
        "deleted_keys": deleted_count,
        "pattern": pattern,
        "admin": current_user.email,
    }


@router.post("/warm", response_model=CacheWarmResponse)
async def warm_cache(
    current_user: User = Depends(get_current_admin_user),
) -> CacheWarmResponse:
    """
    Прогревает cache критическими данными (опционально).

    Args:
        current_user: Текущий администратор

    Returns:
        Результат прогрева
    """
    if not cache_manager.is_available:
        raise HTTPException(status_code=503, detail="Redis cache is not available")

    # TODO: Implement cache warming logic if needed
    # Example: pre-cache popular books, user lists, etc.

    return {
        "message": "Cache warming not implemented yet",
        "status": "skipped",
    }
