/**
 * gestureUtils - Pure utility functions and configuration for gesture navigation
 *
 * Extracted from useFollowFingerSwipe for reuse by useGestureController.
 * Contains: config objects, types, pure functions, and shared FSM functions
 * for deduplicating iframe/overlay touch handlers.
 *
 * @module hooks/epub/gestureUtils
 */

import type React from 'react';
import type { MotionValue } from 'motion/react';
import { animate } from 'motion/react';
import type { Rendition } from '@/types/epub';
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
  quickSwipeMinDistance: 10,
  /** if deltaY/deltaX > this, treat as vertical scroll and cancel swipe */
  maxVerticalRatio: 1.5,
  /** resistance factor for rubber-band at chapter boundary */
  rubberBandResistance: 0.4,
  /** fraction of viewport - rubber-band offset above this triggers chapter change */
  chapterTransitionThreshold: 0.08, // 0.08 * 375 = 30px — reachable within maxRubberBand (100px)
  /** px - maximum visual offset during rubber-band */
  maxRubberBand: 100,
} as const;

// ---------------------------------------------------------------------------
// Spring configurations (critically damped: damping ~= 2*sqrt(stiffness*mass))
// ---------------------------------------------------------------------------

export const SPRING_FAST = {
  type: 'spring' as const,
  stiffness: 800,
  damping: 57, // 2*sqrt(800*1) ≈ 56.6 -- critical damping
  mass: 1,
};

export const SPRING_RUBBER = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 40, // 2*sqrt(400*1) = 40
  mass: 1,
};

