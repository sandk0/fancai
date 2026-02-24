# Промпт: Реализация восстановления пароля (Password Recovery)

**Модель:** Claude Opus 4.6
**Цель:** Полная реализация функциональности восстановления пароля — backend (FastAPI) + frontend (React 19) + email-сервис (Yandex Cloud Postbox) с provider abstraction для будущего расширения
**Формат:** Скопировать текст ниже (от --- до ---) и вставить в Claude Code
**Версия:** 3.1 (после двух итераций ревью + OWASP веб-проверка — все замечания исправлены)

---

Реализуй полную функциональность восстановления пароля для проекта fancai. Это новая функциональность — сейчас в проекте есть только мёртвая ссылка "Забыли пароль?" на странице входа (`frontend/src/pages/LoginPage.tsx:137`), которая ведёт на несуществующий маршрут `/forgot-password`. Ни backend endpoints, ни frontend страниц, ни email-сервиса не существует.

## Требования безопасности (OWASP Forgot Password Cheat Sheet)

Строго следуй рекомендациям OWASP:

1. **Постоянный ответ (constant-time):** Endpoint `POST /auth/forgot-password` ВСЕГДА возвращает 200 OK с сообщением "Если email зарегистрирован, письмо отправлено" — независимо от того, существует ли пользователь. Это предотвращает user enumeration.
2. **Timing-safety для forgot-password:** Email отправлять через `asyncio.ensure_future()` (fire-and-forget), чтобы время ответа было одинаковым для существующих и несуществующих email. Без этого синхронная отправка email (~1-5 сек) позволяет злоумышленнику определить, зарегистрирован ли email, по разнице времени ответа.
3. **Timing-safety для reset-password:** При невалидном токене выполнять dummy `bcrypt.hashpw()` перед возвратом ошибки, чтобы время ответа было сопоставимо со случаем валидного токена (который делает реальный hash). Это предотвращает timing-based token enumeration.
4. **Криптографически стойкий токен:** Генерируй через `secrets.token_urlsafe(32)` (256 бит энтропии).
5. **Хранение токена:** В БД хранить ТОЛЬКО SHA-256 хеш токена (`hashlib.sha256(token.encode()).hexdigest()`), а не сам токен. Пользователю отправлять plain-text токен в ссылке.
6. **Одноразовость:** Токен используется один раз — после успешного сброса пароля удалить из БД.
7. **Срок действия:** 30 минут (`PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = 30`).
8. **Rate limiting:** `forgot-password` и `reset-password` — максимум 3 запроса в минуту. Добавить пресет `"password_reset": {"max_requests": 3, "window_seconds": 60}` в `RATE_LIMIT_PRESETS`.
9. **Инвалидация:** При смене пароля инвалидировать ВСЕ существующие reset-токены пользователя.
10. **Referrer-Policy: noreferrer:** Страница ResetPasswordPage содержит токен в URL query params. Добавить `<meta name="referrer" content="no-referrer">` чтобы токен не утёк через Referer-заголовок при переходе по внешним ссылкам.
11. **Инвалидация сессий:** После успешного сброса пароля инвалидировать ВСЕ активные JWT-сессии пользователя (добавить все токены в blacklist). Если злоумышленник имеет украденную сессию — она должна быть разорвана.
12. **Confirmation email:** После успешного сброса отправить пользователю уведомление "Ваш пароль был изменён". Это защита от незамеченной компрометации аккаунта.

## 1. Backend: Миграция БД

### 1.1. Модель `PasswordResetToken`

Создать файл `backend/app/models/password_reset.py`:

```python
"""Модель токена сброса пароля."""

import uuid as uuid_module
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base


class PasswordResetToken(Base):
    """Токен для сброса пароля (OWASP-compliant)."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid_module.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4
    )
    user_id: Mapped[uuid_module.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )  # SHA-256 hex digest
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", lazy="raise")
```

**Примечание:** Поле `used_at` сохранено для потенциального аудита. В текущей реализации `validate_and_reset_password()` удаляет все токены при успешном сбросе, поэтому `used_at` не устанавливается. Если в будущем стратегия удаления изменится (soft-delete), поле будет полезно.

**ВАЖНО:** `ForeignKey("users.id", ondelete="CASCADE")` — каскадное удаление при деактивации пользователя (паттерн из `reading_session.py:65`, `push_subscription.py:50`, `reading_goal.py:124`).

### 1.2. Регистрация модели

**`backend/app/models/__init__.py`** — добавить импорт (после строки 20, рядом с другими моделями):
```python
from .password_reset import PasswordResetToken
```
И добавить `"PasswordResetToken"` в `__all__`.

**`backend/alembic/env.py`** — добавить импорт (после строки 20, рядом с `ReadingSession`):
```python
from app.models.password_reset import PasswordResetToken  # noqa: F401
```

Без этих двух шагов `alembic revision --autogenerate` создаст **пустую миграцию** — Alembic не обнаружит новую таблицу.

### 1.3. Генерация миграции

