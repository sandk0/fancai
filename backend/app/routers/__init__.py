"""Routers package для API endpoints fancai."""

from .books import books_router
from .chapters import router as chapters_router
from .descriptions import router as descriptions_router
from .reading_progress import router as reading_progress_router
from .users import router as users_router
from .auth import router as auth_router
from .admin import router as admin_router
from .images import router as images_router
from .reading_sessions import router as reading_sessions_router
from .health import router as health_router
from .push import router as push_router
from .sync import router as sync_router
from .websocket import router as websocket_router  # Phase 5

__all__ = [
    "books_router",
    "chapters_router",
    "descriptions_router",
    "reading_progress_router",
    "users_router",
    "auth_router",
    "admin_router",
    "images_router",
    "reading_sessions_router",
    "health_router",
    "push_router",
    "sync_router",
    "websocket_router",  # Phase 5
]
