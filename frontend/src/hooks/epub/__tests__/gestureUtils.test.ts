import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock motion/react animate at file level (vi.mock is hoisted)
vi.mock('motion/react', () => ({
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

import {
  FOLLOW_FINGER_CONFIG,
  SPRING_FAST,
  SPRING_RUBBER,
  SPRING_TAP,
  INITIAL_TOUCH,
  shouldNavigate,
  calculateVelocity,
  getStageInfo,
  getRubberBandOffset,
  processTouchStart,
  processTouchMove,
  processSwipeCompletion,
  processTouchCancel,
} from '../gestureUtils';
import type {
  FollowFingerPhase,
  StageInfo,
  GestureState,
  GestureFSMDeps,
  SwipeCompletionDeps,
} from '../gestureUtils';

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

  // ---------------------------------------------------------------------------
  // Shared FSM functions
  // ---------------------------------------------------------------------------

  describe('shared FSM functions', () => {
    function createMockTouch(overrides: Partial<Touch> = {}): Touch {
      return {
        clientX: 200,
        clientY: 300,
        identifier: 0,
        pageX: 200,
        pageY: 300,
        screenX: 200,
        screenY: 300,
        target: document.body,
        radiusX: 0,
        radiusY: 0,
        rotationAngle: 0,
        force: 0,
        ...overrides,
      } as Touch;
    }

    function createMockTouchEvent(
      touches: Partial<Touch>[],
      changedTouches?: Partial<Touch>[]
    ): TouchEvent {
      return {
        touches: touches.map((t) => createMockTouch(t)),
        changedTouches: (changedTouches || touches).map((t) => createMockTouch(t)),
        cancelable: true,
        preventDefault: vi.fn(),
      } as unknown as TouchEvent;
    }

    function createMockDeps(overrides: Partial<GestureFSMDeps> = {}): GestureFSMDeps {
      return {
        touchRef: { current: { ...INITIAL_TOUCH } },
        translateX: {
          set: vi.fn(),
          get: vi.fn(() => 0),
        } as unknown as GestureFSMDeps['translateX'],
        animationRef: { current: null },
        enabledRef: { current: true },
        isPanelOpenRef: { current: false },
        rendition: null,
        setPhase: vi.fn(),
        setIsAtBoundary: vi.fn(),
        setShowChapterHint: vi.fn(),
        setChapterHintDirection: vi.fn(),
        showChapterHintRef: { current: false },
        chapterHintDirectionRef: { current: null },
        isAtBoundaryRef: { current: null },
        onSwipeStartRef: { current: vi.fn() },
        resetState: vi.fn(),
        ...overrides,
      };
    }

    function createMockSwipeDeps(
      overrides: Partial<SwipeCompletionDeps> = {}
    ): SwipeCompletionDeps {
      const baseDeps = createMockDeps(overrides);
      return {
        ...baseDeps,
        onNavigateRef: { current: vi.fn(async () => {}) },
        onChapterChangeRef: { current: vi.fn(async () => {}) },
        navLockRef: {
          current: {
            acquire: vi.fn(() => true),
            release: vi.fn(),
            forceRelease: vi.fn(),
            isLocked: vi.fn(() => false),
          },
        },
        pageAnimationEnabledRef: { current: true },
        ...overrides,
      } as SwipeCompletionDeps;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('INITIAL_TOUCH and TouchState', () => {
      it('INITIAL_TOUCH has correct default values', () => {
        expect(INITIAL_TOUCH.state).toBe('idle');
        expect(INITIAL_TOUCH.startX).toBe(0);
        expect(INITIAL_TOUCH.startY).toBe(0);
        expect(INITIAL_TOUCH.startTime).toBe(0);
        expect(INITIAL_TOUCH.lastTouchX).toBe(0);
        expect(INITIAL_TOUCH.lastTouchTime).toBe(0);
        expect(INITIAL_TOUCH.boundary).toBeNull();
      });

      it('GestureState type includes all states', () => {
        const states: GestureState[] = ['idle', 'pending', 'swiping', 'cancelled'];
        expect(states).toHaveLength(4);
      });
    });

    describe('processTouchStart', () => {
      it('sets touchRef state to pending with correct coordinates', () => {
        const deps = createMockDeps();
        const touch = createMockTouch({ clientX: 150, clientY: 250 });

        processTouchStart(touch, deps);

        expect(deps.touchRef.current.state).toBe('pending');
        expect(deps.touchRef.current.startX).toBe(150);
        expect(deps.touchRef.current.startY).toBe(250);
      });

      it('stops running animation', () => {
        const stopFn = vi.fn();
        const deps = createMockDeps({
          animationRef: {
            current: { stop: stopFn } as unknown as ReturnType<
              typeof import('motion/react').animate
            >,
          },
        });
        const touch = createMockTouch();

        processTouchStart(touch, deps);

        expect(stopFn).toHaveBeenCalled();
        expect(deps.animationRef.current).toBeNull();
      });

      it('returns early when checkSelection returns true', () => {
        const deps = createMockDeps();
        const touch = createMockTouch();

        processTouchStart(touch, deps, () => true);

        expect(deps.touchRef.current.state).toBe('idle');
      });

      it('returns early when disabled', () => {
        const deps = createMockDeps({ enabledRef: { current: false } });
        const touch = createMockTouch();

        processTouchStart(touch, deps);

        expect(deps.touchRef.current.state).toBe('idle');
      });

      it('detects boundary start when rendition isAtStart', () => {
        const rendition = createMockRendition({
          scrollLeft: 0,
          clientWidth: 375,
          scrollWidth: 1125,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deps = createMockDeps({ rendition: rendition as any });
        const touch = createMockTouch();

        processTouchStart(touch, deps);

        expect(deps.touchRef.current.boundary).toBe('start');
      });

      it('detects boundary null for single-page chapter', () => {
        const rendition = createMockRendition({
          scrollLeft: 0,
          clientWidth: 375,
          scrollWidth: 375,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deps = createMockDeps({ rendition: rendition as any });
        const touch = createMockTouch();

        processTouchStart(touch, deps);

        expect(deps.touchRef.current.boundary).toBeNull();
      });
    });

    describe('processTouchMove', () => {
      it('returns early for idle state', () => {
        const deps = createMockDeps();
        deps.touchRef.current.state = 'idle';
        const e = createMockTouchEvent([{ clientX: 220 }]);

        processTouchMove(e, deps);

        expect(deps.translateX.set).not.toHaveBeenCalled();
      });

      it('cancels when checkSelection returns true', () => {
        const deps = createMockDeps();
        deps.touchRef.current = {
          ...INITIAL_TOUCH,
          state: 'pending',
          startX: 200,
          startY: 300,
        };
        const e = createMockTouchEvent([{ clientX: 220, clientY: 300 }]);

        processTouchMove(e, deps, () => true);

        expect(deps.touchRef.current.state).toBe('cancelled');
      });

      it('cancels for vertical scroll', () => {
        const deps = createMockDeps();
        deps.touchRef.current = {
          ...INITIAL_TOUCH,
          state: 'pending',
          startX: 200,
          startY: 300,
        };
        // deltaY=25 (>10), deltaX=2 => ratio=12.5 (>1.5) => vertical cancel
        const e = createMockTouchEvent([{ clientX: 202, clientY: 325 }]);

        processTouchMove(e, deps);

        expect(deps.touchRef.current.state).toBe('cancelled');
      });

      it('transitions from pending to swiping', () => {
        const deps = createMockDeps();
        deps.touchRef.current = {
          ...INITIAL_TOUCH,
          state: 'pending',
          startX: 200,
          startY: 300,
          lastTouchX: 200,
          lastTouchTime: Date.now(),
        };
        // deltaX=15 (>10 threshold), horizontal movement
        const e = createMockTouchEvent([{ clientX: 215, clientY: 302 }]);

        processTouchMove(e, deps);

        expect(deps.touchRef.current.state).toBe('swiping');
        expect(deps.setPhase).toHaveBeenCalledWith('tracking');
        expect(deps.onSwipeStartRef.current).toHaveBeenCalled();
      });

      it('blocks swipe when panel is open', () => {
        const deps = createMockDeps({ isPanelOpenRef: { current: true } });
        deps.touchRef.current = {
          ...INITIAL_TOUCH,
          state: 'pending',
          startX: 200,
          startY: 300,
        };
        const e = createMockTouchEvent([{ clientX: 215, clientY: 300 }]);

        processTouchMove(e, deps);

        expect(deps.touchRef.current.state).toBe('cancelled');
      });
    });

    describe('processSwipeCompletion', () => {
      it('navigates on sufficient offset', async () => {
        const deps = createMockSwipeDeps();
        // Mock getStageInfo via rendition
        const rendition = createMockRendition({ clientWidth: 375 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deps.rendition = rendition as any;

        // startX=200, touch.clientX=50 => deltaX=-150 => abs=150 > 25% of 375 (93.75)
        const touch = createMockTouch({ clientX: 50 });

        processSwipeCompletion(touch, 200, 180, Date.now() - 50, null, deps);

        // Should call setPhase('animating')
        expect(deps.setPhase).toHaveBeenCalledWith('animating');
      });

      it('snaps back on insufficient offset', async () => {
        const deps = createMockSwipeDeps();
        const rendition = createMockRendition({ clientWidth: 375 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deps.rendition = rendition as any;

        // startX=200, touch.clientX=180 => deltaX=-20 => abs=20 < 25% of 375 (93.75)
        const touch = createMockTouch({ clientX: 180 });

        processSwipeCompletion(touch, 200, 195, Date.now() - 50, null, deps);

        expect(deps.setPhase).toHaveBeenCalledWith('animating');
        // animate should have been called for snap-back
        const { animate } = await import('motion/react');
        expect(animate).toHaveBeenCalled();
      });
    });

    describe('processTouchCancel', () => {
      it('animates snap-back when swiping', () => {
        const deps = createMockDeps();
        deps.touchRef.current = { ...INITIAL_TOUCH, state: 'swiping' };

        processTouchCancel(deps);

        expect(deps.setPhase).toHaveBeenCalledWith('animating');
        expect(deps.touchRef.current.state).toBe('cancelled');
      });

      it('resets to idle when not swiping', () => {
        const deps = createMockDeps();
        deps.touchRef.current = { ...INITIAL_TOUCH, state: 'pending' };

        processTouchCancel(deps);

        expect(deps.resetState).toHaveBeenCalled();
        expect(deps.touchRef.current.state).toBe('idle');
      });
    });
  });
});
