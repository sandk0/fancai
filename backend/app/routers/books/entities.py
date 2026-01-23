from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_database_session
from app.core.auth import get_current_active_user
from app.core.dependencies import get_user_book
from app.models.user import User
from app.models.book import Book
from app.services.entity_service import EntityService, get_entity_service
from app.schemas.responses.entities import EntityNetworkResponse

router = APIRouter()

@router.get(
    "/{book_id}/entities/network", 
    response_model=EntityNetworkResponse,
    summary="Get book entity network (graph)"
)
async def get_book_entity_network_endpoint(
    book_id: UUID,
    # Security: Ensure user owns the book or is admin
    book: Book = Depends(get_user_book), 
    current_user: User = Depends(get_current_active_user),
    entity_service: EntityService = Depends(get_entity_service)
) -> EntityNetworkResponse:
    """
    Получает полный граф сущностей и связей для книги.
    
    Результат кэшируется на 1 час.
    Данные автоматически дедуплицируются (Soft Merge).
    Описания содержат привязку к главам (chapter_index) для спойлер-фильтра.
    """
    return await entity_service.get_book_entity_network(book_id)
