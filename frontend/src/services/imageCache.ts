/**
 * IndexedDB Image Cache Service (Dexie.js)
 *
 * Provides offline caching for generated images using Dexie.js.
 * Migrated from raw IndexedDB for improved developer experience and reliability.
 *
 * Features:
 * - Store images as blobs in IndexedDB via Dexie
 * - Cache expiration (30 days default)
 * - Cache size management
 * - Object URL tracking and cleanup
 * - User data isolation
 *
 * @module services/imageCache
 */

import { db, createImageId, IMAGE_CACHE_TTL, notifyFallbackOnce, type CachedImage } from './db';
import { MemoryTable } from './memoryFallbackCache';

import { logger } from '@/lib/logger';

const MAX_CACHE_SIZE_MB = 100;
const MAX_CACHED_URLS = 100;

const memoryFallback = new MemoryTable<CachedImage>();
let useMemoryFallback = false;

function getImagesTable(): MemoryTable<CachedImage> {
  if (useMemoryFallback) return memoryFallback;
  return db.images as unknown as MemoryTable<CachedImage>;
}

function switchToFallback(err: unknown): void {
  if (!useMemoryFallback) {
    useMemoryFallback = true;
    const errorName = err instanceof Error ? err.constructor.name : 'Unknown';
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`[ImageCache] Switching to in-memory fallback (${errorName}): ${errorMsg}`);
    notifyFallbackOnce();
  }
}

interface CacheStats {
  totalImages: number;
  totalSizeBytes: number;
  oldestCacheDate: Date | null;
  newestCacheDate: Date | null;
}

/**
 * Metadata for tracking Object URLs
 */
interface ObjectURLTracker {
  url: string;
  createdAt: number;
}

/**
 * Image Cache Service using Dexie.js
 */
class ImageCacheService {
  /**
   * Map for tracking created Object URLs
   * Key: descriptionId, Value: ObjectURLTracker
   */
  private objectURLs: Map<string, ObjectURLTracker> = new Map();

  /**
   * Interval ID for automatic cleanup
   */
  private cleanupIntervalId: number | null = null;

  /**
   * Maximum age of Object URL in milliseconds (30 minutes)
   */
  private readonly MAX_OBJECT_URL_AGE_MS = 30 * 60 * 1000;

  constructor() {
    // Start auto cleanup on initialization
    this.startAutoCleanup();
  }

  /**
   * Check if image is cached
   */
  async has(userId: string, descriptionId: string): Promise<boolean> {
    try {
      const id = createImageId(userId, descriptionId);
      const image = await getImagesTable().get(id);

      if (!image) return false;

      if (this.isExpired(image.cachedAt)) {
        this.delete(userId, descriptionId).catch(() => {});
        return false;
      }

      return true;
    } catch (err) {
      switchToFallback(err);
      return false;
    }
  }

  /**
   * Check if an Object URL is still valid
   * Object URLs can become invalid if they're too old or have been revoked
   */
  private isObjectURLValid(descriptionId: string): boolean {
    const urlData = this.objectURLs.get(descriptionId);
    if (!urlData) return false;

    // Check if URL starts with blob:
    if (!urlData.url.startsWith('blob:')) {
      logger.debug('[ImageCache] Invalid Object URL format for:', descriptionId);
      return false;
    }

    // Check age of URL
    const age = Date.now() - urlData.createdAt;
    if (age >= this.MAX_OBJECT_URL_AGE_MS) {
      logger.debug(
        '[ImageCache] Object URL expired for:',
        descriptionId,
        `(age: ${Math.round(age / 1000 / 60)}min)`
      );
      return false;
    }

    return true;
  }

