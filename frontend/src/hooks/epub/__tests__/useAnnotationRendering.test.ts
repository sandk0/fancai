/**
 * Tests for useAnnotationRendering hook
 *
 * Verifies READ-02: hook lifecycle (renders without crashing, cleanup on unmount).
 * DOM manipulation is tested at integration level; here we verify the hook API contract.
 *
 * BUG-4 tests: verify applyAnnotations reads current bookmarks via ref (not stale closure),
 * and bookmark-change debounce is fast (<=50ms).
 *
 * Note: This hook uses DOM span wrapping, NOT epub.js annotations API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAnnotationRendering } from '../useAnnotationRendering';
import type { BookmarkResponse } from '@/hooks/api/useSync';

// Track what useBookmarks returns — mutable so we can change between renders
const mockBookmarksData: { current: BookmarkResponse[] } = { current: [] };

// Mock dependencies
vi.mock('@/hooks/api/useSync', () => ({
  useBookmarks: vi.fn(() => ({
    data: mockBookmarksData.current,
    isLoading: false,
    isSuccess: true,
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: Object.assign(
    vi.fn(() => ({ user: { id: 'user-1' } })),
    {
      getState: vi.fn(() => ({ user: { id: 'user-1' } })),
    }
  ),
}));

describe('useAnnotationRendering', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
    mockBookmarksData.current = [];
  });

  it('should render without crashing when rendition is null', () => {
    const { result } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: null,
          bookId: 'book-1',
          currentChapter: 1,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBeDefined();
    expect(result.current.highlightPopup).toBeNull();
    expect(typeof result.current.closePopup).toBe('function');
    expect(typeof result.current.flashAnnotation).toBe('function');
  });

  it('should return closePopup and flashAnnotation functions', () => {
    const { result } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: null,
          bookId: 'book-1',
          currentChapter: 1,
        }),
      { wrapper: createWrapper() }
    );

    // Should not throw when called with null rendition
    expect(() => result.current.closePopup()).not.toThrow();
    expect(() => result.current.flashAnnotation('bm-1')).not.toThrow();
  });

  it('should not crash when disabled', () => {
    const { result } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: null,
          bookId: 'book-1',
          currentChapter: 1,
          enabled: false,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.highlightPopup).toBeNull();
  });

  it('should clean up on unmount without errors', () => {
    const { unmount } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: null,
          bookId: 'book-1',
          currentChapter: 1,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    expect(() => unmount()).not.toThrow();
  });

  it('should register hooks on a mock rendition', () => {
    const mockRendition = {
      getContents: vi.fn(() => []),
      getRange: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      hooks: {
        content: {
          register: vi.fn(),
          deregister: vi.fn(),
        },
      },
    };

    const { unmount } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: mockRendition as unknown as Parameters<
            typeof useAnnotationRendering
          >[0]['rendition'],
          bookId: 'book-1',
          currentChapter: 1,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    // Should register content hooks for CSS injection and click handling
    expect(mockRendition.hooks.content.register).toHaveBeenCalled();
    // Should listen for 'rendered' event
    expect(mockRendition.on).toHaveBeenCalledWith('rendered', expect.any(Function));

    unmount();

    // Should clean up event listeners
    expect(mockRendition.off).toHaveBeenCalledWith('rendered', expect.any(Function));
    expect(mockRendition.hooks.content.deregister).toHaveBeenCalled();
  });

  // ============================================================================
  // BUG-4: Stale closure / race condition tests
  // ============================================================================

  const makeBookmark = (id: string, chapter: number, cfiRange: string): BookmarkResponse => ({
    id,
    cfi_range: cfiRange,
    chapter_number: chapter,
    text: `text-${id}`,
    color: '#ff0000',
    text_color: null,
    style: 'none',
    note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  /**
   * Create a mock rendition with a real JSDOM document for annotation testing.
   * The document has a paragraph with text and valid CFI ranges.
   */
  function createMockRenditionWithDoc() {
    // Create a real DOM document with content for annotations
    const doc = document.implementation.createHTMLDocument('test');
    const p = doc.createElement('p');
    p.id = 'para1';
    p.textContent = 'Hello world this is a test paragraph with some content for annotations';
    doc.body.appendChild(p);

    // Track which bookmark IDs get rendered as .user-annotation spans
    const getRenderedBookmarkIds = () => {
      const spans = doc.querySelectorAll('.user-annotation');
      return Array.from(spans).map((s) => s.getAttribute('data-bookmark-id'));
    };

    // Mock getRange to return a real Range within the paragraph
    const getRange = vi.fn((cfi: string) => {
      try {
        const textNode = p.firstChild;
        if (!textNode) return null;
        const range = doc.createRange();
        // Use different offsets based on CFI to create distinct ranges
        if (cfi.includes('bookmark-A')) {
          range.setStart(textNode, 0);
          range.setEnd(textNode, 5); // "Hello"
        } else if (cfi.includes('bookmark-B')) {
          range.setStart(textNode, 6);
          range.setEnd(textNode, 11); // "world"
        } else {
          range.setStart(textNode, 0);
          range.setEnd(textNode, 3);
        }
        return range;
      } catch {
        return null;
      }
    });

    const mockRendition = {
      getContents: vi.fn(() => [{ document: doc }]),
      getRange,
      on: vi.fn(),
      off: vi.fn(),
      hooks: {
        content: {
          register: vi.fn(),
          deregister: vi.fn(),
        },
      },
    };

    return { mockRendition, doc, getRenderedBookmarkIds };
  }

  it('applyAnnotations uses current bookmarks via ref, not stale closure', async () => {
    vi.useFakeTimers();

    const bookmarkA = makeBookmark('bookmark-A', 1, 'epubcfi(/6/2!/4[para1]/1:0,/1:5)');
    const bookmarkB = makeBookmark('bookmark-B', 1, 'epubcfi(/6/2!/4[para1]/1:6,/1:11)');

    const { mockRendition, getRenderedBookmarkIds } = createMockRenditionWithDoc();

    // Start with bookmark A only
    mockBookmarksData.current = [bookmarkA];

    const { rerender } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: mockRendition as unknown as Parameters<
            typeof useAnnotationRendering
          >[0]['rendition'],
          bookId: 'book-1',
          currentChapter: 1,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    // Simulate optimistic update: add bookmark B (mimics TanStack Query setQueryData)
    mockBookmarksData.current = [bookmarkA, bookmarkB];
    rerender();

    // Advance past all debounce timers (200ms is the max)
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // CRITICAL: Both bookmarks must be rendered — not just A (stale closure would show only A)
    const renderedIds = getRenderedBookmarkIds();
    expect(renderedIds).toContain('bookmark-A');
    expect(renderedIds).toContain('bookmark-B');

    vi.useRealTimers();
  });

  it('debounce for bookmark change is fast (<=50ms), not 200ms', async () => {
    vi.useFakeTimers();

    const bookmarkA = makeBookmark('bookmark-A', 1, 'epubcfi(/6/2!/4[para1]/1:0,/1:5)');
    const { mockRendition, getRenderedBookmarkIds } = createMockRenditionWithDoc();

    // Start with no bookmarks
    mockBookmarksData.current = [];

    const { rerender } = renderHook(
      () =>
        useAnnotationRendering({
          rendition: mockRendition as unknown as Parameters<
            typeof useAnnotationRendering
          >[0]['rendition'],
          bookId: 'book-1',
          currentChapter: 1,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    // Flush initial debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Now add a bookmark (simulates optimistic update)
    mockBookmarksData.current = [bookmarkA];
    rerender();

    // Advance 50ms — bookmark should already be rendered (fast debounce for bookmark change)
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const renderedIds = getRenderedBookmarkIds();
    expect(renderedIds).toContain('bookmark-A');

    vi.useRealTimers();
  });
});
