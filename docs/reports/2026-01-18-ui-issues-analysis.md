# Отчёт об анализе UI-проблем

**Дата:** 2026-01-18
**Автор:** AI-ассистент

---

## Обнаруженные проблемы

### 1. Overflow блоков на главной странице (Desktop)

**Симптом:** Блоки "Продолжить чтение", "Недавно добавленные", "Статистика чтения" вылезают за правый край экрана.

**Файл:** `frontend/src/pages/HomePage.tsx`

**Причина:** Горизонтальный скролл-контейнер для "Недавно добавленные" использует `overflow-x-auto`, но родительский контейнер не ограничивает ширину должным образом.

**Проблемные места:**

```tsx
// Строка 505-510
<div
  ref={scrollRef}
  className={cn(
    'flex gap-4 overflow-x-auto pb-4',  // ❌ Может вызывать overflow
    'scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent'
  )}
>
```

**Анализ:**
- Контейнер `max-w-7xl mx-auto px-3 sm:px-6 lg:px-8` (строка 805) в теории ограничивает ширину
- Однако `overflow-x-hidden` на родителе (строка 805) должен предотвращать overflow
- Возможная причина: вложенные flex-контейнеры с `flex-shrink-0` на карточках книг могут превышать ширину родителя

**Решение:**
```tsx
// Добавить overflow-x-hidden на родительский секцию
<div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 overflow-hidden">
```

---

### 2. Overflow уведомлений на мобильных устройствах

**Симптом:** Уведомления "Обработка начата" и "Загрузка завершена" вылезают за правый край на мобилке.

**Файл:** `frontend/src/components/UI/NotificationContainer.tsx`

**Проблемный код:**
```tsx
// Строка 209-217
className={cn(
  'relative overflow-hidden',
  'p-4 rounded-lg border shadow-lg',
  'backdrop-blur-sm',
  'min-w-0 max-w-[calc(100vw-2rem)] sm:min-w-[280px] sm:max-w-[400px]',  // ❌ min-w на мобилке может конфликтовать
  'transition-shadow duration-200',
  'hover:shadow-xl',
  config.containerClasses
)}
```

**Анализ:**
- Мобильный контейнер (строка 308-316) использует `left-4 right-4`, что оставляет по 16px с каждой стороны
- Но Toast имеет `min-w-0` на мобилке, что хорошо
- Проблема может быть в длинных заголовках без `truncate`

**Решение:**
```tsx
// Toast заголовок и сообщение должны иметь text-overflow
<h4 className="text-sm font-semibold leading-tight truncate">
  {notification.title}
</h4>
{notification.message && (
  <p className="mt-1 text-sm opacity-80 leading-relaxed line-clamp-2">
    {notification.message}
  </p>
)}
```

---

### 3. Изображения не грузятся в Галерее

**Симптом:** Многие сгенерированные изображения не отображаются в Галерее (десктоп и мобильная версия).

**Файлы:**
- `frontend/src/pages/ImagesGalleryPage.tsx`
- `frontend/src/api/images.ts`
- `frontend/src/components/UI/LazyImage.tsx`

**Возможные причины:**

#### A. Проблема с image_url

**Файл:** `frontend/src/api/images.ts`, строки 48-73

```typescript
function normalizeImageUrl(url: string | null | undefined): string {
  if (!url) return '';  // ⚠️ Возвращает пустую строку, LazyImage пытается загрузить ""
  // ...
}
```

Если `image_url` в ответе API = `null` или `undefined`, `normalizeImageUrl` возвращает пустую строку `""`, а `LazyImage` пытается загрузить пустой URL, что приводит к ошибке.

#### B. Проблема с LazyImage

**Файл:** `frontend/src/components/UI/LazyImage.tsx`

```tsx
// Строка 94-106
{isVisible && !hasError && (
  <img
    src={src}
    alt={alt}
    // ...
  />
)}
```

Если `src=""` (пустая строка), браузер:
1. Пытается загрузить текущую страницу как изображение
2. Получает ошибку
3. `hasError` становится `true`
4. Показывается placeholder "Ошибка загрузки"

#### C. Проблема с аутентификацией

**Файл:** `frontend/src/api/images.ts`, строка 341-360

```typescript
async downloadImage(imageUrl: string, filename: string): Promise<void> {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const response = await fetch(imageUrl, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    // ...
  }
}
```

Изображения на `/api/v1/images/file/xxx.png` требуют Bearer token, но `<img>` тег не добавляет заголовки авторизации автоматически.

**LazyImage использует:**
```tsx
<img src={src} ... />  // ❌ Нет Authorization header
```

**Решение:**
1. **Backend:** Разрешить доступ к изображениям без авторизации (public endpoint для файлов)
2. **Frontend:** Использовать `AuthenticatedImage` вместо `LazyImage` для защищённых изображений

---

## План исправлений

### Приоритет P0 (Критические)

