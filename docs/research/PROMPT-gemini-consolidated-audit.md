# Глубокий аудит: Gemini API Сводный справочник для fancai

## Контекст

Ты проводишь **критический аудит** сводного справочника по Gemini API для проекта fancai (fiction reader с AI-иллюстрациями и интерактивной энциклопедией персонажей).

**Отчёт для аудита:** `docs/research/gemini-api-consolidated.md`
**Дата отчёта:** 2026-03-31
**Дата аудита:** 2026-03-31

Сводный отчёт был получен путём **консолидации 4 исследований и 2 аудитов**:

| Документ                                       | Тип                             |
| ---------------------------------------------- | ------------------------------- |
| `gemini-api-direct-integration-research.md`    | Исследование                    |
| `gemini-api-integration-audit.md`              | Аудит (8 ошибок, 7 неточностей) |
| `gemini-context-caching-batch-api-research.md` | Исследование                    |
| `gemini-api-advanced-features-research.md`     | Исследование                    |
| `gemini-advanced-features-audit.md`            | Аудит (2 ошибки, 6 неточностей) |
| `2026-03-30-llm-model-optimization.md`         | Исследование                    |

**Специфика данного аудита:** Ты аудируешь **уже дважды проверенный** документ. Предыдущие аудиты могли содержать собственные ошибки. Консолидация могла внести новые ошибки (неправильное объединение данных, потерянный контекст, неверные cross-references). Твоя задача — **верифицировать всё с нуля**, не доверяя ни исходным исследованиям, ни предыдущим аудитам.

**О проекте fancai:**

- Fiction reader с AI-иллюстрациями и интерактивной энциклопедией
- Обрабатывает русские книги (EPUB/FB2): extraction описаний + entity knowledge graph
- Текущий AI-пайплайн: ebooklib парсит EPUB → чанки по 100K символов с 15% overlap → Gemini извлекает structured data (entities, descriptions)
- Проблема: entity loss at chunk boundaries
- Стек: FastAPI + Celery + PostgreSQL 17 + Redis + google-genai SDK
- Image generation: FLUX.2 Klein через OpenRouter, миграция на Nano Banana 2
- Текущая модель extraction: Gemini 2.5 Flash через OpenRouter

## Твоя задача

Провести **глубокий, широкий и критический аудит** каждого из 18 разделов отчёта. Для каждого тезиса, числа, рекомендации — проверить актуальность и точность через веб-исследование текущей документации Gemini API (на 31 марта 2026).

**Особый фокус:**

1. **Перепроверка аудитных тегов `[АУДИТ ...]`** — предыдущие аудиты могли ошибаться. Каждая аудитная корректировка должна быть верифицирована заново.
2. **Ошибки консолидации** — данные из разных источников могли быть неправильно объединены. Проверять внутреннюю согласованность (одна и та же цена не должна различаться в разных разделах).
3. **Свежесть информации** — прошло 0-1 день между отчётами и аудитом. Но документация Gemini обновляется часто. Проверить, не появилось ли чего-то нового.

## Методология аудита

### Фаза 1: Модели и цены (Разделы 1, 14)

**Для каждой строки таблиц цен:**

- Все Model ID (gemini-3-flash-preview, gemini-3.1-pro-preview и др.) — существуют ли? Точны ли имена? Не deprecated ли?
- Input/Output/Batch/Cached цены — сверить КАЖДУЮ цену с текущей страницей pricing
- Context window и Max Output для каждой модели — точны ли?
- 3.1 Flash-Lite цена $0.25/$1.50 — это как input для 3 Flash ($0.50) делёное пополам. Верно ли это?
- NB2 цены по разрешениям (0.5K=$0.045, 1K=$0.067, 2K=$0.101) — точны ли?
- NB2 batch доступен? Отчёт ставит "—" для batch, но указывает $0.034 batch 1K. Противоречие?
- FLUX.2 Klein $0.014 — актуальная цена? Не менялась ли?
- Embedding-001 batch $0.075 — подтверждается?
- Embedding-2-preview batch $0.10 — подтверждается?

**Сводная таблица стоимости (Раздел 14):**

- Пересчитать **каждый** сценарий (1-6) с нуля по ценам из раздела 1
- Проверить внутреннюю согласованность: LLM-стоимость в сценарии 1 ($0.96) = расчёту из параметров раздела 10 (50 глав × ~200 вызовов)?
- Новый сценарий "PDF hybrid + batch" ($0.36 LLM) — **откуда взяты цифры?** Нет детального расчёта. Пересчитать.
- OpenRouter 5.5% комиссия — текущее значение? Не менялось?

