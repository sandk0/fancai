/**
 * Cache Manager - Unified cache clearing utility
 *
 * Provides centralized cache management for authentication flows.
 * Clears all application caches including:
 * - TanStack Query cache (server state)
 * - IndexedDB caches (chapterCache, imageCache, epub_locations)
 * - Service Worker cache storage (offline assets)
 * - localStorage (pending_sessions)
 * - Reader store state (Zustand)
 *
 * CRITICAL: Must be called on logout to prevent data leakage between users!
 *
 * Security layers cleared:
 * 1. TanStack Query - prevents stale API data
 * 2. Chapter cache - prevents book content leakage
 * 3. Image cache - prevents generated images leakage
 * 4. Reader store - prevents reading position leakage
 * 5. Service Worker cache - prevents offline asset leakage
 * 6. EPUB locations - prevents book structure/navigation leakage
 * 7. Pending sessions - prevents reading history leakage
 *
 * @module utils/cacheManager
 */

import { queryClient } from '@/lib/queryClient';
import { chapterCache } from '@/services/chapterCache';
import { imageCache } from '@/services/imageCache';
import { useReaderStore, ReadingProgress } from '@/stores/reader';
import { STORAGE_KEYS } from '@/types/state';
import { logger } from '@/lib/logger';

/**
 * Result of cache clearing operation
 */
interface ClearCacheResult {
  success: boolean;
  tanstackCleared: boolean;
  chapterCacheCleared: boolean;
  imageCacheCleared: boolean;
  readerStoreCleared: boolean;
  serviceWorkerCacheCleared: boolean;
  epubLocationsCleared: boolean;
  pendingSessionsCleared: boolean;
  errors: string[];
}

/**
 * Clear all application caches
 *
 * Should be called:
 * - On logout (mandatory)
 * - On login (to clear any stale data from previous session)
 * - When switching users
 *
 * @returns ClearCacheResult with status of each cache clearing operation
 */
