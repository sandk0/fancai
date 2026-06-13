# Исследование: Продвинутые возможности Gemini API для fancai

**Дата:** 2026-03-31
**Scope:** Глубокий анализ 5 фич Gemini API с конкретными сценариями интеграции
**Приоритет:** Оценить реальную применимость для AI-пайплайна fancai

---

## 1. File Search (Managed RAG)

### 1.1 Что это

Полностью управляемая RAG-система от Google. Загружаешь файлы → Gemini автоматически делает chunking, embedding (через `gemini-embedding-001`), indexing → затем при запросах семантически ищет релевантные фрагменты и включает их в контекст модели.

**Ключевое отличие от прямого `generate_content`:** модель не видит весь документ. Она видит только семантически релевантные чанки, извлечённые RAG-системой по запросу.

### 1.2 Технические спецификации

| Параметр                   | Значение                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| **Поддерживаемые форматы** | TXT, HTML, XML, CSV, JSON, PDF, DOCX, XLSX, PPTX, Markdown, RTF, код (Python, JS, Go, Rust...) |
| **Max размер файла**       | 100 MB                                                                                         |
| **Хранение (Free tier)**   | 1 GB                                                                                           |
| **Хранение (Tier 1/2/3)**  | 10 GB / 100 GB / 1 TB                                                                          |
| **TTL**                    | **Бессрочно** — данные сохраняются до ручного удаления или deprecation модели                  |
| **Стоимость индексации**   | $0.15 / 1M tokens (embeddings)                                                                 |
| **Стоимость хранения**     | Бесплатно                                                                                      |
| **Стоимость запросов**     | Бесплатно (embeddings для query). Извлечённые токены тарифицируются по цене модели             |
| **Chunking control**       | Да — `max_tokens_per_chunk`, `max_overlap_tokens`                                              |
| **Structured output**      | Да — работает с `response_schema` на Gemini 3 Flash и 3 Pro                                    |
| **Batch API**              | Не документировано                                                                             |
| **Русский язык**           | Поддерживается (100+ языков)                                                                   |

**Источники:** [File Search](https://ai.google.dev/gemini-api/docs/file-search), [Pricing](https://ai.google.dev/pricing)

### 1.3 Код — создание store и запрос

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="GOOGLE_API_KEY")

# 1. Создать store
store = client.file_search_stores.create(
    config={"display_name": "book-war-and-peace"}
)

# 2. Загрузить книгу (текст, извлечённый из EPUB)
client.file_search_stores.upload_to_file_search_store(
    file="war_and_peace_full.txt",
    file_search_store_name=store.name,
)

