/**
 * useFollowFingerSwipe - Follow-finger swipe navigation for EPUB reader
 *
 * Provides Apple Books-like swipe navigation where the page physically
 * follows the user's finger in real-time, with spring physics for
 * completion animation and rubber-band effect at chapter boundaries.
 *
 * Key features:
 * - Real-time follow-finger tracking via CSS transform (GPU-accelerated)
 * - Spring physics completion (critically damped)
 * - Velocity-based flick detection
 * - Rubber-band at chapter boundaries
 * - Tap vs swipe discrimination
 *
 * Touch events are bound directly to the epub.js iframe document via
 * rendition.hooks.content.register() since iframe events don't bubble.
 *
 * @module hooks/epub/useFollowFingerSwipe
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useMotionValue, animate } from 'motion/react';
import type { MotionValue } from 'motion/react';
import type { Rendition, Contents } from '@/types/epub';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const FOLLOW_FINGER_CONFIG = {
  /** px - movement below this threshold is a tap, not a swipe */
  tapVsSwipeThreshold: 10,
  /** fraction of viewport width - offset above this triggers navigation */
  navigateThreshold: 0.25,
  /** px/ms - velocity above this triggers flick navigation */
  quickSwipeVelocity: 0.3,
  /** px - minimum distance for a velocity-based flick */
  quickSwipeMinDistance: 15,
  /** if deltaY/deltaX > this, treat as vertical scroll and cancel swipe */
  maxVerticalRatio: 2.0,
  /** resistance factor for rubber-band at chapter boundary */
  rubberBandResistance: 0.4,
  /** fraction of viewport - rubber-band offset above this triggers chapter change */
  chapterTransitionThreshold: 0.35,
  /** px - maximum visual offset during rubber-band */
  maxRubberBand: 80,
} as const;

// ---------------------------------------------------------------------------
// Spring configurations (critically damped: damping ~= 2*sqrt(stiffness*mass))
// ---------------------------------------------------------------------------

export const SPRING_FAST = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 40, // 2*sqrt(400*1) = 40 -- exact critical damping
  mass: 1,
};

export const SPRING_NORMAL = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 35, // 2*sqrt(300*1) ~= 34.6, rounded up
  mass: 1,
};

export const SPRING_RUBBER = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 28, // 2*sqrt(200*1) ~= 28.3
  mass: 1,
};

/** Select spring config based on velocity (px/ms) */
export const getSpringConfig = (velocity: number) => {
  const absV = Math.abs(velocity);
  if (absV > 0.5) return SPRING_FAST;
  if (absV > 0.1) return SPRING_NORMAL;
  return SPRING_RUBBER;
};

// ---------------------------------------------------------------------------
// Exported utility functions (tested directly)
// ---------------------------------------------------------------------------

export interface StageInfo {
  stage: HTMLElement;
  currentScroll: number;
  maxScroll: number;
  viewportWidth: number;
  isAtStart: boolean;
  isAtEnd: boolean;
}

/** Get stage container info for boundary detection */
export const getStageInfo = (rendition: Rendition | null): StageInfo | null => {
  if (!rendition) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = (rendition as any).manager;
    if (!manager) return null;

    const stage = manager.stage?.container || manager.container;
    if (!stage) return null;

    const currentScroll = stage.scrollLeft;
    const maxScroll = stage.scrollWidth - stage.clientWidth;
    const viewportWidth = stage.clientWidth;

    return {
      stage,
      currentScroll,
      maxScroll,
      viewportWidth,
      isAtStart: currentScroll <= 0,
      isAtEnd: currentScroll >= maxScroll - 1,
    };
  } catch {
    return null;
  }
};

/** Determine if offset/velocity warrants navigation */
export const shouldNavigate = (
  offset: number,
  velocity: number,
  viewportWidth: number
): boolean => {
  const absOffset = Math.abs(offset);
  const absVelocity = Math.abs(velocity);

  // Quick flick -- navigate even with small offset
  if (
    absVelocity > FOLLOW_FINGER_CONFIG.quickSwipeVelocity &&
    absOffset > FOLLOW_FINGER_CONFIG.quickSwipeMinDistance
  ) {
    return true;
  }

  // Standard navigation by distance
  return absOffset > viewportWidth * FOLLOW_FINGER_CONFIG.navigateThreshold;
};

