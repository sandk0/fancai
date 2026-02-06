# Исследование плагинов и MCP-серверов для Claude Code (2025-2026)

**Дата:** 2026-02-06
**Scope:** Плагины Claude Code + MCP-серверы для проекта fancai (React 19 + FastAPI + PostgreSQL + Redis + Celery + Gemini AI + Docker, деплой VPS via SSH)
**Автор:** Claude Code (Opus 4.6)

## Executive Summary

Экосистема Claude Code в начале 2026 года включает 9000+ плагинов (43 маркетплейса), 7000+ MCP-серверов и активно растущее сообщество. Для проекта fancai выявлены 8 высокоприоритетных добавлений (PostgreSQL MCP, SSH Manager, Docker MCP, Sentry MCP, GitHub MCP, Sequential Thinking, Brave Search, Celery MCP) и 3 рекомендации по текущей конфигурации (оставить context7 и superpowers, включить playwright).

---

## 1. Обзор маркетплейса плагинов

### 1.1 Состояние экосистемы (февраль 2026)

| Метрика | Значение |
|---------|----------|
| Маркетплейсов | 43 |
| Плагинов (всего) | 9000+ |
| Awesome-списков (GitHub) | 4101 репозиториев |
| Официальный маркетплейс Anthropic | 11+ плагинов |

### 1.2 Основные маркетплейсы

| Маркетплейс | Тип | Описание | Как добавить |
|-------------|-----|----------|--------------|
| **claude-plugins-official** | Официальный | Managed Anthropic, автоматически доступен | Предустановлен |
| **superpowers-marketplace** | Сообщество | Jesse Vincent (obra), TDD/planning skills | `/plugin marketplace add obra/superpowers-marketplace` |
| **claudemarketplaces.com** | Агрегатор | Веб-каталог всех маркетплейсов | Браузер |
| **claude-plugins.dev** | Реестр сообщества | CLI для поиска и установки | `npx claude-plugins-dev search <query>` |
| **cc-marketplace** | Сообщество | Anandd Tyagi | `/plugin marketplace add ananddtyagi/cc-marketplace` |

### 1.3 Полный список найденных плагинов

#### Tier 1 -- Высокая применимость к fancai

| Плагин | Описание | Применимость к fancai | Зрелость | Установка |
|--------|----------|----------------------|----------|-----------|
| **context7** | Актуальная документация библиотек через MCP | React 19, epub.js, TanStack Query, FastAPI, SQLAlchemy -- получение актуальных API | Стабильный (16k+ stars) | Уже установлен |
| **superpowers** | TDD, debugging, planning skills | Методология разработки, systematic-debugging, brainstorm | Стабильный (29k+ stars) | Уже установлен |
| **playwright** | Браузерная автоматизация и тестирование | E2E тесты EPUB-ридера, тестирование UI компонентов | Стабильный | Уже установлен (выключен) |
| **compound-engineering** | Plan -> Work -> Review workflow, 27 агентов | Архитектурный подход к фичам: 80% планирование, 20% кодирование, 12 параллельных ревьюеров | Стабильный | `/plugin install compound-engineering@anthropics-claude-code` |

#### Tier 2 -- Средняя применимость

| Плагин | Описание | Применимость к fancai | Зрелость | Установка |
|--------|----------|----------------------|----------|-----------|
| **ralph-wiggum** | Автономные циклы разработки (часы/дни без вмешательства) | Длительные рефакторинги, автоматическая генерация тестов | Стабильный (официальный плагин Anthropic) | `/plugin install ralph-wiggum@anthropics-claude-code` |
| **fullstack-dev-skills** | 65 skills для full-stack (React, FastAPI, Docker, K8s) | Прямое покрытие стека fancai + Jira/Confluence интеграция | Бета | `/plugin marketplace add jeffallan/claude-skills` |
| **code-review** | Автоматический code review для PR | Качество кода перед мержем | Стабильный (официальный) | `/plugin install code-review@anthropics-claude-code` |
| **oh-my-claudecode** | 5 режимов оркестрации (Autopilot, Ultrapilot, Swarm, Pipeline, Ecomode) | Параллельная разработка фронтенда и бэкенда | Бета | `/plugin marketplace add Yeachan-Heo/oh-my-claudecode` |
| **repomix** | Упаковка кодовой базы в AI-friendly формат | Передача контекста проекта другим AI, документация | Стабильный | `/plugin install repomix@anthropics-claude-code` |

