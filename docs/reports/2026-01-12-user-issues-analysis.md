# Анализ проблем пользователя

**Дата:** 12 января 2026
**Обновлено:** 12 января 2026
**Статус:** ✅ 12 из 12 проблем исправлено (P0 + P1 + P2 + P3 завершены)

---

## Содержание

Детальный анализ каждой из 12 проблем, выявленных пользователем.

---

## Проблема 1: Главы на странице с информацией о книге (legacy)

### Описание
> Исправить главы на странице с информацией о книге (это legacy-функциональность, нужно актуализировать)

### Анализ

**Текущее состояние:**
- Файл: `frontend/src/pages/BookPage.tsx` (313 строк)
- Главы отображаются корректно с информацией:
  - Номер главы
  - Название
  - Количество слов
  - Время чтения
  - Количество описаний AI

**Выявленные проблемы:**

1. **ChapterPage.tsx (10 строк) - deprecated**
   - Файл существует, но не используется в современной архитектуре
   - Просто обёртка для BookReader
   - **Действие:** Удалить файл

2. **Dual progress tracking**
   - Старая система: `current_chapter`, `current_page`, `current_position`
   - Новая система: `reading_location_cfi`, `scroll_offset_percent`
   - Обе системы работают параллельно для обратной совместимости
   - **Действие:** Мигрировать на только CFI, удалить legacy поля

3. **useChapterMapping.ts (189 строк) - сложность**
   - Сложное сопоставление EPUB spine с backend chapter numbers
   - 3-уровневая стратегия matching
   - **Действие:** Упростить backend парсер

4. **Кэш глав не инвалидируется при новых описаниях**
   - Cache TTL = 1 час
   - При добавлении описаний кэш не обновляется
   - **Действие:** Добавить инвалидацию кэша

### Решение

```typescript
// 1. Удалить deprecated файлы:
//    - frontend/src/pages/ChapterPage.tsx
//    - Связанные .bak файлы

// 2. В BookPage.tsx добавить актуальную информацию:
{book.chapters.map((chapter) => (
  <ChapterCard
    key={chapter.id}
    chapter={chapter}
    // Добавить количество сгенерированных изображений
    imagesCount={chapter.images_count}  // Новое поле
    onClick={() => navigate(`/reader/${book.id}?chapter=${chapter.number}`)}
  />
))}
```

### Приоритет: 🟡 MEDIUM
### Статус: ✅ ИСПРАВЛЕНО

**Выполненные задачи (P3.1 + P3.2):**
- [x] Удалён deprecated файл ChapterPage.tsx
- [x] Удалён маршрут из App.tsx
- [x] Удалены 104 .bak файла
- [x] Упрощён useChapterMapping.ts (-6% строк)
- [x] Добавлена поддержка русских числительных 11-20

**Удалённые файлы:**
```
frontend/src/pages/ChapterPage.tsx
frontend/src/**/*.bak (104 файла)
```

**Изменённые файлы:**
```
frontend/src/App.tsx
frontend/src/hooks/epub/useChapterMapping.ts
```

---

## Проблема 2: Кеширование обложек

### Описание
> Проверить кеширование обложек во всём проекте (сейчас в браузере и в PWA они всегда подгружаются)

### Анализ

**Корневая причина найдена!**

**Проблема 1: AuthenticatedImage не использует HTTP кеш**
```typescript
// frontend/src/components/UI/AuthenticatedImage.tsx:56-60
const response = await fetch(src, {
  headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  // ❌ НЕТ cache: 'default' - браузер не кеширует!
});
```

**Проблема 2: Backend не отправляет Cache-Control для /cover**
```python
# backend/app/middleware/cache_control.py:27-36
USER_SPECIFIC_PATHS = [
    "/api/v1/books",
    "/api/v1/chapters",
    # ❌ /api/v1/books/{id}/cover НЕ УКАЗАН!
]
# Результат: header "no-cache, must-revalidate"
```

**Проблема 3: Service Worker не перехватывает blob fetch**
```typescript
// frontend/src/sw.ts:127-144
registerRoute(
  ({ request }) => request.destination === 'image',  // ❌
  // fetch() для blob имеет destination === 'empty', не 'image'!
  new StaleWhileRevalidate({...})
)
```

### Решение

