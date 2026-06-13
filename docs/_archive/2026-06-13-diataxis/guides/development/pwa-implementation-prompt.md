# Промпт для внедрения PWA в fancai

> **Тип документа:** Промпт для реализации (для Claude Code / AI-ассистента)
> **Создан:** 2026-01-09
> **Обновлён:** 2026-01-09 (с учётом современных практик)
> **Цель:** Полноценное внедрение Progressive Web App для книжного ридера fancai

---

## 1. Контекст проекта

### 1.1 Описание приложения

**fancai** — веб-приложение для чтения художественной литературы с автоматической генерацией AI-изображений из книжных описаний. Поддерживает форматы EPUB и FB2 с подписочной моделью монетизации (FREE/PREMIUM/ULTIMATE).

**Основные функции:**
- Загрузка и парсинг EPUB/FB2 книг
- Отслеживание позиции чтения на основе CFI
- Извлечение описаний с помощью LLM (Google Gemini 3.0 Flash)
- Генерация AI-изображений из описаний (Google Imagen 4)
- Поддержка тем (Светлая/Тёмная/Сепия/Системная)
- Мультиязычный интерфейс (English/Русский)

### 1.2 Технологический стек

| Слой | Технологии | Версии |
|------|-----------|--------|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS | 19.0, 5.7, 6.0, 3.4 |
| **Управление состоянием** | TanStack Query, Zustand | 5.90, 5.0 |
| **EPUB Reader** | epub.js с CFI-навигацией | 0.3.93 |
| **Backend** | FastAPI, Python, PostgreSQL, Redis | 0.125, 3.11, 15, 5.2 |
| **Фоновые задачи** | Celery с Redis broker | 5.4 |
| **AI-сервисы** | Google Gemini API, Google Imagen 4 | 3.0 Flash, 4.0 |

### 1.3 Текущее состояние PWA (базовый уровень)

**Уже реализовано:**

| Компонент | Статус | Расположение |
|-----------|--------|--------------|
| Service Worker | v1.3.0 (488 строк) | `/public/sw.js` |
| Web Manifest | Полный (199 строк) | `/public/manifest.json` |
| IndexedDB кэш глав | Работает | `/src/services/chapterCache.ts` (~600 строк) |
| IndexedDB кэш изображений | Работает | `/src/services/imageCache.ts` (~500 строк) |
| Очередь синхронизации | Реализована | `/src/services/syncQueue.ts` (312 строк) |
| Определение онлайн-статуса | Работает | `/src/hooks/useOnlineStatus.ts` (87 строк) |
| Offline баннер | UI-компонент | `/src/components/UI/OfflineBanner.tsx` |
| Сохранение темы | localStorage | `/src/hooks/useTheme.ts` |
| Обработчик install prompt | Заготовка | `/src/utils/serviceWorker.ts` (309 строк) |

**Отсутствует/требует доработки:**

| Пробел | Приоритет | Влияние |
|--------|-----------|---------|
| Интеграция Workbox | P0 | Текущий SW написан вручную, сложно поддерживать |
| Precaching JS/CSS бандлов | P0 | App shell не кэшируется при установке |
| Background Sync API | P1 | syncQueue использует localStorage, не SW Background Sync |
| Push-уведомления | P1 | VAPID ключи не настроены, нет бэкенд-эндпоинтов |
| Offline fallback страница | P1 | Нет offline.html для некэшированных роутов |
| Полное offline чтение EPUB | P1 | Частично — зависит от состояния IndexedDB кэша |
| Воркэраунды для iOS Safari | P2 | Ограниченная поддержка PWA на iOS |
| Управление квотой кэша | P2 | Нет интеграции StorageManager API |

---

## 2. Современные практики PWA (2025-2026)

### 2.1 Актуальные версии библиотек

| Библиотека | Актуальная версия | Ключевые особенности |
|------------|-------------------|----------------------|
| **vite-plugin-pwa** | 0.21.x | Поддержка Vite 6, Workbox 7.3, улучшенный messageSkipWaiting |
| **Workbox** | 7.3.0 | Требует Node 16+, улучшенная производительность |
| **Dexie.js** | 4.x | liveQuery() для реактивных обновлений, поддержка React hooks |
| **web-push** | 3.6.x | VAPID поддержка, совместимость с Safari |
| **@tanstack/react-query** | 5.90.x | networkMode: 'offlineFirst', persist plugins |

### 2.2 Поддержка мобильных платформ

#### iOS 26 (Safari)

| Функция | Поддержка | Примечания |
|---------|-----------|------------|
| Service Worker | Полная (с iOS 11.3) | Стандартная реализация |
| Push-уведомления | iOS 16.4+ | Только для установленных PWA, требует standalone mode |
| Background Sync | Не поддерживается | Используем workaround через `visibilitychange` |
| Periodic Sync | Не поддерживается | Используем push для триггера синхронизации |
| IndexedDB | Полная | 7-дневное автоудаление без persistent storage |
| Install Prompt | Не поддерживается | Показываем инструкции "Add to Home Screen" |
| File Handlers | iOS 15+ | Работает для установленных PWA |
| Share Target | iOS 15+ | POST multipart/form-data |

**Критические требования для iOS:**
1. `display: standalone` или `fullscreen` в manifest для push-уведомлений
2. Запрос `navigator.storage.persist()` для предотвращения 7-дневного удаления данных
3. Синхронизация через `visibilitychange` событие вместо Background Sync

#### Android 16 (Chrome)

| Функция | Поддержка | Примечания |
|---------|-----------|------------|
| Service Worker | Полная | Все возможности |
| Push-уведомления | Полная | VAPID через Web Push API |
| Background Sync | Полная | Workbox BackgroundSyncPlugin |
| Periodic Sync | Chrome 80+ | Требует установки PWA, зависит от engagement |
| IndexedDB | Полная | Большие квоты (до 80% диска) |
| Install Prompt | Полная | `beforeinstallprompt` событие |
| Window Controls Overlay | Chrome 130+ | Расширение UI в title bar |
| File Handlers | Chrome 102+ | Полная поддержка |
| TWA (Trusted Web Activity) | Полная | Публикация в Play Store через Bubblewrap |

**Новые возможности Android 16:**
- Desktop mode для планшетов (аналог ChromeOS)
- Улучшенная интеграция PWA с системой
- Window Controls Overlay для нативного вида

### 2.3 Рекомендации по архитектуре