#### Tier 3 -- Ситуативная применимость

| Плагин | Описание | Применимость к fancai | Зрелость |
|--------|----------|----------------------|----------|
| **firecrawl** | Веб-скрейпинг и извлечение данных | Исследования интеграций, парсинг документации | Стабильный |
| **agent-sdk-dev** | Разработка на Claude Agent SDK | Если будут создаваться собственные агенты | Официальный |
| **claude-opus-4-5-migration** | Миграция кода на Opus 4.5 | Обновление промптов при смене модели | Официальный |

---

## 2. Рекомендуемые MCP-серверы

### 2.1 Основная таблица

| # | MCP-сервер | Назначение | Применимость к fancai | Установка | Зрелость | Токены (инструменты) |
|---|-----------|-----------|----------------------|-----------|----------|---------------------|
| 1 | **PostgreSQL MCP Pro** | Доступ к БД, схема, запросы, анализ производительности | Прямой доступ к PostgreSQL: просмотр схемы books/chapters/descriptions, выполнение запросов, помощь с Alembic-миграциями | `claude mcp add postgres -- npx -y @crystaldba/postgres-mcp postgresql://user:pass@localhost/bookreader` | Стабильный | ~8-12 инструментов |
| 2 | **SSH Manager** | Управление удаленными серверами через SSH | Деплой на VPS (77.246.106.109), управление Docker на продакшене, мониторинг логов | `claude mcp add ssh-manager -- npx -y @iflow-mcp/mcp-ssh-manager` | Стабильный (37 инструментов, режим minimal -- 5) | 5-37 инструментов |
| 3 | **Docker MCP** | Управление контейнерами Docker | docker compose up/down, просмотр логов, мониторинг состояния контейнеров bookreader_backend, redis, celery | `claude mcp add docker -- npx -y @QuantGeekDev/docker-mcp` | Стабильный | ~10 инструментов |
| 4 | **Sentry MCP** | Мониторинг ошибок, root cause analysis | Отслеживание production-ошибок fancai.ru, AI-анализ с Seer, трекинг performance | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` | Стабильный (официальный Sentry) | ~8 инструментов |
| 5 | **GitHub MCP** | PR, issues, code review, CI/CD | Управление PRs, автоматизация code review, мониторинг GitHub Actions | `claude mcp add github -- npx -y @modelcontextprotocol/server-github` | Стабильный (официальный GitHub) | ~26 инструментов |
| 6 | **Sequential Thinking** | Структурированное пошаговое решение задач | Архитектурные решения, сложные рефакторинги, планирование миграций | `claude mcp add sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking` | Стабильный (Anthropic reference) | 1 инструмент |
| 7 | **Brave Search** | Веб-поиск с API | Поиск актуальной документации, исследование багов, альтернатива WebSearch | `claude mcp add brave-search -- npx -y @modelcontextprotocol/server-brave-search` (нужен `BRAVE_API_KEY`) | Стабильный (Anthropic endorsed) | ~2 инструмента |
| 8 | **Redis MCP** | Работа с Redis: ключи, хэши, списки, pub/sub | Просмотр кэша, сессий, задач Celery в Redis, отладка очередей | `claude mcp add redis -- uvx mcp-server-redis --url redis://localhost:6379/0` | Стабильный (официальный Redis) | ~15 инструментов |
| 9 | **Celery MCP** | Мониторинг задач Celery | Отправка задач, мониторинг статусов, контроль выполнения задач image generation | `pip install celery-mcp && claude mcp add celery -- python -m celery_mcp` | Бета | ~6 инструментов |
| 10 | **Memory (Knowledge Graph)** | Постоянная память между сессиями | Сохранение архитектурных решений проекта, паттернов, контекста между сессиями Claude Code | `claude mcp add memory -- npx -y @modelcontextprotocol/server-memory` | Стабильный (Anthropic reference) | ~6 инструментов |
| 11 | **Gemini MCP** | Интеграция с Google Gemini API | Делегирование задач Gemini для deep research, анализ длинных текстов (>200K токенов), 4K генерация изображений | `claude mcp add gemini -- npx -y gemini-mcp` | Бета | ~10 инструментов |
| 12 | **Notion MCP** | Работа с Notion workspace | Документация проекта, техспеки, knowledge base (если используется Notion) | `claude mcp add notion -- npx -y @notionhq/notion-mcp-server` | Стабильный (официальный Notion) | ~8 инструментов |
| 13 | **Serena** | Семантический поиск по коду через LSP | Глубокий анализ кодовой базы: "где обрабатывается аутентификация?", "кто вызывает gemini_extractor?" | `claude mcp add serena -- uvx serena --config serena.yaml` | Бета | ~12 инструментов |

