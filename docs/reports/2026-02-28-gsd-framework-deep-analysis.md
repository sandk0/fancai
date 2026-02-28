# GSD Framework Deep Analysis

**Дата:** 2026-02-28
**Scope:** GSD (Get Shit Done) framework — GitHub issues, community feedback, alternatives comparison, configuration recommendations for fancai project
**Автор:** Claude Code

---

## Executive Summary

GSD — популярный мета-промптинг фреймворк для Claude Code с 22.1k звёзд на GitHub. Он решает проблему "context rot" через изоляцию субагентов, spec-driven workflow и атомарные Git-коммиты. Главные проблемы 2026 года: агрессивное потребление токенов для малых задач, "silent downgrade" модели в quality-профиле, нарушенный auto-advance chain, и отсутствие поддержки русского языка на уровне системы. Для fancai (brownfield, solo dev, React+FastAPI) оптимален профиль **balanced** с `/gsd:map-codebase` перед любым новым проектом и `commit_docs: false` для чистоты git-истории.

---

## Part 1: GSD Issues Deep Dive

### 1.1 Обзор репозитория

- **URL:** https://github.com/gsd-build/get-shit-done
- **Звёзды:** 22,100+
- **Форки:** 1,900+
- **Открытых issues:** 95
- **Версия на дату отчёта:** v1.21.0+
- **Пользователи в Discord:** 2,276

### 1.2 Проблемы с токенами и стоимостью

**Issue #120 — Существенный рост потребления токенов после обновления**

После версии v1.5.27 потребление токенов выросло примерно в 4 раза. Конкретные примеры:
- Простая смена цвета: было 2-3 минуты → стало 10 минут
- Один баг-фикс породил >100 агентов и потратил 10k токенов за 60 секунд
- Перемещение таблицы в collapsible card: более 200k токенов, 11+ минут только на планирование

**Вердикт разработчиков:** GSD создан для проектного масштаба. Для быстрых фиксов — использовать Claude напрямую, без GSD-команд.

**Issue #776 — Subagents в OpenCode потребляют лишние requests**

Субагенты при порождении создают неожиданные дополнительные API-запросы. Это увеличивает cost для pay-per-token пользователей.

**Issue #749 — Feature request: Local LLM offloading для hook-level операций**

Пользователи просят возможность запускать хуки (statusline, context monitor) на локальных LLM, чтобы сэкономить на API-вызовах.

### 1.3 Проблемы качества планов

**Issue #695 — Quality profile silently downgrades researcher/planner to Sonnet (статус: in-progress, PR #755)**

Критическая проблема: при использовании `quality` профиля GSD конвертирует "opus" в "inherit" в `gsd-tools.cjs`. "inherit" резолвится в модель родительского процесса — а это по умолчанию Sonnet 4.6 в Claude Code. Результат: пользователи думают, что получают Opus-качество, а реально получают Sonnet.

**Issue #680 — Balanced config использует Sonnet для researcher (статус: medium priority)**

Даже balanced профиль некорректно назначает модели для researcher-агента.

**Issue #754, #757, #760 — Milestone/phase completion reporting inaccuracies**

Система неверно сообщает о завершении фаз/milestone — продолжает показывать "complete", когда ещё остались планы для выполнения.

**Issue #803 — Questions auto-answered incorrectly**

В interactive-режиме система иногда автоматически отвечает на вопросы, которые должны задаваться пользователю, с некорректными предзаполненными ответами.

### 1.4 Интеграционные проблемы с обновлениями Claude Code

**Issue #218 — GSD commands не работают после обновления Claude Code**

Claude Code 2.1.x изменил механизм discovery команд:
- Старый путь: `~/.claude/commands/gsd/` с синтаксисом `/gsd:help`
- Новый путь: `~/.claude/skills/gsd-<command>/SKILL.md` с синтаксисом `/gsd-help`
- Двоеточия в именах команд больше не поддерживаются

Статус: **Закрыто**, формат обновлён.

**Issue #731 — CODEX INSTALL NOT WORKING**

Установка через `npx get-shit-done-cc` для Codex runtime не работает несмотря на заявленную поддержку (открыто 24 февраля 2026).

**Issue #732 — plan-phase agent chain freezes on Windows**

Зависание при выполнении chain агентов под Windows.

### 1.5 Проблемы субагентов

**Issue #671 — Subagents don't receive project CLAUDE.md (ЗАКРЫТО: исправлено commit 8fd7d0b)**