```typescript
// 1. AuthenticatedImage.tsx - добавить cache directive
const response = await fetch(src, {
  headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  cache: 'default',  // ✅ Разрешить HTTP кеширование
});

// 2. cache_control.py - добавить /cover endpoint
COVER_IMAGE_PATHS = ["/api/v1/books/"]

def get_cache_control_header(path: str, method: str = "GET") -> str:
    if '/cover' in path:
        return "private, max-age=2592000"  # 30 дней

// 3. sw.ts - добавить route для cover
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/cover'),
  new StaleWhileRevalidate({
    cacheName: 'book-covers',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })
    ],
  })
)
```

### Приоритет: 🔴 CRITICAL

---

## Проблема 3: Блокировка и прогресс-спиннер загрузки книги на Главной

### Описание
> Добавить блокировку и прогресс-спиннер загрузки/обработки книги на Главной странице (как на странице Библиотека)

### Анализ

**Текущее состояние:**
- LibraryPage имеет polling для отслеживания обработки книг
- HomePage не имеет такой логики

**LibraryPage реализация (правильная):**
```typescript
// frontend/src/pages/LibraryPage.tsx:124-134
const { data, isLoading, error, refetch } = useBooks(
  { skip, limit: BOOKS_PER_PAGE, sort_by: sortBy },
  {
    refetchInterval: (query) => {
      const books = query.state.data?.books || [];
      const hasProcessing = books.some((b) => b.is_processing);
      return hasProcessing ? 5000 : false;  // ✅ Polling только если обработка
    },
  }
);
```

**HomePage НЕ ИМЕЕТ:**
- `is_processing` индикатор на карточках
- Polling для обновления статуса
- Блокировка UI при загрузке

### Решение

```typescript
// frontend/src/pages/HomePage.tsx

// 1. Добавить polling для книг в обработке
const { data: booksData, isLoading: booksLoading } = useQuery({
  queryKey: ['books', 'homepage'],
  queryFn: () => booksAPI.getBooks({ limit: 20, sort_by: 'accessed_desc' }),
  staleTime: 60000,  // 1 минута (было 0!)
  refetchInterval: (query) => {
    const books = query.state.data?.books || [];
    return books.some((b) => b.is_processing) ? 5000 : false;
  },
});

// 2. В RecentBooksSection добавить индикатор обработки
{book.is_processing && (
  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
    <span className="ml-2 text-sm">Обработка...</span>
  </div>
)}
```

### Приоритет: 🟠 HIGH

---

## Проблема 4: Фильтры в мобильной версии на странице Библиотека

### Описание
> Исправить фильтры в мобильной версии на странице Библиотека (вёрстка десктопная и поведение некорректное)

### Анализ

**Выявленные проблемы:**

1. **Filter panel не блокирует скролл фона**
```typescript
// LibraryPage.tsx:481-551
// При открытии filter panel фон продолжает скроллиться
// Нет overflow-hidden на body
```

2. **Progress filter buttons переполняют экран**
```typescript
// LibraryPage.tsx:517
<div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
  {/* 4 кнопки - не помещаются на iPhone SE */}
</div>
```

3. **Dropdown сортировки min-width слишком большой**
```typescript
// LibraryPage.tsx:426
className="...min-w-[160px]..."  // На 320px экране это 50%!
```

### Решение

```typescript
// 1. Блокировка скролла при открытии фильтров
useEffect(() => {
  if (showFilters) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
  return () => { document.body.style.overflow = ''; };
}, [showFilters]);

// 2. Адаптивные progress buttons
<div className="grid grid-cols-2 sm:flex gap-2">
  {PROGRESS_OPTIONS.map((option) => (
    <button className="min-h-[44px] text-sm sm:text-base" />
  ))}
</div>

// 3. Адаптивная ширина dropdown
className="w-full sm:min-w-[160px]"
```

### Приоритет: 🔴 CRITICAL

---

## Проблема 5: Ширина выпадающего списка на карточке книги

### Описание
> Увеличить ширину выпадающего списка в мобильной версии при клике на "..." (сжимается "Скачать офлайн")

### Анализ

**Текущее состояние:**
- BookCard имеет контекстное меню с "..."
- На мобильных текст "Скачать офлайн" обрезается

**Файл:** `frontend/src/components/Library/BookCard.tsx`

### Решение

```typescript
// BookCard.tsx - увеличить min-width dropdown
<DropdownMenu>
  <DropdownMenuContent
    align="end"
    className="w-48 sm:w-56"  // Увеличить ширину
    // или использовать min-w-max для авто-ширины
  >
    <DropdownMenuItem>
      <Download className="w-4 h-4 mr-2" />
      <span className="whitespace-nowrap">Скачать офлайн</span>
    </DropdownMenuItem>
    {/* ... */}
  </DropdownMenuContent>
</DropdownMenu>
```

