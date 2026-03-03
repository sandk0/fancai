"""
API роуты для аутентификации в fancai.

Содержит endpoints для регистрации, входа, обновления токенов и управления профилем.
"""

import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, status, Request, Response, Cookie
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..services.email.email_service import EmailService

from ..core.database import get_database_session
from ..core.auth import get_current_active_user, security
from ..services.auth_service import AuthService
from ..services.token_blacklist import TokenBlacklist
from ..core.container import (
    get_auth_service_dep,
    get_token_blacklist_dep,
    get_email_service_dep,
)
from ..models.user import User
from ..core.config import settings
from ..middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS
from ..monitoring.metrics import record_auth_registration, record_auth_login
from ..schemas.responses import (
    LoginResponse,
    RegisterResponse,
    RefreshTokenResponse,
    LogoutResponse,
    UserResponse,
    TokenPair,
)
from ..schemas.responses.auth import (
    CurrentUserResponse,
    ProfileUpdateResponse,
    AccountDeactivationResponse,
    ForgotPasswordResponse,
    ResetPasswordResponse,
)

router = APIRouter()


# Pydantic модели для запросов и ответов
class UserRegistrationRequest(BaseModel):
    """Модель запроса регистрации пользователя."""

    email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    full_name: Optional[str] = None


class UserLoginRequest(BaseModel):
    """Модель запроса входа пользователя."""

    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class TokenRefreshRequest(BaseModel):
    """Модель запроса обновления токена."""

    refresh_token: str


class UserProfileUpdateRequest(BaseModel):
    """Модель запроса обновления профиля."""

    full_name: Optional[str] = None
    current_password: Optional[str] = Field(None, max_length=128)
    new_password: Optional[str] = Field(None, min_length=12, max_length=128)


# UserResponse уже импортирован из app.schemas.responses
# Дублирующий класс удален (lines 59-70) - использовался неправильный schema без updated_at


