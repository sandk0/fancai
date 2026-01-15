# Исследование решений для оптимизации Claude Code

**Дата:** 2026-01-15
**Проект:** fancai
**Цель:** Анализ альтернатив и лучших практик для оптимизации использования контекста и токенов

---

## Оглавление

1. [Резюме исследования](#резюме-исследования)
2. [Проблема контекста в Claude Code](#проблема-контекста-в-claude-code)
3. [Категории решений](#категории-решений)
4. [Детальный анализ MCP серверов](#детальный-анализ-mcp-серверов)
5. [Встроенные механизмы Claude](#встроенные-механизмы-claude)
6. [Комбинации и синергии](#комбинации-и-синергии)
7. [Рекомендации для fancai](#рекомендации-для-fancai)
8. [План внедрения](#план-внедрения)

---

## Резюме исследования

### Топ решений по эффективности

| Решение | Экономия токенов | Сложность | Рекомендация для fancai |
|---------|------------------|-----------|------------------------|
| **Tool Search Tool** (Anthropic) | 85-95% | Низкая | Обязательно |
| **Serena MCP** | 60-70% | Средняя | Уже установлено |
| **Claude Context** (Zilliz) | ~40% | Средняя | Рекомендуется |
| **Subagents (Task tool)** | ~50% на сложных задачах | Низкая | Активно использовать |
| **CLAUDE.md оптимизация** | 10-30% | Низкая | Обязательно |
| **/compact + /clear** | Восстановление контекста | Низкая | Регулярно использовать |
| **MCP Server Consolidation** | 60%+ от MCP overhead | Средняя | Рассмотреть |

### Ключевые выводы

1. **Комбинация решений** даёт лучший результат, чем одно решение
2. **Tool Search Tool** — наиболее эффективное встроенное решение (85% экономии)
3. **Serena + Claude Context** — оптимальная комбинация для семантического поиска
4. **Subagents** недооценены — каждый агент получает свой контекст
5. **CLAUDE.md** требует оптимизации — избыточный контент снижает качество

---

## Проблема контекста в Claude Code

### Статистика проекта fancai

| Метрика | Значение |
|---------|----------|
| Файлов кода | 200+ |
| Компонентов React | 86 |
| Хуков | 56 |
| Backend сервисов | 17+ |
| Документации (.md) | 690+ файлов |
| Строк кода | ~50,000+ |

### Проблема "Token Overhead"

При 5 MCP серверах:
- **~55K токенов** потребляется ДО начала работы
- Добавление серверов (например, Jira ~17K) быстро исчерпывает лимит
- Anthropic видели **134K токенов** только на определениях инструментов

### Деградация производительности

> "Значительная деградация производительности происходит при исчерпании контекстного окна. Качество ответов снижается на задачах, затрагивающих несколько частей кодовой базы."

**Рекомендация:** Избегать последних 20% контекстного окна для сложных задач.

---

## Категории решений

### 1. MCP серверы для семантического поиска кода

| Сервер | Особенности | Провайдеры | Локальный режим |
|--------|-------------|------------|-----------------|
| **Serena** | Symbol-level понимание, LSP | - | Да |
| **Claude Context** | Vector DB, AST, hybrid search | OpenAI, VoyageAI, Gemini, Ollama | Да (Ollama + Milvus) |
| **Code Index MCP** | 50+ типов файлов, Tree-sitter | Встроенный | Да |
| **MCP Vector Search** | ChromaDB, AST | sentence-transformers | Да |

### 2. Встроенные механизмы Claude

| Механизм | Описание | Экономия |
|----------|----------|----------|
| **Tool Search Tool** | Динамическая загрузка инструментов | 85-95% |
| **defer_loading** | Отложенная загрузка MCP tools | Variable |
| **Subagents/Task tool** | Изолированные контексты | ~50% на сложных |
| **/compact** | Сжатие истории диалога | Восстановление |
| **/clear** | Очистка контекста | Восстановление |

### 3. Конфигурационные оптимизации

| Метод | Описание | Влияние |
|-------|----------|---------|
| **CLAUDE.md** | Персистентный контекст проекта | Критичен |
| **Tool Consolidation** | Объединение похожих инструментов | 60%+ |
| **McPick** | Динамическое отключение серверов | Variable |
| **/context** | Мониторинг использования | Информация |

---

## Детальный анализ MCP серверов

### 1. Serena MCP (Уже установлен)

**Репозиторий:** https://github.com/oraios/serena

**Преимущества:**
- Symbol-level понимание кода через LSP
- Память о проекте (`.serena/memories/`)
- Точное редактирование (`insert_after_symbol`)
- Бесплатный, open-source

**Ограничения:**
- Требует индексации при изменениях
- Менее эффективен на маленьких проектах

**Инструменты:**
```
find_symbol, find_referencing_symbols, insert_after_symbol,
get_symbols_overview, read_memory, write_memory
```

**Конфигурация для fancai:** Уже настроена в `scripts/setup-serena.sh`

---

### 2. Claude Context (Zilliz)

**Репозиторий:** https://github.com/zilliztech/claude-context

**Преимущества:**
- Hybrid search (BM25 + dense vectors)
- AST-based code chunking
- Инкрементальная индексация (Merkle trees)
- Множество embedding провайдеров
- ~40% снижение токенов

**Поддерживаемые языки:**
TypeScript, JavaScript, Python, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown

**Embedding провайдеры:**
| Провайдер | Модель | Особенности |
|-----------|--------|-------------|
| OpenAI | text-embedding-3-small/large | Лучшее качество |
| VoyageAI | voyage-code-3 | Оптимизирован для кода |
| Gemini | text-embedding-004 | Интегрирован с Google |
| Ollama | nomic-embed-text | Полностью локальный |

**Установка для fancai:**
```bash
claude mcp add claude-context \
  -e EMBEDDING_PROVIDER=Gemini \
  -e GEMINI_API_KEY=$GOOGLE_API_KEY \
  -e MILVUS_TOKEN=your-zilliz-cloud-api-key \
  -- npx @zilliz/claude-context-mcp@latest
```

**Локальный режим (приватность):**
```bash
# Ollama + Milvus для полностью локального развёртывания
claude mcp add claude-context \
  -e EMBEDDING_PROVIDER=Ollama \
  -e OLLAMA_HOST=http://127.0.0.1:11434 \
  -e EMBEDDING_MODEL=nomic-embed-text \
  -e MILVUS_ADDRESS=http://localhost:19530 \
  -- npx @zilliz/claude-context-mcp@latest
```

---

### 3. Code Index MCP

**Репозиторий:** https://github.com/johnhuang316/code-index-mcp

**Преимущества:**
- Tree-sitter AST парсинг для 7 языков
- Поддержка 50+ типов файлов
- Fallback стратегия для остальных языков
- Zero-configuration setup

**Идеально для:**
- Code review
- Рефакторинг
- Генерация документации
- Архитектурный анализ

---

### 4. MCP Vector Search

**Репозиторий:** https://github.com/bobmatnyc/mcp-vector-search

**Преимущества:**
- ChromaDB (полностью локальный)
- AST parsing
- sentence-transformers/all-MiniLM-L6-v2
- CLI-first design

**Установка:**
```bash
# Одной командой: init + index + configure
npx mcp-vector-search init
```

---

### 5. Sequential Thinking MCP

**Назначение:** Структурированное решение проблем

**Лучше всего для:**
- Архитектурные решения
- Отладка сложных проблем
- Масштабное планирование

**Установка:**
```bash
claude mcp add sequential-thinking npx -- -y @modelcontextprotocol/server-sequential-thinking
```

---

### 6. Context7 MCP (Уже установлен)

**Назначение:** Актуальная документация библиотек

**Преимущества:**
- Real-time документация из репозиториев
- Идеально для React, TanStack Query, FastAPI

**Установка:**
```bash
claude mcp add --transport http context7 https://mcp.context7.com/mcp
```

---

## Встроенные механизмы Claude

### 1. Tool Search Tool (defer_loading)

**Экономия:** 85-95% токенов на инструментах

**Как работает:**
```
Без defer_loading:
[50 инструментов] → 72K токенов загружено сразу

С defer_loading:
[Tool Search Tool] → ~8.7K токенов
Claude ищет нужные инструменты по запросу
```

**Конфигурация:**
```json
{
  "tools": [
    {"type": "tool_search_tool_regex_20251119", "name": "tool_search_tool_regex"},
    {
      "name": "github.createPullRequest",
      "description": "Create a pull request",
      "defer_loading": true
    }
  ]
}
```

**Для MCP серверов:**
```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "serena",
  "default_config": {"defer_loading": true},
  "configs": {
    "find_symbol": {"defer_loading": false}
  }
}
```

**Когда использовать:**
- Tool definitions > 10K токенов
- 10+ инструментов
- Множество MCP серверов

**Когда НЕ использовать:**
- < 10 инструментов
- Все инструменты используются часто

---

### 2. Subagents (Task tool)

**Принцип:** Каждый subagent получает свой контекст

```
Без subagents:
(X + Y + Z) * N токенов в главном контексте

С subagents:
Subagent: (X + Y) * N → возвращает только Z токенов
Main: Z * N токенов
```

**Типы subagents в fancai:**
| Тип | Назначение |
|-----|------------|
| Explore | Поиск по кодовой базе |
| Plan | Архитектурное планирование |
| Bash | Git и shell операции |
| general-purpose | Сложные многошаговые задачи |

**Лучшие практики:**
1. Использовать для задач с verbose output
2. Использовать для self-contained работы
3. Не включать Task tool в subagent's tools

**Параллелизм:**
- До 10 параллельных subagents
- Более 10 — автоматическая очередь

---

### 3. /compact и /clear

**`/compact`:**
- Сжимает историю диалога
- Сохраняет ключевой контекст
- Instant с v2.0+ (background summarization)

**`/clear`:**
- Полная очистка контекста
- Используйте между задачами
- Комбинируйте с `/catchup` для восстановления

**Рабочий процесс:**
```
1. Длинная сессия → проверить /context
2. Если > 80% → /compact или /clear
3. После /clear → загрузить нужный контекст
```

---

### 4. CLAUDE.md оптимизация

**Принципы:**

| Правило | Описание |
|---------|----------|
| **< 300 строк** | Оптимально 100-200 строк |
| **Универсальность** | Только всегда применимые инструкции |
| **Указатели, не копии** | `file:line` вместо кода |
| **Не дублировать линтеры** | Стиль кода = линтер, не LLM |
| **Per-folder CLAUDE.md** | Для локальных правил |

**Структура оптимального CLAUDE.md:**

```markdown
# Project: fancai

## Quick Commands
- `npm run dev` - frontend
- `pytest -v` - backend tests

## Key Directories
- frontend/src/components/Reader/ - EPUB reader
- backend/app/services/ - business logic

## Conventions
- TypeScript strict mode
- Python type hints
- PR titles: type(scope): description

## Important Files
- ВАЖНО: читать только при необходимости
- frontend/src/hooks/api/queryKeys.ts - cache keys
```

---

## Комбинации и синергии

### Оптимальная комбинация для fancai

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Context                       │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Tool Search   │  │  CLAUDE.md      │  │  Subagents  │  │
│  │   Tool          │  │  (optimized)    │  │  (Task)     │  │
│  │   85% savings   │  │  <200 lines     │  │  isolated   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              MCP Servers (defer_loading)                │ │
│  │                                                         │ │
│  │  ┌─────────┐  ┌───────────────┐  ┌──────────────────┐  │ │
│  │  │ Serena  │  │ Claude Context│  │    Context7      │  │ │
│  │  │ symbols │  │ vector search │  │  documentation   │  │ │
│  │  │ editing │  │ hybrid mode   │  │  real-time       │  │ │
│  │  └─────────┘  └───────────────┘  └──────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Синергия Serena + Claude Context

| Задача | Serena | Claude Context |
|--------|--------|----------------|
| Найти функцию по имени | ✅ `find_symbol` | - |
| Найти по смыслу "authentication" | - | ✅ `search_code` |
| Редактировать после символа | ✅ `insert_after_symbol` | - |
| Индексация всего проекта | ❌ | ✅ |
| Symbol-level understanding | ✅ (LSP) | ❌ |
| Vector similarity | ❌ | ✅ |

**Вывод:** Используйте оба для максимальной эффективности.

---

## Рекомендации для fancai

### Приоритет 1: Обязательные оптимизации

#### 1.1 Оптимизация CLAUDE.md

**Текущее состояние:** ~500 строк
**Целевое:** ~200 строк

**Действия:**
1. Удалить детальные описания компонентов (перенести в per-folder)
2. Оставить только quick commands и key directories
3. Заменить code snippets на `file:line` ссылки

#### 1.2 Активное использование Subagents

**Когда использовать Task tool:**
- Поиск по кодовой базе → `subagent_type: Explore`
- Планирование → `subagent_type: Plan`
- Git операции → `subagent_type: Bash`

#### 1.3 Регулярное использование /compact и /clear

- Проверять `/context` при 80%+ использования
- `/clear` между несвязанными задачами
- `/compact` для продолжения длинных сессий

### Приоритет 2: Рекомендуемые дополнения

#### 2.1 Claude Context MCP

**Почему:** Дополняет Serena vector search возможностями

**Установка с Gemini (уже есть API key):**
```bash
claude mcp add claude-context \
  -e EMBEDDING_PROVIDER=Gemini \
  -e GEMINI_API_KEY=$GOOGLE_API_KEY \
  -e MILVUS_TOKEN=<получить на zilliz.com бесплатно> \
  -- npx @zilliz/claude-context-mcp@latest
```

#### 2.2 Sequential Thinking MCP

**Почему:** Улучшает качество архитектурных решений

```bash
claude mcp add sequential-thinking npx -- -y @modelcontextprotocol/server-sequential-thinking
```

### Приоритет 3: Продвинутые оптимизации

#### 3.1 Tool Search Tool (defer_loading)

Требует настройки на уровне API. Рассмотреть при работе с большим количеством MCP серверов.

#### 3.2 MCP Server Consolidation

Объединение похожих инструментов в один с параметрами. Реализовать при необходимости.

---

## План внедрения

### Этап 1: Немедленные действия (сегодня)

| Действие | Время | Влияние |
|----------|-------|---------|
| Оптимизировать CLAUDE.md | 30 мин | 10-30% экономии |
| Создать per-folder CLAUDE.md | 20 мин | Локализация контекста |
| Настроить регулярное использование /compact | 0 мин | Восстановление контекста |

### Этап 2: Ближайшие дни

| Действие | Время | Влияние |
|----------|-------|---------|
| Установить Claude Context MCP | 15 мин | +40% эффективность поиска |
| Установить Sequential Thinking | 5 мин | Качество решений |
| Индексировать проект в Claude Context | 10 мин | Семантический поиск |

### Этап 3: При необходимости

| Действие | Триггер | Влияние |
|----------|---------|---------|
| Tool Search Tool (defer_loading) | 10+ MCP серверов | 85% экономии на tools |
| MCP Server Consolidation | High tool overhead | 60%+ экономии |
| Локальный режим (Ollama + Milvus) | Privacy requirements | Полная приватность |

---

## Сравнительная таблица решений

| Решение | Экономия токенов | Сложность установки | Требует API keys | Локальный режим | Рекомендация |
|---------|------------------|---------------------|------------------|-----------------|--------------|
| CLAUDE.md optimization | 10-30% | Низкая | Нет | Да | Обязательно |
| Subagents (Task) | ~50% | Встроено | Нет | Да | Обязательно |
| /compact + /clear | Восстановление | Встроено | Нет | Да | Обязательно |
| **Serena MCP** | 60-70% | Средняя | Нет | Да | **Установлено** |
| **Claude Context** | ~40% | Средняя | Да (или Ollama) | Да | **Рекомендуется** |
| **Context7** | - | Низкая | Нет | Нет | **Установлено** |
| Tool Search Tool | 85-95% | Средняя | Нет | Да | При 10+ MCP |
| Sequential Thinking | - | Низкая | Нет | Да | Рекомендуется |
| MCP Consolidation | 60%+ | Высокая | - | Да | При необходимости |

---

## Источники

### Официальная документация Anthropic
- [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Context Management](https://www.anthropic.com/news/context-management)

### MCP серверы
- [Serena MCP](https://github.com/oraios/serena)
- [Claude Context (Zilliz)](https://github.com/zilliztech/claude-context)
- [Code Index MCP](https://github.com/johnhuang316/code-index-mcp)
- [MCP Vector Search](https://github.com/bobmatnyc/mcp-vector-search)

### Руководства и best practices
- [ClaudeLog - Best Practices](https://claudelog.com/)
- [Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Claude Code Subagent Deep Dive](https://cuong.io/blog/2025/06/24-claude-code-subagent-deep-dive)
- [Optimising MCP Server Context](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code)
- [Reducing MCP token usage by 100x](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2)
- [Best MCP Servers for Claude Code](https://mcpcat.io/guides/best-mcp-servers-for-claude-code/)

### Сообщество
- [Claude Code GitHub Issues #7172](https://github.com/anthropics/claude-code/issues/7172)
- [How I Use Every Claude Code Feature](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)

---

**Создано:** 2026-01-15
**Автор:** Claude Code (Opus 4.5)
**Версия:** 1.0
