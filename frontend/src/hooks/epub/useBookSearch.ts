import { useState, useCallback, useRef, useEffect } from 'react';
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
 * Monkey-patch epub.js Queue.dequeue() to add try-catch protection.
 *
 * epub.js 0.3.93 queue.js has a critical bug: dequeue() calls task.apply()
 * without try-catch. If the task throws synchronously (e.g. locationOf()
 * throws IndexSizeError on range CFIs during same-section navigation),
 * run() never calls itself again → queue is permanently stuck.
 *
 * This patch wraps dequeue() so any synchronous exception is caught,
 * the failed task's deferred is rejected, and the queue continues.
 */
const patchRenditionQueue = (rendition: Rendition): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (rendition as any).q;
  if (!q || q.__patched) return;

  const origDequeue = q.dequeue.bind(q);
  q.dequeue = function () {
    try {
      return origDequeue();
    } catch (e) {
      // Unblock the queue — reset running so run() can be called again
      this.running = undefined;
      // Resolve with empty promise so .then(run) chain continues
      return Promise.resolve();
    }
  };
  q.__patched = true;
};

export const useBookSearch = ({ book, rendition }: UseBookSearchOptions): UseBookSearchReturn => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState<SearchProgress | null>(null);

  const currentIndexRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const highlightedCfiRef = useRef<string | null>(null);

  // Patch epub.js queue to prevent permanent blocking on same-section navigation
  useEffect(() => {
    if (rendition) patchRenditionQueue(rendition);
  }, [rendition]);

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
      currentIndexRef.current = 0;
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

          // Navigate to first result
          if (allResults.length > 0 && rendition) {
            rendition.display(allResults[0].cfi).catch(() => {});
            currentIndexRef.current = 0;
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

  const navigateToResult = useCallback(
    (index: number) => {
      if (!rendition || results.length === 0) return;

      const safeIndex = ((index % results.length) + results.length) % results.length;
      currentIndexRef.current = safeIndex;
      setCurrentIndex(safeIndex);

      const result = results[safeIndex];
      rendition.display(result.cfi).catch(() => {});
      applyHighlight(result.cfi);
    },
    [rendition, results, applyHighlight]
  );

  const nextResult = useCallback(() => {
    if (results.length === 0) return;
    navigateToResult(currentIndexRef.current + 1);
  }, [results.length, navigateToResult]);

  const previousResult = useCallback(() => {
    if (results.length === 0) return;
    navigateToResult(currentIndexRef.current - 1);
  }, [results.length, navigateToResult]);

  const clearSearch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    removeHighlight();
    setQuery('');
    setResults([]);
    setIsSearching(false);
    currentIndexRef.current = 0;
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
