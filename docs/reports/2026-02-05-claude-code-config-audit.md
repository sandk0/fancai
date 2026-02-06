# Аудит конфигурации Claude Code: проект fancai

**Дата:** 2026-02-05
**Scope:** Полный аудит текущей конфигурации + масштабное исследование лучших практик (2025-2026)
**Методология:** 4 параллельных агента, 176 tool calls, 60+ веб-источников, чтение всех 15 конфигурационных файлов

---

## Executive Summary

Проект fancai имеет продвинутую конфигурацию Claude Code (3 skills, 3 agents, 3 commands, 1 hook, 2 плагина), но страдает от **критического дублирования** (~950 токенов между CLAUDE.md и skills), **мёртвых ссылок** (4 из 6 агентов в orchestrator не существуют), **отсутствия MEMORY.md** (97 сжатий контекста потеряны), и **полного игнорирования Entity/Glossary** — основной продающей функции, которая не описана ни в одном конфигурационном файле. CLAUDE.md раздут до 174 строк (рекомендуемый максимум: 50-80). settings.local.json содержит 88 permissions (30+ дубликатов) и захардкоженный IP-адрес VPS с root-доступом.

---

## Часть 1: Аудит текущей конфигурации

### 1.1 CLAUDE.md (174 строки, ~1200 токенов)

**Вердикт:** Перегружен. Рекомендуемый максимум 50-80 строк, текущий — 174. Исследования Arize показывают, что LLM следуют ~150-200 инструкциям максимально; при увеличении числа инструкций производительность деградирует.

| Секция | Строки | Проблема |
|--------|--------|----------|
| Project Overview (7-9) | 3 | **УСТАРЕЛ** — нет Entity/Glossary, основной функции |
| Technology Stack (12-26) | 15 | **ДУБЛИРУЕТ** tech-stack SKILL.md на 90% |
| Key Directories (28-41) | 14 | **ДУБЛИРУЕТ** tech-stack SKILL.md; Claude может выполнить `tree` |
| Development Commands (43-58) | 16 | **ДУБЛИРУЕТ** tech-stack + commands /test, /build |
| API Quick Reference (60-69) | 10 | **НЕПОЛНЫЙ** — нет entity endpoints; Claude может прочитать роутеры |
| Environment Variables (71-78) | 8 | **ИЗБЫТОЧЕН** — Claude прочитает .env.example |
| Code Conventions (80-96) | 17 | Частично дублирует tech-stack |
| Key Files (98-113) | 16 | **ДУБЛИРУЕТ** agents epub-reader и gemini-imagen |
| Theme System (115-119) | 5 | OK, но лучше в `.claude/rules/frontend.md` |
| iOS Mobile Fixes (121-126) | 6 | OK, но лучше в `.claude/rules/frontend.md` |
| Production (128-132) | 5 | OK |
| Superpowers Auto-Routing (134-168) | 35 | **ПОЛНОСТЬЮ ДУБЛИРУЕТ** task-router SKILL.md |

**Рекомендация:** Сократить до ~50 строк. Удалить: Technology Stack, Key Directories, Development Commands, Environment Variables, Key Files, Superpowers Auto-Routing (~104 строки). Обновить: Project Overview с Entity/Glossary. Перенести iOS Fixes и Theme System в `.claude/rules/frontend.md`.

### 1.2 Settings

#### settings.json (39 строк) — project-level, в git

**Allow (15):** Хорошо структурированы через wildcards. Покрытие адекватное.

**Deny (3):** Крайне недостаточны.

| Отсутствует | Риск |
|-------------|------|
| `Bash(git push --force:*)` | Force push может уничтожить историю |
| `Bash(git reset --hard:*)` | Потеря незакоммиченных изменений |
| `Bash(rm -rf .:*)` | Удаление текущей директории |

**Hook:** PostToolUse для Edit|Write с format_hook.sh — корректен, но используется `$CLAUDE_FILE_PATH` вместо рекомендуемого `jq` из stdin.

#### settings.local.json (99 строк, 88 permissions) — local, NOT in git

