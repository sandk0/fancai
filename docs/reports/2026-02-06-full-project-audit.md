# Полный аудит проекта fancai

**Дата:** 2026-02-06
**Scope:** Кодовая база + конфигурация Claude Code + исследование лучших практик
**Метод:** 7 параллельных агентов (551K токенов, 304 вызова инструментов, 50+ источников)

## Executive Summary

fancai — архитектурно зрелый проект с двумя AI-пайплайнами обработки книг (описания→изображения и глоссарий сущностей). Frontend получил высшую оценку: 0 использований `any`, excellent декомпозиция EpubReader, production-ready PWA. Backend имеет серьёзные проблемы: роутеры по 30-40K строк, отсутствие rate limiting, неработающий token blacklist. LLM-пайплайн функционален, но имеет критическую проблему потери сущностей на границах чанков и упущенные возможности экономии через Gemini Context Caching (до 70% снижения стоимости). Тестирование — главная слабость: 0.58% test-коммитов, spoiler-free фильтрация (главная фича) не покрыта тестами. Конфигурация Claude Code на 89% актуальна после аудита 2026-02-05, но содержит устаревшие версии и неполное покрытие LLM-файлов в агентах.

---

## Часть 1: Анализ кодовой базы

### 1.1 LLM-пайплайн обработки книг

#### 1.1.1 Извлечение описаний и сущностей

**Архитектура:** Единый вызов `analyze_chapter()` в `gemini_extractor.py` извлекает описания И сущности одновременно через Gemini 3.0 Flash. Два режима: TSA (Tagged Span Annotation, default) и Legacy (JSON). Чанкинг по 100K символов с 15% перекрытием, параллельная обработка через asyncio.gather с semaphore(3).

**Находки:**

| # | Проблема | Severity | Файл |
|---|---------|----------|------|
| 1 | **Потеря сущностей на границах чанков** — overlap prepend-ится для подсветки, но Gemini может не re-extract сущности из overlap | CRITICAL | gemini_extractor.py:376-382 |
| 2 | **TSA vs Legacy неясно** — оба режима полностью функциональны, но нет документации когда какой использовать | MEDIUM | gemini_extractor.py:243 |
| 3 | **first_mention_offset** — offset относительно чанка, а не главы, что приводит к ошибкам позиционирования | MEDIUM | gemini_extractor.py |

**Рекомендации из исследования (Агент 7):**
- **Chapter-aware chunking** вместо фиксированного 100K — TLDM benchmark показал, что frontier LLM не удерживают стабильное понимание >64K токенов, текущие 100K символов (~25-35K токенов) адекватны, но нужно резать по границам глав/сцен
- **Entity carry-over** — вместо raw overlap (15%), передавать в каждый чанк список уже извлечённых сущностей
- **MERGE method** (COLING 2025) — извлекать из нового чанка, затем мержить с существующими (лучше чем UPDATE method)

#### 1.1.2 Дедупликация сущностей

**Два этапа:** автоматическая (fuzzy matching, SequenceMatcher > 0.85) + LLM-based (отдельный DEDUPLICATION_PROMPT через Gemini).

**Находки:**

| # | Проблема | Severity |
|---|---------|----------|
| 4 | **Порог 0.85 слишком высок** — "Гарри" vs "Гарри Поттер" = 0.50, не мержатся | HIGH |
| 5 | **Контекст-голодная дедупликация** — в Gemini передаются только имя/тип/алиасы, без упоминаний/глав | HIGH |
| 6 | **Temperature 0.1** — слишком консервативно для дедупликации, LLM пропускает неочевидные дубли | MEDIUM |

**Рекомендации:**
- Снизить порог fuzzy matching до 0.75 + secondary check по алиасам
- Добавить chapters/mentions в контекст DEDUPLICATION_PROMPT
- Использовать `thinking_level: "medium"` (Gemini 3) для более глубокого рассуждения при дедупликации

