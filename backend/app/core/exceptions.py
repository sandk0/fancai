"""
Custom exception classes для fancai.

Этот модуль содержит специализированные исключения для различных
типов ошибок в приложении, обеспечивая консистентные error messages
и коды статусов.

TD-P16-3: RFC 9457 Problem Details support.
"""

from fastapi import HTTPException, status, Request
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
from uuid import UUID


class ProblemDetail(HTTPException):
    """
    RFC 9457 Problem Details base exception.
    https://www.rfc-editor.org/rfc/rfc9457.html
    """

    def __init__(
        self,
        status_code: int,
        type_uri: str,
        title: str,
        detail: Optional[str] = None,
        instance: Optional[str] = None,
        extensions: Optional[Dict[str, Any]] = None,
    ):
        self.type_uri = type_uri
        self.title = title
        self.detail_msg = detail
        self.instance = instance
        self.extensions = extensions or {}

        super().__init__(status_code=status_code, detail=detail or title)

    def to_dict(self, request: Optional[Request] = None) -> Dict[str, Any]:
        result = {
            "type": self.type_uri,
            "title": self.title,
            "status": self.status_code,
        }
        if self.detail_msg:
            result["detail"] = self.detail_msg
        if self.instance:
            result["instance"] = self.instance
        elif request:
            result["instance"] = str(request.url)
        result.update(self.extensions)
        return result


async def problem_detail_exception_handler(
    request: Request, exc: ProblemDetail
) -> JSONResponse:
    """FastAPI exception handler for RFC 9457 Problem Details."""
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(request),
        media_type="application/problem+json",
    )


# ============================================================================
# Resource Not Found Exceptions (404)
# ============================================================================


class BookNotFoundException(HTTPException):
    """Исключение, когда книга не найдена."""

    def __init__(self, book_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Book with ID {book_id} not found",
        )


class ChapterNotFoundException(HTTPException):
    """Исключение, когда глава не найдена."""

    def __init__(self, chapter_identifier: int | UUID, book_id: UUID | None = None):
        detail = f"Chapter {chapter_identifier} not found"
        if book_id:
            detail += f" in book {book_id}"
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail,
        )


class DescriptionNotFoundException(HTTPException):
    """Исключение, когда описание не найдено."""

    def __init__(self, description_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Description with ID {description_id} not found",
        )


class ImageNotFoundException(HTTPException):
    """Исключение, когда изображение не найдено."""

    def __init__(self, image_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Image with ID {image_id} not found",
        )


class BookFileNotFoundException(HTTPException):
    """Исключение, когда файл книги не найден на сервере."""

    def __init__(self, book_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Book file not found on server for book {book_id}",
        )


class CoverImageNotFoundException(HTTPException):
    """Исключение, когда обложка книги не найдена."""

    def __init__(self, book_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cover image not found for book {book_id}",
        )


class ReadingSessionNotFoundException(HTTPException):
    """Исключение, когда сессия чтения не найдена."""

    def __init__(self, session_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reading session {session_id} not found",
        )


# ============================================================================
# Access Denied Exceptions (403)
# ============================================================================


class BookAccessDeniedException(HTTPException):
    """Исключение, когда доступ к книге запрещен."""

    def __init__(self, book_id: UUID):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to book {book_id}",
        )


class ChapterAccessDeniedException(HTTPException):
    """Исключение, когда доступ к главе запрещен."""

    def __init__(self, chapter_id: UUID):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to chapter {chapter_id}",
        )


class DescriptionAccessDeniedException(HTTPException):
    """Исключение, когда доступ к описанию запрещен."""

    def __init__(self, description_id: UUID):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Description not found or access denied",
        )


class ImageAccessDeniedException(HTTPException):
    """Исключение, когда доступ к изображению запрещен."""

    def __init__(self, image_id: UUID):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found or access denied",
        )


class ReadingSessionAccessDeniedException(HTTPException):
    """Исключение, когда доступ к сессии чтения запрещен."""

    def __init__(self, session_id: UUID):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to reading session {session_id}",
        )


# ============================================================================
# Validation Exceptions (400)
# ============================================================================


