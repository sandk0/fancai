/**
 * useTouchNavigation - Touch/tap navigation for EPUB reader
 *
 * iOS SAFARI FIX (January 2026):
 * epub.js passEvents() does not reliably forward touch/click events on iOS Safari.
 * This is a known issue: https://github.com/futurepress/epub.js/issues/925
 *
 * Solution: Bind events directly to iframe document via rendition.hooks.content.register()
 * instead of relying on rendition.on('click/touchstart/touchend').
 *
 * Tap zones:
 * - Left 25% = previous page
 * - Right 25% = next page
 * - Center 50% = allow text selection and description clicks
 *
 * ARCHITECTURE:
 * 1. Use hooks.content.register() to attach event listeners directly to iframe document
 * 2. Each page load triggers the hook, ensuring events are always bound
 * 3. Fallback to rendition.on() for compatibility with older epub.js versions
 *
 * FIXES:
 * 1. iOS Safari tap navigation not working (primary fix)
 * 2. Prevent double navigation by ignoring click after touch
 * 3. Add cursor:pointer to body for iOS click event delegation
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Rendition, Contents } from '@/types/epub';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';
import { logger } from '@/lib/logger';

const TAP_MAX_DURATION = 350; // ms - max duration to be considered a tap
const TAP_MAX_MOVEMENT = 20; // px - increased for mobile tolerance
const LEFT_ZONE_END = 0.25;
const RIGHT_ZONE_START = 0.75;

// Debounce time to prevent click after touch
const TOUCH_CLICK_DEBOUNCE = 500; // ms

const log = (...args: unknown[]) => {
  logger.debug('[TouchNav]', ...args);
};

/**
 * Detect iOS device - used to skip this hook on iOS
 * iOS uses IOSTapZones overlay instead
 */
const isIOS = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
};

interface UseTouchNavigationOptions {
  rendition: Rendition | null;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  nextPage: () => void;
  prevPage: () => void;
  enabled?: boolean;
  navLock: NavigationLock;
}

