# Промпт для исследования: Оптимизация обработки книг — миграция с LLM-only на RAG/NLP

> **Модель:** Claude Opus 4.6 (1M Context)
> **Дата:** 2026-03-23
> **Язык отчёта:** русский
> **Результат:** файл `/docs/research/rag-nlp-optimization-research.md`

---

## Системный контекст

Ты — senior ML/NLP инженер-исследователь, специализирующийся на Information Extraction, Named Entity Recognition, Retrieval-Augmented Generation и оптимизации затрат на LLM-инференс. Тебе поручено провести глубокое практическое исследование для проекта **fancai** — приложения для чтения электронных книг с AI-функциями.

Используй Brave Search и все доступные инструменты для поиска в вебе. **Критически важна актуальность информации на момент 23 марта 2026 года** — ищи свежие релизы, бенчмарки и сравнения за последние 6 месяцев (Q4 2025 – Q1 2026). Не полагайся на данные из обучающей выборки — верифицируй через поиск.

---

## Описание проекта fancai

Fancai — приложение для чтения EPUB-книг (React 19 + FastAPI + PostgreSQL + Redis + Celery). Ключевые AI-функции:

### 1. Entity Wiki (основная функциональность)
**Цель:** Для каждой книги создать энциклопедию персонажей, локаций и объектов с визуальными описаниями, биографическими milestone'ами, отношениями и событиями по главам.

**Что извлекается из каждой главы:**
- **Сущности (entities):** имя, тип (character/location/object), visual_summary (описание внешности ≥100 символов), aliases (альтернативные имена), importance (1-10), confidence
- **События главы (chapter events):** chapter_event_action (что делает), chapter_event_inner (что чувствует/думает)
- **Связи (relationships):** source, target, type (KINSHIP/ALLY/ENEMY/FRIEND/MENTOR/ROMANCE/RIVAL), weight, context
- **Позиция первого упоминания** (first_mention_offset) для привязки к тексту

**Post-processing (Entity Synthesis):**
- Генерация biography milestones (spoiler-free по главам)
- Определение base_role (protagonist/antagonist/supporting/episodic)
- Эволюция отношений (relationship_milestones)
- Visual_summary_clean для каждого milestone

### 2. Парсинг описаний (второстепенная функциональность)
**Цель:** Извлечь визуально значимые текстовые фрагменты (описания локаций, внешности персонажей, атмосферы, артефактов) для последующей генерации иллюстраций по ним.

**Что извлекается:**
- Описательные фрагменты ≥80 символов с типом (location/character/atmosphere/object)
- Точная позиция в тексте (source_span) — привязка к CFI в EPUB-читалке
- Confidence score, priority score
- Упомянутые сущности (entities_mentioned) — для spoiler-protection

**Режим TSA (Tagged Span Annotation):**
Основной режим. LLM размечает оригинальный текст XML-тегами `<desc type="..." occurrence="N">точный текст</desc>`. Затем TSA-парсер находит точные позиции через fuzzy matching (SequenceMatcher, threshold 0.85).

---

## Текущая архитектура (проблемная)

### Пайплайн обработки книги:
```
EPUB загружен → Celery task process_book →
  Для КАЖДОЙ главы (последовательно, semaphore=10):
    1. Recursive chunking (max 100k chars, 15% overlap)
    2. Для КАЖДОГО чанка → OpenRouter API call (Gemini 3 Flash Preview):
       - TSA prompt (~2000 токенов системный) + текст главы
       - Structured Output (Pydantic → JSON Schema)
       - Ответ: tagged_text + entities[] + relationships[]
    3. TSA Parser → описания с точными позициями
    4. Consistency Manager → entity resolution (fuzzy dedup)
    5. Сохранение в PostgreSQL
  Entity Deduplication (ещё один LLM-вызов)
  Entity Synthesis (ещё один LLM-вызов на batch 50 entities)
```

### Используемые LLM модели (через OpenRouter):
- **Extraction/TSA:** `google/gemini-3-flash-preview` (основная)
- **Translation:** `google/gemini-2.0-flash-lite` (перевод на английский)
- **Deduplication:** `google/gemini-3-flash-preview`
- **Synthesis:** `google/gemini-3-flash-preview`
- **Fallback chain:** Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite

### Проблемы текущего подхода:

**1. Стоимость ($$$):**
- КАЖДАЯ глава → LLM-вызов с полным текстом + огромный системный промпт
- Книга 50 глав × ~30k символов = ~1.5M символов входных токенов
- Плюс output tokens (JSON с tagged_text, entities, relationships)
- Плюс Entity Deduplication LLM-вызов
- Плюс Entity Synthesis LLM-вызов (batch по 50 entities)
- Всё через OpenRouter (наценка сверху)
- **Обработка одной книги стоит значительно**

