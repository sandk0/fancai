## Роль

Ты — ML infrastructure engineer и AI pipeline architect с экспертизой в serverless GPU, model selection и production ML systems. Твоя задача — провести глубокое веб-исследование и разработать оптимальную архитектуру AI pipeline на Modal для проекта fancai.

## Контекст проекта

**fancai** — fiction reader с AI-иллюстрациями и интерактивным entity glossary/wiki.

**Стек:** FastAPI + Celery + PostgreSQL 17 + Redis 7.4 | React 19 + TypeScript
**Production:** VPS 32GB RAM, 12 vCPU AMD EPYC 9645, без GPU
**Домен:** https://fancai.ru

### Текущий AI Pipeline

Весь AI работает через OpenRouter API (`backend/app/core/openrouter_client.py`, 738 строк).

**Компоненты pipeline обработки книги:**

1. **Description & Entity Extraction** (главный bottleneck — 83% стоимости по OpenRouter billing)
   - Gemini 3.0 Flash через OpenRouter → structured JSON output
   - TSA-extraction: XML теги для позиций описаний + entities + relationships
   - Чанки 100K chars с 15% overlap, semaphore 10 параллельных глав
   - Pydantic schemas для structured output (GeminiResponseSchema)
   - Fallback chain: Gemini 3.0 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite

2. **Image Generation** (17% стоимости)
   - FLUX.2 Klein 4B через OpenRouter (`modalities=["image"]`)
   - Pipeline: RU→EN перевод (Gemini) → стилизация по типу+жанру → FLUX.2
   - Type-specific templates (location, character, atmosphere, object, action)
   - Genre-aware styling (fantasy, sci-fi, detective, romance, horror, thriller, historical)
   - Aspect ratio 4:3 (landscape), 1024×768

3. **Entity Synthesis** (биографии, роли, milestones для wiki)
   - Gemini 3.0 Flash через OpenRouter
   - Батчи по 50 сущностей → JSON с milestones

4. **Entity Deduplication** (LLM-based семантическое)
   - Gemini 3.0 Flash через OpenRouter
   - "Гарри Поттер" = "Гарри" = "Поттер, Гарри"

5. **Prompt Translation** (RU→EN для image gen)
   - Gemini 3.0 Flash → перевод визуальных описаний на английский
   - Redis кэш переводов (7 дней)

**Ключевой вопрос для исследования:** возможно, для synthesis/dedup/translation не нужен Gemini 3.0 Flash — более дешёвая **Gemini 3.1 Flash-Lite** может быть достаточна. Extraction — самая требовательная задача, но даже для неё стоит сравнить Flash vs Flash-Lite по quality/cost.

6. **NER** (Phase 30, feature flag USE_GLINER_NER=false)
   - GLiNER2 (fastino/gliner2-base-v1, 205M params, DeBERTa) на CPU
   - Только entities (без описаний и отношений)

7. **Entity Image Generation** (портреты персонажей, по запросу пользователя)
   - Тот же FLUX.2 Klein через OpenRouter

### Реальные данные: "Перекрёстки сумерек" (Роберт Джордан)

**ВАЖНО: Данные из OpenRouter Management API (source of truth для биллинга), НЕ из llm_usage_log DB.**

DB `llm_usage_log` **теряет 52-66% данных** из-за бага в fire-and-forget логировании (`asyncio.create_task` в `openrouter_client.py`). Используй ТОЛЬКО OpenRouter Management API для реальных цен.

| Компонент                                    | API Calls | OpenRouter Cost | % от total |
| -------------------------------------------- | --------- | --------------- | ---------- |
| **LLM** (Gemini 3.0 Flash, google-vertex)    | 141       | **$5.12**       | **83%**    |
| **LLM** (Gemini 3.0 Flash, google-ai-studio) | 1         | $0.0003         | ~0%        |
| **Images** (FLUX.2 Klein)                    | 63        | **$1.01**       | **17%**    |
| **ИТОГО**                                    | **205**   | **$6.13**       | 100%       |

