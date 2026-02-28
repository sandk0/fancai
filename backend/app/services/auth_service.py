"""
Сервис аутентификации для fancai.

Управление JWT токенами, регистрацией и авторизацией пользователей.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from uuid import UUID
import jwt
from jwt.exceptions import InvalidTokenError
import bcrypt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

import hashlib
import logging
import secrets

from ..models.user import User, Subscription, SubscriptionPlan, SubscriptionStatus
from ..core.config import settings

logger = logging.getLogger(__name__)


class AuthService:
    """Сервис для управления аутентификацией пользователей."""

    def __init__(self):
        """Инициализация сервиса аутентификации."""
        self.algorithm = settings.ALGORITHM
        self.secret_key = settings.SECRET_KEY
        self.access_token_expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
        self.refresh_token_expire_days = settings.REFRESH_TOKEN_EXPIRE_DAYS

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """
        Проверяет пароль против хеша.

        Args:
            plain_password: Пароль в открытом виде
            hashed_password: Хешированный пароль

        Returns:
            True если пароль верный

        Raises:
            ValueError: Если пароль > 72 байт (валидация должна предотвращать это)
        """
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), hashed_password.encode("utf-8")
        )

    def get_password_hash(self, password: str) -> str:
        """
        Создает хеш пароля.

        Args:
            password: Пароль в открытом виде

        Returns:
            Хешированный пароль

        Raises:
            ValueError: Если пароль > 72 байт (валидация должна предотвращать это)
        """
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
        return hashed.decode("utf-8")

    def create_access_token(self, data: Dict[str, Any]) -> str:
        """
        Создает JWT access токен.

        Args:
            data: Данные для включения в токен

        Returns:
            JWT токен
        """
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=self.access_token_expire_minutes
        )
        now = datetime.now(timezone.utc)
        to_encode.update({"exp": expire, "iat": now, "type": "access"})
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(self, data: Dict[str, Any]) -> str:
        """
        Создает JWT refresh токен.

        Args:
            data: Данные для включения в токен

        Returns:
            JWT refresh токен
        """
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + timedelta(
            days=self.refresh_token_expire_days
        )
        now = datetime.now(timezone.utc)
        to_encode.update({"exp": expire, "iat": now, "type": "refresh"})
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def verify_token(
        self, token: str, token_type: str = "access"
    ) -> Optional[Dict[str, Any]]:
        """
        Проверяет и декодирует JWT токен.

        Args:
            token: JWT токен для проверки
            token_type: Тип токена ("access" или "refresh")

        Returns:
            Декодированные данные токена или None
        """
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])

            # Проверяем тип токена
            if payload.get("type") != token_type:
                return None

            # Проверяем обязательные поля
            user_id = payload.get("sub")
            if user_id is None:
                return None

            return payload
        except InvalidTokenError:
            return None

    async def create_user(
        self,
        db: AsyncSession,
        email: str,
        password: str,
        full_name: Optional[str] = None,
    ) -> User:
        """
        Создает нового пользователя.

        Args:
            db: Сессия базы данных
            email: Email адрес пользователя
            password: Пароль в открытом виде
            full_name: Полное имя пользователя

        Returns:
            Созданный пользователь

        Raises:
            ValueError: Если пользователь с таким email уже существует
        """
        # Проверяем существование пользователя
        existing_user = await self.get_user_by_email(db, email)
        if existing_user:
            raise ValueError("User with this email already exists")

        # Создаем нового пользователя
        hashed_password = self.get_password_hash(password)
        user = User(
            email=email,
            password_hash=hashed_password,
            full_name=full_name,
            is_active=True,
            is_verified=False,  # Требуется подтверждение email
            is_admin=False,
        )

        db.add(user)

        try:
            await db.flush()  # Получаем ID пользователя

            # Создаем бесплатную подписку для нового пользователя
            subscription = Subscription(
                user_id=user.id,
                plan=SubscriptionPlan.FREE,
                status=SubscriptionStatus.ACTIVE,
                auto_renewal=False,
                books_uploaded=0,
                images_generated_month=0,
            )
            db.add(subscription)

            await db.commit()
            return user

        except IntegrityError as e:
            await db.rollback()
            raise ValueError("Failed to create user: email already exists") from e

    async def authenticate_user(
        self, db: AsyncSession, email: str, password: str
    ) -> Optional[User]:
        """
        Аутентифицирует пользователя.

        Args:
            db: Сессия базы данных
            email: Email адрес
            password: Пароль в открытом виде

        Returns:
            Пользователь если аутентификация успешна, иначе None
        """
        user = await self.get_user_by_email(db, email)
        if not user:
            return None

        if not self.verify_password(password, user.password_hash):
            return None

        if not user.is_active:
            return None

        # Обновляем время последнего входа
        user.last_login = datetime.now(timezone.utc)
        await db.commit()

        # CRITICAL FIX: Refresh user object to ensure all server-default fields
        # (created_at, updated_at) are loaded from database after commit
        # This prevents ResponseValidationError when LoginResponse expects these fields
        await db.refresh(user)

        return user

    async def get_user_by_email(self, db: AsyncSession, email: str) -> Optional[User]:
        """
        Получает пользователя по email.

        Args:
            db: Сессия базы данных
            email: Email адрес

        Returns:
            Пользователь или None
        """
        result = await db.execute(
            select(User)
            .where(User.email == email)
            .options(selectinload(User.subscription))
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, db: AsyncSession, user_id: UUID) -> Optional[User]:
        """
        Получает пользователя по ID.

        Args:
            db: Сессия базы данных
            user_id: ID пользователя

        Returns:
            Пользователь или None
        """
        result = await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.subscription))
        )
        return result.scalar_one_or_none()

    def create_tokens_for_user(self, user: User) -> Dict[str, str]:
        """
        Создает пару access и refresh токенов для пользователя.

        Args:
            user: Пользователь

        Returns:
            Словарь с access_token и refresh_token
        """
        token_data = {
            "sub": str(user.id),
            "email": user.email,
            "is_admin": user.is_admin,
        }

        access_token = self.create_access_token(token_data)
        refresh_token = self.create_refresh_token(token_data)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
        }

    async def refresh_access_token(
        self, db: AsyncSession, refresh_token: str
    ) -> Optional[Dict[str, str]]:
        """
        Обновляет access токен используя refresh токен.

        Args:
            db: Сессия базы данных
            refresh_token: Refresh токен

        Returns:
            Новая пара токенов или None
        """
        payload = self.verify_token(refresh_token, "refresh")
        if not payload:
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        # Проверяем существование пользователя
        user = await self.get_user_by_id(db, UUID(user_id))
        if not user or not user.is_active:
            return None

        # Option A: проверяем tokens_invalidated_at
        if user.tokens_invalidated_at:
            token_iat = payload.get("iat")
            if token_iat and token_iat < user.tokens_invalidated_at.timestamp():
                return None

        # Создаем новую пару токенов
        return self.create_tokens_for_user(user)

    async def update_user_profile(
        self,
        db: AsyncSession,
        user_id: UUID,
        full_name: Optional[str] = None,
        current_password: Optional[str] = None,
        new_password: Optional[str] = None,
    ) -> bool:
        """
        Обновляет профиль пользователя.

        Args:
            db: Сессия базы данных
            user_id: ID пользователя
            full_name: Новое полное имя
            current_password: Текущий пароль
            new_password: Новый пароль

        Returns:
            True если обновление успешно
        """
        user = await self.get_user_by_id(db, user_id)
        if not user:
            return False

        # Обновляем имя если предоставлено
        if full_name is not None:
            user.full_name = full_name

        # Обновляем пароль если предоставлено
        if new_password and current_password:
            if not self.verify_password(current_password, user.password_hash):
                return False
            user.password_hash = self.get_password_hash(new_password)

        await db.commit()
        return True

    async def deactivate_user(self, db: AsyncSession, user_id: UUID) -> bool:
        """
        Деактивирует пользователя.

        Args:
            db: Сессия базы данных
            user_id: ID пользователя

        Returns:
            True если деактивация успешна
        """
        user = await self.get_user_by_id(db, user_id)
        if not user:
            return False

        user.is_active = False
        await db.commit()
        return True

    async def create_password_reset_token(
        self, db: AsyncSession, email: str
    ) -> Optional[str]:
        """Создаёт токен сброса пароля. Возвращает plain-text токен или None если user не найден."""
        from ..models.password_reset import PasswordResetToken

        user = await self.get_user_by_email(db, email)
        if not user or not user.is_active:
            return None

        # Инвалидировать все существующие токены пользователя
        await db.execute(
            delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        )

        # Создать новый токен
        plain_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(plain_token.encode()).hexdigest()
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
        )

        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        db.add(reset_token)
        await db.commit()

        logger.info(f"Password reset token created for user_id={user.id}")
        return plain_token

    async def validate_and_reset_password(
        self, db: AsyncSession, token: str, new_password: str
    ) -> tuple[bool, Optional[str]]:
        """Валидирует токен и устанавливает новый пароль.

        Returns:
            (success, user_email) — email нужен для отправки confirmation.
        """
        from ..models.password_reset import PasswordResetToken

        token_hash = hashlib.sha256(token.encode()).hexdigest()

        result = await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > datetime.now(timezone.utc),
            )
        )
        reset_token = result.scalar_one_or_none()

        if not reset_token:
            # OWASP timing-safety: выполнить dummy bcrypt hash чтобы время ответа
            # было сопоставимо со случаем валидного токена (который делает реальный hash)
            self.get_password_hash("dummy-password-for-timing-safety")
            logger.warning("Invalid/expired password reset token attempted")
            return False, None

        # Обновить пароль
        user = await self.get_user_by_id(db, reset_token.user_id)
        if not user or not user.is_active:
            return False, None

        user.password_hash = self.get_password_hash(new_password)

        # Удалить ВСЕ токены этого пользователя (инвалидация, включая текущий)
        await db.execute(
            delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        )

        # OWASP: инвалидировать ВСЕ активные сессии пользователя (Option A)
        # Все JWT выпущенные до этого момента будут считаться невалидными
        user.tokens_invalidated_at = datetime.now(timezone.utc)

        await db.commit()

        logger.info(
            f"Password reset completed for user_id={user.id}, all sessions invalidated"
        )
        return True, user.email


# Глобальный экземпляр сервиса
auth_service = AuthService()


async def get_current_user_from_token(token: str) -> Optional[User]:
    """
    Retrieves the current user from a JWT token (e.g. for WebSocket auth).

    Creates a new database session scope to fetch the user.
    """
    from ..core.database import AsyncSessionLocal

    payload = auth_service.verify_token(token, "access")
    if not payload:
        return None

    user_id_str = payload.get("sub")
    if not user_id_str:
        return None

    try:
        user_id = UUID(user_id_str)
    except ValueError:
        return None

    async with AsyncSessionLocal() as session:
        user = await auth_service.get_user_by_id(session, user_id)
        if user and user.is_active:
            return user

    return None
