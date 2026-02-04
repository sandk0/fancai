"""
Response schemas для user-related endpoints в fancai.

Этот модуль содержит type-safe response schemas для user endpoints,
включая профили, подписки и статистику пользователей.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

from . import UserResponse, SubscriptionResponse

# ============================================================================
# USER STATISTICS SCHEMAS
# ============================================================================


class UserStatistics(BaseModel):
    """
    Статистика пользователя для отображения в профиле.

    Attributes:
        total_books: Общее количество книг в библиотеке
        total_descriptions: Общее количество найденных описаний
        total_images: Общее количество сгенерированных изображений
        total_reading_time_minutes: Общее время чтения в минутах
    """

    total_books: int = Field(ge=0, description="Total books in library")
    total_descriptions: int = Field(ge=0, description="Total descriptions found")
    total_images: int = Field(ge=0, description="Total images generated")
    total_reading_time_minutes: int = Field(ge=0, description="Total reading time")


class UserProfileResponse(BaseModel):
    """
    Полный профиль пользователя с подпиской и статистикой.

    Используется в GET /api/v1/users/profile.

    Attributes:
        user: Информация о пользователе
        subscription: Информация о подписке (optional)
        statistics: Статистика чтения
    """

    user: UserResponse
    subscription: Optional[SubscriptionResponse] = None
    statistics: UserStatistics


class UserUpdateResponse(BaseModel):
    """
    Response после обновления профиля пользователя.

    Используется в PUT /api/v1/users/me.

    Attributes:
        user: Обновленная информация о пользователе
        message: Сообщение об успешном обновлении
    """

    user: UserResponse
    message: str = Field(default="User profile updated successfully")


# ============================================================================
# SUBSCRIPTION DETAILS SCHEMAS
# ============================================================================


class UsageInfo(BaseModel):
    """
    Текущее использование подписки.

    Attributes:
        books_uploaded: Количество загруженных книг
        images_generated_month: Количество сгенерированных изображений за месяц
        last_reset_date: Дата последнего сброса счетчика
    """

    books_uploaded: int = Field(ge=0, description="Books uploaded count")
    images_generated_month: int = Field(ge=0, description="Images generated this month")
    last_reset_date: datetime = Field(
        description="Last reset date for monthly counters"
    )


class LimitsInfo(BaseModel):
    """
    Лимиты подписки.

    Attributes:
        books: Лимит книг (-1 для unlimited)
        generations_month: Лимит генераций в месяц (-1 для unlimited)
    """

    books: int = Field(description="Book limit (-1 for unlimited)")
    generations_month: int = Field(
        description="Monthly generation limit (-1 for unlimited)"
    )


class WithinLimitsInfo(BaseModel):
    """
    Проверка соблюдения лимитов.

    Attributes:
        books: Не превышен ли лимит книг
        generations: Не превышен ли лимит генераций
    """

    books: bool = Field(description="Within book limit")
    generations: bool = Field(description="Within generation limit")


class SubscriptionDetailResponse(BaseModel):
    """
    Детальная информация о подписке с использованием и лимитами.

    Используется в GET /api/v1/users/subscription.

    Attributes:
        subscription: Базовая информация о подписке
        usage: Текущее использование
        limits: Лимиты подписки
        within_limits: Проверка соблюдения лимитов
    """

    subscription: SubscriptionResponse
    usage: UsageInfo
    limits: LimitsInfo
    within_limits: WithinLimitsInfo


# ============================================================================
# ADMIN ENDPOINTS SCHEMAS (NEW: Phase 1.4)
# ============================================================================


class DatabaseTestResponse(BaseModel):
    """
    Response для тестирования подключения к базе данных.

    Используется в GET /api/v1/users/test-db.

    Attributes:
        status: Статус подключения (connected)
        database_info: Информация о базе данных
        message: Человекочитаемое сообщение
    """

    status: str = Field(default="connected", description="Connection status")
    database_info: Dict[str, Any] = Field(
        description="Database information (version, name, user, tables)"
    )
    message: str = Field(
        default="Database connection successful", description="Human-readable message"
    )


class UserListItem(BaseModel):
    """
    Элемент списка пользователей (для админа).

    Attributes:
        id: UUID пользователя
        email: Email пользователя
        full_name: Полное имя
        is_active: Флаг активности
        is_verified: Флаг верификации
        is_admin: Флаг администратора
        created_at: Дата создания
        last_login: Дата последнего входа (опционально)
        subscription_plan: План подписки (free, premium, ultimate)
        total_books: Количество книг пользователя
    """

    id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool
    is_verified: bool
    is_admin: bool
    created_at: str
    last_login: Optional[str] = None
    subscription_plan: str
    total_books: int = Field(ge=0)


class PaginationInfo(BaseModel):
    """
    Информация о пагинации.

    Attributes:
        total: Всего элементов
        skip: Пропущено элементов
        limit: Лимит элементов на страницу
        has_more: Есть ли еще элементы
    """

    total: int = Field(ge=0)
    skip: int = Field(ge=0)
    limit: int = Field(ge=1)
    has_more: bool


class AdminUsersListResponse(BaseModel):
    """
    Response со списком всех пользователей (для админа).

    Используется в GET /api/v1/users/admin/users.

    Attributes:
        users: Список пользователей
        pagination: Информация о пагинации
    """

    users: List[UserListItem] = Field(description="List of users")
    pagination: PaginationInfo = Field(description="Pagination information")


class SystemHealth(BaseModel):
    """
    Информация о состоянии системы.

    Attributes:
        status: Статус системы (healthy)
        avg_books_per_user: Среднее количество книг на пользователя
        avg_descriptions_per_book: Среднее количество описаний на книгу
    """

    status: str = Field(default="healthy")
    avg_books_per_user: float = Field(ge=0.0)
    avg_descriptions_per_book: float = Field(ge=0.0)


class AdminStatisticsResponse(BaseModel):
    """
    Response с общей статистикой системы (для админа).

    Используется в GET /api/v1/users/admin/stats.

    Attributes:
        users: Статистика пользователей (total, active, inactive)
        subscriptions: Подписки по планам {plan: count}
        content: Статистика контента (total_books, total_descriptions)
        system_health: Информация о состоянии системы
    """

    users: Dict[str, int] = Field(
        description="User statistics (total, active, inactive)"
    )
    subscriptions: Dict[str, int] = Field(
        description="Subscriptions by plan {plan: count}"
    )
    content: Dict[str, int] = Field(
        description="Content statistics (total_books, total_descriptions)"
    )
    system_health: SystemHealth = Field(description="System health information")


class ReadingStatisticsResponse(BaseModel):
    """
    Response с детальной статистикой чтения пользователя.

    Используется в GET /api/v1/users/reading-statistics.

    Attributes:
        statistics: Основная статистика чтения
        reading_streak: Reading streak информация (опционально)
        favorite_genres: Любимые жанры (опционально)
        weekly_activity: Активность по дням недели (опционально)
    """

    statistics: Dict[str, Any] = Field(
        description="Reading statistics (total_books, time, speed, etc.)"
    )
    reading_streak: Optional[Dict[str, Any]] = Field(
        None, description="Reading streak information (current_streak, longest_streak)"
    )
    favorite_genres: Optional[List[Dict[str, Any]]] = Field(
        None, description="Favorite genres with counts"
    )
    weekly_activity: Optional[Dict[str, int]] = Field(
        None, description="Activity by day of week"
    )


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "UserStatistics",
    "UserProfileResponse",
    "UserUpdateResponse",
    "UsageInfo",
    "LimitsInfo",
    "WithinLimitsInfo",
    "SubscriptionDetailResponse",
    # Admin endpoints (Phase 1.4)
    "DatabaseTestResponse",
    "UserListItem",
    "PaginationInfo",
    "AdminUsersListResponse",
    "SystemHealth",
    "AdminStatisticsResponse",
    "ReadingStatisticsResponse",
]