Исполнительные агенты (gsd-executor, gsd-planner, gsd-researcher) не получали project-level CLAUDE.md. Это означало, что все project-specific инструкции, установленные skills и coding guidelines были невидимы для агентов, реально пишущих код.

Последствия, обнаруженные пользователем: после 41 плана в 6-фазном Next.js/Prisma проекте — security issues и quality gaps, которых можно было избежать. Теперь исправлено: агенты находят и загружают project CLAUDE.md и skills при запуске.

**Issue #668 — Auto-advance chain drops source code commits**

При использовании `/gsd:discuss-phase --auto` (автоматическая цепочка discuss→plan→execute) executor записывает все файлы, но не коммитит их. Вся working tree остаётся dirty.

Причина: дополнительный уровень вложенности Task-вызовов при auto-advance создаёт такую глубину нестинга, что git-коммиты executor'а не persist'ятся в working directory.

Статус: частично исправлено (commit 72d6554 добавляет verify-and-recover шаг после возврата execute-phase).

**Issue #677 — Claude bypasses GSD workflow in yolo mode**

В режиме auto-approve Claude pattern-matches простые запросы как тривиальные и отправляет код напрямую через Edit/Write tools, минуя GSD-команды. STATE.md при этом не обновляется.

### 1.6 Context Window Monitor (v1.20.6)

Добавлен hook с WARNING/CRITICAL алертами при превышении порогов использования контекста агента. Позволяет отслеживать, когда агент приближается к своему лимиту.

**Issue #769 — Context calculation incorrect for actual Claude Code context window**

Расчёт контекста в `gsd-statusline.js` некорректен для реального размера окна контекста Claude Code (low priority bug, open).

### 1.7 Nyquist Validation Layer (v1.20.6)

Слой валидации встроен в pipeline plan-phase для выявления проблем качества до исполнения. Реализует Dimension 8 в gsd-plan-checker — "автоматическая feedback архитектура".

**Issue #725 — nyquist_validation config setting ignored**

Конфиг `workflow.nyquist_validation: false` не срабатывает корректно — валидация продолжает выполняться.

### 1.8 YAML Frontmatter Sync (v1.21.0)

YAML frontmatter синхронизируется в STATE.md для machine-readable отслеживания статуса. Позволяет автоматизированным инструментам парсить состояние проекта без NLP.

**Issue #790 — commit_docs: false ignored — .planning/ files still committed**

Даже при `commit_docs: false` файлы `.planning/` продолжают коммититься в git. (open, needs-triage).

**Важно для fancai:** Наш `commit_docs` работает и эта проблема может затрагивать нас — проверить версию GSD.

### 1.9 Поддержка русского языка

Нет ни одного специфичного issue о русском языке в GSD. Фреймворк не имеет встроенной i18n поддержки — все системные файлы (.planning/PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md) генерируются на английском по умолчанию.

**Текущий workaround в fancai:** Мы уже реализовали кастомное правило через `.claude/rules/gsd-russian.md`, которое форсирует генерацию GSD-артефактов на русском. Это работает через CLAUDE.md инструкции к Claude — не через изменение GSD-системы.

**Риск:** После каждого обновления GSD нужно проверять, что новые шаблоны документов не "перетирают" русскоязычные настройки.

---

## Part 2: Community Feedback

### 2.1 Позитивный опыт

**23-план проект за ~4 дня (Threads, @sethsandler)**

> "Just finished a 23-plan development project with Claude Code using the GSD framework. Each task getting Claude's full attention without context degradation or compaction. Changed how I think about AI coding."

**GSD для solo dev (100k строк за 2 недели)**

Один разработчик произвёл 100,000 строк кода за 2 недели с хирургически точными, трассируемыми коммитами.

### 2.2 Критика

**Token costs для subscription пользователей**

На Anthropic Pro лимиты исчерпываются менее чем за час активной работы. GSD design изначально ориентирован на API-пользователей, а не подписчиков.

**"Bonfire of tokens"**

Цитата: "Overly ambitious projects will just end up as a bonfire of tokens." GSD требует дисциплины в определении масштаба задач.

**Workflow bypass в auto mode**

GSD легко обходится в yolo-режиме, что делает STATE.md неактуальным.

**Добавленная статья The New Stack (beating-the-rot-and-getting-stuff-done)**

