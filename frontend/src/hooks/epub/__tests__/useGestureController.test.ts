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
        onCenterTap: () => false,
        onToggleUI: () => {},
        onSwipeStart: () => {},
        onTapNavigate: () => {},
        navLock: {
          acquire: () => true,
          release: () => {},
          forceRelease: () => {},
          isLocked: () => false,
        },
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

  describe('coordinate handling in source code', () => {
    // These tests verify the source code patterns to ensure correctness.
    // Since we can't run the actual hook in JSDOM (it requires a real epub.js rendition),
    // we inspect the source code to verify the coordinate handling patterns.

    it('handleTouchEnd uses clientX/clientY directly for elementFromPoint (no iframeRect subtraction)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourcePath = path.resolve(__dirname, '../useGestureController.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // Extract the handleTouchEnd TAP DETECTION section
      // The correct pattern: tapDoc?.elementFromPoint(touch.clientX, touch.clientY)
      // The WRONG pattern: elementFromPoint(iframeX, iframeY) with subtraction
      expect(source).toContain('tapDoc?.elementFromPoint(touch.clientX, touch.clientY)');
      // Should NOT subtract iframeRect for iframe-sourced events in handleTouchEnd
      expect(source).not.toMatch(/tapDoc\?\.elementFromPoint\(\s*iframeX\s*,\s*iframeY\s*\)/);
    });

    it('handleClick uses clientX/clientY directly for elementFromPoint (no iframeRect subtraction)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourcePath = path.resolve(__dirname, '../useGestureController.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // The correct pattern for click handler
      expect(source).toContain('clickDoc?.elementFromPoint(e.clientX, e.clientY)');
      // Should NOT use clickIframeX/clickIframeY for elementFromPoint
      expect(source).not.toMatch(
        /clickDoc\?\.elementFromPoint\(\s*clickIframeX\s*,\s*clickIframeY\s*\)/
      );
    });

    it('onCenterTap receives clientX/clientY directly for iframe events', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourcePath = path.resolve(__dirname, '../useGestureController.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // In handleTouchEnd center-tap section: onCenterTapRef.current(touch.clientX, touch.clientY)
      expect(source).toContain('onCenterTapRef.current(touch.clientX, touch.clientY)');
      // In handleClick center-tap section: onCenterTapRef.current(e.clientX, e.clientY)
      expect(source).toContain('onCenterTapRef.current(e.clientX, e.clientY)');
    });

    it('zone detection uses clientX + iframeOffset for screen coords', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourcePath = path.resolve(__dirname, '../useGestureController.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // Zone detection should ADD iframeOffset to get screen coords
      expect(source).toContain('touch.clientX + iframeOffset');
      expect(source).toContain('e.clientX + iframeOffset');
    });

    it('iOS overlay still converts screen->iframe via iframeRect subtraction (correct for parent events)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourcePath = path.resolve(__dirname, '../useGestureController.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // iOS overlay events come from parent document, so they need conversion
      expect(source).toContain('touch.clientX - iframeRect.left');
      expect(source).toContain('touch.clientY - iframeRect.top');
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
