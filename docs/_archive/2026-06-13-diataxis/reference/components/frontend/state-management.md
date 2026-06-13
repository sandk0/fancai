# Frontend State Management - BookReader AI

Система управления состоянием на основе Zustand stores для React приложения BookReader AI. Обеспечивает централизованное управление данными с типобезопасностью и оптимизацией производительности.

## Архитектура состояния

### Принципы проектирования
- **Разделение по доменам** - отдельные stores для разных функциональных областей
- **TypeScript first** - полная типизация всех состояний и actions
- **Persistence** - автоматическое сохранение критичных данных в localStorage
- **Middleware** - логирование, devtools, persist
- **Optimistic updates** - немедленное обновление UI с rollback при ошибках

### Store Architecture
```
AuthStore → Аутентификация и пользователь
BooksStore → Библиотека книг и прогресс чтения
ImagesStore → Галерея изображений и генерация
ReaderStore → Настройки читалки и текущая сессия
UIStore → UI состояние, модальные окна, уведомления
```

---

## AuthStore

**Файл:** `frontend/src/stores/authStore.ts`

### State Interface
```typescript
interface AuthState {
  // User data
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  
  // Loading states
  isLoading: boolean;
  isLoggingIn: boolean;
  isRegistering: boolean;
  
  // Error handling
  authError: string | null;
  
  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshTokens: () => Promise<boolean>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  clearError: () => void;
}
```

### Implementation
```typescript
export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
        isLoggingIn: false,
        isRegistering: false,
        authError: null,

        // Login action
        login: async (credentials: LoginCredentials) => {
          set({ isLoggingIn: true, authError: null });
          
          try {
            const response = await authAPI.login(credentials);
            
            set({
              user: response.user,
              accessToken: response.access_token,
              refreshToken: response.refresh_token,
              isAuthenticated: true,
              isLoggingIn: false
            });
            
            // Setup automatic token refresh
            setupTokenRefresh(response.refresh_token);
            
          } catch (error) {
            set({
              authError: error.message || 'Login failed',
              isLoggingIn: false
            });
            throw error;
          }
        },

        // Register action
        register: async (userData: RegisterData) => {
          set({ isRegistering: true, authError: null });
          
          try {
            const response = await authAPI.register(userData);
            
            set({
              user: response.user,
              accessToken: response.access_token,
              refreshToken: response.refresh_token,
              isAuthenticated: true,
              isRegistering: false
            });
            
            setupTokenRefresh(response.refresh_token);
            
          } catch (error) {
            set({
              authError: error.message || 'Registration failed',
              isRegistering: false
            });
            throw error;
          }
        },

        // Logout action
        logout: async () => {
          const { refreshToken } = get();
          
          try {
            if (refreshToken) {
              await authAPI.logout({ refresh_token: refreshToken });
            }
          } catch (error) {
            console.warn('Logout request failed:', error);
          }
          
          // Clear all auth data
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            authError: null
          });
          
          // Clear other stores
          useBooksStore.getState().clearUserData();
          useImagesStore.getState().clearUserData();
          useReaderStore.getState().resetSettings();
        },

        // Token refresh
        refreshTokens: async () => {
          const { refreshToken } = get();
          
          if (!refreshToken) {
            return false;
          }
          
          try {
            const response = await authAPI.refreshTokens({ refresh_token: refreshToken });
            
            set({
              accessToken: response.access_token,
              refreshToken: response.refresh_token
            });
            
            return true;
            
          } catch (error) {
            // Refresh failed - logout user
            get().logout();
            return false;
          }
        },

        // Profile update
        updateProfile: async (updates: Partial<User>) => {
          const { user } = get();
          if (!user) return;
          
          set({ isLoading: true });
          
          try {
            const updatedUser = await authAPI.updateProfile(updates);
            
            set({
              user: { ...user, ...updatedUser },
              isLoading: false
            });
            
          } catch (error) {
            set({
              authError: error.message || 'Profile update failed',
              isLoading: false
            });
            throw error;
          }
        },

        clearError: () => set({ authError: null })
      }),
      {
        name: 'auth-storage',
        partialize: (state) => ({
          user: state.user,
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          isAuthenticated: state.isAuthenticated
        })
      }
    ),
    { name: 'AuthStore' }
  )
);
```

