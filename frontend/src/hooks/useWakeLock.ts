/**
 * useWakeLock - Prevents screen from turning off while reading
 *
 * Uses the Screen Wake Lock API to keep the display on.
 * Automatically releases when component unmounts or page becomes hidden.
 * Re-acquires wake lock when page becomes visible again (if previously active).
 *
 * Browser Support:
 * - Chrome 84+, Edge 84+, Opera 70+, Chrome Android 84+
 * - Safari 16.4+ (iOS 16.4+)
 * - Not supported in Firefox
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 * @module hooks/useWakeLock
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/lib/logger';
import { useVisibilityManager } from '@/hooks/shared/useVisibilityManager';

interface UseWakeLockReturn {
  /** Whether wake lock is currently active */
  isActive: boolean;
  /** Whether wake lock is supported by the browser */
  isSupported: boolean;
  /** Request wake lock - keeps screen on */
  request: () => Promise<void>;
  /** Release wake lock - allows screen to turn off */
  release: () => Promise<void>;
  /** Error if wake lock request failed */
  error: Error | null;
}

/**
 * Hook to prevent screen from turning off while reading
 *
 * @example
 * ```tsx
 * function ReaderComponent() {
 *   const { isActive, isSupported, request, release, error } = useWakeLock();
 *
 *   useEffect(() => {
 *     // Request wake lock when reader opens
 *     request();
 *     // Release when reader closes
 *     return () => { release(); };
 *   }, [request, release]);
 *
 *   if (!isSupported) {
 *     return <p>Wake lock not supported</p>;
 *   }
 *
 *   return (
 *     <div>
 *       <p>Screen will {isActive ? 'stay on' : 'turn off normally'}</p>
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWakeLock(): UseWakeLockReturn {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Track if user explicitly requested wake lock (for re-acquisition on visibility change)
  const wasRequestedRef = useRef(false);

  // Check if Wake Lock API is supported
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  /**
   * Request a screen wake lock
   * Keeps the screen on until released or page becomes hidden
   */
  const request = useCallback(async () => {
    if (!isSupported) {
      logger.debug('[useWakeLock] Wake Lock API not supported');
      return;
    }

    // Already have an active wake lock
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      logger.debug('[useWakeLock] Wake Lock already active');
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wasRequestedRef.current = true;
      setIsActive(true);
      setError(null);

      logger.debug('[useWakeLock] Wake Lock acquired successfully');

      // Listen for release events (e.g., when tab becomes hidden, low battery)
      wakeLockRef.current.addEventListener('release', () => {
        setIsActive(false);
        logger.debug('[useWakeLock] Wake Lock released by system');
      });
    } catch (err) {
      const wakeLockError = err instanceof Error ? err : new Error(String(err));
      setError(wakeLockError);
      setIsActive(false);

      // Common errors:
      // - NotAllowedError: Document is not fully active or visible
      // - AbortError: Wake lock request was interrupted
      logger.debug('[useWakeLock] Failed to acquire wake lock:', wakeLockError.message);
    }
  }, [isSupported]);

  /**
   * Release the screen wake lock
   * Allows the screen to turn off normally
   */
  const release = useCallback(async () => {
    wasRequestedRef.current = false;

    if (!wakeLockRef.current) {
      logger.debug('[useWakeLock] No wake lock to release');
      return;
    }

    try {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsActive(false);
      logger.debug('[useWakeLock] Wake Lock manually released');
    } catch (err) {
      logger.debug('[useWakeLock] Failed to release wake lock:', err);
    }
  }, []);

  useVisibilityManager({
    id: 'wake-lock',
    priority: 30,
    delay: 0,
    enabled: isSupported,
    onHidden: () => {},
    onVisible: async () => {
      if (wasRequestedRef.current && (!wakeLockRef.current || wakeLockRef.current.released)) {
        logger.debug('[useWakeLock] Page visible, re-acquiring wake lock');
        await request();
      }
    },
    shouldRun: () => isSupported,
  });

  /**
   * Cleanup on unmount - release wake lock
   */
  useEffect(() => {
    return () => {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        wakeLockRef.current.release().catch(() => {
          // Ignore errors during cleanup
        });
        wakeLockRef.current = null;
      }
      wasRequestedRef.current = false;
    };
  }, []);

  return {
    isActive,
    isSupported,
    request,
    release,
    error,
  };
}