export async function clearAllCaches(): Promise<ClearCacheResult> {
  logger.debug('🧹 [CacheManager] Clearing all caches...');

  const result: ClearCacheResult = {
    success: true,
    tanstackCleared: false,
    chapterCacheCleared: false,
    imageCacheCleared: false,
    readerStoreCleared: false,
    serviceWorkerCacheCleared: false,
    epubLocationsCleared: false,
    pendingSessionsCleared: false,
    errors: [],
  };

  // 1. Clear TanStack Query cache
  try {
    queryClient.clear();
    result.tanstackCleared = true;
    logger.debug('✅ [CacheManager] TanStack Query cache cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`TanStack Query: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear TanStack Query cache:', error);
  }

  // 2. Clear IndexedDB chapter cache
  try {
    // NOTE: clearAll теперь требует userId
    const { useAuthStore } = await import('@/stores/auth');
    const userId = useAuthStore.getState().user?.id;

    if (userId) {
      await chapterCache.clearAll(userId);
      result.chapterCacheCleared = true;
      logger.debug('✅ [CacheManager] Chapter cache cleared for user:', userId);
    } else {
      // Если нет userId (уже разлогинились), пропускаем
      result.chapterCacheCleared = true;
      logger.debug('ℹ️ [CacheManager] No userId available, skipping chapter cache clear');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Chapter cache: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear chapter cache:', error);
  }

  // 3. Clear IndexedDB image cache
  try {
    // NOTE: clearAll теперь требует userId, но на logout мы очищаем ВСЕ данные
    // Получаем userId из auth store перед очисткой
    const { useAuthStore } = await import('@/stores/auth');
    const userId = useAuthStore.getState().user?.id;

    if (userId) {
      await imageCache.clearAll(userId);
      result.imageCacheCleared = true;
      logger.debug('✅ [CacheManager] Image cache cleared for user:', userId);
    } else {
      // Если нет userId (уже разлогинились), пропускаем
      result.imageCacheCleared = true;
      logger.debug('ℹ️ [CacheManager] No userId available, skipping image cache clear');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Image cache: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear image cache:', error);
  }

  // 4. Reset reader store state
  try {
    useReaderStore.getState().reset();
    result.readerStoreCleared = true;
    logger.debug('✅ [CacheManager] Reader store cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Reader store: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear reader store:', error);
  }

  // 5. Clear Service Worker cache storage (CRITICAL for security)
  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      result.serviceWorkerCacheCleared = true;
      logger.debug(`✅ [CacheManager] Service Worker cache cleared (${cacheNames.length} caches)`);
    } else {
      // Browser doesn't support Cache API (not an error)
      result.serviceWorkerCacheCleared = true;
      logger.debug('ℹ️ [CacheManager] Cache API not available (skipped)');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Service Worker cache: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear Service Worker cache:', error);
  }

  // 6. Clear epub_locations IndexedDB (CRITICAL for security)
  try {
    await clearEpubLocationsDB();
    result.epubLocationsCleared = true;
    logger.debug('✅ [CacheManager] EPUB locations IndexedDB cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`EPUB locations: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear EPUB locations:', error);
  }

  // 7. Clear pending_sessions localStorage (HIGH priority)
  try {
    localStorage.removeItem('fancai_pending_sessions');
    result.pendingSessionsCleared = true;
    logger.debug('✅ [CacheManager] Pending sessions localStorage cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Pending sessions: ${message}`);
    logger.error('❌ [CacheManager] Failed to clear pending sessions:', error);
  }

  // Determine overall success
  result.success = result.errors.length === 0;

  if (result.success) {
    logger.debug('✅ [CacheManager] All caches cleared successfully');
  } else {
    logger.warn('⚠️ [CacheManager] Some caches failed to clear:', result.errors);
  }

  return result;
}

/**
 * Clear only TanStack Query cache
 * Use when you need to invalidate queries without clearing IndexedDB
 */
export function clearQueryCache(): void {
  try {
    queryClient.clear();
    logger.debug('✅ [CacheManager] TanStack Query cache cleared');
  } catch (error) {
    logger.error('❌ [CacheManager] Failed to clear TanStack Query cache:', error);
    throw error;
  }
}

/**
 * Invalidate specific query keys
 * Use for targeted cache invalidation
 *
 * @param queryKey - Query key to invalidate
 */
export function invalidateQueries(queryKey: string[]): void {
  try {
    queryClient.invalidateQueries({ queryKey });
    logger.debug('✅ [CacheManager] Queries invalidated:', queryKey);
  } catch (error) {
    logger.error('❌ [CacheManager] Failed to invalidate queries:', error);
    throw error;
  }
}

/**
 * Clear epub_locations IndexedDB database
 * This database stores cached EPUB location data for quick book loading
 *
 * CRITICAL: Must be cleared on logout to prevent data leakage between users
 */
async function clearEpubLocationsDB(): Promise<void> {
  const DB_NAME = 'FancaiCache';
  const STORE_NAME = 'epub_locations';

  return new Promise((resolve, reject) => {
    try {
      // Open the database
      const request = indexedDB.open(DB_NAME);

      request.onerror = () => {
        // Database doesn't exist or can't be opened - not an error
        logger.debug('ℹ️ [CacheManager] EPUB locations DB does not exist (skipped)');
        resolve();
      };

      request.onsuccess = () => {
        const db = request.result;

        // Check if the object store exists
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          logger.debug('ℹ️ [CacheManager] EPUB locations store does not exist (skipped)');
          db.close();
          resolve();
          return;
        }

        try {
          // Clear all entries from the object store
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const clearRequest = store.clear();

          clearRequest.onsuccess = () => {
            logger.debug('✅ [CacheManager] EPUB locations store cleared');
            db.close();
            resolve();
          };

          clearRequest.onerror = () => {
            logger.error(
              '❌ [CacheManager] Failed to clear EPUB locations store:',
              clearRequest.error
            );
            db.close();
            reject(clearRequest.error);
          };

          transaction.onerror = () => {
            logger.error('❌ [CacheManager] Transaction error:', transaction.error);
            db.close();
            reject(transaction.error);
          };
        } catch (error) {
          logger.error('❌ [CacheManager] Error creating transaction:', error);
          db.close();
          reject(error);
        }
      };
    } catch (error) {
      logger.error('❌ [CacheManager] Error opening EPUB locations DB:', error);
      reject(error);
    }
  });
}

/**
 * Reading progress backup data structure
 */
export interface ReadingProgressBackup {
  data: {
    readingProgress: Record<string, ReadingProgress>;
    bookmarks: Record<string, import('@/stores/reader').StoreBookmark[]>;
  };
  savedAt: number;
  userId: string;
}

/**
 * Backup all reading progress data before logout
 *
 * Collects reading progress, bookmarks, and highlights from the reader store
 * and saves them to localStorage for restoration on next login.
 *
 * @param userId - Current user ID for verification on restore
 * @returns Backup data object
 */
export function backupReadingProgress(userId: string): ReadingProgressBackup {
  logger.debug('💾 [CacheManager] Backing up reading progress for user:', userId);

  const readerState = useReaderStore.getState();

  const backup: ReadingProgressBackup = {
    data: {
      readingProgress: readerState.readingProgress,
      bookmarks: readerState.bookmarks,
    },
    savedAt: Date.now(),
    userId,
  };

  // Count items for logging
  const progressCount = Object.keys(backup.data.readingProgress).length;
  const bookmarkCount = Object.values(backup.data.bookmarks).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  logger.debug('💾 [CacheManager] Backup created:', {
    progressCount,
    bookmarkCount,
  });

  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEYS.READING_PROGRESS_BACKUP, JSON.stringify(backup));
    logger.debug('✅ [CacheManager] Reading progress backup saved to localStorage');
  } catch (error) {
    logger.error('❌ [CacheManager] Failed to save backup to localStorage:', error);
  }

  return backup;
}

