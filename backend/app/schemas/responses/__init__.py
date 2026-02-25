"""
Pydantic response models для fancai API.

Этот модуль содержит type-safe response schemas для всех API endpoints,
обеспечивая автоматическую валидацию, сериализацию и OpenAPI документацию.

Архитектура:
- Все response schemas наследуются от BaseModel
- Используется from_attributes=True для ORM моделей
- Enum классы импортируются из моделей для консистентности
- Вложенные схемы для relationships (books, chapters, etc.)

Usage:
    from app.schemas.responses import UserResponse, BookListResponse

    @router.get("/users/me", response_model=UserResponse)
    async def get_current_user() -> UserResponse:
        ...
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from uuid import UUID

# Импортируем Enum классы из моделей для консистентности
from app.models.user import SubscriptionPlan, SubscriptionStatus
from app.models.description import DescriptionType

# ============================================================================
# BASE SCHEMAS
# ============================================================================


class BaseResponse(BaseModel):
    """Базовый response schema с ORM support."""

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# AUTH & USER SCHEMAS
# ============================================================================


class SubscriptionResponse(BaseResponse):
    """
    Response schema для подписки пользователя.

    Attributes:
        id: UUID подписки
        plan: Тип подписки (FREE, PREMIUM, ULTIMATE)
        status: Статус (ACTIVE, EXPIRED, CANCELLED)
        start_date: Дата начала
        end_date: Дата окончания (optional)
        auto_renewal: Автопродление
        books_uploaded: Использовано книг
        images_generated_month: Сгенерировано изображений за месяц
    """

    id: UUID
    plan: SubscriptionPlan
    status: SubscriptionStatus
    start_date: datetime
    end_date: Optional[datetime] = None
    auto_renewal: bool
    books_uploaded: int = Field(ge=0)
    images_generated_month: int = Field(ge=0)
    last_reset_date: datetime
    created_at: datetime
    updated_at: datetime


class UserResponse(BaseResponse):
    """
    Response schema для пользователя.

    Используется в /api/v1/users/me и других user endpoints.

    Attributes:
        id: UUID пользователя
        email: Email адрес
        full_name: Полное имя (optional)
        is_active: Активен ли аккаунт
        is_verified: Подтвержден ли email
        is_admin: Права администратора
        created_at: Дата регистрации
        last_login: Последний вход (optional)
        subscription: Информация о подписке (optional)
    """

    id: UUID
    email: str = Field(max_length=255)
    full_name: Optional[str] = Field(None, max_length=255)
    is_active: bool
    is_verified: bool
    is_admin: bool
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    subscription: Optional[SubscriptionResponse] = None


class TokenPair(BaseModel):
    """
    Response schema для JWT токенов.

    Используется в /api/v1/auth/login.
    """

    access_token: str = Field(description="JWT access token")
    refresh_token: str = Field(description="JWT refresh token")
    token_type: str = Field(default="bearer", description="Тип токена")


class LoginResponse(BaseModel):
    """
    Response schema для успешного логина.

    Используется в /api/v1/auth/login.
    """

    user: UserResponse
    tokens: TokenPair
    message: str = Field(default="Login successful")


class RegisterResponse(BaseModel):
    """
    Response schema для регистрации.

    Используется в /api/v1/auth/register.
    """

    user: UserResponse
    tokens: TokenPair
    message: str = Field(default="Registration successful")


class RefreshTokenResponse(BaseModel):
    """Response schema для обновления токена."""

    access_token: str
    token_type: str = Field(default="bearer")


# ============================================================================
# BOOK SCHEMAS
# ============================================================================


class BookSummary(BaseResponse):
    """
    Краткая информация о книге для списков.

    Используется в /api/v1/books (список книг).
    Оптимизирован для минимального размера response.
    """

    id: UUID
    title: str = Field(max_length=500)
    author: Optional[str] = Field(None, max_length=255)
    genre: str  # BookGenre.value
    language: str = Field(max_length=10)
    description: Optional[str] = None
    cover_image: Optional[str] = None
    file_format: str  # BookFormat.value
    file_size: int = Field(ge=0)
    total_pages: int = Field(ge=0)
    estimated_reading_time: int = Field(ge=0, description="Минуты")
    estimated_reading_time_hours: float = Field(ge=0, description="Часы (для frontend)")
    chapters_count: int = Field(ge=0)
    reading_progress_percent: float = Field(ge=0, le=100)
    has_cover: bool
    is_parsed: bool
    parsing_progress: int = Field(ge=0, le=100)
    is_processing: bool
    created_at: datetime
    last_accessed: Optional[datetime] = None


class BookDetailResponse(BaseResponse):
    """
    Полная информация о книге.

    Используется в /api/v1/books/{book_id}.
    Включает метаданные, описание и статистику.
    """

    id: UUID
    user_id: UUID
    title: str = Field(max_length=500)
    author: Optional[str] = Field(None, max_length=255)
    genre: str
    language: str = Field(max_length=10)
    file_path: str
    file_format: str
    file_size: int = Field(ge=0)
    cover_image: Optional[str] = None
    description: Optional[str] = None
    book_metadata: Optional[Dict[str, Any]] = None
    total_pages: int = Field(ge=0)
    estimated_reading_time: int = Field(ge=0)
    is_parsed: bool
    is_processing: bool = False  # True while Celery task is running
    parsing_progress: int = Field(ge=0, le=100)
    parsing_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    last_accessed: Optional[datetime] = None
    # Frontend computed fields
    estimated_reading_time_hours: float = Field(ge=0, description="Часы (для frontend)")
    file_size_mb: float = Field(ge=0, description="Размер в MB (для frontend)")
    has_cover: bool
    chapters: Optional[List[Dict[str, Any]]] = None
    reading_progress: Optional[Dict[str, Any]] = None


class BookListResponse(BaseModel):
    """
    Paginated список книг.

    Используется в /api/v1/books с pagination.
    """

    books: List[BookSummary]
    total: int = Field(ge=0)
    skip: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)


class BookUploadResponse(BaseModel):
    """
    Response после загрузки книги.

    Используется в POST /api/v1/books.
    Включает task_id для tracking парсинга.
    """

    book: BookDetailResponse
    task_id: Optional[str] = Field(None, description="Celery task ID для парсинга")
    message: str = Field(default="Book uploaded successfully")


class BookDeleteResponse(BaseModel):
    """Response для удаления книги."""

    book_id: UUID
    deleted: bool
    message: str = Field(default="Book deleted successfully")


# ============================================================================
# CHAPTER SCHEMAS
# ============================================================================


class ChapterResponse(BaseResponse):
    """
    Response schema для главы книги.

    Используется в /api/v1/chapters/{chapter_id}.
    """

    id: UUID
    book_id: UUID
    chapter_number: int = Field(ge=1)
    title: str = Field(max_length=500)
    file_path: Optional[str] = Field(None, description="Internal EPUB file path")
    content: str = Field(description="HTML/Text содержимое главы")
    word_count: int = Field(ge=0)
    estimated_reading_time: int = Field(ge=0, description="Минуты")
    is_description_parsed: bool
    descriptions_found: int = Field(ge=0)
    parsing_progress: float = Field(ge=0.0, le=100.0)
    created_at: datetime
    updated_at: datetime


class ChapterListResponse(BaseModel):
    """Список глав книги."""

    chapters: List[ChapterResponse]
    total: int = Field(ge=0)
    book_id: UUID


class ChapterSummary(BaseModel):
    """Краткая информация о главе (без content)."""

    id: UUID
    chapter_number: int
    title: str
    file_path: Optional[str] = Field(None, description="Internal EPUB file path")
    word_count: int
    descriptions_found: int


# ============================================================================
# DESCRIPTION SCHEMAS
# ============================================================================


class DescriptionResponse(BaseResponse):
    """
    Response schema для описания (NLP extracted).

    Используется в /api/v1/descriptions/{description_id}.
    """

    id: UUID
    chapter_id: UUID
    type: DescriptionType
    content: str = Field(description="Текст описания")
    context: str = Field(description="Контекст из текста")
    confidence_score: float = Field(ge=0.0, le=1.0)
    priority_score: float = Field(ge=0.0, le=100.0)
    position_in_chapter: int = Field(ge=0)
    word_count: int = Field(ge=0)
    is_suitable_for_generation: bool
    image_generated: bool
    created_at: datetime
    updated_at: datetime


class DescriptionListResponse(BaseModel):
    """Paginated список описаний."""

    descriptions: List[DescriptionResponse]
    total: int = Field(ge=0)
    skip: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)


class DescriptionWithImageResponse(DescriptionResponse):
    """Description с информацией о сгенерированном изображении."""

    image_url: Optional[str] = None
    image_id: Optional[UUID] = None


# ============================================================================
# IMAGE SCHEMAS
# ============================================================================


class GeneratedImageResponse(BaseResponse):
    """
    Response schema для сгенерированного изображения.

    Используется в /api/v1/images/{image_id}.
    """

    id: UUID
    description_id: UUID
    user_id: UUID
    image_url: str = Field(description="URL изображения")
    local_path: Optional[str] = None
    service_used: str  # ImageService.value
    status: str  # ImageStatus.value
    generation_prompt: str = Field(description="Промпт для генерации")
    generation_parameters: Optional[Dict[str, Any]] = None
    generation_time_seconds: float = Field(ge=0.0)
    moderation_passed: Optional[bool] = None
    moderation_result: Optional[Dict[str, Any]] = None
    view_count: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ImageListResponse(BaseModel):
    """Список изображений."""

    images: List[GeneratedImageResponse]
    total: int = Field(ge=0)


class ImageGenerationTaskResponse(BaseModel):
    """
    Response для запуска генерации изображения.

    Используется в POST /api/v1/images/generate.
    """

    task_id: str = Field(description="Celery task ID")
    description_ids: List[UUID]
    message: str = Field(default="Image generation started")


# ============================================================================
# READING PROGRESS SCHEMAS
# ============================================================================


class ReadingProgressResponse(BaseResponse):
    """
    Response schema для прогресса чтения.

    Используется в /api/v1/books/{book_id}/progress.

    CRITICAL FIX: Schema must match ReadingProgress model exactly.
    Previously had current_chapter_id: UUID but model has current_chapter: int.
    """

    id: UUID
    user_id: UUID
    book_id: UUID
    current_chapter: int = Field(ge=1, description="Номер текущей главы")
    max_chapter_reached: int = Field(ge=1, default=1, description="Максимальная глава, до которой пользователь дочитал")
    current_page: int = Field(ge=1, description="Номер текущей страницы")
    current_position: int = Field(ge=0, le=100, description="Процент прогресса 0-100")
    reading_location_cfi: Optional[str] = Field(
        None, max_length=500, description="CFI для epub.js"
    )
    scroll_offset_percent: float = Field(
        default=0.0, ge=0.0, le=100.0, description="Scroll offset 0-100%"
    )
    reading_time_minutes: int = Field(ge=0, description="Время чтения в минутах")
    reading_speed_wpm: float = Field(default=0.0, ge=0, description="Скорость чтения")
    last_read_at: datetime
    created_at: datetime
    updated_at: datetime


class ReadingProgressUpdateResponse(BaseModel):
    """Response для обновления прогресса."""

    progress: ReadingProgressResponse
    message: str = Field(default="Progress updated successfully")


# ============================================================================
# ADMIN SCHEMAS
# ============================================================================


class SystemStatsResponse(BaseModel):
    """
    Системная статистика.

    Используется в /api/v1/admin/stats.
    """

    total_users: int = Field(ge=0)
    active_users: int = Field(ge=0)
    total_books: int = Field(ge=0)
    parsed_books: int = Field(ge=0)
    total_descriptions: int = Field(ge=0)
    total_images: int = Field(ge=0)
    avg_descriptions_per_book: float = Field(ge=0.0)
    avg_images_per_book: float = Field(ge=0.0)
    timestamp: datetime


class NLPProcessorStatus(BaseModel):
    """Статус одного NLP процессора."""

    name: str
    enabled: bool
    weight: float = Field(ge=0.0)
    threshold: float = Field(ge=0.0, le=1.0)
    max_descriptions: int = Field(ge=0)
    min_confidence: float = Field(ge=0.0, le=1.0)
    is_loaded: bool
    error: Optional[str] = None


class NLPStatusResponse(BaseModel):
    """
    Статус Multi-NLP системы.

    Используется в /api/v1/admin/multi-nlp-settings/status.
    """

    processors: List[NLPProcessorStatus]
    total_processors: int = Field(ge=0)
    active_processors: int = Field(ge=0)
    current_strategy: str = Field(description="SINGLE, ENSEMBLE, ADAPTIVE, etc.")
    ensemble_consensus_threshold: float = Field(ge=0.0, le=1.0)
    last_updated: datetime


class HealthCheckResponse(BaseModel):
    """
    Health check response.

    Используется в /api/v1/health.
    """

    status: str = Field(default="healthy")
    database: str = Field(description="connected | disconnected")
    redis: str = Field(description="connected | disconnected")
    celery: str = Field(description="running | stopped")
    timestamp: datetime


# ============================================================================
# ERROR SCHEMAS
# ============================================================================


class ErrorResponse(BaseModel):
    """Generic error response."""

    detail: str = Field(description="Описание ошибки")
    error_code: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ValidationErrorResponse(BaseModel):
    """Validation error response."""

    detail: List[Dict[str, Any]] = Field(description="Список ошибок валидации")
    error_code: str = Field(default="VALIDATION_ERROR")


# ============================================================================
# IMPORTS FROM SUBMODULES (Phase 1.1-1.4 Type Safety)
# ============================================================================

# Progress responses
from .progress import ReadingProgressDetailResponse  # noqa: E402

# Chapter responses
from .chapters import (  # noqa: E402
    NavigationInfo,
    BookMinimalInfo,
    ChapterDetailResponse,
)

# Image responses (Phase 1.2)
from .images import (  # noqa: E402
    QueueStats,
    UserGenerationInfo,
    APIProviderInfo,
    ImageGenerationStatusResponse,
    UserImageStatsResponse,
    ImageGenerationSuccessResponse,
)

# Description responses (Phase 1.2)
from .descriptions import (  # noqa: E402
    ChapterMinimalInfo,
    NLPAnalysisResult,
    ChapterDescriptionsResponse,
    ChapterAnalysisPreview,
    ChapterAnalysisResponse,
)

# Processing responses (Phase 1.3)
from .processing import (  # noqa: E402
    BookProcessingResponse,
    ParsingStatusResponse,
)

# NLP Testing responses removed (December 2025 - NLP system removed)

# Admin responses (Phase 1.3 + 1.4)
from .admin import (  # noqa: E402
    CacheStatsResponse,
    CacheClearResponse,
    QueueInfo,
    QueueStatusResponse,
    ParsingSettingsResponse,
    CacheWarmResponse,
    FeatureFlagBulkUpdateResponse,
    # Phase 1.4 - NLP Settings
    MultiNLPSettingsUpdateResponse,
    NLPProcessorStatusResponse,
    NLPProcessorTestResponse,
    NLPProcessorInfoResponse,
    # Phase 1.4 - Parsing Queue
    ParsingSettingsUpdateResponse,
    ParsingQueueStatusResponse,
    ClearQueueResponse,
    UnlockParsingResponse,
    # Phase 1.4 - System Settings
    SystemSettingsUpdateResponse,
    InitializeSettingsResponse,
)

# Auth responses (Phase 1.1 + 1.4)
from .auth import (  # noqa: E402
    LogoutResponse,
    # Phase 1.4 - Additional auth endpoints
    CurrentUserResponse,
    ProfileUpdateResponse,
    AccountDeactivationResponse,
    ForgotPasswordResponse,
    ResetPasswordResponse,
)

# User responses (Phase 1.1 + 1.4)
from .users import (  # noqa: E402
    UserStatistics,
    UserProfileResponse,
    UserUpdateResponse,
    UsageInfo,
    LimitsInfo,
    WithinLimitsInfo,
    SubscriptionDetailResponse,
    # Phase 1.4 - Admin user endpoints
    DatabaseTestResponse,
    UserListItem,
    PaginationInfo,
    AdminUsersListResponse,
    SystemHealth,
    AdminStatisticsResponse,
    ReadingStatisticsResponse,
)

# Books Validation responses (Phase 1.4)
from .books_validation import (  # noqa: E402
    ParserStatusResponse,
    ValidationResult,
    BookFileValidationResponse,
    ChapterPreview,
    BookMetadataPreview,
    BookStatisticsPreview,
    BookParsePreviewResponse,
)

# Health responses (Phase 1.4)
from .health import (  # noqa: E402
    PrometheusMetricsResponse,
)

# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    # Base
    "BaseResponse",
    # Auth & User
    "UserResponse",
    "SubscriptionResponse",
    "TokenPair",
    "LoginResponse",
    "RegisterResponse",
    "RefreshTokenResponse",
    # Books
    "BookSummary",
    "BookDetailResponse",
    "BookListResponse",
    "BookUploadResponse",
    "BookDeleteResponse",
    # Chapters
    "ChapterResponse",
    "ChapterListResponse",
    "ChapterSummary",
    # Descriptions
    "DescriptionResponse",
    "DescriptionListResponse",
    "DescriptionWithImageResponse",
    # Images
    "GeneratedImageResponse",
    "ImageListResponse",
    "ImageGenerationTaskResponse",
    # Progress
    "ReadingProgressResponse",
    "ReadingProgressUpdateResponse",
    # Admin
    "SystemStatsResponse",
    "NLPProcessorStatus",
    "NLPStatusResponse",
    "HealthCheckResponse",
    # Errors
    "ErrorResponse",
    "ValidationErrorResponse",
    # NEW: Phase 1.1 Type Safety - User schemas
    "UserStatistics",
    "UserProfileResponse",
    "UserUpdateResponse",
    "UsageInfo",
    "LimitsInfo",
    "WithinLimitsInfo",
    "SubscriptionDetailResponse",
    # NEW: Phase 1.1 Type Safety - Auth schemas
    "LogoutResponse",
    # NEW: Phase 1.1 Type Safety - Progress schemas
    "ReadingProgressDetailResponse",
    # NEW: Phase 1.1 Type Safety - Chapter schemas
    "NavigationInfo",
    "BookMinimalInfo",
    "ChapterDetailResponse",
    # NEW: Phase 1.2 Type Safety - Image schemas
    "QueueStats",
    "UserGenerationInfo",
    "APIProviderInfo",
    "ImageGenerationStatusResponse",
    "UserImageStatsResponse",
    "ImageGenerationSuccessResponse",
    # NEW: Phase 1.2 Type Safety - Description schemas
    "ChapterMinimalInfo",
    "NLPAnalysisResult",
    "ChapterDescriptionsResponse",
    "ChapterAnalysisPreview",
    "ChapterAnalysisResponse",
    # NEW: Phase 1.3 Type Safety - Processing schemas
    "BookProcessingResponse",
    "ParsingStatusResponse",
    # NLP Testing schemas removed (December 2025 - NLP system removed)
    # NEW: Phase 1.3 Type Safety - Admin schemas
    "CacheStatsResponse",
    "CacheClearResponse",
    "QueueInfo",
    "QueueStatusResponse",
    "ParsingSettingsResponse",
    "CacheWarmResponse",
    "FeatureFlagBulkUpdateResponse",
    # NEW: Phase 1.4 Type Safety - NLP Settings
    "MultiNLPSettingsUpdateResponse",
    "NLPProcessorStatusResponse",
    "NLPProcessorTestResponse",
    "NLPProcessorInfoResponse",
    # NEW: Phase 1.4 Type Safety - Parsing Queue
    "ParsingSettingsUpdateResponse",
    "ParsingQueueStatusResponse",
    "ClearQueueResponse",
    "UnlockParsingResponse",
    # NEW: Phase 1.4 Type Safety - System Settings
    "SystemSettingsUpdateResponse",
    "InitializeSettingsResponse",
    # NEW: Phase 1.4 Type Safety - Auth
    "CurrentUserResponse",
    "ProfileUpdateResponse",
    "AccountDeactivationResponse",
    "ForgotPasswordResponse",
    "ResetPasswordResponse",
    # NEW: Phase 1.4 Type Safety - Users/Admin
    "DatabaseTestResponse",
    "UserListItem",
    "PaginationInfo",
    "AdminUsersListResponse",
    "SystemHealth",
    "AdminStatisticsResponse",
    "ReadingStatisticsResponse",
    # NEW: Phase 1.4 Type Safety - Books Validation
    "ParserStatusResponse",
    "ValidationResult",
    "BookFileValidationResponse",
    "ChapterPreview",
    "BookMetadataPreview",
    "BookStatisticsPreview",
    "BookParsePreviewResponse",
    # NEW: Phase 1.4 Type Safety - Health
    "PrometheusMetricsResponse",
]
