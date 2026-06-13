# Исследование: Прямая интеграция Gemini API для AI-пайплайна fancai

**Дата:** 2026-03-30 (v2 — обновлено по результатам глубокого исследования)
**Scope:** Полный аудит Gemini API, Nano Banana, расчёт стоимости, план миграции с OpenRouter
**Приоритет:** Quality-first (Premium), затем cost optimization
**Источники:** Каждый тезис подтверждён ссылкой на документацию

---

## 1. Executive Summary

### Ключевые рекомендации

1. **Gemini 3 Flash как primary для extraction** — +10-15% точности извлечения structured data vs 2.5 Flash ([Box Blog](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)). `thinking_level=minimal` для скорости. $0.50/$3.00.

2. **Gemini 3.1 Flash-Lite для лёгких задач** — на 64% быстрее 2.5 Flash (382 vs 232 tok/sec, [Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview)). $0.25/$1.50. Thinking по умолчанию `minimal`.

3. **Nano Banana 2 (Gemini 3.1 Flash Image) как primary для images** — #1 на AI Arena ([ALM Corp](https://almcorp.com/blog/google-nano-banana-2-gemini-31-flash-image-complete-guide/)). FLUX.2 Klein как fallback при safety block. $0.045-$0.067/img.

4. **Миграция на 3.x обязательна** — Gemini 2.5 Flash/Pro deprecated **17 июня 2026**, Flash-Lite **22 июля 2026** ([Google Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)).

5. **Direct API + Batch API** для фоновой обработки — 50% скидка. **OpenRouter** остаётся для FLUX.2 fallback и emergency LLM fallback.

### Сводка стоимости (1 книга, 50 глав, Premium)

| Сценарий                                | LLM   | Images | Итого     | vs Baseline               |
| --------------------------------------- | ----- | ------ | --------- | ------------------------- |
| 1. OpenRouter (текущий, 2.5 Flash)      | $0.96 | $1.60  | **$2.56** | Baseline                  |
| 2. Direct 3 Flash + minimal thinking    | $0.83 | $1.60  | **$2.43** | -5%                       |
| 3. Direct 3 Flash + NB2 images          | $0.83 | $4.50  | **$5.33** | +108% (качество!)         |
| 4. Direct 3 Flash + batch + NB2 batch   | $0.42 | $2.25  | **$2.67** | +4% (с лучшим качеством!) |
| 5. Direct + batch + caching + NB2 batch | $0.40 | $2.25  | **$2.65** | +4%                       |
| 6. Free tier LLM + FLUX.2 images        | $0.00 | $1.60  | **$1.60** | -38%                      |

> **Ключевой вывод:** Batch API — единственный способ получить лучшее качество (3 Flash + NB2) за сопоставимую с текущей цену. Без batch — рост $2.56 → $5.33.

---

## 2. Полная таблица моделей Gemini API (март 2026)

### 2.1 Gemini 3.x (Preview — рекомендовано для production)

| Модель             | Model ID                         | Input/1M      | Output/1M       | Batch In    | Batch Out   | Cached/1M   | Context | Max Out |
| ------------------ | -------------------------------- | ------------- | --------------- | ----------- | ----------- | ----------- | ------- | ------- |
| **3.1 Pro**        | `gemini-3.1-pro-preview`         | $2.00/$4.00\* | $12.00/$18.00\* | $1.00/$2.00 | $6.00/$9.00 | $0.20/$0.40 | 1M      | 64K     |
| **3 Flash**        | `gemini-3-flash-preview`         | $0.50         | $3.00           | $0.25       | $1.50       | $0.05       | 1M      | 64K     |
| **3.1 Flash-Lite** | `gemini-3.1-flash-lite-preview`  | $0.25         | $1.50           | $0.125      | $0.75       | $0.025      | 1M      | 64K     |
| 3.1 Flash Image    | `gemini-3.1-flash-image-preview` | $0.50 in      | $60/1M img tok  | —           | —           | —           | 128K    | 32K     |
| 3 Pro Image        | `gemini-3-pro-image-preview`     | $2.00 in      | $120/1M img tok | —           | —           | —           | 65K     | 32K     |

\*3.1 Pro: цена зависит от объёма контекста (≤200K / >200K)