```bash
cd backend && alembic revision --autogenerate -m "add password_reset_tokens table"
```

Проверь сгенерированную миграцию — должна содержать `create_table('password_reset_tokens', ...)`.

## 2. Backend: Конфигурация (`core/config.py`)

Добавить настройки в класс `Settings` (после блока `VAPID_SUBJECT`, перед `CORS_ORIGINS`):

```python
# Password Reset
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30
PASSWORD_RESET_BASE_URL: str = "http://localhost:5173/reset-password"  # Override via env: PASSWORD_RESET_BASE_URL=https://fancai.ru/reset-password

# Email (Yandex Cloud Postbox — AWS SES v2 compatible)
EMAIL_ENABLED: bool = False
EMAIL_FROM: str = "noreply@fancai.ru"
EMAIL_FROM_NAME: str = "fancai"
YANDEX_POSTBOX_ACCESS_KEY: Optional[str] = None
YANDEX_POSTBOX_SECRET_KEY: Optional[str] = None
YANDEX_POSTBOX_ENDPOINT: str = "https://postbox.cloud.yandex.net"
YANDEX_POSTBOX_REGION: str = "ru-central1"
```

**Примечания:**
- `PASSWORD_RESET_BASE_URL` по умолчанию `localhost:5173` — для dev-окружения. В production переопределяется через `.env`: `PASSWORD_RESET_BASE_URL=https://fancai.ru/reset-password`.
- Простые поля без `Field()` — консистентно с `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES`, `VAPID_SUBJECT` и другими простыми настройками. `pydantic_settings` с `case_sensitive = True` автоматически маппит имена атрибутов на переменные окружения.

## 3. Backend: Email Service с Provider Abstraction

### 3.0. Python-пакет `services/email/`

Создать файл `backend/app/services/email/__init__.py` (пустой или с re-exports):
```python
"""Email service с provider abstraction для fancai."""
```

Без `__init__.py` Python не распознает `services/email/` как пакет, и импорты `from ..services.email.email_service import EmailService` не сработают.

### 3.1. Provider Protocol (`backend/app/services/email/provider.py`)

```python
"""Protocol для email-провайдеров."""

from typing import Protocol, Optional


class EmailProvider(Protocol):
    """Protocol для отправки email через разных провайдеров."""

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Отправляет email. Возвращает True при успехе."""
        ...
```

### 3.2. Yandex Cloud Postbox Provider (`backend/app/services/email/yandex_postbox.py`)

Yandex Cloud Postbox совместим с AWS SES v2 API. Использовать `aioboto3`:

```python
"""Yandex Cloud Postbox provider (AWS SES v2 compatible)."""

import logging
from typing import Optional

import aioboto3
from botocore.config import Config as BotoConfig

from ...core.config import settings

logger = logging.getLogger(__name__)


class YandexPostboxProvider:
    """Yandex Cloud Postbox — SES v2-compatible email provider."""

    def __init__(self) -> None:
        self._session = aioboto3.Session()

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Отправляет email через Yandex Cloud Postbox."""
        boto_config = BotoConfig(
            region_name=settings.YANDEX_POSTBOX_REGION,
            retries={"max_attempts": 3, "mode": "adaptive"},
        )
        try:
            async with self._session.client(
                "sesv2",
                endpoint_url=settings.YANDEX_POSTBOX_ENDPOINT,
                aws_access_key_id=settings.YANDEX_POSTBOX_ACCESS_KEY,
                aws_secret_access_key=settings.YANDEX_POSTBOX_SECRET_KEY,
                config=boto_config,
            ) as client:
                body: dict = {"Html": {"Data": html_body}}
                if text_body:
                    body["Text"] = {"Data": text_body}

                await client.send_email(
                    FromEmailAddress=f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>",
                    Destination={"ToAddresses": [to_email]},
                    Content={
                        "Simple": {
                            "Subject": {"Data": subject},
                            "Body": body,
                        }
                    },
                )
                logger.info(f"Email sent to {to_email}: {subject}")
                return True
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False
```

### 3.3. Log-only Provider для development (`backend/app/services/email/log_provider.py`)

```python
"""Log-only email provider для development."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class LogEmailProvider:
    """Провайдер для разработки — только логирует email."""

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Логирует email вместо отправки."""
        logger.info(f"[DEV EMAIL] To: {to_email} | Subject: {subject}")
        logger.debug(f"[DEV EMAIL] Body: {html_body[:500]}")
        return True
```

### 3.4. Email Service (`backend/app/services/email/email_service.py`)

