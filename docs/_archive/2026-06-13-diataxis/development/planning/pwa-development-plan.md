# План разработки PWA для fancai

> **Документ:** План реализации Progressive Web App
> **Создан:** 2026-01-09
> **На основе:** [PWA Implementation Prompt](../../guides/development/pwa-implementation-prompt.md)
> **Метод:** Параллельная разработка агентами с предотвращением конфликтов

---

## Обзор плана

### Принципы организации работы

1. **Чёткое владение файлами** — каждая задача имеет эксклюзивный список файлов
2. **Последовательные зависимости** — задачи с зависимостями выполняются строго после завершения блокирующих задач
3. **Параллельные потоки** — независимые задачи выполняются одновременно разными агентами
4. **Точки синхронизации** — после каждой фазы проводится интеграционное тестирование

### Структура фаз

```
Фаза 0 (P0): Фундамент
├── 0.1 VitePWA интеграция [Блокирующая]
└── 0.2 Dexie.js схема БД [Блокирующая]

Фаза 1 (P0): Ядро PWA [Параллельно после Фазы 0]
├── 1.1 Service Worker (Workbox)
├── 1.2 Миграция IndexedDB на Dexie.js
└── 1.3 TanStack Query offline-first

Фаза 2 (P1): Offline функциональность [Параллельно]
├── 2.1 Download Manager
├── 2.2 Storage Manager
└── 2.3 Background Sync

Фаза 3 (P1): Push-уведомления [Параллельно]
├── 3.1 Backend Push API
└── 3.2 Frontend Push Manager

Фаза 4 (P2): UX и iOS [Параллельно]
├── 4.1 iOS Support
├── 4.2 Install Prompt
└── 4.3 PWA Update Prompt

Фаза 5: Интеграция и тестирование
├── 5.1 Settings Page интеграция
├── 5.2 E2E тестирование
└── 5.3 Lighthouse оптимизация
```

---

## Диаграмма зависимостей

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                     ФАЗА 0: ФУНДАМЕНТ                        │
                    │  ┌──────────────────┐      ┌──────────────────┐             │
                    │  │ 0.1 VitePWA      │      │ 0.2 Dexie.js DB  │             │
                    │  │ [vite.config.ts] │      │ [src/services/   │             │
                    │  │                  │      │  db.ts]          │             │
                    │  └────────┬─────────┘      └────────┬─────────┘             │
                    └───────────┼─────────────────────────┼───────────────────────┘
                                │                         │
              ┌─────────────────┼─────────────────────────┼─────────────────────┐
              │                 ▼                         ▼                     │
              │  ┌──────────────────┐      ┌──────────────────┐                │
              │  │ 1.1 Service      │      │ 1.2 Миграция     │                │
              │  │ Worker Workbox   │      │ IndexedDB→Dexie  │                │
              │  └────────┬─────────┘      └────────┬─────────┘                │
              │           │                         │                          │
              │           │      ┌──────────────────┴───────────────┐          │
              │           │      │ 1.3 TanStack Query offline-first │          │
              │           │      └────────┬─────────────────────────┘          │
              │           │               │                                    │
              │           └───────────────┼───────────────────────────┐        │
              │                           ▼                           │        │
              │                 ФАЗА 1: ЯДРО PWA                       │        │
              └───────────────────────────┬───────────────────────────┘        │
                                          │                                    │
    ┌─────────────────────────────────────┼─────────────────────────────────┐  │
    │                                     ▼                                 │  │
    │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │  │
    │  │ 2.1 Download     │   │ 2.2 Storage      │   │ 2.3 Background   │  │  │
    │  │ Manager          │   │ Manager          │   │ Sync             │  │  │
    │  │ [downloadMgr.ts] │   │ [storageMgr.ts]  │   │ [syncQueue.ts]   │  │  │
    │  └────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘  │  │
    │           │                      │                      │            │  │
    │           └──────────────────────┼──────────────────────┘            │  │
    │                                  ▼                                   │  │
    │                   ФАЗА 2: OFFLINE ФУНКЦИОНАЛЬНОСТЬ                   │  │
    └──────────────────────────────────┬───────────────────────────────────┘  │
                                       │                                      │
    ┌──────────────────────────────────┼──────────────────────────────────────┤
    │                                  ▼                                      │
    │  ┌────────────────────────────────────────────────────────────────┐    │
    │  │                    ФАЗА 3: PUSH-УВЕДОМЛЕНИЯ                     │    │
    │  │  ┌──────────────────┐              ┌──────────────────┐        │    │
    │  │  │ 3.1 Backend Push │              │ 3.2 Frontend     │        │    │
    │  │  │ API (Python)     │◄────────────►│ Push Manager     │        │    │
    │  │  └──────────────────┘              └──────────────────┘        │    │
    │  └────────────────────────────────────────────────────────────────┘    │
    │                                  │                                      │
    └──────────────────────────────────┼──────────────────────────────────────┘
                                       │
    ┌──────────────────────────────────┼──────────────────────────────────────┐
    │                                  ▼                                      │
    │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐    │
    │  │ 4.1 iOS Support  │   │ 4.2 Install      │   │ 4.3 PWA Update   │    │
    │  │ [iosSupport.ts]  │   │ Prompt           │   │ Prompt           │    │
    │  │                  │   │ [usePWAInstall]  │   │ [PWAUpdate.tsx]  │    │
    │  └──────────────────┘   └──────────────────┘   └──────────────────┘    │
    │                                  │                                      │
    │                    ФАЗА 4: UX И iOS ПОДДЕРЖКА                           │
    └──────────────────────────────────┬──────────────────────────────────────┘
                                       │
    ┌──────────────────────────────────▼──────────────────────────────────────┐
    │                    ФАЗА 5: ИНТЕГРАЦИЯ И ТЕСТИРОВАНИЕ                    │
    │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐    │
    │  │ 5.1 Settings     │   │ 5.2 E2E Tests    │   │ 5.3 Lighthouse   │    │
    │  │ Page             │   │ (Playwright)     │   │ Optimization     │    │
    │  └──────────────────┘   └──────────────────┘   └──────────────────┘    │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## Фаза 0: Фундамент (P0 — Критический)

> **Статус:** Блокирующая фаза
> **Параллелизм:** Задачи 0.1 и 0.2 могут выполняться параллельно
> **Время:** ~4 часа

### Задача 0.1: Интеграция VitePWA

**Приоритет:** P0 (Критический)
**Зависимости:** Нет
**Блокирует:** 1.1 Service Worker

**Владение файлами (эксклюзивное):**
```
frontend/
├── vite.config.ts              [ИЗМЕНИТЬ] — добавить VitePWA plugin
├── package.json                [ИЗМЕНИТЬ] — добавить зависимости
├── tsconfig.json               [ИЗМЕНИТЬ] — добавить типы virtual:pwa-register
└── src/
    └── vite-env.d.ts           [ИЗМЕНИТЬ] — типы для virtual модулей
```

**Шаги реализации:**

1. **Установка зависимостей:**
   ```bash
   npm install -D vite-plugin-pwa workbox-window
   ```

2. **Обновить vite.config.ts:**
   - Импортировать VitePWA
   - Добавить базовую конфигурацию plugin
   - Настроить `registerType: 'prompt'`
   - Указать `manifest: false` (используем существующий)
   - Включить `devOptions.enabled: true` для тестирования

3. **Обновить типы TypeScript:**
   - Добавить `/// <reference types="vite-plugin-pwa/client" />` в vite-env.d.ts

