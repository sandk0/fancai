# Ревью промпта: Password Recovery Implementation

**Дата:** 2026-02-08
**Scope:** Анализ `docs/prompts/2026-02-08-password-recovery-implementation.md` на ошибки, несоответствия с кодовой базой и упущенные нюансы
**Автор:** Claude Code

## Executive Summary

Промпт качественный и покрывает ~85% нужных аспектов. Выявлено **7 ошибок/несоответствий** с реальным кодом, **5 упущенных нюансов** и **3 потенциальные проблемы**. Критических проблем — 3 (могут сломать сборку или миграцию).

## Findings

### Категория 1: Ошибки и несоответствия с кодовой базой

#### 1.1. CRITICAL: Минимальная длина пароля — 12, а не 8

**Промпт (секция 9, строка 387):** `"Zod-валидация: те же правила что в RegistrationForm.tsx (8+ символов...)"`
**Промпт (секция 11, строки 429, 465):** `"password_placeholder": "Минимум 8 символов"`

**Реальность:** Backend `core/validation.py:305` требует **12 символов**:
```python
if len(password) < 12:
    return False, "Password must be at least 12 characters long"
```

Frontend `RegistrationForm.tsx:28` проверяет `.min(8)`, но backend отвергнет любой пароль < 12 символов. **В промпте нужно указать 12 символов для ResetPasswordPage** (чтобы не было рассинхрона backend/frontend).

#### 1.2. CRITICAL: `delete()` не импортирован в `auth_service.py`

**Промпт (секция 4):** Использует `delete(PasswordResetToken).where(...)` в `create_password_reset_token` и `validate_and_reset_password`.

**Реальность:** В `auth_service.py:13` импортируется только `select`:
```python
from sqlalchemy import select
```
`delete` **не импортирован**. Промпт должен явно указать: добавить `from sqlalchemy import select, delete` в существующие импорты.

#### 1.3. CRITICAL: Модель `PasswordResetToken` не зарегистрирована в Alembic env.py

**Промпт:** Указывает создать `models/password_reset.py` и запустить `alembic revision --autogenerate`.

**Реальность:** `alembic/env.py` импортирует каждую модель явно (строки 14-20):
```python
from app.models.book import Book, ReadingProgress
from app.models.chapter import Chapter
from app.models.image import GeneratedImage
from app.models.user import Subscription, User
from app.models.reading_session import ReadingSession
```

Без добавления `from app.models.password_reset import PasswordResetToken` в `env.py`, Alembic **не обнаружит** новую таблицу и `--autogenerate` создаст пустую миграцию.

Аналогично, новую модель нужно добавить в `models/__init__.py` (строка 7+).

#### 1.4. App.tsx: Pages не используют `React.lazy()` — используют `lazy` из react

**Промпт (секция 10):**
```tsx
const ForgotPasswordPage = React.lazy(() => import('./pages/ForgotPasswordPage'));
```

**Реальность:** `App.tsx:1` импортирует `lazy` напрямую:
```tsx
import { useEffect, lazy, Suspense } from 'react';
```
И все страницы используют `lazy(...)` без `React.` префикса:
```tsx
const BookPage = lazy(() => import('@/pages/BookPage'));
```
Также путь использует `@/pages/`, а не `./pages/`.

#### 1.5. ForgotPasswordPage/ResetPasswordPage: не указан Suspense-контекст

**Промпт:** Просто добавить `<Route>` элементы.

**Реальность:** Lazy-loaded страницы внутри `Layout` уже обёрнуты в `<Suspense>` (App.tsx:114), но `/login` и `/register` — **eagerly loaded** (App.tsx:24-26) и находятся **вне** Layout/Suspense (строки 90-91).

Новые страницы forgot-password/reset-password — это публичные страницы (не требуют auth), их нужно добавить рядом с login/register. Но тогда **lazy-load не имеет смысла** (они маленькие и нет Suspense wrapper-а). Промпт должен указать: **eager import** (как LoginPage) или добавить Suspense wrapper.

#### 1.6. Response schemas: промпт определяет schemas inline в routers

**Промпт (секция 5):** Определяет `ForgotPasswordResponse`, `ResetPasswordResponse` прямо в `routers/auth.py`.

**Реальность:** Существующий паттерн — request schemas в routers (см. `UserRegistrationRequest` в auth.py:42), но **response schemas** вынесены в `schemas/responses/auth.py`. Промпт правильно упоминает это в п.7 порядка реализации, но в коде секции 5 определяет response-классы в роутере. Нужна **консистентность**: response schemas в `schemas/responses/auth.py`, request schemas в роутере.

#### 1.7. `IAuthService` Protocol в container.py не обновлён

**Промпт:** Добавляет два метода в `AuthService`, но не упоминает обновление `IAuthService` Protocol в `container.py:92-126`.

**Реальность:** `IAuthService` определяет interface для auth service. Без добавления `create_password_reset_token` и `validate_and_reset_password` в Protocol — несоответствие interface-а реализации. Нарушение не сломает runtime (Protocol-ы runtime_checkable, но не проверяются при DI), но это технический долг.

### Категория 2: Упущенные нюансы

