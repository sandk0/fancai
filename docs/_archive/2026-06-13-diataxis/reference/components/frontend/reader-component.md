# ⚠️ DEPRECATED: BookReader Component

**Status:** DEPRECATED as of October 2025
**Replaced by:** EpubReader.tsx (835 lines)
**Documentation:** See [docs/components/frontend/epub-reader.md](./epub-reader.md)

---

## Why Deprecated?

The original BookReader component was replaced by the professional **EpubReader** component in October 2025 to provide:

1. **CFI (Canonical Fragment Identifier) support** - Industry-standard EPUB navigation
2. **epub.js 0.3.93 integration** - Professional EPUB rendering engine
3. **Pixel-perfect position restoration** - Hybrid CFI + scroll offset system
4. **Locations-based progress** - Accurate 0-100% progress calculation
5. **Smart description highlighting** - Automatic text highlighting with clickable images
6. **Cross-device consistency** - CFI positions work across all screen sizes

### What the Old BookReader Lacked:

❌ **No CFI support** - Couldn't restore exact reading position
❌ **Chapter-based navigation only** - Not EPUB standard compliant
❌ **No smart highlights** - Manual description tracking
❌ **No locations generation** - Inaccurate progress tracking
❌ **Basic functionality** - Missing professional EPUB features

### Migration Guide

If you're maintaining legacy code using BookReader, migrate to EpubReader:

```typescript
// OLD: BookReader (deprecated)
<BookReader
  bookId={bookId}
  chapterNumber={chapter}
  onPageChange={handlePageChange}
/>

// NEW: EpubReader (October 2025)
<EpubReader
  book={bookDetail}
/>
```

**Migration steps:**
1. Replace `<BookReader>` with `<EpubReader>`
2. Update API calls to include CFI fields (`reading_location_cfi`, `scroll_offset_percent`)
3. Use locations API for accurate progress tracking
4. Remove custom pagination logic (epub.js handles this)
5. See [epub-reader.md](./epub-reader.md) for full documentation

**Backend changes required:**
- Add `reading_location_cfi` field to `reading_progress` table ✅ (Done October 2025)
- Add `scroll_offset_percent` field to `reading_progress` table ✅ (Done October 2025)
- Implement `GET /books/{id}/file` endpoint ✅ (Done October 2025)
- Update progress calculation to use CFI percentages ✅ (Done October 2025)

---

# Historical Documentation (BookReader - Pre-October 2025)

> **Note:** This documentation is kept for historical reference only.
> For current implementation, see [epub-reader.md](./epub-reader.md)

## Архитектура компонента

### Технологический стек
- **React 18** с TypeScript
- **Zustand** для state management  
- **React Query** для server state
- **Tailwind CSS** для стилизации
- **Framer Motion** для анимаций

### Структура файлов
```
frontend/src/components/Reader/
├── BookReader.tsx          # Основной компонент читалки
├── ReaderControls.tsx      # Элементы управления
├── ReaderProgress.tsx      # Индикатор прогресса
├── ReaderSettings.tsx      # Настройки читалки
├── DescriptionModal.tsx    # Модальное окно с изображением
└── hooks/
    ├── useBookReader.ts    # Основная логика читалки
    ├── usePagination.ts    # Логика пагинации
    └── useReadingProgress.ts # Прогресс чтения
```

## Основной компонент BookReader

### Props Interface
```typescript
interface BookReaderProps {
  bookId: string;
  chapterNumber?: number;
  autoSave?: boolean;
  theme?: 'light' | 'dark' | 'sepia';
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  onProgressChange?: (progress: ReadingProgressUpdate) => void;
}
```

### Ключевые особенности

