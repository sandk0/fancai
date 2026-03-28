# GPU Serverless: Pricing, Platforms, Инфраструктура (Март 2026)

Исследование для fancai v1.4 — миграция NLP/image pipeline на serverless GPU.

---

## 1. Modal: Pricing по регионам

### GPU Pricing (per-second, базовые ставки)

| GPU          | $/sec     | $/hour | VRAM  |
| ------------ | --------- | ------ | ----- |
| T4           | $0.000164 | $0.59  | 16 GB |
| L4           | $0.000222 | $0.80  | 24 GB |
| A10G         | $0.000306 | $1.10  | 24 GB |
| L40S         | $0.000542 | $1.95  | 48 GB |
| RTX PRO 6000 | $0.000842 | $3.03  | 48 GB |
| A100 40GB    | $0.000583 | $2.10  | 40 GB |
| A100 80GB    | $0.000694 | $2.50  | 80 GB |
| H100         | $0.001097 | $3.95  | 80 GB |

**Источники:** [Modal Pricing](https://modal.com/pricing), [cloudgpuprices.com](https://cloudgpuprices.com/vendors/modal)

### Региональные мультипликаторы

| Регион                  | Мультипликатор |
| ----------------------- | -------------- |
| US                      | 1.25x          |
| EU                      | 1.25x          |
| UK                      | 1.25x          |
| Asia-Pacific            | 1.25x          |
| Другие (SA, ME, AF, MX) | 2.5x           |

**Ключевой факт: US и EU имеют ОДИНАКОВЫЙ мультипликатор 1.25x.** Нет ценовой разницы между US и EU регионами.

**Preemption мультипликатор:** Non-preemptible = 3x base rate. Но **non-preemptible НЕ поддерживается для GPU Functions** — это только для CPU/Memory. GPU всегда preemptible.

**Итоговая формула для GPU:** `base_rate * 1.25 (region)` = финальная цена. Указанные выше ставки уже включают 1.25x мультипликатор.

**Источники:** [Blaxel Blog](https://blaxel.ai/blog/modal-pricing-alternatives-guide), [eesel.ai](https://www.eesel.ai/blog/modal-ai-pricing), [Modal Preemption Docs](https://modal.com/docs/guide/preemption)

### Доступные регионы

Modal предлагает: `us`, `eu`, `ap`, `uk`, `ca`, `me`, `sa`, `af`, `mx`.

**Control plane всегда в us-east-1 (Virginia).** Все inputs/outputs проходят через Virginia независимо от региона worker'а.

**Источники:** [Modal Region Selection](https://modal.com/docs/guide/region-selection), [Modal Geographic Latency](https://modal.com/docs/guide/geographic-latency)

### Анализ: EU vs US для fancai.ru

**GDPR и юридический анализ:**

- GDPR НЕ применяется к fancai.ru: сервис на русских серверах, для русских пользователей, данные = текст книг
- GDPR применяется только при: (a) обработке данных резидентов EU, (b) предложении товаров/услуг в EU, (c) мониторинге поведения в EU
- Россия регулируется ФЗ-152, который требует **хранение персданных на серверах в РФ** — но это про основной бэкенд, не про serverless inference
- **Вывод: EU регион НЕ обязателен юридически**

**Источники:** [CMS Expert Guide - GDPR Impact in Russia](https://cms.law/en/int/expert-guides/the-impact-of-gdpr-in-non-eu-countries/russia), [Cloud4Y - GDPR vs 152-FZ](https://www.cloud4y.ru/en/blog/gdpr-vs-152-fz/)

**Latency анализ (оценки на основе типичных значений):**

- Moscow -> Frankfurt: ~40-50ms RTT
- Moscow -> Amsterdam: ~45-55ms RTT
- Moscow -> Virginia (us-east-1): ~120-150ms RTT
- us-east-1 -> us-west-1: ~60ms RTT

**Источники:** [WonderNetwork Moscow-Frankfurt](https://wondernetwork.com/pings/Moscow/Frankfurt), [WonderNetwork Moscow-Amsterdam](https://wondernetwork.com/pings/Moscow/Amsterdam)

**Рекомендация для fancai:**

| Фактор                | US Region             | EU Region             |
| --------------------- | --------------------- | --------------------- |
| Цена GPU              | Одинаковая (1.25x)    | Одинаковая (1.25x)    |
| Latency от Moscow     | ~120-150ms            | ~40-50ms              |
| Control plane latency | 0ms (уже в us-east-1) | +60ms (EU->us-east-1) |
| GPU availability      | Максимальная          | Ограниченная          |

**Вывод: Для inference задач (не real-time chat) разница в 80-100ms latency незначительна.** Запрос на NER/image generation занимает секунды. US регион дает лучшую GPU availability при одинаковой цене. Control plane в Virginia дает US region'у преимущество по latency для управляющих запросов.

**Рекомендация: US region (default).** Переключиться на EU можно одной строкой если потребуется.

---

## 2. Сравнение конкурентных платформ (Март 2026)

### Сводная таблица

| Платформа                  | Scale-to-Zero   | Cold Start                        | GPU Types                                 | Free Tier         | EU Region      | DX       |
| -------------------------- | --------------- | --------------------------------- | ----------------------------------------- | ----------------- | -------------- | -------- |
| **Modal**                  | Да              | 2-4s                              | T4, L4, A10, L40S, A100, H100, H200, B200 | $30/мес           | Да             | Отличный |
| **RunPod Serverless**      | Да (Flex)       | 200ms-2s (FlashBoot)              | L4, A100, H100                            | ~бесплатных часов | Да (31 регион) | Хороший  |
| **Cloud Run GPU**          | Да              | ~5s                               | L4 только                                 | Нет (GPU)         | Да (Tier 1)    | Средний  |
| **Baseten**                | Да              | 16-60s                            | T4, A10G, A100, H100                      | Есть credits      | Неизвестно     | Средний  |
| **Replicate** (Cloudflare) | Да              | <1s (fine-tunes), минуты (custom) | T4, A40, A100, L40S, H100                 | Нет               | Неизвестно     | Отличный |
| **BentoCloud**             | Да              | Неизвестно                        | T4, L4, A100+                             | Credits           | Неизвестно     | Хороший  |
| **Fireworks AI**           | Нет (dedicated) | Мгновенный (warm)                 | A100, H100, H200, MI300X                  | Нет               | Неизвестно     | Средний  |
| **Together AI**            | Нет (dedicated) | Мгновенный (warm)                 | H100, H200                                | Нет               | Неизвестно     | Средний  |

### Детальное сравнение по цене ($/hour за GPU)

| GPU       | Modal | RunPod (Flex) | Cloud Run | Baseten | Replicate    |
| --------- | ----- | ------------- | --------- | ------- | ------------ |
| T4        | $0.59 | ~$0.40        | N/A       | ~$0.63  | $0.36 (CPU)+ |
| L4        | $0.80 | ~$0.69        | $0.67     | N/A     | N/A          |
| A10G      | $1.10 | N/A           | N/A       | ~$1.21  | N/A          |
| A100 80GB | $2.50 | ~$1.90        | N/A       | ~$4.00  | ~$4.06       |
| H100      | $3.95 | ~$2.72        | N/A       | ~$6.50  | ~$5.49       |

**Источники:** [RunPod Pricing](https://www.runpod.io/pricing), [Cloud Run Pricing](https://cloud.google.com/run/pricing), [Baseten Pricing](https://www.baseten.co/pricing/), [Replicate Pricing](https://replicate.com/pricing)

### Платформа 1: RunPod Serverless

**Плюсы:**

- Самые низкие цены на H100/A100
- FlashBoot: cold start <200ms (48% запусков), <500ms (большинство)
- True scale-to-zero (Flex Workers)
- 31 глобальный регион включая EU
- Per-second billing

**Минусы:**

- Меньше GPU типов в serverless (нет T4, A10G)
- DX хуже чем Modal (Docker-based, нет Python-native SDK)
- Нет встроенных environments/staging

**Для fancai:** Хорош для чистого inference, но DX хуже Modal. Отличный fallback если Modal дорого.

**Источники:** [RunPod Serverless](https://www.runpod.io/product/serverless), [RunPod Pricing Docs](https://docs.runpod.io/serverless/pricing)

### Платформа 2: Google Cloud Run GPU

**Плюсы:**

- Scale-to-zero поддержан
- Интеграция с GCP экосистемой
- L4 доступен без квот (GA)
- Per-second billing
- EU регионы (Tier 1 pricing)

**Минусы:**

- Только L4 GPU (нет T4, A100, H100)
- Cold start ~5 секунд
- Нужен полный Docker image
- Сложнее для ML workloads чем Modal/RunPod

**Для fancai:** Подходит если уже на GCP. Ограничен одним GPU типом.

**Источники:** [Cloud Run GPU Docs](https://docs.google.com/run/docs/configuring/services/gpu), [Cloud Run GPU GA Blog](https://cloud.google.com/blog/products/serverless/cloud-run-gpus-are-now-generally-available)

### Платформа 3: Baseten

**Плюсы:**

- Production-grade inference ($150M Series D)
- Поддержка vLLM, TensorRT-LLM, SGLang
- 225% лучше cost-performance для throughput
- Truss framework (open-source)

**Минусы:**

- Cold start 16-60 секунд (самый медленный)
- Оптимизирован для throughput, не latency
- Ценообразование не самое прозрачное

**Для fancai:** Overkill. Предназначен для high-throughput LLM serving, не для спорадического NER/image inference.

**Источники:** [Baseten Pricing](https://www.baseten.co/pricing/), [Baseten Instance Reference](https://docs.baseten.co/performance/instances)

### Платформа 4: Replicate (теперь Cloudflare)

**Плюсы:**

- Куплен Cloudflare (ноябрь 2025), интеграция с Workers AI
- 50,000+ готовых моделей
- Fine-tuned модели boot <1 секунды
- Отличный DX, простейший API

**Минусы:**

- Custom модели: cold start МИНУТЫ (2-3 мин по reports)
- Custom модели на dedicated hardware = оплата idle time
- Неясна стратегия pricing после acquisition

**Для fancai:** Не подходит для custom GLiNER/NER models из-за огромных cold starts.

**Источники:** [Replicate Pricing](https://replicate.com/pricing), [Replicate-Cloudflare Blog](https://replicate.com/blog/replicate-cloudflare)

### Платформа 5: BentoCloud

**Плюсы:**

- Open-source BentoML framework
- Per-second billing, scale-to-zero
- Хороший DX для Python ML engineers

**Минусы:**

- Ограниченная документация по pricing
- Меньше community чем Modal/RunPod
- Enterprise pricing для большинства GPU

**Для fancai:** Рассмотреть если нужен open-source serving framework. Для serverless GPU Modal лучше.

**Источники:** [BentoML Pricing](https://www.bentoml.com/pricing)

### Платформа 6: Fireworks AI

**Плюсы:**

- Per-second billing для dedicated GPU
- 6x дешевле HuggingFace TGI, 2.5x быстрее
- H100 ($2.90/hr), H200, MI300X

**Минусы:**

- НЕТ scale-to-zero (dedicated = always-on)
- Ориентирован на LLM inference
- Минимальный контроль над infrastructure

**Для fancai:** Не подходит — нет scale-to-zero, спорадический workload = переплата за idle.

**Источники:** [Fireworks Pricing](https://fireworks.ai/pricing), [Fireworks Cost Structure](https://docs.fireworks.ai/faq/billing-pricing-usage/pricing/cost-structure)

### Платформа 7: Together AI

**Плюсы:**

- Dedicated endpoints H200 от $4.99/hr, H100 от $2.10/hr
- До 43% дешевле конкурентов по dedicated
- Single-tenancy, нет noisy neighbors

**Минусы:**

- НЕТ scale-to-zero
- Billing per-minute (не per-second)
- Ориентирован на LLM, не custom models

**Для fancai:** Не подходит — dedicated-only, нет scale-to-zero.

**Источники:** [Together AI Pricing](https://www.together.ai/pricing), [Together Dedicated Endpoints](https://www.together.ai/dedicated-endpoints)

### Итоговый рейтинг для fancai

| Позиция | Платформа         | Причина                                                                              |
| ------- | ----------------- | ------------------------------------------------------------------------------------ |
| 1       | **Modal**         | Лучший DX, Python-native, environments, $30 free, отличный cold start, все GPU types |
| 2       | **RunPod**        | Дешевле на H100/A100, быстрейший cold start, но DX хуже                              |
| 3       | **Cloud Run GPU** | Если уже на GCP, но только L4                                                        |
| 4       | **BentoCloud**    | Open-source fallback                                                                 |
| 5-7     | Остальные         | Не подходят (нет scale-to-zero или плохой cold start для custom models)              |

---

## 3. Modal Deployment Best Practices

### CI/CD с GitHub Actions

**Официальный подход Modal:**

1. Создать Modal token
2. Добавить как GitHub Actions secret
3. Workflow файл `.github/workflows/ci-cd.yml`
4. `modal deploy` на каждый push в main

**Рекомендации безопасности (2026):**

- Pin actions к full SHA (не branch/tag)
- OIDC вместо static credentials для cloud auth
- Least-privilege permissions на job level
- concurrency groups чтобы не тратить runner minutes на устаревшие коммиты

**Источники:** [Modal Continuous Deployment](https://modal.com/docs/guide/continuous-deployment)

### Staging / Production Environments

Modal имеет встроенную систему Environments:

- По умолчанию: один Environment `main`
- Создание: `modal environment create staging`
- До 1500 Environments на Workspace
- Каждый Environment имеет свои Secrets, Volumes, Dicts
- Dropdown в Dashboard для навигации

**Deployment в environment:**

```bash
modal deploy app.py --env staging   # staging
modal deploy app.py --env production  # production
```

**Через env variable:**

```bash
MODAL_ENVIRONMENT=staging modal deploy app.py
```

**Источники:** [Modal Environments](https://modal.com/docs/guide/environments), [Modal CLI Environment](https://modal.com/docs/reference/cli/environment), [Modal Deploy CLI](https://modal.com/docs/reference/cli/deploy)

### GPU Memory Snapshots

**Что это:** Snapshot GPU memory после загрузки модели, последующие cold starts восстанавливают из snapshot.

**Результаты:**

- Ministral 3B: cold start 118s -> 12s (10x reduction)
- Типичное ускорение: 2x-10x
- Экспериментальная фича

**Как включить:**

```python
@app.function(
    gpu="L4",
    experimental_options={"enable_gpu_snapshot": True}
)
```

**Два этапа `@modal.enter`:**

1. `snap=True` — загрузка весов в CPU memory (до snapshot)
2. `snap=False` — перенос на GPU (после восстановления из snapshot)

**Источники:** [Modal GPU Snapshot Example](https://modal.com/docs/examples/gpu_snapshot), [Modal GPU Snapshots Blog](https://modal.com/blog/gpu-mem-snapshots), [Modal Memory Snapshot Guide](https://modal.com/docs/guide/memory-snapshot)

### Volumes для Model Weights

**Рекомендация Modal:** Хранить веса в Modal Volume.

**Характеристики:**

- Read speed: 1-2 GB/s
- ~1 секунда cold start latency на GB весов
- 10x быстрее чем скачивание из интернета
- WORM pattern (Write Once, Read Many)
- Background commits каждые несколько секунд
- Auto-commit при shutdown контейнера

**Источники:** [Modal Volumes Guide](https://modal.com/docs/guide/volumes), [Modal Model Weights](https://modal.com/docs/guide/model-weights)

### Health Checks и Monitoring

Modal не имеет встроенного health check endpoint (в отличие от Kubernetes). Рекомендации:

- Использовать Modal Dashboard для мониторинга deployments
- `modal app list` для проверки статуса
- Custom logging через `print()` / Python logging
- Webhook integration для alerting
- Deployment rollbacks доступны на Team plan

**Источники:** [Modal Managing Deployments](https://modal.com/docs/guide/managing-deployments)

---

## 4. Capacity Planning: Modal Plans

### Starter Plan ($0/мес + compute)

| Параметр             | Лимит   |
| -------------------- | ------- |
| Бесплатные credits   | $30/мес |
| Workspace seats      | 3       |
| Containers           | 100     |
| GPU concurrency      | 10      |
| Region selection     | Да      |
| Environments         | Да      |
| Custom domains       | Нет     |
| Deployment rollbacks | Нет     |

### Team Plan ($250/мес + compute)

| Параметр             | Лимит     |
| -------------------- | --------- |
| Credits included     | $100/мес  |
| Workspace seats      | Unlimited |
| Containers           | 1,000     |
| GPU concurrency      | 50        |
| Region selection     | Да        |
| Custom domains       | Да        |
| Deployment rollbacks | Да        |
| WebSocket support    | Да        |
| Cloud bucket mounts  | Да        |

### Enterprise Plan (Custom pricing)

| Параметр          | Лимит  |
| ----------------- | ------ |
| GPU concurrency   | Custom |
| Containers        | Custom |
| Dedicated support | Да     |
| SLA               | Custom |

**Источники:** [Modal Pricing](https://modal.com/pricing), [Modal Billing](https://modal.com/docs/guide/billing)

### Расчет для fancai на Starter Plan ($30 free)

**Scenario: NER processing (GLiNER на T4)**

- T4 @ $0.59/hr
- $30 credits = ~50.8 часов GPU time
- Если inference = 5 sec/запрос: ~36,576 запросов/мес бесплатно
- Если batch = 30 sec/книга NER: ~6,096 книг/мес бесплатно

**Scenario: Image generation (FLUX на L4)**

- L4 @ $0.80/hr
- $30 credits = ~37.5 часов GPU time
- Если generation = 10 sec/image: ~13,500 images/мес бесплатно

**GPU Concurrency = 10:** Достаточно для раннего продакшена. При 10 concurrent T4 = 10 параллельных NER запросов.

**Container limit = 100:** Более чем достаточно. Один serverless app = 1-5 containers при типичном scaling.

**Вывод: Starter plan покрывает fancai на первые месяцы. Team plan нужен при >$130/мес compute или потребности в rollbacks/custom domains.**

### Startup Credits

Modal предлагает до $50K credits для стартапов и исследователей через [Modal Startups Program](https://modal.com/startups).

---

## Общие выводы

1. **Modal — лучший выбор для fancai.** Python-native DX, environments, $30 free tier, 2-4s cold starts, все нужные GPU.
2. **US region оптимален.** Цена = EU, лучше GPU availability, latency разница несущественна для batch inference.
3. **EU регион НЕ обязателен юридически.** GDPR не применим, ФЗ-152 касается основного бэкенда (уже в РФ).
4. **Starter plan достаточен** для запуска: 50+ GPU-часов/мес бесплатно, 10 GPU concurrency.
5. **RunPod — лучший fallback** если нужна экономия на объемных A100/H100 workloads.
6. **GPU Memory Snapshots** — ключевая оптимизация для cold starts при загрузке GLiNER/FLUX моделей.