---

## BooksStore

**Файл:** `frontend/src/stores/booksStore.ts`

### State Interface
```typescript
interface BooksState {
  // Books data
  books: Book[];
  currentBook: Book | null;
  
  // Pagination
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  hasNextPage: boolean;
  
  // Filters and search
  searchQuery: string;
  genreFilter: BookGenre | null;
  statusFilter: BookStatus | null;
  sortBy: BookSortOption;
  
  // Loading states
  isLoading: boolean;
  isUploadingBook: boolean;
  uploadProgress: number;
  
  // Actions
  loadBooks: (params?: BookFilters) => Promise<void>;
  searchBooks: (query: string) => Promise<void>;
  uploadBook: (file: File, onProgress?: (progress: number) => void) => Promise<Book>;
  deleteBook: (bookId: string) => Promise<void>;
  setCurrentBook: (book: Book | null) => void;
  updateProgress: (bookId: string, progress: ReadingProgress) => Promise<void>;
}
```

---

## ImagesStore

**Файл:** `frontend/src/stores/imagesStore.ts`

### Key Features
```typescript
interface ImagesState {
  // Images data
  imagesByBook: Record<string, GeneratedImage[]>;
  generationQueue: GenerationTask[];
  
  // Gallery state
  selectedImage: GeneratedImage | null;
  galleryFilters: ImageFilters;
  
  // Generation status
  isGenerating: boolean;
  generationProgress: GenerationProgress;
  
  // Actions
  loadImagesForBook: (bookId: string) => Promise<void>;
  generateImage: (descriptionId: string, options?: GenerationOptions) => Promise<void>;
  regenerateImage: (imageId: string, options?: RegenerationOptions) => Promise<void>;
  deleteImage: (imageId: string) => Promise<void>;
  
  // Gallery actions
  openImageModal: (image: GeneratedImage) => void;
  closeImageModal: () => void;
  setGalleryFilters: (filters: Partial<ImageFilters>) => void;
}
```

---

## ReaderStore

**Файл:** `frontend/src/stores/readerStore.ts`

### Reader Configuration
```typescript
interface ReaderState {
  // Current reading session
  currentBookId: string | null;
  currentChapter: number;
  currentPage: number;
  scrollPosition: number;
  
  // Reader settings
  settings: ReaderSettings;
  
  // UI state
  isMenuOpen: boolean;
  isSettingsOpen: boolean;
  isFullscreen: boolean;
  
  // Navigation
  chapters: Chapter[];
  totalPages: number;
  
  // Actions
  openBook: (bookId: string, chapter?: number) => Promise<void>;
  navigateToChapter: (chapter: number) => void;
  navigateToPage: (page: number) => void;
  updateSettings: (settings: Partial<ReaderSettings>) => void;
  saveProgress: () => Promise<void>;
}

interface ReaderSettings {
  // Typography
  fontSize: number;        // 12-24px
  fontFamily: FontFamily; // serif, sans-serif, monospace
  lineHeight: number;     // 1.2-2.0
  
  // Layout
  theme: Theme;           // light, dark, sepia
  pageWidth: number;      // max width in rem
  margin: number;         // padding in rem
  
  // Behavior
  autoSaveProgress: boolean;
  showImageInline: boolean;
  animatePageTransitions: boolean;
  
  // Reading aids
  highlightDescriptions: boolean;
  showReadingProgress: boolean;
  enableKeyboardNavigation: boolean;
}
```

---

## epub.js State Management (October 2025)

### Overview

EpubReader компонент использует **локальное состояние** вместо глобального store, так как epub.js instances не должны быть сериализованы в Zustand. Вместо этого используется комбинация React state, refs и external API calls.

### Local Component State (EpubReader.tsx)

```typescript
const EpubReader: React.FC<EpubReaderProps> = ({ book }) => {
  // Book instance state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [renditionReady, setRenditionReady] = useState(false);

  // Content state
  const [descriptions, setDescriptions] = useState<Description[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  // Navigation state
  const [currentChapter, setCurrentChapter] = useState<number>(1);

  // ... component logic
};
```

