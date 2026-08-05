"""
Пакет book services - модульная архитектура для работы с книгами.

Применен Single Responsibility Principle (SRP):
- BookService: Core CRUD операции с книгами
- BookProgressService: Прогресс чтения и расчеты

`BookStatisticsService` и `BookParsingService` из исходного разделения
(`15a0c845`) удалены 2026-08-08: ни один роутер, сервис или задача их
не вызывали. Статистику `routers/users.py` считает своими запросами,
а извлечение описаний с удаления NLP (`0c110210`) идёт через
`DescriptionExtractionService` и `parsing_manager`.

Each service has one clearly defined responsibility and can be tested
and used independently of the others.

Example usage:
    >>> from app.services.book import book_service, book_progress_service
    >>>
    >>> # Получить книги пользователя
    >>> books = await book_service.get_user_books(db, user_id)
    >>>
    >>> # Получить книги с прогрессом
    >>> books_with_progress = await book_progress_service.get_books_with_progress(db, user_id)
"""

from .book_service import BookService, book_service
from .book_progress_service import BookProgressService, book_progress_service

__all__ = [
    # Classes
    "BookService",
    "BookProgressService",
    # Singleton instances (for backward compatibility)
    "book_service",
    "book_progress_service",
]
