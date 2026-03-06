/**
 * useBookmarks - Unified bookmark management hook for EPUB reader
 *
 * Bridges SelectionMenu/BookmarksList with TanStack Query sync hooks.
 * Provides create, update, delete operations for CFI-range-based bookmarks
 * with optional color, style, and note.
 *
 * @param bookId - Current book ID
 * @param currentChapter - Current chapter number
 */

import { useCallback, useMemo } from 'react';
import {
  useBookmarks as useBookmarksQuery,
  useCreateBookmark,
  useUpdateBookmark,
  useDeleteBookmark,
} from '@/hooks/api/useSync';

export const BOOKMARK_COLORS = [
  { name: 'yellow', value: '#fbbf24' },
  { name: 'green', value: '#4ade80' },
  { name: 'blue', value: '#60a5fa' },
  { name: 'pink', value: '#f472b6' },
] as const;

export const BOOKMARK_STYLES = ['none', 'underline', 'bold', 'italic'] as const;
export type BookmarkStyleType = (typeof BOOKMARK_STYLES)[number];

interface UseBookmarksOptions {
  bookId: string;
  currentChapter: number;
}

export function useBookmarkActions({ bookId, currentChapter }: UseBookmarksOptions) {
  const { data: bookmarks = [], isLoading } = useBookmarksQuery(bookId);
  const createMutation = useCreateBookmark(bookId);
  const updateMutation = useUpdateBookmark(bookId);
  const deleteMutation = useDeleteBookmark(bookId);

  const createBookmark = useCallback(
    (
      cfiRange: string,
      text: string,
      color?: string | null,
      style?: string,
      note?: string,
      textColor?: string | null
    ) => {
      createMutation.mutate({
        cfi_range: cfiRange,
        chapter_number: currentChapter,
        text: text.slice(0, 500),
        color,
        text_color: textColor,
        style: style || 'none',
        note,
      });
    },
    [createMutation, currentChapter]
  );

  const updateBookmark = useCallback(
    (bookmarkId: string, data: { color?: string | null; style?: string; note?: string }) => {
      updateMutation.mutate({ bookmarkId, data });
    },
    [updateMutation]
  );

  const deleteBookmark = useCallback(
    (bookmarkId: string, _cfiRange?: string) => {
      deleteMutation.mutate(bookmarkId);
    },
    [deleteMutation]
  );

  const sortedBookmarks = useMemo(() => {
    return [...bookmarks].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [bookmarks]);

  return {
    bookmarks: sortedBookmarks,
    isLoading,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
