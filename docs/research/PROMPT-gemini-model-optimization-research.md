# Исследование: Оптимизация LLM-модели для AI-пайплайна fancai

## Контекст проекта

**fancai** — читалка художественной литературы с AI-функциональностью:

1. **Extraction** (основная) — извлечение визуальных описаний (location, character, atmosphere, object) и entity-графа (персонажи, локации, связи, события) из русского текста глав книг
2. **Entity deduplication** — LLM-merge дубликатов entities
3. **Entity synthesis** — генерация visual_summary для entities
4. **Translation** — перевод описаний RU→EN для image prompts
5. **Image generation** — FLUX.2 Klein через OpenRouter (отдельная модель, не исследуем)

Все LLM-вызовы через **OpenRouter API** (`/chat/completions`). Structured output через JSON Schema. Текст на **русском языке** (90%+ контент).

## Текущая конфигурация

```python
# backend/app/core/openrouter_client.py
FALLBACK_MODELS = [
    "google/gemini-3.1-flash-lite-preview",  # primary
    "google/gemini-2.5-flash-lite",           # fallback
]

# backend/app/services/gemini_extractor.py
model_extraction = "gemini-3.1-flash-lite-preview"  # extraction + entities
model_translation = "gemini-2.0-flash-lite"          # RU→EN translation
model_reduce = "gemini-3.1-flash-lite-preview"       # dedup + synthesis
```

## Проблема

Gemini 3.1 Flash Lite показала **катастрофическое падение качества extraction** при переходе с Gemini 3.0 Flash:

### A/B данные из production (одинаковые книги, одинаковый промпт):

| Книга                            | Главы | Gemini 3.0 Flash                     | Gemini 3.1 Flash Lite                 | Деградация   |
| -------------------------------- | ----- | ------------------------------------ | ------------------------------------- | ------------ |
| **Перекрестки сумерек**          | 50    | 381 desc, 198 entities (7.6 desc/ch) | **5 desc, 14 entities (0.1 desc/ch)** | **76x**      |
| **Ведьмак. Перекрестоk воронов** | 23    | 100 desc, 216 entities (4.3 desc/ch) | 58 desc, 47 entities (2.5 desc/ch)    | **1.7-4.6x** |
| **Ведьмак** (ранний тест)        | 23    | 138 desc, 76 entities (6.0 desc/ch)  | —                                     | baseline     |

### Per-chapter breakdown (Перекрестки сумерек, 50 глав):

- Gemini 3.0 Flash: **все 50 глав** дали 1-16 описаний каждая
- Gemini 3.1 Flash Lite: **только 3 из 50 глав** дали описания (главы 1-3), остальные 47 глав — **0 описаний**

### Стоимость (OpenRouter, за обработку одной книги 23 главы):

- Gemini 3.1 Flash Lite: **$0.16** (166K input, 79K output, $0.25/$1.50 per 1M)
- Gemini 3.0 Flash: **~$0.48** ($1.00/$4.00 per 1M)
- Gemini 3.1 Flash Lite в **3x дешевле**, но бесполезна при 76x деградации quality

### Скорость:

- Gemini 3.1 Flash Lite: **6 мин 27 сек** на 23 главы (47s avg/ch, semaphore=10)
- Gemini 3.0 Flash: ~15-20 мин на 23 главы
- Modal self-hosted Qwen3.5-9B: **>40 мин** (отвергнут)

## Промпт (extraction, TSA mode)

Промпт ~2500 токенов, TSA (Text-Span Annotation) подход — модель размечает текст XML-тегами `<desc>`:

```
Ты - опытный литературный редактор, специализирующийся на подготовке книг к иллюстрированию.

## ЗАДАЧА
Разметь визуальные описания в тексте XML-тегами. Формат:
<desc type="TYPE" occurrence="N">точный текст из оригинала</desc>

## ТИПЫ (TYPE)
- location: места, интерьеры, пейзажи
- character: внешность персонажей
- atmosphere: освещение, погода, настроение
- object: важные артефакты

## КРИТЕРИИ КАЧЕСТВЕННОГО ОПИСАНИЯ
✓ Минимум 50 символов (идеально 100-300)
✓ Создаёт визуальный образ в воображении
✓ Содержит конкретные детали (цвета, формы, текстуры)
✓ Подходит для иллюстрации художником

[... негативные/позитивные примеры, правила, сущности, события ...]

Текст для анализа:
{text}
```

Также есть Legacy JSON mode — модель возвращает JSON с descriptions и entities. Оба варианта доступны.

## Данные OpenRouter из production (март 2026)

### Gemini 3.1 Flash Lite (32 запроса, 29 марта):

