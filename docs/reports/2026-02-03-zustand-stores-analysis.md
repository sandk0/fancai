# Анализ Zustand Stores и сервисов в проекте fancai

**Дата:** 2026-02-03  
**Автор:** Claude Code  
**Scope:** `frontend/src/stores/` и `frontend/src/services/`

---

## Executive Summary

Проведен глубокий анализ 6 Zustand stores и 13 сервисов в проекте fancai. Выявлено **17 проблем** различной степени критичности:
- **P0 (Критические):** 4 проблемы
- **P1 (Высокие):** 7 проблем  
- **P2 (Средние):** 6 проблем

Основные проблемные области: утечки памяти в UIStore, небезопасный доступ к localStorage, отсутствие синхронизации между вкладками, дублирование логики в кэш-сервисах.

---

## Найденные проблемы

### P0 (Критические)

#### 1. Утечка памяти в UIStore - неочищенные setTimeout
**Файл:** `frontend/src/stores/ui.ts`  
**Строки:** 107-111

```typescript
// Auto-dismiss after duration
if (notification.duration) {
  setTimeout(() => {
    get().removeNotification(notification.id);
  }, notification.duration);
}
```

**Проблема:** `setTimeout` создается для каждого уведомления, но никогда не очищается при размонтировании компонента или очистке уведомлений. При быстром добавлении/удалении уведомлений накапливаются "зомби"-таймеры.

**Рекомендация:**
```typescript
// Добавить хранилище таймеров и очистку
const notificationTimers = new Map<string, number>();

addNotification: (notificationData) => {
  const notification: Notification = { ... };
  
  if (notification.duration) {
    const timerId = window.setTimeout(() => {
      get().removeNotification(notification.id);
    }, notification.duration);
    notificationTimers.set(notification.id, timerId);
  }
},

removeNotification: (id) => {
  const timerId = notificationTimers.get(id);
  if (timerId) {
    clearTimeout(timerId);
    notificationTimers.delete(id);
  }
  // ... остальной код
},

clearNotifications: () => {
  notificationTimers.forEach(timerId => clearTimeout(timerId));
  notificationTimers.clear();
  set({ notifications: [] });
}
```

---

#### 2. Небезопасный доступ к localStorage в SSR-контексте
**Файл:** `frontend/src/stores/reader.ts`  
**Строка:** 253

```typescript
reset: () => {
  // ...
  localStorage.removeItem('reader-storage');
}
```

**Проблема:** Прямой доступ к `localStorage` может вызвать ошибку в SSR-контексте (Next.js, SSR-рендеринг), где `localStorage` не определен.

**Рекомендация:**
```typescript
reset: () => {
  // ...
  if (typeof window !== 'undefined') {
    localStorage.removeItem('reader-storage');
  }
}
```

---

#### 3. Отсутствие отмены async операций при размонтировании
**Файл:** `frontend/src/stores/books.ts`  
**Строки:** 38-74

```typescript
fetchBooks: async (page = 1, limit = 10, sortBy?: string) => {
  set({ isLoading: true, error: null });
  try {
    const response = await booksAPI.getBooks(params);
    // ...
  } catch (error) {
    set({ isLoading: false, error: getErrorMessage(error, 'Failed to fetch books') });
    throw error;
  }
}
```

**Проблема:** Если компонент размонтируется во время выполнения `fetchBooks`, setState вызовется на размонтированном компоненте (React warning).

**Рекомендация:** Использовать AbortController или флаг отмены:
```typescript
fetchBooks: async (page = 1, limit = 10, sortBy?: string, signal?: AbortSignal) => {
  set({ isLoading: true, error: null });
  try {
    const response = await booksAPI.getBooks(params, { signal });
    if (signal?.aborted) return;
    // ...
  } catch (error) {
    if (signal?.aborted) return;
    // ...
  }
}
```

---

#### 4. Потенциальная потеря данных в SyncQueue при beforeunload
**Файл:** `frontend/src/services/syncQueue.ts`  
**Строки:** 227-255

```typescript
private handleBeforeUnload(): void {
  const criticalData = localStorage.getItem('syncQueue_critical')
  if (criticalData && navigator.sendBeacon) {
    // ...
    const queued = navigator.sendBeacon('/api/v1/sync/batch', blob)
    // ...
  }
}
```

**Проблема:** `sendBeacon` может не успеть выполниться до закрытия страницы. Нет подтверждения доставки данных.

