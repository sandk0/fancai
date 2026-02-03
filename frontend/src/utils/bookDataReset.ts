/**
 * Book Data Reset Utility
 *
 * Resets all cached data for a specific book across multiple storage layers.
 * Use this to recover from "Forever Broken" state caused by corrupted IndexedDB data.
 *
 * Storage layers cleared:
 * 1. localStorage - progress backup (`book_${bookId}_progress_backup`)
 * 2. IndexedDB "BookReaderAI" - epub locations cache (via clearCachedLocations)
 * 3. Dexie.js (FancaiDB) - chapters, images, offlineBooks, readingProgress, syncQueue
 * 4. TanStack Query cache - all queries related to the book
 *
 * @module utils/bookDataReset
 */

import { db, createOfflineBookId, createProgressId } from '@/services/db'
import { chapterCache } from '@/services/chapterCache'
import { imageCache } from '@/services/imageCache'
import { syncQueue } from '@/services/syncQueue'
import { clearCachedLocations } from '@/hooks/epub/useLocationGeneration'
import { queryClient } from '@/lib/queryClient'
import { logger } from '@/lib/logger';
import {
  bookKeys,
  chapterKeys,
  descriptionKeys,
  imageKeys,
  pwaKeys,
} from '@/hooks/api/queryKeys'

/**
 * Result of a book data reset operation
 */
export interface BookDataResetResult {
  /** Whether at least some data was cleared */
  success: boolean
  /** Errors encountered during reset (empty array if none) */
  errors: Error[]
  /** Details about what was cleared */
  cleared: {
    localStorage: boolean
    epubLocations: boolean
    chapters: number
    images: number
    offlineBook: boolean
    readingProgress: boolean
    syncQueue: number
    queryCache: boolean
  }
}

/**
 * Reset all cached data for a specific book.
 *
 * Use this to recover from "Forever Broken" state caused by corrupted IndexedDB data,
 * or to fully clean up book data before deletion.
 *
 * @param userId - Current user ID
 * @param bookId - Book ID to reset
 * @returns Result object with success status, errors, and cleared details
 *
 * @example
 * ```typescript
 * import { resetBookData } from '@/utils/bookDataReset';
 *
 * async function handleResetBook(bookId: string) {
 *   const userId = useAuthStore.getState().user?.id;
 *   if (!userId) return;
 *
 *   const result = await resetBookData(userId, bookId);
 *   if (result.success) {
 *     logger.debug('Book data reset complete');
 *   } else {
 *     logger.error('Reset completed with errors:', result.errors);
 *   }
 * }
 * ```
 */
