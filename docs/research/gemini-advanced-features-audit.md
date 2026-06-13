# Аудит: Gemini API Advanced Features Research

**Дата аудита:** 2026-03-31
**Аудитор:** Claude Opus 4.6
**Аудируемый отчёт:** `docs/research/gemini-api-advanced-features-research.md` (2026-03-31)

## Сводка аудита

| Раздел                  | Ошибок | Неточностей | Устарело | Пропущено |
| ----------------------- | ------ | ----------- | -------- | --------- |
| File Search             | 0      | 1           | 0        | 3         |
| PDF Document Processing | 0      | 2           | 0        | 3         |
| Multimodal Embeddings   | 2      | 1           | 0        | 1         |
| Thought Signatures      | 0      | 0           | 0        | 2         |
| Interactions API        | 0      | 2           | 2        | 1         |
| **Итого**               | **2**  | **6**       | **2**    | **10**    |

**Общая оценка:** Отчёт высокого качества. Фактические ошибки минимальны (2 — обе в разделе embeddings). Основной дефицит — пропущенные возможности и нюансы, особенно в PDF-разделе (context window concern) и File Search (metadata filtering). Расчёты стоимости математически корректны, но основаны на оптимистичных оценках для нескольких параметров.

---

## Ошибки (требуют исправления)

### E-001: MMTEB score Gemini Embedding — 68.32, не 69.9

