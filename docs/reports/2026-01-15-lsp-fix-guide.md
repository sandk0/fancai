# Решение проблемы LSP в Claude Code

**Дата:** 2026-01-15
**Claude Code версия:** 2.1.7
**Статус:** Исследование завершено, требуется перезапуск

---

## Корневая причина

**Переменная окружения `ENABLE_LSP_TOOL=1` не загружена в текущую сессию.**

```bash
# Текущее состояние:
echo $ENABLE_LSP_TOOL  # Пусто!

# В ~/.zshrc:
export ENABLE_LSP_TOOL=1  # Есть, но не загружено
```

Claude Code был запущен до того, как переменная была добавлена в `.zshrc`.

---

## Исследование

### Источники информации

| Источник | URL | Ключевая информация |
|----------|-----|---------------------|
| Piebald-AI/claude-code-lsps | [GitHub](https://github.com/Piebald-AI/claude-code-lsps) | Правильный marketplace для LSP плагинов |
| Issue #14803 | [GitHub](https://github.com/anthropics/claude-code/issues/14803) | Race condition исправлен в v2.1.0+ |
| tweakcc | [GitHub](https://github.com/Piebald-AI/tweakcc) | Патч для активации LSP |
| boostvolt/claude-code-lsps | [GitHub](https://github.com/boostvolt/claude-code-lsps) | Альтернативный marketplace |
| Claude Code LSP Guide | [aifreeapi.com](https://www.aifreeapi.com/en/posts/claude-code-lsp) | Полный гайд по настройке |

### Проверенные компоненты

| Компонент | Статус | Путь |
|-----------|--------|------|
| vtsls сервер | ✅ Установлен | `/opt/homebrew/bin/vtsls` v0.3.0 |
| pyright сервер | ✅ Установлен | `/opt/homebrew/bin/pyright-langserver` v1.1.408 |
| vtsls плагин | ✅ Установлен | `~/.claude/plugins/cache/claude-code-lsps/vtsls/0.1.0/` |
| pyright плагин | ✅ Установлен | `~/.claude/plugins/cache/claude-code-lsps/pyright/0.1.0/` |
| .lsp.json файлы | ✅ Корректные | Содержат правильную конфигурацию |
| plugin.json файлы | ✅ Корректные | Метаданные плагинов |
| tweakcc патч | ✅ Применён | `~/.tweakcc/native-claudejs-patched.js` |
| tool-description-lsp.md | ✅ Создан | `~/.tweakcc/system-prompts/` |
| ENABLE_LSP_TOOL в .zshrc | ✅ Добавлено | `export ENABLE_LSP_TOOL=1` |
| ENABLE_LSP_TOOL в сессии | ❌ **Пусто** | Не загружено |

### Анализ кода Claude Code

В `native-claudejs-patched.js` найдено:
- 4 ссылки на `LSP_TOOL`
- 7 ссылок на `lspServers`
- Проверка `process.env.ENABLE_LSP_TOOL`

---

## Решение

### Шаг 1: Перезапуск Claude Code

```bash
# 1. Закрыть текущую сессию Claude Code (Ctrl+C или exit)

# 2. Открыть НОВЫЙ терминал (важно! загрузит ~/.zshrc)

# 3. Проверить переменную:
echo $ENABLE_LSP_TOOL  # Должно быть: 1

# 4. Запустить Claude Code:
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon
claude
```

### Шаг 2: Верификация

После запуска проверить наличие LSP tool:

1. **В системном промпте** — должен появиться инструмент LSP
2. **Тест команды:**
   ```
   Используй LSP tool для получения определения функции X в файле Y
   ```

### Шаг 3: Тест на реальном файле

```typescript
// frontend/src/hooks/epub/useDescriptionHighlighting.ts
// Попросить: "Используй LSP goToDefinition для findDescription на строке 45"
```

---

## Альтернативные решения (если основное не работает)

### Вариант A: Очистка кэша

```bash
rm -rf ~/.claude/plugins/cache/claude-code-lsps/
# Затем переустановить плагины через /plugin
```

### Вариант B: Альтернативный marketplace

```bash
# В Claude Code:
/plugin marketplace add boostvolt/claude-code-lsps
/plugin install pyright@claude-code-lsps
/plugin install vtsls@claude-code-lsps
```

### Вариант C: MCP-based LSP (cclsp)

Если плагины не работают, можно использовать MCP сервер:

```bash
# Установить cclsp
npm install -g @ktnyt/cclsp

# Добавить в settings.json как MCP сервер
```

Репозиторий: [ktnyt/cclsp](https://github.com/ktnyt/cclsp)

---

## Известные ограничения LSP в Claude Code

| Ограничение | Описание |
|-------------|----------|
| Нет UI индикации | Нет отображения статуса LSP серверов |
| Нет логирования | `--enable-lsp-logging` не производит вывод |
| Баги в операциях | Некоторые LSP операции могут работать некорректно |
| Нет rename-symbol | Функция переименования не поддерживается |

---

## LSP операции (после активации)

После успешной активации будут доступны:

| Операция | Описание |
|----------|----------|
| `goToDefinition` | Перейти к определению символа |
| `findReferences` | Найти все ссылки на символ |
| `hover` | Получить документацию/тип |
| `documentSymbol` | Список символов в файле |
| `workspaceSymbol` | Поиск символов в проекте |
| `goToImplementation` | Найти реализации интерфейса |
| `prepareCallHierarchy` | Получить иерархию вызовов |
| `incomingCalls` | Кто вызывает функцию |
| `outgoingCalls` | Что вызывает функция |

---

## Следующие шаги

1. [ ] Перезапустить Claude Code в новом терминале
2. [ ] Проверить наличие LSP tool
3. [ ] Протестировать на TypeScript файле
4. [ ] Протестировать на Python файле
5. [ ] Обновить отчёт с результатами

---

**Создано:** 2026-01-15
**Версия:** 1.0
