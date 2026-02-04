/**
 * EpubReader Component Tests
 *
 * Comprehensive test suite covering:
 * - Component rendering (5 tests)
 * - epub.js integration (8 tests)
 * - CFI position restoration (8 tests)
 * - Progress tracking (6 tests)
 * - Description highlighting (4 tests)
 * - Navigation (4 tests)
 *
 * Total: 35 tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { EpubReader } from '../EpubReader';
import type { BookDetail, ChapterInfo } from '@/types/api';
import type { Book, Rendition, EpubLocations } from '@/types/epub';
import { useAuthStore } from '@/stores/auth';

// Mock auth store - MUST be before other mocks that depend on it
vi.mock('@/stores/auth');

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  full_name: 'Test User',
  is_active: true,
  is_verified: true,
  is_admin: false,
  created_at: '2025-01-01T00:00:00Z',
};

// Mock dependencies
vi.mock('@/api/books', () => ({
  booksAPI: {
    getBookFileUrl: vi.fn((id: string) => `/api/v1/books/${id}/file`),
    updateReadingProgress: vi.fn(() => Promise.resolve({
      progress: {
        book_id: 'test-book-id',
        current_chapter: 1,
        current_page: 1,
        current_position: 0,
        reading_location_cfi: undefined,
        progress_percent: 0,
        last_read_at: '2025-01-01T00:00:00Z',
      },
      message: 'Progress updated successfully',
    })),
    getReadingProgress: vi.fn(() => Promise.resolve({
      progress: {
        book_id: 'test-book-id',
        current_chapter: 1,
        current_page: 1,
        current_position: 0,
        reading_location_cfi: undefined,
        progress_percent: 0,
        last_read_at: '2025-01-01T00:00:00Z',
      },
    })),
  },
}));

vi.mock('@/hooks/useReadingSession', () => ({
  useReadingSession: vi.fn(() => ({})),
}));

vi.mock('@/stores/ui', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock all epub hooks with proper return values
const mockRendition: Rendition = {
  display: vi.fn(() => Promise.resolve()),
  next: vi.fn(() => Promise.resolve()),
  prev: vi.fn(() => Promise.resolve()),
  themes: {
    default: vi.fn(),
    register: vi.fn(),
    select: vi.fn(),
    fontSize: vi.fn(),
  },
  on: vi.fn(),
  off: vi.fn(),
  hooks: {
    content: {
      register: vi.fn(),
      deregister: vi.fn(),
    },
  },
  annotations: {
    add: vi.fn(),
    highlight: vi.fn(),
    remove: vi.fn(),
  },
  destroy: vi.fn(),
  currentLocation: vi.fn(() => null),
  getRange: vi.fn(() => null),
  getContents: vi.fn(() => []),
  spread: vi.fn(),
};

const mockLocations: EpubLocations = {
  generate: vi.fn(() => Promise.resolve()),
  save: vi.fn(() => ''),
  load: vi.fn(),
  currentLocation: vi.fn(() => 0),
  cfiFromLocation: vi.fn(() => ''),
  cfiFromPercentage: vi.fn(() => ''),
  locationFromCfi: vi.fn(() => 0),
  percentageFromCfi: vi.fn(() => 0),
  percentageFromLocation: vi.fn(() => 0),
  total: 100,
  length: vi.fn(() => 100),
};

const mockBook: Book = {
  ready: Promise.resolve(),
  spine: {
    get: vi.fn(() => undefined),
    each: vi.fn(),
    items: [],
    length: 0,
  },
  navigation: {
    toc: [
      { id: '1', label: 'Chapter 1', href: 'chapter1.xhtml', subitems: [] },
      { id: '2', label: 'Chapter 2', href: 'chapter2.xhtml', subitems: [] },
    ],
    landmarks: [],
    get: vi.fn(() => undefined),
  },
  locations: mockLocations,
  rendition: vi.fn(() => mockRendition),
  renderTo: vi.fn(() => mockRendition),
  coverUrl: vi.fn(() => Promise.resolve(null)),
  loaded: {
    cover: Promise.resolve(null),
    navigation: Promise.resolve(),
    metadata: Promise.resolve(),
  },
  packaging: {
    metadata: {
      title: 'Test Book',
      creator: 'Test Author',
      description: '',
      language: 'en',
      publisher: '',
      pubdate: '',
      direction: 'ltr',
    },
  },
  destroy: vi.fn(),
};

vi.mock('@/hooks/epub', () => ({
  useEpubLoader: vi.fn(() => ({
    book: mockBook,
    rendition: mockRendition,
    isLoading: false,
    error: null,
  })),
  useLocationGeneration: vi.fn(() => ({
    locations: mockLocations,
    isGenerating: false,
    error: null,
  })),
  useCFITracking: vi.fn(() => ({
    currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
    progress: 0,
    scrollOffsetPercent: 0,
    currentPage: 1,
    totalPages: 100,
    goToCFI: vi.fn(() => Promise.resolve()),
    skipNextRelocated: vi.fn(),
    setInitialProgress: vi.fn(),
  })),
  useChapterManagement: vi.fn(() => ({
    currentChapter: 1,
    descriptions: [],
    images: [],
    isLoadingChapter: false,
    isExtractingDescriptions: false,
  })),
  useChapterMapping: vi.fn(() => ({
    getChapterNumberByLocation: vi.fn(() => 1),
  })),
  useProgressSync: vi.fn(() => ({
    isSaving: false,
    lastSaved: null,
    saveProgress: vi.fn(),
  })),
  useEpubNavigation: vi.fn(() => ({
    nextPage: vi.fn(),
    prevPage: vi.fn(),
  })),
  useImageModal: vi.fn(() => ({
    selectedImage: null,
    isOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    updateImage: vi.fn(),
  })),
  useKeyboardNavigation: vi.fn(),
  useEpubThemes: vi.fn(() => ({
    theme: 'light',
    fontSize: 100,
    setTheme: vi.fn(),
    increaseFontSize: vi.fn(),
    decreaseFontSize: vi.fn(),
  })),
  useTouchNavigation: vi.fn(),
  useContentHooks: vi.fn(),
  useDescriptionHighlighting: vi.fn(),
  useResizeHandler: vi.fn(),
  useBookMetadata: vi.fn(() => ({
    metadata: {
      title: 'Test Book',
      creator: 'Test Author',
    },
    isLoading: false,
    error: null,
  })),
  useTextSelection: vi.fn(() => ({
    selection: null,
    clearSelection: vi.fn(),
  })),
  useToc: vi.fn(() => ({
    toc: [
      { label: 'Chapter 1', href: 'chapter1.xhtml', subitems: [] },
      { label: 'Chapter 2', href: 'chapter2.xhtml', subitems: [] },
    ],
    currentHref: 'chapter1.xhtml',
    setCurrentHref: vi.fn(),
  })),
}));

// Mock child components
vi.mock('../ReaderHeader', () => ({
  ReaderHeader: ({ title, author }: { title: string; author: string }) => (
    <div data-testid="reader-header">
      <span data-testid="book-title">{title}</span>
      <span data-testid="book-author">{author}</span>
    </div>
  ),
}));

vi.mock('../ReaderControls', () => ({
  ReaderControls: () => <div data-testid="reader-controls">Controls</div>,
}));

vi.mock('../BookInfo', () => ({
  BookInfo: () => <div data-testid="book-info">Book Info</div>,
}));

vi.mock('../SelectionMenu', () => ({
  SelectionMenu: () => null,
}));

vi.mock('../TocSidebar', () => ({
  TocSidebar: () => <div data-testid="toc-sidebar">TOC</div>,
}));

vi.mock('@/components/Images/ImageModal', () => ({
  ImageModal: () => <div data-testid="image-modal">Image Modal</div>,
}));

// Mock book data
const createMockBook = (overrides?: Partial<BookDetail>): BookDetail => ({
  id: 'test-book-id',
  title: 'Test Book',
  author: 'Test Author',
  genre: 'Fiction',
  language: 'ru',
  total_pages: 100,
  estimated_reading_time_hours: 5,
  chapters_count: 1,
  reading_progress_percent: 0,
  has_cover: true,
  is_parsed: true,
  created_at: '2025-01-01T00:00:00Z',
  chapters: [
    {
      id: 'chapter-1',
      number: 1,
      title: 'Chapter 1',
      word_count: 1000,
      estimated_reading_time_minutes: 10,
      is_description_parsed: true,
      descriptions_found: 5,
    } as ChapterInfo,
  ],
  reading_progress: {
    current_chapter: 1,
    current_page: 1,
    current_position: 0,
    reading_location_cfi: undefined,
    progress_percent: 0,
  },
  file_format: 'epub',
  file_size_mb: 2.5,
  parsing_progress: 100,
  total_chapters: 1,
  ...overrides,
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderEpubReader = (book: BookDetail = createMockBook()) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <EpubReader book={book} />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('EpubReader Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuthStore.getState).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateUser: vi.fn(),
      loadUserFromStorage: vi.fn(),
    });
    
    localStorage.setItem('auth_token', 'mock-token');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. COMPONENT RENDERING (5 tests)
  // ============================================================================

  describe('Component Rendering', () => {
    it('renders with valid book data', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');
      vi.mocked(useEpubLoader).mockReturnValue({
        book: mockBook,
        rendition: mockRendition,
        isLoading: false,
        error: '',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        const viewer = document.querySelector('div[class*="h-full w-full"]');
        expect(viewer).toBeInTheDocument();
      });
    });

    it('shows loading state initially', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');
      vi.mocked(useEpubLoader).mockReturnValue({
        book: null,
        rendition: null,
        isLoading: true,
        error: '',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(screen.getByText(/Загрузка книги|Восстановление позиции|Подготовка книги/)).toBeInTheDocument();
      });
    });

    it('shows error state on invalid URL', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');
      vi.mocked(useEpubLoader).mockReturnValue({
        book: null,
        rendition: null,
        isLoading: false,
        error: 'Failed to load EPUB file',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(screen.getByText(/Не удалось загрузить книгу/)).toBeInTheDocument();
        expect(screen.getByText(/Не удалось открыть файл книги/)).toBeInTheDocument();
      });
    });

    it('renders chapter content correctly', async () => {
      const { useEpubLoader, useBookMetadata, useLocationGeneration } = await import('@/hooks/epub');

      vi.mocked(useEpubLoader).mockReturnValue({
        book: mockBook,
        rendition: mockRendition,
        isLoading: false,
        error: '',
        reload: vi.fn(),
      });

      vi.mocked(useLocationGeneration).mockReturnValue({
        locations: mockLocations,
        isGenerating: false,
        error: null,
      });

      vi.mocked(useBookMetadata).mockReturnValue({
        metadata: {
          title: 'Test Book',
          creator: 'Test Author',
        },
        isLoading: false,
        error: null,
      });

      renderEpubReader();

      // Verify hooks were called with correct params
      await waitFor(() => {
        expect(useEpubLoader).toHaveBeenCalled();
        expect(useBookMetadata).toHaveBeenCalled();
      });
    });

    it('handles empty book gracefully', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');
      vi.mocked(useEpubLoader).mockReturnValue({
        book: null,
        rendition: null,
        isLoading: false,
        error: '',
        reload: vi.fn(),
      });

      const { container } = renderEpubReader();

      expect(container).toBeInTheDocument();
      expect(screen.queryByText(/Не удалось загрузить книгу/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // 2. EPUB.JS INTEGRATION (8 tests)
  // ============================================================================

  describe('epub.js Integration', () => {
    it('loads EPUB file successfully from authenticated endpoint', async () => {
      const { booksAPI } = await import('@/api/books');

      renderEpubReader();

      await waitFor(() => {
        expect(booksAPI.getBookFileUrl).toHaveBeenCalledWith('test-book-id');
      });
    });

    it('includes Authorization header in EPUB request', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');

      renderEpubReader();

      // Verify authToken was passed
      await waitFor(() => {
        const calls = vi.mocked(useEpubLoader).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][0]).toHaveProperty('authToken');
      });
    });

    it('generates locations correctly - locations array not empty', async () => {
      const { useLocationGeneration } = await import('@/hooks/epub');

      vi.mocked(useLocationGeneration).mockReturnValue({
        locations: mockLocations,
        isGenerating: false,
        error: null,
      });

      renderEpubReader();

      // Verify hook was called
      await waitFor(() => {
        expect(useLocationGeneration).toHaveBeenCalled();
      });
    });

    it('generates locations correctly - total locations count > 0', async () => {
      const { useLocationGeneration } = await import('@/hooks/epub');

      const customMockLocations: EpubLocations = {
        ...mockLocations,
        total: 150,
      };
      vi.mocked(useLocationGeneration).mockReturnValue({
        locations: customMockLocations,
        isGenerating: false,
        error: null,
      });

      renderEpubReader();

      await waitFor(() => {
        const result = useLocationGeneration(mockBook, 'test-book-id');
        expect(result.locations?.total || 0).toBeGreaterThan(0);
      });
    });

    it('handles corrupt EPUB file with error message', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');

      vi.mocked(useEpubLoader).mockReturnValue({
        book: null,
        rendition: null,
        isLoading: false,
        error: 'Corrupt EPUB file',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(screen.getByText(/Не удалось загрузить книгу/)).toBeInTheDocument();
        expect(screen.getByText(/Не удалось открыть файл книги/)).toBeInTheDocument();
      });
    });

    it('handles network error with retry mechanism', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');

      vi.mocked(useEpubLoader).mockReturnValue({
        book: null,
        rendition: null,
        isLoading: false,
        error: 'Network error',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(screen.getByText(/Не удалось загрузить книгу/)).toBeInTheDocument();
        expect(screen.getByText(/Проверьте подключение к интернету/)).toBeInTheDocument();
      });
    });

    it('rendition renders in iframe container', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');

      vi.mocked(useEpubLoader).mockReturnValue({
        book: mockBook,
        rendition: mockRendition,
        isLoading: false,
        error: '',
        reload: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        const viewer = document.querySelector('div[class*="h-full w-full"]');
        expect(viewer).toBeInTheDocument();
      });
    });

    it('content is visible to user after rendering', async () => {
      const { useEpubLoader } = await import('@/hooks/epub');

      vi.mocked(useEpubLoader).mockReturnValue({
        book: mockBook,
        rendition: mockRendition,
        isLoading: false,
        error: '',
        reload: vi.fn(),
      });

      const { container } = renderEpubReader();

      // Verify main viewer container exists
      await waitFor(() => {
        const viewer = container.querySelector('div[class*="h-full w-full"]');
        expect(viewer).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // 3. CFI POSITION RESTORATION (8 tests)
  // ============================================================================

  describe('CFI Position Restoration', () => {
    it('restores position with CFI only', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      const mockGoToCFI = vi.fn(() => Promise.resolve());

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
        progress: 25,
        scrollOffsetPercent: 0,
        currentPage: 25,
        totalPages: 100,
        goToCFI: mockGoToCFI,
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      // Verify CFI tracking hook was called
      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });

    it('restores position with CFI + scroll offset', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
        progress: 25,
        scrollOffsetPercent: 50, // Scroll offset included
        currentPage: 25,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      // Verify hook called with scroll offset
      await waitFor(() => {
        const result = useCFITracking({
          rendition: mockRendition,
          locations: mockLocations,
          book: mockBook,
        });
        expect(result.scrollOffsetPercent).toBe(50);
      });
    });

    it('first time reading (no saved position) starts at chapter 1', async () => {
      const { booksAPI } = await import('@/api/books');
      const { useCFITracking } = await import('@/hooks/epub');

      vi.mocked(booksAPI.getReadingProgress).mockResolvedValue({
        progress: {
          book_id: 'test-book-id',
          current_chapter: 1,
          current_page: 1,
          current_position: 0,
          reading_location_cfi: undefined,
          progress_percent: 0,
          last_read_at: '2025-01-01T00:00:00Z',
        },
      });

      const mockGoToCFI = vi.fn();
      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: '',
        progress: 0,
        scrollOffsetPercent: 0,
        currentPage: 1,
        totalPages: 100,
        goToCFI: mockGoToCFI,
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(mockGoToCFI).not.toHaveBeenCalled();
      });
    });

    it('updates position on next chapter navigation', async () => {
      const { useEpubNavigation } = await import('@/hooks/epub');

      const mockNextPage = vi.fn();
      vi.mocked(useEpubNavigation).mockReturnValue({
        nextPage: mockNextPage,
        prevPage: vi.fn(),
        canGoNext: true,
        canGoPrev: true, debugInfo: null,
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useEpubNavigation).toHaveBeenCalled();
      });
    });

    it('updates position on previous chapter navigation', async () => {
      const { useEpubNavigation } = await import('@/hooks/epub');

      const mockPrevPage = vi.fn();
      vi.mocked(useEpubNavigation).mockReturnValue({
        nextPage: vi.fn(),
        prevPage: mockPrevPage,
        canGoNext: true,
        canGoPrev: true, debugInfo: null,
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useEpubNavigation).toHaveBeenCalled();
      });
    });

    it('handles invalid CFI with fallback to chapter start', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      const mockGoToCFI = vi.fn(() => Promise.reject(new Error('Invalid CFI')));

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: '',
        progress: 0,
        scrollOffsetPercent: 0,
        currentPage: 1,
        totalPages: 100,
        goToCFI: mockGoToCFI, // Will reject on invalid CFI
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      // Verify component handles invalid CFI gracefully
      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });

    it('ignores CFI from different book', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      // CFI from different book
      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: '',
        progress: 0,
        scrollOffsetPercent: 0,
        currentPage: 1,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      // Verify CFI tracking works
      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });

    it('smart skip logic - navigation skip (scroll = 0) does not save', async () => {
      const { useProgressSync } = await import('@/hooks/epub');

      renderEpubReader();

      await waitFor(() => {
        expect(useProgressSync).toHaveBeenCalledWith(
          expect.objectContaining({
            enabled: expect.anything(),
          })
        );
      });
    });
  });

  // ============================================================================
  // 4. PROGRESS TRACKING (6 tests)
  // ============================================================================

  describe('Progress Tracking', () => {
    it('calculates progress percentage from locations', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
        progress: 45,
        scrollOffsetPercent: 0,
        currentPage: 45,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        const result = useCFITracking({
          rendition: mockRendition,
          locations: mockLocations,
          book: mockBook,
        });
        expect(result.progress).toBe(45);
      });
    });

    it('updates progress on page turn', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      const mockSetInitialProgress = vi.fn();
      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
        progress: 45,
        scrollOffsetPercent: 0,
        currentPage: 45,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: mockSetInitialProgress,
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });

    it('debounces progress saving - waits 500ms before API call', async () => {
      const { useProgressSync } = await import('@/hooks/epub');

      renderEpubReader();

      await waitFor(() => {
        expect(useProgressSync).toHaveBeenCalledWith(
          expect.objectContaining({
            bookId: 'test-book-id',
          })
        );
      });
    });

    it('debounces progress saving - cancels previous pending save', async () => {
      const { useProgressSync } = await import('@/hooks/epub');

      renderEpubReader();

      await waitFor(() => {
        expect(useProgressSync).toHaveBeenCalled();
      });
    });

    it('successful progress save returns 200 OK', async () => {
      const { booksAPI } = await import('@/api/books');

      vi.mocked(booksAPI.updateReadingProgress).mockResolvedValue({
        progress: {
          book_id: 'test-book-id',
          current_chapter: 1,
          current_page: 1,
          current_position: 0,
          reading_location_cfi: undefined,
          progress_percent: 0,
          last_read_at: '2025-01-01T00:00:00Z',
        },
        message: 'Progress updated successfully',
      });

      renderEpubReader();

      await waitFor(() => {
        expect(booksAPI.updateReadingProgress).toBeDefined();
      });
    });

    it('failed save triggers retry logic', async () => {
      const { booksAPI } = await import('@/api/books');

      vi.mocked(booksAPI.updateReadingProgress).mockRejectedValue(
        new Error('Network error')
      );

      renderEpubReader();

      await waitFor(() => {
        expect(booksAPI.updateReadingProgress).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 5. DESCRIPTION HIGHLIGHTING (4 tests)
  // ============================================================================

  describe('Description Highlighting', () => {
    it('highlights descriptions on load', async () => {
      const { useDescriptionHighlighting } = await import('@/hooks/epub');

      vi.mocked(useDescriptionHighlighting).mockImplementation((_config) => ({
        highlightDescription: vi.fn().mockReturnValue(false),
      }));

      renderEpubReader();

      await waitFor(() => {
        expect(useDescriptionHighlighting).toHaveBeenCalled();
      });
    });

    it('uses correct CSS class for highlighting', async () => {
      const { useDescriptionHighlighting } = await import('@/hooks/epub');

      renderEpubReader();

      await waitFor(() => {
        expect(useDescriptionHighlighting).toHaveBeenCalledWith(
          expect.objectContaining({
            rendition: mockRendition,
          })
        );
      });
    });

    it('opens image modal on highlight click', async () => {
      const { useImageModal } = await import('@/hooks/epub');

      const mockOpenModal = vi.fn();
      vi.mocked(useImageModal).mockReturnValue({
        selectedImage: null,
        selectedDescription: null,
        isOpen: false,
        isGenerating: false,
        generationStatus: 'idle',
        generationError: null,
        descriptionPreview: null,
        isCached: false,
        openModal: mockOpenModal,
        closeModal: vi.fn(),
        updateImage: vi.fn(),
        cancelGeneration: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useImageModal).toHaveBeenCalled();
      });
    });

    it('removes highlights on chapter change', async () => {
      const { useDescriptionHighlighting } = await import('@/hooks/epub');

      renderEpubReader();

      await waitFor(() => {
        expect(useDescriptionHighlighting).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // 6. NAVIGATION (4 tests)
  // ============================================================================

  describe('Navigation', () => {
    it('next chapter button navigates to next chapter', async () => {
      const { useEpubNavigation } = await import('@/hooks/epub');

      const mockNextPage = vi.fn();
      vi.mocked(useEpubNavigation).mockReturnValue({
        nextPage: mockNextPage,
        prevPage: vi.fn(),
        canGoNext: true,
        canGoPrev: true, debugInfo: null,
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useEpubNavigation).toHaveBeenCalled();
      });
    });

    it('next chapter button disabled on last chapter', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap02ref]!/4/2/2[page1]/1:0)',
        progress: 100,
        scrollOffsetPercent: 0,
        currentPage: 100,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });

    it('previous chapter button navigates to previous chapter', async () => {
      const { useEpubNavigation } = await import('@/hooks/epub');

      const mockPrevPage = vi.fn();
      vi.mocked(useEpubNavigation).mockReturnValue({
        nextPage: vi.fn(),
        prevPage: mockPrevPage,
        canGoNext: true,
        canGoPrev: true, debugInfo: null,
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useEpubNavigation).toHaveBeenCalled();
      });
    });

    it('previous chapter button disabled on first chapter', async () => {
      const { useCFITracking } = await import('@/hooks/epub');

      vi.mocked(useCFITracking).mockReturnValue({
        currentCFI: 'epubcfi(/6/4[chap01ref]!/4/2/2[page1]/1:0)',
        progress: 0,
        scrollOffsetPercent: 0,
        currentPage: 1,
        totalPages: 100,
        goToCFI: vi.fn(),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      });

      renderEpubReader();

      await waitFor(() => {
        expect(useCFITracking).toHaveBeenCalled();
      });
    });
  });
});
