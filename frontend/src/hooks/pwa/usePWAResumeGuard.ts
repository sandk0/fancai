/**
 * usePWAResumeGuard - Handle PWA resume from background state
 *
 * Graduated resume strategy with 3 levels:
 *
 * Level 1 (Short, <30s): Pass-through. User returned quickly, no action needed.
 *   Fires before shouldEnableGuard() check — works on all devices.
 *
 * Level 2 (Medium, 30s-5min): Soft check. Verify auth state and call
 *   loadUserFromStorage() if needed. Does NOT block focusManager or set isResuming.
 *   TanStack Query handles refetches via its own focusManager event.
 *
 * Level 3 (Long, >5min): Full reinitialization. Temporarily disables focusManager,
 *   waits for grace period, reloads user from storage, then re-enables focusManager.
 *
 * This prevents race conditions when PWA resumes from background:
 * - Zustand rehydration has ~100ms delay
 * - TanStack Query refetches immediately on visibility change
 * - Without guard, queries fire before auth state is ready
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
 * Graduated resume thresholds:
 * - Short (<30s): pass-through, no action needed
 * - Medium (30s-5min): soft auth check without blocking
 * - Long (>5min): full reinitialization with focusManager blocking
 */
const THRESHOLD_SHORT = 30_000; // 30 seconds
const THRESHOLD_LONG = 300_000; // 5 minutes

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
  const isPWA =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  // Check mobile/tablet using same function as useRenditionHealthGuard
  const deviceType = detectDeviceType();
  const isMobileOrTablet = deviceType === 'mobile' || deviceType === 'tablet';

  // Guard активен если PWA ИЛИ мобильное устройство
  return isPWA || isMobileOrTablet;
}

/**
 * Hook to guard against race conditions during PWA resume from background.
 *
 * Graduated resume strategy with 3 levels:
 * 1. Short (<30s): pass-through, no action — user quickly returned
 * 2. Medium (30s-5min): soft auth check (loadUserFromStorage if needed), no blocking
 * 3. Long (>5min): full reinitialization — disable focusManager, grace period, reload auth
 *
 * Level 1 fires BEFORE shouldEnableGuard() to work on all devices.
 * Levels 2 and 3 are gated behind shouldEnableGuard() (mobile/tablet/PWA only).
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
   * Handle application resuming from background.
   *
   * Graduated strategy:
   * - Level 1 (<30s): pass-through, no action (fires before shouldEnableGuard)
   * - Level 2 (30s-5min): soft auth check without blocking focusManager
   * - Level 3 (>5min): full reinitialization with focusManager blocking
   */
  const handleVisible = useCallback(async () => {
    const now = Date.now();
    const idleTime = now - lastHiddenTimeRef.current;

    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] App resumed after', idleTime, 'ms idle');
    }

    // --- Level 1: Short resume (<30s) — pass-through ---
    // Fires BEFORE shouldEnableGuard() — works on all devices
    if (idleTime < THRESHOLD_SHORT) {
      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Level 1 (short): pass-through');
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

    // --- Level 2: Medium resume (30s-5min) — soft auth check ---
    if (idleTime < THRESHOLD_LONG) {
      if (import.meta.env.DEV) {
        logger.debug('[PWAResumeGuard] Level 2 (medium): soft auth check');
      }

      // Check auth state without blocking focusManager or setting isResuming
      const currentUser = useAuthStore.getState().user;
      if (!currentUser) {
        try {
          await loadUserFromStorage();
          if (import.meta.env.DEV) {
            logger.debug('[PWAResumeGuard] Level 2: reloaded user from storage');
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            logger.error('[PWAResumeGuard] Level 2: failed to load user:', error);
          }
        }
      }
      // TanStack Query will handle refetches via its own focusManager event
      return;
    }

    // --- Level 3: Long resume (>5min) — full reinitialization ---
    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] Level 3 (long): full reinitialization');
    }

    // Start resume process
    setIsResuming(true);
    resumeTimestampRef.current = now;
    setTimeSinceResume(0);

    // Disable focusManager to prevent premature TanStack Query refetches
    focusManager.setFocused(false);

    if (import.meta.env.DEV) {
      logger.debug('[PWAResumeGuard] Disabled focusManager, waiting', RESUME_GRACE_PERIOD, 'ms');
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
