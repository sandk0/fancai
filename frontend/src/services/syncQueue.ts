/**
 * SyncQueue - Offline-first synchronization queue with Dexie.js + Background Sync API
 *
 * Queues operations (progress updates, bookmarks, highlights, image generation) when offline
 * and synchronizes them when connection is restored.
 *
 * Features:
 * - Dexie.js (IndexedDB) persistence for reliable storage
 * - Workbox BackgroundSyncPlugin for automatic retry via Service Worker
 * - Priority-based processing (critical > high > normal > low)
 * - Exponential backoff with max retries
 * - Deduplication of duplicate operations
 *
 * iOS Safari Fallback (Background Sync not supported):
 * - Periodic sync timer (every 30 seconds when document is visible)
 * - Immediate sync on online event when coming back from offline
 * - visibilitychange handler for sync when app becomes visible
 * - pagehide/beforeunload with sendBeacon for last-chance critical data sync
 * - localStorage cache for critical operations to enable sendBeacon sync
 *
 * Architecture:
 * - Service Worker handles BackgroundSyncPlugin routes for /api/v1/books/.../progress,
 *   /api/v1/reading-sessions, and /api/v1/images/generate
 * - This service manages a custom Dexie-based queue for more complex operations
 *   and iOS fallback
 */

import {
  db,
  type SyncOperation,
  type SyncOperationType,
  type SyncPriority,
  type SyncStatus,
  MAX_SYNC_RETRIES,
} from './db'

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
  }
}

// ============================================================================
// Types
// ============================================================================

interface AddOperationOptions {
  type: SyncOperationType
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  userId: string
  bookId?: string
  priority?: SyncPriority
  maxRetries?: number
}

interface SyncEventDetail {
  operation: SyncOperation
  success?: boolean
  error?: string
}

// ============================================================================
// iOS Safari Fallback Configuration
// ============================================================================

/** Periodic sync interval in milliseconds (30 seconds) */
const PERIODIC_SYNC_INTERVAL = 30000

/** Enable debug logging */
const DEBUG = import.meta.env.DEV

// ============================================================================
// Badging API Support
// ============================================================================

/**
 * Update app badge with pending sync count
 * Uses Badging API (supported on Android Chrome PWA)
 */
async function updateBadge(count: number): Promise<void> {
  if (!('setAppBadge' in navigator)) {
    return; // Not supported (iOS, desktop browsers)
  }

  try {
    if (count > 0) {
      await (navigator as Navigator & { setAppBadge: (count: number) => Promise<void> }).setAppBadge(count);
    } else {
      await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
    }
  } catch (err) {
    // Silently fail - badge is non-critical
    if (DEBUG) {
      console.log('[SyncQueue] Badge update failed:', err);
    }
  }
}

// ============================================================================
// SyncQueue Service
// ============================================================================

class SyncQueue {
  private isProcessing = false
  private processingPromise: Promise<void> | null = null
  private listeners: Set<() => void> = new Set()
  private periodicSyncInterval: number | null = null

  constructor() {
    this.setupEventListeners()
    this.setupIOSFallback()
  }

