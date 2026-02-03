/**
 * Download Manager for offline book downloads
 *
 * Manages downloading books for offline reading with progress tracking.
 * Stores chapters and metadata in IndexedDB via Dexie.js.
 *
 * Features:
 * - Sequential chapter downloads with progress tracking
 * - Abort/cancel support
 * - Resume partial downloads
 * - Automatic cleanup on failure
 *
 * @module services/downloadManager
 */

import {
  db,
  createOfflineBookId,
  createChapterId,
  type OfflineBook,
  type BookMetadata,
  type CachedChapter,
  type CachedDescription,
} from './db'
import { apiClient } from '@/api/client'
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

/** Download progress information */
export interface DownloadProgress {
  bookId: string
  totalChapters: number
  downloadedChapters: number
  currentChapter: number
  status: 'idle' | 'downloading' | 'paused' | 'complete' | 'error'
  error?: string
}

/** Callback for progress updates */
type ProgressCallback = (progress: DownloadProgress) => void

/** Chapter info from API */
interface ChapterInfo {
  number: number
  title: string
  id?: string
}

/** Book details from API */
interface BookDetails {
  id: string
  title: string
  author: string
  cover_url?: string | null
  has_cover?: boolean
  file_size?: number
  genre?: string | null
  language?: string
  total_chapters?: number
  chapters?: ChapterInfo[]
}

/** Chapter content from API */
interface ChapterContent {
  chapter: {
    content: string
    title?: string
    word_count?: number
  }
  descriptions?: Array<{
    id: string
    content: string
    type: string
    confidence_score?: number
    generated_image?: {
      image_url?: string
      status?: string
    } | null
  }>
}

// ============================================================================
// Download Manager Class
// ============================================================================

/**
 * Singleton download manager for offline book downloads.
 *
 * Usage:
 * ```ts
 * import { downloadManager } from '@/services/downloadManager'
 *
 * // Start download
 * await downloadManager.downloadBook(bookId, userId, {
 *   onProgress: (progress) => logger.debug(progress)
 * })
 *
 * // Cancel download
 * downloadManager.cancelDownload(userId, bookId)
 *
 * // Delete offline book
 * await downloadManager.deleteOfflineBook(userId, bookId)
 * ```
 */
class DownloadManager {
  /** Map of active downloads by offlineBookId */
  private activeDownloads = new Map<string, AbortController>()

  /** Progress callbacks by offlineBookId */
  private progressCallbacks = new Map<string, Set<ProgressCallback>>()

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Download a book for offline reading.
   *
   * Downloads book metadata, all chapters, and their descriptions.
   * Progress is saved in IndexedDB so downloads can be resumed.
   *
   * @param bookId - Book ID to download
   * @param userId - Current user ID
   * @param options - Download options
   * @throws Error if download is already in progress
   */
  async downloadBook(
    bookId: string,
    userId: string,
    options?: {
      includeImages?: boolean
      onProgress?: ProgressCallback
    }
  ): Promise<void> {
    const key = createOfflineBookId(userId, bookId)

    // Check if download already in progress
    if (this.activeDownloads.has(key)) {
      throw new Error('Download already in progress')
    }

    const controller = new AbortController()
    this.activeDownloads.set(key, controller)

    if (options?.onProgress) {
      this.addProgressCallback(key, options.onProgress)
    }

    let totalChapters = 0

    try {
      // 1. Get book metadata
      logger.debug(`[DownloadManager] Starting download for book ${bookId}`)
      const book = await this.fetchBookDetails(bookId, controller.signal)

      // 2. Get chapters list
      const chapters = book.chapters ?? []
      totalChapters = chapters.length || book.total_chapters || 0

      if (totalChapters === 0) {
        throw new Error('Book has no chapters')
      }

      // 3. Create offline book record
      const metadata: BookMetadata = {
        title: book.title,
        author: book.author,
        coverUrl: book.has_cover
          ? `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${bookId}/cover`
          : null,
        totalChapters,
        fileSize: book.file_size || 0,
        genre: book.genre || null,
        language: book.language || 'ru',
      }

      const offlineBook: OfflineBook = {
        id: key,
        userId,
        bookId,
        metadata,
        downloadedAt: Date.now(),
        lastAccessedAt: Date.now(),
        downloadProgress: 0,
        status: 'downloading',
      }

      await db.offlineBooks.put(offlineBook)

      // 4. Download chapters sequentially
      for (let i = 0; i < totalChapters; i++) {
        // Check for cancellation
        if (controller.signal.aborted) {
          await db.offlineBooks.update(key, { status: 'partial' })
          throw new Error('Download cancelled')
        }

        const chapterNumber = chapters[i]?.number ?? i + 1
        const chapterTitle = chapters[i]?.title ?? `Chapter ${chapterNumber}`

        await this.downloadChapter(
          userId,
          bookId,
          chapterNumber,
          chapterTitle,
          controller.signal
        )

        // Update progress
        const progress = Math.round(((i + 1) / totalChapters) * 100)
        await db.offlineBooks.update(key, { downloadProgress: progress })

        this.notifyProgress(key, {
          bookId,
          totalChapters,
          downloadedChapters: i + 1,
          currentChapter: chapterNumber,
          status: 'downloading',
        })
      }

      // 5. Mark as complete
      await db.offlineBooks.update(key, {
        status: 'complete',
        downloadProgress: 100,
      })

      this.notifyProgress(key, {
        bookId,
        totalChapters,
        downloadedChapters: totalChapters,
        currentChapter: totalChapters,
        status: 'complete',
      })

      logger.debug(`[DownloadManager] Book ${bookId} download complete`)
    } catch (error) {
      const errorMessage = (error as Error).message

      if (errorMessage !== 'Download cancelled') {
        logger.error(`[DownloadManager] Download failed:`, error)
        await db.offlineBooks.update(key, { status: 'error' })

        this.notifyProgress(key, {
          bookId,
          totalChapters,
          downloadedChapters: 0,
          currentChapter: 0,
          status: 'error',
          error: errorMessage,
        })
      }

      throw error
    } finally {
      this.activeDownloads.delete(key)
      this.progressCallbacks.delete(key)
    }
  }

