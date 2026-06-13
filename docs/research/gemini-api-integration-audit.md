# Аудит: Gemini API Integration Research v2

**Дата аудита:** 2026-03-31
**Аудитор:** Claude Opus 4.6
**Отчёт:** `docs/research/gemini-api-direct-integration-research.md` (v2, 2026-03-30)
**Методология:** 5 параллельных исследовательских агентов, 20+ URL первоисточников, ручной пересчёт стоимости

---

## Сводка аудита

| Категория | Ошибок | Неточностей | Устарело | Пропущено |
| --------- | ------ | ----------- | -------- | --------- |
| Цены      | 3      | 1           | 0        | 0         |
| Модели    | 0      | 2           | 0        | 0         |
| Caching   | 2      | 1           | 0        | 1         |
| Batch     | 0      | 0           | 0        | 0         |
| Images    | 1      | 2           | 1        | 0         |
| SDK       | 0      | 0           | 2        | 0         |
| Расчёты   | 1      | 1           | 0        | 0         |
| Thinking  | 1      | 0           | 0        | 0         |
| Другое    | 0      | 0           | 1        | 8         |
| **Итого** | **8**  | **7**       | **4**    | **9**     |

**Общая оценка:** Отчёт качественный — из ~120 проверенных утверждений ~100 подтверждены. Однако 8 ошибок включают 2 критических (Executive Summary расчёты, минимумы кэширования), которые влияют на ключевые выводы.

---

## Ошибки (требуют исправления)

### E-001: Executive Summary — расчёты стоимости не совпадают с детальными

- **Раздел отчёта:** 1 (Executive Summary, таблица строки 26-33)
- **Утверждение в отчёте:** Сценарий 2: LLM=$0.83, Total=$2.43; Сценарий 3: LLM=$0.83, Total=$5.33; Сценарий 4: LLM=$0.42, Total=$2.67; Сценарий 5: LLM=$0.40, Total=$2.65
- **Фактическое значение:** Детальные расчёты в разделе 10 дают: Сц.2: LLM=$1.26, Total=$2.86; Сц.3: LLM=$1.26, Total=$5.76; Сц.4: LLM=$0.63, Total=$2.83; Сц.5: LLM=$0.61, Total=$2.81
- **Источник:** Пересчёт по формулам раздела 10 с ценами из раздела 2
- **Влияние:** **КРИТИЧНО.** Executive Summary систематически занижает LLM-стоимость для сценариев 2-5 на $0.16-$0.43. Вероятно, таблица Executive Summary — это черновик из ранней версии, не обновлённый после пересчёта с 3.1 Flash-Lite (дороже 2.5 Flash-Lite). Сводная таблица 10.8 содержит **правильные** числа.

**Исправленная таблица Executive Summary:**

| Сценарий                                | LLM       | Images | Итого     | vs Baseline |
| --------------------------------------- | --------- | ------ | --------- | ----------- |
| 1. OpenRouter (текущий, 2.5 Flash)      | $0.96     | $1.60  | **$2.56** | Baseline    |
| 2. Direct 3 Flash + minimal thinking    | **$1.26** | $1.60  | **$2.86** | **+12%**    |
| 3. Direct 3 Flash + NB2 images          | **$1.26** | $4.50  | **$5.76** | +125%       |
| 4. Direct 3 Flash + batch + NB2 batch   | **$0.63** | $2.20  | **$2.83** | **+11%**    |
| 5. Direct + batch + caching + NB2 batch | **$0.61** | $2.20  | **$2.81** | +10%        |
| 6. Free tier LLM + FLUX.2 images        | $0.00     | $1.60  | **$1.60** | -38%        |

> **Ключевой вывод не меняется:** Batch API (Сц.4) по-прежнему оптимален — лучшее качество за +$0.27 (+11%) к baseline. Но разница +11%, а не -5% как заявлено в Executive Summary.

---

### E-002: Скорость NB2 — 1-3 сек завышена

