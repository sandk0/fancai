# Анализ инфраструктуры и план миграции fancai

**Дата:** 2026-03-01
**Scope:** Полный аудит инфраструктуры + исследование современных альтернатив
**Целевой сервер:** 12 ядер AMD EPYC 9755 4 GHz, 32 ГБ DDR5, 100 ГБ NVMe (vdsina.com)

## Executive Summary

Текущая инфраструктура fancai рассчитана на сервер 8 ГБ / 4 CPU и использует классический стек (Nginx + Gunicorn/Uvicorn + Celery + Redis + PostgreSQL). При переезде на сервер в 4 раза мощнее необходимо не просто масштабировать лимиты, а критически пересмотреть каждый компонент. Исследование выявило **4 компонента с сильными альтернативами** (reverse proxy, ASGI server, Redis, мониторинг), **2 компонента для добавления** (PgBouncer, автоматизированные бэкапы), и **3 компонента, которые стоит оставить** (PostgreSQL, Docker Compose, Celery — с оговорками).

---

## Текущее состояние инфраструктуры

### Инвентаризация сервисов (docker-compose.lite.prod.yml)

| Сервис        | Образ                  | RAM лимит  | CPU лимит | Назначение        |
| ------------- | ---------------------- | ---------- | --------- | ----------------- |
| PostgreSQL    | 17-alpine              | 2 ГБ       | -         | БД                |
| Redis         | 7.4-alpine             | 768 МБ     | -         | Кэш + брокер      |
| Nginx         | 1.27-alpine            | 256 МБ     | -         | Reverse proxy     |
| Backend       | python:3.12-slim       | 2 ГБ       | -         | FastAPI API       |
| Celery Worker | python:3.12-slim       | 1.5-2.5 ГБ | -         | Фоновые задачи    |
| Celery Beat   | python:3.12-slim       | 256 МБ     | -         | Планировщик       |
| Frontend      | node:22-alpine → nginx | 256 МБ     | -         | React SPA         |
| Backup        | postgres:17-alpine     | -          | -         | pg_dump ежедневно |
| **Итого**     |                        | **~7 ГБ**  | **4 CPU** |                   |

### Критические проблемы найденные при аудите

1. **Alembic config hardcoded credentials** — `/backend/alembic.ini` содержит захардкоженный `postgresql://bookreader_user:bookreader_pass@localhost:5433/bookreader`
2. **CI/CD Python version mismatch** — CI использует Python 3.11, Docker — 3.12-slim
3. **NLP модели скачиваются в CI** — spacy ru_core_news_sm (1 ГБ+) не нужен для lite-версии
4. **CSP header с unsafe-inline** — XSS уязвимость в production
5. **Celery worker memory limit 400 МБ** — слишком мало для парсинга крупных книг (до 1.5 ГБ)
6. **PostgreSQL версия рассинхронизирована** — dev: 15-alpine, prod: 17-alpine

---

## Сравнительный анализ по компонентам

### 1. Reverse Proxy: Nginx → Caddy

| Критерий           | Nginx 1.27                       | Caddy 2.x                 | Traefik 3.x         |
| ------------------ | -------------------------------- | ------------------------- | ------------------- |
| Производительность | 12,340 RPS                       | 11,780 RPS (-4.5%)        | 10,920 RPS (-11.5%) |
| Latency            | 8.10ms                           | 8.49ms                    | 9.16ms              |
| Автоматический SSL | Нет (certbot)                    | Да (встроен)              | Да (встроен)        |
| Конфигурация       | Verbose (100+ строк)             | Минимальная (10-20 строк) | Labels/YAML         |
| Hot reload         | Требует nginx -s reload          | Автоматический            | Автоматический      |
| HTTP/2, HTTP/3     | HTTP/2 (HTTP/3 экспериментально) | HTTP/2 + HTTP/3 нативно   | HTTP/2              |
| Docker integration | Ручная                           | Через Caddyfile           | Нативная (labels)   |

