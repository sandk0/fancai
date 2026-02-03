/**
 * useParsingStatus - Hook for tracking book parsing status
 *
 * Polls the book status while parsing is in progress and invalidates
 * caches when parsing completes. This ensures that descriptions
 * extracted by background Celery tasks are immediately available.
 *
 * CREATED (2025-12-25): Part of Phase 2 optimization for position
 * restoration and description parsing.
 *
 * @example
 * const { isParsing, progress, isReady } = useParsingStatus(bookId);
 *
 * if (isParsing) {
 *   return <ParsingIndicator progress={progress} />;
 * }
 */

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { bookKeys, descriptionKeys } from './queryKeys';
import { chapterCache } from '@/services/chapterCache';
import { notify } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { logger } from '@/lib/logger';
import i18n from '@/lib/i18n';

interface UseParsingStatusOptions {
  /** Book ID to track */
  bookId: string;
  /** Enable polling (default: true) */
  enabled?: boolean;
  /** Polling interval in ms while parsing (default: 3000) */
  pollingInterval?: number;
}

interface UseParsingStatusReturn {
  /** Whether the book is currently being parsed */
  isParsing: boolean;
  /** Parsing progress 0-100 */
  progress: number;
  /** Number of chapters ready (already parsed) */
  chaptersReady: number;
  /** Whether book is fully ready (parsed and not processing) */
  isReady: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
}

export function useParsingStatus({
  bookId,
  enabled = true,
  pollingInterval = 3000,
}: UseParsingStatusOptions): UseParsingStatusReturn {
  const queryClient = useQueryClient();
  // Get userId reactively - handles PWA rehydration gracefully
  const user = useAuthStore((state) => state.user);
  const userId = user?.id || '';
  const previousIsParsing = useRef<boolean | null>(null);

  const query = useQuery({
    queryKey: bookKeys.detail(userId, bookId),
    queryFn: () => booksAPI.getBook(bookId),
    select: (data) => {
      const isProcessing = data.is_processing ?? false;
      const isParsed = data.is_parsed ?? false;
      const parsingProgress = data.parsing_progress ?? 0;

      return {
        isParsing: isProcessing || (parsingProgress < 100 && !isParsed),
        progress: parsingProgress,
        chaptersReady: data.chapters?.filter(c => c.is_description_parsed).length || 0,
        isReady: isParsed && !isProcessing && parsingProgress === 100,
      };
    },
    refetchInterval: (query) => {
      // Poll every 3 seconds while parsing
      // Note: query.state.data contains raw data, not selected data
      const rawData = query.state.data;
      if (rawData) {
        const isProcessing = rawData.is_processing ?? false;
        const isParsed = rawData.is_parsed ?? false;
        const parsingProgress = rawData.parsing_progress ?? 0;
        const isParsing = isProcessing || (parsingProgress < 100 && !isParsed);

        if (isParsing) {
          return pollingInterval;
        }
      }
      return false;
    },
    enabled: enabled && !!bookId && !!userId,
    staleTime: 1000, // Consider data stale quickly during parsing
  });

  // Detect when parsing completes and invalidate caches
  useEffect(() => {
    if (!query.data || !userId) return;

    const { isParsing, isReady, progress } = query.data;

    // Detect transition from parsing to ready
    if (previousIsParsing.current === true && !isParsing && isReady) {
      logger.debug('🎉 [useParsingStatus] Parsing complete! Invalidating caches...');

      // Invalidate TanStack Query caches
      queryClient.invalidateQueries({
        queryKey: descriptionKeys.byBook(userId, bookId),
      });

      // Clear IndexedDB cache for this book (force fresh data)
      chapterCache.clearBook(userId, bookId).catch((err) => {
        logger.warn('⚠️ [useParsingStatus] Failed to clear chapter cache:', err);
      });

      // Show success notification
      notify.success(
        i18n.t('hooks.parsingStatus.book_ready'),
        i18n.t('hooks.parsingStatus.descriptions_extracted', { progress })
      );
    }

    previousIsParsing.current = isParsing;
  }, [query.data, bookId, userId, queryClient]);

  return {
    isParsing: query.data?.isParsing ?? false,
    progress: query.data?.progress ?? 0,
    chaptersReady: query.data?.chaptersReady ?? 0,
    isReady: query.data?.isReady ?? false,
    isLoading: query.isLoading,
    error: query.error,
  };
}