#### 1. Умная пагинация
```typescript
const usePagination = (content: string, containerRef: RefObject<HTMLDivElement>) => {
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  
  // Расчет страниц на основе размеров контейнера и шрифта
  const calculatePages = useCallback(() => {
    if (!containerRef.current || !content) return;
    
    const container = containerRef.current;
    const { clientHeight, clientWidth } = container;
    
    // Создаем временный элемент для измерения текста
    const measurer = document.createElement('div');
    measurer.style.cssText = getComputedStyle(container).cssText;
    measurer.style.position = 'absolute';
    measurer.style.visibility = 'hidden';
    measurer.innerHTML = content;
    
    document.body.appendChild(measurer);
    
    // Разбиваем на страницы
    const pages = splitContentIntoPages(measurer, clientHeight, clientWidth);
    setPages(pages);
    
    document.body.removeChild(measurer);
  }, [content, containerRef]);
  
  return { pages, currentPage, setCurrentPage, calculatePages };
};
```

#### 2. Выделение описаний
```typescript
const highlightDescriptions = (content: string, descriptions: Description[]) => {
  let highlightedContent = content;
  
  descriptions.forEach((desc, index) => {
    const regex = new RegExp(escapeRegExp(desc.content), 'gi');
    highlightedContent = highlightedContent.replace(regex, (match) => 
      `<span 
         class="description-highlight cursor-pointer hover:bg-blue-100 transition-colors" 
         data-description-id="${desc.id}"
         data-description-type="${desc.type}"
         title="Нажмите, чтобы посмотреть изображение"
       >${match}</span>`
    );
  });
  
  return highlightedContent;
};
```

#### 3. Обработка кликов по описаниям
```typescript
const useDescriptionClicks = (onDescriptionClick: (id: string) => void) => {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const descriptionElement = target.closest('.description-highlight');
      
      if (descriptionElement) {
        const descriptionId = descriptionElement.getAttribute('data-description-id');
        if (descriptionId) {
          onDescriptionClick(descriptionId);
        }
      }
    };
    
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [onDescriptionClick]);
};
```

## Reader Settings Component