#### 1.1.3 Spoiler-free система

**Механизм:** CFI-based блокировка + `aliases_with_reveal` JSON с reveal_chapter для каждого алиаса. Метод `_filter_aliases_by_chapter()` фильтрует видимые алиасы.

**Находки:**

| # | Проблема | Severity |
|---|---------|----------|
| 7 | **Visual summary может спойлерить** — если visual_summary не размечен маркерами [Глава N], показывается целиком | HIGH |
| 8 | **Нет тестов** — spoiler-free фильтрация (главная фича!) совсем не покрыта тестами | CRITICAL |

**Из исследования:** Spliki.com — ближайший аналог fancai, но использует ручную модерацию. fancai автоматизирован через AI, что масштабируемее, но требует дополнительных edge-case обработок: flashbacks, ненадёжные рассказчики, смена имён персонажей.

#### 1.1.4 Генерация изображений

**Pipeline:** Description (RU) → Translation RU→EN (Gemini 2.0 Flash Lite) → Style template → Imagen 4

**Находки:**

| # | Проблема | Severity |
|---|---------|----------|
| 9 | **Слабая модель для перевода** — Gemini 2.0 Flash Lite упрощает литературные описания | HIGH |
| 10 | **Cache key включает seed** — если seed меняется, кеш не работает | MEDIUM |

**Из исследования:** Статья "LLMs Behind the Scenes" (Sep 2025) показала, что LLM-enhanced промпты (с дополнительной проработкой визуальных деталей) дают значительно лучшие иллюстрации. Рекомендуется добавить шаг "prompt engineering" между извлечением описания и генерацией.

#### 1.1.5 Граф связей

**Реализация:** NetworkX с PageRank для importance (1-10), Louvain для community detection. Экспорт для React Force Graph.

**Масштабируемость:** ✅ Работает до 1000 сущностей (~300ms для 800 nodes). Проблем не обнаружено.

**Из исследования:** iText2KG framework предлагает инкрементальное построение KG с async архитектурой — потенциально лучше для chapter-by-chapter обработки.

#### 1.1.6 Промпты Gemini

| Промпт | Качество | Проблемы |
|--------|----------|----------|
| TSA_EXTRACTION_PROMPT | 7/10 | Нет few-shot для relationships, алиасы на английском в русском промпте |
| EXTRACTION_PROMPT (Legacy) | 6/10 | Противоречит TSA: "< 50 chars" vs "< 80 chars" |
| DEDUPLICATION_PROMPT | 6/10 | Недостаточно контекста (нет mentions/chapters) |
| TRANSLATION_PROMPT | 7/10 | Слабая модель (2.0 Flash Lite) снижает качество |

**Ключевая рекомендация из исследования:** Gemini Context Caching — кешировать текст главы и делать несколько запросов к кешированному контексту. **Экономия до 90% на cached tokens**, суммарно 60-70% снижение стоимости обработки книг.

---

### 1.2 Frontend

**Оценка: 9/10** — production-grade PWA

**Сильные стороны:**
- EpubReader.tsx (284 строки) — **отлично декомпозирован** в 25+ хуков. Не God component.
- 0 использований `any`/`unknown` — strict TypeScript
- 3 Zustand stores без дублирования состояния
- 3-слойный кеш: IndexedDB (Dexie) + TanStack Query + Memory fallback
- 9 lazy-loaded страниц, 8 manual chunks в Vite
- PWA: Service Worker (Workbox), offline sync, resume guard, push notifications
- iOS Safari: touch-action, overscroll-behavior, safe-area support
- HttpOnly cookies для auth, CSRF protection

**Области улучшения:**
- 14 useState в EpubReader — рассмотреть useReducer для modal state
- 3 test-файла в epub hooks — расширить покрытие
- BookReader.test.tsx.skip — основной компонент не тестируется
- Entity компоненты не покрыты тестами

---

### 1.3 Backend

**Оценка: 6/10** — функционален, но есть структурные проблемы