### Приоритет: 🟠 HIGH

---

## Проблема 6: Список сортировки в мобильной версии

### Описание
> Исправить вывод списка сортировки в мобильной версии (выводится снизу справа от кнопки)

### Анализ

**Текущее состояние:**
```typescript
// LibraryPage.tsx:426
<m.div className="absolute top-full mt-2 w-48 right-0 max-w-[calc(100vw-2rem)]">
```

**Проблема:**
- `right-0` + `top-full` = dropdown появляется справа внизу от кнопки
- На мобильных это неудобно и может выходить за край экрана

### Решение

```typescript
// Вариант 1: Full-width dropdown на мобильных
<m.div className="
  absolute top-full mt-2
  left-0 right-0 sm:left-auto sm:right-0  // Full width на мобильных
  w-full sm:w-48
  max-w-[calc(100vw-2rem)]
">

// Вариант 2: Bottom sheet на мобильных
{isMobile ? (
  <BottomSheet open={showSort} onClose={() => setShowSort(false)}>
    <SortOptions />
  </BottomSheet>
) : (
  <Dropdown>{/* ... */}</Dropdown>
)}
```

### Приоритет: 🟠 HIGH

---

## Проблема 7: Настройки чтения удалены из Settings

### Описание
> Ты убрал настройки из раздела "Чтение" в Настройках, но не переместил их в настройки внутри читалки книги

### Анализ

**Что было удалено из SettingsPage:**
- Вкладка "Чтение" (reader tab)
- Компонент ReaderSettings с настройками шрифта, темы, отступов

**Что есть в читалке сейчас:**
- ReaderControls (quick settings dropdown):
  - Тема (Light/Dark/Sepia)
  - Размер шрифта (A-/A+)
  - Режим навигации (Swipe/Tap)
  - Wake Lock toggle

- ReaderSettingsPanel (полные настройки):
  - 5 тем
  - Размер шрифта (stepper)
  - Семейство шрифта (3 варианта)
  - Межстрочный интервал
  - Ширина текста (presets)
  - Отступы

**Что ПОТЕРЯНО:**
1. ❌ Live Preview текста в настройках
2. ❌ Возможность настроить читалку ДО открытия книги
3. ❌ 6 вариантов шрифтов (было) vs 3 (сейчас)

### Решение

```typescript
// Вариант 1: Добавить preview в ReaderSettingsPanel
// frontend/src/components/Reader/ReaderSettingsPanel.tsx

<div className="mt-4 p-4 rounded-lg border bg-background">
  <p
    className="text-foreground"
    style={{
      fontSize: `${fontSize}px`,
      fontFamily: fontFamily,
      lineHeight: lineHeight,
    }}
  >
    Пример текста для предпросмотра настроек...
  </p>
</div>

// Вариант 2: Вернуть раздел "Чтение" в SettingsPage
// со ссылкой на ReaderSettingsPanel или дублированием
```

### Приоритет: 🟠 HIGH

---

## Проблема 8: Модальное окно с изображением на странице Изображения

### Описание
> Исправить модальное окно с изображением на странице Изображения в мобильной версии (слишком большое, не влезает в экран)

### Анализ

**Текущее состояние:**
```typescript
// ImagesGalleryPage.tsx:342-380
<div className="relative max-w-4xl w-full rounded-xl overflow-hidden bg-background">
  <img className="w-full max-h-[70vh] object-contain" />
  <div className="p-6">
    <h3 className="text-2xl font-bold mb-3">  // ❌ Слишком большой на мобильных
```

**Проблемы:**
1. `max-w-4xl` (896px) на 375px экране = overflow
2. `p-6` (24px) слишком много паддинга
3. `text-2xl` (24px) слишком крупный заголовок
4. Нет `max-h` для всего контейнера

### Решение

```typescript
// ImagesGalleryPage.tsx - адаптивное модальное окно
<div className="
  relative
  w-full max-w-4xl
  max-h-[90vh]  // Ограничить высоту
  rounded-xl overflow-hidden bg-background
  flex flex-col
">
  {/* Изображение */}
  <img
    className="w-full max-h-[60vh] sm:max-h-[70vh] object-contain flex-shrink-0"
  />

  {/* Контент */}
  <div className="p-4 sm:p-6 overflow-y-auto">
    <h3 className="text-lg sm:text-2xl font-bold mb-2 sm:mb-3">
      {selectedImage.book_title}
    </h3>
    <p className="text-sm sm:text-base text-muted-foreground line-clamp-3">
      {selectedImage.description?.text}
    </p>
  </div>
</div>
```