**Источники:** [web.dev](https://web.dev/learn/pwa/), [VitePWA Docs](https://vite-pwa-org.netlify.app/), [Workbox](https://developer.chrome.com/docs/workbox/)

#### Offline-First подход (2025-2026)

> "Offline-first раньше был дополнительной опцией. В 2025 году это основа устойчивого пользовательского опыта."

**Ключевые принципы:**
1. **Локальная БД — источник истины** даже при наличии сети
2. **Все мутации сначала пишутся в IndexedDB** для мгновенной обратной связи
3. **Service Worker перехватывает запросы** и возвращает кэшированные ответы
4. **Фоновая синхронизация** отправляет изменения на сервер при появлении сети

#### TanStack Query + IndexedDB

```typescript
// Рекомендуемая конфигурация для offline-first
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst', // Критично для PWA!
      staleTime: 1000 * 60 * 5, // 5 минут
      gcTime: 1000 * 60 * 60 * 24, // 24 часа
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});
```

**Дополнительные пакеты:**
- `@tanstack/query-async-storage-persister` — персистор для IndexedDB
- `@tanstack/react-query-persist-client` — автоматическое сохранение кэша

---

## 3. Требования к реализации

### 3.1 Service Worker (Workbox + VitePWA)

**Использовать VitePWA plugin** с Workbox 7.3 для поддерживаемого, production-ready service worker.

**Установка зависимостей:**
```bash
npm install -D vite-plugin-pwa workbox-window
```

**Стратегии кэширования:**

| Тип ресурса | Стратегия | TTL | Примечания |
|-------------|-----------|-----|------------|
| App Shell (index.html) | CacheFirst | Бессрочно (версионирован) | Precache при установке |
| JS/CSS бандлы | CacheFirst | Бессрочно (хэш в имени) | Precache при установке |
| Статические ассеты (шрифты, иконки) | CacheFirst | 30 дней | Precache при установке |
| API: Список книг | NetworkFirst | 5 мин | StaleWhileRevalidate fallback |
| API: Контент главы | NetworkFirst | 1 час | Fallback на IndexedDB |
| API: Описания | NetworkFirst | 1 час | Fallback на IndexedDB |
| Сгенерированные изображения | CacheFirst | 30 дней | Хранить в IndexedDB как blob |
| Внешние изображения | CacheFirst | 30 дней | pollinations.ai, обложки |

**Конфигурация VitePWA (vite.config.ts):**

```typescript
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // Пользователь решает когда обновлять
      injectRegister: 'auto',

      // Настройки Workbox
      workbox: {
        // Precache файлы
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,woff2,woff}'
        ],

        // Runtime caching стратегии
        runtimeCaching: [
          // Шрифты Google
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 год
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // API запросы - Network First
          {
            urlPattern: /^\/api\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 час
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Изображения
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 дней
              },
            },
          },
        ],

        // Навигация
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],

        // Очистка устаревших кэшей
        cleanupOutdatedCaches: true,

        // НЕ активировать автоматически - ждём действия пользователя
        clientsClaim: false,
        skipWaiting: false,
      },

      // Manifest опции (использовать существующий)
      manifest: false, // Используем /public/manifest.json

      // Dev опции
      devOptions: {
        enabled: true, // Включить SW в dev mode для тестирования
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
})
```

### 3.2 Управление обновлениями Service Worker

**Best Practice:** Пользователь контролирует момент обновления

**Почему не автообновление:**
- Пользователь может быть в середине важной операции
- Случайный refresh может привести к потере несохранённых данных
- На медленных устройствах обновление может занять время

**Компонент уведомления об обновлении:**

```typescript
// src/components/UI/PWAUpdatePrompt.tsx
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Проверять обновления каждый час
      if (registration) {
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96
                    bg-card border border-border rounded-lg shadow-lg p-4 z-50">
      <div className="flex items-start gap-3">
        <RefreshIcon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-foreground">
            Доступна новая версия
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Обновите приложение для получения улучшений и исправлений
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNeedRefresh(false)}
        >
          Позже
        </Button>
        <Button
          size="sm"
          onClick={() => updateServiceWorker(true)}
        >
          Обновить
        </Button>
      </div>
    </div>
  )
}
```

### 3.3 Offline чтение (полная поддержка)

**Цель:** Полноценный опыт чтения книг offline с кэшированными главами, изображениями и синхронизацией прогресса.

#### Стратегия Prefetch

1. **При открытии книги:** кэшировать текущую главу + 2 следующие
2. **При навигации:** prefetch следующей главы в фоне
3. **По запросу пользователя:** batch prefetch всей книги ("Скачать для offline")

#### Миграция на Dexie.js

**Рекомендация:** Заменить прямое использование IndexedDB на Dexie.js для:
- Реактивных обновлений через `useLiveQuery()`
- Транзакционной целостности
- Более простого API и меньше boilerplate

**Установка:**
```bash
npm install dexie dexie-react-hooks
```

**Схема базы данных (Dexie):**

```typescript
// src/services/db.ts
import Dexie, { type EntityTable } from 'dexie'

// Типы сущностей
interface OfflineBook {
  id: string // `${userId}:${bookId}`
  userId: string
  bookId: string
  metadata: {
    title: string
    author: string
    coverUrl: string
    totalChapters: number
    fileSize: number
  }
  downloadedAt: number
  lastAccessedAt: number
  downloadProgress: number // 0-100%
  status: 'downloading' | 'complete' | 'partial' | 'error'
}

interface CachedChapter {
  id: string // `${userId}:${bookId}:${chapterNumber}`
  userId: string
  bookId: string
  chapterNumber: number
  title: string
  content: string // HTML
  descriptions: Description[]
  images: CachedImage[]
  wordCount: number
  cachedAt: number
  lastAccessedAt: number
}

interface CachedImage {
  id: string // `${userId}:${descriptionId}`
  userId: string
  descriptionId: string
  bookId: string
  blob: Blob
  mimeType: string
  size: number
  cachedAt: number
}

interface SyncOperation {
  id: string
  type: 'progress' | 'bookmark' | 'highlight' | 'reading_session' | 'image_generation'
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  userId: string
  bookId?: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  createdAt: number
  retries: number
  maxRetries: number
  lastError?: string
  status: 'pending' | 'syncing' | 'failed'
}

// База данных
class FancaiDatabase extends Dexie {
  offlineBooks!: EntityTable<OfflineBook, 'id'>
  chapters!: EntityTable<CachedChapter, 'id'>
  images!: EntityTable<CachedImage, 'id'>
  syncQueue!: EntityTable<SyncOperation, 'id'>

  constructor() {
    super('FancaiDB')

    this.version(1).stores({
      offlineBooks: 'id, userId, bookId, status, lastAccessedAt',
      chapters: 'id, [userId+bookId], [userId+bookId+chapterNumber], lastAccessedAt',
      images: 'id, userId, bookId, descriptionId, cachedAt',
      syncQueue: 'id, userId, type, priority, status, createdAt',
    })
  }
}

export const db = new FancaiDatabase()
```

#### React Hooks для offline данных

```typescript
// src/hooks/useOfflineBook.ts
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/services/db'

export function useOfflineBook(bookId: string) {
  const userId = useCurrentUserId()

  const offlineBook = useLiveQuery(
    () => db.offlineBooks.get(`${userId}:${bookId}`),
    [userId, bookId]
  )

  const chapters = useLiveQuery(
    () => db.chapters
      .where('[userId+bookId]')
      .equals([userId, bookId])
      .toArray(),
    [userId, bookId]
  )

  const isAvailableOffline = offlineBook?.status === 'complete'
  const downloadProgress = offlineBook?.downloadProgress ?? 0

  return {
    offlineBook,
    chapters,
    isAvailableOffline,
    downloadProgress,
  }
}
```

#### Менеджер загрузок

```typescript
// src/services/downloadManager.ts
import { db } from './db'

export class DownloadManager {
  private abortControllers = new Map<string, AbortController>()

  async downloadBook(
    bookId: string,
    userId: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const key = `${userId}:${bookId}`

    // Проверяем квоту перед загрузкой
    const storageManager = new StorageManager()
    const canDownload = await storageManager.canDownload(50 * 1024 * 1024) // ~50MB
    if (!canDownload) {
      throw new Error('Недостаточно места для загрузки')
    }

    // Создаём запись о загрузке
    await db.offlineBooks.put({
      id: key,
      userId,
      bookId,
      metadata: await this.fetchBookMetadata(bookId),
      downloadedAt: Date.now(),
      lastAccessedAt: Date.now(),
      downloadProgress: 0,
      status: 'downloading',
    })

    const controller = new AbortController()
    this.abortControllers.set(key, controller)

    try {
      // Получаем список глав
      const chapters = await this.fetchChaptersList(bookId)
      const total = chapters.length

      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) {
          throw new Error('Загрузка отменена')
        }

        await this.downloadChapter(userId, bookId, chapters[i])

        const progress = Math.round(((i + 1) / total) * 100)
        await db.offlineBooks.update(key, { downloadProgress: progress })
        onProgress?.(progress)
      }

      await db.offlineBooks.update(key, { status: 'complete' })
    } catch (error) {
      if ((error as Error).message !== 'Загрузка отменена') {
        await db.offlineBooks.update(key, { status: 'error' })
      }
      throw error
    } finally {
      this.abortControllers.delete(key)
    }
  }

  cancelDownload(bookId: string, userId: string): void {
    const key = `${userId}:${bookId}`
    const controller = this.abortControllers.get(key)
    controller?.abort()

    db.offlineBooks.update(key, { status: 'partial' })
  }

  async deleteOfflineBook(bookId: string, userId: string): Promise<void> {
    const key = `${userId}:${bookId}`

    await db.transaction('rw', db.offlineBooks, db.chapters, db.images, async () => {
      await db.offlineBooks.delete(key)
      await db.chapters.where('[userId+bookId]').equals([userId, bookId]).delete()
      await db.images.where({ userId, bookId }).delete()
    })
  }

  private async downloadChapter(
    userId: string,
    bookId: string,
    chapter: ChapterInfo
  ): Promise<void> {
    // Загружаем контент главы
    const content = await api.getChapterContent(bookId, chapter.number)

    // Загружаем описания
    const descriptions = await api.getDescriptions(bookId, chapter.number)

    // Загружаем изображения как blob
    const images: CachedImage[] = []
    for (const desc of descriptions) {
      if (desc.imageUrl) {
        const blob = await this.fetchImageAsBlob(desc.imageUrl)
        images.push({
          id: `${userId}:${desc.id}`,
          userId,
          descriptionId: desc.id,
          bookId,
          blob,
          mimeType: blob.type,
          size: blob.size,
          cachedAt: Date.now(),
        })
      }
    }

    // Сохраняем в IndexedDB
    await db.transaction('rw', db.chapters, db.images, async () => {
      await db.chapters.put({
        id: `${userId}:${bookId}:${chapter.number}`,
        userId,
        bookId,
        chapterNumber: chapter.number,
        title: chapter.title,
        content: content.html,
        descriptions,
        images,
        wordCount: content.wordCount,
        cachedAt: Date.now(),
        lastAccessedAt: Date.now(),
      })

      await db.images.bulkPut(images)
    })
  }

  private async fetchImageAsBlob(url: string): Promise<Blob> {
    const response = await fetch(url)
    return response.blob()
  }
}
```

### 3.4 Background Sync (полная офлайн-очередь)

**Миграция с localStorage на SW Background Sync API с Workbox.**

**Поддерживаемые операции:**
- `progress` — Позиция чтения (CFI, scroll offset) — **Критичная**
- `bookmark` — Закладки пользователя — **Высокая**
- `highlight` — Выделения текста — **Высокая**
- `reading_session` — Начало/конец/обновление сессии — **Критичная**
- `image_generation` — Очередь запросов на генерацию — **Нормальная**

**Реализация с Workbox:**

```typescript
// src/sw.ts (injectManifest mode)
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkOnly, NetworkFirst } from 'workbox-strategies'
import { BackgroundSyncPlugin } from 'workbox-background-sync'
import { ExpirationPlugin } from 'workbox-expiration'

declare let self: ServiceWorkerGlobalScope

// Precache статики
precacheAndRoute(self.__WB_MANIFEST)

// Background Sync для критичных операций
const criticalSyncPlugin = new BackgroundSyncPlugin('fancai-critical-sync', {
  maxRetentionTime: 24 * 60, // 24 часа
  onSync: async ({ queue }) => {
    let entry
    while ((entry = await queue.shiftRequest())) {
      try {
        const response = await fetch(entry.request.clone())
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        // Уведомляем клиента об успешной синхронизации
        const clients = await self.clients.matchAll()
        clients.forEach(client => {
          client.postMessage({
            type: 'SYNC_SUCCESS',
            url: entry.request.url,
          })
        })
      } catch (error) {
        await queue.unshiftRequest(entry)
        throw error
      }
    }
  },
})

// Регистрируем роуты для синхронизации

// Прогресс чтения
registerRoute(
  ({ url }) => url.pathname.match(/\/api\/v1\/books\/[^/]+\/progress$/),
  new NetworkOnly({
    plugins: [criticalSyncPlugin],
  }),
  'POST'
)

// Сессии чтения
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/reading-sessions'),
  new NetworkOnly({
    plugins: [criticalSyncPlugin],
  }),
  'POST'
)
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/reading-sessions'),
  new NetworkOnly({
    plugins: [criticalSyncPlugin],
  }),
  'PUT'
)

// Генерация изображений (менее критичная очередь)
const imageSyncPlugin = new BackgroundSyncPlugin('fancai-image-sync', {
  maxRetentionTime: 7 * 24 * 60, // 7 дней
})

registerRoute(
  ({ url }) => url.pathname.match(/\/api\/v1\/images\/generate/),
  new NetworkOnly({
    plugins: [imageSyncPlugin],
  }),
  'POST'
)
```

**iOS Workaround (без Background Sync):**

```typescript
// src/services/syncQueue.ts
class SyncQueue {
  private db: FancaiDatabase

  constructor() {
    this.db = db
    this.setupVisibilitySync()
  }

  private setupVisibilitySync(): void {
    // iOS не поддерживает Background Sync
    // Синхронизируем при возврате в приложение
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.processQueue()
      }
    })

    // Синхронизируем при восстановлении сети
    window.addEventListener('online', () => {
      this.processQueue()
    })
  }

  async addOperation(operation: Omit<SyncOperation, 'id' | 'createdAt' | 'retries' | 'status'>): Promise<void> {
    const op: SyncOperation = {
      ...operation,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      retries: 0,
      status: 'pending',
    }

    await this.db.syncQueue.add(op)

    // Попытка немедленной синхронизации если онлайн
    if (navigator.onLine) {
      this.processQueue()
    }
  }

  async processQueue(): Promise<void> {
    const operations = await this.db.syncQueue
      .where('status')
      .equals('pending')
      .sortBy('createdAt')

    // Сортируем по приоритету
    const sorted = operations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    for (const op of sorted) {
      await this.processOperation(op)
    }
  }

  private async processOperation(op: SyncOperation): Promise<void> {
    await this.db.syncQueue.update(op.id, { status: 'syncing' })

    try {
      const response = await fetch(op.endpoint, {
        method: op.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAccessToken()}`,
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Успех — удаляем из очереди
      await this.db.syncQueue.delete(op.id)

      // Уведомляем UI
      window.dispatchEvent(new CustomEvent('sync:success', { detail: op }))

    } catch (error) {
      const newRetries = op.retries + 1

      if (newRetries >= op.maxRetries) {
        await this.db.syncQueue.update(op.id, {
          status: 'failed',
          lastError: (error as Error).message,
        })
        window.dispatchEvent(new CustomEvent('sync:failed', { detail: op }))
      } else {
        // Экспоненциальный backoff
        await this.db.syncQueue.update(op.id, {
          status: 'pending',
          retries: newRetries,
          lastError: (error as Error).message,
        })
      }
    }
  }
}

