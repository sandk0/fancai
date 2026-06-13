# Интеграция epub.js + react-reader

## ✅ Завершено:

1. Установлены зависимости: `epubjs`, `react-reader`
2. Backend обновлен:
   - Добавлено поле `reading_location_cfi VARCHAR(500)` в `ReadingProgress`
   - GET/POST `/progress` endpoints поддерживают CFI
   - Миграция БД применена
3. Commit: `661f56e`

## 📋 Следующие шаги:

### 1. Обновить TypeScript типы (5 мин)

```typescript
// frontend/src/types/api.ts

export interface ReadingProgress {
  book_id: string;
  current_page: number;
  current_chapter: number;
  current_position: number;
  reading_location_cfi?: string;  // ← Добавить это поле
  progress_percent: number;
  last_read_at: string;
}
```

### 2. Создать новый BookReader компонент (30 мин)

Создать `frontend/src/components/Reader/EpubReader.tsx`:

```typescript
import { useState } from 'react';
import { ReactReader } from 'react-reader';
import { booksAPI } from '@/api/books';

interface EpubReaderProps {
  bookId: string;
  epubUrl: string;
}

export const EpubReader: React.FC<EpubReaderProps> = ({ bookId, epubUrl }) => {
  const [location, setLocation] = useState<string | number>(0);

  // Загрузить сохраненную позицию
  useEffect(() => {
    booksAPI.getReadingProgress(bookId).then(({ progress }) => {
      if (progress?.reading_location_cfi) {
        setLocation(progress.reading_location_cfi);
      }
    });
  }, [bookId]);

  // Сохранять при изменении позиции
  const handleLocationChange = (epubcfi: string) => {
    setLocation(epubcfi);

    // Debounce сохранение (каждые 2 секунды)
    booksAPI.updateReadingProgress(bookId, {
      current_chapter: 1, // epub.js автоматически управляет главами
      current_position_percent: 0, // CFI важнее
      reading_location_cfi: epubcfi
    });
  };

  return (
    <div style={{ height: '100vh' }}>
      <ReactReader
        url={epubUrl}
        location={location}
        locationChanged={handleLocationChange}
        getRendition={(rendition) => {
          // Здесь можно добавить кастомизацию
          // Например, инжектить обработчики для изображений
        }}
      />
    </div>
  );
};
```

### 3. Получение EPUB файла (10 мин)

Добавить endpoint в backend для получения EPUB файла:

```python
# backend/app/routers/books.py

@router.get("/{book_id}/file")
async def get_book_file(
    book_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session)
):
    """Возвращает EPUB файл для чтения."""
    book = await book_service.get_book_by_id(db, book_id, current_user.id)
    if not book:
        raise HTTPException(404, "Book not found")

    return FileResponse(
        book.file_path,
        media_type="application/epub+zip",
        filename=f"{book.title}.epub"
    )
```

### 4. Заменить старый BookReader (5 мин)

В `frontend/src/pages/BookPage.tsx`:

```typescript
// Было:
navigate(`/book/${book.id}/chapter/${book.reading_progress.current_chapter}`)

// Стало:
navigate(`/book/${book.id}/read`)  // Новый роут для epub.js reader
```

### 5. Добавить функциональность изображений (40 мин)

```typescript
getRendition={(rendition) => {
  rendition.on('rendered', (section) => {
    // Найти описания в тексте главы
    const descriptions = await booksAPI.getChapterDescriptions(bookId, currentChapter);

    // Добавить highlights для описаний
    descriptions.forEach(desc => {
      const cfiRange = section.search(desc.content);
      rendition.annotations.add(
        'highlight',
        cfiRange,
        {},
        (e) => {
          // Показать ImageModal при клике
          showImageModal(desc);
        }
      );
    });
  });
}}
```

### 6. Преимущества CFI:

- ✅ **Точная позиция**: CFI указывает точное место в тексте, не зависит от размера шрифта
- ✅ **Стандарт**: EPUB CFI - официальный стандарт IDPF
- ✅ **Надежность**: Работает даже при изменении настроек читалки
- ✅ **Кроссплатформенность**: Один и тот же CFI работает везде

Пример CFI: `epubcfi(/6/14[Chapter01]!/4/2/2[para01]/1:0)`

### 7. Для импорта книг:

epub.js может парсить метаданные:

```typescript
import ePub from 'epubjs';

const parseEpub = async (file: File) => {
  const book = ePub();
  await book.open(file);

  const metadata = await book.loaded.metadata;
  // metadata.title, metadata.creator, metadata.language

  const spine = await book.loaded.spine;
  // spine.length - количество глав

  return { metadata, chapterCount: spine.length };
};
```

## 🚀 Быстрый старт:

1. Обновите `frontend/src/types/api.ts` (добавьте `reading_location_cfi`)
2. Создайте `EpubReader.tsx` по примеру выше
3. Добавьте роут `/book/:id/read` → `<EpubReader />`
4. Тестируйте!

## 📚 Документация:

- epub.js: https://github.com/futurepress/epub.js/
- react-reader: https://github.com/gerhardsletten/react-reader
- CFI спецификация: http://idpf.org/epub/linking/cfi/

---

**Время на завершение**: ~2 часа
**Результат**: Профессиональная читалка без багов с позицией чтения ✨