Книга: 50 глав, 253,861 слов, 381 описание, 198 сущностей.
Время обработки: **59 минут** (18:03 — 19:02 UTC).

**Разбивка 142 LLM calls:** 2.8 calls/глава (extraction + multi-chunk + synthesis + dedup + translation).

**OpenRouter всего за весь период:** $12.81 usage / $20 credits purchased.

### Текущая стоимость на книгу (детально, из OpenRouter Management API)

- LLM (extraction + synthesis + dedup + translation): **$5.12** (142 calls)
- Images (63 шт × $0.016): **$1.01**
- **TOTAL: $6.13/книга**

**Критически важно:** LLM extraction = **83% стоимости** (не 66% как показывает bugged DB). Оптимизация LLM — главный приоритет.

### Баг в DB логировании (обнаружен при анализе)

`llm_usage_log` теряет данные: за всё время DB записала $4.36, OpenRouter списал $12.81 (**$8.45 = 66% потеряно**).
Причина: `asyncio.create_task(_log_usage_to_db(...))` в `openrouter_client.py:374,508,655` — fire-and-forget. При 10 параллельных главах (semaphore) DB connection pool исчерпывается и tasks молча падают.
**Используй OpenRouter Management API (`GET /api/v1/activity`) как source of truth для стоимости.**
Management API key: `REDACTED-OPENROUTER-KEY`

### Предыдущая архитектура (до OpenRouter)

До OpenRouter использовались **прямые вызовы Google Gemini API** через `google-genai` SDK. Это было:

- **Дольше**: нет fallback chain, single point of failure
- **Дороже**: без OpenRouter bundling
- OpenRouter добавил: fallback chain (3 модели), circuit breaker, cost tracking

### Результаты предыдущего исследования Modal (2026-03-24)

**Файл:** `docs/research/modal-gpu-migration-plan.md`

**Ключевые находки:**

1. Modal free tier: $30/мес = ~51 часов T4 или ~27 часов A10G
2. FLUX.2 Klein 4B на Modal L4: **$0.0003/image** (vs $0.016 OpenRouter = 53x дешевле)
3. Self-hosted Qwen 2.5 7B на A10G: $5.56/M output tokens vs Gemini $3.00/M → **дороже**
4. Но это было исследовано только для Qwen 7B. Не проверяли: Gemma, Llama 3.3, Qwen 72B, Mistral
5. **НЕ исследовали**: полный pipeline на Modal (extraction + images в одном pipeline)
6. **НЕ исследовали**: Gemini Batch API подробно (только упомянули 50% скидку)
7. **НЕ исследовали**: модели image gen качественнее FLUX.2 Klein

### Modal GPU Pricing (март 2026)

| GPU       | VRAM  | $/сек     | $/час | $30 free = часов |
| --------- | ----- | --------- | ----- | ---------------- |
| T4        | 16 GB | $0.000164 | $0.59 | 50.8 ч           |
| L4        | 24 GB | $0.000222 | $0.80 | 37.5 ч           |
| A10G      | 24 GB | $0.000306 | $1.10 | 27.2 ч           |
| L40S      | 48 GB | $0.000542 | $1.95 | 15.4 ч           |
| A100 40GB | 40 GB | $0.000583 | $2.10 | 14.3 ч           |
| A100 80GB | 80 GB | $0.000694 | $2.50 | 12.0 ч           |
| H100      | 80 GB | $0.001097 | $3.95 | 7.6 ч            |

### Ключевые файлы

```
backend/app/core/openrouter_client.py     — Unified AI client (738 строк)
backend/app/services/gemini_extractor.py  — Description extraction (1221 строк)
backend/app/services/imagen_generator.py  — Image generation + prompt engineering (679 строк)
backend/app/services/ner_service.py       — GLiNER2 NER pipeline (498 строк)
backend/app/services/entity_synthesis_service.py — Biography milestones
backend/app/services/entity_deduplication_service.py — LLM dedup
backend/app/services/consistency_manager.py — Entity resolution
backend/app/tasks/book_tasks.py           — Book processing Celery task (956 строк)
backend/app/tasks/image_tasks.py          — Image generation Celery tasks
```

