/**
 * useLocationGeneration - Custom hook for generating and caching EPUB locations
 *
 * EPUB.js locations are used for progress tracking and CFI calculations.
 * This hook implements IndexedDB caching to avoid regenerating locations
 * on every page load (which can take 5-10 seconds for large books).
 *
 * Performance improvement: 5-10s → <100ms on subsequent loads
 *
 * @param book - epub.js Book instance
 * @param bookId - Unique identifier for caching
 * @returns Locations instance and loading state
 *
 * @example
 * const { locations, isGenerating } = useLocationGeneration(book, bookId);
 * if (locations) {
 *   const percent = locations.percentageFromCfi(cfi);
 * }
 */

import { useState, useEffect } from 'react';
import type { Book, EpubLocations } from '@/types/epub';
import { logger } from '@/lib/logger';

// Conditional logging - only in development mode
const devLog = import.meta.env.DEV
  ? (...args: unknown[]) => logger.debug('[useLocationGeneration]', ...args)
  : () => {};

interface UseLocationGenerationReturn {
  locations: EpubLocations | null;
  isGenerating: boolean;
  error: string | null;
}

const DB_NAME = 'BookReaderAI';
const DB_VERSION = 1;
const STORE_NAME = 'epub_locations';

// IndexedDB utilities
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'bookId' });
      }
    };
  });
};

const getCachedLocations = async (bookId: string): Promise<string | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(bookId);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.locations : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    devLog('Warning: IndexedDB not available:', err);
    return null;
  }
};

const cacheLocations = async (bookId: string, locations: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        bookId,
        locations,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    devLog('Warning: Could not cache locations:', err);
  }
};

export const useLocationGeneration = (
  book: Book | null,
  bookId: string
): UseLocationGenerationReturn => {
  const [locations, setLocations] = useState<EpubLocations | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!book) return;

    let isMounted = true;

    const generateOrLoadLocations = async () => {
      try {
        setIsGenerating(true);
        setError(null);

        // Ensure book is ready and spine is loaded
        await book.ready;

        // Check if spine exists and is ready
        const spine = book.spine;
        if (!spine || !spine.items || spine.items.length === 0) {
          devLog('Warning: Spine not ready yet, waiting...');
          // Wait a bit more for spine to load
          await new Promise(resolve => setTimeout(resolve, 500));

          // Check again
          if (!spine || !spine.items || spine.items.length === 0) {
            throw new Error('Book spine is not available');
          }
        }

        devLog('Success: Book spine ready with', spine.items.length, 'items');

        // Try to load from cache first
        devLog('Progress: Checking cache for book:', bookId);
        let locationsLoaded = false;

        try {
          const cachedLocations = await getCachedLocations(bookId);

          if (cachedLocations && isMounted) {
            try {
              // Validate cached data format before loading
              if (typeof cachedLocations !== 'string' || cachedLocations.length < 10) {
                throw new Error('Invalid cached locations format');
              }

              devLog('Progress: Loading locations from cache...');
              book.locations.load(cachedLocations);

              // Verify locations loaded correctly
              if (!book.locations.total || book.locations.total <= 0) {
                throw new Error('Locations loaded but total is invalid');
              }

              devLog('Success: Loaded locations from cache, total:', book.locations.total);
              setLocations(book.locations);
              setIsGenerating(false);
              locationsLoaded = true;

            } catch (loadErr) {
              // AUTO-CLEANUP: Remove corrupted cache data and regenerate
              logger.warn('[useLocationGeneration] Corrupted cache detected, auto-cleaning:', loadErr);
              devLog('Warning: Cached locations corrupted, clearing cache and regenerating...');
              await clearCachedLocations(bookId);
              // locationsLoaded stays false, will regenerate below
            }
          }
        } catch (cacheErr) {
          devLog('Warning: Cache load failed:', cacheErr);
        }

        if (locationsLoaded) return;
        if (!isMounted) return;

        // Generate locations if not cached or cache was invalid
        devLog('Progress: Generating locations (this may take a few seconds)...');

        try {
          await book.locations.generate(1600); // 1600 characters per "page"
        } catch (genErr) {
          logger.error('[useLocationGeneration] Generate failed:', genErr);
          // Try with smaller chunk size on mobile
          devLog('Retrying with smaller chunk size...');
          await book.locations.generate(800);
        }

        if (!isMounted) return;

        const total = book.locations.total || 0;
        devLog('Success: Locations generated:', total);

        if (total === 0) {
          logger.error('[useLocationGeneration] Locations generated but total is 0');
          throw new Error('Locations generation returned 0 total');
        }

        // Cache the generated locations
        try {
          const locationsData = book.locations.save();
          await cacheLocations(bookId, locationsData);
          devLog('Cache: Locations cached');
        } catch (saveErr) {
          devLog('Warning: Could not cache locations:', saveErr);
        }

        setLocations(book.locations);
        setIsGenerating(false);

      } catch (err) {
        logger.error('[useLocationGeneration] Error generating locations:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to generate locations');
          setIsGenerating(false);
        }
      }
    };

    generateOrLoadLocations();

    return () => {
      isMounted = false;
    };
  }, [book, bookId]);

  return {
    locations,
    isGenerating,
    error,
  };
};

/**
 * Utility function to clear cached locations for a book
 * Useful when book content has changed
 */
export const clearCachedLocations = async (bookId: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(bookId);

      request.onsuccess = () => {
        devLog('Cache cleared: Cache cleared for book:', bookId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    devLog('Clear cache warning: Could not clear cache:', err);
  }
};