### 2.2 Детальный анализ ключевых MCP

#### PostgreSQL MCP Pro (crystaldba/postgres-mcp)
- **URL:** https://github.com/crystaldba/postgres-mcp
- **Что делает:** Read/write доступ к PostgreSQL, анализ производительности запросов, просмотр схемы
- **Для fancai:** Прямой доступ к таблицам books, chapters, generated_images, users. Просмотр Alembic-миграций. Анализ медленных запросов. Автогенерация SQL для новых фич
- **SSE режим:** Можно запустить как общий сервер для нескольких клиентов
- **Альтернативы:** pgEdge Postgres MCP (поддерживает RDS, стандартный PG v14+), Neon Postgres MCP (для cloud-hosted PG)

#### SSH Manager (bvisible/mcp-ssh-manager)
- **URL:** https://github.com/bvisible/mcp-ssh-manager
- **Что делает:** 37 инструментов для SSH: выполнение команд, передача файлов, управление деплоем, мониторинг, бэкапы, операции с БД
- **Для fancai:** Замена ручных SSH-команд (`ssh root@77.246.106.109...`). Автоматический деплой docker-compose.lite.yml, просмотр логов production, бэкапы БД
- **Tool Activation System:** 92% сокращение контекста -- minimal mode использует только 5 инструментов вместо 37
- **Альтернативы:** mixelpixx/SSH-MCP (базовый SSH), tufantunc/ssh-mcp (Linux-focused)

#### Docker MCP (QuantGeekDev/docker-mcp)
- **URL:** https://github.com/QuantGeekDev/docker-mcp
- **Что делает:** Управление контейнерами, Docker Compose стеки, логи, мониторинг
- **Для fancai:** Управление bookreader_backend, redis, celery_worker, postgres контейнерами. Просмотр логов. Docker Compose stack deploy
- **Альтернативы:** Docker MCP Toolkit (официальный Docker, интегрирован в Docker Desktop), ckreiling/mcp-server-docker

#### Sentry MCP
- **URL:** https://docs.sentry.io/product/sentry-mcp/
- **Что делает:** Анализ ошибок, Seer AI для root cause analysis, мониторинг performance
- **Для fancai:** Отслеживание production-ошибок на fancai.ru, автоматический анализ crashes, performance bottlenecks в Gemini/Imagen pipeline
- **Hosted vs Local:** Hosted вариант (mcp.sentry.dev/mcp) не требует инфраструктуры; STDIO-режим для self-hosted

---

## 3. Сравнение текущей конфигурации

### 3.1 context7 -- ОСТАВИТЬ

**Текущий статус:** Включен, активно используется
**Конфигурация:** `npx -y @upstash/context7-mcp` (через плагин)

**Преимущества:**
- Актуальная документация для React 19, epub.js, TanStack Query, FastAPI, SQLAlchemy
- Zero-setup: работает из коробки
- 16k+ GitHub stars, стабильный
- Минимальное влияние на контекст (2 инструмента: resolve-library-id, query-docs)

**Альтернативы:**
| Альтернатива | Отличие от context7 | Стоит ли менять? |
|--------------|---------------------|------------------|
| DevDocs MCP | Локальный кэш, privacy, crawl сайтов | Нет -- context7 покрывает все нужды fancai |
| Serena | Семантический поиск кода, не документации | Дополняет, не заменяет |
| Brave Search | Общий веб-поиск | Дополняет для исследований |

**Вердикт:** Оставить без изменений. Context7 идеально подходит для быстрого доступа к документации всех библиотек стека fancai.

### 3.2 superpowers -- ОСТАВИТЬ

**Текущий статус:** Включен, интегрирован в CLAUDE.md (auto-routing)
**Версия:** superpowers@superpowers-marketplace

