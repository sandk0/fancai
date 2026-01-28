"""
Admin API routes for image generation settings.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from loguru import logger

from ...core.auth import get_current_admin_user
from ...models.user import User
from ...services.settings_manager import settings_manager
from ...schemas.responses.admin import ImageGenerationSettingsUpdateResponse

router = APIRouter()


class ImageGenerationSettings(BaseModel):
    primary_service: str
    fallback_services: list[str]
    enable_caching: bool
    image_quality: str
    max_generation_time: int


@router.get("/image-generation-settings", response_model=ImageGenerationSettings)
async def get_image_generation_settings(
    admin_user: User = Depends(get_current_admin_user),
):
    """Get image generation settings from database."""

    try:
        img_settings = await settings_manager.get_category_settings("image_generation")

        return ImageGenerationSettings(
            primary_service=img_settings.get("primary_service", "imagen"),
            fallback_services=img_settings.get(
                "fallback_services", []
            ),
            enable_caching=img_settings.get("enable_caching", True),
            image_quality=img_settings.get("image_quality", "high"),
            max_generation_time=img_settings.get("max_generation_time", 60),
        )
    except Exception as e:
        print(f"Error getting image generation settings: {e}")
        return ImageGenerationSettings(
            primary_service="imagen",
            fallback_services=[],
            enable_caching=True,
            image_quality="high",
            max_generation_time=60,
        )


@router.put("/image-generation-settings", response_model=ImageGenerationSettingsUpdateResponse)
async def update_image_generation_settings(
    settings: ImageGenerationSettings,
    admin_user: User = Depends(get_current_admin_user),
) -> ImageGenerationSettingsUpdateResponse:
    """Update image generation settings."""

    try:
        await settings_manager.set_setting(
            "image_generation", "primary_service", settings.primary_service
        )
        await settings_manager.set_setting(
            "image_generation", "fallback_services", settings.fallback_services
        )
        await settings_manager.set_setting(
            "image_generation", "enable_caching", settings.enable_caching
        )
        await settings_manager.set_setting(
            "image_generation", "image_quality", settings.image_quality
        )
        await settings_manager.set_setting(
            "image_generation", "max_generation_time", settings.max_generation_time
        )

        return ImageGenerationSettingsUpdateResponse(
            message="Image generation settings saved successfully",
            settings=settings.model_dump(),
        )
    except Exception as e:
        logger.exception(f"Failed to update image generation settings: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to update image generation settings",
        )
