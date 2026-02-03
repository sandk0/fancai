/**
 * useAutoParser - Custom hook for automatic description parsing
 *
 * Automatically triggers description parsing for books without descriptions.
 * Includes cooldown mechanism and progress polling.
 *
 * @param bookId - Book identifier
 * @param chapter - Current chapter data
 * @param refetch - Function to refetch chapter data
 * @returns Parsing state and trigger function
 *
 * @example
 * const { isAutoParsing, parsingProgress } = useAutoParser(
 *   bookId,
 *   chapter,
 *   refetchChapter
 * );
 */

import { useState, useEffect } from 'react';
import { booksAPI } from '@/api/books';
import { notify } from '@/stores/ui';
import i18n from '@/lib/i18n';
import type { Description } from '@/types/api';
import { logger } from '@/lib/logger';

interface UseAutoParserReturn {
  isAutoParsing: boolean;
  parsingProgress: number;
}

const RECENT_PARSING_KEY = 'recent_parsing';
const COOLDOWN_MS = 300000; // 5 minutes
const MAX_POLL_ATTEMPTS = 12; // 2 minutes total (12 * 10s)
const POLL_INTERVAL_MS = 10000; // 10 seconds

export const useAutoParser = (
  bookId: string | undefined,
  chapter: unknown,
  refetch: () => Promise<unknown>
): UseAutoParserReturn => {
  const [isAutoParsing, setIsAutoParsing] = useState(false);
  const [parsingProgress, setParsingProgress] = useState(0);

  useEffect(() => {
    if (!chapter || !bookId) return;

    // Check for descriptions in API response
    let descriptions: Description[] = [];
    const chapterData = chapter as Record<string, unknown>;

    if (chapterData.descriptions && Array.isArray(chapterData.descriptions)) {
      descriptions = chapterData.descriptions as Description[];
    } else if (chapterData.chapter && typeof chapterData.chapter === 'object' && chapterData.chapter !== null) {
      const nestedChapter = chapterData.chapter as Record<string, unknown>;
      if (nestedChapter.descriptions && Array.isArray(nestedChapter.descriptions)) {
        descriptions = nestedChapter.descriptions as Description[];
      }
    } else if (Array.isArray(chapter)) {
      descriptions = chapter as unknown as Description[];
    }

    logger.debug('📖 [useAutoParser] Chapter analysis:', {
      hasDescriptions: descriptions.length > 0,
      descriptionsCount: descriptions.length,
    });

    // Exit if descriptions exist
    if (descriptions.length > 0) {
      logger.debug('✅ [useAutoParser] Descriptions already loaded:', descriptions.length);
      return;
    }

    // Check cooldown
    const recentParsing = JSON.parse(localStorage.getItem(RECENT_PARSING_KEY) || '{}');
    const isRecentlyParsed = recentParsing[bookId] && (Date.now() - recentParsing[bookId] < COOLDOWN_MS);

    logger.debug('🔍 [useAutoParser] Status check:', {
      bookId,
      recentlyParsed: isRecentlyParsed,
      cooldownRemaining: isRecentlyParsed ? Math.max(0, COOLDOWN_MS - (Date.now() - recentParsing[bookId])) : 0,
    });

    if (isRecentlyParsed) {
      logger.debug('📝 [useAutoParser] Cooldown active, skipping');
      return;
    }

    // Trigger parsing
    logger.debug('📝 [useAutoParser] Auto-triggering parsing for book:', bookId);
    setIsAutoParsing(true);

    booksAPI.processBook(bookId)
      .then((response) => {
        const data = response as { status?: string; descriptions_found?: number };
        logger.debug('📝 [useAutoParser] Parsing triggered:', data);

        // Mark as recently parsed
        recentParsing[bookId] = Date.now();
        localStorage.setItem(RECENT_PARSING_KEY, JSON.stringify(recentParsing));

        if (data.status === 'completed') {
          // Synchronous processing completed
          notify.success(i18n.t('hooks.autoParser.success_title'), i18n.t('hooks.autoParser.success_message', { count: data.descriptions_found || 0 }));
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          // Asynchronous processing - start polling
          notify.info(i18n.t('hooks.autoParser.started_title'), i18n.t('hooks.autoParser.started_message'));
          pollForCompletion(refetch, setParsingProgress);
        }
      })
      .catch((err: Error) => {
        logger.error('❌ [useAutoParser] Failed to trigger parsing:', err);
        notify.error(i18n.t('hooks.autoParser.error_title'), i18n.t('hooks.autoParser.error_message'));
        setIsAutoParsing(false);
      });
  }, [chapter, bookId, refetch]);

  /**
   * Poll for parsing completion
   */
  const pollForCompletion = (
    refetchFn: () => Promise<unknown>,
    setProgress: (progress: number) => void
  ) => {
    let attempts = 0;

    const checkCompletion = () => {
      attempts++;
      const progress = Math.min(95, (attempts / MAX_POLL_ATTEMPTS) * 100);
      setProgress(progress);

      logger.debug(`🔄 [useAutoParser] Polling (${attempts}/${MAX_POLL_ATTEMPTS})`);

      refetchFn().then((result) => {
        const resultData = result as { data?: { descriptions?: Description[] } } | undefined;
        const newDescriptions = resultData?.data?.descriptions || [];
        if (newDescriptions.length > 0) {
          logger.debug('✅ [useAutoParser] Parsing completed!');
          setProgress(100);
          notify.success(i18n.t('hooks.autoParser.complete_title'), i18n.t('hooks.autoParser.complete_message', { count: newDescriptions.length }));
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else if (attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(checkCompletion, POLL_INTERVAL_MS);
        } else {
          logger.debug('⏰ [useAutoParser] Polling timed out');
          notify.warning(i18n.t('hooks.autoParser.timeout_title'), i18n.t('hooks.autoParser.timeout_message'));
          setProgress(0);
        }
      }).catch(() => {
        if (attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(checkCompletion, POLL_INTERVAL_MS);
        }
      });
    };

    setTimeout(checkCompletion, 15000); // Initial delay
  };

  return {
    isAutoParsing,
    parsingProgress,
  };
};