**Рекомендация:** Добавить механизм подтверждения и повторной попытки:
```typescript
private handleBeforeUnload(): void {
  // Использовать keepalive fetch как fallback
  const criticalData = localStorage.getItem('syncQueue_critical');
  if (criticalData) {
    const blob = new Blob([criticalData], { type: 'application/json' });
    
    // Попытка 1: sendBeacon
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/sync/batch', blob);
    }
    
    // Попытка 2: keepalive fetch (более надежный)
    fetch('/api/v1/sync/batch', {
      method: 'POST',
      body: blob,
      keepalive: true,
      credentials: 'include',
    });
  }
}
```

---

### P1 (Высокие)

#### 5. Дублирование логики кэширования между сервисами
**Файлы:** 
- `frontend/src/services/chapterCache.ts`
- `frontend/src/services/imageCache.ts`
- `frontend/src/services/epubCache.ts`

**Проблема:** Все три сервиса имеют идентичную логику:
- Проверка expiration (TTL)
- LRU cleanup
- Ограничение размера кэша
- Обработка ошибок IndexedDB

**Рекомендация:** Создать базовый класс `BaseCacheService`:
```typescript
abstract class BaseCacheService<T, K> {
  protected abstract table: EntityTable<T, K>;
  protected abstract ttl: number;
  protected abstract maxSize: number;
  
  protected isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > this.ttl;
  }
  
  protected async ensureCacheSize(newEntrySize: number): Promise<void> {
    // Общая логика LRU cleanup
  }
  
  abstract get(id: K): Promise<T | null>;
  abstract set(id: K, data: T): Promise<boolean>;
}
```

---

#### 6. Нет синхронизации состояния между вкладками
**Файлы:** Все stores (`auth.ts`, `reader.ts`, `books.ts`, `images.ts`)

**Проблема:** При открытии приложения в нескольких вкладках изменения в одной вкладке не отражаются в других. Например, прогресс чтения, закладки, настройки ридера.

**Рекомендация:** Использовать BroadcastChannel API для синхронизации:
```typescript
// В reader.ts
const broadcastChannel = typeof window !== 'undefined' 
  ? new BroadcastChannel('fancai-reader-sync')
  : null;

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      // ...
      updateReadingProgress: (bookId, chapter, progress, page) => {
        // ... обновление state
        
        // Синхронизация между вкладками
        broadcastChannel?.postMessage({
          type: 'READING_PROGRESS_UPDATED',
          data: { bookId, chapter, progress, page }
        });
      },
    }),
    // ...
  )
);

// Подписка на изменения из других вкладок
if (broadcastChannel) {
  broadcastChannel.onmessage = (event) => {
    if (event.data.type === 'READING_PROGRESS_UPDATED') {
      // Обновить state без повторной записи
    }
  };
}
```

---

#### 7. Нет graceful degradation при недоступности IndexedDB
**Файл:** `frontend/src/services/db.ts`  
**Строки:** 204-216

```typescript
db.open().catch((err: Error & { name?: string }) => {
  console.error('[DB] Failed to open database:', err)
  if (err.name === 'VersionError' || err.name === 'InvalidStateError') {
    indexedDB.deleteDatabase(DB_NAME)
    window.location.reload()
  }
})
```

**Проблема:** При ошибке IndexedDB происходит полный сброс базы данных. Нет fallback на in-memory хранилище.

**Рекомендация:** Добавить graceful degradation:
```typescript
// Флаг для отслеживания состояния БД
let isDBAvailable = true;
let inMemoryFallback: Map<string, unknown> = new Map();

db.open().catch((err) => {
  console.error('[DB] Failed to open database:', err);
  isDBAvailable = false;
  
  // Уведомить пользователя
  console.warn('[DB] Running in limited mode - data will not persist');
});

// Оборачивать все операции
export async function safeDBOperation<T>(
  operation: () => Promise<T>,
  fallback: () => T
): Promise<T> {
  if (!isDBAvailable) {
    return fallback();
  }
  try {
    return await operation();
  } catch (err) {
    console.warn('[DB] Operation failed, using fallback:', err);
    return fallback();
  }
}
```

---

#### 8. Неконсистентная обработка ошибок в API вызовах
**Файл:** `frontend/src/stores/images.ts`  
**Строки:** 40-88

```typescript
generateImageForDescription: async (descriptionId: string, params = {}) => {
  set({ isGenerating: true, error: null });
  try {
    const response = await imagesAPI.generateImageForDescription(descriptionId, params);
    // ...
  } catch (error) {
    set({
      isGenerating: false,
      error: getErrorMessage(error, 'Failed to generate image')
    });
    throw error;
  }
}
```

**Проблема:** В `catch` блоке `isGenerating` сбрасывается, но при успехе (вне catch) флаг остается `true`.

