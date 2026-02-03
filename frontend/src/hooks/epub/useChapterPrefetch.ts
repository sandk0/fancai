import { useCallback } from 'react';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { chapterCache } from '@/services/chapterCache';
import { logger } from '@/lib/logger';

interface UseChapterPrefetchProps {
  bookId: string;
  userId: string;
}

export const useChapterPrefetch = ({ bookId, userId }: UseChapterPrefetchProps) => {
  const prefetchSingleChapter = useCallback(async (chapter: number): Promise<boolean> => {
    if (!bookId || !userId || chapter <= 0) return false;

    try {
      const cached = await chapterCache.get(userId, bookId, chapter);
      if (cached && cached.descriptions.length > 0) return true;

      logger.debug(`[Prefetch] Loading chapter ${chapter}...`);

      const descriptionsResponse = await booksAPI.getChapterDescriptions(bookId, chapter, false);
      const descriptions = descriptionsResponse.nlp_analysis.descriptions || [];

      const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
      
      // Save even if descriptions empty to cache "empty" state
      if (descriptions.length > 0 || imagesResponse.images.length > 0) {
        await chapterCache.set(userId, bookId, chapter, descriptions, imagesResponse.images);
      }

      return true;
    } catch (e) {
      logger.warn(`[Prefetch] Failed for chapter ${chapter}:`, e);
      return false;
    }
  }, [bookId, userId]);

  const prefetchNextChapters = useCallback(async (currentChapter: number) => {
    if (!bookId || !userId) return;

    const FORWARD = 2;
    const BACKWARD = 1;
    const chaptersToFetch: number[] = [];

    // Backward
    for (let i = 1; i <= BACKWARD; i++) {
      const prev = currentChapter - i;
      if (prev > 0) {
        const cached = await chapterCache.get(userId, bookId, prev);
        if (!cached || cached.descriptions.length === 0) chaptersToFetch.push(prev);
      }
    }

    // Forward
    for (let i = 1; i <= FORWARD; i++) {
      const next = currentChapter + i;
      if (next > 0) {
        const cached = await chapterCache.get(userId, bookId, next);
        if (!cached || cached.descriptions.length === 0) chaptersToFetch.push(next);
      }
    }

    if (chaptersToFetch.length === 0) return;

    chaptersToFetch.sort((a, b) => a - b);
    logger.debug(`[Prefetch] Batch prefetch: ${chaptersToFetch.join(', ')}`);

    try {
      const batchResponse = await booksAPI.getBatchDescriptions(bookId, chaptersToFetch);

      for (const result of batchResponse.chapters) {
        if (!result.success || !result.data) continue;

        const descriptions = result.data.nlp_analysis.descriptions || [];
        
        try {
          const imagesResponse = await imagesAPI.getBookImages(bookId, result.chapter_number);
          
          if (descriptions.length > 0) {
            await chapterCache.set(userId, bookId, result.chapter_number, descriptions, imagesResponse.images);
          }
        } catch {
          // Cache descriptions even if images fail
          if (descriptions.length > 0) {
            await chapterCache.set(userId, bookId, result.chapter_number, descriptions, []);
          }
        }
      }
    } catch (e) {
      logger.warn('[Prefetch] Batch failed, falling back to individual:', e);
      for (const ch of chaptersToFetch) {
        await prefetchSingleChapter(ch);
      }
    }
  }, [bookId, userId, prefetchSingleChapter]);

  return { prefetchNextChapters };
};
