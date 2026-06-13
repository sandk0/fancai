# Fine-tuning и дистилляция для Gemini моделей — исследование

**Дата:** 2026-03-30
**Контекст:** fancai entity extraction pipeline, ~500 training pairs (текст главы → extraction результат)

---

## 1. Fine-tuning Gemini через Google AI Studio

### Текущий статус (март 2026)

**Google AI Studio / Gemini API — fine-tuning НЕДОСТУПЕН.**

С мая 2025 года (после deprecated Gemini 1.5 Flash-001) в Gemini API и AI Studio нет моделей, поддерживающих fine-tuning. Google [официально подтвердил](https://ai.google.dev/gemini-api/docs/model-tuning): _"We don't have immediate plans to bring fine-tuning support back."_

### Vertex AI — fine-tuning ДОСТУПЕН

Fine-tuning работает только через **Google Cloud Vertex AI**. Поддерживаемые модели:

| Модель                    | SFT    | Метод           | Статус |
| ------------------------- | ------ | --------------- | ------ |
| Gemini 2.5 Pro            | Да     | LoRA (PEFT)     | GA     |
| Gemini 2.5 Flash          | Да     | LoRA (PEFT)     | GA     |
| **Gemini 2.5 Flash-Lite** | **Да** | **LoRA (PEFT)** | **GA** |
| Gemini 2.0 Flash          | Да     | LoRA (PEFT)     | GA     |
| Gemini 2.0 Flash-Lite     | Да     | LoRA (PEFT)     | GA     |

**Вывод:** Fine-tune Flash Lite можно, но только через Vertex AI (не AI Studio).

---

## 2. Минимальный dataset

| Параметр                   | Значение              |
| -------------------------- | --------------------- |
| Минимум для простых задач  | ~20 примеров          |
| Рекомендация Google        | 100–500 примеров      |
| Максимум токенов на пример | 131,072               |
| Формат                     | JSONL (Cloud Storage) |

**Наши 500 training pairs — идеальный размер.** Google рекомендует 100-500 для оптимальных результатов. Качество данных важнее количества.

### Формат данных (JSONL)

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Извлеки персонажей и локации из текста: ..." }]
    },
    { "role": "model", "parts": [{ "text": "{\"entities\": [...]}" }] }
  ]
}
```

---

## 3. Стоимость fine-tuning через Vertex AI

### Обучение

| Модель                    | Стоимость обучения             |
| ------------------------- | ------------------------------ |
| Gemini 2.0 Flash          | $3.00 / 1M training tokens     |
| **Gemini 2.0 Flash Lite** | **$1.00 / 1M training tokens** |

Training tokens = размер dataset \* кол-во эпох.

### Расчёт для наших данных (~500 pairs)

Предположения: ~2,000 токенов/пример (input + output), 5 эпох:

- 500 примеров \* 2,000 токенов = 1M токенов на эпоху
- 1M \* 5 эпох = 5M training tokens
- **Flash Lite: 5M \* $1.00 = ~$5.00 за обучение**
- **Flash: 5M \* $3.00 = ~$15.00 за обучение**

### Inference (fine-tuned модель)

**Цена идентична базовой модели — надбавки нет.**

| Модель                | Input     | Output   |
| --------------------- | --------- | -------- |
| Gemini 2.0 Flash      | $0.15/1M  | $0.60/1M |
| Gemini 2.0 Flash Lite | $0.075/1M | $0.30/1M |

**Вывод:** Fine-tuning крайне дешёвый (~$5 для Flash Lite). Инференс без наценки.

### Дополнительные затраты Vertex AI

- Нужен Google Cloud аккаунт с включённым billing
- Хранение модели — минимальная стоимость
- Нет отдельной платы за endpoint (платишь только за inference)

---

## 4. Fine-tuned модель через OpenRouter

### Короткий ответ: НЕТ

OpenRouter — API gateway к публичным моделям. **Кастомные fine-tuned модели через OpenRouter использовать нельзя.** OpenRouter предоставляет только стандартные модели от провайдеров.

### Варианты доступа к fine-tuned Gemini

| Вариант                     | Осуществимость | Примечания                                         |
| --------------------------- | -------------- | -------------------------------------------------- |
| Vertex AI endpoint напрямую | **Да**         | Стандартный путь, прямой Google API                |
| Через OpenRouter            | Нет            | Не поддерживает кастомные модели                   |
| Через LiteLLM proxy         | **Да**         | Самохостимый gateway, можно проксировать Vertex AI |
| Через Google AI Studio      | Нет            | Fine-tuning там недоступен                         |

### Влияние на архитектуру fancai

Сейчас fancai использует OpenRouter (OPENROUTER_API_KEY). Для fine-tuned модели нужно:

1. Добавить Google Cloud credentials (service account)
2. Альтернативный API client для entity extraction (Vertex AI SDK)
3. Оставить OpenRouter для остальных задач (image generation, fallback)

Или: использовать LiteLLM как единый proxy для обоих провайдеров.

---

## 5. Дистилляция Gemini Flash → Flash Lite

### Статус

Vertex AI **имеет distillation в preview** — но деталей крайне мало:

- Анонсировано как "step-by-step distillation" для создания меньших специализированных моделей
- Teacher (Flash/Pro) → Student (Flash Lite)
- Конкретная документация по API дистилляции на март 2026 **ограничена**
- Прайсинг дистилляции **не опубликован** отдельно

### Что известно

- Gemini 3.1 Flash-Lite сам по себе является результатом дистилляции из Gemini 3.1 Flash (сделано Google internally)
- Vertex AI позволяет создать кастомную дистиллированную модель, но документация в preview-состоянии
- Нет публичных case studies по user-facing distillation API

### Практичная альтернатива дистилляции

**Supervised fine-tuning Flash Lite на выходах Flash** — фактически это и есть distillation:

1. Прогнать 500 глав через Gemini 3.0 Flash (текущая модель)
2. Собрать качественные extraction результаты
3. Fine-tune Flash Lite на этих парах
4. Получить "дистиллированную" модель за ~$5

**Это рекомендуемый подход** — проще, документированнее, дешевле формальной дистилляции.

---

## 6. Альтернативы: fine-tuning открытых моделей

### Together AI

| Параметр               | Значение                              |
| ---------------------- | ------------------------------------- |
| Модели                 | Qwen3, Llama 4, DeepSeek, Gemma 3     |
| LoRA fine-tuning       | $0.48/1M tokens (до 16B)              |
| Full fine-tuning       | $0.54/1M tokens (до 16B)              |
| Крупные модели (>100B) | $2.90/1M tokens (LoRA)                |
| Structured output      | Поддерживается (tool calls в dataset) |
| Inference              | Отдельная стоимость после обучения    |

Для наших 500 примеров _ 5 эпох _ 2K токенов = 5M tokens:

- **LoRA на Qwen3-8B: ~$2.40** (дешевле Vertex AI!)
- Inference: через Together API или self-hosted GGUF

### Gemma 3 (бесплатный вариант)

| Параметр    | Значение                               |
| ----------- | -------------------------------------- |
| Размеры     | 1B, 4B, 12B, 27B                       |
| Fine-tuning | Бесплатно через Google Colab + Unsloth |
| Языки       | 140+, включая русский                  |
| VRAM        | 4-bit: Tesla T4 (бесплатный Colab)     |
| Скорость    | 1.6x быстрее с Unsloth vs стандарт     |

**Плюсы:** бесплатно, open-source, хорошая поддержка русского
**Минусы:** нужен self-hosting для inference, качество ниже Gemini API моделей

### Qwen3 через OpenRouter (без fine-tuning)

Qwen3 модели доступны на OpenRouter (66 вариантов). Для extraction задач интересны:

- **Qwen3.5-9B** — хороший баланс цена/качество
- **Qwen3-235B** — максимальное качество

Qwen 2.5+ отмечен как подходящий для "JSON extraction, entity extraction, classification".

### Сравнительная таблица альтернатив

| Вариант                        | Стоимость обучения | Inference стоимость | Качество (оценка)  | Сложность |
| ------------------------------ | ------------------ | ------------------- | ------------------ | --------- |
| Gemini Flash Lite SFT (Vertex) | ~$5                | $0.075-0.30/1M      | Высокое            | Средняя   |
| Together AI (Qwen3-8B LoRA)    | ~$2.40             | ~$0.20/1M           | Среднее-высокое    | Средняя   |
| Gemma 3 12B (Colab+Unsloth)    | Бесплатно          | Self-host           | Среднее            | Высокая   |
| Без fine-tuning (prompt opt.)  | $0                 | Текущие расценки    | Зависит от промпта | Низкая    |

---

## 7. Prompt optimization для Lite моделей

### Официальные рекомендации Google

Из [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies):

1. **Few-shot обязателен:** _"We recommend to always include few-shot examples in your prompts. Prompts without few-shot examples are likely to be less effective."_
2. **Consistent formatting:** Все примеры должны иметь одинаковую структуру
3. **Structured output:** Использовать `responseSchema` для строгого JSON (не полагаться на промпт)
4. **PTCF framework:** Persona → Task → Context → Format
5. **Температура:** Gemini 3 оптимизирован для temperature=1.0 — понижение может деградировать качество

### Flash Lite специфика

Gemini 3.1 Flash-Lite оптимизирован для:

- Entity extraction
- Classification
- Lightweight data processing pipelines
- Structured JSON output

**Это идеально совпадает с нашей задачей entity extraction.**

---

## 8. Few-shot vs Zero-shot для extraction задач

### Данные исследований

| Подход                  | Accuracy (extraction) | Примечания                         |
| ----------------------- | --------------------- | ---------------------------------- |
| Zero-shot               | ~19% (baseline)       | Только для простых, знакомых задач |
| Few-shot (2-8 примеров) | ~97%                  | 15-40% лучше zero-shot             |
| Fine-tuning             | ~97-99%               | Окупается при >100K вызовов        |

### Рекомендация для fancai

**Few-shot c 3-5 примерами** — оптимальный баланс для текущего объёма:

- Добавить 3-5 примеров extraction из русского текста прямо в промпт
- Использовать `responseSchema` для enforcement JSON структуры
- Экономия: не нужен fine-tuning при малом объёме вызовов

**Fine-tuning окупается при масштабе:** если entity extraction вызывается >100K раз, экономия на промпт-токенах (few-shot примеры в каждом запросе) превысит стоимость обучения.

Расчёт: 5 few-shot примеров \* ~500 токенов = 2,500 доп. input tokens на запрос. При 100K запросов = 250M лишних tokens = ~$18.75 на Flash Lite. Fine-tuning стоит ~$5. **Breakeven: ~27K запросов.**

---

## 9. Язык промпта: EN vs RU

### Данные

- Gemini Pro: English accuracy 95.5%, Russian accuracy 96.0% — **практически идентично**
- Gemini 3 multilingual: mainstream pairs ~98% accuracy
- Gemini 3.1 Flash-Lite: 140+ языков

### Рекомендация для extraction из русского текста

| Аспект              | EN prompt                          | RU prompt                         |
| ------------------- | ---------------------------------- | --------------------------------- |
| Инструкции модели   | Лучше на EN (больше training data) | Работает, но чуть менее стабильно |
| Контент анализа     | —                                  | Текст уже на RU                   |
| Few-shot примеры    | Вывод на RU, инструкция на EN      | Полностью на RU                   |
| Названия полей JSON | EN (entities, locations)           | Можно RU, но EN стабильнее        |

**Оптимальная стратегия для fancai:**

- Системный промпт и инструкции — **на английском**
- Few-shot примеры — **с русским текстом и русским выводом**
- JSON schema keys — **на английском**
- Это текущий подход и он оптимален

---

## Итоговые рекомендации

### Приоритет 1: Prompt optimization (бесплатно, сейчас)

1. Добавить 3-5 few-shot примеров в extraction промпт
2. Использовать `responseSchema` для strict JSON
3. Убедиться что инструкции на EN, примеры с RU-текстом
4. Тестировать с Gemini 3.1 Flash Lite — модель оптимизирована для extraction

### Приоритет 2: Fine-tuning Flash Lite на Vertex AI (~$5, неделя работы)

1. Подготовить 500 training pairs в JSONL формате
2. Создать Google Cloud project + Vertex AI
3. SFT на Gemini 2.0/2.5 Flash Lite (LoRA)
4. Заменить OpenRouter → Vertex AI для entity extraction
5. Сохранить OpenRouter для остальных AI задач

### Приоритет 3: "Дистилляция" через SFT ($5, если качество Flash > Lite)

1. Прогнать все 500 глав через Gemini 3.0 Flash
2. Собрать "золотой" dataset
3. Fine-tune Flash Lite на выходах Flash
4. Получить качество Flash по цене Flash Lite

### НЕ рекомендуется

- Google AI Studio fine-tuning — недоступен
- Формальная Vertex AI distillation — preview, мало документации
- Self-hosting Gemma 3 — overhead на инфраструктуру не оправдан при текущих объёмах
- Together AI fine-tuning — дешевле, но добавляет ещё одного провайдера

---

## Источники

- [Google AI: Fine-tuning with the Gemini API](https://ai.google.dev/gemini-api/docs/model-tuning)
- [Vertex AI: About supervised fine-tuning for Gemini](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning)
- [Vertex AI: Tune Gemini using SFT](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-use-supervised-tuning)
- [Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Gemini 3.1 Flash-Lite announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)
- [Gemini 3.1 Flash-Lite model card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/)
- [Google AI: Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- [Gemini 3 prompting guide (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide)
- [Gemini 2.5 Updates: Flash/Pro GA, SFT, Flash-Lite on Vertex AI](https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-lite-flash-pro-ga-vertex-ai)
- [Together AI: Fine-tuning pricing](https://docs.together.ai/docs/fine-tuning-pricing)
- [Together AI: Fine-tuning platform updates](https://www.together.ai/blog/fine-tuning-updates-sept-2025)
- [Unsloth: Fine-tune Gemma 3](https://unsloth.ai/blog/gemma3)
- [Google AI Forum: Fine-tuning Flash Lite 2.0](https://discuss.ai.google.dev/t/fine-tuning-gemini-flash-lite-2-0/86371)
- [OpenRouter: Google models](https://openrouter.ai/google)
- [Gemini multilingual evaluation](https://medium.com/@lars.chr.wiik/googles-gemini-pro-how-multilingual-is-it-c88ed07d0857)