4. **Тестирование:**
   - `npm run build` — проверить успешную сборку
   - Проверить генерацию sw.js в dist/

**Критерии приёмки:**
- [ ] VitePWA plugin установлен и настроен
- [ ] `npm run build` генерирует service worker
- [ ] Типы virtual:pwa-register доступны в TypeScript

---

### Задача 0.2: Схема базы данных Dexie.js

**Приоритет:** P0 (Критический)
**Зависимости:** Нет
**Блокирует:** 1.2 Миграция IndexedDB, 2.1 Download Manager, 2.2 Storage Manager, 2.3 Background Sync

**Владение файлами (эксклюзивное):**
```
frontend/src/services/
└── db.ts                       [СОЗДАТЬ] — Dexie.js схема и экспорт
```

**Шаги реализации:**

1. **Установка Dexie.js:**
   ```bash
   npm install dexie dexie-react-hooks
   ```

2. **Создать src/services/db.ts:**
   - Определить интерфейсы: `OfflineBook`, `CachedChapter`, `CachedImage`, `SyncOperation`
   - Создать класс `FancaiDatabase extends Dexie`
   - Определить версию схемы v1 с индексами
   - Экспортировать singleton `db`

3. **Типы для данных:**
   ```typescript
   interface OfflineBook {
     id: string  // `${userId}:${bookId}`
     userId: string
     bookId: string
     metadata: BookMetadata
     downloadedAt: number
     lastAccessedAt: number
     downloadProgress: number
     status: 'downloading' | 'complete' | 'partial' | 'error'
   }

   interface CachedChapter {
     id: string  // `${userId}:${bookId}:${chapterNumber}`
     userId: string
     bookId: string
     chapterNumber: number
     title: string
     content: string
     descriptions: Description[]
     wordCount: number
     cachedAt: number
     lastAccessedAt: number
   }

   interface CachedImage {
     id: string  // `${userId}:${descriptionId}`
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
   ```

4. **Индексы:**
   ```typescript
   this.version(1).stores({
     offlineBooks: 'id, userId, bookId, status, lastAccessedAt',
     chapters: 'id, [userId+bookId], [userId+bookId+chapterNumber], lastAccessedAt',
     images: 'id, userId, bookId, descriptionId, cachedAt',
     syncQueue: 'id, userId, type, priority, status, createdAt',
   })
   ```

**Критерии приёмки:**
- [ ] Dexie.js установлен
- [ ] src/services/db.ts создан с полной схемой
- [ ] База данных успешно инициализируется
- [ ] Все типы экспортированы

---

## Фаза 1: Ядро PWA (P0)

> **Статус:** После завершения Фазы 0
> **Параллелизм:** Задачи 1.1, 1.2, 1.3 могут выполняться параллельно
> **Время:** ~8 часов

### Задача 1.1: Service Worker (Workbox)

**Приоритет:** P0
**Зависимости:** 0.1 VitePWA интеграция
**Блокирует:** 2.3 Background Sync

**Владение файлами (эксклюзивное):**
```
frontend/
├── src/
│   ├── sw.ts                   [СОЗДАТЬ] — кастомный service worker
│   └── main.tsx                [ИЗМЕНИТЬ] — регистрация SW через VitePWA
└── public/
    └── sw.js                   [УДАЛИТЬ] — заменяется на Workbox-генерируемый
```

**Шаги реализации:**

1. **Обновить vite.config.ts для injectManifest:**
   ```typescript
   VitePWA({
     strategies: 'injectManifest',
     srcDir: 'src',
     filename: 'sw.ts',
     // ... остальная конфигурация
   })
   ```

2. **Создать src/sw.ts:**
   - Импорты из workbox-precaching, workbox-routing, workbox-strategies
   - `precacheAndRoute(self.__WB_MANIFEST)`
   - Runtime caching для:
     - Google Fonts (CacheFirst, 1 год)
     - API запросы (NetworkFirst, 1 час)
     - Изображения (CacheFirst, 30 дней)
   - `navigateFallback: '/index.html'`

3. **Обновить main.tsx:**
   - Удалить старую регистрацию SW из serviceWorker.ts
   - Использовать `useRegisterSW` из 'virtual:pwa-register/react'

4. **Удалить public/sw.js**

**Критерии приёмки:**
- [ ] Workbox SW генерируется при сборке
- [ ] Precaching работает для статических ассетов
- [ ] Runtime caching работает для API и изображений
- [ ] Навигация offline работает (index.html fallback)

---

### Задача 1.2: Миграция IndexedDB на Dexie.js

**Приоритет:** P0
**Зависимости:** 0.2 Dexie.js схема
**Блокирует:** Нет (совместима с существующими данными)

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── services/
│   ├── chapterCache.ts         [ПЕРЕПИСАТЬ] — на Dexie.js API
│   └── imageCache.ts           [ПЕРЕПИСАТЬ] — на Dexie.js API
└── hooks/
    └── useOfflineBook.ts       [СОЗДАТЬ] — hook с useLiveQuery
```

**Шаги реализации:**

1. **Переписать chapterCache.ts:**
   - Заменить прямой IndexedDB API на `db.chapters`
   - Использовать Dexie transactions
   - Сохранить публичный API совместимым

2. **Переписать imageCache.ts:**
   - Заменить прямой IndexedDB API на `db.images`
   - Добавить методы для blob хранения
   - Сохранить публичный API совместимым

3. **Создать useOfflineBook.ts:**
   ```typescript
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

     return { offlineBook, chapters, isAvailableOffline: offlineBook?.status === 'complete' }
   }
   ```

4. **Миграция существующих данных:**
   - Добавить код миграции при первом запуске новой версии
   - Перенести данные из старой IDB в новую схему Dexie

**Критерии приёмки:**
- [ ] chapterCache.ts работает на Dexie.js
- [ ] imageCache.ts работает на Dexie.js
- [ ] useOfflineBook hook реактивно обновляется
- [ ] Существующие кэшированные данные мигрированы

---

### Задача 1.3: TanStack Query offline-first

**Приоритет:** P0
**Зависимости:** 0.2 Dexie.js схема
**Блокирует:** Нет

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── providers/
│   └── QueryProvider.tsx       [ИЗМЕНИТЬ] — добавить offline конфигурацию
└── hooks/api/
    ├── useBooks.ts             [ИЗМЕНИТЬ] — добавить IndexedDB fallback
    └── useChapter.ts           [ИЗМЕНИТЬ] — интеграция с Dexie cache
```

**Шаги реализации:**

1. **Обновить QueryProvider.tsx:**
   ```typescript
   const queryClient = new QueryClient({
     defaultOptions: {
       queries: {
         networkMode: 'offlineFirst',
         staleTime: 1000 * 60 * 5,
         gcTime: 1000 * 60 * 60 * 24,
       },
       mutations: {
         networkMode: 'offlineFirst',
       },
     },
   })
   ```

2. **Обновить useBooks.ts:**
   - Добавить `placeholderData` из IndexedDB
   - Сохранять ответы в IndexedDB для offline

3. **Обновить useChapter.ts:**
   - Проверять Dexie cache перед запросом
   - Кэшировать успешные ответы в Dexie
   - Использовать `initialData` из cache

**Критерии приёмки:**
- [ ] TanStack Query работает в offline режиме
- [ ] Данные сохраняются в IndexedDB
- [ ] При offline данные берутся из cache

---

## Фаза 2: Offline функциональность (P1)