/**
 * Restore reading progress from backup after login
 *
 * Checks for existing backup in localStorage and restores it
 * if the user ID matches. Clears backup after successful restore.
 *
 * @param userId - User ID to verify backup belongs to this user
 * @returns true if restore was successful, false otherwise
 */
export function restoreReadingProgress(userId: string): boolean {
  logger.debug('📂 [CacheManager] Checking for reading progress backup for user:', userId);

  try {
    const backupStr = localStorage.getItem(STORAGE_KEYS.READING_PROGRESS_BACKUP);

    if (!backupStr) {
      logger.debug('ℹ️ [CacheManager] No reading progress backup found');
      return false;
    }

    const backup: ReadingProgressBackup = JSON.parse(backupStr);

    // Verify user ID matches
    if (backup.userId !== userId) {
      logger.debug('⚠️ [CacheManager] Backup belongs to different user, skipping restore');
      // Remove stale backup from different user
      localStorage.removeItem(STORAGE_KEYS.READING_PROGRESS_BACKUP);
      return false;
    }

    // Check backup age (max 30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    if (Date.now() - backup.savedAt > maxAge) {
      logger.debug('⚠️ [CacheManager] Backup is too old (>30 days), skipping restore');
      localStorage.removeItem(STORAGE_KEYS.READING_PROGRESS_BACKUP);
      return false;
    }

    // Restore data to reader store
    const readerStore = useReaderStore.getState();

    // Merge with any existing data (in case of partial state)
    useReaderStore.setState({
      readingProgress: {
        ...readerStore.readingProgress,
        ...backup.data.readingProgress,
      },
      bookmarks: {
        ...readerStore.bookmarks,
        ...backup.data.bookmarks,
      },
    });

    // Count restored items for logging
    const progressCount = Object.keys(backup.data.readingProgress).length;
    const bookmarkCount = Object.values(backup.data.bookmarks).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    logger.debug('✅ [CacheManager] Reading progress restored:', {
      progressCount,
      bookmarkCount,
      backupAge: Math.round((Date.now() - backup.savedAt) / 1000 / 60) + ' minutes',
    });

    // Clear backup after successful restore
    localStorage.removeItem(STORAGE_KEYS.READING_PROGRESS_BACKUP);
    logger.debug('🧹 [CacheManager] Backup cleared after restore');

    return true;
  } catch (error) {
    logger.error('❌ [CacheManager] Failed to restore reading progress:', error);
    // Clear potentially corrupted backup
    localStorage.removeItem(STORAGE_KEYS.READING_PROGRESS_BACKUP);
    return false;
  }
}
