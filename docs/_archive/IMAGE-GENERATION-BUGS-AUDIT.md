# Аудит багов генерации и отображения изображений

**Дата:** 2026-03-16
**Область:** Frontend — система генерации изображений по описаниям в читалке

---

## Описание проблем

### Баг 1: Изображение пропадает при выходе и повторном входе в читалку

После генерации изображения по выделенному описанию, оно отображается в модалке (DescriptionDrawer) в пределах текущей сессии чтения. Если выйти из читалки и вернуться — изображение исчезает, несмотря на то что оно сохранено в БД и на диске.

### Баг 2: Чужое изображение в модалке другого описания

После генерации изображения для описания A, при открытии модалки описания B отображается изображение от описания A, хотя генерация для B не запускалась.

---

## Архитектура системы изображений

### Цепочка компонентов

```
EpubReader.tsx
  ├── useChapterManagement() → useChapterData()
  │     └── images: GeneratedImage[]  ← массив изображений главы (useState)
  │
  ├── handleDescriptionClick(id)
  │     ├── setDrawerDescription(description)
  │     └── setDrawerImage(images.find(x => x.description_id === id))
  │
  ├── useDescriptionHighlighting({ images, onDescriptionClick })
  │     └── строит imagesByDescId Map → передаёт image в callback
  │
  ├── DescriptionDrawer
  │     ├── props: { description, image, bookId }
  │     ├── useGenerateImage() — мутация генерации
  │     └── generateMutation.data → отображение превью
  │
  └── useImageModal() → ReaderModals → ImageModal
        └── независимое управление состоянием модала
```

### Три независимых источника данных

| Источник                | Где живёт                             | Обновляется после генерации?        |
| ----------------------- | ------------------------------------- | ----------------------------------- |
| `images[]` массив       | `useChapterData` → `EpubReader` state | **НЕТ**                             |
| `generateMutation.data` | `DescriptionDrawer` (volatile)        | Да, но теряется при размонтировании |
| `selectedImage`         | `useImageModal` state                 | Да, но независим от остальных       |

---

## Детальный анализ по файлам

### 1. DescriptionDrawer.tsx

**Роль:** Нижний drawer с содержимым описания и кнопкой генерации.

**Логика отображения изображения (строки 56-91, 126-137):**

```tsx
// Кнопка "Посмотреть" — показывается только если image prop имеет status='completed'
if (image?.status === "completed") {
  /* кнопка "View image" */
}

// Превью после генерации — из volatile mutation data
{
  generateMutation.data && <img src={generateMutation.data.image_url} />;
}
```

**Проблемы:**

- Компонент не использует `useImageForDescription` query — полагается только на prop `image` и `generateMutation.data`
- `generateMutation.reset()` **нигде не вызывается** — данные мутации персистируют между сменами описаний (причина Бага 2)
- После генерации `image` prop не обновляется, т.к. массив `images` в EpubReader не рефрешится

### 2. EpubReader.tsx

**Управление состоянием изображений (строки 79, 255-264):**

```tsx
const [drawerImage, setDrawerImage] = useState<GeneratedImage | undefined>(
  undefined,
);

const handleDescriptionClick = useCallback(
  (id: string) => {
    const d = descriptions.find((x) => x.id === id);
    if (d) {
      setDrawerDescription(d);
      setDrawerImage(images.find((x) => x.description_id === id)); // ← ищет в stale массиве
      setIsDrawerOpen(true);
    }
  },
  [descriptions, images],
);
```

**Проблема:** `images` массив приходит из `useChapterData` и **никогда не обновляется** после генерации. При повторном клике на описание `images.find()` возвращает `undefined`.

### 3. useChapterData.ts

**Загрузка изображений (строка ~130):**

```tsx
const imagesResponse = await imagesAPI.getBookImages(
  bookId,
  chapter,
  0,
  50,
  signal,
);
```

**Используемый query key:** `imageKeys.byBookPaginated(userId, bookId, chapterNumber, 0, 50)`

**Проблема:** Этот query key **не инвалидируется** мутацией `useGenerateImage`. Данные загружаются один раз при входе в главу и остаются stale.

### 4. useImageMutations.ts — useGenerateImage

**Что инвалидируется при успехе (строки 95-98):**

```tsx
onSuccess: async (data, variables) => {
  // 1. Кеширует в IndexedDB
  await imageCache.set(
    userId,
    variables.descriptionId,
    data.image_url,
    variables.bookId,
  );

  // 2. Инвалидация (НЕПРАВИЛЬНЫЕ КЛЮЧИ!)
  queryClient.invalidateQueries({
    queryKey: imageKeys.byDescription(userId, variables.descriptionId),
  });
  queryClient.invalidateQueries({ queryKey: imageKeys.userStats(userId) });
};
```

**Что НЕ инвалидируется:**

- `imageKeys.byBook(userId, bookId)` — кеш списка изображений книги
- `imageKeys.byBookPaginated(...)` — кеш пагинированного списка (используется `useChapterData`)

### 5. queryKeys.ts — несовпадение ключей

```
Ключ byDescription:     ['images', userId, 'description', 'desc-123']
Ключ byBookPaginated:   ['images', userId, 'book', 'book-456', 'chapter', 5, 'paginated', 0, 50]
                          ↑ Эти ключи НЕ пересекаются!
```