/** Calculate velocity from two touch points (px/ms) */
export const calculateVelocity = (
  currentX: number,
  currentTime: number,
  lastX: number,
  lastTime: number
): number => {
  const dt = currentTime - lastTime;
  if (dt <= 0) return 0;
  return (currentX - lastX) / dt;
};

/** Calculate rubber-band offset with resistance and clamping */
export const getRubberBandOffset = (deltaX: number): number => {
  const resisted = deltaX * FOLLOW_FINGER_CONFIG.rubberBandResistance;
  return Math.max(
    -FOLLOW_FINGER_CONFIG.maxRubberBand,
    Math.min(FOLLOW_FINGER_CONFIG.maxRubberBand, resisted)
  );
};

// ---------------------------------------------------------------------------
// Hook interfaces
// ---------------------------------------------------------------------------

export interface UseFollowFingerSwipeOptions {
  rendition: Rendition | null;
  enabled: boolean;
  onNavigate: (direction: 'next' | 'prev') => Promise<void>;
  onChapterChange?: (direction: 'next' | 'prev') => Promise<void>;
  navLock: NavigationLock;
}

export type FollowFingerPhase = 'idle' | 'tracking' | 'animating';

export interface UseFollowFingerSwipeReturn {
  translateX: MotionValue<number>;
  phase: FollowFingerPhase;
  isAtBoundary: 'start' | 'end' | null;
  showChapterHint: boolean;
  chapterHintDirection: 'next' | 'prev' | null;
}

// ---------------------------------------------------------------------------
// Touch state (ref-based, no re-renders)
// ---------------------------------------------------------------------------

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  lastTouchX: number;
  lastTouchTime: number;
  isSwiping: boolean;
  isBoundary: 'start' | 'end' | null;
}