Позиционирует GSD как решение для "context rot" — GSD экстернализирует состояние в файлы, разбивает работу на маленькие планы, исполняет каждый в свежем контексте и верифицирует против явных целей. Вывод: для серьёзных проектов подход работает.

### 2.3 Discord статистика

2,276 участников в официальном Discord: https://discord.com/invite/5JJgD5svVS

---

## Part 3: GSD Alternatives

### 3.1 BMAD (Breakthrough Method for Agile AI Driven Development)

- **GitHub:** https://github.com/bmad-code-org/BMAD-METHOD
- **Звёзды:** 25,500+ (основной repo) + 6,500 (старая версия bmadcode/BMAD-METHOD)
- **Форки:** 3,600+

**Что это:** Полноценная симуляция agile-команды с 12+ специализированными AI-агентами (PM, Architect, Developer, UX Designer, QA, Scrum Master, Business Analyst и др.). Party Mode позволяет агентам коллаборировать.

**Ключевые отличия от GSD:**
| Аспект | GSD | BMAD |
|--------|-----|------|
| Сложность setup | Минуты | Дни |
| Агентов | 3-5 | 12+ |
| Документация | Минимальная | Обширная |
| Команды | 1-3 | 5+ |
| Compliance/аудит | Низкий | Высокий |
| Для solo dev | Идеально | Overkill |

**Когда использовать BMAD вместо GSD:**
- Команда 5+ разработчиков
- Regulated industries с требованиями к документации
- Проект требует полных audit trails
- Нужна формальная роль PM, Architect в процессе

**Для fancai:** BMAD избыточен. 25k звёзд говорят о популярности, но для solo dev с brownfield проектом это лишние 3-5 дней настройки ради агентов-ролей, которые один разработчик не использует.

### 3.2 RALPH (Autonomous AI Development Loop)

- **GitHub:** https://github.com/frankbria/ralph-claude-code
- **Звёзды:** 7,400+
- **Форки:** 517+
- **Также:** https://github.com/snarktank/ralph (оригинальный)

**Что это:** По своей сути — while-loop в bash, который запускает Claude Code снова и снова до завершения PRD-задач. Каждая итерация — свежий контекст. Назван в честь персонажа Симпсонов (Ralph Wiggum) как метафора упрямой настойчивости.

**Ключевые характеристики:**
- Dual-condition exit detection: требует И completion indicators, И явного EXIT_SIGNAL
- Rate limiting: 100 вызовов/час (configurable)
- Circuit breaker: predотвращает infinite loops
- Session continuity: 24-часовая сессия
- Размер: 7,000 токенов (самый лёгкий инструмент в категории)

**Заявленные результаты:**
- Проект на $50,000 выполнен за $297 API costs (99.4% savings)
- 6 хакатон-репозиториев сгенерировано за ночь

**Когда использовать RALPH вместо GSD:**
- CI/CD автоматизация и DevOps pipelines
- Задачи с встроенными success signals (тесты проходят/не проходят, типы резолвятся, линтер одобряет)
- Ночная работа без надзора
- Итеративный рефактор с чёткими acceptance criteria

**Когда RALPH не подходит:**
- Задачи, требующие "taste and narrative" (продуктовые решения, UX)
- Interdependent tasks без чёткого порядка
- Когда нужна spec-driven документация

**Для fancai:** Ralph интересен для конкретных автоматизируемых задач (например, "fix all TypeScript errors", "ensure all tests pass"). Не замена GSD для фазового планирования.

### 3.3 Сравнительная таблица

| Фактор | GSD | BMAD | RALPH |
|--------|-----|------|-------|
| GitHub Stars | 22.1k | 25.5k | 7.4k |
| Setup | Минуты | Дни | Часы |
| Команда | Solo/1-3 | 5+ | 2-5 |
| Autonomy | Направляемый | Структурированный | Полностью авт. |
| Token cost | Средний-высокий | Высокий | Низкий |
| Документация | Хорошая | Обширная | Минимальная |
| Brownfield support | /gsd:map-codebase | Architect agent | Нет |
| Русский язык | Нет (workaround) | Нет | N/A |
| Context rot fix | Изоляция субагентов | Multi-agent roles | Fresh iter. |

### 3.4 Другие фреймворки

**Superpowers** — Сидит между GSD и Ralph. Форсирует паузы в нужных местах вместо свободного запуска. Менее известен, но отмечается как баланс между контролем и автономией.

**GitHub Spec Kit (kiro)** — Microsoft-ориентированный подход. Requirements → Design → Tasks → Implementation. Лучше интегрируется с GitHub ecosystem, но менее гибкий чем GSD.

