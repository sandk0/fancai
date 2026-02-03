/**
 * IndexedDB EPUB Cache Service (Dexie.js)
 *
 * Provides offline caching for EPUB files using Dexie.js.
 * Stores complete EPUB files as ArrayBuffer for offline reading with epub.js.
 *
 * Features:
 * - Store EPUB files in IndexedDB via Dexie
 * - LRU (Least Recently Used) cleanup
 * - Auto-cleanup when cache size limit is exceeded (200MB default)
 * - User data isolation
 * - Storage info and statistics
 *
 * @module services/epubCache
 */

import Dexie, { type EntityTable } from 'dexie'
import { MemoryTable } from './memoryFallbackCache'
import { notifyFallbackOnce } from './db'

import { logger } from '@/lib/logger'

const MAX_CACHE_SIZE_BYTES = 200 * 1024 * 1024
const EPUB_CACHE_TTL = 30 * 24 * 60 * 60 * 1000

// ============================================================================
// Types
// ============================================================================

/** Cached EPUB file record */
export interface CachedEpub {
  /** Composite key: `${userId}:${bookId}` */
  id: string
  userId: string
  bookId: string
  /** EPUB file data as ArrayBuffer */
  data: ArrayBuffer
  /** File size in bytes */
  size: number
  /** When the file was cached */
  cachedAt: number
  /** Last time the file was accessed */
  lastAccessedAt: number
}

/** Storage information for the EPUB cache */
export interface EpubCacheStorageInfo {
  /** Total number of cached EPUBs */
  totalEpubs: number
  /** Total size in bytes */
  totalSizeBytes: number
  /** Total size in MB */
  totalSizeMB: number
  /** Maximum cache size in MB */
  maxSizeMB: number
  /** Usage percentage (0-100) */
  usagePercent: number
  /** Oldest cached EPUB date */
  oldestCacheDate: Date | null
  /** Newest cached EPUB date */
  newestCacheDate: Date | null
}

// ============================================================================
// Database
// ============================================================================

class EpubCacheDatabase extends Dexie {
  epubs!: EntityTable<CachedEpub, 'id'>

  constructor() {
    super('EpubCacheDB')

    this.version(1).stores({
      epubs: 'id, userId, bookId, cachedAt, lastAccessedAt, size',
    })
  }
}

const epubDb = new EpubCacheDatabase()

epubDb.on('blocked', () => {
  logger.warn('[EpubCache] Database blocked - please close other tabs')
})

epubDb.on('versionchange', () => {
  logger.warn('[EpubCache] Database version change - reloading')
  epubDb.close()
  window.location.reload()
})

epubDb.open().catch((err: Error & { name?: string }) => {
  logger.error('[EpubCache] Failed to open database:', err)
  if (err.name === 'VersionError' || err.name === 'InvalidStateError') {
    indexedDB.deleteDatabase('EpubCacheDB')
    window.location.reload()
  }
})

const memoryFallback = new MemoryTable<CachedEpub>()
let useMemoryFallback = false

function getEpubsTable(): MemoryTable<CachedEpub> {
  if (useMemoryFallback) return memoryFallback
  return epubDb.epubs as unknown as MemoryTable<CachedEpub>
}

