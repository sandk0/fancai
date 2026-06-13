# Celery Tasks Documentation

Документация по фоновым задачам (Celery tasks) в BookReader AI.

## Оглавление

1. [Обзор](#обзор)
2. [Архитектура](#архитектура)
3. [Задачи](#задачи)
4. [Мониторинг](#мониторинг)
5. [Troubleshooting](#troubleshooting)

---

## Обзор

BookReader AI использует **Celery** для выполнения фоновых задач:

- **Broker**: Redis (очередь задач)
- **Backend**: Redis (хранение результатов)
- **Beat Scheduler**: Celery Beat (периодические задачи)
- **Workers**: Celery Worker (исполнители задач)

### Категории задач

| Категория | Очередь | Приоритет | Примеры |
|-----------|---------|-----------|---------|
| Heavy | `heavy` | 5 | Парсинг книг, NLP обработка |
| Normal | `normal` | 3 | Генерация изображений |
| Light | `light` | 1-2 | Cleanup задачи, мониторинг |

---

## Архитектура

### Конфигурация Celery

**Файл:** `backend/app/core/celery_app.py`

```python
celery_app = Celery(
    "bookreader",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.core.tasks", "app.tasks.reading_sessions_tasks"],
)
```

### Beat Schedule

Периодические задачи запускаются автоматически по расписанию:

```python
beat_schedule={
    "close-abandoned-reading-sessions": {
        "task": "app.tasks.close_abandoned_sessions",
        "schedule": 1800.0,  # Каждые 30 минут
        "options": {
            "queue": "light",
            "priority": 2,
        },
    },
}
```

---

## Задачи

### 1. Close Abandoned Reading Sessions

**Модуль:** `app/tasks/reading_sessions_tasks.py`

**Назначение:** Автоматическое закрытие заброшенных reading sessions

#### Описание

Закрывает активные сессии чтения где:
- `is_active=True`
- Прошло более **2 часов** с `started_at`
- `ended_at IS NULL`

Для каждой заброшенной сессии:
- Устанавливает `is_active=False`
- Устанавливает `ended_at=now()`
- Устанавливает `end_position=start_position` (если не было прогресса)
- Вычисляет `duration_minutes`

#### Конфигурация

```python
@celery_app.task(
    name="app.tasks.close_abandoned_sessions",
    bind=True,
    max_retries=3,
    default_retry_delay=300,  # 5 минут
)
```

**Параметры:**
- **max_retries**: 3 попытки при ошибках
- **default_retry_delay**: 5 минут между попытками
- **Расписание**: Каждые 30 минут (1800 секунд)
- **Очередь**: `light`
- **Приоритет**: 2

#### Пример ручного запуска

```python
# Синхронно (ждёт результата)
from app.tasks.reading_sessions_tasks import close_abandoned_sessions
result = close_abandoned_sessions.apply_async()
print(result.get(timeout=30))
# Output: {"closed_count": 15, "execution_time_ms": 234.5, "deadline": "2025-10-28T10:30:00Z"}

# Асинхронно (не ждёт)
task = close_abandoned_sessions.delay()
print(f"Task ID: {task.id}")
```

#### Возвращаемое значение

```json
{
    "closed_count": 15,
    "execution_time_ms": 234.5,
    "deadline": "2025-10-28T10:30:00+00:00",
    "error": null
}
```

#### Логирование

```python
# INFO - успешное выполнение
logger.info(f"Closed {closed_count} abandoned sessions in {execution_time_ms:.2f}ms")

# DEBUG - детали по каждой сессии
logger.debug(f"Closed session {session.id} for user {session.user_id}, book {session.book_id}")

# WARNING - ошибка при закрытии конкретной сессии
logger.warning(f"Failed to close session {session.id}: {e}")

# ERROR - критическая ошибка
logger.error(f"Error closing abandoned sessions: {error_message}", exc_info=True)
```

---

### 2. Get Cleanup Statistics

**Модуль:** `app/tasks/reading_sessions_tasks.py`

**Назначение:** Получение статистики по закрытым сессиям

#### Описание

Возвращает аналитику за последние N часов:
- Количество закрытых сессий
- Количество активных сессий
- Средняя длительность сессий
- Количество сессий без прогресса

#### Пример использования

```python
from app.tasks.reading_sessions_tasks import get_cleanup_statistics

# За последние 24 часа
stats = get_cleanup_statistics.apply_async(args=[24])
result = stats.get(timeout=10)

print(result)
# Output:
# {
#     "total_closed": 150,
#     "total_active": 45,
#     "avg_duration_minutes": 23.5,
#     "no_progress_count": 12,
#     "period_hours": 24,
#     "timestamp": "2025-10-28T12:00:00+00:00"
# }
```

#### Возвращаемое значение

```json
{
    "total_closed": 150,
    "total_active": 45,
    "avg_duration_minutes": 23.5,
    "no_progress_count": 12,
    "period_hours": 24,
    "timestamp": "2025-10-28T12:00:00+00:00"
}
```

---

## Мониторинг

### Admin API Endpoints

#### 1. GET /admin/reading-sessions/cleanup-stats

Получить статистику cleanup задачи.

**Параметры:**
- `hours` (int, optional): Период анализа в часах (1-168, default=24)

**Пример запроса:**

```bash
curl -X GET "http://localhost:8000/api/v1/admin/reading-sessions/cleanup-stats?hours=24" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Ответ:**

```json
{
    "total_closed": 150,
    "total_active": 45,
    "avg_duration_minutes": 23.5,
    "no_progress_count": 12,
    "period_hours": 24,
    "timestamp": "2025-10-28T12:00:00+00:00"
}
```

---

#### 2. POST /admin/reading-sessions/cleanup

Вручную запустить cleanup задачу (синхронно).

**Пример запроса:**

```bash
curl -X POST "http://localhost:8000/api/v1/admin/reading-sessions/cleanup" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Ответ:**

```json
{
    "closed_count": 15,
    "execution_time_ms": 234.5,
    "deadline": "2025-10-28T10:30:00+00:00",
    "error": null
}
```

---

#### 3. POST /admin/reading-sessions/cleanup-async

Запустить cleanup задачу асинхронно (не ждёт результата).

**Пример запроса:**

```bash
curl -X POST "http://localhost:8000/api/v1/admin/reading-sessions/cleanup-async" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Ответ:**

```json
{
    "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "PENDING",
    "message": "Cleanup task started with ID: a1b2c3d4-... Check status via Flower or Celery API."
}
```

---

### Мониторинг через Flower

**Flower** - веб-интерфейс для мониторинга Celery задач.

#### Запуск Flower

```bash
# В отдельном терминале
celery -A app.core.celery_app flower --port=5555

# Или через Docker
docker-compose exec celery-worker celery -A app.core.celery_app flower --port=5555
```

#### Доступ

```
http://localhost:5555
```

#### Возможности

- **Tasks**: Список всех задач (active, scheduled, failed)
- **Workers**: Статус worker'ов
- **Monitor**: Real-time графики
- **Broker**: Информация о Redis queues

#### Примеры API

```bash
# Информация о задаче
curl http://localhost:5555/api/task/info/a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Список активных задач
curl http://localhost:5555/api/tasks

# Статус worker'ов
curl http://localhost:5555/api/workers
```

---

### Мониторинг через Celery CLI

#### Проверка активных задач

```bash
celery -A app.core.celery_app inspect active
```

**Вывод:**

```json
{
  "celery@worker1": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "app.tasks.close_abandoned_sessions",
      "args": [],
      "kwargs": {},
      "time_start": 1698500000.0,
      "acknowledged": true,
      "delivery_info": {
        "exchange": "light",
        "routing_key": "light.cleanup"
      }
    }
  ]
}
```

#### Проверка scheduled задач

```bash
celery -A app.core.celery_app inspect scheduled
```

#### Проверка зарегистрированных задач

```bash
celery -A app.core.celery_app inspect registered
```

**Вывод:**

```
- app.tasks.close_abandoned_sessions
- app.tasks.get_cleanup_statistics
- app.core.tasks.process_book_task
- app.core.tasks.generate_image_task
```

#### Статус worker'ов

```bash
celery -A app.core.celery_app inspect stats
```

---

### Логи

#### Просмотр логов Celery Worker

```bash
# Docker
docker-compose logs -f celery-worker

# Локально
tail -f logs/celery_worker.log
```

#### Примеры логов

**Успешное выполнение:**

```
[2025-10-28 12:00:00,123: INFO/MainProcess] Starting close_abandoned_sessions task
[2025-10-28 12:00:00,456: INFO/MainProcess] Found 15 abandoned sessions
[2025-10-28 12:00:00,789: DEBUG/MainProcess] Closed session abc123 for user user456, book book789, duration 125min
[2025-10-28 12:00:01,012: INFO/MainProcess] Successfully closed 15/15 sessions
[2025-10-28 12:00:01,234: INFO/MainProcess] Closed 15 abandoned sessions in 1111.00ms
[2025-10-28 12:00:01,345: INFO/MainProcess] Task app.tasks.close_abandoned_sessions[task-id] succeeded in 1.2s
```

**Ошибка при выполнении:**

```
[2025-10-28 12:00:00,123: INFO/MainProcess] Starting close_abandoned_sessions task
[2025-10-28 12:00:00,456: ERROR/MainProcess] Error closing abandoned sessions: Database connection failed
[2025-10-28 12:00:00,789: WARNING/MainProcess] Retrying task in 300s (attempt 1/3)
```

---

## Troubleshooting

### Проблема: Задача не запускается автоматически

**Симптомы:**
- Celery Beat не запускает периодические задачи
- `close_abandoned_sessions` не выполняется каждые 30 минут

**Решение:**

1. Проверить, что Celery Beat запущен:

```bash
# Docker
docker-compose ps | grep celery-beat

# Должно быть:
# celery-beat    celery -A app.core.celery_app beat    Up
```

2. Проверить логи Beat:

```bash
docker-compose logs celery-beat
```

3. Проверить beat schedule:

```bash
celery -A app.core.celery_app inspect scheduled
```

4. Удалить старый `celerybeat-schedule` файл:

```bash
rm backend/celerybeat-schedule
docker-compose restart celery-beat
```

---

### Проблема: Задача выполняется слишком долго

**Симптомы:**
- Timeout errors в логах
- `SoftTimeLimitExceeded` exceptions

**Решение:**

1. Увеличить time limits:

```python
# backend/app/tasks/reading_sessions_tasks.py
@celery_app.task(
    task_soft_time_limit=1800,  # 30 минут
    task_time_limit=2100,  # 35 минут
)
```

2. Оптимизировать запрос к БД (добавить индексы):

```sql
CREATE INDEX idx_reading_sessions_cleanup
ON reading_sessions (is_active, started_at)
WHERE is_active = true AND ended_at IS NULL;
```

---

### Проблема: Task результат не сохраняется

**Симптомы:**
- `result.get()` возвращает `None`
- Результаты задач не доступны

**Решение:**

1. Проверить, что result backend настроен:

```python
# backend/app/core/celery_app.py
celery_app = Celery(
    "bookreader",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,  # ← Должен быть установлен
)
```

2. Проверить TTL результатов:

```python
celery_app.conf.update(
    result_expires=3600,  # 1 час (увеличить если нужно)
)
```

3. Проверить Redis:

```bash
docker-compose exec redis redis-cli
> KEYS celery-task-meta-*
```

---

### Проблема: Слишком много памяти

**Симптомы:**
- Worker crashes из-за OOM
- `worker_max_memory_per_child` exceeded

**Решение:**

1. Уменьшить `worker_concurrency`:

```python
# backend/app/core/celery_app.py
worker_concurrency=1,  # По одной задаче
```

2. Уменьшить `worker_max_tasks_per_child`:

```python
worker_max_tasks_per_child=50,  # Перезапускать чаще
```

3. Включить prefetch limit:

```python
worker_prefetch_multiplier=1,  # Не брать задачи наперёд
```

---

### Проблема: Duplicate tasks

**Симптомы:**
- Одна и та же задача выполняется несколько раз
- Несколько worker'ов обрабатывают одну задачу

**Решение:**

1. Включить `task_acks_late`:

```python
task_acks_late=True,  # Подтверждать после завершения
```

2. Включить `task_reject_on_worker_lost`:

```python
task_reject_on_worker_lost=True,
```

3. Использовать idempotent tasks (задачи можно выполнять многократно):

```python
@celery_app.task(bind=True, max_retries=3)
def close_abandoned_sessions(self):
    # Идемпотентная логика: проверяем is_active перед закрытием
    if session.is_active:
        session.end_session(...)
```

---

## Best Practices

### 1. Всегда обрабатывайте исключения

```python
@celery_app.task(bind=True, max_retries=3)
def my_task(self):
    try:
        # ... логика задачи
    except Exception as e:
        logger.error(f"Task failed: {e}", exc_info=True)
        raise self.retry(exc=e, countdown=60)
```

### 2. Используйте async для БД операций

```python
import asyncio

@celery_app.task
def sync_task():
    result = asyncio.run(async_db_operation())
    return result

async def async_db_operation():
    async with get_session() as db:
        # ... async операции
```

### 3. Логируйте важную информацию

```python
logger.info(f"Task started: {self.request.id}")
logger.info(f"Processed {count} items in {duration}ms")
logger.error(f"Task failed: {error}", exc_info=True)
```

### 4. Используйте rate limiting

```python
@celery_app.task(rate_limit='10/m')  # Макс 10 задач в минуту
def rate_limited_task():
    pass
```

### 5. Cleanup старых результатов

```python
# В beat schedule
"cleanup-old-results": {
    "task": "app.tasks.cleanup_old_task_results",
    "schedule": crontab(hour=3, minute=0),  # Каждый день в 3:00
}
```

---

## Полезные команды

### Docker Commands

```bash
# Запуск всех Celery сервисов
docker-compose up -d celery-worker celery-beat

# Перезапуск worker
docker-compose restart celery-worker

# Просмотр логов
docker-compose logs -f celery-worker
docker-compose logs -f celery-beat

# Scale workers
docker-compose up -d --scale celery-worker=3

# Остановка всех worker'ов
docker-compose stop celery-worker celery-beat
```

### Celery Commands

```bash
# Проверка статуса
celery -A app.core.celery_app status

# Инспекция active задач
celery -A app.core.celery_app inspect active

# Purge всех задач из очереди
celery -A app.core.celery_app purge

# Список зарегистрированных задач
celery -A app.core.celery_app inspect registered

# Статистика по worker'ам
celery -A app.core.celery_app inspect stats
```

---

## Changelog

### 2025-10-28
- ✅ Создана задача `close_abandoned_sessions`
- ✅ Создана задача `get_cleanup_statistics`
- ✅ Добавлен beat schedule для автоматического запуска
- ✅ Созданы admin endpoints для мониторинга
- ✅ Добавлена документация

---

## См. также

- [Celery Documentation](https://docs.celeryproject.org/en/stable/)
- [Flower Documentation](https://flower.readthedocs.io/)
- [Redis Documentation](https://redis.io/docs/)
- [FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