export async function resetBookData(
  userId: string,
  bookId: string
): Promise<BookDataResetResult> {
  logger.debug('[resetBookData] Starting reset for book:', bookId)

  const errors: Error[] = []
  const cleared: BookDataResetResult['cleared'] = {
    localStorage: false,
    epubLocations: false,
    chapters: 0,
    images: 0,
    offlineBook: false,
    readingProgress: false,
    syncQueue: 0,
    queryCache: false,
  }

  // 1. Clear localStorage backup
  try {
    localStorage.removeItem(`book_${bookId}_progress_backup`)
    cleared.localStorage = true
    logger.debug('[resetBookData] Cleared localStorage backup')
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear localStorage:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 2. Clear IndexedDB "BookReaderAI" (epub locations)
  try {
    await clearCachedLocations(bookId)
    cleared.epubLocations = true
    logger.debug('[resetBookData] Cleared epub locations cache')
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear locations:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 3. Clear Dexie.js chapter cache
  try {
    cleared.chapters = await chapterCache.clearBook(userId, bookId)
    logger.debug('[resetBookData] Cleared chapter cache:', cleared.chapters)
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear chapters:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 4. Clear Dexie.js image cache for book
  try {
    cleared.images = await imageCache.clearBook(userId, bookId)
    logger.debug('[resetBookData] Cleared image cache:', cleared.images)
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear images:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 5. Clear offline book record if exists
  try {
    const offlineBookId = createOfflineBookId(userId, bookId)
    await db.offlineBooks.delete(offlineBookId)
    cleared.offlineBook = true
    logger.debug('[resetBookData] Cleared offline book record')
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear offline book:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 6. Clear reading progress from Dexie
  try {
    const progressId = createProgressId(userId, bookId)
    await db.readingProgress.delete(progressId)
    cleared.readingProgress = true
    logger.debug('[resetBookData] Cleared reading progress')
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear reading progress:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 7. Clear sync queue entries for this book
  try {
    const syncOps = await db.syncQueue
      .where('userId')
      .equals(userId)
      .filter((op) => op.bookId === bookId)
      .toArray()

    if (syncOps.length > 0) {
      const syncIds = syncOps.map((op) => op.id)
      await db.syncQueue.bulkDelete(syncIds)
      cleared.syncQueue = syncIds.length
    }
    logger.debug('[resetBookData] Cleared sync queue:', cleared.syncQueue)
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear sync queue:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 8. Invalidate and remove TanStack Query cache
  try {
    // Remove all queries related to this book (using proper query keys)
    queryClient.removeQueries({ queryKey: bookKeys.detail(userId, bookId) })
    queryClient.removeQueries({ queryKey: bookKeys.progress(userId, bookId) })
    queryClient.removeQueries({ queryKey: bookKeys.parsingStatus(userId, bookId) })
    queryClient.removeQueries({ queryKey: bookKeys.fileUrl(userId, bookId) })
    queryClient.removeQueries({ queryKey: chapterKeys.byBook(userId, bookId) })
    queryClient.removeQueries({ queryKey: descriptionKeys.byBook(userId, bookId) })
    queryClient.removeQueries({ queryKey: imageKeys.byBook(userId, bookId) })
    queryClient.removeQueries({ queryKey: pwaKeys.downloadStatus(userId, bookId) })

    cleared.queryCache = true
    logger.debug('[resetBookData] Cleared TanStack Query cache')
  } catch (e) {
    logger.warn('[resetBookData] Failed to clear query cache:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // Determine success: at least something was cleared
  const success =
    cleared.localStorage ||
    cleared.epubLocations ||
    cleared.chapters > 0 ||
    cleared.images > 0 ||
    cleared.offlineBook ||
    cleared.readingProgress ||
    cleared.syncQueue > 0 ||
    cleared.queryCache

  if (errors.length > 0) {
    logger.warn('[resetBookData] Completed with errors:', errors.length, errors)
  } else {
    logger.debug('[resetBookData] Reset complete for book:', bookId)
  }

  return { success, errors, cleared }
}

/**
 * Reset all cached data for all books of a user.
 *
 * Use with caution - this will clear ALL book data for the user.
 *
 * @param userId - Current user ID
 * @returns Result object with summary of what was cleared
 */
export async function resetAllUserData(userId: string): Promise<{
  success: boolean
  errors: Error[]
  totalCleared: {
    chapters: number
    images: number
    offlineBooks: number
    readingProgress: number
    syncQueue: number
  }
}> {
  logger.debug('[resetAllUserData] Starting full reset for user:', userId)

  const errors: Error[] = []
  const totalCleared = {
    chapters: 0,
    images: 0,
    offlineBooks: 0,
    readingProgress: 0,
    syncQueue: 0,
  }

  // 1. Clear all chapters for user
  try {
    totalCleared.chapters = await chapterCache.clearAll(userId)
    logger.debug('[resetAllUserData] Cleared chapters:', totalCleared.chapters)
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear chapters:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 2. Clear all images for user
  try {
    totalCleared.images = await imageCache.clearAll(userId)
    logger.debug('[resetAllUserData] Cleared images:', totalCleared.images)
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear images:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 3. Clear all offline books for user
  try {
    totalCleared.offlineBooks = await db.offlineBooks.where({ userId }).delete()
    logger.debug('[resetAllUserData] Cleared offline books:', totalCleared.offlineBooks)
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear offline books:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 4. Clear all reading progress for user
  try {
    const progressDocs = await db.readingProgress.where('userId').equals(userId).toArray()
    if (progressDocs.length > 0) {
      await db.readingProgress.bulkDelete(progressDocs.map((p) => p.id))
      totalCleared.readingProgress = progressDocs.length
    }
    logger.debug('[resetAllUserData] Cleared reading progress:', totalCleared.readingProgress)
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear reading progress:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 5. Clear sync queue for user
  try {
    totalCleared.syncQueue = await syncQueue.clearUserQueue(userId)
    logger.debug('[resetAllUserData] Cleared sync queue:', totalCleared.syncQueue)
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear sync queue:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  // 6. Clear TanStack Query cache for user
  try {
    queryClient.removeQueries({ queryKey: bookKeys.all(userId) })
    queryClient.removeQueries({ queryKey: chapterKeys.all(userId) })
    queryClient.removeQueries({ queryKey: descriptionKeys.all(userId) })
    queryClient.removeQueries({ queryKey: imageKeys.all(userId) })
    queryClient.removeQueries({ queryKey: pwaKeys.all(userId) })
    logger.debug('[resetAllUserData] Cleared TanStack Query cache')
  } catch (e) {
    logger.warn('[resetAllUserData] Failed to clear query cache:', e)
    errors.push(e instanceof Error ? e : new Error(String(e)))
  }

  const success = errors.length === 0

  if (errors.length > 0) {
    logger.warn('[resetAllUserData] Completed with errors:', errors.length, errors)
  } else {
    logger.debug('[resetAllUserData] Full reset complete for user:', userId)
  }

  return { success, errors, totalCleared }
}
