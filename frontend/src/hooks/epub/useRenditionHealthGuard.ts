/**
 * useRenditionHealthGuard - PWA resume guard for epub.js reader
 *
 * This hook solves the PWA resume crash issue by always reloading
 * the page when returning from background state.
 *
 * Why always reload:
 * 1. epub.js rendition is extremely sensitive to JS heap unload
 * 2. Even short suspends (few seconds) can corrupt the rendition on iOS/Android
 * 3. Health checks are unreliable - rendition can pass checks but still be broken
 * 4. The only reliable recovery is a full page reload
 *
 * About background operations (image generation, parsing):
 * - These are BACKEND tasks (Celery) - they continue regardless of frontend state
 * - When page reloads, TanStack Query re-fetches operation statuses
 * - User sees the operation as still in progress (or completed if it finished)
 * - No actual work is lost, only temporary visual feedback
 *
 * Position preservation:
 * - CFI position is saved to localStorage before going to background
 * - On reload, the position is restored from localStorage
 *
 * @module hooks/epub/useRenditionHealthGuard
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Rendition } from '@/types/epub';

/** Enable debug logging only in development */
const DEBUG = import.meta.env.DEV;

/**
 * Minimum time in background before triggering reload.
 * Set to 0 to always reload on any resume.
 *
 * IMPORTANT: We set this to 0 because even very brief suspends can corrupt
 * epub.js rendition on iOS/Android. The 500ms threshold was causing errors
 * when users flipped pages and immediately minimized/returned.
 */
/**
 * Detect device type based on user agent
 * (Duplicated from readingSessions.ts to avoid circular deps)
 */
function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Minimum time in background before triggering reload.
 * Adaptive Strategy:
 * - Mobile: 0ms (Always reload to prevent iOS heap corruption)
 * - Desktop: 2000ms (Prevent annoying reloads on tab switching)
 */
const DEVICE_TYPE = detectDeviceType();
const MIN_BACKGROUND_TIME_FOR_RELOAD = DEVICE_TYPE === 'mobile' || DEVICE_TYPE === 'tablet' ? 0 : 2000;

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
  /** Not used - kept for API compatibility */
  isStable?: boolean;
  /** Not used - kept for API compatibility */
  hasActiveOperations?: boolean;
}

/**
 * Hook to guard rendition health during PWA lifecycle events.
 *
 * Uses reliable reload strategy: when PWA resumes from background,
 * the page is reloaded to ensure fresh epub.js state.
 *
 * This is the only reliable way to handle epub.js + PWA lifecycle,
 * because epub.js rendition cannot be reliably recovered after
 * JS heap unload (which happens frequently on iOS/Android).
 */
export function useRenditionHealthGuard({
  rendition,
  bookId,
  enabled = true,
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

  // Keep rendition ref updated
  useEffect(() => {
    renditionRef.current = rendition;
  }, [rendition]);

  /**
   * Check if the rendition is healthy.
   * Note: This check is not reliable for detecting all corruption cases.
   * Kept for API compatibility.
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
   * Clears the wasResumed flag.
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
        // Also save a timestamp so we know this is fresh
        localStorage.setItem(`book_${bookId}_resume_time`, Date.now().toString());

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
   * RELIABLE RELOAD STRATEGY:
   * Always reload when returning from background (after MIN_BACKGROUND_TIME_FOR_RELOAD).
   * This is the only reliable way to handle epub.js + PWA lifecycle.
   */
  const handleVisibilityChange = useCallback(() => {
    const newVisibility = document.visibilityState;
    const wasHidden = lastVisibilityRef.current === 'hidden';
    lastVisibilityRef.current = newVisibility;

    if (newVisibility === 'hidden') {
      // App is going to background - save position and record time
      savePositionBeforeHide();
      hideTimeRef.current = Date.now();

      if (DEBUG) {
        console.log('[RenditionHealthGuard] App going to background, position saved');
      }
      return;
    }

    // App became visible after being hidden
    if (wasHidden && enabled) {
      const timeInBackground = Date.now() - hideTimeRef.current;

      if (DEBUG) {
        console.log('[RenditionHealthGuard] App resumed after', Math.round(timeInBackground / 1000), 'seconds');
      }

      // Skip reload for very brief focus changes (< 500ms)
      // These are usually just quick app switching without actual background
      if (timeInBackground < MIN_BACKGROUND_TIME_FOR_RELOAD) {
        if (DEBUG) {
          console.log('[RenditionHealthGuard] Very brief suspend, skipping reload');
        }
        return;
      }

      // Mark as resumed
      setWasResumed(true);

      if (DEBUG) {
        console.log('[RenditionHealthGuard] Reloading page for fresh epub.js state...');
      }

      // Reload the page to get fresh epub.js state
      // The position will be restored from localStorage on next load
      window.location.reload();
    }
  }, [enabled, savePositionBeforeHide]);

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
      // If page was restored from bfcache, always reload
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
