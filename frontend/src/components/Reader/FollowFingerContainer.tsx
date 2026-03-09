/**
 * FollowFingerContainer - Wrapper for follow-finger swipe navigation
 *
 * Wraps the epub-viewer with a GPU-accelerated transform layer that
 * follows the user's finger during swipe gestures. Provides:
 * - m.div with translateX motion value for smooth transform
 * - Box-shadow between pages during swipe
 * - pointer-events: none during tracking to prevent broken hit testing
 * - ChapterHint overlay for boundary swipes
 *
 * @module components/Reader/FollowFingerContainer
 */

import { useRef, type ReactNode } from 'react';
import { m, useMotionValueEvent } from 'motion/react';
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
  const shadowRef = useRef<HTMLDivElement>(null);

  // Reactively update box-shadow based on translateX changes.
  // Uses useMotionValueEvent to avoid re-renders -- directly mutates DOM.
  useMotionValueEvent(translateX, 'change', (v) => {
    const shadow = shadowRef.current;
    if (!shadow) return;

    if (v === 0) {
      shadow.style.opacity = '0';
      return;
    }

    // Calculate shadow intensity based on progress
    // Full intensity at 25% of a typical mobile viewport (~375px * 0.25 = ~94px)
    const progress = Math.min(1, Math.abs(v) / 94);
    const opacity = progress * 0.15;
    const blur = progress * 20;

    shadow.style.opacity = '1';

    if (v < 0) {
      // Swiping left (next page) -- shadow on right edge
      shadow.style.left = 'auto';
      shadow.style.right = '0px';
      shadow.style.boxShadow = `-${blur}px 0 ${blur}px -${blur / 2}px rgba(0,0,0,${opacity})`;
    } else {
      // Swiping right (prev page) -- shadow on left edge
      shadow.style.right = 'auto';
      shadow.style.left = '0px';
      shadow.style.boxShadow = `${blur}px 0 ${blur}px -${blur / 2}px rgba(0,0,0,${opacity})`;
    }
  });

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

      {/* Shadow divider between pages */}
      <div
        ref={shadowRef}
        style={{
          position: 'absolute',
          top: 0,
          width: '1px',
          height: '100%',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 10,
          transition: 'opacity 0.1s ease-out',
        }}
      />

      {/* Chapter hint at boundary */}
      <ChapterHint direction={chapterHintDirection} visible={showChapterHint} />
    </div>
  );
};

export default FollowFingerContainer;
