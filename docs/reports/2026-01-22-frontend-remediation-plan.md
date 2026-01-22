# План Доработок Frontend: Исправление Прогресса Обработки

**Дата:** 22.01.2026  
**Приоритет:** Критический  
**Оценка времени:** ~4 часа

---

## Фаза 1: Backend WebSocket (КРИТИЧНО) — 1ч

### 1.1 Добавить `publish_book_progress` в tasks.py

**Файл:** `backend/app/core/tasks.py`

**Изменения:**
```python
# Добавить импорт (в начале файла)
from app.routers.websocket import publish_book_progress

# В функции _process_book_async, после обновления parsing_progress (строки ~298-300):
book.parsing_progress = int((chapters_parsed / total_chapters) * 100)
await db.commit()

# ДОБАВИТЬ:
await publish_book_progress(
    book_id=str(book_id),
    progress=book.parsing_progress,
    chapter=idx + 1,
    total_chapters=total_chapters,
    status="processing",
    message=f"Обработка главы {idx + 1}/{total_chapters}"
)
```

**Также добавить:**
- При `status="completed"` в конце успешной обработки
- При `status="failed"` в случае ошибки

---

## Фаза 2: CSS Pointer-Events (КРИТИЧНО) — 30мин

### 2.1 Исправить ParsingOverlay.tsx

**Файл:** `frontend/src/components/UI/ParsingOverlay.tsx`

**Строка 219:** Добавить `pointer-events-auto` на кнопку Cancel:
```tsx
// Было:
className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/20 ... z-50 mt-4"

// Стало:
className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/20 ... z-50 mt-4 pointer-events-auto"
```

### 2.2 Исправить BookCard.tsx

**Файл:** `frontend/src/components/Library/BookCard.tsx`

**Строки 177-183:** Не блокировать pointer-events при is_processing:
```tsx
// Было:
className={cn(
  'cursor-pointer transition-shadow duration-300',
  isClickable ? 'hover:shadow-xl' : 'opacity-70',
  !isClickable && 'pointer-events-none'
)}

// Стало:
className={cn(
  'cursor-pointer transition-shadow duration-300',
  isClickable ? 'hover:shadow-xl' : 'opacity-70',
  !isClickable && !book.is_processing && 'pointer-events-none'
)}
```

---

## Фаза 3: Backend Celery Revoke (ВАЖНО) — 1ч

### 3.1 Реализовать отмену Celery task

**Файл:** `backend/app/routers/books/crud.py`

**Строки 650-652:** Раскомментировать и реализовать:
```python
from celery.result import AsyncResult
from app.core.celery_app import celery_app

# В cancel_book_processing:
try:
    # Получить task_id из Redis или DB (если хранится)
    # Пример: хранить task_id при запуске в book.current_task_id
    if book.current_task_id:
        result = AsyncResult(book.current_task_id, app=celery_app)
        result.revoke(terminate=True)
        logger.info("Celery task revoked", task_id=book.current_task_id)
except Exception as e:
    logger.warning("Failed to revoke Celery task", error=str(e))
```

### 3.2 Добавить task_id в модель Book

**Файл:** `backend/app/models/book.py`
```python
current_task_id: str | None = Column(String, nullable=True)
```

**Migration:**
```bash
alembic revision --autogenerate -m "Add current_task_id to Book"
alembic upgrade head
```

---

## Фаза 4: Удалить Legacy Код (СРЕДНЕ) — 30мин

### 4.1 Удалить extract_new из API

**Файлы:**
- `frontend/src/api/books.ts:108` — удалить параметр
- `frontend/src/hooks/api/useDescriptions.ts` — удалить все `extract_new` аргументы
- `frontend/src/hooks/epub/useChapterManagement.ts` — удалить комментарии

---

## Фаза 5: Улучшить Надёжность (СРЕДНЕ) — 1ч

### 5.1 Retry для Initial Fetch

**Файл:** `frontend/src/hooks/useBookProgressWS.ts`

```typescript
const fetchInitialStatus = async (retries = 3) => {
  try {
    const response = await booksAPI.getParsingStatus(bookId);
    // ...existing code...
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return fetchInitialStatus(retries - 1);
    }
    console.error('[useBookProgressWS] Initial fetch failed after retries:', e);
    setUsePollingFallback(true); // Fallback to polling
  }
};
```

### 5.2 Fetch после Reconnect

В `wsRef.current.onopen`:
```typescript
wsRef.current.onopen = () => {
  console.log('[useBookProgressWS] Connected');
  setStatus('connected');
  reconnectAttempts.current = 0;
  
  // Re-fetch current state after reconnect
  fetchInitialStatus();  // <-- ДОБАВИТЬ
  
  // Setup ping interval
  pingInterval.current = setInterval(() => {
    sendMessage({ type: 'ping' });
  }, 25000);
};
```

---

## Тестирование

### Чеклист

- [ ] После старта обработки прогресс >0% виден через 5 сек
- [ ] ETR показывается при прогрессе 10-90%
- [ ] Кнопка "Отменить" кликабельна на Desktop
- [ ] Кнопка "Отменить" кликабельна на Mobile
- [ ] После отмены Celery task останавливается (логи)
- [ ] После отмены overlay закрывается
- [ ] WebSocket reconnect восстанавливает состояние

---

## Деплой

```bash
# Backend
ssh root@77.246.106.109
cd /root/fancai-vibe-hackathon
git pull
docker compose -f docker-compose.lite.yml up -d --build backend celery-worker
```

---

## Summary

| Фаза | Задача | Время | Приоритет |
|------|--------|-------|-----------|
| 1 | WebSocket publish | 1ч | 🔴 КРИТИЧНО |
| 2 | CSS pointer-events | 30мин | 🔴 КРИТИЧНО |
| 3 | Celery revoke | 1ч | 🟡 ВАЖНО |
| 4 | Legacy extract_new | 30мин | 🟢 СРЕДНЕ |
| 5 | Retry/reconnect | 1ч | 🟢 СРЕДНЕ |

**Итого: ~4 часа работы**
