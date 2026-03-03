# Инфраструктурный аудит v4: Глубокое исследование

**Дата:** 2026-03-01
**Scope:** Повторный глубокий аудит по 10 направлениям на основе пересмотренных решений из обсуждения v3.1
**Новый сервер:** 12 vCPU AMD EPYC 9755 4 GHz, 32 GB RAM DDR5, 100 GB NVMe
**Принцип:** Качество > стоимость (но с балансом)

---

## Executive Summary

Проведено глубокое исследование по 10 направлениям с параллельными исследовательскими агентами. Ключевые решения:

- **OpenRouter** — единый роутер для всех AI-запросов. Миграция реалистична за 10-14 дней. Критический момент: Imagen 4 недоступен через OpenRouter — нужна смена модели генерации изображений
- **LLM Primary:** Gemini 3 Flash через OpenRouter ($1.90/книга). Fallback: Gemini 2.5 Flash → Claude Haiku 4.5
- **Image Primary:** FLUX.2 Pro через OpenRouter ($0.03/изображение). Fallback: FLUX.2 Klein → Seedream 4.5
- **Инфраструктура:** Caddy (замена 2 nginx), Redis 7.4 (без Valkey), Gunicorn+Uvicorn (без Granian)
- **Мониторинг:** Netdata + Uptime Kuma + Dozzle (~300MB RAM, 30 мин setup)
- **Бэкапы:** pg_dump автоматический + offsite на Backblaze B2 ($0)
- **Docker UI:** Dockge > Portainer (compose-файлы на диске, проще)
- **Найден баг:** `visibility_timeout=3600` < `process_book` timeout=10800 → риск дублирования обработки книг

---

## Содержание

