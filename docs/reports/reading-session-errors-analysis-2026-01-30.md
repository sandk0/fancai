# Анализ ошибок Reading Sessions в fancai

**Дата:** 2026-01-30  
**Версия:** 1.0  
**Автор:** Claude Opus 4.5  
**Статус:** Критический — требуется немедленное исправление

---

## Executive Summary

Обнаружен критический баг в системе отслеживания reading sessions, который приводит к:
1. Бесконечному циклу ошибок 400 "Cannot update inactive session" 
2. Потере статистики чтения пользователей
3. Засорению логов сервера ошибками каждые 35 секунд
4. Негативному UX — пользователь не видит ошибок, но сессия не сохраняется

**Root Cause:** Конфликт между `usePWAResumeGuard` (unmount EpubReader) и `useReadingSession` (stale cache при remount).

---

## 1. Обнаруженные инциденты

### 1.1 Инцидент: Каскад ошибок после возврата из background

**Время:** 2026-01-30, 13:44-13:51 MSK (10:44-10:51 UTC)

**Симптомы в консоли браузера:**
```
Network Error (50+ запросов за 1 секунду)
500 Internal Server Error
timeout 120000ms exceeded
400 Bad Request: "Cannot update inactive session"
```

**Timeline из логов сервера:**
```
13:39:58 UTC  POST /reading-sessions/start → 200 OK (сессия создана)
13:42:11 UTC  PUT /reading-sessions/{id}/end → 200 OK (сессия ЗАКРЫТА)
...
13:48:53 UTC  PUT /reading-sessions/{id}/update → 400 "Cannot update inactive session"
13:49:29 UTC  PUT /reading-sessions/{id}/update → 400 (повтор)
13:50:04 UTC  PUT /reading-sessions/{id}/update → 400 (повтор)
... (каждые ~35 секунд)
```

**Данные из БД:**
```sql
SELECT * FROM reading_sessions WHERE id = 'af62e44b-6031-428f-8056-2dcbefb10838';

-- Результат:
started_at:      2026-01-30 13:39:58 UTC
ended_at:        2026-01-30 13:42:11 UTC  -- Закрыта через 2 минуты!
is_active:       false
duration_minutes: 2
end_position:    90%
```

---

### 1.2 Инцидент: Ошибка "Session already ended" при выходе

**Время:** 2026-01-30, 14:06 MSK (11:06 UTC)

**Сценарий:**
1. Пользователь нажал кнопку "Назад" в читалке
2. Сразу вернулся обратно в читалку

**Логи консоли браузера:**
```javascript
🧹 [useReadingSession] Component unmounting, ending session
PUT /reading-sessions/af62e44b.../end → 400 (Bad Request)
❌ [ReadingSessions] Failed to end session: "Session already ended"
❌ [useReadingSession] Failed to end session: ...

🚀 [useReadingSession] Initializing session for book: cff43769...
✅ [useReadingSession] Continuing existing session: af62e44b  // STALE!

🔄 [useReadingSession] Updating position: 90.00%
PUT /reading-sessions/af62e44b.../update → 400 (Bad Request)
❌ "Cannot update inactive session"
```

---

## 2. Root Cause Analysis

