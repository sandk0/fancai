/**
 * useGestureController - Unified gesture controller for EPUB reader
 *
 * Replaces three parallel gesture systems:
 * - useFollowFingerSwipe (swipe navigation with follow-finger)
 * - useTouchNavigation (tap navigation via iframe for Android/desktop)
 * - IOSTapZones (tap navigation overlay for iOS)
 *
 * Architecture: Coordinator with FSM
 * - FSM states: idle -> pending -> swiping | tap | cancelled
 * - All touch state is ref-based (no re-renders on touchmove)
 * - Reuses exported utilities from useFollowFingerSwipe
 * - Hybrid iOS/Android: swipe via iframe hooks.content.register(),
 *   taps via iframe on Android/desktop, overlay on iOS for center-tap
 *
 * @module hooks/epub/useGestureController
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useMotionValue, animate } from 'motion/react';
import type { MotionValue } from 'motion/react';
import type { Rendition, Contents } from '@/types/epub';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';
import { isIOS } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';
import {
  FOLLOW_FINGER_CONFIG,
  SPRING_FAST,
  SPRING_RUBBER,
  getStageInfo,
  shouldNavigate,
  calculateVelocity,
  getRubberBandOffset,
  getSpringConfig,
} from './useFollowFingerSwipe';
import type { FollowFingerPhase } from './useFollowFingerSwipe';

// ---------------------------------------------------------------------------
// FSM types
// ---------------------------------------------------------------------------

type GestureState = 'idle' | 'pending' | 'swiping' | 'cancelled';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TAP_MAX_DURATION = 350; // ms
const TAP_MAX_MOVEMENT = 20; // px
const LONG_PRESS_TIMEOUT = 350; // ms -- after this, release without action = long-press

// Tap zone boundaries (fraction of viewport width)
const EDGE_ZONE_IFRAME = 0.25; // 25% edges for iframe-based taps (Android/desktop)
const EDGE_ZONE_IOS = 0.15; // 15% edges for iOS overlay

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface GestureControllerOptions {
  rendition: Rendition | null;
  enabled: boolean;
  /** Navigate within chapter (page turn) */
  onNavigate: (dir: 'next' | 'prev') => Promise<void>;
  /** Navigate between chapters (at boundary) */
  onChapterChange?: (dir: 'next' | 'prev') => Promise<void>;
  /** Edge tap navigation callback */
  onEdgeTap: (dir: 'next' | 'prev') => void;
  /** Center tap callback (coordinates relative to iframe for description detection) */
  onCenterTap: (x: number, y: number) => void;
  /** Toggle UI visibility (header show/hide) */
  onToggleUI: () => void;
  /** Called when swipe starts (>10px) for auto-hide */
  onSwipeStart: () => void;
  /** Called on tap navigation for auto-hide */
  onTapNavigate: () => void;
  /** Shared navigation lock */
  navLock: NavigationLock;
  /** Whether any panel (drawer, settings, TOC) is open */
  isPanelOpen: boolean;
}

export interface GestureControllerReturn {
  /** Motion value for follow-finger transform */
  translateX: MotionValue<number>;
  /** Current visual phase (for FollowFingerContainer) */
  phase: FollowFingerPhase;
  /** Boundary state for rubber-band */
  isAtBoundary: 'start' | 'end' | null;
  /** Whether chapter hint should be shown */
  showChapterHint: boolean;
  /** Direction of chapter hint */
  chapterHintDirection: 'next' | 'prev' | null;
  /** Trigger slide-in animation for tap navigation */
  triggerSlideAnimation: (direction: 'next' | 'prev') => void;
}

// ---------------------------------------------------------------------------
// Internal touch state (ref-based, no re-renders)
// ---------------------------------------------------------------------------

interface TouchState {
  state: GestureState;
  startX: number;
  startY: number;
  startTime: number;
  lastTouchX: number;
  lastTouchTime: number;
  boundary: 'start' | 'end' | null;
}