```python
"""Email service — фасад для отправки email через абстрактного провайдера."""

import logging
from typing import Optional

from .provider import EmailProvider

logger = logging.getLogger(__name__)


class EmailService:
    """Фасад для отправки email через абстрактного провайдера."""

    def __init__(self, provider: EmailProvider) -> None:
        self._provider = provider

    async def send_password_reset_email(self, to_email: str, reset_url: str) -> bool:
        """Отправляет email для сброса пароля."""
        # TODO: Определять язык по user preference (сейчас hardcoded русский)
        subject = "Сброс пароля — fancai"
        html_body = self._render_reset_template(reset_url)
        text_body = f"Для сброса пароля перейдите по ссылке: {reset_url}\nСсылка действительна 30 минут."
        return await self._provider.send_email(to_email, subject, html_body, text_body)

    async def send_password_changed_confirmation(self, to_email: str) -> bool:
        """OWASP: отправляет уведомление об успешной смене пароля."""
        subject = "Пароль изменён — fancai"
        html_body = self._render_password_changed_template()
        text_body = "Ваш пароль в fancai был успешно изменён. Если вы не делали этого, немедленно свяжитесь с поддержкой."
        return await self._provider.send_email(to_email, subject, html_body, text_body)

    def _render_reset_template(self, reset_url: str) -> str:
        """Рендерит HTML email шаблон для сброса пароля."""
        # Python f-string шаблон (НЕ Jinja2 — для 2 шаблонов это избыточно)
        # Inline CSS, table layout для совместимости с email-клиентами
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#18181b;font-size:24px;margin:0;">fancai</h1>
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:24px;padding-bottom:24px;">
              Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы установить новый пароль:
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="{reset_url}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:16px;font-weight:600;">
                Сбросить пароль
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#71717a;font-size:14px;line-height:20px;padding-bottom:16px;">
              Ссылка действительна 30 минут. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
            </td>
          </tr>
          <tr>
            <td style="color:#a1a1aa;font-size:12px;border-top:1px solid #e4e4e7;padding-top:16px;">
              Если кнопка не работает, скопируйте ссылку: {reset_url}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    def _render_password_changed_template(self) -> str:
        """Рендерит HTML шаблон уведомления о смене пароля (OWASP confirmation)."""
        return """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#18181b;font-size:24px;margin:0;">fancai</h1>
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:24px;padding-bottom:24px;">
              Ваш пароль был успешно изменён.
            </td>
          </tr>
          <tr>
            <td style="color:#ef4444;font-size:14px;line-height:20px;padding-bottom:16px;font-weight:600;">
              Если вы не меняли пароль, немедленно свяжитесь с поддержкой — ваш аккаунт мог быть скомпрометирован.
            </td>
          </tr>
          <tr>
            <td style="color:#a1a1aa;font-size:12px;border-top:1px solid #e4e4e7;padding-top:16px;">
              Это автоматическое уведомление от fancai.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
```

### 3.5. Фабрика и DI (`backend/app/core/container.py`)

**Добавить фабрику и dep-функцию** (после `get_token_blacklist` / `get_token_blacklist_dep`):

```python
@lru_cache()
def get_email_service() -> "EmailService":
    """Фабричная функция для EmailService."""
    from ..services.email.email_service import EmailService
    if settings.EMAIL_ENABLED:
        from ..services.email.yandex_postbox import YandexPostboxProvider
        provider = YandexPostboxProvider()
    else:
        from ..services.email.log_provider import LogEmailProvider
        provider = LogEmailProvider()
    return EmailService(provider)

def get_email_service_dep() -> "EmailService":
    """FastAPI Dependency для EmailService."""
    return get_email_service()
```

**Обновить `DependencyContainer.clear_caches()`** — добавить строку:
```python
get_email_service.cache_clear()
```

**Обновить `create_test_overrides()`** — добавить строку:
```python
get_email_service_dep: lambda: DependencyContainer.get(get_email_service),
```

**Обновить `IAuthService` Protocol** — добавить два метода (после `authenticate_user`):
```python
async def create_password_reset_token(
    self, db: AsyncSession, email: str
) -> Optional[str]:
    """Создаёт токен сброса пароля."""
    ...

async def validate_and_reset_password(
    self, db: AsyncSession, token: str, new_password: str
) -> tuple[bool, Optional[str]]:
    """Валидирует токен и устанавливает новый пароль. Возвращает (success, user_email)."""
    ...
```

## 4. Backend: Методы в AuthService (`services/auth_service.py`)

**ВАЖНО:** Сначала обнови импорты — добавить `delete` к существующему импорту:
```python
# Было:
from sqlalchemy import select
# Стало:
from sqlalchemy import select, delete
```

Также добавить логгер (если его ещё нет) в начало файла:
```python
import logging
logger = logging.getLogger(__name__)
```

Затем добавить два метода в класс `AuthService`:

### 4.1. `create_password_reset_token(db, email) -> Optional[str]`

```python
async def create_password_reset_token(self, db: AsyncSession, email: str) -> Optional[str]:
    """Создаёт токен сброса пароля. Возвращает plain-text токен или None если user не найден."""
    user = await self.get_user_by_email(db, email)
    if not user or not user.is_active:
        return None

    # Инвалидировать все существующие токены пользователя
    from ..models.password_reset import PasswordResetToken
    await db.execute(
        delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
    )

    # Создать новый токен
    import secrets, hashlib
    plain_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(plain_token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)

    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(reset_token)
    await db.commit()

    logger.info(f"Password reset token created for user_id={user.id}")
    return plain_token
```

