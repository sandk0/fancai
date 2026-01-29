import { useState, useEffect, useCallback } from 'react';
import type { Book, Rendition, Location } from '@/types/epub';
import { chapterCache } from '@/services/chapterCache'; // Still needed for maintenance
import { useAuthStore } from '@/stores/auth';
import { useChapterData } from './useChapterData';
import { useChapterPrefetch } from './useChapterPrefetch';

// Conditional logging
const devLog = import.meta.env.DEV
  ? (...args: unknown[]) => console.log('[useChapterManagement]', ...args)
  : () => { };

const devWarn = import.meta.env.DEV
  ? (...args: unknown[]) => console.warn('[useChapterManagement]', ...args)
  : () => { };

interface UseChapterManagementOptions {
  book: Book | null;
  rendition: Rendition | null;
  bookId: string;
  getChapterNumberByLocation?: ((location: Location) => number | null) | null;
  isRestoringPosition?: boolean;
}

export const useChapterManagement = ({
  book,
  rendition,
  bookId,
  getChapterNumberByLocation,
  isRestoringPosition = false,
}: UseChapterManagementOptions) => {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id || '';

  const [currentChapter, setCurrentChapter] = useState<number>(1);

  /**
   * Extract chapter number from EPUB location
   */
  const getChapterFromLocation_Internal = useCallback((location: Location): number => {
    try {
      if (!book) return 1;

      // 1. Try mapping function
      if (getChapterNumberByLocation) {
        const mappedChapter = getChapterNumberByLocation(location);
        if (mappedChapter !== null) return mappedChapter;
      }

      // 2. Fallback: spine index
      const currentHref = location?.start?.href;
      if (!currentHref || !book.spine) return 1;

      const spineIndex = book.spine.items.findIndex((item) => 
        item.href === currentHref || item.href.includes(currentHref)
      );

      return spineIndex === -1 ? 1 : Math.max(1, spineIndex + 1);
    } catch {
      return 1;
    }
  }, [book, getChapterNumberByLocation]);

  // Hook 1: Load data for current chapter
  // Automatically handles caching, API calls, and abortion on change
  const { descriptions, images, isLoading: isLoadingChapter } = useChapterData({
    bookId,
    chapter: currentChapter,
    userId,
    enabled: !isRestoringPosition && !!userId, // Defer loading until position restored and user auth ready
  });

  // Hook 2: Prefetch next chapters
  const { prefetchNextChapters } = useChapterPrefetch({ bookId, userId });

  // Trigger prefetch when chapter data is loaded
  useEffect(() => {
    if (!isLoadingChapter && !isRestoringPosition && userId && currentChapter > 0) {
      prefetchNextChapters(currentChapter);
    }
  }, [currentChapter, isLoadingChapter, isRestoringPosition, userId, prefetchNextChapters]);

  /**
   * Listen to relocated events to detect chapter changes
   */
  useEffect(() => {
    if (!rendition || !book) return;

    const handleRelocated = (location: Location) => {
      const chapter = getChapterFromLocation_Internal(location);
      if (chapter !== currentChapter) {
        setCurrentChapter(chapter);
      }
    };

    rendition.on('relocated', handleRelocated as (...args: unknown[]) => void);

    // Initial chapter check
    const timer = setTimeout(() => {
      try {
        if (rendition.currentLocation && typeof rendition.currentLocation === 'function') {
          const loc = rendition.currentLocation();
          if (loc) {
            const initialChapter = getChapterFromLocation_Internal(loc);
            setCurrentChapter(initialChapter);
            devLog('Initial chapter set:', initialChapter);
          }
        }
      } catch (e) {
        devWarn('Could not get initial location:', e);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      rendition.off('relocated', handleRelocated as (...args: unknown[]) => void);
    };
  }, [rendition, book, getChapterFromLocation_Internal, currentChapter]);

  /**
   * Maintenance: Clear old cache entries on mount
   */
  useEffect(() => {
    chapterCache.performMaintenance().catch((err) => {
      devWarn('Cache maintenance failed:', err);
    });
  }, []);

  return {
    currentChapter,
    descriptions,
    images,
    isLoadingChapter,
  };
};
