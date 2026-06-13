# Gemini API: Сводный справочник для fancai

**Дата:** 2026-03-31  
**Статус:** Исправленная финальная версия после объединенного арбитражного аудита  
**Приоритет источников:** Документация / Changelog / API Reference > SDK docs > первичные внешние источники > внутренние исследования и аудиты

**Важно:** leaderboard, rate limits, usage tiers и часть SDK-нюансов меняются быстро. Для production-решений проверяйте официальные страницы перед внедрением.

---

## 1. Модели и цены

### 1.1 Gemini 3.x

| Модель | Model ID | Standard input / 1M | Standard output / 1M | Standard cached input / 1M | Storage / 1M tok / hour | Batch input / 1M | Batch output / 1M | Batch cached input / 1M | Batch storage / 1M tok / hour | Context | Max out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **3.1 Pro** | `gemini-3.1-pro-preview` | $2.00 / $4.00* | $12.00 / $18.00* | $0.20 / $0.40* | $4.50 | $1.00 / $2.00* | $6.00 / $9.00* | $0.20 / $0.40* | $4.50 | 1M | 64K |
| **3 Flash** | `gemini-3-flash-preview` | $0.50 | $3.00 | $0.05 | $1.00 | $0.25 | $1.50 | $0.05** | $1.00** | 1M | 64K |
| **3.1 Flash-Lite** | `gemini-3.1-flash-lite-preview` | $0.25 | $1.50 | $0.025 | $1.00 | $0.125 | $0.75 | $0.0125 | $0.50 | 1M | 64K |

\* Для `3.1 Pro` цена зависит от объема prompt: `<=200K` / `>200K`.  
\** Для `3 Flash` cached pricing в batch сейчас совпадает со standard; Google отдельно помечает, что batch pricing для context caching еще не реализован.

**Практический вывод для fancai:** базовая рабочая модель для extraction и большинства production-задач остается `gemini-3-flash-preview`. `3.1 Pro` держим как quality tier для hard cases, `3.1 Flash-Lite` — как дешевый tier для translation, dedup и простых high-volume задач.

**Статус preview:** модели Gemini 3.x все еще preview. Следите за changelog и deprecations.

### 1.2 Gemini 2.5

| Модель | Model ID | Standard input / 1M | Standard output / 1M | Cached input / 1M | Storage / 1M tok / hour | Дата выключения |
| --- | --- | --- | --- | --- | --- | --- |
| 2.5 Pro | `gemini-2.5-pro` | $1.25 / $2.50 | $10.00 / $15.00 | $0.125 / $0.25 | $4.50 | **2026-06-17** |
| 2.5 Flash | `gemini-2.5-flash` | $0.30 | $2.50 | $0.03 | $1.00 | **2026-06-17** |
| 2.5 Flash-Lite | `gemini-2.5-flash-lite` | $0.10 | $0.40 | $0.01 | $1.00 | **2026-07-22** |

**Дополнительно:**

- `gemini-3-pro-preview` выключен **2026-03-09** и теперь указывает на `gemini-3.1-pro-preview`.
- все Gemini 2.0 shutdown **2026-06-01**;
- `gemini-2.5-flash-image-preview` уже shut down.

### 1.3 Embedding-модели

| Модель | Тип | Dimensions | Max input | Standard / 1M | Batch / 1M |
| --- | --- | --- | --- | --- | --- |
| `gemini-embedding-001` | Текст | 128-3072 | 2048 tok | $0.15 | $0.075 |
| `gemini-embedding-2-preview` | Мультимодальный | 128-3072 | 8192 tok | $0.20 | $0.10 |

**Важно:**

- embedding space у `gemini-embedding-001` и `gemini-embedding-2-preview` **разный**;
- при смене модели нужен полный re-embed;
- `embedding-2-preview` поддерживает text, image, audio, video и PDF в **едином embedding space**.

**Multimodal limits у `gemini-embedding-2-preview`:**

