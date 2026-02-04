"""
API роуты для управления сессиями чтения (Reading Sessions) в fancai.

Endpoints:
- POST /reading-sessions/start - Начать новую сессию чтения
- PUT /reading-sessions/{session_id}/update - Обновить текущую позицию в сессии
- PUT /reading-sessions/{session_id}/end - Завершить сессию чтения
- GET /reading-sessions/active - Получить активную сессию пользователя
- GET /reading-sessions/history - История сессий с пагинацией
"""

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Query,
    BackgroundTasks,
    Request,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, case
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime, timezone

from loguru import logger

from ..core.database import get_database_session
from ..core.auth import get_current_active_user
from ..models.user import User
from ..models.reading_session import ReadingSession
from ..models.book import Book
from ..core.exceptions import BookNotFoundException
from ..services.reading_session_cache import reading_session_cache
from ..services.reading_session_service import reading_session_service

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class StartSessionRequest(BaseModel):
    """
    Модель запроса для старта сессии чтения.

    Attributes:
        book_id: UUID книги для чтения
        start_position: Позиция начала сессии (0-100%)
        device_type: Тип устройства (mobile, tablet, desktop)
    """

    book_id: str = Field(..., description="UUID книги")
    start_position: int = Field(
        default=0, ge=0, le=100, description="Начальная позиция в книге (0-100%)"
    )
    device_type: Optional[str] = Field(
        None, max_length=50, description="Тип устройства"
    )
    force: bool = Field(
        default=False,
        description="Принудительно завершить существующую активную сессию",
    )

    @validator("device_type")
    def validate_device_type(cls, v):
        """Валидация типа устройства."""
        if v is not None:
            allowed_types = ["mobile", "tablet", "desktop"]
            if v not in allowed_types:
                raise ValueError(
                    f"device_type must be one of: {', '.join(allowed_types)}"
                )
        return v


class UpdateSessionRequest(BaseModel):
    """
    Модель запроса для обновления сессии чтения.

    Attributes:
        current_position: Текущая позиция чтения (0-100%)
    """

    current_position: int = Field(
        ..., ge=0, le=100, description="Текущая позиция в книге (0-100%)"
    )


class EndSessionRequest(BaseModel):
    """
    Модель запроса для завершения сессии чтения.

    Attributes:
        end_position: Конечная позиция в книге (0-100%)
    """

    end_position: int = Field(
        ..., ge=0, le=100, description="Конечная позиция в книге (0-100%)"
    )


class BatchUpdateItem(BaseModel):
    """
    Модель для одного элемента batch обновления.

    Attributes:
        session_id: UUID сессии для обновления
        current_position: Новая позиция (0-100%)
    """

    session_id: str = Field(..., description="UUID сессии")
    current_position: int = Field(
        ..., ge=0, le=100, description="Новая позиция (0-100%)"
    )


class BatchUpdateRequest(BaseModel):
    """
    Модель запроса для batch обновления множественных сессий.

    Attributes:
        updates: Список обновлений для применения
    """

    updates: List[BatchUpdateItem] = Field(
        ..., min_length=1, max_length=50, description="Список обновлений (max 50)"
    )


class BatchUpdateResponse(BaseModel):
    """
    Модель ответа для batch обновления.

    Attributes:
        success_count: Количество успешно обновленных сессий
        failed_count: Количество неудачных обновлений
        errors: Список ошибок для неудачных обновлений
    """

    success_count: int
    failed_count: int
    errors: List[str]


class ReadingSessionResponse(BaseModel):
    """
    Модель ответа с информацией о сессии чтения.

    Attributes:
        id: UUID сессии
        user_id: UUID пользователя
        book_id: UUID книги
        started_at: Время начала сессии
        ended_at: Время окончания сессии (nullable для активных)
        duration_minutes: Длительность сессии в минутах
        start_position: Позиция начала сессии
        end_position: Позиция окончания сессии
        pages_read: Количество прочитанных страниц
        device_type: Тип устройства
        is_active: Флаг активности сессии
        progress_delta: Прогресс за сессию (вычисляемое поле)
    """

    id: str
    user_id: str
    book_id: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: int
    start_position: int
    end_position: int
    pages_read: int
    device_type: Optional[str]
    is_active: bool
    progress_delta: int

    class Config:
        from_attributes = True
        json_encoders = {datetime: lambda v: v.isoformat()}