### 4.2. `validate_and_reset_password(db, token, new_password) -> Tuple[bool, Optional[str]]`

```python
async def validate_and_reset_password(
    self, db: AsyncSession, token: str, new_password: str
) -> tuple[bool, Optional[str]]:
    """Валидирует токен и устанавливает новый пароль.

    Returns:
        (success, user_email) — email нужен для отправки confirmation.
    """
    import hashlib
    from ..models.password_reset import PasswordResetToken

    token_hash = hashlib.sha256(token.encode()).hexdigest()

    result = await db.execute(
        select(PasswordResetToken)
        .where(
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

    await db.commit()

    # OWASP: инвалидировать ВСЕ активные сессии пользователя
    # Если злоумышленник имеет украденную сессию — она должна быть разорвана
    # Реализация зависит от token_blacklist: добавить user_id в "global invalidation"
    # или инкрементировать user.token_version (если такое поле есть)
    # Минимальная реализация: пометить user.tokens_invalidated_at = now()
    # и проверять в JWT middleware что token.iat > user.tokens_invalidated_at

    logger.info(f"Password reset completed for user_id={user.id}, all sessions invalidated")
    return True, user.email
```

## 5. Backend: Response Schemas (`schemas/responses/auth.py`)

Добавить в **`backend/app/schemas/responses/auth.py`** (после `AccountDeactivationResponse`, перед `__all__`):

```python
class ForgotPasswordResponse(BaseModel):
    """
    Response для запроса сброса пароля.

    Используется в POST /api/v1/auth/forgot-password.
    Всегда возвращает одно сообщение (OWASP: no user enumeration).
    """

    message: str = Field(
        default="If this email is registered, a password reset link has been sent",
        description="Constant message regardless of email existence",
    )


class ResetPasswordResponse(BaseModel):
    """
    Response для успешного сброса пароля.

    Используется в POST /api/v1/auth/reset-password.
    """

    message: str = Field(
        default="Password has been reset successfully",
        description="Success message",
    )
```

Обновить `__all__` — добавить:
```python
"ForgotPasswordResponse",
"ResetPasswordResponse",
```

**Также обновить `backend/app/schemas/responses/__init__.py`:**

В блок импорта из `.auth` (строки 582-588) добавить:
```python
from .auth import (  # noqa: E402
    LogoutResponse,
    CurrentUserResponse,
    ProfileUpdateResponse,
    AccountDeactivationResponse,
    ForgotPasswordResponse,     # NEW
    ResetPasswordResponse,       # NEW
)
```

И в `__all__` (после `AccountDeactivationResponse`):
```python
"ForgotPasswordResponse",
"ResetPasswordResponse",
```

## 6. Backend: Endpoints (`routers/auth.py`)

Добавить два новых endpoint в существующий `routers/auth.py`.

**Импорты:** Добавить в существующие импорты из `schemas/responses/auth.py`:
```python
from ..schemas.responses.auth import (
    CurrentUserResponse,
    ProfileUpdateResponse,
    AccountDeactivationResponse,
    ForgotPasswordResponse,       # NEW
    ResetPasswordResponse,         # NEW
)
```

Добавить `asyncio` в stdlib imports (в начале файла, рядом с `from datetime import datetime, timezone`):
```python
import asyncio
import logging
```

Добавить импорт EmailService:
```python
from ..core.container import get_auth_service_dep, get_token_blacklist_dep, get_email_service_dep
```

### 6.1. `POST /auth/forgot-password`

```python
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
        # Если await, то запрос для несуществующего email будет быстрее (нет email),
        # что позволяет злоумышленнику определить существование аккаунта по timing
        _logger = logging.getLogger(__name__)

        async def _safe_send():
            try:
                await email_svc.send_password_reset_email(body.email, reset_url)
            except Exception as e:
                _logger.error(f"Failed to send password reset email: {e}")

        asyncio.ensure_future(_safe_send())

    return ForgotPasswordResponse()
```

### 6.2. `POST /auth/reset-password`

```python
class ResetPasswordRequest(BaseModel):
    """Запрос на установку нового пароля."""
    token: str
    new_password: str


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
    # Валидация нового пароля (12+ символов, uppercase, lowercase, digit, special)
    from ..core.validation import validate_password_strength
    is_valid, error_msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # validate_and_reset_password возвращает (success, user_email)
    success, user_email = await auth_svc.validate_and_reset_password(db, body.token, body.new_password)
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
```

## 7. Backend: Rate Limit Preset (`middleware/rate_limit.py`)

Добавить пресет в словарь `RATE_LIMIT_PRESETS`:

```python
"password_reset": {"max_requests": 3, "window_seconds": 60},
```

## 8. Backend: Зависимости (requirements)

Добавить в `backend/requirements.txt`:
```
aioboto3>=13.0.0
```

`boto3` и `botocore` установятся как зависимости `aioboto3`.

