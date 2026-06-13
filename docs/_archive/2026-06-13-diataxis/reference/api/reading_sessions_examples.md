# Reading Sessions - Примеры использования

## Описание

Модель `ReadingSession` используется для детальной аналитики активности чтения пользователей.

## Структура таблицы

```sql
CREATE TABLE reading_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

    -- Временные рамки сессии
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 0,

    -- Прогресс за сессию
    start_position INTEGER NOT NULL DEFAULT 0,  -- 0-100%
    end_position INTEGER NOT NULL DEFAULT 0,    -- 0-100%
    pages_read INTEGER NOT NULL DEFAULT 0,

    -- Метаданные
    device_type VARCHAR(50) NULL,  -- 'mobile', 'tablet', 'desktop'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

## Индексы

```sql
-- Поиск сессий пользователя (сортировка по дате)
CREATE INDEX idx_reading_sessions_user_started
ON reading_sessions(user_id, started_at);

-- Поиск сессий по книге
CREATE INDEX idx_reading_sessions_book
ON reading_sessions(book_id, started_at);

-- Partial index для активных сессий (WHERE is_active = true)
CREATE INDEX idx_reading_sessions_active
ON reading_sessions(user_id, is_active)
WHERE is_active = true;

-- Composite index для weekly analytics
CREATE INDEX idx_reading_sessions_weekly
ON reading_sessions(user_id, started_at, duration_minutes);
```

## Python API

### Создание новой сессии

```python
from app.models import ReadingSession
from datetime import datetime, timezone
import uuid

