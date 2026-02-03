/**
 * LibraryPage Component Tests
 *
 * Comprehensive test suite covering:
 * - Books list rendering (6 tests)
 * - Book upload (6 tests)
 * - Book actions (4 tests)
 * - Search & filter (4 tests)
 *
 * Total: 20 tests
 *
 * Mocks TanStack Query hooks (useBooks, useDeleteBook) instead of Zustand store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LibraryPage from '../LibraryPage';
import type { Book } from '@/types/api';
import { useBooks, useDeleteBook } from '@/hooks/api/useBooks';

// Mock TanStack Query hooks
vi.mock('@/hooks/api/useBooks', () => ({
  useBooks: vi.fn(),
  useDeleteBook: vi.fn(),
}));

// Mock auth store — getCurrentUserId reads from it
vi.mock('@/stores/auth', () => ({
  useAuthStore: Object.assign(vi.fn(() => ({
    user: { id: 'test-user-id', email: 'test@example.com' },
    isAuthenticated: true,
  })), {
    getState: vi.fn(() => ({
      user: { id: 'test-user-id', email: 'test@example.com', full_name: 'Test User', is_active: true, is_verified: true, is_admin: false, created_at: '2025-01-01T00:00:00Z' },
      isAuthenticated: true,
    })),
    subscribe: vi.fn(),
    setState: vi.fn(),
    destroy: vi.fn(),
  }),
}));

// Mock queryKeys — getCurrentUserId throws without auth store
vi.mock('@/hooks/api/queryKeys', () => ({
  bookKeys: {
    all: (userId: string) => ['books', userId],
    list: (userId: string) => ['books', userId, 'list'],
    listPaginated: (userId: string, skip: number, limit: number, sortBy?: string) =>
      ['books', userId, 'list', skip, limit, sortBy ?? 'default'],
  },
  getCurrentUserId: () => 'test-user-id',
}));

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/stores/ui', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  useUIStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({ notifications: [] })),
    subscribe: vi.fn(),
    setState: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock('@/components/Books/BookUploadModal', () => ({
  BookUploadModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="upload-modal">
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/Library/DeleteConfirmModal', () => ({
  DeleteConfirmModal: ({
    isOpen,
    bookTitle,
    isDeleting,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    bookTitle: string;
    isDeleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="delete-modal">
        <span data-testid="delete-book-title">{bookTitle}</span>
        <span data-testid="delete-is-deleting">{String(isDeleting)}</span>
        <button onClick={onConfirm} data-testid="delete-confirm">
          Confirm
        </button>
        <button onClick={onCancel} data-testid="delete-cancel">
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/Library/BookGrid', () => ({
  BookGrid: ({
    books,
    isLoading,
    searchQuery,
    onBookClick,
    onClearSearch,
    onUploadClick,
    onDelete,
  }: {
    books: Book[];
    isLoading: boolean;
    searchQuery?: string;
    onBookClick: (id: string) => void;
    onClearSearch?: () => void;
    onUploadClick?: () => void;
    onParsingComplete?: () => void;
    onDelete?: (id: string) => void;
  }) => {
    if (isLoading) {
      return <div data-testid="book-grid-loading">Loading...</div>;
    }
    if (books.length === 0 && searchQuery) {
      return (
        <div data-testid="book-grid-empty-search">
          <span>No results for "{searchQuery}"</span>
          {onClearSearch && (
            <button onClick={onClearSearch} data-testid="clear-search-btn">
              Clear
            </button>
          )}
        </div>
      );
    }
    if (books.length === 0) {
      return (
        <div data-testid="book-grid-empty">
          <span>No books</span>
          {onUploadClick && (
            <button onClick={onUploadClick} data-testid="upload-from-empty">
              Upload
            </button>
          )}
        </div>
      );
    }
    return (
      <div data-testid="book-grid">
        {books.map((book) => (
          <div key={book.id} data-testid={`book-card-${book.id}`}>
            <button onClick={() => onBookClick(book.id)} data-testid={`book-click-${book.id}`}>
              {book.title}
            </button>
            <span data-testid={`book-author-${book.id}`}>{book.author}</span>
            <span data-testid={`book-progress-${book.id}`}>{book.reading_progress_percent}%</span>
            {book.is_processing && <span data-testid={`book-processing-${book.id}`}>Processing</span>}
            {onDelete && (
              <button onClick={() => onDelete(book.id)} data-testid={`book-delete-${book.id}`}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('@/components/SEO/PageMeta', () => ({
  PageMeta: () => null,
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Return recognizable strings for assertions
      const translations: Record<string, string> = {
        'library.title': 'Library',
        'library.upload': 'Upload book',
        'library.search_placeholder': 'Search by title, author, genre...',
        'library.sort.label': 'Sort',
        'library.sort.created_desc': 'Newest first',
        'library.sort.created_asc': 'Oldest first',
        'library.sort.title_asc': 'Title A-Z',
        'library.sort.title_desc': 'Title Z-A',
        'library.sort.author_asc': 'Author A-Z',
        'library.sort.accessed_desc': 'Recently read',
        'library.filter.toggle': 'Filters',
        'library.filter.genre': 'Genre',
        'library.filter.progress': 'Progress',
        'library.filter.reset': 'Reset filters',
        'library.filter.genres.all': 'All genres',
        'library.filter.genres.fiction': 'Fiction',
        'library.filter.genres.non-fiction': 'Non-fiction',
        'library.filter.genres.fantasy': 'Fantasy',
        'library.filter.genres.sci-fi': 'Sci-fi',
        'library.filter.genres.romance': 'Romance',
        'library.filter.genres.mystery': 'Mystery',
        'library.filter.genres.thriller': 'Thriller',
        'library.filter.progress_opts.all': 'All',
        'library.filter.progress_opts.not_started': 'Not started',
        'library.filter.progress_opts.in_progress': 'In progress',
        'library.filter.progress_opts.completed': 'Completed',
        'library.pagination.prev': 'Previous',
        'library.pagination.next': 'Next',
        'library.page_title': 'Library',
        'library.page_description': 'Your book library',
        'library.delete.success': 'Book deleted',
        'library.delete.error': 'Delete error',
        'library.refresh.success': 'Refreshed',
        'library.refresh.error': 'Refresh error',
      };
      if (key.startsWith('library.books_count_')) {
        const count = opts?.count ?? 0;
        return `${count} books`;
      }
      if (key === 'library.processing') {
        return `${opts?.count ?? 0} processing`;
      }
      if (key === 'library.pagination.page') {
        return `Page ${opts?.current ?? 1} of ${opts?.total ?? 1}`;
      }
      return translations[key] || key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  m: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, whileHover: _wh, whileTap: _wt, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock book data
const createMockBook = (overrides?: Partial<Book>): Book => ({
  id: 'book-1',
  title: 'Test Book',
  author: 'Test Author',
  genre: 'Fiction',
  language: 'ru',
  total_pages: 100,
  chapters_count: 10,
  estimated_reading_time_hours: 5,
  reading_progress_percent: 0,
  has_cover: true,
  is_parsed: true,
  is_processing: false,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const mockRefetch = vi.fn();
const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();

/** Configure useBooks mock with given data */
function mockUseBooksReturn(overrides: {
  books?: Book[];
  total?: number;
  isLoading?: boolean;
  error?: Error | null;
}) {
  const { books = [], total, isLoading = false, error = null } = overrides;
  const computedTotal = total ?? books.length;
  vi.mocked(useBooks).mockReturnValue({
    data: books.length > 0 || computedTotal > 0
      ? { books, total: computedTotal, skip: 0, limit: 24 }
      : undefined,
    isLoading,
    error,
    refetch: mockRefetch,
    isFetching: false,
    isSuccess: !isLoading && !error,
    isPending: isLoading,
    isError: !!error,
    status: isLoading ? 'pending' : error ? 'error' : 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isLoadingError: false,
    isFetched: !isLoading,
    isFetchedAfterMount: !isLoading,
    isInitialLoading: isLoading,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isPaused: false,
    isEnabled: true,
    promise: Promise.resolve({} as never),
  } as unknown as ReturnType<typeof useBooks>);
}

