/**
 * useRenditionHealthGuard - Smart PWA resume guard for epub.js reader
 *
 * This hook solves the PWA resume crash issue while preserving UX for
 * background operations like image generation and chapter parsing.
 *
 * Strategy:
 * 1. Track time spent in background
 * 2. Track if rendition is "stable" (fully loaded, content displayed)
 * 3. Track if active operations are in progress (image gen, parsing)
 *
 * Decision matrix:
 * - NOT stable (initial loading): ALWAYS reload to prevent crash
 * - Stable + short suspend (< 30s): DON'T reload, try to continue
 * - Stable + active operations + suspend < 2min: DON'T reload (let ops finish)
 * - Stable + long suspend (> 30s or > 2min with ops): RELOAD
 *
 * This ensures:
 * - Crashes are prevented during initial loading
 * - Short tab switches don't interrupt the user
 * - Background operations have time to complete
 * - Long suspends still get cleaned up properly
 *
 * @module hooks/epub/useRenditionHealthGuard
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Rendition } from '@/types/epub';

/** Enable debug logging only in development */
const DEBUG = import.meta.env.DEV;

/**
 * Time threshold for "short" suspend when NO active operations.
 * Below this, we don't reload (assume state is still valid).
 */
const SHORT_SUSPEND_THRESHOLD = 30_000; // 30 seconds

/**
 * Time threshold when active operations are in progress.
 * Extended to give operations time to complete.
 */
const ACTIVE_OPS_THRESHOLD = 120_000; // 2 minutes

export interface RenditionHealthGuardReturn {
  /** Whether the rendition is currently healthy and ready for use */
  isHealthy: boolean;
  /** Whether a health check is currently in progress */
  isChecking: boolean;
  /** Whether the app was just resumed from background */
  wasResumed: boolean;
  /** Force a health check manually */
  checkHealth: () => Promise<boolean>;
  /** Mark the rendition as stable (call after successful navigation/display) */
  markHealthy: () => void;
  /** Last saved CFI position before background */
  lastSavedCfi: string | null;
}

export interface UseRenditionHealthGuardOptions {
  /** The epub.js rendition instance to monitor */
  rendition: Rendition | null;
  /** Book ID for position persistence */
  bookId: string;
  /** Whether the guard is enabled (disable during initial load) */
  enabled?: boolean;
  /**
   * Whether the rendition is stable (fully loaded, content displayed).
   * Pass `true` after successful navigation and content display.
   * When `false`, any resume from background will trigger reload.
   */
  isStable?: boolean;
  /**
   * Whether there are active background operations (image generation, parsing).
   * When `true`, the reload threshold is extended to give operations time to complete.
   */
  hasActiveOperations?: boolean;
}

/**
 * Hook to guard rendition health during PWA lifecycle events.
 *
 * Uses smart reload strategy that balances crash prevention with UX:
 * - Always reloads during unstable/loading phase (prevents crashes)
 * - Skips reload for short suspends (preserves state)
 * - Extends threshold when operations are active (preserves background work)
 * - Reloads for long suspends (ensures fresh state)
 */