- до `8192` токенов overall;
- до `6` изображений;
- audio до `80` секунд;
- video до `120` секунд;
- PDF до `6` страниц.

### 1.4 Image generation pricing

#### Gemini 3.1 Flash Image Preview

| Resolution | Standard | Batch |
| --- | --- | --- |
| 0.5K | $0.045 / img | $0.022 / img |
| 1K | $0.067 / img | $0.034 / img |
| 2K | $0.101 / img | $0.050 / img |
| 4K | $0.151 / img | $0.076 / img |

#### FLUX.2 Klein через OpenRouter

- для грубого budgeting на 1MP можно считать **~$0.014 / image**;
- для больших изображений цена **прогрессивная**, поэтому для 2K/4K проверяйте страницу провайдера отдельно.

### 1.5 Direct Gemini API vs OpenRouter

| Возможность | Direct Gemini API | OpenRouter |
| --- | --- | --- |
| Batch API | **Да** | Нет |
| Explicit context caching | **Да** | Нет |
| Implicit caching | **Да** | Частично / passthrough-зависимо |
| `response.parsed` и Pydantic ergonomics | **Да** через `google-genai` | Нет |
| File Search / Interactions / image-family updates | **Раньше появляются и полнее документированы** | Зависят от router exposure |
| Fallback routing между vendor models | Ручной | **Да** |
| Free tier | **Да** | Нет |

**Важно про OpenRouter fee:** не трактуйте fee как универсальный per-request markup. OpenRouter отдельно пишет, что markup на inference pricing не делает; platform fee относится к покупке credits и зависит от billing path.

### 1.6 Free tier и usage tiers

**Надежно подтверждается:**

- `3.1 Pro` не имеет free tier;
- quotas и текущие limits нужно смотреть в **AI Studio**;
- rate limits привязаны к **project**, а не к API key.

| Tier | Qualification | Billing cap |
| --- | --- | --- |
| Tier 1 | billing attached | $250 |
| Tier 2 | $100+ и 3+ дня | $2,000 |
| Tier 3 | $1,000+ и 30+ дней | $20,000+ |

**Примечание:** Google официально не публикует все точные RPM/TPM/RPD в виде стабильной таблицы для каждой модели; эти значения нужно проверять в AI Studio.

---

## 2. Качество моделей

### 2.1 Arena snapshot на 2026-03-26

**Использовать только как snapshot, не как вечную истину.**

| Rank | Модель | Elo |
| --- | --- | --- |
| 1 | `claude-opus-4-6-thinking` | `1504±6` |
| 2 | `claude-opus-4-6` | `1500±6` |
| 3 | `gemini-3.1-pro-preview` | `1493±6` |
| 9 | `gemini-3-flash` | `1474±4` |
| 40 | `gemini-3.1-flash-lite-preview` | `1438±6` |

**Практический вывод:** `3 Flash` остается сильной price/performance-моделью; `3.1 Pro` — near-frontier quality tier; `3.1 Flash-Lite` заметно слабее и требует более узкого применения.

### 2.2 Box benchmark по extraction

Gemini 3 Flash против Gemini 2.5 Flash на бизнес-документах:

| Сценарий | Улучшение |
| --- | --- |
| Single field / file | `~+10 п.п.` |
| Multi-field / file | `~+13 п.п.` |
| Images | `~+9 п.п.` |
| Long documents | `~+6 п.п.` |

**Важно:** в Box также встречается формулировка про `~15% relative improvement`. Это **не то же самое**, что `+15 percentage points`.

**Для fancai:** benchmark релевантен как сигнал в пользу `3 Flash` для extraction, но fiction и chapter-level extraction нужно валидировать отдельно.

### 2.3 MMTEB / multilingual embeddings

| Модель | MTEB multilingual score |
| --- | --- |
| `Gemini Embedding` | `68.32` |
| `multilingual-e5-large-instruct` | `63.23` |

**Вывод:** Gemini Embedding показывает сильный multilingual baseline, но документировать это как гарантию именно для русской fiction-нормализации нельзя: отдельного русскоязычного benchmark snapshot в docs нет.

