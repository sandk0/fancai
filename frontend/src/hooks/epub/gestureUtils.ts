/**
 * gestureUtils - Pure utility functions and configuration for gesture navigation
 *
 * Extracted from useFollowFingerSwipe for reuse by useGestureController.
 * Contains only stateless exports: config objects, types, and pure functions.
 *
 * @module hooks/epub/gestureUtils
 */

import type { Rendition } from '@/types/epub';

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
