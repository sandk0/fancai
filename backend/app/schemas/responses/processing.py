"""
Response schemas для Book Processing endpoints.

Содержит Pydantic модели для:
- Запуск обработки книги
- Статус парсинга книги
- Информация об очереди обработки
- Прогресс обработки

Version: Phase 1.3 Type Safety (2025-11-29)
"""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID


class BookProcessingResponse(BaseModel):
    """
    Response при запуске обработки книги.

    Используется в POST /api/v1/books/{book_id}/process.

    Возможные статусы:
    - queued: Книга добавлена в очередь обработки
    - processing: Парсинг запущен и выполняется
    - completed: Парсинг завершен успешно
    - failed: Произошла ошибка при парсинге

    Attributes:
        book_id: UUID обрабатываемой книги
        status: Статус обработки (queued | processing | completed | failed)
        message: Человекочитаемое сообщение о статусе
        progress: Прогресс обработки в процентах (0-100) (опционально)
        position: Позиция в очереди (опционально)
        descriptions_found: Найдено описаний (опционально)
        priority: Приоритет обработки (low | normal | high) (опционально)
        total_in_queue: Всего задач в очереди (опционально)
        estimated_wait_time: Ожидаемое время ожидания в секундах (опционально)
    """

    book_id: UUID = Field(description="UUID of the book being processed")
    status: str = Field(
        description="Processing status: queued | processing | completed | failed",
        pattern="^(queued|processing|completed|failed)$",
    )
    message: str = Field(description="Human-readable status message")
    progress: Optional[int] = Field(
        None, ge=0, le=100, description="Processing progress percentage (0-100)"
    )
    position: Optional[int] = Field(
        None, ge=0, description="Position in processing queue (0-indexed)"
    )
    descriptions_found: Optional[int] = Field(
        None, ge=0, description="Number of descriptions found so far"
    )
    priority: Optional[str] = Field(
        None,
        description="Processing priority: low | normal | high",
        pattern="^(low|normal|high)$",
    )
    total_in_queue: Optional[int] = Field(
        None, ge=0, description="Total tasks in processing queue"
    )
    estimated_wait_time: Optional[int] = Field(
        None, ge=0, description="Estimated wait time in seconds"
    )


class ParsingStatusResponse(BaseModel):
    """
    Статус парсинга книги.

    Используется в GET /api/v1/books/{book_id}/parsing-status.

    Возможные статусы:
    - not_started: Парсинг еще не начинался
    - processing: Парсинг выполняется
    - completed: Парсинг завершен успешно
    - failed: Произошла ошибка при парсинге

    Attributes:
        book_id: UUID книги
        status: Статус парсинга (not_started | processing | completed | failed)
        progress: Прогресс парсинга в процентах (0-100)
        message: Человекочитаемое сообщение о статусе
        descriptions_found: Всего найдено описаний (опционально)
        current_chapter: Номер текущей обрабатываемой главы (опционально)
        total_chapters: Всего глав в книге (опционально)
        error_message: Детали ошибки если парсинг failed (опционально)
    """

    book_id: UUID = Field(description="UUID of the book")
    status: str = Field(
        description="Parsing status: not_started | processing | completed | failed",
        pattern="^(not_started|processing|completed|failed)$",
    )
    progress: int = Field(
        ge=0, le=100, description="Parsing progress percentage (0-100)"
    )
    message: str = Field(description="Human-readable status message")
    descriptions_found: Optional[int] = Field(
        None, ge=0, description="Total descriptions found across all chapters"
    )
    current_chapter: Optional[int] = Field(
        None, ge=0, description="Currently processing chapter number (0-indexed)"
    )
    total_chapters: Optional[int] = Field(
        None, ge=0, description="Total chapters in the book"
    )
    error_message: Optional[str] = Field(
        None, description="Error details if parsing failed"
    )


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "BookProcessingResponse",
    "ParsingStatusResponse",
]
