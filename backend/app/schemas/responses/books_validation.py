"""
Response schemas for books validation endpoints.

Используется в:
- GET /api/v1/books/parser-status
- POST /api/v1/books/validate-file
- POST /api/v1/books/parse-preview

Version: Phase 1.4 Type Safety (2025-11-29)
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class ParserStatusResponse(BaseModel):
    """
    Response для статуса парсера книг.

    Используется в GET /api/v1/books/parser-status.

    Attributes:
        supported_formats: Список поддерживаемых форматов (.epub, .fb2)
        nlp_available: Доступность NLP процессора
        parser_ready: Готовность парсера к работе
        max_file_size_mb: Максимальный размер файла в МБ
        message: Информационное сообщение
    """

    supported_formats: List[str] = Field(
        description="List of supported book formats (.epub, .fb2)"
    )
    nlp_available: bool = Field(description="Whether NLP processor is available")
    parser_ready: bool = Field(description="Whether parser is ready to process books")
    max_file_size_mb: int = Field(
        default=50, description="Maximum file size in megabytes"
    )
    message: str = Field(description="Human-readable status message")

    class Config:
        json_schema_extra = {
            "example": {
                "supported_formats": [".epub", ".fb2"],
                "nlp_available": True,
                "parser_ready": True,
                "max_file_size_mb": 50,
                "message": "Book parser supports: .epub, .fb2",
            }
        }


class ValidationResult(BaseModel):
    """
    Детальный результат валидации файла.

    Attributes:
        is_valid: Флаг валидности файла
        format: Определенный формат файла
        errors: Список ошибок (если есть)
        warnings: Список предупреждений (если есть)
    """

    is_valid: bool
    format: Optional[str] = None
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class BookFileValidationResponse(BaseModel):
    """
    Response для валидации загруженного файла книги.

    Используется в POST /api/v1/books/validate-file.

    Attributes:
        filename: Имя файла
        file_size_bytes: Размер файла в байтах
        file_size_mb: Размер файла в мегабайтах
        validation: Детальный результат валидации
        message: Человекочитаемое сообщение о результате
    """

    filename: str = Field(description="Original filename")
    file_size_bytes: int = Field(ge=0, description="File size in bytes")
    file_size_mb: float = Field(
        ge=0.0, description="File size in megabytes (rounded to 2 decimals)"
    )
    validation: ValidationResult = Field(description="Detailed validation results")
    message: str = Field(description="Human-readable validation result message")

    class Config:
        json_schema_extra = {
            "example": {
                "filename": "book.epub",
                "file_size_bytes": 2048576,
                "file_size_mb": 1.95,
                "validation": {
                    "is_valid": True,
                    "format": "epub",
                    "errors": [],
                    "warnings": [],
                },
                "message": "File validated successfully",
            }
        }


class ChapterPreview(BaseModel):
    """
    Превью одной главы книги.

    Attributes:
        number: Номер главы
        title: Название главы
        content_preview: Превью контента (первые 500 символов)
        word_count: Количество слов в главе
        estimated_reading_time_minutes: Примерное время чтения в минутах
    """

    number: int = Field(ge=1)
    title: str
    content_preview: str = Field(description="First 500 characters of chapter content")
    word_count: int = Field(ge=0)
    estimated_reading_time_minutes: int = Field(
        ge=1, description="Estimated reading time in minutes (word_count / 200)"
    )


class BookMetadataPreview(BaseModel):
    """
    Превью метаданных книги.

    Attributes:
        title: Название книги
        author: Автор книги
        language: Язык книги
        genre: Жанр книги
        description: Описание книги (первые 1000 символов)
        publisher: Издатель (опционально)
        publish_date: Дата публикации (опционально)
        has_cover: Флаг наличия обложки
    """

    title: str
    author: Optional[str] = None
    language: Optional[str] = None
    genre: Optional[str] = None
    description: Optional[str] = Field(
        None, description="Book description (first 1000 characters)"
    )
    publisher: Optional[str] = None
    publish_date: Optional[str] = None
    has_cover: bool = Field(description="Whether book has a cover image")


class BookStatisticsPreview(BaseModel):
    """
    Статистика книги из превью парсинга.

    Attributes:
        total_chapters: Всего глав в книге
        total_pages: Всего страниц
        estimated_reading_time_hours: Примерное время чтения в часах
        file_format: Формат файла (epub, fb2)
        file_size_mb: Размер файла в МБ
    """

    total_chapters: int = Field(ge=0)
    total_pages: int = Field(ge=0)
    estimated_reading_time_hours: float = Field(
        ge=0.0, description="Estimated reading time in hours"
    )
    file_format: str = Field(description="File format (epub, fb2)")
    file_size_mb: float = Field(ge=0.0, description="File size in megabytes")


class BookParsePreviewResponse(BaseModel):
    """
    Response для предварительного просмотра парсинга книги.

    Используется в POST /api/v1/books/parse-preview.

    Attributes:
        metadata: Метаданные книги
        statistics: Статистика книги
        chapters_preview: Превью первых 3 глав
        message: Человекочитаемое сообщение о результате
    """

    metadata: BookMetadataPreview = Field(description="Book metadata preview")
    statistics: BookStatisticsPreview = Field(description="Book statistics preview")
    chapters_preview: List[ChapterPreview] = Field(
        default_factory=list, description="Preview of first 3 chapters"
    )
    message: str = Field(description="Human-readable result message")

    class Config:
        json_schema_extra = {
            "example": {
                "metadata": {
                    "title": "Война и мир",
                    "author": "Лев Толстой",
                    "language": "ru",
                    "genre": "роман",
                    "description": "Великий роман о войне 1812 года...",
                    "has_cover": True,
                },
                "statistics": {
                    "total_chapters": 365,
                    "total_pages": 1200,
                    "estimated_reading_time_hours": 40.0,
                    "file_format": "epub",
                    "file_size_mb": 2.5,
                },
                "chapters_preview": [
                    {
                        "number": 1,
                        "title": "Часть первая, глава I",
                        "content_preview": "— Eh bien, mon prince...",
                        "word_count": 1500,
                        "estimated_reading_time_minutes": 8,
                    }
                ],
                "message": "Book parsed successfully: 365 chapters found",
            }
        }


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "ParserStatusResponse",
    "ValidationResult",
    "BookFileValidationResponse",
    "ChapterPreview",
    "BookMetadataPreview",
    "BookStatisticsPreview",
    "BookParsePreviewResponse",
]
