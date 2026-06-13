# Reading Statistics API

## Endpoint: GET /api/v1/reading-statistics

Детальная статистика чтения пользователя с weekly activity и reading streak.

---

## Описание

Endpoint возвращает полную статистику чтения для текущего пользователя:
- Количество книг (всего, в процессе, завершено)
- Общее время чтения и средняя скорость
- Reading streak (непрерывные дни чтения)
- Любимые жанры
- Weekly activity (активность по дням за последние 7 дней)

---

## Authentication

**Требуется:** JWT токен в заголовке `Authorization: Bearer <token>`

---

## Request

```bash
GET /api/v1/reading-statistics HTTP/1.1
Host: localhost:8000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Query Parameters

Нет параметров запроса.

---

## Response

### Success Response (200 OK)

```json
{
  "total_books": 15,
  "books_in_progress": 3,
  "books_completed": 12,
  "total_reading_time_minutes": 2400,
  "reading_streak_days": 7,
  "average_reading_speed_wpm": 250.5,
  "favorite_genres": [
    {
      "genre": "fantasy",
      "count": 6
    },
    {
      "genre": "science_fiction",
      "count": 4
    },
    {
      "genre": "detective",
      "count": 3
    }
  ],
  "weekly_activity": [
    {
      "date": "2025-10-27",
      "day": "Пн",
      "minutes": 60,
      "sessions": 2,
      "progress": 15
    },
    {
      "date": "2025-10-26",
      "day": "Вс",
      "minutes": 45,
      "sessions": 2,
      "progress": 12
    },
    {
      "date": "2025-10-25",
      "day": "Сб",
      "minutes": 0,
      "sessions": 0,
      "progress": 0
    }
  ]
}
```

### Response Fields

| Поле | Тип | Описание |
|------|-----|----------|
| `total_books` | integer | Общее количество книг пользователя |
| `books_in_progress` | integer | Книги в процессе чтения (прогресс 0-95%) |
| `books_completed` | integer | Завершенные книги (прогресс >= 95%) |
| `total_reading_time_minutes` | integer | Общее время чтения в минутах (из reading_sessions) |
| `reading_streak_days` | integer | Непрерывная серия дней чтения (начиная с сегодня) |
| `average_reading_speed_wpm` | float | Средняя скорость чтения (слов в минуту) |
| `favorite_genres` | array | Топ-5 любимых жанров с количеством книг |
| `weekly_activity` | array | Активность за последние 7 дней |

#### Weekly Activity Object

| Поле | Тип | Описание |
|------|-----|----------|
| `date` | string | Дата в формате ISO 8601 (YYYY-MM-DD) |
| `day` | string | День недели на русском (Пн, Вт, Ср, Чт, Пт, Сб, Вс) |
| `minutes` | integer | Общее время чтения в этот день (минуты) |
| `sessions` | integer | Количество сессий чтения |
| `progress` | integer | Общий прогресс в процентах за день |

**ВАЖНО:** Массив `weekly_activity` ВСЕГДА содержит 7 элементов (последние 7 дней).
Дни без активности заполняются нулями.

---

## Error Responses

### 401 Unauthorized

```json
{
  "detail": "Not authenticated"
}
```

**Причина:** Отсутствует или невалидный JWT токен.

### 403 Forbidden

```json
{
  "detail": "Inactive user"
}
```

**Причина:** Пользователь неактивен (is_active = false).

---

## Business Logic

### Reading Streak Calculation

Reading streak — это количество непрерывных дней чтения **начиная с сегодня**.

**Алгоритм:**
1. Получить все уникальные даты чтения из `reading_sessions` (где `is_active = false`)
2. Проверить, читал ли пользователь **сегодня**
3. Если НЕ читал сегодня → `reading_streak_days = 0`
4. Если читал сегодня → считать последовательные дни назад

**Примеры:**

| Даты чтения | Reading Streak |
|-------------|----------------|
| 27.10, 26.10, 25.10 | 3 |
| 27.10, 26.10, 24.10 (пропуск 25.10) | 2 |
| 26.10, 25.10 (сегодня 27.10, не читал) | 0 |
| 27.10 (только сегодня) | 1 |

### Weekly Activity Calculation

Weekly activity показывает активность за последние 7 дней (включая сегодня).

**Алгоритм:**
1. Выбрать все `reading_sessions` за последние 7 дней (где `is_active = false`)
2. Агрегировать по `DATE(started_at)`:
   - `SUM(duration_minutes)` → minutes
   - `COUNT(*)` → sessions
   - `SUM(end_position - start_position)` → progress
3. Заполнить пропущенные дни нулями

**SQL запрос:**

```sql
SELECT
    DATE(started_at) as reading_date,
    SUM(duration_minutes) as total_minutes,
    COUNT(*) as sessions_count,
    SUM(end_position - start_position) as total_progress
FROM reading_sessions
WHERE user_id = :user_id
    AND started_at >= NOW() - INTERVAL '7 days'
    AND is_active = false
GROUP BY DATE(started_at)
ORDER BY reading_date DESC;
```

### Books Completion Logic

- **in_progress:** Книга имеет `reading_progress` и `current_position` в диапазоне (0, 95)
- **completed:** Книга имеет `reading_progress` и `current_position >= 95`

Порог 95% используется для учета округлений и небольших отклонений.

---

## Usage Examples

### cURL

```bash
# Получить статистику чтения
curl -X GET "http://localhost:8000/api/v1/reading-statistics" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Python (requests)

```python
import requests

url = "http://localhost:8000/api/v1/reading-statistics"
headers = {"Authorization": f"Bearer {jwt_token}"}

response = requests.get(url, headers=headers)
statistics = response.json()

print(f"Reading streak: {statistics['reading_streak_days']} days")
print(f"Total time: {statistics['total_reading_time_minutes']} minutes")
print(f"Avg speed: {statistics['average_reading_speed_wpm']} WPM")
```

### JavaScript (fetch)

```javascript
const response = await fetch('http://localhost:8000/api/v1/reading-statistics', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`
  }
});

const stats = await response.json();
console.log('Weekly activity:', stats.weekly_activity);
console.log('Favorite genres:', stats.favorite_genres);
```

---

## Empty Data Scenarios

### Новый пользователь без данных

**Response:**

```json
{
  "total_books": 0,
  "books_in_progress": 0,
  "books_completed": 0,
  "total_reading_time_minutes": 0,
  "reading_streak_days": 0,
  "average_reading_speed_wpm": 0.0,
  "favorite_genres": [],
  "weekly_activity": [
    {"date": "2025-10-27", "day": "Пн", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-26", "day": "Вс", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-25", "day": "Сб", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-24", "day": "Пт", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-23", "day": "Чт", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-22", "day": "Ср", "minutes": 0, "sessions": 0, "progress": 0},
    {"date": "2025-10-21", "day": "Вт", "minutes": 0, "sessions": 0, "progress": 0}
  ]
}
```

**Важные моменты:**
- `weekly_activity` всегда содержит 7 элементов (даже для нового пользователя)
- `favorite_genres` — пустой массив если нет книг
- Все числовые метрики = 0

---

## Related Endpoints

- `GET /api/v1/users/profile` - Основной профиль пользователя
- `GET /api/v1/users/subscription` - Информация о подписке
- `GET /api/v1/books/{book_id}/progress` - Прогресс чтения конкретной книги

---

## Version History

- **v1.0** (2025-10-27) - Первая версия endpoint
  - Добавлен `UserStatisticsService`
  - Реализован weekly activity
  - Реализован reading streak
  - Добавлена статистика по книгам и жанрам