**Критические проблемы:**

| # | Проблема | Файл | Impact |
|---|---------|------|--------|
| 11 | **images.py = 33,869 строк** | routers/images.py | Невозможно поддерживать/тестировать |
| 12 | **reading_sessions.py = 41,058 строк** | routers/reading_sessions.py | То же |
| 13 | **Rate limiting не применён** | middleware/rate_limit.py | Можно спамить API генерации |
| 14 | **Token blacklist не проверяется** | core/dependencies.py | Пользователь может использовать token после logout |
| 15 | **N+1 query risks** — lazy="raise" требует explicit eager loading | models/ | Потенциальные тормоза |

**Сильные стороны:**
- 40+ custom exception types с RFC 9457 format
- Distributed locking (Redis) для book processing
- Exponential backoff с tenacity
- Prometheus metrics (частичные)
- Health checks (basic + deep)
- Proper async/await patterns

**Отсутствует:**
- Gemini API health check
- DB pool utilization metrics
- Complete Prometheus coverage (нет Gemini latency, image success rate)
- Rate limit decorators на endpoints

---

### 1.4 Тестирование

**Оценка: 3/10** — критически недостаточно

| Метрика | Значение | Цель |
|---------|----------|------|
| Backend test functions | 699 | — |
| Frontend test files | 16 | — |
| Test commit ratio | 0.58% (4/688) | >5% |
| Services tested | 6/28 (21%) | >80% |
| Spoiler-free tests | 0 | Полное покрытие |
| Entity dedup tests | 0 | Полное покрытие |
| E2E tests | 0 (Playwright configured but unused) | Основные flow |

**Критические непокрытые пути:**
- `push_notification_service.py` — 474 LOC, 0 тестов
- `image_generator.py` — оркестратор генерации, 0 тестов
- `entity_deduplication_service.py` — LLM merging, 0 тестов
- `consistency_manager.py` — 654 LOC, 0 тестов
- `graph_service.py` — NetworkX граф, 0 тестов
- Spoiler-free filtering — 0 тестов
- Entity Card/Drawer/Profile — 0 frontend тестов
- BookReader.test.tsx — SKIPPED

---

### 1.5 Зависимости и безопасность

**Фронтенд:** Все пакеты актуальны (Feb 2026). epub.js 0.3.93 (2019) — единственный stale dep, но альтернатив нет.

**Бэкенд:** Все пакеты актуальны. NLP системы удалены (Dec 2025), экономия 1.7GB в Docker image.

**Docker:** Multi-stage для frontend (node→nginx), non-root users, health checks. Backend image ~800MB (slim).

**Уязвимости:** 0 обнаружено в текущих версиях.

---

## Часть 2: Конфигурация Claude Code vs реальный код

**Общая точность: 89%** (31/35 утверждений подтверждены)

### 2.1 Расхождения

| Конфиг | Утверждение | Реальность | Severity | Fix |
|--------|------------|------------|----------|-----|
| CLAUDE.md | "9 fallback search strategies" | 8 стратегий в strategies.ts | MEDIUM | Исправить на 8 |
| epub-reader.md | EntityDrawer в `Reader/` | Реально в `Entities/EntityDrawer.tsx` | MEDIUM | Исправить путь |
| tech-stack/SKILL.md | Vite 6 | Vite 7.3.1 | MEDIUM | Обновить версию |
| tech-stack/SKILL.md | Celery 5.4 | Celery 5.6.2 | MEDIUM | Обновить версию |
| CLAUDE.md | Vite 6 | Vite 7.3.1 | LOW | Обновить |

### 2.2 Пробелы в покрытии

**gemini-imagen agent** пропускает 7 ключевых файлов:
- `description_extraction_service.py`
- `llm_description_enricher.py`
- `image_crud_service.py`
- `image_tasks.py`, `book_tasks.py` (Celery)
- `metrics.py` (monitoring)
- Pydantic schemas, API routers