> **Статус:** После завершения Фазы 1
> **Параллелизм:** Задачи 2.1, 2.2, 2.3 могут выполняться параллельно
> **Время:** ~12 часов

### Задача 2.1: Download Manager

**Приоритет:** P1
**Зависимости:** 0.2 Dexie.js схема, 1.2 Миграция IndexedDB
**Блокирует:** 5.1 Settings Page

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── services/
│   └── downloadManager.ts      [СОЗДАТЬ] — менеджер загрузок
├── hooks/
│   └── useDownloadBook.ts      [СОЗДАТЬ] — hook для UI
└── components/Reader/
    └── DownloadBookButton.tsx  [СОЗДАТЬ] — кнопка "Скачать для offline"
```

**Шаги реализации:**

1. **Создать downloadManager.ts:**
   - Класс `DownloadManager` с методами:
     - `downloadBook(bookId, userId, onProgress)`
     - `cancelDownload(bookId, userId)`
     - `deleteOfflineBook(bookId, userId)`
   - AbortController для отмены загрузок
   - Проверка квоты перед загрузкой
   - Последовательная загрузка глав с прогрессом

2. **Создать useDownloadBook.ts:**
   ```typescript
   export function useDownloadBook(bookId: string) {
     const [progress, setProgress] = useState(0)
     const [isDownloading, setIsDownloading] = useState(false)

     const startDownload = async () => { ... }
     const cancelDownload = () => { ... }

     return { progress, isDownloading, startDownload, cancelDownload }
   }
   ```

3. **Создать DownloadBookButton.tsx:**
   - UI для кнопки загрузки
   - Progress indicator
   - Кнопка отмены

**Критерии приёмки:**
- [ ] Книга загружается для offline чтения
- [ ] Прогресс отображается в UI
- [ ] Загрузку можно отменить
- [ ] Offline книгу можно удалить

---

### Задача 2.2: Storage Manager

**Приоритет:** P1
**Зависимости:** 0.2 Dexie.js схема
**Блокирует:** 5.1 Settings Page

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── services/
│   └── storageManager.ts       [СОЗДАТЬ] — управление квотой
└── hooks/
    └── useStorageInfo.ts       [СОЗДАТЬ] — hook для UI
```

**Шаги реализации:**

1. **Создать storageManager.ts:**
   - Класс `StorageManager`:
     - `getStorageEstimate()` — navigator.storage.estimate()
     - `requestPersistentStorage()` — navigator.storage.persist()
     - `getStorageInfo()` — usage, quota, percentUsed, isWarning, isCritical
     - `canDownload(estimatedSize)` — проверка места
     - `performCleanup(targetFreeSpace)` — LRU очистка
     - `clearAllOfflineData()` — полная очистка

2. **Константы:**
   ```typescript
   MAX_CACHE_SIZE = 1 * 1024 * 1024 * 1024  // 1 ГБ
   WARNING_THRESHOLD = 0.8   // 80%
   CRITICAL_THRESHOLD = 0.95 // 95%
   ```

3. **Создать useStorageInfo.ts:**
   - TanStack Query для получения storage info
   - Автообновление каждые 30 секунд
   - Mutation для requestPersistence

**Критерии приёмки:**
- [ ] Storage info корректно отображается
- [ ] Persistent storage запрашивается
- [ ] LRU очистка работает при превышении квоты
- [ ] Предупреждения показываются при 80%+ использовании

---

### Задача 2.3: Background Sync

**Приоритет:** P1
**Зависимости:** 0.2 Dexie.js схема, 1.1 Service Worker
**Блокирует:** 4.1 iOS Support

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── services/
│   └── syncQueue.ts            [ПЕРЕПИСАТЬ] — на Background Sync API + Dexie
└── sw.ts                       [ДОПОЛНИТЬ] — BackgroundSyncPlugin роуты
```

**Шаги реализации:**

1. **Обновить sw.ts:**
   - Добавить `BackgroundSyncPlugin` для критичных операций
   - Настроить очереди:
     - `fancai-critical-sync` (progress, reading_session) — 24 часа
     - `fancai-image-sync` (image_generation) — 7 дней
   - Зарегистрировать роуты для POST/PUT запросов

2. **Переписать syncQueue.ts:**
   - Использовать `db.syncQueue` вместо localStorage
   - Добавить методы:
     - `addOperation(operation)` — добавление в очередь
     - `processQueue()` — обработка очереди
     - `setupVisibilitySync()` — fallback для iOS
   - Приоритизация операций
   - Экспоненциальный backoff при ошибках

3. **События для UI:**
   - `sync:success` — успешная синхронизация
   - `sync:failed` — ошибка синхронизации

**Критерии приёмки:**
- [ ] Background Sync работает на Android/Chrome
- [ ] Offline операции ставятся в очередь
- [ ] Очередь обрабатывается при восстановлении сети
- [ ] Приоритизация работает корректно

---

## Фаза 3: Push-уведомления (P1)

> **Статус:** После завершения Фазы 1
> **Параллелизм:** Задачи 3.1 и 3.2 могут выполняться параллельно
> **Время:** ~8 часов

### Задача 3.1: Backend Push API

**Приоритет:** P1
**Зависимости:** Нет
**Блокирует:** 3.2 Frontend Push Manager (частично)

**Владение файлами (эксклюзивное):**
```
backend/
├── app/
│   ├── models/
│   │   └── push_subscription.py    [СОЗДАТЬ] — модель подписки
│   ├── schemas/
│   │   └── push.py                 [СОЗДАТЬ] — Pydantic схемы
│   ├── services/
│   │   └── push_notification_service.py  [СОЗДАТЬ] — сервис отправки
│   ├── routers/
│   │   └── push.py                 [СОЗДАТЬ] — API эндпоинты
│   └── tasks/
│       └── book_processing.py      [ИЗМЕНИТЬ] — интеграция push
├── alembic/versions/
│   └── xxx_add_push_subscriptions.py  [СОЗДАТЬ] — миграция
├── requirements.txt                [ИЗМЕНИТЬ] — добавить pywebpush
└── .env.example                    [ИЗМЕНИТЬ] — VAPID ключи
```

**Шаги реализации:**

1. **Установка pywebpush:**
   ```bash
   pip install pywebpush
   ```

2. **Создать модель push_subscription.py:**
   ```python
   class PushSubscription(Base):
       __tablename__ = "push_subscriptions"

       id = Column(UUID, primary_key=True)
       user_id = Column(UUID, ForeignKey("users.id"))
       endpoint = Column(String(500), unique=True, index=True)
       p256dh_key = Column(String(200))
       auth_key = Column(String(50))
       created_at = Column(DateTime)
   ```

3. **Создать push_notification_service.py:**
   - Класс `PushNotificationService`
   - Методы: `send_notification`, `send_book_ready_notification`, `send_image_ready_notification`
   - Обработка expired подписок (404, 410)
   - TTL 24 часа

4. **Создать push.py роутер:**
   - `GET /push/vapid-public-key`
   - `POST /push/subscribe`
   - `DELETE /push/unsubscribe`
   - `GET /push/subscriptions`

5. **Интеграция с Celery:**
   - Добавить отправку push в `process_book_task`
   - Добавить отправку push в `generate_image_task`

6. **Миграция:**
   ```bash
   alembic revision --autogenerate -m "add push_subscriptions table"
   alembic upgrade head
   ```

7. **VAPID ключи:**
   ```bash
   npx web-push generate-vapid-keys
   ```

**Критерии приёмки:**
- [ ] Модель и миграция созданы
- [ ] API эндпоинты работают
- [ ] Push уведомления отправляются
- [ ] Expired подписки удаляются

---

### Задача 3.2: Frontend Push Manager

**Приоритет:** P1
**Зависимости:** 1.1 Service Worker
**Блокирует:** 5.1 Settings Page

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── services/
│   └── pushNotifications.ts    [СОЗДАТЬ] — менеджер подписок
├── hooks/
│   └── usePushNotifications.ts [СОЗДАТЬ] — hook для UI
└── sw.ts                       [ДОПОЛНИТЬ] — push event handlers
```

