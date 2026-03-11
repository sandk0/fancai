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

/**
 * Convert range CFI to point CFI for rendition.display().
 *
 * epub.js section.find() returns range CFIs: epubcfi(BASE,START,END)
 * e.g. epubcfi(/6/10!/4/2[id3]/16,/1:453,/1:460)
 *
 * epub.js manager.display() fast path (same-section navigation) calls
 * view.locationOf(target) which throws on range CFIs, permanently blocking
 * the internal queue. Converting to a point CFI avoids this.
 *
 * Point CFI: epubcfi(BASE + START) → epubcfi(/6/10!/4/2[id3]/16/1:453)
 */
const rangeToPointCfi = (cfi: string): string => {
  const inner = cfi.slice(8, -1); // Strip "epubcfi(" and ")"
  const firstComma = inner.indexOf(',');
  if (firstComma === -1) return cfi; // Already a point CFI
  const base = inner.slice(0, firstComma);
  const rest = inner.slice(firstComma + 1);
  const secondComma = rest.indexOf(',');
  const startOffset = secondComma === -1 ? rest : rest.slice(0, secondComma);
  return `epubcfi(${base}${startOffset})`;
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

          // Navigate to first result — use point CFI to avoid queue blocking
          if (allResults.length > 0 && rendition) {
            const displayCfi = rangeToPointCfi(allResults[0].cfi);
            suppressEpubDisplayError(() => {
              rendition.display(displayCfi).catch(() => {});
            });
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
      // Use point CFI for display — range CFIs block epub.js queue on same-section nav
      const displayCfi = rangeToPointCfi(result.cfi);
      suppressEpubDisplayError(() => {
        rendition.display(displayCfi).catch(() => {});
      });
      // Keep range CFI for highlight (annotations need the range)
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
