/**
 * useEpubNavigation - Custom hook for EPUB page navigation
 *
 * Provides simple next/prev page navigation with keyboard support.
 * Includes smooth scroll animation for better UX.
 *
 * @param rendition - epub.js Rendition instance
 * @returns Navigation functions
 *
 * @example
 * const { nextPage, prevPage, canGoNext, canGoPrev } = useEpubNavigation(rendition);
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Rendition } from '@/types/epub';

// Detect iOS device
export const isIOS = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
};

// Detect Android device
export const isAndroid = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return /Android/i.test(navigator.userAgent);
};

/**
 * Wait for scroll to complete
 * Uses requestAnimationFrame polling to detect when scroll position stabilizes
 */
const waitForScrollEnd = (element: HTMLElement, target: number, timeout = 500): Promise<void> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastPosition = element.scrollLeft;
    let stableCount = 0;

    const checkScroll = () => {
      const currentPosition = element.scrollLeft;
      const isAtTarget = Math.abs(currentPosition - target) < 2;
      const isStable = Math.abs(currentPosition - lastPosition) < 1;

      // Resolve if at target or position is stable for 3 frames
      if (isAtTarget || (isStable && stableCount > 3)) {
        resolve();
        return;
      }

      // Timeout after specified duration
      if (Date.now() - startTime > timeout) {
        resolve();
        return;
      }

      lastPosition = currentPosition;
      stableCount = isStable ? stableCount + 1 : 0;
      requestAnimationFrame(checkScroll);
    };

    requestAnimationFrame(checkScroll);
  });
};

interface UseEpubNavigationReturn {
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  canGoNext: boolean;
  canGoPrev: boolean;
  debugInfo: string | null;
}

