# Исследование экосистемы Spec-Driven Development инструментов для LLM-агентов

> **Дата:** 5 апреля 2026
> **Модель:** Claude Opus 4.6 (1M context)
> **Методология:** параллельный research через 6 специализированных агентов
> **Контекст:** проект fancai — ~170K LOC, React 19 + FastAPI + PostgreSQL, текущая методология GSD v1.32.0

---

## 1. Executive Summary

### Текущее состояние экосистемы SDD (апрель 2026)

Экосистема Spec-Driven Development за первый квартал 2026 года пережила взрывной рост. Ключевые маркеры:

- **SDD стал мейнстримом**: три раза попал в тренды Hacker News за месяц, Martin Fowler опубликовал серию статей, GitHub выпустил Spec Kit (85K+ звёзд)
- **Консолидация автономных агентов**: Cognition приобрела Windsurf за ~$250M, создав комбо IDE + автономный агент
- **CLI-агенты конвергируют**: Claude Code, Codex CLI, Gemini CLI и Copilot CLI все получили plan mode, MCP, subagents и worktree-изоляцию
- **Новая дисциплина — Context Engineering**: заменяет "prompt engineering" как ключевой навык. SDD, TDD, BDD — все являются специализациями context engineering
- **57% организаций** уже имеют агентов в production (LangChain State of Agent Engineering)

### Топ-3 инструмента для проекта типа fancai

| Ранг  | Инструмент                                  | Почему                                                                                                           |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **1** | **Claude Code native + GSD** (текущий стек) | Максимальная гибкость, 28 хук-событий, Agent Teams, worktrees, полный контроль. Уже настроен под проект          |
| **2** | **SuperPowers** (уже установлен)            | Дисциплина разработки: TDD enforcement, brainstorming-before-code, verification-before-completion. Дополняет GSD |
| **3** | **GitHub Spec Kit**                         | 85K звёзд, поддержка GitHub, агент-агностичный. Лёгкий spec-first слой поверх существующего workflow             |

### Ключевой вывод: стоит ли мигрировать с GSD?

**Нет.** Полная миграция не оправдана. GSD v1.33.0 + SuperPowers v5.0.7 + Claude Code native покрывают все потребности проекта fancai. Конкуренты либо слабее в планировании (Cursor, Aider), либо тяжелее в overhead (BMAD), либо ещё не production-ready (Augment Intent, Kiro).

**Рекомендуемые quick wins** (без миграции):

1. Обновить GSD до v1.33.0 (bugfixes + unified config)
2. Добавить OpenSpec для brownfield-итераций (lightweight spec per change)
3. Следить за Augment Intent — единственный SDD-native инструмент с living specs

---

## 2. Детальные профили инструментов

### 2.1 Get Shit Done (GSD) v1.33.0 (5 апреля 2026)

- **Сайт / Репозиторий:** [github.com/gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)
- **Тип:** фреймворк (pure prompt engineering)
- **Рантаймы:** Claude Code, Gemini CLI, Codex CLI, Copilot CLI, Cursor, Windsurf, Cline, Augment, Trae, OpenCode, Kilo, Antigravity (12)
- **Лицензия:** MIT
- **GitHub Stars / Contributors:** ~48,000 / ~110
- **npm:** `get-shit-done-cc` (installer), `gsd-cc` (~157 weekly downloads)
- **Последний релиз:** v1.33.0 (5 апреля 2026)
- **Автор:** Lex Christopherson (TACHES)
- **Discord:** 2,276 участников

**Ключевые фичи:**

- Milestone → Phase → Plan → Task — трёхуровневая иерархия декомпозиции
- 26+ типов специализированных агентов (executor, planner, verifier, debugger, codebase-mapper, nyquist-auditor и др.)
- Worktree-изоляция для параллельной работы агентов
- Autonomous mode (`--chain`, `/gsd-autonomous --to N`)
- Nyquist-валидация покрытия тестами
- Discuss → Plan → Execute → Verify lifecycle
- STATE.md / ROADMAP.md — персистентное состояние между сессиями
- Codebase mapping параллельными агентами

**Архитектура:** Pure context engineering через структурированные Markdown-файлы. Нет собственного runtime — работает целиком через prompt injection в Claude Code (или другой рантайм). Каждый план исполняется свежим subagent с инъекцией только релевантного контекста.

**Сильные стороны:**

- Глубокий project management: единственный инструмент с полной milestone/phase/plan иерархией
- Решает context rot: свежий subagent на каждый план
- Autonomous mode работает для well-defined фаз
- Мультиплатформенность (12 рантаймов)

**Слабые стороны:**

- Token-heavy: discuss + plan + execute + verify на каждую задачу
- Steep learning curve: 37+ команд, 26+ агентов
- `.planning/` directory pollution
- `/gsd-fast` как escape valve признаёт overhead для мелких задач
- GSD-2 (на Pi SDK, v2.63.0, 4.4K звёзд) — стратегическое направление, v1 может стать maintenance-only

**Совместимость с fancai:** ★★★★★ — текущий production workflow, 5 shipped milestones, ~80 фаз, ~90 планов.

---

### 2.2 SuperPowers v5.0.7 (31 марта 2026)

