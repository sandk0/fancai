# Аудит рабочего окружения Claude Code — 28 февраля 2026

**Проект:** fancai — Fiction reader with AI illustrations and Entity Wiki
**Дата:** 2026-02-28
**Модель:** Claude Opus 4.6
**Scope:** Полное рабочее окружение Claude Code (конфигурация, скиллы, агенты, хуки, MCP, зависимости, CI/CD, документация, GSD)

---

## Executive Summary

Рабочее окружение Claude Code в проекте fancai находится на **продвинутом уровне** — используются кастомные агенты, хуки безопасности, MCP-серверы, скиллы, а с недавнего времени — GSD-фреймворк для структурированной разработки. Однако аудит выявил **4 критических проблемы**: неработающий хук форматирования (format_hook.sh — полный no-op), устаревшая модель в epub-reader агенте (claude-sonnet-4-5), баг GSD с тихим понижением quality-профиля до Sonnet (#695), и 4 CVE уязвимости в зависимостях (python-jose, cryptography, pillow, passlib). Основная рекомендация: исправить format_hook.sh, обновить модели агентов, переключить GSD на balanced-профиль, и приоритизировать обновление уязвимых пакетов.

---

## Методология

**Исследовано:**
- 20+ конфигурационных файлов проекта (.claude/, .planning/, CLAUDE.md)
- WebSearch: Claude Code best practices 2026, CVE базы, GSD issues/releases/community
- Context7: актуальные версии библиотек
- GitHub Issues: gsd-build/get-shit-done (95 открытых issues)
- Сравнение с предыдущим аудитом от 2026-02-06

**Источники:** NVD, Snyk, GitHub Advisory, PyPI, npm, Claude Code Docs, The New Stack, DeepWiki, Discord GSD

---

## 1. CLAUDE.md и иерархия инструкций

### Находки

Текущая структура:
```
CLAUDE.md (48 строк, корневой)
├── .claude/rules/auto-routing.md (автороутинг к superpowers)
├── .claude/rules/backend.md (paths: backend/**)
├── .claude/rules/frontend.md (paths: frontend/src/**)
├── .claude/rules/reader.md (paths: frontend/src/components/Reader/**, frontend/src/hooks/epub/**)
├── .claude/rules/gsd-russian.md (GSD на русском)
└── MEMORY.md (авто-память)
```

CLAUDE.md лаконичен (48 строк после оптимизации 05.02), правила корректно скопированы по путям.

### Проблемы

**1.1 Тройное дублирование фактов** (P3, S)

Три факта повторяются в CLAUDE.md, `frontend.md` и `reader.md`:
- "EpubReader.tsx — 84 changes"
- "8 fallback search strategies"
- "IndexedDB caches chapters offline"
- "CFI for position tracking"
- "Spoiler-free: entities show info only up to current reading chapter"

Правила скопированы по путям (загружаются контекстуально) — это частично оправдывает дублирование, но при обновлении числа "84 changes" потребуется править 3 файла.

**1.2 CLAUDE.md не упоминает reader.md** (P2, S)

Строка 47: `For iOS/theme/Reader rules: .claude/rules/frontend.md` — но `reader.md` (более специфичный для Reader) не указан.

**1.3 CLAUDE.md не упоминает GSD** (P2, S)

Нет упоминания `.planning/`, GSD-фреймворка или 6-фазного роадмапа. Новый контрибьютор не узнает о существовании структурированной системы планирования.

**1.4 MEMORY.md не знает о GSD** (P1, S)

MEMORY.md не содержит информации о:
- `.planning/` и 6-фазном роадмапе
- Текущей Phase 1 (Production Safety)
- Факте использования GSD (инициализация 27.02)

Будущая сессия, начинающая с MEMORY.md, не будет знать о плановой системе.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 1.1 | P2 | Добавить в CLAUDE.md строку: `For Reader/EPUB: .claude/rules/reader.md` | S |
| 1.2 | P1 | Добавить в MEMORY.md секцию "GSD Planning" с ключевой информацией | S |
| 1.3 | P2 | Добавить в CLAUDE.md строку: `GSD planning: .planning/ (ROADMAP.md, STATE.md)` | S |
| 1.4 | P3 | Унифицировать дублированные факты — оставить детали только в rules, в CLAUDE.md — ссылки | M |

---

## 2. Навыки (Skills)

### Находки

5 кастомных скиллов:
- `deploy/SKILL.md` — деплой на VPS (77.246.106.109)
- `db-migrate/SKILL.md` — Alembic миграции
- `tech-stack/SKILL.md` — справочник архитектуры
- `task-router/SKILL.md` — маршрутизация к superpowers
- `research-and-analysis/SKILL.md` — 4-фазное исследование

### Проблемы

**2.1 task-router и auto-routing.md — существенное дублирование** (P2, M)

Оба файла решают одну задачу — маршрутизацию задач к superpowers-скиллам. Содержат почти идентичные таблицы роутинга. Разница: `auto-routing.md` загружается **всегда** как правило, `task-router/SKILL.md` — по запросу. При одновременной активации оба будут в контексте — waste токенов.

Единственное уникальное в task-router: "Explore subagent" кейс и `/test-driven-development` маршрут, которых нет в auto-routing.md.

**2.2 Конфликт имён: local vs superpowers research-and-analysis** (P2, S)

`auto-routing.md` ссылается на `/research-and-analysis` (superpowers), но существует и локальный скилл `research-and-analysis/SKILL.md`. Неясно, какой активируется при роутинге.

**2.3 tech-stack не предупреждает о docker compose** (P3, S)

`tech-stack/SKILL.md` (строка 75) упоминает `docker-compose.lite.yml` без предупреждения о синтаксисе `docker compose` (без дефиса), которое есть в CLAUDE.md.

**2.4 Отсутствие disable-model-invocation** (P3, S)

По рекомендациям Claude Code 2026, скиллы с побочными эффектами (deploy, db-migrate) должны иметь `disable-model-invocation: true` в YAML frontmatter для предотвращения случайной автоактивации.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 2.1 | P2 | Удалить task-router/SKILL.md, перенести уникальный контент (Explore, TDD) в auto-routing.md | S |
| 2.2 | P2 | Решить: локальный research-and-analysis или superpowers. Удалить один из двух | S |
| 2.3 | P3 | Добавить предупреждение `docker compose` (без дефиса) в tech-stack/SKILL.md | S |
| 2.4 | P3 | Добавить `disable-model-invocation: true` в deploy и db-migrate скиллы | S |

---

## 3. Агенты (Custom Agents)

### Находки

3 кастомных агента:
- `fancai-orchestrator.md` — координатор (Tools: Task, Read, Grep, Glob)
- `epub-reader.md` — EPUB специалист (model: claude-sonnet-4-5-20250929)
- `gemini-imagen.md` — AI API специалист (model: inherit)

### Проблемы

**3.1 КРИТИЧНО: epub-reader закреплён на устаревшей модели** (P0, S)

Файл `.claude/agents/epub-reader.md`, строка 12:
```yaml
model: claude-sonnet-4-5-20250929
```
Текущая модель: `claude-sonnet-4-6`. Агент использует предыдущее поколение и не получает улучшений Sonnet 4.6. Это **единственный** агент с явным pin'ом модели.

**3.2 Отсутствие memory: project** (P2, M)

Ни один агент не использует поле `memory: project` (новая функция Claude Code 2026). Это позволяет агенту накапливать знания между сессиями в `.claude/agent-memory/<name>/`. Особенно ценно для epub-reader (CFI-специфика, reader-паттерны) и gemini-imagen (Gemini API quirks, cost patterns).

**3.3 Отсутствие entity-system агента** (P2, M)

Entity Wiki — основная фича проекта, но нет специализированного агента. Текущая делегация: gemini-imagen покрывает entity extraction, но entity_service.py, entity_deduplication_service.py, spoiler-free фильтрация, граф-модель — это отдельная доменная область.

**3.4 Оркестратор не может проверить git status** (P3, S)

`fancai-orchestrator.md` имеет только `Task, Read, Grep, Glob` — нет `Bash`. Не может выполнить `git status` или `alembic` для pre-delegation проверок.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 3.1 | P0 | Обновить epub-reader.md: `model: claude-sonnet-4-6` (или удалить pin для inherit) | S |
| 3.2 | P2 | Добавить `memory: project` в epub-reader и gemini-imagen агентов | S |
| 3.3 | P2 | Создать `entity-system.md` агент (entity_service.py, dedup, spoiler-free, граф) | M |
| 3.4 | P3 | Добавить `Bash` в tools оркестратора для git/alembic проверок | S |

---

## 4. Хуки (Hooks)

### Находки

Проект использует 5 из 14 доступных типов хуков в Claude Code (февраль 2026):
- `PreToolUse(Edit|Write)` → protect-files.sh
- `PreToolUse(Bash)` → block-dangerous.sh
- `PostToolUse(Edit|Write)` → format_hook.sh
- `PreCompact` → save-progress.sh (async)
- `Stop` → Verifier prompt

Новые типы хуков, доступные в 2026, но не используемые: `PostToolUseFailure`, `UserPromptSubmit`, `PermissionRequest`, `SubagentStart/SubagentStop`, `SessionEnd`.

### Проблемы

**4.1 КРИТИЧНО: format_hook.sh — полный no-op** (P0, M)

`.claude/hooks/format/format_hook.sh` ожидает путь файла через `$1`:
```bash
FILE="$1"
[ ! -f "$FILE" ] && exit 0   # Всегда выходит тут — $1 пуст
```

Но Claude Code `PostToolUse` хуки получают данные через **stdin как JSON**, не через аргументы. Скрипт должен парсить stdin через `jq -r '.tool_input.file_path // empty'` (как делают block-dangerous.sh и protect-files.sh). В результате **Prettier и Black никогда не вызываются** — хук является no-op с момента создания.

Дополнительно: в проекте нет `.prettierrc` — даже при исправлении хука Prettier будет работать с дефолтными настройками.

**4.2 block-dangerous.sh — пробелы в покрытии** (P2, S)

Не блокируются:
- `rm -rf /*` (wildcard-вариант — блокируется только `rm -rf /`)
- `rm -rf /root` (конкретные абсолютные пути кроме `/`, `~`, `.`)
- Mixed-case SQL: `Drop Table`, `drop Table` (только точные `drop table` и `DROP TABLE`)

settings.json `deny` создаёт второй слой для `dd`, `git push --force`, `git reset --hard`, но SQL-паттерны (`DROP TABLE`, `TRUNCATE`) защищены только хуком.

**4.3 SessionStart matcher: "compact" — неясное поведение** (P2, S)

`settings.json` (строка 87): `SessionStart` хук с `matcher: "compact"`. SessionStart не поддерживает контент-зависимую фильтрацию — matcher может не работать как задумано. Хук либо срабатывает всегда, либо никогда.

**4.4 save-progress.sh — нет ротации бэкапов** (P2, S)

53 patch-файла в `.claude/backups/`, из них 36 (68%) пустые (0 байт). Общий размер: ~900K. Без ротации директория будет расти бесконечно.

**4.5 Неиспользуемые ценные хук-события** (P2, M)

| Хук | Потенциальная ценность для fancai |
|-----|----------------------------------|
| `PostToolUseFailure` | Логирование ошибок Gemini API, entity service |
| `SessionEnd` | Автообновление STATE.md с итогами сессии |
| `SubagentStop` | Контроль качества работы GSD-агентов |

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 4.1 | P0 | Переписать format_hook.sh: парсить stdin через jq, добавить .prettierrc | M |
| 4.2 | P2 | Добавить case-insensitive grep (`-i`) для SQL-паттернов в block-dangerous.sh | S |
| 4.3 | P2 | Проверить реальное поведение SessionStart matcher; заменить на UserPromptSubmit если нужен post-compact | S |
| 4.4 | P2 | Добавить ротацию в save-progress.sh: `find .claude/backups/ -name "*.patch" -empty -delete && find .claude/backups/ -mtime +14 -delete` | S |
| 4.5 | P2 | Добавить PostToolUseFailure хук для логирования | M |

---

## 5. MCP-серверы

### Находки

Текущая конфигурация:
- `sequential-thinking` — disabled в .mcp.json, но enabled в settings.local.json (override)
- `postgres` — SSH-туннель через pg-tunnel-mcp.sh (скрипт работает, IP корректен)
- `ssh-manager` — disabled/enabled конфликт (аналогично)
- `context7` — плагин через superpowers marketplace (активен)
- `superpowers` — marketplace скиллов (активен)
- `playwright` — `{ "disabled": false }` в settings.json, но **не объявлен** в .mcp.json (stale reference)

### Проблемы

**5.1 Конфликт disabled/enabled между .mcp.json и settings.local.json** (P2, S)

`.mcp.json`: все 3 сервера `disabled: true`
`settings.local.json`: все 3 в `enabledMcpjsonServers`

По приоритетам Claude Code: `settings.local.json` **побеждает** — серверы активны. Это может быть намеренным (shared vs local конфигурация), но неочевидно.

**5.2 Stale reference на playwright** (P3, S)

`settings.json` содержит `"playwright": { "disabled": false }`, но playwright MCP не объявлен в `.mcp.json`. Запись не имеет эффекта.

**5.3 Отсутствие Redis MCP** (P1, M)

Проект активно использует Redis (Celery broker, кеширование). Официальный Redis MCP от Redis Inc. позволяет Claude инспектировать очереди, дебажить таски, читать кеш-ключи:
```json
{
  "redis": {
    "command": "uvx",
    "args": ["--from", "redis-mcp-server@latest", "redis-mcp-server", "--url", "redis://localhost:6379/0"]
  }
}
```

**5.4 Отсутствие GitHub MCP** (P2, S)

Проект использует `gh` CLI, но GitHub MCP предоставляет более структурированный доступ к PR, issues, CI status:
```bash
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

**5.5 Docker MCP Toolkit не активирован** (P2, S)

Docker Desktop 4.36+ содержит встроенный MCP Gateway с 100+ Docker-инструментами. Если Docker Desktop установлен — активируется автоматически. Полезно для управления `docker-compose.lite.yml` контейнерами.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 5.1 | P2 | Синхронизировать .mcp.json и settings.local.json — убрать конфликт disabled/enabled | S |
| 5.2 | P3 | Удалить stale playwright entry из settings.json | S |
| 5.3 | P1 | Добавить Redis MCP в .mcp.json | S |
| 5.4 | P2 | Добавить GitHub MCP | S |
| 5.5 | P2 | Проверить наличие Docker Desktop MCP Toolkit | S |

---

## 6. Настройки безопасности

### Находки

- Permissions allow: Bash (npm, pytest, python, git, docker, alembic), Read, Write, Edit, Glob, Grep
- Permissions deny: rm -rf, dd, git push --force, git reset --hard, Read/Write .env
- `settings.local.json` устанавливает `"defaultMode": "acceptEdits"` — автоодобрение всех Edit/Write
- WebFetch ограничен: github.com, anthropic.com, pypi.org, kb.daisy.org

### Проблемы

**6.1 Write(.env*) не в deny** (P1, S)

settings.json блокирует `Read(.env)` и `Read(.env.*)`, но не `Write(.env)` и `Write(.env.*)`. Claude может **создать** новый .env файл через Write tool, обойдя ограничение protect-files.sh (который блокирует Edit/Write через хук, но Write создание нового файла может не триггерить тот же путь).

**6.2 acceptEdits снижает защиту** (P3, S)

`settings.local.json` с `"defaultMode": "acceptEdits"` означает автоодобрение всех Edit/Write без подтверждения. В сочетании с protect-files.sh хуком это допустимо для productivity, но снижает friction на модификацию файлов.

**6.3 WebFetch домены слишком ограничены** (P2, S)

4 домена (github.com, anthropic.com, pypi.org, kb.daisy.org) не покрывают:
- npmjs.com (frontend зависимости)
- fastapi.tiangolo.com (FastAPI документация)
- docs.sqlalchemy.org (SQLAlchemy)
- redis.io (Redis)
- docs.celeryq.dev (Celery)
- ai.google.dev (Gemini/Imagen API)

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 6.1 | P1 | Добавить `Write(.env)` и `Write(.env.*)` в deny | S |
| 6.2 | P3 | Информационно — текущий setup осознанный выбор в пользу productivity | — |
| 6.3 | P2 | Расширить WebFetch домены: npmjs.com, fastapi.tiangolo.com, ai.google.dev, redis.io | S |

---

## 7. Зависимости — безопасность и актуальность

### Критические CVE (P0)

| Пакет | Версия | CVE | Описание | Действие |
|-------|--------|-----|----------|----------|
| **python-jose** | 3.5.0 | CVE-2025-61152 (CVSS 6.5) | `alg=none` bypass — JWT без подписи принимаются, обход аутентификации | Миграция на PyJWT |
| **python-jose** | 3.5.0 | CVE-2024-33663 (HIGH) | Algorithm confusion с OpenSSH ECDSA | Миграция на PyJWT |
| **cryptography** | 46.0.4 | CVE-2026-26007 | EC point subgroup validation — компрометация ECDSA/ECDH | Обновить до 46.0.5 |
| **pillow** | 12.1.0 | CVE-2026-25990 | Out-of-bounds write при загрузке PSD | Обновить до 12.1.1 |
| **passlib** | 1.7.4 | — | Unmaintained с 2020, сломан в Python 3.13+ | Миграция на pwdlib |

**python-jose → PyJWT миграция:**
```python
# До (python-jose)
from jose import jwt, JWTError
token = jwt.encode({"sub": user_id}, SECRET_KEY, algorithm="HS256")

# После (PyJWT)
import jwt
from jwt.exceptions import InvalidTokenError
token = jwt.encode({"sub": user_id}, SECRET_KEY, algorithm="HS256")
```
Референс: [FastAPI template PR #1203](https://github.com/fastapi/full-stack-fastapi-template/pull/1203)

**passlib → pwdlib миграция:**
```python
# До (passlib)
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# После (pwdlib)
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
password_hash = PasswordHash([BcryptHasher()])
```

### P1 — Важные обновления

| Пакет | Текущая | Последняя | Δ | Примечание |
|-------|---------|-----------|---|------------|
| FastAPI | 0.128.0 | **0.134.0** | +6 minor | ⚠️ Breaking: strict Content-Type validation по умолчанию |
| React | 19.0.0 | **19.2.4** | +2 minor | Без breaking changes |
| TypeScript | 5.7.2 | **5.9.x** | +2 minor | Новое: conditional return types, `import defer` |
| uvicorn | 0.40.0 | **0.41.0** | +1 minor | — |
| gunicorn | 25.0.1 | **25.1.0** | +1 minor | — |
| sentry-sdk | 2.51.0 | **2.53.0** | +2 patch | — |
| redis (py) | 7.1.0 | **7.2.1** | +1 minor | Dropped Python 3.9; Redis 8.x support |
| SQLAlchemy | 2.0.46 | **2.0.47** | +1 patch | Free-threaded Python support |
| DOMPurify | 3.3.0 | **3.3.1** | +1 patch | Prototype pollution hardening |
| tailwindcss | 4.1.18 | **4.2.1** | +1 minor | — |

**⚠️ FastAPI 0.134.0 breaking change:** Strict Content-Type checking теперь по умолчанию. API эндпоинты без explicit `Content-Type: application/json` сломаются. При обновлении: `FastAPI(strict_content_type=False)` или исправить клиенты.

### P2 — Nice-to-have

| Пакет | Текущая | Последняя | Примечание |
|-------|---------|-----------|------------|
| motion | 12.31.0 | 12.34.3 | +3 minor |
| i18next | 25.8.0 | 25.8.13 | patch |
| tenacity | 9.1.2 | 9.1.4 | 2 patches |
| TanStack Query | 5.90.12 | 5.90.21 | patch |
| google-genai | 1.61.0 | ~1.62.0 | 1 minor |

### Актуальные (не требуют обновления)

Pydantic 2.12.5, Celery 5.6.2, httpx 0.28.1, beautifulsoup4 4.14.3, zod 4.3.6, workbox 7.4.0, Vite 7.3.1 — на последних стабильных версиях.

**epub.js 0.3.93** — без обновлений 4 года. Существует форк `@intity/epub-js` (0.3.96), но миграция экономически нецелесообразна при 84+ изменениях в EpubReader.tsx. Мониторить, не мигрировать.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 7.1 | P0 | python-jose → PyJWT (уже в Phase 1 плане: SEC-03) | M |
| 7.2 | P0 | `pip install cryptography==46.0.5` | S |
| 7.3 | P0 | `pip install pillow==12.1.1` | S |
| 7.4 | P0 | passlib → pwdlib (планировать после Phase 1) | M |
| 7.5 | P1 | Batch обновление P1 пакетов после Phase 1 | L |
| 7.6 | P1 | FastAPI 0.134.0 — тестировать Content-Type breaking change перед обновлением | M |

---

## 8. CI/CD и инфраструктура

### Находки

**GitHub Actions:**
- `ci.yml`: lint → test → build → e2e → security → docker (6 jobs)
- `security.yml`: pip-audit, Safety, npm audit, Bandit, CodeQL, Trivy, TruffleHog, Gitleaks (8 scanners)

**Docker Compose:** 9 вариантов (lite, prod, staging, ssl, monitoring, 3× AWS)

### Проблемы

**8.1 Security scanning может не поймать текущие CVE** (P1, M)

`security.yml` использует pip-audit и Safety, но:
- pip-audit работает только с `requirements.txt` (не pyproject.toml)
- python-jose CVE-2025-61152 может не быть в базах Safety (CVSS 6.5 = MEDIUM, не всегда включается в default scan)

**8.2 Нет проверки docker-compose.lite.prod.yml** (P2, M)

CI тестирует только `docker build`, но не полный `docker compose up` с prod-конфигурацией. Расхождения между dev и prod выявляются только при деплое.

**8.3 PostgreSQL версия расходится** (P3, S)

dev: PostgreSQL 15 (docker-compose.lite.yml)
prod: PostgreSQL 17 (docker-compose.lite.prod.yml)

Потенциальные проблемы с SQL-совместимостью при использовании PG17-специфичных фич.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 8.1 | P1 | Добавить explicit check `pip-audit --require-hashes` для python-jose CVE | S |
| 8.2 | P2 | Добавить CI job для `docker compose -f docker-compose.lite.prod.yml config --quiet` | M |
| 8.3 | P3 | Выровнять PostgreSQL версии (обе на 17 или обе на 15) | M |

---

## 9. Документация

### Находки

- `docs/`: 763 файла, 17MB
- `docs/reports/`: 221 файл (top level)
- `.claude/backups/`: 53 patch-файла, 36 пустых (0 байт), ~900K

### Проблемы

**9.1 40-60 отчётов эпохи NLP (до декабря 2025) устарели** (P2, L)

NLP-система удалена в декабре 2025, но сохранились:
- `SESSION_REPORT_2025-11-23_P*.md` (8 файлов) — NLP integration sessions
- `WEEK_1-4_*.md` (6 файлов) — NLP unit test reports
- `GLINER_INTEGRATION_REPORT_2025-11-20.md` — GLiNER удалён
- `LANGEXTRACT_*.md` (2 файла) — LangExtract/Stanza удалены
- `2026-01-17-ios-*.md` (15+ файлов) — iOS app research, в PROJECT.md помечено "out of scope"

**9.2 docs/gsd/ — необъяснённый зеркальный клон .planning/** (P2, S)

`docs/gsd/` — **побайтовая копия** `.planning/` (за исключением config.json). Ни один файл не объясняет это дублирование. Одна из директорий избыточна — вероятно, `docs/gsd/` артефакт конфигурации GSD output directory.

**9.3 Backup rotation отсутствует** (P2, S)

53 файла в `.claude/backups/`, 68% пустые. Без ротации директория будет расти бесконечно.

### Рекомендации

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 9.1 | P2 | Переместить NLP-era отчёты в `docs/reports/archive/pre-nlp-removal/` | M |
| 9.2 | P2 | Удалить `docs/gsd/` (или добавить в .gitignore), оставить `.planning/` как canonical | S |
| 9.3 | P2 | Добавить ротацию в save-progress.sh (удалять пустые + старше 14 дней) | S |

---

## 10. GSD — глубокий анализ

### 10.1 Версия и обновление

**Установленная версия:** Определить точную версию можно через `cat ~/.claude/skills/gsd-*/SKILL.md | head` или `npx get-shit-done-cc --version`. По файловой структуре: v1.20.0+ (есть `/gsd:health`), v1.20.6+ (config.json содержит `nyquist_validation: true`).

**Последняя доступная:** v1.22.0 (28 февраля 2026)

**Ключевые фичи, которые могут быть ещё не установлены:**

| Версия | Фича | Критичность |
|--------|------|-------------|
| v1.22.0 | Analysis paralysis guards | Полезно — предотвращает overplanning |
| v1.22.0 | Code-aware discuss phase | Полезно — скаутинг кодовой базы перед обсуждением |
| v1.21.1 | 428-test suite, 9-matrix CI | Качество самого GSD |
| v1.21.0 | YAML frontmatter sync в STATE.md | Полезно — машиночитаемый статус |
| v1.21.0 | `/gsd:add-tests` | Полезно для Phase 4 (Entity Wiki Quality) |
| v1.20.6 | Context window monitor hooks | **КРИТИЧНО** — предупреждения при заполнении контекста |
| v1.20.4 | Executor обновляет ROADMAP.md и REQUIREMENTS.md | Полезно — автосинхронизация |

**Рекомендация:** Обновить до v1.22.0 (`npx get-shit-done-cc@latest`), особенно ради context window monitor и analysis paralysis guards.

### 10.2 Конфигурация

Текущая `.planning/config.json`:
```json
{
  "mode": "interactive",
  "depth": "comprehensive",
  "model_profile": "quality",
  "commit_docs": true,
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": false,
    "nyquist_validation": true
  },
  "parallelization": true
}
```

**Проблемы:**

**10.2.1 КРИТИЧНО: quality profile тихо понижается до Sonnet (Issue #695)** (P0)

Bug в GSD: `quality` profile конвертирует "opus" в "inherit" в `gsd-tools.cjs`. "inherit" разрешается в модель родительского процесса — **Sonnet 4.6**. Пользователь думает, что получает Opus-качество рассуждений, но получает Sonnet. PR #755 в процессе, не замержен.

**Действие:** Переключиться на `balanced` profile до фикса #695. Разницы в реальном качестве не будет, но токенов потратится меньше.

**10.2.2 comprehensive depth избыточна** (P2)

- `quick` = 3-5 фаз (прототипирование)
- `standard` = 5-8 фаз (типичные проекты)
- `comprehensive` = 8-12 фаз (крупные системы)

У fancai 6 фаз — попадает в `standard`. `comprehensive` добавляет overhead без пользы для solo-разработчика.

**10.2.3 commit_docs: true засоряет git историю** (P1)

При `commit_docs: true` каждое обновление STATE.md/ROADMAP.md создаёт отдельный коммит. Для 30 требований × 6 фаз = десятки `docs: update state` коммитов.

**⚠️ Предупреждение:** Issue #790 показывает, что `commit_docs: false` игнорируется в некоторых версиях. Подстраховка: добавить `.planning/` в `.gitignore`.

**10.2.4 parallelization: true без лимита** (P2)

Рекомендация: указать явный лимит для VPS и rate limit подписки:
```json
"parallelization": {
  "enabled": true,
  "max_concurrent_agents": 2
}
```

### 10.3 Интеграция с проектом

**10.3.1 Нет конфликтов с кастомными агентами** ✓

Кастомные агенты (fancai-orchestrator, epub-reader, gemini-imagen) — доменные, для кода. GSD-агенты (gsd-executor, gsd-planner, gsd-verifier) — для планирования. Пересечений нет.

**10.3.2 gsd-russian.md работает, но хрупко** (P2)

Правило работает на уровне CLAUDE.md инструкций, **не внутри** GSD-системы. Риск: обновления GSD могут добавить новые шаблоны документов, которые обойдут правило. Нужна проверка после каждого обновления GSD.

**10.3.3 Дублирование информации между CLAUDE.md и PROJECT.md** (P3)

Обе файла описывают стек, фичи, известные проблемы. Это архитектурно корректно для GSD (PROJECT.md — standalone context для GSD-агентов), но создаёт два источника истины.

### 10.4 Рабочий процесс

**10.4.1 6 фаз × ~2 плана = ~12 планов — адекватно** ✓

Типичный GSD-проект: 2-3 плана на фазу. Реальный кейс: 23 плана / 4 фазы (5-6 планов на фазу). Fancai с 2 планами на Phase 1 — на нижней границе, но для security-фазы достаточно.

**10.4.2 Не использовать --auto (Issue #668)** (P1)

Bug: при `/gsd:discuss-phase --auto` executor записывает файлы, но **не коммитит их**. Working tree остаётся dirty. Частично исправлен, но рискованно для production-ready кода.

**10.4.3 30 требований полностью покрыты ROADMAP.md** ✓

Все SEC-01–03, CLEAN-01–05, UX-01–06, WIKI-01–04, AI-01–03, DEPLOY-01–04, READ-01–05 распределены по фазам. v2 требования (SEC-04–08, PERF-01–03, FEAT-01–04) корректно отложены.

### 10.5 Сообщество и альтернативы

**GSD:**
- 22,100 stars, 1,900 forks
- Discord: 2,276 членов (Anthropic инженеры иногда участвуют)
- 948 коммитов, релизы несколько раз в неделю
- Adopted: Amazon, Google, Shopify, Webflow (по заявлениям проекта)
- Упоминания: The New Stack, Dev.to, Medium, DeepWiki

**Альтернативы:**

| Фреймворк | Stars | Подход | Для кого | Для fancai? |
|-----------|-------|--------|----------|-------------|
| **GSD** | 22.1K | Subagent isolation, fresh context per task | Solo/1-3 dev | ✓ Оптимален |
| **BMAD** | 25.5K | 12+ AI-агентов (PM, Architect, Dev, QA, BA) | Команды 5+ | ✗ Overkill |
| **RALPH** | 7.4K | While-loop bash → Claude → git → repeat | Automation/CI | Полезен для специфичных задач |

**Вывод:** GSD — правильный выбор для solo-разработчика на brownfield-проекте. BMAD требует 3-5 дней setup и 12+ ролей, что бессмысленно для одного человека. RALPH полезен как дополнение для автоматизируемых задач ("исправь все TypeScript ошибки"), но не как замена GSD.

### 10.6 Рекомендации по GSD

| # | Приоритет | Действие | Усилие |
|---|-----------|----------|--------|
| 10.1 | P0 | Переключить model_profile на `balanced` (quality сломан — #695) | S |
| 10.2 | P1 | Обновить GSD до v1.22.0 (`npx get-shit-done-cc@latest`) | S |
| 10.3 | P1 | Изменить `commit_docs: false` + добавить `.planning/` в `.gitignore` | S |
| 10.4 | P1 | Не использовать `--auto` флаг (bug #668 теряет коммиты) | — |
| 10.5 | P2 | Изменить depth на `standard` (comprehensive избыточна для 6 фаз) | S |
| 10.6 | P2 | Добавить `max_concurrent_agents: 2` в parallelization | S |
| 10.7 | P2 | Проверять gsd-russian.md после каждого обновления GSD | S |
| 10.8 | P2 | Удалить `docs/gsd/` (дубль .planning/) | S |
| 10.9 | P2 | Использовать `/gsd:quick` для мелких фиксов вместо полного pipeline | — |

---

## Сводная таблица рекомендаций

| # | Приоритет | Область | Рекомендация | Усилие | Влияние |
|---|-----------|---------|--------------|--------|---------|
| 1 | **P0** | Хуки | Переписать format_hook.sh (парсить stdin через jq) + создать .prettierrc | M | Автоформатирование сейчас не работает |
| 2 | **P0** | Агенты | Обновить epub-reader.md модель: `claude-sonnet-4-6` | S | Агент использует устаревшую модель |
| 3 | **P0** | GSD | Переключить model_profile на `balanced` (quality сломан — #695) | S | Фактически уже на Sonnet, но бесполезно тратит overhead |
| 4 | **P0** | Зависимости | python-jose → PyJWT (уже в SEC-03, Phase 1) | M | CVE-2025-61152 — обход аутентификации |
| 5 | **P0** | Зависимости | `pip install cryptography==46.0.5` | S | CVE-2026-26007 |
| 6 | **P0** | Зависимости | `pip install pillow==12.1.1` | S | CVE-2026-25990 |
| 7 | **P0** | Зависимости | passlib → pwdlib (планировать) | M | Unmaintained 6 лет, сломан в Py 3.13 |
| 8 | **P1** | Безопасность | Добавить `Write(.env*)` в deny settings.json | S | Сейчас можно создать .env через Write |
| 9 | **P1** | GSD | Обновить до v1.22.0 (context monitor, paralysis guards) | S | Context rot protection |
| 10 | **P1** | GSD | Установить `commit_docs: false` + `.planning/` в .gitignore | S | Чистая git история |
| 11 | **P1** | MCP | Добавить Redis MCP сервер | S | Дебаг Celery очередей |
| 12 | **P1** | MEMORY | Добавить GSD-секцию в MEMORY.md | S | Контекст для будущих сессий |
| 13 | **P2** | Skills | Удалить task-router (дублирует auto-routing.md) | S | Экономия токенов |
| 14 | **P2** | Агенты | Добавить `memory: project` в epub-reader и gemini-imagen | S | Накопление знаний между сессиями |
| 15 | **P2** | Агенты | Создать entity-system.md агент | M | Специализация для основной фичи |
| 16 | **P2** | Хуки | Добавить ротацию бэкапов (удалять пустые + старше 14 дней) | S | Чистота .claude/backups/ |
| 17 | **P2** | GSD | Изменить depth: `standard`, добавить max_concurrent_agents: 2 | S | Оптимизация для solo dev |
| 18 | **P2** | Документы | Архивировать NLP-era отчёты, удалить docs/gsd/ | M | 40-60 устаревших файлов |
| 19 | **P2** | MCP | Добавить GitHub MCP, синхронизировать .mcp.json | S | Структурированный доступ к GitHub |
| 20 | **P2** | Безопасность | Расширить WebFetch домены (npmjs, fastapi, ai.google.dev) | S | Доступ к документации |
| 21 | **P3** | CLAUDE.md | Добавить ссылки на reader.md и .planning/ | S | Документирование |
| 22 | **P3** | Skills | Добавить disable-model-invocation в deploy/db-migrate | S | Предотвращение случайной активации |

---

## Сравнение с аудитом от 06.02.2026

### Исправлено ✓

| Проблема | Было | Стало |
|----------|------|-------|
| CLAUDE.md "9 fallback strategies" | Неверное число | Исправлено на 8 |
| epub-reader.md EntityDrawer путь | Неверный | Исправлен на Entities/EntityDrawer.tsx |
| tech-stack/SKILL.md Vite 6 | Устаревшая версия | Обновлено на Vite 7 |
| tech-stack/SKILL.md Celery 5.4 | Устаревшая версия | Обновлено на Celery 5.6 |
| gemini-imagen агент — 7 пропущенных файлов | Неполный список | Все файлы добавлены |

### Осталось нерешённым ✗

| Проблема | Статус |
|----------|--------|
| epub-reader агент на stale модели | **Не исправлено** — до сих пор claude-sonnet-4-5 |
| format_hook.sh сломан | **Не исправлено** — до сих пор no-op |
| Нет .prettierrc | **Не исправлено** |
| Playwright stale entry в settings.json | **Не исправлено** (впервые выявлено в текущем аудите) |

### Новое (обнаружено впервые)

- GSD quality profile bug (#695) — тихое понижение до Sonnet
- 4 новых CVE: cryptography (26007), pillow (25990), DOMPurify (26791), passlib (unmaintained)
- docs/gsd/ зеркало .planning/
- task-router/auto-routing.md дублирование
- MCP disabled/enabled конфликт

---

## Следующие шаги

### Немедленно (до начала Phase 1 execution):
1. `pip install cryptography==46.0.5 pillow==12.1.1` — закрыть CVE без изменения кода
2. Обновить epub-reader.md модель → `claude-sonnet-4-6`
3. Переключить GSD config → `model_profile: "balanced"`
4. Добавить `Write(.env*)` в deny settings.json
5. Обновить GSD → v1.22.0

### В рамках Phase 1:
6. python-jose → PyJWT (SEC-03 уже в плане)
7. Исправить format_hook.sh + создать .prettierrc
8. Добавить Redis MCP сервер

### После Phase 1:
9. passlib → pwdlib миграция
10. Архивация документации
11. Создание entity-system агента

---

## Источники

- [Claude Code Docs — Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Docs — Best Practices](https://code.claude.com/docs/en/best-practices)
- [Claude Code Docs — MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code Docs — Sub-agents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Docs — Skills](https://code.claude.com/docs/en/skills)
- [Claude Code Docs — Permissions](https://code.claude.com/docs/en/permissions)
- [Redis MCP](https://github.com/redis/mcp-redis)
- [Docker MCP Toolkit](https://www.docker.com/blog/add-mcp-servers-to-claude-code-with-mcp-toolkit/)
- [GSD GitHub](https://github.com/gsd-build/get-shit-done)
- [GSD Issue #695 — quality profile downgrade](https://github.com/gsd-build/get-shit-done/issues/695)
- [GSD Issue #668 — auto-advance drops commits](https://github.com/gsd-build/get-shit-done/issues/668)
- [GSD Issue #671 — subagents missing CLAUDE.md](https://github.com/gsd-build/get-shit-done/issues/671)
- [GSD Issue #120 — token consumption](https://github.com/gsd-build/get-shit-done/issues/120)
- [GSD Issue #790 — commit_docs ignored](https://github.com/gsd-build/get-shit-done/issues/790)
- [CVE-2025-61152 (NVD)](https://nvd.nist.gov/vuln/detail/CVE-2025-61152)
- [CVE-2026-26007 (cryptography)](https://www.cvedetails.com/cve/CVE-2026-26007/)
- [CVE-2026-25990 (pillow)](https://www.openwall.com/lists/oss-security/2026/02/12/1)
- [FastAPI → PyJWT migration](https://github.com/fastapi/full-stack-fastapi-template/pull/1203)
- [pwdlib — passlib replacement](https://www.francoisvoron.com/blog/introducing-pwdlib-a-modern-password-hash-helper-for-python)
- [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- [RALPH](https://github.com/frankbria/ralph-claude-code)
- [GSD vs BMAD vs RALPH](https://pasqualepillitteri.it/en/news/158/framework-ai-spec-driven-development-guide-bmad-gsd-ralph-loop)
- [The New Stack — Beating Context Rot with GSD](https://thenewstack.io/beating-the-rot-and-getting-stuff-done/)