class ReadingSessionListResponse(BaseModel):
    """
    Модель ответа со списком сессий чтения.

    Attributes:
        sessions: Список сессий чтения
        total: Общее количество сессий
        page: Номер текущей страницы (deprecated, use cursor)
        page_size: Размер страницы
        has_next: Есть ли следующая страница
        next_cursor: Cursor для следующей страницы (cursor-based pagination)
    """

    sessions: List[ReadingSessionResponse]
    total: int
    page: Optional[int] = None  # Deprecated для cursor-based pagination
    page_size: int
    has_next: bool
    next_cursor: Optional[str] = None  # NEW: cursor для следующей страницы


# ============================================================================
# Helper Functions
# ============================================================================


def _log_session_completion(
    user_id: UUID, session_id: UUID, duration_minutes: int, progress_delta: int
) -> None:
    """
    Background task для логирования завершения сессии.

    Args:
        user_id: UUID пользователя
        session_id: UUID завершенной сессии
        duration_minutes: Длительность сессии в минутах
        progress_delta: Прогресс за сессию (%)
    """
    import logging

    logger = logging.getLogger(__name__)

    logger.info(
        f"Session completed: user={user_id}, session={session_id}, "
        f"duration={duration_minutes}min, progress={progress_delta}%"
    )

    # Здесь можно добавить отправку в analytics service
    # Например: analytics.track_session_completion(...)


def session_to_response(session: ReadingSession) -> ReadingSessionResponse:
    """
    Преобразует модель ReadingSession в ответ API.

    Args:
        session: Модель ReadingSession

    Returns:
        ReadingSessionResponse с данными сессии
    """
    return ReadingSessionResponse(
        id=str(session.id),
        user_id=str(session.user_id),
        book_id=str(session.book_id),
        started_at=session.started_at,
        ended_at=session.ended_at,
        duration_minutes=session.duration_minutes,
        start_position=session.start_position,
        end_position=session.end_position,
        pages_read=session.pages_read,
        device_type=session.device_type,
        is_active=session.is_active,
        progress_delta=session.get_progress_delta(),
    )


# ============================================================================
# Endpoints
# ============================================================================


@router.post(
    "/reading-sessions/start",
    response_model=ReadingSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Начать новую сессию чтения",
    description="Создает новую активную сессию чтения. Автоматически завершает предыдущую активную сессию пользователя.",
    responses={
        201: {"description": "Сессия чтения успешно создана"},
        400: {"description": "Невалидные параметры запроса"},
        404: {"description": "Книга не найдена"},
        409: {"description": "Активная сессия уже существует (Split Brain)"},
    },
)
async def start_reading_session(
    request: StartSessionRequest,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """
    Начинает новую сессию чтения.

    Логика:
    1. Проверяем существование книги и доступ пользователя
    2. Завершаем предыдущую активную сессию (если есть)
    3. Создаем новую сессию с is_active=True

    Args:
        request: Параметры для старта сессии
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Созданная сессия чтения

    Raises:
        BookNotFoundException: Если книга не найдена
        HTTPException: При ошибке создания сессии
    """
    try:
        # Преобразуем строку в UUID
        book_uuid = UUID(request.book_id)

        # Проверяем существование книги и доступ пользователя
        book_query = select(Book).where(
            Book.id == book_uuid, Book.user_id == current_user.id
        )
        book_result = await db.execute(book_query)
        book = book_result.scalar_one_or_none()

        if not book:
            raise BookNotFoundException(book_uuid)

        # Завершаем предыдущую активную сессию (если есть)
        active_session_query = select(ReadingSession).where(
            ReadingSession.user_id == current_user.id,
            ReadingSession.is_active == True,  # noqa: E712
        )
        active_session_result = await db.execute(active_session_query)
        active_session = active_session_result.scalar_one_or_none()

        if active_session:
            if not request.force:
                # Возвращаем 409 Conflict с информацией о сессии
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": "Active session already exists",
                        "session_id": str(active_session.id),
                        "started_at": active_session.started_at.isoformat(),
                        "device_type": active_session.device_type,
                    },
                )

            # Если force=True, завершаем предыдущую сессию
            active_session.end_session(
                end_position=active_session.start_position,  # Assume no progress if force closed?
                ended_at=datetime.now(timezone.utc),
            )

        new_session = ReadingSession(
            user_id=current_user.id,
            book_id=book_uuid,
            start_position=request.start_position,
            end_position=request.start_position,
            device_type=request.device_type,
            is_active=True,
            started_at=datetime.now(timezone.utc),
        )

        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)

        return session_to_response(new_session)

    except HTTPException:
        # Re-raise HTTPExceptions (including BookNotFoundException) to let FastAPI handle them
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid book_id format: {str(e)}",
        )
    except Exception as e:
        logger.exception(f"Error starting reading session: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while starting the session",
        )