  /**
   * Enforce the maximum number of cached Object URLs
   * Removes the oldest URLs if limit is exceeded
   */
  private enforceURLLimit(): void {
    if (this.objectURLs.size < MAX_CACHED_URLS) return;

    // Find and remove the oldest URL
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, data] of this.objectURLs.entries()) {
      if (data.createdAt < oldestTime) {
        oldestTime = data.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const old = this.objectURLs.get(oldestKey);
      if (old) {
        URL.revokeObjectURL(old.url);
        logger.debug('[ImageCache] Evicted oldest URL due to limit:', oldestKey);
      }
      this.objectURLs.delete(oldestKey);
    }
  }

  /**
   * Get cached image as object URL
   * Returns null if not cached or expired
   *
   * IMPORTANT: The returned URL must be released via release() when no longer needed,
   * otherwise there will be a memory leak!
   */
  async get(userId: string, descriptionId: string): Promise<string | null> {
    try {
      // Check if we already have an Object URL for this description
      const existing = this.objectURLs.get(descriptionId);
      if (existing) {
        // Validate the existing URL
        if (this.isObjectURLValid(descriptionId)) {
          logger.debug('[ImageCache] Reusing existing Object URL for:', descriptionId);
          return existing.url;
        } else {
          // URL is invalid - remove it and create a new one
          logger.debug('[ImageCache] Removing invalid Object URL for:', descriptionId);
          URL.revokeObjectURL(existing.url);
          this.objectURLs.delete(descriptionId);
        }
      }

      const id = createImageId(userId, descriptionId);
      const image = await getImagesTable().get(id);

      if (!image) {
        logger.debug('[ImageCache] Cache miss for:', descriptionId);
        return null;
      }

      if (this.isExpired(image.cachedAt)) {
        logger.debug('[ImageCache] Cache expired for:', descriptionId);
        await this.delete(userId, descriptionId);
        return null;
      }

      // Enforce URL limit before adding a new one
      this.enforceURLLimit();

      // Create object URL from blob
      const objectUrl = URL.createObjectURL(image.blob);

      // Track Object URL for later cleanup
      this.objectURLs.set(descriptionId, {
        url: objectUrl,
        createdAt: Date.now(),
      });

      logger.debug(
        '[ImageCache] Cache hit for:',
        descriptionId,
        `(tracked: ${this.objectURLs.size} URLs)`
      );
      return objectUrl;
    } catch (err) {
      switchToFallback(err);
      return null;
    }
  }

  /**
   * Get cached image as object URL with parsed metadata
   * Returns null if not cached or expired
   *
   * Unlike get(), also returns the stored GeneratedImage metadata (if available).
   * Used by useImageForDescription to reconstruct full GeneratedImage from cache.
   *
   * @returns Object with url and optional metadata, or null
   */
  async getWithMetadata(
    userId: string,
    descriptionId: string
  ): Promise<{ url: string; metadata?: Record<string, unknown> } | null> {
    try {
      // Check if we already have an Object URL for this description
      const existing = this.objectURLs.get(descriptionId);
      if (existing) {
        if (this.isObjectURLValid(descriptionId)) {
          logger.debug('[ImageCache] Reusing existing Object URL for:', descriptionId);
          // Still need to fetch metadata from IndexedDB
          const id = createImageId(userId, descriptionId);
          const image = await getImagesTable().get(id);
          let parsedMetadata: Record<string, unknown> | undefined;
          if (image?.metadata) {
            try {
              parsedMetadata = JSON.parse(image.metadata);
            } catch {
              // Invalid JSON -- return without metadata
            }
          }
          return { url: existing.url, metadata: parsedMetadata };
        } else {
          logger.debug('[ImageCache] Removing invalid Object URL for:', descriptionId);
          URL.revokeObjectURL(existing.url);
          this.objectURLs.delete(descriptionId);
        }
      }

      const id = createImageId(userId, descriptionId);
      const image = await getImagesTable().get(id);

      if (!image) {
        logger.debug('[ImageCache] Cache miss for:', descriptionId);
        return null;
      }

      if (this.isExpired(image.cachedAt)) {
        logger.debug('[ImageCache] Cache expired for:', descriptionId);
        await this.delete(userId, descriptionId);
        return null;
      }

      // Enforce URL limit before adding a new one
      this.enforceURLLimit();

      // Create object URL from blob
      const objectUrl = URL.createObjectURL(image.blob);

      // Track Object URL for later cleanup
      this.objectURLs.set(descriptionId, {
        url: objectUrl,
        createdAt: Date.now(),
      });

      // Parse metadata if available
      let parsedMetadata: Record<string, unknown> | undefined;
      if (image.metadata) {
        try {
          parsedMetadata = JSON.parse(image.metadata);
        } catch {
          // Invalid JSON -- return without metadata
        }
      }

      logger.debug(
        '[ImageCache] Cache hit with metadata for:',
        descriptionId,
        `(tracked: ${this.objectURLs.size} URLs, hasMetadata: ${!!parsedMetadata})`
      );
      return { url: objectUrl, metadata: parsedMetadata };
    } catch (err) {
      switchToFallback(err);
      return null;
    }
  }

  /**
   * Release Object URL for a description
   * Should be called when the image is no longer needed (e.g., on component unmount)
   *
   * @returns true if URL was released, false if URL not found
   */
  release(descriptionId: string): boolean {
    const tracker = this.objectURLs.get(descriptionId);
    if (tracker) {
      URL.revokeObjectURL(tracker.url);
      this.objectURLs.delete(descriptionId);
      logger.debug(
        '[ImageCache] Released Object URL for:',
        descriptionId,
        `(tracked: ${this.objectURLs.size} URLs)`
      );
      return true;
    }
    return false;
  }

  /**
   * Release multiple Object URLs
   *
   * @returns Number of released URLs
   */
  releaseMany(descriptionIds: string[]): number {
    let releasedCount = 0;
    for (const id of descriptionIds) {
      if (this.release(id)) {
        releasedCount++;
      }
    }
    return releasedCount;
  }

  /**
   * Store image in cache
   * Downloads the image from URL and stores as blob
   *
   * P7 FIX: Skips writes when app is not visible to prevent IndexedDB corruption
   */
  async set(
    userId: string,
    descriptionId: string,
    imageUrl: string,
    bookId: string,
    imageMetadata?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      // P7 FIX: Skip cache writes when app is not visible to prevent corruption
      // during background/foreground transitions (PWA "Forever Broken Book" bug)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        logger.debug('[ImageCache] Skipping set() - app not visible:', descriptionId);
        return false;
      }

      // Download image as blob using HttpOnly cookies for auth (TD-FRONT-102)
      logger.debug('[ImageCache] Downloading image for caching:', descriptionId);
      const response = await fetch(imageUrl, {
        credentials: 'include',
      });

      if (!response.ok) {
        logger.warn('[ImageCache] Failed to download image:', response.status);
        return false;
      }

      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';

      // Check cache size before adding
      await this.ensureCacheSize(userId, blob.size);

      const id = createImageId(userId, descriptionId);

      const cachedImage: CachedImage = {
        id,
        userId,
        descriptionId,
        bookId,
        blob,
        mimeType,
        size: blob.size,
        cachedAt: Date.now(),
        metadata: imageMetadata ? JSON.stringify(imageMetadata) : undefined,
      };

      await getImagesTable().put(cachedImage);

      logger.debug('[ImageCache] Image cached:', {
        userId,
        descriptionId,
        size: (blob.size / 1024).toFixed(1) + 'KB',
      });

      return true;
    } catch (err) {
      switchToFallback(err);
      return false;
    }
  }

  /**
   * Delete cached image
   * Also releases corresponding Object URL if it exists
   */
  async delete(userId: string, descriptionId: string): Promise<boolean> {
    try {
      // Release Object URL if exists
      this.release(descriptionId);

      const id = createImageId(userId, descriptionId);
      await getImagesTable().delete(id);

      logger.debug('[ImageCache] Deleted:', descriptionId);
      return true;
    } catch (err) {
      switchToFallback(err);
      return false;
    }
  }

  /**
   * Clear all cached images for a book
   * Also releases all related Object URLs
   */
  async clearBook(userId: string, bookId: string): Promise<number> {
    try {
      const images = await getImagesTable().where({ userId, bookId }).toArray();

      const descriptionIds = images.map((img) => img.descriptionId);
      const ids = images.map((img) => img.id);

      await getImagesTable().bulkDelete(ids);

      if (descriptionIds.length > 0) {
        this.releaseMany(descriptionIds);
      }

      logger.debug('[ImageCache] Cleared book cache:', {
        userId,
        bookId,
        deletedCount: ids.length,
      });

      return ids.length;
    } catch (err) {
      switchToFallback(err);
      return 0;
    }
  }

  /**
   * Clear all expired entries for a user
   */
  async clearExpired(userId: string): Promise<number> {
    try {
      const expirationTime = Date.now() - IMAGE_CACHE_TTL;

      const images = await getImagesTable()
        .where('userId')
        .equals(userId)
        .filter((img) => img.cachedAt < expirationTime)
        .toArray();

      const ids = images.map((img) => img.id);
      const descriptionIds = images.map((img) => img.descriptionId);

      if (ids.length > 0) {
        await getImagesTable().bulkDelete(ids);
        this.releaseMany(descriptionIds);
      }

      logger.debug('[ImageCache] Cleared expired entries:', {
        userId,
        deletedCount: ids.length,
      });

      return ids.length;
    } catch (err) {
      switchToFallback(err);
      return 0;
    }
  }

  /**
   * Clear all cached images for a user
   */
  async clearAll(userId: string): Promise<number> {
    try {
      const images = await getImagesTable().where('userId').equals(userId).toArray();

      const ids = images.map((img) => img.id);
      const descriptionIds = images.map((img) => img.descriptionId);

      if (ids.length > 0) {
        await getImagesTable().bulkDelete(ids);
        this.releaseMany(descriptionIds);
      }

      logger.debug('[ImageCache] All cache cleared for user:', {
        userId,
        deletedCount: ids.length,
      });

      return ids.length;
    } catch (err) {
      switchToFallback(err);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(userId?: string): Promise<CacheStats> {
    try {
      let images: CachedImage[];

      if (userId) {
        images = await getImagesTable().where('userId').equals(userId).toArray();
      } else {
        images = await getImagesTable().toArray();
      }

      const stats: CacheStats = {
        totalImages: images.length,
        totalSizeBytes: 0,
        oldestCacheDate: null,
        newestCacheDate: null,
      };

      for (const img of images) {
        stats.totalSizeBytes += img.size;

        const cacheDate = new Date(img.cachedAt);
        if (!stats.oldestCacheDate || cacheDate < stats.oldestCacheDate) {
          stats.oldestCacheDate = cacheDate;
        }
        if (!stats.newestCacheDate || cacheDate > stats.newestCacheDate) {
          stats.newestCacheDate = cacheDate;
        }
      }

      logger.debug('[ImageCache] Stats:', {
        userId: userId || 'all',
        images: stats.totalImages,
        size: (stats.totalSizeBytes / 1024 / 1024).toFixed(2) + 'MB',
      });

      return stats;
    } catch (err) {
      switchToFallback(err);
      return {
        totalImages: 0,
        totalSizeBytes: 0,
        oldestCacheDate: null,
        newestCacheDate: null,
      };
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > IMAGE_CACHE_TTL;
  }

  /**
   * Ensure cache doesn't exceed size limit for a user
   * Deletes oldest entries if necessary
   */
  private async ensureCacheSize(userId: string, newEntrySize: number): Promise<void> {
    const stats = await this.getStats(userId);
    const maxSizeBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;

    if (stats.totalSizeBytes + newEntrySize > maxSizeBytes) {
      logger.debug('[ImageCache] Cache size exceeded, cleaning oldest entries...');

      // Clear expired first
      await this.clearExpired(userId);

      // If still over limit, delete oldest entries
      const newStats = await this.getStats(userId);
      if (newStats.totalSizeBytes + newEntrySize > maxSizeBytes) {
        // Assume ~50KB per image
        const entriesToDelete = Math.ceil(
          (newStats.totalSizeBytes + newEntrySize - maxSizeBytes) / (50 * 1024)
        );
        await this.deleteOldest(userId, entriesToDelete);
      }
    }
  }

  /**
   * Delete oldest N entries for a user
   */
  private async deleteOldest(userId: string, count: number): Promise<void> {
    try {
      const images = await getImagesTable().where('userId').equals(userId).toArray();

      images.sort((a, b) => a.cachedAt - b.cachedAt);

      const toDelete = images.slice(0, count);
      const ids = toDelete.map((img) => img.id);
      const descriptionIds = toDelete.map((img) => img.descriptionId);

      if (ids.length > 0) {
        await getImagesTable().bulkDelete(ids);
        this.releaseMany(descriptionIds);

        logger.debug('[ImageCache] Deleted oldest entries:', {
          userId,
          deleted: ids.length,
        });
      }
    } catch (err) {
      switchToFallback(err);
    }
  }

  /**
   * Cleanup stale Object URLs (older than MAX_OBJECT_URL_AGE_MS)
   * Automatically called every 5 minutes
   *
   * @returns Number of released URLs
   */
  private cleanupStaleObjectURLs(): number {
    const now = Date.now();
    const staleIds: string[] = [];

    Array.from(this.objectURLs.entries()).forEach(([id, tracker]) => {
      if (now - tracker.createdAt > this.MAX_OBJECT_URL_AGE_MS) {
        staleIds.push(id);
      }
    });

    if (staleIds.length > 0) {
      logger.debug('[ImageCache] Cleaning up stale Object URLs:', staleIds.length);
      return this.releaseMany(staleIds);
    }

    return 0;
  }

  /**
   * Start automatic cleanup of stale Object URLs every minute
   */
  startAutoCleanup(): void {
    if (this.cleanupIntervalId !== null) {
      logger.debug('[ImageCache] Auto-cleanup already started');
      return;
    }

    // Run cleanup every minute for more aggressive memory management
    this.cleanupIntervalId = window.setInterval(() => {
      this.cleanupStaleObjectURLs();
    }, 60 * 1000);

    logger.debug('[ImageCache] Auto-cleanup started (interval: 1 minute)');
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.debug('[ImageCache] Auto-cleanup stopped');
    }
  }

  /**
   * Full cleanup of all resources
   * Should be called on app/component unmount
   *
   * Releases:
   * - All Object URLs
   * - Stops auto-cleanup interval
   */
  destroy(): void {
    logger.debug('[ImageCache] Destroying service...');

    // Release all Object URLs
    const urlCount = this.objectURLs.size;
    Array.from(this.objectURLs.values()).forEach((tracker) => {
      URL.revokeObjectURL(tracker.url);
    });
    this.objectURLs.clear();

    // Stop auto-cleanup
    this.stopAutoCleanup();

    logger.debug('[ImageCache] Service destroyed', {
      releasedURLs: urlCount,
    });
  }

  /**
   * Get count of active Object URLs
   */
  getActiveURLCount(): number {
    return this.objectURLs.size;
  }
}

// Singleton instance
export const imageCache = new ImageCacheService();

// Export types
export type { CacheStats, ObjectURLTracker };
export type { CachedImage } from './db';
