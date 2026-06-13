# Исследование: Прямая интеграция Gemini API для AI-пайплайна fancai

## Контекст проекта

**fancai** — веб-читалка художественной литературы с AI-функциональностью. Стек: React 19 + TypeScript + Vite | FastAPI + Python 3.12 + PostgreSQL 17 + Redis 7.4 + Celery. Production: https://fancai.ru

### AI-функциональность (5 задач)

1. **Extraction** (основная, самая дорогая) — извлечение визуальных описаний (location, character, atmosphere, object) и entity-графа (персонажи, локации, связи, события) из русского текста глав книг. TSA mode: модель возвращает оригинальный текст с XML-тегами `<desc type="TYPE" occurrence="N">текст</desc>` + JSON с entities и relationships.

2. **Entity deduplication** — LLM-merge дубликатов entities (fuzzy + semantic). "Геральт" = "Белый Волк" = "Ведьмак". Structured output через Pydantic JSON Schema.

3. **Entity synthesis** — генерация milestones, biography, visual_summary_clean для каждой entity. Spoiler-free по главам. JSON mode.

4. **Translation** — перевод описаний RU→EN для image prompts. Простой text-in/text-out. Самая лёгкая задача.

5. **Image generation** — генерация иллюстраций по EN-описаниям. Сейчас FLUX.2 Klein через OpenRouter ($0.016/image). Нужно исследовать Nano Banana как альтернативу.

### Текущая конфигурация (OpenRouter, март 2026)

```python
# backend/app/core/openrouter_client.py
FALLBACK_MODELS = [
    "google/gemini-2.5-flash",        # primary — $0.30/$2.50 per 1M tokens
    "google/gemini-2.5-flash-lite",   # fallback — $0.10/$0.40 per 1M tokens
]
DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"  # $0.016/image

# backend/app/services/gemini_extractor.py
model_extraction = "google/gemini-2.5-flash"       # extraction + entities (TSA)
model_translation = "google/gemini-2.5-flash-lite"  # RU→EN translation
model_reduce = "google/gemini-2.5-flash-lite"       # dedup + synthesis
```

### Проблемы с OpenRouter (почему уходим)

1. **Нет context caching** для Gemini 3.1 Flash Lite (только для 2.5 моделей, implicit)
2. **Нет Batch API** — 50% скидка доступна только через прямой Google API
3. **Нет Free tier** — Google API даёт бесплатное использование Flash моделей (rate limited)
4. **5.5% наценка** OpenRouter сверху
5. **Ограниченный контроль thinking** — OpenRouter маппит `reasoning.effort` → `thinkingLevel`, но без точного контроля `thinking_budget`
6. **$defs/$ref баг** — Google модели через OpenRouter не поддерживают вложенные JSON Schema, нужен хак `_inline_defs()` для разворачивания ссылок
7. **`response.parsed` недоступен** — прямой SDK даёт Pydantic-объект напрямую, OpenRouter — только raw JSON

### Результаты A/B тестов (март 2026)

| Модель                          | Desc/chapter         | Output tok/ch        | Стоимость книги (50 ch) | Скорость    |
| ------------------------------- | -------------------- | -------------------- | ----------------------- | ----------- |
| **Gemini 3.0 Flash** (baseline) | 7.6 avg              | ~3555                | $0.48                   | ~25 сек/ch  |
| Gemini 3.1 Flash Lite           | **0.1** (broken!)    | ~3354                | $0.16                   | ~17 сек/ch  |
| Qwen3.5 397B A17B               | **7-16** (excellent) | **~20K** (thinking!) | **$3.88**               | ~465 сек/ch |
| **Gemini 2.5 Flash** (текущая)  | TBD                  | TBD                  | ~$0.25 est              | TBD         |

### Промпты и схемы (для оценки caching)

**Промпты (фиксированная часть, одинаковая для всех глав):**

| Промпт                    | Токены | Задача                                    |
| ------------------------- | ------ | ----------------------------------------- |
| TSA_EXTRACTION_PROMPT     | ~737   | XML-разметка описаний + entities + events |
| EXTRACTION_PROMPT         | ~587   | Legacy JSON extraction                    |
| SYNTHESIS_PROMPT_TEMPLATE | ~571   | Entity milestones                         |
| DEDUPLICATION_PROMPT      | ~263   | Merge дубликатов                          |
| TRANSLATION_SYSTEM_PROMPT | ~117   | RU→EN перевод                             |

**Pydantic схемы structured output:**

```python
class GeminiTSAResponseSchema(BaseModel):        # TSA mode (default)
    tagged_text: str      # Полный текст с <desc> XML-тегами
    entities: List[GeminiEntitySchema]             # 8 полей каждая
    relationships: List[GeminiRelationshipSchema]  # source, target, type, weight, context

class GeminiResponseSchema(BaseModel):            # Legacy JSON mode
    descriptions: List[GeminiDescriptionSchema]    # content, type, confidence, text_offset
    entities: List[GeminiEntitySchema]
    relationships: List[GeminiRelationshipSchema]

class DeduplicationResponse(BaseModel):
    merge_groups: List[MergeGroup]                 # master_id, duplicate_ids, confidence, reason
    no_duplicates_found: bool

# Synthesis: raw JSON mode (не structured output), парсится вручную
```