1. [Миграция на OpenRouter](#1-миграция-на-openrouter)
2. [LLM модели и стратегия](#2-llm-модели-и-стратегия)
3. [Image модели и стратегия](#3-image-модели-и-стратегия)
4. [Prompt Caching через OpenRouter](#4-prompt-caching-через-openrouter)
5. [Мониторинг](#5-мониторинг)
6. [Бэкапы PostgreSQL](#6-бэкапы-postgresql)
7. [Caddy + статика](#7-caddy--статика)
8. [Docker UI (Portainer/Dockge)](#8-docker-ui)
9. [Celery memory limits](#9-celery-memory-limits)
10. [PostgreSQL тюнинг](#10-postgresql-тюнинг)
11. [TCO пересчёт](#11-tco-пересчёт)
12. [План миграции](#12-план-миграции)
13. [Найденные баги](#13-найденные-баги)

---

## 1. Миграция на OpenRouter

### 1.1 Текущая архитектура

5 сервисов используют google-genai SDK напрямую:

| Сервис              | Файл                              | Использование                             | Сложность миграции |
| ------------------- | --------------------------------- | ----------------------------------------- | ------------------ |
| Gemini Extractor    | `gemini_extractor.py`             | `response_schema=PydanticModel` + 2 схемы | **HIGH**           |
| Entity Dedup        | `entity_deduplication_service.py` | `response_schema=DeduplicationResponse`   | MEDIUM             |
| Entity Synthesis    | `entity_synthesis_service.py`     | `response_mime_type` только (без schema)  | LOW                |
| Consistency Manager | `consistency_manager.py`          | `response_mime_type` только               | LOW                |
| Imagen Generator    | `imagen_generator.py`             | `client.models.generate_images()`         | **CRITICAL**       |

### 1.2 Ключевые технические проблемы

**Потеря `response_schema=PydanticModel`:**

- google-genai SDK автоматически конвертирует Pydantic → JSON Schema → валидный ответ
- OpenRouter требует ручной конвертации + `response_format.json_schema`
- Ответ приходит как строка JSON, нужен ручной `model_validate()`

**Проблема с вложенными схемами:**

- Pydantic v2 генерирует `$defs`, `$ref`, `anyOf` (для Optional полей)
- Gemini через OpenRouter плохо обрабатывает эти конструкции ([Issue #3617](https://github.com/pydantic/pydantic-ai/issues/3617))
- **Необходим JSON Schema трансформер:** инлайн `$defs`, конверсия `anyOf → nullable`

**Imagen 4 недоступен на OpenRouter:**

- `generate_images()` API не существует на OpenRouter
- Генерация идёт через `chat/completions` с `modalities: ["image"]`
- Нужна полная смена модели (→ FLUX.2 Pro или Nano Banana)

### 1.3 Рекомендуемый SDK

**openai Python SDK** с `base_url="https://openrouter.ai/api/v1"` — официально рекомендуемый OpenRouter подход.

### 1.4 OpenRouter-специфичные фичи

| Фича                 | Описание                                                  | Польза для fancai            |
| -------------------- | --------------------------------------------------------- | ---------------------------- |
| Provider routing     | `provider.order: ["Google AI Studio", "Vertex AI"]`       | Контроль провайдера          |
| Model fallbacks      | `models: ["gemini-3-flash", "gemini-2.5-flash"]`          | Автоматический fallback      |
| `require_parameters` | Принудительная маршрутизация на провайдеров с json_schema | Надёжность structured output |
| Response Healing     | Автоматический ремонт JSON (-80% дефектов)                | Уменьшение ошибок парсинга   |
| BYOK                 | Свой Google API key через OpenRouter (5% вместо 5.5%)     | Экономия + лимиты            |
| Analytics API        | `GET /api/v1/activity`                                    | Мониторинг расходов          |

### 1.5 Порядок миграции

| Фаза      | Сервисы                                                  | Дни            | Сложность |
| --------- | -------------------------------------------------------- | -------------- | --------- |
| 0         | Shared OpenRouter client + JSON Schema трансформер       | 1              | Low       |
| 1         | `entity_synthesis_service.py` + `consistency_manager.py` | 1              | Low       |
| 2         | `entity_deduplication_service.py`                        | 1-2            | Medium    |
| 3         | `gemini_extractor.py`                                    | 2-3            | High      |
| 4         | `imagen_generator.py` (полная переписка)                 | 3-4            | Critical  |
| 5         | Интеграционное тестирование + canary deploy              | 2-3            | High      |
| **Итого** |                                                          | **10-14 дней** |           |

### 1.6 Риски и митигации

| Риск                                       | Вероятность | Митигация                                                |
| ------------------------------------------ | ----------- | -------------------------------------------------------- |
| Деградация nested schemas через OpenRouter | Высокая     | JSON Schema трансформер (инлайн $defs, fix nullable)     |
| OpenRouter downtime (30 мин в фев 2026)    | Средняя     | Celery retries, async обработка — не критично            |
| Потеря safety_filter_level для изображений | Средняя     | FLUX.2 более permissive чем Imagen для литературных сцен |
| Latency overhead (~25-40ms)                | Низкая      | Запросы 5-30 сек, overhead <0.1%                         |

---

## 2. LLM модели и стратегия

### 2.1 Сравнение моделей для русского текста на OpenRouter

| Модель                    | Input $/1M | Output $/1M | Контекст   | Русский               | JSON Schema       | Рекомендация             |
| ------------------------- | ---------- | ----------- | ---------- | --------------------- | ----------------- | ------------------------ |
| **Gemini 3 Flash**        | $0.50      | $3.00       | 1M         | Сильный (NER F1=0.98) | Native            | **Primary**              |
| **Gemini 2.5 Flash**      | $0.30      | $2.50       | 1M         | Сильный               | Native            | **Fallback 1**           |
| **Gemini 2.5 Flash Lite** | $0.10      | $0.40       | 1M         | Приемлемый            | Native            | **Free tier**            |
| **Claude Haiku 4.5**      | $1.00      | $5.00       | 200K       | Отличный              | Guaranteed strict | **Fallback 2 / Premium** |
| **Qwen3.5 Plus**          | $0.40      | $2.40       | 1M         | Хороший (119 языков)  | Via provider      | Наблюдать                |
| DeepSeek V3.2             | $0.28      | $0.40       | 164K       | Нестабильный          | Нет json_schema   | **Не рекомендуется**     |
| Llama 4                   | —          | —           | 1M         | Не поддерживается     | —                 | **Не подходит**          |
| Qwen3 32B                 | $0.40      | $3.20       | 32K native | Нет данных            | Баги              | **Не рекомендуется**     |

### 2.2 Стоимость на книгу (100 глав × 20K input + 3K output)

| Модель                | Стоимость/книга | vs текущего |
| --------------------- | --------------- | ----------- |
| Gemini 2.5 Flash Lite | **$0.32**       | -83%        |
| Gemini 2.5 Flash      | **$1.35**       | -29%        |
| Gemini 3 Flash        | **$1.90**       | baseline    |
| Claude Haiku 4.5      | **$3.50**       | +84%        |

### 2.3 Fallback chain

```
Primary:      Gemini 3 Flash      ($1.90/книга)
Fallback 1:   Gemini 2.5 Flash    ($1.35/книга) — при rate limit / ошибках
Fallback 2:   Claude Haiku 4.5    ($3.50/книга) — другой провайдер, лучший JSON Schema
Fallback 3:   Qwen3.5 Plus        ($1.52/книга) — третий провайдер
```

Переключение: автоматическое через OpenRouter `models` массив + ручное по `JSON parse failure > 3`.

### 2.4 Стратегия по тарифам

| Тариф       | Модель                                                 | Стоимость/книга |
| ----------- | ------------------------------------------------------ | --------------- |
| **Free**    | Gemini 2.5 Flash Lite                                  | $0.32           |
| **Paid**    | Gemini 3 Flash                                         | $1.90           |
| **Premium** | Claude Haiku 4.5 (extraction) + Sonnet 4.6 (synthesis) | $3.50-5.00      |

### 2.5 Модели не подходящие для fancai

| Модель                     | Причина дисквалификации                             |
| -------------------------- | --------------------------------------------------- |
| **Llama 4**                | Русский не в 12 поддерживаемых языках               |
| **DeepSeek V3.2**          | Нет json_schema, нестабильный русский               |
| **Qwen3 32B**              | 32K native контекст < 30-40K глав, JSON баги        |
| **OpenRouter Auto Router** | Нет контроля модели — inconsistency через 100+ глав |

---

## 3. Image модели и стратегия

### 3.1 Доступные модели на OpenRouter

| Модель                         | Цена/изображение | Скорость | Качество      | Safety фильтры                  |
| ------------------------------ | ---------------- | -------- | ------------- | ------------------------------- |
| **FLUX.2 Pro**                 | $0.030           | 5-10s    | Excellent     | Moderate (лучше для литературы) |
| **FLUX.2 Klein**               | $0.014           | <1s      | Good          | Moderate                        |
| **FLUX.2 Max**                 | $0.070           | ~15s     | Best-in-class | Moderate                        |
| Seedream 4.5                   | $0.040           | 5-10s    | Very Good     | Moderate                        |
| Nano Banana (Gemini 2.5 Flash) | ~$0.039          | 20-40s   | Good          | Strict (настраиваемые)          |
| Nano Banana Pro (Gemini 3 Pro) | ~$0.10+          | 40-60s   | Excellent     | Strict                          |
| GPT-5 Image                    | ~$0.040          | 10-20s   | Very Good     | Strict                          |

Для сравнения: текущий Imagen 4 Fast = $0.02/изображение.

### 3.2 Fallback chain для изображений

```
Primary:      FLUX.2 Pro         ($0.03/img) — лучший баланс качество/цена, умеренные фильтры
Fallback 1:   FLUX.2 Klein       ($0.014/img) — при rate limit, бюджетный
Fallback 2:   Seedream 4.5       ($0.04/img) — другой провайдер (ByteDance)
Emergency:    Nano Banana         (~$0.04/img) — Google-backed, всегда доступен
```

### 3.3 Стратегия по тарифам (изображения)

| Тариф       | Модель                        | Цена/img   | Лимит/мес           |
| ----------- | ----------------------------- | ---------- | ------------------- |
| **Free**    | FLUX.2 Klein                  | $0.014     | 10 img ($0.14/user) |
| **Paid**    | FLUX.2 Pro                    | $0.030     | 100 img ($3/user)   |
| **Premium** | FLUX.2 Pro + Max (key scenes) | $0.03-0.07 | 300 img             |

### 3.4 Что теряем при уходе с Imagen 4

| Потеря                            | Критичность | Замена                               |
| --------------------------------- | ----------- | ------------------------------------ |
| `person_generation="allow_adult"` | HIGH        | FLUX.2 более permissive по умолчанию |
| `safety_filter_level`             | MEDIUM      | FLUX.2 — менее строгие фильтры       |
| `seed` для reproducibility        | LOW         | Модель-зависимо                      |
| Прямой Google SDK                 | LOW         | OpenRouter unified API               |

### 3.5 Что получаем

- 15+ моделей вместо 1 провайдера
- Менее строгие фильтры (FLUX.2) — лучше для классической литературы
- Ценовая гибкость ($0.014-0.15)
- Multi-provider resilience

---

## 4. Prompt Caching через OpenRouter

### 4.1 Как работает

OpenRouter поддерживает **implicit caching** для Gemini моделей:

- **Автоматическое:** если тот же prefix отправляется повторно, кеш включается без конфигурации
- **Экономия:** 75% на кешированных токенах
- **Минимум:** 1028 токенов (Flash) / 2048 токенов (Pro) для активации кеша
- **Без TTL:** OpenRouter управляет кешем автоматически
- **Без write costs:** нет стоимости записи в кеш

### 4.2 Применимость для fancai

При обработке книги (100 глав) системный промпт (~2K токенов) отправляется 100+ раз → **автоматически кешируется** через OpenRouter. Это проще чем ручное управление TTL через прямой Gemini API.

### 4.3 Ограничения

- [Известные проблемы с тарификацией](https://github.com/cline/cline/issues/3158): некоторые запросы тарифицируются по полной цене несмотря на cache hit
- Кеширование работает только внутри одного провайдера (если OpenRouter переключает провайдера, кеш сбрасывается)
- Рекомендация: использовать `provider.order` для закрепления провайдера при обработке книги

---

## 5. Мониторинг

### 5.1 Рекомендация: Netdata + Uptime Kuma + Dozzle

| Компонент       | Роль                                                                  | RAM        | Setup       |
| --------------- | --------------------------------------------------------------------- | ---------- | ----------- |
| **Netdata**     | Инфраструктура + приложение (PostgreSQL, Redis, Docker автодискавери) | ~200MB     | 10-15 мин   |
| **Uptime Kuma** | Uptime эндпоинтов, статус-страница, Telegram алерты                   | ~80MB      | 10 мин      |
| **Dozzle**      | Web UI для Docker логов (real-time, поиск)                            | ~30MB      | 5 мин       |
| **Итого**       |                                                                       | **~310MB** | **~30 мин** |

### 5.2 Почему не Prometheus + Grafana

- Prometheus + Grafana = 2GB+ RAM, 6-8 контейнеров, 2-4 часа setup
- Netdata покрывает 95% потребностей за ~200MB и 1 контейнер
- Если Netdata дашбордов не хватит — добавить VictoriaMetrics + Grafana позже

### 5.3 Что мониторится

- **Server:** CPU, RAM, disk, network (автодискавери Netdata)
- **Docker:** все контейнеры (автодискавери через Docker socket)
- **PostgreSQL:** 100+ метрик (native Netdata collector)
- **Redis:** автодискавери Netdata
- **Celery:** через celery-exporter или Flower `--prometheus_metrics`
- **FastAPI:** `prometheus-fastapi-instrumentator` (3 строки кода)
- **Uptime:** HTTP checks на `fancai.ru`, `/api/health`, TCP checks PostgreSQL/Redis
- **Алерты:** Telegram (native в Netdata и Uptime Kuma)

### 5.4 Docker Compose

```yaml
netdata:
  image: netdata/netdata:stable
  container_name: netdata
  hostname: fancai-server
  restart: unless-stopped
  cap_add: [SYS_PTRACE, SYS_ADMIN]
  security_opt: [apparmor:unconfined]
  ports: ["19999:19999"]
  volumes:
    - netdataconfig:/etc/netdata
    - netdatalib:/var/lib/netdata
    - netdatacache:/var/cache/netdata
    - /:/host/root:ro,rslave
    - /etc/passwd:/host/etc/passwd:ro
    - /etc/group:/host/etc/group:ro
    - /proc:/host/proc:ro
    - /sys:/host/sys:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro

uptime-kuma:
  image: louislam/uptime-kuma:1
  container_name: uptime-kuma
  restart: unless-stopped
  ports: ["3001:3001"]
  volumes:
    - uptime-kuma-data:/app/data
    - /var/run/docker.sock:/var/run/docker.sock:ro

dozzle:
  image: amir20/dozzle:latest
  container_name: dozzle
  restart: unless-stopped
  ports: ["9999:8080"]
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

---

## 6. Бэкапы PostgreSQL

### 6.1 Критическая находка

Текущие бэкапы покрывают только `uploaded_books` (EPUB файлы). **База PostgreSQL НЕ бэкапится вообще.** Потеря диска = потеря всех данных пользователей.

### 6.2 Рекомендация: pg_dump через Docker контейнер

**Tier 1 (немедленно, 15 мин setup, $0):**

```yaml
pgbackup:
  image: prodrigestivill/postgres-backup-local:17-alpine
  container_name: bookreader_pgbackup
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    - POSTGRES_HOST=postgres
    - POSTGRES_DB=${DB_NAME}
    - POSTGRES_USER=${DB_USER}
    - POSTGRES_PASSWORD=${DB_PASSWORD}
    - POSTGRES_EXTRA_OPTS=-Z6 --format=custom --blobs
    - SCHEDULE=@daily
    - BACKUP_ON_START=TRUE
    - BACKUP_KEEP_DAYS=7
    - BACKUP_KEEP_WEEKS=4
    - BACKUP_KEEP_MONTHS=6
    - HEALTHCHECK_PORT=8080
    - TZ=Europe/Moscow
  volumes:
    - /root/backups/postgres:/backups
  restart: unless-stopped
```

**Tier 2 (в течение недели, $0):**

- Offsite на **Backblaze B2** или **Cloudflare R2** (10GB бесплатно)
- rclone sync по cron после ежедневного бэкапа

### 6.3 Почему не pgBackRest/Barman

| Решение             | Сложность | Для кого                 | Для fancai              |
| ------------------- | --------- | ------------------------ | ----------------------- |
| pg_dump (контейнер) | 1/5       | Solo dev, малая БД       | **Идеально**            |
| pgBackRest          | 4/5       | DBA, БД 500GB+           | Overkill                |
| Barman              | 4/5       | Enterprise, multi-server | Не подходит             |
| WAL-G               | 3/5       | DevOps, cloud-native     | Следующий шаг при росте |

### 6.4 RPO/RTO

| Метрика                   | Цель     |
| ------------------------- | -------- |
| RPO (макс. потеря данных) | 24 часа  |
| RTO (макс. downtime)      | 1-2 часа |

---

## 7. Caddy + статика

### 7.1 Текущая архитектура → Новая

**Было:** Client → nginx proxy → nginx frontend → static file (2 контейнера, ~500 строк конфига)

**Стало:** Client → Caddy → static file / backend (1 контейнер, ~80 строк конфига)

### 7.2 Что получаем

| Плюс                                           | Влияние                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| Автоматический HTTPS (Let's Encrypt + ZeroSSL) | Нет certbot, нет ручного обновления сертификатов |
| HTTP/3 (QUIC) из коробки                       | Лучшая мобильная производительность (PWA)        |
| -1 контейнер (frontend nginx)                  | Меньше ресурсов, проще deployment                |
| Убран double-hop                               | Ниже latency для статики                         |
| WebSocket auto-detect                          | Не нужен `proxy_set_header Upgrade`              |
| Built-in Prometheus metrics                    | Не нужен nginx-exporter                          |
| ~80 строк vs ~500 строк конфига                | Проще поддерживать                               |

### 7.3 Что теряем

| Потеря                     | Критичность | Решение                                                     |
| -------------------------- | ----------- | ----------------------------------------------------------- |
| Built-in rate limiting     | **HIGH**    | xcaddy + caddy-ratelimit плагин ИЛИ FastAPI slowapi (лучше) |
| Connection limiting        | MEDIUM      | iptables / app-layer                                        |
| sendfile/epoll kernel opts | LOW         | Нерелевантно при ~50 пользователях                          |
| Brotli compression         | LOW         | gzip + zstd достаточно                                      |
| ~40MB больше RAM           | LOW         | 0.5% от 32GB                                                |

### 7.4 Рекомендация по rate limiting

Перенести rate limiting на уровень приложения (FastAPI `slowapi`) — это лучшая практика, так как позволяет rate limit по user ID, а не только по IP.

### 7.5 Docker архитектура

Multi-stage Dockerfile: build frontend → copy to Caddy container. Один self-contained image.

---

## 8. Docker UI

### 8.1 Рекомендация: Dockge > Portainer

| Критерий          | Dockge                                  | Portainer CE                       |
| ----------------- | --------------------------------------- | ---------------------------------- |
| Compose файлы     | **На диске (git-trackable)**            | В внутренней БД                    |
| RAM               | ~15-25MB                                | ~30-50MB                           |
| Функциональность  | Compose management                      | Полное Docker управление           |
| Автор             | Louis Lam (Uptime Kuma)                 | Portainer.io                       |
| CLI совместимость | Использует `docker compose` под капотом | CLI-созданные ресурсы = "external" |
| Сложность         | Минимальная                             | Средняя                            |

### 8.2 Почему Dockge

1. **Compose файлы остаются на диске** — `docker-compose.lite.prod.yml` остаётся git-trackable
2. **Не конфликтует с CLI** — использует тот же `docker compose` под капотом
3. **Проверенный автор** — Louis Lam создал Uptime Kuma (83K GitHub stars)
4. **Проще** — делает ровно то что нужно для compose management

### 8.3 Дополнительно: Lazydocker

Установить Lazydocker на сервер как terminal UI для быстрой инспекции через SSH.

---

## 9. Celery Memory Limits

### 9.1 Найденные проблемы

**Inconsistency across configs:**

| Файл                                 | max-memory-per-child | concurrency |
| ------------------------------------ | -------------------- | ----------- |
| `celery_app.py` (код)                | 150MB                | не задано   |
| `docker-compose.lite.prod.yml` (CLI) | 400MB                | 4           |
| `docker-compose.staging.yml` (CLI)   | 300MB                | 1           |

CLI переопределяет код. Три разных значения в трёх файлах.

**`celery_config.py` — мёртвый код:** содержит NLP-эра настройки, не импортируется в `celery_app.py`.

### 9.2 Рекомендуемые значения для нового сервера

| Параметр                    | Значение           | Обоснование                                  |
| --------------------------- | ------------------ | -------------------------------------------- |
| `--concurrency`             | 6                  | API-bound задачи на 12 vCPU                  |
| `--max-memory-per-child`    | 800000 (800MB)     | EPUB parsing peak + headroom                 |
| `--max-tasks-per-child`     | 50                 | Защита от медленных утечек                   |
| `--prefetch-multiplier`     | 1                  | Одна задача за раз для long-running          |
| Docker `memory` limit       | 7G                 | 6×800MB + 300MB parent + 25% headroom        |
| Docker `memory` reservation | 2G                 | Steady-state (API-waiting)                   |
| `worker_proc_alive_timeout` | 10.0s              | Запас на тяжёлые импорты                     |
| `visibility_timeout`        | **14400 (4 часа)** | **ФИКС: должен быть > process_book timeout** |

### 9.3 Распределение RAM на 32GB сервере

| Сервис             | Memory Limit | Reservation |
| ------------------ | ------------ | ----------- |
| PostgreSQL         | 10G          | 4G          |
| Redis              | 2G           | 1G          |
| FastAPI (Gunicorn) | 3G           | 1G          |
| **Celery Worker**  | **7G**       | **2G**      |
| Celery Beat        | 384M         | 128M        |
| Caddy              | 128M         | 64M         |
| Monitoring         | 1G           | 512M        |
| OS + page cache    | ~8.5G        | —           |
| **Итого**          | ~32G         |             |

### 9.4 Новая настройка Celery 5.6

```python
worker_cancel_long_running_tasks_on_connection_loss=True  # Подготовка к Celery 6.0
```

---

## 10. PostgreSQL тюнинг

### 10.1 Ключевые параметры для 12 vCPU / 32GB / NVMe

```ini
# Memory
shared_buffers = 2GB              # 25% от контейнера (8GB)
effective_cache_size = 6GB        # shared_buffers + OS cache
work_mem = 32MB                   # per-sort per-connection
maintenance_work_mem = 512MB      # VACUUM, CREATE INDEX

# WAL
wal_buffers = 64MB
min_wal_size = 1GB
max_wal_size = 4GB
wal_compression = zstd            # PG17 new

# Checkpoints
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min

# Connections
max_connections = 80

# Parallelism
max_worker_processes = 12
max_parallel_workers = 8
max_parallel_workers_per_gather = 4
max_parallel_maintenance_workers = 4

# NVMe
random_page_cost = 1.1            # vs default 4.0
effective_io_concurrency = 200    # vs default 1
maintenance_io_concurrency = 200

# Autovacuum
autovacuum_max_workers = 4
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = 800

# Extensions
shared_preload_libraries = 'pg_stat_statements,auto_explain'
```

### 10.2 Docker-специфичные настройки

```yaml
postgres:
  image: postgres:17-alpine
  shm_size: "4g" # ОБЯЗАТЕЛЬНО для shared_buffers=2GB
  deploy:
    resources:
      limits:
        cpus: "6.0"
        memory: 10G
      reservations:
        cpus: "2.0"
        memory: 4G
  tmpfs:
    - /var/lib/postgresql/data/pg_stat_tmp:size=256m,uid=70,gid=70
```

### 10.3 Новые индексы

```sql
-- GIN для fuzzy matching сущностей
CREATE INDEX idx_entities_name_gin_trgm ON entities USING GIN (name gin_trgm_ops);

-- BRIN для time-series reading_sessions
CREATE INDEX idx_reading_sessions_started_brin ON reading_sessions
  USING BRIN (started_at) WITH (pages_per_range = 32);

-- Partial для очереди генерации изображений
CREATE INDEX idx_descriptions_pending_images ON descriptions (priority_score DESC)
  WHERE image_generated = FALSE AND is_suitable_for_generation = TRUE;
```

### 10.4 PgBouncer

**Не нужен сейчас.** SQLAlchemy pool_size=20 + max_overflow=40 + Celery ~12 = ~74 соединения. max_connections=80 покрывает это. Добавлять при 200+ пользователях.

---

## 11. TCO пересчёт

### 11.1 Базовые расчёты (50 пользователей, 37.5 книг/мес)

| Статья                      | Текущий                  | OpenRouter Quality-First          | Изменение |
| --------------------------- | ------------------------ | --------------------------------- | --------- |
| LLM extraction (37.5 книг)  | $70.88 (Gemini 3 direct) | $75.19 (Gemini 3 Flash OR + 5.5%) | +6%       |
| Entity synthesis/dedup      | $10.30                   | $10.87                            | +6%       |
| Image generation (2000 img) | $40.00 (Imagen 4 Fast)   | $63.15 (FLUX.2 Pro OR)            | +58%      |
| **AI subtotal**             | **$121.18**              | **$149.21**                       | **+23%**  |
| VPS (новый сервер)          | $35.00                   | $35.00                            | —         |
| Домен                       | $2.00                    | $2.00                             | —         |
| Offsite backup (B2)         | $0.00                    | $0.00                             | —         |
| **ИТОГО**                   | **$158.18/мес**          | **$186.21/мес**                   | **+18%**  |
| **На пользователя**         | **$3.16**                | **$3.72**                         |           |

### 11.2 С оптимизациями

| Оптимизация                                   | Экономия/мес      |
| --------------------------------------------- | ----------------- |
| Prompt caching (75% на cached tokens)         | -$15-20           |
| Image dedup (hash-based, ~30% дубликатов)     | -$19              |
| BYOK Google key (5% вместо 5.5%)              | -$0.75            |
| Free tier на FLUX.2 Klein (25 users × 10 img) | -$3.50            |
| **Итого с оптимизациями**                     | **~$148-153/мес** |

### 11.3 Тарифная стратегия (будущее)

| Тариф             | Пользователей | LLM модель                          | Image модель             | Revenue       |
| ----------------- | ------------- | ----------------------------------- | ------------------------ | ------------- |
| Free              | 25            | Gemini 2.5 Flash Lite ($0.32/книга) | FLUX.2 Klein (10 img)    | $0            |
| Paid ($5/мес)     | 20            | Gemini 3 Flash ($1.90/книга)        | FLUX.2 Pro (100 img)     | $100          |
| Premium ($15/мес) | 5             | Claude Haiku 4.5 ($3.50/книга)      | FLUX.2 Pro+Max (300 img) | $75           |
| **Revenue**       |               |                                     |                          | **$175/мес**  |
| **Cost**          |               |                                     |                          | **~$153/мес** |

---

## 12. План миграции

### Phase 0: Аварийные фиксы (НЕМЕДЛЕННО)

1. **ФИКС БАГ:** `visibility_timeout: 3600 → 14400` в broker_transport_options
2. Удалить `celery_config.py` (мёртвый NLP код)
3. Удалить legacy NLP настройки из `config.py`
4. Добавить бэкап PostgreSQL (15 мин)

### Phase 1: Подготовка нового сервера (1-2 дня)

1. Docker Compose с новыми лимитами (RAM/CPU)
2. PostgreSQL 17 с оптимизированным конфигом
3. Redis 7.4-alpine
4. Caddy вместо 2× nginx
5. Netdata + Uptime Kuma + Dozzle
6. Dockge для UI управления
7. pg_dump автобэкап + offsite (B2/R2)

### Phase 2: Миграция на OpenRouter — LLM (10-14 дней)

1. Shared OpenRouter client wrapper
2. JSON Schema трансформер ($defs inline, nullable fix)
3. Миграция сервисов в порядке: synthesis → consistency → dedup → extractor
4. Интеграционное тестирование на 5-10 книгах
5. Canary deploy (10% трафика через OpenRouter)

### Phase 3: Миграция на OpenRouter — Images (5-7 дней)

1. Оценка FLUX.2 Pro vs Nano Banana на тестовых промптах
2. Переписка `imagen_generator.py` → `openrouter_image_generator.py`
3. Тестирование на реальных книгах
4. Полное переключение

### Phase 4: Оптимизации (параллельно с Phase 2-3)

1. Image dedup (hash-based, Redis Set)
2. Мониторинг расходов через OpenRouter Analytics API
3. Настройка provider routing для стабильного prompt caching
4. Rate limiting на уровне FastAPI (slowapi)

---

## 13. Найденные баги

### БАГ 1: visibility_timeout < process_book timeout (CRITICAL)

**Файл:** `celery_app.py`
**Проблема:** `visibility_timeout=3600` (1 час), но `process_book` имеет `time_limit=10800` (3 часа)
**Последствие:** Если обработка книги длится > 1 часа, Redis считает задачу потерянной и передоставляет её другому воркеру → **дублирование обработки книги**
**Фикс:** `visibility_timeout=14400` (4 часа)

### БАГ 2: celery_config.py — мёртвый код

**Файл:** `celery_config.py`
**Проблема:** Определяет `CELERY_CONFIG`, `ResourceAwareCelery`, `create_celery_app()`, но ничего из этого не импортируется в `celery_app.py`. Содержит NLP-эра настройки (`NLP_CACHE_CONFIG` с 1GB model cache).
**Фикс:** Удалить файл или консолидировать полезные части.

### БАГ 3: Inconsistent memory limits across compose files

**Файлы:** 3 docker-compose файла с разными `max-memory-per-child` (150MB, 300MB, 400MB)
**Фикс:** Единое значение 800MB через env var.

---

## Источники

### OpenRouter

- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter OpenAI SDK](https://openrouter.ai/docs/guides/community/openai-sdk)
- [OpenRouter Feb 2026 Outages](https://openrouter.ai/announcements/openrouter-outages-on-february-17-and-19-2026)
- [Pydantic AI + OpenRouter nested schemas issue](https://github.com/pydantic/pydantic-ai/issues/3617)

### LLM Models

- [Gemini 3 Flash Announcement](https://blog.google/products/gemini/gemini-3-flash/)
- [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Context Rot Research (Chroma)](https://research.trychroma.com/context-rot)
- [Russian NER Evaluation (arxiv)](https://arxiv.org/html/2506.02589v1)

### Image Models

- [OpenRouter Image Models Collection](https://openrouter.ai/collections/image-models)
- [FLUX.2 Pro on OpenRouter](https://openrouter.ai/black-forest-labs/flux.2-pro)
- [FLUX.2 Pro Review vs Midjourney/Nano Banana](https://medium.com/@leucopsis/flux-2-pro-review-and-comparison-with-midjourney-v7-and-with-nano-banana-pro-337224a5551f)

### Monitoring

- [Netdata GitHub](https://github.com/netdata/netdata) — 76.3K stars
- [Uptime Kuma GitHub](https://github.com/louislam/uptime-kuma) — 83.4K stars
- [Dozzle (Docker log viewer)](https://dozzle.dev/)

### Backups

- [prodrigestivill/postgres-backup-local](https://github.com/prodrigestivill/docker-postgres-backup-local)
- [Backblaze B2 Pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

### Caddy

- [Caddy Common Patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Caddy vs Nginx Benchmark](https://blog.tjll.net/reverse-proxy-hot-dog-eating-contest-caddy-vs-nginx/)
- [caddy-ratelimit plugin](https://github.com/mholt/caddy-ratelimit)

### Docker UI

- [Dockge GitHub](https://github.com/louislam/dockge)
- [Portainer vs Dockge Comparison](https://homelabsec.com/posts/portainer-vs-dockge/)

### PostgreSQL

- [PostgreSQL 17 Release Notes](https://www.postgresql.org/docs/release/17.0/)
- [PGTune Calculator](https://pgtune.leopard.in.ua/)
- [PostgreSQL Docker shm_size](https://www.instaclustr.com/blog/postgresql-docker-and-shared-memory/)

### Celery

- [Celery Workers Guide](https://docs.celeryq.dev/en/stable/userguide/workers.html)
- [Celery Optimizing Guide](https://docs.celeryq.dev/en/stable/userguide/optimizing.html)
- [Celery Execution Pools](https://celery.school/celery-worker-pools)