### Приоритет: 🔴 CRITICAL

---

## Проблема 9: Счётчики на странице Изображения в мобильной версии

### Описание
> На странице Изображения в мобильной версии информативные блоки со счётчиками нужно выводить в две колонки

### Анализ

**Текущее состояние:**
```typescript
// ImagesGalleryPage.tsx:142
<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
  {/* 4 карточки счётчиков - 1 колонка на мобильных! */}
</div>
```

**Проблема:**
- На мобильных 4 карточки выводятся в 1 колонку
- Занимают много вертикального места
- Нужно скроллить до изображений

### Решение

```typescript
// ImagesGalleryPage.tsx - 2 колонки на мобильных
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
  <StatCard
    title="Всего"
    value={allImages.length}
    icon={<ImageIcon />}
    className="p-3 sm:p-4"  // Меньше паддинг на мобильных
  />
  {/* ... */}
</div>
```

### Приоритет: 🟠 HIGH

---

## Проблема 10: Scroll-to-top при переходе на страницу

### Описание
> При переходе на любую страницу в мобильной версии нас должно возвращать к началу страницы, к шапке

### Анализ

**Текущее состояние:**
- LibraryPage сохраняет scroll position (для возврата)
- Но нет глобального scroll-to-top при навигации
- Пользователь может оказаться посередине новой страницы

### Решение

```typescript
// Вариант 1: В Layout.tsx или App.tsx
import { useLocation } from 'react-router-dom';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

// В App.tsx
<Router>
  <ScrollToTop />
  <Routes>...</Routes>
</Router>

// Вариант 2: В каждой странице (если нужно исключения)
useEffect(() => {
  // Не скроллить если вернулись назад
  if (!location.state?.preserveScroll) {
    window.scrollTo(0, 0);
  }
}, []);
```

### Приоритет: 🔴 CRITICAL

---

## Проблема 11: Фон внизу экрана в читалке

### Описание
> Нужно залить фон внизу экрана на корректный (как фон самой читалки)

### Анализ

**Текущее состояние:**
```typescript
// BookReaderPage.tsx:142-148
<div
  className="fixed inset-0 overflow-hidden bg-background"
  style={{
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',  // Создаёт gap
  }}
>
```

**Проблема:**
- `env(safe-area-inset-bottom)` создаёт паддинг внизу
- Но фон под этим паддингом может быть другого цвета
- На iOS с Home Indicator видна полоса другого цвета

### Решение

```typescript
// 1. Добавить meta tag в index.html
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1a1a1a" media="(prefers-color-scheme: dark)">

// 2. В EpubReader применить тему к body
useEffect(() => {
  const themeColors = {
    light: '#ffffff',
    dark: '#1a1a1a',
    sepia: '#f5e6d3',
  };
  document.body.style.backgroundColor = themeColors[theme];

  // Обновить meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', themeColors[theme]);
  }
}, [theme]);

// 3. CSS для safe-area
.reader-container {
  background: var(--reader-bg);
  min-height: 100vh;
  min-height: 100dvh;  /* Dynamic viewport height */
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}
```

### Приоритет: 🟡 MEDIUM
### Статус: ✅ ИСПРАВЛЕНО

**Выполненные задачи (P2.1):**
- [x] Добавлен динамический theme-color meta tag в index.html
- [x] EpubReader синхронизирует фон body с темой читалки
- [x] Добавлены CSS классы .reader-container и .reader-fullscreen в globals.css
- [x] BookReaderPage использует 100dvh для корректной высоты
- [x] Safe-area insets правильно применяются

**Изменённые файлы:**
```
frontend/index.html
frontend/src/components/Reader/EpubReader.tsx
frontend/src/styles/globals.css
frontend/src/pages/BookReaderPage.tsx
```

---

## Проблема 12: Изображения не прогружаются через некоторое время

### Описание
> Почему-то на странице Изображения изображения не прогружаются через некоторое время (в любом режиме)

### Анализ

**Корневые причины найдены!**

1. **Токен истекает, но fetch не обновляет его**
```typescript
// ImageGallery.tsx:85-88
const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
const response = await fetch(image.image_url, {
  headers: token ? { 'Authorization': `Bearer ${token}` } : {},
});
// ❌ Если токен истёк = 401, но нет retry!
```

2. **apiClient.interceptors работает только для axios, не для fetch**
```typescript
// api/client.ts:72-93
this.client.interceptors.response.use(/* ... */);
// ✅ Работает для axios
// ❌ НЕ работает для native fetch!
```

