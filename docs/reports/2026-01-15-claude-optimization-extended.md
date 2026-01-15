# Расширенный отчёт: Оптимизация Claude Code (Январь 2026)

**Дата:** 2026-01-15
**Проект:** fancai
**Версия:** 2.3 (с анализом интеграции и зависимостей)
**Claude Code:** v2.1.7

---

## Оглавление

1. [Новые открытия (Январь 2026)](#новые-открытия-январь-2026)
2. [Критические обновления](#критические-обновления)
3. [**Анализ текущей конфигурации fancai**](#анализ-текущей-конфигурации-fancai) ⚠️ ВАЖНО
4. [**Анализ агентов и оркестрации**](#анализ-агентов-и-оркестрации-январь-2026)
5. [**Интеграция решений: Зависимости и ограничения**](#интеграция-решений-зависимости-и-ограничения--критично) ⚠️ КРИТИЧНО
6. [Обязательные плагины](#обязательные-плагины)
7. [Продвинутые техники оптимизации](#продвинутые-техники-оптимизации)
8. [Архитектура Skills и Hooks](#архитектура-skills-и-hooks)
9. [Оптимальная структура проекта](#оптимальная-структура-проекта)
10. [План подготовки fancai](#план-подготовки-fancai) — обновлён
11. [Пошаговая реализация](#пошаговая-реализация) — обновлена

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

## Анализ агентов и оркестрации (Январь 2026)

### Топ фреймворков для мульти-агентной оркестрации

| Фреймворк | Агентов | Особенности | Применимость для fancai |
|-----------|---------|-------------|-------------------------|
| **wshobson/agents** | 99 | 67 плагинов, ~300 токенов/плагин, прогрессивная загрузка | ✅ Высокая |
| **Superpowers** | 20+ skills | TDD, debugging, planning, subagent-driven | ✅ Высокая |
| **Claude Flow v2.7** | swarm | SQLite persistence, enterprise-grade | ⚠️ Средняя (overkill) |
| **CC Mirror** | orchestrator | Background execution, dependency graphs | ⚠️ Средняя |
| **VoltAgent** | 100+ | 10 категорий субагентов | ✅ Высокая |

### Официальные встроенные субагенты Claude Code

| Субагент | Версия | Назначение | Когда использовать |
|----------|--------|------------|-------------------|
| **Plan** | v2.0.28 | Планирование с возможностью возобновления | Перед началом реализации |
| **Explore** | v2.0.17 | Haiku-powered поиск по кодовой базе | Исследование без модификации |
| **general-purpose** | built-in | Сложные многошаговые задачи | Исследование + модификация |

### Сравнение claude-code-workflows vs wshobson/agents

| Критерий | claude-code-workflows | wshobson/agents |
|----------|----------------------|-----------------|
| **Плагинов** | 11 установлено | 67 доступно |
| **Агентов на плагин** | ~17 | ~1.5 (single-purpose) |
| **Токенов на плагин** | ~4-5K | ~300 |
| **Загрузка** | Всё сразу | Прогрессивная (3 уровня) |
| **Гранулярность** | Крупные bundles | Атомарные плагины |

**Вывод:** wshobson/agents экономит ~90% токенов при той же функциональности.

### Прогрессивная загрузка wshobson/agents

```
Уровень 1: Metadata (~50 токенов)
    └── Имя и критерии активации — загружается ВСЕГДА

Уровень 2: Instructions (~150 токенов)
    └── Основные инструкции — при АКТИВАЦИИ агента

Уровень 3: Resources (~100+ токенов)
    └── Примеры и шаблоны — ON-DEMAND
```

### Лучшие агенты для стека fancai

#### Frontend (React 19 + TypeScript 5.7)

| Агент | Источник | Назначение | Рекомендация |
|-------|----------|------------|--------------|
| `typescript-pro` | wshobson/agents | TypeScript advanced types, generics | ✅ Заменяет js/ts workflow |
| `react-specialist` | VoltAgent | React 18+ patterns, hooks | ✅ Добавить |
| `frontend-developer` | wshobson/agents | UI/UX, responsive layouts | ⚠️ Опционально |

#### Backend (FastAPI + Python 3.11)

| Агент | Источник | Назначение | Рекомендация |
|-------|----------|------------|--------------|
| `fastapi-pro` | wshobson/agents | Async APIs, SQLAlchemy 2.0 | ✅ Заменяет python workflow |
| `python-pro` | wshobson/agents | Python 3.12+ patterns | ✅ Заменяет python workflow |
| `backend-architect` | wshobson/agents | REST/GraphQL API design | ⚠️ Опционально |

#### AI/LLM (Gemini + Imagen)

| Агент | Источник | Назначение | Рекомендация |
|-------|----------|------------|--------------|
| `ai-engineer` | wshobson/agents | RAG, agents, LLM apps | ✅ Заменяет llm workflow |
| `prompt-engineer` | wshobson/agents | Prompt optimization | ✅ Важно для Gemini |
| `llm-architect` | VoltAgent | LLM system design | ⚠️ Опционально |

#### Testing & Quality

| Агент | Источник | Назначение | Рекомендация |
|-------|----------|------------|--------------|
| `test-automator` | wshobson/agents | AI-powered testing | ✅ Заменяет unit-testing |
| `debugger` | wshobson/agents | Error investigation | ✅ Важно |
| **Superpowers TDD** | obra/superpowers | Red-Green-Refactor | ✅ ОБЯЗАТЕЛЬНО |

### Рекомендуемая конфигурация агентов для fancai

#### Вариант A: Минимальный (5 агентов)

```bash
# Заменяем 5 плагинов claude-code-workflows на 5 атомарных агентов
/plugin uninstall python-development@claude-code-workflows
/plugin uninstall javascript-typescript@claude-code-workflows
/plugin uninstall backend-development@claude-code-workflows
/plugin uninstall unit-testing@claude-code-workflows
/plugin uninstall llm-application-dev@claude-code-workflows

# Устанавливаем wshobson/agents (атомарные)
/plugin marketplace add wshobson/agents
/plugin install python-development@wshobson/agents      # ~300 токенов
/plugin install javascript-typescript@wshobson/agents   # ~300 токенов
/plugin install unit-testing@wshobson/agents            # ~300 токенов
/plugin install llm-application-dev@wshobson/agents     # ~300 токенов

# Добавляем Superpowers
/plugin install superpowers@superpowers-marketplace
```

**Экономия:** ~18K токенов (с 22K до 4K) при сохранении функциональности.

#### Вариант B: Оптимальный (8 агентов + Superpowers)

```bash
# wshobson/agents — атомарные агенты
/plugin install fastapi-pro@wshobson/agents        # FastAPI специфика
/plugin install typescript-pro@wshobson/agents     # TypeScript advanced
/plugin install ai-engineer@wshobson/agents        # LLM/RAG
/plugin install prompt-engineer@wshobson/agents    # Промпты для Gemini
/plugin install test-automator@wshobson/agents     # Тестирование
/plugin install debugger@wshobson/agents           # Отладка

# Superpowers — обязательно
/plugin install superpowers@superpowers-marketplace

# LSP — для real-time type info
/plugin install vtsls@claude-code-lsps
/plugin install pyright@claude-code-lsps
```

**Потребление:** ~3K токенов агенты + ~2K Superpowers + ~1K LSP = ~6K токенов.

### Кастомные субагенты для fancai

Рекомендуется создать специализированные субагенты для уникальной функциональности проекта:

#### 1. epub-reader-agent (EPUB специфика)

```yaml
# .claude/agents/epub-reader.md
---
name: epub-reader
description: Use for epub.js integration, CFI navigation, and reader component development. Expert in epub.js 0.3.93.
tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
---

# EPUB Reader Specialist

## Expertise
- epub.js 0.3.93 API and CFI navigation
- React integration with epub.js rendition
- Description highlighting strategies (9 approaches)
- iOS Safari compatibility fixes

## Key Files
- frontend/src/components/Reader/EpubReader.tsx
- frontend/src/hooks/epub/useDescriptionHighlighting.ts
- frontend/src/hooks/epub/useContentHooks.ts

## Conventions
- Use CFI for position tracking
- TanStack Query for chapter caching
- IndexedDB via chapterCache.ts
```

#### 2. gemini-imagen-agent (AI интеграция)

```yaml
# .claude/agents/gemini-imagen.md
---
name: gemini-imagen
description: Use for Gemini 3.0 Flash extraction and Imagen 4 image generation. Expert in Google AI APIs.
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
---

# Gemini & Imagen Specialist

## Expertise
- Google Gemini 3.0 Flash API for description extraction
- Google Imagen 4 GA for image generation
- Retry patterns with exponential backoff
- Cost optimization (~$0.02/book)

## Key Files
- backend/app/services/gemini_extractor.py
- backend/app/services/imagen_generator.py
- backend/app/core/retry.py

## API Costs
- Gemini 3.0 Flash: $0.50/1M input, $3/1M output
- Imagen 4: $0.04/image
```

#### 3. fancai-fullstack-agent (оркестратор)

```yaml
# .claude/agents/fancai-orchestrator.md
---
name: fancai-orchestrator
description: Use for coordinating frontend/backend changes across fancai stack. Manages cross-cutting concerns.
tools:
  - Task
  - Read
  - Grep
  - Glob
---

# fancai Full-Stack Orchestrator

## Role
Coordinate complex changes spanning frontend (React/TS) and backend (FastAPI/Python).

## Delegation Rules
- Frontend-only: delegate to typescript-pro or react specialist
- Backend-only: delegate to fastapi-pro or python-pro
- AI features: delegate to gemini-imagen agent
- EPUB features: delegate to epub-reader agent
- Testing: delegate to test-automator + Superpowers TDD

## Cross-Cutting Concerns
- API contract changes (OpenAPI sync)
- Database migrations (Alembic)
- Cache invalidation (TanStack Query + Redis)
```

### Паттерны оркестрации агентов

#### Паттерн 1: Three-Stage Pipeline (Рекомендуется)

```
pm-spec → architect-review → implementer-tester
    │            │                   │
    └────────────┴───────────────────┘
         Human-in-the-loop checkpoints
```

**Для fancai:**
```
Feature Request
    │
    ▼
[Plan Subagent] — анализ требований, clarifying questions
    │
    ▼
[fancai-orchestrator] — архитектурное решение, ADR
    │
    ▼
[Специализированный агент] — реализация (epub/gemini/ts/fastapi)
    │
    ▼
[Superpowers TDD] — тестирование, verification
    │
    ▼
[Code Review] — финальная проверка
```

#### Паттерн 2: Parallel Specialization

```
                    ┌─ [typescript-pro] ── Frontend
User Request ─────► │
                    ├─ [fastapi-pro] ───── Backend
    [Orchestrator]  │
                    └─ [ai-engineer] ────── AI Layer
                              │
                              ▼
                    [Aggregation & Integration]
```

**Когда использовать:** Независимые изменения в разных слоях.

#### Паттерн 3: Human-in-the-Loop (HITL)

```bash
# Hook печатает команду, человек подтверждает
[Agent] → "Предлагаю: git push origin feature/xyz"
[Human] → Копирует и выполняет (или отклоняет)
```

**Важно для fancai:** Защита от нежелательных изменений в production.

### Лучшие практики оркестрации (Январь 2026)

| Практика | Описание | Важность |
|----------|----------|----------|
| **Single Responsibility** | Один агент = одна чёткая задача | 🔴 Критическая |
| **Tool Isolation** | Явное указание tools для каждого агента | 🔴 Критическая |
| **Isolated Context** | Субагенты не загрязняют основной контекст | 🔴 Критическая |
| **Hook-Based Orchestration** | SubagentStop + Stop events | 🟡 Высокая |
| **Queue-Based State** | Состояние в файлах, не в контексте | 🟡 Высокая |
| **HITL Checkpoints** | Человек подтверждает критические действия | 🟡 Высокая |
| **Progressive Disclosure** | Загрузка ресурсов on-demand | 🟢 Средняя |

### Сравнение: Текущие 5 плагинов vs Рекомендуемые

| Критерий | Текущие (claude-code-workflows) | Рекомендуемые (wshobson + Superpowers) |
|----------|--------------------------------|---------------------------------------|
| **Плагинов** | 5 | 6-8 |
| **Токенов** | ~22K | ~6K |
| **Агентов** | ~85 (много неиспользуемых) | 6-8 (все релевантные) |
| **TDD** | ❌ Нет | ✅ Superpowers |
| **Debugging** | ⚠️ Базовый | ✅ Systematic |
| **Специфика fancai** | ❌ Нет | ✅ Кастомные агенты |
| **Прогрессивная загрузка** | ❌ Нет | ✅ Да |

**Итого: Экономия ~16K токенов + улучшение качества**

---

## Интеграция решений: Зависимости и ограничения ⚠️ КРИТИЧНО

### Архитектура слоёв Claude Code

```
┌─────────────────────────────────────────────────────────────┐
│                      PLUGINS (packages)                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐│
│  │Commands │  │ Skills  │  │  Hooks  │  │    Subagents    ││
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘│
└───────┼────────────┼────────────┼────────────────┼──────────┘
        │            │            │                │
        ▼            ▼            ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE CORE                          │
│    Read, Write, Edit, Bash, Glob, Grep, Task, WebFetch...   │
└───────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP SERVERS                             │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
│   │ Context7│  │ Serena  │  │Playwright│  │Chrome DevTls│   │
│   └─────────┘  └─────────┘  └─────────┘  └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Критические ограничения интеграции

| Ограничение | Влияние | Решение |
|-------------|---------|---------|
| **Background субагенты НЕ имеют доступа к MCP** | epub-reader, gemini-imagen не смогут использовать Context7/Serena в background | Запускать синхронно или использовать только core tools |
| **MCP серверы не наследуют core tools** | MCP не может вызывать Read/Write/Bash | Только для внешних API (документация, поиск) |
| **Skills и Hooks могут конфликтовать** | Оба реагируют на события | Hooks для enforcement, Skills для expertise |
| **MCP потребляет больше контекста чем Skills** | Context7 ~5K vs Skill ~500 токенов | Использовать MCP для внешних запросов, Skills для внутренней логики |

### Матрица совместимости решений

| Решение A | Решение B | Совместимость | Примечания |
|-----------|-----------|---------------|------------|
| wshobson/agents | Superpowers | ✅ **Полная** | Namespace разделение, без конфликтов |
| wshobson/agents | LSP plugins | ✅ **Полная** | Дополняют друг друга |
| Superpowers | LSP plugins | ✅ **Полная** | TDD + type info |
| Субагенты (sync) | MCP серверы | ✅ **Полная** | Наследуют доступ к MCP |
| Субагенты (background) | MCP серверы | ❌ **НЕТ** | Известный баг Claude Code |
| Serena MCP | Context7 MCP | ⚠️ **Частичная** | Оба для поиска, выбрать один |
| Serena MCP | wshobson/agents | ✅ **Полная** | Serena для кода, agents для workflow |
| Skills (custom) | Hooks | ⚠️ **Требует внимания** | Разделить: hooks=enforcement, skills=expertise |

### Порядок интеграции (с зависимостями)

```
Фаза 0: Очистка
    │   └── Удалить нерабочие MCP и избыточные плагины
    │
    ▼
Фаза 1: CLAUDE.md + Структура
    │   └── Зависимость: нет
    │
    ▼
Фаза 2: Commands (.claude/commands/)
    │   └── Зависимость: CLAUDE.md должен существовать
    │
    ▼
Фаза 3: Hooks (.claude/settings.json)
    │   └── Зависимость: Commands для hook triggers
    │
    ▼
Фаза 4: Skills (.claude/skills/)
    │   └── Зависимость: Hooks настроены (чтобы избежать конфликтов)
    │
    ▼
Фаза 5: Субагенты (.claude/agents/)
    │   └── Зависимость: Skills готовы (для delegation)
    │   └── ⚠️ ВАЖНО: Не использовать background для MCP-зависимых задач
    │
    ▼
Фаза 6: MCP серверы
    │   └── Зависимость: Субагенты настроены
    │   └── ⚠️ ВАЖНО: Держать 2-3 MCP максимум
    │
    ▼
Фаза 7: Плагины (wshobson/agents, Superpowers, LSP)
        └── Зависимость: Всё остальное готово
        └── ⚠️ ВАЖНО: Устанавливать по одному, проверять /context
```

### Исправленные кастомные субагенты для fancai

**Проблема:** Ранее предложенные субагенты не учитывали ограничение background + MCP.

**Решение:** Указать явно режим выполнения и MCP tools.

#### epub-reader (исправленный)

```yaml
# .claude/agents/epub-reader.md
---
name: epub-reader
description: Use for epub.js integration, CFI navigation, reader components. Expert in epub.js 0.3.93.
tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - mcp__context7  # Явно указываем MCP для документации epub.js
model: claude-sonnet-4-20250514
# НЕ использовать run_in_background: true — потеряем доступ к MCP!
---

# EPUB Reader Specialist

## Expertise
- epub.js 0.3.93 API and CFI navigation
- React integration with epub.js rendition
- Description highlighting (9 strategies)
- iOS Safari compatibility

## Key Files
- frontend/src/components/Reader/EpubReader.tsx
- frontend/src/hooks/epub/useDescriptionHighlighting.ts
- frontend/src/hooks/epub/useContentHooks.ts

## MCP Usage
- Use mcp__context7 for epub.js documentation lookup
- Fallback to WebFetch if MCP unavailable
```

#### gemini-imagen (исправленный)

```yaml
# .claude/agents/gemini-imagen.md
---
name: gemini-imagen
description: Use for Gemini 3.0 Flash extraction and Imagen 4 generation. Expert in Google AI APIs.
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - mcp__context7  # Для документации Google AI
# НЕ добавляем Serena — для AI кода достаточно Grep/Read
---

# Gemini & Imagen Specialist

## Expertise
- Google Gemini 3.0 Flash API
- Google Imagen 4 GA (imagen-4.0-generate-001)
- Retry with exponential backoff (tenacity)
- Cost optimization

## Key Files
- backend/app/services/gemini_extractor.py (661 lines)
- backend/app/services/imagen_generator.py (644 lines)
- backend/app/core/retry.py (515 lines)

## API Costs
- Gemini 3.0 Flash: $0.50/1M input, $3/1M output
- Imagen 4: $0.04/image
- Target: ~$0.02/book
```

#### fancai-orchestrator (исправленный)

```yaml
# .claude/agents/fancai-orchestrator.md
---
name: fancai-orchestrator
description: Coordinate frontend/backend changes. Delegates to specialized agents.
tools:
  - Task
  - Read
  - Grep
  - Glob
  # НЕ включаем MCP — оркестратор только делегирует
---

# fancai Full-Stack Orchestrator

## Role
Route tasks to specialized agents. Never implement directly.

## Delegation Matrix
| Task Type | Delegate To | Run Mode |
|-----------|-------------|----------|
| EPUB/Reader | epub-reader | sync (needs MCP) |
| AI/Generation | gemini-imagen | sync (needs MCP) |
| Frontend TS | typescript-pro | background OK |
| Backend Python | fastapi-pro | background OK |
| Testing | test-automator + Superpowers | sync (TDD flow) |
| Debugging | debugger | sync (interactive) |

## Cross-Cutting
- API contracts: coordinate frontend + backend
- Migrations: Alembic commands via Bash
- Cache: TanStack Query + Redis invalidation
```

### Конфликты Superpowers vs wshobson/agents

| Функция | Superpowers | wshobson/agents | Рекомендация |
|---------|-------------|-----------------|--------------|
| TDD | ✅ test-driven-development skill | ❌ Нет | **Superpowers** |
| Debugging | ✅ systematic-debugging skill | ✅ debugger agent | **Оба** (разные подходы) |
| Planning | ✅ writing-plans skill | ✅ planner agent | **Superpowers** (более структурирован) |
| Code Review | ✅ requesting-code-review | ✅ code-reviewer agent | **wshobson** (более детальный) |
| Git Workflow | ✅ git-worktrees skill | ❌ Нет | **Superpowers** |

**Вывод:** Использовать Superpowers для workflow (TDD, planning, git), wshobson/agents для специализации (fastapi, typescript, ai).

### Финальная конфигурация для fancai

#### MCP серверы (2 из 4)

| MCP | Статус | Использование |
|-----|--------|---------------|
| `context7` | ✅ Оставить | Документация библиотек (epub.js, React, FastAPI) |
| `playwright` | ⏸️ Отключить | Включать только для E2E тестов |
| `chrome-devtools` | ❌ Удалить | Редко используется |
| `github` | ❌ Удалить | Не работает |

#### Плагины (9 вместо 16)

| Плагин | Источник | Назначение |
|--------|----------|------------|
| `fastapi-pro` | wshobson/agents | FastAPI backend |
| `typescript-pro` | wshobson/agents | TypeScript frontend |
| `ai-engineer` | wshobson/agents | LLM/RAG |
| `prompt-engineer` | wshobson/agents | Gemini prompts |
| `test-automator` | wshobson/agents | Testing |
| `debugger` | wshobson/agents | Debugging |
| `superpowers` | obra/superpowers | TDD, planning, git |
| `vtsls` | claude-code-lsps | TypeScript LSP |
| `pyright-lsp` | claude-code-lsps | Python LSP |

#### Кастомные субагенты (3)

| Субагент | Режим | MCP доступ |
|----------|-------|------------|
| `epub-reader` | sync | ✅ context7 |
| `gemini-imagen` | sync | ✅ context7 |
| `fancai-orchestrator` | sync | ❌ только делегирует |

### Итоговое потребление токенов

| Компонент | До оптимизации | После оптимизации |
|-----------|----------------|-------------------|
| MCP серверы | ~35K (4 шт) | ~5K (1-2 шт) |
| Плагины workflows | ~50K (11 шт) | ~3K (6 атомарных) |
| Superpowers | — | ~2K |
| LSP | ~2K | ~1K |
| CLAUDE.md | ~2K | ~0.5K |
| Кастомные субагенты | — | ~0.5K |
| **ИТОГО** | **~102K (51%)** | **~12K (6%)** |

**Экономия: ~90K токенов (+45% доступного контекста)**

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

### Фаза 3: Миграция агентов (День 2) ⚠️ ОБНОВЛЕНО

**Шаг 1: Удаление оставшихся claude-code-workflows**

```bash
# В Claude Code выполнить:
/plugin uninstall python-development@claude-code-workflows
/plugin uninstall javascript-typescript@claude-code-workflows
/plugin uninstall backend-development@claude-code-workflows
/plugin uninstall unit-testing@claude-code-workflows
/plugin uninstall llm-application-dev@claude-code-workflows
```

**Шаг 2: Установка wshobson/agents (атомарные)**

```bash
# Добавить marketplace
/plugin marketplace add wshobson/agents

# Установить атомарные агенты (~300 токенов каждый)
/plugin install fastapi-pro@wshobson/agents
/plugin install typescript-pro@wshobson/agents
/plugin install ai-engineer@wshobson/agents
/plugin install prompt-engineer@wshobson/agents
/plugin install test-automator@wshobson/agents
/plugin install debugger@wshobson/agents
```

**Шаг 3: Установка LSP и Superpowers**

| Плагин | Команда | Токенов |
|--------|---------|---------|
| LSP (TypeScript) | `/plugin install vtsls@claude-code-lsps` | ~300 |
| LSP (Python) | `/plugin install pyright@claude-code-lsps` | ~300 |
| Superpowers | `/plugin install superpowers@superpowers-marketplace` | ~2K |

**Шаг 4: Создание кастомных субагентов для fancai**

```bash
# Создать директорию агентов
mkdir -p .claude/agents

# epub-reader agent
cat > .claude/agents/epub-reader.md << 'EOF'
---
name: epub-reader
description: Use for epub.js integration, CFI navigation, reader components
tools: [Read, Edit, Write, Grep, Glob]
---
# EPUB Reader Specialist
Expert in epub.js 0.3.93, CFI navigation, iOS Safari fixes.
Key files: EpubReader.tsx, useDescriptionHighlighting.ts
EOF

# gemini-imagen agent
cat > .claude/agents/gemini-imagen.md << 'EOF'
---
name: gemini-imagen
description: Use for Gemini extraction and Imagen generation
tools: [Read, Edit, Write, Bash, Grep]
---
# Gemini & Imagen Specialist
Expert in Google AI APIs, retry patterns, cost optimization.
Key files: gemini_extractor.py, imagen_generator.py
EOF

# fancai-orchestrator agent
cat > .claude/agents/fancai-orchestrator.md << 'EOF'
---
name: fancai-orchestrator
description: Use for coordinating frontend/backend changes
tools: [Task, Read, Grep, Glob]
---
# fancai Full-Stack Orchestrator
Delegates to specialized agents based on task type.
EOF
```

**Ожидаемый результат миграции:**

| Метрика | До (claude-code-workflows) | После (wshobson + custom) |
|---------|---------------------------|---------------------------|
| Токенов на агенты | ~22K | ~4K |
| Количество агентов | ~85 | 9 (6 + 3 custom) |
| TDD | ❌ | ✅ Superpowers |
| Специфика fancai | ❌ | ✅ 3 кастомных агента |

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
- Плагины workflows: 0 (все удалены, заменяются на wshobson/agents)
- Плагины official: 3-4 (context7, typescript-lsp, pyright-lsp)

### Миграция агентов (Фаза 3) ⚠️ НОВОЕ

**Удаление оставшихся claude-code-workflows:**
- [ ] `python-development` удалён
- [ ] `javascript-typescript` удалён
- [ ] `backend-development` удалён
- [ ] `unit-testing` удалён
- [ ] `llm-application-dev` удалён

**Установка wshobson/agents (атомарные):**
- [ ] Marketplace добавлен (`/plugin marketplace add wshobson/agents`)
- [ ] `fastapi-pro` установлен
- [ ] `typescript-pro` установлен
- [ ] `ai-engineer` установлен
- [ ] `prompt-engineer` установлен
- [ ] `test-automator` установлен
- [ ] `debugger` установлен

**Кастомные субагенты fancai:**
- [ ] `.claude/agents/epub-reader.md` создан
- [ ] `.claude/agents/gemini-imagen.md` создан
- [ ] `.claude/agents/fancai-orchestrator.md` создан

**После миграции:**
- Атомарные агенты: 6 (wshobson/agents)
- Кастомные агенты: 3 (fancai-specific)
- Токенов на агенты: ~4K (было ~22K)

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

### Агенты и оркестрация (Январь 2026)
- [wshobson/agents](https://github.com/wshobson/agents) — 99 агентов, 67 плагинов
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) — 100+ субагентов
- [Claude Flow v2.7](https://github.com/ruvnet/claude-flow) — Enterprise orchestration
- [Best Practices for Claude Code Subagents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- [Claude Code Frameworks & Sub-Agents Guide](https://www.medianeth.dev/blog/claude-code-frameworks-subagents-2025)
- [ClaudeLog - Sub-agents Documentation](https://claudelog.com/mechanics/sub-agents/)

### Интеграция и совместимость
- [Understanding Claude Code Full Stack](https://alexop.dev/posts/understanding-claude-code-full-stack/) — MCP, Skills, Subagents, Hooks
- [Enhancing Claude Code with MCP and Subagents](https://dev.to/oikon/enhancing-claude-code-with-mcp-servers-and-subagents-29dd)
- [Background Subagents MCP Limitation (Issue #13254)](https://github.com/anthropics/claude-code/issues/13254)
- [MCP Tools for Subagents Only (Issue #6915)](https://github.com/anthropics/claude-code/issues/6915)

---

**Создано:** 2026-01-15
**Обновлено:** 2026-01-15
**Автор:** Claude Code (Opus 4.5)
**Версия:** 2.3