### 2.4 Gemini 3.1 Flash-Lite: риск для extraction

Корректная формулировка не “непригодна вообще”, а следующая:

- у `3.1 Flash-Lite` есть **подтвержденный operational risk** на части extraction workloads;
- есть forum reports про premature stop / unfinished responses;
- для fancai ее **не стоит ставить extraction default** без локального A/B и guardrails.

**Рекомендуемая роль модели:**

- `translation`
- `dedup`
- `simple classification`
- `cheap synthesis`

**Не рекомендуемая роль без A/B:** chapter-level structured extraction как primary model.

---

## 3. Thinking Control

### 3.1 Gemini 3.x: `thinking_level`

| Уровень | Смысл |
| --- | --- |
| `minimal` | почти no-thinking для большинства запросов, но не гарантирует полный off |
| `low` | минимальная латентность и стоимость |
| `medium` | баланс |
| `high` | максимальная глубина reasoning, более высокая latency |

**Поддержка по моделям:**

- `3.1 Pro`: `minimal` не поддерживается;
- `3 Flash`: `minimal/low/medium/high` поддерживаются;
- `3.1 Flash-Lite`: `minimal/low/medium/high` поддерживаются.

**Критическое практическое правило:** для production **задавайте `thinking_level` явно**, не полагайтесь на implicit defaults. В документации есть неконсистентность по default behavior, особенно вокруг Flash-Lite.

### 3.2 Gemini 2.5: `thinking_budget`

| Модель | Numeric range | Disable | Dynamic |
| --- | --- | --- | --- |
| 2.5 Pro | `128-32768` | нельзя | `-1` |
| 2.5 Flash | `0-24576` | `0` | `-1` |
| 2.5 Flash-Lite | `512-24576` | `0` | `-1` |

**Важно:** для Gemini 3 используйте `thinking_level`. `thinking_budget` с Gemini 3 принимается ради backward compatibility, но официально может вести к unexpected performance.

### 3.3 Рекомендации для fancai

| Задача | Модель | Рекомендация |
| --- | --- | --- |
| Extraction | `3 Flash` | начать с `minimal`, A/B против `low` |
| Translation | `3.1 Flash-Lite` | `minimal` |
| Dedup / cheap semantic work | `3.1 Flash-Lite` | `minimal` |
| Synthesis | `3.1 Flash-Lite` | `low` |
| Hard extraction fallback | `2.5 Flash` до 2026-06-17, затем `3.1 Pro` или retry `3 Flash` | explicit config |

### 3.4 Temperature

Для Gemini 3 разумная стартовая точка — `temperature=1.0`. Понижать стоит только после локального бенчмарка на ваших prompts и schema. Это **рекомендация**, а не жесткое требование.

---

## 4. Context Caching

### 4.1 Минимальные пороги

| Класс модели | Минимум токенов |
| --- | --- |
| Flash-class | `1024` |
| Pro-class | `4096` |

**Примечание по `3.1 Flash-Lite`:** pricing page явно показывает caching support; для planning считаем ее Flash-class (`1024`), но перед rollout лучше проверить в staging.

### 4.2 Cached pricing и storage

| Модель | Standard cached / 1M | Standard storage / hour | Batch cached / 1M | Batch storage / hour |
| --- | --- | --- | --- | --- |
| `3.1 Pro` | `$0.20 / $0.40`* | `$4.50` | `$0.20 / $0.40`* | `$4.50` |
| `3 Flash` | `$0.05` | `$1.00` | `$0.05`** | `$1.00` |
| `3.1 Flash-Lite` | `$0.025` | `$1.00` | `$0.0125` | `$0.50` |

\* `<=200K` / `>200K` prompt size.  
\** Google отдельно пишет, что batch pricing для caching у `3 Flash` еще не implemented; текущая ставка совпадает со standard.

### 4.3 Что можно кэшировать

- `contents`
- `system_instruction`
- `tools`
- `tool_config`