**Рекомендация:** Использовать `finally` или структурированный подход:
```typescript
generateImageForDescription: async (descriptionId: string, params = {}) => {
  set({ isGenerating: true, error: null });
  try {
    const response = await imagesAPI.generateImageForDescription(descriptionId, params);
    // ...
    return newImage;
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to generate image');
    set({ error: errorMessage });
    throw error;
  } finally {
    set({ isGenerating: false });
  }
}
```

---

#### 9. Отсутствие валидации данных в updateUser
**Файл:** `frontend/src/stores/auth.ts`  
**Строки:** 127-130

```typescript
updateUser: (user) => {
  set({ user });
  localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
}
```

**Проблема:** Нет валидации входных данных. Можно передать некорректный объект user.

**Рекомендация:** Добавить runtime валидацию:
```typescript
updateUser: (user: User) => {
  // Валидация обязательных полей
  if (!user?.id || !user?.email) {
    console.error('[AuthStore] Invalid user data:', user);
    return;
  }
  
  set({ user });
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
  }
}
```

---

#### 10. Нет механизма retry для критических операций
**Файл:** `frontend/src/services/syncQueue.ts`  
**Строки:** 442-501

**Проблема:** При сетевой ошибке операция помечается как failed после maxRetries, но нет механизма автоматического повторного запуска при восстановлении соединения.

**Рекомендация:** Добавить exponential backoff и автоматический retry:
```typescript
private async processOperation(op: SyncOperation): Promise<void> {
  const backoffDelay = Math.min(1000 * Math.pow(2, op.retries), 30000);
  
  if (op.retries > 0) {
    await new Promise(resolve => setTimeout(resolve, backoffDelay));
  }
  
  // ... остальной код
}

// Автоматический retry при online
window.addEventListener('online', () => {
  this.retryFailed();
});
```

---

#### 11. Нет cleanup для VisibilityManager при размонтировании
**Файл:** `frontend/src/services/visibilityManager.ts`  
**Строки:** 112-124

```typescript
start(): void {
  document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
  // ...
}
```

**Проблема:** При вызове `stop()` удаляется listener, но остаются активные таймауты.

**Рекомендация:**
```typescript
stop(): void {
  document.removeEventListener('visibilitychange', () => this.handleVisibilityChange());
  
  // Очистить все таймауты
  this.timeouts.forEach((timeout) => clearTimeout(timeout));
  this.timeouts.clear();
  
  // Сбросить флаг обработки
  this.isProcessing = false;
  
  // ...
}
```

---

### P2 (Средние)

#### 12. Дублирование кода notify в UIStore
**Файл:** `frontend/src/stores/ui.ts`  
**Строки:** 24-60, 126-177

**Проблема:** Дублирование логики notify - один раз внутри store, второй раз как utility функции.

**Рекомендация:** Объединить в единую реализацию:
```typescript
// Только utility функции, store использует их
export const notify = {
  success: (title: string, message?: string) => {
    useUIStore.getState().addNotification({ type: 'success', title, message });
  },
  // ...
};

// Внутри store
notify: {
  success: notify.success,
  error: notify.error,
  // ...
}
```

---

#### 13. Нет типизации для crypto.randomUUID
**Файл:** `frontend/src/services/syncQueue.ts`  
**Строка:** 305

```typescript
id: crypto.randomUUID(),
```

**Проблема:** `crypto.randomUUID()` может не поддерживаться в старых браузерах или незащищенных контекстах (HTTP).

**Рекомендация:** Добавить fallback:
```typescript
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback для старых браузеров
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

---

#### 14. Нет проверки на дублирование при добавлении bookmarks/highlights
**Файл:** `frontend/src/stores/reader.ts`  
**Строки:** 166-180

```typescript
addBookmark: (bookId: string, chapter: number, page: number, text: string) => {
  const bookmark = { chapter, page, text: text.slice(0, 200), createdAt: new Date() };
  set(state => ({
    bookmarks: {
      ...state.bookmarks,
      [bookId]: [...(state.bookmarks[bookId] || []), bookmark],
    },
  }));
}
```

**Проблема:** Можно добавить несколько одинаковых закладок на одну и ту же страницу.

**Рекомендация:** Добавить проверку на дубликаты:
```typescript
addBookmark: (bookId: string, chapter: number, page: number, text: string) => {
  const existing = get().bookmarks[bookId] || [];
  const isDuplicate = existing.some(b => b.chapter === chapter && b.page === page);
  
  if (isDuplicate) {
    console.warn('[ReaderStore] Bookmark already exists for this location');
    return;
  }
  
  // ... добавление закладки
}
```

---

#### 15. Нет ограничения на размер очереди syncQueue
**Файл:** `frontend/src/services/syncQueue.ts`  
**Строки:** 303-357

**Проблема:** Очередь синхронизации может неограниченно расти при длительном offline режиме.

**Рекомендация:** Добавить лимит очереди с приоритизацией:
```typescript
const MAX_QUEUE_SIZE = 1000;