- **Раздел отчёта:** 8.1
- **Утверждение в отчёте:** "Скорость: ~1-3 сек (1K)"
- **Фактическое значение:** Через API реально **4-15 секунд** для 1K разрешения в зависимости от нагрузки серверов. 1-3 сек фиксировались только на локальном GPU (A10G), не через API.
- **Источник:** API тесты, Google benchmark data (4-6 сек при низкой нагрузке)
- **Влияние:** Среднее. Не влияет на стоимость, но влияет на ожидания по latency при real-time использовании. Для batch pipeline fancai — некритично.

---

### E-003: Минимальные пороги кэширования — неверное деление по поколению

- **Раздел отчёта:** 5.1
- **Утверждение в отчёте:** "Gemini 3.x: 4,096 токенов, Gemini 2.5: 2,048 токенов"
- **Фактическое значение:** Деление по **тиру**, не по поколению:
  - Flash-модели (3 Flash, 2.5 Flash): **1,024 токенов**
  - Pro-модели (3.1 Pro, 2.5 Pro): **4,096 токенов**
- **Источник:** [Context Caching](https://ai.google.dev/gemini-api/docs/caching), [Caching API](https://ai.google.dev/api/caching)
- **Влияние:** **КРИТИЧНО.** Вся секция 5.3 ("промпт + schema < 4096") базируется на ошибочном пороге. Для 3 Flash (primary для fancai) минимум = **1,024**, не 4,096. TSA prompt (~1000 tokens) + system instruction + schema ≈ 1000-1200 токенов — **уже выше или на границе 1,024**. Few-shot примеры (~3000 токенов) полезны для качества, но **не обязательны для достижения минимума кэширования**.

---

### E-004: thinking_budget диапазоны некорректно обобщены

- **Раздел отчёта:** 4.2
- **Утверждение в отчёте:** "128-24576: фиксированный бюджет"
- **Фактическое значение:** Диапазоны различаются по моделям:
  - 2.5 Pro: **128-32768** (нельзя 0)
  - 2.5 Flash: **0-24576** (можно 0 = OFF)
  - 2.5 Flash-Lite: **0-24576** (можно 0 = OFF)
- **Источник:** [Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- **Влияние:** Низкое (2.5 модели deprecated), но для legacy fallback важно знать, что 2.5 Pro не поддерживает thinking_budget=0.

---

### E-005: Цена FLUX.2 Klein завышена

- **Раздел отчёта:** 2.3
- **Утверждение в отчёте:** "FLUX.2 Klein (OpenRouter): $0.016/img (1K)"
- **Фактическое значение:** **$0.014** за первый мегапиксель (1024×1024)
- **Источник:** [OpenRouter FLUX.2 Klein](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- **Влияние:** Среднее. Завышение на 14%. Baseline стоимость 100 images: $1.40 (не $1.60). Это влияет на все сравнения с baseline.

---

### E-006: Imagen 4 Fast 2K — цена не дифференцируется по разрешению

- **Раздел отчёта:** 2.3
- **Утверждение в отчёте:** "Imagen 4 Fast: 1K=$0.020, 2K=$0.040"
- **Фактическое значение:** Imagen 4 Fast = **$0.020 за любое разрешение**. $0.040 — это цена **Imagen 4 Standard** (другая модель).
- **Источник:** [Pricing](https://ai.google.dev/pricing)
- **Влияние:** Низкое (Imagen 4 deprecated 24 июня 2026, не рекомендуется для fancai).

---

### E-007: Стоимость хранения кэша — не универсальная

- **Раздел отчёта:** 5 (подразумевается $1.00/1M/hour)
- **Утверждение в отчёте:** Расчёт хранения кэша в сценарии 5 использует единую цену
- **Фактическое значение:**
  - 3.1 Flash-Lite: **$1.00/1M tokens/hour**
  - 3 Flash, 2.5 Flash: **$4.50/1M tokens/hour**
  - 3.1 Pro, 2.5 Pro: **$4.50/1M tokens/hour**
- **Источник:** [Pricing](https://ai.google.dev/pricing)
- **Влияние:** Среднее. Для 3 Flash (primary для extraction) хранение кэша в 4.5× дороже, чем показано. Сценарий 5: cache storage 4K tok × $4.50/1M/hour ≈ **$0.018/hour** (не $0.004). Впрочем, при обработке одной книги за ~30 мин это +$0.009 — пренебрежимо.

---

### E-008: Сценарий 1 — output tokens для Extraction некорректно документированы

- **Раздел отчёта:** 10.2
- **Утверждение в отчёте:** "192K\* output tokens" для Extraction в сценарии 1 (с пометкой "с thinking tokens")
- **Фактическое значение:** Расчёт: 55 вызовов × 2K output = 110K. Отчёт добавляет ~82K thinking tokens, но не показывает формулу. При dynamic thinking для 2.5 Flash количество thinking tokens непредсказуемо — 82K это **предположение**, не расчёт.
- **Источник:** Формулы раздела 10.1
- **Влияние:** Низкое. Итоговая стоимость $0.893 математически корректна при 192K, но входные допущения о thinking tokens не обоснованы.

---

## Неточности (требуют уточнения)

### I-001: Статус 2.5 моделей — "GA" vs "Stable"

- **Раздел:** 2.2
- **Проблема:** Отчёт использует термин "GA" для 2.5 моделей
- **Уточнение:** Google использует термин **"Stable"**, не "GA". Функционально эквивалентно, но терминология отличается.
- **Источник:** [Models](https://ai.google.dev/gemini-api/docs/models)

### I-002: ELO Claude Opus 4.6 завышен на 1-3 пункта

- **Раздел:** 3.1
- **Проблема:** Отчёт: ELO = 1504
- **Уточнение:** Фактически **1501-1503** (1502 thinking, 1501 standard). ELO обновляется ежедневно, но 1504 не подтверждается ни одним срезом.
- **Источник:** [Arena Leaderboard](https://arena.ai/leaderboard/text)

### I-003: Box Blog — диапазон точности завышен

- **Раздел:** 1, 3.3
- **Проблема:** Отчёт: "+10-15% accuracy"
- **Уточнение:** Box фиксирует +10pp (PDFs), +9pp (images), +13pp (multi-field). Верхняя граница **13pp**, не 15%. Корректный диапазон: **+9-13pp**.
- **Источник:** [Box Blog](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)

### I-004: OFF ≠ BLOCK_NONE

- **Раздел:** 8.3, 11.3
- **Проблема:** Отчёт не различает OFF и BLOCK_NONE
- **Уточнение:** Это **разные** значения:
  - `OFF` — фильтр полностью выключен, safety ratings **не возвращаются**
  - `BLOCK_NONE` — фильтр работает, не блокирует, safety ratings **возвращаются** (полезно для мониторинга)
  - Рекомендация для fancai: использовать `BLOCK_NONE` вместо `OFF` для сохранения visibility
- **Источник:** [Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings)

### I-005: Список finish_reason для images неполный

- **Раздел:** 8.4
- **Проблема:** Отчёт перечисляет 3 значения: IMAGE_SAFETY, SAFETY, PROHIBITED_CONTENT
- **Уточнение:** Полный список включает ещё: `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION`, `IMAGE_OTHER`, `NO_IMAGE`. Для корректного fallback нужно обрабатывать все 7 значений.
- **Источник:** Vertex AI API proto, [Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings)

### I-006: OpenRouter 5.5% комиссия не упомянута

- **Раздел:** 2.4
- **Проблема:** Отчёт: "OpenRouter передаёт цены без markup (0%)"
- **Уточнение:** Верно для токенов, но OpenRouter взимает **5.5% платформенную комиссию** при пополнении кредитов картой (5% при BYOK). Реальная стоимость через OpenRouter на 5-5.5% выше, чем указанные цены.
- **Источник:** [OpenRouter Pricing](https://openrouter.ai/pricing)

### I-007: Секция 5.3 — проблема "< 4096" может не существовать

- **Раздел:** 5.3
- **Проблема:** "промпт + schema < 4096 для 3.x — нужны few-shot примеры"
- **Уточнение:** Для 3 Flash минимум = **1,024** (не 4,096, см. E-003). TSA prompt (~737 tok) + system instruction (~200 tok) + schema (~300 tok) ≈ 1,237 токенов — **выше 1,024**. Few-shot примеры не обязательны для достижения минимума кэширования, хотя полезны для качества.
- **Источник:** [Caching](https://ai.google.dev/gemini-api/docs/caching)

---

## Устаревшая информация

### O-001: Issue #699 (Pydantic defaults) — закрыт

- **Раздел:** 7.2
- **Что устарело:** "Pydantic fields с `default=` могут вызвать 400 ошибку (Issue #699)"
- **Актуальная информация:** Issue **закрыт 23 апреля 2025** (коммит 48f8256). В SDK v1.69.0 проблема решена. Pydantic defaults больше не являются ограничением.
- **Источник:** [Issue #699](https://github.com/googleapis/python-genai/issues/699)

### O-002: anyOf "не поддерживается" — поддерживается с ноября 2025

- **Раздел:** 7.2
- **Что устарело:** "`anyOf` — не документирован, вероятно не поддерживается"
- **Актуальная информация:** В ноябре 2025 Gemini API добавил поддержку `anyOf`, `$defs`, `$ref`. На уровне API `anyOf` поддерживается. Однако python-genai SDK может иметь клиентскую валидацию, блокирующую некоторые конструкции (Issue #1815 о `additionalProperties`).
- **Источник:** Gemini API changelog (ноябрь 2025)

### O-003: AI Arena #1 — позиция не гарантирована

- **Раздел:** 8.1
- **Что устарело:** "NB2 — #1 на AI Arena (text-to-image)"
- **Актуальная информация:** На Arena.ai NB2 по-прежнему лидирует (Elo 1280 vs GPT Image 1.5: 1248). Но на Artificial Analysis Image Arena GPT Image 1.5 (high) обогнал NB2 (1265 vs 1258). Позиция зависит от конкретного leaderboard.
- **Источник:** [Arena.ai](https://arena.ai/leaderboard/text-to-image), [Artificial Analysis](https://artificialanalysis.ai/)

### O-004: LocalTokenizer — частично исправлен

- **Раздел:** 11.1
- **Что устарело:** "LocalTokenizer — только для 2.5 моделей (не 3.x!)"
- **Актуальная информация:**
  - Issue #1784 (gemini-3-pro-preview): **ЗАКРЫТ** 17.01.2026 — исправлен маппингом на tokenizer 2.5
  - Issue #1972 (gemini-3-flash-preview): **ОТКРЫТ** — PR #1973 создан, в работе
  - Для 3.1 Pro LocalTokenizer уже работает, для 3 Flash — ожидается
- **Источник:** [Issue #1784](https://github.com/googleapis/python-genai/issues/1784), [Issue #1972](https://github.com/googleapis/python-genai/issues/1972)

---

## Пропущенные возможности

### M-001: File Search (встроенный managed RAG)

- **Описание:** Полностью управляемая RAG-система от Google. Загружаешь файлы — Gemini сам делает chunking, embedding, indexing и semantic retrieval. Автоматические цитирования. Поддерживает PDF, DOCX, TXT, JSON, код. **НЕ поддерживает EPUB.** Стоимость: $0.15/1M токенов на индексацию.
- **Применимость для fancai:** Средняя. Не работает с EPUB. Полезно при будущей поддержке PDF-формата — устраняет ручной чанкинг.
- **Источник:** [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- **Рекомендация:** Не блокирующе. Учесть при добавлении PDF-поддержки.

### M-002: PDF-вход (целые книги без чанкинга)

- **Описание:** Gemini обрабатывает PDF до 1000 страниц и 50 MB. Каждая страница = 258 tokens. 500-страничная книга = 129K tokens input — укладывается в 1M context.
- **Применимость для fancai:** Средняя. Потенциально решает проблему entity loss at chunk boundaries (текущий 15% overlap). Но требует конверсии EPUB→PDF и стоимость input возрастает (вся книга vs один чанк).
- **Источник:** [Document Processing](https://ai.google.dev/gemini-api/docs/document-processing)
- **Рекомендация:** Исследовать качество extraction из PDF vs текстовых чанков. Может стать архитектурным прорывом для entity consistency.

### M-003: Аудио-вход (аудиокниги)

- **Описание:** Gemini принимает аудио: WAV, MP3, AIFF, AAC, OGG, FLAC. Макс 9.5 часов в одном промпте. Токенизация: 32 tokens/sec (~1920 tok/min). Стоимость обработки аудиокниги (~9 часов): ~1M input tokens = $0.50 (3 Flash).
- **Применимость для fancai:** Средняя. Новый формат контента — upload аудиокниги, extraction entities и описаний из аудио. 9.5 часов покрывает большинство аудиокниг.
- **Источник:** [Audio](https://ai.google.dev/gemini-api/docs/audio)
- **Рекомендация:** Перспективная фича для v2. Добавить в backlog.

### M-004: Multimodal Embeddings (для entity dedup)

- **Описание:** `gemini-embedding-2-preview` — первая multimodal embedding модель Google. Текст + изображения + видео + аудио + PDF. Размерности: 128-3072 (рекомендовано 768/1536/3072). Выпущена 10 марта 2026.
- **Применимость для fancai:** Средняя. Текущий entity dedup: fuzzy matching (0.85) + LLM semantic merge. Embedding-based similarity мог бы заменить первичный отсев: embed имена и описания, найти семантически близкие пары. Особенно полезно для русских имён с вариациями (Александр / Саша / Шурик).
- **Источник:** [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- **Рекомендация:** Тестировать embedding-based pre-filtering → LLM verification. Может быть дешевле и быстрее текущего подхода.

### M-005: Thought Signatures (для Gemini 3)

- **Описание:** Зашифрованные представления внутреннего reasoning модели. Для Gemini 3: **ОБЯЗАТЕЛЬНЫ при function calling** (без них — 400 ошибка). SDK обрабатывает автоматически при chat-интерфейсе. При REST API или модификации истории — ручное управление.
- **Применимость для fancai:** Средняя. Текущий pipeline — single-turn, thought signatures не нужны. Но при переходе на multi-turn extraction (уточняющие вопросы при низком confidence) или function calling — станут критичны.
- **Источник:** [Thought Signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
- **Рекомендация:** Добавить в отчёт как "учесть при архитектурных изменениях".

### M-006: Interactions API (stateful agent interface)

- **Описание:** Новый unified API (бета), заменяющий generate_content для agentic use cases. Server-side state management, background execution, remote MCP, tool context circulation. Gemini 3+ поддерживает "context circulation" — автоматическое включение tool results.
- **Применимость для fancai:** Средняя. Мог бы упростить multi-step extraction с server-side state, убирая передачу полного контекста каждый раз.
- **Источник:** [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- **Рекомендация:** Мониторить GA-статус. Не для немедленного использования (бета).

### M-007: Grounding — 5000 бесплатных промптов/месяц

- **Описание:** Отчёт отмечает Grounding как "не актуально" ($14/1000), но не упоминает бесплатный tier: **5000 prompts/month** для grounding.
- **Применимость для fancai:** Низкая (extraction не требует web search). Но полезно знать.
- **Источник:** [Pricing](https://ai.google.dev/pricing)
- **Рекомендация:** Упомянуть в отчёте для полноты.

### M-008: Built-in Tools + Function Calling комбинация (18 марта 2026)

- **Описание:** Новая возможность: использование Google Search, URL Context, Code Execution вместе с custom function calling в одном запросе. Ранее невозможно.
- **Применимость для fancai:** Низкая. fancai использует structured output, не function calling.
- **Источник:** [Changelog](https://ai.google.dev/gemini-api/docs/changelog) (18 марта 2026)
- **Рекомендация:** Не приоритет.

### M-009: SDK v1.68.0 — fix для typing-extensions (Python 3.10-3.11)

- **Описание:** Версия 1.68.0 (18 марта 2026) исправила баг с typing-extensions для Python 3.10-3.11. Также добавлены signature fields для thought signatures, Google Maps integration.
- **Применимость для fancai:** Высокая, если fancai на Python 3.10-3.11. **Python 3.12** (из CLAUDE.md) — не затронут, но стоит зафиксировать минимальную версию SDK.
- **Источник:** [PyPI google-genai](https://pypi.org/project/google-genai/), [GitHub Releases](https://github.com/googleapis/python-genai/releases)
- **Рекомендация:** Использовать google-genai>=1.69.0 (как в отчёте). Зафиксировать в requirements.txt.

---

## Оценка рекомендаций

### R-001: "Gemini 3 Flash для extraction"

- **Оценка:** **Подтверждена с оговоркой**
- **Обоснование:** Box Blog подтверждает +9-13pp для structured extraction (не +10-15% как в отчёте). Бенчмарк — на документах (PDFs, invoices), наша задача — русская художественная литература. Результаты **вероятно переносимы** (обе задачи: multi-field extraction из текста), но прямых данных по fiction нет. A/B тест (шаг 8 плана) — правильный подход.
- **Источник:** [Box Blog](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)

### R-002: "temperature=1.0 обязательна для Gemini 3"

- **Оценка:** **Подтверждена — рекомендация, не жёсткое требование**
- **Обоснование:** Google: "we **strongly recommend** keeping temperature at 1.0". Понижение **может** вызвать looping, не гарантированно вызовет. Для structured output с JSON Schema температура менее критична — схема ограничивает пространство ответов. Отчёт корректно отмечает это, но маркирует как "ОБЯЗАТЕЛЬНО", что преувеличивает.
- **Источник:** [Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### R-003: "NB2 primary, FLUX.2 fallback"

- **Оценка:** **Подтверждена, но скорость завышена**
- **Обоснование:** Архитектура NB2→FLUX.2 fallback обоснована. Данных о реальном проценте safety блокировок для книжных иллюстраций нет — нужен собственный A/B тест. Скорость NB2 через API = 4-15 сек (не 1-3 как в отчёте). Для batch pipeline это некритично.
- **Источник:** [Image Generation](https://ai.google.dev/gemini-api/docs/image-generation)

### R-004: "Batch API — единственный способ удержать цену"

- **Оценка:** **Подтверждена**
- **Обоснование:** Без batch NB2 images стоят $4.50 vs $2.20 batch. Альтернативные оптимизации (implicit caching, lower resolution) дают меньшую экономию. Batch 50% — действительно основной рычаг. Дополнительная оптимизация: снизить NB2 разрешение до 0.5K (в iframe reader достаточно).
- **Источник:** [Pricing](https://ai.google.dev/pricing)

### R-005: "Fine-tuning недоступен в AI Studio"

- **Оценка:** **Подтверждена**
- **Обоснование:** Документация: "we no longer have a model available which supports fine-tuning in the Gemini API or AI Studio." Distillation доступна в Vertex AI (preview), но complexity и стоимость не оправданы для fancai.
- **Источник:** [Model Tuning](https://ai.google.dev/gemini-api/docs/model-tuning)

### R-006: Fallback chain — 3 Flash → 3.1 Flash-Lite → OpenRouter 2.5 Flash

- **Оценка:** **Подтверждена с замечанием**
- **Обоснование:** Логичная цепочка по цене/качеству. Замечание: 2.5 Flash deprecated 17 июня 2026, после этой даты emergency fallback через OpenRouter потеряет эту модель. Нужно запланировать замену emergency fallback на 3.1 Flash-Lite через OpenRouter (если доступен).
- **Источник:** [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

---

## Пересчитанные стоимости

### Исправленная сводная таблица (Раздел 10.8)

Сводная таблица 10.8 содержит **правильные** числа. Исправления нужны только в Executive Summary (раздел 1).

### Пересчёт с исправленной ценой FLUX.2 ($0.014 вместо $0.016)

| #   | Сценарий                      | LLM   | Images      | Итого     | vs Baseline |
| --- | ----------------------------- | ----- | ----------- | --------- | ----------- |
| 1   | OpenRouter 2.5 (текущий)      | $0.96 | **$1.40**\* | **$2.36** | Baseline    |
| 2   | Direct 3 Flash + FLUX         | $1.26 | **$1.40**\* | **$2.66** | +13%        |
| 4   | **Batch 3 Flash + NB2 batch** | $0.63 | $2.20       | **$2.83** | +20%        |
| 6   | Free LLM + FLUX               | $0.00 | **$1.40**\* | **$1.40** | -41%        |

\*FLUX.2 Klein: 100 × $0.014 = $1.40 (не $1.60)

> **Влияние на вывод:** С корректной ценой FLUX.2 baseline снижается до $2.36, и рост сценария 4 (+$0.47, +20%) выглядит значительнее, чем заявленные +10%. Но абсолютная разница $0.47/книга по-прежнему приемлема для Premium.

### Пересчёт с OpenRouter 5.5% комиссией (реальная стоимость текущего baseline)

Текущий пайплайн через OpenRouter фактически стоит: $2.36 × 1.055 = **$2.49** (с комиссией пополнения). Direct API не имеет комиссии. Реальная экономия сценария 4 vs фактического baseline: $2.83 vs $2.49 = +$0.34 (+14%).

---

## Подтверждённые утверждения (выборка)

Для полноты аудита — ключевые утверждения, подтверждённые без замечаний:

- ✅ Все Model IDs (8/8) — точны
- ✅ Все deprecation dates (5/5) — точны
- ✅ Цены 3.x текстовых моделей (15/15) — точны
- ✅ Цены 2.5 моделей (9/9) — точны
- ✅ Цены NB2 по разрешениям (5/5) — точны
- ✅ Context windows и max output (8/8) — точны
- ✅ Thinking levels для 3.x (4 уровня) — точны
- ✅ Thinking defaults по моделям — точны
- ✅ Thinking_budget и thinking_level нельзя комбинировать — точно
- ✅ Batch API 50% на input+output — точно
- ✅ Batch + Caching совместимы, скидки не складываются — точно
- ✅ Structured output: response.parsed → Pydantic — точно
- ✅ text/x.enum, constraints (minItems, maxItems) — точно
- ✅ Pay-as-you-go tiers (3 tier) — точны
- ✅ Rate limits привязаны к PROJECT — точно
- ✅ SynthID watermark, reference images (14), multi-turn editing — точно
- ✅ SDK Bug #2024 (IMAGE_SAFETY hang) — открыт, релевантен
- ✅ File API: 2GB uploads, 48h storage, бесплатно — точно

---

## Итоговые рекомендации аудитора

### Критические (исправить до миграции)

1. **Исправить Executive Summary** — заменить таблицу стоимости на корректные числа из раздела 10.8. Текущая таблица систематически занижает LLM-стоимость.

2. **Исправить минимумы кэширования** — для 3 Flash минимум = 1,024 (не 4,096). Пересмотреть секцию 5.3: few-shot примеры полезны для качества, но не обязательны для кэширования.

3. **Исправить цену FLUX.2 Klein** — $0.014, не $0.016. Пересчитать baseline.

### Важные (учесть при миграции)

4. **Использовать `BLOCK_NONE` вместо `OFF`** для safety settings — сохраняет visibility через safety ratings metadata для мониторинга.

5. **Обрабатывать все finish_reason** — не только IMAGE_SAFETY/SAFETY/PROHIBITED_CONTENT, но и IMAGE_PROHIBITED_CONTENT, IMAGE_RECITATION, IMAGE_OTHER, NO_IMAGE.

6. **Учесть SDK Bug #2024** — при прямом SDK обернуть доступ к finish_reason в try/except с timeout. Или использовать OpenRouter для NB2 (обходит баг).

7. **Пересмотреть стоимость кэша** — $4.50/1M/hour для 3 Flash, не $1.00. Незначительно для одной книги, но при масштабировании может быть существенно.

### Перспективные (добавить в backlog)

8. **Multimodal Embeddings** — протестировать для entity dedup как замену fuzzy matching первичного отсева. Потенциально дешевле и точнее для русских имён.

9. **PDF-вход** — исследовать direct upload PDF для устранения chunk boundary entity loss. Конверсия EPUB→PDF + один вызов вместо чанкинга.

10. **Thought Signatures** — задокументировать как обязательное требование при будущем переходе на function calling или multi-turn с Gemini 3.

11. **Issue #699 закрыт** — можно свободно использовать `default=` в Pydantic response schemas.