Если используете `cached_content`, не дублируйте эти же части отдельно в запросе.

### 4.4 Implicit caching

- работает best-effort;
- полезен только при стабильном префиксе prompt;
- не заменяет explicit caching там, где нужен контролируемый reusable context.

### 4.5 Break-even

Приближенный break-even по repeated reuses within one hour:

| Модель | Break-even |
| --- | --- |
| `3 Flash` | `~2.22` reuse |
| `3.1 Pro` (`<=200K`) | `~2.5` reuse |
| `3.1 Pro` (`>200K`) | `~1.25` reuse |
| `3.1 Flash-Lite` | `~4.44` reuse |

**Практически:**

- для `3 Flash` caching начинает выглядеть разумно примерно с **3 повторных использований одного и того же контекста за час**;
- для простого `2-call` сценария caching обычно **не главный источник экономии**.

### 4.6 Что это значит для fancai

- prompt-only caching для TSA prompt — не top priority;
- caching становится особенно интересным в **multi-call PDF** и **multi-query File Search** сценариях;
- не стоит рекламировать caching как P1 для двухзапросного PDF flow.

---

## 5. Batch API

### 5.1 Спецификация

| Параметр | Значение |
| --- | --- |
| Скидка | `50%` на input и output |
| SLO | до `24 часов` |
| Max file size | `2 GB` |
| Max concurrent jobs | `100` |
| Expiration | `48 часов` |
| Structured output | Да |

### 5.2 Batch + caching

Главное правило: поведение **модель-специфично**.

- `3 Flash`: cached input в batch сейчас совпадает со standard cached price;
- `3.1 Pro`: cached input в batch тоже совпадает со standard cached price;
- `3.1 Flash-Lite`: в batch cached price действительно ниже standard.

**Следствие:** не используйте универсальную фразу “скидки не складываются” без model-specific оговорки.

### 5.3 Где Batch API реально полезен fancai

- chapter extraction;
- image generation;
- mass embeddings;
- nightly backfills и reprocessing.

**Ограничение:** Batch API доступен только через прямой Gemini API, не через OpenRouter.

---

## 6. Structured Output

### 6.1 JSON mode vs JSON Schema

Есть два разных режима:

1. **JSON mode**: `response_mime_type="application/json"`  
   Гарантирует валидный JSON.
2. **JSON Schema**: `response_mime_type="application/json" + response_schema`  
   Гарантирует JSON, который должен соответствовать schema.

Для fancai нужен именно **второй** вариант.

### 6.2 Почему direct `google-genai` удобнее

| Что именно | Direct `google-genai` | OpenRouter passthrough |
| --- | --- | --- |
| Pydantic / typed schema ergonomics | **Да** | Нет |
| `response.parsed` | **Да** | Нет |
| JSON Schema helper ergonomics | **Да** | Ограничено |
| `text/x.enum` | **Да** | не как first-class SDK path |

**Важно:** не смешивайте capabilities Gemini API и SDK conveniences. `anyOf`, constraints и structured outputs — это capabilities Gemini API; `response.parsed` и Pydantic conversion — это уже SDK ergonomics.

### 6.3 Состояние schema support

На дату этого документа:

- `anyOf` поддерживается;
- `text/x.enum` поддерживается;
- current `google-genai` docs / SDK examples уже показывают рабочие JSON Schema flows.

### 6.4 Пример кода

```python
from google import genai
from google.genai import types

client = genai.Client()

response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents=chapter_text,
    config=types.GenerateContentConfig(
        system_instruction=TSA_EXTRACTION_PROMPT,
        response_mime_type="application/json",
        response_schema=GeminiTSAResponseSchema,
        temperature=1.0,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    ),
)

result = response.parsed
```

---

## 7. Image Generation

### 7.1 Рабочая модельная карта

| Модель | Роль |
| --- | --- |
| `gemini-3.1-flash-image-preview` | speed / high-volume / interactive generation |
| `gemini-3-pro-image-preview` | premium assets / higher-quality production |
| `Imagen 4` family | специализированная high-quality image tier |