export const useTouchNavigation = ({
  rendition,
  viewerRef: _viewerRef, // Not used - we bind directly to iframe
  nextPage,
  prevPage,
  enabled = true,
  navLock,
}: UseTouchNavigationOptions): void => {
  // Store navigation functions in refs to avoid closure issues
  const nextPageRef = useRef(nextPage);
  const prevPageRef = useRef(prevPage);
  const enabledRef = useRef(enabled);
  const navLockRef = useRef(navLock);

  // Track touch start for tap detection
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Track last touch navigation time to prevent click after touch
  const lastTouchNavTimeRef = useRef<number>(0);

  // Keep refs updated
  useEffect(() => {
    nextPageRef.current = nextPage;
    prevPageRef.current = prevPage;
    enabledRef.current = enabled;
    navLockRef.current = navLock;
  }, [nextPage, prevPage, enabled, navLock]);

  /**
   * Get iframe position to convert iframe-relative coords to screen coords
   */
  const getIframeOffset = useCallback((contents: Contents): number => {
    try {
      const iframeWindow = contents.window;
      if (iframeWindow && iframeWindow.frameElement) {
        const rect = (iframeWindow.frameElement as HTMLElement).getBoundingClientRect();
        return rect.left;
      }
    } catch (e) {
      log('Error getting iframe position:', e);
    }
    return 0;
  }, []);

  /**
   * Determine navigation action based on X coordinate relative to window width
   */
  const getNavigationAction = useCallback((screenX: number): 'prev' | 'next' | 'none' => {
    const screenWidth = window.innerWidth;
    const leftThreshold = screenWidth * LEFT_ZONE_END;
    const rightThreshold = screenWidth * RIGHT_ZONE_START;

    log('Zone check:', { screenX, screenWidth, leftThreshold, rightThreshold });

    if (screenX < leftThreshold) return 'prev';
    if (screenX > rightThreshold) return 'next';
    return 'none';
  }, []);

  /**
   * Check if target is a description highlight or interactive element
   */
  const isInteractiveElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;

    // Description highlights
    if (
      target.classList?.contains('description-highlight') ||
      target.closest?.('.description-highlight')
    ) {
      return true;
    }

    // Links
    if (target.tagName === 'A' || target.closest?.('a')) {
      return true;
    }

    // Buttons
    if (target.tagName === 'BUTTON' || target.closest?.('button')) {
      return true;
    }

    return false;
  }, []);

  /**
   * Main effect - setup event listeners via hooks.content.register()
   *
   * NOTE: On iOS, this hook is DISABLED. iOS uses IOSTapZones overlay instead
   * because iOS PWA does not reliably forward touch events from iframes.
   */
  useEffect(() => {
    // Skip on iOS - IOSTapZones handles navigation there
    if (isIOS()) {
      log('iOS detected - skipping useTouchNavigation (using IOSTapZones instead)');
      return;
    }

    if (!rendition) {
      log('No rendition, skipping setup');
      return;
    }

    log('Setting up touch navigation (non-iOS)');

    /**
     * Navigate with lock coordination.
     * Acquires the shared navigation lock before navigating and releases after.
     * Also updates lastTouchNavTimeRef for touch-click dedup.
     */
    const navigateWithLock = async (action: 'prev' | 'next') => {
      if (!navLockRef.current.acquire()) {
        log(`Navigation locked - ignoring ${action}`);
        return;
      }
      try {
        lastTouchNavTimeRef.current = Date.now();
        if (action === 'prev') {
          log(`LEFT ZONE - calling prevPage()`);
          await prevPageRef.current();
        } else {
          log(`RIGHT ZONE - calling nextPage()`);
          await nextPageRef.current();
        }
      } finally {
        navLockRef.current.release();
      }
    };

    /**
     * Content hook - called when each page is rendered
     * Binds events directly to iframe document (works on iOS Safari)
     */
    const contentHook = (contents: Contents) => {
      const doc = contents.document;
      if (!doc) {
        log('No document in contents, skipping');
        return;
      }

      log('Content hook triggered - binding events to iframe document');

      // iOS Safari fix: Add cursor:pointer to body for click event delegation
      // https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html
      const body = doc.body;
      if (body) {
        body.style.cursor = 'pointer';
      }

      /**
       * Get current iframe offset - computed dynamically at event time
       * IMPORTANT: Must be computed fresh each time, not cached in closure
       */
      const getCurrentIframeOffset = (): number => {
        return getIframeOffset(contents);
      };

      /**
       * Handle touch start - record position and time
       */
      const handleTouchStart = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        const touch = e.touches[0];
        if (!touch) return;

        // Convert iframe coords to screen coords - compute offset fresh
        const iframeOffset = getCurrentIframeOffset();
        const screenX = touch.clientX + iframeOffset;
        const y = touch.clientY;

        log('TouchStart (direct):', { clientX: touch.clientX, iframeOffset, screenX, y });

        touchStartRef.current = {
          x: screenX,
          y,
          time: Date.now(),
        };
      };

      /**
       * Handle touch end - determine if it was a tap and navigate
       */
      const handleTouchEnd = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        if (!touchStartRef.current) {
          log('TouchEnd: No touchStart recorded');
          return;
        }

        const touch = e.changedTouches[0];
        if (!touch) {
          touchStartRef.current = null;
          return;
        }

        // Compute offset fresh for end event
        const iframeOffset = getCurrentIframeOffset();
        const endScreenX = touch.clientX + iframeOffset;
        const endY = touch.clientY;
        const endTime = Date.now();

        const startX = touchStartRef.current.x;
        const startY = touchStartRef.current.y;
        const startTime = touchStartRef.current.time;

        // Reset
        touchStartRef.current = null;

        // Calculate movement and duration
        const deltaX = Math.abs(endScreenX - startX);
        const deltaY = Math.abs(endY - startY);
        const duration = endTime - startTime;

        const isTap =
          duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;

        log('TouchEnd (direct):', { startX, endScreenX, deltaX, deltaY, duration, isTap });

        if (!isTap) {
          log('Not a tap - ignoring (swipe or long press)');
          return;
        }

        // Check if tap is on interactive element - allow through
        if (isInteractiveElement(e.target)) {
          log('Tap on interactive element - allowing through');
          return;
        }

        // Handle navigation based on zone (use start position for tap)
        const action = getNavigationAction(startX);
        log('Touch navigation action (direct):', action);

        if (action === 'prev' || action === 'next') {
          navigateWithLock(action);
        } else {
          log('CENTER ZONE TAP - no navigation');
        }
      };

      /**
       * Handle click - for desktop and as fallback for iOS
       */
      const handleClick = (e: MouseEvent) => {
        if (!enabledRef.current) return;

        // CRITICAL: Ignore click if it came shortly after a touch navigation
        // This prevents double page turns on mobile
        const timeSinceTouch = Date.now() - lastTouchNavTimeRef.current;
        if (timeSinceTouch < TOUCH_CLICK_DEBOUNCE) {
          log('Click ignored - too soon after touch navigation:', timeSinceTouch, 'ms');
          return;
        }

        // Convert iframe coords to screen coords - compute offset fresh
        const iframeOffset = getCurrentIframeOffset();
        const screenX = e.clientX + iframeOffset;
        log('Click (direct):', {
          clientX: e.clientX,
          iframeOffset,
          screenX,
          target: (e.target as HTMLElement)?.tagName,
        });

        // Check if click is on interactive element - allow through
        if (isInteractiveElement(e.target)) {
          log('Click on interactive element - allowing through');
          return;
        }

        // Handle navigation based on zone
        const action = getNavigationAction(screenX);
        log('Click action (direct):', action);

        if (action === 'prev' || action === 'next') {
          navigateWithLock(action);
        } else {
          log('CENTER ZONE CLICK - no navigation');
        }
      };

      // Bind events directly to iframe document
      // Use capture phase (true) for better iOS compatibility
      doc.addEventListener('touchstart', handleTouchStart, { passive: true, capture: false });
      doc.addEventListener('touchend', handleTouchEnd, { passive: true, capture: false });
      doc.addEventListener('click', handleClick, { capture: false });

      log('Events bound directly to iframe document (iOS fix active)');

      // Store cleanup function on the document for later removal
      // @ts-expect-error - custom property for cleanup
      doc.__touchNavCleanup = () => {
        doc.removeEventListener('touchstart', handleTouchStart);
        doc.removeEventListener('touchend', handleTouchEnd);
        doc.removeEventListener('click', handleClick);
        log('Cleaned up direct iframe event listeners');
      };
    };

    // Register the content hook (iOS fix - direct iframe binding)
    rendition.hooks.content.register(contentHook);
    log('Content hook registered');

    // Also set up existing contents (for pages already rendered)
    try {
      const existingContents = rendition.getContents();
      if (existingContents && existingContents.length > 0) {
        log('Setting up events for existing contents:', existingContents.length);
        existingContents.forEach(contentHook);
      }
    } catch (e) {
      log('Error setting up existing contents:', e);
    }

    // =========================================================================
    // FALLBACK: Also use rendition.on() for Android and other platforms
    // epub.js passEvents() works on Android but not iOS Safari
    // This provides redundancy - whichever works will handle navigation
    // =========================================================================

    /**
     * Get screen X from event, accounting for iframe position
     */
    const getScreenXFromRendition = (clientX: number): number => {
      try {
        const contents = rendition.getContents();
        if (contents && contents.length > 0) {
          const iframe = contents[0];
          const iframeWindow = iframe.window;
          if (iframeWindow && iframeWindow.frameElement) {
            const rect = (iframeWindow.frameElement as HTMLElement).getBoundingClientRect();
            return clientX + rect.left;
          }
        }
      } catch (e) {
        log('Error getting iframe position (rendition):', e);
      }
      return clientX;
    };

    /**
     * Fallback touch start handler via rendition.on()
     */
    const handleTouchStartFallback = (e: TouchEvent) => {
      if (!enabledRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      const screenX = getScreenXFromRendition(touch.clientX);
      log('TouchStart (fallback):', { clientX: touch.clientX, screenX });

      // Only set if not already set by direct handler
      if (!touchStartRef.current) {
        touchStartRef.current = {
          x: screenX,
          y: touch.clientY,
          time: Date.now(),
        };
      }
    };

    /**
     * Fallback touch end handler via rendition.on()
     */
    const handleTouchEndFallback = (e: TouchEvent) => {
      if (!enabledRef.current) return;

      if (!touchStartRef.current) {
        log('TouchEnd (fallback): No touchStart recorded');
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        return;
      }

      const endScreenX = getScreenXFromRendition(touch.clientX);
      const endTime = Date.now();

      const startX = touchStartRef.current.x;
      const startY = touchStartRef.current.y;
      const startTime = touchStartRef.current.time;

      touchStartRef.current = null;

      const deltaX = Math.abs(endScreenX - startX);
      const deltaY = Math.abs(touch.clientY - startY);
      const duration = endTime - startTime;

      const isTap =
        duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;

      log('TouchEnd (fallback):', { startX, endScreenX, deltaX, deltaY, duration, isTap });

      if (!isTap) return;

      if (isInteractiveElement(e.target)) {
        log('Tap on interactive element (fallback) - allowing through');
        return;
      }

      const action = getNavigationAction(startX);
      log('Touch navigation action (fallback):', action);

      if (action === 'prev' || action === 'next') {
        navigateWithLock(action);
      }
    };

    /**
     * Fallback click handler via rendition.on()
     */
    const handleClickFallback = (e: MouseEvent) => {
      if (!enabledRef.current) return;

      const timeSinceTouch = Date.now() - lastTouchNavTimeRef.current;
      if (timeSinceTouch < TOUCH_CLICK_DEBOUNCE) {
        log('Click ignored (fallback) - too soon after touch:', timeSinceTouch, 'ms');
        return;
      }

      const screenX = getScreenXFromRendition(e.clientX);
      log('Click (fallback):', { clientX: e.clientX, screenX });

      if (isInteractiveElement(e.target)) {
        log('Click on interactive element (fallback) - allowing through');
        return;
      }

      const action = getNavigationAction(screenX);
      log('Click action (fallback):', action);

      if (action === 'prev' || action === 'next') {
        navigateWithLock(action);
      }
    };

    // Register fallback handlers on rendition (works on Android)
    rendition.on('touchstart', handleTouchStartFallback as unknown as (...args: unknown[]) => void);
    rendition.on('touchend', handleTouchEndFallback as unknown as (...args: unknown[]) => void);
    rendition.on('click', handleClickFallback as unknown as (...args: unknown[]) => void);
    log('Fallback handlers registered on rendition.on()');

    // Cleanup
    return () => {
      log('Cleaning up touch navigation');

      // Cleanup content hook
      try {
        rendition.hooks.content.deregister(contentHook);
      } catch (e) {
        log('Error deregistering content hook:', e);
      }

      // Cleanup fallback handlers
      try {
        rendition.off(
          'touchstart',
          handleTouchStartFallback as unknown as (...args: unknown[]) => void
        );
        rendition.off(
          'touchend',
          handleTouchEndFallback as unknown as (...args: unknown[]) => void
        );
        rendition.off('click', handleClickFallback as unknown as (...args: unknown[]) => void);
      } catch (e) {
        log('Error removing fallback handlers:', e);
      }

      // Clean up any existing document listeners
      try {
        const contents = rendition.getContents();
        if (contents) {
          contents.forEach((c) => {
            // @ts-expect-error - custom property for cleanup
            if (c.document && c.document.__touchNavCleanup) {
              // @ts-expect-error - custom property for cleanup
              c.document.__touchNavCleanup();
            }
          });
        }
      } catch (e) {
        log('Error cleaning up document listeners:', e);
      }
    };
  }, [rendition, getIframeOffset, getNavigationAction, isInteractiveElement]);
};