### 2.1 Архитектурная диаграмма проблемы

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BookReaderPage.tsx                                │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  usePWAResumeGuard()                                            │ │
│  │    → При возврате из background (idle > 1.5 сек):               │ │
│  │    → isResuming = true                                          │ │
│  │    → Показывает LOADING SPINNER                                 │ │
│  │    → EpubReader НЕ РЕНДЕРИТСЯ (unmount!)                        │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              ↓                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  if (isResuming || !isReady) {                                  │ │
│  │    return <LoadingSpinner />;  // EpubReader unmounted!         │ │
│  │  }                                                              │ │
│  │  return <EpubReader book={bookData} />;                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    EpubReader.tsx                                    │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  useReadingSession({ bookId, currentPosition, enabled })        │ │
│  │                                                                 │ │
│  │  При UNMOUNT (Effect 4):                                        │ │
│  │    1. endSessionMutate({ sessionId, position })                 │ │
│  │    2. PUT /reading-sessions/{id}/end → 200 OK                   │ │
│  │    3. Сессия ЗАКРЫТА на backend!                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                       300мс (RESUME_GRACE_PERIOD)
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    EpubReader REMOUNT                                │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  useReadingSession инициализация:                               │ │
│  │                                                                 │ │
│  │  useQuery({                                                     │ │
│  │    queryKey: ['activeSession'],                                 │ │
│  │    queryFn: getActiveSession,                                   │ │
│  │    staleTime: 60000,  // 1 МИНУТА - данные считаются свежими!  │ │
│  │  });                                                            │ │
│  │                                                                 │ │
│  │  → TanStack Query возвращает КЕШИРОВАННЫЙ ответ                 │ │
│  │  → Кеш содержит СТАРУЮ сессию (уже inactive на сервере!)        │ │
│  │  → sessionIdRef.current = OLD_SESSION_ID                        │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    БЕСКОНЕЧНЫЙ ЦИКЛ ОШИБОК                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Effect 2 (периодические updates):                              │ │
│  │    setInterval(() => {                                          │ │
│  │      updatePosition(positionRef.current);  // каждые 30 сек    │ │
│  │    }, 30000);                                                   │ │
│  │                                                                 │ │
│  │  updateMutation.mutate() →                                      │ │
│  │    PUT /reading-sessions/{OLD_ID}/update →                      │ │
│  │    400 "Cannot update inactive session"                         │ │
│  │                                                                 │ │
│  │  onError: (error) => {                                          │ │
│  │    console.error('Failed to update session:', error);           │ │
│  │    // ❌ НЕТ: sessionIdRef.current = null                       │ │
│  │    // ❌ НЕТ: invalidateQueries(['activeSession'])              │ │
│  │    // ❌ НЕТ: создание новой сессии                             │ │
│  │  }                                                              │ │
│  │                                                                 │ │
│  │  → Interval продолжает работать                                 │ │
│  │  → Ошибки каждые 35 секунд (30 сек interval + debounce)         │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Пять корневых причин

| # | Проблема | Файл | Строки | Критичность |
|---|----------|------|--------|-------------|
| 1 | `usePWAResumeGuard` unmount-ит `EpubReader` при resume | `BookReaderPage.tsx` | 136-145 | **CRITICAL** |
| 2 | Beacon API использует POST вместо PUT | `useReadingSession.ts` | 405-420 | MEDIUM |
| 3 | Stale cache при ремаунте (staleTime=60s) | `useReadingSession.ts` | 73-78 | **CRITICAL** |
| 4 | Нет обработки ошибки "Cannot update inactive session" | `useReadingSession.ts` | 109-112 | **CRITICAL** |
| 5 | Нет обработки ошибки "Session already ended" | `useReadingSession.ts` | 131-135 | **HIGH** |

---

## 3. Детальное описание каждой проблемы

### 3.1 Проблема 1: usePWAResumeGuard unmount-ит EpubReader

**Локация:** `frontend/src/pages/BookReaderPage.tsx:136-145`

```tsx
// Текущий код:
const { isResuming, isReady } = usePWAResumeGuard();

if (isResuming || !isReady) {
  return (
    <div>
      <div className="animate-spin..." />
      <p>Восстановление сессии...</p>
    </div>
  );
}

return <EpubReader book={bookData} />;  // EpubReader не рендерится!
```

**Проблема:** При `isResuming=true` компонент `EpubReader` полностью размонтируется. Это триггерит cleanup в `useReadingSession`, который закрывает сессию.

**Ожидаемое поведение:** EpubReader должен оставаться в DOM, но с disabled interactions.

---

### 3.2 Проблема 2: Beacon API несовместим с backend

**Локация:** `frontend/src/hooks/useReadingSession.ts:405-420`