async addOperation(options: AddOperationOptions): Promise<string> {
  // Проверить размер очереди
  const currentSize = await db.syncQueue.count();
  
  if (currentSize >= MAX_QUEUE_SIZE) {
    // Удалить старые low-priority операции
    const oldLowPriority = await db.syncQueue
      .where('priority')
      .equals('low')
      .limit(currentSize - MAX_QUEUE_SIZE + 1)
      .toArray();
    
    await db.syncQueue.bulkDelete(oldLowPriority.map(op => op.id));
  }
  
  // ... добавление операции
}
```

---

#### 16. Нет кэширования результатов getStats в сервисах
**Файлы:** 
- `frontend/src/services/chapterCache.ts` (строки 447-491)
- `frontend/src/services/imageCache.ts` (строки 429-478)

**Проблема:** `getStats()` вызывает `toArray()` на всей таблице, что может быть медленно при большом количестве записей.

**Рекомендация:** Добавить кэширование статистики:
```typescript
private statsCache: CacheStats | null = null;
private statsCacheTime = 0;
private readonly STATS_CACHE_TTL = 5000; // 5 секунд

async getStats(): Promise<CacheStats> {
  // Вернуть кэшированные данные если они свежие
  if (this.statsCache && Date.now() - this.statsCacheTime < this.STATS_CACHE_TTL) {
    return this.statsCache;
  }
  
  // ... вычисление статистики
  
  this.statsCache = stats;
  this.statsCacheTime = Date.now();
  return stats;
}
```

---

#### 17. Нет обработки QuotaExceededError в storageManager
**Файл:** `frontend/src/services/storageManager.ts`  
**Строки:** 584-631

**Проблема:** При превышении квоты хранилища операции IndexedDB будут падать с `QuotaExceededError`.

**Рекомендация:** Добавить обработку:
```typescript
async performCleanup(targetFreeBytes: number): Promise<CleanupResult> {
  try {
    // ... существующая логика
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('[StorageManager] Quota exceeded - emergency cleanup');
      // Агрессивная очистка
      return this.emergencyCleanup();
    }
    throw error;
  }
}

private async emergencyCleanup(): Promise<CleanupResult> {
  // Удалить 50% старых записей
  const allChapters = await db.chapters.toArray();
  const toDelete = allChapters
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
    .slice(0, Math.floor(allChapters.length * 0.5));
  
  await db.chapters.bulkDelete(toDelete.map(c => c.id));
  
  return { freedBytes: 0, itemsRemoved: toDelete.length, targetReached: true };
}
```

---

## Положительные находки

### 1. Хорошая обработка ошибок в сервисах кэширования
Сервисы `chapterCache`, `imageCache`, `epubCache` имеют консистентную обработку ошибок с fallback значениями.

### 2. Правильное использование Dexie.js
Все IndexedDB операции обернуты в try-catch, используются транзакции где необходимо.

### 3. PWA-ориентированная архитектура
Хорошая реализация offline-first подхода с syncQueue, кэшированием и fallback механизмами.

### 4. Типизация
Все stores и сервисы имеют полную TypeScript типизацию.

### 5. Тесты
Наличие unit-тестов для auth и books stores.

---

## Рекомендации по приоритетам

| Приоритет | Действие | Файлы |
|-----------|----------|-------|
| P0 | Исправить утечки памяти | `ui.ts`, `syncQueue.ts` |
| P0 | Добавить SSR-safe доступ к localStorage | `reader.ts`, `auth.ts` |
| P0 | Добавить AbortController для async операций | `books.ts`, `images.ts` |
| P1 | Создать базовый класс для кэш-сервисов | `chapterCache.ts`, `imageCache.ts`, `epubCache.ts` |
| P1 | Реализовать BroadcastChannel синхронизацию | Все stores |
| P1 | Добавить graceful degradation для IndexedDB | `db.ts` |
| P2 | Оптимизировать getStats с кэшированием | `chapterCache.ts`, `imageCache.ts` |
| P2 | Добавить дедупликацию закладок | `reader.ts` |

---

## Метрики

| Метрика | Значение |
|---------|----------|
| Всего файлов проанализировано | 19 |
| Zustand stores | 6 |
| Сервисы | 13 |
| Критических проблем (P0) | 4 |
| Высоких проблем (P1) | 7 |
| Средних проблем (P2) | 6 |
| Строк кода (stores) | ~1,200 |
| Строк кода (services) | ~4,800 |
