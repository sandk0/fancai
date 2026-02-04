"""
API роуты для аутентификации в fancai.

Содержит endpoints для регистрации, входа, обновления токенов и управления профилем.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, status, Request, Response, Cookie
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr
from typing import Optional

from ..core.database import get_database_session
from ..core.auth import get_current_active_user, security
from ..services.auth_service import AuthService
from ..services.token_blacklist import TokenBlacklist
from ..core.container import get_auth_service_dep, get_token_blacklist_dep
from ..models.user import User
from ..core.config import settings
from ..middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS
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
)

router = APIRouter()


# Pydantic модели для запросов и ответов
class UserRegistrationRequest(BaseModel):
    """Модель запроса регистрации пользователя."""

    email: EmailStr
    password: str
    full_name: Optional[str] = None


class UserLoginRequest(BaseModel):
    """Модель запроса входа пользователя."""

    email: EmailStr
    password: str


class TokenRefreshRequest(BaseModel):
    """Модель запроса обновления токена."""

    refresh_token: str


class UserProfileUpdateRequest(BaseModel):
    """Модель запроса обновления профиля."""

    full_name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


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

        # Refresh user object to ensure all fields are loaded
        await db.refresh(user)

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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