**Рекомендация: ЗАМЕНИТЬ на Caddy 2.x**

**Причины:**

- Автоматический HTTPS с Let's Encrypt + ZeroSSL (fallback) — убирает certbot, cron, ручное обновление
- Разница в производительности 4.5% неощутима для нашей нагрузки
- Caddyfile в 5-10 раз короче nginx.conf — меньше шанс ошибки
- Нативный HTTP/3 (QUIC) — улучшит загрузку для мобильных пользователей
- При переезде на новый сервер — идеальный момент для смены

**Пример Caddyfile для fancai:**

```
fancai.ru {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /ws/* {
        reverse_proxy backend:8000
    }
    handle {
        reverse_proxy frontend:80
    }

    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
    }
}
```

**Риски:** Потеря тонкой настройки rate limiting (Caddy имеет rate_limit модуль, но менее гибкий чем nginx). Для нашего масштаба — достаточно.

---

### 2. ASGI Server: Gunicorn + Uvicorn → Granian

| Критерий            | Gunicorn + Uvicorn | Granian                   | Uvicorn standalone |
| ------------------- | ------------------ | ------------------------- | ------------------ |
| RPS (hello world)   | ~45,000            | ~50,000 (+11%)            | ~45,000            |
| Latency consistency | max/avg = 6.8x     | max/avg = 2.8x            | max/avg = 6.8x     |
| Memory per worker   | ~20 МБ             | ~15 МБ (-25%)             | ~20 МБ             |
| Process management  | Gunicorn (WSGI)    | Встроен (Rust)            | Нет                |
| HTTP/2              | Нет                | Нативный                  | Нет                |
| Язык runtime        | Python             | Rust + Python             | Python             |
| Adoption            | Стандарт индустрии | Растёт (Reflex мигрирует) | Стандарт           |

**Рекомендация: ЗАМЕНИТЬ на Granian**

**Причины:**

- На 11% выше throughput, в 2.4 раза стабильнее latency
- На 25% меньше RAM на воркер — на 12 ядрах это значимо
- Rust runtime обрабатывает I/O, Python — бизнес-логику
- Встроенный process manager — не нужен Gunicorn как прослойка
- Reflex framework уже мигрирует с Uvicorn на Granian (v0.8.0)

**Конфигурация для 12 ядер / 32 ГБ:**

```bash
granian --interface asgi \
  --host 0.0.0.0 --port 8000 \
  --workers 4 --threads 2 \
  --backpressure 128 \
  app.main:app
```

**Риски:** Менее зрелый, чем Gunicorn. Другая модель конфигурации (нельзя просто перенести настройки). Нужно тестирование под нагрузкой.

---

### 3. Redis: Redis 7.4 → Valkey 8.x или DragonflyDB

| Критерий             | Redis 7.4            | Valkey 8.x          | DragonflyDB       |
| -------------------- | -------------------- | ------------------- | ----------------- |
| Лицензия             | SSPL (проприетарная) | BSD-3 (open source) | BSL 1.1           |
| Throughput           | 360K RPS             | 1.19M RPS (3.3x)    | 3.8M RPS (10x)    |
| Memory efficiency    | Baseline             | Такая же            | На 30% лучше      |
| Snapshot overhead    | До 3x RAM            | Такой же            | Минимальный       |
| Multithreading       | Нет (single-thread)  | I/O threading       | Полный multi-core |
| Drop-in compatible   | —                    | 100%                | ~185 команд       |
| Community            | Коммерческий         | Linux Foundation    | Стартап           |
| Celery совместимость | Полная               | Полная              | Полная            |

**Рекомендация: ЗАМЕНИТЬ на Valkey 8.x**

**Причины:**

