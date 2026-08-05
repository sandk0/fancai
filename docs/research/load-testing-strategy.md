# Стратегия нагрузочного тестирования fancai AI-пайплайна

> **Канонические параметры**: См. [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md)

> Дата: 2026-03-14
> Стек: FastAPI 0.135.1 + PostgreSQL 17 + Redis 7.4 + Celery 5.6+ + OpenRouter (Gemini 3 Flash + FLUX.2 Klein)
> Продакшен: VPS 32GB RAM / 12 vCPU, один сервер

---

## Содержание

1. [Сравнение инструментов нагрузочного тестирования](#1-сравнение-инструментов-нагрузочного-тестирования)
2. [Дизайн тестовых сценариев](#2-дизайн-тестовых-сценариев)
3. [Метрики для сбора](#3-метрики-для-сбора)
4. [Стратегия мокирования OpenRouter](#4-стратегия-мокирования-openrouter)
5. [Идентификация узких мест инфраструктуры](#5-идентификация-узких-мест-инфраструктуры)
6. [Мониторинг во время тестов](#6-мониторинг-во-время-тестов)
7. [Рекомендации по масштабированию](#7-рекомендации-по-масштабированию)
8. [Примеры тестовых скриптов](#8-примеры-тестовых-скриптов)

---

## 1. Сравнение инструментов нагрузочного тестирования

### 1.1 Обзор инструментов

| Инструмент               | Язык           | Протоколы             | Распределённость    | Celery-совместимость    | Стоимость          |
| ------------------------ | -------------- | --------------------- | ------------------- | ----------------------- | ------------------ |
| **Locust**               | Python         | HTTP, WS, Custom      | Да (master/worker)  | Отличная (общий Python) | Бесплатный         |
| **k6**                   | Go (JS-скрипт) | HTTP, WS, gRPC        | Да (k6 Cloud)       | Средняя (только HTTP)   | Бесплатный / Cloud |
| **Artillery**            | Node.js        | HTTP, WS, Socket.io   | Да (Cloud)          | Низкая                  | Бесплатный / Cloud |
| **JMeter**               | Java           | HTTP, JDBC, LDAP, JMS | Да (распределённый) | Низкая                  | Бесплатный         |
| **Custom asyncio+httpx** | Python         | HTTP                  | Ручная              | Отличная                | Бесплатный         |

### 1.2 Детальный анализ

#### Locust (РЕКОМЕНДОВАН)

**Плюсы:**

- Написан на Python — единый стек с backend fancai
- Может напрямую импортировать Celery задачи для проверки состояния очередей
- Нативная поддержка WebSocket (нужна для WebSocket эндпоинта `/ws`)
- Web UI для real-time мониторинга нагрузки
- Распределённое тестирование через master/worker архитектуру
- Лёгкая интеграция с Redis (проверка cache hit/miss, очередей Celery)
- Программируемые сценарии (не YAML) — гибкость для сложных AI-воркфлоу

**Минусы:**

- Ниже производительность на одного пользователя, чем k6 (Python GIL)
- Нет встроенных thresholds (нужно писать assertions вручную)

#### k6 (ВСПОМОГАТЕЛЬНЫЙ)

**Плюсы:**

- Высокая производительность (Go runtime, тысячи VU на одной машине)
- Встроенные thresholds (`http_req_duration{p(95)<500}`)
- Хорошая интеграция с Prometheus/Grafana через k6 output
- Отличный для чистых HTTP-тестов (API endpoints)

**Минусы:**

- JavaScript скрипты — нет прямого доступа к Python Celery/Redis
- Сложнее тестировать асинхронные воркфлоу (Celery task → poll status → verify)
- Нет нативной интеграции с PostgreSQL для seed data

#### Artillery

**Плюсы:**

- Декларативный YAML — быстрый старт
- Хорош для простых HTTP-сценариев

**Минусы:**

- Node.js — ещё один runtime в стеке
- Ограниченная кастомизация для сложных AI-пайплайнов
- Нет прямого доступа к Celery/Redis

#### JMeter

**Плюсы:**

- Мощный GUI для построения сценариев
- JDBC Sampler для прямого тестирования PostgreSQL

**Минусы:**

- Тяжёлый (Java), высокое потребление памяти
- Неудобен для CI/CD (XML-файлы сценариев)
- Устаревший подход для Python-стеков

#### Custom asyncio+httpx

**Плюсы:**

- Полный контроль над тестовой логикой
- Прямой доступ к Redis, Celery, PostgreSQL
- Можно включить в pytest suite

**Минусы:**

- Нужно писать всю инфраструктуру с нуля (reporting, distributed)
- Нет web UI
- Сложнее поддерживать

### 1.3 Рекомендация для fancai

**Основной инструмент: Locust** — по следующим причинам:

1. **Единый стек Python** — Locust может импортировать модели, проверять Redis, опрашивать Celery
2. **Async-сценарии** — FastAPI async endpoints + Celery async tasks требуют сложных wait/poll паттернов
3. **WebSocket** — нативная поддержка для тестирования `/ws` endpoint (progress updates)
4. **Celery integration** — можно проверять `celery.result.AsyncResult` напрямую
5. **Redis monitoring** — проверка cache hit rates, queue depth в тест-сценариях

**Вспомогательный: k6** — для высоконагрузочных HTTP benchmark-ов API endpoints (P95/P99 latency при 1000+ RPS).

---

## 2. Дизайн тестовых сценариев

### 2.1 Карта API-эндпоинтов fancai

Критические пути через AI-пайплайн:

```
Чтение главы:
  GET  /api/v1/books/{id}/chapters/{n}           → Redis cache → PostgreSQL
  GET  /api/v1/books/{id}/progress               → Redis cache → PostgreSQL
  POST /api/v1/books/{id}/progress               → PostgreSQL + Redis invalidation

Entity network:
  GET  /api/v1/books/{id}/entities/network?current_chapter=N  → Redis cache → PostgreSQL

Извлечение описаний (AI):
  GET  /api/v1/books/{id}/chapters/{n}/descriptions?extract_new=true
    → Redis lock → OpenRouter Gemini 3 Flash → PostgreSQL
  POST /api/v1/books/{id}/chapters/{n}/extract-background
    → BackgroundTasks → OpenRouter → PostgreSQL

Генерация изображений (AI):
  POST /api/v1/images/generate/description/{id}   → OpenRouter FLUX.2 Klein → disk + PostgreSQL
  POST /api/v1/images/generate/async/{id}          → Celery task → OpenRouter → disk + PostgreSQL
  POST /api/v1/images/generate/async/chapter/{id}  → Celery batch task
  GET  /api/v1/images/task/{task_id}               → Celery result backend (Redis DB 2)

Обработка книги (AI):
  POST /api/v1/books/{id}/process                  → Celery task → OpenRouter (10+ LLM calls per chapter)

Sync (sendBeacon):
  POST /api/v1/sync/batch                          → PostgreSQL batch operations
```

### 2.2 Сценарий 1: 100 параллельных читателей

**Цель:** Проверить поведение системы при массовом чтении (основной use case).

**Профиль пользователя:**

- Открывает книгу → получает список глав
- Читает главу → обновляет прогресс каждые 30 секунд
- Загружает entity network при переходе между главами
- Загружает описания (без extract_new — только кэшированные)
- sendBeacon при закрытии

**Важные метрики:**

- P95 < 200ms для GET /chapters/{n} (кэшированные)
- P95 < 500ms для GET /entities/network
- Redis cache hit rate > 80%
- PostgreSQL connections < 100 (pool size 20 + overflow 40)

**Детали нагрузки:**

```
Ramp up: 0 → 100 users за 5 минут
Sustained: 100 users × 15 минут
Ramp down: 100 → 0 за 2 минуты

Каждый пользователь:
  - GET /chapters/list: 1 раз за 5 мин
  - GET /chapters/{n}: 1 раз за 2 мин (смена главы)
  - GET /progress: 1 раз за 30 сек
  - POST /progress: 1 раз за 30 сек
  - GET /entities/network: 1 раз за 2 мин
  - GET /descriptions: 1 раз за 2 мин
  - POST /sync/batch: 1 раз за 5 мин
```

### 2.3 Сценарий 2: 50 параллельных извлечений сущностей

**Цель:** Проверить поведение OpenRouter + PostgreSQL при массовом AI-извлечении описаний.

**Профиль:**

- 50 пользователей одновременно запрашивают extract_new=true для разных глав
- Каждый вызов → OpenRouter Gemini 3 Flash (1-5 сек) → PostgreSQL write
- Circuit breaker: 5 последовательных сбоев → 60 сек open state

**Важные метрики:**

- OpenRouter latency P95 < 10 секунд
- Количество fallback-переключений (Gemini → Haiku → Flash Lite)
- Circuit breaker transitions (closed → open → half-open → closed)
- Rate limit: 10 req/min на AI endpoints → при 50 users неизбежны 429

**Особенности:**

- Redis distributed lock (`extraction:lock:{chapter_id}`) предотвращает дублирование
- Если lock занят → HTTP 409 Conflict (retry_after_seconds: 15)
- LLM Cache (`llm:chapter:{hash}`, TTL 30 дней) снижает повторные вызовы

### 2.4 Сценарий 3: 30 параллельных генераций изображений

**Цель:** Проверить Celery queue + OpenRouter FLUX.2 Klein при массовой генерации.

**Профиль:**

- 30 пользователей запрашивают async генерацию изображений
- POST /images/generate/async/{description_id} → Celery task
- Poll GET /images/task/{task_id} каждые 3 секунды до completion

**Важные метрики:**

- Celery queue depth (Redis DB 1)
- Task completion time P95 (ожидание: 5-15 сек per image)
- Image quota: subscription plan limits (FREE: 50/month, PREMIUM: 500/month)
- Rate limit: 5 req/min на ai_image endpoints
- Disk I/O при записи сгенерированных файлов в /app/storage/generated_images

**Ограничения production:**

- Celery concurrency = 2 (настроено в docker-compose.prod.yml)
- worker_max_tasks_per_child = 100 (перезапуск воркера после 100 задач)
- max_memory_per_child = 512MB → OOMKill при утечке

### 2.5 Сценарий 4: Смешанная нагрузка (реалистичная симуляция)

**Цель:** Воспроизвести реальный паттерн использования.

**Распределение пользователей (50 всего):**
| Роль | Количество | Действия |
|---|---|---|
| Читатели | 35 (70%) | Чтение глав, обновление прогресса |
| Активные читатели | 10 (20%) | Чтение + просмотр entity network + описания |
| Генераторы | 5 (10%) | Генерация изображений + чтение |

**Think time:**

- Читатели: 20-60 секунд между действиями (чтение текста)
- Активные: 10-30 секунд (изучение entity network)
- Генераторы: 5-15 секунд (browse → generate → wait → browse)

### 2.6 Сценарий 5: Burst-тест (20 одновременных загрузок книг)

**Цель:** Проверить самый тяжёлый сценарий — массовая обработка книг.

**Профиль:**

- 20 пользователей одновременно загружают EPUB файлы (~5-20MB каждый)
- POST /api/v1/books/ → Celery `process_book` task
- Каждый task:
  - Парсинг EPUB (CPU-intensive)
  - 10+ LLM вызовов к OpenRouter (параллельно, semaphore=10)
  - Entity optimization, deduplication, synthesis (ещё LLM вызовы)
  - PageRank, master references
  - WebSocket progress updates

**Ограничения (сверено с кодом 2026-08-08):**

- `parsing_manager.can_start_parsing()`: только `max_concurrent_parsing`
  из настроек — ГЛОБАЛЬНЫЙ лимит, без разбивки по пользователям
- Redis distributed lock: `book:processing:{book_id}` (TTL=3 часа)
- Celery task queue routing: `process_book_task` → queue "heavy"
- Приоритет по подписке: `parsing_manager.get_user_priority()` (FREE=1,
  PREMIUM=5, ULTIMATE=10) — влияет на порядок очереди, не на допуск

**Чего в системе НЕТ, вопреки прежней редакции этого раздела:**

- лимита `max_per_user=1` — один пользователь может занять все слоты;
- проверки ресурсов «memory > 85 % → reject, CPU > 90 % → reject»;
- cooldown после обработки.

Всё перечисленное жило в `app/core/rate_limiter.py` (`ParsingRateLimiter`),
который **никогда не подключался**: он появился в том же коммите `2d959a10`,
что и живой `parsing_manager`, и ни один модуль его не импортировал.
Удалён 2026-08-08.

**Ожидаемое поведение:** сценарий проверяет защиту, которой нет. Перед
прогоном его надо либо переписать под действующий глобальный лимит, либо
сперва реализовать per-user лимит и проверку ресурсов в `parsing_manager`.

### 2.7 Сценарий 6: Эффективность кэша (одна книга, разные пользователи)

**Цель:** Измерить Redis cache hit rate при чтении одной популярной книги.

**Профиль:**

- 50 пользователей читают одну и ту же книгу
- Первый пользователь: cold cache (все MISS)
- Остальные 49: hot cache (все HIT)

> **Примечание**: В текущей архитектуре `Book.user_id` — книги принадлежат одному пользователю, shared books нет. Сценарий корректнее формулировать как: '50 пользователей загрузили одинаковую книгу (разные копии), LLM cache сработает по content hash'.

**Метрики:**

- Cache hit rate (ожидание: >95% после warm-up)
- Экономия на PostgreSQL queries (ожидание: -90%)
- Redis memory usage per book
- TTL effectiveness:
  - book_metadata: 3600s (1 час)
  - chapter_content: 3600s (1 час)
  - user_progress: 300s (5 минут)
  - llm_response: 86400s (24 часа)

### 2.8 Сценарий 7: Тест circuit breaker (отказ OpenRouter)

**Цель:** Проверить graceful degradation при недоступности AI-провайдера.

**Этапы:**

1. **Baseline** (2 мин): Нормальная работа — 10 users запрашивают extract_new=true
2. **Failure injection** (3 мин): Мок OpenRouter возвращает 503 для всех запросов
3. **Circuit breaker opens**: После 5 последовательных сбоев → open state (60 сек)
4. **Half-open probe** (1 мин): Один пробный запрос проходит
5. **Recovery** (2 мин): Мок возвращается к нормальной работе

**Метрики:**

- Время до открытия circuit breaker (ожидание: ~5-10 сек при последовательных ошибках)
- Количество запросов, заблокированных в open state
- Fallback chain: Gemini Flash → Claude Haiku 4.5 → Gemini Flash Lite
- Время полного восстановления (ожидание: 60-120 сек)

**Prometheus метрики:**

- `circuit_breaker_state{name="openrouter_api"}`: 0→2→1→0
- `circuit_breaker_failure_count{name="openrouter_api"}`: 0→5→0
- `llm_fallback_total{from_model, to_model}`

### 2.9 Сценарий 8: Насыщение rate limiter

**Цель:** Проверить, что rate limiter корректно защищает систему.

**Конфигурация rate limits:**

```
high_frequency: 60 req/min (progress updates)
normal:         30 req/min (CRUD)
ai_operation:   10 req/min (LLM extraction)
ai_image:        5 req/min (image generation)
auth:           10 req/min (login/register)
registration:    2 req/min (signup)
```

**Профиль:**

- 20 пользователей отправляют запросы с минимальным think time
- Измеряем: сколько 429 ответов при разных rate limits
- Проверяем: правильность Retry-After headers
- Проверяем: `rate_limit_triggered_total` Prometheus counter

---

## 3. Метрики для сбора

### 3.1 API Response Times

| Метрика           | Thresholds                    | Источник    |
| ----------------- | ----------------------------- | ----------- |
| P50 response time | < 100ms (cached), < 2s (AI)   | Locust / k6 |
| P95 response time | < 500ms (cached), < 10s (AI)  | Locust / k6 |
| P99 response time | < 1s (cached), < 30s (AI)     | Locust / k6 |
| Error rate        | < 1% (non-AI), < 5% (AI)      | Locust / k6 |
| Throughput (RPS)  | > 50 RPS (read), > 5 RPS (AI) | Locust / k6 |

### 3.2 Celery Queue & Processing

| Метрика                      | Thresholds                    | Источник                       |
| ---------------------------- | ----------------------------- | ------------------------------ |
| Queue depth (pending tasks)  | < 50 (normal), < 100 (peak)   | Flower / Redis LLEN            |
| Task processing time         | < 15s (image), < 3600s (book) | Celery result backend          |
| Worker utilization           | < 80%                         | Flower                         |
| Task retry count             | < 10% of total                | `celery_app.control.inspect()` |
| Task failure rate            | < 5%                          | Flower                         |
| max_tasks_per_child restarts | monitor                       | Flower                         |

### 3.3 OpenRouter API

| Метрика                      | Thresholds                 | Источник                       |
| ---------------------------- | -------------------------- | ------------------------------ |
| LLM request latency P95      | < 5s (text), < 15s (image) | `llm_request_duration_seconds` |
| LLM error rate               | < 3%                       | `llm_errors_total`             |
| Token usage (input + output) | monitor                    | `llm_tokens_total`             |
| Cost per operation           | monitor                    | `llm_cost_dollars_total`       |
| Fallback activations         | < 5% of requests           | `llm_fallback_total`           |
| Circuit breaker state        | 0 (closed)                 | `circuit_breaker_state`        |
| Rate limit hits              | 0 в нормальном режиме      | `llm_rate_limit_hits_total`    |

### 3.4 Redis Cache

| Метрика           | Thresholds              | Источник                          |
| ----------------- | ----------------------- | --------------------------------- |
| Cache hit rate    | > 80%                   | `redis INFO keyspace_hits/misses` |
| Memory usage      | < 640MB (maxmemory)     | `redis INFO used_memory`          |
| Connected clients | < 50 (max_connections)  | `redis INFO connected_clients`    |
| Evicted keys      | 0 (volatile-lru policy) | `redis INFO evicted_keys`         |
| LLM cache hits    | monitor                 | `llm_cache_hits_total`            |
| Lock contention   | < 10% of requests       | Monitor `BUSY` lock responses     |

### 3.5 PostgreSQL

| Метрика                     | Thresholds      | Источник                         |
| --------------------------- | --------------- | -------------------------------- |
| Active connections          | < 100 (max 150) | `pg_stat_activity`               |
| Query P95 latency           | < 50ms          | `pg_stat_statements`             |
| Slow queries (>500ms)       | < 1%            | `log_min_duration_statement=500` |
| Transaction rate            | monitor         | `pg_stat_database`               |
| Dead tuples / autovacuum    | monitor         | `pg_stat_user_tables`            |
| Connection pool utilization | < 80%           | SQLAlchemy pool stats            |

### 3.6 Системные ресурсы

| Метрика           | Thresholds                 | Источник         |
| ----------------- | -------------------------- | ---------------- |
| CPU utilization   | < 80% sustained            | Netdata          |
| Memory usage      | < 85% (rate_limiter check) | Netdata / psutil |
| Disk I/O          | < 80% utilization          | Netdata          |
| Network bandwidth | < 80%                      | Netdata          |
| Container memory  | within limits              | Docker stats     |

### 3.7 Стоимость операций под нагрузкой

| Операция                             | Примерная стоимость (OpenRouter) |
| ------------------------------------ | -------------------------------- |
| Извлечение описаний (Gemini 3 Flash) | ~$0.001 per chapter              |
| Entity synthesis (Gemini 3 Flash)    | ~$0.002 per book                 |
| Entity deduplication                 | ~$0.001 per book                 |
| Image generation (FLUX.2 Klein)      | ~$0.014 per image                |
| Полная обработка книги (50 глав)     | ~$0.10-0.20                      |

> **Примечание**: Канонический baseline — 25 глав, $0.50-1.50 за книгу (cache miss). См. [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md)

---

## 4. Стратегия мокирования OpenRouter

### 4.1 Проблема

Нагрузочное тестирование с реальным OpenRouter API:

- **Стоимость**: 100 полных обработок книг = $10-20
- **Rate limits**: OpenRouter имеет собственные лимиты
- **Нестабильность**: реальная латентность варьируется
- **Воспроизводимость**: разные результаты при каждом запуске

### 4.2 Трёхуровневая стратегия мокирования

#### Уровень 1: Полный мок (для stress-тестов)

Локальный HTTP-сервер, эмулирующий OpenRouter API с контролируемой латентностью.

```python
# mock_openrouter.py — FastAPI mock server
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import asyncio
import random
import base64
import json
import time

app = FastAPI(title="OpenRouter Mock")

# Конфигурируемая латентность
LATENCY_CONFIG = {
    "text_min_ms": 500,
    "text_max_ms": 3000,
    "image_min_ms": 2000,
    "image_max_ms": 8000,
    "error_rate": 0.0,        # 0% ошибок по умолчанию
    "timeout_rate": 0.0,      # 0% таймаутов
}

# Фиксированный JSON-ответ для entity extraction
MOCK_EXTRACTION_RESPONSE = {
    "descriptions": [
        {
            "content": "Тёмный коридор замка с факелами на стенах",
            "type": "location",
            "confidence_score": 0.9,
            "priority_score": 0.8,
            "word_count": 7,
            "entities_mentioned": ["Замок", "Коридор"]
        }
    ],
    "entities": [
        {
            "name": "Замок",
            "type": "location",
            "visual_summary": "Средневековый каменный замок",
            "chapter_event_action": "появление",
            "chapter_event_inner": None
        }
    ]
}

# Фиксированный base64 изображение (1x1 PNG placeholder)
MOCK_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "2mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@app.post("/api/v1/chat/completions")
async def mock_chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "")
    modalities = body.get("modalities", [])

    # Simulate error injection
    roll = random.random()
    if roll < LATENCY_CONFIG["error_rate"]:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Service temporarily unavailable"}},
        )
    if roll < LATENCY_CONFIG["error_rate"] + LATENCY_CONFIG["timeout_rate"]:
        await asyncio.sleep(120)  # Trigger client timeout
        return JSONResponse(status_code=504, content={})

    # Image generation
    if "image" in modalities:
        latency = random.uniform(
            LATENCY_CONFIG["image_min_ms"],
            LATENCY_CONFIG["image_max_ms"],
        ) / 1000
        await asyncio.sleep(latency)

        return JSONResponse(content={
            "id": f"gen-mock-{int(time.time())}",
            "choices": [{
                "message": {
                    "images": [{
                        "image_url": {
                            "url": f"data:image/png;base64,{MOCK_IMAGE_B64}"
                        }
                    }]
                }
            }],
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 0,
                "cost": 0.014,
            },
        })

    # Text generation (LLM)
    latency = random.uniform(
        LATENCY_CONFIG["text_min_ms"],
        LATENCY_CONFIG["text_max_ms"],
    ) / 1000
    await asyncio.sleep(latency)

    content = json.dumps(MOCK_EXTRACTION_RESPONSE)

    return JSONResponse(content={
        "id": f"gen-mock-{int(time.time())}",
        "choices": [{
            "message": {
                "content": content,
                "role": "assistant",
            }
        }],
        "usage": {
            "prompt_tokens": 1000,
            "completion_tokens": 500,
            "cost": 0.001,
        },
    })


@app.post("/api/v1/mock/config")
async def update_config(request: Request):
    """Динамическое изменение конфигурации мока во время теста."""
    body = await request.json()
    LATENCY_CONFIG.update(body)
    return {"status": "updated", "config": LATENCY_CONFIG}
```

**Запуск:**

```bash
uvicorn mock_openrouter:app --host 0.0.0.0 --port 9999
```

**Переключение в тестах:**

```bash
# В docker-compose.loadtest.yml или env:
OPENROUTER_BASE_URL=http://mock-openrouter:9999/api/v1
```

Для этого нужна небольшая модификация `openrouter_client.py` — вынести `OPENROUTER_BASE_URL` в `settings`:

```python
# В config.py добавить:
OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

# В openrouter_client.py использовать:
base_url=settings.OPENROUTER_BASE_URL
```

#### Уровень 2: Частичный мок (для интеграционных тестов)

- Реальный OpenRouter для первых 5-10 запросов (проверка формата ответов)
- Мок для остальных (stress-часть)
- Переключение через конфигурацию мока в runtime

```python
# В mock_openrouter.py добавить proxy mode:
PROXY_CONFIG = {
    "enabled": False,
    "real_api_key": "",
    "requests_to_proxy": 5,  # Первые N запросов → реальный API
    "proxied_count": 0,
}

@app.post("/api/v1/mock/proxy")
async def enable_proxy(request: Request):
    body = await request.json()
    PROXY_CONFIG.update(body)
    PROXY_CONFIG["proxied_count"] = 0
    return {"status": "proxy configured"}
```

#### Уровень 3: Replay мок (для регрессии)

Записать реальные ответы OpenRouter и воспроизводить:

```python
# Шаг 1: Записать ответы (в development)
# Добавить middleware в openrouter_client.py:
async def _post_with_recording(self, endpoint, body):
    resp = await self._post_with_breaker(endpoint, body)
    # Сохранить в файл
    with open(f"fixtures/{hash(str(body))}.json", "w") as f:
        json.dump({"request": body, "response": resp.json()}, f)
    return resp

# Шаг 2: Воспроизвести в mock server
# Загрузить fixtures и возвращать по hash запроса
```

### 4.3 OpenRouter sandbox/test mode

На текущий момент (март 2026) OpenRouter **не предоставляет** sandbox/test mode. Варианты:

- Использовать дешёвые модели для тестов (`google/gemini-2.5-flash-lite` — самая дешёвая)
- Установить `max_tokens: 10` для минимизации cost при тестовых вызовах
- Использовать полный мок (Уровень 1) для stress-тестов

---

## 5. Идентификация узких мест инфраструктуры

### 5.1 Текущие ресурсные лимиты (VPS 32GB / 12 vCPU)

```
Сервис              CPU limit   Memory limit   Memory reserved
────────────────────────────────────────────────────────────────
PostgreSQL           4.0 CPU     12 GB          8 GB
Backend (Uvicorn)    2.0 CPU      2 GB          768 MB
Celery Worker        1.5 CPU    1.5 GB          512 MB
Redis                0.5 CPU    768 MB          384 MB
Caddy                0.5 CPU    128 MB           64 MB
Celery Beat          0.3 CPU    256 MB          128 MB
────────────────────────────────────────────────────────────────
Итого:               8.8 CPU   ~17 GB          ~10 GB
Остаток для OS:      3.2 CPU   ~15 GB
```

### 5.2 Потенциальные узкие места

#### A. PostgreSQL Connection Pool

**Конфигурация:**

- `DB_POOL_SIZE=20`, `DB_MAX_OVERFLOW=40` → max 60 connections
- PostgreSQL `max_connections=150`
- 2 Uvicorn workers × 60 connections = 120 connections (теоретический максимум)
- Celery Worker тоже использует connections через `AsyncSessionLocal`

**Риск:** При 100+ параллельных пользователях connection pool может исчерпаться.

**Рекомендация:**

- Мониторить `pg_stat_activity` во время тестов
- Тестировать с pool exhaustion: что происходит при timeout=30s

#### B. Redis Memory (640MB maxmemory)

**Текущее использование:**

- DB 0: Cache (chapter content, entity networks, LLM responses)
- DB 1: Celery broker (task queue) — **НЕЛЬЗЯ flush!**
- DB 2: Celery results

**Риск:** LLM cache (TTL 30 дней) + глобальный cache могут заполнить 640MB при множестве книг.

**Рекомендация:**

- `volatile-lru` eviction policy уже настроена (удаляет только ключи с TTL)
- Мониторить `evicted_keys` — если растёт, нужно увеличить maxmemory

#### C. Celery Worker Concurrency

**Конфигурация:**

- `concurrency=2` (2 параллельных задачи)
- `max_tasks_per_child=100` (worker перезапускается после 100 задач)
- `max_memory_per_child=512MB`
- Task routing: `process_book_task` → "heavy" queue, images → "normal"

**Риск:** При 30 запросах на генерацию изображений задачи копятся в очереди:

- 2 задачи обрабатываются одновременно
- 28 ожидают (latency увеличивается линейно)
- Если каждое изображение = 10 сек, то 30-е изображение ждёт ~150 сек

**Рекомендация:**

- Увеличить concurrency до 4 для image tasks
- Или добавить второй Celery worker для "normal" queue

#### D. Network Bandwidth (OpenRouter)

**Расчёт для burst-сценария (20 книг × 50 глав):**

- 1000 LLM вызовов × ~2KB prompt + ~1KB response = ~3MB
- Entity synthesis/dedup: дополнительно ~200 вызовов
- Суммарно: ~3.6MB текстовых данных (несущественно)

**Для image generation:**

- 30 изображений × ~500KB per image = ~15MB (несущественно)

**Вывод:** Network bandwidth — не bottleneck для текущего масштаба.

#### E. Disk I/O

**Потенциальные проблемы:**

- PostgreSQL WAL writes при массовой вставке описаний/сущностей
- Image files записываются в `/app/storage/generated_images`
- Redis AOF persistence (`appendonly yes`)

**Рекомендация:**

- Мониторить disk I/O utilization через Netdata
- Тестировать SSD vs HDD performance

#### F. Uvicorn Worker Count

**Конфигурация:**

- `WORKERS_COUNT=2` (default, overridable via env)
- Background tasks (description extraction) выполняются внутри worker process
- Каждый background task блокирует один worker на время LLM вызова

**Риск:** 2 worker'а, оба заняты background extraction → API перестаёт отвечать.

**Рекомендация:**

- Увеличить до 4 workers
- Или перенести все AI extraction в Celery (не использовать BackgroundTasks)

---

## 6. Мониторинг во время тестов

### 6.1 Существующий мониторинг-стек fancai

Из `docker-compose.monitoring.yml`:

- **Netdata** — системные метрики хоста (CPU, RAM, disk, network)
- **VictoriaMetrics** — долгосрочное хранение метрик (90 дней retention)
- **Uptime Kuma** — мониторинг доступности
- **Dozzle** — real-time Docker logs
- **Flower** — Celery task мониторинг

**Prometheus metrics** экспортируются из backend через `/health/metrics` endpoint.

### 6.2 Дополнительные метрики для нагрузочного тестирования

Уже реализованные Prometheus метрики в `backend/app/monitoring/metrics.py`:

```
# LLM метрики
llm_requests_total{model, status}
llm_request_duration_seconds{model}
llm_tokens_total{model, direction}
llm_errors_total{model, error_type}
llm_cost_dollars_total{model}
llm_fallback_total{from_model, to_model}
llm_cache_hits_total{model}
llm_cache_misses_total{model}

# Circuit breaker
circuit_breaker_state{name="openrouter_api"}
circuit_breaker_failure_count{name="openrouter_api"}

# Rate limiting
rate_limit_triggered_total{endpoint, limit_type}

# Sessions
reading_sessions_active_count{device_type}
reading_session_api_latency_seconds{endpoint, method, status_code}
```

### 6.3 Dashboards для создания в Netdata

#### Dashboard 1: API Performance

```
Panels:
- HTTP request rate (RPS) — по endpoint
- Response time P50/P95/P99 — по endpoint
- Error rate (4xx, 5xx) — по endpoint
- Active connections (Uvicorn workers)
```

#### Dashboard 2: AI Pipeline

```
Panels:
- LLM request rate — по модели
- LLM latency P50/P95 — по модели
- LLM error rate — по типу ошибки
- Fallback chain activations
- Circuit breaker state timeline
- LLM cost accumulation ($)
- Cache hit ratio (LLM cache)
```

#### Dashboard 3: Celery Workers

```
Panels:
- Queue depth (pending tasks) — по очереди (heavy, normal, light)
- Task processing time — по типу задачи
- Worker utilization
- Task success/failure rate
- Memory per worker
```

#### Dashboard 4: Infrastructure

```
Panels:
- CPU utilization (per container)
- Memory usage (per container vs limits)
- PostgreSQL connections (active/idle/waiting)
- PostgreSQL query latency
- Redis memory usage vs maxmemory
- Redis cache hit rate
- Disk I/O throughput
```

### 6.4 Alert thresholds для валидации

```yaml
# monitoring/netdata/health.d/loadtest.conf
alarm: api_error_rate_high
  on: llm_errors_total
  lookup: average -1m percentage
  every: 10s
  warn: $this > 5
  crit: $this > 15
  info: API error rate exceeds threshold during load test

alarm: celery_queue_deep
  on: celery_queue_depth
  lookup: average -1m
  every: 10s
  warn: $this > 50
  crit: $this > 100
  info: Celery queue depth is growing

alarm: pg_connections_high
  on: pg_stat_activity_count
  lookup: average -1m
  every: 10s
  warn: $this > 100
  crit: $this > 130
  info: PostgreSQL connections approaching limit (150)

alarm: redis_memory_high
  on: redis_used_memory
  lookup: average -1m
  every: 10s
  warn: $this > 500000000   # 500MB
  crit: $this > 600000000   # 600MB (limit 640MB)
  info: Redis memory approaching maxmemory limit

alarm: circuit_breaker_open
  on: circuit_breaker_state
  lookup: max -30s
  every: 5s
  crit: $this == 2
  info: OpenRouter circuit breaker is OPEN
```

### 6.5 Сбор и анализ результатов

```bash
# Экспорт результатов Locust в CSV
locust --csv=results/loadtest \
       --csv-full-history \
       --html=results/report.html

# Файлы:
# results/loadtest_stats.csv      — агрегированные метрики
# results/loadtest_stats_history.csv — временной ряд
# results/loadtest_failures.csv   — ошибки
# results/loadtest_exceptions.csv — исключения
# results/report.html             — HTML-отчёт

# Экспорт метрик VictoriaMetrics за период теста
curl "http://localhost:8428/api/v1/export?match[]={__name__=~'llm.*|circuit.*|rate_limit.*'}&start=$(date -d '1 hour ago' +%s)&end=$(date +%s)" \
  > results/prometheus_metrics.json
```

---

## 7. Рекомендации по масштабированию

### 7.1 Масштабирование Celery Workers

| Показатель  | Текущее     | Рекомендация                  | Когда масштабировать       |
| ----------- | ----------- | ----------------------------- | -------------------------- |
| Concurrency | 2           | 4 (normal), 2 (heavy)         | Queue depth > 20 устойчиво |
| Workers     | 1 container | 2 containers (normal + heavy) | Queue depth > 50           |
| Memory      | 1.5GB limit | 2GB per worker                | OOM kills или restarts     |

**Реализация — отдельные workers по очередям:**

```yaml
# docker-compose.prod.yml — добавить:
celery-worker-normal:
  image: fancai-backend:latest
  command: >
    celery -A app.core.celery_app worker
    --loglevel=info --concurrency=4
    --queues=normal,light
    --max-tasks-per-child=100
    --max-memory-per-child=512000
  deploy:
    resources:
      limits:
        cpus: "2.0"
        memory: 2G

celery-worker-heavy:
  image: fancai-backend:latest
  command: >
    celery -A app.core.celery_app worker
    --loglevel=info --concurrency=2
    --queues=heavy
    --max-tasks-per-child=20
    --max-memory-per-child=1024000
  deploy:
    resources:
      limits:
        cpus: "2.0"
        memory: 2G
```

### 7.2 PostgreSQL Read Replicas

**Когда:** Query latency P95 > 100ms устойчиво при 100+ users.

**Подход:**

1. Настроить streaming replication (PostgreSQL 17 native)
2. Модифицировать `get_database_session()` для routing:
   - `SELECT` queries → read replica
   - `INSERT/UPDATE/DELETE` → primary
3. Использовать SQLAlchemy `create_engine` с `execution_options(postgresql_readonly=True)`

**Стоимость:** +8-12GB RAM для replica на том же VPS, или +$30-50/мес за отдельный VPS.

### 7.3 Multi-VPS Architecture

**Когда:** 200+ concurrent users или CPU utilization > 80% sustained.

**Архитектура:**

```
VPS 1 (Application):       VPS 2 (Database + Cache):
├── Caddy                   ├── PostgreSQL 17 (primary)
├── Backend (4 workers)     ├── Redis 7.4
├── Celery Normal (4)       └── PostgreSQL replica (optional)
├── Celery Heavy (2)
├── Celery Beat
└── Monitoring stack

VPS 3 (AI Workers, optional):
├── Celery Normal (8)
├── Celery Heavy (4)
└── Redis (result backend clone)
```

**Стоимость:** ~$60-120/мес за дополнительный VPS (4-8 vCPU, 16GB RAM).

### 7.4 Cost vs Performance Trade-offs

| Оптимизация                            | Стоимость        | Выигрыш                         |
| -------------------------------------- | ---------------- | ------------------------------- |
| Увеличить Celery concurrency 2→4       | $0 (текущий VPS) | -50% queue wait time            |
| Добавить Uvicorn workers 2→4           | $0 (текущий VPS) | -50% background task blocking   |
| Увеличить Redis maxmemory 640→1024MB   | $0 (текущий VPS) | Больше cache, меньше evictions  |
| Добавить PgBouncer (connection pooler) | $0 (контейнер)   | -30% connection overhead        |
| Второй Celery worker container         | $0 (текущий VPS) | Раздельные heavy/normal очереди |
| Read replica PostgreSQL                | ~$30/мес         | -50% query load на primary      |
| Второй VPS для workers                 | ~$60/мес         | 2x AI throughput                |
| CDN для изображений                    | ~$10/мес         | -90% image serving load         |

---

## 8. Примеры тестовых скриптов

### 8.1 Locust — основной файл для fancai

```python
# loadtest/locustfile.py
"""
Нагрузочное тестирование fancai AI pipeline.

Запуск:
  cd loadtest
  locust -f locustfile.py --host=https://fancai.ru

Без GUI (headless):
  locust -f locustfile.py --host=https://fancai.ru \
         --users=100 --spawn-rate=10 --run-time=20m \
         --csv=results/fancai --html=results/report.html
"""

import json
import random
import time
from uuid import UUID

from locust import HttpUser, TaskSet, task, between, events, tag
from locust.exception import StopUser


# ============================================================================
# Конфигурация
# ============================================================================

# Тестовые пользователи (создать заранее через API или seed script)
TEST_USERS = [
    {"email": f"loadtest_user_{i}@test.com", "password": "LoadTest2026!"}
    for i in range(100)
]

# UUID книг (предварительно загруженных в тестовую БД)
TEST_BOOK_IDS = []  # Заполняется в on_test_start
TEST_CHAPTER_COUNT = 30  # Среднее кол-во глав в тестовой книге


# ============================================================================
# Events — setup/teardown
# ============================================================================

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Seed data setup — выполняется один раз перед тестом."""
    # Здесь можно загрузить тестовые книги и получить их ID
    print("[SETUP] Preparing test data...")
    # В реальном сценарии: запустить seed script или загрузить fixtures
    # TEST_BOOK_IDS.extend(seed_test_books())


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Cleanup после теста."""
    print("[TEARDOWN] Cleaning up test data...")


# ============================================================================
# Mixin: Auth + Helper Methods
# ============================================================================

class FancaiMixin:
    """Mixin с общими методами для всех типов пользователей."""

    access_token: str = ""
    refresh_token: str = ""
    current_book_id: str = ""
    current_chapter: int = 1

    def login(self):
        """Аутентификация и получение JWT токена."""
        user = random.choice(TEST_USERS)
        with self.client.post(
            "/api/v1/auth/login",
            json={"email": user["email"], "password": user["password"]},
            catch_response=True,
            name="/api/v1/auth/login",
        ) as response:
            if response.status_code == 200:
                data = response.json()
                self.access_token = data["access_token"]
                self.refresh_token = data.get("refresh_token", "")
                response.success()
            elif response.status_code == 429:
                response.failure("Rate limited on login")
                time.sleep(5)
            else:
                response.failure(f"Login failed: {response.status_code}")
                raise StopUser()

    @property
    def auth_headers(self):
        return {"Authorization": f"Bearer {self.access_token}"}

    def get_user_books(self):
        """Получить список книг пользователя."""
        with self.client.get(
            "/api/v1/books/?skip=0&limit=10",
            headers=self.auth_headers,
            catch_response=True,
            name="/api/v1/books/",
        ) as response:
            if response.status_code == 200:
                data = response.json()
                books = data.get("books", data) if isinstance(data, dict) else data
                if books and isinstance(books, list) and len(books) > 0:
                    self.current_book_id = str(books[0].get("id", ""))
                response.success()
            elif response.status_code == 401:
                self.login()  # Token expired, re-login
            else:
                response.failure(f"Get books failed: {response.status_code}")


# ============================================================================
# Сценарий 1: Читатель (70% пользователей)
# ============================================================================

class ReaderBehavior(TaskSet, FancaiMixin):
    """Обычный читатель: открывает книгу, читает главы, обновляет прогресс."""

    def on_start(self):
        self.login()
        self.get_user_books()
        if not self.current_book_id:
            raise StopUser()

    @task(5)
    @tag("read")
    def read_chapter(self):
        """Чтение главы — самое частое действие."""
        chapter = random.randint(1, TEST_CHAPTER_COUNT)
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/{chapter}",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/chapters/[n]",
        )
        self.current_chapter = chapter

    @task(3)
    @tag("progress")
    def update_progress(self):
        """Обновление прогресса чтения (каждые 30 сек при реальном чтении)."""
        self.client.post(
            f"/api/v1/books/{self.current_book_id}/progress",
            headers=self.auth_headers,
            json={
                "current_chapter": self.current_chapter,
                "reading_location_cfi": f"/6/4[chap{self.current_chapter}]!/4/2/1:0",
                "scroll_offset_percent": random.uniform(0, 100),
            },
            name="/api/v1/books/[id]/progress",
        )

    @task(2)
    @tag("progress")
    def get_progress(self):
        """Получение прогресса (для синхронизации между устройствами)."""
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/progress",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/progress [GET]",
        )

    @task(1)
    @tag("sync")
    def batch_sync(self):
        """sendBeacon-подобная batch синхронизация."""
        self.client.post(
            "/api/v1/sync/batch",
            headers={"Content-Type": "text/plain"},
            data=json.dumps({
                "token": self.access_token,
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{self.current_book_id}/progress",
                        "method": "PUT",
                        "body": {
                            "chapter_number": self.current_chapter,
                            "cfi": f"/6/4[chap{self.current_chapter}]!/4/2/1:0",
                            "scrollPercent": random.uniform(0, 100),
                        },
                    }
                ],
            }),
            name="/api/v1/sync/batch",
        )


# ============================================================================
# Сценарий 2: Активный читатель (20% пользователей)
# ============================================================================

class ActiveReaderBehavior(TaskSet, FancaiMixin):
    """Активный читатель: читает + просматривает entity network + описания."""

    def on_start(self):
        self.login()
        self.get_user_books()
        if not self.current_book_id:
            raise StopUser()

    @task(4)
    @tag("read")
    def read_chapter(self):
        chapter = random.randint(1, TEST_CHAPTER_COUNT)
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/{chapter}",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/chapters/[n]",
        )
        self.current_chapter = chapter

    @task(3)
    @tag("entity")
    def get_entity_network(self):
        """Загрузка графа сущностей с фильтром по текущей главе."""
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/entities/network"
            f"?current_chapter={self.current_chapter}",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/entities/network",
        )

    @task(2)
    @tag("description")
    def get_descriptions(self):
        """Получение описаний главы (без extract_new — только кэш)."""
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/"
            f"{self.current_chapter}/descriptions",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/chapters/[n]/descriptions",
        )

    @task(1)
    @tag("description", "ai")
    def get_descriptions_extract(self):
        """Запрос извлечения описаний (extract_new=true) — AI вызов."""
        with self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/"
            f"{self.current_chapter}/descriptions?extract_new=true",
            headers=self.auth_headers,
            catch_response=True,
            name="/api/v1/books/[id]/chapters/[n]/descriptions?extract_new=true",
        ) as response:
            if response.status_code in (200, 409, 429, 503):
                response.success()  # 409=lock, 429=rate limit, 503=CB open
            else:
                response.failure(f"Unexpected: {response.status_code}")

    @task(2)
    @tag("progress")
    def update_progress(self):
        self.client.post(
            f"/api/v1/books/{self.current_book_id}/progress",
            headers=self.auth_headers,
            json={
                "current_chapter": self.current_chapter,
                "scroll_offset_percent": random.uniform(0, 100),
            },
            name="/api/v1/books/[id]/progress",
        )


# ============================================================================
# Сценарий 3: Генератор изображений (10% пользователей)
# ============================================================================

class ImageGeneratorBehavior(TaskSet, FancaiMixin):
    """Пользователь, генерирующий иллюстрации."""

    description_ids: list = []

    def on_start(self):
        self.login()
        self.get_user_books()
        if not self.current_book_id:
            raise StopUser()
        self._load_descriptions()

    def _load_descriptions(self):
        """Загрузить описания для генерации."""
        response = self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/1/descriptions",
            headers=self.auth_headers,
            name="[setup] load descriptions",
        )
        if response.status_code == 200:
            data = response.json()
            descs = data.get("descriptions", [])
            self.description_ids = [d["id"] for d in descs if "id" in d]

    @task(2)
    @tag("read")
    def read_chapter(self):
        chapter = random.randint(1, TEST_CHAPTER_COUNT)
        self.client.get(
            f"/api/v1/books/{self.current_book_id}/chapters/{chapter}",
            headers=self.auth_headers,
            name="/api/v1/books/[id]/chapters/[n]",
        )

    @task(3)
    @tag("image", "ai")
    def generate_image_async(self):
        """Асинхронная генерация изображения через Celery."""
        if not self.description_ids:
            return

        desc_id = random.choice(self.description_ids)

        with self.client.post(
            f"/api/v1/images/generate/async/{desc_id}",
            headers=self.auth_headers,
            json={"style_prompt": "illustration, detailed, book art"},
            catch_response=True,
            name="/api/v1/images/generate/async/[id]",
        ) as response:
            if response.status_code == 202:
                task_id = response.json().get("task_id")
                if task_id:
                    self._poll_task(task_id)
                response.success()
            elif response.status_code in (402, 409, 429):
                response.success()  # Quota/conflict/rate limit — expected
            else:
                response.failure(f"Unexpected: {response.status_code}")

    def _poll_task(self, task_id: str, max_polls: int = 10):
        """Опрос статуса Celery task."""
        for _ in range(max_polls):
            time.sleep(3)
            with self.client.get(
                f"/api/v1/images/task/{task_id}",
                headers=self.auth_headers,
                catch_response=True,
                name="/api/v1/images/task/[id]",
            ) as resp:
                if resp.status_code == 200:
                    data = resp.json()
                    status = data.get("status", "")
                    if status in ("SUCCESS", "FAILURE", "REVOKED"):
                        resp.success()
                        return
                    resp.success()
                else:
                    resp.failure(f"Poll failed: {resp.status_code}")
                    return

    @task(1)
    @tag("image")
    def check_image_stats(self):
        """Проверка статистики изображений."""
        self.client.get(
            "/api/v1/images/user/stats",
            headers=self.auth_headers,
            name="/api/v1/images/user/stats",
        )


# ============================================================================
# User Classes (распределение нагрузки)
# ============================================================================

class ReaderUser(HttpUser):
    """Обычный читатель — 70% трафика."""
    tasks = [ReaderBehavior]
    wait_time = between(20, 60)  # Think time: 20-60 сек (чтение текста)
    weight = 7  # 70%


class ActiveReaderUser(HttpUser):
    """Активный читатель — 20% трафика."""
    tasks = [ActiveReaderBehavior]
    wait_time = between(10, 30)  # Think time: 10-30 сек
    weight = 2  # 20%


class ImageGeneratorUser(HttpUser):
    """Генератор изображений — 10% трафика."""
    tasks = [ImageGeneratorBehavior]
    wait_time = between(5, 15)  # Think time: 5-15 сек
    weight = 1  # 10%
```

### 8.2 k6 — HTTP benchmark для API endpoints

```javascript
// loadtest/k6_api_benchmark.js
/**
 * k6 benchmark для fancai API endpoints.
 *
 * Запуск:
 *   k6 run loadtest/k6_api_benchmark.js
 *
 * С Prometheus output:
 *   k6 run --out experimental-prometheus-rw loadtest/k6_api_benchmark.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// ============================================================================
// Custom Metrics
// ============================================================================

const errorRate = new Rate("errors");
const chapterLatency = new Trend("chapter_latency", true);
const entityNetworkLatency = new Trend("entity_network_latency", true);
const descriptionLatency = new Trend("description_latency", true);
const progressUpdateLatency = new Trend("progress_update_latency", true);

// ============================================================================
// Configuration
// ============================================================================

export const options = {
  scenarios: {
    // Сценарий 1: Постепенное нарастание читателей
    readers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 }, // Ramp up to 50
        { duration: "5m", target: 100 }, // Ramp up to 100
        { duration: "10m", target: 100 }, // Sustain 100
        { duration: "2m", target: 0 }, // Ramp down
      ],
      gracefulRampDown: "30s",
      exec: "readerScenario",
    },

    // Сценарий 2: Spike test — резкий всплеск
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 200 }, // Spike to 200
        { duration: "1m", target: 200 }, // Hold
        { duration: "10s", target: 0 }, // Drop
      ],
      startTime: "20m", // Запускается после основного сценария
      exec: "spikeScenario",
    },
  },

  thresholds: {
    // API response time thresholds
    "http_req_duration{name:chapter}": ["p(95)<500", "p(99)<2000"],
    "http_req_duration{name:progress_get}": ["p(95)<200", "p(99)<500"],
    "http_req_duration{name:progress_update}": ["p(95)<300", "p(99)<1000"],
    "http_req_duration{name:entity_network}": ["p(95)<1000", "p(99)<3000"],
    "http_req_duration{name:descriptions}": ["p(95)<500", "p(99)<2000"],

    // Error rate
    errors: ["rate<0.05"], // < 5% error rate

    // Custom metric thresholds
    chapter_latency: ["p(95)<500"],
    entity_network_latency: ["p(95)<1000"],
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

const BASE_URL = __ENV.BASE_URL || "https://fancai.ru";
const TEST_EMAIL = __ENV.TEST_EMAIL || "loadtest@test.com";
const TEST_PASSWORD = __ENV.TEST_PASSWORD || "LoadTest2026!";

function login() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: `loadtest_user_${__VU}@test.com`,
      password: TEST_PASSWORD,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "login" },
    },
  );

  if (res.status === 200) {
    return JSON.parse(res.body).access_token;
  }
  return null;
}

// ============================================================================
// Scenarios
// ============================================================================

export function readerScenario() {
  const token = login();
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Получить список книг
  const booksRes = http.get(`${BASE_URL}/api/v1/books/?skip=0&limit=5`, {
    headers,
    tags: { name: "books_list" },
  });

  if (booksRes.status !== 200) return;

  const books = JSON.parse(booksRes.body);
  const bookList = books.books || books;
  if (!bookList || bookList.length === 0) return;

  const bookId = bookList[0].id;
  const chapter = Math.floor(Math.random() * 20) + 1;

  group("reading_flow", function () {
    // 1. Читать главу
    const chapterRes = http.get(
      `${BASE_URL}/api/v1/books/${bookId}/chapters/${chapter}`,
      { headers, tags: { name: "chapter" } },
    );
    chapterLatency.add(chapterRes.timings.duration);
    check(chapterRes, {
      "chapter status 200": (r) => r.status === 200,
      "chapter latency < 500ms": (r) => r.timings.duration < 500,
    });
    errorRate.add(chapterRes.status !== 200);
    sleep(1);

    // 2. Обновить прогресс
    const progressRes = http.post(
      `${BASE_URL}/api/v1/books/${bookId}/progress`,
      JSON.stringify({
        current_chapter: chapter,
        scroll_offset_percent: Math.random() * 100,
      }),
      { headers, tags: { name: "progress_update" } },
    );
    progressUpdateLatency.add(progressRes.timings.duration);
    errorRate.add(progressRes.status !== 200);
    sleep(1);

    // 3. Получить прогресс
    const getProgressRes = http.get(
      `${BASE_URL}/api/v1/books/${bookId}/progress`,
      { headers, tags: { name: "progress_get" } },
    );
    check(getProgressRes, {
      "progress status 200": (r) => r.status === 200,
    });
    errorRate.add(getProgressRes.status !== 200);
    sleep(1);

    // 4. Entity network
    const entityRes = http.get(
      `${BASE_URL}/api/v1/books/${bookId}/entities/network?current_chapter=${chapter}`,
      { headers, tags: { name: "entity_network" } },
    );
    entityNetworkLatency.add(entityRes.timings.duration);
    check(entityRes, {
      "entity network status 200": (r) => r.status === 200,
      "entity network latency < 1000ms": (r) => r.timings.duration < 1000,
    });
    errorRate.add(entityRes.status !== 200);
    sleep(1);

    // 5. Описания
    const descRes = http.get(
      `${BASE_URL}/api/v1/books/${bookId}/chapters/${chapter}/descriptions`,
      { headers, tags: { name: "descriptions" } },
    );
    descriptionLatency.add(descRes.timings.duration);
    errorRate.add(descRes.status !== 200);
  });

  sleep(Math.random() * 5 + 2); // Think time: 2-7 sec
}

export function spikeScenario() {
  const token = login();
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Только GET запросы при spike
  http.get(`${BASE_URL}/api/v1/books/?skip=0&limit=5`, {
    headers,
    tags: { name: "spike_books" },
  });

  sleep(0.5);
}
```

### 8.3 Docker Compose для распределённого нагрузочного тестирования

```yaml
# loadtest/docker-compose.loadtest.yml
#
# Запуск:
#   docker compose -f loadtest/docker-compose.loadtest.yml up --scale locust-worker=4
#
# Web UI: http://localhost:8089

services:
  # Mock OpenRouter API
  mock-openrouter:
    build:
      context: .
      dockerfile: Dockerfile.mock
    container_name: fancai_mock_openrouter
    ports:
      - "9999:9999"
    environment:
      - MOCK_LATENCY_TEXT_MIN_MS=500
      - MOCK_LATENCY_TEXT_MAX_MS=3000
      - MOCK_LATENCY_IMAGE_MIN_MS=2000
      - MOCK_LATENCY_IMAGE_MAX_MS=8000
      - MOCK_ERROR_RATE=0.0
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9999/docs"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - loadtest_net

  # Locust Master
  locust-master:
    image: locustio/locust:2.33.0
    container_name: fancai_locust_master
    ports:
      - "8089:8089" # Web UI
    volumes:
      - ./locustfile.py:/mnt/locust/locustfile.py:ro
      - ./lib:/mnt/locust/lib:ro
      - ./results:/mnt/locust/results
    command: >
      -f /mnt/locust/locustfile.py
      --master
      --host=${TARGET_HOST:-https://fancai.ru}
      --csv=/mnt/locust/results/loadtest
      --csv-full-history
      --html=/mnt/locust/results/report.html
      --logfile=/mnt/locust/results/locust.log
      --loglevel=INFO
    environment:
      - TARGET_HOST=${TARGET_HOST:-https://fancai.ru}
    networks:
      - loadtest_net

  # Locust Workers (scale с --scale locust-worker=N)
  locust-worker:
    image: locustio/locust:2.33.0
    volumes:
      - ./locustfile.py:/mnt/locust/locustfile.py:ro
      - ./lib:/mnt/locust/lib:ro
    command: >
      -f /mnt/locust/locustfile.py
      --worker
      --master-host=locust-master
    depends_on:
      - locust-master
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
    networks:
      - loadtest_net

  # k6 Runner (для отдельных benchmark-ов)
  k6:
    image: grafana/k6:0.57.0
    container_name: fancai_k6
    volumes:
      - ./k6_api_benchmark.js:/scripts/benchmark.js:ro
      - ./results:/results
    command: >
      run /scripts/benchmark.js
      --out csv=/results/k6_results.csv
    environment:
      - BASE_URL=${TARGET_HOST:-https://fancai.ru}
      - TEST_PASSWORD=${TEST_PASSWORD:-LoadTest2026!}
    profiles:
      - k6 # Запускается только с --profile k6
    networks:
      - loadtest_net

networks:
  loadtest_net:
    driver: bridge
```

### 8.4 Seed Script для тестовых данных

```python
# loadtest/seed_test_data.py
"""
Создание тестовых пользователей и загрузка тестовых книг.

Запуск:
  python loadtest/seed_test_data.py --host https://fancai.ru --users 100
"""

import asyncio
import argparse
import httpx
from pathlib import Path


async def create_test_users(host: str, count: int):
    """Создать тестовых пользователей."""
    async with httpx.AsyncClient(base_url=host, timeout=30) as client:
        for i in range(count):
            email = f"loadtest_user_{i}@test.com"
            try:
                resp = await client.post("/api/v1/auth/register", json={
                    "email": email,
                    "password": "LoadTest2026!",
                    "display_name": f"LoadTest User {i}",
                })
                if resp.status_code == 201:
                    print(f"  Created user {email}")
                elif resp.status_code == 409:
                    print(f"  User {email} already exists")
                else:
                    print(f"  Failed to create {email}: {resp.status_code}")
            except Exception as e:
                print(f"  Error creating {email}: {e}")


async def upload_test_books(host: str, books_dir: str, admin_token: str):
    """Загрузить тестовые книги от имени каждого пользователя."""
    books = list(Path(books_dir).glob("*.epub"))
    if not books:
        print(f"  No EPUB files found in {books_dir}")
        return

    async with httpx.AsyncClient(base_url=host, timeout=120) as client:
        # Загрузить от первых 10 пользователей
        for i in range(min(10, len(books))):
            # Login as user
            resp = await client.post("/api/v1/auth/login", json={
                "email": f"loadtest_user_{i}@test.com",
                "password": "LoadTest2026!",
            })
            if resp.status_code != 200:
                continue

            token = resp.json()["access_token"]
            book_path = books[i % len(books)]

            # Upload book
            with open(book_path, "rb") as f:
                resp = await client.post(
                    "/api/v1/books/",
                    headers={"Authorization": f"Bearer {token}"},
                    files={"file": (book_path.name, f, "application/epub+zip")},
                )
                if resp.status_code in (200, 201):
                    book_id = resp.json().get("id")
                    print(f"  Uploaded {book_path.name} for user {i}: {book_id}")
                else:
                    print(f"  Upload failed: {resp.status_code} {resp.text[:200]}")


async def main():
    parser = argparse.ArgumentParser(description="Seed test data for load testing")
    parser.add_argument("--host", default="https://fancai.ru")
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--books-dir", default="./test_books")
    parser.add_argument("--admin-token", default="")
    args = parser.parse_args()

    print(f"[1/2] Creating {args.users} test users...")
    await create_test_users(args.host, args.users)

    print(f"[2/2] Uploading test books from {args.books_dir}...")
    await upload_test_books(args.host, args.books_dir, args.admin_token)

    print("Done! Test data is ready.")


if __name__ == "__main__":
    asyncio.run(main())
```

### 8.5 Скрипт мониторинга Celery во время теста

```python
# loadtest/monitor_celery.py
"""
Real-time мониторинг Celery задач во время нагрузочного теста.

Запуск:
  python loadtest/monitor_celery.py --broker redis://:password@redis:6379/1
"""

import asyncio
import json
import time
from datetime import datetime

import redis.asyncio as aioredis


async def monitor(broker_url: str, interval: float = 5.0):
    """Мониторинг очереди Celery в реальном времени."""
    client = await aioredis.from_url(broker_url)

    print(f"{'Time':>10} | {'Normal':>8} | {'Heavy':>8} | {'Light':>8} | {'Total':>8}")
    print("-" * 60)

    while True:
        try:
            # Celery хранит задачи в Redis lists
            normal_len = await client.llen("normal")
            heavy_len = await client.llen("heavy")
            light_len = await client.llen("light")
            total = normal_len + heavy_len + light_len

            timestamp = datetime.now().strftime("%H:%M:%S")
            print(
                f"{timestamp:>10} | {normal_len:>8} | {heavy_len:>8} | "
                f"{light_len:>8} | {total:>8}"
            )

            if total > 50:
                print(f"  WARNING: Queue depth {total} > 50!")

        except Exception as e:
            print(f"  Error: {e}")

        await asyncio.sleep(interval)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--broker", default="redis://:redis123@localhost:6379/1")
    parser.add_argument("--interval", type=float, default=5.0)
    args = parser.parse_args()

    asyncio.run(monitor(args.broker, args.interval))
```

---

## Приложение A: Чек-лист перед запуском нагрузочного теста

- [ ] Тестовая БД создана и заполнена seed данными
- [ ] Тестовые пользователи созданы (100 шт)
- [ ] Тестовые книги загружены (минимум 5, обработаны)
- [ ] Mock OpenRouter запущен и доступен (если не тестируем реальный API)
- [ ] `OPENROUTER_BASE_URL` переключён на мок (или реальный — для cost test)
- [ ] Мониторинг запущен (Netdata, Flower, Dozzle)
- [ ] Prometheus метрики доступны на `/health/metrics`
- [ ] VictoriaMetrics scraping настроен
- [ ] Disk space проверен (минимум 10GB свободно)
- [ ] Redis memory usage проверен (< 50% maxmemory перед стартом)
- [ ] PostgreSQL connections проверены (< 50 перед стартом)
- [ ] Celery workers healthy (`celery inspect ping`)
- [ ] Locust master/workers запущены и доступны
- [ ] CSV output directory создан
- [ ] Backup базы данных перед тестом

## Приложение B: Формат отчёта о результатах

```markdown
# Отчёт нагрузочного тестирования fancai

## Дата: YYYY-MM-DD

## Сценарий: [название]

## Длительность: [X минут]

## Пользователи: [N параллельных]

### Результаты API

| Endpoint | RPS | P50 | P95 | P99 | Error % |
| -------- | --- | --- | --- | --- | ------- |

### Celery

| Метрика         | Значение |
| --------------- | -------- |
| Max queue depth |          |
| Avg task time   |          |
| Task failure %  |          |

### Infrastructure

| Метрика         | Peak | Average |
| --------------- | ---- | ------- |
| CPU %           |      |         |
| Memory GB       |      |         |
| PG connections  |      |         |
| Redis memory MB |      |         |

### AI Pipeline

| Метрика         | Значение |
| --------------- | -------- |
| LLM requests    |          |
| LLM avg latency |          |
| Fallback count  |          |
| CB transitions  |          |
| Total cost $    |          |

### Выявленные проблемы

1. ...
2. ...

### Рекомендации

1. ...
2. ...
```

---

## Приложение C: Порядок выполнения тестов

Рекомендуемая последовательность:

1. **Smoke test** (5 мин, 5 users) — проверка работоспособности скриптов
2. **Сценарий 6: Cache test** (10 мин, 50 users) — baseline cache performance
3. **Сценарий 1: Readers** (20 мин, 100 users) — основная нагрузка
4. **Сценарий 4: Mixed** (15 мин, 50 users) — реалистичный микс
5. **Сценарий 8: Rate limit** (10 мин, 20 users) — валидация защиты
6. **Сценарий 2: Entity extraction** (15 мин, 50 users) — AI нагрузка
7. **Сценарий 3: Image generation** (15 мин, 30 users) — Celery нагрузка
8. **Сценарий 7: Circuit breaker** (10 мин, 10 users) — failure injection
9. **Сценарий 5: Burst** (10 мин, 20 users) — самый тяжёлый
10. **Spike test** (k6, 5 мин, 200 VU) — максимальная нагрузка

Между тестами: 5 минут cooldown для стабилизации метрик.
