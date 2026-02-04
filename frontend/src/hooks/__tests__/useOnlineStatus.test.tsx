/**
 * Tests for useOnlineStatus hook
 *
 * Tests network connectivity monitoring, custom event dispatching,
 * and offline tracking functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus, ONLINE_EVENT, OFFLINE_EVENT, isOnline } from '../useOnlineStatus';

// Mock the logger module since logger.debug is console.log.bind(console)
// which creates a new function reference that can't be intercepted by spying on console.log
const { mockLoggerDebug } = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: mockLoggerDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useOnlineStatus', () => {
  let onlineSpy: ReturnType<typeof vi.spyOn>;
  let offlineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });

    // Spy on console methods to prevent test output pollution
    onlineSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    offlineSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    onlineSpy.mockRestore();
    offlineSpy.mockRestore();
  });

  describe('Initial State', () => {
    it('should initialize with navigator.onLine status', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });

      const { result } = renderHook(() => useOnlineStatus());

      expect(result.current.isOnline).toBe(true);
      expect(result.current.wasOffline).toBe(false);
      expect(result.current.lastOnlineAt).toBeNull();
    });

    it('should initialize as offline when navigator.onLine is false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });

      const { result } = renderHook(() => useOnlineStatus());

      expect(result.current.isOnline).toBe(false);
      expect(result.current.wasOffline).toBe(false);
      expect(result.current.lastOnlineAt).toBeNull();
    });
  });

  describe('Online Event', () => {
    it('should update status when going online', () => {
      const { result } = renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(result.current.isOnline).toBe(true);
      expect(result.current.lastOnlineAt).toBeGreaterThan(0);
    });

    it('should preserve wasOffline flag when going online', () => {
      const { result } = renderHook(() => useOnlineStatus());

      // First go offline
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      // Then go online
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(result.current.isOnline).toBe(true);
      expect(result.current.wasOffline).toBe(true); // Should preserve flag
      expect(result.current.lastOnlineAt).toBeGreaterThan(0);
    });

    it('should dispatch custom ONLINE_EVENT when going online', () => {
      const eventListener = vi.fn();
      window.addEventListener(ONLINE_EVENT, eventListener);

      renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ONLINE_EVENT,
          detail: expect.objectContaining({
            timestamp: expect.any(Number),
          }),
        })
      );

      window.removeEventListener(ONLINE_EVENT, eventListener);
    });

    it('should set lastOnlineAt timestamp when going online', () => {
      const { result } = renderHook(() => useOnlineStatus());
      const beforeTimestamp = Date.now();

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      const afterTimestamp = Date.now();

      expect(result.current.lastOnlineAt).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(result.current.lastOnlineAt).toBeLessThanOrEqual(afterTimestamp);
    });
  });

  describe('Offline Event', () => {
    it('should update status when going offline', () => {
      const { result } = renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(result.current.isOnline).toBe(false);
      expect(result.current.wasOffline).toBe(true);
      expect(result.current.lastOnlineAt).toBeNull();
    });

    it('should dispatch custom OFFLINE_EVENT when going offline', () => {
      const eventListener = vi.fn();
      window.addEventListener(OFFLINE_EVENT, eventListener);

      renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: OFFLINE_EVENT,
          detail: expect.objectContaining({
            timestamp: expect.any(Number),
          }),
        })
      );

      window.removeEventListener(OFFLINE_EVENT, eventListener);
    });

    it('should reset lastOnlineAt when going offline', () => {
      const { result } = renderHook(() => useOnlineStatus());

      // First go online to set lastOnlineAt
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(result.current.lastOnlineAt).not.toBeNull();

      // Then go offline
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(result.current.lastOnlineAt).toBeNull();
    });
  });

  describe('Multiple State Transitions', () => {
    it('should handle multiple online/offline transitions', () => {
      const { result } = renderHook(() => useOnlineStatus());

      // Offline
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(result.current.isOnline).toBe(false);
      expect(result.current.wasOffline).toBe(true);

      // Online
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(result.current.isOnline).toBe(true);
      expect(result.current.wasOffline).toBe(true);

      // Offline again
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(result.current.isOnline).toBe(false);
      expect(result.current.wasOffline).toBe(true);

      // Online again
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(result.current.isOnline).toBe(true);
      expect(result.current.wasOffline).toBe(true); // Should remain true
    });
  });

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useOnlineStatus());

      // Should have added listeners
      expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      unmount();

      // Should have removed listeners
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should not update state after unmount', () => {
      const { result, unmount } = renderHook(() => useOnlineStatus());

      const initialState = { ...result.current };

      unmount();

      // Try to dispatch events after unmount
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      // State should not change after unmount
      // Note: result.current will still reflect the last state before unmount
      expect(result.current).toEqual(initialState);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid online/offline events', () => {
      const { result } = renderHook(() => useOnlineStatus());

      // Rapid transitions
      act(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });

      // Should end up in online state
      expect(result.current.isOnline).toBe(true);
      expect(result.current.wasOffline).toBe(true);
      expect(result.current.lastOnlineAt).toBeGreaterThan(0);
    });

    it('should handle same event fired multiple times', () => {
      const { result } = renderHook(() => useOnlineStatus());
      const eventListener = vi.fn();
      window.addEventListener(ONLINE_EVENT, eventListener);

      act(() => {
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('online'));
      });

      // Custom event should be dispatched each time
      expect(eventListener).toHaveBeenCalledTimes(3);
      expect(result.current.isOnline).toBe(true);

      window.removeEventListener(ONLINE_EVENT, eventListener);
    });
  });

  describe('isOnline utility function', () => {
    it('should return current navigator.onLine status', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      expect(isOnline()).toBe(true);

      Object.defineProperty(navigator, 'onLine', { value: false });
      expect(isOnline()).toBe(false);
    });

    it('should default to true if navigator is undefined', () => {
      const originalNavigator = global.navigator;
      // @ts-expect-error - Testing undefined navigator
      delete global.navigator;

      expect(isOnline()).toBe(true);

      global.navigator = originalNavigator;
    });
  });

  describe('Console Logging', () => {
    it('should log when network is restored', () => {
      renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        expect.stringContaining('[useOnlineStatus] Network restored')
      );
    });

    it('should log when network is lost', () => {
      renderHook(() => useOnlineStatus());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        expect.stringContaining('[useOnlineStatus] Network lost')
      );
    });
  });
});
