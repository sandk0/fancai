import { describe, it, expect } from 'vitest';

import type { GestureControllerOptions, GestureControllerReturn } from '../useGestureController';

/**
 * Tests for useGestureController.
 *
 * The gesture controller is difficult to unit-test because it binds
 * touch events to an epub.js iframe document via hooks.content.register().
 * JSDOM cannot simulate real iframe touch events.
 *
 * We focus on:
 * 1. Smoke test: module imports without errors
 * 2. Type verification: exported interfaces are usable
 * 3. Reused utilities: tested via useFollowFingerSwipe.test.ts
 */

describe('useGestureController', () => {
  describe('module import', () => {
    it('imports useGestureController without errors', async () => {
      const mod = await import('../useGestureController');
      expect(mod.useGestureController).toBeDefined();
      expect(typeof mod.useGestureController).toBe('function');
    });

    it('exports default as useGestureController', async () => {
      const mod = await import('../useGestureController');
      expect(mod.default).toBe(mod.useGestureController);
    });
  });

  describe('exported types', () => {
    it('GestureControllerOptions type has required fields', () => {
      // Type-level test: verify the interface shape compiles correctly.
      // If any required field is missing, TypeScript will error at build time.
      const mockOptions: GestureControllerOptions = {
        rendition: null,
        enabled: true,
        onNavigate: async () => {},
        onEdgeTap: () => {},
        onCenterTap: () => {},
        onToggleUI: () => {},
        onSwipeStart: () => {},
        onTapNavigate: () => {},
        navLock: { acquire: () => true, release: () => {}, isLocked: false },
        isPanelOpen: false,
        pageAnimationEnabled: true,
      };

      expect(mockOptions.rendition).toBeNull();
      expect(mockOptions.enabled).toBe(true);
      expect(typeof mockOptions.onNavigate).toBe('function');
      expect(typeof mockOptions.onEdgeTap).toBe('function');
      expect(typeof mockOptions.onCenterTap).toBe('function');
      expect(typeof mockOptions.onToggleUI).toBe('function');
      expect(typeof mockOptions.onSwipeStart).toBe('function');
      expect(typeof mockOptions.onTapNavigate).toBe('function');
      expect(typeof mockOptions.isPanelOpen).toBe('boolean');
    });

    it('GestureControllerReturn type shape is correct', () => {
      // Verify the expected return shape. At runtime we just check the type
      // structure compiles -- the actual hook requires a real rendition.
      const mockReturn: GestureControllerReturn = {
        translateX: {
          get: () => 0,
          set: () => {},
        } as unknown as GestureControllerReturn['translateX'],
        phase: 'idle',
        isAtBoundary: null,
        showChapterHint: false,
        chapterHintDirection: null,
        triggerSlideAnimation: () => {},
      };

      expect(mockReturn.phase).toBe('idle');
      expect(mockReturn.isAtBoundary).toBeNull();
      expect(mockReturn.showChapterHint).toBe(false);
      expect(mockReturn.chapterHintDirection).toBeNull();
      expect(typeof mockReturn.triggerSlideAnimation).toBe('function');
    });
  });

  describe('reused utilities from useFollowFingerSwipe', () => {
    it('gesture controller imports all required utilities', async () => {
      // Verify the module imports compile and the utilities are accessible
      // from the shared module (tested in detail in useFollowFingerSwipe.test.ts)
      const swipeMod = await import('../useFollowFingerSwipe');

      expect(swipeMod.FOLLOW_FINGER_CONFIG).toBeDefined();
      expect(swipeMod.SPRING_FAST).toBeDefined();
      expect(swipeMod.SPRING_RUBBER).toBeDefined();
      expect(swipeMod.SPRING_SWIPE).toBeDefined();
      expect(swipeMod.SPRING_TAP).toBeDefined();
      expect(swipeMod.getStageInfo).toBeDefined();
      expect(swipeMod.shouldNavigate).toBeDefined();
      expect(swipeMod.calculateVelocity).toBeDefined();
      expect(swipeMod.getRubberBandOffset).toBeDefined();
      expect(swipeMod.getSpringConfig).toBeDefined();
    });
  });
});
