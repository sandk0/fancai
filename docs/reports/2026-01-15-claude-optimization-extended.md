# Расширенный отчёт: Оптимизация Claude Code (Январь 2026)

**Дата:** 2026-01-15
**Проект:** fancai
**Версия:** 2.0 (расширенная)

---

## Оглавление

1. [Новые открытия (Январь 2026)](#новые-открытия-январь-2026)
2. [Критические обновления](#критические-обновления)
3. [Обязательные плагины](#обязательные-плагины)
4. [Продвинутые техники оптимизации](#продвинутые-техники-оптимизации)
5. [Архитектура Skills и Hooks](#архитектура-skills-и-hooks)
6. [Оптимальная структура проекта](#оптимальная-структура-проекта)
7. [План подготовки fancai](#план-подготовки-fancai)
8. [Пошаговая реализация](#пошаговая-реализация)

---

## Новые открытия (Январь 2026)

### Ключевые метрики оптимизации

| Техника | Экономия токенов | Источник |
|---------|------------------|----------|
| **MCP Response Analyzer Skill** | до 97% | Medium (P.E. Féga) |
| **Wrapper Pattern (Skills)** | 64% при старте | DEV.to |
| **Context Forking (v2.1.0)** | изоляция тяжёлых операций | Claude Code 2.1.0 |
| **Skill Hot-Reload (v2.1.0)** | мгновенная загрузка | Claude Code 2.1.0 |
| **LSP Integration** | 900x быстрее поиска | Claude Code LSP |

### Claude Code 2.1.0 (Январь 2026)

**Критическое обновление безопасности:**
> Версии < 2.1.0 **экспонировали OAuth токены, API ключи и пароли** в debug логах.

**Обязательные действия:**
```bash
# Обновление
npm update -g @anthropic-ai/claude-code

# Проверка версии
claude --version  # должна быть >= 2.1.0

# Удалить старые debug логи
rm -rf ~/.claude/logs/*.log

# Ротировать скомпрометированные credentials
```

**Новые возможности v2.1.0:**
- **Automatic Skill Hot-Reload** — скиллы мгновенно доступны без перезапуска
- **Skill Context Forking** — изолированные субагенты с `context: fork`
- **Hooks in Skill Frontmatter** — хуки прямо в SKILL.md
- **Bash Wildcard Permissions** — `Bash(npm *)` вместо отдельных правил
- **Language Configuration** — настройка LSP для проекта

### Статистика потребления контекста

**MCP Tools может потреблять 40%+ контекста:**
- Linear MCP: ~14K токенов (7% от 200K)
- 5 MCP серверов: ~55K токенов до начала работы
- Зафиксировано: 81,986 токенов только на MCP tools (41%!)

**Правило:** Держать сессии < 30K токенов, compact при 70%.

---

## Критические обновления

### Обновлённые лимиты Claude Code

| Tier | Лимит | Особенности |
|------|-------|-------------|
| Free | 1x | Базовый |
| Pro ($20/мес) | 5x | 5-часовые сбросы |
| Max 5x ($100/мес) | ~25x | Расширенный |
| Max 20x ($200/мес) | ~100x | Максимальный |

### Правило 20 итераций

> "Reset context every 20 iterations. Performance craters after 20. Fresh start = fresh code."

**Рекомендация:** Отслеживать итерации, очищать проактивно.

### Marketplace Skills (Январь 2026)

| Marketplace | Skills | Plugins |
|-------------|--------|---------|
| claudecodeplugins.io | 549 | 282 |
| skillsmp.com | 63,000+ | - |
| awesome-claude-plugins | 2,783 repos | - |

---

## Обязательные плагины

### 1. Language Server Plugin (LSP)

**Критически важно для TypeScript/Python проектов!**

```bash
# Установка marketplace
/plugin marketplace add boostvolt/claude-code-lsps

# TypeScript/JavaScript
/plugin install vtsls@claude-code-lsps

# Python
/plugin install pyright@claude-code-lsps
```

**Преимущества:**
- Real-time type информация
- Семантическое понимание кода
- 900x быстрее текстового поиска (50ms vs 45s)

### 2. Superpowers Plugin

**Game-changer с ноября 2025.**

```bash
# Установка marketplace
/plugin marketplace add obra/superpowers-marketplace

# Установка плагина
/plugin install superpowers
```

**Включает:**
- Test-Driven Development skills
- Systematic Debugging
- Subagent-Driven Development
- Git Worktrees workflow
- Testing Anti-patterns

### 3. commit-commands

```bash
/plugin install commit-commands
```

**Возможности:**
- Intelligent commit messages
- PR generation
- Git workflow automation

### 4. pr-review-toolkit

```bash
/plugin install pr-review-toolkit
```

**Возможности:**
- Multi-agent code reviews
- Confidence scoring
- Categorized findings

---

## Продвинутые техники оптимизации

### 1. Wrapper Pattern

**Проблема:** Все skills загружаются при старте → overhead
**Решение:** Commands как thin entry points

```
Commands (6 строк, ~200 bytes) → загружаются сразу
Skills (полная реализация) → загружаются on-demand
```

**Экономия:** 64% контекста при старте

**Пример command:**
```markdown
---
description: Run TDD workflow
allowed-tools: Skill
---
Use superpowers:test-driven-development skill
```

### 2. Context Forking (v2.1.0)

**Изоляция тяжёлых операций:**

```yaml
# В SKILL.md frontmatter
---
name: heavy-analysis
context: fork  # Изолированный контекст
---
```

**Когда использовать:**
- Анализ больших файлов
- Множественные API вызовы
- Операции с большим output

### 3. MCP Response Analyzer

**До 97% экономии на больших JSON ответах.**

**Принцип:**
```
Большой MCP response → File-based analysis → Только результат в контекст
```

### 4. Selective MCP Activation

**Фазы работы:**
1. **Planning** — включить Linear/GitHub MCP
2. **Implementation** — только code-related MCPs
3. **Review** — включить review MCPs

**Правило:** Начинать с 2-3 MCP максимум.

### 5. Хирургические File References

```markdown
# ❌ Плохо — Claude исследует весь codebase
Найди где используется useTheme

# ✅ Хорошо — точная ссылка
@frontend/src/hooks/useTheme.ts покажи реализацию
```

### 6. Lean CLAUDE.md

**Целевой размер:** ~150 токенов

**Включать:**
- Архитектура (bullet points)
- Конвенции
- Запрещённые директории

**Исключать:**
- Нарратив
- Дублирование очевидного
- Code snippets

---

## Архитектура Skills и Hooks

### Структура Skills

```
~/.claude/skills/                    # Personal (приоритет)
.claude/skills/                      # Project (shared)
~/.config/claude-code/skills/        # Claude Code specific
```

**SKILL.md формат:**
```yaml
---
name: my-skill
description: Use when [trigger condition]. [What it does in third-person.]
allowed-tools: Bash, Read, Grep
model: claude-sonnet-4-20250514      # Optional
---

# Skill Name

## When to Use
- Trigger condition 1
- Trigger condition 2

## Instructions
[Step-by-step for Claude]

## Examples
[Real-world usage]
```

### Типы Hooks

| Hook | Когда | Use Case |
|------|-------|----------|
| `PreToolUse` | До выполнения | Block edits, validate |
| `PostToolUse` | После выполнения | Format, test, lint |
| `UserPromptSubmit` | При вводе | Context injection |
| `Stop` | Завершение агента | Continue/halt |

**Пример PostToolUse (auto-format):**
```json
{
  "hooks": [
    {
      "trigger": "PostToolUse",
      "commandMatch": "Edit|Write|MultiEdit",
      "command": "~/.claude/hooks/format/format_hook.sh"
    }
  ]
}
```

### Skill Evaluation (Auto-invoke)

**Система scoring:**
- Keyword match: 2 points
- Keyword pattern: 3 points
- Path pattern: 4 points
- Directory match: 5 points
- Intent pattern: 4 points

---

## Оптимальная структура проекта

### Рекомендуемая структура для fancai

```
fancai-vibe-hackathon/
├── CLAUDE.md                         # Главная память (< 200 строк)
├── CLAUDE.local.md                   # Git-ignored, machine-specific
├── .mcp.json                         # MCP серверы
├── .claude/
│   ├── settings.json                 # Hooks, permissions
│   ├── settings.local.json           # Personal overrides (gitignored)
│   ├── agents/
│   │   ├── planner.md                # Planning agent
│   │   ├── reviewer.md               # Code review agent
│   │   └── debugger.md               # Debugging agent
│   ├── commands/
│   │   ├── go.md                     # Session kickoff
│   │   ├── plan.md                   # Planning mode
│   │   ├── test.md                   # Run tests
│   │   └── deploy.md                 # Deployment
│   ├── skills/
│   │   ├── tech-stack/SKILL.md       # Project architecture
│   │   ├── db-schema/SKILL.md        # Database patterns
│   │   ├── security/SKILL.md         # Security practices
│   │   └── epub-reader/SKILL.md      # EPUB specific
│   ├── hooks/
│   │   └── format/format_hook.sh     # Auto-formatting
│   └── rules/
│       ├── typescript.md             # TS conventions
│       └── python.md                 # Python conventions
├── frontend/
│   ├── CLAUDE.md                     # Frontend-specific context
│   └── src/...
├── backend/
│   ├── CLAUDE.md                     # Backend-specific context
│   └── app/...
├── .serena/                          # Serena MCP config
└── docs/
```

### CLAUDE.md иерархия загрузки

1. `~/.claude/CLAUDE.md` — personal, private
2. `CLAUDE.md` — git-committed, team-shared
3. `CLAUDE.local.md` — git-ignored, machine-specific
4. `frontend/CLAUDE.md` — при работе во frontend/
5. `backend/CLAUDE.md` — при работе в backend/

---

## План подготовки fancai

### Фаза 0: Критические обновления (Немедленно)

| Задача | Приоритет | Время |
|--------|-----------|-------|
| Обновить Claude Code до 2.1.0+ | CRITICAL | 5 мин |
| Проверить/удалить debug logs | CRITICAL | 5 мин |
| Ротировать exposed credentials | CRITICAL | 15 мин |

### Фаза 1: Реструктуризация CLAUDE.md (День 1)

**Текущее состояние:** ~500 строк
**Целевое:** ~150-200 строк

| Задача | Описание |
|--------|----------|
| Сократить CLAUDE.md | Удалить детальные описания, оставить bullet points |
| Создать frontend/CLAUDE.md | Специфика React/TypeScript |
| Создать backend/CLAUDE.md | Специфика FastAPI/Python |
| Создать CLAUDE.local.md | Machine-specific (в .gitignore) |

### Фаза 2: Создание .claude/ структуры (День 1-2)

| Задача | Файлы |
|--------|-------|
| Создать settings.json | Hooks, permissions |
| Создать базовые commands | /go, /plan, /test |
| Создать tech-stack skill | Архитектура fancai |
| Создать db-schema skill | PostgreSQL patterns |

### Фаза 3: Установка плагинов (День 2)

| Плагин | Команда |
|--------|---------|
| LSP (TypeScript) | `/plugin install vtsls@claude-code-lsps` |
| LSP (Python) | `/plugin install pyright@claude-code-lsps` |
| Superpowers | `/plugin install superpowers` |
| commit-commands | `/plugin install commit-commands` |

### Фаза 4: Настройка MCP серверов (День 2-3)

| MCP | Назначение | Приоритет |
|-----|------------|-----------|
| Serena | Semantic code search | Уже установлен |
| Context7 | Library documentation | Уже установлен |
| Claude Context | Vector search | Рекомендуется |
| Sequential Thinking | Structured reasoning | Рекомендуется |

### Фаза 5: Настройка Hooks (День 3)

| Hook | Функция |
|------|---------|
| PostToolUse format | Auto-format после Edit/Write |
| PreToolUse security | Block dangerous commands |
| UserPromptSubmit | Skill suggestions |

### Фаза 6: Оптимизация workflow (Постоянно)

- Использовать /context для мониторинга
- Compact при 70%
- Clear между задачами
- Использовать subagents для тяжёлых операций

---

## Пошаговая реализация

### Шаг 1: Обновление Claude Code

```bash
# Проверка текущей версии
claude --version

# Обновление
npm update -g @anthropic-ai/claude-code

# Проверка после обновления
claude --version  # >= 2.1.0
```

### Шаг 2: Создание структуры .claude/

```bash
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon

# Создание директорий
mkdir -p .claude/{agents,commands,skills,hooks,rules}

# Создание settings.json
cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(npm:*)",
      "Bash(pytest:*)",
      "Bash(git:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(dd *)"
    ]
  },
  "hooks": []
}
EOF
```

### Шаг 3: Создание базовых commands

```bash
# /go command
cat > .claude/commands/go.md << 'EOF'
---
description: Start development session
allowed-tools: Read, Glob, Grep, Skill
---

# Session Start

1. Check current branch: `git branch --show-current`
2. Check status: `git status`
3. Load tech-stack skill for context
4. Ready for tasks

What would you like to work on?
EOF

# /plan command
cat > .claude/commands/plan.md << 'EOF'
---
description: Enter planning mode for feature/task
allowed-tools: Read, Glob, Grep, Task
---

# Planning Mode

Task: $ARGUMENTS

## Process
1. Analyze requirements
2. Search codebase for related code
3. Create implementation plan
4. Output plan as markdown

Use planning subagent for isolated context.
EOF

# /test command
cat > .claude/commands/test.md << 'EOF'
---
description: Run project tests
allowed-tools: Bash
---

# Run Tests

## Frontend
```bash
cd frontend && npm test
```

## Backend
```bash
cd backend && pytest -v
```

Report any failures with analysis.
EOF
```

### Шаг 4: Создание tech-stack skill

```bash
cat > .claude/skills/tech-stack/SKILL.md << 'EOF'
---
name: tech-stack
description: Use when discussing architecture, adding features, or understanding project structure. Provides fancai technology overview.
---

# fancai Technology Stack

## Architecture Overview

### Frontend (frontend/)
- **Framework:** React 19 + TypeScript 5.7
- **State:** TanStack Query 5.90 (server), Zustand 5 (client)
- **EPUB:** epub.js 0.3.93 with CFI navigation
- **Styling:** Tailwind CSS 3.4

**Key Directories:**
- `src/components/Reader/` - EPUB reader (15 files)
- `src/hooks/api/` - TanStack Query hooks
- `src/hooks/epub/` - EPUB functionality (22 files)
- `src/services/` - IndexedDB caching

### Backend (backend/)
- **Framework:** FastAPI 0.125 + Python 3.11
- **Database:** PostgreSQL 15 + SQLAlchemy 2.0
- **Cache:** Redis 7.4
- **Background:** Celery 5.4

**Key Services:**
- `app/services/book_parser.py` - EPUB/FB2 parsing
- `app/services/gemini_extractor.py` - Description extraction
- `app/services/imagen_generator.py` - Image generation

### AI Integration
- **Extraction:** Google Gemini 3.0 Flash
- **Generation:** Google Imagen 4

## Conventions

### TypeScript
- Functional components with hooks
- TanStack Query for data fetching
- No direct fetch() calls

### Python
- Type hints everywhere
- Pydantic for validation
- Repository pattern for DB

## Commands
```bash
# Frontend
cd frontend && npm run dev
cd frontend && npm test

# Backend
cd backend && pytest -v
cd backend && alembic upgrade head
```

## Production
https://fancai.ru
EOF
```

### Шаг 5: Установка плагинов

```bash
# В Claude Code:

# LSP plugins
/plugin marketplace add boostvolt/claude-code-lsps
/plugin install vtsls@claude-code-lsps
/plugin install pyright@claude-code-lsps

# Superpowers
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers

# Git workflow
/plugin install commit-commands
```

### Шаг 6: Настройка дополнительных MCP

```bash
# Claude Context (vector search)
claude mcp add claude-context \
  -e EMBEDDING_PROVIDER=Gemini \
  -e GEMINI_API_KEY=$GOOGLE_API_KEY \
  -- npx @zilliz/claude-context-mcp@latest

# Sequential Thinking
claude mcp add sequential-thinking npx -- -y @modelcontextprotocol/server-sequential-thinking
```

### Шаг 7: Оптимизация CLAUDE.md

```bash
# Backup текущего
cp CLAUDE.md CLAUDE.md.backup

# Создать оптимизированную версию (см. шаблон ниже)
```

**Оптимизированный CLAUDE.md шаблон (~150 токенов):**

```markdown
# fancai

## Stack
- Frontend: React 19, TypeScript 5.7, TanStack Query, epub.js
- Backend: FastAPI, Python 3.11, PostgreSQL 15, Redis
- AI: Gemini 3.0 Flash, Imagen 4

## Commands
- `npm run dev` / `npm test` (frontend)
- `pytest -v` / `alembic upgrade head` (backend)

## Key Paths
- frontend/src/components/Reader/ - EPUB reader
- frontend/src/hooks/api/ - API hooks
- backend/app/services/ - Business logic

## Conventions
- TypeScript strict, TanStack Query for data
- Python type hints, Pydantic validation
- Commits: type(scope): description

## Forbidden
- Never edit .env files directly
- No commits to main without PR
- No secrets in code

## Skills
Load tech-stack skill for full architecture details.
```

### Шаг 8: Добавление в .gitignore

```bash
cat >> .gitignore << 'EOF'

# Claude Code local configs
CLAUDE.local.md
.claude/settings.local.json

# MCP caches
.serena/cache/
.serena/*.pkl
EOF
```

---

## Чек-лист готовности

### Критические (до начала работы)

- [ ] Claude Code >= 2.1.0
- [ ] Debug logs очищены
- [ ] Credentials ротированы (если были exposed)

### Структура проекта

- [ ] .claude/ директория создана
- [ ] .claude/settings.json настроен
- [ ] .claude/commands/ — базовые команды
- [ ] .claude/skills/tech-stack/ создан
- [ ] CLAUDE.md оптимизирован (< 200 строк)
- [ ] frontend/CLAUDE.md создан
- [ ] backend/CLAUDE.md создан
- [ ] CLAUDE.local.md в .gitignore

### Плагины

- [ ] LSP (vtsls) установлен
- [ ] LSP (pyright) установлен
- [ ] Superpowers установлен
- [ ] commit-commands установлен

### MCP серверы

- [ ] Serena настроен (уже)
- [ ] Context7 настроен (уже)
- [ ] Claude Context установлен
- [ ] Sequential Thinking установлен

### Workflow

- [ ] /context используется для мониторинга
- [ ] /compact при 70% контекста
- [ ] Subagents для тяжёлых операций
- [ ] Clear между несвязанными задачами

---

## Ожидаемые результаты

| Метрика | До | После |
|---------|-----|-------|
| Токены при старте | 100% | ~35% (Wrapper Pattern) |
| Поиск по коду | текстовый grep | семантический (Serena + Claude Context) |
| Type информация | нет | real-time LSP |
| Debugging | manual | Superpowers systematic |
| Длина продуктивных сессий | ~20 итераций | ~40+ итераций |
| Качество кода | baseline | +TDD, +code review |

---

## Источники

### Официальные
- [Claude Code 2.1.0 Release Notes](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

### Руководства (Январь 2026)
- [Claude Code Must-Haves - January 2026](https://dev.to/valgard/claude-code-must-haves-january-2026-kem)
- [Claude Code Token Management 2026](https://richardporter.dev/blog/claude-code-token-management)
- [Claude Code Full-Stack Configuration Guide](https://htdocs.dev/posts/claude-code-full-stack-configuration-guide/)

### Плагины и Skills
- [Superpowers Plugin](https://github.com/obra/superpowers)
- [Claude Code Skills Hub](https://claudecodeplugins.io/)
- [Awesome Claude Skills](https://github.com/composiohq/awesome-claude-skills)
- [Claude Code Showcase](https://github.com/ChrisWiles/claude-code-showcase)

### MCP серверы
- [Serena MCP](https://github.com/oraios/serena)
- [Claude Context (Zilliz)](https://github.com/zilliztech/claude-context)
- [Context7](https://mcp.context7.com/)

---

**Создано:** 2026-01-15
**Автор:** Claude Code (Opus 4.5)
**Версия:** 2.0