# 3. Запрос с structured output
response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents="Найди все описания внешности князя Андрея Болконского",
    config=types.GenerateContentConfig(
        tools=[types.Tool(
            file_search=types.FileSearch(
                file_search_store_names=[store.name]
            )
        )],
        response_mime_type="application/json",
        response_schema=CharacterDescriptionSchema,  # Pydantic
    ),
)
```

### 1.4 Применимость для fancai — конкретные сценарии

#### Сценарий A: Entity consistency check (ВЫСОКАЯ ценность)

**Проблема:** После extraction у нас есть entity граф. Но chunk-based processing теряет связи.

**Решение:**

1. Загрузить всю книгу в File Search store
2. После основного extraction, для каждого entity запросить: "Найди ВСЕ упоминания [персонаж] и его описания"
3. File Search вернёт все релевантные фрагменты из ВСЕЙ книги
4. Structured output соберёт в единую схему

**Стоимость:**

- Индексация книги (500K слов ≈ 700K tokens): $0.15 × 0.7 = **$0.105** (одноразово)
- 50 entity queries × ~5K retrieved tokens = 250K tokens × $0.50/1M = **$0.125**
- **Итого: $0.23/книга** за consistency pass

#### Сценарий B: "Второй проход" для пропущенных entities

После chunk-based extraction:

1. Объединить все найденные entities в список
2. Запрос к File Search: "Найди персонажей, которых НЕТ в этом списке: [список]"
3. RAG найдёт упоминания персонажей, пропущенных на стыках чанков

#### Сценарий C: Полная замена chunk-based extraction (РИСКОВАННО)

Вместо чанкинга → загрузить книгу в store → серия запросов:

- "Извлеки всех персонажей из книги"
- "Извлеки все локации"
- "Для каждого персонажа найди описания внешности"

**Риск:** RAG возвращает только релевантные чанки, не всю книгу. Entities, упомянутые мимоходом, могут не попасть в retrieval. Для extraction **полный контекст надёжнее** RAG.

### 1.5 Критические ограничения

1. **File Search + Structured Output + ThinkingConfig = баг.** На Gemini 3 Flash при комбинации всех трёх фич: nil response, token bloat (190K-235K). Thinking `medium` работает, `low` и `high` — нет. [Forum report](https://discuss.ai.google.dev/t/file-search-structured-output-thinkingconfig-nil-response-and-no-grounding-metadata-on-gemini-3/127444)

2. **Нельзя комбинировать с другими tools** (Google Search, URL Context, Code Execution).

3. **EPUB не поддерживается напрямую.** Нужно извлечь текст из EPUB (ebooklib → plain text) и загрузить как TXT/HTML. HTML поддерживается — можно загрузить XHTML-файлы из EPUB напрямую.

4. **Рекомендация Google:** store < 20 GB для оптимальной latency.

### 1.6 Рекомендация для fancai

**Приоритет: P2 — Сценарий A (entity consistency check)**

Не заменять основной chunk-based extraction, а **дополнить** его:

- Основной проход: chunk-based extraction (как сейчас)
- Второй проход: File Search для verification и поиска пропущенного
- Стоимость: +$0.23/книга (9% от baseline $2.56)
- Ценность: устранение entity loss at chunk boundaries

**Блокер:** Баг с ThinkingConfig. Workaround: использовать thinking=`medium` или отключить thinking для File Search запросов.

---

## 2. PDF-вход (Document Processing)

### 2.1 Что это

Gemini обрабатывает PDF как визуальный ввод — каждая страница рендерится как изображение и анализируется vision-моделью. Для Gemini 3: дополнительно извлекается embedded text из PDF (бесплатно). Модель видит **ВЕСЬ документ** целиком.

### 2.2 Технические спецификации

| Параметр              | Значение                                                 |
| --------------------- | -------------------------------------------------------- |
| **Max страниц**       | 1000                                                     |
| **Max размер**        | 50 MB                                                    |
| **Tokens per page**   | 258 (фиксировано, IMAGE modality)                        |
| **Embedded text**     | Gemini 3: извлекается бесплатно, не считается в tokens   |
| **Несколько PDF**     | До 1000 страниц суммарно                                 |
| **Structured output** | Не документировано явно, но нет ограничений              |
| **Batch API**         | Не документировано явно, но нет ограничений              |
| **Context caching**   | Не документировано явно                                  |
| **media_resolution**  | Поддерживается per-document (LOW/MEDIUM/HIGH/ULTRA_HIGH) |

**Ключевая особенность Gemini 3:** Embedded text в PDF извлекается нативно и предоставляется модели **бесплатно**. Это значит, что для текстовых PDF (не сканов) модель получает И визуальное представление страниц, И полный текст — без дополнительной стоимости за текстовые токены.

**Источник:** [Document Processing](https://ai.google.dev/gemini-api/docs/document-processing)

### 2.3 Расчёт стоимости для fancai

**Книга 500 страниц как PDF:**

- Image tokens: 500 × 258 = 129,000 tokens
- Input cost (3 Flash): 129K × $0.50/1M = **$0.065**
- Embedded text: **бесплатно** (Gemini 3)
- Output (extraction all entities): ~10K tokens × $3.00/1M = **$0.030**
- **Итого за 1 вызов: $0.095**

**Сравнение с chunk-based (текущий):**

| Подход                          | Input tokens           | Input cost | Output cost | Итого LLM          |
| ------------------------------- | ---------------------- | ---------- | ----------- | ------------------ |
| Chunk-based (55 calls, 3 Flash) | 1,375K                 | $0.688     | $0.330      | **$1.018**         |
| PDF whole-book (1 call)         | 129K image + text free | $0.065     | $0.030      | **$0.095**         |
| **Экономия**                    |                        |            |             | **-$0.923 (-91%)** |

**Внимание:** Это теоретический расчёт. Один вызов с 500-страничным PDF может не уместить ВСЕ entities в 64K max output. Но для 300-400 entities с описаниями ~30K tokens output — возможно укладывается.

### 2.4 EPUB → PDF конверсия

**Варианты:**

| Инструмент                    | Качество | Сохраняет главы?    | Python API?                                        |
| ----------------------------- | -------- | ------------------- | -------------------------------------------------- |
| **Calibre** (`ebook-convert`) | Высокое  | Да (оглавление)     | CLI: `ebook-convert book.epub book.pdf`            |
| **Pandoc**                    | Среднее  | Частично            | CLI: `pandoc book.epub -o book.pdf`                |
| **WeasyPrint**                | Высокое  | Нет (нужно вручную) | Python: `weasyprint.HTML(string=html).write_pdf()` |

**Рекомендация:** Calibre — лучший вариант, уже является стандартом для конверсии ebook-форматов. Установка: `apt-get install calibre` на сервере.

### 2.5 Конкретные сценарии

#### Сценарий A: Whole-book extraction одним вызовом

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="GOOGLE_API_KEY")

# Загрузить PDF через File API
pdf_file = client.files.upload(
    file="book.pdf",
    config={"mime_type": "application/pdf"}
)

# Извлечь ВСЕ entities одним вызовом
response = await client.aio.models.generate_content(
    model="gemini-3-flash-preview",
    contents=[
        types.Part.from_uri(pdf_file.uri, mime_type="application/pdf"),
        "Извлеки всех персонажей, локации и объекты из этой книги. "
        "Для каждого укажи: имя, тип, описание, главы упоминания."
    ],
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=BookEntitiesSchema,
        temperature=1.0,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    ),
)
```