@router.put(
    "/reading-sessions/{session_id}/update",
    response_model=ReadingSessionResponse,
    summary="Обновить позицию в активной сессии",
    description="Обновляет текущую позицию чтения в активной сессии.",
    responses={
        200: {"description": "Позиция успешно обновлена"},
        400: {"description": "Сессия неактивна или невалидные параметры"},
        404: {"description": "Сессия не найдена"},
        403: {"description": "Нет доступа к сессии"},
    },
)
async def update_reading_session(
    session_id: UUID,
    request: UpdateSessionRequest,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """
    Обновляет позицию в активной сессии чтения.

    Args:
        session_id: UUID сессии
        request: Параметры обновления
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Обновленная сессия чтения

    Raises:
        HTTPException: Если сессия не найдена, неактивна или нет доступа
    """
    try:
        # Ищем сессию пользователя
        query = select(ReadingSession).where(
            ReadingSession.id == session_id, ReadingSession.user_id == current_user.id
        )
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            logger.warning(
                f"Reading session {session_id} not found for user {current_user.id} in update_reading_session"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Reading session {session_id} not found",
            )

        if not session.is_active:
            logger.info(f"Reading session {session_id} is inactive, cannot update")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update inactive session",
            )

        # Обновляем позицию и рассчитываем текущую длительность
        session.end_position = request.current_position
        session.duration_minutes = int(
            (datetime.now(timezone.utc) - session.started_at).total_seconds() / 60
        )

        await db.commit()
        await db.refresh(session)

        return session_to_response(session)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating reading session: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while updating the session",
        )


@router.post(
    "/reading-sessions/{session_id}/beacon",
    response_model=ReadingSessionResponse,
    summary="Обновить позицию через Beacon API (POST)",
    description="Аналог update, но принимает POST запросы для navigator.sendBeacon.",
    responses={
        200: {"description": "Позиция успешно обновлена"},
        400: {"description": "Сессия неактивна или невалидные параметры"},
        404: {"description": "Сессия не найдена"},
    },
)
async def update_reading_session_beacon(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """
    Endpoint для Beacon API (всегда POST).
    Парсит JSON из тела запроса и вызывает логику обновления.
    """
    try:
        # Beacon API отправляет JSON, но Content-Type может варьироваться.
        # Пытаемся получить JSON напрямую.
        try:
            body = await request.json()
        except Exception:
            # Fallback если content-type не application/json, но тело валидный json
            body_bytes = await request.body()
            import json

            body = json.loads(body_bytes)

        # Валидация через Pydantic
        update_data = UpdateSessionRequest(**body)

        # Переиспользуем логику обновления
        # Ищем сессию пользователя
        query = select(ReadingSession).where(
            ReadingSession.id == session_id, ReadingSession.user_id == current_user.id
        )
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            logger.warning(
                f"Reading session {session_id} not found for user {current_user.id} in beacon update"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Reading session {session_id} not found",
            )

        if not session.is_active:
            logger.info(
                f"Reading session {session_id} is inactive, cannot update via beacon"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update inactive session",
            )

        # Обновляем позицию и рассчитываем текущую длительность
        session.end_position = update_data.current_position
        session.duration_minutes = int(
            (datetime.now(timezone.utc) - session.started_at).total_seconds() / 60
        )

        await db.commit()
        await db.refresh(session)

        return session_to_response(session)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid data format: {str(e)}",
        )
    except Exception as e:
        logger.exception(f"Error updating reading session via beacon: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while updating the session",
        )


