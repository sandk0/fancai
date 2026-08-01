import { useState, useEffect, useRef, useCallback } from 'react';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { chapterCache } from '@/services/chapterCache';
import type { Description, GeneratedImage } from '@/types/api';
import { logger } from '@/lib/logger';

interface UseChapterDataProps {
  bookId: string;
  chapter: number;
  userId: string;
  enabled?: boolean;
}

export const useChapterData = ({
  bookId,
  chapter,
  userId,
  enabled = true,
}: UseChapterDataProps) => {
  const [descriptions, setDescriptions] = useState<Description[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [settled, setSettled] = useState<{ key: string; error: Error | null } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const bgAbortControllerRef = useRef<AbortController | null>(null);

  // Ключ запроса. Пока завершённый ключ не совпал с текущим, данные грузятся.
  // isLoading и error выводятся при рендере, поэтому эффект не вызывает
  // setState синхронно в своём теле.
  const requestKey =
    enabled && bookId && userId && chapter > 0
      ? `${userId}|${bookId}|${chapter}|${reloadNonce}`
      : null;
  const isSettled = requestKey !== null && settled?.key === requestKey;
  const isLoading = requestKey !== null && !isSettled;
  const error = isSettled ? settled.error : null;

  const revalidateInBackground = useCallback(
    async (currentBookId: string, currentChapter: number, cachedDescriptions: Description[]) => {
      // Cancel previous background revalidation
      bgAbortControllerRef.current?.abort();
      const bgController = new AbortController();
      bgAbortControllerRef.current = bgController;

      try {
        const response = await booksAPI.getChapterDescriptions(
          currentBookId,
          currentChapter,
          false,
          bgController.signal
        );
        if (bgController.signal.aborted) return;

        const freshDescriptions = response.nlp_analysis.descriptions || [];

        // Compare by sorted IDs — more reliable than length comparison
        const freshIds = freshDescriptions
          .map((d) => d.id)
          .sort()
          .join(',');
        const cachedIds = cachedDescriptions
          .map((d) => d.id)
          .sort()
          .join(',');

        if (freshIds !== cachedIds) {
          logger.debug(`[useChapterData] Background revalidation: descriptions changed`);
          const imagesResponse = await imagesAPI.getBookImages(
            currentBookId,
            currentChapter,
            0,
            50,
            bgController.signal
          );
          if (bgController.signal.aborted) return;

          const freshImages = imagesResponse.images;
          await chapterCache.set(
            userId,
            currentBookId,
            currentChapter,
            freshDescriptions,
            freshImages
          );

          if (!bgController.signal.aborted) {
            setDescriptions(freshDescriptions);
            setImages(freshImages);
          }
        }
      } catch {
        // Background revalidation failure is non-critical
        logger.debug(
          `[useChapterData] Background revalidation failed for chapter ${currentChapter}`
        );
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    const signal = controller.signal;

    const load = async () => {
      try {
        logger.debug(`[useChapterData] Loading chapter ${chapter}`);

        // 1. Check Cache
        const cachedData = await chapterCache.get(userId, bookId, chapter);
        if (signal.aborted) return;

        if (cachedData && cachedData.descriptions.length > 0) {
          logger.debug(`[useChapterData] Cache hit for chapter ${chapter}`);
          setDescriptions(cachedData.descriptions);
          setImages(cachedData.images);
          setSettled({ key: requestKey, error: null });
          // Stale-while-revalidate: serve cached, update in background
          revalidateInBackground(bookId, chapter, cachedData.descriptions);
          return;
        }

        // 2. Fetch from API
        const descriptionsResponse = await booksAPI.getChapterDescriptions(
          bookId,
          chapter,
          false,
          signal
        );
        if (signal.aborted) return;

        const loadedDescriptions = descriptionsResponse.nlp_analysis.descriptions || [];

        const imagesResponse = await imagesAPI.getBookImages(bookId, chapter, 0, 50, signal);
        if (signal.aborted) return;

        const loadedImages = imagesResponse.images;

        // 3. Update Cache
        await chapterCache.set(userId, bookId, chapter, loadedDescriptions, loadedImages);

        setDescriptions(loadedDescriptions);
        setImages(loadedImages);
        setSettled({ key: requestKey, error: null });
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        logger.error(`[useChapterData] Error loading chapter ${chapter}:`, err);
        setDescriptions([]);
        setImages([]);
        setSettled({
          key: requestKey,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    };

    void load();

    return () => {
      controller.abort();
      bgAbortControllerRef.current?.abort();
    };
  }, [requestKey, bookId, chapter, userId, revalidateInBackground]);

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { descriptions, images, isLoading, error, refetch };
};