class InvalidFileFormatException(HTTPException):
    """Исключение для невалидного формата файла."""

    def __init__(self, file_format: str, supported_formats: list[str] | None = None):
        if supported_formats is None:
            supported_formats = ["EPUB", "FB2"]
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file format: {file_format}. Supported formats: {', '.join(supported_formats)}",
        )


class FileTooLargeException(HTTPException):
    """Исключение для слишком большого файла."""

    def __init__(self, max_size_mb: int = 50):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large (max {max_size_mb}MB)",
        )


class FileTooSmallException(HTTPException):
    """Исключение для слишком маленького файла."""

    def __init__(self):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too small",
        )


class NoFilenameProvidedException(HTTPException):
    """Исключение, когда имя файла не предоставлено."""

    def __init__(self):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )


class EmptyTextException(HTTPException):
    """Исключение для пустого текста."""

    def __init__(self):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text cannot be empty",
        )


class ReadingSessionAlreadyEndedException(HTTPException):
    """Исключение, когда пытаемся завершить уже завершенную сессию."""

    def __init__(self, session_id: UUID):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reading session {session_id} is already ended",
        )


class ReadingSessionInactiveException(HTTPException):
    """Исключение, когда пытаемся обновить неактивную сессию."""

    def __init__(self, session_id: UUID):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reading session {session_id} is inactive",
        )


class InvalidDescriptionTypeException(HTTPException):
    """Исключение для невалидного типа описания."""

    def __init__(self, description_type: str):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid description type: {description_type}",
        )


# ============================================================================
# Conflict Exceptions (409)
# ============================================================================


class ImageAlreadyExistsException(HTTPException):
    """Исключение, когда изображение уже существует для описания."""

    def __init__(self, description_id: UUID):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Image already exists for description {description_id}",
        )


# ============================================================================
# Service Unavailable Exceptions (503)
# ============================================================================


class ParsingServiceUnavailableException(HTTPException):
    """Исключение, когда сервис парсинга недоступен."""

    def __init__(self):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Parsing service is currently unavailable",
        )


# ============================================================================
# Internal Server Error Exceptions (500)
# ============================================================================


class BookProcessingException(HTTPException):
    """Исключение при ошибке обработки книги."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing book",
        )


class ChapterFetchException(HTTPException):
    """Исключение при ошибке получения главы."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching chapter",
        )


class DescriptionFetchException(HTTPException):
    """Исключение при ошибке получения описаний."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching descriptions",
        )


class ImageGenerationException(HTTPException):
    """Исключение при ошибке генерации изображения."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image generation failed",
        )


class ImageDeletionException(HTTPException):
    """Исключение при ошибке удаления изображения."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete image",
        )


class ImageRegenerationException(HTTPException):
    """Исключение при ошибке перегенерации изображения."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image regeneration failed",
        )


class FileReadException(HTTPException):
    """Исключение при ошибке чтения файла."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read file",
        )


class BookRetrievalException(HTTPException):
    """Исключение при ошибке получения файла книги."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving book file",
        )


class CoverFetchException(HTTPException):
    """Исключение при ошибке получения обложки."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching cover",
        )


class ParsingStatusException(HTTPException):
    """Исключение при ошибке получения статуса парсинга."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching parsing status",
        )


class BookListFetchException(HTTPException):
    """Исключение при ошибке получения списка книг."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching books",
        )


class BookFetchException(HTTPException):
    """Исключение при ошибке получения книги."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching book",
        )


class ChapterAnalysisException(HTTPException):
    """Исключение при ошибке анализа главы."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error analyzing chapter",
        )


class BatchGenerationException(HTTPException):
    """Исключение при ошибке пакетной генерации."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Batch generation failed",
        )


class UnexpectedGenerationException(HTTPException):
    """Исключение при неожиданной ошибке генерации."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error during generation",
        )


class UnexpectedRegenerationException(HTTPException):
    """Исключение при неожиданной ошибке перегенерации."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error during regeneration",
        )


class ParsingStartException(HTTPException):
    """Исключение при ошибке запуска парсинга."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error starting book processing",
        )


class ChapterDescriptionFetchException(HTTPException):
    """Исключение при ошибке получения описаний главы."""

    def __init__(self, error_message: str = ""):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching chapter descriptions",
        )
