"""
Admin API routes for system-wide settings.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from loguru import logger

from ...core.auth import get_current_admin_user
from ...models.user import User
from ...services.settings_manager import settings_manager
from ...schemas.responses.admin import (
    SystemSettingsUpdateResponse,
    InitializeSettingsResponse,
)

router = APIRouter()


class SystemSettings(BaseModel):
    maintenance_mode: bool
    max_upload_size_mb: int
    supported_book_formats: list[str]
    enable_debug_mode: bool


@router.get("/system-settings", response_model=SystemSettings)
async def get_system_settings(admin_user: User = Depends(get_current_admin_user)):
    """Get system settings from database."""

    try:
        sys_settings = await settings_manager.get_category_settings("system")

        return SystemSettings(
            maintenance_mode=sys_settings.get("maintenance_mode", False),
            max_upload_size_mb=sys_settings.get("max_upload_size_mb", 50),
            supported_book_formats=sys_settings.get(
                "supported_book_formats", ["epub", "fb2"]
            ),
            enable_debug_mode=sys_settings.get("enable_debug_mode", False),
        )
    except Exception as e:
        print(f"Error getting system settings: {e}")
        return SystemSettings(
            maintenance_mode=False,
            max_upload_size_mb=50,
            supported_book_formats=["epub", "fb2"],
            enable_debug_mode=False,
        )


@router.put("/system-settings", response_model=SystemSettingsUpdateResponse)
async def update_system_settings(
    settings: SystemSettings, admin_user: User = Depends(get_current_admin_user)
) -> SystemSettingsUpdateResponse:
    """Update system settings."""

    try:
        await settings_manager.set_setting(
            "system", "maintenance_mode", settings.maintenance_mode
        )
        await settings_manager.set_setting(
            "system", "max_upload_size_mb", settings.max_upload_size_mb
        )
        await settings_manager.set_setting(
            "system", "supported_book_formats", settings.supported_book_formats
        )
        await settings_manager.set_setting(
            "system", "enable_debug_mode", settings.enable_debug_mode
        )

        return SystemSettingsUpdateResponse(
            message="System settings saved successfully", settings=settings.model_dump()
        )
    except Exception as e:
        logger.exception(f"Failed to update system settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to update system settings")


@router.post("/initialize-settings", response_model=InitializeSettingsResponse)
async def initialize_default_settings(
    admin_user: User = Depends(get_current_admin_user),
) -> InitializeSettingsResponse:
    """Initialize default settings in database."""

    try:
        success = await settings_manager.initialize_default_settings(force=False)
        if success:
            return InitializeSettingsResponse(
                message="Default settings initialized successfully"
            )
        else:
            return InitializeSettingsResponse(
                message="Settings already exist, no changes made"
            )
    except Exception as e:
        logger.exception(f"Failed to initialize settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize settings")
