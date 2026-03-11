import { useState, useCallback, useRef } from 'react';
import type { Book, Rendition } from '@/types/epub';

export interface SearchResult {
  cfi: string;
  excerpt: string;
  sectionIndex: number;
  sectionHref?: string;
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

/**
 * Suppress epub.js IndexSizeError thrown inside requestAnimationFrame.
 * These are uncatchable via try/catch because they escape the Promise chain.
 */
const suppressEpubDisplayError = (handler: () => void): (() => void) => {
  const onError = (e: ErrorEvent) => {
    if (e.message?.includes('IndexSizeError') || e.message?.includes('setStart')) {
      e.preventDefault(); // Suppress console error
    }
  };
  window.addEventListener('error', onError);
  handler();
  // Remove after a tick — errors fire in next rAF
  const cleanup = () => window.removeEventListener('error', onError);
  setTimeout(cleanup, 500);
  return cleanup;
};

export const useBookSearch = ({ book, rendition }: UseBookSearchOptions): UseBookSearchReturn => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState<SearchProgress | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const highlightedCfiRef = useRef<string | null>(null);

  const removeHighlight = useCallback(() => {
    if (highlightedCfiRef.current && rendition) {
      try {
        rendition.annotations.remove(highlightedCfiRef.current, 'highlight');
      } catch {
        // Ignore cleanup errors
      }
      highlightedCfiRef.current = null;
    }
  }, [rendition]);

  const applyHighlight = useCallback(
    (cfi: string) => {
      if (!rendition) return;
      removeHighlight();
      try {
        rendition.annotations.highlight(cfi, {}, undefined, 'search-highlight', {
          fill: 'rgba(255, 213, 0, 0.4)',
          'fill-opacity': '0.4',
          'mix-blend-mode': 'multiply',
        });
        highlightedCfiRef.current = cfi;
      } catch {
        // Ignore annotation errors
      }
    },
    [rendition, removeHighlight]
  );

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
            href: string;
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
                sectionHref: item.href,
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

          // Navigate to first result using CFI for precise positioning
          if (allResults.length > 0 && rendition) {
            suppressEpubDisplayError(() => {
              rendition.display(allResults[0].cfi);
            });
            setCurrentIndex(0);
            applyHighlight(allResults[0].cfi);
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsSearching(false);
          setProgress(null);
        }
      }
    },
    [book, rendition, applyHighlight]
  );

  const isNavigatingRef = useRef(false);

  const navigateToResult = useCallback(
    async (index: number) => {
      if (!rendition || results.length === 0) return;
      // Prevent concurrent rendition.display() calls — epub.js drops subsequent calls
      // before the first resolves, causing "first click works, then nothing" behavior
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;

      const safeIndex = ((index % results.length) + results.length) % results.length;
      const result = results[safeIndex];
      setCurrentIndex(safeIndex);

      try {
        // Await display so epub.js finishes loading the section before we highlight
        const cleanup = suppressEpubDisplayError(() => {
          // noop — we call display below with await
        });
        cleanup();
        await rendition.display(result.cfi);
        applyHighlight(result.cfi);
      } catch {
        // Ignore navigation errors (IndexSizeError etc.)
      } finally {
        isNavigatingRef.current = false;
      }
    },
    [rendition, results, applyHighlight]
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
    removeHighlight();
    setQuery('');
    setResults([]);
    setIsSearching(false);
    setCurrentIndex(0);
    setProgress(null);
  }, [removeHighlight]);

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
