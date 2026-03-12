/**
 * TanStack Query hooks for unified bookmarks CRUD
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

export interface BookmarkResponse {
  id: string;
  cfi_range: string;
  chapter_number: number;
  text: string;
  color: string | null;
  text_color: string | null;
  style: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookmarkCreatePayload {
  cfi_range: string;
  chapter_number: number;
  text: string;
  color?: string | null;
  text_color?: string | null;
  style?: string;
  note?: string;
}

export interface BookmarkUpdatePayload {
  color?: string | null;
  text_color?: string | null;
  style?: string;
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
      await queryClient.cancelQueries({
        queryKey: syncKeys.bookmarks(userId, bookId),
      });

      const previousBookmarks = queryClient.getQueryData<BookmarkResponse[]>(
        syncKeys.bookmarks(userId, bookId)
      );
      const previousStoreBookmarks = useReaderStore.getState().bookmarks[bookId] || [];

      // Optimistic update in Zustand
      addBookmark(
        bookId,
        data.chapter_number,
        data.cfi_range,
        data.text,
        data.color,
        data.style,
        data.note
      );

      // Optimistic update in TanStack Query cache for instant annotation rendering
      const optimisticBookmark: BookmarkResponse = {
        id: `optimistic-${Date.now()}`,
        cfi_range: data.cfi_range,
        chapter_number: data.chapter_number,
        text: data.text,
        color: data.color ?? null,
        text_color: data.text_color ?? null,
        style: data.style || 'none',
        note: data.note ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<BookmarkResponse[]>(syncKeys.bookmarks(userId, bookId), (old) => [
        ...(old || []),
        optimisticBookmark,
      ]);

      return { previousBookmarks, previousStoreBookmarks };
    },

    onSuccess: (newBookmark) => {
      // Replace optimistic entry with real server response immediately.
      // This prevents the stale refetch race: onSettled's invalidateQueries
      // can return data without the new bookmark if the server hasn't propagated yet.
      queryClient.setQueryData<BookmarkResponse[]>(syncKeys.bookmarks(userId, bookId), (old) => {
        if (!old) return [newBookmark];
        const withoutOptimistic = old.filter((b) => !b.id.startsWith('optimistic-'));
        // Deduplicate in case refetch already included it
        return [...withoutOptimistic.filter((b) => b.id !== newBookmark.id), newBookmark];
      });
    },

    onError: (_error, _data, context) => {
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
      logger.error('[useCreateBookmark] Failed:', _error);
    },

    onSettled: (_data, error) => {
      // Only refetch on error to confirm rollback state.
      // On success, onSuccess already put the real bookmark in cache.
      // Immediate refetch can return stale server data (without the new bookmark),
      // wiping the optimistic/real entry — the root cause of BUG-4.
      if (error) {
        queryClient.invalidateQueries({
          queryKey: syncKeys.bookmarks(userId, bookId),
        });
      }
    },
  });
}

/**
 * Update a bookmark (color/style/note)
 */
export function useUpdateBookmark(bookId: string) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: ({ bookmarkId, data }: { bookmarkId: string; data: BookmarkUpdatePayload }) =>
      apiClient.put<BookmarkResponse>(`/sync/books/${bookId}/bookmarks/${bookmarkId}`, data),

    onSuccess: () => {
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

      // Optimistic remove from Zustand
      removeBookmark(bookId, bookmarkId);

      // Optimistic remove from query cache
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

    onSettled: (_data, error) => {
      // Only refetch on error — optimistic remove is already correct on success.
      // Immediate refetch can return stale data with the deleted bookmark still present.
      if (error) {
        queryClient.invalidateQueries({
          queryKey: syncKeys.bookmarks(userId, bookId),
        });
      }
    },
  });
}
