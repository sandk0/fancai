"""
Middleware и dependencies для аутентификации в fancai.

Содержит функции для проверки JWT токенов и получения текущего пользователя.
Включает проверку token blacklist для корректной обработки logout.
"""

from typing import Optional
from uuid import UUID
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from .database import get_database_session
from ..services.auth_service import auth_service
from ..services.token_blacklist import token_blacklist
from ..models.user import User


# Создаем схему безопасности для Bearer токенов
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_database_session),
) -> User:
    """
    Dependency для получения текущего аутентифицированного пользователя.

    Args:
        credentials: JWT токен из заголовка Authorization
        db: Сессия базы данных

    Returns:
        Текущий пользователь

    Raises:
        HTTPException: Если токен недействительный или пользователь не найден
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_revoked_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token has been revoked",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Проверяем токен
    token = credentials.credentials

    # Check if token is blacklisted (revoked via logout)
    if await token_blacklist.is_blacklisted(token):
        raise token_revoked_exception

    payload = auth_service.verify_token(token, "access")

    if payload is None:
        raise credentials_exception

    # Получаем ID пользователя
    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise credentials_exception

    try:
        user_id = UUID(user_id_str)
    except ValueError:
        raise credentials_exception

    # Получаем пользователя из базы данных
    user = await auth_service.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise credentials_exception

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Dependency для получения текущего активного пользователя.

    Args:
        current_user: Текущий пользователь из get_current_user

    Returns:
        Активный пользователь

    Raises:
        HTTPException: Если пользователь неактивен
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """
    Dependency для получения текущего пользователя с правами администратора.

    Args:
        current_user: Текущий активный пользователь

    Returns:
        Пользователь-администратор

    Raises:
        HTTPException: Если пользователь не администратор
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    return current_user


def get_optional_current_user():
    """
    Dependency для получения текущего пользователя (опционально).
    Используется для endpoints, которые работают как с авторизованными,
    так и с неавторизованными пользователями.

    Returns:
        Пользователь или None
    """

    async def _get_optional_current_user(
        db: AsyncSession = Depends(get_database_session),
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(
            HTTPBearer(auto_error=False)
        ),
    ) -> Optional[User]:
        if credentials is None:
            return None

        try:
            # Проверяем токен
            token = credentials.credentials

            # Check if token is blacklisted (revoked via logout)
            if await token_blacklist.is_blacklisted(token):
                return None

            payload = auth_service.verify_token(token, "access")

            if payload is None:
                return None

            # Получаем ID пользователя
            user_id_str = payload.get("sub")
            if user_id_str is None:
                return None

            user_id = UUID(user_id_str)

            # Получаем пользователя из базы данных
            user = await auth_service.get_user_by_id(db, user_id)
            if user is None or not user.is_active:
                return None

            return user

        except Exception as e:
            logger.debug(f"Optional auth failed: {e}")
            return None

    return _get_optional_current_user


class AuthMiddleware:
    """
    Middleware класс для проверки аутентификации на уровне приложения.
    Может использоваться для логирования, метрик или других задач.
    """

    def __init__(self):
        """Инициализация middleware."""
        pass

    async def check_token_validity(self, token: str) -> bool:
        """
        Проверяет действительность токена.

        Args:
            token: JWT токен

        Returns:
            True если токен действительный и не отозван
        """
        # Check blacklist first
        if await token_blacklist.is_blacklisted(token):
            return False

        payload = auth_service.verify_token(token, "access")
        return payload is not None

    async def extract_user_info(self, token: str) -> Optional[dict]:
        """
        Извлекает информацию о пользователе из токена.

        Args:
            token: JWT токен

        Returns:
            Информация о пользователе или None
        """
        payload = auth_service.verify_token(token, "access")
        if payload is None:
            return None

        return {
            "user_id": payload.get("sub"),
            "email": payload.get("email"),
            "is_admin": payload.get("is_admin", False),
        }


# Глобальный экземпляр middleware
auth_middleware = AuthMiddleware()


# Helper function for tests
def create_access_token(data: dict) -> str:
    """
    Создает JWT access токен (helper для тестов).

    Args:
        data: Данные для включения в токен (обычно {"sub": user_id})

    Returns:
        JWT токен строка

    Example:
        >>> token = create_access_token({"sub": str(user.id)})
        >>> headers = {"Authorization": f"Bearer {token}"}
    """
    from ..services.auth_service import auth_service

    return auth_service.create_access_token(data)
