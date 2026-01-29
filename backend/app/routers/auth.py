"""
API роуты для аутентификации в fancai.

Содержит endpoints для регистрации, входа, обновления токенов и управления профилем.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, status, Request
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


@router.post("/auth/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
@rate_limit(**RATE_LIMIT_PRESETS["registration"])
async def register_user(
    user_request: UserRegistrationRequest,
    request: Request,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> RegisterResponse:
    """
    Регистрация нового пользователя.

    Args:
        user_request: Данные для регистрации
        request: HTTP request object (для rate limiting)
        db: Сессия базы данных

    Returns:
        Информация о созданном пользователе и токены

    Raises:
        HTTPException: Если email уже используется или другие ошибки
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
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> LoginResponse:
    """
    Вход пользователя в систему.

    Args:
        user_request: Данные для входа
        request: HTTP request object (для rate limiting)
        db: Сессия базы данных

    Returns:
        Информация о пользователе и токены

    Raises:
        HTTPException: Если неверные учетные данные
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
    request: TokenRefreshRequest,
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> RefreshTokenResponse:
    """
    Обновление access токена с помощью refresh токена.

    Args:
        request: Refresh токен
        db: Сессия базы данных

    Returns:
        Новый access токен

    Raises:
        HTTPException: Если refresh токен недействительный

    Example:
        ```bash
        curl -X POST http://localhost:8000/api/v1/auth/refresh \\
             -H "Content-Type: application/json" \\
             -d '{"refresh_token": "<refresh_token>"}'
        ```
    """
    # Обновляем токен (используем DI)
    tokens = await auth_svc.refresh_access_token(db, request.refresh_token)

    if not tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return RefreshTokenResponse(
        access_token=tokens["access_token"], token_type=tokens["token_type"]
    )


@router.get("/auth/me", response_model=CurrentUserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> CurrentUserResponse:
    """
    Получение информации о текущем пользователе.

    Args:
        current_user: Текущий пользователь из токена

    Returns:
        Информация о пользователе
    """
    return CurrentUserResponse(
        user={
            "id": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "is_active": current_user.is_active,
            "is_verified": current_user.is_verified,
            "is_admin": current_user.is_admin,
            "created_at": current_user.created_at.isoformat(),
            "updated_at": current_user.updated_at.isoformat(),
            "last_login": (
                current_user.last_login.isoformat() if current_user.last_login else None
            ),
        }
    )


@router.put("/auth/profile", response_model=ProfileUpdateResponse)
async def update_user_profile(
    request: UserProfileUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    auth_svc: AuthService = Depends(get_auth_service_dep),
) -> ProfileUpdateResponse:
    """
    Обновление профиля пользователя.

    Args:
        request: Данные для обновления
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        Сообщение об успешном обновлении

    Raises:
        HTTPException: Если неверный текущий пароль или другие ошибки
    """
    # Валидация нового пароля (PRODUCTION-GRADE)
    if request.new_password:
        from ..core.validation import validate_password_strength

        is_valid, error_msg = validate_password_strength(request.new_password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )

    # Если пытаются сменить пароль, требуем текущий пароль
    if request.new_password and not request.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is required to change password",
        )

    # Обновляем профиль (используем DI)
    success = await auth_svc.update_user_profile(
        db=db,
        user_id=current_user.id,
        full_name=request.full_name,
        current_password=request.current_password,
        new_password=request.new_password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update profile. Check your current password.",
        )

    return ProfileUpdateResponse(message="Profile updated successfully")


@router.post("/auth/logout", response_model=LogoutResponse)
async def logout_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_svc: AuthService = Depends(get_auth_service_dep),
    token_bl: TokenBlacklist = Depends(get_token_blacklist_dep),
) -> LogoutResponse:
    """
    Выход пользователя из системы.

    Добавляет токен в blacklist до его естественного истечения,
    предотвращая повторное использование токена после logout.

    Args:
        credentials: JWT токен для валидации

    Returns:
        Сообщение об успешном выходе с timestamp

    Example:
        ```bash
        curl -X POST http://localhost:8000/api/v1/auth/logout \\
             -H "Authorization: Bearer <token>"
        ```

    Security:
        - Token is blacklisted in Redis until its natural expiration
        - Subsequent requests with this token will be rejected with 401
        - Blacklist entries auto-expire when the token would have expired
    """
    token = credentials.credentials

    # Verify token and extract expiration (используем DI)
    payload = auth_svc.verify_token(token, "access")

    if payload:
        # Get token expiration from payload
        exp_timestamp = payload.get("exp")
        if exp_timestamp:
            expires_at = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
            # Add token to blacklist (используем DI)
            await token_bl.add(token, expires_at)

    return LogoutResponse()


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
