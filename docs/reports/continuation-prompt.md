# Промпт для продолжения работы

Скопируй и вставь после перезапуска Claude Code:

---

## Промпт

```
Продолжаем оптимизацию Claude Code для проекта fancai.

## Выполнено (Фазы 0-7):

1. **Фаза 0** ✅ — Проверка безопасности (v2.1.7)
2. **Фаза 1** ✅ — Очистка: удалены 14 workflows плагинов, 3 MCP
3. **Фаза 2** ✅ — Создана структура .claude/ (agents, commands, skills, hooks)
4. **Фаза 3** ✅ — Установлен superpowers v4.0.3
5. **Фаза 6** ✅ — Верификация: /go работает, superpowers нет
6. **Фаза 7** ✅ — Установлен LSP:
   - vtsls + pyright серверы (глобально)
   - vtsls + pyright плагины (claude-code-lsps)
   - tweakcc патч применён
   - ENABLE_LSP_TOOL=1 в ~/.zshrc

## Текущая конфигурация:

- **Плагины (5):**
  - context7 (MCP)
  - playwright (отключён)
  - superpowers v4.0.3
  - vtsls@claude-code-lsps
  - pyright@claude-code-lsps

- **MCP:** 1 (context7)
- **Кастомные агенты:** epub-reader, gemini-imagen, fancai-orchestrator
- **Commands:** /go, /test, /build
- **LSP серверы:** vtsls, pyright

## Следующий шаг — Фаза 8: Верификация после перезапуска

1. Проверь токены при старте (выполни `/context` или посмотри системный промпт)
2. Проверь наличие LSP tool в списке tools
3. Протестируй `/brainstorm` (superpowers)
4. Если LSP работает — протестируй на TypeScript/Python файле
5. Обнови отчёт: docs/reports/2026-01-15-optimization-progress.md

## Отчёты:

- docs/reports/2026-01-15-optimization-progress.md (v6.0)
- docs/reports/2026-01-15-lsp-superpowers-research.md (v1.0)
- docs/reports/2026-01-15-claude-optimization-extended.md (v3.4)
```

---

## Быстрая проверка после перезапуска

```bash
# Проверить LSP
which vtsls pyright

# Проверить переменную
echo $ENABLE_LSP_TOOL

# Должно быть: 1
```

---

**Создано:** 2026-01-15
