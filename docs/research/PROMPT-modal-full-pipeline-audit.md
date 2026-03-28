# Промпт: Глубокий аудит отчёта Modal Full AI Pipeline Research

## Роль

Ты — Senior ML Infrastructure Architect и AI Systems Auditor с 10+ лет опыта в production ML системах, serverless GPU, model selection и cost optimization. Твоя задача — провести **независимый глубокий аудит** исследовательского отчёта `docs/research/modal-full-pipeline-research.md`, валидируя каждое утверждение повторным веб-исследованием и дополняя пропущенные аспекты.

## Контекст проекта

**fancai** — fiction reader с AI-иллюстрациями и интерактивным entity glossary/wiki.

**Стек:** FastAPI + Celery + PostgreSQL 17 + Redis 7.4 | React 19 + TypeScript
**Production:** VPS 32GB RAM, 12 vCPU AMD EPYC 9645, без GPU
**Домен:** https://fancai.ru

### Бизнес-модель (КРИТИЧНО для аудита)

**Гибридная подписочная модель:**

- **Free tier:** ограниченное количество книг/мес, background processing (низкий приоритет)
- **Premium tier ($X/мес):** неограниченные книги, **приоритетная очередь**, быстрее обработка, character consistency, HD иллюстрации
- **Это означает:** нужны **приоритетные очереди** в Celery + Modal, разная SLA для free/premium, возможно разные модели/GPU для разных тарифов

### Текущий AI Pipeline

Весь AI работает через OpenRouter API:

- **LLM** (83% стоимости): Gemini 3.0 Flash, extraction + synthesis + dedup + translation
- **Images** (17%): FLUX.2 Klein 4B через OpenRouter
- **NER**: GLiNER2 на CPU (feature flag, выключен)
- **Реальная стоимость:** $6.13/книга (50 глав), 59 минут обработки
- **Источник данных:** OpenRouter Management API (DB `llm_usage_log` теряет 52-66% данных)

### Ключевые файлы кода

```
backend/app/core/openrouter_client.py     — Unified AI client (738 строк)
backend/app/services/gemini_extractor.py  — Description extraction (1221 строк)
backend/app/services/imagen_generator.py  — Image generation + prompt engineering (679 строк)
backend/app/services/ner_service.py       — GLiNER2 NER pipeline (498 строк)
backend/app/services/entity_synthesis_service.py — Biography milestones
backend/app/services/entity_deduplication_service.py — LLM dedup
backend/app/tasks/book_tasks.py           — Book processing Celery task (956 строк)
backend/app/tasks/image_tasks.py          — Image generation Celery tasks
```

---

## Задачи аудита

### 1. ВАЛИДАЦИЯ ДАННЫХ И РАСЧЁТОВ

**Для КАЖДОГО числа в отчёте:**

**1a. Стоимость моделей — WebSearch верификация:**

- Gemini 3.0 Flash: $0.50/$3.00 M tokens — актуально на 25 марта 2026?
- Gemini 3.1 Flash-Lite: $0.25/$1.50 M tokens — подтвердить
- Gemini Batch API: 50% скидка — подтвердить, есть ли изменения?
- OpenRouter markup 5.5% — подтвердить текущую ставку
- Modal GPU pricing: T4 $0.59/ч, L4 $0.80/ч, A10G $1.10/ч — подтвердить
- Modal free tier $30/мес — подтвердить, нет ли изменений?

**1b. Расчёт стоимости self-hosted LLM:**
Отчёт заявляет Qwen3.5-35B-A3B на L4 = ~$0.15/книга. Проверь:

- Действительно ли 35B MoE с 3B active помещается на L4 (24GB VRAM)?
- Реальный throughput: 150-200 tok/sec output — есть ли бенчмарки?
- Continuous batching 10 concurrent → 500-800 tok/sec aggregate — реалистично?
- Формула: 700 sec × $0.000222 = $0.155 — арифметика верна?
- Учтена ли overhead от structured output (guided decoding)?
- Учтён ли cold start при scale-to-zero?

**1c. Расчёт стоимости image gen:**

