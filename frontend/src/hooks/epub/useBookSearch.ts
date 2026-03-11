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

  const currentIndexRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const highlightedCfiRef = useRef<string | null>(null);

  // === DEBUG: On-screen log overlay for PWA ===
  const patchedRef = useRef(false);
  const debugLogRef = useRef<string[]>([]);
  const debugElRef = useRef<HTMLDivElement | null>(null);

  const dlog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('ru', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const line = `${ts} ${msg}`;
    debugLogRef.current = [...debugLogRef.current.slice(-30), line];
    if (!debugElRef.current) {
      const el = document.createElement('div');
      el.id = 'search-debug-overlay';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        maxHeight: '40vh',
        overflowY: 'auto',
        zIndex: '9999',
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        fontSize: '11px',
        fontFamily: 'monospace',
        padding: '4px 8px',
        pointerEvents: 'auto',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.4',
      });
      document.body.appendChild(el);
      debugElRef.current = el;
    }
    debugElRef.current.textContent = debugLogRef.current.join('\n');
    debugElRef.current.scrollTop = debugElRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (!rendition || patchedRef.current) return;
    patchedRef.current = true;
    const orig = rendition.display.bind(rendition);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = rendition as any;
    r.display = function (target: unknown) {
      const t = typeof target === 'string' ? target.substring(0, 60) : String(target);
      const qLen = r.q?._q?.length ?? '?';
      const qRun = !!r.q?.running;
      const disp = !!r.displaying;
      dlog(`[DISPLAY] cfi=${t} q=${qLen} run=${qRun} disp=${disp}`);
      const promise = orig(target as string);
      promise.then(
        () => dlog(`[DISPLAY OK] ${t}`),
        (err: unknown) => dlog(`[DISPLAY FAIL] ${String(err)}`)
      );
      return promise;
    };
    return () => {
      r.display = orig;
      patchedRef.current = false;
      if (debugElRef.current) {
        debugElRef.current.remove();
        debugElRef.current = null;
      }
    };
  }, [rendition, dlog]);
  // === END DEBUG ===

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

          // Navigate to first result using CFI for precise positioning
          if (allResults.length > 0 && rendition) {
            suppressEpubDisplayError(() => {
              rendition.display(allResults[0].cfi).catch(() => {});
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
      const prevResult = safeIndex > 0 ? results[safeIndex - 1] : null;
      const sameSec = prevResult?.sectionIndex === result.sectionIndex;
      dlog(
        `[NAV] i=${safeIndex}/${results.length} sec=${result.sectionIndex} same=${sameSec} cfi=${result.cfi.substring(0, 60)}`
      );
      suppressEpubDisplayError(() => {
        rendition.display(result.cfi).catch(() => {});
      });
      applyHighlight(result.cfi);
    },
    [rendition, results, applyHighlight, dlog]
  );

  const nextResult = useCallback(() => {
    if (results.length === 0) return;
    dlog(`[NEXT] ref=${currentIndexRef.current}`);
    navigateToResult(currentIndexRef.current + 1);
  }, [results.length, navigateToResult, dlog]);

  const previousResult = useCallback(() => {
    if (results.length === 0) return;
    dlog(`[PREV] ref=${currentIndexRef.current}`);
    navigateToResult(currentIndexRef.current - 1);
  }, [results.length, navigateToResult, dlog]);

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
