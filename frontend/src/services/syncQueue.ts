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
  type PendingSyncRequest,
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

const PERIODIC_SYNC_INTERVAL = 30000
const MAX_QUEUE_SIZE = 50
const MAX_PENDING_RETRY_COUNT = 3

import { logger } from '@/lib/logger'

function sendWithBeaconOrFetch(url: string, blob: Blob): boolean {
  try {
    if (navigator.sendBeacon) {
      const queued = navigator.sendBeacon(url, blob)
      if (queued) return true
    }
  } catch {
    // sendBeacon threw — fall through to fetch
  }

  try {
    fetch(url, {
      method: 'POST',
      body: blob,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {
      // fire-and-forget during unload
    })
    return true
  } catch {
    return false
  }
}

async function persistFailedRequest(url: string, method: string, body: string): Promise<void> {
  try {
    const request: PendingSyncRequest = {
      id: crypto.randomUUID(),
      url,
      method,
      body,
      timestamp: Date.now(),
      retryCount: 0,
    }
    await db.pendingSyncRequests.add(request)

    const count = await db.pendingSyncRequests.count()
    if (count > MAX_QUEUE_SIZE) {
      const oldest = await db.pendingSyncRequests.orderBy('timestamp').first()
      if (oldest) {
        await db.pendingSyncRequests.delete(oldest.id)
      }
    }
  } catch {
    // IndexedDB may be unavailable during unload
  }
}

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
    logger.debug('[SyncQueue] Badge update failed:', err);
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
        logger.debug('[SyncQueue] App visible, processing queue...')
        this.startPeriodicSync()
        this.processQueue()
      } else {
        // Stop periodic sync when app goes to background to save battery
        this.stopPeriodicSync()
      }
    })

    // Process when network is restored
    window.addEventListener('online', async () => {
      logger.debug('[SyncQueue] Online event - triggering sync')
      // Immediate sync attempt when coming back online
      await this.processQueue()
    })

    // Listen for messages from Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_SUCCESS') {
          logger.debug('[SyncQueue] SW sync success:', event.data.url)
          window.dispatchEvent(
            new CustomEvent('sync:success', {
              detail: event.data,
            })
          )
          this.notifyListeners()
        } else if (event.data?.type === 'SYNC_REQUESTED') {
          // Service Worker requested queue processing
          logger.debug('[SyncQueue] SW requested sync:', event.data.tag)
          this.processQueue()
        }
      })
    }

    // Also listen to custom app:online event from useOnlineStatus
    window.addEventListener('app:online', () => {
      logger.debug('[SyncQueue] App online event, processing queue...')
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
          logger.debug('[SyncQueue] Periodic sync triggered, pending:', pending)
          await this.processQueue()
        }
      }
    }, PERIODIC_SYNC_INTERVAL)

    logger.debug('[SyncQueue] Periodic sync started (interval:', PERIODIC_SYNC_INTERVAL, 'ms)')
  }

  /**
   * Stop periodic sync timer (when app goes to background)
   */
  private stopPeriodicSync(): void {
    if (this.periodicSyncInterval !== null) {
      clearInterval(this.periodicSyncInterval)
      this.periodicSyncInterval = null
      logger.debug('[SyncQueue] Periodic sync stopped')
    }
  }

  /**
   * Handle beforeunload/pagehide - attempt last-chance sync using sendBeacon
   * sendBeacon is reliable for sending data when page is being unloaded
   */
  private handleBeforeUnload(): void {
    const criticalData = localStorage.getItem('syncQueue_critical')
    if (!criticalData) return

    try {
      const data = JSON.parse(criticalData) as unknown
      if (!Array.isArray(data) || data.length === 0) return

      const bodyStr = JSON.stringify({ operations: data })
      const blob = new Blob([bodyStr], { type: 'application/json' })
      const url = '/api/v1/sync/batch'

      const sent = sendWithBeaconOrFetch(url, blob)

      if (sent) {
        localStorage.removeItem('syncQueue_critical')
        logger.debug('[SyncQueue] Critical data sent during unload')
      } else {
        persistFailedRequest(url, 'POST', bodyStr)
        logger.debug('[SyncQueue] Persisted failed unload request to IndexedDB')
      }
    } catch {
      logger.debug('[SyncQueue] handleBeforeUnload failed')
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
      logger.debug('[SyncQueue] Failed to cache critical data:', error)
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

    const queueSize = await db.syncQueue.count()
    if (queueSize >= MAX_QUEUE_SIZE) {
      const oldest = await db.syncQueue.orderBy('createdAt').first()
      if (oldest) {
        await db.syncQueue.delete(oldest.id)
        logger.debug('[SyncQueue] Queue full, dropped oldest:', oldest.type, oldest.endpoint)
      }
    }

    await db.syncQueue.add(operation)
    logger.debug('[SyncQueue] Added operation:', operation.type, operation.endpoint)

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
        logger.debug('[SyncQueue] Background Sync registered')
      }
    } catch (error) {
      logger.debug('[SyncQueue] Background Sync registration failed:', error)
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
      logger.debug('[SyncQueue] Offline, skipping queue processing')
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

    logger.debug(`[SyncQueue] Processing ${operations.length} operations...`)

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
      logger.debug('[SyncQueue] Operation completed:', op.type, op.endpoint)

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

      logger.debug('[SyncQueue] Operation failed:', op.type, errorMessage)

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
    logger.debug('[SyncQueue] Queue cleared')
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

export async function retryPendingSync(): Promise<void> {
  let requests: PendingSyncRequest[]
  try {
    requests = await db.pendingSyncRequests.toArray()
  } catch {
    return
  }

  if (requests.length === 0) return

  logger.debug(`[SyncQueue] Retrying ${requests.length} persisted requests`)

  for (const req of requests) {
    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body,
        credentials: 'include',
      })

      if (response.ok) {
        await db.pendingSyncRequests.delete(req.id)
        logger.debug('[SyncQueue] Persisted request retried successfully:', req.url)
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch {
      const newRetryCount = req.retryCount + 1
      if (newRetryCount > MAX_PENDING_RETRY_COUNT) {
        await db.pendingSyncRequests.delete(req.id)
        logger.debug('[SyncQueue] Persisted request exceeded max retries, dropped:', req.url)
      } else {
        await db.pendingSyncRequests.update(req.id, { retryCount: newRetryCount })
      }
    }
  }
}

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
      if (data.action === 'start') return '/api/v1/reading-sessions/start';
      if (data.action === 'update') return `/api/v1/reading-sessions/${data.sessionId}/update`;
      if (data.action === 'end') return `/api/v1/reading-sessions/${data.sessionId}/end`;
      return data.sessionId
        ? `/api/v1/reading-sessions/${data.sessionId}/update`
        : '/api/v1/reading-sessions/start'
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
      return 'POST'
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
  data?: { sessionId?: string; duration?: number; pagesRead?: number; currentPosition?: number; endPosition?: number }
): Promise<string> {
  let endpoint = '/api/v1/reading-sessions';
  if (action === 'start') {
    endpoint = '/api/v1/reading-sessions/start';
  } else if (action === 'update' && data?.sessionId) {
    endpoint = `/api/v1/reading-sessions/${data.sessionId}/update`;
  } else if (action === 'end' && data?.sessionId) {
    endpoint = `/api/v1/reading-sessions/${data.sessionId}/end`;
  }

  const body: Record<string, unknown> = {
    book_id: bookId,
    action,
    ...data,
  };

  if (data?.currentPosition !== undefined) {
    body.current_position = Math.round(data.currentPosition);
  }
  if (data?.endPosition !== undefined) {
    body.end_position = Math.round(data.endPosition);
  }

  return syncQueue.addOperation({
    type: 'reading_session',
    endpoint,
    method: action === 'start' ? 'POST' : 'PUT',
    body,
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
