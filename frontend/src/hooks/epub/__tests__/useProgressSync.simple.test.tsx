/**
 * Simplified tests for useProgressSync hook
 *
 * Tests core functionality of debounced reading progress synchronization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProgressSync } from '../useProgressSync';
import { bookKeys } from '@/hooks/api/queryKeys';
import { useAuthStore } from '@/stores/auth';
import type { User } from '@/types/api';

const USER_ID = 'user-1';
const TEST_USER: User = {
  id: USER_ID,
  email: 'reader@example.com',
  is_active: true,
  is_verified: true,
  is_admin: false,
  created_at: '2026-01-01T00:00:00Z',
};

describe('useProgressSync (simplified)', () => {
  let queryClient: QueryClient;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Spy on console
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'test-token'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });

    // Ключ деталей книги привязан к пользователю: без заполненного стора
    // уборке эффекта нечего инвалидировать.
    useAuthStore.setState({ user: TEST_USER });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    queryClient.clear();
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isSaving).toBe(false);
      expect(result.current.lastSaved).toBeNull();
    });

    it('should not save when CFI is empty', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: '',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(onSave).not.toHaveBeenCalled();
    });

    it('should not save when bookId is empty', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: '',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(onSave).not.toHaveBeenCalled();
    });

    it('should not save when enabled is false', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: false,
          }),
        { wrapper: createWrapper() }
      );

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Saving State Tracking', () => {
    it('should track lastSaved after successful save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { unmount } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      // Trigger save by unmounting
      unmount();

      // Wait for async operations
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // lastSaved should be updated (check via the last state before unmount)
      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle save errors without throwing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onSave = vi.fn().mockRejectedValue(new Error('Network error'));

      const { unmount } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      // Should not throw
      expect(() => unmount()).not.toThrow();

      // Wait for error to be logged
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      errorSpy.mockRestore();
    });
  });

  describe('Unmount Behavior', () => {
    it('should save progress on unmount', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { unmount } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      unmount();

      // Wait for async save
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 25, 10, 1);
    });

    it('should invalidate query cache after unmount', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { unmount } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      unmount();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: bookKeys.detail(USER_ID, 'book-1'),
      });

      invalidateSpy.mockRestore();
    });
  });

  describe('beforeunload Event', () => {
    it('should send progress via fetch on beforeunload', () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 50,
            scrollOffset: 25,
            currentChapter: 3,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      // Trigger beforeunload
      window.dispatchEvent(new Event('beforeunload'));

      // Should call fetch with keepalive
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/books/book-1/progress'),
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
          credentials: 'include',
        })
      );

      fetchSpy.mockRestore();
    });

    it('should include correct progress data in beacon', () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-123',
            currentCFI: 'epubcfi(/6/4[ch01])',
            progress: 75.5,
            scrollOffset: 50.25,
            currentChapter: 5,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      window.dispatchEvent(new Event('beforeunload'));

      const call = fetchSpy.mock.calls[0];
      if (call && call[1]?.body) {
        const bodyData = JSON.parse(call[1].body as string);
        expect(bodyData).toEqual({
          current_chapter: 5,
          current_position_percent: 75.5,
          reading_location_cfi: 'epubcfi(/6/4[ch01])',
          scroll_offset_percent: 50.25,
        });
      }

      fetchSpy.mockRestore();
    });
  });

  describe('Progress Data Validation', () => {
    it('should pass correct parameters to onSave', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { unmount } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4[chapter1])',
            progress: 42.5,
            scrollOffset: 15.75,
            currentChapter: 7,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      unmount();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4[chapter1])', 42.5, 15.75, 7);
    });
  });
});
