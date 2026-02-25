/**
 * Storage Manager Service
 *
 * Manages storage quota, LRU cleanup, and persistent storage for PWA.
 * Uses Storage API for quota estimation and IndexedDB via Dexie for data management.
 *
 * @module services/storageManager
 */

import { logger } from '@/lib/logger';
import {
  db,
  MAX_CACHE_SIZE,
  STORAGE_WARNING_THRESHOLD,
  STORAGE_CRITICAL_THRESHOLD,
  getChapterCacheTTL,
  IMAGE_CACHE_TTL,
} from './db'

// ============================================================================
// Storage Monitoring Constants
// ============================================================================

/** Check storage pressure every 60 seconds */
const STORAGE_CHECK_INTERVAL = 60_000

/** Minimum bytes to free during normal cleanup (10 MB) */
const NORMAL_CLEANUP_TARGET = 10 * 1024 * 1024

/** Minimum bytes to free during aggressive cleanup (50 MB) */
const AGGRESSIVE_CLEANUP_TARGET = 50 * 1024 * 1024

/** Safari fallback quota when quota is undefined (50 MB) */
const SAFARI_FALLBACK_QUOTA = 50 * 1024 * 1024

// ============================================================================
// Safari Detection Utilities
// ============================================================================

/**
 * Detect if running in Safari browser
 * Safari has different Storage API behavior that requires special handling
 */
export const isSafari = (): boolean => {
  const ua = navigator.userAgent
  return /^((?!chrome|android).)*safari/i.test(ua)
}

/**
 * Detect if running in Safari Private Browsing mode
 * In private mode, localStorage quota is very limited and IndexedDB may have 0 quota
 */
export const isPrivateBrowsing = async (): Promise<boolean> => {
  try {
    // Test localStorage availability
    const testKey = '__storage_test__'
    localStorage.setItem(testKey, testKey)
    localStorage.removeItem(testKey)

    // Safari private browsing has 0 quota for IndexedDB
    if (isSafari() && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate()
        if (estimate && estimate.quota === 0) {
          return true
        }
      } catch {
        // estimate() failed - may be private browsing
        return true
      }
    }
    return false
  } catch {
    // localStorage test failed - likely private browsing
    return true
  }
}

// ============================================================================
// Types
// ============================================================================

/** Storage pressure event for callbacks */
export interface StoragePressureEvent {
  /** Current usage percentage (0-100) */
  usagePercent: number
  /** Used bytes */
  used: number
  /** Available quota */
  quota: number
  /** Warning level reached */
  isWarning: boolean
  /** Critical level reached */
  isCritical: boolean
  /** Cleanup was triggered */
  cleanupTriggered: boolean
}

/** Callback for storage pressure events */
export type StoragePressureCallback = (event: StoragePressureEvent) => void

/** Complete storage information */
export interface StorageInfo {
  /** Used bytes */
  used: number
  /** Available quota */
  quota: number
  /** Free bytes */
  available: number
  /** Usage percentage (0-100) */
  percentUsed: number
  /** Warning level (>80%) */
  isWarning: boolean
  /** Critical level (>95%) */
  isCritical: boolean
  /** Persistent storage is active */
  isPersistent: boolean
  /** Number of offline books */
  offlineBooksCount: number
  /** Number of cached chapters */
  chaptersCount: number
  /** Number of cached images */
  imagesCount: number
}

/** Storage breakdown by data type */
export interface StorageBreakdown {
  /** Chapters size in bytes */
  chapters: number
  /** Images size in bytes */
  images: number
  /** Sync queue size in bytes */
  syncQueue: number
  /** Reading progress size in bytes */
  readingProgress: number
  /** Offline books metadata size in bytes */
  offlineBooks: number
}

/** Cleanup result */
export interface CleanupResult {
  /** Bytes freed */
  freedBytes: number
  /** Number of items removed */
  itemsRemoved: number
  /** Whether target was reached */
  targetReached: boolean
}

// ============================================================================
// Storage Manager Class
// ============================================================================