**claude-code-spec-workflow** — Лёгкий вариант: два workflow (spec-driven для новых фич + streamlined bug fix). GitHub: https://github.com/Pimzino/claude-code-spec-workflow

---

## Part 4: Configuration Analysis for fancai

### Профиль проекта

- Single developer (solo)
- Brownfield: 5.5 месяцев в разработке
- Stack: React 19 + FastAPI (medium complexity)
- Production: 8GB VPS
- 6-phase roadmap, 30 requirements
- Уже используется GSD с кастомными правилами на русском

### 4.1 Quality vs Balanced: Стоит ли quality профиль для solo dev?

**Краткий ответ: Нет, для большинства задач.**

**Balanced профиль (рекомендован):**
- Opus только для planning-агента (где принимаются архитектурные решения)
- Sonnet для execution и verification
- Логика: "Planning contains the reasoning work, while execution follows those explicit instructions"
- Экономия ~62% vs quality профиля

**Quality профиль:**
- Opus для всех decision-making агентов
- **КРИТИЧЕСКИЙ БАГ (Issue #695, in-progress):** Quality профиль silently downgrade Opus до Sonnet из-за `"inherit"` в gsd-tools.cjs. Вы платите за "quality" но получаете "balanced" качество.
- Имеет смысл только для критических архитектурных решений, когда баг будет исправлен

**Рекомендация для fancai:**

```
Фаза "Production Safety" (текущая Phase 1) → balanced
Сложные архитектурные решения → временно quality (после исправления #695)
Рутинная реализация → balanced
Документация/исследования → budget
```

**Adaptive approach** (из feature request):
- Discovery/exploration → budget
- Architecture design → quality
- Implementation → balanced
- Debugging → quality
- Documentation → budget

### 4.2 Что означает "comprehensive" depth vs "standard"?

Из конфига:
- `"quick"` → 3-5 phases (быстрые прототипы)
- `"standard"` → 5-8 phases (типичные проекты)
- `"comprehensive"` → 8-12 phases (крупные системы)

**Количество планов на фазу:**
GSD рекомендует 2-3 atomic task плана на фазу. `min_plans_for_parallel: 2` — порог для параллельного выполнения.

**Для fancai:**
- У нас уже 6-phase roadmap с 30 requirements
- Это примерно 5-6 планов на фазу (30/6=5)
- Это соответствует `"standard"` depth
- `"comprehensive"` добавит overhead без пользы для solo dev

### 4.3 Должен ли commit_docs быть true?

**Текущая рекомендация: `commit_docs: false` для fancai**

Причины:

1. **Git history pollution:** С `commit_docs: true` каждое обновление STATE.md/ROADMAP.md/SUMMARY.md создаёт отдельный коммит. При 30 требованиях и 6 фазах — десятки "docs: update state" коммитов засоряют `git log`.

2. **Issue #790 актуален:** `commit_docs: false` иногда игнорируется (open bug). Это означает, что даже при false файлы могут коммититься.

3. **GSD design philosophy:** "Commit outcomes, not process." Документация планирования — это process, source code — outcomes. Исходная идея GSD: `.planning/` в `.gitignore` для приватности.

4. **Для open source проекта:** Если fancai станет open source, `.planning/` файлы должны оставаться приватными.

**Если хотите commit_docs: true**, используйте branching strategy: "phase" — planning files попадают в отдельную branch и merge только при завершении фазы.

### 4.4 Рекомендуемый parallelization setting

```json
{
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "skip_checkpoints": false,
    "max_concurrent_agents": 2,
    "min_plans_for_parallel": 2
  }
}
```

**Объяснение:**
- `task_level: false` — экспериментальная функция, не использовать в production brownfield
- `max_concurrent_agents: 2` — для 8GB VPS и subscription лимитов лучше 2 чем дефолтные 3
- `skip_checkpoints: false` — для brownfield важно не пропускать validation checkpoints

### 4.5 Сколько планов на фазу — типично?

**Официальная рекомендация:** 2-3 atomic task плана на фазу, каждый план — 2-3 задачи.

**В реальности:** Пользователь с 23-план проектом имел 4 фазы → ~5-6 планов на фазу. Это коррелирует с нашим fancai: 30 requirements / 6 phases = 5 планов на фазу.

**Для Phase 1 (Production Safety):**
- 2 sub-плана (01-01-PLAN.md, 01-02-PLAN.md) — корректный размер
- Не добавлять более 3-4 планов на фазу для solo dev

---

## Рекомендации

| # | Рекомендация | Приоритет | Сложность |
|---|--------------|-----------|-----------|
| 1 | Переключиться на balanced профиль если сейчас quality (из-за bug #695) | P0 | Низкая |
| 2 | Установить `commit_docs: false` и добавить `.planning/` в `.gitignore` | P1 | Низкая |
| 3 | Запустить `/gsd:map-codebase` перед каждой новой фазой | P1 | Низкая |
| 4 | НЕ использовать `--auto` флаг (bug #668 — commits drops) | P1 | Низкая |
| 5 | Отключить `workflow.research` если домен хорошо знаком | P2 | Низкая |
| 6 | Установить `max_concurrent_agents: 2` (VPS лимиты) | P2 | Низкая |
| 7 | Проверять, что rule `gsd-russian.md` применяется после каждого GSD update | P2 | Средняя |
| 8 | Для мелких фиксов — использовать Claude напрямую без GSD-команд | P1 | Низкая |
| 9 | Мониторить исправление bug #695 (quality profile silent downgrade) | P2 | Низкая |

---

## Next Steps

1. Проверить текущую версию GSD и обновить до latest (`npx get-shit-done-cc@latest`)
2. Запустить `/gsd:map-codebase` для текущего состояния codebase перед Phase 1
3. Установить `commit_docs: false` в `.planning/config.json`
4. Переключить `model_profile` на `"balanced"` до исправления issue #695
5. Добавить `.planning/` в `.gitignore` если `commit_docs: false`

---

## Sources

- [GitHub — gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)
- [GSD Issues — Open](https://github.com/gsd-build/get-shit-done/issues)
- [Issue #218 — Commands after Claude Code update](https://github.com/glittercowboy/get-shit-done/issues/218)
- [Issue #668 — Auto-advance drops commits](https://github.com/gsd-build/get-shit-done/issues/668)
- [Issue #671 — Subagents don't receive CLAUDE.md](https://github.com/gsd-build/get-shit-done/issues/671)
- [Issue #120 — Token usage 4x increase](https://github.com/gsd-build/get-shit-done/issues/120)
- [Issue #695 — Quality profile silent downgrade](https://github.com/gsd-build/get-shit-done/issues/695)
- [Release v1.20.6 — Context window monitor + Nyquist](https://github.com/gsd-build/get-shit-done/releases/tag/v1.20.6)
- [Release v1.21.0 — YAML frontmatter sync](https://github.com/gsd-build/get-shit-done/releases/tag/v1.21.0)
- [GSD Model Profiles and Optimization](https://zread.ai/gsd-build/get-shit-done/20-model-profiles-and-optimization)
- [GSD Workflow Agent Configuration](https://zread.ai/gsd-build/get-shit-done/21-workflow-agent-configuration)
- [GSD Issues and Feedbacks](https://zread.ai/gsd-build/get-shit-done/7-issues-and-feedbacks)
- [GitHub — bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- [GitHub — frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code)
- [Goodbye Vibe Coding: GSD vs BMAD vs RALPH comparison](https://pasqualepillitteri.it/en/news/158/framework-ai-spec-driven-development-guide-bmad-gsd-ralph-loop)
- [Medium — Agent Native: GSD Meta-prompting Review](https://agentnativedev.medium.com/get-sh-t-done-meta-prompting-and-spec-driven-development-for-claude-code-and-codex-d1cde082e103)
- [Medium — Joe Njenga: Testing GSD](https://medium.com/@joe.njenga/i-tested-gsd-claude-code-meta-prompting-that-ships-faster-no-agile-bs-ca62aff18c04)
- [GSD User Guide](https://github.com/gsd-build/get-shit-done/blob/main/docs/USER-GUIDE.md)
- [Hacker News — Excessive Token Usage](https://news.ycombinator.com/item?id=47096937)
- [The New Stack — Beating Context Rot](https://thenewstack.io/beating-the-rot-and-getting-stuff-done/)
- [Medium — Ralph Autonomous Coding](https://lmishra.substack.com/p/ralph-autonomous-coding-with-claude)
- [Threads — Seth Sandler: 23-plan project](https://www.threads.com/@sethsandler/post/DUUlWlwkehB/just-finished-a-plan-development-project-with-claude-code-using-the-gsd-get)