**Преимущества:**

- Нет chunk boundaries → нет entity loss
- Один вызов вместо 55 → меньше latency overhead
- -91% стоимость input tokens

**Риски:**

- 64K max output может быть недостаточно для 400+ entities с полными описаниями
- Качество extraction из PDF vision vs из чистого текста — не протестировано
- Длинные книги (>1000 страниц) не поддерживаются

#### Сценарий B: PDF по главам

Конвертировать каждую главу в отдельный PDF, обрабатывать по главам. Сохраняет контроль над output size, но теряет cross-chapter context.

#### Сценарий C: Гибридный подход (РЕКОМЕНДУЕМЫЙ)

1. **Первый проход:** PDF whole-book для entity discovery (только имена + типы, без описаний)
   - Input: 129K tokens ($0.065)
   - Output: ~5K tokens (список имён) ($0.015)
   - Итого: **$0.08**

2. **Второй проход:** Chunk-based extraction с уже известным списком entities
   - Модель знает КАКИЕ entities искать → меньше пропусков
   - Prompt: "Из этого фрагмента извлеки описания для следующих entities: [список]"

3. **Итого:** $0.08 (discovery) + ~$0.50 (chunk extraction с hints) = **$0.58** vs текущие $1.02

### 2.6 Ограничения

1. **Gemini обрабатывает PDF как images.** Для текстовых PDF это избыточно — vision-processing дороже per token, хотя 258 tok/page фиксировано. Но Gemini 3 извлекает embedded text бесплатно — это компенсирует.

2. **50 MB лимит.** Большинство книг в PDF: 1-5 MB (текст) или 10-50 MB (с иллюстрациями). Укладывается.

3. **Не протестировано для художественной литературы.** Все примеры Google — бизнес-документы, invoices, contracts. Качество extraction из романа может отличаться.

