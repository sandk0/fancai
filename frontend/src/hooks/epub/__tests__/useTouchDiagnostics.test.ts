import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing module
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  isDebugActive: vi.fn(() => true),
  getDebugBuffer: vi.fn(() => []),
  clearDebugBuffer: vi.fn(),
}));

describe('useTouchDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('module exports', () => {
    it('exports useTouchDiagnostics hook', async () => {
      const mod = await import('../useTouchDiagnostics');
      expect(mod.useTouchDiagnostics).toBeDefined();
      expect(typeof mod.useTouchDiagnostics).toBe('function');
    });

    it('exports attachDiagnosticListeners', async () => {
      const mod = await import('../useTouchDiagnostics');
      expect(mod.attachDiagnosticListeners).toBeDefined();
      expect(typeof mod.attachDiagnosticListeners).toBe('function');
    });

    it('exports getTouchActionInfo', async () => {
      const mod = await import('../useTouchDiagnostics');
      expect(mod.getTouchActionInfo).toBeDefined();
      expect(typeof mod.getTouchActionInfo).toBe('function');
    });
  });

  describe('attachDiagnosticListeners', () => {
    let addSpy: ReturnType<typeof vi.spyOn>;
    let removeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      addSpy = vi.spyOn(document, 'addEventListener');
      removeSpy = vi.spyOn(document, 'removeEventListener');
    });

    afterEach(() => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('adds listeners for 6 event types on the given document', async () => {
      const { attachDiagnosticListeners } = await import('../useTouchDiagnostics');
      const cleanup = attachDiagnosticListeners(document, 'test');

      const eventTypes = addSpy.mock.calls.map((c) => c[0]);
      expect(eventTypes).toContain('touchstart');
      expect(eventTypes).toContain('touchmove');
      expect(eventTypes).toContain('touchend');
      expect(eventTypes).toContain('pointerdown');
      expect(eventTypes).toContain('pointermove');
      expect(eventTypes).toContain('pointerup');
      expect(addSpy).toHaveBeenCalledTimes(6);

      // All listeners should use capture: true, passive: true
      for (const call of addSpy.mock.calls) {
        expect(call[2]).toEqual({ capture: true, passive: true });
      }

      cleanup();
    });

    it('cleanup removes all registered listeners', async () => {
      const { attachDiagnosticListeners } = await import('../useTouchDiagnostics');
      const cleanup = attachDiagnosticListeners(document, 'test');

      cleanup();

      const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedTypes).toContain('touchstart');
      expect(removedTypes).toContain('touchmove');
      expect(removedTypes).toContain('touchend');
      expect(removedTypes).toContain('pointerdown');
      expect(removedTypes).toContain('pointermove');
      expect(removedTypes).toContain('pointerup');
      expect(removeSpy).toHaveBeenCalledTimes(6);

      for (const call of removeSpy.mock.calls) {
        expect(call[2]).toEqual({ capture: true });
      }
    });

    it('logs events with type, source, x, y, cancelable, defaultPrevented', async () => {
      const { logger } = await import('@/lib/logger');
      const { attachDiagnosticListeners } = await import('../useTouchDiagnostics');

      const cleanup = attachDiagnosticListeners(document, 'iframe');

      // Dispatch a pointerdown event (simpler than touch in JSDOM)
      const event = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 200,
        cancelable: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(logger.debug).toHaveBeenCalledWith(
        '[touch-diag] iframe pointerdown',
        expect.objectContaining({
          type: 'pointerdown',
          source: 'iframe',
          x: 100,
          y: 200,
          cancelable: true,
          defaultPrevented: false,
        })
      );

      cleanup();
    });

    it('throttles touchmove/pointermove to max 1 log per 100ms', async () => {
      const { logger } = await import('@/lib/logger');
      const { attachDiagnosticListeners } = await import('../useTouchDiagnostics');

      const cleanup = attachDiagnosticListeners(document, 'test');

      // Reset logger.debug mock to count only pointermove calls
      (logger.debug as ReturnType<typeof vi.fn>).mockClear();

      // Dispatch 5 pointermove events in rapid succession
      for (let i = 0; i < 5; i++) {
        const event = new PointerEvent('pointermove', {
          clientX: i * 10,
          clientY: i * 10,
          cancelable: true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      }

      // Only first should be logged (rest within 100ms window)
      const moveLogCalls = (logger.debug as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('pointermove')
      );
      expect(moveLogCalls.length).toBe(1);

      cleanup();
    });
  });

  describe('getTouchActionInfo', () => {
    it('returns Record with keys for found elements', async () => {
      const { getTouchActionInfo } = await import('../useTouchDiagnostics');

      // Create a mock viewer element
      const viewer = document.createElement('div');
      viewer.id = 'epub-viewer';
      document.body.appendChild(viewer);

      const mockRendition = {
        getContents: () => [],
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as import('@/types/epub').Rendition;

      const result = getTouchActionInfo(mockRendition);
      expect(typeof result).toBe('object');
      expect('#epub-viewer' in result).toBe(true);

      document.body.removeChild(viewer);
    });
  });
});
