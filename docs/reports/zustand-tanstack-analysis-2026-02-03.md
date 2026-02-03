# Анализ архитектуры state management: Zustand + TanStack Query

**Дата:** 3 февраля 2026  
**Контекст:** Перед выполнением Фазы 2 плана `frontend-improvement-plan-v2-2026-02-03.md` проведён глубокий анализ причин сосуществования Zustand и TanStack Query, текущего реального использования, и необходимости миграции.

---

## 1. Хронология появления

### Август 2025 — Начальная реализация
**Коммит:** `4497c38` — "feat: implement complete React frontend application"

Оба пакета были добавлены **одновременно** в первоначальном фронтенде:
- `@tanstack/react-query: ^5.8.4`
- `zustand: ^4.4.7`

**Изначальный замысел (из сообщения коммита):**
- "React Query for API data fetching and caching"
- "Zustand for state management with persistence"

Это НЕ была эволюция — обе библиотеки были выбраны сразу с разными ролями.

### Декабрь 2025 — Крупный рефакторинг
**Коммит:** `088d294` — "refactor(frontend): major optimization and architecture improvements"

- Создано **26 TanStack Query хуков** в `src/hooks/api/`
- Добавлена подробная документация (`hooks/api/README.md`)
- Разделены god-компоненты (LibraryPage 739→198 строк)

### 23 декабря 2025 — Миграция LibraryPage (ключевой момент)
**Коммит:** `a1d5451` — "refactor(frontend): migrate LibraryPage to TanStack Query for proper cache management"

**Сообщение коммита раскрывает настоящую причину:**
> "Problem: Newly uploaded books weren't appearing in the library without using incognito mode. The browser was caching API responses."
>
> "Solution: Migrate LibraryPage from Zustand store to TanStack Query:
> - Use useBooks hook instead of useBooksStore for data fetching
> - Automatic cache invalidation via queryClient.invalidateQueries"

**Вывод:** Это был **баг-фикс**, а не запланированная миграция. Zustand использовался некорректно для серверного состояния, что вызывало проблемы с инвалидацией кэша.

---

## 2. Текущая архитектура (5 stores)

### Классификация store по типу состояния

| Store | LOC | Тип | API вызовы | Потребителей (prod) | Вердикт |
|-------|-----|-----|-----------|---------------------|---------|
| `auth.ts` | 200 | Гибрид (сессия + UI) | ✅ login/logout/register | 83 | ✅ **ОСТАВИТЬ** — auth требует синхронного доступа |
| `reader.ts` | 312 | Чисто UI + клиентский | ✅ background sync | 19 | ✅ **ОСТАВИТЬ** — настройки, закладки, прогресс |
| `ui.ts` | 188 | Чисто UI | ❌ нет | 123 | ✅ **ОСТАВИТЬ** — модалки, нотификации |
| `books.ts` | 265 | 100% серверный | ✅ 6 API вызовов | **0 (только тесты!)** | 🔥 **УДАЛИТЬ** |
| `images.ts` | 185 | 100% серверный | ✅ 5 API вызовов | **0** | 🔥 **УДАЛИТЬ** |

### Доказательства неиспользования

**`useBooksStore`** — grep по всему `src/`:
- Продакшен-код: **0 импортов**
- Тесты: `LibraryPage.test.tsx` — 41 мок
- Re-export в `stores/index.ts` — 1

**`useImagesStore`** — grep по всему `src/`:
- Продакшен-код: **0 импортов**
- Re-export в `stores/index.ts` — 1

### Продакшен-код уже использует TanStack Query

```typescript
// LibraryPage.tsx (строка 104) — использует TanStack Query
const { data, isLoading, refetch } = useBooks({ skip, limit: BOOKS_PER_PAGE, sort_by: sortBy });

// HomePage.tsx (строки 29-39) — использует TanStack Query напрямую
const { data: booksData } = useQuery({
  queryKey: bookKeys.homepage(user?.id ?? '', 20),
  queryFn: () => booksAPI.getBooks({ limit: 20, sort_by: 'accessed_desc' }),
});

// BookImagesPage.tsx (строка 31) — использует TanStack Query
const { data: book } = useQuery({
  queryKey: ['book', bookId],
  queryFn: () => booksAPI.getBook(bookId!),
});
```

---

## 3. Полное дублирование API вызовов

### books.ts Store vs useBooks.ts Hook

