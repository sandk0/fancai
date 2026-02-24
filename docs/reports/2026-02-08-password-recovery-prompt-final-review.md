# Final Pre-Production Review: Password Recovery Prompt v2.0

**Date:** 2026-02-08
**Reviewer:** Claude Opus 4.6 (automated deep review)
**Prompt:** `docs/prompts/2026-02-08-password-recovery-implementation.md`
**Verdict:** **NOT READY** -- 3 critical bugs, 5 significant issues, 8 minor issues

---

## Executive Summary

The prompt is well-structured with thorough OWASP coverage and consistent code patterns. However, **3 critical bugs** would cause runtime errors if the prompt is executed as-is. Additionally, several significant issues around Celery integration, Docker configuration, and frontend consistency need addressing before production deployment.

---

## 1. CRITICAL (P0) -- Must Fix Before Execution

### 1.1. `async_session_maker` does not exist in `core/database.py`

**Section 16, line ~807 of prompt:**
```python
from app.core.database import async_session_maker
```

**Actual codebase (`backend/app/core/database.py:78`):**
```python
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)
```

The session factory is named `AsyncSessionLocal`, not `async_session_maker`. This import will cause an `ImportError` at runtime when the Celery cleanup task executes.

**Fix:** Replace `async_session_maker` with `AsyncSessionLocal` in the Celery cleanup task:
```python
from app.core.database import AsyncSessionLocal
# ...
async with AsyncSessionLocal() as db:
```

This is consistent with how other Celery tasks access the database -- see `backend/app/tasks/cleanup_tasks.py:10`:
```python
from app.core.database import AsyncSessionLocal
```

---

### 1.2. Celery app file path is wrong

**Section 16, line ~787 of prompt:**
> **В `backend/app/celery_app.py`** (или где определен beat schedule):

**Actual location:** `backend/app/core/celery_app.py`

There is no file `backend/app/celery_app.py`. The Celery app is defined at `backend/app/core/celery_app.py` and the beat schedule is configured within `celery_app.conf.update(...)` at line 52 of that file.

**Fix:** All references to `celery_app.py` should point to `backend/app/core/celery_app.py`.

---

### 1.3. Celery beat_schedule syntax incompatible with existing pattern

**Prompt proposes (section 16):**
```python
app.conf.beat_schedule['cleanup-expired-reset-tokens'] = {
    'task': 'app.tasks.cleanup_expired_reset_tokens',
    'schedule': crontab(hour=3, minute=0),
}
```

**Actual pattern in `backend/app/core/celery_app.py:52-70`:**
```python
celery_app.conf.update(
    # ...
    beat_schedule={
        "close-abandoned-reading-sessions": {
            "task": "app.tasks.close_abandoned_sessions",
            "schedule": 1800.0,  # seconds, not crontab
            "options": {"queue": "light", "priority": 2},
        },
        # ...
    },
)
```

Two problems:
1. **`crontab` is not imported** anywhere in `celery_app.py`. Using it without adding `from celery.schedules import crontab` will fail.
2. **Assignment style** `app.conf.beat_schedule['key'] = ...` may or may not work depending on timing. Since `beat_schedule` is set during `conf.update()`, appending to it later requires the dict to already exist. It is safer to add the new entry inside the existing `beat_schedule` dict.

**Fix:** Add the new entry inside the existing `beat_schedule` dict in `celery_app.conf.update()`, and either use `crontab` (with the import) or use seconds like other tasks:
```python
# Option A: seconds (consistent with project)
"cleanup-expired-reset-tokens": {
    "task": "app.tasks.cleanup_expired_reset_tokens",
    "schedule": 86400.0,  # 24 hours
    "options": {"queue": "light", "priority": 1},
},

# Option B: crontab (requires adding: from celery.schedules import crontab)
"cleanup-expired-reset-tokens": {
    "task": "app.tasks.cleanup_expired_reset_tokens",
    "schedule": crontab(hour=3, minute=0),
    "options": {"queue": "light", "priority": 1},
},
```

---

## 2. SIGNIFICANT (P1) -- Should Fix

### 2.1. Celery task file and registration missing from file lists

**Section 16** describes creating a Celery task file (`backend/app/tasks/auth_tasks.py`), but:

1. **Not listed in "Full list of created files"** (section end table) -- the table has 11 files, missing `auth_tasks.py`.
2. **`backend/app/tasks/__init__.py` update not mentioned** -- all other task files are imported and re-exported in `__init__.py`. The new task needs to be added there.
3. **Celery `include` list** in `backend/app/core/celery_app.py:15` only includes `["app.core.tasks", "app.tasks.reading_sessions_tasks"]`. While `autodiscover_tasks()` at line 78 should pick it up, explicitly adding or verifying this would be safer.

**Fix:** Add `backend/app/tasks/auth_tasks.py` to the created files table, add update of `backend/app/tasks/__init__.py` to the modified files table, and verify autodiscovery works.

---

### 2.2. `PasswordStrengthIndicator` uses `>= 8` threshold, not 12

**Prompt says (section 11):**
> Использовать `PasswordStrengthIndicator` из `@/components/Auth/PasswordStrength` (переиспользовать!)

**Actual code (`frontend/src/components/Auth/PasswordStrength.tsx:21`):**
```typescript
minLength: password.length >= 8,
```

The `PasswordStrengthIndicator` shows a green checkmark for "minLength" at 8 characters, but `ResetPasswordPage` (and the backend) requires 12. Users will see a "met" indicator at 8 characters but form submission will fail at < 12 characters. This creates a confusing UX.

**Fix:** Either:
- (A) Make `PasswordStrengthIndicator` accept a configurable `minLength` prop (recommended)
- (B) Note in the prompt that `PasswordStrengthIndicator` must be updated to use 12 instead of 8
- (C) Note in the prompt that `RegistrationForm.tsx` zod schema also needs updating from `.min(8)` to `.min(12)` for consistency with backend

**Note:** This is also an existing bug in `RegistrationForm.tsx:28` which uses `.min(8)` while the backend requires 12. The prompt correctly identifies this discrepancy but only fixes it for `ResetPasswordPage`, leaving `RegistrationForm` inconsistent.

---

### 2.3. `.env.example` file does not exist

**Section 17:** "Add to `docker-compose.lite.yml` and `.env.example`"

There is no `.env.example` file in the repository. The prompt references a file that doesn't exist.

**Fix:** Either create `.env.example` (add to created files list) or remove the reference and document the env vars elsewhere (e.g., in the `docker-compose.lite.yml` comments, which is where they'd need to be added to the `backend` and `celery-worker` services' `environment` blocks).

---

### 2.4. Docker `docker-compose.lite.yml` missing EMAIL_* env vars in both backend AND celery-worker

**Section 17** lists env vars to add but doesn't specify which Docker services need them. The `docker-compose.lite.yml` has separate environment blocks for:
- `backend` (line 94-120) -- needs EMAIL_* vars for the API endpoints
- `celery-worker` (line 158-175) -- needs EMAIL_* vars if cleanup task reads settings
- `celery-beat` (line 212-215) -- may need them for beat schedule

**Fix:** Explicitly state that `EMAIL_ENABLED`, `YANDEX_POSTBOX_ACCESS_KEY`, `YANDEX_POSTBOX_SECRET_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, and `PASSWORD_RESET_BASE_URL` must be added to the `backend` service's environment block. The celery-worker does NOT need email vars (the cleanup task only deletes tokens, doesn't send email).

---

### 2.5. `asyncio.ensure_future()` exception handling in fire-and-forget email

**Section 6.1:**
```python
asyncio.ensure_future(
    email_svc.send_password_reset_email(body.email, reset_url)
)
```

While exceptions inside `send_email()` are caught (try/except in `YandexPostboxProvider`), in Python 3.10+ asyncio will log a warning about "Task exception was never retrieved" if the outer coroutine fails for an unexpected reason. This is a production log noise issue.

**Fix:** Wrap in a proper error-handling wrapper:
```python
async def _safe_send_email():
    try:
        await email_svc.send_password_reset_email(body.email, reset_url)
    except Exception:
        pass  # Already logged inside provider