- 100% drop-in replacement — нулевая стоимость миграции (тот же протокол, те же команды)
- В 3.3 раза выше throughput с I/O multithreading — на 12 ядрах это существенно
- Open source лицензия (BSD-3) vs проприетарная SSPL у Redis
- Поддерживается Linux Foundation, AWS, Google, Oracle
- Celery, Python redis клиент — работают без изменений

**Почему НЕ DragonflyDB:** Хотя DragonflyDB в 10 раз быстрее, он поддерживает только ~185 из 400+ Redis команд. Для кэша достаточно, но для Celery broker/result backend могут быть проблемы совместимости. Valkey — более безопасный выбор.

**Миграция:** Заменить `redis:7.4-alpine` на `valkey/valkey:8-alpine` в docker-compose. Конфиг совместим.

---

### 4. Task Queue: Celery 5.6 — ОСТАВИТЬ (с оговорками)

| Критерий           | Celery 5.6         | Taskiq        | Dramatiq      | Temporal         |
| ------------------ | ------------------ | ------------- | ------------- | ---------------- |
| Async native       | Нет (sync workers) | Да            | Нет           | Да (durable)     |
| FastAPI интеграция | Через обёртки      | Нативная (DI) | Через обёртки | SDK              |
| Производительность | Baseline           | ~10x быстрее  | ~10x быстрее  | Другая парадигма |
| Beat (scheduled)   | Встроен            | Нет           | Нет           | Встроен          |
| Priority queues    | Да (3 очереди)     | Да            | Да            | Да               |
| Ecosystem maturity | 12+ лет            | 2 года        | 6 лет         | 5 лет            |
| Мониторинг         | Flower, Prometheus | Базовый       | Базовый       | Web UI           |

**Рекомендация: ОСТАВИТЬ Celery 5.6, но пересмотреть на Phase 2**

**Причины оставить:**

- Проект использует 3 приоритетные очереди (heavy/normal/light) + Beat для расписания
- Celery Beat для scheduled tasks — у альтернатив нет аналога
- Миграция task queue — высокий риск при переезде сервера
- Celery 5.6 (январь 2026) — актуальная версия с фиксами утечек памяти

**Причины пересмотреть позже:**

- Taskiq нативно async и специально создан для FastAPI
- Dramatiq в 10x быстрее на fire-and-forget задачах
- Текущий worker обрабатывает sync задачи в async приложении — неэффективно

**Немедленно исправить:**

- Увеличить `max-memory-per-child` с 400 МБ до 768 МБ (парсинг крупных книг)
- Увеличить `concurrency` с 2-4 до 6-8 (12 ядер позволяют)

---

### 5. PostgreSQL 17 — ОСТАВИТЬ, тюнить под 32 ГБ

PostgreSQL остаётся лучшим выбором для нашего проекта. Альтернатив уровня PostgreSQL для реляционных данных с JSONB, полнотекстовым поиском и расширениями не существует.

**Текущие настройки (8 ГБ сервер) → Новые (32 ГБ сервер):**

| Параметр                        | Было (8 ГБ)     | Рекомендация (32 ГБ)  | Формула                     |
| ------------------------------- | --------------- | --------------------- | --------------------------- |
| shared_buffers                  | 512 МБ          | 8 ГБ                  | 25% RAM                     |
| effective_cache_size            | 1 ГБ            | 24 ГБ                 | 75% RAM                     |
| work_mem                        | 16 МБ           | 64 МБ                 | RAM / (connections × 4)     |
| maintenance_work_mem            | 128 МБ          | 1 ГБ                  | 5% RAM, max 2 ГБ            |
| max_connections                 | 100             | 100 (через PgBouncer) | Не менять                   |
| random_page_cost                | 1.1             | 1.1                   | NVMe → ок                   |
| wal_buffers                     | default (16 МБ) | 64 МБ                 | 1/128 shared_buffers        |
| max_wal_size                    | default (1 ГБ)  | 4 ГБ                  | Больше WAL между checkpoint |
| max_worker_processes            | default (8)     | 12                    | По числу ядер               |
| max_parallel_workers_per_gather | default (2)     | 4                     | Ядра / 3                    |
| max_parallel_workers            | default (8)     | 8                     | 2/3 ядер                    |
| huge_pages                      | off             | try                   | DDR5 + EPYC поддерживают    |

