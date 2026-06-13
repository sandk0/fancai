# Исследование: Gemini Context Caching + Batch API

> Дата: 2026-03-30
> Цель: Оптимизация стоимости LLM-вызовов для fancai через кеширование промптов и пакетную обработку
> Контекст: TSA_EXTRACTION_PROMPT ~737 токенов, 50 глав/книга, ~200 LLM-вызовов на книгу

---

## Часть 1: Context Caching

### 1.1 Explicit Caching (ручное)

**Как создать кеш (Python SDK `google-genai`):**

```python
from google import genai
from google.genai import types

client = genai.Client()

cache = client.caches.create(
    model='models/gemini-2.5-flash',
    config=types.CreateCachedContentConfig(
        display_name='tsa-extraction-prompt',
        system_instruction='Ты - опытный литературный редактор...',
        contents=[{
            'parts': [{'text': 'few-shot примеры...'}],
            'role': 'user'
        }],
        ttl="3600s",  # 1 час
    )
)

# Использование кеша
response = client.models.generate_content(
    model='models/gemini-2.5-flash',
    contents='Текст главы...',
    config=types.GenerateContentConfig(cached_content=cache.name)
)
```

**TTL:**

- По умолчанию: 1 час
- Минимум: не ограничен явно (можно задать `"60s"`)
- Максимум: не ограничен явно
- Обновляемый: да, через `client.caches.update()`

**Стоимость хранения:**

- $1.00 / 1M токенов / час (для всех моделей)

**Стоимость чтения кешированных токенов (Google AI Studio / Direct):**

| Модель                 | Input (обычный) | Input (кеш) | Скидка |
| ---------------------- | --------------- | ----------- | ------ |
| Gemini 2.5 Flash       | $0.30/1M        | $0.03/1M    | 90%    |
| Gemini 2.5 Pro         | $1.25/1M        | $0.313/1M   | 75%    |
| Gemini 3 Flash Preview | $0.50/1M        | $0.05/1M    | 90%    |
| Gemini 3.1 Flash-Lite  | $0.25/1M        | $0.025/1M   | 90%    |

**Минимальный размер кеша:**

| Модель                 | Минимум токенов |
| ---------------------- | --------------- |
| Gemini 3 Flash Preview | 1,024           |
| Gemini 3 Pro Preview   | 4,096           |
| Gemini 2.5 Flash       | 1,024           |
| Gemini 2.5 Pro         | 4,096           |

**Поддерживаемые модели:** Все Gemini 2.0+ (2.5 Flash, 2.5 Pro, 3 Flash, 3 Pro, 3.1 Flash-Lite)

**Кеширование system_instruction:**

- ДА, system_instruction можно кешировать отдельно
- system_instruction входит в `CreateCachedContentConfig`
- Токены system_instruction + contents суммарно должны достичь минимума
- **ОГРАНИЧЕНИЕ**: при использовании cached_content в запросе НЕЛЬЗЯ передавать system_instruction, tools или tool_config — они должны быть в кеше

**Кеширование system_instruction + few-shot примеров:**

- ДА, можно поместить оба в один кеш
- system_instruction идёт в `system_instruction` поле
- Few-shot примеры идут в `contents` как пары user/model сообщений

### 1.2 Implicit Caching (автоматическое)

**Как работает:**

- Включено по умолчанию для всех моделей Gemini 2.5+
- Никаких действий со стороны разработчика не требуется
- Если запрос имеет общий префикс с предыдущим запросом, происходит cache hit
- Google автоматически передаёт скидку
- Работает на уровне prefix matching — стабильный контент должен быть в начале промпта

**Поддерживаемые модели:** Gemini 2.5 Flash, 2.5 Pro, 3.x (все модели 2.5+)

**Скидка:**

- Gemini 2.5+: **90%** на закешированные токены
- Gemini 2.0: 75%

**Требования:**

- Одинаковый префикс между запросами
- Минимум 1,024 токена (2.5 Flash) / 2,048 (2.5 Pro)
- Тот же аккаунт, та же модель

**Гарантии: НИКАКИХ**

- Best-effort: скидка применяется только при cache hit
- Google не гарантирует, что hit произойдёт
- На практике hit rate высокий для последовательных запросов с одним промптом

### 1.3 Наша ситуация: TSA_EXTRACTION_PROMPT = ~737 токенов

**ПРОБЛЕМА: 737 токенов < 1,024 минимума для Gemini 2.5 Flash**

**Варианты решения:**

#### Вариант A: Добавить few-shot примеры (РЕКОМЕНДУЕТСЯ)

Наш промпт уже содержит 3 примера в самом тексте (~300 токенов). Нужно добавить ещё ~287 токенов. Варианты:

1. Добавить 2-3 дополнительных позитивных примера
2. Добавить примеры сложных edge-cases (диалоги с описаниями внутри)
3. Добавить пример полного ответа (input + expected output)

Дополнительные примеры не просто "padding" — они реально улучшают качество экстракции.

#### Вариант B: system_instruction + contents

```python
# system_instruction (~737 токенов) + few-shot contents (~300+ токенов) = ~1037+ токенов
cache = client.caches.create(
    model='models/gemini-2.5-flash',
    config=types.CreateCachedContentConfig(
        system_instruction=TSA_EXTRACTION_PROMPT_WITHOUT_TEXT,  # ~737 токенов
        contents=[
            # Few-shot пара 1
            {'parts': [{'text': 'Пример входного текста 1'}], 'role': 'user'},
            {'parts': [{'text': 'Пример ответа 1 с тегами'}], 'role': 'model'},
            # Few-shot пара 2
            {'parts': [{'text': 'Пример входного текста 2'}], 'role': 'user'},
            {'parts': [{'text': 'Пример ответа 2 с тегами'}], 'role': 'model'},
        ],
        ttl="3600s",
    )
)
```

**Считается ли system_instruction в минимум?**

- Документация не даёт явного ответа
- По всем признакам — ДА, system_instruction + contents суммарно должны достичь минимума
- Форум Google: один пользователь сообщил, что кеш не работал при ~1300 токенах, что может указывать на более высокий фактический минимум

#### Вариант C: Implicit caching через OpenRouter (ПРОЩЕ ВСЕГО)

Поскольку fancai использует OpenRouter, implicit caching работает автоматически:

- Промпт один и тот же для всех глав книги
- При последовательной обработке глав prefix совпадает
- Минимум 1,024 токена для 2.5 Flash
- **НО**: наш промпт 737 токенов + текст главы — суммарный input > 1024, но кешируется только общий ПРЕФИКС

**ВАЖНО для implicit caching:**

- Кешируется ПРЕФИКС запроса, а не весь запрос
- Если промпт (737 токенов) < 1024, то даже в составе большего запроса он может НЕ закешироваться
- Нужно довести промпт до 1024+ токенов

### 1.4 Формулы стоимости

**Explicit Caching (Google AI Studio Direct):**

Переменные:

- N = количество запросов (глав)
- P_input = цена обычного input ($0.30/1M для 2.5 Flash)
- P_cached = цена cached input ($0.03/1M для 2.5 Flash)
- P_storage = цена хранения ($1.00/1M/час)
- T_prompt = размер промпта в токенах (737, или 1024+ после padding)
- T_hours = время обработки в часах

```
Стоимость БЕЗ кеша = N * T_prompt * P_input
Стоимость С кешем  = T_prompt * P_storage * T_hours + N * T_prompt * P_cached + (создание кеша: бесплатно)
Экономия = (N * T_prompt * P_input) - (T_prompt * P_storage * T_hours + N * T_prompt * P_cached)
```

**Расчёт для fancai (50 глав, 1024 токена промпта, Gemini 2.5 Flash):**

```
БЕЗ кеша:   50 * 1024/1M * $0.30 = $0.01536
С кешем:    1024/1M * $1.00 * 1ч  + 50 * 1024/1M * $0.03
          = $0.001024 + $0.001536
          = $0.002560
Экономия:   $0.01536 - $0.00256 = $0.01280 (83% экономия)
```

**Break-even (при каких N кеш окупается):**

```
N * T * P_input > T * P_storage * H + N * T * P_cached
N * (P_input - P_cached) > P_storage * H
N > (P_storage * H) / (P_input - P_cached)
N > ($1.00 * 1) / ($0.30 - $0.03) = 3.7 запроса
```

**Кеш окупается уже после ~4 запросов** при TTL = 1 час.

**Через OpenRouter (implicit caching):**

На OpenRouter pricing для Gemini 2.5 Flash:

- Input: $0.30/1M
- Cache read: $0.03/1M (0.1x)
- Cache write: $0.08/1M
- Нет платы за хранение (implicit)

```
Экономия на промпте при cache hit: 90%
50 глав * 1024 токенов * ($0.30 - $0.03)/1M = $0.01382 экономия
```

**ВЫВОД**: Экономия на промпте — копейки. Но промпт это ~1% от общего input. Основной расход — текст глав (~100K символов = ~25K-50K токенов).

### 1.5 Реальная экономия — кеширование текста главы

Implicit caching кеширует ПРЕФИКС. Если промпт стабилен между запросами, все ~737 токенов (или 1024+ после padding) кешируются автоматически.

Но кеширование промпта экономит мало. Настоящая экономия — если обработать главу несколько раз (retry, разные задачи):

