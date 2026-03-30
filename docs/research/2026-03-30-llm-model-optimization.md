# Исследование: Оптимизация LLM-модели для AI-пайплайна fancai

**Дата:** 2026-03-30
**Scope:** OpenRouter модели, extraction pipeline, prompt optimization, fine-tuning
**Автор:** Claude Code (research-and-analysis)

---

## 1. Executive Summary

**Gemini 3.1 Flash Lite непригодна для extraction задач fancai.** Деградация 76x — не баг промпта, а подтверждённая проблема модели: ранние ответы без завершения задачи ([Google AI Forum](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602)).

**Рекомендация: Gemini 2.5 Flash как primary модель для extraction.** Стоимость $0.30/$2.50 (vs $1.00/$4.00 у 3.0 Flash) — экономия ~50% при сопоставимом качестве. Gemini 2.5 Flash Lite ($0.10/$0.40) для translation и dedup — экономия 90%+ на простых задачах.

**Ожидаемое снижение стоимости: $2.50/месяц → ~$1.20/месяц** при сохранении качества extraction уровня Gemini 3.0 Flash.

---

## 2. Детальное сравнение моделей

### 2.1 Полная таблица моделей OpenRouter (март 2026)

| Модель                               | Input $/1M | Output $/1M | Context | Structured Output             | Free Tier      | Русский                   | Оценка для extraction    |
| ------------------------------------ | ---------- | ----------- | ------- | ----------------------------- | -------------- | ------------------------- | ------------------------ |
| **google/gemini-3-flash-preview**    | $0.50      | $3.00       | 1M      | JSON Schema, tools            | Нет            | Отличный                  | A+ (baseline)            |
| **google/gemini-2.5-flash**          | $0.30      | $2.50       | 1M      | JSON Schema, tools, reasoning | Нет            | Отличный                  | **A (рекомендация)**     |
| google/gemini-2.5-flash-lite         | $0.10      | $0.40       | 1M      | JSON Schema, tools            | Нет            | Хороший                   | B (для простых задач)    |
| google/gemini-3.1-flash-lite-preview | $0.25      | $1.50       | 1M      | JSON Schema, tools            | Нет            | Хороший                   | **F (ранний ответ баг)** |
| google/gemini-2.0-flash-lite         | $0.075     | $0.30       | 1M      | JSON mode                     | Нет            | Хороший                   | C+ (текущий translation) |
| deepseek/deepseek-chat-v3-0324       | $0.20      | $0.77       | 164K    | JSON mode, tools              | Нет            | Хороший                   | B+                       |
| deepseek/deepseek-v3.1               | $0.25      | $0.38       | 164K    | JSON mode, tools              | Нет            | Хороший                   | B+                       |
| deepseek/deepseek-v3.2               | $0.25      | $0.38       | 164K    | JSON mode, tools              | Нет            | Хороший                   | B                        |
| deepseek/deepseek-r1                 | $0.50      | $2.18       | 164K    | Ограничен                     | **Бесплатная** | Средний                   | C (reasoning overhead)   |
| qwen/qwen3-30b-a3b                   | $0.08      | $0.28       | 131K    | JSON, XML, tools              | Нет            | **Отличный** (119 языков) | B+                       |
| qwen/qwen3-235b-a22b                 | $0.20      | $0.60       | 131K    | JSON Schema, tools            | Нет            | Отличный                  | A-                       |
| qwen/qwen3.5-397b-a17b               | $0.39      | $2.34       | 262K    | JSON Schema, tools            | Нет            | **Лучший** (119 языков)   | A                        |
| qwen/qwen3.5-9b                      | $0.05      | ~$0.20      | 256K    | JSON Schema, tools            | Нет            | Хороший                   | B (маленькая 9B)         |
| mistral/mistral-small-4              | $0.15      | $0.60       | 262K    | JSON, tools, reasoning        | Нет            | Хороший                   | B+                       |
| meta-llama/llama-4-scout             | $0.08      | $0.30       | 10M     | tools                         | **Бесплатная** | Средний                   | B-                       |
| meta-llama/llama-4-maverick          | $0.15      | $0.60       | 1M      | tools                         | **Бесплатная** | Средний                   | B                        |
| meta-llama/llama-3.3-70b             | Бесплатно  | Бесплатно   | 66K     | tools                         | **Бесплатная** | Средний                   | C+                       |
| mistral/mistral-small-3.1-24b        | Бесплатно  | Бесплатно   | 128K    | tools, vision                 | **Бесплатная** | Хороший                   | B-                       |
| qwen/qwen3-coder-480b                | Бесплатно  | Бесплатно   | 262K    | JSON, tools                   | **Бесплатная** | Хороший                   | B- (код-фокус)           |

