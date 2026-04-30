# Security (placeholder)

Эта директория зарезервирована под дополнительные security-отчёты, аудиты
и подспецификации. На текущий момент (2026-04-30) она пуста.

## Куда идти

| Что нужно                               | Где это                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Security policy + how-to-report**     | [`../SECURITY.md`](../SECURITY.md)                                                                     |
| Backend-specific security notes         | [`../../backend/SECURITY.md`](../../backend/SECURITY.md)                                               |
| Архивный отчёт о P0-фиксах (2025-10-30) | [`../reports/2025-10-30-p0-security-fixes.md`](../reports/2025-10-30-p0-security-fixes.md)             |
| Реализация security headers             | [`../../backend/app/middleware/security_headers.py`](../../backend/app/middleware/security_headers.py) |
| CSRF                                    | [`../../backend/app/core/csrf.py`](../../backend/app/core/csrf.py)                                     |
| Rate limiting                           | [`../../backend/app/middleware/rate_limit.py`](../../backend/app/middleware/rate_limit.py)             |
| Password / input validation             | [`../../backend/app/core/validation.py`](../../backend/app/core/validation.py)                         |

## Конвенция

При появлении новых security-отчётов:

- **Snapshot отчёт** (постфактум о конкретном фиксе/аудите) → в `../reports/`
  с datestamp
- **Live policy / threat model / control matrix** → может появиться здесь

---

_Last updated: 2026-04-30._