- FLUX.2 Klein на L4: $0.0006-0.0007/image — верно?
- Z-Image-Turbo на A10G: $0.0012/image — верно?
- Cold start overhead: корректно ли посчитан?
- Batch amortization: реалистичны ли допущения?

**1d. Обратная калибровка token volumes:**
Отчёт делает обратный расчёт от $5.12 → ~4.71M input + 0.84M output. Проверь:

- Корректна ли формула с учётом OpenRouter 5.5% fee?
- Разбивка по задачам (extraction 60%, translation 10%, etc.) — обоснована?
- Сходится ли с реальными данными из OpenRouter Management API?

### 2. ВАЛИДАЦИЯ РЕКОМЕНДАЦИЙ ПО МОДЕЛЯМ

**2a. Image Generation — кросс-проверка:**

Для каждой рекомендованной модели — WebSearch:

- **FLUX.2 Klein 4B multi-reference**: действительно ли поддерживает до 10 reference images? Как именно это работает через diffusers? Какой API? Есть ли реальные примеры character consistency?
- **Z-Image-Turbo 6B**: подтвердить качество "сопоставимое с FLUX.2 [dev]". Есть ли независимые сравнения?
- **OmniGen2**: стабильность, production-readiness. Есть ли баги?
- **ACE++**: 92.3% feature retention — из какого бенчмарка? Реалистично ли для книжных персонажей?
- **SANA 1.6B**: <1s на T4 — подтвердить бенчмарки
- Есть ли модели, которые отчёт **пропустил**? WebSearch "new image generation model 2026 february march"

**2b. LLM Models — кросс-проверка:**

- **Qwen3.5-35B-A3B**: подтвердить что 35B MoE с 3B active = качество 35B. Откуда это утверждение? Какие бенчмарки?
- **Qwen3.5-35B-A3B на L4**: влезает ли реально? VRAM breakdown? Нужна ли quantization?
- **Qwen3.5-9B**: "бьёт модели 30B предыдущего поколения" — какие именно? Бенчмарки?
- **enable_thinking + guided_json баг**: подробности. Решён ли? Workaround?
- Русский язык: есть ли МЕРА бенчмарк результаты для Qwen3.5?
- JSON Schema compliance: есть ли тесты structured output для Qwen3.5 через vLLM?
- Есть ли модели, которые отчёт пропустил? Например новые релизы марта 2026?

**2c. Gemini Batch API — кросс-проверка:**

- 50% скидка — подтвердить для всех моделей
- Latency "15 мин — 2 часа" — есть ли свежие данные?
- Structured output в batch mode — есть ли ограничения?
- Partial failures handling — документация?
- Лимиты: requests per batch, tokens per batch?

### 3. АРХИТЕКТУРНЫЙ АУДИТ

**3a. Приоритетные очереди для Premium (ОТСУТСТВУЕТ в отчёте):**

Отчёт **не учитывает** подписочную модель. Нужно добавить:

- Как реализовать приоритетные очереди в Celery + Modal?
- Premium пользователи: `min_containers=1` (warm GPU всегда)? Или priority queue?
- Free tier: scale-to-zero, batch processing, Gemini Batch API?
- Premium tier: instant processing, Modal warm containers, character consistency?
- Разные модели для разных тарифов? Premium = HiDream I1 Fast, Free = FLUX.2 Klein?
- Как Modal поддерживает priority/QoS?
- Celery priority queues: как настроить для Modal integration?

**3b. Масштабируемость:**

- Modal concurrent containers limit: 10 GPUs на free tier — что если 20 premium пользователей одновременно?
- Burst handling: 50 книг за 1 час?
- Queue depth: как мониторить и реагировать?
- Auto-scaling: min_containers для premium vs scale-to-zero для free?

**3c. Отказоустойчивость:**

- Modal outage: автоматический fallback на OpenRouter?
- Gemini Batch API timeout (>24ч): что делать?
- Partial failure handling: одна глава из 50 не обработалась?
- Data consistency: результаты частично записаны в PostgreSQL?

**3d. Cold Start Impact на Premium SLA:**