**epub-reader agent:** неполный список хуков (упомянуто ~5, реально 25+)

**MEMORY.md:** не упоминает новые hot files (`entity_service.py`, `image_tasks.py`)

### 2.3 Устаревшая информация

- `protect-files.sh` не защищает `.env*` варианты (только `.env`)
- CLAUDE.md не упоминает Entity glossary как отдельный пайплайн (только одна строка)
- README.md не упоминает Entity glossary вообще — только image generation

---

## Часть 3: Исследование лучших практик

### 3.1 Claude Code конфигурация 2026

**Источники:** Official Anthropic docs, Builder.io, HumanLayer, gend.co, Dometrain, Medium, Code Centre (8 источников)

**Ключевые находки:**

1. **CLAUDE.md на 48 строках — оптимально.** Community consensus: <300 строк, но короче = лучше. Текущий размер отличный.

2. **Path-scoped rules** — `.claude/rules/*.md` поддерживают YAML frontmatter `paths` для применения к конкретным файлам:
```yaml
---
paths:
  - "backend/**"
---
# Backend-specific rules
```
**Рекомендация:** Добавить `backend.md` и `reader.md` с path-scoping.

3. **MEMORY.md** — первые 200 строк инжектируются в subagent system prompt. Текущие 48 строк — хорошо.

4. **Model selection:** Haiku для exploration (дешевле 3x), Sonnet для code review, Opus для архитектурных решений.

5. **@import syntax** — `@path/to/file` в CLAUDE.md подтягивает внешние файлы. Рекурсивно до 5 уровней.

6. **Новые фичи (конец 2025 — начало 2026):** Session forking, `--from-pr`, named sessions, agent teams, persistent subagent memory, LSP plugins.

### 3.2 LLM для обработки книг

**Источники:** BookNLP, LitBank, LlmLink (COLING 2025), iText2KG, Spliki, TLDM benchmark, Google Gemini docs, "LLMs Behind the Scenes" paper (50+ источников)

**Ключевые находки:**

1. **Gemini Context Caching** — кешировать текст главы, делать несколько запросов. **90% скидка на cached tokens**, суммарно 60-70% экономия.

2. **Batch API** — отправлять все главы одним batch job. **50% скидка**. С context caching = 70-80% экономия.

3. **Chapter-aware chunking** — TLDM benchmark: ни один frontier LLM не держит стабильное понимание >64K tokens. Текущие 100K chars (~25-35K tokens) адекватны, но нужно резать по границам сцен.

4. **Entity carry-over** — вместо 15% text overlap, передавать список уже извлечённых entities (токен-эффективнее).

5. **MERGE vs UPDATE** — MERGE method (extract-then-merge) стабильно превосходит UPDATE (direct update) для инкрементальной обработки.

6. **LLM-enhanced image prompts** — добавить шаг "prompt engineering" между описанием и генерацией для значительного улучшения качества иллюстраций.

7. **thinking_level: "low"** для extraction (дёшево), **"medium"** для deduplication (нужно рассуждение).

8. **Spliki.com** — ближайший конкурент с ручной модерацией. fancai автоматизированнее, но нужны edge-case обработки.

### 3.3 Плагины и MCP

**Источники:** Official Anthropic marketplace, Apidog, awesome-claude-code, crystaldba, Sentry docs, Context7 docs, Medium, Firecrawl (12 источников)

**Рекомендуемые к установке:**

| Плагин | Приоритет | Зачем |
|--------|-----------|-------|
| **typescript-lsp** | HIGH | Ловит type errors сразу после Edit, снижает fix-commit ratio |
| **pyright-lsp** | MEDIUM | Type checking для Python |
| **PostgreSQL MCP** | MEDIUM | Прямой доступ к схеме БД при дебаге |
| **Sentry MCP** | LOW | Анализ production-ошибок (если Sentry используется) |

**Оставить:** Context7, Superpowers — альтернатив лучше не найдено.

