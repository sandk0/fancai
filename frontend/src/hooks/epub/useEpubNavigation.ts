/**
 * useEpubNavigation - Custom hook for EPUB page navigation
 *
 * Provides simple next/prev page navigation with keyboard support.
 * Includes smooth scroll animation for better UX.
 *
 * CRITICAL FIX (January 2026):
 * - Measures actual CSS column width from DOM instead of relying on epub.js layout.delta
 * - Fixes "1 page = 2 screens" bug on mobile where epub.js miscalculates column width
 * - Uses multi-method measurement with fallback chain for reliability
 *
 * @param rendition - epub.js Rendition instance
 * @returns Navigation functions
 *
 * @example
 * const { nextPage, prevPage, canGoNext, canGoPrev } = useEpubNavigation(rendition);
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Rendition } from '@/types/epub';

// Layout type for internal use
interface EpubLayout {
  delta?: number;
  columnWidth?: number;
  gap?: number;
  divisor?: number;
  pageWidth?: number;
}

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

/**
 * Measurement result with source for debugging
 */
interface MeasuredScrollUnit {
  unit: number;
  source: string;
  debug: {
    cssColumnWidth?: number;
    cssColumnGap?: number;
    firstBlockWidth?: number;
    scrollWidth?: number;
    estimatedPages?: number;
    layoutDelta?: number;
    viewportWidth: number;
  };
}

/**
 * getMeasuredScrollUnit - Measures actual CSS column width from DOM
 *
 * CRITICAL FIX (January 2026):
 * Instead of relying on epub.js layout.delta (which can be wrong on mobile),
 * we measure the actual CSS column width directly from the rendered DOM.
 *
 * Measurement priority:
 * 1. CSS computed column-width from iframe body
 * 2. Width of first block element (p, div, section)
 * 3. scrollWidth / estimated pages calculation
 * 4. epub.js layout.delta (if reasonable)
 * 5. Viewport width (final fallback)
 *
 * @param rendition - epub.js Rendition instance
 * @param viewportWidth - Stage container width
 * @param layout - epub.js layout object
 * @returns Measured scroll unit with source and debug info
 */