### 2.7 Рекомендация для fancai

**Приоритет: P1 — Протестировать гибридный подход (Сценарий C)**

Потенциальная экономия: **-43% на LLM** ($0.58 vs $1.02) при улучшении качества (нет entity loss). Нужен A/B тест:

1. Конвертировать 3-5 тестовых книг EPUB→PDF через Calibre
2. Запустить whole-book entity discovery
3. Сравнить полноту entity списка с chunk-based extraction

---

## 3. Multimodal Embeddings (Entity Dedup)

### 3.1 Модели и цены

| Модель                       | Тип             | Dimensions | Max input | Цена/1M tokens | Batch        |
| ---------------------------- | --------------- | ---------- | --------- | -------------- | ------------ |
| `gemini-embedding-001`       | Текст           | 128-3072   | 2048 tok  | $0.15          | $0.075 (50%) |
| `gemini-embedding-2-preview` | Мультимодальный | 128-3072   | 8192 tok  | $0.20          | Нет          |

### 3.2 Качество для русского языка

**MMTEB (Massive Multilingual Text Embedding Benchmark):**

- Gemini Embedding 2: **score 69.9** — #1 на leaderboard (100+ языков)
- Улучшение **+5.09** над вторым местом (multilingual-e5-large-instruct)
- Сильная generalization для славянских языков (подтверждено на македонском — близкородственный)

**Вывод:** Gemini embeddings — лучшие в мире для мультиязычного текста по MMTEB. Для русского языка ожидается высокое качество.