**Why local state?**
- epub.js Book and Rendition objects contain non-serializable data (DOM references, ArrayBuffers)
- Component lifecycle tied to mount/unmount (cleanup required)
- No need for cross-component sharing of epub.js instances

### Persistent Refs

```typescript
// Persist across re-renders without triggering re-renders
const viewerRef = useRef<HTMLDivElement>(null);           // DOM container
const renditionRef = useRef<Rendition | null>(null);      // epub.js rendition
const bookRef = useRef<Book | null>(null);                // epub.js book instance
const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Debounce timer
const restoredCfi = useRef<string | null>(null);          // CFI restoration tracking
```

**Why refs?**
- Mutable values that persist between renders
- Don't trigger re-renders when updated
- Essential for epub.js instances (updating state would cause infinite loops)

### External API State (React Query)

```typescript
// Book data
const { data: bookData } = useQuery({
  queryKey: ['book', bookId],
  queryFn: () => booksAPI.getBook(bookId)
});

// Reading progress (loaded once on mount)
const { data: progress } = useQuery({
  queryKey: ['progress', bookId],
  queryFn: () => booksAPI.getReadingProgress(bookId),
  staleTime: Infinity  // Never refetch automatically
});

// Descriptions for highlighting (reload on chapter change)
const { data: descriptionsData, refetch: refetchDescriptions } = useQuery({
  queryKey: ['descriptions', bookId, currentChapter],
  queryFn: () => booksAPI.getChapterDescriptions(bookId, currentChapter, false),
  enabled: !!bookId && currentChapter > 0
});

// Images for current chapter
const { data: imagesData, refetch: refetchImages } = useQuery({
  queryKey: ['images', bookId, currentChapter],
  queryFn: () => imagesAPI.getBookImages(bookId, currentChapter),
  enabled: !!bookId && currentChapter > 0
});
```

**Pattern:** Use React Query for server state, local state for UI/epub.js state.

### Progress Saving Pattern

```typescript
// Mutation for saving progress
const { mutate: saveProgress } = useMutation({
  mutationFn: (data: ProgressUpdate) =>
    booksAPI.updateReadingProgress(book.id, data),
  onError: (error) => {
    console.error('Failed to save progress:', error);
    // Could add toast notification here
  }
});

// Debounced save in relocated event
rendition.on('relocated', (location: any) => {
  const cfi = location.start.cfi;
  const chapter = getChapterFromLocation(location);

  // Skip initial relocated events (restoration)
  if (restoredCfi.current && cfi === restoredCfi.current) {
    return;
  }

  // Clear previous timeout
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
  }

  // Debounced save (2 seconds)
  saveTimeoutRef.current = setTimeout(() => {
    const progressPercent = Math.round(
      bookRef.current!.locations.percentageFromCfi(cfi) * 100
    );

    // Calculate scroll offset for pixel-perfect restoration
    const contents = renditionRef.current!.getContents();
    const iframe = contents[0];
    const doc = iframe.document;
    const scrollTop = doc.documentElement.scrollTop;
    const scrollHeight = doc.documentElement.scrollHeight;
    const clientHeight = doc.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;
    const scrollOffsetPercent = (scrollTop / maxScroll) * 100;

    // Save to backend
    saveProgress({
      current_chapter: chapter,
      current_position: progressPercent,
      reading_location_cfi: cfi,
      scroll_offset_percent: scrollOffsetPercent
    });
  }, 2000);
});
```

**Key points:**
- Debouncing prevents excessive API calls
- CFI + scroll offset for hybrid restoration
- Skip relocated events during restoration phase
- Cleanup timeout on unmount

### Chapter Change Detection

