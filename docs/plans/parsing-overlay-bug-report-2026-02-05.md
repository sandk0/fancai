# Отчёт: Баг с быстрым прогрессом обработки книги

**Дата:** 5 февраля 2026  
**Статус:** Анализ завершён  
**Приоритет:** Высокий (UX критичен для первого впечатления)

---

## Описание проблемы

При клике на кнопку "Обработать" (Sparkles button) оверлей с прогрессом обработки книги:
- **Неправильно**: Показывает 0% → 100% за пару секунд и исчезает
- **После перезагрузки страницы**: Работает корректно, показывает реальный прогресс

---

## Корневая причина

**Race Condition в `useBookProgressWS.ts` (строки 283-288)**

```typescript
// CRITICAL FIX: Close overlay if processing is done or not started
if (data.status === 'completed' || data.status === 'not_started') {
    if (data.status === 'completed') setProgress(100);
    onCompleteRef.current?.();  // ← ЗАКРЫВАЕТ ОВЕРЛЕЙ!
    disconnect();
}
```

### Последовательность событий (баг):

```
1. Пользователь кликает "Обработать"
   ↓
2. useBookProcessing.startProcessing() вызывается
   ↓
3. Optimistic Update: is_processing = true (локально в React Query кэше)
   ↓
4. BookCard видит is_processing=true → рендерит ParsingOverlay
   ↓
5. ParsingOverlay монтируется → useBookProgressWS активируется
   ↓
6. После 1 секунды: fetchInitialStatus() вызывает GET /parsing-status
   ↓
7. RACE CONDITION: Сервер ещё не начал обработку или POST не завершился
   ↓
8. Сервер возвращает status: "not_started" (книга is_parsed=true, descriptions_extracted=false)
   ↓
9. Код на строке 286-287 вызывает onCompleteRef.current() и disconnect()
   ↓
10. РЕЗУЛЬТАТ: Оверлей закрывается через 1-2 секунды!
```

### Почему работает после перезагрузки:

```
1. Страница перезагружается
   ↓
2. React Query кэш очищается
   ↓
3. Свежий запрос к серверу: GET /books/{id}
   ↓
4. Сервер возвращает is_processing=true (обработка уже идёт)
   ↓
5. BookCard рендерит ParsingOverlay
   ↓
6. fetchInitialStatus() получает status: "processing", progress: 15%
   ↓
7. Оверлей НЕ закрывается, показывает реальный прогресс
```

---

## Детальный анализ кода

### 1. Точка входа: BookCard.tsx (строки 115-123)

```typescript
const handleProcessClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    haptics.tap();
    startProcessing();  // ← Вызывает мутацию
    onProcessStart?.(book.id);
}, [haptics, startProcessing, onProcessStart, book.id]);
```

### 2. Мутация: useBookProcessing.ts (строки 95-119)

```typescript
const startMutation = useMutation({
    mutationFn: () => booksAPI.processDescriptions(book.id),
    onMutate: () => {
        // Optimistic: set is_processing = true
        optimisticUpdate({
            is_processing: true,
            descriptions_extracted: false,
            descriptions_processing_error: null,
        });
    },
    onSuccess: () => {
        // НЕ вызываем invalidateQueries() здесь!
        // Комментарий объясняет, что это намеренно для избежания race condition
    },
});
```

**Проблема**: Optimistic update устанавливает `is_processing=true`, но не устанавливает `parsing_progress=0`.

### 3. Условие рендеринга: BookCard.tsx (строки 169-176)

```typescript
{book.is_processing && onParsingComplete && (
    <ParsingOverlay
        bookId={book.id}
        onParsingComplete={onParsingComplete}
        onCancel={cancelProcessing}
    />
)}
```

### 4. Проблемный код: useBookProgressWS.ts (строки 271-293)

```typescript
useEffect(() => {
    if (enabled && bookId && isAuthenticated) {
        const connectTimer = setTimeout(connect, 0);

        const fetchInitialStatus = async () => {
            try {
                const response = await booksAPI.getParsingStatus(bookId);
                const data = response as { progress?: number; status?: string };

                if (data && typeof data.progress === 'number') {
                    setProgress(data.progress);
                    
                    // 🔴 ПРОБЛЕМА ЗДЕСЬ:
                    if (data.status === 'completed' || data.status === 'not_started') {
                        if (data.status === 'completed') setProgress(100);
                        onCompleteRef.current?.();  // Закрывает оверлей!
                        disconnect();
                    }
                }
            } catch (e) {
                logger.error('[useBookProgressWS] Failed to fetch initial status:', e);
            }
        };

        // Вызывается через 1 секунду после монтирования
        const timeoutId = setTimeout(() => {
            fetchInitialStatus();
        }, 1000);

        return () => {
            clearTimeout(connectTimer);
            clearTimeout(timeoutId);
            disconnect();
        };
    }
}, [enabled, bookId, isAuthenticated, connect, disconnect]);
```