**Используемые skills проекта (на основе .claude/skills и CLAUDE.md):**
- `/systematic-debugging` -- для багов
- `/brainstorm` -- для новых фич
- `/writing-plans` -- для спецификаций
- `/research-and-analysis` -- для исследований (текущий скилл)
- `/verification-before-completion` -- перед коммитом
- `/test-driven-development` -- TDD workflow

**Преимущества:**
- 29k+ stars, принят в официальный маркетплейс Anthropic
- Глубоко интегрирован в workflow проекта (CLAUDE.md auto-routing)
- Методологически ценен: TDD, structured debugging, planning

**Альтернативы:**
| Альтернатива | Отличие | Стоит ли менять? |
|--------------|---------|------------------|
| compound-engineering | 80/20 plan/code, 12 parallel reviewers | Дополняет superpowers |
| oh-my-claudecode | 5 execution modes, 32 agents | Избыточен + конфликт с oh-my-opencode |

**Вердикт:** Оставить. Глубоко интегрирован в CLAUDE.md. Можно дополнить compound-engineering для code review.

### 3.3 playwright vs chrome-devtools -- ВКЛЮЧИТЬ playwright, ОСТАВИТЬ chrome-devtools

**Текущий статус:**
- playwright: установлен, **выключен** (`"disabled": true`)
- chrome-devtools: активен (131 вызов за 5.5 месяцев)

**Сравнение:**

| Критерий | Chrome DevTools MCP | Playwright MCP |
|----------|-------------------|----------------|
| **Назначение** | Deep debugging, performance analysis | UI testing, browser automation |
| **Инструменты** | 26 (18k токенов) | 21 (13.7k токенов) |
| **CSS-отладка** | Computed styles, overrides, layout | Только выбор элементов |
| **Мультибраузер** | Только Chrome | Chromium, Firefox, WebKit |
| **E2E тесты** | Не предназначен | Идеален |
| **Performance** | Core Web Vitals, traces, network | Нет |

**Для fancai:**
- **Chrome DevTools** (26 инструментов): отладка EPUB-ридера (CSS, performance, network для загрузки книг), Core Web Vitals fancai.ru -- **оставить активным**
- **Playwright** (21 инструмент): E2E тесты чтения книг, генерации изображений, навигации по главам -- **рекомендуется включить**

**Вердикт:** Включить playwright. Использовать оба: DevTools для отладки, Playwright для тестирования. Суммарно ~31.7k токенов, но с Tool Search автозагрузка по требованию.

---

## 4. Управление токенами и контекстом

### 4.1 Проблема Token Bloat

MCP-серверы загружают все определения инструментов в контекст до начала работы:
- 5 серверов = ~55K токенов до начала диалога
- 13 серверов = ~82K токенов (41% контекста в 200K окне)
- Каждый MCP-сервер добавляет ~5-15K токенов

### 4.2 Решение: Tool Search Tool (январь 2026)

Claude Code снизил MCP context bloat на **46.9%** (51K -> 8.5K) через динамическую загрузку инструментов:
- Вместо предзагрузки всех инструментов -- поиск по требованию
- 85% сокращение токенов с полным доступом к библиотеке инструментов
- Настройка: `ENABLE_TOOL_SEARCH=auto:<N>` (порог для deferred tools)

### 4.3 Бюджет токенов для рекомендуемой конфигурации

| Категория | MCP/Плагин | Инструменты | Оценка токенов |
|-----------|-----------|-------------|---------------|
| **Текущие** | context7 | 2 | ~2K |
| | chrome-devtools | 26 | ~18K |
| **Плагины** | superpowers | skills/agents | ~5K (system prompt) |
| **Добавить** | PostgreSQL MCP | 8-12 | ~8K |
| | SSH Manager (minimal) | 5 | ~4K |
| | Sequential Thinking | 1 | ~1K |
| | Sentry MCP | 8 | ~6K |
| | Brave Search | 2 | ~2K |
| | Playwright (on-demand) | 21 | ~14K (deferred) |
| **ИТОГО без Tool Search** | | ~85 | ~60K |
| **ИТОГО с Tool Search** | | ~85 | ~12-15K (dynamic) |

