"""
Books router module - модульная структура для работы с книгами.

Этот пакет объединяет все операции с книгами в единый router с разделением
по ответственности:
- crud: базовые CRUD операции (upload, list, get, delete, files)
- validation: валидация и preview операции
- processing: обработка книг и статусы парсинга

Usage:
    from app.routers.books import books_router
    app.include_router(books_router, prefix="/api/v1", tags=["books"])
"""

from fastapi import APIRouter
from . import crud, validation, processing

# Главный router для книг
books_router = APIRouter(prefix="/books", tags=["books"])

# Подключаем все sub-routers
books_router.include_router(crud.router)
books_router.include_router(validation.router)
books_router.include_router(processing.router)


__all__ = ["books_router"]
