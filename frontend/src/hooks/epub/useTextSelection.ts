/**
 * useTextSelection - Handles text selection in EPUB
 *
 * Listens to rendition.on('selected') event from epub.js
 * Provides selected text, CFI range, and position for popup menu
 *
 * Features:
 * - Captures text selection from epub.js
 * - Extracts CFI range for future highlights
 * - Calculates position for popup menu
 * - Clears selection programmatically
 *
 * @param rendition - epub.js Rendition instance
 * @param enabled - Whether selection is enabled (default: true)
 * @returns Selection state and control functions
 *
 * @example
 * const { selection, clearSelection } = useTextSelection(rendition);
 * if (selection) {
 *   logger.debug('Selected text:', selection.text);
 *   logger.debug('CFI range:', selection.cfiRange);
 * }
 */

import { useEffect, useState, useCallback } from 'react';
import type { Rendition, Contents } from '@/types/epub';
import { logger } from '@/lib/logger';

export interface Selection {
  text: string;
  cfiRange: string;
  position: { x: number; y: number };
}

interface UseTextSelectionReturn {
  selection: Selection | null;
  clearSelection: () => void;
}

export const useTextSelection = (
  rendition: Rendition | null,
  enabled: boolean = true
): UseTextSelectionReturn => {
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!rendition || !enabled) {
      return;
    }

    /**
     * Handle 'selected' event from epub.js
     * This fires when user selects text in the EPUB viewer
     */
    const handleSelected = (cfiRange: string, contents: Contents) => {
      try {
        // Get selected text from the iframe window
        const windowSelection = contents.window.getSelection();
        const selectedText = windowSelection?.toString() || '';

        if (!selectedText.trim()) {
          setSelection(null);
          return;
        }

        // Get position for popup menu
        const range = windowSelection?.getRangeAt(0);
        if (!range) {
          setSelection(null);
          return;
        }

        const rect = range.getBoundingClientRect();

        // Get iframe position to calculate absolute coordinates
        const iframe = contents.document.defaultView?.frameElement as HTMLIFrameElement | null;
        if (!iframe) {
          setSelection(null);
          return;
        }
        const iframeRect = iframe.getBoundingClientRect();

        const absolutePosition = {
          x: iframeRect.left + rect.left,
          y: iframeRect.top + rect.top,
        };

        setSelection({
          text: selectedText,
          cfiRange,
          position: absolutePosition,
        });
      } catch (err) {
        logger.error('[useTextSelection] Error handling selection:', err);
      }
    };

    /**
     * Handle 'markClicked' event to clear selection when clicking annotation
     * This prevents conflicts with existing highlights
     */
    const handleMarkClicked = () => {
      setSelection(null);
    };

    /**
     * Handle click on page to clear selection when clicking outside selected text
     * This ensures menu closes when user clicks anywhere on the page
     */
    const handleClick = () => {
      // Add small delay to let 'selected' event fire first if user is selecting
      setTimeout(() => {
        const contents = rendition.getContents()[0];
        if (!contents) return;

        const windowSelection = contents.window?.getSelection();
        const hasSelection = windowSelection && windowSelection.toString().trim().length > 0;

        if (!hasSelection) {
          setSelection(null);
        }
      }, 50);
    };

    // Register event listeners
    rendition.on('selected', handleSelected as (...args: unknown[]) => void);
    rendition.on('markClicked', handleMarkClicked);
    rendition.on('click', handleClick);

    return () => {
      // Cleanup event listeners
      rendition.off('selected', handleSelected as (...args: unknown[]) => void);
      rendition.off('markClicked', handleMarkClicked);
      rendition.off('click', handleClick);
    };
  }, [rendition, enabled]);

  /**
   * Clear selection programmatically
   * Call this when closing the selection menu
   */
  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  return { selection, clearSelection };
};