#### 2.1. `ON DELETE CASCADE` для ForeignKey

**Промпт:** `ForeignKey("users.id")` без `ondelete`.

**Реальность:** Другие модели с FK на users используют `ondelete="CASCADE"` (см. `entity.py:48`). При удалении/деактивации пользователя reset-токены должны удаляться каскадно. Рекомендация: `ForeignKey("users.id", ondelete="CASCADE")`.

#### 2.2. Timing attack на reset-password endpoint

**Промпт:** Хорошо описывает constant-time response для `forgot-password`, но **не** для `reset-password`.

**OWASP:** Endpoint `reset-password` тоже уязвим к timing attack — SHA-256 lookup по невалидному токену будет быстрее, чем lookup + password hash. Злоумышленник может определить, является ли токен валидным, по времени ответа. Рекомендация: добавить constant-time сравнение или artificial delay при невалидном токене.

#### 2.3. Email-отправка в background (не в request)

**Промпт:** Email отправляется синхронно в request handler (`await email_svc.send_password_reset_email`).

**Проблема:** Если Yandex Postbox отвечает медленно (таймаут до 30 сек), пользователь ждёт. Это также нарушает OWASP constant-time — запрос для несуществующего email будет быстрее (нет email отправки), что раскрывает user enumeration.

**Рекомендация:** Отправлять email через Celery task (проект уже использует Celery), или добавить `asyncio.sleep()` delay для выравнивания timing. Минимум — указать `asyncio.ensure_future()` для fire-and-forget async.

#### 2.4. Не упомянута `__init__.py` для пакета `services/email/`

**Промпт:** Создаёт `services/email/provider.py`, `yandex_postbox.py`, `log_provider.py`, `email_service.py`.

**Упущено:** Нужен `services/email/__init__.py` для Python-пакета. Без него импорты `from ..services.email.email_service import EmailService` не сработают.

#### 2.5. Не упомянута очистка просроченных токенов (cron/periodic task)

**Промпт:** Токены с `expires_at` в прошлом остаются в БД навечно.

**Рекомендация:** Celery periodic task (beat) для очистки: `DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`. Или хотя бы упомянуть в промпте как TODO.

### Категория 3: Стилистические несоответствия и мелочи

#### 3.1. Pydantic v2: `env=` deprecated в `Field()`

**Промпт (секция 2):** `EMAIL_ENABLED: bool = Field(default=False, env="EMAIL_ENABLED")`

**Реальность:** В `config.py` некоторые поля используют `env=`, но при `pydantic_settings` с `case_sensitive = True` — `env=` в `Field()` **избыточно**, потому что название переменной окружения берётся из имени атрибута. В Pydantic v2 `env=` заменён на `validation_alias`. Лучше убрать `env=` для консистентности с простыми полями (как `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30`).

#### 3.2. Hardcoded base URL для production

**Промпт:** `PASSWORD_RESET_BASE_URL: str = "https://fancai.ru/reset-password"`

**Проблема:** В dev-окружении ссылки будут вести на production. Лучше: `Field(default="http://localhost:5173/reset-password", env="PASSWORD_RESET_BASE_URL")` и переопределить через env в production.

#### 3.3. Email subject language

**Промпт:** `subject = "Сброс пароля — fancai"` (hardcoded Russian).

**Нюанс:** Проект двуязычный (ru/en). Для international-пользователей стоит передавать language-preference в `send_password_reset_email`. Минимум — упомянуть как TODO.

## Recommendations

| # | Рекомендация | Приоритет | Сложность |
|---|-------------|-----------|-----------|
| 1 | Исправить минимальную длину пароля: 12, не 8 (секции 9, 11) | P0 | Низкая |
| 2 | Добавить `from sqlalchemy import delete` в imports auth_service.py | P0 | Низкая |
| 3 | Добавить import PasswordResetToken в `alembic/env.py` и `models/__init__.py` | P0 | Низкая |
| 4 | Исправить lazy→eager import для ForgotPasswordPage/ResetPasswordPage в App.tsx | P1 | Низкая |
| 5 | Добавить `services/email/__init__.py` в план создания файлов | P1 | Низкая |
| 6 | Добавить `ondelete="CASCADE"` для FK на users.id | P1 | Низкая |
| 7 | Вынести ForgotPasswordResponse/ResetPasswordResponse в `schemas/responses/auth.py` | P1 | Низкая |
| 8 | Добавить email-отправку через fire-and-forget для OWASP timing-safety | P1 | Средняя |
| 9 | Исправить `React.lazy` на `lazy` и `./pages/` на `@/pages/` | P2 | Низкая |
| 10 | Исправить default base URL на localhost для dev | P2 | Низкая |
| 11 | Добавить периодическую очистку просроченных токенов | P2 | Средняя |
| 12 | Обновить `IAuthService` Protocol в container.py | P3 | Низкая |
| 13 | Убрать избыточный `env=` в Field() для Settings | P3 | Низкая |

## Next Steps

1. Обновить промпт с исправлениями P0 и P1
2. Добавить раздел с explicit-файлами для создания (включая `__init__.py`)
3. Рассмотреть Celery-отправку email как альтернативу await в endpoint
