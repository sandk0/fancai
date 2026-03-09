import { useState, useCallback } from 'react';
import { isStandalone } from '@/utils/iosSupport';

/**
 * useAutoHideUI - Header auto-hide with immersive mode
 *
 * Manages header visibility for immersive reading experience:
 * - Default hidden (immersive mode) on book open
 * - Hides instantly on swipe start (>10px movement)
 * - Hides on edge-tap navigation
 * - Shows/toggles on center tap
 * - Shows standalone hint on first open in PWA mode
 *
 * Uses simple useState (not Zustand) -- visibility is local to Reader.
 *
 * @module hooks/reader/useAutoHideUI
 */

const STANDALONE_HINT_KEY = 'reader_standalone_hint_dismissed';

export interface AutoHideOptions {
  /** Initial visibility state. Default: false (immersive mode) */
  initialVisible?: boolean;
}

export interface AutoHideReturn {
  /** Whether the header is currently visible */
  isHeaderVisible: boolean;
  /** Show the header */
  showUI: () => void;
  /** Hide the header */
  hideUI: () => void;
  /** Toggle header visibility */
  toggleUI: () => void;
  /** Called when swipe starts (>10px) -- instantly hides */
  onSwipeStart: () => void;
  /** Called on edge-tap navigation -- hides header */
  onTapNavigate: () => void;
  /** Show center-tap hint in standalone mode (first open only) */
  showStandaloneHint: boolean;
  /** Dismiss the standalone hint (called after tap or auto-dismiss) */
  dismissStandaloneHint: () => void;
}

export const useAutoHideUI = (options?: AutoHideOptions): AutoHideReturn => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(options?.initialVisible ?? false);

  // Standalone hint: show only in standalone mode when not previously dismissed
  const [showStandaloneHint, setShowStandaloneHint] = useState(() => {
    if (!isStandalone()) return false;
    try {
      return localStorage.getItem(STANDALONE_HINT_KEY) !== 'true';
    } catch {
      return false;
    }
  });

  const dismissStandaloneHint = useCallback(() => {
    setShowStandaloneHint(false);
    try {
      localStorage.setItem(STANDALONE_HINT_KEY, 'true');
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  const showUI = useCallback(() => {
    setIsHeaderVisible(true);
  }, []);

  const hideUI = useCallback(() => {
    setIsHeaderVisible(false);
  }, []);

  const toggleUI = useCallback(() => {
    setIsHeaderVisible((prev) => !prev);
    // First center-tap dismisses the standalone hint
    setShowStandaloneHint((prev) => {
      if (prev) {
        try {
          localStorage.setItem(STANDALONE_HINT_KEY, 'true');
        } catch {
          // localStorage may be unavailable
        }
      }
      return false;
    });
  }, []);

  // Swipe start -> instantly hide
  const onSwipeStart = useCallback(() => {
    setIsHeaderVisible(false);
  }, []);

  // Edge-tap navigation -> hide
  const onTapNavigate = useCallback(() => {
    setIsHeaderVisible(false);
  }, []);

  return {
    isHeaderVisible,
    showUI,
    hideUI,
    toggleUI,
    onSwipeStart,
    onTapNavigate,
    showStandaloneHint,
    dismissStandaloneHint,
  };
};