asyncio.ensure_future(_safe_send_email())
```

Or alternatively, add a `task.add_done_callback()` pattern.

---

## 3. MODERATE (P2) -- Recommended Improvements

### 3.1. Missing security logging for password reset events

The prompt has logging for email send success/failure but misses important security audit events:
- No log for "password reset requested for email X" (even anonymized)
- No log for "password reset completed for user_id X"
- No log for "invalid/expired token attempted"

These are critical for security monitoring and incident response.

**Recommendation:** Add structured logging in `AuthService.create_password_reset_token()` and `validate_and_reset_password()`.

---

### 3.2. Rate limiting is per-IP only, not per-IP+email combination

**Section 8 / RATE_LIMIT_PRESETS:**

The `rate_limit` decorator (`backend/app/middleware/rate_limit.py:217-226`) uses either `user_id` (if authenticated) or `client.host` (IP) as the rate limit key. For unauthenticated endpoints like forgot-password, this means:
- Rate limited per IP: An attacker from a single IP can only send 3 requests/min
- But an attacker with multiple IPs (botnet) can enumerate emails faster

This is acceptable for v1 but worth noting.

**Recommendation:** Consider adding an email-based rate limit (e.g., max 3 resets per email per hour) as a defense-in-depth measure.

---

### 3.3. No account lockout after N failed password resets

OWASP recommends considering temporary account lockout after repeated failed reset attempts. The prompt does not implement this.

**Risk:** Low -- the token is 256-bit with SHA-256 hashing, making brute-force infeasible. The rate limit (3/min) provides additional protection.

**Recommendation:** Low priority, document as future enhancement.

---

### 3.4. CSRF considerations

The forgot-password and reset-password endpoints accept POST without CSRF tokens. This is consistent with the existing auth endpoints (login, register) which also lack CSRF protection, relying instead on SameSite cookies and CORS.

Since forgot-password always returns 200 (no state change visible to attacker) and reset-password requires a secret token from email, CSRF risk is minimal.

**Assessment:** Acceptable. No action needed.

---

### 3.5. `asyncio` imported inside function body

**Section 6.1:**
```python
async def forgot_password(...):
    import asyncio
    # ...