export const syncQueue = new SyncQueue()
```

### 3.5 Push-уведомления

**Типы уведомлений:**
1. **Книга обработана** — Когда EPUB/FB2 парсинг завершён
2. **Изображение готово** — Когда AI-изображение сгенерировано

#### Backend (FastAPI + web-push)

**Установка:**
```bash
pip install pywebpush
```

**Сервис уведомлений:**

```python
# backend/app/services/push_notification_service.py
import json
from pywebpush import webpush, WebPushException
from app.core.config import settings
from app.models.push_subscription import PushSubscription
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

class PushNotificationService:
    """Сервис Web Push уведомлений с VAPID."""

    def __init__(self):
        self.vapid_private_key = settings.VAPID_PRIVATE_KEY
        self.vapid_public_key = settings.VAPID_PUBLIC_KEY
        self.vapid_claims = {"sub": f"mailto:{settings.VAPID_EMAIL}"}

    async def send_notification(
        self,
        db: AsyncSession,
        user_id: str,
        title: str,
        body: str,
        data: dict | None = None,
        icon: str = "/favicon-192.png",
        badge: str = "/favicon-72.png",
        tag: str | None = None,
    ) -> int:
        """
        Отправляет push-уведомление всем подпискам пользователя.
        Возвращает количество успешно отправленных уведомлений.
        """
        # Получаем все подписки пользователя
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        subscriptions = result.scalars().all()

        if not subscriptions:
            return 0

        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": icon,
            "badge": badge,
            "tag": tag,
            "data": data or {},
            "timestamp": int(time.time() * 1000),
        })

        success_count = 0
        expired_endpoints = []

        for sub in subscriptions:
            subscription_info = {
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh_key,
                    "auth": sub.auth_key,
                }
            }

            try:
                webpush(
                    subscription_info=subscription_info,
                    data=payload,
                    vapid_private_key=self.vapid_private_key,
                    vapid_claims=self.vapid_claims,
                    ttl=86400,  # 24 часа
                )
                success_count += 1

            except WebPushException as e:
                if e.response is not None and e.response.status_code in (404, 410):
                    # Подписка истекла или удалена
                    expired_endpoints.append(sub.endpoint)
                else:
                    # Логируем ошибку, но продолжаем
                    logger.warning(f"Push failed for {sub.endpoint}: {e}")

        # Удаляем истекшие подписки
        if expired_endpoints:
            await db.execute(
                delete(PushSubscription).where(
                    PushSubscription.endpoint.in_(expired_endpoints)
                )
            )
            await db.commit()

        return success_count

    async def send_book_ready_notification(
        self,
        db: AsyncSession,
        user_id: str,
        book_id: str,
        book_title: str,
    ) -> int:
        """Уведомление о готовности книги."""
        return await self.send_notification(
            db=db,
            user_id=user_id,
            title="Книга готова!",
            body=f"«{book_title}» обработана и готова к чтению",
            data={
                "type": "book_ready",
                "bookId": book_id,
                "action": "open_book",
            },
            tag=f"book-ready-{book_id}",
        )

    async def send_image_ready_notification(
        self,
        db: AsyncSession,
        user_id: str,
        book_id: str,
        image_id: str,
        description_preview: str,
    ) -> int:
        """Уведомление о готовности изображения."""
        return await self.send_notification(
            db=db,
            user_id=user_id,
            title="Изображение готово!",
            body=f"Иллюстрация создана: {description_preview[:50]}...",
            data={
                "type": "image_ready",
                "bookId": book_id,
                "imageId": image_id,
                "action": "view_image",
            },
            tag=f"image-ready-{image_id}",
        )


