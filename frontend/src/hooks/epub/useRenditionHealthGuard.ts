/**
 * useRenditionHealthGuard - Proactive health check for epub.js rendition during PWA lifecycle
 *
 * This hook solves the PWA resume crash issue where:
 * 1. User opens a book and minimizes the PWA
 * 2. JavaScript heap may be unloaded due to memory pressure (iOS/Android)
 * 3. When returning, epub.js rendition becomes corrupted
 * 4. React re-renders with stale/corrupted rendition causing crashes
 *
 * The solution:
 * 1. Track app visibility state
 * 2. On visibility change, immediately check rendition health BEFORE React re-renders
 * 3. If corrupted, set a flag to show loading state instead of crashing
 * 4. Trigger reload to reinitialize the reader
 * 5. On pagehide, save current position for recovery
 *
 * @module hooks/epub/useRenditionHealthGuard
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Rendition } from '@/types/epub';

/** Enable debug logging only in development */
const DEBUG = import.meta.env.DEV;

/**
 * Delay before running health check after visibility change.
 * Reduced from 500ms to 100ms for faster detection.
 */
const HEALTH_CHECK_DELAY = 100;

/**
 * How many consecutive health check failures before triggering reload.
 * Single failure might be transient, so we require 2.
 */
const FAILURE_THRESHOLD = 1;

export interface RenditionHealthGuardReturn {
  /** Whether the rendition is currently healthy and ready for use */
  isHealthy: boolean;
  /** Whether a health check is currently in progress */
  isChecking: boolean;
  /** Whether the app was just resumed from background */
  wasResumed: boolean;
  /** Force a health check manually */
  checkHealth: () => Promise<boolean>;
  /** Mark the rendition as healthy (call after successful render) */
  markHealthy: () => void;
  /** Last saved CFI position before background */
  lastSavedCfi: string | null;
}

export interface UseRenditionHealthGuardOptions {
  /** The epub.js rendition instance to monitor */
  rendition: Rendition | null;
  /** Book ID for position persistence */
  bookId: string;
  /** Callback when health check fails and reload is needed */
  onCorrupted?: () => void;
  /** Whether the guard is enabled (disable during initial load) */
  enabled?: boolean;
}

/**
 * Hook to guard rendition health during PWA lifecycle events.
 *
 * @example
 * ```tsx
 * const { isHealthy, isChecking, wasResumed } = useRenditionHealthGuard({
 *   rendition,
 *   bookId: book.id,
 *   onCorrupted: () => reload(),
 *   enabled: !!rendition,
 * });
 *
 * // Show loading if checking health or rendition is corrupted
 * if (isChecking || !isHealthy) {
 *   return <LoadingSpinner />;
 * }
 * ```
 */
