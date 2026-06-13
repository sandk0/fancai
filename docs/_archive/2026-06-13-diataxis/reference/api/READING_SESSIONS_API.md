# Reading Sessions API Documentation

## Обзор

Reading Sessions API предоставляет endpoints для управления сессиями чтения книг в BookReader AI. Каждая сессия представляет собой непрерывный период чтения книги и используется для детальной аналитики поведения пользователей.

**Версия:** v1
**Базовый путь:** `/api/v1/reading-sessions`
**Аутентификация:** JWT Bearer Token (required для всех endpoints)

---

## Ключевые концепции

### Что такое Reading Session?

**Reading Session** — это запись о непрерывном периоде чтения книги пользователем. Каждая сессия содержит:

- **Временные данные**: когда началось и закончилось чтение
- **Прогресс**: начальная и конечная позиция в книге (0-100%)
- **Метаданные**: устройство, количество прочитанных страниц
- **Статус**: активна или завершена

### Жизненный цикл сессии

```
1. START → Создается активная сессия (is_active=true)
           ↓
2. UPDATE → Периодическое обновление позиции (опционально)
           ↓
3. END → Сессия завершается (is_active=false)
         Вычисляется duration_minutes и progress_delta
```

### Автоматическое управление

- **Одна активная сессия**: При старте новой сессии автоматически завершается предыдущая активная
- **Валидация прогресса**: `end_position` всегда должна быть >= `start_position`
- **Автоматический расчет**: `duration_minutes` вычисляется из `started_at` и `ended_at`

---

## Endpoints

### 1. POST /reading-sessions/start

Начинает новую сессию чтения.

**Аутентификация:** Required (JWT)

#### Request

```http
POST /api/v1/reading-sessions/start
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "book_id": "123e4567-e89b-12d3-a456-426614174000",
  "start_position": 25,
  "device_type": "mobile"
}
```

**Параметры:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `book_id` | string (UUID) | Да | UUID книги для чтения |
| `start_position` | integer (0-100) | Нет (default: 0) | Начальная позиция в книге (%) |
| `device_type` | string | Нет | Тип устройства: `mobile`, `tablet`, `desktop` |

#### Response (201 Created)

```json
{
  "id": "987fcdeb-51a2-43d1-b789-abc123456def",
  "user_id": "456e7890-e12b-34c5-d678-901234567890",
  "book_id": "123e4567-e89b-12d3-a456-426614174000",
  "started_at": "2025-10-28T10:30:00Z",
  "ended_at": null,
  "duration_minutes": 0,
  "start_position": 25,
  "end_position": 25,
  "pages_read": 0,
  "device_type": "mobile",
  "is_active": true,
  "progress_delta": 0
}
```

#### Возможные ошибки

- `400 Bad Request` — невалидные параметры (неправильный UUID, device_type)
- `404 Not Found` — книга не найдена или нет доступа
- `500 Internal Server Error` — ошибка сервера

#### Примеры curl

```bash
# Начать сессию чтения с начала книги
curl -X POST http://localhost:8000/api/v1/reading-sessions/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "book_id": "123e4567-e89b-12d3-a456-426614174000",
    "start_position": 0,
    "device_type": "desktop"
  }'

# Начать сессию с середины книги
curl -X POST http://localhost:8000/api/v1/reading-sessions/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "book_id": "123e4567-e89b-12d3-a456-426614174000",
    "start_position": 50
  }'
```

---

### 2. PUT /reading-sessions/{session_id}/update

Обновляет текущую позицию в активной сессии.

**Аутентификация:** Required (JWT)

#### Request

```http
PUT /api/v1/reading-sessions/987fcdeb-51a2-43d1-b789-abc123456def/update
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "current_position": 35
}
```

**Параметры:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `current_position` | integer (0-100) | Да | Текущая позиция в книге (%) |

#### Response (200 OK)

```json
{
  "id": "987fcdeb-51a2-43d1-b789-abc123456def",
  "user_id": "456e7890-e12b-34c5-d678-901234567890",
  "book_id": "123e4567-e89b-12d3-a456-426614174000",
  "started_at": "2025-10-28T10:30:00Z",
  "ended_at": null,
  "duration_minutes": 0,
  "start_position": 25,
  "end_position": 35,
  "pages_read": 0,
  "device_type": "mobile",
  "is_active": true,
  "progress_delta": 10
}
```