@router.post(
    "/auth/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@rate_limit(**RATE_LIMIT_PRESETS["registration"])
async def register_user(
    user_request: UserRegistrationRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> RegisterResponse:
    """
    Регистрация нового пользователя.

    Set HttpOnly cookies for tokens.
    """
    # PRODUCTION-GRADE password validation (12 chars minimum)
    from ..core.validation import validate_password_strength

    is_valid, error_msg = validate_password_strength(user_request.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    try:
        # Создаем пользователя (используем DI)
        user = await auth_svc.create_user(
            db=db,
            email=user_request.email,
            password=user_request.password,
            full_name=user_request.full_name,
        )

        # Reload user with subscription eagerly loaded (lazy="raise")
        result = await db.execute(
            select(User)
            .options(selectinload(User.subscription))
            .where(User.id == user.id)
        )
        user = result.scalar_one()

        tokens_dict = auth_svc.create_tokens_for_user(user)

        # Set HttpOnly Cookies
        response.set_cookie(
            key="access_token",
            value=tokens_dict["access_token"],
            httponly=True,
            secure=not settings.DEBUG,
            samesite="lax",
            max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )
        response.set_cookie(
            key="refresh_token",
            value=tokens_dict["refresh_token"],
            httponly=True,
            secure=not settings.DEBUG,
            samesite="lax",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            path="/api/v1/auth/refresh",
        )

        # Метрика успешной регистрации
        record_auth_registration()

        return RegisterResponse(
            user=UserResponse.model_validate(user),
            tokens=TokenPair(
                access_token=tokens_dict["access_token"],
                refresh_token=tokens_dict["refresh_token"],
                token_type=tokens_dict.get("token_type", "bearer"),
            ),
            message="User registered successfully",
        )

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/auth/login", response_model=LoginResponse)
@rate_limit(**RATE_LIMIT_PRESETS["auth"])
async def login_user(
    user_request: UserLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> LoginResponse:
    """
    Вход пользователя в систему.

    Set HttpOnly cookies for tokens.
    """
    # Аутентифицируем пользователя (используем DI)
    user = await auth_svc.authenticate_user(
        db=db, email=user_request.email, password=user_request.password
    )

    if not user:
        # Метрика неудачного логина
        record_auth_login(status="failure")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Метрика успешного логина
    record_auth_login(status="success")
    tokens_dict = auth_svc.create_tokens_for_user(user)

    # Set HttpOnly Cookies
    response.set_cookie(
        key="access_token",
        value=tokens_dict["access_token"],
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key="refresh_token",
        value=tokens_dict["refresh_token"],
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/api/v1/auth/refresh",
    )

    return LoginResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenPair(
            access_token=tokens_dict["access_token"],
            refresh_token=tokens_dict["refresh_token"],
            token_type=tokens_dict.get("token_type", "bearer"),
        ),
        message="Login successful",
    )


@router.post("/auth/refresh", response_model=RefreshTokenResponse)
async def refresh_token(
    response: Response,
    request_body: Optional[TokenRefreshRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> RefreshTokenResponse:
    """
    Обновление access токена с помощью refresh токена.
    Reads from cookie or body. Sets new cookies.
    """
    token_to_use = None
    if request_body and request_body.refresh_token:
        token_to_use = request_body.refresh_token
    elif refresh_token_cookie:
        token_to_use = refresh_token_cookie

    if not token_to_use:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Обновляем токен (используем DI)
    tokens = await auth_svc.refresh_access_token(db, token_to_use)

    if not tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Set new cookies
    response.set_cookie(
        key="access_token",
        value=tokens["access_token"],
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    # Rotation of refresh token? If create_tokens_for_user logic is used inside refresh service.
    # auth_svc.refresh_access_token returns access_token only usually?
    # Let's check auth_service.py. If it returns new refresh token, we should set it too.

    if "refresh_token" in tokens:
        response.set_cookie(
            key="refresh_token",
            value=tokens["refresh_token"],
            httponly=True,
            secure=not settings.DEBUG,
            samesite="lax",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            path="/api/v1/auth/refresh",
        )

    return RefreshTokenResponse(
        access_token=tokens["access_token"], token_type=tokens["token_type"]
    )


@router.post("/auth/logout", response_model=LogoutResponse)
async def logout_user(
    response: Response,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    access_token_cookie: Optional[str] = Cookie(None, alias="access_token"),
    auth_svc: AuthService = Depends(get_auth_service_dep),
    token_bl: TokenBlacklist = Depends(get_token_blacklist_dep),
) -> LogoutResponse:
    """
    Выход пользователя из системы.
    Clears cookies and blacklists token.
    """
    token = None
    if credentials:
        token = credentials.credentials
    elif access_token_cookie:
        token = access_token_cookie

    if token:
        # Verify token and extract expiration (используем DI)
        payload = auth_svc.verify_token(token, "access")

        if payload:
            # Get token expiration from payload
            exp_timestamp = payload.get("exp")
            if exp_timestamp:
                expires_at = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
                # Add token to blacklist (используем DI)
                await token_bl.add(token, expires_at)

    # Clear cookies
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token", path="/api/v1/auth/refresh")
    # Also delete without path just in case
    response.delete_cookie(key="refresh_token")

    return LogoutResponse()


@router.get("/auth/me", response_model=CurrentUserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> CurrentUserResponse:
    """Получение информации о текущем пользователе."""
    return CurrentUserResponse(
        user=UserResponse.model_validate(current_user).model_dump()
    )


@router.put("/auth/profile", response_model=ProfileUpdateResponse)
@rate_limit(**RATE_LIMIT_PRESETS["low_frequency"])
async def update_user_profile(
    profile_data: UserProfileUpdateRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> ProfileUpdateResponse:
    """
    Обновление профиля текущего пользователя.

    Поддерживает изменение full_name и смену пароля.
    Для смены пароля требуется current_password + new_password.
    """
    if profile_data.new_password:
        if not profile_data.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is required to set new password",
            )

        from ..core.validation import validate_password_strength

        is_valid, error_msg = validate_password_strength(profile_data.new_password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )

    success = await auth_svc.update_user_profile(
        db=db,
        user_id=current_user.id,
        full_name=profile_data.full_name,
        current_password=profile_data.current_password,
        new_password=profile_data.new_password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update profile. Check your current password.",
        )

    return ProfileUpdateResponse(message="Profile updated successfully")


@router.delete("/auth/deactivate", response_model=AccountDeactivationResponse)
async def deactivate_account(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> AccountDeactivationResponse:
    """
    Деактивация аккаунта пользователя.

    Args:
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Сообщение о деактивации

    Raises:
        HTTPException: Если не удалось деактивировать аккаунт
    """
    # Деактивируем пользователя (используем DI)
    success = await auth_svc.deactivate_user(db, current_user.id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate account",
        )

    return AccountDeactivationResponse(message="Account deactivated successfully")


# ============================================================================
# PASSWORD RESET ENDPOINTS
# ============================================================================


class ForgotPasswordRequest(BaseModel):
    """Запрос на сброс пароля."""

    email: EmailStr


@router.post("/auth/forgot-password", response_model=ForgotPasswordResponse)
@rate_limit(**RATE_LIMIT_PRESETS["password_reset"])
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
    email_svc: "EmailService" = Depends(get_email_service_dep),
) -> ForgotPasswordResponse:
    """Запрос на сброс пароля. Всегда возвращает 200 (OWASP: no user enumeration)."""
    token = await auth_svc.create_password_reset_token(db, body.email)

    if token:
        reset_url = f"{settings.PASSWORD_RESET_BASE_URL}?token={token}"

        # Fire-and-forget: НЕ await — для OWASP timing-safety
        _logger = logging.getLogger(__name__)

        async def _safe_send():
            try:
                await email_svc.send_password_reset_email(body.email, reset_url)
            except Exception as e:
                _logger.error(f"Failed to send password reset email: {e}")

        asyncio.ensure_future(_safe_send())

    return ForgotPasswordResponse()


class ResetPasswordRequest(BaseModel):
    """Запрос на установку нового пароля."""

    token: str
    new_password: str = Field(..., min_length=12, max_length=128)


@router.post("/auth/reset-password", response_model=ResetPasswordResponse)
@rate_limit(**RATE_LIMIT_PRESETS["password_reset"])
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
    email_svc: "EmailService" = Depends(get_email_service_dep),
) -> ResetPasswordResponse:
    """Сброс пароля по токену из email."""
    from ..core.validation import validate_password_strength

    is_valid, error_msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    success, user_email = await auth_svc.validate_and_reset_password(
        db, body.token, body.new_password
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    # OWASP: отправить confirmation email (fire-and-forget)
    if user_email:
        _logger = logging.getLogger(__name__)

        async def _safe_send_confirmation():
            try:
                await email_svc.send_password_changed_confirmation(user_email)
            except Exception as e:
                _logger.error(f"Failed to send password changed confirmation: {e}")

        asyncio.ensure_future(_safe_send_confirmation())

    return ResetPasswordResponse()
