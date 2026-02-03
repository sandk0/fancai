/**
 * useKeyboardNavigation - Shared keyboard shortcuts for navigation
 *
 * Provides keyboard navigation with support for both window and iframe contexts.
 * Handles ArrowLeft, ArrowRight, ArrowUp, ArrowDown, and Space keys.
 *
 * @param options - Navigation options
 * @param options.onNext - Function to go to next page
 * @param options.onPrev - Function to go to previous page
 * @param options.enabled - Whether keyboard navigation is enabled (default: true)
 * @param options.rendition - Optional epub.js Rendition for iframe keyboard events
 *
 * @example
 * // Simple usage (BookReader)
 * useKeyboardNavigation({ onNext: nextPage, onPrev: prevPage });
 *
 * @example
 * // With epub.js iframe support (EpubReader)
 * useKeyboardNavigation({
 *   onNext: nextPage,
 *   onPrev: prevPage,
 *   enabled: renditionReady && !isModalOpen,
 *   rendition
 * });
 */

import { useEffect } from 'react';
import type { Rendition } from '@/types/epub';

interface UseKeyboardNavigationOptions {
  onNext: () => void;
  onPrev: () => void;
  enabled?: boolean;
  rendition?: Rendition | null;
}

export const useKeyboardNavigation = ({
  onNext,
  onPrev,
  enabled = true,
  rendition,
}: UseKeyboardNavigationOptions): void => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          onPrev();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
          e.preventDefault();
          onNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    const attachToIframe = () => {
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.addEventListener('keydown', handleKeyPress);
      }
    };

    rendition?.on('rendered', attachToIframe);
    attachToIframe();

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      rendition?.off('rendered', attachToIframe);
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [onNext, onPrev, enabled, rendition]);
};