# Синглтон
push_service = PushNotificationService()
```

**API эндпоинты:**

```python
# backend/app/routers/push.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.deps import get_db, get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.push_subscription import PushSubscription
from app.schemas.push import PushSubscriptionCreate, PushSubscriptionResponse
from sqlalchemy import select, delete

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Возвращает публичный VAPID ключ для клиента."""
    if not settings.VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push notifications not configured")
    return {"publicKey": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", response_model=PushSubscriptionResponse)
async def subscribe_to_push(
    subscription: PushSubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Регистрирует push-подписку для пользователя."""
    # Проверяем существующую подписку
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == subscription.endpoint
        )
    )
    existing_sub = existing.scalar_one_or_none()

    if existing_sub:
        # Обновляем существующую
        existing_sub.p256dh_key = subscription.keys.p256dh
        existing_sub.auth_key = subscription.keys.auth
        existing_sub.user_id = current_user.id
        await db.commit()
        return existing_sub

    # Создаём новую
    new_sub = PushSubscription(
        user_id=current_user.id,
        endpoint=subscription.endpoint,
        p256dh_key=subscription.keys.p256dh,
        auth_key=subscription.keys.auth,
    )
    db.add(new_sub)
    await db.commit()
    await db.refresh(new_sub)

    return new_sub


