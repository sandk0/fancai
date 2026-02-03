 
/**
 * useChapterNavigation - Custom hook for chapter and page navigation
 *
 * Manages navigation between pages and chapters with boundary handling.
 *
 * @param currentChapter - Current chapter number
 * @param setCurrentChapter - Set chapter function
 * @param currentPage - Current page number
 * @param setCurrentPage - Set page function
 * @param totalPages - Total pages in current chapter
 * @param totalChapters - Total chapters in book
 * @returns Navigation functions
 *
 * @example
 * const { nextPage, prevPage, jumpToChapter } = useChapterNavigation(
 *   currentChapter,
 *   setCurrentChapter,
 *   currentPage,
 *   setCurrentPage,
 *   pages.length,
 *   book.chapters_count
 * );
 */

import { useCallback } from 'react';
import { logger } from '@/lib/logger';

interface UseChapterNavigationOptions {
  currentChapter: number;
  setCurrentChapter: (chapter: number) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  totalChapters: number;
}

interface UseChapterNavigationReturn {
  nextPage: () => void;
  prevPage: () => void;
  jumpToChapter: (chapterNum: number) => void;
  canGoNext: boolean;
  canGoPrev: boolean;
}

export const useChapterNavigation = ({
  currentChapter,
  setCurrentChapter,
  currentPage,
  setCurrentPage,
  totalPages,
  totalChapters,
}: UseChapterNavigationOptions): UseChapterNavigationReturn => {

  const nextPage = useCallback(() => {
    logger.debug(`[useChapterNavigation] Next: page=${currentPage}, total=${totalPages}, chapter=${currentChapter}`);

    if (currentPage < totalPages) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
    } else if (currentChapter < totalChapters) {
      logger.debug('[useChapterNavigation] Moving to next chapter');
      setCurrentChapter(currentChapter + 1);
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, currentChapter, totalChapters, setCurrentPage, setCurrentChapter]);

  const prevPage = useCallback(() => {
    logger.debug(`[useChapterNavigation] Prev: page=${currentPage}, total=${totalPages}, chapter=${currentChapter}`);

    if (currentPage > 1) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
    } else if (currentChapter > 1) {
      logger.debug('[useChapterNavigation] Moving to previous chapter');
      setCurrentChapter(currentChapter - 1);
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, currentChapter, setCurrentPage, setCurrentChapter]);

  const jumpToChapter = useCallback((chapterNum: number) => {
    if (chapterNum >= 1 && chapterNum <= totalChapters) {
      logger.debug(`[useChapterNavigation] Jumping to chapter ${chapterNum}`);
      setCurrentChapter(chapterNum);
      setCurrentPage(1);
    }
  }, [totalChapters, setCurrentChapter, setCurrentPage]);

  const canGoNext = currentPage < totalPages || currentChapter < totalChapters;
  const canGoPrev = currentPage > 1 || currentChapter > 1;

  return {
    nextPage,
    prevPage,
    jumpToChapter,
    canGoNext,
    canGoPrev,
  };
};


