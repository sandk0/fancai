/**
 * useChapterManagement - Custom hook for managing chapter tracking and loading
 *
 * Handles chapter number extraction from EPUB location and chapter data loading.
 *
 * FIXED (2025-12-25):
 * - Added AbortController to cancel pending requests on chapter change
 * - Added isRestoringPosition prop to prevent race condition during position restoration
 * - Now uses chapter mapping to correctly match spine hrefs to backend chapter numbers
 *
 * @param book - epub.js Book instance
 * @param rendition - epub.js Rendition instance
 * @param bookId - Book ID for API requests
 * @param getChapterNumberByLocation - Function to map location to chapter number
 * @param isRestoringPosition - Flag to prevent loading during position restoration
 * @returns Current chapter number and chapter change handler
 *
 * @example
 * const { getChapterNumberByLocation } = useChapterMapping(toc, chapters);
 * const { currentChapter, descriptions, images } = useChapterManagement({
 *   book,
 *   rendition,
 *   bookId,
 *   getChapterNumberByLocation,
 *   isRestoringPosition,
 * });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Book, Rendition, Location } from '@/types/epub';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import type { Description, GeneratedImage } from '@/types/api';
import { chapterCache } from '@/services/chapterCache';
import { useAuthStore } from '@/stores/auth';

// Conditional logging - only in development mode
const devLog = import.meta.env.DEV
  ? (...args: unknown[]) => console.log('[useChapterManagement]', ...args)
  : () => { };

const devWarn = import.meta.env.DEV
  ? (...args: unknown[]) => console.warn('[useChapterManagement]', ...args)
  : () => { };

interface UseChapterManagementOptions {
  book: Book | null;
  rendition: Rendition | null;
  bookId: string;
  getChapterNumberByLocation?: ((location: Location) => number | null) | null;
  isRestoringPosition?: boolean; // Flag to prevent loading during position restoration
}

interface UseChapterManagementReturn {
  currentChapter: number;
  descriptions: Description[];
  images: GeneratedImage[];
  isLoadingChapter: boolean;
  isExtractingDescriptions: boolean; // LLM extraction in progress
  cancelExtraction: () => void; // Function to cancel ongoing extraction
}

export const useChapterManagement = ({
  book,
  rendition,
  bookId,
  getChapterNumberByLocation,
  isRestoringPosition = false,
}: UseChapterManagementOptions): UseChapterManagementReturn => {
  // Get userId reactively from auth store - handles PWA resume/rehydration gracefully
  // Using hook instead of getCurrentUserId() which throws during auth rehydration
  const user = useAuthStore((state) => state.user);
  const userId = user?.id || '';

  const [currentChapter, setCurrentChapter] = useState<number>(1);
  const [descriptions, setDescriptions] = useState<Description[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [isExtractingDescriptions, setIsExtractingDescriptions] = useState(false);

  // AbortController for canceling pending API requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track pending chapter to load after restoration completes
  const pendingChapterRef = useRef<number | null>(null);
  // Ref to hold prefetch function to avoid circular dependencies
  const prefetchRef = useRef<((chapter: number) => Promise<void>) | null>(null);

  /**
   * Extract chapter number from EPUB location
   * FIXED: Now uses chapter mapping instead of spineIndex + 1
   */
  const getChapterFromLocation_Internal = useCallback((location: Location): number => {
    try {
      if (!book) return 1;

      const currentHref = location?.start?.href;
      if (!currentHref) {
        return 1;
      }

      // FIXED: Use chapter mapping if available
      if (getChapterNumberByLocation) {
        const mappedChapter = getChapterNumberByLocation(location);
        if (mappedChapter !== null) {
          return mappedChapter;
        }
      }

      // Fallback: use spine index + 1 (old behavior, less reliable)
      const spine = book.spine;
      if (!spine || !spine.items) {
        return 1;
      }

      const spineIndex = spine.items.findIndex((item) => {
        return item.href === currentHref || item.href.includes(currentHref);
      });

      if (spineIndex === -1) {
        return 1;
      }

      const chapter = spineIndex + 1;
      return Math.max(1, chapter);

    } catch (_error) {
      return 1;
    }
  }, [book, getChapterNumberByLocation]);

  /**
   * Load descriptions and images for current chapter
   * ОПТИМИЗАЦИЯ: Использует IndexedDB кэш для избежания повторных API запросов
   * FIXED (2025-12-25): Added AbortController to cancel pending requests
   * FIXED (2026-01-10): Skip loading if userId is not available (PWA rehydration)
   * FIXED (2026-01-20): Removed legacy auto-extraction. Descriptions are strictly read-only.
   */
  const loadChapterData = useCallback(async (chapter: number) => {
    if (!bookId || chapter <= 0) return;

    // Skip if userId is not available (auth rehydrating after PWA resume)
    if (!userId) {
      devLog('Waiting: No userId available, deferring chapter load');
      return;
    }

    // Cancel any previous pending request
    if (abortControllerRef.current) {
      devLog('Aborting: Aborting previous request');
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setIsLoadingChapter(true);
      devLog('Loading: Loading data for chapter:', chapter);

      // Check for abort early
      if (signal.aborted) return;

      // Проверяем кэш
      const cachedData = await chapterCache.get(userId, bookId, chapter);

      // Check for abort after async operation
      if (signal.aborted) {
        devLog('Aborting: Request aborted after cache check');
        return;
      }

      // Проверяем кэш ТОЛЬКО если там есть описания
      if (cachedData && cachedData.descriptions.length > 0) {
        // Используем кэшированные данные
        devLog('Success: Using cached chapter data:', {
          chapter,
          descriptionsCount: cachedData.descriptions.length,
          imagesCount: cachedData.images.length,
        });

        setDescriptions(cachedData.descriptions);
        setImages(cachedData.images);
        setIsLoadingChapter(false);
        return;
      }

      // Кэша нет или он пустой - загружаем с API
      devLog('API: Cache miss or empty, fetching from API...');

      // Load descriptions - STRICTLY READ-ONLY (extract_new=false)
      // Мы больше не запускаем экстракцию автоматически при открытии главы.
      // Это делается только через кнопку "Process Book".
      const descriptionsResponse = await booksAPI.getChapterDescriptions(
        bookId,
        chapter,
        false // Do not extract new
      );

      // Check for abort after API call
      if (signal.aborted) {
        devLog('Aborting: Request aborted after first API call');
        return;
      }

      const loadedDescriptions = descriptionsResponse.nlp_analysis.descriptions || [];

      if (loadedDescriptions.length === 0) {
        devLog('Info: No descriptions found for chapter. Auto-extraction is disabled.');
      } else {
        devLog('Success: Descriptions loaded:', {
          count: loadedDescriptions.length,
          sampleDescription: loadedDescriptions[0] ? {
            id: loadedDescriptions[0].id,
            type: loadedDescriptions[0].type,
            textLength: loadedDescriptions[0].text?.length || 0,
            contentLength: loadedDescriptions[0].content?.length || 0,
          } : null,
        });
      }

      // Load images
      const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);

      // Check for abort after images API call
      if (signal.aborted) {
        devLog('Aborting: Request aborted after images fetch');
        return;
      }

      devLog('Success: Images loaded:', {
        count: imagesResponse.images.length,
        sampleImage: imagesResponse.images[0] ? {
          id: imagesResponse.images[0].id,
          description_id: imagesResponse.images[0].description_id,
          hasUrl: !!imagesResponse.images[0].image_url,
        } : null,
      });

      const loadedImages = imagesResponse.images;

      // Сохраняем в кэш
      await chapterCache.set(userId, bookId, chapter, loadedDescriptions, loadedImages);

      setDescriptions(loadedDescriptions);
      setImages(loadedImages);
      setIsLoadingChapter(false);

      // Prefetch следующих 2 глав в фоне (для плавного UX)
      // Use ref to avoid circular dependency issues
      if (prefetchRef.current) {
        prefetchRef.current(chapter);
      }
    } catch (error: any) {
      // Don't log abort errors
      if (error?.name === 'AbortError') {
        devLog('Aborting: Request aborted');
        return;
      }
      console.error('[useChapterManagement] Error loading chapter data:', error);
      setDescriptions([]);
      setImages([]);
      setIsLoadingChapter(false);
    }
  }, [userId, bookId]);

  /**
   * Prefetch одной главы в фоне
   * Загружает описания и изображения заранее для плавного перехода
   *
   * @param chapterNumber - Номер главы для prefetch
   * @returns Promise<boolean> - true если prefetch успешен
   */
  const prefetchSingleChapter = useCallback(async (
    chapterNumber: number
  ): Promise<boolean> => {
    if (!bookId || chapterNumber <= 0 || !userId) return false;

    try {
      // Проверяем, есть ли уже в кэше
      const cachedData = await chapterCache.get(userId, bookId, chapterNumber);
      if (cachedData && cachedData.descriptions.length > 0) {
        devLog(`Cache: Chapter ${chapterNumber} already cached`);
        return true;
      }

      devLog(`Prefetch: Prefetching chapter ${chapterNumber}...`);

      // Загружаем описания (STRICTLY READ-ONLY)
      const descriptionsResponse = await booksAPI.getChapterDescriptions(
        bookId,
        chapterNumber,
        false
      );

      const loadedDescriptions = descriptionsResponse.nlp_analysis.descriptions || [];

      if (loadedDescriptions.length === 0) {
        devLog(`Skip: Prefetch: no descriptions found for chapter ${chapterNumber}`);
      }

      // Загружаем изображения
      const imagesResponse = await imagesAPI.getBookImages(bookId, chapterNumber);

      // Сохраняем в кэш (даже если описаний нет - чтобы избежать повторных запросов)
      if (loadedDescriptions.length > 0) {
        await chapterCache.set(userId, bookId, chapterNumber, loadedDescriptions, imagesResponse.images);
      }

      devLog(`Success: Prefetched chapter ${chapterNumber}: ${loadedDescriptions.length} descriptions, ${imagesResponse.images.length} images`);
      return true;
    } catch (error) {
      // Тихо игнорируем ошибки prefetch - это не критично
      devWarn(`Warning: Prefetch failed for chapter ${chapterNumber}:`, error);
      return false;
    }
  }, [userId, bookId]);

  /**
   * Prefetch нескольких глав используя Batch API
   *
   * UPDATED (2025-12-25): Phase 3 + P2.3 - batch API + backward prefetch
   * - Batch API загружает описания для N глав одним запросом
   * - Images загружаются отдельно (параллельно)
   * - P2.3: Добавлен prefetch предыдущей главы для плавной навигации назад
   * - Fallback на individual calls если batch fails
   */
  const prefetchNextChapters = useCallback(async (currentChapter: number) => {
    const CHAPTERS_TO_PREFETCH_FORWARD = 2;
    const CHAPTERS_TO_PREFETCH_BACKWARD = 1; // P2.3: Backward prefetch

    // Определяем главы для prefetch (forward + backward)
    const chaptersToFetch: number[] = [];

    // P2.3: Добавляем предыдущую главу (для навигации назад)
    for (let i = 1; i <= CHAPTERS_TO_PREFETCH_BACKWARD; i++) {
      const prevChapter = currentChapter - i;
      if (prevChapter > 0) {
        const cached = await chapterCache.get(userId, bookId, prevChapter);
        if (!cached || cached.descriptions.length === 0) {
          chaptersToFetch.push(prevChapter);
        } else {
          devLog(`Cache: Chapter ${prevChapter} already cached, skipping`);
        }
      }
    }

    // Добавляем следующие главы
    for (let i = 1; i <= CHAPTERS_TO_PREFETCH_FORWARD; i++) {
      const nextChapter = currentChapter + i;
      if (nextChapter > 0) {
        // Проверяем кэш перед добавлением
        const cached = await chapterCache.get(userId, bookId, nextChapter);
        if (!cached || cached.descriptions.length === 0) {
          chaptersToFetch.push(nextChapter);
        } else {
          devLog(`Cache: Chapter ${nextChapter} already cached, skipping`);
        }
      }
    }

    if (chaptersToFetch.length === 0) {
      devLog('Cache: All chapters already cached');
      return;
    }

    // Sort for consistent batch ordering (prev chapters first, then next)
    chaptersToFetch.sort((a, b) => a - b);

    devLog(`Prefetch: Batch prefetch chapters (backward+forward): ${chaptersToFetch.join(', ')}`);

    try {
      // 1. Batch fetch descriptions (1 HTTP request instead of N)
      const batchResponse = await booksAPI.getBatchDescriptions(bookId, chaptersToFetch);

      devLog(
        `Success: Batch response: ${batchResponse.total_success}/${batchResponse.total_requested} chapters, ` +
        `${batchResponse.total_descriptions} descriptions`
      );

      // 2. Process each chapter and fetch images
      for (const result of batchResponse.chapters) {
        if (!result.success || !result.data) {
          devWarn(`Warning: Batch: chapter ${result.chapter_number} failed: ${result.error}`);
          continue;
        }

        const descriptions = result.data.nlp_analysis.descriptions || [];

        // Fetch images for this chapter (separate call)
        try {
          const imagesResponse = await imagesAPI.getBookImages(bookId, result.chapter_number);

          // Save to cache
          if (descriptions.length > 0) {
            await chapterCache.set(
              userId,
              bookId,
              result.chapter_number,
              descriptions,
              imagesResponse.images
            );
            devLog(
              `Cached chapter ${result.chapter_number}: ` +
              `${descriptions.length} descriptions, ${imagesResponse.images.length} images`
            );
          }
        } catch (imgError) {
          // Cache descriptions even if images fail
          if (descriptions.length > 0) {
            await chapterCache.set(userId, bookId, result.chapter_number, descriptions, []);
            devLog(
              `Cached chapter ${result.chapter_number} without images: ${descriptions.length} descriptions`
            );
          }
        }
      }

      // 3. Log chapters without descriptions (don't trigger LLM in prefetch)
      // FIX: Don't trigger LLM extraction in prefetch - it confuses users when
      // "AI analyzing" shows while they're still reading another chapter.
      // LLM extraction will happen automatically when user opens the chapter.
      const emptyChapters = batchResponse.chapters.filter(
        r => r.success && r.data && r.data.nlp_analysis.descriptions.length === 0
      );

      if (emptyChapters.length > 0) {
        devLog(
          `Skip: Chapters without descriptions: ${emptyChapters.map(c => c.chapter_number).join(', ')}. ` +
          `Will extract when opened.`
        );
        // NOTE: LLM extraction disabled in prefetch to avoid confusion.
        // Extraction happens on-demand when user navigates to the chapter.
      }

      // REMOVED: Auto-extraction disabled (2026-01-20)
      // Description extraction is now triggered manually via "Process Book" button
      // to give users control over when/if to process descriptions
      // const nextChapterNumber = currentChapter + 1;
      // booksAPI.triggerBackgroundExtraction(...)

    } catch (error) {
      devWarn('Warning: Batch prefetch failed, falling back to individual calls:', error);

      // Fallback: individual prefetch
      for (const chapterNum of chaptersToFetch) {
        await prefetchSingleChapter(chapterNum);
      }
    }
  }, [userId, bookId, prefetchSingleChapter]);

  // Keep ref updated with latest prefetch function
  useEffect(() => {
    prefetchRef.current = prefetchNextChapters;
  }, [prefetchNextChapters]);

  /**
   * Listen to relocated events to detect chapter changes
   */
  useEffect(() => {
    if (!rendition || !book) return;

    const handleRelocated = (location: Location) => {
      const chapter = getChapterFromLocation_Internal(location);
      setCurrentChapter(chapter);
    };

    rendition.on('relocated', handleRelocated as (...args: unknown[]) => void);

    // Get initial chapter - safely check if currentLocation exists
    // Wait a bit for rendition to be fully initialized
    const timer = setTimeout(() => {
      try {
        // Check if currentLocation method exists and rendition.location is ready
        if (rendition.currentLocation && typeof rendition.currentLocation === 'function') {
          const currentLocation = rendition.currentLocation();
          if (currentLocation) {
            const initialChapter = getChapterFromLocation_Internal(currentLocation);
            setCurrentChapter(initialChapter);
            devLog('Chapter: Initial chapter set:', initialChapter);
          }
        }
      } catch (error) {
        devWarn('Warning: Could not get initial location:', error);
        // Fallback to chapter 1
        setCurrentChapter(1);
      }
    }, 100); // Small delay to ensure rendition is ready

    return () => {
      clearTimeout(timer);
      rendition.off('relocated', handleRelocated as (...args: unknown[]) => void);
    };
  }, [rendition, book, getChapterFromLocation_Internal]);

  /**
   * Load chapter data when chapter changes
   * FIXED (2025-12-25): Skip loading during position restoration to prevent race condition
   * FIXED (2026-01-10): Also trigger when userId becomes available (PWA rehydration)
   */
  useEffect(() => {
    if (currentChapter > 0) {
      if (isRestoringPosition) {
        // Store pending chapter to load after restoration completes
        devLog('Waiting: Position restoration in progress, deferring chapter load:', currentChapter);
        pendingChapterRef.current = currentChapter;
      } else if (userId) {
        // Only load if userId is available
        loadChapterData(currentChapter);
      } else {
        // userId not yet available (PWA rehydrating), defer loading
        devLog('Waiting: No userId, deferring chapter load:', currentChapter);
        pendingChapterRef.current = currentChapter;
      }
    }
  }, [currentChapter, loadChapterData, isRestoringPosition, userId]);

  /**
   * Load pending chapter after position restoration completes OR userId becomes available
   * FIXED (2026-01-10): Also load when userId becomes available (PWA rehydration)
   */
  useEffect(() => {
    if (!isRestoringPosition && userId && pendingChapterRef.current !== null) {
      devLog('Success: Ready to load pending chapter:', pendingChapterRef.current);
      loadChapterData(pendingChapterRef.current);
      pendingChapterRef.current = null;
    }
  }, [isRestoringPosition, loadChapterData, userId]);

  /**
   * Cleanup: abort pending requests on unmount
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        devLog('Cleanup: Cleanup: aborting pending request');
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /**
   * Периодическая очистка устаревших записей кэша
   * Запускается при монтировании компонента (1 раз при открытии книги)
   */
  useEffect(() => {
    // Запускаем maintenance асинхронно, не блокируя UI
    chapterCache.performMaintenance().catch((err) => {
      devWarn('Warning: Cache maintenance failed:', err);
    });
  }, []); // Только при монтировании

  /**
   * Cancel ongoing extraction (user-triggered)
   */
  const cancelExtraction = useCallback(() => {
    if (abortControllerRef.current) {
      devLog('Aborting: User cancelled extraction');
      abortControllerRef.current.abort();
      setIsExtractingDescriptions(false);
      setIsLoadingChapter(false);
    }
  }, []);

  return {
    currentChapter,
    descriptions,
    images,
    isLoadingChapter,
    isExtractingDescriptions,
    cancelExtraction,
  };
};