**Deprecation даты:**

- 2.5 Pro и Flash: 17 июня 2026 — подтверждается?
- 2.5 Flash-Lite: 22 июля 2026 — подтверждается?
- Imagen 4: 24 июня 2026 — упоминается в отчёте, но нет в таблице

**Free tier и Pay-as-you-go:**

- RPM/TPM/RPD для каждой модели — точны?
- Tier 1/2/3 пороги — точны?
- Rate limits привязаны к проекту — подтверждается?

### Фаза 2: Качество моделей (Раздел 2)

- Arena ELO для всех моделей — проверить на https://arena.ai/leaderboard/text (данные обновляются ежедневно)
- Box Blog +9-13 п.п. — открыть оригинал и проверить точные цифры
- MMTEB 68.32 — сверить с paper (arxiv). Не обновлялся ли leaderboard?
- Gemini 3.1 Flash Lite "early response" баг — открыть форум и проверить: исправлен ли? Есть ли новые данные?

### Фаза 3: Thinking Control (Раздел 3)

- thinking_level значения (minimal, low, medium, high) — полный ли список? Не добавлен ли `none`?
- 3 Flash default = `high` — точно? Не поменялось ли?
- 3.1 Pro минимум `low` — точно? Документация подтверждает?
- 3.1 Flash-Lite default = `minimal` — точно?
- thinking_budget диапазоны (128-32768 для Pro, 0-24576 для Flash) — проверить в текущей документации
- temperature=1.0 рекомендация — цитата из документации или интерпретация?

### Фаза 4: Context Caching (Раздел 4)

**Это раздел с наибольшим количеством ошибок в предыдущих исследованиях. Проверять особенно тщательно.**

- Минимальные пороги: Flash=1,024, Pro=4,096 — сверить с ТЕКУЩЕЙ документацией. Не менялось ли? Точно ли деление Flash/Pro, а не по generation?
- 3.1 Flash-Lite минимум — в таблице не указан отдельно. Какой минимум: 1,024 (как Flash) или другой?
- Стоимость хранения: $1.00 для Flash-Lite, $4.50 для Flash/Pro — сверить с pricing page
- Скидка 90% для всех моделей — точно 90% для всех? Нет ли исключений?
- `cached_content` ограничение (нельзя передавать system_instruction, tools) — точно? Не обновилось ли?
- Implicit caching 90% скидка — точно 90%? Для всех моделей?
- Break-even ~4 запроса — пересчитать с текущими ценами

### Фаза 5: Batch API (Раздел 5)

- 50% скидка — универсальна для всех моделей? Или есть исключения?
- SLO 24 часа — точно? Не менялось?
- Max concurrent 100 — точно? Не менялось?
- Batch + Caching: "скидки НЕ складываются" — точная формулировка или интерпретация? Как именно биллятся cached tokens в batch?
- Batch для NB2 (images) — поддерживается ли? Отчёт указывает batch цену $0.034, но в таблице NB2 стоит "—" для batch

### Фаза 6: Structured Output (Раздел 6)

- `response.parsed` → Pydantic — корректный ли метод? Или `.parsed` не существует?
- `text/x.enum` — точный MIME type? Или это что-то другое?
- `anyOf` поддержка с ноября 2025 — точная дата? Не было ли регрессий?
- `default=` исправлен в v1.69.0 — Issue #699 действительно закрыт? В какой версии?
- Код примера: `types.SafetySetting(category=c, threshold="BLOCK_NONE")` — точный ли API? Корректны ли имена параметров?
- `client.aio.models.generate_content()` — корректный ли async API?

### Фаза 7: Image Generation (Раздел 7)

- NB2 Model ID `gemini-3.1-flash-image-preview` — точен ли? Не обновлялся?
- NB2 Elo 1280 на Arena.ai — текущее значение? Обновить
- Скорость 4-15 сек — из какого источника? Есть ли более свежие данные?
- Reference images "До 14 (10 objects + 4 characters)" — точно? Или лимит изменился?
- SynthID watermark — обязателен для всех? Можно ли отключить?
- 7 finish_reason типов — полный ли список? Не добавлены ли новые?