- Cold start 60-90 сек для LLM — допустимо ли для premium?
- GPU Memory Snapshot: реально ли до 10-15 сек?
- `min_containers=1` для premium: сколько стоит всегда-включённый L4?
- Warm pool для image gen: сколько стоит?

**3e. Безопасность:**

- Modal Secrets для API keys — достаточно?
- PostgreSQL доступ из Modal vs через Celery return — trade-offs
- GDPR: Modal EU region — подтвердить compliance
- Данные книг в Modal containers — retention policy?

### 4. ПРОПУЩЕННЫЕ АСПЕКТЫ

**4a. Что НЕ исследовано в отчёте:**

- **Приоритетные очереди** для premium/free (КРИТИЧНО)
- **A/B тестирование** — конкретный протокол, метрики, sample size
- **Monitoring в production** — Prometheus/Grafana для Modal
- **Cost tracking per user** — как отслеживать стоимость для каждого пользователя?
- **Billing integration** — связь Modal costs с подписочной моделью
- **Graceful degradation** — что если Modal/Gemini/OpenRouter все упали?
- **Data pipeline resilience** — idempotency, retry logic для Modal calls
- **Image storage** — где хранить generated images? Modal Volume? S3? VPS?
- **CDN для images** — latency для пользователей
- **Caching strategy** — Redis, modal.Dict, или что-то другое для cross-request caching?

**4b. Архитектурные альтернативы не рассмотренные:**

- **RunPod Serverless** как альтернатива Modal — сравнение pricing/features
- **Replicate** для image gen — API-based, без self-hosting
- **Google Cloud Run GPU** — serverless GPU от Google, pricing?
- **Banana/Baseten** — живы ли? Конкурентоспособны?
- **Lambda Labs** — GPU cloud, pricing?
- **Vast.ai / FluidStack** — spot GPU для batch processing

**4c. Оптимизации не рассмотренные:**

- **Context Caching** в Gemini API — для одинаковых system prompt по всем главам
- **Prompt compression** — уменьшить input tokens
- **Speculative decoding** в vLLM — ускорение inference
- **AWQ vs GPTQ vs GGUF** — какая quantization лучше для Qwen3.5 на Modal?
- **Prefix caching** в vLLM — для повторяющихся system prompts
- **Chunked prefill** — оптимизация для длинных контекстов

### 5. PRICING SENSITIVITY ANALYSIS

**5a. Что если цены изменятся:**

- Modal убирает free tier или повышает цены на 2x?
- Gemini повышает цены (уже было с PaLM → Gemini transition)?
- OpenRouter повышает markup с 5.5% до 10%?
- FLUX.2 Klein убирает Apache 2.0 лицензию?
- Qwen3.5 — что если Alibaba закроет weights?

**5b. Break-even анализ:**

- При какой нагрузке Full Modal (S5) дешевле Gemini Batch (S4)?
- При какой нагрузке нужно переходить с free tier на paid Modal?
- Сколько premium подписчиков нужно чтобы окупить `min_containers`?

### 6. ПРОВЕРКА КОДА

Прочитай ключевые файлы и проверь:

**6a. `openrouter_client.py`:**

- Баг с fire-and-forget logging (`asyncio.create_task`) — насколько критичен?
- Circuit breaker logic — адекватна ли для fallback на Modal?
- Как добавить Modal path не ломая существующий fallback?

**6b. `gemini_extractor.py`:**

- Chunk size 100K chars + 15% overlap — сколько это в токенах?
- Structured output через Pydantic schemas — совместимо ли с vLLM guided decoding?
- TSA parser — работает ли с output от Qwen3.5?

**6c. `imagen_generator.py`:**

- Translation pipeline (RU→EN) — нужен ли при self-hosted FLUX.2?
- Redis caching — как адаптировать для Modal?
- Prompt engineering (genre/type templates) — совместимо ли с Z-Image-Turbo?

**6d. `book_tasks.py`:**

- Semaphore 10 concurrent chapters — как это маппится на Modal?
- Redis distributed lock — нужен ли для Modal?
- Progress tracking (WebSocket) — как интегрировать с Modal async?

