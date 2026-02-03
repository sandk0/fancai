/**
 * IndexedDB Chapter Cache Service (Dexie.js)
 *
 * Provides offline caching for book chapters using Dexie.js.
 * Migrated from raw IndexedDB for improved developer experience and reliability.
 *
 * Features:
 * - Store chapters with descriptions in IndexedDB via Dexie
 * - TTL (Time To Live) - 7 days by default
 * - LRU (Least Recently Used) cleanup
 * - User data isolation
 * - Reactive queries with useLiveQuery support
 *
 * @module services/chapterCache
 */

import { db, createChapterId, CHAPTER_CACHE_TTL, notifyFallbackOnce, type CachedChapter, type CachedDescription } from './db'
import { MemoryTable } from './memoryFallbackCache'
import type { Description, GeneratedImage } from '@/types/api'

import { logger } from '@/lib/logger'

const MAX_CHAPTERS_PER_BOOK = 50

const memoryFallback = new MemoryTable<CachedChapter>()
let useMemoryFallback = false

function getChaptersTable(): MemoryTable<CachedChapter> {
  if (useMemoryFallback) return memoryFallback
  return db.chapters as unknown as MemoryTable<CachedChapter>
}

function switchToFallback(err: unknown): void {
  if (!useMemoryFallback) {
    useMemoryFallback = true
    logger.warn('[ChapterCache] Switching to in-memory fallback:', err)
    notifyFallbackOnce()
  }
}

interface CacheStats {
  totalChapters: number
  chaptersByBook: Record<string, number>
  oldestCacheDate: Date | null
  newestCacheDate: Date | null
}

/**
 * Convert API Description to CachedDescription
 */
function toCachedDescription(desc: Description): CachedDescription {
  const typeMap: Record<string, CachedDescription['type']> = {
    location: 'setting',
    character: 'character',
    atmosphere: 'scene',
    object: 'object',
    action: 'scene',
  }

  return {
    id: desc.id,
    content: desc.content,
    type: typeMap[desc.type] || 'scene',
    confidence: desc.confidence_score,
    imageUrl: desc.generated_image?.image_url ?? null,
    imageStatus: desc.generated_image
      ? (desc.generated_image.status === 'completed' ? 'generated' : 'pending')
      : 'none',
  }
}

/**
 * Validate that a cached description has required fields
 * Returns false if data is corrupted or invalid
 */
function isValidCachedDescription(cached: unknown): cached is CachedDescription {
  if (!cached || typeof cached !== 'object') {
    return false
  }

  const desc = cached as Record<string, unknown>

  // Must have id and content as strings
  if (typeof desc.id !== 'string' || !desc.id) {
    return false
  }
  if (typeof desc.content !== 'string') {
    return false
  }

  // type must be valid enum value
  const validTypes = ['setting', 'character', 'scene', 'object']
  if (typeof desc.type !== 'string' || !validTypes.includes(desc.type)) {
    return false
  }

  return true
}

/**
 * Convert CachedDescription back to API Description format
 * Returns null if data is corrupted (defensive against IndexedDB corruption)
 */
function fromCachedDescription(cached: CachedDescription): Description | null {
  // Defensive validation for corrupted IndexedDB data
  if (!isValidCachedDescription(cached)) {
    logger.warn('[ChapterCache] Corrupted description detected, skipping:', cached)
    return null
  }

  const typeMap: Record<CachedDescription['type'], Description['type']> = {
    setting: 'location',
    character: 'character',
    scene: 'atmosphere',
    object: 'object',
  }

  return {
    id: cached.id,
    type: typeMap[cached.type] || 'atmosphere',
    content: cached.content,
    text: cached.content,
    confidence_score: cached.confidence ?? 0,
    priority_score: cached.confidence ?? 0,
    generated_image: cached.imageUrl ? {
      id: '',
      service_used: 'cached',
      status: cached.imageStatus === 'generated' ? 'completed' : 'pending',
      image_url: cached.imageUrl,
      is_moderated: false,
      view_count: 0,
      download_count: 0,
      created_at: new Date().toISOString(),
      description: {
        id: cached.id,
        type: typeMap[cached.type] || 'atmosphere',
        text: cached.content,
        content: cached.content,
        confidence_score: cached.confidence ?? 0,
        priority_score: cached.confidence ?? 0,
      },
      chapter: {
        id: '',
        number: 0,
        title: '',
      },
    } : undefined,
  }
}