#### Возможные ошибки

- `400 Bad Request` — сессия неактивна
- `403 Forbidden` — нет доступа к сессии
- `404 Not Found` — сессия не найдена
- `500 Internal Server Error` — ошибка сервера

#### Примеры curl

```bash
# Обновить позицию до 35%
curl -X PUT http://localhost:8000/api/v1/reading-sessions/987fcdeb-51a2-43d1-b789-abc123456def/update \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "current_position": 35
  }'
```

---

### 3. PUT /reading-sessions/{session_id}/end

Завершает активную сессию чтения.

**Аутентификация:** Required (JWT)

#### Request

```http
PUT /api/v1/reading-sessions/987fcdeb-51a2-43d1-b789-abc123456def/end
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "end_position": 45
}
```

**Параметры:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `end_position` | integer (0-100) | Да | Конечная позиция в книге (%) |

**Валидация:** `end_position` должна быть >= `start_position`

#### Response (200 OK)

```json
{
  "id": "987fcdeb-51a2-43d1-b789-abc123456def",
  "user_id": "456e7890-e12b-34c5-d678-901234567890",
  "book_id": "123e4567-e89b-12d3-a456-426614174000",
  "started_at": "2025-10-28T10:30:00Z",
  "ended_at": "2025-10-28T11:15:00Z",
  "duration_minutes": 45,
  "start_position": 25,
  "end_position": 45,
  "pages_read": 0,
  "device_type": "mobile",
  "is_active": false,
  "progress_delta": 20
}
```

#### Возможные ошибки

- `400 Bad Request` — сессия уже завершена или end_position < start_position
- `403 Forbidden` — нет доступа к сессии
- `404 Not Found` — сессия не найдена
- `500 Internal Server Error` — ошибка сервера

#### Примеры curl

```bash
# Завершить сессию на 45%
curl -X PUT http://localhost:8000/api/v1/reading-sessions/987fcdeb-51a2-43d1-b789-abc123456def/end \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "end_position": 45
  }'
```

---

### 4. GET /reading-sessions/active

Возвращает текущую активную сессию пользователя.

**Аутентификация:** Required (JWT)

#### Request

```http
GET /api/v1/reading-sessions/active
Authorization: Bearer <JWT_TOKEN>
```

#### Response (200 OK)

**Если есть активная сессия:**

```json
{
  "id": "987fcdeb-51a2-43d1-b789-abc123456def",
  "user_id": "456e7890-e12b-34c5-d678-901234567890",
  "book_id": "123e4567-e89b-12d3-a456-426614174000",
  "started_at": "2025-10-28T10:30:00Z",
  "ended_at": null,
  "duration_minutes": 0,
  "start_position": 25,
  "end_position": 35,
  "pages_read": 0,
  "device_type": "mobile",
  "is_active": true,
  "progress_delta": 10
}
```

**Если нет активной сессии:**

```json
null
```

#### Примеры curl

