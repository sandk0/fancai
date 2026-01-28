"""
API роуты для управления пользователями в fancai.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from loguru import logger

from ..core.database import get_database_session
from ..core.auth import get_current_active_user, get_current_admin_user
from ..models.user import User, Subscription
from ..models.book import Book
from ..models.image import GeneratedImage
from ..services.user_statistics_service import UserStatisticsService
from ..schemas.responses import (
    UserResponse,
    SubscriptionResponse,
    UserProfileResponse,
    UserStatistics,
    SubscriptionDetailResponse,
    UsageInfo,
    LimitsInfo,
    WithinLimitsInfo,
)
from ..schemas.responses.users import (
    DatabaseTestResponse,
    AdminUsersListResponse,
    AdminStatisticsResponse,
    ReadingStatisticsResponse,
    UserListItem,
    PaginationInfo,
    SystemHealth,
)


router = APIRouter()


@router.get("/users/test-db", response_model=DatabaseTestResponse)
async def test_database_connection(
    db: AsyncSession = Depends(get_database_session),
) -> DatabaseTestResponse:
    """
    Тестовый endpoint для проверки подключения к базе данных.

    Returns:
        Информация о подключении к базе данных
    """
    try:
        # Выполняем простой запрос к базе данных
        result = await db.execute(
            text("SELECT version(), current_database(), current_user")
        )
        row = result.fetchone()

        if row:
            version, database, user = row
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch database information",
            )

        # Проверим, что таблицы созданы
        result = await db.execute(
            text(
                """
            SELECT COUNT(*) as table_count
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('users', 'books', 'chapters', 'descriptions', 'generated_images')
        """
            )
        )
        table_count_row = result.fetchone()
        table_count = table_count_row[0] if table_count_row else 0

        return DatabaseTestResponse(
            status="connected",
            database_info={
                "version": version,
                "database": database,
                "user": user,
                "tables_found": table_count,
                "expected_tables": 5,
            },
            message="Database connection successful",
        )

    except Exception as e:
        logger.exception(f"Database connection check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database connection check failed",
        )


@router.get("/users/profile", response_model=UserProfileResponse)
async def get_user_profile(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> UserProfileResponse:
    """
    Получение подробного профиля текущего пользователя.

    Args:
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Подробная информация о профиле пользователя

    Example:
        ```bash
        curl -X GET http://localhost:8000/api/v1/users/profile \\
             -H "Authorization: Bearer <token>"
        ```
    """
    # Получаем подписку пользователя
    subscription_result = await db.execute(
        select(Subscription).where(Subscription.user_id == current_user.id)
    )
    subscription = subscription_result.scalar_one_or_none()

    # Получаем статистику пользователя
    books_count = await db.execute(
        select(func.count(Book.id)).where(Book.user_id == current_user.id)
    )
    total_books = books_count.scalar()

    # NLP REMOVAL: Descriptions extracted on-demand, not stored
    total_descriptions = 0

    # Общее количество изображений
    images_count = await db.execute(
        select(func.count(GeneratedImage.id)).where(
            GeneratedImage.user_id == current_user.id
        )
    )
    total_images = images_count.scalar() or 0

    # Общее время чтения (через reading_sessions)
    total_reading_time = await UserStatisticsService.get_total_reading_time(
        db, current_user.id
    )

    # Создаем response objects
    user_response = UserResponse.model_validate(current_user)

    subscription_response = None
    if subscription:
        subscription_response = SubscriptionResponse.model_validate(subscription)

    statistics = UserStatistics(
        total_books=total_books,
        total_descriptions=total_descriptions,
        total_images=total_images,
        total_reading_time_minutes=total_reading_time,
    )

    return UserProfileResponse(
        user=user_response, subscription=subscription_response, statistics=statistics
    )


@router.get("/users/subscription", response_model=SubscriptionDetailResponse)
async def get_user_subscription(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> SubscriptionDetailResponse:
    """
    Получение информации о подписке пользователя.

    Args:
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Информация о подписке и лимитах

    Raises:
        HTTPException: 404 если подписка не найдена

    Example:
        ```bash
        curl -X GET http://localhost:8000/api/v1/users/subscription \\
             -H "Authorization: Bearer <token>"
        ```
    """
    subscription_result = await db.execute(
        select(Subscription).where(Subscription.user_id == current_user.id)
    )
    subscription = subscription_result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found"
        )

    # Определяем лимиты для разных планов
    limits_config = {
        "free": {"books": 3, "generations_month": 50},
        "premium": {"books": 50, "generations_month": 500},
        "ultimate": {"books": -1, "generations_month": -1},  # Unlimited
    }

    plan_limits = limits_config.get(subscription.plan.value, limits_config["free"])

    # Создаем response objects
    subscription_response = SubscriptionResponse.model_validate(subscription)

    usage = UsageInfo(
        books_uploaded=subscription.books_uploaded,
        images_generated_month=subscription.images_generated_month,
        last_reset_date=subscription.last_reset_date,
    )

    limits = LimitsInfo(
        books=plan_limits["books"], generations_month=plan_limits["generations_month"]
    )

    within_limits = WithinLimitsInfo(
        books=(
            plan_limits["books"] == -1
            or subscription.books_uploaded < plan_limits["books"]
        ),
        generations=(
            plan_limits["generations_month"] == -1
            or subscription.images_generated_month < plan_limits["generations_month"]
        ),
    )

    return SubscriptionDetailResponse(
        subscription=subscription_response,
        usage=usage,
        limits=limits,
        within_limits=within_limits,
    )


@router.get("/users/admin/users", response_model=AdminUsersListResponse)
async def list_all_users(
    skip: int = 0,
    limit: int = 50,
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> AdminUsersListResponse:
    """
    Получение списка всех пользователей (только для администраторов).

    Args:
        skip: Количество записей для пропуска
        limit: Максимальное количество записей
        current_admin: Текущий администратор
        db: Сессия базы данных

    Returns:
        Список пользователей с пагинацией
    """
    # Получаем общее количество пользователей
    total_count = await db.execute(select(func.count(User.id)))
    total = total_count.scalar()

    # Получаем пользователей с пагинацией
    users_result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)
    )
    users = users_result.scalars().all()

    # Формируем список пользователей
    users_data = []
    for user in users:
        # Получаем подписку для каждого пользователя
        subscription_result = await db.execute(
            select(Subscription).where(Subscription.user_id == user.id)
        )
        subscription = subscription_result.scalar_one_or_none()

        # Получаем количество книг
        books_count = await db.execute(
            select(func.count(Book.id)).where(Book.user_id == user.id)
        )
        total_books = books_count.scalar()

        users_data.append(
            UserListItem(
                id=str(user.id),
                email=user.email,
                full_name=user.full_name,
                is_active=user.is_active,
                is_verified=user.is_verified,
                is_admin=user.is_admin,
                created_at=user.created_at.isoformat(),
                last_login=user.last_login.isoformat() if user.last_login else None,
                subscription_plan=(
                    subscription.plan.value if subscription else "free"
                ),
                total_books=total_books,
            )
        )

    return AdminUsersListResponse(
        users=users_data,
        pagination=PaginationInfo(
            total=total,
            skip=skip,
            limit=limit,
            has_more=skip + limit < total,
        ),
    )


@router.get("/users/admin/stats", response_model=AdminStatisticsResponse)
async def get_admin_statistics(
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> AdminStatisticsResponse:
    """
    Получение общей статистики системы (только для администраторов).

    Args:
        current_admin: Текущий администратор
        db: Сессия базы данных

    Returns:
        Общая статистика системы
    """
    # Общее количество пользователей
    total_users = await db.execute(select(func.count(User.id)))
    total_users_count = total_users.scalar()

    # Активные пользователи
    active_users = await db.execute(
        select(func.count(User.id)).where(User.is_active is True)
    )
    active_users_count = active_users.scalar()

    # Подписки по планам
    subscription_stats = await db.execute(
        select(Subscription.plan, func.count(Subscription.id).label("count")).group_by(
            Subscription.plan
        )
    )
    subscriptions_by_plan = {
        row.plan.value: row.count for row in subscription_stats.fetchall()
    }

    # Общее количество книг
    total_books = await db.execute(select(func.count(Book.id)))
    total_books_count = total_books.scalar()

    # NLP REMOVAL: Descriptions extracted on-demand, not stored
    # Count generated images instead
    total_images = await db.execute(select(func.count(GeneratedImage.id)))
    total_images_count = total_images.scalar()

    return AdminStatisticsResponse(
        users={
            "total": total_users_count,
            "active": active_users_count,
            "inactive": total_users_count - active_users_count,
        },
        subscriptions=subscriptions_by_plan,
        content={
            "total_books": total_books_count,
            "total_descriptions": 0,  # DEPRECATED - descriptions on-demand
            "total_images": total_images_count,
        },
        system_health=SystemHealth(
            status="healthy",
            avg_books_per_user=round(
                total_books_count / max(total_users_count, 1), 2
            ),
            avg_descriptions_per_book=0,  # DEPRECATED
        ),
    )


@router.get("/users/reading-statistics", response_model=ReadingStatisticsResponse)
async def get_reading_statistics(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ReadingStatisticsResponse:
    """
    Получает детальную статистику чтения пользователя.

    Performance: Uses Redis caching with 5-minute TTL (December 2025).
    On cache miss or Redis unavailability, falls back to direct DB queries.

    Включает:
    - Общее количество книг и статус чтения
    - Время чтения и скорость
    - Reading streak (непрерывные дни чтения)
    - Любимые жанры
    - Weekly activity (активность по дням)

    Args:
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        Детальная статистика чтения:
        {
            "statistics": {
                "total_books": 15,
                "books_in_progress": 3,
                "books_completed": 12,
                "total_reading_time_minutes": 2400,
                "reading_streak_days": 7,
                "average_reading_speed_wpm": 250.5,
                "total_pages_read": 3500,
                "total_chapters_read": 120,
                "favorite_genres": [
                    {"genre": "fantasy", "count": 6},
                    {"genre": "sci-fi", "count": 4}
                ],
                "weekly_activity": [
                    {
                        "date": "2025-10-26",
                        "day": "Вс",
                        "minutes": 45,
                        "sessions": 2,
                        "progress": 12
                    }
                ]
            }
        }

    Example:
        ```bash
        curl -X GET http://localhost:8000/api/v1/reading-statistics \\
             -H "Authorization: Bearer <token>"
        ```
    """
    # Get all statistics with Redis caching (TTL: 5 minutes)
    # Falls back to direct DB queries if Redis unavailable
    stats = await UserStatisticsService.get_all_reading_statistics(
        db, current_user.id, use_cache=True
    )

    return ReadingStatisticsResponse(statistics=stats)