```typescript
// Auto-reload descriptions and images when chapter changes
useEffect(() => {
  const loadChapterData = async () => {
    if (!book.id || currentChapter <= 0) return;

    try {
      // Reload descriptions
      const descriptionsResponse = await booksAPI.getChapterDescriptions(
        book.id,
        currentChapter,
        false  // use cache, don't re-extract
      );
      setDescriptions(descriptionsResponse.nlp_analysis.descriptions);

      // Reload images
      const imagesResponse = await imagesAPI.getBookImages(
        book.id,
        currentChapter
      );
      setImages(imagesResponse.images);

      // Re-apply highlights after data loads
      if (renditionReady) {
        setTimeout(() => highlightDescriptionsInText(), 300);
      }
    } catch (error) {
      console.error('Failed to load chapter data:', error);
    }
  };

  loadChapterData();
}, [book.id, currentChapter, renditionReady]);
```

**Pattern:** Side effects for chapter-specific data loading.

### State Lifecycle

```
1. Mount
   ↓
2. setIsReady(true) after 100ms delay
   ↓
3. useEffect [isReady] → initEpub()
   ↓
4. Fetch EPUB file → ArrayBuffer
   ↓
5. ePub(arrayBuffer) → bookRef.current
   ↓
6. await book.ready
   ↓
7. await book.locations.generate(1600)
   ↓
8. book.renderTo() → renditionRef.current
   ↓
9. rendition.on('relocated', handler)
   ↓
10. Load progress from API
   ↓
11. await rendition.display(cfi) → restore position
   ↓
12. setRenditionReady(true)
   ↓
13. Load descriptions/images for currentChapter
   ↓
14. Apply highlights
   ↓
15. Ready for user interaction
```

### Cleanup Pattern

```typescript
useEffect(() => {
  // Initialization logic...

  // Cleanup on unmount
  return () => {
    // Clear debounce timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Destroy epub.js instances
    if (renditionRef.current) {
      renditionRef.current.destroy();
    }
    if (bookRef.current) {
      bookRef.current.destroy();
    }
  };
}, []);
```

**Critical:** Always cleanup epub.js instances to prevent memory leaks.

### Integration with Global Stores

While EpubReader uses local state, it can still interact with global stores when needed:

```typescript
// Example: Update global reading session
import { useReaderStore } from '@/stores/readerStore';

const { updateCurrentBook, recordReadingTime } = useReaderStore();

useEffect(() => {
  // Update global store when book loads
  updateCurrentBook(book.id);

  // Track reading time
  const startTime = Date.now();

  return () => {
    const readingTime = Math.floor((Date.now() - startTime) / 60000);
    recordReadingTime(book.id, readingTime);
  };
}, [book.id]);
```

**Pattern:** Local state for component, global store for cross-component data.

---

## UIStore

**Файл:** `frontend/src/stores/uiStore.ts`

### Global UI State
```typescript
interface UIState {
  // Modals
  activeModal: ModalType | null;
  modalData: any;
  
  // Notifications
  notifications: Notification[];
  
  // Layout
  sidebarOpen: boolean;
  headerHeight: number;
  
  // Loading indicators
  globalLoading: boolean;
  loadingMessage: string;
  
  // Actions
  openModal: (type: ModalType, data?: any) => void;
  closeModal: () => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  toggleSidebar: () => void;
  setGlobalLoading: (loading: boolean, message?: string) => void;
}

// Modal types
type ModalType = 
  | 'book-upload'
  | 'image-gallery' 
  | 'reader-settings'
  | 'user-profile'
  | 'subscription-upgrade'
  | 'book-delete-confirm';

// Notification system
interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  timestamp: number;
  autoClose?: boolean;
  duration?: number;
}
```

---

## Store Integration Patterns

### Cross-Store Communication
```typescript
// Example: When book upload completes, update books list
export const useBookUpload = () => {
  const { uploadBook } = useBooksStore();
  const { addNotification } = useUIStore();
  
  const handleUpload = async (file: File) => {
    try {
      const book = await uploadBook(file, (progress) => {
        // Update upload progress
      });
      
      addNotification({
        type: 'success',
        title: 'Book uploaded successfully',
        message: `"${book.title}" is being processed`
      });
      
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Upload failed',
        message: error.message
      });
    }
  };
  
  return { handleUpload };
};
```