| Категория | Кол-во | Примеры |
|-----------|--------|---------|
| **Дубликаты** с settings.json | ~30 | npm run build, npm test, git add, docker compose — уже покрыты wildcards |
| **Одноразовые** команды | ~15 | tree -L 2 конкретный путь, py_compile конкретных файлов, NLP тест (система удалена) |
| **Фрагменты** bash | 3 | `Bash(for file in ...)`, `Bash(do)`, `Bash(done)` — не работают как permissions |
| **Git commit message** | 1 | 30-строчный commit message целиком (строка 69) — ~300 токенов |
| **Опасные** | 4 | `sudo chown:*`, `ssh root@77.246.106.109:*`, `ssh root@77.246.106.109 "полная деплой-цепочка"` |
| **Полезные** уникальные | ~15 | ssh, gh, wc, claude, WebSearch, WebFetch, MCP tools |

**Рекомендация:** Сократить с 88 до ~15 записей. Удалить все дубликаты, одноразовые, фрагменты, git commit message. Убрать IP-адрес из permissions, заменить на /deploy command.

### 1.3 Skills

#### task-router (109 строк, ~750 токенов)

- **Дублирование:** Routing Rules Table почти идентична Superpowers Auto-Routing в CLAUDE.md (35 строк)
- **Мёртвая ссылка:** Ссылается на "Explore субагент", который не определён
- **Dot-диаграмма** (27 строк) не рендерится в markdown — бесполезный расход токенов
- **Вердикт:** Оставить как единственный source of truth для маршрутизации, убрать из CLAUDE.md

#### research-and-analysis (175 строк, ~1200 токенов)

- **Самый большой skill** проекта
- 4-фазная методология (Scope → Exploration → Analysis → Report) — полная и логичная
- Ссылается на LSP tools, которые могут быть недоступны в стандартном Claude Code
- Dot-диаграмма (14 строк) не рендерится
- **Вердикт:** Хороший skill, но стоит убрать dot-диаграммы и LSP-ссылки

#### tech-stack (75 строк, ~500 токенов)

- **90% контента дублирует CLAUDE.md** — Frontend stack, Backend stack, Key Directories, Key Services, AI Integration, Commands, Conventions, Production
- **Вердикт:** Выбрать одно место. Рекомендация: CLAUDE.md — минимальный overview, tech-stack — полная детализация. Не оба.

### 1.4 Agents

#### fancai-orchestrator (55 строк)

**Критический баг — 4 из 6 агентов в Delegation Matrix не существуют:**

| Agent | Существует? |
|-------|------------|
| epub-reader | Да |
| gemini-imagen | Да |
| typescript-pro | **НЕТ** |
| fastapi-pro | **НЕТ** |
| test-automator | **НЕТ** |
| debugger | **НЕТ** |

**Вердикт:** Orchestrator не может выполнять свою основную функцию. Убрать мёртвые ссылки, использовать `general-purpose` для делегирования.

#### epub-reader (39 строк)

- **Модель:** `claude-sonnet-4-20250514` — актуальна
- Захардкожены line counts (EpubReader.tsx 573 lines) — быстро устаревают
- **Пробел:** Не упоминает Entity-компоненты, интегрированные с Reader
- **Вердикт:** Убрать line counts, добавить Entity-интеграцию

#### gemini-imagen (42 строки)

- API costs могут быть неактуальны (Gemini pricing менялся)
- Упоминает `POLLINATIONS_ENABLED` — вероятно устаревший fallback
- **Пробел:** Не упоминает entity extraction (entity_service.py, entity_deduplication_service.py)
- **Вердикт:** Обновить costs, убрать Pollinations, добавить entity extraction

#### Покрытие агентами

| Область | Agent | Статус |
|---------|-------|--------|
| EPUB Reader | epub-reader | Покрыт |
| Gemini + Imagen | gemini-imagen | Частично (без entities) |
| **Entity/Glossary** | **НЕТ** | **НЕ ПОКРЫТ — основная функция!** |
| Frontend general | typescript-pro (мёртвый) | Не покрыт |
| Backend general | fastapi-pro (мёртвый) | Не покрыт |
| Testing | test-automator (мёртвый) | Не покрыт |
| Deploy/DevOps | НЕТ | Не покрыт |

### 1.5 Commands

| Command | Что делает | Проблемы |
|---------|-----------|----------|
| /go | git branch + status + tech-stack | Не загружает MEMORY.md, не проверяет Docker |
| /test | Jest + pytest | Не покрыты: E2E, type-check, lint |
| /build | npm build + mypy | Не покрыт: Docker build, lint |

**Отсутствуют:** /deploy, /migrate, /lint, /status

### 1.6 Hooks