**ДОБАВИТЬ: PgBouncer**

| Параметр          | Значение    | Причина                                              |
| ----------------- | ----------- | ---------------------------------------------------- |
| pool_mode         | transaction | FastAPI использует async, каждый запрос — транзакция |
| default_pool_size | 25          | Достаточно для backend + celery                      |
| min_pool_size     | 10          | Тёплые соединения                                    |
| reserve_pool_size | 5           | Для пиков                                            |
| max_client_conn   | 500         | Backend (4 workers × 20 pool) + Celery (8 × 20)      |

**Причины добавить PgBouncer:**

- Каждое PostgreSQL соединение = ~10 МБ RAM + отдельный процесс
- При 100 соединениях — 1 ГБ впустую
- PgBouncer позволит 500 клиентских соединений через 25 реальных
- Экономия ~750 МБ RAM

---

### 6. Оркестрация: Docker Compose — ОСТАВИТЬ

| Критерий      | Docker Compose       | Podman Compose | Kubernetes          |
| ------------- | -------------------- | -------------- | ------------------- |
| Overhead      | ~50 МБ               | ~30 МБ         | 2-4 ГБ              |
| Rootless      | Docker 27+ (ок)      | Нативный       | Нативный            |
| systemd       | Через restart policy | Нативный       | —                   |
| Ecosystem     | Огромный             | Растущий       | Огромный            |
| Single server | Отлично              | Отлично        | Overkill            |
| Compose files | Текущие работают     | Совместимы     | Надо конвертировать |

**Рекомендация: ОСТАВИТЬ Docker Compose**

**Причины:**

- Single server → Kubernetes overkill (2-4 ГБ RAM на control plane)
- 9 вариантов docker-compose файлов уже написаны
- Docker 27+ поддерживает rootless mode
- Podman Compose интересен, но экосистема меньше и переход рискован при миграции

**Улучшения:**

- Включить Docker rootless mode
- Добавить CPU limits (deploy.resources.limits.cpus)
- Health checks для ВСЕХ сервисов (сейчас backup без health check)
- Logging driver: json-file с ротацией (max-size: 10m, max-file: 5)

---

### 7. Мониторинг: Prometheus + Grafana → VictoriaMetrics + Grafana

| Критерий               | Prometheus                 | VictoriaMetrics             |
| ---------------------- | -------------------------- | --------------------------- |
| RAM usage              | Высокий (high cardinality) | В 3-7 раз ниже              |
| Disk usage             | Baseline                   | В 7-70 раз меньше           |
| Long-term storage      | Нет (нужен Thanos)         | Встроен                     |
| Pull + Push            | Pull only (+Pushgateway)   | Оба нативно                 |
| PromQL                 | Нативный                   | 100% совместим + расширения |
| Grafana                | Да                         | Да (тот же datasource)      |
| Operational complexity | Средняя                    | Один бинарник               |

**Рекомендация: ЗАМЕНИТЬ Prometheus на VictoriaMetrics**

**Причины:**

- Один бинарник вместо Prometheus + Pushgateway
- В 3-7 раз меньше RAM — значимо для single-server
- PromQL совместимость — Grafana dashboards работают без изменений
- Встроенное long-term storage (текущие 200 часов retention — мало)

**Миграция:** Заменить Prometheus на VictoriaMetrics в docker-compose.monitoring.yml. Grafana datasource → VictoriaMetrics (Prometheus-совместимый endpoint).

---

### 8. Бэкапы: pg_dump → pgBackRest