### 7.2 Gemini 3.1 Flash Image Preview

Ключевые свойства:

- text + image output в одном вызове;
- `0.5K / 1K / 2K / 4K`;
- до `14` reference images total;
- для Flash Image split = **до 10 object refs + до 4 character refs**;
- новые aspect ratios для wide / tall layouts;
- SynthID watermark включен.

**Важно:** не используйте вечные claims вида “#1 на Arena”. Если нужен ranking, фиксируйте snapshot-date.

### 7.3 Safety и finish reasons

Для image generation разделяйте:

- **image-specific reasons**: `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION`, `IMAGE_OTHER`, `NO_IMAGE`;
- **generic reasons**: `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `RECITATION`, `SPII`, `OTHER`, `MALFORMED_FUNCTION_CALL`.

**Практика:** нормализуйте эти причины в собственный adapter layer и логируйте отдельно prompt-side и candidate-side блокировки.

### 7.4 Fallback pattern для fancai

Базовый production-паттерн:

```text
NB2 / Flash Image -> FLUX.2 Klein (cost/safety fallback)
```

**Замечание:** если вам нужен premium illustration tier, добавляйте `gemini-3-pro-image-preview` или Imagen 4 как отдельный branch, а не просто как fallback.

---

## 8. File Search (Managed RAG)

### 8.1 Спецификация

| Параметр | Значение |
| --- | --- |
| Форматы | TXT, HTML, XML, CSV, JSON, PDF, DOCX, XLSX, PPTX, Markdown, RTF, код, SQL, LaTeX, Jupyter, ODT и др. |
| EPUB | **Не поддерживается** |
| Max file size | `100 MB` |
| Storage tiers | `1 GB / 10 GB / 100 GB / 1 TB` |
| Рекомендованный размер одного store | `< 20 GB` |
| Backend store size | обычно `~3x` размера входных данных |
| Indexing price | `$0.15 / 1M tokens` |
| Storage | бесплатно |
| Query-time embeddings | бесплатно |
| Retrieved tokens | по обычной цене model context |
| Metadata filtering | **Да** |
| Citations / grounding metadata | **Да** |
| Structured outputs | **Да**, начиная с Gemini 3 |

### 8.2 Persistence model

- raw `File` object через Files API живет `48 часов`;
- данные, импортированные в File Search store, хранятся **бессрочно** до ручного удаления;
- store и document APIs позволяют `list/get/delete`.

### 8.3 Tool compatibility

На дату документа официально подтверждается:

- File Search можно комбинировать со **structured outputs**;
- File Search можно комбинировать с **custom function calling**;
- File Search **нельзя** комбинировать с другими built-in tools вроде Grounding with Google Search и URL Context.

### 8.4 Почему это важно для fancai

File Search дает не только retrieval, но и:

- **chapter-level filtering**;
- **spoiler-safe verification**;
- **citations / grounding metadata** для объяснимости;
- возможность post-extraction consistency checks по всей книге.

### 8.5 Рекомендации по metadata

- для точных фильтров по автору / типу документа подойдут string metadata;
- для диапазонов по номеру главы лучше хранить `chapter` как **numeric metadata** и фильтровать без кавычек.

**Не полагайтесь на строковое сравнение** для chapter ranges.

---

## 9. PDF Document Processing

### 9.1 Что изменилось в Gemini 3

В Gemini 3 budgeting PDF больше нельзя сводить к старой грубой цифре `258 tok/page`. Нужно считать через `media_resolution`.

| Resolution | PDF image tokens / page |
| --- | --- |
| `LOW` | `280 + native text` |
| `UNSPECIFIED` / default | `560 + native text` |
| `MEDIUM` | `560 + native text` |
| `HIGH` | `1120 + native text` |
| `ULTRA_HIGH` | `N/A` для PDF |

### 9.2 Базовые ограничения

| Параметр | Значение |
| --- | --- |
| Max pages | `1000` |
| Max size | `50 MB` |
| Native text extraction | **не тарифицируется как input tokens** |
| `media_resolution` scope | задается **per media part**, не как отдельный “PDF-only mode” |

### 9.3 Пример стоимости: 500-страничная книга через `3 Flash`

Ниже — только image tokens + output `30K`. Native text не тарифицируется.

| Resolution | Image tokens | Input cost | Output cost | Итого |
| --- | --- | --- | --- | --- |
| `LOW` | `140K` | `$0.070` | `$0.090` | `$0.160` |
| `DEFAULT / MEDIUM` | `280K` | `$0.140` | `$0.090` | `$0.230` |
| `HIGH` | `560K` | `$0.280` | `$0.090` | `$0.370` |

### 9.4 Context window risk

Если у 500-страничной книги native text порядка `~750K` tokens:

| Resolution | Rough total | Feasibility vs 1M |
| --- | --- | --- |
| `LOW` | `140K + 750K = 890K` | помещается, но без большого запаса |
| `DEFAULT` | `280K + 750K = 1.03M` | вероятно превышает |
| `HIGH` | `560K + 750K = 1.31M` | превышает |

**Важно:** это оценка. Перед rollout делайте `countTokens()` на реальных книгах.

### 9.5 EPUB -> PDF

`ebook-convert book.epub book.pdf` через Calibre остается рабочим способом получить searchable PDF с embedded text.

### 9.6 Files API для PDF

- upload через `client.files.upload()`;
- raw file удаляется через `48 часов`;
- бесплатно;
- лимит `50 MB` для PDF.

### 9.7 Практический вывод для fancai

PDF — это **P1 для controlled A/B**, но не “магическое решение для всех книг”.

Рекомендованный rollout:

1. тестировать сначала книги `<250` страниц на default и `<500` страниц на `LOW`;
2. во всех расчетах фиксировать `media_resolution`;
3. не считать caching обязательным выигрышем для двухзапросного сценария;
4. для длинных книг использовать hybrid strategy вместо naive whole-book.

---

## 10. Embeddings и Entity Dedup

### 10.1 Модели

- `gemini-embedding-001` — основной текстовый embedding model;
- `gemini-embedding-2-preview` — мультимодальный embedding model с unified embedding space.

### 10.2 Batch embeddings

Embeddings поддерживают batch pricing, что полезно для массового re-embed и backfills.

### 10.3 Сценарий для fancai

Оптимальная связка для dedup:

```text
fuzzy matching + embeddings + LLM verification
```

Плюсы:

- fuzzy хорошо ловит опечатки;
- embeddings лучше ловят семантические alias / title variants;
- LLM закрывает ambiguity.

### 10.4 Ограничения интерпретации

Не стоит обещать, что embeddings сами по себе надежно решат культурно-специфичные nickname mappings вроде:

```text
Александр -> Саша -> Шурик
```

Такие случаи нужно тестировать на реальных парах и не подавать как гарантированную capability.

### 10.5 Хранение

`pgvector` остается разумным storage layer для dedup / similarity search в PostgreSQL.

```sql
CREATE EXTENSION vector;
CREATE INDEX ON entities USING hnsw (embedding vector_cosine_ops);
```

### 10.6 Приоритет

`Embeddings` — это **P1 по качеству**, а не по экономии. Главная ценность для fancai — улучшение dedup quality.

---

## 11. Thought Signatures

### 11.1 Когда нужно думать о signatures

| Сценарий | Что делать |
| --- | --- |
| Gemini 3 + function calling | **обязательно** корректно циркулировать signatures; при ошибке можно получить `400` |
| Gemini 3 image generation, multi-turn | signatures нужно передавать дальше; SDK делает это автоматически |
| Single-turn text / JSON / schema calls | вручную ничего делать не нужно |
| Text-only multi-turn через SDK chat/history | SDK handling достаточно |

### 11.2 SDK

Если используете `google-genai` и либо chat API, либо передаете full model response обратно в history, SDK берет signature-handling на себя.

### 11.3 Dummy signatures

Документация отдельно упоминает известные dummy values:

- `context_engineering_is_the_way_to_go`
- `skip_thought_signature_validator`

### 11.4 Для fancai

Текущая архитектура fancai в основном `single-turn + response_schema`, поэтому manual thought-signature work **не требуется**.

---

## 12. Interactions API

### 12.1 Что подтверждается

| Параметр | Значение |
| --- | --- |
| Статус | `Beta` |
| `store` | `true` по умолчанию |
| `background=true` | только для agents |
| Structured output | Да |
| Function calling | Да |
| Remote MCP | **не работает с Gemini 3; coming soon** |

### 12.2 Retention и privacy

- Paid tier: retention `55 дней`;
- Free tier: retention `1 день`;
- `store=false` отключает storage, но несовместим с `background=true` и `previous_interaction_id`.

### 12.3 Для fancai

Interactions API не стоит делать primary pipeline для batch chapter extraction:

- stateful history раздувает стоимость;
- API beta;
- tool-augmented flows уже можно строить через `generate_content + File Search + function calling`.

**Роль для fancai:** P3 / monitor, не основной production path.

---

## 13. Tiered Model Strategy

### 13.1 Рекомендуемая конфигурация

| Задача | Primary | Настройки | Fallback |
| --- | --- | --- | --- |
| Extraction | `3 Flash` | explicit `thinking_level="minimal"` | `2.5 Flash` до 2026-06-17, затем `3.1 Pro` или retry `3 Flash` |
| Translation | `3.1 Flash-Lite` | `minimal` | `2.5 Flash-Lite` пока доступна |
| Dedup | `3.1 Flash-Lite` | `minimal` | `3 Flash` |
| Synthesis | `3.1 Flash-Lite` | `low` | `3 Flash` |
| Images | `3.1 Flash Image Preview` | обычно `0.5K` или `1K` | FLUX.2 Klein для дешевого fallback; Pro Image / Imagen 4 для premium |

### 13.2 Чего не делать

Не ставьте `3.1 Flash-Lite` в extraction fallback chain без оговорки о его observed failure modes на extraction.

### 13.3 Budget track

Если нужен временный budget track до shut down 2.5 family:

- `2.5 Flash` и `2.5 Flash-Lite` все еще дают хороший low-cost baseline;
- но roadmap должен учитывать hard cutoffs летом 2026.

---

## 14. Cost Model для планирования

### 14.1 Нормализованные unit costs

#### `3 Flash`

| Режим | Input / 1M | Output / 1M | Cached / 1M |
| --- | --- | --- | --- |
| Standard | $0.50 | $3.00 | $0.05 |
| Batch | $0.25 | $1.50 | $0.05 |

#### `3.1 Flash-Lite`

| Режим | Input / 1M | Output / 1M | Cached / 1M |
| --- | --- | --- | --- |
| Standard | $0.25 | $1.50 | $0.025 |
| Batch | $0.125 | $0.75 | $0.0125 |

### 14.2 Пример image economics для 100 изображений

| Модель / resolution | Стоимость |
| --- | ---: |
| NB2 standard 0.5K | $4.50 |
| NB2 batch 0.5K | $2.20 |
| NB2 standard 1K | $6.70 |
| NB2 batch 1K | $3.40 |
| FLUX.2 Klein 1MP | ~$1.40 |

### 14.3 Пример PDF discovery economics

Для 500-страничной книги через `3 Flash`:

- `LOW`: `~$0.160`
- `DEFAULT / MEDIUM`: `~$0.230`
- `HIGH`: `~$0.370`

### 14.4 Практические выводы

1. Для image-heavy сценариев сначала выбирайте **resolution**, потом уже модель.
2. Для PDF сценариев сначала выбирайте **media_resolution**, потом решайте, нужен ли whole-book path.
3. Не используйте “красивые итоговые totals на книгу” без явных token assumptions и `countTokens()` traces.

---

## 15. Миграция: Plan

### Фаза 0: Подготовка

1. Зафиксировать `google-genai>=1.69.0`
2. Добавить `countTokens()` / token tracing в pipeline
3. Вынести `thinking_level`, `temperature`, `image_size`, `media_resolution` в явные config-поля
4. Нормализовать adapter layer для Direct Gemini API и OpenRouter

### Фаза 1: Direct API Client

1. Добавить прямой Gemini client рядом с OpenRouter
2. Использовать Direct для structured output, File Search, Batch, image models
3. Оставить OpenRouter там, где нужен routing / non-Google fallback

### Фаза 2: Batch

1. Chapter extraction batch jobs
2. Image generation batch jobs
3. Embedding backfills через batch
4. Добавить monitoring / retry / expiry handling для batch jobs

### Фаза 3: PDF A/B

1. Тестовый набор книг разной длины
2. `LOW` vs `DEFAULT` media resolution
3. `countTokens()` на реальных PDF
4. Whole-book только там, где помещается в окно с запасом

### Фаза 4: Embeddings

1. `pgvector`
2. fuzzy + embedding + LLM verification
3. evaluation set на реальных alias pairs

### Фаза 5: File Search

1. chapter-level metadata
2. citations / grounding metadata в verification path
3. entity consistency check по всей книге

---

## 16. SDK и инфраструктура

### 16.1 `google-genai`

- на дату документа актуальная версия: **`1.69.0`**
- использовать direct SDK для:
  - `response.parsed`
  - structured outputs
  - File Search
  - image generation
  - Interactions API

### 16.2 Safety settings

- для 2.5+ / 3.x default safety behavior уже существенно мягче, чем у старых моделей;
- не документируйте `BLOCK_NONE` как vendor recommendation без собственного теста;
- если fancai нужна наблюдаемость и policy traceability, зафиксируйте **собственный safety profile** и проверьте его на реальных кейсах.

### 16.3 Error handling

Для production-логирования фиксируйте:

- model id;
- `thinking_level`;
- `image_size` / `media_resolution`;
- finish reason / block reason;
- citations / grounding metadata, если используется File Search.

---

## 17. Важные возможности, которые стоит держать в backlog

| Возможность | Почему это полезно | Приоритет |
| --- | --- | --- |
| File Search citations / grounding metadata | explainability и ручная верификация extraction | P1 |
| Batch embeddings | дешевый массовый re-embed и backfills | P2 |
| Gemini 3 Pro Image / Imagen 4 | premium illustration tier | P2 |
| File Search store lifecycle | чистка, TTL-модель, latency under 20GB | P2 |
| Code Execution | точечная аналитика и post-processing | P3 |
| URL Context | низкая релевантность для fancai, но полезно знать | P4 |
| JSON mode vs JSON Schema | важно для contract design и debugging | P2 |

---

## 18. Источники

### Official Google

- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Context caching](https://ai.google.dev/gemini-api/docs/caching)
- [Batch API](https://ai.google.dev/gemini-api/docs/batch)
- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [File Search API Reference](https://ai.google.dev/api/file-search)
- [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [Files API](https://ai.google.dev/gemini-api/docs/files)
- [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Release notes](https://ai.google.dev/gemini-api/docs/changelog)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

### Official SDK

- [PyPI: google-genai](https://pypi.org/project/google-genai/)

### Primary external sources

- [Arena Text Leaderboard](https://arena.ai/leaderboard/text)
- [Arena Text-to-Image Leaderboard](https://arena.ai/leaderboard/text-to-image)
- [Box Blog: Gemini 3 Flash extraction benchmark](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)
- [Gemini Embedding paper](https://arxiv.org/html/2503.07891v1)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [OpenRouter fee announcement](https://openrouter.ai/announcements/simplifying-our-platform-fee)
- [FLUX.2 Klein 4B](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- [Google AI Developers Forum: Flash-Lite early response](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602)
