import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Viewport state returned by useVisualViewportHandler
 */
export interface ViewportState {
  /** Whether the virtual keyboard is currently visible */
  isKeyboardVisible: boolean;
  /** Height of the keyboard in pixels (0 when hidden) */
  keyboardHeight: number;
  /** Current viewport offset from top (scrolled by keyboard) */
  viewportOffset: number;
  /** Current visual viewport height */
  viewportHeight: number;
}

const KEYBOARD_THRESHOLD = 150; // px — height drop > 150px = keyboard (not address bar ~50-70px)

/**
 * useVisualViewportHandler - Tracks iOS virtual keyboard via VisualViewport API
 *
 * On iOS Safari, the virtual keyboard pushes fixed-positioned elements.
 * This hook detects keyboard appearance/disappearance by comparing
 * the current visual viewport height with the initial height.
 *
 * Sets CSS variable `--keyboard-height` on document.documentElement
 * for use in CSS calc() expressions.
 *
 * IMPORTANT:
 * - Does NOT use `interactive-widget` meta (not supported in Safari/WebKit)
 * - Does NOT listen to `window.resize` (doesn't fire for keyboard on iOS Safari)
 * - Uses `initialHeight - visualViewport.height`, NOT `visualViewport.offsetTop` (iOS 18+ bug)
 *
 * @returns ViewportState with keyboard visibility and dimensions
 */
export const useVisualViewportHandler = (): ViewportState => {
  const [state, setState] = useState<ViewportState>({
    isKeyboardVisible: false,
    keyboardHeight: 0,
    viewportOffset: 0,
    viewportHeight: 0,
  });

  const initialHeightRef = useRef<number>(0);

  const handleViewportChange = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const currentHeight = vv.height;
    const heightDiff = initialHeightRef.current - currentHeight;
    const isKeyboard = heightDiff > KEYBOARD_THRESHOLD;

    const keyboardHeight = isKeyboard ? heightDiff : 0;

    setState({
      isKeyboardVisible: isKeyboard,
      keyboardHeight,
      viewportOffset: vv.offsetTop,
      viewportHeight: currentHeight,
    });

    // Update CSS variable
    if (isKeyboard) {
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    } else {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    }
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Store initial height (full screen without keyboard)
    initialHeightRef.current = vv.height;

    vv.addEventListener('resize', handleViewportChange);
    vv.addEventListener('scroll', handleViewportChange);

    return () => {
      vv.removeEventListener('resize', handleViewportChange);
      vv.removeEventListener('scroll', handleViewportChange);
      document.documentElement.style.removeProperty('--keyboard-height');
    };
  }, [handleViewportChange]);

  return state;
};