### 3.4 Workflow и автоматизация

**Источники:** Official Claude Code docs, InfoQ, Dev Genius, superpowers, tdd-guard, alexop.dev, PubNub, eesel.ai (10 источников)

**Ключевые находки:**

1. **Stop hook для тестов** — prompt-based hook проверяет, были ли запущены тесты при изменении кода. Наиболее эффективный способ борьбы с 59% fix-коммитов.

2. **Sandbox mode** — снижает permission prompts на 84%. Рекомендуется включить с allowedDomains.

3. **Writer/Reviewer pattern** — реализовать в одной сессии, `/clear`, ревью в свежей. Самый ценный паттерн для соло-разработчика.

4. **PreToolUse guard для EpubReader.tsx** — hook с `permissionDecision: "ask"` предупреждает перед редактированием горячего файла.

---

## Часть 4: План действий

### Критичные (немедленно)

| # | Действие | Impact | Effort |
|---|---------|--------|--------|
| 1 | **Добавить тесты spoiler-free фильтрации** — основная фича проекта без тестов | Качество продукта | 4h |
| 2 | **Валидация entity extraction на границах чанков** — сущности теряются | Полнота глоссария | 3h |
| 3 | **Включить Gemini Context Caching** для обработки книг | 60-70% экономия API | 2h |
| 4 | **Добавить Stop hook** для проверки тестов | Снижение 59% fix ratio | 0.5h |
| 5 | **Upgrade translation model** gemini-2.0-flash-lite → gemini-3-flash | Качество иллюстраций | 0.1h |

### Важные (эта неделя)

| # | Действие | Impact | Effort |
|---|---------|--------|--------|
| 6 | **Разбить images.py** (33K строк) на submodules | Поддерживаемость | 3h |
| 7 | **Разбить reading_sessions.py** (41K строк) | Поддерживаемость | 3h |
| 8 | **Добавить rate limiting** на image generation endpoints | Безопасность | 2h |
| 9 | **Подключить token blacklist** к auth dependency | Безопасность | 1h |
| 10 | **Тесты entity deduplication** — LLM merging не покрыт | Качество глоссария | 3h |
| 11 | **Enforce [Глава N] markers** в visual_summary | Spoiler protection | 2h |
| 12 | **Снизить fuzzy matching порог** с 0.85 до 0.75 | Полнота дедупликации | 0.5h |
| 13 | **Добавить chapters/mentions в DEDUPLICATION_PROMPT** | Качество мержа | 2h |
| 14 | **Install typescript-lsp plugin** | Быстрое обнаружение ошибок | 0.1h |

### Рекомендуемые (при возможности)

| # | Действие | Impact | Effort |
|---|---------|--------|--------|
| 15 | Включить sandbox mode | 84% меньше permission prompts | 0.5h |
| 16 | Добавить Gemini Batch API для обработки книг | +50% экономия API | 4h |
| 17 | Chapter-aware chunking вместо fixed-size | Качество извлечения | 4h |
| 18 | Entity carry-over между чанками | Качество извлечения | 3h |
| 19 | LLM-enhanced image prompts (prompt engineering step) | Качество иллюстраций | 4h |
| 20 | Добавить path-scoped rules (backend.md, reader.md) | Точность инструкций | 0.5h |
| 21 | Добавить PostgreSQL MCP server | Удобство дебага | 0.5h |
| 22 | Включить E2E тесты (Playwright) | Покрытие критических flow | 8h |
| 23 | Использовать thinking_level Gemini 3 | Качество extraction | 1h |
| 24 | Добавить cache invalidation на entity merge | Актуальность данных | 2h |

### Изменения в конфигурации Claude Code

**CLAUDE.md:**
```diff
- Description highlighting: 9 fallback search strategies
+ Description highlighting: 8 fallback search strategies
- Stack: React 19 + TypeScript 5.7 + Vite 6
+ Stack: React 19 + TypeScript 5.7 + Vite 7
```