## 9. Frontend: API методы (`api/auth.ts`)

Добавить в объект `authAPI`:

```typescript
async requestPasswordReset(email: string): Promise<{ message: string }> {
    return apiClient.post('/auth/forgot-password', { email });
},

async resetPassword(token: string, new_password: string): Promise<{ message: string }> {
    return apiClient.post('/auth/reset-password', { token, new_password });
},
```

## 10. Frontend: Страница запроса сброса (`pages/ForgotPasswordPage.tsx`)

Создать `frontend/src/pages/ForgotPasswordPage.tsx`:

- Форма с одним полем email (react-hook-form + zod, как в LoginPage)
- Кнопка "Отправить ссылку для сброса"
- После отправки: показать success-сообщение "Проверьте вашу почту" (НЕ навигировать)
- Ссылка "Вернуться к входу" -> `/login`
- Визуальный стиль: идентичен LoginPage (centered layout, branding header, Input/Button компоненты)
- Использовать иконку `Mail` из `lucide-react`
- i18n: ключи `forgot_password.title`, `forgot_password.description`, `forgot_password.email_label`, `forgot_password.submit`, `forgot_password.success_title`, `forgot_password.success_description`, `forgot_password.back_to_login`

## 11. Frontend: Страница сброса пароля (`pages/ResetPasswordPage.tsx`)

Создать `frontend/src/pages/ResetPasswordPage.tsx`:

- **OWASP Referrer-Policy:** Добавить `<meta name="referrer" content="no-referrer">` через `PageMeta` или `<Helmet>`. Токен находится в URL query params — без этого он утечёт через Referer-заголовок при любом переходе по внешней ссылке. Также добавить `rel="noreferrer"` на все внешние `<a>` ссылки на странице.
- Извлечь `token` из URL query params: `new URLSearchParams(window.location.search).get('token')`
- Если `token` отсутствует — показать ошибку и ссылку на `/forgot-password`
- Форма: новый пароль + подтверждение пароля (react-hook-form + zod)
- Использовать `PasswordStrengthIndicator` из `@/components/Auth/PasswordStrength`, **но с исправлением:** текущая версия показывает зелёную галочку для `minLength` при 8 символах (`PasswordStrength.tsx:21`). Для `ResetPasswordPage` нужно **либо** (A) добавить prop `minLength` в компонент и передать `12`, **либо** (B) обновить хардкод с 8 на 12 (это затронет и `RegistrationForm`, что правильно — backend уже требует 12). Рекомендуется вариант (B) — исправить глобально.
- Toggle видимости пароля (как в RegistrationForm)
- **Zod-валидация: минимум 12 символов** (НЕ 8! Backend `core/validation.py:305` требует 12), uppercase, lowercase, digit, special char, confirm match. **Также обновить** zod-схему в `RegistrationForm.tsx:28` с `.min(8)` на `.min(12)` для консистентности с backend.
- При успехе: показать "Пароль успешно изменён" + кнопка "Войти" -> `/login`
- При ошибке (expired/invalid token): показать "Ссылка недействительна или истекла" + кнопка "Запросить новую ссылку" -> `/forgot-password`
- Визуальный стиль: идентичен LoginPage

## 12. Frontend: Маршруты (`App.tsx`)

Новые страницы forgot-password и reset-password — публичные (не требуют auth), аналогично LoginPage и RegisterPage. Они **НЕ lazy-loaded** (маленькие и находятся вне Layout/Suspense блока).

**Добавить eager imports** (строки 24-27, рядом с LoginPage/RegisterPage):
```tsx
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
```

