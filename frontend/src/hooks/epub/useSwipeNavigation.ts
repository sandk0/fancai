/**
 * useSwipeNavigation - Hook for swipe gesture navigation in EPUB reader
 *
 * Provides touch-based swipe navigation with smooth animations.
 * Detects horizontal swipes and triggers page navigation.
 *
 * IMPORTANT: This hook binds events directly to the epub.js iframe document
 * using rendition.hooks.content.register() because touch events inside the
 * iframe don't bubble up to the parent container.
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
import type { Rendition, Contents } from '@/types/epub';

// Debug logging
const DEBUG = false;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log('[SwipeNav]', ...args);
};

// Swipe configuration parameters
export const SWIPE_CONFIG = {
  // Minimum values for navigation trigger
  minDistance: 50, // px - minimum horizontal movement
  minVelocity: 0.2, // px/ms - minimum swipe speed

  // Maximum values for cancellation
  maxVerticalRatio: 1.5, // if deltaY/deltaX > this, treat as vertical scroll
  maxDuration: 500, // ms - maximum time for a swipe gesture

  // Quick swipe thresholds (navigate even with small offset)
  quickSwipeVelocity: 0.5, // px/ms
  quickSwipeMinDistance: 30, // px

  // Edge resistance
  resistance: 0.5, // resistance factor at page boundaries
  rubberBandFactor: 0.3, // rubber band effect at boundaries
  maxRubberBand: 50, // px - maximum offset beyond boundary

  // Navigation zone (center zone for description clicks)
  edgeZonePercent: 15, // % of screen width - don't start swipe from edges
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
}

// Hook return interface
export interface UseSwipeNavigationReturn {
  /** Current swipe state */
  swipeState: SwipeState;
  /** CSS styles for the overlay element */
  overlayStyle: React.CSSProperties;
  /** Touch event handlers for the container (fallback, may not work with iframe) */
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

  // Refs for navigation state
  const isNavigatingRef = useRef(false);
  const enabledRef = useRef(enabled);

  // Keep enabled ref updated
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Store callbacks in refs to avoid stale closures
  const onNavigateRef = useRef(onNavigate);
  const onSwipeStartRef = useRef(onSwipeStart);
  const onSwipeEndRef = useRef(onSwipeEnd);

  useEffect(() => {
    onNavigateRef.current = onNavigate;
    onSwipeStartRef.current = onSwipeStart;
    onSwipeEndRef.current = onSwipeEnd;
  }, [onNavigate, onSwipeStart, onSwipeEnd]);

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
   * Main effect - setup event listeners via hooks.content.register()
   * This is the key fix - we attach events directly to the iframe document
   */
  useEffect(() => {
    if (!rendition) {
      log('No rendition, skipping setup');
      return;
    }

    log('Setting up swipe navigation');

    /**
     * Get iframe position to convert iframe-relative coords to screen coords
     */
    const getIframeOffset = (contents: Contents): number => {
      try {
        const iframeWindow = contents.window;
        if (iframeWindow && iframeWindow.frameElement) {
          const rect = (iframeWindow.frameElement as HTMLElement).getBoundingClientRect();
          return rect.left;
        }
      } catch (e) {
        log('Error getting iframe position:', e);
      }
      return 0;
    };

    /**
     * Content hook - called when each page is rendered
     * Binds events directly to iframe document
     */
    const contentHook = (contents: Contents) => {
      const doc = contents.document;
      if (!doc) {
        log('No document in contents, skipping');
        return;
      }

      log('Content hook triggered - binding swipe events to iframe document');

      // Local state for this content's touch tracking
      let localTouchStart: { x: number; y: number; time: number; screenX: number } | null = null;
      let localLastTouch: { x: number; time: number } | null = null;
      let isSwiping = false;

      /**
       * Calculate velocity from touch history
       */
      const calculateVelocity = (currentX: number, currentTime: number): number => {
        if (!localLastTouch) return 0;
        const deltaX = currentX - localLastTouch.x;
        const deltaT = currentTime - localLastTouch.time;
        if (deltaT <= 0) return 0;
        return deltaX / deltaT;
      };

      /**
       * Handle touch start
       */
      const handleTouchStart = (e: TouchEvent) => {
        if (!enabledRef.current || isNavigatingRef.current) return;

        const touch = e.touches[0];
        if (!touch) return;

        // Get iframe offset and calculate screen X
        const iframeOffset = getIframeOffset(contents);
        const screenX = touch.clientX + iframeOffset;

        // Don't start swipe if touching edge zones (for description clicks)
        const viewportWidth = window.innerWidth;
        const edgeZone = (viewportWidth * SWIPE_CONFIG.edgeZonePercent) / 100;

        if (screenX < edgeZone || screenX > viewportWidth - edgeZone) {
          log('Touch in edge zone, not starting swipe');
          return;
        }

        log('TouchStart:', { clientX: touch.clientX, screenX, clientY: touch.clientY });

        localTouchStart = {
          x: touch.clientX,
          y: touch.clientY,
          time: Date.now(),
          screenX,
        };
        localLastTouch = { x: touch.clientX, time: Date.now() };
        isSwiping = true;

        // Check boundary
        const boundary = checkBoundary();

        setSwipeState({
          ...initialSwipeState,
          swiping: true,
          phase: 'tracking',
          atBoundary: boundary,
        });

        onSwipeStartRef.current?.();
      };

      /**
       * Handle touch move
       */
      const handleTouchMove = (e: TouchEvent) => {
        if (!enabledRef.current || !localTouchStart || !isSwiping) return;

        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - localTouchStart.x;
        const deltaY = touch.clientY - localTouchStart.y;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        // Check if this is a vertical scroll
        if (absDeltaY > 10 && absDeltaY / absDeltaX > SWIPE_CONFIG.maxVerticalRatio) {
          log('Vertical scroll detected, cancelling swipe');
          localTouchStart = null;
          localLastTouch = null;
          isSwiping = false;
          setSwipeState(initialSwipeState);
          return;
        }

        // Prevent default to stop scrolling while swiping horizontally
        if (absDeltaX > 10) {
          e.preventDefault();
        }

        const currentTime = Date.now();
        const velocity = calculateVelocity(touch.clientX, currentTime);

        // Check boundary and apply resistance
        const boundary = checkBoundary();
        let resistedOffset = deltaX;

        // Apply resistance at boundaries
        if (boundary) {
          if ((boundary === 'start' && deltaX > 0) || (boundary === 'end' && deltaX < 0)) {
            // Pulling away from boundary - no resistance
          } else {
            // Pushing into boundary - apply resistance
            resistedOffset = deltaX * SWIPE_CONFIG.resistance;
            resistedOffset = Math.max(-SWIPE_CONFIG.maxRubberBand, Math.min(SWIPE_CONFIG.maxRubberBand, resistedOffset));
          }
        }

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
        localLastTouch = { x: touch.clientX, time: currentTime };
      };

      /**
       * Handle touch end - determine if we should navigate
       */
      const handleTouchEnd = async (e: TouchEvent) => {
        if (!enabledRef.current || !localTouchStart || !isSwiping) return;

        const touch = e.changedTouches[0];
        if (!touch) {
          localTouchStart = null;
          localLastTouch = null;
          isSwiping = false;
          setSwipeState(initialSwipeState);
          return;
        }

        const deltaX = touch.clientX - localTouchStart.x;
        const duration = Date.now() - localTouchStart.time;
        const velocity = calculateVelocity(touch.clientX, Date.now());
        const absVelocity = Math.abs(velocity);
        const absDeltaX = Math.abs(deltaX);

        log('TouchEnd:', { deltaX, duration, velocity: velocity.toFixed(3), absDeltaX });

        // Clear touch refs
        localTouchStart = null;
        localLastTouch = null;
        isSwiping = false;

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
          log('Quick swipe detected:', navDirection);
        }
        // Check normal swipe (meets minimum distance and velocity)
        else if (
          absDeltaX >= SWIPE_CONFIG.minDistance &&
          absVelocity >= SWIPE_CONFIG.minVelocity
        ) {
          shouldNavigate = true;
          navDirection = deltaX > 0 ? 'prev' : 'next';
          log('Normal swipe detected:', navDirection);
        } else {
          log('Swipe too short or slow:', { absDeltaX, absVelocity, duration });
        }

        // Set animating phase
        setSwipeState((prev) => ({
          ...prev,
          phase: 'animating',
        }));

        if (shouldNavigate && navDirection) {
          isNavigatingRef.current = true;

          try {
            log('Navigating:', navDirection);
            await onNavigateRef.current(navDirection);
          } finally {
            isNavigatingRef.current = false;
          }
        }

        // Reset state after animation
        setTimeout(() => {
          setSwipeState(initialSwipeState);
          onSwipeEndRef.current?.(shouldNavigate);
        }, shouldNavigate ? 300 : 200);
      };

      /**
       * Handle touch cancel
       */
      const handleTouchCancel = () => {
        localTouchStart = null;
        localLastTouch = null;
        isSwiping = false;
        setSwipeState(initialSwipeState);
        onSwipeEndRef.current?.(false);
      };

      // Bind events directly to iframe document
      // Use passive: false for touchmove to allow preventDefault
      doc.addEventListener('touchstart', handleTouchStart, { passive: true });
      doc.addEventListener('touchmove', handleTouchMove, { passive: false });
      doc.addEventListener('touchend', handleTouchEnd, { passive: true });
      doc.addEventListener('touchcancel', handleTouchCancel, { passive: true });

      log('Swipe events bound to iframe document');

      // Store cleanup function on the document for later removal
      // @ts-expect-error - custom property for cleanup
      doc.__swipeNavCleanup = () => {
        doc.removeEventListener('touchstart', handleTouchStart);
        doc.removeEventListener('touchmove', handleTouchMove);
        doc.removeEventListener('touchend', handleTouchEnd);
        doc.removeEventListener('touchcancel', handleTouchCancel);
        log('Cleaned up swipe event listeners');
      };
    };

    // Register the content hook
    rendition.hooks.content.register(contentHook);
    log('Content hook registered');

    // Also set up existing contents (for pages already rendered)
    try {
      const existingContents = rendition.getContents();
      if (existingContents && existingContents.length > 0) {
        log('Setting up events for existing contents:', existingContents.length);
        existingContents.forEach(contentHook);
      }
    } catch (e) {
      log('Error setting up existing contents:', e);
    }

    // Cleanup
    return () => {
      log('Cleaning up swipe navigation');

      // Cleanup content hook
      try {
        rendition.hooks.content.deregister(contentHook);
      } catch (e) {
        log('Error deregistering content hook:', e);
      }

      // Clean up any existing document listeners
      try {
        const contents = rendition.getContents();
        if (contents) {
          contents.forEach((c) => {
            // @ts-expect-error - custom property for cleanup
            if (c.document && c.document.__swipeNavCleanup) {
              // @ts-expect-error - custom property for cleanup
              c.document.__swipeNavCleanup();
            }
          });
        }
      } catch (e) {
        log('Error cleaning up document listeners:', e);
      }
    };
  }, [rendition, checkBoundary]);

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

  // Empty handlers for fallback (actual events are bound to iframe)
  const noopHandler = useCallback(() => {}, []);

  return {
    swipeState,
    overlayStyle,
    touchHandlers: {
      onTouchStart: noopHandler as unknown as (e: React.TouchEvent) => void,
      onTouchMove: noopHandler as unknown as (e: React.TouchEvent) => void,
      onTouchEnd: noopHandler as unknown as (e: React.TouchEvent) => void,
      onTouchCancel: noopHandler as unknown as (e: React.TouchEvent) => void,
    },
    isActive: swipeState.swiping,
  };
};

export default useSwipeNavigation;