**Рекомендация:** Включить Tool Search (`ENABLE_TOOL_SEARCH=auto:10`) для автоматической загрузки инструментов по требованию. Это снизит baseline потребление с ~60K до ~12-15K токенов.

---

## 5. Рекомендуемый набор для fancai

### 5.1 Что ДОБАВИТЬ (с обоснованием)

#### Приоритет P0 -- Критично для продуктивности

| # | MCP/Плагин | Обоснование | Команда установки |
|---|-----------|-------------|-------------------|
| 1 | **PostgreSQL MCP Pro** | Прямой доступ к БД books/chapters/images. Анализ миграций. Отладка запросов. Сейчас работа с БД идет через docker exec + psql | `claude mcp add postgres -- npx -y @crystaldba/postgres-mcp "postgresql://user:pass@localhost/bookreader"` |
| 2 | **SSH Manager** (minimal mode) | Заменит ручные SSH-команды для деплоя на VPS. 92% сокращение контекста в minimal mode (5 из 37 инструментов) | `claude mcp add ssh -- npx -y @iflow-mcp/mcp-ssh-manager --minimal` |
| 3 | **Sequential Thinking** | 1 инструмент, минимальный overhead. Улучшит архитектурные решения и планирование сложных фич | `claude mcp add sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking` |

#### Приоритет P1 -- Сильно улучшит workflow

| # | MCP/Плагин | Обоснование | Команда установки |
|---|-----------|-------------|-------------------|
| 4 | **Sentry MCP** | Production monitoring fancai.ru. AI root cause analysis. Performance tracking для Gemini/Imagen pipeline | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` |
| 5 | **Включить Playwright** | E2E тесты EPUB-ридера. Тестирование UI генерации изображений. Работает совместно с chrome-devtools | Изменить в settings.json: `"playwright": { "disabled": false }` |
| 6 | **compound-engineering** | Дополняет superpowers: 12 параллельных ревьюеров, structured plan->work->review | `/plugin install compound-engineering@anthropics-claude-code` |

#### Приоритет P2 -- Полезно, но не критично

| # | MCP/Плагин | Обоснование | Команда установки |
|---|-----------|-------------|-------------------|
| 7 | **Docker MCP** | Управление контейнерами из Claude Code. Менее критично, т.к. docker compose команды уже в permissions | `claude mcp add docker -- npx -y @QuantGeekDev/docker-mcp` |
| 8 | **Redis MCP** | Инспекция Redis кэша и очередей Celery. Полезно для отладки, но не критично | `claude mcp add redis -- uvx mcp-server-redis --url redis://localhost:6379/0` |
| 9 | **Brave Search** | Веб-поиск лучше нативного WebSearch. Но WebSearch уже работает | `claude mcp add brave-search -- npx -y @modelcontextprotocol/server-brave-search` (нужен API ключ) |
| 10 | **Memory (Knowledge Graph)** | Сохранение контекста между сессиями. Архитектурные решения persistent | `claude mcp add memory -- npx -y @modelcontextprotocol/server-memory` |

### 5.2 Что УДАЛИТЬ (с обоснованием)

| # | Компонент | Обоснование |
|---|-----------|-------------|
| - | **Ничего** | Текущая конфигурация минимальна и целесообразна. Все 3 плагина (context7, superpowers, playwright) обоснованы |

### 5.3 Что ОСТАВИТЬ без изменений

| # | Компонент | Обоснование |
|---|-----------|-------------|
| 1 | **context7** (плагин) | Актуальная документация для всего стека. Минимальный overhead (2 инструмента) |
| 2 | **superpowers** (плагин) | Глубоко интегрирован в CLAUDE.md auto-routing. TDD, debugging, planning |
| 3 | **chrome-devtools** (MCP) | 131 вызов за 5.5 месяцев. Незаменим для CSS-отладки EPUB-ридера |
| 4 | **oh-my-opencode** (конфиг) | Мульти-модельная оркестрация, 26 специализированных агентов. Уже настроен |

### 5.4 Что НЕ рекомендуется добавлять

