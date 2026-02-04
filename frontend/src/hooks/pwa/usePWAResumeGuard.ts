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
import { visibilityManager } from '@/services/visibilityManager';
import { logger } from '@/lib/logger';

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
 * Detect device type based on user agent.
 * Same implementation as useRenditionHealthGuard for consistency.
 */
function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Check if PWA resume guard should be enabled.
 * Guard is only active on:
 * - Mobile/tablet devices (where JS heap unload happens)
 * - PWA standalone mode (installed apps)
 *
 * On desktop browsers, tab switching doesn't unload JS heap,
 * so guard is unnecessary and causes unwanted unmounts.
 */
function shouldEnableGuard(): boolean {
  // Check standalone PWA mode (most reliable indicator)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  
  // Check mobile/tablet using same function as useRenditionHealthGuard
  const deviceType = detectDeviceType();
  const isMobileOrTablet = deviceType === 'mobile' || deviceType === 'tablet';
  
  // Guard активен если PWA ИЛИ мобильное устройство
  return isPWA || isMobileOrTablet;
}

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
  const lastHiddenTimeRef = useRef<number>(0);
  const resumeTimestampRef = useRef<number>(0);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Handle application going to background
   */
  const handleHidden = useCallback(() => {
    // Record when app was hidden
    lastHiddenTimeRef.current = Date.now();

    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] App hidden at:', new Date().toISOString());
    }
  }, []);

  /**
   * Handle application resuming from background
   */
  const handleVisible = useCallback(async () => {
    // Document became visible
    const now = Date.now();
    const idleTime = now - lastHiddenTimeRef.current;

    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] App resumed after', idleTime, 'ms idle');
    }

    // Only trigger guard if app was idle for significant time
    if (idleTime < MIN_IDLE_TIME_FOR_GUARD) {
      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Short idle time, skipping guard');
      }
      return;
    }

    // Skip guard on desktop browsers where JS heap is never unloaded
    if (!shouldEnableGuard()) {
      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Desktop browser detected, skipping guard');
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
      logger.debug('[PWAResumeGuard] Starting resume guard, disabled focusManager, waiting', RESUME_GRACE_PERIOD, 'ms');
    }

    // Clear any existing timeout
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }

    // Wait for grace period to allow Zustand rehydration
    resumeTimeoutRef.current = setTimeout(async () => {
      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Grace period complete, checking auth state');
      }

      // Check if user is available after grace period
      const currentUser = useAuthStore.getState().user;
      const currentIsLoading = useAuthStore.getState().isLoading;

      if (!currentUser && !currentIsLoading) {
        if (import.meta.env.DEV) {
          logger.debug('[PWAResumeGuard] No user found, triggering loadUserFromStorage');
        }

        // Attempt to reload user from storage
        try {
          await loadUserFromStorage();
        } catch (error) {
          if (import.meta.env.DEV) {
            logger.error('[PWAResumeGuard] Failed to load user from storage:', error);
          }
        }
      }

      if (import.meta.env.DEV) {
        const finalUser = useAuthStore.getState().user;
        logger.debug('[PWAResumeGuard] Resume complete, user:', finalUser?.email || 'none');
      }

      // Re-enable focusManager - this will trigger refetches now that auth is ready
      focusManager.setFocused(true);

      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Re-enabled focusManager, refetches will proceed');
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
   * Set up visibility manager registration
   */
  useEffect(() => {
    // Register with centralized visibility manager
    visibilityManager.register({
      id: 'pwa-resume-guard',
      priority: 1, // High priority (after reload guard)
      delay: 0, // No extra delay, logic handles checks
      onHidden: handleHidden,
      onVisible: handleVisible,
      shouldRun: () => true, // Check happens inside handleVisible
    });

    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] Initialized with visibilityManager');
    }

    return () => {
      visibilityManager.unregister('pwa-resume-guard');

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
        logger.debug('[PWAResumeGuard] Cleanup complete');
      }
    };
  }, [handleHidden, handleVisible]);

  // Calculate isReady: not resuming, not loading, and has user (or is intentionally unauthenticated)
  const isReady = !isResuming && !isLoading;

  return {
    isResuming,
    isReady,
    timeSinceResume,
  };
}
