# Explanations (placeholder)

Эта директория задумывалась как Diataxis-секция «Explanation»
(архитектура, концепции, design decisions), но не была заполнена. Содержимое
из `architecture/`, `concepts/`, `design-decisions/`, `agents-system/`
(на которые ссылался прежний README) — никогда не было создано.

NLP-секция и Multi-NLP-архитектура, упоминавшиеся в старом README,
неактуальны — система была удалена в декабре 2025.

## Куда идти

| Что нужно                                     | Где это                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **High-level архитектура**                    | [`../../README.md`](../../README.md) → раздел «Архитектура (high-level)»                                                 |
| Vision / scope / out-of-scope                 | [`../../.planning/PROJECT.md`](../../.planning/PROJECT.md)                                                               |
| Key Decisions (почему именно так)             | [`../../.planning/PROJECT.md`](../../.planning/PROJECT.md) → таблица «Key Decisions»                                     |
| Constraints (на чём построено)                | [`../../.planning/PROJECT.md`](../../.planning/PROJECT.md) → раздел «Constraints»                                        |
| Milestone-история «как мы сюда пришли»        | [`../../.planning/MILESTONES.md`](../../.planning/MILESTONES.md)                                                         |
| Reader/EPUB концепции (CFI, iframe, gestures) | [`../../.claude/rules/reader.md`](../../.claude/rules/reader.md), [`../../frontend/CLAUDE.md`](../../frontend/CLAUDE.md) |
| Subscription model                            | Out of scope (см. `.planning/PROJECT.md`)                                                                                |

В будущем сюда могут переехать:

- Why we chose X over Y (решения по AI-провайдерам, выбор Caddy, выбор epub.js)
- CFI deep-dive (как именно работают позиции в EPUB)
- Spoiler-protection алгоритм (точная семантика token overlap, fuzzy matching)
- Annotation rendering deep-dive (DOM span wrapping vs SVG overlay)

---

_Last updated: 2026-04-30._
