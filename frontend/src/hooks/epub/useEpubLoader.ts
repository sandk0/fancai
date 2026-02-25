import { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import type { Book, Rendition } from '@/types/epub';
import { epubCache } from '@/services/epubCache';
import { isOnline } from '@/hooks/useOnlineStatus';
import { fetchWithTokenRefresh } from '@/utils/fetchWithTokenRefresh';
import { createRendition } from './useEpubRendition';
import { logger } from '@/lib/logger';
import i18n from '@/lib/i18n';

interface UseEpubLoaderOptions {
  bookUrl: string;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  authToken: string | null;
  bookId?: string;
  userId?: string;
  onReady?: () => void;
}

interface UseEpubLoaderReturn {
  book: Book | null;
  rendition: Rendition | null;
  isLoading: boolean;
  error: string;
  reload: () => void;
}

async function fetchEpubData(
  bookId: string | undefined,
  userId: string | undefined,
  bookUrl: string,
  authToken: string | null,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  let arrayBuffer: ArrayBuffer | null = null;

  if (bookId && userId) {
    logger.debug('[useEpubLoader] Checking cache for book:', bookId);
    arrayBuffer = await epubCache.get(userId, bookId);
    if (arrayBuffer) {
      logger.debug('[useEpubLoader] Using cached EPUB for:', bookId);
    }
  }

  if (!arrayBuffer) {
    if (!isOnline()) {
      throw new Error(i18n.t('hooks.epubLoader.offline_unavailable'));
    }

    logger.debug('[useEpubLoader] Fetching EPUB from network:', bookUrl);

    const response = await fetchWithTokenRefresh(bookUrl, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to download EPUB: ${response.statusText}`);
    }

    arrayBuffer = await response.arrayBuffer();
  }

  return arrayBuffer;
}

export const useEpubLoader = ({
  bookUrl,
  viewerRef,
  authToken,
  bookId,
  userId,
  onReady,
}: UseEpubLoaderOptions): UseEpubLoaderReturn => {
  const [book, setBook] = useState<Book | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  const reload = useCallback(() => {
    setError('');
    setReloadKey(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!viewerRef.current) {
      return;
    }

    const viewer = viewerRef.current;
    let isMounted = true;
    let iosFixesCleanup: (() => void) | undefined;
    const abortController = new AbortController();

    const loadEpub = async () => {
      try {
        setIsLoading(true);
        setError('');

        const arrayBuffer = await fetchEpubData(
          bookId, userId, bookUrl, authToken, abortController.signal,
        );

        if (!isMounted) return;

        const epubBook = ePub(arrayBuffer) as unknown as Book;
        bookRef.current = epubBook;
        setBook(epubBook);

        await epubBook.ready;

        if (!isMounted || !viewer) return;

        const { rendition: newRendition, cleanup } = await createRendition(epubBook, viewerRef);
        iosFixesCleanup = cleanup;

        renditionRef.current = newRendition;
        setRendition(newRendition);

        setIsLoading(false);

        if (onReadyRef.current) {
          onReadyRef.current();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        logger.error('[useEpubLoader] Error loading EPUB:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error loading book');
          setIsLoading(false);
        }
      }
    };

    loadEpub();

    return () => {
      isMounted = false;
      abortController.abort();

      iosFixesCleanup?.();
      if (renditionRef.current) {
        try {
          const currentRendition = renditionRef.current;
          try {
            currentRendition.off();
          } catch {
            // Ignore event listener errors
          }
          if (typeof currentRendition.destroy === 'function') {
            currentRendition.destroy();
          }
          renditionRef.current = null;
        } catch {
          // Ignore destruction errors during cleanup
        }
      }

      if (bookRef.current) {
        try {
          const currentBook = bookRef.current;
          if (typeof currentBook.destroy === 'function') {
            currentBook.destroy();
          }
          bookRef.current = null;
        } catch {
          // Ignore destruction errors during cleanup
        }
      }

      setBook(null);
      setRendition(null);
    };
  }, [bookUrl, authToken, bookId, userId, reloadKey, viewerRef]);

  return {
    book,
    rendition,
    isLoading,
    error,
    reload,
  };
};
