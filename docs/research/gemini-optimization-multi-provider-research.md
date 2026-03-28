# Исследование: Оптимизация Gemini API и Multi-Provider архитектура

> Дата: 2026-03-25 | Контекст: fancai v1.4 — оптимизация обработки книг
> Текущий стек: Gemini 3.0 Flash через OpenRouter, ~$5.12/книга (50 глав)

---

## Task 1: Gemini Context Caching

### Типы кеширования

**Implicit caching** — автоматическое, включено по умолчанию для Gemini 2.5+. Нет гарантии экономии — скидка применяется только при cache hit. Никакой конфигурации не требуется.

- Источник: [Google Developers Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)

**Explicit caching** — ручное управление кешем через API. Гарантированная скидка при использовании `cached_content`. Требует создания cache объекта с TTL.

- Источник: [Gemini API Caching Docs](https://ai.google.dev/gemini-api/docs/caching)

### Точные цены (март 2026)

| Модель                 | Standard Input | Cached Input | Скидка | Storage/1M tokens/hour |
| ---------------------- | -------------- | ------------ | ------ | ---------------------- |
| Gemini 3 Flash Preview | $0.50/1M       | $0.05/1M     | 90%    | $1.00                  |
| Gemini 2.5 Flash       | $0.30/1M       | $0.03/1M     | 90%    | $1.00                  |
| Gemini 2.5 Flash-Lite  | $0.10/1M       | $0.01/1M     | 90%    | $1.00                  |
| Gemini 3.1 Flash-Lite  | $0.25/1M       | $0.025/1M    | 90%    | $1.00                  |

- Источник: [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### Минимальные требования для explicit caching

| Модель                 | Min токенов |
| ---------------------- | ----------- |
| Gemini 3 Flash Preview | 1,024       |
| Gemini 2.5 Flash       | 1,024       |
| Gemini 2.5 Pro         | 4,096       |
| Gemini 3 Pro Preview   | 4,096       |

TTL по умолчанию: 1 час. Можно задать кастомный.

- Источник: [Context Caching Docs](https://ai.google.dev/gemini-api/docs/caching)

### Context Caching + Batch API — НЕСОВМЕСТИМЫ (практически)

Формально Google заявляет совместимость, но на практике пользователи сообщают что batch jobs **игнорируют** `cached_content` и выдают нерелевантные ответы.

- Источник: [Google AI Forum — Context Caching + Batch](https://discuss.ai.google.dev/t/context-caching-batch-api-requests/105642)
- Источник: [Google AI Forum — How to send cached content to batch](https://discuss.ai.google.dev/t/how-do-i-send-cached-content-to-a-batch-job/71942)

**Вывод: НЕ рассчитывать на совмещение.** Выбирать одно из двух.

### Context Caching через OpenRouter

OpenRouter поддерживает кеширование для Gemini 2.5 Flash/Pro через `cache_control` breakpoints.

- Min: 1,028 tokens (Flash), 2,048 tokens (Pro)
- TTL: 5 минут (НЕ обновляется)
- Sticky routing для поддержки cache hit rate
- Источник: [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)

### Расчёт для fancai

System prompt: ~2-5K tokens (одинаковый для всех 50 глав).

**Explicit caching (direct Gemini API):**

- 5K tokens = 0.005M tokens
- Storage: $1.00 × 0.005 = $0.005/час
- Input экономия на 50 глав: 50 × 0.005M × ($0.50 - $0.05) = $0.1125
- Storage за 1 час обработки: $0.005
- **Чистая экономия: ~$0.11 на книгу** — мизерная
- Причина: system prompt слишком маленький (2-5K tokens). Кеширование выгодно от 32K+ tokens.

**Implicit caching (через OpenRouter):**

- Бесплатно, включено по умолчанию
- Если запросы идут быстро (< 5 мин между ними), cache hit вероятен
- Никаких дополнительных действий не требуется

**Рекомендация:** Не тратить время на explicit caching. Implicit caching через OpenRouter уже работает. Экономия на system prompt ничтожна при таком маленьком размере.

---

## Task 2: Gemini Batch API

### Подтверждённые характеристики

| Параметр          | Значение                                                        |
| ----------------- | --------------------------------------------------------------- |
| Скидка            | 50% от стандартной цены                                         |
| Target SLA        | 24 часа (обычно 2-3 часа)                                       |
| Expire            | 48 часов (JOB_STATE_EXPIRED)                                    |
| Max файл          | 2 GB JSONL / 20 MB inline                                       |
| Max запросов      | Нет явного лимита (ограничение по размеру файла)                |
| Structured output | ДА (через native SDK: `response_mime_type` + `response_schema`) |

- Источник: [Gemini Batch API Docs](https://ai.google.dev/gemini-api/docs/batch-api)
- Источник: [Google Developers Blog — Batch Mode](https://developers.googleblog.com/en/scale-your-ai-workloads-batch-mode-gemini-api/)

### Structured Output: Native SDK vs OpenAI Compat

| Подход                                | Batch API   | Structured Output                |
| ------------------------------------- | ----------- | -------------------------------- |
| Native Gemini SDK (`response_schema`) | YES         | YES                              |
| OpenAI Compat (`json_schema`)         | YES (batch) | **NO** — отклоняет `json_schema` |
| OpenAI Compat (`json_object`)         | YES         | Частично (без strict schema)     |

**Workaround:** Использовать native Gemini SDK (`google-genai`) для batch запросов, НЕ OpenAI compatibility layer.

- Источник: [Google AI Forum — Structured Outputs in Batch](https://discuss.ai.google.dev/t/structured-outputs-in-batch-using-openai-compatibility-mode/126309)

### Проблемы надёжности — КРИТИЧНО

Множественные отчёты о stuck jobs:

- Jobs в PROCESSING 72+ часов без прогресса
- Jobs застревают в PENDING 26+ часов
- Batch outages без предупреждения
- Batches 150K-500K запросов ранее работали, теперь fail
- Источник: [Forum — 72h stuck](https://discuss.ai.google.dev/t/batch-api-jobs-stuck-in-processing-for-72-hours/114081)
- Источник: [Forum — 26h pending](https://discuss.ai.google.dev/t/batch-api-job-stuck-in-pending-state-for-over-26-hours/114473)
- Источник: [GitHub Issue — 24h+ pending](https://github.com/googleapis/python-genai/issues/1482)
- Источник: [Forum — Batch outage](https://discuss.ai.google.dev/t/batch-api-outage/116315)

### Расчёт для fancai (Batch API)

Текущая стоимость: $5.12/книга через Gemini 3 Flash @ OpenRouter.

**С Batch API (50% скидка):**

- Input: $0.25/1M (вместо $0.50)
- Output: $1.50/1M (вместо $3.00)
- **~$2.56/книга** — экономия $2.56

**С 2.5 Flash-Lite Batch:**

- Input: $0.05/1M, Output: $0.20/1M
- **Потенциально ~$0.50-0.80/книга** — но нужно проверить качество extraction

### Рекомендация для Batch API

Использовать для free tier пользователей с оговорками:

1. **Обязательно** timeout watchdog: если job не завершился за 6 часов — перезапуск
2. Retry logic с экспоненциальным backoff
3. Fallback на synchronous API после 2 batch failures
4. Использовать native Gemini SDK (не OpenAI compat) для structured output

---

## Task 3: Актуальные цены Gemini (март 2026)

### Полная таблица моделей

| Модель                        | Input/1M | Output/1M | Batch Input | Batch Output | Статус  |
| ----------------------------- | -------- | --------- | ----------- | ------------ | ------- |
| Gemini 3 Flash Preview        | $0.50    | $3.00     | $0.25       | $1.50        | Preview |
| Gemini 3.1 Flash-Lite Preview | $0.25    | $1.50     | $0.125      | $0.75        | Preview |
| Gemini 2.5 Flash              | $0.30    | $2.50     | $0.15       | $1.25        | GA      |
| Gemini 2.5 Flash-Lite         | $0.10    | $0.40     | $0.05       | $0.20        | GA      |

Free tier: Gemini 2.5 Flash, 2.5 Flash-Lite, 3 Flash, 3.1 Flash-Lite — бесплатно с rate limits.

- Источник: [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### Gemini 3.1 Flash-Lite — новый кандидат

- Preview, вышел март 2026
- $0.25/1M input, $1.50/1M output (50% дешевле 3 Flash)
- Batch: $0.125/1M input, $0.75/1M output
- Structured output: поддерживается, ~97% compliance
- Batch API: поддерживается
- Источник: [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview)
- Источник: [Google Blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)

### Flash vs Flash-Lite для extraction

| Метрика                        | Flash    | Flash-Lite        |
| ------------------------------ | -------- | ----------------- |
| FACTS benchmark (factuality)   | 50.4%    | 40.6%             |
| Structured output compliance   | ~99%     | ~97%              |
| Цена (input)                   | $0.50/1M | $0.25/1M          |
| Подходит для entity extraction | Да       | Да (с оговорками) |

**Flash-Lite:** идеален для массовых однотипных задач (classification, extraction). Для сложного reasoning — Flash лучше.

- Источник: [Flash-Lite vs Flash comparison](https://www.verdent.ai/guides/gemini-3-1-flash-lite-vs-flash-vs-pro)
- Источник: [WaveSpeed Blog](https://wavespeed.ai/blog/posts/blog-gemini-3-1-flash-lite/)

### Рекомендация по моделям

| Tier                | Модель                      | API        | Стоимость/книга (оценка) |
| ------------------- | --------------------------- | ---------- | ------------------------ |
| Premium (realtime)  | Gemini 3 Flash              | OpenRouter | ~$5.12                   |
| Standard (realtime) | Gemini 2.5 Flash            | OpenRouter | ~$3.50                   |
| Free (batch)        | Gemini 2.5 Flash-Lite Batch | Direct API | ~$0.50-0.80              |
| Free (batch, alt)   | Gemini 3.1 Flash-Lite Batch | Direct API | ~$1.00-1.50              |

---

## Task 4: Strategy Pattern для Multi-Provider AI

### Текущая архитектура fancai

`core/openrouter_client.py` уже реализует:

- Fallback chain: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite
- Circuit breaker: 5 failures → open → 60s → half-open probe
- Два режима: `generate_text()` (JSON mode) и `generate_structured()` (JSON Schema)

### Рекомендуемая архитектура расширения

```
AIProviderStrategy (Protocol)
├── OpenRouterProvider      # Текущий (realtime, fallback chain)
├── GeminiBatchProvider     # Batch API через google-genai SDK
├── ModalVLLMProvider       # Self-hosted vLLM на Modal
└── GeminiDirectProvider    # Direct Gemini API (context caching)
```

### Паттерны из production

**1. LiteLLM Router** — готовое решение для multi-provider routing с circuit breaker, fallbacks, cost tracking. 100+ провайдеров. Но добавляет зависимость.

- Источник: [LiteLLM Router Docs](https://docs.litellm.ai/docs/routing)

**2. Самописный Strategy + Feature Flags:**

```python
class AIProvider(Protocol):
    async def extract_entities(self, text: str, schema: Type[BaseModel]) -> dict: ...
    async def generate_description(self, text: str) -> str: ...

class ProviderRouter:
    def get_provider(self, user_tier: str, task_type: str) -> AIProvider:
        if user_tier == "premium":
            return self.modal_provider  # или openrouter
        elif task_type == "batch_ok":
            return self.batch_provider
        else:
            return self.openrouter_provider
```

**3. Circuit Breaker + Retry stack:**

- `tenacity` для retry с exponential backoff
- `pybreaker` для circuit breaker
- Проблема: не шарят state между собой
- Решение: обернуть в единый middleware
- Источник: [PyBreaker](https://pypi.org/project/pybreaker/)
- Источник: [Python Discussion](https://discuss.python.org/t/how-are-you-coordinating-resilience-patterns-retry-circuit-breaker-timeout-in-python/106597)

**4. Graceful degradation chain:**

```
Modal vLLM (premium) → OpenRouter Gemini 3 Flash → OpenRouter Gemini 2.5 Flash
→ Gemini Batch (async) → Cached result → Error with retry ETA
```

### Рекомендация

НЕ внедрять LiteLLM — добавит сложность. Расширить текущий `openrouter_client.py`:

1. Выделить `AIProvider` Protocol
2. Добавить `GeminiBatchProvider` с native SDK
3. Добавить `ModalProvider` позже
4. Feature flags в `Settings` для переключения

- Источник: [Resilience Patterns in Python](https://dev.to/nebulagg/ai-agent-error-handling-4-resilience-patterns-in-python-12of)
- Источник: [LiteLLM Fallback Architecture](https://docs.litellm.ai/docs/router_architecture)

---

## Task 5: Celery + Modal Integration

### Вызов Modal из Celery worker

Modal SDK поддерживает **синхронный** `.remote()` вызов по умолчанию — блокирует текущий thread до завершения. Это идеально для Celery worker.

```python
import modal

# В Celery task:
@celery_app.task(bind=True, soft_time_limit=3600)
def process_chapter_modal(self, chapter_id: int):
    fn = modal.Function.from_name("fancai-vllm", "extract_entities")
    result = fn.remote(chapter_text=text, schema=schema)  # блокирующий вызов
    return result
```

- `.remote()` — синхронный, блокирующий (подходит для Celery)
- `.remote.aio()` — async вариант (для asyncio контекста)
- `.spawn()` — неблокирующий, возвращает `FunctionCall` для polling
- Источник: [Modal — Invoking Deployed Functions](https://modal.com/docs/guide/trigger-deployed-functions)
- Источник: [modal.Function reference](https://modal.com/docs/reference/modal.Function)

### Паттерн интеграции

```python
# modal_provider.py
import modal

class ModalProvider:
    def __init__(self, app_name: str, function_name: str):
        self._fn = modal.Function.from_name(app_name, function_name)

    def extract(self, text: str, schema: dict) -> dict:
        """Синхронный вызов — safe для Celery workers."""
        return self._fn.remote(text=text, schema=schema)

    async def extract_async(self, text: str, schema: dict) -> dict:
        """Async вызов — для FastAPI endpoints."""
        return await self._fn.remote.aio(text=text, schema=schema)
```

### asyncio.run() совместимость

Celery workers по умолчанию НЕ имеют event loop. Modal `.remote()` обрабатывает это внутренне через библиотеку `synchronicity` (их собственная).

- Источник: [Modal synchronicity library](https://github.com/modal-labs/synchronicity)

### Progress tracking: Celery → Modal → WebSocket

Рекомендуемый паттерн:

1. Celery task стартует, обновляет state через `self.update_state()`
2. Modal `.spawn()` для длинных задач, polling через `function_call.get(timeout=30)`
3. Celery periodic callback пушит прогресс в Redis pub/sub
4. FastAPI WebSocket читает из Redis и пушит клиенту

### Error propagation

Modal exceptions пробрасываются через `.remote()` как обычные Python exceptions. Celery `on_failure` handler отлавливает их.

---

## Task 6: Celery Priority Queues

### Redis broker: ограничения приоритетов

Redis **НЕ поддерживает** приоритеты нативно. Celery эмулирует их через **отдельные списки** для каждого уровня приоритета.

Конфигурация:

```python
app.conf.broker_transport_options = {
    'queue_order_strategy': 'priority',
}
```

По умолчанию 10 уровней (0-9) сжимаются в 4 реальных списка.

- Источник: [Celery Redis Priorities](https://olzhasar.com/posts/prioritizing-tasks-with-celery-and-redis/)
- Источник: [Celery Issue #4028](https://github.com/celery/celery/issues/4028)

### Критическая проблема: prefetch

Если worker prefetch 10 задач, приоритеты бесполезны. Обязательно:

```python
app.conf.worker_prefetch_multiplier = 1  # или 0 для disable
```

### Отдельные очереди vs приоритеты

| Подход                  | Pros                    | Cons                                |
| ----------------------- | ----------------------- | ----------------------------------- |
| Priority levels (Redis) | Простой конфиг          | Ненадёжный, зависит от prefetch     |
| Отдельные очереди       | Надёжный, предсказуемый | Больше конфигурации                 |
| RabbitMQ priorities     | Нативная поддержка      | Новый broker = operational overhead |

### Рекомендация: отдельные очереди

```python
# celery_app.py
app.conf.task_routes = {
    'app.tasks.book_tasks.process_book_premium': {'queue': 'premium'},
    'app.tasks.book_tasks.process_book_standard': {'queue': 'standard'},
    'app.tasks.book_tasks.process_book_batch': {'queue': 'batch'},
}

# Docker compose:
# worker-premium: celery -A app.core.celery_app worker -Q premium -c 2
# worker-standard: celery -A app.core.celery_app worker -Q premium,standard -c 2
# worker-batch: celery -A app.core.celery_app worker -Q batch -c 1
```

Ключевой момент: premium worker слушает ТОЛЬКО premium queue. Standard worker слушает premium И standard (premium приоритетнее за счёт порядка `-Q`).

НЕ мигрировать на RabbitMQ — Redis уже используется для cache и Celery broker, добавление нового компонента неоправданно.

- Источник: [Celery Routing Docs](https://docs.celeryq.dev/en/stable/userguide/routing.html)
- Источник: [RabbitMQ vs Redis for Celery](https://rabbitsecrets.com/rabbitmq-vs-redis-for-celery/)

---

## Task 7: Monitoring Stack

### Flower + Prometheus + Grafana (уже частично в проекте)

Flower экспортирует метрики на `/metrics`:

- `flower_worker_online` — живые workers
- `flower_worker_number_of_currently_executing_tasks` — нагрузка
- `flower_events_total` — lifecycle events (sent, received, started, succeeded, failed)
- `flower_task_runtime_seconds` — время выполнения
- Источник: [Flower Prometheus Integration](https://flower.readthedocs.io/en/latest/prometheus-integration.html)

Готовые Grafana dashboards:

- [Celery Monitoring #10026](https://grafana.com/grafana/dashboards/10026-celery-monitoring/)
- [Celery Tasks Overview #17509](https://grafana.com/grafana/dashboards/17509-celery-tasks-overview/)
- [Celery Tasks Dashboard #20076](https://grafana.com/grafana/dashboards/20076-celery-tasks-dashboard/)
- JSON template: [flower/examples/celery-monitoring-grafana-dashboard.json](https://github.com/mher/flower/blob/master/examples/celery-monitoring-grafana-dashboard.json)

Альтернатива Flower: [celery-exporter](https://github.com/danihodovic/celery-exporter) — меньше ресурсов, только метрики.

### Modal метрики

Modal предоставляет built-in dashboard:

- Execution time, queue time, end-to-end latency
- P50, P90, P99 percentiles
- 1-2M events/минуту обрабатываются через ClickHouse
- Источник: [ClickHouse + Modal](https://clickhouse.com/blog/modal-real-time-observability-ai-workloads)

**Datadog интеграция:** Modal имеет официальную интеграцию с Datadog.

- Источник: [Datadog Modal Integration](https://docs.datadoghq.com/integrations/modal/)

Modal **НЕ** экспортирует в Prometheus напрямую. Для единого стека нужно:

1. Использовать Modal dashboard для Modal-specific метрик
2. Custom Prometheus metrics в FastAPI для AI cost tracking

### Custom метрики для AI cost tracking

В проекте уже есть `backend/app/monitoring/metrics.py` и `backend/app/models/llm_usage_log.py`.

Рекомендуемые дополнительные метрики:

```python
# Prometheus counters/histograms
ai_request_total = Counter('ai_request_total', 'AI requests', ['provider', 'model', 'task_type'])
ai_request_cost = Counter('ai_request_cost_usd', 'AI cost in USD', ['provider', 'model'])
ai_request_duration = Histogram('ai_request_duration_seconds', 'AI request duration', ['provider'])
ai_tokens_input = Counter('ai_tokens_input_total', 'Input tokens', ['provider', 'model'])
ai_tokens_output = Counter('ai_tokens_output_total', 'Output tokens', ['provider', 'model'])
batch_job_status = Gauge('batch_job_status', 'Batch job status', ['job_id'])
```

---

## Task 8: A/B Testing для ML

### Sample size calculation

Для сравнения proportions (NER recall):

- Baseline: p1 = 0.8684 (86.84%)
- Target: p2 = 0.9184 (91.84%, MDE = 5%)
- α = 0.05, β = 0.20 (power = 80%)

Формула (two-proportion z-test):

```
n = (Z_α/2 + Z_β)² × (p1(1-p1) + p2(1-p2)) / (p2-p1)²
n = (1.96 + 0.84)² × (0.8684×0.1316 + 0.9184×0.0816) / (0.05)²
n = 7.84 × (0.1142 + 0.0749) / 0.0025
n = 7.84 × 0.1891 / 0.0025
n ≈ 593 samples per group
```

**~593 entity samples на группу** (или ~12-15 глав при ~40-50 entities/глава).

### Python инструменты

```python
from statsmodels.stats.proportion import power_proportions_2indep
from statsmodels.stats.power import zt_ind_solve_power

# Прямой расчёт:
power_proportions_2indep(
    diff=0.05,        # MDE
    prop2=0.8684,     # baseline recall
    nobs1=593,        # sample size
    alpha=0.05,
    alternative='larger'
)
```

- Источник: [statsmodels power_proportions_2indep](https://www.statsmodels.org/dev/generated/statsmodels.stats.proportion.power_proportions_2indep.html)

### BERTScore для Russian

BERTScore использует contextual embeddings вместо n-gram overlap. Поддерживает 130+ моделей.

Для русского текста:

- Рекомендуемая модель: `bert-base-multilingual-cased` или специализированная `ai-forever/ruBERT-large`
- BERTScore лучше коррелирует с human judgments чем ROUGE для Russian
- WMT18 evaluation включала Russian
- Источник: [BERTScore Paper](https://arxiv.org/abs/1904.09675)
- Источник: [BERTScore GitHub](https://github.com/Tiiiger/bert_score)

### ROUGE для Russian

ROUGE (Recall-Oriented Understudy for Gisting Evaluation) — n-gram overlap. Работает для Russian но хуже чем BERTScore из-за морфологии (падежи, окончания).

### Рекомендация

Использовать **BERTScore** как primary metric + **exact match на entity names** + **ROUGE-L** как secondary. `statsmodels` для power analysis.

---

## Task 9: Embedding Models для русского языка

### Сравнение моделей

| Модель                                  | Размер       | Max Tokens | ruMTEB Score    | Особенности                                                                     |
| --------------------------------------- | ------------ | ---------- | --------------- | ------------------------------------------------------------------------------- |
| GigaEmbeddings (Sber)                   | ~3B (pruned) | —          | **69.1** (SOTA) | Специализирована для Russian, bidirectional attention, latent attention pooling |
| BAAI/bge-m3                             | 2.2 GB       | 8,192      | Высокий         | 100+ языков, dense+sparse+multi-vector                                          |
| intfloat/multilingual-e5-large-instruct | ~560 MB      | 512        | Средний         | Instruction-tuned, лёгкая                                                       |
| ai-forever/sbert_large_nlu_ru           | ~400 MB      | 512        | —               | Старая, Russian-focused                                                         |

### GigaEmbeddings — лидер для Russian

- SOTA на ruMTEB (23 задачи): 69.1 avg score
- SOTA на MTEB и CMTEB (август 2025)
- 3-stage pipeline: contrastive pre-training → hard negatives → multitask
- 25% pruning transformer layers без потери качества
- Модель: `ai-sage/Giga-Embeddings-instruct` на HuggingFace
- Источник: [GigaEmbeddings Paper](https://arxiv.org/abs/2510.22369)
- Источник: [ACL Anthology](https://aclanthology.org/2025.bsnlp-1.3/)
- Источник: [HuggingFace](https://huggingface.co/ai-sage/Giga-Embeddings-instruct)

### BGE-M3

- MIRACL benchmark: nDCG@10 = 70.0 (18 языков)
- Уникальная multi-functionality: dense + sparse + multi-vector в одной модели
- 8,192 tokens context — подходит для длинных описаний
- Источник: [ruMTEB Paper](https://arxiv.org/abs/2408.12503)
- Источник: [BentoML Guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)

### multilingual-e5-large-instruct

- Instruction-tuned — можно задать контекст через инструкцию
- Всего 512 tokens max — **критичное ограничение** для длинных текстов
- BM25 outperforms mE5-large на 27 п.п. для full-text retrieval
- Подходит для коротких query-document задач
- Источник: [HuggingFace](https://huggingface.co/intfloat/multilingual-e5-large-instruct)

### MTEB Leaderboard (март 2026)

Общий MTEB:

1. Gemini Embedding 001 — 68.32 (closed-source)
2. NVIDIA Llama-Embed-Nemotron-8B — multilingual лидер
3. Qwen3-Embedding-8B — 70.58 multilingual

- Источник: [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)

### Рекомендация для entity deduplication

Для дедупликации русских имён персонажей (короткие строки, 1-5 слов):

1. **GigaEmbeddings** — лучший для Russian, но ~3B параметров (тяжёлая для self-hosting)
2. **BGE-M3 dense** — отличный баланс качества и размера, 8K context
3. **multilingual-e5-large-instruct** — достаточно для коротких имён (512 tokens хватит), instruction-tuning помогает для specific задач

**Практическая рекомендация:** BGE-M3 — лучший выбор. Поддерживает и dense и sparse поиск одновременно, 8K context, отличные Russian результаты. Для entity names достаточно dense mode.

Если self-hosting на Modal: BGE-M3 (2.2 GB) уместится в GPU memory без проблем.

---

## Сводная таблица решений

| Задача                | Решение                                              | Приоритет               |
| --------------------- | ---------------------------------------------------- | ----------------------- |
| Context Caching       | Implicit через OpenRouter (уже работает)             | LOW — экономия ничтожна |
| Batch API (free tier) | Gemini 2.5 Flash-Lite Batch через native SDK         | HIGH                    |
| Batch API reliability | Timeout watchdog + fallback на sync API              | HIGH                    |
| Модель для free tier  | Gemini 2.5 Flash-Lite (GA, $0.05/$0.20 batch)        | HIGH                    |
| Multi-provider        | Расширить openrouter_client.py → Protocol pattern    | MEDIUM                  |
| Celery + Modal        | `.remote()` синхронный вызов, `.spawn()` для длинных | MEDIUM                  |
| Priority queues       | Отдельные очереди (premium/standard/batch)           | HIGH                    |
| Monitoring            | Flower + Prometheus + custom AI cost metrics         | MEDIUM                  |
| A/B testing           | ~593 samples/group, BERTScore + statsmodels          | LOW (потом)             |
| Embeddings            | BGE-M3 для entity dedup                              | MEDIUM                  |

---

## Ссылки (полный список)

### Gemini API

- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Context Caching Docs](https://ai.google.dev/gemini-api/docs/caching)
- [Context Caching Overview (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)
- [Batch API Docs](https://ai.google.dev/gemini-api/docs/batch-api)
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview)
- [Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Implicit Caching Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)

### Batch API Issues

- [72h stuck jobs](https://discuss.ai.google.dev/t/batch-api-jobs-stuck-in-processing-for-72-hours/114081)
- [26h pending](https://discuss.ai.google.dev/t/batch-api-job-stuck-in-pending-state-for-over-26-hours/114473)
- [GitHub: 24h+ pending](https://github.com/googleapis/python-genai/issues/1482)
- [Batch outage](https://discuss.ai.google.dev/t/batch-api-outage/116315)
- [Structured output in batch + OpenAI compat](https://discuss.ai.google.dev/t/structured-outputs-in-batch-using-openai-compatibility-mode/126309)

### OpenRouter

- [Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [Implicit Caching Announcement](https://openrouter.ai/announcements/is-implicit-caching-prompt-retention)

### Modal

- [Invoking Deployed Functions](https://modal.com/docs/guide/trigger-deployed-functions)
- [modal.Function reference](https://modal.com/docs/reference/modal.Function)
- [Async API](https://modal.com/docs/guide/async)
- [synchronicity library](https://github.com/modal-labs/synchronicity)
- [Datadog Integration](https://docs.datadoghq.com/integrations/modal/)
- [ClickHouse Observability](https://clickhouse.com/blog/modal-real-time-observability-ai-workloads)

### Celery

- [Routing Tasks](https://docs.celeryq.dev/en/stable/userguide/routing.html)
- [Redis Priority Queues](https://olzhasar.com/posts/prioritizing-tasks-with-celery-and-redis/)
- [Flower Prometheus Integration](https://flower.readthedocs.io/en/latest/prometheus-integration.html)
- [celery-exporter](https://github.com/danihodovic/celery-exporter)

### Resilience Patterns

- [PyBreaker](https://pypi.org/project/pybreaker/)
- [LiteLLM Router](https://docs.litellm.ai/docs/routing)
- [LiteLLM Fallbacks](https://docs.litellm.ai/docs/proxy/reliability)
- [Resilience Patterns in Python](https://dev.to/nebulagg/ai-agent-error-handling-4-resilience-patterns-in-python-12of)

### ML Evaluation

- [statsmodels power_proportions_2indep](https://www.statsmodels.org/dev/generated/statsmodels.stats.proportion.power_proportions_2indep.html)
- [BERTScore](https://arxiv.org/abs/1904.09675)
- [BERTScore GitHub](https://github.com/Tiiiger/bert_score)

### Embeddings

- [GigaEmbeddings Paper](https://arxiv.org/abs/2510.22369)
- [GigaEmbeddings HF](https://huggingface.co/ai-sage/Giga-Embeddings-instruct)
- [ruMTEB Paper](https://arxiv.org/abs/2408.12503)
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [BGE-M3 Guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)

### Grafana Dashboards

- [Celery Monitoring #10026](https://grafana.com/grafana/dashboards/10026-celery-monitoring/)
- [Celery Tasks Overview #17509](https://grafana.com/grafana/dashboards/17509-celery-tasks-overview/)
- [Flower Dashboard JSON](https://github.com/mher/flower/blob/master/examples/celery-monitoring-grafana-dashboard.json)