**Единственный хук:** PostToolUse format_hook.sh (Edit|Write → prettier/black)

| Проблема | Описание |
|----------|----------|
| npx overhead | `npx prettier` имеет cold start 2-5 сек на каждый вызов |
| Markdown | .md файлы форматируются Prettier — overkill |
| Глушение ошибок | `2>/dev/null` скрывает ошибки форматтера |
| stdin | Использует `$CLAUDE_FILE_PATH` вместо рекомендуемого jq из stdin |

**Критически отсутствующие хуки:**

| Hook | Тип | Зачем |
|------|-----|-------|
| **Notification** | Notification | Desktop-уведомления при ожидании ввода |
| **Protect files** | PreToolUse | Защита .env, lock-файлов, миграций |
| **Block dangerous** | PreToolUse | Блокировка rm -rf, DROP TABLE |
| **Compact reminder** | SessionStart (compact) | Восстановление контекста после 97 сжатий |
| **Save progress** | PreCompact | Автосохранение перед сжатием |

### 1.7 Плагины и MCP

| Плагин/MCP | Статус | Оценка |
|------------|--------|--------|
| context7 | Включён | Полезен для epub.js (нишевая библиотека); для Google AI — менее полезен |
| superpowers | Включён | Активно используется: TDD, debugging, brainstorming, verification |
| playwright | Выключен | Рассмотреть включение для E2E тестов Reader |
| chrome-devtools | Включён (MCP) | 131 вызов за 5.5 месяцев — активно используется |

**Потенциальный конфликт:** Есть локальный skill `research-and-analysis` И одноимённый superpowers skill. Resolution order может быть непредсказуем.

### 1.8 Память (Memory)

**MEMORY.md отсутствует.** Директория `~/.claude/projects/.../memory/` существует, но пуста.

**Влияние:** 97 сжатий контекста за 5.5 месяцев — весь accumulated context теряется. Нет межсессионной памяти о архитектурных решениях, known issues, workarounds.

### 1.9 Дублирование между компонентами

| Контент | CLAUDE.md | tech-stack | task-router | epub-reader | gemini-imagen |
|---------|:---------:|:----------:|:-----------:|:-----------:|:-------------:|
| Frontend stack | X | X | | | |
| Backend stack | X | X | | | |
| Key directories | X | X | | | |
| Dev commands | X | X | | | |
| Conventions | X | X | | | |
| AI costs | X | X | | | X |
| Production URL | X | X | | | |
| Routing table | X | | X | | |
| Key backend files | X | X | | | X |
| Key frontend files | X | X | | X | |

**~950 дублированных токенов** (15% от бюджета конфигурации).

### 1.10 Бюджет контекстного окна

| Компонент | Строки | ~Токены | Загружается | Ценность |
|-----------|--------|---------|-------------|----------|
| CLAUDE.md | 174 | 1200 | **Всегда** | Средняя (дублирование) |
| tech-stack skill | 75 | 500 | При активации | Низкая (90% дубль) |
| task-router skill | 109 | 750 | При триггерах | Средняя (частично дубль) |
| research-and-analysis | 175 | 1200 | При анализе | Высокая (уникальная) |
| fancai-orchestrator | 55 | 400 | При делегировании | Низкая (4/6 мёртвые) |
| epub-reader | 39 | 300 | При EPUB задачах | Высокая |
| gemini-imagen | 42 | 300 | При AI задачах | Средняя (без entities) |
| Commands (3 шт.) | 67 | 450 | При вызове | Высокая |
| **ИТОГО** | **736** | **~5100** | | |
| **Из них дубли** | | **~950** | | Впустую |

---

## Часть 2: Исследование лучших практик

### 2.1 CLAUDE.md

**Консенсус из 10+ источников:**

1. **Краткость — ключевой принцип.** Все источники единогласны: 30-80 строк для корневого файла. Каждая строка проходит тест: "Если убрать, Claude начнёт ошибаться?" Если нет — удалить.

2. **Не дублировать код.** Если информация очевидна из package.json, структуры проекта или кода — не включать.

3. **Детерминистические инструменты > инструкции.** Hooks гарантируют выполнение, текстовые правила — нет.

4. **Регулярное ревью.** Каждые 2-4 недели пересматривать и чистить.

**Иерархия CLAUDE.md (от высшего к низшему приоритету):**

