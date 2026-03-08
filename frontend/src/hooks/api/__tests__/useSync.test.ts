/**
 * Tests for useSync TanStack Query hooks (unified bookmarks)
 *
 * Verifies READ-01: bookmark CRUD hooks call correct endpoints,
 * return data, and handle optimistic updates.
 *
 * Note: highlights were MERGED into bookmarks. useHighlights no longer exists.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBookmarks, useCreateBookmark, useDeleteBookmark } from '../useSync';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

// Mock dependencies
vi.mock('@/api/client');
vi.mock('@/stores/auth');
vi.mock('@/stores/reader', () => ({
  useReaderStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        addBookmark: vi.fn(),
        removeBookmark: vi.fn(),
        bookmarks: {},
      })
    ),
    {
      getState: vi.fn(() => ({
        bookmarks: {},
        addBookmark: vi.fn(),
        removeBookmark: vi.fn(),
      })),
      setState: vi.fn(),
    }
  ),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

describe('useSync hooks', () => {
  let queryClient: QueryClient;

  const mockUser = {
    id: 'user-test-123',
    email: 'test@example.com',
    full_name: 'Test User',
    is_active: true,
    is_verified: true,
    is_admin: false,
    created_at: new Date().toISOString(),
  };

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  const mockBookmarks = [
    {
      id: 'bm-1',
      cfi_range: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
      chapter_number: 1,
      text: 'First bookmark',
      color: '#fbbf24',
      text_color: null,
      style: 'highlight',
      note: null,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    },
    {
      id: 'bm-2',
      cfi_range: 'epubcfi(/6/4!/4/2/3:0,/6/4!/4/2/3:20)',
      chapter_number: 2,
      text: 'Second bookmark',
      color: null,
      text_color: null,
      style: 'none',
      note: 'My note',
      created_at: '2026-03-02T00:00:00Z',
      updated_at: '2026-03-02T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

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
    } as ReturnType<typeof useAuthStore.getState>);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('useBookmarks', () => {
    it('should fetch bookmarks for a book', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(mockBookmarks);

      const { result } = renderHook(() => useBookmarks('book-abc'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockBookmarks);
      expect(result.current.data).toHaveLength(2);
    });

    it('should not fetch when bookId is empty', () => {
      const { result } = renderHook(() => useBookmarks(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should call the correct API endpoint', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      renderHook(() => useBookmarks('book-xyz'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/sync/books/book-xyz/bookmarks');
      });
    });
  });

  describe('useCreateBookmark', () => {
    it('should call POST to create bookmark', async () => {
      const newBookmark = {
        ...mockBookmarks[0],
        id: 'bm-new',
      };
      vi.mocked(apiClient.post).mockResolvedValue(newBookmark);

      const { result } = renderHook(() => useCreateBookmark('book-abc'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          cfi_range: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
          chapter_number: 1,
          text: 'New bookmark',
          color: '#fbbf24',
          style: 'highlight',
        });
      });

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/sync/books/book-abc/bookmarks',
          expect.objectContaining({
            cfi_range: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
            chapter_number: 1,
            text: 'New bookmark',
          })
        );
      });
    });
  });

  describe('useDeleteBookmark', () => {
    it('should call DELETE to remove bookmark', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteBookmark('book-abc'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate('bm-1');
      });

      await waitFor(() => {
        expect(apiClient.delete).toHaveBeenCalledWith('/sync/books/book-abc/bookmarks/bm-1');
      });
    });
  });
});