**2. Скорость:**
- Даже с semaphore=10, обработка книги занимает 5-15 минут
- Rate limiting OpenRouter дополнительно замедляет
- Celery task с time_limit=3 часа

**3. Качество:**
- LLM часто «выдумывает» описания, которых нет в тексте (hallucination)
- `source_text.casefold()` проверка отсеивает, но не всегда
- Entity deduplication через LLM ненадёжна — пропускает очевидные дубликаты типа "Геральт" ↔ "Ведьмак"
- Visual_summary часто слишком короткий или generic
- TSA режим: LLM иногда искажает оригинальный текст внутри тегов
- Позиции (text_offset, first_mention_offset) от LLM неточные — приходится верифицировать string search'ом

**4. Связанность описаний и Entity Wiki:**
- Описания и entities извлекаются ОДНИМ промптом за один LLM-вызов
- Нельзя оптимизировать расходы на описания отдельно от Entity Wiki
- Если пользователю нужна только Entity Wiki — всё равно платим за извлечение описаний

---

## Задание на исследование

Проведи **глубокое исследование с поиском в интернете** по следующим направлениям. Для каждого направления:
- Ищи актуальные решения (Q4 2025 – Q1 2026)
- Указывай конкретные библиотеки/модели с версиями
- Приводи бенчмарки производительности и точности
- Оценивай стоимость (free/self-hosted vs API)
- Оценивай сложность интеграции с текущим стеком (Python 3.11, FastAPI, PostgreSQL, Celery)

### Направление 1: NER и Entity Extraction без LLM

Исследуй возможность замены LLM для первичного извлечения сущностей:

**a) Классические NER модели:**
- spaCy (v3.8+) с русскоязычными моделями (ru_core_news_lg и новее)
- Stanza (Stanford NLP)
- DeepPavlov (русскоязычные NER модели)
- Natasha/Slovnet (специализированные русские NER)
- Какие из них поддерживают entity types: PERSON, LOC, ORG + custom types?
- Качество на художественной литературе (vs news corpus)?

**b) Transformer-based NER (self-hosted):**
- GLiNER (Generalist and Lightweight NER) — последние версии и модели
- NuNER / UniNER — universal NER
- Fine-tuned модели на HuggingFace для русского языка
- BERT/RoBERTa fine-tuned для литературного русского
- Можно ли запускать на CPU? Какие требования к GPU?

**c) Извлечение связей (Relation Extraction):**
- Есть ли self-hosted модели для извлечения отношений между сущностями?
- REBEL, DocRED-based модели
- Насколько они работают на русском?

**d) Извлечение псевдонимов (Alias Resolution / Coreference Resolution):**
- Модели для разрешения кореференций на русском (местоимения → entity)
- Alias extraction: "Геральт" = "Белый Волк" = "Ведьмак"
- spaCy coreference, NeuralCoref, AllenNLP coref

### Направление 2: RAG-подход для Entity Wiki

Вместо обработки каждой главы через LLM, исследуй RAG-архитектуру:

**a) Chunking & Embedding:**
- Какие embedding модели лучше для русской художественной литературы?
- multilingual-e5-large, BGE-M3, GigaChat embeddings, ruBERT variants
- Семантическое чанкование vs fixed-size для книг
- LangChain/LlamaIndex text splitters — какие подходят для fiction?

**b) Vector Store:**
- pgvector (уже PostgreSQL в стеке) vs Qdrant vs Chroma vs Milvus
- Стоимость хранения embeddings для библиотеки из 100 книг

**c) RAG Pipeline:**
- Извлечение entities через NER → обогащение через RAG (только для тех entities, где нужен контекст)
- Можно ли делать Entity Wiki инкрементально (по мере чтения)?
- Hybrid search: keyword + vector для точного нахождения упоминаний entity

**d) Оценка экономии:**
- Сколько LLM-вызовов можно сэкономить при RAG vs текущий подход?
- Какой процент работы можно сделать локально (NER + embeddings)?

### Направление 3: Оптимизация парсинга описаний

**a) Описания без LLM:**
- Можно ли извлекать визуальные описания rule-based методами?
- Heuristics: длинные предложения с прилагательными цвета/формы/размера?
- Dependency parsing для выделения описательных конструкций?
- TextRank/RAKE для extraction of key descriptive passages?

**b) Classifier-based подход:**
- Обучить классификатор "это описание для иллюстрации" на имеющихся данных из БД
- Sentence-level classification: описание vs не-описание
- Какие модели подходят? Fine-tune sentence-transformers?
- Размер обучающей выборки: в БД уже есть тысячи размеченных описаний

**c) LLM только для обогащения:**
- NER + rules извлекают кандидаты → LLM оценивает и обогащает только лучших
- Batch API (Gemini/OpenAI batch) для удешевления?
- Сколько стоит batch inference vs real-time?

### Направление 4: Гибридная архитектура (рекомендации)

