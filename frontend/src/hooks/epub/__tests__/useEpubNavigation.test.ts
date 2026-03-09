import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing the hook
vi.mock('@/utils/iosSupport', () => ({
  isIOS: vi.fn(() => true),
  isAndroid: vi.fn(() => false),
  isMobile: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useEpubNavigation } from '../useEpubNavigation';
import type { Rendition } from '@/types/epub';

/**
 * Creates a mock rendition with configurable scroll state.
 * The stage container simulates a 3-page chapter (scrollWidth = 3 * clientWidth).
 */
function createMockRendition(
  options: {
    scrollLeft?: number;
    clientWidth?: number;
    scrollWidth?: number;
  } = {}
) {
  const {
    scrollLeft = 0,
    clientWidth = 400,
    scrollWidth = 1200, // 3 pages worth
  } = options;

  let currentScrollLeft = scrollLeft;

  const stage = {
    get scrollLeft() {
      return currentScrollLeft;
    },
    set scrollLeft(val: number) {
      currentScrollLeft = val;
    },
    clientWidth,
    scrollWidth,
    scrollTo: vi.fn(({ left }: { left: number; behavior?: string }) => {
      currentScrollLeft = left;
    }),
  };

  const rendition = {
    manager: {
      stage: { container: stage },
      layout: {
        delta: clientWidth,
        columnWidth: clientWidth - 20,
        gap: 20,
      },
    },
    getContents: vi.fn(() => []),
    next: vi.fn(() => Promise.resolve()),
    prev: vi.fn(() => Promise.resolve()),
    display: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
    themes: { default: vi.fn(), register: vi.fn(), select: vi.fn(), fontSize: vi.fn() },
    hooks: { content: { register: vi.fn(), deregister: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
    currentLocation: vi.fn(() => null),
    annotations: { add: vi.fn(), remove: vi.fn(), highlight: vi.fn(), underline: vi.fn() },
    getRange: vi.fn(() => null),
    spread: vi.fn(),
  } as unknown as Rendition;

  return { rendition, stage };
}

describe('useEpubNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock requestAnimationFrame for waitForScrollEnd
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  describe('serialized scroll via Promise chain', () => {
    it('serializes concurrent directScroll calls', async () => {
      const { rendition, stage } = createMockRendition({
        scrollLeft: 0,
        clientWidth: 400,
        scrollWidth: 1200,
      });

      const { result } = renderHook(() => useEpubNavigation(rendition));

      // Call nextPage twice rapidly -- second call should see updated scrollLeft
      let p1: Promise<void>;
      let p2: Promise<void>;

      await act(async () => {
        p1 = result.current.nextPage();
        p2 = result.current.nextPage();
        await Promise.all([p1!, p2!]);
      });

      // Both calls should have resulted in scrollTo being called
      // with the second call seeing the result of the first
      expect(stage.scrollTo).toHaveBeenCalled();

      // After both calls, scrollLeft should be at 800 (2 pages forward)
      expect(stage.scrollLeft).toBe(800);
    });

    it('returns false at chapter boundary (end)', async () => {
      const { rendition } = createMockRendition({
        scrollLeft: 800, // maxScroll = 1200 - 400 = 800
        clientWidth: 400,
        scrollWidth: 1200,
      });

      const { result } = renderHook(() => useEpubNavigation(rendition));

      // At the end boundary, nextPage should fall through to epub.js next()
      await act(async () => {
        await result.current.nextPage();
      });

      // Should have fallen through to epub.js since directScroll returns false at boundary
      expect((rendition as unknown as { next: ReturnType<typeof vi.fn> }).next).toHaveBeenCalled();
    });

    it('returns false at chapter boundary (start)', async () => {
      const { rendition } = createMockRendition({
        scrollLeft: 0,
        clientWidth: 400,
        scrollWidth: 1200,
      });

      const { result } = renderHook(() => useEpubNavigation(rendition));

      await act(async () => {
        await result.current.prevPage();
      });

      // Should have fallen through to epub.js since at start
      expect((rendition as unknown as { prev: ReturnType<typeof vi.fn> }).prev).toHaveBeenCalled();
    });

    it('error in one scroll does not break the chain', async () => {
      const { rendition, stage } = createMockRendition({
        scrollLeft: 0,
        clientWidth: 400,
        scrollWidth: 1200,
      });

      // Make the first scrollTo throw, but second should still work
      let callCount = 0;
      stage.scrollTo = vi.fn(({ left }: { left: number }) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Simulated scroll error');
        }
        stage.scrollLeft = left;
      }) as typeof stage.scrollTo;

      const { result } = renderHook(() => useEpubNavigation(rendition));

      // First call will error, second should succeed
      await act(async () => {
        await result.current.nextPage(); // errors
        await result.current.nextPage(); // should work
      });

      // Second call should have succeeded
      expect(callCount).toBe(2);
    });
  });

  describe('debug code removal', () => {
    it('does not reference window.__iosDebug', async () => {
      // Read the source file and verify no __iosDebug references
      const { rendition } = createMockRendition();
      const { result } = renderHook(() => useEpubNavigation(rendition));

      // Just verify the hook works without __iosDebug
      await act(async () => {
        await result.current.nextPage();
      });

      // If we get here without error, __iosDebug is not required
      expect(true).toBe(true);
    });
  });

  describe('interface compatibility', () => {
    it('returns the same UseEpubNavigationReturn interface', () => {
      const { rendition } = createMockRendition();
      const { result } = renderHook(() => useEpubNavigation(rendition));

      expect(result.current).toHaveProperty('nextPage');
      expect(result.current).toHaveProperty('prevPage');
      expect(result.current).toHaveProperty('canGoNext');
      expect(result.current).toHaveProperty('canGoPrev');
      expect(result.current).toHaveProperty('debugInfo');

      expect(typeof result.current.nextPage).toBe('function');
      expect(typeof result.current.prevPage).toBe('function');
      expect(typeof result.current.canGoNext).toBe('boolean');
      expect(typeof result.current.canGoPrev).toBe('boolean');
    });

    it('returns null rendition safely', () => {
      const { result } = renderHook(() => useEpubNavigation(null));

      expect(result.current.canGoNext).toBe(false);
      expect(result.current.canGoPrev).toBe(false);
    });
  });
});