/**
 * Chapter Cache Service using Dexie.js
 */
class ChapterCacheService {
  /**
   * Check if chapter exists in cache and is not expired
   */
  async has(userId: string, bookId: string, chapterNumber: number): Promise<boolean> {
    try {
      const id = createChapterId(userId, bookId, chapterNumber)
      const chapter = await getChaptersTable().get(id)

      if (!chapter) return false

      if (this.isExpired(chapter.cachedAt)) {
        this.delete(userId, bookId, chapterNumber).catch(() => {})
        return false
      }

      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Get chapter from cache
   * Returns null if not cached or expired
   *
   * DEFENSIVE: Handles corrupted IndexedDB data gracefully (PWA issue)
   * - Validates chapter.descriptions is an array
   * - Filters out corrupted description entries
   * - Auto-cleans corrupted cache entries
   */
  async get(
    userId: string,
    bookId: string,
    chapterNumber: number
  ): Promise<{ descriptions: Description[]; images: GeneratedImage[] } | null> {
    try {
      const id = createChapterId(userId, bookId, chapterNumber)
      const chapter = await getChaptersTable().get(id)

      if (!chapter) {
        logger.debug('[ChapterCache] Cache miss for:', { userId, bookId, chapterNumber })
        return null
      }

      if (this.isExpired(chapter.cachedAt)) {
        logger.debug('[ChapterCache] Cache expired for:', { userId, bookId, chapterNumber })
        await this.delete(userId, bookId, chapterNumber)
        return null
      }

      if (!Array.isArray(chapter.descriptions)) {
        logger.error('[ChapterCache] Corrupted cache entry detected - descriptions is not an array:', {
          userId,
          bookId,
          chapterNumber,
          descriptionsType: typeof chapter.descriptions,
          descriptionsValue: chapter.descriptions,
        })
        await this.delete(userId, bookId, chapterNumber)
        return null
      }

      await getChaptersTable().update(id, { lastAccessedAt: Date.now() })

      // Convert cached descriptions to API format
      // DEFENSIVE: Filter out null (corrupted) entries
      const descriptions = chapter.descriptions
        .map(fromCachedDescription)
        .filter((d): d is Description => d !== null)

      // Log if we had to filter out corrupted entries
      const corruptedCount = chapter.descriptions.length - descriptions.length
      if (corruptedCount > 0) {
        logger.debug('[ChapterCache] Filtered out corrupted descriptions:', {
          userId,
          bookId,
          chapterNumber,
          corruptedCount,
          validCount: descriptions.length,
        })
      }

      // Extract images from descriptions
      const images = descriptions
        .filter(d => d.generated_image)
        .map(d => d.generated_image as GeneratedImage)

      logger.debug('[ChapterCache] Cache hit for:', {
        userId,
        bookId,
        chapterNumber,
        descriptionsCount: descriptions.length,
        imagesCount: images.length,
      })

      return { descriptions, images }
    } catch (err) {
      switchToFallback(err)
      try {
        await this.delete(userId, bookId, chapterNumber)
      } catch {
        // Already switched to fallback
      }
      return null
    }
  }

  /**
   * Store chapter in cache
   *
   * DEFENSIVE: Validates input data before caching to prevent corruption
   * P7 FIX: Skips writes when app is not visible to prevent IndexedDB corruption
   */
  async set(
    userId: string,
    bookId: string,
    chapterNumber: number,
    descriptions: Description[],
    images: GeneratedImage[]
  ): Promise<boolean> {
    try {
      // P7 FIX: Skip cache writes when app is not visible to prevent corruption
      // during background/foreground transitions (PWA "Forever Broken Book" bug)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        logger.debug('[ChapterCache] Skipping set() - app not visible:', { bookId, chapterNumber })
        return false
      }

      // DEFENSIVE: Validate inputs
      if (!userId || typeof userId !== 'string') {
        logger.error('[ChapterCache] Invalid userId:', userId)
        return false
      }
      if (!bookId || typeof bookId !== 'string') {
        logger.error('[ChapterCache] Invalid bookId:', bookId)
        return false
      }
      if (typeof chapterNumber !== 'number' || chapterNumber < 0) {
        logger.error('[ChapterCache] Invalid chapterNumber:', chapterNumber)
        return false
      }
      if (!Array.isArray(descriptions)) {
        logger.error('[ChapterCache] descriptions is not an array:', typeof descriptions)
        return false
      }
      if (!Array.isArray(images)) {
        logger.error('[ChapterCache] images is not an array:', typeof images)
        return false
      }

      // Enforce book limit
      await this.ensureBookLimit(userId, bookId)

      const id = createChapterId(userId, bookId, chapterNumber)
      const now = Date.now()

      // Filter out invalid descriptions before caching
      const validDescriptions = descriptions.filter(desc => {
        if (!desc || typeof desc !== 'object') {
          logger.warn('[ChapterCache] Skipping invalid description (not object):', desc)
          return false
        }
        if (!desc.id || typeof desc.id !== 'string') {
          logger.warn('[ChapterCache] Skipping description without valid id:', desc)
          return false
        }
        if (typeof desc.content !== 'string') {
          logger.warn('[ChapterCache] Skipping description without valid content:', desc)
          return false
        }
        return true
      })

      // Merge images into descriptions
      const descriptionsWithImages = validDescriptions.map(desc => {
        const image = images.find(img => img.description_id === desc.id || img.description?.id === desc.id)
        if (image && !desc.generated_image) {
          return { ...desc, generated_image: image }
        }
        return desc
      })

      // Convert to cached format
      const cachedDescriptions = descriptionsWithImages.map(toCachedDescription)

      const cachedChapter: CachedChapter = {
        id,
        userId,
        bookId,
        chapterNumber,
        title: '', // Will be set from chapter content if available
        content: '', // Content stored separately if needed
        descriptions: cachedDescriptions,
        wordCount: 0,
        cachedAt: now,
        lastAccessedAt: now,
      }

      await getChaptersTable().put(cachedChapter)

      logger.debug('[ChapterCache] Chapter cached:', {
        userId,
        bookId,
        chapterNumber,
        descriptionsCount: validDescriptions.length,
        imagesCount: images.length,
        skippedDescriptions: descriptions.length - validDescriptions.length,
      })

      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Delete chapter from cache
   */
  async delete(userId: string, bookId: string, chapterNumber: number): Promise<boolean> {
    try {
      const id = createChapterId(userId, bookId, chapterNumber)
      await getChaptersTable().delete(id)
      logger.debug('[ChapterCache] Deleted:', { userId, bookId, chapterNumber })
      return true
    } catch (err) {
      switchToFallback(err)
      return false
    }
  }

  /**
   * Clear all chapters for a book
   */
  async clearBook(userId: string, bookId: string): Promise<number> {
    try {
      const deletedCount = await getChaptersTable()
        .where('[userId+bookId]')
        .equals([userId, bookId])
        .delete()

      logger.debug('[ChapterCache] Cleared book cache:', { userId, bookId, deletedCount })
      return deletedCount
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Clear expired entries
   */
  async clearExpired(): Promise<number> {
    try {
      const expirationTime = Date.now() - CHAPTER_CACHE_TTL

      const allChapters = await getChaptersTable().toArray()
      const expired = allChapters.filter(ch => ch.lastAccessedAt < expirationTime)
      const idsToDelete = expired.map(ch => ch.id)
      await getChaptersTable().bulkDelete(idsToDelete)

      logger.debug('[ChapterCache] Cleared expired entries:', idsToDelete.length)
      return idsToDelete.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Clear all cached chapters for a user
   */
  async clearAll(userId: string): Promise<number> {
    try {
      // Get all chapters for user
      const chapters = await getChaptersTable()
        .filter(ch => ch.userId === userId)
        .toArray()

      const ids = chapters.map(ch => ch.id)
      await getChaptersTable().bulkDelete(ids)

      logger.debug('[ChapterCache] All cache cleared for user:', { userId, deletedCount: ids.length })
      return ids.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const chapters = await getChaptersTable().toArray()

      const stats: CacheStats = {
        totalChapters: chapters.length,
        chaptersByBook: {},
        oldestCacheDate: null,
        newestCacheDate: null,
      }

      for (const chapter of chapters) {
        // Count by book
        if (!stats.chaptersByBook[chapter.bookId]) {
          stats.chaptersByBook[chapter.bookId] = 0
        }
        stats.chaptersByBook[chapter.bookId]++

        // Track dates
        const cacheDate = new Date(chapter.cachedAt)
        if (!stats.oldestCacheDate || cacheDate < stats.oldestCacheDate) {
          stats.oldestCacheDate = cacheDate
        }
        if (!stats.newestCacheDate || cacheDate > stats.newestCacheDate) {
          stats.newestCacheDate = cacheDate
        }
      }

      logger.debug('[ChapterCache] Stats:', {
        totalChapters: stats.totalChapters,
        booksCount: Object.keys(stats.chaptersByBook).length,
      })

      return stats
    } catch (err) {
      switchToFallback(err)
      return {
        totalChapters: 0,
        chaptersByBook: {},
        oldestCacheDate: null,
        newestCacheDate: null,
      }
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > CHAPTER_CACHE_TTL
  }

  /**
   * Enforce maximum chapters per book (LRU cleanup)
   */
  private async ensureBookLimit(userId: string, bookId: string): Promise<void> {
    try {
      const chapters = await getChaptersTable()
        .where('[userId+bookId]')
        .equals([userId, bookId])
        .toArray()

      if (chapters.length >= MAX_CHAPTERS_PER_BOOK) {
        logger.debug('[ChapterCache] Book limit reached, applying LRU cleanup...')

        chapters.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

        const toDelete = chapters.slice(0, chapters.length - MAX_CHAPTERS_PER_BOOK + 1)
        const idsToDelete = toDelete.map(ch => ch.id)
        await getChaptersTable().bulkDelete(idsToDelete)

        logger.debug('[ChapterCache] Deleted LRU entries:', toDelete.length)
      }
    } catch (err) {
      switchToFallback(err)
    }
  }

  /**
   * Clear entries with empty descriptions
   * (Useful during migration to on-demand extraction)
   */
  async clearEmptyDescriptions(): Promise<number> {
    try {
      const chapters = await getChaptersTable().toArray()
      const emptyChapters = chapters.filter(ch => !ch.descriptions || ch.descriptions.length === 0)
      const idsToDelete = emptyChapters.map(ch => ch.id)

      await getChaptersTable().bulkDelete(idsToDelete)

      logger.debug('[ChapterCache] Cleared empty description entries:', idsToDelete.length)
      return idsToDelete.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Clear legacy data without userId
   * Called automatically for migration
   */
  async clearLegacyData(): Promise<number> {
    try {
      const chapters = await getChaptersTable().toArray()
      const legacyChapters = chapters.filter(ch => !ch.userId)
      const idsToDelete = legacyChapters.map(ch => ch.id)

      if (idsToDelete.length > 0) {
        await getChaptersTable().bulkDelete(idsToDelete)
        logger.debug('[ChapterCache] Cleared legacy data without userId:', idsToDelete.length)
      }

      return idsToDelete.length
    } catch (err) {
      switchToFallback(err)
      return 0
    }
  }

  /**
   * Perform maintenance tasks (cleanup expired, empty, legacy data)
   */
  async performMaintenance(): Promise<void> {
    logger.debug('[ChapterCache] Performing maintenance...')
    await this.clearLegacyData()
    await this.clearExpired()
    await this.clearEmptyDescriptions()
    const stats = await this.getStats()
    logger.debug('[ChapterCache] Maintenance complete:', stats)
  }
}

// Singleton instance
export const chapterCache = new ChapterCacheService()

// Export types for compatibility
export type { CacheStats }
export type { CachedChapter, CachedDescription } from './db'