---

## Задачи исследования

### 1. Image Generation Models для Modal: полный landscape

Предыдущее исследование ограничилось FLUX.2 Klein как "та же модель". Теперь нужно исследовать ВСЕ актуальные варианты с фокусом на **качество**, а не только стоимость. У нас есть GPU мощности Modal — можно запускать более тяжёлые модели.

**1a. Полный benchmark image gen моделей (март 2026):**

Для КАЖДОЙ модели — WebSearch с актуальными данными:

| Модель                     | Params | Минимум GPU | Время/image | Качество | Стиль |
| -------------------------- | ------ | ----------- | ----------- | -------- | ----- |
| FLUX.2 Klein 4B            | 4B     | L4          | ~1.5s       | Baseline | —     |
| FLUX.1 Schnell 12B         | 12B    | L40S        | ?           | ?        | ?     |
| FLUX.1 Dev 12B             | 12B    | L40S        | ?           | ?        | ?     |
| FLUX.2 [Large/Ultra]       | ?      | ?           | ?           | ?        | ?     |
| Stable Diffusion 3.5 Large | 8B     | A10G        | ?           | ?        | ?     |
| SD 3.5 Medium              | ?      | L4?         | ?           | ?        | ?     |
| SDXL Lightning/Turbo       | 3.5B   | T4          | ?           | ?        | ?     |
| Playground v3              | ?      | ?           | ?           | ?        | ?     |
| PixArt-Σ                   | ?      | ?           | ?           | ?        | ?     |
| Kandinsky 3.1              | ?      | ?           | ?           | ?        | ?     |
| Imagen 3/4 (Google)        | ?      | API only?   | ?           | ?        | ?     |
| Ideogram 2.0               | ?      | ?           | ?           | ?        | ?     |
| Recraft V3                 | ?      | ?           | ?           | ?        | ?     |

**1b. Для каждой модели определи:**

- Минимальный GPU на Modal (T4/L4/A10G/L40S/A100/H100)
- VRAM потребление (fp16, fp8, int4)
- Время генерации 1 image (1024×768)
- Стоимость на Modal (GPU_sec × $/sec)
- Качество: visual fidelity, text rendering, style consistency
- Поддержка ControlNet / IP-Adapter / LoRA
- Лицензия: коммерческое использование разрешено?
- Есть ли примеры deployment на Modal?

**1c. Качество для book illustration:**

- Какая модель лучше для **fantasy** иллюстраций? (основной жанр fancai)
- Какая лучше для **portrait** генерации (entity wiki)?
- Можно ли использовать разные модели для разных типов (location vs character vs atmosphere)?
- **Character consistency**: IP-Adapter / face-swapping для единообразия персонажей в пределах книги

**1d. Сравнительная таблица $/image vs качество:**

- FLUX.2 Klein (текущее) vs лучший вариант
- При каком бюджете стоит переходить на более тяжёлую модель?
- Batching: можно ли batch inference для экономии cold start?

### 2. Полный Book Processing Pipeline на Modal

**Ключевой вопрос: что если ВЕСЬ pipeline обработки книги запускать на Modal?**

Сейчас pipeline работает так:

```
VPS Celery → OpenRouter Gemini (extraction) → OpenRouter FLUX (images)
                                             → CPU GLiNER (NER)
```

Альтернатива:

```
VPS Celery → Modal Pipeline:
  1. GPU: Self-hosted LLM → extraction (structured JSON)
  2. GPU: Self-hosted image gen → все иллюстрации
  3. GPU: GLiNER2 → NER
  4. GPU: Self-hosted LLM → synthesis + dedup + translation
  → Результат обратно в PostgreSQL
```

**2a. Архитектура единого pipeline на Modal:**