@router.put(
    "/reading-sessions/{session_id}/end",
    response_model=ReadingSessionResponse,
    summary="Завершить сессию чтения",
    description="""
    Завершает активную сессию чтения, вычисляя длительность и прогресс.

    Background tasks выполняются асинхронно:
    - Cache invalidation (Redis)
    - User statistics update
    - Reading streak calculation
    """,
    responses={
        200: {"description": "Сессия успешно завершена"},
        400: {"description": "Сессия уже завершена или невалидные параметры"},
        404: {"description": "Сессия не найдена"},
        403: {"description": "Нет доступа к сессии"},
    },
)
async def end_reading_session(
    session_id: UUID,
    request: EndSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """
    Завершает активную сессию чтения.

    Валидация:
    - end_position должна быть >= start_position
    - Автоматически вычисляется duration_minutes

    Args:
        session_id: UUID сессии
        request: Параметры завершения
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Завершенная сессия чтения

    Raises:
        HTTPException: Если сессия не найдена, уже завершена или нет доступа
    """
    try:
        # Ищем сессию пользователя
        query = select(ReadingSession).where(
            ReadingSession.id == session_id, ReadingSession.user_id == current_user.id
        )
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Reading session {session_id} not found",
            )

        if not session.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Session already ended"
            )

        # Завершаем сессию используя метод модели
        try:
            session.end_session(
                end_position=request.end_position, ended_at=datetime.now(timezone.utc)
            )
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        await db.commit()
        await db.refresh(session)

        # ============================================================================
        # Background Tasks (Non-blocking, executed after response)
        # ============================================================================

        # 1. Invalidate Redis cache для активной сессии
        background_tasks.add_task(
            reading_session_cache.invalidate_user_sessions, user_id=current_user.id
        )

        # 2. Log завершения сессии для analytics
        background_tasks.add_task(
            _log_session_completion,
            user_id=current_user.id,
            session_id=session_id,
            duration_minutes=session.duration_minutes,
            progress_delta=session.get_progress_delta(),
        )

        return session_to_response(session)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error ending reading session: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while ending the session",
        )


@router.post(
    "/reading-sessions/{session_id}/end-beacon",
    response_model=ReadingSessionResponse,
    summary="Завершить сессию через Beacon API (POST)",
    description="Аналог end, но принимает POST запросы для navigator.sendBeacon.",
    responses={
        200: {"description": "Сессия успешно завершена"},
        400: {"description": "Сессия уже завершена или невалидные параметры"},
        404: {"description": "Сессия не найдена"},
    },
)
async def end_reading_session_beacon(
    session_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """
    Endpoint для завершения сессии через Beacon API (всегда POST).
    """
    try:
        try:
            body = await request.json()
        except Exception:
            body_bytes = await request.body()
            import json

            body = json.loads(body_bytes)

        # Валидация
        end_data = EndSessionRequest(**body)

        # Переиспользуем логику завершения
        query = select(ReadingSession).where(
            ReadingSession.id == session_id, ReadingSession.user_id == current_user.id
        )
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Reading session {session_id} not found",
            )

        # Если сессия уже неактивна, просто возвращаем её (idempotency для beacon)
        if not session.is_active:
            return session_to_response(session)

        # Завершаем сессию
        session.end_session(
            end_position=end_data.end_position, ended_at=datetime.now(timezone.utc)
        )

        await db.commit()
        await db.refresh(session)

        # Background Tasks
        background_tasks.add_task(
            reading_session_cache.invalidate_user_sessions, user_id=current_user.id
        )
        background_tasks.add_task(
            _log_session_completion,
            user_id=current_user.id,
            session_id=session_id,
            duration_minutes=session.duration_minutes,
            progress_delta=session.get_progress_delta(),
        )

        return session_to_response(session)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid data format: {str(e)}",
        )
    except Exception as e:
        logger.exception(f"Error ending reading session via beacon: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while ending the session",
        )


