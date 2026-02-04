/**
 * SwipeIndicator - Visual feedback for swipe navigation
 *
 * Shows directional arrows during swipe gestures to indicate
 * which direction the user is swiping and whether navigation
 * will occur.
 *
 * @component
 */

import React, { memo } from 'react';
import { m } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SwipeIndicatorProps {
  /** Direction of the indicator */
  direction: 'left' | 'right';
  /** Whether the indicator is visible */
  visible: boolean;
  /** Opacity based on swipe progress (0-1) */
  progress: number;
  /** Position from edge in pixels */
  edgeOffset?: number;
}

/**
 * SwipeIndicator component
 *
 * Renders a chevron icon that appears during swipe gestures
 * to provide visual feedback about navigation direction.
 */
export const SwipeIndicator: React.FC<SwipeIndicatorProps> = memo(({
  direction,
  visible,
  progress,
  edgeOffset = 20,
}) => {
  // Clamp progress to 0-1 range
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Calculate opacity based on progress (fade in as user swipes)
  const opacity = visible ? clampedProgress * 0.8 : 0;

  // Calculate scale based on progress
  const scale = visible ? 0.8 + clampedProgress * 0.4 : 0.8;

  // Icon component
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;

  // Position styles
  const positionStyle: React.CSSProperties = {
    [direction]: edgeOffset,
  };

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity,
        scale,
      }}
      transition={{
        type: 'spring' as const,
        stiffness: 400,
        damping: 25,
      }}
      className="fixed top-1/2 -translate-y-1/2 z-50 pointer-events-none"
      style={positionStyle}
      aria-hidden="true"
    >
      <div
        className="flex items-center justify-center w-12 h-12 rounded-full
                   bg-primary/20 backdrop-blur-sm border border-primary/30"
        style={{
          boxShadow: `0 0 ${20 * clampedProgress}px rgba(var(--primary-rgb), 0.3)`,
        }}
      >
        <Icon
          className="w-6 h-6 text-primary"
          strokeWidth={2.5}
        />
      </div>
    </m.div>
  );
});

SwipeIndicator.displayName = 'SwipeIndicator';

export default SwipeIndicator;