```
Одна глава ~30K токенов * $0.30/1M = $0.009
С кешем: $0.009 * 0.1 = $0.0009
Экономия: $0.0081 за retry
```

---

## Часть 2: Batch API

### 2.1 Как работает

**Отправка пакета:**

```python
from google import genai

client = genai.Client()

# Вариант 1: Inline (до 20MB)
inline_requests = [
    {
        'contents': [{'parts': [{'text': f'{TSA_PROMPT}\n{chapter_text}'}], 'role': 'user'}]
    }
    for chapter_text in chapters
]

batch_job = client.batches.create(
    model="gemini-2.5-flash",
    src=inline_requests,
    config={'display_name': "book-processing-job-1"}
)

# Вариант 2: Файл JSONL (до 2GB)
import json

with open("chapters.jsonl", "w") as f:
    for i, chapter in enumerate(chapters):
        request = {
            "key": f"chapter-{i}",
            "request": {
                "contents": [{"parts": [{"text": f"{TSA_PROMPT}\n{chapter}"}]}]
            }
        }
        f.write(json.dumps(request) + "\n")

uploaded_file = client.files.upload(
    file='chapters.jsonl',
    config=types.UploadFileConfig(display_name='book-chapters', mime_type='jsonl')
)

batch_job = client.batches.create(
    model="gemini-2.5-flash",
    src=uploaded_file.name,
    config={'display_name': "book-processing-file"}
)
```

**Скидка:**

- **50% на всё** (input tokens + output tokens)
- Gemini 2.5 Flash: $0.15/1M input, $1.25/1M output (вместо $0.30/$2.50)

**Максимальная латентность:**

- SLO: 24 часа
- На практике: значительно быстрее (зависит от загрузки)
- Через 48 часов: job EXPIRES (статус `JOB_STATE_EXPIRED`)

**Максимальный размер:**

- Inline: 20MB суммарный размер запроса
- Файл: 2GB на файл
- Количество запросов: не ограничено явно (сотни тысяч в одном пакете)

**Polling:**

```python
import time

completed_states = {'JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED',
                   'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'}

batch_job = client.batches.get(name=batch_job.name)
while batch_job.state.name not in completed_states:
    time.sleep(30)
    batch_job = client.batches.get(name=batch_job.name)

# Получение результатов
if batch_job.state.name == 'JOB_STATE_SUCCEEDED':
    # Inline results
    if batch_job.dest and batch_job.dest.inlined_responses:
        for resp in batch_job.dest.inlined_responses:
            if resp.response:
                print(resp.response.text)
    # File results
    elif batch_job.dest and batch_job.dest.file_name:
        content = client.files.download(file=batch_job.dest.file_name)
        for line in content.decode('utf-8').strip().split('\n'):
            result = json.loads(line)
            # result содержит response или error
```

### 2.2 Совместимость

**Batch API + Context Caching:**

- ДА, совместимы
- НО: кешированные токены НЕ получают batch-скидку
- Кешированные токены биллятся по стандартной cached-цене ($0.03/1M для 2.5 Flash)
- Скидки НЕ складываются: кеш (90%) ИЛИ batch (50%), не 95%

**Structured Output:**

- ДА, поддерживается

```python
inline_requests = [{
    'contents': [{'parts': [{'text': 'Cookie recipes?'}], 'role': 'user'}],
    'config': {
        'response_mime_type': 'application/json',
        'response_schema': list[Recipe]
    }
}]
```

**Thinking (reasoning):**

- Не подтверждено явно в документации
- Gemini 2.5 Flash поддерживает thinking, batch поддерживает 2.5 Flash
- Вероятно работает (reasoning tokens биллятся как output tokens)

**System Instructions:**

- ДА, поддерживаются на уровне каждого запроса в пакете

**Tools (function calling, Google Search):**

- ДА, поддерживаются на уровне каждого запроса

### 2.3 Python SDK (google-genai)

- Все операции синхронные через `client.batches.*`
- Async: не упоминается в документации batch API
- Polling: ручной через `client.batches.get()` в цикле
- Операции: `create()`, `get()`, `list()`, `cancel()`, `delete()`

### 2.4 Применимость для fancai

**Текущая архитектура:**

- 50 глав/книга, ~200 LLM-вызовов (TSA + legacy + entity synthesis + dedup)
- Обработка через Celery tasks
- OpenRouter как прокси (не прямой Google API)

**Проблема: fancai использует OpenRouter, а Batch API — только Google AI Studio напрямую**

OpenRouter НЕ предоставляет Batch API. Для использования нужно:

1. Прямое подключение к Google AI Studio (`google-genai` SDK)
2. API ключ `GOOGLE_API_KEY` (не `OPENROUTER_API_KEY`)
3. Отдельная логика для batch vs. realtime

**Расчёт экономии (50 глав, ~30K токенов/глава, Gemini 2.5 Flash):**

```
Общий input:  50 * 30K = 1.5M токенов
Общий output: 50 * 5K  = 250K токенов (оценка)

БЕЗ batch (OpenRouter):
  Input:  1.5M * $0.30/1M  = $0.450
  Output: 0.25M * $2.50/1M = $0.625
  Итого:                    = $1.075

С batch (Google Direct, 50%):
  Input:  1.5M * $0.15/1M  = $0.225
  Output: 0.25M * $1.25/1M = $0.3125
  Итого:                    = $0.5375

Экономия: $0.5375 / книга (50%)
```

**50 книг в месяц: $53.75 → $26.88 = экономия $26.87/мес**

---

## Часть 3: Сводная таблица стратегий

| Стратегия                                   | Экономия                      | Сложность    | Требует Google Direct? |
| ------------------------------------------- | ----------------------------- | ------------ | ---------------------- |
| Implicit caching (OpenRouter, уже работает) | 0-90% на промпт (best-effort) | 0 (уже есть) | НЕТ                    |
| Explicit caching (Google Direct)            | 90% на промпт (гарантировано) | Средняя      | ДА                     |
| Batch API (Google Direct)                   | 50% на ВСЁ                    | Высокая      | ДА                     |
| Batch + Explicit Cache                      | 90% промпт + 50% остальное    | Высокая      | ДА                     |
| Довести промпт до 1024 токенов              | Улучшает cache hit rate       | Низкая       | НЕТ                    |

---

## Часть 4: Рекомендации для fancai

### Приоритет 1: Довести промпт до 1024+ токенов (СДЕЛАТЬ СЕЙЧАС)

Добавить 2-3 few-shot примера в TSA_EXTRACTION_PROMPT:

- Пример с диалогом (где описание внутри реплик)
- Пример с множественными entity events
- Пример ожидаемого structured output

Это улучшает и качество экстракции, и шансы на implicit caching через OpenRouter.

**Трудозатраты:** 1-2 часа
**Экономия:** Потенциально 90% на ~1024 токена промпта при каждом вызове (implicit cache hit)

### Приоритет 2: Batch API через Google Direct (СРЕДНИЙ ПРИОРИТЕТ)

Реализовать dual-path:

- OpenRouter для realtime (просмотр книги, генерация по запросу)
- Google Direct Batch API для фоновой обработки целых книг

**Трудозатраты:** 8-16 часов
**Экономия:** 50% на всех batch-вызовах ≈ $0.54/книга

### Приоритет 3: Explicit Caching + Batch (НИЗКИЙ ПРИОРИТЕТ)

Кеширование промпта экономит копейки ($0.013/книга). Имеет смысл только если:

- Промпт вырастет до 4K+ токенов (больше few-shot примеров)
- Будет кешироваться не только промпт, но и общий контекст (метаданные книги)

---

## Часть 5: OpenRouter vs Google Direct

### OpenRouter (текущий стек)

**Плюсы:**

- Fallback chain (Gemini → Claude Haiku → Gemini Lite)
- Implicit caching бесплатно (OpenRouter передаёт скидку Google)
- Единый API для разных провайдеров
- Уже реализовано и работает

**Минусы:**

- Нет Batch API
- Implicit caching не гарантирован
- Нет явного контроля над кешем (TTL, создание, удаление)
- OpenRouter markup (обычно небольшой)

### Google Direct (для batch/caching)

**Плюсы:**

- Batch API (50% скидка)
- Explicit caching (90% гарантировано)
- Нет markup прокси

**Минусы:**

- Только Google модели (нет fallback на Claude)
- Нужен отдельный API ключ
- Нужна отдельная логика

### Рекомендация

**Гибридный подход:**

1. OpenRouter остаётся для realtime (entity synthesis, dedup, image prompts)
2. Google Direct для batch book processing (50 TSA-вызовов за раз)
3. Промпт доводится до 1024+ токенов для обоих путей

---

## Источники

- [Context Caching Docs](https://ai.google.dev/gemini-api/docs/caching)
- [Batch API Docs](https://ai.google.dev/gemini-api/docs/batch-api)
- [Gemini Pricing](https://ai.google.dev/pricing)
- [Implicit Caching Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)
- [Batch Mode Blog](https://developers.googleblog.com/en/scale-your-ai-workloads-batch-mode-gemini-api/)
- [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash)
- [Vertex AI Context Caching](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)
- [Google GenAI Python SDK](https://googleapis.github.io/python-genai/)