/**
 * Manages storage quota, LRU cleanup, and persistent storage.
 *
 * Features:
 * - Storage quota estimation via Storage API
 * - Persistent storage request (important for iOS)
 * - LRU-based cleanup strategy
 * - Storage breakdown by data type
 */
class StorageManager {
  private readonly LOG_PREFIX = '[StorageManager]'

  /** Interval ID for periodic storage checks */
  private monitoringInterval: ReturnType<typeof setInterval> | null = null

  /** Callbacks to notify on storage pressure events */
  private pressureCallbacks: Set<StoragePressureCallback> = new Set()

  /** Flag to prevent concurrent cleanup operations */
  private isCleanupInProgress = false

  // ==========================================================================
  // Storage Monitoring Methods
  // ==========================================================================

  /**
   * Start periodic storage pressure monitoring.
   * Checks storage usage every STORAGE_CHECK_INTERVAL ms and triggers cleanup
   * when usage exceeds thresholds.
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      if (import.meta.env.DEV) {
        logger.debug(`${this.LOG_PREFIX} Monitoring already active`)
      }
      return
    }

    if (import.meta.env.DEV) {
      logger.debug(`${this.LOG_PREFIX} Starting storage monitoring`)
    }

    // Initial check
    this.checkStoragePressure()

    // Periodic checks
    this.monitoringInterval = setInterval(
      () => this.checkStoragePressure(),
      STORAGE_CHECK_INTERVAL
    )
  }

  /**
   * Stop storage pressure monitoring.
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null

      if (import.meta.env.DEV) {
        logger.debug(`${this.LOG_PREFIX} Storage monitoring stopped`)
      }
    }
  }

  /**
   * Register a callback for storage pressure events.
   * @returns Unsubscribe function
   */
  onStoragePressure(callback: StoragePressureCallback): () => void {
    this.pressureCallbacks.add(callback)
    return () => {
      this.pressureCallbacks.delete(callback)
    }
  }

  /**
   * Check current storage pressure and trigger cleanup if needed.
   * Called periodically by startMonitoring() and can be called manually.
   * Handles Safari edge cases with zero or undefined quota.
   */
  async checkStoragePressure(): Promise<StoragePressureEvent | null> {
    if (!('storage' in navigator && 'estimate' in navigator.storage)) {
      return null // Storage API not supported
    }

    try {
      // Use our Safari-aware getStorageEstimate method
      const estimate = await this.getStorageEstimate()
      const usage = estimate.usage || 0
      const quota = estimate.quota || 0

      // Prevent division by zero - likely private browsing with 0 quota
      if (quota <= 0) {
        if (import.meta.env.DEV) {
          logger.warn(
            `${this.LOG_PREFIX} Zero quota detected - likely private browsing mode`
          )
        }
        // Return critical event for zero quota (private browsing)
        const criticalEvent: StoragePressureEvent = {
          usagePercent: 100,
          used: usage,
          quota: 0,
          isWarning: true,
          isCritical: true,
          cleanupTriggered: false,
        }
        // Notify callbacks about the critical state
        this.pressureCallbacks.forEach((callback) => {
          try {
            callback(criticalEvent)
          } catch (err) {
            logger.error(`${this.LOG_PREFIX} Pressure callback error:`, err)
          }
        })
        return criticalEvent
      }

      const usagePercent = (usage / quota) * 100
      const isWarning = usagePercent >= STORAGE_WARNING_THRESHOLD * 100
      const isCritical = usagePercent >= STORAGE_CRITICAL_THRESHOLD * 100

      if (import.meta.env.DEV) {
        logger.debug(
          `${this.LOG_PREFIX} Storage usage: ${usagePercent.toFixed(1)}%`,
          `(${this.formatBytes(usage)} / ${this.formatBytes(quota)})`
        )
      }

      let cleanupTriggered = false

      // Trigger cleanup if thresholds exceeded
      if (isCritical && !this.isCleanupInProgress) {
        logger.warn(
          `${this.LOG_PREFIX} Critical storage pressure: ${usagePercent.toFixed(1)}%`
        )
        cleanupTriggered = true
        await this.performLRUCleanup(true)
      } else if (isWarning && !this.isCleanupInProgress) {
        logger.warn(
          `${this.LOG_PREFIX} High storage usage: ${usagePercent.toFixed(1)}%`
        )
        cleanupTriggered = true
        await this.performLRUCleanup(false)
      }

      const event: StoragePressureEvent = {
        usagePercent,
        used: usage,
        quota,
        isWarning,
        isCritical,
        cleanupTriggered,
      }

      // Notify callbacks
      this.pressureCallbacks.forEach((callback) => {
        try {
          callback(event)
        } catch (err) {
          logger.error(`${this.LOG_PREFIX} Pressure callback error:`, err)
        }
      })

      return event
    } catch (err) {
      logger.warn(`${this.LOG_PREFIX} Failed to check storage:`, err)
      return null
    }
  }