**Источники:** [Gemini Embedding Paper](https://arxiv.org/html/2503.07891v1), [Google Blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)

### 3.3 Task Types

**gemini-embedding-001** (рекомендуется для dedup — стабильная, дешевле):

- `SEMANTIC_SIMILARITY` — для dedup пар
- `CLUSTERING` — для группировки entities по типу
- `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` — для поиска по entities
- `CLASSIFICATION` — для определения типа entity
- `FACT_VERIFICATION` — для проверки consistency

**gemini-embedding-2-preview**: task type через промпт-инструкцию, не через параметр.

### 3.4 Конкретный сценарий: Entity Dedup

**Текущий подход в fancai:**

1. fuzzy matching (thefuzz, `token_sort_ratio`, threshold 0.85)
2. Кандидаты → LLM semantic merge (5 calls × 5K input = 25K tokens)
3. Стоимость: 25K × $0.25/1M + 5K × $1.50/1M = **$0.014** (3.1 Flash-Lite)

**Embedding-based подход:**

```python
from google import genai
import numpy as np

client = genai.Client(api_key="GOOGLE_API_KEY")

# 1. Embed все entity names + краткие описания
entities = [
    "Князь Андрей Болконский — молодой офицер, сын старого князя",
    "Андрей — см. князь Болконский",
    "Болконский Андрей Николаевич — главный герой",
    "Наташа Ростова — молодая графиня",
    "Натали Ростова — невеста Андрея",
    # ... 300+ entities
]

result = client.models.embed_content(
    model="gemini-embedding-001",
    contents=entities,
    config={"task_type": "SEMANTIC_SIMILARITY", "output_dimensionality": 768}
)

embeddings = np.array([e.values for e in result.embeddings])

# 2. Cosine similarity matrix
from sklearn.metrics.pairwise import cosine_similarity
sim_matrix = cosine_similarity(embeddings)

# 3. Найти пары с similarity > 0.85
candidates = []
for i in range(len(entities)):
    for j in range(i+1, len(entities)):
        if sim_matrix[i][j] > 0.85:
            candidates.append((entities[i], entities[j], sim_matrix[i][j]))

# 4. Только кандидаты → LLM для финального решения
# Вместо 5 LLM calls проверяем только конкретные пары
```

**Расчёт стоимости (embedding-based dedup):**

- 300 entities × ~30 tokens = 9K tokens
- Embedding cost: 9K × $0.15/1M = **$0.00135**
- LLM verification (только кандидаты, ~2 calls): **$0.006**
- **Итого: $0.007** vs текущие **$0.014** (экономия 50%)

**Но главная ценность не в цене, а в качестве:**

- Embedding ловит семантическое сходство: "Наташа Ростова" ↔ "графиня Ростова" (fuzzy matching пропустит)
- Embedding ловит вариации русских имён: "Александр" ↔ "Саша" ↔ "Шурик"
- fuzzy matching ловит только текстовое сходство: "Болконский" ↔ "Балконский" (опечатка)

**Оптимальный подход — комбинация:**

1. fuzzy matching (быстрый, ловит опечатки)
2. embedding similarity (семантический, ловит вариации имён)
3. LLM verification (только для оставшихся спорных пар)

### 3.5 Другие применения embeddings в fancai

| Применение                     | Как                                                                    | Ценность                                                      |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Entity search**              | Embed все descriptions → similarity search по запросу пользователя     | Пользователь может искать "кто злодей?" → найдёт антагонистов |
| **Character consistency**      | Embed описания одного персонажа из разных глав → detect contradictions | QA для entity графа                                           |
| **Scene similarity**           | Embed описания сцен → кластеризация → "похожие сцены"                  | Группировка для иллюстраций                                   |
| **Cross-book recommendations** | Embed entities из разных книг → nearest neighbors                      | "Похожие персонажи в других книгах"                           |

### 3.6 Хранение embeddings

**Вариант 1: PostgreSQL + pgvector** (рекомендуется для fancai)

- Уже используем PostgreSQL
- `pip install pgvector`, `CREATE EXTENSION vector`
- Индекс: `CREATE INDEX ON entities USING hnsw (embedding vector_cosine_ops)`
- Подходит для <100K vectors

**Вариант 2: In-memory (numpy/scipy)**

- Для dedup одной книги (300-500 entities) — достаточно
- Не требует persistence

### 3.7 Рекомендация для fancai

**Приоритет: P1 — Embedding-based entity dedup**

1. Добавить `gemini-embedding-001` для pre-filtering dedup кандидатов
2. Combo: fuzzy matching + embedding similarity + LLM verification
3. Хранить embeddings в PostgreSQL (pgvector) для cross-book dedup в будущем
4. Стоимость: +$0.001/книга за embeddings
5. Ожидаемый результат: лучший recall для русских имён с вариациями

---

## 4. Thought Signatures

### 4.1 Что это

Зашифрованные представления внутреннего reasoning процесса Gemini. Позволяют модели сохранять контекст рассуждений между function calls и multi-turn interactions.

### 4.2 Когда обязательны

| Ситуация                                | Gemini 3.x                              | Gemini 2.5     |
| --------------------------------------- | --------------------------------------- | -------------- |
| **Function calling (current turn)**     | **ОБЯЗАТЕЛЬНО** — 400 ошибка без        | Не обязательно |
| **Multi-turn function calling**         | **ОБЯЗАТЕЛЬНО**                         | Не обязательно |
| **Single-turn generate_content**        | Не нужно                                | Не нужно       |
| **Structured output (response_schema)** | **Не нужно**                            | Не нужно       |
| **Text-only multi-turn**                | Рекомендовано (quality), не обязательно | Не нужно       |

**Ключевой вывод для fancai:** При текущей архитектуре (single-turn `generate_content` с `response_schema`) thought signatures **НЕ НУЖНЫ**.

### 4.3 Формат ошибки без signatures

```
400 Bad Request: Function call `get_weather` in the `2` content block
is missing a `thought_signature`
```

### 4.4 Как SDK обрабатывает автоматически

> "Thought signatures are handled automatically when you use the official Google Gen AI SDKs and append the full model response object directly to history."

**Когда нужно ручное управление:**

- REST API без SDK
- Ручное извлечение частей из conversation history
- Custom function call injection

**Dummy signature для тестирования:**

```python
# Если нужно инжектировать function call вручную:
thought_signature = "context_engineering_is_the_way_to_go"
```

### 4.5 Формат в API response

```json
{
  "parts": [
    {
      "functionCall": {
        "name": "get_weather",
        "args": { "location": "Paris" },
        "thoughtSignature": "encrypted_base64_string..."
      }
    }
  ]
}
```

При multi-turn: передать signature **exactly as received** в том же part structure.

### 4.6 Влияние на стоимость

Не документировано явно. Signatures — это метаданные, не tokens. Вероятно, не тарифицируются отдельно.

### 4.7 Конкретные сценарии для fancai

#### Текущая архитектура (single-turn, response_schema)

→ **Thought signatures НЕ нужны.** Миграция на Gemini 3 не требует изменений в этом аспекте.

#### Будущее: Function calling для extraction

Если перейти с response_schema на function calling:

```python
# Вместо response_schema → function declarations
tools = [types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="report_entity",
        description="Сообщить о найденном entity в тексте",
        parameters=EntitySchema
    )
])]
```

→ **Thought signatures ОБЯЗАТЕЛЬНЫ.** SDK обработает автоматически при использовании `client.chats.create()`.

#### Будущее: Multi-step extraction с уточнениями

```python
chat = client.chats.create(model="gemini-3-flash-preview")
# Turn 1: extract
response1 = chat.send_message("Извлеки entities из: [текст]")
# Turn 2: clarify (signatures автоматически через SDK)
response2 = chat.send_message("Уточни: персонаж X — это тот же Y?")
```

→ SDK обрабатывает автоматически.

### 4.8 Streaming edge case

При streaming: модель может вернуть thought signature в part с пустым text content. Нужно обрабатывать пустые text parts корректно.

### 4.9 Рекомендация для fancai

**Приоритет: P3 — Не блокирует миграцию**

1. **Сейчас:** Single-turn + response_schema → signatures не нужны
2. **При миграции:** Использовать google-genai SDK → signatures автоматические
3. **Задокументировать:** Если в будущем перейти на function calling или multi-turn, signatures станут обязательными для Gemini 3
4. **Не использовать REST API напрямую** для function calling — только через SDK

**Источник:** [Thought Signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)

---

## 5. Interactions API

### 5.1 Что это

Новый unified API (Beta), заменяющий `generate_content` для stateful и agentic use cases. Обеспечивает:

- **Server-side state management** — Google хранит conversation history
- **Background execution** — для long-running agent tasks
- **Context circulation** — автоматическое включение tool results в контекст
- **Unified interface** — одна точка входа для models и agents

### 5.2 Технические спецификации

| Параметр              | Значение                                                         |
| --------------------- | ---------------------------------------------------------------- |
| **Статус**            | **Beta** — breaking changes возможны                             |
| **SDK version**       | google-genai >= 1.55.0                                           |
| **Модели**            | gemini-3-flash-preview, gemini-2.5-flash-preview-tts, и др.      |
| **Агенты**            | deep-research-pro-preview                                        |
| **Persistence**       | `store=True` по умолчанию — interactions сохраняются server-side |
| **Background**        | `background=True` — только для agents                            |
| **Streaming**         | SSE events: content.delta, interaction.complete                  |
| **Structured output** | Поддерживается (response_format)                                 |
| **Function calling**  | Да, включая Remote MCP                                           |
| **Стоимость**         | Те же token prices, что и generate_content                       |

**Источники:** [Interactions API](https://ai.google.dev/gemini-api/docs/interactions), [Medium: Mete Atamel](https://medium.com/google-cloud/gemini-interactions-api-one-interface-for-models-and-agents-986ffb16021c)

### 5.3 Stateful vs Stateless

**Stateful (рекомендуемый):**

```python
# Turn 1
interaction1 = client.interactions.create(
    model="gemini-3-flash-preview",
    input="Вот текст главы 1: [текст]. Извлеки entities.",
)

# Turn 2 — модель помнит контекст главы 1
interaction2 = client.interactions.create(
    model="gemini-3-flash-preview",
    input="Вот глава 2: [текст]. Дополни граф entities.",
    previous_interaction_id=interaction1.id,  # ← server-side state
)
```

**Ключевое:** `previous_interaction_id` — модель автоматически получает весь предыдущий контекст. Не нужно передавать историю вручную.

**Stateless:** Вручную передаёшь массив messages (как generate_content).

### 5.4 Context Circulation

Для Gemini 3+ моделей: tool results (toolCall, toolResponse) автоматически включаются в контекст при использовании `previous_interaction_id`.

**Что это значит для fancai:**

- Turn 1: extract entities from chunk 1 → entities saved
- Turn 2: model automatically sees entities from turn 1 → extract from chunk 2 with context
- Turn 3: model sees entities from turns 1+2 → extract from chunk 3 with full context

**Проблема: стоимость растёт кумулятивно.** К чанку 50 модель видит ВСЕ предыдущие turns. Input tokens: 50 × 25K = 1.25M → выходит за пределы context window или стоит огромных денег.

### 5.5 Конкретные сценарии для fancai

#### Сценарий A: Stateful extraction по главам (ПРОБЛЕМНЫЙ)

```python
interaction = None
for chapter in chapters:
    interaction = client.interactions.create(
        model="gemini-3-flash-preview",
        input=f"Извлеки entities из главы: {chapter}",
        previous_interaction_id=interaction.id if interaction else None,
        config={"response_mime_type": "application/json",
                "response_schema": EntitiesSchema},
    )
    save_entities(interaction.outputs)
```

**Проблема:** К главе 50 контекст = 50 × 25K = **1.25M tokens**. Выходит за 1M context window. Даже если укладывается, стоимость: 1.25M × $0.50/1M = **$0.625 за последний вызов** (vs $0.013 в stateless).

**Вывод:** Stateful extraction всех глав — **непрактично** из-за кумулятивной стоимости.

#### Сценарий B: Entity refinement loop (УМЕРЕННО ПОЛЕЗНО)

```python
# Turn 1: extract
interaction1 = client.interactions.create(
    model="gemini-3-flash-preview",
    input=f"Извлеки entities: {chapter_text}",
)

# Turn 2: refine (модель помнит extraction)
interaction2 = client.interactions.create(
    model="gemini-3-flash-preview",
    input="Проверь: персонаж 'Князь' и 'Андрей Болконский' — один и тот же?",
    previous_interaction_id=interaction1.id,
)
```

**Ценность:** Уточнение в контексте оригинального текста без повторной отправки 25K tokens. Экономия: ~25K input tokens × $0.50/1M = $0.013 на уточнение.

#### Сценарий C: Tool-augmented extraction (ПЕРСПЕКТИВНО)

```python
# Модель вызывает наш tool для проверки entity в базе
check_entity_tool = {
    "type": "function",
    "name": "check_entity_exists",
    "description": "Проверить, есть ли entity в базе данных",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "type": {"type": "string", "enum": ["character", "location", "object"]}
        }
    }
}

interaction = client.interactions.create(
    model="gemini-3-flash-preview",
    input=f"Извлеки entities, проверяй каждый через check_entity_exists: {text}",
    tools=[check_entity_tool],
)

# Обработать function calls
for output in interaction.outputs:
    if output.type == "function_call":
        # Проверить в PostgreSQL
        exists = db.check_entity(output.args["name"])
        interaction = client.interactions.create(
            previous_interaction_id=interaction.id,
            input=[{
                "type": "function_result",
                "name": output.name,
                "call_id": output.id,
                "result": f"Entity {'exists' if exists else 'not found'}"
            }]
        )
```

**Ценность:** Модель может проверять entities в реальном времени, избегая дублирования. Но требует thought signatures (Gemini 3), которые SDK обрабатывает автоматически.

### 5.6 Сравнение: текущий pipeline vs Interactions

| Аспект           | Текущий (Celery + generate_content)  | Interactions API            |
| ---------------- | ------------------------------------ | --------------------------- |
| **State**        | Stateless, results в PostgreSQL      | Server-side, automatic      |
| **Context**      | Каждый чанк независим                | Кумулятивный (растёт)       |
| **Стоимость**    | Фиксированная per-chunk              | Растёт кумулятивно          |
| **Reliability**  | Celery retry, PostgreSQL persistence | Beta, breaking changes      |
| **Parallelism**  | Celery workers параллельно           | Sequential (stateful)       |
| **Tool calling** | Нет                                  | Да (function calling + MCP) |
| **Complexity**   | Простая                              | Выше (state management)     |

### 5.7 Ограничения

1. **Beta** — breaking changes с двухнедельным уведомлением
2. **Кумулятивная стоимость** — server-side state = все предыдущие токены в контексте
3. **Sequential** — stateful mode не поддерживает параллельную обработку
4. **Background execution** — только для agents (deep-research), не для models
5. **Remote MCP** — не работает с Gemini 3 (coming soon)
6. **Session timeout/TTL** — не документирован

### 5.8 Рекомендация для fancai

**Приоритет: P3 — Мониторить, не внедрять сейчас**

1. **Не заменять Celery pipeline.** Interactions API не подходит для batch processing 50 глав — кумулятивная стоимость и sequential processing убивают преимущества.

2. **Перспективно для Сценария B** (refinement loop) — уточнение entities в контексте без повторной отправки. Но можно реализовать через обычный multi-turn с generate_content.

3. **Перспективно для Сценария C** (tool-augmented) — если добавим function calling для проверки entities в базе. Но это архитектурное изменение, которое нужно обосновать отдельно.

4. **Ждать GA.** Beta API с breaking changes — риск для production pipeline.

---

## Сводная таблица рекомендаций

| Фича                   | Приоритет | Действие                     | Потенциал                         | Риск                                         |
| ---------------------- | --------- | ---------------------------- | --------------------------------- | -------------------------------------------- |
| **PDF-вход**           | **P1**    | A/B тест гибридного подхода  | -43% LLM cost, нет entity loss    | Качество extraction из PDF не протестировано |
| **Embeddings**         | **P1**    | Добавить в entity dedup      | Лучший recall для русских имён    | Минимальный ($0.001/книга)                   |
| **File Search**        | **P2**    | Entity consistency check     | +$0.23/книга за verification pass | Баг с ThinkingConfig                         |
| **Thought Signatures** | **P3**    | Документировать, не внедрять | Необходимо для function calling   | Нет (SDK автоматизирует)                     |
| **Interactions API**   | **P3**    | Мониторить GA                | Stateful processing               | Beta, кумулятивная стоимость                 |

---

## Источники

### File Search

- [File Search Documentation](https://ai.google.dev/gemini-api/docs/file-search)
- [File Search + Structured Output Bug](https://discuss.ai.google.dev/t/file-search-tool-in-combination-with-response-schema-not-working/111246)
- [File Search + ThinkingConfig Bug](https://discuss.ai.google.dev/t/file-search-structured-output-thinkingconfig-nil-response-and-no-grounding-metadata-on-gemini-3/127444)

### PDF / Document Processing

- [Document Processing](https://ai.google.dev/gemini-api/docs/document-processing)
- [Files API](https://ai.google.dev/gemini-api/docs/files)

### Embeddings

- [Gemini Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Gemini Embedding Paper (arXiv)](https://arxiv.org/html/2503.07891v1)
- [Google Blog: Gemini Embedding 2](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- [Pricing](https://ai.google.dev/pricing)

### Thought Signatures

- [Thought Signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### Interactions API

- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- [Google Blog: Interactions API](https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api/)
- [Medium: Mete Atamel — One Interface for Models and Agents](https://medium.com/google-cloud/gemini-interactions-api-one-interface-for-models-and-agents-986ffb16021c)
- [Google Developers Blog: Building Agents with ADK and Interactions](https://developers.googleblog.com/building-agents-with-the-adk-and-the-new-interactions-api/)
