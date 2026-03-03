# LLM модели и стратегия

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секция 2

---

## 1. Сравнение моделей для русского текста на OpenRouter

| Модель                    | Input $/1M | Output $/1M | Контекст   | Русский               | JSON Schema       | Рекомендация             |
| ------------------------- | ---------- | ----------- | ---------- | --------------------- | ----------------- | ------------------------ |
| **Gemini 3 Flash**        | $0.50      | $3.00       | 1M         | Сильный (NER F1=0.98) | Native            | **Primary**              |
| **Gemini 2.5 Flash**      | $0.30      | $2.50       | 1M         | Сильный               | Native            | **Fallback 1**           |
| **Gemini 2.5 Flash Lite** | $0.10      | $0.40       | 1M         | Приемлемый            | Native            | **Free tier**            |
| **Claude Haiku 4.5**      | $1.00      | $5.00       | 200K       | Отличный              | Guaranteed strict | **Fallback 2 / Premium** |
| **Qwen3.5 Plus**          | $0.40      | $2.40       | 1M         | Хороший (119 языков)  | Via provider      | Наблюдать                |
| DeepSeek V3.2             | $0.28      | $0.40       | 164K       | Нестабильный          | Нет json_schema   | **Не рекомендуется**     |
| Llama 4                   | —          | —           | 1M         | Не поддерживается     | —                 | **Не подходит**          |
| Qwen3 32B                 | $0.40      | $3.20       | 32K native | Нет данных            | Баги              | **Не рекомендуется**     |

## 2. Стоимость на книгу (100 глав × 20K input + 3K output)

| Модель                | Стоимость/книга | vs текущего |
| --------------------- | --------------- | ----------- |
| Gemini 2.5 Flash Lite | **$0.32**       | -83%        |
| Gemini 2.5 Flash      | **$1.35**       | -29%        |
| Gemini 3 Flash        | **$1.90**       | baseline    |
| Claude Haiku 4.5      | **$3.50**       | +84%        |

## 3. Fallback chain

```
Primary:      Gemini 3 Flash      ($1.90/книга)
Fallback 1:   Gemini 2.5 Flash    ($1.35/книга) — при rate limit / ошибках
Fallback 2:   Claude Haiku 4.5    ($3.50/книга) — другой провайдер, лучший JSON Schema
Fallback 3:   Qwen3.5 Plus        ($1.52/книга) — третий провайдер
```

Переключение: автоматическое через OpenRouter `models` массив + ручное по `JSON parse failure > 3`.

## 4. Стратегия по тарифам

| Тариф       | Модель                                                 | Стоимость/книга |
| ----------- | ------------------------------------------------------ | --------------- |
| **Free**    | Gemini 2.5 Flash Lite                                  | $0.32           |
| **Paid**    | Gemini 3 Flash                                         | $1.90           |
| **Premium** | Claude Haiku 4.5 (extraction) + Sonnet 4.6 (synthesis) | $3.50-5.00      |

## 5. Модели не подходящие для fancai

| Модель                     | Причина дисквалификации                             |
| -------------------------- | --------------------------------------------------- |
| **Llama 4**                | Русский не в 12 поддерживаемых языках               |
| **DeepSeek V3.2**          | Нет json_schema, нестабильный русский               |
| **Qwen3 32B**              | 32K native контекст < 30-40K глав, JSON баги        |
| **OpenRouter Auto Router** | Нет контроля модели — inconsistency через 100+ глав |

---

## Источники

- [Gemini 3 Flash Announcement](https://blog.google/products/gemini/gemini-3-flash/)
- [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Context Rot Research (Chroma)](https://research.trychroma.com/context-rot)
- [Russian NER Evaluation (arxiv)](https://arxiv.org/html/2506.02589v1)