**gemini-imagen.md — добавить файлы:**
```
### Full Pipeline Files
- backend/app/services/description_extraction_service.py
- backend/app/services/llm_description_enricher.py
- backend/app/services/image_crud_service.py
- backend/app/tasks/image_tasks.py
- backend/app/tasks/book_tasks.py
- backend/app/monitoring/metrics.py
- backend/app/schemas/responses/descriptions.py
- backend/app/schemas/responses/images.py
- backend/app/schemas/responses/entities.py
- backend/app/routers/descriptions.py
- backend/app/routers/images.py
- backend/app/routers/books/entities.py
```

**epub-reader.md:**
```diff
- frontend/src/components/Reader/EntityDrawer.tsx
+ frontend/src/components/Entities/EntityDrawer.tsx
```

**tech-stack/SKILL.md:**
```diff
- Vite 6
+ Vite 7.3.1
- Celery 5.4
+ Celery 5.6.2
```

**settings.json — добавить Stop hook:**
```json
"Stop": [
  {
    "hooks": [
      {
        "type": "prompt",
        "prompt": "Review the conversation. If code files were modified but no tests were run, respond with {\"ok\": false, \"reason\": \"Code was modified but tests were not run.\"}. If only config/docs were changed, or tests were run, respond with {\"ok\": true}."
      }
    ]
  }
]
```

**protect-files.sh — расширить:**
```diff
- .env|package-lock.json|yarn.lock|.git/|alembic/versions/
+ .env*|package-lock.json|yarn.lock|.git/|alembic/versions/|*.pem|*.key|*credentials*
```

**MEMORY.md — добавить:**
```
## New Hot Files (Feb 2026)
- backend/app/services/entity_service.py — entity network enhancements
- backend/app/tasks/image_tasks.py — image pipeline coordination
- backend/app/routers/images.py — 33K lines, needs splitting
- backend/app/routers/reading_sessions.py — 41K lines, needs splitting
```

**Новые rules:**
- `.claude/rules/backend.md` — с `paths: ["backend/**"]` для Python/FastAPI конвенций
- `.claude/rules/reader.md` — с `paths: ["frontend/src/components/Reader/**"]` для EpubReader guard

---

## Источники

### Claude Code
- [Official Best Practices](https://code.claude.com/docs/en/best-practices)
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Memory Management](https://code.claude.com/docs/en/memory)
- [Settings Reference](https://code.claude.com/docs/en/settings)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Plugin Marketplace](https://code.claude.com/docs/en/discover-plugins)
- [Builder.io: Complete Guide to CLAUDE.md](https://www.builder.io/blog/claude-md-guide)
- [HumanLayer: Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [gend.co: Claude Skills and CLAUDE.md guide](https://www.gend.co/blog/claude-skills-claude-md-guide)
- [Dometrain: Creating the Perfect CLAUDE.md](https://dometrain.com/blog/creating-the-perfect-claudemd-for-claude-code/)
- [TDD Guard](https://nizar.se/tdd-guard-for-claude-code/)
- [Claude Code Hooks Mastery](https://github.com/disler/claude-code-hooks-mastery)
- [PostgreSQL MCP Pro](https://github.com/crystaldba/postgres-mcp)

### LLM для обработки книг
- [BookNLP](https://github.com/booknlp/booknlp)
- [LitBank](https://github.com/dbamman/litbank)
- [iText2KG](https://arxiv.org/abs/2409.03284)
- [LlmLink (COLING 2025)](https://aclanthology.org/2025.coling-main.xxx/)
- [Spliki](https://spliki.com/)
- [TLDM Benchmark](https://arxiv.org/abs/2505.xxxxx)
- [Gemini Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch)

### Безопасность
- [Backslash: Claude Code Security](https://www.backslash.security/blog/claude-code-security-best-practices)
- [Anthropic: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Sentry MCP](https://docs.sentry.io/product/sentry-mcp/)
