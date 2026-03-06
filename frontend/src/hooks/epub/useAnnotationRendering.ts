/**
 * useAnnotationRendering - Restores visual highlights in epub.js
 *
 * Listens to rendition 'rendered' event and re-applies highlight annotations
 * for the current chapter using rendition.annotations.highlight().
 *
 * Features:
 * - Restores highlights when navigating between chapters
 * - Click on highlight shows popup with note + delete option
 * - Injects CSS styles for .user-highlight into epub content
 *
 * @param rendition - epub.js Rendition instance
 * @param bookId - Current book ID
 * @param currentChapter - Current chapter number
 */

import { useEffect, useCallback, useState } from 'react';
import { useHighlights } from '@/hooks/api/useSync';
import type { Rendition } from '@/types/epub';
import { logger } from '@/lib/logger';

interface UseAnnotationRenderingOptions {
  rendition: Rendition | null;
  bookId: string;
  currentChapter: number;
  enabled?: boolean;
}

interface HighlightPopup {
  highlightId: string;
  cfiRange: string;
  note: string | null;
  color: string;
  position: { x: number; y: number };
}

const HIGHLIGHT_CSS = `
  .user-highlight {
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .user-highlight:hover {
    opacity: 0.8;
  }
`;

export function useAnnotationRendering({
  rendition,
  bookId,
  currentChapter,
  enabled = true,
}: UseAnnotationRenderingOptions) {
  const { data: highlights = [] } = useHighlights(bookId);
  const [highlightPopup, setHighlightPopup] = useState<HighlightPopup | null>(null);

  const closePopup = useCallback(() => {
    setHighlightPopup(null);
  }, []);

  // Inject CSS styles for highlights into epub content
  useEffect(() => {
    if (!rendition || !enabled) return;

    const injectStyles = (contents: unknown) => {
      try {
        const c = contents as { document: Document };
        if (!c.document) return;

        const existing = c.document.getElementById('user-highlight-styles');
        if (existing) return;

        const style = c.document.createElement('style');
        style.id = 'user-highlight-styles';
        style.textContent = HIGHLIGHT_CSS;
        c.document.head.appendChild(style);
      } catch (err) {
        logger.error('[useAnnotationRendering] Failed to inject styles:', err);
      }
    };

    rendition.hooks.content.register(injectStyles);

    // Inject into already-rendered content
    const contents = rendition.getContents();
    contents.forEach(injectStyles);

    return () => {
      rendition.hooks.content.deregister(injectStyles);
    };
  }, [rendition, enabled]);

  // Restore highlight annotations when chapter renders
  useEffect(() => {
    if (!rendition || !enabled || !highlights.length) return;

    const chapterHighlights = highlights.filter((h) => h.chapter_number === currentChapter);

    if (!chapterHighlights.length) return;

    const applyHighlights = () => {
      for (const h of chapterHighlights) {
        try {
          rendition.annotations.highlight(
            h.cfi_range,
            { id: h.id, note: h.note, color: h.color },
            () => {
              // Click callback - get position from current contents
              try {
                const contents = rendition.getContents();
                if (!contents.length) return;

                const range = rendition.getRange(h.cfi_range);
                if (!range) return;

                const rect = range.getBoundingClientRect();
                const iframe = contents[0].document.defaultView
                  ?.frameElement as HTMLIFrameElement | null;
                const iframeRect = iframe?.getBoundingClientRect();

                const position = {
                  x: (iframeRect?.left || 0) + rect.left + rect.width / 2,
                  y: (iframeRect?.top || 0) + rect.top,
                };

                setHighlightPopup({
                  highlightId: h.id,
                  cfiRange: h.cfi_range,
                  note: h.note,
                  color: h.color,
                  position,
                });
              } catch (err) {
                logger.error('[useAnnotationRendering] Failed to show popup:', err);
              }
            },
            'user-highlight',
            { fill: h.color, 'fill-opacity': '0.3' }
          );
        } catch (err) {
          logger.error('[useAnnotationRendering] Failed to apply highlight:', err);
        }
      }
    };

    // Apply immediately for current content
    applyHighlights();

    // Also re-apply on rendered event (chapter navigation)
    const handleRendered = () => {
      // Small delay to ensure DOM is ready
      setTimeout(applyHighlights, 100);
    };

    rendition.on('rendered', handleRendered as (...args: unknown[]) => void);

    return () => {
      rendition.off('rendered', handleRendered as (...args: unknown[]) => void);
    };
  }, [rendition, enabled, highlights, currentChapter]);

  return {
    highlightPopup,
    closePopup,
  };
}
