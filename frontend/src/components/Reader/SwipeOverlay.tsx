/**
 * SwipeOverlay - Visual overlay for swipe navigation
 *
 * Renders a transparent overlay that tracks finger movement during swipe gestures.
 * Shows visual feedback (indicators, progress) and provides smooth animations.
 *
 * Features:
 * - Finger tracking during swipe
 * - Edge indicators showing navigation direction
 * - Smooth spring animations
 * - Boundary feedback (rubber band effect)
 *
 * @component
 */

import React, { memo, useMemo } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import type { SwipeState } from '@/hooks/epub/useSwipeNavigation';
import SwipeIndicator from './SwipeIndicator';

interface SwipeOverlayProps {
  /** Current swipe state from useSwipeNavigation hook */
  swipeState: SwipeState;
  /** Width of the viewport */
  viewportWidth: number;
  /** Callback when snap animation completes */
  onAnimationComplete?: () => void;
  /** Header height to offset from top */
  headerHeight?: number;
}

// Spring configuration for smooth animations
const SPRING_CONFIG = {
  // Snap to page
  snap: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
    mass: 1,
  },
  // Snap back (swipe cancelled)
  snapBack: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 35,
    mass: 0.8,
  },
};

/**
 * SwipeOverlay component
 *
 * Renders visual feedback during swipe gestures including:
 * - Background overlay with subtle gradient
 * - Edge indicators (left/right chevrons)
 * - Progress feedback
 */
export const SwipeOverlay: React.FC<SwipeOverlayProps> = memo(({
  swipeState,
  viewportWidth,
  onAnimationComplete: _onAnimationComplete,
  headerHeight = 70,
}) => {
  // Calculate progress as percentage of viewport
  const swipeProgress = useMemo(() => {
    const absOffset = Math.abs(swipeState.offset);
    const threshold = viewportWidth * 0.25; // 25% of viewport for full indicator
    return Math.min(1, absOffset / threshold);
  }, [swipeState.offset, viewportWidth]);

  // Determine animation config based on phase
  const animationConfig = useMemo(() => {
    if (swipeState.phase === 'animating') {
      return swipeState.offset !== 0 ? SPRING_CONFIG.snap : SPRING_CONFIG.snapBack;
    }
    return { duration: 0 };
  }, [swipeState.phase, swipeState.offset]);

  // Calculate background gradient opacity
  const gradientOpacity = useMemo(() => {
    if (!swipeState.swiping) return 0;
    return swipeProgress * 0.15;
  }, [swipeState.swiping, swipeProgress]);

  // Determine which indicators to show
  const showLeftIndicator = swipeState.swiping && swipeState.direction === 'right';
  const showRightIndicator = swipeState.swiping && swipeState.direction === 'left';

  // Show boundary feedback
  const showBoundaryFeedback = swipeState.atBoundary !== null && swipeState.swiping;

  return (
    <AnimatePresence>
      {swipeState.swiping && (
        <m.div
          className="fixed inset-0 pointer-events-none overflow-hidden"
          style={{
            top: `calc(${headerHeight}px + env(safe-area-inset-top))`,
            zIndex: 10,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Gradient overlay for visual feedback */}
          <m.div
            className="absolute inset-0"
            style={{
              background: swipeState.direction === 'right'
                ? `linear-gradient(to right, rgba(var(--primary-rgb), ${gradientOpacity}), transparent 50%)`
                : swipeState.direction === 'left'
                  ? `linear-gradient(to left, rgba(var(--primary-rgb), ${gradientOpacity}), transparent 50%)`
                  : 'transparent',
            }}
            animate={{
              x: swipeState.phase === 'tracking' ? swipeState.offset * 0.1 : 0,
            }}
            transition={animationConfig}
          />

          {/* Edge indicators */}
          <SwipeIndicator
            direction="left"
            visible={showLeftIndicator}
            progress={swipeProgress}
            edgeOffset={20}
          />
          <SwipeIndicator
            direction="right"
            visible={showRightIndicator}
            progress={swipeProgress}
            edgeOffset={20}
          />

          {/* Boundary feedback - shows when at chapter edge */}
          {showBoundaryFeedback && (
            <m.div
              className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2
                         bg-muted/90 backdrop-blur-sm rounded-full text-sm
                         text-muted-foreground border border-border"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              {swipeState.atBoundary === 'start' ? 'Начало главы' : 'Конец главы'}
            </m.div>
          )}

          {/* Debug info (only in development) */}
          {import.meta.env.DEV && (
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1
                         bg-black/80 text-white text-xs font-mono rounded"
            >
              {swipeState.direction || 'idle'} |
              {Math.round(swipeState.offset)}px |
              v:{swipeState.velocity.toFixed(2)} |
              {swipeState.phase}
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
});

SwipeOverlay.displayName = 'SwipeOverlay';

export default SwipeOverlay;