@router.get(
    "/reading-sessions/active",
    response_model=Optional[ReadingSessionResponse],
    summary="Получить активную сессию",
    description="Возвращает текущую активную сессию чтения пользователя.",
    responses={
        200: {"description": "Активная сессия найдена или null если нет активных"},
    },
)
async def get_active_session(
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> Optional[ReadingSessionResponse]:
    """
    Получает текущую активную сессию чтения пользователя.

    Args:
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Активная сессия или None если нет активных сессий
    """
    try:
        query = select(ReadingSession).where(
            ReadingSession.user_id == current_user.id,
            ReadingSession.is_active == True,  # noqa: E712
        )
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            return None

        return session_to_response(session)

    except Exception as e:
        logger.exception(f"Error fetching active session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while fetching active session",
        )


@router.get(
    "/reading-sessions/history",
    response_model=ReadingSessionListResponse,
    summary="История сессий чтения",
    description="""
    Возвращает историю сессий чтения с cursor-based pagination.

    Cursor-based pagination преимущества:
    - Stable pagination (нет пропусков при добавлении новых сессий)
    - Better performance для больших offset (O(1) вместо O(n))
    - No page drift при concurrent inserts

    Legacy offset pagination still supported для обратной совместимости.
    """,
    responses={
        200: {"description": "История успешно получена"},
    },
)
async def get_reading_sessions_history(
    cursor: Optional[str] = Query(
        default=None, description="Cursor для пагинации (рекомендуется)"
    ),
    page: Optional[int] = Query(
        default=None, ge=1, description="Номер страницы (legacy, deprecated)"
    ),
    page_size: int = Query(default=20, ge=1, le=100, description="Количество сессий"),
    book_id: Optional[str] = Query(default=None, description="Фильтр по UUID книги"),
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionListResponse:
    """
    Получает историю сессий чтения с cursor-based или offset pagination.

    Приоритет cursor-based pagination, fallback на offset для legacy клиентов.

    Args:
        cursor: Cursor для следующей страницы (рекомендуется)
        page: Номер страницы для legacy offset pagination (deprecated)
        page_size: Максимум сессий для возврата
        book_id: Опциональный UUID книги для фильтрации
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Список сессий с метаданными пагинации и next_cursor

    Raises:
        HTTPException: При ошибке получения истории
    """
    try:
        # Преобразуем book_id в UUID если указан
        book_uuid = None
        if book_id:
            try:
                book_uuid = UUID(book_id)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid book_id format: {book_id}",
                )

        # Используем cursor-based pagination если cursor указан
        if cursor or page is None:
            # CURSOR-BASED PAGINATION (recommended)
            (
                sessions,
                next_cursor,
                total,
            ) = await reading_session_service.get_user_sessions_optimized(
                db=db,
                user_id=current_user.id,
                limit=page_size,
                cursor=cursor,
                book_id=book_uuid,
            )

            # Преобразуем в response модели
            session_responses = [session_to_response(session) for session in sessions]

            return ReadingSessionListResponse(
                sessions=session_responses,
                total=total,
                page=None,  # Not applicable для cursor pagination
                page_size=page_size,
                has_next=next_cursor is not None,
                next_cursor=next_cursor,
            )

        else:
            # LEGACY OFFSET PAGINATION (deprecated, для обратной совместимости)
            query = select(ReadingSession).where(
                ReadingSession.user_id == current_user.id
            )

            if book_uuid:
                query = query.where(ReadingSession.book_id == book_uuid)

            # Сортировка (новые сессии первыми)
            query = query.order_by(desc(ReadingSession.started_at))

            # Считаем общее количество
            count_query = select(ReadingSession.id).where(
                ReadingSession.user_id == current_user.id
            )
            if book_uuid:
                count_query = count_query.where(ReadingSession.book_id == book_uuid)

            count_result = await db.execute(count_query)
            total = len(count_result.all())

            # Пагинация
            offset = (page - 1) * page_size
            query = query.limit(page_size).offset(offset)

            # Выполняем запрос
            result = await db.execute(query)
            sessions = result.scalars().all()

            # Преобразуем в response модели
            session_responses = [session_to_response(session) for session in sessions]

            # Проверяем наличие следующей страницы
            has_next = (offset + page_size) < total

            return ReadingSessionListResponse(
                sessions=session_responses,
                total=total,
                page=page,
                page_size=page_size,
                has_next=has_next,
                next_cursor=None,  # Not used в offset pagination
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching reading sessions history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while fetching session history",
        )


@router.post(
    "/reading-sessions/batch-update",
    response_model=BatchUpdateResponse,
    summary="Batch обновление позиций в сессиях",
    description="""
    Обновляет позиции в множественных активных сессиях одним SQL запросом.

    Использует SQL CASE WHEN для одного UPDATE запроса:
    UPDATE reading_sessions
    SET end_position = CASE
        WHEN id = 'uuid1' THEN 25
        WHEN id = 'uuid2' THEN 50
    END
    WHERE id IN ('uuid1', 'uuid2')

    Performance: ~50x faster чем отдельные UPDATE для каждой сессии.
    """,
    responses={
        200: {"description": "Batch обновление выполнено"},
        400: {"description": "Невалидные параметры или превышен лимит"},
    },
)
async def batch_update_sessions(
    request: BatchUpdateRequest,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> BatchUpdateResponse:
    """
    Batch обновление позиций в множественных сессиях.

    Оптимизация для клиентов, которые отправляют частые обновления
    (например, каждую секунду при прокрутке). Batch update минимизирует
    количество DB round-trips.

    Args:
        request: Список обновлений (max 50 за раз)
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        BatchUpdateResponse с статистикой обновлений

    Raises:
        HTTPException: При ошибке batch update
    """
    if len(request.updates) > 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 50 updates per batch",
        )

    success_count = 0
    failed_count = 0
    errors = []

    try:
        # Преобразуем session_id в UUID
        update_map = {}  # {UUID: new_position}
        session_ids = []

        for update_item in request.updates:
            try:
                session_uuid = UUID(update_item.session_id)
                update_map[session_uuid] = update_item.current_position
                session_ids.append(session_uuid)
            except ValueError:
                failed_count += 1
                errors.append(f"Invalid UUID format: {update_item.session_id}")
                continue

        if not session_ids:
            return BatchUpdateResponse(
                success_count=0, failed_count=len(request.updates), errors=errors
            )

        # Проверяем, что все сессии принадлежат текущему пользователю
        verification_query = select(ReadingSession).where(
            ReadingSession.id.in_(session_ids),
            ReadingSession.user_id == current_user.id,
            ReadingSession.is_active == True,  # noqa: E712
        )
        verification_result = await db.execute(verification_query)
        verified_sessions = verification_result.scalars().all()

        verified_ids = {session.id for session in verified_sessions}

        # Проверяем какие сессии не прошли верификацию
        for session_id in session_ids:
            if session_id not in verified_ids:
                failed_count += 1
                errors.append(f"Session {session_id} not found or not active")

        if not verified_ids:
            return BatchUpdateResponse(
                success_count=0, failed_count=len(request.updates), errors=errors
            )

        # Batch UPDATE используя CASE WHEN
        # Строим CASE выражение для каждой сессии
        now = datetime.now(timezone.utc)

        # Создаем словарь session_id -> started_at для расчета duration
        session_started_at = {
            session.id: session.started_at for session in verified_sessions
        }

        position_case_conditions = []
        duration_case_conditions = []
        for session_id in verified_ids:
            new_position = update_map[session_id]
            position_case_conditions.append(
                (ReadingSession.id == session_id, new_position)
            )

            # Рассчитываем duration_minutes для каждой сессии
            started_at = session_started_at[session_id]
            duration_minutes = int((now - started_at).total_seconds() / 60)
            duration_case_conditions.append(
                (ReadingSession.id == session_id, duration_minutes)
            )

        # SQL CASE WHEN statements
        position_update_case = case(
            *position_case_conditions, else_=ReadingSession.end_position
        )
        duration_update_case = case(
            *duration_case_conditions, else_=ReadingSession.duration_minutes
        )

        # Выполняем batch UPDATE
        from sqlalchemy import update

        stmt = (
            update(ReadingSession)
            .where(ReadingSession.id.in_(verified_ids))
            .values(
                end_position=position_update_case, duration_minutes=duration_update_case
            )
        )

        await db.execute(stmt)
        await db.commit()

        success_count = len(verified_ids)

        # Cache invalidation для обновленных сессий (опционально)
        # Можно добавить в background task если Redis кэш используется

        return BatchUpdateResponse(
            success_count=success_count, failed_count=failed_count, errors=errors
        )

    except Exception as e:
        logger.exception(f"Error in batch update: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred during batch update",
        )