- **Раздел отчёта:** 3.2
- **Утверждение в отчёте:** "Gemini Embedding 2: **score 69.9** — #1 на leaderboard"
- **Фактическое значение:** MTEB(Multilingual) Task Mean = **68.32**. Второе место (multilingual-e5-large-instruct) = 63.23. Разница = +5.09 (эта часть верна).
- **Источник:** [Gemini Embedding Paper, Table 2](https://arxiv.org/html/2503.07891v1)
- **Влияние:** Не влияет на выводы (модель всё равно #1 с большим отрывом), но некорректная цифра подрывает доверие к расчётам. Возможная путаница с MTEB(Eng, v2) score 73.30.

### E-002: Embedding-2-Preview Batch API доступен

- **Раздел отчёта:** 3.1 (таблица)
- **Утверждение в отчёте:** `gemini-embedding-2-preview` Batch: "Нет"
- **Фактическое значение:** Batch API **доступен** по цене **$0.10/1M tokens** (50% скидка от стандартных $0.20/1M).
- **Источник:** [Gemini API Pricing](https://ai.google.dev/pricing), подтверждено [MetaCTO](https://www.metacto.com/blogs/the-true-cost-of-google-gemini-a-guide-to-api-pricing-and-integration), [TokenCost](https://tokencost.app/blog/gemini-embedding-2-pricing)
- **Влияние:** При batch processing книг (fancai use case) можно использовать embedding-2 с batch API. Расчёт стоимости entity dedup можно уменьшить вдвое при использовании batch.

---

## Неточности (требуют уточнения)

### I-001: Оценка 500K русских слов ≈ 700K tokens — заниженная

- **Раздел:** 1.4 (Сценарий A)
- **Проблема:** Коэффициент 1.4 tokens/word типичен для английского текста. Для русского текста с кириллическим алфавитом Gemini tokenizer обычно даёт 1.5–2.0 tokens/word из-за менее эффективной субтокенизации кириллицы.
- **Уточнение:** 500K русских слов ≈ **750K–1M tokens** (не 700K). Для точности рекомендуется протестировать на реальном тексте через `client.models.count_tokens()`.
- **Влияние:** Стоимость индексации File Search вырастает с $0.105 до $0.113–$0.150. Общая оценка Сценария A ($0.23) увеличивается до ~$0.26–$0.28. Не меняет приоритетность.

### I-002: Оценка output 10K tokens для whole-book extraction — заниженная

- **Раздел:** 2.3
- **Проблема:** 10K output tokens для полной extraction entities из 500-страничного романа. Для 300–400 entities с именами, типами, описаниями и списками глав реалистичнее 20–40K tokens.
- **Уточнение:** При 30K output: стоимость output = 30K × $3.00/1M = $0.090 (вместо $0.030). Итого single-call PDF: $0.065 + $0.090 = **$0.155** (вместо $0.095). Экономия остаётся значительной: -85% вместо -91%.
- **Влияние:** Не отменяет рекомендацию, но скорректированная экономия: **$0.155 vs $1.018 = -85%**, а не -91%.

### I-003: Embeddings для русских уменьшительных имён — не гарантировано

- **Раздел:** 3.4
- **Проблема:** Утверждение "Embedding ловит вариации русских имён: Александр ↔ Саша ↔ Шурик". Уменьшительные и ласкательные формы русских имён (Александр → Саша → Шурик) — это **культурное знание**, а не семантическое сходство. General-purpose embedding модели не обязательно кодируют эту связь.
- **Уточнение:** Пары вроде "Наташа Ростова ↔ графиня Ростова" будут работать (общая фамилия — сильный сигнал). Но "Александр ↔ Шурик" может НЕ иметь высокий cosine similarity в embedding space.
- **Рекомендация:** Перед внедрением — протестировать на конкретных парах из тестовых книг. Fuzzy matching останется необходим для подобных случаев.
- **Источник:** Gemini Embedding paper не включает бенчмарки для aliasing/diminutive resolution.

### I-004: Код Interactions API — несоответствие API-формату function results

- **Раздел:** 5.5 (Сценарий C)
- **Проблема:** Код использует формат:
  ```python
  input=[{"type": "function_result", "name": output.name, "call_id": output.id, "result": "..."}]
  ```
  Документация Interactions API показывает другой формат: `toolCall` / `toolResponse` блоки. Поля `type: "function_result"` и `call_id` могут не соответствовать актуальному SDK.
- **Уточнение:** Необходимо сверить с актуальной документацией SDK и [Interactions API guide](https://ai.google.dev/gemini-api/docs/interactions).
- **Влияние:** Код Сценария C не заработает as-is. Требуется корректировка.

### I-005: Гибридный подход — стоимость $0.50 за chunk extraction не обоснована

- **Раздел:** 2.5 (Сценарий C)
- **Проблема:** "$0.50 (chunk extraction с hints)" — цифра приведена без расчёта. Baseline chunk extraction стоит $1.018, и hints должны сократить output (меньше false positives), но не input. Если input остаётся 1,375K, а сокращается только output (с 110K до ~70K), то: $0.688 input + $0.210 output = $0.898. Чтобы получить $0.50, нужно сократить и input — например, меньше chunks или короче prompts.
- **Уточнение:** Скорее всего, автор предполагает сокращение числа chunks (только фрагменты с упомянутыми entities), но это не документировано в отчёте. Нужен детальный расчёт.

### I-006: SDK version >= 1.55.0 для Interactions API — не подтверждено

- **Раздел:** 5.2
- **Проблема:** "google-genai >= 1.55.0" — эта минимальная версия не подтверждена в официальной документации. Текущая актуальная версия SDK: ~1.67.0.
- **Источник:** [PyPI google-genai](https://pypi.org/project/google-genai/), [GitHub releases](https://github.com/googleapis/python-genai/releases)
- **Влияние:** Минимальное — fancai должен использовать актуальную версию SDK в любом случае.

---

## Устаревшая информация

### O-001: Gemini 3 Pro Preview — выведен из эксплуатации

- **Раздел:** Общий (упоминается в сводной таблице)
- **Что устарело:** Отчёт упоминает "Gemini 3 Flash и 3 Pro" как актуальные модели.
- **Актуальная информация:** **Gemini 3 Pro Preview был выведен 9 марта 2026** и заменён на **Gemini 3.1 Pro Preview**. Запросы к `gemini-3-pro-preview` перенаправляются на `gemini-3.1-pro-preview`.
- **Источник:** [Gemini API Changelog, March 9, 2026](https://ai.google.dev/gemini-api/docs/changelog)
- **Влияние:** Код примеров с `gemini-3-flash-preview` остаётся рабочим. Но для Pro-модели нужно использовать `gemini-3.1-pro-preview`.

### O-002: Interactions API — breaking change в названии поля

- **Раздел:** 5
- **Что устарело:** Отчёт не упоминает breaking change декабря 2025.
- **Актуальная информация:** 19 декабря 2025 поле `total_reasoning_tokens` переименовано в `total_thought_tokens` для согласованности с thinking model terminology.
- **Источник:** [Gemini API Changelog, December 19, 2025](https://ai.google.dev/gemini-api/docs/changelog)
- **Влияние:** Если fancai будет использовать Interactions API для мониторинга token usage, нужно использовать `total_thought_tokens`.

---

## Пропущенные возможности

### M-001: File Search — metadata filtering (ВЫСОКАЯ применимость)

- **Описание:** File Search поддерживает `metadata_filter` параметр (синтаксис [google.aip.dev/160](https://google.aip.dev/160)) для фильтрации по custom metadata. При загрузке файлов можно прикрепить `customMetadata[]`.
- **Применимость для fancai:** **Высокая.** Можно загрузить каждую главу как отдельный файл с metadata `chapter_number`, затем фильтровать запросы: "найди упоминания персонажа в главах 1-10" (spoiler-free entity search).
- **Источник:** [File Search API Reference](https://ai.google.dev/api/file-search) — параметры `metadata_filter`, `customMetadata[]` в `uploadToFileSearchStore`.
- **Рекомендация:** Добавить в Сценарий A/B — File Search с chapter-level metadata filtering значительно усиливает spoiler-free entity verification.

### M-002: PDF processing — context window concern для embedded text (ВЫСОКАЯ применимость)

- **Описание:** Gemini 3 извлекает embedded text из PDF **бесплатно** (не тарифицируется). Но модель всё равно **обрабатывает** этот текст, и он занимает place в context window. Для 500-страничной книги: 129K image tokens + ~700K–1M text tokens = **829K–1.1M total tokens**. При 1M context window это на пределе или за пределами.
- **Применимость для fancai:** **Критическая.** Отчёт предлагает whole-book PDF processing как P1, но для книг >350 страниц total context может превысить 1M window. Это ставит под вопрос single-call extraction для длинных книг.
- **Источник:** [Document Processing](https://ai.google.dev/gemini-api/docs/document-processing) — "native text extraction"; [Gemini 3 models](https://ai.google.dev/gemini-api/docs/models) — 1M input context.
- **Рекомендация:** Тестировать на книгах разной длины. Для >400 страниц может потребоваться split на части. Это снижает привлекательность single-call подхода.

### M-003: File API — 48-часовой TTL для uploaded PDF

- **Описание:** Файлы, загруженные через File API (`client.files.upload()`), автоматически удаляются через **48 часов**. Это отличается от File Search stores, которые хранятся бессрочно.
- **Применимость для fancai:** **Средняя.** При PDF-подходе (Раздел 2) каждый PDF нужно обработать в пределах 48 часов после загрузки. При повторной обработке — перезагрузить. Для batch pipeline это не проблема (обработка за минуты), но для отложенной обработки стоит учитывать.
- **Источник:** [Files API](https://ai.google.dev/gemini-api/docs/files) — "Files are automatically deleted after 48 hours."
- **Рекомендация:** Учесть в архитектуре pipeline — загрузка PDF непосредственно перед обработкой, не заранее.

### M-004: Embedding task types — неполный список

- **Описание:** Для `gemini-embedding-001` в отчёте перечислены 6 task types. В документации 8: дополнительно **CODE_RETRIEVAL_QUERY** и **QUESTION_ANSWERING**.
- **Применимость для fancai:** **Низкая.** CODE_RETRIEVAL_QUERY не релевантен. QUESTION_ANSWERING может быть полезен для entity search ("кто злодей?"), но SEMANTIC_SIMILARITY покрывает dedup use case.
- **Источник:** [Embeddings Documentation](https://ai.google.dev/gemini-api/docs/embeddings)

### M-005: Thought Signatures — второе dummy значение

- **Описание:** Помимо `"context_engineering_is_the_way_to_go"`, документация упоминает второй dummy: **`"skip_thought_signature_validator"`**.
- **Применимость для fancai:** **Низкая.** При использовании SDK dummy signatures не нужны. Полезно только для REST API тестирования.
- **Источник:** [Thought Signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)

### M-006: Thought Signatures обязательны для Image Generation (Gemini 3)

- **Описание:** Отчёт фокусируется на function calling, но thought signatures также **строго обязательны** для image generation на Gemini 3 ("Strict" enforcement, аналогично function calling).
- **Применимость для fancai:** **Средняя.** fancai использует FLUX.2 Klein для image generation (через OpenRouter), не Gemini native. Но если перейти на Gemini Imagen/native image gen — signatures будут обязательны.
- **Источник:** [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### M-007: Context Caching для PDF — повторные запросы к одному документу

- **Описание:** Gemini API поддерживает Context Caching, которое позволяет кэшировать загруженный контент (включая PDF) и переиспользовать в нескольких запросах со сниженной стоимостью. Для Gemini 3 Flash: cached input $0.05/1M (vs $0.50/1M standard) — **10x дешевле**.
- **Применимость для fancai:** **Высокая** для гибридного подхода (Сценарий C): загрузить PDF → cache → entity discovery (call 1) → targeted extraction (call 2+). Кэш устраняет повторную оплату 129K image tokens.
- **Источник:** [Gemini API Pricing](https://ai.google.dev/pricing) — секция Context Caching.
- **Рекомендация:** Интегрировать context caching в PDF pipeline. Для 2+ вызовов к одному PDF экономия significant.

### M-008: Обновления моделей марта 2026

- **Описание:** Ключевые обновления марта 2026, не упомянутые в отчёте:
  - **18 марта:** Возможность комбинировать built-in tools с custom function calling (влияет на File Search)
  - **10 марта:** Запуск Gemini Embedding 2 (multimodal) — модель вышла из "early preview"
  - **9 марта:** Shutdown Gemini 3 Pro Preview → Gemini 3.1 Pro Preview
  - **26 марта:** Gemini 3.1 Flash Live Preview для real-time audio
- **Применимость для fancai:** **Средняя.** Комбинирование File Search + function calling (18 марта) открывает Сценарий C из Interactions API, но через generate_content (без кумулятивной стоимости).
- **Источник:** [Gemini API Changelog](https://ai.google.dev/gemini-api/docs/changelog)

### M-009: File Search — комбинация с function calling (Gemini 3)

- **Описание:** Раздел 1.5 гласит: "Нельзя комбинировать с другими tools (Google Search, URL Context, Code Execution)." Это верно для перечисленных tools, но с **18 марта 2026** Gemini 3 модели **поддерживают** комбинацию File Search + custom function calling.
- **Применимость для fancai:** **Высокая.** Открывает возможность: File Search находит фрагменты → function call проверяет entity в PostgreSQL → модель принимает решение о merge. Всё в одном запросе, без Interactions API.
- **Источник:** [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3) — "Gemini 3 models support combining built-in tools with custom tools"; [Changelog March 18](https://ai.google.dev/gemini-api/docs/changelog).
- **Рекомендация:** Обновить Сценарий A/B в File Search разделе — File Search + function calling как alternative к Interactions API Сценарию C.

### M-010: Interactions API — parallel independent interactions

- **Описание:** Отчёт описывает Interactions API как "Sequential (stateful)" в сравнительной таблице. Однако **независимые** interactions (без `previous_interaction_id`) можно создавать **параллельно**. Stateful mode sequential — но для independent chunks parallelism возможен.
- **Применимость для fancai:** **Низкая.** Если каждый chunk — independent interaction, это эквивалентно `generate_content` с overhead. Преимущество Interactions API именно в statefulness, которая sequential.
- **Источник:** [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)

---

## Оценка рекомендаций

### R-001: "PDF-вход P1, -43% LLM cost"

- **Оценка:** **Частично верна — экономия реальна, но завышена, и есть непроверенные риски**
- **Обоснование:**
  1. **Экономия скорректированная:** При реалистичном output (30K вместо 10K tokens): single-call = $0.155, hybrid = ~$0.72–$0.90. Экономия = 12–30% (не 43% и не 91%). Отчёт использует оптимистичные output estimates.
  2. **Context window risk (M-002):** 500 страниц × 258 tok + embedded text → потенциально >1M tokens. Для длинных книг single-call может не работать.
  3. **Quality untested:** Отчёт корректно отмечает "не протестировано". Но дополнительный фактор: Gemini 3 получает и vision, и text — quality может быть **лучше** чем pure text (layout awareness).
  4. **Context caching (M-007):** Не учтена в расчётах. С caching гибридный подход ещё дешевле.
  5. **Calibre confirmation:** Calibre создаёт searchable PDF с embedded text — confirmed. Gemini сможет извлечь текст.
- **Источники:** [Document Processing](https://ai.google.dev/gemini-api/docs/document-processing), [Pricing](https://ai.google.dev/pricing)
- **Итоговая рекомендация:** P1 оправдан, но с оговорками. A/B тест ОБЯЗАТЕЛЕН. Начать с коротких книг (<300 стр) для proof of concept.

### R-002: "Embeddings P1 для entity dedup"

- **Оценка:** **Подтверждена — P1 оправдан по качеству, не по стоимости**
- **Обоснование:**
  1. **Стоимостная экономия мизерная:** $0.007 vs $0.014 = $0.007/книга. При 100 книгах/месяц = $0.70 экономии. Не аргумент.
  2. **Качество — главная ценность:** Embedding-based dedup ловит семантические пары (Наташа Ростова ↔ графиня Ростова), которые fuzzy matching пропускает.
  3. **НО: diminutive names (I-003)** — Александр ↔ Саша не гарантированно ловится embeddings. Fuzzy matching по-прежнему необходим.
  4. **Batch API доступен (E-002):** Embedding-2-preview с batch = $0.10/1M, ещё дешевле.
  5. **pgvector confirmed:** PostgreSQL 17 + pgvector 0.8.x — полностью совместимо.
- **Источники:** [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [Pricing](https://ai.google.dev/pricing), [pgvector GitHub](https://github.com/pgvector/pgvector)
- **Итоговая рекомендация:** P1 подтверждён. Комбинация fuzzy + embedding + LLM — оптимальный подход. Начать с embedding-001 (стабильная, batch $0.075/1M).

### R-003: "File Search P2 для consistency check"

- **Оценка:** **Подтверждена, но есть более дешёвая альтернатива**
- **Обоснование:**
  1. **$0.23/книга** — расчёт математически корректен (при завышенной оценке русских tokens, реально ~$0.26).
  2. **Metadata filtering (M-001)** — усиливает ценность: chapter-level filtering для spoiler-free verification.
  3. **Альтернатива:** PDF whole-book entity discovery (Сценарий C из Раздела 2) решает ту же задачу (обнаружение пропущенных entities) за $0.08 вместо $0.23. File Search ценнее для **targeted queries** ("найди ВСЕ описания конкретного персонажа"), а PDF — для **global discovery** ("найди ВСЕХ персонажей").
  4. **Баг с ThinkingConfig** — workaround (thinking=medium) подтверждён. Не blocker.
- **Источники:** [File Search](https://ai.google.dev/gemini-api/docs/file-search), [Forum bug report](https://discuss.ai.google.dev/t/file-search-structured-output-thinkingconfig-nil-response-and-no-grounding-metadata-on-gemini-3/127444)
- **Итоговая рекомендация:** P2 корректен. Использовать File Search для targeted entity verification, PDF для global discovery.

### R-004: "Thought Signatures P3 — не блокируют миграцию"

- **Оценка:** **Полностью подтверждена**
- **Обоснование:**
  1. Single-turn + response_schema → signatures **не нужны** — подтверждено документацией.
  2. SDK автоматизация — подтверждена цитатой из документации.
  3. **Edge case:** Если fancai перейдёт на Gemini 3 + File Search + function calling (M-009), signatures станут обязательны. Но SDK обработает автоматически.
  4. Structured output (response_schema) **не требует** signatures — подтверждено: enforcement только для function calling и image generation.
- **Источник:** [Thought Signatures](https://ai.google.dev/gemini-api/docs/thought-signatures), [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### R-005: "Interactions API P3 — мониторить, не внедрять"

- **Оценка:** **Полностью подтверждена**
- **Обоснование:**
  1. Кумулятивная стоимость для 50-chapter processing — **непрактична** (подтверждено анализом).
  2. Beta status с breaking changes (O-002 подтверждает реальность breaking changes).
  3. Сценарий C (tool-augmented extraction) теперь реализуем через **generate_content + File Search + function calling** (M-009) — без Interactions API и без кумулятивной стоимости.
  4. Единственный unique value — server-side state management, но для fancai PostgreSQL уже обеспечивает state.
- **Источник:** [Interactions API](https://ai.google.dev/gemini-api/docs/interactions), [Changelog](https://ai.google.dev/gemini-api/docs/changelog)

### R-006: Пропущена ли приоритетность?

- **Оценка:** **Context Caching заслуживает отдельного P1**
- **Обоснование:** Context Caching (M-007) не упомянут в отчёте вообще, но для fancai это **критическая оптимизация**:
  - Cached input для Gemini 3 Flash: $0.05/1M (vs $0.50 standard = **10x дешевле**)
  - PDF hybrid подход: cache PDF → call 1 (discovery) → call 2+ (targeted extraction) → все calls после первого используют cached tokens
  - Chunk-based extraction: cache system prompt + entity schema → все 55 calls дешевле
  - **Потенциальная экономия: 30–60% на текущем pipeline** (зависит от размера cacheable prefix)
- **Источник:** [Pricing](https://ai.google.dev/pricing)

---

## Пересчитанные стоимости

### Сценарий: PDF Whole-Book Extraction (скорректированный)

| Компонент               | Отчёт      | Скорректировано        | Разница              |
| ----------------------- | ---------- | ---------------------- | -------------------- |
| Image tokens (500 стр)  | 129K       | 129K                   | —                    |
| Input cost              | $0.065     | $0.065                 | —                    |
| Output tokens           | **10K**    | **30K** (реалистичнее) | +20K                 |
| Output cost             | **$0.030** | **$0.090**             | +$0.060              |
| **Итого single-call**   | **$0.095** | **$0.155**             | +$0.060              |
| vs chunk-based ($1.018) | -91%       | **-85%**               | Всё ещё значительная |

### Сценарий: PDF Whole-Book + Context Caching

| Компонент                    | Без cache  | С cache (2+ calls)             |
| ---------------------------- | ---------- | ------------------------------ |
| Input (first call)           | $0.065     | $0.065                         |
| Input (subsequent calls)     | $0.065     | $0.065 × 10% = $0.007 (cached) |
| Discovery call (output 5K)   | $0.015     | $0.015                         |
| Extraction call (output 30K) | $0.090     | $0.090                         |
| **Итого hybrid (2 calls)**   | **$0.235** | **$0.177**                     |

### Сценарий: Entity Dedup с Batch Embedding

| Компонент               | Отчёт      | С batch API         |
| ----------------------- | ---------- | ------------------- |
| Embedding cost (9K tok) | $0.00135   | **$0.000675** (50%) |
| LLM verification        | $0.006     | $0.006              |
| **Итого**               | **$0.007** | **$0.007**          |

Примечание: При использовании `gemini-embedding-001` batch ($0.075/1M): 9K × $0.075/1M = $0.000675. Экономия от batch минимальна при таких объёмах.

---

## Подтверждённые факты

Для полноты аудита — ключевые утверждения, **подтверждённые** документацией:

### File Search

- ✅ Max файл 100 MB
- ✅ Storage tiers: 1 GB / 10 GB / 100 GB / 1 TB
- ✅ TTL бессрочно (до ручного удаления или deprecation модели)
- ✅ Индексация $0.15/1M tokens
- ✅ Хранение бесплатно
- ✅ `max_tokens_per_chunk`, `max_overlap_tokens` — параметры корректны
- ✅ Structured output работает на Gemini 3 Flash и 3 Pro (3.1 Pro)
- ✅ Store < 20 GB — рекомендация из документации
- ✅ `client.file_search_stores.create()` — корректный API
- ✅ `upload_to_file_search_store()` — корректный метод
- ✅ Баг ThinkingConfig: medium работает, low/high — нет
- ✅ Математика расчётов Сценария A корректна (при принятых assumptions)

### PDF Document Processing

- ✅ Max 1000 страниц, 50 MB
- ✅ 258 tokens per page (IMAGE modality)
- ✅ Embedded text извлекается бесплатно (Gemini 3)
- ✅ media_resolution поддерживается per-document (LOW/MEDIUM/HIGH)
- ✅ Calibre создаёт searchable PDF с embedded text
- ✅ Код upload + generate_content — корректная структура

### Multimodal Embeddings

- ✅ gemini-embedding-001: $0.15/1M, batch $0.075/1M, max 2048 tokens
- ✅ gemini-embedding-2-preview: $0.20/1M, max 8192 tokens
- ✅ "+5.09 над вторым местом" — верная дельта (68.32 vs 63.23)
- ✅ embedding-2-preview: task type через промпт-инструкцию
- ✅ `client.models.embed_content()` — корректный API
- ✅ `.embeddings[].values` — корректный access pattern
- ✅ Batch embedding (массив текстов за один вызов) — поддерживается
- ✅ pgvector + PostgreSQL 17 — совместимо (pgvector 0.8.x)
- ✅ HNSW index синтаксис корректен

### Thought Signatures

- ✅ Function calling — обязательно для Gemini 3, 400 ошибка
- ✅ Single-turn generate_content — не нужно
- ✅ response_schema — не нужно
- ✅ Text-only multi-turn — рекомендовано, не обязательно
- ✅ SDK автоматизация — подтверждена
- ✅ Dummy signature `"context_engineering_is_the_way_to_go"` — из документации
- ✅ Streaming edge case — подтверждён

### Interactions API

- ✅ Status Beta
- ✅ `store=True` по умолчанию
- ✅ Background только для agents
- ✅ `client.interactions.create()` — корректный метод
- ✅ `previous_interaction_id` — корректное поле
- ✅ Кумулятивная стоимость анализ — корректный
- ✅ "Не подходит для batch processing" — верный вывод

---

## Итоговые рекомендации аудитора

### 1. Добавить Context Caching в roadmap как P1

Context Caching даёт **10x экономию** на cached tokens и synergizes с PDF и chunk-based подходами. Это самая крупная пропущенная оптимизация в отчёте.

### 2. Скорректировать расчёт PDF-экономии

Использовать 30K output tokens вместо 10K для реалистичной оценки. Экономия -85% вместо -91% — всё ещё значительная, но expectations должны быть calibrated.

### 3. Тестировать PDF context window limits

Перед внедрением PDF whole-book: проверить, как Gemini обрабатывает 500-страничный PDF с embedded text. Если total tokens (image + text) > 1M, потребуется split strategy.

### 4. Исправить MMTEB score: 68.32 (не 69.9)

Косметическое, но подрывает доверие к числам.

### 5. Обновить embedding-2-preview batch: доступен ($0.10/1M)

Открывает batch processing для embedding-2 multimodal use cases.

### 6. Использовать File Search + Function Calling вместо Interactions API

С 18 марта Gemini 3 поддерживает комбинацию File Search + custom function calling. Это реализует Interactions Сценарий C без кумулятивной стоимости и Beta рисков.

### 7. Исследовать metadata filtering в File Search

Chapter-level metadata + filtering = spoiler-free entity verification из коробки. Высокая ценность для fancai.

### 8. Протестировать embeddings на русских literary names

Перед внедрением embedding dedup: benchmark cosine similarity для реальных пар из тестовых книг (включая уменьшительные имена, титулы, прозвища).

### 9. Использовать `count_tokens()` для точной оценки русского текста

Вместо грубых оценок words → tokens, протестировать на реальных книгах через Gemini API `count_tokens()` для точного планирования стоимости.

### 10. Мониторить Gemini 3.1 Flash-Lite для cost optimization

Gemini 3.1 Flash-Lite Preview ($0.10/1M input, $0.40/1M output — по ценам 2.5 Flash-Lite) поддерживает File Search. Для entity extraction может быть достаточно при значительной экономии.