const getMeasuredScrollUnit = (
  rendition: Rendition,
  viewportWidth: number,
  scrollWidth: number,
  layout: EpubLayout | null
): MeasuredScrollUnit => {
  const debug: MeasuredScrollUnit['debug'] = {
    viewportWidth,
    scrollWidth,
    layoutDelta: layout?.delta,
  };

  try {
    // Get iframe contents
    const contents = rendition.getContents();
    const iframeContent = contents?.[0];

    if (iframeContent?.document?.body) {
      const body = iframeContent.document.body;
      const computed = getComputedStyle(body);

      // Method 1: CSS computed column-width
      // This is the most accurate way to measure actual column width
      const cssColumnWidth = parseFloat(computed.columnWidth);
      const cssColumnGap = parseFloat(computed.columnGap) || 0;
      debug.cssColumnWidth = cssColumnWidth;
      debug.cssColumnGap = cssColumnGap;

      if (cssColumnWidth > 0 && !isNaN(cssColumnWidth) && cssColumnWidth < viewportWidth) {
        // CSS column-width is set and valid
        const unit = cssColumnWidth + cssColumnGap;
        if (isIOS()) {
          console.log('[getMeasuredScrollUnit] Method 1 SUCCESS: CSS column-width', {
            cssColumnWidth,
            cssColumnGap,
            unit,
          });
        }
        return { unit, source: 'css-column-width', debug };
      }

      // Method 2: Measure first block element width
      // Works when CSS columns render elements at specific widths
      const firstBlock = body.querySelector('p, div, section, article, h1, h2, h3') as HTMLElement | null;
      if (firstBlock) {
        const blockRect = firstBlock.getBoundingClientRect();
        const blockWidth = blockRect.width;
        debug.firstBlockWidth = blockWidth;

        // Valid if block is narrower than viewport (indicates column layout)
        if (blockWidth > 50 && blockWidth < viewportWidth * 0.95) {
          // Add gap estimate (typically 20-40px)
          const estimatedGap = cssColumnGap || 20;
          const unit = blockWidth + estimatedGap;
          if (isIOS()) {
            console.log('[getMeasuredScrollUnit] Method 2 SUCCESS: First block width', {
              blockWidth,
              estimatedGap,
              unit,
            });
          }
          return { unit, source: 'first-block-width', debug };
        }
      }
    }
  } catch (err) {
    if (isIOS()) {
      console.warn('[getMeasuredScrollUnit] DOM measurement error:', err);
    }
  }

  // Method 3: scrollWidth / estimated pages
  // If content is wider than viewport, calculate page width from ratio
  if (scrollWidth > viewportWidth * 1.1) {
    // Content is multi-page - estimate single page width
    const ratio = scrollWidth / viewportWidth;
    const estimatedPages = Math.round(ratio);
    debug.estimatedPages = estimatedPages;

    if (estimatedPages > 1) {
      // Calculate single page width
      const unit = Math.floor(scrollWidth / estimatedPages);
      if (isIOS()) {
        console.log('[getMeasuredScrollUnit] Method 3 SUCCESS: scrollWidth/pages', {
          scrollWidth,
          viewportWidth,
          ratio,
          estimatedPages,
          unit,
        });
      }
      return { unit, source: 'scroll-ratio', debug };
    }
  }

  // Method 4: epub.js layout.delta (if reasonable)
  // Only use if delta is less than or equal to viewport width
  if (layout?.delta && layout.delta > 0 && layout.delta <= viewportWidth) {
    if (isIOS()) {
      console.log('[getMeasuredScrollUnit] Method 4 FALLBACK: layout.delta', {
        layoutDelta: layout.delta,
        viewportWidth,
      });
    }
    return { unit: layout.delta, source: 'layout-delta', debug };
  }

  // Method 5: epub.js layout.columnWidth + gap
  if (layout?.columnWidth && layout.columnWidth > 0 && layout.columnWidth <= viewportWidth) {
    const unit = layout.columnWidth + (layout.gap || 0);
    if (isIOS()) {
      console.log('[getMeasuredScrollUnit] Method 5 FALLBACK: layout.columnWidth', {
        columnWidth: layout.columnWidth,
        gap: layout.gap,
        unit,
      });
    }
    return { unit, source: 'layout-column-width', debug };
  }

  // Final fallback: viewport width
  if (isIOS()) {
    console.warn('[getMeasuredScrollUnit] Method 6 FINAL FALLBACK: viewportWidth', {
      viewportWidth,
      layoutDelta: layout?.delta,
      layoutColumnWidth: layout?.columnWidth,
    });
  }
  return { unit: viewportWidth, source: 'viewport-fallback', debug };
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
   * - Measures ACTUAL CSS column width from DOM instead of relying on epub.js layout.delta
   * - Fixes "1 page = 2 screens" bug where epub.js miscalculates column width on mobile
   * - Uses multi-method measurement with fallback chain for reliability
   * - Priority: CSS column-width → first block width → scrollWidth/pages → layout.delta → viewport
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

      const layout = manager.layout as EpubLayout | null;
      const viewportWidth = stage.clientWidth;
      const scrollWidthTotal = stage.scrollWidth;

      // CRITICAL FIX (January 2026):
      // Use measured CSS column width from DOM instead of epub.js layout.delta
      // This fixes the "1 page = 2 screens" bug on mobile devices
      const measured = getMeasuredScrollUnit(rendition, viewportWidth, scrollWidthTotal, layout);
      const scrollUnit = measured.unit;

      // iOS DEBUG: Log all measurement data to screen overlay
      if (isIOS()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugFn = (window as any).__iosDebug;
        if (debugFn) {
          debugFn({
            event: `directScroll:${direction}`,
            layoutDelta: layout?.delta,
            layoutDivisor: layout?.divisor,
            viewportWidth,
            scrollWidth: scrollWidthTotal,
            scrollUnit,
            measureSource: measured.source,
          });
        }
        console.log('[useEpubNavigation] iOS directScroll START:', {
          direction,
          viewportWidth,
          scrollWidth: scrollWidthTotal,
          currentScrollLeft: stage.scrollLeft,
          scrollUnit,
          measureSource: measured.source,
          measureDebug: measured.debug,
          layoutDelta: layout?.delta,
          layoutColumnWidth: layout?.columnWidth,
          layoutDivisor: layout?.divisor,
        });
      }

      const currentScroll = stage.scrollLeft;
      const maxScroll = scrollWidthTotal - viewportWidth;

      // iOS DEBUG: Log scroll calculation to overlay
      if (isIOS()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugFn = (window as any).__iosDebug;
        if (debugFn) {
          debugFn({
            event: 'scrollCalc',
            scrollUnit,
            scrollBefore: currentScroll,
            scrollWidth: scrollWidthTotal,
            measureSource: measured.source,
          });
        }
        console.log('[useEpubNavigation] iOS scroll calculation:', {
          scrollUnit,
          measureSource: measured.source,
          currentScroll,
          maxScroll,
          pagesInContent: Math.ceil(scrollWidthTotal / scrollUnit),
          currentPage: Math.floor(currentScroll / scrollUnit),
        });
      }

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

      // iOS DEBUG: Log result to overlay
      if (isIOS()) {
        const finalScroll = stage.scrollLeft;
        const pagesScrolled = Math.round((finalScroll - currentScroll) / scrollUnit);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugFn = (window as any).__iosDebug;
        if (debugFn) {
          debugFn({
            event: 'scrollResult',
            scrollBefore: currentScroll,
            scrollAfter: finalScroll,
            scrollUnit,
            pagesScrolled,
            measureSource: measured.source,
          });
        }
        console.log('[useEpubNavigation] iOS directScroll COMPLETE:', {
          expected: newScroll,
          actual: finalScroll,
          delta: finalScroll - currentScroll,
          pagesScrolled,
          measureSource: measured.source,
          success: Math.abs(finalScroll - newScroll) < 5,
        });
      }

      // Include measurement source in debug info for verification
      debugInfoRef.current = `S:${Math.round(currentScroll)}→${Math.round(newScroll)} U:${scrollUnit} [${measured.source}]${smooth ? ' smooth' : ''}`;

      return true;
    } catch (err) {
      console.warn('[useEpubNavigation] Direct scroll error:', err);
      return false;
    }
  }, [rendition]);

  const nextPage = useCallback(async () => {
    if (!rendition) return;

    // iOS DEBUG
    if (isIOS()) {
      console.log('[useEpubNavigation] nextPage() called at', new Date().toISOString());
    }

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('next', true);
      if (scrolled) {
        if (isIOS()) console.log('[useEpubNavigation] iOS: directScroll handled navigation');
        return; // Direct scroll worked
      }
      // Fall through to epub.js for chapter changes
      if (isIOS()) console.log('[useEpubNavigation] iOS: Falling through to epub.js next()');
    }

    try {
      await rendition.next();
      if (isIOS()) console.log('[useEpubNavigation] iOS: epub.js next() completed');
    } catch (err) {
      console.warn('[useEpubNavigation] Could not go to next page:', err);
    }
  }, [rendition, directScroll]);

  const prevPage = useCallback(async () => {
    if (!rendition) return;

    // iOS DEBUG
    if (isIOS()) {
      console.log('[useEpubNavigation] prevPage() called at', new Date().toISOString());
    }

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('prev', true);
      if (scrolled) {
        if (isIOS()) console.log('[useEpubNavigation] iOS: directScroll handled navigation');
        return; // Direct scroll worked
      }
      // Fall through to epub.js for chapter changes
      if (isIOS()) console.log('[useEpubNavigation] iOS: Falling through to epub.js prev()');
    }

    try {
      await rendition.prev();
      if (isIOS()) console.log('[useEpubNavigation] iOS: epub.js prev() completed');
    } catch (err) {
      console.warn('[useEpubNavigation] Could not go to prev page:', err);
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