```

Existing code in `auth.py` imports at the top of the file (e.g., `from datetime import datetime, timezone`). The `validate_password_strength` is also imported inside the function body (matching existing pattern at line 94 and 348), so this is semi-consistent.

**Recommendation:** Import `asyncio` at the top of the file for consistency with stdlib convention, while noting that lazy imports for app-specific modules (like `validate_password_strength`) follow the existing pattern.

---

## 4. MINOR (P3) -- Nice to Have

### 4.1. `new_password` field validation in `ResetPasswordRequest` schema

The prompt defines:
```python
class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
```

No Pydantic-level validation on `new_password` (min_length, max_length). The validation is done later via `validate_password_strength()`. This is consistent with `UserRegistrationRequest` which also has no Pydantic constraints on the password field, but adding `min_length=12` at the Pydantic level would provide earlier validation and better OpenAPI documentation.

---

### 4.2. Token entropy comment accuracy

**Section 2, Requirement 4:**
> `secrets.token_urlsafe(32)` (256 бит энтропии)

`secrets.token_urlsafe(32)` generates 32 random bytes (256 bits) and then base64url-encodes them to a ~43 character string. The entropy statement is correct.

**Assessment:** No issue.

---

### 4.3. `used_at` column in model is defined but never set

The `PasswordResetToken` model has `used_at: Mapped[datetime | None]` but the `validate_and_reset_password()` method deletes all tokens instead of marking them as used:
```python
await db.execute(
    delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
)
```

The `used_at` field is never populated. It's harmless but adds dead schema weight.

**Recommendation:** Either remove `used_at` or set it before deletion (useful for audit trail if tokens aren't immediately deleted). Since the prompt's Celery cleanup task deletes tokens `expires_at < cutoff`, having `used_at` could be useful if the deletion strategy changes.

---

### 4.4. Missing `options` in beat_schedule entry

Existing beat_schedule entries include `"options": {"queue": "light", "priority": N}`. The prompt's cleanup task entry omits this.

**Recommendation:** Add `"options": {"queue": "light", "priority": 1}` for consistency.

---

### 4.5. Prompt references `core/validation.py:305` -- actual line is 305

**Section "Важные контекстные замечания":**
> Backend требует 12 символов (не 8!) -- см. `core/validation.py:305`

The actual line with `if len(password) < 12:` is at line 305. **CORRECT.**

---

### 4.6. Two Celery app files exist in the project

The codebase has two Celery configuration files:
- `backend/app/core/celery_app.py` -- the active one (used by all tasks, docker-compose commands)
- `backend/app/core/celery_config.py` -- appears to be legacy/alternative configuration

Tasks import from `app.core.celery_app`, and docker-compose uses `celery -A app.core.celery_app`. The prompt should reference only `backend/app/core/celery_app.py`.

---

### 4.7. `register.criteria.min_length` i18n key says "8 characters"

If `PasswordStrengthIndicator` is reused on `ResetPasswordPage`, the i18n key `register.criteria.min_length` likely displays "Minimum 8 characters" (or the Russian equivalent). This would be misleading on the reset page where 12 is required.

**Recommendation:** If reusing the component, either parameterize the label or create separate i18n keys.

---

### 4.8. Email template hardcoded in Russian only

The prompt acknowledges this:
> TODO: Определять язык по user preference (сейчас hardcoded русский)

Given the bilingual i18n setup (ru + en), this should be noted as a follow-up task.

---

## 5. Positive Findings (What the Prompt Gets Right)

1. **OWASP compliance** is thorough: constant-time responses, timing-safe token validation, token hashing, single-use tokens, 30-min expiry, rate limiting
2. **Model pattern** matches existing models perfectly (UUID PK, ForeignKey with CASCADE, mapped_column style, lazy="raise")
3. **Provider abstraction** (Protocol + factory) is well-designed and extensible
4. **DI pattern** (lru_cache + dep function) is consistent with existing container.py
5. **Line number references** are accurate (LoginPage:137, validation.py:305, reading_session.py:65)
6. **Implementation order** is logically correct (model -> migration -> config -> service -> routes -> frontend)
7. **Frontend routing** correctly identifies that new pages should be public (outside AuthGuard), eagerly loaded, and placed alongside login/register routes
8. **i18n key structure** avoids collisions with existing keys
9. **Response schema pattern** matches existing auth.py schemas

---

## 6. Summary Table

| # | Severity | Category | Issue | Section |
|---|----------|----------|-------|---------|
| 1 | **P0 CRITICAL** | Codebase | `async_session_maker` does not exist, should be `AsyncSessionLocal` | 16 |
| 2 | **P0 CRITICAL** | Codebase | Celery app path `backend/app/celery_app.py` does not exist | 16 |
| 3 | **P0 CRITICAL** | Codebase | `crontab` not imported, beat_schedule syntax incompatible | 16 |
| 4 | **P1** | Completeness | `auth_tasks.py` missing from file lists, `tasks/__init__.py` update missing | 16/end |
| 5 | **P1** | Frontend | `PasswordStrengthIndicator` shows green at 8 chars, requires 12 | 11 |
| 6 | **P1** | Docker | `.env.example` referenced but doesn't exist | 17 |
| 7 | **P1** | Docker | Missing specification of which docker services need EMAIL_* vars | 17 |
| 8 | **P1** | Production | `asyncio.ensure_future` exception handling gap | 6.1 |
| 9 | **P2** | Security | Missing security audit logging for reset events | 4 |
| 10 | **P2** | Security | Rate limiting per-IP only, no per-email limiting | 7 |
| 11 | **P2** | Security | No account lockout after N failed resets | -- |
| 12 | **P2** | Code style | `asyncio` imported inside function body | 6.1 |
| 13 | **P2** | Completeness | `used_at` column defined but never set | 1.1 |
| 14 | **P3** | Consistency | Missing `options` in beat_schedule entry | 16 |
| 15 | **P3** | Frontend | `register.criteria.min_length` i18n says 8, needs 12 | 11 |
| 16 | **P3** | Completeness | No Pydantic validation on `new_password` field | 6.2 |

---

## 7. Recommendation

**Do not execute the prompt as-is.** Fix the 3 P0 critical issues first:

1. Replace `async_session_maker` with `AsyncSessionLocal` in the Celery cleanup task
2. Change the Celery app path from `backend/app/celery_app.py` to `backend/app/core/celery_app.py`
3. Fix the beat_schedule syntax to match existing pattern (add `crontab` import or use seconds)

After fixing P0 issues, the P1 items should be addressed before execution. P2/P3 items can be handled as follow-up tasks.

After these fixes are applied, the prompt would be **production-ready**.