# Создание сессии при открытии книги
async def start_reading_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    book_id: uuid.UUID,
    start_position: int,
    device_type: str = "desktop"
) -> ReadingSession:
    """Начать новую сессию чтения."""
    session = ReadingSession(
        user_id=user_id,
        book_id=book_id,
        start_position=start_position,
        device_type=device_type,
        is_active=True
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session
```

### Завершение сессии

```python
async def end_reading_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    end_position: int
) -> ReadingSession:
    """Завершить активную сессию чтения."""
    stmt = select(ReadingSession).where(ReadingSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one()

    # Используем метод модели
    session.end_session(end_position)

    await db.commit()
    await db.refresh(session)
    return session
```

### Получение активной сессии пользователя

```python
from sqlalchemy import select

async def get_active_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    book_id: uuid.UUID
) -> ReadingSession | None:
    """Получить активную сессию чтения для книги."""
    stmt = (
        select(ReadingSession)
        .where(
            ReadingSession.user_id == user_id,
            ReadingSession.book_id == book_id,
            ReadingSession.is_active == True
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
```

## SQL Запросы для аналитики

### Weekly Activity - Недельная активность пользователя

```sql
-- Статистика чтения по дням недели за последние 30 дней
SELECT
    DATE_TRUNC('day', started_at) AS reading_date,
    COUNT(*) AS sessions_count,
    SUM(duration_minutes) AS total_minutes,
    ROUND(AVG(duration_minutes), 2) AS avg_session_duration,
    SUM(end_position - start_position) AS total_progress_percent
FROM reading_sessions
WHERE
    user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND started_at >= NOW() - INTERVAL '30 days'
    AND is_active = false  -- только завершенные сессии
GROUP BY DATE_TRUNC('day', started_at)
ORDER BY reading_date DESC;
```

### Weekly Activity по дням недели (паттерны)

```sql
-- Анализ активности по дням недели (понедельник-воскресенье)
SELECT
    EXTRACT(DOW FROM started_at) AS day_of_week,  -- 0=Sunday, 6=Saturday
    CASE EXTRACT(DOW FROM started_at)
        WHEN 0 THEN 'Воскресенье'
        WHEN 1 THEN 'Понедельник'
        WHEN 2 THEN 'Вторник'
        WHEN 3 THEN 'Среда'
        WHEN 4 THEN 'Четверг'
        WHEN 5 THEN 'Пятница'
        WHEN 6 THEN 'Суббота'
    END AS day_name,
    COUNT(*) AS sessions_count,
    SUM(duration_minutes) AS total_minutes,
    ROUND(AVG(duration_minutes), 2) AS avg_duration,
    SUM(end_position - start_position) AS total_progress
FROM reading_sessions
WHERE
    user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND started_at >= NOW() - INTERVAL '30 days'
    AND is_active = false
GROUP BY EXTRACT(DOW FROM started_at)
ORDER BY day_of_week;
```

### Самые читаемые книги за неделю

```sql
-- Топ-5 книг по времени чтения за последнюю неделю
SELECT
    b.title,
    b.author,
    COUNT(rs.id) AS sessions_count,
    SUM(rs.duration_minutes) AS total_minutes,
    ROUND(AVG(rs.duration_minutes), 2) AS avg_session_duration,
    MAX(rs.ended_at) AS last_read_at
FROM reading_sessions rs
JOIN books b ON rs.book_id = b.id
WHERE
    rs.user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND rs.started_at >= NOW() - INTERVAL '7 days'
    AND rs.is_active = false
GROUP BY b.id, b.title, b.author
ORDER BY total_minutes DESC
LIMIT 5;
```

### Reading Streaks - Серии чтения

```sql
-- Подсчет серий последовательных дней чтения
WITH daily_reading AS (
    SELECT DISTINCT DATE(started_at) AS reading_day
    FROM reading_sessions
    WHERE
        user_id = '550e8400-e29b-41d4-a716-446655440000'
        AND is_active = false
    ORDER BY reading_day
),
streaks AS (
    SELECT
        reading_day,
        reading_day - (ROW_NUMBER() OVER (ORDER BY reading_day))::INTEGER AS streak_id
    FROM daily_reading
)
SELECT
    MIN(reading_day) AS streak_start,
    MAX(reading_day) AS streak_end,
    COUNT(*) AS streak_length
FROM streaks
GROUP BY streak_id
ORDER BY streak_length DESC
LIMIT 10;
```

### Device Usage Statistics

```sql
-- Статистика использования по типам устройств
SELECT
    COALESCE(device_type, 'unknown') AS device,
    COUNT(*) AS sessions_count,
    SUM(duration_minutes) AS total_minutes,
    ROUND(AVG(duration_minutes), 2) AS avg_duration,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM reading_sessions
WHERE
    user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND started_at >= NOW() - INTERVAL '30 days'
    AND is_active = false
GROUP BY device_type
ORDER BY sessions_count DESC;
```

### Reading Hours Heatmap

```sql
-- Анализ активности по часам дня
SELECT
    EXTRACT(HOUR FROM started_at) AS hour_of_day,
    COUNT(*) AS sessions_count,
    SUM(duration_minutes) AS total_minutes,
    ROUND(AVG(duration_minutes), 2) AS avg_duration
FROM reading_sessions
WHERE
    user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND started_at >= NOW() - INTERVAL '30 days'
    AND is_active = false
GROUP BY EXTRACT(HOUR FROM started_at)
ORDER BY hour_of_day;
```

### Average Reading Speed

```sql
-- Средняя скорость чтения (% книги за минуту)
SELECT
    b.title,
    COUNT(rs.id) AS sessions_count,
    SUM(rs.duration_minutes) AS total_minutes,
    SUM(rs.end_position - rs.start_position) AS total_progress,
    ROUND(
        CAST(SUM(rs.end_position - rs.start_position) AS DECIMAL) /
        NULLIF(SUM(rs.duration_minutes), 0),
        3
    ) AS avg_speed_ppm  -- процентов за минуту
FROM reading_sessions rs
JOIN books b ON rs.book_id = b.id
WHERE
    rs.user_id = '550e8400-e29b-41d4-a716-446655440000'
    AND rs.is_active = false
    AND rs.duration_minutes > 0
GROUP BY b.id, b.title
ORDER BY avg_speed_ppm DESC;
```

## Python аналитика

### Weekly Activity с SQLAlchemy

```python
from sqlalchemy import func, select, extract
from datetime import datetime, timedelta, timezone

async def get_weekly_activity(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 30
) -> list[dict]:
    """
    Получить недельную активность чтения.

    Returns:
        Список словарей с данными по каждому дню:
        {
            'date': '2025-10-27',
            'sessions_count': 5,
            'total_minutes': 120,
            'avg_duration': 24.0,
            'total_progress': 15
        }
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    stmt = (
        select(
            func.date_trunc('day', ReadingSession.started_at).label('reading_date'),
            func.count(ReadingSession.id).label('sessions_count'),
            func.sum(ReadingSession.duration_minutes).label('total_minutes'),
            func.round(func.avg(ReadingSession.duration_minutes), 2).label('avg_duration'),
            func.sum(
                ReadingSession.end_position - ReadingSession.start_position
            ).label('total_progress')
        )
        .where(
            ReadingSession.user_id == user_id,
            ReadingSession.started_at >= cutoff_date,
            ReadingSession.is_active == False
        )
        .group_by(func.date_trunc('day', ReadingSession.started_at))
        .order_by(func.date_trunc('day', ReadingSession.started_at).desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            'date': row.reading_date.date().isoformat(),
            'sessions_count': row.sessions_count,
            'total_minutes': row.total_minutes or 0,
            'avg_duration': float(row.avg_duration or 0),
            'total_progress': row.total_progress or 0
        }
        for row in rows
    ]
```

### Day of Week Pattern

```python
async def get_day_of_week_pattern(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: int = 30
) -> list[dict]:
    """
    Анализ паттернов чтения по дням недели.

    Returns:
        Статистика для каждого дня недели (0=Sunday, 6=Saturday)
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    stmt = (
        select(
            extract('dow', ReadingSession.started_at).label('day_of_week'),
            func.count(ReadingSession.id).label('sessions_count'),
            func.sum(ReadingSession.duration_minutes).label('total_minutes'),
            func.round(func.avg(ReadingSession.duration_minutes), 2).label('avg_duration')
        )
        .where(
            ReadingSession.user_id == user_id,
            ReadingSession.started_at >= cutoff_date,
            ReadingSession.is_active == False
        )
        .group_by(extract('dow', ReadingSession.started_at))
        .order_by(extract('dow', ReadingSession.started_at))
    )

    result = await db.execute(stmt)
    rows = result.all()

    day_names = [
        'Воскресенье', 'Понедельник', 'Вторник', 'Среда',
        'Четверг', 'Пятница', 'Суббота'
    ]

    return [
        {
            'day_of_week': int(row.day_of_week),
            'day_name': day_names[int(row.day_of_week)],
            'sessions_count': row.sessions_count,
            'total_minutes': row.total_minutes or 0,
            'avg_duration': float(row.avg_duration or 0)
        }
        for row in rows
    ]
```

## Использование методов модели

### Метод end_session()

```python
session = await get_active_session(db, user_id, book_id)
if session:
    # Завершаем сессию на позиции 75%
    session.end_session(end_position=75)
    await db.commit()

    print(f"Сессия длилась {session.duration_minutes} минут")
    print(f"Прогресс за сессию: {session.get_progress_delta()}%")
```

### Метод get_progress_delta()

```python
# Получить прогресс за сессию
delta = session.get_progress_delta()
if delta > 0:
    print(f"Прочитано {delta}% книги")
elif delta < 0:
    print(f"Листал назад на {abs(delta)}%")
else:
    print("Прогресса не было")
```

### Метод get_reading_speed_ppm()

```python
# Вычислить скорость чтения
speed = session.get_reading_speed_ppm()
print(f"Скорость: {speed:.2f}% книги за минуту")

# Пример: 0.83% за минуту = ~120 минут на 100% книги
estimated_time = 100 / speed if speed > 0 else 0
print(f"Примерное время на книгу: {estimated_time:.0f} минут")
```

### Метод is_valid_session()

```python
# Фильтрация валидных сессий для аналитики
sessions = await get_all_sessions(db, user_id)
valid_sessions = [s for s in sessions if s.is_valid_session(min_duration_minutes=2)]

print(f"Всего сессий: {len(sessions)}")
print(f"Валидных для аналитики: {len(valid_sessions)}")
```

## Integration с Reading Progress

```python
async def sync_progress_with_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    book_id: uuid.UUID,
    current_position: int
) -> ReadingSession:
    """
    Синхронизация ReadingProgress с ReadingSession.

    Автоматически создает или обновляет сессию при изменении прогресса.
    """
    # Получаем активную сессию
    active_session = await get_active_session(db, user_id, book_id)

    if not active_session:
        # Начинаем новую сессию
        active_session = ReadingSession(
            user_id=user_id,
            book_id=book_id,
            start_position=current_position,
            device_type="desktop"  # получить из request headers
        )
        db.add(active_session)

    # Обновляем reading_progress
    from app.models import ReadingProgress
    stmt = select(ReadingProgress).where(
        ReadingProgress.user_id == user_id,
        ReadingProgress.book_id == book_id
    )
    result = await db.execute(stmt)
    progress = result.scalar_one_or_none()

    if progress:
        progress.current_position = current_position
        progress.last_read_at = datetime.now(timezone.utc)

    await db.commit()
    return active_session
```

## Best Practices

1. **Автоматическое закрытие сессий:**
   - Запускать периодическую задачу для закрытия "забытых" активных сессий (>30 минут без активности)

2. **Фильтрация валидных сессий:**
   - Использовать `is_valid_session()` для фильтрации слишком коротких сессий (<1 минута)
   - Игнорировать сессии без прогресса для аналитики скорости чтения

3. **Device detection:**
   - Определять `device_type` из User-Agent header
   - Категории: "mobile", "tablet", "desktop"

4. **Производительность:**
   - Использовать composite индексы для weekly analytics
   - Кэшировать результаты аналитики на 5-10 минут
   - Использовать pagination для больших выборок

5. **Data cleanup:**
   - Удалять или архивировать очень старые сессии (>1 год)
   - Хранить агрегированную статистику отдельно
