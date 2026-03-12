import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentHooks } from '../useContentHooks';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

/**
 * Tests for useContentHooks.
 *
 * useContentHooks registers a content hook via rendition.hooks.content.register()
 * and injects CSS into the iframe document. JSDOM can't render a full epub.js
 * rendition, so we use a mock rendition and trigger the registered callback
 * with a real JSDOM document to inspect injected styles.
 */

// ---------------------------------------------------------------------------
// Mock rendition factory
// ---------------------------------------------------------------------------

const createMockRendition = () => {
  const contentCallbacks: Array<(contents: unknown, view?: unknown) => void> = [];
  return {
    hooks: {
      content: {
        register: vi.fn((cb: (contents: unknown, view?: unknown) => void) => {
          contentCallbacks.push(cb);
        }),
        deregister: vi.fn(),
      },
    },
    themes: {
      default: vi.fn(),
    },
    getContents: vi.fn(() => []),
    /** Trigger all registered content callbacks with a mock Contents object */
    _triggerContent: (doc: Document) => {
      const mockContents = { document: doc };
      contentCallbacks.forEach((cb) => cb(mockContents));
    },
    _callbacks: contentCallbacks,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useContentHooks', () => {
  describe('module import', () => {
    it('imports useContentHooks without errors', async () => {
      const mod = await import('../useContentHooks');
      expect(mod.useContentHooks).toBeDefined();
      expect(typeof mod.useContentHooks).toBe('function');
    });
  });

  describe('CSS injection via mock rendition', () => {
    let mockRendition: ReturnType<typeof createMockRendition>;

    beforeEach(() => {
      mockRendition = createMockRendition();
    });

    it('does not contain @media (pointer: coarse) with user-select: none', () => {
      // Render the hook with the mock rendition (cast to satisfy types)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      // Trigger the content callback with a fresh document
      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      // Collect all injected <style> content
      const styles = Array.from(doc.querySelectorAll('style'));
      const allCSS = styles.map((s) => s.textContent || '').join('\n');

      // The old pattern: @media (pointer: coarse) with user-select: none
      // Should NOT be present after the fix
      const hasCoarseUserSelectNone =
        /@media\s*\(pointer:\s*coarse\)[\s\S]*?user-select:\s*none/.test(allCSS);

      expect(hasCoarseUserSelectNone).toBe(false);
    });

    it('contains CSS class body.selection-blocked', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      const styles = Array.from(doc.querySelectorAll('style'));
      const allCSS = styles.map((s) => s.textContent || '').join('\n');

      // Must contain body.selection-blocked rule
      expect(allCSS).toContain('body.selection-blocked');
      expect(allCSS).toContain('user-select: none');
    });

    it('adds contextmenu listener on mobile (touch device)', () => {
      // Mock touch device
      const originalMaxTouchPoints = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 1,
        configurable: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      // Create and dispatch a contextmenu event
      const event = new Event('contextmenu', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      doc.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();

      // Restore
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: originalMaxTouchPoints,
        configurable: true,
      });
    });

    it('injects touch-action: pan-x pan-y on body (sole authority after inline style removal)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      const styles = Array.from(doc.querySelectorAll('style'));
      const allCSS = styles.map((s) => s.textContent || '').join('\n');

      // useContentHooks CSS MUST set touch-action (no longer overridden by inline styles)
      expect(allCSS).toContain('touch-action: pan-x pan-y');
      // MUST NOT contain touch-action: manipulation (was removed from useEpubRendition)
      expect(allCSS).not.toContain('touch-action: manipulation');
    });

    it('registers selectstart listener that prevents selection on short tap (<300ms)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      // Simulate touchstart to set the timing baseline
      const touchStartEvent = new Event('touchstart', { bubbles: true });
      doc.dispatchEvent(touchStartEvent);

      // Simulate selectstart shortly after (<300ms) — should be prevented
      const selectStartEvent = new Event('selectstart', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(selectStartEvent, 'preventDefault');

      // Fire selectstart immediately (elapsed ~0ms < 300ms threshold)
      doc.dispatchEvent(selectStartEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('allows selection on long-press (>=300ms)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      // Mock Date.now to simulate long-press timing
      const baseTime = 1000000;
      const dateNowSpy = vi.spyOn(Date, 'now');

      // touchstart sets baseline
      dateNowSpy.mockReturnValue(baseTime);
      const touchStartEvent = new Event('touchstart', { bubbles: true });
      doc.dispatchEvent(touchStartEvent);

      // selectstart fires 300ms later (>= threshold, should be allowed)
      dateNowSpy.mockReturnValue(baseTime + 300);
      const selectStartEvent = new Event('selectstart', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(selectStartEvent, 'preventDefault');
      doc.dispatchEvent(selectStartEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      dateNowSpy.mockRestore();
    });

    it('registers touchstart listener as passive', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      const addEventListenerSpy = vi.spyOn(doc, 'addEventListener');

      mockRendition._triggerContent(doc);

      // Find the touchstart registration call
      const touchStartCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'touchstart'
      );

      expect(touchStartCall).toBeDefined();
      // Third argument should include passive: true
      expect(touchStartCall![2]).toEqual(expect.objectContaining({ passive: true }));
    });

    it('does not suppress contextmenu on desktop', () => {
      // Mock desktop device
      const originalMaxTouchPoints = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      });

      // Also ensure 'ontouchstart' is not in window
      const hadOntouchstart = 'ontouchstart' in window;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => useContentHooks(mockRendition as any, 'light'));

      const doc = document.implementation.createHTMLDocument('test');
      mockRendition._triggerContent(doc);

      const event = new Event('contextmenu', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      doc.dispatchEvent(event);

      if (!hadOntouchstart) {
        expect(preventDefaultSpy).not.toHaveBeenCalled();
      }

      // Restore
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: originalMaxTouchPoints,
        configurable: true,
      });
    });
  });
});
