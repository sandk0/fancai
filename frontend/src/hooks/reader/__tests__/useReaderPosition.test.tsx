/**
 * Восстановление позиции в читалке.
 *
 * Главный защищаемый контракт: `isRestoringPosition` ОБЯЗАН сняться.
 * Пока флаг поднят, читалка показывает «восстановление позиции», а
 * `useProgressSync` не сохраняет прогресс. Инцидент 2026-08-05 — ровно этот
 * флаг, застрявший навсегда.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useReaderPosition } from '../useReaderPosition';
import { booksAPI } from '@/api/books';
import type { Rendition } from '@/types/epub';

vi.mock('@/api/books', () => ({
  booksAPI: {
    getReadingProgress: vi.fn(),
    updateReadingProgress: vi.fn(),
  },
}));

const CFI = 'epubcfi(/6/128!/4/2[id39]/8/1:0)';

const makeRendition = () =>
  ({
    display: vi.fn(() => Promise.resolve()),
  }) as unknown as Rendition;

const serverProgress = (overrides: Record<string, unknown> = {}) => ({
  progress: {
    reading_location_cfi: CFI,
    current_position: 96,
    scroll_offset_percent: 0,
    last_read_at: '2026-08-05T10:00:00Z',
    ...overrides,
  },
});

describe('useReaderPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(booksAPI.getReadingProgress).mockResolvedValue(serverProgress() as never);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('clears the restoring flag once the saved position is applied', async () => {
    const rendition = makeRendition();
    const goToCFI = vi.fn(() => Promise.resolve());
    const setInitialProgress = vi.fn();

    const { result } = renderHook(() =>
      useReaderPosition({
        rendition,
        renditionReady: true,
        bookId: 'book-1',
        locations: null,
        goToCFI,
        skipNextRelocated: vi.fn(),
        setInitialProgress,
      })
    );

    expect(result.current.isRestoringPosition).toBe(true);

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
    expect(goToCFI).toHaveBeenCalledWith(CFI, 0);
    expect(setInitialProgress).toHaveBeenCalledWith(CFI, 96);
  });

  it('clears the flag even when the reader callbacks change identity mid-restoration', async () => {
    // Регрессия инцидента 2026-08-05. `skipNextRelocated` в `useCFITracking`
    // зависел от состояния `currentCFI`, то есть получал новую ссылку после
    // КАЖДОГО события relocated — в том числе тех, что рождает само
    // восстановление. Эффект пересоздавался посреди своей работы, прежний
    // прогон уходил в `isMounted === false` и не снимал флаг, а новый начинал
    // всё заново: «вечное восстановление позиции».
    const rendition = makeRendition();
    let releaseNavigation: () => void = () => {};
    const navigationStarted = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    // Навигация «подвисает» до отпускания — за это время меняем колбэки.
    const goToCFI = vi.fn(() => navigationStarted);

    const { result, rerender } = renderHook(
      (props: { skipNextRelocated: () => void; setInitialProgress: () => void }) =>
        useReaderPosition({
          rendition,
          renditionReady: true,
          bookId: 'book-1',
          locations: null,
          goToCFI,
          ...props,
        }),
      { initialProps: { skipNextRelocated: vi.fn(), setInitialProgress: vi.fn() } }
    );

    await waitFor(() => expect(goToCFI).toHaveBeenCalled());

    // Каждый рендер приносит новые ссылки — как настоящие хуки читалки.
    for (let i = 0; i < 5; i++) {
      rerender({ skipNextRelocated: vi.fn(), setInitialProgress: vi.fn() });
    }

    await act(async () => {
      releaseNavigation();
      await navigationStarted;
    });

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
    // Восстановление не должно перезапускаться: один запрос прогресса, одна навигация.
    expect(booksAPI.getReadingProgress).toHaveBeenCalledTimes(1);
    expect(goToCFI).toHaveBeenCalledTimes(1);
  });

  it('clears the flag even if the effect is torn down before its own finally', async () => {
    // Вторая половина той же поломки: флаг снимался только под `if (isMounted)`.
    // Прогон, снесённый сменой rendition, уходил молча, а новый мог зависнуть
    // на своей навигации — читалка оставалась в «восстановлении» навсегда.
    const releases: Array<() => void> = [];
    const goToCFI = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        })
    );

    const { result, rerender } = renderHook(
      ({ rendition }: { rendition: Rendition }) =>
        useReaderPosition({
          rendition,
          renditionReady: true,
          bookId: 'book-1',
          locations: null,
          goToCFI,
          skipNextRelocated: vi.fn(),
          setInitialProgress: vi.fn(),
        }),
      { initialProps: { rendition: makeRendition() } }
    );

    await waitFor(() => expect(goToCFI).toHaveBeenCalledTimes(1));

    // Новый rendition — настоящая смена зависимости: прогон сносится.
    rerender({ rendition: makeRendition() });
    await waitFor(() => expect(goToCFI).toHaveBeenCalledTimes(2));

    // Отпускаем ТОЛЬКО первую навигацию; вторая остаётся висеть.
    await act(async () => {
      releases[0]();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
  });

  it('clears the flag when the server has no saved position', async () => {
    vi.mocked(booksAPI.getReadingProgress).mockResolvedValue({ progress: null } as never);
    const rendition = makeRendition();

    const { result } = renderHook(() =>
      useReaderPosition({
        rendition,
        renditionReady: true,
        bookId: 'book-1',
        locations: null,
        goToCFI: vi.fn(() => Promise.resolve()),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      })
    );

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
    expect(rendition.display).toHaveBeenCalled();
  });

  it('clears the flag when the progress request fails', async () => {
    vi.mocked(booksAPI.getReadingProgress).mockRejectedValue(new Error('offline'));
    const rendition = makeRendition();

    const { result } = renderHook(() =>
      useReaderPosition({
        rendition,
        renditionReady: true,
        bookId: 'book-1',
        locations: null,
        goToCFI: vi.fn(() => Promise.resolve()),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      })
    );

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
    expect(rendition.display).toHaveBeenCalled();
  });

  it('restores again for a different book', async () => {
    const rendition = makeRendition();

    const { result, rerender } = renderHook(
      ({ bookId }: { bookId: string }) =>
        useReaderPosition({
          rendition,
          renditionReady: true,
          bookId,
          locations: null,
          goToCFI: vi.fn(() => Promise.resolve()),
          skipNextRelocated: vi.fn(),
          setInitialProgress: vi.fn(),
        }),
      { initialProps: { bookId: 'book-1' } }
    );

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));

    rerender({ bookId: 'book-2' });
    expect(result.current.isRestoringPosition).toBe(true);

    await waitFor(() => expect(result.current.isRestoringPosition).toBe(false));
    expect(booksAPI.getReadingProgress).toHaveBeenCalledWith('book-2');
  });

  it('holds the flag until the rendition is ready', async () => {
    const rendition = makeRendition();

    const { result } = renderHook(() =>
      useReaderPosition({
        rendition,
        renditionReady: false,
        bookId: 'book-1',
        locations: null,
        goToCFI: vi.fn(() => Promise.resolve()),
        skipNextRelocated: vi.fn(),
        setInitialProgress: vi.fn(),
      })
    );

    expect(result.current.isRestoringPosition).toBe(true);
    expect(booksAPI.getReadingProgress).not.toHaveBeenCalled();
  });
});