### 5. Backend endpoint: processing.py (строки 162-211)

```python
@router.get("/{book_id}/parsing-status")
async def get_parsing_status(book: Book = Depends(get_user_book)):
    # Если идет обработка
    if book.is_processing:
        return {"status": "processing", "progress": book.parsing_progress}
    
    # Если распаршена, но описания не извлечены
    if book.is_parsed:
        if not book.descriptions_extracted:
            return {"status": "not_started", "progress": 0}  # ← ВОЗВРАЩАЕТ ЭТО!
        return {"status": "completed", "progress": 100}
```

---

## Диаграмма состояний

```
                    ┌─────────────────────────┐
                    │   Книга загружена       │
                    │   is_parsed = true      │
                    │   is_processing = false │
                    │   descriptions_extracted│
                    │        = false          │
                    └───────────┬─────────────┘
                                │
                    Клик "Обработать"
                                │
                                ▼
    ┌───────────────────────────────────────────────────────┐
    │                   RACE CONDITION                       │
    │                                                        │
    │  Frontend:                 Backend:                    │
    │  ┌─────────────────┐       ┌─────────────────────┐    │
    │  │ Optimistic      │       │ POST /process       │    │
    │  │ is_processing   │  ──→  │ starts Celery task  │    │
    │  │ = true          │       │ is_processing=true  │    │
    │  └────────┬────────┘       │ (commits to DB)     │    │
    │           │                └─────────────────────┘    │
    │           │                                            │
    │  ┌────────▼────────┐       ┌─────────────────────┐    │
    │  │ ParsingOverlay  │       │                     │    │
    │  │ mounts          │       │ GET /parsing-status │    │
    │  └────────┬────────┘       │ (1 сек позже)       │    │
    │           │                └──────────┬──────────┘    │
    │           │                           │               │
    │  ┌────────▼────────┐       ┌──────────▼──────────┐    │
    │  │ fetchInitial    │  ←──  │ Returns:            │    │
    │  │ Status()        │       │ "not_started"       │    │
    │  │                 │       │ (if DB not updated) │    │
    │  └────────┬────────┘       └─────────────────────┘    │
    │           │                                            │
    │  ┌────────▼────────┐                                   │
    │  │ onComplete()    │  ← ОВЕРЛЕЙ ЗАКРЫВАЕТСЯ!           │
    │  │ disconnect()    │                                   │
    │  └─────────────────┘                                   │
    └───────────────────────────────────────────────────────┘
```

---

## Затронутые файлы

| Файл | Роль | Проблема |
|------|------|----------|
| `useBookProgressWS.ts` | WebSocket + initial fetch | Закрывает оверлей на `not_started` |
| `useBookProcessing.ts` | Optimistic update | Не устанавливает `parsing_progress=0` |
| `BookCard.tsx` | Рендеринг оверлея | Зависит от `is_processing` из кэша |
| `ParsingOverlay.tsx` | UI прогресса | Использует `useBookProgressWS` |
| `processing.py` | Backend endpoint | Возвращает `not_started` для неначатой обработки |

---

## План исправления

### Вариант A: Удалить закрытие на `not_started` (Рекомендуется)

**Файл:** `frontend/src/hooks/useBookProgressWS.ts`

**Изменение:** Убрать логику закрытия оверлея для статуса `not_started`.

```typescript
// БЫЛО (строки 283-288):
if (data.status === 'completed' || data.status === 'not_started') {
    if (data.status === 'completed') setProgress(100);
    onCompleteRef.current?.();
    disconnect();
}

// СТАНЕТ:
if (data.status === 'completed') {
    setProgress(100);
    onCompleteRef.current?.();
    disconnect();
}
// 'not_started' больше НЕ закрывает оверлей
```

**Плюсы:**
- Минимальное изменение (2 строки)
- Не ломает существующую логику
- Race condition больше не влияет на UX

**Минусы:**
- Если обработка действительно не началась, оверлей останется висеть
- Нужен таймаут для обработки ошибок

**Дополнительно:** Добавить таймаут (30 секунд) для закрытия, если прогресс не обновляется:

```typescript
// Добавить после строки 93
const noProgressTimeout = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
    if (progress === 0 && status === 'connected') {
        noProgressTimeout.current = setTimeout(() => {
            logger.warn('[useBookProgressWS] No progress after 30s, closing');
            onErrorRef.current?.('Timeout: no progress received');
            disconnect();
        }, 30000);
    } else if (progress > 0 && noProgressTimeout.current) {
        clearTimeout(noProgressTimeout.current);
        noProgressTimeout.current = null;
    }
    return () => {
        if (noProgressTimeout.current) clearTimeout(noProgressTimeout.current);
    };
}, [progress, status, disconnect]);
```