  /**
   * Cancel an in-progress download.
   *
   * @param userId - User ID
   * @param bookId - Book ID
   */
  cancelDownload(userId: string, bookId: string): void {
    const key = createOfflineBookId(userId, bookId)
    const controller = this.activeDownloads.get(key)

    if (controller) {
      logger.debug(`[DownloadManager] Cancelling download for book ${bookId}`)
      controller.abort()
    }
  }

  /**
   * Delete an offline book and all its cached data.
   *
   * @param userId - User ID
   * @param bookId - Book ID
   */
  async deleteOfflineBook(userId: string, bookId: string): Promise<void> {
    const key = createOfflineBookId(userId, bookId)

    // Cancel if downloading
    this.cancelDownload(userId, bookId)

    logger.debug(`[DownloadManager] Deleting offline book ${bookId}`)

    // Delete all related data in a transaction
    await db.transaction(
      'rw',
      db.offlineBooks,
      db.chapters,
      db.images,
      async () => {
        // Delete offline book record
        await db.offlineBooks.delete(key)

        // Delete all chapters for this book
        await db.chapters.where('[userId+bookId]').equals([userId, bookId]).delete()

        // Delete all images for this book
        await db.images.where({ userId, bookId }).delete()
      }
    )

    logger.debug(`[DownloadManager] Offline book ${bookId} deleted`)
  }

  /**
   * Check if a download is in progress.
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @returns True if download is active
   */
  isDownloading(userId: string, bookId: string): boolean {
    const key = createOfflineBookId(userId, bookId)
    return this.activeDownloads.has(key)
  }

  /**
   * Get the current download status for a book.
   *
   * @param userId - User ID
   * @param bookId - Book ID
   * @returns Offline book record or undefined
   */
  async getDownloadStatus(
    userId: string,
    bookId: string
  ): Promise<OfflineBook | undefined> {
    const key = createOfflineBookId(userId, bookId)
    return db.offlineBooks.get(key)
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Fetch book details from API.
   */
  private async fetchBookDetails(
    bookId: string,
    signal: AbortSignal
  ): Promise<BookDetails> {
    const response = await apiClient.client.get<BookDetails>(
      `/books/${bookId}`,
      { signal }
    )
    return response.data
  }

  /**
   * Download a single chapter.
   */
  private async downloadChapter(
    userId: string,
    bookId: string,
    chapterNumber: number,
    chapterTitle: string,
    signal: AbortSignal
  ): Promise<void> {
    const chapterId = createChapterId(userId, bookId, chapterNumber)

    // Check if already cached
    const existing = await db.chapters.get(chapterId)
    if (existing) {
      logger.debug(
        `[DownloadManager] Chapter ${chapterNumber} already cached, skipping`
      )
      return
    }

    // Fetch chapter content
    const contentResponse = await apiClient.client.get<ChapterContent>(
      `/books/${bookId}/chapters/${chapterNumber}`,
      { signal }
    )
    const content = contentResponse.data

    // Map descriptions to cached format
    const cachedDescriptions: CachedDescription[] = (
      content.descriptions ?? []
    ).map((desc) => ({
      id: desc.id,
      content: desc.content,
      type: this.mapDescriptionType(desc.type),
      confidence: desc.confidence_score ?? 0.5,
      imageUrl: desc.generated_image?.image_url ?? null,
      imageStatus: desc.generated_image?.status === 'completed' ? 'generated' : 'none',
    }))

    // Save to IndexedDB
    const now = Date.now()
    const chapter: CachedChapter = {
      id: chapterId,
      userId,
      bookId,
      chapterNumber,
      title: content.chapter.title ?? chapterTitle,
      content: content.chapter.content ?? '',
      descriptions: cachedDescriptions,
      wordCount: content.chapter.word_count ?? 0,
      cachedAt: now,
      lastAccessedAt: now,
    }

    await db.chapters.put(chapter)
    logger.debug(`[DownloadManager] Chapter ${chapterNumber} downloaded`)
  }

  /**
   * Map API description type to cached type.
   */
  private mapDescriptionType(
    apiType: string
  ): CachedDescription['type'] {
    const typeMap: Record<string, CachedDescription['type']> = {
      action: 'scene',
      character: 'character',
      location: 'setting',
      object: 'object',
      atmosphere: 'setting',
    }
    return typeMap[apiType] ?? 'object'
  }

  /**
   * Add a progress callback.
   */
  private addProgressCallback(key: string, callback: ProgressCallback): void {
    if (!this.progressCallbacks.has(key)) {
      this.progressCallbacks.set(key, new Set())
    }
    this.progressCallbacks.get(key)!.add(callback)
  }

  /**
   * Notify all progress callbacks.
   */
  private notifyProgress(key: string, progress: DownloadProgress): void {
    const callbacks = this.progressCallbacks.get(key)
    if (callbacks) {
      callbacks.forEach((cb) => cb(progress))
    }
  }
}

// ============================================================================
// Export
// ============================================================================

/** Singleton download manager instance */
export const downloadManager = new DownloadManager()

export type { ProgressCallback }