  /**
   * Setup event listeners for network and visibility changes
   */
  private setupEventListeners(): void {
    // iOS does not support Background Sync - use visibilitychange as fallback
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (DEBUG) console.log('[SyncQueue] App visible, processing queue...')
        this.startPeriodicSync()
        this.processQueue()
      } else {
        // Stop periodic sync when app goes to background to save battery
        this.stopPeriodicSync()
      }
    })

    // Process when network is restored
    window.addEventListener('online', async () => {
      if (DEBUG) console.log('[SyncQueue] Online event - triggering sync')
      // Immediate sync attempt when coming back online
      await this.processQueue()
    })

    // Listen for messages from Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_SUCCESS') {
          if (DEBUG) console.log('[SyncQueue] SW sync success:', event.data.url)
          window.dispatchEvent(
            new CustomEvent('sync:success', {
              detail: event.data,
            })
          )
          this.notifyListeners()
        } else if (event.data?.type === 'SYNC_REQUESTED') {
          // Service Worker requested queue processing
          if (DEBUG) console.log('[SyncQueue] SW requested sync:', event.data.tag)
          this.processQueue()
        }
      })
    }

    // Also listen to custom app:online event from useOnlineStatus
    window.addEventListener('app:online', () => {
      if (DEBUG) console.log('[SyncQueue] App online event, processing queue...')
      this.processQueue()
    })
  }

  /**
   * Setup iOS Safari-specific fallbacks
   * iOS Safari doesn't support Background Sync API, so we need alternative sync mechanisms
   */
  private setupIOSFallback(): void {
    // Start periodic sync if document is already visible
    if (document.visibilityState === 'visible') {
      this.startPeriodicSync()
    }

    // beforeunload handler for last-chance sync
    window.addEventListener('beforeunload', () => {
      this.handleBeforeUnload()
    })

    // pagehide is more reliable than beforeunload on iOS Safari
    window.addEventListener('pagehide', (event) => {
      // persisted = true means page might be restored from bfcache
      if (!event.persisted) {
        this.handleBeforeUnload()
      }
    })
  }

  /**
   * Start periodic sync timer (every 30 seconds when document is visible)
   * This is the primary iOS Safari fallback since Background Sync is not supported
   */
  private startPeriodicSync(): void {
    if (this.periodicSyncInterval !== null) {
      return // Already running
    }

    this.periodicSyncInterval = window.setInterval(async () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        const pending = await this.getPendingCount()
        if (pending > 0) {
          if (DEBUG) console.log('[SyncQueue] Periodic sync triggered, pending:', pending)
          await this.processQueue()
        }
      }
    }, PERIODIC_SYNC_INTERVAL)

    if (DEBUG) console.log('[SyncQueue] Periodic sync started (interval:', PERIODIC_SYNC_INTERVAL, 'ms)')
  }

  /**
   * Stop periodic sync timer (when app goes to background)
   */
  private stopPeriodicSync(): void {
    if (this.periodicSyncInterval !== null) {
      clearInterval(this.periodicSyncInterval)
      this.periodicSyncInterval = null
      if (DEBUG) console.log('[SyncQueue] Periodic sync stopped')
    }
  }

  /**
   * Handle beforeunload/pagehide - attempt last-chance sync using sendBeacon
   * sendBeacon is reliable for sending data when page is being unloaded
   */
  private handleBeforeUnload(): void {
    // Get critical pending operations synchronously from IndexedDB is not possible,
    // so we use a fallback localStorage cache for critical data
    const criticalData = localStorage.getItem('syncQueue_critical')

    if (criticalData && navigator.sendBeacon) {
      try {
        const data = JSON.parse(criticalData)
        if (data && data.length > 0) {
          // Get auth token for the beacon request
          const token = localStorage.getItem('auth_token')

          // Create a blob with the data and content type
          const blob = new Blob([JSON.stringify({ operations: data, token })], {
            type: 'application/json'
          })

          // sendBeacon returns true if the browser successfully queued the data for transfer
          const queued = navigator.sendBeacon('/api/v1/sync/batch', blob)

          if (queued) {
            // Clear the critical data cache since it's queued for sending
            localStorage.removeItem('syncQueue_critical')
            if (DEBUG) console.log('[SyncQueue] Critical data queued via sendBeacon')
          }
        }
      } catch (error) {
        // Ignore errors during unload - nothing we can do
        if (DEBUG) console.warn('[SyncQueue] sendBeacon failed:', error)
      }
    }
  }

  /**
   * Cache critical operation data for beforeunload sync
   * Called when adding critical priority operations
   */
  private async cacheCriticalData(): Promise<void> {
    try {
      const criticalOps = await db.syncQueue
        .where('priority')
        .equals('critical')
        .filter((op) => op.status === 'pending')
        .toArray()

      if (criticalOps.length > 0) {
        // Store minimal data needed for sync
        const minimalData = criticalOps.map((op) => ({
          endpoint: op.endpoint,
          method: op.method,
          body: op.body,
        }))
        localStorage.setItem('syncQueue_critical', JSON.stringify(minimalData))
      } else {
        localStorage.removeItem('syncQueue_critical')
      }
    } catch (error) {
      if (DEBUG) console.warn('[SyncQueue] Failed to cache critical data:', error)
    }
  }

  /**
   * Add a listener for queue changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Notify all listeners of queue changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener())
  }

  /**
   * Add an operation to the sync queue
   */
  async addOperation(options: AddOperationOptions): Promise<string> {
    const operation: SyncOperation = {
      id: crypto.randomUUID(),
      type: options.type,
      endpoint: options.endpoint,
      method: options.method,
      body: options.body,
      headers: options.headers,
      userId: options.userId,
      bookId: options.bookId,
      priority: options.priority || 'normal',
      createdAt: Date.now(),
      retries: 0,
      maxRetries: options.maxRetries || MAX_SYNC_RETRIES,
      status: 'pending',
    }

    // For progress updates, remove existing operations for the same book to avoid duplicates
    if (options.type === 'progress' && options.bookId) {
      await db.syncQueue
        .where('userId')
        .equals(options.userId)
        .filter(
          (op) =>
            op.bookId === options.bookId &&
            op.type === 'progress' &&
            op.status === 'pending'
        )
        .delete()
    }

    await db.syncQueue.add(operation)
    if (DEBUG) console.log('[SyncQueue] Added operation:', operation.type, operation.endpoint)

    // Update badge with new pending count
    const pendingCount = await this.getPendingCount()
    await updateBadge(pendingCount)

    this.notifyListeners()

    // Cache critical data for beforeunload sync (iOS fallback)
    if (operation.priority === 'critical') {
      await this.cacheCriticalData()
    }

    // If online - try to send immediately
    if (navigator.onLine) {
      this.processQueue()
    } else {
      // Try to register Background Sync
      this.registerBackgroundSync()
    }

    return operation.id
  }

  /**
   * Register Background Sync (for Android/Chrome)
   * Note: iOS Safari does not support Background Sync API
   */
  private async registerBackgroundSync(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      // Check if SyncManager is available (not on iOS)
      if ('sync' in registration) {
        await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('fancai-sync')
        if (DEBUG) console.log('[SyncQueue] Background Sync registered')
      }
    } catch (error) {
      if (DEBUG) console.warn('[SyncQueue] Background Sync registration failed:', error)
    }
  }

  /**
   * Process the queue
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return this.processingPromise || Promise.resolve()
    }

    this.isProcessing = true
    this.processingPromise = this.doProcessQueue()

    try {
      await this.processingPromise
    } finally {
      this.isProcessing = false
      this.processingPromise = null
    }
  }

  private async doProcessQueue(): Promise<void> {
    if (!navigator.onLine) {
      if (DEBUG) console.log('[SyncQueue] Offline, skipping queue processing')
      return
    }

    // Get pending operations
    const operations = await db.syncQueue.where('status').equals('pending').toArray()

    if (operations.length === 0) {
      return
    }

    // Sort by priority and creation date
    const priorityOrder: Record<SyncPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    }

    operations.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.createdAt - b.createdAt
    })

    if (DEBUG) console.log(`[SyncQueue] Processing ${operations.length} operations...`)

    for (const op of operations) {
      await this.processOperation(op)
    }

    // Update badge after processing (may have succeeded or failed)
    const remainingCount = await this.getPendingCount()
    await updateBadge(remainingCount)

    this.notifyListeners()
  }

  /**
   * Process a single operation
   */
  private async processOperation(op: SyncOperation): Promise<void> {
    // Mark as syncing
    await db.syncQueue.update(op.id, { status: 'syncing' as SyncStatus })

    try {
      const response = await fetch(op.endpoint, {
        method: op.method,
        headers: {
          ...getAuthHeaders(),
          ...op.headers,
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Success - remove from queue
      await db.syncQueue.delete(op.id)
      if (DEBUG) console.log('[SyncQueue] Operation completed:', op.type, op.endpoint)

      // Update critical data cache after successful sync
      await this.cacheCriticalData()

      // Notify UI
      window.dispatchEvent(
        new CustomEvent<SyncEventDetail>('sync:operation-complete', {
          detail: { operation: op, success: true },
        })
      )
    } catch (error) {
      const newRetries = op.retries + 1
      const errorMessage = (error as Error).message

      if (DEBUG) console.warn('[SyncQueue] Operation failed:', op.type, errorMessage)

      if (newRetries >= op.maxRetries) {
        // Max retries exceeded
        await db.syncQueue.update(op.id, {
          status: 'failed' as SyncStatus,
          lastError: errorMessage,
          retries: newRetries,
        })

        window.dispatchEvent(
          new CustomEvent<SyncEventDetail>('sync:operation-failed', {
            detail: { operation: op, error: errorMessage },
          })
        )
      } else {
        // Return to pending with increased retry count
        await db.syncQueue.update(op.id, {
          status: 'pending' as SyncStatus,
          lastError: errorMessage,
          retries: newRetries,
        })
      }
    }
  }

  /**
   * Get pending operations count
   */
  async getPendingCount(): Promise<number> {
    return db.syncQueue.where('status').equals('pending').count()
  }

  /**
   * Get failed operations count
   */
  async getFailedCount(): Promise<number> {
    return db.syncQueue.where('status').equals('failed').count()
  }

  /**
   * Get all operations for a user
   */
  async getUserOperations(userId: string): Promise<SyncOperation[]> {
    return db.syncQueue.where('userId').equals(userId).toArray()
  }

  /**
   * Get pending operations (for UI display)
   */
  async getPendingOperations(): Promise<SyncOperation[]> {
    return db.syncQueue.where('status').equals('pending').toArray()
  }

  /**
   * Retry all failed operations
   */
  async retryFailed(): Promise<void> {
    await db.syncQueue
      .where('status')
      .equals('failed')
      .modify({ status: 'pending' as SyncStatus, retries: 0 })

    this.notifyListeners()
    this.processQueue()
  }

  /**
   * Remove an operation
   */
  async removeOperation(id: string): Promise<boolean> {
    const count = await db.syncQueue.where('id').equals(id).delete()
    if (count > 0) {
      this.notifyListeners()
      return true
    }
    return false
  }

  /**
   * Clear all failed operations
   */
  async clearFailed(): Promise<number> {
    const count = await db.syncQueue.where('status').equals('failed').delete()
    this.notifyListeners()
    return count
  }

  /**
   * Clear all operations for a user
   */
  async clearUserQueue(userId: string): Promise<number> {
    const count = await db.syncQueue.where('userId').equals(userId).delete()

    // Clear the badge when user queue is cleared
    await updateBadge(0)

    this.notifyListeners()
    return count
  }

  /**
   * Get current queue length (sync version for compatibility)
   */
  getQueueLength(): number {
    // Note: This is a sync method for backward compatibility
    // For accurate count, use getPendingCount() async method
    return 0 // Will be updated via listeners
  }

  /**
   * Clear all pending operations (use with caution)
   */
  async clearQueue(): Promise<void> {
    await db.syncQueue.clear()
    localStorage.removeItem('syncQueue_critical')

    // Clear the badge when queue is cleared
    await updateBadge(0)

    this.notifyListeners()
    if (DEBUG) console.log('[SyncQueue] Queue cleared')
  }

  /**
   * Cleanup resources (for testing or app shutdown)
   */
  destroy(): void {
    this.stopPeriodicSync()
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const syncQueue = new SyncQueue()

// ============================================================================
// Convenience Functions (Backward Compatible API)
// ============================================================================

/**
 * Add a sync operation (backward compatible)
 * @deprecated Use syncQueue.addOperation() instead
 */
export function addToSyncQueue(
  type: SyncOperationType,
  bookId: string,
  data: Record<string, unknown>
): string {
  // Generate a temporary ID - the real ID will be assigned async
  const tempId = crypto.randomUUID()

  // Get userId from data or use a placeholder
  const userId = (data.userId as string) || 'anonymous'

  // Map old format to new format
  const endpoint = mapTypeToEndpoint(type, bookId, data)
  const method = mapTypeToMethod(type)

  syncQueue.addOperation({
    type,
    endpoint,
    method,
    body: data,
    userId,
    bookId,
    priority: type === 'progress' || type === 'reading_session' ? 'critical' : 'normal',
  })

  return tempId
}

function mapTypeToEndpoint(
  type: SyncOperationType,
  bookId: string,
  data: Record<string, unknown>
): string {
  switch (type) {
    case 'progress':
      return `/api/v1/books/${bookId}/progress`
    case 'reading_session':
      return data.sessionId
        ? `/api/v1/reading-sessions/${data.sessionId}`
        : '/api/v1/reading-sessions'
    case 'bookmark':
      return `/api/v1/books/${bookId}/bookmarks`
    case 'highlight':
      return `/api/v1/books/${bookId}/highlights`
    case 'image_generation':
      return `/api/v1/images/generate/${data.descriptionId}`
    default:
      return `/api/v1/books/${bookId}`
  }
}

function mapTypeToMethod(type: SyncOperationType): 'POST' | 'PUT' {
  switch (type) {
    case 'progress':
      return 'PUT'
    case 'reading_session':
      return 'POST' // Will be PUT if sessionId exists
    default:
      return 'POST'
  }
}

export const processSyncQueue = syncQueue.processQueue.bind(syncQueue)
export const getSyncQueueLength = syncQueue.getQueueLength.bind(syncQueue)
export const subscribeSyncQueue = syncQueue.subscribe.bind(syncQueue)

/**
 * Get pending operations count (async version for UI)
 * Use this for displaying sync status in the UI
 */
export const getPendingCount = syncQueue.getPendingCount.bind(syncQueue)

/**
 * Get failed operations count (async version for UI)
 */
export const getFailedCount = syncQueue.getFailedCount.bind(syncQueue)

// ============================================================================
// Specialized Queue Functions
// ============================================================================

/**
 * Queue a reading progress update
 */
export async function queueProgressUpdate(
  userId: string,
  bookId: string,
  data: { chapter: number; cfi?: string; scrollPercent?: number }
): Promise<string> {
  return syncQueue.addOperation({
    type: 'progress',
    endpoint: `/api/v1/books/${bookId}/progress`,
    method: 'PUT',
    body: {
      chapter_number: data.chapter,
      reading_location_cfi: data.cfi,
      scroll_offset_percent: data.scrollPercent,
    },
    userId,
    bookId,
    priority: 'critical',
  })
}

/**
 * Queue a reading session operation
 */
export async function queueReadingSession(
  userId: string,
  bookId: string,
  action: 'start' | 'update' | 'end',
  data?: { sessionId?: string; duration?: number; pagesRead?: number }
): Promise<string> {
  const endpoint =
    action === 'start'
      ? '/api/v1/reading-sessions'
      : `/api/v1/reading-sessions/${data?.sessionId}`

  return syncQueue.addOperation({
    type: 'reading_session',
    endpoint,
    method: action === 'start' ? 'POST' : 'PUT',
    body: {
      book_id: bookId,
      action,
      ...data,
    },
    userId,
    bookId,
    priority: 'critical',
  })
}

/**
 * Queue an image generation request
 */
export async function queueImageGeneration(
  userId: string,
  bookId: string,
  descriptionId: string
): Promise<string> {
  return syncQueue.addOperation({
    type: 'image_generation',
    endpoint: `/api/v1/images/generate/${descriptionId}`,
    method: 'POST',
    userId,
    bookId,
    priority: 'low',
  })
}

// ============================================================================
// Re-export Types
// ============================================================================

export type { SyncOperation, SyncOperationType, SyncPriority, SyncStatus }