| Уровень | Расположение | Назначение |
|---------|-------------|-----------|
| Managed Policy | `/Library/Application Support/ClaudeCode/CLAUDE.md` | Корпоративные стандарты |
| Project Memory | `./CLAUDE.md` | Командные инструкции |
| Project Rules | `./.claude/rules/*.md` | Модульные правила по темам |
| User Memory | `~/.claude/CLAUDE.md` | Личные предпочтения |
| Project Local | `./CLAUDE.local.md` | Локальные настройки |

**Рекомендуемая структура `.claude/rules/` для fancai:**

```
.claude/rules/
  commands.md        # Команды разработки
  conventions.md     # Кодовые соглашения, commit format
  frontend.md        # iOS fixes, theme system, Reader conventions
  backend.md         # Python conventions, retry patterns
  auto-routing.md    # Superpowers маршрутизация (из CLAUDE.md)
```

**@import синтаксис:**
```markdown
# В CLAUDE.md
@.claude/rules/commands.md
@.claude/rules/conventions.md
```

**Рекомендуемый новый CLAUDE.md (~50 строк):**

```markdown
# fancai — Fiction reader with AI-generated illustrations and interactive book glossary

Two core AI features:
1. Image generation from extracted visual descriptions
2. Entity glossary/wiki — characters, locations, objects with spoiler-free chapter tracking

Stack: React 19 + TypeScript + Vite 6 | FastAPI + Python 3.11 + PostgreSQL
AI: Gemini 3.0 Flash (extraction + glossary) | Imagen 4 (image generation)
Production: https://fancai.ru | Deploy: docker-compose.lite.yml

## Commands
cd frontend && npm run dev        # frontend dev server
cd frontend && npm test           # Jest tests (prefer single files)
cd frontend && npm run build      # production build
cd backend && pytest -v           # backend tests
cd backend && alembic upgrade head # run migrations

## Code Conventions
- Commits: <type>(<scope>): <subject>
- TypeScript: functional components, TanStack Query, CFI for EPUB positions
- Python: type hints, Pydantic validation, tenacity retries
- No direct fetch() — use TanStack Query hooks

## Architecture Gotchas
- epub.js uses CFI for position tracking (not page numbers)
- Description highlighting: 9 fallback search strategies
- IndexedDB caches chapters offline (chapterCache.ts)
- iOS Safari: touch-action/overscroll-behavior fixes required
- EpubReader.tsx (84 changes) — hottest file, consider decomposition before editing

## Workflow
- Run tests before completing any task
- /clear between unrelated tasks
- For detailed tech stack: .claude/skills/tech-stack/SKILL.md
```

