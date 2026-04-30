# Security Policy — fancai

Этот документ описывает, как сообщать об уязвимостях, какие текущие меры
безопасности применяются в проекте и где искать детали.

> Это policy. Историческая хроника прошлых security-инцидентов и фиксов —
> в `docs/reports/2025-10-30-p0-security-fixes.md` (архивный отчёт).

---

## 1. Сообщить об уязвимости

**Не открывайте публичные GitHub issue с деталями уязвимости.** Вместо этого:

| Канал                    | Адресат                       | Что сообщать                                                    |
| ------------------------ | ----------------------------- | --------------------------------------------------------------- |
| Email                    | `sandkme@gmail.com`           | Описание уязвимости, шаги воспроизведения, потенциальный impact |
| GitHub Security Advisory | приватный draft в репозитории | Если предпочитаете GitHub UI                                    |

В отчёте укажите:

1. **Класс уязвимости** (XSS, CSRF, SQL injection, broken auth, SSRF, RCE, …)
2. **Шаги воспроизведения** — точная последовательность, желательно как `curl`
   или скрипт
3. **Затронутый компонент** — endpoint, файл, версия
4. **Predicted impact** — какие данные / какие пользователи под риском
5. **PoC** (proof-of-concept) — если безопасно приложить

### Disclosure timeline

| Шаг                                   | Срок                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| Acknowledgement отчёта                | в течение 72 часов                                           |
| Триаж + первичная оценка severity     | в течение 7 дней                                             |
| Фикс в production (для CRITICAL/HIGH) | целевой срок 14 дней                                         |
| Public disclosure                     | по согласованию с reporter, обычно после развёртывания фикса |

Severity-классификация — по [CVSS v3.1](https://www.first.org/cvss/calculator/3.1).

---

## 2. Scope

### В scope

- Production: <https://fancai.ru> и поддомены
- API: `https://fancai.ru/api/*`
- Service Worker и PWA-функциональность
- Все компоненты в репозитории `sandk0/fancai` (backend, frontend, infra)
- CI/CD конфиги и зависимости (supply-chain attacks)

### Вне scope

- DDoS / volumetric attacks
- Social engineering пользователей или maintainer'ов
- Физический доступ к серверу
- Issue в third-party-зависимостях, не эксплуатируемые в нашем коде
- Open-redirect / clickjacking без бизнес-impact
- Self-XSS, требующий участия пользователя
- Rate limiting bypass без дальнейшего impact (CSRF/auth уже защищают)
- Best-practice issue без эксплоита (отсутствие header X-…, weak SSL ciphers
  без exploit chain — лучше открыть обычный issue)

---

## 3. Текущие меры

### 3.1. Authentication / Authorization

- JWT (PyJWT) с короткоживущим access-token (30 мин) и refresh-token (7 дней)
- Token blacklist в Redis для безопасного logout
- Bcrypt (cost factor 12) для паролей; min 12 символов, проверка на common
  passwords и sequential digits
- Rate limiting: auth endpoints 3/min, registration 2/min
- Subscription / tier check — серверный, не доверяет клиенту

### 3.2. Transport / Headers

- Auto-HTTPS через Caddy 2.11 (Let's Encrypt + HTTP/3)
- HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- CSP без `unsafe-eval` и без `unsafe-inline` в `script-src`
- `block-all-mixed-content` директива
- `font-src` включает `blob:` и `data:` для epub.js book fonts
  (изменено в коммите `7a373d7f`)

### 3.3. CSRF

- Double Submit Cookie pattern (`X-CSRF-Token` header + `csrf_token` cookie)
- Cryptographically secure tokens (32 bytes via `secrets`)
- SameSite=Strict для cookie

### 3.4. Input validation

- Pydantic v2 на всех endpoint'ах (тип + length + format)
- DOMPurify (frontend) для пользовательского HTML в reader
- `defusedxml` для XML-парсинга книжных метаданных
- maxLength constraints на string-поля LLM-схем (защита от broken JSON)

### 3.5. Secrets management

- `.env*` файлы в `.gitignore`, никогда не коммитятся
- Production secrets — через VPS environment, не в Dockerfile / compose
- Generation скрипт: `backend/scripts/generate-production-secrets.sh`
- GitHub Secret Scanning enabled (alerts отслеживаются)

### 3.6. Dependencies

- Pin'нутые версии в `requirements.txt` и `package.json`
- `npm overrides` для известных уязвимых под-зависимостей
  (`brace-expansion`, `cross-spawn`, `serialize-javascript`)
- Hawk SDK для error tracking (производственные ошибки → privately)
- Semgrep для статического анализа в pre-commit (опционально)

### 3.7. Backend resilience

- Circuit breaker для OpenRouter API (раздельный для LLM и image generation)
- Tenacity exponential backoff с jitter для всех external вызовов
- Все AI-вызовы через единый client (`backend/app/core/openrouter_client.py`)
  — никаких произвольных HTTP-вызовов на внешние API из бизнес-логики

---

## 4. Известные ограничения

- **Нет 2FA / MFA** для пользовательских аккаунтов (на дорожной карте, не в
  текущем milestone)
- **Нет audit log** для admin-действий — only structured app logs через Loguru
- **Browser-side rate limit** доверяется клиенту для UX (visual feedback);
  серверный — единственная защита
- **Тестирование** только на iPhone 15 Pro для iOS/PWA — fleet coverage
  ограничен (см. `.planning/PROJECT.md → Constraints`)

---

## 5. Hall of Fame

_Пока пусто. Reporter'ы будут указаны здесь после ответственного раскрытия
(с разрешения)._

---

## 6. Полезные ссылки

- [`backend/SECURITY.md`](../backend/SECURITY.md) — backend-specific security
  notes (если расходится с этим документом — этот документ источник истины)
- [`docs/reports/2025-10-30-p0-security-fixes.md`](reports/2025-10-30-p0-security-fixes.md)
  — архивный отчёт о P0-1 / P0-6 / P0-7 фиксах (2025-10-30)
- [`backend/app/middleware/security_headers.py`](../backend/app/middleware/security_headers.py)
  — точная реализация CSP / HSTS / Frame-Options
- [`backend/app/core/csrf.py`](../backend/app/core/csrf.py) — CSRF реализация
- [`backend/app/middleware/rate_limit.py`](../backend/app/middleware/rate_limit.py)
  — rate-limit пресеты
- [`backend/app/core/validation.py`](../backend/app/core/validation.py) —
  password policy, input validators

---

_Last updated: 2026-04-30. Maintainer: sandk0._