| Критерий       | Текущий (pg_dump + tar.gz) | pgBackRest                    | WAL-G                  |
| -------------- | -------------------------- | ----------------------------- | ---------------------- |
| Тип бэкапа     | Logical (full only)        | Physical (full + diff + incr) | Physical (full + incr) |
| PITR           | Нет                        | Да                            | Да                     |
| Параллельность | Нет                        | Да (multi-process)            | Ограниченная           |
| S3-compatible  | Нет (локально)             | Да (MinIO, Ceph, etc.)        | Да                     |
| Compression    | gzip                       | zstd, lz4, gzip               | lz4, zstd              |
| Retention      | 7 дней                     | Гибкая                        | Гибкая                 |
| Restore speed  | Медленный (full restore)   | Быстрый (incremental)         | Быстрый                |

**Рекомендация: ЗАМЕНИТЬ на pgBackRest**

**Причины:**

- PITR (Point-in-Time Recovery) — можно восстановить до конкретной секунды, а не только до дневного дампа
- Инкрементальные бэкапы — после первого полного, последующие в 10-100 раз быстрее
- S3-compatible storage — бэкапы off-site (MinIO локально + vdsina S3 если доступен)
- zstd компрессия — в 3-5 раз быстрее gzip при сравнимом сжатии
- Параллельный бэкап/восстановление — используем 12 ядер

**Миграция:** Добавить pgBackRest контейнер, настроить WAL archiving, убрать старый backup cron.

---

## Итоговая таблица рекомендаций