const INITIAL_TOUCH: TouchState = {
  startX: 0,
  startY: 0,
  startTime: 0,
  lastTouchX: 0,
  lastTouchTime: 0,
  isSwiping: false,
  isBoundary: null,
};

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export const useFollowFingerSwipe = (
  options: UseFollowFingerSwipeOptions
): UseFollowFingerSwipeReturn => {
  const { rendition, enabled, onNavigate, onChapterChange, navLock } = options;

  // Motion value for GPU-accelerated transform (no re-renders)
  const translateX = useMotionValue(0);

  // Minimal state -- only what components need to re-render on
  const [phase, setPhase] = useState<FollowFingerPhase>('idle');
  const [isAtBoundary, setIsAtBoundary] = useState<'start' | 'end' | null>(null);
  const [showChapterHint, setShowChapterHint] = useState(false);
  const [chapterHintDirection, setChapterHintDirection] = useState<'next' | 'prev' | null>(null);

  // Refs for touch state and callbacks (avoid stale closures)
  const touchRef = useRef<TouchState>({ ...INITIAL_TOUCH });
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const enabledRef = useRef(enabled);
  const onNavigateRef = useRef(onNavigate);
  const onChapterChangeRef = useRef(onChapterChange);
  const navLockRef = useRef(navLock);

  // Keep refs in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  useEffect(() => {
    onChapterChangeRef.current = onChapterChange;
  }, [onChapterChange]);
  useEffect(() => {
    navLockRef.current = navLock;
  }, [navLock]);

  // Stable reset function
  const resetState = useCallback(() => {
    touchRef.current = { ...INITIAL_TOUCH };
    setPhase('idle');
    setIsAtBoundary(null);
    setShowChapterHint(false);
    setChapterHintDirection(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Main effect: bind touch events to iframe via hooks.content.register
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!rendition) return;

    const contentHook = (contents: Contents) => {
      const doc = contents.document;
      if (!doc) return;

      // ----- touchstart -----
      const handleTouchStart = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        // Don't start if there's active text selection
        const sel = doc.defaultView?.getSelection?.();
        if (sel && sel.toString().length > 0) return;

        const touch = e.touches[0];
        if (!touch) return;

        // If animation is running, stop it and start tracking from current position
        if (animationRef.current) {
          animationRef.current.stop();
          animationRef.current = null;
        }

        // Check boundary
        const info = getStageInfo(rendition);
        const boundary = info
          ? info.isAtStart && info.isAtEnd
            ? null // Single-page chapter: no boundary behavior
            : info.isAtStart
              ? 'start'
              : info.isAtEnd
                ? 'end'
                : null
          : null;

        const now = Date.now();
        touchRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: now,
          lastTouchX: touch.clientX,
          lastTouchTime: now,
          isSwiping: false,
          isBoundary: boundary,
        };
      };

      // ----- touchmove -----
      const handleTouchMove = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        const t = touchRef.current;
        if (t.startTime === 0) return; // No active touch

        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - t.startX;
        const deltaY = touch.clientY - t.startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        // Vertical scroll detection -- cancel swipe
        if (
          absDeltaY > FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold &&
          absDeltaY / Math.max(absDeltaX, 1) > FOLLOW_FINGER_CONFIG.maxVerticalRatio
        ) {
          touchRef.current = { ...INITIAL_TOUCH };
          if (t.isSwiping) {
            translateX.set(0);
            resetState();
          }
          return;
        }

        // Haven't exceeded tap threshold yet -- wait
        if (!t.isSwiping && absDeltaX <= FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold) {
          return;
        }

        // Start swiping
        if (!t.isSwiping) {
          t.isSwiping = true;
          setPhase('tracking');
        }

        // Prevent browser scroll for horizontal swipe
        if (e.cancelable) {
          e.preventDefault();
        }

        // Determine if at boundary for this swipe direction
        const boundary = t.isBoundary;
        const isRubberBand =
          boundary !== null &&
          ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0));

        if (isRubberBand) {
          // Rubber-band: apply resistance
          const rubberOffset = getRubberBandOffset(deltaX);
          translateX.set(rubberOffset);

          // Show chapter hint if offset is significant
          const absRubber = Math.abs(rubberOffset);
          const showHint = absRubber > 15;
          setShowChapterHint(showHint);
          setChapterHintDirection(deltaX > 0 ? 'prev' : 'next');
          setIsAtBoundary(boundary);
        } else {
          // Normal follow-finger
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
        if (t.startTime === 0) return;

        const touch = e.changedTouches[0];
        if (!touch) {
          resetState();
          return;
        }

        // If we never started swiping, treat as tap -- let other handlers process
        if (!t.isSwiping) {
          touchRef.current = { ...INITIAL_TOUCH };
          return;
        }

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
        const boundary = t.isBoundary;
        const isRubberBand =
          boundary !== null &&
          ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0));

        if (isRubberBand) {
          // Rubber-band: check if should transition to next/prev chapter
          const rubberOffset = Math.abs(getRubberBandOffset(deltaX));
          const shouldTransition =
            rubberOffset >= viewportWidth * FOLLOW_FINGER_CONFIG.chapterTransitionThreshold;

          setPhase('animating');

          // Spring back to 0
          animationRef.current = animate(translateX, 0, {
            ...SPRING_RUBBER,
            velocity: velocity * 1000, // motion expects px/s
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

        // Normal swipe: determine if should navigate
        const navigate = shouldNavigate(deltaX, velocity, viewportWidth);
        const direction: 'next' | 'prev' = deltaX > 0 ? 'prev' : 'next';

        setPhase('animating');

        if (navigate) {
          // Animate to viewport edge, then navigate
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
          // Snap back to 0
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
        if (touchRef.current.isSwiping) {
          translateX.set(0);
        }
        touchRef.current = { ...INITIAL_TOUCH };
        resetState();
      };

      // Bind events to iframe document
      doc.addEventListener('touchstart', handleTouchStart, { passive: true });
      doc.addEventListener('touchmove', handleTouchMove, { passive: false });
      doc.addEventListener('touchend', handleTouchEnd, { passive: true });
      doc.addEventListener('touchcancel', handleTouchCancel, { passive: true });

      // Store cleanup function on document
      // @ts-expect-error - custom property for cleanup
      doc.__followFingerCleanup = () => {
        doc.removeEventListener('touchstart', handleTouchStart);
        doc.removeEventListener('touchmove', handleTouchMove);
        doc.removeEventListener('touchend', handleTouchEnd);
        doc.removeEventListener('touchcancel', handleTouchCancel);
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
      // Ignore -- contents may not be ready yet
    }

    // Cleanup
    return () => {
      // Stop any running animation
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
            if (c.document && c.document.__followFingerCleanup) {
              // @ts-expect-error - custom property for cleanup
              c.document.__followFingerCleanup();
            }
          });
        }
      } catch {
        // Ignore
      }
    };
  }, [rendition, translateX, resetState]);

  return {
    translateX,
    phase,
    isAtBoundary,
    showChapterHint,
    chapterHintDirection,
  };
};

export default useFollowFingerSwipe;
