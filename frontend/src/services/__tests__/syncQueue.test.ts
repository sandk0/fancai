import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/stores/ui', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createWhereChain(data: unknown[] = []) {
  return {
    equals: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
      count: vi.fn().mockResolvedValue(data.length),
      delete: vi.fn().mockResolvedValue(data.length),
      modify: vi.fn().mockResolvedValue(data.length),
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(data),
        delete: vi.fn().mockResolvedValue(data.length),
      }),
    }),
  };
}

vi.mock('../db', () => {
  const syncQueueTable = {
    add: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    where: vi.fn().mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn().mockResolvedValue(0),
        modify: vi.fn().mockResolvedValue(0),
        filter: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockResolvedValue(0),
        }),
      }),
    }),
    orderBy: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    }),
    clear: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(1),
    toArray: vi.fn().mockResolvedValue([]),
  };

  const pendingSyncRequestsTable = {
    add: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    toArray: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(1),
    update: vi.fn().mockResolvedValue(1),
    orderBy: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null) }),
  };

  return {
    db: {
      syncQueue: syncQueueTable,
      pendingSyncRequests: pendingSyncRequestsTable,
    },
    MAX_SYNC_RETRIES: 5,
  };
});

import { syncQueue, retryPendingSync, queueProgressUpdate, queueReadingSession, queueImageGeneration } from '../syncQueue';
import { db } from '../db';