- Total: $0.2149 (215K input, 107K output)
- Avg output: 3354 tokens/request
- 100% success rate (ни одного fallback)

### Gemini 3.0 Flash (202 запроса, 1-28 марта):

- Total: $2.5281 (789K input, 718K output)
- Avg output: 3555 tokens/request
- 100% success rate

### Image generation (FLUX.2 Klein):

- 119 запросов, $1.9040 ($0.016/image)

## Задачи исследования

### 1. Диагностика проблемы Gemini 3.1 Flash Lite

- **Почему 47/50 глав возвращают 0 описаний?** Модель парсит (is_description_parsed=true), но extraction пустой. Это ограничение модели по instruction following? Или проблема с длиной промпта/контекста?
- **Различается ли поведение TSA (XML) vs Legacy (JSON)?** Возможно XML-теги сложнее для Lite модели.
- **Есть ли threshold по размеру текста?** Первые 3 главы (короткие?) дали результаты, длинные — нет.

### 2. Исследование альтернативных моделей на OpenRouter

Для каждой модели определить:

- Цена (input/output per 1M tokens)
- Поддержка structured output / JSON Schema на OpenRouter
- Качество работы с русским текстом
- Context window (нужно минимум 32K для длинных глав)
- Доступность free tier на OpenRouter

Приоритетные модели для исследования (март 2026):

- **Gemini 2.5 Flash** ($0.15/$0.60) — значительно дешевле 3.0 Flash
- **Gemini 2.5 Flash Lite** — ещё дешевле?
- **Gemini 3.0 Flash** (baseline, $1.00/$4.00)
- **Gemini 3.1 Flash** (не Lite) — если существует
- **DeepSeek V3/R1** — бесплатные/дешёвые модели
- **Qwen 3.x** — через OpenRouter
- **Llama 4** — если доступна
- **Mistral** модели
- **Бесплатные модели OpenRouter** — какие есть с хорошим русским?

### 3. Возможность тюнинга/оптимизации Gemini 3.1 Flash Lite

- **Fine-tuning через Google AI Studio** — доступен ли для Flash Lite? Какие данные нужны?
- **Few-shot optimization** — можно ли улучшить extraction добавив больше примеров в промпт?
- **Prompt engineering** — упрощение промпта для Lite модели (меньше инструкций, больше примеров)
- **Двухэтапный подход** — Lite для быстрой фильтрации + полная модель для extraction

### 4. Оптимизация промпта под дешёвые модели

- Сокращение промпта (2500→1000 tokens) при сохранении качества
- Разделение на подзадачи (descriptions отдельно, entities отдельно)
- Chain-of-thought vs direct extraction
- Влияние языка промпта (RU vs EN prompt для русского текста)

### 5. Tiered model strategy

Разные модели для разных задач:

- **Extraction** (сложная, качество критично): модель X
- **Translation** (простая, RU→EN): модель Y (дешёвая)
- **Deduplication** (средняя): модель Z
- **Synthesis** (средняя): модель Z

Оптимальная комбинация цена/качество?

### 6. Данные для fine-tuning

На сервере есть обработанные данные (Gemini 3.0 Flash):

- 381 описание + 198 entities (Перекрестки сумерек, 50 глав)
- 138 описаний + 76 entities (Ведьмак, 23 главы)
- Исходные тексты глав + extraction результаты = training pairs

Можно ли использовать эти данные для:

- Fine-tuning Gemini Flash Lite через Google AI Studio?
- Создания training dataset для других моделей?
- Дистилляции из Gemini 3.0 Flash → меньшую модель?

## Требования к результату

1. **Рекомендация primary модели** с обоснованием (цена, качество, скорость)
2. **Рекомендация fallback модели**
3. **Tiered strategy** для разных AI-задач
4. **Конкретные шаги оптимизации** промпта если рекомендуемая модель не Gemini 3.0 Flash
5. **Оценка ROI fine-tuning** — стоит ли инвестировать время

## Ограничения

- OpenRouter API — единая точка входа для всех LLM (не прямой Google API)
- Budget: ~$5-10/месяц на LLM (текущий расход ~$3/месяц)
- Объём: ~5-20 книг/месяц, 20-50 глав/книга
- Русский текст 90%+, промпты на русском
- Structured output обязателен (JSON Schema или XML TSA)
- Context window минимум 32K tokens

## Формат отчёта

Markdown файл в `/docs/research/`, на русском языке. Структура:

1. Executive Summary с рекомендацией
2. Детальное сравнение моделей (таблица)
3. Анализ проблемы Gemini 3.1 Flash Lite
4. Prompt optimization рекомендации
5. Fine-tuning feasibility
6. Tiered strategy
7. План миграции (конкретные изменения в коде)
8. Источники