| MCP/Плагин | Причина отказа |
|------------|---------------|
| **GitHub MCP** | Claude Code уже имеет встроенную `gh` CLI интеграцию. GitHub MCP имеет проблемы: tool names >64 chars, OAuth issues. Overhead ~26 инструментов |
| **Filesystem MCP** | Claude Code уже имеет встроенные Read/Write/Edit/Glob/Grep. Filesystem MCP дублирует функциональность |
| **Notion MCP** | Проект не использует Notion. Можно добавить позже |
| **Gemini MCP** | fancai уже использует Gemini через backend Python SDK. MCP добавит лишний слой |
| **Celery MCP** | Бета-качество. Мониторинг Celery проще через docker logs + Redis |
| **oh-my-claudecode** | Конфликтует с oh-my-opencode (уже установлен). Разные экосистемы |
| **Serena** | Claude Code уже имеет LSP tools (code intelligence plugin). Дублирование |
| **Firecrawl** | Нужен API ключ, 500 бесплатных кредитов. WebSearch/WebFetch покрывают потребности |

---

## 6. Итоговая рекомендуемая конфигурация

### 6.1 Файл `.mcp.json` (проектный scope)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@crystaldba/postgres-mcp", "postgresql://user:pass@localhost/bookreader"],
      "env": {}
    },
    "ssh-manager": {
      "command": "npx",
      "args": ["-y", "@iflow-mcp/mcp-ssh-manager", "--minimal"],
      "env": {}
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {}
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp"
    }
  }
}
```

### 6.2 Обновление `settings.json`

```json
{
  "mcpServers": {
    "playwright": { "disabled": false }
  }
}
```

### 6.3 Плагины

```
# Уже установлены -- оставить:
context7@claude-plugins-official        # true
superpowers@superpowers-marketplace      # true

# Изменить:
playwright@claude-plugins-official       # false -> true