@router.delete("/unsubscribe")
async def unsubscribe_from_push(
    endpoint: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удаляет push-подписку."""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == current_user.id,
        )
    )
    await db.commit()
    return {"status": "ok"}


@router.get("/subscriptions")
async def get_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает все подписки пользователя."""
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == current_user.id)
    )
    return result.scalars().all()
```

**Модель базы данных:**

```python
# backend/app/models/push_subscription.py
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
import uuid
from datetime import datetime

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = Column(String(500), unique=True, nullable=False, index=True)
    p256dh_key = Column(String(200), nullable=False)
    auth_key = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="push_subscriptions")
```

**Интеграция с Celery:**

```python
# backend/app/tasks/book_processing.py
from app.services.push_notification_service import push_service

@celery_app.task(bind=True, max_retries=3)
def process_book_task(self, book_id: str, user_id: str):
    """Обработка загруженной книги с push-уведомлением по завершении."""
    try:
        # Существующая логика обработки...
        result = process_book(book_id)

        # Отправляем push-уведомление
        async def send_notification():
            async with get_async_session() as db:
                await push_service.send_book_ready_notification(
                    db=db,
                    user_id=user_id,
                    book_id=book_id,
                    book_title=result.title,
                )

        asyncio.run(send_notification())

        return result

    except Exception as e:
        self.retry(exc=e, countdown=60)
```

#### Frontend

**Менеджер push-уведомлений:**

```typescript
// src/services/pushNotifications.ts
import { api } from '@/api/client'

class PushNotificationManager {
  private vapidPublicKey: string | null = null
  private subscription: PushSubscription | null = null

  async init(): Promise<boolean> {
    // Проверяем поддержку
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
      console.warn('Push notifications not supported')
      return false
    }

    // Проверяем разрешения
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return false
    }

    // Получаем VAPID ключ
    try {
      const response = await api.get('/push/vapid-public-key')
      this.vapidPublicKey = response.data.publicKey
      return true
    } catch {
      console.error('Failed to get VAPID key')
      return false
    }
  }

  async subscribe(): Promise<PushSubscription | null> {
    if (!this.vapidPublicKey) {
      const initialized = await this.init()
      if (!initialized) return null
    }

    const registration = await navigator.serviceWorker.ready

    // Проверяем существующую подписку
    const existingSubscription = await registration.pushManager.getSubscription()
    if (existingSubscription) {
      this.subscription = existingSubscription
      return existingSubscription
    }

    // Создаём новую подписку
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey!),
    })

    // Отправляем на сервер
    await api.post('/push/subscribe', subscription.toJSON())

    this.subscription = subscription
    return subscription
  }

  async unsubscribe(): Promise<void> {
    if (!this.subscription) return

    const endpoint = this.subscription.endpoint
    await this.subscription.unsubscribe()
    await api.delete('/push/unsubscribe', { params: { endpoint } })

    this.subscription = null
  }

  async isSubscribed(): Promise<boolean> {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }

    return outputArray
  }
}

export const pushManager = new PushNotificationManager()
```

**Обработка push в Service Worker:**

```typescript
// В sw.ts (добавить к существующему)

// Push уведомления
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()

  const options: NotificationOptions = {
    body: data.body,
    icon: data.icon || '/favicon-192.png',
    badge: data.badge || '/favicon-72.png',
    tag: data.tag,
    data: data.data,
    actions: getActionsForType(data.data?.type),
    vibrate: [100, 50, 100],
    requireInteraction: data.data?.type === 'book_ready',
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

function getActionsForType(type: string): NotificationAction[] {
  switch (type) {
    case 'book_ready':
      return [
        { action: 'open', title: 'Открыть' },
        { action: 'dismiss', title: 'Позже' },
      ]
    case 'image_ready':
      return [
        { action: 'view', title: 'Посмотреть' },
        { action: 'dismiss', title: 'Закрыть' },
      ]
    default:
      return []
  }
}

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data
  let url = '/'

  if (event.action === 'dismiss') return

  switch (data?.type) {
    case 'book_ready':
      url = `/book/${data.bookId}`
      break
    case 'image_ready':
      url = `/book/${data.bookId}/images?highlight=${data.imageId}`
      break
  }

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Если есть открытое окно — фокусируемся на нём
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      // Иначе открываем новое
      return clients.openWindow(url)
    })
  )
})
```

### 3.6 Управление квотой хранилища

**Лимит:** 1 ГБ максимум для offline данных

**Сервис управления хранилищем:**

```typescript
// src/services/storageManager.ts
import { db } from './db'

export class StorageManager {
  private readonly MAX_CACHE_SIZE = 1 * 1024 * 1024 * 1024 // 1 ГБ
  private readonly WARNING_THRESHOLD = 0.8 // 80%
  private readonly CRITICAL_THRESHOLD = 0.95 // 95%

  async getStorageEstimate(): Promise<StorageEstimate> {
    if (!navigator.storage?.estimate) {
      // Fallback для старых браузеров
      return { quota: this.MAX_CACHE_SIZE, usage: 0 }
    }
    return navigator.storage.estimate()
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false

    // Проверяем текущий статус
    const persisted = await navigator.storage.persisted()
    if (persisted) return true

    // Запрашиваем persistent storage
    // Важно для iOS — предотвращает 7-дневное удаление
    return navigator.storage.persist()
  }

  async getStorageInfo(): Promise<{
    used: number
    quota: number
    available: number
    percentUsed: number
    isWarning: boolean
    isCritical: boolean
    isPersistent: boolean
  }> {
    const estimate = await this.getStorageEstimate()
    const quota = Math.min(estimate.quota || this.MAX_CACHE_SIZE, this.MAX_CACHE_SIZE)
    const usage = estimate.usage || 0
    const percentUsed = usage / quota

    const isPersistent = await navigator.storage?.persisted?.() ?? false

    return {
      used: usage,
      quota,
      available: quota - usage,
      percentUsed: percentUsed * 100,
      isWarning: percentUsed >= this.WARNING_THRESHOLD,
      isCritical: percentUsed >= this.CRITICAL_THRESHOLD,
      isPersistent,
    }
  }

  async canDownload(estimatedSize: number): Promise<boolean> {
    const info = await this.getStorageInfo()
    return info.available > estimatedSize * 1.2 // 20% запас
  }

