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
import { isAndroid } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';

// Android selection handles (carets) extend below the selection rect by ~24px
const ANDROID_CARET_OFFSET = 24;

export interface Selection {
  text: string;
  cfiRange: string;
  position: { x: number; y: number; bottom: number };
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

        // Reject selection that extends beyond current page (paginated mode).
        // In CSS-column layout, documentElement.clientWidth returns total width of ALL columns
        // (e.g. 8610px for 21 pages), not one page. Use epub.js layout.columnWidth instead.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mgr = (rendition as any).manager;
        const columnWidth = mgr?.layout?.columnWidth as number | undefined;
        const pageWidth = columnWidth || contents.document.body.clientWidth;
        const crossesPage = rect.left < -5 || rect.right > pageWidth + 5;
        logger.debug('[useTextSelection] Selection rect analysis', {
          rectLeft: Math.round(rect.left),
          rectRight: Math.round(rect.right),
          rectWidth: Math.round(rect.width),
          pageWidth,
          docClientWidth: contents.document.documentElement.clientWidth,
          bodyClientWidth: contents.document.body.clientWidth,
          layoutColumnWidth: columnWidth,
          crossesPage,
          selectedText: selectedText.slice(0, 50),
        });
        if (pageWidth > 0 && crossesPage) {
          logger.debug('[useTextSelection] Selection crosses page boundary, clearing');
          windowSelection?.removeAllRanges();
          setSelection(null);
          return;
        }

        const iframeRect = iframe.getBoundingClientRect();

        const caretOffset = isAndroid() ? ANDROID_CARET_OFFSET : 0;
        const absolutePosition = {
          x: iframeRect.left + rect.left + rect.width / 2,
          y: iframeRect.top + rect.top,
          bottom: iframeRect.top + rect.bottom + caretOffset,
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

    // Realtime selectionchange listener: clamp selection to current page boundary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgrRef = (rendition as any).manager;
    const selectionChangeHandler = () => {
      const contentsList = rendition.getContents();
      if (!contentsList?.length) return;
      const c = contentsList[0] as Contents;
      const sel = c.window?.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const colW = (mgrRef?.layout?.columnWidth as number) || c.document.body.clientWidth;
      if (r.right > colW + 5 || r.left < -5) {
        logger.debug('[useTextSelection] REALTIME cross-page detected, clearing', {
          left: Math.round(r.left),
          right: Math.round(r.right),
          pageWidth: colW,
        });
        sel.removeAllRanges();
      }
    };

    // Attach selectionchange to current iframe document
    const currentContents = rendition.getContents();
    const iframeDoc = currentContents?.[0] ? (currentContents[0] as Contents).document : null;
    iframeDoc?.addEventListener('selectionchange', selectionChangeHandler);

    return () => {
      // Cleanup event listeners
      rendition.off('selected', handleSelected as (...args: unknown[]) => void);
      rendition.off('markClicked', handleMarkClicked);
      rendition.off('click', handleClick);
      iframeDoc?.removeEventListener('selectionchange', selectionChangeHandler);
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
