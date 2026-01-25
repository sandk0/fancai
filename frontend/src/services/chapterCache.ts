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

import { db, createChapterId, CHAPTER_CACHE_TTL, type CachedChapter, type CachedDescription } from './db'
import type { Description, GeneratedImage } from '@/types/api'

/** Enable debug logging only in development */
const DEBUG = import.meta.env.DEV

const MAX_CHAPTERS_PER_BOOK = 50

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
    console.warn('[ChapterCache] Corrupted description detected, skipping:', cached)
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
      const chapter = await db.chapters.get(id)

      if (!chapter) return false

      // Check expiration
      if (this.isExpired(chapter.cachedAt)) {
        // Delete expired entry asynchronously
        this.delete(userId, bookId, chapterNumber).catch(() => {})
        return false
      }

      return true
    } catch (err) {
      console.warn('[ChapterCache] Error checking cache:', err)
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
      const chapter = await db.chapters.get(id)

      if (!chapter) {
        if (DEBUG) console.log('[ChapterCache] Cache miss for:', { userId, bookId, chapterNumber })
        return null
      }

      // Check expiration
      if (this.isExpired(chapter.cachedAt)) {
        if (DEBUG) console.log('[ChapterCache] Cache expired for:', { userId, bookId, chapterNumber })
        await this.delete(userId, bookId, chapterNumber)
        return null
      }

      // DEFENSIVE: Validate chapter.descriptions is an array (PWA corruption fix)
      if (!Array.isArray(chapter.descriptions)) {
        console.error('[ChapterCache] Corrupted cache entry detected - descriptions is not an array:', {
          userId,
          bookId,
          chapterNumber,
          descriptionsType: typeof chapter.descriptions,
          descriptionsValue: chapter.descriptions,
        })
        // Auto-clean corrupted entry
        await this.delete(userId, bookId, chapterNumber)
        return null
      }

      // Update lastAccessedAt for LRU
      await db.chapters.update(id, { lastAccessedAt: Date.now() })

      // Convert cached descriptions to API format
      // DEFENSIVE: Filter out null (corrupted) entries
      const descriptions = chapter.descriptions
        .map(fromCachedDescription)
        .filter((d): d is Description => d !== null)

      // Log if we had to filter out corrupted entries
      const corruptedCount = chapter.descriptions.length - descriptions.length
      if (corruptedCount > 0 && DEBUG) {
        console.warn('[ChapterCache] Filtered out corrupted descriptions:', {
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

      if (DEBUG) {
        console.log('[ChapterCache] Cache hit for:', {
          userId,
          bookId,
          chapterNumber,
          descriptionsCount: descriptions.length,
          imagesCount: images.length,
        })
      }

      return { descriptions, images }
    } catch (err) {
      console.error('[ChapterCache] Error reading cache, auto-cleaning:', err)
      // DEFENSIVE: Auto-clean corrupted entry to prevent "forever broken" state
      try {
        await this.delete(userId, bookId, chapterNumber)
        if (DEBUG) console.log('[ChapterCache] Auto-cleaned corrupted cache entry:', { userId, bookId, chapterNumber })
      } catch (deleteErr) {
        console.error('[ChapterCache] Failed to auto-clean:', deleteErr)
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
        if (DEBUG) {
          console.log('[ChapterCache] Skipping set() - app not visible:', { bookId, chapterNumber })
        }
        return false
      }

      // DEFENSIVE: Validate inputs
      if (!userId || typeof userId !== 'string') {
        console.error('[ChapterCache] Invalid userId:', userId)
        return false
      }
      if (!bookId || typeof bookId !== 'string') {
        console.error('[ChapterCache] Invalid bookId:', bookId)
        return false
      }
      if (typeof chapterNumber !== 'number' || chapterNumber < 0) {
        console.error('[ChapterCache] Invalid chapterNumber:', chapterNumber)
        return false
      }
      if (!Array.isArray(descriptions)) {
        console.error('[ChapterCache] descriptions is not an array:', typeof descriptions)
        return false
      }
      if (!Array.isArray(images)) {
        console.error('[ChapterCache] images is not an array:', typeof images)
        return false
      }

      // Enforce book limit
      await this.ensureBookLimit(userId, bookId)

      const id = createChapterId(userId, bookId, chapterNumber)
      const now = Date.now()

      // Filter out invalid descriptions before caching
      const validDescriptions = descriptions.filter(desc => {
        if (!desc || typeof desc !== 'object') {
          console.warn('[ChapterCache] Skipping invalid description (not object):', desc)
          return false
        }
        if (!desc.id || typeof desc.id !== 'string') {
          console.warn('[ChapterCache] Skipping description without valid id:', desc)
          return false
        }
        if (typeof desc.content !== 'string') {
          console.warn('[ChapterCache] Skipping description without valid content:', desc)
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

      await db.chapters.put(cachedChapter)

      if (DEBUG) {
        console.log('[ChapterCache] Chapter cached:', {
          userId,
          bookId,
          chapterNumber,
          descriptionsCount: validDescriptions.length,
          imagesCount: images.length,
          skippedDescriptions: descriptions.length - validDescriptions.length,
        })
      }

      return true
    } catch (err) {
      console.warn('[ChapterCache] Error caching chapter:', err)
      return false
    }
  }

  /**
   * Delete chapter from cache
   */
  async delete(userId: string, bookId: string, chapterNumber: number): Promise<boolean> {
    try {
      const id = createChapterId(userId, bookId, chapterNumber)
      await db.chapters.delete(id)
      if (DEBUG) console.log('[ChapterCache] Deleted:', { userId, bookId, chapterNumber })
      return true
    } catch (err) {
      console.warn('[ChapterCache] Error deleting:', err)
      return false
    }
  }

  /**
   * Clear all chapters for a book
   */
  async clearBook(userId: string, bookId: string): Promise<number> {
    try {
      const deletedCount = await db.chapters
        .where('[userId+bookId]')
        .equals([userId, bookId])
        .delete()

      if (DEBUG) console.log('[ChapterCache] Cleared book cache:', { userId, bookId, deletedCount })
      return deletedCount
    } catch (err) {
      console.warn('[ChapterCache] Error clearing book cache:', err)
      return 0
    }
  }

  /**
   * Clear expired entries
   */
  async clearExpired(): Promise<number> {
    try {
      const expirationTime = Date.now() - CHAPTER_CACHE_TTL

      const deletedCount = await db.chapters
        .where('lastAccessedAt')
        .below(expirationTime)
        .delete()

      if (DEBUG) console.log('[ChapterCache] Cleared expired entries:', deletedCount)
      return deletedCount
    } catch (err) {
      console.warn('[ChapterCache] Error clearing expired:', err)
      return 0
    }
  }

  /**
   * Clear all cached chapters for a user
   */
  async clearAll(userId: string): Promise<number> {
    try {
      // Get all chapters for user
      const chapters = await db.chapters
        .filter(ch => ch.userId === userId)
        .toArray()

      const ids = chapters.map(ch => ch.id)
      await db.chapters.bulkDelete(ids)

      if (DEBUG) console.log('[ChapterCache] All cache cleared for user:', { userId, deletedCount: ids.length })
      return ids.length
    } catch (err) {
      console.warn('[ChapterCache] Error clearing all:', err)
      return 0
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const chapters = await db.chapters.toArray()

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

      if (DEBUG) {
        console.log('[ChapterCache] Stats:', {
          totalChapters: stats.totalChapters,
          booksCount: Object.keys(stats.chaptersByBook).length,
        })
      }

      return stats
    } catch (err) {
      console.warn('[ChapterCache] Error getting stats:', err)
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
      const chapters = await db.chapters
        .where('[userId+bookId]')
        .equals([userId, bookId])
        .toArray()

      if (chapters.length >= MAX_CHAPTERS_PER_BOOK) {
        if (DEBUG) console.log('[ChapterCache] Book limit reached, applying LRU cleanup...')

        // Sort by lastAccessedAt (oldest first)
        chapters.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

        // Delete oldest entries
        const toDelete = chapters.slice(0, chapters.length - MAX_CHAPTERS_PER_BOOK + 1)
        const idsToDelete = toDelete.map(ch => ch.id)
        await db.chapters.bulkDelete(idsToDelete)

        if (DEBUG) console.log('[ChapterCache] Deleted LRU entries:', toDelete.length)
      }
    } catch (err) {
      console.warn('[ChapterCache] Error ensuring book limit:', err)
    }
  }

  /**
   * Clear entries with empty descriptions
   * (Useful during migration to on-demand extraction)
   */
  async clearEmptyDescriptions(): Promise<number> {
    try {
      const chapters = await db.chapters.toArray()
      const emptyChapters = chapters.filter(ch => !ch.descriptions || ch.descriptions.length === 0)
      const idsToDelete = emptyChapters.map(ch => ch.id)

      await db.chapters.bulkDelete(idsToDelete)

      if (DEBUG) console.log('[ChapterCache] Cleared empty description entries:', idsToDelete.length)
      return idsToDelete.length
    } catch (err) {
      console.warn('[ChapterCache] Error clearing empty:', err)
      return 0
    }
  }

  /**
   * Clear legacy data without userId
   * Called automatically for migration
   */
  async clearLegacyData(): Promise<number> {
    try {
      const chapters = await db.chapters.toArray()
      const legacyChapters = chapters.filter(ch => !ch.userId)
      const idsToDelete = legacyChapters.map(ch => ch.id)

      if (idsToDelete.length > 0) {
        await db.chapters.bulkDelete(idsToDelete)
        if (DEBUG) console.log('[ChapterCache] Cleared legacy data without userId:', idsToDelete.length)
      }

      return idsToDelete.length
    } catch (err) {
      console.warn('[ChapterCache] Error clearing legacy data:', err)
      return 0
    }
  }

  /**
   * Perform maintenance tasks (cleanup expired, empty, legacy data)
   */
  async performMaintenance(): Promise<void> {
    if (DEBUG) console.log('[ChapterCache] Performing maintenance...')
    await this.clearLegacyData()
    await this.clearExpired()
    await this.clearEmptyDescriptions()
    const stats = await this.getStats()
    if (DEBUG) console.log('[ChapterCache] Maintenance complete:', stats)
  }
}

// Singleton instance
export const chapterCache = new ChapterCacheService()

// Export types for compatibility
export type { CacheStats }
export type { CachedChapter, CachedDescription } from './db'
