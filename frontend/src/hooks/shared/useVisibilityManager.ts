/**
 * useVisibilityManager - React hook wrapper for centralized VisibilityManager
 *
 * Automatically registers/unregisters visibility handlers on mount/unmount.
 * Prevents race conditions by using the centralized priority queue.
 *
 * @module hooks/shared/useVisibilityManager
 */

import { useEffect, useCallback } from 'react';
import { visibilityManager, type VisibilityHandler } from '@/services/visibilityManager';

export interface UseVisibilityManagerOptions {
  /** Unique identifier for this handler */
  id: string;
  /** Priority (lower = earlier execution) */
  priority?: number;
  /** Delay before execution (ms) */
  delay?: number;
  /** Callback when page becomes visible */
  onVisible: () => void | Promise<void>;
  /** Callback when page becomes hidden */
  onHidden: () => void | Promise<void>;
  /** Optional precondition check before running */
  shouldRun?: () => boolean;
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean;
}

/**
 * React hook wrapper for the centralized VisibilityManager.
 * Automatically registers/unregisters on mount/unmount.
 *
 * @example
 * ```tsx
 * useVisibilityManager({
 *   id: 'progress-sync',
 *   priority: 10,
 *   delay: 0,
 *   onVisible: () => console.log('Page visible'),
 *   onHidden: () => console.log('Page hidden'),
 *   shouldRun: () => isReading,
 * });
 * ```
 */
export function useVisibilityManager(options: UseVisibilityManagerOptions): void {
  const {
    id,
    priority = 50,
    delay = 0,
    onVisible,
    onHidden,
    shouldRun,
    enabled = true,
  } = options;

  const stableOnVisible = useCallback(() => onVisible(), [onVisible]);
  const stableOnHidden = useCallback(() => onHidden(), [onHidden]);
  const stableShouldRun = useCallback(() => {
    if (!shouldRun) return true;
    return shouldRun();
  }, [shouldRun]);

  useEffect(() => {
    if (!enabled) return;

    const handler: VisibilityHandler = {
      id,
      priority,
      delay,
      onVisible: stableOnVisible,
      onHidden: stableOnHidden,
      shouldRun: stableShouldRun,
    };

    visibilityManager.register(handler);

    return () => {
      visibilityManager.unregister(id);
    };
  }, [id, priority, delay, stableOnVisible, stableOnHidden, stableShouldRun, enabled]);
}
