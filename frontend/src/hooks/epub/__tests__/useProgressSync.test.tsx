/**
 * Tests for useProgressSync hook
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

const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useProgressSync', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockLocalStorage.getItem.mockReturnValue('test-token');
    // Ключ деталей книги привязан к пользователю, поэтому уборке нужен
    // заполненный стор — иначе инвалидация молча ничего не делает.
    useAuthStore.setState({ user: TEST_USER });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    it('should not save when enabled is false', async () => {
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Debounced Save', () => {
    it('should debounce progress updates with default 5 second delay', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ cfi }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: cfi,
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { cfi: '' },
        }
      );

      rerender({ cfi: 'epubcfi(/6/4)' });

      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 25, 10, 1);
    }, 15000);

    it('should use custom debounce delay', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ cfi }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: cfi,
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 2000,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { cfi: '' },
        }
      );

      rerender({ cfi: 'epubcfi(/6/4)' });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalled();
    }, 15000);

    it('should reset debounce timer on progress change', async () => {
      vi.useRealTimers();
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ cfi, progress }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: cfi,
            progress,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 5000,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { cfi: '', progress: 25 },
        }
      );

      rerender({ cfi: 'epubcfi(/6/4)', progress: 25 });

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      rerender({ cfi: 'epubcfi(/6/4)', progress: 30 });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      onSave.mockClear();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 30, 10, 1);
    });

    it('should not save if progress has not changed', async () => {
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
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('Saving State', () => {
    it('should set isSaving to true during save', async () => {
      let resolveSave: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      const onSave = vi.fn().mockReturnValue(savePromise);

      const { result } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isSaving).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(result.current.isSaving).toBe(true);

      await act(async () => {
        resolveSave!();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.isSaving).toBe(false);
    });

    it('should update lastSaved timestamp after successful save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const beforeTime = Date.now();

      const { result } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      expect(result.current.lastSaved).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(result.current.lastSaved).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe('Error Handling', () => {
    it('should handle save errors gracefully', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(result.current.isSaving).toBe(false);
    });

    it('should not throw on save error', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));

      const { result } = renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(result.current.isSaving).toBe(false);
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
            debounceMs: 5000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      unmount();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 25, 10, 1);
    });

    it('should invalidate the shared book detail key after unmount save', async () => {
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
        await vi.runAllTimersAsync();
      });

      // Ключ ОБЯЗАН быть тем же, что читают BookPage и useParsingStatus,
      // иначе страница книги после выхода из читалки покажет старый прогресс.
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: bookKeys.detail(USER_ID, 'book-1'),
      });

      invalidateSpy.mockRestore();
    });

    it('should not invalidate while the reader is still mounted, however often it re-renders', async () => {
      // Регрессия инцидента 2026-08-05. `EpubReader` передаёт `onSave` стрелкой,
      // создаваемой заново каждым рендером, и рендерится десятки раз за одно
      // открытие книги. Если уборка эффекта выгрузки цепляется за эту ссылку,
      // каждый рендер инвалидирует детали книги: инвалидация → refetch →
      // новый рендер → снова инвалидация. Цикл сам себя подкармливает и
      // на книге с полным глоссарием не сходится вовсе.
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { rerender, unmount } = renderHook(
        ({ cfi, chapter }: { cfi: string; chapter: number }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: cfi,
            progress: chapter,
            scrollOffset: chapter,
            currentChapter: chapter,
            // Новая ссылка на каждый рендер — ровно как в EpubReader до правки.
            onSave: vi.fn().mockResolvedValue(undefined),
            enabled: true,
          }),
        { wrapper: createWrapper(), initialProps: { cfi: 'epubcfi(/6/4)', chapter: 1 } }
      );

      for (let i = 2; i <= 12; i++) {
        rerender({ cfi: `epubcfi(/6/${i * 2})`, chapter: i });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }

      expect(invalidateSpy).not.toHaveBeenCalled();

      // Настоящая выгрузка обязана инвалидировать ровно один раз.
      unmount();
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const expectedKey = JSON.stringify(bookKeys.detail(USER_ID, 'book-1'));
      const bookDetailCalls = invalidateSpy.mock.calls.filter(
        (call) => JSON.stringify(call[0]?.queryKey) === expectedKey
      );
      expect(bookDetailCalls).toHaveLength(1);

      invalidateSpy.mockRestore();
    });

    it('should clear pending debounce timer on unmount', async () => {
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
            debounceMs: 5000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      unmount();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('beforeunload Event', () => {
    it('should save progress with fetch keepalive on page unload', () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);

      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4[chapter])',
            progress: 50,
            scrollOffset: 25,
            currentChapter: 3,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      window.dispatchEvent(new Event('beforeunload'));

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/books/book-1/progress'),
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"current_chapter":3'),
        })
      );

      fetchSpy.mockRestore();
    });

    it('should not send beacon if no changes since last save', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
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
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalled();

      fetchSpy.mockClear();

      window.dispatchEvent(new Event('beforeunload'));

      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('should include all progress data in beacon payload', () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);

      const onSave = vi.fn().mockResolvedValue(undefined);

      renderHook(
        () =>
          useProgressSync({
            bookId: 'book-123',
            currentCFI: 'epubcfi(/6/4[ch01]!/4[body]/10/2)',
            progress: 75.5,
            scrollOffset: 50.25,
            currentChapter: 5,
            onSave,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      window.dispatchEvent(new Event('beforeunload'));

      const fetchCall = fetchSpy.mock.calls[0];
      const bodyStr = fetchCall?.[1]?.body as string;

      if (bodyStr) {
        const bodyData = JSON.parse(bodyStr);
        expect(bodyData).toEqual({
          current_chapter: 5,
          current_position_percent: 75.5,
          reading_location_cfi: 'epubcfi(/6/4[ch01]!/4[body]/10/2)',
          scroll_offset_percent: 50.25,
        });
      }

      fetchSpy.mockRestore();
    });
  });

  describe('Progress Changes', () => {
    it('should trigger save when CFI changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ cfi }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: cfi,
            progress: 25,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { cfi: 'epubcfi(/6/4)' },
        }
      );

      rerender({ cfi: 'epubcfi(/6/6)' });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/6)', 25, 10, 1);
    });

    it('should trigger save when progress percentage changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ progress }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress,
            scrollOffset: 10,
            currentChapter: 1,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { progress: 25 },
        }
      );

      rerender({ progress: 30 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 30, 10, 1);
    });

    it('should trigger save when chapter changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { rerender } = renderHook(
        ({ chapter }) =>
          useProgressSync({
            bookId: 'book-1',
            currentCFI: 'epubcfi(/6/4)',
            progress: 25,
            scrollOffset: 10,
            currentChapter: chapter,
            onSave,
            debounceMs: 1000,
            enabled: true,
          }),
        {
          wrapper: createWrapper(),
          initialProps: { chapter: 1 },
        }
      );

      rerender({ chapter: 2 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).toHaveBeenCalledWith('epubcfi(/6/4)', 25, 10, 2);
    });
  });

  describe('Empty or Invalid Data', () => {
    it('should not save when CFI is empty', async () => {
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
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).not.toHaveBeenCalled();
    });

    it('should not save when bookId is empty', async () => {
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
            debounceMs: 1000,
            enabled: true,
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