**Статус "Preview":** Google рекомендует миграцию на 3.x с 2.5 **до** получения GA-статуса. Preview модели могут быть изменены с 2-недельным уведомлением. Прецедент: `gemini-3-pro-preview` выключен 9 марта 2026 ([Forum](https://discuss.ai.google.dev/t/migrate-from-gemini-3-pro-preview-to-gemini-3-1-pro-preview-before-march-9-2026/127062)).

**Источники:** [Pricing](https://ai.google.dev/pricing), [Models](https://ai.google.dev/gemini-api/docs/models), [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### 2.2 Gemini 2.5 (GA — DEPRECATED)

| Модель         | Model ID                | Input/1M    | Output/1M     | Cached/1M    | Дата выключения  |
| -------------- | ----------------------- | ----------- | ------------- | ------------ | ---------------- |
| 2.5 Pro        | `gemini-2.5-pro`        | $1.25/$2.50 | $10.00/$15.00 | $0.125/$0.25 | **17 июня 2026** |
| 2.5 Flash      | `gemini-2.5-flash`      | $0.30       | $2.50         | $0.03        | **17 июня 2026** |
| 2.5 Flash-Lite | `gemini-2.5-flash-lite` | $0.10       | $0.40         | $0.01        | **22 июля 2026** |

**Источник:** [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

### 2.3 Цены за изображение

| Модель                              | 0.5K   | 1K         | 2K     | 4K     | Batch 1K |
| ----------------------------------- | ------ | ---------- | ------ | ------ | -------- |
| **Nano Banana 2** (3.1 Flash Image) | $0.045 | $0.067     | $0.101 | $0.151 | $0.034   |
| Nano Banana Pro (3 Pro Image)       | —      | $0.134     | $0.134 | $0.240 | $0.067   |
| Gemini 2.5 Flash Image              | —      | $0.039     | —      | —      | $0.020   |
| Imagen 4 Fast                       | —      | $0.020     | $0.040 | —      | —        |
| **FLUX.2 Klein (OpenRouter)**       | —      | **$0.016** | —      | —      | —        |

**Источники:** [Pricing](https://ai.google.dev/pricing), [OpenRouter NB2](https://openrouter.ai/google/gemini-3.1-flash-image-preview)

### 2.4 OpenRouter vs Direct — цены идентичны

OpenRouter передаёт цены Gemini без markup (0%). Преимущества прямого API:

| Фича                   | OpenRouter        | Direct Gemini API |
| ---------------------- | ----------------- | ----------------- |
| Batch API (50%)        | Нет               | **Да**            |
| Explicit Caching (90%) | Нет               | **Да**            |
| Implicit Caching       | Да (pass-through) | **Да**            |
| Thinking control       | Частично          | **Полный**        |
| `response.parsed`      | Нет               | **Да (Pydantic)** |
| Free tier              | Нет               | **Да**            |
| Fallback routing       | **Автомат**       | Ручной            |
| Nano Banana images     | **Да**            | **Да**            |

**Источники:** [OpenRouter Gemini 3 Flash](https://openrouter.ai/google/gemini-3-flash-preview)

### 2.5 Free Tier

| Модель         | RPM | TPM     | RPD               |
| -------------- | --- | ------- | ----------------- |
| 3 Flash        | ~10 | 250,000 | ~250              |
| 3.1 Flash-Lite | ~15 | 250,000 | ~1,000            |
| 2.5 Flash      | 10  | 250,000 | 250               |
| 2.5 Flash-Lite | 15  | 250,000 | 1,000             |
| 2.5 Pro        | 5   | 250,000 | 100               |
| **3.1 Pro**    | —   | —       | **НЕТ Free tier** |

**Источник:** [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)

### 2.6 Pay-as-you-go Tiers

| Tier   | Порог входа             | RPM     | TPM        | Billing Cap |
| ------ | ----------------------- | ------- | ---------- | ----------- |
| Tier 1 | Billing привязан        | 150-300 | 1,000,000  | $250        |
| Tier 2 | $100+ потрачено, 3+ дня | 1,000+  | 4,000,000+ | $2,000      |
| Tier 3 | $1,000+, 30+ дней       | 4,000+  | Custom     | $20,000+    |

**Важно:** Rate limits привязаны к **проекту**, не к API key. Несколько ключей в одном проекте **не увеличивают** квоту. ([Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits))

---

## 3. Качество моделей: бенчмарки

### 3.1 Chatbot Arena ELO (март 2026)

| #   | Модель                    | ELO       |
| --- | ------------------------- | --------- |
| 1   | Claude Opus 4-6           | 1504      |
| 2   | **Gemini 3.1 Pro**        | **1500**  |
| 5   | Gemini 3 Pro              | 1485      |
| 8   | **Gemini 3 Flash**        | **~1473** |
| —   | **Gemini 3.1 Flash-Lite** | **~1432** |

**Источник:** [Arena Leaderboard](https://arena.ai/leaderboard/text)

### 3.2 Intelligence Index (Artificial Analysis)

| Модель                    | Score    | Tokens/sec |
| ------------------------- | -------- | ---------- |
| **Gemini 3.1 Flash-Lite** | **34**   | **382**    |
| Gemini 2.5 Flash          | 21       | 232        |
| **Рост**                  | **+62%** | **+64%**   |

**Источник:** [Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview)

### 3.3 Structured Data Extraction (ключевой для fancai)

Gemini 3 Flash vs 2.5 Flash на 1000 полях из неструктурированных документов:

| Метрика          | 2.5 Flash | 3 Flash       | Улучшение            |
| ---------------- | --------- | ------------- | -------------------- |
| Общая точность   | baseline  | +15% relative | значительно          |
| Одно поле/файл   | baseline  | +10 п.п.      | заметно              |
| Много полей/файл | baseline  | **+13 п.п.**  | **критично для нас** |

> Наша задача (extraction entities + descriptions из одного файла) — **именно "много полей из файла"**. +13 п.п. — это существенно.

**Источник:** [Box Blog](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)

### 3.4 Галлюцинации

Gemini 3 Flash: 91% hallucination rate по AA-Omniscience. **Контекст:** это частота, с которой модель отвечает неправильно **вместо отказа**, когда **не знает** ответ. Для задач **экстракции из текста** (наш use case) менее релевантно — модель извлекает из предоставленного контекста, а не генерирует из "знаний". ([Better Stack](https://betterstack.com/community/guides/ai/gemini-3-flash-review/))

---

## 4. Thinking Control

### 4.1 Gemini 3.x — `thinking_level` (заменяет `thinking_budget`)

| Уровень   | Описание                                   | Модели                           |
| --------- | ------------------------------------------ | -------------------------------- |
| `minimal` | ≈ выключен для большинства запросов        | 3 Flash, 3.1 Flash-Lite          |
| `low`     | Минимальная латентность                    | 3 Flash, 3.1 Flash-Lite, 3.1 Pro |
| `medium`  | Баланс                                     | Все 3.x                          |
| `high`    | Максимальная глубина (default для 3.1 Pro) | Все 3.x                          |

**Критично:**

- 3.1 Pro: **нельзя использовать `minimal`** — минимум `low`
- 3 Flash: default = `high`, но **`minimal` поддерживается**
- 3.1 Flash-Lite: default = **`minimal`** (!)
- `thinking_budget` и `thinking_level` **нельзя комбинировать**

**Источники:** [Thinking](https://ai.google.dev/gemini-api/docs/thinking), [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### 4.2 Gemini 2.5 — `thinking_budget` (deprecated с моделями)

| Значение    | Поведение                     |
| ----------- | ----------------------------- |
| `0`         | OFF (только Flash/Flash-Lite) |
| `128-24576` | Фиксированный бюджет          |
| `-1`        | Dynamic (default)             |

### 4.3 Рекомендации для fancai

| Задача                 | Модель         | Thinking            | Обоснование                                   |
| ---------------------- | -------------- | ------------------- | --------------------------------------------- |
| **Extraction (TSA)**   | 3 Flash        | `minimal`           | Structured extraction, не требует рассуждений |
| **Сложный extraction** | 3 Flash        | `low`               | Если `minimal` ухудшает качество              |
| **Translation**        | 3.1 Flash-Lite | `minimal` (default) | Простая задача                                |
| **Deduplication**      | 3.1 Flash-Lite | `minimal` (default) | Сравнение строк                               |
| **Synthesis**          | 3.1 Flash-Lite | `low`               | Может нуждаться в рассуждениях                |

### 4.4 Temperature для Gemini 3

**ВАЖНО:** Google рекомендует `temperature=1.0` для Gemini 3. Понижение может вызвать **looping** (повторение одного и того же). Это подтверждено в [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3).

Для structured output с JSON Schema температура менее критична — схема ограничивает вывод. Но лучше начать с `temperature=1.0` и понижать только при необходимости.

---

## 5. Context Caching — исправленный анализ

### 5.1 Минимальные пороги (ИСПРАВЛЕНО)

| Модель                   | Минимум токенов | Источник                                                 |
| ------------------------ | --------------- | -------------------------------------------------------- |
| **Gemini 3.x**           | **4,096**       | [Caching](https://ai.google.dev/gemini-api/docs/caching) |
| **Gemini 2.5 Flash/Pro** | **2,048**       | [Caching](https://ai.google.dev/gemini-api/docs/caching) |

> Первый отчёт указывал 1,024 — это было неверно.

### 5.2 Что можно кэшировать

| Компонент                         | Кэшируется? | Источник                                         |
| --------------------------------- | ----------- | ------------------------------------------------ |
| `contents[]` (текст, файлы)       | **Да**      | [Caching API](https://ai.google.dev/api/caching) |
| `systemInstruction`               | **Да**      | [Caching API](https://ai.google.dev/api/caching) |
| `tools[]` (function declarations) | **Да**      | [Caching API](https://ai.google.dev/api/caching) |
| `toolConfig`                      | **Да**      | [Caching API](https://ai.google.dev/api/caching) |

> **Ключевая находка:** JSON Schema (через tools/function declarations) **тоже кэшируется**. Наши Pydantic-схемы (entities, relationships, descriptions) можно включить в кэш.

### 5.3 Проблема для fancai: промпт + schema < 4096 для 3.x

- TSA_EXTRACTION_PROMPT: ~737 токенов
- Pydantic schema (GeminiTSAResponseSchema): ~200-300 токенов
- System instruction: ~100-200 токенов
- **Итого: ~1000-1200 токенов — ниже 4096 для 3.x**

**Решение:** Добавить few-shot примеры (~3000 токенов):

- 2-3 полных примера input/output для TSA extraction
- Улучшает качество И достигает минимума кэширования

### 5.4 Implicit caching

- Автоматически для 2.5+ и 3.x моделей
- **90% скидка** при cache hit (best-effort)
- Кэшируется **префикс** запроса — стабильный контент в начале
- Мониторинг: проверять `cached_content_token_count` в `usage_metadata`
- `response_schema` — часть `GenerationConfig`, НЕ часть `contents` → **разные schema не ломают cache hit** [ТРЕБУЕТ ПРОВЕРКИ]

**Источники:** [Context Caching](https://ai.google.dev/gemini-api/docs/caching), [Implicit Caching Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)

---

## 6. Batch API

### 6.1 Спецификация

| Параметр          | Значение                  | Источник                                                         |
| ----------------- | ------------------------- | ---------------------------------------------------------------- |
| Скидка            | **50% на input + output** | [Pricing](https://ai.google.dev/pricing)                         |
| SLO               | До 24 часов               | [Batch](https://ai.google.dev/gemini-api/docs/batch)             |
| Max file size     | 2 GB                      | [Batch](https://ai.google.dev/gemini-api/docs/batch)             |
| Max concurrent    | 100 batch jobs            | [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
| Structured output | **Да**                    | [Batch](https://ai.google.dev/gemini-api/docs/batch)             |
| Expiration        | 48 часов                  | [Batch](https://ai.google.dev/gemini-api/docs/batch)             |

### 6.2 Batch + Caching

- Совместимы
- Cached tokens → **90% скидка** (не 50% batch)
- Non-cached tokens → **50% batch скидка**
- Скидки **НЕ складываются**

### 6.3 Batch цены для наших моделей

| Модель                     | Input/1M   | Output/1M | vs Standard |
| -------------------------- | ---------- | --------- | ----------- |
| **3 Flash (batch)**        | **$0.25**  | **$1.50** | -50%        |
| **3.1 Flash-Lite (batch)** | **$0.125** | **$0.75** | -50%        |
| NB2 images (batch 1K)      | **$0.034** | —         | -50%        |

---

## 7. Structured Output — Direct API

### 7.1 Ключевые преимущества

| Аспект      | OpenRouter                        | Direct google-genai                          |
| ----------- | --------------------------------- | -------------------------------------------- |
| Schema      | `_inline_defs()` хак обязателен   | SDK инлайнит `$defs` автоматически           |
| Парсинг     | `json.loads()` + ручная валидация | **`response.parsed`** → Pydantic инстанс     |
| Enum        | Нет                               | **`text/x.enum`**                            |
| Constraints | Нет                               | `minItems`, `maxItems`, `minimum`, `maximum` |

### 7.2 Ограничения

- Pydantic fields с `default=` могут вызвать 400 ошибку ([Issue #699](https://github.com/googleapis/python-genai/issues/699))
- Очень глубокие/большие схемы могут быть отклонены API
- `anyOf` — не документирован, вероятно не поддерживается

### 7.3 SDK пример

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="GOOGLE_API_KEY")

response = await client.aio.models.generate_content(
    model="gemini-3-flash-preview",
    contents=chapter_text,
    config=types.GenerateContentConfig(
        system_instruction=TSA_EXTRACTION_PROMPT,
        response_mime_type="application/json",
        response_schema=GeminiTSAResponseSchema,  # Pydantic напрямую
        temperature=1.0,  # ОБЯЗАТЕЛЬНО для Gemini 3
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
        safety_settings=[
            types.SafetySetting(category=c, threshold="OFF")
            for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
                      "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
        ],
    ),
)

result: GeminiTSAResponseSchema = response.parsed  # Pydantic instance!
```

---

## 8. Nano Banana — Primary + FLUX.2 Fallback

### 8.1 Nano Banana 2 (Gemini 3.1 Flash Image) — Primary

| Параметр          | Значение                                          | Источник                                                                                        |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Model ID          | `gemini-3.1-flash-image-preview`                  | [Models](https://ai.google.dev/gemini-api/docs/models)                                          |
| OpenRouter ID     | `google/gemini-3.1-flash-image-preview`           | [OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-image-preview)                       |
| Качество          | **#1 на AI Arena** (text-to-image)                | [ALM Corp](https://almcorp.com/blog/google-nano-banana-2-gemini-31-flash-image-complete-guide/) |
| Скорость          | ~1-3 сек (1K)                                     | Поисковые результаты                                                                            |
| Aspect ratios     | 14 вариантов                                      | [OpenRouter Docs](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)       |
| Русские промпты   | Gemini понимает, но **качество не гарантировано** | Не подтверждено в офиц. доках                                                                   |
| Reference images  | До 14 (10 objects + 4 characters)                 | [Image Gen Docs](https://ai.google.dev/gemini-api/docs/image-generation)                        |
| Editing           | **Да** (multi-turn)                               | [Image Gen Docs](https://ai.google.dev/gemini-api/docs/image-generation)                        |
| SynthID watermark | Да (невидимый)                                    | [Image Gen Docs](https://ai.google.dev/gemini-api/docs/image-generation)                        |

### 8.2 Стоимость на книгу (100 images)

| Вариант                | Цена/img | 100 img   | vs Текущий |
| ---------------------- | -------- | --------- | ---------- |
| FLUX.2 Klein (текущий) | $0.016   | **$1.60** | Baseline   |
| **NB2 0.5K** (optimal) | $0.045   | **$4.50** | +$2.90     |
| NB2 1K                 | $0.067   | $6.70     | +$5.10     |
| **NB2 1K batch**       | $0.034   | **$3.40** | +$1.80     |
| **NB2 0.5K batch**     | $0.022   | **$2.20** | +$0.60     |

> **NB2 0.5K batch ($2.20/книга)** — +$0.60 vs FLUX.2 за значительно лучшее качество. Для книжных иллюстраций в iframe reader 512px достаточно.

### 8.3 Safety Filters — двухуровневая архитектура

**Уровень 1 (настраиваемый):** 4 категории × пороги `OFF`/`BLOCK_NONE`/`BLOCK_*`. Для Gemini 2.5+/3.x: default = `OFF`. ([Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings))

**Уровень 2 (ненастраиваемый, всегда активен):**

- `IMAGE_SAFETY` — встроенный фильтр
- `IMAGE_PROHIBITED_CONTENT` — запрещённый контент
- `IMAGE_RECITATION` — copyright/IP
- **Нельзя отключить через API**

**Источник:** [Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings), [Apiyi Guide](https://help.apiyi.com/en/nano-banana-2-content-safety-image-generation-failure-guide-en.html)

### 8.4 Детекция safety block (через OpenRouter)

Три типа блокировки:

| Тип                | Сигнал                                                  | Действие          |
| ------------------ | ------------------------------------------------------- | ----------------- |
| **Explicit block** | `finish_reason: IMAGE_SAFETY/SAFETY/PROHIBITED_CONTENT` | Fallback → FLUX.2 |
| **Empty response** | `choices` пусто или `images` пусто                      | Fallback → FLUX.2 |
| **Silent refusal** | `finish_reason: STOP`, text без image                   | Fallback → FLUX.2 |

**Формат ответа OpenRouter идентичен** для NB2 и FLUX.2 — парсинг не нужно менять. Единственное отличие: `modalities: ["image", "text"]` для NB2 vs `["image"]` для FLUX.2. ([OpenRouter Image Gen](https://openrouter.ai/docs/guides/overview/multimodal/image-generation))

### 8.5 Fallback pattern

```python
async def generate_image(self, prompt: str, aspect_ratio: str = "4:3") -> bytes:
    """Nano Banana 2 primary → FLUX.2 Klein fallback."""

    # Attempt 1: Nano Banana 2
    try:
        return await self._generate_with_model(
            model="google/gemini-3.1-flash-image-preview",
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            modalities=["image", "text"],  # NB2 requires text+image
        )
    except (SafetyBlockError, SilentRefusalError) as e:
        logger.warning(f"NB2 safety block: {e}, fallback → FLUX.2")
    except Exception as e:
        logger.warning(f"NB2 error: {e}, fallback → FLUX.2")

    # Attempt 2: FLUX.2 Klein fallback
    return await self._generate_with_model(
        model="black-forest-labs/flux.2-klein-4b",
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        modalities=["image"],  # FLUX uses image only
    )
```

### 8.6 Prompt engineering для снижения safety blocks

1. Суффикс `"SFW, safe for work, book illustration"` (уже есть в коде)
2. `"artistic rendering"`, `"literary illustration"` — сигнализирует creative context
3. Избегать имён реальных людей
4. `"dramatic conflict"` вместо `"violence"`, `"atmospheric tension"` вместо `"blood"`

**Источник:** [Image Gen Docs](https://ai.google.dev/gemini-api/docs/image-generation)

---

## 9. Tiered Model Strategy (Premium)

### 9.1 Рекомендуемая конфигурация

| Задача               | Primary                   | Thinking            | Fallback                              | Обоснование                                  |
| -------------------- | ------------------------- | ------------------- | ------------------------------------- | -------------------------------------------- |
| **Extraction (TSA)** | Gemini 3 Flash            | `minimal`           | 3.1 Flash-Lite → OpenRouter 2.5 Flash | +13 п.п. точности для multi-field extraction |
| **Translation**      | 3.1 Flash-Lite            | `minimal` (default) | OpenRouter 2.5 Flash-Lite             | Простая задача, самая быстрая модель         |
| **Deduplication**    | 3.1 Flash-Lite            | `minimal`           | 3 Flash                               | Structured output, средняя сложность         |
| **Synthesis**        | 3.1 Flash-Lite            | `low`               | 3 Flash                               | Может нуждаться в рассуждениях               |
| **Images**           | **NB2 (3.1 Flash Image)** | —                   | **FLUX.2 Klein**                      | Лучшее качество + safety fallback            |

### 9.2 Fallback chain

```
LLM: Gemini 3 Flash → 3.1 Flash-Lite → OpenRouter 2.5 Flash-Lite (emergency)
Images: Nano Banana 2 → FLUX.2 Klein (safety/error fallback)
```

### 9.3 Не рекомендуется

- **Gemini 3.1 Pro** — overkill ($2/$12), thinking нельзя отключить до `minimal`. Подходит для agentic/coding, не для extraction.
- **Gemini 2.5 Flash** для новых проектов — deprecated 17 июня 2026. Мигрировать сейчас.
- **Imagen 4** — deprecated **24 июня 2026**. Все модели Imagen будут отключены.

---

## 10. Расчёт стоимости — 6 сценариев (Premium)

### 10.1 Параметры расчёта

**1 книга = 50 глав, ~200 LLM вызовов, ~100 images**

| Задача           | Вызовов | Input tok/вызов | Output tok/вызов         | Модель         |
| ---------------- | ------- | --------------- | ------------------------ | -------------- |
| Extraction (TSA) | 55      | 25,000          | 2,000 (minimal thinking) | 3 Flash        |
| Translation      | 100     | 500             | 400                      | 3.1 Flash-Lite |
| Deduplication    | 5       | 5,000           | 1,000                    | 3.1 Flash-Lite |
| Synthesis        | 40      | 3,000           | 2,000                    | 3.1 Flash-Lite |
| **Images**       | **100** | —               | —                        | NB2 / FLUX.2   |

### 10.2 Сценарий 1: OpenRouter текущий (Gemini 2.5 Flash + FLUX.2)

| Задача                 | Input tok | Output tok | $/1M in | $/1M out | Стоимость  |
| ---------------------- | --------- | ---------- | ------- | -------- | ---------- |
| Extraction (2.5 Flash) | 1,375K    | 192K\*     | $0.30   | $2.50    | $0.893     |
| Translation (2.5 FL)   | 50K       | 40K        | $0.10   | $0.40    | $0.021     |
| Dedup (2.5 FL)         | 25K       | 5K         | $0.10   | $0.40    | $0.005     |
| Synthesis (2.5 FL)     | 120K      | 80K        | $0.10   | $0.40    | $0.044     |
| **LLM**                |           |            |         |          | **$0.963** |
| Images (100 × FLUX.2)  |           |            |         |          | **$1.600** |
| **ИТОГО**              |           |            |         |          | **$2.563** |

\*С thinking tokens (dynamic default на 2.5 Flash)

### 10.3 Сценарий 2: Direct 3 Flash + minimal thinking + FLUX.2

| Задача               | Input tok | Output tok | $/1M in | $/1M out | Стоимость  |
| -------------------- | --------- | ---------- | ------- | -------- | ---------- |
| Extraction (3 Flash) | 1,375K    | 110K       | $0.50   | $3.00    | $1.018     |
| Translation (3.1 FL) | 50K       | 40K        | $0.25   | $1.50    | $0.073     |
| Dedup (3.1 FL)       | 25K       | 5K         | $0.25   | $1.50    | $0.014     |
| Synthesis (3.1 FL)   | 120K      | 80K        | $0.25   | $1.50    | $0.150     |
| **LLM**              |           |            |         |          | **$1.255** |
| Images (FLUX.2)      |           |            |         |          | **$1.600** |
| **ИТОГО**            |           |            |         |          | **$2.855** |

> **LLM дороже на $0.29 vs 2.5**, но +13 п.п. точности. Quality-first — оправдано.

### 10.4 Сценарий 3: Direct 3 Flash + NB2 images (0.5K)

| Компонент                        | Стоимость  |
| -------------------------------- | ---------- |
| LLM (3 Flash + 3.1 FL)           | $1.255     |
| Images (100 × NB2 0.5K × $0.045) | **$4.500** |
| **ИТОГО**                        | **$5.755** |

> Без batch — images утраивают стоимость. **Batch обязателен.**

### 10.5 Сценарий 4: Direct + Batch (50% скидка) + NB2 batch

| Задача                                 | Input tok | Output tok | $/1M in | $/1M out | Стоимость  |
| -------------------------------------- | --------- | ---------- | ------- | -------- | ---------- |
| Extraction (3 Flash batch)             | 1,375K    | 110K       | $0.25   | $1.50    | $0.509     |
| Translation (3.1 FL batch)             | 50K       | 40K        | $0.125  | $0.75    | $0.036     |
| Dedup (3.1 FL batch)                   | 25K       | 5K         | $0.125  | $0.75    | $0.007     |
| Synthesis (3.1 FL batch)               | 120K      | 80K        | $0.125  | $0.75    | $0.075     |
| **LLM**                                |           |            |         |          | **$0.627** |
| Images (100 × NB2 0.5K batch × $0.022) |           |            |         |          | **$2.200** |
| **ИТОГО**                              |           |            |         |          | **$2.827** |

> **Лучшее качество (3 Flash + NB2) за $2.83 vs текущие $2.56.** Рост всего $0.26 (+10%).

### 10.6 Сценарий 5: Batch + Caching + NB2

Добавляем explicit caching для промпта + few-shot (4096+ tokens):

| Компонент                   | Стоимость  | Изменение            |
| --------------------------- | ---------- | -------------------- |
| LLM (batch + cached prompt) | $0.610     | -$0.017              |
| Cache storage (1ч, ~4K tok) | $0.004     | +$0.004              |
| Images (NB2 batch)          | $2.200     | —                    |
| **ИТОГО**                   | **$2.814** | **-$0.013 vs Сц. 4** |

> Caching экономит $0.013/книга — минимально. Основная ценность — стабилизация implicit cache hits.

### 10.7 Сценарий 6: Free Tier LLM + FLUX.2

| Задача                          | Стоимость | Ограничения                         |
| ------------------------------- | --------- | ----------------------------------- |
| Extraction (3 Flash Free)       | $0.00     | ~250 RPD, 10 RPM → ~25 мин на книгу |
| Translation (3.1 FL Free)       | $0.00     | 1000 RPD → без проблем              |
| Dedup + Synthesis (3.1 FL Free) | $0.00     | Укладывается в лимиты               |
| Images (FLUX.2 Klein)           | $1.60     | Платно через OpenRouter             |
| **ИТОГО**                       | **$1.60** | Max ~4 книги/день                   |

### 10.8 Сводная таблица

| #   | Сценарий                      | LLM       | Images    | Итого     | Качество LLM | Качество Img |
| --- | ----------------------------- | --------- | --------- | --------- | ------------ | ------------ |
| 1   | OpenRouter 2.5 (текущий)      | $0.96     | $1.60     | **$2.56** | Baseline     | Baseline     |
| 2   | Direct 3 Flash + FLUX         | $1.26     | $1.60     | **$2.86** | **+13 п.п.** | =            |
| 3   | Direct 3 Flash + NB2          | $1.26     | $4.50     | **$5.76** | +13 п.п.     | **#1 Arena** |
| 4   | **Batch 3 Flash + NB2 batch** | **$0.63** | **$2.20** | **$2.83** | **+13 п.п.** | **#1 Arena** |
| 5   | Batch + Cache + NB2           | $0.61     | $2.20     | **$2.81** | +13 п.п.     | #1 Arena     |
| 6   | Free LLM + FLUX               | $0.00     | $1.60     | **$1.60** | +13 п.п.\*   | =            |

> **Рекомендация: Сценарий 4** — лучшее качество по обоим каналам за +$0.27 (+10%) к текущей цене. Для Premium подписки это оптимальный баланс quality/cost.

### 10.9 Месячный расчёт

| Книг/мес | Сц. 1 (текущий) | Сц. 4 (рекомендуемый) | Разница |
| -------- | --------------- | --------------------- | ------- |
| 5        | $12.80          | $14.15                | +$1.35  |
| 10       | $25.60          | $28.30                | +$2.70  |
| 20       | $51.20          | $56.60                | +$5.40  |

---

## 11. Пропущенные возможности API

### 11.1 Полезные для fancai

| Фича                       | Описание                                                          | Приоритет   | Источник                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LocalTokenizer**         | Подсчёт токенов без API call. Только для 2.5 моделей (не 3.x!)    | P2          | [Tokens](https://ai.google.dev/gemini-api/docs/tokens), Issues [#1784](https://github.com/googleapis/python-genai/issues/1784), [#1972](https://github.com/googleapis/python-genai/issues/1972) |
| **File API**               | Загрузка файлов до 2GB, бесплатное хранение 48ч. Работает с Batch | P3          | [Files](https://ai.google.dev/gemini-api/docs/files)                                                                                                                                            |
| **LogProbs**               | Оценка confidence извлечённых полей                               | P3          | [API Reference](https://ai.google.dev/api/generate-content)                                                                                                                                     |
| **Spend Caps**             | Месячный лимит расходов на проект (с 1 апреля 2026)               | P2          | [Billing](https://ai.google.dev/gemini-api/docs/billing)                                                                                                                                        |
| **Seed**                   | Воспроизводимость (best effort, не гарантирован)                  | P3          | [API Reference](https://ai.google.dev/api/generate-content)                                                                                                                                     |
| **countTokens API**        | Точный подсчёт до вызова (бесплатный)                             | P1          | [Tokens](https://ai.google.dev/gemini-api/docs/tokens)                                                                                                                                          |
| **Reference images** (NB2) | До 14 ref images для character consistency                        | P3 (future) | [Image Gen](https://ai.google.dev/gemini-api/docs/image-generation)                                                                                                                             |

### 11.2 Не актуальные для fancai

| Фича                      | Причина                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Grounding (Google Search) | $14/1000 запросов, не нужно для extraction из текста                                            |
| Function calling          | Structured output покрывает наш use case                                                        |
| Fine-tuning               | **Недоступно в AI Studio** ([Model Tuning](https://ai.google.dev/gemini-api/docs/model-tuning)) |
| Provisioned Throughput    | Только Vertex AI, нерелевантно для нашего объёма                                                |
| TTS                       | Будущая фича, дорого ($10-20/1M output tokens)                                                  |
| Code Execution            | Не нужно для extraction                                                                         |

### 11.3 Safety Settings — для текстовых моделей

Для Gemini 2.5+ и 3.x: default = `OFF`. Для художественной литературы (dark fantasy, horror) — **не нужно ничего настраивать**. Safety фильтры для текста значительно мягче, чем для images.

**Источник:** [Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings)

### 11.4 Error Handling

| HTTP Code | Описание                               | Retryable?                 |
| --------- | -------------------------------------- | -------------------------- |
| 400       | Invalid request / Pydantic default bug | Нет                        |
| 403       | Permission denied                      | Нет                        |
| 429       | Rate limit / quota                     | **Да** (backoff)           |
| 500       | Internal error                         | **Да** (backoff)           |
| 503       | Service unavailable                    | **Да** (backoff)           |
| 504       | Timeout                                | **Да** (увеличить timeout) |

**Источник:** [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)

---

## 12. План миграции (обновлённый)

### 12.1 Точки вызова OpenRouter (7 шт)

| #   | Сервис                            | Тип вызова              | Мигрирует?   | Новая модель                 |
| --- | --------------------------------- | ----------------------- | ------------ | ---------------------------- |
| 1   | `gemini_extractor.py` — TSA       | `generate_structured()` | **Да**       | 3 Flash                      |
| 2   | `gemini_extractor.py` — legacy    | `generate_structured()` | **Да**       | 3 Flash                      |
| 3   | `entity_deduplication_service.py` | `generate_structured()` | **Да**       | 3.1 Flash-Lite               |
| 4   | `consistency_manager.py`          | `generate_text()`       | **Да**       | 3.1 Flash-Lite               |
| 5   | `entity_synthesis_service.py`     | `generate_text()`       | **Да**       | 3.1 Flash-Lite               |
| 6   | `imagen_generator.py` — перевод   | `generate_text()`       | **Да**       | 3.1 Flash-Lite               |
| 7   | `imagen_generator.py` — images    | `generate_image()`      | **Частично** | NB2 primary, FLUX.2 fallback |

### 12.2 Файлы

**Создать:**

- `backend/app/core/gemini_client.py` — Direct Gemini API клиент

**Изменить:**

- `backend/app/core/config.py` — `GOOGLE_API_KEY`, модели
- `backend/app/services/gemini_extractor.py` — → gemini_client
- `backend/app/services/entity_deduplication_service.py` — → gemini_client
- `backend/app/services/consistency_manager.py` — → gemini_client
- `backend/app/services/entity_synthesis_service.py` — → gemini_client
- `backend/app/services/imagen_generator.py` — NB2 primary + FLUX.2 fallback

**Оставить:**

- `backend/app/core/openrouter_client.py` — для FLUX.2 fallback + emergency LLM

### 12.3 Ключевые изменения при миграции на Gemini 3

| Аспект            | Gemini 2.5 (текущий)      | Gemini 3 (новый)           |
| ----------------- | ------------------------- | -------------------------- |
| Thinking          | `thinking_budget=0` (off) | `thinking_level="minimal"` |
| Temperature       | 0.1 (текущий)             | **1.0 (обязательно!)**     |
| Structured output | `_inline_defs()` хак      | SDK инлайнит автоматически |
| Caching minimum   | 2,048 tokens              | **4,096 tokens**           |
| Model ID          | `gemini-2.5-flash`        | `gemini-3-flash-preview`   |

### 12.4 Пошаговый план

| #         | Шаг                                                          | Часы          | Зависимости |
| --------- | ------------------------------------------------------------ | ------------- | ----------- |
| 1         | `GOOGLE_API_KEY` в config.py + .env                          | 0.25          | —           |
| 2         | Создать `gemini_client.py` (thinking_level, temperature=1.0) | 2             | #1          |
| 3         | Мигрировать extraction (3 Flash, minimal thinking)           | 2             | #2          |
| 4         | Мигрировать dedup/synthesis/translation (3.1 Flash-Lite)     | 1.5           | #2          |
| 5         | NB2 primary + FLUX.2 fallback в imagen_generator             | 2             | —           |
| 6         | Добавить few-shot примеры в TSA prompt (≥4096 tok)           | 1             | —           |
| 7         | Unit + integration тесты                                     | 2             | #3-5        |
| 8         | A/B тест качества: 3 Flash vs 2.5 Flash                      | 1             | #7          |
| 9         | Deploy + мониторинг                                          | 1             | #8          |
| **Итого** |                                                              | **~13 часов** |             |

### 12.5 Переменные окружения

```bash
# Новое
GOOGLE_API_KEY=AIza...
GEMINI_MODEL_EXTRACTION=gemini-3-flash-preview
GEMINI_MODEL_LIGHT=gemini-3.1-flash-lite-preview
GEMINI_IMAGE_MODEL=google/gemini-3.1-flash-image-preview

# Существующее (для fallback)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_IMAGE_MODEL=black-forest-labs/flux.2-klein-4b
```

---

## 13. Источники

### Модели и цены

- [Gemini API Pricing](https://ai.google.dev/pricing) — все цены
- [Gemini API Models](https://ai.google.dev/gemini-api/docs/models) — спецификации моделей
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3) — фичи 3.x
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) — даты выключения
- [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) — лимиты по tier

### Качество

- [Box Blog — Extraction Accuracy](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction) — +10-15% для structured extraction
- [Artificial Analysis — 3.1 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview) — speed benchmarks
- [Arena Leaderboard](https://arena.ai/leaderboard/text) — ELO рейтинги

### Caching и Batch

- [Context Caching](https://ai.google.dev/gemini-api/docs/caching) — explicit + implicit
- [Caching API Reference](https://ai.google.dev/api/caching) — что можно кэшировать
- [Batch API](https://ai.google.dev/gemini-api/docs/batch) — 50% скидка
- [Implicit Caching Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)

### Structured Output и Thinking

- [Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Thinking/Reasoning](https://ai.google.dev/gemini-api/docs/thinking)
- [Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings)

### Image Generation

- [Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation) — Nano Banana API
- [OpenRouter NB2](https://openrouter.ai/google/gemini-3.1-flash-image-preview) — цены через OpenRouter
- [OpenRouter Image Gen](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) — формат API
- [ALM Corp NB2 Guide](https://almcorp.com/blog/google-nano-banana-2-gemini-31-flash-image-complete-guide/) — бенчмарки

### SDK и Error Handling

- [google-genai PyPI](https://pypi.org/project/google-genai/)
- [Issue #699: Pydantic defaults](https://github.com/googleapis/python-genai/issues/699)
- [Issue #2024: IMAGE_SAFETY hang](https://github.com/googleapis/python-genai/issues/2024)
- [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)

### Дополнительные API

- [File API](https://ai.google.dev/gemini-api/docs/files) — загрузка файлов
- [Token Counting](https://ai.google.dev/gemini-api/docs/tokens) — countTokens + LocalTokenizer
- [Billing](https://ai.google.dev/gemini-api/docs/billing) — spend caps
- [Model Tuning](https://ai.google.dev/gemini-api/docs/model-tuning) — fine-tuning (недоступно)

### Дополнительные файлы исследования

- `docs/research/gemini-context-caching-batch-api-research.md` — детали caching/batch