```bash
# Получить активную сессию
curl -X GET http://localhost:8000/api/v1/reading-sessions/active \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 5. GET /reading-sessions/history

Возвращает историю сессий чтения с пагинацией.

**Аутентификация:** Required (JWT)

#### Request

```http
GET /api/v1/reading-sessions/history?page=1&page_size=20&book_id=123e4567-e89b-12d3-a456-426614174000
Authorization: Bearer <JWT_TOKEN>
```

**Query параметры:**

| Параметр | Тип | Обязательный | Default | Описание |
|----------|-----|--------------|---------|----------|
| `page` | integer | Нет | 1 | Номер страницы (начинается с 1) |
| `page_size` | integer (1-100) | Нет | 20 | Количество элементов на странице |
| `book_id` | string (UUID) | Нет | — | Фильтр по UUID книги |

#### Response (200 OK)

```json
{
  "sessions": [
    {
      "id": "987fcdeb-51a2-43d1-b789-abc123456def",
      "user_id": "456e7890-e12b-34c5-d678-901234567890",
      "book_id": "123e4567-e89b-12d3-a456-426614174000",
      "started_at": "2025-10-28T10:30:00Z",
      "ended_at": "2025-10-28T11:15:00Z",
      "duration_minutes": 45,
      "start_position": 25,
      "end_position": 45,
      "pages_read": 0,
      "device_type": "mobile",
      "is_active": false,
      "progress_delta": 20
    },
    {
      "id": "abc12345-67de-89fa-bcde-0123456789ab",
      "user_id": "456e7890-e12b-34c5-d678-901234567890",
      "book_id": "123e4567-e89b-12d3-a456-426614174000",
      "started_at": "2025-10-27T15:00:00Z",
      "ended_at": "2025-10-27T16:30:00Z",
      "duration_minutes": 90,
      "start_position": 0,
      "end_position": 25,
      "pages_read": 0,
      "device_type": "desktop",
      "is_active": false,
      "progress_delta": 25
    }
  ],
  "total": 12,
  "page": 1,
  "page_size": 20,
  "has_next": false
}
```

#### Возможные ошибки

- `400 Bad Request` — невалидные query параметры
- `500 Internal Server Error` — ошибка сервера

#### Примеры curl

```bash
# Получить первую страницу истории (все книги)
curl -X GET "http://localhost:8000/api/v1/reading-sessions/history?page=1&page_size=20" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Получить историю для конкретной книги
curl -X GET "http://localhost:8000/api/v1/reading-sessions/history?book_id=123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Получить вторую страницу с 10 элементами
curl -X GET "http://localhost:8000/api/v1/reading-sessions/history?page=2&page_size=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Модель данных

### ReadingSessionResponse

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string (UUID) | Уникальный идентификатор сессии |
| `user_id` | string (UUID) | UUID пользователя |
| `book_id` | string (UUID) | UUID книги |
| `started_at` | datetime (ISO 8601) | Время начала сессии |
| `ended_at` | datetime (ISO 8601) / null | Время окончания (null для активных) |
| `duration_minutes` | integer | Длительность сессии в минутах |
| `start_position` | integer (0-100) | Позиция начала сессии (%) |
| `end_position` | integer (0-100) | Позиция окончания сессии (%) |
| `pages_read` | integer | Количество прочитанных страниц |
| `device_type` | string / null | Тип устройства |
| `is_active` | boolean | Флаг активности сессии |
| `progress_delta` | integer | Прогресс за сессию (вычисляемое) |

---

## Интеграция с Frontend

### Пример использования в React

```typescript
// API client для reading sessions
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api/v1';

interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  start_position: number;
  end_position: number;
  pages_read: number;
  device_type: string | null;
  is_active: boolean;
  progress_delta: number;
}

class ReadingSessionsAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  // Начать сессию чтения
  async startSession(
    bookId: string,
    startPosition: number = 0,
    deviceType?: string
  ): Promise<ReadingSession> {
    const response = await axios.post(
      `${API_BASE_URL}/reading-sessions/start`,
      {
        book_id: bookId,
        start_position: startPosition,
        device_type: deviceType,
      },
      { headers: this.headers }
    );
    return response.data;
  }

  // Обновить позицию
  async updateSession(
    sessionId: string,
    currentPosition: number
  ): Promise<ReadingSession> {
    const response = await axios.put(
      `${API_BASE_URL}/reading-sessions/${sessionId}/update`,
      { current_position: currentPosition },
      { headers: this.headers }
    );
    return response.data;
  }

  // Завершить сессию
  async endSession(
    sessionId: string,
    endPosition: number
  ): Promise<ReadingSession> {
    const response = await axios.put(
      `${API_BASE_URL}/reading-sessions/${sessionId}/end`,
      { end_position: endPosition },
      { headers: this.headers }
    );
    return response.data;
  }

  // Получить активную сессию
  async getActiveSession(): Promise<ReadingSession | null> {
    const response = await axios.get(
      `${API_BASE_URL}/reading-sessions/active`,
      { headers: this.headers }
    );
    return response.data;
  }

  // Получить историю
  async getHistory(
    page: number = 1,
    pageSize: number = 20,
    bookId?: string
  ): Promise<{
    sessions: ReadingSession[];
    total: number;
    page: number;
    page_size: number;
    has_next: boolean;
  }> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (bookId) {
      params.append('book_id', bookId);
    }

    const response = await axios.get(
      `${API_BASE_URL}/reading-sessions/history?${params.toString()}`,
      { headers: this.headers }
    );
    return response.data;
  }
}

export default ReadingSessionsAPI;
```