export function useRenditionHealthGuard({
  rendition,
  bookId,
  onCorrupted,
  enabled = true,
}: UseRenditionHealthGuardOptions): RenditionHealthGuardReturn {
  const [isHealthy, setIsHealthy] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [wasResumed, setWasResumed] = useState(false);
  const [lastSavedCfi, setLastSavedCfi] = useState<string | null>(null);

  const failureCountRef = useRef(0);
  const lastVisibilityRef = useRef<'visible' | 'hidden'>(
    typeof document !== 'undefined' ? document.visibilityState : 'visible'
  );
  const renditionRef = useRef<Rendition | null>(null);
  const healthCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep rendition ref updated
  useEffect(() => {
    renditionRef.current = rendition;
  }, [rendition]);

  /**
   * Check if the rendition is healthy and can perform basic operations.
   * Returns true if healthy, false if corrupted.
   */
  const checkHealth = useCallback(async (): Promise<boolean> => {
    const currentRendition = renditionRef.current;

    if (!currentRendition) {
      // No rendition yet, consider it "healthy" (not corrupted)
      return true;
    }

    try {
      // Quick health check - try to get current location
      const loc = currentRendition.currentLocation();

      if (!loc) {
        throw new Error('Rendition returned null location');
      }

      // Verify location has expected properties
      if (!loc.start || !loc.end) {
        throw new Error('Rendition location is incomplete');
      }

      // Check if we can access the manager (epub.js internal)
      if (!currentRendition.manager) {
        throw new Error('Rendition manager is null');
      }

      // Reset failure count on success
      failureCountRef.current = 0;

      if (DEBUG) {
        console.log('[RenditionHealthGuard] Health check passed');
      }

      return true;
    } catch (e) {
      failureCountRef.current++;

      if (DEBUG) {
        console.error(
          `[RenditionHealthGuard] Health check failed (${failureCountRef.current}/${FAILURE_THRESHOLD}):`,
          e
        );
      }

      return false;
    }
  }, []);

  /**
   * Mark the rendition as healthy.
   * Call this after successful render to reset state.
   */
  const markHealthy = useCallback(() => {
    setIsHealthy(true);
    setWasResumed(false);
    failureCountRef.current = 0;
  }, []);

  /**
   * Save current position before going to background.
   * This helps recover after JS heap unload.
   */
  const savePositionBeforeHide = useCallback(() => {
    const currentRendition = renditionRef.current;
    if (!currentRendition || !bookId) return;

    try {
      const loc = currentRendition.currentLocation();
      const cfi = loc?.start?.cfi;

      if (cfi) {
        // Save to both state and localStorage for recovery
        setLastSavedCfi(cfi);
        localStorage.setItem(`book_${bookId}_resume_cfi`, cfi);

        if (DEBUG) {
          console.log('[RenditionHealthGuard] Saved position before hide:', cfi.slice(0, 50));
        }
      }
    } catch (e) {
      // Ignore errors - rendition might already be in bad state
      if (DEBUG) {
        console.error('[RenditionHealthGuard] Failed to save position:', e);
      }
    }
  }, [bookId]);

  /**
   * Handle visibility change events.
   * This is the core of the health guard.
   */
  const handleVisibilityChange = useCallback(() => {
    const newVisibility = document.visibilityState;
    const wasHidden = lastVisibilityRef.current === 'hidden';
    lastVisibilityRef.current = newVisibility;

    if (newVisibility === 'hidden') {
      // App is going to background - save position
      savePositionBeforeHide();
      return;
    }

    // App became visible after being hidden
    if (wasHidden && enabled) {
      setWasResumed(true);
      setIsChecking(true);

      if (DEBUG) {
        console.log('[RenditionHealthGuard] App resumed, starting health check...');
      }

      // Clear any pending health check
      if (healthCheckTimeoutRef.current) {
        clearTimeout(healthCheckTimeoutRef.current);
      }

      // Run health check with a small delay to let state stabilize
      healthCheckTimeoutRef.current = setTimeout(async () => {
        const isOk = await checkHealth();

        if (!isOk && failureCountRef.current >= FAILURE_THRESHOLD) {
          if (DEBUG) {
            console.error('[RenditionHealthGuard] Rendition corrupted, triggering reload');
          }

          setIsHealthy(false);
          setIsChecking(false);

          // Notify parent to handle reload
          onCorrupted?.();
        } else {
          setIsHealthy(true);
          setIsChecking(false);

          if (DEBUG) {
            console.log('[RenditionHealthGuard] Rendition is healthy after resume');
          }
        }
      }, HEALTH_CHECK_DELAY);
    }
  }, [enabled, savePositionBeforeHide, checkHealth, onCorrupted]);

  /**
   * Handle page hide event (before JS heap unload).
   * This is more reliable than visibilitychange on some platforms.
   */
  const handlePageHide = useCallback(() => {
    savePositionBeforeHide();
  }, [savePositionBeforeHide]);

  /**
   * Handle page show event (after potential heap restore).
   */
  const handlePageShow = useCallback(
    (event: PageTransitionEvent) => {
      // If page was restored from bfcache, run health check
      if (event.persisted && enabled) {
        if (DEBUG) {
          console.log('[RenditionHealthGuard] Page restored from bfcache');
        }

        setWasResumed(true);
        handleVisibilityChange();
      }
    },
    [enabled, handleVisibilityChange]
  );

  /**
   * Try to load saved CFI from localStorage on mount.
   */
  useEffect(() => {
    if (bookId) {
      const saved = localStorage.getItem(`book_${bookId}_resume_cfi`);
      if (saved) {
        setLastSavedCfi(saved);

        if (DEBUG) {
          console.log('[RenditionHealthGuard] Found saved CFI:', saved.slice(0, 50));
        }
      }
    }
  }, [bookId]);

  /**
   * Set up event listeners.
   */
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    if (DEBUG) {
      console.log('[RenditionHealthGuard] Initialized for book:', bookId);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);

      if (healthCheckTimeoutRef.current) {
        clearTimeout(healthCheckTimeoutRef.current);
      }

      if (DEBUG) {
        console.log('[RenditionHealthGuard] Cleanup complete');
      }
    };
  }, [enabled, bookId, handleVisibilityChange, handlePageHide, handlePageShow]);

  return {
    isHealthy,
    isChecking,
    wasResumed,
    checkHealth,
    markHealthy,
    lastSavedCfi,
  };
}