export function useRenditionHealthGuard({
  rendition,
  bookId,
  enabled = true,
  isStable = false,
  hasActiveOperations = false,
}: UseRenditionHealthGuardOptions): RenditionHealthGuardReturn {
  const [isHealthy] = useState(true);
  const [isChecking] = useState(false);
  const [wasResumed, setWasResumed] = useState(false);
  const [lastSavedCfi, setLastSavedCfi] = useState<string | null>(null);

  const lastVisibilityRef = useRef<'visible' | 'hidden'>(
    typeof document !== 'undefined' ? document.visibilityState : 'visible'
  );
  const renditionRef = useRef<Rendition | null>(null);
  const hideTimeRef = useRef<number>(0);

  // Track stable and active ops state in refs for use in event handlers
  const isStableRef = useRef(isStable);
  const hasActiveOperationsRef = useRef(hasActiveOperations);

  // Keep refs updated
  useEffect(() => {
    renditionRef.current = rendition;
  }, [rendition]);

  useEffect(() => {
    isStableRef.current = isStable;
  }, [isStable]);

  useEffect(() => {
    hasActiveOperationsRef.current = hasActiveOperations;
  }, [hasActiveOperations]);

  /**
   * Check if the rendition is healthy.
   * Used for API compatibility and manual checks.
   */
  const checkHealth = useCallback(async (): Promise<boolean> => {
    const currentRendition = renditionRef.current;
    if (!currentRendition) {
      return true;
    }

    try {
      const loc = currentRendition.currentLocation();
      if (!loc || !loc.start || !loc.end) {
        return false;
      }
      if (!currentRendition.manager) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Mark the rendition as healthy/stable.
   * Clears the wasResumed flag after successful recovery.
   */
  const markHealthy = useCallback(() => {
    setWasResumed(false);
  }, []);

  /**
   * Save current position before going to background.
   * This is critical for position recovery after page reload.
   */
  const savePositionBeforeHide = useCallback(() => {
    const currentRendition = renditionRef.current;
    if (!currentRendition || !bookId) return;

    try {
      const loc = currentRendition.currentLocation();
      const cfi = loc?.start?.cfi;

      if (cfi) {
        setLastSavedCfi(cfi);
        localStorage.setItem(`book_${bookId}_resume_cfi`, cfi);

        if (DEBUG) {
          console.log('[RenditionHealthGuard] Saved position before hide:', cfi.slice(0, 50));
        }
      }
    } catch (e) {
      if (DEBUG) {
        console.error('[RenditionHealthGuard] Failed to save position:', e);
      }
    }
  }, [bookId]);

  /**
   * Handle visibility change events.
   *
   * SMART RELOAD STRATEGY:
   * - NOT stable: Always reload (prevents crashes during initial load)
   * - Stable + short suspend: Don't reload (preserves state)
   * - Stable + active ops + medium suspend: Don't reload (let ops finish)
   * - Stable + long suspend: Reload (ensures fresh state)
   */
  const handleVisibilityChange = useCallback(() => {
    const newVisibility = document.visibilityState;
    const wasHidden = lastVisibilityRef.current === 'hidden';
    lastVisibilityRef.current = newVisibility;

    if (newVisibility === 'hidden') {
      // App is going to background - save position and record time
      savePositionBeforeHide();
      hideTimeRef.current = Date.now();
      return;
    }

    // App became visible after being hidden
    if (wasHidden && enabled) {
      const timeInBackground = Date.now() - hideTimeRef.current;
      const stable = isStableRef.current;
      const hasActiveOps = hasActiveOperationsRef.current;

      if (DEBUG) {
        console.log('[RenditionHealthGuard] Resume check:', {
          timeInBackground: `${Math.round(timeInBackground / 1000)}s`,
          stable,
          hasActiveOps,
        });
      }

      // Case 1: Not stable (initial loading phase) - ALWAYS reload
      // This prevents the crash that happens when minimizing during book load
      if (!stable) {
        if (DEBUG) {
          console.log('[RenditionHealthGuard] Not stable, reloading to prevent crash...');
        }
        window.location.reload();
        return;
      }

      // Case 2: Stable - check time thresholds
      const threshold = hasActiveOps ? ACTIVE_OPS_THRESHOLD : SHORT_SUSPEND_THRESHOLD;

      if (timeInBackground < threshold) {
        // Short/medium suspend - try to continue without reload
        if (DEBUG) {
          console.log(
            `[RenditionHealthGuard] Short suspend (${Math.round(timeInBackground / 1000)}s < ${threshold / 1000}s), continuing...`
          );
        }
        setWasResumed(true);

        // Run a health check - if it fails, we might still need to reload
        checkHealth().then((healthy) => {
          if (!healthy) {
            if (DEBUG) {
              console.log('[RenditionHealthGuard] Health check failed after short suspend, reloading...');
            }
            window.location.reload();
          } else {
            if (DEBUG) {
              console.log('[RenditionHealthGuard] Health check passed, continuing normally');
            }
            setWasResumed(false);
          }
        });
        return;
      }

      // Case 3: Long suspend - reload
      if (DEBUG) {
        console.log(
          `[RenditionHealthGuard] Long suspend (${Math.round(timeInBackground / 1000)}s >= ${threshold / 1000}s), reloading...`
        );
      }
      window.location.reload();
    }
  }, [enabled, savePositionBeforeHide, checkHealth]);

  /**
   * Handle page hide event (before JS heap unload).
   */
  const handlePageHide = useCallback(() => {
    savePositionBeforeHide();
    hideTimeRef.current = Date.now();
  }, [savePositionBeforeHide]);

  /**
   * Handle page show event (after potential heap restore).
   */
  const handlePageShow = useCallback(
    (event: PageTransitionEvent) => {
      // If page was restored from bfcache, check if we need to reload
      if (event.persisted && enabled) {
        const stable = isStableRef.current;

        if (!stable) {
          if (DEBUG) {
            console.log('[RenditionHealthGuard] bfcache restore while not stable, reloading...');
          }
          window.location.reload();
        } else {
          // Run health check for bfcache restore
          checkHealth().then((healthy) => {
            if (!healthy) {
              if (DEBUG) {
                console.log('[RenditionHealthGuard] bfcache health check failed, reloading...');
              }
              window.location.reload();
            }
          });
        }
      }
    },
    [enabled, checkHealth]
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
      console.log('[RenditionHealthGuard] Initialized for book:', bookId, {
        isStable,
        hasActiveOperations,
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);

      if (DEBUG) {
        console.log('[RenditionHealthGuard] Cleanup complete');
      }
    };
  }, [enabled, bookId, isStable, hasActiveOperations, handleVisibilityChange, handlePageHide, handlePageShow]);

  return {
    isHealthy,
    isChecking,
    wasResumed,
    checkHealth,
    markHealthy,
    lastSavedCfi,
  };
}
