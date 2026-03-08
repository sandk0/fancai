/**
 * Tests for useAnnotationRendering hook
 *
 * Verifies READ-02: hook lifecycle (renders without crashing, cleanup on unmount).
 * DOM manipulation is tested at integration level; here we verify the hook API contract.
 *
 * Note: This hook uses DOM span wrapping, NOT epub.js annotations API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAnnotationRendering } from '../useAnnotationRendering';

// Mock dependencies
vi.mock('@/hooks/api/useSync', () => ({
  useBookmarks: vi.fn(() => ({ data: [], isLoading: false, isSuccess: true })),
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
});