**Чанкинг:**

- `max_chunk_chars` = 100,000 (100K символов)
- `chunk_overlap_percent` = 15%
- Семафор конкурентности: `asyncio.Semaphore(3)` — 3 параллельных вызова

**Image generation pipeline (4 этапа):**

1. Cache check (Redis, TTL=7 дней)
2. Prompt engineering: RU→EN перевод + genre/type шаблоны, max 1800 chars
3. Generation: FLUX.2 Klein, aspect_ratio=4:3, size=1K
4. Post-processing: base64 → файл → `/app/storage/generated_images/`

### Объём использования

- 5-20 книг/месяц, 20-50 глав/книга
- ~200 LLM вызовов/книга (extraction + dedup + synthesis + translation)
- ~100 image generations/книга
- Текущий расход: ~$3-5/месяц (LLM + images)
- Budget: $5-10/месяц
- Русский текст 90%+ контент, промпты на русском

### SDK

**Установлен:** `google-genai==1.69.0` (28 марта 2026, последняя версия)

- Поддерживает: structured output с Pydantic, context caching, thinking control, batch API
- Async: `client.aio.models.generate_content()`
- Pydantic: `response.parsed` — объект напрямую

## Задачи исследования

### 1. Полный аудит Gemini API возможностей (ГЛУБОКО)

Изучить ВСЮ документацию https://ai.google.dev/gemini-api/docs/ и извлечь возможности, релевантные для fancai:

#### 1.1 Модели (актуальные на 30 марта 2026)

- Все доступные модели: Gemini 3.x, 2.5, Flash, Flash Lite, Pro
- Цены Premium tier (input/output/cached per 1M tokens)
- Цены Free tier (rate limits, квоты)
- Context window каждой модели
- Max output tokens
- Поддержка structured output (JSON Schema, response_schema)
- Поддержка thinking (thinking_level, thinking_budget)
- Рекомендуемые use cases от Google для каждой модели

#### 1.2 Context Caching (КРИТИЧНО для нас)

- **Explicit caching**: как создать, TTL, стоимость хранения, стоимость чтения
- **Implicit caching**: как работает, какие модели, гарантии скидки
- **Минимальный размер кэша** для каждой модели (1024 vs 4096 tokens)
- Наш TSA промпт ~737 токенов — **ниже минимума 1024!** Как решить? Можно ли добавить system_instruction?
- Кэширование system_instruction отдельно от содержимого
- Можно ли кэшировать промпт + few-shot примеры (расширить до 1024+)?
- Стоимость: cached input vs uncached input vs storage per hour
- Формулы расчёта: сколько запросов нужно чтобы caching окупился?

#### 1.3 Batch API

- Как работает batch processing
- 50% скидка — на что именно? (input + output? или только input?)
- Latency: до 24 часов — приемлемо для книг?
- Лимиты batch (макс. запросов, макс. размер)
- Можно ли комбинировать с caching?
- Python SDK: как вызвать batch через google-genai?

#### 1.4 Thinking / Reasoning Control

- `thinking_level` для Gemini 3.x: MINIMAL, LOW, MEDIUM, HIGH
- `thinking_budget` для Gemini 2.5: конкретное число токенов, 0 = OFF
- Как thinking tokens влияют на стоимость (они = output tokens!)
- Для каких моделей можно полностью отключить thinking?
- Рекомендации: для extraction нужен thinking или нет?
- `include_thoughts=True` — можно ли получить reasoning модели для отладки?

#### 1.5 Structured Output

- `response_mime_type='application/json'` + `response_schema`
- Pydantic модели напрямую vs JSON Schema dict
- `response.parsed` — как получить типизированный объект
- Поддерживают ли все модели (Flash, Flash Lite, Pro)?
- Enum output restriction (`text/x.enum`)
- Ограничения вложенных схем (наша `GeminiEntitySchema` имеет `List[str]`, `Optional[int]`)

#### 1.6 System Instructions

- Как работают system instructions в google-genai
- Кэшируются ли они отдельно?
- Можно ли использовать для фиксированной части промпта (экономия на caching)?

#### 1.7 Rate Limits и Quotas

- Free tier: RPM, TPM, RPD для каждой модели
- Premium tier: RPM, TPM, RPD
- Как масштабируется при batch processing?
- Как избежать rate limiting при 50 параллельных главах?

#### 1.8 Safety Settings

- Настройки безопасности для художественных текстов
- Могут ли safety filters блокировать extraction из тёмного фэнтези/хоррора?
- Как настроить для минимальных ложных срабатываний?

#### 1.9 Другие возможности

- Grounding with Google Search
- Code execution tool
- File API (загрузка больших текстов)
- Token counting API (точный подсчёт до вызова)
- Model info API

### 2. Nano Banana — исследование генерации изображений (ГЛУБОКО)

**Nano Banana** — модель генерации изображений Google (Imagen 3 / Gemini Image Generation).

#### 2.1 Общая информация