```tsx
// Текущий код (beforeunload handler):
navigator.sendBeacon(
  `${apiUrl}/reading-sessions/${sessionIdRef.current}/end`,
  beaconData
);
```

**Проблема:** `navigator.sendBeacon()` всегда отправляет **POST** запрос, но backend endpoint `/reading-sessions/{id}/end` ожидает **PUT**.

**Результат в логах:**
```
POST /reading-sessions/{id}/end → 405 Method Not Allowed
```

**Решения:**
- Вариант A: Добавить POST endpoint на backend
- Вариант B: Использовать `fetch` с `keepalive: true` вместо `sendBeacon`

---

### 3.3 Проблема 3: Stale cache при ремаунте

**Локация:** `frontend/src/hooks/useReadingSession.ts:73-78`

```tsx
// Текущий код:
const { data: activeSession } = useQuery({
  queryKey: [QUERY_KEY_ACTIVE_SESSION],
  queryFn: readingSessionsAPI.getActiveSession,
  staleTime: 60000,  // 1 минута!
});
```

**Проблема:** После закрытия сессии (через `endMutation`) кеш не инвалидируется. При ремаунте компонента TanStack Query возвращает stale данные из кеша.

**Timeline:**
1. `endMutation.onSuccess` делает `setQueryData(['activeSession'], null)` 
2. **НО:** Компонент уже unmounted, React Query state не обновляется
3. При remount: `useQuery` возвращает старый кешированный результат
4. `sessionIdRef.current = OLD_SESSION_ID`

---

### 3.4 Проблема 4: Нет обработки ошибки 400 при update

**Локация:** `frontend/src/hooks/useReadingSession.ts:109-112`

```tsx
// Текущий код:
const updateMutation = useMutation({
  mutationFn: ({ sessionId, position }) =>
    readingSessionsAPI.updateSession(sessionId, position),
  onSuccess: (updatedSession) => {
    setSession(updatedSession);
    lastUpdateRef.current = Date.now();
  },
  onError: (error) => {
    console.error('❌ Failed to update session:', error);
    // ❌ Interval продолжает работать!
    // ❌ sessionIdRef не сбрасывается!
    // ❌ Новая сессия не создаётся!
  },
});
```

**Ожидаемое поведение при ошибке 400 "Cannot update inactive session":**
1. Остановить interval
2. Сбросить `sessionIdRef.current = null`
3. Сбросить `hasStartedRef.current = false`
4. Инвалидировать кеш `['activeSession']`
5. Попытаться создать новую сессию

---

### 3.5 Проблема 5: Нет обработки ошибки "Session already ended"

**Локация:** `frontend/src/hooks/useReadingSession.ts:131-135`

```tsx
// Текущий код:
const endMutation = useMutation({
  // ...
  onError: (error) => {
    console.error('❌ Failed to end session:', error);
    isEndingRef.current = false;
    onError?.(error);
    // ❌ sessionIdRef НЕ сбрасывается!
    // ❌ Кеш НЕ инвалидируется!
  },
});
```

**Проблема:** При ошибке "Session already ended" (400) нужно:
1. Сбросить `sessionIdRef.current = null`
2. Инвалидировать кеш `['activeSession']`
3. НЕ пытаться снова закрыть сессию

---

## 4. Влияние на пользователей

### 4.1 Функциональное влияние

| Проблема | Влияние на UX |
|----------|--------------|
| Потеря статистики чтения | Streak пользователя не обновляется, reading time не учитывается |
| Бесконечные ошибки в консоли | Засорение логов разработчика |
| Нагрузка на сервер | 1 запрос каждые 35 сек × N активных пользователей |
| Battery drain | Постоянные network requests на мобильных |

### 4.2 Метрики влияния

На основе данных продакшена:
- **Частота:** Каждый пользователь, который отошёл от читалки на >1.5 сек
- **Severity:** 400 ошибки каждые 35 секунд до закрытия вкладки
- **Recovery:** Нет автоматического восстановления

---

## 5. Рекомендации по исправлению

### 5.1 P0 — Критические (исправить немедленно)