function switchToFallback(err: unknown): void {
  if (!useMemoryFallback) {
    useMemoryFallback = true
    logger.warn('[EpubCache] Switching to in-memory fallback:', err)
    notifyFallbackOnce()
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create composite ID for cached EPUB
 */
function createEpubId(userId: string, bookId: string): string {
  return `${userId}:${bookId}`
}

// ============================================================================
// EPUB Cache Service
// ============================================================================

/**
 * EPUB Cache Service using Dexie.js
 *
 * Provides methods for caching and retrieving EPUB files from IndexedDB.
 */
class EpubCacheService {
  /**
   * Check if EPUB is cached and not expired
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @returns True if EPUB is cached and valid
   */
  async has(userId: string, bookId: string): Promise<boolean> {
    try {
      const id = createEpubId(userId, bookId)
      const epub = await getEpubsTable().get(id)

      if (!epub) return false

      if (this.isExpired(epub.cachedAt)) {
        this.delete(userId, bookId).catch(() => {})
        return false
      }

      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Get cached EPUB file data
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @returns EPUB ArrayBuffer or null if not cached
   */
  async get(userId: string, bookId: string): Promise<ArrayBuffer | null> {
    try {
      const id = createEpubId(userId, bookId)
      const epub = await getEpubsTable().get(id)

      if (!epub) {
        logger.debug('[EpubCache] Cache miss for:', bookId)
        return null
      }

      if (this.isExpired(epub.cachedAt)) {
        logger.debug('[EpubCache] Cache expired for:', bookId)
        await this.delete(userId, bookId)
        return null
      }

      await getEpubsTable().update(id, { lastAccessedAt: Date.now() })

      logger.debug('[EpubCache] Cache hit for:', bookId, {
        size: (epub.size / 1024 / 1024).toFixed(2) + 'MB',
      })

      return epub.data
    } catch (err) {
      switchToFallback(err)
      return null
    }
  }

  /**
   * Store EPUB file in cache
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @param data - EPUB file as ArrayBuffer
   * @returns True if successfully cached
   */
  async set(
    userId: string,
    bookId: string,
    data: ArrayBuffer
  ): Promise<boolean> {
    try {
      // Skip cache writes when app is not visible (PWA corruption fix)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        logger.debug('[EpubCache] Skipping set() - app not visible:', bookId)
        return false
      }

      // Validate inputs
      if (!userId || typeof userId !== 'string') {
        logger.error('[EpubCache] Invalid userId:', userId)
        return false
      }
      if (!bookId || typeof bookId !== 'string') {
        logger.error('[EpubCache] Invalid bookId:', bookId)
        return false
      }
      if (!data || !(data instanceof ArrayBuffer)) {
        logger.error('[EpubCache] Invalid data: not an ArrayBuffer')
        return false
      }

      const size = data.byteLength

      // Ensure cache size limit
      await this.ensureCacheSize(userId, size)

      const id = createEpubId(userId, bookId)
      const now = Date.now()

      const cachedEpub: CachedEpub = {
        id,
        userId,
        bookId,
        data,
        size,
        cachedAt: now,
        lastAccessedAt: now,
      }

      await getEpubsTable().put(cachedEpub)

      logger.debug('[EpubCache] EPUB cached:', {
        bookId,
        size: (size / 1024 / 1024).toFixed(2) + 'MB',
      })

      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Delete cached EPUB
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @returns True if successfully deleted
   */
  async delete(userId: string, bookId: string): Promise<boolean> {
    try {
      const id = createEpubId(userId, bookId)
      await getEpubsTable().delete(id)

      logger.debug('[EpubCache] Deleted:', bookId)
      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Clear all cached EPUBs for a user
   *
   * @param userId - User ID
   * @returns Number of deleted entries
   */
  async clearUser(userId: string): Promise<number> {
    try {
      const epubs = await getEpubsTable()
        .where('userId')
        .equals(userId)
        .toArray()

      const ids = epubs.map((epub) => epub.id)
      await getEpubsTable().bulkDelete(ids)

      logger.debug('[EpubCache] Cleared user cache:', {
        userId,
        deletedCount: ids.length,
      })

      return ids.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Get storage information for the EPUB cache
   *
   * @param userId - Optional user ID to get stats for specific user
   * @returns Storage info
   */
  async getStorageInfo(userId?: string): Promise<EpubCacheStorageInfo> {
    try {
      let epubs: CachedEpub[]

      if (userId) {
        epubs = await getEpubsTable()
          .where('userId')
          .equals(userId)
          .toArray()
      } else {
        epubs = await getEpubsTable().toArray()
      }

      const info: EpubCacheStorageInfo = {
        totalEpubs: epubs.length,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        maxSizeMB: MAX_CACHE_SIZE_BYTES / 1024 / 1024,
        usagePercent: 0,
        oldestCacheDate: null,
        newestCacheDate: null,
      }

      for (const epub of epubs) {
        info.totalSizeBytes += epub.size

        const cacheDate = new Date(epub.cachedAt)
        if (!info.oldestCacheDate || cacheDate < info.oldestCacheDate) {
          info.oldestCacheDate = cacheDate
        }
        if (!info.newestCacheDate || cacheDate > info.newestCacheDate) {
          info.newestCacheDate = cacheDate
        }
      }

      info.totalSizeMB = info.totalSizeBytes / 1024 / 1024
      info.usagePercent = (info.totalSizeBytes / MAX_CACHE_SIZE_BYTES) * 100

      logger.debug('[EpubCache] Storage info:', {
        userId: userId || 'all',
        epubs: info.totalEpubs,
        size: info.totalSizeMB.toFixed(2) + 'MB',
        usage: info.usagePercent.toFixed(1) + '%',
      })

      return info
    } catch (err) {
      switchToFallback(err)
      return {
        totalEpubs: 0,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        maxSizeMB: MAX_CACHE_SIZE_BYTES / 1024 / 1024,
        usagePercent: 0,
        oldestCacheDate: null,
        newestCacheDate: null,
      }
    }
  }

  /**
   * Perform cleanup of expired and LRU entries
   *
   * @param userId - Optional user ID to cleanup for specific user
   * @returns Number of deleted entries
   */
  async cleanup(userId?: string): Promise<number> {
    try {
      let totalDeleted = 0

      // Clear expired entries
      const expiredDeleted = await this.clearExpired(userId)
      totalDeleted += expiredDeleted

      // If still over limit, apply LRU cleanup
      const info = await this.getStorageInfo(userId)
      if (info.usagePercent > 90) {
        const lruDeleted = await this.clearLRU(userId)
        totalDeleted += lruDeleted
      }

      if (totalDeleted > 0) {
        logger.debug('[EpubCache] Cleanup completed:', { deletedCount: totalDeleted })
      }

      return totalDeleted
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Get list of all cached books for a user
   *
   * @param userId - User ID
   * @returns Array of book IDs that are cached
   */
  async getCachedBookIds(userId: string): Promise<string[]> {
    try {
      const epubs = await getEpubsTable()
        .where('userId')
        .equals(userId)
        .toArray()

      return epubs.map((epub) => epub.bookId)
    } catch (err) {
      switchToFallback(err)
      return []
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Check if cache entry is expired
   */
  private isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > EPUB_CACHE_TTL
  }

  /**
   * Ensure cache doesn't exceed size limit
   * Clears expired and LRU entries if needed
   */
  private async ensureCacheSize(
    userId: string,
    newEntrySize: number
  ): Promise<void> {
    const info = await this.getStorageInfo(userId)

    if (info.totalSizeBytes + newEntrySize > MAX_CACHE_SIZE_BYTES) {
      logger.debug('[EpubCache] Cache size exceeded, cleaning...')

      // First, clear expired
      await this.clearExpired(userId)

      // Check again
      const newInfo = await this.getStorageInfo(userId)
      if (newInfo.totalSizeBytes + newEntrySize > MAX_CACHE_SIZE_BYTES) {
        // Calculate how much to delete
        const bytesToFree = newInfo.totalSizeBytes + newEntrySize - MAX_CACHE_SIZE_BYTES
        await this.deleteOldestBySize(userId, bytesToFree)
      }
    }
  }

  /**
   * Clear expired entries
   */
  private async clearExpired(userId?: string): Promise<number> {
    try {
      const expirationTime = Date.now() - EPUB_CACHE_TTL

      let epubs: CachedEpub[]
      if (userId) {
        epubs = await getEpubsTable()
          .where('userId')
          .equals(userId)
          .filter((epub) => epub.cachedAt < expirationTime)
          .toArray()
      } else {
        epubs = await getEpubsTable()
          .filter((epub) => epub.cachedAt < expirationTime)
          .toArray()
      }

      if (epubs.length > 0) {
        const ids = epubs.map((epub) => epub.id)
        await getEpubsTable().bulkDelete(ids)

        logger.debug('[EpubCache] Cleared expired entries:', ids.length)
      }

      return epubs.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Clear LRU entries (oldest accessed first)
   */
  private async clearLRU(userId?: string): Promise<number> {
    try {
      let epubs: CachedEpub[]
      if (userId) {
        epubs = await getEpubsTable()
          .where('userId')
          .equals(userId)
          .toArray()
      } else {
        epubs = await getEpubsTable().toArray()
      }

      epubs.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

      const countToDelete = Math.max(1, Math.ceil(epubs.length * 0.2))
      const toDelete = epubs.slice(0, countToDelete)
      const ids = toDelete.map((epub) => epub.id)

      if (ids.length > 0) {
        await getEpubsTable().bulkDelete(ids)

        logger.debug('[EpubCache] LRU cleanup:', ids.length)
      }

      return ids.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Delete oldest entries by total size to free
   */
  private async deleteOldestBySize(
    userId: string,
    bytesToFree: number
  ): Promise<void> {
    try {
      const epubs = await getEpubsTable()
        .where('userId')
        .equals(userId)
        .toArray()

      epubs.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

      let freedBytes = 0
      const idsToDelete: string[] = []

      for (const epub of epubs) {
        if (freedBytes >= bytesToFree) break
        idsToDelete.push(epub.id)
        freedBytes += epub.size
      }

      if (idsToDelete.length > 0) {
        await getEpubsTable().bulkDelete(idsToDelete)

        logger.debug('[EpubCache] Deleted to free space:', {
          deleted: idsToDelete.length,
          freed: (freedBytes / 1024 / 1024).toFixed(2) + 'MB',
        })
      }
    } catch (err) {
      switchToFallback(err)
    }
  }
}

// ============================================================================
// Export
// ============================================================================

/** Singleton EPUB cache service instance */
export const epubCache = new EpubCacheService()

// Export database for testing
export { epubDb }
