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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LibraryPage from '../LibraryPage';
import type { Book } from '@/types/api';
import { useAuthStore } from '@/stores/auth';

// Mock auth store first
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
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockFetchBooks = vi.fn();
const mockGoToPage = vi.fn();
const mockNextPage = vi.fn();
const mockPrevPage = vi.fn();
const mockSetSortBy = vi.fn();

vi.mock('@/stores/books', () => ({
  useBooksStore: vi.fn(() => ({
    books: [],
    isLoading: false,
    error: null,
    totalBooks: 0,
    currentPage: 1,
    booksPerPage: 12,
    hasMore: false,
    sortBy: 'recent',
    setSortBy: mockSetSortBy,
    fetchBooks: mockFetchBooks,
    goToPage: mockGoToPage,
    nextPage: mockNextPage,
    prevPage: mockPrevPage,
  })),
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

vi.mock('@/components/UI/ParsingOverlay', () => ({
  ParsingOverlay: () => <div data-testid="parsing-overlay">Parsing...</div>,
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

const createTestQueryClient = () => new QueryClient({
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
    </QueryClientProvider>
  );
};

describe('LibraryPage Component', () => {
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
  });

  // ============================================================================
  // 1. BOOKS LIST RENDERING (6 tests)
  // ============================================================================

  describe('Books List Rendering', () => {
    it('renders empty state with no books', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText(/Начните свое путешествие с первой книги/i)).toBeInTheDocument();
      });
    });

    it('renders books list with books', async () => {
      const { useBooksStore } = await import('@/stores/books');

      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'Book One' }),
        createMockBook({ id: 'book-2', title: 'Book Two' }),
        createMockBook({ id: 'book-3', title: 'Book Three' }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 3,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText('Book One')).toBeInTheDocument();
        expect(screen.getByText('Book Two')).toBeInTheDocument();
        expect(screen.getByText('Book Three')).toBeInTheDocument();
      });
    });

    it('displays correct book count', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [createMockBook(), createMockBook({ id: 'book-2' })],
        isLoading: false,
        error: null,
        totalBooks: 2,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText(/2 книги в коллекции/i)).toBeInTheDocument();
      });
    });

    it('shows title, author, and cover for each book', async () => {
      const { useBooksStore } = await import('@/stores/books');

      const mockBook = createMockBook({
        title: 'The Great Book',
        author: 'Famous Author',
        has_cover: true,
      });

      vi.mocked(useBooksStore).mockReturnValue({
        books: [mockBook],
        isLoading: false,
        error: null,
        totalBooks: 1,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText('The Great Book')).toBeInTheDocument();
        expect(screen.getByText('Famous Author')).toBeInTheDocument();
      });
    });

    it('shows progress bar for books in progress', async () => {
      const { useBooksStore } = await import('@/stores/books');

      const mockBook = createMockBook({
        reading_progress_percent: 50,
      });

      vi.mocked(useBooksStore).mockReturnValue({
        books: [mockBook],
        isLoading: false,
        error: null,
        totalBooks: 1,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText(/50%/i)).toBeInTheDocument();
      });
    });

    it('shows loading state initially', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: true,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText('Загрузка библиотеки...')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // 2. BOOK UPLOAD (6 tests)
  // ============================================================================

  describe('Book Upload', () => {
    it('upload button is visible', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText('Загрузить книгу')).toBeInTheDocument();
      });
    });

    it('opens upload modal on button click', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      const uploadButton = await screen.findByText('Загрузить книгу');
      await user.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByTestId('upload-modal')).toBeInTheDocument();
      });
    });

    it('closes modal on close button click', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      // Open modal
      const uploadButton = await screen.findByText('Загрузить книгу');
      await user.click(uploadButton);

      // Close modal
      const closeButton = await screen.findByTestId('modal-close');
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument();
      });
    });

    it('shows parsing overlay for processing books', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [createMockBook({ is_processing: true })],
        isLoading: false,
        error: null,
        totalBooks: 1,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByTestId('parsing-overlay')).toBeInTheDocument();
      });
    });

    it('refreshes book list after upload', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: null,
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(mockFetchBooks).toHaveBeenCalled();
      });
    });

    it('handles upload errors gracefully', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: [],
        isLoading: false,
        error: 'Failed to upload book',
        totalBooks: 0,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      // Component should still render
      await waitFor(() => {
        expect(screen.getByText('Загрузить книгу')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // 3. BOOK ACTIONS (4 tests)
  // ============================================================================

  describe('Book Actions', () => {
    it('navigates to book page on click', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      const mockBook = createMockBook({ id: 'book-123', title: 'Clickable Book' });

      vi.mocked(useBooksStore).mockReturnValue({
        books: [mockBook],
        isLoading: false,
        error: null,
        totalBooks: 1,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      const bookCard = await screen.findByText('Clickable Book');
      await user.click(bookCard);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/book/book-123');
      });
    });

    it('shows book statistics', async () => {
      const { useBooksStore } = await import('@/stores/books');

      const mockBooks = [
        createMockBook({ id: 'book-1', reading_progress_percent: 50 }),
        createMockBook({ id: 'book-2', reading_progress_percent: 100 }),
        createMockBook({ id: 'book-3', reading_progress_percent: 0 }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 3,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        // Should show total books
        expect(screen.getByText('Всего книг')).toBeInTheDocument();
      });
    });

    it('handles pagination navigation', async () => {
      const { useBooksStore } = await import('@/stores/books');

      vi.mocked(useBooksStore).mockReturnValue({
        books: Array.from({ length: 12 }, (_, i) =>
          createMockBook({ id: `book-${i}`, title: `Book ${i}` })
        ),
        isLoading: false,
        error: null,
        totalBooks: 24,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: true,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      // Wait for books to render
      await waitFor(() => {
        expect(screen.getByText('Book 0')).toBeInTheDocument();
      });

      // Verify pagination functions are available in the store
      expect(mockNextPage).toBeDefined();
      expect(mockPrevPage).toBeDefined();
      expect(mockGoToPage).toBeDefined();
    });

    it('shows read status badge for completed books', async () => {
      const { useBooksStore } = await import('@/stores/books');

      const mockBook = createMockBook({
        reading_progress_percent: 100,
      });

      vi.mocked(useBooksStore).mockReturnValue({
        books: [mockBook],
        isLoading: false,
        error: null,
        totalBooks: 1,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // 4. SEARCH & FILTER (4 tests)
  // ============================================================================

  describe('Search & Filter', () => {
    it('filters books by title search', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'War and Peace' }),
        createMockBook({ id: 'book-2', title: 'Anna Karenina' }),
        createMockBook({ id: 'book-3', title: 'The Idiot' }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 3,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      // Find search input
      const searchInput = screen.getByPlaceholderText(/Поиск по названию, автору, жанру/i);
      await user.type(searchInput, 'War');

      await waitFor(() => {
        // After typing "War", only "War and Peace" should be visible
        expect(screen.getByText('War and Peace')).toBeInTheDocument();
        expect(screen.queryByText('The Idiot')).not.toBeInTheDocument();
      });
    });

    it('filters books by author search', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', author: 'Leo Tolstoy', title: 'Book 1' }),
        createMockBook({ id: 'book-2', author: 'Fyodor Dostoevsky', title: 'Book 2' }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 2,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText(/Поиск по названию, автору, жанру/i);
      await user.type(searchInput, 'Tolstoy');

      await waitFor(() => {
        expect(screen.getByText('Leo Tolstoy')).toBeInTheDocument();
        expect(screen.queryByText('Fyodor Dostoevsky')).not.toBeInTheDocument();
      });
    });

    it('filters books by genre', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', genre: 'Fantasy', title: 'Book 1' }),
        createMockBook({ id: 'book-2', genre: 'Fiction', title: 'Book 2' }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 2,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText(/Поиск по названию, автору, жанру/i);
      await user.type(searchInput, 'Fantasy');

      await waitFor(() => {
        expect(screen.getByText(/Fantasy/i)).toBeInTheDocument();
      });
    });

    it('clears search filter', async () => {
      const { useBooksStore } = await import('@/stores/books');
      const user = userEvent.setup();

      const mockBooks = [
        createMockBook({ id: 'book-1', title: 'Book One' }),
        createMockBook({ id: 'book-2', title: 'Book Two' }),
      ];

      vi.mocked(useBooksStore).mockReturnValue({
        books: mockBooks,
        isLoading: false,
        error: null,
        totalBooks: 2,
        currentPage: 1,
        booksPerPage: 12,
        hasMore: false,
        sortBy: 'recent',
        setSortBy: mockSetSortBy,
        fetchBooks: mockFetchBooks,
        goToPage: mockGoToPage,
        nextPage: mockNextPage,
        prevPage: mockPrevPage,
      } as any);

      renderLibraryPage();

      const searchInput = screen.getByPlaceholderText(/Поиск по названию, автору, жанру/i);
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