#### Fix 1: Не unmount-ить EpubReader при resume

```tsx
// BookReaderPage.tsx
// БЫЛО:
if (isResuming || !isReady) {
  return <LoadingSpinner />;
}
return <EpubReader book={bookData} />;

// ДОЛЖНО БЫТЬ:
return (
  <>
    {(isResuming || !isReady) && (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80">
        <LoadingSpinner />
      </div>
    )}
    <EpubReader book={bookData} />
  </>
);
```

#### Fix 2: Обработка ошибки 400 в updateMutation

```tsx
// useReadingSession.ts
onError: (error) => {
  console.error('❌ Failed to update session:', error);
  
  // Проверяем на inactive session
  const isInactiveError = 
    error?.response?.status === 400 &&
    (error?.response?.data?.detail?.includes('inactive') ||
     error?.response?.data?.detail?.includes('already ended'));
  
  if (isInactiveError) {
    // Останавливаем interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Сбрасываем state
    sessionIdRef.current = null;
    hasStartedRef.current = false;
    
    // Инвалидируем кеш
    queryClient.invalidateQueries({ 
      queryKey: [QUERY_KEY_ACTIVE_SESSION] 
    });
    
    // Пытаемся создать новую сессию
    startMutation.mutate({ bookId, position: positionRef.current });
  }
},
```

#### Fix 3: Уменьшить staleTime для activeSession

```tsx
// useReadingSession.ts
const { data: activeSession } = useQuery({
  queryKey: [QUERY_KEY_ACTIVE_SESSION],
  queryFn: readingSessionsAPI.getActiveSession,
  staleTime: 0,  // Всегда refetch при mount
  gcTime: 5000,  // Быстрая очистка кеша
});
```

### 5.2 P1 — Высокий приоритет

#### Fix 4: Инвалидация при endSession

```tsx
// useReadingSession.ts - endMutation
onSuccess: (endedSession) => {
  // Существующий код...
  
  // Добавить: инвалидация кеша
  queryClient.invalidateQueries({ 
    queryKey: [QUERY_KEY_ACTIVE_SESSION] 
  });
},
onError: (error) => {
  // Существующий код...
  
  // Добавить: сброс state при любой ошибке
  sessionIdRef.current = null;
  hasStartedRef.current = false;
  
  queryClient.invalidateQueries({ 
    queryKey: [QUERY_KEY_ACTIVE_SESSION] 
  });
},
```

### 5.3 P2 — Средний приоритет

#### Fix 5: Добавить POST endpoint для Beacon API

```python
# backend/app/routers/reading_sessions.py
@router.post(
    "/reading-sessions/{session_id}/end",
    response_model=ReadingSessionResponse,
    summary="Завершить сессию (Beacon API)",
)
async def end_reading_session_beacon(
    session_id: UUID,
    request: EndSessionRequest,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """POST endpoint для Beacon API (sendBeacon всегда POST)."""
    return await end_reading_session(session_id, request, db, current_user)
```

---

## 6. Приложение: Полный stack trace ошибок

### Stack trace 1: Network Error cascade
```
invalidateQueries @ vendor-data-w_bQLQFv.js:9
(anonymous) @ BookReaderPage-CC3X5lun.js:21
setTimeout
Promise.then
(anonymous) @ BookReaderPage-CC3X5lun.js:21
refetchQueries → fetch → setData → batch → updateReadingProgress
```

### Stack trace 2: Cannot update inactive session
```
PUT /reading-sessions/{id}/update 400
updateSession @ BookReaderPage-CC3X5lun.js:169
mutationFn @ BookReaderPage-CC3X5lun.js:169
execute → mutate → setInterval
```

---

## 7. Контакты и эскалация

| Роль | Контакт |
|------|---------|
| Frontend Lead | - |
| Backend Lead | - |
| DevOps | - |

**Severity:** P0 — требует немедленного исправления  
**ETA исправления:** Рекомендуется 24-48 часов

---

*Документ создан на основе анализа продакшен-инцидентов 2026-01-30*
