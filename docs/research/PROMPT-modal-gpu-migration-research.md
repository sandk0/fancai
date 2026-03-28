# Промпт: Исследование миграции fancai AI Pipeline на Modal GPU

> Скопируй содержимое этого файла в новую сессию Claude Opus 4.6.
> Перед запуском убедись, что Claude имеет доступ к кодовой базе fancai.

---

## Роль

Ты — cloud architect и ML infrastructure engineer с экспертизой в serverless GPU, cost optimization и production ML pipelines. Твоя задача — провести глубокое веб-исследование Modal GPU и разработать детальный план миграции AI pipeline проекта fancai.

## Контекст проекта

**fancai** — fiction reader с AI-иллюстрациями и интерактивным entity glossary/wiki.

**Стек:** FastAPI + Celery + PostgreSQL 17 + Redis 7.4 | React 19 + TypeScript
**Production:** VPS 32GB RAM, 12 vCPU AMD EPYC 9645 (Zen 5c, AVX-512 VNNI), без GPU
**Домен:** https://fancai.ru

### Текущий AI Pipeline (end-to-end обработка книги)

**1. Извлечение описаний и сущностей из глав (главный bottleneck)**

- **LLM путь (текущий, по умолчанию):** Gemini 3.0 Flash через OpenRouter → TSA-extraction (XML теги для позиций описаний) + entities + relationships
- **NER путь (Phase 30, feature flag USE_GLINER_NER=false):** GLiNER2 (fastino/gliner2-base-v1, 205M params, DeBERTa) на CPU → только entities (без описаний и отношений)
- Формат: 100K chars чанки с 15% overlap, semaphore 10 параллельных глав
- Стоимость LLM: ~$0.50-1.50/книга (100 глав)

**2. Генерация изображений по описаниям**

- FLUX.2 Klein 4B через OpenRouter (`modalities=["image"]`)
- Промпт: RU→EN перевод (Gemini) → стилизация по типу+жанру → FLUX.2
- Aspect ratio 4:3 (landscape), 1024×768
- Стоимость: ~$0.03/изображение = ~$3/книга (100 описаний)
- Celery task с soft limit 300s, batch по 5 с задержкой 2s

**3. Entity Synthesis (биографии, роли, milestones)**

- Gemini 3.0 Flash через OpenRouter
- Батчи по 50 сущностей → JSON с milestones
- Стоимость: ~$0.05/книга

**4. Entity Deduplication (LLM-based)**

- Gemini 3.0 Flash через OpenRouter
- Идентификация семантических дубликатов ("Гарри Поттер" = "Гарри")
- Стоимость: ~$0.01/книга

**5. Graph Analysis (PageRank, importance)**

- Локальный Python, без AI — не релевантно для миграции

**6. Entity Image Generation (по запросу)**

- Тот же FLUX.2 Klein через OpenRouter
- Генерация портретов персонажей по visual_summary

### Текущая инфраструктура AI

| Компонент              | Где работает           | Модель           | API                   | Стоимость         |
| ---------------------- | ---------------------- | ---------------- | --------------------- | ----------------- |
| Извлечение описаний    | OpenRouter API         | Gemini 3.0 Flash | generate_structured() | ~$0.50-1.50/книга |
| NER (entities only)    | Локальный CPU (Celery) | GLiNER2 205M     | PyTorch inference     | $0 (CPU)          |
| Изображения (описания) | OpenRouter API         | FLUX.2 Klein 4B  | generate_image()      | ~$0.03/шт         |
| Изображения (entities) | OpenRouter API         | FLUX.2 Klein 4B  | generate_image()      | ~$0.03/шт         |
| Синтез сущностей       | OpenRouter API         | Gemini 3.0 Flash | generate_text()       | ~$0.05/книга      |
| Дедупликация           | OpenRouter API         | Gemini 3.0 Flash | generate_structured() | ~$0.01/книга      |
| Перевод промптов       | OpenRouter API         | Gemini 3.0 Flash | generate_text()       | ~$0.001/запрос    |

**Суммарная стоимость на книгу (100 глав, 100 описаний):** ~$3.50-4.60

- LLM extraction: $0.50-1.50
- Images: $3.00
- Synthesis + dedup: $0.06
- Translation: $0.10

**OpenRouter — единая точка входа для всех AI:** `backend/app/core/openrouter_client.py` (537 строк). Fallback chain: Gemini 3.0 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite. Circuit breaker, cost tracking через Prometheus + LlmUsageLog таблица.

### Ключевые файлы