| # | Проблема | Файл | Исправление | Оценка |
|---|----------|------|-------------|--------|
| 1 | Overflow блоков на главной | `HomePage.tsx` | Добавить `overflow-hidden` на контейнер | 15 мин |
| 2 | Overflow уведомлений | `NotificationContainer.tsx` | Добавить `truncate` и `line-clamp` | 10 мин |
| 3 | Изображения не грузятся | `ImagesGalleryPage.tsx` | Использовать `AuthenticatedImage` | 30 мин |

### Приоритет P1 (Важные)

| # | Проблема | Файл | Исправление | Оценка |
|---|----------|------|-------------|--------|
| 4 | Пустой image_url | `LazyImage.tsx` | Проверять на пустой src | 10 мин |
| 5 | API отдаёт null | Backend | Убедиться что image_url всегда заполнен | 30 мин |

---

## Детальные исправления

### Исправление 1: Overflow на главной странице

**Файл:** `frontend/src/pages/HomePage.tsx`

```diff
// Строка 505-512
<div className="hidden sm:block relative">
-   <div
-     ref={scrollRef}
-     className={cn(
-       'flex gap-4 overflow-x-auto pb-4',
+   <div
+     ref={scrollRef}
+     className={cn(
+       'flex gap-4 overflow-x-auto pb-4',
+       // Ограничить максимальную ширину скролла
        'scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent'
      )}
    >
```

**Или добавить на родительский контейнер:**
```diff
// Строка 503-504
-<div className="hidden sm:block relative">
+<div className="hidden sm:block relative overflow-hidden">
```

---

### Исправление 2: Overflow уведомлений

**Файл:** `frontend/src/components/UI/NotificationContainer.tsx`

```diff
// Строка 228-237
<div className="flex-1 min-w-0">
-   <h4 className="text-sm font-semibold leading-tight">
+   <h4 className="text-sm font-semibold leading-tight truncate">
      {notification.title}
    </h4>
    {notification.message && (
-     <p className="mt-1 text-sm opacity-80 leading-relaxed">
+     <p className="mt-1 text-sm opacity-80 leading-relaxed line-clamp-2 break-words">
        {notification.message}
      </p>
    )}
</div>
```

---

### Исправление 3: Изображения в галерее

**Файл:** `frontend/src/pages/ImagesGalleryPage.tsx`

```diff
// Строка 34
import { LazyImage } from '@/components/UI/LazyImage';
+import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';

// Строка 416-422 (в галерее)
-<LazyImage
+<AuthenticatedImage
   src={image.image_url}
   alt={image.description?.text || 'Generated image'}
   className="w-full h-full"
-   imageClassName="transition-transform group-hover:scale-110"
-   rootMargin="100px"
+   fallback={<div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="w-8 h-8 text-muted-foreground" /></div>}
 />
```

---

### Исправление 4: Проверка пустого src в LazyImage

**Файл:** `frontend/src/components/UI/LazyImage.tsx`

```diff
// После строки 64
const [isLoaded, setIsLoaded] = useState(false);
const [hasError, setHasError] = useState(false);

+// Проверка на пустой или невалидный src
+const isValidSrc = src && src.trim().length > 0 && src !== '/';

// Строка 94-106
-{isVisible && !hasError && (
+{isVisible && !hasError && isValidSrc && (
   <img
     src={src}
     alt={alt}
     ...
   />
)}

+{/* Показать ошибку если src пустой */}
+{!isValidSrc && (
+  <div
+    className="absolute inset-0 flex flex-col items-center justify-center bg-muted"
+    role="alert"
+  >
+    <ImageOff className="w-8 h-8 text-muted-foreground mb-2" />
+    <span className="text-muted-foreground text-sm text-center px-2">
+      Нет изображения
+    </span>
+  </div>
+)}
```

---

## Быстрая проверка на сервере

```bash
# Проверить, что изображения доступны без авторизации
curl -I https://fancai.ru/api/v1/images/file/test.png

# Если 401 Unauthorized - нужно настроить backend
# Если 200 OK - проблема во frontend
```

---

## Рекомендации по тестированию

1. **Desktop:** Проверить главную страницу при разных ширинах браузера (1200px, 1000px, 800px)
2. **Mobile:** Проверить уведомления после загрузки книги на iOS Safari
3. **Gallery:** Проверить загрузку изображений в Network tab DevTools

---

## Ссылки на файлы

- [HomePage.tsx](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/frontend/src/pages/HomePage.tsx)
- [NotificationContainer.tsx](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/frontend/src/components/UI/NotificationContainer.tsx)
- [ImagesGalleryPage.tsx](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/frontend/src/pages/ImagesGalleryPage.tsx)
- [LazyImage.tsx](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/frontend/src/components/UI/LazyImage.tsx)
- [images.ts](file:///Users/sandk/Documents/GitHub/fancai-vibe-hackathon/frontend/src/api/images.ts)
