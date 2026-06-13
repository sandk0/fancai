# Руководство по установке и настройке Serena MCP

**Дата:** 2026-01-15
**Проект:** fancai
**Цель:** Оптимизация использования токенов и контекста в Claude Code

---

## Оглавление

1. [Что такое Serena MCP](#что-такое-serena-mcp)
2. [Преимущества для fancai](#преимущества-для-fancai)
3. [Требования](#требования)
4. [Установка](#установка)
5. [Конфигурация проекта](#конфигурация-проекта)
6. [Онбординг](#онбординг)
7. [Индексация](#индексация)
8. [Лучшие практики](#лучшие-практики)
9. [Инструменты Serena](#инструменты-serena)
10. [Устранение неполадок](#устранение-неполадок)
11. [Метрики и мониторинг](#метрики-и-мониторинг)

---

## Что такое Serena MCP

Serena — это мощный инструментарий для работы с кодом, который предоставляет **семантическое понимание кодовой базы** на уровне символов (классов, функций, переменных), а не просто текстовый поиск.

### Как это работает

```
Без Serena:
📁 Проект → 🤖 Claude читает ВСЕ файлы → 💰 Большой расход токенов

С Serena:
📁 Проект → 🗂️ Индекс символов → 🤖 Claude читает ТОЛЬКО нужное → ✨ Экономия 60-70%
```

### Ключевые возможности

| Возможность | Описание |
|-------------|----------|
| **Семантический поиск** | Поиск по символам (`find_symbol`, `find_referencing_symbols`) |
| **Точное редактирование** | Вставка кода после символа (`insert_after_symbol`) |
| **Память проекта** | Хранение знаний о проекте в `.serena/memories/` |
| **30+ языков** | Python, TypeScript, JavaScript, Rust, Go, Java, C/C++ и др. |
| **Экономия токенов** | До 70% снижение потребления контекста |

---

## Преимущества для fancai

### Статистика проекта fancai

| Категория | Количество |
|-----------|------------|
| Компоненты | 86 файлов |
| Хуки | 56 файлов |
| Сервисы | 17+ файлов |
| Документация | 690+ .md файлов |
| **Общий размер** | ~50,000+ строк кода |

### Проблема

Claude Code **не имеет встроенной системы индексации** (в отличие от Cursor). При работе с большим проектом:
- Claude читает целые файлы вместо нужных фрагментов
- Быстрое исчерпание лимита токенов (даже Max 5x)
- Потеря контекста на длинных сессиях

### Решение с Serena

- **Индексация** — один раз создаём индекс всех символов
- **Семантический поиск** — находим нужный код по смыслу, а не по тексту
- **Память** — Serena запоминает структуру проекта
- **Экономия** — Claude получает только релевантный контекст

---

## Требования

### Программное обеспечение

| Требование | Версия | Проверка |
|------------|--------|----------|
| Python | 3.11+ | `python3 --version` |
| uv (пакетный менеджер) | latest | `uv --version` |
| Claude Code | latest | `claude --version` |
| Git | любая | `git --version` |

### Установка uv (если не установлен)

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# или через Homebrew (macOS)
brew install uv

# Проверка
uv --version
```

### Установка Python 3.11 (если не установлен)

```bash
# macOS через Homebrew
brew install python@3.11

# Проверка
python3.11 --version
```

---

## Установка

### Метод 1: Быстрая установка (рекомендуется)

Выполните команду в **корне проекта fancai**:

```bash
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena \
  serena start-mcp-server \
  --context claude-code \
  --project "$(pwd)"
```

**Параметры:**
- `--context claude-code` — отключает инструменты, дублирующие функции Claude Code
- `--project "$(pwd)"` — устанавливает текущую директорию как корень проекта

### Метод 2: Глобальная установка

Для работы с любым проектом (не только fancai):

```bash
claude mcp add --scope user serena -- uvx --from git+https://github.com/oraios/serena \
  serena start-mcp-server \
  --context claude-code \
  --project-from-cwd
```

`--project-from-cwd` автоматически определяет проект по текущей директории.

### Метод 3: Ручная конфигурация

Если автоматическая установка не сработала, добавьте конфигурацию вручную.

**Путь к файлу конфигурации:**
- macOS: `~/.config/claude-code/mcp.json`
- Linux: `~/.config/claude-code/mcp.json`
- Windows: `%APPDATA%\claude-code\mcp.json`

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "claude-code",
        "--project",
        "/Users/sandk/Documents/GitHub/fancai-vibe-hackathon"
      ],
      "env": {
        "SERENA_LOG_LEVEL": "info"
      }
    }
  }
}
```

### Проверка установки

После установки перезапустите Claude Code и выполните:

```
Покажи список доступных MCP инструментов
```

Должны появиться инструменты Serena: `find_symbol`, `get_symbols_overview`, `read_file` и др.

---

## Конфигурация проекта

### Автоматическое создание конфигурации

При первом запуске Serena создаст директорию `.serena/` в корне проекта:

```
fancai-vibe-hackathon/
├── .serena/
│   ├── project.yml       # Настройки проекта
│   ├── memories/         # Память о проекте
│   │   ├── project_overview.md
│   │   ├── code_style_and_conventions.md
│   │   ├── project_structure.md
│   │   ├── suggested_commands.md
│   │   └── tech_stack_and_dependencies.md
│   └── cache/            # Кэш индексов (.pkl файлы)
└── ...
```

### Настройка project.yml

Создайте или отредактируйте `.serena/project.yml`:

```yaml
# Основные языки проекта
language:
  - typescript
  - python

# Имя проекта
project_name: "fancai"

# Игнорировать файлы из .gitignore
ignore_all_files_in_gitignore: true

# Дополнительные игнорируемые пути
ignored_paths:
  - node_modules/
  - __pycache__/
  - .venv/
  - dist/
  - build/
  - coverage/
  - .pytest_cache/
  - "*.pyc"
  - "*.pyo"
  - ".git/"

# Режим только для чтения (false для редактирования)
read_only: false

# Исключённые инструменты (если нужно отключить какие-то)
excluded_tools: []

# Начальный промпт (опционально)
initial_prompt: |
  Это проект fancai — веб-приложение для чтения книг с AI-генерацией изображений.
  Frontend: React 19 + TypeScript, epub.js
  Backend: FastAPI + Python 3.11, PostgreSQL, Redis
  Продакшен: https://fancai.ru
```

### Глобальная конфигурация

Глобальные настройки хранятся в `~/.serena/serena_config.yml`:

```yaml
# Уровень логирования: debug, info, warning, error
log_level: info

# Включить поиск инструментов по запросу (экономия токенов)
enable_tool_search: true

# Тайм-аут операций (секунды)
timeout: 60
```

---

## Онбординг

### Что такое онбординг

Онбординг — это процесс "знакомства" Serena с вашим проектом. Serena анализирует структуру кода и создаёт **файлы памяти** для быстрого доступа в будущем.

### Запуск онбординга

После установки, в Claude Code выполните:

```
Выполни онбординг проекта с помощью Serena
```

Или через командную строку:

```bash
uvx --from git+https://github.com/oraios/serena serena project onboard
```

### Что создаётся при онбординге

| Файл | Содержимое |
|------|------------|
| `project_overview.md` | Общее описание проекта |
| `code_style_and_conventions.md` | Стиль кода и конвенции |
| `project_structure.md` | Структура директорий |
| `suggested_commands.md` | Рекомендуемые команды |
| `tech_stack_and_dependencies.md` | Технологический стек |

### Важные предупреждения

> **Внимание:** Онбординг потребляет значительное количество токенов при первом запуске. Рекомендуется выполнять его:
> - В начале рабочего дня (когда лимиты обновились)
> - Или когда лимит токенов не критичен

> **Проверьте точность:** После онбординга просмотрите созданные файлы в `.serena/memories/`. Возможны неточности, которые стоит исправить вручную.

### Ручная корректировка памяти

Отредактируйте файлы в `.serena/memories/` для уточнения информации о проекте:

```markdown
<!-- .serena/memories/project_overview.md -->

# Обзор проекта fancai

## Назначение
Веб-приложение для чтения художественной литературы с автоматической
генерацией изображений по описаниям в тексте.

## Ключевые компоненты

### Frontend (React 19 + TypeScript)
- 86 компонентов в `frontend/src/components/`
- 56 хуков в `frontend/src/hooks/`
- epub.js для рендеринга EPUB
- TanStack Query для серверного состояния
- Zustand для клиентского состояния

### Backend (FastAPI + Python 3.11)
- 17+ сервисов в `backend/app/services/`
- PostgreSQL 15 + Redis 7.4
- Google Gemini API для извлечения описаний
- Google Imagen 4 для генерации изображений

## Продакшен
https://fancai.ru
```

---

## Индексация

### Зачем нужна индексация

Индексация создаёт **кэш символов** проекта. Это позволяет Serena мгновенно находить функции, классы, переменные без чтения файлов.

### Запуск индексации

```bash
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon
uvx --from git+https://github.com/oraios/serena serena project index
```

### Что создаётся

```
.serena/
└── cache/
    ├── symbols_typescript.pkl   # Индекс TypeScript символов
    ├── symbols_python.pkl       # Индекс Python символов
    └── ...
```

### Автоматическое обновление

После первой индексации, Serena автоматически обновляет индекс при изменении файлов. Ручная переиндексация нужна только при:
- Масштабном рефакторинге
- Добавлении большого количества файлов
- Проблемах с поиском символов

### Принудительная переиндексация

```bash
uvx --from git+https://github.com/oraios/serena serena project index --force
```

---

## Лучшие практики

### 1. Структура кода

Serena эффективнее работает с хорошо структурированным кодом:

```typescript
// ✅ Хорошо: чёткие имена функций и типы
export function useDescriptionHighlighting(
  rendition: Rendition | null,
  descriptions: Description[]
): HighlightResult {
  // ...
}

// ❌ Плохо: анонимные функции, нет типов
export const fn = (r, d) => {
  // ...
}
```

### 2. Типизация

**Для TypeScript/JavaScript:**
- Используйте TypeScript strict mode
- Добавляйте типы к экспортируемым функциям

**Для Python:**
- Используйте type hints
- Применяйте Pydantic модели

### 3. Чистое состояние Git

Начинайте сессии с чистым git состоянием:

```bash
git status  # должен показать "nothing to commit"
```

Это позволяет Serena отслеживать изменения через `git diff`.

### 4. Настройка line endings (Windows)

```bash
git config --global core.autocrlf true
```

### 5. Эффективный промпт

```
# ❌ Неэффективно (без Serena)
Покажи мне весь файл useDescriptionHighlighting.ts

# ✅ Эффективно (с Serena)
Найди функцию highlightDescription и покажи её сигнатуру
```

### 6. Использование памяти

Обновляйте память проекта при значительных изменениях:

```
Обнови memory файлы Serena с учётом последних изменений в архитектуре
```

### 7. Когда Serena неэффективна

| Сценарий | Рекомендация |
|----------|--------------|
| Маленький проект (<10 файлов) | Не используйте Serena |
| Создание с нуля (greenfield) | Отложите до появления структуры |
| Простые задачи (1-2 файла) | Используйте стандартные инструменты |

---

## Инструменты Serena

### Основные инструменты поиска

| Инструмент | Назначение | Пример |
|------------|------------|--------|
| `find_symbol` | Найти символ по имени | `find_symbol("useTheme")` |
| `get_symbols_overview` | Обзор всех символов файла | `get_symbols_overview("EpubReader.tsx")` |
| `find_referencing_symbols` | Найти использования символа | `find_referencing_symbols("useTheme")` |
| `find_referencing_code_snippets` | Найти код, использующий символ | `find_referencing_code_snippets("BookCard")` |

### Инструменты редактирования

| Инструмент | Назначение |
|------------|------------|
| `insert_after_symbol` | Вставить код после символа |
| `replace_symbol` | Заменить символ |
| `rename_symbol` | Переименовать символ во всём проекте |

### Инструменты памяти

| Инструмент | Назначение |
|------------|------------|
| `read_memory` | Прочитать файл памяти |
| `write_memory` | Записать в память |
| `list_memories` | Список файлов памяти |

### Инструменты проекта

| Инструмент | Назначение |
|------------|------------|
| `activate_project` | Активировать проект |
| `get_project_info` | Информация о проекте |
| `execute_shell_command` | Выполнить команду |

---

## Устранение неполадок

### Проблема: Serena не запускается

**Симптомы:** MCP инструменты недоступны после перезапуска Claude Code.

**Решение 1:** Проверьте путь к `uvx`:

```bash
which uvx
# Должен вернуть путь, например: /Users/sandk/.cargo/bin/uvx
```

Если путь не определён, укажите полный путь в конфигурации:

```json
{
  "mcpServers": {
    "serena": {
      "command": "/Users/sandk/.cargo/bin/uvx",
      ...
    }
  }
}
```

**Решение 2:** Проверьте Python:

```bash
python3.11 --version
python3.11 -c "import serena; print('OK')"
```

### Проблема: Ошибки индексации

**Симптомы:** `serena project index` завершается с ошибкой.

**Решение:** Очистите кэш и переиндексируйте:

```bash
rm -rf .serena/cache/
uvx --from git+https://github.com/oraios/serena serena project index
```

### Проблема: Высокое потребление токенов при онбординге

**Симптомы:** Онбординг использует слишком много токенов.

**Решение:** Настройте игнорируемые пути в `project.yml`:

```yaml
ignored_paths:
  - node_modules/
  - docs/
  - "*.md"
  - "*.txt"
  - coverage/
  - dist/
  - build/
```

### Проблема: Неточности в памяти

**Симптомы:** Serena даёт неверную информацию о проекте.

**Решение:** Вручную отредактируйте файлы в `.serena/memories/`:

```bash
# Открыть для редактирования
code .serena/memories/
```

### Проблема: Медленный запуск

**Симптомы:** Первый запуск MCP сервера занимает долго.

**Решение:** Выполните индексацию заранее:

```bash
uvx --from git+https://github.com/oraios/serena serena project index
```

---

## Метрики и мониторинг

### Отслеживание эффективности

Для оценки пользы от Serena отслеживайте:

| Метрика | До Serena | После Serena | Ожидание |
|---------|-----------|--------------|----------|
| Токены за сессию | ~X | ~Y | -60-70% |
| Время до ответа | ~A сек | ~B сек | -30-50% |
| Точность предложений | - | - | улучшение |
| Ошибки контекста | частые | редкие | -80% |

### Логирование

Включите debug логирование для диагностики:

```yaml
# ~/.serena/serena_config.yml
log_level: debug
```

Или через переменную окружения:

```json
{
  "env": {
    "SERENA_LOG_LEVEL": "debug"
  }
}
```

### Просмотр использования

В Claude Code периодически проверяйте:

```
Сколько токенов использовано в этой сессии?
```

---

## Дополнительные ресурсы

### Официальная документация

| Ресурс | URL |
|--------|-----|
| GitHub | https://github.com/oraios/serena |
| Документация | https://oraios.github.io/serena/ |
| Клиенты | https://oraios.github.io/serena/02-usage/030_clients.html |
| Конфигурация | https://oraios.github.io/serena/02-usage/050_configuration.html |
| Workflow | https://oraios.github.io/serena/02-usage/040_workflow.html |

### Сообщество

- [DEV.to статья](https://dev.to/webdeveloperhyper/how-to-use-ai-more-efficiently-for-free-serena-mcp-5gj6)
- [YouTube демонстрация](https://www.youtube.com/watch?v=wYWyJNs1HVk)

### Поддерживаемые языки

| Полная поддержка | Частичная поддержка |
|------------------|---------------------|
| Python | Ruby |
| TypeScript | Go |
| JavaScript | C# |
| Java | |
| Rust | |
| C/C++ | |

---

## Чек-лист установки

- [ ] Установлен Python 3.11+
- [ ] Установлен uv пакетный менеджер
- [ ] Выполнена команда `claude mcp add serena...`
- [ ] Перезапущен Claude Code
- [ ] Проверена доступность MCP инструментов
- [ ] Создана/отредактирована `.serena/project.yml`
- [ ] Выполнен онбординг проекта
- [ ] Выполнена индексация (`serena project index`)
- [ ] Проверены файлы памяти в `.serena/memories/`
- [ ] Добавлена `.serena/cache/` в `.gitignore`

---

## Заключение

Serena MCP — мощный инструмент для оптимизации работы с Claude Code в больших проектах вроде fancai. При правильной настройке вы получите:

- **60-70% экономии токенов**
- **Семантическое понимание кода**
- **Быстрый поиск по символам**
- **Память о структуре проекта**

Ключ к успеху — качественный онбординг и регулярное обновление памяти при изменениях в архитектуре.

---

**Создано:** 2026-01-15
**Автор:** Claude Code (Opus 4.5)
**Версия:** 1.0