  /**
   * Perform LRU-based cleanup based on pressure level.
   * @param aggressive - If true, performs more aggressive cleanup
   */
  private async performLRUCleanup(aggressive: boolean): Promise<void> {
    if (this.isCleanupInProgress) {
      if (import.meta.env.DEV) {
        logger.debug(`${this.LOG_PREFIX} Cleanup already in progress, skipping`)
      }
      return
    }

    this.isCleanupInProgress = true

    try {
      const targetBytes = aggressive
        ? AGGRESSIVE_CLEANUP_TARGET
        : NORMAL_CLEANUP_TARGET

      if (import.meta.env.DEV) {
        logger.debug(
          `${this.LOG_PREFIX} Starting ${aggressive ? 'aggressive' : 'normal'} LRU cleanup,`,
          `target: ${this.formatBytes(targetBytes)}`
        )
      }

      // Use the existing performCleanup method
      const result = await this.performCleanup(targetBytes)

      // If aggressive and target not reached, also clean expired images
      if (aggressive && !result.targetReached) {
        const imageResult = await this.cleanupExpiredImages()
        result.freedBytes += imageResult.freedBytes
        result.itemsRemoved += imageResult.itemsRemoved
      }

      if (import.meta.env.DEV) {
        logger.debug(
          `${this.LOG_PREFIX} Cleanup complete: freed ${this.formatBytes(result.freedBytes)},`,
          `removed ${result.itemsRemoved} items`
        )
      }
    } finally {
      this.isCleanupInProgress = false
    }
  }

  /**
   * Clean up expired images based on IMAGE_CACHE_TTL
   */
  private async cleanupExpiredImages(): Promise<{
    freedBytes: number
    itemsRemoved: number
  }> {
    let freedBytes = 0
    let itemsRemoved = 0

    const cutoffTime = Date.now() - IMAGE_CACHE_TTL

    try {
      const expiredImages = await db.images
        .where('cachedAt')
        .below(cutoffTime)
        .toArray()

      for (const img of expiredImages) {
        freedBytes += img.size
        itemsRemoved++
        await db.images.delete(img.id)
      }

      if (itemsRemoved > 0 && import.meta.env.DEV) {
        logger.debug(
          `${this.LOG_PREFIX} Removed ${itemsRemoved} expired images,`,
          `freed ${this.formatBytes(freedBytes)}`
        )
      }
    } catch (err) {
      logger.warn(`${this.LOG_PREFIX} Failed to clean expired images:`, err)
    }

    return { freedBytes, itemsRemoved }
  }

  // ==========================================================================
  // Storage API Methods
  // ==========================================================================

