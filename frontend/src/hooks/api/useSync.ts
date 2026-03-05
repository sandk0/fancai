/**
 * TanStack Query hooks for bookmarks and highlights CRUD
 *
 * Provides optimistic updates via Zustand store for instant UI feedback,
 * with background server sync through REST API.
 *
 * @module hooks/api/useSync
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { syncKeys, getCurrentUserId } from './queryKeys';
import { useReaderStore } from '@/stores/reader';
import { logger } from '@/lib/logger';

// ============================================================================
// Types (matching backend schemas)
// ============================================================================

interface BookmarkResponse {
  id: string;
  cfi: string;
  chapter_number: number;
  text_excerpt: string;
  created_at: string;
}

interface HighlightResponse {
  id: string;
  cfi_range: string;
  chapter_number: number;
  text: string;
  color: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface BookmarkCreatePayload {
  cfi: string;
  chapter_number: number;
  text_excerpt: string;
}

interface HighlightCreatePayload {
  cfi_range: string;
  chapter_number: number;
  text: string;
  color: string;
  note?: string;
}

interface HighlightUpdatePayload {
  color?: string;
  note?: string;
}

// ============================================================================
// Bookmark Hooks
// ============================================================================

/**
 * Fetch bookmarks for a book
 */
export function useBookmarks(bookId: string) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: syncKeys.bookmarks(userId, bookId),
    queryFn: () => apiClient.get<BookmarkResponse[]>(`/sync/books/${bookId}/bookmarks`),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!bookId,
  });
}

/**
 * Create a bookmark with optimistic update
 */
export function useCreateBookmark(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const addBookmark = useReaderStore((s) => s.addBookmark);

  return useMutation({
    mutationFn: (data: BookmarkCreatePayload) =>
      apiClient.post<BookmarkResponse>(`/sync/books/${bookId}/bookmarks`, data),

    onMutate: async (data) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({
        queryKey: syncKeys.bookmarks(userId, bookId),
      });

      // Snapshot for rollback
      const previousBookmarks = queryClient.getQueryData<BookmarkResponse[]>(
        syncKeys.bookmarks(userId, bookId)
      );
      const previousStoreBookmarks = useReaderStore.getState().bookmarks[bookId] || [];

      // Optimistic update in Zustand
      addBookmark(bookId, data.chapter_number, data.cfi, data.text_excerpt);

      return { previousBookmarks, previousStoreBookmarks };
    },

    onError: (_error, _data, context) => {
      // Rollback Zustand store
      if (context?.previousStoreBookmarks) {
        useReaderStore.setState((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [bookId]: context.previousStoreBookmarks,
          },
        }));
      }
      // Rollback query cache
      if (context?.previousBookmarks) {
        queryClient.setQueryData(syncKeys.bookmarks(userId, bookId), context.previousBookmarks);
      }
      logger.error('[useCreateBookmark] Failed:', _error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: syncKeys.bookmarks(userId, bookId),
      });
    },
  });
}

/**
 * Delete a bookmark with optimistic update
 */
export function useDeleteBookmark(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const removeBookmark = useReaderStore((s) => s.removeBookmark);

  return useMutation({
    mutationFn: (bookmarkId: string) =>
      apiClient.delete(`/sync/books/${bookId}/bookmarks/${bookmarkId}`),

    onMutate: async (bookmarkId) => {
      await queryClient.cancelQueries({
        queryKey: syncKeys.bookmarks(userId, bookId),
      });

      const previousBookmarks = queryClient.getQueryData<BookmarkResponse[]>(
        syncKeys.bookmarks(userId, bookId)
      );
      const previousStoreBookmarks = useReaderStore.getState().bookmarks[bookId] || [];

      // Find the bookmark CFI to remove from Zustand
      const bookmarkToRemove = previousBookmarks?.find((b) => b.id === bookmarkId);
      if (bookmarkToRemove) {
        removeBookmark(bookId, bookmarkToRemove.cfi);
      }

      // Optimistic update in query cache
      if (previousBookmarks) {
        queryClient.setQueryData(
          syncKeys.bookmarks(userId, bookId),
          previousBookmarks.filter((b) => b.id !== bookmarkId)
        );
      }

      return { previousBookmarks, previousStoreBookmarks };
    },

    onError: (_error, _bookmarkId, context) => {
      if (context?.previousStoreBookmarks) {
        useReaderStore.setState((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [bookId]: context.previousStoreBookmarks,
          },
        }));
      }
      if (context?.previousBookmarks) {
        queryClient.setQueryData(syncKeys.bookmarks(userId, bookId), context.previousBookmarks);
      }
      logger.error('[useDeleteBookmark] Failed:', _error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: syncKeys.bookmarks(userId, bookId),
      });
    },
  });
}

