/**
 * React hook for EPUB file offline management.
 *
 * Provides state and controls for caching EPUB files for offline reading.
 * Integrates with epubCache service and booksAPI.
 *
 * Features:
 * - Download EPUB file for offline reading
 * - Check if EPUB is available offline
 * - Progress tracking during download
 * - Remove EPUB from offline cache
 * - Get EPUB data (from cache or network)
 *
 * @module hooks/useEpubOffline
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { epubCache, epubDb } from '@/services/epubCache';
import { booksAPI } from '@/api/books';
import { useAuthStore } from '@/stores/auth';
import { STORAGE_KEYS } from '@/types/state';
import { isOnline } from './useOnlineStatus';
import { logger } from '@/lib/logger';

/**
 * Create composite ID for EPUB cache lookup
 */
function createEpubId(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

/**
 * Hook for managing EPUB file offline caching.
 *
 * Provides reactive state and controls for EPUB offline management.
 *
 * @param bookId - Book ID
 * @returns EPUB offline state and control functions
 *
 * @example
 * ```tsx
 * const {
 *   isAvailableOffline,
 *   isDownloading,
 *   downloadProgress,
 *   error,
 *   downloadEpub,
 *   removeEpub,
 *   getEpubData,
 * } = useEpubOffline(bookId)
 *
 * if (isAvailableOffline) {
 *   return <span>Available offline</span>
 * }
 *
 * if (isDownloading) {
 *   return <Progress value={downloadProgress} />
 * }
 *
 * return <Button onClick={downloadEpub}>Download for offline</Button>
 * ```
 */
export function useEpubOffline(bookId: string) {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? '';

  // Local state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Abort controller for cancelling downloads
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reactive query to check if EPUB is cached
  const cachedEpub = useLiveQuery(
    async () => {
      if (!userId || !bookId) return null;
      const epub = await epubDb.epubs.get(createEpubId(userId, bookId));
      return epub ?? null;
    },
    [userId, bookId],
    null
  );

  const isAvailableOffline = cachedEpub !== null && cachedEpub !== undefined;

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Download EPUB file for offline reading.
   */
  const downloadEpub = useCallback(async () => {
    if (!userId || !bookId) {
      logger.warn('[useEpubOffline] Cannot download: userId or bookId missing');
      return false;
    }

    // Check if already downloading
    if (isDownloading) {
      logger.warn('[useEpubOffline] Download already in progress');
      return false;
    }

    // Reset state
    setIsDownloading(true);
    setDownloadProgress(0);
    setError(null);

    // Create abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      logger.debug(`[useEpubOffline] Starting download for book ${bookId}`);

      // Get book file URL
      const bookUrl = booksAPI.getBookFileUrl(bookId);
      const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);

      // Download EPUB file with progress tracking
      const response = await fetch(bookUrl, {
        headers: authToken
          ? {
              Authorization: `Bearer ${authToken}`,
            }
          : {},
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to download EPUB: ${response.statusText}`);
      }

      // Get content length for progress tracking
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      // Read response body with progress tracking
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        // Update progress
        if (totalBytes > 0) {
          const progress = Math.round((receivedBytes / totalBytes) * 100);
          setDownloadProgress(progress);
        }
      }

      // Combine chunks into ArrayBuffer
      const allChunks = new Uint8Array(receivedBytes);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }
      const arrayBuffer = allChunks.buffer;

      // Store in cache
      const success = await epubCache.set(userId, bookId, arrayBuffer);

      if (!success) {
        throw new Error('Failed to cache EPUB file');
      }

      logger.debug(`[useEpubOffline] Download complete for book ${bookId}`, {
        size: (receivedBytes / 1024 / 1024).toFixed(2) + 'MB',
      });

      setDownloadProgress(100);
      return true;
    } catch (err) {
      // Don't show error if request was aborted
      if (err instanceof Error && err.name === 'AbortError') {
        logger.debug('[useEpubOffline] Download cancelled');
        return false;
      }

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      logger.error('[useEpubOffline] Download failed:', err);
      setError(errorMessage);
      return false;
    } finally {
      setIsDownloading(false);
      abortControllerRef.current = null;
    }
  }, [userId, bookId, isDownloading]);

  /**
   * Cancel the current download.
   */
  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsDownloading(false);
      setDownloadProgress(0);
      logger.debug('[useEpubOffline] Download cancelled by user');
    }
  }, []);

  /**
   * Remove EPUB from offline cache.
   */
  const removeEpub = useCallback(async () => {
    if (!userId || !bookId) {
      logger.warn('[useEpubOffline] Cannot remove: userId or bookId missing');
      return false;
    }

    try {
      await epubCache.delete(userId, bookId);
      logger.debug(`[useEpubOffline] Removed EPUB for book ${bookId}`);
      return true;
    } catch (err) {
      logger.error('[useEpubOffline] Failed to remove EPUB:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove');
      return false;
    }
  }, [userId, bookId]);

  /**
   * Get EPUB data - from cache if available, otherwise from network.
   * Returns null if offline and not cached.
   */
  const getEpubData = useCallback(async (): Promise<ArrayBuffer | null> => {
    if (!userId || !bookId) {
      logger.warn('[useEpubOffline] Cannot get EPUB: userId or bookId missing');
      return null;
    }

    // Try cache first - ALWAYS check cache regardless of network status
    const cached = await epubCache.get(userId, bookId);
    if (cached) {
      logger.debug('[useEpubOffline] Cache HIT for:', bookId);
      return cached;
    }

    // If not in cache, check network connectivity
    if (!isOnline()) {
      logger.debug('[useEpubOffline] Offline and no cache for:', bookId);
      return null;
    }

    // Fetch from network (only if not cached and online)
    try {
      const bookUrl = booksAPI.getBookFileUrl(bookId);
      const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);

      const response = await fetch(bookUrl, {
        headers: authToken
          ? {
              Authorization: `Bearer ${authToken}`,
            }
          : {},
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch EPUB: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      // Auto-cache for offline access (fire-and-forget)
      epubCache.set(userId, bookId, arrayBuffer).catch((err) => {
        logger.warn('[useEpubOffline] Auto-cache failed:', err);
      });

      logger.debug('[useEpubOffline] Fetched EPUB from network for:', bookId);

      return arrayBuffer;
    } catch (err) {
      logger.error('[useEpubOffline] Failed to fetch EPUB:', err);
      return null;
    }
  }, [userId, bookId]);

  /**
   * Clear error state.
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    /** Whether the EPUB is available offline */
    isAvailableOffline,

    /** Whether a download is in progress */
    isDownloading,

    /** Download progress (0-100) */
    downloadProgress,

    /** Error message if download/removal failed */
    error,

    /** Cached EPUB metadata (size, dates) */
    cachedEpub,

    /** File size in MB (if cached) */
    fileSizeMB: cachedEpub ? cachedEpub.size / 1024 / 1024 : 0,

    /** Download EPUB for offline reading */
    downloadEpub,

    /** Cancel the current download */
    cancelDownload,

    /** Remove EPUB from offline cache */
    removeEpub,

    /** Get EPUB data (from cache or network) */
    getEpubData,

    /** Clear error state */
    clearError,
  };
}

/**
 * Hook for getting EPUB cache storage info.
 *
 * @returns Storage info for EPUB cache
 */
export function useEpubCacheInfo() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? '';

  const cacheInfo = useLiveQuery(
    async () => {
      if (!userId) {
        return {
          totalEpubs: 0,
          totalSizeMB: 0,
          maxSizeMB: 200,
          usagePercent: 0,
          cachedBookIds: [] as string[],
        };
      }

      const [info, cachedBookIds] = await Promise.all([
        epubCache.getStorageInfo(userId),
        epubCache.getCachedBookIds(userId),
      ]);

      return {
        totalEpubs: info.totalEpubs,
        totalSizeMB: info.totalSizeMB,
        maxSizeMB: info.maxSizeMB,
        usagePercent: info.usagePercent,
        cachedBookIds,
      };
    },
    [userId],
    {
      totalEpubs: 0,
      totalSizeMB: 0,
      maxSizeMB: 200,
      usagePercent: 0,
      cachedBookIds: [] as string[],
    }
  );

  /**
   * Clear all EPUB cache for the current user.
   */
  const clearCache = useCallback(async () => {
    if (!userId) return 0;
    return epubCache.clearUser(userId);
  }, [userId]);

  /**
   * Run cleanup to free up space.
   */
  const runCleanup = useCallback(async () => {
    if (!userId) return 0;
    return epubCache.cleanup(userId);
  }, [userId]);

  return {
    ...cacheInfo,
    clearCache,
    runCleanup,
  };
}

export default useEpubOffline;
