import { useState, useCallback } from 'react';

/**
 * useAutoHideUI - Header auto-hide with immersive mode
 *
 * Manages header visibility for immersive reading experience:
 * - Default hidden (immersive mode) on book open
 * - Hides instantly on swipe start (>10px movement)
 * - Hides on edge-tap navigation
 * - Shows/toggles on center tap
 *
 * Uses simple useState (not Zustand) -- visibility is local to Reader.
 *
 * @module hooks/reader/useAutoHideUI
 */

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
}

export const useAutoHideUI = (options?: AutoHideOptions): AutoHideReturn => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(options?.initialVisible ?? false);

  const showUI = useCallback(() => {
    setIsHeaderVisible(true);
  }, []);

  const hideUI = useCallback(() => {
    setIsHeaderVisible(false);
  }, []);

  const toggleUI = useCallback(() => {
    setIsHeaderVisible((prev) => !prev);
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
  };
};
