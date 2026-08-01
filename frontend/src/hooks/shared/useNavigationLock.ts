import { useRef, useCallback, useEffect } from 'react';

/**
 * Navigation lock state interface
 *
 * Provides a ref-based mutex for serializing navigation actions.
 * Uses refs instead of state to avoid unnecessary re-renders.
 */
export interface NavigationLock {
  /** Attempt to acquire the lock. Returns true if acquired, false if already held. */
  acquire: () => boolean;
  /** Release the lock and clear the recovery timer. */
  release: () => void;
  /** Immediately release the lock and call onAutoRecovery callback. */
  forceRelease: () => void;
  /** Check if the lock is currently held. */
  isLocked: () => boolean;
}

export interface NavigationLockOptions {
  /** Maximum time (ms) before auto-recovery releases the lock. Default: 2000 */
  maxLockDuration?: number;
  /** Callback invoked when lock is auto-recovered (timeout or forceRelease). */
  onAutoRecovery?: () => void;
}

/**
 * useNavigationLock - Ref-based navigation mutex with auto-recovery
 *
 * Prevents concurrent navigation actions (e.g., rapid swipes) from
 * creating race conditions. If a lock is held for longer than
 * maxLockDuration, it auto-releases to prevent permanent navigation freeze.
 *
 * Uses refs exclusively (no state) to avoid re-renders on lock changes.
 *
 * @param options - Configuration for lock duration and recovery callback
 * @returns NavigationLock interface
 */
export const useNavigationLock = (options?: NavigationLockOptions): NavigationLock => {
  // Store options in refs so useCallback deps don't change on every render
  const maxLockDurationRef = useRef(options?.maxLockDuration ?? 2000);
  const onAutoRecoveryRef = useRef(options?.onAutoRecovery);

  // Обновление refs после коммита: правка ref во время рендера ломает
  // допущения React Compiler. Колбэки читают их только из обработчиков
  // событий и таймеров, то есть заведомо после коммита.
  useEffect(() => {
    maxLockDurationRef.current = options?.maxLockDuration ?? 2000;
    onAutoRecoveryRef.current = options?.onAutoRecovery;
  });

  const lockRef = useRef(false);
  const lockTimeRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const release = useCallback(() => {
    lockRef.current = false;
    lockTimeRef.current = 0;
    clearRecoveryTimer();
  }, [clearRecoveryTimer]);

  const forceRelease = useCallback(() => {
    release();
    onAutoRecoveryRef.current?.();
  }, [release]);

  const acquire = useCallback((): boolean => {
    // If lock is held, check if it's stale
    if (lockRef.current) {
      const elapsed = Date.now() - lockTimeRef.current;
      if (elapsed > maxLockDurationRef.current) {
        // Stale lock -- force release and re-acquire
        forceRelease();
      } else {
        // Lock is fresh -- cannot acquire
        return false;
      }
    }

    // Acquire the lock
    lockRef.current = true;
    lockTimeRef.current = Date.now();

    // Set up auto-recovery timer
    clearRecoveryTimer();
    recoveryTimerRef.current = setTimeout(() => {
      if (lockRef.current) {
        lockRef.current = false;
        lockTimeRef.current = 0;
        recoveryTimerRef.current = null;
        onAutoRecoveryRef.current?.();
      }
    }, maxLockDurationRef.current);

    return true;
  }, [forceRelease, clearRecoveryTimer]);

  const isLocked = useCallback((): boolean => {
    return lockRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearRecoveryTimer();
    };
  }, [clearRecoveryTimer]);

  return { acquire, release, forceRelease, isLocked };
};
