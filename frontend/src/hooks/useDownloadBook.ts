/**
 * React hook for downloading books for offline reading.
 *
 * Provides state management and controls for book downloads.
 * Integrates with downloadManager service and useOfflineBook hook.
 *
 * Features:
 * - Download progress tracking
 * - Cancel/delete support
 * - Error handling
 * - Automatic cache invalidation
 *
 * @module hooks/useDownloadBook
 */

import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  downloadManager,
  type DownloadProgress,
} from '@/services/downloadManager'
import { useOfflineBook } from './useOfflineBook'
import { useAuthStore } from '@/stores/auth'
import { bookKeys } from './api/queryKeys'
import { logger } from '@/lib/logger';

/**
 * Hook for managing book downloads.
 *
 * Provides reactive state for download progress and controls.
 *
 * @param bookId - Book ID to download
 * @returns Download state and control functions
 *
 * @example
 * ```tsx
 * const {
 *   isAvailableOffline,
 *   isDownloading,
 *   downloadProgress,
 *   error,
 *   startDownload,
 *   cancelDownload,
 *   deleteOfflineBook,
 * } = useDownloadBook(bookId)
 *
 * if (isAvailableOffline) {
 *   return <span>Available offline</span>
 * }
 *
 * if (isDownloading) {
 *   return <Progress value={downloadProgress} />
 * }
 *
 * return <Button onClick={startDownload}>Download</Button>
 * ```
 */
export function useDownloadBook(bookId: string) {
  const user = useAuthStore((state) => state.user)
  const userId = user?.id ?? ''
  const queryClient = useQueryClient()

  // Get current offline state from IndexedDB
  const {
    offlineBook,
    isAvailableOffline,
    isDownloading: isDownloadingFromDB,
  } = useOfflineBook(bookId)

  // Local state for download progress
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync with DB status on mount and changes
  useEffect(() => {
    if (offlineBook?.status === 'downloading') {
      setIsDownloading(true)
    } else if (offlineBook?.status === 'error') {
      setError('Download failed. Please try again.')
    }
  }, [offlineBook?.status])

  // Check if download is in progress via manager
  useEffect(() => {
    if (userId && bookId) {
      const isActive = downloadManager.isDownloading(userId, bookId)
      if (isActive) {
        setIsDownloading(true)
      }
    }
  }, [userId, bookId])

  /**
   * Start downloading the book.
   */
  const startDownload = useCallback(async () => {
    if (!userId || !bookId) {
      logger.warn('[useDownloadBook] Cannot download: userId or bookId missing')
      return
    }

    setIsDownloading(true)
    setError(null)
    setProgress(null)

    try {
      logger.debug(`[useDownloadBook] Starting download for book ${bookId}`)

      await downloadManager.downloadBook(bookId, userId, {
        onProgress: setProgress,
      })

      logger.debug(`[useDownloadBook] Download complete for book ${bookId}`)

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: bookKeys.all(userId) })
      queryClient.invalidateQueries({ queryKey: bookKeys.detail(userId, bookId) })
    } catch (err) {
      const errorMessage = (err as Error).message

      if (errorMessage !== 'Download cancelled') {
        logger.error('[useDownloadBook] Download failed:', err)
        setError(errorMessage)
      }
    } finally {
      setIsDownloading(false)
    }
  }, [userId, bookId, queryClient])

  /**
   * Cancel the current download.
   */
  const cancelDownload = useCallback(() => {
    if (!userId || !bookId) return

    logger.debug(`[useDownloadBook] Cancelling download for book ${bookId}`)
    downloadManager.cancelDownload(userId, bookId)
    setIsDownloading(false)
    setProgress(null)
  }, [userId, bookId])

  /**
   * Delete the offline book and all cached data.
   */
  const deleteOfflineBook = useCallback(async () => {
    if (!userId || !bookId) return

    logger.debug(`[useDownloadBook] Deleting offline book ${bookId}`)

    try {
      await downloadManager.deleteOfflineBook(userId, bookId)

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: bookKeys.all(userId) })
      queryClient.invalidateQueries({ queryKey: bookKeys.detail(userId, bookId) })

      // Reset local state
      setProgress(null)
      setError(null)
    } catch (err) {
      logger.error('[useDownloadBook] Failed to delete offline book:', err)
      setError((err as Error).message)
    }
  }, [userId, bookId, queryClient])

  /**
   * Retry a failed download.
   */
  const retryDownload = useCallback(async () => {
    // Clear error and restart download
    setError(null)
    await startDownload()
  }, [startDownload])

  // Calculate download progress percentage
  const downloadProgress =
    progress?.status === 'downloading'
      ? Math.round(
          (progress.downloadedChapters / progress.totalChapters) * 100
        )
      : offlineBook?.downloadProgress ?? 0

  return {
    /** Whether the book is fully available offline */
    isAvailableOffline,

    /** Whether a download is in progress */
    isDownloading: isDownloading || isDownloadingFromDB,

    /** Current download progress details */
    progress,

    /** Error message if download failed */
    error,

    /** Download progress percentage (0-100) */
    downloadProgress,

    /** Total chapters in the book */
    totalChapters: progress?.totalChapters ?? offlineBook?.metadata.totalChapters ?? 0,

    /** Number of chapters downloaded */
    downloadedChapters: progress?.downloadedChapters ?? 0,

    /** Offline book metadata */
    offlineBook,

    /** Start downloading the book */
    startDownload,

    /** Cancel the current download */
    cancelDownload,

    /** Delete the offline book */
    deleteOfflineBook,

    /** Retry a failed download */
    retryDownload,
  }
}

export default useDownloadBook
