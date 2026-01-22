# Глубокий Аудит Frontend: Проблемы Обработки Книг

**Дата:** 22.01.2026  
**Аудитор:** Antigravity AI  
**Фокус:** ParsingOverlay, прогресс, отмена обработки

---

## Критические Проблемы

### 1. WebSocket прогресс НИКОГДА не отправляется

**Корневая причина проблемы 0% / 100%**

| Факт | Детали |
|------|--------|
| Функция `publish_book_progress` | ✅ Существует в `websocket.py:241-281` |
| Вызов из `tasks.py` | ❌ **НИКОГДА не вызывается** |
| Результат | WebSocket молчит, frontend показывает только начальное (0%) и конечное (100%) состояние |

**Код проблемы в `tasks.py`:**
```python
# Строки 298-300: Прогресс обновляется в БД, но НЕ публикуется в WebSocket!
book.parsing_progress = int((chapters_parsed / total_chapters) * 100)
await db.commit()
# ОТСУТСТВУЕТ: await publish_book_progress(str(book_id), progress, chapter, total)
```

**Влияние:**
- `useBookProgressWS.ts` получает обновления только через initial fetch
- Polling fallback работает, но interval 300-500ms создаёт задержки
- ETR не вычисляется, пока progress == 0

---

### 2. Кнопка "Отменить" не кликабельна

**Причина:** Конфликт `pointer-events` в родительском контейнере

**BookCard.tsx, строки 177-183:**
```tsx
<div
  className={cn(
    'cursor-pointer transition-shadow duration-300',
    isClickable ? 'hover:shadow-xl' : 'opacity-70',
    !isClickable && 'pointer-events-none'  // ⚠️ ВОТ ТУТ
  )}
  onClick={handleClick}
>
```

**Когда `book.is_processing = true`:**
- `isClickable = book.is_parsed && !book.is_processing` → **false**
- Родительский div получает `pointer-events-none`
- Все дочерние элементы (включая ParsingOverlay) блокируют клики

**Но ParsingOverlay имеет:**
```tsx
// ParsingOverlay.tsx:219
className="... z-50 mt-4 backdrop-blur-md ..."
// БЕЗ pointer-events-auto!
```

---

### 3. Backend Cancel НЕ останавливает Celery task

**crud.py:624-669:**
```python
@router.post("/{book_id}/cancel-processing")
async def cancel_book_processing(...):
    # TODO: Отменить Celery task через revoke (требует настройки)
    # from celery.result import AsyncResult
    # AsyncResult(task_id).revoke(terminate=True)
    
    book.is_processing = False  # Только DB flag!
    book.descriptions_processing_error = "Отменено пользователем"
    await db.commit()
```

**Результат:**
- Celery task продолжает работать в фоне
- После "отмены" task может ещё раз установить `is_processing=True`
- Конфликты состояния

---

### 4. ETR (оставшееся время) не отображается

**ParsingOverlay.tsx:36-40:**
```tsx
if (!startTime || progress <= 0 || progress >= 100) {
  if (progress >= 100) setEtr(null);
  return;  // ETR не вычисляется при progress == 0
}
```

**Поскольку WebSocket не отправляет прогресс**, frontend видит только:
- 0% (initial fetch или WebSocket молчит)
- 100% (completed)

→ ETR **никогда не показывается**

---

## Средние Проблемы

### 5. Legacy код `extract_new` не удалён

| Файл | Строка | Использование |
|------|--------|---------------|
| `api/books.ts` | 108 | `params.append('extract_new', 'true')` |
| `useChapterManagement.ts` | 188 | `// extract_new=false` комментарий |
| `useDescriptions.ts` | 119, 130, 209, 414 | Активные вызовы |

**Влияние:** Лишние LLM вызовы при чтении глав (должно было быть удалено).

---

### 6. Initial WebSocket fetch может "зависнуть"

**useBookProgressWS.ts:257-271:**
```typescript
const fetchInitialStatus = async () => {
  try {
    const response = await booksAPI.getParsingStatus(bookId);
    // ...
  } catch (e) {
    console.error('[useBookProgressWS] Failed to fetch initial status:', e);
    // НЕТ retry, НЕТ fallback к polling здесь
  }
};
```

Если initial fetch fallback падает, WebSocket остаётся на 0%.

---

### 7. WebSocket reconnect не гарантирует актуальность

После reconnect WebSocket ждёт **новых** сообщений от сервера. Если сервер не отправляет прогресс (см. проблему #1), клиент остаётся неактуальным.

---

## Frontend ↔ Backend Несоответствия

| Аспект | Frontend ожидает | Backend делает |
|--------|------------------|----------------|
| WebSocket updates | `type: 'progress'` каждые N секунд | Никогда не отправляет |
| Cancel processing | Celery task остановлен | Только DB flag |
| `parsing_status` | `progress` поле | ✅ Правильно |
| `descriptions_extracted` | После обработки = true | ✅ Правильно |

---

## Рекомендации

### Приоритет: Критические

| # | Действие | Файл | Сложность |
|---|----------|------|-----------|
| 1 | Добавить `publish_book_progress()` вызовы в chapter loop | `tasks.py` | 1ч |
| 2 | Добавить `pointer-events-auto` на кнопку Cancel | `ParsingOverlay.tsx` | 10мин |
| 3 | Убрать `pointer-events-none` с parent при is_processing | `BookCard.tsx` | 15мин |
| 4 | Реализовать `AsyncResult.revoke()` для Cancel | `crud.py` | 30мин |

### Приоритет: Средние

| # | Действие | Файл | Сложность |
|---|----------|------|-----------|
| 5 | Удалить legacy `extract_new` | 5 файлов | 30мин |
| 6 | Добавить retry в `fetchInitialStatus` | `useBookProgressWS.ts` | 20мин |
| 7 | Добавить WS reconnect с initial fetch | `useBookProgressWS.ts` | 20мин |

---

## Заключение

Основная проблема: **backend не отправляет WebSocket обновления прогресса**.

Frontend реализован корректно (логика ETR, WebSocket hook, polling fallback), но бэкенд никогда не вызывает `publish_book_progress()`.

Кнопка "Отменить" заблокирована CSS `pointer-events-none` на родительском элементе.

**Время на исправление критических проблем: ~2 часа.**