  async performCleanup(targetFreeSpace: number): Promise<number> {
    let freedSpace = 0

    // 1. Удаляем старые изображения (самый большой footprint)
    const oldImages = await db.images
      .orderBy('cachedAt')
      .limit(50)
      .toArray()

    for (const img of oldImages) {
      if (freedSpace >= targetFreeSpace) break
      freedSpace += img.size
      await db.images.delete(img.id)
    }

    // 2. Удаляем главы книг, которые давно не открывались
    const oldChapters = await db.chapters
      .orderBy('lastAccessedAt')
      .filter(ch => Date.now() - ch.lastAccessedAt > 7 * 24 * 60 * 60 * 1000) // > 7 дней
      .limit(100)
      .toArray()

    for (const ch of oldChapters) {
      if (freedSpace >= targetFreeSpace) break
      // Примерная оценка размера главы
      freedSpace += new Blob([ch.content]).size
      await db.chapters.delete(ch.id)
    }

    // 3. Обновляем статус offline книг
    const bookIds = new Set(oldChapters.map(ch => ch.bookId))
    for (const bookId of bookIds) {
      const remainingChapters = await db.chapters
        .where('[userId+bookId]')
        .equals([oldChapters[0]?.userId, bookId])
        .count()

      if (remainingChapters === 0) {
        await db.offlineBooks.delete(`${oldChapters[0]?.userId}:${bookId}`)
      } else {
        await db.offlineBooks.update(`${oldChapters[0]?.userId}:${bookId}`, {
          status: 'partial',
        })
      }
    }

    return freedSpace
  }

  async clearAllOfflineData(): Promise<void> {
    await db.transaction('rw', db.offlineBooks, db.chapters, db.images, db.syncQueue, async () => {
      await db.offlineBooks.clear()
      await db.chapters.clear()
      await db.images.clear()
      // syncQueue НЕ очищаем — там могут быть несинхронизированные данные
    })

    // Очищаем Cache API
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith('fancai-'))
        .map(name => caches.delete(name))
    )
  }
}

export const storageManager = new StorageManager()
```

**React Hook:**

```typescript
// src/hooks/useStorageInfo.ts
import { useQuery } from '@tanstack/react-query'
import { storageManager } from '@/services/storageManager'

export function useStorageInfo() {
  return useQuery({
    queryKey: ['storage-info'],
    queryFn: () => storageManager.getStorageInfo(),
    refetchInterval: 30000, // Обновлять каждые 30 секунд
    staleTime: 10000,
  })
}

export function useRequestPersistence() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => storageManager.requestPersistentStorage(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-info'] })
    },
  })
}
```

### 3.7 Поддержка iOS Safari

**Критические особенности iOS:**

| Ограничение | Решение |
|-------------|---------|
| Нет Background Sync | Синхронизация через `visibilitychange` |
| 7-дневное удаление данных | Запрос `navigator.storage.persist()` |
| Нет Install Prompt | Инструкции "Add to Home Screen" |
| Push только для установленных PWA | Проверка `display-mode: standalone` |
| Safari требует APNs для push | Используем стандартный VAPID (работает с iOS 16.4+) |

**Утилиты для iOS:**

```typescript
// src/utils/iosSupport.ts

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
export const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
export const isIOSSafari = isIOS && isSafari

export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true

export function getIOSVersion(): number | null {
  const match = navigator.userAgent.match(/OS (\d+)_/)
  return match ? parseInt(match[1], 10) : null
}

export function canUsePushOnIOS(): boolean {
  if (!isIOS) return true
  const version = getIOSVersion()
  return version !== null && version >= 16 && isStandalone
}

export function canUseBackgroundSync(): boolean {
  return 'serviceWorker' in navigator &&
         'SyncManager' in window &&
         !isIOS // iOS не поддерживает
}

// Настройка iOS-специфичной синхронизации
export function setupIOSSync(syncFn: () => Promise<void>): void {
  if (!isIOS) return

  // Синхронизация при возврате в приложение
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        await syncFn()
      } catch (e) {
        console.error('iOS sync failed:', e)
      }
    }
  })

  // Синхронизация при восстановлении сети
  window.addEventListener('online', async () => {
    try {
      await syncFn()
    } catch (e) {
      console.error('iOS online sync failed:', e)
    }
  })
}

// Запрос persistent storage для iOS
export async function setupIOSPersistence(): Promise<boolean> {
  if (!isIOS) return true

  if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist()
    console.log('iOS persistent storage:', granted ? 'granted' : 'denied')
    return granted
  }

  return false
}
```

**Компонент инструкций для iOS:**

```typescript
// src/components/UI/IOSInstallInstructions.tsx
import { useState, useEffect } from 'react'
import { isIOS, isStandalone } from '@/utils/iosSupport'
import { X, Share, Plus } from 'lucide-react'

interface Props {
  inline?: boolean
}

export function IOSInstallInstructions({ inline = false }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Показываем только на iOS Safari, не в standalone режиме
    const shouldShow = isIOS &&
                       !isStandalone &&
                       !localStorage.getItem('ios-install-dismissed')
    setShow(shouldShow)
  }, [])

  const dismiss = () => {
    setShow(false)
    localStorage.setItem('ios-install-dismissed', 'true')
  }

  if (!show) return null

  const content = (
    <div className="space-y-3">
      <p className="font-medium">Установите fancai на iPhone</p>
      <ol className="text-sm text-muted-foreground space-y-2">
        <li className="flex items-center gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10
                         flex items-center justify-center text-xs">1</span>
          <span>Нажмите <Share className="inline w-4 h-4" /> внизу экрана</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10
                         flex items-center justify-center text-xs">2</span>
          <span>Прокрутите вниз и выберите «На экран Домой»</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10
                         flex items-center justify-center text-xs">3</span>
          <span>Нажмите <Plus className="inline w-4 h-4" /> «Добавить»</span>
        </li>
      </ol>
      <p className="text-xs text-muted-foreground">
        После установки вы сможете читать книги офлайн и получать уведомления
      </p>
    </div>
  )

  if (inline) {
    return content
  }

  return (
    <div className="fixed bottom-0 inset-x-0 p-4 bg-card border-t border-border
                    shadow-lg z-50 animate-slide-up">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 p-1 text-muted-foreground
                   hover:text-foreground transition-colors"
        aria-label="Закрыть"
      >
        <X className="w-5 h-5" />
      </button>
      {content}
    </div>
  )
}
```

### 3.8 Установка PWA (страница настроек)

**Hook для управления установкой:**

```typescript
// src/hooks/usePWAInstall.ts
import { useState, useEffect, useCallback } from 'react'
import { isIOS, isStandalone } from '@/utils/iosSupport'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    // Проверяем установлен ли PWA
    setIsInstalled(isStandalone)

    // Слушаем событие install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    // Слушаем успешную установку
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferredPrompt) return false

    setIsInstalling(true)

    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice

      if (outcome === 'accepted') {
        setIsInstalled(true)
        setDeferredPrompt(null)
        return true
      }

      return false
    } finally {
      setIsInstalling(false)
    }
  }, [deferredPrompt])

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    isInstalling,
    isIOS,
    install,
  }
}
```

**Секция в настройках:**

```typescript
// src/pages/SettingsPage.tsx — добавить секцию

import { usePWAInstall } from '@/hooks/usePWAInstall'
import { useStorageInfo, useRequestPersistence } from '@/hooks/useStorageInfo'
import { IOSInstallInstructions } from '@/components/UI/IOSInstallInstructions'

