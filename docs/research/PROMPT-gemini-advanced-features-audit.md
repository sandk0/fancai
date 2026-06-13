# Глубокий аудит отчёта: Продвинутые возможности Gemini API для fancai

## Контекст

Ты проводишь **критический аудит** исследовательского отчёта по продвинутым возможностям Gemini API для проекта fancai (fiction reader с AI-иллюстрациями и интерактивной энциклопедией персонажей). Отчёт покрывает 5 фич: File Search, PDF Document Processing, Multimodal Embeddings, Thought Signatures, Interactions API.

**Отчёт для аудита:** `docs/research/gemini-api-advanced-features-research.md`
**Дата отчёта:** 2026-03-31
**Дата аудита:** 30 марта 2026

Отчёт содержит 5 разделов с техническими спецификациями, примерами кода, расчётами стоимости, конкретными сценариями интеграции и рекомендациями приоритетов.

**О проекте fancai:**

- Fiction reader с AI-иллюстрациями и интерактивной энциклопедией
- Обрабатывает русские книги (EPUB/FB2): extraction описаний + entity knowledge graph
- Текущий AI-пайплайн: ebooklib парсит EPUB → чанки по 100K символов с 15% overlap → Gemini извлекает structured data (entities, descriptions)
- Проблема: entity loss at chunk boundaries
- Стек: FastAPI + Celery + PostgreSQL + Redis + google-genai SDK
- Image generation: FLUX.2 Klein через OpenRouter, миграция на Nano Banana 2

## Твоя задача

Провести **глубокий, широкий и критический аудит** каждого раздела отчёта. Для каждого тезиса, числа, рекомендации — проверить актуальность и точность через веб-исследование текущей документации Gemini API (на 30 марта 2026).

## Методология аудита

### Фаза 1: Верификация фактов — File Search (Раздел 1)

Для **каждого** утверждения в разделе 1:

**Спецификации:**

- Поддерживаемые форматы — полный ли список? Не пропущены ли важные?
- Max размер файла 100 MB — верно?
- Хранение по tier (1 GB / 10 GB / 100 GB / 1 TB) — точные ли лимиты?
- TTL "бессрочно" — действительно? Нет ли ограничений?
- Стоимость индексации $0.15/1M tokens — верно? Это embedding cost или что-то другое?
- Стоимость хранения "бесплатно" — точно? Нет ли скрытых cost?
- Chunking control через `max_tokens_per_chunk`, `max_overlap_tokens` — точные ли параметры?
- Structured output работает с File Search на Gemini 3 — подтверждено ли? С какими оговорками?
- "Нельзя комбинировать с другими tools" — точно ли? Обновилось ли это?
- Рекомендация store < 20 GB — из документации?

**Код:**

- `client.file_search_stores.create()` — корректный ли API? Точные ли method names?
- `upload_to_file_search_store()` — точный ли метод? Параметры?
- Пример generate_content с File Search — корректная ли конфигурация?

**Баг с ThinkingConfig:**

- Открой форум-тред и проверь: актуален ли баг? Есть ли fix? Подтвердил ли Google?
- Thinking `medium` работает, `low` и `high` нет — точно ли?

**Расчёт стоимости Сценария A:**

- 500K слов ≈ 700K tokens — верна ли оценка?
- $0.15 × 0.7 = $0.105 — математика верна?
- 50 queries × 5K retrieved tokens = 250K × $0.50/1M = $0.125 — верен ли расчёт?
- Итого $0.23/книга — складывается?

### Фаза 2: Верификация фактов — PDF Document Processing (Раздел 2)

**Спецификации:**

- Max 1000 страниц, 50 MB — верно?
- 258 tokens per page (фиксировано, IMAGE modality) — точно 258? Для всех моделей?
- Embedded text Gemini 3 "извлекается бесплатно" — подтверждено ли в документации?
- media_resolution per-document — поддерживается ли для PDF?
- До 1000 страниц суммарно в одном запросе — верно?

**Расчёт стоимости:**

