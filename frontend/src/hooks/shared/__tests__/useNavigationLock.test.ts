import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNavigationLock } from '../useNavigationLock';

describe('useNavigationLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquire() returns true when lock is free', () => {
    const { result } = renderHook(() => useNavigationLock());

    let acquired: boolean;
    act(() => {
      acquired = result.current.acquire();
    });

    expect(acquired!).toBe(true);
    expect(result.current.isLocked()).toBe(true);
  });

  it('acquire() returns false when lock is already held', () => {
    const { result } = renderHook(() => useNavigationLock());

    act(() => {
      result.current.acquire();
    });

    let secondAcquire: boolean;
    act(() => {
      secondAcquire = result.current.acquire();
    });

    expect(secondAcquire!).toBe(false);
    expect(result.current.isLocked()).toBe(true);
  });

  it('release() frees the lock', () => {
    const { result } = renderHook(() => useNavigationLock());

    act(() => {
      result.current.acquire();
    });
    expect(result.current.isLocked()).toBe(true);

    act(() => {
      result.current.release();
    });
    expect(result.current.isLocked()).toBe(false);

    // Can acquire again after release
    let reacquired: boolean;
    act(() => {
      reacquired = result.current.acquire();
    });
    expect(reacquired!).toBe(true);
  });

  it('auto-recovers after maxLockDuration timeout', () => {
    const onAutoRecovery = vi.fn();
    const { result } = renderHook(() =>
      useNavigationLock({ maxLockDuration: 2000, onAutoRecovery })
    );

    act(() => {
      result.current.acquire();
    });
    expect(result.current.isLocked()).toBe(true);

    // Advance time past maxLockDuration
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isLocked()).toBe(false);
    expect(onAutoRecovery).toHaveBeenCalledTimes(1);
  });

  it('acquire() on stale lock force-releases and acquires', () => {
    const onAutoRecovery = vi.fn();
    const { result } = renderHook(() =>
      useNavigationLock({ maxLockDuration: 2000, onAutoRecovery })
    );

    act(() => {
      result.current.acquire();
    });

    // Advance time past maxLockDuration without triggering timer
    // (simulate stale lock check in acquire)
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // Now try to acquire -- should succeed because lock is stale
    let acquired: boolean;
    act(() => {
      acquired = result.current.acquire();
    });

    expect(acquired!).toBe(true);
    expect(result.current.isLocked()).toBe(true);
  });

  it('forceRelease() immediately releases and calls onAutoRecovery', () => {
    const onAutoRecovery = vi.fn();
    const { result } = renderHook(() => useNavigationLock({ onAutoRecovery }));

    act(() => {
      result.current.acquire();
    });
    expect(result.current.isLocked()).toBe(true);

    act(() => {
      result.current.forceRelease();
    });

    expect(result.current.isLocked()).toBe(false);
    expect(onAutoRecovery).toHaveBeenCalledTimes(1);
  });

  it('release() clears the recovery timer', () => {
    const onAutoRecovery = vi.fn();
    const { result } = renderHook(() =>
      useNavigationLock({ maxLockDuration: 2000, onAutoRecovery })
    );

    act(() => {
      result.current.acquire();
    });

    // Release before timeout
    act(() => {
      result.current.release();
    });

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // onAutoRecovery should NOT have been called
    expect(onAutoRecovery).not.toHaveBeenCalled();
  });

  it('cleanup clears recovery timer on unmount', () => {
    const onAutoRecovery = vi.fn();
    const { result, unmount } = renderHook(() =>
      useNavigationLock({ maxLockDuration: 2000, onAutoRecovery })
    );

    act(() => {
      result.current.acquire();
    });

    // Unmount
    unmount();

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // onAutoRecovery should NOT have been called after unmount
    expect(onAutoRecovery).not.toHaveBeenCalled();
  });

  it('isLocked() returns false initially', () => {
    const { result } = renderHook(() => useNavigationLock());
    expect(result.current.isLocked()).toBe(false);
  });

  it('uses default maxLockDuration of 2000ms', () => {
    const onAutoRecovery = vi.fn();
    const { result } = renderHook(() => useNavigationLock({ onAutoRecovery }));

    act(() => {
      result.current.acquire();
    });

    // Not yet recovered at 1999ms
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.isLocked()).toBe(true);

    // Recovered at 2000ms
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isLocked()).toBe(false);
    expect(onAutoRecovery).toHaveBeenCalledTimes(1);
  });
});
