/**
 * usePWAResumeGuard - Handle PWA resume from background state (January 2026)
 *
 * This hook addresses a race condition that occurs when PWA resumes from background:
 * - Zustand rehydration has ~100ms delay (configured in auth store)
 * - TanStack Query refetches immediately on visibility change
 * - This can cause crashes when queries fire before auth state is ready
 *
 * Solution: Use TanStack Query's focusManager to temporarily disable focus events
 * during the grace period, preventing premature refetches.
 *
 * @module hooks/pwa/usePWAResumeGuard
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { focusManager } from '@/lib/queryClient';

/**
 * Return type for usePWAResumeGuard hook
 */
export interface PWAResumeGuardReturn {
  /** Whether the app is currently resuming from background */
  isResuming: boolean;
  /** Whether the app is ready for rendering (not resuming and user loaded) */
  isReady: boolean;
  /** Time in milliseconds since the last resume event */
  timeSinceResume: number;
}

/** Grace period in milliseconds to wait for Zustand rehydration after visibility change */
const RESUME_GRACE_PERIOD = 300;

/**
 * Minimum idle time (ms) that triggers resume guard behavior.
 *
 * IMPORTANT: This was reduced from 5000ms to 1500ms to fix the PWA resume crash.
 * The issue occurred when users opened a book and quickly minimized (< 5s),
 * causing the guard to be skipped during the critical initialization phase.
 *
 * With 1500ms, even brief suspends during book opening are now protected.
 */
const MIN_IDLE_TIME_FOR_GUARD = 1500;

/**
 * Hook to guard against race conditions during PWA resume from background.
 *
 * When the app becomes visible after being in background:
 * 1. Temporarily disables TanStack Query focusManager to prevent premature refetches
 * 2. Waits for RESUME_GRACE_PERIOD (200ms) to allow Zustand to rehydrate
 * 3. Ensures user is available in auth store (calls loadUserFromStorage if needed)
 * 4. Re-enables focusManager and sets isResuming to false
 *
 * @returns {PWAResumeGuardReturn} Object containing isResuming, isReady, and timeSinceResume
 *
 * @example
 * ```tsx
 * const { isResuming, isReady } = usePWAResumeGuard();
 *
 * if (isResuming) {
 *   return <LoadingSpinner />;
 * }
 *
 * if (!isReady) {
 *   return <LoadingSpinner />;
 * }
 *
 * return <MainContent />;
 * ```
 */
export function usePWAResumeGuard(): PWAResumeGuardReturn {
  const [isResuming, setIsResuming] = useState(false);
  const [timeSinceResume, setTimeSinceResume] = useState(0);

  // Subscribe to isLoading for reactive updates to isReady
  const isLoading = useAuthStore((state) => state.isLoading);
  const loadUserFromStorage = useAuthStore((state) => state.loadUserFromStorage);

  // Track when the app was last hidden (for calculating idle time)
  const lastHiddenTimeRef = useRef<number>(Date.now());
  const resumeTimestampRef = useRef<number>(0);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Handle visibility change event.
   * When document becomes visible after being hidden, initiate resume guard.
   */
  const handleVisibilityChange = useCallback(async () => {
    if (document.visibilityState === 'hidden') {
      // Record when app was hidden
      lastHiddenTimeRef.current = Date.now();

      if (import.meta.env.DEV) {
        console.log('[PWAResumeGuard] App hidden at:', new Date().toISOString());
      }

      return;
    }

    // Document became visible
    const now = Date.now();
    const idleTime = now - lastHiddenTimeRef.current;

    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] App resumed after', idleTime, 'ms idle');
    }

    // Only trigger guard if app was idle for significant time
    if (idleTime < MIN_IDLE_TIME_FOR_GUARD) {
      if (import.meta.env.DEV) {
        console.log('[PWAResumeGuard] Short idle time, skipping guard');
      }
      return;
    }

    // Start resume process
    setIsResuming(true);
    resumeTimestampRef.current = now;
    setTimeSinceResume(0);

    // Disable focusManager to prevent premature TanStack Query refetches
    focusManager.setFocused(false);

    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] Starting resume guard, disabled focusManager, waiting', RESUME_GRACE_PERIOD, 'ms');
    }

    // Clear any existing timeout
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }

    // Wait for grace period to allow Zustand rehydration
    resumeTimeoutRef.current = setTimeout(async () => {
      if (import.meta.env.DEV) {
        console.log('[PWAResumeGuard] Grace period complete, checking auth state');
      }

      // Check if user is available after grace period
      const currentUser = useAuthStore.getState().user;
      const currentIsLoading = useAuthStore.getState().isLoading;

      if (!currentUser && !currentIsLoading) {
        if (import.meta.env.DEV) {
          console.log('[PWAResumeGuard] No user found, triggering loadUserFromStorage');
        }

        // Attempt to reload user from storage
        try {
          await loadUserFromStorage();
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('[PWAResumeGuard] Failed to load user from storage:', error);
          }
        }
      }

      if (import.meta.env.DEV) {
        const finalUser = useAuthStore.getState().user;
        console.log('[PWAResumeGuard] Resume complete, user:', finalUser?.email || 'none');
      }

      // Re-enable focusManager - this will trigger refetches now that auth is ready
      focusManager.setFocused(true);

      if (import.meta.env.DEV) {
        console.log('[PWAResumeGuard] Re-enabled focusManager, refetches will proceed');
      }

      setIsResuming(false);
    }, RESUME_GRACE_PERIOD);

    // Start interval to update timeSinceResume
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
    }

    updateIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - resumeTimestampRef.current;
      setTimeSinceResume(elapsed);

      // Stop updating after 5 seconds (cleanup)
      if (elapsed > 5000) {
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
          updateIntervalRef.current = null;
        }
      }
    }, 100);
  }, [loadUserFromStorage]);

  /**
   * Set up visibility change listener
   */
  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] Initialized with focusManager integration');
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // Clean up timers
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }

      // Ensure focusManager is re-enabled on cleanup
      focusManager.setFocused(true);

      if (import.meta.env.DEV) {
        console.log('[PWAResumeGuard] Cleanup complete');
      }
    };
  }, [handleVisibilityChange]);

  // Calculate isReady: not resuming, not loading, and has user (or is intentionally unauthenticated)
  const isReady = !isResuming && !isLoading;

  return {
    isResuming,
    isReady,
    timeSinceResume,
  };
}
