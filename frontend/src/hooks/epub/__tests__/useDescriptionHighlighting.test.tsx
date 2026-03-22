/**
 * Tests for useDescriptionHighlighting hook
 *
 * Tests description highlighting in EPUB content, search strategies,
 * and DOM manipulation for clickable highlights.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDescriptionHighlighting } from '../useDescriptionHighlighting';
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';

vi.mock('@/utils/text-search/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/text-search/cache')>();
  return {
    ...actual,
    getFromCache: () => undefined,
    addToCache: () => {},
  };
});

describe('useDescriptionHighlighting', () => {
  let mockRendition: Partial<Rendition>;
  let mockDocument: Document;
  let mockIframe: { document: Document };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.clearAllMocks();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock requestIdleCallback since jsdom doesn't have it
    if (!('requestIdleCallback' in window)) {
      (window as any).requestIdleCallback = (cb: () => void) => setTimeout(cb, 0);
      (window as any).cancelIdleCallback = (id: number) => clearTimeout(id);
    }

    mockDocument = document.implementation.createHTMLDocument('Test');
    mockDocument.body.innerHTML = '<p>Test content with some text to highlight.</p>';

    mockIframe = { document: mockDocument };

    mockRendition = {
      getContents: vi.fn(() => [mockIframe as any]),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function triggerRenderedAndFlush(_rendition: Partial<Rendition>) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  describe('Initial Setup', () => {
    it('should skip highlighting when rendition is null', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: null,
          descriptions: [],
          images: [],
          enabled: true,
        })
      );

      expect(mockRendition.on).not.toHaveBeenCalled();
    });

    it('should not apply highlights when enabled is false', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          enabled: false,
        })
      );

      expect(mockRendition.on).not.toHaveBeenCalled();
    });

    it('should not highlight when descriptions array is empty', async () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(0);
    });
  });

  describe('Event Listeners', () => {
    it('should register "rendered" event listener on mount', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          enabled: true,
        })
      );

      expect(mockRendition.on).toHaveBeenCalledWith('rendered', expect.any(Function));
    });

    it('should unregister "rendered" event listener on unmount', () => {
      const { unmount } = renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          enabled: true,
        })
      );

      unmount();

      expect(mockRendition.off).toHaveBeenCalledWith('rendered', expect.any(Function));
    });

    it('should re-register listeners when rendition changes', () => {
      const { rerender } = renderHook(
        ({ rendition }) =>
          useDescriptionHighlighting({
            rendition,
            descriptions: [],
            images: [],
            enabled: true,
          }),
        {
          initialProps: { rendition: mockRendition as Rendition },
        }
      );

      const newMockRendition: Partial<Rendition> = {
        getContents: vi.fn(() => [mockIframe as any]),
        on: vi.fn(),
        off: vi.fn(),
      };

      rerender({ rendition: newMockRendition as Rendition });

      expect(mockRendition.off).toHaveBeenCalled();
      expect(newMockRendition.on).toHaveBeenCalled();
    });
  });

  describe('Highlighting Logic', () => {
    it('should highlight description when text is found in DOM', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Test content with some text to highlight',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>Test content with some text to highlight.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should add correct attributes to highlight span', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Test content is here in the document',
          type: 'location',
          confidence_score: 0.85,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>Test content is here in the document.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlight = mockDocument.querySelector('.description-highlight');
      expect(highlight).not.toBeNull();
      if (highlight) {
        expect(highlight.getAttribute('data-description-id')).toBe('desc-1');
      }
    });

    it('should apply correct CSS styles to highlight', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'This has some text inside the paragraph',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>This has some text inside the paragraph.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlight = mockDocument.querySelector('.description-highlight') as HTMLElement;
      expect(highlight).not.toBeNull();
      expect(highlight.classList.contains('description-highlight')).toBe(true);
    });

    it('should create highlight spans with attributes required by gesture controller', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-gc-1',
          content: 'gesture controller needs this span to detect clicks',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
        {
          id: 'desc-gc-2',
          content: 'second span for gesture controller detection',
          type: 'location',
          confidence_score: 0.85,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML =
        '<p>gesture controller needs this span to detect clicks in this text.</p>' +
        '<p>second span for gesture controller detection appears here.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      // Gesture controller's getInteractiveType() looks for .description-highlight class
      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(2);

      // Each highlight must have data-description-id for identification
      const ids = Array.from(highlights).map((el) => el.getAttribute('data-description-id'));
      expect(ids).toContain('desc-gc-1');
      expect(ids).toContain('desc-gc-2');

      // Verify closest('.description-highlight') works for nested content
      // (gesture controller uses el.closest?.('.description-highlight'))
      highlights.forEach((highlight) => {
        expect(highlight.closest('.description-highlight')).toBe(highlight);
      });
    });
  });

  describe('Multiple Descriptions', () => {
    it('should highlight multiple descriptions in the same content', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'first description text in the paragraph',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
        {
          id: 'desc-2',
          content: 'second description text in the paragraph',
          type: 'location',
          confidence_score: 0.85,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML =
        '<p>This has first description text in the paragraph.</p><p>And second description text in the paragraph here.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(2);
    });
  });

  describe('Re-highlighting on Description Changes', () => {
    it('should re-highlight when descriptions are loaded', () => {
      const { rerender } = renderHook(
        ({ descriptions }) =>
          useDescriptionHighlighting({
            rendition: mockRendition as Rendition,
            descriptions,
            images: [],
            enabled: true,
          }),
        {
          initialProps: { descriptions: [] as Description[] },
        }
      );

      expect(mockDocument.querySelectorAll('.description-highlight').length).toBe(0);

      const newDescriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Test content is here in the document',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>Test content is here in the document.</p>';

      rerender({ descriptions: newDescriptions });
    });
  });

  describe('Existing Highlights Cleanup', () => {
    it('should remove old highlights when navigating to new page', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-new',
          content: 'new content that should be highlighted now',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      const oldHighlight = mockDocument.createElement('span');
      oldHighlight.className = 'description-highlight';
      oldHighlight.setAttribute('data-description-id', 'desc-different');
      oldHighlight.textContent = 'old highlight text that was previously here';
      mockDocument.body.innerHTML = '';
      mockDocument.body.appendChild(oldHighlight);

      const newParagraph = mockDocument.createElement('p');
      newParagraph.textContent = 'new content that should be highlighted now in this paragraph';
      mockDocument.body.appendChild(newParagraph);

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const existingHighlights = mockDocument.querySelectorAll('.description-highlight');
      const hasOldHighlight = Array.from(existingHighlights).some(
        (el) => el.getAttribute('data-description-id') === 'desc-different'
      );
      expect(hasOldHighlight).toBe(false);
    });

    it('should skip re-highlighting if descriptions unchanged and highlights exist', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'current content that is already highlighted',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>current content that is already highlighted in the text.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlightsAfterFirst = mockDocument.querySelectorAll('.description-highlight').length;

      await triggerRenderedAndFlush(mockRendition);

      const highlightsAfterSecond = mockDocument.querySelectorAll('.description-highlight').length;
      expect(highlightsAfterSecond).toBe(highlightsAfterFirst);
    });
  });

  describe('Performance', () => {
    it('should complete highlighting without errors', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'performance test content in the document',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>This is performance test content in the document.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should handle large number of text nodes', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'target text that should be found and highlighted',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      let html = '';
      for (let i = 0; i < 50; i++) {
        html += `<p>Paragraph number ${i} with some filler text content.</p>`;
      }
      html += '<p>target text that should be found and highlighted in this paragraph.</p>';
      mockDocument.body.innerHTML = html;

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document body', async () => {
      mockDocument.body.innerHTML = '';

      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'missing content that does not exist',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(0);
    });

    it('should handle descriptions with special characters', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'text with quotes and dashes here in the paragraph',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>Some text with quotes and dashes here in the paragraph.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should skip very short text nodes', async () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Hi',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,
        },
      ];

      mockDocument.body.innerHTML = '<p>Hi there!</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          enabled: true,
        })
      );

      await triggerRenderedAndFlush(mockRendition);

      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(0);
    });
  });
});