### Фаза 8: File Search (Раздел 8)

- Индексация $0.15/1M — через какую embedding модель? Можно ли выбрать другую?
- TTL "бессрочно" — точно? Нет ли скрытых ограничений?
- Metadata filtering AIP-160 — открыть документацию и проверить: точный ли синтаксис примера `chapter <= "10"`?
- File Search + function calling (с 18 марта) — открыть changelog и подтвердить дату и scope
- Баг ThinkingConfig — открыть форум и проверить текущий статус. Исправлен ли?
- Код `custom_metadata=[{"key": "chapter", "string_value": "1"}]` — точный ли формат?
- Код `metadata_filter='chapter <= "10"'` — точный ли синтаксис? Или это `metadata.chapter`?
- Стоимость $0.26/книга — пересчитать: индексация (сколько tokens для русской книги 500K слов?) + 50 queries × 5K tok

### Фаза 9: PDF Document Processing (Раздел 9)

- 258 tokens per page — для ВСЕХ разрешений? Или зависит от media_resolution?
- Embedded text бесплатно — подтвердить в ТЕКУЩЕЙ документации. Не изменилось ли?
- ULTRA_HIGH media_resolution — существует ли? Или только LOW/MEDIUM/HIGH?
- Context window concern: 129K image + text — но тарифицируются ли text tokens как input? Или ТОЛЬКО image tokens как input, а text = бесплатный бонус?
- Calibre searchable PDF — подтвердить что Gemini ДЕЙСТВИТЕЛЬНО извлекает text из Calibre-generated PDF
- File API: 50 MB для PDF, 2 GB для прочих — точно ли различие? Или 2 GB для ВСЕХ?

### Фаза 10: Multimodal Embeddings (Раздел 10)

- embedding-001: 8 task types — полный ли список?
- embedding-2-preview: "task через промпт-инструкцию" — точный формат? Точный пример?
- `client.models.embed_content()` — точный метод? Параметры `config={"task_type": ...}` — корректны?
- `.embeddings[].values` — точный access pattern?
- pgvector 0.8.x + PostgreSQL 17 — точная версия? Нет ли проблем совместимости с 17.0-17.2?
- Расчёт $0.007/книга для embedding dedup — пересчитать

### Фаза 11: Thought Signatures (Раздел 11)

- Image generation ОБЯЗАТЕЛЬНО — подтвердить в документации
- response_schema НЕ НУЖНО — подтвердить ЯВНО (не "не упомянуто", а "документация говорит не нужно")
- Два dummy значения — подтвердить оба
- Streaming edge case — упоминается ли в отчёте? Если нет — пропущен ли?

### Фаза 12: Interactions API (Раздел 12)

- Beta status — всё ещё Beta? Или уже GA?
- `response_format` — точное имя параметра для structured output?
- Breaking change декабря 2025 — единственный? Были ли другие?
- Remote MCP support — работает с Gemini 3? Или "coming soon"?
- Delete/list interactions — есть ли API? Отчёт не упоминает

### Фаза 13: Tiered Strategy и Migration (Разделы 13, 15)

- Fallback chain 3 Flash → 3.1 Flash-Lite → OR 2.5 Flash — учтено ли что 3.1 Flash-Lite НЕПРИГОДНА для extraction (раздел 2.4)?
- Budget вариант с 2.5 Flash — deprecated 17 июня 2026. Есть ли replacement?
- Migration план: google-genai>=1.69.0 — актуальна ли эта версия? Текущая?
- Spend Caps "с 1 апреля 2026" — подтвердить дату

### Фаза 14: Внутренняя согласованность

Проверить что одни и те же данные **не противоречат друг другу** в разных разделах:

1. Цена 3 Flash ($0.50/$3.00) — одинакова в разделах 1.1, 5.3, 8.4, 9.3, 14?
2. FLUX.2 цена ($0.014) — одинакова в разделах 1.4, 14?
3. Cache minimum (1,024 для Flash) — согласуется между разделами 4.1 и 4.6?
4. NB2 batch: раздел 1.4 показывает Batch 1K=$0.034, но в 7.1 batch не упоминается. Противоречие?
5. 3.1 Flash-Lite: раздел 2.4 говорит "НЕПРИГОДНА для extraction", но раздел 13.1 использует её как fallback для extraction. Противоречие?
6. Embedded text "бесплатно" (9.1) vs context window concern (9.2) — как бесплатные tokens занимают context window? Объяснение логично?