```
backend/app/core/openrouter_client.py     — Unified AI client (537 строк)
backend/app/services/gemini_extractor.py  — Description extraction (1221 строк)
backend/app/services/imagen_generator.py  — Image generation + prompt engineering
backend/app/services/ner_service.py       — GLiNER2 NER pipeline (497 строк)
backend/app/services/entity_synthesis_service.py — Biography milestones
backend/app/services/entity_deduplication_service.py — LLM dedup
backend/app/services/consistency_manager.py — Entity resolution
backend/app/tasks/book_tasks.py           — Book processing Celery task (956 строк)
backend/app/tasks/image_tasks.py          — Image generation Celery tasks
backend/app/monitoring/metrics.py         — Prometheus + cost tracking
docker-compose.prod.yml                   — Production infrastructure
```

### Результаты предварительного аудита (docs/research/gliner2-inference-AUDIT.md)

**Критические находки:**

1. **Modern-GLiNER-bi НЕПРИГОДЕН для русского** — ModernBERT English-only, FlashAttention GPU-only
2. **Modal free tier $30/мес** покрывает текущую GPU-нагрузку (~$12/мес за NER inference)
3. **GLiNER2 на GPU:** ~0.05-0.1s/chunk (vs 0.66s CPU) = **10-13x ускорение**
4. **worker_max_memory_per_child=512MB** в celery_app.py — баг, убьёт NER worker
5. **CPU бюджет исчерпан:** 11.3 из 12 vCPU выделено, нельзя масштабировать celery

### Бизнес-модель

- **Freemium:** бесплатные пользователи (фоновая обработка, 30+ мин ожидания) + premium (SLA <5 мин)
- **Текущая нагрузка:** ~50 книг/мес
- **Рост:** до 500-1000 книг/мес в ближайший год
- **Бюджет на inference infra:** до $50/мес сверх VPS ($30/мес)

---

## Задачи исследования

### 1. Глубокое веб-исследование Modal GPU

Для КАЖДОГО пункта — обязательный WebSearch с актуальными данными на март 2026.

**1a. Modal Platform Deep Dive:**

- Полный pricing: T4, L4, A10G, A100, H100 — цена/сек, цена/час, минимум биллинга
- Free tier: $30/мес — что входит? CPU+GPU или только GPU? Ограничения?
- Cold start: реальные замеры для разных GPU типов. GPU memory snapshots — как работают?
- Persistent volumes: цена, latency, как кэшировать модели между вызовами
- Secrets management: как передавать API keys (OpenRouter, DB credentials)
- Networking: можно ли Modal вызывать наш VPS PostgreSQL? Latency?
- Concurrency: max concurrent containers, queuing, auto-scaling
- Regions: есть ли EU? Важно для GDPR (текст книг — не PII, но copyright)
- Python SDK: декораторы, классы, web endpoints, scheduled functions
- Modal + Celery: паттерны интеграции (вызов Modal из Celery task vs замена Celery)

**1b. Модели для inference на Modal GPU:**

- **Image generation:** FLUX.1 Schnell vs FLUX.2 Klein vs SDXL vs DALL-E 3 — что выгоднее self-hosted на Modal vs OpenRouter?
- **LLM для extraction:** Gemini 3.0 Flash (через API) vs self-hosted Qwen 2.5 72B / Llama 3.3 70B / Mistral Large на Modal GPU — cost per book
- **NER:** GLiNER2 на T4 vs CPU — benchmark, есть ли готовые Modal deployments?
- **Image generation моделей:** какие модели генерации изображений лучше запускать на Modal? FLUX.1 Schnell (12B) на A10G — время генерации, качество vs FLUX.2 Klein
- **Embedding models:** нужны ли для entity dedup? sentence-transformers на GPU?
- **Vision models:** можно ли использовать для анализа сгенерированных изображений (quality check)?

### 2. Что делегировать Modal? Архитектурный анализ

Для КАЖДОГО компонента AI pipeline проведи cost-benefit analysis:

**2a. Кандидаты на миграцию:**

| Компонент              | Текущий подход              | Modal вариант                | Выгода?                 |
| ---------------------- | --------------------------- | ---------------------------- | ----------------------- |
| NER extraction         | GLiNER2 CPU (38s/глава)     | GLiNER2 GPU T4 (~2-4s/глава) | Скорость, разгрузка VPS |
| Description extraction | Gemini Flash via OpenRouter | Self-hosted LLM на Modal     | Потенциально дешевле    |
| Image generation       | FLUX.2 Klein via OpenRouter | FLUX.1 Schnell self-hosted   | Потенциально дешевле    |
| Entity synthesis       | Gemini Flash via OpenRouter | Self-hosted LLM              | Малый объём — не стоит  |
| Entity dedup           | Gemini Flash via OpenRouter | Self-hosted LLM              | Малый объём — не стоит  |
| Prompt translation     | Gemini Flash via OpenRouter | Self-hosted LLM              | Малый объём — не стоит  |