| Функция Store | Вызывает | TanStack Query аналог | Тот же endpoint |
|---------------|----------|----------------------|-----------------|
| `fetchBooks()` | `booksAPI.getBooks()` | `useBooks()` | ✅ |
| `fetchBook()` | `booksAPI.getBook()` | `useBook()` | ✅ |
| `fetchChapter()` | `booksAPI.getChapter()` | `useChapter()` | ✅ |
| `uploadBook()` | `booksAPI.uploadBook()` | `useUploadBook()` | ✅ |
| `deleteBook()` | `booksAPI.deleteBook()` | `useDeleteBook()` | ✅ |
| `updateReadingProgress()` | `booksAPI.updateReadingProgress()` | `useUpdateReadingProgress()` | ✅ |

**6 из 6 функций — 100% дублирование.**

### images.ts Store vs useImages Hooks

| Функция Store | TanStack Query аналог |
|---------------|----------------------|
| `fetchGenerationStatus()` | `useGenerationStatus()` |
| `generateImageForDescription()` | `useGenerateImage()` |
| `generateImagesForChapter()` | `useBatchGenerateImages()` |
| `fetchBookImages()` | `useBookImages()` |
| `deleteImage()` | `useDeleteImage()` |

**5 из 5 функций — 100% дублирование.**

---

## 4. Что говорят авторитетные источники

### TanStack Query Official Docs
> "React Query is a server-state library. Redux, MobX, Zustand, etc. are client-state libraries that CAN be used to store asynchronous data, albeit **inefficiently** when compared to React Query."

### TkDodo (мейнтейнер TanStack Query)
> "Keep server and client state separate. If you get data from useQuery, **try not to put that data into local state**."
> "Don't use the queryCache as a local state manager."

### Вердикт индустрии
Zustand + TanStack Query — это **рекомендуемый паттерн**, но с чётким разделением:
- **TanStack Query** = серверное состояние (данные с API)
- **Zustand** = клиентское состояние (UI, настройки, сессия)

Хранить серверные данные в Zustand при наличии TanStack Query — **анти-паттерн**.

---

## 5. Выводы и рекомендации

### Нужна ли "миграция" books.ts/images.ts?

**НЕТ.** Миграция уже произошла в декабре 2025. Продакшен-код уже использует TanStack Query. `books.ts` и `images.ts` — **мёртвый код**, который просто не был удалён.

### Что действительно нужно сделать

| Действие | Сложность | Влияние |
|----------|-----------|---------|
| Удалить `stores/books.ts` (265 строк) | Тривиально | Удаление мёртвого кода |
| Удалить `stores/images.ts` (185 строк) | Тривиально | Удаление мёртвого кода |
| Обновить `stores/index.ts` (убрать re-exports) | Тривиально | Чистота |
| Обновить `LibraryPage.test.tsx` (тесты мокают useBooksStore) | Средне | Тесты должны мокать useBooks() из TanStack Query |
| Удалить `types/state.ts` BooksState/ImagesState если не используются | Тривиально | Чистота типов |

### Что НЕ нужно делать

- ❌ Не мигрировать `auth.ts` — auth требует синхронного доступа, persist, tab sync
- ❌ Не мигрировать `reader.ts` — это чисто клиентское состояние (настройки, закладки)
- ❌ Не мигрировать `ui.ts` — модалки и нотификации не имеют отношения к серверу

### Влияние на оценку Фазы 2

Задачи 2.1 и 2.2 из плана были оценены в **7 часов** (4ч + 3ч), предполагая полноценную миграцию с переписыванием потребителей. По факту это **2 часа максимум**:
- Удалить 2 файла store
- Обновить index.ts
- Переписать 1 тестовый файл

---

## 6. Правильная архитектура (текущая)

```
┌─────────────────────────────────────────────────────────┐
│                   React Components                       │
│                                                          │
│   Server Data:         Client State:                     │
│   useBooks()           useAuthStore()    → сессия        │
│   useBook()            useReaderStore()  → настройки     │
│   useChapter()         useUIStore()      → UI            │
│   useBookImages()                                        │
│   useGenerateImage()                                     │
│         │                     │                          │
│    TanStack Query          Zustand                       │
│    (кэш, refetch,      (persist, tabSync,               │
│     invalidation,       localStorage)                    │
│     optimistic)                                          │
│         │                     │                          │
│    ┌────┴────┐          ┌────┴────┐                      │
│    │ Memory  │          │ LocalSt │                      │
│    │ Cache   │          │ orage   │                      │
│    └────┬────┘          └─────────┘                      │
│         │                                                │
│    ┌────┴────┐                                           │
│    │IndexedDB│ (offline-first: chapters, images)         │
│    └─────────┘                                           │
│         │                                                │
│    ┌────┴────┐                                           │
│    │ REST API│                                           │
│    └─────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

**Эта архитектура уже реализована.** Нужно лишь убрать мёртвый код.
