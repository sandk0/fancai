"""
Admin router - aggregates all admin sub-modules.
"""

from fastapi import APIRouter

from . import (
    stats,
    parsing,
    images,
    system,
    users,
    reading_sessions,
    cache,
    feature_flags,
    entities,
)

# Create main admin router
router = APIRouter(prefix="/admin", tags=["admin"])

# Include all sub-routers
router.include_router(stats.router)
router.include_router(parsing.router)
router.include_router(images.router)
router.include_router(system.router)
router.include_router(users.router)
router.include_router(reading_sessions.router)
router.include_router(cache.router)
router.include_router(feature_flags.router)
router.include_router(entities.router)

# Export both names for compatibility
admin_router = router

__all__ = ["router", "admin_router"]