На основе исследования направлений 1-3, предложи конкретную гибридную архитектуру:

**a) Разделение пайплайна:**
- Phase 1 (бесплатно, локально): NER + coreference → базовый Entity Wiki
- Phase 2 (дёшево): Embeddings + vector search → обогащение описаний
- Phase 3 (дорого, точечно): LLM только для synthesis/biography/relationships

**b) Разделение Entity Wiki и описаний:**
- Entity Wiki: NER → dedup → LLM synthesis (только один вызов на книгу, не на главу)
- Описания: rule-based extraction + classifier → LLM enrichment только для top-K

**c) Инкрементальная обработка:**
- Обрабатывать по мере чтения (on-demand per chapter) vs batch вся книга
- Какие компоненты можно сделать incremental?

**d) Стоимостная модель:**
- Подсчитай примерную стоимость обработки книги в 50 глав (300 страниц):
  - Текущий подход (all-LLM)
  - Гибрид NER + LLM
  - Full local (NER + rules + embeddings, без LLM)
- Учитывай: OpenRouter pricing для Gemini 3 Flash (~$0.10/1M input, ~$0.40/1M output)

### Направление 5: Инструменты и фреймворки

**a) LangChain vs LlamaIndex vs Haystack vs custom:**
- Какой фреймворк лучше подходит для book processing pipeline?
- Overhead фреймворка vs custom implementation
- Поддержка hybrid RAG (sparse + dense retrieval)

**b) Instructor / Outlines / Guidance:**
- Structured output без OpenRouter JSON Schema mode?
- Работает ли с self-hosted моделями?

**c) Self-hosted LLM (если LLM всё-таки нужен):**
- Ollama / vLLM / llama.cpp
- Какие модели (7B-13B) справляются с entity extraction на русском?
- Стоимость GPU inference vs OpenRouter API pricing
- Qwen2.5, Mistral, LLaMA 3 — бенчмарки на русском NER/IE

**d) Специализированные инструменты:**
- LangExtract — текущий статус и возможности (2026)
- Google Document AI / Azure AI Language
- Unstructured.io для парсинга документов
- spaCy + custom pipelines

---

## Формат отчёта

Создай файл `/docs/research/rag-nlp-optimization-research.md` со следующей структурой:

```markdown
# Исследование: Оптимизация обработки книг в fancai
## Дата: 2026-03-23

## Executive Summary
(Краткие выводы и рекомендации — 1 страница)

## 1. Текущее состояние и проблемы
(Краткий обзор текущей архитектуры с метриками стоимости)

## 2. NER и Entity Extraction
### 2.1 Классические NER
### 2.2 Transformer-based NER
### 2.3 Relation Extraction
### 2.4 Coreference Resolution

## 3. RAG-подход
### 3.1 Embedding модели
### 3.2 Vector Stores
### 3.3 RAG Pipeline для книг

## 4. Оптимизация парсинга описаний
### 4.1 Rule-based extraction
### 4.2 Classifier-based подход
### 4.3 LLM для обогащения

## 5. Инструменты и фреймворки
### 5.1 Orchestration (LangChain / LlamaIndex / Haystack)
### 5.2 Structured Output
### 5.3 Self-hosted LLM
### 5.4 Специализированные инструменты

## 6. Рекомендуемая архитектура
### 6.1 Гибридный пайплайн
### 6.2 Стоимостная модель (сравнительная таблица)
### 6.3 План миграции (phases)
### 6.4 Риски и mitigation

## 7. Источники
(Все ссылки, использованные в исследовании)
```

## Требования к качеству

1. **Каждое утверждение подкреплено ссылкой** — нашёл в поиске → дай URL
2. **Бенчмарки конкретные** — F1 score, latency (ms), throughput (docs/sec), cost ($)
3. **Сравнительные таблицы** — для каждой категории инструментов
4. **Примеры кода** — короткие snippets для ключевых интеграций (spaCy NER pipeline, pgvector query, etc.)
5. **Стоимостная модель с расчётами** — не абстрактные "дешевле/дороже", а конкретные цифры
6. **Русскоязычная специфика** — все модели должны работать с русским текстом (художественная литература)
7. **Production-ready рекомендации** — не академические эксперименты, а решения для production с FastAPI/Celery/PostgreSQL
8. **Актуальность** — всё на момент марта 2026 года, проверь через поиск

## Антипаттерны (чего НЕ делать)

- НЕ рекомендуй решения, которые требуют GPU для inference в production (у нас VPS без GPU), если не указываешь CPU-совместимую альтернативу
- НЕ предлагай заменить всё на LLM-фреймворк — цель снизить зависимость от LLM
- НЕ игнорируй русскоязычную специфику — решения должны работать на русском
- НЕ давай общие рекомендации без конкретных цифр стоимости
- НЕ забывай про TSA (Tagged Span Annotation) — это ключевая функция для позиционирования описаний в тексте
