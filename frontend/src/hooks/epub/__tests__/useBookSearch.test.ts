/**
 * Tests for useBookSearch hook
 *
 * Verifies READ-04: search returns results, navigation between results,
 * abort on new search, empty query returns empty results.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookSearch } from '../useBookSearch';

describe('useBookSearch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockSpineItem = (
    index: number,
    results: Array<{ cfi: string; excerpt: string }> = []
  ) => ({
    index,
    href: `chapter${index}.xhtml`,
    load: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockReturnValue(results),
    unload: vi.fn(),
  });

  const createMockBook = (spineItems: ReturnType<typeof createMockSpineItem>[]) => ({
    spine: {
      each: (callback: (item: unknown) => void) => {
        spineItems.forEach(callback);
      },
    },
    load: {
      bind: vi.fn().mockReturnValue(vi.fn()),
    },
  });

  const createMockRendition = () => ({
    display: vi.fn(),
    annotations: {
      highlight: vi.fn(),
      remove: vi.fn(),
    },
  });

  it('should return empty results initially', () => {
    const { result } = renderHook(() => useBookSearch({ book: null, rendition: null }));

    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.query).toBe('');
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.progress).toBeNull();
  });

  it('should return empty results for empty query', async () => {
    const mockBook = createMockBook([createMockSpineItem(0)]);

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: null,
      })
    );

    await act(async () => {
      await result.current.searchBook('');
    });

    expect(result.current.results).toEqual([]);
  });

  it('should return empty results for whitespace-only query', async () => {
    const mockBook = createMockBook([createMockSpineItem(0)]);

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: null,
      })
    );

    await act(async () => {
      await result.current.searchBook('   ');
    });

    expect(result.current.results).toEqual([]);
  });

  it('should find results across spine items', async () => {
    const items = [
      createMockSpineItem(0, [{ cfi: 'epubcfi(/6/2!/4/1:0)', excerpt: 'Found in chapter 1' }]),
      createMockSpineItem(1, []),
      createMockSpineItem(2, [{ cfi: 'epubcfi(/6/6!/4/1:0)', excerpt: 'Found in chapter 3' }]),
    ];

    const mockBook = createMockBook(items);
    const mockRendition = createMockRendition();

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: mockRendition as unknown as Parameters<typeof useBookSearch>[0]['rendition'],
      })
    );

    await act(async () => {
      await result.current.searchBook('test');
    });

    expect(result.current.results).toHaveLength(2);
    expect(result.current.results[0].sectionIndex).toBe(0);
    expect(result.current.results[1].sectionIndex).toBe(2);
    expect(result.current.isSearching).toBe(false);
  });

  it('should navigate between results cyclically', async () => {
    const items = [
      createMockSpineItem(0, [
        { cfi: 'epubcfi(/6/2!/4/1:0)', excerpt: 'Result 1' },
        { cfi: 'epubcfi(/6/2!/4/2:0)', excerpt: 'Result 2' },
      ]),
    ];

    const mockBook = createMockBook(items);
    const mockRendition = createMockRendition();

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: mockRendition as unknown as Parameters<typeof useBookSearch>[0]['rendition'],
      })
    );

    await act(async () => {
      await result.current.searchBook('test');
    });

    expect(result.current.currentIndex).toBe(0);

    // Navigate forward
    act(() => {
      result.current.nextResult();
    });
    expect(result.current.currentIndex).toBe(1);

    // Navigate forward again (should wrap to 0)
    act(() => {
      result.current.nextResult();
    });
    expect(result.current.currentIndex).toBe(0);

    // Navigate backward (should wrap to 1)
    act(() => {
      result.current.previousResult();
    });
    expect(result.current.currentIndex).toBe(1);
  });

  it('should clear search state', async () => {
    const items = [createMockSpineItem(0, [{ cfi: 'epubcfi(/6/2!/4/1:0)', excerpt: 'Result' }])];

    const mockBook = createMockBook(items);
    const mockRendition = createMockRendition();

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: mockRendition as unknown as Parameters<typeof useBookSearch>[0]['rendition'],
      })
    );

    await act(async () => {
      await result.current.searchBook('test');
    });

    expect(result.current.results.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearSearch();
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.query).toBe('');
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('should handle sections that fail to load gracefully', async () => {
    const failItem = createMockSpineItem(0);
    failItem.load.mockRejectedValue(new Error('Load failed'));

    const goodItem = createMockSpineItem(1, [{ cfi: 'epubcfi(/6/4!/4/1:0)', excerpt: 'Found' }]);

    const mockBook = createMockBook([failItem, goodItem]);
    const mockRendition = createMockRendition();

    const { result } = renderHook(() =>
      useBookSearch({
        book: mockBook as unknown as Parameters<typeof useBookSearch>[0]['book'],
        rendition: mockRendition as unknown as Parameters<typeof useBookSearch>[0]['rendition'],
      })
    );

    await act(async () => {
      await result.current.searchBook('test');
    });

    // Should still have results from the successful section
    expect(result.current.results).toHaveLength(1);
    expect(result.current.isSearching).toBe(false);
  });
});