# Добавить:
/plugin install compound-engineering@anthropics-claude-code
```

### 6.4 Переменные окружения (добавить)

```bash
# Для Tool Search (оптимизация токенов)
ENABLE_TOOL_SEARCH=auto:10
```

---

## 7. План внедрения

### Фаза 1 -- Немедленно (1 день)

1. Создать `.mcp.json` с PostgreSQL MCP + Sequential Thinking
2. Включить playwright в settings.json
3. Установить compound-engineering плагин
4. Настроить `ENABLE_TOOL_SEARCH=auto:10`

### Фаза 2 -- Эта неделя

5. Настроить SSH Manager для VPS-деплоя
6. Настроить Sentry MCP (требуется Sentry-аккаунт)
7. Протестировать Playwright E2E на EPUB-ридере

### Фаза 3 -- По необходимости

8. Добавить Docker MCP при частой работе с контейнерами
9. Добавить Redis MCP при отладке кэша/очередей
10. Добавить Memory MCP для persistent context

---

## 8. Все источники

### Маркетплейсы и каталоги
- [Official Anthropic Marketplace](https://github.com/anthropics/claude-plugins-official)
- [Claude Code Plugin Marketplace (claudemarketplaces.com)](https://claudemarketplaces.com/)
- [Claude Code Plugins & Agent Skills Registry](https://claude-plugins.dev/)
- [Awesome Claude Plugins (quemsah)](https://github.com/quemsah/awesome-claude-plugins)
- [Awesome Claude Code Plugins (ccplugins)](https://github.com/ccplugins/awesome-claude-code-plugins)
- [Awesome Claude Code (hesreallyhim)](https://github.com/hesreallyhim/awesome-claude-code)
- [MCP Servers Official Repository](https://github.com/modelcontextprotocol/servers)
- [Awesome MCP Servers (wong2)](https://github.com/wong2/awesome-mcp-servers)
- [Awesome MCP Servers (punkpeye)](https://github.com/punkpeye/awesome-mcp-servers)
- [Claude MCP Servers Directory](https://www.claudemcp.com/servers)
- [MCP Awesome 1200+ Servers](https://mcp-awesome.com/)

### Статьи и гайды
- [Top 10 Claude Code Plugins to Try in 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-claude-code-plugins)
- [Best MCP Servers for Claude Code (MCPcat)](https://mcpcat.io/guides/best-mcp-servers-for-claude-code/)
- [50+ Best MCP Servers for Claude Code in 2026](https://claudefa.st/blog/tools/mcp-extensions/best-addons)
- [Top 10 Essential MCP Servers for Claude Code 2026 (Apidog)](https://apidog.com/blog/top-10-mcp-servers-for-claude-code/)
- [The Best Way to Do Agentic Development in 2026](https://dev.to/chand1012/the-best-way-to-do-agentic-development-in-2026-14mn)
- [Turning Claude Code into a Development Powerhouse](https://robertmarshall.dev/blog/turning-claude-code-into-a-development-powerhouse/)
- [Claude Code Full-Stack Configuration Guide](https://htdocs.dev/posts/claude-code-full-stack-configuration-guide/)
- [Claude Code for Fullstack Development Essentials (Wasp)](https://wasp.sh/blog/2026/01/29/claude-code-fullstack-development-essentials)
- [Optimising MCP Server Context Usage](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code)
- [Claude Code Cut MCP Context Bloat by 46.9%](https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734)
- [Claude Code MCP Upgrade 2026: Cut Tokens by 95%](https://www.geeky-gadgets.com/claude-search-picked-plugin-tools/)

### Плагины
- [Superpowers (obra)](https://github.com/obra/superpowers)
- [Superpowers Explained (Medium)](https://jpcaparas.medium.com/superpowers-explained-the-claude-plugin-that-enforces-tdd-subagents-and-planning-c7fe698c3b82)
- [Context7 MCP Server (Upstash)](https://github.com/upstash/context7)
- [Compound Engineering Plugin (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin)
- [Ralph Wiggum Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
- [Oh-My-ClaudeCode](https://github.com/Yeachan-Heo/oh-my-claudecode)
- [Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)
- [Fullstack Dev Skills](https://mcpmarket.com/server/fullstack-dev-skills-plugin)
- [Repomix Claude Code Plugins](https://repomix.com/guide/claude-code-plugins)

### MCP-серверы
- [PostgreSQL MCP Pro (crystaldba)](https://github.com/crystaldba/postgres-mcp)
- [pgEdge Postgres MCP](https://www.pgedge.com/blog/introducing-the-pgedge-postgres-mcp-server)
- [Docker MCP (QuantGeekDev)](https://github.com/QuantGeekDev/docker-mcp)
- [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/)
- [GitHub MCP Server (official)](https://github.com/github/github-mcp-server)
- [Sentry MCP Server](https://docs.sentry.io/product/sentry-mcp/)
- [Sentry MCP STDIO (getsentry)](https://github.com/getsentry/sentry-mcp-stdio)
- [Redis MCP (official)](https://github.com/redis/mcp-redis)
- [Redis MCP Docs](https://redis.io/docs/latest/integrate/redis-mcp/)
- [SSH Manager MCP](https://github.com/bvisible/mcp-ssh-manager)
- [Celery MCP](https://glama.ai/mcp/servers/@JoeyRubas/celery-mcp)
- [Sequential Thinking MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking)
- [Brave Search MCP](https://github.com/brave/brave-search-mcp-server)
- [Memory / Knowledge Graph MCP](https://github.com/shaneholloman/mcp-knowledge-graph)
- [Gemini MCP (RLabs)](https://github.com/RLabs-Inc/gemini-mcp)
- [Notion MCP (official)](https://github.com/makenotion/notion-mcp-server)
- [Serena MCP](https://github.com/oraios/serena)
- [DevDocs MCP](https://github.com/cyberagiinc/DevDocs)
- [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server)
- [Code Review MCP](https://github.com/praneybehl/code-review-mcp)
- [mcp-pytest-runner](https://lobehub.com/mcp/jwilger-mcp-pytest-runner)
- [Code Checker MCP](https://github.com/MarcusJellinghaus/mcp-code-checker)
- [Playwright MCP vs Chrome DevTools Comparison](https://www.scrapeless.com/en/blog/mcp-integration-guide)

### Документация Claude Code
- [Claude Code Docs: Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Docs: Discover Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code Docs: Costs](https://code.claude.com/docs/en/costs)
- [Context Windows (API Docs)](https://platform.claude.com/docs/en/build-with-claude/context-windows)
- [Anthropic: Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Anthropic Blog: Claude Code Plugins](https://claude.com/blog/claude-code-plugins)

### Задачи и проект-менеджмент
- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master)
- [Jira MCP + Claude Code (Composio)](https://composio.dev/blog/jira-mcp-server)
- [Jira & Linear MCP (DX Heroes)](https://playbooks.com/mcp/dxheroes-jira-linear)
