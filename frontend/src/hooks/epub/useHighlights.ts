/**
 * useHighlights - Highlight management hook for EPUB reader
 *
 * Bridges SelectionMenu/HighlightsList with TanStack Query sync hooks.
 * Provides create, update, delete operations for CFI-range-based highlights
 * with 4 color options.
 *
 * @param bookId - Current book ID
 * @param currentChapter - Current chapter number
 */

import { useCallback, useMemo } from 'react';
import {
  useHighlights as useHighlightsQuery,
  useCreateHighlight,
  useUpdateHighlight,
  useDeleteHighlight,
} from '@/hooks/api/useSync';
import type { Rendition } from '@/types/epub';

export const HIGHLIGHT_COLORS = [
  { name: 'yellow', value: '#fbbf24' },
  { name: 'green', value: '#4ade80' },
  { name: 'blue', value: '#60a5fa' },
  { name: 'pink', value: '#f472b6' },
] as const;

interface UseHighlightsOptions {
  bookId: string;
  currentChapter: number;
  rendition: Rendition | null;
}

export function useHighlightActions({ bookId, currentChapter, rendition }: UseHighlightsOptions) {
  const { data: highlights = [], isLoading } = useHighlightsQuery(bookId);
  const createMutation = useCreateHighlight(bookId);
  const updateMutation = useUpdateHighlight(bookId);
  const deleteMutation = useDeleteHighlight(bookId);

  const createHighlight = useCallback(
    (cfiRange: string, text: string, color: string, note?: string) => {
      createMutation.mutate({
        cfi_range: cfiRange,
        chapter_number: currentChapter,
        text: text.slice(0, 500),
        color,
        note,
      });
    },
    [createMutation, currentChapter]
  );

  const updateHighlight = useCallback(
    (highlightId: string, data: { color?: string; note?: string }) => {
      updateMutation.mutate({ highlightId, data });
    },
    [updateMutation]
  );

  const deleteHighlight = useCallback(
    (highlightId: string, cfiRange: string) => {
      // Remove visual annotation from rendition
      if (rendition) {
        try {
          rendition.annotations.remove(cfiRange, 'highlight');
        } catch {
          // Annotation may not exist in current view
        }
      }
      deleteMutation.mutate(highlightId);
    },
    [deleteMutation, rendition]
  );

  const sortedHighlights = useMemo(() => {
    return [...highlights].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [highlights]);

  return {
    highlights: sortedHighlights,
    isLoading,
    createHighlight,
    updateHighlight,
    deleteHighlight,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
