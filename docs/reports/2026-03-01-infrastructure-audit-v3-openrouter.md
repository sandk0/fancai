# Инфраструктурный аудит v3 + OpenRouter миграция

**Дата:** 2026-03-01
**Scope:** Критический аудит отчётов v1/v2, исследование OpenRouter, выбор моделей, TCO сравнение
**Автор:** Claude Code

## Executive Summary

Аудит отчётов v1/v2 выявил **11 фактических ошибок и пробелов**, включая завышенные бенчмарки (Caddy не 4.5%, а 14-19% медленнее Nginx; Valkey не 3.3x, а ~37% быстрее Redis), ошибочную рекомендацию Podman (podman-compose не поддерживает все фичи docker-compose), и преждевременную рекомендацию Taskiq (pre-1.0, нет production case studies). Исследование OpenRouter показало, что это жизнеспособный AI gateway с 290+ моделями и 5.5% наценкой, а модель **Qwen3 32B** ($0.08/$0.24 за 1M токенов) может снизить стоимость экстракции текста в **7-10 раз** по сравнению с прямым Gemini API. Для изображений **FLUX 2 Pro** ($0.030/image) — оптимальная альтернатива Imagen 4 ($0.020) с менее строгой цензурой.

---

## Часть 1: Аудит v1/v2 — найденные ошибки и пробелы

### 1.1 Фактические ошибки

#### ОШИБКА 1: Caddy «4.5% медленнее Nginx» — занижено

v1 утверждает: Caddy на 4.5% медленнее Nginx (12,340 vs 11,780 RPS).

**Факт:** Независимые бенчмарки (patrickdappollonio/nginx-vs-caddy-benchmark) показывают:

- Mean latency: Nginx на **14% быстрее**
- P95: Nginx на **17% быстрее**
- P99: Nginx на **19% быстрее**
- Статические файлы: разница до **4.7x** в патологических случаях

Цифра 4.5% не подтверждается ни одним найденным бенчмарком. Реальная разница 14-19%.

**Влияние на решение:** Caddy всё ещё подходит для нашей нагрузки (< 300 RPS), но разницу нужно знать точно.