- Можно ли запустить всё в одном Modal container (с несколькими GPU)?
- Или лучше отдельные functions: LLM, image gen, NER?
- Modal `@app.cls()` с lifecycle — загрузить все модели при старте
- Как передавать данные между Modal functions? (volumes, return values, Redis?)
- Как записывать результаты обратно в PostgreSQL на VPS?

**2b. Self-hosted LLM для extraction:**
Предыдущее исследование проверяло только Qwen 2.5 7B. Это мало. Нужно исследовать:

| Модель                | Params   | GPU       | tok/sec | Качество extraction | Structured output |
| --------------------- | -------- | --------- | ------- | ------------------- | ----------------- |
| Qwen3 4B (FP8)        | 4B       | L4        | ?       | ?                   | ?                 |
| Qwen3 8B              | 8B       | A10G      | ?       | ?                   | ?                 |
| Qwen3 14B             | 14B      | A10G/L40S | ?       | ?                   | ?                 |
| Qwen3 32B             | 32B      | A100      | ?       | ?                   | ?                 |
| Llama 3.3 8B          | 8B       | A10G      | ?       | ?                   | ?                 |
| Llama 3.3 70B         | 70B      | A100      | ?       | ?                   | ?                 |
| Gemma 3 12B           | 12B      | A10G      | ?       | ?                   | ?                 |
| Gemma 3 27B           | 27B      | L40S/A100 | ?       | ?                   | ?                 |
| Mistral Small 3.1 24B | 24B      | A10G      | ?       | ?                   | ?                 |
| Mistral 3 (3B)        | 3B       | L4        | ?       | ?                   | ?                 |
| DeepSeek V3           | 671B MoE | Multi-GPU | ?       | ?                   | ?                 |
| Phi-4 14B             | 14B      | A10G      | ?       | ?                   | ?                 |

**Для каждой модели:**

- Benchmark: structured JSON extraction из русского текста
- Поддержка JSON Schema / function calling / structured output
- Качество на русском языке (критично для fancai!)
- Context window (нужно минимум 32K для длинных глав)
- **Сравнение с Gemini 3.0 Flash** по качеству extraction
- vLLM/TGI совместимость на Modal

**2c. Оптимальная комбинация GPU:**

- Один A10G для LLM + image gen по очереди?
- Два L4: один для LLM, другой для images параллельно?
- A100 для LLM + L4 для images?
- Сколько стоит каждая конфигурация в минутах на книгу?

### 3. Gemini Models + API Variants + Modal LLM — глубокое сравнение

**Это критический вопрос. LLM extraction = 83% стоимости ($5.12 из $6.13). Нужно исследовать ВСЕ варианты оптимизации.**

**3a. Выбор модели Gemini: Flash vs Flash-Lite**

Сейчас используется Gemini 3.0 Flash ($0.50/$3.00 M tokens). Но для части задач может быть достаточно более дешёвой Gemini 3.1 Flash-Lite. Исследуй:

| Задача                                        | Gemini 3.0 Flash | Gemini 3.1 Flash-Lite | Нужна Flash? |
| --------------------------------------------- | ---------------- | --------------------- | ------------ |
| Description extraction (TSA, structured JSON) | ?                | ?                     | ?            |
| Entity extraction (имена, типы, aliases)      | ?                | ?                     | ?            |
| Entity synthesis (биографии, milestones)      | ?                | ?                     | ?            |
| Entity deduplication (семантическое)          | ?                | ?                     | ?            |
| Prompt translation (RU→EN)                    | ?                | ?                     | ?            |

Для КАЖДОЙ задачи:

- WebSearch: Gemini 3.1 Flash-Lite pricing ($/M input, $/M output)
- Качество structured output (JSON Schema compliance)
- Качество на русском языке vs Flash
- Context window
- **Ключевой вопрос**: можно ли использовать Flash-Lite для synthesis/dedup/translation (более простые задачи), а Flash оставить только для extraction (сложная)?
- Расчёт: если перевести synthesis+dedup+translation на Flash-Lite, сколько сэкономим из $5.12?

**3b. Gemini API Direct (текущее через OpenRouter):**