TanStack Query инвалидирует по prefix-match. `byDescription` и `byBookPaginated` находятся в разных ветках иерархии, поэтому инвалидация одного не затрагивает другой.

### 6. useImageModal.ts

**Полностью независимая система:**

- Не использует TanStack Query
- Генерирует через `imagesAPI.generateAsync()` + ручной polling
- При успехе НЕ инвалидирует никакие query keys
- При закрытии модала вызывает `imageCache.release()` — **ревокает Object URL**

### 7. useImageQueries.ts — useImageForDescription

```tsx
queryKey: imageKeys.byDescription(userId, descriptionId),
queryFn: async () => {
  const cachedUrl = await imageCache.get(userId, descriptionId);
  if (cachedUrl) return { ...mockImage, image_url: cachedUrl };
  const image = await imagesAPI.getImageForDescription(descriptionId);
  await imageCache.set(userId, descriptionId, image.image_url, bookId);
  return image;
},
```

**Этот хук существует, но не используется ни в DescriptionDrawer, ни в EpubReader.** Он мог бы решить проблему, если бы DescriptionDrawer запрашивал изображение через него.

---

## Корневые причины

### Баг 1: Изображение пропадает

```
Генерация завершена
  → generateMutation.data содержит image_url (VOLATILE)
  → imageCache.set() сохраняет в IndexedDB
  → invalidateQueries(byDescription) — инвалидирует НЕИСПОЛЬЗУЕМЫЙ query
  → images[] массив в EpubReader НЕ обновлён
  → Пользователь закрывает drawer
  → generateMutation.data теряется (компонент жив, но данные не привязаны к description)
  → Пользователь открывает drawer снова
  → handleDescriptionClick ищет в images[] → не находит → image=undefined
  → Кнопка "Генерировать" вместо "Посмотреть"
```

### Баг 2: Чужое изображение

```
Генерация для описания A завершена
  → generateMutation.data = { image_url: "...A.png", description_id: "A" }
  → Пользователь закрывает drawer
  → Пользователь открывает описание B
  → generateMutation.data ВСЁ ЕЩЁ содержит данные описания A
  → generateMutation.reset() НИГДЕ НЕ ВЫЗЫВАЕТСЯ
  → Строка 126: {generateMutation.data && (...)} — проверка без привязки к description.id
  → Показывается изображение A в модалке описания B
```

---

## Рекомендации по исправлению

### Критические (оба бага)

**1. Сброс мутации при смене описания** (исправляет Баг 2):

```tsx
// DescriptionDrawer.tsx — добавить useEffect
useEffect(() => {
  generateMutation.reset();
}, [description?.id]);
```

**2. Проверка description_id в превью** (защита от Бага 2):

```tsx
// Строка 126 — вместо:
{generateMutation.data && (
// Использовать:
{generateMutation.data && generateMutation.data.description_id === description.id && (
```

**3. Инвалидация правильного query key** (исправляет Баг 1):

```tsx
// useImageMutations.ts onSuccess — добавить:
queryClient.invalidateQueries({
  queryKey: imageKeys.byBook(userId, variables.bookId),
});
```

Это заставит `useChapterData` перезагрузить массив `images` при следующем рендере.

**4. Обновление drawerImage после рефреша images** (исправляет Баг 1):

```tsx
// EpubReader.tsx — добавить useEffect для синхронизации
useEffect(() => {
  if (drawerDescription && isDrawerOpen) {
    const updated = images.find(
      (x) => x.description_id === drawerDescription.id,
    );
    if (updated && !drawerImage) {
      setDrawerImage(updated);
    }
  }
}, [images, drawerDescription, isDrawerOpen, drawerImage]);
```

### Средний приоритет

**5. Использовать `useImageForDescription` в DescriptionDrawer** — запрашивать изображение через TanStack Query вместо пропса, чтобы данные автоматически обновлялись при инвалидации.

**6. Синхронизировать useImageModal с TanStack Query** — заменить ручной polling на query с refetchInterval.

### Низкий приоритет

**7. Не ревокать Object URL при закрытии модала** — ревокать при размонтировании компонента или по таймеру.

**8. Унифицировать источник данных** — использовать TanStack Query cache как single source of truth для всех изображений.

---

## Затронутые файлы

| Файл                                       | Строки  | Роль в баге                                           |
| ------------------------------------------ | ------- | ----------------------------------------------------- |
| `components/Reader/DescriptionDrawer.tsx`  | 36, 126 | Не сбрасывает мутацию, показывает stale данные        |
| `components/Reader/EpubReader.tsx`         | 79, 260 | images массив stale, drawerImage не обновляется       |
| `hooks/epub/useChapterData.ts`             | ~130    | Загружает images один раз, не рефрешит                |
| `hooks/api/useImages/useImageMutations.ts` | 95-98   | Инвалидирует неправильные query keys                  |
| `hooks/api/queryKeys.ts`                   | 220-240 | byDescription и byBookPaginated не пересекаются       |
| `hooks/epub/useImageModal.ts`              | —       | Независим от query системы                            |
| `hooks/api/useImages/useImageQueries.ts`   | 145-219 | useImageForDescription существует, но не используется |
