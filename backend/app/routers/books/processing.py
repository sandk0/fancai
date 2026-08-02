"""
Processing & status endpoints для работы с книгами.

Этот модуль содержит операции обработки книг и мониторинга статуса:
- Запуск парсинга описаний
- Получение статуса парсинга
- Управление очередью обработки
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from ...middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS

from ...core.database import get_database_session
from ...core.auth import get_current_active_user
from ...core.dependencies import get_user_book
from ...core.exceptions import ParsingStartException, ParsingStatusException
from ...core.cache import cache_manager
from ...models.user import User
from ...models.book import Book
from ...core.tasks import process_book_task
from ...schemas.responses import BookProcessingResponse, ParsingStatusResponse

router = APIRouter()


@router.post("/{book_id}/process", response_model=BookProcessingResponse)
@rate_limit(**RATE_LIMIT_PRESETS["ai_operation"])
async def process_book_descriptions(
    request: Request,
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> BookProcessingResponse:
    """
    Запускает обработку книги для извлечения описаний.

    Args:
        book: Книга (автоматически получена через dependency)
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Статус запуска обработки

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен
    """
    try:
        book_id = book.id

        # Импортируем менеджер парсинга
        from ...services.parsing_manager import parsing_manager

        # Проверяем текущий статус парсинга
        parsing_status = await parsing_manager.get_parsing_status(str(book_id))
        if parsing_status and parsing_status["status"] in ["queued", "processing"]:
            return BookProcessingResponse(
                book_id=book_id,
                status=parsing_status["status"],
                message=parsing_status.get("message", ""),
                progress=parsing_status.get("progress", 0),
                position=parsing_status.get("position"),
                descriptions_found=parsing_status.get("descriptions_found", 0),
            )

        # Проверяем, можно ли начать парсинг сейчас
        can_parse, message = await parsing_manager.can_start_parsing()

        # Получаем приоритет пользователя
        priority = await parsing_manager.get_user_priority(current_user, db)

        if can_parse:
            # Пытаемся получить блокировку и начать парсинг сразу
            if await parsing_manager.acquire_parsing_lock(
                str(book_id), str(current_user.id)
            ):
                try:
                    # Обновляем статус
                    await parsing_manager.update_parsing_status(
                        str(book_id),
                        status="processing",
                        progress=0,
                        message="Starting book parsing...",
                    )

                    # Prevent race condition: Mark as processing in DB immediately
                    book.is_processing = True
                    book.parsing_progress = 0
                    book.descriptions_extracted = False
                    await db.commit()

                    # Invalidate Redis books list cache so the next frontend poll
                    # gets fresh is_processing=True instead of stale cached data
                    try:
                        await cache_manager.delete_pattern(
                            f"user:{current_user.id}:books:*"
                        )
                    except Exception as cache_err:
                        logger.warning(
                            "Failed to invalidate book list cache after processing start",
                            error=str(cache_err),
                        )

                    # Запускаем задачу
                    process_book_task.delay(book_id)

                    return BookProcessingResponse(
                        book_id=book_id,
                        status="processing",
                        message="Book parsing started immediately",
                        priority=priority,
                    )

                except Exception:
                    logger.exception(
                        "Failed to dispatch Celery task for book %s" % book_id
                    )
                    # Освобождаем блокировку при ошибке
                    await parsing_manager.release_parsing_lock(str(book_id))
                    raise

        # Если парсинг сейчас невозможен, добавляем в очередь
        queue_info = await parsing_manager.add_to_parsing_queue(
            str(book_id), str(current_user.id), priority, db
        )

        return BookProcessingResponse(
            book_id=book_id,
            status="queued",
            message=f"Added to parsing queue. {message}",
            position=queue_info["position"],
            total_in_queue=queue_info["total_in_queue"],
            estimated_wait_time=queue_info["estimated_wait_time"],
            priority=priority,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise ParsingStartException(str(e))


@router.get("/{book_id}/parsing-status", response_model=ParsingStatusResponse)
async def get_parsing_status(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ParsingStatusResponse:
    """
    Получает статус парсинга книги.

    Args:
        book: Книга (автоматически получена через dependency)
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Статус парсинга и прогресс

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен
    """
    logger.debug("Parsing status request for book_id={}", book.id)
    try:
        book_id = book.id

        # Определяем статус парсинга на основе данных книги

        # Если идет обработка (независимо от того, распаршена книга или нет - например, идет генерация описаний)
        if book.is_processing:
            return ParsingStatusResponse(
                book_id=book_id,
                status="processing",
                progress=book.parsing_progress,
                message=f"Parsing in progress: {book.parsing_progress}%",
            )

        # Если не обрабатывается, но распаршена (начальный парсинг структуры)
        if book.is_parsed:
            # Если описания еще не извлечены, значит мы в состоянии "ожидания" или "готовности к старту"
            # Но не "completed" в контексте AI-обработки
            if not book.descriptions_extracted:
                return ParsingStatusResponse(
                    book_id=book_id,
                    status="not_started",
                    progress=0,
                    message="Content parsed, AI descriptions pending",
                )

            return ParsingStatusResponse(
                book_id=book_id,
                status="completed",
                progress=100,
                message="AI processing completed",
                descriptions_found=(
                    sum(ch.descriptions_found for ch in book.chapters)
                    if book.chapters
                    else 0
                ),
            )

        # Если есть частичный прогресс (на всякий случай)
        elif book.parsing_progress > 0:
            return ParsingStatusResponse(
                book_id=book_id,
                status="processing",
                progress=book.parsing_progress,
                message=f"Parsing in progress (stalled): {book.parsing_progress}%",
            )
        else:
            return ParsingStatusResponse(
                book_id=book_id,
                status="not_started",
                progress=0,
                message="Parsing not started",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise ParsingStatusException(str(e))