const INITIAL_TOUCH: TouchState = {
  state: 'idle',
  startX: 0,
  startY: 0,
  startTime: 0,
  lastTouchX: 0,
  lastTouchTime: 0,
  boundary: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useGestureController = (
  options: GestureControllerOptions
): GestureControllerReturn => {
  const {
    rendition,
    enabled,
    onNavigate,
    onChapterChange,
    onEdgeTap,
    onCenterTap,
    onToggleUI,
    onSwipeStart,
    onTapNavigate,
    navLock,
    isPanelOpen,
  } = options;

  // Motion value for GPU-accelerated transform
  const translateX = useMotionValue(0);

  // Minimal state for rendering
  const [phase, setPhase] = useState<FollowFingerPhase>('idle');
  const [isAtBoundary, setIsAtBoundary] = useState<'start' | 'end' | null>(null);
  const [showChapterHint, setShowChapterHint] = useState(false);
  const [chapterHintDirection, setChapterHintDirection] = useState<'next' | 'prev' | null>(null);

  // Refs for touch state and callbacks
  const touchRef = useRef<TouchState>({ ...INITIAL_TOUCH });
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const enabledRef = useRef(enabled);
  const isPanelOpenRef = useRef(isPanelOpen);
  const onNavigateRef = useRef(onNavigate);
  const onChapterChangeRef = useRef(onChapterChange);
  const onEdgeTapRef = useRef(onEdgeTap);
  const onCenterTapRef = useRef(onCenterTap);
  const onToggleUIRef = useRef(onToggleUI);
  const onSwipeStartRef = useRef(onSwipeStart);
  const onTapNavigateRef = useRef(onTapNavigate);
  const navLockRef = useRef(navLock);

  // Pending nav ref for guaranteed-last pattern
  const pendingNavRef = useRef<'next' | 'prev' | null>(null);

  // Keep refs in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    isPanelOpenRef.current = isPanelOpen;
  }, [isPanelOpen]);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  useEffect(() => {
    onChapterChangeRef.current = onChapterChange;
  }, [onChapterChange]);
  useEffect(() => {
    onEdgeTapRef.current = onEdgeTap;
  }, [onEdgeTap]);
  useEffect(() => {
    onCenterTapRef.current = onCenterTap;
  }, [onCenterTap]);
  useEffect(() => {
    onToggleUIRef.current = onToggleUI;
  }, [onToggleUI]);
  useEffect(() => {
    onSwipeStartRef.current = onSwipeStart;
  }, [onSwipeStart]);
  useEffect(() => {
    onTapNavigateRef.current = onTapNavigate;
  }, [onTapNavigate]);
  useEffect(() => {
    navLockRef.current = navLock;
  }, [navLock]);

  // Stable reset
  const resetState = useCallback(() => {
    touchRef.current = { ...INITIAL_TOUCH };
    setPhase('idle');
    setIsAtBoundary(null);
    setShowChapterHint(false);
    setChapterHintDirection(null);
  }, []);

  // -------------------------------------------------------------------------
  // Navigation with guaranteed-last pattern (from IOSTapZones)
  // -------------------------------------------------------------------------
  const handleTapNavigation = useCallback(async (action: 'next' | 'prev') => {
    if (!navLockRef.current.acquire()) {
      // Lock held -- store last tap (guaranteed-last)
      pendingNavRef.current = action;
      return;
    }

    try {
      if (action === 'prev') {
        await onNavigateRef.current('prev');
      } else {
        await onNavigateRef.current('next');
      }
    } finally {
      navLockRef.current.release();
      // Execute pending tap if any
      const pending = pendingNavRef.current;
      pendingNavRef.current = null;
      if (pending) {
        handleTapNavigation(pending);
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Get iframe offset for coordinate conversion
  // -------------------------------------------------------------------------
  const getIframeOffset = useCallback((contents: Contents): number => {
    try {
      const iframeWindow = contents.window;
      if (iframeWindow && iframeWindow.frameElement) {
        const rect = (iframeWindow.frameElement as HTMLElement).getBoundingClientRect();
        return rect.left;
      }
    } catch {
      // Ignore
    }
    return 0;
  }, []);

  // -------------------------------------------------------------------------
  // Determine tap zone from screen X position
  // -------------------------------------------------------------------------
  const getTapAction = useCallback(
    (screenX: number, isIOSOverlay: boolean): 'prev' | 'next' | 'center' => {
      const screenWidth = window.innerWidth;
      const edgeZone = isIOSOverlay ? EDGE_ZONE_IOS : EDGE_ZONE_IFRAME;
      const leftThreshold = screenWidth * edgeZone;
      const rightThreshold = screenWidth * (1 - edgeZone);

      if (screenX < leftThreshold) return 'prev';
      if (screenX > rightThreshold) return 'next';
      return 'center';
    },
    []
  );

  // -------------------------------------------------------------------------
  // Check if target is interactive (description highlight, link, button)
  // -------------------------------------------------------------------------
  const isInteractiveElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (
      target.classList?.contains('description-highlight') ||
      target.closest?.('.description-highlight')
    )
      return true;
    if (target.tagName === 'A' || target.closest?.('a')) return true;
    if (target.tagName === 'BUTTON' || target.closest?.('button')) return true;
    return false;
  }, []);

  // -------------------------------------------------------------------------
  // Main effect: bind touch events to iframe via hooks.content.register
  // Handles BOTH swipe and tap detection through unified FSM
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!rendition) return;

    const contentHook = (contents: Contents) => {
      const doc = contents.document;
      if (!doc) return;

      // iOS Safari fix: cursor:pointer for click delegation
      const body = doc.body;
      if (body) {
        body.style.cursor = 'pointer';
      }

      // ----- touchstart -----
      const handleTouchStart = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        // Don't start if there's active text selection
        const sel = doc.defaultView?.getSelection?.();
        if (sel && sel.toString().length > 0) return;

        const touch = e.touches[0];
        if (!touch) return;

        // Stop running animation
        if (animationRef.current) {
          animationRef.current.stop();
          animationRef.current = null;
        }

        // Check boundary for rubber-band
        const info = getStageInfo(rendition);
        const boundary = info
          ? info.isAtStart && info.isAtEnd
            ? null // Single-page chapter
            : info.isAtStart
              ? 'start'
              : info.isAtEnd
                ? 'end'
                : null
          : null;

        const now = Date.now();
        touchRef.current = {
          state: 'pending',
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: now,
          lastTouchX: touch.clientX,
          lastTouchTime: now,
          boundary,
        };
      };

      // ----- touchmove -----
      const handleTouchMove = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        const t = touchRef.current;
        if (t.state !== 'pending' && t.state !== 'swiping') return;

        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - t.startX;
        const deltaY = touch.clientY - t.startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        // Vertical scroll detection -- cancel
        if (
          absDeltaY > FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold &&
          absDeltaY / Math.max(absDeltaX, 1) > FOLLOW_FINGER_CONFIG.maxVerticalRatio
        ) {
          if (t.state === 'swiping') {
            translateX.set(0);
            resetState();
          }
          touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
          return;
        }

        // Not enough horizontal movement yet -- wait
        if (t.state === 'pending' && absDeltaX <= FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold) {
          return;
        }

        // Transition pending -> swiping
        if (t.state === 'pending') {
          // Block swipe navigation when panels are open
          if (isPanelOpenRef.current) {
            touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
            return;
          }

          t.state = 'swiping';
          setPhase('tracking');

          // Notify auto-hide: swipe started
          onSwipeStartRef.current();
        }

        // Prevent browser scroll for horizontal swipe
        if (e.cancelable) {
          e.preventDefault();
        }

        // Rubber-band at boundary
        const boundary = t.boundary;
        const isRubberBand =
          boundary !== null &&
          ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0));

        if (isRubberBand) {
          const rubberOffset = getRubberBandOffset(deltaX);
          translateX.set(rubberOffset);

          const absRubber = Math.abs(rubberOffset);
          const showHint = absRubber > 15;
          setShowChapterHint(showHint);
          setChapterHintDirection(deltaX > 0 ? 'prev' : 'next');
          setIsAtBoundary(boundary);
        } else {
          translateX.set(deltaX);
          setShowChapterHint(false);
          setChapterHintDirection(null);
          setIsAtBoundary(null);
        }

        // Update last touch for velocity
        t.lastTouchX = touch.clientX;
        t.lastTouchTime = Date.now();
      };

      // ----- touchend -----
      const handleTouchEnd = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        const t = touchRef.current;
        if (t.state === 'idle' || t.state === 'cancelled') {
          touchRef.current = { ...INITIAL_TOUCH };
          return;
        }

        const touch = e.changedTouches[0];
        if (!touch) {
          resetState();
          return;
        }

        // ---------- TAP DETECTION (state === 'pending') ----------
        if (t.state === 'pending') {
          const deltaX = Math.abs(touch.clientX - t.startX);
          const deltaY = Math.abs(touch.clientY - t.startY);
          const duration = Date.now() - t.startTime;

          touchRef.current = { ...INITIAL_TOUCH };

          // Long press -- don't handle (native text selection)
          if (duration >= LONG_PRESS_TIMEOUT) {
            return;
          }

          // Too much movement -- not a tap
          if (deltaX >= TAP_MAX_MOVEMENT || deltaY >= TAP_MAX_MOVEMENT) {
            return;
          }

          // Check for interactive elements
          if (isInteractiveElement(e.target)) {
            return;
          }

          // Convert to screen coords for zone detection
          const iframeOffset = getIframeOffset(contents);
          const screenX = touch.clientX + iframeOffset;

          const action = getTapAction(screenX, false);

          if (action === 'center') {
            // Center tap: check for description via elementFromPoint, else toggle UI
            const viewportX = touch.clientX;
            const viewportY = touch.clientY;
            onCenterTapRef.current(viewportX, viewportY);
            // Also toggle UI (onCenterTap handles description detection,
            // if no description found, EpubReader should toggle UI)
            onToggleUIRef.current();
            return;
          }

          // Edge tap navigation
          if (isPanelOpenRef.current) {
            // Block edge-tap navigation when panels are open
            return;
          }

          // Notify auto-hide: tap navigate
          onTapNavigateRef.current();

          // Trigger slide-in animation (non-blocking visual effect)
          {
            const stageInfo = getStageInfo(rendition);
            const vw = stageInfo?.viewportWidth || window.innerWidth;
            const slideTarget = action === 'next' ? -vw : vw;
            setPhase('animating');
            if (animationRef.current) {
              animationRef.current.stop();
              animationRef.current = null;
            }
            animationRef.current = animate(translateX, slideTarget, {
              ...SPRING_FAST,
              onComplete: () => {
                animationRef.current = null;
                translateX.set(0);
                setPhase('idle');
              },
            });
          }

          // Fire navigation callback
          onEdgeTapRef.current(action);

          return;
        }

        // ---------- SWIPE COMPLETION (state === 'swiping') ----------
        const deltaX = touch.clientX - t.startX;
        const currentTime = Date.now();
        const velocity = calculateVelocity(
          touch.clientX,
          currentTime,
          t.lastTouchX,
          t.lastTouchTime
        );

        const info = getStageInfo(rendition);
        const viewportWidth = info?.viewportWidth || window.innerWidth;

        // Check boundary rubber-band
        const boundary = t.boundary;
        const isRubberBand =
          boundary !== null &&
          ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0));

        if (isRubberBand) {
          const rubberOffset = Math.abs(getRubberBandOffset(deltaX));
          const shouldTransition =
            rubberOffset >= viewportWidth * FOLLOW_FINGER_CONFIG.chapterTransitionThreshold;

          setPhase('animating');

          animationRef.current = animate(translateX, 0, {
            ...SPRING_RUBBER,
            velocity: velocity * 1000,
            onComplete: () => {
              animationRef.current = null;
              resetState();

              if (shouldTransition && onChapterChangeRef.current) {
                const dir = deltaX > 0 ? 'prev' : 'next';
                if (navLockRef.current.acquire()) {
                  onChapterChangeRef.current(dir).finally(() => {
                    navLockRef.current.release();
                  });
                }
              }
            },
          });
          return;
        }

        // Normal swipe completion
        const navigate = shouldNavigate(deltaX, velocity, viewportWidth);
        const direction: 'next' | 'prev' = deltaX > 0 ? 'prev' : 'next';

        setPhase('animating');

        if (navigate) {
          const target = direction === 'next' ? -viewportWidth : viewportWidth;
          const spring = getSpringConfig(velocity);

          animationRef.current = animate(translateX, target, {
            ...spring,
            velocity: velocity * 1000,
            onComplete: () => {
              animationRef.current = null;
              translateX.set(0);
              resetState();

              if (navLockRef.current.acquire()) {
                onNavigateRef.current(direction).finally(() => {
                  navLockRef.current.release();
                });
              }
            },
          });
        } else {
          // Snap back
          animationRef.current = animate(translateX, 0, {
            ...SPRING_RUBBER,
            velocity: velocity * 1000,
            onComplete: () => {
              animationRef.current = null;
              resetState();
            },
          });
        }
      };

      // ----- touchcancel -----
      const handleTouchCancel = () => {
        if (touchRef.current.state === 'swiping') {
          translateX.set(0);
        }
        touchRef.current = { ...INITIAL_TOUCH };
        resetState();
      };

      // ----- click (desktop fallback) -----
      const lastTouchTimeRef = { value: 0 };

      const handleClick = (e: MouseEvent) => {
        if (!enabledRef.current) return;

        // Ignore click shortly after touch (prevents double navigation on mobile)
        if (Date.now() - lastTouchTimeRef.value < 500) return;

        if (isInteractiveElement(e.target)) return;

        const iframeOffset = getIframeOffset(contents);
        const screenX = e.clientX + iframeOffset;
        const action = getTapAction(screenX, false);

        if (action === 'center') {
          onCenterTapRef.current(e.clientX, e.clientY);
          onToggleUIRef.current();
          return;
        }

        if (isPanelOpenRef.current) return;

        onTapNavigateRef.current();

        // Trigger slide-in animation for click-based edge tap
        {
          const stageInfo = getStageInfo(rendition);
          const vw = stageInfo?.viewportWidth || window.innerWidth;
          const slideTarget = action === 'next' ? -vw : vw;
          setPhase('animating');
          if (animationRef.current) {
            animationRef.current.stop();
            animationRef.current = null;
          }
          animationRef.current = animate(translateX, slideTarget, {
            ...SPRING_FAST,
            onComplete: () => {
              animationRef.current = null;
              translateX.set(0);
              setPhase('idle');
            },
          });
        }

        onEdgeTapRef.current(action);
      };

      // Wrap touchstart to track timing for click dedup
      const wrappedTouchStart = (e: TouchEvent) => {
        lastTouchTimeRef.value = Date.now();
        handleTouchStart(e);
      };

      // Bind events to iframe document
      doc.addEventListener('touchstart', wrappedTouchStart, { passive: true });
      doc.addEventListener('touchmove', handleTouchMove, { passive: false });
      doc.addEventListener('touchend', handleTouchEnd, { passive: true });
      doc.addEventListener('touchcancel', handleTouchCancel, { passive: true });
      doc.addEventListener('click', handleClick, { capture: false });

      // Store cleanup
      // @ts-expect-error - custom property for cleanup
      doc.__gestureControllerCleanup = () => {
        doc.removeEventListener('touchstart', wrappedTouchStart);
        doc.removeEventListener('touchmove', handleTouchMove);
        doc.removeEventListener('touchend', handleTouchEnd);
        doc.removeEventListener('touchcancel', handleTouchCancel);
        doc.removeEventListener('click', handleClick);
      };
    };

    // Register hook
    rendition.hooks.content.register(contentHook);

    // Setup for already-rendered contents
    try {
      const existingContents = rendition.getContents();
      if (existingContents && existingContents.length > 0) {
        existingContents.forEach(contentHook);
      }
    } catch {
      // Ignore
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }
      translateX.set(0);

      try {
        rendition.hooks.content.deregister(contentHook);
      } catch {
        // Ignore
      }

      try {
        const contents = rendition.getContents();
        if (contents) {
          contents.forEach((c) => {
            // @ts-expect-error - custom property for cleanup
            if (c.document && c.document.__gestureControllerCleanup) {
              // @ts-expect-error - custom property for cleanup
              c.document.__gestureControllerCleanup();
            }
          });
        }
      } catch {
        // Ignore
      }
    };
  }, [rendition, translateX, resetState, getIframeOffset, getTapAction, isInteractiveElement]);

  // -------------------------------------------------------------------------
  // iOS center-tap overlay
  // On iOS, center-tap from iframe may not work reliably.
  // We create a transparent overlay for center-tap detection.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isIOS() || !rendition || !enabled) return;

    const overlayId = 'gesture-controller-ios-overlay';

    // Remove existing if present
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = `
      position: absolute;
      top: env(safe-area-inset-top);
      bottom: env(safe-area-inset-bottom);
      left: 15%;
      right: 15%;
      z-index: 5;
      background-color: transparent;
      touch-action: pan-x pan-y;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      user-select: none;
    `;

    let touchStart: { x: number; y: number; time: number } | null = null;

    const handleOverlayTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    };

    const handleOverlayTouchEnd = (e: TouchEvent) => {
      if (!enabledRef.current || !touchStart) return;

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStart = null;
        return;
      }

      const deltaX = Math.abs(touch.clientX - touchStart.x);
      const deltaY = Math.abs(touch.clientY - touchStart.y);
      const duration = Date.now() - touchStart.time;
      touchStart = null;

      // Not a tap
      if (
        duration >= TAP_MAX_DURATION ||
        deltaX >= TAP_MAX_MOVEMENT ||
        deltaY >= TAP_MAX_MOVEMENT
      ) {
        return;
      }

      // Center tap on iOS -- find description via iframe elementFromPoint
      const iframe = document.querySelector('#epub-viewer iframe') as HTMLIFrameElement | null;
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        const viewportX = touch.clientX - iframeRect.left;
        const viewportY = touch.clientY - iframeRect.top;
        onCenterTapRef.current(viewportX, viewportY);
      }

      onToggleUIRef.current();
    };

    overlay.addEventListener('touchstart', handleOverlayTouchStart, { passive: true });
    overlay.addEventListener('touchend', handleOverlayTouchEnd, { passive: true });

    // Find the reader container to append the overlay
    const container = document.querySelector('.relative.h-full.w-full');
    if (container) {
      container.appendChild(overlay);
    }

    return () => {
      overlay.removeEventListener('touchstart', handleOverlayTouchStart);
      overlay.removeEventListener('touchend', handleOverlayTouchEnd);
      overlay.remove();
    };
  }, [rendition, enabled]);

  // -------------------------------------------------------------------------
  // Slide-in animation for tap navigation
  // -------------------------------------------------------------------------
  const triggerSlideAnimation = useCallback(
    (direction: 'next' | 'prev') => {
      if (phase !== 'idle') return;

      const info = getStageInfo(rendition);
      const viewportWidth = info?.viewportWidth || window.innerWidth;
      const target = direction === 'next' ? -viewportWidth : viewportWidth;

      setPhase('animating');

      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }

      animationRef.current = animate(translateX, target, {
        ...SPRING_FAST,
        onComplete: () => {
          animationRef.current = null;
          translateX.set(0);
          setPhase('idle');
        },
      });
    },
    [phase, rendition, translateX]
  );

  // Log once on mount
  useEffect(() => {
    if (rendition && enabled) {
      logger.debug('[GestureController] Initialized', {
        isIOS: isIOS(),
        hasiOSOverlay: isIOS(),
      });
    }
  }, [rendition, enabled]);

  return {
    translateX,
    phase,
    isAtBoundary,
    showChapterHint,
    chapterHintDirection,
    triggerSlideAnimation,
  };
};

export default useGestureController;