**Источник:** [nginx-vs-caddy-benchmark](https://www.patrickdap.com/post/benchmarking-is-hard/)

#### ОШИБКА 2: Valkey «3.3x быстрее Redis» — вводит в заблуждение

v1 утверждает: Valkey 1.19M RPS vs Redis 360K RPS (3.3x).

**Факт:** Цифра 3.3x — это сравнение Valkey с I/O threading vs Valkey без I/O threading (240K → 680K RPS). Реальное сравнение Valkey 8.1 vs Redis 8.0 (DragonflyDB benchmark):

- SETs: Valkey 999.8K vs Redis 729.4K — **+37%**
- GETs: разница ещё меньше — **+16%**

**Влияние на решение:** Valkey остаётся хорошим выбором (open source, совместим), но не из-за 3.3x производительности.

**Источники:** [DragonflyDB blog](https://www.dragonflydb.io/blog/redis-8-0-vs-valkey-8-1-a-technical-comparison), [Momento benchmark](https://www.gomomento.com/blog/valkey-turns-one-how-the-community-fork-left-redis-in-the-dust/)

#### ОШИБКА 3: Granian «11% выше throughput» — неполная картина

v1 утверждает: Granian на 11% быстрее Uvicorn.

**Факт:** 11% — из одного Hello World бенчмарка. Официальные бенчмарки Granian показывают:

- ASGI GET (10KB): Granian 112K vs Uvicorn 37K — **~3x**
- ASGI ECHO (10KB POST): Granian 49.6K vs Uvicorn 32.6K — **+52%**

Реальная разница зависит от workload: от 11% до 3x.

**Источник:** [Granian benchmarks](https://github.com/emmett-framework/granian/blob/master/benchmarks/vs.md)

#### ОШИБКА 4: Версия Valkey устарела

v1/v2 рекомендуют Valkey 8.x. Текущая стабильная версия — **Valkey 9.0.3** (24 февраля 2026).

**Источник:** [Valkey releases](https://github.com/valkey-io/valkey/releases)

#### ОШИБКА 5: Docker Compose — дефолт `gemini-2.0-flash`

`docker-compose.lite.prod.yml:125` содержит `LANGEXTRACT_MODEL:-gemini-2.0-flash`, хотя `config.py:60` уже использует `gemini-3-flash-preview`. Config drift — при переезде на новый сервер возможна ошибка.

#### ОШИБКА 6: Celery memory — три разных значения

| Файл                         | Значение                              | KB     |
| ---------------------------- | ------------------------------------- | ------ |
| docker-compose.lite.prod.yml | `--max-memory-per-child=400000`       | 400 MB |
| config.py                    | `CELERY_MAX_MEMORY_PER_CHILD=1572864` | 1.5 GB |
| celery_config.py             | `worker_max_memory_per_child=5000000` | 5 GB   |

Docker compose override побеждает, реальный лимит 400 MB. Это слишком мало для парсинга крупных книг.

### 1.2 Логические пробелы и ошибочные рекомендации

#### ПРОБЕЛ 1: Podman — рекомендация v2 ошибочна

v2 рекомендует мигрировать на Podman + systemd Quadlet. Проблемы:

1. **podman-compose реализует ПОДМНОЖЕСТВО** docker-compose (подтверждено Red Hat blog)
2. Custom networks, некоторые volume опции, healthcheck expressions могут не работать
3. **loginctl enable-linger** требуется для rootless — без него контейнеры останавливаются при завершении сессии
4. DNS resolution отличается от Docker (127.0.0.11 vs per-network DNS)
5. Нет production case studies для Python/FastAPI + Podman

**Пересмотренная рекомендация: ОСТАВИТЬ Docker Compose.** Docker 27+ поддерживает rootless mode. Переход на Podman добавляет риск без явной выгоды для single-server deployment.

**Источники:** [Red Hat blog](https://www.redhat.com/en/blog/podman-compose-docker-compose), [simplehomelab migration guide](https://www.simplehomelab.com/docker-to-podman-migration-guide/)

#### ПРОБЕЛ 2: Taskiq — преждевременная рекомендация

v2 рекомендует мигрировать Celery → Taskiq на Phase 2. Проблемы:

1. **Версия 0.12.1** (pre-1.0) — API нестабилен
2. **Нет именованных production case studies** — только generic claim на сайте
3. **~2,000 GitHub stars** vs Celery ~25,000
4. Один основной разработчик
5. **Не работает для sync проектов** — fancai Celery tasks используют `asyncio.run()` внутри sync task
6. Scheduler: «always run only one instance» — то же ограничение, что у Celery Beat

**Пересмотренная рекомендация: ОСТАВИТЬ Celery.** Taskiq — интересная технология для новых проектов, но миграция с 3 приоритетными очередями, Beat scheduler, distributed lock — высокий риск при сомнительной выгоде.

**Источники:** [Taskiq PyPI](https://pypi.org/project/taskiq/), [Taskiq GitHub](https://github.com/taskiq-python/taskiq), [comparison](https://judoscale.com/blog/choose-python-task-queue)

#### ПРОБЕЛ 3: Granian — WebSocket issues для fancai

Granian имеет **known issues** с WebSocket:

- ASGI flow errors при WebSocket disconnection
- ASGI lifespan shutdown event не отправляется (Issue #772)
- Production users сообщают о проблемах на «heavy traffic»

fancai использует WebSocket для real-time progress обработки книг. **Это риск.**

**Пересмотренная рекомендация: Granian — P2 (после стабилизации), не P1.** Оставить Uvicorn для начальной миграции. Тестировать Granian отдельно.

**Источники:** [Issue #186](https://github.com/emmett-framework/granian/issues/186), [Discussion #75](https://github.com/emmett-framework/granian/discussions/75)

#### ПРОБЕЛ 4: Caddy — WebSocket проблемы

Caddy имеет known issue: **WebSocket connections дропаются при config reload** (Issue #6420). Для fancai с WebSocket progress — это потенциальная проблема при hot-reload конфигурации.

**Решение:** Допустимо для нашего use case (config reload редко). Rate limiting требует кастомной сборки через xcaddy (caddy-ratelimit модуль).

**Источник:** [Caddy Issue #6420](https://github.com/caddyserver/caddy/issues/6420)

#### ПРОБЕЛ 5: Celery + Valkey — не полная совместимость

Celery официально **не поддерживает** `valkey://` URL scheme (Celery Issue #9092). Workaround: использовать `redis://` pointing to Valkey. Официальная поддержка в разработке (draft PR #9300).

**Влияние:** Валейки работает с Celery, но через hack. При обновлении Celery может сломаться.

**Источники:** [Celery #9092](https://github.com/celery/celery/issues/9092), [Kombu #2245](https://github.com/celery/kombu/issues/2245)

#### ПРОБЕЛ 6: Legacy NLP конфигурация

`config.py` содержит 7+ NLP-настроек (SPACY_MODEL, MULTI_NLP_MODE, SPACY_WEIGHT, NATASHA_WEIGHT, STANZA_WEIGHT и др.), хотя NLP система удалена в декабре 2025. Dead code = confusion при аудите.

### 1.3 Что подтверждается

| Рекомендация v1/v2                | Статус                  | Подтверждение                                                   |
| --------------------------------- | ----------------------- | --------------------------------------------------------------- |
| Caddy вместо Nginx                | ✅ Верно (с оговорками) | Автоматический SSL, проще конфигурация, 14-19% потери допустимы |
| PostgreSQL тюнинг 32 ГБ           | ✅ Верно                | Формулы корректны                                               |
| PgBouncer НЕ нужен Phase 1        | ✅ Верно                | FastAPI + asyncpg уже имеет connection pooling                  |
| VictoriaMetrics вместо Prometheus | ✅ Верно                | 3-7x меньше RAM подтверждается, PromQL совместим                |
| pgBackRest для бэкапов            | ✅ Верно                | PITR, incremental, zstd — всё актуально                         |
| Gemini API — главный bottleneck   | ✅ Верно                | Rate limits определяют throughput, не сервер                    |
| Imagen — главная статья расходов  | ✅ Верно                | $0.02/image × 5K = $100/мес при 100 пользователях               |

---

## Часть 2: OpenRouter — исследование платформы

### Обзор

**OpenRouter** — unified AI gateway, предоставляющий доступ к **290+ моделям** через единый **OpenAI-совместимый API**. Drop-in replacement: меняется только `base_url` и `api_key`.

### Ключевые характеристики

| Параметр               | Значение                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Количество моделей     | 290+ (все провайдеры: OpenAI, Anthropic, Google, DeepSeek, Meta, Qwen, Mistral)                        |
| API совместимость      | 100% OpenAI SDK compatible                                                                             |
| Наценка на inference   | **0%** (pass-through pricing)                                                                          |
| Комиссия за пополнение | **5.5%** на карту (мин. $0.80), 5% крипто                                                              |
| Бесплатные модели      | ~24-29 (DeepSeek R1/V3, Llama 4, Qwen3 235B и др.)                                                     |
| Rate limits (paid)     | **Нет платформенных лимитов** — применяются лимиты провайдера                                          |
| Rate limits (free)     | 50 req/day (без покупок), 1000 req/day (с покупкой $10+)                                               |
| Uptime SLA             | 99.9% (Enterprise)                                                                                     |
| Fallback routing       | Автоматический: если провайдер A упал → автоматически провайдер B                                      |
| Structured output      | `json_object`, `json_schema`, tool calling — с автоматической трансформацией для не-OpenAI провайдеров |
| Response Healing       | Автофикс malformed JSON, снижает дефекты на 80%+                                                       |
| Latency overhead       | 25-40ms (vendor claim), 50-150ms (независимые тесты)                                                   |

### Python интеграция

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="sk-or-..."
)

response = client.chat.completions.create(
    model="qwen/qwen3-32b",
    messages=[{"role": "user", "content": "Извлеки сущности..."}],
    response_format={"type": "json_schema", "json_schema": {...}}
)
```

Также доступен official Python SDK (`pip install openrouter`) — в beta.

### Преимущества для fancai

1. **Vendor independence** — легко менять модели одной строкой
2. **Fallback routing** — если Gemini упал, автоматически переключится на DeepSeek/Qwen
3. **Бесплатные модели** — для dev/staging (DeepSeek V3, Llama 4, Qwen3)
4. **Единый billing** — один счёт вместо 3-4 провайдеров
5. **Structured output healing** — автофикс JSON ошибок моделей

### Недостатки

1. **5.5% наценка** на пополнение (эффективная наценка на все расходы)
2. **+50-150ms latency** на каждый запрос
3. **Нет Imagen 4** — Google Imagen не доступен через OpenRouter
4. **Промежуточный сервер** — данные проходят через OpenRouter (privacy concern)
5. **Free model data sharing** — бесплатные модели могут использовать данные для обучения

**Источники:** [OpenRouter docs](https://openrouter.ai/docs), [OpenRouter pricing](https://openrouter.ai/pricing), [OpenRouter models](https://openrouter.ai/models)

---

## Часть 3: Модели для экстракции текста — сравнительная таблица

### Контекст: fancai extraction pipeline

- Входные данные: русскоязычные главы книг, 10-100K символов
- Выход: structured JSON (Pydantic schema: описания сцен, сущности, отношения)
- ~170-220 API calls на книгу (100 глав)
- Промпт (system + instructions): ~2K токенов (одинаковый для всех глав)
- Среднее: ~15K input tokens, ~3K output tokens на главу

### Сравнительная таблица

| Модель                     | Input $/1M            | Output $/1M | Контекст | JSON Schema         | Русский язык         | Скорость | Рекомендация          |
| -------------------------- | --------------------- | ----------- | -------- | ------------------- | -------------------- | -------- | --------------------- |
| **Gemini 2.5 Flash**       | $0.30 ($0.030 cached) | $2.50       | 1M       | ✅ Отлично          | Хорошо               | Быстро   | **PRIMARY**           |
| **Gemini 3.0 Flash**       | $0.50 ($0.050 cached) | $3.00       | 1M       | ✅ Отлично          | Хорошо               | Быстро   | Upgrade path          |
| **Qwen3 32B** (OpenRouter) | $0.08                 | $0.24       | 131K     | ✅ (non-thinking)   | Отлично (119 языков) | Средне   | **BEST VALUE**        |
| **Qwen3 235B-A22B** (OR)   | $0.18                 | $0.54       | 262K     | ✅ (non-thinking)   | Отлично              | Средне   | Quality fallback      |
| **DeepSeek V3.2** (direct) | $0.28 ($0.028 cached) | $0.42       | 164K     | ⚠️ json_object only | Хорошо               | Быстро   | Cheap output          |
| **DeepSeek V3.2** (OR)     | $0.27                 | $0.40       | 164K     | ⚠️ json_object only | Хорошо               | Быстро   | Fallback              |
| **GPT-4o mini** (OR)       | $0.15                 | $0.60       | 128K     | ✅ Отлично          | Хорошо               | Быстро   | Reliable fallback     |
| **GPT-4.1 mini** (OR)      | $0.40                 | $1.60       | 1M       | ✅ Отлично          | Хорошо               | Быстро   | Premium fallback      |
| **Claude 4.5 Haiku** (OR)  | $1.00                 | $5.00       | 200K     | ✅ Отлично          | Отлично              | Средне   | Слишком дорого        |
| **Llama 4 Scout** (OR)     | $0.18                 | $0.63       | 10M      | ✅                  | Средне               | Быстро   | Длинные книги         |
| **Mistral Medium 3** (OR)  | $0.40                 | $2.00       | 128K     | ✅                  | Хорошо               | Быстро   | Не конкурентоспособно |
| **GPT-4.1 nano**           | $0.02                 | $0.15       | —        | ✅                  | Неизвестно           | Быстро   | Требует тестов        |

### Расчёт стоимости на книгу (100 глав, ~15K in + ~3K out на главу)

| Модель                              | Input cost    | Output cost | Итого на книгу                | Экономия vs текущего |
| ----------------------------------- | ------------- | ----------- | ----------------------------- | -------------------- |
| Текущий (Gemini 3.0 Flash direct)   | $0.75         | $0.90       | **$1.65**                     | baseline             |
| Gemini 2.5 Flash (direct, no cache) | $0.45         | $0.75       | **$1.20**                     | -27%                 |
| Gemini 2.5 Flash (cached prompts)   | $0.05 + $0.40 | $0.75       | **$1.20**                     | -27%                 |
| Gemini 2.5 Flash (batch API)        | $0.23         | $0.38       | **$0.61**                     | -63%                 |
| **Qwen3 32B (OpenRouter)**          | $0.12         | $0.07       | **$0.19** (+5.5%) = **$0.20** | **-88%**             |
| DeepSeek V3.2 (direct, cached)      | $0.04 + $0.38 | $0.13       | **$0.55**                     | -67%                 |
| GPT-4o mini (OpenRouter)            | $0.23         | $0.18       | **$0.41** (+5.5%) = **$0.43** | -74%                 |

### Рекомендация

**Стратегия dual-provider через OpenRouter:**

1. **Primary: Qwen3 32B** — $0.20/книга, отличный русский, JSON Schema support
2. **Fallback: DeepSeek V3.2** — $0.55/книга, если Qwen недоступен
3. **Quality fallback: Gemini 2.5 Flash** — через BYOK на OpenRouter или direct API

⚠️ **Важно:** DeepSeek V3.2 поддерживает только `json_object` mode, не `json_schema`. Для нашего use case с Pydantic schemas это может быть проблемой — нужно тестирование. Qwen3 поддерживает json_schema только в non-thinking mode.

---

## Часть 4: Модели для генерации изображений — сравнительная таблица

### Текущее решение: Imagen 4 (direct Google API)

- Модель: `imagen-4.0-generate-001`
- Цена: $0.020/image (Fast), $0.040 (Standard)
- Качество: высокое
- Цензура: **строгая** (Google Safety Filters — может блокировать боевые сцены)
- Интеграция: уже работает

### Сравнительная таблица

| Модель                          | Цена/image   | Разрешение | Скорость | Качество для книг | Цензура     | Доступность                | Рекомендация      |
| ------------------------------- | ------------ | ---------- | -------- | ----------------- | ----------- | -------------------------- | ----------------- |
| **Imagen 4 Fast** (direct)      | $0.020       | до 4K      | 5-10с    | Высокое           | Строгая     | Direct API                 | **PRIMARY**       |
| **Imagen 4 Standard**           | $0.040       | до 4K      | 10-15с   | Очень высокое     | Строгая     | Direct API                 | Premium           |
| **FLUX 2 Pro** (OpenRouter/BFL) | $0.030       | до 2K      | 5-10с    | Очень высокое     | Умеренная   | OpenRouter, BFL, Replicate | **FALLBACK**      |
| **FLUX 2 Klein** (OpenRouter)   | $0.014/MP    | —          | 2-5с     | Хорошее           | Умеренная   | OpenRouter                 | Budget            |
| **Seedream 4.5** (OpenRouter)   | $0.040       | до 4K      | 5-10с    | Высокое           | Неизвестна  | OpenRouter                 | Альтернатива      |
| **GPT Image 1 Mini** (low)      | $0.005       | 1024       | 3-5с     | Низкое            | Строгая     | OpenAI / OpenRouter        | Ultra-budget      |
| **GPT Image 1 Mini** (high)     | $0.036       | 1024       | 5-10с    | Хорошее           | Строгая     | OpenAI / OpenRouter        | —                 |
| **GPT Image 1** (high)          | $0.167       | 4K         | 10-20с   | Отличное          | Строгая     | OpenAI                     | Слишком дорого    |
| **Recraft V3**                  | $0.040       | —          | 5-10с    | Высокое           | Умеренная   | Direct API                 | Альтернатива      |
| **FLUX Schnell**                | $0.003       | 1024       | 1-2с     | Среднее           | Минимальная | Replicate/fal.ai           | Dev/testing       |
| **Stable Diffusion 3.5**        | $0.035-0.065 | до 2K      | 5-10с    | Хорошее           | Минимальная | Stability AI               | Self-host option  |
| **Gemini 2.5 Flash Image**      | ~$0.039      | до 4K      | 5-15с    | Хорошее           | Строгая     | OpenRouter                 | Текст+изображение |

### Заметки по цензуре

Для книжных иллюстраций (бои, драмы, напряжённые сцены):

- **Imagen 4 / DALL-E / GPT Image**: Строгие фильтры Google/OpenAI — могут блокировать батальные сцены
- **FLUX Pro/2 Pro**: Умеренная фильтрация — боевые/драматические сцены проходят, порно блокируется
- **Stable Diffusion / FLUX Schnell**: Минимальная фильтрация при self-hosting

### Рекомендация

1. **Primary: Imagen 4 Fast** ($0.020) — уже интегрирован, хорошее качество
2. **Fallback: FLUX 2 Pro** ($0.030) через OpenRouter — для сцен, которые блокирует Imagen
3. **Budget testing: FLUX Schnell** ($0.003) — для dev/staging

---

## Часть 5: Архитектура multi-model routing

### Схема

```
┌─────────────────────────────────────────────────┐
│                 AI Router Service                │
│  (app/services/ai_router.py)                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ Text Extraction  │  │ Image Generation     │ │
│  │                  │  │                      │ │
│  │ Primary:         │  │ Primary:             │ │
│  │  Qwen3 32B (OR)  │  │  Imagen 4 Fast       │ │
│  │                  │  │  (direct Google API)  │ │
│  │ Fallback 1:      │  │                      │ │
│  │  DeepSeek V3.2   │  │ Fallback:            │ │
│  │  (OR)            │  │  FLUX 2 Pro (OR)     │ │
│  │                  │  │                      │ │
│  │ Fallback 2:      │  │ Safety Fallback:     │ │
│  │  Gemini 2.5 Flash│  │  FLUX 2 Pro (OR)     │ │
│  │  (direct/BYOK)   │  │  (для blocked сцен)  │ │
│  └──────────────────┘  └──────────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ Budget Controller                         │   │
│  │ - Daily limit: $X/day                     │   │
│  │ - Per-user limit: Y images/day            │   │
│  │ - Alert at 80% budget                     │   │
│  │ - Auto-downgrade to cheaper model at 90%  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Логика routing

```python
# Псевдокод
async def extract_chapter(chapter_text: str) -> ExtractionResult:
    models = [
        ("qwen/qwen3-32b", openrouter_client),      # $0.20/книга
        ("deepseek/deepseek-v3.2", openrouter_client),# $0.55/книга
        ("gemini-2.5-flash", google_client),           # $1.20/книга
    ]
    for model, client in models:
        try:
            return await client.extract(model, chapter_text, schema)
        except (RateLimitError, TimeoutError, APIError):
            continue
    raise AllModelsFailedError()

async def generate_image(prompt: str) -> ImageResult:
    try:
        return await imagen_service.generate(prompt)  # $0.020
    except SafetyBlockedError:
        return await openrouter_flux.generate(prompt)  # $0.030, менее строгая цензура
    except (RateLimitError, APIError):
        return await openrouter_flux.generate(prompt)  # fallback
```

### Budget alerts

| Уровень               | Действие                                    |
| --------------------- | ------------------------------------------- |
| 50% дневного бюджета  | Log warning                                 |
| 80% дневного бюджета  | Telegram alert                              |
| 90% дневного бюджета  | Автопереключение на дешёвые модели          |
| 100% дневного бюджета | Блокировка новых запросов до следующего дня |

---

## Часть 6: TCO сравнение (3 сценария)

### Параметры

- 50 активных пользователей
- 20 книг/месяц (100 глав в среднем)
- 3,000 изображений/месяц
- ~170 LLM calls на книгу × 20 = 3,400 LLM calls/месяц
- ~15K input + ~3K output tokens на call = 51M input + 10.2M output tokens/месяц

### Сценарий A: Текущий (прямой Gemini 3.0 Flash + Imagen 4)

| Статья                                                               | Расчёт                      | Стоимость                    |
| -------------------------------------------------------------------- | --------------------------- | ---------------------------- |
| LLM extraction (Gemini 3.0 Flash)                                    | 51M × $0.50 + 10.2M × $3.00 | $25.50 + $30.60 = **$56.10** |
| Entity synthesis (~50 calls × 20 книг = 1000 calls, ~5K in + 2K out) | 5M × $0.50 + 2M × $3.00     | $2.50 + $6.00 = **$8.50**    |
| Dedup (~20 calls × 20 книг = 400 calls, ~3K in + 1K out)             | 1.2M × $0.50 + 0.4M × $3.00 | $0.60 + $1.20 = **$1.80**    |
| Image generation (Imagen 4 Fast)                                     | 3,000 × $0.020              | **$60.00**                   |
| Translation (Gemini for RU→EN)                                       | 3,000 × ~$0.002             | **$6.00**                    |
| VPS (vdsina.com, 12 CPU/32GB)                                        | —                           | **$35.00**                   |
| Домен + DNS                                                          | —                           | **$2.00**                    |
| **ИТОГО**                                                            |                             | **$169.40/мес**              |
| **На пользователя**                                                  |                             | **$3.39/мес**                |

### Сценарий B: OpenRouter (Qwen3 32B + FLUX 2 Pro)

| Статья                             | Расчёт                                  | Стоимость                 |
| ---------------------------------- | --------------------------------------- | ------------------------- |
| LLM extraction (Qwen3 32B)         | 51M × $0.08 + 10.2M × $0.24             | $4.08 + $2.45 = **$6.53** |
| Entity synthesis                   | 5M × $0.08 + 2M × $0.24                 | $0.40 + $0.48 = **$0.88** |
| Dedup                              | 1.2M × $0.08 + 0.4M × $0.24             | $0.10 + $0.10 = **$0.20** |
| Image generation (FLUX 2 Pro)      | 3,000 × $0.030                          | **$90.00**                |
| Translation (бесплатная модель OR) | —                                       | **$0.00**                 |
| OpenRouter commission              | ($6.53 + $0.88 + $0.20 + $90.00) × 5.5% | **$5.37**                 |
| VPS                                | —                                       | **$35.00**                |
| Домен + DNS                        | —                                       | **$2.00**                 |
| **ИТОГО**                          |                                         | **$140.88/мес**           |
| **На пользователя**                |                                         | **$2.82/мес**             |
| **Экономия vs A**                  |                                         | **-17%**                  |

### Сценарий C: Оптимизированный (Qwen3 32B + Imagen 4 Fast + кэширование)

| Статья                                     | Расчёт                           | Стоимость      |
| ------------------------------------------ | -------------------------------- | -------------- |
| LLM extraction (Qwen3 32B via OR)          | как B                            | **$6.53**      |
| Entity synthesis (Qwen3 32B)               | как B                            | **$0.88**      |
| Dedup (Qwen3 32B)                          | как B                            | **$0.20**      |
| Image generation (Imagen 4 Fast direct)    | 3,000 × $0.020 × 70% (30% dedup) | **$42.00**     |
| Translation (Gemini 2.5 Flash-Lite cached) | ~2,100 unique × $0.001           | **$2.10**      |
| OpenRouter commission (LLM only)           | $7.61 × 5.5%                     | **$0.42**      |
| VPS                                        | —                                | **$35.00**     |
| Домен + DNS                                | —                                | **$2.00**      |
| **ИТОГО**                                  |                                  | **$89.13/мес** |
| **На пользователя**                        |                                  | **$1.78/мес**  |
| **Экономия vs A**                          |                                  | **-47%**       |

### Визуальное сравнение

```
TCO/месяц (50 пользователей, 20 книг, 3K images)

Сценарий A (текущий):     ████████████████████ $169.40
Сценарий B (OpenRouter):  ████████████████     $140.88  (-17%)
Сценарий C (optimized):   ██████████           $89.13   (-47%)

Breakdown по категориям:
                          LLM     Images   Server  Other
Сценарий A:              $66.40   $66.00   $35.00  $2.00
Сценарий B:              $13.00   $95.37   $35.00  $2.00
Сценарий C:              $10.13   $44.10   $35.00  $2.00
```

### Ключевой инсайт

**Изображения — главная статья расходов** в любом сценарии. Оптимизация LLM (с $66 до $10) экономит $56, а оптимизация изображений (dedup 30%) — ещё $24. Наибольшая экономия достигается комбинацией дешёвых LLM через OpenRouter + прямой Imagen API с image dedup.

---

## Часть 7: Пересмотренные рекомендации (итоговая таблица)

| #   | Компонент         | v1/v2 рекомендация  | v3 рекомендация                                                                | Изменение     | Приоритет |
| --- | ----------------- | ------------------- | ------------------------------------------------------------------------------ | ------------- | --------- |
| 1   | Reverse Proxy     | Caddy 2.x           | **Caddy 2.x** (с оговорками: 14-19% penalty, WebSocket reload issue)           | Уточнение     | P0        |
| 2   | ASGI Server       | Granian             | **Uvicorn → Granian позже** (WebSocket issues, слабые production case studies) | **ОТКАТ**     | P2        |
| 3   | Cache/Broker      | Valkey 8.x          | **Valkey 9.x** (обновить версию; Celery workaround `redis://` URL)             | Уточнение     | P1        |
| 4   | Task Queue        | Taskiq (Phase 2)    | **ОСТАВИТЬ Celery** (Taskiq pre-1.0, нет case studies, sync issue)             | **ОТКАТ**     | —         |
| 5   | Database          | PostgreSQL тюнинг   | **PostgreSQL тюнинг**                                                          | Без изменений | P0        |
| 6   | Connection Pool   | НЕ нужен Phase 1    | **НЕ нужен Phase 1**                                                           | Без изменений | —         |
| 7   | Orchestration     | Podman + Quadlet    | **Docker Compose** (podman-compose — subset, риск при миграции)                | **ОТКАТ**     | —         |
| 8   | Monitoring        | VictoriaMetrics     | **VictoriaMetrics**                                                            | Без изменений | P2        |
| 9   | Backups           | pgBackRest          | **pgBackRest**                                                                 | Без изменений | P0        |
| 10  | LLM extraction    | Gemini direct       | **OpenRouter (Qwen3 32B primary, DeepSeek/Gemini fallback)**                   | **НОВОЕ**     | P1        |
| 11  | Image generation  | Imagen direct       | **Imagen 4 Fast (direct) + FLUX 2 Pro (OR) fallback**                          | **НОВОЕ**     | P1        |
| 12  | Cost optimization | —                   | **Image dedup + multi-model routing + budget alerts**                          | **НОВОЕ**     | P1        |
| 13  | Frontend serving  | Отдельный контейнер | **Статика через Caddy**                                                        | Из v2         | P1        |
| 14  | Config cleanup    | —                   | **Удалить legacy NLP config, исправить Gemini model default**                  | **НОВОЕ**     | P0        |

---

## Часть 8: План миграции на OpenRouter (пошаговый)

### Phase 0: Аварийные фиксы (НЕМЕДЛЕННО)

1. ✅ Gemini 3.0 Flash — уже в `config.py` (но исправить docker-compose default)
2. Исправить `docker-compose.lite.prod.yml`: `LANGEXTRACT_MODEL:-gemini-3-flash-preview`
3. Выровнять Celery memory limits: 1.5GB во всех файлах
4. Удалить legacy NLP настройки из `config.py`

### Phase 1: OpenRouter интеграция (1-2 недели)

1. **Создать `app/services/ai_router.py`** — абстракция над LLM провайдерами
2. **Добавить OpenRouter клиент** (через `openai` SDK с `base_url`)
3. **Тестирование Qwen3 32B** на 5-10 книгах:
   - Сравнить качество extraction vs Gemini 3.0 Flash
   - Проверить structured JSON output (Pydantic schema compatibility)
   - Проверить русский язык (entity names, descriptions)
4. **Тестирование FLUX 2 Pro** на 50 изображениях:
   - Сравнить качество vs Imagen 4
   - Проверить стиль (книжная иллюстрация vs фото-реализм)
   - Проверить цензуру (батальные сцены)
5. **Добавить fallback routing** в `gemini_extractor.py`
6. **Добавить budget tracking** (Redis counter, daily reset)

### Phase 2: Миграция сервера (параллельно с Phase 1)

1. Арендовать новый сервер vdsina.com
2. Docker Compose (НЕ Podman) с:
   - Caddy (вместо Nginx)
   - Valkey 9.x (вместо Redis) — URL: `redis://`
   - Uvicorn (НЕ Granian пока) — 4-6 workers
   - PostgreSQL 17 (тюнинг 32 ГБ)
   - Celery (оставляем, memory limit 1.5GB)
3. Тестирование + миграция данных
4. DNS переключение

### Phase 3: Оптимизация (после стабилизации, 2-4 недели)

1. Включить image dedup (hash-based, не генерировать одинаковые изображения)
2. Включить Gemini Context Caching для системных промптов
3. Настроить VictoriaMetrics + Grafana
4. Настроить pgBackRest
5. Тестировать Granian (если WebSocket issues будут решены)
6. Load testing

---

## Источники

### OpenRouter

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [OpenRouter Models](https://openrouter.ai/models)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Rate Limits](https://openrouter.ai/docs/api/reference/limits)
- [OpenRouter Python SDK](https://openrouter.ai/docs/sdks/python)
- [OpenRouter vs Direct API](https://softwarelogic.co/en/blog/ai-cost-optimization-openrouterai-vs-direct-model-apis-facts)
- [OpenRouter Latency Review](https://skywork.ai/blog/openrouter-review-2025-api-gateway-latency-pricing/)

### AI Model Pricing

- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Qwen3 Blog](https://qwenlm.github.io/blog/qwen3/)
- [Alibaba Cloud Pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Imagen 4 Pricing](https://www.imagine.art/blogs/imagen-4-pricing)
- [BFL FLUX Pricing](https://bfl.ai/pricing)
- [AI Image Pricing Comparison](https://pricepertoken.com/image)

### Infrastructure Fact-Check

- [Granian GitHub](https://github.com/emmett-framework/granian)
- [Granian Benchmarks](https://github.com/emmett-framework/granian/blob/master/benchmarks/vs.md)
- [Caddy vs Nginx Benchmark](https://www.patrickdap.com/post/benchmarking-is-hard/)
- [Caddy WebSocket Issue #6420](https://github.com/caddyserver/caddy/issues/6420)
- [Valkey Releases](https://github.com/valkey-io/valkey/releases)
- [Celery Valkey Issue #9092](https://github.com/celery/celery/issues/9092)
- [DragonflyDB Redis vs Valkey](https://www.dragonflydb.io/blog/redis-8-0-vs-valkey-8-1-a-technical-comparison)
- [Taskiq GitHub](https://github.com/taskiq-python/taskiq)
- [Red Hat Podman vs Docker](https://www.redhat.com/en/blog/podman-compose-docker-compose)
- [Docker vs Podman 2025 Benchmarks](https://sanj.dev/post/container-runtime-showdown-2025)
- [VictoriaMetrics vs Prometheus](https://valyala.medium.com/prometheus-vs-victoriametrics-benchmark-on-node-exporter-metrics-4ca29c75590f)
- [VictoriaMetrics Grafana Plugin](https://docs.victoriametrics.com/victoriametrics-datasource/)