  /**
   * Get storage estimate via Storage API
   * Falls back to MAX_CACHE_SIZE if API is unavailable
   * Handles Safari-specific quirks where quota may be undefined
   */
  async getStorageEstimate(): Promise<StorageEstimate> {
    if (!navigator.storage?.estimate) {
      // Fallback if API is unavailable
      return { quota: MAX_CACHE_SIZE, usage: 0 }
    }

    try {
      const estimate = await navigator.storage.estimate()

      // Safari may return undefined quota
      if (estimate.quota === undefined) {
        if (import.meta.env.DEV) {
          logger.debug(
            `${this.LOG_PREFIX} Safari: quota undefined, using fallback (${this.formatBytes(SAFARI_FALLBACK_QUOTA)})`
          )
        }

        return {
          usage: estimate.usage || 0,
          quota: SAFARI_FALLBACK_QUOTA,
        }
      }

      return estimate
    } catch (error) {
      logger.warn(`${this.LOG_PREFIX} Failed to get storage estimate:`, error)
      // Fallback if API call fails
      return { quota: MAX_CACHE_SIZE, usage: 0 }
    }
  }

  /**
   * Request persistent storage (important for iOS!)
   * Prevents browser from evicting data under storage pressure
   * Safari may not support persist() in many cases, especially private browsing
   */
  async requestPersistentStorage(): Promise<boolean> {
    // Safari doesn't support persist() in many cases
    if (!navigator.storage?.persist) {
      if (import.meta.env.DEV) {
        logger.debug(`${this.LOG_PREFIX} Persistent storage API not available`)
      }
      return false
    }

    try {
      // Check if already persisted
      const isPersisted = await navigator.storage.persisted?.()
      if (isPersisted) {
        if (import.meta.env.DEV) {
          logger.debug(`${this.LOG_PREFIX} Storage already persistent`)
        }
        return true
      }

      // Request persistence
      const granted = await navigator.storage.persist()
      if (import.meta.env.DEV) {
        logger.debug(
          `${this.LOG_PREFIX} Persistent storage:`,
          granted ? 'granted' : 'denied'
        )
      }
      return granted
    } catch (error) {
      // Safari may throw in private browsing mode
      if (import.meta.env.DEV) {
        logger.warn(`${this.LOG_PREFIX} Persist request failed (may be Safari private browsing):`, error)
      }
      return false
    }
  }

  /**
   * Check if storage is persistent
   */
  async isPersistent(): Promise<boolean> {
    if (!navigator.storage?.persisted) return false
    try {
      return await navigator.storage.persisted()
    } catch {
      return false
    }
  }

  // ==========================================================================
  // Storage Info Methods
  // ==========================================================================

  /**
   * Get complete storage information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    const [estimate, isPersistent, breakdown, counts] = await Promise.all([
      this.getStorageEstimate(),
      this.isPersistent(),
      this.getStorageBreakdown(),
      this.getCounts(),
    ])

    const totalBreakdown =
      breakdown.chapters +
      breakdown.images +
      breakdown.syncQueue +
      breakdown.readingProgress +
      breakdown.offlineBooks

    const quota = Math.min(estimate.quota || MAX_CACHE_SIZE, MAX_CACHE_SIZE)
    const used = estimate.usage || totalBreakdown
    const percentUsed = quota > 0 ? (used / quota) * 100 : 0

    return {
      used,
      quota,
      available: Math.max(0, quota - used),
      percentUsed,
      isWarning: percentUsed >= STORAGE_WARNING_THRESHOLD * 100,
      isCritical: percentUsed >= STORAGE_CRITICAL_THRESHOLD * 100,
      isPersistent,
      offlineBooksCount: counts.offlineBooks,
      chaptersCount: counts.chapters,
      imagesCount: counts.images,
    }
  }

  /**
   * Get storage breakdown by data type
   */
  async getStorageBreakdown(): Promise<StorageBreakdown> {
    const [chapters, images, syncQueue, readingProgress, offlineBooks] =
      await Promise.all([
        this.calculateChaptersSize(),
        this.calculateImagesSize(),
        this.calculateSyncQueueSize(),
        this.calculateReadingProgressSize(),
        this.calculateOfflineBooksSize(),
      ])

    return {
      chapters,
      images,
      syncQueue,
      readingProgress,
      offlineBooks,
    }
  }