### Настройки внешнего вида
```typescript
interface ReaderSettings {
  fontSize: number;        // 12-24px
  fontFamily: string;      // 'serif', 'sans-serif', 'monospace'
  lineHeight: number;      // 1.2-2.0
  theme: ReaderTheme;      // 'light', 'dark', 'sepia'
  contentWidth: number;    // 60-100%
  padding: number;         // 16-48px
}

const ReaderSettings: React.FC = () => {
  const { settings, updateSettings } = useReaderStore();
  
  return (
    <div className="space-y-6">
      {/* Размер шрифта */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Размер шрифта: {settings.fontSize}px
        </label>
        <input
          type="range"
          min="12"
          max="24"
          value={settings.fontSize}
          onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>
      
      {/* Семейство шрифтов */}
      <div>
        <label className="block text-sm font-medium mb-2">Шрифт</label>
        <select 
          value={settings.fontFamily}
          onChange={(e) => updateSettings({ fontFamily: e.target.value })}
          className="w-full p-2 border rounded"
        >
          <option value="serif">С засечками (Serif)</option>
          <option value="sans-serif">Без засечек (Sans-serif)</option>
          <option value="monospace">Моноширинный</option>
        </select>
      </div>
      
      {/* Тема оформления */}
      <div>
        <label className="block text-sm font-medium mb-2">Тема</label>
        <div className="flex space-x-2">
          {['light', 'dark', 'sepia'].map((theme) => (
            <button
              key={theme}
              onClick={() => updateSettings({ theme: theme as ReaderTheme })}
              className={`px-4 py-2 rounded ${
                settings.theme === theme 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              {themeLabels[theme]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
```

## Progress Tracking

### Автоматическое сохранение прогресса
```typescript
const useReadingProgress = (bookId: string, chapterNumber: number) => {
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const updateProgressMutation = useUpdateReadingProgressMutation();
  
  // Debounced сохранение для предотвращения частых запросов
  const debouncedSaveProgress = useDebouncedCallback(
    async (newProgress: Partial<ReadingProgress>) => {
      try {
        await updateProgressMutation.mutateAsync({
          bookId,
          ...newProgress,
        });
      } catch (error) {
        console.error('Failed to save reading progress:', error);
        // Показать пользователю уведомление об ошибке
      }
    },
    1000 // 1 секунда задержки
  );
  
  // Сохранение при смене страницы
  const updateProgress = useCallback((page: number, totalPages: number) => {
    const percentage = Math.round((page / totalPages) * 100);
    
    setProgress(prev => ({
      ...prev,
      currentPage: page,
      totalPages,
      progressPercentage: percentage,
      lastReadAt: new Date().toISOString(),
    }));
    
    debouncedSaveProgress({
      chapterNumber,
      currentPage: page,
      totalPages,
      progressPercentage: percentage,
    });
  }, [bookId, chapterNumber, debouncedSaveProgress]);
  
  return { progress, updateProgress };
};
```

## Description Modal Component

### Модальное окно с изображением
```typescript
interface DescriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  description: Description;
  generatedImage?: GeneratedImage;
  onRegenerateImage?: () => void;
}

const DescriptionModal: React.FC<DescriptionModalProps> = ({
  isOpen,
  onClose,
  description,
  generatedImage,
  onRegenerateImage,
}) => {
  const [isImageLoading, setIsImageLoading] = useState(false);
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Заголовок */}
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {getDescriptionTypeLabel(description.type)}
                </h3>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Содержимое */}
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              {/* Описание из книги */}
              <div className="mb-4">
                <h4 className="font-medium mb-2">Описание из книги:</h4>
                <p className="text-gray-700 italic">"{description.content}"</p>
              </div>
              
              {/* Изображение */}
              {generatedImage ? (
                <div className="space-y-4">
                  <img
                    src={generatedImage.imageUrl}
                    alt="AI сгенерированное изображение"
                    className="w-full max-w-md mx-auto rounded-lg shadow-md"
                    onLoad={() => setIsImageLoading(false)}
                    onError={() => setIsImageLoading(false)}
                  />
                  
                  {/* Кнопка перегенерации */}
                  {onRegenerateImage && (
                    <button
                      onClick={onRegenerateImage}
                      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Создать новое изображение
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-200 rounded-lg flex items-center justify-center">
                    <Image className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 mb-4">
                    Изображение еще не сгенерировано
                  </p>
                  {onRegenerateImage && (
                    <button
                      onClick={onRegenerateImage}
                      className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                    >
                      Создать изображение
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

## Keyboard Navigation

### Навигация с клавиатуры
```typescript
const useKeyboardNavigation = (
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void
) => {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          if (currentPage > 0) {
            onPageChange(currentPage - 1);
          }
          break;
          
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ': // Пробел
          event.preventDefault();
          if (currentPage < totalPages - 1) {
            onPageChange(currentPage + 1);
          }
          break;
          
        case 'Home':
          event.preventDefault();
          onPageChange(0);
          break;
          
        case 'End':
          event.preventDefault();
          onPageChange(totalPages - 1);
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentPage, totalPages, onPageChange]);
};
```

## Responsive Design

### Адаптивность для мобильных устройств
```typescript
const useResponsiveReader = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  
  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      setIsTablet(width >= 768 && width < 1024);
    };
    
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);
  
  // Автоматическая корректировка настроек для мобильных
  const getMobileOptimizedSettings = (settings: ReaderSettings): ReaderSettings => {
    if (isMobile) {
      return {
        ...settings,
        fontSize: Math.max(settings.fontSize, 16), // Минимум 16px на мобильных
        padding: Math.min(settings.padding, 16),   // Меньше отступы
        contentWidth: 100,                         // Полная ширина
      };
    }
    return settings;
  };
  
  return { isMobile, isTablet, getMobileOptimizedSettings };
};
```

## Performance Optimization

### Виртуализация для больших книг
```typescript
const useVirtualization = (content: string, pageHeight: number) => {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 2 });
  const [renderedPages, setRenderedPages] = useState<Map<number, string>>(new Map());
  
  // Рендерим только видимые страницы + buffer
  const updateVisibleRange = useCallback((currentPage: number) => {
    const bufferSize = 2; // Предзагружаем 2 страницы до и после
    const start = Math.max(0, currentPage - bufferSize);
    const end = Math.min(totalPages - 1, currentPage + bufferSize);
    
    setVisibleRange({ start, end });
  }, [totalPages]);
  
  // Lazy loading страниц
  const getPage = useCallback((pageIndex: number): string => {
    if (!renderedPages.has(pageIndex)) {
      const pageContent = pages[pageIndex] || '';
      setRenderedPages(prev => new Map(prev).set(pageIndex, pageContent));
      return pageContent;
    }
    return renderedPages.get(pageIndex) || '';
  }, [pages, renderedPages]);
  
  return { visibleRange, getPage, updateVisibleRange };
};
```

## State Management (Zustand)

### Reader Store
```typescript
interface ReaderState {
  // Настройки
  settings: ReaderSettings;
  updateSettings: (settings: Partial<ReaderSettings>) => void;
  
  // Текущее состояние чтения
  currentBook: Book | null;
  currentChapter: number;
  currentPage: number;
  
  // UI состояние
  isSettingsOpen: boolean;
  isDescriptionModalOpen: boolean;
  selectedDescription: Description | null;
  
  // Actions
  setCurrentBook: (book: Book) => void;
  setCurrentChapter: (chapter: number) => void;
  setCurrentPage: (page: number) => void;
  openDescriptionModal: (description: Description) => void;
  closeDescriptionModal: () => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  // Initial state
  settings: defaultReaderSettings,
  currentBook: null,
  currentChapter: 1,
  currentPage: 0,
  isSettingsOpen: false,
  isDescriptionModalOpen: false,
  selectedDescription: null,
  
  // Actions
  updateSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings }
    })),
  
  setCurrentBook: (book) => set({ currentBook: book }),
  
  setCurrentChapter: (chapter) => 
    set({ currentChapter: chapter, currentPage: 0 }),
  
  setCurrentPage: (page) => set({ currentPage: page }),
  
  openDescriptionModal: (description) =>
    set({
      selectedDescription: description,
      isDescriptionModalOpen: true,
    }),
  
  closeDescriptionModal: () =>
    set({
      selectedDescription: null,
      isDescriptionModalOpen: false,
    }),
}));
```

## Testing

### Unit Tests с Vitest
```typescript
// BookReader.test.tsx
describe('BookReader Component', () => {
  it('renders book content correctly', () => {
    const mockBook = createMockBook();
    render(<BookReader bookId={mockBook.id} />);
    
    expect(screen.getByText(mockBook.chapters[0].content)).toBeInTheDocument();
  });
  
  it('handles page navigation', async () => {
    const { user } = setup(<BookReader bookId="test-book" />);
    
    const nextButton = screen.getByLabelText('Next page');
    await user.click(nextButton);
    
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });
  
  it('opens description modal on click', async () => {
    const { user } = setup(<BookReader bookId="test-book" />);
    
    const description = screen.getByText('старый дом');
    await user.click(description);
    
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

---

## Заключение

BookReader компонент обеспечивает:

- **Modern Reading Experience** - адаптивная пагинация, настройки шрифтов и тем
- **AI Integration** - интерактивные описания с изображениями
- **Performance** - виртуализация, lazy loading, debounced saving
- **Accessibility** - keyboard navigation, screen reader support
- **Mobile First** - responsive design для всех устройств
- **User Experience** - автосохранение прогресса, smooth анимации

Компонент полностью готов для production использования и может масштабироваться для больших библиотек книг.