/**
 * useSwipeNavigation - Hook for swipe gesture navigation in EPUB reader
 *
 * Provides touch-based swipe navigation with smooth animations.
 * Detects horizontal swipes and triggers page navigation.
 *
 * Key features:
 * - Velocity-based swipe detection
 * - Finger tracking during swipe
 * - Smooth animation feedback
 * - iOS and Android support
 *
 * @module hooks/epub/useSwipeNavigation
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import type { Rendition } from '@/types/epub';

// Swipe configuration parameters
export const SWIPE_CONFIG = {
  // Minimum values for navigation trigger
  minDistance: 30, // px - minimum horizontal movement
  minVelocity: 0.3, // px/ms - minimum swipe speed

  // Maximum values for cancellation
  maxVerticalRatio: 2, // if deltaY/deltaX > 2, treat as vertical scroll
  maxDuration: 300, // ms - maximum time for a swipe gesture

  // Quick swipe thresholds (navigate even with small offset)
  quickSwipeVelocity: 0.8, // px/ms
  quickSwipeMinDistance: 20, // px

  // Edge resistance
  resistance: 0.5, // resistance factor at page boundaries
  rubberBandFactor: 0.3, // rubber band effect at boundaries
  maxRubberBand: 50, // px - maximum offset beyond boundary

  // Navigation zone (edge taps for description clicks)
  edgeZonePercent: 15, // % of screen width for edge detection
} as const;

// Swipe state interface
export interface SwipeState {
  /** Whether a swipe is currently in progress */
  swiping: boolean;
  /** Current horizontal offset from start (px) */
  offset: number;
  /** Current swipe velocity (px/ms) */
  velocity: number;
  /** Swipe direction based on current offset */
  direction: 'left' | 'right' | null;
  /** Phase of the swipe gesture */
  phase: 'idle' | 'tracking' | 'animating';
  /** Whether we're at a boundary (start/end of chapter) */
  atBoundary: 'start' | 'end' | null;
}

// Hook options interface
export interface UseSwipeNavigationOptions {
  /** epub.js Rendition instance */
  rendition: Rendition | null;
  /** Whether swipe navigation is enabled */
  enabled: boolean;
  /** Callback for page navigation */
  onNavigate: (direction: 'next' | 'prev') => Promise<void>;
  /** Optional callback when swipe starts */
  onSwipeStart?: () => void;
  /** Optional callback when swipe ends */
  onSwipeEnd?: (navigated: boolean) => void;
  /** Container element ref for touch events */
  containerRef?: React.RefObject<HTMLElement>;
}

// Hook return interface
export interface UseSwipeNavigationReturn {
  /** Current swipe state */
  swipeState: SwipeState;
  /** CSS styles for the overlay element */
  overlayStyle: React.CSSProperties;
  /** Touch event handlers for the container */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: (e: React.TouchEvent) => void;
  };
  /** Whether swipe is currently active */
  isActive: boolean;
}

// Initial swipe state
const initialSwipeState: SwipeState = {
  swiping: false,
  offset: 0,
  velocity: 0,
  direction: null,
  phase: 'idle',
  atBoundary: null,
};

/**
 * useSwipeNavigation hook
 *
 * Provides swipe gesture detection and navigation for EPUB reader.
 * Tracks finger movement and triggers page navigation on valid swipes.
 */
