# Глубокий аудит отчёта: Прямая интеграция Gemini API для fancai

## Контекст

Ты проводишь **критический аудит** исследовательского отчёта по миграции AI-пайплайна проекта fancai (fiction reader с AI-иллюстрациями и интерактивной энциклопедией) с OpenRouter на прямой Gemini API.

**Отчёт для аудита:** `docs/research/gemini-api-direct-integration-research.md`
**Дата отчёта:** 2026-03-30 (v2)
**Дата аудита:** 30 марта 2026

Отчёт содержит 13 разделов: Executive Summary, таблица моделей, качество (бенчмарки), thinking control, context caching, batch API, structured output, Nano Banana (image generation), tiered strategy, расчёт стоимости (6 сценариев), пропущенные возможности, план миграции, источники.

## Твоя задача

Провести **глубокий, широкий и критический аудит** каждого раздела отчёта. Для каждого тезиса, числа, рекомендации — проверить актуальность и точность через веб-исследование текущей документации Gemini API (на 30 марта 2026).

## Методология аудита

### Фаза 1: Верификация фактов (по каждому разделу)

Для **каждого** утверждения в отчёте:

1. Открой первоисточник (ai.google.dev, openrouter.ai, github.com/googleapis/python-genai)
2. Сверь конкретные числа: цены, лимиты, размеры контекста, минимумы кэша
3. Проверь, не изменились ли данные с момента написания отчёта
4. Проверь, не перепутаны ли данные между моделями

### Фаза 2: Поиск ошибок и неточностей

Обрати особое внимание на:

**Цены и экономика:**

- Цены за 1M токенов для КАЖДОЙ модели (input, output, cached, batch) — сверь с https://ai.google.dev/pricing
- Цены за изображение для Nano Banana 2, Nano Banana Pro, Gemini 2.5 Flash Image, Imagen 4
- Расчёты стоимости в 6 сценариях — пересчитай математику вручную
- Batch API скидка: действительно 50% на input И output? Или только на одно?
- Цены OpenRouter vs Direct: действительно 0% markup? Проверь для каждой модели

**Модели:**

- Model ID каждой модели — точны ли? Сверь с https://ai.google.dev/gemini-api/docs/models
- Context window и max output tokens для каждой модели
- Даты deprecation — сверь с https://ai.google.dev/gemini-api/docs/deprecations
- Статус моделей (Preview vs GA) — не поменялся ли?
- Поддерживаемые фичи (structured output, thinking, caching, batch) — для каждой модели

**Thinking Control:**

- `thinking_level` для 3.x: точные значения? Какие модели поддерживают `minimal`?
- `thinking_budget` для 2.5: допустимые диапазоны для каждой модели
- Default значения thinking для каждой модели
- Можно ли комбинировать `thinking_level` и `thinking_budget`?
- Как thinking tokens тарифицируются — действительно по цене output?

**Context Caching:**

- Минимальные пороги: отчёт утверждает 2048 для 2.5, 4096 для 3.x — точно ли?
- Считается ли `systemInstruction` к минимуму?
- Считаются ли `tools[]` к минимуму?
- Скидка: 90% для explicit, 90% для implicit — или есть различия?
- Storage cost: $1.00/1M/час для всех моделей?
- TTL: default 1 час — точно?

**Batch API:**

- 50% скидка — на что именно? Input + Output + Thinking?
- Поддерживает ли structured output? (response_schema в batch)
- Поддерживает ли thinking?
- Совместимость с caching — как именно работают скидки?
- Максимальный размер batch (файл, количество запросов)
- Поддерживает ли Gemini 3.x?

**Nano Banana / Image Generation:**

- Model ID для каждой image-модели
- Цены за изображение по разрешениям — пересчитай из token pricing
- Aspect ratios — полный ли список?
- Safety filters: двухуровневая архитектура — подтверждается ли документацией?
- `finish_reason` значения для image safety — точный ли список?
- Формат ответа через OpenRouter — действительно идентичен для NB2 и FLUX.2?
- Параметр `modalities` — действительно `["image", "text"]` для NB2?
- Поддержка русских промптов — что говорит документация?
- Баг SDK #2024 (IMAGE_SAFETY hang) — актуален ли? Исправлен?

**Structured Output:**

- `response.parsed` — действительно возвращает Pydantic instance?
- `_inline_defs()` не нужен в direct API — подтверждено?
- `text/x.enum` — поддерживается?
- Ограничения: `anyOf`, вложенные схемы, default values

**Safety Settings:**

- Default для Gemini 2.5+ и 3.x — действительно `OFF`?
- Пороги: `OFF` vs `BLOCK_NONE` — одно и то же?

**Rate Limits:**

- Free tier RPM/TPM/RPD для каждой модели — актуальны ли?
- Pay-as-you-go тiers — пороги входа

### Фаза 3: Поиск пропущенных возможностей

Изучи **ВСЮ** документацию Gemini API и найди фичи, не упомянутые в отчёте:

1. Открой https://ai.google.dev/gemini-api/docs и изучи КАЖДЫЙ раздел навигации
2. Для каждой фичи оцени применимость для fancai:
   - fancai обрабатывает русские книги: extraction описаний + entity граф
   - fancai генерирует иллюстрации по описаниям
   - Стек: FastAPI + Celery + PostgreSQL + Redis
   - SDK: google-genai>=1.69.0

Области для поиска пропущенного:

- URL Context (может ли модель читать URL как контекст?)
- Computer Use (релевантно ли?)
- Deep Research (автономный исследовательский агент)
- Thought Signatures (сохранение reasoning между вызовами)
- Media Resolution Control
- Context Circulation (tool results в контексте)
- Новые модели, анонсированные в марте 2026
- Изменения в API, произошедшие в последние 2 недели
- Новые фичи google-genai SDK (проверь releases на PyPI и GitHub)
- Аудио-вход (можно ли обрабатывать аудиокниги?)
- PDF-вход (можно ли загрузить целый EPUB/PDF?)
- Multimodal embeddings (для entity matching?)
- Prompt caching best practices (официальные рекомендации Google)

### Фаза 4: Оценка рекомендаций

Критически оцени рекомендации отчёта:

1. **"Gemini 3 Flash для extraction"** — оправдано ли? Бенчмарк Box Blog на документах, наша задача — русская художественная литература. Переносимы ли результаты?

2. **"temperature=1.0 обязательна для Gemini 3"** — это рекомендация или жёсткое требование? Что именно говорит документация? Есть ли нюансы для structured output?

3. **"NB2 primary, FLUX.2 fallback"** — оценка safety filter failure rate для книжных иллюстраций. Есть ли данные о реальном проценте блокировок?

4. **"Batch API — единственный способ удержать цену"** — точно? Нет ли других оптимизаций?

5. **"Fine-tuning недоступен в AI Studio"** — актуально ли? Не появилось ли что-то новое?

6. **Fallback chain: 3 Flash → 3.1 Flash-Lite → OpenRouter 2.5 Flash-Lite** — есть ли лучшие варианты?

## Требования к результату

### Формат отчёта аудита

```markdown
# Аудит: Gemini API Integration Research v2

**Дата аудита:** 2026-03-30
**Аудитор:** Claude Opus 4.6

## Сводка аудита

| Категория | Ошибок | Неточностей | Устарело | Пропущено |
| --------- | ------ | ----------- | -------- | --------- |
| Цены      | ?      | ?           | ?        | ?         |
| Модели    | ?      | ?           | ?        | ?         |
| Caching   | ?      | ?           | ?        | ?         |
| Batch     | ?      | ?           | ?        | ?         |
| Images    | ?      | ?           | ?        | ?         |
| SDK       | ?      | ?           | ?        | ?         |
| Другое    | ?      | ?           | ?        | ?         |

## Ошибки (требуют исправления)

### E-001: [Название ошибки]

- **Раздел отчёта:** X.X
- **Утверждение в отчёте:** "цитата"
- **Фактическое значение:** ...
- **Источник:** [ссылка на документацию]
- **Влияние:** [как ошибка влияет на выводы/расчёты]

### E-002: ...

## Неточности (требуют уточнения)

### I-001: [Название]

- **Раздел:** X.X
- **Проблема:** ...
- **Уточнение:** ...
- **Источник:** [ссылка]

## Устаревшая информация

### O-001: [Название]

- **Раздел:** X.X
- **Что устарело:** ...
- **Актуальная информация:** ...
- **Источник:** [ссылка]

## Пропущенные возможности

### M-001: [Название фичи]

- **Описание:** ...
- **Применимость для fancai:** [высокая/средняя/низкая]
- **Источник:** [ссылка]
- **Рекомендация:** ...

## Оценка рекомендаций

### R-001: [Рекомендация из отчёта]

- **Оценка:** [подтверждена / частично верна / под вопросом / опровергнута]
- **Обоснование:** ...
- **Источник:** [ссылка]

## Пересчитанные стоимости (если найдены ошибки в расчётах)

[Таблицы с правильными расчётами]

## Итоговые рекомендации аудитора

1. ...
2. ...
```

### Критерии качества

- **Каждая** находка ОБЯЗАНА содержать ссылку на первоисточник (URL документации)
- **НЕ выдумывай** — если не можешь подтвердить, напиши "не удалось подтвердить, требует ручной проверки"
- Проверь **ВСЕ числа** в расчётах стоимости (раздел 10) — пересчитай каждый сценарий
- Аудит должен быть **конструктивным** — не только критика, но и рекомендации по исправлению
- Если информация верна — подтверди это явно (чтобы было понятно, что проверялось)

### Где сохранить

Результат аудита сохрани в файл: `docs/research/gemini-api-integration-audit.md`

## Дополнительные URL для проверки

Обязательно открой и сверь данные с:

- https://ai.google.dev/pricing — ВСЕ цены
- https://ai.google.dev/gemini-api/docs/models — ВСЕ модели
- https://ai.google.dev/gemini-api/docs/deprecations — даты выключения
- https://ai.google.dev/gemini-api/docs/caching — кэширование
- https://ai.google.dev/gemini-api/docs/batch — batch API
- https://ai.google.dev/gemini-api/docs/thinking — thinking control
- https://ai.google.dev/gemini-api/docs/structured-output — structured output
- https://ai.google.dev/gemini-api/docs/image-generation — image gen
- https://ai.google.dev/gemini-api/docs/safety-settings — safety
- https://ai.google.dev/gemini-api/docs/rate-limits — rate limits
- https://ai.google.dev/gemini-api/docs/tokens — token counting
- https://ai.google.dev/gemini-api/docs/files — file API
- https://ai.google.dev/gemini-api/docs/grounding — grounding
- https://ai.google.dev/gemini-api/docs/gemini-3 — Gemini 3 guide
- https://ai.google.dev/api/caching — caching API reference
- https://ai.google.dev/api/generate-content — generate content API reference
- https://openrouter.ai/google/gemini-3-flash-preview — OpenRouter цены
- https://openrouter.ai/google/gemini-3.1-flash-lite-preview — OpenRouter цены
- https://openrouter.ai/google/gemini-3.1-flash-image-preview — NB2 цены
- https://pypi.org/project/google-genai/ — последняя версия SDK
- https://github.com/googleapis/python-genai/releases — changelog SDK