- Полное название и версия (Nano Banana 2? Imagen 3?)
- Доступность через Gemini API (ai.google.dev)
- Доступность через Vertex AI
- Текущий статус: preview, GA?

#### 2.2 Стоимость

- Цена за изображение (Premium tier)
- Цена за изображение (Free tier) — есть ли?
- Сравнение с FLUX.2 Klein ($0.016/image через OpenRouter)
- Batch pricing для images

#### 2.3 Возможности

- Разрешения: какие доступны?
- Aspect ratios: 4:3, 16:9, 1:1, custom?
- Стиль: фотореализм, иллюстрация, painterly?
- Количество изображений за запрос
- Seed для воспроизводимости
- Negative prompts
- Inpainting / outpainting
- Image editing capabilities

#### 2.4 Качество vs FLUX.2 Klein

- Benchmarks / сравнения качества
- Стиль: что лучше для книжных иллюстраций?
- Работа с русскими описаниями (или нужен перевод EN?)
- Скорость генерации
- Safety filters: блокирует ли artistic/fantasy content?

#### 2.5 Интеграция

- Python SDK: как вызвать через google-genai?
- Формат ответа (base64, URL, bytes?)
- Максимальная длина промпта
- Поддержка в Gemini API (не только Vertex AI?)
- Rate limits для image generation

#### 2.6 Сравнительная таблица

| Параметр               | FLUX.2 Klein (текущий) | Nano Banana |
| ---------------------- | ---------------------- | ----------- |
| Цена/image             | $0.016                 | ?           |
| Разрешение             | 1K                     | ?           |
| Aspect ratios          | 4:3, 1:1, 16:9         | ?           |
| Скорость               | ~3 сек                 | ?           |
| Качество (иллюстрации) | Хорошее                | ?           |
| Стиль                  | Artistic               | ?           |
| Safety filters         | Мягкие                 | ?           |
| API доступ             | OpenRouter             | Gemini API? |
| Batch                  | Нет                    | ?           |
| Free tier              | Нет                    | ?           |

### 3. Tiered Model Strategy для Premium

Для каждой из 5 AI-задач определить оптимальную модель:

| Задача              | Требования                                    | Рекомендуемая модель | Thinking level |
| ------------------- | --------------------------------------------- | -------------------- | -------------- |
| Extraction (TSA)    | Сложная, качество критично, structured output | ?                    | ?              |
| Translation (RU→EN) | Простая, скорость важна                       | ?                    | ?              |
| Deduplication       | Средняя, structured output                    | ?                    | ?              |
| Synthesis           | Средняя, длинный output, JSON                 | ?                    | ?              |
| Image generation    | Качество иллюстраций                          | ?                    | N/A            |

### 4. Расчёт стоимости для Premium

Рассчитать стоимость обработки одной книги (50 глав, ~200 LLM вызовов, ~100 images) для:

1. Текущая конфигурация (OpenRouter, Gemini 2.5 Flash)
2. Direct Gemini API без оптимизаций
3. Direct Gemini API + context caching
4. Direct Gemini API + batch API
5. Direct Gemini API + caching + batch
6. Direct Gemini API + Free tier (rate limited)

С детализацией по задачам (extraction, translation, dedup, synthesis, images).

### 5. План миграции

Конкретные шаги перехода с OpenRouter на Direct Gemini API:

- Какие файлы создать/изменить
- Как сохранить fallback на OpenRouter (для image generation через FLUX.2)
- Нужно ли менять Pydantic схемы?
- Как мигрировать circuit breaker и retry логику?
- Переменные окружения (GOOGLE_API_KEY вместо/вместе с OPENROUTER_API_KEY)

## Требования к результату

1. **Таблица моделей** с полными ценами (Premium и Free) всех актуальных Gemini моделей
2. **Анализ context caching** с расчётами для наших промптов
3. **Анализ Batch API** с оценкой применимости
4. **Полное исследование Nano Banana** со сравнением с FLUX.2 Klein
5. **Tiered strategy** — какую модель для какой задачи
6. **Расчёт стоимости** для 6 сценариев
7. **План миграции** с конкретными файлами и изменениями

## Ограничения

- Python 3.12, FastAPI, Celery workers
- `google-genai==1.69.0` уже установлен
- Текущий OPENROUTER_API_KEY должен остаться (для FLUX.2 Klein fallback)
- Русский текст 90%+, промпты на русском
- Structured output обязателен (Pydantic JSON Schema)
- Context window минимум 32K tokens
- Budget: ~$5-10/месяц на AI

## Формат отчёта

Markdown файл в `/docs/research/`, на русском языке. Структура:

1. Executive Summary с ключевыми рекомендациями
2. Полная таблица моделей Gemini API (Premium + Free)
3. Context Caching — детальный анализ для fancai
4. Batch API — анализ применимости
5. Thinking Control — рекомендации по задачам
6. Structured Output — особенности Direct API vs OpenRouter
7. Nano Banana — полное исследование + сравнение с FLUX.2 Klein
8. Tiered Strategy для Premium
9. Расчёт стоимости (6 сценариев)
10. Tiered Strategy для Free (краткий outline, детализация потом)
11. План миграции
12. Источники (все ссылки на документацию)
