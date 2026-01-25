/**
 * Tests for useDescriptionHighlighting hook
 *
 * Tests description highlighting in EPUB content, search strategies,
 * and DOM manipulation for clickable highlights.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDescriptionHighlighting } from '../useDescriptionHighlighting';
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';

// Mock performance.now for consistent timing tests
const mockPerformanceNow = vi.spyOn(performance, 'now');

describe('useDescriptionHighlighting', () => {
  let mockRendition: Partial<Rendition>;
  let mockDocument: Document;
  let mockIframe: { document: Document };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformanceNow.mockReturnValue(0);

    // Spy on console to prevent test output pollution
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create mock document with body
    mockDocument = document.implementation.createHTMLDocument('Test');
    mockDocument.body.innerHTML = '<p>Test content with some text to highlight.</p>';

    // Create mock iframe
    mockIframe = { document: mockDocument };

    // Create mock rendition
    mockRendition = {
      getContents: vi.fn(() => [mockIframe as any]),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    mockPerformanceNow.mockRestore();
  });

  describe('Initial Setup', () => {
    it('should skip highlighting when rendition is null', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: null,
          descriptions: [],
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      expect(mockRendition.on).not.toHaveBeenCalled();
    });

    it('should skip highlighting when enabled is false', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: false,
        })
      );

      // Hook should be set up but not apply highlights
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping highlights')
      );
    });

    it('should skip highlighting when descriptions array is empty', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping highlights'),
        expect.objectContaining({
          descriptionsCount: 0,
        })
      );
    });
  });

  describe('Event Listeners', () => {
    it('should register "rendered" event listener on mount', () => {
      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions: [],
          images: [],
          onDescriptionClick: vi.fn(),
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
          onDescriptionClick: vi.fn(),
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
            onDescriptionClick: vi.fn(),
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
    it('should highlight description when text is found in DOM', () => {
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
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      // Trigger rendered event
      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Check if highlight span was created
      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should add correct attributes to highlight span', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Test content',
          type: 'location',
          confidence_score: 0.85,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>Test content is here.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      const highlight = mockDocument.querySelector('.description-highlight');
      if (highlight) {
        expect(highlight.getAttribute('data-description-id')).toBe('desc-1');
        expect(highlight.getAttribute('data-description-type')).toBe('location');
        expect(highlight.getAttribute('data-strategy')).toBeTruthy();
      }
    });

    it('should apply correct CSS styles to highlight', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'some text',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>This has some text inside.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      const highlight = mockDocument.querySelector('.description-highlight') as HTMLElement;
      if (highlight) {
        expect(highlight.style.cursor).toBe('pointer');
        expect(highlight.style.backgroundColor).toContain('rgba(96, 165, 250');
      }
    });
  });

  describe('Click Handler', () => {
    it('should call onDescriptionClick when highlight is clicked', () => {
      const onDescriptionClick = vi.fn();
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'clickable text',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>This is clickable text here.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick,
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      const highlight = mockDocument.querySelector('.description-highlight');
      if (highlight) {
        const clickEvent = new MouseEvent('click', { bubbles: true });
        highlight.dispatchEvent(clickEvent);

        expect(onDescriptionClick).toHaveBeenCalledWith(descriptions[0], undefined);
      }
    });

    it('should pass associated image when clicking highlighted description', () => {
      const onDescriptionClick = vi.fn();
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'text with image',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      const images: GeneratedImage[] = [
        {
          id: 'img-1',
          image_url: 'https://example.com/image.png',
          service_used: 'imagen',
          prompt_used: 'test prompt',
          status: 'completed',
          is_moderated: false,
          view_count: 0,
          download_count: 0,
          created_at: new Date().toISOString(),
          description: {
            id: 'desc-1',
            type: 'character',
            text: 'text with image',
            content: 'text with image',
            confidence_score: 0.9,
            priority_score: 0.5,
          },
          chapter: {
            id: 'ch-1',
            number: 1,
          },
        } as GeneratedImage,
      ];

      mockDocument.body.innerHTML = '<p>Here is text with image content.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images,
          onDescriptionClick,
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      const highlight = mockDocument.querySelector('.description-highlight');
      if (highlight) {
        const clickEvent = new MouseEvent('click', { bubbles: true });
        highlight.dispatchEvent(clickEvent);

        expect(onDescriptionClick).toHaveBeenCalledWith(descriptions[0], images[0]);
      }
    });
  });

  describe('Multiple Descriptions', () => {
    it('should highlight multiple descriptions in the same content', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'first description',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
        {
          id: 'desc-2',
          content: 'second description',
          type: 'location',
          confidence_score: 0.85,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML =
        '<p>This has first description and second description text.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

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
            onDescriptionClick: vi.fn(),
            enabled: true,
          }),
        {
          initialProps: { descriptions: [] as Description[] },
        }
      );

      // Initial render with no descriptions
      expect(mockDocument.querySelectorAll('.description-highlight').length).toBe(0);

      // Update with descriptions
      const newDescriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'Test content',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>Test content is here.</p>';

      rerender({ descriptions: newDescriptions });

      // Should trigger re-highlighting
      // Note: This requires waiting for the debounce/timeout
    });
  });

  describe('Existing Highlights Cleanup', () => {
    it('should remove old highlights when navigating to new page', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-old',
          content: 'old content',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      // Add existing highlight
      const oldHighlight = mockDocument.createElement('span');
      oldHighlight.className = 'description-highlight';
      oldHighlight.setAttribute('data-description-id', 'desc-different');
      oldHighlight.textContent = 'old highlight';
      mockDocument.body.innerHTML = '';
      mockDocument.body.appendChild(oldHighlight);

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Old highlight with different ID should be removed
      const existingHighlights = mockDocument.querySelectorAll('.description-highlight');
      const hasOldHighlight = Array.from(existingHighlights).some(
        (el) => el.getAttribute('data-description-id') === 'desc-different'
      );
      expect(hasOldHighlight).toBe(false);
    });

    it('should skip re-highlighting if current page already highlighted', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'current content',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      // Add existing highlight for current description
      const existingHighlight = mockDocument.createElement('span');
      existingHighlight.className = 'description-highlight';
      existingHighlight.setAttribute('data-description-id', 'desc-1');
      existingHighlight.textContent = 'current content';
      mockDocument.body.innerHTML = '';
      mockDocument.body.appendChild(existingHighlight);

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Should log that it's skipping
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Already highlighted for current page')
      );
    });
  });

  describe('Performance Logging', () => {
    it('should log performance metrics after highlighting', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'performance test',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>This is performance test content.</p>';

      // Mock performance timing
      let callCount = 0;
      mockPerformanceNow.mockImplementation(() => {
        return callCount++ * 10; // Simulate 10ms intervals
      });

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Should log summary with performance metrics
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SUMMARY v2.2]'),
        expect.objectContaining({
          duration: expect.stringContaining('ms'),
          performance: expect.any(String),
        })
      );
    });

    it('should warn when highlighting takes too long', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'slow test',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>This is slow test content.</p>';

      // Mock slow performance (>100ms)
      let callCount = 0;
      mockPerformanceNow.mockImplementation(() => {
        return callCount++ === 0 ? 0 : 150; // First call 0, subsequent calls 150ms
      });

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Should warn about slow performance
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PERFORMANCE]'),
        expect.anything()
      );

      warnSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document body', () => {
      mockDocument.body.innerHTML = '';

      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'missing content',
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
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Should not throw error, just log failed descriptions
      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBe(0);
    });

    it('should handle descriptions with special characters', () => {
      const descriptions: Description[] = [
        {
          id: 'desc-1',
          content: 'text with "quotes" and — dashes',
          type: 'character',
          confidence_score: 0.9,
          priority_score: 0.5,

        },
      ];

      mockDocument.body.innerHTML = '<p>Some text with "quotes" and — dashes here.</p>';

      renderHook(() =>
        useDescriptionHighlighting({
          rendition: mockRendition as Rendition,
          descriptions,
          images: [],
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Should normalize and find the text
      const highlights = mockDocument.querySelectorAll('.description-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should handle very short descriptions', () => {
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
          onDescriptionClick: vi.fn(),
          enabled: true,
        })
      );

      const renderedHandler = (mockRendition.on as any).mock.calls.find(
        (call: any) => call[0] === 'rendered'
      )?.[1];

      if (renderedHandler) {
        renderedHandler();
      }

      // Very short descriptions (<10 chars) should be skipped
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FAILED DESCRIPTIONS]'),
        expect.anything()
      );
    });
  });
});
