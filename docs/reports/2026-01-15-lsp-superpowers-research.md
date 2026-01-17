# Исследование LSP и Superpowers для Claude Code

**Дата:** 2026-01-15
**Claude Code версия:** 2.1.7
**Проект:** fancai

---

## 1. LSP (Language Server Protocol) в Claude Code

### 1.1 Обзор

LSP интеграция была добавлена в Claude Code **версии 2.0.74** (декабрь 2025). Обеспечивает:
- Go-to-definition (переход к определению)
- Find references (поиск ссылок)
- Document symbols (символы документа)
- Real-time diagnostics (диагностика в реальном времени)

**Производительность:** Поиск всех вызовов функции ~50ms (LSP) vs ~45s (текстовый поиск) — **улучшение в 900 раз**.

### 1.2 Способы настройки LSP

#### Вариант A: Официальные плагины (claude-plugins-official)

**Статус:** Плагины `typescript-lsp` и `pyright-lsp` — это **placeholder'ы** (только README с инструкциями по установке).

**Не рекомендуется** — требует ручной установки серверов и не предоставляет интеграции.

#### Вариант B: Claude Code LSPs Marketplace (Рекомендуется)

**Источник:** [Piebald-AI/claude-code-lsps](https://github.com/Piebald-AI/claude-code-lsps)

**Установка:**
```bash
# 1. Добавить marketplace
/plugin marketplace add Piebald-AI/claude-code-lsps

# 2. Установить LSP серверы глобально
npm install -g @vtsls/language-server typescript  # TypeScript
npm install -g pyright                             # Python

# 3. Установить плагины
/plugin install vtsls@claude-code-lsps            # TypeScript
/plugin install pyright@claude-code-lsps          # Python

# 4. Включить LSP tool (требуется переменная окружения)
export ENABLE_LSP_TOOL=1
# Добавить в ~/.zshrc или ~/.bashrc для постоянного использования
```

**Поддерживаемые языки (16):**

| Язык | Плагин | Команда установки сервера |
|------|--------|---------------------------|
| TypeScript/JS | vtsls | `npm install -g @vtsls/language-server typescript` |
| Python | pyright | `npm install -g pyright` |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| Rust | rust-analyzer | `rustup component add rust-analyzer` |
| Java | jdtls | `brew install jdtls` |
| Kotlin | kotlin-lsp | `brew install JetBrains/utils/kotlin-lsp` |
| C/C++ | clangd | `brew install llvm` |
| PHP | phpactor | `composer global require phpactor/phpactor` |
| Ruby | ruby-lsp | `gem install ruby-lsp` |
| C# | omnisharp | `brew install omnisharp/omnisharp-roslyn/omnisharp-mono` |
| HTML/CSS | vscode-langservers | `npm install -g vscode-langservers-extracted` |
| Vue | vue-language-server | `npm install -g @vue/language-server` |

**Важно:** После установки выполнить `npx tweakcc --apply` для патча Claude Code.

#### Вариант C: cclsp MCP Server (Альтернатива)

**Источник:** [ktnyt/cclsp](https://github.com/ktnyt/cclsp)

**Преимущества:**
- Оптимизирован для LLM (автоматическая коррекция позиций)
- MCP интеграция (работает как сервер)
- Интерактивная настройка

**Установка:**
```bash
npm install -g cclsp
npx cclsp@latest setup  # Интерактивный wizard
```

**Конфигурация (cclsp.json):**
```json
{
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    "python": {
      "command": ["pylsp"],
      "extensions": [".py"]
    }
  }
}
```

### 1.3 Локальная vs Глобальная установка

| Аспект | LSP серверы | Claude Code плагины |
|--------|-------------|---------------------|
| **Установка** | Только глобально (npm -g, brew, etc.) | Поддержка --scope project |
| **Настройка** | Через PATH | Через marketplace |
| **Проект-специфично** | Нет | Частично (есть баги) |

**Вывод:** LSP серверы устанавливаются **только глобально**. Плагины Claude Code можно ставить с `--scope project`, но есть известные баги.

### 1.4 Рекомендация для fancai

```bash
# Шаг 1: Добавить marketplace
/plugin marketplace add Piebald-AI/claude-code-lsps

# Шаг 2: Установить серверы
npm install -g @vtsls/language-server typescript pyright

# Шаг 3: Установить плагины для проекта
/plugin install vtsls@claude-code-lsps --scope project
/plugin install pyright@claude-code-lsps --scope project

# Шаг 4: Активировать LSP
echo 'export ENABLE_LSP_TOOL=1' >> ~/.zshrc
source ~/.zshrc

# Шаг 5: Патч Claude Code
npx tweakcc --apply

# Шаг 6: Перезапустить Claude Code
```

---

## 2. Superpowers Plugin

### 2.1 Обзор

**Источник:** [obra/superpowers](https://github.com/obra/superpowers)
**Версия:** 4.0.3
**Назначение:** TDD, debugging, planning workflows

**Компоненты:**
- 14 skills (brainstorming, test-driven-development, systematic-debugging, etc.)
- 3 commands (/brainstorm, /write-plan, /execute-plan)
- SessionStart hook (инъекция контекста)

### 2.2 Известные проблемы

| Issue | Описание | Статус |
|-------|----------|--------|
| [#151](https://github.com/obra/superpowers/issues/151) | Skills не обнаруживаются | Закрыт (баг кэширования) |
| [#178](https://github.com/obra/superpowers/issues/178) | Brainstorming не находится после 4.0 | Открыт |
| [#189](https://github.com/obra/superpowers/issues/189) | disable-model-invocation ошибка | Частично исправлен |
| [#237](https://github.com/obra/superpowers/issues/237) | Subagents не получают контекст | Открыт |

### 2.3 Причины неработоспособности

1. **Конфликт имён:** Slash commands и skills имеют похожие имена → Claude Code путается
2. **Кэширование:** Баги в кэше marketplace (требуется сброс)
3. **Token budget:** Skills занимают много токенов → `SLASH_COMMAND_TOOL_CHAR_BUDGET=30000`
4. **Subagents:** Hook инъектирует контекст только в главную сессию

### 2.4 Workarounds

#### Workaround 1: Сброс кэша marketplace

```bash
# Удалить и переустановить
/plugin uninstall superpowers@superpowers-marketplace
/plugin marketplace remove superpowers-marketplace
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

#### Workaround 2: Увеличить token budget

```bash
# Запуск с увеличенным бюджетом
SLASH_COMMAND_TOOL_CHAR_BUDGET=30000 claude
```

#### Workaround 3: Добавить инструкции в CLAUDE.md

```markdown
## Superpowers Skills Location

Skills находятся в: `~/.claude/plugins/cache/superpowers-marketplace/superpowers/*/skills/`

При вызове skill (например, brainstorming):
1. Прочитать файл: `skills/brainstorming/SKILL.md`
2. Следовать инструкциям в файле
```

#### Workaround 4: Использовать natural language

Вместо `/brainstorm` использовать:
- "What are your superpowers?"
- "I'd like to use the brainstorming skill"
- "Use systematic debugging to find the issue"

### 2.5 Альтернатива: Кастомные skills

Учитывая нестабильность superpowers, рекомендуется создать **собственные skills** в `.claude/skills/`:

```
.claude/skills/
├── brainstorming/
│   └── SKILL.md
├── tdd/
│   └── SKILL.md
└── debugging/
    └── SKILL.md
```

**Пример .claude/skills/brainstorming/SKILL.md:**
```markdown
---
description: "Brainstorming skill for feature design"
---

# Brainstorming

Before implementing any feature:

1. **Clarify requirements**
   - What problem does this solve?
   - Who is the user?
   - What are the constraints?

2. **Explore options**
   - List 3+ approaches
   - Pros/cons for each
   - Technical feasibility

3. **Design decision**
   - Choose approach with justification
   - Identify risks
   - Define success criteria

4. **Implementation plan**
   - Break into tasks
   - Identify dependencies
   - Determine test strategy
```

---

## 3. Сравнение подходов

### LSP

| Подход | Сложность | Стабильность | Рекомендация |
|--------|-----------|--------------|--------------|
| claude-plugins-official | Низкая | Не работает | Не использовать |
| claude-code-lsps | Средняя | Стабильно | **Рекомендуется** |
| cclsp MCP | Высокая | Стабильно | Для продвинутых |

### Superpowers vs Кастомные skills

| Аспект | Superpowers | Кастомные skills |
|--------|-------------|------------------|
| Установка | Сложная (много багов) | Простая |
| Поддержка | Зависит от maintainer | Полный контроль |
| Функционал | Богатый (14 skills) | По необходимости |
| Стабильность | Низкая | Высокая |
| **Рекомендация** | Не использовать пока | **Использовать** |

---

## 4. План действий для fancai

### Немедленные действия

1. **LSP:**
   ```bash
   /plugin marketplace add Piebald-AI/claude-code-lsps
   npm install -g @vtsls/language-server typescript pyright
   /plugin install vtsls@claude-code-lsps --scope project
   /plugin install pyright@claude-code-lsps --scope project
   echo 'export ENABLE_LSP_TOOL=1' >> ~/.zshrc
   npx tweakcc --apply
   ```

2. **Skills (вместо superpowers):**
   - Создать `.claude/skills/brainstorming/SKILL.md`
   - Создать `.claude/skills/tdd/SKILL.md`
   - Создать `.claude/skills/debugging/SKILL.md`

### Отложенные действия

3. **Мониторинг superpowers:**
   - Следить за [Issue #178](https://github.com/obra/superpowers/issues/178)
   - Попробовать после выхода стабильной версии

---

## 5. Источники

- [Piebald-AI/claude-code-lsps](https://github.com/Piebald-AI/claude-code-lsps)
- [ktnyt/cclsp](https://github.com/ktnyt/cclsp)
- [obra/superpowers](https://github.com/obra/superpowers)
- [obra/superpowers Issues](https://github.com/obra/superpowers/issues)
- [Claude Code Plugins Docs](https://code.claude.com/docs/en/discover-plugins)
- [Claude Code LSP Article](https://www.aifreeapi.com/en/posts/claude-code-lsp)
- [Hacker News: Claude Code LSP](https://news.ycombinator.com/item?id=46355165)
- [Claude Code Plugin CLI Guide](https://dev.to/garyj/claude-code-plugin-cli-the-missing-manual-40nf)

---

**Создано:** 2026-01-15
**Версия:** 1.0
