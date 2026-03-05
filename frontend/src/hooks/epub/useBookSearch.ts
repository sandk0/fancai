import { useState, useCallback, useRef } from 'react';
import type { Book, Rendition } from '@/types/epub';

export interface SearchResult {
  cfi: string;
  excerpt: string;
  sectionIndex: number;
  sectionLabel?: string;
}

export interface SearchProgress {
  current: number;
  total: number;
}

interface UseBookSearchOptions {
  book: Book | null;
  rendition: Rendition | null;
}

interface UseBookSearchReturn {
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  currentIndex: number;
  progress: SearchProgress | null;
  searchBook: (query: string) => Promise<void>;
  navigateToResult: (index: number) => void;
  nextResult: () => void;
  previousResult: () => void;
  clearSearch: () => void;
  setQuery: (q: string) => void;
}

/**
 * Batch size for non-blocking spine iteration.
 * After each batch we yield to the event loop so the UI stays responsive.
 */
const BATCH_SIZE = 5;

export const useBookSearch = ({ book, rendition }: UseBookSearchOptions): UseBookSearchReturn => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState<SearchProgress | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const searchBook = useCallback(
    async (searchQuery: string) => {
      if (!book || !searchQuery.trim()) {
        setResults([]);
        setProgress(null);
        return;
      }

      // Abort any previous search
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      setCurrentIndex(0);
      setResults([]);

      const allResults: SearchResult[] = [];
      const spineItems: unknown[] = [];

      // Collect spine items
      book.spine.each((item: unknown) => {
        spineItems.push(item);
      });

      const total = spineItems.length;
      setProgress({ current: 0, total });

      try {
        for (let i = 0; i < total; i++) {
          if (controller.signal.aborted) return;

          const item = spineItems[i] as {
            index: number;
            load: (loader: unknown) => Promise<void>;
            find: (query: string) => Array<{ cfi: string; excerpt: string }>;
            unload: () => void;
          };

          try {
            // Load the section content
            await item.load(
              (book as unknown as { load: { bind: (ctx: unknown) => unknown } }).load.bind(book)
            );

            // Use find() which is more reliable in epub.js 0.3.93
            const sectionResults = item.find(searchQuery);

            for (const r of sectionResults) {
              allResults.push({
                cfi: r.cfi,
                excerpt: r.excerpt,
                sectionIndex: item.index,
              });
            }

            item.unload();
          } catch {
            // Skip sections that fail to load/search
          }

          setProgress({ current: i + 1, total });

          // Yield to event loop after each batch for non-blocking UI
          if ((i + 1) % BATCH_SIZE === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }

        if (!controller.signal.aborted) {
          setResults(allResults);
          setIsSearching(false);
          setProgress(null);

          // Navigate to first result if any
          if (allResults.length > 0 && rendition) {
            try {
              await rendition.display(allResults[0].cfi);
              setCurrentIndex(0);
            } catch {
              // Ignore navigation errors
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsSearching(false);
          setProgress(null);
        }
      }
    },
    [book, rendition]
  );

  const navigateToResult = useCallback(
    (index: number) => {
      if (!rendition || results.length === 0) return;
      const safeIndex = ((index % results.length) + results.length) % results.length;
      setCurrentIndex(safeIndex);
      try {
        rendition.display(results[safeIndex].cfi);
      } catch {
        // Ignore navigation errors
      }
    },
    [rendition, results]
  );

  const nextResult = useCallback(() => {
    if (results.length === 0) return;
    navigateToResult(currentIndex + 1);
  }, [currentIndex, results.length, navigateToResult]);

  const previousResult = useCallback(() => {
    if (results.length === 0) return;
    navigateToResult(currentIndex - 1);
  }, [currentIndex, results.length, navigateToResult]);

  const clearSearch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setQuery('');
    setResults([]);
    setIsSearching(false);
    setCurrentIndex(0);
    setProgress(null);
  }, []);

  return {
    query,
    results,
    isSearching,
    currentIndex,
    progress,
    searchBook,
    navigateToResult,
    nextResult,
    previousResult,
    clearSearch,
    setQuery,
  };
};