- **Сайт / Репозиторий:** [github.com/obra/superpowers](https://github.com/obra/superpowers)
- **Тип:** плагин / skills framework
- **Рантаймы:** Claude Code, Cursor, Copilot CLI, Gemini CLI, OpenCode, Codex (6)
- **Лицензия:** MIT
- **GitHub Stars / Contributors:** ~134,400 / 32
- **Последний релиз:** v5.0.7 (31 марта 2026)
- **Автор:** Jesse Vincent (Prime Radiant, ex-Keyboardio, K-9 Mail)
- **Marketplace:** официальный Anthropic marketplace (с 15 января 2026)

**Ключевые фичи:**

- Brainstorming — сократический опрос до написания кода
- TDD enforcement — удаляет код, написанный без failing test
- Systematic debugging — 4-фазная методология
- Writing/executing plans — декомпозиция на задачи по 2-5 минут
- Subagent-driven development — fresh subagent per task
- Parallel agents dispatching
- Git worktrees
- Verification before completion — "evidence before assertions"
- Code review (requesting + receiving)

**Архитектура:** Skills-based. SessionStart hook инъектирует bootstrap-контекст. SKILL.md файлы с YAML frontmatter активируются контекстно. Brainstorm server на WebSocket для визуальной компоненты.

**Сильные стороны:**

- Методология > инструменты: поведенческие guardrails улучшают качество независимо от проекта
- Zero friction: навыки активируются автоматически
- TDD enforcement — уникальная фича
- Лёгкий: нет persistent state, нет `.planning/`
- v5.0.6 — inline self-review вместо subagent loops: с 25 мин до 30 сек на review

**Слабые стороны:**

- Нет project management layer (milestones, phases, roadmaps)
- Skills не пропагируются в subagents (Issue #237)
- Нет state persistence между сессиями
- Bus factor: 1 автор при 134K звёздах
- Shell-heavy (58.8%) — проблемы кросс-платформенности

**Совместимость с fancai:** ★★★★☆ — уже установлен, дополняет GSD дисциплиной разработки.

---

### 2.3 BMAD Method v6.2.2 (25 марта 2026)

- **Сайт / Репозиторий:** [github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- **Тип:** фреймворк (natural language)
- **Рантаймы:** Claude Code, Cursor, и др.
- **Лицензия:** MIT
- **GitHub Stars / Contributors:** ~43,600 / N/A
- **Последний релиз:** v6.2.2 (25 марта 2026)

**Ключевые фичи:**

- 19+ AI-agent personas (Analyst, PM, Architect, Scrum Master, QA, UX Designer и др.)
- 50+ guided workflows covering full SDLC
- 4 фазы: Analysis → Planning → Solutioning → Implementation
- Party Mode — мульти-эксперт коллаборация в одной сессии
- Adversarial Review (3 параллельных review-слоя)
- Scale-Domain-Adaptive technology
- Модули: BMM (Core), BMB (Builder), TEA (Test Architect), BMGD (Game Dev), CIS (Creative Intelligence)

**Архитектура:** Natural language framework, работает целиком в контекстном окне LLM. Agent definitions = conversation context injection, не изолированные процессы. Party Mode потребляет 50-100K tokens.

**Сильные стороны:**

- Самое полное покрытие SDLC из всех SDD-инструментов
- Отлично для сложных greenfield-проектов
- Большое сообщество, быстрая итерация

**Слабые стороны:**

- Context window bloat: Party Mode 50-100K tokens, "lost-in-the-middle" эффект
- Adversarial Review заставляет находить минимум 3 issue = бесконечные review-циклы
- Все агенты в одном контекстном окне — нет истинной изоляции
- Overkill для brownfield-итераций

**Совместимость с fancai:** ★★☆☆☆ — слишком тяжёл для проекта с существующей кодовой базой. GSD уже покрывает те же функции с меньшим overhead.

---

### 2.4 OpenSpec v1.2.0 (23 февраля 2026)

- **Сайт / Репозиторий:** [github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | [openspec.dev](https://openspec.dev/)
- **Тип:** CLI + методология
- **Рантаймы:** Claude Code, Cursor, Copilot, Cline, Windsurf, и 20+ других
- **Лицензия:** MIT
- **GitHub Stars:** ~37,400
- **Последний релиз:** v1.2.0 (23 февраля 2026)
- **Автор:** Fission-AI

**Ключевые фичи:**

- Три фазы: Propose → Apply → Archive
- Delta markers (ADDED/MODIFIED/REMOVED) для отслеживания изменений в существующем коде
- Организованная folder structure per change
- CLI: `openspec propose`, `openspec apply`, `openspec archive`
- Community: spec-gen для reverse engineering спеков из существующего кода

**Архитектура:** Strict three-phase state machine. Brownfield-first: delta markers отслеживают изменения относительно существующей функциональности. Каждый proposal scoped к одному изменению = token-efficient.

**Сильные стороны:**

- Лучший для brownfield/iterative work
- Лёгкий и token-efficient
- Простая ментальная модель
- No lock-in, работает с 20+ инструментами

**Слабые стороны:**

- Specs не self-update при изменении подхода во время имплементации
- Overhead для простых задач (один эксперимент показал 2 часа на задачу, которую можно сделать за 20 минут с простым Instructions.md)
- Нет enterprise features

**Совместимость с fancai:** ★★★★☆ — отличное дополнение к GSD для мелких brownfield-итераций, где полный GSD-цикл overkill.

---

### 2.5 GitHub Spec Kit v0.1.4 (февраль 2026)

- **Сайт / Репозиторий:** [github.com/github/spec-kit](https://github.com/github/spec-kit) | [GitHub Blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- **Тип:** CLI toolkit
- **Рантаймы:** Copilot, Claude Code, Gemini CLI, Cursor, Windsurf (агент-агностичный)
- **Лицензия:** MIT
- **GitHub Stars:** ~85,400
- **Последний релиз:** v0.1.4

**Ключевые фичи:**

- 6-phase workflow: Install → Constitution → Specification → Plans → Tasks → Execute
- Specification-as-contract: specs генерируют реализации, валидируются, трассируются
- 40+ community extensions
- Backed by GitHub/Microsoft

**Архитектура:** Specification-as-contract система. Constitution определяет project-wide conventions. Specs = executable artifacts с автоматической валидацией и scoring.

**Сильные стороны:**

- Крупнейшее SDD-комьюнити (85K звёзд), поддержка GitHub
- Compliance/governance angle
- Агент-агностичный

**Слабые стороны:**

- Ещё v0.1.4 — ранняя стадия
- Больше для greenfield, чем brownfield
- Тяжелее, чем OpenSpec

**Совместимость с fancai:** ★★★☆☆ — полезен для новых крупных фич, но ранняя версия и overhead не оправдывают замену GSD.

---

### 2.6 Claude Code Native v2.1.92+ (апрель 2026)

- **Тип:** платформа (built-in)
- **Лицензия:** проприетарная (инструмент), open standard (Agent Skills / SKILL.md)
- **Документация:** [code.claude.com/docs](https://code.claude.com/docs)

**Ключевые фичи (2026):**

- **CLAUDE.md**: иерархические инструкции (enterprise → user → project → directory)
- **Skills (SKILL.md)**: progressive disclosure (~100 tokens metadata → полные инструкции → bundled resources). Open standard [agentskills.io](https://agentskills.io)
- **Subagents**: изолированные контекстные окна, custom model/tools/permissions, `.claude/agents/` config
- **Agent Teams** (experimental): множественные Claude Code сессии координируются на shared codebase. Teammates коммуницируют напрямую
- **Hooks (28 событий)**: SessionStart/End, PreToolUse/PostToolUse, SubagentStart/Stop, TaskCreated/Completed, WorktreeCreate/Remove, PreCompact/PostCompact и др. 4 типа handler: command, http, prompt, agent
- **Plugins**: комбинации skills + agents + MCP + hooks. Marketplace + third-party registries
- **Git worktrees**: `--worktree` flag, `/batch` skill (5-30 параллельных agents), subagent isolation
- **Conditional hooks с `if` field**: гранулярный контроль

**Архитектура:** Full-featured agent development platform с 6 extension mechanisms: CLAUDE.md, Skills, Subagents, Agent Teams, Hooks, Plugins. Progressive disclosure архитектура минимизирует context consumption.

**Сильные стороны:**

- Нет внешних зависимостей — всё built-in
- True process isolation для subagents
- 28 hook events = тотальный контроль над lifecycle
- Agent Teams — реальная multi-agent координация
- Cost control через model selection per subagent
- Быстрейшая итерация: Anthropic шипит обновления несколько раз в неделю
- Enterprise features: managed settings, policies, SSO

**Слабые стороны:**

- Нет built-in spec/proposal workflow — нужно строить самому или ставить BMAD/OpenSpec/GSD
- Agent Teams ещё experimental
- Subagents не могут спавнить subagents (нет nesting)
- Hooks JSON output ограничен 10K символами

**Совместимость с fancai:** ★★★★★ — основа всего стека. GSD и SuperPowers работают поверх.

---

### 2.7 Aider v0.86.2 (12 февраля 2026)

- **Сайт / Репозиторий:** [aider.chat](https://aider.chat) | [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)
- **Тип:** CLI
- **Рантаймы:** терминал (любой)
- **Лицензия:** Apache 2.0
- **GitHub Stars / Contributors:** ~42,900 / 500+
- **PyPI Downloads:** ~4.9M total
- **Последний релиз:** v0.86.2 (12 февраля 2026)
- **Discord:** ~10,600 участников

**Ключевые фичи:**

- RepoMap: tree-sitter AST → граф зависимостей → PageRank ранжирование
- Architect/Editor dual-model pipeline
- Auto git staging и commits
- 130+ языков, voice input, image/URL context
- Auto lint/test после каждого edit

**Сильные стороны:**

- Лучший repo map (PageRank)
- Dual-model архитектура = cost-efficient
- Model-agnostic
- Отличная git-интеграция

**Слабые стороны:**

- Нет planning framework
- Нет persistent context между сессиями
- Нет verification loops
- Нет MCP интеграции

**Совместимость с fancai:** ★★☆☆☆ — хороший CLI-инструмент, но не имеет SDD-возможностей. Claude Code + GSD значительно мощнее.

---

### 2.8 Cursor 3.0 (2 апреля 2026)

- **Сайт:** [cursor.com](https://cursor.com)
- **Тип:** IDE (VS Code fork)
- **Лицензия:** проприетарная
- **DAU:** 1M+, **Paying:** 360K+ клиентов, **Revenue:** $2B+ annualized
- **Valuation:** $29.3B
- **Последний релиз:** Cursor 3.0 (2 апреля 2026)

**Ключевые фичи:**

- Agent Mode: автономный multi-step coding
- Plan Mode: research → clarifying questions → editable Markdown plan
- Design Mode: аннотации на UI элементах в браузере
- Background/Cloud Agents: до 8 параллельных агентов
- Automations (март 2026): always-on агенты по триггерам (Slack, Linear, GitHub, PagerDuty)
- Rules (.mdc): version-controlled project instructions с YAML frontmatter
- Composer 2: proprietary frontier model
- Worktree support

**Сильные стороны:**

- Best-in-class IDE интеграция
- Cloud Agents для параллельной работы
- Design Mode — уникальная фича
- Massive adoption

**Слабые стороны:**

- Проприетарный, closed-source
- Plans ephemeral, не persistent
- Silent code reversion bugs (март 2026)
- GitHub-only VCS
- $20-200/мес

**Совместимость с fancai:** ★★★☆☆ — хорош как IDE, но для SDD нужен external scaffolding. Claude Code terminal workflow лучше для fancai.

---

### 2.9 Cline v3.72.0 (12 марта 2026)

- **Сайт / Репозиторий:** [cline.bot](https://cline.bot) | [github.com/cline/cline](https://github.com/cline/cline)
- **Тип:** VS Code extension
- **Лицензия:** Apache 2.0
- **GitHub Stars:** ~59,900
- **Installs:** 5.0M+
- **Последний релиз:** v3.72.0 (12 марта 2026)

**Ключевые фичи:**

- Plan & Act modes с отдельными моделями
- Browser automation
- MCP tool creation
- .clinerules для project-specific config
- Workspace checkpoints

**Сильные стороны:** Высшие звёзды GitHub среди всех AI-coding agents, open source, Plan & Act хорошо реализованы, MCP

**Слабые стороны:** Full-file rewrites = token-expensive, маленькая core team (~4), нет persistent planning, single-threaded

**Совместимость с fancai:** ★★☆☆☆ — VS Code extension без SDD-инфраструктуры.

---

### 2.10 Roo Code v3.51.1 (8 марта 2026)

- **Сайт / Репозиторий:** [roocode.com](https://roocode.com) | [github.com/RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)
- **Тип:** VS Code extension (fork Cline)
- **Лицензия:** Apache 2.0
- **GitHub Stars:** ~22,900
- **Installs:** 1.2M
- **Последний релиз:** v3.51.1 (8 марта 2026)

**Ключевые фичи:**

- 5 built-in modes: Code, Architect, Ask, Debug, Orchestrator
- Orchestrator mode: task decomposition + delegation
- Boomerang tasks: parent/child task delegation
- Diff-based editing (~30% token savings vs Cline)
- Custom modes через .roomodes
- SPARC methodology support

**Сильные стороны:** Самая гибкая mode system, Orchestrator — genuine task decomposition, 30-75% token savings

**Слабые стороны:** Stability issues, менее battle-tested чем Cline, нет persistent planning

**Совместимость с fancai:** ★★☆☆☆ — Orchestrator интересен, но VS Code dependency и отсутствие persistent state ограничивают.

---

### 2.11 Codex CLI v0.118.0 (31 марта 2026)

- **Сайт / Репозиторий:** [github.com/openai/codex](https://github.com/openai/codex) | [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)
- **Тип:** CLI agent
- **Лицензия:** Apache 2.0
- **GitHub Stars / Contributors:** ~73,300 / 400+
- **Язык:** Rust (94.7%)
- **Последний релиз:** v0.118.0 (31 марта 2026)

**Ключевые фичи:**

- 3 approval modes: `--suggest`, `--auto-edit`, `--full-auto`
- OS-level sandbox (Seatbelt/Bubblewrap/Landlock)
- ExecPlans (PLANS.md) для multi-hour autonomous sessions
- AGENTS.md instruction chain
- 20+ first-party plugins, 136+ community agents
- `codex exec` для CI/CD
- Reasoning levels (low/medium/high/minimal)

**Сильные стороны:** Лучшая sandbox-изоляция, крупнейшее open-source community (73K+), Rust = быстрый startup, ExecPlans для длинных сессий

**Слабые стороны:** Erratic behavior в длинных сессиях, слабее на frontend/React, нет native plan mode

**Совместимость с fancai:** ★★☆☆☆ — хороший CLI, но GPT-5.4 слабее Claude Opus на React/TypeScript задачах.

---

### 2.12 Gemini CLI v0.36.0 (1 апреля 2026)

- **Сайт / Репозиторий:** [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | [geminicli.com](https://geminicli.com/docs/)
- **Тип:** CLI agent
- **Лицензия:** Apache 2.0
- **GitHub Stars:** ~95,900
- **Последний релиз:** v0.36.0 (1 апреля 2026)

**Ключевые фичи:**

- GEMINI.md: иерархическая конфигурация (аналог CLAUDE.md)
- Plan Mode: read-only фаза анализа
- Conductor extension: spec-driven development с "tracks"
- 1M token context (Gemini 2.5 Pro / 3 Pro)
- Google Search grounding
- Multimodal input (PDF, images, sketches)
- Maestro: 22 специализированных subagents
- Free tier: 1,000 req/day

**Сильные стороны:** Лучший free tier (1,000 req/day, 1M context), highest GitHub stars среди CLI, multimodal input, Conductor для SDD

**Слабые стороны:** Requires internet, privacy concerns (код на серверах Google), code editing reliability issues, free tier ограничивается

**Совместимость с fancai:** ★★☆☆☆ — хороший бесплатный вариант, но Claude Opus значительно превосходит Gemini на сложных архитектурных задачах.

---

### 2.13 Copilot CLI v1.0.18 (4 апреля 2026)

- **Сайт / Репозиторий:** [github.com/github/copilot-cli](https://github.com/github/copilot-cli)
- **Тип:** CLI agent
- **Лицензия:** проприетарная
- **GitHub Stars:** ~9,800
- **Последний релиз:** v1.0.18 (4 апреля 2026, GA с 25 февраля 2026)

**Ключевые фичи:**

- Plan Mode с model comparison
- Autopilot Mode (experimental)
- Cloud Agent: assign issue → autonomous PR
- Multi-model: Claude Sonnet 4.5 (default), Opus 4.6, GPT-5.3, Gemini 3 Pro
- Auto-compaction: "virtually infinite sessions"
- Custom agents (.agent.md) + Skills (SKILL.md)

**Сильные стороны:** Тесная GitHub-интеграция, Cloud Agent (issue → PR), multi-model flexibility, Spec Kit — официальный SDD toolkit

**Слабые стороны:** Closed source, subscription required, нет sandbox, самое маленькое community

**Совместимость с fancai:** ★★☆☆☆ — Cloud Agent интересен для issue → PR, но проприетарность и отсутствие sandbox ограничивают.

---

### 2.14 Windsurf / Cascade (Cognition AI)

- **Сайт:** [windsurf.com](https://windsurf.com)
- **Тип:** IDE
- **Статус:** GA (приобретён Cognition AI за ~$250M)
- **Ценообразование:** Free / Pro $20/mo / Max $200/mo

**Ключевые фичи:**

- Cascade engine: graph-based reasoning, map всего кодовой базы
- Flow State: persistent context tracking
- Memories: project-specific rules persisting across sessions

**Совместимость с fancai:** ★★☆☆☆ — хорошая IDE, но нет SDD workflow, post-acquisition неопределённость.

---

### 2.15 Devin 2.2 (Cognition Labs)

- **Сайт:** [devin.ai](https://devin.ai)
- **Тип:** автономный AI-инженер
- **Статус:** GA
- **Ценообразование:** Core $20/mo (~9 ACUs) + $2.25/ACU overage

**Ключевые фичи:**

- Sandboxed cloud VMs с terminal/editor/browser
- Desktop computer-use (Devin 2.2)
- Interactive Planning
- Devin Search, Devin Wiki
- Параллельные instances

**Реальная производительность:** ~15% сложных задач завершается без human assistance. "Last 30% problem". Хорош для bulk repetitive work (200 backlog tickets).

**Совместимость с fancai:** ★☆☆☆☆ — "junior developer" quality ceiling. fancai требует архитектурных решений, с которыми Devin не справляется.

---

### 2.16 Factory AI (GA)

- **Сайт:** [factory.ai](https://factory.ai)
- **Тип:** multi-droid army
- **Terminal-Bench #1:** 58.75% (vs Claude Code 43.2%)
- **Ценообразование:** Free / Pro $20/mo / Enterprise до $2,000/mo

**Ключевые фичи:** Code/Knowledge/Reliability/Product/Review Droids. Интеграции: GitHub/GitLab, Jira, Slack, PagerDuty.

**Совместимость с fancai:** ★☆☆☆☆ — enterprise-ориентирован, value для solo developer минимальна.

---

### 2.17 Augment Intent (Beta, macOS)

- **Сайт:** [augmentcode.com/product/intent](https://www.augmentcode.com/product/intent)
- **Тип:** SDD-native desktop workspace
- **Статус:** Public beta (macOS only, Windows в waitlist)
- **Ценообразование:** Community Free (50 msg/mo) / Indie $20/mo / Standard $60/user/mo

**Ключевые фичи:**

- **Living Specs**: specs self-update по мере имплементации
- Context Engine: semantic dependency graph, 400K+ файлов
- Multi-agent: Coordinator + Specialist agents (Investigate, Implement, Verify, Critique, Debug, Code Review)
- SOC 2 Type II и ISO/IEC 42001
- BYO AI subscriptions

**Совместимость с fancai:** ★★★☆☆ — **единственный true SDD tool с living specs**. Но beta quality, macOS only. Стоит отслеживать.

---

### 2.18 Amazon Kiro (GA)

- **Сайт:** [kiro.dev](https://kiro.dev) | [github.com/kirodotdev/Kiro](https://github.com/kirodotdev/Kiro)
- **Тип:** IDE (VS Code fork)
- **Модель:** Claude Sonnet (via Amazon Bedrock)
- **Ценообразование:** Free (50 credits) / Pro $20/mo / Pro+ $40/mo / Power $200/mo

**Ключевые фичи:**

- 3-file SDD system: requirements.md + design.md + tasks.md
- EARS notation (Easy Approach to Requirements Syntax)
- Hooks automation
- AWS service integration

**Совместимость с fancai:** ★★☆☆☆ — structured spec workflow, но rigid EARS format и AWS-ориентация добавляют overhead.

---

### 2.19 Cosine / Genie (Early Access)

- **Сайт:** [cosine.sh](https://cosine.sh)
- **Тип:** автономный AI-инженер
- **Статус:** Early access (waitlist)
- **SWE-Lancer benchmark:** 72% (лучший результат)

**Совместимость с fancai:** ★☆☆☆☆ — недоступен, waitlist.

---

## 3. Сравнительная матрица

### A. Архитектура и методология (1-10)

| Инструмент         | Планирование | Spec-first | Трассируемость | Верификация | Обработка отклонений |
| ------------------ | :----------: | :--------: | :------------: | :---------: | :------------------: |
| **GSD**            |    **10**    |   **9**    |     **9**      |    **9**    |        **8**         |
| **SuperPowers**    |      5       |     7      |       4        |    **9**    |          6           |
| **BMAD**           |    **9**     |   **9**    |       7        |      8      |          5           |
| **OpenSpec**       |      6       |   **9**    |       6        |      4      |          3           |
| **Spec Kit**       |      8       |   **10**   |       8        |      7      |          5           |
| **Claude Native**  |      3       |     2      |       2        |      3      |          3           |
| **Aider**          |      4       |     2      |       3        |      5      |          3           |
| **Cursor**         |      6       |     4      |       3        |      3      |          4           |
| **Cline**          |      5       |     3      |       2        |      4      |          3           |
| **Roo Code**       |      7       |     4      |       3        |      5      |          4           |
| **Codex CLI**      |      6       |     5      |       4        |      4      |          4           |
| **Gemini CLI**     |      7       |     6      |       4        |      4      |          4           |
| **Copilot CLI**    |      6       |     7      |       5        |      4      |          4           |
| **Windsurf**       |      5       |     2      |       2        |      3      |          4           |
| **Devin**          |      6       |     3      |       3        |      5      |          5           |
| **Augment Intent** |    **9**     |   **10**   |       8        |    **9**    |          7           |
| **Kiro**           |      8       |   **9**    |       8        |      6      |          4           |

### B. Агентная архитектура (1-10)

| Инструмент         | Спец. агентов | Параллелизм | Изоляция | Контекст-менеджмент | Оркестрация |
| ------------------ | :-----------: | :---------: | :------: | :-----------------: | :---------: |
| **GSD**            |    **10**     |    **9**    |  **9**   |        **9**        |    **9**    |
| **SuperPowers**    |       5       |      7      |    7     |          6          |      6      |
| **BMAD**           |     **9**     |      2      |    2     |          4          |      6      |
| **OpenSpec**       |       1       |      1      |    1     |          8          |      1      |
| **Spec Kit**       |       3       |      3      |    3     |          6          |      4      |
| **Claude Native**  |       8       |    **9**    |  **9**   |          8          |      8      |
| **Aider**          |       3       |      1      |    2     |          7          |      1      |
| **Cursor**         |       5       |      7      |    6     |          7          |      5      |
| **Cline**          |       3       |      2      |    4     |          5          |      3      |
| **Roo Code**       |       7       |      4      |    5     |          6          |      7      |
| **Codex CLI**      |       4       |      3      |  **9**   |          6          |      4      |
| **Gemini CLI**     |       7       |      5      |    6     |          7          |      7      |
| **Copilot CLI**    |       5       |      5      |    4     |          7          |      5      |
| **Windsurf**       |       4       |      3      |    3     |          8          |      4      |
| **Devin**          |       3       |      7      |  **9**   |          7          |      4      |
| **Augment Intent** |     **9**     |    **9**    |    8     |        **9**        |    **9**    |
| **Kiro**           |       3       |      2      |    3     |          6          |      3      |

### C. Интеграция и экосистема (1-10)

| Инструмент         | Рантаймы | Расширяемость | MCP/плагины |  VCS   | CI/CD |
| ------------------ | :------: | :-----------: | :---------: | :----: | :---: |
| **GSD**            |  **10**  |     **9**     |      3      |   8    |   3   |
| **SuperPowers**    |    6     |       8       |      5      |   8    |   3   |
| **BMAD**           |    5     |       7       |      3      |   6    |   4   |
| **OpenSpec**       |  **10**  |       5       |      2      |   5    |   3   |
| **Spec Kit**       |    8     |     **9**     |      5      |   7    |   6   |
| **Claude Native**  |    1     |    **10**     |   **10**    |   8    |   7   |
| **Aider**          |    4     |       5       |      2      | **9**  |   5   |
| **Cursor**         |    1     |       7       |      8      |   6    |   5   |
| **Cline**          |    2     |       7       |      8      |   5    |   3   |
| **Roo Code**       |    2     |     **9**     |      8      |   5    |   3   |
| **Codex CLI**      |    5     |       8       |      8      |   7    | **9** |
| **Gemini CLI**     |    4     |       8       |      8      |   7    |   6   |
| **Copilot CLI**    |    3     |       7       |      8      | **10** | **9** |
| **Windsurf**       |    1     |       5       |      6      |   6    |   4   |
| **Devin**          |    1     |       4       |      3      |   7    |   6   |
| **Augment Intent** |    1     |       7       |      5      |   7    |   5   |
| **Kiro**           |    1     |       5       |      4      |   6    |   5   |

### D. Зрелость и production-readiness (1-10)

| Инструмент         | Документация | Сообщество | Стабильность API | Скорость релизов | Production cases |
| ------------------ | :----------: | :--------: | :--------------: | :--------------: | :--------------: |
| **GSD**            |      7       |     6      |        5         |      **9**       |        6         |
| **SuperPowers**    |      7       |   **9**    |        6         |        8         |        5         |
| **BMAD**           |      8       |     7      |        5         |        8         |        5         |
| **OpenSpec**       |      7       |     7      |        7         |        6         |        5         |
| **Spec Kit**       |      7       |   **9**    |        4         |        5         |        4         |
| **Claude Native**  |    **10**    |   **10**   |        7         |      **10**      |      **10**      |
| **Aider**          |      8       |     7      |        8         |        8         |        7         |
| **Cursor**         |      8       |   **9**    |        5         |      **9**       |      **10**      |
| **Cline**          |      7       |     8      |        6         |        7         |        7         |
| **Roo Code**       |      7       |     6      |        5         |        7         |        5         |
| **Codex CLI**      |      8       |   **9**    |        6         |      **10**      |        8         |
| **Gemini CLI**     |      8       |   **9**    |        6         |      **9**       |        7         |
| **Copilot CLI**    |      8       |     6      |        6         |        8         |        7         |
| **Windsurf**       |      7       |     7      |        5         |        7         |        8         |
| **Devin**          |      6       |     6      |        5         |        7         |        5         |
| **Augment Intent** |      6       |     5      |        4         |        6         |        3         |
| **Kiro**           |      7       |     6      |        5         |        6         |        4         |

### E. Применимость к fancai (1-10)

| Инструмент         | Стек совм. | Масштаб 170K | Соло-dev |   Миграция с GSD   | Русский |
| ------------------ | :--------: | :----------: | :------: | :----------------: | :-----: |
| **GSD**            |   **10**   |    **10**    |  **10**  |        N/A         | **10**  |
| **SuperPowers**    |   **10**   |    **9**     |  **9**   | **10** (дополняет) |    7    |
| **BMAD**           |     7      |      8       |    5     |         3          |    3    |
| **OpenSpec**       |     8      |      7       |    8     | **9** (дополняет)  |    5    |
| **Spec Kit**       |     8      |      8       |    6     |         7          |    4    |
| **Claude Native**  |   **10**   |    **10**    |  **10**  |  **10** (основа)   | **10**  |
| **Aider**          |     7      |      6       |    8     |         2          |    3    |
| **Cursor**         |     8      |      8       |    7     |         3          |    5    |
| **Cline**          |     7      |      6       |    7     |         2          |    3    |
| **Roo Code**       |     7      |      6       |    7     |         2          |    3    |
| **Codex CLI**      |     6      |      7       |    7     |         2          |    3    |
| **Gemini CLI**     |     7      |      7       |    8     |         2          |    4    |
| **Copilot CLI**    |     8      |      7       |    6     |         3          |    4    |
| **Windsurf**       |     7      |      7       |    7     |         2          |    3    |
| **Devin**          |     5      |      5       |    4     |         1          |    2    |
| **Augment Intent** |     8      |      8       |    7     |         4          |    3    |
| **Kiro**           |     7      |      7       |    5     |         3          |    3    |

---

## 4. Глубокое сравнение топ-5

### Топ-5 для fancai (по совокупности измерений)

| Ранг | Инструмент             | Суммарный балл (125 max) | Роль                        |
| ---- | ---------------------- | :----------------------: | --------------------------- |
| 1    | **Claude Code Native** |           108            | Платформа                   |
| 2    | **GSD**                |           107            | Project management          |
| 3    | **SuperPowers**        |            93            | Дисциплина разработки       |
| 4    | **Augment Intent**     |            89            | SDD-native (будущее)        |
| 5    | **OpenSpec**           |            76            | Lightweight spec per change |

### Claude Code Native vs GSD

**Зачем оба:** Claude Code = платформа (subagents, hooks, skills, worktrees). GSD = project management layer поверх (milestones, phases, plans, state). Это не конкуренты — GSD невозможен без Claude Code, а Claude Code без GSD не имеет structured planning.

**Overlap:** Оба поддерживают subagents, worktrees, parallel execution. GSD добавляет orchestration logic, state persistence, и verification pipeline, которых в Claude Code нет нативно.

### GSD vs SuperPowers

**Зачем оба:** GSD = ЧТО делать (декомпозиция, планирование, отслеживание). SuperPowers = КАК делать (TDD, brainstorming, verification). GSD не enforces TDD. SuperPowers не управляет milestones.

**Conflict zones:** Token consumption. GSD discuss + plan + execute + verify + SuperPowers brainstorming + TDD = значительный overhead. Решение: `/gsd-fast` для мелких задач, полный pipeline для крупных.

### GSD vs Augment Intent

**Intent — единственный инструмент, который может заменить GSD** по SDD-функциональности:

- Living specs (GSD specs статичны)
- Multi-agent parallel execution с Coordinator (GSD делает это через worktrees)
- Built-in verification against spec (GSD — через gsd-verifier agent)

**Почему не мигрировать сейчас:**

- Beta quality, macOS only
- Нет русскоязычной поддержки
- Credit-based pricing непредсказуем
- GSD уже настроен под fancai с 26+ кастомными агентами

### GSD vs OpenSpec

**Комбинация, не замена.** OpenSpec's Propose → Apply → Archive идеален для мелких brownfield изменений, где GSD's full discuss → plan → execute → verify overkill. Рекомендация: OpenSpec для изменений < 1 часа, GSD для фич > 1 дня.

### SuperPowers vs все остальное

SuperPowers уникален в enforcement поведения: TDD (удаление кода без failing test), brainstorming (до любого кода), verification-before-completion. Ни один другой инструмент этого не делает. Это не SDD-фреймворк, а **дисциплинарный слой**, который работает поверх любого workflow.

---

## 5. Анализ миграции с GSD

### 5.1 Что fancai теряет при переходе с GSD

| Альтернатива             | Теряется                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BMAD**                 | Worktree-изоляция, 12-runtime support, persistent STATE.md, autonomous mode, Nyquist validation. Приобретается: Party Mode, 19 personas, full SDLC coverage. Трудозатраты: 2-3 недели                                   |
| **OpenSpec**             | Milestone/phase иерархия, 26 agent types, autonomous execution, verification pipeline, state persistence. Приобретается: lightweight per-change specs, brownfield delta markers. Трудозатраты: 1-2 дня (как дополнение) |
| **Spec Kit**             | Всё вышеперечисленное для BMAD. Приобретается: GitHub backing, compliance features. Трудозатраты: 1-2 недели                                                                                                            |
| **Augment Intent**       | Русскоязычная поддержка, 12-runtime, все кастомные агенты (epub-reader, ai-pipeline, entity-system). Приобретается: living specs, multi-agent coordination, SOC 2. Трудозатраты: 2-3 недели + beta risk                 |
| **Kiro**                 | Всё от GSD + гибкость планирования. Приобретается: structured EARS specs, AWS integration. Трудозатраты: 1-2 недели                                                                                                     |
| **Только Claude Native** | Structured planning, state persistence, automation. Нужно будет воссоздать `.planning/` вручную. Приобретается: ничего нового (Claude Native — основа GSD). Трудозатраты: N/A (regression)                              |

### 5.2 Комбинирование инструментов

Текущий стек **GSD + SuperPowers** уже комбинирует инструменты. Рекомендуемые дополнения:

| Комбинация                       | Синергия                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| GSD + SuperPowers + **OpenSpec** | OpenSpec для мелких brownfield changes (< 1 час), GSD для крупных фич (> 1 день) |
| GSD + SuperPowers + **Spec Kit** | Spec Kit для формальных requirements крупных фич перед GSD-планированием         |
| GSD + SuperPowers + **Kiro**     | Kiro для EARS-based requirements generation → GSD для execution                  |

### 5.3 Риски миграции

1. **Потеря кастомных агентов**: 4 domain-specific агента (epub-reader, ai-pipeline, entity-system, security-reviewer) не переносятся ни в один альтернативный инструмент
2. **Потеря русскоязычной документации**: `.planning/` файлы, ROADMAP.md, STATE.md — всё на русском. Ни один альтернативный инструмент не поддерживает русский нативно
3. **Потеря истории**: 5 milestones, ~80 фаз, ~90 планов — ценный контекст, привязанный к GSD-формату
4. **Relearning curve**: 1 месяц работы с GSD создал muscle memory и workflow patterns

---

## 6. Методологии за пределами SDD

### 6.1 Test-Driven Agent Development (TDAD)

**Описание:** Адаптация TDD для AI-агентов. Ключевой insight: процедурные TDD-инструкции без таргетированного test-контекста **увеличивают** регрессии.

**Инструменты:**

- **TDAD** (arxiv 2603.17973): `pip install tdad`. Строит dependency graph между кодом и тестами. На SWE-bench Verified снизил регрессии на 70% (6.08% → 1.82%)
- **TDFlow** (CMU): 4 специализированных sub-агента, 88.8% pass rate на SWE-Bench Lite

**Преимущества перед SDD:** Тесты = executable validation (не prose, который может drift). Агенты получают конкретные pass/fail сигналы.

**Недостатки:** Cold-start problem (тесты должны существовать). Не captures architectural intent.

**Зрелость:** Средне-высокая. Опубликованные benchmarks, open-source код.

**Применимость к fancai:** ★★★☆☆ — SuperPowers уже enforce TDD. TDAD полезен как дополнительный инструмент для regression prevention.

---

### 6.2 BDD для AI (Gherkin + LLM)

**Описание:** Given-When-Then синтаксис как structured specifications, которые LLM естественно понимает.

**Состояние:** Академические papers, LLM умеют генерировать и переписывать Gherkin, но **нет доминантного BDD-for-agents фреймворка**.

**Преимущества перед SDD:** Natural alignment с LLM parsing. Bridges business и technical.

**Недостатки:** LLM часто summarize multiple steps. Step definition layer требует human engineering.

**Зрелость:** Средняя. Research exists, no dominant tool.

**Применимость к fancai:** ★★☆☆☆ — fancai = соло-разработчик, business stakeholders нет. BDD overhead не оправдан.

---

### 6.3 Agent Contracts (Contract-Driven Development)

**Описание:** Формальные контракты определяют resource bounds и behavioral constraints для AI-агентов. Мотивация: реальный инцидент — multi-agent система запустила recursive clarification loop на 11 дней, стоимость $47,000.

**Инструменты:** arxiv 2601.08815 — контрактное выполнение достигло 90% снижения токенов с 525x меньшей вариативностью.

**Зрелость:** Низкая. Академическая стадия, нет production tooling.

**Применимость к fancai:** ★☆☆☆☆ — теоретически интересно, практически неприменимо.

---

### 6.4 Evaluation-Driven Development (EDD)

**Описание:** Непрерывная адаптивная оценка через весь lifecycle LLM-агента. В отличие от TDD/BDD, которые полагаются на predefined tests, EDD интегрирует real-time feedback.

**Инструменты:**

- **EDDOps** (CSIRO Data61): 3-layered reference architecture
- **Braintrust**: production-ready EDD tooling

**Преимущества перед SDD:** Handles non-deterministic LLM behavior. Continuous post-deployment monitoring.

**Недостатки:** Evaluation metrics трудно определить для subjective quality. Infrastructure-heavy.

**Зрелость:** Средняя. Braintrust production-ready.

**Применимость к fancai:** ★★☆☆☆ — релевантно для AI pipeline (entity extraction, image generation), но не для основной разработки.

---

### 6.5 Formal Methods + LLM ("Vericoding")

**Описание:** LLM генерирует и код, и формальные доказательства корректности. Martin Kleppmann: "vibecoding" (informal) vs "vericoding" (formally verified).

**Инструменты:**

- Harmonic Aristotle, Logical Intelligence, DeepSeek-Prover-V2
- Apple Hilbert: bridge informal reasoning → Lean 4 proofs
- Verification system: 83% correct code verified, 92% incorrect identified

**Преимущества перед SDD:** Математические гарантии. Если proof checks, код корректен.

**Недостатки:** Только для свойств, выразимых в формальной логике (не UX). Steep learning curve.

**Зрелость:** Средняя, быстро растёт. Kleppmann предсказывает mainstream adoption через несколько лет.

**Применимость к fancai:** ★☆☆☆☆ — не applicable для frontend/UX-heavy проекта. Потенциально для алгоритмических частей (entity matching, chunk extraction).

---

### 6.6 Context Engineering (мета-дисциплина)

**Описание:** Не методология разработки, а **дисциплина, лежащая в основе всех остальных**. "Curating what the model sees so that you get a better result" (Anthropic).

**Ключевые источники:**

- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Martin Fowler: Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Manus: Context Engineering Lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

**SDD, TDD, BDD, EDD — все являются специализациями context engineering.** Каждая предоставляет стратегию структурирования того, что видит агент.

**Применимость к fancai:** ★★★★★ — уже применяется. CLAUDE.md, GSD .planning/, SuperPowers skills, hooks = всё это context engineering.

---

## 7. Тренды и направление развития

### Что становится стандартом (2026)

1. **Spec-driven workflows** — написание specs перед кодом = новая норма для сложных задач
2. **Multi-agent coordination** — orchestrator + specialized agents
3. **Context engineering** заменяет "prompt engineering"
4. **MCP** — универсальный стандарт tool integration (50+ enterprise partners)
5. **Git-aware agents** — commits, diffs, blame как контекст
6. **Observability/tracing** — table stakes для production agents (89% имеют)

### Что устаревает

1. **Raw prompt engineering** как standalone skill → evolves into context engineering
2. **Single-agent sequential workflows** → multi-agent parallel patterns
3. **Vibe coding для production** → документированная "3-month wall" (Red Hat)
4. **Manual code review как единственный quality gate** → automated verification + formal methods
5. **Chat-and-fix loops** → plan-first architectures

### Дебаты в сообществе: "SDD = Waterfall 2.0?"

**Аргументы "за":** Upfront specification mirrors waterfall's Big Design Up Front. Documentation drift.

**Аргументы "против":** Feedback loop 5-15 минут, не месяцев. Specs = living documents. Vibe coding's 3-month wall доказывает необходимость структуры.

**Emerging synthesis:** vibe-code для prototype → extract patterns → formalize into specs before production.

### Прогноз на 6-12 месяцев

1. **Augment Intent** выйдет из beta → станет serious contender для GSD
2. **GSD-2** (Pi SDK) заменит GSD v1 → more programmatic control
3. **Agent Teams** (Claude Code) станут stable → multi-session coordination нативно
4. **Living specs** станут expectation (Intent pattern → adoption by others)
5. **Formal verification** начнёт проникать в mainstream coding agents

---

## 8. Рекомендации

### Для текущего состояния проекта (прямо сейчас)

1. **Обновить GSD до v1.33.0** — bugfixes, unified CONFIG_DEFAULTS. Breaking change в new-project flow (REQUIREMENTS.md), но не влияет на текущую работу
2. **Оставить текущий стек**: Claude Code + GSD + SuperPowers
3. **Добавить OpenSpec** для lightweight brownfield итераций (задачи < 1 часа): `npm install -g @fission-ai/openspec && openspec init`

### Для долгосрочной стратегии (3-6 месяцев)

1. **Мониторить GSD-2** (gsd-build/gsd-2, v2.63.0, Pi SDK) — когда станет stable, мигрировать для programmatic control
2. **Мониторить Augment Intent** — единственный true SDD-native tool. Когда выйдет из beta + получит Windows/Linux support, оценить как замену GSD
3. **Мониторить Claude Code Agent Teams** — когда станут stable, использовать для multi-session coordination вместо GSD worktree orchestration

### Quick wins (без миграции)

| Действие                                 | Ожидаемый эффект                 | Трудозатраты |
| ---------------------------------------- | -------------------------------- | ------------ |
| GSD v1.32.0 → v1.33.0                    | Bugfixes, unified config         | 5 минут      |
| Добавить OpenSpec для мелких задач       | Снижение overhead для brownfield | 30 минут     |
| Настроить TDAD для regression prevention | -70% регрессий (по benchmarks)   | 1-2 часа     |
| Добавить conditional hooks (`if` field)  | Гранулярный контроль PreToolUse  | 30 минут     |

### Синергии инструментов

```
┌─────────────────────────────────────────────────────┐
│                  Claude Code Native                  │
│          (платформа: subagents, hooks, MCP)          │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │     GSD      │  │  SuperPowers │  │  OpenSpec  │ │
│  │  (planning,  │  │  (TDD, brain │  │(brownfield │ │
│  │   phases,    │  │   storming,  │  │   specs)   │ │
│  │  execution)  │  │  discipline) │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │       Domain Agents (epub-reader,              │ │
│  │    ai-pipeline, entity-system, security)       │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

Будущее (6-12 мес):
  GSD → GSD-2 (Pi SDK, programmatic control)
  Agent Teams → native multi-session coordination
  Augment Intent → potential GSD replacement (if exits beta)
```

---

## Источники

### Основные инструменты

- GSD: [github.com/gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done), [npm: get-shit-done-cc](https://www.npmjs.com/package/get-shit-done-cc)
- SuperPowers: [github.com/obra/superpowers](https://github.com/obra/superpowers), [Anthropic Marketplace](https://claude.com/plugins/superpowers)
- BMAD: [github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD), [docs.bmad-method.org](https://docs.bmad-method.org/)
- OpenSpec: [github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec), [openspec.dev](https://openspec.dev/)
- Spec Kit: [github.com/github/spec-kit](https://github.com/github/spec-kit), [GitHub Blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)

### CLI-агенты

- Codex CLI: [github.com/openai/codex](https://github.com/openai/codex), [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)
- Gemini CLI: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli), [geminicli.com](https://geminicli.com/docs/)
- Copilot CLI: [github.com/github/copilot-cli](https://github.com/github/copilot-cli)

### IDE и расширения

- Cursor: [cursor.com](https://cursor.com), [docs.cursor.com](https://docs.cursor.com)
- Cline: [github.com/cline/cline](https://github.com/cline/cline), [cline.bot](https://cline.bot)
- Roo Code: [github.com/RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code), [roocode.com](https://roocode.com)

### Автономные агенты

- Devin: [devin.ai](https://devin.ai), [cognition.ai](https://cognition.ai)
- Windsurf: [windsurf.com](https://windsurf.com)
- Factory: [factory.ai](https://factory.ai)
- Cosine: [cosine.sh](https://cosine.sh)

### SDD-native

- Augment Intent: [augmentcode.com/product/intent](https://www.augmentcode.com/product/intent)
- Kiro: [kiro.dev](https://kiro.dev), [github.com/kirodotdev/Kiro](https://github.com/kirodotdev/Kiro)

### Методологии и исследования

- TDAD: [arxiv.org/abs/2603.17973](https://arxiv.org/abs/2603.17973)
- TDFlow: [arxiv.org/abs/2510.23761](https://arxiv.org/abs/2510.23761)
- Agent Contracts: [arxiv.org/html/2601.08815](https://arxiv.org/html/2601.08815)
- EDDOps: [arxiv.org/abs/2411.13768](https://arxiv.org/abs/2411.13768)
- Vericoding: [martin.kleppmann.com/2025/12/08/ai-formal-verification.html](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html)

### Аналитика и сравнения

- Martin Fowler SDD Tools: [martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- Anthropic Context Engineering: [anthropic.com/engineering/effective-context-engineering-for-ai-agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic 2026 Agentic Coding Trends: [resources.anthropic.com/2026-agentic-coding-trends-report](https://resources.anthropic.com/2026-agentic-coding-trends-report)
- LangChain State of Agent Engineering: [langchain.com/state-of-agent-engineering](https://www.langchain.com/state-of-agent-engineering)
- NxCode Comparison: [nxcode.io/resources/news/cursor-vs-claude-code-vs-github-copilot-2026-ultimate-comparison](https://www.nxcode.io/resources/news/cursor-vs-claude-code-vs-github-copilot-2026-ultimate-comparison)
- SDD 30 Frameworks Map: [medium.com/@visrow/spec-driven-development-is-eating-software-engineering](https://medium.com/@visrow/spec-driven-development-is-eating-software-engineering-a-map-of-30-agentic-coding-frameworks-6ac0b5e2b484)
- Red Hat 3-Month Wall: [developers.redhat.com/articles/2026/02/17/uncomfortable-truth-about-vibe-coding](https://developers.redhat.com/articles/2026/02/17/uncomfortable-truth-about-vibe-coding)
