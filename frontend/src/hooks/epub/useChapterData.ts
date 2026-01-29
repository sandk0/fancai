import { useState, useEffect, useRef, useCallback } from 'react';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { chapterCache } from '@/services/chapterCache';
import type { Description, GeneratedImage } from '@/types/api';

const DEBUG = import.meta.env.DEV;

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
  const [isLoading, setIsLoading] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    if (!bookId || !userId || chapter <= 0 || !enabled) return;

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setIsLoading(true);
      if (DEBUG) console.log(`[useChapterData] Loading chapter ${chapter}`);

      // 1. Check Cache
      const cachedData = await chapterCache.get(userId, bookId, chapter);
      if (signal.aborted) return;

      if (cachedData && cachedData.descriptions.length > 0) {
        if (DEBUG) console.log(`[useChapterData] Cache hit for chapter ${chapter}`);
        setDescriptions(cachedData.descriptions);
        setImages(cachedData.images);
        setIsLoading(false);
        return;
      }

      // 2. Fetch from API
      // Descriptions (Read-only)
      const descriptionsResponse = await booksAPI.getChapterDescriptions(
        bookId,
        chapter,
        false // Do not extract new
      );
      if (signal.aborted) return;

      const loadedDescriptions = descriptionsResponse.nlp_analysis.descriptions || [];

      // Images
      const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
      if (signal.aborted) return;

      const loadedImages = imagesResponse.images;

      // 3. Update Cache
      await chapterCache.set(userId, bookId, chapter, loadedDescriptions, loadedImages);

      setDescriptions(loadedDescriptions);
      setImages(loadedImages);
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error(`[useChapterData] Error loading chapter ${chapter}:`, error);
      setDescriptions([]);
      setImages([]);
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [bookId, chapter, userId, enabled]);

  // Trigger load when dependencies change
  useEffect(() => {
    loadData();
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadData]);

  return { descriptions, images, isLoading };
};