describe('SyncQueue', () => {
  let originalOnLine: boolean;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    vi.mocked(db.syncQueue.where).mockReturnValue(createWhereChain([]) as unknown as ReturnType<typeof db.syncQueue.where>);
    vi.mocked(db.syncQueue.count).mockResolvedValue(0);
    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  describe('addOperation', () => {
    it('should add operation to IndexedDB queue', async () => {
      await syncQueue.addOperation({
        type: 'progress',
        endpoint: '/api/v1/books/book-1/progress',
        method: 'PUT',
        body: { chapter: 5 },
        userId: 'user-1',
        bookId: 'book-1',
        priority: 'critical',
      });

      expect(db.syncQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'progress',
          endpoint: '/api/v1/books/book-1/progress',
          method: 'PUT',
          userId: 'user-1',
          bookId: 'book-1',
          priority: 'critical',
          status: 'pending',
          retries: 0,
        })
      );
    });

    it('should deduplicate progress operations for same book', async () => {
      await syncQueue.addOperation({
        type: 'progress',
        endpoint: '/api/v1/books/book-1/progress',
        method: 'PUT',
        body: { chapter: 10 },
        userId: 'user-1',
        bookId: 'book-1',
      });

      expect(db.syncQueue.where).toHaveBeenCalled();
    });

    it('should drop oldest when queue is full', async () => {
      vi.mocked(db.syncQueue.count).mockResolvedValue(50);
      const oldestOp = { id: 'old-1', type: 'progress', endpoint: '/old' };
      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        first: vi.fn().mockResolvedValue(oldestOp),
      } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

      await syncQueue.addOperation({
        type: 'bookmark',
        endpoint: '/api/v1/books/book-1/bookmarks',
        method: 'POST',
        userId: 'user-1',
      });

      expect(db.syncQueue.delete).toHaveBeenCalledWith('old-1');
    });

    it('should process queue immediately when online', async () => {
      const processQueueSpy = vi.spyOn(syncQueue, 'processQueue');

      await syncQueue.addOperation({
        type: 'bookmark',
        endpoint: '/api/v1/books/book-1/bookmarks',
        method: 'POST',
        userId: 'user-1',
      });

      expect(processQueueSpy).toHaveBeenCalled();
      processQueueSpy.mockRestore();
    });

    it('should assign default priority of normal', async () => {
      await syncQueue.addOperation({
        type: 'bookmark',
        endpoint: '/api/v1/books/book-1/bookmarks',
        method: 'POST',
        userId: 'user-1',
      });

      expect(db.syncQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'normal' })
      );
    });
  });

  describe('processQueue', () => {
    it('should skip processing when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      await syncQueue.processQueue();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should skip when no pending operations', async () => {
      vi.mocked(db.syncQueue.where).mockReturnValue(createWhereChain([]) as unknown as ReturnType<typeof db.syncQueue.where>);

      await syncQueue.processQueue();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should process pending operations and delete on success', async () => {
      const pendingOp = {
        id: 'op-1',
        type: 'progress' as const,
        endpoint: '/api/v1/books/book-1/progress',
        method: 'PUT' as const,
        body: { chapter: 5 },
        userId: 'user-1',
        bookId: 'book-1',
        priority: 'normal' as const,
        createdAt: Date.now(),
        retries: 0,
        maxRetries: 5,
        status: 'pending' as const,
      };

      vi.mocked(db.syncQueue.where).mockReturnValue(
        createWhereChain([pendingOp]) as unknown as ReturnType<typeof db.syncQueue.where>
      );

      fetchSpy.mockResolvedValue({ ok: true, status: 200 });

      await syncQueue.processQueue();

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/books/book-1/progress',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ chapter: 5 }),
        })
      );
      expect(db.syncQueue.delete).toHaveBeenCalledWith('op-1');
    });

    it('should increment retries on failure', async () => {
      const pendingOp = {
        id: 'op-1',
        type: 'progress' as const,
        endpoint: '/api/v1/books/book-1/progress',
        method: 'PUT' as const,
        body: { chapter: 5 },
        userId: 'user-1',
        priority: 'normal' as const,
        createdAt: Date.now(),
        retries: 0,
        maxRetries: 5,
        status: 'pending' as const,
      };

      vi.mocked(db.syncQueue.where).mockReturnValue(
        createWhereChain([pendingOp]) as unknown as ReturnType<typeof db.syncQueue.where>
      );

      fetchSpy.mockResolvedValue({ ok: false, status: 500 });

      await syncQueue.processQueue();

      expect(db.syncQueue.update).toHaveBeenCalledWith('op-1', {
        status: 'pending',
        lastError: 'HTTP 500',
        retries: 1,
      });
    });

    it('should mark as failed when max retries exceeded', async () => {
      const pendingOp = {
        id: 'op-1',
        type: 'progress' as const,
        endpoint: '/api/v1/books/book-1/progress',
        method: 'PUT' as const,
        userId: 'user-1',
        priority: 'normal' as const,
        createdAt: Date.now(),
        retries: 4,
        maxRetries: 5,
        status: 'pending' as const,
      };

      vi.mocked(db.syncQueue.where).mockReturnValue(
        createWhereChain([pendingOp]) as unknown as ReturnType<typeof db.syncQueue.where>
      );

      fetchSpy.mockResolvedValue({ ok: false, status: 500 });

      await syncQueue.processQueue();

      expect(db.syncQueue.update).toHaveBeenCalledWith('op-1', {
        status: 'failed',
        lastError: 'HTTP 500',
        retries: 5,
      });
    });

    it('should prevent concurrent processing', async () => {
      const pendingOp = {
        id: 'op-1',
        type: 'progress' as const,
        endpoint: '/api/v1/test',
        method: 'PUT' as const,
        userId: 'user-1',
        priority: 'normal' as const,
        createdAt: Date.now(),
        retries: 0,
        maxRetries: 5,
        status: 'pending' as const,
      };

      vi.mocked(db.syncQueue.where).mockReturnValue(
        createWhereChain([pendingOp]) as unknown as ReturnType<typeof db.syncQueue.where>
      );

      fetchSpy.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
      );

      const p1 = syncQueue.processQueue();
      const p2 = syncQueue.processQueue();

      await Promise.all([p1, p2]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners on queue changes', async () => {
      const listener = vi.fn();
      const unsubscribe = syncQueue.subscribe(listener);

      await syncQueue.addOperation({
        type: 'bookmark',
        endpoint: '/api/v1/test',
        method: 'POST',
        userId: 'user-1',
      });

      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it('should stop notifying after unsubscribe', async () => {
      const listener = vi.fn();
      const unsubscribe = syncQueue.subscribe(listener);
      unsubscribe();

      await syncQueue.addOperation({
        type: 'bookmark',
        endpoint: '/api/v1/test',
        method: 'POST',
        userId: 'user-1',
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clearQueue', () => {
    it('should clear all operations and localStorage', async () => {
      localStorage.setItem('syncQueue_critical', JSON.stringify([{ endpoint: '/test' }]));

      await syncQueue.clearQueue();

      expect(db.syncQueue.clear).toHaveBeenCalled();
      expect(localStorage.getItem('syncQueue_critical')).toBeFalsy();
    });
  });

  describe('retryFailed', () => {
    it('should reset failed operations to pending', async () => {
      const modifyFn = vi.fn().mockResolvedValue(2);
      vi.mocked(db.syncQueue.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          modify: modifyFn,
          toArray: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
          delete: vi.fn().mockResolvedValue(0),
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            delete: vi.fn().mockResolvedValue(0),
          }),
        }),
      } as unknown as ReturnType<typeof db.syncQueue.where>);

      await syncQueue.retryFailed();

      expect(modifyFn).toHaveBeenCalledWith({
        status: 'pending',
        retries: 0,
      });
    });
  });

  describe('removeOperation', () => {
    it('should remove operation by id', async () => {
      vi.mocked(db.syncQueue.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn().mockResolvedValue(1),
        }),
      } as unknown as ReturnType<typeof db.syncQueue.where>);

      const removed = await syncQueue.removeOperation('op-1');
      expect(removed).toBe(true);
    });

    it('should return false when operation not found', async () => {
      vi.mocked(db.syncQueue.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn().mockResolvedValue(0),
        }),
      } as unknown as ReturnType<typeof db.syncQueue.where>);

      const removed = await syncQueue.removeOperation('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('retryPendingSync', () => {
    it('should retry persisted requests', async () => {
      const requests = [
        { id: 'req-1', url: '/api/v1/test', method: 'POST', body: '{}', timestamp: Date.now(), retryCount: 0 },
      ];
      vi.mocked(db.pendingSyncRequests.toArray).mockResolvedValue(requests);
      fetchSpy.mockResolvedValue({ ok: true, status: 200 });

      await retryPendingSync();

      expect(fetchSpy).toHaveBeenCalledWith('/api/v1/test', expect.objectContaining({ method: 'POST' }));
      expect(db.pendingSyncRequests.delete).toHaveBeenCalledWith('req-1');
    });

    it('should drop requests exceeding max retry count', async () => {
      const requests = [
        { id: 'req-1', url: '/api/v1/test', method: 'POST', body: '{}', timestamp: Date.now(), retryCount: 3 },
      ];
      vi.mocked(db.pendingSyncRequests.toArray).mockResolvedValue(requests);
      fetchSpy.mockResolvedValue({ ok: false, status: 500 });

      await retryPendingSync();

      expect(db.pendingSyncRequests.delete).toHaveBeenCalledWith('req-1');
    });

    it('should do nothing when no pending requests', async () => {
      vi.mocked(db.pendingSyncRequests.toArray).mockResolvedValue([]);

      await retryPendingSync();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Convenience functions', () => {
    it('queueProgressUpdate should add critical progress operation', async () => {
      await queueProgressUpdate('user-1', 'book-1', {
        chapter: 5,
        cfi: 'epubcfi(/6/4)',
        scrollPercent: 50,
      });

      expect(db.syncQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'progress',
          endpoint: '/api/v1/books/book-1/progress',
          method: 'PUT',
          priority: 'critical',
        })
      );
    });

    it('queueReadingSession should add session operation', async () => {
      await queueReadingSession('user-1', 'book-1', 'start');

      expect(db.syncQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'reading_session',
          endpoint: '/api/v1/reading-sessions/start',
          method: 'POST',
          priority: 'critical',
        })
      );
    });

    it('queueImageGeneration should add low-priority image operation', async () => {
      await queueImageGeneration('user-1', 'book-1', 'desc-1');

      expect(db.syncQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'image_generation',
          endpoint: '/api/v1/images/generate/desc-1',
          method: 'POST',
          priority: 'low',
        })
      );
    });
  });
});