### 7. PREMIUM vs FREE — АРХИТЕКТУРА ПРИОРИТЕТОВ

**Это ГЛАВНЫЙ пропущенный аспект отчёта. Разработай:**

**7a. Queue Architecture:**

```
Free User  → Celery low-priority queue  → Gemini Batch API (cheap, slow)
                                        → Modal scale-to-zero (cold start OK)

Premium User → Celery high-priority queue → Modal warm containers (fast)
                                          → FLUX.2 Klein with character consistency
                                          → Higher quality models (HiDream?)
```

**7b. Для каждого тарифа определи:**

| Аспект                   | Free | Premium |
| ------------------------ | ---- | ------- |
| LLM Provider             | ?    | ?       |
| Image Model              | ?    | ?       |
| Character Consistency    | ?    | ?       |
| Processing Time SLA      | ?    | ?       |
| Queue Priority           | ?    | ?       |
| Modal Container Strategy | ?    | ?       |
| Cost per book            | ?    | ?       |
| Monthly Modal budget     | ?    | ?       |

**7c. Бизнес-метрики:**

- Стоимость обслуживания 1 free пользователя/мес (N книг)
- Стоимость обслуживания 1 premium пользователя/мес (N книг)
- Минимальная цена premium подписки для breakeven
- При каком соотношении free/premium проект прибыльный?

---

## Формат результата

### A. Верификационный отчёт

Для КАЖДОГО утверждения из `modal-full-pipeline-research.md`:

- ✅ Подтверждено (источник)
- ⚠️ Частично верно (уточнение)
- ❌ Неверно (правильные данные)
- ❓ Не удалось проверить (причина)

### B. Найденные ошибки и неточности

Таблица со всеми найденными проблемами, severity, и исправлениями.

### C. Пропущенные аспекты

Детальный анализ каждого пропущенного аспекта с рекомендациями.

### D. Premium/Free Architecture

Полная архитектура приоритетных очередей с расчётами стоимости.

### E. Обновлённая таблица сценариев

С учётом premium/free разделения и исправленных расчётов.

### F. Risk Matrix (обновлённая)

С учётом subscription model, scaling, и vendor dependency.

### G. Обновлённый Migration Plan

С учётом premium features и приоритетных очередей.

### H. Источники

Все URL из повторного веб-исследования.

---

## Методология аудита

1. **Прочитай отчёт** `docs/research/modal-full-pipeline-research.md` целиком — пойми структуру и утверждения
2. **Прочитай код** AI pipeline — пойми реальную архитектуру
3. **Прочитай предыдущие исследования:**
   - `docs/research/modal-gpu-migration-plan.md`
   - `docs/research/self-hosted-llm-structured-extraction-2026-03.md`
   - `docs/research/modal-full-pipeline-architecture.md`
4. **WebSearch** для КАЖДОГО утверждения — независимая верификация
5. **Рассчитай** стоимость заново — сверь с отчётом
6. **Проверь** пропущенные аспекты (приоритетные очереди, масштабируемость)
7. **Сохрани** результат в `docs/research/modal-full-pipeline-AUDIT.md`

## Ограничения

- Результат на русском языке (технические термины на английском)
- Бюджет: готовы платить сверх $30/мес Modal free tier если обосновано
- VPS не меняется (32GB RAM, 12 vCPU)
- Текущий OpenRouter API key сохраняется как fallback
- Подписочная модель — гибридная (free + premium)
- Premium пользователи ожидают обработку книги < 5 минут

## ВАЖНО

1. Это **АУДИТ**, а не копирование отчёта. Для каждого утверждения — независимая проверка через WebSearch.
2. **Скептицизм обязателен** — ищи ошибки в расчётах, устаревшие данные, нереалистичные допущения.
3. **Premium/Free разделение** — главный пропущенный аспект, требует глубокой проработки.
4. **Масштабируемость** — проверь что архитектура работает не только для 1 пользователя, но и для 100-1000 concurrent.
5. Будь конкретен — цифры, формулы, источники. Не "может быть дешевле", а "$X.XX vs $Y.YY (источник: URL)".