| #   | Компонент       | Текущее            | Рекомендация                 | Приоритет | Сложность | Риск    |
| --- | --------------- | ------------------ | ---------------------------- | --------- | --------- | ------- |
| 1   | Reverse Proxy   | Nginx 1.27         | **Caddy 2.x**                | P0        | Средняя   | Низкий  |
| 2   | ASGI Server     | Gunicorn + Uvicorn | **Granian**                  | P1        | Средняя   | Средний |
| 3   | Cache/Broker    | Redis 7.4          | **Valkey 8.x**               | P0        | Низкая    | Низкий  |
| 4   | Task Queue      | Celery 5.6         | **Оставить** (тюнинг)        | P1        | Низкая    | Низкий  |
| 5   | Database        | PostgreSQL 17      | **Оставить** (тюнинг 32 ГБ)  | P0        | Низкая    | Низкий  |
| 6   | Connection Pool | Нет                | **Добавить PgBouncer**       | P1        | Средняя   | Низкий  |
| 7   | Orchestration   | Docker Compose     | **Оставить** (улучшения)     | P2        | Низкая    | Низкий  |
| 8   | Monitoring      | Prometheus         | **VictoriaMetrics**          | P2        | Средняя   | Низкий  |
| 9   | Backups         | pg_dump + tar      | **pgBackRest + S3**          | P0        | Высокая   | Средний |
| 10  | SSL/TLS         | certbot + cron     | **Caddy auto** (входит в #1) | P0        | Нет       | Нет     |

---

## Распределение ресурсов: Новый сервер (32 ГБ / 12 CPU)

### RAM (32 ГБ)

| Сервис                       | RAM         | Примечание                     |
| ---------------------------- | ----------- | ------------------------------ |
| PostgreSQL                   | 10 ГБ       | shared_buffers 8 ГБ + overhead |
| Valkey                       | 2 ГБ        | maxmemory 1.5 ГБ + overhead    |
| Backend (Granian, 4 workers) | 4 ГБ        | ~1 ГБ per worker               |
| Celery Workers (8)           | 8 ГБ        | ~1 ГБ per worker               |
| Celery Beat                  | 256 МБ      | Минимальный                    |
| PgBouncer                    | 128 МБ      | Лёгкий                         |
| Caddy                        | 128 МБ      | Лёгкий                         |
| Frontend (static files)      | 128 МБ      | Отдаётся через Caddy           |
| VictoriaMetrics + Grafana    | 1.5 ГБ      | Мониторинг                     |
| pgBackRest                   | 512 МБ      | При бэкапе                     |
| OS + Docker                  | 3 ГБ        | Система + файловый кэш         |
| **Запас**                    | **~2.5 ГБ** | Резерв для пиков               |

### CPU (12 ядер)

| Сервис                           | CPU cores | Примечание             |
| -------------------------------- | --------- | ---------------------- |
| PostgreSQL                       | 4         | max_parallel_workers=4 |
| Granian (4 workers × 2 threads)  | 3         | Backend API            |
| Celery Workers (8)               | 4         | Фоновые задачи         |
| Caddy + VictoriaMetrics + system | 1         | Лёгкие сервисы         |

---

## Зависимости: что НЕ менять

### Backend Python зависимости — оставить:

| Зависимость  | Версия  | Статус                | Причина                |
| ------------ | ------- | --------------------- | ---------------------- |
| FastAPI      | 0.128.0 | Актуальная (Feb 2026) | Лидер ASGI фреймворков |
| SQLAlchemy   | 2.0.46  | Актуальная            | Лучший ORM для Python  |
| Pydantic     | 2.12.5  | Актуальная            | Стандарт валидации     |
| google-genai | 1.61.0  | Актуальная (Jan 2026) | Gemini API             |
| Sentry SDK   | 2.51.0  | Актуальная            | Мониторинг ошибок      |
| tenacity     | 9.1.2   | Актуальная            | Retries                |
| httpx        | 0.28.1  | Актуальная            | Async HTTP             |

### Frontend зависимости — оставить:

| Зависимость    | Версия  | Статус               | Причина                 |
| -------------- | ------- | -------------------- | ----------------------- |
| React          | 19.0.0  | Актуальная           | Лидер                   |
| Vite           | 7.3.1   | Актуальная           | Лучший bundler          |
| TanStack Query | 5.90.12 | Актуальная           | Data fetching стандарт  |
| Tailwind CSS   | 4.1.18  | Актуальная           | Utility-first CSS       |
| epub.js        | 0.3.93  | Единственный вариант | Нет альтернатив для веб |
| Zustand        | 5.0.10  | Актуальная           | Лёгкий state management |

---

## Файлы пользователей: защита от случайного удаления

### Текущая проблема

Файлы пользователей (загруженные книги, обложки) хранятся в Docker volumes. При `docker compose down -v` или пересоздании контейнера — данные могут быть потеряны.

### Решение: 3 уровня защиты

**Уровень 1: Named volumes с bind mounts**

```yaml
volumes:
  user-uploads:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/fancai/uploads # Вне Docker root

  postgres-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/fancai/postgres
```

**Уровень 2: Защита от docker compose down -v**

```bash
# /data/fancai/ — отдельная директория, не управляемая Docker
# chattr +i на критических директориях (immutable flag)
sudo chattr +i /data/fancai/uploads
sudo chattr +i /data/fancai/postgres
```

**Уровень 3: Автоматические бэкапы**

- pgBackRest для PostgreSQL (PITR)
- Ежедневная синхронизация /data/fancai/uploads на S3-compatible storage
- Retention: 30 дней для бэкапов, 7 дней для WAL

---

## План миграции (высокоуровневый)

### Phase 0: Подготовка (до переезда)

1. Создать новый docker-compose.prod.yml с Caddy + Valkey + PgBouncer
2. Протестировать Granian с текущим кодом локально
3. Настроить pgBackRest локально
4. Подготовить PostgreSQL конфиг под 32 ГБ

### Phase 1: Настройка нового сервера

1. Установить Docker (rootless mode)
2. Создать /data/fancai/ структуру
3. Настроить firewall (ufw)
4. Развернуть инфраструктуру без данных

### Phase 2: Миграция данных

1. pg_dump на старом сервере → pg_restore на новом
2. rsync файлов пользователей
3. Настроить DNS (A-запись → новый IP)
4. Проверить SSL (Caddy автоматически получит сертификат)

### Phase 3: Проверка и оптимизация

1. Нагрузочное тестирование
2. Мониторинг (VictoriaMetrics + Grafana)
3. Настройка alerting
4. Проверка бэкапов (restore test)

---

## Источники

### Reverse Proxy

- [Reverse Proxy Comparison: Traefik vs Caddy vs Nginx](https://www.programonaut.com/reverse-proxies-compared-traefik-vs-caddy-vs-nginx-docker/)
- [Benchmarking Caddy vs Nginx](https://blog.tjll.net/reverse-proxy-hot-dog-eating-contest-caddy-vs-nginx/)
- [Traefik Performance Discussion](https://community.traefik.io/t/traefik-performance-lags-behind-nginx-and-caddy/28919)
- [Nginx vs Caddy vs Traefik Benchmark Results](https://homelabsec.com/posts/nginx-vs-caddy-vs-traefik-benchmark-results/)

### ASGI Servers

- [Python Application Servers in 2025](https://www.deployhq.com/blog/python-application-servers-in-2025-from-wsgi-to-modern-asgi-solutions)
- [Granian on PyPI](https://pypi.org/project/granian/)
- [FastAPI Production Deployment Best Practices](https://render.com/articles/fastapi-production-deployment-best-practices)

### Redis Alternatives

- [Valkey vs Redis 2025](https://www.dragonflydb.io/guides/valkey-vs-redis)
- [Valkey Key Features 2026](https://www.dragonflydb.io/guides/valkey-key-features-pros-cons-and-comparison-with-redis)
- [Redis 8.0 vs Valkey 8.1](https://www.dragonflydb.io/blog/redis-8-0-vs-valkey-8-1-a-technical-comparison)
- [Dragonfly vs Redis](https://martinuke0.github.io/posts/2025-12-11-dragonfly-vs-redis-a-practical-data-backed-comparison-for-2025/)

### Task Queues

- [Python Background Tasks 2025](https://devproportal.com/languages/python/python-background-tasks-celery-rq-dramatiq-comparison-2025/)
- [Taskiq GitHub](https://github.com/taskiq-python/taskiq)
- [Celery vs Temporal](https://dasroot.net/posts/2026/02/orchestrating-ai-tasks-celery-temporal/)
- [TaskIQ — The Celery for FastAPI](https://www.nahid.link/posts/taskiq-the-celery-for-fastapi)

### PostgreSQL

- [How to Tune PostgreSQL for Memory](https://www.enterprisedb.com/postgres-tutorials/how-tune-postgresql-memory)
- [PostgreSQL Performance Tuning 2026](https://oneuptime.com/blog/post/2026-02-20-postgresql-performance-tuning/view)
- [PgBouncer Connection Pooling](https://oneuptime.com/blog/post/2026-01-26-pgbouncer-connection-pooling/view)

### Docker & Containers

- [Podman vs Docker 2026](https://last9.io/blog/podman-vs-docker/)
- [Docker vs Podman 2025 Benchmarks](https://sanj.dev/post/container-runtime-showdown-2025)

### Monitoring

- [Prometheus vs VictoriaMetrics](https://last9.io/blog/prometheus-vs-victoriametrics/)
- [VictoriaMetrics](https://victoriametrics.com/)

### Backups

- [pgBackRest vs Barman](https://severalnines.com/blog/automating-backups-and-disaster-recovery-in-postgresql-at-scale-pgbackrest-vs-barman/)
- [Top 5 PostgreSQL Backup Tools 2025](https://dev.to/rostislav_dugin/top-5-postgresql-backup-tools-in-2025-5801)

### SSL/TLS

- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Docker Caddy Automatic HTTPS 2026](https://oneuptime.com/blog/post/2026-01-16-docker-caddy-automatic-https/view)
