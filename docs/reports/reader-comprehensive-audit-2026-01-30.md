# Комплексный аудит читалки fancai

**Дата:** 2026-01-30  
**Версия:** 1.0  
**Автор:** Claude Opus 4.5  
**Статус:** Критический — требуется немедленное исправление

---

## Executive Summary

Проведён комплексный аудит системы читалки fancai (31 хук, 86 компонентов). Обнаружены критические проблемы в lifecycle management, cache invalidation и error handling, которые приводят к:

1. **Бесконечным циклам ошибок 400** "Cannot update inactive session"
2. **Race conditions** между 10+ visibility handlers с разными delays
3. **Stale data** из-за некорректной инвалидации кеша
4. **Silent failures** — ошибки логируются, но не обрабатываются

**Главная проблема:** `usePWAResumeGuard` unmount-ит `EpubReader` при возврате из background → сессия закрывается → при remount читается stale cache → бесконечный цикл ошибок.

**Критическое открытие:** `usePWAResumeGuard` **работает на десктопе** без проверки PWA/mobile режима. Достаточно переключить вкладку на 1.5+ секунды, чтобы триггернуть guard и вызвать cascade ошибок. Это объясняет, почему ошибки наблюдались в десктопном браузере.

---

## Содержание

1. [Ошибки Reading Sessions](#1-ошибки-reading-sessions)
2. [Race Conditions в Visibility Handlers](#2-race-conditions-в-visibility-handlers)
3. [Cache Invalidation Issues](#3-cache-invalidation-issues)
4. [Error Handling Gaps](#4-error-handling-gaps)
5. [Backend Issues](#5-backend-issues)
6. [Recommendations](#6-recommendations)
7. [Анализ usePWAResumeGuard на десктопе](#7-анализ-uspwaresumeward-на-десктопе)
8. [Анализ рисков: Overlay vs Unmount](#8-анализ-рисков-overlay-vs-unmount)

---

## 1. Ошибки Reading Sessions

### 1.1 Описание инцидентов

| Время | Сценарий | Симптомы |
|-------|----------|----------|
| 2026-01-30 13:44 MSK | Возврат из background (2-3 мин idle) | 50+ ошибок 400 за секунду |
| 2026-01-30 14:06 MSK | Выход и возврат в читалку | "Session already ended" → cascade 400 |

### 1.2 Root Cause (5 проблем)

| # | Проблема | Файл | Строки | Критичность |
|---|----------|------|--------|-------------|
| 1 | `usePWAResumeGuard` unmount-ит `EpubReader` при resume | `BookReaderPage.tsx` | 136-145 | **CRITICAL** |
| 2 | Beacon API использует POST вместо PUT | `useReadingSession.ts` | 405-420 | MEDIUM |
| 3 | Stale cache при ремаунте (staleTime=60s) | `useReadingSession.ts` | 73-78 | **CRITICAL** |
| 4 | Нет обработки ошибки "Cannot update inactive session" | `useReadingSession.ts` | 109-112 | **CRITICAL** |
| 5 | Нет обработки ошибки "Session already ended" | `useReadingSession.ts` | 131-135 | **HIGH** |

### 1.3 Архитектурная диаграмма проблемы

```
User returns from background (idle > 1.5s)
    ↓
usePWAResumeGuard sets isResuming=true (line 118)
    ↓
BookReaderPage renders <LoadingSpinner /> instead of <EpubReader /> (line 136-145)
    ↓
EpubReader UNMOUNTS → useReadingSession cleanup → PUT /end → Session CLOSED
    ↓
300ms later: isResuming=false → EpubReader REMOUNTS
    ↓
useReadingSession reads STALE CACHE (staleTime=60s, line 77)
    ↓
sessionIdRef = OLD_SESSION_ID (already closed on server)
    ↓
Interval sends PUT /update every 30s → 400 "Cannot update inactive session"
    ↓
onError only logs (line 110-112), doesn't stop interval → INFINITE LOOP
```

### 1.4 Детальный анализ кода

**BookReaderPage.tsx:136-145 — Проблемный код:**
```tsx
// ПРОБЛЕМА: Conditional rendering unmount-ит EpubReader
if (isResuming || !isReady) {
  return (
    <div className="flex items-center justify-center...">
      <div className="animate-spin..." />
      <p>Восстановление сессии...</p>
    </div>
  );
}
// EpubReader не рендерится → вызывается cleanup → сессия закрывается
return <EpubReader book={bookData} />;
```

**useReadingSession.ts:73-78 — Stale cache:**
```tsx
const { data: activeSession } = useQuery({
  queryKey: [QUERY_KEY_ACTIVE_SESSION],  // 'activeSession'
  queryFn: readingSessionsAPI.getActiveSession,
  staleTime: 60000,  // 1 МИНУТА — данные считаются свежими!
});
// После закрытия сессии при remount возвращается stale data из кеша
```

**useReadingSession.ts:109-112 — Отсутствие обработки ошибки:**
```tsx
onError: (error) => {
  console.error('❌ [useReadingSession] Failed to update session:', error);
  // ❌ Interval продолжает работать!
  // ❌ sessionIdRef не сбрасывается!
  // ❌ Новая сессия не создаётся!
},
```

---

## 2. Race Conditions в Visibility Handlers

### 2.1 Обнаруженные visibility handlers (10+)

| Файл | Handler | Delay | Action | Потенциальный конфликт |
|------|---------|-------|--------|------------------------|
| `usePWAResumeGuard.ts:89` | handleVisibilityChange | 300ms (RESUME_GRACE_PERIOD) | Disable focusManager, wait, re-enable | Unmount EpubReader |
| `useReadingSession.ts:284-305` | handleVisibilityChange | 300ms | Pause/resume interval | Конфликт с PWA guard |
| `useProgressSync.ts:175-212` | handleVisibilityChange | 300ms | Clear/reschedule timeout | Конфликт с PWA guard |
| `useRenditionHealthGuard.ts:189-238` | handleVisibilityChange | 0ms (mobile), 2000ms (desktop) | **Page reload** | Конфликт с PWA guard! |
| `useWakeLock.ts` | handleVisibilityChange | 0ms | Reacquire wake lock | Minor |
| `useOnlineStatus.ts` | visibilitychange | 0ms | Update online state | Minor |
| `queryClient.ts:39-55` | visibilitychange | 0ms | Trigger refetch | Conflict with PWA guard |

### 2.2 Критический race condition

**Проблема:** `useRenditionHealthGuard` может reload страницу **ДО** того, как `usePWAResumeGuard` завершит 300ms grace period.

```
Timeline при resume на mobile:
T+0ms:    visibilityState = 'visible'
T+0ms:    useRenditionHealthGuard → MIN_BACKGROUND_TIME_FOR_RELOAD = 0ms (mobile)
T+0ms:    → window.location.reload() TRIGGERED!
T+300ms:  usePWAResumeGuard → setIsResuming(false) [НИКОГДА НЕ ВЫПОЛНЯЕТСЯ]
```

**Код useRenditionHealthGuard.ts:58-59:**
```typescript
const DEVICE_TYPE = detectDeviceType();
const MIN_BACKGROUND_TIME_FOR_RELOAD = 
  DEVICE_TYPE === 'mobile' || DEVICE_TYPE === 'tablet' ? 0 : 2000;
// Mobile: 0ms threshold = немедленный reload при любом resume!
```

### 2.3 Диаграмма конфликтов

```
┌─────────────────────────────────────────────────────────────────────┐
│                    visibilitychange event                           │
└─────────────────────────────────────────────────────────────────────┘
                               │
      ┌────────────────────────┼────────────────────────┐
      ▼                        ▼                        ▼
┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│ usePWAResumeGuard│  │useReadingSession │  │useRenditionHealthGuard│
│                 │  │                  │  │                     │
│ T+0: isResuming │  │ T+300: resume    │  │ T+0: CHECK time     │
│      = true     │  │   interval       │  │                     │
│ T+300: isResuming│ │                  │  │ mobile: reload!     │
│      = false    │  │                  │  │ desktop: wait 2s    │
└─────────────────┘  └──────────────────┘  └─────────────────────┘
        │                                          │
        │                                          │
        ▼                                          ▼
    EpubReader                               PAGE RELOAD
    unmount/remount                     (loses all React state)
```

### 2.4 Рекомендации по устранению race conditions

1. **Централизовать visibility handling** в один hook/manager
2. **Координировать через shared state** (не через delays)
3. **useRenditionHealthGuard** должен проверять `isResuming` перед reload
4. **Установить минимальный threshold** на mobile (500ms вместо 0)

---

## 3. Cache Invalidation Issues

### 3.1 Карта cache operations

| Файл | Query Key | Operation | When |
|------|-----------|-----------|------|
| `useReadingSession.ts:89` | `['activeSession']` | setQueryData | onSuccess startMutation |
| `useReadingSession.ts:90` | `['readingSession', id]` | setQueryData | onSuccess startMutation |
| `useReadingSession.ts:106` | `['readingSession', id]` | setQueryData | onSuccess updateMutation |
| `useReadingSession.ts:126-127` | `['activeSession']`, `['readingSession', id]` | setQueryData(null) | onSuccess endMutation |
| `useProgressSync.ts:309` | `['book', bookId]` | invalidateQueries | on unmount |
| `stores/auth.ts` | `*` | queryClient.clear() | on logout |

### 3.2 Проблемы

**Проблема 1: setQueryData во время unmount не работает**

```tsx
// useReadingSession.ts:126-127
onSuccess: (endedSession) => {
  // ...
  queryClient.setQueryData([QUERY_KEY_ACTIVE_SESSION], null);  // ❌ Component unmounted!
  // React Query не может обновить state unmounted компонента
}
```

**Проблема 2: staleTime=60s слишком долгий**

```tsx
// useReadingSession.ts:77
staleTime: 60000,  // 1 минута
// После endSession → unmount → remount (< 1 минуты)
// → useQuery возвращает stale data вместо refetch
```

**Проблема 3: invalidateQueries без await**

```tsx
// Некоторые места вызывают invalidate без ожидания
queryClient.invalidateQueries({ queryKey: ['book', bookId] });
// Следующий код может выполниться до завершения invalidation
```

### 3.3 Рекомендации

1. **Уменьшить staleTime** для `activeSession` до 0
2. **Использовать invalidateQueries** вместо setQueryData при unmount
3. **Добавить await** для критических invalidations
4. **Централизовать query keys** в один файл (сейчас разбросаны)

---

## 4. Error Handling Gaps

### 4.1 Silent failures в useReadingSession

| Mutation | onError Handler | Проблема |
|----------|-----------------|----------|
| `updateMutation` (line 109-112) | `console.error()` only | Interval продолжает работать |
| `endMutation` (line 131-135) | `console.error() + onError?.()` | sessionIdRef не сбрасывается |
| `startMutation` (line 93-96) | `console.error() + onError?.()` | OK, но нет retry |

### 4.2 Missing error type checking

```tsx
// Текущий код — не проверяет тип ошибки
onError: (error) => {
  console.error('❌ Failed to update session:', error);
  // Не отличает:
  // - 400 "Cannot update inactive session" (нужно создать новую сессию)
  // - 400 "Session already ended" (то же)
  // - 401 Unauthorized (нужен re-login)
  // - 500 Server Error (retry)
  // - Network Error (retry)
}
```

### 4.3 Error handling gaps в других hooks

| Файл | Проблема |
|------|----------|
| `useProgressSync.ts:127-128` | `catch { console.error() }` — silent failure |
| `useEpubLoader.ts` | Errors показываются в UI, но нет recovery |
| `useDescriptionHighlighting.ts` | `try/catch` с console.error, нет fallback |

### 4.4 Рекомендации

1. **Классифицировать ошибки** по типу (4xx, 5xx, network)
2. **Добавить recovery actions** для каждого типа
3. **Останавливать intervals** при критических ошибках
4. **Добавить user-facing notifications** для важных ошибок

---

## 5. Backend Issues

### 5.1 Missing POST endpoint для Beacon API

**Проблема:** `navigator.sendBeacon()` всегда отправляет POST, но backend имеет только PUT endpoint.

**Текущий код frontend (useReadingSession.ts:417-418):**
```typescript
navigator.sendBeacon(
  `${apiUrl}/reading-sessions/${sessionIdRef.current}/end`,
  beaconData
);
// → POST /reading-sessions/{id}/end → 405 Method Not Allowed
```

**Backend (reading_sessions.py:433):**
```python
@router.put(  # Только PUT!
    "/reading-sessions/{session_id}/end",
    ...
)
async def end_reading_session(...):
```

### 5.2 Backend session validation

Backend корректно проверяет состояние сессии:

```python
# reading_sessions.py:404-409 (update)
if not session.is_active:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Cannot update inactive session",
    )

# reading_sessions.py:492-494 (end)
if not session.is_active:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Session already ended"
    )
```

**Проблема:** Frontend не обрабатывает эти ошибки корректно.

### 5.3 Celery cleanup task

**Положительный момент:** Есть Celery task для cleanup abandoned sessions (>2h):

```python
# reading_sessions_tasks.py (not shown but exists)
# Автоматически закрывает сессии старше 2 часов
```

### 5.4 Рекомендации для backend

1. **Добавить POST endpoint** для Beacon API:
   ```python
   @router.post("/reading-sessions/{session_id}/end", ...)
   async def end_reading_session_beacon(...):
       return await end_reading_session(...)
   ```

2. **Добавить endpoint** для восстановления сессии:
   ```python
   @router.post("/reading-sessions/recover", ...)
   async def recover_session(book_id: str):
       # Если есть активная — вернуть
       # Если нет — создать новую
   ```

---

## 6. Recommendations

### 6.1 P0 — Критические (исправить немедленно)

| # | Задача | Файл | Ожидаемый результат |
|---|--------|------|---------------------|
| 1 | **Не unmount EpubReader при resume** | `BookReaderPage.tsx` | Overlay поверх reader вместо conditional render |
| 2 | **Добавить проверку PWA/mobile в usePWAResumeGuard** | `usePWAResumeGuard.ts` | Guard не активен на десктопе |
| 3 | **Обработка ошибки 400 в updateMutation** | `useReadingSession.ts` | Остановить interval, создать новую сессию |
| 4 | **Уменьшить staleTime** для activeSession | `useReadingSession.ts` | `staleTime: 0` |
| 5 | **Инвалидация при endSession error** | `useReadingSession.ts` | `invalidateQueries(['activeSession'])` |

### 6.2 P1 — Высокий приоритет

| # | Задача | Файл | Ожидаемый результат |
|---|--------|------|---------------------|
| 5 | Добавить POST endpoint для Beacon | `reading_sessions.py` | Beacon API работает |
| 6 | Координация useRenditionHealthGuard с PWA guard | `useRenditionHealthGuard.ts` | Проверять isResuming перед reload |
| 7 | Централизовать visibility handlers | New file | Один менеджер для всех handlers |

### 6.3 P2 — Средний приоритет

| # | Задача | Описание |
|---|--------|----------|
| 8 | Централизовать query keys | Единый файл с константами query keys |
| 9 | Error classification | Разная обработка для 4xx/5xx/network |
| 10 | User notifications | Toast для критических ошибок |

### 6.4 P3 — Низкий приоритет

| # | Задача | Описание |
|---|--------|----------|
| 11 | Audit logging | Централизованный logging для debug |
| 12 | Metrics | Track session recovery success rate |
| 13 | Documentation | Обновить архитектурные диаграммы |

---

## 7. Анализ usePWAResumeGuard на десктопе

### 7.1 Проблема: PWA guard работает везде

**Критическое открытие:** `usePWAResumeGuard` **НЕ проверяет**, является ли приложение PWA или мобильным устройством. Он активен на **любой** платформе, включая десктопный браузер.

```typescript
// usePWAResumeGuard.ts — Единственная проверка:
const MIN_IDLE_TIME_FOR_GUARD = 1500;  // 1.5 секунды

// Если вкладка была неактивна 1.5+ секунды → guard триггерится
if (idleTime < MIN_IDLE_TIME_FOR_GUARD) {
  return;  // Пропустить только если idle < 1.5s
}

// ❌ НЕТ проверки на:
// - isPWA (standalone mode)
// - isMobile/isTablet
// - navigator.standalone
// - display-mode: standalone
// - matchMedia('(display-mode: standalone)')
```

### 7.2 Сравнение с useRenditionHealthGuard

`useRenditionHealthGuard` корректно проверяет тип устройства:

```typescript
// useRenditionHealthGuard.ts — ЕСТЬ проверка:
const DEVICE_TYPE = detectDeviceType();
const MIN_BACKGROUND_TIME_FOR_RELOAD = 
  DEVICE_TYPE === 'mobile' || DEVICE_TYPE === 'tablet' ? 0 : 2000;
// Desktop: 2000ms threshold
// Mobile: 0ms (немедленно)
```

### 7.3 Сценарий на десктопе

| Шаг | Действие | Результат |
|-----|----------|-----------|
| 1 | Пользователь читает книгу в Chrome на ноутбуке | — |
| 2 | Переключается на другую вкладку/окно | `lastHiddenTimeRef = Date.now()` |
| 3 | Работает в другой вкладке **1.5+ секунды** | — |
| 4 | Возвращается в читалку | `idleTime > 1500ms` → guard триггерится |
| 5 | `isResuming = true` | EpubReader **unmount-ится** |
| 6 | `useReadingSession` cleanup | Сессия **закрывается** |
| 7 | 300ms: `isResuming = false` | EpubReader **remount-ится** |
| 8 | Stale cache возвращает старую сессию | Бесконечные 400 ошибки |

### 7.4 Почему это проблема на десктопе

На десктопе JS heap **никогда** не выгружается при переключении вкладок. Проблемы, которые решает `usePWAResumeGuard`, специфичны для mobile PWA:

| Проблема | Mobile PWA | Desktop Browser |
|----------|------------|-----------------|
| JS heap unload | ✅ Происходит | ❌ Не происходит |
| Zustand rehydration delay | ✅ Нужна | ❌ Не нужна |
| epub.js corruption | ✅ Возможна | ❌ Не происходит |
| Auth state loss | ✅ Возможна | ❌ Не происходит |

### 7.5 Рекомендуемое исправление

```typescript
// usePWAResumeGuard.ts — Добавить проверку:

function shouldEnableGuard(): boolean {
  // 1. Проверка на standalone PWA mode
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
  
  // 2. Проверка на мобильное устройство
  const isMobile = /mobile|iphone|ipad|android/i.test(navigator.userAgent);
  
  // Guard нужен только для PWA или мобильных устройств
  return isPWA || isMobile;
}

// В handleVisibilityChange:
const handleVisibilityChange = useCallback(async () => {
  // ...existing code...
  
  // ✅ НОВАЯ ПРОВЕРКА: Пропустить на десктопе
  if (!shouldEnableGuard()) {
    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] Desktop browser detected, skipping guard');
    }
    return;
  }
  
  // ...rest of the code...
}, [loadUserFromStorage]);
```

---

## 8. Анализ рисков: Overlay vs Unmount

### 8.1 Hooks в EpubReader

EpubReader использует 22+ hooks. Анализ их поведения при unmount vs overlay:

| Hook | При Unmount | При Overlay | Риск Overlay |
|------|-------------|-------------|--------------|
| `useReadingSession` | Cleanup → сессия закрывается | Продолжает работать | ✅ **Улучшение** |
| `useProgressSync` | Save + invalidate | Продолжает debounce | ✅ OK |
| `useRenditionHealthGuard` | Cleanup | Может trigger reload | ⚠️ Отдельная логика |
| `useEpubLoader` | Destroy epub.js Book | Book остаётся | ✅ OK (если не corrupted) |
| `useCFITracking` | Reset state | Сохраняет позицию | ✅ OK |
| `useChapterManagement` | Reset | Сохраняет данные | ✅ OK |
| `useDescriptionHighlighting` | Remove handlers | Handlers активны | ⚠️ Нужен pointer-events |
| `useEntityNetwork` | Cancel queries | Queries активны | ✅ OK |
| `useWakeLock` | Release lock | Lock активен | ✅ OK |
| TanStack Query hooks | Refetch при remount | Нет refetch (focusManager off) | ✅ OK |

### 8.2 Потенциальные проблемы overlay

#### Проблема 1: Corrupted epub.js rendition (Mobile only)
```
Сценарий: iOS выгрузил JS heap во время background
При overlay: epub.js rendition может быть сломан
Решение: useRenditionHealthGuard уже делает page reload для этого случая
Статус: ✅ Уже решено другим hook
```

#### Проблема 2: Auth state не готов
```
Сценарий: Zustand ещё не загрузился, EpubReader делает API запросы
При overlay: Запросы упадут с 401
Решение: focusManager.setFocused(false) уже отключает refetch
Статус: ✅ Уже решено в usePWAResumeGuard
```

#### Проблема 3: User interaction во время overlay
```
Сценарий: Пользователь кликает на reader пока показан overlay
При overlay: Клик может пройти сквозь overlay к reader
Решение: Добавить pointer-events: all на overlay container
Статус: ⚠️ Легко решается CSS
```

### 8.3 Оценка рисков

| Аспект | Риск | Оценка |
|--------|------|--------|
| Reading session | Сессия НЕ закрывается | ✅ **Улучшение** |
| epub.js corruption | Решается useRenditionHealthGuard | ✅ Уже решено |
| Auth race condition | focusManager отключен | ✅ Уже решено |
| User interaction | Нужен pointer-events | ⚠️ Легко решить |
| Memory usage | Reader остаётся в памяти | ✅ Незначительно |
| State consistency | Все hooks сохраняют state | ✅ OK |

### 8.4 Вывод

**Overlay подход безопасен** и решает проблему без побочных эффектов:

1. ✅ Сессия чтения **не закрывается** при переключении вкладок
2. ✅ Позиция чтения **сохраняется**
3. ✅ Нет stale cache проблем
4. ✅ Нет race conditions с remount
5. ⚠️ Единственное требование: `pointer-events: all` на overlay

### 8.5 Код overlay с pointer-events

```tsx
// BookReaderPage.tsx — БЕЗОПАСНОЕ исправление
return (
  <div className="fixed inset-0 overflow-hidden bg-background reader-container">
    {/* Overlay блокирует взаимодействие, НО НЕ unmount-ит reader */}
    {(isResuming || !isReady) && (
      <div 
        className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        style={{ pointerEvents: 'all' }}  // Блокирует клики на reader
      >
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full mb-4" />
          <p className="text-muted-foreground">Восстановление сессии...</p>
        </div>
      </div>
    )}
    
    {/* EpubReader ВСЕГДА в DOM — не unmount-ится */}
    <EpubReader book={bookData} />
  </div>
);
```

---

## Приложение A: Полный список visibility handlers

| # | Hook | Events | Delay | Action | Reload? |
|---|------|--------|-------|--------|---------|
| 1 | `usePWAResumeGuard` | visibilitychange | 300ms grace, 1500ms min idle | Disable/enable focusManager | NO |
| 2 | `useReadingSession` | visibilitychange, beforeunload | 300ms | Pause/resume interval, beacon | NO |
| 3 | `useProgressSync` | visibilitychange, beforeunload | 300ms | Pause/resume save, beacon | NO |
| 4 | `useRenditionHealthGuard` | visibilitychange, pagehide, pageshow | **0ms mobile**, 2000ms desktop | Save CFI, **RELOAD** | **YES** |
| 5 | `useWakeLock` | visibilitychange | None | Re-acquire wake lock | NO |
| 6 | `useImageModal` | visibilitychange | 200ms | Pause/resume polling | NO |

---

## Приложение B: Полный список error handling gaps

### CRITICAL: Empty onError handlers

| File | Lines | Mutation | Issue |
|------|-------|----------|-------|
| `useBookProcessing.ts` | 112, 134, 156 | start/cancel/reprocess | `onError: () => {}` - silent |
| `useReadingSession.ts` | 362 | unmount cleanup | `onError: () => {}` - silent |

### CRITICAL: Missing onError handlers

| File | Lines | Mutation |
|------|-------|----------|
| `useStorageInfo.ts` | 90-151 | All 4 mutations (persistence, clear, cleanup) |
| `useBooks.ts` | 552, 675 | delete, updateProgress (rollback only) |

### HIGH: Silent catch blocks

| File | Lines | Issue |
|------|-------|-------|
| `useReadingProgress.ts` | 110-114, 150-152 | Logs only, marks restored on failure |
| `useProgressSync.ts` | 267, 311 | `.catch(() => {})` - completely empty |
| `useAutoParser.ts` | 151 | Polling errors swallowed |
| `useChapter.ts` | 216, 220, 247 | Cache operations silent |

---

## Приложение C: Полный список cache invalidation issues

### Query Key Inconsistencies

| File | Issue |
|------|-------|
| `useProgressSync.ts` | Uses `['book', bookId]` instead of `bookKeys.detail(userId, bookId)` |
| `useStorageInfo.ts` | Uses `['books']` instead of `bookKeys` pattern |
| `useReadingSession.ts` | Uses `['activeSession']` without userId |

### setQueryData vs invalidateQueries

| Hook | Pattern | Risk |
|------|---------|------|
| `useReadingSession` | setQueryData ONLY | Never refetches from server if diverged |
| `useBooks` | Both | OK |
| `useImages` | invalidateQueries | OK |

---

## Приложение D: Код исправлений

### Fix 0: Добавить проверку PWA/mobile в usePWAResumeGuard

```typescript
// usePWAResumeGuard.ts — Добавить в начало файла:

/**
 * Check if PWA resume guard should be enabled.
 * Guard is only needed for:
 * - Standalone PWA mode (installed on home screen)
 * - Mobile/tablet devices (iOS/Android)
 * 
 * On desktop browsers, JS heap is never unloaded on tab switch,
 * so the guard causes more problems than it solves.
 */
function shouldEnableGuard(): boolean {
  // 1. Check for standalone PWA mode
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
  
  // 2. Check for mobile/tablet device
  const ua = navigator.userAgent.toLowerCase();
  const isMobile = /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua);
  const isTablet = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua);
  
  return isPWA || isMobile || isTablet;
}

// В handleVisibilityChange добавить проверку:
const handleVisibilityChange = useCallback(async () => {
  if (document.visibilityState === 'hidden') {
    lastHiddenTimeRef.current = Date.now();
    return;
  }

  // ✅ НОВАЯ ПРОВЕРКА: Skip guard on desktop browser
  if (!shouldEnableGuard()) {
    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] Desktop browser detected, skipping guard');
    }
    return;
  }

  // ...rest of existing code...
}, [loadUserFromStorage]);
```

---

### Fix 1: Не unmount EpubReader

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
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full mb-4" />
          <p className="text-muted-foreground">Восстановление сессии...</p>
        </div>
      </div>
    )}
    <EpubReader book={bookData} />
  </>
);
```

### Fix 2: Обработка ошибки 400 в updateMutation

```tsx
// useReadingSession.ts
const updateMutation = useMutation({
  mutationFn: ({ sessionId, position }: { sessionId: string; position: number }) =>
    readingSessionsAPI.updateSession(sessionId, position),
  onSuccess: (updatedSession) => {
    // existing code...
  },
  onError: (error: Error & { response?: { status: number; data?: { detail?: string } } }) => {
    console.error('❌ [useReadingSession] Failed to update session:', error);
    
    // Check for inactive session error
    const status = error.response?.status;
    const detail = error.response?.data?.detail || '';
    const isInactiveError = status === 400 && 
      (detail.includes('inactive') || detail.includes('already ended'));
    
    if (isInactiveError) {
      console.log('🔄 [useReadingSession] Session inactive, creating new one');
      
      // 1. Stop interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      // 2. Clear pending updates
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      
      // 3. Reset state
      sessionIdRef.current = null;
      hasStartedRef.current = false;
      setSession(null);
      
      // 4. Invalidate cache
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ACTIVE_SESSION] });
      
      // 5. Create new session (will be triggered by Effect 1 after state reset)
    }
  },
});
```

### Fix 3: Уменьшить staleTime

```tsx
// useReadingSession.ts
const { data: activeSession, isLoading: isLoadingActive } = useQuery({
  queryKey: [QUERY_KEY_ACTIVE_SESSION],
  queryFn: readingSessionsAPI.getActiveSession,
  enabled: enabled && !hasStartedRef.current,
  staleTime: 0,      // Always refetch on mount
  gcTime: 5000,      // Quick garbage collection
  refetchOnMount: 'always',  // Force refetch
});
```

### Fix 4: POST endpoint для Beacon API

```python
# reading_sessions.py
@router.post(
    "/reading-sessions/{session_id}/end",
    response_model=ReadingSessionResponse,
    summary="Завершить сессию (Beacon API)",
    description="POST endpoint для Beacon API (navigator.sendBeacon всегда POST).",
)
async def end_reading_session_beacon(
    session_id: UUID,
    request: EndSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """POST wrapper для Beacon API совместимости."""
    return await end_reading_session(
        session_id, request, background_tasks, db, current_user
    )
```

---

## Приложение E: Файлы для изменения

| Приоритет | Файл | Изменения |
|-----------|------|-----------|
| P0 | `frontend/src/pages/BookReaderPage.tsx` | Fix 1: Overlay вместо conditional render |
| P0 | `frontend/src/hooks/pwa/usePWAResumeGuard.ts` | Fix 2: Добавить проверку PWA/mobile |
| P0 | `frontend/src/hooks/useReadingSession.ts` | Fix 3, 4, 5: Error handling, staleTime |
| P1 | `backend/app/routers/reading_sessions.py` | Fix 6: POST endpoint |
| P1 | `frontend/src/hooks/epub/useRenditionHealthGuard.ts` | Координация с PWA guard |

---

## Приложение F: Тестовые сценарии

### Сценарий 1: Resume from background
1. Открыть книгу, читать 1 минуту
2. Свернуть приложение на 2+ минуты
3. Вернуться в приложение
4. **Expected:** Читалка работает, сессия активна
5. **Current:** Cascade 400 errors

### Сценарий 2: Quick exit and return
1. Открыть книгу
2. Нажать "Назад"
3. Сразу вернуться в книгу
4. **Expected:** Сессия продолжается или создаётся новая
5. **Current:** "Session already ended" → cascade 400

### Сценарий 3: Page close
1. Открыть книгу, читать 1 минуту
2. Закрыть вкладку
3. **Expected:** Сессия корректно закрыта, прогресс сохранён
4. **Current:** 405 Method Not Allowed (Beacon API)

---

*Документ создан на основе анализа продакшен-инцидентов и code review 2026-01-30*
