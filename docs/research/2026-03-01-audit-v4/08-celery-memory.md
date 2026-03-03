# Celery Memory Limits и найденные баги

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секции 9, 13

---

## Часть 1: Celery Memory Limits

### 1.1 Найденные проблемы

**Inconsistency across configs:**

| Файл                                 | max-memory-per-child | concurrency |
| ------------------------------------ | -------------------- | ----------- |
| `celery_app.py` (код)                | 150MB                | не задано   |
| `docker-compose.lite.prod.yml` (CLI) | 400MB                | 4           |
| `docker-compose.staging.yml` (CLI)   | 300MB                | 1           |

CLI переопределяет код. Три разных значения в трёх файлах.

**`celery_config.py` — мёртвый код:** содержит NLP-эра настройки, не импортируется в `celery_app.py`.

### 1.2 Рекомендуемые значения для нового сервера

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

### 1.3 Распределение RAM на 32GB сервере

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

### 1.4 Новая настройка Celery 5.6

```python
worker_cancel_long_running_tasks_on_connection_loss=True  # Подготовка к Celery 6.0
```

---

## Часть 2: Найденные баги

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

- [Celery Workers Guide](https://docs.celeryq.dev/en/stable/userguide/workers.html)
- [Celery Optimizing Guide](https://docs.celeryq.dev/en/stable/userguide/optimizing.html)
- [Celery Execution Pools](https://celery.school/celery-worker-pools)