3. **Object URLs могут становиться невалидными**
```typescript
// imageCache.ts:96-134
// Object URL создаётся и используется без проверки валидности
const existing = this.objectURLs.get(descriptionId);
if (existing) return existing.url;  // Может быть уже revoked!
```

4. **Все изображения загружаются параллельно**
```typescript
// ImagesGalleryPage.tsx:57-81
const imagePromises = booksData.books.map(async (book) => {
  return await imagesAPI.getBookImages(book.id, undefined, 0, 100);
});
await Promise.all(imagePromises);  // ❌ 50 книг = 50 запросов
// Браузер может отменить часть запросов (6-8 connections limit)
```

### Решение

```typescript
// 1. Использовать apiClient вместо fetch
// ImageGallery.tsx
const handleDownload = async (image: GeneratedImage) => {
  try {
    const blob = await apiClient.getBlob(image.image_url);
    // apiClient автоматически обновит токен при 401
  } catch (error) {
    notify.error('Ошибка загрузки');
  }
};

// 2. Добавить retry logic для fetch (если нельзя использовать apiClient)
async function fetchWithTokenRefresh(url: string): Promise<Response> {
  let response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${getToken()}` },
  });

  if (response.status === 401) {
    await refreshToken();
    response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });
  }

  return response;
}

// 3. Добавить pagination и lazy loading
// ImagesGalleryPage.tsx
const [page, setPage] = useState(0);
const IMAGES_PER_PAGE = 20;

const { data } = useInfiniteQuery({
  queryKey: ['all-images'],
  queryFn: ({ pageParam = 0 }) => loadImages(pageParam, IMAGES_PER_PAGE),
  getNextPageParam: (lastPage, pages) =>
    lastPage.length === IMAGES_PER_PAGE ? pages.length : undefined,
});

// 4. Проверять валидность Object URL
async get(userId: string, descriptionId: string): Promise<string | null> {
  const existing = this.objectURLs.get(descriptionId);
  if (existing) {
    // Проверить что URL ещё валиден
    try {
      const response = await fetch(existing.url, { method: 'HEAD' });
      if (response.ok) return existing.url;
    } catch {
      this.objectURLs.delete(descriptionId);
    }
  }
  // ... создать новый URL
}
```

### Приоритет: 🔴 CRITICAL

---

## Сводная таблица (обновлено 12.01.2026)

| # | Проблема | Приоритет | Статус | Файлы |
|---|----------|-----------|--------|-------|
| 1 | Главы (legacy) | 🟡 MEDIUM | ✅ ИСПРАВЛЕНО | ChapterPage удалён, useChapterMapping упрощён |
| 2 | Кеширование обложек | 🔴 CRITICAL | ✅ ИСПРАВЛЕНО | cache_control.py, sw.ts |
| 3 | Спиннер на Главной | 🟠 HIGH | ✅ ИСПРАВЛЕНО | HomePage.tsx |
| 4 | Фильтры мобильные | 🔴 CRITICAL | ✅ ИСПРАВЛЕНО | LibraryPage.tsx |
| 5 | Ширина dropdown | 🟠 HIGH | ✅ ИСПРАВЛЕНО | BookCard.tsx |
| 6 | Сортировка мобильная | 🟠 HIGH | ✅ ИСПРАВЛЕНО | LibraryPage.tsx |
| 7 | Настройки чтения | 🟠 HIGH | ✅ ИСПРАВЛЕНО | SettingsPage.tsx |
| 8 | Модальное окно | 🔴 CRITICAL | ✅ ИСПРАВЛЕНО | ImagesGalleryPage.tsx |
| 9 | Счётчики 2 колонки | 🟠 HIGH | ✅ ИСПРАВЛЕНО | ImagesGalleryPage.tsx |
| 10 | Scroll-to-top | 🔴 CRITICAL | ✅ ИСПРАВЛЕНО | ScrollToTop.tsx, App.tsx |
| 11 | Фон читалки | 🟡 MEDIUM | ✅ ИСПРАВЛЕНО | EpubReader.tsx, globals.css |
| 12 | Изображения не грузятся | 🔴 CRITICAL | ✅ ИСПРАВЛЕНО | fetchWithTokenRefresh.ts |

**🎉 Итого: 12 из 12 исправлено (P0 + P1 + P2 + P3 завершены)**

---

*Следующий шаг: см. [План доработок](./2026-01-12-improvements-plan.md)*
