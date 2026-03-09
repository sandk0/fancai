import { describe, it, expect } from 'vitest';

import {
  FOLLOW_FINGER_CONFIG,
  shouldNavigate,
  calculateVelocity,
  getStageInfo,
  getRubberBandOffset,
  getSpringConfig,
  SPRING_FAST,
  SPRING_NORMAL,
  SPRING_RUBBER,
} from '../useFollowFingerSwipe';

/**
 * Tests for useFollowFingerSwipe utility functions.
 *
 * We test the exported pure utility functions directly rather than
 * trying to simulate real DOM touch events in JSDOM. The hook itself
 * wires these utilities together with touch event handlers.
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

describe('useFollowFingerSwipe', () => {
  describe('FOLLOW_FINGER_CONFIG', () => {
    it('exports config with expected keys', () => {
      expect(FOLLOW_FINGER_CONFIG).toBeDefined();
      expect(FOLLOW_FINGER_CONFIG.tapVsSwipeThreshold).toBe(10);
      expect(FOLLOW_FINGER_CONFIG.navigateThreshold).toBe(0.25);
      expect(FOLLOW_FINGER_CONFIG.quickSwipeVelocity).toBe(0.3);
      expect(FOLLOW_FINGER_CONFIG.quickSwipeMinDistance).toBe(15);
      expect(FOLLOW_FINGER_CONFIG.maxVerticalRatio).toBe(2.0);
      expect(FOLLOW_FINGER_CONFIG.rubberBandResistance).toBe(0.4);
      expect(FOLLOW_FINGER_CONFIG.maxRubberBand).toBe(80);
    });
  });

  describe('tracking - touchmove updates translateX', () => {
    it('getStageInfo returns correct stage dimensions', () => {
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
      expect(info!.maxScroll).toBe(750); // 1125 - 375
    });

    it('getStageInfo returns null for null rendition', () => {
      const info = getStageInfo(null);
      expect(info).toBeNull();
    });

    it('getStageInfo returns null when no manager', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo({} as any);
      expect(info).toBeNull();
    });
  });

  describe('tap vs swipe discrimination', () => {
    it('movement < tapVsSwipeThreshold is not a swipe', () => {
      // With 9px offset (< 10px threshold), should not navigate
      const result = shouldNavigate(9, 0, 375);
      expect(result).toBe(false);
    });

    it('movement > tapVsSwipeThreshold with enough offset navigates', () => {
      // 25% of 375 = 93.75; offset of 100 > 93.75
      const result = shouldNavigate(100, 0.1, 375);
      expect(result).toBe(true);
    });
  });

  describe('navigate threshold - offset > 25% viewportWidth', () => {
    it('offset > 25% viewport triggers navigation', () => {
      // 25% of 375 = 93.75
      const result = shouldNavigate(94, 0, 375);
      expect(result).toBe(true);
    });

    it('offset < 25% viewport does not trigger navigation (without velocity)', () => {
      // 25% of 375 = 93.75
      const result = shouldNavigate(93, 0, 375);
      expect(result).toBe(false);
    });

    it('negative offset (swipe left) works the same', () => {
      const result = shouldNavigate(-100, 0, 375);
      expect(result).toBe(true);
    });
  });

  describe('velocity flick - fast swipe navigates at small offset', () => {
    it('velocity > 0.3px/ms and offset > 15px triggers navigation', () => {
      // velocity = 0.5 px/ms, offset = 20px (small but enough for flick)
      const result = shouldNavigate(20, 0.5, 375);
      expect(result).toBe(true);
    });

    it('velocity > 0.3px/ms but offset < 15px does not trigger', () => {
      // velocity = 0.5 px/ms, offset = 10px (below quickSwipeMinDistance)
      const result = shouldNavigate(10, 0.5, 375);
      expect(result).toBe(false);
    });

    it('negative velocity flick works', () => {
      const result = shouldNavigate(-20, -0.5, 375);
      expect(result).toBe(true);
    });

    it('moderate velocity with small offset does not navigate', () => {
      // velocity = 0.2 px/ms (below threshold), offset = 20px (below 25%)
      const result = shouldNavigate(20, 0.2, 375);
      expect(result).toBe(false);
    });
  });

  describe('spring animation config', () => {
    it('SPRING_FAST has stiffness 400 and damping 40', () => {
      expect(SPRING_FAST.stiffness).toBe(400);
      expect(SPRING_FAST.damping).toBe(40);
      expect(SPRING_FAST.mass).toBe(1);
    });

    it('SPRING_NORMAL has stiffness 300 and damping 35', () => {
      expect(SPRING_NORMAL.stiffness).toBe(300);
      expect(SPRING_NORMAL.damping).toBe(35);
      expect(SPRING_NORMAL.mass).toBe(1);
    });

    it('SPRING_RUBBER has stiffness 200 and damping 28', () => {
      expect(SPRING_RUBBER.stiffness).toBe(200);
      expect(SPRING_RUBBER.damping).toBe(28);
      expect(SPRING_RUBBER.mass).toBe(1);
    });

    it('getSpringConfig returns FAST for velocity > 0.5', () => {
      expect(getSpringConfig(0.6)).toBe(SPRING_FAST);
      expect(getSpringConfig(-0.6)).toBe(SPRING_FAST);
    });

    it('getSpringConfig returns NORMAL for velocity 0.1-0.5', () => {
      expect(getSpringConfig(0.3)).toBe(SPRING_NORMAL);
      expect(getSpringConfig(-0.2)).toBe(SPRING_NORMAL);
    });

    it('getSpringConfig returns RUBBER for velocity < 0.1', () => {
      expect(getSpringConfig(0.05)).toBe(SPRING_RUBBER);
      expect(getSpringConfig(0)).toBe(SPRING_RUBBER);
    });
  });

  describe('boundary detection', () => {
    it('isAtStart when scrollLeft <= 0', () => {
      const rendition = createMockRendition({ scrollLeft: 0, clientWidth: 375, scrollWidth: 1125 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);
      expect(info!.isAtStart).toBe(true);
      expect(info!.isAtEnd).toBe(false);
    });

    it('isAtEnd when scrollLeft >= scrollWidth - clientWidth - 1', () => {
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

    it('neither boundary in the middle', () => {
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

    it('isAtEnd handles off-by-one (scrollLeft = maxScroll - 1)', () => {
      // maxScroll = 1125 - 375 = 750. scrollLeft = 749 should be at end.
      const rendition = createMockRendition({
        scrollLeft: 749,
        clientWidth: 375,
        scrollWidth: 1125,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = getStageInfo(rendition as any);
      expect(info!.isAtEnd).toBe(true);
    });
  });

  describe('rubber-band offset', () => {
    it('applies resistance factor (0.4) to deltaX', () => {
      // deltaX = 100, resistance = 0.4 -> result = 40
      const result = getRubberBandOffset(100);
      expect(result).toBe(40);
    });

    it('clamps to maxRubberBand (80px)', () => {
      // deltaX = 300, resistance = 0.4 -> raw = 120, clamped to 80
      const result = getRubberBandOffset(300);
      expect(result).toBe(80);
    });

    it('negative deltaX clamps to -maxRubberBand', () => {
      const result = getRubberBandOffset(-300);
      expect(result).toBe(-80);
    });

    it('small deltaX is not clamped', () => {
      // deltaX = 50, resistance = 0.4 -> 20, well under 80
      const result = getRubberBandOffset(50);
      expect(result).toBe(20);
    });
  });

  describe('velocity calculation', () => {
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
      // moved -100px in 200ms -> -0.5 px/ms
      const v = calculateVelocity(100, 500, 200, 300);
      expect(v).toBe(-0.5);
    });
  });

  describe('vertical scroll cancellation', () => {
    it('maxVerticalRatio is 2.0 in config', () => {
      // This verifies the config value; the actual cancellation is in the hook
      expect(FOLLOW_FINGER_CONFIG.maxVerticalRatio).toBe(2.0);
    });
  });
});
