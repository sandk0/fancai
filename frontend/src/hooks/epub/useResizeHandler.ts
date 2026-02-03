/**
 * useResizeHandler - Handles rendition resize events
 *
 * When viewport resizes (window resize, mobile rotation, font size changes):
 * 1. Saves current CFI position before resize completes
 * 2. Waits for re-render to complete
 * 3. Restores exact reading position
 * 4. Triggers optional callback for UI updates
 *
 * Critical for:
 * - Window resize (desktop)
 * - Mobile rotation (portrait ↔ landscape)
 * - Font size changes (affects layout)
 * - Theme changes (if they affect layout)
 *
 * Performance optimizations:
 * - Uses requestAnimationFrame for smooth restoration
 * - Debounces rapid resize events (100ms)
 * - Minimal state updates
 * - Proper cleanup to prevent memory leaks
 *
 * @param rendition - epub.js Rendition instance
 * @param onResized - Optional callback with new dimensions
 * @param enabled - Whether resize handling is enabled (default: true)
 *
 * @example
 * useResizeHandler({
 *   rendition,
 *   onResized: (dimensions) => {
 *     logger.debug('New size:', dimensions);
 *     updateUI();
 *   },
 *   enabled: true,
 * });
 */

import { useEffect, useRef } from 'react';
import type { Rendition } from '@/types/epub';

interface UseResizeHandlerOptions {
  rendition: Rendition | null;
  onResized?: (dimensions: { width: number; height: number }) => void;
  enabled?: boolean;
}

/**
 * Debounce helper for rapid resize events
 */
const debounce = <T extends (...args: any[]) => void>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  };
};

export const useResizeHandler = ({
  rendition,
  onResized,
  enabled = true,
}: UseResizeHandlerOptions): void => {
  const lastCFI = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if (!rendition || !enabled) {
      return;
    }

    /**
     * Handle resize event with position preservation
     */
    const handleResized = (dimensions: { width: number; height: number }) => {
      // Prevent concurrent restoration
      if (isRestoringRef.current) {
        return;
      }

      // Save current position BEFORE resize affects layout
      const currentLocation = rendition.currentLocation();
      if (currentLocation?.start?.cfi) {
        lastCFI.current = currentLocation.start.cfi;
      }

      // Call optional callback (e.g., update UI state)
      if (onResized) {
        onResized(dimensions);
      }

      // Restore position after resize completes
      // Use requestAnimationFrame for smooth rendering
      isRestoringRef.current = true;

      requestAnimationFrame(() => {
        // Give epub.js time to re-render
        setTimeout(() => {
          if (lastCFI.current) {
            rendition
              .display(lastCFI.current)
              .catch((_err) => {
                // Position restoration failed - continue without it
              })
              .finally(() => {
                isRestoringRef.current = false;
              });
          } else {
            isRestoringRef.current = false;
          }
        }, 100);
      });
    };

    // Debounce to handle rapid resize events (e.g., dragging window edge)
    const debouncedHandleResized = debounce(handleResized, 100);

    rendition.on('resized', debouncedHandleResized as (...args: unknown[]) => void);

    return () => {
      rendition.off('resized', debouncedHandleResized as (...args: unknown[]) => void);
    };
  }, [rendition, enabled, onResized]);
};