/** Fast spring for tap navigation (~50-75ms, critically damped) */
export const SPRING_TAP = {
  type: 'spring' as const,
  stiffness: 1000,
  damping: 57, // 2*sqrt(1000*0.8) ≈ 56.6
  mass: 0.8,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StageInfo {
  stage: HTMLElement;
  currentScroll: number;
  maxScroll: number;
  viewportWidth: number;
  isAtStart: boolean;
  isAtEnd: boolean;
}

export type FollowFingerPhase = 'idle' | 'tracking' | 'animating';

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

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
// Shared FSM types & state
// ---------------------------------------------------------------------------

export type GestureState = 'idle' | 'pending' | 'swiping' | 'cancelled';

export interface TouchState {
  state: GestureState;
  startX: number;
  startY: number;
  startTime: number;
  lastTouchX: number;
  lastTouchTime: number;
  boundary: 'start' | 'end' | null;
}

export const INITIAL_TOUCH: TouchState = {
  state: 'idle',
  startX: 0,
  startY: 0,
  startTime: 0,
  lastTouchX: 0,
  lastTouchTime: 0,
  boundary: null,
};

// ---------------------------------------------------------------------------
// Shared FSM dependencies interface
// ---------------------------------------------------------------------------

export interface GestureFSMDeps {
  touchRef: React.MutableRefObject<TouchState>;
  translateX: MotionValue<number>;
  animationRef: React.MutableRefObject<ReturnType<typeof animate> | null>;
  enabledRef: React.MutableRefObject<boolean>;
  isPanelOpenRef: React.MutableRefObject<boolean>;
  rendition: Rendition | null;
  // State setters
  setPhase: (phase: FollowFingerPhase) => void;
  setIsAtBoundary: (b: 'start' | 'end' | null) => void;
  setShowChapterHint: (show: boolean) => void;
  setChapterHintDirection: (dir: 'next' | 'prev' | null) => void;
  // Refs for conditional setState (minimize re-renders in touchmove)
  showChapterHintRef: React.MutableRefObject<boolean>;
  chapterHintDirectionRef: React.MutableRefObject<'next' | 'prev' | null>;
  isAtBoundaryRef: React.MutableRefObject<'start' | 'end' | null>;
  // Callback refs
  onSwipeStartRef: React.MutableRefObject<() => void>;
  resetState: () => void;
}

export interface SwipeCompletionDeps extends GestureFSMDeps {
  onNavigateRef: React.MutableRefObject<(dir: 'next' | 'prev') => Promise<void>>;
  onChapterChangeRef: React.MutableRefObject<((dir: 'next' | 'prev') => Promise<void>) | undefined>;
  navLockRef: React.MutableRefObject<NavigationLock>;
  pageAnimationEnabledRef: React.MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Shared FSM functions
// ---------------------------------------------------------------------------

/** Shared touchstart handler -- identical for both iframe and overlay */
export function processTouchStart(
  touch: Touch,
  deps: GestureFSMDeps,
  checkSelection?: () => boolean
): void {
  if (!deps.enabledRef.current) return;
  if (checkSelection?.()) return;

  // Stop running animation
  if (deps.animationRef.current) {
    deps.animationRef.current.stop();
    deps.animationRef.current = null;
  }

  // Check boundary for rubber-band
  const info = getStageInfo(deps.rendition);
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
  deps.touchRef.current = {
    state: 'pending',
    startX: touch.clientX,
    startY: touch.clientY,
    startTime: now,
    lastTouchX: touch.clientX,
    lastTouchTime: now,
    boundary,
  };
}

/** Shared touchmove handler -- identical for both iframe and overlay */
export function processTouchMove(
  e: TouchEvent,
  deps: GestureFSMDeps,
  checkSelection?: () => boolean
): void {
  if (!deps.enabledRef.current) return;

  const t = deps.touchRef.current;
  if (t.state !== 'pending' && t.state !== 'swiping') return;

  // Selection passthrough: if user is dragging a selection,
  // cancel gesture to avoid intercepting native drag handles
  if (checkSelection?.()) {
    deps.touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;
  }

  const touch = e.touches[0];
  if (!touch) return;

  const deltaX = touch.clientX - t.startX;
  const deltaY = touch.clientY - t.startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  // Vertical scroll detection -- cancel with animated snap-back
  if (
    absDeltaY > FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold &&
    absDeltaY / Math.max(absDeltaX, 1) > FOLLOW_FINGER_CONFIG.maxVerticalRatio
  ) {
    if (t.state === 'swiping') {
      deps.setPhase('animating');
      deps.animationRef.current = animate(deps.translateX, 0, {
        ...SPRING_RUBBER,
        onComplete: () => {
          deps.animationRef.current = null;
          deps.resetState();
        },
      });
    }
    deps.touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;
  }

  // Not enough horizontal movement yet -- wait
  if (t.state === 'pending' && absDeltaX <= FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold) {
    return;
  }

  // Transition pending -> swiping
  if (t.state === 'pending') {
    // Block swipe navigation when panels are open
    if (deps.isPanelOpenRef.current) {
      deps.touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
      return;
    }

    t.state = 'swiping';
    deps.setPhase('tracking');

    // Notify auto-hide: swipe started
    deps.onSwipeStartRef.current();
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
    deps.translateX.set(rubberOffset);

    const absRubber = Math.abs(rubberOffset);
    const showHint = absRubber > 15;
    const hintDir: 'next' | 'prev' = deltaX > 0 ? 'prev' : 'next';

    // Only setState when value actually changes (minimize re-renders in touchmove)
    if (showHint !== deps.showChapterHintRef.current) {
      deps.showChapterHintRef.current = showHint;
      deps.setShowChapterHint(showHint);
    }
    if (hintDir !== deps.chapterHintDirectionRef.current) {
      deps.chapterHintDirectionRef.current = hintDir;
      deps.setChapterHintDirection(hintDir);
    }
    if (boundary !== deps.isAtBoundaryRef.current) {
      deps.isAtBoundaryRef.current = boundary;
      deps.setIsAtBoundary(boundary);
    }
  } else {
    deps.translateX.set(deltaX);
    // Only setState when value actually changes
    if (deps.showChapterHintRef.current !== false) {
      deps.showChapterHintRef.current = false;
      deps.setShowChapterHint(false);
    }
    if (deps.chapterHintDirectionRef.current !== null) {
      deps.chapterHintDirectionRef.current = null;
      deps.setChapterHintDirection(null);
    }
    if (deps.isAtBoundaryRef.current !== null) {
      deps.isAtBoundaryRef.current = null;
      deps.setIsAtBoundary(null);
    }
  }

  // Update last touch for velocity
  t.lastTouchX = touch.clientX;
  t.lastTouchTime = Date.now();
}

/** Shared swipe completion -- called from touchend when state === 'swiping' */
export function processSwipeCompletion(
  touch: Touch,
  startX: number,
  lastTouchX: number,
  lastTouchTime: number,
  boundary: 'start' | 'end' | null,
  deps: SwipeCompletionDeps
): void {
  const deltaX = touch.clientX - startX;
  const currentTime = Date.now();
  const velocity = calculateVelocity(touch.clientX, currentTime, lastTouchX, lastTouchTime);

  const info = getStageInfo(deps.rendition);
  const viewportWidth = info?.viewportWidth || window.innerWidth;

  // Check boundary rubber-band
  const isRubberBand =
    boundary !== null &&
    ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0));

  if (isRubberBand) {
    const rubberOffset = Math.abs(getRubberBandOffset(deltaX));
    const absVelocity = Math.abs(velocity);
    const shouldTransition =
      rubberOffset >= viewportWidth * FOLLOW_FINGER_CONFIG.chapterTransitionThreshold ||
      (absVelocity > FOLLOW_FINGER_CONFIG.quickSwipeVelocity && rubberOffset > 10);

    deps.setPhase('animating');

    if (shouldTransition && deps.onChapterChangeRef.current) {
      // Two-phase chapter transition: navigate FIRST, then slide-in
      const dir: 'next' | 'prev' = deltaX > 0 ? 'prev' : 'next';

      void (async () => {
        if (deps.navLockRef.current.acquire()) {
          try {
            await deps.onChapterChangeRef.current!(dir);
          } finally {
            deps.navLockRef.current.release();
          }
        }
        if (deps.pageAnimationEnabledRef.current) {
          const slideFrom = dir === 'next' ? viewportWidth : -viewportWidth;
          deps.translateX.set(slideFrom);
          deps.animationRef.current = animate(deps.translateX, 0, {
            ...SPRING_TAP,
            onComplete: () => {
              deps.animationRef.current = null;
              deps.resetState();
            },
          });
        } else {
          deps.translateX.set(0);
          deps.resetState();
        }
      })();
    } else {
      // Snap-back (insufficient offset for chapter transition)
      deps.animationRef.current = animate(deps.translateX, 0, {
        ...SPRING_RUBBER,
        velocity: velocity * 1000,
        onComplete: () => {
          deps.animationRef.current = null;
          deps.resetState();
        },
      });
    }
    return;
  }

  // Normal swipe completion
  const navigate = shouldNavigate(deltaX, velocity, viewportWidth);
  const direction: 'next' | 'prev' = deltaX > 0 ? 'prev' : 'next';

  deps.setPhase('animating');

  if (navigate) {
    // Two-phase swipe: navigate FIRST, then slide-in from edge
    void (async () => {
      if (deps.navLockRef.current.acquire()) {
        try {
          await deps.onNavigateRef.current(direction);
        } finally {
          deps.navLockRef.current.release();
        }
      }
      if (deps.pageAnimationEnabledRef.current) {
        const slideFrom = direction === 'next' ? viewportWidth : -viewportWidth;
        deps.translateX.set(slideFrom);
        deps.animationRef.current = animate(deps.translateX, 0, {
          ...SPRING_TAP,
          onComplete: () => {
            deps.animationRef.current = null;
            deps.resetState();
          },
        });
      } else {
        deps.translateX.set(0);
        deps.resetState();
      }
    })();
  } else {
    // Snap back
    deps.animationRef.current = animate(deps.translateX, 0, {
      ...SPRING_RUBBER,
      velocity: velocity * 1000,
      onComplete: () => {
        deps.animationRef.current = null;
        deps.resetState();
      },
    });
  }
}

/** Shared touchcancel handler */
export function processTouchCancel(deps: GestureFSMDeps): void {
  if (deps.touchRef.current.state === 'swiping') {
    deps.setPhase('animating');
    deps.animationRef.current = animate(deps.translateX, 0, {
      ...SPRING_RUBBER,
      onComplete: () => {
        deps.animationRef.current = null;
        deps.resetState();
      },
    });
    deps.touchRef.current = { ...INITIAL_TOUCH, state: 'cancelled' };
    return;
  }
  deps.touchRef.current = { ...INITIAL_TOUCH };
  deps.resetState();
}
