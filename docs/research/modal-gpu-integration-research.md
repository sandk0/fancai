# Modal GPU Integration Research — март 2026

Контекст: fancai.ru (FastAPI + Celery + PostgreSQL), интеграция Modal для GPU inference.

---

## 1. Observability

### Dashboard

Modal предоставляет встроенный web dashboard с real-time логами, метриками и execution traces. Каждый запущенный App логирует ссылку на dashboard. Однако [встроенный мониторинг базовый](https://www.venkatsoftware.com/modal) — для production рекомендуется добавить свой observability layer.

### Datadog интеграция (основной путь)

[Официальная интеграция Modal + Datadog](https://modal.com/docs/guide/datadog-integration):

- **Метрики**: utilization metrics с тегами `container_id`, `environment_name`, `app_name`, `app_id`, `function_name`, `function_id`, `workspace_name`, `workspace_id`. Метрики Modal бесплатны в Datadog.
- **Логи**: stdout/stderr + audit logs пересылаются в plaintext. Логи тарифицируются Datadog. Если нужен structured logging — настроить log processing pipeline в Datadog.
- **Dashboard**: готовый Modal dashboard в Datadog показывает audit logs, function logs, utilization metrics.
- **Alerts**: можно настроить Datadog monitors для алертов.

### Prometheus / Grafana / Loki

Нативной Prometheus интеграции у Modal **нет**. Варианты:

1. Datadog → основной путь (см. выше)
2. Кастомный pushgateway: отправлять метрики из Modal functions в Prometheus Pushgateway через HTTP
3. OpenTelemetry: инструментировать код в Modal functions, экспортировать через OTLP

**Вывод для fancai**: Datadog — overkill для $50/мес бюджета. Реалистичнее: кастомные метрики через Prometheus pushgateway или просто логи в stdout + dashboard Modal.

### Cost Alerting

- [Workspace budget](https://modal.com/docs/guide/billing): в разделе "Workspace budget" настройках Usage & Billing можно установить лимит на месячные расходы. Максимум лимита зависит от истории успешных платежей.
- **Tagging system**: на Team/Enterprise планах можно категоризировать Apps и атрибутировать расходы по командам/проектам.
- **Programmatic billing API**: на Team/Enterprise планах доступен экспорт billing reports.

### Логирование

- stdout/stderr стримятся в dashboard в реальном времени
- CLI: `modal run`, `modal serve`, `modal deploy`, `modal container logs` — все поддерживают `--timestamps` флаг
- Async streaming: `modal.io_streams` для программного доступа к stdout/stderr

---

## 2. Developer Experience

### CLI и Deploy Flow

```bash
modal deploy app.py          # Deploy в production
modal serve app.py           # Dev mode с hot-reload (detects file changes)
modal run app.py             # Одноразовый запуск
modal run app.py::app.func   # Запуск конкретной функции
```

### CI/CD

[GitHub Actions интеграция](https://modal.com/docs/guide/continuous-deployment):

- Создать Modal token → добавить как GitHub secret
- Workflow: `modal deploy` на push в main
- [Пример CI на Modal](https://github.com/modal-labs/ci-on-modal) — тесты прямо на Modal GPU

### Local Development

- `func.local()` — запуск функции локально (не на Modal)
- `func.remote()` — запуск в облаке
- `func.map(inputs)` — параллельный map по входам
- `modal serve` — hot-reload при изменении файлов, логи стримятся локально

### Debugging

- `--interactive / -i` флаг: запускает IPython REPL или Python debugger прямо внутри Modal контейнера
- `interact()` вызов изнутри функции для breakpoint
- Dashboard: real-time логи + resource metrics для каждого запуска
- [GPU Health мониторинг](https://modal.com/docs/guide/gpu-health): Modal мониторит 20,000+ GPU, дренирует воркеры с проблемами, показывает warnings

### modal.Image

[Сборка образов](https://modal.com/docs/guide/images):

```python
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch", "transformers", "gliner")  # uv — быстрее pip
    .run_commands("apt-get install -y libgl1")
)
```

- `Image.from_dockerfile()` — из Dockerfile
- `Image.from_registry("nvcr.io/nvidia/...")` — из Docker Hub / NGC
- По умолчанию: Debian + Python той же minor version, что и локальный интерпретатор

### modal.Volume

[Persistent storage](https://modal.com/docs/guide/volumes) для ML моделей:

- Оптимизирован для write-once, read-many (идеально для model weights)
- [Руководство по хранению весов](https://modal.com/docs/guide/model-weights): загрузить один раз, читать из множества контейнеров
- Высокопроизводительная распределённая FS

---

## 3. Security

### modal.Secret

[Управление секретами](https://modal.com/docs/guide/secrets):

```python
@app.function(secrets=[modal.Secret.from_name("openrouter-key")])
def inference(prompt: str):
    api_key = os.environ["OPENROUTER_API_KEY"]
```

- Создание: dashboard, CLI (`modal secret`), Python SDK
- Инъекция через `secrets=[...]` в декораторе — попадают как env vars в контейнер

### Network Security

- **TLS 1.3** для всех публичных API
- **gVisor** sandboxing (тот же, что Google Cloud Run) — изоляция на уровне syscall
- **Egress control** (для Sandboxes): `block_network=True` или `cidr_allowlist` для fine-grained контроля
- Данные **зашифрованы in transit и at rest**
- Токены аутентификации хранятся безопасно и автоматически ротируются

### Web Endpoint Protection

[Proxy Auth Tokens](https://modal.com/docs/guide/webhook-proxy-auth):

- `Modal-Key` и `Modal-Secret` HTTP headers для защиты web endpoints
- Авторизация обрабатывается инфраструктурой Modal (proxy level)
- Альтернатива: SDK direct call (без web endpoint) — встроенная аутентификация клиентской библиотеки

### OIDC

[OIDC интеграция](https://modal.com/docs/guide/oidc-integration) для аутентификации с внешними сервисами.

### Compliance

- **SOC 2 Type II**: пройден ([январь 2025](https://modal.com/blog/soc2type2))
- **SOC 2 Type I**: пройден ранее
- **HIPAA**: поддержка compliant workloads [анонсирована](https://modal.com/blog/soc2)
- **GDPR**: не заявлен явно, но SOC 2 Type II покрывает значительную часть GDPR-контролей (access management, encryption, incident response)

### Copyrighted Content

Modal — инфраструктурный провайдер (IaaS/PaaS). Обработка текстов книг через Modal юридически аналогична обработке на любом облачном сервере. Ответственность за контент лежит на пользователе платформы (fancai). Ключевые моменты:

- Текст обрабатывается in-memory, не хранится на Modal volumes
- gVisor изоляция предотвращает доступ других тенантов
- Данные зашифрованы in transit (TLS 1.3)

---

## 4. Integration Patterns (Celery -> Modal)

### Варианты вызова

| Pattern               | Latency | Complexity | Когда использовать                                   |
| --------------------- | ------- | ---------- | ---------------------------------------------------- |
| **SDK Direct Call**   | Низкая  | Низкая     | Celery task вызывает `func.remote()` через Modal SDK |
| **Web Endpoint**      | Средняя | Средняя    | HTTP POST из Celery, 150s max timeout                |
| **Webhook + Polling** | Высокая | Высокая    | Для задач >150s: spawn + poll по `function_call_id`  |

### Рекомендация для fancai: SDK Direct Call

```python
# backend/app/tasks/inference.py
import modal

@celery_app.task(bind=True, max_retries=3)
def run_gpu_inference(self, book_id: int, chapter: int):
    try:
        # Direct SDK call — лучший вариант
        inference_fn = modal.Function.from_name("fancai-gpu", "extract_entities")
        result = inference_fn.remote(book_id=book_id, chapter=chapter)
        return result
    except modal.exception.FunctionTimeoutError:
        # Modal timeout — retry через Celery
        raise self.retry(countdown=60)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)
```

### Sync vs Async

- [Async поддержка](https://modal.com/docs/guide/async): Modal functions можно определять как `async def` или обычные `def` — оба работают для remote calls
- Из Celery task (sync контекст): использовать `func.remote()` (блокирующий вызов)
- Из FastAPI endpoint (async контекст): использовать `await func.remote.aio()`

### Error Handling

- [Modal timeouts](https://modal.com/docs/guide/timeouts): per-execution, настраиваются в `@app.function(timeout=300)`
- `FunctionTimeoutError` — можно перехватить и retry
- [Modal retries](https://modal.com/docs/guide/retries): встроенные с exponential backoff через `modal.Retries`
- Web endpoints: 150s max HTTP timeout

### Retry Strategy для fancai

**Двухуровневая система:**

1. **Modal retries**: для транзиентных ошибок GPU (OOM, hardware failure) — `retries=modal.Retries(max_retries=2, backoff_coefficient=2.0)`
2. **Celery retries**: для ошибок сети и Modal unavailability — `max_retries=3, countdown=60`

Правило: Modal отвечает за GPU-специфичные retries, Celery — за инфраструктурные.

---

## 5. Migration Strategy

### Поэтапный план

| Фаза | Компонент               | Описание                                                              |
| ---- | ----------------------- | --------------------------------------------------------------------- |
| 1    | Entity extraction (NER) | Мигрировать GliNER inference — самый CPU-интенсивный, выиграет от GPU |
| 2    | Image generation        | FLUX.2 Klein через Modal вместо OpenRouter                            |
| 3    | LLM extraction          | Gemini Flash — оставить на OpenRouter (нет смысла self-host)          |

**Почему NER первым:**

- GliNER — локальная модель, уже self-hosted
- Наибольший выигрыш от GPU (CPU inference медленный)
- Минимальный risk — fallback на текущий CPU inference

### Feature Flags

```python
# backend/app/core/config.py
USE_MODAL_NER: bool = env("USE_MODAL_NER", default=False)
USE_MODAL_IMAGES: bool = env("USE_MODAL_IMAGES", default=False)

# backend/app/tasks/ner.py
if settings.USE_MODAL_NER:
    result = modal_extract_entities.remote(text, config)
else:
    result = local_extract_entities(text, config)
```

### A/B Testing (NER quality)

- Уже есть инфраструктура A/B тестирования NER (коммит `7ac4e4f`)
- Подход: dual-write — и Modal, и CPU результаты → сравнить recall/precision
- Метрика: recall >= 86.84% (текущий baseline)

### Rollback Plan

1. Feature flag `USE_MODAL_NER=false` — мгновенный rollback
2. Celery task сам решает fallback при Modal timeout
3. Локальный GliNER inference остаётся в коде как fallback

---

## 6. Cost Optimization

### GPU Pricing (Modal, март 2026)

| GPU  | $/sec      | $/час  | VRAM  | Use case                          |
| ---- | ---------- | ------ | ----- | --------------------------------- |
| T4   | $0.000164  | $0.59  | 16 GB | GliNER inference, embedding       |
| A10G | $0.000306  | $1.10  | 24 GB | Image generation, mid-size models |
| L4   | ~$0.000240 | ~$0.86 | 24 GB | Inference alternative to A10G     |

### GPU Memory Snapshots

[Революционная фича](https://modal.com/blog/gpu-mem-snapshots) (август 2025):

- Снимок GPU memory после загрузки модели → восстановление при cold start
- **10x ускорение cold start**: 20s → 2s для audio models, 45s → 5s для vLLM
- Использует CUDA checkpoint/restore API (драйверы 570/575)
- Включение: `experimental_options={"enable_gpu_snapshot": True}`
- **Для fancai**: GliNER cold start может уменьшиться с ~10s до ~1-2s

### Container Lifecycle

- **Default idle timeout**: 60 секунд
- **Настройка**: `container_idle_timeout` (2 сек — 20 мин)
- **Keep warm**: `keep_warm=N` — минимум N контейнеров всегда готовы
- **Trade-off**: keep_warm=1 на T4 = ~$0.59/час × 24ч = ~$14/день — дорого для $50/мес

**Рекомендация для fancai**:

```python
@app.function(
    gpu="T4",
    container_idle_timeout=120,   # 2 мин idle — ловим burst запросы
    keep_warm=0,                   # Scale to zero — экономим бюджет
    timeout=300,                   # 5 мин max per request
    experimental_options={"enable_gpu_snapshot": True},  # Быстрый cold start
)
```

### Batch Processing

[Modal batch processing](https://modal.com/docs/guide/batch-processing): масштабирование до тысяч параллельных контейнеров без конфигурации. Для fancai: группировать entity extraction по главам книги, обрабатывать batch за один cold start.

### Spot / Preemptible

Modal не предлагает spot instances в явном виде. Вся модель — serverless с per-second billing. Preemptible режим не документирован. [Non-preemptible execution стоит 3x](https://www.runpod.io/articles/guides/top-serverless-gpu-clouds) от стандартных ставок (подразумевает, что стандартный режим может быть preemptible).

### Расчёт бюджета $50/мес

Сценарий: 100 книг/мес, ~20 глав/книга, ~3 сек/глава inference на T4:

```
100 книг × 20 глав × 3 сек = 6,000 GPU-секунд
6,000 × $0.000164 = $0.98/мес (только inference)
+ cold starts: ~10s × 100 = 1,000 сек × $0.000164 = $0.16
+ image generation (A10G): ~5 сек × 200 запросов × $0.000306 = $0.31

Итого: ~$1.45/мес при текущих объёмах
```

**Запас бюджета: 34x** — можно спокойно масштабироваться до 3,000+ книг/мес.

---

## Ключевые риски и митигации

| Риск                             | Вероятность       | Mitigation                                                              |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Cold start >5s при scale-to-zero | Высокая           | GPU memory snapshots (→ ~2s)                                            |
| Modal outage                     | Низкая            | Feature flag fallback на CPU inference                                  |
| Превышение бюджета               | Низкая            | Workspace budget limit + мониторинг                                     |
| Vendor lock-in                   | Средняя           | Абстракция: inference функция за интерфейсом, Modal — деталь реализации |
| GPU OOM на T4 (16GB)             | Низкая для GliNER | GliNER ~1GB VRAM, запас огромный                                        |

---

## Рекомендуемый Next Step

1. Создать `backend/app/modal_app/` с inference функцией GliNER
2. Feature flag `USE_MODAL_NER`
3. Deploy на Modal free tier (бесплатные $30 credits)
4. A/B test recall vs текущий CPU baseline
5. При успехе — включить в production, мигрировать image generation

---

## Источники

- [Modal Documentation](https://modal.com/docs)
- [Modal Pricing](https://modal.com/pricing)
- [Modal Security](https://modal.com/docs/guide/security)
- [Modal SOC 2 Type II](https://modal.com/blog/soc2type2)
- [Modal + Datadog Integration](https://modal.com/docs/guide/datadog-integration)
- [GPU Memory Snapshots](https://modal.com/blog/gpu-mem-snapshots)
- [Modal Billing Guide](https://modal.com/docs/guide/billing)
- [Modal Retries](https://modal.com/docs/guide/retries)
- [Modal Timeouts](https://modal.com/docs/guide/timeouts)
- [Modal Images](https://modal.com/docs/guide/images)
- [Modal Volumes](https://modal.com/docs/guide/volumes)
- [Modal Secrets](https://modal.com/docs/guide/secrets)
- [Modal Cold Start Performance](https://modal.com/docs/guide/cold-start)
- [Modal Continuous Deployment](https://modal.com/docs/guide/continuous-deployment)
- [Modal Web Endpoints](https://modal.com/docs/guide/webhooks)
- [Modal Proxy Auth Tokens](https://modal.com/docs/guide/webhook-proxy-auth)
- [Modal Developing & Debugging](https://modal.com/docs/guide/developing-debugging)
- [Modal Async Usage](https://modal.com/docs/guide/async)
- [Modal Batch Processing](https://modal.com/docs/guide/batch-processing)
- [Modal Scaling](https://modal.com/docs/guide/scale)
- [Datadog Modal Integration](https://docs.datadoghq.com/integrations/modal/)
- [Modal GPU Health](https://modal.com/docs/guide/gpu-health)
- [Top Serverless GPU Clouds 2026](https://www.runpod.io/articles/guides/top-serverless-gpu-clouds)
- [Modal Review 2026 — WaveSpeedAI](https://wavespeed.ai/blog/posts/modal-review-2026/)
- [Modal A10G Pricing](https://modal.com/blog/nvidia-a10g-price-article)
- [Modal T4 Pricing](https://modal.com/blog/nvidia-t4-price-article)
