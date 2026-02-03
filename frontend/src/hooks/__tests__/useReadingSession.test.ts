import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReadingSession } from '../useReadingSession';
import type { ReadingSession } from '@/types/api';

vi.mock('@/api/readingSessions', () => ({
  readingSessionsAPI: {
    getActiveSession: vi.fn(),
    startSession: vi.fn(),
    updateSession: vi.fn(),
    endSession: vi.fn(),
  },
}));

vi.mock('@/hooks/api/queryKeys', () => ({
  sessionKeys: {
    active: (userId: string) => ['sessions', userId, 'active'],
    detail: (userId: string, sessionId: string) => ['sessions', userId, sessionId],
  },
  getCurrentUserId: vi.fn().mockReturnValue('user-123'),
}));

vi.mock('@/services/visibilityManager', () => ({
  visibilityManager: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('@/lib/queryClient', () => ({
  QUERY_RETRY_PRESETS: {
    api: { retry: false },
    critical: { retry: false },
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

vi.mock('@/lib/i18n', () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { readingSessionsAPI } from '@/api/readingSessions';

const mockSession: ReadingSession = {
  id: 'session-1',
  book_id: 'book-1',
  user_id: 'user-123',
  started_at: new Date().toISOString(),
  duration_minutes: 0,
  start_position: 10,
  end_position: 10,
  pages_read: 0,
  device_type: 'desktop',
  is_active: true,
};

const mockEndedSession: ReadingSession = {
  ...mockSession,
  ended_at: new Date().toISOString(),
  duration_minutes: 15,
  end_position: 50,
  pages_read: 10,
  is_active: false,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useReadingSession', () => {
  let sendBeaconSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendBeaconSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeaconSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session start', () => {
    it('should start a new session when no active session exists', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);
      vi.mocked(readingSessionsAPI.startSession).mockResolvedValue(mockSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      expect(readingSessionsAPI.startSession).toHaveBeenCalledWith(
        'book-1',
        10,
        undefined,
        undefined
      );
      expect(result.current.session?.id).toBe('session-1');
    });

    it('should continue existing active session for same book', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      expect(readingSessionsAPI.startSession).not.toHaveBeenCalled();
      expect(result.current.session?.id).toBe('session-1');
    });

    it('should not start session when disabled', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);

      renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: false,
          }),
        { wrapper: createWrapper() }
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(readingSessionsAPI.startSession).not.toHaveBeenCalled();
    });

    it('should call onSessionStart callback', async () => {
      const onSessionStart = vi.fn();
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);
      vi.mocked(readingSessionsAPI.startSession).mockResolvedValue(mockSession);

      renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
            onSessionStart,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(onSessionStart).toHaveBeenCalledWith(mockSession);
      });
    });
  });

  describe('Session conflict (409)', () => {
    it('should show warning notification on 409 conflict', async () => {
      const { notify } = await import('@/stores/ui');
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);
      vi.mocked(readingSessionsAPI.startSession).mockRejectedValue({
        response: {
          status: 409,
          data: {
            detail: {
              started_at: new Date().toISOString(),
              message: 'Session already active',
            },
          },
        },
      });

      renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(notify.warning).toHaveBeenCalled();
      });
    });
  });

  describe('Position updates', () => {
    it('should expose updatePosition function', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      expect(typeof result.current.updatePosition).toBe('function');
    });
  });

  describe('End session', () => {
    it('should end session and call API', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);
      vi.mocked(readingSessionsAPI.endSession).mockResolvedValue(mockEndedSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 50,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      await act(async () => {
        await result.current.endSession();
      });

      expect(readingSessionsAPI.endSession).toHaveBeenCalledWith(
        'session-1',
        50
      );
    });

    it('should call onSessionEnd callback', async () => {
      const onSessionEnd = vi.fn();
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);
      vi.mocked(readingSessionsAPI.endSession).mockResolvedValue(mockEndedSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 50,
            enabled: true,
            onSessionEnd,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      await act(async () => {
        await result.current.endSession();
      });

      expect(onSessionEnd).toHaveBeenCalledWith(mockEndedSession);
    });

    it('should not end session if no active session', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: false,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.endSession();
      });

      expect(readingSessionsAPI.endSession).not.toHaveBeenCalled();
    });
  });

  describe('Loading and error states', () => {
    it('should report loading state initially', () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('should report errors from start mutation', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(null as unknown as ReadingSession);
      vi.mocked(readingSessionsAPI.startSession).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });
    });
  });

  describe('Cleanup on unmount', () => {
    it('should attempt to end session on unmount via endSession API or beacon', async () => {
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);
      vi.mocked(readingSessionsAPI.endSession).mockResolvedValue(mockEndedSession);

      const { result, unmount } = renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 50,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.session).not.toBeNull();
      });

      unmount();

      await waitFor(() => {
        const endSessionCalled = vi.mocked(readingSessionsAPI.endSession).mock.calls.length > 0;
        const beaconCalled = sendBeaconSpy.mock.calls.length > 0;
        expect(endSessionCalled || beaconCalled).toBe(true);
      });
    });
  });

  describe('beforeunload handler', () => {
    it('should register beforeunload handler when enabled', async () => {
      const addEventSpy = vi.spyOn(window, 'addEventListener');
      vi.mocked(readingSessionsAPI.getActiveSession).mockResolvedValue(mockSession);

      renderHook(
        () =>
          useReadingSession({
            bookId: 'book-1',
            currentPosition: 10,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(addEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      });

      addEventSpy.mockRestore();
    });
  });
});