**Добавить маршруты** рядом с `/login` и `/register` (строки 90-91):
```tsx
<Route path="/login" element={<LoginPage />} />
<Route path="/register" element={<RegisterPage />} />
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

**НЕ использовать `lazy()`** для этих страниц — LoginPage и RegisterPage тоже eagerly loaded (App.tsx:24-26), и все они находятся вне `<Suspense>` wrapper-а.

## 13. Frontend: Локализация

Добавить ключи в `frontend/src/locales/ru/translation.json` и `en/translation.json`:

**Русский:**
```json
"forgot_password": {
    "title": "Восстановление пароля",
    "description": "Введите email, указанный при регистрации. Мы отправим ссылку для сброса пароля.",
    "email_label": "Email",
    "submit": "Отправить ссылку",
    "submitting": "Отправка...",
    "success_title": "Письмо отправлено",
    "success_description": "Если этот email зарегистрирован, на него отправлена ссылка для сброса пароля. Проверьте папку «Спам», если письмо не пришло.",
    "back_to_login": "Вернуться к входу",
    "page_title": "Восстановление пароля",
    "page_description": "Восстановление пароля в fancai"
},
"reset_password": {
    "title": "Новый пароль",
    "description": "Придумайте новый надёжный пароль для вашего аккаунта.",
    "password_label": "Новый пароль",
    "password_placeholder": "Минимум 12 символов",
    "confirm_label": "Подтвердите пароль",
    "confirm_placeholder": "Повторите пароль",
    "submit": "Сохранить пароль",
    "submitting": "Сохранение...",
    "success_title": "Пароль изменён",
    "success_description": "Ваш пароль успешно изменён. Теперь вы можете войти с новым паролем.",
    "go_to_login": "Войти",
    "invalid_token_title": "Ссылка недействительна",
    "invalid_token_description": "Ссылка для сброса пароля истекла или уже была использована.",
    "request_new_link": "Запросить новую ссылку",
    "no_token_title": "Ссылка отсутствует",
    "no_token_description": "Для сброса пароля необходима ссылка из письма.",
    "page_title": "Сброс пароля",
    "page_description": "Установка нового пароля в fancai"
}
```

**Английский:**
```json
"forgot_password": {
    "title": "Reset Password",
    "description": "Enter the email you used to register. We'll send a password reset link.",
    "email_label": "Email",
    "submit": "Send Reset Link",
    "submitting": "Sending...",
    "success_title": "Email Sent",
    "success_description": "If this email is registered, a reset link has been sent. Check your spam folder if you don't see it.",
    "back_to_login": "Back to Login",
    "page_title": "Reset Password",
    "page_description": "Reset your fancai password"
},
"reset_password": {
    "title": "New Password",
    "description": "Create a new secure password for your account.",
    "password_label": "New Password",
    "password_placeholder": "Minimum 12 characters",
    "confirm_label": "Confirm Password",
    "confirm_placeholder": "Repeat password",
    "submit": "Save Password",
    "submitting": "Saving...",
    "success_title": "Password Changed",
    "success_description": "Your password has been changed successfully. You can now log in with your new password.",
    "go_to_login": "Log In",
    "invalid_token_title": "Link Invalid",
    "invalid_token_description": "This password reset link has expired or has already been used.",
    "request_new_link": "Request New Link",
    "no_token_title": "Link Missing",
    "no_token_description": "A password reset link from your email is required.",
    "page_title": "Reset Password",
    "page_description": "Set a new password for fancai"
}
```

## 14. Email шаблоны

Уже реализованы в секции 3.4 как inline Python f-string в `EmailService._render_reset_template()`.

Детали:
- **Reset email (HTML):** Table-based layout (совместимость с Gmail, Yandex Mail, Mail.ru), inline CSS, branding fancai, кнопка сброса, предупреждение о 30 минутах, fallback-ссылка текстом
- **Confirmation email (HTML):** Уведомление об успешной смене пароля с предупреждением о компрометации (OWASP)
- **Plain text:** Fallback для клиентов без HTML (оба шаблона)
- **Язык:** Русский (hardcoded). TODO: определять по user preference

## 15. Тесты

### Backend тесты (`backend/tests/test_password_reset.py`):

1. `test_forgot_password_existing_user` — проверить 200 OK и создание записи в password_reset_tokens
2. `test_forgot_password_nonexistent_email` — проверить 200 OK (OWASP: нет user enumeration)
3. `test_forgot_password_deactivated_user` — проверить 200 OK, токен НЕ создан
4. `test_reset_password_valid_token` — полный флоу: forgot -> reset -> проверить что пароль обновлён
5. `test_reset_password_expired_token` — проверить 400 Bad Request
6. `test_reset_password_used_token` — проверить 400 Bad Request (одноразовость)
7. `test_reset_password_weak_password` — проверить валидацию пароля (< 12 символов -> 400)
8. `test_multiple_reset_requests_invalidate_old_tokens` — проверить что старые токены удаляются
9. `test_rate_limit_forgot_password` — проверить rate limiting (>3 за минуту -> 429)
10. `test_reset_password_timing_safety` — проверить что невалидный токен не возвращает мгновенно (dummy hash)
11. `test_reset_password_sends_confirmation_email` — проверить что после успешного сброса отправляется confirmation email
12. `test_reset_password_invalidates_sessions` — проверить что после сброса существующие JWT-токены невалидны

### Frontend тесты:

1. `ForgotPasswordPage.test.tsx` — рендеринг формы, отправка, success state, ссылка на login
2. `ResetPasswordPage.test.tsx` — рендеринг, валидация пароля (12+ символов), отправка, error state, no-token state

## 16. Backend: Периодическая очистка просроченных токенов

Просроченные токены остаются в БД навечно без периодической очистки. Добавить Celery periodic task.

### 16.1. Beat schedule (`backend/app/core/celery_app.py`)

Добавить запись в существующий `beat_schedule` dict внутри `celery_app.conf.update()` (после `cleanup-stuck-processing-books`, строка ~69):

```python
# NEW: Password reset tokens cleanup (daily)
"cleanup-expired-reset-tokens": {
    "task": "cleanup_expired_reset_tokens",
    "schedule": 86400.0,  # 24 часа (24 * 60 * 60)
    "options": {
        "queue": "light",
        "priority": 1,
    },
},
```

### 16.2. Task (`backend/app/tasks/auth_tasks.py`)

Создать файл `backend/app/tasks/auth_tasks.py` (по аналогии с `cleanup_tasks.py`):

```python
"""Auth-related Celery tasks."""

