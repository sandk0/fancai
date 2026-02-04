/**
 * useReadingProgress - Custom hook for reading progress tracking
 *
 * Manages reading position restoration and auto-save functionality.
 * Prevents race conditions between restoration and navigation.
 *
 * @param bookId - Book identifier
 * @param currentChapter - Current chapter number
 * @param currentPage - Current page in chapter
 * @param totalPages - Total pages in current chapter
 * @returns Progress state and restoration status
 *
 * @example
 * const { hasRestoredPosition, restoreProgress } = useReadingProgress(
 *   bookId,
 *   currentChapter,
 *   currentPage,
 *   pages.length
 * );
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { booksAPI } from '@/api/books';
import { logger } from '@/lib/logger';

const AUTO_SAVE_DEBOUNCE_MS = 2000;

interface UseReadingProgressOptions {
  bookId: string;
  currentChapter: number;
  currentPage: number;
  totalPages: number;
  initialChapter: number;
  onPositionRestored?: (chapter: number, page: number) => void;
}

interface UseReadingProgressReturn {
  hasRestoredPosition: boolean;
  isRestoring: boolean;
  saveProgress: () => Promise<void>;
}

export const useReadingProgress = ({
  bookId,
  currentChapter,
  currentPage,
  totalPages,
  initialChapter,
  onPositionRestored,
}: UseReadingProgressOptions): UseReadingProgressReturn => {
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const shouldRestore = !hasRestoredPosition && totalPages > 0 && currentChapter === initialChapter;
  const [prevShouldRestore, setPrevShouldRestore] = useState(false);
  if (shouldRestore && !prevShouldRestore) {
    setPrevShouldRestore(true);
    setIsRestoring(true);
  }

  useEffect(() => {
    if (hasRestoredPosition || totalPages === 0 || currentChapter !== initialChapter) {
      return;
    }

    booksAPI.getReadingProgress(bookId)
      .then(({ progress }) => {
        if (!progress) {
          logger.debug('📖 [useReadingProgress] No saved progress found');
          setHasRestoredPosition(true);
          setIsRestoring(false);
          return;
        }

        logger.debug('📖 [useReadingProgress] Loaded progress:', {
          currentChapter: progress.current_chapter,
          currentPosition: progress.current_position,
          savedChapter: progress.current_chapter,
          urlChapter: initialChapter,
          totalPages
        });

        // Only restore if on same chapter
        if (progress.current_chapter === currentChapter && progress.current_position > 0) {
          const targetPage = Math.max(1, Math.ceil((progress.current_position / 100) * totalPages));

          logger.debug('📖 [useReadingProgress] RESTORING:', {
            chapter: progress.current_chapter,
            positionPercent: progress.current_position + '%',
            totalPages,
            targetPage,
          });

          onPositionRestored?.(progress.current_chapter, targetPage);
        } else {
          logger.debug('📖 [useReadingProgress] NOT restoring - chapter mismatch');
        }

        setHasRestoredPosition(true);
        setIsRestoring(false);
      })
      .catch(err => {
        logger.error('❌ [useReadingProgress] Failed to load progress:', err);
        setHasRestoredPosition(true);
        setIsRestoring(false);
      });
  }, [totalPages, currentChapter, initialChapter, bookId, hasRestoredPosition, onPositionRestored]);

  /**
   * Auto-save progress when position changes (debounced)
   */
  useEffect(() => {
    if (!hasRestoredPosition || totalPages === 0) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const positionPercent = (currentPage / totalPages) * 100;

      if (import.meta.env.DEV) {
        logger.debug('📊 [useReadingProgress] Auto-save:', {
          currentChapter,
          currentPage,
          totalPages,
          positionPercent: positionPercent.toFixed(2) + '%'
        });
      }

      booksAPI.updateReadingProgress(bookId, {
        current_chapter: currentChapter,
        current_position_percent: positionPercent
      })
        .then(() => {
          if (import.meta.env.DEV) {
            logger.debug('📊 [useReadingProgress] ✅ Progress saved');
          }
        })
        .catch(err => {
          logger.error('❌ [useReadingProgress] Failed to update:', err);
        });
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [bookId, currentChapter, currentPage, totalPages, hasRestoredPosition]);

  /**
   * Manual progress save (for chapter changes)
   */
  const saveProgress = useCallback(async () => {
    const positionPercent = (currentPage / totalPages) * 100;

    await booksAPI.updateReadingProgress(bookId, {
      current_chapter: currentChapter,
      current_position_percent: positionPercent
    });
  }, [bookId, currentChapter, currentPage, totalPages]);

  return {
    hasRestoredPosition,
    isRestoring,
    saveProgress,
  };
};