**2b. Ключевые вопросы для каждого компонента:**

- Стоимость на Modal (GPU-часы × цена) vs текущая стоимость через OpenRouter
- Cold start overhead — критичен для UX или нет?
- Качество: self-hosted модели vs managed API — разница?
- Сложность интеграции: сколько кода менять?
- Fallback: что если Modal недоступен? Сохранить OpenRouter как fallback?

### 3. Нужен ли OpenRouter при переходе на Modal?

**Исследуй сценарии:**

- **Полный отказ от OpenRouter:** всё на Modal (LLM + images + NER)
- **Гибрид:** Modal для тяжёлых задач (images, NER), OpenRouter для LLM
- **OpenRouter как fallback:** Modal primary, OpenRouter secondary
- Какие модели доступны ТОЛЬКО через OpenRouter и не self-hostable?
- Gemini 3.0 Flash — можно ли self-hosted? (Google API vs OpenRouter vs Modal)
- Если отказаться от OpenRouter — какой LLM заменит Gemini для extraction?

### 4. Image Generation на Modal: полный анализ

**4a. Генерация иллюстраций по описаниям (основной объём):**

- FLUX.1 Schnell (12B) на A10G/A100: время генерации 1 image, стоимость
- FLUX.2 Klein (4B) на T4: время генерации, качество vs Schnell
- SDXL Turbo на T4: минимальная стоимость, качество приемлемо?
- Сравнение: Modal self-hosted vs OpenRouter FLUX.2 Klein ($0.03/image)
- Batching: можно ли генерировать 10-20 images за один warm container call?
- Persistent model: кэширование модели в Modal volume vs download каждый раз

**4b. Entity portrait generation (Wiki images):**

- Те же модели, но portrait-ориентация (3:4 вместо 4:3)
- Character consistency: можно ли использовать IP-Adapter / LoRA для единообразия персонажа?
- Стоимость портрета vs illustration

**4c. Cost comparison для 100 images:**

- OpenRouter FLUX.2 Klein: 100 × $0.03 = $3.00
- Modal FLUX.1 Schnell A10G: 100 × (Ts × $/s) = ?
- Modal FLUX.2 Klein T4: 100 × (Ts × $/s) = ?
- При каком объёме Modal дешевле OpenRouter?

### 5. NER и Book Processing на Modal GPU

**5a. Вместо GLiNER2 — что лучше на GPU?**

- GLiNER2 на T4: benchmark (tokens/sec, sec/chapter)
- GLiNER bi-encoder v2.0 на T4: label pre-embedding + GPU = какой speedup?
- Полный LLM extraction (Qwen 2.5 7B / Gemma 2B) на Modal вместо NER — quality vs GLiNER?
- Gemini 3.0 Flash API из Modal container (best of both worlds?)
- **Ключевой вопрос:** Если у нас есть GPU на Modal, имеет ли смысл NER вообще? Может быть LLM extraction всё ещё лучше?

**5b. Архитектура вызова:**

- Celery task → вызов Modal function → результат обратно в PostgreSQL
- Modal web endpoint (webhook) vs Modal function call (sync/async)
- Как обрабатывать ошибки и retries? Modal timeout vs Celery timeout
- Можно ли pipeline целиком вынести в Modal (extraction + dedup + synthesis)?

**5c. Latency budget:**

- VPS → Modal: network roundtrip (~50-100ms для EU)
- Modal cold start: T4 ~2-4s, A10G ~3-5s, A100 ~5-10s
- Model loading (если не warm): GLiNER2 ~3s, FLUX.1 ~10-15s, LLM 7B ~20-30s
- Warm container: instant (если keep_warm настроен)
- **Вопрос:** сколько стоит keep_warm для T4 vs cold start overhead?

### 6. Полная стоимость книги после миграции

**Рассчитай для средней книги (35 глав, 50 описаний, 200 сущностей):**

**Сценарий A: Минимальная миграция (только NER на Modal)**

- NER: Modal T4 GLiNER2 GPU
- Всё остальное: OpenRouter (как сейчас)
- Стоимость/книга = ?

**Сценарий B: Images + NER на Modal**

- NER: Modal T4 GLiNER2 GPU
- Images: Modal A10G FLUX.1 Schnell
- LLM: OpenRouter Gemini (extraction, synthesis, dedup)
- Стоимость/книга = ?

