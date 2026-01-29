"""
Admin endpoints для управления feature flags.

Feature flags позволяют динамически включать/выключать функциональность
без перезапуска приложения.

Endpoints:
- GET /admin/feature-flags - Список всех feature flags
- GET /admin/feature-flags/{flag_name} - Получить конкретный флаг
- PUT /admin/feature-flags/{flag_name} - Обновить флаг
- POST /admin/feature-flags - Создать новый флаг
- POST /admin/feature-flags/bulk-update - Массовое обновление
- DELETE /admin/feature-flags/cache - Очистить кэш флагов
- POST /admin/feature-flags/initialize - Инициализировать дефолтные флаги
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import Dict, List, Optional

from ...core.auth import get_current_admin_user
from ...core.database import get_database_session
from ...models.user import User
from ...models.feature_flag import FeatureFlagCategory
from ...services.feature_flag_manager import FeatureFlagManager
from ...schemas.responses import FeatureFlagBulkUpdateResponse
from ...schemas.responses.admin import (
    FeatureFlagUpdateResponse,
    FeatureFlagCacheClearResponse,
    FeatureFlagInitializeResponse,
    FeatureFlagCategoryItem,
    FeatureFlagCategoriesResponse,
)


router = APIRouter(prefix="/feature-flags", tags=["admin", "feature-flags"])


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================


class FeatureFlagResponse(BaseModel):
    """Response model для feature flag."""

    id: str
    name: str
    enabled: bool
    category: str
    description: Optional[str] = None
    default_value: bool
    created_at: str
    updated_at: str


class FeatureFlagUpdateRequest(BaseModel):
    """Request model для обновления feature flag."""

    enabled: bool = Field(description="Whether the flag should be enabled")


class FeatureFlagCreateRequest(BaseModel):
    """Request model для создания feature flag."""

    name: str = Field(max_length=100, description="Unique flag name")
    enabled: bool = Field(default=False, description="Initial enabled state")
    category: str = Field(
        default="system", description="Flag category (nlp, parser, images, system, experimental)"
    )
    description: Optional[str] = Field(None, description="Human-readable description")
    default_value: bool = Field(default=False, description="Default fallback value")


class BulkUpdateRequest(BaseModel):
    """Request model для массового обновления флагов."""

    updates: Dict[str, bool] = Field(
        ...,
        description="Dictionary of {flag_name: enabled}",
        json_schema_extra={"example": {"USE_ADVANCED_PARSER": True, "USE_LLM_ENRICHMENT": False}},
    )


# ============================================================================
# ENDPOINTS
# ============================================================================


@router.get("", response_model=List[FeatureFlagResponse])
async def get_all_feature_flags(
    category: Optional[str] = Query(None, description="Filter by category"),
    enabled_only: bool = Query(False, description="Show only enabled flags"),
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> List[FeatureFlagResponse]:
    """
    Получить список всех feature flags.

    Args:
        category: Фильтр по категории (опционально)
        enabled_only: Показать только включенные флаги
        current_user: Текущий администратор
        db: Database session

    Returns:
        Список feature flags

    Example:
        GET /admin/feature-flags?category=nlp&enabled_only=true
    """
    flag_manager = FeatureFlagManager(db)

    if enabled_only:
        flags = await flag_manager.get_enabled_flags(category=category)
    else:
        flags = await flag_manager.get_all_flags(category=category)

    return [
        FeatureFlagResponse(
            id=str(flag.id),
            name=flag.name,
            enabled=flag.enabled,
            category=flag.category,
            description=flag.description,
            default_value=flag.default_value,
            created_at=flag.created_at.isoformat(),
            updated_at=flag.updated_at.isoformat(),
        )
        for flag in flags
    ]


@router.get("/{flag_name}", response_model=FeatureFlagResponse)
async def get_feature_flag(
    flag_name: str,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagResponse:
    """
    Получить конкретный feature flag.

    Args:
        flag_name: Название флага
        current_user: Текущий администратор
        db: Database session

    Returns:
        Feature flag details

    Raises:
        HTTPException: 404 если флаг не найден

    Example:
        GET /admin/feature-flags/USE_NEW_NLP_ARCHITECTURE
    """
    flag_manager = FeatureFlagManager(db)
    flag = await flag_manager.get_flag(flag_name)

    if not flag:
        raise HTTPException(
            status_code=404, detail=f"Feature flag '{flag_name}' not found"
        )

    return FeatureFlagResponse(
        id=str(flag.id),
        name=flag.name,
        enabled=flag.enabled,
        category=flag.category,
        description=flag.description,
        default_value=flag.default_value,
        created_at=flag.created_at.isoformat(),
        updated_at=flag.updated_at.isoformat(),
    )


@router.put("/{flag_name}", response_model=FeatureFlagUpdateResponse)
async def update_feature_flag(
    flag_name: str,
    update_request: FeatureFlagUpdateRequest,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagUpdateResponse:
    """
    Обновить feature flag.

    Args:
        flag_name: Название флага
        update_request: Новые значения
        current_user: Текущий администратор
        db: Database session

    Returns:
        Результат операции

    Raises:
        HTTPException: 404 если флаг не найден

    Example:
        PUT /admin/feature-flags/USE_ADVANCED_PARSER
        {"enabled": true}
    """
    flag_manager = FeatureFlagManager(db)
    success = await flag_manager.set_flag(flag_name, update_request.enabled)

    if not success:
        raise HTTPException(
            status_code=404, detail=f"Feature flag '{flag_name}' not found"
        )

    flag = await flag_manager.get_flag(flag_name)

    return FeatureFlagUpdateResponse(
        message=f"Feature flag '{flag_name}' updated successfully",
        flag=flag.to_dict() if flag else None,
        admin=current_user.email,
    )


@router.post("", response_model=FeatureFlagResponse, status_code=201)
async def create_feature_flag(
    create_request: FeatureFlagCreateRequest,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagResponse:
    """
    Создать новый feature flag.

    Args:
        create_request: Данные для создания
        current_user: Текущий администратор
        db: Database session

    Returns:
        Созданный feature flag

    Raises:
        HTTPException: 400 если флаг уже существует

    Example:
        POST /admin/feature-flags
        {
            "name": "ENABLE_NEW_FEATURE",
            "enabled": false,
            "category": "experimental",
            "description": "Enable new experimental feature"
        }
    """
    flag_manager = FeatureFlagManager(db)

    # Check if flag already exists
    existing_flag = await flag_manager.get_flag(create_request.name)
    if existing_flag:
        raise HTTPException(
            status_code=400,
            detail=f"Feature flag '{create_request.name}' already exists",
        )

    # Create new flag
    flag = await flag_manager.create_flag(
        name=create_request.name,
        enabled=create_request.enabled,
        category=create_request.category,
        description=create_request.description,
        default_value=create_request.default_value,
    )

    if not flag:
        raise HTTPException(
            status_code=500, detail="Failed to create feature flag"
        )

    return FeatureFlagResponse(
        id=str(flag.id),
        name=flag.name,
        enabled=flag.enabled,
        category=flag.category,
        description=flag.description,
        default_value=flag.default_value,
        created_at=flag.created_at.isoformat(),
        updated_at=flag.updated_at.isoformat(),
    )


@router.post("/bulk-update", response_model=FeatureFlagBulkUpdateResponse)
async def bulk_update_feature_flags(
    bulk_request: BulkUpdateRequest,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagBulkUpdateResponse:
    """
    Массовое обновление feature flags.

    Args:
        bulk_request: Словарь обновлений {flag_name: enabled}
        current_user: Текущий администратор
        db: Database session

    Returns:
        Результаты обновления для каждого флага

    Example:
        POST /admin/feature-flags/bulk-update
        {
            "updates": {
                "USE_ADVANCED_PARSER": true,
                "USE_LLM_ENRICHMENT": false,
                "ENABLE_PARALLEL_PROCESSING": true
            }
        }
    """
    flag_manager = FeatureFlagManager(db)
    results = await flag_manager.bulk_update(bulk_request.updates)

    success_count = sum(1 for success in results.values() if success)
    failed_count = len(results) - success_count

    return FeatureFlagBulkUpdateResponse(
        message=f"Bulk update completed: {success_count} success, {failed_count} failed",
        results=results,
        total=len(results),
        success_count=success_count,
        failed_count=failed_count,
        admin_email=current_user.email,
    )


@router.delete("/cache", response_model=FeatureFlagCacheClearResponse)
async def clear_feature_flags_cache(
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagCacheClearResponse:
    flag_manager = FeatureFlagManager(db)
    flag_manager.clear_cache()

    return FeatureFlagCacheClearResponse(admin=current_user.email)


@router.post("/initialize", response_model=FeatureFlagInitializeResponse)
async def initialize_default_flags(
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
) -> FeatureFlagInitializeResponse:
    flag_manager = FeatureFlagManager(db)
    await flag_manager.initialize()

    all_flags = await flag_manager.get_all_flags()

    return FeatureFlagInitializeResponse(
        total_flags=len(all_flags),
        admin=current_user.email,
    )


@router.get("/categories/list", response_model=FeatureFlagCategoriesResponse)
async def get_flag_categories(
    current_user: User = Depends(get_current_admin_user),
) -> FeatureFlagCategoriesResponse:
    categories = [
        FeatureFlagCategoryItem(
            value=FeatureFlagCategory.NLP.value,
            label="NLP Features",
            description="Natural Language Processing related features",
        ),
        FeatureFlagCategoryItem(
            value=FeatureFlagCategory.PARSER.value,
            label="Parser Features",
            description="Book parsing and content extraction features",
        ),
        FeatureFlagCategoryItem(
            value=FeatureFlagCategory.IMAGES.value,
            label="Image Features",
            description="Image generation and processing features",
        ),
        FeatureFlagCategoryItem(
            value=FeatureFlagCategory.SYSTEM.value,
            label="System Features",
            description="System-level features and infrastructure",
        ),
        FeatureFlagCategoryItem(
            value=FeatureFlagCategory.EXPERIMENTAL.value,
            label="Experimental Features",
            description="Experimental and beta features",
        ),
    ]

    return FeatureFlagCategoriesResponse(categories=categories, total=len(categories))