**Источники:** [Anthropic Official](https://code.claude.com/docs/en/best-practices), [Builder.io Guide](https://www.builder.io/blog/claude-md-guide), [HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md), [Arize Research](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/), [Dometrain](https://dometrain.com/blog/creating-the-perfect-claudemd-for-claude-code/), [Gend.co](https://www.gend.co/blog/claude-skills-claude-md-guide)

### 2.2 Hooks

**Рекомендуемый полный набор хуков для settings.json:**

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"fancai\" sound name \"Glass\"'"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/format/format_hook.sh"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo '## Post-Compact Reminder\n- Project: fancai (React 19 + FastAPI + Gemini AI)\n- Entity glossary = main selling feature\n- cd frontend && npm run dev | cd backend && pytest -v\n- Commits: <type>(<scope>): <subject>\n- Always run tests before completing'"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/save-progress.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Скрипт protect-files.sh:**
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
PROTECTED=(".env" "package-lock.json" "yarn.lock" ".git/" "docker-compose.lite.yml")
for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "BLOCKED: $FILE_PATH matches protected pattern '$pattern'" >&2
    exit 2
  fi
done
exit 0
```

**Скрипт block-dangerous.sh:**
```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
if echo "$COMMAND" | grep -qE '(rm -rf /|rm -rf ~|drop table|DROP TABLE|truncate |TRUNCATE |chmod 777|> /dev/sda|git push --force|git reset --hard)'; then
  echo "BLOCKED: Dangerous command: $COMMAND" >&2
  exit 2
fi
exit 0
```

**Типы хуков — когда какой:**

| Тип | Что делает | Когда | Стоимость |
|-----|-----------|-------|-----------|
| command | Bash-команда | Детерминистические проверки | Бесплатно |
| prompt | Промпт LLM (Haiku) | Нужен AI для решения | ~$0.001-0.01 |
| agent | Subagent с tools | Нужно проверить файлы | ~$0.01-0.10 |

**Антипаттерны:**
- Слишком много синхронных хуков (блокировка >1с на взаимодействие)
- Stop hook без проверки `stop_hook_active` (бесконечный цикл)
- echo в .zshrc/.bashrc (ломает JSON-парсинг)
- Хуки с жёсткими путями (не работают у других)
- Хуки перестают работать через ~2.5ч (известный баг — рестарт сессии)

**Источники:** [Hooks Reference](https://code.claude.com/docs/en/hooks), [Hooks Guide](https://code.claude.com/docs/en/hooks-guide), [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery), [everything-claude-code](https://github.com/affaan-m/everything-claude-code), [Paddo.dev](https://paddo.dev/blog/claude-code-hooks-guardrails/), [Context Recovery](https://claudefa.st/blog/tools/hooks/context-recovery-hook)

### 2.3 Плагины и MCP

**Масштаб экосистемы (февраль 2026):** 9000+ плагинов в 43 маркетплейсах, 7000+ MCP-серверов.

#### Рекомендуемые к добавлению

| MCP/Плагин | Назначение | Применимость к fancai | Зрелость |
|------------|-----------|----------------------|----------|
| **PostgreSQL MCP Pro** | Прямой доступ к БД, схема, запросы | Работа с books/chapters/entities БД | Стабильный |
| **SSH Manager** (minimal mode) | Замена ручных SSH-деплоев | Deploy на VPS, 5 инструментов в minimal mode | Стабильный |
| **Sequential Thinking** | Улучшение архитектурных решений | 1 инструмент, ~1K токенов overhead | Стабильный |
| **Sentry MCP** | Production monitoring | Мониторинг fancai.ru, AI root cause | Стабильный |
| **compound-engineering** | 12 параллельных ревьюеров | Дополняет superpowers для code review | Бета |

#### Текущие — оставить

| Плагин | Причина |
|--------|---------|
| context7 | Актуальная документация epub.js, 2 инструмента, минимальный overhead |
| superpowers | Глубоко интегрирован, TDD/debugging/planning |
| chrome-devtools | 131 вызов за 5.5 месяцев, незаменим для CSS-отладки Reader |

#### НЕ добавлять

| MCP | Причина |
|-----|---------|
| GitHub MCP | Проблемы с tool names >64 chars; `gh` CLI достаточно |
| Filesystem MCP | Дублирует встроенные Read/Write/Edit/Glob/Grep |
| Gemini MCP | fancai уже использует Gemini через Python SDK |

#### Оптимизация токенов MCP

Включить `ENABLE_TOOL_SEARCH=auto:10` — снижает baseline MCP токенов с ~60K до ~12-15K через динамическую загрузку инструментов по требованию (-47% context bloat).

**Источники:** [Firecrawl: Top 10 Plugins](https://www.firecrawl.dev/blog/best-claude-code-plugins), [mcpcat.io](https://mcpcat.io/guides/best-mcp-servers-for-claude-code/), [PostgreSQL MCP Pro](https://github.com/crystaldba/postgres-mcp), [SSH Manager](https://github.com/bvisible/mcp-ssh-manager), [Sequential Thinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking), [Sentry MCP](https://docs.sentry.io/product/sentry-mcp/), [MCP Context Bloat Reduction](https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734)

### 2.4 Skills и Agents

#### Skills — когда skill vs CLAUDE.md

| CLAUDE.md | Skill |
|-----------|-------|
| Короткие, всегда-актуальные правила | Reusable workflows |
| Конвенции, стиль | Конкретные задачи: deploy, TDD |
| Загружается КАЖДУЮ сессию | Загружается по потребности |

**Оптимальная структура SKILL.md:**
```yaml
---
name: skill-name
description: >
  Clear description of WHAT it does AND WHEN to use it.
  Claude uses this to decide whether to load the skill.
disable-model-invocation: false  # true = только ручной /skill-name
context: fork                    # Изолированный контекст
allowed-tools: Read, Bash        # Ограничение tools
---
```

**Рекомендуемые новые skills:**

1. **deploy** — замена SSH-команд в settings.local.json, pre-checks + deploy + verify
2. **db-migrate** — Alembic workflow: model → schema → migration → test
3. **code-review** — Обзор изменений перед коммитом
4. **security-audit** — Чеклист OWASP для fancai

#### Agents — model selection

| Модель | Когда | Для fancai |
|--------|-------|-----------|
| **Opus** | Архитектура, сложные баги, планирование | Основная сессия (уже) |
| **Sonnet** | Повседневная работа, features, тесты | epub-reader, gemini-imagen, code-reviewer |
| **Haiku** | Exploration, поиск, простые задачи | Explore (встроенный), test-runner |

**Persistent Memory для агентов (новая функция 2026):**
```yaml
---
name: code-reviewer
memory: project    # user | project | local
---
```
Агент получает первые 200 строк MEMORY.md в свой context, может обновлять.

**Рекомендуемые обновления агентов:**

1. **fancai-orchestrator** — убрать мёртвые ссылки, использовать `general-purpose` для делегирования
2. **epub-reader** — убрать захардкоженные line counts, добавить Entity-интеграцию
3. **gemini-imagen** — добавить entity extraction, обновить costs, убрать Pollinations
4. **Новый: test-runner** (model: haiku) — запуск и анализ тестов
5. **Новый: security-reviewer** (model: sonnet, memory: project) — security audit

**Источники:** [Sub-agents Docs](https://code.claude.com/docs/en/sub-agents), [Skills Docs](https://code.claude.com/docs/en/skills), [awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents), [wshobson/agents](https://github.com/wshobson/agents), [trailofbits/skills](https://github.com/trailofbits/skills), [anthropics/skills](https://github.com/anthropics/skills)

### 2.5 Workflow-паттерны

**Основной цикл для solo-dev:**
```
1. /go                     # Начало сессии
2. Plan Mode               # Для сложных задач
3. Implement (TDD)         # Normal Mode
4. /code-review            # Проверка перед коммитом
5. Commit + verify
6. /clear                  # Между задачами
```

**Git Worktrees для параллельной работы:**
```bash
git worktree add ../fancai-glossary feature/glossary
cd ../fancai-glossary && claude    # Изолированная сессия
```

**Spec-Driven Development для крупных фич:**
1. Описать фичу кратко
2. Claude создаёт SPEC.md (интервью через AskUserQuestion)
3. `/clear`
4. Новая сессия: "Implement SPEC.md"

**Writer/Reviewer Pattern:**
- Сессия A пишет код → subagent code-review ревьюит → fix → commit

**Anti-patterns:**
- "Kitchen Sink Session" — смешивание задач без /clear
- "Correcting over and over" — после 2 неудач → /clear + лучший промпт
- Over-engineering — Opus склонен к лишним абстракциям, добавлять "keep solutions minimal"

**Источники:** [Best Practices](https://code.claude.com/docs/en/best-practices), [incident.io: Git Worktrees](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees), [Spec-Driven Development](https://alexop.dev/posts/spec-driven-development-claude-code-in-action/)

### 2.6 Permissions и безопасность

**Разделение по файлам:**

| settings.json (shared, git) | settings.local.json (personal) |
|------------------------------|-------------------------------|
| Allow-правила для проекта | defaultMode |
| Deny-правила безопасности | SSH к серверу |
| Hooks | MCP-серверы и плагины |
| | WebSearch/WebFetch |

**Рекомендуемый settings.local.json (~15 записей вместо 88):**

```json
{
  "permissions": {
    "allow": [
      "Bash(ssh:*)",
      "Bash(gh:*)",
      "Bash(wc:*)",
      "Bash(claude:*)",
      "WebSearch",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:www.anthropic.com)",
      "WebFetch(domain:code.claude.com)",
      "mcp__chrome-devtools__*",
      "mcp__plugin_context7_context7__*"
    ],
    "deny": [],
    "defaultMode": "acceptEdits"
  },
  "enabledPlugins": {
    "context7@claude-plugins-official": true,
    "superpowers@superpowers-marketplace": true
  }
}
```

**Дополнить deny в settings.json:**
```json
"deny": [
  "Bash(rm -rf /)",
  "Bash(rm -rf ~)",
  "Bash(rm -rf .)",
  "Bash(dd *)",
  "Bash(git push --force *)",
  "Bash(git reset --hard *)",
  "Read(.env)",
  "Read(.env.*)"
]
```

**Источники:** [Settings Docs](https://code.claude.com/docs/en/settings), [Security Guide](https://www.petefreitag.com/blog/claude-code-permissions/), [Settings Reference](https://claudefa.st/blog/guide/settings-reference)

---

## Часть 3: План действий

### Критичные (сделать немедленно)

| # | Действие | Обоснование |
|---|----------|-------------|
| 1 | **Создать MEMORY.md** с ключевыми решениями, Entity-архитектурой, known issues | 97 сжатий контекста потеряны; каждая сессия с нуля |
| 2 | **Обновить Project Overview** в CLAUDE.md — добавить Entity/Glossary как основную функцию | Основная продающая функция нигде не описана |
| 3 | **Исправить fancai-orchestrator** — убрать 4 мёртвые ссылки, заменить на `general-purpose` | Orchestrator не может делегировать |
| 4 | **Убрать IP-адрес VPS** из settings.local.json, создать /deploy skill | Компрометация сервера при случайном шаринге |
| 5 | **Добавить Notification hook** | 1 строка JSON, огромная экономия внимания |

### Важные (сделать на этой неделе)

| # | Действие | Обоснование |
|---|----------|-------------|
| 6 | **Сократить CLAUDE.md** с 174 до ~50 строк | LLM деградирует при >150 инструкциях; 90% дублирует skills |
| 7 | **Убрать Superpowers Auto-Routing** из CLAUDE.md в `.claude/rules/auto-routing.md` | 35 строк дублируют task-router |
| 8 | **Почистить settings.local.json** с 88 до ~15 записей | 30+ дубликатов, фрагменты bash, git commit message |
| 9 | **Добавить deny-правила** в settings.json (force push, hard reset, .env) | Неполная защита |
| 10 | **Добавить SessionStart compact hook** | 97 сжатий — контекст теряется |
| 11 | **Добавить PreToolUse protect-files hook** | Защита .env, lock-файлов |
| 12 | **Обновить gemini-imagen agent** — добавить entity extraction | Основная функция не покрыта агентом |

### Рекомендуемые (при возможности)

| # | Действие | Обоснование |
|---|----------|-------------|
| 13 | Создать skills: /deploy, /db-migrate, /code-review | Автоматизация частых операций |
| 14 | Создать `.claude/rules/` структуру (frontend.md, backend.md, conventions.md) | Модульность вместо монолитного CLAUDE.md |
| 15 | Добавить PreCompact hook для сохранения прогресса | Страховка перед сжатием |
| 16 | Добавить block-dangerous PreToolUse hook | Базовая безопасность |
| 17 | Исправить format_hook.sh — jq из stdin вместо $CLAUDE_FILE_PATH | Соответствие официальной документации |
| 18 | Убрать dot-диаграммы из skills (не рендерятся) | Экономия ~40 строк / ~200 токенов |
| 19 | Добавить PostgreSQL MCP Pro | Прямой доступ к БД |
| 20 | Включить ENABLE_TOOL_SEARCH=auto:10 | -47% MCP token bloat |
| 21 | Создать agent test-runner (model: haiku) | Быстрый запуск тестов |
| 22 | Рассмотреть включение Playwright | E2E тесты Reader |

### Что удалить/заменить

| Компонент | Действие | Причина |
|-----------|----------|---------|
| CLAUDE.md строки 12-58 (Technology Stack, Directories, Commands) | Удалить | 90% дублирует tech-stack skill |
| CLAUDE.md строки 60-78 (API Reference, Environment) | Удалить | Claude прочитает код и .env.example |
| CLAUDE.md строки 98-113 (Key Files) | Удалить | Дублирует agents |
| CLAUDE.md строки 134-168 (Superpowers Auto-Routing) | Перенести в `.claude/rules/` | Дублирует task-router skill |
| settings.local.json: 30+ дубликатов | Удалить | Покрыты wildcards в settings.json |
| settings.local.json: git commit permission (строка 69) | Удалить | ~300 токенов на одну одноразовую команду |
| settings.local.json: SSH с IP-адресом | Заменить на /deploy skill | Безопасность |
| fancai-orchestrator: 4 мёртвые ссылки | Заменить на general-purpose | Не работают |
| epub-reader: захардкоженные line counts | Убрать | Устаревают |
| task-router/research-and-analysis: dot-диаграммы | Убрать | Не рендерятся, ~200 токенов |

### Что добавить

| Компонент | Тип | Описание |
|-----------|-----|----------|
| MEMORY.md | Memory | Ключевые решения, Entity-архитектура, known issues, hot files |
| `.claude/rules/auto-routing.md` | Rules | Superpowers маршрутизация (из CLAUDE.md) |
| `.claude/rules/frontend.md` | Rules | iOS fixes, theme system, Reader conventions |
| Notification hook | Hook | Desktop-уведомления (osascript) |
| protect-files.sh | Hook | PreToolUse защита .env, lock-файлов |
| block-dangerous.sh | Hook | PreToolUse блокировка rm -rf, DROP TABLE |
| SessionStart compact hook | Hook | Восстановление контекста после сжатия |
| PreCompact hook | Hook | Сохранение прогресса перед сжатием |
| /deploy skill | Skill | SSH-деплой с pre-checks и verify |
| /db-migrate skill | Skill | Alembic workflow |
| test-runner agent | Agent | model: haiku, быстрый запуск тестов |
| PostgreSQL MCP Pro | MCP | Прямой доступ к БД |
| ENABLE_TOOL_SEARCH=auto:10 | Env | -47% MCP token bloat |

---

## Источники

### Официальная документация Anthropic
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Manage Claude's Memory](https://code.claude.com/docs/en/memory)
- [Extend Claude with Skills](https://code.claude.com/docs/en/skills)
- [Create Custom Subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Automate Workflows with Hooks](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Common Workflows](https://code.claude.com/docs/en/common-workflows)

### CLAUDE.md
- [The Complete Guide to CLAUDE.md — Builder.io](https://www.builder.io/blog/claude-md-guide)
- [Writing a good CLAUDE.md — HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [CLAUDE.md Best Practices — Arize](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/)
- [Creating the Perfect CLAUDE.md — Dometrain](https://dometrain.com/blog/creating-the-perfect-claudemd-for-claude-code/)
- [Claude Skills and CLAUDE.md — Gend.co](https://www.gend.co/blog/claude-skills-claude-md-guide)
- [Using CLAUDE.MD Files — Anthropic Blog](https://claude.com/blog/using-claude-md-files)

### Hooks
- [claude-code-hooks-mastery — GitHub](https://github.com/disler/claude-code-hooks-mastery)
- [everything-claude-code — GitHub](https://github.com/affaan-m/everything-claude-code)
- [Claude Code Hooks: Guardrails — Paddo.dev](https://paddo.dev/blog/claude-code-hooks-guardrails/)
- [Context Recovery Hook — ClaudeFast](https://claudefa.st/blog/tools/hooks/context-recovery-hook)
- [macOS Notifications — Khromov](https://khromov.se/claude-code-hooks-for-simple-macos-notifications/)

### Плагины и MCP
- [Top 10 Claude Code Plugins — Firecrawl](https://www.firecrawl.dev/blog/best-claude-code-plugins)
- [Best MCP Servers — mcpcat.io](https://mcpcat.io/guides/best-mcp-servers-for-claude-code/)
- [PostgreSQL MCP Pro](https://github.com/crystaldba/postgres-mcp)
- [SSH Manager MCP](https://github.com/bvisible/mcp-ssh-manager)
- [Sequential Thinking MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking)
- [Sentry MCP](https://docs.sentry.io/product/sentry-mcp/)
- [MCP Context Bloat Reduction](https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734)
- [Awesome MCP Servers](https://github.com/modelcontextprotocol/servers)

### Skills и Agents
- [anthropics/skills — GitHub](https://github.com/anthropics/skills)
- [awesome-claude-code-subagents — VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)
- [wshobson/agents — 108 agents](https://github.com/wshobson/agents)
- [trailofbits/skills — Security](https://github.com/trailofbits/skills)
- [Inside Claude Code Skills — Mikhail Shilkov](https://mikhail.io/2025/10/claude-code-skills/)
- [Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Best Practices for Subagents — PubNub](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)

### Workflow
- [Git Worktrees with Claude Code — incident.io](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
- [Spec-Driven Development — alexop.dev](https://alexop.dev/posts/spec-driven-development-claude-code-in-action/)
- [The Claude Code Setup That Won a Hackathon](https://blog.devgenius.io/the-claude-code-setup-that-won-a-hackathon-a75a161cd41c)
- [Solo-Dev Superpowers — Medium](https://nuttakitkundum.medium.com/unlocking-solo-dev-superpowers-with-claude-code-and-github-flow-991978f7543b)

---

*Сгенерировано: 2026-02-05 | Claude Code Opus 4.6 | 4 параллельных агента | 176 tool calls | 60+ источников*