### Фаза 15: Поиск пропущенных возможностей

Изучи ВСЮ актуальную документацию Gemini API и найди фичи, НЕ упомянутые в отчёте:

1. **Live API / Real-time** — есть ли real-time streaming для extraction?
2. **URL Context tool** — полезно ли для fancai? (загрузка URL для extraction)
3. **Code Execution** — может ли Gemini написать и выполнить код для пост-обработки entities?
4. **Model distillation** (не fine-tuning) — появилось ли что-то новое?
5. **Provisioned Throughput** — есть ли программа для стабильных latency гарантий?
6. **Gemini 3.1 Flash-Lite** для File Search — поддерживается ли? Дешевле 3 Flash
7. **Embedding Batch API** — как именно работает? Inline или через файл?
8. **JSON mode vs JSON Schema** — разница? Оба поддерживаются?
9. **Audio input для аудиокниг** — какие лимиты? Стоимость? Качество для русского?
10. **Gemini 4.0** или новые модели — анонсированы ли?
11. **Native EPUB support** — появился ли? Или по-прежнему не поддерживается?
12. **Grounding with Google Search** — 5000 free/month. Полезно ли для fact-checking entities?
13. **Safety filter improvements** для fiction/literary content — есть ли?
14. **Multimodal output** — Gemini 3 Flash может генерировать text+image в одном ответе? Полезно для fancai?
15. **Переменные цены** по регионам — одинаковы ли цены для всех регионов?

### Фаза 16: Оценка рекомендаций

Критически оцени ВСЕ рекомендации отчёта:

1. **"Сценарий 4 оптимален"** — действительно ли +$0.47 (+20%) оправдан для Premium? При 10 книг/мес = +$4.70/мес за лучшее качество. Стоит ли?
2. **"PDF hybrid P1"** — context window concern (9.2) делает whole-book непрактичным для длинных книг. Должен ли приоритет снизиться до P2?
3. **"Embeddings P1"** — экономия $0.007/книга. При каком объёме окупится время разработки pgvector + integration? ROI analysis.
4. **"File Search P2"** — $0.26/книга за consistency check. vs PDF whole-book entity discovery $0.155. Не дублирует ли?
5. **"Context Caching P1 для PDF"** — конкретный расчёт: сколько экономит для 2-call PDF hybrid?
6. **"google-genai>=1.69.0"** — не слишком ли жёсткий pin? Какая актуальная стабильная версия?
7. **Migration plan** — реалистичны ли фазы? Не пропущены ли зависимости?
8. **Гибридный подход OpenRouter + Direct** — усложняет ли architecture? Два API client, два набора error handling, два billing account. Стоит ли?

## Требования к результату

### Формат отчёта аудита

