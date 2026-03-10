/**
 * FollowFingerContainer - Wrapper for follow-finger swipe navigation
 *
 * Wraps the epub-viewer with a GPU-accelerated transform layer that
 * follows the user's finger during swipe gestures. Provides:
 * - m.div with translateX motion value for smooth transform
 * - Gradient edge shadows via useTransform (zero JS DOM mutations per frame)
 * - pointer-events: none during tracking to prevent broken hit testing
 * - ChapterHint overlay for boundary swipes
 *
 * @module components/Reader/FollowFingerContainer
 */

import type { ReactNode } from 'react';
import { m, useTransform } from 'motion/react';
import type { MotionValue } from 'motion/react';
import { ChapterHint } from './ChapterHint';
import type { FollowFingerPhase } from '@/hooks/epub/useFollowFingerSwipe';

export interface FollowFingerContainerProps {
  translateX: MotionValue<number>;
  phase: FollowFingerPhase;
  isAtBoundary: 'start' | 'end' | null;
  showChapterHint: boolean;
  chapterHintDirection: 'next' | 'prev' | null;
  children: ReactNode;
}

export const FollowFingerContainer = ({
  translateX,
  phase,
  showChapterHint,
  chapterHintDirection,
  children,
}: FollowFingerContainerProps) => {
  // Derive shadow opacity from translateX — pure GPU, no JS DOM mutations per frame.
  // Swiping right (prev): translateX goes 0→94, left shadow fades in 0→1
  // Swiping left (next): translateX goes -94→0, right shadow fades in 1→0
  const leftShadowOpacity = useTransform(translateX, [0, 94], [0, 1]);
  const rightShadowOpacity = useTransform(translateX, [-94, 0], [1, 0]);

  const isActive = phase !== 'idle';

  return (
    <div
      style={{
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      <m.div
        style={{
          x: translateX,
          width: '100%',
          height: '100%',
          position: 'relative',
          // Disable pointer events during active swipe to prevent broken hit testing
          // (CSS transform shifts visuals but iframe coordinates stay the same)
          pointerEvents: isActive ? 'none' : 'auto',
        }}
      >
        {children}
      </m.div>

      {/* Left edge gradient shadow (visible when swiping right / prev page) */}
      <m.div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 20,
          height: '100%',
          background: 'linear-gradient(to right, rgba(0,0,0,0.12), transparent)',
          opacity: leftShadowOpacity,
          pointerEvents: 'none',
          willChange: 'opacity',
          zIndex: 10,
        }}
      />

      {/* Right edge gradient shadow (visible when swiping left / next page) */}
      <m.div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 20,
          height: '100%',
          background: 'linear-gradient(to left, rgba(0,0,0,0.12), transparent)',
          opacity: rightShadowOpacity,
          pointerEvents: 'none',
          willChange: 'opacity',
          zIndex: 10,
        }}
      />

      {/* Chapter hint at boundary */}
      <ChapterHint direction={chapterHintDirection} visible={showChapterHint} />
    </div>
  );
};

export default FollowFingerContainer;
