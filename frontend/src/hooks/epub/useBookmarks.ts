/**
 * useBookmarks - Bookmark management hook for EPUB reader
 *
 * Bridges SelectionMenu/BookmarksList with TanStack Query sync hooks.
 * Provides create, delete, and lookup operations for CFI-based bookmarks.
 *
 * @param bookId - Current book ID
 * @param currentChapter - Current chapter number
 */

import { useCallback, useMemo } from 'react';
import {
  useBookmarks as useBookmarksQuery,
  useCreateBookmark,
  useDeleteBookmark,
} from '@/hooks/api/useSync';

interface UseBookmarksOptions {
  bookId: string;
  currentChapter: number;
}

export function useBookmarkActions({ bookId, currentChapter }: UseBookmarksOptions) {
  const { data: bookmarks = [], isLoading } = useBookmarksQuery(bookId);
  const createMutation = useCreateBookmark(bookId);
  const deleteMutation = useDeleteBookmark(bookId);

  const createBookmark = useCallback(
    (cfi: string, text: string) => {
      createMutation.mutate({
        cfi,
        chapter_number: currentChapter,
        text_excerpt: text.slice(0, 200),
      });
    },
    [createMutation, currentChapter]
  );

  const deleteBookmark = useCallback(
    (bookmarkId: string) => {
      deleteMutation.mutate(bookmarkId);
    },
    [deleteMutation]
  );

  const isBookmarked = useCallback(
    (cfi: string) => {
      return bookmarks.some((b) => b.cfi === cfi);
    },
    [bookmarks]
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
    deleteBookmark,
    isBookmarked,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