// ============================================================================
// Highlight Hooks
// ============================================================================

/**
 * Fetch highlights for a book
 */
export function useHighlights(bookId: string) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: syncKeys.highlights(userId, bookId),
    queryFn: () => apiClient.get<HighlightResponse[]>(`/sync/books/${bookId}/highlights`),
    staleTime: 5 * 60 * 1000,
    enabled: !!bookId,
  });
}

/**
 * Create a highlight with optimistic update
 */
export function useCreateHighlight(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const addHighlight = useReaderStore((s) => s.addHighlight);

  return useMutation({
    mutationFn: (data: HighlightCreatePayload) =>
      apiClient.post<HighlightResponse>(`/sync/books/${bookId}/highlights`, data),

    onMutate: async (data) => {
      await queryClient.cancelQueries({
        queryKey: syncKeys.highlights(userId, bookId),
      });

      const previousHighlights = queryClient.getQueryData<HighlightResponse[]>(
        syncKeys.highlights(userId, bookId)
      );
      const previousStoreHighlights = useReaderStore.getState().highlights[bookId] || [];

      // Optimistic update in Zustand
      addHighlight(bookId, data.chapter_number, data.cfi_range, data.text, data.color, data.note);

      return { previousHighlights, previousStoreHighlights };
    },

    onError: (_error, _data, context) => {
      if (context?.previousStoreHighlights) {
        useReaderStore.setState((state) => ({
          highlights: {
            ...state.highlights,
            [bookId]: context.previousStoreHighlights,
          },
        }));
      }
      if (context?.previousHighlights) {
        queryClient.setQueryData(syncKeys.highlights(userId, bookId), context.previousHighlights);
      }
      logger.error('[useCreateHighlight] Failed:', _error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: syncKeys.highlights(userId, bookId),
      });
    },
  });
}

/**
 * Update a highlight (color/note)
 */
export function useUpdateHighlight(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: ({ highlightId, data }: { highlightId: string; data: HighlightUpdatePayload }) =>
      apiClient.put<HighlightResponse>(`/sync/books/${bookId}/highlights/${highlightId}`, data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: syncKeys.highlights(userId, bookId),
      });
    },
  });
}

/**
 * Delete a highlight with optimistic update
 */
export function useDeleteHighlight(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const removeHighlight = useReaderStore((s) => s.removeHighlight);

  return useMutation({
    mutationFn: (highlightId: string) =>
      apiClient.delete(`/sync/books/${bookId}/highlights/${highlightId}`),

    onMutate: async (highlightId) => {
      await queryClient.cancelQueries({
        queryKey: syncKeys.highlights(userId, bookId),
      });

      const previousHighlights = queryClient.getQueryData<HighlightResponse[]>(
        syncKeys.highlights(userId, bookId)
      );
      const previousStoreHighlights = useReaderStore.getState().highlights[bookId] || [];

      // Optimistic remove from Zustand
      removeHighlight(bookId, highlightId);

      // Optimistic remove from query cache
      if (previousHighlights) {
        queryClient.setQueryData(
          syncKeys.highlights(userId, bookId),
          previousHighlights.filter((h) => h.id !== highlightId)
        );
      }

      return { previousHighlights, previousStoreHighlights };
    },

    onError: (_error, _highlightId, context) => {
      if (context?.previousStoreHighlights) {
        useReaderStore.setState((state) => ({
          highlights: {
            ...state.highlights,
            [bookId]: context.previousStoreHighlights,
          },
        }));
      }
      if (context?.previousHighlights) {
        queryClient.setQueryData(syncKeys.highlights(userId, bookId), context.previousHighlights);
      }
      logger.error('[useDeleteHighlight] Failed:', _error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: syncKeys.highlights(userId, bookId),
      });
    },
  });
}