### Пример использования в EpubReader компоненте

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import ReadingSessionsAPI from './api/reading-sessions';

const EpubReader: React.FC<{ bookId: string; token: string }> = ({ bookId, token }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const api = new ReadingSessionsAPI(token);

  // Начать сессию при монтировании компонента
  useEffect(() => {
    const startSession = async () => {
      try {
        // Проверяем, есть ли активная сессия
        const activeSession = await api.getActiveSession();

        if (activeSession && activeSession.book_id === bookId) {
          // Продолжаем существующую сессию
          setSessionId(activeSession.id);
          setCurrentPosition(activeSession.end_position);
        } else {
          // Начинаем новую сессию
          const newSession = await api.startSession(
            bookId,
            0,
            getDeviceType() // mobile/tablet/desktop
          );
          setSessionId(newSession.id);
        }
      } catch (error) {
        console.error('Failed to start reading session:', error);
      }
    };

    startSession();
  }, [bookId]);

  // Обновлять позицию каждые 30 секунд
  useEffect(() => {
    if (!sessionId) return;

    const interval = setInterval(async () => {
      try {
        await api.updateSession(sessionId, currentPosition);
      } catch (error) {
        console.error('Failed to update session:', error);
      }
    }, 30000); // 30 секунд

    return () => clearInterval(interval);
  }, [sessionId, currentPosition]);

  // Завершить сессию при размонтировании
  useEffect(() => {
    return () => {
      if (sessionId) {
        api.endSession(sessionId, currentPosition).catch(console.error);
      }
    };
  }, [sessionId, currentPosition]);

  // Обработчик изменения позиции чтения
  const handlePositionChange = useCallback((newPosition: number) => {
    setCurrentPosition(newPosition);
  }, []);

  return (
    <div>
      {/* EPUB Reader UI */}
      <div>Current Position: {currentPosition}%</div>
      {/* ... остальной код читалки ... */}
    </div>
  );
};

function getDeviceType(): string {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export default EpubReader;
```

---

## Best Practices

### 1. Автоматическое управление сессиями

✅ **Правильно:**
```typescript
// Начинаем сессию при открытии книги
const session = await api.startSession(bookId, currentProgress);

// Периодически обновляем позицию (каждые 30-60 секунд)
setInterval(() => {
  await api.updateSession(session.id, currentPosition);
}, 30000);

// Завершаем при закрытии
await api.endSession(session.id, finalPosition);
```

❌ **Неправильно:**
```typescript
// Не создавать несколько активных сессий для одной книги
await api.startSession(bookId); // сессия 1
await api.startSession(bookId); // сессия 2 (автоматически закроет сессию 1)
```

### 2. Обработка ошибок

```typescript
try {
  await api.startSession(bookId);
} catch (error) {
  if (error.response?.status === 404) {
    console.error('Book not found');
  } else if (error.response?.status === 403) {
    console.error('Access denied');
  } else {
    console.error('Failed to start session');
  }
}
```

### 3. Восстановление после перезагрузки

```typescript
useEffect(() => {
  // Проверяем активную сессию при перезагрузке страницы
  const activeSession = await api.getActiveSession();

  if (activeSession) {
    // Продолжаем чтение с сохраненной позиции
    setCurrentPosition(activeSession.end_position);
    setSessionId(activeSession.id);
  } else {
    // Начинаем новую сессию
    const newSession = await api.startSession(bookId);
    setSessionId(newSession.id);
  }
}, []);
```

---

## Аналитика и статистика

Reading Sessions используются для вычисления:

- **Weekly Activity** — активность по дням недели (через `UserStatisticsService`)
- **Reading Streak** — непрерывная серия дней чтения
- **Total Reading Time** — общее время чтения в минутах
- **Reading Speed** — скорость чтения (% книги / минута)
- **Reading Patterns** — паттерны чтения (время дня, устройства)

### Пример запроса статистики

```bash
# Получить weekly activity (использует reading_sessions)
curl -X GET http://localhost:8000/api/v1/users/stats/weekly \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Changelog

**v1.0 (2025-10-28):**
- Создан Reading Sessions API с 5 endpoints
- Добавлена автоматическая обработка активных сессий
- Реализована пагинация для истории
- Добавлена фильтрация по книгам
- Comprehensive validation и error handling
