import { describe, it, expect } from 'vitest';

import {
  FOLLOW_FINGER_CONFIG,
  SPRING_FAST,
  SPRING_RUBBER,
  SPRING_TAP,
  shouldNavigate,
  calculateVelocity,
  getStageInfo,
  getRubberBandOffset,
} from '../gestureUtils';
import type { FollowFingerPhase, StageInfo } from '../gestureUtils';

/**
 * Tests for gestureUtils - pure utility functions extracted from useFollowFingerSwipe.
 *
 * Tests cover: config objects, shouldNavigate, calculateVelocity,
 * getStageInfo, getRubberBandOffset, and exported types.
 */

// Helper: create a mock stage container
function createMockStage(
  options: {
    scrollLeft?: number;
    clientWidth?: number;
    scrollWidth?: number;
  } = {}
) {
  const {
    scrollLeft = 0,
    clientWidth = 375,
    scrollWidth = 1125, // 3 pages
  } = options;

  return {
    scrollLeft,
    clientWidth,
    scrollWidth,
  };
}

// Helper: create a mock rendition with stage
function createMockRendition(stageOptions?: Parameters<typeof createMockStage>[0]) {
  const stage = createMockStage(stageOptions);
  return {
    manager: {
      stage: { container: stage },
    },
  };
}

describe('gestureUtils', () => {
  describe('FOLLOW_FINGER_CONFIG', () => {
    it('exports config with expected keys', () => {
      expect(FOLLOW_FINGER_CONFIG).toBeDefined();
      expect(FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold).toBe(10);
      expect(FOLLOW_FINGER_CONFIG.navigateThreshold).toBe(0.25);
      expect(FOLLOW_FINGER_CONFIG.quickSwipeVelocity).toBe(0.3);
      expect(FOLLOW_FINGER_CONFIG.quickSwipeMinDistance).toBe(10);
      expect(FOLLOW_FINGER_CONFIG.maxVerticalRatio).toBe(1.5);
      expect(FOLLOW_FINGER_CONFIG.rubberBandResistance).toBe(0.4);
      expect(FOLLOW_FINGER_CONFIG.maxRubberBand).toBe(100);
    });
  });

  describe('spring configs', () => {
    it('SPRING_FAST has stiffness 800 and damping 57', () => {
      expect(SPRING_FAST.stiffness).toBe(800);
      expect(SPRING_FAST.damping).toBe(57);
      expect(SPRING_FAST.mass).toBe(1);
    });

    it('SPRING_RUBBER has stiffness 400 and damping 40', () => {
      expect(SPRING_RUBBER.stiffness).toBe(400);
      expect(SPRING_RUBBER.damping).toBe(40);
      expect(SPRING_RUBBER.mass).toBe(1);
    });

    it('SPRING_TAP has stiffness 1000 and damping 57', () => {
      expect(SPRING_TAP.stiffness).toBe(1000);
      expect(SPRING_TAP.damping).toBe(57);
      expect(SPRING_TAP.mass).toBe(0.8);
    });
  });

  describe('shouldNavigate', () => {
    it('returns false for movement below threshold', () => {
      const result = shouldNavigate(9, 0, 375);
      expect(result).toBe(false);
    });

    it('returns true for offset > 25% viewport', () => {
      // 25% of 375 = 93.75
      const result = shouldNavigate(94, 0, 375);
      expect(result).toBe(true);
    });

    it('returns false for offset < 25% viewport without velocity', () => {
      const result = shouldNavigate(93, 0, 375);
      expect(result).toBe(false);
    });

    it('returns true for high velocity (quick flick)', () => {
      // velocity = 0.5 px/ms, offset = 20px
      const result = shouldNavigate(20, 0.5, 375);
      expect(result).toBe(true);
    });

    it('returns false for high velocity but offset below quickSwipeMinDistance', () => {
      const result = shouldNavigate(8, 0.5, 375);
      expect(result).toBe(false);
    });

    it('handles negative offset (swipe left)', () => {
      const result = shouldNavigate(-100, 0, 375);
      expect(result).toBe(true);
    });

    it('handles negative velocity flick', () => {
      const result = shouldNavigate(-20, -0.5, 375);
      expect(result).toBe(true);
    });
  });

  describe('calculateVelocity', () => {
    it('calculates velocity as deltaX / deltaTime', () => {
      // moved 100px in 200ms -> 0.5 px/ms
      const v = calculateVelocity(200, 500, 100, 300);
      expect(v).toBe(0.5);
    });

    it('returns 0 when deltaTime is 0', () => {
      const v = calculateVelocity(200, 500, 100, 500);
      expect(v).toBe(0);
    });

    it('returns negative velocity for leftward movement', () => {
      const v = calculateVelocity(100, 500, 200, 300);
      expect(v).toBe(-0.5);
    });
  });

  describe('getStageInfo', () => {
    it('returns correct stage dimensions', () => {
      const rendition = createMockRendition({
        scrollLeft: 375,
        clientWidth: 375,
        scrollWidth: 1125,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);

      expect(info).not.toBeNull();
      expect(info!.viewportWidth).toBe(375);
      expect(info!.currentScroll).toBe(375);
      expect(info!.maxScroll).toBe(750);
    });

    it('returns null for null rendition', () => {
      const info = getStageInfo(null);
      expect(info).toBeNull();
    });

    it('returns null when no manager', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo({} as any);
      expect(info).toBeNull();
    });

    it('detects isAtStart when scrollLeft <= 0', () => {
      const rendition = createMockRendition({ scrollLeft: 0, clientWidth: 375, scrollWidth: 1125 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);
      expect(info!.isAtStart).toBe(true);
      expect(info!.isAtEnd).toBe(false);
    });

    it('detects isAtEnd when scrollLeft >= maxScroll - 1', () => {
      const rendition = createMockRendition({
        scrollLeft: 750,
        clientWidth: 375,
        scrollWidth: 1125,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);
      expect(info!.isAtStart).toBe(false);
      expect(info!.isAtEnd).toBe(true);
    });

    it('detects neither boundary in the middle', () => {
      const rendition = createMockRendition({
        scrollLeft: 375,
        clientWidth: 375,
        scrollWidth: 1125,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);
      expect(info!.isAtStart).toBe(false);
      expect(info!.isAtEnd).toBe(false);
    });
  });

  describe('getRubberBandOffset', () => {
    it('applies resistance factor (0.4) to deltaX', () => {
      const result = getRubberBandOffset(100);
      expect(result).toBe(40);
    });

    it('clamps to maxRubberBand (100px)', () => {
      const result = getRubberBandOffset(300);
      expect(result).toBe(100);
    });

    it('negative deltaX clamps to -maxRubberBand', () => {
      const result = getRubberBandOffset(-300);
      expect(result).toBe(-100);
    });

    it('small deltaX is not clamped', () => {
      const result = getRubberBandOffset(50);
      expect(result).toBe(20);
    });
  });

  describe('FollowFingerPhase type', () => {
    it('accepts valid phase values', () => {
      const phases: FollowFingerPhase[] = ['idle', 'tracking', 'animating'];
      expect(phases).toHaveLength(3);
    });
  });

  describe('StageInfo type', () => {
    it('has expected shape', () => {
      const info: StageInfo = {
        stage: document.createElement('div'),
        currentScroll: 0,
        maxScroll: 750,
        viewportWidth: 375,
        isAtStart: true,
        isAtEnd: false,
      };
      expect(info.viewportWidth).toBe(375);
    });
  });
});