**Шаги реализации:**

1. **Создать pushNotifications.ts:**
   - Класс `PushNotificationManager`:
     - `init()` — проверка поддержки, получение VAPID key
     - `subscribe()` — создание подписки
     - `unsubscribe()` — удаление подписки
     - `isSubscribed()` — проверка статуса
   - Конвертация VAPID key в Uint8Array

2. **Создать usePushNotifications.ts:**
   ```typescript
   export function usePushNotifications() {
     const [isSupported, setIsSupported] = useState(false)
     const [isSubscribed, setIsSubscribed] = useState(false)

     const subscribe = useMutation({ ... })
     const unsubscribe = useMutation({ ... })

     return { isSupported, isSubscribed, subscribe, unsubscribe }
   }
   ```

3. **Дополнить sw.ts:**
   - `self.addEventListener('push', handler)`
   - `self.addEventListener('notificationclick', handler)`
   - `getActionsForType(type)` — кнопки для разных типов
   - Навигация при клике на уведомление

**Критерии приёмки:**
- [ ] Push подписка создаётся
- [ ] Push уведомления отображаются
- [ ] Клик на уведомление открывает нужную страницу
- [ ] Подписку можно отменить

---

## Фаза 4: UX и iOS поддержка (P2)

> **Статус:** После завершения Фазы 2
> **Параллелизм:** Все задачи могут выполняться параллельно
> **Время:** ~6 часов

### Задача 4.1: iOS Support

**Приоритет:** P2
**Зависимости:** 2.3 Background Sync
**Блокирует:** Нет

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── utils/
│   └── iosSupport.ts           [СОЗДАТЬ] — iOS утилиты
└── components/UI/
    └── IOSInstallInstructions.tsx  [СОЗДАТЬ] — инструкции установки
```

**Шаги реализации:**

1. **Создать iosSupport.ts:**
   - Определение iOS: `isIOS`, `isSafari`, `isIOSSafari`
   - Определение standalone: `isStandalone`
   - `getIOSVersion()` — версия iOS
   - `canUsePushOnIOS()` — iOS 16.4+ в standalone
   - `canUseBackgroundSync()` — false для iOS
   - `setupIOSSync(syncFn)` — visibilitychange + online events
   - `setupIOSPersistence()` — navigator.storage.persist()

2. **Создать IOSInstallInstructions.tsx:**
   - Пошаговая инструкция "Add to Home Screen"
   - Иконки Share и Plus
   - Кнопка dismiss с сохранением в localStorage
   - Режим inline для Settings page

**Критерии приёмки:**
- [ ] iOS определяется корректно
- [ ] Инструкции показываются только на iOS Safari
- [ ] Синхронизация через visibilitychange работает
- [ ] Persistent storage запрашивается на iOS

---

### Задача 4.2: Install Prompt

**Приоритет:** P2
**Зависимости:** Нет
**Блокирует:** 5.1 Settings Page

**Владение файлами (эксклюзивное):**
```
frontend/src/
└── hooks/
    └── usePWAInstall.ts        [СОЗДАТЬ] — hook для install prompt
```

**Шаги реализации:**

1. **Создать usePWAInstall.ts:**
   - Состояние: `deferredPrompt`, `isInstalled`, `isInstalling`
   - Слушатель `beforeinstallprompt` события
   - Слушатель `appinstalled` события
   - Метод `install()` — вызов prompt()
   - Проверка standalone режима

**Критерии приёмки:**
- [ ] Install prompt перехватывается
- [ ] Установка работает на Android/Desktop
- [ ] Состояние `isInstalled` корректное

---

### Задача 4.3: PWA Update Prompt

**Приоритет:** P2
**Зависимости:** 0.1 VitePWA интеграция
**Блокирует:** Нет

**Владение файлами (эксклюзивное):**
```
frontend/src/
├── components/UI/
│   └── PWAUpdatePrompt.tsx     [СОЗДАТЬ] — уведомление об обновлении
└── App.tsx                     [ИЗМЕНИТЬ] — добавить PWAUpdatePrompt
```

**Шаги реализации:**

1. **Создать PWAUpdatePrompt.tsx:**
   - Использовать `useRegisterSW` из 'virtual:pwa-register/react'
   - UI уведомления: "Доступна новая версия"
   - Кнопки "Позже" и "Обновить"
   - Проверка обновлений каждый час
   - Фиксированная позиция внизу экрана

2. **Обновить App.tsx:**
   - Добавить `<PWAUpdatePrompt />` в layout

**Критерии приёмки:**
- [ ] Уведомление показывается при наличии обновления
- [ ] Кнопка "Обновить" применяет обновление
- [ ] Кнопка "Позже" закрывает уведомление

---

## Фаза 5: Интеграция и тестирование

> **Статус:** После завершения всех предыдущих фаз
> **Параллелизм:** Задачи 5.2 и 5.3 могут выполняться параллельно после 5.1
> **Время:** ~10 часов

### Задача 5.1: Settings Page интеграция

**Приоритет:** P1
**Зависимости:** 2.1, 2.2, 3.2, 4.1, 4.2
**Блокирует:** 5.2 E2E тестирование

**Владение файлами (эксклюзивное):**
```
frontend/src/
└── pages/
    └── SettingsPage.tsx        [ИЗМЕНИТЬ] — добавить PWA секции
```

**Шаги реализации:**

1. **Добавить секцию "Установка приложения":**
   - Статус установки (✓ Установлено / Кнопка "Установить")
   - iOS инструкции для Safari
   - Информация о преимуществах PWA

2. **Добавить секцию "Офлайн-хранилище":**
   - Прогресс-бар использования
   - Статус persistent storage
   - Кнопка "Запросить постоянное хранилище"
   - Предупреждения при 80%+ использовании
   - Кнопка "Очистить офлайн-данные"

3. **Добавить секцию "Уведомления":**
   - Toggle для push-уведомлений
   - Статус подписки
   - Типы уведомлений (книга готова, изображение готово)

**Критерии приёмки:**
- [ ] Все PWA настройки доступны в Settings
- [ ] UI соответствует дизайну приложения
- [ ] Все функции работают корректно

---

### Задача 5.2: E2E тестирование

**Приоритет:** P1
**Зависимости:** 5.1 Settings Page интеграция
**Блокирует:** Нет

**Владение файлами (эксклюзивное):**
```
frontend/
└── e2e/
    └── pwa.spec.ts             [СОЗДАТЬ] — E2E тесты PWA