- Pricing Gemini 3.0 Flash: $0.50/M input, $3.00/M output
- Pricing Gemini 3.1 Flash-Lite: ? (WebSearch!)
- OpenRouter markup: 5.5% platform fee
- Latency: <1 сек/запрос
- Structured output: native JSON Schema
- Fallback chain: Gemini 3.0 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite
- Rate limits: ?
- Free tier: 250 req/day (для dev)

**3c. Gemini Batch API (НЕ исследовано ранее):**
Для КАЖДОГО пункта — WebSearch:

- Pricing: 50% скидка (подтвердить!) — работает для Flash И Flash-Lite?
- Latency: сколько ждать результат? Минуты? Часы? 24ч?
- Формат: как отправить batch? JSON lines? BigQuery?
- Лимиты: max requests per batch? Max tokens per batch?
- Structured output поддерживается?
- Русский язык — качество?
- Можно ли из Modal container вызывать Gemini Batch API?
- **Реально ли использовать для обработки книги?** (50 глав = 50 requests)
- SLA: гарантированное время выполнения?
- Ошибки: как обрабатывать partial failures в batch?
- **Flash-Lite + Batch = максимальная экономия?** Расчёт.

**3d. Self-hosted LLM на Modal (vLLM):**

- Pricing: зависит от модели и GPU
- Latency: cold start + inference
- Throughput: batch inference на GPU (много запросов одновременно)
- Качество: зависит от модели
- Structured output: vLLM + outlines / structured generation
- **Главное преимущество**: можно обработать ВСЕ 50 глав за 1 warm session, batch inference
- **Расчёт**: 50 глав × ~10K tokens input → сколько стоит на каждой комбинации GPU+модель?

**3e. Гибрид: разные модели для разных задач**

Возможная архитектура:

- **Extraction** (сложное, quality-critical): Gemini 3.0 Flash или self-hosted 14B+ LLM
- **Synthesis** (среднее): Gemini 3.1 Flash-Lite (дешевле)
- **Dedup** (простое): Gemini 3.1 Flash-Lite или embedding-based
- **Translation** (простое): Gemini 3.1 Flash-Lite (минимальные требования)

Расчёт: сколько из 142 calls — extraction vs synthesis vs dedup vs translation? Какая экономия при раздельных моделях?

**3f. Сравнительная таблица (ОБЯЗАТЕЛЬНО):**

| Критерий                  | OR Flash | OR Flash-Lite | Gemini Direct Flash | Gemini Direct Flash-Lite | Gemini Batch Flash | Gemini Batch Flash-Lite | Modal LLM |
| ------------------------- | -------- | ------------- | ------------------- | ------------------------ | ------------------ | ----------------------- | --------- |
| $/M input                 |          |               |                     |                          |                    |                         |           |
| $/M output                |          |               |                     |                          |                    |                         |           |
| $/книга (50 глав)         | $5.12    | ?             | ?                   | ?                        | ?                  | ?                       | ?         |
| Latency/запрос            |          |               |                     |                          |                    |                         |           |
| Total время/книга         | 59 мин   | ?             | ?                   | ?                        | ?                  | ?                       | ?         |
| Structured output         |          |               |                     |                          |                    |                         |           |
| Качество extraction (рус) |          |               |                     |                          |                    |                         |           |
| Качество synthesis (рус)  |          |               |                     |                          |                    |                         |           |
| Fallback                  |          |               |                     |                          |                    |                         |           |
| Batch throughput          |          |               |                     |                          |                    |                         |           |

### 4. Полная стоимость: 5 сценариев архитектуры

Рассчитай для реальной книги "Перекрёстки сумерек" (50 глав, 63 images, 198 entities):

**Сценарий 1: Текущее (baseline, из OpenRouter Management API)**

- Всё через OpenRouter: **$6.13/книга**, 59 мин
- LLM: $5.12 (142 calls), Images: $1.01 (63 calls)

**Сценарий 2: Modal Images + OpenRouter LLM**