export const useSwipeNavigation = (
  options: UseSwipeNavigationOptions
): UseSwipeNavigationReturn => {
  const { rendition, enabled, onNavigate, onSwipeStart, onSwipeEnd } = options;

  // State
  const [swipeState, setSwipeState] = useState<SwipeState>(initialSwipeState);

  // Refs for tracking touch
  const touchStartRef = useRef<{
    x: number;
    y: number;
    time: number;
  } | null>(null);
  const lastTouchRef = useRef<{ x: number; time: number } | null>(null);
  const isNavigatingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  /**
   * Check if we're at a page boundary
   */
  const checkBoundary = useCallback((): 'start' | 'end' | null => {
    if (!rendition) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = (rendition as any).manager;
      if (!manager) return null;

      const stage = manager.stage?.container || manager.container;
      if (!stage) return null;

      const currentScroll = stage.scrollLeft;
      const maxScroll = stage.scrollWidth - stage.clientWidth;

      if (currentScroll <= 0) return 'start';
      if (currentScroll >= maxScroll - 1) return 'end';
      return null;
    } catch {
      return null;
    }
  }, [rendition]);

  /**
   * Calculate velocity from touch history
   */
  const calculateVelocity = useCallback(
    (currentX: number, currentTime: number): number => {
      if (!lastTouchRef.current) return 0;

      const deltaX = currentX - lastTouchRef.current.x;
      const deltaT = currentTime - lastTouchRef.current.time;

      if (deltaT <= 0) return 0;
      return deltaX / deltaT;
    },
    []
  );

  /**
   * Apply resistance when at boundary
   */
  const applyResistance = useCallback(
    (offset: number, boundary: 'start' | 'end' | null): number => {
      if (!boundary) return offset;

      // Apply resistance only when pulling away from boundary
      if ((boundary === 'start' && offset > 0) || (boundary === 'end' && offset < 0)) {
        return offset;
      }

      // Apply rubber band effect
      const resistance = SWIPE_CONFIG.resistance;
      const maxRubber = SWIPE_CONFIG.maxRubberBand;
      const resistedOffset = offset * resistance;

      // Clamp to max rubber band
      return Math.max(-maxRubber, Math.min(maxRubber, resistedOffset));
    },
    []
  );

  /**
   * Handle touch start
   */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || isNavigatingRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      // Don't start swipe if touching edge zones (for description clicks)
      const viewportWidth = window.innerWidth;
      const edgeZone = (viewportWidth * SWIPE_CONFIG.edgeZonePercent) / 100;
      if (touch.clientX < edgeZone || touch.clientX > viewportWidth - edgeZone) {
        return;
      }

      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      lastTouchRef.current = { x: touch.clientX, time: Date.now() };

      // Check boundary
      const boundary = checkBoundary();

      setSwipeState({
        ...initialSwipeState,
        swiping: true,
        phase: 'tracking',
        atBoundary: boundary,
      });

      onSwipeStart?.();
    },
    [enabled, checkBoundary, onSwipeStart]
  );

  /**
   * Handle touch move
   */
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !touchStartRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Check if this is a vertical scroll
      if (absDeltaY > 10 && absDeltaY / absDeltaX > SWIPE_CONFIG.maxVerticalRatio) {
        // Cancel swipe - this is a vertical scroll
        touchStartRef.current = null;
        lastTouchRef.current = null;
        setSwipeState(initialSwipeState);
        return;
      }

      // Prevent default to stop scrolling while swiping
      if (absDeltaX > 10) {
        e.preventDefault();
      }

      const currentTime = Date.now();
      const velocity = calculateVelocity(touch.clientX, currentTime);

      // Apply resistance at boundaries
      const boundary = checkBoundary();
      const resistedOffset = applyResistance(deltaX, boundary);

      // Determine direction
      const direction: 'left' | 'right' | null = resistedOffset > 0 ? 'right' : resistedOffset < 0 ? 'left' : null;

      setSwipeState((prev) => ({
        ...prev,
        offset: resistedOffset,
        velocity,
        direction,
        atBoundary: boundary,
      }));

      // Update last touch for velocity calculation
      lastTouchRef.current = { x: touch.clientX, time: currentTime };
    },
    [enabled, calculateVelocity, checkBoundary, applyResistance]
  );

  /**
   * Handle touch end - determine if we should navigate
   */
  const handleTouchEnd = useCallback(
    async (e: React.TouchEvent) => {
      if (!enabled || !touchStartRef.current) return;

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        lastTouchRef.current = null;
        setSwipeState(initialSwipeState);
        return;
      }

      const deltaX = touch.clientX - touchStartRef.current.x;
      const duration = Date.now() - touchStartRef.current.time;
      const velocity = calculateVelocity(touch.clientX, Date.now());
      const absVelocity = Math.abs(velocity);
      const absDeltaX = Math.abs(deltaX);

      // Clear touch refs
      touchStartRef.current = null;
      lastTouchRef.current = null;

      // Determine if we should navigate
      let shouldNavigate = false;
      let navDirection: 'next' | 'prev' | null = null;

      // Check quick swipe (high velocity, even with small offset)
      if (
        absVelocity >= SWIPE_CONFIG.quickSwipeVelocity &&
        absDeltaX >= SWIPE_CONFIG.quickSwipeMinDistance &&
        duration <= SWIPE_CONFIG.maxDuration
      ) {
        shouldNavigate = true;
        navDirection = velocity > 0 ? 'prev' : 'next';
      }
      // Check normal swipe (meets minimum distance and velocity)
      else if (
        absDeltaX >= SWIPE_CONFIG.minDistance &&
        absVelocity >= SWIPE_CONFIG.minVelocity
      ) {
        shouldNavigate = true;
        navDirection = deltaX > 0 ? 'prev' : 'next';
      }

      // Check boundary - can't navigate past chapter boundaries with swipe
      const boundary = checkBoundary();
      if (boundary === 'start' && navDirection === 'prev') {
        // At start, trying to go back - allow for chapter change
        // But apply snap back animation for visual feedback
      }
      if (boundary === 'end' && navDirection === 'next') {
        // At end, trying to go forward - allow for chapter change
        // But apply snap back animation for visual feedback
      }

      // Set animating phase
      setSwipeState((prev) => ({
        ...prev,
        phase: 'animating',
      }));

      if (shouldNavigate && navDirection) {
        isNavigatingRef.current = true;

        try {
          await onNavigate(navDirection);
        } finally {
          isNavigatingRef.current = false;
        }
      }

      // Reset state after animation
      setTimeout(() => {
        setSwipeState(initialSwipeState);
        onSwipeEnd?.(shouldNavigate);
      }, shouldNavigate ? 300 : 200);
    },
    [enabled, calculateVelocity, checkBoundary, onNavigate, onSwipeEnd]
  );

  /**
   * Handle touch cancel
   */
  const handleTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    lastTouchRef.current = null;
    setSwipeState(initialSwipeState);
    onSwipeEnd?.(false);
  }, [onSwipeEnd]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Calculate overlay styles based on swipe state
  const overlayStyle: React.CSSProperties = {
    transform: `translateX(${swipeState.offset}px)`,
    transition:
      swipeState.phase === 'animating'
        ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : 'none',
    opacity: swipeState.swiping ? 1 : 0,
    pointerEvents: swipeState.swiping ? 'auto' : 'none',
  };

  return {
    swipeState,
    overlayStyle,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
    },
    isActive: swipeState.swiping,
  };
};

export default useSwipeNavigation;