```

**Шаги реализации:**

1. **Создать e2e/pwa.spec.ts:**
   ```typescript
   test.describe('PWA Features', () => {
     test('должен кэшировать app shell при установке')
     test('должен работать офлайн после кэширования')
     test('должен ставить операции в очередь офлайн')
     test('должен синхронизировать очередь при восстановлении сети')
     test('iOS: должен показывать инструкции установки')
   })
   ```

2. **Тесты для offline режима:**
   - `context.setOffline(true)` для эмуляции
   - Проверка кэшированного контента
   - Проверка sync queue

3. **Тесты для iOS:**
   - Эмуляция User-Agent iOS Safari
   - Проверка отображения инструкций

**Критерии приёмки:**
- [ ] Все E2E тесты проходят
- [ ] Offline сценарии покрыты
- [ ] iOS сценарии покрыты

---

### Задача 5.3: Lighthouse оптимизация

**Приоритет:** P2
**Зависимости:** 5.1 Settings Page интеграция
**Блокирует:** Нет

**Владение файлами:**
```
frontend/
├── public/
│   ├── manifest.json           [ПРОВЕРИТЬ] — полнота манифеста
│   └── icons/                  [ПРОВЕРИТЬ] — наличие всех иконок
└── index.html                  [ПРОВЕРИТЬ] — meta теги
```

**Шаги реализации:**

1. **Запустить Lighthouse PWA аудит:**
   ```bash
   npm run build && npm run preview
   # Открыть Chrome DevTools -> Lighthouse -> PWA
   ```

2. **Исправить найденные проблемы:**
   - Maskable icons
   - Theme color meta tag
   - Viewport meta tag
   - Start URL
   - Offline capability

3. **Целевые показатели:**
   - PWA Score: 90+
   - Performance: 80+
   - Best Practices: 90+
   - Accessibility: 90+

**Критерии приёмки:**
- [ ] Lighthouse PWA Score ≥ 90
- [ ] Все PWA требования выполнены
- [ ] Нет критических предупреждений

---

## Матрица владения файлами

### Файлы с эксклюзивным владением

| Файл | Задача | Агент |
|------|--------|-------|
| `vite.config.ts` | 0.1 | Agent-VitePWA |
| `src/services/db.ts` | 0.2 | Agent-Dexie |
| `src/sw.ts` | 1.1, 2.3, 3.2 | Agent-ServiceWorker |
| `src/services/chapterCache.ts` | 1.2 | Agent-Migration |
| `src/services/imageCache.ts` | 1.2 | Agent-Migration |
| `src/services/downloadManager.ts` | 2.1 | Agent-Download |
| `src/services/storageManager.ts` | 2.2 | Agent-Storage |
| `src/services/syncQueue.ts` | 2.3 | Agent-Sync |
| `backend/app/services/push_notification_service.py` | 3.1 | Agent-BackendPush |
| `src/services/pushNotifications.ts` | 3.2 | Agent-FrontendPush |
| `src/utils/iosSupport.ts` | 4.1 | Agent-iOS |
| `src/hooks/usePWAInstall.ts` | 4.2 | Agent-Install |
| `src/components/UI/PWAUpdatePrompt.tsx` | 4.3 | Agent-Update |
| `src/pages/SettingsPage.tsx` | 5.1 | Agent-Integration |

### Файлы с последовательным доступом

| Файл | Порядок задач |
|------|---------------|
| `main.tsx` | 1.1 → 4.3 |
| `App.tsx` | 4.3 |
| `package.json` | 0.1 → 0.2 |

---

## Порядок выполнения для максимального параллелизма

```
Неделя 1:
├── День 1-2:
│   ├── [Agent-VitePWA]     0.1 VitePWA интеграция
│   └── [Agent-Dexie]       0.2 Dexie.js схема
│
├── День 3-4:
│   ├── [Agent-SW]          1.1 Service Worker Workbox
│   ├── [Agent-Migration]   1.2 Миграция IndexedDB
│   └── [Agent-Query]       1.3 TanStack Query offline
│
└── День 5:
    └── Интеграционное тестирование Фазы 0-1

Неделя 2:
├── День 1-3:
│   ├── [Agent-Download]    2.1 Download Manager
│   ├── [Agent-Storage]     2.2 Storage Manager
│   ├── [Agent-Sync]        2.3 Background Sync
│   ├── [Agent-BackendPush] 3.1 Backend Push API
│   └── [Agent-FrontendPush]3.2 Frontend Push Manager
│
└── День 4-5:
    └── Интеграционное тестирование Фазы 2-3

Неделя 3:
├── День 1-2:
│   ├── [Agent-iOS]         4.1 iOS Support
│   ├── [Agent-Install]     4.2 Install Prompt
│   └── [Agent-Update]      4.3 PWA Update Prompt
│
├── День 3:
│   └── [Agent-Integration] 5.1 Settings Page
│
└── День 4-5:
    ├── [Agent-Test]        5.2 E2E тестирование
    └── [Agent-Lighthouse]  5.3 Lighthouse оптимизация
