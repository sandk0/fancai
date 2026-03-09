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
 * Serialized scroll (March 2026):
 * - directScroll() calls are serialized via Promise chain (scrollChainRef)
 * - Prevents race conditions when rapid gestures fire multiple navigations
 *
 * @param rendition - epub.js Rendition instance
 * @returns Navigation functions
 *
 * @example
 * const { nextPage, prevPage, canGoNext, canGoPrev } = useEpubNavigation(rendition);
 */

import { useCallback, useRef, useState } from 'react';
import type { Rendition } from '@/types/epub';
import { isIOS, isAndroid } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';

interface EpubLayout {
  delta?: number;
  columnWidth?: number;
  gap?: number;
  divisor?: number;
  pageWidth?: number;
}

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
        return { unit, source: 'css-column-width', debug };
      }

      // Method 2: Measure first block element width
      // Works when CSS columns render elements at specific widths
      const firstBlock = body.querySelector(
        'p, div, section, article, h1, h2, h3'
      ) as HTMLElement | null;
      if (firstBlock) {
        const blockRect = firstBlock.getBoundingClientRect();
        const blockWidth = blockRect.width;
        debug.firstBlockWidth = blockWidth;

        // Valid if block is narrower than viewport (indicates column layout)
        if (blockWidth > 50 && blockWidth < viewportWidth * 0.95) {
          // Add gap estimate (typically 20-40px)
          const estimatedGap = cssColumnGap || 20;
          const unit = blockWidth + estimatedGap;
          return { unit, source: 'first-block-width', debug };
        }
      }
    }
  } catch (err) {
    logger.warn('[getMeasuredScrollUnit] DOM measurement error:', err);
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
      return { unit, source: 'scroll-ratio', debug };
    }
  }

  // Method 4: epub.js layout.delta (if reasonable)
  // Only use if delta is less than or equal to viewport width
  if (layout?.delta && layout.delta > 0 && layout.delta <= viewportWidth) {
    return { unit: layout.delta, source: 'layout-delta', debug };
  }

  // Method 5: epub.js layout.columnWidth + gap
  if (layout?.columnWidth && layout.columnWidth > 0 && layout.columnWidth <= viewportWidth) {
    const unit = layout.columnWidth + (layout.gap || 0);
    return { unit, source: 'layout-column-width', debug };
  }

  // Final fallback: viewport width
  logger.warn('[getMeasuredScrollUnit] FINAL FALLBACK: viewportWidth', {
    viewportWidth,
    layoutDelta: layout?.delta,
    layoutColumnWidth: layout?.columnWidth,
  });
  return { unit: viewportWidth, source: 'viewport-fallback', debug };
};

interface UseEpubNavigationReturn {
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  canGoNext: boolean;
  canGoPrev: boolean;
  debugInfo: string | null;
}

export const useEpubNavigation = (rendition: Rendition | null): UseEpubNavigationReturn => {
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  // Promise chain for serializing directScroll calls
  const scrollChainRef = useRef<Promise<boolean>>(Promise.resolve(true));

  /**
   * Mobile FIX: Direct scroll navigation bypassing epub.js
   * epub.js navigation is broken on iOS PWA - scrolls multiple pages
   * We directly manipulate the scroll position instead
   *
   * CRITICAL FIX (January 2026):
   * - Measures ACTUAL CSS column width from DOM instead of relying on epub.js layout.delta
   * - Fixes "1 page = 2 screens" bug where epub.js miscalculates column width on mobile
   * - Uses multi-method measurement with fallback chain for reliability
   * - Priority: CSS column-width -> first block width -> scrollWidth/pages -> layout.delta -> viewport
   *
   * Serialized (March 2026):
   * - Each call chains onto scrollChainRef, ensuring previous scroll completes before next starts
   */
  const directScroll = useCallback(
    (direction: 'next' | 'prev', smooth = true): Promise<boolean> => {
      const task = scrollChainRef.current.then(async () => {
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
          const measured = getMeasuredScrollUnit(
            rendition,
            viewportWidth,
            scrollWidthTotal,
            layout
          );
          const scrollUnit = measured.unit;

          const currentScroll = stage.scrollLeft;
          const maxScroll = scrollWidthTotal - viewportWidth;

          let newScroll: number;
          if (direction === 'next') {
            newScroll = Math.min(currentScroll + scrollUnit, maxScroll);
          } else {
            newScroll = Math.max(currentScroll - scrollUnit, 0);
          }

          // Check if we can scroll (not at boundary)
          if (direction === 'next' && currentScroll >= maxScroll - 1) {
            // At end - let epub.js handle chapter change
            setDebugInfo(`END S:${Math.round(currentScroll)}`);
            return false;
          }
          if (direction === 'prev' && currentScroll <= 0) {
            // At start - let epub.js handle chapter change
            setDebugInfo(`START S:${Math.round(currentScroll)}`);
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
            stage.scrollTo({ left: newScroll, behavior: 'instant' });
          }

          // Include measurement source in debug info for verification
          setDebugInfo(
            `S:${Math.round(currentScroll)}->${Math.round(newScroll)} U:${scrollUnit} [${measured.source}]${smooth ? ' smooth' : ''}`
          );

          return true;
        } catch (err) {
          logger.warn('[useEpubNavigation] Direct scroll error:', err);
          return false;
        }
      });

      // Chain: don't break the chain on error
      scrollChainRef.current = task.catch(() => false);
      return task;
    },
    [rendition]
  );

  const nextPage = useCallback(async () => {
    if (!rendition) return;

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('next', true);
      if (scrolled) {
        return; // Direct scroll worked
      }
      // Fall through to epub.js for chapter changes
    }

    try {
      await rendition.next();
    } catch (err) {
      logger.warn('[useEpubNavigation] Could not go to next page:', err);
    }
  }, [rendition, directScroll]);

  const prevPage = useCallback(async () => {
    if (!rendition) return;

    // On mobile (iOS/Android), try direct scroll with smooth animation first
    if (isIOS() || isAndroid()) {
      const scrolled = await directScroll('prev', true);
      if (scrolled) {
        return; // Direct scroll worked
      }
      // Fall through to epub.js for chapter changes
    }

    try {
      await rendition.prev();
    } catch (err) {
      logger.warn('[useEpubNavigation] Could not go to prev page:', err);
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
    debugInfo,
  };
};