  /**
   * Check if download of given size is possible
   * Leaves 20% safety margin
   */
  async canDownload(estimatedSizeBytes: number): Promise<boolean> {
    const info = await this.getStorageInfo()
    // Leave 20% safety margin
    return info.available > estimatedSizeBytes * 1.2
  }

  // ==========================================================================
  // Cleanup Methods
  // ==========================================================================

  /**
   * Perform LRU cleanup to free up space
   * Prioritizes: old images -> old chapters -> sync queue (only failed)
   */
  async performCleanup(targetFreeBytes: number): Promise<CleanupResult> {
    let freedBytes = 0
    let itemsRemoved = 0

    if (import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Starting cleanup, target: ${this.formatBytes(targetFreeBytes)}`
      )
    }

    // 1. Remove old images first (largest footprint)
    const imageResult = await this.cleanupOldImages(targetFreeBytes - freedBytes)
    freedBytes += imageResult.freedBytes
    itemsRemoved += imageResult.itemsRemoved

    if (freedBytes >= targetFreeBytes) {
      return { freedBytes, itemsRemoved, targetReached: true }
    }

    // 2. Remove old chapters (not accessed for getChapterCacheTTL())
    const chapterResult = await this.cleanupOldChapters(targetFreeBytes - freedBytes)
    freedBytes += chapterResult.freedBytes
    itemsRemoved += chapterResult.itemsRemoved

    if (freedBytes >= targetFreeBytes) {
      return { freedBytes, itemsRemoved, targetReached: true }
    }

    // 3. Remove failed sync operations (only failed, not pending!)
    const syncResult = await this.cleanupFailedSyncOperations()
    freedBytes += syncResult.freedBytes
    itemsRemoved += syncResult.itemsRemoved

    // 4. Update offline books status after cleanup
    await this.updateOfflineBooksStatus()

    if (import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Cleanup complete: freed ${this.formatBytes(freedBytes)}, removed ${itemsRemoved} items`
      )
    }