---

### Вариант B: Добавить grace period для нового процессинга

**Файл:** `frontend/src/hooks/useBookProgressWS.ts`

**Идея:** Игнорировать `not_started` первые 5 секунд после монтирования.

```typescript
// Добавить ref для отслеживания времени монтирования
const mountTimeRef = useRef(Date.now());

// В fetchInitialStatus:
if (data.status === 'completed' || data.status === 'not_started') {
    const timeSinceMount = Date.now() - mountTimeRef.current;
    
    // Игнорировать 'not_started' первые 5 секунд (grace period)
    if (data.status === 'not_started' && timeSinceMount < 5000) {
        logger.debug('[useBookProgressWS] Ignoring not_started during grace period');
        return;
    }
    
    if (data.status === 'completed') setProgress(100);
    onCompleteRef.current?.();
    disconnect();
}
```

**Плюсы:**
- Сохраняет защиту от "зависших" оверлеев
- Решает race condition

**Минусы:**
- Более сложная логика
- Magic number (5 секунд)

---

### Вариант C: Передать флаг "justStarted" из родителя

**Файлы:** 
- `BookCard.tsx`
- `ParsingOverlay.tsx`
- `useBookProgressWS.ts`

**Идея:** Явно сообщить оверлею, что обработка только что запущена.

```typescript
// BookCard.tsx
const [justStartedProcessing, setJustStartedProcessing] = useState(false);

const handleProcessClick = useCallback((e) => {
    setJustStartedProcessing(true);
    startProcessing();
}, []);

// Сброс через 10 секунд
useEffect(() => {
    if (justStartedProcessing) {
        const timer = setTimeout(() => setJustStartedProcessing(false), 10000);
        return () => clearTimeout(timer);
    }
}, [justStartedProcessing]);

// В рендере:
<ParsingOverlay
    bookId={book.id}
    justStarted={justStartedProcessing}  // Новый проп
    onParsingComplete={...}
/>
```

**Плюсы:**
- Явная семантика
- Легко тестировать

**Минусы:**
- Больше изменений
- Пробрасывание пропсов

---

## Рекомендация

**Использовать Вариант A** с добавлением таймаута.

### Почему:

1. **Минимум изменений** — затрагивается только один файл
2. **Не ломает существующую логику** — `completed` по-прежнему работает
3. **Решает проблему** — race condition больше не закрывает оверлей
4. **Таймаут как защита** — если что-то пошло не так, оверлей закроется через 30 секунд

### Шаги реализации:

1. Изменить `useBookProgressWS.ts` (строки 283-288)
2. Добавить таймаут на отсутствие прогресса
3. Протестировать на локальной среде
4. Задеплоить на продакшен

### Оценка времени:

| Задача | Время |
|--------|-------|
| Изменение кода | 15 мин |
| Тестирование локально | 30 мин |
| Code review | 15 мин |
| Деплой | 10 мин |
| **Итого** | **~1 час** |

---

## Тестирование

### Сценарии для проверки:

1. **Первый клик на "Обработать"**
   - Ожидание: Оверлей появляется и остаётся
   - Прогресс обновляется по мере обработки
   - Оверлей закрывается только при 100%

2. **Перезагрузка во время обработки**
   - Ожидание: Оверлей показывает текущий прогресс
   - Продолжает обновляться

3. **Отмена обработки**
   - Ожидание: Оверлей закрывается
   - Книга возвращается в состояние "не обработана"

4. **Сетевая ошибка**
   - Ожидание: Fallback на polling
   - Прогресс продолжает обновляться

5. **Таймаут (30 секунд без прогресса)**
   - Ожидание: Оверлей закрывается с ошибкой
   - Уведомление пользователю

---

## Связанные файлы для справки

```
frontend/src/
├── hooks/
│   ├── useBookProgressWS.ts      ← ОСНОВНОЙ ФАЙЛ ДЛЯ ИСПРАВЛЕНИЯ
│   ├── useBookProcessing.ts
│   └── api/
│       ├── useParsingStatus.ts
│       └── useBooks.ts
├── components/
│   ├── UI/
│   │   └── ParsingOverlay.tsx
│   └── Library/
│       └── BookCard/
│           ├── BookCard.tsx
│           └── ProcessingButtons.tsx
└── api/
    └── books.ts

backend/app/
├── routers/
│   └── books/
│       └── processing.py         ← GET /parsing-status endpoint
├── services/
│   └── parsing_manager.py
└── tasks/
    └── book_tasks.py             ← Celery task + progress publishing
```

---

**Автор:** Claude Code Analysis  
**Создано:** 5 февраля 2026