export const useEpubNavigation = (
  rendition: Rendition | null
): UseEpubNavigationReturn => {
  const debugInfoRef = useRef<string | null>(null);

  /**
   * iOS/Mobile FIX: Direct scroll navigation bypassing epub.js
   * epub.js navigation is broken on iOS PWA - scrolls multiple pages
   * We directly manipulate the scroll position instead
   *
   * CRITICAL FIX (January 2026):
   * - Use layout.delta instead of viewportWidth for scroll unit
   * - On iOS, CSS columns may render multiple pages within viewport
   * - viewportWidth would skip ALL columns, causing multi-page jumps
   * - layout.delta is the correct single-page scroll distance from epub.js
   *
   * Now with smooth scrolling for better UX
   */
  const directScroll = useCallback(async (
    direction: 'next' | 'prev',
    smooth = true
  ): Promise<boolean> => {
    if (!rendition) return false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = (rendition as any).manager;
      if (!manager) return false;

      // Get the stage/container element that scrolls
      const stage = manager.stage?.container || manager.container;
      if (!stage) return false;

      // CRITICAL FIX: Use layout.delta instead of viewportWidth
      // layout.delta = correct scroll unit calculated by epub.js
      // viewportWidth may contain multiple CSS columns on iOS Safari
      // Fallback chain: layout.delta → layout.columnWidth → stage.clientWidth
      const layout = manager.layout;
      const viewportWidth = stage.clientWidth;

      // Determine correct scroll unit
      let scrollUnit: number;
      if (layout?.delta && layout.delta > 0 && layout.delta <= viewportWidth) {
        // Use epub.js calculated delta (most reliable)
        scrollUnit = layout.delta;
      } else if (layout?.columnWidth && layout.columnWidth > 0 && layout.columnWidth <= viewportWidth) {
        // Fallback to columnWidth
        scrollUnit = layout.columnWidth + (layout.gap || 0);
      } else {
        // Final fallback to viewport width (may cause issues on iOS)
        scrollUnit = viewportWidth;
      }

      // iOS Safety: If divisor > 1, force correct scroll unit
      if (isIOS() && layout?.divisor && layout.divisor > 1) {
        // iOS has multiple columns - calculate single column width
        scrollUnit = Math.floor(viewportWidth / layout.divisor);
        if (import.meta.env.DEV) {
          console.warn('[useEpubNavigation] iOS: Detected divisor > 1, correcting scrollUnit:', {
            divisor: layout.divisor,
            originalDelta: layout.delta,
            correctedScrollUnit: scrollUnit,
          });
        }
      }

      const currentScroll = stage.scrollLeft;
      const maxScroll = stage.scrollWidth - viewportWidth;

      let newScroll: number;
      if (direction === 'next') {
        newScroll = Math.min(currentScroll + scrollUnit, maxScroll);
      } else {
        newScroll = Math.max(currentScroll - scrollUnit, 0);
      }

      // Check if we can scroll (not at boundary)
      if (direction === 'next' && currentScroll >= maxScroll - 1) {
        // At end - let epub.js handle chapter change
        debugInfoRef.current = `END S:${Math.round(currentScroll)}`;
        return false;
      }
      if (direction === 'prev' && currentScroll <= 0) {
        // At start - let epub.js handle chapter change
        debugInfoRef.current = `START S:${Math.round(currentScroll)}`;
        return false;
      }

      // Perform scroll (smooth or instant)
      if (smooth) {
        // Use CSS smooth scroll
        stage.scrollTo({
          left: newScroll,
          behavior: 'smooth',
        });
        // Wait for scroll to complete
        await waitForScrollEnd(stage, newScroll);
      } else {
        // Instant scroll
        stage.scrollLeft = newScroll;
      }

      debugInfoRef.current = `S:${Math.round(currentScroll)}→${Math.round(newScroll)} U:${scrollUnit}${smooth ? ' smooth' : ''}`;

      return true;
    } catch (err) {
      console.warn('[useEpubNavigation] Direct scroll error:', err);
      return false;
    }
  }, [rendition]);

  const nextPage = useCallback(async () => {
    if (!rendition) return;

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('next', true);
      if (scrolled) return; // Direct scroll worked
      // Fall through to epub.js for chapter changes
    }

    try {
      await rendition.next();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[useEpubNavigation] Could not go to next page:', err);
      }
    }
  }, [rendition, directScroll]);

  const prevPage = useCallback(async () => {
    if (!rendition) return;

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('prev', true);
      if (scrolled) return; // Direct scroll worked
      // Fall through to epub.js for chapter changes
    }

    try {
      await rendition.prev();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[useEpubNavigation] Could not go to prev page:', err);
      }
    }
  }, [rendition, directScroll]);

  // Note: epub.js doesn't provide easy way to check if we can go next/prev
  // We return true for now, and let epub.js handle boundaries
  const canGoNext = !!rendition;
  const canGoPrev = !!rendition;

  return {
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev,
    debugInfo: debugInfoRef.current,
  };
};

/**
 * useKeyboardNavigation - Keyboard shortcuts for EPUB navigation
 *
 * Listens on both the main window and the epub.js iframe document
 * to ensure keyboard events work when focus is inside the reader.
 *
 * @param nextPage - Function to go to next page
 * @param prevPage - Function to go to previous page
 * @param enabled - Whether keyboard navigation is enabled
 * @param rendition - Optional epub.js Rendition for iframe keyboard events
 *
 * @example
 * useKeyboardNavigation(nextPage, prevPage, true, rendition);
 */
export const useKeyboardNavigation = (
  nextPage: () => void,
  prevPage: () => void,
  enabled: boolean = true,
  rendition?: Rendition | null
): void => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          prevPage();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ': // Spacebar
          e.preventDefault();
          nextPage();
          break;
      }
    };

    // Listen on main window
    window.addEventListener('keydown', handleKeyPress);

    // Also listen in epub.js iframe for when focus is inside
    const attachToIframe = () => {
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.addEventListener('keydown', handleKeyPress);
      }
    };

    // Attach on rendered event (iframe may reload on chapter change)
    rendition?.on('rendered', attachToIframe);

    // Attach immediately if already rendered
    attachToIframe();

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      rendition?.off('rendered', attachToIframe);
      // Clean up iframe listener
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [nextPage, prevPage, enabled, rendition]);
};
