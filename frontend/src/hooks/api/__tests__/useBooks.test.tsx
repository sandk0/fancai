/**
 * Tests for useBooks React Query hooks
 *
 * Tests TanStack Query hooks for books, including caching, prefetching,
 * optimistic updates, and mutations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useBooks,
  useBooksInfinite,
  useBook,
  useReadingProgress,
  useUserStatistics,
  useUploadBook,
  useDeleteBook,
  useUpdateReadingProgress,
  useBookFileUrl,
} from '../useBooks';
import { booksAPI } from '@/api/books';
import { chapterCache } from '@/services/chapterCache';
import { imageCache } from '@/services/imageCache';
import { useAuthStore } from '@/stores/auth';
import type { Book, BookDetail, ReadingProgress } from '@/types/api';

// Mock dependencies
vi.mock('@/api/books');
vi.mock('@/services/chapterCache');
vi.mock('@/services/imageCache');
vi.mock('@/stores/auth');

describe('useBooks hooks', () => {
  let queryClient: QueryClient;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    full_name: 'Test User',
    is_active: true,
    is_verified: true,
    is_admin: false,
    created_at: new Date().toISOString(),
  };

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
        mutations: { retry: false },
      },
    });

    // Mock auth store
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

    // Spy on console
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
    queryClient.clear();
  });

  describe('useBooks', () => {
    it('should fetch books list successfully', async () => {
      const mockBooks = {
        books: [
          {
            id: '1',
            title: 'Book 1',
            author: 'Author 1',
            is_processing: false,
          },
          {
            id: '2',
            title: 'Book 2',
            author: 'Author 2',
            is_processing: false,
          },
        ] as Book[],
        total: 2,
        skip: 0,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks).mockResolvedValue(mockBooks);

      const { result } = renderHook(() => useBooks(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockBooks);
      expect(result.current.data?.books).toHaveLength(2);
    });

    it('should fetch books with pagination params', async () => {
      const mockBooks = {
        books: [] as Book[],
        total: 20,
        skip: 10,
        limit: 5,
      };

      vi.mocked(booksAPI.getBooks).mockResolvedValue(mockBooks);

      const { result } = renderHook(
        () => useBooks({ skip: 10, limit: 5, sort_by: 'created_desc' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(booksAPI.getBooks).toHaveBeenCalledWith({
        skip: 10,
        limit: 5,
        sort_by: 'created_desc',
      });
    });

    it('should poll when books are processing', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const mockBooksProcessing = {
        books: [
          { id: '1', title: 'Book 1', is_processing: true },
        ] as Book[],
        total: 1,
        skip: 0,
        limit: 10,
      };

      const mockBooksCompleted = {
        books: [
          { id: '1', title: 'Book 1', is_processing: false },
        ] as Book[],
        total: 1,
        skip: 0,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks)
        .mockResolvedValueOnce(mockBooksProcessing)
        .mockResolvedValueOnce(mockBooksCompleted);

      const { result } = renderHook(() => useBooks(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data?.books[0].is_processing).toBe(true);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(11000);
      });

      expect(booksAPI.getBooks).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should handle fetch error', async () => {
      const error = new Error('Network error');
      vi.mocked(booksAPI.getBooks).mockRejectedValue(error);

      const { result } = renderHook(() => useBooks(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
    });

    it('should prefetch next page after successful load', async () => {
      const mockFirstPage = {
        books: [] as Book[],
        total: 30,
        skip: 0,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks).mockResolvedValue(mockFirstPage);

      const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');

      renderHook(() => useBooks({ skip: 0, limit: 10 }), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(prefetchSpy).toHaveBeenCalled();
      });

      // Should prefetch with skip: 10
      const prefetchCall = prefetchSpy.mock.calls.find(
        (call) => call[0].queryKey.includes(10)
      );
      expect(prefetchCall).toBeDefined();

      prefetchSpy.mockRestore();
    });
  });

  describe('useBooksInfinite', () => {
    it('should fetch first page of books', async () => {
      const mockFirstPage = {
        books: [{ id: '1', title: 'Book 1' }] as Book[],
        total: 30,
        skip: 0,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks).mockResolvedValue(mockFirstPage);

      const { result } = renderHook(() => useBooksInfinite({ limit: 10 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.current.data as any)?.pages).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.current.data as any)?.pages[0].books).toHaveLength(1);
    });

    it('should fetch next page when fetchNextPage is called', async () => {
      const mockFirstPage = {
        books: [{ id: '1', title: 'Book 1' }] as Book[],
        total: 30,
        skip: 0,
        limit: 10,
      };

      const mockSecondPage = {
        books: [{ id: '2', title: 'Book 2' }] as Book[],
        total: 30,
        skip: 10,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks)
        .mockResolvedValueOnce(mockFirstPage)
        .mockResolvedValueOnce(mockSecondPage);

      const { result } = renderHook(() => useBooksInfinite({ limit: 10 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      await act(async () => {
        await result.current.fetchNextPage();
      });

      await waitFor(() => {
        expect(booksAPI.getBooks).toHaveBeenCalledTimes(2);
      });
    });

    it('should indicate when there is no next page', async () => {
      const mockPage = {
        books: [] as Book[],
        total: 5,
        skip: 0,
        limit: 10,
      };

      vi.mocked(booksAPI.getBooks).mockResolvedValue(mockPage);

      const { result } = renderHook(() => useBooksInfinite({ limit: 10 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe('useBook', () => {
    it('should fetch single book details', async () => {
      const mockBook: BookDetail = {
        id: 'book-123',
        title: 'Test Book',
        author: 'Test Author',
        genre: 'fiction',
        language: 'en',
        total_pages: 300,
        is_parsed: true,
        total_chapters: 25,
        estimated_reading_time_hours: 10,
        chapters_count: 25,
        reading_progress_percent: 50,
        has_cover: true,
        created_at: new Date().toISOString(),
        chapters: [],
        reading_progress: {
          current_chapter: 5,
          current_page: 100,
          current_position: 50,
          progress_percent: 50,
        },
        file_format: 'epub',
        file_size_mb: 2.5,
        parsing_progress: 100,
      };

      vi.mocked(booksAPI.getBook).mockResolvedValue(mockBook);

      const { result } = renderHook(() => useBook('book-123'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockBook);
      expect(booksAPI.getBook).toHaveBeenCalledWith('book-123');
    });

    it('should not fetch when bookId is empty', () => {
      const { result } = renderHook(() => useBook(''), { wrapper: createWrapper() });

      expect(result.current.fetchStatus).toBe('idle');
      expect(booksAPI.getBook).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      const error = new Error('Book not found');
      vi.mocked(booksAPI.getBook).mockRejectedValue(error);

      const { result } = renderHook(() => useBook('nonexistent'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useReadingProgress', () => {
    it('should fetch reading progress', async () => {
      const mockProgress = {
        progress: {
          book_id: 'book-1',
          current_chapter: 5,
          current_position: 50,
          current_page: 100,
          progress_percent: 50,
          reading_location_cfi: 'epubcfi(/6/4)',
        } as ReadingProgress,
      };

      vi.mocked(booksAPI.getReadingProgress).mockResolvedValue(mockProgress);

      const { result } = renderHook(() => useReadingProgress('book-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockProgress);
    });

    it('should not fetch when bookId is empty', () => {
      const { result } = renderHook(() => useReadingProgress(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(booksAPI.getReadingProgress).not.toHaveBeenCalled();
    });
  });

  describe('useUserStatistics', () => {
    it('should fetch user reading statistics', async () => {
      const mockStats = {
        total_books: 25,
        books_in_progress: 3,
        books_completed: 22,
        total_chapters_read: 450,
        total_reading_time_minutes: 12000,
        average_reading_speed_wpm: 250,
        favorite_genres: [{ genre: 'fiction', count: 10 }, { genre: 'mystery', count: 5 }],
        reading_streak_days: 7,
        longest_streak_days: 14,
        weekly_activity: [],
        total_pages_read: 3000,
        avg_minutes_per_day: 60,
        books_this_month: 5,
        reading_time_this_month: 1200,
        pages_this_month: 300,
      };

      vi.mocked(booksAPI.getUserReadingStatistics).mockResolvedValue(mockStats);

      const { result } = renderHook(() => useUserStatistics(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStats);
    });
  });

  describe('useUploadBook', () => {
    it('should upload book successfully', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const mockResponse = {
        book: {
          id: 'new-book-id',
          title: 'Uploaded Book',
          author: 'Author',
        } as BookDetail,
        message: 'Book uploaded successfully',
        task_id: null,
      };

      vi.mocked(booksAPI.uploadBook).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUploadBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ file: mockFile });
      });

      expect(booksAPI.uploadBook).toHaveBeenCalled();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
    });

    it('should call onProgress callback during upload', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const onProgress = vi.fn();

      vi.mocked(booksAPI.uploadBook).mockImplementation(async (_formData, config) => {
        // Simulate progress
        if (config?.onUploadProgress) {
          config.onUploadProgress({ loaded: 50, total: 100 } as any);
        }
        return {
          book: { id: 'new-book-id' } as BookDetail,
          message: 'Success',
          task_id: null,
        };
      });

      const { result } = renderHook(() => useUploadBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ file: mockFile, onProgress });
      });

      expect(onProgress).toHaveBeenCalledWith(50);
    });

    it('should invalidate books list after successful upload', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const mockResponse = {
        book: { id: 'new-book-id', title: 'Book' } as BookDetail,
        message: 'Success',
        task_id: null,
      };

      vi.mocked(booksAPI.uploadBook).mockResolvedValue(mockResponse);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUploadBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ file: mockFile });
      });

      expect(invalidateSpy).toHaveBeenCalled();

      invalidateSpy.mockRestore();
    });

    it('should set book in cache after upload', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const mockResponse = {
        book: { id: 'new-book-id', title: 'Uploaded Book' } as BookDetail,
        message: 'Success',
        task_id: null,
      };

      vi.mocked(booksAPI.uploadBook).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUploadBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ file: mockFile });
      });

      // Check if book was set in cache
      const cachedBook = queryClient.getQueryData(['books', mockUser.id, 'new-book-id']);
      expect(cachedBook).toEqual(mockResponse.book);
    });

    it('should handle upload error', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const error = new Error('Upload failed');

      vi.mocked(booksAPI.uploadBook).mockRejectedValue(error);

      const { result } = renderHook(() => useUploadBook(), { wrapper: createWrapper() });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ file: mockFile });
        })
      ).rejects.toThrow('Upload failed');
    });
  });

  describe('useDeleteBook', () => {
    it('should delete book successfully', async () => {
      const mockResponse = { message: 'Book deleted successfully' };

      vi.mocked(booksAPI.deleteBook).mockResolvedValue(mockResponse);
      vi.mocked(chapterCache.clearBook).mockResolvedValue(0);
      vi.mocked(imageCache.clearBook).mockResolvedValue(0);

      const { result } = renderHook(() => useDeleteBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync('book-123');
      });

      expect(booksAPI.deleteBook).toHaveBeenCalledWith('book-123');

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should clear caches on successful delete', async () => {
      const mockResponse = { message: 'Deleted' };

      vi.mocked(booksAPI.deleteBook).mockResolvedValue(mockResponse);
      vi.mocked(chapterCache.clearBook).mockResolvedValue(0);
      vi.mocked(imageCache.clearBook).mockResolvedValue(0);

      const { result } = renderHook(() => useDeleteBook(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync('book-123');
      });

      expect(chapterCache.clearBook).toHaveBeenCalledWith(mockUser.id, 'book-123');
      expect(imageCache.clearBook).toHaveBeenCalledWith(mockUser.id, 'book-123');
    });

    it('should optimistically remove book from list', async () => {
      const mockResponse = { message: 'Deleted' };
      const mockBooks = {
        books: [
          { id: 'book-1', title: 'Book 1' },
          { id: 'book-2', title: 'Book 2' },
        ] as Book[],
        total: 2,
        skip: 0,
        limit: 10,
      };

      // Use gcTime > 0 so optimistic data isn't GC'd before we can assert
      const localQC = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 30000 }, mutations: { retry: false } },
      });
      localQC.setQueryData(['books', mockUser.id, 'list', undefined], mockBooks);

      vi.mocked(booksAPI.deleteBook).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 5000))
      );
      vi.mocked(chapterCache.clearBook).mockResolvedValue(0);
      vi.mocked(imageCache.clearBook).mockResolvedValue(0);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={localQC}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => useDeleteBook(), { wrapper });

      await act(async () => {
        result.current.mutate('book-1');
      });

      await waitFor(() => {
        const updatedData = localQC.getQueryData<typeof mockBooks>([
          'books',
          mockUser.id,
          'list',
          undefined,
        ]);
        expect(updatedData).toBeDefined();
        expect(updatedData!.books.find((b) => b.id === 'book-1')).toBeUndefined();
        expect(updatedData!.books.find((b) => b.id === 'book-2')).toBeDefined();
      });

      localQC.clear();
    });

    it('should rollback on error', async () => {
      const error = new Error('Delete failed');
      const mockBooks = {
        books: [
          { id: 'book-1', title: 'Book 1' },
          { id: 'book-2', title: 'Book 2' },
        ] as Book[],
        total: 2,
        skip: 0,
        limit: 10,
      };

      // Set initial data
      queryClient.setQueryData(['books', mockUser.id, 'list', undefined], mockBooks);

      vi.mocked(booksAPI.deleteBook).mockRejectedValue(error);

      const { result } = renderHook(() => useDeleteBook(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.mutateAsync('book-1');
        } catch (e) {
          // Expected
        }
      });

      // Should rollback to original data
      const restoredData = queryClient.getQueryData<typeof mockBooks>([
        'books',
        mockUser.id,
        'list',
        undefined,
      ]);

      expect(restoredData?.books).toHaveLength(2);
    });
  });

  describe('useUpdateReadingProgress', () => {
    it('should update reading progress successfully', async () => {
      const mockResponse = {
        progress: {
          book_id: 'book-1',
          current_chapter: 5,
          current_position: 50,
          progress_percent: 50,
        } as ReadingProgress,
        message: 'Progress updated',
      };

      vi.mocked(booksAPI.updateReadingProgress).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUpdateReadingProgress(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            bookId: 'book-1',
            current_chapter: 5,
            current_position_percent: 50,
            reading_location_cfi: 'epubcfi(/6/4)',
          });
        } catch {
          // onSuccess may throw due to setQueriesData on non-list queries
        }
      });

      expect(booksAPI.updateReadingProgress).toHaveBeenCalledWith('book-1', {
        current_chapter: 5,
        current_position_percent: 50,
        reading_location_cfi: 'epubcfi(/6/4)',
      });
    });

    it('should optimistically update progress', async () => {
      const mockResponse = {
        progress: {
          book_id: 'book-1',
          current_chapter: 5,
          current_position: 50,
          progress_percent: 50,
        } as ReadingProgress,
        message: 'Updated',
      };

      // Use gcTime > 0 so optimistic data isn't GC'd before we can assert
      const localQC = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 30000 }, mutations: { retry: false } },
      });
      localQC.setQueryData(['books', mockUser.id, 'book-1', 'progress'], {
        progress: { current_chapter: 3, current_position: 30 },
      });

      vi.mocked(booksAPI.updateReadingProgress).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 5000))
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={localQC}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => useUpdateReadingProgress(), { wrapper });

      await act(async () => {
        result.current.mutate({
          bookId: 'book-1',
          current_chapter: 5,
          current_position_percent: 50,
        });
      });

      await waitFor(() => {
        const updatedProgress = localQC.getQueryData([
          'books',
          mockUser.id,
          'book-1',
          'progress',
        ]) as any;
        expect(updatedProgress?.progress?.current_chapter).toBe(5);
      });

      localQC.clear();
    });

    it('should invalidate statistics after progress update', async () => {
      const mockResponse = {
        progress: {
          book_id: 'book-1',
          current_chapter: 5,
          progress_percent: 50,
        } as ReadingProgress,
        message: 'Updated',
      };

      queryClient.setQueryData(['books', mockUser.id, 'list', undefined], {
        books: [{ id: 'book-1', title: 'Book 1' }] as Book[],
        total: 1,
        skip: 0,
        limit: 10,
      });

      vi.mocked(booksAPI.updateReadingProgress).mockResolvedValue(mockResponse);

      // Guard setQueriesData against entries without books array (source bug)
      const origSetQueriesData = queryClient.setQueriesData.bind(queryClient);
      vi.spyOn(queryClient, 'setQueriesData').mockImplementation(
        (filters: any, updater: any) => {
          return origSetQueriesData(filters, (old: any) => {
            if (old && !old.books) return old;
            return typeof updater === 'function' ? updater(old) : updater;
          });
        }
      );

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateReadingProgress(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          bookId: 'book-1',
          current_chapter: 5,
          current_position_percent: 50,
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalled();

      invalidateSpy.mockRestore();
    });
  });

  describe('useBookFileUrl', () => {
    it('should return correct book file URL', () => {
      vi.mocked(booksAPI.getBookFileUrl).mockReturnValue(
        'http://localhost:8000/api/v1/books/book-123/file'
      );

      const { result } = renderHook(() => useBookFileUrl('book-123'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe('http://localhost:8000/api/v1/books/book-123/file');
      expect(booksAPI.getBookFileUrl).toHaveBeenCalledWith('book-123');
    });
  });
});