from typing import Dict, Any
from datetime import datetime, timezone, timedelta

from sqlalchemy import delete

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.password_reset import PasswordResetToken
from app.tasks.common import run_async


@celery_app.task(name="cleanup_expired_reset_tokens")
def cleanup_expired_reset_tokens() -> Dict[str, Any]:
    """Удаляет просроченные токены сброса пароля (запускается ежедневно)."""
    try:
        result = run_async(_cleanup_expired_tokens_async())
        logger.info(
            "Cleanup expired reset tokens completed",
            deleted_count=result.get("deleted", 0),
        )
        return result
    except Exception as e:
        logger.error("Error cleaning up expired reset tokens", error=str(e))
        return {"status": "failed", "error": str(e), "deleted": 0}


async def _cleanup_expired_tokens_async() -> Dict[str, Any]:
    """Асинхронная функция очистки просроченных токенов."""
    async with AsyncSessionLocal() as db:
        # Удалить токены, которые просрочены более 24 часов назад
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        result = await db.execute(
            delete(PasswordResetToken).where(
                PasswordResetToken.expires_at < cutoff
            )
        )
        await db.commit()

        return {
            "status": "completed",
            "deleted": result.rowcount,
            "cutoff_date": cutoff.isoformat(),
        }
```

### 16.3. Регистрация task (`backend/app/tasks/__init__.py`)

Добавить импорт (после `from .cleanup_tasks import ...`):
```python
from .auth_tasks import (
    cleanup_expired_reset_tokens,
    _cleanup_expired_tokens_async,
)
```

И добавить в `__all__`:
```python
"cleanup_expired_reset_tokens",
"_cleanup_expired_tokens_async",
```

## 17. Docker: переменные окружения

Добавить переменные в `docker-compose.lite.yml` в секцию `environment` сервиса **`backend`** (строки 94-120):

```yaml
# Email (Yandex Cloud Postbox)
- EMAIL_ENABLED=true
- EMAIL_FROM=noreply@fancai.ru
- EMAIL_FROM_NAME=fancai
- YANDEX_POSTBOX_ACCESS_KEY=${YANDEX_POSTBOX_ACCESS_KEY}
- YANDEX_POSTBOX_SECRET_KEY=${YANDEX_POSTBOX_SECRET_KEY}
- PASSWORD_RESET_BASE_URL=https://fancai.ru/reset-password
```

**Только сервис `backend`** нуждается в EMAIL_* переменных. `celery-worker` и `celery-beat` **не** нуждаются — cleanup task только удаляет токены из БД, не отправляет email.

## 18. Порядок реализации

1. **Модель + регистрация** (`models/password_reset.py` + `models/__init__.py` + `alembic/env.py`)
2. **Миграция** (`alembic revision --autogenerate`)
3. **Конфигурация** (`core/config.py` — настройки email и reset)
4. **Email `__init__.py`** (`services/email/__init__.py` — пустой пакет)
5. **Email provider abstraction** (`services/email/provider.py`, `yandex_postbox.py`, `log_provider.py`)
6. **Email service** (`services/email/email_service.py` — фасад + шаблоны)
7. **DI** (`core/container.py` — фабрика, dep, IAuthService Protocol, clear_caches, test_overrides)
8. **AuthService imports** (`services/auth_service.py` — добавить `delete` в imports)
9. **AuthService методы** (`services/auth_service.py` — create_token, validate_and_reset)
10. **Response Schemas** (`schemas/responses/auth.py` + `schemas/responses/__init__.py`)
11. **Rate limit preset** (`middleware/rate_limit.py` — добавить "password_reset")
12. **Endpoints** (`routers/auth.py` — forgot-password, reset-password)
13. **Backend тесты** (`tests/test_password_reset.py`)
14. **Celery cleanup task** (периодическая очистка токенов)
15. **Frontend API** (`api/auth.ts` — два новых метода)
16. **Локализация** (`locales/ru/translation.json`, `locales/en/translation.json`)
17. **ForgotPasswordPage** (`pages/ForgotPasswordPage.tsx`)
18. **ResetPasswordPage** (`pages/ResetPasswordPage.tsx`)
19. **Маршруты** (`App.tsx` — eager import + Route)
20. **Frontend тесты**
21. **Docker env** (`.env.example`, `docker-compose.lite.yml`)

## 19. Provider Abstraction — будущее расширение

Текущая архитектура спроектирована так, чтобы добавление нового провайдера (например, Resend для международного рынка) занимало ~30 минут:

1. Создать `services/email/resend_provider.py` (реализовать Protocol `EmailProvider`)
2. Добавить настройки `RESEND_API_KEY` в `config.py`
3. Обновить фабрику в `container.py` (выбор провайдера по конфигу)

Для smart routing по домену (`.ru` -> Yandex, остальные -> Resend):

```python
class SmartEmailRouter:
    def __init__(self, yandex: YandexPostboxProvider, resend: ResendProvider):
        self._yandex = yandex
        self._resend = resend
        self._ru_domains = {"yandex.ru", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "rambler.ru"}

    async def send_email(self, to_email: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
        domain = to_email.split("@")[1].lower()
        provider = self._yandex if domain in self._ru_domains else self._resend
        return await provider.send_email(to_email, subject, html_body, text_body)
```

Это НЕ реализовывать сейчас — только заложить архитектуру (Protocol + фабрика).

## Полный список создаваемых файлов

| # | Файл | Тип |
|---|------|-----|
| 1 | `backend/app/models/password_reset.py` | Новый |
| 2 | `backend/app/services/email/__init__.py` | Новый |
| 3 | `backend/app/services/email/provider.py` | Новый |
| 4 | `backend/app/services/email/yandex_postbox.py` | Новый |
| 5 | `backend/app/services/email/log_provider.py` | Новый |
| 6 | `backend/app/services/email/email_service.py` | Новый |
| 7 | `backend/app/tasks/auth_tasks.py` | Новый |
| 8 | `backend/tests/test_password_reset.py` | Новый |
| 9 | `frontend/src/pages/ForgotPasswordPage.tsx` | Новый |
| 10 | `frontend/src/pages/ResetPasswordPage.tsx` | Новый |
| 11 | `frontend/src/pages/__tests__/ForgotPasswordPage.test.tsx` | Новый |
| 12 | `frontend/src/pages/__tests__/ResetPasswordPage.test.tsx` | Новый |

## Полный список модифицируемых файлов

| # | Файл | Изменение |
|---|------|-----------|
| 1 | `backend/app/models/__init__.py` | Добавить import PasswordResetToken + __all__ |
| 2 | `backend/alembic/env.py` | Добавить import PasswordResetToken |
| 3 | `backend/app/core/config.py` | Добавить настройки PASSWORD_RESET_* и EMAIL_* |
| 4 | `backend/app/core/container.py` | Добавить email_service factory/dep, IAuthService update, clear_caches, test_overrides |
| 5 | `backend/app/services/auth_service.py` | Добавить `delete` в imports + 2 новых метода |
| 6 | `backend/app/schemas/responses/auth.py` | Добавить ForgotPasswordResponse, ResetPasswordResponse |
| 7 | `backend/app/schemas/responses/__init__.py` | Добавить imports и __all__ entries |
| 8 | `backend/app/middleware/rate_limit.py` | Добавить "password_reset" preset |
| 9 | `backend/app/routers/auth.py` | Добавить 2 endpoints + imports |
| 10 | `backend/app/core/celery_app.py` | Добавить cleanup-expired-reset-tokens в beat_schedule |
| 11 | `backend/app/tasks/__init__.py` | Добавить import auth_tasks + __all__ |
| 12 | `backend/requirements.txt` | Добавить aioboto3 |
| 13 | `frontend/src/api/auth.ts` | Добавить 2 API метода |
| 14 | `frontend/src/App.tsx` | Добавить eager imports + routes |
| 15 | `frontend/src/locales/ru/translation.json` | Добавить forgot_password + reset_password ключи |
| 16 | `frontend/src/locales/en/translation.json` | Добавить forgot_password + reset_password ключи |
| 17 | `frontend/src/components/Auth/PasswordStrength.tsx` | Обновить minLength с 8 на 12 |
| 18 | `frontend/src/components/Auth/RegistrationForm.tsx` | Обновить zod .min(8) на .min(12) |

## Важные контекстные замечания

- **Стиль кода:** Следуй существующим паттернам: type hints, docstrings на русском, DI через `Depends()`, `selectinload` для relationships, `lazy="raise"` для моделей
- **Commit convention:** `feat(auth): add password recovery with Yandex Cloud Postbox`
- **НЕ трогать:** `EpubReader.tsx`, `routers/images.py`, `routers/reading_sessions.py` — эти файлы нестабильны
- **Реиспользовать:** `PasswordStrengthIndicator`, `Input`, `Button`, `PageMeta` компоненты из существующего кода
- **Валидация пароля:** Backend требует **12 символов** (не 8!) — см. `core/validation.py:305`. Frontend `ResetPasswordPage` должен валидировать `.min(12)`.
- **Перед завершением:** Запусти `cd backend && pytest -v` и `cd frontend && npm run build` для проверки

## Предварительные шаги (выполнить ДО запуска промпта)

1. Зарегистрироваться в Yandex Cloud и создать сервис-аккаунт со статическим ключом
2. Настроить DNS-записи для fancai.ru (DKIM, SPF, DMARC) в Yandex Cloud Postbox
3. Верифицировать домен fancai.ru в Yandex Cloud Postbox
4. Добавить переменные `YANDEX_POSTBOX_ACCESS_KEY` и `YANDEX_POSTBOX_SECRET_KEY` в `.env` на сервере
5. Установить `aioboto3` в backend: `pip install aioboto3`

---