- 500 стр × 258 tok = 129K tokens — верно?
- Если embedded text бесплатен, значит модель видит текст + images за 129K? Уточни, как именно считаются токены
- Output ~10K tokens для extraction всех entities — реалистична ли оценка для 500-страничной книги?
- Сравнение $0.095 vs $1.018 (chunk-based) — $0.095 учитывает thinking tokens? Output tokens?
- "Экономия -91%" — корректно ли посчитано?

**Гибридный подход (Сценарий C):**

- PDF whole-book для entity discovery → chunks для descriptions
- $0.08 + $0.50 = $0.58 — откуда $0.50 за chunk extraction с hints? Почему дешевле $1.02?
- Реалистично ли извлечь ВСЕ entity names из 500-страничного PDF одним вызовом?

**EPUB → PDF конверсия:**

- Calibre, Pandoc, WeasyPrint — сохраняет ли Calibre embedded text в PDF?
- Если Calibre создаёт image-based PDF, то embedded text extraction не сработает
- Pandoc output — PDF с embedded text? Или image-based?

**Критический вопрос:**

- Если Gemini обрабатывает PDF как images (vision), а не как текст, то для текстовых книг это МЕНЕЕ эффективно, чем прямая передача текста. 258 tok/page × 500 pages = 129K tokens, но ТЕКСТ книги (500K слов ≈ 700K tokens) содержит БОЛЬШЕ информации. Не теряется ли качество extraction при vision-обработке текста?

### Фаза 3: Верификация фактов — Multimodal Embeddings (Раздел 3)

**Модели и цены:**

- `gemini-embedding-001`: $0.15/1M tokens, batch $0.075 — верно?
- `gemini-embedding-2-preview`: $0.20/1M tokens — верно? Batch не доступен?
- Max input: 2048 (001) и 8192 (2-preview) — точно?

**Качество для русского:**

- MMTEB score 69.9 — это для embedding-001 или embedding-2?
- "+5.09 над вторым местом" — точная ли цифра?
- "Сильная generalization для славянских языков (подтверждено на македонском)" — из какого источника?
- Есть ли КОНКРЕТНЫЕ бенчмарки для русского языка (не только "славянские")?

**Task Types:**

- Список task types для embedding-001 — полный ли?
- "embedding-2-preview: task type через промпт-инструкцию, не через параметр" — точно?
- Как именно задаётся task через промпт для embedding-2?

**Код:**

- `client.models.embed_content()` — корректный ли API call?
- Возвращает ли `.embeddings` список embedding objects с `.values`?
- Можно ли embed массив текстов за один вызов (batch)?
- Максимальное количество текстов в одном batch embed call?

**Расчёт стоимости dedup:**

- 300 entities × 30 tokens = 9K tokens — реалистично?
- 9K × $0.15/1M = $0.00135 — математика верна?
- "$0.007 vs текущие $0.014 (экономия 50%)" — верен ли baseline $0.014?

**Семантика русских имён:**

- "Embedding ловит: Наташа Ростова ↔ графиня Ростова" — есть ли данные, подтверждающие это для русских literary names?
- "Александр ↔ Саша ↔ Шурик" — ловят ли embeddings эту связь? Или это cultural knowledge, а не semantic similarity?

**pgvector:**

- Поддерживает ли PostgreSQL 17 (наш стек) pgvector?
- `CREATE INDEX USING hnsw (embedding vector_cosine_ops)` — корректный ли синтаксис?

### Фаза 4: Верификация фактов — Thought Signatures (Раздел 4)

**Обязательность:**

- "Function calling (current turn) — ОБЯЗАТЕЛЬНО для Gemini 3, 400 ошибка" — подтверждено?
- "Single-turn generate_content — Не нужно" — подтверждено?
- "Structured output (response_schema) — НЕ НУЖНО" — подтверждено ли ЯВНО в документации?
- "Text-only multi-turn — Рекомендовано, не обязательно" — точно?
- Thinking level `minimal` — всё равно нужны signatures для function calling?

**SDK автоматизация:**

- "append the full model response object directly to history" — это цитата из документации?
- Что происходит при chat.send_message() — SDK автоматически обрабатывает?

**Dummy signature:**

- `"context_engineering_is_the_way_to_go"` — это реальное значение из документации? Или шутка?
- Можно ли использовать произвольные strings как dummy signatures?

