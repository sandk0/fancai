# Расширенный отчёт: Оптимизация Claude Code (Январь 2026)

**Дата:** 2026-01-15
**Проект:** fancai
**Версия:** 2.1 (с анализом текущей конфигурации)
**Claude Code:** v2.1.7

---

## Оглавление

1. [Новые открытия (Январь 2026)](#новые-открытия-январь-2026)
2. [Критические обновления](#критические-обновления)
3. [**Анализ текущей конфигурации fancai**](#анализ-текущей-конфигурации-fancai) ⚠️ НОВОЕ
4. [Обязательные плагины](#обязательные-плагины)
5. [Продвинутые техники оптимизации](#продвинутые-техники-оптимизации)
6. [Архитектура Skills и Hooks](#архитектура-skills-и-hooks)
7. [Оптимальная структура проекта](#оптимальная-структура-проекта)
8. [План подготовки fancai](#план-подготовки-fancai) — обновлён
9. [Пошаговая реализация](#пошаговая-реализация) — обновлена

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

## Анализ текущей конфигурации fancai

### Текущее состояние (15 января 2026)

**Версия Claude Code:** 2.1.7 ✅ (безопасная)

**Установленные MCP серверы (4):**

| MCP | Статус | Потребление | Рекомендация |
|-----|--------|-------------|--------------|
| `plugin:github:github` | ❌ **НЕ РАБОТАЕТ** | ~10-14K токенов | **УДАЛИТЬ** |
| `plugin:context7:context7` | ✅ Работает | ~3-5K токенов | Оставить |
| `plugin:playwright:playwright` | ✅ Работает | ~8-12K токенов | По необходимости |
| `chrome-devtools` | ✅ Работает | ~6-10K токенов | По необходимости |

**Оценочное потребление MCP при старте:** ~27-41K токенов (14-21% от 200K)

### Установленные плагины claude-code-workflows (11)

| Плагин | Версия | Агентов | Команд | Релевантность для fancai |
|--------|--------|---------|--------|--------------------------|
| `python-development` | 1.2.1 | ~17 | ~9 | ✅ Высокая (FastAPI) |
| `javascript-typescript` | 1.2.1 | ~17 | ~9 | ✅ Высокая (React/TS) |
| `frontend-mobile-development` | 1.2.1 | ~17 | ~9 | ⚠️ Средняя (нет мобильного) |
| `backend-development` | 1.2.4 | ~17 | ~9 | ✅ Высокая (FastAPI) |
| `database-design` | 1.2.0 | ~17 | ~9 | ⚠️ Средняя (редко меняется) |
| `unit-testing` | 1.2.0 | ~17 | ~9 | ✅ Высокая |
| `code-review-ai` | 1.2.0 | ~17 | ~9 | ⚠️ Средняя |
| `llm-application-dev` | 1.2.2 | ~17 | ~9 | ✅ Высокая (Gemini/Imagen) |
| `cicd-automation` | 1.2.1 | ~17 | ~9 | ❌ Низкая (Docker Compose) |
| `full-stack-orchestration` | 1.2.1 | ~17 | ~9 | ⚠️ Средняя (дублирует) |
| `backend-api-security` | 1.2.0 | ~17 | ~9 | ⚠️ Средняя |

**Всего от claude-code-workflows:**
- ~187 агентов
- ~99 команд
- ~120+ skills

### Установленные плагины claude-plugins-official (5)

| Плагин | Версия | Назначение | Рекомендация |
|--------|--------|------------|--------------|
| `github` | ee2f7266 | GitHub интеграция | ❌ МCP не работает |
| `context7` | ee2f7266 | Документация библиотек | ✅ Оставить |
| `typescript-lsp` | 1.0.0 | TS language server | ✅ Оставить |
| `playwright` | ee2f7266 | E2E тестирование | ⚠️ По необходимости |
| `pyright-lsp` | 1.0.0 | Python language server | ✅ Оставить |

### Критическая проблема: Context Overflow

**Расчёт текущего потребления:**

```
MCP серверы:           ~35K токенов
Плагины workflows:     ~50K токенов (11 × ~4.5K tool definitions)
Плагины official:      ~15K токенов
CLAUDE.md (500 строк): ~2K токенов
────────────────────────────────────
ИТОГО при старте:      ~102K токенов (51% от 200K!)
```

**Это объясняет, почему контекст быстро заканчивается!**

> "81,986 токенов только на MCP tools при старте (41%!)" — реальные замеры из тестов сообщества

### Рекомендации по оптимизации

#### НЕМЕДЛЕННЫЕ действия (Критические)

| # | Действие | Команда | Экономия |
|---|----------|---------|----------|
| 1 | Удалить нерабочий GitHub MCP | `claude mcp remove github` | ~10-14K |
| 2 | Удалить cicd-automation | `/plugin uninstall cicd-automation@claude-code-workflows` | ~4-5K |
| 3 | Удалить full-stack-orchestration | `/plugin uninstall full-stack-orchestration@claude-code-workflows` | ~4-5K |

#### ВЫСОКИЙ приоритет (Удалить дублирующие)

| # | Плагин | Причина удаления | Альтернатива |
|---|--------|------------------|--------------|
| 4 | `frontend-mobile-development` | Нет мобильного приложения | `javascript-typescript` |
| 5 | `database-design` | Редко меняется схема | Skill по запросу |
| 6 | `code-review-ai` | Дублирует Superpowers | Superpowers |
| 7 | `backend-api-security` | Редко используется | Skill по запросу |

#### ОСТАВИТЬ (5 плагинов из 16)

| Плагин | Обоснование |
|--------|-------------|
| `python-development` | FastAPI backend |
| `javascript-typescript` | React frontend |
| `backend-development` | API development |
| `unit-testing` | Тестирование |
| `llm-application-dev` | AI интеграция |

#### MCP серверы — оставить 2-3

| MCP | Статус | Действие |
|-----|--------|----------|
| `context7` | ✅ Оставить | Документация библиотек |
| `playwright` | ⚠️ Отключить | Включать только для E2E |
| `chrome-devtools` | ⚠️ Отключить | Включать только для отладки |
| `github` | ❌ Удалить | Не работает |

### Команды для оптимизации

```bash
# 1. Удалить нерабочий GitHub MCP
claude mcp remove github

# 2. Удалить неиспользуемые плагины workflows
/plugin uninstall cicd-automation@claude-code-workflows
/plugin uninstall full-stack-orchestration@claude-code-workflows
/plugin uninstall frontend-mobile-development@claude-code-workflows
/plugin uninstall database-design@claude-code-workflows
/plugin uninstall code-review-ai@claude-code-workflows
/plugin uninstall backend-api-security@claude-code-workflows

# 3. Отключить необязательные MCP (временно)
# Playwright и Chrome DevTools включать по необходимости
# через settings.json или CLI
```

### Ожидаемый результат оптимизации

| Метрика | До | После |
|---------|-----|-------|
| MCP серверов | 4 (1 broken) | 1-2 |
| Плагинов workflows | 11 | 5 |
| Плагинов official | 5 | 3-4 |
| Токенов при старте | ~102K (51%) | ~35-45K (18-23%) |
| Доступно для работы | ~98K | ~155-165K |

**Экономия: ~57-67K токенов (+60-70% доступного контекста)**

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

| Задача | Приоритет | Статус |
|--------|-----------|--------|
| ~~Обновить Claude Code до 2.1.0+~~ | CRITICAL | ✅ v2.1.7 |
| Проверить/удалить debug logs | CRITICAL | ⏳ Проверить |
| Ротировать exposed credentials | LOW | ✅ v2.1.7 безопасна |

### Фаза 0.5: Очистка плагинов и MCP (КРИТИЧНО — перед всем остальным!)

**Цель:** Снизить потребление токенов при старте с ~102K до ~35-45K

| # | Действие | Команда | Приоритет |
|---|----------|---------|-----------|
| 1 | Удалить нерабочий GitHub MCP | `claude mcp remove github` | 🔴 CRITICAL |
| 2 | Удалить `cicd-automation` | `/plugin uninstall cicd-automation@claude-code-workflows` | 🔴 HIGH |
| 3 | Удалить `full-stack-orchestration` | `/plugin uninstall full-stack-orchestration@claude-code-workflows` | 🔴 HIGH |
| 4 | Удалить `frontend-mobile-development` | `/plugin uninstall frontend-mobile-development@claude-code-workflows` | 🟡 MEDIUM |
| 5 | Удалить `database-design` | `/plugin uninstall database-design@claude-code-workflows` | 🟡 MEDIUM |
| 6 | Удалить `code-review-ai` | `/plugin uninstall code-review-ai@claude-code-workflows` | 🟡 MEDIUM |
| 7 | Удалить `backend-api-security` | `/plugin uninstall backend-api-security@claude-code-workflows` | 🟡 MEDIUM |

**Оставить плагины (5 из 16):**
- `python-development@claude-code-workflows` — FastAPI
- `javascript-typescript@claude-code-workflows` — React/TS
- `backend-development@claude-code-workflows` — API
- `unit-testing@claude-code-workflows` — Тесты
- `llm-application-dev@claude-code-workflows` — AI (Gemini/Imagen)

**Оставить MCP (2 из 4):**
- `context7` — документация библиотек (активен всегда)
- `playwright` — отключить, включать только для E2E тестов

**Bash-скрипт для выполнения:**
```bash
#!/bin/bash
# Выполнить вне Claude Code!

# 1. Удалить нерабочий MCP
claude mcp remove github

# 2-7 выполнить в Claude Code:
# /plugin uninstall cicd-automation@claude-code-workflows
# /plugin uninstall full-stack-orchestration@claude-code-workflows
# /plugin uninstall frontend-mobile-development@claude-code-workflows
# /plugin uninstall database-design@claude-code-workflows
# /plugin uninstall code-review-ai@claude-code-workflows
# /plugin uninstall backend-api-security@claude-code-workflows
```

**Ожидаемый результат:**
- Токенов при старте: ~102K → ~35-45K
- Доступно для работы: ~98K → ~155-165K
- Увеличение эффективного контекста: **+60-70%**

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

- [x] Claude Code >= 2.1.0 ✅ (v2.1.7)
- [ ] Debug logs очищены
- [x] Credentials безопасны (v2.1.7 не имеет уязвимости)

### Очистка плагинов и MCP (Фаза 0.5)

- [ ] GitHub MCP удалён (`claude mcp remove github`)
- [ ] `cicd-automation` удалён
- [ ] `full-stack-orchestration` удалён
- [ ] `frontend-mobile-development` удалён
- [ ] `database-design` удалён
- [ ] `code-review-ai` удалён
- [ ] `backend-api-security` удалён
- [ ] Playwright MCP отключен (включать по необходимости)
- [ ] Chrome DevTools MCP отключен (включать по необходимости)

**После очистки должно остаться:**
- MCP: 1-2 (context7, опционально playwright)
- Плагины workflows: 5 (python, js/ts, backend, testing, llm)
- Плагины official: 3-4 (context7, typescript-lsp, pyright-lsp)

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

### Анализ плагинов
- [Claude Code Workflows](https://github.com/shinpr/claude-code-workflows)
- [Claude Plugins Official](https://github.com/anthropics/claude-plugins)

---

**Создано:** 2026-01-15
**Обновлено:** 2026-01-15
**Автор:** Claude Code (Opus 4.5)
**Версия:** 2.1
