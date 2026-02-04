/**
 * useToc - Custom hook for managing Table of Contents (TOC)
 *
 * Extracts and manages the book's table of contents from epub.js navigation.
 * Provides chapter list with names, hrefs, and nested structure.
 *
 * Features:
 * - Loads TOC from book.navigation.toc
 * - Supports nested chapters (subitems)
 * - Loading state management
 * - Error handling
 *
 * @param book - epub.js Book instance
 * @returns TOC data, loading state, and current chapter tracking
 *
 * @example
 * const { toc, isLoading, currentHref, setCurrentHref } = useToc(book);
 */

import { useState, useEffect, useCallback } from 'react';
import type { Book, NavItem } from '@/types/epub';
import { logger } from '@/lib/logger';

export interface UseTocReturn {
  toc: NavItem[];
  isLoading: boolean;
  error: string | null;
  currentHref: string | null;
  setCurrentHref: (href: string | null) => void;
  getTotalChapters: () => number;
  findChapterByHref: (href: string) => NavItem | null;
}

export const useToc = (book: Book | null): UseTocReturn => {
  const [toc, setToc] = useState<NavItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentHref, setCurrentHref] = useState<string | null>(null);

  useEffect(() => {
    if (!book) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const loadToc = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Wait for navigation to be ready
        await book.loaded.navigation;

        if (!isMounted) return;

        // Get TOC from book navigation
        const tocData = book.navigation.toc;

        setToc(tocData);
        setIsLoading(false);
      } catch (err) {
        logger.error('[useToc] Error loading TOC:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load table of contents');
          setIsLoading(false);
        }
      }
    };

    loadToc();

    return () => {
      isMounted = false;
    };
  }, [book]);

  /**
   * Get total chapter count including nested chapters
   */
  const getTotalChapters = useCallback((): number => {
    const countChapters = (items: NavItem[]): number => {
      return items.reduce((count, item) => {
        let itemCount = 1; // Count the item itself
        if (item.subitems && item.subitems.length > 0) {
          itemCount += countChapters(item.subitems);
        }
        return count + itemCount;
      }, 0);
    };

    return countChapters(toc);
  }, [toc]);

  /**
   * Find a chapter by its href (supports nested search)
   */
  const findChapterByHref = useCallback((href: string): NavItem | null => {
    const normalizeHref = (h: string) => {
      // Remove hash and query params for comparison
      return h.split('#')[0].split('?')[0];
    };

    const normalizedTarget = normalizeHref(href);

    const search = (items: NavItem[]): NavItem | null => {
      for (const item of items) {
        const normalizedItemHref = normalizeHref(item.href);
        if (normalizedItemHref === normalizedTarget) {
          return item;
        }
        if (item.subitems && item.subitems.length > 0) {
          const found = search(item.subitems);
          if (found) return found;
        }
      }
      return null;
    };

    return search(toc);
  }, [toc]);

  return {
    toc,
    isLoading,
    error,
    currentHref,
    setCurrentHref,
    getTotalChapters,
    findChapterByHref,
  };
};