/** Configure useDeleteBook mock */
function mockUseDeleteBookReturn(overrides?: { isPending?: boolean }) {
  const { isPending = false } = overrides ?? {};
  vi.mocked(useDeleteBook).mockReturnValue({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isPending,
    isIdle: !isPending,
    isSuccess: false,
    isError: false,
    status: isPending ? 'pending' : 'idle',
    data: undefined,
    error: null,
    variables: undefined,
    failureCount: 0,
    failureReason: null,
    context: undefined,
    reset: vi.fn(),
    submittedAt: 0,
  } as unknown as ReturnType<typeof useDeleteBook>);
}

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderLibraryPage = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LibraryPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
};

describe('LibraryPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks: empty state
    mockUseBooksReturn({ books: [], isLoading: false });
    mockUseDeleteBookReturn();
  });

  // ============================================================================
  // 1. BOOKS LIST RENDERING (6 tests)
  // ============================================================================

  describe('Books List Rendering', () => {
    it('renders empty state with no books', () => {
      mockUseBooksReturn({ books: [], isLoading: false });

      renderLibraryPage();

      expect(screen.getByTestId('book-grid-empty')).toBeInTheDocument();
    });

    it('renders books list with books', () => {
      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'Book One' }),
        createMockBook({ id: 'book-2', title: 'Book Two' }),
        createMockBook({ id: 'book-3', title: 'Book Three' }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 3 });

      renderLibraryPage();

      expect(screen.getByText('Book One')).toBeInTheDocument();
      expect(screen.getByText('Book Two')).toBeInTheDocument();
      expect(screen.getByText('Book Three')).toBeInTheDocument();
    });

    it('displays correct book count', () => {
      mockUseBooksReturn({
        books: [createMockBook(), createMockBook({ id: 'book-2' })],
        total: 2,
      });

      renderLibraryPage();

      expect(screen.getByText('2 books')).toBeInTheDocument();
    });

    it('shows title and author for each book', () => {
      const mockBook = createMockBook({
        title: 'The Great Book',
        author: 'Famous Author',
        has_cover: true,
      });

      mockUseBooksReturn({ books: [mockBook], total: 1 });

      renderLibraryPage();

      expect(screen.getByText('The Great Book')).toBeInTheDocument();
      expect(screen.getByText('Famous Author')).toBeInTheDocument();
    });

    it('shows progress for books in progress', () => {
      const mockBook = createMockBook({
        reading_progress_percent: 50,
      });

      mockUseBooksReturn({ books: [mockBook], total: 1 });

      renderLibraryPage();

      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
      mockUseBooksReturn({ books: [], isLoading: true });

      renderLibraryPage();

      expect(screen.getByTestId('book-grid-loading')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // 2. BOOK UPLOAD (6 tests)
  // ============================================================================

  describe('Book Upload', () => {
    it('upload button is visible', () => {
      renderLibraryPage();

      // Desktop upload button
      expect(screen.getByText('Upload book')).toBeInTheDocument();
    });

    it('opens upload modal on button click', async () => {
      const user = userEvent.setup();

      renderLibraryPage();

      const uploadButton = screen.getByText('Upload book');
      await user.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByTestId('upload-modal')).toBeInTheDocument();
      });
    });

    it('closes modal on close button click', async () => {
      const user = userEvent.setup();

      renderLibraryPage();

      // Open modal
      const uploadButton = screen.getByText('Upload book');
      await user.click(uploadButton);

      // Close modal
      const closeButton = await screen.findByTestId('modal-close');
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument();
      });
    });

    it('shows processing indicator for processing books', () => {
      mockUseBooksReturn({
        books: [createMockBook({ is_processing: true })],
        total: 1,
      });

      renderLibraryPage();

      expect(screen.getByTestId('book-processing-book-1')).toBeInTheDocument();
    });

    it('useBooks is called on mount (auto-fetch)', () => {
      renderLibraryPage();

      expect(useBooks).toHaveBeenCalled();
    });

    it('renders even with error state', () => {
      mockUseBooksReturn({
        books: [],
        isLoading: false,
        error: new Error('Failed to load books'),
      });

      renderLibraryPage();

      // Component should still render upload button
      expect(screen.getByText('Upload book')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // 3. BOOK ACTIONS (4 tests)
  // ============================================================================

  describe('Book Actions', () => {
    it('navigates to book page on click', async () => {
      const user = userEvent.setup();

      const mockBook = createMockBook({ id: 'book-123', title: 'Clickable Book' });
      mockUseBooksReturn({ books: [mockBook], total: 1 });

      renderLibraryPage();

      const bookButton = screen.getByTestId('book-click-book-123');
      await user.click(bookButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/book/book-123');
      });
    });

    it('shows book statistics (progress values)', () => {
      const mockBooks = [
        createMockBook({ id: 'book-1', reading_progress_percent: 50 }),
        createMockBook({ id: 'book-2', reading_progress_percent: 100 }),
        createMockBook({ id: 'book-3', reading_progress_percent: 0 }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 3 });

      renderLibraryPage();

      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('handles pagination when total exceeds page size', () => {
      const books = Array.from({ length: 24 }, (_, i) =>
        createMockBook({ id: `book-${i}`, title: `Book ${i}` }),
      );

      mockUseBooksReturn({ books, total: 48 });

      renderLibraryPage();

      // Pagination should be visible (totalPages = 2)
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    });

    it('shows 100% progress for completed books', () => {
      const mockBook = createMockBook({
        reading_progress_percent: 100,
      });

      mockUseBooksReturn({ books: [mockBook], total: 1 });

      renderLibraryPage();

      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // 4. SEARCH & FILTER (4 tests)
  // ============================================================================

  describe('Search & Filter', () => {
    it('filters books by title search', async () => {
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'War and Peace' }),
        createMockBook({ id: 'book-2', title: 'Anna Karenina' }),
        createMockBook({ id: 'book-3', title: 'The Idiot' }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 3 });

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText('Search by title, author, genre...');
      await user.type(searchInput, 'War');

      await waitFor(() => {
        // useLibraryFilters filters client-side; BookGrid mock shows filtered results
        expect(screen.getByText('War and Peace')).toBeInTheDocument();
        expect(screen.queryByText('The Idiot')).not.toBeInTheDocument();
      });
    });

    it('filters books by author search', async () => {
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', author: 'Leo Tolstoy', title: 'Book 1' }),
        createMockBook({ id: 'book-2', author: 'Fyodor Dostoevsky', title: 'Book 2' }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 2 });

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText('Search by title, author, genre...');
      await user.type(searchInput, 'Tolstoy');

      await waitFor(() => {
        expect(screen.getByText('Leo Tolstoy')).toBeInTheDocument();
        expect(screen.queryByText('Fyodor Dostoevsky')).not.toBeInTheDocument();
      });
    });

    it('filters books by genre search', async () => {
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', genre: 'Fantasy', title: 'Book 1' }),
        createMockBook({ id: 'book-2', genre: 'Fiction', title: 'Book 2' }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 2 });

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText('Search by title, author, genre...');
      await user.type(searchInput, 'Fantasy');

      await waitFor(() => {
        expect(screen.getByText('Book 1')).toBeInTheDocument();
      });
    });

    it('clears search filter', async () => {
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'Book One' }),
        createMockBook({ id: 'book-2', title: 'Book Two' }),
      ];

      mockUseBooksReturn({ books: mockBooks, total: 2 });

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText('Search by title, author, genre...');
      await user.type(searchInput, 'One');
      await user.clear(searchInput);

      await waitFor(() => {
        // Both books should be visible after clearing search
        expect(screen.getByText('Book One')).toBeInTheDocument();
        expect(screen.getByText('Book Two')).toBeInTheDocument();
      });
    });
  });
});
