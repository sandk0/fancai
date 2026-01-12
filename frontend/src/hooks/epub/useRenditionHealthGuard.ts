/**
 * useRenditionHealthGuard - PWA resume guard for epub.js reader
 *
 * This hook solves the PWA resume crash issue where:
 * 1. User opens a book and minimizes the PWA
 * 2. JavaScript heap may be unloaded due to memory pressure (iOS/Android)
 * 3. When returning, epub.js rendition becomes corrupted
 * 4. React re-renders with stale/corrupted rendition causing crashes
 *
 * The solution (aggressive reload strategy):
 * 1. Track app visibility state
 * 2. On pagehide, save current reading position to localStorage
 * 3. When app resumes from background, immediately reload the page
 * 4. On reload, the saved position is restored from localStorage
 *
 * Why aggressive reload instead of health checks:
 * - epub.js rendition can be in a broken state that passes basic health checks
 * - React state can be stale but look valid
 * - The only reliable way to recover is a full page reload
 *
 * @module hooks/epub/useRenditionHealthGuard
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Rendition } from '@/types/epub';

/** Enable debug logging only in development */
const DEBUG = import.meta.env.DEV;

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
  /** Callback when health check fails and reload is needed (not used with aggressive strategy) */
  onCorrupted?: () => void;
  /** Whether the guard is enabled (disable during initial load) */
  enabled?: boolean;
}

/**
 * Hook to guard rendition health during PWA lifecycle events.
 *
 * Uses aggressive reload strategy: when PWA resumes from background,
 * the page is immediately reloaded to ensure fresh state.
 */
export function useRenditionHealthGuard({
  rendition,
  bookId,
  enabled = true,
}: UseRenditionHealthGuardOptions): RenditionHealthGuardReturn {
  // These states are kept for API compatibility but are less important
  // with the aggressive reload strategy
  const [isHealthy] = useState(true);
  const [isChecking] = useState(false);
  const [wasResumed, setWasResumed] = useState(false);
  const [lastSavedCfi, setLastSavedCfi] = useState<string | null>(null);

  const lastVisibilityRef = useRef<'visible' | 'hidden'>(
    typeof document !== 'undefined' ? document.visibilityState : 'visible'
  );
  const renditionRef = useRef<Rendition | null>(null);

  // Keep rendition ref updated
  useEffect(() => {
    renditionRef.current = rendition;
  }, [rendition]);

  /**
   * Check if the rendition is healthy.
   * With aggressive reload strategy, this is mainly for API compatibility.
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
   * Mark the rendition as healthy.
   * With aggressive reload strategy, this is a no-op.
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
   *
   * AGGRESSIVE RELOAD STRATEGY:
   * When PWA resumes from background, immediately reload the page.
   * This is more reliable than trying to detect and recover from corruption.
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
      if (DEBUG) {
        console.log('[RenditionHealthGuard] App resumed from background, reloading page...');
      }

      // Mark as resumed (though we're about to reload)
      setWasResumed(true);

      // AGGRESSIVE STRATEGY: Always reload when resuming from background.
      // This is more reliable than trying to detect corruption, because:
      // 1. epub.js rendition can be in a broken state that passes health checks
      // 2. React state can be stale but look valid
      // 3. IndexedDB/Cache might have inconsistent state
      // The full page reload ensures everything is fresh.
      window.location.reload();
    }
  }, [enabled, savePositionBeforeHide]);

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
      // If page was restored from bfcache, reload
      if (event.persisted && enabled) {
        if (DEBUG) {
          console.log('[RenditionHealthGuard] Page restored from bfcache, reloading...');
        }
        window.location.reload();
      }
    },
    [enabled]
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