    return {
      freedBytes,
      itemsRemoved,
      targetReached: freedBytes >= targetFreeBytes,
    }
  }

  /**
   * Clean up old images using LRU strategy
   */
  private async cleanupOldImages(
    targetBytes: number
  ): Promise<{ freedBytes: number; itemsRemoved: number }> {
    let freedBytes = 0
    let itemsRemoved = 0

    const oldImages = await db.images.orderBy('cachedAt').limit(100).toArray()

    for (const img of oldImages) {
      if (freedBytes >= targetBytes) break
      freedBytes += img.size
      itemsRemoved++
      await db.images.delete(img.id)
    }

    if (itemsRemoved > 0 && import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Removed ${itemsRemoved} images, freed ${this.formatBytes(freedBytes)}`
      )
    }

    return { freedBytes, itemsRemoved }
  }

  /**
   * Clean up old chapters using LRU strategy
   */
  private async cleanupOldChapters(
    targetBytes: number
  ): Promise<{ freedBytes: number; itemsRemoved: number }> {
    let freedBytes = 0
    let itemsRemoved = 0

    const cutoffTime = Date.now() - getChapterCacheTTL()

    const oldChapters = await db.chapters
      .where('lastAccessedAt')
      .below(cutoffTime)
      .limit(100)
      .toArray()

    for (const ch of oldChapters) {
      if (freedBytes >= targetBytes) break

      const chapterSize = this.estimateChapterSize(ch)
      freedBytes += chapterSize
      itemsRemoved++
      await db.chapters.delete(ch.id)
    }

    if (itemsRemoved > 0 && import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Removed ${itemsRemoved} chapters, freed ${this.formatBytes(freedBytes)}`
      )
    }

    return { freedBytes, itemsRemoved }
  }

  /**
   * Clean up failed sync operations (NOT pending ones!)
   */
  private async cleanupFailedSyncOperations(): Promise<{
    freedBytes: number
    itemsRemoved: number
  }> {
    let freedBytes = 0
    let itemsRemoved = 0

    // Only remove failed operations that exceeded max retries
    const failedOps = await db.syncQueue
      .where('status')
      .equals('failed')
      .toArray()

    const toRemove = failedOps.filter((op) => op.retries >= op.maxRetries)

    for (const op of toRemove) {
      freedBytes += JSON.stringify(op).length
      itemsRemoved++
      await db.syncQueue.delete(op.id)
    }

    if (itemsRemoved > 0 && import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Removed ${itemsRemoved} failed sync operations`
      )
    }

    return { freedBytes, itemsRemoved }
  }

  /**
   * Clear all offline data
   * WARNING: Does NOT clear sync queue (may contain important operations)
   */
  async clearAllOfflineData(): Promise<void> {
    if (import.meta.env.DEV) {
      logger.debug(`${this.LOG_PREFIX} Clearing all offline data`)
    }

    await db.transaction(
      'rw',
      db.offlineBooks,
      db.chapters,
      db.images,
      db.readingProgress,
      async () => {
        await db.offlineBooks.clear()
        await db.chapters.clear()
        await db.images.clear()
        await db.readingProgress.clear()
        // syncQueue is NOT cleared - may contain important pending operations
      }
    )

    // Clear Service Worker caches
    await this.clearServiceWorkerCaches()

    if (import.meta.env.DEV) {
      logger.debug(`${this.LOG_PREFIX} All offline data cleared`)
    }
  }

  /**
   * Clear data for a specific book
   */
  async clearBookData(userId: string, bookId: string): Promise<number> {
    let freedBytes = 0

    await db.transaction(
      'rw',
      db.offlineBooks,
      db.chapters,
      db.images,
      db.readingProgress,
      async () => {
        // Calculate size before deletion
        const chapters = await db.chapters
          .where('[userId+bookId]')
          .equals([userId, bookId])
          .toArray()

        const images = await db.images.where({ userId, bookId }).toArray()

        for (const ch of chapters) {
          freedBytes += this.estimateChapterSize(ch)
        }
        for (const img of images) {
          freedBytes += img.size
        }

        // Delete data
        await db.offlineBooks.delete(`${userId}:${bookId}`)
        await db.chapters.where('[userId+bookId]').equals([userId, bookId]).delete()
        await db.images.where({ userId, bookId }).delete()
        await db.readingProgress.delete(`${userId}:${bookId}`)
      }
    )

    if (import.meta.env.DEV) {
      logger.debug(
        `${this.LOG_PREFIX} Cleared book ${bookId}, freed ${this.formatBytes(freedBytes)}`
      )
    }

    return freedBytes
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private async calculateChaptersSize(): Promise<number> {
    const chapters = await db.chapters.toArray()
    return chapters.reduce((total, ch) => total + this.estimateChapterSize(ch), 0)
  }

  private async calculateImagesSize(): Promise<number> {
    const images = await db.images.toArray()
    return images.reduce((total, img) => total + img.size, 0)
  }

  private async calculateSyncQueueSize(): Promise<number> {
    const ops = await db.syncQueue.toArray()
    return ops.reduce((total, op) => total + JSON.stringify(op).length, 0)
  }

  private async calculateReadingProgressSize(): Promise<number> {
    const progress = await db.readingProgress.toArray()
    return progress.reduce((total, p) => total + JSON.stringify(p).length, 0)
  }

  private async calculateOfflineBooksSize(): Promise<number> {
    const books = await db.offlineBooks.toArray()
    return books.reduce((total, b) => total + JSON.stringify(b).length, 0)
  }

  private async getCounts(): Promise<{
    offlineBooks: number
    chapters: number
    images: number
  }> {
    const [offlineBooks, chapters, images] = await Promise.all([
      db.offlineBooks.count(),
      db.chapters.count(),
      db.images.count(),
    ])
    return { offlineBooks, chapters, images }
  }

  private estimateChapterSize(chapter: {
    content: string
    descriptions: unknown[]
  }): number {
    const contentSize = new Blob([chapter.content]).size
    const descriptionsSize = JSON.stringify(chapter.descriptions).length
    return contentSize + descriptionsSize
  }

  /**
   * Update offline books status after chapters were deleted
   */
  private async updateOfflineBooksStatus(): Promise<void> {
    const offlineBooks = await db.offlineBooks.toArray()

    for (const book of offlineBooks) {
      const chapterCount = await db.chapters
        .where('[userId+bookId]')
        .equals([book.userId, book.bookId])
        .count()

      if (chapterCount === 0) {
        await db.offlineBooks.delete(book.id)
      } else if (chapterCount < book.metadata.totalChapters) {
        await db.offlineBooks.update(book.id, { status: 'partial' })
      }
    }
  }

  /**
   * Clear Service Worker caches
   */
  private async clearServiceWorkerCaches(): Promise<void> {
    if (!('caches' in window)) return

    try {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter(
            (name) => name.startsWith('fancai-') || name.includes('images')
          )
          .map((name) => caches.delete(name))
      )
    } catch (error) {
      logger.warn(`${this.LOG_PREFIX} Failed to clear SW caches:`, error)
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 0) return '-' + this.formatBytes(-bytes)

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const value = bytes / Math.pow(k, i)

    return `${value.toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance of StorageManager */
export const storageManager = new StorageManager()

// ============================================================================
// Convenience Functions for App Initialization
// ============================================================================

/**
 * Start storage pressure monitoring.
 * Call this during app initialization (e.g., in main.tsx or App.tsx).
 */
export const startStorageMonitoring = (): void => {
  storageManager.startMonitoring()
}

/**
 * Stop storage pressure monitoring.
 * Call this during app cleanup if needed.
 */
export const stopStorageMonitoring = (): void => {
  storageManager.stopMonitoring()
}

/**
 * Check storage pressure manually.
 * Can be called on-demand to get current storage status.
 */
export const checkStoragePressure = (): Promise<StoragePressureEvent | null> => {
  return storageManager.checkStoragePressure()
}

/**
 * Request persistent storage to prevent Safari from clearing PWA data.
 * Call this during app initialization, preferably after user engagement.
 */
export const requestPersistentStorage = (): Promise<boolean> => {
  return storageManager.requestPersistentStorage()
}

/**
 * Initialize storage management for PWA.
 * Requests persistent storage and starts monitoring.
 * Handles Safari private browsing mode with limited storage.
 * Call this during app initialization.
 */
export const initializeStorageManagement = async (): Promise<{
  isPersistent: boolean
  initialCheck: StoragePressureEvent | null
  isPrivateBrowsing: boolean
  isSafari: boolean
}> => {
  if (import.meta.env.DEV) {
    logger.debug('[StorageManager] Initializing...')
  }

  // Check for Safari and private browsing
  const safariDetected = isSafari()
  const privateBrowsingDetected = await isPrivateBrowsing()

  if (privateBrowsingDetected) {
    logger.warn(
      '[StorageManager] Private browsing detected - storage is limited.',
      'Offline features may not work properly.'
    )
    // Don't start monitoring in private mode - storage is too limited
    return {
      isPersistent: false,
      initialCheck: null,
      isPrivateBrowsing: true,
      isSafari: safariDetected,
    }
  }

  if (safariDetected && import.meta.env.DEV) {
    logger.debug('[StorageManager] Safari detected - using fallback quota handling')
  }

  // Request persistent storage (important for Safari/iOS)
  const isPersistent = await storageManager.requestPersistentStorage()

  // Start periodic monitoring
  storageManager.startMonitoring()

  // Get initial storage status
  const initialCheck = await storageManager.checkStoragePressure()

  if (import.meta.env.DEV) {
    logger.debug('[StorageManager] Initialized:', {
      isPersistent,
      initialCheck,
      isSafari: safariDetected,
      isPrivateBrowsing: privateBrowsingDetected,
    })
  }

  return {
    isPersistent,
    initialCheck,
    isPrivateBrowsing: privateBrowsingDetected,
    isSafari: safariDetected,
  }
}