- Images: Modal FLUX.2 Klein L4
- LLM: OpenRouter Gemini Flash
- Стоимость/книга = ?, время = ?

**Сценарий 3: Modal Images + Gemini Direct API**

- Images: Modal (лучшая модель из исследования п.1)
- LLM: Gemini Direct API (без OpenRouter)
- Стоимость/книга = ?, время = ?

**Сценарий 4: Modal Images + Gemini Batch API**

- Images: Modal (лучшая модель)
- LLM: Gemini Batch API (50% скидка)
- Стоимость/книга = ?, время = ?

**Сценарий 5: Полный pipeline на Modal**

- Images: Modal (лучшая модель)
- LLM: Modal self-hosted (лучшая модель из п.2b)
- NER: Modal GLiNER2 T4
- Всё в одном pipeline
- Стоимость/книга = ?, время = ?

**Сценарий 6 (бонус): Гибрид "best of both"**

- Оптимальная комбинация Modal + API, выбранная по результатам исследования
- Стоимость/книга = ?, время = ?

**Для каждого сценария:**

- Стоимость за 1 книгу (детально по компонентам)
- Время обработки (wall clock)
- Modal расход/мес при 50 книгах
- Modal расход/мес при 200 книгах
- Modal расход/мес при 500 книгах
- Вписывается ли в $30 free tier?
- Если нет — сколько стоит сверху и оправдано ли?

### 5. Качество: не только цена

**5a. Comparison image gen quality:**

- Сгенерируй промпт для fantasy-иллюстрации книги
- Какая модель даст лучший результат?
- FLUX.2 Klein vs FLUX.1 Schnell vs SD3.5 — visual comparison (описание)
- Character portraits: какая модель лучше для fantasy-персонажей?

**5b. Comparison LLM extraction quality:**

- Gemini 3.0 Flash vs **Gemini 3.1 Flash-Lite** vs лучшая self-hosted модель
- Flash-Lite: достаточно ли качества для extraction? Или только для synthesis/translation?
- Structured output quality (JSON Schema compliance) — Flash-Lite поддерживает?
- Entity extraction recall/precision (fancai baseline: 86.84% recall)
- Русский текст: кто лучше понимает имена, локации, артефакты?
- Длинный контекст (>50K tokens) — кто лучше справляется?
- **Tiered approach**: Flash для extraction, Flash-Lite для остального — quality impact?

**5c. Character consistency (новая возможность):**

- На OpenRouter НЕВОЗМОЖНО: нет IP-Adapter/LoRA
- На Modal ВОЗМОЖНО: IP-Adapter, reference images, LoRA fine-tuning
- Как реализовать: один и тот же персонаж выглядит одинаково на всех иллюстрациях?
- Стоимость и сложность внедрения

### 6. Архитектура "Full Modal Pipeline"

**6a. Modal App Architecture:**

```python
# Как должен выглядеть Modal app для полного pipeline?
@app.cls(gpu="A10G")
class BookProcessor:
    @modal.enter()
    def setup(self):
        # Загрузка LLM + image gen модели
        ...

    @modal.method()
    def process_book(self, chapters: list[str]) -> BookResult:
        # 1. Extract descriptions + entities (LLM)
        # 2. Generate images (image gen)
        # 3. Synthesize entities (LLM)
        # 4. Deduplicate entities (LLM)
        # Всё в одном warm container
        ...
```

Или:

```python
# Отдельные functions
@app.function(gpu="A10G")
def extract_chapter(text: str) -> dict: ...

@app.function(gpu="L4")
def generate_image(prompt: str) -> bytes: ...

@app.function(gpu="T4")
def extract_ner(text: str) -> dict: ...
```

Какой подход лучше? Почему?

**6b. Data flow VPS ↔ Modal:**

- Celery task на VPS → `modal.Function.from_name().remote()`
- Результаты → обратно в PostgreSQL
- Batch: отправить 50 глав за один вызов?
- Streaming: можно ли получать результаты по мере обработки?
- Error handling: partial failures?