**Сценарий C: Полная миграция (всё на Modal)**

- NER: Modal T4 GLiNER2 GPU
- Images: Modal A10G FLUX.1 Schnell
- LLM: Modal A10G self-hosted (Qwen 2.5 7B / Gemma)
- Без OpenRouter вообще
- Стоимость/книга = ?

**Сценарий D: Гибрид оптимальный**

- Что на Modal, что на OpenRouter — оптимальное разделение
- Стоимость/книга = ?

**Для каждого сценария рассчитай:**

- Стоимость за 1 книгу (подробно по компонентам)
- Стоимость за 50 книг/мес
- Стоимость за 500 книг/мес
- Стоимость за 1000 книг/мес
- Время обработки книги (wall clock)
- Сложность миграции (человеко-дни)

### 7. Дополнительные вопросы для исследования

**7a. Observability:**

- Как мониторить Modal functions? Prometheus интеграция?
- Логирование: куда уходят логи? Можно ли стримить в наш Grafana?
- Cost alerting: как не превысить бюджет?

**7b. Developer Experience:**

- Modal CLI: как деплоить? CI/CD integration?
- Local development: можно ли тестировать Modal functions локально?
- Debugging: как дебажить inference ошибки на удалённом GPU?

**7c. Security и Privacy:**

- Текст книг (copyrighted content) проходит через Modal — legal implications?
- API keys в Modal secrets — насколько безопасно?
- Network security: VPS ↔ Modal — как защитить канал?

**7d. Migration Strategy:**

- Phased migration: какой компонент мигрировать первым?
- A/B testing: как сравнить Modal vs OpenRouter quality?
- Rollback plan: если Modal хуже — как откатиться?
- Dual-write: период параллельной работы старого и нового pipeline

**7e. Конкурентные преимущества Modal vs альтернатив:**

- Modal vs RunPod Serverless vs Beam vs Replicate
- Для нашего use case — почему Modal лучше/хуже?
- Lock-in risk: насколько мы привязываемся к Modal?

**7f. Оптимизация стоимости на Modal:**

- GPU memory snapshots — что это и как экономит?
- Container lifecycle: idle timeout, min_containers, scale_down_window
- Batch processing: группировка запросов для максимальной утилизации GPU
- Spot/preemptible instances — есть ли на Modal?
- Volume pricing: кэшировать модели vs скачивать каждый раз

## Формат результата

### A. Executive Summary (2-3 абзаца)

Главный вывод: стоит ли мигрировать? Что мигрировать? Сколько это стоит?

### B. Modal Platform Analysis

Детальный анализ платформы с актуальными данными (pricing, features, limitations).

### C. Migration Architecture

Диаграмма: что где работает после миграции. Какие сервисы на VPS, какие на Modal.

### D. Component-by-Component Analysis

Для каждого AI компонента: текущее vs Modal — cost, speed, quality, complexity.

### E. Cost Comparison Table

Все 4 сценария × 4 масштаба (50/200/500/1000 книг/мес).

### F. Recommended Migration Plan

Фазированный план: что мигрировать первым, timeline, risks.

### G. Implementation Checklist

Конкретные шаги для начала миграции (у пользователя уже есть аккаунт Modal).

### H. Risks and Mitigations

Что может пойти не так и как подготовиться.

### I. Источники

Все URL из веб-исследования.

## Методология

1. **Прочитай код** AI pipeline (файлы выше) — пойми текущую архитектуру
2. **WebSearch** для КАЖДОГО пункта — актуальные данные март 2026
3. **Проверь Modal docs** (modal.com/docs) — features, pricing, examples
4. **Рассчитай стоимость** для каждого сценария с реальными числами
5. **Сравни** с текущими затратами через OpenRouter
6. **Сохрани результат** в `docs/research/modal-gpu-migration-plan.md`

## Ограничения

- Бюджет: до $50/мес на inference infra сверх VPS
- VPS НЕ МЕНЯЕТСЯ (32GB RAM, 12 vCPU, без GPU)
- Совместимость: Python 3.12, Celery, Docker, PostgreSQL
- Текущий OpenRouter API key сохраняется (fallback)
- У пользователя уже есть аккаунт Modal — можно тестировать
- Язык отчёта: русский (технические термины на английском)

## ВАЖНО

Это ИССЛЕДОВАНИЕ, а не пересказ документации. Для каждого утверждения — WebSearch с источником. Для каждого числа — расчёт или ссылка. Будь скептичен к маркетинговым заявлениям Modal — проверяй реальные отзывы и бенчмарки пользователей.