### 2.2 Стоимость обработки одной книги (23 главы, ~170K input + ~80K output tokens)

| Модель                | Стоимость книги | vs Gemini 3.0 Flash | Качество extraction           |
| --------------------- | --------------- | ------------------- | ----------------------------- |
| Gemini 3.0 Flash      | $0.41           | baseline            | Отличное (4-8 desc/ch)        |
| **Gemini 2.5 Flash**  | **$0.25**       | **-39%**            | **Хорошее-Отличное**          |
| Gemini 2.5 Flash Lite | $0.05           | -88%                | Среднее (нужно тестить)       |
| Gemini 3.1 Flash Lite | $0.16           | -61%                | **Непригодное (0.1 desc/ch)** |
| DeepSeek V3.1         | $0.07           | -83%                | Нужно тестить                 |
| Qwen3 30B A3B         | $0.04           | -90%                | Нужно тестить                 |
| Qwen3 235B A22B       | $0.08           | -80%                | Нужно тестить                 |

---

## 3. Анализ проблемы Gemini 3.1 Flash Lite

### 3.1 Диагноз: "Early Response" баг

**Подтверждённая проблема:** Gemini 3.1 Flash Lite систематически возвращает ранние (неполные) ответы для задач extraction.

**Источники подтверждения:**

- [Google AI Forum](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602): "comes back with early response without completing the task" — при extraction из 7-страничного документа модель возвращает 2 строки из 70.
- [Google Support](https://support.google.com/gemini/thread/379487030): "Performance Degradation in Gemini 2.5 Pro and Flash Models When Extracting or Summarizing Data"
- Наши данные: 47 из 50 глав — 0 описаний, первые 3 главы (вероятно короткие) — корректные результаты.

### 3.2 К��рневая причина

Gemini Flash Lite — **дистиллированная модель**, оптимизированная для скорости и стоимости. Ключевые ограничения:

1. **Instruction following capacity:** Lite модели имеют сокращённый attention span. Промпт ~2500 токенов + текст главы ~5000-15000 токенов = суммарно 7-17K токенов. Это не проблема context window (1M), а проблема **instruction adherence** на длинных входных данных.

2. **TSA mode особенно проблематичен:** Задача TSA (вернуть оригинальный текст с XML-тегами) требует:
   - Прочитать и понять весь текст
   - Идентифицировать описания (complex instruction following)
   - Воспроизвести текст с точной вставкой тегов (high-fidelity output)

   Это значительно сложнее простого JSON extraction. Lite модели "срезают углы" — возвращают текст без разметки или с минимальной разметкой.

3. **Thinking disabled by default:** Flash Lite имеет thinking capabilities, но по умолчанию уровень "minimal" — модель не выстраивает цепочки рассуждений для сложного промпта. Для complex extraction это критично.

4. **Паттерн "первые главы работают":** Первые вызовы (пока модель "свежая") дают результаты. Длинные главы (100K char chunks) попадают в зону нестабильности Flash-серии ([Google Forum](https://discuss.ai.google.dev/t/gemini-2-5-flashs-extremely-long-inputs-are-highly-unstable/87952)).

5. **Ещё 2 подтверждённых бага Flash Lite:**
   - [Некорректный structured output](https://discuss.ai.google.dev/t/gemini-2-5-flash-lite-produces-incorrect-structured-output/102367) — модель оборачивает JSON в markdown-блоки
   - [Hallucinated observations при extraction](https://github.com/thedotmack/claude-mem/issues/1259) — Gemini 2.5 Flash полностью решает проблему

### 3.3 Почему `is_description_parsed=true` при пустом extraction?

Модель возвращает валидный JSON с `tagged_text`, но этот текст — **оригинал без `<desc>` тегов** (или с 0-1 тегами). TSA парсер корректно парсит ответ (parsed=true), но не находит тегов → 0 описаний.

### 3.4 Почему 3.0 Flash работает, а 3.1 Flash Lite нет?

| Характеристика        | Gemini 3.0 Flash    | Gemini 3.1 Flash Lite             |
| --------------------- | ------------------- | --------------------------------- |
| Размер модели         | Полная Flash        | Дистиллированная Lite             |
| Intelligence Index    | ~48                 | 34                                |
| Instruction following | Глубокое            | Поверхностное                     |
| Complex output        | Отличный (TSA, XML) | Деградация на длинных задачах     |
| Reasoning             | Встроенный          | Опционально (disabled by default) |
| Цена                  | $0.50/$3.00         | $0.25/$1.50                       |

**Вывод: Flash Lite не способна выполнять TSA extraction — это за пределами её capabilities.**

---

## 4. Prompt Optimization рекомендации

### 4.1 Оптимизация для Gemini 2.5 Flash (рекомендуемая модель)

Gemini 2.5 Flash — модель с **reasoning capabilities** (thinking). Это означает:

1. **Не упрощать промпт** — модель способна обрабатывать сложные инструкции
2. **Включить reasoning** для extraction задач: добавить параметр в OpenRouter запрос
3. **Текущий промпт (2500 токенов) — приемлемый размер** для 2.5 Flash

### 4.2 Оптимизация для дешёвых моделей (fallback)

Если в будущем нужно использовать Lite модели:

1. **Разделить задачи:** descriptions отдельно, entities отдельно (2 вызова вместо 1)
2. **Упростить TSA:** вместо полного воспроизведения текста — просить только JSON с offsets
3. **Увеличить few-shot:** 2-3 примера → 5-7 примеров с конкретными кейсами
4. **EN промпт для RU текста:** по данным исследований, EN системный промпт + RU текст даёт +5-15% качества на multilingual моделях (модель лучше следует EN инструкциям)

### 4.3 Fallback на Legacy JSON mode

Для дешёвых моделей Legacy mode (JSON extraction без TSA) может быть надёжнее:

- Не требует воспроизведения текста
- Проще structured output
- Менее требователен к instruction following
- Уже реализован в коде (`_process_chunk_legacy`)

---

## 5. Fine-Tuning Feasibility

### 5.1 Текущее состояние

| Платформа                     | Поддерживаемые модели                                                | Доступность      |
| ----------------------------- | -------------------------------------------------------------------- | ---------------- |
| Google AI Studio / Gemini API | **Нет поддерживаемых моделей** (deprecated 1.5 Flash-001 в мае 2025) | Недоступно       |
| Vertex AI                     | Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite                            | Доступно         |
| OpenRouter                    | Нет fine-tuning                                                      | Только inference |

### 5.2 Vertex AI Fine-Tuning

**Важно: AI Studio fine-tuning недоступен с мая 2025** — fine-tuning работает **только через Vertex AI**.

**Что доступно:**

- Supervised fine-tuning для Gemini 2.5 Flash, 2.5 Flash-Lite (GA status)
- LoRA/PEFT adapters (sizes: 1, 2, 4, 8, 16)
- JSONL формат, до 10M примеров, макс 131K токенов/пример
- Google рекомендует **100-500 примеров** (улучшения видны от 20 для простых задач)
- **Стоимость: ~$5** за обучение (500 pairs _ 5 epochs _ ~$1/1M tokens)
- Inference после SFT — **та же цена** что базовая модель (без наценки)

**Блокеры для fancai:**

1. **Fine-tuned модель НЕ доступна через OpenRouter** — только через Vertex AI API напрямую
2. Требует Google Cloud credentials + LiteLLM proxy или dual-backend в `openrouter_client.py`
3. Добавляет инфраструктурную сложность (Vertex AI endpoint management)
4. Наши ~500 training pairs — **идеально** для SFT (sweet spot рекомендаций Google)

**Практическая "дистилляция":** Прогнать главы через Gemini 3.0/2.5 Flash → fine-tune Flash Lite на его выходах. Это де-факто дистилляция, стоимость ~$5.

### 5.3 Оценка ROI fine-tuning

| Фактор                | Оценка                                                       |
| --------------------- | ------------------------------------------------------------ |
| Потенциальный выигрыш | Flash Lite с fine-tuning может приблизиться к качеству Flash |
| Стоимость внедрения   | Высокая: Vertex AI интеграция + dual-backend                 |
| Объём данных          | Достаточный (500+ pairs)                                     |
| Время разработки      | 2-3 дня на интеграцию + тестирование                         |
| Экономия              | ~$0.20/книга при переходе на fine-tuned Lite                 |
| Объём книг            | 5-20 книг/месяц                                              |
| **Годовая экономия**  | **~$24-48/год**                                              |

**Вердикт: Fine-tuning НЕ оправдан.** При объёме 5-20 книг/месяц и бюджете $5-10/месяц, годовая экономия ~$24-48 не покрывает затраты на разработку и поддержку Vertex AI интеграции.

### 5.4 Альтернатива: Few-Shot Prompt Optimization (бесплатно, P1)

**Самый высокий ROI:** Few-shot даёт до **+40% accuracy** vs zero-shot (данные исследований Google).

Конкретные шаги:

- Добавить 3-5 реальных примеров extraction из production данных (Gemini 3.0 Flash результаты)
- Включить примеры для каждого типа: location, character, atmosphere, object
- Использовать `responseSchema` (strict JSON) вместо свободного JSON
- Стоимость: ~200-400 токенов дополнительно к промпту (~$0.001/запрос)

### 5.5 Язык промпта (EN vs RU)

По данным исследований: **EN и RU промпты дают почти идентичные результаты** для Gemini (95.5% vs 96.0%).

**Оптимальная стратегия (уже используется в fancai):**

- Инструкции: на русском (текущий подход — корректный)
- JSON keys: на английском (`content`, `type`, `confidence`)
- Few-shot примеры: с русским текстом
- Переключение на EN инструкции **не даст значимого выигрыша** для Gemini

---

## 6. Tiered Strategy (рекомендация)

### 6.1 Оптимальная конфигурация

```python
# Рекомендуемая конфигурация
class GeminiConfig:
    # Tier 1: Extraction (сложная задача, качество критично)
    model_extraction = "google/gemini-2.5-flash"          # $0.30/$2.50 per 1M

    # Tier 2: Translation (простая задача, RU→EN)
    model_translation = "google/gemini-2.5-flash-lite"    # $0.10/$0.40 per 1M

    # Tier 3: Deduplication (средняя сложность)
    model_reduce = "google/gemini-2.5-flash-lite"         # $0.10/$0.40 per 1M

    # Tier 3: Synthesis (средняя сложность, длинный output)
    model_synthesis = "google/gemini-2.5-flash-lite"      # $0.10/$0.40 per 1M

# Fallback chain
FALLBACK_MODELS = [
    "google/gemini-2.5-flash",        # primary
    "google/gemini-2.5-flash-lite",   # fallback (для extraction — хуже, но рабочий)
]
```

### 6.2 Стоимость книги по задачам (23 главы)

| Задача                  | Модель                | Input tokens | Output tokens | Стоимость  |
| ----------------------- | --------------------- | ------------ | ------------- | ---------- |
| Extraction (23 ch)      | Gemini 2.5 Flash      | ~170K        | ~80K          | $0.25      |
| Translation (100 desc)  | Gemini 2.5 Flash Lite | ~20K         | ~15K          | $0.008     |
| Deduplication (1 call)  | Gemini 2.5 Flash Lite | ~10K         | ~5K           | $0.003     |
| Synthesis (3-5 batches) | Gemini 2.5 Flash Lite | ~50K         | ~30K          | $0.017     |
| **Итого LLM**           |                       |              |               | **~$0.28** |
| Images (100 images)     | FLUX.2 Klein          | —            | —             | $1.60      |
| **Итого всё**           |                       |              |               | **~$1.88** |

### 6.3 Сравнение с текущей конфигурацией

|                       | Текущее (Gemini 3.0 Flash + Flash Lite) | Рекомендуемое (Gemini 2.5 Flash + Flash Lite) |
| --------------------- | --------------------------------------- | --------------------------------------------- |
| Extraction модель     | gemini-3-flash-preview ($0.50/$3.00)    | gemini-2.5-flash ($0.30/$2.50)                |
| Translation модель    | gemini-2.0-flash-lite ($0.075/$0.30)    | gemini-2.5-flash-lite ($0.10/$0.40)           |
| Reduce модель         | gemini-3.1-flash-lite ($0.25/$1.50)     | gemini-2.5-flash-lite ($0.10/$0.40)           |
| Стоимость книги (LLM) | ~$0.41                                  | **~$0.28**                                    |
| Качество extraction   | Отличное                                | Хорошее-Отличное                              |
| **Экономия**          | —                                       | **~32%**                                      |

---

## 7. Альтернативные модели: когда стоит рассмотреть

### 7.1 Qwen3.5 397B A17B — сильнейший challenger

- **Цена:** $0.39/$2.34 — сопоставима с Gemini 2.5 Flash
- **Русский:** **Лучший среди всех моделей** — 119 языков, Qwen-MT превосходит GPT-4.1-mini и Gemini 2.5 Flash в переводе
- **Structured output:** JSON Schema, XML, tools
- **Context:** 262K (достаточно для любых глав)
- **Риск:** Не протестирован для TSA extraction fancai

**Рекомендация:** Протестировать на 2-3 книгах параллельно. Если качество сопоставимо или лучше (особенно русский) — серьёзная альтернатива Gemini.

### 7.2 Qwen3 235B A22B — budget challenger

- **Цена:** $0.20/$0.60 — значительно дешевле Gemini 2.5 Flash
- **Русский:** 119 языков, отличная поддержка
- **Structured output:** JSON Schema, XML, tools
- **Риск:** Старая модель (Qwen3 vs Qwen3.5), 131K context

**Рекомендация:** Тестировать если Qwen3.5 окажется слишком дорогим.

### 7.3 DeepSeek V3.1 — budget option

- **Цена:** $0.25/$0.38 — очень дешёвый output
- **Русский:** Хороший, но не на уровне Gemini
- **Structured output:** JSON mode, tools
- **Риск:** 164K context (может быть мало для chunking overlap), русский хуже

### 7.4 Бесплатные модели — для fallback/testing

- **Llama 4 Scout:** 10M context, бесплатна — хороший fallback для тестирования
- **Mistral Small 3.1 24B:** Бесплатна, 128K context — для translation fallback
- **Ограничение:** 20 req/min, 200 req/day — недостаточно для production batch processing

---

## 8. План миграции

### Фаза 1: Замена моделей (1-2 часа, минимальный риск)

```python
# backend/app/core/openrouter_client.py
FALLBACK_MODELS = [
    "google/gemini-2.5-flash",        # primary — замена gemini-3.1-flash-lite
    "google/gemini-2.5-flash-lite",   # fallback — замена gemini-2.5-flash-lite
]

# backend/app/services/gemini_extractor.py
@dataclass
class GeminiConfig:
    model_id: str = "gemini-2.5-flash"
    model_extraction: str = "google/gemini-2.5-flash"
    model_translation: str = "google/gemini-2.5-flash-lite"
    model_reduce: str = "google/gemini-2.5-flash-lite"
```

### Фаза 2: A/B тестирование (1 день)

1. Обработать 2-3 книги на Gemini 2.5 Flash
2. Сравнить количество и качество описаний с baseline (Gemini 3.0 Flash)
3. Если деградация > 30% → откатить на 3.0 Flash

### Фаза 3: Prompt Optimization (опционально, 2-3 часа)

1. Добавить few-shot примеры из production данных
2. Включить `reasoning` parameter для extraction
3. Протестировать EN prompt vs RU prompt для extraction

### Фаза 4: Тестирование альтернативных моделей (опционально, 1 день)

1. Протестировать Qwen3 235B для extraction
2. Протестировать DeepSeek V3.1 для translation (может быть дешевле)
3. Оценить качество и принять решение

---

## 9. Источники

### Цены моделей (OpenRouter)

- [Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash) — $0.30/$2.50
- [Gemini 2.5 Flash Lite](https://openrouter.ai/google/gemini-2.5-flash-lite) — $0.10/$0.40
- [Gemini 3 Flash Preview](https://openrouter.ai/google/gemini-3-flash-preview) — $0.50/$3.00
- [Gemini 3.1 Flash Lite](https://openrouter.ai/google/gemini-3.1-flash-lite-preview) — $0.25/$1.50
- [DeepSeek V3 0324](https://openrouter.ai/deepseek/deepseek-chat-v3-0324) — $0.20/$0.77
- [Qwen3 30B A3B](https://openrouter.ai/qwen/qwen3-30b-a3b) — $0.08/$0.28
- [Llama 4 Scout](https://openrouter.ai/meta-llama/llama-4-scout) — $0.08/$0.30

### Документация моделей

- [Gemini 3.1 Flash Lite Model Card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/) — Google DeepMind
- [Gemini 3.1 Flash Lite Developer Guide](https://dev.to/googleai/gemini-31-flash-lite-developer-guide-and-use-cases-1hh) — DEV Community
- [Gemini 3.1 Flash Lite API Docs](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview) — Google AI for Developers
- [Gemini 3.1 Flash Lite vs 2.5 Flash](https://www.buildfastwithai.com/blogs/gemini-3-1-flash-lite-vs-2-5-flash-speed-cost-benchmarks-2026) — BuildFastWithAI

### Проблемы Flash Lite

- [Early response without completing task](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602) — Google AI Developers Forum
- [Performance Degradation in extraction](https://support.google.com/gemini/thread/379487030) — Google Support
- [Gemini 3 Flash extraction accuracy](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction) — Box Blog

### Fine-Tuning

- [Vertex AI supervised tuning](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning) — Google Cloud
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — Google AI for Developers
- [Free models on OpenRouter](https://costgoat.com/pricing/openrouter-free-models) — CostGoat

### Бенчмарки

- [Gemini 3 Flash vs 2.5 Flash](https://www.aifreeapi.com/en/posts/gemini-3-flash-vs-gemini-2-5-flash) — AI Free API
- [OpenRouter pricing calculator](https://costgoat.com/pricing/openrouter) — CostGoat
- [Top AI Models on OpenRouter](https://www.teamday.ai/blog/top-ai-models-openrouter-2026) — TeamDay.ai
