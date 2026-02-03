/**
 * useOnlineStatus - Hook for tracking network connectivity
 *
 * Monitors online/offline status and triggers sync events when connection is restored.
 * Works with syncQueue service to synchronize pending offline operations.
 *
 * @returns {OnlineStatus} Current online status and offline history
 */

import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';

export interface OnlineStatus {
  /** Whether the browser is currently online */
  isOnline: boolean;
  /** Whether the user has been offline during this session */
  wasOffline: boolean;
  /** Timestamp of last online event (for debugging) */
  lastOnlineAt: number | null;
}

/**
 * Custom event dispatched when network connection is restored.
 * Used by syncQueue to trigger synchronization.
 */
export const ONLINE_EVENT = 'app:online';

/**
 * Custom event dispatched when network connection is lost.
 */
export const OFFLINE_EVENT = 'app:offline';

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineAt: null,
  }));

  const handleOnline = useCallback(() => {
    setStatus(prev => ({
      isOnline: true,
      wasOffline: prev.wasOffline,
      lastOnlineAt: Date.now(),
    }));

    // Dispatch custom event for sync queue and other listeners
    window.dispatchEvent(new CustomEvent(ONLINE_EVENT, {
      detail: { timestamp: Date.now() },
    }));

    logger.debug('[useOnlineStatus] Network restored, dispatched app:online event');
  }, []);

  const handleOffline = useCallback(() => {
    setStatus({
      isOnline: false,
      wasOffline: true,
      lastOnlineAt: null,
    });

    // Dispatch custom event for components that need to react
    window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, {
      detail: { timestamp: Date.now() },
    }));

    logger.debug('[useOnlineStatus] Network lost, dispatched app:offline event');
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return status;
}

/**
 * Utility function to check if we're online (for non-React code)
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
