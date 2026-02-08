"""
Response schemas для auth endpoints в fancai.

Этот модуль содержит type-safe response schemas для endpoints
аутентификации и управления сессиями.
"""

from pydantic import BaseModel, Field
from datetime import datetime

# ============================================================================
# AUTH RESPONSE SCHEMAS
# ============================================================================


class LogoutResponse(BaseModel):
    """
    Response после успешного logout.

    Используется в POST /api/v1/auth/logout.

    Attributes:
        message: Сообщение об успешном выходе
        logged_out_at: Время выхода из системы

    Example:
        {
            "message": "Logout successful",
            "logged_out_at": "2025-11-29T10:30:00"
        }
    """

    message: str = Field(default="Logout successful")
    logged_out_at: datetime = Field(default_factory=datetime.utcnow)


class CurrentUserResponse(BaseModel):
    """
    Response с информацией о текущем пользователе.

    Используется в GET /api/v1/auth/me.

    Attributes:
        user: Объект пользователя с полными данными
    """

    user: dict = Field(description="Current user object with all fields")

    class Config:
        json_schema_extra = {
            "example": {
                "user": {
                    "id": "123e4567-e89b-12d3-a456-426614174000",
                    "email": "user@example.com",
                    "full_name": "John Doe",
                    "is_active": True,
                    "is_verified": True,
                    "is_admin": False,
                    "created_at": "2025-01-01T00:00:00",
                    "updated_at": "2025-11-29T10:30:00",
                    "last_login": "2025-11-29T10:00:00",
                }
            }
        }


class ProfileUpdateResponse(BaseModel):
    """
    Response после успешного обновления профиля.

    Используется в PUT /api/v1/auth/profile.

    Attributes:
        message: Сообщение об успешном обновлении
    """

    message: str = Field(
        default="Profile updated successfully", description="Success message"
    )


class AccountDeactivationResponse(BaseModel):
    """
    Response после деактивации аккаунта.

    Используется в DELETE /api/v1/auth/deactivate.

    Attributes:
        message: Сообщение об успешной деактивации
        deactivated_at: Время деактивации
    """

    message: str = Field(
        default="Account deactivated successfully", description="Success message"
    )
    deactivated_at: datetime = Field(
        default_factory=datetime.utcnow, description="Deactivation timestamp"
    )


class ForgotPasswordResponse(BaseModel):
    """
    Response для запроса сброса пароля.

    Всегда возвращает одно сообщение (OWASP: no user enumeration).
    """

    message: str = Field(
        default="If this email is registered, a password reset link has been sent",
        description="Constant message regardless of email existence",
    )


class ResetPasswordResponse(BaseModel):
    """Response для успешного сброса пароля."""

    message: str = Field(
        default="Password has been reset successfully",
        description="Success message",
    )


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "LogoutResponse",
    "CurrentUserResponse",
    "ProfileUpdateResponse",
    "AccountDeactivationResponse",
    "ForgotPasswordResponse",
    "ResetPasswordResponse",
]