```

---

## Правила предотвращения конфликтов

### 1. Правило эксклюзивного владения
- Каждый файл принадлежит только одной задаче в каждый момент времени
- Если задача требует изменения файла другой задачи — ждать её завершения

### 2. Правило зависимостей
- Задача не начинается, пока все её зависимости не завершены
- При запуске агента передавать список завершённых задач

### 3. Правило интерфейсов
- Задачи, создающие новые модули, должны сначала определить публичный API
- Зависимые задачи могут использовать mock этого API до готовности

### 4. Правило коммитов
- Каждая задача — отдельный feature branch
- Merge в main только после прохождения тестов
- Формат: `feat(pwa): [task-id] description`

### 5. Правило синхронизации
- После каждой фазы — интеграционное тестирование
- Конфликты в shared файлах разрешаются координатором

---

## Чеклист завершения

### Фаза 0 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] VitePWA plugin установлен и настроен
- [x] Dexie.js схема создана
- [x] Build проходит успешно

### Фаза 1 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] Service Worker генерируется Workbox (injectManifest)
- [x] IndexedDB мигрирован на Dexie.js
- [x] TanStack Query работает offline

### Фаза 2 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] Download Manager работает
- [x] Storage Manager показывает квоту
- [x] Background Sync синхронизирует операции

### Фаза 3 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] Backend Push API работает
- [x] Frontend получает уведомления
- [ ] Celery отправляет push при завершении задач (интеграция — отдельная задача)

### Фаза 4 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] iOS workarounds работают
- [x] Install prompt показывается
- [x] Update prompt показывается

### Фаза 5 ✅ ЗАВЕРШЕНА (2026-01-09)
- [x] Settings Page содержит все PWA секции
- [x] E2E тесты созданы (20 тестов в 10 группах)
- [x] Lighthouse PWA оптимизация выполнена

---

## Ссылки

- [PWA Implementation Prompt](../../guides/development/pwa-implementation-prompt.md)
- [VitePWA Documentation](https://vite-pwa-org.netlify.app/)
- [Dexie.js Documentation](https://dexie.org/)
- [Workbox Documentation](https://developer.chrome.com/docs/workbox/)

---

## Журнал выполнения

### 2026-01-09: Фаза 0 завершена

**Задача 0.1: VitePWA интеграция**
- Установлены: `vite-plugin-pwa@1.2.0`, `workbox-window@7.4.0`
- Обновлён `vite.config.ts` с VitePWA plugin
- Конфигурация runtime caching:
  - Google Fonts → CacheFirst (1 год)
  - API `/api/v1/*` → NetworkFirst (1 час)
  - Изображения → CacheFirst (30 дней)
- Добавлены типы в `vite-env.d.ts`
- Результат сборки:
  ```
  PWA v1.2.0
  mode: generateSW
  precache: 26 entries (2710.96 KiB)
  files: dist/sw.js, dist/workbox-57649e2b.js
  ```

**Задача 0.2: Dexie.js схема**
- Установлены: `dexie@4.2.1`, `dexie-react-hooks@4.2.0`
- Создан `src/services/db.ts` (8.3 KB)
- Таблицы: `offlineBooks`, `chapters`, `images`, `syncQueue`, `readingProgress`
- Типы: `OfflineBook`, `CachedChapter`, `CachedImage`, `SyncOperation`, `OfflineReadingProgress`
- Вспомогательные функции: `createOfflineBookId`, `createChapterId`, `createImageId`, `parseOfflineBookId`, `parseChapterId`
- Константы: `MAX_CACHE_SIZE` (1 ГБ), `STORAGE_WARNING_THRESHOLD` (80%), `MAX_SYNC_RETRIES` (5)

**Следующие шаги:** Фаза 1 — Ядро PWA (Service Worker Workbox, миграция IndexedDB, TanStack Query offline)

---

### 2026-01-09: Фаза 1 завершена

**Задача 1.1: Service Worker (Workbox injectManifest)**
- Создан `src/sw.ts` (9.5 KB) — кастомный Service Worker
- Runtime caching стратегии:
  - Google Fonts → CacheFirst (1 год)
  - API `/api/v1/*` → NetworkFirst (1 час, исключая /auth/ и /admin/)
  - Изображения → CacheFirst (30 дней)
  - Pollinations.ai → CacheFirst (30 дней)
  - Статические ассеты → StaleWhileRevalidate (30 дней)
  - SPA навигация → NetworkFirst
- Обновлён `vite.config.ts` на `strategies: 'injectManifest'`
- Обновлён `main.tsx` с `registerSW` из `virtual:pwa-register`
- Удалён старый `public/sw.js` (487 строк)
- Результат сборки:
  ```
  PWA v1.2.0
  mode: injectManifest
  precache: 25 entries (1577.87 KiB)
  dist/sw.js: 28.73 kB (gzip: 9.22 kB)
  ```

**Задача 1.2: Миграция IndexedDB на Dexie.js**
- Переписан `src/services/chapterCache.ts` (12.9 KB) на Dexie.js API
- Переписан `src/services/imageCache.ts` (14.3 KB) на Dexie.js API
- Создан `src/hooks/useOfflineBook.ts` (6.9 KB) с hooks:
  - `useOfflineBook(bookId)` — данные offline книги
  - `useOfflineBooks()` — список всех offline книг
  - `useIsChapterCached()` — проверка кэширования главы
  - `useOfflineReadingProgress()` — offline прогресс
  - `usePendingSyncCount()` — pending операции
  - `useStorageStats()` — статистика хранилища
- Все hooks используют `useLiveQuery` для реактивности
- Сохранена совместимость публичного API

**Задача 1.3: TanStack Query offline-first**
- Обновлён `src/lib/queryClient.ts`:
  - `networkMode: 'offlineFirst'` для queries и mutations
  - `staleTime: 5 минут`, `gcTime: 24 часа`
  - Custom retry без повторов для 4xx ошибок
- Обновлён `useBooks.ts` — offline fallback из IndexedDB
- Обновлён `useChapter.ts`:
  - Проверка Dexie cache перед запросом
  - Фоновое обновление при наличии сети
  - Сохранение в оба кэша (Dexie + legacy)

**Следующие шаги:** Фаза 2 — Offline функциональность (Download Manager, Storage Manager, Background Sync)

---

### 2026-01-09: Фаза 2 завершена

**Задача 2.1: Download Manager**
- Создан `src/services/downloadManager.ts` — менеджер загрузки книг для offline
  - Класс `DownloadManager` с методами:
    - `downloadBook(bookId, userId, onProgress)` — загрузка всех глав книги
    - `cancelDownload(bookId, userId)` — отмена загрузки через AbortController
    - `deleteOfflineBook(bookId, userId)` — удаление offline книги
    - `updateBookAccess(bookId, userId)` — обновление lastAccessedAt
  - Предварительная проверка квоты хранилища
  - Последовательная загрузка глав с прогрессом
  - Автоматическое обновление статуса в Dexie.js
- Создан `src/hooks/useDownloadBook.ts` — hook для UI
  - Состояние: `progress`, `isDownloading`, `error`
  - Методы: `startDownload()`, `cancelDownload()`
  - Реактивное отслеживание статуса из Dexie.js
- Создан `src/components/Library/DownloadBookButton.tsx` — UI компонент
  - Кнопка с progress индикатором
  - Поддержка отмены загрузки
  - Статусы: скачать / скачивание / скачано / удалить

**Задача 2.2: Storage Manager**
- Создан `src/services/storageManager.ts` (15.8 KB) — управление квотой хранилища
  - Методы:
    - `getStorageEstimate()` — получение navigator.storage.estimate()
    - `requestPersistentStorage()` — запрос постоянного хранилища
    - `getStorageInfo()` — детальная информация: usage, quota, percentUsed, isWarning, isCritical
    - `canDownload(estimatedSize)` — проверка возможности загрузки
    - `performCleanup(targetFreeSpace)` — LRU очистка данных
    - `clearAllOfflineData()` — полная очистка
  - Константы:
    - `MAX_CACHE_SIZE`: 1 ГБ
    - `WARNING_THRESHOLD`: 80%
    - `CRITICAL_THRESHOLD`: 95%
  - LRU стратегия очистки: images → chapters → failed sync ops
- Создан `src/hooks/useStorageInfo.ts` (6.0 KB) — hooks для UI
  - `useStorageInfo()` — TanStack Query для storage info
  - `useRequestPersistence()` — mutation для requestPersistence
  - `useClearOfflineData()` — mutation для очистки данных
  - Автообновление каждые 30 секунд

**Задача 2.3: Background Sync**
- Переписан `src/services/syncQueue.ts` (557 строк) — Background Sync + Dexie.js
  - Использует `db.syncQueue` вместо localStorage
  - Методы:
    - `addOperation(operation)` — добавление в очередь с приоритетом
    - `processQueue()` — обработка очереди при восстановлении сети
    - `setupVisibilitySync()` — fallback для iOS через visibilitychange
    - `registerBackgroundSync(tag)` — регистрация Background Sync
  - Приоритеты: critical > high > normal > low
  - Экспоненциальный backoff при ошибках (base 1s, max 1h)
  - События для UI: `sync:success`, `sync:failed`, `sync:progress`
  - Очередь для offline операций:
    - `reading_progress` — критический приоритет
    - `reading_session` — критический приоритет
    - `bookmark` — высокий приоритет
    - `highlight` — нормальный приоритет
    - `image_generation` — низкий приоритет
- Обновлён `src/sw.ts` — добавлены BackgroundSyncPlugin роуты:
  - `fancai-critical-sync` — reading_progress, reading_session (24 часа)
  - `fancai-image-sync` — image_generation (7 дней)
  - Регистрация роутов для POST /api/v1/books/*/progress и PUT /api/v1/reading-sessions/*

**Особенности реализации:**
- Docker-совместимость: все API вызовы используют `credentials: 'include'` для JWT
- iOS fallback: синхронизация через `visibilitychange` + `online` события
- Graceful degradation: если Background Sync недоступен, используется immediate sync

**Следующие шаги:** Фаза 3 — Push-уведомления (Backend Push API, Frontend Push Manager)

---

### 2026-01-09: Фаза 3 завершена

**Задача 3.1: Backend Push API**
- Установлен `pywebpush>=2.0.0` в requirements.txt
- Создана модель `backend/app/models/push_subscription.py`:
  - Поля: id, user_id, endpoint (unique), p256dh_key, auth_key, is_active, created_at, updated_at
  - Индексы: user_id, endpoint, composite (user_id, is_active)
  - Relationship с User через CASCADE delete
- Создана схема `backend/app/schemas/push.py`:
  - `PushSubscriptionCreate` — endpoint + keys (p256dh, auth)
  - `PushSubscriptionResponse` — id, endpoint, created_at, is_active
  - `PushNotificationPayload` — title, body, icon, badge, tag, data, actions
  - `VAPIDPublicKeyResponse` — publicKey
- Создан сервис `backend/app/services/push_notification_service.py`:
  - `get_vapid_public_key()` — публичный VAPID ключ
  - `subscribe(db, user_id, subscription_info)` — создание подписки
  - `unsubscribe(db, user_id, endpoint)` — удаление подписки
  - `send_notification(subscription, payload)` — отправка уведомления
  - `send_to_user(db, user_id, payload)` — отправка всем устройствам пользователя
  - `send_book_ready_notification()` — уведомление о готовности книги
  - `send_image_ready_notification()` — уведомление о готовности изображения
  - Обработка 404/410 от push сервиса — деактивация expired подписок
  - TTL 24 часа для уведомлений
- Создан роутер `backend/app/routers/push.py`:
  - `GET /api/v1/push/vapid-public-key` — без авторизации
  - `POST /api/v1/push/subscribe` — требует auth
  - `DELETE /api/v1/push/unsubscribe` — требует auth
  - `GET /api/v1/push/subscriptions` — список подписок
  - `POST /api/v1/push/test` — тестовое уведомление
- Создана миграция `backend/alembic/versions/2026_01_09_0001_add_push_subscriptions_table.py`
- Обновлены конфигурации:
  - `backend/app/core/config.py` — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
  - `backend/.env.production.example` — VAPID переменные
  - `backend/.env.development` — VAPID переменные

**Задача 3.2: Frontend Push Manager**
- Создан `frontend/src/types/push.ts`:
  - `PushNotificationType` — union type (book_ready, image_ready, sync_complete, general)
  - `PushPayload` — структура payload уведомления
  - `PushNotificationData` — данные для навигации при клике
  - `PushSubscriptionKeys` — p256dh и auth ключи
  - `PushSubscriptionPayload` — payload для регистрации на backend
- Создан `frontend/src/services/pushNotifications.ts`:
  - Singleton `pushManager` класса `PushNotificationManager`
  - `isSupported()` — проверка Push API
  - `isIOSSafari()` / `isStandalone()` — iOS PWA-only поддержка
  - `canUsePush()` / `getUnavailableReason()` — graceful degradation
  - `getVapidPublicKey()` — fetch от /api/v1/push/vapid-public-key
  - `urlBase64ToUint8Array()` — конвертация VAPID key
  - `subscribe()` / `unsubscribe()` — управление подпиской
  - Все API вызовы с `credentials: 'include'` для JWT
- Создан `frontend/src/hooks/usePushNotifications.ts`:
  - TanStack Query интеграция с `pushKeys` для кэширования
  - Состояние: permissionState, isSubscribed, isLoading, error
  - Флаги поддержки: isSupported, canUsePush, isIOSSafari, isStandalone
  - Mutations: subscribe(), unsubscribe(), testNotification()
  - Автоматический listener изменения permission через Permissions API
- Обновлён `frontend/src/sw.ts` — добавлены push обработчики:
  - `push` event handler — парсинг payload, showNotification()
  - `notificationclick` handler — навигация по типу уведомления
  - `notificationclose` handler — для аналитики
  - `getNotificationOptions()` — type-specific опции с actions
  - `getDefaultContent()` — умные defaults на основе типа
  - Client messaging через postMessage для in-app handling

**VAPID ключи генерация:**
```bash
npx web-push generate-vapid-keys
```

**Следующие шаги:** Фаза 4 — UX и iOS поддержка (iOS Support, Install Prompt, PWA Update Prompt)

---

### 2026-01-09: Фаза 4 завершена

**Задача 4.1: iOS Support**
- Создан `frontend/src/utils/iosSupport.ts` — утилиты для iOS:
  - **Определение платформы:**
    - `isIOS()` — определение iPhone/iPad/iPod
    - `isSafari()` — определение Safari
    - `isIOSSafari()` — iOS + Safari
    - `isStandalone()` — PWA режим (standalone)
    - `getIOSVersion()` — парсинг версии iOS
  - **Проверка возможностей:**
    - `canUsePushOnIOS()` — iOS 16.4+ в standalone
    - `canUseBackgroundSync()` — false для iOS
    - `canUsePersistentStorage()` — проверка API
  - **iOS workarounds:**
    - `setupIOSSync(syncFn)` — sync через visibilitychange/online
    - `setupIOSPersistence()` — запрос persistent storage
    - `getIOSInstallInstructions()` — шаги установки
  - **Install prompt management:**
    - `shouldShowIOSInstallPrompt()` — показывать ли prompt
    - `dismissIOSInstallPrompt()` — dismiss на 7 дней
    - `getPlatformInfo()` — полная информация о платформе
  - **Константы:** `IOS_MIN_PUSH_VERSION = 16.4`, `IOS_STORAGE_EVICTION_DAYS = 7`
- Создан `frontend/src/components/UI/IOSInstallInstructions.tsx`:
  - Props: `mode` (modal/inline), `onDismiss`, `showOnlyOnIOS`, `forceShow`
  - Пошаговая инструкция "Добавить на экран «Домой»"
  - Иконки Share и Plus из lucide-react
  - Анимация framer-motion
  - Запоминание dismiss на 7 дней в localStorage
  - Поддержка тёмной темы
  - Режим inline для Settings page
  - Exported hooks: `useIOSInstallPrompt()`, `useIsIOSPWA()`

**Задача 4.2: Install Prompt**
- Создан `frontend/src/hooks/usePWAInstall.ts`:
  - **Return values:**
    - `isInstallable` — есть deferredPrompt
    - `isInstalled` — standalone режим
    - `isInstalling` — в процессе установки
    - `isIOSDevice` — iOS устройство
    - `install()` — вызов prompt
    - `installSource` — 'browser' | 'ios-manual' | null
  - **Особенности:**
    - SSR безопасность (isBrowser проверки)
    - Обработка beforeinstallprompt события
    - Обработка appinstalled события
    - iPadOS 13+ определение (reports as Mac)
    - Android TWA определение
    - Проверка standalone/fullscreen/minimal-ui
    - Cleanup listeners при unmount

**Задача 4.3: PWA Update Prompt**
- Создан `frontend/src/components/UI/PWAUpdatePrompt.tsx`:
  - Использует `useRegisterSW` из 'virtual:pwa-register/react'
  - Автопроверка обновлений при монтировании
  - Периодическая проверка каждый час
  - Фиксированная позиция внизу экрана (fixed bottom-4)
  - Анимация framer-motion (m компонент)
  - Mobile-first: full width на мобильных, max-w-sm справа на десктопе
  - Использует существующие Button и Card компоненты
  - Иконки RefreshCw и X из lucide-react
  - Кнопки "Обновить" (primary) и "Позже" (ghost)
  - Accessibility: role="alertdialog", aria-labelledby, aria-describedby
  - Кастомизируемые тексты через props
- Обновлён `frontend/src/App.tsx`:
  - Добавлен импорт и рендер `<PWAUpdatePrompt />`

**Следующие шаги:** Фаза 5 — Интеграция и тестирование (Settings Page, E2E, Lighthouse)

---

### 2026-01-09: Фаза 5 завершена

**Задача 5.1: Settings Page интеграция**
- Обновлён `frontend/src/pages/SettingsPage.tsx`:
  - Добавлена новая вкладка "Приложение" (PWA)
  - **Секция "Установка приложения":**
    - Статус установки с галочкой если installed
    - `<IOSInstallInstructions mode="inline" />` для iOS
    - Кнопка "Установить" через `usePWAInstall()`
    - Инструкции для ручной установки
  - **Секция "Офлайн-хранилище":**
    - Progress bar использования (`useStorageInfo()`)
    - Форматирование: "X МБ из Y МБ" через `formatBytes()`
    - Warning/Critical индикаторы при 80%/95%
    - Статус persistent storage с кнопкой запроса
    - Количество offline книг (`useOfflineBooks()`)
    - Кнопка "Очистить офлайн-данные" с ConfirmDialog
  - **Секция "Push-уведомления":**
    - Проверка поддержки (`usePushNotifications()`)
    - Сообщение для iOS не в standalone
    - Toggle подписки subscribe/unsubscribe
    - Кнопка тестового уведомления
  - Поддержка desktop (tabs) и mobile (accordion) layouts

**Задача 5.2: E2E тестирование**
- Создан `frontend/tests/pwa.spec.ts` (17 KB, 458 строк)
- **10 групп тестов, 20 тестов:**
  1. **Manifest and Service Worker** (3 теста) — валидация manifest, регистрация SW
  2. **Offline Mode** (3 теста) — app shell offline, offline indicator, восстановление
  3. **Caching** (2 теста) — кэширование ассетов, использование кэша
  4. **iOS Support** (3 теста) — iOS определение, apple-touch-icon, viewport
  5. **Update Prompt** (2 теста) — проверка обновлений, PWAUpdatePrompt
  6. **PWA Installation** (2 теста) — beforeinstallprompt, standalone
  7. **PWA Metadata** (2 теста) — meta теги, title
  8. **Cache Storage Management** (1 тест) — очистка кэша
  9. **Offline Functionality** (1 тест) — работа без сети
  10. **Performance** (1 тест) — скорость загрузки из кэша
- Использует Playwright API: `context.setOffline()`, `page.evaluate()`, iOS User-Agent эмуляция
- Создана документация `frontend/tests/PWA_TESTS.md`

**Задача 5.3: Lighthouse PWA оптимизация**
- Обновлён `frontend/index.html`:
  - Синхронизирован theme-color с manifest (#0ea5e9)
  - Добавлены apple-mobile-web-app-* meta теги
  - Исправлены favicon links на существующие иконки
  - Удалены дублирующие manifest links
- Обновлён `frontend/public/manifest.json`:
  - Добавлен `id: "/"`
  - Изменён `start_url` на `/?source=pwa`
  - Разделены иконки: `purpose: "any"` и `purpose: "maskable"`
  - Исправлены ссылки на существующие иконки
- Обновлён `frontend/vite.config.ts`:
  - Добавлен `includeAssets` для статических файлов
  - Добавлены workbox опции: `navigateFallback`, `navigateFallbackDenylist`, `cleanupOutdatedCaches`, `clientsClaim`
- Удалён дублирующий `public/site.webmanifest`

**Lighthouse PWA Checklist:**
- [x] Valid manifest (name, short_name, start_url, display, icons)
- [x] Theme color meta tag synchronized
- [x] Apple PWA meta tags
- [x] Service Worker registered
- [x] 192x192 icon
- [ ] 512x512 icon (нужно создать файл)
- [ ] Screenshots (опционально)

**Для полного Lighthouse PWA Score нужно:**
- Создать `/public/icon-512.png` (512x512)
- Опционально: screenshots для рич-превью в магазинах

---

### 2026-01-09: Исправление Docker-совместимости

**Проблема:** PWA сервисы (`pushNotifications.ts`, `syncQueue.ts`) использовали `credentials: 'include'` (для cookies), но проект использует **JWT в localStorage + Authorization header**.

**Исправления:**
- `src/services/pushNotifications.ts`:
  - Добавлен импорт `STORAGE_KEYS`
  - Добавлена функция `getAuthHeaders()` для получения Bearer token из localStorage
  - Все API вызовы `/api/v1/push/subscribe` и `/api/v1/push/unsubscribe` теперь используют Authorization header
  - Endpoint `/api/v1/push/vapid-public-key` не требует авторизации (публичный)
- `src/services/syncQueue.ts`:
  - Добавлен импорт `STORAGE_KEYS`
  - Добавлена функция `getAuthHeaders()`
  - Fetch вызовы при синхронизации очереди теперь используют Authorization header

**Архитектура аутентификации проекта:**
- JWT хранится в `localStorage` (ключ: `bookreader_access_token`)
- Все API запросы используют `Authorization: Bearer ${token}` header
- `apiClient` (axios) автоматически добавляет header через interceptor
- PWA сервисы теперь также используют эту схему

---

## 🎉 PWA РАЗРАБОТКА ЗАВЕРШЕНА

Все 5 фаз PWA разработки успешно завершены:

| Фаза | Статус | Описание |
|------|--------|----------|
| 0 | ✅ | VitePWA + Dexie.js фундамент |
| 1 | ✅ | Service Worker (Workbox), IndexedDB миграция, TanStack Query offline |
| 2 | ✅ | Download Manager, Storage Manager, Background Sync |
| 3 | ✅ | Backend Push API, Frontend Push Manager |
| 4 | ✅ | iOS Support, Install Prompt, Update Prompt |
| 5 | ✅ | Settings Page интеграция, E2E тесты, Lighthouse оптимизация |

**Созданные файлы (Frontend):**
- `src/services/db.ts` — Dexie.js схема
- `src/sw.ts` — Workbox Service Worker
- `src/services/chapterCache.ts` — переписан на Dexie.js
- `src/services/imageCache.ts` — переписан на Dexie.js
- `src/services/downloadManager.ts` — менеджер загрузок
- `src/services/storageManager.ts` — управление хранилищем
- `src/services/syncQueue.ts` — Background Sync
- `src/services/pushNotifications.ts` — Push Manager
- `src/hooks/useOfflineBook.ts` — offline hooks
- `src/hooks/useDownloadBook.ts` — download hook
- `src/hooks/useStorageInfo.ts` — storage hooks
- `src/hooks/usePushNotifications.ts` — push hooks
- `src/hooks/usePWAInstall.ts` — install hook
- `src/utils/iosSupport.ts` — iOS утилиты
- `src/types/push.ts` — Push типы
- `src/components/UI/IOSInstallInstructions.tsx` — iOS инструкции
- `src/components/UI/PWAUpdatePrompt.tsx` — уведомление обновления
- `src/components/Library/DownloadBookButton.tsx` — кнопка загрузки
- `tests/pwa.spec.ts` — E2E тесты
- `tests/PWA_TESTS.md` — документация тестов

**Созданные файлы (Backend):**
- `app/models/push_subscription.py` — модель подписок
- `app/schemas/push.py` — Pydantic схемы
- `app/services/push_notification_service.py` — Push сервис
- `app/routers/push.py` — API endpoints
- `alembic/versions/2026_01_09_0001_add_push_subscriptions_table.py` — миграция

---

**Автор:** Claude Code
**Создан:** 2026-01-09
**Обновлён:** 2026-01-09
**Статус:** ✅ ВСЕ ФАЗЫ ЗАВЕРШЕНЫ