### Optimistic Updates
```typescript
// Example: Immediate progress update with rollback
const updateProgress = async (bookId: string, progress: ReadingProgress) => {
  const currentBooks = get().books;
  
  // Optimistic update
  set({
    books: currentBooks.map(book =>
      book.id === bookId
        ? { ...book, reading_progress: progress }
        : book
    )
  });
  
  try {
    await booksAPI.updateProgress(bookId, progress);
  } catch (error) {
    // Rollback on error
    set({ books: currentBooks });
    throw error;
  }
};
```

### Persistence Configuration
```typescript
const persistConfig = {
  name: 'bookreader-state',
  version: 1,
  migrate: (persistedState: any, version: number) => {
    // Handle state migrations
    if (version < 1) {
      // Migration logic
    }
    return persistedState;
  },
  partialize: (state: ReaderState) => ({
    settings: state.settings,
    currentBookId: state.currentBookId,
    currentChapter: state.currentChapter
  })
};
```

---

## Custom Hooks

### Compound Store Hooks
```typescript
// Combined auth and books hook
export const useUserBooks = () => {
  const { user, isAuthenticated } = useAuthStore();
  const { books, loadBooks, isLoading } = useBooksStore();
  
  useEffect(() => {
    if (isAuthenticated && user) {
      loadBooks();
    }
  }, [isAuthenticated, user, loadBooks]);
  
  return {
    books: isAuthenticated ? books : [],
    isLoading,
    hasBooks: books.length > 0
  };
};

// Reading session hook
export const useReadingSession = (bookId: string) => {
  const { 
    currentBookId, 
    currentChapter, 
    settings,
    openBook,
    saveProgress 
  } = useReaderStore();
  
  const { updateProgress } = useBooksStore();
  
  useEffect(() => {
    if (bookId && bookId !== currentBookId) {
      openBook(bookId);
    }
  }, [bookId, currentBookId, openBook]);
  
  // Auto-save progress
  useEffect(() => {
    if (!settings.autoSaveProgress) return;
    
    const interval = setInterval(() => {
      if (currentBookId) {
        saveProgress();
      }
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, [currentBookId, settings.autoSaveProgress, saveProgress]);
  
  return {
    isCurrentBook: bookId === currentBookId,
    currentChapter,
    settings
  };
};
```

### Performance Optimization
```typescript
// Selective subscription to avoid re-renders
export const useBookTitle = (bookId: string) => {
  return useBooksStore(
    useCallback(
      (state) => state.books.find(book => book.id === bookId)?.title,
      [bookId]
    )
  );
};

// Memoized selectors
const selectBooksByGenre = (genre: BookGenre) => 
  (state: BooksState) => state.books.filter(book => book.genre === genre);

export const useFantasyBooks = () => {
  const selector = useMemo(() => selectBooksByGenre(BookGenre.FANTASY), []);
  return useBooksStore(selector);
};
```

---

## Testing Stores

### Store Testing Utils
```typescript
// Test utilities
export const createMockAuthStore = (overrides: Partial<AuthState> = {}) => {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    ...overrides
  };
};

// Test setup
const renderWithStores = (
  component: React.ReactElement,
  initialStores: {
    auth?: Partial<AuthState>;
    books?: Partial<BooksState>;
  } = {}
) => {
  // Reset all stores
  useAuthStore.setState(createMockAuthStore(initialStores.auth));
  useBooksStore.setState({ books: [], ...initialStores.books });
  
  return render(component);
};
```

---

## Store Devtools

### Development Helpers
```typescript
// Debug store state
if (process.env.NODE_ENV === 'development') {
  // Expose stores to window for debugging
  (window as any).stores = {
    auth: useAuthStore,
    books: useBooksStore,
    images: useImagesStore,
    reader: useReaderStore,
    ui: useUIStore
  };
  
  // Log state changes
  useAuthStore.subscribe((state, prevState) => {
    console.log('Auth state changed:', { prevState, state });
  });
}
```

---

## Заключение

Система state management BookReader AI обеспечивает:

- **Типобезопасность** на уровне TypeScript
- **Производительность** через селективную подписку и мемоизацию  
- **Persistence** критически важных данных
- **Тестируемость** через dependency injection
- **Developer Experience** с devtools и debugging утилитами
- **Масштабируемость** через разделение на домены

Архитектура готова для расширения дополнительными stores и функциональностью.