**Streaming edge case:**

- "Модель может вернуть thought signature в part с пустым text content" — подтверждено?

**Критический вопрос:**

- Если fancai перейдёт на Gemini 3 + response_schema (НЕ function calling), то thought signatures ДЕЙСТВИТЕЛЬНО не нужны? Проверь, нет ли edge cases.

### Фаза 5: Верификация фактов — Interactions API (Раздел 5)

**Спецификации:**

- Статус Beta — актуально?
- SDK >= 1.55.0 — минимальная ли это версия?
- `store=True` по умолчанию — подтверждено?
- Background только для agents — точно?
- Structured output через `response_format` — точный ли параметр? Или `response_mime_type` + `response_schema`?

**Код:**

- `client.interactions.create()` — корректный ли метод? Точные ли параметры?
- `previous_interaction_id` — точное ли имя поля?
- `interaction.outputs[-1].text` — корректный ли access pattern?
- Function calling через interactions — корректный ли формат `function_result` input?

**Кумулятивная стоимость (Сценарий A):**

- "К главе 50 контекст = 50 × 25K = 1.25M tokens" — действительно ли server-side state накапливает ВСЕ предыдущие turns? Или есть window?
- Выходит ли это за 1M context window?
- Стоимость последнего вызова $0.625 — верен ли расчёт?

**Сравнение с generate_content:**

- "Interactions API не подходит для batch processing" — точно? Нет ли batch-mode для interactions?
- "Sequential (stateful)" — нельзя ли параллельно создавать independent interactions?

**Критические вопросы:**

- Можно ли использовать Interactions API в stateless режиме как drop-in replacement для generate_content? Если да, какие преимущества?
- Есть ли TTL для stored interactions?
- Есть ли лимит на количество stored interactions?
- Удаление interactions — есть ли `client.interactions.delete()`?

### Фаза 6: Поиск пропущенных возможностей

Изучи ВСЮ документацию Gemini API и найди фичи, НЕ упомянутые в отчёте, но потенциально полезные для fancai:

1. **File Search: inline citations** — может ли File Search возвращать точные позиции в тексте? Это ценно для entity positioning.
2. **File Search: metadata filtering** — можно ли фильтровать по метаданным файлов (например, по номеру главы)?
3. **Embeddings: content filtering** — можно ли фильтровать по типу контента при search?
4. **PDF: page-level extraction** — можно ли указать "извлеки только со страниц 50-100"?
5. **Interactions: delete / list / cancel** — полный ли API surface описан?
6. **Thought signatures: token cost** — считаются ли signatures в billable tokens?
7. **Embeddings: distance metrics** — только cosine? Или есть dot product, euclidean?
8. **File Search: webhooks / async indexing** — как узнать, когда индексация завершена?
9. **Embeddings + File Search** — можно ли использовать embedding-2 для File Search вместо embedding-001?
10. **Interactions + batch** — есть ли batch mode для interactions?
11. **PDF caching** — можно ли кэшировать загруженный PDF для повторных вызовов?
12. **Новые фичи, анонсированные в марте 2026**, пропущенные в отчёте

### Фаза 7: Оценка рекомендаций

Критически оцени рекомендации отчёта:

1. **"PDF-вход P1, -43% LLM cost"** — реалистична ли экономия? Не ухудшится ли качество extraction при vision-обработке текста? Embedded text бесплатен — но видит ли модель текст ДОСТАТОЧНО хорошо через page images?

2. **"Embeddings P1 для entity dedup"** — оправдана ли приоритетность? Текущий dedup стоит $0.014/книга — экономия $0.007 стоит ли усложнения pipeline? Или ценность в качестве (русские имена)?

3. **"File Search P2 для consistency check"** — не завышена ли стоимость $0.23? Можно ли дешевле? Есть ли альтернативы (например, PDF whole-book)?

4. **"Thought Signatures P3"** — действительно ли не блокируют миграцию? Нет ли edge case с response_schema на Gemini 3?

5. **"Interactions API P3"** — правильно ли отвергнуто для batch processing? Нет ли use case, где Interactions API существенно лучше generate_content?

