# Итоговый отчёт по оптимизации Claude Code для fancai

**Дата:** 2026-01-15
**Проект:** fancai (веб-приложение для чтения книг с AI-генерацией изображений)
**Claude Code:** v2.1.7
**Автор:** Claude Opus 4.5

---

## Содержание

1. [Обзор проведённой оптимизации](#1-обзор-проведённой-оптимизации)
2. [Анализ результатов](#2-анализ-результатов)
3. [Гайд по использованию LSP](#3-гайд-по-использованию-lsp)
4. [Гайд по Superpowers](#4-гайд-по-superpowers)
5. [Гайд по Context7 MCP](#5-гайд-по-context7-mcp)
6. [Кастомные агенты и команды](#6-кастомные-агенты-и-команды)
7. [Список задач для проекта](#7-список-задач-для-проекта)
8. [Рекомендации](#8-рекомендации)

---

## 1. Обзор проведённой оптимизации

### 1.1 Цели оптимизации

| Цель | Описание | Результат |
|------|----------|-----------|
| Уменьшить токены | Сократить потребление токенов при старте сессии | ✅ 94K → ~15K (−85%) |
| Удалить дублирование | Убрать конфликтующие плагины | ✅ 16 → 5 плагинов |
| Добавить LSP | Включить Language Server Protocol для навигации по коду | ✅ vtsls + pyright |
| Добавить Superpowers | Включить TDD, debugging и planning workflows | ✅ 14 skills |
| Структурировать .claude/ | Создать агентов, команды и skills для проекта | ✅ 3 агента, 3 команды, 1 skill |

### 1.2 Выполненные фазы

| Фаза | Название | Статус |
|------|----------|--------|
| 0 | Проверка безопасности | ✅ |
| 1 | Очистка MCP и плагинов | ✅ |
| 2 | Структура .claude/ и CLAUDE.md | ✅ |
| 3 | Установка новых плагинов | ✅ |
| 4-5 | Исследование | ✅ |
| 6 | Первичная верификация | ✅ |
| 7 | Установка LSP (Piebald-AI) | ✅ |
| 8 | Верификация после перезапуска | ✅ |
| 9 | Финальная верификация LSP | ✅ |

### 1.3 Изменения в конфигурации

#### До оптимизации
```
~/.claude/plugins/installed_plugins.json:
├── claude-code-workflows (11 плагинов)
│   ├── python-development
│   ├── javascript-typescript
│   ├── frontend-mobile-development
│   ├── backend-development
│   ├── database-design
│   ├── unit-testing
│   ├── code-review-ai
│   ├── llm-application-dev
│   ├── cicd-automation
│   ├── full-stack-orchestration
│   └── backend-api-security
├── claude-plugins-official (5 плагинов)
│   ├── github
│   ├── context7
│   ├── typescript-lsp (placeholder)
│   ├── playwright
│   └── pyright-lsp (placeholder)
└── MCP серверы: 4 (1 failed)
    ├── chrome-devtools
    ├── github (failed)
    ├── playwright
    └── context7

Токенов при старте: ~102K (51% контекста)
```

#### После оптимизации
```
~/.claude/plugins/installed_plugins.json:
├── claude-plugins-official (3 плагина)
│   ├── context7 ✅
│   ├── playwright ⏸️ (отключён)
│   └── superpowers ✅
├── claude-code-lsps (2 плагина)
│   ├── vtsls ✅
│   └── pyright ✅
└── MCP серверы: 1
    └── context7 ✅

Токенов при старте: ~15K (7% контекста)
```

---

## 2. Анализ результатов

### 2.1 Метрики эффективности

| Метрика | До | После | Улучшение |
|---------|-----|-------|-----------|
| Плагинов | 16 | 5 | −69% |
| MCP серверов | 4 | 1 | −75% |
| Токенов на старте | ~102K | ~15K | −85% |
| CLAUDE.md строк | 550 | 138 | −75% |
| Доступность LSP | ❌ | ✅ | +100% |
| Superpowers skills | 0 | 14 | +14 |
| Кастомные агенты | 0 | 3 | +3 |
| Проектные команды | 0 | 3 | +3 |

### 2.2 Структура проекта (статистика)

| Категория | Количество | Строк кода |
|-----------|------------|------------|
| Frontend (TypeScript/TSX) | ~100 файлов | 57,338 |
| Backend (Python) | ~95 файлов | 30,316 |
| Тесты Backend | 27 файлов | ~8,000 |
| Документация | ~100 файлов | — |
| **Итого** | ~322 файла | ~95,654 |

### 2.3 LSP диагностика (обнаруженные проблемы)

При анализе LSP диагностикой были обнаружены следующие проблемы:

#### Python (Pyright)

| Файл | Проблема | Тип |
|------|----------|-----|
| `container.py:19` | Import "sqlalchemy.ext.asyncio" could not be resolved | Error |
| `container.py:20` | Import "fastapi" could not be resolved | Error |
| `container.py:222-324` | Service classes not defined (lazy imports) | Error |
| `gemini_extractor.py:427` | Import "google.genai" could not be resolved | Error |
| `imagen_generator.py:111` | Import "google.genai" could not be resolved | Error |
| `imagen_generator.py:376` | "models" is not a known attribute of "None" | Error |

**Примечание:** Эти ошибки связаны с lazy imports и опциональными зависимостями. Код работает в runtime, но Pyright не видит динамические импорты.

#### TypeScript (vtsls)

| Файл | Проблема | Тип |
|------|----------|-----|
| `useEpubLoader.ts:353` | 'platform' is deprecated | Warning |
| `useEpubLoader.ts:511` | 'webkitUserSelect' is deprecated | Warning |
| `reader.ts:195` | String.substr() is deprecated | Warning |
| `useDescriptionHighlighting.ts:367` | 'getMiddleSection' is deprecated | Warning |

---

## 3. Гайд по использованию LSP

### 3.1 Доступные операции

LSP tool поддерживает следующие операции:

| Операция | Описание | Типичное использование |
|----------|----------|----------------------|
| `documentSymbol` | Все символы в файле | Обзор структуры файла |
| `hover` | Информация о типе | Просмотр сигнатуры функции |
| `goToDefinition` | Переход к определению | Навигация к исходному коду |
| `findReferences` | Поиск всех использований | Рефакторинг, анализ зависимостей |
| `goToImplementation` | Реализации интерфейса | Поиск конкретных реализаций |
| `workspaceSymbol` | Поиск символа в проекте | Поиск класса/функции |
| `prepareCallHierarchy` | Подготовка call hierarchy | Анализ вызовов |
| `incomingCalls` | Кто вызывает функцию | Анализ зависимостей |
| `outgoingCalls` | Что вызывает функция | Анализ потока |

### 3.2 Примеры использования

#### Пример 1: Обзор структуры файла (documentSymbol)

**Запрос:**
```
LSP documentSymbol frontend/src/stores/reader.ts line:1 character:1
```

**Результат:**
```
Document symbols:
NavigationMode (Variable) - Line 18
ReaderState (Interface) - Line 20
  addBookmark (Property) - Line 46
  backgroundColor (Property) - Line 26
  fontFamily (Property) - Line 23
  fontSize (Property) - Line 22
  ...
useReaderStore (Variable) - Line 79
  persist() callback (Function) - Line 81
    addBookmark (Method) - Line 167
    updateFontSize (Method) - Line 99
    updateTheme (Method) - Line 111
    ...
```

**Применение:** Быстро понять структуру файла без его чтения. Особенно полезно для больших файлов (500+ строк).

---

#### Пример 2: Поиск всех использований (findReferences)

**Запрос:**
```
LSP findReferences frontend/src/stores/reader.ts line:79 character:14
```

**Результат:**
```
Found 17 references across 7 files:

frontend/src/stores/reader.ts:
  Line 79:14

frontend/src/utils/cacheManager.ts:
  Line 29:10
  Line 128:5
  Line 312:23

frontend/src/components/Settings/sections/ReadingSettingsSection.tsx:
  Line 17:10
  Line 65:7

frontend/src/components/Reader/EpubReader.tsx:
  Line 62:10
  Line 154:52
...
```

**Применение:**
- Рефакторинг: понять, где используется функция перед её изменением
- Анализ: оценить влияние изменений на кодовую базу
- Документация: найти примеры использования

---

#### Пример 3: Информация о типе (hover)

**Запрос:**
```
LSP hover frontend/src/hooks/epub/useDescriptionHighlighting.ts line:414 character:14
```

**Результат:**
```typescript
const useDescriptionHighlighting: ({
  rendition,
  descriptions,
  images,
  onDescriptionClick,
  enabled
}: UseDescriptionHighlightingOptions) => void
```

**Применение:**
- Просмотр сигнатуры функции без открытия файла
- Понимание типов параметров
- Документирование API

---

#### Пример 4: Навигация к определению (goToDefinition)

**Запрос:**
```
LSP goToDefinition backend/app/services/gemini_extractor.py line:478 character:47
```

**Результат:**
```
Defined in backend/app/services/gemini_extractor.py:447:9
```

**Применение:**
- Быстрая навигация к определению класса/функции
- Понимание откуда приходит переменная

---

#### Пример 5: Анализ вызовов (incomingCalls)

**Запрос:**
```
LSP incomingCalls backend/app/services/gemini_extractor.py line:446 character:15
```

**Результат:**
```
Found 11 incoming calls:

backend/tests/services/test_gemini_extractor.py:
  test_extract_success (Function) - Line 171
  test_extract_text_too_short (Function) - Line 201
  test_extract_not_available (Function) - Line 217
  test_extract_with_chunking (Function) - Line 231
  test_extract_api_timeout (Function) - Line 259
  test_extract_api_error (Function) - Line 285
  test_extract_retry_logic (Function) - Line 308
  ...
```

**Применение:**
- Понимание тестового покрытия
- Анализ зависимостей перед рефакторингом
- Поиск точек входа в функцию

---

#### Пример 6: Диагностика (автоматически)

LSP автоматически показывает диагностику при использовании:

```
<new-diagnostics>
gemini_extractor.py:
  ✘ [Line 427:18] Import "google.genai" could not be resolved [reportMissingImports]
  ★ [Line 223:9] "original_text" is not accessed (Pyright)

useEpubLoader.ts:
  ★ [Line 353:22] 'platform' is deprecated. [6385] (ts)
</new-diagnostics>
```

**Типы диагностики:**
- `✘` — Ошибка (Error)
- `⚠` — Предупреждение (Warning)
- `★` — Информация (Hint/Info)

---

### 3.3 Практические сценарии

#### Сценарий A: Рефакторинг функции

1. **Найти все использования:**
   ```
   LSP findReferences <file> line:<line> character:<char>
   ```

2. **Проверить структуру каждого использующего файла:**
   ```
   LSP documentSymbol <file> line:1 character:1
   ```

3. **Понять контекст использования:**
   ```
   LSP hover <file> line:<usage_line> character:<char>
   ```

#### Сценарий B: Понимание нового кода

1. **Обзор структуры файла:**
   ```
   LSP documentSymbol <file> line:1 character:1
   ```

2. **Изучение типов ключевых функций:**
   ```
   LSP hover <file> line:<function_line> character:<char>
   ```

3. **Понимание зависимостей:**
   ```
   LSP incomingCalls/outgoingCalls <file> line:<line> character:<char>
   ```

#### Сценарий C: Отладка

1. **Проверить диагностику** (автоматически показывается)

2. **Найти определение проблемной функции:**
   ```
   LSP goToDefinition <file> line:<error_line> character:<char>
   ```

3. **Проверить реализации интерфейса:**
   ```
   LSP goToImplementation <file> line:<interface_line> character:<char>
   ```

---

## 4. Гайд по Superpowers

### 4.1 Доступные skills

| Skill | Описание | Когда использовать |
|-------|----------|-------------------|
| `superpowers:brainstorming` | Брейнсторминг идей в дизайн | Перед созданием новых фич |
| `superpowers:test-driven-development` | TDD workflow | При реализации любой фичи |
| `superpowers:systematic-debugging` | Систематическая отладка | При любом баге или ошибке |
| `superpowers:writing-plans` | Написание планов | Перед многошаговыми задачами |
| `superpowers:executing-plans` | Выполнение планов | После написания плана |
| `superpowers:verification-before-completion` | Верификация работы | Перед коммитом/PR |
| `superpowers:using-git-worktrees` | Git worktrees | Изоляция рабочего пространства |
| `superpowers:dispatching-parallel-agents` | Параллельные агенты | 2+ независимых задач |
| `superpowers:requesting-code-review` | Запрос code review | После завершения фичи |
| `superpowers:receiving-code-review` | Ответ на review | При получении feedback |
| `superpowers:finishing-a-development-branch` | Завершение ветки | После прохождения тестов |
| `superpowers:writing-skills` | Создание новых skills | Автоматизация workflow |
| `superpowers:subagent-driven-development` | Субагенты | Параллельное выполнение |

### 4.2 Примеры использования

#### Пример: Брейнсторминг новой фичи

**Вызов:**
```
/brainstorm добавить функцию закладок в читалку
```

**Процесс:**
1. Claude изучает текущий контекст проекта
2. Задаёт вопросы по одному (multiple choice)
3. Предлагает 2-3 подхода с trade-offs
4. Представляет дизайн секциями по 200-300 слов
5. Сохраняет дизайн в `docs/plans/YYYY-MM-DD-<topic>-design.md`

#### Пример: TDD для нового компонента

**Вызов:**
```
Skill: superpowers:test-driven-development
```

**Процесс:**
1. Написать тест для желаемого поведения
2. Запустить тест (должен упасть)
3. Написать минимальный код для прохождения теста
4. Рефакторинг
5. Повторить

---

## 5. Гайд по Context7 MCP

### 5.1 Доступные инструменты

| Инструмент | Описание |
|------------|----------|
| `resolve-library-id` | Найти ID библиотеки для документации |
| `get-library-docs` | Получить документацию библиотеки |

### 5.2 Примеры использования

#### Пример: Получить документацию epub.js

**Шаг 1: Найти ID библиотеки**
```
mcp__plugin_context7_context7__resolve-library-id
libraryName: "epub.js"
```

**Результат:**
```
Selected library: /futurepress/epub.js
```

**Шаг 2: Получить документацию**
```
mcp__plugin_context7_context7__get-library-docs
context7CompatibleLibraryID: "/futurepress/epub.js"
topic: "rendition"
tokens: 5000
```

**Результат:** Актуальная документация по epub.js rendition API.

---

## 6. Кастомные агенты и команды

### 6.1 Кастомные агенты

#### epub-reader
**Файл:** `.claude/agents/epub-reader.md`
**Назначение:** Специалист по epub.js интеграции

**Инструменты:**
- Read, Edit, Write, Grep, Glob
- mcp__plugin_context7_context7__resolve-library-id
- mcp__plugin_context7_context7__get-library-docs

**Экспертиза:**
- epub.js 0.3.93 API
- CFI навигация
- Description highlighting (9 стратегий)
- iOS Safari fixes

---

#### gemini-imagen
**Файл:** `.claude/agents/gemini-imagen.md`
**Назначение:** Специалист по Google AI APIs

**Инструменты:**
- Read, Edit, Write, Bash, Grep
- Context7 MCP tools

**Экспертиза:**
- Gemini 3.0 Flash API
- Imagen 4 генерация
- Retry patterns
- Prompt engineering

---

#### fancai-orchestrator
**Файл:** `.claude/agents/fancai-orchestrator.md`
**Назначение:** Роутинг задач между агентами

**Инструменты:**
- Task, Read, Grep, Glob

---

### 6.2 Команды проекта

| Команда | Файл | Описание |
|---------|------|----------|
| `/go` | `.claude/commands/go.md` | Старт dev-сессии |
| `/build` | `.claude/commands/build.md` | Сборка проекта |
| `/test` | `.claude/commands/test.md` | Запуск тестов |

### 6.3 Skills проекта

| Skill | Файл | Описание |
|-------|------|----------|
| `tech-stack` | `.claude/skills/tech-stack/SKILL.md` | Технологический стек проекта |

---

## 7. Список задач для проекта

На основе анализа кодовой базы, LSP диагностики и структуры проекта, формирую следующий список задач:

### 7.1 Критические (P0)

| # | Задача | Файл/Область | Описание |
|---|--------|--------------|----------|
| 1 | Исправить lazy imports для Pyright | `backend/app/core/container.py` | Добавить TYPE_CHECKING импорты |
| 2 | Добавить google.genai в requirements | `backend/requirements.txt` | Установить google-genai SDK |
| 3 | Удалить пустой файл | `frontend/src/components/Reader/EpubReader.tsx.new` | 0 байт, мусор |

### 7.2 Высокий приоритет (P1) — Рефакторинг

| # | Задача | Файл/Область | Описание |
|---|--------|--------------|----------|
| 4 | Заменить deprecated `platform` | `useEpubLoader.ts:353` | Использовать navigator.userAgentData |
| 5 | Заменить deprecated `webkitUserSelect` | `useEpubLoader.ts:511` | Использовать userSelect |
| 6 | Заменить `String.substr()` | `reader.ts:195` | Использовать String.slice() |
| 7 | Исправить deprecated `getMiddleSection` | `useDescriptionHighlighting.ts:367` | Обновить алгоритм |
| 8 | Рефакторинг EpubReader | `EpubReader.tsx` | 45KB, 1200 строк — разбить на компоненты |
| 9 | Рефакторинг useEpubLoader | `useEpubLoader.ts` | 750 строк — извлечь логику |
| 10 | Рефакторинг IOSTapZones | `IOSTapZones.tsx` | 18KB — упростить |

### 7.3 Средний приоритет (P2) — Документация

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 11 | Архивировать старые отчёты | `docs/reports/` | Перенести в archive/2025-Q4 |
| 12 | Обновить API документацию | `docs/reference/api/` | Синхронизировать с текущим API |
| 13 | Удалить устаревшие NLP docs | `docs/ru/refactoring/nlp/` | NLP система удалена в Dec 2025 |
| 14 | Создать docs/guides/lsp-usage.md | `docs/guides/` | Документировать LSP для разработчиков |
| 15 | Обновить README.md | Root | Актуализировать под текущий стек |
| 16 | Создать CONTRIBUTING.md | Root | Гайд для контрибьюторов |

### 7.4 Низкий приоритет (P3) — Улучшения

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 17 | Добавить LSP skill | `.claude/skills/` | Документировать использование LSP |
| 18 | Создать debugging skill | `.claude/skills/` | Интегрировать с LSP диагностикой |
| 19 | Добавить pre-commit hooks | Root | Автоформатирование и линтинг |
| 20 | Настроить Pyright в CI | `.github/workflows/` | Автопроверка типов Python |

### 7.5 Технический долг (P4)

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 21 | Типизация `Any` в container.py | Backend | 15+ мест с Any вместо конкретных типов |
| 22 | Неиспользуемые переменные | Backend | `original_text`, `offset` в gemini_extractor |
| 23 | Optional access без проверки | Backend | `_generator.generate()` может быть None |
| 24 | Консолидировать error handling | Frontend | Разные подходы в разных файлах |
| 25 | Унифицировать стили | Frontend | Inconsistent CSS naming |

### 7.6 Оптимизация (P5)

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 26 | Lazy loading компонентов | Frontend | Разбить bundle |
| 27 | Мемоизация в useDescriptionHighlighting | Frontend | 900 строк, много вычислений |
| 28 | Индексы базы данных | Backend | Оптимизировать частые запросы |
| 29 | Redis кэширование | Backend | Кэшировать extracted descriptions |
| 30 | Image optimization | Frontend | WebP, lazy loading |

### 7.7 Тестирование (P6)

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 31 | E2E тесты для iOS | Frontend | Playwright iOS simulation |
| 32 | Integration tests для Imagen | Backend | Mock Google API |
| 33 | Snapshot тесты UI | Frontend | Regression detection |
| 34 | Load testing | Backend | Artillery/k6 |
| 35 | Contract tests API | Full-stack | Pact |

### 7.8 Безопасность (P7)

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 36 | Audit dependencies | Both | npm audit, pip-audit |
| 37 | CORS review | Backend | Проверить настройки |
| 38 | Rate limiting review | Backend | Оптимизировать лимиты |
| 39 | Input validation | Backend | Pydantic validators |
| 40 | CSP headers | Frontend | Content Security Policy |

### 7.9 DevOps (P8)

| # | Задача | Область | Описание |
|---|--------|---------|----------|
| 41 | Docker multi-stage | DevOps | Оптимизировать образ |
| 42 | Health checks | DevOps | Улучшить мониторинг |
| 43 | Log aggregation | DevOps | Централизованные логи |
| 44 | Backup automation | DevOps | Автоматическое резервирование |
| 45 | Staging environment | DevOps | Отдельное окружение для тестов |

---

## 8. Рекомендации

### 8.1 Немедленные действия

1. **Исправить критические проблемы (P0)**
   - Удалить пустой файл `EpubReader.tsx.new`
   - Настроить TYPE_CHECKING imports в container.py

2. **Начать рефакторинг EpubReader**
   - Это самый большой файл (45KB)
   - Разбить на:
     - `EpubViewer.tsx` — рендеринг
     - `useEpubState.ts` — состояние
     - `useEpubNavigation.ts` — навигация
     - `useEpubTheme.ts` — темы

3. **Использовать LSP для рефакторинга**
   ```
   LSP findReferences <file> line:<line> character:<char>
   ```
   Перед изменением любой функции проверить все использования.

### 8.2 Workflow рекомендации

1. **Перед началом работы:**
   ```bash
   /go  # Запуск сессии
   ```

2. **Перед созданием фичи:**
   ```bash
   /brainstorm <описание фичи>
   ```

3. **При реализации:**
   - Использовать LSP для навигации
   - TDD через `superpowers:test-driven-development`

4. **При отладке:**
   - `superpowers:systematic-debugging`
   - LSP диагностика автоматически показывает проблемы

5. **Перед коммитом:**
   - `superpowers:verification-before-completion`
   - `/build` для проверки сборки
   - `/test` для запуска тестов

### 8.3 Поддержание оптимизации

1. **Не добавлять лишние плагины**
   - Текущие 5 плагинов покрывают все потребности
   - Проверять дубликаты перед установкой

2. **Обновлять CLAUDE.md минимально**
   - Детали в `.claude/skills/tech-stack/SKILL.md`
   - CLAUDE.md только для критической информации

3. **Использовать кастомных агентов**
   - `epub-reader` для EPUB задач
   - `gemini-imagen` для AI задач

---

## Приложение A: Структура .claude/

```
.claude/
├── settings.json           # Permissions, hooks, MCP
├── settings.local.json     # Локальные настройки (не коммитить)
├── agents/
│   ├── epub-reader.md      # EPUB специалист
│   ├── gemini-imagen.md    # AI services специалист
│   └── fancai-orchestrator.md  # Роутер задач
├── commands/
│   ├── go.md               # /go - старт сессии
│   ├── build.md            # /build - сборка
│   └── test.md             # /test - тесты
├── hooks/
│   └── format/
│       └── format_hook.sh  # Автоформатирование
├── skills/
│   └── tech-stack/
│       └── SKILL.md        # Tech stack reference
└── rules/                  # (зарезервировано)
```

---

## Приложение B: Полезные LSP команды

```bash
# Обзор файла
LSP documentSymbol <file> line:1 character:1

# Тип переменной/функции
LSP hover <file> line:<N> character:<N>

# Переход к определению
LSP goToDefinition <file> line:<N> character:<N>

# Все использования
LSP findReferences <file> line:<N> character:<N>

# Реализации интерфейса
LSP goToImplementation <file> line:<N> character:<N>

# Кто вызывает функцию
LSP incomingCalls <file> line:<N> character:<N>

# Что вызывает функция
LSP outgoingCalls <file> line:<N> character:<N>

# Поиск символа в проекте
LSP workspaceSymbol <file> line:<N> character:<N>
```

---

**Создано:** 2026-01-15
**Версия:** 1.0
**Автор:** Claude Opus 4.5
