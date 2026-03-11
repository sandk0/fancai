import React, { useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useBookSearch } from '@/hooks/epub/useBookSearch';
import { useIsMobile } from '@/hooks/shared/useIsMobile';
import type { Book, Rendition } from '@/types/epub';

interface SearchPanelProps {
  book: Book | null;
  rendition: Rendition | null;
  isOpen: boolean;
  onClose: () => void;
  /** Whether the reader header is currently visible (affects top positioning) */
  isHeaderVisible?: boolean;
}

export const SearchPanel = memo(function SearchPanel({
  book,
  rendition,
  isOpen,
  onClose,
  isHeaderVisible = true,
}: SearchPanelProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    query,
    results,
    isSearching,
    currentIndex,
    progress,
    searchBook,
    nextResult,
    previousResult,
    clearSearch,
    setQuery,
  } = useBookSearch({ book, rendition });

  // Focus input when panel opens (desktop only to avoid mobile keyboard popup)
  useEffect(() => {
    if (isOpen && !isMobile) {
      // Small delay so the animation can start before focus
      const id = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
  }, [isOpen, isMobile]);

  // Clear search when panel closes
  useEffect(() => {
    if (!isOpen) {
      clearSearch();
    }
  }, [isOpen, clearSearch]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (value.trim().length >= 2) {
        debounceRef.current = setTimeout(() => {
          searchBook(value);
        }, 300);
      }
    },
    [setQuery, searchBook]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          previousResult();
        } else {
          nextResult();
        }
      }
    },
    [onClose, nextResult, previousResult]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const statusText = (() => {
    if (isSearching && progress) {
      return t('reader.search.searching', {
        current: progress.current,
        total: progress.total,
      });
    }
    if (!isSearching && query.trim().length >= 2 && results.length > 0) {
      return t('reader.search.results', {
        current: currentIndex + 1,
        total: results.length,
      });
    }
    if (!isSearching && query.trim().length >= 2 && results.length === 0) {
      return t('reader.search.no_results');
    }
    return null;
  })();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Transparent backdrop for outside-click dismiss */}
          <m.div
            key="search-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[19]"
            onClick={onClose}
            aria-hidden="true"
          />
          <m.div
            key="search-panel"
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed left-0 right-0 z-20 bg-card/95 backdrop-blur-md shadow-md border-b border-border"
            style={{
              top: isHeaderVisible
                ? 'calc(70px + env(safe-area-inset-top, 0px))'
                : 'env(safe-area-inset-top, 0px)',
            }}
          >
            <div className="flex items-center gap-1.5 xs:gap-2 px-2 xs:px-3 py-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={t('reader.search.placeholder')}
                className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />

              {statusText && (
                <span className="hidden xs:inline text-xs text-muted-foreground whitespace-nowrap min-w-[80px] text-center">
                  {statusText}
                </span>
              )}

              <div className="flex items-center gap-0.5">
                <button
                  onClick={previousResult}
                  disabled={results.length === 0}
                  className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                  aria-label={t('reader.search.previous')}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={nextResult}
                  disabled={results.length === 0}
                  className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                  aria-label={t('reader.search.next')}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={onClose}
                className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-foreground hover:bg-muted"
                aria-label={t('reader.search.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
});