6. **Пропущена ли приоритетность:** Не должен ли какой-то P2/P3 быть выше? Не пропущен ли killer use case?

## Требования к результату

### Формат отчёта аудита

```markdown
# Аудит: Gemini API Advanced Features Research

**Дата аудита:** 2026-03-31
**Аудитор:** Claude Opus 4.6

## Сводка аудита

| Раздел                  | Ошибок | Неточностей | Устарело | Пропущено |
| ----------------------- | ------ | ----------- | -------- | --------- |
| File Search             | ?      | ?           | ?        | ?         |
| PDF Document Processing | ?      | ?           | ?        | ?         |
| Multimodal Embeddings   | ?      | ?           | ?        | ?         |
| Thought Signatures      | ?      | ?           | ?        | ?         |
| Interactions API        | ?      | ?           | ?        | ?         |
| **Итого**               | **?**  | **?**       | **?**    | **?**     |

## Ошибки (требуют исправления)

### E-001: [Название ошибки]

- **Раздел отчёта:** X.X
- **Утверждение в отчёте:** "цитата"
- **Фактическое значение:** ...
- **Источник:** [ссылка на документацию]
- **Влияние:** [как ошибка влияет на выводы/расчёты]

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

- **Каждая** находка ОБЯЗАНА содержать ссылку на первоисточник (URL документации или форум-тред)
- **НЕ выдумывай** — если не можешь подтвердить, напиши "не удалось подтвердить, требует ручной проверки"
- Проверь **ВСЕ числа** в расчётах стоимости — пересчитай каждый сценарий
- Аудит должен быть **конструктивным** — не только критика, но и конкретные рекомендации по исправлению
- Если информация верна — **подтверди это явно** (чтобы было понятно, что проверялось)
- Обрати особое внимание на **примеры кода** — верны ли method names, параметры, типы?

### Где сохранить

Результат аудита сохрани в файл: `docs/research/gemini-advanced-features-audit.md`

## URL для обязательной проверки

Открой и сверь данные с:

### File Search

- https://ai.google.dev/gemini-api/docs/file-search — ПОЛНАЯ документация
- https://ai.google.dev/api/file-search — API reference (методы, параметры)
- https://discuss.ai.google.dev/t/file-search-structured-output-thinkingconfig-nil-response-and-no-grounding-metadata-on-gemini-3/127444 — баг-тред
- https://discuss.ai.google.dev/t/file-search-tool-in-combination-with-response-schema-not-working/111246 — баг-тред #2

### PDF / Document Processing

- https://ai.google.dev/gemini-api/docs/document-processing — документация
- https://ai.google.dev/gemini-api/docs/files — File API
- https://ai.google.dev/gemini-api/docs/tokens — как считаются токены для PDF

### Embeddings

- https://ai.google.dev/gemini-api/docs/embeddings — документация
- https://ai.google.dev/pricing — цены (секция Embeddings)
- https://arxiv.org/html/2503.07891v1 — Gemini Embedding paper (бенчмарки)
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/ — анонс

### Thought Signatures

- https://ai.google.dev/gemini-api/docs/thought-signatures — ПОЛНАЯ документация
- https://ai.google.dev/gemini-api/docs/gemini-3 — Gemini 3 guide
- https://ai.google.dev/gemini-api/docs/thinking — Thinking control

### Interactions API

- https://ai.google.dev/gemini-api/docs/interactions — ПОЛНАЯ документация
- https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api/ — анонс
- https://medium.com/google-cloud/gemini-interactions-api-one-interface-for-models-and-agents-986ffb16021c — разбор
- https://developers.googleblog.com/building-agents-with-the-adk-and-the-new-interactions-api/ — tutorial
- https://www.philschmid.de/interactions-api-quickstart — quickstart guide

### Общие

- https://ai.google.dev/pricing — ВСЕ цены (модели, embeddings, File Search, caching)
- https://ai.google.dev/gemini-api/docs/models — спецификации моделей
- https://ai.google.dev/gemini-api/docs/changelog — последние изменения API
- https://pypi.org/project/google-genai/ — SDK версия и changelog
- https://github.com/googleapis/python-genai — SDK source + issues