**6c. Cold start optimization:**

- GPU memory snapshots для каждой модели
- `scaledown_window` оптимизация
- `min_containers` vs scale-to-zero trade-offs
- Warm container pooling для burst нагрузки

### 7. Дополнительные вопросы

**7a. Можно ли запускать Gemini из Modal?**

- Установить `google-genai` SDK в Modal image
- Вызывать Gemini API из GPU container
- Гибрид: GPU inference для images + Gemini API для LLM в одном pipeline
- Latency: Modal EU → Google API → ?

**7b. Rate limits:**

- OpenRouter: какие лимиты на Gemini Flash?
- Gemini Direct API: 250 req/day free, какие платные лимиты?
- Gemini Batch API: лимиты на batch size?
- Modal: лимиты на concurrent containers?

**7c. Observability при полном pipeline на Modal:**

- Как мониторить стоимость?
- Как логировать в нашу LlmUsageLog таблицу?
- Prometheus метрики из Modal?

**7d. Переход: фазированный план**

- Что мигрировать первым?
- Как тестировать quality без production rollout?
- A/B framework для сравнения архитектур?

---

## Формат результата

### A. Executive Summary (3-5 абзацев)

Главные выводы: какая архитектура оптимальна? Стоит ли платить за Modal сверх $30?

### B. Image Generation Models Deep Dive

Полный landscape с бенчмарками, ценами, качеством. Рекомендация с обоснованием.

### C. LLM Models для Extraction

Benchmark self-hosted моделей vs Gemini. Качество structured output на русском.

### D. Gemini Batch API Analysis

Детальное исследование: pricing, latency, формат, лимиты, пригодность для fancai.

### E. Full Pipeline on Modal Architecture

Архитектура, data flow, code examples, cold start optimization.

### F. Cost Comparison Table (6 сценариев)

Детальные расчёты для "Перекрёстков" (50 глав, 62 images, 198 entities).

### G. Quality Comparison

Image quality и LLM extraction quality для каждого варианта.

### H. Recommended Architecture

Оптимальная архитектура с обоснованием.

### I. Migration Plan

Фазированный план перехода.

### J. Источники

Все URL из веб-исследования.

## Методология

1. **Прочитай код** AI pipeline (файлы выше) — пойми текущую архитектуру
2. **Прочитай предыдущее исследование** `docs/research/modal-gpu-migration-plan.md` — не дублируй, развивай
3. **WebSearch** для КАЖДОГО пункта — актуальные данные март 2026
4. **Проверь Modal docs** и примеры deployment для каждой модели
5. **Рассчитай стоимость** для каждого сценария с реальными числами
6. **Сравни** с текущими затратами ($2.90/книга, 59 мин)
7. **Сохрани результат** в `docs/research/modal-full-pipeline-research.md`

## Ограничения

- Бюджет: готовы платить сверх $30/мес если обосновано скоростью/качеством
- VPS НЕ МЕНЯЕТСЯ (32GB RAM, 12 vCPU, без GPU)
- Совместимость: Python 3.12, Celery, Docker, PostgreSQL
- Текущий OpenRouter API key сохраняется (fallback)
- У пользователя уже есть аккаунт Modal — можно тестировать
- Язык отчёта: русский (технические термины на английском)
- Язык контента: русский (книги на русском — важно для NER и LLM extraction)

## ВАЖНО

1. Это ИССЛЕДОВАНИЕ, а не пересказ документации. Для каждого утверждения — WebSearch с источником. Для каждого числа — расчёт или ссылка.
2. **Фокус на качество**, а не только на стоимость. Мы готовы платить за лучшее качество иллюстраций и extraction.
3. **Фокус на скорость**: 59 минут на книгу — слишком долго. Целевое время: <10 минут.
4. Будь скептичен к маркетинговым заявлениям — проверяй реальные бенчмарки пользователей.
5. **Не дублируй** данные из предыдущего исследования — ссылайся на `modal-gpu-migration-plan.md` и развивай.