```markdown
# Аудит: Gemini API Consolidated Reference

**Дата аудита:** 2026-03-31
**Аудитор:** Claude Opus 4.6
**Отчёт:** `docs/research/gemini-api-consolidated.md`
**Тип:** Мета-аудит (аудит консолидированного документа на основе 2 предыдущих аудитов)

## Сводка аудита

| Раздел                    | Ошибок | Неточностей | Устарело | Пропущено | Противоречий |
| ------------------------- | ------ | ----------- | -------- | --------- | ------------ |
| 1. Модели и цены          | ?      | ?           | ?        | ?         | ?            |
| 2. Качество моделей       | ?      | ?           | ?        | ?         | ?            |
| ... (все 18 разделов) ... |        |             |          |           |              |
| **Итого**                 | **?**  | **?**       | **?**    | **?**     | **?**        |

## Ошибки (требуют исправления)

### E-001: [Название]

- **Раздел отчёта:** X.X
- **Утверждение в отчёте:** "цитата"
- **Фактическое значение:** ...
- **Источник:** [ссылка]
- **Влияние:** [как ошибка влияет на выводы]
- **Аудитный тег:** [если корректировка предыдущего аудита — указать]

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

## Внутренние противоречия

### C-001: [Название]

- **Разделы:** X.X vs Y.Y
- **Противоречие:** ...
- **Рекомендация:** какой вариант верен

## Ошибки предыдущих аудитов

### PA-001: [Название]

- **Аудитный тег в отчёте:** [АУДИТ X-XXX]
- **Утверждение аудита:** "..."
- **Проблема:** ...
- **Фактическое значение:** ...
- **Источник:** [ссылка]

## Пропущенные возможности

### M-001: [Название фичи]

- **Описание:** ...
- **Применимость для fancai:** [высокая/средняя/низкая]
- **Источник:** [ссылка]

## Оценка рекомендаций

### R-001: [Рекомендация из отчёта]

- **Оценка:** [подтверждена / частично верна / под вопросом / опровергнута]
- **Обоснование:** ...

## Пересчитанные стоимости (если найдены ошибки)

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
- **Внутренние противоречия** — отдельная секция, критически важно для эталонного документа
- Проверка **аудитных тегов** — если предыдущий аудит ошибся, это наиболее ценная находка
- Обрати внимание на **примеры кода** — верны ли method names, параметры, типы? Запустится ли код?

### Где сохранить

Результат аудита сохрани в файл: `docs/research/gemini-consolidated-audit.md`

## URL для обязательной проверки

### Цены и модели (САМОЕ ВАЖНОЕ — цены меняются часто)

- https://ai.google.dev/pricing — ВСЕ цены (модели, embeddings, caching, File Search, images)
- https://ai.google.dev/gemini-api/docs/models — спецификации моделей, context windows, max output
- https://ai.google.dev/gemini-api/docs/deprecations — даты выключения

### Thinking

- https://ai.google.dev/gemini-api/docs/thinking — thinking levels, budgets, defaults
- https://ai.google.dev/gemini-api/docs/gemini-3 — Gemini 3 guide, temperature, media_resolution

### Caching и Batch

- https://ai.google.dev/gemini-api/docs/caching — минимумы, TTL, совместимость
- https://ai.google.dev/api/caching — API reference (что именно кэшируется)
- https://ai.google.dev/gemini-api/docs/batch — batch спецификация

### File Search

- https://ai.google.dev/gemini-api/docs/file-search — полная документация
- https://ai.google.dev/api/file-search — API reference (metadata, methods)
- https://discuss.ai.google.dev/t/file-search-structured-output-thinkingconfig-nil-response-and-no-grounding-metadata-on-gemini-3/127444 — баг ThinkingConfig

### PDF / Documents

- https://ai.google.dev/gemini-api/docs/document-processing — спецификация
- https://ai.google.dev/gemini-api/docs/files — File API, TTL
- https://ai.google.dev/gemini-api/docs/tokens — как считаются токены для PDF

### Embeddings

- https://ai.google.dev/gemini-api/docs/embeddings — модели, task types, API
- https://arxiv.org/html/2503.07891v1 — Gemini Embedding paper (MMTEB scores)

### Images

- https://ai.google.dev/gemini-api/docs/image-generation — NB2, reference images, safety
- https://ai.google.dev/gemini-api/docs/safety-settings — safety filters, finish_reason

### Thought Signatures

- https://ai.google.dev/gemini-api/docs/thought-signatures — когда обязательны, dummy values

### Interactions API

- https://ai.google.dev/gemini-api/docs/interactions — спецификация, stateful/stateless

### SDK

- https://pypi.org/project/google-genai/ — версия, changelog
- https://github.com/googleapis/python-genai/releases — релизы
- https://github.com/googleapis/python-genai/issues/699 — Pydantic defaults bug
- https://github.com/googleapis/python-genai/issues/2024 — IMAGE_SAFETY hang bug
- https://github.com/googleapis/python-genai/issues/1972 — LocalTokenizer 3 Flash

### Benchmarks (обновляются ежедневно)

- https://arena.ai/leaderboard/text — Arena ELO
- https://arena.ai/leaderboard/text-to-image — Image Arena
- https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction — Box extraction benchmark

### OpenRouter

- https://openrouter.ai/google/gemini-3-flash-preview — цены, features
- https://openrouter.ai/google/gemini-3.1-flash-image-preview — NB2 через OpenRouter
- https://openrouter.ai/black-forest-labs/flux.2-klein-4b — FLUX.2 цена
- https://openrouter.ai/pricing — комиссия OpenRouter

### Changelog

- https://ai.google.dev/gemini-api/docs/changelog — последние изменения API

### Rate Limits

- https://ai.google.dev/gemini-api/docs/rate-limits — free tier, pay-as-you-go tiers

### pgvector

- https://github.com/pgvector/pgvector — совместимость с PostgreSQL 17