function PWASettingsSection() {
  const { canInstall, isInstalled, isInstalling, isIOS, install } = usePWAInstall()
  const { data: storageInfo, isLoading: storageLoading } = useStorageInfo()
  const requestPersistence = useRequestPersistence()

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  return (
    <div className="space-y-6">
      {/* Установка приложения */}
      <section className="border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Установка приложения</h3>

        {isInstalled ? (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>fancai установлен</span>
          </div>
        ) : canInstall ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Установите приложение для быстрого доступа и чтения офлайн
            </p>
            <Button
              onClick={install}
              disabled={isInstalling}
              className="w-full sm:w-auto"
            >
              {isInstalling ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Установить
            </Button>
          </div>
        ) : isIOS ? (
          <IOSInstallInstructions inline />
        ) : (
          <p className="text-sm text-muted-foreground">
            Откройте в Chrome или Edge для установки
          </p>
        )}
      </section>

      {/* Хранилище */}
      <section className="border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Офлайн-хранилище</h3>

        {storageLoading ? (
          <Skeleton className="h-20" />
        ) : storageInfo ? (
          <div className="space-y-4">
            {/* Прогресс-бар использования */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Использовано</span>
                <span>{formatBytes(storageInfo.used)} из {formatBytes(storageInfo.quota)}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    storageInfo.isCritical
                      ? "bg-destructive"
                      : storageInfo.isWarning
                        ? "bg-warning"
                        : "bg-primary"
                  )}
                  style={{ width: `${Math.min(storageInfo.percentUsed, 100)}%` }}
                />
              </div>
            </div>

            {/* Предупреждения */}
            {storageInfo.isCritical && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Хранилище почти заполнено. Удалите неиспользуемые книги.
                </AlertDescription>
              </Alert>
            )}

            {/* Persistent storage */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Постоянное хранилище</p>
                <p className="text-xs text-muted-foreground">
                  Защищает данные от автоматического удаления
                </p>
              </div>
              {storageInfo.isPersistent ? (
                <Badge variant="outline" className="text-green-600">
                  <Check className="w-3 h-3 mr-1" />
                  Активно
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestPersistence.mutate()}
                  disabled={requestPersistence.isPending}
                >
                  Запросить
                </Button>
              )}
            </div>

            {/* Кнопка очистки */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                // Показать диалог подтверждения
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Очистить офлайн-данные
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
```

---

## 4. Интеграция с существующим кодом

### 4.1 Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `vite.config.ts` | Добавить VitePWA plugin |
| `src/main.tsx` | Обновить регистрацию SW, добавить init push |
| `src/services/chapterCache.ts` | Мигрировать на Dexie.js |
| `src/services/imageCache.ts` | Мигрировать на Dexie.js |
| `src/services/syncQueue.ts` | Добавить Background Sync API |
| `src/hooks/useOnlineStatus.ts` | Добавить iOS visibility fallback |
| `src/pages/SettingsPage.tsx` | Добавить управление хранилищем, установку |
| `src/components/Reader/EpubReader.tsx` | Добавить триггеры prefetch |
| `src/App.tsx` | Добавить компоненты PWA (update prompt, iOS instructions) |
| `public/sw.js` | Удалить (заменяется на Workbox-генерируемый) |

### 4.2 Новые файлы

| Файл | Назначение |
|------|------------|
| `src/services/db.ts` | Dexie.js схема базы данных |
| `src/services/pushNotifications.ts` | Менеджер push-уведомлений |
| `src/services/storageManager.ts` | Управление квотой кэша |
| `src/services/downloadManager.ts` | Загрузка книг для offline |
| `src/sw.ts` | Кастомный service worker (injectManifest) |
| `src/hooks/usePWAInstall.ts` | Hook для install prompt |
| `src/hooks/useStorageInfo.ts` | Hook для информации о хранилище |
| `src/hooks/useOfflineBook.ts` | Hook для offline книг (Dexie liveQuery) |
| `src/components/UI/PWAUpdatePrompt.tsx` | Уведомление об обновлении |
| `src/components/UI/IOSInstallInstructions.tsx` | Инструкции для iOS |
| `src/components/Reader/DownloadManager.tsx` | UI загрузки книги |
| `src/utils/iosSupport.ts` | iOS-специфичные утилиты |
| `backend/app/services/push_notification_service.py` | Сервис web push |
| `backend/app/routers/push.py` | API эндпоинты push |
| `backend/app/models/push_subscription.py` | Модель подписки |
| `backend/app/schemas/push.py` | Pydantic схемы |

### 4.3 Переменные окружения

```bash
# Frontend (.env)
VITE_VAPID_PUBLIC_KEY=<ваш-vapid-public-key>

# Backend (.env)
VAPID_PRIVATE_KEY=<ваш-vapid-private-key>
VAPID_PUBLIC_KEY=<ваш-vapid-public-key>
VAPID_EMAIL=admin@fancai.ru
```

**Генерация VAPID ключей:**
```bash
npx web-push generate-vapid-keys
```

### 4.4 Миграция базы данных

```bash
# Создать миграцию для push_subscriptions
cd backend
alembic revision --autogenerate -m "add push_subscriptions table"
alembic upgrade head
```

---

## 5. Тестирование

### 5.1 Unit-тесты

```typescript
// Тесты для создания:

// src/services/__tests__/storageManager.test.ts
describe('StorageManager', () => {
  it('должен корректно рассчитывать квоту')
  it('должен выполнять LRU очистку при превышении квоты')
  it('должен запрашивать persistent storage')
  it('должен определять критический уровень заполнения')
})

// src/services/__tests__/downloadManager.test.ts
describe('DownloadManager', () => {
  it('должен последовательно загружать главы')
  it('должен обрабатывать отмену загрузки')
  it('должен продолжать частичные загрузки')
  it('должен проверять квоту перед загрузкой')
})

// src/services/__tests__/syncQueue.test.ts
describe('SyncQueue', () => {
  it('должен добавлять операции в очередь')
  it('должен обрабатывать очередь по приоритету')
  it('должен применять экспоненциальный backoff')
  it('должен синхронизировать при восстановлении сети')
})

// src/hooks/__tests__/usePWAInstall.test.ts
describe('usePWAInstall', () => {
  it('должен определять standalone режим')
  it('должен обрабатывать beforeinstallprompt событие')
  it('должен отслеживать состояние установки')
})
```

### 5.2 E2E тесты (Playwright)

```typescript
// e2e/pwa.spec.ts
import { test, expect } from '@playwright/test'

test.describe('PWA Features', () => {
  test('должен кэшировать app shell при установке', async ({ page }) => {
    await page.goto('/')

    // Проверяем регистрацию SW
    const swState = await page.evaluate(() =>
      navigator.serviceWorker.controller?.state
    )
    expect(swState).toBe('activated')
  })

  test('должен работать офлайн после кэширования', async ({ page, context }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')

    // Переходим в офлайн
    await context.setOffline(true)

    // Должен показывать кэшированный UI
    await page.reload()
    await expect(page.locator('h1')).toContainText('Библиотека')
  })

  test('должен ставить операции в очередь офлайн', async ({ page, context }) => {
    await page.goto('/book/123/read')
    await context.setOffline(true)

    // Обновляем прогресс чтения
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('test:update-progress'))
    })

    // Проверяем очередь
    const queueSize = await page.evaluate(async () => {
      const { db } = await import('/src/services/db')
      return db.syncQueue.count()
    })
    expect(queueSize).toBeGreaterThan(0)
  })

  test('должен синхронизировать очередь при восстановлении сети', async ({ page, context }) => {
    // Добавляем операции офлайн
    await context.setOffline(true)
    await page.goto('/book/123/read')
    // ... добавить операции

    // Восстанавливаем сеть
    await context.setOffline(false)

    // Ждём синхронизации
    await page.waitForResponse(resp =>
      resp.url().includes('/api/v1/books/') &&
      resp.url().includes('/progress')
    )

    // Очередь должна очиститься
    const queueSize = await page.evaluate(async () => {
      const { db } = await import('/src/services/db')
      return db.syncQueue.where('status').equals('pending').count()
    })
    expect(queueSize).toBe(0)
  })

  test('iOS: должен показывать инструкции установки', async ({ page }) => {
    // Эмулируем iOS Safari
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    await page.goto('/settings')

    await expect(page.locator('text=На экран Домой')).toBeVisible()
  })
})
```

### 5.3 Чеклист ручного тестирования

**Desktop:**
- [ ] Установка PWA в Chrome
- [ ] Установка PWA в Edge
- [ ] Работа офлайн после кэширования
- [ ] Уведомление об обновлении SW
- [ ] Push-уведомление (книга готова)
- [ ] Загрузка книги для офлайн
- [ ] Управление хранилищем в настройках

**Android:**
- [ ] Установка PWA в Chrome
- [ ] Offline чтение кэшированной книги
- [ ] Background Sync (прогресс синхронизируется)
- [ ] Push-уведомления
- [ ] Квота хранилища отображается корректно

**iOS (iPhone/iPad):**
- [ ] Add to Home Screen работает
- [ ] Offline чтение после установки
- [ ] Синхронизация при возврате в приложение
- [ ] Push-уведомления (iOS 16.4+, только в standalone)
- [ ] Persistent storage запрашивается
- [ ] Инструкции установки отображаются

**Lighthouse Audit:**
- [ ] PWA Score > 90
- [ ] Performance > 80
- [ ] Best Practices > 90
- [ ] Accessibility > 90

---

## 6. Критерии приёмки

### 6.1 Lighthouse PWA Score

**Целевой показатель:** 90+

```
✓ Installable — Устанавливается как приложение
✓ PWA Optimized — Оптимизирован для PWA
✓ Fast and reliable — Быстрый и надёжный (offline)
✓ Service worker registration — SW зарегистрирован
✓ Maskable icon — Иконка с маской
✓ Viewport meta tag — Meta тег viewport
✓ Theme color — Цвет темы
✓ Splash screen — Экран загрузки
```

### 6.2 Функциональные требования

| Функция | Критерий приёмки |
|---------|------------------|
| **Offline чтение** | Пользователь может читать любую ранее открытую книгу офлайн |
| **Background Sync** | Прогресс чтения синхронизируется автоматически при появлении сети |
| **Push-уведомления** | Пользователь получает уведомление когда книга обработана |
| **Установка** | Кнопка установки видна в настройках на поддерживаемых браузерах |
| **iOS Support** | Инструкции Add to Home Screen показываются на iOS |
| **Управление хранилищем** | Пользователь видит использование и может очистить кэш |
| **Загрузка книг** | Пользователь может скачать всю книгу для offline чтения |

### 6.3 Метрики производительности

| Метрика | Целевое значение |
|---------|------------------|
| Time to Interactive (offline) | < 2с |
| First Contentful Paint | < 1.5с |
| Largest Contentful Paint | < 2.5с |
| Загрузка offline книги | < 500мс |
| Воспроизведение sync очереди | < 5с на 10 операций |

---

## 7. Фазы реализации

### Фаза 1: Интеграция Workbox (Неделя 1)
1. Установить VitePWA plugin
2. Настроить precaching для app shell
3. Мигрировать существующий sw.js на Workbox
4. Протестировать offline загрузку app shell

### Фаза 2: Улучшение Offline чтения (Неделя 2)
1. Мигрировать IndexedDB на Dexie.js
2. Реализовать DownloadManager сервис
3. Добавить prefetching в EpubReader
4. Реализовать управление квотой хранилища
5. Создать UI StorageSettings

### Фаза 3: Background Sync (Неделя 3)
1. Реализовать Background Sync API интеграцию
2. Добавить iOS visibility fallback
3. Протестировать sync очередь с различными операциями
4. Добавить логику retry с экспоненциальным backoff

### Фаза 4: Push-уведомления (Неделя 4)
1. Создать backend push сервис
2. Добавить push API эндпоинты
3. Реализовать frontend push подписку
4. Интегрировать с Celery задачами

### Фаза 5: Полировка и тестирование (Неделя 5)
1. iOS Safari workarounds
2. Install prompt в настройках
3. Полное E2E тестирование
4. Оптимизация Lighthouse
5. Обновление документации

---

## 8. Источники и ссылки

### Официальная документация
- [VitePWA Documentation](https://vite-pwa-org.netlify.app/)
- [Workbox Documentation](https://developer.chrome.com/docs/workbox/)
- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Background Sync API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [Dexie.js Documentation](https://dexie.org/)

### Best Practices
- [web.dev PWA Guide](https://web.dev/learn/pwa/)
- [PWA on iOS — Current Status (2025)](https://brainhub.eu/library/pwa-on-ios)
- [TanStack Query Offline Mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)
- [Offline-First Frontend Apps (2025)](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)

### Существующий код проекта

| Компонент | Путь | Строки |
|-----------|------|--------|
| Текущий Service Worker | `frontend/public/sw.js` | 488 |
| Web Manifest | `frontend/public/manifest.json` | 199 |
| Chapter Cache | `frontend/src/services/chapterCache.ts` | ~600 |
| Image Cache | `frontend/src/services/imageCache.ts` | ~500 |
| Sync Queue | `frontend/src/services/syncQueue.ts` | 312 |
| Online Status Hook | `frontend/src/hooks/useOnlineStatus.ts` | 87 |
| SW Registration Utils | `frontend/src/utils/serviceWorker.ts` | 309 |
| Vite Config | `frontend/vite.config.ts` | 132 |
| EPUB Reader | `frontend/src/components/Reader/EpubReader.tsx` | 573 |

---

**Автор документа:** Claude Code
**Последнее обновление:** 2026-01-09
**Статус:** Готов к планированию реализации
